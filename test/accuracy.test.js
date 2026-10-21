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
  const same = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
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

  const edit = require(path.join(__dirname, '..', 'src', 'main', 'pdfedit'));
  const { PDFDocument, PDFName, decodePDFRawStream } = require('pdf-lib');
  const FONTS = path.join(E('util').cfg.data, 'fonts');
  const blank = path.join(OUT, 'blank.pdf');
  const typed = async (name, text, font) => {
    if (!fs.existsSync(blank)) { const d = await PDFDocument.create(); d.addPage([500, 120]); fs.writeFileSync(blank, await d.save()); }
    const s = await edit.open(blank);
    await edit.apply(s.id, [{ type: 'text', page: 0, x: 30, y: 60, size: 28, text, font, color: '#000000' }]);
    const out = path.join(OUT, `typed-${name}.pdf`);
    await edit.save(s.id, out);
    edit.close(s.id);
    const P = E('pdf'), m = await P.mupdf(), { doc } = await P.readPdf(out), page = doc.loadPage(0);
    const chars = [];
    page.toStructuredText('preserve-whitespace').walk({ onChar: (c, origin) => chars.push([c, origin[0]]) });
    return { out, text: page.toStructuredText('').asText().trim(), chars, png: Buffer.from(page.toPixmap(m.Matrix.scale(3, 3), m.ColorSpace.DeviceRGB, false, true).asPNG()) };
  };
  const solo = (fam, file) => {
    const alt = `Zq${fam.slice(2)}`, to = path.join(OUT, `ref-${file}`);
    if (!fs.existsSync(to)) {
      let b = fs.readFileSync(path.join(FONTS, file)).toString('latin1');
      for (const [a, z] of [[fam, alt], [fam.replace(/ /g, ''), alt.replace(/ /g, '')]]) b = b.split(a).join(z).split([...a].map((c) => `\0${c}`).join('')).join([...z].map((c) => `\0${c}`).join(''));
      fs.writeFileSync(to, Buffer.from(b, 'latin1'));
    }
    return [alt, to];
  };
  const usesFile = async (fam, file, text) => { const [, f] = solo(fam, file); const a = await pango(fam, file, text), b = await sharp({ text: { text: `<span font="Zq Missing 28" foreground="black">${text}</span>`, fontfile: f, dpi: 216, rgba: true } }).flatten({ background: '#ffffff' }).png().toBuffer(); return !a.equals(b); };
  const pango = (fam, file, text, extra = '') => { const [alt, f] = solo(fam, file); return sharp({ text: { text: `<span font="${alt} 28" foreground="black"${extra}>${text}</span>`, fontfile: f, dpi: 216, rgba: true } }).flatten({ background: '#ffffff' }).png().toBuffer(); };
  const ink = async (png) => {
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
    let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x] < 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  };
  const overlap = async (a, b) => {
    const W = 600, H = 80, pix = async (png) => sharp(png).extract(await ink(png)).greyscale().resize(W, H, { fit: 'fill' }).raw().toBuffer();
    const A = await pix(a), B = await pix(b);
    let both = 0, any = 0;
    for (let i = 0; i < W * H; i++) { const x = A[i] < 128, y = B[i] < 128; if (x && y) both++; if (x || y) any++; }
    return both / any;
  };
  const pct = (v) => `${Math.round(v * 100)}%`;
  await check('Arabic, Devanagari, Thai and ligatures in edited text', async () => {
    const fontkit = require('@pdf-lib/fontkit'), notes = [];
    for (const [name, fam, file, text, font] of [['arabic', 'Noto Sans Arabic', 'NotoSansArabic-Regular.ttf', 'سلام عليكم يا عالم', 'sans'], ['devanagari', 'Noto Sans Devanagari', 'NotoSansDevanagari-Regular.ttf', 'नमस्ते क्षत्रिय हिन्दी', 'sans'], ['thai', 'Noto Sans Thai', 'NotoSansThai-Regular.ttf', 'สวัสดี ภาษาไทย', 'sans'], ['latin', 'Carlito', 'Carlito-Regular.ttf', 'office fifi flow', 'carlito']]) {
      const r = await typed(name, text, font);
      ok(r.text === text, `${name} reads back as ${JSON.stringify(r.text)}`);
      if (!(await usesFile(fam, file, text))) {
        if (name === 'arabic') { const iso = await overlap(r.png, (await typed('arabic-iso', [...text].join('\u200c'), font)).png); ok(iso < 0.6, `joined and isolated letters agree ${pct(iso)}`); notes.push(`arabic joins (${pct(iso)} like isolated letters)`); }
        else notes.push(`${name} read back`);
        continue;
      }
      const same = await overlap(r.png, await pango(fam, file, text));
      ok(same >= 0.85, `${name}: ${pct(same)} of the ink agrees with HarfBuzz's rendering`);
      let control = '';
      if (name === 'arabic') { const iso = await overlap(r.png, await pango(fam, file, [...text].join('\u200c'))); ok(iso < 0.4, `isolated forms would agree ${pct(iso)}`); control = `, ${pct(iso)} with isolated letters`; }
      if (name === 'latin') { const plain = await overlap(r.png, await pango(fam, file, text, ' font_features="liga=0"')); ok(plain < same - 0.05, `without ligatures ${pct(plain)}`); control = `, ${pct(plain)} without ligatures`; }
      if (name === 'devanagari') ok(/k_ssa/.test(fontkit.create(fs.readFileSync(path.join(FONTS, file))).layout('क्ष').glyphs[0].name), 'no conjunct glyph in the font');
      notes.push(`${name} ${pct(same)}${control}`);
    }
    return `read back exactly; against HarfBuzz: ${notes.join('; ')}`;
  });
  await check('right-to-left lines keep numbers and brackets in place', async () => {
    const r = await typed('bidi', 'سلام عليكم (2024) يا عالم', 'sans'), at = (c) => r.chars.filter(([x]) => x === c).map(([, x]) => x);
    const digits = r.chars.filter(([c]) => /\d/.test(c)).map(([c, x]) => [c, x]);
    ok(digits.map(([c]) => c).join('') === '2024' && digits.every(([, x], i) => !i || x > digits[i - 1][1]), `digits ${JSON.stringify(digits)}`);
    ok(at('س')[0] > at('ك')[0] && at('ك')[0] > at('(')[0] && at('(')[0] > digits[3][1] && digits[0][1] > at(')')[0] && at(')')[0] > at('ي').find((x) => x < at(')')[0]) && at('ا')[0] < at(')')[0], `order by x: ${r.chars.filter(([c]) => c.trim()).sort((a, b) => a[1] - b[1]).map(([c, x]) => `${c}@${x.toFixed(0)}`).join(' ')}`);
    const doc = await PDFDocument.load(fs.readFileSync(r.out)), noto = require('@pdf-lib/fontkit').create(fs.readFileSync(path.join(FONTS, 'NotoSans-Regular.ttf')));
    let mirrored = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof require('pdf-lib').PDFDict) || String(obj.get(PDFName.of('Subtype'))) !== '/Type0') continue;
      const cid = obj.lookup(PDFName.of('DescendantFonts')).lookup(0), map = Buffer.from(decodePDFRawStream(cid.lookup(PDFName.of('CIDToGIDMap'))).decode());
      const sub = require('@pdf-lib/fontkit').create(Buffer.from(decodePDFRawStream(cid.lookup(PDFName.of('FontDescriptor')).lookup(PDFName.of('FontFile2'))).decode()));
      const cmap = Buffer.from(decodePDFRawStream(obj.lookup(PDFName.of('ToUnicode'))).decode()).toString('latin1');
      for (const [, code, hex] of cmap.matchAll(/<([0-9a-f]{4})> <([0-9a-f]+)>/gi)) {
        const ch = Buffer.from(hex, 'hex').swap16().toString('utf16le');
        if (ch !== '(' && ch !== ')') continue;
        const gid = map.readUInt16BE(2 * parseInt(code, 16));
        ok(sub.getGlyph(gid).path.toSVG() === noto.glyphForCodePoint(ch === '(' ? 0x29 : 0x28).path.toSVG(), `${ch} is drawn with its own glyph, not the mirrored one`);
        mirrored++;
      }
    }
    ok(mirrored === 2, `${mirrored} bracket codes`);
    return `digits read left to right inside the Arabic line, both brackets drawn mirrored, words ordered right to left`;
  });
  await check('a script no bundled font has comes from an installed font', async () => {
    const text = 'שלום עולם', r = await typed('hebrew', text, 'sans');
    ok(r.text === text, `reads back as ${JSON.stringify(r.text)}`);
    const box = await ink(r.png);
    ok(box.width > 100 && box.height > 20, `ink ${JSON.stringify(box)}`);
    return `Hebrew typed with the Noto Sans choice reads back exactly and shows ${box.width}×${box.height} px of ink at 3×`;
  });

  const s15 = (v) => { const b = Buffer.alloc(4); b.writeInt32BE(Math.round(v * 65536)); return b; };
  const lab = (r, g, b) => {
    const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), [R, G, B] = [r, g, b].map(lin);
    const X = (0.4360747 * R + 0.3850649 * G + 0.1430804 * B) / 0.9642, Y = 0.2225045 * R + 0.7168786 * G + 0.0606169 * B, Z = (0.0139322 * R + 0.0971045 * G + 0.7141733 * B) / 0.8249;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const pressProfile = () => {
    const lut = Buffer.alloc(48 + 4 * 256 + 48 + 3 * 256);
    lut.write('mft1', 0); lut[8] = 4; lut[9] = 3; lut[10] = 2;
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => s15(v).copy(lut, 12 + 4 * i));
    let o = 48;
    for (let i = 0; i < 1024; i++) lut[o++] = i & 255;
    for (let i = 0; i < 16; i++) { const [c, m, y, k] = [(i >> 3) & 1, (i >> 2) & 1, (i >> 1) & 1, i & 1], L = lab((1 - c) * (1 - k), (1 - m) * (1 - k) * 0.85, (1 - y) * (1 - k) * 0.6); lut[o++] = Math.round(L[0] * 2.55); lut[o++] = Math.round(L[1] + 128); lut[o++] = Math.round(L[2] + 128); }
    for (let i = 0; i < 768; i++) lut[o++] = i & 255;
    const desc = Buffer.alloc(12 + 16 + 12 + 67); desc.write('desc', 0); desc.writeUInt32BE(16, 8); desc.write('Test press CMYK', 12);
    const tags = [['desc', desc], ['cprt', Buffer.from('text\0\0\0\0None\0\0\0\0')], ['wtpt', Buffer.concat([Buffer.from('XYZ \0\0\0\0'), s15(0.9642), s15(1), s15(0.8249)])], ['A2B0', lut]];
    let at = 132 + 12 * tags.length;
    const table = Buffer.alloc(4 + 12 * tags.length), body = [];
    table.writeUInt32BE(tags.length);
    tags.forEach(([sig, data], i) => { const pd = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]); table.write(sig, 4 + 12 * i); table.writeUInt32BE(at, 8 + 12 * i); table.writeUInt32BE(data.length, 12 + 12 * i); body.push(pd); at += pd.length; });
    const head = Buffer.alloc(128);
    head.writeUInt32BE(at); head.writeUInt32BE(0x02100000, 8); head.write('prtrCMYKLab ', 12); head.write('acsp', 36);
    [0.9642, 1, 0.8249].forEach((v, i) => s15(v).copy(head, 68 + 4 * i));
    return Buffer.concat([head, table, ...body]);
  };
  const W = 60, H = 20, INK = [[200, 30, 0, 0], [0, 180, 200, 20], [60, 60, 60, 80]], ink4 = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) ink4.set(INK[Math.floor((i % W) / 20)], i * 4);
  const icc = pressProfile(), img = E('image');
  const means = async (input) => (await sharp(input).stats()).channels.slice(0, 3).map((c) => c.mean);
  const far = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  const fmt = (a) => a.map((v) => v.toFixed(1)).join('/');
  const naive = INK.map(([c, m, y, k]) => [c, m, y].map((v) => 255 * (1 - v / 255) * (1 - k / 255))).reduce((a, b) => a.map((v, i) => v + b[i] / 3), [0, 0, 0]);
  const builtin = await means(await sharp(img.cmykTiff(ink4, W, H, null)).toColourspace('srgb').png().toBuffer());
  const reference = await means(await sharp(img.cmykTiff(ink4, W, H, icc)).toColourspace('srgb').png().toBuffer());
  await check('CMYK JPEG converts through its own profile', async () => {
    const jpg = path.join(OUT, 'press.jpg');
    await sharp(img.cmykTiff(ink4, W, H, icc)).pipelineColourspace('cmyk').toColourspace('cmyk').keepIccProfile().jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toFile(jpg);
    const m = await sharp(jpg).metadata();
    ok(m.space === 'cmyk' && m.icc.equals(icc), 'the sample is not a CMYK JPEG with the test profile');
    const ref = await means(await sharp(jpg).toColourspace('srgb').png().toBuffer()), out = [];
    ok(far(ref, builtin) > 20 && far(ref, naive) > 20, `the test profile is too close to the others: ${fmt(ref)} ${fmt(builtin)} ${fmt(naive)}`);
    for (const to of ['png', 'jpg', 'webp', 'tiff']) {
      const [o] = await run('convert-image', [jpg], { to, quality: 100 }, `cmyk-${to}`), om = await sharp(o).metadata(), got = await means(o);
      ok(om.space === 'srgb' && om.channels >= 3, `${to}: ${om.space} with ${om.channels} channels`);
      ok(far(got, ref) <= 2.5, `${to}: ${fmt(got)} against ${fmt(ref)} through the profile (built-in ${fmt(builtin)}, naive ${fmt(naive)})`);
      out.push(`${to} ${far(got, ref).toFixed(1)}`);
    }
    return `mean RGB off the profile's own conversion by ${out.join(', ')} (built-in profile would be ${far(builtin, ref).toFixed(0)}, naive ${far(naive, ref).toFixed(0)} off)`;
  });
  await check('CMYK PSD converts through its own profile', async () => {
    const res = Buffer.concat([Buffer.from('8BIM'), Buffer.from([0x04, 0x0f, 0, 0]), Buffer.alloc(4), icc, Buffer.alloc(icc.length % 2)]);
    res.writeUInt32BE(icc.length, 8);
    const head = Buffer.alloc(26); head.write('8BPS', 0); head.writeUInt16BE(1, 4); head.writeUInt16BE(4, 12); head.writeUInt32BE(H, 14); head.writeUInt32BE(W, 18); head.writeUInt16BE(8, 22); head.writeUInt16BE(4, 24);
    const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; }, planes = [0, 1, 2, 3].map((c) => Buffer.from(Array.from({ length: W * H }, (_, i) => 255 - ink4[i * 4 + c])));
    const psd = path.join(OUT, 'press.psd');
    fs.writeFileSync(psd, Buffer.concat([head, u32(0), u32(res.length), res, u32(0), Buffer.from([0, 0]), ...planes]));
    const d = path.join(OUT, 'cmyk-psd');
    fs.mkdirSync(d, { recursive: true });
    const o = await img.convert(psd, { to: 'png' }, { out: E('util').outputPlanner({ dest: { kind: 'dir', path: d } }), progress: () => {} }), got = await means(o.path || o);
    ok(far(got, reference) <= 2, `${fmt(got)} against ${fmt(reference)} through the profile (naive ${fmt(naive)})`);
    return `mean RGB ${fmt(got)}, ${far(got, reference).toFixed(1)} off the profile's conversion (naive would be ${far(naive, reference).toFixed(0)} off)`;
  });
  await check('Display P3 stays P3 where the format carries it', async () => {
    const p3 = path.join(OUT, 'wide.png');
    await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } }).composite([{ input: { create: { width: 20, height: H, channels: 3, background: '#ff2000' } }, left: 0, top: 0 }, { input: { create: { width: 20, height: H, channels: 3, background: '#00e040' } }, left: 20, top: 0 }, { input: { create: { width: 20, height: H, channels: 3, background: '#1040ff' } }, left: 40, top: 0 }]).png().toBuffer()
      .then((b) => sharp(b).withIccProfile('p3').png().toFile(p3));
    const src = await sharp(p3).metadata(), raw = await means(await sharp(p3).keepIccProfile().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => sharp(data, { raw: info }).png().toBuffer()));
    const srgb = await means(await sharp(p3).toColourspace('srgb').png().toBuffer()), out = [];
    ok(far(raw, srgb) > 10, `P3 and sRGB values are too close: ${fmt(raw)} ${fmt(srgb)}`);
    for (const to of ['png', 'jpg', 'webp', 'tiff', 'avif']) {
      const [o] = await run('convert-image', [p3], { to, quality: 100 }, `p3-${to}`), m = await sharp(o).metadata();
      ok(m.icc && m.icc.equals(src.icc), `${to} lost the P3 profile`);
      const shown = await means(await sharp(o).toColourspace('srgb').png().toBuffer());
      ok(far(shown, srgb) <= 3, `${to} shows ${fmt(shown)} instead of ${fmt(srgb)}`);
      out.push(to);
    }
    for (const to of ['gif', 'bmp']) {
      const [o] = await run('convert-image', [p3], { to }, `p3-${to}`), got = await means(await sharp(to === 'bmp' ? await E('image').open(o).then((x) => x.png().toBuffer()) : o).png().toBuffer());
      ok(far(got, srgb) <= 4, `${to}: ${fmt(got)} against ${fmt(srgb)} in sRGB (P3 numbers ${fmt(raw)})`);
      out.push(`${to} as sRGB`);
    }
    return `P3 kept in ${out.join(', ')}`;
  });

  const fromLime = (m) => require(require.resolve(m, { paths: [path.join(__dirname, '..', 'src', 'main')] }));
  const BOX = [0, 0, 0, 20, 0, 0, 20, 10, 0, 0, 10, 0, 0, 0, 5, 20, 0, 5, 20, 10, 5, 0, 10, 5].map((v, i) => v + [3, -4, 7][i % 3]);
  const TRIS = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const glb = (json, bin) => {
    const pad = (b, c) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, c)]), j = pad(Buffer.from(JSON.stringify(json)), 0x20), b = pad(bin, 0);
    const head = Buffer.alloc(12), ch = (t, d) => { const h = Buffer.alloc(8); h.writeUInt32LE(d.length); h.writeUInt32LE(t, 4); return Buffer.concat([h, d]); };
    head.writeUInt32LE(0x46546c67); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
    return Buffer.concat([head, ch(0x4e4f534a, j), ch(0x004e4942, b)]);
  };
  const scene = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }] };
  const posAcc = { componentType: 5126, count: 8, type: 'VEC3', min: [3, -4, 7], max: [23, 6, 12] };
  const modelBox = async (file, name) => {
    const [o] = await run('convert-model', [file], { to: 'stl' }, name), i = await E('cad').info(o), m = await E('cad').readMesh(o);
    const mn = [0, 1, 2].map((k) => Math.min(...m.pos.filter((_, j) => j % 3 === k))), mx = [0, 1, 2].map((k) => Math.max(...m.pos.filter((_, j) => j % 3 === k)));
    return { triangles: i.triangles, size: mx.map((v, k) => v - mn[k]) };
  };
  const plainGlb = path.join(OUT, 'box.glb');
  fs.writeFileSync(plainGlb, glb({ ...scene, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], buffers: [{ byteLength: 96 + 72 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 96 }, { buffer: 0, byteOffset: 96, byteLength: 72 }], accessors: [{ ...posAcc, bufferView: 0 }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }] }, Buffer.concat([Buffer.from(new Float32Array(BOX).buffer), Buffer.from(new Uint16Array(TRIS).buffer)])));
  await check('Draco-compressed GLB opens', async () => {
    const D = await fromLime('draco3dgltf').createEncoderModule({}), enc = new D.Encoder(), mb = new D.MeshBuilder(), mesh = new D.Mesh(), out = new D.DracoInt8Array();
    mb.AddFacesToMesh(mesh, 12, new Uint32Array(TRIS));
    const id = mb.AddFloatAttributeToMesh(mesh, D.POSITION, 8, 3, new Float32Array(BOX));
    enc.SetAttributeQuantization(D.POSITION, 14);
    const len = enc.EncodeMeshToDracoBuffer(mesh, out), data = Buffer.from(Int8Array.from({ length: len }, (_, i) => out.GetValue(i)).buffer);
    D.destroy(out); D.destroy(mesh); D.destroy(mb); D.destroy(enc);
    const file = path.join(OUT, 'box-draco.glb');
    fs.writeFileSync(file, glb({ ...scene, extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: id } } } }] }], buffers: [{ byteLength: data.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: data.length }], accessors: [posAcc, { componentType: 5123, count: 36, type: 'SCALAR' }] }, data));
    const a = await modelBox(file, 'draco'), b = await modelBox(plainGlb, 'plain-glb');
    ok(a.triangles === 12, `${a.triangles} triangles`);
    ok(far(a.size, b.size) <= Math.max(...b.size) / (1 << 14), `size ${fmt(a.size)} against ${fmt(b.size)}, more than 14-bit quantisation explains`);
    return `${fs.statSync(file).size} bytes: 12 triangles, ${fmt(a.size)} mm against ${fmt(b.size)} uncompressed (within 14-bit quantisation)`;
  });
  await check('meshopt-compressed GLB opens', async () => {
    const { MeshoptEncoder: M } = await import(require('url').pathToFileURL(path.join(path.dirname(require.resolve('meshoptimizer', { paths: [path.join(__dirname, '..', 'src', 'main')] })), 'meshopt_encoder.js')).href);
    await M.ready;
    const v = Buffer.from(M.encodeGltfBuffer(new Uint8Array(new Float32Array(BOX).buffer), 8, 12, 'ATTRIBUTES')), ix = Buffer.from(M.encodeGltfBuffer(new Uint8Array(new Uint32Array(TRIS).buffer), 36, 4, 'TRIANGLES'));
    const vb = Buffer.concat([v, Buffer.alloc((4 - (v.length % 4)) % 4)]), data = Buffer.concat([vb, ix]);
    const file = path.join(OUT, 'box-meshopt.glb');
    fs.writeFileSync(file, glb({ ...scene, extensionsUsed: ['EXT_meshopt_compression'], extensionsRequired: ['EXT_meshopt_compression'], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      buffers: [{ byteLength: data.length }, { byteLength: 96 + 144, extensions: { EXT_meshopt_compression: { fallback: true } } }],
      bufferViews: [{ buffer: 1, byteOffset: 0, byteLength: 96, byteStride: 12, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: v.length, byteStride: 12, count: 8, mode: 'ATTRIBUTES' } } }, { buffer: 1, byteOffset: 96, byteLength: 144, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: vb.length, byteLength: ix.length, byteStride: 4, count: 36, mode: 'TRIANGLES' } } }],
      accessors: [{ ...posAcc, bufferView: 0 }, { bufferView: 1, componentType: 5125, count: 36, type: 'SCALAR' }] }, data));
    const a = await modelBox(file, 'meshopt'), b = await modelBox(plainGlb, 'plain-glb-2');
    ok(a.triangles === 12 && far(a.size, b.size) < 1e-4, `${a.triangles} triangles, size ${fmt(a.size)} against ${fmt(b.size)}`);
    return `${fs.statSync(file).size} bytes: 12 triangles, ${a.size.join(' × ')} mm, the same as uncompressed`;
  });

  const U = E('util'), ff = (args) => U.run(U.binPath('ffmpeg'), ['-hide_banner', '-nostats', ...args]);
  const lufs = async (f) => { const { stderr } = await ff(['-i', f, '-af', 'ebur128=peak=true', '-f', 'null', '-']), sum = stderr.slice(stderr.lastIndexOf('Summary:')); return { I: Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)[1]), peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum)?.[1]) }; };
  const level = async (f, ss) => Number(/mean_volume: (-?[\d.]+) dB/.exec((await ff(['-ss', String(ss), '-t', '1.5', '-i', f, '-af', 'volumedetect', '-f', 'null', '-'])).stderr)[1]);
  await check('loudness levelling is two-pass and keeps the dynamics', async () => {
    const src = path.join(OUT, 'quiet-loud.wav');
    await ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3:sample_rate=48000', '-filter_complex', '[0]volume=-32dB[a];[1]volume=-24dB[b];[a][b]concat=n=2:v=0:a=1', src]);
    const [o] = await run('normalize-audio', [src], {}, 'loudness'), one = path.join(OUT, 'one-pass.wav');
    await ff(['-y', '-i', src, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_rates=48000', one]);
    const got = await lufs(o), gap = (await level(o, 4)) - (await level(o, 1)), srcGap = (await level(src, 4)) - (await level(src, 1)), oneGap = (await level(one, 4)) - (await level(one, 1)), oneI = (await lufs(one)).I;
    near(got.I, -16, 0.5, 'integrated loudness');
    ok(got.peak <= -1, `peak ${got.peak} dBFS`);
    near(gap, srcGap, 0.3, 'quiet-to-loud step');
    return `−16 LUFS target: got ${got.I} LUFS, peak ${got.peak} dBFS, quiet-to-loud step ${gap.toFixed(1)} dB (source ${srcGap.toFixed(1)}); one pass gave ${oneI} LUFS and a ${oneGap.toFixed(1)} dB step`;
  });

  await check('subtitle timings keep their milliseconds', async () => {
    const want = [[1001, 2999], [63457, 65008], [3723004, 3724996]], ms = (t) => { const [h, m, x] = t.split(':'), [sec, f] = x.split(/[,.]/); return ((+h * 60 + +m) * 60 + +sec) * 1000 + +f; };
    const times = (f) => [...fs.readFileSync(f, 'utf8').matchAll(/(\d+:\d\d:\d\d[,.]\d{3}) --> (\d+:\d\d:\d\d[,.]\d{3})/g)].map((m) => [ms(m[1]), ms(m[2])]);
    const srt = path.join(OUT, 'timing.srt');
    fs.writeFileSync(srt, want.map(([a, b], i) => `${i + 1}\n${new Date(a).toISOString().slice(11, 23).replace('.', ',')} --> ${new Date(b).toISOString().slice(11, 23).replace('.', ',')}\nLine ${i + 1}\n`).join('\n'));
    for (const to of ['vtt', 'ttml', 'smi']) {
      const [mid] = await run('convert-subtitles', [srt], { to }, `subs-${to}`), [back] = await run('convert-subtitles', [mid], { to: 'srt' }, `subs-${to}-srt`);
      same(times(back), want, `SRT → ${to} → SRT`);
    }
    const ttml = path.join(OUT, 'frames.ttml');
    fs.writeFileSync(ttml, '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25" ttp:tickRate="10000000"><body><div><p begin="00:00:01:05" end="00:00:02.040">a</p><p begin="34567890t" end="4.321s">b</p></div></body></tt>');
    const [o] = await run('convert-subtitles', [ttml], { to: 'srt' }, 'subs-ttml-frames');
    same(times(o), [[1200, 2040], [3457, 4321]], 'TTML frames and ticks');
    return 'SRT through VTT, TTML and SAMI comes back to the millisecond; TTML frames (25 fps) and ticks become exact milliseconds';
  });

  return results;
};
