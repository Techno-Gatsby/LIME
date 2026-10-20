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
  T('pdf→pptx keeps page shapes', 'pdf-to-powerpoint', ['mixed.pdf'], { notes: true }, ([o]) => {
    const z = zipHas(o, 'ppt/slides/slide2.xml'), x = (f) => Buffer.from(z[f]).toString();
    const sz = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(x('ppt/presentation.xml')).slice(1).map(Number);
    ok(sz[0] === 7556500 && sz[1] === 10693400, `slide size ${sz}`);
    const [ox, oy, cx, cy] = /<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(x('ppt/slides/slide2.xml').split('<p:pic>')[1]).slice(1).map(Number);
    ok(Math.abs(cx / cy - 842 / 595) < 0.01, `landscape page stretched to ${cx}×${cy}`);
    ok(Math.abs(ox + cx / 2 - sz[0] / 2) < 2000 && Math.abs(oy + cy / 2 - sz[1] / 2) < 2000, 'not centred');
    ok(/Landscape page/.test(Object.keys(z).filter((k) => /notesSlide\d+\.xml$/.test(k)).map(x).join(' ')), 'notes missing');
  });
  T('pdf→pptx', 'pdf-to-powerpoint', ['doc.pdf'], { notes: true }, ([o]) => { const z = zipHas(o, 'ppt/slides/slide'); ok(Object.keys(z).filter((k) => /slides\/slide\d+\.xml$/.test(k)).length === 3, 'slide count'); });
  T('pdf→xlsx', 'pdf-to-excel', ['doc.pdf'], { to: 'xlsx' }, ([o]) => ok(require('xlsx').readFile(o).SheetNames.length >= 1, 'no sheets'));
  T('pdf→jpg', 'pdf-to-jpg', ['doc.pdf'], { format: 'jpg', dpi: '96', pages: 'all' }, async ([o]) => { const fl = files(o); ok(fl.length === 3, `${fl.length} images`); await fmt(path.join(o, fl[0]), 'jpeg'); });
  T('pdf→tiff every page', 'pdf-to-tiff', ['mixed.pdf'], { dpi: '72' }, async ([o]) => { const m = await sharp(o).metadata(); ok(m.format === 'tiff' && m.pages === 2, `tiff pages ${m.pages}`); const p2 = await sharp(o, { page: 1 }).metadata(); ok(p2.width === 842 && p2.height === 595, `page 2 ${p2.width}×${p2.height}`); });
  T('pdf→cbz', 'pdf-to-cbz', ['doc.pdf'], {}, async ([o]) => { const z = require('fflate').unzipSync(new Uint8Array(read(o))); ok(Object.keys(z).join() === '001.jpg,002.jpg,003.jpg', `entries ${Object.keys(z)}`); ok((await sharp(Buffer.from(z['002.jpg'])).metadata()).format === 'jpeg', 'not jpeg'); });
  T('pdf→md', 'pdf-to-markdown', ['doc.pdf'], {}, ([o]) => ok(/Lime test document/.test(txt(o)) && /quick brown fox/.test(txt(o)), `markdown: ${txt(o).slice(0, 120)}`));
  T('pdf→webp pages', 'pdf-to-jpg', ['doc.pdf'], { format: 'webp', dpi: '96' }, async ([o]) => { const f = files(o); ok(f.length === 3, `${f}`); ok((await sharp(path.join(o, f[0])).metadata()).format === 'webp', 'not webp'); });
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
  T('compress pdf by drawn size, graphics lossless', 'compress-pdf', ['images.pdf'], { level: 'recommended' }, async ([o]) => {
    const { PDFDocument, PDFRawStream, PDFName } = require('pdf-lib');
    const d = await PDFDocument.load(read(o)), imgs = d.context.enumerateIndirectObjects().map(([, x]) => x).filter((x) => x instanceof PDFRawStream && String(x.dict.get(PDFName.of('Subtype'))) === '/Image');
    const num = (x, k) => d.context.lookup(x.dict.get(PDFName.of(k)))?.asNumber?.();
    const photo = imgs.find((x) => String(x.dict.get(PDFName.of('Filter'))) === '/DCTDecode'), chart = imgs.find((x) => num(x, 'Width') === 1200);
    ok(photo && num(photo, 'Width') <= 320 && num(photo, 'Width') >= 280, `photo drawn 2 in wide kept ${photo && num(photo, 'Width')} px`);
    ok(chart && String(chart.dict.get(PDFName.of('Filter'))) === '/FlateDecode', 'chart re-encoded lossy');
    let raw = require('zlib').inflateSync(Buffer.from(chart.contents));
    const parms = d.context.lookup(chart.dict.get(PDFName.of('DecodeParms')));
    if (parms) raw = E('pdf').unpredict(raw, 1200, 3);
    for (let y = 0; y < 800; y += 37) for (let x = 0; x < 1200; x += 41) { const k = ((x >> 3) * 7 + (y >> 3) * 13) % 200, i = (y * 1200 + x) * 3; ok(raw[i] === ((k * 37) & 255) && raw[i + 1] === ((k * 91) & 255) && raw[i + 2] === ((k * 53) & 255), `chart pixel ${x},${y} changed`); }
  });
  const macroFree = (o, main) => { const z = require('fflate').unzipSync(new Uint8Array(read(o))), names = Object.keys(z), all = names.map((n) => Buffer.from(z[n]).toString('latin1')).join(''); ok(!names.some((n) => /vbaProject/i.test(n)) && !/vbaProject/i.test(all), 'macros left in'); const own = /<Override\b[^>]*PartName="\/(word\/document|xl\/workbook)\.xml"[^>]*\/>/.exec(Buffer.from(z['[Content_Types].xml']).toString())?.[0] || ''; ok(own.includes(main) && !/macroEnabled/.test(own), `main content type ${own}`); };
  T('docm→docx removes macros', 'convert-document', ['macro.docm'], { to: 'docx' }, async ([o]) => { macroFree(o, 'wordprocessingml.document.main+xml'); const part = (f) => Buffer.from(require('fflate').unzipSync(new Uint8Array(read(f)))['word/document.xml']); ok(part(o).equals(part(fx('macro.docm'))), 'document rebuilt instead of kept as is'); ok((await docxText(o)).includes('quick brown fox'), 'text lost'); });
  T('xlsm→xlsx removes macros', 'convert-sheet', ['macro.xlsm'], { to: 'xlsx' }, ([o]) => { macroFree(o, 'spreadsheetml.sheet.main+xml'); const X = require('xlsx'), a = X.readFile(o), b = X.readFile(fx('sheet.xlsx')); ok(JSON.stringify(X.utils.sheet_to_json(a.Sheets[a.SheetNames[0]])) === JSON.stringify(X.utils.sheet_to_json(b.Sheets[b.SheetNames[0]])), 'cells changed'); });
  T('pdf→pdf/a', 'pdf-to-pdfa', ['v1.pdf'], { level: '2b' }, async ([o], r) => { ok(/no issues/.test(r[0].note), r[0].note); ok(/pdfaid:part[^0-9]*2/.test(read(o).toString('latin1')), 'no PDF/A identification'); });
  T('pdf/a reports what remains', 'pdf-to-pdfa', ['doc.pdf'], {}, async ([o], r) => ok(/isn.t embedded/.test(r[0].note), r[0].note));
  const annots = async (o) => { const { PDFDocument, PDFName } = require('pdf-lib'); const d = await PDFDocument.load(read(o)); return d.getPages().flatMap((p) => { const a = p.node.lookup(PDFName.of('Annots')); return a ? a.asArray().map((x) => String(d.context.lookup(x).get(PDFName.of('Subtype')))) : []; }); };
  T('compare pdf marks changes', 'compare-pdf', ['v1.pdf', 'v2.pdf'], { output: 'marked' }, async ([o], r) => { ok(/changed/.test(r[0].note) && /added/.test(r[0].note), r[0].note); const a = await annots(o); ok(a.filter((x) => x === '/Highlight').length >= 2, `annotations ${a}`); ok((await pdfText(o)).includes('red fox'), 'not the newer version'); });
  T('compare pdf report', 'compare-pdf', ['v1.pdf', 'v2.pdf'], { output: 'report' }, async ([o]) => { const t = await pdfText(o); ok(/brown/.test(t) && /red/.test(t), `report: ${t.slice(0, 200)}`); });
  T('make pdf fillable', 'make-fillable', ['form.pdf'], {}, async ([o], r) => { const { PDFDocument } = require('pdf-lib'); const f = (await PDFDocument.load(read(o))).getForm().getFields(); ok(f.length >= 3, `${f.length} fields: ${r[0].note}`); ok(f.some((x) => x.constructor.name === 'PDFCheckBox'), `kinds ${f.map((x) => x.constructor.name)}`); });
  T('scan to pdf', 'scan-to-pdf', ['doc-photo.jpg'], { mode: 'greyscale', ocr: true, lang: 'eng' }, async ([o], r) => {
    ok(/1 of 1 page straightened/.test(r[0].note), r[0].note);
    const { doc, m } = await E('pdf').readPdf(o), page = doc.loadPage(0), [x0, y0, x1, y1] = page.getBounds();
    ok(Math.abs((x1 - x0) / (y1 - y0) - 600 / 848) < 0.06, `page shape ${((x1 - x0) / (y1 - y0)).toFixed(3)}`);
    const px = page.toPixmap(m.Matrix.scale(0.3, 0.3), m.ColorSpace.DeviceGray, false, true), st = px.getStride(), g = px.getPixels(), w = px.getWidth(), h = px.getHeight();
    const corners = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]].map(([x, y]) => g[y * st + x]);
    ok(corners.every((v) => v > 170), `desk still in corners ${corners}`);
    ok(/Invoice 2041/.test(page.toStructuredText('').asText()), 'text not recognised');
  });
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
  T('dxf line weights and types', 'convert-cad', ['lines.dxf'], { to: 'svg' }, ([o]) => {
    const paths = [...txt(o).matchAll(/<path d="M([\d.]+),([\d.]+)[^"]*"[^>]*stroke-width="([\d.]+)"([^>]*)>/g)].map((m) => ({ y: +m[2], w: +m[3], dash: /stroke-dasharray="([^"]+)"/.exec(m[4])?.[1] }));
    ok(paths.length === 3, `paths ${JSON.stringify(paths)}`);
    const [thin, dashed, thick] = [...paths].sort((a, b) => a.y - b.y);
    ok(Math.abs(thick.w / thin.w - 70 / 13) < 0.05, `weights ${thick.w} vs ${thin.w}`);
    ok(dashed.dash === '6.35 3.175' && !thick.dash && !thin.dash, `dashes ${JSON.stringify(paths)}`);
  });
  T('dxf line types in pdf', 'convert-cad', ['lines.dxf'], { to: 'pdf', sheet: 'a4' }, async ([o]) => {
    const { PDFDocument, PDFArray, decodePDFRawStream } = require('pdf-lib');
    const d = await PDFDocument.load(read(o)), c = d.getPages()[0].node.Contents(), list = c instanceof PDFArray ? c.asArray().map((x) => d.context.lookup(x)) : [c];
    const ops = list.map((x) => Buffer.from(decodePDFRawStream(x).decode()).toString('latin1')).join('\n');
    const widths = [...new Set([...ops.matchAll(/([\d.]+) w\b/g)].map((m) => +m[1]))].sort((x, y) => x - y);
    ok(/\[\s*[\d.]+\s+[\d.]+\s*\]\s*[\d.]+\s+d/.test(ops), 'no dash pattern');
    ok(widths.length >= 2 && Math.abs(widths[widths.length - 1] / widths[0] - 70 / 13) < 0.05, `widths ${widths}`);
  });
  T('dxf hatches fill, keep holes, tint patterns', 'convert-cad', ['hatch.dxf'], { to: 'png', size: 2000, mono: false }, async ([o]) => {
    const { data, info } = await sharp(o).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const k = info.width / 318, px = (x, y) => { const i = (Math.round((100 - y + 9) * k) * info.width + Math.round((x + 9) * k)) * 3; return [data[i], data[i + 1], data[i + 2]]; };
    const ring = px(12, 50), hole = px(50, 50), pattern = px(250, 50);
    ok(ring[0] > 200 && ring[1] < 60, `solid hatch not filled: ${ring}`);
    ok(hole.every((v) => v > 240), `hole filled: ${hole}`);
    ok(pattern[0] > 230 && pattern[1] > 150 && pattern[1] < 230, `pattern hatch not tinted: ${pattern}`);
  });
  T('dxf→pdf keeps non-Latin text', 'convert-cad', ['unicode.dxf'], { to: 'pdf', sheet: 'a4' }, async ([o]) => { const t = await pdfText(o); ok(['Größe', 'Ω', 'Привет'].every((w) => t.includes(w)), `text: ${t.trim()}`); });
  for (const to of ['pdf', 'png', 'dxf']) T(`dwg→${to}`, 'convert-cad', ['sample_2018.dwg'], { to, sheet: 'a3', size: 2000 }, async ([o]) => (to === 'pdf' ? pages(o, 1) : to === 'png' ? fmt(o, 'png') : ok(txt(o).includes('ENTITIES'), 'dxf')));
  for (const to of ['stl', 'obj', 'glb', '3mf', 'ply']) T(`step→${to}`, 'convert-model', ['part.stp'], { to }, async ([o]) => ok((await E('cad').info(o)).triangles === 4688, 'triangles'));
  T('step→png', 'convert-model', ['part.stp'], { to: 'png' }, async ([o]) => fmt(o, 'png'));
  T('step→pdf', 'convert-model', ['part.stp'], { to: 'pdf' }, async ([o]) => pages(o, 1));
  T('iges→stl', 'convert-model', ['cube.igs'], { to: 'stl' }, async ([o]) => ok((await E('cad').info(o)).triangles >= 12, 'tris'));
  T('stl→obj', 'convert-model', ['cube.stl'], { to: 'obj' }, async ([o]) => { const i = await E('cad').info(o); ok(i.triangles === 12 && Math.abs(i.volume - 1000) < 1, `vol ${i.volume}`); });
  T('obj→stl', 'convert-model', ['mesh.obj'], { to: 'stl' }, async ([o]) => ok((await E('cad').info(o)).triangles === 4, 'tris'));
  const near = (a, b, m) => ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-3 * Math.max(1, Math.abs(b[i]))), `${m} ${a.map((v) => +v.toFixed(4))} ≠ ${b}`);
  const glbBox = (p) => { const b = read(p), js = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()); const a = js.accessors[0]; return a.max.map((v, i) => v - a.min[i]); };
  T('stl→glb metres, Y up', 'convert-model', ['box.stl'], { to: 'glb' }, ([o]) => near(glbBox(o), [0.01, 0.03, 0.02], 'glb extents'));
  T('glb→stl millimetres, Z up', 'convert-model', ['box.glb'], { to: 'stl' }, async ([o]) => near((await E('cad').info(o)).size, [10, 20, 30], 'stl size'));
  T('step→gltf keeps part colours', 'convert-model', ['part.stp'], { to: 'gltf' }, async ([o]) => { const j = JSON.parse(txt(o)); ok(j.buffers[0].uri.startsWith('data:'), 'not self-contained'); ok(!j.meshes[0].primitives.some((p) => p.attributes.NORMAL != null), 'invented normals'); ok((await E('cad').info(o)).triangles === 4688, 'triangles'); });
  T('3mf inch→stl', 'convert-model', ['box-inch.3mf'], { to: 'stl' }, async ([o]) => near((await E('cad').info(o)).size, [25.4, 50.8, 76.2], 'stl size'));
  T('stl→obj→Y up', 'convert-model', ['box.stl'], { to: 'obj' }, async ([o]) => { const v = txt(o).split('\n').filter((l) => l.startsWith('v ')).map((l) => l.split(' ').slice(1).map(Number)); near([0, 1, 2].map((k) => Math.max(...v.map((x) => x[k])) - Math.min(...v.map((x) => x[k]))), [10, 30, 20], 'obj extents'); near((await E('cad').info(o)).size, [10, 20, 30], 'read back'); });
  const attrs = (s) => Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const mf = (p) => { const x = Buffer.from(require('fflate').unzipSync(new Uint8Array(read(p)))['3D/3dmodel.model']).toString(), obj = attrs(/<object\b([^>]*)>/.exec(x)[1]), colors = [...x.matchAll(/displaycolor="([^"]+)"/g)].map((m) => m[1]); return { unit: attrs(/<model\b([^>]*)>/.exec(x)[1]).unit, colors, v: [...x.matchAll(/<vertex\b([^>]*)\/>/g)].map((m) => { const a = attrs(m[1]); return [+a.x, +a.y, +a.z]; }), t: [...x.matchAll(/<triangle\b([^>]*)\/>/g)].map((m) => { const a = attrs(m[1]); return { v: [+a.v1, +a.v2, +a.v3], color: colors[+(a.p1 ?? obj.pindex)] }; }) }; };
  const plyOut = (p) => { const b = read(p), e = b.indexOf('end_header\n') + 11, h = b.subarray(0, e).toString(), nv = +/element vertex (\d+)/.exec(h)[1], nf = +/element face (\d+)/.exec(h)[1], vs = /uchar red/.test(h) ? 16 : 12; return { h, V: Array.from({ length: nv }, (_, i) => [...[0, 4, 8].map((k) => b.readFloatLE(e + i * vs + k)), ...(vs > 12 ? b.subarray(e + i * vs + 12, e + i * vs + 16) : [])]), F: Array.from({ length: nf }, (_, i) => [1, 5, 9].map((k) => b.readUInt32LE(e + nv * vs + i * 13 + k))) }; };
  const vol = (V, F) => F.reduce((s, [a, b, c]) => s + V[a][0] * (V[b][1] * V[c][2] - V[b][2] * V[c][1]) - V[a][1] * (V[b][0] * V[c][2] - V[b][2] * V[c][0]) + V[a][2] * (V[b][0] * V[c][1] - V[b][1] * V[c][0]), 0) / 6;
  const box3 = (v) => [0, 1, 2].map((k) => Math.min(...v.map((p) => p[k]))).concat([0, 1, 2].map((k) => Math.max(...v.map((p) => p[k]))));
  T('fbx→stl binary, centimetres, Y up', 'convert-model', ['cube.fbx'], { to: 'stl' }, async ([o]) => {
    const i = await E('cad').info(o);
    ok(i.triangles === 12 && i.watertight, `${i.triangles} triangles`);
    near([...i.min, ...i.max, i.volume], [0, -200, 100, 200, 0, 300, 8e6], 'cube min, max, volume');
    let err = '';
    try { E('fbx').readFbx(read(fx('cube.fbx')).subarray(0, 600), fx('cube.fbx')); } catch (e) { err = e.message; }
    ok(err === 'The FBX file is cut short or damaged.', `cut-short file: ${err || 'read without error'}`);
  });
  T('fbx→3mf keeps material colours', 'convert-model', ['cube.fbx'], { to: '3mf' }, ([o]) => {
    const m = mf(o), blue = m.t.filter((t) => t.color === '#0000FF');
    ok(m.unit === 'millimeter' && m.v.length === 8 && m.t.length === 12, `${m.unit}, ${m.v.length} vertices, ${m.t.length} triangles`);
    ok(m.colors.join() === '#FF0000,#0000FF' && blue.length === 2, `colours ${m.colors}, ${blue.length} blue triangles`);
    ok(blue.every((t) => t.v.every((k) => m.v[k][2] === 300)), 'the blue (+Y) face is not on top');
  });
  T('fbx ascii→3mf Z up, nested transforms, mm', 'convert-model', ['box-ascii.fbx'], { to: '3mf' }, ([o]) => {
    const m = mf(o);
    ok(m.t.length === 12 && m.colors.join() === '#CCCCCC', `${m.t.length} triangles, colours ${m.colors}`);
    near(box3(m.v), [60, 0, 10, 100, 20, 70], 'box min, max');
  });
  T('fbx→obj writes an mtl', 'convert-model', ['cube.fbx'], { to: 'obj' }, ([o, mtl]) => {
    ok(/\.mtl$/.test(mtl || ''), `outputs ${o}, ${mtl}`);
    const L = txt(o).split('\n'), v = L.filter((l) => l.startsWith('v ')).map((l) => l.split(' ').slice(1).map(Number)), kd = {}, faces = {};
    ok(L.includes(`mtllib ${path.basename(mtl)}`), 'mtllib does not name the .mtl');
    let cur = null;
    for (const l of txt(mtl).split('\n')) if (l.startsWith('newmtl ')) cur = l.slice(7); else if (l.startsWith('Kd ')) kd[cur] = l.slice(3);
    for (const l of L) if (l.startsWith('usemtl ')) cur = kd[l.slice(7)]; else if (l.startsWith('f ')) (faces[cur] = faces[cur] || []).push(l.split(' ').slice(1).map((k) => v[k - 1]));
    ok(faces['1 0 0']?.length === 10 && faces['0 0 1']?.length === 2, `faces by Kd: ${Object.entries(faces).map(([k, f]) => `${k} ×${f.length}`)}`);
    ok(faces['0 0 1'].flat().every((p) => p[1] === 300), 'blue faces are not on top (Y up, 300 mm)');
  });
  T('obj concave face ear-clipped', 'convert-model', ['lshape.obj'], { to: 'stl' }, async ([o]) => {
    const i = await E('cad').info(o), b = read(o), n = Array.from({ length: 5 }, (_, k) => [0, 4, 8].map((j) => +b.readFloatLE(84 + k * 50 + j).toFixed(4)).join());
    ok(i.triangles === 5 && Math.abs(i.area - 350) < 1e-6, `${i.triangles} triangles, area ${i.area} (a fan gives 450)`);
    ok(n.every((x) => x === '0,-1,0'), `normals ${n.join(' ')}`);
  });
  T('obj mtl and vertex colours→3mf', 'convert-model', ['lshape.obj'], { to: '3mf' }, ([o]) => {
    const m = mf(o);
    ok(m.v.length === 9 && m.t.length === 5, `${m.v.length} vertices, ${m.t.length} triangles`);
    ok(m.t.map((t) => t.color).join() === '#00FF00,#FF8000BF,#FF8000BF,#FF8000BF,#FF8000BF', `colours ${m.t.map((t) => t.color)}`);
    near(box3(m.v), [0, 0, 0, 40, 0, 20], 'Y up to Z up');
  });
  T('ply vertex colours→glb materials', 'convert-model', ['colors.ply'], { to: 'glb' }, async ([o]) => {
    const b = read(o), js = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()), f = js.materials.map((x) => x.pbrMetallicRoughness.baseColorFactor.map((c) => +c.toFixed(3)));
    ok(f.join(' ') === '1,0,0,1 0,0,1,0.502' && !js.materials[0].alphaMode && js.materials[1].alphaMode === 'BLEND', `materials ${f.join(' ')}`);
    ok(js.meshes[0].primitives.map((p) => js.accessors[p.indices].count).join() === '6,6', 'triangles per colour');
    const i = await E('cad').info(o);
    ok(Math.abs(i.area - 140) < 1e-3, `area ${i.area} (a fan gives 160)`);
  });
  T('3mf colours, support, mirror→ply', 'convert-model', ['colors.3mf'], { to: 'ply' }, ([o]) => {
    const { h, V, F } = plyOut(o), col = (c) => F.filter((f) => f.every((k) => V[k].slice(3).join() === c));
    ok(/property uchar alpha/.test(h) && F.length === 12, `${F.length} faces`);
    const blue = col('0,0,255,255');
    ok(blue.length === 2 && col('255,0,0,255').length === 10 && blue.every((f) => f.every((k) => V[k][2] === 10)), `${blue.length} blue faces, ${col('255,0,0,255').length} red`);
    near([...box3(V).slice(0, 1), vol(V, F)], [-10, 1000], 'mirrored x, outward volume');
  });
  T('stl→ply without colours', 'convert-model', ['box.stl'], { to: 'ply' }, ([o]) => { const { h, V, F } = plyOut(o); ok(!/red/.test(h) && F.length === 12 && Math.abs(vol(V, F) - 6000) < 1e-3, `${F.length} faces, volume ${vol(V, F)}`); });
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
      if (j.status !== 'done') throw new Error(`${j.status}: ${j.error}`);
      const outs = j.results.flatMap((r) => r.paths || (r.path ? [r.path] : []));
      ok(!outs.some((o) => / x(\.[^.]+)?$/.test(path.basename(o))), `duplicate name ${outs.map((o) => path.basename(o))}`);
      for (const o of outs) if (/\.pdf$/i.test(o) && fs.statSync(o).isFile()) magic(o, '%PDF-');
      await c.check(outs, j.results);
      detail = outs.map((o) => path.relative(OUT, o)).join(', ') || (j.results[0]?.note || '').split('\n')[0];
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
