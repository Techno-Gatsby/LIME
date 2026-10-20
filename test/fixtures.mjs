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
const surround = 'aevalsrc=sin(440*2*PI*t)|sin(550*2*PI*t)|sin(660*2*PI*t)|0.2*sin(60*2*PI*t)|sin(770*2*PI*t)|sin(880*2*PI*t):c=5.1:s=48000';
sh(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=321x241:rate=15', '-f', 'lavfi', '-i', surround, '-i', P('sub.srt'), '-t', '4', '-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-c:a', 'aac', '-c:s', 'mov_text', P('odd.mp4')]);
sh(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-i', P('sub.srt'), '-t', '4', '-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'srt', P('subs.mkv')]);
sh(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error', '-c:a', 'aac', P('hevc.mov')]);
sh(ffmpeg, ['-v', 'error', '-y', '-display_rotation:v:0', '90', '-i', P('hevc.mov'), '-c', 'copy', P('phone.mov')]);
fs.rmSync(P('hevc.mov'));
await sharp({ create: { width: 64, height: 48, channels: 3, background: '#86c23a' } }).png().toFile(P('cover.png'));
sh(ffmpeg, ['-v', 'error', '-y', '-i', P('tone.wav'), '-i', P('cover.png'), '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-b:a', '128k', '-c:v', 'copy', '-disposition:v:0', 'attached_pic', '-metadata', 'title=Lime 노래', '-id3v2_version', '3', P('song.mp3')]);
sh(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=161x121:rate=10', '-t', '1', P('anim.gif')]);
fs.copyFileSync(P('clip2.mp4'), P('100% clip.mp4'));
await sharp(P('anim.gif'), { animated: true }).webp().toFile(P('anim.webp'));
sh(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=t/3*sin(440*2*PI*t):s=44100:d=3', P('ramp.wav')]);
sh(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', P('clip.webm')]);
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
{
  const { PDFDocument, rgb } = require('pdf-lib');
  const fontkit = require('@pdf-lib/fontkit');
  const make = async (lines, extra) => {
    const d = await PDFDocument.create();
    d.registerFontkit(fontkit);
    const f = await d.embedFont(fs.readFileSync(NOTO), { subset: true }), page = d.addPage([595, 842]);
    lines.forEach((t, i) => page.drawText(t, { x: 60, y: 760 - i * 28, size: 14, font: f }));
    await extra?.(page, f);
    return d.save();
  };
  fs.writeFileSync(P('v1.pdf'), await make(['Quarterly report', 'The quick brown fox jumps over the lazy dog.', 'Total: 100 dollars.']));
  fs.writeFileSync(P('v2.pdf'), await make(['Quarterly report', 'The quick red fox jumps over the lazy dog.', 'Total: 120 dollars.', 'A new closing line was added.']));
  fs.writeFileSync(P('form.pdf'), await make(['Application form'], (page, f) => {
    page.drawText('Full name:', { x: 60, y: 690, size: 12, font: f });
    page.drawLine({ start: { x: 140, y: 688 }, end: { x: 500, y: 688 }, thickness: 0.8 });
    page.drawText('Date of birth:', { x: 60, y: 650, size: 12, font: f });
    page.drawLine({ start: { x: 150, y: 648 }, end: { x: 330, y: 648 }, thickness: 0.8 });
    for (const [k, label] of [[0, 'Yes'], [1, 'No']]) { page.drawRectangle({ x: 60 + k * 90, y: 600, width: 11, height: 11, borderWidth: 0.8, borderColor: rgb(0, 0, 0) }); page.drawText(label, { x: 76 + k * 90, y: 601, size: 12, font: f }); }
  }));
  const pageImg = await sharp({ create: { width: 600, height: 848, channels: 3, background: '#fbfbf7' } }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="848"><text x="50" y="110" font-family="Noto Sans" font-size="44" font-weight="bold">Invoice 2041</text>${Array.from({ length: 12 }, (_, i) => `<text x="50" y="${200 + i * 48}" font-family="Noto Sans" font-size="26">Line item ${i + 1} costs ${(i + 3) * 7} dollars</text>`).join('')}</svg>`) }]).png().toBuffer();
  const tilted = await sharp(pageImg).rotate(7, { background: '#00000000' }).png().toBuffer();
  const desk = await sharp({ create: { width: 1300, height: 1500, channels: 3, background: '#3b3631' }, }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="1500"><filter id="n"><feTurbulence baseFrequency="0.9" numOctaves="2"/></filter><rect width="1300" height="1500" filter="url(#n)" opacity="0.18"/></svg>') }, { input: tilted, left: 300, top: 260 }]).jpeg({ quality: 90 }).toFile(P('doc-photo.jpg'));
}
fs.writeFileSync(P('lines.dxf'), ['0', 'SECTION', '2', 'HEADER', '9', '$LTSCALE', '40', '1.0', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LTYPE', '70', '1', '0', 'LTYPE', '2', 'DASHED', '70', '0', '3', 'Dashed', '72', '65', '73', '2', '40', '9.525', '49', '6.35', '49', '-3.175', '0', 'ENDTAB', '0', 'TABLE', '2', 'LAYER', '70', '2', '0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS', '370', '-3', '0', 'LAYER', '2', 'THICK', '70', '0', '62', '7', '6', 'CONTINUOUS', '370', '70', '0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'THICK', '10', '0', '20', '0', '11', '200', '21', '0', '0', 'LINE', '8', '0', '6', 'DASHED', '10', '0', '20', '50', '11', '200', '21', '50', '0', 'LINE', '8', '0', '370', '13', '10', '0', '20', '100', '11', '200', '21', '100', '0', 'ENDSEC', '0', 'EOF', ''].join('\n'));
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
