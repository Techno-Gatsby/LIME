'use strict';
const U = require('./util');
const { fs, fsp, path } = U;

let worker = null, workerLang = '';

async function langDir(lang) {
  const dir = path.join(U.cfg.user, 'tessdata');
  await fsp.mkdir(dir, { recursive: true });
  for (const code of String(lang).split('+')) {
    const target = path.join(dir, `${code}.traineddata`);
    const bundled = path.join(U.cfg.data, 'tessdata', `${code}.traineddata`);
    if (!fs.existsSync(bundled)) throw new Error(`The “${code}” OCR language isn’t included in Lime.`);
    if (!fs.existsSync(target) || fs.statSync(target).size !== fs.statSync(bundled).size) await fsp.copyFile(bundled, target);
  }
  return dir;
}
async function getWorker(lang) {
  if (worker && workerLang === lang) return worker;
  if (worker) (await worker.catch(() => null))?.terminate().catch(() => {});
  workerLang = lang;
  worker = (async () => {
    const dir = await langDir(lang);
    const w = await require('tesseract.js').createWorker(lang, 1, { langPath: dir, cachePath: dir, gzip: false, cacheMethod: 'none', workerPath: path.join(__dirname, 'ocr-worker.js') });
    await w.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
    return w;
  })();
  worker.catch(() => { worker = null; });
  return worker;
}
async function prepare(input) {
  const sharp = require('sharp');
  const src = sharp(input, { failOn: 'none', limitInputPixels: false }).rotate().flatten({ background: '#ffffff' }).greyscale();
  const { data, info } = await src.clone().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += data[i];
  const dark = sum / Math.ceil(data.length / 4) < 110;
  const k = info.width < 2200 ? Math.min(3, 2200 / info.width) : 1;
  let p = sharp(data, { raw: info });
  if (dark) p = p.negate({ alpha: false });
  if (k > 1.05) p = p.resize(Math.round(info.width * k), Math.round(info.height * k), { kernel: 'lanczos3' });
  return p.normalise().extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#ffffff' }).png().toBuffer();
}
const tidy = (t) => String(t).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

const BCP = { eng: 'en', spa: 'es', fra: 'fr', deu: 'de', ita: 'it', por: 'pt', nld: 'nl', rus: 'ru', ara: 'ar', hin: 'hi', jpn: 'ja', chi_sim: 'zh-Hans', chi_tra: 'zh-Hant', kor: 'ko', tha: 'th', vie: 'vi', ukr: 'uk', pol: 'pl', tur: 'tr', swe: 'sv', dan: 'da', nor: 'nb', fin: 'fi', ces: 'cs', hun: 'hu', ron: 'ro', ell: 'el', heb: 'he', ind: 'id' };
const lines = (s) => String(s).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
async function powershell(script, vars) {
  const head = Object.entries(vars).map(([k, v]) => `$${k} = '${String(v).replace(/'/g, "''")}'`).join('; ');
  const r = await U.run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`${head}\n${script}`, 'utf16le').toString('base64')], { timeout: 180000, errorMessage: 'Windows OCR' });
  return r.stdout;
}
let winScript = null;
const ENGINES = {
  win32: {
    name: 'Windows OCR', maxSide: 1500,
    langs: async () => lines(await powershell(winScript ??= await fsp.readFile(path.join(__dirname, 'ocr-win.ps1'), 'utf8'), { Lang: 'list', Path: '' })),
    read: async (file, tag) => JSON.parse(await powershell(winScript ??= await fsp.readFile(path.join(__dirname, 'ocr-win.ps1'), 'utf8'), { Lang: tag, Path: file })),
  },
  darwin: {
    name: 'Apple Vision', maxSide: 0,
    langs: async () => lines((await U.run(U.binPath('lime-ocr'), ['--languages'], { timeout: 60000 })).stdout),
    read: async (file, tag) => JSON.parse((await U.run(U.binPath('lime-ocr'), [file, tag], { timeout: 180000, errorMessage: 'Apple Vision' })).stdout),
  },
};
const engines = { os: ENGINES[process.platform] || null, note: (m) => console.warn(`[ocr] ${m}`) };
const known = { os: null, tags: null, noted: new Set() };
const once = (m) => { if (!known.noted.has(m)) { known.noted.add(m); engines.note(m); } };
async function osTag(lang) {
  const os = engines.os, want = (BCP[String(lang).split('+')[0]] || '').toLowerCase();
  if (!os || !want) return null;
  if (known.os !== os) {
    known.os = os;
    try { known.tags = (await os.langs()).map((t) => t.toLowerCase()); } catch (e) { once(`${os.name} is not available (${e.message}); using tesseract`); known.tags = []; }
  }
  const tags = known.tags, tag = tags.find((t) => t === want) || tags.find((t) => t.startsWith(`${want}-`)) || (want.includes('-') ? null : tags.find((t) => t.split('-')[0] === want));
  if (!tag) once(`${os.name} can’t read “${lang}”; using tesseract`);
  return tag;
}
async function readOs(png, lang) {
  const os = engines.os, tag = await osTag(lang);
  if (!tag) return null;
  const dir = await U.tmpDir('ocr');
  try {
    const sharp = require('sharp');
    const m = await sharp(png).metadata(), side = Math.max(m.width, m.height), k = os.maxSide && side > os.maxSide ? os.maxSide / side : 1;
    let p = sharp(png, { failOn: 'none', limitInputPixels: false }).rotate().flatten({ background: '#ffffff' });
    if (k < 1) p = p.resize(Math.round(m.width * k), Math.round(m.height * k), { kernel: 'lanczos3' });
    const file = path.join(dir, 'in.png');
    await p.png().toFile(file);
    const r = await os.read(file, tag);
    if (!r || !Array.isArray(r.lines)) throw new Error('no result');
    const back = (b) => (k < 1 ? b.map((v) => v / k) : b);
    const out = r.lines.map((l) => ({ text: String(l.text || ''), box: l.box ? back(l.box) : null, words: (l.words || []).filter((w) => w.text).map((w) => ({ text: String(w.text), box: back(w.box) })) }));
    for (const l of out) if (!l.box && l.words.length) l.box = union(l.words.map((w) => w.box));
    const lines = out.filter((l) => l.box && l.text.trim());
    if (!lines.some((l) => l.words.length)) throw new Error('it read nothing');
    return { engine: os.name, width: m.width, height: m.height, lines };
  } catch (e) {
    engines.note(`${os.name} failed (${e.message}); using tesseract`);
    return null;
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const union = (boxes) => { const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1])); return [x0, y0, Math.max(...boxes.map((b) => b[0] + b[2])) - x0, Math.max(...boxes.map((b) => b[1] + b[3])) - y0]; };
function asText(r) {
  const ls = r.lines;
  let out = '';
  for (let i = 0; i < ls.length; i++) {
    const gap = i ? ls[i].box[1] - (ls[i - 1].box[1] + ls[i - 1].box[3]) : 0;
    out += (i ? (gap > Math.max(ls[i].box[3], ls[i - 1].box[3]) * 0.9 ? '\n\n' : '\n') : '') + ls[i].text;
  }
  return tidy(out);
}

let glyphless = null;
async function glyphlessFont() {
  if (glyphless) return glyphless;
  const fontkit = require('@pdf-lib/fontkit');
  const fk = fontkit.create(await fsp.readFile(path.join(U.cfg.data, 'fonts', 'NotoSans-Regular.ttf')));
  const subset = fk.createSubset();
  subset.includeGlyph(fk.glyphForCodePoint(32).id);
  const chunks = [];
  await new Promise((ok, no) => subset.encodeStream().on('data', (c) => chunks.push(c)).on('end', ok).on('error', no));
  return (glyphless = Buffer.concat(chunks));
}
const PER_FONT = 65000;
async function layer(r, png) {
  const { PDFDocument, PDFString, PDFHexString, PDFNumber, PDFName, PDFOperator, PDFOperatorNames: Ops } = require('pdf-lib');
  const doc = await PDFDocument.create(), ctx = doc.context, k = 72 / 300, W = r.width * k, H = r.height * k;
  const page = doc.addPage([W, H]);
  if (png) page.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: W, height: H });
  const num = (v) => PDFNumber.of(Math.round(v * 100) / 100), op = (n, ...a) => PDFOperator.of(n, a), hex = (n) => n.toString(16).padStart(4, '0');
  const chars = [], ops = [op(Ops.BeginText), op(Ops.SetTextRenderingMode, num(3))];
  for (const l of r.lines) {
    const size = Math.max(1, l.box[3] * k), base = H - (l.box[1] + l.box[3]) * k + size * 0.18;
    for (const w of l.words) {
      const cps = [...w.text], width = Math.round(((w.box[2] * k) / cps.length / size) * 1000);
      if (!cps.length) continue;
      const codes = cps.map((c) => { chars.push({ c, width }); return hex(((chars.length - 1) % PER_FONT) + 1); });
      ops.push(op(Ops.SetFontAndSize, PDFName.of(`F${Math.floor((chars.length - 1) / PER_FONT)}`), num(size)), op(Ops.SetTextMatrix, num(1), num(0), num(0), num(1), num(w.box[0] * k), num(base)), op(Ops.ShowText, PDFHexString.of(codes.join(''))));
    }
  }
  ops.push(op(Ops.EndText));
  const ttf = await glyphlessFont(), map = Buffer.alloc(2 * (PER_FONT + 1));
  for (let i = 1; i < map.length; i += 2) map[i] = 1;
  const descriptor = ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: 'GlyphLessFont', Flags: 4, FontBBox: [0, 0, 500, 1000], ItalicAngle: 0, Ascent: 1000, Descent: 0, CapHeight: 1000, StemV: 80, FontFile2: ctx.register(ctx.flateStream(ttf, { Length1: ttf.length })) }));
  const gids = ctx.register(ctx.flateStream(map));
  for (let f = 0; f * PER_FONT < chars.length; f++) {
    const mine = chars.slice(f * PER_FONT, (f + 1) * PER_FONT);
    const cid = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'GlyphLessFont', CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 }, FontDescriptor: descriptor, DW: 500, W: [1, mine.map((c) => c.width)], CIDToGIDMap: gids }));
    const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'GlyphLessFont', Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: ctx.register(ctx.flateStream(require('./shape').toUnicode(mine.map((c) => c.c)))) }));
    page.node.setFontDictionary(PDFName.of(`F${f}`), font);
  }
  page.pushOperators(...ops);
  return { pdf: await doc.save({ useObjectStreams: false }), text: asText(r) };
}

async function imageToText(input, lang = 'eng') {
  const os = await readOs(input, lang);
  if (os) return asText(os);
  const w = await getWorker(lang);
  const png = await prepare(input);
  const { data } = await w.recognize(png, {}, { text: true });
  return tidy(data.text);
}
async function imageToPdf(png, lang = 'eng') {
  const os = await readOs(png, lang);
  if (os) return (await layer(os, png)).pdf;
  const w = await getWorker(lang);
  const { data } = await w.recognize(png, { pdfTitle: 'OCR' }, { pdf: true, text: false });
  return Uint8Array.from(data.pdf);
}
async function imageToTextPdf(png, lang = 'eng') {
  const os = await readOs(png, lang);
  if (os) return layer(os, null);
  const w = await getWorker(lang);
  const { data } = await w.recognize(png, { pdfTitle: 'OCR', pdfTextOnly: true }, { pdf: true, text: true });
  return { pdf: Uint8Array.from(data.pdf), text: data.text || '' };
}
async function shutdown() { if (worker) { (await worker.catch(() => null))?.terminate().catch(() => {}); worker = null; } }
module.exports = { imageToText, imageToPdf, imageToTextPdf, prepare, shutdown, engines, layer, asText, osTag };
