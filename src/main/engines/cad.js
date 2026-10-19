'use strict';
const U = require('./util');
const { fs, fsp, path } = U;

const KINDS = { cad2d: U.GROUPS.cad2d, cad3d: U.GROUPS.cad3d };
const ACI = [0, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0];
function aci(i) {
  if (i >= 1 && i <= 9) return ACI[i];
  if (i >= 250) return [0x333333, 0x505050, 0x696969, 0x828282, 0xbebebe, 0xffffff][i - 250] ?? 0x808080;
  if (i < 10 || i > 249) return 0;
  const h = (Math.floor((i - 10) / 10) * 15) / 360, v = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][(i - 10) % 10], s = (i % 2) ? 0.5 : 1;
  const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return (Math.round(f(5) * 255) << 16) | (Math.round(f(3) * 255) << 8) | Math.round(f(1) * 255);
}
const hex = (c) => `#${(c >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`;
const P = (p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 });
const deg = (d) => (d * Math.PI) / 180;

function fromDxf(dxf) {
  const conv = (e) => {
    const base = { layer: e.layer || '0', color: e.colorIndex === 256 || e.colorIndex == null ? null : e.colorIndex === 0 ? 'block' : e.color != null && e.colorIndex == null ? { rgb: e.color } : e.colorIndex, rgb: e.color != null && (e.colorIndex == null || e.colorIndex === 256 ? false : true) ? e.color : null };
    switch (e.type) {
      case 'LINE': return { ...base, t: 'line', a: P(e.vertices[0]), b: P(e.vertices[1]) };
      case 'LWPOLYLINE': case 'POLYLINE': return { ...base, t: 'poly', pts: (e.vertices || []).map((v) => ({ ...P(v), b: v.bulge || 0 })), closed: !!e.shape || !!(e.closed) };
      case 'CIRCLE': return { ...base, t: 'circle', c: P(e.center), r: e.radius };
      case 'ARC': return { ...base, t: 'arc', c: P(e.center), r: e.radius, a0: e.startAngle, a1: e.endAngle };
      case 'ELLIPSE': return { ...base, t: 'ellipse', c: P(e.center), m: P(e.majorAxisEndPoint), ratio: e.axisRatio, a0: e.startAngle ?? 0, a1: e.endAngle ?? Math.PI * 2 };
      case 'SPLINE': return { ...base, t: 'spline', ctrl: (e.controlPoints || []).map(P), fit: (e.fitPoints || []).map(P), degree: e.degreeOfSplineCurve || 3, knots: e.knotValues || [] };
      case 'TEXT': return { ...base, t: 'text', p: P(e.halign || e.valign ? e.endPoint || e.startPoint : e.startPoint), h: e.textHeight || 1, rot: deg(e.rotation || 0), text: e.text || '', align: e.halign || 0 };
      case 'MTEXT': return { ...base, t: 'text', p: P(e.position), h: e.height || 1, rot: deg(e.rotation || 0), text: mtext(e.text || ''), attach: e.attachmentPoint || 1, multi: true };
      case 'INSERT': return { ...base, t: 'insert', name: e.name, p: P(e.position), sx: e.xScale ?? 1, sy: e.yScale ?? 1, rot: deg(e.rotation || 0), cols: e.columnCount || 1, rows: e.rowCount || 1, cs: e.columnSpacing || 0, rs: e.rowSpacing || 0 };
      case 'DIMENSION': return e.block ? { ...base, t: 'insert', name: e.block, p: { x: 0, y: 0 }, sx: 1, sy: 1, rot: 0 } : null;
      case 'POINT': return { ...base, t: 'point', p: P(e.position) };
      case 'SOLID': case 'TRACE': return { ...base, t: 'solid', pts: (e.points || []).map(P) };
      case '3DFACE': return { ...base, t: 'face', pts: (e.vertices || []).map(P) };
      case 'HATCH': return e.boundaryPaths ? { ...base, t: 'hatch', loops: [], solid: !!e.solidFill } : null;
      default: return null;
    }
  };
  const blocks = {};
  for (const [name, b] of Object.entries(dxf.blocks || {})) blocks[name] = { base: P(b.position), ents: (b.entities || []).map(conv).filter(Boolean) };
  const layers = {};
  for (const [name, l] of Object.entries(dxf.tables?.layer?.layers || {})) layers[name] = { color: l.colorIndex != null ? Math.abs(l.colorIndex) : 7, rgb: null, hidden: l.visible === false || l.frozen === true || l.colorIndex < 0 };
  return { ents: (dxf.entities || []).map(conv).filter(Boolean), blocks, layers, units: dxf.header?.$INSUNITS };
}
function fromDwg(db) {
  const conv = (e) => {
    const base = { layer: e.layer || '0', color: e.colorIndex === 256 || e.colorIndex == null ? null : e.colorIndex === 0 ? 'block' : e.colorIndex, rgb: e.colorIndex === 256 || e.colorIndex == null || e.colorIndex < 257 ? null : e.color };
    if (e.isVisible === false) return null;
    switch (e.type) {
      case 'LINE': return { ...base, t: 'line', a: P(e.startPoint), b: P(e.endPoint) };
      case 'LWPOLYLINE': return { ...base, t: 'poly', pts: (e.vertices || []).map((v) => ({ ...P(v), b: v.bulge || 0 })), closed: !!(e.flag & 1) };
      case 'POLYLINE2D': case 'POLYLINE3D': return { ...base, t: 'poly', pts: (e.vertices || []).filter((v) => !(v.flag & 16)).map((v) => ({ ...P(v), b: v.bulge || 0 })), closed: !!(e.flag & 1) };
      case 'CIRCLE': return { ...base, t: 'circle', c: P(e.center), r: e.radius };
      case 'ARC': return { ...base, t: 'arc', c: P(e.center), r: e.radius, a0: e.startAngle, a1: e.endAngle };
      case 'ELLIPSE': return { ...base, t: 'ellipse', c: P(e.center), m: P(e.majorAxisEndPoint), ratio: e.axisRatio, a0: e.startAngle ?? 0, a1: e.endAngle ?? Math.PI * 2 };
      case 'SPLINE': return { ...base, t: 'spline', ctrl: (e.controlPoints || []).map(P), fit: (e.fitPoints || []).map(P), degree: e.degree || 3, knots: e.knots || [] };
      case 'TEXT': return { ...base, t: 'text', p: P(e.halign || e.valign ? (e.endPoint?.x || e.endPoint?.y ? e.endPoint : e.startPoint) : e.startPoint), h: e.textHeight || 1, rot: e.rotation || 0, text: e.text || '', align: e.halign || 0 };
      case 'ATTRIB': return e.text ? { ...base, t: 'text', p: P(e.text.startPoint), h: e.text.textHeight || 1, rot: e.text.rotation || 0, text: e.text.text || '', align: e.text.halign || 0 } : null;
      case 'MTEXT': return { ...base, t: 'text', p: P(e.insertionPoint), h: e.textHeight || 1, rot: e.rotation || Math.atan2(e.direction?.y || 0, e.direction?.x || 1), text: mtext(e.text || ''), attach: e.attachmentPoint || 1, multi: true };
      case 'INSERT': return { ...base, t: 'insert', name: e.name, p: P(e.insertionPoint), sx: e.xScale ?? 1, sy: e.yScale ?? 1, rot: e.rotation || 0, cols: e.columnCount || 1, rows: e.rowCount || 1, cs: e.columnSpacing || 0, rs: e.rowSpacing || 0, attribs: (e.attribs || []).map(conv).filter(Boolean) };
      case 'DIMENSION': return e.name ? { ...base, t: 'insert', name: e.name, p: { x: 0, y: 0 }, sx: 1, sy: 1, rot: 0 } : null;
      case 'POINT': return { ...base, t: 'point', p: P(e.position) };
      case 'SOLID': case 'TRACE': return { ...base, t: 'solid', pts: [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean).map(P) };
      case '3DFACE': return { ...base, t: 'face', pts: [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean).map(P) };
      case 'HATCH': return { ...base, t: 'hatch', solid: !!e.solidFill, loops: (e.boundaryPaths || []).map(hatchLoop).filter((l) => l.length > 1) };
      case 'XLINE': case 'RAY': return null;
      default: return null;
    }
  };
  const blocks = {};
  for (const b of db.tables?.BLOCK_RECORD?.entries || []) if (!/^\*(Model|Paper)_Space/i.test(b.name)) blocks[b.name] = { base: P(b.basePoint), ents: (b.entities || []).map(conv).filter(Boolean) };
  const layers = {};
  for (const l of db.tables?.LAYER?.entries || []) layers[l.name] = { color: Math.abs(l.colorIndex ?? 7), rgb: l.colorIndex > 256 ? l.color : null, hidden: !!l.off || !!l.frozen || l.colorIndex < 0 };
  const model = db.tables?.BLOCK_RECORD?.entries?.find((b) => /^\*Model_Space$/i.test(b.name));
  const ents = (db.entities || []).filter((e) => !model || !e.ownerBlockRecordSoftId || e.ownerBlockRecordSoftId === model.handle || !blocks[e.ownerBlockRecordSoftId]).filter((e) => e.type !== 'VIEWPORT');
  return { ents: ents.map(conv).filter(Boolean), blocks, layers, units: db.header?.INSUNITS };
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
function bulgePts(a, b, bulge) {
  const th = 4 * Math.atan(bulge);
  const ch = Math.hypot(b.x - a.x, b.y - a.y);
  if (!ch) return [];
  const r = ch / (2 * Math.sin(th / 2));
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const h = Math.sqrt(Math.max(0, r * r - (ch / 2) ** 2)) * Math.sign(bulge) * (Math.abs(th) > Math.PI ? -1 : 1);
  const ux = -(b.y - a.y) / ch, uy = (b.x - a.x) / ch;
  const c = { x: mx + ux * h, y: my + uy * h };
  const s = Math.atan2(a.y - c.y, a.x - c.x);
  const n = Math.max(6, Math.ceil(Math.abs(th) / (Math.PI / 90)));
  return Array.from({ length: n }, (_, i) => { const t = s + (th * (i + 1)) / n; return { x: c.x + Math.abs(r) * Math.cos(t), y: c.y + Math.abs(r) * Math.sin(t) }; });
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
  const out = [];
  const colorOf = (e, inherited) => {
    if (e.rgb) return e.rgb;
    if (e.color === 'block') return inherited ?? 7;
    if (e.color != null) return e.color;
    const l = model.layers[e.layer];
    return l ? (l.rgb != null ? { rgb: l.rgb } : l.color) : 7;
  };
  const resolve = (c) => (c && typeof c === 'object' ? c.rgb : typeof c === 'number' && c > 256 ? c : aci(c));
  const walk = (ents, m, inherited, depth) => {
    for (const e of ents) {
      if (model.layers[e.layer]?.hidden || /^defpoints$/i.test(e.layer)) continue;
      const col = colorOf(e, inherited);
      const rgb = resolve(col);
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      const push = (pts, closed, fill) => pts.length > 1 && out.push({ k: 'path', pts: pts.map((p) => ap(m, p)), closed, fill, rgb, aci: typeof col === 'number' ? col : null, layer: e.layer });
      switch (e.t) {
        case 'line': push([e.a, e.b]); break;
        case 'poly': {
          const pts = [];
          const n = e.pts.length;
          for (let i = 0; i < n; i++) { const a = e.pts[i], b = e.pts[(i + 1) % n]; pts.push(a); if (a.b && (i < n - 1 || e.closed)) pts.push(...bulgePts(a, b, a.b)); }
          push(pts, e.closed);
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
        case 'point': out.push({ k: 'point', p: ap(m, e.p), rgb, layer: e.layer }); break;
        case 'solid': { const [a, b, c, d] = e.pts; push(d && (d.x !== c.x || d.y !== c.y) ? [a, b, d, c] : [a, b, c], true, true); break; }
        case 'face': push(e.pts, true); break;
        case 'hatch': for (const l of e.loops) push(l, true, e.solid); break;
        case 'text': {
          if (!e.text.trim()) break;
          const p = ap(m, e.p);
          const ang = e.rot + Math.atan2(m[1], m[0]);
          out.push({ k: 'text', p, h: e.h * scale, rot: ang, text: e.text, align: e.align, attach: e.attach, multi: e.multi, rgb, layer: e.layer });
          break;
        }
        case 'insert': {
          const b = model.blocks[e.name];
          if (!b || depth > 12) break;
          for (let r = 0; r < (e.rows || 1); r++) for (let c = 0; c < (e.cols || 1); c++) {
            const t = mul(mul(mul(m, [1, 0, 0, 1, e.p.x, e.p.y]), [Math.cos(e.rot), Math.sin(e.rot), -Math.sin(e.rot), Math.cos(e.rot), 0, 0]), [e.sx, 0, 0, e.sy, c * (e.cs || 0), r * (e.rs || 0)]);
            walk(b.ents, mul(t, [1, 0, 0, 1, -b.base.x, -b.base.y]), col, depth + 1);
          }
          if (e.attribs?.length) walk(e.attribs, m, col, depth + 1);
          break;
        }
        default:
      }
    }
  };
  walk(model.ents, ident, 7, 0);
  return out;
}
function bounds(it) {
  if (it.k === 'path') { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of it.pts) { if (p.x < a) a = p.x; if (p.y < b) b = p.y; if (p.x > c) c = p.x; if (p.y > d) d = p.y; } return [a, b, c, d]; }
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
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (l < 0.62) return c;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 24) return 0x1a1f16;
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
  try { return fromDxf(new Parser().parseSync(text)); } catch (e) { throw new Error(`This DXF couldn’t be read: ${e.message}`); }
}

const fmt = (n) => (Math.round(n * 1000) / 1000).toString();
function drawingSvg(items, opts = {}) {
  const ext = extents(items);
  const w = ext.x1 - ext.x0, h = ext.y1 - ext.y0;
  const pad = Math.max(w, h) * 0.03;
  const dark = opts.background === 'dark';
  const ink = (it) => { const c = it.rgb ?? 0; if (opts.mono) return dark ? '#e8f0dd' : '#1a1f16'; return dark ? (c === 0 ? '#e8f0dd' : hex(c)) : hex(onLight(c)); };
  const stroke = Math.max(w, h) / (opts.width || 2000) * (opts.lineWidth || 1);
  const tx = (p) => `${fmt(p.x - ext.x0 + pad)},${fmt(ext.y1 - p.y + pad)}`;
  const parts = [];
  for (const it of items) {
    if (it.k === 'path') {
      const d = `M${it.pts.map(tx).join('L')}${it.closed ? 'Z' : ''}`;
      parts.push(`<path d="${d}" ${it.fill ? `fill="${ink(it)}" stroke="none"` : `fill="none" stroke="${ink(it)}"`}/>`);
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
async function drawingPdf(items, out, opts = {}) {
  const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
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
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const col = (it) => { const v = onLight(it.rgb ?? 0); return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255); };
  const X = (p) => ox + (p.x - ext.x0) * s, Y = (p) => oy + (p.y - ext.y0) * s;
  for (const it of items) {
    if (it.k === 'path') {
      const d = `M${it.pts.map((p) => `${fmt(X(p))} ${fmt(PH - Y(p))}`).join(' L')}${it.closed ? ' Z' : ''}`;
      page.drawSvgPath(d, { x: 0, y: PH, ...(it.fill ? { color: col(it) } : { borderColor: col(it), borderWidth: 0.5 }) });
    } else if (it.k === 'point') page.drawCircle({ x: X(it.p), y: Y(it.p), size: 0.8, color: col(it) });
    else if (it.k === 'text') {
      const size = Math.max(1, it.h * s);
      it.text.split('\n').forEach((line, i) => {
        const clean = line.replace(/[^\x20-\x7e -ÿ]/g, '?');
        const tw = font.widthOfTextAtSize(clean, size);
        const anchor = it.multi ? ((it.attach || 1) - 1) % 3 : [0, 1, 2, 0, 1, 0][it.align || 0];
        const dx = -(anchor === 1 ? tw / 2 : anchor === 2 ? tw : 0);
        const dy = -(i * size * 1.4) - (it.multi && (it.attach || 1) <= 3 ? size : 0);
        const c = Math.cos(it.rot), sn = Math.sin(it.rot);
        page.drawText(clean, { x: X(it.p) + dx * c - dy * sn, y: Y(it.p) + dx * sn + dy * c, size, font, color: col(it), rotate: degrees((it.rot * 180) / Math.PI) });
      });
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
      if (it.pts.length === 2 && !it.closed && !it.fill) { g(0, 'LINE'); g(8, it.layer); color(it); g(10, fmt(it.pts[0].x)); g(20, fmt(it.pts[0].y)); g(30, 0); g(11, fmt(it.pts[1].x)); g(21, fmt(it.pts[1].y)); g(31, 0); continue; }
      g(0, 'POLYLINE'); g(8, it.layer); color(it); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, it.closed ? 1 : 0);
      for (const p of it.pts) { g(0, 'VERTEX'); g(8, it.layer); g(10, fmt(p.x)); g(20, fmt(p.y)); g(30, 0); }
      g(0, 'SEQEND'); g(8, it.layer);
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
  return mesh(v, idx);
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
      parts.push({ start: idx.length, color: c ? (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255) : null });
      for (const k of I) idx.push(start + k);
    }
    for (const c of node.children || []) visit(c, m);
  };
  const scene = json.scenes?.[json.scene || 0];
  const roots = scene ? scene.nodes : (json.nodes || []).map((_, i) => i);
  roots.forEach((r) => visit(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  return mesh(pos, idx, parts.some((p) => p.color != null) ? parts : null);
}
function read3mf(buf) {
  const z = require('fflate').unzipSync(new Uint8Array(buf));
  const files = Object.keys(z).filter((k) => /\.model$/i.test(k));
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
  return mesh(pos, idx);
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

function normals(m) {
  const n = new Float32Array(m.pos.length);
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = m.idx[i] * 3, b = m.idx[i + 1] * 3, c = m.idx[i + 2] * 3;
    const ux = m.pos[b] - m.pos[a], uy = m.pos[b + 1] - m.pos[a + 1], uz = m.pos[b + 2] - m.pos[a + 2];
    const vx = m.pos[c] - m.pos[a], vy = m.pos[c + 1] - m.pos[a + 1], vz = m.pos[c + 2] - m.pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
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
  const L = ['# Lime'];
  for (let i = 0; i < m.pos.length; i += 3) L.push(`v ${fmt(m.pos[i])} ${fmt(m.pos[i + 1])} ${fmt(m.pos[i + 2])}`);
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
function writeGlb(m) {
  const n = normals(m);
  const info = meshInfo(m);
  const pos = Buffer.from(m.pos.buffer, m.pos.byteOffset, m.pos.byteLength);
  const nor = Buffer.from(n.buffer);
  const idx = Buffer.from(m.idx.buffer, m.idx.byteOffset, m.idx.byteLength);
  const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const bin = Buffer.concat([pad(pos), pad(nor), pad(idx)]);
  const json = {
    asset: { version: '2.0', generator: 'Lime' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.85, 0.87, 0.82, 1], metallicFactor: 0, roughnessFactor: 0.6 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 }, { buffer: 0, byteOffset: pad(pos).length, byteLength: nor.length, target: 34962 }, { buffer: 0, byteOffset: pad(pos).length + pad(nor).length, byteLength: idx.length, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: m.pos.length / 3, type: 'VEC3', min: info.min, max: info.max }, { bufferView: 1, componentType: 5126, count: m.pos.length / 3, type: 'VEC3' }, { bufferView: 2, componentType: 5125, count: m.idx.length, type: 'SCALAR' }],
  };
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const h = Buffer.alloc(12);
  h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const c = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([h, c(js.length, 0x4e4f534a), js, c(bin.length, 0x004e4942), bin]);
}
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
  const zUp = opts.zUp ?? (() => { const i = meshInfo(m); return i.size[2] <= i.size[1] * 1.6 || i.size[1] < i.size[2] * 0.4; })();
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
      fsp.rm(out, { force: true }).catch(() => {});
      return require('./crafts').vector(tmp, { to }, { ...ctx, out: { ...ctx.out, file: (s, n) => ctx.out.file(p, n) } });
    }
    throw new Error(`Drawings can be saved as SVG, PDF, PNG, JPG or DXF, not ${to.toUpperCase()}.`);
  }
  const m = await readMesh(p);
  if (!m.idx.length) throw new Error('This model has no triangles.');
  ctx.progress?.(0.6, `Writing ${to.toUpperCase()}`);
  if (to === 'stl') await fsp.writeFile(out, writeStl(m));
  else if (to === 'obj') await fsp.writeFile(out, writeObj(m));
  else if (to === 'ply') await fsp.writeFile(out, writePly(m));
  else if (to === 'glb') await fsp.writeFile(out, writeGlb(m));
  else if (to === '3mf') await fsp.writeFile(out, write3mf(m));
  else if (to === 'png' || to === 'jpg') { await renderPng(m, out, { ...opts, background: to === 'jpg' ? '#ffffff' : opts.background }); if (to === 'jpg') { const b = await require('sharp')(out).jpeg({ quality: 92 }).toBuffer(); await fsp.writeFile(out, b); } }
  else if (to === 'pdf') {
    const tmp = path.join(await U.tmpDir('cad'), 'view.png');
    await renderPng(m, tmp, opts);
    await require('./pdf').imagesToPdf([tmp], { pageSize: 'fit' }, out);
  } else throw new Error(`Models can be saved as STL, OBJ, PLY, GLB, 3MF, PNG or PDF, not ${to.toUpperCase()}.`);
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
