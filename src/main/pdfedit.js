'use strict';

const { PDFDocument, rgb, degrees, BlendMode, LineCapStyle, setCharacterSpacing } = require('pdf-lib');
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
  s.objCache = new Map();
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

  const clean = probe.needsPassword() ? Buffer.from(probe.saveToBuffer('encrypt=none').asUint8Array()) : bytes;
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
// The page under one line, drawn without its text. The editor shows this where a line is being edited, so cell
// shading, rules and pictures behind it stay exactly as they are; saving removes only the text too.
// With mode 'erase' it shows what removing everything in the box leaves, as saving does it: drawings wholly inside
// go, and text and pictures lose what is inside the box.
const boundPath = (m, path, stroke, ctm) => { try { return path.getBounds(stroke || null, ctm); } catch (_) { return path.getBounds(new m.StrokeState(), ctm); } };
async function patch(id, index, bbox, scale, mode = 'text') {
  const s = get(id);
  const m = await P.mupdf();
  const page = s.doc.loadPage(index), area = page.getBounds(), erase = mode === 'erase';
  const [x0, y0, x1, y1] = [bbox[0] - 1, bbox[1] - 1, bbox[2] + 1, bbox[3] + 1];
  const pix = new m.Pixmap(m.ColorSpace.DeviceRGB, [0, 0, Math.max(1, Math.ceil((x1 - x0) * scale)), Math.max(1, Math.ceil((y1 - y0) * scale))], false);
  pix.clear(255);
  const dev = new m.DrawDevice(m.Matrix.concat(m.Matrix.translate(-x0, -y0), m.Matrix.scale(scale, scale)), pix);
  const covered = (r) => r[0] >= x0 && r[1] >= y0 && r[2] <= x1 && r[3] <= y1;
  const hole = new m.Path();
  hole.rect(area[0], area[1], area[2], area[3]);
  hole.rect(x0, y0, x1, y1);
  const outside = (draw) => { dev.clipPath(hole, true, m.Matrix.identity); draw(); dev.popClip(); };
  page.run(new m.Device({
    fillPath: (p, eo, t, ...a) => { if (!(erase && covered(boundPath(m, p, null, t)))) dev.fillPath(p, eo, t, ...a); },
    strokePath: (p, st, t, ...a) => { if (!(erase && covered(boundPath(m, p, st, t)))) dev.strokePath(p, st, t, ...a); },
    clipPath: (...a) => dev.clipPath(...a), clipStrokePath: (...a) => dev.clipStrokePath(...a),
    fillText: (...a) => { if (erase) outside(() => dev.fillText(...a)); }, strokeText: (...a) => { if (erase) outside(() => dev.strokeText(...a)); },
    clipText: (...a) => dev.clipText(...a), clipStrokeText: (...a) => dev.clipStrokeText(...a), ignoreText: (...a) => dev.ignoreText(...a),
    fillShade: (...a) => dev.fillShade(...a), clipImageMask: (...a) => dev.clipImageMask(...a), popClip: () => dev.popClip(),
    fillImage: (...a) => (erase ? outside(() => dev.fillImage(...a)) : dev.fillImage(...a)), fillImageMask: (...a) => (erase ? outside(() => dev.fillImageMask(...a)) : dev.fillImageMask(...a)),
    beginMask: (...a) => dev.beginMask(...a), endMask: () => dev.endMask(), beginGroup: (...a) => dev.beginGroup(...a), endGroup: () => dev.endGroup(),
    beginTile: (...a) => dev.beginTile(...a), endTile: () => dev.endTile(), beginLayer: (...a) => dev.beginLayer(...a), endLayer: () => dev.endLayer(),
  }), m.Matrix.identity);
  dev.close();
  return Buffer.from(pix.asPNG());
}
// The page's own content as things to pick in the editor: each picture, each drawing (paths that touch are one
// drawing, so a table's rules and cell fills come together, with the text inside them), and each block of text.
// Page-filling backgrounds are left out, so a click never picks the whole page.
async function objects(id, index) {
  const s = get(id);
  if (s.objCache.has(index)) return s.objCache.get(index);
  const m = await P.mupdf();
  const page = s.doc.loadPage(index), area = page.getBounds(), whole = (area[2] - area[0]) * (area[3] - area[1]);
  const size = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  const clip = (r) => [Math.max(r[0], area[0]), Math.max(r[1], area[1]), Math.min(r[2], area[2]), Math.min(r[3], area[3])];
  const paths = [], images = [];
  const keep = (list, r) => { if (!r.every(Number.isFinite)) return; const c = clip(r); if (c[2] - c[0] < 0.5 && c[3] - c[1] < 0.5) return; if (size(c) > whole * 0.85) return; list.push(c); };
  page.run(new m.Device({
    fillPath: (p, eo, t) => keep(paths, boundPath(m, p, null, t)),
    strokePath: (p, st, t) => keep(paths, boundPath(m, p, st, t)),
    fillImage: (img, t) => keep(images, m.Rect.transform([0, 0, 1, 1], t)),
    fillImageMask: (img, t) => keep(images, m.Rect.transform([0, 0, 1, 1], t)),
  }), m.Matrix.identity);
  // Paths within 2 pt of each other join one drawing (sorted by left edge, so only neighbours are compared).
  const near = (a, b, g = 2) => a[0] - g <= b[2] && b[0] - g <= a[2] && a[1] - g <= b[3] && b[1] - g <= a[3];
  const groups = [];
  for (const r of paths.sort((a, b) => a[0] - b[0])) {
    const hit = groups.filter((g) => near(g.bbox, r));
    if (!hit.length) { groups.push({ bbox: [...r], n: 1 }); continue; }
    const [g, ...rest] = hit;
    for (const o of [r, ...rest.map((x) => x.bbox)]) g.bbox = [Math.min(g.bbox[0], o[0]), Math.min(g.bbox[1], o[1]), Math.max(g.bbox[2], o[2]), Math.max(g.bbox[3], o[3])];
    g.n += 1 + rest.reduce((t, x) => t + x.n, 0);
    for (const x of rest) groups.splice(groups.indexOf(x), 1);
  }
  const blocks = [];
  let cur = null;
  page.toStructuredText('preserve-whitespace').walk({
    beginTextBlock(bbox) { cur = { bbox: [...bbox], text: '' }; },
    onChar(c) { if (cur) cur.text += c; },
    endTextBlock() { if (cur && cur.text.trim()) blocks.push(cur); cur = null; },
  });
  const within = (a, b) => a[0] >= b[0] - 2 && a[1] >= b[1] - 2 && a[2] <= b[2] + 2 && a[3] <= b[3] + 2;
  const items = [];
  for (const g of groups) {
    const inside = blocks.filter((b) => within(b.bbox, g.bbox));
    items.push({ kind: inside.length && g.n >= 4 ? 'table' : 'drawing', bbox: g.bbox, text: inside.map((b) => b.text.trim()).join(' ').slice(0, 80) });
  }
  for (const b of blocks) if (!items.some((it) => it.kind === 'table' && within(b.bbox, it.bbox))) items.push({ kind: 'text', bbox: clip(b.bbox), text: b.text.trim().slice(0, 80) });
  for (const r of images) items.push({ kind: 'image', bbox: r });
  // Largest first, so smaller things drawn later sit on top and a click inside a table can still pick a picture in it.
  const out = items.filter((it) => size(it.bbox) > 1).sort((a, b) => size(b.bbox) - size(a.bbox)).map((it, i) => ({ id: `${index}:o${i}`, ...it }));
  s.objCache.set(index, out);
  return out;
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

// Turns a point of the page (y down) clockwise by deg about (cx, cy), as CSS rotate() does on screen.
const turner = (deg, cx, cy) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  return deg ? (u, v) => [cx + (u - cx) * c - (v - cy) * sn, cy + (u - cx) * sn + (v - cy) * c] : (u, v) => [u, v];
};
// Ticks and crosses as strokes across a unit box; the editor draws the same ones.
const MARK_LINES = { check: [[[0.1, 0.55], [0.4, 0.85], [0.92, 0.15]]], cross: [[[0.15, 0.15], [0.85, 0.85]], [[0.85, 0.15], [0.15, 0.85]]] };
const BUILT_IN = ['sans', 'serif', 'mono', 'carlito', 'helvetica', 'times', 'courier', 'caveat', 'dancing'];
function fontKey(e) {
  const style = `${e.bold ? '-bold' : ''}${e.italic ? (e.bold ? 'italic' : '-italic') : ''}`;
  if (String(e.font).startsWith('sys:')) {
    const fam = installed?.map.get(e.font.slice(4));
    const file = fam && (fam[e.bold && e.italic ? 'bolditalic' : e.bold ? 'bold' : e.italic ? 'italic' : 'regular'] || fam.regular);
    if (file) return `file:${file}`;
    return `sans${style}`;
  }
  const f = BUILT_IN.includes(e.font) ? e.font : 'sans';
  return f === 'caveat' || f === 'dancing' ? f : `${f}${style}`;
}

// Fonts installed on this computer, grouped by family with a file per style. Only each file's name and OS/2 tables are
// read, so a few hundred fonts take a moment; fonts whose licence forbids embedding are left out.
const FONT_DIRS = () => (process.platform === 'darwin' ? ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', path.join(U.os.homedir(), 'Library', 'Fonts')]
  : process.platform === 'win32' ? [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')].filter(Boolean)
    : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(U.os.homedir(), '.fonts'), path.join(U.os.homedir(), '.local', 'share', 'fonts')]);
const utf16 = (b) => { let t = ''; for (let i = 0; i + 1 < b.length; i += 2) t += String.fromCharCode(b.readUInt16BE(i)); return t; };
function fontNames(file) {
  const fd = U.fs.openSync(file, 'r');
  try {
    const read = (len, at) => { const b = Buffer.alloc(len); U.fs.readSync(fd, b, 0, len, at); return b; };
    const head = read(12, 0), sig = head.readUInt32BE(0);
    if (![0x00010000, 0x4f54544f, 0x74727565].includes(sig)) return null;
    const n = head.readUInt16BE(4), dir = read(16 * n, 12), table = {};
    for (let i = 0; i < n; i++) table[dir.toString('latin1', i * 16, i * 16 + 4)] = [dir.readUInt32BE(i * 16 + 8), dir.readUInt32BE(i * 16 + 12)];
    if (table['OS/2'] && (read(2, table['OS/2'][0] + 8).readUInt16BE(0) & 0x000f) === 0x0002) return null;
    if (!table.name || table.name[1] > 1 << 20) return null;
    const t = read(table.name[1], table.name[0]), count = t.readUInt16BE(2), base = t.readUInt16BE(4), got = {};
    for (let i = 0; i < count; i++) {
      const r = 6 + i * 12, plat = t.readUInt16BE(r), enc = t.readUInt16BE(r + 2), lang = t.readUInt16BE(r + 4), id = t.readUInt16BE(r + 6), raw = t.subarray(base + t.readUInt16BE(r + 10), base + t.readUInt16BE(r + 10) + t.readUInt16BE(r + 8));
      if (id !== 1 && id !== 2) continue;
      const v = plat === 3 || plat === 0 ? utf16(raw) : plat === 1 && enc === 0 ? raw.toString('latin1') : null, rank = plat === 3 && lang === 0x409 ? 3 : plat === 1 ? 1 : 2;
      if (v && (!got[id] || got[id].rank < rank)) got[id] = { v: v.trim(), rank };
    }
    return got[1] ? { family: got[1].v, style: got[2]?.v || 'Regular' } : null;
  } finally { U.fs.closeSync(fd); }
}
let installed = null;
async function fonts() {
  if (installed) return installed.list;
  const files = [];
  const walk = (d, depth) => { let ents = []; try { ents = U.fs.readdirSync(d, { withFileTypes: true }); } catch (_) {} for (const e of ents) { const f = path.join(d, e.name); if (e.isDirectory() && depth < 3) walk(f, depth + 1); else if (/\.(ttf|otf)$/i.test(e.name)) files.push(f); } };
  FONT_DIRS().forEach((d) => walk(d, 0));
  const map = new Map();
  for (const f of files.slice(0, 4000)) {
    let n = null;
    try { n = fontNames(f); } catch (_) {}
    if (!n || n.family.startsWith('.')) continue;
    const st = n.style.toLowerCase(), bold = /bold|black|heavy/.test(st), italic = /italic|oblique/.test(st);
    const slot = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : /^(regular|normal|book|roman|medium|plain)$/.test(st) ? 'regular' : null;
    if (!slot) continue;
    if (!map.has(n.family)) map.set(n.family, {});
    map.get(n.family)[slot] ||= f;
  }
  const list = [...map.entries()].filter(([, v]) => v.regular).map(([family, v]) => ({ family, bold: !!v.bold, italic: !!v.italic })).sort((a, b) => a.family.localeCompare(b.family));
  installed = { map, list };
  return list;
}

async function apply(id, edits) {
  const s = get(id);
  if (!edits?.length) return info(s);
  const m = await P.mupdf();
  const byPage = new Map();
  for (const e of edits) { if (!byPage.has(e.page)) byPage.set(e.page, []); byPage.get(e.page).push(e); }

  const work = m.Document.openDocument(s.bytes, 'application/pdf');
  const transforms = new Map();
  for (const [pi, list] of byPage) {
    const page = work.loadPage(pi);
    transforms.set(pi, m.Matrix.invert(page.getTransform()));
    // Removing a picture, table, drawing or text block from the page: everything wholly inside the box goes, pictures
    // lose their pixels inside it, and text inside it is taken out. Done first, on its own, because text edits below
    // keep every drawing and picture.
    const erase = list.filter((e) => e.type === 'erase');
    if (erase.length) {
      for (const e of erase) { const a = page.createAnnotation('Redact'); a.setRect([e.rect[0] - 1, e.rect[1] - 1, e.rect[0] + e.rect[2] + 1, e.rect[1] + e.rect[3] + 1]); }
      page.applyRedactions(false, 2, 1, 0);
    }
    const rects = [];
    for (const e of list) {
      if (e.type === 'replace' || e.type === 'deleteText') rects.push(e.bbox);
      if (e.type === 'whiteout') rects.push([e.rect[0], e.rect[1], e.rect[0] + e.rect[2], e.rect[1] + e.rect[3]]);
    }
    if (rects.length) {
      for (const r of rects) { const a = page.createAnnotation('Redact'); a.setRect([r[0] - 0.3, r[1] - 0.3, r[2] + 0.3, r[3] + 0.3]); }

      page.applyRedactions(false, 0, 0, 0);
    }
  }
  const redacted = Buffer.from(work.saveToBuffer('garbage=compact').asUint8Array());

  const doc = await PDFDocument.load(redacted, { updateMetadata: false });
  const fonts_ = P.fontCache(doc);
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
          if (String(e.font).startsWith('sys:')) await fonts();
          const font = await fonts_(fontKey(e), str);
          const size = Number(e.size) || 12;
          const lh = size * (Number(e.lineHeight) || 1.2), sp = Number(e.spacing) || 0;
          const lines = str.split(/\r?\n/), widthOf = (ln) => font.widthOfTextAtSize(ln, size) + sp * Math.max(0, [...ln].length - 1);
          const boxW = Math.max(...lines.map(widthOf)), shift = { center: 0.5, right: 1 }[e.align] || 0;
          // Turned text turns about the middle of its box, as the editor shows it.
          const turn = turner(Number(e.rotate) || 0, e.x + boxW / 2, (e.y - size * 0.86 + e.y + (lines.length - 1) * lh + size * 0.28) / 2);
          const at = (u, v) => map(...turn(u, v)), trot = degrees(angle - (Number(e.rotate) || 0));
          // A background colour behind the words, a little wider and taller than them, and a border around that with
          // rounded corners (how stamps are drawn).
          const bg = e.bg && e.bg !== 'none' ? P.hex(e.bg) : undefined, border = e.border && e.border !== 'none' ? P.hex(e.border) : undefined;
          const pad = size * 0.18, boxH = (lines.length - 1) * lh + size * 1.14 + pad * 2;
          if (border) {
            const bw = Math.max(1, size / 12), W = boxW + pad * 2 + bw, H = boxH + bw, r = Math.min(size * 0.22, W / 2, H / 2), [ox, oy] = at(e.x - pad - bw / 2, e.y - size * 0.86 - pad - bw / 2);
            const d = `M${r} 0H${W - r}Q${W} 0 ${W} ${r}V${H - r}Q${W} ${H} ${W - r} ${H}H${r}Q0 ${H} 0 ${H - r}V${r}Q0 0 ${r} 0Z`;
            page.drawSvgPath(d, { x: ox, y: oy, color: bg, opacity, borderColor: border, borderWidth: bw, borderOpacity: opacity, rotate: trot });
          } else if (bg) {
            const [bx, by] = at(e.x - pad, e.y + (lines.length - 1) * lh + size * 0.28 + pad);
            page.drawRectangle({ x: bx, y: by, width: boxW + pad * 2, height: boxH, color: bg, opacity, rotate: trot });
          }
          if (sp) page.pushOperators(setCharacterSpacing(sp));
          lines.forEach((ln, i) => {
            const w = widthOf(ln), x0 = e.x + (boxW - w) * shift, base = e.y + i * lh;
            const [x, y] = at(x0, base);
            page.drawText(ln, { x, y, size, font, color, opacity, rotate: trot });
            const rule = (dy) => { const [x1, y1] = at(x0, base + dy), [x2, y2] = at(x0 + w, base + dy); page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: size / 16, color, opacity }); };
            if (e.underline) rule(size * 0.12);
            if (e.strike) rule(-size * 0.3);
          });
          if (sp) page.pushOperators(setCharacterSpacing(0));
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
          // Underline and strike-out: a line along the bottom of what was marked, or through its middle.
          if (e.markup === 'underline' || e.markup === 'strike') {
            const th = Math.max(1, h * 0.08), at = e.markup === 'underline' ? y + h - th / 2 : y + h * 0.55, [x1, y1] = map(x, at), [x2, y2] = map(x + w, at);
            page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: th, color: P.hex(e.color || '#d13438') });
            break;
          }
          const [ax, ay] = map(x, y + h);
          page.drawRectangle({ x: ax, y: ay, width: w, height: h, color: P.hex(e.color || '#ffe14d'), opacity: e.opacity ?? 0.45, blendMode: BlendMode.Multiply, rotate: rot });
          break;
        }
        case 'mark': {
          const [x, y, w, h] = e.rect, col = P.hex(e.stroke || '#107c10');
          if (e.kind === 'dot') {
            const [cx, cy] = map(x + w / 2, y + h / 2);
            page.drawEllipse({ x: cx, y: cy, xScale: Math.min(w, h) * 0.3, yScale: Math.min(w, h) * 0.3, color: col, opacity });
            break;
          }
          const d = (MARK_LINES[e.kind] || MARK_LINES.check).map((ln) => ln.map(([u, v], j) => `${j ? 'L' : 'M'}${(u * w).toFixed(2)} ${(v * h).toFixed(2)}`).join('')).join('');
          const [ax, ay] = map(...turner(Number(e.rotate) || 0, x + w / 2, y + h / 2)(x, y));
          page.drawSvgPath(d, { x: ax, y: ay, borderColor: col, borderWidth: Number(e.width) || 2, borderOpacity: opacity, borderLineCap: LineCapStyle.Round, rotate: degrees(angle - (Number(e.rotate) || 0)) });
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

module.exports = { open, render, patch, objects, fonts, text, search, apply, pageOp, undo, redo, save, exportPages, close };
