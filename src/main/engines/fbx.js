'use strict';
const zlib = require('zlib');
const path = require('path');
const { triangulate, meshOf, rgb } = require('./cad');

const BAD = 'The FBX file is cut short or damaged.';
const SKIP = new Set(['Takes', 'References', 'Documents', 'Version5', 'AnimationStack', 'AnimationLayer', 'AnimationCurveNode', 'AnimationCurve', 'Pose', 'Deformer', 'NodeAttribute', 'CollectionExclusive', 'Constraint', 'Implementation', 'BindingTable']);
const SKIPPED = {};
const asNum = (v) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'boolean' ? +v : null);
const keyOf = (v) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'bigint' ? String(v) : null);
const child = (n, name) => n?.kids.find((c) => c.name === name);
const arr = (n) => (!n ? null : n.props.length === 1 && (ArrayBuffer.isView(n.props[0]) || Array.isArray(n.props[0])) ? n.props[0] : n.props.map(asNum).filter((v) => v != null));

function parseBinary(b) {
  if (b.length < 27) throw new Error(BAD);
  const wide = b.readUInt32LE(23) >= 7500, H = wide ? 25 : 13, SZ = { f: 4, i: 4, d: 8, l: 8, b: 1 };
  const u = (at) => (wide ? Number(b.readBigUInt64LE(at)) : b.readUInt32LE(at));
  let o = 27;
  const need = (n, end) => { if (!(n >= 0) || o + n > end) throw new Error(BAD); };
  const fix = (n, end, rd) => { need(n, end); const v = rd(o); o += n; return v; };
  const array = (t, end) => {
    need(12, end);
    const len = b.readUInt32LE(o), enc = b.readUInt32LE(o + 4), stored = b.readUInt32LE(o + 8), bytes = len * SZ[t];
    o += 12;
    need(stored, end);
    if (enc === 0 ? bytes !== stored : enc !== 1 || bytes > stored * 1032 + 64) throw new Error(BAD);
    let raw = b.subarray(o, o + stored);
    if (enc === 1) raw = zlib.inflateSync(raw, { maxOutputLength: Math.max(1, bytes) });
    if (raw.length !== bytes) throw new Error(BAD);
    o += stored;
    const ab = new Uint8Array(raw).buffer;
    return t === 'f' ? new Float32Array(ab) : t === 'd' ? new Float64Array(ab) : t === 'i' ? new Int32Array(ab) : t === 'l' ? Float64Array.from(new BigInt64Array(ab), Number) : Array.from(raw, (x) => x !== 0);
  };
  const prop = (end) => {
    const t = String.fromCharCode(fix(1, end, (at) => b[at]));
    switch (t) {
      case 'C': return fix(1, end, (at) => b[at] !== 0);
      case 'Y': return fix(2, end, (at) => b.readInt16LE(at));
      case 'I': return fix(4, end, (at) => b.readInt32LE(at));
      case 'L': return fix(8, end, (at) => b.readBigInt64LE(at));
      case 'F': return fix(4, end, (at) => b.readFloatLE(at));
      case 'D': return fix(8, end, (at) => b.readDoubleLE(at));
      case 'S': case 'R': { const n = fix(4, end, (at) => b.readUInt32LE(at)); const s = fix(n, end, (at) => b.subarray(at, at + n)); return t === 'S' ? s.toString('utf8') : Buffer.from(s); }
      default: if (SZ[t]) return array(t, end); throw new Error(BAD);
    }
  };
  const node = (end, depth) => {
    if (o + H > end) { if (depth === 0) return null; throw new Error(BAD); }
    const e = u(o), n = u(o + (wide ? 8 : 4)), len = u(o + (wide ? 16 : 8)), nl = b[o + H - 1];
    o += H;
    if (e === 0) return null;
    const ps = o + nl;
    if (depth > 64 || e > end || ps > e || len > e - ps || n > len) throw new Error(BAD);
    const name = b.toString('utf8', o, ps);
    if (depth <= 1 && SKIP.has(name)) { o = e; return SKIPPED; }
    const nd = { name, props: [], kids: [] }, pe = ps + len;
    o = ps;
    for (let i = 0; i < n; i++) nd.props.push(prop(pe));
    o = pe;
    while (o < e) { const c = node(e, depth + 1); if (!c) break; if (c !== SKIPPED) nd.kids.push(c); }
    o = e;
    return nd;
  };
  const root = [];
  for (let c; (c = node(b.length, 0));) if (c !== SKIPPED) root.push(c);
  if (!root.length) throw new Error(BAD);
  return root;
}

function parseAscii(text) {
  const n = text.length;
  let i = 0;
  const ws = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\ufeff';
  const invalid = () => new Error(`Line ${text.slice(0, i).split('\n').length} of the FBX file is not valid.`);
  const space = (nl) => {
    for (;;) {
      const c = text[i];
      if (c === ';' && nl) { const j = text.indexOf('\n', i); i = j < 0 ? n : j + 1; } else if (c === ' ' || c === '\t' || c === '\ufeff' || (nl && (c === '\r' || c === '\n'))) i++; else return;
    }
  };
  const value = (nd) => {
    if (text[i] === '"') { const j = text.indexOf('"', i + 1); if (j < 0) throw new Error(BAD); nd.props.push(text.slice(i + 1, j).replace(/&quot;/g, '"')); i = j + 1; return; }
    const s = i;
    while (i < n && !',{};'.includes(text[i]) && !ws(text[i])) i++;
    if (i === s) { i++; return; }
    const t = text.slice(s, i);
    if (t[0] === '*') return;
    const v = Number(t);
    nd.props.push(/^[-+]?\d+$/.test(t) && !Number.isSafeInteger(v) ? BigInt(t) : Number.isNaN(v) ? t : v);
  };
  const node = (depth) => {
    if (depth > 64) throw invalid();
    const s = i;
    while (i < n && !':{},"'.includes(text[i]) && !ws(text[i])) i++;
    if (i === s || text[i] !== ':') throw invalid();
    const nd = { name: text.slice(s, i), props: [], kids: [] };
    i++;
    if (nd.name === 'a') {
      const j = text.indexOf('}', i), end = j < 0 ? n : j, v = text.slice(i, end).split(',').filter((t) => t.trim()).map(Number);
      if (v.some(Number.isNaN)) throw invalid();
      nd.props.push(Float64Array.from(v));
      i = end;
      return nd;
    }
    space(false);
    while (i < n) {
      const c = text[i];
      if (c === '{') { i++; kids(nd, depth); break; }
      if (c === '\r' || c === '\n' || c === ';' || c === '}') break;
      if (c === ',') { i++; space(true); continue; }
      value(nd);
      space(false);
    }
    return nd;
  };
  const kids = (nd, depth) => {
    for (;;) {
      space(true);
      if (i >= n) throw new Error(BAD);
      if (text[i] === '}') { i++; break; }
      const c = node(depth + 1);
      if (!(depth === 0 && SKIP.has(c.name))) nd.kids.push(c);
    }
    if (nd.kids.length === 1 && nd.kids[0].name === 'a') { nd.props = nd.kids[0].props; nd.kids = []; }
  };
  const root = [];
  for (;;) { space(true); if (i >= n) break; const c = node(0); if (!SKIP.has(c.name)) root.push(c); }
  return root;
}

const M4 = (a, b) => { const o = Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c]; return o; };
const mul = (...ms) => ms.reduce(M4);
const T = ([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const S = ([x, y, z]) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const R = (k, d) => {
  const c = Math.cos((d * Math.PI) / 180), s = Math.sin((d * Math.PI) / 180);
  return k === 0 ? [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1] : k === 1 ? [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1] : [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};
const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 2, 0], [1, 0, 2], [2, 0, 1], [2, 1, 0]];
const E = (d, order = 0) => mul(...(ORDERS[order] || ORDERS[0]).map((k) => R(k, d[k])));
const transpose3 = (m) => [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
const det3 = (m) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
const add = (...vs) => [0, 1, 2].map((k) => vs.reduce((s, v) => s + v[k], 0));
const neg = (v) => v.map((x) => -x);
const Z0 = [0, 0, 0], ONE = [1, 1, 1], Z_UP = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

function readFbx(buf, p) {
  let doc;
  if (buf.subarray(0, 21).toString('latin1') === 'Kaydara FBX Binary  \0') {
    try { doc = parseBinary(buf); } catch (_) { throw new Error(BAD); }
  } else {
    const head = buf.subarray(0, 4096).toString('utf8').replace(/^\s+/, '');
    if (head.includes('\0') || !(head.startsWith('; FBX') || head.includes('FBXHeaderExtension:'))) throw new Error(`${path.basename(p)} isn’t an FBX model.`);
    doc = parseAscii(buf.toString('utf8'));
  }
  const top = (name) => doc.find((x) => x.name === name), objects = top('Objects');
  const gs = top('GlobalSettings') || child(objects, 'GlobalSettings');
  const objs = new Map(), templates = new Map(), parents = new Map(), geoms = new Map(), mats = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const x of objects?.kids || []) { const k = keyOf(x.props[0]); if (k != null && !objs.has(k)) objs.set(k, x); }
  for (const t of top('Definitions')?.kids || []) { const pt = t.name === 'ObjectType' && child(t, 'PropertyTemplate'); if (pt && !templates.has(t.props[0])) templates.set(t.props[0], pt); }
  for (const c of top('Connections')?.kids || []) {
    if ((c.name !== 'C' && c.name !== 'Connect') || c.props.length < 3) continue;
    const ck = keyOf(c.props[1]), pk = keyOf(c.props[2]), a = objs.get(ck), b = objs.get(pk);
    if (!a || !b || b.name !== 'Model') continue;
    if (a.name === 'Geometry') push(geoms, pk, a);
    else if (a.name === 'Model') { if (!parents.has(ck)) parents.set(ck, pk); } else if (a.name === 'Material') push(mats, pk, ck);
  }
  const own = (n, name) => { for (const l of n.kids) if (l.name === 'Properties70' || l.name === 'Properties60') for (const q of l.kids) if ((q.name === 'P' || q.name === 'Property') && q.props[0] === name) return q; return null; };
  const nums = (n, name) => (n && (own(n, name) || (templates.has(n.name) ? own(templates.get(n.name), name) : null)))?.props.slice(1).map(asNum).filter((v) => v != null) || [];
  const num = (n, name) => nums(n, name)[0];
  const vec = (n, name, d) => { const v = nums(n, name).slice(0, 3); return v.length === 3 && v.every(Number.isFinite) ? v : d; };

  const local = (n) => {
    const v = (k, d = Z0) => vec(n, k, d), sp = v('ScalingPivot'), rp = v('RotationPivot');
    return mul(T(neg(sp)), S(v('Lcl Scaling', ONE)), T(add(sp, v('ScalingOffset'), neg(rp))), transpose3(E(v('PostRotation'))), E(v('Lcl Rotation'), num(n, 'RotationOrder') | 0), E(v('PreRotation')), T(add(rp, v('RotationOffset'), v('Lcl Translation'))));
  };
  const worlds = new Map(), busy = new Set();
  const world = (k) => {
    if (worlds.has(k)) return worlds.get(k);
    busy.add(k);
    const pk = parents.get(k), w = pk != null && !busy.has(pk) ? M4(local(objs.get(k)), world(pk)) : local(objs.get(k));
    busy.delete(k);
    worlds.set(k, w);
    return w;
  };
  const geometric = (n) => mul(S(vec(n, 'GeometricScaling', ONE)), E(vec(n, 'GeometricRotation', Z0)), T(vec(n, 'GeometricTranslation', Z0)));

  let up = (num(gs, 'UpAxis') ?? 1) | 0, co = (num(gs, 'CoordAxis') ?? 0) | 0;
  if (up < 0 || up > 2) up = 1;
  if (co < 0 || co > 2 || co === up) co = up === 0 ? 1 : 0;
  const front = 3 - up - co, axis = Array(16).fill(0);
  axis[15] = 1; axis[co * 4] = num(gs, 'CoordAxisSign') < 0 ? -1 : 1; axis[up * 4 + 1] = num(gs, 'UpAxisSign') < 0 ? -1 : 1; axis[front * 4 + 2] = 1;
  if (det3(axis) < 0) axis[front * 4 + 2] = -1;
  const us = num(gs, 'UnitScaleFactor'), k10 = (us > 0 && Number.isFinite(us) ? us : 1) * 10, scene = mul(axis, S([k10, k10, k10]), Z_UP);

  const colors = new Map();
  const colorOf = (k) => { if (!colors.has(k)) { const n = objs.get(k); colors.set(k, rgb(...(vec(n, 'DiffuseColor', null) || vec(n, 'Diffuse', null) || [0.8, 0.8, 0.8]))); } return colors.get(k); };
  const matLayer = (g) => {
    for (const l of g.kids) {
      if (l.name !== 'LayerElementMaterial') continue;
      const v = arr(child(l, 'Materials')), map = child(l, 'MappingInformationType')?.props[0];
      if (v?.length && map === 'AllSame') return () => v[0];
      if (v?.length && map === 'ByPolygon') return (i) => v[i] ?? -1;
    }
    return null;
  };
  const pos = [], groups = new Map(), corners = [];
  for (const [k, n] of objs) {
    if (n.name !== 'Model') continue;
    const list = geoms.get(k) || (child(n, 'PolygonVertexIndex') ? [n] : null);
    if (!list) continue;
    const M = mul(geometric(n), world(k), scene), flip = det3(M) < 0, slots = mats.get(k) || [];
    for (const g of list) {
      const V = arr(child(g, 'Vertices')), F = arr(child(g, 'PolygonVertexIndex'));
      if (!V || !F) continue;
      const nv = Math.floor(V.length / 3), base = pos.length / 3, ml = matLayer(g);
      for (let i = 0; i < nv; i++) { const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2]; pos.push(x * M[0] + y * M[4] + z * M[8] + M[12], x * M[1] + y * M[5] + z * M[9] + M[13], x * M[2] + y * M[6] + z * M[10] + M[14]); }
      for (let i = 0, st = 0, poly = 0; i < F.length; i++) {
        if (F[i] >= 0 && i + 1 < F.length) continue;
        corners.length = 0;
        for (let j = st; j <= i; j++) { const c = F[j] < 0 ? ~F[j] : F[j]; if (c >= nv) throw new Error(`A polygon of the FBX model refers to vertex ${c + 1}, but the mesh has only ${nv}.`); corners.push(base + c); }
        const mk = slots[ml ? ml(poly) : 0] ?? '';
        if (!groups.has(mk)) groups.set(mk, { idx: [], color: mk === '' ? null : colorOf(mk) });
        triangulate(pos, flip ? corners.reverse() : corners, groups.get(mk).idx);
        st = i + 1; poly++;
      }
    }
  }
  return meshOf(pos, groups.values());
}

module.exports = { readFbx };
