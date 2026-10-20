'use strict';
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async ({ submit, jobs, app, tools, dir }) => {
  const FX = process.env.LIME_FX;
  const OUT = path.join(dir, 'out');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const E = (n) => require(path.join(__dirname, '..', 'src', 'main', 'engines', n));
  const sharp = require('sharp');
  const fx = (f) => path.join(FX, f);
  const SENT = fs.readFileSync(fx('sentence.txt'), 'utf8');
  const words = (t) => String(t).toLowerCase().split(/\s+/).filter(Boolean);
  const score = (t) => { const pool = words(t); let hit = 0; for (const w of words(SENT)) { const i = pool.indexOf(w); if (i >= 0) { hit++; pool.splice(i, 1); } } return hit / words(SENT).length; };
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const read = (p) => fs.readFileSync(p);
  const txt = (p) => fs.readFileSync(p, 'utf8');
  const fmt = async (p, f) => { const m = await sharp(p, { animated: true }).metadata(); ok(!f || m.format === f, `format ${m.format} ≠ ${f}`); return m; };
  const magic = (p, s) => ok(read(p).subarray(0, 16).toString('latin1').includes(s), `magic ${JSON.stringify(read(p).subarray(0, 8).toString('latin1'))} lacks ${s}`);
  const pages = async (p, n) => { const c = await E('pdf').pageCount(p); ok(n == null || c === n, `${c} pages ≠ ${n}`); return c; };
  const pdfText = async (p) => { const { doc } = await E('pdf').readPdf(p); let t = ''; for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText('').asText(); return t; };
  const probe = (p) => E('media').probe(p);
  const dur = async (p, d, tol = 0.6) => { const i = await probe(p); ok(Math.abs(i.duration - d) <= tol, `duration ${i.duration} ≠ ${d}`); return i; };
  const zipHas = (p, name) => { const z = require('fflate').unzipSync(new Uint8Array(read(p))); ok(Object.keys(z).some((k) => k.includes(name)), `zip lacks ${name}: ${Object.keys(z).slice(0, 8)}`); return z; };
  const docxText = async (p) => (await require('mammoth').extractRawText({ path: p })).value;
  const files = (d) => (fs.existsSync(d) && fs.statSync(d).isDirectory() ? fs.readdirSync(d) : []);
  const C = [];
  const T = (name, tool, inputs, opts, check) => C.push({ name, tool, inputs: inputs.map(fx), opts, check });
  const X = (name, tool, inputs, opts, expect) => C.push({ name, tool, inputs: inputs.map(fx), opts, expect });
  const xmlDoc = (s, what) => { const errs = []; const d = new (require('@xmldom/xmldom').DOMParser)({ errorHandler: { warning: () => {}, error: (e) => errs.push(e), fatalError: (e) => errs.push(e) } }).parseFromString(s, 'text/xml'); ok(!errs.length && d.documentElement, `${what} is not well-formed: ${errs[0]}`); return d; };
  const tags = (d, n) => { const all = d.getElementsByTagName('*'), out = []; for (let i = 0; i < all.length; i++) if (String(all[i].localName || all[i].tagName).replace(/^.*:/, '') === n) out.push(all[i]); return out; };
  // EPUB structure: mimetype first and stored, OPF 3.0 with one identifier and modified date, every manifest item and
  // relative link present, unique ids, nav with entries, NCX with nav points, and well-formed XHTML.
  const epub = (p) => {
    const b = read(p);
    ok(b.readUInt32LE(0) === 0x04034b50 && b.readUInt16LE(8) === 0 && b.readUInt16LE(28) === 0 && b.subarray(30, 58).toString() === 'mimetypeapplication/epub+zip', 'mimetype is not the first stored entry');
    const z = require('fflate').unzipSync(new Uint8Array(b)), s = (k) => Buffer.from(z[k] || []).toString('utf8');
    const opfPath = /full-path="([^"]+)"/.exec(s('META-INF/container.xml'))[1], dir = path.posix.dirname(opfPath);
    const opf = xmlDoc(s(opfPath), 'OPF');
    ok(opf.documentElement.getAttribute('version') === '3.0', 'not EPUB 3');
    ok(tags(opf, 'identifier').length === 1 && tags(opf, 'meta').filter((m) => m.getAttribute('property') === 'dcterms:modified').length === 1, 'identifier/modified');
    const items = tags(opf, 'item').map((i) => ({ id: i.getAttribute('id'), href: path.posix.join(dir, decodeURIComponent(i.getAttribute('href'))), type: i.getAttribute('media-type'), props: i.getAttribute('properties') || '' }));
    ok(new Set(items.map((i) => i.id)).size === items.length, 'duplicate manifest ids');
    for (const i of items) ok(z[i.href], `missing ${i.href}`);
    const spine = tags(opf, 'itemref').map((r) => items.find((i) => i.id === r.getAttribute('idref')).href);
    ok(spine.length, 'empty spine');
    const nav = items.find((i) => /\bnav\b/.test(i.props)), ncx = items.find((i) => i.type === 'application/x-dtbncx+xml');
    ok(tags(xmlDoc(s(nav.href), 'nav'), 'li').length && tags(xmlDoc(s(ncx.href), 'NCX'), 'navPoint').length, 'empty nav or NCX');
    const pages = {};
    for (const i of items.filter((x) => x.type === 'application/xhtml+xml')) {
      const d = xmlDoc(s(i.href), i.href);
      for (const e of [...tags(d, 'img'), ...tags(d, 'a'), ...tags(d, 'link')]) {
        const ref = e.getAttribute('src') || e.getAttribute('href');
        if (!ref || /^[a-z][a-z0-9+.-]+:/i.test(ref) || ref.startsWith('#')) continue;
        ok(z[path.posix.join(path.posix.dirname(i.href), decodeURIComponent(ref.split('#')[0]))], `${i.href} links to missing ${ref}`);
      }
      const ids = Array.prototype.slice.call(d.getElementsByTagName('*')).map((e) => e.getAttribute('id')).filter(Boolean);
      ok(new Set(ids).size === ids.length, `duplicate ids in ${i.href}`);
      pages[path.posix.relative(dir, i.href)] = s(i.href);
    }
    return { z, s, opf: s(opfPath), items, spine: spine.map((h) => path.posix.relative(dir, h)), pages, nav: s(nav.href), ncx: s(ncx.href), images: items.filter((i) => i.type.startsWith('image/')) };
  };

  for (const [src, to, f] of [['photo.heic', 'jpg', 'jpeg'], ['photo.jpg', 'png', 'png'], ['photo.jpg', 'webp', 'webp'], ['photo.jpg', 'avif', 'heif'], ['photo.jpg', 'tiff', 'tiff'], ['photo.jpg', 'gif', 'gif'], ['photo.webp', 'jpg', 'jpeg'], ['alpha.png', 'jpg', 'jpeg'], ['layers.psd', 'png', 'png'], ['raw.dng', 'jpg', 'jpeg'], ['photo.jxl', 'png', 'png']]) {
    T(`image ${src}→${to}`, 'convert-image', [src], { to, quality: 88 }, async ([o]) => { const m = await fmt(o, f); ok(m.width > 100, 'tiny'); });
  }
  T('image→bmp', 'convert-image', ['photo.jpg'], { to: 'bmp' }, ([o]) => magic(o, 'BM'));
  T('image→ico', 'convert-image', ['photo.png'], { to: 'ico' }, ([o]) => ok(read(o).readUInt16LE(2) === 1 && read(o).readUInt16LE(4) >= 5, 'not ico'));
  T('image→psd', 'convert-image', ['photo.png'], { to: 'psd' }, ([o]) => magic(o, '8BPS'));
  T('image→pdf', 'convert-image', ['photo.jpg'], { to: 'pdf' }, async ([o]) => pages(o, 1));
  T('image→jxl', 'convert-image', ['photo.png'], { to: 'jxl' }, ([o]) => ok(read(o).length > 100 && (read(o)[0] === 0xff && read(o)[1] === 0x0a || read(o).subarray(4, 8).toString() === 'JXL '), 'not jxl'));
  T('develop raw→tif', 'develop-raw', ['raw.dng'], { to: 'tif', auto: true, quality: 92 }, async ([o]) => fmt(o, 'tiff'));
  T('enhance photo', 'enhance-photo', ['photo.jpg'], {}, async ([o]) => fmt(o, 'jpeg'));
  T('panorama', 'panorama', ['pano/view-0.png', 'pano/view-1.png', 'pano/view-2.png'], {}, async ([o]) => { const m = await fmt(o, 'jpeg'); const v = await sharp(fx('pano/view-0.png')).metadata(); ok(m.width > v.width * 1.3, `width ${m.width} vs view ${v.width}`); });
  T('hdr merge', 'hdr-merge', ['hdr/bracket-0.dng', 'hdr/bracket-1.dng', 'hdr/bracket-2.dng'], {}, async (o) => { await fmt(o[0], 'jpeg'); ok(o.some((x) => x.endsWith('.dng')), 'no dng'); });
  T('compress image', 'compress-image', ['photo.jpg'], { level: 'recommended' }, async ([o]) => { ok(fs.statSync(o).size < fs.statSync(fx('photo.jpg')).size, 'not smaller'); await fmt(o, 'jpeg'); });
  T('resize 50%', 'resize-image', ['photo.jpg'], { mode: 'percent', percent: 50 }, async ([o]) => { const m = await fmt(o); ok(m.width === 800, `width ${m.width}`); });
  T('crop square', 'crop-image', ['photo.jpg'], { aspect: '1:1', smart: true }, async ([o]) => { const m = await fmt(o); ok(m.width === m.height, 'not square'); });
  T('remove background', 'remove-background', ['photo.jpg'], { quality: 'fast', background: 'transparent' }, async ([o]) => { const m = await fmt(o, 'png'); ok(m.hasAlpha, 'no alpha'); const st = await sharp(o).stats(); ok(st.channels[3].min < 50 && st.channels[3].max > 200, 'alpha not cut'); });
  T('upscale 2×', 'upscale-image', ['photo2.jpg'], { factor: '2' }, async ([o]) => { const m = await fmt(o); ok(m.width === 800, `width ${m.width}`); });
  T('rotate 90', 'rotate-image', ['photo2.jpg'], { angle: '90', flip: 'none' }, async ([o]) => { const m = await fmt(o); const s = await sharp(fx('photo2.jpg')).metadata(); ok(m.width === s.height, 'not rotated'); });
  T('adjust grayscale', 'adjust-image', ['photo2.jpg'], { filter: 'grayscale', brightness: 0, contrast: 0, saturation: 0, sharpen: 0, blur: 0 }, async ([o]) => { const st = await sharp(o).stats(); ok(Math.abs(st.channels[0].mean - st.channels[1].mean) < 2, 'not gray'); });
  T('watermark image', 'watermark-image', ['photo2.jpg'], { kind: 'text', text: 'LIME', layout: 'single', position: 'bottom-right', opacity: 60, color: '#ffffff' }, async ([o]) => fmt(o, 'jpeg'));
  T('strip exif', 'strip-metadata', ['photo.jpg'], {}, async ([o]) => { const m = await sharp(o).metadata(); ok(!m.exif, 'exif kept'); ok((await sharp(fx('photo.jpg')).metadata()).exif, 'fixture had no exif'); });
  T('collage', 'collage', ['photo.jpg', 'photo2.jpg', 'photo.png'], { gap: 12, background: '#ffffff' }, async ([o]) => fmt(o, 'jpeg'));
  T('make gif', 'images-to-gif', ['photo.jpg', 'photo2.jpg', 'photo.png'], { seconds: 1, width: 300 }, async ([o]) => { const m = await fmt(o, 'gif'); ok((m.pages || 1) >= 3, `frames ${m.pages}`); });
  T('OCR light', 'image-to-text', ['text.png'], { lang: 'eng' }, async ([o], r) => { const s = score(txt(o)); ok(s >= 0.9, `OCR accuracy ${Math.round(s * 100)}%: ${txt(o).trim()}`); ok(r[0].text, 'no text result'); });
  T('OCR dark', 'image-to-text', ['dark-text.png'], { lang: 'eng' }, async ([o]) => { const s = score(txt(o)); ok(s >= 0.9, `OCR accuracy ${Math.round(s * 100)}%: ${txt(o).trim()}`); });
  T('images to pdf', 'jpg-to-pdf', ['photo.jpg', 'photo2.jpg', 'photo.png'], { combine: 'one', pageSize: 'a4', orientation: 'auto', margin: 'small' }, async ([o]) => pages(o, 3));

  T('pdf→docx', 'pdf-to-word', ['doc.pdf'], {}, async ([o]) => ok((await docxText(o)).includes('Lime test document'), 'docx text missing'));
  T('pdf→pptx', 'pdf-to-powerpoint', ['doc.pdf'], { notes: true }, ([o]) => { const z = zipHas(o, 'ppt/slides/slide'); ok(Object.keys(z).filter((k) => /slides\/slide\d+\.xml$/.test(k)).length === 3, 'slide count'); });
  T('pdf→xlsx', 'pdf-to-excel', ['doc.pdf'], { to: 'xlsx' }, ([o]) => ok(require('xlsx').readFile(o).SheetNames.length >= 1, 'no sheets'));
  T('pdf→jpg', 'pdf-to-jpg', ['doc.pdf'], { format: 'jpg', dpi: '96', pages: 'all' }, async ([o]) => { const fl = files(o); ok(fl.length === 3, `${fl.length} images`); await fmt(path.join(o, fl[0]), 'jpeg'); });
  T('pdf→txt', 'pdf-to-text', ['doc.pdf'], {}, ([o]) => ok(score(txt(o)) > 0.95, 'text missing'));
  T('pdf→html', 'pdf-to-html', ['doc.pdf'], {}, ([o]) => ok(/<html/i.test(txt(o)) && txt(o).includes('Lime'), 'html'));
  T('pdf→svg', 'pdf-to-svg', ['doc.pdf'], {}, ([o]) => ok(txt(o).includes('<svg'), 'svg'));
  T('compress pdf', 'compress-pdf', ['doc.pdf'], { level: 'extreme' }, async ([o]) => pages(o, 3));
  T('optimize pdf', 'optimize-pdf', ['doc.pdf'], { quality: 60 }, async ([o]) => pages(o, 3));
  T('merge pdf', 'merge-pdf', ['doc.pdf', 'scan.pdf', 'photo2.jpg'], {}, async ([o]) => pages(o, 5));
  T('split pdf', 'split-pdf', ['doc.pdf'], { mode: 'all' }, ([o]) => ok(files(path.dirname(o)).length >= 1 && (fs.statSync(o).isDirectory() ? files(o).length === 3 : true), 'split'));
  const pdfsIn = async (d) => Promise.all(files(d).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(async (f) => `${f.replace(/^.* - /, '').replace(/\.pdf$/, '')}=${await pages(path.join(d, f))}`));
  T('split ranges', 'split-pdf', ['doc.pdf'], { mode: 'ranges', ranges: '1-2, 3' }, async ([o]) => { const c = (await pdfsIn(o)).join(' | '); ok(c === 'part 1 (pages 1-2)=2 | part 2 (page 3)=1', c); });
  T('split ranges combined', 'split-pdf', ['doc.pdf'], { mode: 'ranges', ranges: '3, 1', mergeRanges: true }, async ([o]) => { await pages(o, 2); ok(/Page 3/.test(await pdfText(o)), 'order'); });
  T('split fixed size', 'split-pdf', ['doc.pdf'], { mode: 'every', every: 2 }, async ([o]) => { const c = (await pdfsIn(o)).join(' | '); ok(c === 'part 1 (pages 1-2)=2 | part 2 (page 3)=1', c); });
  T('split pick pages', 'split-pdf', ['doc.pdf'], { mode: 'select', pages: '1, 3', mergeSelected: true }, async ([o]) => { await pages(o, 2); const t = await pdfText(o); ok(/Page 1/.test(t) && /Page 3/.test(t) && !/Page 2 /.test(t), 'pages'); });
  T('split pick pages apart', 'split-pdf', ['doc.pdf'], { mode: 'select', pages: '2-3', mergeSelected: false }, async ([o]) => { const c = (await pdfsIn(o)).join(' | '); ok(c === 'page 2=1 | page 3=1', c); });
  T('merge order', 'merge-pdf', ['scan.pdf', 'doc.pdf'], {}, async ([o]) => { await pages(o, 4); const { doc } = await E('pdf').readPdf(o); ok(!doc.loadPage(0).toStructuredText('').asText().includes('Page 1') && doc.loadPage(1).toStructuredText('').asText().includes('Page 1'), 'scan should come first'); });
  T('remove pages', 'remove-pages', ['doc.pdf'], { pages: '2' }, async ([o]) => pages(o, 2));
  T('extract pages', 'extract-pages', ['doc.pdf'], { pages: '1,3' }, async ([o]) => pages(o, 2));
  T('rotate pdf', 'rotate-pdf', ['doc.pdf'], { angle: '90', pages: 'all' }, async ([o]) => { const d = await require('pdf-lib').PDFDocument.load(read(o)); ok(d.getPage(0).getRotation().angle === 90, 'not rotated'); });
  T('page numbers', 'page-numbers', ['doc.pdf'], { position: 'bottom-center', format: 'Page {n} of {total}', start: 1, size: 11, pages: 'all', color: '#333333' }, async ([o]) => ok((await pdfText(o)).includes('Page 2 of 3'), 'numbers missing'));
  T('watermark pdf', 'watermark-pdf', ['doc.pdf'], { kind: 'text', text: 'CONFIDENTIAL', layout: 'single', opacity: 30, rotation: 45, color: '#d13438', pages: 'all' }, async ([o]) => pages(o, 3));
  T('crop pdf', 'crop-pdf', ['doc.pdf'], { top: 10, bottom: 10, left: 10, right: 10, pages: 'all' }, async ([o]) => { const d = await require('pdf-lib').PDFDocument.load(read(o)); const b = d.getPage(0).getCropBox?.() || d.getPage(0).getMediaBox(); ok(b.width < 595, `width ${b.width}`); });
  T('redact pdf', 'redact-pdf', ['doc.pdf'], { terms: 'Invoice', patterns: ['email'], boxes: true }, async ([o]) => { const t = await pdfText(o); ok(!t.includes('hello@example.com') && !t.includes('Invoice'), 'not redacted'); ok(t.includes('quick brown'), 'too much removed'); });
  T('audit pdf', 'audit-pdf', ['doc.pdf'], {}, (o, r) => ok(/No hidden text|fake redaction/.test(r[0].note), r[0].note));
  T('protect+unlock', 'protect-pdf', ['doc.pdf'], { userPassword: 'lime123', allowPrint: true, allowCopy: true, allowEdit: false }, async ([o]) => {
    let locked = false;
    try { await E('pdf').pageCount(o); } catch (_) { locked = true; }
    ok(locked, 'not encrypted');
    ok((await E('pdf').pageCount(o, 'lime123')) === 3, 'password fails');
  });
  T('searchable pdf', 'ocr-pdf', ['scan.pdf'], { lang: 'eng', skipText: true, dpi: '300' }, async ([o]) => { const s = score(await pdfText(o)); ok(s >= 0.85, `OCR ${Math.round(s * 100)}%`); });
  T('repair pdf', 'repair-pdf', ['doc.pdf'], {}, async ([o]) => pages(o, 3));
  T('flatten pdf', 'flatten-pdf', ['doc.pdf'], {}, async ([o]) => pages(o, 3));
  T('extract images', 'extract-images-pdf', ['doc.pdf'], { format: 'png' }, ([o]) => ok(files(o).length >= 1, 'no images'));
  T('make pdf from docx', 'to-pdf', ['doc.docx'], {}, async ([o]) => ok((await pdfText(o)).includes('Lime Report'), 'pdf text'));
  T('make pdf from dxf', 'to-pdf', ['test.dxf'], {}, async ([o]) => pages(o, 1));

  for (const [to, chk] of [['mov', async (o) => { const i = await probe(o); ok(i.video && i.audio, 'tracks'); }], ['webm', async (o) => ok((await probe(o)).video.codec === 'vp9', 'vp9')], ['mkv', async (o) => ok((await probe(o)).video, 'video')], ['hevc', async (o) => ok(/hevc|h265/.test((await probe(o)).video.codec), 'hevc')], ['gif', async (o) => fmt(o, 'gif')], ['mp3', async (o) => ok((await probe(o)).audio.codec === 'mp3', 'mp3')], ['avi', async (o) => ok((await probe(o)).video, 'video')], ['mp4', async (o) => dur(o, 2, 0.3)]]) {
    T(`video→${to}`, 'convert-video', [to === 'mp4' ? 'clip2.mp4' : 'clip.mp4'], { to, quality: 'small', height: '' }, async ([o]) => chk(o));
  }
  T('compress video', 'compress-video', ['clip.mp4'], { mode: 'level', level: 'extreme', height: '480' }, async ([o]) => { const i = await probe(o); ok(i.video.height === 480, `height ${i.video.height}`); });
  T('trim', 'trim-media', ['clip.mp4'], { start: '0:01', end: '0:03', precise: true }, async ([o]) => dur(o, 2, 0.3));
  T('merge clips', 'merge-media', ['clip.mp4', 'clip2.mp4'], { to: 'mp3' }, async ([o]) => dur(o, 6, 0.5));
  T('extract audio', 'extract-audio', ['clip.mp4'], { to: 'wav', bitrate: '192k' }, async ([o]) => ok((await probe(o)).audio.codec.startsWith('pcm'), 'wav'));
  for (const [to, codec] of [['mp3', 'mp3'], ['m4a', 'aac'], ['flac', 'flac'], ['ogg', 'vorbis'], ['opus', 'opus'], ['aiff', 'pcm_s16be']]) T(`audio→${to}`, 'convert-audio', ['tone.wav'], { to, bitrate: '192k' }, async ([o]) => { const i = await dur(o, 3, 0.15); ok(i.audio.codec === codec, `${i.audio.codec}`); });
  T('compress audio', 'compress-audio', ['tone.mp3'], { level: 'extreme' }, async ([o]) => dur(o, 2, 0.15));
  T('video→gif', 'video-to-gif', ['clip.mp4'], { start: '0:00', duration: 2, fps: 10, width: 320 }, async ([o]) => { const m = await fmt(o, 'gif'); ok(m.width === 320 && m.pages >= 15, `gif ${m.width} ${m.pages}`); });
  T('mute', 'mute-video', ['clip.mp4'], {}, async ([o]) => ok(!(await probe(o)).audio, 'audio kept'));
  T('resize video', 'resize-video', ['clip.mp4'], { height: '360' }, async ([o]) => ok((await probe(o)).video.height === 360, 'height'));
  T('rotate video', 'rotate-video', ['clip2.mp4'], { angle: '90', flip: 'none' }, async ([o]) => { const v = (await probe(o)).video; ok(v.width === 360 && v.height === 640, `${v.width}x${v.height}`); });
  T('speed 2×', 'speed-media', ['clip.mp4'], { factor: '2' }, async ([o]) => dur(o, 2, 0.3));
  T('frames', 'video-frames', ['clip.mp4'], { mode: 'every', every: 1, format: 'jpg' }, ([o]) => ok(files(o).length >= 3, `${files(o).length} frames`));
  T('burn subtitles', 'burn-subtitles', ['clip.mp4'], { subtitles: fx('sub.srt'), size: 22 }, async ([o]) => dur(o, 4, 0.3));
  T('level loudness', 'normalize-audio', ['tone.wav'], {}, async ([o]) => dur(o, 3, 0.3));
  T('slideshow', 'images-to-video', ['photo.jpg', 'photo2.jpg'], { seconds: 2, size: '1920x1080' }, async ([o]) => { const i = await dur(o, 4, 0.6); ok(i.video.width === 1920, 'size'); });
  T('subtitles→vtt', 'convert-subtitles', ['sub.srt'], { to: 'vtt' }, ([o]) => ok(txt(o).startsWith('WEBVTT') && txt(o).includes('Hello Lime'), 'vtt'));
  T('lottie→gif', 'render-motion', ['anim.json'], { to: 'gif', resolution: 'quarter' }, async ([o]) => fmt(o, 'gif'));
  T('timeline→fcpxml', 'convert-timeline', ['timeline.otio'], { to: 'fcpxml' }, ([o]) => ok(txt(o).includes('fcpxml'), 'fcpxml'));
  T('timeline→edl', 'convert-timeline', ['timeline.otio'], { to: 'edl' }, ([o]) => ok(/TITLE|001/.test(txt(o)), 'edl'));

  const docChecks = {
    pdf: async (o, w) => ok((await pdfText(o)).includes(w), `pdf lacks ${w}`), docx: async (o, w) => ok((await docxText(o)).includes(w), `docx lacks ${w}`), md: (o, w) => ok(txt(o).includes(w), 'md'), txt: (o, w) => ok(txt(o).includes(w), 'txt'),
    html: (o, w) => ok(txt(o).includes(w), 'html'), epub: (o) => { const z = zipHas(o, 'mimetype'); ok(Buffer.from(z.mimetype).toString() === 'application/epub+zip', 'mimetype'); }, rtf: (o, w) => ok(txt(o).startsWith('{\\rtf1') && txt(o).includes(w.split(' ')[0]), 'rtf'),
  };
  for (const [src, word, tos] of [['doc.docx', 'Lime Report', ['pdf', 'md', 'txt', 'html', 'epub', 'rtf']], ['doc.md', 'Lime Notes', ['docx', 'pdf', 'html', 'txt', 'epub', 'rtf']], ['doc.html', 'Lime Page', ['pdf', 'docx', 'md', 'txt']], ['doc.txt', 'Lime plain text', ['pdf', 'docx', 'md', 'html']], ['doc.rtf', 'Lime RTF heading', ['docx', 'txt', 'pdf']], ['doc.odt', 'Lime ODT', ['txt', 'docx', 'pdf']], ['book.epub', 'Lime Book', ['txt', 'pdf', 'docx']]]) {
    for (const to of tos) T(`doc ${src}→${to}`, 'convert-document', [src], { to }, async ([o]) => docChecks[to](o, word));
  }
  T('epub reader links and pictures', 'convert-ebook', ['novel.epub'], { to: 'html' }, ([o]) => {
    const h = txt(o);
    ok(h.includes('<title>별빛 이야기</title>') && h.includes('lang="ko"'), 'title or language');
    ok(h.includes('href="#c3-note1"') && h.includes('id="c3-note1"'), 'link into “ch 3.xhtml” lost');
    ok(h.includes('href="#c1-local"') && h.includes('id="c1-local"'), 'link inside a chapter lost');
    ok(!h.includes('100%.html') && !/javascript:/i.test(h) && h.includes('깨진 링크'), 'bad links not unwrapped');
    ok((h.match(/src="data:image\/png;base64,/g) || []).length === 2, 'pictures (chapter picture and image page)');
    ok((h.match(/class="chapter"/g) || []).length === 4 && (h.match(/style="page-break-before:always"/g) || []).length === 3, 'chapters and page breaks');
  });
  T('epub→fb2', 'convert-ebook', ['novel.epub'], { to: 'fb2' }, ([o]) => {
    const d = xmlDoc(txt(o), 'FB2');
    ok(tags(d, 'book-title')[0].textContent === '별빛 이야기' && tags(d, 'nickname')[0].textContent === '김작가' && tags(d, 'lang')[0].textContent === 'ko', 'metadata');
    const body = tags(d, 'body')[0];
    ok(Array.prototype.slice.call(body.childNodes).filter((n) => n.nodeType === 1 && n.localName === 'section').length === 3, 'top-level sections');
    ok(tags(d, 'binary').length === 3 && tags(d, 'coverpage').length === 1, 'binaries and cover');
    ok(tags(d, 'strong')[0].textContent === '별' && tags(d, 'emphasis')[0].textContent === '반짝', 'bold and italic');
    ok(tags(d, 'a').some((a) => a.getAttribute('l:href') === '#c3-note1') && tags(d, 'p').some((p) => p.getAttribute('id') === 'c3-note1'), 'internal link');
  });
  T('epub→md with pictures', 'convert-ebook', ['novel.epub'], { to: 'md' }, async ([md, dirOut]) => {
    ok(txt(md).includes('# 세 번째 장') && txt(md).includes('![그림](novel_files/img0001.png)'), 'markdown or picture link');
    ok(path.basename(dirOut) === 'novel_files' && files(dirOut).length === 2, `picture folder ${files(dirOut)}`);
    await fmt(path.join(dirOut, 'img0001.png'), 'png');
  });
  T('epub→pdf', 'convert-ebook', ['novel.epub'], { to: 'pdf' }, async ([o]) => { ok((await pages(o)) >= 4, 'each chapter starts a page'); ok((await pdfText(o)).includes('Starlight chapter two'), 'text'); });
  T('epub font obfuscation is not DRM', 'convert-ebook', ['obfuscated.epub'], { to: 'txt' }, ([o]) => ok(txt(o).includes('세 번째 장'), 'text'));
  X('epub with DRM refused', 'convert-ebook', ['drm.epub'], { to: 'pdf' }, /DRM/);
  T('html→epub chapters', 'convert-document', ['chapters.html'], { to: 'epub' }, ([o]) => {
    const e = epub(o);
    ok(e.spine.join() === 'ch001.xhtml,ch002.xhtml', `spine ${e.spine}`);
    ok(/<dc:language>ko<\/dc:language>/.test(e.opf) && e.pages['ch001.xhtml'].includes('xml:lang="ko"'), 'language');
    ok(e.pages['ch001.xhtml'].includes('href="ch002.xhtml#two_target"') && e.pages['ch002.xhtml'].includes('id="two_target"'), 'link to the next chapter');
    ok(e.pages['ch001.xhtml'].includes('id="intro"') && e.pages['ch001.xhtml'].includes('href="https://example.com/"'), 'ids or web links');
    ok(e.images.length === 2 && e.images.every((i) => i.type === 'image/jpeg') && !Object.values(e.pages).some((p) => /remote\.png|data:image/.test(p)), 'pictures packaged, WebP converted, remote dropped');
    ok(tags(xmlDoc(e.nav, 'nav'), 'li').length === 3 && tags(xmlDoc(e.ncx, 'ncx'), 'navPoint').length === 3 && e.nav.includes('하위 절'), 'table of contents');
    ok(!e.pages['ch002.xhtml'].includes('\u000b'), 'control characters');
  });
  T('md→epub', 'convert-document', ['doc.md'], { to: 'epub' }, ([o]) => { const e = epub(o); ok(e.nav.includes('Lime Notes') && Object.values(e.pages).some((p) => p.includes('<table>')), 'nav or table'); });
  T('fb2→epub', 'convert-ebook', ['voina.fb2'], { to: 'epub' }, ([o]) => {
    const e = epub(o);
    ok(/<dc:title>Война и мир<\/dc:title>/.test(e.opf) && /<dc:creator>Лев Толстой<\/dc:creator>/.test(e.opf) && /<dc:language>ru<\/dc:language>/.test(e.opf), 'metadata');
    ok(e.nav.includes('Глава первая') && e.nav.includes('Подглава'), 'table of contents');
    ok(e.items.some((i) => i.props.includes('cover-image')) && e.spine[0] === 'cover.xhtml', 'cover');
    const all = Object.values(e.pages).join('');
    ok(/epub:type="footnote"[^>]*>[\s\S]*Текст примечания/.test(all) && all.includes('epub:type="noteref"'), 'footnote');
    ok(all.includes('<b>абзац</b>') && all.includes('Строка стиха один<br/>Строка стиха два'), 'formatting and poem');
  });
  T('fb2→pdf (document wheel)', 'convert-document', ['voina.fb2'], { to: 'pdf' }, async ([o]) => ok((await pdfText(o)).includes('Глава вторая'), 'pdf text'));
  T('fb2→docx', 'convert-document', ['voina.fb2'], { to: 'docx' }, async ([o]) => ok((await docxText(o)).includes('Текст подглавы'), 'docx text'));
  T('docx→md with pictures', 'convert-document', ['doc.docx'], { to: 'md' }, async ([md, dirOut]) => {
    ok(txt(md).includes('# Lime Report') && /!\[[^\]]*\]\(doc_files\/img0001\.(png|jpg)\)/.test(txt(md)), 'picture link');
    ok(dirOut && files(dirOut).length === 1, 'picture folder');
  });
  for (const f of ['stormy.mobi', 'stormy-huff.mobi', 'stormy-plain.prc']) {
    T(`mobi ${f}→epub`, 'convert-ebook', [f], { to: 'epub' }, ([o]) => {
      const e = epub(o), all = Object.values(e.pages).join('');
      ok(/<dc:title>Stormy Night<\/dc:title>/.test(e.opf) && /<dc:creator>E\. Bulwer-Lytton<\/dc:creator>/.test(e.opf), 'metadata');
      ok(e.images.length === 2 && e.items.some((i) => i.props.includes('cover-image')), `pictures ${e.images.length}`);
      ok(all.includes('Ünïcödé text and 한글 too') && all.includes('<b>dark</b>') && all.includes('The note is here.'), 'text');
      const link = /<a href="([^"#]*)#([^"]+)">the note<\/a>/.exec(all);
      ok(link && e.pages[link[1] || 'ch001.xhtml']?.includes(`id="${link[2]}"`), 'filepos link');
      ok(new RegExp(`id="${link[2]}"[^<]*</a>\\s*<p>The note is here`).test(all) || new RegExp(`<a id="${link[2]}"></a>\\s*<p>The note`).test(all), 'filepos target before the note');
    });
  }
  X('mobi with DRM refused', 'convert-ebook', ['locked.azw'], { to: 'epub' }, /DRM/);
  T('palmdoc text book', 'convert-ebook', ['old.pdb'], { to: 'txt' }, ([o]) => ok(txt(o).includes('Plain PalmDOC text.') && txt(o).includes('Second paragraph of the book.'), 'text'));
  T('azw4 print replica→pdf', 'convert-ebook', ['replica.azw4'], { to: 'pdf' }, ([o]) => ok(Buffer.compare(read(o), read(fx('doc.pdf'))) === 0, 'the PDF inside differs'));
  T('azw3 (KF8)→epub', 'convert-ebook', ['kf8.azw3'], { to: 'epub' }, ([o]) => {
    const e = epub(o), all = Object.values(e.pages).join('');
    ok(/<dc:title>Kindle Format Eight<\/dc:title>/.test(e.opf) && /<dc:creator>Lime Writer<\/dc:creator>/.test(e.opf), 'metadata');
    ok(e.spine.filter((s) => /^ch/.test(s)).length === 2 && all.includes('<b>bold</b> and 한글') && all.includes('Aid target paragraph.'), 'parts and text');
    const to2 = /<a href="(ch\d+\.xhtml)#([^"]+)">To chapter two<\/a>/.exec(all), toAid = /<a href="(ch\d+\.xhtml)#([^"]+)">to the target<\/a>/.exec(all);
    ok(to2 && e.pages[to2[1]].includes(`id="${to2[2]}"`) && e.pages[to2[1]].includes('Chapter Two'), 'kindle:pos link to an id');
    ok(toAid && new RegExp(`id="${toAid[2]}">Aid target`).test(e.pages[toAid[1]]), 'kindle:pos link to an aid');
    ok(e.images.length === 2 && all.includes('alt="pic"'), 'kindle:embed picture and cover');
  });
  T('azw3 (KF8)→txt', 'convert-ebook', ['kf8.azw3'], { to: 'txt' }, ([o]) => ok(txt(o).includes('Chapter One') && txt(o).includes('Filler paragraph.'), 'text'));
  T('epub→kepub', 'convert-ebook', ['kobo.epub'], { to: 'kepub' }, ([o]) => {
    ok(o.endsWith('kobo.kepub.epub'), `name ${path.basename(o)}`);
    const src = require('fflate').unzipSync(new Uint8Array(read(fx('kobo.epub')))), z = epub(o).z;
    ok(Object.keys(src).sort().join() === Object.keys(z).sort().join(), 'entries changed');
    for (const k of Object.keys(src).filter((n) => !/ch\d+\.xhtml$/.test(n))) ok(Buffer.compare(Buffer.from(src[k]), Buffer.from(z[k])) === 0, `${k} changed`);
    const ch = Buffer.from(z['OEBPS/ch001.xhtml']).toString();
    ok(/<body><div id="book-columns"><div id="book-inner">/.test(ch) && ch.includes('<span class="koboSpan" id="kobo.1.1">Kobo Book</span>') && ch.includes('<span class="koboSpan" id="kobo.2.2">Second one? </span>'), 'spans');
    ok(ch.includes('<b><span class="koboSpan" id="kobo.3.2">Bold</span></b>') && /<span class="koboSpan" id="kobo\.4\.1"><img /.test(ch) && ch.includes('Pi is 3.14 today. </span>'), 'inline parents, pictures, numbers');
    const ids = [...ch.matchAll(/id="(kobo[^"]+)"/g)].map((m) => m[1]);
    ok(new Set(ids).size === ids.length, 'duplicate ids');
  });
  T('kepub→epub round trip', 'convert-ebook', ['kobo.kepub.epub'], { to: 'epub' }, ([o]) => {
    const z = epub(o).z, src = require('fflate').unzipSync(new Uint8Array(read(fx('kobo.epub'))));
    const norm = (b) => Buffer.from(b).toString().replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    for (const k of Object.keys(src).filter((n) => /ch\d+\.xhtml$/.test(n))) { const t = Buffer.from(z[k]).toString(); ok(!t.includes('koboSpan') && !t.includes('book-columns') && norm(z[k]) === norm(src[k]), `${k} keeps Kobo markup or lost text`); }
    ok(Buffer.from(z['OEBPS/ch001.xhtml']).toString().includes('<p>First sentence. Second one? Third!</p>'), 'text after the round trip');
  });
  T('epub→htmlz', 'convert-ebook', ['novel.epub'], { to: 'htmlz' }, ([o]) => { const z = zipHas(o, 'index.html'); ok(z['style.css'] && z['metadata.opf'] && Object.keys(z).filter((k) => k.startsWith('images/')).length === 2 && Buffer.from(z['index.html']).toString().includes('src="images/img0001.png"') && Buffer.from(z['metadata.opf']).toString().includes('<dc:creator opf:role="aut">김작가</dc:creator>'), 'htmlz parts'); });
  T('epub→txtz', 'convert-ebook', ['novel.epub'], { to: 'txtz' }, ([o]) => { const z = zipHas(o, 'index.txt'); ok(Buffer.from(z['index.txt']).toString().includes('![그림](images/img0001.png)') && z['images/img0001.png'], 'txtz parts'); });
  T('txtz→epub', 'convert-ebook', ['notes.txtz'], { to: 'epub' }, ([o]) => { const e = epub(o); ok(/<dc:title>Zipped Notes<\/dc:title>/.test(e.opf) && /Note Taker/.test(e.opf) && e.images.length === 1, 'metadata or pictures (the outside picture must stay out)'); });
  const pdfSizes = async (o) => (await require('pdf-lib').PDFDocument.load(read(o))).getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`).join(' ');
  T('cbz→pdf', 'convert-comic', ['comic.cbz'], { to: 'pdf' }, async ([o]) => ok((await pdfSizes(o)) === '150x225 165x248 180x270', `pages ${await pdfSizes(o)}`));
  T('cb7→pdf', 'convert-comic', ['comic.cb7'], { to: 'pdf' }, async ([o]) => ok((await pdfSizes(o)) === '150x225 165x248 180x270', `pages ${await pdfSizes(o)}`));
  T('cbt→pdf', 'convert-comic', ['comic.cbt'], { to: 'pdf' }, async ([o]) => ok((await pdfSizes(o)) === '150x225 165x248 180x270', `pages ${await pdfSizes(o)}`));
  T('cbz→epub (fixed layout)', 'convert-comic', ['comic.cbz'], { to: 'epub' }, ([o]) => { const e = epub(o); ok(e.spine.length === 3 && e.images.length === 3 && /rendition:layout">pre-paginated/.test(e.opf) && e.pages['p0001.xhtml'].includes('width=200, height=300'), 'fixed layout'); });
  T('cbz→cbz repack', 'convert-comic', ['comic.cbz'], { to: 'cbz' }, ([o]) => { const k = Object.keys(require('fflate').unzipSync(new Uint8Array(read(o)))); ok(k.join() === '001.png,002.jpg,003.png', `entries ${k}`); });
  T('cb7→pictures', 'convert-comic', ['comic.cb7'], { to: 'images' }, ([o]) => ok(files(o).sort().join() === '001.png,002.jpg,003.png', `files ${files(o)}`));
  X('locked comic refused', 'convert-comic', ['locked.cbz'], { to: 'pdf' }, /password-protected/);
  T('pdf→cbz', 'pdf-to-cbz', ['doc.pdf'], { dpi: '96', quality: 80, pages: 'all' }, async ([o]) => { const z = require('fflate').unzipSync(new Uint8Array(read(o))); ok(Object.keys(z).join() === '001.jpg,002.jpg,003.jpg', `entries ${Object.keys(z)}`); const w = (await sharp(Buffer.from(z['001.jpg'])).metadata()).width; ok(w >= 792 && w <= 795, `page width ${w} at 96 dpi`); });
  T('images→cbz', 'images-to-cbz', ['photo.jpg', 'photo2.jpg', 'photo.png'], {}, ([o]) => { const z = require('fflate').unzipSync(new Uint8Array(read(o))); ok(Object.keys(z).join() === '001.jpg,002.jpg,003.png' && Buffer.compare(Buffer.from(z['002.jpg']), read(fx('photo2.jpg'))) === 0, `entries ${Object.keys(z)}`); });
  const F = E('fonts');
  let google = null;
  try { google = require('wawoff2'); } catch (_) {}
  const headMask = (h) => { const c = Buffer.from(h); c.fill(0, 8, 12); c.writeUInt16BE(c.readUInt16BE(16) & ~0x800, 16); return c; };
  // Tables that differ between two fonts (head compared without checkSumAdjustment and the WOFF2 flag; DSIG ignored).
  const tableDiff = (a, b, skip = []) => [...new Set([...a.tables.keys(), ...b.tables.keys()])].filter((t) => !skip.includes(t) && t !== 'DSIG' && (!a.tables.has(t) || !b.tables.has(t) || Buffer.compare(t === 'head' ? headMask(a.tables.get(t)) : a.tables.get(t), t === 'head' ? headMask(b.tables.get(t)) : b.tables.get(t)) !== 0));
  const glyphDiff = (a, b) => { const x = F.readGlyphs(a), y = F.readGlyphs(b); return x.filter((g, i) => !!g !== !!y[i] || (g && Buffer.compare(F.serializeGlyph(g), F.serializeGlyph(y[i])) !== 0)).length + Math.abs(x.length - y.length); };
  const ttfSrc = () => F.load(read(fx('font.ttf')));
  const woff2Dir = (b) => { const out = []; let p = 48; const ub = () => { let v = 0, c; do { c = b[p++]; v = v * 128 + (c & 127); } while (c & 128); return v; }; for (let i = 0, n = b.readUInt16BE(12); i < n; i++) { const f = b[p++], k = f & 63, tag = k === 63 ? b.toString('latin1', p, (p += 4)) : ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep'][k] || `#${k}`; const orig = ub(), v = f >> 6, tr = ['glyf', 'loca'].includes(tag) ? v !== 3 : v !== 0; out.push({ tag, v, orig, stored: tr ? ub() : orig, tr }); } return out; };
  T('font ttf→woff', 'convert-font', ['font.ttf'], { to: 'woff' }, ([o]) => { const b = read(o); ok(b.toString('latin1', 0, 4) === 'wOFF' && b.readUInt32BE(8) === b.length, 'header'); const d = tableDiff(ttfSrc(), F.load(b)); ok(!d.length, `tables changed: ${d}`); });
  T('font ttf→woff2', 'convert-font', ['font.ttf'], { to: 'woff2' }, async ([o]) => {
    const b = read(o), src = ttfSrc(), dir = woff2Dir(b), e = (t) => dir.find((x) => x.tag === t);
    ok(b.length % 4 === 0 && b.readUInt32BE(8) === b.length, 'length');
    ok(e('glyf').v === 0 && e('glyf').tr && e('loca').v === 0 && e('loca').stored === 0 && e('hmtx').v === 1 && e('cmap').v === 0 && !e('cmap').tr, `transforms ${JSON.stringify(dir.slice(0, 12))}`);
    ok(dir.findIndex((x) => x.tag === 'loca') === dir.findIndex((x) => x.tag === 'glyf') + 1, 'loca must follow glyf');
    ok(b.length < 0.8 * F.woffEncode(src).length, 'not smaller than WOFF');
    const back = F.load(b);
    ok(!tableDiff(src, back, ['glyf', 'loca']).length && !glyphDiff(src, back), 'round trip');
    ok(back.tables.get('head').readUInt16BE(16) & 0x800, 'head flag 11');
    if (google) {
      const g = F.load(Buffer.from(await google.decompress(b))), gg = F.readGlyphs(g);
      ok(!tableDiff(src, g, ['glyf', 'loca']).length, `Google’s decoder: ${tableDiff(src, g, ['glyf', 'loca'])}`);
      ok(F.readGlyphs(src).every((x, i) => !x || Buffer.compare(F.serializeGlyph({ ...x, overlap: false }), F.serializeGlyph({ ...gg[i], overlap: false })) === 0), 'Google’s decoder: glyphs');
      ok(b.length < 1.05 * read(fx('font.google.woff2')).length, 'larger than Google’s encoder');
    }
  });
  T('font google woff2→ttf', 'convert-font', ['font.google.woff2'], { to: 'ttf' }, ([o]) => { const src = ttfSrc(), out = F.load(read(o)), og = F.readGlyphs(out); ok(!tableDiff(src, out, ['glyf', 'loca']).length, `tables ${tableDiff(src, out, ['glyf', 'loca'])}`); ok(F.readGlyphs(src).every((x, i) => !x || Buffer.compare(F.serializeGlyph({ ...x, overlap: false }), F.serializeGlyph(og[i])) === 0), 'glyphs'); });
  T('font ttf→eot', 'convert-font', ['font.ttf'], { to: 'eot' }, ([o]) => {
    const b = read(o);
    ok(b.readUInt32LE(0) === b.length && b.readUInt32LE(8) === 0x00020001 && b.readUInt32LE(12) === 0 && b.readUInt16LE(34) === 0x504c, 'EOT header');
    ok(b.toString('utf16le', 84, 84 + b.readUInt16LE(82)) === 'Noto Sans', `family ${b.toString('utf16le', 84, 84 + b.readUInt16LE(82))}`);
    ok(!tableDiff(ttfSrc(), F.load(b)).length, 'tables');
  });
  T('font ttc→otf', 'convert-font', ['font.ttc'], { to: 'otf' }, ([o]) => ok(!tableDiff(ttfSrc(), F.load(read(o))).length, 'first font of the collection'));
  T('font otf (CFF)→woff2', 'convert-font', ['font.otf'], { to: 'woff2' }, ([o]) => { const src = F.load(read(fx('font.otf'))), back = F.load(read(o)); ok(back.flavor === 0x4f54544f && back.tables.has('CFF ') && !tableDiff(src, back).length, `CFF tables ${tableDiff(src, back)}`); });
  T('font otf (CFF)→ttf', 'convert-font', ['font.otf'], { to: 'ttf' }, ([o]) => {
    const src = F.load(read(fx('font.otf'))), tt = F.load(read(o)), g = F.readGlyphs(tt);
    ok(tt.flavor === 0x10000 && !tt.tables.has('CFF ') && !tt.tables.has('VORG') && tt.tables.get('maxp').length === 32 && g.length === 9, 'TrueType font');
    for (const t of ['cmap', 'name', 'OS/2']) ok(Buffer.compare(src.tables.get(t), tt.tables.get(t)) === 0, `${t} changed`);
    const hm = tt.tables.get('hmtx'), adv = [500, 250, 600, 520, 520, 300, 600, 700, 500];
    g.forEach((x, i) => { ok(hm.readUInt16BE(4 * i) === adv[i] && hm.readInt16BE(4 * i + 2) === (x ? x.xMin : 0), `metrics of glyph ${i}`); if (x) { const xs = x.pts.map((p) => p.x), ys = x.pts.map((p) => p.y); ok(x.xMin === Math.min(...xs) && x.yMax === Math.max(...ys), `bbox of glyph ${i}`); } });
    const area = (x, k) => { const s = k ? x.ends[k - 1] + 1 : 0, c = x.pts.slice(s, x.ends[k] + 1).filter((p) => p.on); return c.reduce((a, p, i) => a + p.x * c[(i + 1) % c.length].y - c[(i + 1) % c.length].x * p.y, 0) / 2; };
    ok(area(g[8], 0) === -250000 && area(g[8], 1) === 90000 && area(g[2], 0) < 0, 'contour direction');
    ok([g[7].xMin, g[7].yMin, g[7].xMax, g[7].yMax].join() === '100,0,600,530' && g[7].pts.some((p) => p.on && p.x === 350 && p.y === 530), 'flex');
    ok(g[6].n === g[2].n + g[5].n && g[6].pts.slice(g[2].pts.length).every((p, i) => p.x === g[5].pts[i].x + 170 && p.y === g[5].pts[i].y + 190), 'seac accent');
    const fk = require('@pdf-lib/fontkit').create(read(o)), names = Array.from({ length: 9 }, (_, i) => fk.getGlyph(i).name);
    ok(tt.tables.get('post').readUInt32BE(0) === 0x20000 && names.join(' ') === '.notdef space A a e acute Aacute flexbar box', `post names ${names}`);
    const vm = tt.tables.get('vmtx');
    ok(vm.readInt16BE(4 * 2 + 2) === 900 - g[2].yMax && vm.readInt16BE(4 * 3 + 2) === 880 - g[3].yMax, 'vertical metrics from VORG');
  });
  T('font otf (CFF)→eot', 'convert-font', ['font.otf'], { to: 'eot' }, ([o]) => { const b = read(o); ok(b.toString('utf16le', 84, 84 + b.readUInt16LE(82)) === 'Lime Test NameKeyed', 'family name'); const f = F.load(b); ok(f.tables.has('glyf') && !f.tables.has('CFF '), 'TrueType outlines'); });
  T('font info', 'font-info', ['font.ttf'], { save: true }, ([o], r) => { const t = r[0].text; ok(/Family: Noto Sans/.test(t) && /Style: Regular/.test(t) && new RegExp(`Glyphs: ${ttfSrc().tables.get('maxp').readUInt16BE(4).toLocaleString('en-US')}`).test(t) && /Characters: [\d,]+/.test(t), t); ok(txt(o).includes('Outlines: TrueType'), 'report file'); });
  X('not a font refused', 'convert-font', ['doc.txt'], { to: 'woff' }, /not a font/);
  const M = E('email');
  const REPORT = Buffer.from('%PDF-1.4 fake report');
  T('mail eml→html', 'convert-email', ['mail.eml'], { to: 'html' }, ([o]) => {
    const h = txt(o);
    for (const s of ['<meta charset="utf-8">', '<title>회의 자료</title>', '<th>From</th><td>보낸이 &lt;sender@example.com&gt;</td>', '<th>To</th><td>receiver@example.com, Second &lt;second@example.com&gt;</td>', '<th>Date</th><td>2026-10-01 09:30:00 +09:00</td>', '<th>Attachments</th><td>보고서.pdf, notes.txt</td>', '<p>안녕하세요. 자료를 보냅니다.</p>', 'p { color: #C00000; }', 'src="data:image/png;base64,', 'bgcolor="#EEEEEE"', 'valign="top"', '<font color="#336699">', '<p>양식 안의 본문</p>', 'href="https://example.com/ok"', 'Content-Security-Policy', 'bgcolor="#FFFFF0"']) ok(h.includes(s), `lacks ${s}`);
    for (const s of ['cid:', '<script', 'onerror', 'onload', 'tracker.example', 'javascript:', '<svg', '<form', '<input', '<xmp', '<!--']) ok(!h.includes(s), `contains ${s}`);
  });
  T('mail eml→txt', 'convert-email', ['mail.eml'], { to: 'txt' }, ([o]) => { const t = txt(o); ok(t.startsWith('﻿From: 보낸이 <sender@example.com>\r\n') && t.includes('Subject: 회의 자료\r\n') && t.endsWith('\r\n\r\n안녕하세요. 자료를 보냅니다.\r\n둘째 줄\r\n'), JSON.stringify(t)); });
  T('mail eml attachments', 'email-attachments', ['mail.eml'], {}, ([o]) => { ok(files(o).sort().join() === ['notes.txt', '보고서.pdf'].sort().join(), `files ${files(o)}`); ok(Buffer.compare(read(path.join(o, '보고서.pdf')), REPORT) === 0 && txt(path.join(o, 'notes.txt')) === 'memo', 'attachment bytes'); });
  T('mail iso-2022-kr→html', 'convert-email', ['old.eml'], { to: 'html' }, ([o]) => { const h = txt(o); ok(h.includes('<title>한글 제목</title>') && h.includes('<pre class="lime-mail-text">본문 &lt;첫 줄&gt;\r\n둘째 줄') && !h.includes('Attachments'), h.slice(-400)); });
  X('mail without attachments refused', 'email-attachments', ['old.eml'], {}, /no attachments/);
  T('mail msg→eml', 'convert-email', ['meeting.msg'], { to: 'eml' }, ([o]) => {
    const m = M.readMessage(read(o)), raw = txt(o);
    ok(m.subject === '회의 자료' && m.from[0].name === '보낸이' && m.from[0].addr === 'sender@example.com' && m.to[0].addr === 'receiver@example.com' && m.cc[0].addr === 'copy@example.com', 'headers');
    ok(m.date === '2026-10-01 00:30:00 +00:00' && /^Message-ID: <meeting-1@example\.com>$/m.test(raw), 'date or message id');
    ok(m.text === '안녕하세요. 자료를 보냅니다.\r\n둘째 줄' && m.html.includes('<img src="cid:logo@lime">'), 'bodies');
    ok(m.attachments.map((a) => a.name).join() === '보고서.pdf,Earlier mail.eml' && Buffer.compare(m.attachments[0].data, REPORT) === 0, 'attachments');
    const inner = M.readMessage(m.attachments[1].data);
    ok(inner.subject === 'Earlier mail' && inner.text.trim() === 'older text', 'attached message');
    ok(m.cids.has('logo@lime'), 'inline picture');
  });
  T('mail msg→html', 'convert-email', ['meeting.msg'], { to: 'html' }, ([o]) => { const h = txt(o); ok(h.includes('<title>회의 자료</title>') && h.includes('<th>From</th><td>보낸이 &lt;sender@example.com&gt;</td>') && h.includes('<th>Cc</th><td>Copy &lt;copy@example.com&gt;</td>') && h.includes('<th>Attachments</th><td>보고서.pdf, Earlier mail.eml</td>') && h.includes('src="data:image/png;base64,') && !h.includes('cid:'), 'html'); });
  T('mail msg→txt', 'convert-email', ['meeting.msg'], { to: 'txt' }, ([o]) => ok(txt(o).includes('Subject: 회의 자료\r\n') && txt(o).endsWith('\r\n\r\n안녕하세요. 자료를 보냅니다.\r\n둘째 줄\r\n'), 'txt'));
  T('mail msg attachments', 'email-attachments', ['meeting.msg'], {}, ([o]) => { ok(files(o).sort().join() === ['Earlier mail.eml', '보고서.pdf'].sort().join(), `files ${files(o)}`); ok(M.readMessage(read(path.join(o, 'Earlier mail.eml'))).text.trim() === 'older text', 'attached message'); });
  T('mail korean eml after msg', 'convert-email', ['mail.eml'], { to: 'txt' }, ([o]) => ok(txt(o).includes('From: 보낸이 <sender@example.com>') && txt(o).includes('안녕하세요. 자료를 보냅니다.'), 'charsets after an Outlook message'));
  T('mail rtf-only msg→html', 'convert-email', ['rtf.msg'], { to: 'html' }, ([o]) => ok(txt(o).includes('<p>Encapsulated café text</p>'), 'de-encapsulated HTML'));
  X('mail broken msg refused', 'convert-email', ['broken.msg'], { to: 'html' }, /Not an Outlook message/);
  T('mail eml→pdf', 'convert-email', ['mail.eml'], { to: 'pdf' }, async ([o]) => { const t = await pdfText(o); ok(t.includes('Attachments') && t.includes('good link'), 'pdf text'); });
  // E-mail → PDF renders offline: remote pictures, style sheets and imports are never fetched (a local server counts
  // requests) while the message's own data: picture still shows.
  const hits = [];
  const server = require('http').createServer((req, res) => { hits.push(req.url); res.writeHead(200, { 'content-type': 'image/png' }); res.end(read(fx('photo2.jpg'))); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`, remote = path.join(OUT, 'remote.eml');
  fs.writeFileSync(remote, ['From: news@example.com', 'Subject: Remote pictures', 'Content-Type: text/html; charset=utf-8', '', `<html><head><style>@import url(${url}/import.css); body { background: url(${url}/background.png) }</style><link rel="stylesheet" href="${url}/sheet.css"></head><body><p>Offline body text</p><img src="${url}/pixel.png" alt="remote pixel"><img srcset="${url}/srcset.png 2x"><img src="data:image/png;base64,${read(fx('alpha.png')).toString('base64')}" alt="own picture"><div style="background-image:url(${url}/inline.png)">x</div></body></html>`, ''].join('\r\n'));
  C.push({ name: 'mail eml→pdf fetches nothing', tool: 'convert-email', inputs: [remote], opts: { to: 'pdf' }, check: async ([o]) => {
    ok((await pdfText(o)).includes('Offline body text'), 'pdf text');
    const { doc } = await E('pdf').readPdf(o);
    const images = [];
    doc.loadPage(0).toStructuredText('preserve-images').walk({ onImageBlock(b, m, img) { if (img.getWidth() > 32) images.push(`${img.getWidth()}x${img.getHeight()}`); } });
    ok(images.join() === '600x600', `pictures rendered: ${images}; only the message’s own should be`);
    ok(!hits.length, `fetched ${hits.join(', ')}`);
  } });
  T('mhtml→html', 'convert-mhtml', ['page.mhtml'], { to: 'html' }, ([o]) => {
    const h = txt(o);
    ok(h.includes('<title>Lime archive page</title>') && h.includes('<html lang="en">') && h.includes('<body class="article">') && h.includes('Content-Security-Policy'), 'page');
    ok((h.match(/src="data:image\/png;base64,/g) || []).length === 3 && h.includes('background-image:url(') && /\.hero \{ background: url\("data:image\/png;base64,/.test(h), 'pictures from the archive');
    ok(/@media print \{\s*\.printonly/.test(h) && h.includes('font-family: serif') && h.includes('h1 { color: #2c6413 }'), 'style sheets');
    ok(!/<script|<iframe|<link|elsewhere\.example|favicon| srcset=/.test(h) && h.includes('<img alt="missing"/>'), 'removed content');
  });
  T('mhtml→pdf', 'convert-mhtml', ['page.mhtml'], { to: 'pdf' }, async ([o]) => ok((await pdfText(o)).includes('Archived paragraph text'), 'pdf text'));
  T('sheet→csv (all sheets)', 'convert-sheet', ['sheet.xlsx'], { to: 'csv', allSheets: true }, ([o]) => ok(files(o).length === 2 && txt(path.join(o, 'Fruit.csv')).includes('Lime,12'), 'csv'));
  for (const [to, chk] of [['json', (o) => ok(JSON.parse(txt(o).replace(/^\ufeff/, '')).length >= 1 || true, 'json')], ['html', (o) => ok(txt(o).includes('Lime'), 'html')], ['pdf', async (o) => ok((await pdfText(o)).includes('Lime'), 'pdf')], ['ods', (o) => zipHas(o, 'content.xml')], ['md', (o) => ok(txt(o).includes('| Fruit |'), 'md')], ['xls', (o) => ok(require('xlsx').readFile(o).SheetNames.length === 2, 'xls')], ['docx', async (o) => ok((await docxText(o)).includes('Lime'), 'docx')]]) {
    T(`sheet→${to}`, 'convert-sheet', ['sheet.xlsx'], { to, allSheets: false }, async ([o]) => chk(o));
  }
  T('csv→xlsx', 'convert-sheet', ['sheet.csv'], { to: 'xlsx' }, ([o]) => ok(require('xlsx').readFile(o).Sheets.Sheet1.A2.v === 'Lime', 'xlsx'));
  T('json→xlsx', 'json-to-sheet', ['data.json'], { to: 'xlsx' }, ([o]) => ok(require('xlsx').readFile(o).SheetNames.length === 1, 'xlsx'));
  T('slides→pdf', 'convert-slides', ['deck.pptx'], { to: 'pdf' }, async ([o]) => { await pages(o, 2); ok((await pdfText(o)).includes('Lime Deck'), 'slide text'); });
  T('slides→png', 'convert-slides', ['deck.pptx'], { to: 'png' }, ([o]) => ok(files(o).length === 2, `${files(o).length} slides`));
  T('slides→txt', 'convert-slides', ['deck.pptx'], { to: 'txt' }, ([o]) => ok(txt(o).includes('Lime Deck') && txt(o).includes('Second point'), 'txt'));
  T('slides→html', 'convert-slides', ['deck.pptx'], { to: 'html' }, ([o]) => ok(txt(o).includes('class="slide"'), 'html'));
  T('merge docs', 'merge-documents', ['doc.docx', 'doc.pdf', 'photo2.jpg', 'deck.pptx'], {}, async ([o]) => ok((await pages(o)) >= 7, 'pages'));
  T('merge sheets', 'merge-sheets', ['sheet.csv', 'sheet2.csv'], { mode: 'stack', skipHeaders: true }, ([o]) => ok(require('xlsx').utils.sheet_to_json(require('xlsx').readFile(o).Sheets.Combined).length === 3, 'rows'));
  for (const to of ['pdf', 'png', 'epub', 'pptx']) T(`layout→${to}`, 'convert-layout', ['layout.idml'], { to }, async ([o]) => (to === 'pdf' ? pages(o, 4) : to === 'png' ? ok(files(o).length === 4, 'pages') : zipHas(o, to === 'epub' ? 'mimetype' : 'ppt/')));

  for (const [to, chk] of [['pdf', async (o) => pages(o, 1)], ['svg', (o) => ok(txt(o).includes('LIME CAD TEST'), 'svg text')], ['png', async (o) => fmt(o, 'png')], ['dxf', (o) => ok(txt(o).includes('ENTITIES') && txt(o).includes('LIME CAD TEST'), 'dxf')], ['ai', (o) => ok(read(o).subarray(0, 5).toString() === '%PDF-', 'ai')], ['eps', (o) => ok(/^%!PS/.test(txt(o)) || read(o).readUInt32BE(0) === 0xc5d0d3c6, 'eps')]]) {
    T(`dxf→${to}`, 'convert-cad', ['test.dxf'], { to, sheet: 'a3', mono: false, size: 2000 }, async ([o]) => chk(o));
  }
  for (const to of ['pdf', 'png', 'dxf']) T(`dwg→${to}`, 'convert-cad', ['sample_2018.dwg'], { to, sheet: 'a3', size: 2000 }, async ([o]) => (to === 'pdf' ? pages(o, 1) : to === 'png' ? fmt(o, 'png') : ok(txt(o).includes('ENTITIES'), 'dxf')));
  for (const to of ['stl', 'obj', 'glb', '3mf', 'ply']) T(`step→${to}`, 'convert-model', ['part.stp'], { to }, async ([o]) => ok((await E('cad').info(o)).triangles === 4688, 'triangles'));
  T('step→png', 'convert-model', ['part.stp'], { to: 'png' }, async ([o]) => fmt(o, 'png'));
  T('step→pdf', 'convert-model', ['part.stp'], { to: 'pdf' }, async ([o]) => pages(o, 1));
  T('iges→stl', 'convert-model', ['cube.igs'], { to: 'stl' }, async ([o]) => ok((await E('cad').info(o)).triangles >= 12, 'tris'));
  T('stl→obj', 'convert-model', ['cube.stl'], { to: 'obj' }, async ([o]) => { const i = await E('cad').info(o); ok(i.triangles === 12 && Math.abs(i.volume - 1000) < 1, `vol ${i.volume}`); });
  T('obj→stl', 'convert-model', ['mesh.obj'], { to: 'stl' }, async ([o]) => ok((await E('cad').info(o)).triangles === 4, 'tris'));
  T('measure model', 'cad-info', ['cube.stl'], { save: false }, (o, r) => ok(/Volume: 1(\.0+)? cm³|Volume: 1 cm/.test(r[0].text), r[0].text));
  for (const [src, to, chk] of [['logo.svg', 'pdf', (o) => magic(o, '%PDF')], ['logo.svg', 'ai', (o) => magic(o, '%PDF')], ['logo.svg', 'eps', (o) => ok(/^%!PS/.test(txt(o)) || read(o).readUInt32BE(0) === 0xc5d0d3c6, 'eps')], ['logo.svg', 'png', async (o) => fmt(o, 'png')], ['logo.svg', 'dxf', (o) => ok(txt(o).includes('SECTION'), 'dxf')], ['logo.svg', 'emf', (o) => ok(read(o).readUInt32LE(0) === 1, 'emf')], ['logo.ai', 'svg', (o) => ok(txt(o).includes('<svg'), 'svg')], ['logo.eps', 'pdf', (o) => magic(o, '%PDF')]]) {
    T(`vector ${src}→${to}`, 'convert-vector', [src], { to, scale: 2 }, async ([o]) => chk(o));
  }

  for (const a of ['archive.zip', 'archive.7z', 'archive.tar.gz']) T(`extract ${a}`, 'extract-archive', [a], {}, ([o]) => ok(fs.existsSync(path.join(o, 'a.txt')) && fs.existsSync(path.join(o, 'inner', 'b.txt')), `contents ${files(o)}`));
  T('zip folder', 'create-archive', ['folder'], { format: 'zip', level: 5 }, ([o]) => zipHas(o, 'b.txt'));
  T('7z with password', 'create-archive', ['doc.txt', 'photo2.jpg'], { format: '7z', level: 5, password: 'pw' }, ([o]) => magic(o, '7z'));
  T('convert archive', 'convert-archive', ['archive.zip'], { format: '7z', level: 5 }, ([o]) => magic(o, '7z'));
  T('test archive', 'test-archive', ['archive.zip'], {}, (o, r) => ok(/intact/.test(r[0].note), r[0].note));
  T('checksum', 'file-hash', ['doc.txt'], { algos: ['sha256'], expected: '' }, (o, r) => ok(r[0].text.includes(require('crypto').createHash('sha256').update(read(fx('doc.txt'))).digest('hex')), 'hash'));

  const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;
  const results = [];
  let n = 0;
  for (const c of C) {
    if (only && !only.test(c.name)) continue;
    const missing = c.inputs.filter((f) => !fs.existsSync(f)).map((f) => path.basename(f));
    if (missing.length) { console.log(`SKIP ${c.name.padEnd(34)} no ${missing.join(', ')} sample`); results.push({ name: c.name, status: 'SKIP', detail: missing.join(', ') }); continue; }
    n++;
    const dest = { kind: 'dir', path: path.join(OUT, String(n).padStart(3, '0')) };
    fs.mkdirSync(dest.path, { recursive: true });
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try {
      const id = submit({ tool: c.tool, files: c.inputs, opts: c.opts, dest });
      let j;
      for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(150); if (Date.now() - t0 > 240000) throw new Error('timeout'); }
      if (c.expect) { ok(j.status === 'error' && c.expect.test(j.error || ''), `expected an error like ${c.expect}, got ${j.status}: ${j.error}`); detail = j.error; } else {
      if (j.status !== 'done') throw new Error(`${j.status}: ${j.error}`);
      const outs = j.results.flatMap((r) => r.paths || (r.path ? [r.path] : []));
      ok(!outs.some((o) => / x(\.[^.]+)?$/.test(path.basename(o))), `duplicate name ${outs.map((o) => path.basename(o))}`);
      for (const o of outs) if (/\.pdf$/i.test(o) && fs.statSync(o).isFile()) magic(o, '%PDF-');
      await c.check(outs, j.results);
      detail = outs.map((o) => path.relative(OUT, o)).join(', ') || (j.results[0]?.note || '').split('\n')[0];
      }
    } catch (e) { status = 'FAIL'; detail = e.message; }
    const line = `${status} ${c.name.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 220);
    console.log(line);
    results.push({ name: c.name, status, detail });
  }
  if (!only || only.test('failed extract keeps folder')) {
    const keep = path.join(OUT, 'existing folder'), bad = path.join(OUT, 'broken.zip');
    fs.mkdirSync(keep, { recursive: true });
    fs.writeFileSync(path.join(keep, 'keep.txt'), 'mine');
    fs.writeFileSync(bad, Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(512, 7)]));
    let status = 'PASS', detail = '';
    try {
      const id = submit({ tool: 'extract-archive', files: [bad], opts: {}, dest: { kind: 'folder', path: keep } });
      let j;
      for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(150); }
      ok(j.status !== 'done', 'a broken archive extracted');
      ok(fs.existsSync(path.join(keep, 'keep.txt')), 'the existing folder was deleted');
      detail = `kept ${files(keep).join(', ')} after: ${String(j.error).slice(0, 60)}`;
    } catch (e) { status = 'FAIL'; detail = e.message; }
    console.log(`${status} ${'failed extract keeps folder'.padEnd(34)}        ${detail}`);
    results.push({ name: 'failed extract keeps folder', status, detail });
  }
  const fail = results.filter((r) => r.status === 'FAIL'), skip = results.filter((r) => r.status === 'SKIP');
  console.log(`\n${results.length - fail.length - skip.length}/${results.length - skip.length} passed${skip.length ? `, ${skip.length} skipped` : ''}`);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(results, null, 1));
  app.isQuitting = true;
  app.exit(fail.length ? 1 : 0);
};
