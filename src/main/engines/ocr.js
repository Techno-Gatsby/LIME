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
async function imageToText(input, lang = 'eng') {
  const w = await getWorker(lang);
  const png = await prepare(input);
  const { data } = await w.recognize(png, {}, { text: true });
  return tidy(data.text);
}
async function imageToPdf(png, lang = 'eng') {
  const w = await getWorker(lang);
  const { data } = await w.recognize(png, { pdfTitle: 'OCR' }, { pdf: true, text: false });
  return Uint8Array.from(data.pdf);
}
async function shutdown() { if (worker) { (await worker.catch(() => null))?.terminate().catch(() => {}); worker = null; } }
module.exports = { imageToText, imageToPdf, prepare, shutdown };
