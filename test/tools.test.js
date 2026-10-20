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
  const U = E('util'), M = E('media');
  const ffp = async (p, extra = []) => JSON.parse((await U.run(U.binPath('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', ...extra, p])).stdout);
  const of = (j, type) => j.streams.filter((s) => s.codec_type === type);
  const md5 = async (p, sel) => (await U.run(U.binPath('ffmpeg'), ['-v', 'error', '-i', p, '-map', sel, '-c', 'copy', '-f', 'md5', '-'])).stdout.trim();
  const sound = async (p, ss = 0, t = 0) => {
    const { stderr } = await U.run(U.binPath('ffmpeg'), ['-hide_banner', '-nostats', ...(ss ? ['-ss', String(ss)] : []), ...(t ? ['-t', String(t)] : []), '-i', p, '-af', 'volumedetect,astats=metadata=0', '-f', 'null', '-']);
    const n = (re) => Number((re.exec(stderr) || [])[1]);
    return { mean: n(/mean_volume: (-?[\d.]+) dB/), max: n(/max_volume: (-?[\d.]+) dB/), zcr: n(/Zero crossings rate: ([\d.]+)/) };
  };
  let stills = 0;
  const still = async (p, at) => { const f = path.join(OUT, `still-${++stills}.png`); await U.run(U.binPath('ffmpeg'), ['-v', 'error', '-y', ...(at < 0 ? ['-sseof', String(at)] : ['-ss', String(at)]), '-i', p, '-frames:v', '1', '-update', '1', f]); return f; };
  const diff = async (a, b, region) => {
    const [x, y] = await Promise.all([a, b].map((f) => { const img = typeof f === 'string' ? sharp(f) : f; return (region ? img.extract(region) : img).removeAlpha().raw().toBuffer(); }));
    let s = 0;
    for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]);
    return s / x.length;
  };
  const titled = (j) => [j.format.tags, ...j.streams.map((s) => s.tags)].some((t) => t && Object.entries(t).some(([k, v]) => k.toLowerCase() === 'title' && v === 'Lime 노래'));
  const C = [];
  const T = (name, tool, inputs, opts, check, skip) => C.push({ name, tool, inputs: inputs.map(fx), opts, check, skip });
  const noEncoder = (to) => (M.supports(to) ? null : `this FFmpeg cannot write ${to}`);

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

  const VT = { mp4: 'h264 aac mov_text', hevc: 'hevc aac mov_text', av1: 'av1 aac mov_text', mov: 'h264 aac mov_text', m4v: 'h264 aac mov_text', '3gp': 'h264 aac mov_text', '3g2': 'h264 aac mov_text', mkv: 'h264 aac subrip', webm: 'vp9 opus webvtt',
    avi: 'mpeg4 mp3', wmv: 'wmv2 wmav2', flv: 'h264 aac', mpg: 'mpeg2video mp2', ts: 'h264 aac', m2ts: 'h264 aac', vob: 'mpeg2video ac3', ogv: 'theora vorbis', dv: 'dvvideo pcm_s16le', mxf: 'mpeg2video pcm_s16le' };
  for (const [to, want] of Object.entries(VT)) {
    T(`video odd→${to}`, 'convert-video', ['odd.mp4'], { to, quality: 'balanced', height: '' }, async ([o]) => {
      const j = await ffp(o), [v] = of(j, 'video'), [a] = of(j, 'audio'), got = [v?.codec_name, a?.codec_name, ...of(j, 'subtitle').map((s) => s.codec_name)].join(' ');
      ok(got === want, `streams ${got} ≠ ${want}`);
      const size = to === 'vob' || to === 'dv' ? '720x480' : '320x240';
      ok(`${v.width}x${v.height}` === size && (to === 'dv' || v.pix_fmt === 'yuv420p'), `${v.width}x${v.height} ${v.pix_fmt}`);
      ok(Math.abs(Number(j.format.duration) - 4) < 0.3, `duration ${j.format.duration}`);
      if (['wmv', 'avi', 'mpg', 'dv'].includes(to)) ok(a.channels === 2, `${a.channels} channels`);
    }, ['hevc', 'av1', 'ogv'].includes(to) ? noEncoder(to) : null);
  }
  T('video remux iPhone mov→mp4', 'convert-video', ['phone.mov'], { to: 'mp4', quality: 'balanced', height: '' }, async ([o], r) => {
    const j = await ffp(o), [v] = of(j, 'video');
    ok(v.codec_name === 'hevc' && v.codec_tag_string === 'hvc1', `${v.codec_name} ${v.codec_tag_string}`);
    ok(Math.abs((v.side_data_list || []).find((d) => d.rotation != null)?.rotation) === 90, 'rotation lost');
    ok((await md5(o, '0:v:0')) === (await md5(fx('phone.mov'), '0:v:0')), 'video was re-encoded');
    ok(/Rewrapped/.test(r[0].note || ''), `note ${r[0].note}`);
    const p = await probe(o);
    ok(p.video.width === 240 && p.video.height === 320, `display ${p.video.width}x${p.video.height}`);
  });
  T('video small re-encodes', 'convert-video', ['phone.mov'], { to: 'mp4', quality: 'small', height: '' }, async ([o]) => { const [v] = of(await ffp(o), 'video'); ok(v.codec_name === 'h264' && v.width === 240 && v.height === 320, `${v.codec_name} ${v.width}x${v.height}`); });
  T('video→apng', 'convert-video', ['clip2.mp4'], { to: 'apng', quality: 'balanced', height: '' }, async ([o]) => { const [v] = of(await ffp(o, ['-count_frames']), 'video'); ok(v.codec_name === 'apng' && v.width === 480 && Math.abs(v.nb_read_frames - 24) <= 2, `${v.codec_name} ${v.width} ${v.nb_read_frames} frames`); });
  T('video→gif never upscales', 'video-to-gif', ['odd.mp4'], { start: '0:00', duration: 2, fps: 10, width: 480 }, async ([o]) => { const m = await fmt(o, 'gif'); ok(m.width === 321 && m.pages >= 18, `gif ${m.width} ${m.pages}`); });
  T('gif→video', 'gif-to-video', ['anim.gif'], { to: 'mp4', quality: 'balanced' }, async ([o]) => { const [v] = of(await ffp(o, ['-count_frames']), 'video'); ok(v.codec_name === 'h264' && v.width === 160 && v.height === 120 && v.nb_read_frames >= 9, `${v.codec_name} ${v.width}x${v.height} ${v.nb_read_frames}`); });
  T('compress odd video', 'compress-video', ['odd.mp4'], { mode: 'level', level: 'extreme', height: '' }, async ([o]) => { const v = (await probe(o)).video; ok(v.width === 320 && v.height === 240, `${v.width}x${v.height}`); });
  T('rotate odd video', 'rotate-video', ['odd.mp4'], { angle: '90', flip: 'none' }, async ([o]) => { const j = await ffp(o), [v] = of(j, 'video'); ok(v.width === 240 && v.height === 320 && of(j, 'subtitle').length === 1, `${v.width}x${v.height}`); });
  T('trim webm precise', 'trim-media', ['clip.webm'], { start: '0:01', end: '0:02', precise: true }, async ([o]) => { const j = await ffp(o); ok(o.endsWith('.webm') && of(j, 'video')[0].codec_name === 'vp9' && of(j, 'audio')[0].codec_name === 'opus', 'webm'); await dur(o, 1, 0.3); });
  T('frames every frame', 'video-frames', ['100% clip.mp4'], { mode: 'all', format: 'png' }, async ([o]) => { ok(path.basename(o).startsWith('100% clip'), path.basename(o)); ok(Math.abs(files(o).length - 50) <= 1, `${files(o).length} frames`); await fmt(path.join(o, files(o).sort()[0]), 'png'); });
  T('subtitles mkv→srt', 'extract-subtitles', ['subs.mkv'], { to: 'srt' }, ([o]) => ok(/00:00:00,5\d\d --> 00:00:02,0\d\d\r?\nHello Lime/.test(txt(o)) && txt(o).includes('Second line'), txt(o).slice(0, 80)));
  T('subtitles mkv→ass', 'extract-subtitles', ['subs.mkv'], { to: 'ass' }, ([o]) => ok(txt(o).includes('[Script Info]') && txt(o).includes('Hello Lime'), txt(o).slice(0, 80)));
  T('subtitles mp4→vtt', 'extract-subtitles', ['odd.mp4'], { to: 'vtt' }, ([o]) => ok(txt(o).startsWith('WEBVTT') && txt(o).includes('00:00.500 --> 00:02.000') && txt(o).includes('Hello Lime'), txt(o).slice(0, 80)));
  T('audio copied from video', 'extract-audio', ['clip.mp4'], { to: 'm4a', bitrate: '' }, async ([o]) => ok((await md5(o, '0:a:0')) === (await md5(fx('clip.mp4'), '0:a:0')), 'audio was re-encoded'));
  T('audio 5.1→eac3', 'extract-audio', ['odd.mp4'], { to: 'eac3', bitrate: '' }, async ([o]) => { const j = await ffp(o), [a] = of(j, 'audio'); ok(a.codec_name === 'eac3' && a.channels === 6 && Math.abs(Number(j.format.bit_rate) - 576000) < 30000, `${a.codec_name} ${a.channels}ch ${j.format.bit_rate}`); });
  T('audio 5.1→wma', 'extract-audio', ['odd.mp4'], { to: 'wma', bitrate: '' }, async ([o]) => { const [a] = of(await ffp(o), 'audio'); ok(a.codec_name === 'wmav2' && a.channels === 2, `${a.codec_name} ${a.channels}ch`); });
  const AT = { alac: 'alac', aac: 'aac', wav: 'pcm_s16le', wma: 'wmav2', ac3: 'ac3', eac3: 'eac3', m4b: 'aac', wv: 'wavpack', tta: 'tta', caf: 'pcm_s16be', au: 'pcm_s16be', w64: 'pcm_s16le', mp2: 'mp2', mka: 'opus', weba: 'opus', voc: 'pcm_s16le', amr: 'amr_nb' };
  for (const [to, codec] of Object.entries(AT)) {
    T(`audio→${to}`, 'convert-audio', ['tone.wav'], { to, bitrate: '' }, async ([o]) => { const i = await dur(o, 3, 0.15); ok(i.audio.codec === codec, `${i.audio.codec}`); if (to === 'amr') ok(i.audio.rate === 8000 && i.audio.channels === 1, `${i.audio.rate} Hz`); }, to === 'amr' ? noEncoder(to) : null);
  }
  T('audio→wav 24-bit 16 kHz mono', 'convert-audio', ['tone.wav'], { to: 'wav', depth: '24', rate: '16000', mono: true }, async ([o]) => { const a = (await probe(o)).audio; ok(a.codec === 'pcm_s24le' && a.rate === 16000 && a.channels === 1, `${a.codec} ${a.rate} ${a.channels}`); });
  T('crop video square', 'crop-video', ['odd.mp4'], { aspect: '1:1' }, async ([o]) => { const v = (await probe(o)).video; ok(v.width === 240 && v.height === 240, `${v.width}x${v.height}`); });
  T('crop video story', 'crop-video', ['clip2.mp4'], { aspect: '9:16' }, async ([o]) => { const v = (await probe(o)).video; ok(v.width === 202 && v.height === 360, `${v.width}x${v.height}`); });
  T('crop video pixels', 'crop-video', ['clip2.mp4'], { aspect: 'custom', left: 10, top: 20, width: 101, height: 51 }, async ([o]) => { const v = (await probe(o)).video; ok(v.width === 100 && v.height === 50, `${v.width}x${v.height}`); });
  T('replace audio', 'add-audio', ['clip2.mp4', 'tone.wav'], { mode: 'replace', shortest: false }, async ([o]) => {
    const j = await ffp(o), s = await sound(o);
    ok(of(j, 'audio').length === 1 && of(j, 'audio')[0].codec_name === 'aac' && Math.abs(Number(j.format.duration) - 2) < 0.15, `${of(j, 'audio').length} tracks, ${j.format.duration} s`);
    ok(Math.abs(s.zcr / (await sound(fx('tone.wav'))).zcr - 1) < 0.1, `zero crossings ${s.zcr}: not the new sound`);
    ok((await md5(o, '0:v:0')) === (await md5(fx('clip2.mp4'), '0:v:0')), 'video was re-encoded');
  });
  T('mix in audio', 'add-audio', ['tone.wav', 'clip2.mp4'], { mode: 'mix', shortest: true }, async ([o]) => { const j = await ffp(o), s = await sound(o); ok(of(j, 'video').length === 1 && of(j, 'audio').length === 1 && Math.abs(Number(j.format.duration) - 2) < 0.2 && s.mean > -40, `${j.format.duration} s, ${s.mean} dB`); });
  T('loop video', 'loop-media', ['clip2.mp4'], { times: '3' }, async ([o]) => dur(o, 6, 0.3));
  T('loop audio', 'loop-media', ['song.mp3'], { times: '2' }, async ([o]) => dur(o, 6, 0.2));
  T('volume +6 dB', 'volume-media', ['tone.wav'], { unit: 'db', db: 6 }, async ([o]) => { const a = await sound(fx('tone.wav')), b = await sound(o); ok(Math.abs(b.mean - a.mean - 6) < 0.5, `${a.mean} → ${b.mean} dB`); });
  T('volume +30 dB never clips', 'volume-media', ['tone.wav'], { unit: 'db', db: 30 }, async ([o]) => { const a = await sound(fx('tone.wav')), b = await sound(o); ok(b.max <= -0.2 && b.mean - a.mean > 10, `max ${b.max} dB, mean ${a.mean} → ${b.mean} dB`); });
  T('volume video 50%', 'volume-media', ['clip2.mp4'], { unit: 'percent', percent: 50 }, async ([o]) => {
    const a = await sound(fx('clip2.mp4')), b = await sound(o);
    ok(Math.abs(a.mean - b.mean - 6) < 1, `${a.mean} → ${b.mean} dB`);
    ok((await md5(o, '0:v:0')) === (await md5(fx('clip2.mp4'), '0:v:0')), 'video was re-encoded');
  });
  T('reverse video', 'reverse-media', ['clip2.mp4'], {}, async ([o]) => { await dur(o, 2, 0.2); const first = await still(o, 0); const d1 = await diff(first, await still(fx('clip2.mp4'), -0.04)), d0 = await diff(first, await still(fx('clip2.mp4'), 0)); ok(d1 < d0 / 2, `first frame vs last ${d1.toFixed(1)}, vs first ${d0.toFixed(1)}`); });
  T('reverse audio', 'reverse-media', ['ramp.wav'], {}, async ([o]) => { const a = await sound(o, 0, 1), b = await sound(o, 2, 1); ok(a.mean > b.mean + 6, `start ${a.mean} dB, end ${b.mean} dB`); });
  T('fade in and out', 'fade-audio', ['tone.wav'], { fadeIn: 1, fadeOut: 1 }, async ([o]) => { await dur(o, 3, 0.1); const [a, m, z] = await Promise.all([sound(o, 0, 0.25), sound(o, 1.2, 0.6), sound(o, 2.75, 0.25)]); ok(a.mean < m.mean - 10 && z.mean < m.mean - 10, `${a.mean} / ${m.mean} / ${z.mean} dB`); });
  T('pitch up an octave', 'pitch-audio', ['tone.wav'], { semitones: 12 }, async ([o]) => { await dur(o, 3, 0.1); const r = (await sound(o)).zcr / (await sound(fx('tone.wav'))).zcr; ok(Math.abs(r - 2) < 0.1, `frequency ×${r.toFixed(2)}`); });
  const edges = async (f, region) => { const { data, info } = await sharp(f).extract(region).greyscale().raw().toBuffer({ resolveWithObject: true }); let e = 0; for (let i = 1; i < data.length; i++) if (i % info.width) e += Math.abs(data[i] - data[i - 1]); return e / data.length; };
  for (const mode of ['blur', 'pixelate']) {
    T(`${mode} area`, 'blur-video', ['clip2.mp4'], { mode, left: 0, top: 0, width: 320, height: 180, strength: 80 }, async ([o]) => {
      const [a, b] = await Promise.all([still(fx('clip2.mp4'), 1), still(o, 1)]), box = { left: 0, top: 0, width: 320, height: 180 };
      if (mode === 'blur') { const [ea, eb] = await Promise.all([edges(a, box), edges(b, box)]); ok(eb < ea * 0.6, `detail ${ea.toFixed(2)} → ${eb.toFixed(2)}`); }
      else { const d = await diff(a, b, box); ok(d > 8, `area changed by only ${d.toFixed(1)}`); }
      ok((await diff(a, b, { left: 400, top: 200, width: 240, height: 160 })) < 4, 'outside the area changed');
    });
  }
  T('gif speed', 'gif-speed', ['anim.gif'], { speed: '2' }, async ([o]) => { const m = await fmt(o, 'gif'); ok(m.pages === 10 && m.delay.every((d) => d === 50), `${m.pages} frames, ${m.delay}`); });
  T('webp speed', 'gif-speed', ['anim.webp'], { speed: '0.5' }, async ([o]) => { const m = await fmt(o, 'webp'); ok(m.pages === 10 && m.delay.every((d) => d === 200), `${m.pages} frames, ${m.delay}`); });
  for (const f of ['anim.gif', 'anim.webp']) {
    T(`reverse ${f}`, 'gif-reverse', [f], {}, async ([o]) => {
      const m = await fmt(o, f.endsWith('gif') ? 'gif' : 'webp');
      ok(m.pages === 10, `${m.pages} frames`);
      const first = sharp(o, { page: 0 }), d1 = await diff(first, sharp(fx(f), { page: 9 })), d0 = await diff(sharp(o, { page: 0 }), sharp(fx(f), { page: 0 }));
      ok(d1 < d0 / 2, `first frame vs last ${d1.toFixed(1)}, vs first ${d0.toFixed(1)}`);
    });
  }
  for (const to of ['flac', 'm4a', 'alac', 'mp3', 'ogg', 'opus', 'mka']) {
    T(`audio cover mp3→${to}`, 'convert-audio', ['song.mp3'], { to, bitrate: '' }, async ([o]) => { const j = await ffp(o); ok(of(j, 'video').some((s) => s.disposition?.attached_pic === 1), 'cover lost'); ok(titled(j), 'title lost'); });
  }
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
    if (c.skip) { console.log(`SKIP ${c.name.padEnd(34)} ${c.skip}`); results.push({ name: c.name, status: 'SKIP', detail: c.skip }); continue; }
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
  const check = async (name, fn) => {
    if (only && !only.test(name)) return;
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { status = 'FAIL'; detail = e.message; }
    console.log(`${status} ${name.padEnd(34)}        ${detail}`.slice(0, 220));
    results.push({ name, status, detail });
  };
  await check('subtitles fail cleanly without a track', async () => {
    const d = path.join(OUT, 'no-subs');
    fs.mkdirSync(d, { recursive: true });
    const id = submit({ tool: 'extract-subtitles', files: [fx('clip.mp4')], opts: { to: 'srt' }, dest: { kind: 'dir', path: d } });
    let j;
    for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(150); }
    ok(j.status !== 'done' && /no subtitle track/.test(j.error), `${j.status}: ${j.error}`);
    ok(!files(d).length, `left ${files(d)}`);
    return j.error;
  });
  await check('media targets follow the encoders', () => {
    const cat = tools.catalog(), to = (id) => cat.find((t) => t.id === id).options.find((o) => o.key === 'to').choices.map(([v]) => v);
    for (const t of ['amr', 'av1', 'hevc', 'ogv']) ok(to(t === 'amr' ? 'convert-audio' : 'convert-video').includes(t) === M.supports(t), `${t} offered without an encoder or hidden with one`);
    const enc = M.encoders();
    ok(enc?.has('libx264') && enc.has('aac'), 'no encoder list');
    ok(M.supports('av1') === (enc.has('libsvtav1') || enc.has('libaom-av1')) && M.supports('amr') === enc.has('libopencore_amrnb'), 'supports() disagrees with the encoder list');
    const v = tools.wheelsFor([fx('clip.mp4')]), a = tools.wheelsFor([fx('tone.wav')]);
    ok(v.convert.length <= 10 && a.convert.length <= 10, `rings of ${v.convert.length} and ${a.convert.length}`);
    return `AV1 ${M.supports('av1') ? (enc.has('libsvtav1') ? 'SVT-AV1' : 'libaom') : 'none'}, AMR ${M.supports('amr') ? 'yes' : 'no'}; ${v.convert.map((w) => w.label)} | ${a.convert.map((w) => w.label)}`;
  });
  const fail = results.filter((r) => r.status === 'FAIL'), skip = results.filter((r) => r.status === 'SKIP');
  console.log(`\n${results.length - fail.length - skip.length}/${results.length - skip.length} passed${skip.length ? `, ${skip.length} skipped` : ''}`);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(results, null, 1));
  app.isQuitting = true;
  app.exit(fail.length ? 1 : 0);
};
