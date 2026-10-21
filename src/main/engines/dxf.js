'use strict';
// DXF out as AutoCAD 2000 (AC1015): the header, every symbol table a reader may look for, model and paper space blocks,
// handles, owners and subclass markers on everything, and the root dictionary. Layers carry colour (also true colour),
// linetype and lineweight; entities may override them. Structure after SolidCraft's dxf_out (MIT OR Apache-2.0) and
// Autodesk's DXF reference.

const LW = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
// Lineweights are a fixed set of hundredths of a millimetre.
const lw100 = (mm) => LW.reduce((b, v) => (Math.abs(v - mm * 100) < Math.abs(b - mm * 100) ? v : b), 0);
const ACI = require('dxf-parser/dist/AutoCadColorIndex').default;
// The nearest colour index, for readers that ignore true colour.
function nearestAci(rgb) {
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  let best = 7, d0 = Infinity;
  for (let i = 1; i < 256; i++) { const c = ACI[i], d = (((c >> 16) & 255) - r) ** 2 + (((c >> 8) & 255) - g) ** 2 + ((c & 255) - b) ** 2; if (d < d0) { d0 = d; best = i; } }
  return best;
}
const num = (v) => { if (!Number.isFinite(v)) return '0.0'; const s = (Math.round(v * 1e9) / 1e9).toString(); return s.includes('.') || s.includes('e') ? s : `${s}.0`; };
// Text as release 2000 holds it: control characters as spaces, letters outside ASCII as \U+XXXX.
const text = (s) => Array.from(String(s), (c) => { const n = c.codePointAt(0); return n < 32 ? ' ' : n < 128 ? c : n < 0x10000 ? `\\U+${n.toString(16).toUpperCase().padStart(4, '0')}` : '?'; }).join('').slice(0, 250);
const name = (s) => String(s || '0').replace(/[<>/\\":;?*|=`]/g, '_').slice(0, 255) || '0';

function write({ layers = [], ltypes = [], ents = [], units = 4 } = {}) {
  const out = [], code = (c, v) => out.push(String(c).padStart(3), String(v));
  let next = 0x20;
  const handle = () => (next++).toString(16).toUpperCase();
  const pt = (c, p) => { code(c, num(p.x)); code(c + 10, num(p.y)); code(c + 20, num(p.z || 0)); };
  const table = (tname, n, sub) => { const h = handle(); code(0, 'TABLE'); code(2, tname); code(5, h); code(330, 0); code(100, 'AcDbSymbolTable'); code(70, n); if (sub) code(100, sub); return h; };
  const record = (kind, sub, owner) => { const h = handle(); code(0, kind); code(5, h); code(330, owner); code(100, 'AcDbSymbolTableRecord'); code(100, sub); return h; };
  const lts = [{ name: 'ByBlock', desc: '', pattern: [] }, { name: 'ByLayer', desc: '', pattern: [] }, { name: 'Continuous', desc: 'Solid line', pattern: [] }];
  for (const t of ltypes) if (t.pattern?.length && !lts.some((x) => x.name.toUpperCase() === name(t.name).toUpperCase())) lts.push({ ...t, name: name(t.name) });
  const ltName = (n) => (!n || /^(bylayer)$/i.test(n) ? null : /^continuous$/i.test(n) ? 'Continuous' : /^byblock$/i.test(n) ? 'ByBlock' : lts.find((x) => x.name.toUpperCase() === name(n).toUpperCase())?.name || null);
  const lays = [{ name: '0', color: 7 }];
  for (const l of layers) if (!lays.some((x) => x.name === name(l.name))) lays.push({ ...l, name: name(l.name) });
  for (const e of ents) if (!lays.some((x) => x.name === name(e.layer))) lays.push({ name: name(e.layer), color: 7 });
  const model = handle(), paper = handle(), root = handle(), groups = handle();

  code(0, 'SECTION'); code(2, 'CLASSES'); code(0, 'ENDSEC');
  code(0, 'SECTION'); code(2, 'TABLES');
  let t = table('VPORT', 1);
  record('VPORT', 'AcDbViewportTableRecord', t); code(2, '*Active'); code(70, 0); code(10, 0); code(20, 0); code(11, 1); code(21, 1); code(12, 0); code(22, 0); code(13, 0); code(23, 0); code(14, 10); code(24, 10); code(15, 10); code(25, 10);
  code(16, 0); code(26, 0); code(36, 1); code(17, 0); code(27, 0); code(37, 0); code(40, 100); code(41, 1.5); code(42, 50); code(43, 0); code(44, 0); code(50, 0); code(51, 0); code(71, 0); code(72, 100); code(73, 1); code(74, 3); code(75, 0); code(76, 0); code(77, 0); code(78, 0);
  code(0, 'ENDTAB');
  t = table('LTYPE', lts.length);
  for (const l of lts) {
    record('LTYPE', 'AcDbLinetypeTableRecord', t); code(2, l.name); code(70, 0); code(3, text(l.desc || '')); code(72, 65); code(73, l.pattern.length); code(40, num(l.pattern.reduce((s, v) => s + Math.abs(v), 0)));
    for (const d of l.pattern) { code(49, num(d)); code(74, 0); }
  }
  code(0, 'ENDTAB');
  t = table('LAYER', lays.length);
  for (const l of lays) {
    record('LAYER', 'AcDbLayerTableRecord', t); code(2, l.name); code(70, l.frozen ? 1 : 0);
    const ci = l.color > 0 && l.color < 256 ? l.color : l.rgb != null ? nearestAci(l.rgb) : 7;
    code(62, l.off ? -ci : ci);
    if (l.rgb != null) code(420, l.rgb & 0xffffff);
    code(6, ltName(l.lt) || 'Continuous');
    if (l.plot === false) code(290, 0);
    code(370, typeof l.lw === 'number' ? lw100(l.lw) : -3);
  }
  code(0, 'ENDTAB');
  t = table('STYLE', 1);
  record('STYLE', 'AcDbTextStyleTableRecord', t); code(2, 'Standard'); code(70, 0); code(40, 0); code(41, 1); code(50, 0); code(71, 0); code(42, 2.5); code(3, 'txt'); code(4, '');
  code(0, 'ENDTAB');
  for (const tn of ['VIEW', 'UCS']) { table(tn, 0); code(0, 'ENDTAB'); }
  t = table('APPID', 1);
  record('APPID', 'AcDbRegAppTableRecord', t); code(2, 'ACAD'); code(70, 0);
  code(0, 'ENDTAB');
  t = table('DIMSTYLE', 1, 'AcDbDimStyleTable');
  { const h = handle(); code(0, 'DIMSTYLE'); code(105, h); code(330, t); code(100, 'AcDbSymbolTableRecord'); code(100, 'AcDbDimStyleTableRecord'); code(2, 'Standard'); code(70, 0); }
  code(0, 'ENDTAB');
  t = table('BLOCK_RECORD', 2);
  for (const [h, n] of [[model, '*Model_Space'], [paper, '*Paper_Space']]) { code(0, 'BLOCK_RECORD'); code(5, h); code(330, t); code(100, 'AcDbSymbolTableRecord'); code(100, 'AcDbBlockTableRecord'); code(2, n); code(70, 0); code(280, 1); code(281, 0); }
  code(0, 'ENDTAB');
  code(0, 'ENDSEC');

  code(0, 'SECTION'); code(2, 'BLOCKS');
  for (const [h, n, ps] of [[model, '*Model_Space', 0], [paper, '*Paper_Space', 1]]) {
    for (const [kind, sub] of [['BLOCK', 'AcDbBlockBegin'], ['ENDBLK', 'AcDbBlockEnd']]) {
      code(0, kind); code(5, handle()); code(330, h); code(100, 'AcDbEntity'); if (ps) code(67, 1); code(8, '0'); code(100, sub);
      if (kind === 'BLOCK') { code(2, n); code(70, 0); pt(10, { x: 0, y: 0 }); code(3, n); code(1, ''); }
    }
  }
  code(0, 'ENDSEC');

  code(0, 'SECTION'); code(2, 'ENTITIES');
  const lo = { x: Infinity, y: Infinity }, hi = { x: -Infinity, y: -Infinity }, grow = (p) => { lo.x = Math.min(lo.x, p.x); lo.y = Math.min(lo.y, p.y); hi.x = Math.max(hi.x, p.x); hi.y = Math.max(hi.y, p.y); };
  const head = (kind, e) => {
    code(0, kind); code(5, handle()); code(330, model); code(100, 'AcDbEntity'); code(8, name(e.layer));
    const lt = ltName(e.lt);
    if (lt) code(6, lt);
    if (e.color != null) {
      if (typeof e.color === 'object') { code(62, nearestAci(e.color.rgb)); code(420, e.color.rgb & 0xffffff); } else code(62, e.color);
    }
    if (typeof e.lw === 'number') code(370, lw100(e.lw));
  };
  for (const e of ents) {
    if (e.t === 'line') { head('LINE', e); code(100, 'AcDbLine'); pt(10, e.a); pt(11, e.b); grow(e.a); grow(e.b); }
    else if (e.t === 'poly') {
      if (e.pts.length < 2) continue;
      head('LWPOLYLINE', e); code(100, 'AcDbPolyline'); code(90, e.pts.length); code(70, (e.closed ? 1 : 0) | 128); if (e.w) code(43, num(e.w));
      for (const p of e.pts) { code(10, num(p.x)); code(20, num(p.y)); if (p.b) code(42, num(p.b)); grow(p); }
    } else if (e.t === 'circle' || e.t === 'arc') {
      head(e.t === 'circle' ? 'CIRCLE' : 'ARC', e); code(100, 'AcDbCircle'); pt(10, e.c); code(40, num(e.r));
      if (e.t === 'arc') { code(100, 'AcDbArc'); code(50, num(e.a0)); code(51, num(e.a1)); }
      grow({ x: e.c.x - e.r, y: e.c.y - e.r }); grow({ x: e.c.x + e.r, y: e.c.y + e.r });
    } else if (e.t === 'point') { head('POINT', e); code(100, 'AcDbPoint'); pt(10, e.p); grow(e.p); }
    else if (e.t === 'text') {
      head('TEXT', e); code(100, 'AcDbText'); pt(10, e.p); code(40, num(e.h)); code(1, text(e.text)); if (e.rot) code(50, num(e.rot));
      const al = e.align || 0, va = e.valign || 0;
      if (al || va) { code(72, al); pt(11, e.p); }
      code(100, 'AcDbText'); if (va) code(73, va);
      grow(e.p);
    } else if (e.t === 'mtext') {
      head('MTEXT', e); code(100, 'AcDbMText'); pt(10, e.p); code(40, num(e.h)); code(41, 0); code(71, e.attach || 1); code(72, 1);
      code(1, String(e.text).split('\n').map(text).join('\\P').slice(0, 250)); pt(11, { x: Math.cos(e.rot || 0), y: Math.sin(e.rot || 0) });
      grow(e.p);
    } else if (e.t === 'hatch') {
      const loops = e.loops.filter((l) => l.length > 2);
      if (!loops.length) continue;
      head('HATCH', e); code(100, 'AcDbHatch'); pt(10, { x: 0, y: 0 }); code(210, 0); code(220, 0); code(230, 1); code(2, 'SOLID'); code(70, 1); code(71, 0); code(91, loops.length);
      loops.forEach((l, i) => { code(92, i ? 2 : 3); code(72, 0); code(73, 1); code(93, l.length); for (const p of l) { code(10, num(p.x)); code(20, num(p.y)); grow(p); } code(97, 0); });
      code(75, 0); code(76, 1); code(98, 0);
    }
  }
  code(0, 'ENDSEC');

  code(0, 'SECTION'); code(2, 'OBJECTS');
  code(0, 'DICTIONARY'); code(5, root); code(330, 0); code(100, 'AcDbDictionary'); code(281, 1); code(3, 'ACAD_GROUP'); code(350, groups);
  code(0, 'DICTIONARY'); code(5, groups); code(330, root); code(100, 'AcDbDictionary'); code(281, 1);
  code(0, 'ENDSEC');
  code(0, 'EOF');

  const H = [], hc = (c, v) => H.push(String(c).padStart(3), String(v));
  if (!Number.isFinite(lo.x)) { lo.x = lo.y = 0; hi.x = hi.y = 0; }
  hc(0, 'SECTION'); hc(2, 'HEADER');
  hc(9, '$ACADVER'); hc(1, 'AC1015'); hc(9, '$DWGCODEPAGE'); hc(3, 'ANSI_1252'); hc(9, '$HANDSEED'); hc(5, next.toString(16).toUpperCase());
  hc(9, '$INSUNITS'); hc(70, units); hc(9, '$MEASUREMENT'); hc(70, [1, 2, 3, 7, 8, 9, 10].includes(units) ? 0 : 1);
  hc(9, '$EXTMIN'); hc(10, num(lo.x)); hc(20, num(lo.y)); hc(30, '0.0'); hc(9, '$EXTMAX'); hc(10, num(hi.x)); hc(20, num(hi.y)); hc(30, '0.0'); hc(9, '$LTSCALE'); hc(40, '1.0');
  hc(0, 'ENDSEC');
  return `${[...H, ...out].join('\r\n')}\r\n`;
}

module.exports = { write, lw100, nearestAci, text };
