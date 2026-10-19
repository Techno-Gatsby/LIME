// End-to-end engine tests: generates real sample files, runs every tool, and checks the outputs.
// Run: npm test   (needs `npm run fetch-engines -- --linux` on Linux, or the Windows engines on Windows)
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'clem-test-'));
const I = path.join(work, 'in'), O = path.join(work, 'out');
fs.mkdirSync(I); fs.mkdirSync(O);
process.env.CLEM_BIN = path.join(root, 'vendor', 'bin', process.platform);
const U = require('../src/main/engines/util');
U.configure({ user: path.join(work, 'user') });
const tools = require('../src/main/tools');

async function fixtures() {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const sharp = require('sharp');
  await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#3a7bd5' } }).composite([{ input: Buffer.from('<svg width="1600" height="1000"><circle cx="800" cy="500" r="300" fill="#ff8a1a"/><text x="100" y="150" font-size="90" fill="white" font-family="sans-serif">Hello OCR 2026</text></svg>') }]).jpeg({ quality: 95 }).toFile(path.join(I, 'photo.jpg'));
  await sharp(path.join(I, 'photo.jpg')).png().toFile(path.join(I, 'graphic.png'));
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); const jpg = await d.embedJpg(fs.readFileSync(path.join(I, 'photo.jpg')));
  for (let i = 1; i <= 4; i++) { const p = d.addPage([595, 842]); p.drawText(`Quarterly Report ${i}`, { x: 60, y: 770, size: 24, font: f }); p.drawText('Contact: jane.doe@example.com or +1 (555) 123-4567', { x: 60, y: 730, size: 12, font: f }); p.drawText('Item        Qty      Price', { x: 60, y: 690, size: 12, font: f }); p.drawText('Apples      12       3.50', { x: 60, y: 672, size: 12, font: f }); p.drawImage(jpg, { x: 60, y: 300, width: 480, height: 300 }); }
  fs.writeFileSync(path.join(I, 'report.pdf'), await d.save());
  const s = await PDFDocument.create(); s.addPage([800, 500]).drawImage(await s.embedJpg(fs.readFileSync(path.join(I, 'photo.jpg'))), { x: 0, y: 0, width: 800, height: 500 }); fs.writeFileSync(path.join(I, 'scan.pdf'), await s.save());
  const ff = U.binPath('ffmpeg');
  execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(I, 'clip.mp4')]);
  execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', path.join(I, 'tone.wav')]);
  fs.writeFileSync(path.join(I, 'notes.md'), '# Title\n\nSome **bold** text.\n');
  fs.writeFileSync(path.join(I, 'subs.srt'), '1\n00:00:00,500 --> 00:00:02,000\nHello\n');
  const XLSX = require('xlsx'); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Score'], ['Ann', 9]]), 'Scores'); XLSX.writeFile(wb, path.join(I, 'book.xlsx'));
  const D = require('docx'); fs.writeFileSync(path.join(I, 'memo.docx'), await D.Packer.toBuffer(new D.Document({ sections: [{ children: [new D.Paragraph('Memo text')] }] })));
  execFileSync(U.binPath('7z'), ['a', '-bso0', path.join(I, 'bundle.7z'), path.join(I, 'notes.md')]);
}

const CASES = [
  ['merge-pdf', ['report.pdf', 'scan.pdf', 'photo.jpg']], ['split-pdf', ['report.pdf'], { mode: 'all' }], ['compress-pdf', ['report.pdf'], { level: 'extreme' }],
  ['pdf-to-word', ['report.pdf']], ['pdf-to-powerpoint', ['report.pdf']], ['pdf-to-excel', ['report.pdf'], { to: 'xlsx' }], ['pdf-to-jpg', ['report.pdf'], { pages: '1' }],
  ['pdf-to-text', ['report.pdf']], ['jpg-to-pdf', ['photo.jpg', 'graphic.png'], { combine: 'one' }], ['remove-pages', ['report.pdf'], { pages: '2' }],
  ['rotate-pdf', ['report.pdf'], { angle: '90' }], ['page-numbers', ['report.pdf']], ['watermark-pdf', ['report.pdf'], { kind: 'text', text: 'DRAFT' }],
  ['crop-pdf', ['report.pdf'], { top: 5, bottom: 5, left: 5, right: 5 }], ['redact-pdf', ['report.pdf'], { terms: 'Apples', patterns: ['email'] }],
  ['protect-pdf', ['report.pdf'], { userPassword: 'pw' }], ['ocr-pdf', ['scan.pdf'], { dpi: '200' }], ['repair-pdf', ['report.pdf']], ['flatten-pdf', ['report.pdf']],
  ['extract-images-pdf', ['report.pdf']], ['compress-image', ['graphic.png']], ['resize-image', ['photo.jpg'], { mode: 'percent', percent: 50 }],
  ['crop-image', ['photo.jpg'], { aspect: '1:1' }], ['convert-image', ['photo.jpg'], { to: 'webp' }], ['convert-image', ['photo.jpg'], { to: 'ico' }],
  ['adjust-image', ['photo.jpg'], { filter: 'sepia' }], ['watermark-image', ['photo.jpg']], ['strip-metadata', ['photo.jpg']], ['image-to-text', ['photo.jpg']],
  ['convert-video', ['clip.mp4'], { to: 'webm', quality: 'small' }], ['compress-video', ['clip.mp4']], ['trim-media', ['clip.mp4'], { start: '0:01', end: '0:03' }],
  ['merge-media', ['clip.mp4', 'clip.mp4']], ['extract-audio', ['clip.mp4']], ['convert-audio', ['tone.wav'], { to: 'flac' }], ['video-to-gif', ['clip.mp4'], { duration: 2 }],
  ['burn-subtitles', ['clip.mp4'], { subtitles: 'subs.srt' }], ['convert-sheet', ['book.xlsx'], { to: 'csv' }], ['convert-document', ['memo.docx'], { to: 'txt' }],
  ['extract-archive', ['bundle.7z']], ['create-archive', ['photo.jpg', 'notes.md'], { format: 'zip' }], ['test-archive', ['bundle.7z']], ['file-hash', ['photo.jpg']],
];
(async () => {
  await fixtures();
  let pass = 0, fail = 0;
  for (const [id, files, opts = {}] of CASES) {
    const t = tools.get(id);
    const o = { ...Object.fromEntries((t.options || []).map((x) => [x.key, x.default])), ...opts };
    if (o.subtitles) o.subtitles = path.join(I, o.subtitles);
    try {
      const r = await t.run(files.map((f) => path.join(I, f)), o, { out: U.outputPlanner({ outMode: 'folder', outFolder: O }), host: async () => { throw new Error('host n/a'); }, progress() {}, signal: new AbortController().signal });
      const list = (Array.isArray(r) ? r : [r]).map((x) => (typeof x === 'string' ? { path: x } : x));
      for (const x of list) if (x.path && !fs.existsSync(x.path)) throw new Error(`missing output ${x.path}`);
      pass++; console.log('✓', id);
    } catch (e) { fail++; console.log('✗', id, e.message); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await require('../src/main/engines/ocr').shutdown();
  process.exit(fail ? 1 : 0);
})();
