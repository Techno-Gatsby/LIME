'use strict';
const { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFRawStream, PDFNumber, PDFDict, PDFArray } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const zlib = require('zlib');
const U = require('./util');
const { fs, fsp, path } = U;

let _mupdf;
async function mupdf() {
  if (!_mupdf) _mupdf = await import('mupdf');
  return _mupdf;
}

/* ---------- loading ---------- */
async function readPdf(p, password) {
  const bytes = await fsp.readFile(p);
  const m = await mupdf();
  const doc = m.Document.openDocument(bytes, 'application/pdf');
  if (doc.needsPassword()) {
    if (!password || !doc.authenticatePassword(password)) {
      const e = new Error(`${path.basename(p)} is password-protected. Use Unlock PDF first, or enter its password in the options.`);
      e.code = 'PASSWORD';
      throw e;
    }
  }
  return { bytes, doc, m };
}
/** pdf-lib loader that tolerates damaged or encrypted-without-password files by letting MuPDF rewrite them. */
async function loadLib(p, password) {
  const bytes = await fsp.readFile(p);
  try {
    const d = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    return d;
  } catch (_) {
    const { doc } = await readPdf(p, password);
    const clean = doc.saveToBuffer('garbage=compact,encrypt=none').asUint8Array();
    return PDFDocument.load(clean, { updateMetadata: false });
  }
}
async function saveLib(doc, out) {
  const bytes = await doc.save({ useObjectStreams: true });
  await fsp.writeFile(out, bytes);
  return out;
}
async function pageCount(p, password) {
  const { doc } = await readPdf(p, password);
  return doc.countPages();
}

/* ---------- geometry: display space (top-left origin, rotation applied) → PDF user space ---------- */
function pageFrame(page) {
  const r = (((page.getRotation().angle || 0) % 360) + 360) % 360;
  const b = page.getCropBox();
  const dw = r % 180 ? b.height : b.width;
  const dh = r % 180 ? b.width : b.height;
  const map = (u, v) => {
    switch (r) {
      case 90: return [b.x + v, b.y + u];
      case 180: return [b.x + b.width - u, b.y + v];
      case 270: return [b.x + b.width - v, b.y + b.height - u];
      default: return [b.x + u, b.y + b.height - v];
    }
  };
  return { r, dw, dh, map };
}

/* ---------- fonts ---------- */
const FONT_FILES = {
  sans: 'NotoSans-Regular.ttf', 'sans-bold': 'NotoSans-Bold.ttf', 'sans-italic': 'NotoSans-Italic.ttf', 'sans-bolditalic': 'NotoSans-BoldItalic.ttf',
  serif: 'NotoSerif-Regular.ttf', 'serif-bold': 'NotoSerif-Bold.ttf', mono: 'NotoSansMono-Regular.ttf',
  caveat: 'Caveat.ttf', dancing: 'DancingScript.ttf',
};
const STD = {
  sans: StandardFonts.Helvetica, 'sans-bold': StandardFonts.HelveticaBold, 'sans-italic': StandardFonts.HelveticaOblique, 'sans-bolditalic': StandardFonts.HelveticaBoldOblique,
  serif: StandardFonts.TimesRoman, 'serif-bold': StandardFonts.TimesRomanBold, 'serif-italic': StandardFonts.TimesRomanItalic, 'serif-bolditalic': StandardFonts.TimesRomanBoldItalic,
  mono: StandardFonts.Courier, 'mono-bold': StandardFonts.CourierBold, 'mono-italic': StandardFonts.CourierOblique, 'mono-bolditalic': StandardFonts.CourierBoldOblique,
};
const WINANSI = /^[\x20-\x7e\u00a0-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178\n\r\t]*$/;
/** Font cache per pdf-lib document. Uses the 14 standard fonts when text fits WinAnsi, else embeds Noto (subset). */
function fontCache(doc) {
  const cache = new Map();
  let fkReady = false;
  return async function get(key, text = '') {
    const needsUnicode = !WINANSI.test(text);
    const k = STD[key] && !needsUnicode && !FONT_FILES[key]?.match(/caveat|dancing/i) ? `std:${key}` : `ttf:${key}`;
    if (cache.has(k)) return cache.get(k);
    let font;
    if (k.startsWith('std:')) font = await doc.embedFont(STD[key]);
    else {
      if (!fkReady) { doc.registerFontkit(fontkit); fkReady = true; }
      const file = FONT_FILES[key] || FONT_FILES[key.split('-')[0]] || FONT_FILES.sans;
      font = await doc.embedFont(await fsp.readFile(path.join(U.cfg.data, 'fonts', file)), { subset: true });
    }
    cache.set(k, font);
    return font;
  };
}
const hex = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/* ---------- structured text (shared with the editor) ---------- */
function extractLines(m, page) {
  const lines = [];
  let cur = null;
  page.toStructuredText('preserve-whitespace,preserve-spans').walk({
    beginLine(bbox, wmode, dir) { cur = { chars: [], dir: [dir[0], dir[1]], wmode }; },
    onChar(c, origin, font, size, quad, color) {
      if (!cur) return;
      cur.chars.push({ c, x: origin[0], y: origin[1], size, quad, font: font.getName(), bold: font.isBold(), italic: font.isItalic(), mono: font.isMono(), serif: font.isSerif(), color });
    },
    endLine() {
      if (cur && cur.chars.length) lines.push(finishLine(cur));
      cur = null;
    },
  });
  return lines.filter((l) => l.text.trim());
}
function finishLine(l) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ch of l.chars) {
    const q = ch.quad;
    for (let i = 0; i < 8; i += 2) { x0 = Math.min(x0, q[i]); x1 = Math.max(x1, q[i]); y0 = Math.min(y0, q[i + 1]); y1 = Math.max(y1, q[i + 1]); }
  }
  const sizes = l.chars.map((c) => c.size).sort((a, b) => a - b);
  const first = l.chars[0];
  const col = first.color || [0];
  const toHex = (v) => Math.round(U.clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  const color = col.length >= 3 ? `#${toHex(col[0])}${toHex(col[1])}${toHex(col[2])}` : `#${toHex(col[0]).repeat(3)}`;
  return {
    text: l.chars.map((c) => c.c).join(''),
    bbox: [x0, y0, x1, y1], origin: [first.x, first.y], dir: l.dir,
    size: sizes[Math.floor(sizes.length / 2)], font: first.font,
    bold: l.chars.filter((c) => c.bold).length > l.chars.length / 2 || /bold|black|heavy|semibold/i.test(first.font),
    italic: first.italic || /italic|oblique/i.test(first.font), mono: first.mono, serif: first.serif, color,
    chars: l.chars,
  };
}

/* ---------- core operations ---------- */
async function merge(inputs, out, ctx) {
  const dst = await PDFDocument.create();
  for (let i = 0; i < inputs.length; i++) {
    const src = await loadLib(inputs[i]);
    const pages = await dst.copyPages(src, src.getPageIndices());
    pages.forEach((p) => dst.addPage(p));
    ctx?.progress((i + 1) / inputs.length, `Merged ${i + 1} of ${inputs.length}`);
  }
  return saveLib(dst, out);
}
async function subset(input, indices, out) {
  const src = await loadLib(input);
  const dst = await PDFDocument.create();
  const pages = await dst.copyPages(src, indices);
  pages.forEach((p) => dst.addPage(p));
  return saveLib(dst, out);
}
async function split(input, opts, ctx) {
  const src = await loadLib(input);
  const n = src.getPageCount();
  let groups;
  if (opts.mode === 'every') {
    const k = Math.max(1, parseInt(opts.every, 10) || 1);
    groups = [];
    for (let i = 0; i < n; i += k) groups.push([...Array(Math.min(k, n - i)).keys()].map((j) => i + j));
  } else if (opts.mode === 'ranges') groups = U.parseRangeGroups(opts.ranges || '1', n);
  else groups = [...Array(n).keys()].map((i) => [i]);
  if (opts.mode === 'ranges' && opts.mergeRanges) {
    const out = ctx.out.file(input, `${U.base(input)} - pages ${String(opts.ranges).replace(/\s+/g, '')}.pdf`);
    return [await subset(input, groups.flat(), out)];
  }
  const folder = ctx.out.folder(input, `${U.base(input)} - split`);
  const outs = [];
  for (let g = 0; g < groups.length; g++) {
    const idx = groups[g];
    const label = idx.length === 1 ? `page ${idx[0] + 1}` : `pages ${idx[0] + 1}-${idx[idx.length - 1] + 1}`;
    const dst = await PDFDocument.create();
    (await dst.copyPages(src, idx)).forEach((p) => dst.addPage(p));
    outs.push(await saveLib(dst, U.uniquePath(path.join(folder, `${U.base(input)} - ${label}.pdf`))));
    ctx.progress((g + 1) / groups.length);
  }
  return [folder];
}
async function removePages(input, spec, out) {
  const src = await loadLib(input);
  const n = src.getPageCount();
  const drop = new Set(U.parseRanges(spec, n));
  if (drop.size >= n) throw new Error('That would remove every page. Leave at least one page.');
  return subset(input, [...Array(n).keys()].filter((i) => !drop.has(i)), out);
}
async function extract(input, spec, out) {
  const n = await pageCount(input);
  return subset(input, U.parseRanges(spec, n), out);
}
async function reorder(input, orderSpec, out) {
  const n = await pageCount(input);
  const order = U.parseRanges(orderSpec, n);
  return subset(input, order, out);
}
async function rotate(input, opts, out) {
  const doc = await loadLib(input);
  const idx = new Set(U.parseRanges(opts.pages || 'all', doc.getPageCount()));
  doc.getPages().forEach((p, i) => {
    if (idx.has(i)) p.setRotation(degrees((((p.getRotation().angle || 0) + Number(opts.angle || 90)) % 360 + 360) % 360));
  });
  return saveLib(doc, out);
}
async function crop(input, opts, out) {
  const doc = await loadLib(input);
  const mm = (v) => (Number(v) || 0) * 2.834645669;
  const t = mm(opts.top), r = mm(opts.right), b = mm(opts.bottom), l = mm(opts.left);
  const idx = new Set(U.parseRanges(opts.pages || 'all', doc.getPageCount()));
  doc.getPages().forEach((p, i) => {
    if (!idx.has(i)) return;
    const box = p.getCropBox();
    // margins are given as the reader sees the page; translate for rotation
    const rot = (((p.getRotation().angle || 0) % 360) + 360) % 360;
    const [mt, mr, mb, ml] = rot === 90 ? [l, t, r, b] : rot === 180 ? [b, l, t, r] : rot === 270 ? [r, b, l, t] : [t, r, b, l];
    const w = box.width - ml - mr, h = box.height - mt - mb;
    if (w < 20 || h < 20) throw new Error('Those margins are larger than the page.');
    p.setCropBox(box.x + ml, box.y + mb, w, h);
  });
  return saveLib(doc, out);
}
async function pageNumbers(input, opts, out) {
  const doc = await loadLib(input);
  const fonts = fontCache(doc);
  const pages = doc.getPages();
  const idx = new Set(U.parseRanges(opts.pages || 'all', pages.length));
  const start = parseInt(opts.start, 10) || 1;
  const size = Number(opts.size) || 11;
  const margin = (Number(opts.margin) || 10) * 2.834645669;
  const total = pages.length;
  const color = hex(opts.color || '#333333');
  let k = 0;
  for (let i = 0; i < pages.length; i++) {
    if (!idx.has(i)) continue;
    const page = pages[i];
    const n = start + k++;
    const text = String(opts.format || '{n}').replace(/\{n\}/g, n).replace(/\{total\}/g, total + start - 1).replace(/\{p\}/g, i + 1);
    const font = await fonts(opts.bold ? 'sans-bold' : 'sans', text);
    const w = font.widthOfTextAtSize(text, size);
    const f = pageFrame(page);
    const pos = opts.position || 'bottom-center';
    const vert = pos.startsWith('top') ? margin + size : f.dh - margin;
    let hz = pos.endsWith('left') ? margin : pos.endsWith('right') ? f.dw - margin - w : (f.dw - w) / 2;
    if (opts.mirror && pos.endsWith('right') && (n % 2 === 0)) hz = margin;
    const [x, y] = f.map(hz, vert);
    page.drawText(text, { x, y, size, font, color, rotate: degrees(f.r) });
  }
  return saveLib(doc, out);
}
async function watermark(input, opts, out) {
  const doc = await loadLib(input);
  const fonts = fontCache(doc);
  const pages = doc.getPages();
  const idx = new Set(U.parseRanges(opts.pages || 'all', pages.length));
  const opacity = U.clamp(Number(opts.opacity ?? 30) / 100, 0.02, 1);
  const angle = Number(opts.rotation ?? 45);
  let img = null;
  if (opts.kind === 'image' && opts.image) {
    const bytes = await require('./image').toPngOrJpeg(opts.image);
    img = bytes.type === 'jpg' ? await doc.embedJpg(bytes.data) : await doc.embedPng(bytes.data);
  }
  const text = String(opts.text || 'CONFIDENTIAL');
  const font = img ? null : await fonts(opts.bold === false ? 'sans' : 'sans-bold', text);
  const color = hex(opts.color || '#d13438');
  for (let i = 0; i < pages.length; i++) {
    if (!idx.has(i)) continue;
    const page = pages[i];
    const f = pageFrame(page);
    const placements = [];
    const tiled = opts.layout === 'tiled';
    let w, h;
    if (img) {
      const s = (Number(opts.scale) || 40) / 100 * Math.min(f.dw, f.dh) / Math.max(img.width, img.height);
      w = img.width * s; h = img.height * s;
    } else {
      const size = Number(opts.size) || Math.max(24, Math.min(f.dw, f.dh) / (tiled ? 12 : 7));
      w = font.widthOfTextAtSize(text, size); h = size;
      placements.size = size;
    }
    if (tiled) {
      const stepX = w + 80, stepY = h + 120;
      for (let v = stepY / 2; v < f.dh + stepY; v += stepY) for (let u = -w / 2 + ((v / stepY) % 2) * stepX / 2; u < f.dw + stepX; u += stepX) placements.push([u, v]);
    } else {
      const pos = opts.position || 'center';
      const pad = 36;
      const u = pos.includes('left') ? pad + w / 2 : pos.includes('right') ? f.dw - pad - w / 2 : f.dw / 2;
      const v = pos.includes('top') ? pad + h / 2 : pos.includes('bottom') ? f.dh - pad - h / 2 : f.dh / 2;
      placements.push([u, v]);
    }
    const a = (angle * Math.PI) / 180;
    for (const [cu, cv] of placements) {
      // anchor so the mark is centred on (cu, cv) in display space, rotated by `angle` counter-clockwise
      const du = -w / 2, dv = h / 2;
      const au = cu + du * Math.cos(a) + dv * Math.sin(a);
      const av = cv - du * Math.sin(a) + dv * Math.cos(a);
      const [x, y] = f.map(au, av);
      const rot = degrees(f.r + angle);
      if (img) page.drawImage(img, { x, y, width: w, height: h, rotate: rot, opacity });
      else page.drawText(text, { x, y, size: placements.size, font, color, opacity, rotate: rot });
    }
  }
  return saveLib(doc, out);
}
async function metadata(input, opts, out) {
  const doc = await loadLib(input);
  if (opts.title != null) doc.setTitle(String(opts.title));
  if (opts.author != null) doc.setAuthor(String(opts.author));
  if (opts.subject != null) doc.setSubject(String(opts.subject));
  if (opts.keywords != null) doc.setKeywords(String(opts.keywords).split(/[,;]\s*/).filter(Boolean));
  if (opts.clear) { doc.setProducer(''); doc.setCreator(''); }
  doc.setModificationDate(new Date());
  return saveLib(doc, out);
}
async function readMetadata(input) {
  const doc = await loadLib(input);
  return { title: doc.getTitle() || '', author: doc.getAuthor() || '', subject: doc.getSubject() || '', keywords: doc.getKeywords() || '', pages: doc.getPageCount() };
}

/* ---------- MuPDF-backed operations ---------- */
async function repair(input, out) {
  const { doc } = await readPdf(input);
  await fsp.writeFile(out, doc.saveToBuffer('garbage=deduplicate,compress=yes,clean=yes').asUint8Array());
  return out;
}
async function flatten(input, out) {
  const { doc } = await readPdf(input);
  doc.bake(true, true);
  await fsp.writeFile(out, doc.saveToBuffer('garbage=deduplicate,compress=yes').asUint8Array());
  return out;
}
async function protect(input, opts, out) {
  if (!opts.userPassword && !opts.ownerPassword) throw new Error('Enter a password to protect this PDF.');
  const { doc } = await readPdf(input, opts.currentPassword);
  // PDF permission bits: print 3, modify 4, copy 5, annotate 6, fill 9, extract 10, assemble 11, print-hq 12
  let p = -1;
  const clear = (bit) => { p &= ~(1 << (bit - 1)); };
  if (opts.allowPrint === false) { clear(3); clear(12); }
  if (opts.allowCopy === false) { clear(5); clear(10); }
  if (opts.allowEdit === false) { clear(4); clear(6); clear(9); clear(11); }
  const owner = opts.ownerPassword || opts.userPassword + '\u0001owner';
  const esc = (s) => String(s).replace(/,/g, '');
  const enc = `encrypt=aes-256,user-password=${esc(opts.userPassword || '')},owner-password=${esc(owner)},permissions=${p | 0},garbage=compact`;
  await fsp.writeFile(out, doc.saveToBuffer(enc).asUint8Array());
  return out;
}
async function unlock(input, opts, out) {
  const bytes = await fsp.readFile(input);
  const m = await mupdf();
  const doc = m.Document.openDocument(bytes, 'application/pdf');
  if (doc.needsPassword() && !doc.authenticatePassword(opts.password || '')) {
    throw new Error(opts.password ? 'That password is wrong. Check it and try again.' : 'This PDF needs its password to unlock.');
  }
  await fsp.writeFile(out, doc.saveToBuffer('encrypt=none,garbage=compact').asUint8Array());
  return out;
}
async function redact(input, opts, out) {
  const terms = String(opts.terms || '').split(/\r?\n|,/).map((t) => t.trim()).filter(Boolean);
  const presets = { email: /[\w.+-]+@[\w-]+\.[\w.-]+/g, phone: /\+?\d[\d\s().-]{7,}\d/g, card: /\b(?:\d[ -]?){13,19}\b/g, ssn: /\b\d{3}-\d{2}-\d{4}\b/g, iban: /\b[A-Z]{2}\d{2}[A-Z0-9 ]{11,30}\b/g };
  const patterns = (opts.patterns || []).map((k) => presets[k]).filter(Boolean);
  if (!terms.length && !patterns.length) throw new Error('Enter words to redact, or pick a pattern such as emails or phone numbers.');
  const { doc, m } = await readPdf(input, opts.password);
  let hits = 0;
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const rects = [];
    for (const t of terms) for (const quads of page.search(t)) for (const q of quads) rects.push(quadRect(q));
    if (patterns.length) {
      const lines = extractLines(m, page);
      for (const line of lines) {
        for (const re of patterns) {
          re.lastIndex = 0;
          let mm;
          while ((mm = re.exec(line.text))) {
            const chars = line.chars.slice(mm.index, mm.index + mm[0].length);
            if (!chars.length) continue;
            rects.push(chars.map((c) => quadRect(c.quad)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]));
          }
        }
      }
    }
    for (const r of rects) { const a = page.createAnnotation('Redact'); a.setRect(r); hits++; }
    if (rects.length) page.applyRedactions(opts.boxes !== false, 2, 1, 0);
  }
  if (!hits) throw new Error('None of those words or patterns appear in this PDF, so nothing was redacted.');
  await fsp.writeFile(out, doc.saveToBuffer('garbage=deduplicate,compress=yes,clean=yes').asUint8Array());
  return { path: out, note: `Redacted ${hits} match${hits === 1 ? '' : 'es'}` };
}
const quadRect = (q) => [Math.min(q[0], q[4]), Math.min(q[1], q[3]), Math.max(q[2], q[6]), Math.max(q[5], q[7])];

async function toImages(input, opts, ctx) {
  const { doc, m } = await readPdf(input, opts.password);
  const n = doc.countPages();
  const idx = U.parseRanges(opts.pages || 'all', n);
  const dpi = Number(opts.dpi) || 150;
  const fmt = opts.format === 'png' ? 'png' : 'jpg';
  const single = idx.length === 1;
  const folder = single ? null : ctx.out.folder(input, `${U.base(input)} - images`);
  const outs = [];
  for (let k = 0; k < idx.length; k++) {
    const page = doc.loadPage(idx[k]);
    const s = dpi / 72;
    const pix = page.toPixmap(m.Matrix.scale(s, s), m.ColorSpace.DeviceRGB, fmt === 'png' && opts.transparent, true);
    const data = fmt === 'png' ? pix.asPNG() : pix.asJPEG(Number(opts.quality) || 90, false);
    const name = `${U.base(input)} - page ${idx[k] + 1}.${fmt}`;
    const p = single ? ctx.out.file(input, name) : U.uniquePath(path.join(folder, name));
    await fsp.writeFile(p, data);
    outs.push(p);
    ctx.progress((k + 1) / idx.length, `Page ${k + 1} of ${idx.length}`);
  }
  return single ? outs : [folder];
}
async function extractImages(input, opts, ctx) {
  const { doc, m } = await readPdf(input, opts.password);
  const folder = ctx.out.folder(input, `${U.base(input)} - embedded images`);
  let count = 0;
  const seen = new Set();
  const min = Number(opts.minSize) || 32;
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const imgs = [];
    page.toStructuredText('preserve-images').walk({ onImageBlock(bbox, transform, image) { imgs.push(image); } });
    for (const image of imgs) {
      const w = image.getWidth(), h = image.getHeight();
      if (w < min || h < min) continue;
      const pix = image.toPixmap();
      let data = pix.asPNG();
      const key = `${w}x${h}:${data.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let e = 'png';
      if (opts.format === 'jpg') {
        const sharp = require('sharp');
        data = await sharp(Buffer.from(data)).flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
        e = 'jpg';
      }
      await fsp.writeFile(path.join(folder, `page ${i + 1} - image ${++count}.${e}`), data);
    }
    ctx.progress((i + 1) / doc.countPages());
  }
  if (!count) { await fsp.rm(folder, { recursive: true, force: true }); throw new Error('This PDF has no embedded images. To save whole pages as pictures, use PDF to JPG.'); }
  return { path: folder, note: `Saved ${count} image${count === 1 ? '' : 's'}` };
}
async function toText(input, opts, out) {
  const { doc } = await readPdf(input, opts.password);
  const parts = [];
  for (let i = 0; i < doc.countPages(); i++) parts.push(doc.loadPage(i).toStructuredText('preserve-whitespace').asText().replace(/\s+$/, ''));
  const text = parts.join(opts.pageBreaks === false ? '\n\n' : '\n\n\f\n\n');
  if (!text.replace(/\f/g, '').trim()) throw new Error('No text found. This looks like a scanned PDF. Run OCR PDF first, then extract text.');
  await fsp.writeFile(out, `\ufeff${text}\n`, 'utf8');
  return out;
}
async function toHtml(input, opts, out) {
  const { doc } = await readPdf(input, opts.password);
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) pages.push(doc.loadPage(i).toStructuredText('preserve-images').asHTML(i));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${U.base(input)}</title><style>body{background:#eee;margin:0;padding:24px}div[id^=page]{background:#fff;margin:0 auto 24px;box-shadow:0 1px 4px rgba(0,0,0,.2);position:relative}</style></head><body>${pages.join('\n')}</body></html>`;
  await fsp.writeFile(out, html, 'utf8');
  return out;
}

/** PDF → editable Word document built from MuPDF's structured text (headings, bold/italic, images, page breaks). */
async function toWord(input, opts, out, ctx) {
  const { doc, m } = await readPdf(input, opts.password);
  const D = require('docx');
  const n = doc.countPages();
  const sizeVotes = new Map();
  const pagesData = [];
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const blocks = [];
    let block = null;
    let line = null;
    page.toStructuredText('preserve-images,preserve-whitespace').walk({
      onImageBlock(bbox, transform, image) {
        try {
          const png = image.toPixmap().asPNG();
          blocks.push({ type: 'image', png, w: bbox[2] - bbox[0], h: bbox[3] - bbox[1] });
        } catch (_) { /* unsupported image */ }
      },
      beginTextBlock(bbox) { block = { type: 'text', lines: [], bbox }; },
      beginLine() { line = { runs: [] }; },
      onChar(c, origin, font, size, quad, color) {
        const bold = font.isBold() || /bold|black|heavy/i.test(font.getName());
        const italic = font.isItalic() || /italic|oblique/i.test(font.getName());
        const last = line.runs[line.runs.length - 1];
        const col = color && color.length >= 3 ? color : [color?.[0] ?? 0, color?.[0] ?? 0, color?.[0] ?? 0];
        const hexc = col.slice(0, 3).map((v) => Math.round(U.clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
        if (last && last.bold === bold && last.italic === italic && Math.abs(last.size - size) < 0.5 && last.color === hexc) last.text += c;
        else line.runs.push({ text: c, bold, italic, size, color: hexc, serif: font.isSerif(), mono: font.isMono() });
        const r = Math.round(size);
        sizeVotes.set(r, (sizeVotes.get(r) || 0) + 1);
      },
      endLine() { if (line && line.runs.length) block.lines.push(line); line = null; },
      endTextBlock() { if (block && block.lines.length) blocks.push(block); block = null; },
    });
    const b = page.getBounds();
    pagesData.push({ blocks, w: b[2] - b[0], h: b[3] - b[1] });
    ctx?.progress((i + 1) / n * 0.7, `Reading page ${i + 1}`);
  }
  const body = [...sizeVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
  const children = [];
  pagesData.forEach((pg, pi) => {
    pg.blocks.forEach((bl) => {
      if (bl.type === 'image') {
        const maxW = (pg.w - 72) * (96 / 72);
        let w = bl.w * (96 / 72), h = bl.h * (96 / 72);
        if (w > maxW) { h *= maxW / w; w = maxW; }
        children.push(new D.Paragraph({ children: [new D.ImageRun({ type: 'png', data: Buffer.from(bl.png), transformation: { width: Math.round(w), height: Math.round(h) } })] }));
        return;
      }
      const runs = [];
      bl.lines.forEach((ln, li) => {
        ln.runs.forEach((r) => {
          runs.push(new D.TextRun({ text: r.text, bold: r.bold, italics: r.italic, size: Math.round(r.size * 2), color: r.color === '000000' ? undefined : r.color, font: r.mono ? 'Consolas' : r.serif ? 'Times New Roman' : 'Calibri' }));
        });
        const nextText = bl.lines[li + 1]?.runs[0]?.text || '';
        const thisText = ln.runs.map((r) => r.text).join('');
        if (li < bl.lines.length - 1) {
          // join wrapped lines with a space; keep hard breaks for short lines (lists, addresses)
          if (/[-\u00ad]$/.test(thisText)) { /* hyphenated: join directly */ } else if (thisText.trim().length < 45 || /^[•\-–\d]/.test(nextText.trim())) runs.push(new D.TextRun({ break: 1 }));
          else runs.push(new D.TextRun({ text: ' ' }));
        }
      });
      const maxSize = Math.max(...bl.lines.flatMap((l) => l.runs.map((r) => r.size)));
      const heading = maxSize >= body * 1.7 ? D.HeadingLevel.HEADING_1 : maxSize >= body * 1.3 ? D.HeadingLevel.HEADING_2 : undefined;
      children.push(new D.Paragraph({ children: runs, heading, spacing: { after: 120 } }));
    });
    if (pi < pagesData.length - 1) children.push(new D.Paragraph({ children: [new D.PageBreak()] }));
  });
  if (!children.length || !pagesData.some((p) => p.blocks.some((b) => b.type === 'text'))) {
    if (!pagesData.some((p) => p.blocks.length)) throw new Error('No text or images found. If this is a scan, run OCR PDF first.');
  }
  const first = pagesData[0] || { w: 595, h: 842 };
  const document = new D.Document({
    creator: 'Clementine',
    styles: { default: { document: { run: { font: 'Calibri', size: Math.round(body * 2) } } } },
    sections: [{ properties: { page: { size: { width: Math.round(first.w * 20), height: Math.round(first.h * 20) }, margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children }],
  });
  await fsp.writeFile(out, await D.Packer.toBuffer(document));
  ctx?.progress(1);
  return out;
}
/** PDF → PowerPoint: each page becomes a slide with a crisp page render, slide size matched to the page. */
async function toPowerPoint(input, opts, out, ctx) {
  const { doc, m } = await readPdf(input, opts.password);
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  const b0 = doc.loadPage(0).getBounds();
  const W = (b0[2] - b0[0]) / 72, H = (b0[3] - b0[1]) / 72;
  const scale = 10 / Math.max(W, H);
  pptx.defineLayout({ name: 'PDF', width: W * scale, height: H * scale });
  pptx.layout = 'PDF';
  const n = doc.countPages();
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const pix = page.toPixmap(m.Matrix.scale(2, 2), m.ColorSpace.DeviceRGB, false, true);
    const slide = pptx.addSlide();
    slide.addImage({ data: `data:image/png;base64,${Buffer.from(pix.asPNG()).toString('base64')}`, x: 0, y: 0, w: W * scale, h: H * scale });
    if (opts.notes !== false) {
      const t = page.toStructuredText('').asText().trim();
      if (t) slide.addNotes(t.slice(0, 5000));
    }
    ctx?.progress((i + 1) / n, `Slide ${i + 1} of ${n}`);
  }
  await fsp.writeFile(out, await pptx.write({ outputType: 'nodebuffer' }));
  return out;
}
/** PDF → Excel: rebuilds tables from text positions (rows by baseline, columns by x-alignment). */
async function toExcel(input, opts, out) {
  const { doc, m } = await readPdf(input, opts.password);
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  let any = false;
  for (let i = 0; i < doc.countPages(); i++) {
    const lines = extractLines(m, doc.loadPage(i));
    const segs = [];
    for (const l of lines) {
      let cur = null;
      for (let k = 0; k < l.chars.length; k++) {
        const ch = l.chars[k];
        const prev = l.chars[k - 1];
        const gap = prev ? ch.quad[0] - prev.quad[2] : 0;
        if (!cur || gap > Math.max(ch.size * 0.9, 4) || (ch.c === ' ' && l.chars[k + 1]?.c === ' ')) {
          if (cur && cur.text.trim()) segs.push(cur);
          cur = { text: '', x: ch.quad[0], y: l.origin[1], size: ch.size };
        }
        cur.text += ch.c;
      }
      if (cur && cur.text.trim()) segs.push(cur);
    }
    if (!segs.length) continue;
    any = true;
    segs.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const s of segs) {
      const row = rows.find((r) => Math.abs(r.y - s.y) < s.size * 0.5);
      if (row) row.segs.push(s); else rows.push({ y: s.y, segs: [s] });
    }
    const starts = [];
    segs.map((s) => s.x).sort((a, b) => a - b).forEach((x) => { if (!starts.length || x - starts[starts.length - 1] > 8) starts.push(x); });
    const colOf = (x) => { let best = 0; starts.forEach((s, j) => { if (Math.abs(s - x) < Math.abs(starts[best] - x)) best = j; }); return best; };
    const aoa = rows.map((r) => {
      const arr = [];
      r.segs.sort((a, b) => a.x - b.x).forEach((s) => {
        let c = colOf(s.x);
        while (arr[c] !== undefined) c++;
        const t = s.text.trim();
        const num = /^-?[$€£]?\(?[\d,]*\.?\d+\)?%?$/.test(t) ? Number(t.replace(/[$€£,%()]/g, '')) * (/^\(.*\)$/.test(t) ? -1 : 1) : NaN;
        arr[c] = Number.isFinite(num) && t.replace(/[^\d]/g, '').length < 16 ? num : t;
      });
      return Array.from(arr, (v) => (v === undefined ? '' : v));
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = starts.map(() => ({ wch: 16 }));
    XLSX.utils.book_append_sheet(wb, ws, `Page ${i + 1}`);
  }
  if (!any) throw new Error('No text found to build tables from. If this is a scan, run OCR PDF first.');
  XLSX.writeFile(wb, out, { bookType: U.ext(out) === 'csv' ? 'csv' : 'xlsx' });
  return out;
}

/** Re-encode embedded photos and rebuild the file with object streams. */
async function compress(input, opts, out, ctx) {
  const sharp = require('sharp');
  const level = opts.level || 'recommended';
  const presets = { low: { max: 3000, q: 85 }, recommended: { max: 2000, q: 72 }, extreme: { max: 1300, q: 52 } };
  const pre = presets[level] || presets.recommended;
  const before = (await fsp.stat(input)).size;
  const doc = await loadLib(input, opts.password);
  const objs = doc.context.enumerateIndirectObjects();
  let done = 0, changed = 0;
  for (const [ref, obj] of objs) {
    done++;
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
    if (dict.get(PDFName.of('ImageMask'))?.toString() === 'true') continue;
    const filter = dict.get(PDFName.of('Filter'));
    const fname = filter instanceof PDFArray ? (filter.size() === 1 ? filter.get(0).toString() : 'multi') : filter?.toString();
    const width = dict.get(PDFName.of('Width'))?.asNumber?.() || 0;
    const height = dict.get(PDFName.of('Height'))?.asNumber?.() || 0;
    const bpc = dict.get(PDFName.of('BitsPerComponent'))?.asNumber?.() || 8;
    if (width * height < 40000) continue;
    try {
      let input2;
      if (fname === '/DCTDecode') {
        input2 = sharp(Buffer.from(obj.contents));
        const meta = await input2.metadata();
        if (meta.channels === 4 || meta.space === 'cmyk') continue;
      } else if (fname === '/FlateDecode' && bpc === 8 && !dict.get(PDFName.of('DecodeParms'))) {
        const cs = dict.get(PDFName.of('ColorSpace'));
        let channels = 0;
        const csName = cs?.toString() || '';
        if (csName === '/DeviceRGB') channels = 3;
        else if (csName === '/DeviceGray') channels = 1;
        else if (cs instanceof PDFArray && cs.get(0)?.toString() === '/ICCBased') {
          const icc = doc.context.lookup(cs.get(1));
          channels = icc?.dict?.get(PDFName.of('N'))?.asNumber?.() || 0;
          if (channels !== 1 && channels !== 3) channels = 0;
        }
        if (!channels) continue;
        const raw = zlib.inflateSync(Buffer.from(obj.contents));
        if (raw.length !== width * height * channels) continue;
        input2 = sharp(raw, { raw: { width, height, channels } });
      } else continue;
      const scale = Math.min(1, pre.max / Math.max(width, height));
      const nw = Math.max(1, Math.round(width * scale)), nh = Math.max(1, Math.round(height * scale));
      const isGray = dict.get(PDFName.of('ColorSpace'))?.toString() === '/DeviceGray';
      let pipe = input2.resize(nw, nh, { fit: 'fill' });
      if (isGray) pipe = pipe.toColourspace('b-w');
      const jpg = await pipe.jpeg({ quality: pre.q, mozjpeg: true, chromaSubsampling: level === 'low' ? '4:4:4' : '4:2:0' }).toBuffer();
      if (jpg.length >= obj.contents.length * 0.92) continue;
      const nd = dict.clone(doc.context);
      nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      nd.delete(PDFName.of('DecodeParms'));
      nd.set(PDFName.of('Width'), PDFNumber.of(nw));
      nd.set(PDFName.of('Height'), PDFNumber.of(nh));
      nd.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      if (isGray) nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
      else if (fname !== '/DCTDecode' || (dict.get(PDFName.of('ColorSpace'))?.toString() !== '/DeviceRGB')) nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
      nd.set(PDFName.of('Length'), PDFNumber.of(jpg.length));
      doc.context.assign(ref, PDFRawStream.of(nd, jpg));
      changed++;
    } catch (_) { /* leave this image as it is */ }
    if (done % 25 === 0) ctx?.progress(Math.min(0.8, done / objs.length), 'Recompressing images');
  }
  const mid = await doc.save({ useObjectStreams: true });
  const m = await mupdf();
  const md = m.Document.openDocument(mid, 'application/pdf');
  const final = md.saveToBuffer('garbage=deduplicate,compress=yes,compress-fonts=yes,compress-images=yes,objstms=yes').asUint8Array();
  const best = final.length < mid.length ? final : mid;
  if (best.length >= before) {
    await fsp.copyFile(input, out);
    return { path: out, note: 'This PDF is already as small as it can get without losing quality. Saved an unchanged copy.' };
  }
  await fsp.writeFile(out, best);
  const pct = Math.round((1 - best.length / before) * 100);
  return { path: out, note: `${U.fmtBytes(before)} → ${U.fmtBytes(best.length)} (${pct}% smaller${changed ? `, ${changed} image${changed === 1 ? '' : 's'} recompressed` : ''})` };
}

/** Searchable PDF via Tesseract: each page is rendered at 300 dpi and rebuilt with an invisible text layer. */
async function ocr(input, opts, out, ctx) {
  const { doc, m } = await readPdf(input, opts.password);
  const ocrEngine = require('./ocr');
  const n = doc.countPages();
  const dst = await PDFDocument.create();
  const src = opts.skipText ? await loadLib(input, opts.password) : null;
  let recognised = 0;
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    if (src && page.toStructuredText('').asText().trim().length > 40) {
      const [p] = await dst.copyPages(src, [i]);
      dst.addPage(p);
    } else {
      const dpi = Number(opts.dpi) || 300;
      const pix = page.toPixmap(m.Matrix.scale(dpi / 72, dpi / 72), m.ColorSpace.DeviceRGB, false, true);
      const pdfBytes = await ocrEngine.imageToPdf(Buffer.from(pix.asPNG()), opts.lang || 'eng');
      const one = await PDFDocument.load(pdfBytes);
      const [p] = await dst.copyPages(one, [0]);
      // keep the original page size (Tesseract sizes the page from the image dpi)
      const b = page.getBounds();
      const w = b[2] - b[0], h = b[3] - b[1];
      const sz = p.getSize();
      p.scaleContent(w / sz.width, h / sz.height);
      p.setSize(w, h);
      dst.addPage(p);
      recognised++;
    }
    ctx?.progress((i + 1) / n, `Recognising page ${i + 1} of ${n}`);
  }
  await saveLib(dst, out);
  return { path: out, note: recognised ? `Recognised text on ${recognised} page${recognised === 1 ? '' : 's'}` : 'Every page already had text; nothing to recognise.' };
}

/** Images → PDF with page size, orientation and margin choices. */
async function imagesToPdf(inputs, opts, out, ctx) {
  const img = require('./image');
  const doc = await PDFDocument.create();
  const sizes = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55], a5: [419.53, 595.28] };
  const margin = { none: 0, small: 20, large: 50 }[opts.margin || 'none'] ?? 0;
  for (let i = 0; i < inputs.length; i++) {
    const { data, type } = await img.toPngOrJpeg(inputs[i]);
    const im = type === 'jpg' ? await doc.embedJpg(data) : await doc.embedPng(data);
    let pw, ph;
    if (!opts.pageSize || opts.pageSize === 'fit') {
      pw = im.width * 0.75 + margin * 2; ph = im.height * 0.75 + margin * 2;
    } else {
      [pw, ph] = sizes[opts.pageSize] || sizes.a4;
      const landscape = opts.orientation === 'landscape' || (opts.orientation !== 'portrait' && im.width > im.height);
      if (landscape) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const aw = pw - margin * 2, ah = ph - margin * 2;
    const s = Math.min(aw / im.width, ah / im.height);
    const w = im.width * s, h = im.height * s;
    page.drawImage(im, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    ctx?.progress((i + 1) / inputs.length);
  }
  return saveLib(doc, out);
}

/** Lightweight preview for the UI: first page thumbnail + page count. */
async function thumbnail(input, width = 240) {
  const { doc, m } = await readPdf(input);
  const page = doc.loadPage(0);
  const b = page.getBounds();
  const s = width / (b[2] - b[0]);
  return { png: Buffer.from(page.toPixmap(m.Matrix.scale(s, s), m.ColorSpace.DeviceRGB, false, true).asPNG()), pages: doc.countPages() };
}

module.exports = {
  mupdf, readPdf, loadLib, saveLib, pageCount, pageFrame, fontCache, hex, extractLines, quadRect, STD, FONT_FILES,
  merge, subset, split, removePages, extract, reorder, rotate, crop, pageNumbers, watermark, metadata, readMetadata,
  repair, flatten, protect, unlock, redact, toImages, extractImages, toText, toHtml, toWord, toPowerPoint, toExcel,
  compress, ocr, imagesToPdf, thumbnail,
};
