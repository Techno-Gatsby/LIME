import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dir = process.argv[2] || path.join(process.cwd(), 'test', 'fx');
const extra = process.argv[3] || '';
fs.mkdirSync(dir, { recursive: true });
const P = (f) => path.join(dir, f);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const WIN = process.platform === 'win32', EXE = WIN ? '.exe' : '', PT = `${process.platform}-${process.arch}`;
const vendored = (n, alt = n) => [path.resolve('vendor/bin', PT, n + EXE)].find((f) => fs.existsSync(f)) || alt;
const crafts = path.resolve('vendor/crafts', PT), unpacked = fs.mkdtempSync(path.join(os.tmpdir(), 'lime-cli-'));
const cli = (n) => {
  const f = path.join(crafts, `${n}-cli${EXE}`);
  if (fs.existsSync(f) || !fs.existsSync(`${f}.br`)) return f;
  const out = path.join(unpacked, path.basename(f));
  if (!fs.existsSync(out)) fs.writeFileSync(out, zlib.brotliDecompressSync(fs.readFileSync(`${f}.br`)), { mode: 0o755 });
  return out;
};
const ffmpeg = vendored('ffmpeg'), sevenZ = vendored(WIN ? '7z' : '7zz', '7z');
const TAR = WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const NOTO = path.resolve('vendor/data/fonts/NotoSans-Regular.ttf');
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const label = async (w, h, bg, fg, size, x, y, out) => {
  const text = await sharp({ text: { text: `<span foreground="${fg}">${esc(SENTENCE)}</span>`, font: `Noto Sans ${size}`, fontfile: NOTO, rgba: true, dpi: 72 } }).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 3, background: bg } }).composite([{ input: text, left: x, top: y }]).png().toFile(out);
};
const SENTENCE = 'The quick brown fox jumps over the lazy dog. Invoice 2026-0419 total due: $1,284.50 by October 31.';
fs.writeFileSync(P('sentence.txt'), SENTENCE);

const sharp = require('sharp');
await sharp({ create: { width: 1600, height: 1067, channels: 3, background: '#6aa83a' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c6e87a"/><stop offset="1" stop-color="#2c6413"/></linearGradient></defs><rect width="1600" height="1067" fill="url(#g)"/><circle cx="800" cy="533" r="300" fill="#f5fbe3"/><circle cx="1200" cy="300" r="120" fill="#ffd34d"/></svg>') }]).jpeg({ quality: 90 }).withMetadata({ exif: { IFD0: { Make: 'LimeCam', Model: 'Test' } } }).toFile(P('photo.jpg'));
await sharp(P('photo.jpg')).resize(800).png().toFile(P('photo.png'));
await sharp(P('photo.jpg')).resize(640).webp().toFile(P('photo.webp'));
await sharp(P('photo.jpg')).resize(400).toFile(P('photo2.jpg'));
await sharp(P('photo.jpg')).resize(500).tiff().toFile(P('photo.tiff'));
await sharp({ create: { width: 600, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><circle cx="300" cy="300" r="220" fill="#86c23a"/></svg>') }]).png().toFile(P('alpha.png'));
await label(1400, 220, '#ffffff', '#222222', 22, 30, 98, P('text.png'));
await label(900, 70, '#1e1e1e', '#dddddd', 15, 10, 25, P('dark-text.png'));
try { process.platform === 'darwin' ? sh('sips', ['-s', 'format', 'heic', P('photo.png'), '--out', P('photo.heic')]) : sh('heif-enc', ['-q', '80', P('photo.png'), '-o', P('photo.heic')]); } catch (_) { fs.copyFileSync(path.join(import.meta.dirname, 'samples', 'photo.heic'), P('photo.heic')); }
try { sh(cli('photocraft'), ['convert', P('photo.png'), P('layers.psd')]); } catch (e) { console.log('psd', e.message); }
try { sh(cli('lightcraft'), ['render', P('alpha.png'), '-o', P('photo.jxl')]); } catch (e) { console.log('jxl', e.message); }
try { sh(cli('lightcraft'), ['synth-merge', 'panorama', '-o', P('pano')]); } catch (e) { console.log('pano', e.message); }
try { sh(cli('lightcraft'), ['synth-merge', 'hdr', '-o', P('hdr')]); fs.copyFileSync(P('hdr/bracket-1.dng'), P('raw.dng')); } catch (e) { console.log('dng', e.message); }

const { PDFDocument, StandardFonts } = require('pdf-lib');
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 3; i++) {
  const page = pdf.addPage([595, 842]);
  page.drawText(`Page ${i} of the Lime test document`, { x: 60, y: 760, size: 22, font });
  page.drawText(SENTENCE, { x: 60, y: 720, size: 11, font });
  page.drawText('Contact: hello@example.com, +1 415 555 0101', { x: 60, y: 690, size: 11, font });
  const img = await pdf.embedJpg(fs.readFileSync(P('photo2.jpg')));
  page.drawImage(img, { x: 60, y: 300, width: 400, height: 267 });
}
fs.writeFileSync(P('doc.pdf'), await pdf.save());
const scan = await PDFDocument.create();
const png = await scan.embedPng(fs.readFileSync(P('text.png')));
scan.addPage([700, 110]).drawImage(png, { x: 0, y: 0, width: 700, height: 110 });
fs.writeFileSync(P('scan.pdf'), await scan.save());

const D = require('docx');
const docx = new D.Document({ sections: [{ children: [
  new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun('Lime Report')] }),
  new D.Paragraph({ children: [new D.TextRun({ text: 'Bold intro. ', bold: true }), new D.TextRun(SENTENCE)] }),
  new D.Paragraph({ text: 'First bullet', bullet: { level: 0 } }),
  new D.Paragraph({ text: 'Second bullet', bullet: { level: 0 } }),
  new D.Table({ rows: [new D.TableRow({ children: ['Item', 'Price'].map((t) => new D.TableCell({ children: [new D.Paragraph(t)] })) }), new D.TableRow({ children: ['Limes', '4.20'].map((t) => new D.TableCell({ children: [new D.Paragraph(t)] })) })] }),
] }] });
fs.writeFileSync(P('doc.docx'), await D.Packer.toBuffer(docx));
fs.writeFileSync(P('doc.md'), `# Lime Notes\n\n${SENTENCE}\n\n- Alpha item\n- Beta item\n\n| Fruit | Count |\n| --- | --- |\n| Lime | 12 |\n\n\`\`\`\nconst lime = 1;\n\`\`\`\n`);
fs.writeFileSync(P('doc.html'), `<!doctype html><html><head><title>Lime page</title></head><body><h1>Lime Page</h1><p>${SENTENCE}</p><ul><li>One</li><li>Two</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>`);
fs.writeFileSync(P('doc.txt'), `Lime plain text\n\n${SENTENCE}\n`);
fs.writeFileSync(P('doc.rtf'), `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0\\fs24 {\\b Lime RTF heading}\\par ${SENTENCE.replace(/\$/g, '\\$')}\\par Second paragraph with caf\\'e9.\\par}`);
const { zipSync, strToU8 } = require('fflate');
fs.writeFileSync(P('doc.odt'), zipSync({ mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }], 'META-INF/manifest.xml': strToU8('<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>'), 'content.xml': strToU8(`<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:h text:outline-level="1">Lime ODT</text:h><text:p>${SENTENCE}</text:p></office:text></office:body></office:document-content>`) }));
const office = require(path.resolve('src/main/engines/office.js'));
await office.htmlToEpub(`<h1>Lime Book</h1><p>${SENTENCE}</p><p>Chapter text.</p>`, 'Lime Book', P('book.epub'));

const XLSX = require('xlsx');
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fruit', 'Count', 'Price'], ['Lime', 12, 0.4], ['Lemon', 7, 0.5], ['Orange', 3, 0.9]]), 'Fruit');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Month', 'Sales'], ['Jan', 100], ['Feb', 140]]), 'Sales');
XLSX.writeFile(wb, P('sheet.xlsx'));
fs.writeFileSync(P('sheet.csv'), 'Fruit,Count\nLime,12\nLemon,7\n');
fs.writeFileSync(P('sheet2.csv'), 'Fruit,Count\nKiwi,5\n');
fs.writeFileSync(P('data.json'), JSON.stringify([{ name: 'Lime', count: 12 }, { name: 'Lemon', count: 7 }], null, 2));
const Pptx = require('pptxgenjs');
const deck = new Pptx();
const s1 = deck.addSlide();
s1.background = { color: 'F5FBE3' };
s1.addText('Lime Deck', { x: 0.5, y: 0.6, w: 9, h: 1, fontSize: 40, bold: true, color: '2C6413' });
s1.addText([{ text: 'First point', options: { bullet: true } }, { text: 'Second point', options: { bullet: true } }], { x: 0.5, y: 2, w: 6, h: 2, fontSize: 20 });
s1.addImage({ path: P('photo2.jpg'), x: 6.5, y: 2, w: 3, h: 2 });
const s2 = deck.addSlide();
s2.addText('Numbers', { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 32 });
s2.addTable([['Fruit', 'Count'], ['Lime', '12']], { x: 0.5, y: 1.5, w: 6 });
s2.addShape(deck.ShapeType.ellipse, { x: 7, y: 2, w: 2, h: 2, fill: { color: '86C23A' } });
await deck.writeFile({ fileName: P('deck.pptx') });

sh(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', P('clip.mp4')]);
sh(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=660', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', P('clip2.mp4')]);
sh(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100', '-t', '3', P('tone.wav')]);
sh(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=44100', '-t', '2', '-c:a', 'libmp3lame', '-b:a', '128k', P('tone.mp3')]);
fs.writeFileSync(P('sub.srt'), '1\n00:00:00,500 --> 00:00:02,000\nHello Lime\n\n2\n00:00:02,500 --> 00:00:03,800\nSecond line\n');
fs.mkdirSync(P('folder/inner'), { recursive: true });
fs.writeFileSync(P('folder/a.txt'), 'alpha');
fs.writeFileSync(P('folder/inner/b.txt'), 'beta');
for (const [f, t] of [['archive.zip', 'zip'], ['archive.7z', '7z']]) { fs.rmSync(P(f), { force: true }); sh(sevenZ, ['a', `-t${t}`, P(f), 'a.txt', 'inner'], { cwd: P('folder') }); }
sh(TAR, ['-czf', P('archive.tar.gz'), '-C', P('folder'), '.']);

const cadS = extra || path.join(import.meta.dirname, 'samples');
for (const f of ['test.dxf', 'sample_2018.dwg', 'as1.stp', 'cube.igs']) if (cadS && fs.existsSync(path.join(cadS, f))) fs.copyFileSync(path.join(cadS, f), P(f === 'as1.stp' ? 'part.stp' : f));
const cad = require(path.resolve('src/main/engines/cad.js'));
const cube = { pos: Float32Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10]), idx: Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]) };
fs.writeFileSync(P('cube.stl'), cad.writeStl(cube));
{
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const d = await PDFDocument.create(), font = await d.embedFont(StandardFonts.Helvetica);
  for (const [w, h, t] of [[595, 842, 'Portrait page'], [842, 595, 'Landscape page']]) d.addPage([w, h]).drawText(t, { x: 60, y: h - 100, size: 28, font });
  fs.writeFileSync(P('mixed.pdf'), await d.save());
}
fs.writeFileSync(P('unicode.dxf'), ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1021', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '200', '21', '0', '0', 'TEXT', '8', '0', '10', '10', '20', '20', '40', '8', '1', 'Größe Ω Привет', '0', 'ENDSEC', '0', 'EOF', ''].join('\n'));
{
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const poly = (flags, pts) => ['92', flags, '72', '0', '73', '1', '93', pts.length, ...pts.flatMap(([x, y]) => ['10', x, '20', y]), '97', '0'];
  const edges = (pts) => ['92', '1', '93', pts.length, ...pts.flatMap(([x, y], k) => { const [x2, y2] = pts[(k + 1) % pts.length]; return ['72', '1', '10', x, '20', y, '11', x2, '21', y2]; }), '97', '0'];
  const hatch = (name, solid, paths) => ['0', 'HATCH', '8', '0', '62', '1', '10', '0', '20', '0', '30', '0', '210', '0', '220', '0', '230', '1', '2', name, '70', solid, '71', '0', '91', paths.length, ...paths.flat(), '75', '0', '76', '1', ...(solid === '1' ? [] : ['52', '45', '41', '1', '77', '0', '78', '1', '53', '45', '43', '0', '44', '0', '45', '-2.24', '46', '2.24', '79', '0']), '98', '0'];
  fs.writeFileSync(P('hatch.dxf'), ['0', 'SECTION', '2', 'ENTITIES', ...hatch('SOLID', '1', [poly('3', sq(0, 0, 100, 100)), poly('2', sq(25, 25, 75, 75))]), ...hatch('ANSI31', '0', [edges(sq(200, 0, 300, 100))]), '0', 'ENDSEC', '0', 'EOF', ''].join('\n'));
}
{
  const { PDFDocument } = require('pdf-lib');
  const d = await PDFDocument.create(), page = d.addPage([612, 792]);
  const chart = Buffer.alloc(1200 * 800 * 3);
  for (let y = 0; y < 800; y++) for (let x = 0; x < 1200; x++) { const k = ((x >> 3) * 7 + (y >> 3) * 13) % 200, o = (y * 1200 + x) * 3; chart[o] = (k * 37) & 255; chart[o + 1] = (k * 91) & 255; chart[o + 2] = (k * 53) & 255; }
  page.drawImage(await d.embedJpg(fs.readFileSync(P('photo.jpg'))), { x: 36, y: 600, width: 144, height: 96 });
  page.drawImage(await d.embedPng(await sharp(chart, { raw: { width: 1200, height: 800, channels: 3 } }).png().toBuffer()), { x: 36, y: 36, width: 540, height: 360 });
  fs.writeFileSync(P('images.pdf'), await d.save());
}
{
  // PDF → Word layout cases (after Filee's PdfReaderTests / PdfTableTests): y is points from the page's top, text y its baseline.
  const L = require('pdf-lib'), { PDFDocument, StandardFonts, rgb, PDFString, degrees } = L;
  const gradient = (w, h) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g"><stop offset="0" stop-color="#f80"/><stop offset="1" stop-color="#04a"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`));
  const photo = await gradient(200, 120).jpeg({ quality: 80 }).toBuffer(), chart = await gradient(100, 100).png().toBuffer(), logo = await gradient(60, 30).png().toBuffer();
  fs.writeFileSync(P('layout-photo.jpg'), photo);
  const make = async (file, draw) => {
    const d = await PDFDocument.create(), F = { r: await d.embedFont(StandardFonts.Helvetica), b: await d.embedFont(StandardFonts.HelveticaBold), i: await d.embedFont(StandardFonts.HelveticaOblique) };
    const embedded = new Map();
    let pg, H;
    const b = {
      page: (w = 595, h = 842) => { pg = d.addPage([w, h]); H = h; return pg; },
      width: (t, size, f = 'r') => F[f].widthOfTextAtSize(t, size),
      line: (t, size, x, y, f = 'r', c) => pg.drawText(t, { x, y: H - y, size, font: F[f], ...(c ? { color: rgb(c[0] / 255, c[1] / 255, c[2] / 255) } : {}) }),
      para: (t, size, x, y, width, leading, f = 'r') => {
        let cur = '';
        for (const w of t.split(' ')) { const next = cur ? `${cur} ${w}` : w; if (cur && b.width(next, size, f) > width) { b.line(cur, size, x, y, f); y += leading; cur = w; } else cur = next; }
        if (cur) { b.line(cur, size, x, y, f); y += leading; }
        return y;
      },
      rule: (x1, y1, x2, y2, t = 0.5) => pg.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: t, color: rgb(0, 0, 0) }),
      bar: (x, y, w, h, c = [0, 0, 0]) => pg.drawRectangle({ x, y: H - y - h, width: w, height: h, color: rgb(c[0] / 255, c[1] / 255, c[2] / 255) }),
      picture: async (data, x, y, w, h) => {
        if (!embedded.has(data)) embedded.set(data, data[0] === 0xff ? await d.embedJpg(data) : await d.embedPng(data));
        pg.drawImage(embedded.get(data), { x, y: H - y - h, width: w, height: h });
      },
      link: (url, x, y, w, h) => pg.node.addAnnot(d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, H - y - h, x + w, H - y], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } }))),
      hidden: (t, size, x, y) => { pg.pushOperators(L.pushGraphicsState(), L.setTextRenderingMode(L.TextRenderingMode.Invisible)); b.line(t, size, x, y); pg.pushOperators(L.popGraphicsState()); },
    };
    await draw(b, d);
    fs.writeFileSync(P(file), await d.save());
  };
  await make('layout-report.pdf', async (b, d) => {
    d.setTitle('Lime Annual Report');
    for (let p = 1; p <= 2; p++) {
      b.page();
      b.line('Lime Quarterly Report', 9, 50, 30);
      b.line(`Page ${p}`, 9, 280, 815);
      if (p === 1) {
        b.line('Annual Report 2026', 24, 50, 90, 'b');
        b.line('1. Introduction', 16, 50, 135, 'b');
        const y = b.para('Lime converts files on your own computer. This paragraph is long enough to wrap over several lines, so the reader has to join the lines again into one paragraph without losing or doubling any of the words in it.', 11, 50, 165, 495, 14);
        b.line('Warning', 11, 50, y + 12, 'b', [255, 0, 0]);
        b.line(' this line is italic', 11, 50 + b.width('Warning', 11, 'b'), y + 12, 'i');
        b.line('Visit https://example.com', 11, 50, y + 40);
        b.link('https://example.com/', 50, y + 30, 150, 14);
        await b.picture(photo, 50, y + 60, 200, 120);
        await b.picture(chart, 300, y + 60, 100, 100);
      } else {
        b.line('2. Details', 16, 50, 90, 'b');
        const y = b.para('The second page continues the report with more details. Headers and footers repeat on every page and are left out.', 11, 50, 120, 495, 14);
        b.line('Every invoice of the second quarter was paid in full; the remaining ones are due by October', 11, 50, y + 14);
        b.line('31.', 11, 50, y + 28);
        const x = 50 + b.width('The formula E = mc', 11);
        b.line('The formula E = mc', 11, 50, y + 56);
        b.line('2', 7, x, y + 52);
        b.line(' has a superscript.', 11, x + b.width('2', 7), y + 56);
      }
    }
  });
  await make('layout-columns.pdf', (b) => {
    b.page();
    b.line('Two Column Layout', 20, 50, 70, 'b');
    const text = (label) => `${label} paragraph of the column: it has enough words to wrap over a few lines inside its narrow column of text.`;
    b.para(text('Left second'), 10, 50, b.para(text('Left first'), 10, 50, 110, 230, 13) + 10, 230, 13);
    const r = b.para(text('Right second'), 10, 315, b.para(text('Right first'), 10, 315, 110, 230, 13) + 10, 230, 13);
    b.para('A closing paragraph spans both columns again at the end of the page, below everything else.', 10, 50, r + 40, 495, 13);
  });
  await make('layout-schedule.pdf', (b) => {
    b.page(612, 792);
    b.para('E. PROPOSED SCHEDULE OF ACTIVITIES: the dates below may change. This paragraph is long enough to wrap, so the page has a full text width.', 12, 54, 60, 500, 15);
    [['1.', 'RFP Published', '08/14/2026'], ['2.', 'Proposal Submission', '10/16/2026'], ['3.', 'Proposal Selection', '10/19/2026']].forEach((row, r) => row.forEach((t, k) => b.line(t, 12, [76.5, 108, 432][k], 110 + r * 14.6)));
    b.para('F. INQUIRIES: Send all inquiries (transmittal by E-Mail preferred) to the address below, which is the only one.', 12, 54, 170, 500, 15);
    ['WESTAR', '1880 Willamette Falls Drive, Ste. 200E', 'West Linn, Oregon 97068', 'Attn: Jeffrey P. Gabler'].forEach((t, k) => b.line(t, 12, 144, 215 + k * 14.6));
    [['Name:', 'JEFFREY P. GABLER'], ['Organization:', 'WESTAR COUNCIL'], ['Phone:', '503-657-4838']].forEach(([k, v], r) => { b.line(k, 11, 72, 300 + r * 14); b.line(v, 11, 176, 300 + r * 14); });
  });
  await make('layout-scan.pdf', async (b) => {
    b.page();
    await b.picture(await gradient(595, 842).jpeg().toBuffer(), 0, 0, 595, 842);
    b.hidden('Hidden OCR words', 12, 50, 80);
    b.page();
    b.line('Text after the scan', 12, 50, 80);
    b.page().setRotation(degrees(90));
    b.line('Turned page text', 12, 50, 80);
  });
  await make('layout-book.pdf', async (b) => {
    for (let p = 1; p <= 8; p++) {
      b.page();
      b.line(p <= 3 ? 'Chapter One: Beginnings' : 'Chapter Two: Results', 9, 50, 30);
      await b.picture(logo, 485, 15, 60, 30);
      b.line(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'][p - 1], 9, 295, 815);
      if (p <= 3) b.line('Overview', 16, 50, 75, 'b');
      b.para(`Body text of page ${p} goes on long enough to be a real paragraph of the book.`, 11, 50, 120, 495, 14);
      if (p === 2) await b.picture(photo, 50, 200, 200, 120);
    }
  });
  const cell = (b, t, x, y, bold) => b.line(t, 10, x + 4, y + 14, bold ? 'b' : 'r');
  await make('layout-table.pdf', (b) => {
    b.page();
    b.para('The files converted this week are listed in the table below, with their format and size.', 11, 50, 80, 495, 14);
    const xs = [50, 200, 350, 545], ys = [110, 130, 150, 170];
    ys.forEach((y) => b.rule(xs[0], y, xs[3], y));
    xs.forEach((x) => b.rule(x, ys[0], x, ys[3]));
    [['Name', 'Format', 'Size'], ['Report', 'PDF', '120 KB'], ['Photo', 'JPEG', '2.4 MB']].forEach((row, r) => row.forEach((t, c) => cell(b, t, xs[c], ys[r], r === 0)));
    b.para('Everything was converted on this computer; nothing was uploaded anywhere.', 11, 50, 200, 495, 14);
  });
  await make('layout-merged.pdf', (b) => {
    b.page();
    [[50, 100, 440, 100], [50, 160, 440, 160], [50, 100, 50, 160], [440, 100, 440, 160], [50, 120, 440, 120], [180, 140, 440, 140], [180, 120, 180, 160], [310, 100, 310, 160]].forEach((r) => b.rule(...r));
    [['Region and city', 50, 100, 1], ['Total', 310, 100, 1], ['North', 50, 120], ['Seoul', 180, 120], ['10', 310, 120], ['Busan', 180, 140], ['20', 310, 140]].forEach(([t, x, y, bold]) => cell(b, t, x, y, bold));
  });
  await make('layout-bars.pdf', (b) => {
    b.page();
    b.line('Results', 14, 60, 80, 'b');
    b.bar(60, 100, 400, 22, [217, 217, 217]);
    [[60, 99, 400, 2], [60, 165, 400, 2], [59, 100, 2, 66], [459, 100, 2, 66], [60, 121.75, 400, 0.5], [60, 143.75, 400, 0.5], [199.75, 100, 0.5, 66], [329.75, 100, 0.5, 66]].forEach((r) => b.bar(...r));
    [['Test', 'Before', 'After'], ['Speed', '12 s', '4 s'], ['Memory', '800 MB', '300 MB']].forEach((row, r) => row.forEach((t, c) => cell(b, t, [60, 200, 330][c], 100 + 22 * r, r === 0)));
  });
  await make('layout-boxes.pdf', (b) => {
    b.page();
    [[50, 70, 545, 70], [50, 140, 545, 140], [50, 70, 50, 140], [545, 70, 545, 140], [50, 95, 545, 95]].forEach((r) => b.rule(...r));
    b.line('Note', 11, 60, 88, 'b');
    b.para('A box drawn around a note is no table, even with a rule under its title line.', 11, 60, 112, 470, 14);
    b.line('Important words', 11, 50, 170);
    b.rule(50, 172, 50 + b.width('Important words', 11), 172);
    b.rule(50, 190, 545, 190, 1);
    [220, 260, 300].forEach((y) => b.rule(100, y, 400, y));
    [100, 250, 400].forEach((x) => b.rule(x, 220, x, 300));
    b.line('Chart axis label', 9, 200, 315);
  });
  const mu = await import('mupdf');
  {
    // Korean keeps its spaces when lines join, Chinese has none; Droid Sans Fallback (built into MuPDF) sets every character 1 em wide.
    const d = new mu.PDFDocument(), hex = (t) => [...t].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join('');
    const wrap = (t, n) => t.includes(' ') ? t.split(' ').reduce((ls, w) => { const last = ls[ls.length - 1]; if (last && `${last} ${w}`.length <= n) ls[ls.length - 1] = `${last} ${w}`; else ls.push(w); return ls; }, []) : t.match(new RegExp(`.{1,${n}}`, 'gu'));
    const text = (font, t, y) => wrap(t, 18).map((l, k) => `BT /${font} 11 Tf 50 ${842 - y - k * 16} Td <${hex(l)}> Tj ET`).join('\n');
    const res = d.addObject({ Font: { K: d.addCJKFont(new mu.Font('ko'), 'ko', 0, false), Z: d.addCJKFont(new mu.Font('zh-Hans'), 'zh-Hans', 0, false) } });
    const content = `${text('K', '한글 문단도 읽을 수 있어야 합니다. 줄이 바뀌어도 한 문단으로 이어지고 단어 사이의 빈칸도 그대로 남습니다.', 110)}\n${text('Z', '中文段落也应该能够正确读取。换行之后仍然是同一个段落，字与字之间不应该出现多余的空格。', 260)}`;
    d.insertPage(-1, d.addPage([0, 0, 595, 842], 0, res, content));
    fs.writeFileSync(P('layout-cjk.pdf'), d.saveToBuffer('compress').asUint8Array());
  }
  {
    const d = mu.Document.openDocument(fs.readFileSync(P('layout-columns.pdf')), 'application/pdf');
    fs.writeFileSync(P('layout-locked.pdf'), d.saveToBuffer('encrypt=aes-256,user-password=1234,owner-password=1234').asUint8Array());
  }
}
for (const [src, dst, main, mainDir] of [['doc.docx', 'macro.docm', 'application/vnd.ms-word.document.macroEnabled.main+xml', 'word'], ['sheet.xlsx', 'macro.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.main+xml', 'xl']]) {
  const { unzipSync, zipSync, strToU8, strFromU8 } = require('fflate');
  const z = unzipSync(new Uint8Array(fs.readFileSync(P(src))));
  const ct = strFromU8(z['[Content_Types].xml']).replace(/<Override\b[^>]*PartName="\/(?:word\/document|xl\/workbook)\.xml"[^>]*\/>/, (t) => t.replace(/ContentType="[^"]+"/, `ContentType="${main}"`)).replace(/<Default Extension="bin"[^>]*\/>/, '').replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');
  const relsName = `${mainDir}/_rels/${mainDir === 'word' ? 'document' : 'workbook'}.xml.rels`;
  z['[Content_Types].xml'] = strToU8(ct);
  z[relsName] = strToU8(strFromU8(z[relsName]).replace('</Relationships>', '<Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>'));
  z[`${mainDir}/vbaProject.bin`] = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]);
  fs.writeFileSync(P(dst), zipSync(z));
}
const box = { pos: cube.pos.map((v, i) => v * [1, 2, 3][i % 3]), idx: cube.idx };
fs.writeFileSync(P('box.stl'), cad.writeStl(box));
fs.writeFileSync(P('box.glb'), cad.writeGlb(box));
fs.writeFileSync(P('box-inch.3mf'), require('fflate').zipSync({ '_rels/.rels': Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="r" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'), '3D/3dmodel.model': Buffer.from(`<?xml version="1.0"?><model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${Array.from({ length: 8 }, (_, i) => `<vertex x="${box.pos[i * 3] / 10}" y="${box.pos[i * 3 + 1] / 10}" z="${box.pos[i * 3 + 2] / 10}"/>`).join('')}</vertices><triangles>${Array.from({ length: 12 }, (_, i) => `<triangle v1="${cube.idx[i * 3]}" v2="${cube.idx[i * 3 + 1]}" v3="${cube.idx[i * 3 + 2]}"/>`).join('')}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`) }));
fs.writeFileSync(P('mesh.obj'), `v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n`);
fs.writeFileSync(P('logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect x="10" y="10" width="220" height="140" rx="24" fill="#86c23a"/><circle cx="70" cy="80" r="40" fill="#2c6413"/><text x="125" y="92" font-size="30" fill="#fff">Lime</text></svg>');
for (const [f, t] of [['logo.ai', 'ai'], ['logo.eps', 'eps']]) try { sh(cli('vectorcraft'), ['convert', P('logo.svg'), P(f)]); } catch (e) { console.log(t, e.message); }
try { sh(cli('designcraft'), ['run', '--sample', '--export', P('layout.idml')]); } catch (e) { console.log('idml', e.message); }
try { sh(cli('effectcraft'), ['--demo', 'exec', 'file.exportLottie', '--params', JSON.stringify({ path: P('anim.json') })]); } catch (e) { console.log('lottie', e.message); }
try { sh(cli('filmcraft'), ['--demo', 'exec', 'file.exportOtio', `path=${P('timeline.otio')}`]); } catch (e) { console.log('otio', e.message); }
fs.rmSync(unpacked, { recursive: true, force: true });
console.log('fixtures in', dir, fs.readdirSync(dir).length, 'files');
