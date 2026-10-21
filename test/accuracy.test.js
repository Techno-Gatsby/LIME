'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async ({ submit, jobs, tools, dir }) => {
  const FX = process.env.LIME_FX, fx = (f) => path.join(FX, f);
  const OUT = path.join(dir, 'accuracy');
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;
  const E = (n) => require(path.join(__dirname, '..', 'src', 'main', 'engines', n));
  const sharp = require('sharp');
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const near = (a, b, tol, what) => ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = async (name, fn) => {
    name = `accuracy: ${name}`;
    if (only && !only.test(name)) return;
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { status = 'FAIL'; detail = e.message; }
    console.log(`${status} ${name.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 240));
    results.push({ name, status, detail });
  };
  const run = async (tool, files, opts, name) => {
    const d = path.join(OUT, name);
    fs.mkdirSync(d, { recursive: true });
    const id = submit({ tool, files, opts, dest: { kind: 'dir', path: d } });
    let j;
    for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(100); }
    ok(j.status === 'done', `${tool}: ${j.status}: ${j.error}`);
    return j.results.flatMap((r) => r.paths || (r.path ? [r.path] : []));
  };
  const words = (t) => String(t).toLowerCase().split(/\s+/).filter(Boolean);
  const SENT = fs.readFileSync(fx('sentence.txt'), 'utf8');
  const score = (t) => { const pool = words(t); let hit = 0; for (const w of words(SENT)) { const i = pool.indexOf(w); if (i >= 0) { hit++; pool.splice(i, 1); } } return hit / words(SENT).length; };
  const pdfLines = async (file, index = 0) => { const P = E('pdf'), m = await P.mupdf(), { doc } = await P.readPdf(file); return P.extractLines(m, doc.loadPage(index)); };
  const pdfText = async (file) => { const { doc } = await E('pdf').readPdf(file); let t = ''; for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText('').asText(); return t; };

  const ocr = E('ocr');
  const notes = [];
  const realOs = ocr.engines.os, realNote = ocr.engines.note;
  ocr.engines.note = (m) => notes.push(m);
  const PAGE = { width: 2480, height: 3508 };
  const fakeLines = (w, h) => [
    { text: 'Invoice 2041', box: [250, 300, 900, 90], words: [{ text: 'Invoice', box: [250, 300, 520, 90] }, { text: '2041', box: [810, 300, 340, 90] }] },
    { text: 'Total due £1,284.50', box: [250, 450, 1200, 90], words: [{ text: 'Total', box: [250, 450, 330, 90] }, { text: 'due', box: [620, 450, 220, 90] }, { text: '£1,284.50', box: [900, 450, 550, 90] }] },
    { text: 'Köszönöm szépen', box: [250, 1200, 1100, 90], words: [{ text: 'Köszönöm', box: [250, 1200, 620, 90] }, { text: 'szépen', box: [920, 1200, 430, 90] }] },
  ].map((l) => ({ ...l, box: l.box.map((v, i) => v * (i % 2 ? h / PAGE.height : w / PAGE.width)), words: l.words.map((x) => ({ ...x, box: x.box.map((v, i) => v * (i % 2 ? h / PAGE.height : w / PAGE.width)) })) }));
  const fake = (langs, read) => ({ name: 'Fake OS OCR', maxSide: 1500, langs: async () => langs, read: async (file, tag) => { const m = await sharp(file).metadata(); return read ? read(m, tag) : { width: m.width, height: m.height, lines: fakeLines(m.width, m.height) }; } });
  await check('OCR words land where the engine saw them', async () => {
    ocr.engines.os = fake(['en-US', 'de-DE']);
    const png = await sharp({ create: { width: PAGE.width, height: PAGE.height, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const { pdf, text } = await ocr.imageToTextPdf(png, 'eng');
    const file = path.join(OUT, 'layer.pdf');
    fs.writeFileSync(file, pdf);
    ok(text === 'Invoice 2041\nTotal due £1,284.50\n\nKöszönöm szépen', `text ${JSON.stringify(text)}`);
    const lines = await pdfLines(file), k = 72 / 300;
    ok(lines.length === 3, `${lines.length} lines: ${lines.map((l) => l.text).join(' | ')}`);
    const want = fakeLines(PAGE.width, PAGE.height);
    let worst = 0;
    want.forEach((l, i) => {
      ok(lines[i].text.trim() === l.text, `line ${i}: ${JSON.stringify(lines[i].text)} ≠ ${l.text}`);
      for (const w of l.words) {
        const chars = lines[i].chars.slice(lines[i].text.indexOf(w.text), lines[i].text.indexOf(w.text) + w.text.length);
        const x0 = Math.min(...chars.map((c) => Math.min(c.quad[0], c.quad[4]))), x1 = Math.max(...chars.map((c) => Math.max(c.quad[2], c.quad[6])));
        worst = Math.max(worst, Math.abs(x0 - w.box[0] * k), Math.abs(x1 - (w.box[0] + w.box[2]) * k));
        near(x0, w.box[0] * k, 1.5, `${w.text} left`);
        near(x1, (w.box[0] + w.box[2]) * k, 2.5, `${w.text} right`);
        near(lines[i].origin[1], (l.box[1] + l.box[3]) * k, l.box[3] * k * 0.35, `${w.text} baseline`);
      }
    });
    const hits = (await E('pdf').readPdf(file)).doc.loadPage(0).search('szépen');
    ok(hits.length === 1 && Math.abs(hits[0][0][0] - 920 * k) < 2, `search quad ${JSON.stringify(hits[0]?.[0])}`);
    return `7 words within ${worst.toFixed(2)} pt of their boxes; search finds them`;
  });
  await check('OCR searchable PDF keeps the page under the text', async () => {
    const strip = (m) => { const w = m.width, h = m.height, box = (x, dx) => [x * w, 0.4 * h, dx * w, 0.2 * h]; return { width: w, height: h, lines: [{ text: 'Total due £1,284.50', box: box(0.1, 0.4), words: [{ text: 'Total', box: box(0.1, 0.12) }, { text: 'due', box: box(0.235, 0.07) }, { text: '£1,284.50', box: box(0.32, 0.18) }] }] }; };
    ocr.engines.os = fake(['en-US'], strip);
    const out = path.join(OUT, 'searchable.pdf');
    const r = await E('pdf').ocr(fx('scan.pdf'), { lang: 'eng', skipText: false, dpi: '300' }, out, null);
    const { doc, m } = await E('pdf').readPdf(out), page = doc.loadPage(0);
    ok(/Recognised text on 1 page/.test(r.note), r.note);
    ok(page.toStructuredText('').asText().includes('Total due £1,284.50'), 'the words are not on the page');
    const shot = (pg) => pg.toPixmap(m.Matrix.scale(1, 1), m.ColorSpace.DeviceRGB, false, true).getPixels();
    const a = shot(page), src = (await E('pdf').readPdf(fx('scan.pdf'))).doc.loadPage(0), b = shot(src);
    ok(a.length === b.length, `rendered ${a.length} bytes, the source ${b.length}`);
    let diff = 0, ink = 0;
    for (let i = 0; i < a.length; i++) { diff += Math.abs(a[i] - b[i]); if (b[i] < 128) ink++; }
    ok(ink > a.length * 0.002 && diff / a.length < 2, `the scanned page changed: mean difference ${(diff / a.length).toFixed(2)} over ${ink} dark samples`);
    return `the page still shows the scan (mean difference ${(diff / a.length).toFixed(2)}) with the words over it`;
  });
  await check('OCR falls back to tesseract and says so', async () => {
    notes.length = 0;
    ocr.engines.os = fake(['en-US'], () => { throw new Error('boom'); });
    let t = await ocr.imageToText(fs.readFileSync(fx('text.png')), 'eng');
    ok(score(t) >= 0.9, `after a failure: ${Math.round(score(t) * 100)}%`);
    ok(notes.some((n) => /Fake OS OCR failed \(boom\); using tesseract/.test(n)), `notes: ${notes.join(' / ')}`);
    ocr.engines.os = fake(['de-DE', 'fr-FR']);
    notes.length = 0;
    t = await ocr.imageToText(fs.readFileSync(fx('text.png')), 'eng');
    ok(score(t) >= 0.9, `without the language: ${Math.round(score(t) * 100)}%`);
    ok(notes.some((n) => /can’t read “eng”; using tesseract/.test(n)), `notes: ${notes.join(' / ')}`);
    ok(await ocr.osTag('fra') === 'fr-fr' && await ocr.osTag('deu') === 'de-de' && await ocr.osTag('chi_sim') === null, 'language matching');
    ocr.engines.os = fake(['zh-Hans-CN', 'pt-BR', 'en']);
    ok(await ocr.osTag('chi_sim') === 'zh-hans-cn' && await ocr.osTag('por') === 'pt-br' && await ocr.osTag('eng') === 'en', 'region matching');
    return `tesseract read ${Math.round(score(t) * 100)}% after the engine failed and when it lacked the language`;
  });
  ocr.engines.os = realOs;
  ocr.engines.note = realNote;

  return results;
};
