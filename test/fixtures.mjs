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
fs.writeFileSync(P('mesh.obj'), `v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n`);
fs.writeFileSync(P('logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect x="10" y="10" width="220" height="140" rx="24" fill="#86c23a"/><circle cx="70" cy="80" r="40" fill="#2c6413"/><text x="125" y="92" font-size="30" fill="#fff">Lime</text></svg>');
for (const [f, t] of [['logo.ai', 'ai'], ['logo.eps', 'eps']]) try { sh(cli('vectorcraft'), ['convert', P('logo.svg'), P(f)]); } catch (e) { console.log(t, e.message); }
try { sh(cli('designcraft'), ['run', '--sample', '--export', P('layout.idml')]); } catch (e) { console.log('idml', e.message); }
try { sh(cli('effectcraft'), ['--demo', 'exec', 'file.exportLottie', '--params', JSON.stringify({ path: P('anim.json') })]); } catch (e) { console.log('lottie', e.message); }
try { sh(cli('filmcraft'), ['--demo', 'exec', 'file.exportOtio', `path=${P('timeline.otio')}`]); } catch (e) { console.log('otio', e.message); }
fs.rmSync(unpacked, { recursive: true, force: true });
console.log('fixtures in', dir, fs.readdirSync(dir).length, 'files');
