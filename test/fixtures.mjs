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
fs.writeFileSync(P('mesh.obj'), `v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n`);
fs.writeFileSync(P('logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect x="10" y="10" width="220" height="140" rx="24" fill="#86c23a"/><circle cx="70" cy="80" r="40" fill="#2c6413"/><text x="125" y="92" font-size="30" fill="#fff">Lime</text></svg>');
for (const [f, t] of [['logo.ai', 'ai'], ['logo.eps', 'eps']]) try { sh(cli('vectorcraft'), ['convert', P('logo.svg'), P(f)]); } catch (e) { console.log(t, e.message); }
try { sh(cli('designcraft'), ['run', '--sample', '--export', P('layout.idml')]); } catch (e) { console.log('idml', e.message); }
try { sh(cli('effectcraft'), ['--demo', 'exec', 'file.exportLottie', '--params', JSON.stringify({ path: P('anim.json') })]); } catch (e) { console.log('lottie', e.message); }
try { sh(cli('filmcraft'), ['--demo', 'exec', 'file.exportOtio', `path=${P('timeline.otio')}`]); } catch (e) { console.log('otio', e.message); }
fs.rmSync(unpacked, { recursive: true, force: true });

// Data, contacts, subtitles and archives, all built here (CP949 through iconv-lite, archives through fflate, zlib or a
// tiny TAR writer, so no symlink has to exist on disk).
const iconv = require('iconv-lite');
const cp949 = (s) => iconv.encode(s, 'cp949');
const SAMPLE = '{\n  "name": "Filee 변환기",\n  "version": 3,\n  "ratio": 3.0,\n  "big": 12345678901234567890,\n  "enabled": true,\n  "missing": null,\n  "notes": "first line\\nsecond line",\n  "looksLikeABoolean": "true",\n  "looksLikeANumber": "007",\n  "empty": "",\n  "tags": ["a", "b"],\n  "nothing": [],\n  "owner": { "id": 1, "email": "me@example.com" },\n  "rows": [ { "x": 1 }, { "x": 2 } ]\n}\n';
const texts = {
  'sample.json': SAMPLE,
  'bom.json': `\ufeff${JSON.stringify([{ name: 'Lime', count: 12, zip: '01234' }, { name: 'Lemon', count: 7, zip: '00501' }]).replace('12,', '12, "big": 12345678901234567890,')}`,
  'users.json': '{"users": [{"id": 1, "address": {"city": "Seoul"}}, {"id": 2, "vip": true}]}',
  'nested.json': '[{"id": 1, "tags": ["a", "b"]}]',
  'list.json': '[{"a": 1, "b": null}, {"a": 2}]',
  'order.jsonc': '// settings\n{"2": 1, "1": 2, "f": 1e15, "g": 1.5e-5, "h": 1e300, "i": 3.0, /* big */ "j": 12345678901234567890,}\n',
  'rows.xml': '<rows><row><a>1</a><b>x</b></row><row><a>2</a><b>y</b></row></rows>',
  'columns.yaml': 'name: [a, b]\nage: [1]\n',
  'names.json': '{"first name": "Ada", "1st": 1, "list": [[1, 2]]}',
  'config.yml': "# comments are dropped\ndefaults: &defaults\n  adapter: postgres\n  port: 5432\ndevelopment:\n  <<: *defaults\n  port: 5433\n  database: dev\nflags: [yes, no, on, ~, 0x1F, 0o17, .inf, -1.5e3, '42']\nwhen: 2026-10-16\n",
  'bomb.yaml': `l0: &l0 [x, x, x, x, x, x, x, x, x, x]\n${[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `l${i}: &l${i} [${Array(10).fill(`*l${i - 1}`).join(', ')}]\n`).join('')}`,
  'config.toml': 'title = "TOML 예제"\nreleased = 1979-05-27T07:32:00-08:00\nday = 2026-10-16\n\n[server]\nports = [8000, 8001]\nlimits = { cpu = 2.5, memory = "1G" }\n\n[[products]]\nname = "Hammer"\nsku = 738594937\n\n[[products]]\nname = "Nail"\n',
  'catalog.xml': '<?xml version="1.0" encoding="utf-8"?>\n<!-- dropped -->\n<catalog xmlns:dc="http://purl.org/dc/elements/1.1/" version="2">\n  <book id="b1" lang="ko">\n    <dc:title>한국어 책</dc:title>\n    <price currency="KRW">15000</price>\n    <note/>\n    <summary></summary>\n    <body><![CDATA[a < b]]></body>\n  </book>\n  <book id="b2">\n    <dc:title>Second</dc:title>\n  </book>\n</catalog>\n',
  'feed.xml': '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ko"><title>소식</title><entry><id>1</id></entry></feed>',
  'events.jsonl': '{"a":1}\n\n{"a":2,"b":"한"}\n',
  'broken.jsonl': '{"a":1}\n{oops}\n',
  'people.csv': 'name,zip,age,member,score\r\n홍길동,01234,42,TRUE,3.5\r\n"Kim, Ada",,7,false,\r\n',
  'korean.csv': '이름,나이,메모\n홍길동,42,"안녕, 세상"\n',
  'zeros.csv': 'id,zip,part,when\r\n1,01234,1/2,2026-10-16\r\n2,007,3.50,1/2/2026\r\n',
  'semicolon.csv': 'Name;Price;Qty\r\nApple;1,5;3\r\nPear;2,25;10\r\n',
  'people.tsv': '이름\t금액\t메모\r\n김민지\t1,200\t"줄\n바꿈"\r\nLee, J\t3.5\t"""인용"""\r\n',
  '주소록.csv': '\ufeff이름,전화번호,이메일,회사,메모,관계\r\n홍길동,010-1111-2222 (mobile); 02-333-4444 (work),hong@example.com,"필이, 주식회사",아주 긴 메모입니다. 한 줄이 75바이트를 넘으면 vCard는 줄을 접어요. 접힌 줄은 공백으로 시작해요.,친구\r\n,,,,,\r\n',
  'numbers.csv': 'x,y\r\n1,2\r\n',
  'lenient.srt': '\ufeff1\r\n00:00:01,000 --> 00:00:02,000\r\n<i>First</i> line\r\n\r\nstill the first\r\n\r\n2\r\n00:00:03.5 --> 00:00:04,250\r\n{\\an8}<b>Second</b> <span>cue</span>\r\n3\r\n00:00:05,000 --> 00:00:06,000\r\nThird 2024\r\n',
  'song.lrc': '[ti:Song]\n[ar:Singer]\n[offset:+500]\n[00:10.00]First <00:10.50>line\n[00:12.30][00:20.00]Chorus\n[00:15.00]\n[00:25.5]Last\n',
  'show.ass': '[Script Info]\nTitle: Test show\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\nStyle: Thoughts,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,-1,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.00,0:00:03.50,Default,,0,0,0,,{\\an8\\pos(10,10)}Hello, {\\i1}world{\\i0}!\\NSecond {\\c&H00FFFF&}yellow{\\c} line\nComment: 0,0:00:02.00,0:00:03.50,Default,,0,0,0,,Not shown\nDialogue: 0,0:00:01.00,0:00:01.50,Thoughts,,0,0,0,,I think\\h so\nDialogue: 1,0:00:01.00,0:00:01.50,Thoughts,,0,0,0,,I think\\h so\nDialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}\n',
  'talk.vtt': 'WEBVTT\nLanguage: ko\n\nNOTE This is a comment\nwith two lines\n\nSTYLE\n::cue { color: yellow }\n\nintro\n00:01.000 --> 00:02.500 align:start position:10%\n<v Mary>Hi &amp; <i>welcome</i></v>\n<c.yellow>&lt;3</c>\n\n01:00:00.000 --> 01:00:01.000\n<00:00:01.500>Karaoke\n',
  'captions.ttml': '<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xml:lang="en" ttp:frameRate="25" ttp:tickRate="10000000">\n  <head><styling><style xml:id="it" tts:fontStyle="italic"/></styling></head>\n  <body>\n    <div begin="10s">\n      <p begin="00:00:01.000" end="00:00:02.000">Line one<br/>line <span tts:fontWeight="bold">two</span></p>\n      <p begin="00:00:03:05" dur="25f" style="it">Frames</p>\n      <p begin="50000000t" end="60000000t"><span tts:color="#ff0000">Red</span> ticks</p>\n    </div>\n  </body>\n</tt>\n',
  'burn.ttml': '<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0s" end="4s">BURNED IN CAPTION TEXT</p></div></body></tt>\n',
  'captions.scc': 'Scenarist_SCC V1.0\n\n00:00:01:00\t9420 9420 94ae 94ae 9452 9452 c8e5 ecec ef80 9470 9470 4361 665c 942f 942f\n\n00:00:03:00\t942c 942c\n\n00:00:05:00\t9425 9425 9470 9470 4f6e 6521 94ad 94ad 5477 6f21\n\n00:00:07:00\t942c 942c\n',
  'movie.sub': '{1}{1}25\n{25}{50}{y:i}Hello|world\n{75}{100}{c:$0000FF}Red\n',
};
for (const [f, t] of Object.entries(texts)) fs.writeFileSync(P(f), t);
fs.writeFileSync(P('memo-euckr.xml'), cp949('<?xml version="1.0" encoding="EUC-KR"?><memo><to>홍길동</to></memo>'));
fs.writeFileSync(P('korean-cp949.csv'), cp949(texts['korean.csv']));
fs.writeFileSync(P('cp949.srt'), cp949('1\r\n00:00:01,000 --> 00:00:02,500\r\n안녕하세요, 똠방각하\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n두 번째 줄\r\n'));
fs.writeFileSync(P('영화.smi'), cp949('<SAMI>\n<HEAD>\n<TITLE>영화 자막</TITLE>\n<STYLE TYPE="text/css">\n<!--\nP { margin-left:8pt; margin-right:8pt; text-align:center; }\n.KRCC { Name:한국어; lang:ko-KR; SAMIType:CC; }\n.ENCC { Name:English; lang:en-US; SAMIType:CC; }\n-->\n</STYLE>\n</HEAD>\n<BODY>\n<SYNC Start=1000><P Class=KRCC>안녕하세요,<br><font color="#ffff00">반가워요</font>\n<SYNC Start=1000><P Class=ENCC>Hello\n<SYNC Start=2500><P Class=KRCC>&nbsp;\n<SYNC Start=3000><P Class=KRCC><i>두 번째\n줄입니다</i>\n<SYNC Start=4200><P Class=KRCC>&nbsp\n<SYNC Start=5000><P Class=KRCC>세 번째 &amp; 마지막\n</BODY>\n</SAMI>\n'));
fs.writeFileSync(P('vobsub.sub'), Buffer.from([0x00, 0x00, 0x01, 0xba, 0x44, 0x00, 0x04, 0x00]));
fs.writeFileSync(P('phone-utf16.vcf'), iconv.encode('\ufeffBEGIN:VCARD\r\nVERSION:3.0\r\nFN:김철수\r\nTEL:010-0000-0000\r\nEND:VCARD\r\n', 'utf-16le'));
const qp = (t) => { let out = '', col = 0; for (const b of cp949(t)) { const piece = b >= 33 && b <= 126 && b !== 61 ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, '0')}`; if (col + piece.length > 60) { out += '=\r\n'; col = 0; } out += piece; col += piece.length; } return out; };
fs.writeFileSync(P('contacts.vcf'), Buffer.concat([
  Buffer.from(`BEGIN:VCARD\r\nVERSION:2.1\r\nN;CHARSET=KS_C_5601-1987;ENCODING=QUOTED-PRINTABLE:${qp('홍')};${qp('길동')};;;\r\nTEL;CELL:010-1234-5678\r\nTEL;WORK;VOICE:02-123-4567\r\nEMAIL;PREF;INTERNET:hong@example.com\r\nADR;HOME;ENCODING=QUOTED-PRINTABLE:;;${qp('서울특별시 종로구 세종대로 209 정부서울청사 별관 3층')};;;03171;\r\nNOTE:`, 'latin1'),
  cp949('전화 주세요'),
  Buffer.from('\r\nPHOTO;ENCODING=BASE64;TYPE=JPEG:\r\n /9j/4AAQSkZJRgABAQAAAQABAAD\r\n 2wBDAAgGBgcGBQgHBwcJ\r\n\r\nAGENT:\r\nBEGIN:VCARD\r\nVERSION:2.1\r\nFN:Assistant\r\nTEL:000\r\nEND:VCARD\r\nBDAY:19800102\r\nEND:VCARD\r\n', 'latin1'),
  Buffer.from(['BEGIN:VCARD', 'VERSION:3.0', 'FN:Ada Lovelace', 'N:Lovelace;Ada;;;', 'ORG:Analytical Engines\\, Ltd.;Research', 'TITLE:Engineer', 'item1.EMAIL;TYPE=INTERNET,WORK:ada@example.com', 'EMAIL;TYPE=HOME:ada@home.example', 'TEL;TYPE=CELL,VOICE:+44 20 7946 0000', 'NOTE:First line\\nSecond line\\; folded over two li', ' nes here', 'END:VCARD', ''].join('\r\n')),
  Buffer.from(['BEGIN:VCARD', 'VERSION:4.0', 'FN:王小明', 'N:王;小明;;;', 'TEL;VALUE=uri;TYPE="cell,voice":tel:+86-10-1234-5678', 'BDAY:--0412', 'END:VCARD', ''].join('\r\n')),
]));
const tar = (entries) => Buffer.concat([...entries.flatMap((e) => {
  const h = Buffer.alloc(512), data = Buffer.from(e.data || '');
  h.write(e.name, 0, 100, 'utf8');
  h.write(e.type === '5' ? '0000755\0' : '0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124); h.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136);
  h.write('        ', 148); h.write(e.type || '0', 156); if (e.link) h.write(e.link, 157, 100, 'utf8'); h.write('ustar\0', 257); h.write('00', 263);
  h.write(`${h.reduce((s, b) => s + b, 0).toString(8).padStart(6, '0')}\0 `, 148);
  return [h, data, Buffer.alloc((512 - (data.length % 512)) % 512)];
}), Buffer.alloc(1024)]);
fs.writeFileSync(P('links.tar'), tar([{ name: 'docs/', type: '5' }, { name: 'docs/a.txt', data: 'alpha' }, { name: 'docs/escape', type: '2', link: '../../../../../etc/passwd' }, { name: 'docs/inside', type: '2', link: 'a.txt' }, { name: 'docs/b.txt', data: 'beta' }]));
fs.writeFileSync(P('slip.zip'), zipSync({ 'ok.txt': strToU8('fine'), '../../evil.txt': strToU8('evil') }));
fs.writeFileSync(P('사진.zip'), zipSync({ 'photos/a.txt': strToU8('A'), 'photos/sub/b.txt': strToU8('B') }));
fs.writeFileSync(P('notes.txt.gz'), zlib.gzipSync('hello from a gzip file\n'));
for (const [d, t] of [['dupA', 'from A'], ['dupB', 'from B']]) { fs.mkdirSync(P(d), { recursive: true }); fs.writeFileSync(P(`${d}/report.txt`), t); }
fs.rmSync(P('secret.zip'), { force: true });
sh(sevenZ, ['a', '-tzip', '-plime', P('secret.zip'), 'a.txt'], { cwd: P('folder') });
console.log('fixtures in', dir, fs.readdirSync(dir).length, 'files');
