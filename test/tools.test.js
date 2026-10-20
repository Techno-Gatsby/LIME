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
  const F = (name, tool, inputs, opts, fail) => C.push({ name, tool, inputs: inputs.map(fx), opts, fail });
  const XLSX = require('xlsx');
  const sheet0 = (o) => { const wb = XLSX.readFile(o); return wb.Sheets[wb.SheetNames[0]]; };
  const cell = (ws, a) => (ws[a] ? `${ws[a].t}:${ws[a].v}` : '');
  const bom = (p) => read(p).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const utf = (p) => txt(p).replace(/^\ufeff/, '');
  const same = (a, b, m) => ok(a === b, `${m || 'output'} differs: ${JSON.stringify(a).slice(0, 400)}`);
  const has = (t, ...parts) => { for (const s of parts) ok(t.includes(s), `lacks ${JSON.stringify(s).slice(0, 120)} in ${JSON.stringify(t).slice(0, 300)}`); };
  const ms = (h, m, s, f) => ((+h * 60 + +m) * 60 + +s) * 1000 + +f;
  const srtCues = (t) => [...t.replace(/^\ufeff/, '').matchAll(/(\d+):(\d\d):(\d\d)[,.](\d{3}) --> (\d+):(\d\d):(\d\d)[,.](\d{3})\r?\n([\s\S]*?)(?:\r?\n\r?\n|$)/g)].map((m) => [ms(m[1], m[2], m[3], m[4]), ms(m[5], m[6], m[7], m[8]), m[9].replace(/\r\n/g, '\n')]);
  const sevenZip = (args) => require('child_process').execFileSync(E('util').binPath('7z'), args, { maxBuffer: 1 << 28 });
  const tarNames = (b) => { const n = []; for (let i = 0; i + 512 <= b.length;) { const name = b.toString('utf8', i, i + 100).replace(/\0[\s\S]*$/, ''); if (!name) break; n.push(name.replace(/^\.\//, '')); i += 512 + Math.ceil((parseInt(b.toString('latin1', i + 124, i + 136), 8) || 0) / 512) * 512; } return n; };
  const entries = async (o) => (await E('archive').list(o)).map((e) => e.path.split(path.sep).join('/')).sort();
  const isLink = (p) => fs.lstatSync(p).isSymbolicLink();
  const walk = (d) => fs.readdirSync(d, { recursive: true }).map((x) => x.split(path.sep).join('/')).sort();

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
  T('sheet→csv (all sheets)', 'convert-sheet', ['sheet.xlsx'], { to: 'csv', allSheets: true }, ([o]) => ok(files(o).length === 2 && txt(path.join(o, 'Fruit.csv')).includes('Lime,12'), 'csv'));
  for (const [to, chk] of [['json', (o) => ok(JSON.parse(txt(o).replace(/^﻿/, '')).length >= 1 || true, 'json')], ['html', (o) => ok(txt(o).includes('Lime'), 'html')], ['pdf', async (o) => ok((await pdfText(o)).includes('Lime'), 'pdf')], ['ods', (o) => zipHas(o, 'content.xml')], ['md', (o) => ok(txt(o).includes('| Fruit |'), 'md')], ['xls', (o) => ok(require('xlsx').readFile(o).SheetNames.length === 2, 'xls')], ['docx', async (o) => ok((await docxText(o)).includes('Lime'), 'docx')]]) {
    T(`sheet→${to}`, 'convert-sheet', ['sheet.xlsx'], { to, allSheets: false }, async ([o]) => chk(o));
  }
  T('csv→xlsx', 'convert-sheet', ['sheet.csv'], { to: 'xlsx' }, ([o]) => { const wb = XLSX.readFile(o); ok(wb.SheetNames[0] === 'sheet' && cell(wb.Sheets.sheet, 'A2') === 's:Lime' && cell(wb.Sheets.sheet, 'B2') === 'n:12', 'xlsx'); });
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

  // Data formats (JSON, JSONC, JSON Lines, YAML, TOML, XML, CSV) through one tree; vectors from Filee's tests.
  T('data json→yaml', 'convert-data', ['sample.json'], { to: 'yaml' }, ([o]) => { ok(!bom(o), 'BOM'); same(txt(o), 'name: Filee 변환기\nversion: 3\nratio: 3.0\nbig: 12345678901234567890\nenabled: true\nmissing: null\nnotes: |-\n  first line\n  second line\nlooksLikeABoolean: "true"\nlooksLikeANumber: "007"\nempty: ""\ntags:\n  - a\n  - b\nnothing: []\nowner:\n  id: 1\n  email: me@example.com\nrows:\n  - x: 1\n  - x: 2\n'); });
  T('data json→toml', 'convert-data', ['sample.json'], { to: 'toml' }, ([o]) => {
    const t = txt(o);
    ok(!t.includes('missing'), 'null kept');
    has(t, 'big = "12345678901234567890"\n', 'ratio = 3.0\n', '\n[owner]\nid = 1\n', '\n[[rows]]\nx = 1\n\n[[rows]]\nx = 2\n');
    const back = require('smol-toml').parse(t, { integersAsBigInt: true });
    ok(back.name === 'Filee 변환기' && back.version === 3n && back.rows.length === 2, 'TOML reads back');
  });
  T('data json→xml', 'convert-data', ['sample.json'], { to: 'xml' }, ([o]) => { const t = txt(o); ok(t.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<root>\n  <name>Filee 변환기</name>\n'), t.slice(0, 80)); has(t, '  <missing />\n', '  <empty></empty>\n', '  <tags>a</tags>\n  <tags>b</tags>\n', '  <ratio>3.0</ratio>\n'); });
  T('data yaml→json merge keys', 'convert-data', ['config.yml'], { to: 'json' }, ([o]) => {
    const t = txt(o);
    has(t, '  "development": {\n    "adapter": "postgres",\n    "port": 5433,\n    "database": "dev"\n  },', '  "flags": [\n    "yes",\n    "no",\n    "on",\n    null,\n    31,\n    15,\n    "Infinity",\n    -1500.0,\n    "42"\n  ],', '"when": "2026-10-16"');
    ok(!t.includes('comments'), 'comment kept');
  });
  F('data yaml alias bomb refused', 'convert-data', ['bomb.yaml'], { to: 'json' }, /too many values/);
  T('data toml→json dates', 'convert-data', ['config.toml'], { to: 'json' }, ([o]) => has(txt(o), '"title": "TOML 예제"', '"released": "1979-05-27T07:32:00-08:00"', '"day": "2026-10-16"', '"limits": {\n      "cpu": 2.5,\n      "memory": "1G"\n    }', '"products": [\n    {\n      "name": "Hammer",\n      "sku": 738594937\n    },'));
  T('data toml→yaml', 'convert-data', ['config.toml'], { to: 'yaml' }, ([o]) => has(txt(o), 'released: 1979-05-27T07:32:00-08:00\n', 'products:\n  - name: Hammer\n    sku: 738594937\n  - name: Nail\n'));
  T('data xml→json attributes', 'convert-data', ['catalog.xml'], { to: 'json' }, ([o]) => same(txt(o), '{\n  "catalog": {\n    "@xmlns:dc": "http://purl.org/dc/elements/1.1/",\n    "@version": "2",\n    "book": [\n      {\n        "@id": "b1",\n        "@lang": "ko",\n        "dc:title": "한국어 책",\n        "price": {\n          "@currency": "KRW",\n          "#text": "15000"\n        },\n        "note": null,\n        "summary": "",\n        "body": "a < b"\n      },\n      {\n        "@id": "b2",\n        "dc:title": "Second"\n      }\n    ]\n  }\n}\n'));
  T('data xml→yaml namespaces', 'convert-data', ['feed.xml'], { to: 'yaml' }, ([o]) => same(txt(o), "feed:\n  '@xmlns': http://www.w3.org/2005/Atom\n  '@xml:lang': ko\n  title: 소식\n  entry:\n    id: \"1\"\n"));
  T('data euc-kr xml→json', 'convert-data', ['memo-euckr.xml'], { to: 'json' }, ([o]) => same(txt(o), '{\n  "memo": {\n    "to": "홍길동"\n  }\n}\n'));
  T('data json→xml names', 'convert-data', ['names.json'], { to: 'xml' }, ([o]) => has(txt(o), '<first_x0020_name>Ada</first_x0020_name>', '<_x0031_st>1</_x0031_st>', '<list>\n    <item>1</item>\n    <item>2</item>\n  </list>'));
  T('data csv→json typed', 'convert-data', ['people.csv'], { to: 'json' }, ([o]) => same(txt(o), '[\n  {\n    "name": "홍길동",\n    "zip": "01234",\n    "age": 42,\n    "member": true,\n    "score": 3.5\n  },\n  {\n    "name": "Kim, Ada",\n    "zip": "",\n    "age": 7,\n    "member": false,\n    "score": ""\n  }\n]\n'));
  T('data json→csv records', 'convert-data', ['users.json'], { to: 'csv' }, ([o]) => { ok(bom(o), 'CSV needs a BOM'); same(utf(o), 'id,address.city,vip\r\n1,Seoul,\r\n2,,true\r\n'); });
  F('data csv refuses lists', 'convert-data', ['nested.json'], { to: 'csv' }, /“tags” holds a list: CSV holds a table/);
  T('data jsonl→json', 'convert-data', ['events.jsonl'], { to: 'json' }, ([o]) => same(txt(o), '[\n  {\n    "a": 1\n  },\n  {\n    "a": 2,\n    "b": "한"\n  }\n]\n'));
  T('data csv→jsonl', 'convert-data', ['people.csv'], { to: 'jsonl' }, ([o]) => same(txt(o), '{"name":"홍길동","zip":"01234","age":42,"member":true,"score":3.5}\n{"name":"Kim, Ada","zip":"","age":7,"member":false,"score":""}\n'));
  F('data broken jsonl refused', 'convert-data', ['broken.jsonl'], { to: 'json' }, /Line 2 is not valid JSON/);
  T('data json with BOM→xlsx', 'json-to-sheet', ['bom.json'], { to: 'xlsx' }, ([o]) => { const ws = sheet0(o); same([cell(ws, 'A1'), cell(ws, 'A2'), cell(ws, 'B2'), cell(ws, 'C2'), cell(ws, 'D2'), cell(ws, 'D3')].join('|'), 's:name|s:Lime|n:12|s:12345678901234567890|s:01234|s:00501'); });
  T('data jsonl→xlsx', 'convert-data', ['events.jsonl'], { to: 'xlsx' }, ([o]) => { const ws = sheet0(o); same([cell(ws, 'A1'), cell(ws, 'B1'), cell(ws, 'A3'), cell(ws, 'B3')].join('|'), 's:a|s:b|n:2|s:한'); });

  // CSV / TSV: encoding and delimiter detected, text stays text.
  const korean = ([o]) => { const ws = sheet0(o); same([cell(ws, 'A1'), cell(ws, 'A2'), cell(ws, 'B2'), cell(ws, 'C2')].join('|'), 's:이름|s:홍길동|n:42|s:안녕, 세상'); };
  T('csv utf-8 without BOM→xlsx', 'convert-sheet', ['korean.csv'], { to: 'xlsx' }, korean);
  T('csv cp949→xlsx', 'convert-sheet', ['korean-cp949.csv'], { to: 'xlsx' }, korean);
  T('csv cp949→html', 'convert-sheet', ['korean-cp949.csv'], { to: 'html' }, ([o]) => has(txt(o), '홍길동', '안녕, 세상'));
  T('csv keeps zeros and fractions', 'convert-sheet', ['zeros.csv'], { to: 'xlsx' }, ([o]) => { const ws = sheet0(o); same([cell(ws, 'B2'), cell(ws, 'C2'), cell(ws, 'D2'), cell(ws, 'B3'), cell(ws, 'C3'), cell(ws, 'D3')].join('|'), 's:01234|s:1/2|s:2026-10-16|s:007|n:3.5|s:1/2/2026'); });
  T('csv semicolons and decimal commas', 'convert-sheet', ['semicolon.csv'], { to: 'xlsx' }, ([o]) => { const ws = sheet0(o); same([ws['!ref'], cell(ws, 'B2'), cell(ws, 'C2'), cell(ws, 'B3'), cell(ws, 'C3')].join('|'), 'A1:C3|s:1,5|n:3|s:2,25|n:10'); });
  T('tsv→xlsx→tsv round trip', 'convert-sheet', ['people.tsv'], { to: 'xlsx' }, async ([o]) => {
    const back = path.join(path.dirname(o), 'back.tsv');
    await E('office').convertSheet(o, 'tsv', { out: { file: () => back, folder: () => path.dirname(o) }, progress: () => {} }, { allSheets: false });
    ok(bom(back), 'TSV needs a BOM');
    same(utf(back), txt(fx('people.tsv')), 'TSV round trip');
  });
  T('tsv→csv', 'convert-sheet', ['people.tsv'], { to: 'csv' }, ([o]) => ok(utf(o).startsWith('이름,금액,메모\r\n김민지,"1,200","줄\n바꿈"\r\n"Lee, J",3.5'), utf(o).slice(0, 60)));
  T('csv→yaml', 'convert-sheet', ['people.csv'], { to: 'yaml' }, ([o]) => same(txt(o), '- name: 홍길동\n  zip: "01234"\n  age: 42\n  member: true\n  score: 3.5\n- name: Kim, Ada\n  zip: ""\n  age: 7\n  member: false\n  score: ""\n'));

  // Contacts
  T('vcard→csv', 'convert-contacts', ['contacts.vcf'], { to: 'csv' }, ([o]) => { ok(bom(o), 'CSV needs a BOM'); same(utf(o), ['Full name,Given name,Family name,Organization,Title,Email,Phone,Address,Birthday,Note', '홍길동,길동,홍,,,hong@example.com,010-1234-5678 (mobile); 02-123-4567 (work),"서울특별시 종로구 세종대로 209 정부서울청사 별관 3층, 03171 (home)",1980-01-02,전화 주세요', 'Ada Lovelace,Ada,Lovelace,"Analytical Engines, Ltd., Research",Engineer,ada@example.com (work); ada@home.example (home),+44 20 7946 0000 (mobile),,,"First line\nSecond line; folded over two lines here"', '王小明,小明,王,,,,+86-10-1234-5678 (mobile),,--0412,', ''].join('\r\n')); });
  T('vcard utf-16→json', 'convert-contacts', ['phone-utf16.vcf'], { to: 'json' }, ([o]) => has(txt(o), '"Full name": "김철수"', '"Phone": "010-0000-0000"'));
  T('csv→vcard', 'convert-contacts', ['주소록.csv'], { to: 'vcf' }, ([o]) => {
    const t = txt(o);
    ok(t.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:홍길동\r\nN:;;;;\r\nORG:필이\\, 주식회사\r\n'), t.slice(0, 90));
    has(t, '\r\nEMAIL;TYPE=INTERNET:hong@example.com\r\nTEL;TYPE=CELL:010-1111-2222\r\nTEL;TYPE=WORK:02-333-4444\r\n');
    ok(t.split('BEGIN:VCARD').length === 2, 'the empty row became a contact');
    ok(t.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'a line is over 75 bytes');
    const note = E('data').readVcard(read(o))[0].notes[0];
    same(note, '아주 긴 메모입니다. 한 줄이 75바이트를 넘으면 vCard는 줄을 접어요. 접힌 줄은 공백으로 시작해요.', 'folded note');
  });
  F('csv without contact columns', 'convert-contacts', ['numbers.csv'], { to: 'vcf' }, /No contact columns found/);

  // Subtitles: built-in readers and writers, any encoding in, UTF-8 out.
  T('subtitles cp949 sami→srt', 'convert-subtitles', ['영화.smi'], { to: 'srt' }, ([o]) => { ok(bom(o), 'SRT needs a BOM'); same(utf(o), '1\r\n00:00:01,000 --> 00:00:02,500\r\n안녕하세요,\r\n<font color="#FFFF00">반가워요</font>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,200\r\n<i>두 번째 줄입니다</i>\r\n\r\n3\r\n00:00:05,000 --> 00:00:09,000\r\n세 번째 & 마지막\r\n\r\n'); });
  T('subtitles cp949 srt→vtt', 'convert-subtitles', ['cp949.srt'], { to: 'vtt' }, ([o]) => same(txt(o), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\n안녕하세요, 똠방각하\n\n00:00:03.000 --> 00:00:04.000\n두 번째 줄\n\n'));
  T('subtitles lrc→srt last line', 'convert-subtitles', ['song.lrc'], { to: 'srt' }, ([o]) => same(JSON.stringify(srtCues(txt(o))), JSON.stringify([[9500, 11800, 'First line'], [11800, 14500, 'Chorus'], [19500, 25000, 'Chorus'], [25000, 29000, 'Last']])));
  T('subtitles srt→sami', 'convert-subtitles', ['sub.srt'], { to: 'smi' }, ([o]) => { ok(bom(o), 'SAMI needs a BOM'); has(utf(o), '.ENCC { Name: English; lang: en-US; SAMIType: CC; }', '<SYNC Start=500><P Class=ENCC>Hello Lime\r\n<SYNC Start=2000><P Class=ENCC>&nbsp;\r\n<SYNC Start=2500><P Class=ENCC>Second line\r\n<SYNC Start=3800><P Class=ENCC>&nbsp;\r\n'); });
  T('subtitles lenient srt→vtt', 'convert-subtitles', ['lenient.srt'], { to: 'vtt' }, ([o]) => same(txt(o), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<i>First</i> line\nstill the first\n\n00:00:03.500 --> 00:00:04.250\n<b>Second</b> cue\n\n00:00:05.000 --> 00:00:06.000\nThird 2024\n\n'));
  T('subtitles ass→vtt', 'convert-subtitles', ['show.ass'], { to: 'vtt' }, ([o]) => same(txt(o), 'WEBVTT\n\n00:00:01.000 --> 00:00:01.500\n<i>I think so</i>\n\n00:00:02.000 --> 00:00:03.500\nHello, <i>world</i>!\nSecond <c.yellow>yellow</c> line\n\n'));
  T('subtitles vtt→ttml', 'convert-subtitles', ['talk.vtt'], { to: 'ttml' }, ([o]) => has(txt(o), 'xml:lang="ko"', '<p begin="00:00:01.000" end="00:00:02.500">Hi &amp; <span tts:fontStyle="italic">welcome</span><br /><span tts:color="#FFFF00">&lt;3</span></p>', '<p begin="01:00:00.000" end="01:00:01.000">Karaoke</p>'));
  T('subtitles ttml→srt', 'convert-subtitles', ['captions.ttml'], { to: 'srt' }, ([o]) => same(JSON.stringify(srtCues(txt(o))), JSON.stringify([[11000, 12000, 'Line one\nline <b>two</b>'], [13200, 14200, '<i>Frames</i>'], [15000, 16000, '<font color="#FF0000">Red</font> ticks']])));
  T('subtitles scc→srt', 'convert-subtitles', ['captions.scc'], { to: 'srt' }, ([o]) => same(JSON.stringify(srtCues(txt(o))), JSON.stringify([[1435, 3003, 'Hello\nCafé'], [5138, 5205, 'One!'], [5272, 7007, 'One!\nTwo!']])));
  T('subtitles microdvd→srt', 'convert-subtitles', ['movie.sub'], { to: 'srt' }, ([o]) => same(JSON.stringify(srtCues(txt(o))), JSON.stringify([[1000, 2000, '<i>Hello</i>\nworld'], [3000, 4000, '<font color="#FF0000">Red</font>']])));
  F('subtitles vobsub refused', 'convert-subtitles', ['vobsub.sub'], { to: 'srt' }, /VobSub picture subtitles/);
  T('subtitles srt→ass', 'convert-subtitles', ['sub.srt'], { to: 'ass' }, ([o]) => has(utf(o), '[Script Info]\r\nScriptType: v4.00+', 'Dialogue: 0,0:00:00.50,0:00:02.00,Default,,0,0,0,,Hello Lime\r\n', 'Dialogue: 0,0:00:02.50,0:00:03.80,Default,,0,0,0,,Second line\r\n'));
  T('subtitles srt→lrc', 'convert-subtitles', ['sub.srt'], { to: 'lrc' }, ([o]) => same(txt(o), '[00:00.50]Hello Lime\r\n[00:02.00]\r\n[00:02.50]Second line\r\n[00:03.80]\r\n'));
  T('subtitles srt→microdvd', 'convert-subtitles', ['sub.srt'], { to: 'sub' }, ([o]) => same(utf(o), '{1}{1}23.976\r\n{12}{48}Hello Lime\r\n{60}{91}Second line\r\n'));
  T('burn ttml subtitles', 'burn-subtitles', ['clip.mp4'], { subtitles: fx('burn.ttml'), size: 30 }, async ([o]) => {
    await dur(o, 4, 0.3);
    const ff = E('util').binPath('ffmpeg');
    const frame = (f) => require('child_process').execFileSync(ff, ['-v', 'error', '-ss', '2', '-i', f, '-frames:v', '1', '-vf', 'crop=iw:ih/3:0:2*ih/3,scale=320:-2', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    const a = frame(fx('clip.mp4')), b = frame(o);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    ok(diff / a.length > 2, `no caption burned in (mean difference ${(diff / a.length).toFixed(2)})`);
  });

  // Archives: links, zip slip, flattening, duplicate names, single-file streams.
  T('extract tar with escaping link', 'extract-archive', ['links.tar'], {}, ([o]) => { same(walk(o).join(','), 'a.txt,b.txt'); ok(!walk(o).some((f) => isLink(path.join(o, f))), 'a link was unpacked'); ok(txt(path.join(o, 'a.txt')) === 'alpha', 'content'); });
  F('extract refuses zip slip', 'extract-archive', ['slip.zip'], {}, /slip\.zip was not unpacked: the entry "\.\.[\\/]\.\.[\\/]evil\.txt" points outside the target folder/);
  T('extract flattens one top folder', 'extract-archive', ['사진.zip'], {}, ([o]) => { ok(path.basename(o) === '사진', path.basename(o)); same(walk(o).join(','), 'a.txt,sub,sub/b.txt'); });
  T('convert archive keeps top folder', 'convert-archive', ['사진.zip'], { format: '7z', level: 5 }, async ([o]) => { ok(path.basename(o) === '사진.7z', path.basename(o)); same((await entries(o)).join(','), 'photos,photos/a.txt,photos/sub,photos/sub/b.txt'); });
  T('convert tar.gz→tar.xz', 'convert-archive', ['archive.tar.gz'], { format: 'tar.xz', level: 5 }, ([o]) => { ok(path.basename(o) === 'archive.tar.xz', path.basename(o)); magic(o, '7zXZ'); const n = tarNames(sevenZip(['x', '-so', o])); ok(n.includes('a.txt') && n.includes('inner/b.txt'), n.join(',')); });
  T('compress same names', 'create-archive', ['dupA/report.txt', 'dupB/report.txt'], { format: 'zip', level: 5 }, ([o]) => { ok(path.basename(o) === 'report_files.zip', path.basename(o)); const z = zipHas(o, 'report'); same(Object.keys(z).sort().join(','), 'report (2).txt,report.txt'); ok(Buffer.from(z['report (2).txt']).toString() === 'from B', 'second file'); });
  for (const [fmt, sig] of [['tar.bz2', 'BZh'], ['tar.xz', '7zXZ'], ['tar', 'folder/']]) T(`compress folder→${fmt}`, 'create-archive', ['folder'], { format: fmt, level: 5 }, ([o]) => { ok(path.basename(o) === `folder.${fmt}`, path.basename(o)); if (fmt !== 'tar') magic(o, sig); const n = tarNames(fmt === 'tar' ? read(o) : sevenZip(['x', '-so', o])); ok(n.includes('folder/a.txt') && n.includes('folder/inner/b.txt'), n.join(',')); });
  T('compress one file→gz', 'create-archive', ['doc.txt'], { format: 'gz', level: 5 }, ([o]) => { ok(path.basename(o) === 'doc.txt.gz', path.basename(o)); ok(require('zlib').gunzipSync(read(o)).equals(read(fx('doc.txt'))), 'gz content'); });
  F('gz refuses a folder', 'create-archive', ['folder'], { format: 'gz', level: 5 }, /A \.gz file holds a single file/);
  T('decompress gz', 'decompress-file', ['notes.txt.gz'], {}, ([o]) => { ok(path.basename(o) === 'notes.txt', path.basename(o)); same(txt(o), 'hello from a gzip file\n'); });
  F('password zip needs its password', 'extract-archive', ['secret.zip'], {}, /secret\.zip is password-protected/);
  T('password zip with password', 'extract-archive', ['secret.zip'], { password: 'lime' }, ([o]) => same(txt(path.join(o, 'a.txt')), 'alpha'));
  T('data jsonc→json order and floats', 'convert-data', ['order.jsonc'], { to: 'json' }, ([o]) => { ok(path.basename(o) === 'order.json', path.basename(o)); same(txt(o), '{\n  "2": 1,\n  "1": 2,\n  "f": 1000000000000000.0,\n  "g": 0.000015,\n  "h": 1E+300,\n  "i": 3.0,\n  "j": 12345678901234567890\n}\n'); });
  T('data list→toml items', 'convert-data', ['list.json'], { to: 'toml' }, ([o]) => same(txt(o), '[[items]]\na = 1\n\n[[items]]\na = 2\n'));
  T('data xml rows→csv', 'convert-data', ['rows.xml'], { to: 'csv' }, ([o]) => same(utf(o), 'a,b\r\n1,x\r\n2,y\r\n'));
  T('data yaml columns→csv', 'convert-data', ['columns.yaml'], { to: 'csv' }, ([o]) => same(utf(o), 'name,age\r\na,1\r\nb,\r\n'));
  T('vcard→xlsx', 'convert-contacts', ['contacts.vcf'], { to: 'xlsx' }, ([o]) => { const ws = sheet0(o); same([cell(ws, 'A1'), cell(ws, 'A2'), cell(ws, 'G2'), cell(ws, 'A4'), cell(ws, 'I4')].join('|'), 's:Full name|s:홍길동|s:010-1234-5678 (mobile); 02-123-4567 (work)|s:王小明|s:--0412'); });
  for (const fmt of ['bz2', 'xz']) T(`compress one file→${fmt}`, 'create-archive', ['doc.txt'], { format: fmt, level: 5 }, ([o]) => { ok(path.basename(o) === `doc.txt.${fmt}`, path.basename(o)); magic(o, fmt === 'xz' ? '7zXZ' : 'BZh'); ok(sevenZip(['x', '-so', o]).equals(read(fx('doc.txt'))), `${fmt} content`); });
  T('convert gz→xz', 'convert-archive', ['notes.txt.gz'], { format: 'xz', level: 5 }, ([o]) => { ok(path.basename(o) === 'notes.txt.xz', path.basename(o)); same(sevenZip(['x', '-so', o]).toString(), 'hello from a gzip file\n'); });

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
      if (c.fail) {
        ok(j.status === 'error', `${j.status} instead of an error`);
        ok(c.fail.test(j.error || ''), `error was: ${j.error}`);
        ok(!files(dest.path).length, `left ${files(dest.path).join(', ')} behind`);
        detail = String(j.error).slice(0, 100);
        throw Object.assign(new Error(detail), { expected: true });
      }
      if (j.status !== 'done') throw new Error(`${j.status}: ${j.error}`);
      const outs = j.results.flatMap((r) => r.paths || (r.path ? [r.path] : []));
      ok(!outs.some((o) => / x(\.[^.]+)?$/.test(path.basename(o))), `duplicate name ${outs.map((o) => path.basename(o))}`);
      for (const o of outs) if (/\.pdf$/i.test(o) && fs.statSync(o).isFile()) magic(o, '%PDF-');
      await c.check(outs, j.results);
      detail = outs.map((o) => path.relative(OUT, o)).join(', ') || (j.results[0]?.note || '').split('\n')[0];
    } catch (e) { if (!e.expected) { status = 'FAIL'; detail = e.message; } }
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
  if (!only || only.test('extract merges into a folder')) {
    const into = path.join(OUT, 'merge into');
    fs.mkdirSync(into, { recursive: true });
    fs.writeFileSync(path.join(into, 'keep.txt'), 'mine');
    fs.writeFileSync(path.join(into, 'a.txt'), 'old');
    let status = 'PASS', detail = '';
    try {
      const id = submit({ tool: 'extract-archive', files: [fx('archive.zip')], opts: {}, dest: { kind: 'folder', path: into } });
      let j;
      for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(150); }
      ok(j.status === 'done', `${j.status}: ${j.error}`);
      same(walk(into).join(','), 'a.txt,inner,inner/b.txt,keep.txt', 'merged folder');
      ok(txt(path.join(into, 'keep.txt')) === 'mine' && txt(path.join(into, 'a.txt')) === 'alpha', 'files not merged');
      ok(!files(OUT).some((f) => f.startsWith('.')), `staging left: ${files(OUT)}`);
      detail = walk(into).join(', ');
    } catch (e) { status = 'FAIL'; detail = e.message; }
    console.log(`${status} ${'extract merges into a folder'.padEnd(34)}        ${detail}`);
    results.push({ name: 'extract merges into a folder', status, detail });
  }
  const fail = results.filter((r) => r.status === 'FAIL'), skip = results.filter((r) => r.status === 'SKIP');
  console.log(`\n${results.length - fail.length - skip.length}/${results.length - skip.length} passed${skip.length ? `, ${skip.length} skipped` : ''}`);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(results, null, 1));
  app.isQuitting = true;
  app.exit(fail.length ? 1 : 0);
};
