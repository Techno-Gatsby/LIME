'use strict';
// STEP, IGES and BREP out. A B-rep model goes through Open CASCADE unchanged; a mesh becomes a faceted solid the way
// FreeCAD's Part "Shape from mesh" and "Refine shape" make one: shared points and edges, one planar face per triangle,
// coplanar neighbours of one colour merged into one face, straight runs of edge merged into one edge.
const U = require('./util');
const { fs, fsp, path } = U;
const { spans } = require('./cad');
const M = require('./mesh');

const NAMES = { mm: 'MM', cm: 'CM', m: 'M', in: 'INCH', ft: 'FT' };
const IGES_UNIT = { in: 1, mm: 2, ft: 4, m: 6, cm: 10 };
const MAX_FACES = 100000;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

function topology(m0, { refine = true } = {}) {
  const w = M.weld(m0, 1e-9), nv0 = w.pos.length / 3, P = Float64Array.from(w.pos), tp0 = M.triParts(w), sp = spans(w);
  const V = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], { diag, mn, mx } = M.box(w.pos);
  const tol = 4 * Math.max(1e-7 * diag, 1.2e-7 * Math.max(...mn.map(Math.abs), ...mx.map(Math.abs)));
  const T = [], tp = [], N = [], A = [];
  for (let t = 0; t < w.idx.length / 3; t++) {
    const a = w.idx[t * 3], b = w.idx[t * 3 + 1], c = w.idx[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    const pa = V(a), n = crs([P[b * 3] - pa[0], P[b * 3 + 1] - pa[1], P[b * 3 + 2] - pa[2]], [P[c * 3] - pa[0], P[c * 3 + 1] - pa[1], P[c * 3 + 2] - pa[2]]), l = Math.hypot(...n);
    if (!(l > tol * tol * 1e-3)) continue;
    T.push([a, b, c]); tp.push(tp0[t]); N.push(n.map((x) => x / l)); A.push(l / 2);
  }
  if (!T.length) throw new Error('This model has no faces to make a solid from.');
  const half = new Map(), key = (a, b) => a * nv0 + b;
  T.forEach(([a, b, c], t) => { half.set(key(a, b), t); half.set(key(b, c), t); half.set(key(c, a), t); });
  // Coplanar regions, each grown from its largest triangle so the plane comes from the best-shaped one.
  const region = new Int32Array(T.length).fill(-1), order = T.map((_, i) => i).sort((x, y) => A[y] - A[x]), regions = [];
  for (const s of order) {
    if (region[s] >= 0) continue;
    const r = regions.length, n = N[s], d = dot(n, V(T[s][0])), list = [s], q = [s];
    region[s] = r;
    while (refine && q.length) {
      const t = q.pop();
      for (let k = 0; k < 3; k++) {
        const u = half.get(key(T[t][(k + 1) % 3], T[t][k]));
        if (u == null || region[u] >= 0 || tp[u] !== tp[s] || dot(N[u], n) <= 0 || !T[u].every((v) => Math.abs(dot(n, V(v)) - d) <= tol)) continue;
        region[u] = r; list.push(u); q.push(u);
      }
    }
    regions.push({ n, tris: list, part: tp[s] });
  }
  const faces = [];
  for (const rg of regions) {
    const loops = rg.tris.length > 1 ? traceLoops(rg, T, region, half, key, V) : null;
    if (loops) faces.push({ n: rg.n, loops, part: rg.part });
    else for (const t of rg.tris) faces.push({ n: N[t], loops: [T[t].slice()], part: tp[t] });
  }
  if (faces.length > MAX_FACES) throw new Error(`This model makes ${faces.length.toLocaleString('en-US')} faces, too many for a usable STEP, IGES or BREP file. Keep fewer triangles (More options, or Simplify model) and try again.`);
  dropCollinear(faces, V, tol);
  // Edges, numbered as first met; each use remembers whether it runs along the edge.
  const edges = [], ekey = new Map();
  faces.forEach((f, fi) => {
    f.i = fi;
    f.uses = f.loops.map((l) => l.map((a, i) => {
      const b = l[(i + 1) % l.length], k = a < b ? key(a, b) : key(b, a);
      let e = ekey.get(k);
      if (e == null) { e = edges.length; ekey.set(k, e); edges.push({ a, b, faces: [] }); }
      const u = { e, fwd: edges[e].a === a };
      edges[e].faces.push({ f: fi, fwd: u.fwd, u });
      return u;
    }));
  });
  for (const e of edges.slice()) if (e.faces.length > 2 || (e.faces.length === 2 && e.faces[0].fwd === e.faces[1].fwd)) splitEdge(e, edges, faces, V);
  // Connected pieces: closed ones (every edge used twice, once each way) are solids or hollows, the rest open shells.
  const root = faces.map((_, i) => i), find = (x) => { while (root[x] !== x) x = root[x] = root[root[x]]; return x; };
  for (const e of edges) for (const u of e.faces.slice(1)) root[find(u.f)] = find(e.faces[0].f);
  const groups = new Map(), leaky = new Set();
  faces.forEach((f, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  for (const e of edges) if (!(e.faces.length === 2 && e.faces[0].fwd !== e.faces[1].fwd)) leaky.add(find(e.faces[0].f));
  const shells = [...groups.entries()].map(([r, fs2]) => {
    const closed = !leaky.has(r);
    let vol = 0;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const i of fs2) {
      const f = faces[i], p0 = V(f.loops[0][0]);
      let ar = [0, 0, 0];
      for (const l of f.loops) for (let k = 0; k < l.length; k++) { const c = crs(V(l[k]), V(l[(k + 1) % l.length])); ar = [ar[0] + c[0], ar[1] + c[1], ar[2] + c[2]]; for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], P[l[k] * 3 + j]); hi[j] = Math.max(hi[j], P[l[k] * 3 + j]); } }
      vol += dot(p0, ar) / 6;
    }
    return { faces: fs2, closed, vol, lo, hi };
  });
  const solids = [];
  for (const [i, s] of shells.entries()) if (s.closed && s.vol > 0) solids.push({ outer: i, voids: [] });
  for (const [i, s] of shells.entries()) {
    if (!s.closed || s.vol > 0) continue;
    const home = solids.filter((o) => [0, 1, 2].every((k) => shells[o.outer].lo[k] <= s.lo[k] && shells[o.outer].hi[k] >= s.hi[k])).sort((a, b) => shells[a.outer].vol - shells[b.outer].vol)[0];
    if (home) { home.voids.push(i); s.void = true; } else s.open = true;
  }
  for (const s of shells) if (!s.closed) s.open = true;
  // Points still in use, renumbered.
  const used = new Map(), pts = [];
  const pt = (v) => { if (!used.has(v)) { used.set(v, pts.length); pts.push(V(v)); } return used.get(v); };
  for (const f of faces) f.loops = f.loops.map((l) => l.map(pt));
  for (const e of edges) { e.a = pt(e.a); e.b = pt(e.b); }
  let dev = 0;
  for (const f of faces) { const d = dot(f.n, pts[f.loops[0][0]]); for (const l of f.loops) for (const v of l) dev = Math.max(dev, Math.abs(dot(f.n, pts[v]) - d)); }
  return { pts, edges, faces, shells, solids, colors: sp.map((s) => s.color), tol: Math.max(1e-7, dev * 2), diag };
}

// The region's outline: every edge it doesn't share with itself, chained with the region on the left. Where several
// edges leave one point the sharpest left turn is taken, so loops that touch at a corner stay apart.
function traceLoops(rg, T, region, half, key, V) {
  const r = region[rg.tris[0]], n = rg.n, ax = nrm(Math.abs(n[0]) < 0.9 ? crs(n, [1, 0, 0]) : crs(n, [0, 1, 0])), ay = crs(n, ax);
  const uv = (v) => { const p = V(v); return [dot(p, ax), dot(p, ay)]; };
  const out = new Map();
  let count = 0;
  for (const t of rg.tris) for (let k = 0; k < 3; k++) {
    const a = T[t][k], b = T[t][(k + 1) % 3], o = half.get(key(b, a));
    if (o != null && region[o] === r) continue;
    if (!out.has(a)) out.set(a, []);
    out.get(a).push(b); count++;
  }
  const loops = [];
  let guard = count + 8;
  for (const [s0, list] of out) {
    while (list.length) {
      const walk = [s0];
      let prev = s0, cur = list.pop();
      while (cur !== s0) {
        if (--guard < 0) return null;
        walk.push(cur);
        const cand = out.get(cur);
        if (!cand?.length) return null;
        let pick = 0;
        if (cand.length > 1) {
          const [cx, cy] = uv(cur), [px, py] = uv(prev), back = Math.atan2(py - cy, px - cx);
          let best = Infinity;
          cand.forEach((c, i) => { const [x, y] = uv(c); let a = back - Math.atan2(y - cy, x - cx); while (a <= 1e-12) a += Math.PI * 2; if (a < best) { best = a; pick = i; } });
        }
        prev = cur; cur = cand.splice(pick, 1)[0];
      }
      // A walk through a point twice (a hole touching the outline) is cut into simple loops there.
      const path = [], at = new Map();
      for (const v of walk) {
        if (at.has(v)) { const cyc = path.splice(at.get(v)); cyc.forEach((x) => at.delete(x)); if (cyc.length >= 3) loops.push(cyc); else return null; }
        at.set(v, path.length); path.push(v);
      }
      if (path.length < 3) return null;
      loops.push(path);
    }
  }
  const area = (l) => { let s = 0; for (let i = 0; i < l.length; i++) { const [x0, y0] = uv(l[i]), [x1, y1] = uv(l[(i + 1) % l.length]); s += x0 * y1 - x1 * y0; } return s / 2; };
  const outer = loops.filter((l) => area(l) > 0);
  if (outer.length !== 1) return null;
  return [outer[0], ...loops.filter((l) => l !== outer[0])];
}

// An edge more than two faces meet at (bodies touching) is shared out in pairs: going round the edge, each face that
// starts a wedge of material is paired with the face that ends it. Faces left over get an edge of their own.
function splitEdge(e, edges, faces, V) {
  const a = V(e.a), b = V(e.b), ax = nrm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), x = nrm(Math.abs(ax[0]) < 0.9 ? crs(ax, [1, 0, 0]) : crs(ax, [0, 1, 0])), y = crs(ax, x);
  const around = e.faces.map((use) => {
    const n = faces[use.f].n, d = use.fwd ? ax : ax.map((v) => -v), w = crs(n, d);
    return { use, th: Math.atan2(dot(w, y), dot(w, x)), ends: dot(n, crs(ax, w)) > 0 };
  }).sort((p, q) => p.th - q.th || (q.ends - p.ends));
  const pairs = [], paired = new Set();
  let open = null;
  for (const it of [...around, ...around]) {
    if (paired.has(it)) continue;
    if (!it.ends) open = it;
    else if (open && open.use.fwd !== it.use.fwd) { pairs.push([open, it]); paired.add(open); paired.add(it); open = null; }
  }
  const groups = [...pairs, ...around.filter((it) => !paired.has(it)).map((it) => [it])];
  groups.forEach((g, i) => {
    const id = i ? edges.push({ a: e.a, b: e.b, faces: [] }) - 1 : edges.indexOf(e);
    if (!i) e.faces = [];
    for (const it of g) { it.use.u.e = id; edges[id].faces.push(it.use); }
  });
}

// A point in the middle of a straight edge, shared by the same two loops on either side, is dropped.
function dropCollinear(faces, V, tol) {
  for (let pass = 0; pass < 64; pass++) {
    const occ = new Map();
    faces.forEach((f, fi) => f.loops.forEach((l, li) => l.forEach((v, k) => { if (!occ.has(v)) occ.set(v, []); occ.get(v).push({ fi, li, p: l[(k + l.length - 1) % l.length], q: l[(k + 1) % l.length] }); })));
    const drop = new Set(), near = new Set();
    for (const [v, list] of occ) {
      if (list.length > 2 || near.has(v)) continue;
      const { p, q } = list[0];
      if (list.length === 2 && !(list[1].p === q && list[1].q === p)) continue;
      if (list.some((o) => faces[o.fi].loops[o.li].length <= 3)) continue;
      const a = V(p), b = V(q), c = V(v), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], L = Math.hypot(...d);
      if (!L || Math.hypot(...crs(d, e)) / L > tol || dot(d, e) <= 0 || dot(d, e) >= L * L) continue;
      drop.add(v); near.add(p); near.add(q);
    }
    if (!drop.size) return;
    for (const f of faces) f.loops = f.loops.map((l) => l.filter((v) => !drop.has(v)));
  }
}

// Reals as STEP and IGES want them: always a decimal point, E for the exponent.
function real(x) {
  if (!Number.isFinite(x) || Math.abs(x) < 1e-300) return '0.';
  const s = String(+x.toPrecision(12)), [mant, ex] = s.split('e');
  return `${mant.includes('.') ? mant : `${mant}.`}${ex ? `E${ex}` : ''}`;
}
const str = (s) => `'${String(s).replace(/[^\x20-\x7e]/g, '_').replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const xdir = (f, pts) => { const l = f.loops[0]; for (let i = 0; i < l.length; i++) { const a = pts[l[i]], b = pts[l[(i + 1) % l.length]], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], x = crs(crs(f.n, d), f.n); if (Math.hypot(...x) > 1e-12) return nrm(x); } return nrm(Math.abs(f.n[0]) < 0.9 ? crs(f.n, [1, 0, 0]) : crs(f.n, [0, 1, 0])); };

function writeStep(topo, { name = 'Model', unit = 'mm', file = 'model.step' } = {}) {
  const k = M.UNITS[unit] || 1, L = [], add = (s) => { L.push(s); return L.length; }, memo = new Map();
  const shared = (s) => { if (!memo.has(s)) memo.set(s, add(s)); return memo.get(s); };
  const P3 = (p) => `(${p.map((v) => real(+(v / k).toPrecision(9))).join(',')})`;
  const dir = (d) => shared(`DIRECTION('',(${d.map(real).join(',')}))`);
  const app = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${app})`);
  const pctx = add(`PRODUCT_CONTEXT('',#${app},'mechanical')`), pdctx = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${app},'design')`);
  const mm = add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
  let lu = mm;
  if (unit === 'cm') lu = add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.CENTI.,.METRE.))');
  else if (unit === 'm') lu = add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.))');
  else if (unit === 'in' || unit === 'ft') {
    const dim = add('DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)'), mu = add(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${real(k)}),#${mm})`);
    lu = add(`(CONVERSION_BASED_UNIT('${unit === 'in' ? 'INCH' : 'FOOT'}',#${mu})LENGTH_UNIT()NAMED_UNIT(#${dim}))`);
  }
  const rad = add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))'), sr = add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${real(topo.tol / k)}),#${lu},'distance_accuracy_value','confusion accuracy')`);
  const ctx = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lu},#${rad},#${sr}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`);
  const prod = add(`PRODUCT(${str(name)},${str(name)},'',(#${pctx}))`);
  add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#${prod}))`);
  const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`), pd = add(`PRODUCT_DEFINITION('design','',#${pdf},#${pdctx})`), pds = add(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
  const origin = add(`AXIS2_PLACEMENT_3D('',#${add("CARTESIAN_POINT('',(0.,0.,0.))")},#${dir([0, 0, 1])},#${dir([1, 0, 0])})`);
  const cp = topo.pts.map((p) => add(`CARTESIAN_POINT('',${P3(p)})`)), vp = cp.map((c) => add(`VERTEX_POINT('',#${c})`));
  const ec = topo.edges.map((e) => { const a = topo.pts[e.a], b = topo.pts[e.b], line = add(`LINE('',#${cp[e.a]},#${add(`VECTOR('',#${dir(nrm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]))},1.)`)})`); return add(`EDGE_CURVE('',#${vp[e.a]},#${vp[e.b]},#${line},.T.)`); });
  // A hollow's faces are written facing into the material and its shell used reversed, as BREP_WITH_VOIDS wants.
  const inVoid = new Set(topo.shells.flatMap((s) => (s.void ? s.faces : [])));
  const fid = topo.faces.map((f) => {
    const flip = inVoid.has(f.i);
    const pl = add(`PLANE('',#${add(`AXIS2_PLACEMENT_3D('',#${cp[f.loops[0][0]]},#${dir(f.n)},#${dir(xdir(f, topo.pts))})`)})`);
    const bounds = f.loops.map((l, li) => {
      const oes = f.uses[li].map((u) => add(`ORIENTED_EDGE('',*,*,#${ec[u.e]},${u.fwd ? '.T.' : '.F.'})`));
      return add(`${li ? 'FACE_BOUND' : 'FACE_OUTER_BOUND'}('',#${add(`EDGE_LOOP('',(${oes.map((x) => `#${x}`).join(',')}))`)},${flip ? '.F.' : '.T.'})`);
    });
    return add(`ADVANCED_FACE('',(${bounds.map((x) => `#${x}`).join(',')}),#${pl},${flip ? '.F.' : '.T.'})`);
  });
  const shell = topo.shells.map((s) => add(`${s.closed ? 'CLOSED_SHELL' : 'OPEN_SHELL'}('',(${s.faces.map((i) => `#${fid[i]}`).join(',')}))`));
  const items = topo.solids.map((s, i) => {
    const nm = str(topo.solids.length > 1 ? `${name} ${i + 1}` : name);
    if (!s.voids.length) return add(`MANIFOLD_SOLID_BREP(${nm},#${shell[s.outer]})`);
    return add(`BREP_WITH_VOIDS(${nm},#${shell[s.outer]},(${s.voids.map((v) => `#${add(`ORIENTED_CLOSED_SHELL('',*,#${shell[v]},.F.)`)}`).join(',')}))`);
  });
  const open = topo.shells.map((s, i) => (s.open ? shell[i] : null)).filter(Boolean);
  const reps = [];
  if (items.length) reps.push(add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${[...items, origin].map((x) => `#${x}`).join(',')}),#${ctx})`));
  if (open.length) reps.push(add(`MANIFOLD_SURFACE_SHAPE_REPRESENTATION('',(#${add(`SHELL_BASED_SURFACE_MODEL('',(${open.map((x) => `#${x}`).join(',')}))`)},#${origin}),#${ctx})`));
  if (reps.length === 1) add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${reps[0]})`);
  else {
    const sr = add(`SHAPE_REPRESENTATION('',(#${origin}),#${ctx})`);
    add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${sr})`);
    for (const r of reps) add(`SHAPE_REPRESENTATION_RELATIONSHIP('','',#${sr},#${r})`);
  }
  // Colours: one on a solid whose faces all share it, otherwise one on each face.
  const styled = [], style = (item, c) => {
    const rgb = shared(`COLOUR_RGB('',${[16, 8, 0].map((s) => real(((c >> s) & 255) / 255)).join(',')})`), fas = shared(`FILL_AREA_STYLE('',(#${shared(`FILL_AREA_STYLE_COLOUR('',#${rgb})`)}))`);
    const psa = shared(`PRESENTATION_STYLE_ASSIGNMENT((#${shared(`SURFACE_STYLE_USAGE(.BOTH.,#${shared(`SURFACE_SIDE_STYLE('',(#${shared(`SURFACE_STYLE_FILL_AREA(#${fas})`)}))`)})`)}))`);
    styled.push(add(`STYLED_ITEM('color',(#${psa}),#${item})`));
  };
  const col = (f) => topo.colors[f.part];
  if (topo.colors.some((c) => c != null)) {
    const done = new Set();
    topo.solids.forEach((s, i) => {
      const fs2 = [s.outer, ...s.voids].flatMap((x) => topo.shells[x].faces), c0 = col(topo.faces[fs2[0]]);
      if (c0 != null && fs2.every((f) => col(topo.faces[f]) === c0)) { style(items[i], c0); fs2.forEach((f) => done.add(f)); }
    });
    topo.faces.forEach((f, i) => { if (!done.has(i) && col(f) != null) style(fid[i], col(f)); });
    add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styled.map((x) => `#${x}`).join(',')}),#${ctx})`);
  }
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, '');
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Lime model'),'2;1');\nFILE_NAME(${str(file)},'${stamp}',(''),(''),'Lime','Lime','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n${L.map((s, i) => `#${i + 1}=${s};`).join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

// IGES 5.3 the way Open CASCADE and FreeCAD write it by default: each face a trimmed plane (144 on 108), its loops
// composite curves of lines (102, 110) on the surface (142), each piece's faces in a group (402), colours as 314.
function writeIges(topo, { unit = 'mm', file = 'model.igs' } = {}) {
  const k = M.UNITS[unit] || 1, E = [], colors = new Map();
  const add = (type, form, params, extra = {}) => { E.push({ type, form, params, status: '00010000', color: 0, ...extra }); return E.length * 2 - 1; };
  const P = (p) => p.map((v) => real(+(v / k).toPrecision(9)));
  const colorDe = (c) => { if (!colors.has(c)) colors.set(c, add(314, 0, [...[16, 8, 0].map((s) => real((((c >> s) & 255) / 255) * 100)), `${hexName(c).length}H${hexName(c)}`], { status: '00000200' })); return colors.get(c); };
  const hexName = (c) => `#${(c >>> 0).toString(16).padStart(6, '0').toUpperCase()}`;
  const groups = [];
  for (const s of topo.shells) {
    const members = [];
    for (const fi of s.faces) {
      const f = topo.faces[fi], o = topo.pts[f.loops[0][0]], n = f.n;
      const pl = add(108, 0, [...n.map(real), real(dot(n, o) / k), '0', '0.', '0.', '0.', '0.']);
      const bounds = f.loops.map((l) => {
        const lines = l.map((a, i) => add(110, 0, [...P(topo.pts[a]), ...P(topo.pts[l[(i + 1) % l.length]])]));
        const cc = add(102, 0, [String(lines.length), ...lines.map(String)]);
        return add(142, 0, ['0', String(pl), '0', String(cc), '2'], { status: '00010500' });
      });
      const c = topo.colors[f.part];
      members.push(add(144, 0, [String(pl), '1', String(bounds.length - 1), ...bounds.map(String)], { status: '00020000', color: c == null ? 0 : -colorDe(c) }));
    }
    groups.push(members);
  }
  for (const g of groups) add(402, 1, [String(g.length), ...g.map(String)], { status: '00000000' });
  return igesFile(E, { unit, file, max: topo.diag / k, tol: topo.tol / k });
}
function igesFile(E, { unit, file, max, tol }) {
  const H = (s) => `${s.length}H${s}`, stamp = new Date().toISOString().replace(/[-:T]/g, '').replace(/^(\d{8})(\d{6}).*$/, '$1.$2'), out = [];
  const line = (data, sect, seq) => out.push(`${data.padEnd(72).slice(0, 72)}${sect}${String(seq).padStart(7, '0')}`);
  line('Lime IGES export', 'S', 1);
  const G = ['1H,', '1H;', H('Lime'), H(file), H('Lime'), H('Lime IGES 5.3'), '32', '308', '15', '308', '15', H(file), '1.', String(IGES_UNIT[unit] || 2), H(NAMES[unit] || 'MM'), '1', '0.01', H(stamp), real(tol), real(max), H(''), H(''), '11', '0', H(stamp)];
  wrap(G, 72).forEach((l, i) => line(l, 'G', i + 1));
  const pdata = E.map((e) => wrap([String(e.type), ...e.params], 64)), pstart = [];
  let next = 1;
  for (const p of pdata) { pstart.push(next); next += p.length; }
  const f8 = (x) => String(x).padStart(8);
  E.forEach((e, i) => {
    line(`${f8(e.type)}${f8(pstart[i])}${f8(0)}${f8(0)}${f8(0)}${f8(0)}${f8(0)}${f8(0)}${e.status}`, 'D', i * 2 + 1);
    line(`${f8(e.type)}${f8(0)}${f8(e.color)}${f8(pdata[i].length)}${f8(e.form)}${f8('')}${f8('')}${f8('')}${f8(0)}`, 'D', i * 2 + 2);
  });
  let seq = 0;
  pdata.forEach((p, i) => p.forEach((l) => line(`${l.padEnd(64)}${String(i * 2 + 1).padStart(8)}`, 'P', ++seq)));
  line(`S${String(1).padStart(7, '0')}G${String(wrap(G, 72).length).padStart(7, '0')}D${String(E.length * 2).padStart(7, '0')}P${String(seq).padStart(7, '0')}`, 'T', 1);
  return `${out.join('\n')}\n`;
}
// Fields joined by commas and ended by a semicolon, broken between fields to fit the width.
function wrap(fields, width) {
  const lines = [];
  let cur = '';
  fields.forEach((f, i) => {
    const item = `${f}${i + 1 === fields.length ? ';' : ','}`;
    if (cur.length + item.length > width && cur) { lines.push(cur); cur = ''; }
    if (item.length <= width) { cur += item; return; }
    for (let i = 0; i < item.length; i += width) { const piece = item.slice(i, i + width); if (piece.length === width) lines.push(piece); else cur = piece; }
  });
  if (cur) lines.push(cur);
  return lines;
}

// Open CASCADE's own BREP text: lines and planes, vertices, edges, wires, faces, shells, solids.
function writeBrep(topo, { unit = 'mm' } = {}) {
  const k = M.UNITS[unit] || 1, num = (v) => String(+(+v).toPrecision(15)), tol = num(topo.tol / k), pts = topo.pts.map((p) => p.map((v) => v / k));
  const curves = topo.edges.map((e) => { const a = pts[e.a], b = pts[e.b], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d); return { a, d: d.map((x) => x / l), l }; });
  const shapes = [], add = (s) => { shapes.push(s); return shapes.length; };
  const vs = pts.map((p) => add(`Ve\n${tol}\n${p.map(num).join(' ')}\n0 0\n\n0101101\n*`));
  const es = topo.edges.map((e, i) => add(`Ed\n ${tol} 1 1 0\n1  ${i + 1} 0 0 ${num(curves[i].l)}\n0\n\n0101000\n+V${vs[e.a]} 0 -V${vs[e.b]} 0 *`));
  const surfaces = [];
  const fs2 = topo.faces.map((f) => {
    const ws = f.uses.map((u) => add(`Wi\n\n0101100\n${u.map((x) => `${x.fwd ? '+' : '-'}V${es[x.e]} 0`).join(' ')} *`));
    const x = xdir(f, topo.pts), y = crs(f.n, x), o = pts[f.loops[0][0]];
    surfaces.push(`1 ${[...o, ...f.n, ...x, ...y].map(num).join(' ')}`);
    return add(`Fa\n0  ${tol} ${surfaces.length} 0\n\n0111000\n${ws.map((w) => `+V${w} 0`).join(' ')} *`);
  });
  const sh = topo.shells.map((s) => add(`Sh\n\n0101${s.closed ? '1' : '0'}00\n${s.faces.map((i) => `+V${fs2[i]} 0`).join(' ')} *`));
  const so = topo.solids.map((s) => add(`So\n\n1100000\n${[s.outer, ...s.voids].map((i) => `+V${sh[i]} 0`).join(' ')} *`));
  const loose = topo.shells.map((s, i) => (s.open ? sh[i] : null)).filter(Boolean), tops = [...so, ...loose];
  const root = tops.length === 1 ? tops[0] : add(`Co\n\n1100000\n${tops.map((t) => `+V${t} 0`).join(' ')} *`);
  // Shapes are numbered from the last written, so references are resolved once the count is known.
  const n = shapes.length, ref = (i) => n - i + 1;
  const body = shapes.map((s) => s.replace(/V(\d+)/g, (_, i) => String(ref(+i)))).join('\n');
  return `DBRep_DrawableShape\n\nCASCADE Topology V1, (c) Matra-Datavision\nLocations 0\nCurve2ds 0\nCurves ${curves.length}\n${curves.map((c) => `1 ${[...c.a, ...c.d].map(num).join(' ')}`).join('\n')}\nPolygon3D 0\nPolygonOnTriangulations 0\nSurfaces ${surfaces.length}\n${surfaces.join('\n')}\nTriangulations 0\n\nTShapes ${n}\n${body}\n\n+${ref(root)} 0\n`;
}

// The kernel holds a few hundred megabytes once used, so it is let go after two idle minutes.
let oc = null, idle = null;
async function kernel() {
  clearTimeout(idle);
  if (oc) return oc;
  const dir = path.join(path.dirname(require.resolve('@bitbybit-dev/occt/package.json')), 'bitbybit-dev-occt');
  const wasm = fs.readdirSync(dir).find((f) => f.endsWith('.wasm'));
  const { default: create } = await import(require('url').pathToFileURL(path.join(dir, 'bitbybit-dev-occt.js')).href);
  oc = await create({ locateFile: () => path.join(dir, wasm), print: () => {}, printErr: () => {} });
  return oc;
}
const KIND = (e) => (e === 'brep' ? 'brep' : e === 'iges' || e === 'igs' ? 'iges' : 'step');
// A STEP, IGES or BREP file written again through Open CASCADE, its curved faces exact. Moved or scaled when asked.
async function exact(src, to, out, { scale = 100, centre = '', box: bb } = {}) {
  const o = await kernel(), from = KIND(U.ext(src)), id = Math.random().toString(36).slice(2), inF = `/in-${id}.${from}`, outF = `/out-${id}.${KIND(to)}`, junk = [];
  const keep = (x) => { junk.push(x); return x; };
  o.FS.writeFile(inF, new Uint8Array(await fsp.readFile(src)));
  try {
    let shape;
    if (from === 'brep') { shape = keep(new o.TopoDS_Shape()); if (!o.BRepTools.Read(shape, inF, keep(new o.BRep_Builder()))) shape = null; } else {
      const r = keep(from === 'iges' ? new o.IGESControl_Reader() : new o.STEPControl_Reader());
      if (r.ReadFile(inF).value === o.IFSelect_ReturnStatus.RetDone.value && r.TransferRoots() > 0) shape = keep(r.OneShape());
    }
    if (!shape || shape.IsNull()) throw new Error(`Open CASCADE couldn’t read this ${from.toUpperCase()} file.`);
    const k = (Number(scale) || 100) / 100;
    if (k !== 1 || centre) {
      const off = centre && bb ? [-(bb.mn[0] + bb.mx[0]) / 2, -(bb.mn[1] + bb.mx[1]) / 2, centre === 'floor' ? -bb.mn[2] : -(bb.mn[2] + bb.mx[2]) / 2] : [0, 0, 0];
      const t = keep(new o.gp_Trsf()), s = keep(new o.gp_Trsf());
      t.SetTranslation(keep(new o.gp_Vec(...off)));
      s.SetScale(keep(new o.gp_Pnt(0, 0, 0)), k);
      s.Multiply(t);
      shape = keep(keep(new o.BRepBuilderAPI_Transform(shape, s, true)).Shape());
    }
    const kind = KIND(to);
    if (kind === 'brep') { if (!o.BRepTools.Write(shape, outF)) throw new Error('Open CASCADE couldn’t write the BREP file.'); } else if (kind === 'iges') {
      const w = keep(new o.IGESControl_Writer());
      w.AddShape(shape); w.ComputeModel();
      if (!w.Write(outF)) throw new Error('Open CASCADE couldn’t write the IGES file.');
    } else {
      const w = keep(new o.STEPControl_Writer());
      w.Transfer(shape, o.STEPControl_StepModelType.AsIs);
      if (w.Write(outF).value !== o.IFSelect_ReturnStatus.RetDone.value) throw new Error('Open CASCADE couldn’t write the STEP file.');
    }
    await fsp.writeFile(out, o.FS.readFile(outF));
    return out;
  } finally {
    for (const f of [inF, outF]) try { o.FS.unlink(f); } catch (_) {}
    for (const x of junk.reverse()) try { x.delete(); } catch (_) {}
    idle = setTimeout(() => { oc = null; }, 120000);
    idle.unref?.();
  }
}

function write(m, to, opts = {}) {
  const topo = topology(m, opts);
  const name = opts.name || 'Model';
  if (to === 'brep') return writeBrep(topo, opts);
  if (to === 'iges' || to === 'igs') return writeIges(topo, { ...opts, file: `${name}.${to}` });
  return writeStep(topo, { ...opts, name, file: `${name}.${to}` });
}

module.exports = { topology, write, writeStep, writeIges, writeBrep, exact, kernel, KIND };
