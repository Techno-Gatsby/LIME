'use strict';
// Mesh clean-up, placement, simplification and the mesh formats FreeCAD's Mesh workbench writes that Lime didn't.
const { mesh, spans, palette, ck, alpha8, hex } = require('./cad');

const UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
const g = (v) => String(+(+v).toPrecision(9));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Each triangle's colour span, so triangles can be dropped and the spans rebuilt in order.
function triParts(m) { const tp = new Int32Array(m.idx.length / 3); spans(m).forEach((s, k) => tp.fill(k, s.start / 3, s.end / 3)); return tp; }
function rebuild(m, pos, idx, tp, faces) {
  const src = spans(m), parts = [];
  for (let t = 0; t < tp.length; t++) if (!t || tp[t] !== tp[t - 1]) { const { color, alpha } = src[tp[t]]; parts.push({ start: t * 3, color, ...(alpha < 1 ? { alpha } : {}) }); }
  const out = mesh(pos, idx, parts.some((p) => p.color != null) ? parts : null);
  if (faces) out.faces = faces;
  return out;
}
function box(pos) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  return { mn, mx, diag: Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1 };
}

// Scale (per cent) about the origin, after moving the model's box centre to the origin ('centre') or its base centre ('floor').
function place(m, { scale = 100, centre = '' } = {}) {
  const k = (Number(scale) || 100) / 100;
  if (k === 1 && !centre) return m;
  const { mn, mx } = box(m.pos), off = centre ? [-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, centre === 'floor' ? -mn[2] : -(mn[2] + mx[2]) / 2] : [0, 0, 0];
  const pos = new Float32Array(m.pos.length);
  for (let i = 0; i < pos.length; i++) pos[i] = (m.pos[i] + off[i % 3]) * k;
  return { ...m, pos };
}
const inUnits = (m, u) => (UNITS[u] && UNITS[u] !== 1 ? { ...m, pos: m.pos.map((v) => v / UNITS[u]) } : m);

// Points closer than tol become one, found through a grid so neighbours across a cell wall still meet.
function weldPoints(pos, tol) {
  const n = pos.length / 3, map = new Int32Array(n), cells = new Map(), out = [], inv = 1 / tol;
  const key = (x, y, z) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
    let hit = -1;
    for (let dx = -1; dx <= 1 && hit < 0; dx++) for (let dy = -1; dy <= 1 && hit < 0; dy++) for (let dz = -1; dz <= 1 && hit < 0; dz++) {
      for (const j of cells.get(key(cx + dx, cy + dy, cz + dz)) || []) if (Math.abs(out[j * 3] - x) <= tol && Math.abs(out[j * 3 + 1] - y) <= tol && Math.abs(out[j * 3 + 2] - z) <= tol) { hit = j; break; }
    }
    if (hit < 0) { hit = out.length / 3; out.push(x, y, z); const k = key(cx, cy, cz); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(hit); }
    map[i] = hit;
  }
  return { pos: Float32Array.from(out), map };
}
function weld(m, rel = 1e-6) {
  const { pos, map } = weldPoints(m.pos, Math.max(box(m.pos).diag * rel, 1e-9));
  return { ...m, pos, idx: m.idx.map((i) => map[i]) };
}

const sub = (P, a, b) => [P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);

// FreeCAD's "Evaluate and repair" basics: merge duplicate points, split away degenerate triangles, drop duplicate
// triangles (both of an opposed pair, which is a fin of no thickness), and turn every piece's triangles one way, outwards.
function repair(m0) {
  const before = { v: m0.pos.length / 3, t: m0.idx.length / 3 };
  const m = weld(m0), P = m.pos, diag = box(P).diag;
  let T = Array.from({ length: m.idx.length / 3 }, (_, t) => [m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]]), tp = Array.from(triParts(m));
  const report = { points: before.v - P.length / 3, degenerate: 0, duplicates: 0, flipped: 0 };
  // A sliver whose corner lies on its longest edge: remove it and split the neighbour across that edge at the corner.
  const area2 = (t) => len(cross(sub(P, t[1], t[0]), sub(P, t[2], t[0])));
  for (let pass = 0; pass < 4; pass++) {
    const edges = new Map();
    T.forEach((t, i) => { if (t) for (let k = 0; k < 3; k++) edges.set(`${t[k]},${t[(k + 1) % 3]}`, i); });
    let changed = false;
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      if (!t) continue;
      if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) { T[i] = null; report.degenerate++; changed = true; continue; }
      const L = [0, 1, 2].map((k) => len(sub(P, t[(k + 1) % 3], t[k])));
      if (area2(t) > 1e-12 * diag * Math.max(...L)) continue;
      const k = L.indexOf(Math.max(...L)), a = t[k], b = t[(k + 1) % 3], c = t[(k + 2) % 3], j = edges.get(`${b},${a}`);
      T[i] = null; report.degenerate++; changed = true;
      if (j == null || !T[j] || j === i) continue;
      const u = T[j], s = u.indexOf(b), d = u[(s + 2) % 3];
      if (u[(s + 1) % 3] !== a) continue;
      T[j] = [b, c, d]; T.push([c, a, d]); tp.push(tp[j]);
    }
    if (!changed) break;
  }
  const first = new Map(), drop = new Uint8Array(T.length);
  T.forEach((t, i) => {
    if (!t) { drop[i] = 1; return; }
    const key = [...t].sort((x, y) => x - y).join(), j = first.get(key);
    if (j == null) { first.set(key, i); return; }
    drop[i] = 1; report.duplicates++;
    const o = T[j];
    if (!drop[j] && ![0, 1, 2].some((r) => o[r] === t[0] && o[(r + 1) % 3] === t[1])) { drop[j] = 1; report.duplicates++; }
  });
  const list = T.map((_, i) => i).filter((i) => !drop[i]);
  T = list.map((i) => T[i]); tp = list.map((i) => tp[i]);
  // Orientation: walk each piece across edges shared by exactly two triangles.
  const und = new Map();
  T.forEach((t, i) => { for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`; if (!und.has(key)) und.set(key, []); und.get(key).push(i); } });
  const done = new Uint8Array(T.length), turned = new Uint8Array(T.length);
  for (let s = 0; s < T.length; s++) {
    if (done[s]) continue;
    const q = [s], members = [];
    done[s] = 1;
    while (q.length) {
      const i = q.pop(), t = T[i];
      members.push(i);
      for (let k = 0; k < 3; k++) {
        const a = t[k], b = t[(k + 1) % 3], list2 = und.get(a < b ? `${a},${b}` : `${b},${a}`);
        if (list2.length !== 2) continue;
        const j = list2[0] === i ? list2[1] : list2[0];
        if (done[j]) continue;
        const u = T[j];
        if ([0, 1, 2].some((r) => u[r] === a && u[(r + 1) % 3] === b)) { T[j] = [u[0], u[2], u[1]]; turned[j] ^= 1; }
        done[j] = 1; q.push(j);
      }
    }
    let vol = 0;
    for (const i of members) { const [a, b, c] = T[i]; vol += P[a * 3] * (P[b * 3 + 1] * P[c * 3 + 2] - P[b * 3 + 2] * P[c * 3 + 1]) - P[a * 3 + 1] * (P[b * 3] * P[c * 3 + 2] - P[b * 3 + 2] * P[c * 3]) + P[a * 3 + 2] * (P[b * 3] * P[c * 3 + 1] - P[b * 3 + 1] * P[c * 3]); }
    if (vol < 0 && !contained(members, T, P)) for (const i of members) { const [a, b, c] = T[i]; T[i] = [a, c, b]; turned[i] ^= 1; }
  }
  report.flipped = turned.reduce((a, b) => a + b, 0);
  // Unused points go.
  const used = new Int32Array(P.length / 3).fill(-1), pos = [];
  const idx = new Uint32Array(T.length * 3);
  T.forEach((t, i) => t.forEach((v, k) => { if (used[v] < 0) { used[v] = pos.length / 3; pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); } idx[i * 3 + k] = used[v]; }));
  report.points += P.length / 3 - pos.length / 3;
  return { mesh: rebuild(m, pos, idx, Int32Array.from(tp)), report };
}
// An inward-facing piece inside another piece is a hollow and keeps its direction.
function contained(members, T, P) {
  const [a] = T[members[0]], x = P[a * 3], y = P[a * 3 + 1], z = P[a * 3 + 2];
  const set = new Set(members);
  let hits = 0;
  for (let i = 0; i < T.length; i++) {
    if (set.has(i)) continue;
    const [p, q, r] = T[i], ax = P[p * 3], ay = P[p * 3 + 1], bx = P[q * 3], by = P[q * 3 + 1], cx = P[r * 3], cy = P[r * 3 + 1];
    const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!d) continue;
    const u = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / d, v = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / d, w = 1 - u - v;
    if (u < 0 || v < 0 || w < 0) continue;
    if (u * P[p * 3 + 2] + v * P[q * 3 + 2] + w * P[r * 3 + 2] > z) hits++;
  }
  return hits % 2 === 1;
}

// Quadric edge collapse after FreeCAD's Mesh Decimation (Simplify.h, from Sven Forstmann's Fast Quadric Mesh
// Simplification, MIT). Colour boundaries count as borders so colour regions keep their outlines.
function simplify(m0, keep) {
  const target = Math.max(12, Math.round((m0.idx.length / 3) * keep));
  if (target >= m0.idx.length / 3) return m0;
  const m = weld(m0), { mn, diag } = box(m.pos), s = 100 / diag;
  const nv = m.pos.length / 3, V = new Float64Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) V[i] = (m.pos[i] - mn[i % 3]) * s;
  let nt = m.idx.length / 3;
  const TV = Int32Array.from(m.idx), TP = triParts(m), err = new Float64Array(nt * 4), del = new Uint8Array(nt), dirty = new Uint8Array(nt), TN = new Float64Array(nt * 3);
  const Q = new Float64Array(nv * 10), border = new Uint8Array(nv), tstart = new Int32Array(nv), tcount = new Int32Array(nv);
  let refT = [], refV = [];
  const det = (q, a11, a12, a13, a21, a22, a23, a31, a32, a33) => q[a11] * q[a22] * q[a33] + q[a13] * q[a21] * q[a32] + q[a12] * q[a23] * q[a31] - q[a13] * q[a22] * q[a31] - q[a11] * q[a23] * q[a32] - q[a12] * q[a21] * q[a33];
  const vErr = (q, x, y, z) => q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
  const qq = new Float64Array(10), res = [0, 0, 0];
  const calc = (a, b) => {
    for (let k = 0; k < 10; k++) qq[k] = Q[a * 10 + k] + Q[b * 10 + k];
    const d = det(qq, 0, 1, 2, 1, 4, 5, 2, 5, 7);
    if (d !== 0 && !(border[a] & border[b])) {
      res[0] = (-1 / d) * det(qq, 1, 2, 3, 4, 5, 6, 5, 7, 8); res[1] = (1 / d) * det(qq, 0, 2, 3, 1, 5, 6, 2, 7, 8); res[2] = (-1 / d) * det(qq, 0, 1, 3, 1, 4, 6, 2, 5, 8);
      return vErr(qq, res[0], res[1], res[2]);
    }
    const c = [[V[a * 3], V[a * 3 + 1], V[a * 3 + 2]], [V[b * 3], V[b * 3 + 1], V[b * 3 + 2]]];
    c.push([(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2, (c[0][2] + c[1][2]) / 2]);
    const e = c.map((p) => vErr(qq, p[0], p[1], p[2])), best = Math.min(...e), k = e.lastIndexOf(best);
    res[0] = c[k][0]; res[1] = c[k][1]; res[2] = c[k][2];
    return best;
  };
  const edgeErr = (t) => { for (let j = 0; j < 3; j++) err[t * 4 + j] = calc(TV[t * 3 + j], TV[t * 3 + (j + 1) % 3]); err[t * 4 + 3] = Math.min(err[t * 4], err[t * 4 + 1], err[t * 4 + 2]); };
  const update = (iter) => {
    if (iter > 0) {
      let dst = 0;
      for (let t = 0; t < nt; t++) if (!del[t]) { if (dst !== t) { for (let k = 0; k < 3; k++) { TV[dst * 3 + k] = TV[t * 3 + k]; TN[dst * 3 + k] = TN[t * 3 + k]; } for (let k = 0; k < 4; k++) err[dst * 4 + k] = err[t * 4 + k]; TP[dst] = TP[t]; dirty[dst] = dirty[t]; } del[dst] = 0; dst++; }
      nt = dst;
    }
    if (iter === 0) {
      Q.fill(0);
      for (let t = 0; t < nt; t++) {
        const [a, b, c] = [TV[t * 3], TV[t * 3 + 1], TV[t * 3 + 2]], n = cross([V[b * 3] - V[a * 3], V[b * 3 + 1] - V[a * 3 + 1], V[b * 3 + 2] - V[a * 3 + 2]], [V[c * 3] - V[a * 3], V[c * 3 + 1] - V[a * 3 + 1], V[c * 3 + 2] - V[a * 3 + 2]]), l = len(n) || 1;
        const nx = n[0] / l, ny = n[1] / l, nz = n[2] / l, d = -(nx * V[a * 3] + ny * V[a * 3 + 1] + nz * V[a * 3 + 2]);
        TN[t * 3] = nx; TN[t * 3 + 1] = ny; TN[t * 3 + 2] = nz;
        const pl = [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
        for (const v of [a, b, c]) for (let k = 0; k < 10; k++) Q[v * 10 + k] += pl[k];
      }
    }
    tcount.fill(0);
    for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) tcount[TV[t * 3 + j]]++;
    let st = 0;
    for (let v = 0; v < nv; v++) { tstart[v] = st; st += tcount[v]; tcount[v] = 0; }
    refT = new Int32Array(nt * 3); refV = new Int8Array(nt * 3);
    for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) { const v = TV[t * 3 + j], r = tstart[v] + tcount[v]++; refT[r] = t; refV[r] = j; }
    refT = Array.from(refT); refV = Array.from(refV);
    if (iter === 0) {
      border.fill(0);
      const cnt = new Map();
      for (let v = 0; v < nv; v++) {
        cnt.clear();
        let part = -1, mixed = false;
        for (let r = tstart[v]; r < tstart[v] + tcount[v]; r++) {
          const t = refT[r];
          if (part < 0) part = TP[t]; else if (TP[t] !== part) mixed = true;
          for (let k = 0; k < 3; k++) { const id = TV[t * 3 + k]; cnt.set(id, (cnt.get(id) || 0) + 1); }
        }
        if (mixed) border[v] = 1;
        for (const [id, c] of cnt) if (c === 1) border[id] = 1;
      }
      for (let t = 0; t < nt; t++) edgeErr(t);
    }
  };
  const flipped = (px, py, pz, i0, i1, dl) => {
    for (let k = 0; k < tcount[i0]; k++) {
      const t = refT[tstart[i0] + k];
      if (del[t]) continue;
      const sv = refV[tstart[i0] + k], id1 = TV[t * 3 + (sv + 1) % 3], id2 = TV[t * 3 + (sv + 2) % 3];
      if (id1 === i1 || id2 === i1) { dl[k] = 1; continue; }
      const d1 = [V[id1 * 3] - px, V[id1 * 3 + 1] - py, V[id1 * 3 + 2] - pz], d2 = [V[id2 * 3] - px, V[id2 * 3 + 1] - py, V[id2 * 3 + 2] - pz], l1 = len(d1) || 1, l2 = len(d2) || 1;
      for (let q = 0; q < 3; q++) { d1[q] /= l1; d2[q] /= l2; }
      if (Math.abs(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) > 0.999) return true;
      const n = cross(d1, d2), l = len(n) || 1;
      dl[k] = 0;
      if ((n[0] * TN[t * 3] + n[1] * TN[t * 3 + 1] + n[2] * TN[t * 3 + 2]) / l < 0.2) return true;
    }
    return false;
  };
  let deleted = 0;
  const updTris = (i0, v, dl) => {
    for (let k = 0; k < tcount[v]; k++) {
      const r = tstart[v] + k, t = refT[r];
      if (del[t]) continue;
      if (dl[k]) { del[t] = 1; deleted++; continue; }
      TV[t * 3 + refV[r]] = i0; dirty[t] = 1;
      edgeErr(t);
      refT.push(t); refV.push(refV[r]);
    }
  };
  const total = nt;
  for (let iter = 0; iter < 100 && total - deleted > target; iter++) {
    if (iter % 5 === 0) update(iter);
    dirty.fill(0, 0, nt);
    const threshold = 1e-9 * (iter + 3) ** 7;
    for (let t = 0; t < nt && total - deleted > target; t++) {
      if (err[t * 4 + 3] > threshold || del[t] || dirty[t]) continue;
      for (let j = 0; j < 3; j++) {
        if (err[t * 4 + j] >= threshold) continue;
        const i0 = TV[t * 3 + j], i1 = TV[t * 3 + (j + 1) % 3];
        if (border[i0] !== border[i1]) continue;
        calc(i0, i1);
        const [px, py, pz] = res, d0 = new Uint8Array(tcount[i0]), d1 = new Uint8Array(tcount[i1]);
        if (flipped(px, py, pz, i0, i1, d0) || flipped(px, py, pz, i1, i0, d1)) continue;
        V[i0 * 3] = px; V[i0 * 3 + 1] = py; V[i0 * 3 + 2] = pz;
        for (let k = 0; k < 10; k++) Q[i0 * 10 + k] += Q[i1 * 10 + k];
        const ts = refT.length;
        updTris(i0, i0, d0); updTris(i0, i1, d1);
        const tc = refT.length - ts;
        if (tc <= tcount[i0]) { for (let k = 0; k < tc; k++) { refT[tstart[i0] + k] = refT[ts + k]; refV[tstart[i0] + k] = refV[ts + k]; } } else tstart[i0] = ts;
        tcount[i0] = tc;
        break;
      }
    }
  }
  const used = new Int32Array(nv).fill(-1), pos = [], idx = [], tp = [];
  for (let t = 0; t < nt; t++) {
    if (del[t]) continue;
    for (let k = 0; k < 3; k++) { const v = TV[t * 3 + k]; if (used[v] < 0) { used[v] = pos.length / 3; pos.push(V[v * 3] / s + mn[0], V[v * 3 + 1] / s + mn[1], V[v * 3 + 2] / s + mn[2]); } idx.push(used[v]); }
    tp.push(TP[t]);
  }
  // Collapses keep triangles in place, so a colour's triangles stay together once sorted by colour.
  const order = tp.map((_, i) => i).sort((a, b) => tp[a] - tp[b] || a - b);
  return rebuild(m, pos, order.flatMap((i) => [idx[i * 3], idx[i * 3 + 1], idx[i * 3 + 2]]), Int32Array.from(order.map((i) => tp[i])));
}

// Several models as one, each keeping its colours; side by side along X when asked.
function merge(list, { arrange = false, gap } = {}) {
  const pos = [], idx = [], parts = [];
  let x = 0;
  for (const m of list) {
    const base = pos.length / 3, { mn, mx, diag } = box(m.pos), dx = arrange ? x - mn[0] : 0, sp = spans(m);
    for (let i = 0; i < m.pos.length; i += 3) pos.push(m.pos[i] + dx, m.pos[i + 1], m.pos[i + 2]);
    for (const s of sp) { parts.push({ start: idx.length + s.start, color: s.color, ...(s.alpha < 1 ? { alpha: s.alpha } : {}) }); }
    for (const i of m.idx) idx.push(base + i);
    x += mx[0] - mn[0] + (gap ?? diag * 0.1);
  }
  return mesh(pos, idx, parts.some((p) => p.color != null) ? parts : null);
}

const normal = (P, a, b, c) => { const n = cross(sub(P, b, a), sub(P, c, a)), l = len(n) || 1; return n.map((v) => v / l); };
function writeStlAscii(m, name = 'Lime') {
  const P = m.pos, L = [`solid ${name}`];
  for (let i = 0; i < m.idx.length; i += 3) {
    const [a, b, c] = [m.idx[i], m.idx[i + 1], m.idx[i + 2]], n = normal(P, a, b, c);
    L.push(`  facet normal ${n.map(g).join(' ')}`, '    outer loop', ...[a, b, c].map((v) => `      vertex ${g(P[v * 3])} ${g(P[v * 3 + 1])} ${g(P[v * 3 + 2])}`), '    endloop', '  endfacet');
  }
  L.push(`endsolid ${name}`);
  return `${L.join('\n')}\n`;
}
// OFF, with a colour on each face when the model has colours (Geomview's face colour fields).
function writeOff(m) {
  const P = m.pos, coloured = m.parts?.some((q) => q.color != null), L = ['OFF', `${P.length / 3} ${m.idx.length / 3} 0`];
  for (let i = 0; i < P.length; i += 3) L.push(`${g(P[i])} ${g(P[i + 1])} ${g(P[i + 2])}`);
  for (const s of spans(m)) {
    const c = s.color ?? 0xc8c8c8, tail = coloured ? ` ${(c >> 16) & 255} ${(c >> 8) & 255} ${c & 255} ${alpha8(s)}` : '';
    for (let i = s.start; i < s.end; i += 3) L.push(`3 ${m.idx[i]} ${m.idx[i + 1]} ${m.idx[i + 2]}${tail}`);
  }
  return `${L.join('\n')}\n`;
}
const AMF_UNITS = { mm: 'millimeter', in: 'inch', ft: 'feet', m: 'meter' };
const rgbF = (c) => [16, 8, 0].map((k) => g(((c >> k) & 255) / 255));
// AMF: one volume per colour, all sharing the object's vertices.
function writeAmf(m, unit = 'mm') {
  const P = m.pos, L = ['<?xml version="1.0" encoding="UTF-8"?>', `<amf unit="${AMF_UNITS[unit] || 'millimeter'}" version="1.1">`, '<metadata type="producer">Lime</metadata>', '<object id="0">', '<mesh>', '<vertices>'];
  for (let i = 0; i < P.length; i += 3) L.push(`<vertex><coordinates><x>${g(P[i])}</x><y>${g(P[i + 1])}</y><z>${g(P[i + 2])}</z></coordinates></vertex>`);
  L.push('</vertices>');
  for (const s of spans(m)) {
    if (s.end <= s.start) continue;
    const c = s.color == null ? '' : `<color><r>${rgbF(s.color)[0]}</r><g>${rgbF(s.color)[1]}</g><b>${rgbF(s.color)[2]}</b>${alpha8(s) < 255 ? `<a>${g(s.alpha)}</a>` : ''}</color>`;
    L.push(`<volume>${c}`);
    for (let i = s.start; i < s.end; i += 3) L.push(`<triangle><v1>${m.idx[i]}</v1><v2>${m.idx[i + 1]}</v2><v3>${m.idx[i + 2]}</v3></triangle>`);
    L.push('</volume>');
  }
  L.push('</mesh>', '</object>', '</amf>');
  return `${L.join('\n')}\n`;
}
const look = (s) => (s.color == null ? [0.8, 0.8, 0.8] : rgbF(s.color));
// VRML 97: Z-up millimetres turned Y-up and scaled to metres by one Transform, the points shared by every colour.
function writeWrl(m, unit = 'mm') {
  const k = g((UNITS[unit] || 1) / 1000), P = m.pos, pts = [];
  for (let i = 0; i < P.length; i += 3) pts.push(`${g(P[i])} ${g(P[i + 1])} ${g(P[i + 2])}`);
  const shapes = spans(m).filter((s) => s.end > s.start).map((s, n) => {
    const ix = [];
    for (let i = s.start; i < s.end; i += 3) ix.push(`${m.idx[i]} ${m.idx[i + 1]} ${m.idx[i + 2]} -1`);
    return `    Shape {\n      appearance Appearance { material Material { diffuseColor ${look(s).join(' ')}${alpha8(s) < 255 ? ` transparency ${g(1 - s.alpha)}` : ''} } }\n      geometry IndexedFaceSet {\n        solid FALSE\n        coord ${n ? 'USE C' : `DEF C Coordinate { point [\n          ${pts.join(',\n          ')}\n        ] }`}\n        coordIndex [\n          ${ix.join(',\n          ')}\n        ]\n      }\n    }`;
  });
  return `#VRML V2.0 utf8\nWorldInfo { title "Lime" info ["Created by Lime"] }\nTransform {\n  rotation 1 0 0 -1.5707963\n  scale ${k} ${k} ${k}\n  children [\n${shapes.join('\n')}\n  ]\n}\n`;
}
const X3D_UNITS = { mm: 'millimetre', cm: 'centimetre', m: 'metre', in: 'inch', ft: 'foot' };
function writeX3d(m, unit = 'mm') {
  const P = m.pos, pts = [];
  for (let i = 0; i < P.length; i += 3) pts.push(`${g(P[i])} ${g(P[i + 1])} ${g(P[i + 2])}`);
  const shapes = spans(m).filter((s) => s.end > s.start).map((s, n) => {
    const ix = [];
    for (let i = s.start; i < s.end; i += 3) ix.push(`${m.idx[i]} ${m.idx[i + 1]} ${m.idx[i + 2]} -1`);
    return `<Shape><Appearance><Material diffuseColor="${look(s).join(' ')}"${alpha8(s) < 255 ? ` transparency="${g(1 - s.alpha)}"` : ''}/></Appearance><IndexedFaceSet solid="false" coordIndex="${ix.join(' ')}">${n ? '<Coordinate USE="C"/>' : `<Coordinate DEF="C" point="${pts.join(', ')}"/>`}</IndexedFaceSet></Shape>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 3.3//EN" "http://www.web3d.org/specifications/x3d-3.3.dtd">\n<X3D profile="Interchange" version="3.3" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="http://www.web3d.org/specifications/x3d-3.3.xsd">\n<head><meta name="generator" content="Lime"/><unit category="length" name="${X3D_UNITS[unit] || 'millimetre'}" conversionFactor="${g((UNITS[unit] || 1) / 1000)}"/></head>\n<Scene>\n<Transform rotation="1 0 0 -1.5707963">\n${shapes.join('\n')}\n</Transform>\n</Scene>\n</X3D>\n`;
}
const DAE_UNITS = { mm: 'millimeter', cm: 'centimeter', m: 'meter', in: 'inch', ft: 'foot' };
// COLLADA 1.4.1 with real units and Z up, one material per colour.
function writeDae(m, unit = 'mm', name = 'Model') {
  const P = m.pos, now = new Date().toISOString().replace(/\.\d+Z$/, 'Z'), sp = spans(m).filter((s) => s.end > s.start), pal = palette(sp), at = new Map(pal.map((q, i) => [ck(q), i]));
  const fx = pal.map((q, i) => `<effect id="effect${i}"><profile_COMMON><technique sid="common"><lambert><diffuse><color>${look(q).join(' ')} 1</color></diffuse>${alpha8(q) < 255 ? `<transparent opaque="A_ONE"><color>0 0 0 ${g(q.alpha)}</color></transparent><transparency><float>1</float></transparency>` : ''}</lambert></technique></profile_COMMON></effect>`);
  const mats = pal.map((q, i) => `<material id="material${i}" name="${q.color == null ? 'default' : `color_${hex(q.color).slice(1)}`}"><instance_effect url="#effect${i}"/></material>`);
  const tris = sp.map((s) => { const ix = []; for (let i = s.start; i < s.end; i++) ix.push(m.idx[i]); return `<triangles material="m${at.get(ck(s))}" count="${(s.end - s.start) / 3}"><input semantic="VERTEX" source="#mesh-vertices" offset="0"/><p>${ix.join(' ')}</p></triangles>`; });
  const bind = pal.map((q, i) => `<instance_material symbol="m${i}" target="#material${i}"/>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><authoring_tool>Lime</authoring_tool></contributor><created>${now}</created><modified>${now}</modified><unit name="${DAE_UNITS[unit] || 'millimeter'}" meter="${g((UNITS[unit] || 1) / 1000)}"/><up_axis>Z_UP</up_axis></asset>
<library_effects>${fx.join('')}</library_effects>
<library_materials>${mats.join('')}</library_materials>
<library_geometries><geometry id="mesh" name="${esc(name)}"><mesh>
<source id="mesh-positions"><float_array id="mesh-positions-array" count="${P.length}">${Array.from(P, g).join(' ')}</float_array><technique_common><accessor source="#mesh-positions-array" count="${P.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<vertices id="mesh-vertices"><input semantic="POSITION" source="#mesh-positions"/></vertices>
${tris.join('\n')}
</mesh></geometry></library_geometries>
<library_visual_scenes><visual_scene id="scene" name="scene"><node id="node" name="${esc(name)}" type="NODE"><instance_geometry url="#mesh"><bind_material><technique_common>${bind}</technique_common></bind_material></instance_geometry></node></visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
}

module.exports = { UNITS, place, inUnits, weld, weldPoints, repair, simplify, merge, box, triParts, rebuild, writeStlAscii, writeOff, writeAmf, writeWrl, writeX3d, writeDae };
