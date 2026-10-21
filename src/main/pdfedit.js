'use strict';

const { PDFDocument, rgb, degrees, BlendMode, LineCapStyle, setCharacterSpacing, endMarkedContent, PDFOperator, PDFOperatorNames, PDFName, PDFNumber, PDFArray, PDFDict, PDFHexString } = require('pdf-lib');
const P = require('./engines/pdf');
const U = require('./engines/util');
const { fsp, path } = U;

const sessions = new Map();
let seq = 0;

async function loadState(s, bytes) {
  const m = await P.mupdf();
  s.bytes = bytes;
  s.doc = m.Document.openDocument(bytes, 'application/pdf');
  s.textCache = new Map();
  s.objCache = new Map();
}
function info(s) {
  const pages = [];
  for (let i = 0; i < s.doc.countPages(); i++) {
    const b = s.doc.loadPage(i).getBounds();
    pages.push({ w: b[2] - b[0], h: b[3] - b[1] });
  }
  let tagged = false;
  try { tagged = s.doc.getTrailer().get('Root').get('MarkInfo').get('Marked').asBoolean() === true; } catch (_) {}
  return { id: s.id, pages, path: s.path, name: path.basename(s.path), canUndo: s.undo.length > 0, canRedo: s.redo.length > 0, dirty: s.dirty, protected: !!s.password, tagged };
}
async function open(file, password) {
  const bytes = new Uint8Array(await fsp.readFile(file));
  const m = await P.mupdf();
  const probe = m.Document.openDocument(bytes, 'application/pdf');
  // Asked once: asking again after the password went in tries an empty one, which leaves later objects unreadable.
  const locked = probe.needsPassword();
  if (locked && (!password || !probe.authenticatePassword(password))) {
    const e = new Error(password ? 'That password is wrong.' : 'This PDF is password-protected.');
    e.code = 'PASSWORD';
    throw e;
  }
  // The working copy is unlocked; the password is kept to lock the saved file again.
  const s = { id: ++seq, path: file, password: locked ? password : '', undo: [], redo: [], dirty: false };
  const clean = locked ? Buffer.from(probe.saveToBuffer('encrypt=none,garbage=compact').asUint8Array()) : bytes;
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
  // Thirty steps back, or fewer for big files: the copies kept for undo stay under 256 MB.
  for (let n = 0, i = s.undo.length - 1; i >= 0; i--) { n += s.undo[i].length; if (i && (n > 256e6 || s.undo.length - i >= 30)) { s.undo.splice(0, i); break; } }
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
// The faces in a font file: one, or several in a collection (.ttc, which is what most of macOS's own fonts are).
function fontNames(file) {
  const fd = U.fs.openSync(file, 'r');
  try {
    const read = (len, at) => { const b = Buffer.alloc(len); U.fs.readSync(fd, b, 0, len, at); return b; };
    const face = (at) => {
      const head = read(12, at), sig = head.readUInt32BE(0);
      if (![0x00010000, 0x4f54544f, 0x74727565].includes(sig)) return null;
      const n = head.readUInt16BE(4), dir = read(16 * n, at + 12), table = {};
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
    };
    if (read(4, 0).readUInt32BE(0) !== 0x74746366) { const f = face(0); return f ? [{ ...f, at: file }] : []; }
    const n = Math.min(read(4, 8).readUInt32BE(0), 64), offs = read(4 * n, 12), out = [];
    for (let i = 0; i < n; i++) { const f = face(offs.readUInt32BE(4 * i)); if (f) out.push({ ...f, at: `${file}#${i}` }); }
    return out;
  } finally { U.fs.closeSync(fd); }
}
let installed = null;
async function fonts() {
  if (installed) return installed.list;
  const files = [];
  const walk = (d, depth) => { let ents = []; try { ents = U.fs.readdirSync(d, { withFileTypes: true }); } catch (_) {} for (const e of ents) { const f = path.join(d, e.name); if (e.isDirectory() && depth < 3) walk(f, depth + 1); else if (/\.(ttf|otf|ttc)$/i.test(e.name)) files.push(f); } };
  FONT_DIRS().forEach((d) => walk(d, 0));
  const map = new Map();
  for (const f of files.slice(0, 4000)) {
    let faces = [];
    try { faces = fontNames(f); } catch (_) {}
    for (const n of faces) {
      if (n.family.startsWith('.')) continue;
      const st = n.style.toLowerCase(), bold = /bold|black|heavy/.test(st), italic = /italic|oblique/.test(st);
      const slot = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : /^(regular|normal|book|roman|medium|plain)$/.test(st) ? 'regular' : null;
      if (!slot) continue;
      if (!map.has(n.family)) map.set(n.family, {});
      map.get(n.family)[slot] ||= n.at;
    }
  }
  const list = [...map.entries()].filter(([, v]) => v.regular).map(([family, v]) => ({ family, bold: !!v.bold, italic: !!v.italic })).sort((a, b) => a.family.localeCompare(b.family));
  installed = { map, list };
  return list;
}

// Words wrapped to a paragraph's width, keeping the line breaks typed; a word wider than the box gets a line of its own.
function wrapLines(str, width, widthOf) {
  const out = [];
  for (const para of String(str).split(/\r?\n/)) {
    let cur = '';
    for (const w of para.split(/ +/)) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && widthOf(next) > width + 0.5) { out.push(cur); cur = w; } else cur = next;
    }
    out.push(cur);
  }
  return out;
}
const ANNOTS = new Set(['highlight', 'rect', 'ellipse', 'line', 'arrow', 'ink', 'measure']);
const rgb01 = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0; return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const hexOf = (c) => (Array.isArray(c) && c.length ? `#${(c.length >= 3 ? c.slice(0, 3) : [c[0], c[0], c[0]]).map((v) => Math.round(U.clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}` : '');
const whoAmI = () => { try { return U.os.userInfo().username; } catch (_) { return ''; } };
function addAnnot(page, e) {
  const box = (r) => [r[0], r[1], r[0] + r[2], r[1] + r[3]];
  let a;
  if (e.type === 'highlight') {
    a = page.createAnnotation({ underline: 'Underline', strike: 'StrikeOut' }[e.markup] || 'Highlight');
    const [x0, y0, x1, y1] = box(e.rect);
    a.setQuadPoints([[x0, y0, x1, y0, x0, y1, x1, y1]]);
    a.setColor(rgb01(e.color || '#ffe14d'));
  } else if (e.type === 'rect' || e.type === 'ellipse') {
    a = page.createAnnotation(e.type === 'rect' ? 'Square' : 'Circle');
    a.setRect(box(e.rect));
    if (e.fill && e.fill !== 'none') a.setInteriorColor(rgb01(e.fill));
  } else if (e.type === 'line' || e.type === 'arrow') {
    a = page.createAnnotation('Line');
    a.setLine([e.x1, e.y1], [e.x2, e.y2]);
    if (e.type === 'arrow') a.setLineEndingStyles('None', 'OpenArrow');
  } else if (e.type === 'ink') {
    a = page.createAnnotation('Ink');
    a.setInkList([e.points]);
  } else if (e.type === 'measure') {
    // A distance is a dimension line with its length as the caption; a perimeter or an area is an open or closed
    // outline with the result as its comment.
    const pts = e.points || [];
    if (e.kind === 'distance') {
      a = page.createAnnotation('Line');
      a.setLine(pts[0], pts[pts.length - 1]);
      a.setLineEndingStyles('Butt', 'Butt');
      a.setIntent('LineDimension');
      a.setLineCaption(true);
    } else {
      a = page.createAnnotation(e.kind === 'area' ? 'Polygon' : 'PolyLine');
      a.setVertices(pts);
      a.getObject().put('IT', e.kind === 'area' ? 'PolygonDimension' : 'PolyLineDimension');
    }
  }
  if (!a) return;
  if (e.type !== 'highlight') { a.setColor(rgb01(e.stroke || '#d13438')); a.setBorderWidth(Number(e.width) || 2); }
  if (e.type !== 'highlight' && e.opacity != null && e.opacity < 1) a.setOpacity(U.clamp(Number(e.opacity), 0.05, 1));
  a.setAuthor(e.author || whoAmI());
  if (e.contents) a.setContents(String(e.contents));
  a.update();
}

// A Figure element with alternative text in the document's structure (made if the file has none), tied to the page
// through the parent tree; returns the marked-content id the picture is drawn under.
function tagFigure(doc, page, alt) {
  const ctx = doc.context, cat = doc.catalog, K = PDFName.of('K'), num = (o) => (o instanceof PDFNumber ? o.asNumber() : null);
  let rootRef = cat.get(PDFName.of('StructTreeRoot')), root = cat.lookup(PDFName.of('StructTreeRoot'));
  if (!(root instanceof PDFDict)) { root = ctx.obj({ Type: 'StructTreeRoot', K: [] }); rootRef = ctx.register(root); cat.set(PDFName.of('StructTreeRoot'), rootRef); }
  // The figure goes under the Document element when there is one, else straight under the root.
  let parentRef = rootRef, parent = root;
  const top = root.lookup(K), first = top instanceof PDFArray ? top.lookup(0) : top;
  if (first instanceof PDFDict && /Document/.test(String(first.get(PDFName.of('S'))))) { parentRef = top instanceof PDFArray ? top.get(0) : root.get(K); parent = first; }
  let tree = root.lookup(PDFName.of('ParentTree'));
  if (!(tree instanceof PDFDict)) { tree = ctx.obj({ Nums: [] }); root.set(PDFName.of('ParentTree'), ctx.register(tree)); }
  const leaves = [];
  const walk = (node) => { if (node.lookup(PDFName.of('Nums')) instanceof PDFArray) leaves.push(node); const kids = node.lookup(PDFName.of('Kids')); if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) walk(kids.lookup(i)); };
  walk(tree);
  let key = num(page.node.get(PDFName.of('StructParents'))), list = null, max = -1;
  for (const leaf of leaves) { const nums = leaf.lookup(PDFName.of('Nums')); for (let i = 0; i + 1 < nums.size(); i += 2) { const k = num(nums.get(i)); max = Math.max(max, k ?? -1); if (k === key) list = nums.lookup(i + 1); } }
  if (!(list instanceof PDFArray)) {
    key = Math.max(max + 1, num(root.get(PDFName.of('ParentTreeNextKey'))) ?? 0);
    list = ctx.obj([]);
    // A new page key goes at the end of the last leaf, which then reaches up to it.
    const leaf = leaves[leaves.length - 1] || tree;
    if (!(leaf.lookup(PDFName.of('Nums')) instanceof PDFArray)) leaf.set(PDFName.of('Nums'), ctx.obj([]));
    const nums = leaf.lookup(PDFName.of('Nums')), limits = leaf.lookup(PDFName.of('Limits'));
    nums.push(PDFNumber.of(key));
    nums.push(ctx.register(list));
    if (limits instanceof PDFArray && limits.size() === 2) limits.set(1, PDFNumber.of(key));
    page.node.set(PDFName.of('StructParents'), PDFNumber.of(key));
    root.set(PDFName.of('ParentTreeNextKey'), PDFNumber.of(key + 1));
  }
  const mcid = list.size(), elem = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Figure', P: parentRef, Pg: page.ref, K: mcid, Alt: PDFHexString.fromText(alt) }));
  const kids = parent.lookup(K);
  if (kids instanceof PDFArray) kids.push(elem); else parent.set(K, ctx.obj(kids ? [parent.get(K), elem] : [elem]));
  list.push(elem);
  return mcid;
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
    // Redaction marks: everything under them (text, pictures, drawings) goes for good, with a black box in its place
    // unless the marks asked for none.
    const marks = list.filter((e) => e.type === 'redact');
    if (marks.length) {
      for (const e of marks) { const a = page.createAnnotation('Redact'); a.setRect([e.rect[0], e.rect[1], e.rect[0] + e.rect[2], e.rect[1] + e.rect[3]]); }
      page.applyRedactions(marks[0].boxes !== false, 2, 2, 0);
    }
    // Markup, shapes, drawings and measurements become comments (annotations) as Acrobat makes them, so they stay
    // editable in any viewer; Save can flatten them into the page instead.
    for (const e of list) if (ANNOTS.has(e.type)) addAnnot(page, e);
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
      if (ANNOTS.has(e.type)) continue;
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
          const widthOf = (ln) => font.widthOfTextAtSize(ln, size) + sp * Math.max(0, [...ln].length - 1);
          const lines = e.wrap ? wrapLines(str, Number(e.wrap), widthOf) : str.split(/\r?\n/);
          const boxW = e.wrap ? Number(e.wrap) : Math.max(...lines.map(widthOf)), shift = { center: 0.5, right: 1 }[e.align] || 0;
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
          // With alternative text the picture is a tagged figure, so screen readers say what it shows.
          const mcid = e.alt ? tagFigure(doc, page, String(e.alt)) : null;
          if (mcid != null) page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('Figure'), doc.context.obj({ MCID: mcid })]));
          page.drawImage(im, { x: ax, y: ay, width: w, height: h, rotate: rot, opacity });
          if (mcid != null) page.pushOperators(endMarkedContent());
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

// Page changes keep what belongs to the whole document (bookmarks, form fields, properties, labels): pages are moved
// and deleted in place, and copies and new pages are added to the same file.
async function pageOp(id, op) {
  const s = get(id);
  const m = await P.mupdf();
  const n = s.doc.countPages();
  const sel = (op.pages || []).filter((i) => i >= 0 && i < n);
  let out;
  if (['delete', 'move', 'reorder'].includes(op.type)) {
    let order = [...Array(n).keys()];
    if (op.type === 'delete') {
      if (sel.length >= n) throw new Error('A PDF needs at least one page.');
      order = order.filter((i) => !sel.includes(i));
    }
    if (op.type === 'move') {
      const moving = order.filter((i) => sel.includes(i)), rest = order.filter((i) => !sel.includes(i)), before = rest.filter((i) => i < op.to).length;
      order = [...rest.slice(0, before), ...moving, ...rest.slice(before)];
    }
    if (op.type === 'reorder') order = op.order.filter((i) => i >= 0 && i < n);
    const work = m.Document.openDocument(s.bytes, 'application/pdf');
    work.rearrangePages(order);
    out = Buffer.from(work.saveToBuffer('garbage=compact').asUint8Array());
  } else if (op.type === 'crop' || op.type === 'uncrop') {
    // The box is drawn on the page as shown; each page gets it in its own view (clipped to the page), or with auto,
    // the area its content covers plus a small margin.
    const work = m.Document.openDocument(s.bytes, 'application/pdf');
    for (const i of sel) {
      const page = work.loadPage(i);
      if (op.type === 'uncrop') { page.setPageBox('CropBox', page.getBounds('MediaBox')); continue; }
      const b = page.getBounds();
      let r = op.auto ? contentBox(m, page, op.margin ?? 6) : [op.rect[0], op.rect[1], op.rect[0] + op.rect[2], op.rect[1] + op.rect[3]];
      if (!r) continue;
      r = [Math.max(b[0], r[0]), Math.max(b[1], r[1]), Math.min(b[2], r[2]), Math.min(b[3], r[3])];
      if (r[2] - r[0] < 18 || r[3] - r[1] < 18) continue;
      page.setPageBox('CropBox', r);
    }
    out = Buffer.from(work.saveToBuffer('garbage=compact').asUint8Array());
  } else {
    const src = await PDFDocument.load(s.bytes, { updateMetadata: false });
    if (op.type === 'rotate') sel.forEach((i) => { const p = src.getPage(i); p.setRotation(degrees((((p.getRotation().angle || 0) + (op.angle || 90)) % 360 + 360) % 360)); });
    if (op.type === 'duplicate') {
      // Each copy lands after the last selected page, in order, as its own page (nothing shared with the original).
      let at = Math.max(...sel) + 1;
      for (const p of await src.copyPages(src, sel)) src.insertPage(at++, p);
    }
    if (op.type === 'blank') {
      const ref = src.getPage(Math.min(op.at ?? n, n - 1)), { width, height } = ref.getSize();
      src.insertPage(U.clamp(op.at ?? n, 0, n), [width, height]);
    }
    if (op.type === 'insertFile') {
      let ins;
      if (U.groupOf(op.file) === 'pdf') ins = await P.loadLib(op.file);
      else {
        const tmp = path.join(await U.tmpDir('ins'), 'i.pdf');
        await P.imagesToPdf([op.file], { pageSize: 'fit' }, tmp);
        ins = await PDFDocument.load(await fsp.readFile(tmp));
      }
      let at = U.clamp(op.at ?? n, 0, n);
      for (const p of await src.copyPages(ins, ins.getPageIndices())) src.insertPage(at++, p);
    }
    out = await src.save({ useObjectStreams: true });
  }
  pushUndo(s);
  await loadState(s, out);
  return info(s);
}
// The area a page's text, pictures and drawings cover (a page-filling background doesn't count), or null when empty.
function contentBox(m, page, margin) {
  const b = page.getBounds(), whole = (b[2] - b[0]) * (b[3] - b[1]);
  let r = null;
  const add = (q) => {
    if (!q || !q.every(Number.isFinite) || (q[2] - q[0]) * (q[3] - q[1]) > whole * 0.9) return;
    r = r ? [Math.min(r[0], q[0]), Math.min(r[1], q[1]), Math.max(r[2], q[2]), Math.max(r[3], q[3])] : [...q];
  };
  page.run(new m.Device({
    fillPath: (p, eo, t) => add(boundPath(m, p, null, t)), strokePath: (p, st, t) => add(boundPath(m, p, st, t)),
    fillText: (t, ctm) => add(t.getBounds?.(null, ctm)), strokeText: (t, st, ctm) => add(t.getBounds?.(st, ctm)),
    fillImage: (img, t) => add(m.Rect.transform([0, 0, 1, 1], t)), fillImageMask: (img, t) => add(m.Rect.transform([0, 0, 1, 1], t)),
  }), m.Matrix.identity);
  return r && [r[0] - margin, r[1] - margin, r[2] + margin, r[3] + margin];
}

// Saving writes the working copy, flattening comments or form fields into the page when asked, and keeps the file's
// password (or sets a new one) unless the protection is taken off.
async function save(id, outPath, opts = {}) {
  const s = get(id);
  const target = outPath || s.path;
  let bytes = s.bytes;
  const enc = opts.protect ? P.encryption(opts.protect) : opts.protect === undefined && s.password ? P.encryption({ userPassword: s.password }) : '';
  if (opts.flattenComments || opts.flattenFields || enc) {
    const m = await P.mupdf();
    const d = m.Document.openDocument(bytes, 'application/pdf');
    if (opts.flattenComments || opts.flattenFields) d.bake(!!opts.flattenComments, !!opts.flattenFields);
    bytes = Buffer.from(d.saveToBuffer(enc ? `${enc},garbage=compact` : 'garbage=compact').asUint8Array());
  }
  await fsp.writeFile(target, bytes);
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

// ── Comments, links, bookmarks, forms and the document's own settings ─────────────────────────────────────────
// These change the working copy at once (one undo step each), while what is drawn on pages waits in the editor
// until it is applied.
async function mutate(s, fn) {
  const m = await P.mupdf();
  const work = m.Document.openDocument(s.bytes, 'application/pdf');
  const res = await fn(work, m);
  const next = Buffer.from(work.saveToBuffer('garbage=yes').asUint8Array());
  pushUndo(s);
  await loadState(s, next);
  return res;
}
// PdfCraft's automation tools on the working copy: the steps run on doc 1, and with save the result replaces it
// (unless it is only a preview).
async function craft(s, steps, { save: keep = true, label = '', preview: look = false } = {}) {
  const dir = await U.tmpDir('edcraft'), src = path.join(dir, 'in.pdf'), out = path.join(dir, 'out.pdf');
  try {
    await fsp.writeFile(src, s.bytes);
    const res = await require('./engines/crafts').pdfScript([{ tool: 'doc_open', args: { path: src } }, ...steps.map((st) => ({ tool: st.tool, args: { doc: 1, ...st.args } })),
      ...(keep ? [{ tool: 'doc_save', args: { doc: 1, path: out, full: true } }] : [])], null, label);
    const bytes = keep ? await fsp.readFile(out) : null;
    if (keep && !look) { pushUndo(s); await loadState(s, bytes); }
    return { results: res.slice(1, 1 + steps.length), bytes };
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const dateOf = (a) => { try { const d = a.getModificationDate(); return d && !Number.isNaN(d.getTime()) && d.getFullYear() > 1971 ? d.toISOString() : ''; } catch (_) { return ''; } };
const SKIP_ANNOTS = new Set(['Link', 'Widget', 'Popup', 'Redact', 'PrinterMark', 'TrapNet', 'Watermark']);
function annots(id) {
  const s = get(id), out = [];
  for (let i = 0; i < s.doc.countPages(); i++) {
    for (const a of s.doc.loadPage(i).getAnnotations()) {
      const type = a.getType();
      if (SKIP_ANNOTS.has(type)) continue;
      const o = a.getObject(), irt = o.get('IRT'), state = o.get('State');
      let author = '';
      try { author = a.hasAuthor() ? a.getAuthor() : ''; } catch (_) {}
      out.push({
        id: `${i}:${o.asIndirect()}`, page: i, num: o.asIndirect(), type, rect: a.getBounds(), contents: a.getContents() || '', author, date: dateOf(a),
        color: hexOf(a.getColor()), replyTo: irt.isNull() ? null : irt.asIndirect(), status: state.isNull() ? '' : state.asString(),
        intent: o.get('IT').isNull() ? '' : o.get('IT').asName(),
      });
    }
  }
  return out;
}
async function annotOp(id, op) {
  const s = get(id);
  const author = op.author || whoAmI();
  const num = await mutate(s, (doc, m) => {
    const page = doc.loadPage(op.page);
    const find = (num) => { const a = page.getAnnotations().find((x) => x.getObject().asIndirect() === num); if (!a) throw new Error('That comment is no longer there.'); return a; };
    if (op.type === 'note') {
      const a = page.createAnnotation('Text');
      a.setRect([op.x, op.y, op.x + 20, op.y + 20]);
      a.setIcon(op.icon || 'Comment');
      a.setColor(rgb01(op.color || '#ffd400'));
      a.setContents(String(op.text || ''));
      a.setAuthor(author);
      a.update();
      return a.getObject().asIndirect();
    }
    if (op.type === 'reply') {
      // A reply is a note tied to its comment that draws nothing of its own, as Acrobat writes them (the appearance
      // isn't quite empty: an empty stream doesn't survive AES encryption in MuPDF).
      const parent = find(op.to), a = page.createAnnotation('Text');
      a.setRect(parent.getBounds());
      a.setContents(String(op.text || ''));
      a.setAuthor(author);
      a.setColor(parent.getColor()?.length ? parent.getColor() : [1, 0.83, 0]);
      a.getObject().put('IRT', parent.getObject());
      if (op.status) { a.getObject().put('State', `(${op.status})`); a.getObject().put('StateModel', '(Review)'); }
      a.update();
      a.setAppearance(null, null, m.Matrix.identity, [0, 0, 0, 0], {}, 'q Q');
      return a.getObject().asIndirect();
    }
    const a = find(op.num);
    if (op.type === 'edit') {
      if (op.text != null) a.setContents(String(op.text));
      if (op.color) a.setColor(rgb01(op.color));
      if ((op.dx || op.dy) && a.getType() === 'Text') { const r = a.getRect(); a.setRect([r[0] + op.dx, r[1] + op.dy, r[2] + op.dx, r[3] + op.dy]); }
      a.setModificationDate(new Date());
      a.update();
      return op.num;
    }
    if (op.type === 'delete') {
      // The comment goes with its replies and pop-up.
      const gone = new Set([op.num]);
      for (let grew = true; grew;) {
        grew = false;
        for (const x of page.getAnnotations()) { const t = x.getObject().get('IRT'), k = x.getObject().asIndirect(); if (!t.isNull() && gone.has(t.asIndirect()) && !gone.has(k)) { gone.add(k); grew = true; } }
      }
      for (const x of page.getAnnotations()) {
        const xo = x.getObject(), parent = xo.get('Parent');
        if (gone.has(xo.asIndirect()) || (x.getType() === 'Popup' && !parent.isNull() && gone.has(parent.asIndirect()))) page.deleteAnnotation(x);
      }
      return op.num;
    }
    throw new Error(`Unknown comment change ${op.type}`);
  });
  return { ...info(s), num };
}

// Links: a web address or a page of this document over an area of a page.
function links(id) {
  const s = get(id), out = [];
  for (let i = 0; i < s.doc.countPages(); i++) {
    s.doc.loadPage(i).getLinks().forEach((l, k) => {
      const external = l.isExternal();
      let to = null;
      if (!external) { try { to = s.doc.resolveLink(l); } catch (_) {} }
      out.push({ page: i, index: k, rect: l.getBounds(), url: external ? l.getURI() : '', toPage: to != null && to >= 0 ? to : null });
    });
  }
  return out;
}
const linkUri = (doc, op) => {
  if (op.toPage != null && op.toPage !== '') return doc.formatLinkURI({ chapter: 0, page: U.clamp(Number(op.toPage), 0, doc.countPages() - 1), type: 'Fit', x: 0, y: 0, width: 0, height: 0, zoom: 0 });
  const u = String(op.url || '').trim();
  if (!u) throw new Error('Enter a web address or a page for the link.');
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(u) ? `mailto:${u}` : `https://${u}`;
};
async function linkOp(id, op) {
  const s = get(id);
  const index = await mutate(s, (doc) => {
    const page = doc.loadPage(op.page), l = op.type === 'add' ? null : page.getLinks()[op.index];
    if (op.type === 'add') { page.createLink(op.rect, linkUri(doc, op)); return page.getLinks().length - 1; }
    if (!l) throw new Error('That link is no longer there.');
    if (op.type === 'delete') { page.deleteLink(l); return -1; }
    const rect = op.rect || l.getBounds(), uri = op.url != null || op.toPage != null ? linkUri(doc, op) : l.getURI();
    page.deleteLink(l);
    page.createLink(rect, uri);
    return page.getLinks().length - 1;
  });
  return { ...info(s), index };
}

// Bookmarks as a tree of { title, page, kids }; saving one rewrites the whole outline in that order.
function outline(id) {
  const s = get(id);
  const walk = (items) => (items || []).map((it) => {
    let page = it.page;
    if (page == null && it.uri) { try { page = s.doc.resolveLink(it.uri); } catch (_) {} }
    return { title: it.title || '', page: page != null && page >= 0 ? page : null, kids: walk(it.down) };
  });
  return walk(s.doc.loadOutline());
}
async function setOutline(id, tree) {
  const s = get(id);
  await mutate(s, (doc) => {
    const it = doc.outlineIterator();
    for (let k = 0; it.item() && k < 100000; k++) it.delete();
    const uri = (p) => doc.formatLinkURI({ chapter: 0, page: U.clamp(Number(p) || 0, 0, doc.countPages() - 1), type: 'Fit', x: 0, y: 0, width: 0, height: 0, zoom: 0 });
    const put = (items) => {
      for (const b of items || []) {
        it.insert({ title: String(b.title || 'Untitled'), uri: uri(b.page), open: true });
        if (b.kids?.length) { it.prev(); it.down(); put(b.kids); it.up(); it.next(); }
      }
    };
    put(tree);
  });
  return info(s);
}

// Paragraphs for editing as a whole: the lines of each text block, in order, with the look of the first line and the
// spacing between them.
async function paragraphs(id, index) {
  const s = get(id);
  const lines = await text(id, index), blocks = [];
  s.doc.loadPage(index).toStructuredText('preserve-whitespace').walk({ beginTextBlock(bbox) { blocks.push([...bbox]); } });
  const inside = (l, b) => { const cx = (l.bbox[0] + l.bbox[2]) / 2, cy = (l.bbox[1] + l.bbox[3]) / 2; return cx >= b[0] - 1 && cx <= b[2] + 1 && cy >= b[1] - 1 && cy <= b[3] + 1; };
  const taken = new Set(), out = [];
  blocks.forEach((b, k) => {
    const ls = lines.filter((l) => !taken.has(l.id) && l.editable && inside(l, b)).sort((p, q) => p.origin[1] - q.origin[1]);
    if (!ls.length) return;
    ls.forEach((l) => taken.add(l.id));
    const gaps = ls.slice(1).map((l, i) => l.origin[1] - ls[i].origin[1]).filter((g) => g > 0).sort((p, q) => p - q);
    const pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : ls[0].size * 1.2;
    const x0 = Math.min(...ls.map((l) => l.bbox[0])), x1 = Math.max(...ls.map((l) => l.bbox[2]));
    const lefts = ls.map((l) => l.bbox[0] - x0), rights = ls.map((l) => x1 - l.bbox[2]), mids = ls.map((l) => Math.abs((l.bbox[0] + l.bbox[2]) / 2 - (x0 + x1) / 2));
    const align = ls.length > 1 && Math.max(...lefts) > 3 && Math.max(...mids) < 2 ? 'center' : ls.length > 1 && Math.max(...lefts) > 3 && Math.max(...rights) < 2 ? 'right' : 'left';
    const words = ls.reduce((t, l, i) => (i ? (/-$/.test(t) ? `${t}${l.text.trim()}` : `${t} ${l.text.trim()}`) : l.text.trim()), '');
    const f = ls[0];
    out.push({ id: `${index}:p${k}`, lineIds: ls.map((l) => l.id), lines: ls.length, bbox: [x0, Math.min(...ls.map((l) => l.bbox[1])), x1, Math.max(...ls.map((l) => l.bbox[3]))],
      text: words, origin: [x0, f.origin[1]], size: f.size, font: f.font, bold: f.bold, italic: f.italic, serif: f.serif, mono: f.mono, color: f.color, lineHeight: Math.round((pitch / f.size) * 100) / 100, align });
  });
  return out;
}

// Form fields as their widgets on each page, with what the editor needs to show a matching input.
function fields(id) {
  const s = get(id), out = [];
  const js = (o, k) => { for (let d = o, n = 0; d && !d.isNull() && n < 4; d = d.get('Parent'), n++) { const a = d.get('AA').get(k).get('JS'); if (!a.isNull()) return a.isStream() ? a.readStream().asString() : a.asString(); } return ''; };
  for (let i = 0; i < s.doc.countPages(); i++) {
    for (const w of s.doc.loadPage(i).getWidgets()) {
      const type = { radiobutton: 'radio', combobox: 'combo', listbox: 'list' }[w.getFieldType()] || w.getFieldType();
      if (type === 'button') continue;
      const o = w.getObject();
      let on = '';
      try { const ap = o.get('AP').get('N'); if (ap.isDictionary() && !ap.isStream()) ap.forEach((v, k) => { if (k !== 'Off' && !on) on = k; }); } catch (_) {}
      let fmt = '';
      try { fmt = /AFDate_FormatEx\("([^"]+)"\)/.exec(js(o, 'F'))?.[1] || ''; } catch (_) {}
      out.push({
        id: `${i}:${o.asIndirect()}`, page: i, name: w.getName(), type, value: w.getValue(), rect: w.getRect(), on, date: fmt,
        options: ['combo', 'list'].includes(type) ? w.getOptions() : [], multiline: type === 'text' && w.isMultiline(), readOnly: w.isReadOnly(),
        maxLen: type === 'text' ? w.getMaxLen() : 0, required: !!(w.getFieldFlags() & 2),
      });
    }
  }
  return out;
}
// Typed-in values go through PdfCraft, which runs the form's own formats and draws each field so every viewer shows it.
async function fill(id, values) {
  const s = get(id);
  if (values && Object.keys(values).length) await craft(s, [{ tool: 'form_fill', args: { values } }], { label: 'Filling in the form' });
  return info(s);
}
// Prepare a form: add, change and delete fields, named and drawn as Acrobat does.
async function fieldOp(id, op) {
  const s = get(id);
  if (op.type === 'add') {
    const args = { page: op.page + 1, type: op.kind, rect: op.rect };
    for (const k of ['name', 'options', 'group', 'export', 'multiline']) if (op[k] != null && op[k] !== '') args[k] = op[k];
    const { results: [r] } = await craft(s, [{ tool: 'form_add_field', args }], { label: 'Adding a field' });
    return { ...info(s), field: r?.field };
  }
  if (op.type === 'set') {
    const p = op.props || {}, args = { field: op.field };
    if (p.name && p.name !== op.field) args.name = p.name;
    for (const k of ['rect', 'tooltip', 'read_only', 'required', 'multiline', 'options', 'font_size', 'max_length', 'format']) if (p[k] !== undefined) args[k] = p[k];
    await craft(s, [{ tool: 'form_set_props', args }], { label: 'Changing the field' });
    return { ...info(s), field: args.name || op.field };
  }
  if (op.type === 'delete') { await craft(s, [{ tool: 'form_delete_field', args: { field: op.field } }], { label: 'Deleting the field' }); return info(s); }
  if (op.type === 'flatten') { await craft(s, [{ tool: 'doc_flatten', args: { comments: !!op.comments, fields: op.fields !== false } }], { label: 'Flattening' }); return info(s); }
  if (op.type === 'reset') { await craft(s, [{ tool: 'form_reset', args: {} }], { label: 'Clearing the form' }); return info(s); }
  if (op.type === 'detect') {
    // Acrobat's automatic field detection: underscore runs, boxes and table cells become fields, named from their labels.
    const before = s.bytes, { results: [r] } = await craft(s, [{ tool: 'form_detect_fields', args: { add: true } }], { label: 'Finding blanks' });
    const added = r?.fields?.length || 0;
    if (!added && s.bytes !== before) { s.undo.pop(); await loadState(s, before); }
    return { ...info(s), added };
  }
  throw new Error(`Unknown field change ${op.type}`);
}

// Document properties and how the file opens.
async function props(id) {
  const s = get(id), d = s.doc;
  const meta = (k) => d.getMetaData(`info:${k}`) || '';
  let view = {};
  try { view = (await craft(s, [{ tool: 'doc_initial_view', args: {} }], { save: false })).results[0]?.initial_view || {}; } catch (_) {}
  // PdfCraft reports the view in its own names (SinglePageContinuous, Bookmarks, FitWidth); the editor uses the names
  // it takes (continuous, bookmarks, fit_width).
  const snake = (v, def) => String(v || def).replace(/CoverPage$/, 'Cover').replace(/^SinglePageContinuous$/, 'continuous').replace(/^SinglePage$/, 'single').replace(/^PageOnly$/, 'page').replace(/^ActualSize$/, 'actual')
    .replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  return { title: meta('Title'), author: meta('Author'), subject: meta('Subject'), keywords: meta('Keywords'), creator: meta('Creator'), producer: meta('Producer'), lang: view.language || '',
    layout: snake(view.layout, 'default'), navigation: snake(view.navigation, 'page'), magnification: typeof view.magnification === 'number' ? String(view.magnification) : snake(view.magnification, 'default'),
    page: view.page || 1, displayTitle: !!view.display_title, pages: d.countPages(), protected: !!s.password, version: d.getMetaData('format') || '' };
}
async function setProps(id, p) {
  const s = get(id);
  const steps = ['Title', 'Author', 'Subject', 'Keywords'].filter((k) => p[k.toLowerCase()] != null).map((k) => ({ tool: 'doc_set_info', args: { key: k, value: String(p[k.toLowerCase()]) } }));
  const view = {};
  if (p.layout) view.layout = p.layout;
  if (p.navigation) view.navigation = p.navigation;
  if (p.magnification) view.magnification = /^\d+$/.test(p.magnification) ? Number(p.magnification) : p.magnification;
  if (p.page) view.page = Number(p.page);
  if (p.displayTitle != null) view.display_title = !!p.displayTitle;
  if (p.lang) view.language = String(p.lang);
  if (Object.keys(view).length) steps.push({ tool: 'doc_initial_view', args: view });
  if (steps.length) await craft(s, steps, { label: 'Saving properties' });
  return info(s);
}

// Headers and footers, page numbers, Bates numbers, watermarks and backgrounds, with PdfCraft (so they can be
// replaced or removed later, in Lime or Acrobat). preview draws one page with the change, leaving the file as it is.
const pagesArg = (o, n) => { const list = U.parseRanges(o.pages || 'all', n).map((i) => i + 1); return list.length && list.length < n ? { pages: list } : {}; };
function docSteps(op, n) {
  const o = op.opts || {}, pages = pagesArg(o, n);
  if (op.kind === 'headerFooter' || op.kind === 'pageNumbers' || op.kind === 'bates') {
    const args = { replace: o.replace !== false, font_size: Number(o.size) || 10, ...(o.color ? { color: o.color } : {}), ...pages };
    if (o.margin != null && o.margin !== '') { const pt = Number(o.margin) * 2.834645669; args.margins = [pt, pt, Math.max(pt, 36), Math.max(pt, 36)]; }
    if (o.start && op.kind !== 'bates') args.start_number = Math.max(1, Number(o.start) || 1);
    if (op.kind === 'headerFooter') { for (const k of ['header_left', 'header_center', 'header_right', 'footer_left', 'footer_center', 'footer_right']) if (o[k]) args[k] = String(o[k]); }
    else {
      const token = op.kind === 'bates' ? `<<Bates Number#${U.clamp(Number(o.digits) || 6, 1, 12)}#${Math.max(1, Number(o.start) || 1)}#${String(o.prefix || '').replace(/#/g, '')}#${String(o.suffix || '').replace(/#/g, '')}>>`
        : { n: '<<1>>', page: 'Page <<1>>', of: '<<Page 1 of n>>', slash: '<<1/n>>' }[o.format] || '<<1>>';
      const [where, side] = String(o.position || 'footer-center').split('-');
      args[`${where === 'header' ? 'header' : 'footer'}_${side || 'center'}`] = token;
    }
    return [{ tool: 'doc_header_footer', args }];
  }
  if (op.kind === 'watermark') {
    const args = { opacity: U.clamp((Number(o.opacity) || 30) / 100, 0.02, 1), rotation: Number(o.rotation ?? 45), replace: o.replace !== false, behind: !!o.behind, ...pages };
    if (o.file) Object.assign(args, { file: o.file, scale: U.clamp((Number(o.scale) || 50) / 100, 0.05, 1) });
    else Object.assign(args, { text: String(o.text || 'CONFIDENTIAL'), color: o.color || '#d13438', ...(o.size ? { font_size: Number(o.size) } : {}) });
    return [{ tool: 'doc_watermark', args }];
  }
  if (op.kind === 'background') return [{ tool: 'doc_background', args: { replace: o.replace !== false, opacity: U.clamp((Number(o.opacity) || 100) / 100, 0.02, 1), ...(o.file ? { file: o.file, scale: U.clamp((Number(o.scale) || 100) / 100, 0.05, 1) } : { color: o.color || '#fff4ce' }), ...pages } }];
  if (op.kind === 'remove') return [{ tool: 'doc_remove_marks', args: { kind: o.what } }];
  if (op.kind === 'labels') return [{ tool: 'page_number', args: { from: Number(o.from) || 1, to: Number(o.to) || n, style: o.style || 'decimal', ...(o.prefix ? { prefix: String(o.prefix) } : {}), start: Math.max(1, Number(o.start) || 1) } }];
  throw new Error(`Unknown change ${op.kind}`);
}
async function docOp(id, op) {
  const s = get(id);
  await craft(s, docSteps(op, s.doc.countPages()), { label: 'Updating pages' });
  return info(s);
}
async function preview(id, op, index, scale) {
  const s = get(id);
  const { bytes } = await craft(s, docSteps(op, s.doc.countPages()), { preview: true });
  const m = await P.mupdf();
  const page = m.Document.openDocument(bytes, 'application/pdf').loadPage(U.clamp(index, 0, s.doc.countPages() - 1));
  return Buffer.from(page.toPixmap(m.Matrix.scale(scale, scale), m.ColorSpace.DeviceRGB, false, true).asPNG());
}
// Checks on the working copy: accessibility or print readiness, as the wheel's tools report them.
async function check(id, kind) {
  const s = get(id);
  const dir = await U.tmpDir('edcheck'), f = path.join(dir, path.basename(s.path));
  try {
    await fsp.writeFile(f, s.bytes);
    const C = require('./engines/crafts'), ctx = { progress: () => {}, out: { file: (p, name) => path.join(dir, name) } };
    return kind === 'print' ? await C.printCheck(f, {}, ctx) : await C.accessCheck(f, {}, ctx);
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
// Recognise text on scanned pages: the words go over the page as invisible text, so it can be searched, copied and
// edited, while the page itself stays as it was (Acrobat's Recognize Text).
async function recognise(id, { lang = 'eng', all = false } = {}) {
  const s = get(id);
  const m = await P.mupdf();
  const ocr = require('./engines/ocr');
  const doc = await PDFDocument.load(s.bytes, { updateMetadata: false });
  let done = 0, words = 0;
  for (let i = 0; i < s.doc.countPages(); i++) {
    const page = s.doc.loadPage(i);
    if (!all && page.toStructuredText('').asText().trim().length > 40) continue;
    const b = page.getBounds(), w = b[2] - b[0], h = b[3] - b[1];
    const png = Buffer.from(page.toPixmap(m.Matrix.scale(300 / 72, 300 / 72), m.ColorSpace.DeviceRGB, false, true).asPNG());
    const res = await ocr.imageToTextPdf(png, lang);
    if (!res.text.trim()) continue;
    const [layer] = await doc.embedPdf(res.pdf, [0]);
    // Drawn over the page as it is shown, whatever its rotation.
    const inv = m.Matrix.invert(page.getTransform()), map = (u, v) => [u * inv[0] + v * inv[2] + inv[4], u * inv[1] + v * inv[3] + inv[5]];
    const [ax, ay] = map(0, h), pg = doc.getPage(i);
    pg.drawPage(layer, { x: ax, y: ay, width: w, height: h, rotate: degrees((Math.atan2(inv[1], inv[0]) * 180) / Math.PI) });
    done++;
    words += res.text.split(/\s+/).filter(Boolean).length;
  }
  if (done) { pushUndo(s); await loadState(s, await doc.save({ useObjectStreams: true })); }
  return { ...info(s), recognised: done, words };
}
// Text to redact: every match of the words, or of the patterns the Redact tool offers, as a box per match.
async function findRedact(id, { terms = [], patterns = [] } = {}) {
  const s = get(id);
  const m = await P.mupdf();
  const RX = { email: /[\w.+-]+@[\w-]+\.[\w.-]+/g, phone: /\+?\d[\d\s().-]{7,}\d/g, card: /\b(?:\d[ -]?){13,19}\b/g, iban: /\b[A-Z]{2}\d{2}[A-Z0-9 ]{11,30}\b/g, date: /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}\b/g };
  const out = [];
  for (let i = 0; i < s.doc.countPages(); i++) {
    const page = s.doc.loadPage(i);
    for (const t of terms.map((x) => String(x).trim()).filter(Boolean)) for (const quads of page.search(t)) for (const q of quads) out.push({ page: i, rect: P.quadRect(q), text: t });
    if (!patterns.length) continue;
    for (const line of P.extractLines(m, page)) {
      for (const k of patterns) {
        const re = RX[k];
        if (!re) continue;
        re.lastIndex = 0;
        for (let mm = re.exec(line.text); mm; mm = re.exec(line.text)) {
          const chars = line.chars.slice(mm.index, mm.index + mm[0].length);
          if (chars.length) out.push({ page: i, text: mm[0], rect: chars.map((c) => P.quadRect(c.quad)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]) });
        }
      }
    }
  }
  return out;
}
function close(id) { sessions.delete(id); return true; }

module.exports = { open, render, patch, objects, fonts, text, search, apply, pageOp, undo, redo, save, exportPages, close,
  annots, annotOp, links, linkOp, outline, setOutline, paragraphs, fields, fill, fieldOp, props, setProps, docOp, preview, check, findRedact, recognise };
