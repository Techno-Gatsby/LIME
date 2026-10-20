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
  new D.Paragraph({ children: [new D.ImageRun({ data: fs.readFileSync(P('photo2.jpg')), type: 'jpg', transformation: { width: 200, height: 133 } })] }),
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

const u8 = strToU8, solid = (w, h, bg) => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).png().toBuffer();
const picPng = await solid(160, 90, '#008080'), coverPng = await solid(300, 450, '#000080'), platePng = await solid(200, 300, '#c06030');
const xh = (title, body) => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>\n<body>\n${body}\n</body></html>`;
const novel = (extra = {}) => zipSync({
  mimetype: [u8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': u8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path='OPS/package.opf' media-type='application/oebps-package+xml'/></rootfiles></container>`),
  'OPS/package.opf': u8(`<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="2.0" unique-identifier='id'>\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id='id'>urn:uuid:12345678-1234-1234-1234-123456789012</dc:identifier><dc:title>별빛 이야기</dc:title><dc:creator opf:role="aut">김작가</dc:creator><dc:creator opf:role="edt">편집자</dc:creator><dc:language>ko</dc:language><meta name="cover" content="cover"/></metadata>\n<manifest><item id='c1' href='Text/ch1.xhtml' media-type='application/xhtml+xml'/><item id="c2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="Text/ch%203.xhtml" media-type="application/xhtml+xml"/><item id="pic" href="Images/pic.png" media-type="image/png"/><item id="plate" href="Images/plate.png" media-type="image/png"/><item id="cover" href="Images/cover.png" media-type="image/png"/><item id="css" href="Styles/book.css" media-type="text/css"/></manifest>\n<spine><itemref idref='c1'/><itemref idref="c2"/><itemref idref="c3"/><itemref idref="plate" linear="no"/></spine></package>`),
  'OPS/Styles/book.css': u8('.loud{font-weight:bold}'),
  'OPS/Text/ch1.xhtml': u8(xh('', `<h1>첫 번째 장</h1><p>밤하늘에 <b>별</b>이 <i>반짝</i>였다. Starlight chapter one.</p><p>주석은 <a href="ch%203.xhtml#note1">여기</a>를, 이 장의 <a href='#local'>문단</a>을 보세요. <a href="100%.html">깨진 링크</a> <a href="javascript:alert(1)">스크립트</a></p><p id='local'>이 장의 문단</p><p><img src="../../outside.png" alt="밖"/></p>`)),
  'OPS/Text/ch2.xhtml': u8(xh('둘', `<h1>두 번째 장</h1><p>그림이 있는 장입니다. Starlight chapter two.</p><p><img src="../Images/pic.png" alt="그림"/></p><table><tr><th>이름</th><th>값</th></tr><tr><td>별</td><td>42</td></tr></table>`)),
  'OPS/Text/ch 3.xhtml': u8(xh('셋', `<h1>세 번째 장</h1><p id="note1">주석 내용입니다.</p><ul><li>목록 하나</li><li>목록 둘</li></ul>`)),
  'OPS/Images/pic.png': [picPng, { level: 0 }], 'OPS/Images/plate.png': platePng, 'OPS/Images/cover.png': coverPng,
  ...extra,
});
const encryption = (alg) => ({ 'META-INF/encryption.xml': u8(`<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/><enc:CipherData><enc:CipherReference URI="OPS/Text/ch1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`) });
fs.writeFileSync(P('novel.epub'), novel());
fs.writeFileSync(P('drm.epub'), novel(encryption('http://www.w3.org/2001/04/xmlenc#aes128-cbc')));
fs.writeFileSync(P('obfuscated.epub'), novel(encryption('http://www.idpf.org/2008/embedding')));
const webp = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#aa3366' } }).webp().toBuffer();
fs.writeFileSync(P('chapters.html'), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>장 테스트</title></head><body>\n<h1 id="one">첫 번째 장</h1>\n<p id="intro">소개 문단 <a href="#two target">둘째 장의 목표</a> and <a href="https://example.com/">a web link</a>.</p>\n<h2>하위 절</h2>\n<p><img src="photo2.jpg" alt="사진"></p>\n<p><img src="data:image/webp;base64,${webp.toString('base64')}" alt="webp"></p>\n<p><img src="https://example.com/remote.png" alt="remote"></p>\n<h1>두 번째 장</h1>\n<p id="two target">목표 문단입니다\u000b.</p>\n</body></html>\n`);
const cp1251 = (s) => { const d = new TextDecoder('windows-1251'), m = new Map(); for (let b = 0; b < 256; b++) m.set(d.decode(Uint8Array.of(b)), b); return Buffer.from([...s].map((c) => m.get(c) ?? 63)); };
fs.writeFileSync(P('voina.fb2'), cp1251(`<?xml version="1.0" encoding="windows-1251"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
 <description>
  <title-info>
   <genre>prose_classic</genre>
   <author><first-name>Лев</first-name><last-name>Толстой</last-name></author>
   <book-title>Война и мир</book-title>
   <lang>ru</lang>
   <coverpage><image l:href="#cover.png"/></coverpage>
  </title-info>
 </description>
 <body>
  <title><p>Война и мир</p></title>
  <section id="ch1">
   <title><p>Глава первая</p></title>
   <p>Первый <strong>абзац</strong> и <emphasis>курсив</emphasis>.<a l:href="#n1" type="note">[1]</a></p>
   <empty-line/>
   <poem><stanza><v>Строка стиха один</v><v>Строка стиха два</v></stanza></poem>
   <section>
    <title><p>Подглава</p></title>
    <p>Текст подглавы. <a l:href="#ch2">Ко второй главе</a></p>
   </section>
  </section>
  <section id="ch2">
   <title><p>Глава вторая</p></title>
   <cite><p>Цитата из книги.</p></cite>
   <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
  </section>
 </body>
 <body name="notes">
  <section id="n1"><title><p>1</p></title><p>Текст примечания.</p></section>
 </body>
 <binary id="cover.png" content-type="image/png">${coverPng.toString('base64')}</binary>
</FictionBook>
`));

// Fonts: Noto Sans (hinted TrueType with composites) with an overlap flag set, a TTC holding it, and a small
// name-keyed CFF OpenType font built here (subroutines, hint masks, flex, seac accents, two contours, VORG).
const fonts = require(path.resolve('src/main/engines/fonts.js'));
if (fs.existsSync(NOTO)) {
  const noto = fonts.load(fs.readFileSync(NOTO));
  const glyphs = fonts.readGlyphs(noto), gid = glyphs.findIndex((g) => g && g.n > 1);
  glyphs[gid].overlap = true;
  const built = fonts.buildGlyf(glyphs.map((g) => (g ? fonts.serializeGlyph(g) : Buffer.alloc(0))), noto.tables.get('head').readInt16BE(50) !== 0);
  noto.tables.set('glyf', built.glyf);
  noto.tables.set('loca', built.loca);
  const ttf = fonts.writeSfnt(noto);
  fs.writeFileSync(P('font.ttf'), ttf);
  const ttc = Buffer.concat([Buffer.from('ttcf\x00\x01\x00\x00\x00\x00\x00\x01\x00\x00\x00\x10', 'latin1'), ttf]);
  for (let i = 0, n = ttf.readUInt16BE(4); i < n; i++) ttc.writeUInt32BE(ttf.readUInt32BE(12 + 16 * i + 8) + 16, 16 + 12 + 16 * i + 8);
  fs.writeFileSync(P('font.ttc'), ttc);
  try { fs.writeFileSync(P('font.google.woff2'), await require('wawoff2').compress(ttf)); } catch (e) { console.log('woff2', e.message); }
}
{
  const STD = fonts.STD_STRINGS, i32 = (v) => [29, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const num = (v, dict) => (v >= -107 && v <= 107 ? [v + 139] : v >= 108 && v <= 1131 ? [((v - 108) >> 8) + 247, (v - 108) & 255] : v <= -108 && v >= -1131 ? [((-v - 108) >> 8) + 251, (-v - 108) & 255] : dict ? [29, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255] : [28, (v >> 8) & 255, v & 255]);
  const cs = (...parts) => Buffer.from(parts.flatMap((p) => (typeof p === 'number' ? num(p) : p)));
  const op = { hstem: [1], vstem: [3], vmoveto: [4], rlineto: [5], hlineto: [6], vlineto: [7], rrcurveto: [8], callsubr: [10], return: [11], endchar: [14], hintmask: [19], rmoveto: [21], hmoveto: [22], callgsubr: [29], vhcurveto: [30], hvcurveto: [31], flex: [12, 35] };
  const index = (items) => {
    const total = items.reduce((s, i) => s + i.length, 0) + 1, size = total < 256 ? 1 : total < 65536 ? 2 : 4;
    const head = [items.length >> 8, items.length & 255];
    if (!items.length) return Buffer.from(head);
    head.push(size);
    let o = 1;
    for (const it of [...items, null]) { for (let b = size - 1; b >= 0; b--) head.push((o >>> (8 * b)) & 255); if (it) o += it.length; }
    return Buffer.concat([Buffer.from(head), ...items]);
  };
  const dict = (entries) => Buffer.from(entries.flatMap(([o, ...vals]) => [...vals.flatMap((v) => num(v, true)), ...(o >= 1200 ? [12, o - 1200] : [o])]));
  const names = ['.notdef', 'space', 'A', 'a', 'e', 'acute', 'Aacute', 'flexbar', 'box'];
  const glyphs = [
    cs(500, 50, 0, op.rmoveto, 400, 700, -400, op.hlineto, op.endchar),
    cs(250, op.endchar),
    cs(10, 20, op.hstem, 30, 40, op.vstem, op.hintmask, [0xf0], 100, 0, op.rmoveto, 100, op.hlineto, 50, 150, 100, 0, 50, -150, op.rlineto, 100, op.hlineto, -200, 700, op.rlineto, op.endchar),
    cs(520, 250, 0, op.rmoveto, 110, 90, 90, 110, 110, -90, 90, -110, op.hvcurveto, -110, -90, -90, -110, op.hvcurveto, -110, 90, -90, 110, op.vhcurveto, op.endchar),
    cs(60, 250, op.rmoveto, -107, op.callsubr, -107, op.callgsubr, op.endchar),
    cs(80, 600, op.rmoveto, 120, 100, op.rlineto, -40, op.hlineto, -120, -100, op.rlineto, op.endchar),
    cs(500, 170, 190, 65, 194, op.endchar),
    cs(100, 0, op.rmoveto, 500, op.hlineto, 500, op.vlineto, -80, 0, -90, 30, -80, 0, -80, 0, -90, -30, -80, 0, 50, op.flex, op.endchar),
    cs(0, 0, op.rmoveto, 500, op.hlineto, 500, op.vlineto, -500, op.hlineto, 100, -400, op.rmoveto, 300, op.vlineto, 300, op.hlineto, -300, op.vlineto, op.endchar),
  ];
  const subrs = [cs(100, 0, 150, 100, 150, 0, op.rrcurveto, op.return)], gsubrs = [cs(0, -150, -100, -100, -150, 0, op.rrcurveto, op.return)];
  const sid = (n) => (STD.indexOf(n) >= 0 ? STD.indexOf(n) : 391 + ['flexbar', 'box'].indexOf(n));
  const charset = Buffer.from([0, ...names.slice(1).flatMap((n) => [sid(n) >> 8, sid(n) & 255])]);
  const header = Buffer.from([1, 0, 4, 1]), nameIdx = index([Buffer.from('LimeTest-NameKeyed')]), strIdx = index([Buffer.from('flexbar'), Buffer.from('box')]), gsubrIdx = index(gsubrs);
  const charStrings = index(glyphs), privDict = (subrOff) => Buffer.from([...dict([[20, 0], [21, 0]]), ...i32(subrOff), 19]), localSubrs = index(subrs);
  const topFor = (o) => index([Buffer.from([...i32(o.charset), 15, ...i32(o.charStrings), 17, ...i32(o.privSize), ...i32(o.priv), 18])]);
  const probe = topFor({ charset: 0, charStrings: 0, privSize: 0, priv: 0 }).length;
  const start = header.length + nameIdx.length + probe + strIdx.length + gsubrIdx.length;
  const privSize = privDict(0).length;
  const o = { charset: start, charStrings: start + charset.length, priv: start + charset.length + charStrings.length, privSize };
  const cff = Buffer.concat([header, nameIdx, topFor(o), strIdx, gsubrIdx, charset, charStrings, privDict(privSize), localSubrs]);
  const be = (...pairs) => { const b = []; for (const [bits, v] of pairs) for (let k = bits / 8 - 1; k >= 0; k--) b.push((v >>> (8 * k)) & 255); return Buffer.from(b); };
  const n = names.length, adv = [500, 250, 600, 520, 520, 300, 600, 700, 500];
  const head = be([32, 0x10000], [32, 0x10000], [32, 0], [32, 0x5f0f3cf5], [16, 3], [16, 1000], [32, 0], [32, 0], [32, 0], [32, 0], [16, 0], [16, 0], [16, 700], [16, 700], [16, 0], [16, 8], [16, 2], [16, 0], [16, 0]);
  const hhea = be([32, 0x10000], [16, 800], [16, 0xffff & -200], [16, 0], [16, 700], [16, 0], [16, 0], [16, 700], [16, 1], [16, 0], [16, 0], [16, 0], [16, 0], [16, 0], [16, 0], [16, 0], [16, n]);
  const maxp = be([32, 0x5000], [16, n]);
  const os2 = Buffer.alloc(96); os2.writeUInt16BE(4, 0); os2.writeUInt16BE(400, 4); os2.writeUInt16BE(5, 6); os2.writeUInt16BE(8, 8); os2.writeUInt16BE(0x40, 62); os2.writeUInt32BE(1, 78);
  const nameRecs = [[1, 'Lime Test NameKeyed'], [2, 'Regular'], [4, 'Lime Test NameKeyed Regular'], [5, 'Version 1.000'], [6, 'LimeTest-NameKeyed']];
  const strs = nameRecs.map(([, s]) => Buffer.from(s, 'utf16le').swap16());
  let so = 0;
  const nameTable = Buffer.concat([be([16, 0], [16, nameRecs.length], [16, 6 + 12 * nameRecs.length]), ...nameRecs.map(([id], i) => { const r = be([16, 3], [16, 1], [16, 0x409], [16, id], [16, strs[i].length], [16, so]); so += strs[i].length; return r; }), ...strs]);
  const map = [[0x20, 1], [0x41, 2], [0x61, 3], [0x65, 4], [0xb4, 5], [0xc1, 6]];
  const segs = [...map.map(([c, g]) => [c, c, g - c]), [0xffff, 0xffff, 1]];
  const sub = Buffer.concat([be([16, 4], [16, 16 + segs.length * 8], [16, 0], [16, segs.length * 2], [16, 8], [16, 2], [16, segs.length * 2 - 8]), ...segs.map(([, e]) => be([16, e])), be([16, 0]), ...segs.map(([s]) => be([16, s])), ...segs.map(([, , d]) => be([16, d & 0xffff])), ...segs.map(() => be([16, 0]))]);
  const cmap = Buffer.concat([be([16, 0], [16, 1], [16, 3], [16, 1], [32, 12]), sub]);
  const post = be([32, 0x30000], [32, 0], [16, 0xffff & -100], [16, 50], [32, 0], [32, 0], [32, 0], [32, 0], [32, 0]);
  const hmtx = Buffer.concat(adv.map((a) => be([16, a], [16, 0])));
  const vorg = be([16, 1], [16, 0], [16, 880], [16, 1], [16, 2], [16, 900]);
  const vhea = be([32, 0x11000], [16, 880], [16, 0xffff & -120], [16, 0], [16, 1000], [16, 0], [16, 0], [16, 1000], [16, 1], [16, 0], [16, 0], [16, 0], [16, 0], [16, 0], [16, 0], [16, 0], [16, n]);
  const vmtx = Buffer.concat(adv.map(() => be([16, 1000], [16, 0])));
  fs.writeFileSync(P('font.otf'), fonts.writeSfnt({ flavor: 0x4f54544f, tables: new Map(Object.entries({ 'CFF ': cff, head, hhea, maxp, 'OS/2': os2, name: nameTable, cmap, post, hmtx, VORG: vorg, vhea, vmtx })) }));
}

// E-mail: a Korean multipart EML (EUC-KR words and bodies, inline picture, RFC 2231 name), an ISO-2022-KR EML, an
// Outlook .msg written with cfb after MS-OXMSG (recipients, inline picture, attachment, attached message) and an MHTML page.
const euc = (() => { const d = new TextDecoder('euc-kr'), m = new Map(); for (let a = 0x81; a <= 0xfe; a++) for (let b = 0x41; b <= 0xfe; b++) { const c = d.decode(Uint8Array.of(a, b)); if (c.length === 1 && c !== '\ufffd' && !m.has(c)) m.set(c, [a, b]); } return (s) => Buffer.from([...s].flatMap((c) => (c.charCodeAt(0) < 128 ? [c.charCodeAt(0)] : m.get(c) || [63]))); })();
const iso2022kr = (s) => { const out = [0x1b, 0x24, 0x29, 0x43]; for (const line of s.split(/(\r\n)/)) { let so = false; for (const c of line) { if (c.charCodeAt(0) < 128) { if (so) { out.push(0x0f); so = false; } out.push(c.charCodeAt(0)); } else { if (!so) { out.push(0x0e); so = true; } out.push(...euc(c).map((x) => x & 0x7f)); } } if (so) out.push(0x0f); } return Buffer.from(out); };
const b64 = (b) => Buffer.from(b).toString('base64').replace(/.{76}(?!$)/g, '$&\r\n');
const word = (b, cs) => `=?${cs}?B?${Buffer.from(b).toString('base64')}?=`;
const qpEnc = (b) => { let s = '', col = 0; for (const x of b) { const p = x >= 33 && x <= 126 && x !== 61 ? String.fromCharCode(x) : `=${x.toString(16).toUpperCase().padStart(2, '0')}`; if (col + p.length > 72) { s += '=\r\n'; col = 0; } s += p; col += p.length; } return s; };
const logoPng = await solid(16, 16, '#008080'), report = Buffer.from('%PDF-1.4 fake report');
const mailHtml = '<html><head><style>p { color: #C00000; }</style></head><body bgcolor="#FFFFF0"><p>안녕하세요. 자료를 보냅니다.</p><img src="cid:logo@lime" alt="logo"><script>alert(\'x\')</script><img src="https://tracker.example/pixel" onerror="alert(\'x\')"><a href="javascript:alert(\'x\')">bad link</a> <a href="https://example.com/ok">good link</a><svg onload="alert(\'x\')"></svg><table bgcolor="#EEEEEE"><tr><td valign="top"><font color="#336699">표 안</font></td></tr></table><form action="https://evil.example/"><p>양식 안의 본문</p><input name="q"></form><xmp><img src=x onerror=alert(1)></xmp><!-- <img src=x onerror=alert(2)> --></body></html>';
fs.writeFileSync(P('mail.eml'), [
  `From: ${word(euc('보낸이'), 'EUC-KR')} <sender@example.com>`, 'To: receiver@example.com, "Second" <second@example.com>', 'Cc: other@example.com', `Subject: ${word(euc('회의 자료'), 'EUC-KR')}`, 'Date: Thu, 01 Oct 2026 09:30:00 +0900', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="mixed"', '',
  '--mixed', 'Content-Type: multipart/related; boundary="related"', '', '--related', 'Content-Type: multipart/alternative; boundary="alt"', '',
  '--alt', 'Content-Type: text/plain; charset=euc-kr', 'Content-Transfer-Encoding: base64', '', b64(euc('안녕하세요. 자료를 보냅니다.\r\n둘째 줄')),
  '--alt', 'Content-Type: text/html; charset=euc-kr', 'Content-Transfer-Encoding: quoted-printable', '', qpEnc(euc(mailHtml)), '--alt--',
  '--related', 'Content-Type: application/octet-stream', 'Content-ID: <logo@lime>', 'Content-Transfer-Encoding: base64', '', b64(logoPng), '--related--',
  '--mixed', 'Content-Type: application/pdf; name="report.pdf"', "Content-Disposition: attachment; filename*=UTF-8''%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf", 'Content-Transfer-Encoding: base64', '', b64(report),
  '--mixed', 'Content-Type: text/plain; charset=utf-8; name="notes.txt"', 'Content-Disposition: attachment; filename="notes.txt"', '', 'memo', '--mixed--', ''].join('\r\n'));
fs.writeFileSync(P('old.eml'), Buffer.concat([Buffer.from(`From: old@example.com\r\nSubject: ${word(iso2022kr('한글 제목'), 'ISO-2022-KR')}\r\nContent-Type: text/plain; charset=ISO-2022-KR\r\nContent-Transfer-Encoding: 7bit\r\n\r\n`), iso2022kr('본문 <첫 줄>\r\n둘째 줄'), Buffer.from('\r\n')]));
const msgFile = (m) => {
  const CFB = require('cfb'), cfb = CFB.utils.cfb_new(), add = (p, d) => CFB.utils.cfb_add(cfb, p, d), hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
  const props = (dir) => {
    const entries = [];
    const entry = (id, type, v) => { const e = Buffer.alloc(16); e.writeUInt32LE(((id << 16) | type) >>> 0, 0); e.writeUInt32LE(6, 4); v.copy(e, 8); entries.push(e); };
    const u32 = (n) => { const b = Buffer.alloc(8); b.writeInt32LE(n, 0); return b; };
    return {
      str(id, v) { const b = Buffer.from(v, 'utf16le'); add(`${dir}/__substg1.0_${hex(id, 4)}001F`, b); entry(id, 0x1f, u32(b.length + 2)); },
      bin(id, v) { add(`${dir}/__substg1.0_${hex(id, 4)}0102`, v); entry(id, 0x102, u32(v.length)); },
      long(id, v) { entry(id, 3, u32(v)); },
      time(id, ms) { const b = Buffer.alloc(8); b.writeBigUInt64LE((BigInt(ms) + 11644473600000n) * 10000n, 0); entry(id, 0x40, b); },
      obj(id) { entry(id, 0xd, Buffer.alloc(8)); },
      save(head) { add(`${dir}/__properties_version1.0`, Buffer.concat([head, ...entries])); },
    };
  };
  const write = (dir, msg, top) => {
    const p = props(dir), recips = msg.recipients || [];
    p.str(0x001a, 'IPM.Note'); p.str(0x0037, msg.subject); p.str(0x0c1a, msg.senderName); p.str(0x0c1f, msg.senderEmail); p.str(0x0c1e, 'SMTP'); p.str(0x5d01, msg.senderEmail);
    p.time(0x0039, Date.UTC(2026, 9, 1, 0, 30)); p.long(0x3fde, 65001);
    if (msg.body != null) p.str(0x1000, msg.body);
    if (msg.html != null) p.bin(0x1013, Buffer.from(msg.html));
    if (msg.rtf) p.bin(0x1009, msg.rtf);
    if (msg.messageId) { p.str(0x1035, msg.messageId); p.str(0x007d, `Message-ID: ${msg.messageId}\r\nSubject: ${msg.subject}\r\n`); }
    recips.forEach(([name, email, type], i) => { const r = props(`${dir}/__recip_version1.0_#${hex(i, 8)}`); r.long(0x0c15, type); r.long(0x3000, i); r.str(0x3001, name); r.str(0x3002, 'SMTP'); r.str(0x3003, email); r.str(0x39fe, email); r.save(Buffer.alloc(8)); });
    let n = 0;
    for (const [file, data, type, cid] of msg.attachments || []) {
      const a = props(`${dir}/__attach_version1.0_#${hex(n, 8)}`);
      a.long(0x3705, 1); a.long(0x0e21, n++); a.bin(0x3701, data); a.str(0x3707, file); a.str(0x3704, file); a.str(0x370e, type);
      if (cid) { a.str(0x3712, cid); a.long(0x3714, 4); a.long(0x7ffe, 1); }
      a.save(Buffer.alloc(8));
    }
    for (const inner of msg.messages || []) {
      const ad = `${dir}/__attach_version1.0_#${hex(n, 8)}`, a = props(ad);
      a.long(0x3705, 5); a.long(0x0e21, n++); a.str(0x3001, inner.subject); a.obj(0x3701); a.save(Buffer.alloc(8));
      write(`${ad}/__substg1.0_3701000D`, inner, false);
    }
    const head = Buffer.alloc(top ? 32 : 24);
    head.writeUInt32LE(recips.length, 8); head.writeUInt32LE(n, 12); head.writeUInt32LE(recips.length, 16); head.writeUInt32LE(n, 20);
    p.save(head);
  };
  write('', m, true);
  for (const s of ['00020102', '00030102', '00040102']) add(`/__nameid_version1.0/__substg1.0_${s}`, Buffer.alloc(0));
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }));
};
fs.writeFileSync(P('meeting.msg'), msgFile({ subject: '회의 자료', senderName: '보낸이', senderEmail: 'sender@example.com', body: '안녕하세요. 자료를 보냅니다.\r\n둘째 줄', html: '<html><head><style>p { color: #C00000; }</style></head><body><p>안녕하세요. 자료를 보냅니다.</p><img src="cid:logo@lime"></body></html>', messageId: '<meeting-1@example.com>', recipients: [['Receiver', 'receiver@example.com', 1], ['Copy', 'copy@example.com', 2]], attachments: [['보고서.pdf', report, 'application/pdf'], ['logo.png', logoPng, 'image/png', 'logo@lime']], messages: [{ subject: 'Earlier mail', senderName: 'Old', senderEmail: 'old@example.com', body: 'older text' }] }));
const rtfHtml = Buffer.from('{\\rtf1\\ansi\\ansicpg1252\\fromhtml1 \\deff0{\\fonttbl{\\f0\\fswiss Arial;}}{\\*\\htmltag64 <html>}{\\*\\htmltag64 <body>}{\\*\\htmltag64 <p>}\\htmlrtf {\\htmlrtf0 Encapsulated caf\\\'e9 text\\htmlrtf }\\htmlrtf0{\\*\\htmltag72 </p>}{\\*\\htmltag64 </body>}{\\*\\htmltag64 </html>}}', 'latin1');
const mela = Buffer.alloc(16); mela.writeUInt32LE(rtfHtml.length + 12, 0); mela.writeUInt32LE(rtfHtml.length, 4); mela.write('MELA', 8, 'latin1');
fs.writeFileSync(P('rtf.msg'), msgFile({ subject: 'RTF only', senderName: 'Rich', senderEmail: 'rich@example.com', rtf: Buffer.concat([mela, rtfHtml]) }));
fs.writeFileSync(P('broken.msg'), 'not a compound file');
const css = 'body { font-family: serif } .hero { background: url("hero.png") no-repeat } @import "print.css" print;';
fs.writeFileSync(P('page.mhtml'), ['From: <Saved by Blink>', 'Snapshot-Content-Location: https://example.com/articles/page.html', 'Subject: Lime archive page', 'MIME-Version: 1.0', 'Content-Type: multipart/related; type="text/html"; boundary="----MultipartBoundary--x"', '',
  '------MultipartBoundary--x', 'Content-Type: text/html', 'Content-ID: <frame-1@mhtml.blink>', 'Content-Transfer-Encoding: quoted-printable', 'Content-Location: https://example.com/articles/page.html', '',
  qpEnc(Buffer.from('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Lime archive page</title><link rel="stylesheet" href="../css/site.css"><link rel="icon" href="/favicon.ico"><style>h1 { color: #2c6413 }</style><script>document.write("x")</script></head><body class="article"><h1>Archived heading</h1><p class="hero">Archived paragraph text.</p><img src="images/photo.png" alt="photo"><img srcset="images/small.png 1x, images/photo.png 2x" alt="srcset"><img src="cid:inline@mhtml.blink" alt="cid"><img src="https://elsewhere.example/missing.png" alt="missing"><iframe src="https://example.com/frame.html"></iframe><table background="images/photo.png"><tr><td>cell</td></tr></table></body></html>')),
  '------MultipartBoundary--x', 'Content-Type: text/css', 'Content-Location: https://example.com/css/site.css', '', css,
  '------MultipartBoundary--x', 'Content-Type: text/css', 'Content-Location: https://example.com/css/print.css', '', '.printonly { color: #000 }',
  '------MultipartBoundary--x', 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-Location: https://example.com/css/hero.png', '', b64(logoPng),
  '------MultipartBoundary--x', 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-Location: https://example.com/articles/images/photo.png', '', b64(picPng),
  '------MultipartBoundary--x', 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-ID: <inline@mhtml.blink>', '', b64(platePng),
  '------MultipartBoundary--x--', ''].join('\r\n'));

// Kindle books written here after the MobileRead description: MOBI 6 (PalmDOC, HUFF/CDIC or none, EXTH, trailing
// entries, picture records), a DRM-flagged copy, a PalmDOC text book, a Print Replica and a KF8 (AZW3) book with
// FDST flows, SKEL/FRAG indexes, CNCX selectors and kindle:pos/embed/flow references.
const be32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
const palmDb = (name, type, records) => {
  const head = Buffer.alloc(78 + records.length * 8 + 2);
  head.write(name.replace(/ /g, '_').slice(0, 31), 0, 'latin1');
  head.write(type, 60, 'latin1');
  head.writeUInt16BE(records.length, 76);
  let off = head.length;
  records.forEach((r, i) => { head.writeUInt32BE(off, 78 + i * 8); head.writeUInt32BE((i * 2) & 0xffffff, 82 + i * 8); off += r.length; });
  return Buffer.concat([head, ...records]);
};
const palmDocCompress = (inp) => {
  const out = [];
  for (let i = 0; i < inp.length;) {
    let best = 0, dist = 0;
    for (let d = 1; d <= Math.min(2047, i); d++) { let l = 0; while (l < 10 && i + l < inp.length && inp[i + l] === inp[i - d + l]) l++; if (l > best) { best = l; dist = d; } }
    if (best >= 3) { const pair = 0x8000 | (dist << 3) | (best - 3); out.push(pair >> 8, pair & 255); i += best; continue; }
    const c = inp[i];
    if (c === 32 && i + 1 < inp.length && inp[i + 1] >= 0x40 && inp[i + 1] <= 0x7f) { out.push(inp[i + 1] ^ 0x80); i += 2; }
    else if (c === 0 || (c >= 9 && c <= 0x7f)) { out.push(c); i++; }
    else { const run = []; while (i < inp.length && run.length < 8 && ((inp[i] >= 1 && inp[i] <= 8) || inp[i] >= 0x80)) run.push(inp[i++]); out.push(run.length, ...run); }
  }
  return Buffer.from(out);
};
const identityHuff = () => { const h = Buffer.alloc(24 + 1024 + 256); h.write('HUFF'); h.writeUInt32BE(24, 4); h.writeUInt32BE(24, 8); h.writeUInt32BE(24 + 1024, 12); for (let b = 0; b < 256; b++) h.writeUInt32BE(((2 * b) << 8) | 0x80 | 8, 24 + b * 4); return h; };
const identityCdic = () => { const c = Buffer.alloc(16 + 512 + 768); c.write('CDIC'); c.writeUInt32BE(16, 4); c.writeUInt32BE(256, 8); c.writeUInt32BE(8, 12); for (let b = 0; b < 256; b++) { const o = 512 + b * 3; c.writeUInt16BE(o, 16 + b * 2); c.writeUInt16BE(0x8001, 16 + o); c[16 + o + 2] = b; } return c; };
const exthBlock = (items) => { const body = Buffer.concat(items.map(([t, d]) => Buffer.concat([be32(t), be32(8 + d.length), d]))); const len = 12 + body.length, padN = (4 - (len % 4)) % 4; return Buffer.concat([Buffer.from('EXTH'), be32(len + padN), be32(items.length), body, Buffer.alloc(padN)]); };
const record0 = ({ compression, textLength, textRecords, encryption = 0, firstImage, huff = -1, title, author, cover, version = 6, kf8 = null }) => {
  const mobiLen = kf8 ? 0xf8 : 0xe8, h = Buffer.alloc(16 + mobiLen), ex = exthBlock([[100, Buffer.from(author)], [503, Buffer.from(title)], [524, Buffer.from('en')], ...(cover != null ? [[201, be32(cover)]] : [])]);
  h.writeUInt16BE(compression, 0); h.writeUInt32BE(textLength, 4); h.writeUInt16BE(textRecords, 8); h.writeUInt16BE(4096, 10); h.writeUInt16BE(encryption, 12);
  h.write('MOBI', 16); h.writeUInt32BE(mobiLen, 0x14); h.writeUInt32BE(2, 0x18); h.writeUInt32BE(65001, 0x1c); h.writeUInt32BE(0x1234, 0x20); h.writeUInt32BE(version, 0x24);
  for (let o = 0x28; o <= 0x4c; o += 4) h.writeUInt32BE(0xffffffff, o);
  h.writeUInt32BE(textRecords + 1, 0x50); h.writeUInt32BE(h.length + ex.length, 0x54); h.writeUInt32BE(Buffer.byteLength(title), 0x58); h.writeUInt32BE(9, 0x5c); h.writeUInt32BE(version, 0x68);
  h.writeUInt32BE(firstImage < 0 ? 0xffffffff : firstImage, 0x6c); h.writeUInt32BE(huff < 0 ? 0 : huff, 0x70); h.writeUInt32BE(huff < 0 ? 0 : 2, 0x74); h.writeUInt32BE(0x40, 0x80);
  h.writeUInt32BE(0xffffffff, 0xa4); h.writeUInt32BE(0xffffffff, 0xa8);
  if (kf8) { h.writeUInt32BE(kf8.fdst, 0xc0); h.writeUInt32BE(2, 0xc4); h.writeUInt32BE(0xffffffff, 0xf4); h.writeUInt32BE(kf8.frag, 0xf8); h.writeUInt32BE(kf8.skel, 0xfc); }
  else { h.writeUInt16BE(1, 0xc0); h.writeUInt16BE(textRecords, 0xc2); h.writeUInt32BE(1, 0xc4); }
  h.writeUInt32BE(0xffffffff, 0xc8); h.writeUInt32BE(0xffffffff, 0xd0); h.writeUInt16BE(3, 0xf2);
  return Buffer.concat([h, ex, Buffer.from(title), Buffer.alloc(4)]);
};
const textRecordsOf = (text, compression) => { const recs = []; for (let o = 0; o < text.length; o += 4096) { const chunk = text.subarray(o, o + 4096); recs.push(Buffer.concat([compression === 2 ? palmDocCompress(chunk) : chunk, Buffer.from([0, 0, 0x82])])); } return recs; };
const mobiBook = (text, pictures, o) => {
  const recs = [Buffer.alloc(0), ...textRecordsOf(text, o.compression)], textRecords = recs.length - 1, firstImage = pictures.length ? recs.length : -1;
  recs.push(...pictures);
  let huff = -1;
  if (o.compression === 17480) { huff = recs.length; recs.push(identityHuff(), identityCdic()); }
  recs.push(Buffer.from([0xe9, 0x8e, 0x0d, 0x0a]));
  recs[0] = record0({ ...o, textLength: text.length, textRecords, firstImage, huff });
  return palmDb(o.title, 'BOOKMOBI', recs);
};
const mobiHtml = '<html><head><guide><reference type="toc" title="Contents" filepos=0000000000 /></guide></head><body>\n<h1>Chapter One</h1>\n<p>It was a <b>dark</b> and stormy night; the rain fell in torrents — except at occasional intervals.</p>\n<p>See <a filepos=FILEPOS>the note</a> below. Ünïcödé text and 한글 too.</p>\n<p><img recindex="00001" /></p>\n<mbp:pagebreak/>\n<h1>Chapter Two</h1>\n<p>The note is here.</p>\n</body></html>';
const mobiSource = Buffer.from(mobiHtml.replace('FILEPOS', String(Buffer.byteLength(mobiHtml.replace('FILEPOS', '0000000000').slice(0, mobiHtml.replace('FILEPOS', '0000000000').indexOf('<p>The note')))).padStart(10, '0')));
const orange = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#ff8800' } }).png().toBuffer(), mobiCover = await sharp({ create: { width: 100, height: 150, channels: 3, background: '#00008b' } }).png().toBuffer();
for (const [f, compression] of [['stormy.mobi', 2], ['stormy-huff.mobi', 17480], ['stormy-plain.prc', 1]]) fs.writeFileSync(P(f), mobiBook(mobiSource, [orange, mobiCover], { compression, cover: 1, title: 'Stormy Night', author: 'E. Bulwer-Lytton' }));
fs.writeFileSync(P('locked.azw'), mobiBook(mobiSource, [], { compression: 2, encryption: 2, title: 'Locked', author: 'Nobody' }));
{
  const t = Buffer.from('Plain PalmDOC text.\n\nSecond paragraph of the book.'), r0 = Buffer.alloc(16);
  r0.writeUInt16BE(2, 0); r0.writeUInt32BE(t.length, 4); r0.writeUInt16BE(1, 8);
  fs.writeFileSync(P('old.pdb'), palmDb('Old Book', 'TEXtREAd', [r0, palmDocCompress(t)]));
  const pdfBytes = fs.readFileSync(P('doc.pdf')), rep = Buffer.alloc(20);
  rep.write('%MOP'); rep.writeUInt32BE(1, 4); rep.writeUInt32BE(1, 8); rep.writeUInt32BE(20, 12); rep.writeUInt32BE(pdfBytes.length, 16);
  fs.writeFileSync(P('replica.azw4'), mobiBook(Buffer.concat([rep, pdfBytes]), [], { compression: 1, title: 'Replica', author: 'Lime' }));
}
{
  const fv = (v) => { const b = [v & 0x7f]; for (v = Math.floor(v / 128); v; v = Math.floor(v / 128)) b.unshift(v & 0x7f); b[b.length - 1] |= 0x80; return b; };
  const skel = (title, aid) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><link href="kindle:flow:0001?mime=text/css" rel="stylesheet" type="text/css"/></head><body aid="${aid}"></body></html>`;
  const s0 = Buffer.from(skel('Part one', '0')), s1 = Buffer.from(skel('Part two', '3'));
  const f1 = Buffer.from('<div aid="4" id="second"><h1>Chapter Two</h1><p>Filler paragraph.</p><p aid="5">Aid target paragraph.</p></div>');
  const target = f1.indexOf('<p aid="5">').toString(32).toUpperCase().padStart(10, '0');
  const f0 = Buffer.from(`<div aid="1"><h1>Chapter One</h1><p>KF8 text with <b>bold</b> and 한글. <a href="kindle:pos:fid:0001:off:0000000000">To chapter two</a> and <a href="kindle:pos:fid:0001:off:${target}">to the target</a>.</p><p><img src="kindle:embed:0001?mime=image/png" alt="pic"/></p></div>`);
  const css = Buffer.from('h1 { color: #2c6413 }');
  const flow0 = Buffer.concat([s0, f0, s1, f1]), text = Buffer.concat([flow0, css]);
  const ins = (s) => s.indexOf('<body aid=') + s.subarray(s.indexOf('<body aid=')).indexOf('>') + 1;
  const sk1 = s0.length + f0.length, keys = [ins(s0), sk1 + ins(s1)];
  const tagx = (defs) => Buffer.concat([Buffer.from('TAGX'), be32(12 + defs.length * 4), be32(1), Buffer.from(defs.flat())]);
  const primary = (defs, records, cncx, entries) => { const h = Buffer.alloc(192); h.write('INDX'); h.writeUInt32BE(192, 4); h.writeUInt32BE(records, 24); h.writeUInt32BE(65001, 28); h.writeUInt32BE(entries, 36); h.writeUInt32BE(cncx, 52); return Buffer.concat([h, tagx(defs)]); };
  const data = (entries) => {
    const h = Buffer.alloc(192), parts = [], offs = [];
    let off = 192;
    for (const [key, control, values] of entries) { const e = Buffer.from([key.length, ...Buffer.from(key, 'latin1'), control, ...values.flatMap(fv)]); offs.push(off); parts.push(e); off += e.length; }
    const body = Buffer.concat(parts), padN = (4 - (body.length % 4)) % 4, idxt = Buffer.concat([Buffer.from('IDXT'), ...offs.map((o) => { const b = Buffer.alloc(2); b.writeUInt16BE(o); return b; })]);
    h.write('INDX'); h.writeUInt32BE(192, 4); h.writeUInt32BE(192 + body.length + padN, 20); h.writeUInt32BE(entries.length, 24);
    return Buffer.concat([h, body, Buffer.alloc(padN), idxt]);
  };
  const sels = ["P-//*[@aid='0']", "P-//*[@aid='3']"].map((s) => Buffer.from(s)), cncxOffs = [];
  let co = 0;
  const cncx = Buffer.concat(sels.map((s) => { cncxOffs.push(co); const b = Buffer.from([...fv(s.length), ...s]); co += b.length; return b; }));
  const recs = [Buffer.alloc(0), ...textRecordsOf(text, 2)], textRecords = recs.length - 1, firstImage = recs.length;
  recs.push(orange, mobiCover);
  const fdst = recs.length;
  recs.push(Buffer.concat([Buffer.from('FDST'), be32(12), be32(2), be32(0), be32(flow0.length), be32(flow0.length), be32(text.length)]));
  const skelAt = recs.length;
  recs.push(primary([[1, 1, 3, 0], [6, 2, 12, 0], [0, 0, 0, 1]], 1, 0, 2), data([['SKEL0000000000', 0x05, [1, 0, s0.length]], ['SKEL0000000001', 0x05, [1, sk1, s1.length]]]));
  const fragAt = recs.length;
  recs.push(primary([[2, 1, 1, 0], [3, 1, 2, 0], [4, 1, 4, 0], [6, 2, 8, 0], [0, 0, 0, 1]], 1, 1, 2), data([[String(keys[0]).padStart(10, '0'), 0x09, [cncxOffs[0], 0, f0.length]], [String(keys[1]).padStart(10, '0'), 0x09, [cncxOffs[1], 1, f1.length]]]), cncx);
  recs.push(Buffer.from([0xe9, 0x8e, 0x0d, 0x0a]));
  recs[0] = record0({ compression: 2, textLength: text.length, textRecords, firstImage, title: 'Kindle Format Eight', author: 'Lime Writer', cover: 1, version: 8, kf8: { fdst, skel: skelAt, frag: fragAt } });
  fs.writeFileSync(P('kf8.azw3'), palmDb('Kindle Format Eight', 'BOOKMOBI', recs));
}
// Comics: page names that only a natural sort orders, Mac junk, a CB7 and a CBT of the same pages, a locked CBZ, and
// an EPUB with a nav page for KEPUB; TXTZ that points outside its archive.
{
  const comic = P('comic-src');
  fs.rmSync(comic, { recursive: true, force: true });
  fs.mkdirSync(path.join(comic, 'chapter'), { recursive: true });
  fs.mkdirSync(path.join(comic, '__MACOSX', 'chapter'), { recursive: true });
  for (const [n, w, h, bg] of [['page1.png', 200, 300, '#ff7f50'], ['page2.jpg', 220, 330, '#3366aa'], ['page10.png', 240, 360, '#33aa66']]) {
    const img = sharp({ create: { width: w, height: h, channels: 3, background: bg } });
    fs.writeFileSync(path.join(comic, 'chapter', n), await (n.endsWith('.jpg') ? img.jpeg().withMetadata({ density: 96 }) : img.png()).toBuffer());
  }
  fs.writeFileSync(path.join(comic, '__MACOSX', 'chapter', '._page1.png'), Buffer.from([0, 1, 2]));
  fs.writeFileSync(path.join(comic, 'ComicInfo.xml'), '<ComicInfo/>');
  for (const [f, t, extra] of [['comic.cbz', 'zip', []], ['comic.cb7', '7z', []], ['comic.cbt', 'tar', []], ['locked.cbz', 'zip', ['-plime']]]) { fs.rmSync(P(f), { force: true }); sh(sevenZ, ['a', `-t${t}`, ...extra, P(f), 'chapter', '__MACOSX', 'ComicInfo.xml'], { cwd: comic }); }
  fs.rmSync(comic, { recursive: true, force: true });
  const ebook = require(path.resolve('src/main/engines/ebook.js'));
  await office.htmlToEpub(`<h1>Kobo Book</h1><p>First sentence. Second one? Third!</p><p>Pi is 3.14 today. <b>Bold</b> words &amp; <i>more</i>.</p><p><img src="photo2.jpg" alt="photo"></p><h1>Next</h1><p>Another chapter.</p>`, 'Kobo Book', P('kobo.epub'), { base: dir });
  await ebook.rewriteEpub(P('kobo.epub'), P('kobo.kepub.epub'), ebook.addSpans);
  fs.writeFileSync(P('notes.txtz'), zipSync({ 'index.txt': u8('# Notes\n\nText with a picture ![p](images/p.png) and an outside one ![o](../outside.png).\n'), 'images/p.png': picPng, 'metadata.opf': u8('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Zipped Notes</dc:title><dc:creator>Note Taker</dc:creator><dc:language>en</dc:language></metadata></package>') }));
  fs.writeFileSync(P('outside.png'), picPng);
}

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
fs.writeFileSync(P('mesh.obj'), `v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n`);
fs.writeFileSync(P('logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect x="10" y="10" width="220" height="140" rx="24" fill="#86c23a"/><circle cx="70" cy="80" r="40" fill="#2c6413"/><text x="125" y="92" font-size="30" fill="#fff">Lime</text></svg>');
for (const [f, t] of [['logo.ai', 'ai'], ['logo.eps', 'eps']]) try { sh(cli('vectorcraft'), ['convert', P('logo.svg'), P(f)]); } catch (e) { console.log(t, e.message); }
try { sh(cli('designcraft'), ['run', '--sample', '--export', P('layout.idml')]); } catch (e) { console.log('idml', e.message); }
try { sh(cli('effectcraft'), ['--demo', 'exec', 'file.exportLottie', '--params', JSON.stringify({ path: P('anim.json') })]); } catch (e) { console.log('lottie', e.message); }
try { sh(cli('filmcraft'), ['--demo', 'exec', 'file.exportOtio', `path=${P('timeline.otio')}`]); } catch (e) { console.log('otio', e.message); }
fs.rmSync(unpacked, { recursive: true, force: true });
console.log('fixtures in', dir, fs.readdirSync(dir).length, 'files');
