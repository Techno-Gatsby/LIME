'use strict';
// Acrobat-style editing. Existing text is removed with true MuPDF redaction (the glyphs are deleted from the
// content stream, not covered), then new content is drawn with pdf-lib in exact PDF coordinates.
const { PDFDocument, rgb, degrees, BlendMode, LineCapStyle } = require('pdf-lib');
const P = require('./engines/pdf');
const U = require('./engines/util');
const { fsp, path } = U;

const sessions = new Map();
let seq = 0;

async function loadState(s, bytes) {
  const m = await P.mupdf();
  s.bytes = bytes;
  s.doc = m.Document.openDocument(bytes, 'application/pdf');
  if (s.password && s.doc.needsPassword()) s.doc.authenticatePassword(s.password);
  s.textCache = new Map();
}
function info(s) {
  const pages = [];
  for (let i = 0; i < s.doc.countPages(); i++) {
    const b = s.doc.loadPage(i).getBounds();
    pages.push({ w: b[2] - b[0], h: b[3] - b[1] });
  }
  return { id: s.id, pages, path: s.path, name: path.basename(s.path), canUndo: s.undo.length > 0, canRedo: s.redo.length > 0, dirty: s.dirty };
}
async function open(file, password) {
  const bytes = new Uint8Array(await fsp.readFile(file));
  const m = await P.mupdf();
  const probe = m.Document.openDocument(bytes, 'application/pdf');
  if (probe.needsPassword()) {
    if (!password || !probe.authenticatePassword(password)) {
      const e = new Error(password ? 'That password is wrong.' : 'This PDF is password-protected.');
      e.code = 'PASSWORD';
      throw e;
    }
  }
  const s = { id: ++seq, path: file, password, undo: [], redo: [], dirty: false };
  // Work on a decrypted copy so pdf-lib can edit it; encryption can be re-applied with Protect PDF.
  const clean = probe.needsPassword() ? probe.saveToBuffer('encrypt=none').asUint8Array() : bytes;
  await loadState(s, clean);
  sessions.set(s.id, s);
  return info(s);
}
const get = (id) => { const s = sessions.get(id); if (!s) throw new Error('This document was closed.'); return s; };

async function render(id, index, scale) {
  const s = get(id);
  const m = await P.mupdf();
  const page = s.doc.loadPage(index);
  const pix = page.toPixmap(m.Matrix.scale(scale, scale), m.ColorSpace.DeviceRGB, false, true);
  return Buffer.from(pix.asPNG());
}
async function text(id, index) {
  const s = get(id);
  if (s.textCache.has(index)) return s.textCache.get(index);
  const m = await P.mupdf();
  const lines = P.extractLines(m, s.doc.loadPage(index)).map((l, i) => ({
    id: `${index}:${i}`, text: l.text.replace(/\s+$/, ''), bbox: l.bbox, origin: l.origin, size: l.size,
    bold: l.bold, italic: l.italic, serif: l.serif, mono: l.mono, color: l.color, font: l.font,
    editable: Math.abs(l.dir[0] - 1) < 0.01 && Math.abs(l.dir[1]) < 0.01,
  }));
  s.textCache.set(index, lines);
  return lines;
}
async function search(id, needle) {
  const s = get(id);
  const out = [];
  if (!needle) return out;
  for (let i = 0; i < s.doc.countPages(); i++) {
    for (const quads of s.doc.loadPage(i).search(needle)) out.push({ page: i, rects: quads.map(P.quadRect) });
  }
  return out;
}

function pushUndo(s) {
  s.undo.push(s.bytes);
  if (s.undo.length > 30) s.undo.shift();
  s.redo = [];
  s.dirty = true;
}
async function undo(id) { const s = get(id); if (!s.undo.length) return info(s); s.redo.push(s.bytes); await loadState(s, s.undo.pop()); s.dirty = true; return info(s); }
async function redo(id) { const s = get(id); if (!s.redo.length) return info(s); s.undo.push(s.bytes); await loadState(s, s.redo.pop()); s.dirty = true; return info(s); }

const fontKey = (e) => `${e.font === 'serif' ? 'serif' : e.font === 'mono' ? 'mono' : e.font === 'caveat' || e.font === 'dancing' ? e.font : 'sans'}${e.font === 'caveat' || e.font === 'dancing' ? '' : `${e.bold ? '-bold' : ''}${e.italic ? (e.bold ? 'italic' : '-italic') : ''}`}`;

/** Apply a batch of edits made in the editor (all coordinates are display-space points). */
async function apply(id, edits) {
  const s = get(id);
  if (!edits?.length) return info(s);
  const m = await P.mupdf();
  const byPage = new Map();
  for (const e of edits) { if (!byPage.has(e.page)) byPage.set(e.page, []); byPage.get(e.page).push(e); }

  // 1) true removal of text under replaced lines, deleted lines and whiteout areas
  const work = m.Document.openDocument(s.bytes, 'application/pdf');
  const transforms = new Map();
  for (const [pi, list] of byPage) {
    const page = work.loadPage(pi);
    transforms.set(pi, m.Matrix.invert(page.getTransform()));
    const rects = [];
    for (const e of list) {
      if (e.type === 'replace' || e.type === 'deleteText') rects.push(e.bbox);
      if (e.type === 'whiteout') rects.push([e.rect[0], e.rect[1], e.rect[0] + e.rect[2], e.rect[1] + e.rect[3]]);
    }
    if (rects.length) {
      for (const r of rects) { const a = page.createAnnotation('Redact'); a.setRect([r[0] - 0.3, r[1] - 0.3, r[2] + 0.3, r[3] + 0.3]); }
      // keep images and vector art; only remove the text that sits inside the rectangles
      page.applyRedactions(false, 0, 0, 0);
    }
  }
  const redacted = work.saveToBuffer('garbage=compact').asUint8Array();

  // 2) draw new content with pdf-lib
  const doc = await PDFDocument.load(redacted, { updateMetadata: false });
  const fonts = P.fontCache(doc);
  for (const [pi, list] of byPage) {
    const page = doc.getPage(pi);
    const inv = transforms.get(pi);
    const map = (u, v) => [u * inv[0] + v * inv[2] + inv[4], u * inv[1] + v * inv[3] + inv[5]];
    const angle = (Math.atan2(inv[1], inv[0]) * 180) / Math.PI;
    const rot = degrees(angle);
    for (const e of list) {
      const color = e.color ? P.hex(e.color) : rgb(0, 0, 0);
      const opacity = e.opacity == null ? 1 : U.clamp(Number(e.opacity), 0, 1);
      switch (e.type) {
        case 'replace': case 'text': {
          const str = String(e.text ?? '');
          if (!str.trim()) break;
          const font = await fonts(fontKey(e), str);
          const size = Number(e.size) || 12;
          const lh = size * (e.lineHeight || 1.2);
          str.split(/\r?\n/).forEach((ln, i) => {
            const [x, y] = map(e.x, e.y + i * lh);
            page.drawText(ln, { x, y, size, font, color, opacity, rotate: rot });
            if (e.underline) {
              const w = font.widthOfTextAtSize(ln, size);
              const [x1, y1] = map(e.x, e.y + i * lh + size * 0.12);
              const [x2, y2] = map(e.x + w, e.y + i * lh + size * 0.12);
              page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: size / 16, color, opacity });
            }
          });
          break;
        }
        case 'whiteout': {
          const [x, y, w, h] = e.rect;
          const [ax, ay] = map(x, y + h);
          page.drawRectangle({ x: ax, y: ay, width: w, height: h, color: e.fill ? P.hex(e.fill) : rgb(1, 1, 1), rotate: rot });
          break;
        }
        case 'highlight': {
          const [x, y, w, h] = e.rect;
          const [ax, ay] = map(x, y + h);
          page.drawRectangle({ x: ax, y: ay, width: w, height: h, color: P.hex(e.color || '#ffe14d'), opacity: e.opacity ?? 0.45, blendMode: BlendMode.Multiply, rotate: rot });
          break;
        }
        case 'rect': case 'ellipse': {
          const [x, y, w, h] = e.rect;
          const border = e.stroke ? P.hex(e.stroke) : undefined;
          const fill = e.fill && e.fill !== 'none' ? P.hex(e.fill) : undefined;
          if (e.type === 'rect') {
            const [ax, ay] = map(x, y + h);
            page.drawRectangle({ x: ax, y: ay, width: w, height: h, borderColor: border, borderWidth: border ? Number(e.width) || 2 : 0, color: fill, opacity, borderOpacity: opacity, rotate: rot });
          } else {
            const [cx, cy] = map(x + w / 2, y + h / 2);
            page.drawEllipse({ x: cx, y: cy, xScale: w / 2, yScale: h / 2, borderColor: border, borderWidth: border ? Number(e.width) || 2 : 0, color: fill, opacity, borderOpacity: opacity, rotate: rot });
          }
          break;
        }
        case 'line': case 'arrow': {
          const [x1, y1] = map(e.x1, e.y1), [x2, y2] = map(e.x2, e.y2);
          const th = Number(e.width) || 2;
          const col = P.hex(e.stroke || '#d13438');
          page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: th, color: col, opacity, lineCap: LineCapStyle.Round });
          if (e.type === 'arrow') {
            const a = Math.atan2(y2 - y1, x2 - x1), L = 6 + th * 3;
            for (const d of [-0.45, 0.45]) page.drawLine({ start: { x: x2, y: y2 }, end: { x: x2 - L * Math.cos(a + d), y: y2 - L * Math.sin(a + d) }, thickness: th, color: col, opacity, lineCap: LineCapStyle.Round });
          }
          break;
        }
        case 'ink': {
          const pts = e.points || [];
          if (pts.length < 2) break;
          const minX = Math.min(...pts.map((p) => p[0])), minY = Math.min(...pts.map((p) => p[1]));
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p[0] - minX).toFixed(2)} ${(p[1] - minY).toFixed(2)}`).join(' ');
          const [ax, ay] = map(minX, minY);
          page.drawSvgPath(d, { x: ax, y: ay, borderColor: P.hex(e.stroke || '#1b1b1b'), borderWidth: Number(e.width) || 2, borderOpacity: opacity, borderLineCap: LineCapStyle.Round, rotate: rot });
          break;
        }
        case 'image': case 'signature': {
          const [x, y, w, h] = e.rect;
          const m2 = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(e.data || '');
          if (!m2) break;
          const bytes = Buffer.from(m2[2], 'base64');
          const im = m2[1] === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          const [ax, ay] = map(x, y + h);
          page.drawImage(im, { x: ax, y: ay, width: w, height: h, rotate: rot, opacity });
          break;
        }
        default: break;
      }
    }
  }
  const next = await doc.save({ useObjectStreams: true });
  pushUndo(s);
  await loadState(s, next);
  return info(s);
}

/** Page operations: rotate, delete, move, duplicate, insert blank, insert another file. */
async function pageOp(id, op) {
  const s = get(id);
  const src = await PDFDocument.load(s.bytes, { updateMetadata: false });
  const n = src.getPageCount();
  let order = [...Array(n).keys()];
  const dst = await PDFDocument.create();
  const sel = (op.pages || []).filter((i) => i >= 0 && i < n);
  if (op.type === 'rotate') {
    sel.forEach((i) => { const p = src.getPage(i); p.setRotation(degrees((((p.getRotation().angle || 0) + (op.angle || 90)) % 360 + 360) % 360)); });
    const out = await src.save({ useObjectStreams: true });
    pushUndo(s); await loadState(s, out); return info(s);
  }
  if (op.type === 'delete') {
    if (sel.length >= n) throw new Error('A PDF needs at least one page.');
    order = order.filter((i) => !sel.includes(i));
  }
  if (op.type === 'move') {
    // move the selected pages so they start at index `to` (in the original numbering)
    const moving = order.filter((i) => sel.includes(i));
    const rest = order.filter((i) => !sel.includes(i));
    const before = rest.filter((i) => i < op.to).length;
    order = [...rest.slice(0, before), ...moving, ...rest.slice(before)];
  }
  if (op.type === 'reorder') order = op.order.filter((i) => i >= 0 && i < n);
  if (op.type === 'duplicate') order = order.flatMap((i) => (sel.includes(i) ? [i, i] : [i]));
  const copied = await dst.copyPages(src, order);
  copied.forEach((p) => dst.addPage(p));
  if (op.type === 'blank') {
    const ref = dst.getPage(Math.min(op.at ?? n, dst.getPageCount() - 1));
    const { width, height } = ref.getSize();
    dst.insertPage(U.clamp(op.at ?? n, 0, dst.getPageCount()), [width, height]);
  }
  if (op.type === 'insertFile') {
    let ins;
    if (U.groupOf(op.file) === 'pdf') ins = await P.loadLib(op.file);
    else {
      const tmp = path.join(await U.tmpDir('ins'), 'i.pdf');
      await P.imagesToPdf([op.file], { pageSize: 'fit' }, tmp);
      ins = await PDFDocument.load(await fsp.readFile(tmp));
    }
    const pages = await dst.copyPages(ins, ins.getPageIndices());
    let at = U.clamp(op.at ?? dst.getPageCount(), 0, dst.getPageCount());
    pages.forEach((p) => dst.insertPage(at++, p));
  }
  const out = await dst.save({ useObjectStreams: true });
  pushUndo(s);
  await loadState(s, out);
  return info(s);
}
async function save(id, outPath) {
  const s = get(id);
  const target = outPath || s.path;
  await fsp.writeFile(target, s.bytes);
  s.dirty = false;
  if (outPath) s.path = outPath;
  return info(s);
}
async function exportPages(id, pages, outPath) {
  const s = get(id);
  const src = await PDFDocument.load(s.bytes);
  const dst = await PDFDocument.create();
  (await dst.copyPages(src, pages)).forEach((p) => dst.addPage(p));
  await fsp.writeFile(outPath, await dst.save());
  return outPath;
}
function close(id) { sessions.delete(id); return true; }

module.exports = { open, render, text, search, apply, pageOp, undo, redo, save, exportPages, close };
