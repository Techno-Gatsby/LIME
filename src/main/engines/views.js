'use strict';
// 2D drawings of 3D models the way FreeCAD's TechDraw lays out a projection group: front, top and side views (first or
// third angle) and an isometric view on a sheet with a frame and a title block, at a standard scale, with hidden lines
// dashed. Edges come from the mesh: B-rep face boundaries (or creases, for plain meshes), open edges and each view's
// outline; each is cut where triangles nearer the viewer cover it.
const U = require('./util');
const { fsp, path } = U;
const cad = require('./cad');
const M = require('./mesh');

const SHEETS = { a4: [297, 210], a3: [420, 297], a2: [594, 420], a1: [841, 594], letter: [279.4, 215.9], tabloid: [431.8, 279.4] };
const SCALES = [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0005, 0.0002, 0.0001];
const r3 = 1 / Math.sqrt(3), r2 = Math.SQRT1_2;
const DIRS = { front: { d: [0, -1, 0], r: [1, 0, 0] }, top: { d: [0, 0, 1], r: [1, 0, 0] }, right: { d: [1, 0, 0], r: [0, 1, 0] }, left: { d: [-1, 0, 0], r: [0, -1, 0] }, iso: { d: [r3, -r3, r3], r: [r2, r2, 0] } };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const MAX_TRIS = 250000;

function prepare(m0) {
  let m = M.weld(m0, 1e-7);
  if (m.idx.length / 3 > MAX_TRIS) m = M.simplify(m, MAX_TRIS / (m.idx.length / 3));
  const P = Float64Array.from(m.pos), T = m.idx, nt = T.length / 3, nv = P.length / 3, N = new Float64Array(nt * 3);
  const faces = m.faces?.length === nt ? m.faces : null;
  for (let t = 0; t < nt; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const n = crs([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]), l = Math.hypot(...n);
    if (l > 0) { N[t * 3] = n[0] / l; N[t * 3 + 1] = n[1] / l; N[t * 3 + 2] = n[2] / l; }
  }
  const map = new Map();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3];
    if (a === b) continue;
    const key = a < b ? a * nv + b : b * nv + a, l = map.get(key);
    if (l) l.push(t); else map.set(key, [t]);
  }
  // Creases: a real edge between two B-rep faces, or a fold sharper than a curved surface's facets.
  // Where bodies touch, an edge has more triangles; faces lying back to back there don't make it an edge.
  const crease = Math.cos(((faces ? 16 : 30) * Math.PI) / 180), E = [];
  const folds = (t, u) => { const c = N[t * 3] * N[u * 3] + N[t * 3 + 1] * N[u * 3 + 1] + N[t * 3 + 2] * N[u * 3 + 2]; return c > -0.999 && c < crease && (!faces || faces[t] !== faces[u]); };
  for (const [key, l] of map) {
    const a = Math.floor(key / nv), b = key - a * nv;
    E.push({ a, b, t1: l[0], t2: l.length === 2 ? l[1] : -1, tris: l, hard: l.length === 1 || l.some((t, i) => l.some((u, j) => j > i && folds(t, u))) });
  }
  return { P, T, N, E, nt, diag: M.box(m.pos).diag };
}

// One view: the edges that show, cut into the pieces seen and the pieces behind triangles nearer the viewer.
function project(md, dir, withHidden) {
  const { P, T, N, E, nt, diag } = md, d = dir.d, r = dir.r, up = crs(d, r), nv = P.length / 3;
  const X = new Float64Array(nv), Y = new Float64Array(nv), Z = new Float64Array(nv);
  for (let i = 0; i < nv; i++) { const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; X[i] = dot(p, r); Y[i] = dot(p, up); Z[i] = dot(p, d); }
  const facing = new Float64Array(nt);
  for (let t = 0; t < nt; t++) facing[t] = N[t * 3] * d[0] + N[t * 3 + 1] * d[1] + N[t * 3 + 2] * d[2];
  const edges = E.filter((e) => e.hard || (e.t2 >= 0 && facing[e.t1] * facing[e.t2] < -1e-12) || (e.t2 >= 0 && (Math.abs(facing[e.t1]) < 1e-9) !== (Math.abs(facing[e.t2]) < 1e-9)));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < nv; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); y0 = Math.min(y0, Y[i]); y1 = Math.max(y1, Y[i]); }
  const eps2 = diag * 1e-7, epsZ = diag * 1e-6;
  // Triangles that cover anything in this view, in a grid.
  const occ = [];
  for (let t = 0; t < nt; t++) { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2], ar = (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]); if (Math.abs(ar) > eps2 * eps2) occ.push(t); }
  const G = Math.max(4, Math.min(400, Math.round(Math.sqrt(occ.length) * 0.7))), cw = (x1 - x0) / G || 1, ch = (y1 - y0) / G || 1;
  const cells = Array.from({ length: G * G }, () => []), cx = (x) => Math.min(G - 1, Math.max(0, Math.floor((x - x0) / cw))), cy = (y) => Math.min(G - 1, Math.max(0, Math.floor((y - y0) / ch)));
  for (const t of occ) {
    const v = [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]], i0 = cx(Math.min(...v.map((i) => X[i]))), i1 = cx(Math.max(...v.map((i) => X[i]))), j0 = cy(Math.min(...v.map((i) => Y[i]))), j1 = cy(Math.max(...v.map((i) => Y[i])));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * G + i].push(t);
  }
  const stamp = new Int32Array(nt).fill(-1), vis = [], hid = [];
  edges.forEach((e, ei) => {
    const ax = X[e.a], ay = Y[e.a], az = Z[e.a], bx = X[e.b], by = Y[e.b], bz = Z[e.b], len = Math.hypot(bx - ax, by - ay);
    if (len < eps2) return;
    const covered = [];
    // The cells along the segment.
    const walk = (fn) => {
      let i = cx(ax), j = cy(ay);
      const i1 = cx(bx), j1 = cy(by), dx = bx - ax, dy = by - ay, sx = Math.sign(dx), sy = Math.sign(dy);
      let tx = dx ? ((x0 + (i + (sx > 0 ? 1 : 0)) * cw) - ax) / dx : Infinity, ty = dy ? ((y0 + (j + (sy > 0 ? 1 : 0)) * ch) - ay) / dy : Infinity;
      const ddx = dx ? Math.abs(cw / dx) : Infinity, ddy = dy ? Math.abs(ch / dy) : Infinity;
      for (let guard = 0; guard < 4 * G + 4; guard++) {
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < G && jj < G) fn(cells[jj * G + ii]); }
        if (i === i1 && j === j1) break;
        if (tx < ty) { tx += ddx; i += sx; } else { ty += ddy; j += sy; }
        if (i < 0 || j < 0 || i >= G || j >= G) break;
      }
    };
    walk((list) => {
      for (const t of list) {
        if (stamp[t] === ei || e.tris.includes(t)) continue;
        stamp[t] = ei;
        let p = [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]];
        if (Math.max(Z[p[0]], Z[p[1]], Z[p[2]]) < Math.min(az, bz) + epsZ) continue;
        let ar = (X[p[1]] - X[p[0]]) * (Y[p[2]] - Y[p[0]]) - (Y[p[1]] - Y[p[0]]) * (X[p[2]] - X[p[0]]);
        if (ar < 0) { p = [p[0], p[2], p[1]]; ar = -ar; }
        let t0 = 0, t1 = 1;
        for (let k = 0; k < 3 && t0 < t1; k++) {
          const i = p[k], j = p[(k + 1) % 3], ex = X[j] - X[i], ey = Y[j] - Y[i], el = Math.hypot(ex, ey);
          const fa = (ex * (ay - Y[i]) - ey * (ax - X[i])) / el, fb = (ex * (by - Y[i]) - ey * (bx - X[i])) / el;
          if (fa === fb) { if (fa <= eps2) t1 = -1; continue; }
          const tc = (eps2 - fa) / (fb - fa);
          if (fb > fa) t0 = Math.max(t0, tc); else t1 = Math.min(t1, tc);
        }
        if (t0 >= t1) continue;
        const zt = (qx, qy) => { const l0 = ((X[p[1]] - qx) * (Y[p[2]] - qy) - (Y[p[1]] - qy) * (X[p[2]] - qx)) / ar, l1 = ((X[p[2]] - qx) * (Y[p[0]] - qy) - (Y[p[2]] - qy) * (X[p[0]] - qx)) / ar; return l0 * Z[p[0]] + l1 * Z[p[1]] + (1 - l0 - l1) * Z[p[2]]; };
        const ga = zt(ax, ay) - az, gb = zt(bx, by) - bz;
        if (ga === gb) { if (ga <= epsZ) continue; } else { const tc = (epsZ - ga) / (gb - ga); if (gb > ga) t0 = Math.max(t0, tc); else t1 = Math.min(t1, tc); }
        if (t0 < t1) covered.push([t0, t1]);
      }
    });
    covered.sort((p, q) => p[0] - q[0]);
    const at = (t) => [ax + (bx - ax) * t, ay + (by - ay) * t];
    let s = 0;
    for (const [c0, c1] of covered) {
      if (c0 > s) vis.push([...at(s), ...at(c0)]);
      if (withHidden && c1 > Math.max(s, c0)) hid.push([...at(Math.max(s, c0)), ...at(c1)]);
      s = Math.max(s, c1);
    }
    if (s < 1) vis.push([...at(s), ...at(1)]);
  });
  const tol = diag * 1e-6, lines = overlap(vis, hid, tol, diag * 1e-5);
  return { vis: chain(lines.vis, tol), hid: chain(lines.hid, tol), box: [x0, y0, x1, y1] };
}
// Pieces on one line are merged where they overlap, and a hidden piece under a visible one goes: the far side of a box
// lies exactly behind its near side.
function overlap(vis, hid, tol, min) {
  const groups = new Map();
  const add = (q, kind) => {
    let dx = q[2] - q[0], dy = q[3] - q[1];
    const l = Math.hypot(dx, dy);
    if (l <= min) return;
    dx /= l; dy /= l;
    if (dx < -1e-12 || (Math.abs(dx) <= 1e-12 && dy < 0)) { dx = -dx; dy = -dy; }
    const c = dx * q[1] - dy * q[0], k = `${Math.round(Math.atan2(dy, dx) * 1e6)},${Math.round(c / tol)}`, t0 = dx * q[0] + dy * q[1], t1 = dx * q[2] + dy * q[3];
    if (!groups.has(k)) groups.set(k, { dx, dy, c, vis: [], hid: [] });
    groups.get(k)[kind].push([Math.min(t0, t1), Math.max(t0, t1)]);
  };
  vis.forEach((q) => add(q, 'vis')); hid.forEach((q) => add(q, 'hid'));
  const join = (iv) => { iv.sort((a, b) => a[0] - b[0]); const out = []; for (const [a, b] of iv) { const last = out[out.length - 1]; if (last && a <= last[1] + tol) last[1] = Math.max(last[1], b); else out.push([a, b]); } return out; };
  const res = { vis: [], hid: [] };
  for (const g of groups.values()) {
    const at = (t) => [g.dx * t - g.dy * g.c, g.dy * t + g.dx * g.c], shown = join(g.vis);
    for (const [a, b] of shown) res.vis.push([...at(a), ...at(b)]);
    for (let [a, b] of join(g.hid)) {
      for (const [p, q] of shown) { if (q <= a || p >= b) continue; if (p > a + min) res.hid.push([...at(a), ...at(p)]); a = Math.max(a, q); }
      if (b - a > min) res.hid.push([...at(a), ...at(b)]);
    }
  }
  return res;
}
const ptKey = (x, y, tol) => `${Math.round(x / tol)},${Math.round(y / tol)}`;
const segKey = (a, b, tol) => { const p = ptKey(a.x, a.y, tol), q = ptKey(b.x, b.y, tol); return p < q ? `${p}|${q}` : `${q}|${p}`; };
// Segments joined end to end into polylines, doubles dropped, straight runs made one line.
function chain(segs, tol) {
  const uniq = new Map();
  for (const s of segs) { const a = { x: s[0], y: s[1] }, b = { x: s[2], y: s[3] }, k = segKey(a, b, tol); if (!uniq.has(k)) uniq.set(k, [a, b]); }
  const list = [...uniq.values()], at = new Map(), used = new Uint8Array(list.length);
  list.forEach(([a, b], i) => { for (const p of [a, b]) { const k = ptKey(p.x, p.y, tol); if (!at.has(k)) at.set(k, []); at.get(k).push(i); } });
  const lines = [], next = (p) => (at.get(ptKey(p.x, p.y, tol)) || []).find((i) => !used[i]);
  const grow = (pl) => { for (let i = next(pl[pl.length - 1]); i != null; i = next(pl[pl.length - 1])) { used[i] = 1; const [a, b] = list[i]; pl.push(ptKey(a.x, a.y, tol) === ptKey(pl[pl.length - 1].x, pl[pl.length - 1].y, tol) ? b : a); } };
  const order = list.map((_, i) => i).sort((i, j) => (at.get(ptKey(list[i][0].x, list[i][0].y, tol)).length === 2) - (at.get(ptKey(list[j][0].x, list[j][0].y, tol)).length === 2));
  for (const i of order) {
    if (used[i]) continue;
    used[i] = 1;
    const pl = [list[i][0], list[i][1]];
    grow(pl); pl.reverse(); grow(pl);
    const out = [pl[0]];
    for (let k = 1; k < pl.length - 1; k++) { const a = out[out.length - 1], b = pl[k], c = pl[k + 1], cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); if (Math.abs(cr) > tol * Math.hypot(c.x - a.x, c.y - a.y) || (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) <= 0) out.push(b); }
    out.push(pl[pl.length - 1]);
    lines.push(out);
  }
  return lines;
}

// Where each view goes: first angle puts the top view under the front and the view from the left on its right;
// third angle puts the top view above and the view from the right on the right.
function arrangement(views, angle) {
  if (views === 'front') return [{ name: 'front', col: 0, row: 0 }];
  if (views === 'iso') return [{ name: 'iso', col: 0, row: 0 }];
  const first = angle !== 'third', out = first
    ? [{ name: 'front', col: 0, row: 0 }, { name: 'left', col: 1, row: 0 }, { name: 'top', col: 0, row: 1 }, { name: 'iso', col: 1, row: 1 }]
    : [{ name: 'top', col: 0, row: 0 }, { name: 'iso', col: 1, row: 0 }, { name: 'front', col: 0, row: 1 }, { name: 'right', col: 1, row: 1 }];
  return views === 'three' ? out.filter((v) => v.name !== 'iso') : out;
}

async function drawing(m, src, opts = {}, ctx = {}) {
  const to = opts.to || 'pdf', sheetName = SHEETS[opts.sheet] ? opts.sheet : 'a3', [W, H] = SHEETS[sheetName], small = W < 300;
  ctx.progress?.(0.15, 'Finding edges');
  const md = prepare(m), list = arrangement(opts.views || 'four', opts.angle);
  const views = list.map((v, i) => { ctx.progress?.(0.2 + (0.5 * i) / list.length, `${v.name[0].toUpperCase()}${v.name.slice(1)} view`); return { ...v, ...project(md, DIRS[v.name], opts.hidden !== false && v.name !== 'iso') }; });
  // Frame 20 mm from the left edge (for filing) and 10 mm from the others; the title block sits in its bottom-right corner.
  const F = { x0: 20, y0: 10, x1: W - 10, y1: H - 10 }, TB = { w: Math.min(180, F.x1 - F.x0), h: 32 }, gap = small ? 12 : 18;
  const area = { x0: F.x0 + 6, y0: F.y0 + TB.h + 6, x1: F.x1 - 6, y1: F.y1 - 6 };
  const cols = Math.max(...views.map((v) => v.col)) + 1, rows = Math.max(...views.map((v) => v.row)) + 1;
  const vw = (v) => v.box[2] - v.box[0], vh = (v) => v.box[3] - v.box[1];
  const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...views.filter((v) => v.col === c).map(vw))), rowH = Array.from({ length: rows }, (_, r) => Math.max(0, ...views.filter((v) => v.row === r).map(vh)));
  const fit = Math.min((area.x1 - area.x0 - gap * (cols - 1)) / (colW.reduce((a, b) => a + b, 0) || 1), (area.y1 - area.y0 - gap * (rows - 1)) / (rowH.reduce((a, b) => a + b, 0) || 1));
  let S = Number(opts.scale) || 0;
  if (S && S > fit * 1.0001) throw new Error(`At ${scaleText(S)} the views don’t fit on ${sheetName.toUpperCase()}. Choose a smaller scale or a bigger sheet.`);
  if (!S) S = SCALES.find((s) => s <= fit) || fit;
  const totalW = colW.reduce((a, b) => a + b, 0) * S + gap * (cols - 1), totalH = rowH.reduce((a, b) => a + b, 0) * S + gap * (rows - 1);
  const left = (area.x0 + area.x1 - totalW) / 2, top = (area.y0 + area.y1 + totalH) / 2;
  const items = [], vlw = small ? 0.35 : 0.5, hlw = small ? 0.18 : 0.25;
  for (const v of views) {
    const cellX = left + colW.slice(0, v.col).reduce((a, b) => a + b, 0) * S + gap * v.col, cellY = top - rowH.slice(0, v.row).reduce((a, b) => a + b, 0) * S - gap * v.row;
    const ox = cellX + (colW[v.col] * S - vw(v) * S) / 2 - v.box[0] * S, oy = cellY - rowH[v.row] * S + (rowH[v.row] * S - vh(v) * S) / 2 - v.box[1] * S;
    const place = (pl) => pl.map((p) => ({ x: ox + p.x * S, y: oy + p.y * S }));
    for (const pl of v.hid) items.push({ k: 'line', pts: place(pl), lw: hlw, dash: [3, 1.5], layer: 'Hidden' });
    for (const pl of v.vis) items.push({ k: 'line', pts: place(pl), lw: vlw, layer: 'Visible' });
  }
  titleBlock(items, F, TB, { title: String(opts.title || '').trim() || U.base(src), file: path.basename(src), scale: scaleText(S), sheet: sheetName.toUpperCase(), angle: opts.angle === 'third' ? 'third' : 'first' });
  ctx.progress?.(0.8, `Writing ${to.toUpperCase()}`);
  const out = ctx.out.file(src, `${U.base(src)} - drawing.${to}`);
  if (to === 'svg') await fsp.writeFile(out, sheetSvg(items, W, H));
  else if (to === 'dxf') await fsp.writeFile(out, sheetDxf(items));
  else if (to === 'png') await require('sharp')(Buffer.from(sheetSvg(items, W, H, 200 / 25.4)), { density: 72 }).flatten({ background: '#ffffff' }).png().toFile(out);
  else await sheetPdf(items, W, H, out);
  return { path: out, note: `${views.length} view${views.length > 1 ? 's' : ''} at ${scaleText(S)} on ${sheetName.toUpperCase()}` };
}
const scaleText = (s) => (s >= 1 ? `${+s.toFixed(3)}:1` : `1:${+(1 / s).toFixed(3)}`);

function titleBlock(items, F, TB, info) {
  const x1 = F.x1, y0 = F.y0, x0 = x1 - TB.w, y1 = y0 + TB.h, mid = y0 + 16;
  const line = (pts, lw = 0.35, layer = 'Title') => items.push({ k: 'line', pts: pts.map(([x, y]) => ({ x, y })), lw, layer });
  const txt = (x, y, h, text, anchor = 'start') => items.push({ k: 'text', p: { x, y }, h, text, anchor, layer: 'Text' });
  line([[F.x0, F.y0], [F.x1, F.y0], [F.x1, F.y1], [F.x0, F.y1], [F.x0, F.y0]], 0.7, 'Frame');
  line([[x0, y0], [x0, y1], [x1, y1]], 0.5);
  line([[x0, mid], [x1, mid]]);
  const w = TB.w, sx = x0 + w * 0.72, c = [x0, x0 + w * 0.36, x0 + w * 0.5, x0 + w * 0.72, x1];
  line([[sx, mid], [sx, y1]]);
  for (const x of c.slice(1, -1)) line([[x, y0], [x, mid]], 0.25);
  const label = (x, y, t) => txt(x + 1.5, y - 3, 2, t);
  label(x0, y1, 'Title'); txt(x0 + 3, mid + 4, 6, fitText(info.title, (sx - x0 - 6) / (6 * 0.6)));
  label(sx, y1, 'Scale'); txt((sx + x1) / 2, mid + 4, 5, info.scale, 'middle');
  label(c[0], mid, 'File'); txt(c[0] + 2, y0 + 4, 3, fitText(info.file, (c[1] - c[0] - 4) / (3 * 0.6)));
  label(c[1], mid, 'Units'); txt((c[1] + c[2]) / 2, y0 + 4, 3.5, 'mm', 'middle');
  label(c[2], mid, 'Projection'); symbol(items, (c[2] + c[3]) / 2, y0 + 6, info.angle);
  label(c[3], mid, 'Sheet'); txt(c[3] + 2, y0 + 7.5, 3.5, info.sheet); txt(c[3] + 2, y0 + 2.5, 2, `${new Date().toISOString().slice(0, 10)} · Lime`);
}
const fitText = (s, n) => (s.length > n ? `${s.slice(0, Math.max(1, Math.floor(n) - 1))}…` : s);
// ISO 5456-2's truncated cone: circles on the left for first angle, on the right for third.
function symbol(items, cx, cy, angle) {
  const R = 3, gapX = 3, cone = [[0, -R], [6, -R / 2], [6, R / 2], [0, R]], first = angle === 'first';
  const circleX = first ? cx - (6 + gapX) / 2 - R / 2 : cx + (6 + gapX) / 2 + R / 2, coneX = first ? circleX + R + gapX : circleX - R - gapX - 6;
  items.push({ k: 'circle', c: { x: circleX, y: cy }, r: R, lw: 0.25, layer: 'Title' }, { k: 'circle', c: { x: circleX, y: cy }, r: R / 2, lw: 0.25, layer: 'Title' });
  items.push({ k: 'line', pts: [...cone, cone[0]].map(([x, y]) => ({ x: coneX + x, y: cy + y })), lw: 0.25, layer: 'Title' });
}

const f3 = (n) => String(Math.round(n * 1000) / 1000);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function sheetSvg(items, W, H, px) {
  const parts = [`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`];
  for (const it of items) {
    if (it.k === 'line') parts.push(`<path d="M${it.pts.map((p) => `${f3(p.x)},${f3(H - p.y)}`).join('L')}" fill="none" stroke="#000000" stroke-width="${it.lw}"${it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : ''} class="${it.layer}"/>`);
    else if (it.k === 'circle') parts.push(`<circle cx="${f3(it.c.x)}" cy="${f3(H - it.c.y)}" r="${it.r}" fill="none" stroke="#000000" stroke-width="${it.lw}" class="${it.layer}"/>`);
    else if (it.k === 'text') parts.push(`<text x="${f3(it.p.x)}" y="${f3(H - it.p.y)}" font-size="${it.h}" text-anchor="${it.anchor}" fill="#000000" font-family="Helvetica, Arial, sans-serif">${esc(it.text)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px ? Math.round(W * px) : `${W}mm`}" height="${px ? Math.round(H * px) : `${H}mm`}" viewBox="0 0 ${W} ${H}"><g stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</g></svg>`;
}
async function sheetPdf(items, W, H, out) {
  const { PDFDocument, rgb } = require('pdf-lib'), k = 72 / 25.4, doc = await PDFDocument.create();
  doc.setCreator('Lime');
  const page = doc.addPage([W * k, H * k]), fontFor = await cad.textFonts(doc), black = rgb(0, 0, 0);
  for (const it of items) {
    if (it.k === 'line') page.drawSvgPath(`M${it.pts.map((p) => `${f3(p.x * k)} ${f3((H - p.y) * k)}`).join(' L')}`, { x: 0, y: H * k, borderColor: black, borderWidth: it.lw * k, borderLineCap: 1, ...(it.dash ? { borderDashArray: it.dash.map((v) => v * k) } : {}) });
    else if (it.k === 'circle') page.drawCircle({ x: it.c.x * k, y: it.c.y * k, size: it.r * k, borderColor: black, borderWidth: it.lw * k });
    else if (it.k === 'text') {
      const size = it.h * k, runs = [];
      for (let ch of it.text) {
        let f = await fontFor(ch);
        if (!f) { ch = '?'; f = await fontFor('?'); }
        if (runs.length && runs[runs.length - 1].font === f) runs[runs.length - 1].text += ch; else runs.push({ font: f, text: ch });
      }
      const width = runs.reduce((s, r) => s + r.font.widthOfTextAtSize(r.text, size), 0);
      let x = it.p.x * k - (it.anchor === 'middle' ? width / 2 : it.anchor === 'end' ? width : 0);
      for (const r of runs) { page.drawText(r.text, { x, y: it.p.y * k, size, font: r.font, color: black }); x += r.font.widthOfTextAtSize(r.text, size); }
    }
  }
  await fsp.writeFile(out, await doc.save());
  return out;
}
function sheetDxf(items) {
  const layers = [{ name: 'Visible', color: 7, lw: 0.5 }, { name: 'Hidden', color: 8, lt: 'HIDDEN', lw: 0.25 }, { name: 'Frame', color: 7, lw: 0.7 }, { name: 'Title', color: 7, lw: 0.35 }, { name: 'Text', color: 7, lw: 0.25 }];
  const ents = [];
  for (const it of items) {
    if (it.k === 'line') ents.push(it.pts.length === 2 ? { t: 'line', a: it.pts[0], b: it.pts[1], layer: it.layer, lw: it.lw } : { t: 'poly', pts: it.pts, layer: it.layer, lw: it.lw });
    else if (it.k === 'circle') ents.push({ t: 'circle', c: it.c, r: it.r, layer: it.layer, lw: it.lw });
    else if (it.k === 'text') ents.push({ t: 'text', p: it.p, h: it.h, text: it.text, align: { start: 0, middle: 1, end: 2 }[it.anchor], layer: it.layer });
  }
  return require('./dxf').write({ layers, ltypes: [{ name: 'HIDDEN', desc: 'Hidden __ __ __', pattern: [3, -1.5] }], ents, units: 4 });
}

module.exports = { drawing, prepare, project, chain, SHEETS };
