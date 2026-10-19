'use strict';
// Tesseract (tesseract.js 7, WASM) with locally bundled language models. Extra languages download on demand.
const U = require('./util');
const { fs, fsp, path } = U;

let workerPromise = null;
let workerLang = '';

function langDirs() {
  return [path.join(U.cfg.user, 'tessdata'), path.join(U.cfg.data, 'tessdata')];
}
async function ensureLang(lang) {
  for (const code of String(lang).split('+')) {
    if (langDirs().some((d) => fs.existsSync(path.join(d, `${code}.traineddata`)))) continue;
    const dir = langDirs()[0];
    await fsp.mkdir(dir, { recursive: true });
    const res = await fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/${code}.traineddata`);
    if (!res.ok) throw new Error(`Couldn’t download the “${code}” OCR language. Check your internet connection.`);
    await fsp.writeFile(path.join(dir, `${code}.traineddata`), Buffer.from(await res.arrayBuffer()));
  }
  // Tesseract needs all requested models in one folder; use the user folder and mirror bundled ones into it.
  const userDir = langDirs()[0];
  await fsp.mkdir(userDir, { recursive: true });
  for (const code of String(lang).split('+')) {
    const target = path.join(userDir, `${code}.traineddata`);
    if (!fs.existsSync(target)) await fsp.copyFile(path.join(langDirs()[1], `${code}.traineddata`), target);
  }
  return userDir;
}
async function getWorker(lang) {
  if (workerPromise && workerLang === lang) return workerPromise;
  if (workerPromise) { try { (await workerPromise).terminate(); } catch (_) { /* ignore */ } }
  workerLang = lang;
  workerPromise = (async () => {
    const dir = await ensureLang(lang);
    const { createWorker } = require('tesseract.js');
    return createWorker(lang, 1, { langPath: dir, cachePath: dir, gzip: false, cacheMethod: 'none' });
  })();
  return workerPromise;
}
async function imageToPdf(png, lang = 'eng') {
  const w = await getWorker(lang);
  const { data } = await w.recognize(png, { pdfTitle: 'OCR' }, { pdf: true, text: false, blocks: false });
  return Uint8Array.from(data.pdf);
}
async function imageToText(input, lang = 'eng') {
  const w = await getWorker(lang);
  const { data } = await w.recognize(input, {}, { text: true });
  return data.text;
}
async function shutdown() { if (workerPromise) { try { (await workerPromise).terminate(); } catch (_) { /* ignore */ } workerPromise = null; } }
module.exports = { imageToPdf, imageToText, shutdown };
