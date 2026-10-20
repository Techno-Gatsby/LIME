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
  const docxPart = (p, f = 'word/document.xml') => { const z = require('fflate').unzipSync(new Uint8Array(read(p))); return z[f] ? Buffer.from(z[f]).toString() : ''; };
  const xmlText = (x) => (x.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) || []).map((t) => (t === '<w:tab/>' ? '\t' : t === '<w:br/>' ? '\n' : t.replace(/<[^>]+>/g, ''))).join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const docxBlocks = (p) => (docxPart(p).match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g) || []).map((x) => (x.startsWith('<w:tbl>')
    ? { x, rows: x.match(/<w:tr\b[\s\S]*?<\/w:tr>/g).map((r) => (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map((c) => ({ x: c, t: (c.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map(xmlText).filter(Boolean).join('\n'), span: +(/<w:gridSpan w:val="(\d+)"/.exec(c)?.[1] || 1), merge: /<w:vMerge w:val="(\w+)"/.exec(c)?.[1] || '' }))) }
    : { x, t: xmlText(x), style: /<w:pStyle w:val="([^"]+)"/.exec(x)?.[1] || '' }));
  const paras = (p) => docxBlocks(p).filter((b) => !b.rows && b.t.trim()).map((b) => b.t);
  const same = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)}`);
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
  const FIRST = 'Lime converts files on your own computer. This paragraph is long enough to wrap over several lines, so the reader has to join the lines again into one paragraph without losing or doubling any of the words in it.';
  const SECOND = 'The second page continues the report with more details. Headers and footers repeat on every page and are left out.';
  T('pdf→docx paragraphs, headings, runs, links, pictures', 'pdf-to-word', ['layout-report.pdf'], {}, ([o]) => {
    const bl = docxBlocks(o).filter((b) => !b.rows && b.t.trim()), x = docxPart(o);
    same(bl.map((b) => b.t), ['Annual Report 2026', '1. Introduction', FIRST, 'Warning this line is italic', 'Visit https://example.com', '2. Details', SECOND,
      'Every invoice of the second quarter was paid in full; the remaining ones are due by October 31.', 'The formula E = mc2 has a superscript.'], 'paragraphs');
    same(bl.map((b) => b.style), ['Heading1', 'Heading2', '', '', '', 'Heading2', '', '', ''], 'headings by size');
    ok(/<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">2/.test(bl[8].x), 'superscript');
    ok(/<w:b\/>.*<w:color w:val="FF0000"\/>.*>Warning <\/w:t>.*<w:i\/>.*this line is italic/.test(bl[3].x) && /w:ascii="Arial"/.test(bl[3].x) && /<w:color w:val="000000"\/><w:sz w:val="22"\/>/.test(bl[2].x), 'run formatting');
    ok(/<w:hyperlink [^>]*>.*Visit/.test(bl[4].x) && /Target="https:\/\/example\.com\/" TargetMode="External"/.test(docxPart(o, 'word/_rels/document.xml.rels')), 'link');
    ok(/<w:pageBreakBefore\/>/.test(bl[5].x) && !/<w:br w:type="page"\/>/.test(x), 'page 2 starts with a page break before its heading');
    ok(!/Quarterly|Page \d/.test(paras(o).join('\n')), 'running header or footer kept');
    same([...x.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((m) => `${m[1]}x${m[2]}`), ['2540000x1524000', '1270000x1270000'], 'pictures at their drawn size');
    const z = zipHas(o, 'word/media/'), media = (e) => Object.keys(z).filter((k) => k.startsWith('word/media/') && k.endsWith(e));
    ok(media('.jpg').length === 1 && Buffer.from(z[media('.jpg')[0]]).equals(read(fx('layout-photo.jpg'))) && media('.png').length === 1, 'JPEG not passed through as it was');
    ok(/<dc:title>Lime Annual Report<\/dc:title>/.test(docxPart(o, 'docProps/core.xml')) && /<w:pgSz w:w="11900" w:h="16840"/.test(x), 'title or page size');
    same(['ABCDEF+TimesNewRomanPS-BoldMT', 'Arial-BoldMT', 'Helvetica-Oblique', 'QWERTY+MalgunGothic,Bold', 'NanumGothic', 'F1', 'T3Font_2'].map(E('pdfread').fontFamily), ['Times New Roman', 'Arial', 'Arial', 'Malgun Gothic', 'NanumGothic', null, null], 'font families');
  });
  T('pdf→docx two columns in reading order', 'pdf-to-word', ['layout-columns.pdf'], {}, ([o]) => {
    const t = (l) => `${l} paragraph of the column: it has enough words to wrap over a few lines inside its narrow column of text.`;
    same(paras(o), ['Two Column Layout', t('Left first'), t('Left second'), t('Right first'), t('Right second'), 'A closing paragraph spans both columns again at the end of the page, below everything else.'], 'reading order');
  });
  T('pdf→docx tabbed rows and address breaks', 'pdf-to-word', ['layout-schedule.pdf'], {}, ([o]) => {
    same(paras(o).filter((p) => /[\t\n]/.test(p)), ['1.\tRFP Published\t08/14/2026', '2.\tProposal Submission\t10/16/2026', '3.\tProposal Selection\t10/19/2026', '1880 Willamette Falls Drive, Ste. 200E\nWest Linn, Oregon 97068', 'Name:\tJEFFREY P. GABLER', 'Organization:\tWESTAR COUNCIL', 'Phone:\t503-657-4838'], 'tabbed rows');
    same([...docxBlocks(o).find((b) => b.t?.startsWith('1.\t')).x.matchAll(/<w:tab w:val="left" w:pos="(\d+)"\/>/g)].map((m) => m[1]), ['1080', '7560'], 'tab stops');
    ok(paras(o).includes('WESTAR') && paras(o).includes('Attn: Jeffrey P. Gabler'), 'address lines joined');
  });
  T('pdf→docx scanned and turned pages as page pictures', 'pdf-to-word', ['layout-scan.pdf'], {}, ([o]) => {
    const x = docxPart(o);
    same([...x.matchAll(/<wp:anchor [^>]*behindDoc="1"[^>]*>.*?<wp:positionH relativeFrom="page"><wp:posOffset>0<\/wp:posOffset>.*?<wp:positionV relativeFrom="page"><wp:posOffset>0<\/wp:posOffset>.*?<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((m) => `${m[1]}x${m[2]}`), ['7556500x10693400', '10693400x7556500'], 'page pictures');
    same(paras(o), ['Text after the scan'], 'text (invisible OCR text or the turned page leaked)');
    ok(/<w:pageBreakBefore\/>/.test(docxBlocks(o).find((b) => b.t === 'Text after the scan').x) && /<w:pgSz w:w="16840" w:h="11900" w:orient="landscape"\/>/.test(x), 'page break or turned page size');
  });
  T('pdf→docx drops running heads, page numbers, logos', 'pdf-to-word', ['layout-book.pdf'], {}, ([o]) => {
    const bl = docxBlocks(o).filter((b) => !b.rows && b.t.trim()), all = bl.map((b) => b.t);
    ok(!all.some((t) => /Chapter|^(i|ii|iii|iv|v|vi|vii|viii)$/.test(t.trim())), `running head or page number kept: ${all.join(' | ')}`);
    ok(bl.filter((b) => b.t === 'Overview' && b.style === 'Heading1').length === 3, 'the larger heading at the top of three pages was dropped');
    for (let p = 1; p <= 8; p++) ok(all.some((t) => t.startsWith(`Body text of page ${p} `)), `page ${p} body missing`);
    ok((docxPart(o).match(/<w:drawing>/g) || []).length === 1 && Object.keys(zipHas(o, 'word/media/')).filter((k) => /^word\/media\/.+\.jpg$/.test(k)).length === 1, 'logo kept or photo lost');
  });
  T('pdf→docx joins Korean with spaces, Chinese without', 'pdf-to-word', ['layout-cjk.pdf'], {}, ([o]) => same(paras(o), ['한글 문단도 읽을 수 있어야 합니다. 줄이 바뀌어도 한 문단으로 이어지고 단어 사이의 빈칸도 그대로 남습니다.', '中文段落也应该能够正确读取。换行之后仍然是同一个段落，字与字之间不应该出现多余的空格。'], 'paragraphs'));
  T('pdf→docx ruled table between paragraphs', 'pdf-to-word', ['layout-table.pdf'], {}, ([o]) => {
    const bl = docxBlocks(o).filter((b) => b.rows || b.t.trim()), t = bl[1];
    ok(bl.length === 3 && bl[0].t.startsWith('The files converted') && t.rows && bl[2].t.startsWith('Everything was converted'), `blocks ${bl.map((b) => (b.rows ? 'TABLE' : b.t.slice(0, 20)))}`);
    same(t.rows.map((r) => r.map((c) => c.t)), [['Name', 'Format', 'Size'], ['Report', 'PDF', '120 KB'], ['Photo', 'JPEG', '2.4 MB']], 'cells');
    same([...t.x.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => +m[1]), [3000, 3000, 3900], 'column widths');
    ok([...t.x.matchAll(/<w:trHeight w:val="(\d+)" w:hRule="atLeast"\/>/g)].map((m) => +m[1]).join() === '400,400,400', 'row heights');
    ok(t.rows.flat().every((c) => ['top', 'left', 'bottom', 'right'].every((s) => new RegExp(`<w:${s} w:val="single"`).test(c.x))) && /<w:b\/>/.test(t.rows[0][0].x) && !/<w:b\/>/.test(t.rows[1][0].x), 'borders or bold header');
  });
  T('pdf→docx missing inner rules become merged cells', 'pdf-to-word', ['layout-merged.pdf'], {}, ([o]) => same(docxBlocks(o).find((b) => b.rows).rows.map((r) => r.map((c) => c.t + (c.span > 1 ? `[${c.span}]` : '') + (c.merge ? `[${c.merge}]` : ''))), [['Region and city[2]', 'Total'], ['North[restart]', 'Seoul', '10'], ['[continue]', 'Busan', '20']], 'cells'));
  T('pdf→docx bar rules keep weight and shading', 'pdf-to-word', ['layout-bars.pdf'], {}, ([o]) => {
    const t = docxBlocks(o).find((b) => b.rows), sz = (c, s) => +new RegExp(`<w:${s} w:val="single"[^>]*w:sz="(\\d+)"`).exec(c.x)?.[1];
    same(t.rows.map((r) => r.map((c) => c.t)), [['Test', 'Before', 'After'], ['Speed', '12 s', '4 s'], ['Memory', '800 MB', '300 MB']], 'cells');
    const corner = t.rows[0][0], inner = t.rows[1][1], mm = sz(corner, 'left') / 8 * 25.4 / 72;
    ok(sz(corner, 'top') > 2 * sz(inner, 'top') && mm >= 0.5 && mm <= 1, `borders ${sz(corner, 'top')} vs ${sz(inner, 'top')}, left ${mm} mm`);
    ok(t.rows[0].every((c) => /w:fill="D9D9D9"/.test(c.x)) && !/w:fill=/.test(inner.x), 'shading');
  });
  T('pdf→docx boxes and empty grids stay text', 'pdf-to-word', ['layout-boxes.pdf'], {}, ([o]) => {
    ok(!docxBlocks(o).some((b) => b.rows), 'a box became a table');
    same(paras(o), ['Note', 'A box drawn around a note is no table, even with a rule under its title line.', 'Important words', 'Chart axis label'], 'paragraphs');
  });
  T('pdf→docx password-protected message', 'pdf-to-word', ['layout-locked.pdf'], {}, /password/i);
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
  T('pdf→xlsx ruled table into cells', 'pdf-to-excel', ['layout-table.pdf'], { to: 'xlsx' }, ([o]) => {
    const X = require('xlsx'), rows = X.utils.sheet_to_json(X.readFile(o).Sheets['Page 1'], { header: 1, defval: '' }), i = rows.findIndex((r) => r[0] === 'Name');
    same(rows.slice(i, i + 3).map((r) => r.slice(0, 3)), [['Name', 'Format', 'Size'], ['Report', 'PDF', '120 KB'], ['Photo', 'JPEG', '2.4 MB']], 'table rows');
    ok(String(rows[i - 1]?.[0]).startsWith('The files converted') && String(rows[i + 3]?.[0]).startsWith('Everything was converted'), `text around the table: ${JSON.stringify(rows)}`);
  });
  T('pdf→xlsx merged cells', 'pdf-to-excel', ['layout-merged.pdf'], { to: 'xlsx' }, ([o]) => {
    const X = require('xlsx'), ws = X.readFile(o).Sheets['Page 1'];
    same((ws['!merges'] || []).map((m) => X.utils.encode_range(m)).sort(), ['A1:B1', 'A2:A3'], 'merges');
    same(['A1', 'C1', 'A2', 'B2', 'C2', 'B3', 'C3'].map((k) => ws[k]?.v), ['Region and city', 'Total', 'North', 'Seoul', 10, 'Busan', 20], 'cells');
  });
  T('pdf→jpg', 'pdf-to-jpg', ['doc.pdf'], { format: 'jpg', dpi: '96', pages: 'all' }, async ([o]) => { const fl = files(o); ok(fl.length === 3, `${fl.length} images`); await fmt(path.join(o, fl[0]), 'jpeg'); });
  T('pdf→tiff every page', 'pdf-to-tiff', ['mixed.pdf'], { dpi: '72' }, async ([o]) => { const m = await sharp(o).metadata(); ok(m.format === 'tiff' && m.pages === 2, `tiff pages ${m.pages}`); const p2 = await sharp(o, { page: 1 }).metadata(); ok(p2.width === 842 && p2.height === 595, `page 2 ${p2.width}×${p2.height}`); });
  T('pdf→cbz', 'pdf-to-cbz', ['doc.pdf'], {}, async ([o]) => { const z = require('fflate').unzipSync(new Uint8Array(read(o))); ok(Object.keys(z).join() === '001.jpg,002.jpg,003.jpg', `entries ${Object.keys(z)}`); ok((await sharp(Buffer.from(z['002.jpg'])).metadata()).format === 'jpeg', 'not jpeg'); });
  T('pdf→md', 'pdf-to-markdown', ['doc.pdf'], {}, ([o]) => ok(/Lime test document/.test(txt(o)) && /quick brown fox/.test(txt(o)), `markdown: ${txt(o).slice(0, 120)}`));
  T('pdf→md headings without running heads', 'pdf-to-markdown', ['layout-report.pdf'], {}, ([o]) => ok(txt(o).replace(/__/g, '').startsWith(`# Annual Report 2026\n\n## 1\\. Introduction\n\n${FIRST.replace(/\./g, '\\.')}\n\n`) && /## (__)?2\\\. Details/.test(txt(o)) && !/Quarterly|Page \d/.test(txt(o)), `markdown: ${txt(o).slice(0, 160)}`));
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
    n++;
    const dest = { kind: 'dir', path: path.join(OUT, String(n).padStart(3, '0')) };
    fs.mkdirSync(dest.path, { recursive: true });
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try {
      const id = submit({ tool: c.tool, files: c.inputs, opts: c.opts, dest });
      let j;
      for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(150); if (Date.now() - t0 > 240000) throw new Error('timeout'); }
      if (c.check instanceof RegExp) {
        ok(j.status !== 'done' && c.check.test(String(j.error)), `expected an error like ${c.check}, got ${j.status}: ${j.error}`);
        detail = String(j.error);
      } else {
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
