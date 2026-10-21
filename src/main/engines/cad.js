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
      case 'TEXT': return { ...base, t: 'text', p: P(e.halign || e.valign ? e.endPoint || e.startPoint : e.startPoint), h: e.textHeight || 1, rot: deg(e.rotation || 0), text: uni(e.text || ''), align: e.halign || 0, ocs: ocs(N(e), e.startPoint?.z) };
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
const uni = (s) => s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
function mtext(s) {
  return uni(s).replace(/\\P/g, '\n').replace(/\\[ACcFfHhLlOoQqTtWw][^;\\]*;?/g, '').replace(/\\S([^^;]*)\^([^;]*);/g, '$1/$2').replace(/[{}]/g, '').replace(/\\~/g, ' ').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/\\\\/g, '\\');
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
      const item = (pts, closed, fill, ww) => ({ k: 'path', pts, closed, fill, rgb, lw, lt, dash: fill ? null : dash, aci: typeof col === 'number' ? col : null, layer: lay, ...(ww ? { ww } : {}) });
      const similar = Math.abs(M[0] * M[0] + M[1] * M[1] - M[2] * M[2] - M[3] * M[3]) < 1e-9 * (M[0] * M[0] + M[1] * M[1]) && Math.abs(M[0] * M[2] + M[1] * M[3]) < 1e-9 * (M[0] * M[0] + M[1] * M[1]);
      const exact = (geo) => { if (similar && out.length) out[out.length - 1].geo = geo; };
      const turn = Math.atan2(M[1], M[0]), flip = M[0] * M[3] - M[1] * M[2] < 0;
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
        case 'circle': push(arcPts(e.c, e.r, 0, Math.PI * 2), true); exact({ t: 'circle', c: ap(M, e.c), r: e.r * scale }); break;
        case 'arc': push(arcPts(e.c, e.r, e.a0, e.a1)); exact({ t: 'arc', c: ap(M, e.c), r: e.r * scale, a0: flip ? turn - e.a1 : turn + e.a0, a1: flip ? turn - e.a0 : turn + e.a1 }); break;
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
  const col = (it) => { const v = opts.mono ? 0x1a1f16 : onLight(it.rgb ?? 0), t = it.tint ? 0.75 : 0; return rgb(...[16, 8, 0].map((sh) => (((v >> sh) & 255) / 255) * (1 - t) + t)); };
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

function drawingDxf2000(items, model) {
  const r2d = (a) => ((((a * 180) / Math.PI) % 360) + 360) % 360, ents = [];
  for (const it of items) {
    const base = { layer: it.layer || '0', color: it.aci > 0 && it.aci < 256 ? it.aci : it.rgb != null ? { rgb: it.rgb } : null, lw: typeof it.lw === 'number' ? it.lw : null, lt: it.lt && !/^(continuous|bylayer|byblock)$/i.test(it.lt) ? it.lt : null };
    if (it.k === 'path') {
      if (it.geo && !it.ww) { ents.push(it.geo.t === 'circle' ? { ...base, ...it.geo } : { ...base, ...it.geo, a0: r2d(it.geo.a0), a1: r2d(it.geo.a1) }); continue; }
      if (it.fill && !it.tint) { ents.push({ ...base, t: 'hatch', loops: it.sub || [it.pts] }); continue; }
      for (const l of it.sub || [it.pts]) ents.push(l.length === 2 && !it.closed && !it.ww ? { ...base, t: 'line', a: l[0], b: l[1] } : { ...base, t: 'poly', pts: l, closed: !!it.closed, w: it.ww || 0 });
    } else if (it.k === 'point') ents.push({ ...base, t: 'point', p: it.p });
    else if (it.k === 'text' && it.multi) ents.push({ ...base, t: 'mtext', p: it.p, h: it.h, rot: it.rot, text: it.text, attach: it.attach || 1 });
    else if (it.k === 'text') {
      const anchor = [0, 1, 2, 0, 1, 0][it.align || 0] ?? 0, c = Math.cos(it.rot), sn = Math.sin(it.rot);
      it.text.split('\n').forEach((line, i) => { if (!line.trim()) return; const down = i * it.h * 1.4; ents.push({ ...base, t: 'text', p: { x: it.p.x + sn * down, y: it.p.y - c * down }, h: it.h, rot: r2d(it.rot), text: line, align: anchor }); });
    }
  }
  const layers = Object.entries(model.layers || {}).map(([name, l]) => ({ name, color: l.color, rgb: l.rgb, lt: l.lt, lw: l.lw, off: l.off, frozen: l.frozen, plot: l.plot }));
  const ltypes = Object.entries(model.ltypes || {}).filter(([, p]) => p.length >= 2 && p.every(Number.isFinite)).map(([name, pattern]) => ({ name, desc: name, pattern }));
  return require('./dxf').write({ layers, ltypes, ents, units: Number(model.units) || 0 });
}

async function readMesh(p) {
  const e = U.ext(p);
  const buf = await fsp.readFile(p);
  if (e === 'stl') return readStl(buf);
  if (e === 'obj') return readObj(buf.toString('utf8'), p);
  if (e === 'ply') return readPly(buf);
  if (e === 'off') return readOff(buf.toString('utf8'));
  if (e === 'glb' || e === 'gltf') return await readGltf(buf, p);
  if (e === '3mf') return read3mf(buf);
  if (e === 'fbx') return require('./fbx').readFbx(buf, p);
  if (['step', 'stp', 'iges', 'igs', 'brep'].includes(e)) return readOcct(buf, e);
  throw new Error(`Lime can’t read ${e.toUpperCase()} models.`);
}
const toZUp = (m, k = 1) => { const p = m.pos; for (let i = 0; i < p.length; i += 3) { const y = p[i + 1]; p[i] *= k; p[i + 1] = -p[i + 2] * k; p[i + 2] = y * k; } return m; };
const toYUp = (pos, k = 1) => { const p = new Float32Array(pos.length); for (let i = 0; i < p.length; i += 3) { p[i] = pos[i] * k; p[i + 1] = pos[i + 2] * k; p[i + 2] = -pos[i + 1] * k; } return p; };
const MF_UNITS = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
const num = (n) => String(Math.round(n * 1e6) / 1e6);
function mesh(pos, idx, parts) { return { pos: pos instanceof Float32Array ? pos : Float32Array.from(pos), idx: idx instanceof Uint32Array ? idx : Uint32Array.from(idx), parts: parts || null }; }
const rgb = (r, g, b) => [r, g, b].reduce((a, x) => (a << 8) | Math.round(Math.min(1, Math.max(0, x || 0)) * 255), 0);
const ck = (p) => (p.color == null ? '' : `${p.color}/${p.alpha ?? 1}`);
const palette = (parts) => [...new Map(parts.map((p) => [ck(p), p])).values()];
const spans = (m) => { const ps = m.parts?.length ? m.parts : [{ start: 0, color: null }]; return ps.map((p, k) => ({ ...p, end: k + 1 < ps.length ? ps[k + 1].start : m.idx.length })); };
function meshOf(pos, groups) {
  const idx = [], parts = [];
  for (const g of groups) if (g.idx.length) { parts.push({ start: idx.length, color: g.color ?? null, ...(g.alpha < 1 ? { alpha: g.alpha } : {}) }); for (const i of g.idx) idx.push(i); }
  return mesh(pos, idx, parts.some((p) => p.color != null) ? parts : null);
}
function triangulate(pos, f, out) {
  const n = f.length;
  if (n < 3) return;
  if (n === 3) { out.push(f[0], f[1], f[2]); return; }
  if (n <= 64 && earClip(pos, f, out)) return;
  for (let k = 1; k < n - 1; k++) out.push(f[0], f[k], f[k + 1]);
}
function earClip(pos, f, out) {
  const n = f.length, P = (i, k) => pos[f[i] * 3 + k], N = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const a = (k + 1) % 3, b = (k + 2) % 3, j = (i + 1) % n; N[k] += (P(i, a) - P(j, a)) * (P(i, b) + P(j, b)); }
  const A = N.map(Math.abs);
  if (!(A[0] + A[1] + A[2] > 0) || !Number.isFinite(A[0] + A[1] + A[2])) return false;
  const d = A[0] >= A[1] && A[0] >= A[2] ? 0 : A[1] >= A[2] ? 1 : 2, [u, v] = N[d] >= 0 ? [(d + 1) % 3, (d + 2) % 3] : [(d + 2) % 3, (d + 1) % 3];
  const X = f.map((_, i) => P(i, u)), Y = f.map((_, i) => P(i, v));
  const cross = (a, b, c) => (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]);
  const r = f.map((_, i) => i), start = out.length;
  for (let guard = n * n; r.length > 3 && guard > 0; guard--) {
    let clipped = false;
    for (let i = 0; i < r.length && !clipped; i++) {
      const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
      if (cross(a, b, c) <= 0 || r.some((k) => k !== a && k !== b && k !== c && cross(a, b, k) >= 0 && cross(b, c, k) >= 0 && cross(c, a, k) >= 0)) continue;
      out.push(f[a], f[b], f[c]);
      r.splice(i, 1);
      clipped = true;
    }
    if (!clipped) break;
  }
  if (r.length > 3) { out.length = start; return false; }
  out.push(f[r[0]], f[r[1]], f[r[2]]);
  return true;
}
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
function readObj(text, p) {
  const v = [], vc = [], lib = {}, groups = new Map();
  let name = '', grp = '', mat = null, cur = null;
  for (const raw of text.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    const line = raw.trim(), sp = line.search(/\s/), kw = sp < 0 ? line : line.slice(0, sp), rest = sp < 0 ? '' : line.slice(sp + 1).trim();
    if (kw === 'v') {
      const n = rest.split(/\s+/).map(Number);
      v.push(n[0], n[1], n[2]);
      if (n.length >= 6) { const s = n[3] > 1 || n[4] > 1 || n[5] > 1 ? 1 / 255 : 1; vc[v.length / 3 - 1] = [n[3] * s, n[4] * s, n[5] * s]; }
    } else if (kw === 'f' || kw === 'fo') {
      const key = `${grp || name}\0${mat}`, nv = v.length / 3;
      if (!cur && !(cur = groups.get(key))) groups.set(key, (cur = { idx: [], mat }));
      triangulate(v, rest.split(/\s+/).filter(Boolean).map((t) => { const i = parseInt(t, 10), j = i < 0 ? nv + i : i - 1; if (!(j >= 0 && j < nv)) throw new Error(`This OBJ file refers to vertex ${t.split('/')[0]}, but it has only ${nv}.`); return j; }), cur.idx);
    } else if (kw === 'o') { name = rest; grp = ''; cur = null; } else if (kw === 'g') { grp = rest; cur = null; } else if (kw === 'usemtl') { mat = rest; cur = null; } else if (kw === 'mtllib' && p) readMtl(rest, path.dirname(p), lib);
  }
  for (const g of groups.values()) {
    const s = [0, 0, 0];
    let n = 0;
    for (const i of g.idx) if (vc[i]) { n++; for (let k = 0; k < 3; k++) s[k] += vc[i][k]; }
    g.color = n ? rgb(s[0] / n, s[1] / n, s[2] / n) : lib[g.mat]?.color ?? null;
    g.alpha = lib[g.mat]?.alpha ?? 1;
  }
  return toZUp(meshOf(v, groups.values()));
}
function readMtl(names, dir, lib) {
  const find = (n) => { n = n.trim().replace(/^"|"$/g, '').replace(/\\/g, '/'); return n ? [path.resolve(dir, n), path.join(dir, path.basename(n))].find((f) => fs.existsSync(f) && fs.statSync(f).isFile()) : null; };
  for (const f of find(names) ? [find(names)] : names.split(/\s+/).map(find).filter(Boolean)) {
    let cur = null;
    for (const raw of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const w = raw.trim().split(/\s+/), k = w[0].toLowerCase(), x = w.slice(1).map(Number);
      if (k === 'newmtl') lib[raw.trim().slice(6).trim()] = cur = {};
      else if (cur && k === 'kd' && x.length >= 3 && x.slice(0, 3).every(Number.isFinite)) cur.color = rgb(x[0], x[1], x[2]);
      else if (cur && (k === 'd' || k === 'tr') && Number.isFinite(x.at(-1))) cur.alpha = Math.min(1, Math.max(0, k === 'd' ? x.at(-1) : 1 - x.at(-1)));
    }
  }
}
function readOff(text) {
  const L = text.replace(/#.*$/gm, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean), head = L[0].split(/\s+/);
  let i = /OFF$/i.test(head[0]) ? 1 : 0;
  const counts = (i && head.length > 1 ? head.slice(1) : L[i++].split(/\s+/)).map(Number), [nv, nf] = counts;
  const v = [], groups = new Map();
  for (let k = 0; k < nv; k++) { const w = L[i++].split(/\s+/).map(Number); v.push(w[0], w[1], w[2]); }
  for (let k = 0; k < nf && i < L.length; k++) {
    const w = L[i++].split(/\s+/).map(Number), c = w[0], f = w.slice(1, 1 + c), col = w.slice(1 + c);
    if (f.some((j) => !(j >= 0 && j < nv))) throw new Error(`A face of this OFF file refers to a vertex it doesn’t have (there are ${nv}).`);
    const s = col.some((x) => x > 1) ? 1 / 255 : 1, color = col.length >= 3 ? rgb(col[0] * s, col[1] * s, col[2] * s) : null, alpha = col.length >= 4 ? Math.min(1, col[3] * s) : 1, key = `${color}/${alpha}`;
    if (!groups.has(key)) groups.set(key, { idx: [], color, alpha });
    triangulate(v, f, groups.get(key).idx);
  }
  return meshOf(v, groups.values());
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
  const v = [], vc = [], faces = [];
  const CH = { red: 0, green: 1, blue: 2, alpha: 3, diffuse_red: 0, diffuse_green: 1, diffuse_blue: 2, diffuse_alpha: 3 };
  const cv = (x, t) => Math.min(1, Math.max(0, /char|int8/.test(t) ? x / 255 : /short|16/.test(t) ? x / 65535 : /int/.test(t) ? x / (x > 255 ? 4294967295 : 255) : x));
  const take = (el, rec) => {
    let c = null;
    for (const pr of el.props) if (!pr.list && CH[pr.name] != null) (c = c || [1, 1, 1, 1])[CH[pr.name]] = cv(rec[pr.name], pr.type);
    if (el.name === 'vertex') { v.push(rec.x, rec.y, rec.z); vc.push(c); }
    if (el.name === 'face') faces.push([rec.vertex_indices || rec.vertex_index || [], c]);
  };
  if (format === 'ascii') {
    const toks = buf.subarray(off).toString('latin1').trim().split(/\s+/);
    let t = 0;
    for (const el of elements) for (let i = 0; i < el.count; i++) {
      const rec = {};
      for (const pr of el.props) { if (pr.list) { const c = +toks[t++]; rec[pr.name] = toks.slice(t, t + c).map(Number); t += c; } else rec[pr.name] = +toks[t++]; }
      take(el, rec);
    }
  } else {
    for (const el of elements) for (let i = 0; i < el.count; i++) {
      const rec = {};
      for (const pr of el.props) { if (pr.list) { const c = rd(pr.ct); const a = []; for (let k = 0; k < c; k++) a.push(rd(pr.it)); rec[pr.name] = a; } else rec[pr.name] = rd(pr.type); }
      take(el, rec);
    }
  }
  const nv = v.length / 3, groups = new Map();
  for (const [f, fc] of faces) {
    if (f.some((i) => !(i >= 0 && i < nv))) throw new Error(`A face of this PLY file refers to a vertex it doesn’t have (there are ${nv}).`);
    const c = fc || vc[f[0]], color = c ? rgb(c[0], c[1], c[2]) : null, key = c ? color + Math.round(c[3] * 255) * 0x1000000 : -1;
    if (!groups.has(key)) groups.set(key, { idx: [], color, alpha: c ? c[3] : 1 });
    triangulate(v, f, groups.get(key).idx);
  }
  if (groups.size <= 256) return meshOf(v, groups.values());
  const s = [0, 0, 0], idx = [];
  for (const g of groups.values()) { for (let k = 0; k < 3; k++) s[k] += ((g.color >> (16 - 8 * k)) & 255) * g.idx.length; for (const i of g.idx) idx.push(i); }
  return meshOf(v, [{ idx, color: rgb(...s.map((x) => x / idx.length / 255)) }]);
}
let draco = null;
const dracoDecoder = () => (draco ??= require('draco3dgltf').createDecoderModule({}));
function dracoPrim(D, data, ids) {
  const dec = new D.Decoder(), db = new D.DecoderBuffer(), m = new D.Mesh();
  try {
    db.Init(new Int8Array(data.buffer, data.byteOffset, data.byteLength), data.byteLength);
    if (!dec.DecodeBufferToMesh(db, m).ok() || !m.ptr) throw new Error('This model’s Draco-compressed geometry is damaged.');
    const a = dec.GetAttributeByUniqueId(m, ids.POSITION), arr = new D.DracoFloat32Array(), ia = new D.DracoInt32Array();
    dec.GetAttributeFloatForAllPoints(m, a, arr);
    const P3 = Float64Array.from({ length: arr.size() }, (_, i) => arr.GetValue(i)), I = new Uint32Array(m.num_faces() * 3);
    for (let f = 0; f < m.num_faces(); f++) { dec.GetFaceFromMesh(m, f, ia); for (let k = 0; k < 3; k++) I[f * 3 + k] = ia.GetValue(k); }
    D.destroy(arr); D.destroy(ia);
    return { P3, I };
  } finally { D.destroy(m); D.destroy(db); D.destroy(dec); }
}
async function readGltf(buf, p) {
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
  const buffers = (json.buffers || []).map((b, i) => (b.uri == null ? (i ? null : bin) : b.uri.startsWith('data:') ? Buffer.from(b.uri.split(',')[1], 'base64') : fs.existsSync(path.join(path.dirname(p), decodeURIComponent(b.uri))) ? fs.readFileSync(path.join(path.dirname(p), decodeURIComponent(b.uri))) : null));
  const views = [];
  for (const bv of json.bufferViews || []) {
    const mo = bv.extensions?.EXT_meshopt_compression;
    if (!mo) { views.push({ data: buffers[bv.buffer]?.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength), stride: bv.byteStride || 0 }); continue; }
    const M = require(path.join(path.dirname(require.resolve('meshoptimizer')), 'meshopt_decoder.cjs'));
    await M.ready;
    const out = new Uint8Array(mo.count * mo.byteStride), src = buffers[mo.buffer].subarray(mo.byteOffset || 0, (mo.byteOffset || 0) + mo.byteLength);
    M.decodeGltfBuffer(out, mo.count, mo.byteStride, src, mo.mode, mo.filter);
    views.push({ data: Buffer.from(out.buffer), stride: bv.byteStride || mo.byteStride });
  }
  const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const NORM = { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 };
  const acc = (i) => {
    const a = json.accessors[i], v = views[a.bufferView];
    if (!v?.data) throw new Error('This glTF file’s geometry is in a file that isn’t beside it.');
    const n = NUM[a.type];
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array, 5122: Int16Array, 5120: Int8Array }[a.componentType];
    const es = T.BYTES_PER_ELEMENT, stride = v.stride || n * es, base = v.data.byteOffset + (a.byteOffset || 0), out = new Float64Array(a.count * n), k0 = a.normalized ? NORM[a.componentType] : 1;
    for (let k = 0; k < a.count; k++) {
      const view = new T(v.data.buffer.slice(base + k * stride, base + k * stride + n * es));
      for (let j = 0; j < n; j++) out[k * n + j] = a.normalized ? Math.max(view[j] / k0, -1) : view[j];
    }
    return out;
  };
  const D = (json.meshes || []).some((m) => m.primitives.some((pr) => pr.extensions?.KHR_draco_mesh_compression)) ? await dracoDecoder() : null;
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
      const dr = prim.extensions?.KHR_draco_mesh_compression, packed = dr && dracoPrim(D, views[dr.bufferView].data, dr.attributes);
      const P3 = packed ? packed.P3 : acc(prim.attributes.POSITION);
      const start = pos.length / 3;
      for (let k = 0; k < P3.length; k += 3) { const [x, y, z] = [P3[k], P3[k + 1], P3[k + 2]]; pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]); }
      const I = packed ? packed.I : prim.indices != null ? acc(prim.indices) : Array.from({ length: P3.length / 3 }, (_, k) => k);
      const mat = json.materials?.[prim.material];
      const c = mat?.pbrMetallicRoughness?.baseColorFactor;
      parts.push({ start: idx.length, color: c ? (toSrgb(c[0]) << 16) | (toSrgb(c[1]) << 8) | toSrgb(c[2]) : null, ...(c?.[3] < 1 ? { alpha: c[3] } : {}) });
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
  const A = (s) => { const o = {}; for (const m of s.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2]; return o; };
  const objects = {}, mats = {}, items = [];
  for (const f of files) {
    const xml = Buffer.from(z[f]).toString('utf8');
    for (const [, , attrs, body] of xml.matchAll(/<((?:\w+:)?(?:basematerials|colorgroup))\b([^>]*)>([\s\S]*?)<\/\1>/g)) mats[A(attrs).id] = [...body.matchAll(/\b(?:displaycolor|color)="#([0-9a-f]{6})([0-9a-f]{2})?"/gi)].map((m) => ({ color: parseInt(m[1], 16), alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 }));
    for (const [, attrs, body] of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
      const a = A(attrs), v = [], t = [], keys = [];
      for (const [, s] of body.matchAll(/<vertex\b([^>]*)/g)) { const b = A(s); v.push(+b.x, +b.y, +b.z); }
      for (const [, s] of body.matchAll(/<triangle\b([^>]*)/g)) { const b = A(s); t.push(+b.v1, +b.v2, +b.v3); keys.push(`${b.pid ?? a.pid}/${b.p1 ?? a.pindex ?? 0}`); }
      if (t.some((i) => !(i >= 0 && i < v.length / 3))) throw new Error('A triangle of this 3MF file refers to a vertex it doesn’t have.');
      objects[a.id] = { v, t, keys, type: a.type || 'model', comps: [...body.matchAll(/<component\b([^>]*)/g)].map(([, s]) => A(s)) };
    }
    for (const [, s] of xml.matchAll(/<item\b([^>]*)/g)) items.push(A(s));
  }
  const pos = [], groups = new Map();
  const tm = (s) => (s ? s.trim().split(/\s+/).map(Number) : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const cat = (a, b) => [a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8], a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8], a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8], a[9] * b[0] + a[10] * b[3] + a[11] * b[6] + b[9], a[9] * b[1] + a[10] * b[4] + a[11] * b[7] + b[10], a[9] * b[2] + a[10] * b[5] + a[11] * b[8] + b[11]];
  const add = (id, m, depth = 0) => {
    const o = objects[id];
    if (!o || depth > 8 || o.type === 'support' || o.type === 'other') return;
    const start = pos.length / 3, flip = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]) < 0;
    for (let k = 0; k < o.v.length; k += 3) { const [x, y, z2] = [o.v[k], o.v[k + 1], o.v[k + 2]]; pos.push(x * m[0] + y * m[3] + z2 * m[6] + m[9], x * m[1] + y * m[4] + z2 * m[7] + m[10], x * m[2] + y * m[5] + z2 * m[8] + m[11]); }
    for (let i = 0; i < o.t.length; i += 3) {
      const [pid, p1] = o.keys[i / 3].split('/'), c = mats[pid]?.[p1], key = c ? o.keys[i / 3] : '';
      if (!groups.has(key)) groups.set(key, { idx: [], color: c?.color ?? null, alpha: c?.alpha ?? 1 });
      groups.get(key).idx.push(start + o.t[i], start + o.t[i + (flip ? 2 : 1)], start + o.t[i + (flip ? 1 : 2)]);
    }
    for (const c of o.comps) add(c.objectid, cat(tm(c.transform), m), depth + 1);
  };
  (items.length ? items : Object.keys(objects).map((objectid) => ({ objectid }))).forEach((it) => add(it.objectid, tm(it.transform)));
  return meshOf(pos.map((v) => v * MF_UNITS[unit]), groups.values());
}
let occt = null;
async function readOcct(buf, e) {
  occt = occt || (await require('occt-import-js')({ locateFile: (f) => path.join(path.dirname(require.resolve('occt-import-js')), f) }));
  const fn = e === 'brep' ? 'ReadBrepFile' : e === 'iges' || e === 'igs' ? 'ReadIgesFile' : 'ReadStepFile';
  const r = occt[fn](new Uint8Array(buf), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.4 });
  if (!r.success || !r.meshes.length) throw new Error(`This ${e.toUpperCase()} file has no solid geometry Lime can read.`);
  const pos = [], idx = [], parts = [], faces = [], c8 = (c) => (c ? (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255) : null);
  let face = 0;
  for (const m of r.meshes) {
    const start = pos.length / 3, nt = m.index.array.length / 3, base = idx.length;
    for (const v of m.attributes.position.array) pos.push(v);
    for (const i of m.index.array) idx.push(start + i);
    const bf = m.brep_faces?.length ? m.brep_faces : [{ first: 0, last: nt - 1 }];
    for (const f of bf) {
      const color = c8(f.color) ?? c8(m.color), at = base + f.first * 3;
      if (!parts.length || parts[parts.length - 1].color !== color) parts.push({ start: at, color });
      for (let t = f.first; t <= f.last; t++) faces[base / 3 + t] = face;
      face++;
    }
  }
  const out = mesh(pos, idx, parts.some((p) => p.color != null) ? parts : null);
  out.faces = Int32Array.from(faces, (v) => v ?? -1);
  return out;
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
const alpha8 = (p) => Math.round((p.alpha ?? 1) * 255);
function writeObj(m, mtl) {
  const L = ['# Lime'], p = toYUp(m.pos), pal = mtl && m.parts?.some((q) => q.color != null) ? palette(m.parts) : null;
  const name = (q) => (q.color == null ? 'default' : `color_${hex(q.color).slice(1)}${alpha8(q) < 255 ? `_${alpha8(q)}` : ''}`);
  if (pal) L.push(`mtllib ${mtl}`);
  for (let i = 0; i < p.length; i += 3) L.push(`v ${num(p[i])} ${num(p[i + 1])} ${num(p[i + 2])}`);
  for (const s of spans(m)) {
    if (pal) L.push(`usemtl ${name(s)}`);
    for (let i = s.start; i < s.end; i += 3) L.push(`f ${m.idx[i] + 1} ${m.idx[i + 1] + 1} ${m.idx[i + 2] + 1}`);
  }
  const kd = (c) => [16, 8, 0].map((k) => num(((c >> k) & 255) / 255)).join(' ');
  return { obj: `${L.join('\n')}\n`, mtl: pal && `# Lime\n${pal.map((q) => `\nnewmtl ${name(q)}\nKd ${kd(q.color ?? 0xffffff)}\nKa 0 0 0\nKs 0 0 0\n${alpha8(q) < 255 ? `d ${num(q.alpha)}\n` : ''}illum 1\n`).join('')}` };
}
function writePly(m) {
  let pos = m.pos, idx = m.idx, rgba = null;
  if (m.parts?.some((q) => q.color != null && (q.color !== 0xffffff || alpha8(q) < 255))) {
    const pal = palette(m.parts), at = new Map(pal.map((q, k) => [ck(q), k])), map = new Map(), src = [];
    idx = new Uint32Array(m.idx.length);
    rgba = [];
    for (const s of spans(m)) {
      const k = at.get(ck(s)), c = s.color ?? 0xffffff;
      for (let i = s.start; i < s.end; i++) {
        const key = m.idx[i] * pal.length + k;
        if (!map.has(key)) { map.set(key, src.length); src.push(m.idx[i]); rgba.push([(c >> 16) & 255, (c >> 8) & 255, c & 255, alpha8(s)]); }
        idx[i] = map.get(key);
      }
    }
    pos = new Float32Array(src.length * 3);
    src.forEach((v, j) => pos.set(m.pos.subarray(v * 3, v * 3 + 3), j * 3));
  }
  const nv = pos.length / 3, nf = idx.length / 3, vs = rgba ? 16 : 12;
  const head = Buffer.from(`ply\nformat binary_little_endian 1.0\ncomment Lime\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\n${rgba ? 'property uchar red\nproperty uchar green\nproperty uchar blue\nproperty uchar alpha\n' : ''}element face ${nf}\nproperty list uchar uint vertex_indices\nend_header\n`, 'latin1');
  const b = Buffer.alloc(nv * vs + nf * 13);
  for (let i = 0; i < nv; i++) { for (let k = 0; k < 3; k++) b.writeFloatLE(pos[i * 3 + k], i * vs + k * 4); if (rgba) b.set(rgba[i], i * vs + 12); }
  let o = nv * vs;
  for (let i = 0; i < nf; i++) { b.writeUInt8(3, o); b.writeUInt32LE(idx[i * 3], o + 1); b.writeUInt32LE(idx[i * 3 + 1], o + 5); b.writeUInt32LE(idx[i * 3 + 2], o + 9); o += 13; }
  return Buffer.concat([head, b]);
}
const toLinear = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));
function writeGltf(src, embed) {
  const m = { ...src, pos: toYUp(src.pos, 0.001) }, info = meshInfo(m), nv = m.pos.length / 3, small = nv <= 65535;
  const idx = small ? Uint16Array.from(m.idx) : m.idx;
  const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const pos = pad(Buffer.from(m.pos.buffer, m.pos.byteOffset, m.pos.byteLength)), bin = Buffer.concat([pos, pad(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength))]);
  const parts = m.parts?.length ? m.parts : [{ start: 0, color: null }], pal = palette(parts), at = new Map(pal.map((p, k) => [ck(p), k]));
  const accessors = [{ bufferView: 0, componentType: 5126, count: nv, type: 'VEC3', min: info.min, max: info.max }], primitives = [];
  parts.forEach((p, k) => {
    const count = (k + 1 < parts.length ? parts[k + 1].start : m.idx.length) - p.start;
    if (count <= 0) return;
    accessors.push({ bufferView: 1, byteOffset: p.start * (small ? 2 : 4), componentType: small ? 5123 : 5125, count, type: 'SCALAR' });
    primitives.push({ attributes: { POSITION: 0 }, indices: accessors.length - 1, material: at.get(ck(p)) });
  });
  const json = {
    asset: { version: '2.0', generator: 'Lime' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }],
    materials: pal.map(({ color: c, alpha: a = 1 }) => ({ pbrMetallicRoughness: { baseColorFactor: c == null ? [0.62, 0.65, 0.6, 1] : [toLinear((c >> 16) & 255), toLinear((c >> 8) & 255), toLinear(c & 255), a], metallicFactor: 0, roughnessFactor: 0.8 }, ...(c != null && a < 1 ? { alphaMode: 'BLEND' } : {}), doubleSided: true })),
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
const MF_NAMES = { mm: 'millimeter', cm: 'centimeter', m: 'meter', in: 'inch', ft: 'foot' };
function write3mf(m, unit = 'mm') {
  const { zipSync, strToU8 } = require('fflate');
  const v = [], t = [], weld = new Map(), pal = m.parts?.some((q) => q.color != null) ? palette(m.parts) : null, at = new Map(pal?.map((q, k) => [ck(q), k]));
  const q = 10 ** ({ cm: 4, m: 6, in: 5, ft: 6 }[unit] || 3), f = (n) => String(Math.round(n * q) / q);
  const key = (i) => `x="${f(m.pos[i * 3])}" y="${f(m.pos[i * 3 + 1])}" z="${f(m.pos[i * 3 + 2])}"`;
  const vert = (k) => { if (!weld.has(k)) { weld.set(k, weld.size); v.push(`<vertex ${k}/>`); } return weld.get(k); };
  const def = pal ? at.get(ck(m.parts[0])) : null;
  for (const s of spans(m)) {
    const k = pal ? at.get(ck(s)) : null;
    for (let i = s.start; i < s.end; i += 3) {
      const [a, b, c] = [m.idx[i], m.idx[i + 1], m.idx[i + 2]].map(key);
      if (a !== b && b !== c && a !== c) t.push(`<triangle v1="${vert(a)}" v2="${vert(b)}" v3="${vert(c)}"${k !== def ? ` pid="1" p1="${k}"` : ''}/>`);
    }
  }
  const color = (q) => (q.color == null ? '#FFFFFF' : `${hex(q.color)}${alpha8(q) < 255 ? alpha8(q).toString(16).padStart(2, '0') : ''}`.toUpperCase());
  const mats = pal ? `<basematerials id="1">${pal.map((q) => `<base name="${q.color == null ? 'Default' : color(q)}" displaycolor="${color(q)}"/>`).join('')}</basematerials>` : '';
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(`<?xml version="1.0" encoding="UTF-8"?><model unit="${MF_NAMES[unit] || 'millimeter'}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Lime</metadata><resources>${mats}<object id="2" type="model"${pal ? ` pid="1" pindex="${def}"` : ''}><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object></resources><build><item objectid="2"/></build></model>`),
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
  let pk = 0;
  const partColor = (ti) => { if (!m.parts) return base; while (pk + 1 < m.parts.length && ti * 3 >= m.parts[pk + 1].start) pk++; const c = m.parts[pk].color; return c == null ? base : [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255]; };
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
  const out = ctx.out.file(p, `${U.base(p)}${opts.suffix ?? (e === to ? '-converted' : '')}.${to}`);
  ctx.progress?.(0.1, 'Reading drawing');
  if (is2d) {
    const model = await readDrawing(p);
    ctx.progress?.(0.45, 'Laying out');
    const items = flatten(model);
    if (!items.length) throw new Error('This drawing has no visible geometry.');
    ctx.progress?.(0.7, `Writing ${to.toUpperCase()}`);
    if (to === 'svg') { await fsp.writeFile(out, drawingSvg(items, opts).svg); return out; }
    if (to === 'pdf') return drawingPdf(items, out, opts);
    if (to === 'dxf') { await fsp.writeFile(out, opts.dxf === 'r12' ? drawingDxf(items, model.layers) : drawingDxf2000(items, model)); return out; }
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
  if (!MODEL_OUT.includes(to)) throw new Error(`Models can be saved as ${MODEL_OUT.filter((x) => !['stp', 'igs', 'jpg'].includes(x)).map((x) => x.toUpperCase()).join(', ')}, not ${to.toUpperCase()}.`);
  const X = require('./mesh'), B = require('./brep');
  if (B_REP.includes(to) && B_REP.includes(e) && !opts.repair && !(opts.keep < 100)) {
    ctx.progress?.(0.3, 'Open CASCADE');
    const box = opts.centre ? X.box((await readMesh(p)).pos) : null;
    try { return await B.exact(p, to, out, { ...opts, box }); } catch (err) { if (/couldn’t read/.test(err.message)) throw err; }
  }
  let m = await readMesh(p);
  if (!m.idx.length) throw new Error('This model has no triangles.');
  if (opts.repair) { ctx.progress?.(0.4, 'Repairing'); m = X.repair(m).mesh; }
  if (opts.keep && opts.keep < 100) { ctx.progress?.(0.5, 'Simplifying'); m = X.simplify(m, opts.keep / 100); }
  return saveModel(X.place(m, opts), to, out, opts, U.base(p), ctx);
}
async function saveModel(m, to, out, opts, name, ctx) {
  const X = require('./mesh'), u = X.UNITS[opts.units] ? opts.units : 'mm', mu = X.inUnits(m, u);
  ctx.progress?.(0.6, `Writing ${to.toUpperCase()}`);
  if (to === 'stl') await fsp.writeFile(out, opts.ascii ? X.writeStlAscii(mu, name.replace(/\s+/g, '_')) : writeStl(mu));
  else if (to === 'obj') {
    const stem = path.join(path.dirname(out), U.base(out).replace(/\s+/g, '_'));
    let mtl = m.parts?.some((q) => q.color != null) ? `${stem}.mtl` : null;
    for (let i = 1; mtl && fs.existsSync(mtl); i++) mtl = `${stem}_${i}.mtl`;
    const r = writeObj(mu, mtl && path.basename(mtl));
    await fsp.writeFile(out, r.obj);
    if (mtl) { await fsp.writeFile(mtl, r.mtl); return { path: out, paths: [out, mtl] }; }
  }
  else if (to === 'ply') await fsp.writeFile(out, writePly(mu));
  else if (to === 'off') await fsp.writeFile(out, X.writeOff(mu));
  else if (to === 'amf') await fsp.writeFile(out, u === 'cm' ? X.writeAmf(m, 'mm') : X.writeAmf(mu, u));
  else if (to === 'wrl') await fsp.writeFile(out, X.writeWrl(mu, u));
  else if (to === 'x3d') await fsp.writeFile(out, X.writeX3d(mu, u));
  else if (to === 'dae') await fsp.writeFile(out, X.writeDae(mu, u, name));
  else if (B_REP.includes(to)) { ctx.progress?.(0.7, 'Making faces'); await fsp.writeFile(out, require('./brep').write(m, to, { unit: u, name, refine: opts.refine !== false })); }
  else if (to === 'glb' || to === 'gltf') await fsp.writeFile(out, writeGltf(m, to === 'gltf'));
  else if (to === '3mf') await fsp.writeFile(out, write3mf(mu, u));
  else if (to === 'png' || to === 'jpg') { await renderPng(m, out, { ...opts, background: to === 'jpg' ? '#ffffff' : opts.background }); if (to === 'jpg') { const b = await require('sharp')(out).jpeg({ quality: 92 }).toBuffer(); await fsp.writeFile(out, b); } }
  else if (to === 'pdf') {
    const tmp = path.join(await U.tmpDir('cad'), 'view.png');
    await renderPng(m, tmp, opts);
    await require('./pdf').imagesToPdf([tmp], { pageSize: 'fit' }, out);
  }
  return out;
}
const B_REP = ['step', 'stp', 'iges', 'igs', 'brep'];
const MODEL_OUT = ['stl', 'obj', 'glb', 'gltf', '3mf', 'ply', 'step', 'stp', 'iges', 'igs', 'brep', 'off', 'amf', 'wrl', 'x3d', 'dae', 'png', 'jpg', 'pdf'];
async function render(p, opts, ctx) { return convert(p, { ...opts, to: 'png' }, ctx); }
const sameModel = (p) => (['stl', 'obj', 'ply', 'off', '3mf', 'glb', 'gltf'].includes(U.ext(p)) ? U.ext(p) : 'stl');
const count = (v, one, many) => `${v.toLocaleString('en-US')} ${v === 1 ? one : many}`;
async function meshFrom(p) { const m = await readMesh(p); if (!m.idx.length) throw new Error('This model has no triangles.'); return m; }
async function repairModel(p, opts, ctx) {
  const to = sameModel(p), { mesh: m, report: r } = require('./mesh').repair(await meshFrom(p));
  const out = await saveModel(m, to, ctx.out.file(p, `${U.base(p)}-repaired.${to}`), opts, U.base(p), ctx);
  const done = [r.points && `merged ${count(r.points, 'point', 'points')}`, r.degenerate && `removed ${count(r.degenerate, 'broken triangle', 'broken triangles')}`, r.duplicates && `removed ${count(r.duplicates, 'doubled triangle', 'doubled triangles')}`, r.flipped && `turned ${count(r.flipped, 'triangle', 'triangles')} round`].filter(Boolean);
  return { path: out.path || out, paths: out.paths, note: done.length ? `${done.join(', ').replace(/^./, (c) => c.toUpperCase())}.` : 'Nothing needed repairing.' };
}
async function simplifyModel(p, opts, ctx) {
  const to = sameModel(p), m = await meshFrom(p), keep = Math.min(99, Math.max(1, Number(opts.keep) || 50)), s = require('./mesh').simplify(m, keep / 100);
  const out = await saveModel(s, to, ctx.out.file(p, `${U.base(p)}-simplified.${to}`), opts, U.base(p), ctx);
  return { path: out.path || out, paths: out.paths, note: `${count(m.idx.length / 3, 'triangle', 'triangles')} → ${(s.idx.length / 3).toLocaleString('en-US')}` };
}
async function mergeModels(files, opts, ctx) {
  const list = [], to = opts.to || 'stl';
  for (const [i, f] of files.entries()) { ctx.progress?.((i / files.length) * 0.5, `Reading ${path.basename(f)}`); list.push(await meshFrom(f)); }
  return saveModel(require('./mesh').merge(list, { arrange: !!opts.arrange }), to, ctx.out.file(files[0], `${U.base(files[0])} - merged.${to}`), opts, `${U.base(files[0])} merged`, ctx);
}
async function drawing(p, opts, ctx) {
  const m = await readMesh(p);
  if (!m.idx.length) throw new Error('This model has no triangles.');
  return require('./views').drawing(m, p, opts, ctx);
}
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

module.exports = { KINDS, convert, render, repairModel, simplifyModel, mergeModels, drawing, info, report, thumbnail, readDrawing, readMesh, flatten, drawingSvg, meshInfo, writeStl, writeGlb, triangulate, meshOf, rgb, mesh, spans, palette, ck, alpha8, hex, textFonts, onLight, aci, extents, MF_UNITS };
