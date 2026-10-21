'use strict';
const { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFRawStream, PDFNumber, PDFDict, PDFArray } = require('pdf-lib');
require('regenerator-runtime/runtime');
const fontkit = require('@pdf-lib/fontkit');
const zlib = require('zlib');
const U = require('./util');
const { fs, fsp, path } = U;

let _mupdf;
async function mupdf() {
  if (!_mupdf) _mupdf = await import('mupdf');
  return _mupdf;
}

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

async function loadLib(p, password) {
  const bytes = await fsp.readFile(p);
  try {
    const d = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    return d;
  } catch (_) {
    const { doc } = await readPdf(p, password);
    const clean = Buffer.from(doc.saveToBuffer('garbage=compact,encrypt=none').asUint8Array());
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

const FONT_FILES = {
  sans: 'NotoSans-Regular.ttf', 'sans-bold': 'NotoSans-Bold.ttf', 'sans-italic': 'NotoSans-Italic.ttf', 'sans-bolditalic': 'NotoSans-BoldItalic.ttf',
  serif: 'NotoSerif-Regular.ttf', 'serif-bold': 'NotoSerif-Bold.ttf', mono: 'NotoSansMono-Regular.ttf',
  caveat: 'Caveat.ttf', dancing: 'DancingScript.ttf', arabic: 'NotoSansArabic-Regular.ttf', devanagari: 'NotoSansDevanagari-Regular.ttf', thai: 'NotoSansThai-Regular.ttf',
  carlito: 'Carlito-Regular.ttf', 'carlito-bold': 'Carlito-Bold.ttf', 'carlito-italic': 'Carlito-Italic.ttf', 'carlito-bolditalic': 'Carlito-BoldItalic.ttf',
};
const STD = {
  sans: StandardFonts.Helvetica, 'sans-bold': StandardFonts.HelveticaBold, 'sans-italic': StandardFonts.HelveticaOblique, 'sans-bolditalic': StandardFonts.HelveticaBoldOblique,
  serif: StandardFonts.TimesRoman, 'serif-bold': StandardFonts.TimesRomanBold, 'serif-italic': StandardFonts.TimesRomanItalic, 'serif-bolditalic': StandardFonts.TimesRomanBoldItalic,
  mono: StandardFonts.Courier, 'mono-bold': StandardFonts.CourierBold, 'mono-italic': StandardFonts.CourierOblique, 'mono-bolditalic': StandardFonts.CourierBoldOblique,
  helvetica: StandardFonts.Helvetica, 'helvetica-bold': StandardFonts.HelveticaBold, 'helvetica-italic': StandardFonts.HelveticaOblique, 'helvetica-bolditalic': StandardFonts.HelveticaBoldOblique,
  times: StandardFonts.TimesRoman, 'times-bold': StandardFonts.TimesRomanBold, 'times-italic': StandardFonts.TimesRomanItalic, 'times-bolditalic': StandardFonts.TimesRomanBoldItalic,
  courier: StandardFonts.Courier, 'courier-bold': StandardFonts.CourierBold, 'courier-italic': StandardFonts.CourierOblique, 'courier-bolditalic': StandardFonts.CourierBoldOblique,
};
const WINANSI = /^[\x20-\x7e\u00a0-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178\n\r\t]*$/;

function ttcFace(buf, i) {
  if (buf.readUInt32BE(0) !== 0x74746366) return buf;
  const at = buf.readUInt32BE(12 + 4 * Math.min(i, buf.readUInt32BE(8) - 1)), n = buf.readUInt16BE(at + 4);
  const head = Buffer.from(buf.subarray(at, at + 12 + 16 * n)), parts = [head];
  let off = head.length;
  for (let t = 0; t < n; t++) {
    const r = 12 + 16 * t, src = head.readUInt32BE(r + 8), len = head.readUInt32BE(r + 12), pad = (4 - (len % 4)) % 4;
    head.writeUInt32BE(off, r + 8);
    parts.push(buf.subarray(src, src + len), Buffer.alloc(pad));
    off += len + pad;
  }
  return Buffer.concat(parts);
}
function fontCache(doc) {
  const cache = new Map();
  let fkReady = false;
  return async function get(key, text = '') {
    const needsUnicode = !WINANSI.test(text);
    const k = key.startsWith('file:') ? key : STD[key] && !needsUnicode && !FONT_FILES[key]?.match(/caveat|dancing/i) ? `std:${key}` : `ttf:${key}`;
    if (cache.has(k)) return cache.get(k);
    let font;
    if (k.startsWith('std:')) font = await doc.embedFont(STD[key]);
    else {
      if (!fkReady) { doc.registerFontkit(fontkit); fkReady = true; }
      const file = key.startsWith('file:') ? key.slice(5) : path.join(U.cfg.data, 'fonts', FONT_FILES[key] || FONT_FILES[key.split('-')[0]] || FONT_FILES.sans);
      const face = /^(.*\.ttc)#(\d+)$/i.exec(file), bytes = face ? ttcFace(await fsp.readFile(face[1]), +face[2]) : await fsp.readFile(file);
      const subset = /[\\/]Noto[^\\/]*$/.test(file) || bytes.length > 3e6;
      font = await doc.embedFont(bytes, { subset }).catch(() => doc.embedFont(bytes));
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
  else if (opts.mode === 'select') groups = U.parseRanges(opts.pages || '1', n).map((i) => [i]);
  else groups = [...Array(n).keys()].map((i) => [i]);
  if ((opts.mode === 'ranges' && opts.mergeRanges) || (opts.mode === 'select' && opts.mergeSelected !== false)) {
    const out = ctx.out.file(input, `${U.base(input)} - extract.pdf`);
    return [await subset(input, groups.flat(), out)];
  }
  const folder = ctx.out.folder(input, `${U.base(input)} - split`);
  const outs = [];
  for (let g = 0; g < groups.length; g++) {
    const idx = groups[g];
    const pagesLabel = idx.length === 1 ? `page ${idx[0] + 1}` : `pages ${idx[0] + 1}-${idx[idx.length - 1] + 1}`;
    const label = groups.every((x) => x.length === 1) ? pagesLabel : `part ${g + 1} (${pagesLabel})`;
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
const PAPER_PT = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55], a5: [419.53, 595.28] };
async function handouts(input, o, out) {
  const src = await loadLib(input), idx = U.parseRanges(o.slides || 'all', src.getPageCount());
  if (!idx.length) throw new Error('None of those slides exist.');
  if (!o.layout || o.layout === 'slides') return subset(input, idx, out);
  const n = Number(o.layout), land = o.orientation === 'landscape', [W, H] = land ? [...PAPER_PT[o.paper]].reverse() : PAPER_PT[o.paper];
  const [cols, rows] = n === 3 ? [1, 3] : ({ 2: [1, 2], 4: [2, 2], 6: [2, 3], 9: [3, 3] }[n] || [2, 3]).map((x, i, a) => (land ? a[1 - i] : x));
  const m = 40, gap = 20, cw = (W - 2 * m - gap * (cols - 1)) / cols, ch = (H - 2 * m - gap * (rows - 1)) / rows;
  const doc = await PDFDocument.create(), pages = await doc.embedPdf(src, idx), grey = rgb(0.62, 0.64, 0.6);
  for (let k = 0; k < pages.length; k += n) {
    const page = doc.addPage([W, H]);
    pages.slice(k, k + n).forEach((e, j) => {
      const c = j % cols, r = Math.floor(j / cols), bw = n === 3 ? cw * 0.5 : cw, s = Math.min(bw / e.width, ch / e.height), w = e.width * s, h = e.height * s;
      const x = m + c * (cw + gap) + (n === 3 ? 0 : (cw - w) / 2), y = H - m - r * (ch + gap) - (ch + h) / 2;
      page.drawPage(e, { x, y, width: w, height: h });
      if (o.frame !== false) page.drawRectangle({ x, y, width: w, height: h, borderColor: grey, borderWidth: 0.75 });
      if (n === 3) for (let l = 1; l <= 6; l++) page.drawLine({ start: { x: x + w + gap, y: y + h - (l * h) / 7 }, end: { x: W - m, y: y + h - (l * h) / 7 }, thickness: 0.5, color: grey });
    });
  }
  return saveLib(doc, out);
}
async function embedShown(doc, src, idx) {
  const pages = idx.map((i) => src.getPage(i));
  const es = await doc.embedPages(pages, pages.map((p) => { const b = p.getCropBox(); return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }; }));
  return es.map((e, k) => {
    const rot = (((pages[k].getRotation().angle || 0) % 360) + 360) % 360, turned = rot % 180 !== 0;
    return { e, rot, w: turned ? e.height : e.width, h: turned ? e.width : e.height };
  });
}
function place(page, { e, rot, w: ew, h: eh }, x, y, w, h, mode = 'fit') {
  const s = mode === 'actual' ? 1 : (mode === 'fill' ? Math.max : Math.min)(w / ew, h / eh), dw = ew * s, dh = eh * s, px = x + (w - dw) / 2, py = y + (h - dh) / 2;
  const [ax, ay] = { 0: [px, py], 90: [px, py + dh], 180: [px + dw, py + dh], 270: [px + dw, py] }[rot];
  page.drawPage(e, { x: ax, y: ay, xScale: s, yScale: s, rotate: degrees(-rot) });
  return { x: px, y: py, width: dw, height: dh };
}
const MM = 2.834645669;
const sheetSize = (o, first) => {
  if (o.paper === 'custom') return [Math.max(20, Number(o.width) || 210) * MM, Math.max(20, Number(o.height) || 297) * MM];
  return PAPER_PT[o.paper] || [Math.min(first.w, first.h), Math.max(first.w, first.h)];
};
const UP = { 2: [1, 2], 4: [2, 2], 6: [2, 3], 8: [2, 4], 9: [3, 3], 16: [4, 4] };
async function pagesPerSheet(input, o, out) {
  const src = await loadLib(input, o.password), idx = U.parseRanges(o.pages || 'all', src.getPageCount());
  if (!idx.length) throw new Error('None of those pages exist.');
  const doc = await PDFDocument.create(), list = await embedShown(doc, src, idx), n = Number(o.n) || 2;
  const m = (Number(o.margin) || 0) * MM, gap = o.gap == null ? m / 2 : (Number(o.gap) || 0) * MM, [pw, ph] = sheetSize(o, list[0]);
  const layout = (land) => {
    const [W, H] = land ? [ph, pw] : [pw, ph], [cols, rows] = land ? [...UP[n] || UP[2]].reverse() : UP[n] || UP[2];
    const cw = (W - 2 * m - gap * (cols - 1)) / cols, ch = (H - 2 * m - gap * (rows - 1)) / rows;
    return { W, H, cols, rows, cw, ch, s: Math.min(cw / list[0].w, ch / list[0].h) };
  };
  const L = o.orientation === 'portrait' ? layout(false) : o.orientation === 'landscape' ? layout(true) : [layout(false), layout(true)].sort((a, b) => b.s - a.s)[0];
  if (L.cw < 10 || L.ch < 10) throw new Error('The margins leave no room for the pages. Make them smaller.');
  const line = rgb(0.55, 0.57, 0.53);
  for (let k = 0; k < list.length; k += n) {
    const page = doc.addPage([L.W, L.H]);
    list.slice(k, k + n).forEach((p, j) => {
      const [c, r] = o.order === 'down' ? [Math.floor(j / L.rows), j % L.rows] : [j % L.cols, Math.floor(j / L.cols)];
      const box = place(page, p, m + c * (L.cw + gap), L.H - m - (r + 1) * L.ch - r * gap, L.cw, L.ch);
      if (o.border) page.drawRectangle({ ...box, borderColor: line, borderWidth: 0.6 });
    });
  }
  return saveLib(doc, out);
}
async function pageSize(input, o, out) {
  const src = await loadLib(input, o.password), doc = await PDFDocument.create();
  const list = await embedShown(doc, src, [...Array(src.getPageCount()).keys()]), m = (Number(o.margin) || 0) * MM;
  const [pw, ph] = sheetSize({ ...o, paper: o.paper || 'a4' }, list[0]);
  for (const p of list) {
    const land = o.orientation === 'landscape' || (o.orientation !== 'portrait' && p.w > p.h), [W, H] = land ? [Math.max(pw, ph), Math.min(pw, ph)] : [Math.min(pw, ph), Math.max(pw, ph)];
    if (W - 2 * m < 20 || H - 2 * m < 20) throw new Error('Those margins are larger than the page.');
    place(doc.addPage([W, H]), p, m, m, W - 2 * m, H - 2 * m, o.scale || 'fit');
  }
  return saveLib(doc, out);
}
async function overlay(input, o, out) {
  if (!o.overlay) throw new Error('Choose the PDF to lay over the pages.');
  const doc = await loadLib(input, o.password), top = await loadLib(o.overlay), pages = doc.getPages();
  const want = new Set(U.parseRanges(o.pages || 'all', pages.length)), each = o.repeat === 'each';
  const list = await embedShown(doc, top, each ? [...Array(Math.min(top.getPageCount(), pages.length)).keys()] : [0]);
  pages.forEach((page, i) => {
    const p = each ? list[i] : list[0];
    if (!p || !want.has(i)) return;
    const b = page.getCropBox(), turn = (((page.getRotation().angle || 0) % 360) + 360) % 360, rot = (p.rot - turn + 360) % 360;
    place(page, { ...p, rot, ...(rot % 180 !== p.rot % 180 ? { w: p.h, h: p.w } : {}) }, b.x, b.y, b.width, b.height, o.scale || 'fit');
    if (o.position === 'under') {
      const arr = page.node.Contents();
      if (arr instanceof PDFArray && arr.size() > 1) { const last = arr.get(arr.size() - 1); arr.remove(arr.size() - 1); arr.insert(0, last); }
    }
  });
  return saveLib(doc, out);
}
async function grayscale(input, o, out, ctx) {
  const { doc, m } = await readPdf(input, o.password), G = m.ColorSpace.DeviceGray, buf = new m.Buffer(), writer = new m.DocumentWriter(buf, 'pdf', 'compress');
  const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b, images = new Map();
  const grey = (cs, c) => {
    if (!cs || !c?.length) return c;
    if (cs.isGray()) return [c[0]];
    if (cs.isRGB()) return [luma(c[0], c[1], c[2])];
    if (cs.isCMYK()) { const k = 1 - c[3]; return [luma((1 - c[0]) * k, (1 - c[1]) * k, (1 - c[2]) * k)]; }
    if (cs.isLab()) return [c[0] / 100];
    return [cs.isSubtractive() ? 1 - Math.max(...c) : c.reduce((a, v) => a + v, 0) / c.length];
  };
  const greyImage = (img) => {
    if (img.getImageMask() || img.getNumberOfComponents() === 1) return img;
    const key = img.pointer;
    if (!images.has(key)) images.set(key, new m.Image(img.toPixmap().convertToColorSpace(G, true), img.getMask() || undefined));
    return images.get(key);
  };
  const n = doc.countPages();
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i), area = page.getBounds(), dev = writer.beginPage(area);
    const cs = (c) => (c ? G : c);
    page.run(new m.Device({
      fillPath: (p, eo, t, c, col, a) => dev.fillPath(p, eo, t, G, grey(c, col), a),
      strokePath: (p, s, t, c, col, a) => dev.strokePath(p, s, t, G, grey(c, col), a),
      clipPath: (p, eo, t) => dev.clipPath(p, eo, t),
      clipStrokePath: (p, s, t) => dev.clipStrokePath(p, s, t),
      fillText: (x, t, c, col, a) => dev.fillText(x, t, G, grey(c, col), a),
      strokeText: (x, s, t, c, col, a) => dev.strokeText(x, s, t, G, grey(c, col), a),
      clipText: (x, t) => dev.clipText(x, t),
      clipStrokeText: (x, s, t) => dev.clipStrokeText(x, s, t),
      ignoreText: (x, t) => dev.ignoreText(x, t),
      fillShade: (sh, t, a) => {
        const r = m.Rect.transform(sh.getBounds(), t), x0 = Math.max(r[0], area[0]), y0 = Math.max(r[1], area[1]), x1 = Math.min(r[2], area[2]), y1 = Math.min(r[3], area[3]);
        if (!(x1 > x0 && y1 > y0)) return;
        const k = 150 / 72, w = Math.ceil((x1 - x0) * k), h = Math.ceil((y1 - y0) * k), pix = new m.Pixmap(G, [0, 0, w, h], true);
        pix.clear(0);
        const draw = new m.DrawDevice(m.Matrix.concat(m.Matrix.translate(-x0, -y0), m.Matrix.scale(k, k)), pix);
        draw.fillShade(sh, t, 1);
        draw.close();
        dev.fillImage(new m.Image(pix), [x1 - x0, 0, 0, y1 - y0, x0, y0], a);
      },
      fillImage: (img, t, a) => dev.fillImage(greyImage(img), t, a),
      fillImageMask: (img, t, c, col, a) => dev.fillImageMask(img, t, G, grey(c, col), a),
      clipImageMask: (img, t) => dev.clipImageMask(img, t),
      popClip: () => dev.popClip(),
      beginMask: (r, lum, c, col) => dev.beginMask(r, lum, cs(c), grey(c, col)),
      endMask: () => dev.endMask(),
      beginGroup: (r, c, iso, ko, bm, a) => dev.beginGroup(r, cs(c), iso, ko, bm, a),
      endGroup: () => dev.endGroup(),
      beginTile: (r, v, xs, ys, t, id, d) => dev.beginTile(r, v, xs, ys, t, id, d),
      endTile: () => dev.endTile(),
      beginLayer: (name) => dev.beginLayer(name),
      endLayer: () => dev.endLayer(),
    }), m.Matrix.identity);
    writer.endPage();
    ctx?.progress((i + 1) / n, `Page ${i + 1} of ${n}`);
  }
  writer.close();
  await fsp.writeFile(out, Buffer.from(buf.asUint8Array()));
  return out;
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
async function printerMarks(input, o, out) {
  const { pushGraphicsState, popGraphicsState, rectangle, clip, endPath, cmyk } = require('pdf-lib');
  const doc = await loadLib(input, o.password);
  const bleed = Math.max(0, Number(o.bleed ?? 3)) * MM, len = Math.max(2, Number(o.length ?? 6)) * MM, gap = Math.max(bleed, Math.max(0, Number(o.offset ?? 3)) * MM), margin = gap + len + 6;
  const reg = cmyk(1, 1, 1, 1), thin = Number(o.weight) || 0.25;
  for (const page of doc.getPages()) {
    const t = page.getTrimBox(), b = { x: t.x - bleed, y: t.y - bleed, width: t.width + 2 * bleed, height: t.height + 2 * bleed };
    const stream = (...ops) => doc.context.register(doc.context.contentStream(ops));
    page.node.normalize();
    page.node.wrapContentStreams(stream(pushGraphicsState(), rectangle(b.x, b.y, b.width, b.height), clip(), endPath()), stream(popGraphicsState()));
    const sheet = [t.x - margin, t.y - margin, t.width + 2 * margin, t.height + 2 * margin];
    page.setMediaBox(...sheet);
    page.setCropBox(...sheet);
    page.setBleedBox(b.x, b.y, b.width, b.height);
    page.setTrimBox(t.x, t.y, t.width, t.height);
    for (const [x, y, sx, sy] of [[t.x, t.y, -1, -1], [t.x + t.width, t.y, 1, -1], [t.x, t.y + t.height, -1, 1], [t.x + t.width, t.y + t.height, 1, 1]]) {
      page.drawLine({ start: { x: x + sx * gap, y }, end: { x: x + sx * (gap + len), y }, thickness: thin, color: reg });
      page.drawLine({ start: { x, y: y + sy * gap }, end: { x, y: y + sy * (gap + len) }, thickness: thin, color: reg });
    }
  }
  await saveLib(doc, out);
  return { path: out, note: `${doc.getPageCount()} page${doc.getPageCount() === 1 ? '' : 's'}, ${Number(o.bleed ?? 3)} mm bleed` };
}
async function bookmarksFromHeadings(input, o, out) {
  const { doc, m } = await readPdf(input, o.password);
  const lines = [];
  for (let i = 0; i < doc.countPages(); i++) for (const l of extractLines(m, doc.loadPage(i))) lines.push({ ...l, page: i, chars: undefined });
  if (!lines.length) throw new Error('This PDF has no text to find headings in. Run Searchable PDF on it first.');
  const weight = new Map();
  for (const l of lines) weight.set(Math.round(l.size * 2) / 2, (weight.get(Math.round(l.size * 2) / 2) || 0) + l.text.length);
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const heads = lines.filter((l) => { const t = l.text.trim(); return t.length > 1 && t.length <= 90 && /\p{L}/u.test(t) && !/[.:;,]$/.test(t) && (l.size >= body * 1.18 || (l.bold && l.size >= body * 0.98 && t.length <= 60 && !/^\d+$/.test(t))); });
  if (!heads.length) throw new Error('No headings were found: nothing is set larger or bolder than the body text.');
  const sizes = [...new Set(heads.map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a).slice(0, 3);
  const level = (l) => Math.max(0, sizes.findIndex((s) => Math.round(l.size * 2) / 2 >= s));
  const items = [];
  for (const l of heads) {
    const prev = items[items.length - 1];
    if (prev && prev.page === l.page && prev.level === level(l) && l.bbox[1] - prev.bottom < l.size * 0.6) { prev.title += ` ${l.text.trim()}`; prev.bottom = l.bbox[3]; continue; }
    items.push({ title: l.text.trim(), page: l.page, level: level(l), bottom: l.bbox[3] });
  }
  const it = doc.outlineIterator();
  if (o.replace !== false) for (let k = 0; it.item() && k < 100000; k++) it.delete();
  else while (it.next() === 0);
  const uri = (p) => doc.formatLinkURI({ chapter: 0, page: p, type: 'Fit', x: 0, y: 0, width: 0, height: 0, zoom: 0 });
  let depth = 0;
  for (const b of items) {
    while (depth < b.level && it.prev() === 0) { it.down(); depth++; }
    while (depth > b.level) { it.up(); it.next(); depth--; }
    it.insert({ title: b.title.slice(0, 120), uri: uri(b.page), open: true });
  }
  await fsp.writeFile(out, Buffer.from(doc.saveToBuffer('garbage=compact').asUint8Array()));
  return { path: out, note: `${items.length} bookmark${items.length === 1 ? '' : 's'}: ${items.slice(0, 3).map((b) => b.title.slice(0, 30)).join(', ')}${items.length > 3 ? '…' : ''}` };
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

async function repair(input, out) {
  const { doc } = await readPdf(input);
  await fsp.writeFile(out, Buffer.from(doc.saveToBuffer('garbage=deduplicate,compress=yes,clean=yes').asUint8Array()));
  return out;
}
async function flatten(input, out) {
  const { doc } = await readPdf(input);
  doc.bake(true, true);
  await fsp.writeFile(out, Buffer.from(doc.saveToBuffer('garbage=deduplicate,compress=yes').asUint8Array()));
  return out;
}
function encryption(opts) {
  let p = -1;
  const clear = (bit) => { p &= ~(1 << (bit - 1)); };
  if (opts.allowPrint === false) { clear(3); clear(12); }
  if (opts.allowCopy === false) { clear(5); clear(10); }
  if (opts.allowEdit === false) { clear(4); clear(6); clear(9); clear(11); }
  const owner = opts.ownerPassword || require('crypto').randomBytes(16).toString('hex');
  const esc = (s) => String(s).replace(/,/g, '');
  return `encrypt=aes-256,user-password=${esc(opts.userPassword || '')},owner-password=${esc(owner)},permissions=${p | 0}`;
}
async function protect(input, opts, out) {
  if (!opts.userPassword && !opts.ownerPassword) throw new Error('Enter a password to protect this PDF.');
  const { doc } = await readPdf(input, opts.currentPassword);
  await fsp.writeFile(out, Buffer.from(doc.saveToBuffer(`${encryption(opts)},garbage=compact`).asUint8Array()));
  return out;
}
async function unlock(input, opts, out) {
  const bytes = await fsp.readFile(input);
  const m = await mupdf();
  const doc = m.Document.openDocument(bytes, 'application/pdf');
  if (doc.needsPassword() && !doc.authenticatePassword(opts.password || '')) {
    throw new Error(opts.password ? 'That password is wrong. Check it and try again.' : 'This PDF needs its password to unlock.');
  }
  await fsp.writeFile(out, Buffer.from(doc.saveToBuffer('encrypt=none,garbage=compact').asUint8Array()));
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
  await fsp.writeFile(out, Buffer.from(doc.saveToBuffer('garbage=deduplicate,compress=yes,clean=yes').asUint8Array()));
  return { path: out, note: `Redacted ${hits} match${hits === 1 ? '' : 'es'}` };
}
const quadRect = (q) => [Math.min(q[0], q[4]), Math.min(q[1], q[3]), Math.max(q[2], q[6]), Math.max(q[5], q[7])];

async function toImages(input, opts, ctx) {
  const { doc, m } = await readPdf(input, opts.password);
  const n = doc.countPages();
  const idx = U.parseRanges(opts.pages || 'all', n);
  const dpi = Number(opts.dpi) || 150;
  const fmt = ['png', 'webp'].includes(opts.format) ? opts.format : 'jpg';
  const single = idx.length === 1;
  const folder = single ? null : ctx.out.folder(input, `${U.base(input)} - images`);
  const outs = [];
  for (let k = 0; k < idx.length; k++) {
    const page = doc.loadPage(idx[k]);
    const s = dpi / 72;
    const pix = page.toPixmap(m.Matrix.scale(s, s), m.ColorSpace.DeviceRGB, fmt !== 'jpg' && opts.transparent, true);
    const data = fmt === 'png' ? pix.asPNG() : fmt === 'webp' ? await require('sharp')(Buffer.from(pix.asPNG())).webp({ quality: Number(opts.quality) || 90 }).toBuffer() : pix.asJPEG(Number(opts.quality) || 90, false);
    const name = `${U.base(input)} - page ${idx[k] + 1}.${fmt}`;
    const p = single ? ctx.out.file(input, name) : U.uniquePath(path.join(folder, name));
    await fsp.writeFile(p, data);
    outs.push(p);
    ctx.progress((k + 1) / idx.length, `Page ${k + 1} of ${idx.length}`);
  }
  return single ? outs : [folder];
}
function rgbPages(doc, m, idx, dpi, ctx) {
  return idx.map((i, k) => {
    const pix = doc.loadPage(i).toPixmap(m.Matrix.scale(dpi / 72, dpi / 72), m.ColorSpace.DeviceRGB, false, true);
    const w = pix.getWidth(), h = pix.getHeight(), st = pix.getStride(), px = pix.getPixels(), rgb = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) rgb.set(px.subarray(y * st, y * st + w * 3), y * w * 3);
    ctx?.progress((k + 1) / idx.length, `Page ${k + 1} of ${idx.length}`);
    return { w, h, rgb, pix };
  });
}
function multiTiff(pages, dpi) {
  const out = [Buffer.from([0x49, 0x49, 42, 0, 0, 0, 0, 0])];
  let pos = 8, link = [out[0], 4];
  for (const { w, h, rgb } of pages) {
    const strip = zlib.deflateSync(rgb), pad = Buffer.alloc(strip.length & 1), extra = Buffer.alloc(22);
    [8, 8, 8].forEach((v, k) => extra.writeUInt16LE(v, k * 2));
    [dpi, 1, dpi, 1].forEach((v, k) => extra.writeUInt32LE(v, 6 + k * 4));
    const extraAt = pos + strip.length + pad.length, ifdAt = extraAt + extra.length;
    const E = [[256, 4, 1, w], [257, 4, 1, h], [258, 3, 3, extraAt], [259, 3, 1, 8], [262, 3, 1, 2], [273, 4, 1, pos], [277, 3, 1, 3], [278, 4, 1, h], [279, 4, 1, strip.length], [282, 5, 1, extraAt + 6], [283, 5, 1, extraAt + 14], [284, 3, 1, 1], [296, 3, 1, 2]];
    const ifd = Buffer.alloc(6 + E.length * 12);
    ifd.writeUInt16LE(E.length, 0);
    E.forEach(([tag, type, count, v], k) => { const o = 2 + k * 12; ifd.writeUInt16LE(tag, o); ifd.writeUInt16LE(type, o + 2); ifd.writeUInt32LE(count, o + 4); if (type === 3 && count === 1) ifd.writeUInt16LE(v, o + 8); else ifd.writeUInt32LE(v, o + 8); });
    link[0].writeUInt32LE(ifdAt, link[1]);
    link = [ifd, 2 + E.length * 12];
    out.push(strip, pad, extra, ifd);
    pos = ifdAt + ifd.length;
  }
  return Buffer.concat(out);
}
async function toTiff(input, opts, out, ctx) {
  const { doc, m } = await readPdf(input, opts.password);
  const dpi = U.clamp(Number(opts.dpi) || 300, 36, 1200);
  await fsp.writeFile(out, multiTiff(rgbPages(doc, m, U.parseRanges(opts.pages || 'all', doc.countPages()), dpi, ctx), dpi));
  return out;
}
async function toComic(input, opts, out, ctx) {
  const { doc, m } = await readPdf(input, opts.password);
  const idx = U.parseRanges(opts.pages || 'all', doc.countPages()), digits = Math.max(3, String(idx.length).length), files = {};
  rgbPages(doc, m, idx, U.clamp(Number(opts.dpi) || 150, 36, 600), ctx).forEach(({ pix }, k) => { files[`${String(k + 1).padStart(digits, '0')}.jpg`] = [Buffer.from(pix.asJPEG(Number(opts.quality) || 90, false)), { level: 0 }]; });
  await fsp.writeFile(out, require('fflate').zipSync(files));
  return out;
}
async function toMarkdown(input, opts, out, ctx) {
  const dir = await U.tmpDir('pdfmd');
  try {
    const docx = await toWord(input, opts, path.join(dir, `${U.base(input)}.docx`), { ...ctx, progress: (p, l) => ctx?.progress(p * 0.8, l) });
    return await require('./office').convertDocument(docx, { to: 'md' }, { ...ctx, out: { ...ctx.out, file: () => out } });
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
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

async function toWord(input, opts, out, ctx) {
  const { doc, m } = await readPdf(input, opts.password);
  const R = require('./pdfread');
  const layout = await R.readDocument(doc, m, ctx);
  await fsp.writeFile(out, await require('docx').Packer.toBuffer(R.wordDocument(layout)));
  ctx?.progress(1);
  return out;
}

async function toPowerPoint(input, opts, out, ctx) {
  const { doc, m } = await readPdf(input, opts.password);
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  const size = (b) => [b[2] - b[0], b[3] - b[1]];
  let [cx, cy] = size(doc.loadPage(0).getBounds()).map((v) => Math.max(1, v) * 12700);
  const shrink = Math.min(1, 51206400 / Math.max(cx, cy)), grow = Math.max(1, 914400 / (Math.min(cx, cy) * shrink));
  const [SW, SH] = [cx, cy].map((v) => Math.min(51206400, Math.max(914400, v * shrink * grow)) / 914400);
  pptx.defineLayout({ name: 'PDF', width: SW, height: SH });
  pptx.layout = 'PDF';
  const n = doc.countPages();
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const [w, h] = size(page.getBounds());
    const px = ((w / 72) * 150) * ((h / 72) * 150), dpi = px > 25e6 ? Math.floor(150 * Math.sqrt(25e6 / px)) : 150;
    const pix = page.toPixmap(m.Matrix.scale(dpi / 72, dpi / 72), m.ColorSpace.DeviceRGB, false, true);
    const k = Math.min(SW / (w / 72), SH / (h / 72)), iw = (w / 72) * k, ih = (h / 72) * k;
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addImage({ data: `data:image/jpeg;base64,${Buffer.from(pix.asJPEG(90, false)).toString('base64')}`, x: (SW - iw) / 2, y: (SH - ih) / 2, w: iw, h: ih, altText: `Page ${i + 1}` });
    if (opts.notes !== false) {
      const t = page.toStructuredText('preserve-whitespace').asText().trim();
      if (t) slide.addNotes(t);
    }
    ctx?.progress((i + 1) / n, `Slide ${i + 1} of ${n}`);
  }
  await fsp.writeFile(out, await pptx.write({ outputType: 'nodebuffer' }));
  return out;
}

async function toExcel(input, opts, out) {
  const { doc, m } = await readPdf(input, opts.password);
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const value = (t) => {
    const num = /^-?[$€£]?\(?[\d,]*\.?\d+\)?%?$/.test(t) ? Number(t.replace(/[$€£,%()]/g, '')) * (/^\(.*\)$/.test(t) ? -1 : 1) : NaN;
    return Number.isFinite(num) && t.replace(/[^\d]/g, '').length < 16 ? num : t;
  };
  let any = false;
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const tables = require('./pdfread').pageTables(m, page);
    const inTable = (q) => { const x = (q[0] + q[2]) / 2, y = (q[1] + q[5]) / 2; return tables.some((t) => x > t.box[0] && x < t.box[2] && y > t.box[1] && y < t.box[3]); };
    const segs = [];
    for (const l of extractLines(m, page)) {
      const chars = l.chars.filter((ch) => !inTable(ch.quad));
      let cur = null;
      for (let k = 0; k < chars.length; k++) {
        const ch = chars[k];
        const prev = chars[k - 1];
        const gap = prev ? ch.quad[0] - prev.quad[2] : 0;
        if (!cur || gap > Math.max(ch.size * 0.9, 4) || (ch.c === ' ' && chars[k + 1]?.c === ' ')) {
          if (cur && cur.text.trim()) segs.push(cur);
          cur = { text: '', x: ch.quad[0], y: l.origin[1], size: ch.size };
        }
        cur.text += ch.c;
      }
      if (cur && cur.text.trim()) segs.push(cur);
    }
    if (!segs.length && !tables.length) continue;
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
    const aoa = [], merges = [];
    for (const b of [...rows.map((r) => ({ y: r.y, row: r })), ...tables.map((t) => ({ y: t.box[1], table: t }))].sort((p, q) => p.y - q.y)) {
      if (b.table) {
        const top = aoa.length;
        for (let r = 0; r < b.table.rows; r++) aoa.push([]);
        for (const c of b.table.cells) {
          aoa[top + c.r][c.c] = value(c.text);
          if (c.rs > 1 || c.cs > 1) merges.push({ s: { r: top + c.r, c: c.c }, e: { r: top + c.r + c.rs - 1, c: c.c + c.cs - 1 } });
        }
        continue;
      }
      const arr = [];
      b.row.segs.sort((p, q) => p.x - q.x).forEach((s) => {
        let c = colOf(s.x);
        while (arr[c] !== undefined) c++;
        arr[c] = value(s.text.trim());
      });
      aoa.push(arr);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa.map((r) => Array.from(r, (v) => (v === undefined ? '' : v))));
    if (merges.length) ws['!merges'] = merges;
    ws['!cols'] = Array.from({ length: Math.max(starts.length, ...tables.map((t) => t.cols)) }, () => ({ wch: 16 }));
    XLSX.utils.book_append_sheet(wb, ws, `Page ${i + 1}`);
  }
  if (!any) throw new Error('No text found to build tables from. If this is a scan, run OCR PDF first.');
  XLSX.writeFile(wb, out, { bookType: U.ext(out) === 'csv' ? 'csv' : 'xlsx' });
  return out;
}

const N = (o) => o?.asNumber?.() ?? (typeof o?.numberValue === 'number' ? o.numberValue : null);
function contentOps(bytes, onOp) {
  const s = Buffer.from(bytes).toString('latin1'), stack = [];
  const ws = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (ws(c)) { i++; continue; }
    if (c === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(') { for (let d = 0; i < s.length; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) { i++; break; } } stack.push(null); continue; }
    if (c === '<' && s[i + 1] !== '<') { i = s.indexOf('>', i) + 1 || s.length; stack.push(null); continue; }
    if ('[]{}'.includes(c) || (c === '<' && s[i + 1] === '<') || (c === '>' && s[i + 1] === '>')) { i += c === '<' || c === '>' ? 2 : 1; continue; }
    let j = i + 1;
    while (j < s.length && !ws(s[j]) && !'()<>[]{}/%'.includes(s[j])) j++;
    const t = s.slice(i, j);
    i = j;
    if (c === '/') stack.push({ name: t.slice(1) });
    else if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) stack.push(Number(t));
    else {
      if (t === 'ID') { const m = /\sEI(?=[\s]|$)/g; m.lastIndex = i; i = m.exec(s) ? m.lastIndex : s.length; }
      onOp(t, stack);
      stack.length = 0;
    }
  }
}
function drawnSizes(doc) {
  const { decodePDFRawStream } = require('pdf-lib');
  const ctx = doc.context, uses = new Map(), look = (o) => (o ? ctx.lookup(o) : o);
  const bytes = (st) => { try { return st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getContents(); } catch (_) { return null; } };
  const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3]];
  const walk = (data, res, base, depth) => {
    if (!data || depth > 12) return;
    const xo = look(look(res)?.get?.(PDFName.of('XObject')));
    const gs = [base];
    contentOps(data, (op, a) => {
      const top = gs[gs.length - 1];
      if (op === 'q') gs.push(top);
      else if (op === 'Q') { if (gs.length > 1) gs.pop(); } else if (op === 'cm' && a.length >= 4) gs[gs.length - 1] = mul(a.slice(0, 4).map(Number), top);
      else if (op === 'Do' && a[0]?.name && xo?.get) {
        const ref = xo.get(PDFName.of(a[0].name)), st = look(ref);
        const kind = st?.dict?.get(PDFName.of('Subtype'))?.toString();
        if (kind === '/Image') { const k = ref.toString(), u = uses.get(k) || { w: 0, h: 0 }; uses.set(k, { w: Math.max(u.w, Math.hypot(top[0], top[1]) / 72), h: Math.max(u.h, Math.hypot(top[2], top[3]) / 72) }); }
        else if (kind === '/Form') { const fm = look(st.dict.get(PDFName.of('Matrix'))); const m = fm instanceof PDFArray ? fm.asArray().slice(0, 4).map((x) => N(x) ?? 0) : [1, 0, 0, 1]; walk(bytes(st), st.dict.get(PDFName.of('Resources')) || res, mul(m, top), depth + 1); }
      }
    });
  };
  let pw = 8.5, ph = 11;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    if (width * height > pw * ph * 5184) { pw = width / 72; ph = height / 72; }
    const c = look(page.node.get(PDFName.of('Contents')));
    const parts = c instanceof PDFArray ? c.asArray().map(look) : [c];
    walk(Buffer.concat(parts.filter(Boolean).map((p) => Buffer.from(bytes(p) || []))), page.node.Resources(), [1, 0, 0, 1], 0);
  }
  return { uses, fallback: (w, h) => { const dpi = Math.min(Math.max(w / pw, h / ph), Math.max(w / ph, h / pw)); return { w: w / dpi, h: h / dpi }; } };
}
function unpredict(raw, w, n) {
  const stride = w * n, rows = Math.floor(raw.length / (stride + 1)), out = Buffer.alloc(rows * stride);
  for (let y = 0; y < rows; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= n ? out[o + x - n] : 0, b = y ? out[o - stride + x] : 0, c = x >= n && y ? out[o - stride + x - n] : 0, v = raw[src + x];
      if (f === 0) out[o + x] = v; else if (f === 1) out[o + x] = v + a; else if (f === 2) out[o + x] = v + b; else if (f === 3) out[o + x] = v + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); out[o + x] = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); } else return null;
    }
  }
  return out;
}
function predict(px, w, n) {
  const stride = w * n, rows = px.length / stride, out = Buffer.alloc(rows * (stride + 1)), row = Buffer.alloc(stride);
  for (let y = 0; y < rows; y++) {
    let best = null, score = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const i = y * stride + x, a = x >= n ? px[i - n] : 0, b = y ? px[i - stride] : 0, c = x >= n && y ? px[i - stride - n] : 0;
        const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })();
        const v = (px[i] - pr) & 255;
        row[x] = v;
        sum += Math.min(v, 256 - v);
      }
      if (sum < score) { score = sum; best = [f, Buffer.from(row)]; }
    }
    out[y * (stride + 1)] = best[0];
    best[1].copy(out, y * (stride + 1) + 1);
  }
  return zlib.deflateSync(out, { level: 9 });
}
const fewColours = (px, n, limit) => {
  const seen = new Set();
  for (let i = 0; i < px.length; i += n) { seen.add(n === 1 ? px[i] : n === 3 ? (px[i] << 16) | (px[i + 1] << 8) | px[i + 2] : px.readUInt32BE(i)); if (seen.size > limit) return false; }
  return true;
};
function runLength(b) {
  const out = [];
  for (let i = 0; i < b.length;) { const n = b[i++]; if (n === 128) break; if (n < 128) { out.push(...b.subarray(i, i + n + 1)); i += n + 1; } else { out.push(...new Array(257 - n).fill(b[i++])); } }
  return Buffer.from(out);
}
async function compress(input, opts, out, ctx) {
  const sharp = require('sharp');
  const level = opts.level || 'recommended';
  const pre = { low: { dpi: 300, q: 85 }, recommended: { dpi: 150, q: 65 }, extreme: { dpi: 72, q: 55 } }[level] || { dpi: 150, q: 65 };
  const before = (await fsp.stat(input)).size;
  const doc = await loadLib(input, opts.password);
  const C = doc.context, look = (o) => (o ? C.lookup(o) : o), get = (d, k) => look(d.get(PDFName.of(k)));
  const { uses, fallback } = drawnSizes(doc);
  const objs = C.enumerateIndirectObjects();
  const masks = new Set();
  let done = 0, changed = 0;
  const channels = (cs) => {
    const name = cs instanceof PDFArray ? cs.get(0)?.toString() : cs?.toString();
    if (name === '/DeviceGray' || name === '/CalGray') return 1;
    if (name === '/DeviceRGB' || name === '/CalRGB') return 3;
    if (name === '/ICCBased') { const k = N(look(cs.get(1))?.dict?.get(PDFName.of('N'))); return k === 1 || k === 3 ? k : 0; }
    return 0;
  };
  const decode = async (obj, n, width, height) => {
    const d = obj.dict, filter = get(d, 'Filter'), parms = get(d, 'DecodeParms');
    const fs1 = filter instanceof PDFArray ? (filter.size() === 1 ? [filter.get(0).toString()] : null) : filter ? [filter.toString()] : [];
    if (!fs1 || N(get(d, 'BitsPerComponent')) !== 8 || get(d, 'Mask') instanceof PDFArray || d.get(PDFName.of('F'))) return null;
    const p = parms instanceof PDFArray ? look(parms.get(0)) : parms;
    if (fs1[0] === '/DCTDecode') {
      if (p?.get?.(PDFName.of('ColorTransform'))) return null;
      const meta = await sharp(Buffer.from(obj.contents)).metadata();
      if (meta.space === 'cmyk' || meta.width !== width || meta.height !== height || (meta.channels >= 3 ? 3 : 1) !== n) return null;
      return { px: await sharp(Buffer.from(obj.contents)).removeAlpha().toColourspace(n === 1 ? 'b-w' : 'srgb').raw().toBuffer(), jpeg: true };
    }
    let raw = fs1[0] === '/FlateDecode' ? zlib.inflateSync(Buffer.from(obj.contents)) : fs1[0] === '/RunLengthDecode' ? runLength(Buffer.from(obj.contents)) : fs1.length ? null : Buffer.from(obj.contents);
    if (!raw) return null;
    const pred = N(p?.get?.(PDFName.of('Predictor'))) || 1;
    if (pred >= 10) raw = unpredict(raw, width, n); else if (pred !== 1) return null;
    return raw && raw.length >= width * height * n ? { px: raw.subarray(0, width * height * n), jpeg: false } : null;
  };
  const replace = (ref, obj, data, nw, nh, n, flate) => {
    const nd = obj.dict.clone(C);
    nd.set(PDFName.of('Filter'), PDFName.of(flate ? 'FlateDecode' : 'DCTDecode'));
    if (flate) nd.set(PDFName.of('DecodeParms'), C.obj({ Predictor: 15, Colors: n, BitsPerComponent: 8, Columns: nw })); else nd.delete(PDFName.of('DecodeParms'));
    nd.set(PDFName.of('Width'), PDFNumber.of(nw));
    nd.set(PDFName.of('Height'), PDFNumber.of(nh));
    nd.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
    nd.set(PDFName.of('Length'), PDFNumber.of(data.length));
    C.assign(ref, PDFRawStream.of(nd, data));
  };
  for (const [ref, obj] of objs) {
    done++;
    if (done % 25 === 0) ctx?.progress(Math.min(0.8, done / objs.length), 'Recompressing images');
    if (!(obj instanceof PDFRawStream) || masks.has(ref.toString())) continue;
    const d = obj.dict;
    if (get(d, 'Subtype')?.toString() !== '/Image' || get(d, 'ImageMask')?.toString() === 'true') continue;
    const width = N(get(d, 'Width')) || 0, height = N(get(d, 'Height')) || 0, n = channels(get(d, 'ColorSpace'));
    if (!n || width * height < 40000 || width * height > 1e8) continue;
    try {
      const img = await decode(obj, n, width, height);
      if (!img) continue;
      const use = uses.get(ref.toString()) || fallback(width, height);
      const scale = Math.max((use.w * pre.dpi) / width, (use.h * pre.dpi) / height);
      const fit = (v) => (scale * 1.5 < 1 ? Math.min(v, Math.max(Math.min(8, v), Math.round(v * scale))) : v);
      const nw = fit(width), nh = fit(height), down = nw < width || nh < height;
      const graphic = !img.jpeg && fewColours(img.px, n, n === 1 ? 32 : 256);
      const px = down ? await sharp(img.px, { raw: { width, height, channels: n } }).resize(nw, nh, { fit: 'fill', kernel: graphic ? 'nearest' : 'lanczos3' }).raw().toBuffer() : img.px;
      const flate = graphic && fewColours(px, n, n === 1 ? 32 : 256);
      const data = flate ? predict(px, nw, n) : await sharp(px, { raw: { width: nw, height: nh, channels: n } }).toColourspace(n === 1 ? 'b-w' : 'srgb').jpeg({ quality: pre.q, mozjpeg: true, chromaSubsampling: level === 'low' ? '4:4:4' : '4:2:0' }).toBuffer();
      if (data.length >= (!down && img.jpeg ? Math.floor(obj.contents.length * 0.9) : obj.contents.length)) continue;
      replace(ref, obj, data, nw, nh, n, flate);
      changed++;
      const mref = d.get(PDFName.of('SMask')), mask = look(mref);
      if (down && mask instanceof PDFRawStream && !masks.has(mref.toString())) {
        masks.add(mref.toString());
        const mw = N(get(mask.dict, 'Width')) || 0, mh = N(get(mask.dict, 'Height')) || 0, m = mw && mh ? await decode(mask, 1, mw, mh) : null;
        if (m && !m.jpeg) {
          const sw = Math.max(1, Math.round((mw * nw) / width)), sh = Math.max(1, Math.round((mh * nh) / height));
          const mp = predict(await sharp(m.px, { raw: { width: mw, height: mh, channels: 1 } }).resize(sw, sh, { fit: 'fill' }).raw().toBuffer(), sw, 1);
          if (mp.length < mask.contents.length) replace(mref, mask, mp, sw, sh, 1, true);
        }
      }
    } catch (_) {}
  }
  const mid = await doc.save({ useObjectStreams: true });
  const m = await mupdf();
  const md = m.Document.openDocument(mid, 'application/pdf');
  const final = Buffer.from(md.saveToBuffer('garbage=deduplicate,compress=yes,compress-fonts=yes,compress-images=yes,compression-effort=100,objstms=yes').asUint8Array());
  const best = final.length < mid.length ? final : mid;
  if (best.length >= before) {
    await fsp.copyFile(input, out);
    return { path: out, note: 'This PDF is already as small as it can get without losing quality. Saved an unchanged copy.' };
  }
  await fsp.writeFile(out, best);
  const pct = Math.round((1 - best.length / before) * 100);
  return { path: out, note: `${U.fmtBytes(before)} → ${U.fmtBytes(best.length)} (${pct}% smaller${changed ? `, ${changed} image${changed === 1 ? '' : 's'} recompressed` : ''})` };
}

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

async function thumbnail(input, width = 240) {
  const { doc, m } = await readPdf(input);
  const page = doc.loadPage(0);
  const b = page.getBounds();
  const s = width / (b[2] - b[0]);
  return { png: Buffer.from(page.toPixmap(m.Matrix.scale(s, s), m.ColorSpace.DeviceRGB, false, true).asPNG()), pages: doc.countPages() };
}

module.exports = {
  mupdf, readPdf, loadLib, saveLib, unpredict, pageCount, pageFrame, fontCache, hex, extractLines, quadRect, STD, FONT_FILES,
  merge, subset, split, removePages, extract, handouts, pagesPerSheet, pageSize, overlay, grayscale, reorder, rotate, crop, pageNumbers, watermark, metadata, readMetadata, printerMarks, bookmarksFromHeadings,
  repair, flatten, protect, encryption, unlock, redact, toImages, toTiff, toComic, toMarkdown, extractImages, toText, toHtml, toWord, toPowerPoint, toExcel,
  compress, ocr, imagesToPdf, thumbnail,
};
