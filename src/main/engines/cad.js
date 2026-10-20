'use strict';
const U = require('./util');
const { fs, fsp, path } = U;

const KINDS = { cad2d: U.GROUPS.cad2d, cad3d: U.GROUPS.cad3d };
const ACI = require('dxf-parser/dist/AutoCadColorIndex').default;
const aci = (i) => ACI[i] ?? 0;
const hex = (c) => `#${(c >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`;
const P = (p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 });
const deg = (d) => (d * Math.PI) / 180;
const unit3 = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const cross3 = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
function axes(n) {
  const N = unit3({ x: Number(n?.x) || 0, y: Number(n?.y) || 0, z: n?.z == null ? 1 : Number(n.z) || 0 });
  const X = unit3(Math.abs(N.x) < 1 / 64 && Math.abs(N.y) < 1 / 64 ? { x: N.z, y: 0, z: -N.x } : { x: -N.y, y: N.x, z: 0 });
  return { N, X, Y: cross3(N, X) };
}
const ocs = (n, z) => { if (!n || (!Number(n.x) && !Number(n.y) && !(Number(n.z) < 0))) return null; const { N, X, Y } = axes(n), e = Number(z) || 0; return [X.x, X.y, Y.x, Y.y, e * N.x, e * N.y]; };
function frame(n, dir, rot, p) {
  const { N, X, Y } = axes(n), c = Math.cos(rot), s = Math.sin(rot);
  const d = dir && (dir.x || dir.y || dir.z) ? unit3({ x: dir.x || 0, y: dir.y || 0, z: dir.z || 0 }) : { x: X.x * c + Y.x * s, y: X.y * c + Y.y * s, z: X.z * c + Y.z * s }, u = cross3(N, d);
  return [d.x, d.y, u.x, u.y, p.x, p.y];
}
const dxfColor = (e) => (e.colorIndex === 0 ? 'block' : e.color != null && e.colorIndex !== 256 && (e.colorIndex == null || e.color !== ACI[Math.abs(e.colorIndex)]) ? { rgb: e.color } : e.colorIndex > 0 && e.colorIndex < 256 ? e.colorIndex : null);
const dwgColor = (e) => (e.color != null ? { rgb: e.color } : e.colorIndex === 0 ? 'block' : e.colorIndex > 0 && e.colorIndex < 256 ? e.colorIndex : null);

const DWG_LW = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
const dxfWeight = (v) => (v == null || v === -1 ? 'layer' : v === -2 ? 'block' : v < 0 ? null : v / 100);
const dwgWeight = (v) => (v == null || v === 29 ? 'layer' : v === 30 ? 'block' : v < 24 ? DWG_LW[v] / 100 : null);
const patterns = (list, of) => Object.fromEntries(list.map((t) => [String(t.name).toUpperCase(), (of(t) || []).map(Number)]));
function dxfLayers(text) {
  const out = {}, L = text.split(/\r?\n/);
  let table = false, cur = null;
  for (let i = 0; i + 1 < L.length; i += 2) {
    const c = L[i].trim(), v = L[i + 1].trim();
    if (c === '0') { if (v === 'ENDTAB') table = false; cur = table && v === 'LAYER' ? {} : null; } else if (c === '2' && !table && v === 'LAYER' && L[i - 1]?.trim() === 'TABLE') table = true;
    else if (cur) { if (c === '2') out[v] = cur; else if (c === '6') cur.lt = v; else if (c === '370') cur.lw = dxfWeight(Number(v)); else if (c === '62') cur.color = Number(v); else if (c === '70') cur.flags = Number(v); else if (c === '420') cur.rgb = Number(v) & 0xffffff; else if (c === '290') cur.plot = v !== '0'; }
    if (v === 'ENDSEC' && c === '0') table = false;
  }
  return out;
}
const gv = (list, c, d) => { const x = list?.find((q) => q[0] === c); return x ? Number(x[1]) : d; };
function fromDxf(dxf, text = '') {
  const extra = dxfLayers(text);
  const g = (e, c, d) => gv(e.raw?.[0], c, d);
  const N = (e) => (e.raw ? { x: g(e, 210, 0), y: g(e, 220, 0), z: g(e, 230, 1) } : e.extrusionDirection || { x: e.extrusionDirectionX || 0, y: e.extrusionDirectionY || 0, z: e.extrusionDirectionZ ?? 1 });
  const conv = (e) => {
    const base = { lw: dxfWeight(e.lineweight), lt: e.lineType || 'BYLAYER', lts: e.lineTypeScale || 1, layer: e.layer || '0', color: dxfColor(e) };
    switch (e.type) {
      case 'LINE': return { ...base, t: 'line', a: P(e.vertices[0]), b: P(e.vertices[1]) };
      case 'XLINE': case 'RAY': return { ...base, t: 'xline', p: P(e.vertices?.[0]), d: P(e.vertices?.[1]), ray: e.type === 'RAY' };
      case 'LWPOLYLINE': { const cw = e.width || 0; return { ...base, t: 'poly', pts: (e.vertices || []).map((v) => ({ ...P(v), b: v.bulge || 0, w0: v.startWidth ?? cw, w1: v.endWidth ?? cw })), closed: !!e.shape, ocs: ocs(N(e), e.elevation) }; }
      case 'POLYLINE': {
        const vr = (e.raw || []).filter((r) => r[0]?.[1] === 'VERTEX'), w0 = g(e, 40, 0), w1 = g(e, 41, 0);
        return { ...base, t: 'poly', pts: (e.vertices || []).map((v, k) => ({ ...P(v), b: v.bulge || 0, w0: gv(vr[k], 40, w0), w1: gv(vr[k], 41, w1) })), closed: !!e.shape, ocs: e.is3dPolyline || e.is3dPolygonMesh || e.isPolyfaceMesh ? null : ocs(N(e), g(e, 30, 0)) };
      }
      case 'CIRCLE': return { ...base, t: 'circle', c: P(e.center), r: e.radius, ocs: ocs(N(e), e.center?.z) };
      case 'ARC': return { ...base, t: 'arc', c: P(e.center), r: e.radius, a0: e.startAngle, a1: e.endAngle, ocs: ocs(N(e), e.center?.z) };
      case 'ELLIPSE': return { ...base, t: 'ellipse', c: P(e.center), m: P(e.majorAxisEndPoint), ratio: e.axisRatio * (N(e).z < 0 ? -1 : 1), a0: e.startAngle ?? 0, a1: e.endAngle ?? Math.PI * 2 };
      case 'SPLINE': return { ...base, t: 'spline', ctrl: (e.controlPoints || []).map(P), fit: (e.fitPoints || []).map(P), degree: e.degreeOfSplineCurve || 3, knots: e.knotValues || [] };
      case 'TEXT': return { ...base, t: 'text', p: P(e.halign || e.valign ? e.endPoint || e.startPoint : e.startPoint), h: e.textHeight || 1, rot: deg(e.rotation || 0), text: e.text || '', align: e.halign || 0, ocs: ocs(N(e), e.startPoint?.z) };
      case 'MTEXT': return { ...base, t: 'text', p: { x: 0, y: 0 }, h: e.height || 1, rot: 0, ocs: frame(N(e), e.directionVector, deg(e.rotation || 0), P(e.position)), text: mtext(e.text || ''), attach: e.attachmentPoint || 1, multi: true };
      case 'INSERT': return { ...base, t: 'insert', name: e.name, p: P(e.position), sx: e.xScale ?? 1, sy: e.yScale ?? 1, rot: deg(e.rotation || 0), cols: e.columnCount || 1, rows: e.rowCount || 1, cs: e.columnSpacing || 0, rs: e.rowSpacing || 0, ocs: ocs(N(e), e.position?.z) };
      case 'DIMENSION': return e.block ? { ...base, t: 'insert', name: e.block, p: { x: 0, y: 0 }, sx: 1, sy: 1, rot: 0 } : null;
      case 'POINT': return { ...base, t: 'point', p: P(e.position) };
      case 'SOLID': case 'TRACE': return { ...base, t: 'solid', pts: (e.points || []).map(P), ocs: ocs(N(e), e.points?.[0]?.z) };
      case '3DFACE': return { ...base, t: 'face', pts: [10, 11, 12, 13].filter((c) => g(e, c) != null).map((c) => ({ x: g(e, c, 0), y: g(e, c + 10, 0) })), flags: g(e, 70, 0) };
      case 'HATCH': return e.loops?.length ? { ...base, t: 'hatch', loops: e.loops, solid: e.solid, ocs: ocs(N(e), e.elevation) } : null;
      default: return null;
    }
  };
  const blocks = {};
  for (const [name, b] of Object.entries(dxf.blocks || {})) blocks[name] = { base: P(b.position), ents: (b.entities || []).map(conv).filter(Boolean) };
  const layers = {}, parsed = dxf.tables?.layer?.layers || {};
  for (const name of new Set([...Object.keys(parsed), ...Object.keys(extra)])) {
    const l = parsed[name] || {}, x = extra[name] || {}, ci = x.color ?? (l.colorIndex == null ? 7 : l.visible === false ? -l.colorIndex : l.colorIndex);
    layers[name] = { color: Math.abs(ci) % 256 || 7, rgb: x.rgb ?? null, off: ci < 0, frozen: x.flags == null ? l.frozen === true : !!(x.flags & 1), plot: x.plot !== false, lw: x.lw === 'layer' ? null : x.lw ?? null, lt: x.lt || 'CONTINUOUS' };
  }
  const space = (paper) => (dxf.entities || []).filter((e) => !e.inPaperSpace === !paper).map(conv).filter(Boolean);
  return { ents: space(false), paper: space(true), blocks, layers, units: dxf.header?.$INSUNITS, ltypes: patterns(Object.values(dxf.tables?.lineType?.lineTypes || {}), (t) => t.pattern), ltscale: Number(dxf.header?.$LTSCALE) || 1 };
}
function tapDxf(parser) {
  const H = parser._entityHandlers;
  H.TRACE = Object.assign(Object.create(H.SOLID), { ForEntityName: 'TRACE' });
  for (const t of ['XLINE', 'RAY']) H[t] = Object.assign(Object.create(H.LINE), { ForEntityName: t });
  for (const t of ['POLYLINE', 'CIRCLE', 'TEXT', 'MTEXT', 'ELLIPSE', '3DFACE']) {
    const h = H[t];
    H[t] = { ForEntityName: t, parseEntity(sc, curr) {
      const s = sc._pointer, e = h.parseEntity(sc, curr), d = sc._data, raw = [[]];
      for (let i = s; i < sc._pointer - 2; i += 2) { const c = parseInt(d[i], 10); if (c === 0) raw.push([]); raw[raw.length - 1].push([c, d[i + 1].trim()]); }
      e.raw = raw;
      return e;
    } };
  }
}
function fromDwg(db) {
  const conv = (e) => {
    const base = { lw: dwgWeight(e.lineweight), lt: e.lineType || 'BYLAYER', lts: e.lineTypeScale || 1, layer: e.layer || '0', color: dwgColor(e) };
    if (e.isVisible === false) return null;
    const W = (v, d) => { const w0 = v.startWidth ?? d.w0, w1 = v.endWidth ?? d.w1; return w0 < 0 ? { w0: -w0, w1: -w0 } : { w0, w1 }; };
    switch (e.type) {
      case 'LINE': return { ...base, t: 'line', a: P(e.startPoint), b: P(e.endPoint) };
      case 'XLINE': case 'RAY': return { ...base, t: 'xline', p: P(e.firstPoint), d: P(e.unitDirection), ray: e.type === 'RAY' };
      case 'LWPOLYLINE': { const cw = e.constantWidth || 0; return { ...base, t: 'poly', pts: (e.vertices || []).map((v) => ({ ...P(v), b: v.bulge || 0, ...W(v, { w0: cw, w1: cw }) })), closed: !!(e.flag & 1), ocs: ocs(e.extrusionDirection, e.elevation) }; }
      case 'POLYLINE2D': return { ...base, t: 'poly', pts: (e.vertices || []).filter((v) => !(v.flag & 16)).map((v) => ({ ...P(v), b: v.bulge || 0, ...W(v, { w0: e.startWidth || 0, w1: e.endWidth || 0 }) })), closed: !!(e.flag & 1), ocs: ocs(e.extrusionDirection, e.elevation) };
      case 'POLYLINE3D': return { ...base, t: 'poly', pts: (e.vertices || []).filter((v) => !(v.flag & 16)).map((v) => ({ ...P(v), b: v.bulge || 0 })), closed: !!(e.flag & 1) };
      case 'CIRCLE': return { ...base, t: 'circle', c: P(e.center), r: e.radius, ocs: ocs(e.extrusionDirection, e.center?.z) };
      case 'ARC': return { ...base, t: 'arc', c: P(e.center), r: e.radius, a0: e.startAngle, a1: e.endAngle, ocs: ocs(e.extrusionDirection, e.center?.z) };
      case 'ELLIPSE': return { ...base, t: 'ellipse', c: P(e.center), m: P(e.majorAxisEndPoint), ratio: e.axisRatio * (e.extrusionDirection?.z < 0 ? -1 : 1), a0: e.startAngle ?? 0, a1: e.endAngle ?? Math.PI * 2 };
      case 'SPLINE': return { ...base, t: 'spline', ctrl: (e.controlPoints || []).map(P), fit: (e.fitPoints || []).map(P), degree: e.degree || 3, knots: e.knots || [] };
      case 'TEXT': return { ...base, t: 'text', p: P(e.halign || e.valign ? (e.endPoint?.x || e.endPoint?.y ? e.endPoint : e.startPoint) : e.startPoint), h: e.textHeight || 1, rot: e.rotation || 0, text: e.text || '', align: e.halign || 0, ocs: ocs(e.extrusionDirection, e.elevation) };
      case 'ATTRIB': return e.text ? { ...base, t: 'text', p: P(e.text.startPoint), h: e.text.textHeight || 1, rot: e.text.rotation || 0, text: e.text.text || '', align: e.text.halign || 0, ocs: ocs(e.text.extrusionDirection, e.text.elevation) } : null;
      case 'MTEXT': return { ...base, t: 'text', p: { x: 0, y: 0 }, h: e.textHeight || 1, rot: 0, ocs: frame(e.extrusionDirection, e.direction, e.rotation || 0, P(e.insertionPoint)), text: mtext(e.text || ''), attach: e.attachmentPoint || 1, multi: true };
      case 'INSERT': return { ...base, t: 'insert', name: e.name, p: P(e.insertionPoint), sx: e.xScale ?? 1, sy: e.yScale ?? 1, rot: e.rotation || 0, cols: e.columnCount || 1, rows: e.rowCount || 1, cs: e.columnSpacing || 0, rs: e.rowSpacing || 0, ocs: ocs(e.extrusionDirection, e.insertionPoint?.z), attribs: (e.attribs || []).map(conv).filter(Boolean) };
      case 'DIMENSION': return e.name ? { ...base, t: 'insert', name: e.name, p: { x: 0, y: 0 }, sx: 1, sy: 1, rot: 0 } : null;
      case 'POINT': return { ...base, t: 'point', p: P(e.position) };
      case 'SOLID': case 'TRACE': return { ...base, t: 'solid', pts: [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean).map(P), ocs: ocs(e.extrusionDirection, e.corner1?.z ?? e.elevation) };
      case '3DFACE': return { ...base, t: 'face', pts: [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean).map(P), flags: e.flag || 0 };
      case 'HATCH': return { ...base, t: 'hatch', solid: !!e.solidFill, loops: (e.boundaryPaths || []).map(hatchLoop).filter((l) => l.length > 1), ocs: ocs(e.extrusionDirection, e.elevation) };
      default: return null;
    }
  };
  const recs = db.tables?.BLOCK_RECORD?.entries || [], space = (re) => recs.filter((b) => re.test(b.name)).flatMap((b) => b.entities || []);
  const blocks = {};
  for (const b of recs) if (!/^\*(Model|Paper)_Space/i.test(b.name)) blocks[b.name] = { base: P(b.basePoint), ents: (b.entities || []).map(conv).filter(Boolean) };
  const layers = {};
  for (const l of db.tables?.LAYER?.entries || []) { const lw = dwgWeight(l.lineweight); layers[l.name] = { color: l.colorIndex > 0 && l.colorIndex < 256 ? l.colorIndex : 7, rgb: l.colorIndex === 256 ? l.color : null, off: !!l.off || l.colorIndex < 0, frozen: !!l.frozen, plot: l.plotFlag == null || !!l.plotFlag, lw: typeof lw === 'number' ? lw : null, lt: l.lineType || 'CONTINUOUS' }; }
  const ents = recs.some((b) => /^\*Model_Space$/i.test(b.name)) ? space(/^\*Model_Space$/i) : db.entities || [];
  return { ents: ents.map(conv).filter(Boolean), paper: space(/^\*Paper_Space/i).map(conv).filter(Boolean), blocks, layers, units: db.header?.INSUNITS, ltypes: patterns(db.tables?.LTYPE?.entries || [], (t) => (t.pattern || t.dashes || []).map((p) => (typeof p === 'number' ? p : p?.elementLength ?? p?.length ?? 0))), ltscale: Number(db.header?.LTSCALE) || 1 };
}
function hatchLoop(bp) {
  if (bp.polylineVertices?.length || bp.vertices?.length) return (bp.polylineVertices || bp.vertices).map(P);
  const out = [];
  for (const e of bp.edges || []) {
    if (e.type === 1) { out.push(P(e.start), P(e.end)); continue; }
    if (e.type === 2 && e.center) { const n = 24, a0 = e.startAngle ?? 0, a1 = e.endAngle ?? Math.PI * 2; let s = a0, d = a1 - a0; if (e.isCCW === false || e.counterClockwise === false) d = -(Math.PI * 2 - d); for (let i = 0; i <= n; i++) { const a = s + (d * i) / n; out.push({ x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) }); } }
  }
  return out;
}
class DxfHatch {
  constructor() { this.ForEntityName = 'HATCH'; }
  parseEntity(scanner, curr) {
    const g = [], e = { type: curr.value, loops: [], solid: false };
    for (curr = scanner.next(); !scanner.isEOF() && curr.code !== 0; curr = scanner.next()) g.push([curr.code, curr.value]);
    let i = 0;
    const take = (c) => (g[i]?.[0] === c ? Number(g[i++][1]) : null);
    const pt = (c) => { const x = take(c), y = take(c + 10); return { x: x || 0, y: y || 0 }; };
    const skip = (...cs) => { while (g[i] && cs.includes(g[i][0])) i++; };
    const sweep = (c, r, rx, ry, rot, a0, a1, ccw) => {
      if (!ccw) [a0, a1] = [-a0, -a1];
      let d = a1 - a0;
      if (ccw) while (d <= 0) d += Math.PI * 2; else while (d >= 0) d -= Math.PI * 2;
      const n = Math.max(8, Math.ceil((Math.abs(d) * 48) / Math.PI));
      return Array.from({ length: n + 1 }, (_, k) => { const t = a0 + (d * k) / n, x = rx * Math.cos(t), y = ry * Math.sin(t); return { x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) }; });
    };
    while (i < g.length) {
      const [code, value] = g[i++];
      if (code === 8) e.layer = value;
      else if (code === 62) e.colorIndex = Number(value);
      else if (code === 420) e.color = Number(value);
      else if (code === 70) e.solid = (Number(value) & 1) === 1;
      else if (code === 30) e.elevation = Number(value);
      else if (code === 210 || code === 220 || code === 230) (e.extrusionDirection ||= { x: 0, y: 0, z: 1 })['xyz'[(code - 210) / 10]] = Number(value);
      else if (code === 91) {
        for (let n = Number(value); n > 0 && i < g.length; n--) {
          const flags = take(92) || 0, pts = [];
          if (flags & 2) {
            const bulged = take(72), closed = take(73), count = take(93) || 0, vs = [];
            for (let k = 0; k < count; k++) { const v = pt(10); v.b = bulged ? take(42) || 0 : 0; vs.push(v); }
            vs.forEach((v, k) => { pts.push(v); const nx = vs[(k + 1) % vs.length]; if (v.b && (closed || k < vs.length - 1)) pts.push(...bulgePts(v, nx, v.b)); });
          } else {
            for (let edges = take(93) || 0; edges > 0; edges--) {
              const type = take(72);
              if (type === 1) pts.push(pt(10), pt(11));
              else if (type === 2) { const c = pt(10), r = take(40), a0 = deg(take(50)), a1 = deg(take(51)); pts.push(...sweep(c, r, r, r, 0, a0, a1, take(73) !== 0)); }
              else if (type === 3) { const c = pt(10), m = pt(11), ratio = take(40), a0 = deg(take(50)), a1 = deg(take(51)), R = Math.hypot(m.x, m.y); pts.push(...sweep(c, R, R, R * ratio, Math.atan2(m.y, m.x), a0, a1, take(73) !== 0)); }
              else if (type === 4) {
                const degree = take(94) || 3, rational = take(73); take(74);
                const nk = take(95) || 0, nc = take(96) || 0, knots = [], ctrl = [];
                for (let k = 0; k < nk; k++) knots.push(take(40));
                for (let k = 0; k < nc; k++) { ctrl.push(pt(10)); if (rational) take(42); }
                if (g[i]?.[0] === 97 && [11, 97].includes(g[i + 1]?.[0])) { const nf = take(97); for (let k = 0; k < nf; k++) pt(11); skip(12, 22, 13, 23); }
                pts.push(...(ctrl.length > 1 ? bspline(ctrl, degree, knots) : ctrl));
              } else break;
            }
          }
          const src = take(97) || 0;
          for (let k = 0; k < src; k++) take(330);
          if (pts.length > 2) e.loops.push(pts);
        }
      }
    }
    return e;
  }
}
const area = (l) => l.reduce((a, p, k) => { const q = l[(k + 1) % l.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2;
const inside = (p, l) => { let c = false; for (let k = 0, j = l.length - 1; k < l.length; j = k++) if ((l[k].y > p.y) !== (l[j].y > p.y) && p.x < ((l[j].x - l[k].x) * (p.y - l[k].y)) / (l[j].y - l[k].y) + l[k].x) c = !c; return c; };
function mtext(s) {
  return s.replace(/\\P/g, '\n').replace(/\\[ACcFfHhLlOoQqTtWw][^;\\]*;?/g, '').replace(/\\S([^^;]*)\^([^;]*);/g, '$1/$2').replace(/[{}]/g, '').replace(/\\~/g, ' ').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/\\\\/g, '\\');
}

const ident = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
const ARC_STEPS = 180;
function arcPts(c, r, a0, a1) {
  let d = a1 - a0;
  while (d <= 0) d += Math.PI * 2;
  const n = Math.max(4, Math.ceil((ARC_STEPS * d) / (Math.PI * 2)));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: c.x + r * Math.cos(a0 + (d * i) / n), y: c.y + r * Math.sin(a0 + (d * i) / n) }));
}
function bulgeArc(a, b, k) {
  const ch = Math.hypot(b.x - a.x, b.y - a.y);
  if (!ch || !k) return null;
  const d = (ch * (1 - k * k)) / (4 * k), c = { x: (a.x + b.x) / 2 - ((b.y - a.y) / ch) * d, y: (a.y + b.y) / 2 + ((b.x - a.x) / ch) * d };
  return { c, r: Math.hypot(a.x - c.x, a.y - c.y), s: Math.atan2(a.y - c.y, a.x - c.x), th: 4 * Math.atan(k) };
}
function bulgePts(a, b, k) {
  const A = bulgeArc(a, b, k);
  if (!A) return [];
  const n = Math.max(6, Math.ceil(Math.abs(A.th) / (Math.PI / 90)));
  return Array.from({ length: n }, (_, i) => { const t = A.s + (A.th * (i + 1)) / n; return { x: A.c.x + A.r * Math.cos(t), y: A.c.y + A.r * Math.sin(t) }; });
}
function band(a, b) {
  const A = bulgeArc(a, b, a.b), n = A ? Math.max(4, Math.ceil(Math.abs(A.th) / deg(10))) : 1, ch = Math.hypot(b.x - a.x, b.y - a.y) || 1, L = [], R = [];
  for (let i = 0; i <= n; i++) {
    const w = (a.w0 + ((a.w1 - a.w0) * i) / n) / 2;
    if (A) { const t = A.s + (A.th * i) / n, c = Math.cos(t), s = Math.sin(t); L.push({ x: A.c.x + (A.r + w) * c, y: A.c.y + (A.r + w) * s }); R.push({ x: A.c.x + Math.max(0, A.r - w) * c, y: A.c.y + Math.max(0, A.r - w) * s }); }
    else { const p = i ? b : a, nx = -(b.y - a.y) / ch, ny = (b.x - a.x) / ch; L.push({ x: p.x + nx * w, y: p.y + ny * w }); R.push({ x: p.x - nx * w, y: p.y - ny * w }); }
  }
  return [...L, ...R.reverse()];
}
function clip(p, d, ray, [x0, y0, x1, y1]) {
  if (!d.x && !d.y) return null;
  let t0 = ray ? 0 : -Infinity, t1 = Infinity;
  for (const [q, v, lo, hi] of [[p.x, d.x, x0, x1], [p.y, d.y, y0, y1]]) {
    if (Math.abs(v) < 1e-12) { if (q < lo || q > hi) return null; continue; }
    const a = (lo - q) / v, b = (hi - q) / v;
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 < t1 ? [{ x: p.x + d.x * t0, y: p.y + d.y * t0 }, { x: p.x + d.x * t1, y: p.y + d.y * t1 }] : null;
}
function bspline(ctrl, degree, knots) {
  const n = ctrl.length;
  const k = Math.min(degree, n - 1);
  if (n < 2) return ctrl;
  const kv = knots.length === n + k + 1 ? knots : [...Array(k + 1).fill(0), ...Array.from({ length: n - k - 1 }, (_, i) => i + 1), ...Array(k + 1).fill(n - k)];
  const lo = kv[k], hi = kv[n];
  const steps = Math.max(32, n * 12);
  const out = [];
  for (let s = 0; s <= steps; s++) {
    const t = lo + ((hi - lo) * s) / steps - (s === steps ? 1e-9 : 0);
    let span = k;
    while (span < n - 1 && t >= kv[span + 1]) span++;
    const d = Array.from({ length: k + 1 }, (_, j) => ({ ...ctrl[span - k + j] }));
    for (let r = 1; r <= k; r++) for (let j = k; j >= r; j--) {
      const i = span - k + j;
      const den = kv[i + k - r + 1] - kv[i];
      const a = den ? (t - kv[i]) / den : 0;
      d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y };
    }
    out.push(d[k]);
  }
  return out;
}
function catmull(pts) {
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    for (let s = 0; s < 12; s++) {
      const t = s / 12, t2 = t * t, t3 = t2 * t;
      out.push({ x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3), y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3) });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function flatten(model) {
  const out = [], later = [], L = (n) => model.layers[n];
  const colorOf = (e, lay, inh) => (e.color === 'block' ? inh.col : e.color ?? (L(lay) ? (L(lay).rgb != null ? { rgb: L(lay).rgb } : L(lay).color) : 7));
  const weightOf = (e, lay, inh) => (e.lw === 'layer' ? L(lay)?.lw ?? null : e.lw === 'block' ? inh.lw : e.lw ?? null);
  const typeOf = (e, lay, inh) => (/^bylayer$/i.test(e.lt || 'BYLAYER') ? L(lay)?.lt || 'CONTINUOUS' : /^byblock$/i.test(e.lt) ? inh.lt : e.lt);
  const walk = (ents, m, inh, depth) => {
    for (const e of ents) {
      const lay = e.layer === '0' && inh.layer ? inh.layer : e.layer, l = L(lay);
      if (l?.frozen || (e.t !== 'insert' && (l?.off || l?.plot === false || /^defpoints$/i.test(lay)))) continue;
      const M = e.ocs ? mul(m, e.ocs) : m;
      const col = colorOf(e, lay, inh), rgb = typeof col === 'object' ? col.rgb : aci(col);
      const scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
      const lw = weightOf(e, lay, inh), lt = typeOf(e, lay, inh), pat = model.ltypes?.[String(lt).toUpperCase()];
      const dash = pat?.length >= 2 && pat.some((v) => v < 0) && pat.every(Number.isFinite) ? pat.map((v) => v * (model.ltscale || 1) * (e.lts || 1) * scale) : null;
      const item = (pts, closed, fill, ww) => ({ k: 'path', pts, closed, fill, rgb, lw, dash: fill ? null : dash, aci: typeof col === 'number' ? col : null, layer: lay, ...(ww ? { ww } : {}) });
      const push = (pts, closed, fill, ww) => pts.length > 1 && out.push(item(pts.map((p) => ap(M, p)), closed, fill, ww));
      switch (e.t) {
        case 'line': push([e.a, e.b]); break;
        case 'xline': { const p = ap(M, e.p), d = { x: M[0] * e.d.x + M[2] * e.d.y, y: M[1] * e.d.x + M[3] * e.d.y }; later.push((box) => { const s = clip(p, d, e.ray, box); if (s) out.push(item(s)); }); break; }
        case 'poly': {
          const n = e.pts.length, segs = e.pts.slice(0, e.closed ? n : n - 1), cw = segs[0]?.w0 || 0;
          if (segs.every((a) => (a.w0 || 0) === cw && (a.w1 || 0) === cw)) {
            const pts = [];
            for (let i = 0; i < n; i++) { const a = e.pts[i], b = e.pts[(i + 1) % n]; pts.push(a); if (a.b && (i < n - 1 || e.closed)) pts.push(...bulgePts(a, b, a.b)); }
            push(pts, e.closed, false, cw * scale);
            break;
          }
          let run = [];
          segs.forEach((a, i) => {
            const b = e.pts[(i + 1) % n];
            if (a.w0 || a.w1) { push(run); run = []; push(band(a, b), true, true); } else run.push(...(run.length ? [] : [a]), ...(a.b ? bulgePts(a, b, a.b) : [b]));
          });
          push(run);
          break;
        }
        case 'circle': push(arcPts(e.c, e.r, 0, Math.PI * 2), true); break;
        case 'arc': push(arcPts(e.c, e.r, e.a0, e.a1)); break;
        case 'ellipse': {
          const R = Math.hypot(e.m.x, e.m.y), rot = Math.atan2(e.m.y, e.m.x), r2 = R * e.ratio;
          let d = e.a1 - e.a0;
          while (d <= 0) d += Math.PI * 2;
          const n = Math.max(12, Math.ceil((96 * d) / (Math.PI * 2)));
          push(Array.from({ length: n + 1 }, (_, i) => { const t = e.a0 + (d * i) / n; const x = R * Math.cos(t), y = r2 * Math.sin(t); return { x: e.c.x + x * Math.cos(rot) - y * Math.sin(rot), y: e.c.y + x * Math.sin(rot) + y * Math.cos(rot) }; }), d >= Math.PI * 2 - 1e-6);
          break;
        }
        case 'spline': push(e.ctrl.length >= 2 ? bspline(e.ctrl, e.degree, e.knots) : catmull(e.fit)); break;
        case 'point': out.push({ k: 'point', p: ap(M, e.p), rgb, layer: lay }); break;
        case 'solid': { const [a, b, c, d] = e.pts; push(d && (d.x !== c.x || d.y !== c.y) ? [a, b, d, c] : [a, b, c], true, true); break; }
        case 'face': {
          if (!(e.flags & 15)) { push(e.pts, true); break; }
          e.pts.forEach((a, i) => { const b = e.pts[(i + 1) % e.pts.length]; if (!(e.flags & (1 << i)) && (a.x !== b.x || a.y !== b.y)) push([a, b]); });
          break;
        }
        case 'hatch': {
          const loops = e.loops.filter((l) => l.length > 2).map((l) => l.map((p) => ap(M, p)));
          const sub = loops.map((l, k) => ((area(l) > 0) === (loops.filter((o, j) => j !== k && inside(l[0], o)).length % 2 === 0) ? l : l.slice().reverse()));
          if (sub.length) out.push({ k: 'path', pts: sub.flat(), sub, closed: true, fill: true, tint: !e.solid, rgb, aci: typeof col === 'number' ? col : null, layer: lay });
          break;
        }
        case 'text': {
          if (!e.text.trim()) break;
          const c = Math.cos(e.rot), s = Math.sin(e.rot), f = M[0] * M[3] - M[1] * M[2] < 0 ? -1 : 1;
          out.push({ k: 'text', p: ap(M, e.p), h: e.h * scale, rot: Math.atan2(f * (M[1] * c + M[3] * s), f * (M[0] * c + M[2] * s)), text: e.text, align: f < 0 ? [2, 1, 0][e.align] ?? e.align : e.align, attach: f < 0 && e.attach ? e.attach + [2, 0, -2][(e.attach - 1) % 3] : e.attach, multi: e.multi, rgb, layer: lay });
          break;
        }
        case 'insert': {
          const b = model.blocks[e.name], sub = { col, lw, lt, layer: lay };
          if (!b || depth > 12) break;
          for (let r = 0; r < (e.rows || 1); r++) for (let c = 0; c < (e.cols || 1); c++) {
            const t = mul(mul(mul(M, [1, 0, 0, 1, e.p.x, e.p.y]), [Math.cos(e.rot), Math.sin(e.rot), -Math.sin(e.rot), Math.cos(e.rot), 0, 0]), [e.sx, 0, 0, e.sy, c * (e.cs || 0), r * (e.rs || 0)]);
            walk(b.ents, mul(t, [1, 0, 0, 1, -b.base.x, -b.base.y]), sub, depth + 1);
          }
          if (e.attribs?.length) walk(e.attribs, m, sub, depth + 1);
          break;
        }
        default:
      }
    }
  };
  const top = { col: 7, lw: null, lt: 'CONTINUOUS', layer: null };
  walk(model.ents, ident, top, 0);
  if (!out.length && !later.length && model.paper?.length) walk(model.paper, ident, top, 0);
  if (later.length) { const x = extents(out), mg = Math.max(x.x1 - x.x0, x.y1 - x.y0) * 0.05; later.forEach((f) => f([x.x0 - mg, x.y0 - mg, x.x1 + mg, x.y1 + mg])); }
  return out;
}
function bounds(it) {
  if (it.k === 'path') { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of it.pts) { if (p.x < a) a = p.x; if (p.y < b) b = p.y; if (p.x > c) c = p.x; if (p.y > d) d = p.y; } const h = (it.ww || 0) / 2; return [a - h, b - h, c + h, d + h]; }
  if (it.k === 'text') { const w = it.h * it.text.split('\n').reduce((m, l) => Math.max(m, l.length), 0) * 0.6, hh = it.h * it.text.split('\n').length * 1.4; return [it.p.x - (it.multi ? 0 : w / 2) * 0, it.p.y - hh, it.p.x + w, it.p.y + it.h]; }
  return [it.p.x, it.p.y, it.p.x, it.p.y];
}
function extents(items) {
  const bs = items.map(bounds).filter((b) => b.every(Number.isFinite));
  if (!bs.length) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  let keep = bs;
  if (bs.length >= 8) {
    const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * f)))];
    const cx = bs.map((b) => (b[0] + b[2]) / 2).sort((a, b) => a - b), cy = bs.map((b) => (b[1] + b[3]) / 2).sort((a, b) => a - b);
    const lx = q(cx, 0.03), hx = q(cx, 0.97), ly = q(cy, 0.03), hy = q(cy, 0.97);
    const sx = Math.max(hx - lx, (hy - ly) * 0.2, 1e-9), sy = Math.max(hy - ly, (hx - lx) * 0.2, 1e-9);
    keep = bs.filter((b) => b[0] >= lx - sx * 0.6 && b[2] <= hx + sx * 0.6 && b[1] >= ly - sy * 0.6 && b[3] <= hy + sy * 0.6);
    if (keep.length < bs.length * 0.5) keep = bs;
  }
  const x0 = Math.min(...keep.map((b) => b[0])), y0 = Math.min(...keep.map((b) => b[1])), x1 = Math.max(...keep.map((b) => b[2])), y1 = Math.max(...keep.map((b) => b[3]));
  return { x0, y0, x1: x1 > x0 ? x1 : x0 + 1, y1: y1 > y0 ? y1 : y0 + 1 };
}
function onLight(c) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  if (Math.min(r, g, b) >= 224) return 0;
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (l < 0.62 || Math.max(r, g, b) - Math.min(r, g, b) < 24) return c;
  const k = 0.52 / l;
  return (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k);
}

let dwgLib = null;
async function readDwg(p) {
  const pkg = path.join(path.dirname(require.resolve('@mlightcad/libredwg-web')), '..');
  const mod = await import(require('url').pathToFileURL(path.join(pkg, 'dist', 'libredwg-web.js')).href);
  const wasmDir = path.join(pkg, 'wasm') + path.sep;
  const buf = await fsp.readFile(p);
  const attempt = async () => {
    dwgLib = dwgLib || (await mod.LibreDwg.create(wasmDir));
    const dwg = dwgLib.dwg_read_data(buf, mod.Dwg_File_Type.DWG);
    if (!dwg) throw new Error('empty');
    const db = dwgLib.convert(dwg);
    try { dwgLib.dwg_free(dwg); } catch (_) {}
    return db;
  };
  try { return fromDwg(await attempt()); } catch (e) {
    dwgLib = null;
    throw new Error(`This DWG couldn’t be read${/memory|bounds/i.test(e.message) ? ' (its version or objects aren’t supported yet)' : ''}. Save it as DXF from your CAD app and try again.`);
  }
}
async function readDrawing(p) {
  if (U.ext(p) === 'dwg') return readDwg(p);
  const Parser = require('dxf-parser');
  const text = await fsp.readFile(p, 'utf8');
  if (/^AutoCAD Binary DXF/.test(text)) throw new Error('Binary DXF isn’t supported. Save it as ASCII DXF.');
  const parser = new Parser();
  parser.registerEntityHandler(DxfHatch);
  tapDxf(parser);
  try { return fromDxf(parser.parseSync(text), text); } catch (e) { throw new Error(`This DXF couldn’t be read: ${e.message}`); }
}

const fmt = (n) => (Math.round(n * 1000) / 1000).toString();
function dashes(it, perMm) {
  if (!it.dash) return null;
  const period = it.dash.reduce((s, v) => s + Math.abs(v), 0);
  let len = 0;
  for (let i = 1; i < it.pts.length; i++) len += Math.hypot(it.pts[i].x - it.pts[i - 1].x, it.pts[i].y - it.pts[i - 1].y);
  if (period / perMm < 0.8 || len / period > 20000) return null;
  const d = it.dash.map(Math.abs);
  return it.dash[0] < 0 ? [0, ...d] : d.length % 2 ? [...d, ...d] : d;
}
const mix = (a, b, t) => `#${[1, 3, 5].map((k) => Math.round(parseInt(a.slice(k, k + 2), 16) * (1 - t) + parseInt(b.slice(k, k + 2), 16) * t).toString(16).padStart(2, '0')).join('')}`;
function drawingSvg(items, opts = {}) {
  const ext = extents(items);
  const w = ext.x1 - ext.x0, h = ext.y1 - ext.y0;
  const pad = Math.max(w, h) * 0.03;
  const dark = opts.background === 'dark';
  const ink = (it) => { const c = it.rgb ?? 0; if (opts.mono) return dark ? '#e8f0dd' : '#1a1f16'; return dark ? (c === 0 ? '#e8f0dd' : hex(c)) : hex(onLight(c)); };
  const stroke = Math.max(w, h) / (opts.width || 2000) * (opts.lineWidth || 1), unit = Math.max(w, h) / 400;
  const tx = (p) => `${fmt(p.x - ext.x0 + pad)},${fmt(ext.y1 - p.y + pad)}`;
  const parts = [];
  for (const it of items) {
    if (it.k === 'path') {
      const d = it.sub ? it.sub.map((l) => `M${l.map(tx).join('L')}Z`).join('') : `M${it.pts.map(tx).join('L')}${it.closed ? 'Z' : ''}`;
      const fill = it.tint ? mix(ink(it), dark ? '#151913' : '#ffffff', 0.75) : ink(it);
      const dash = dashes(it, unit), pen = Math.max(it.lw ?? 0.18, 0.1) * unit * (opts.lineWidth || 1), wide = it.ww > pen;
      parts.push(`<path d="${d}" ${it.fill ? `fill="${fill}" stroke="none"` : `fill="none" stroke="${ink(it)}" stroke-width="${fmt(wide ? it.ww : pen)}"${wide ? ' stroke-linecap="butt" stroke-linejoin="miter"' : ''}${dash ? ` stroke-dasharray="${dash.map(fmt).join(' ')}"` : ''}`}/>`);
    } else if (it.k === 'point') {
      const [x, y] = tx(it.p).split(',');
      parts.push(`<circle cx="${x}" cy="${y}" r="${fmt(stroke * 1.5)}" fill="${ink(it)}"/>`);
    } else if (it.k === 'text') {
      const [x, y] = tx(it.p).split(',');
      const anchor = it.multi ? ['start', 'middle', 'end'][((it.attach || 1) - 1) % 3] : ['start', 'middle', 'end', 'start', 'middle', 'start'][it.align || 0];
      const lines = it.text.split('\n');
      const dy = it.multi && it.attach > 3 ? -(it.attach > 6 ? lines.length - 1 : (lines.length - 1) / 2) * it.h * 1.4 : 0;
      const first = it.multi && (it.attach || 1) <= 3 ? it.h : 0;
      parts.push(`<text x="${x}" y="${y}" font-size="${fmt(it.h)}" text-anchor="${anchor}" fill="${ink(it)}" stroke="none" font-family="Helvetica, Arial, sans-serif"${it.rot ? ` transform="rotate(${fmt((-it.rot * 180) / Math.PI)} ${x} ${y})"` : ''}>${lines.map((l, i) => `<tspan x="${x}" dy="${fmt(i ? it.h * 1.4 : first + dy)}">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</tspan>`).join('')}</text>`);
    }
  }
  const W = w + pad * 2, H = h + pad * 2;
  const bg = opts.transparent ? '' : `<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="${dark ? '#151913' : '#ffffff'}"/>`;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(W)} ${fmt(H)}" width="${opts.pxWidth ? opts.pxWidth : fmt(W)}" height="${opts.pxWidth ? Math.round((opts.pxWidth * H) / W) : fmt(H)}">${bg}<g stroke-width="${fmt(stroke)}" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</g></svg>`, W, H, ext, pad };
}
const FALLBACK_FONTS = ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/Library/Fonts/Arial Unicode.ttf', ...['malgun.ttf', 'simhei.ttf', 'msyh.ttf'].map((f) => path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', f)), '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf'];
async function textFonts(doc) {
  const fontkit = require('@pdf-lib/fontkit');
  doc.registerFontkit(fontkit);
  const faces = [];
  for (const f of [path.join(U.cfg.data, 'fonts', 'NotoSans-Regular.ttf'), FALLBACK_FONTS.find((x) => fs.existsSync(x))].filter(Boolean)) {
    const bytes = await fsp.readFile(f), face = fontkit.create(bytes);
    if (typeof face.hasGlyphForCodePoint === 'function') faces.push({ bytes, face, font: null });
  }
  return async (ch) => {
    const e = faces.find((x) => x.face.hasGlyphForCodePoint(ch.codePointAt(0)));
    if (e && !e.font) e.font = await doc.embedFont(e.bytes, { subset: true });
    return e?.font || null;
  };
}
async function drawingPdf(items, out, opts = {}) {
  const { PDFDocument, rgb, degrees } = require('pdf-lib');
  const ext = extents(items);
  const w = ext.x1 - ext.x0, h = ext.y1 - ext.y0;
  const sheets = { a4: [841.89, 595.28], a3: [1190.55, 841.89], letter: [792, 612], tabloid: [1224, 792] };
  let [PW, PH] = sheets[opts.sheet || 'a3'] || sheets.a3;
  if (h > w) [PW, PH] = [PH, PW];
  const margin = 28;
  const s = Math.min((PW - margin * 2) / w, (PH - margin * 2) / h);
  const ox = (PW - w * s) / 2, oy = (PH - h * s) / 2;
  const doc = await PDFDocument.create();
  doc.setCreator('Lime');
  const page = doc.addPage([PW, PH]);
  const fontFor = items.some((it) => it.k === 'text') ? await textFonts(doc) : null;
  const col = (it) => { const v = onLight(it.rgb ?? 0), t = it.tint ? 0.75 : 0; return rgb(...[16, 8, 0].map((sh) => (((v >> sh) & 255) / 255) * (1 - t) + t)); };
  const X = (p) => ox + (p.x - ext.x0) * s, Y = (p) => oy + (p.y - ext.y0) * s;
  for (const it of items) {
    if (it.k === 'path') {
      const d = (it.sub || [it.pts]).map((l) => `M${l.map((p) => `${fmt(X(p))} ${fmt(PH - Y(p))}`).join(' L')}${it.closed ? ' Z' : ''}`).join(' ');
      const dash = dashes(it, 72 / 25.4 / s), pen = Math.max(it.lw ?? 0.18, 0.1) * 72 / 25.4, wide = it.ww * s > pen;
      page.drawSvgPath(d, { x: 0, y: PH, ...(it.fill ? { color: col(it) } : { borderColor: col(it), borderWidth: wide ? it.ww * s : pen, borderLineCap: wide ? 0 : 1, ...(dash ? { borderDashArray: dash.map((v) => v * s) } : {}) }) });
    } else if (it.k === 'point') page.drawCircle({ x: X(it.p), y: Y(it.p), size: 0.8, color: col(it) });
    else if (it.k === 'text') {
      const size = Math.max(1, it.h * s);
      for (const [i, line] of it.text.split('\n').entries()) {
        const runs = [];
        for (let ch of line) {
          let f = /\s/.test(ch) && runs.length ? runs[runs.length - 1].font : await fontFor(ch);
          if (!f) { ch = '?'; f = await fontFor('?'); }
          if (runs.length && runs[runs.length - 1].font === f) runs[runs.length - 1].text += ch; else runs.push({ font: f, text: ch });
        }
        runs.forEach((r) => { r.w = r.font.widthOfTextAtSize(r.text, size); });
        const tw = runs.reduce((t, r) => t + r.w, 0);
        const anchor = it.multi ? ((it.attach || 1) - 1) % 3 : [0, 1, 2, 0, 1, 0][it.align || 0];
        let dx = -(anchor === 1 ? tw / 2 : anchor === 2 ? tw : 0);
        const dy = -(i * size * 1.4) - (it.multi && (it.attach || 1) <= 3 ? size : 0);
        const c = Math.cos(it.rot), sn = Math.sin(it.rot);
        for (const r of runs) {
          page.drawText(r.text, { x: X(it.p) + dx * c - dy * sn, y: Y(it.p) + dx * sn + dy * c, size, font: r.font, color: col(it), rotate: degrees((it.rot * 180) / Math.PI) });
          dx += r.w;
        }
      }
    }
  }
  await fsp.writeFile(out, await doc.save());
  return out;
}
function drawingDxf(items, layers) {
  const L = [];
  const g = (c, v) => L.push(String(c), String(v));
  const names = [...new Set(items.map((i) => i.layer || '0'))];
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, names.length);
  for (const n of names) { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, Math.min(255, Math.max(1, layers?.[n]?.color || 7))); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC'); g(0, 'SECTION'); g(2, 'ENTITIES');
  const color = (it) => { if (it.aci && it.aci > 0 && it.aci < 256) g(62, it.aci); };
  for (const it of items) {
    if (it.k === 'path') {
      if (it.pts.length === 2 && !it.closed && !it.fill && !it.ww) { g(0, 'LINE'); g(8, it.layer); color(it); g(10, fmt(it.pts[0].x)); g(20, fmt(it.pts[0].y)); g(30, 0); g(11, fmt(it.pts[1].x)); g(21, fmt(it.pts[1].y)); g(31, 0); continue; }
      for (const l of it.sub || [it.pts]) {
        g(0, 'POLYLINE'); g(8, it.layer); color(it); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, it.closed ? 1 : 0); if (it.ww) { g(40, fmt(it.ww)); g(41, fmt(it.ww)); }
        for (const p of l) { g(0, 'VERTEX'); g(8, it.layer); g(10, fmt(p.x)); g(20, fmt(p.y)); g(30, 0); }
        g(0, 'SEQEND'); g(8, it.layer);
      }
    } else if (it.k === 'point') { g(0, 'POINT'); g(8, it.layer); g(10, fmt(it.p.x)); g(20, fmt(it.p.y)); g(30, 0); }
    else if (it.k === 'text') {
      it.text.split('\n').forEach((line, i) => { g(0, 'TEXT'); g(8, it.layer); color(it); g(10, fmt(it.p.x + Math.sin(it.rot) * i * it.h * 1.4)); g(20, fmt(it.p.y - Math.cos(it.rot) * i * it.h * 1.4)); g(30, 0); g(40, fmt(it.h)); g(1, line); if (it.rot) g(50, fmt((it.rot * 180) / Math.PI)); });
    }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return `${L.join('\r\n')}\r\n`;
}

async function readMesh(p) {
  const e = U.ext(p);
  const buf = await fsp.readFile(p);
  if (e === 'stl') return readStl(buf);
  if (e === 'obj') return readObj(buf.toString('utf8'));
  if (e === 'ply') return readPly(buf);
  if (e === 'off') return readOff(buf.toString('utf8'));
  if (e === 'glb' || e === 'gltf') return readGltf(buf, p);
  if (e === '3mf') return read3mf(buf);
  if (['step', 'stp', 'iges', 'igs', 'brep'].includes(e)) return readOcct(buf, e);
  throw new Error(`Lime can’t read ${e.toUpperCase()} models.`);
}
const toZUp = (m, k = 1) => { const p = m.pos; for (let i = 0; i < p.length; i += 3) { const y = p[i + 1]; p[i] *= k; p[i + 1] = -p[i + 2] * k; p[i + 2] = y * k; } return m; };
const toYUp = (pos, k = 1) => { const p = new Float32Array(pos.length); for (let i = 0; i < p.length; i += 3) { p[i] = pos[i] * k; p[i + 1] = pos[i + 2] * k; p[i + 2] = -pos[i + 1] * k; } return p; };
const MF_UNITS = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
const num = (n) => String(Math.round(n * 1e6) / 1e6);
function mesh(pos, idx, parts) { return { pos: pos instanceof Float32Array ? pos : Float32Array.from(pos), idx: idx instanceof Uint32Array ? idx : Uint32Array.from(idx), parts: parts || null }; }
function readStl(buf) {
  const head = buf.subarray(0, 512).toString('latin1');
  const n = buf.length >= 84 ? buf.readUInt32LE(80) : 0;
  if (!(head.trimStart().startsWith('solid') && /facet/.test(buf.subarray(0, 2000).toString('latin1'))) || buf.length === 84 + n * 50) {
    const pos = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) pos[i * 9 + k] = buf.readFloatLE(84 + i * 50 + 12 + k * 4);
    return weld(pos);
  }
  const v = [];
  for (const m of buf.toString('latin1').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) v.push(+m[1], +m[2], +m[3]);
  return weld(Float32Array.from(v));
}
function weld(soup) {
  const map = new Map(), pos = [], idx = new Uint32Array(soup.length / 3);
  for (let i = 0; i < soup.length / 3; i++) {
    const key = `${soup[i * 3].toFixed(5)},${soup[i * 3 + 1].toFixed(5)},${soup[i * 3 + 2].toFixed(5)}`;
    let j = map.get(key);
    if (j === undefined) { j = pos.length / 3; map.set(key, j); pos.push(soup[i * 3], soup[i * 3 + 1], soup[i * 3 + 2]); }
    idx[i] = j;
  }
  return mesh(pos, idx);
}
function readObj(text) {
  const v = [], idx = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) { const [, x, y, z] = line.trim().split(/\s+/); v.push(+x, +y, +z); } else if (line.startsWith('f ')) {
      const f = line.trim().split(/\s+/).slice(1).map((t) => { const i = parseInt(t.split('/')[0], 10); return i < 0 ? v.length / 3 + i : i - 1; });
      for (let k = 1; k < f.length - 1; k++) idx.push(f[0], f[k], f[k + 1]);
    }
  }
  return toZUp(mesh(v, idx));
}
function readOff(text) {
  const t = text.replace(/#.*$/gm, '').trim().split(/\s+/);
  let i = t[0].toUpperCase().endsWith('OFF') ? 1 : 0;
  const nv = +t[i++], nf = +t[i++]; i++;
  const v = [], idx = [];
  for (let k = 0; k < nv; k++) v.push(+t[i++], +t[i++], +t[i++]);
  for (let k = 0; k < nf; k++) { const c = +t[i++]; const f = t.slice(i, i + c).map(Number); i += c; for (let j = 1; j < c - 1; j++) idx.push(f[0], f[j], f[j + 1]); }
  return mesh(v, idx);
}
function readPly(buf) {
  const end = buf.indexOf('end_header');
  const header = buf.subarray(0, end).toString('latin1');
  let off = end + 'end_header'.length;
  while (buf[off] === 13 || buf[off] === 10) { off++; if (buf[off - 1] === 10) break; }
  const format = (/format (\w+)/.exec(header) || [])[1];
  const elements = [];
  for (const line of header.split(/\r?\n/)) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'element') elements.push({ name: w[1], count: +w[2], props: [] });
    else if (w[0] === 'property') elements[elements.length - 1].props.push(w[1] === 'list' ? { list: true, ct: w[2], it: w[3], name: w[4] } : { type: w[1], name: w[2] });
  }
  const SZ = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const le = format === 'binary_little_endian';
  const rd = (t) => {
    const s = SZ[t];
    let v;
    switch (t) {
      case 'char': case 'int8': v = buf.readInt8(off); break;
      case 'uchar': case 'uint8': v = buf.readUInt8(off); break;
      case 'short': case 'int16': v = le ? buf.readInt16LE(off) : buf.readInt16BE(off); break;
      case 'ushort': case 'uint16': v = le ? buf.readUInt16LE(off) : buf.readUInt16BE(off); break;
      case 'int': case 'int32': v = le ? buf.readInt32LE(off) : buf.readInt32BE(off); break;
      case 'uint': case 'uint32': v = le ? buf.readUInt32LE(off) : buf.readUInt32BE(off); break;
      case 'float': case 'float32': v = le ? buf.readFloatLE(off) : buf.readFloatBE(off); break;
      default: v = le ? buf.readDoubleLE(off) : buf.readDoubleBE(off);
    }
    off += s;
    return v;
  };
  const v = [], idx = [];
  if (format === 'ascii') {
    const toks = buf.subarray(off).toString('latin1').trim().split(/\s+/);
    let t = 0;
    for (const el of elements) for (let i = 0; i < el.count; i++) {
      const rec = {};
      for (const pr of el.props) { if (pr.list) { const c = +toks[t++]; rec[pr.name] = toks.slice(t, t + c).map(Number); t += c; } else rec[pr.name] = +toks[t++]; }
      if (el.name === 'vertex') v.push(rec.x, rec.y, rec.z);
      if (el.name === 'face') { const f = rec.vertex_indices || rec.vertex_index || []; for (let j = 1; j < f.length - 1; j++) idx.push(f[0], f[j], f[j + 1]); }
    }
  } else {
    for (const el of elements) for (let i = 0; i < el.count; i++) {
      const rec = {};
      for (const pr of el.props) { if (pr.list) { const c = rd(pr.ct); const a = []; for (let k = 0; k < c; k++) a.push(rd(pr.it)); rec[pr.name] = a; } else rec[pr.name] = rd(pr.type); }
      if (el.name === 'vertex') v.push(rec.x, rec.y, rec.z);
      if (el.name === 'face') { const f = rec.vertex_indices || rec.vertex_index || []; for (let j = 1; j < f.length - 1; j++) idx.push(f[0], f[j], f[j + 1]); }
    }
  }
  return mesh(v, idx);
}
function readGltf(buf, p) {
  let json, bin = null;
  if (buf.readUInt32LE(0) === 0x46546c67) {
    let o = 12;
    while (o < buf.length) {
      const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4);
      if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(o + 8, o + 8 + len).toString('utf8'));
      if (type === 0x004e4942) bin = buf.subarray(o + 8, o + 8 + len);
      o += 8 + len;
    }
  } else json = JSON.parse(buf.toString('utf8'));
  const buffers = (json.buffers || []).map((b, i) => (b.uri == null ? bin : b.uri.startsWith('data:') ? Buffer.from(b.uri.split(',')[1], 'base64') : fs.readFileSync(path.join(path.dirname(p), decodeURIComponent(b.uri)))));
  const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const acc = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
    const b = buffers[bv.buffer];
    const n = NUM[a.type], stride = bv.byteStride || 0;
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array, 5122: Int16Array, 5120: Int8Array }[a.componentType];
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0) + b.byteOffset;
    const out = new Float64Array(a.count * n);
    const es = T.BYTES_PER_ELEMENT;
    for (let k = 0; k < a.count; k++) {
      const view = new T(b.buffer.slice(base + k * (stride || n * es), base + k * (stride || n * es) + n * es));
      for (let j = 0; j < n; j++) out[k * n + j] = view[j];
    }
    return out;
  };
  const pos = [], idx = [], parts = [];
  const matOf = (node) => {
    if (node.matrix) return node.matrix;
    const [x, y, z, w] = node.rotation || [0, 0, 0, 1], [sx, sy, sz] = node.scale || [1, 1, 1], [tx, ty, tz] = node.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const m4 = (a, b) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; };
  const visit = (ni, parent) => {
    const node = json.nodes[ni];
    const m = m4(parent, matOf(node));
    if (node.mesh != null) for (const prim of json.meshes[node.mesh].primitives) {
      if (prim.mode != null && prim.mode !== 4) continue;
      const P3 = acc(prim.attributes.POSITION);
      const start = pos.length / 3;
      for (let k = 0; k < P3.length; k += 3) { const [x, y, z] = [P3[k], P3[k + 1], P3[k + 2]]; pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]); }
      const I = prim.indices != null ? acc(prim.indices) : Array.from({ length: P3.length / 3 }, (_, k) => k);
      const mat = json.materials?.[prim.material];
      const c = mat?.pbrMetallicRoughness?.baseColorFactor;
      parts.push({ start: idx.length, color: c ? (toSrgb(c[0]) << 16) | (toSrgb(c[1]) << 8) | toSrgb(c[2]) : null });
      for (const k of I) idx.push(start + k);
    }
    for (const c of node.children || []) visit(c, m);
  };
  const scene = json.scenes?.[json.scene || 0];
  const roots = scene ? scene.nodes : (json.nodes || []).map((_, i) => i);
  roots.forEach((r) => visit(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  return toZUp(mesh(pos, idx, parts.some((p) => p.color != null) ? parts : null), 1000);
}
function read3mf(buf) {
  const z = require('fflate').unzipSync(new Uint8Array(buf));
  const files = Object.keys(z).filter((k) => /\.model$/i.test(k));
  const root = files.find((f) => /^3D\/3dmodel\.model$/i.test(f)) || files[0];
  const unit = (root && /<model\b[^>]*\bunit="([^"]*)"/.exec(Buffer.from(z[root]).toString('utf8'))?.[1]) || 'millimeter';
  if (!MF_UNITS[unit]) throw new Error(`This 3MF file uses a unit Lime doesn’t know: “${unit}”.`);
  const objects = {};
  for (const f of files) {
    const xml = Buffer.from(z[f]).toString('utf8');
    for (const [, attrs, body] of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
      const id = (/\bid="(\d+)"/.exec(attrs) || [])[1];
      const v = [...body.matchAll(/<vertex\b[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*z="([^"]+)"/g)].flatMap((m) => [+m[1], +m[2], +m[3]]);
      const t = [...body.matchAll(/<triangle\b[^>]*v1="(\d+)"[^>]*v2="(\d+)"[^>]*v3="(\d+)"/g)].flatMap((m) => [+m[1], +m[2], +m[3]]);
      const comps = [...body.matchAll(/<component\b[^>]*objectid="(\d+)"(?:[^>]*transform="([^"]+)")?/g)].map((m) => ({ id: m[1], t: m[2] }));
      objects[id] = { v, t, comps };
    }
  }
  const items = [];
  for (const f of files) for (const m of Buffer.from(z[f]).toString('utf8').matchAll(/<item\b[^>]*objectid="(\d+)"(?:[^>]*transform="([^"]+)")?/g)) items.push({ id: m[1], t: m[2] });
  const pos = [], idx = [];
  const tm = (s) => (s ? s.trim().split(/\s+/).map(Number) : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const cat = (a, b) => [a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8], a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8], a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8], a[9] * b[0] + a[10] * b[3] + a[11] * b[6] + b[9], a[9] * b[1] + a[10] * b[4] + a[11] * b[7] + b[10], a[9] * b[2] + a[10] * b[5] + a[11] * b[8] + b[11]];
  const add = (id, m, depth = 0) => {
    const o = objects[id];
    if (!o || depth > 8) return;
    const start = pos.length / 3;
    for (let k = 0; k < o.v.length; k += 3) { const [x, y, z2] = [o.v[k], o.v[k + 1], o.v[k + 2]]; pos.push(x * m[0] + y * m[3] + z2 * m[6] + m[9], x * m[1] + y * m[4] + z2 * m[7] + m[10], x * m[2] + y * m[5] + z2 * m[8] + m[11]); }
    for (const i of o.t) idx.push(start + i);
    for (const c of o.comps) add(c.id, cat(tm(c.t), m), depth + 1);
  };
  (items.length ? items : Object.keys(objects).map((id) => ({ id }))).forEach((it) => add(it.id, tm(it.t)));
  return mesh(pos.map((v) => v * MF_UNITS[unit]), idx);
}
let occt = null;
async function readOcct(buf, e) {
  occt = occt || (await require('occt-import-js')({ locateFile: (f) => path.join(path.dirname(require.resolve('occt-import-js')), f) }));
  const fn = e === 'brep' ? 'ReadBrepFile' : e === 'iges' || e === 'igs' ? 'ReadIgesFile' : 'ReadStepFile';
  const r = occt[fn](new Uint8Array(buf), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.4 });
  if (!r.success || !r.meshes.length) throw new Error(`This ${e.toUpperCase()} file has no solid geometry Lime can read.`);
  const pos = [], idx = [], parts = [];
  for (const m of r.meshes) {
    const start = pos.length / 3;
    pos.push(...m.attributes.position.array);
    parts.push({ start: idx.length, color: m.color ? (Math.round(m.color[0] * 255) << 16) | (Math.round(m.color[1] * 255) << 8) | Math.round(m.color[2] * 255) : null });
    for (const i of m.index.array) idx.push(start + i);
  }
  return mesh(pos, idx, parts.some((p) => p.color != null) ? parts : null);
}

function meshInfo(m) {
  let area = 0, vol = 0;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m.pos[i + k]); mx[k] = Math.max(mx[k], m.pos[i + k]); }
  const edges = new Map();
  for (let i = 0; i < m.idx.length; i += 3) {
    const [a, b, c] = [m.idx[i], m.idx[i + 1], m.idx[i + 2]];
    const A = [m.pos[a * 3], m.pos[a * 3 + 1], m.pos[a * 3 + 2]], B = [m.pos[b * 3], m.pos[b * 3 + 1], m.pos[b * 3 + 2]], C = [m.pos[c * 3], m.pos[c * 3 + 1], m.pos[c * 3 + 2]];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = p < q ? `${p}_${q}` : `${q}_${p}`; edges.set(k, (edges.get(k) || 0) + 1); }
  }
  let open = 0;
  for (const c of edges.values()) if (c !== 2) open++;
  return { vertices: m.pos.length / 3, triangles: m.idx.length / 3, size: mx.map((v, k) => v - mn[k]), min: mn, max: mx, area, volume: Math.abs(vol), watertight: open === 0 };
}

function writeStl(m) {
  const n = m.idx.length / 3;
  const b = Buffer.alloc(84 + n * 50);
  b.write('Lime binary STL', 0, 'latin1');
  b.writeUInt32LE(n, 80);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50;
    const [a, c, d] = [m.idx[i * 3] * 3, m.idx[i * 3 + 1] * 3, m.idx[i * 3 + 2] * 3];
    const ux = m.pos[c] - m.pos[a], uy = m.pos[c + 1] - m.pos[a + 1], uz = m.pos[c + 2] - m.pos[a + 2], vx = m.pos[d] - m.pos[a], vy = m.pos[d + 1] - m.pos[a + 1], vz = m.pos[d + 2] - m.pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    b.writeFloatLE(nx / l, o); b.writeFloatLE(ny / l, o + 4); b.writeFloatLE(nz / l, o + 8);
    [a, c, d].forEach((v, k) => { b.writeFloatLE(m.pos[v], o + 12 + k * 12); b.writeFloatLE(m.pos[v + 1], o + 16 + k * 12); b.writeFloatLE(m.pos[v + 2], o + 20 + k * 12); });
  }
  return b;
}
function writeObj(m) {
  const L = ['# Lime'], p = toYUp(m.pos);
  for (let i = 0; i < p.length; i += 3) L.push(`v ${num(p[i])} ${num(p[i + 1])} ${num(p[i + 2])}`);
  for (let i = 0; i < m.idx.length; i += 3) L.push(`f ${m.idx[i] + 1} ${m.idx[i + 1] + 1} ${m.idx[i + 2] + 1}`);
  return `${L.join('\n')}\n`;
}
function writePly(m) {
  const nv = m.pos.length / 3, nf = m.idx.length / 3;
  const head = Buffer.from(`ply\nformat binary_little_endian 1.0\ncomment Lime\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nelement face ${nf}\nproperty list uchar uint vertex_indices\nend_header\n`, 'latin1');
  const b = Buffer.alloc(nv * 12 + nf * 13);
  for (let i = 0; i < m.pos.length; i++) b.writeFloatLE(m.pos[i], i * 4);
  let o = nv * 12;
  for (let i = 0; i < nf; i++) { b.writeUInt8(3, o); b.writeUInt32LE(m.idx[i * 3], o + 1); b.writeUInt32LE(m.idx[i * 3 + 1], o + 5); b.writeUInt32LE(m.idx[i * 3 + 2], o + 9); o += 13; }
  return Buffer.concat([head, b]);
}
const toLinear = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));
function writeGltf(src, embed) {
  const m = { ...src, pos: toYUp(src.pos, 0.001) }, info = meshInfo(m), nv = m.pos.length / 3, small = nv <= 65535;
  const idx = small ? Uint16Array.from(m.idx) : m.idx;
  const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const pos = pad(Buffer.from(m.pos.buffer, m.pos.byteOffset, m.pos.byteLength)), bin = Buffer.concat([pos, pad(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength))]);
  const parts = m.parts?.length ? m.parts : [{ start: 0, color: null }], colors = [...new Set(parts.map((p) => p.color ?? -1))];
  const accessors = [{ bufferView: 0, componentType: 5126, count: nv, type: 'VEC3', min: info.min, max: info.max }], primitives = [];
  parts.forEach((p, k) => {
    const count = (k + 1 < parts.length ? parts[k + 1].start : m.idx.length) - p.start;
    if (count <= 0) return;
    accessors.push({ bufferView: 1, byteOffset: p.start * (small ? 2 : 4), componentType: small ? 5123 : 5125, count, type: 'SCALAR' });
    primitives.push({ attributes: { POSITION: 0 }, indices: accessors.length - 1, material: colors.indexOf(p.color ?? -1) });
  });
  const json = {
    asset: { version: '2.0', generator: 'Lime' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }],
    materials: colors.map((c) => ({ pbrMetallicRoughness: { baseColorFactor: c < 0 ? [0.62, 0.65, 0.6, 1] : [toLinear((c >> 16) & 255), toLinear((c >> 8) & 255), toLinear(c & 255), 1], metallicFactor: 0, roughnessFactor: 0.8 }, doubleSided: true })),
    buffers: [{ byteLength: bin.length, ...(embed ? { uri: `data:application/octet-stream;base64,${bin.toString('base64')}` } : {}) }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: m.pos.byteLength, target: 34962 }, { buffer: 0, byteOffset: pos.length, byteLength: idx.byteLength, target: 34963 }],
    accessors,
  };
  if (embed) return Buffer.from(JSON.stringify(json, null, 1));
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const h = Buffer.alloc(12);
  h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const c = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([h, c(js.length, 0x4e4f534a), js, c(bin.length, 0x004e4942), bin]);
}
const writeGlb = (m) => writeGltf(m, false);
function write3mf(m) {
  const { zipSync, strToU8 } = require('fflate');
  const v = [], t = [];
  for (let i = 0; i < m.pos.length; i += 3) v.push(`<vertex x="${fmt(m.pos[i])}" y="${fmt(m.pos[i + 1])}" z="${fmt(m.pos[i + 2])}"/>`);
  for (let i = 0; i < m.idx.length; i += 3) t.push(`<triangle v1="${m.idx[i]}" v2="${m.idx[i + 1]}" v3="${m.idx[i + 2]}"/>`);
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Lime</metadata><resources><object id="1" type="model"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`),
  }));
}

function render3d(m, opts = {}) {
  const W = Number(opts.width) || 1400, H = Number(opts.height) || Math.round(W * 0.75), SS = 2;
  const w = W * SS, h = H * SS;
  const yaw = deg(opts.yaw ?? 35), pitch = deg(opts.pitch ?? 28);
  const zUp = opts.zUp ?? true;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const n = m.pos.length / 3;
  const P2 = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
    if (zUp) [y, z] = [z, -y];
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    P2[i * 3] = x1; P2[i * 3 + 1] = y2; P2[i * 3 + 2] = z2;
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, P2[i * 3]); x1 = Math.max(x1, P2[i * 3]); y0 = Math.min(y0, P2[i * 3 + 1]); y1 = Math.max(y1, P2[i * 3 + 1]); }
  const s = Math.min((w * 0.84) / (x1 - x0 || 1), (h * 0.84) / (y1 - y0 || 1));
  const ox = w / 2 - ((x0 + x1) / 2) * s, oy = h / 2 + ((y0 + y1) / 2) * s;
  const zb = new Float32Array(w * h).fill(-Infinity);
  const px = new Uint8ClampedArray(w * h * 4);
  const tint = opts.color != null ? opts.color : 0x9bd452;
  const base = [(tint >> 16 & 255) / 255, (tint >> 8 & 255) / 255, (tint & 255) / 255];
  const L1 = [-0.45, 0.75, 0.5], L2 = [0.6, 0.2, 0.75];
  const nl = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const l1 = nl(L1), l2 = nl(L2);
  const partColor = (ti) => { if (!m.parts) return base; let c = null; for (const pt of m.parts) if (ti * 3 >= pt.start) c = pt.color; return c == null ? base : [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255]; };
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3;
    const ax = ox + P2[a] * s, ay = oy - P2[a + 1] * s, az = P2[a + 2];
    const bx = ox + P2[b] * s, by = oy - P2[b + 1] * s, bz = P2[b + 2];
    const cx = ox + P2[c] * s, cyy = oy - P2[c + 1] * s, cz = P2[c + 2];
    const ux = P2[b] - P2[a], uy = P2[b + 1] - P2[a + 1], uz = P2[b + 2] - P2[a + 2];
    const vx = P2[c] - P2[a], vy = P2[c + 1] - P2[a + 1], vz = P2[c + 2] - P2[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const d1 = Math.max(0, nx * l1[0] + ny * l1[1] + nz * l1[2]), d2 = Math.max(0, nx * l2[0] + ny * l2[1] + nz * l2[2]);
    const shade = 0.34 + 0.56 * d1 + 0.22 * d2;
    const spec = Math.pow(Math.max(0, nz * 0.9 + ny * 0.3), 24) * 0.18;
    const col = partColor(t / 3);
    const r = Math.min(255, (col[0] * shade + spec) * 255), g = Math.min(255, (col[1] * shade + spec) * 255), bl = Math.min(255, (col[2] * shade + spec) * 255);
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cyy))), maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cyy)));
    const area = (bx - ax) * (cyy - ay) - (by - ay) * (cx - ax);
    if (!area) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const pxx = x + 0.5, pyy = y + 0.5;
      const w0 = ((bx - pxx) * (cyy - pyy) - (by - pyy) * (cx - pxx)) / area;
      const w1 = ((cx - pxx) * (ay - pyy) - (cyy - pyy) * (ax - pxx)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * az + w1 * bz + w2 * cz;
      const k = y * w + x;
      if (z <= zb[k]) continue;
      zb[k] = z;
      px[k * 4] = r; px[k * 4 + 1] = g; px[k * 4 + 2] = bl; px[k * 4 + 3] = 255;
    }
  }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x;
    if (zb[k] === -Infinity) continue;
    const dz = Math.max(Math.abs(zb[k] - zb[k + 1]), Math.abs(zb[k] - zb[k + w]));
    if (dz > (x1 - x0) * 0.02 || zb[k + 1] === -Infinity || zb[k + w] === -Infinity) { px[k * 4] *= 0.55; px[k * 4 + 1] *= 0.55; px[k * 4 + 2] *= 0.55; }
  }
  return { data: Buffer.from(px.buffer), width: w, height: h, W, H };
}
async function renderPng(m, out, opts = {}) {
  const sharp = require('sharp');
  const r = render3d(m, opts);
  let img = sharp(r.data, { raw: { width: r.width, height: r.height, channels: 4 } }).resize(r.W, r.H, { kernel: 'lanczos3' });
  if (!opts.transparent) img = img.flatten({ background: opts.background || '#ffffff' });
  await img.png().toFile(out);
  return out;
}

async function convert(p, opts, ctx) {
  const to = opts.to || 'png';
  const e = U.ext(p);
  const is2d = KINDS.cad2d.includes(e);
  const out = ctx.out.file(p, `${U.base(p)}${e === to ? '-converted' : ''}.${to}`);
  ctx.progress?.(0.1, 'Reading drawing');
  if (is2d) {
    const model = await readDrawing(p);
    ctx.progress?.(0.45, 'Laying out');
    const items = flatten(model);
    if (!items.length) throw new Error('This drawing has no visible geometry.');
    ctx.progress?.(0.7, `Writing ${to.toUpperCase()}`);
    if (to === 'svg') { await fsp.writeFile(out, drawingSvg(items, opts).svg); return out; }
    if (to === 'pdf') return drawingPdf(items, out, opts);
    if (to === 'dxf') { await fsp.writeFile(out, drawingDxf(items, model.layers)); return out; }
    if (['png', 'jpg', 'webp'].includes(to)) {
      const px = Number(opts.size) || 3000;
      const { svg } = drawingSvg(items, { ...opts, pxWidth: px, width: px / 2 });
      let img = require('sharp')(Buffer.from(svg), { density: 72, limitInputPixels: false });
      if (to === 'jpg') img = img.flatten({ background: '#ffffff' }).jpeg({ quality: 92 }); else if (to === 'webp') img = img.webp({ quality: 92 }); else img = img.png();
      await img.toFile(out);
      return out;
    }
    if (['ai', 'eps', 'emf', 'wmf'].includes(to)) {
      const tmp = path.join(await U.tmpDir('cad'), `${U.base(p)}.svg`);
      await fsp.writeFile(tmp, drawingSvg(items, { ...opts, transparent: true }).svg);
      return require('./crafts').vector(tmp, { to }, { ...ctx, out: { ...ctx.out, file: () => out } });
    }
    throw new Error(`Drawings can be saved as SVG, PDF, PNG, JPG or DXF, not ${to.toUpperCase()}.`);
  }
  const m = await readMesh(p);
  if (!m.idx.length) throw new Error('This model has no triangles.');
  ctx.progress?.(0.6, `Writing ${to.toUpperCase()}`);
  if (to === 'stl') await fsp.writeFile(out, writeStl(m));
  else if (to === 'obj') await fsp.writeFile(out, writeObj(m));
  else if (to === 'ply') await fsp.writeFile(out, writePly(m));
  else if (to === 'glb' || to === 'gltf') await fsp.writeFile(out, writeGltf(m, to === 'gltf'));
  else if (to === '3mf') await fsp.writeFile(out, write3mf(m));
  else if (to === 'png' || to === 'jpg') { await renderPng(m, out, { ...opts, background: to === 'jpg' ? '#ffffff' : opts.background }); if (to === 'jpg') { const b = await require('sharp')(out).jpeg({ quality: 92 }).toBuffer(); await fsp.writeFile(out, b); } }
  else if (to === 'pdf') {
    const tmp = path.join(await U.tmpDir('cad'), 'view.png');
    await renderPng(m, tmp, opts);
    await require('./pdf').imagesToPdf([tmp], { pageSize: 'fit' }, out);
  } else throw new Error(`Models can be saved as STL, OBJ, PLY, GLB, glTF, 3MF, PNG or PDF, not ${to.toUpperCase()}.`);
  return out;
}
async function render(p, opts, ctx) { return convert(p, { ...opts, to: 'png' }, ctx); }
async function info(p) {
  const e = U.ext(p);
  if (KINDS.cad2d.includes(e)) {
    const model = await readDrawing(p);
    const items = flatten(model);
    const ext = extents(items);
    const counts = {};
    for (const x of model.ents) counts[x.t] = (counts[x.t] || 0) + 1;
    return { kind: '2d', layers: Object.keys(model.layers).length, entities: model.ents.length, counts, width: ext.x1 - ext.x0, height: ext.y1 - ext.y0, units: UNITS[model.units] || null };
  }
  return { kind: '3d', ...meshInfo(await readMesh(p)) };
}
const UNITS = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
async function report(p, opts, ctx) {
  const i = await info(p);
  const n = (v) => (Math.round(v * 100) / 100).toLocaleString('en-US');
  const text = i.kind === '2d'
    ? `${path.basename(p)}\nSize: ${n(i.width)} × ${n(i.height)} ${i.units || 'units'}\nLayers: ${i.layers}\nEntities: ${i.entities} (${Object.entries(i.counts).map(([k, v]) => `${v} ${k}`).join(', ')})`
    : `${path.basename(p)}\nSize: ${i.size.map(n).join(' × ')} mm\nTriangles: ${i.triangles.toLocaleString('en-US')} · Vertices: ${i.vertices.toLocaleString('en-US')}\nSurface area: ${n(i.area)} mm²\nVolume: ${n(i.volume / 1000)} cm³${i.watertight ? '' : ' (mesh isn’t closed, so volume is approximate)'}\nWatertight: ${i.watertight ? 'yes' : 'no'}`;
  let out;
  if (opts.save) { out = ctx.out.file(p, `${U.base(p)} - info.txt`); await fsp.writeFile(out, `${text}\n`); }
  return { path: out, note: text.split('\n').slice(1, 3).join(' · '), text };
}
async function thumbnail(p, size = 240) {
  const tmp = path.join(await U.tmpDir('cadthumb'), 't.png');
  try {
    if (KINDS.cad2d.includes(U.ext(p))) {
      const items = flatten(await readDrawing(p));
      const { svg } = drawingSvg(items, { pxWidth: size * 2, width: size * 1.2 });
      return require('sharp')(Buffer.from(svg)).resize(size, size, { fit: 'inside' }).png().toBuffer();
    }
    await renderPng(await readMesh(p), tmp, { width: size * 2, height: size * 2, transparent: true });
    return require('sharp')(tmp).resize(size, size, { fit: 'inside' }).png().toBuffer();
  } finally { fsp.rm(path.dirname(tmp), { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { KINDS, convert, render, info, report, thumbnail, readDrawing, readMesh, flatten, drawingSvg, meshInfo, writeStl, writeGlb };
