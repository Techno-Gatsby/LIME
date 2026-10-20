'use strict';
// Spreadsheets to PDF the way Excel prints them: cell styles, column widths, merged cells, print areas and titles,
// the sheet's page setup, scaling (fit to page, columns or rows), pages ordered down then over, headers and footers.
const path = require('path');
const U = require('./util');

const PX = 96 / 72, EMU = 9525;
const PAPER = { a4: [210, 297], letter: [215.9, 279.4], legal: [215.9, 355.6], a3: [297, 420], a5: [148, 210], tabloid: [279.4, 431.8] };
const PAPER_ID = { 1: 'letter', 3: 'tabloid', 5: 'legal', 8: 'a3', 9: 'a4', 11: 'a5' };
const MARGINS = { normal: [0.7, 0.7, 0.75, 0.75, 0.3, 0.3], narrow: [0.25, 0.25, 0.75, 0.75, 0.3, 0.3], wide: [1, 1, 1, 1, 0.5, 0.5] };
const INDEXED = ('000000FFFFFFFF000000FF000000FFFFFF00FF00FF00FFFF000000FFFFFFFF000000FF000000FFFFFF00FF00FF00FFFF800000008000000080808000800080008080C0C0C0808080'
  + '9999FF993366FFFFCCCCFFFF660066FF80800066CCCCCCFF000080FF00FFFFFF0000FFFF800080800000008080'
  + '0000FF00CCFFCCFFFFCCFFCCFFFF9999CCFFFF99CCCC99FFFFCC993366FF33CCCC99CC00FFCC00FF9900FF6600666699969696003366339966003300333300993300993366333399333333').match(/.{6}/g);
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
const BORDER = { thin: '1px solid', hair: '1px solid', dotted: '1px dotted', dashed: '1px dashed', dashDot: '1px dashed', dashDotDot: '1px dotted', medium: '2px solid', mediumDashed: '2px dashed', mediumDashDot: '2px dashed', mediumDashDotDot: '2px dotted', slantDashDot: '2px dashed', thick: '3px solid', double: '3px double' };
const NAMED = { red: 'FF0000', blue: '0000FF', green: '00FF00', yellow: 'FFFF00', magenta: 'FF00FF', cyan: '00FFFF', black: '000000', white: 'FFFFFF' };

const dec = (s) => s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => (e[0] === '#' ? String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : +e.slice(1)) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]));
// A small XML reader: elements as { n: local name, a: attributes by local name, c: children, t: text }.
function xml(s) {
  const root = { n: '', a: {}, c: [] }, stack = [root];
  const re = /<(\/?)([\w.:-]+)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<[!?][^>]*>|([^<]+)/g;
  for (let m; (m = re.exec(s || ''));) {
    const top = stack[stack.length - 1];
    if (m[5] != null || m[6] != null) { top.t = (top.t || '') + (m[5] ?? dec(m[6])); continue; }
    if (!m[2]) continue;
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const el = { n: m[2].replace(/^.*:/, ''), a: {}, c: [] };
    for (const [, k, v1, v2] of m[3].matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.a[k.replace(/^.*:/, '')] = dec(v1 ?? v2);
    top.c.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}
const kid = (el, n) => el?.c.find((x) => x.n === n);
const kids = (el, n) => el?.c.filter((x) => x.n === n) || [];
const find = (el, n) => { if (!el) return null; for (const c of el.c) { if (c.n === n) return c; const f = find(c, n); if (f) return f; } return null; };
const on = (el) => !!el && !/^(0|false)$/.test(el.a.val ?? '1');
const num = (v, d) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const unx = (s) => s.replace(/_x([\da-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

const colNum = (s) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colName = (c) => { let s = ''; for (let n = c + 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const quote = (n) => (/^[A-Za-z_][\w.]*$/.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);
// "A1:C9", "B:D", "3:7" or "C4" → { r1, c1, r2, c2 } with open ends as Infinity.
function area(s) {
  const [a, b = a] = s.replace(/\$/g, '').trim().split(':');
  const end = (x, last) => { const m = /^([A-Z]{0,3})(\d*)$/i.exec(x.trim()); if (!m || (!m[1] && !m[2])) return null; return [m[2] ? Number(m[2]) - 1 : last ? Infinity : 0, m[1] ? colNum(m[1]) : last ? Infinity : 0]; };
  const p = end(a, false), q = end(b, true);
  if (!p || !q) return null;
  return { r1: Math.min(p[0], q[0]), c1: Math.min(p[1], q[1]), r2: Math.max(p[0], q[0]), c2: Math.max(p[1], q[1]) };
}
// "Sheet1!A1:B4,'Q 2'!C:D" → [{ sheet, r1, c1, r2, c2 }].
function areas(s) {
  const out = [];
  for (const m of String(s || '').matchAll(/(?:(?:'((?:[^']|'')+)'|([^'!,\s][^'!,]*))!)?([$A-Za-z0-9:]+)/g)) {
    const a = area(m[3]);
    if (a) out.push({ sheet: m[1] != null ? m[1].replace(/''/g, "'") : m[2]?.trim() || null, ...a });
  }
  return out;
}

function tint(hex, t) {
  if (!t) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0, l = (mx + mn) / 2;
  const s = d ? (l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)) : 0;
  if (d) h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  l = t < 0 ? l * (1 + t) : l * (1 - t) + t;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (x) => { x = (x + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 0.5 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  return [h + 1 / 3, h, h - 1 / 3].map((x) => Math.round((s ? f(x) : l) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function readStyles(doc, theme) {
  const ss = kid(doc, 'styleSheet');
  const palette = kids(find(ss, 'indexedColors'), 'rgbColor').map((c) => c.a.rgb.slice(-6));
  const color = (el) => {
    if (!el || el.a.auto === '1') return null;
    if (el.a.rgb) return `#${tint(el.a.rgb.slice(-6), num(el.a.tint, 0))}`;
    if (el.a.theme != null) return `#${tint(theme[num(el.a.theme, 1)] || '000000', num(el.a.tint, 0))}`;
    if (el.a.indexed != null) { const i = num(el.a.indexed, 64), c = palette[i] || INDEXED[i]; return c ? `#${tint(c, num(el.a.tint, 0))}` : null; }
    return null;
  };
  const numFmts = Object.fromEntries(kids(kid(ss, 'numFmts'), 'numFmt').map((f) => [f.a.numFmtId, f.a.formatCode]));
  const fonts = kids(kid(ss, 'fonts'), 'font').map((f) => ({ b: on(kid(f, 'b')), i: on(kid(f, 'i')), u: kid(f, 'u') ? kid(f, 'u').a.val || 'single' : '', s: on(kid(f, 'strike')), sz: num(kid(f, 'sz')?.a.val, 11), name: kid(f, 'name')?.a.val || 'Calibri', color: color(kid(f, 'color')), va: kid(f, 'vertAlign')?.a.val }));
  const fills = kids(kid(ss, 'fills'), 'fill').map((f) => {
    const p = kid(f, 'patternFill'), g = kid(f, 'gradientFill');
    if (g) return color(kid(kid(g, 'stop'), 'color'));
    if (!p || !p.a.patternType || p.a.patternType === 'none') return null;
    return color(kid(p, 'fgColor')) || color(kid(p, 'bgColor')) || (p.a.patternType === 'solid' ? '#000000' : null);
  });
  const borders = kids(kid(ss, 'borders'), 'border').map((b) => Object.fromEntries(['left', 'right', 'top', 'bottom'].map((k) => {
    const e = kid(b, k) || kid(b, { left: 'start', right: 'end' }[k]);
    return [k, e?.a.style && BORDER[e.a.style] ? `${BORDER[e.a.style]} ${color(kid(e, 'color')) || '#000000'}` : null];
  })));
  const xfs = kids(kid(ss, 'cellXfs'), 'xf').map((x) => ({ fmt: num(x.a.numFmtId, 0), font: fonts[num(x.a.fontId, 0)] || fonts[0], fill: fills[num(x.a.fillId, 0)] || null, border: borders[num(x.a.borderId, 0)] || {}, al: kid(x, 'alignment')?.a || {} }));
  return { xfs: xfs.length ? xfs : [{ fmt: 0, font: fonts[0], fill: null, border: {}, al: {} }], numFmts, font: fonts[0] || { sz: 11, name: 'Calibri' }, color };
}

// Width in pixels of an Excel column width in characters (Calibri 11, 7-pixel digits), and the default 64.
const colPx = (w) => Math.trunc(((256 * w + Math.trunc(128 / 7)) / 256) * 7);

function readSheet(doc, st, shared) {
  const ws = kid(doc, 'worksheet');
  const fp = kid(ws, 'sheetFormatPr')?.a || {};
  const defW = fp.defaultColWidth ? colPx(num(fp.defaultColWidth, 8.43)) : fp.baseColWidth && num(fp.baseColWidth, 8) !== 8 ? num(fp.baseColWidth, 8) * 7 + 12 : 64;
  const defH = num(fp.defaultRowHeight, 15) * PX;
  const colDefs = kids(kid(ws, 'cols'), 'col').map((c) => ({ min: num(c.a.min, 1) - 1, max: num(c.a.max, 1) - 1, w: c.a.width != null ? colPx(num(c.a.width, 8.43)) : defW, hidden: on({ a: { val: c.a.hidden ?? '0' } }) || num(c.a.width, 1) === 0, s: c.a.style }));
  const rowInfo = new Map(), cells = new Map();
  let r = -1;
  for (const row of kids(kid(ws, 'sheetData'), 'row')) {
    r = row.a.r ? num(row.a.r, r + 2) - 1 : r + 1;
    rowInfo.set(r, { h: row.a.ht != null ? num(row.a.ht, 15) * PX : null, hidden: row.a.hidden === '1' || row.a.hidden === 'true', s: row.a.customFormat === '1' ? num(row.a.s, 0) : null });
    let c = -1;
    for (const cell of kids(row, 'c')) {
      const ref = /^([A-Z]+)(\d+)$/i.exec(cell.a.r || '');
      c = ref ? colNum(ref[1]) : c + 1;
      const v = kid(cell, 'v')?.t, t = cell.a.t || 'n', s = num(cell.a.s, 0);
      let val = null, runs = null;
      if (t === 's') { const x = shared[num(v, -1)]; if (x) ({ text: val, runs } = x); } else if (t === 'inlineStr') ({ text: val, runs } = richText(kid(cell, 'is'), st));
      else if (t === 'b') val = v === '1' ? 'TRUE' : v == null ? null : 'FALSE';
      else if (t === 'n') val = v == null || v === '' ? null : Number(v);
      else val = v ?? null;
      cells.set(`${r},${c}`, { r, c, t, v: val, runs, s });
    }
  }
  const po = kid(ws, 'printOptions')?.a || {}, pm = kid(ws, 'pageMargins')?.a, ps = kid(ws, 'pageSetup')?.a || {}, hf = kid(ws, 'headerFooter');
  const brk = (n) => new Set(kids(kid(ws, n), 'brk').map((b) => num(b.a.id, 0)));
  return {
    defW, defH, colDefs, rowInfo, cells, merges: kids(kid(ws, 'mergeCells'), 'mergeCell').map((m) => area(m.a.ref)).filter(Boolean),
    print: { grid: po.gridLines === '1' || po.gridLines === 'true', heads: po.headings === '1' || po.headings === 'true', center: po.horizontalCentered === '1' || po.horizontalCentered === 'true' },
    margins: pm && ['left', 'right', 'top', 'bottom', 'header', 'footer'].map((k, i) => num(pm[k], MARGINS.normal[i])),
    setup: { paper: PAPER_ID[ps.paperSize], orientation: ps.orientation === 'landscape' || ps.orientation === 'portrait' ? ps.orientation : null, scale: num(ps.scale, 100), fit: kid(kid(ws, 'sheetPr'), 'pageSetUpPr')?.a.fitToPage === '1', fitW: num(ps.fitToWidth, 1), fitH: num(ps.fitToHeight, 1), over: ps.pageOrder === 'overThenDown' },
    header: kid(hf, 'oddHeader')?.t || '', footer: kid(hf, 'oddFooter')?.t || '',
    rowBreaks: brk('rowBreaks'), colBreaks: brk('colBreaks'), drawing: kid(ws, 'drawing')?.a.id,
  };
}
function richText(si, st) {
  if (!si) return { text: '', runs: null };
  const rs = kids(si, 'r');
  if (!rs.length) return { text: unx(kid(si, 't')?.t || ''), runs: null };
  const runs = rs.map((r) => {
    const p = kid(r, 'rPr');
    return { text: unx(kid(r, 't')?.t || ''), font: p && { b: on(kid(p, 'b')), i: on(kid(p, 'i')), u: kid(p, 'u') ? kid(p, 'u').a.val || 'single' : '', s: on(kid(p, 'strike')), sz: num(kid(p, 'sz')?.a.val, null), name: kid(p, 'rFont')?.a.val, color: st.color(kid(p, 'color')), va: kid(p, 'vertAlign')?.a.val } };
  });
  return { text: runs.map((x) => x.text).join(''), runs };
}

// The whole workbook: XLSX/XLSM are read with styles; other formats go through SheetJS as plain grids.
async function readWorkbook(input) {
  const e = U.ext(input);
  if (['xlsx', 'xlsm', 'xltx', 'xltm'].includes(e)) { try { return readXlsx(await U.fsp.readFile(input)); } catch (_) {} }
  const XLSX = require('xlsx');
  const wb = e === 'xlsx' ? XLSX.read(await U.fsp.readFile(input), { cellStyles: true }) : await require('./office').readBook(input);
  return {
    active: num(wb.Workbook?.Views?.[0]?.activeTab, 0), titles: {}, areas: {}, plain: true, sheets: wb.SheetNames.map((name, i) => {
      const sh = wb.Sheets[name], cells = new Map();
      for (const k of Object.keys(sh)) {
        if (k[0] === '!') continue;
        const a = XLSX.utils.decode_cell(k), x = sh[k];
        cells.set(`${a.r},${a.c}`, { r: a.r, c: a.c, t: x.t === 'n' ? 'n' : x.t === 'b' ? 'b' : 's', v: x.w ?? (x.v == null ? null : String(x.v)), text: x.w, s: 0 });
      }
      const rowInfo = new Map((sh['!rows'] || []).map((x, r) => [r, x && { h: x.hpx || (x.hpt ? x.hpt * PX : null), hidden: !!x.hidden }]).filter((x) => x[1]));
      return { name, hidden: !!wb.Workbook?.Sheets?.[i]?.Hidden, defW: 64, defH: 20, colDefs: (sh['!cols'] || []).map((x, c) => x && { min: c, max: c, w: x.wpx || (x.wch ? colPx(x.wch + 0.71) : 64), hidden: !!x.hidden }).filter(Boolean), rowInfo, cells, merges: (sh['!merges'] || []).map((m) => ({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c })), print: {}, setup: {}, header: '', footer: '', rowBreaks: new Set(), colBreaks: new Set(), images: [], charts: 0 };
    }),
    st: { xfs: [{ fmt: 0, font: { sz: 11, name: 'Calibri' }, fill: null, border: {}, al: {} }], numFmts: {}, font: { sz: 11, name: 'Calibri' } },
  };
}
function readXlsx(buf) {
  const z = require('fflate').unzipSync(new Uint8Array(buf)), get = (p) => (z[p] ? Buffer.from(z[p]).toString('utf8') : '');
  const rels = (p) => { const dir = path.posix.dirname(p), r = path.posix.join(dir, '_rels', `${path.posix.basename(p)}.rels`); return Object.fromEntries(kids(kid(xml(get(r)), 'Relationships'), 'Relationship').map((x) => [x.a.Id, x.a.TargetMode === 'External' ? null : x.a.Target.startsWith('/') ? x.a.Target.slice(1) : path.posix.normalize(path.posix.join(dir, x.a.Target))])); };
  const wbDoc = kid(xml(get('xl/workbook.xml')), 'workbook');
  if (!wbDoc) throw new Error('not a workbook');
  const wbRels = rels('xl/workbook.xml');
  const scheme = find(xml(get('xl/theme/theme1.xml')), 'clrScheme');
  const tc = (n) => { const e = kid(scheme, n); return e && (kid(e, 'srgbClr')?.a.val || kid(e, 'sysClr')?.a.lastClr); };
  const theme = scheme ? ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map((n, i) => tc(n) || THEME[i]) : THEME;
  const st = readStyles(xml(get('xl/styles.xml')), theme);
  const shared = kids(kid(xml(get('xl/sharedStrings.xml')), 'sst'), 'si').map((si) => richText(si, st));
  const list = kids(kid(wbDoc, 'sheets'), 'sheet');
  const names = { areas: {}, titles: {} };
  for (const d of kids(kid(wbDoc, 'definedNames'), 'definedName')) {
    const k = d.a.name === '_xlnm.Print_Area' ? 'areas' : d.a.name === '_xlnm.Print_Titles' ? 'titles' : null;
    if (k && d.a.localSheetId != null) names[k][list[num(d.a.localSheetId, -1)]?.a.name] = d.t || '';
  }
  const sheets = list.map((s) => {
    const p = wbRels[s.a.id], sh = readSheet(xml(get(p)), st, shared);
    const d = sh.drawing && rels(p)[sh.drawing];
    Object.assign(sh, { name: s.a.name, hidden: !!s.a.state && s.a.state !== 'visible', ...drawingOf(d, get, rels, z) });
    return sh;
  });
  return { sheets, st, active: num(find(wbDoc, 'workbookView')?.a.activeTab, 0), date1904: find(wbDoc, 'workbookPr')?.a.date1904 === '1', ...names };
}
function drawingOf(p, get, rels, z) {
  if (!p || !z[p]) return { images: [], charts: 0 };
  const dr = kid(xml(get(p)), 'wsDr'), rr = rels(p), images = [];
  let charts = 0;
  const at = (el) => el && { c: num(kid(el, 'col')?.t, 0), co: num(kid(el, 'colOff')?.t, 0) / EMU, r: num(kid(el, 'row')?.t, 0), ro: num(kid(el, 'rowOff')?.t, 0) / EMU };
  for (const a of dr?.c || []) {
    if (find(a, 'chart')) charts++;
    const blip = find(a, 'blip'), file = blip && rr[blip.a.embed], mime = file && { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' }[U.ext(file)];
    if (!mime || !z[file]) continue;
    const ext = kid(a, 'ext')?.a || find(find(a, 'spPr'), 'ext')?.a || {};
    images.push({ from: at(kid(a, 'from')), to: at(kid(a, 'to')), w: num(ext.cx, 0) / EMU, h: num(ext.cy, 0) / EMU, src: `data:${mime};base64,${Buffer.from(z[file]).toString('base64')}` });
  }
  return { images, charts };
}

// Geometry and text of one sheet.
function layoutOf(sh, wb) {
  const wc = new Map(), hc = new Map();
  const width = (c) => { if (!wc.has(c)) { const d = sh.colDefs.find((x) => c >= x.min && c <= x.max); wc.set(c, d ? (d.hidden ? 0 : d.w) : sh.defW); } return wc.get(c); };
  const height = (r) => { if (!hc.has(r)) { const i = sh.rowInfo.get(r); hc.set(r, i?.hidden ? 0 : i?.h ?? sh.defH); } return hc.get(r); };
  const SSF = require('xlsx').SSF;
  const fmtOf = (xf) => wb.st.numFmts[xf.fmt] ?? xf.fmt;
  const show = (cell) => {
    if (cell.v == null) return { text: '' };
    if (cell.t !== 'n' || wb.plain) return { text: String(cell.v) };
    const code = fmtOf(wb.st.xfs[cell.s] || wb.st.xfs[0]);
    let text;
    try { text = SSF.format(code, cell.v, { date1904: wb.date1904 }); } catch (_) { text = String(cell.v); }
    const secs = typeof code === 'string' ? code.match(/(?:"[^"]*"|\\.|[^;])+/g) || [] : [];
    const sec = secs.length > 1 && cell.v < 0 ? secs[1] : secs.length > 2 && cell.v === 0 ? secs[2] : secs[0] || '';
    const m = /\[(red|blue|green|yellow|magenta|cyan|black|white)\]/i.exec(sec);
    return { text, color: m && `#${NAMED[m[1].toLowerCase()]}` };
  };
  // Used range: cells with something to show, or a fill or border, plus merges and pictures.
  let r1 = Infinity, c1 = Infinity, r2 = -1, c2 = -1;
  const grow = (r, c) => { r1 = Math.min(r1, r); c1 = Math.min(c1, c); r2 = Math.max(r2, r); c2 = Math.max(c2, c); };
  for (const cell of sh.cells.values()) {
    const xf = wb.st.xfs[cell.s];
    if ((cell.v != null && cell.v !== '') || xf?.fill || Object.values(xf?.border || {}).some(Boolean)) grow(cell.r, cell.c);
  }
  for (const m of sh.merges) { grow(m.r1, m.c1); grow(m.r2, m.c2); }
  for (const im of sh.images) { grow(im.from.r, im.from.c); if (im.to) grow(im.to.r, im.to.c); }
  return { width, height, show, used: r2 < 0 ? null : { r1, c1, r2, c2 } };
}

function hfText(s, ctx) {
  const parts = { l: '', c: '', r: '' };
  let side = 'c', bold = false, size = null;
  const add = (t) => { parts[side] += t; };
  for (const m of String(s).matchAll(/&([LCR])|&"([^"]*)"|&(\d+)|&([PNDTFAZGBIUESXYH&])|&K[\dA-F]{6}|&K\d{2}[+-]\d{3}|([^&]+)/gi)) {
    if (m[1]) side = m[1].toLowerCase();
    else if (m[2] != null) bold = bold || /bold/i.test(m[2]);
    else if (m[3]) size = size || Number(m[3]);
    else if (/^b$/i.test(m[4] || '')) bold = true;
    else if (m[4]) add({ P: String(ctx.page), N: String(ctx.pages), D: ctx.date, T: ctx.time, F: ctx.file, A: ctx.sheet, Z: '', G: '', '&': '&' }[m[4].toUpperCase()] ?? '');
    else if (m[5]) add(m[5]);
  }
  return { ...parts, bold, size };
}

// Pages for one print area of one sheet.
function paginate(sh, L, a, o, titles) {
  const vis = (lo, hi, size) => { const out = []; for (let i = lo; i <= hi; i++) if (size(i) > 0) out.push(i); return out; };
  const rows = vis(a.r1, a.r2, L.height), cols = vis(a.c1, a.c2, L.width);
  if (!rows.length || !cols.length) return [];
  const tRows = titles.rows ? vis(titles.rows.r1, titles.rows.r2, L.height) : [], tCols = titles.cols ? vis(titles.cols.c1, titles.cols.c2, L.width) : [];
  const sum = (list, size) => list.reduce((n, i) => n + size(i), 0);
  const headW = o.heads ? Math.max(28, String(a.r2 + 1).length * 7 + 14) : 0, headH = o.heads ? 20 : 0;
  const W = sum(cols, L.width) + headW, H = sum(rows, L.height) + headH;
  const [pw0, ph0] = PAPER[o.paper], m = o.margins.map((x) => x * 96);
  const box = (land) => { const [w, h] = land ? [ph0, pw0] : [pw0, ph0]; return [(w / 25.4) * 96 - m[0] - m[1], (h / 25.4) * 96 - m[2] - m[3]]; };
  const scaleFor = ([pw, ph]) => {
    const s = { page: Math.min(pw / W, ph / H), columns: pw / W, rows: ph / H, none: 1 }[o.fit] ?? (sh.setup.fit ? Math.min(sh.setup.fitW ? (pw * sh.setup.fitW) / W : Infinity, sh.setup.fitH ? (ph * sh.setup.fitH) / H : Infinity, 1) : (sh.setup.scale || 100) / 100);
    return Math.max(0.1, Math.min(o.fit === 'sheet' && !sh.setup.fit ? 4 : 1, s));
  };
  // Greedy bands of rows or columns; a band that starts after the repeated titles leaves room for them.
  const bands = (list, budget, size, breaks, tl) => {
    const last = tl.length ? tl[tl.length - 1] : -1, tw = sum(tl, size), out = [];
    let cur = [], used = 0, room = budget;
    for (const i of list) {
      if (cur.length && (used + size(i) > room + 0.5 || breaks.has(i))) { out.push(cur); cur = []; used = 0; }
      if (!cur.length) room = budget - (tl.length && i > last ? tw : 0);
      cur.push(i); used += size(i);
    }
    if (cur.length) out.push(cur);
    return out;
  };
  const plan = (land) => {
    const pb = box(land), s = scaleFor(pb);
    const cb = bands(cols, pb[0] / s - headW, L.width, sh.colBreaks, tCols), rb = bands(rows, pb[1] / s - headH, L.height, sh.rowBreaks, tRows);
    return { land, s, cb, rb, n: cb.length * rb.length, pb };
  };
  let p;
  if (o.orientation === 'landscape' || o.orientation === 'portrait') p = plan(o.orientation === 'landscape');
  else { const a1 = plan(false), b1 = plan(true); p = b1.n < a1.n || (b1.n === a1.n && b1.s > a1.s + 0.01) ? b1 : a1; }
  const pages = [];
  const titled = (band, tl) => (tl.length && band[0] > tl[tl.length - 1] ? tl : []);
  const outer = o.over ? p.rb : p.cb, inner = o.over ? p.cb : p.rb;
  for (const x of outer) {
    for (const y of inner) {
      const [cb, rb] = o.over ? [y, x] : [x, y], tr = titled(rb, tRows), tc = titled(cb, tCols);
      pages.push({ rows: [...tr, ...rb], cols: [...tc, ...cb], band: { rows: rb, cols: cb, tw: sum(tc, L.width), th: sum(tr, L.height) }, s: p.s, land: p.land, headW, headH, pb: p.pb });
    }
  }
  return pages;
}

function fontCss(f, base) {
  if (!f) return '';
  const name = f.name || base?.name || 'Calibri';
  const fam = /^calibri$/i.test(name) ? "'Lime Calibri'" : `'${name.replace(/'/g, '')}', 'Lime Calibri'`;
  return `font-family:${fam},'Helvetica Neue',Arial,sans-serif;font-size:${((f.sz || base?.sz || 11) * PX).toFixed(2)}px;${f.b ? 'font-weight:700;' : ''}${f.i ? 'font-style:italic;' : ''}${f.u || f.s ? `text-decoration:${f.u ? `underline${/double/.test(f.u) ? ' double' : ''}` : ''} ${f.s ? 'line-through' : ''};` : ''}${f.color ? `color:${f.color};` : ''}${f.va === 'superscript' ? 'vertical-align:super;font-size:smaller;' : f.va === 'subscript' ? 'vertical-align:sub;font-size:smaller;' : ''}`;
}
function xfCss(xf, i, base) {
  const al = xf.al, b = xf.border;
  const v = { top: 'flex-start', center: 'center', justify: 'center', distributed: 'center' }[al.vertical] || 'flex-end';
  return `.x${i}{${fontCss(xf.font, base)}}.x${i}>.v{justify-content:${v};${al.wrapText === '1' || al.wrapText === 'true' ? 'white-space:pre-wrap;word-break:break-word;' : ''}${al.indent ? `padding-left:${num(al.indent, 0) * 9 + 2}px;` : ''}}`
    + `${xf.fill ? `.x${i}{background:${xf.fill}!important}` : ''}${['top', 'right', 'bottom', 'left'].filter((k) => b[k]).map((k) => `.x${i}{border-${k}:${b[k]}!important}`).join('')}`;
}
const fontFaces = (app) => {
  const url = (n) => `url("${app ? `media://font/${n}` : require('url').pathToFileURL(path.join(U.cfg.data, 'fonts', n)).href}")`;
  return [['Regular', 400, 'normal'], ['Bold', 700, 'normal'], ['Italic', 400, 'italic'], ['BoldItalic', 700, 'italic']]
    .map(([n, w, s]) => `@font-face{font-family:'Lime Calibri';src:local('Calibri${n === 'Regular' ? '' : ` ${n.replace('BoldItalic', 'Bold Italic')}`}'),${url(`Carlito-${n}.ttf`)};font-weight:${w};font-style:${s}}`).join('');
};
const CSS = `*{box-sizing:border-box}html,body{margin:0;padding:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pg{position:relative;overflow:hidden;break-after:page}.pg:last-child{break-after:auto}.bd{position:absolute;overflow:hidden}.z{position:relative;transform-origin:0 0}
table{border-collapse:collapse;table-layout:fixed}td{padding:0;position:relative;overflow:visible;vertical-align:top}
.v{position:absolute;top:0;display:flex;flex-direction:column;overflow:hidden;white-space:pre;padding:0 2px;line-height:1.2}
.grid td{background:linear-gradient(to right,transparent calc(100% - 1px),#c8c8c8 0) top/100% 100% no-repeat,linear-gradient(to bottom,transparent calc(100% - 1px),#c8c8c8 0) top/100% 100% no-repeat}
.grid tr:first-child td{border-top:1px solid #c8c8c8}.grid td:first-child{border-left:1px solid #c8c8c8}
td.h{background:#f2f2f2!important;border:1px solid #bdbdbd!important;color:#444;font:11px/1 'Lime Calibri','Helvetica Neue',Arial,sans-serif;text-align:center;vertical-align:middle}
.hf{position:absolute;left:0;right:0;display:flex;justify-content:space-between;font:${(11 * PX).toFixed(2)}px 'Lime Calibri','Helvetica Neue',Arial,sans-serif;white-space:pre}.hf>span{flex:1}.hf>span:nth-child(2){text-align:center}.hf>span:nth-child(3){text-align:right}
img.pic{position:absolute}`;

// One page as a table. Cells that overflow into empty neighbours stretch over them like Excel draws them.
function pageTable(sh, L, wb, pg, o, picker) {
  const merged = new Map(), covered = new Set();
  for (const m of sh.merges) {
    const rs = pg.rows.filter((r) => r >= m.r1 && r <= m.r2), cs = pg.cols.filter((c) => c >= m.c1 && c <= m.c2);
    if (!rs.length || !cs.length) continue;
    merged.set(`${rs[0]},${cs[0]}`, { rs: rs.length, cs: cs.length, key: `${m.r1},${m.c1}`, show: rs[0] === m.r1 && cs[0] === m.c1, w: cs.reduce((n, c) => n + L.width(c), 0), h: rs.reduce((n, r) => n + L.height(r), 0) });
    for (const r of rs) for (const c of cs) if (r !== rs[0] || c !== cs[0]) covered.add(`${r},${c}`);
  }
  const empty = (r, c) => { const k = `${r},${c}`; const x = sh.cells.get(k); return !covered.has(k) && !merged.has(k) && (x?.v == null || x.v === ''); };
  const colsHtml = `${pg.headW ? `<col style="width:${pg.headW}px">` : ''}${pg.cols.map((c) => `<col style="width:${L.width(c)}px">`).join('')}`;
  const out = [`<table class="${o.grid ? 'grid' : ''}" style="width:${pg.headW + pg.cols.reduce((n, c) => n + L.width(c), 0)}px">${colsHtml}`];
  if (pg.headH) out.push(`<tr style="height:${pg.headH}px">${pg.headW ? '<td class="h"></td>' : ''}${pg.cols.map((c) => `<td class="h"${picker ? ` data-col="${c}"` : ''}>${colName(c)}</td>`).join('')}</tr>`);
  for (const r of pg.rows) {
    const h = L.height(r), rowXf = sh.rowInfo.get(r)?.s;
    out.push(`<tr style="height:${h}px">${pg.headW ? `<td class="h"${picker ? ` data-row="${r}"` : ''}>${r + 1}</td>` : ''}`);
    pg.cols.forEach((c, ci) => {
      const k = `${r},${c}`;
      if (covered.has(k)) return;
      const mg = merged.get(k), cell = sh.cells.get(mg ? mg.key : k);
      const s = cell?.s ?? rowXf ?? sh.colDefs.find((d) => c >= d.min && c <= d.max && d.s != null)?.s ?? 0, xf = wb.st.xfs[s] || wb.st.xfs[0];
      const shown = cell && (!mg || mg.show) ? L.show(cell) : { text: '' };
      const w = mg ? mg.w : L.width(c), hh = mg ? mg.h : h;
      const isNum = cell?.t === 'n';
      const hz = xf.al.horizontal && xf.al.horizontal !== 'general' ? xf.al.horizontal : isNum ? 'right' : cell?.t === 'b' || cell?.t === 'e' ? 'center' : 'left';
      let left = 0, right = 0;
      const wrap = xf.al.wrapText === '1' || xf.al.wrapText === 'true';
      if (shown.text && !mg && !wrap && !isNum && hz !== 'fill' && hz !== 'justify') {
        if (hz === 'left' || hz === 'center' || hz === 'centerContinuous') for (let j = ci + 1; j < pg.cols.length && empty(r, pg.cols[j]); j++) right += L.width(pg.cols[j]);
        if (hz === 'right' || hz === 'center' || hz === 'centerContinuous') for (let j = ci - 1; j >= 0 && empty(r, pg.cols[j]); j--) left += L.width(pg.cols[j]);
        if (hz !== 'left' && hz !== 'right') right = left = Math.min(left, right);
      }
      const runs = cell?.runs && shown.text ? cell.runs.map((x) => (x.font ? `<span style="${fontCss({ ...xf.font, ...Object.fromEntries(Object.entries(x.font).filter(([, v]) => v != null && v !== '')) }, wb.st.font)}">${esc(x.text)}</span>` : esc(x.text))).join('') : esc(hz === 'fill' && shown.text ? shown.text.repeat(Math.max(1, Math.floor(w / Math.max(4, shown.text.length * 7)))) : shown.text);
      const ta = { center: 'center', centerContinuous: 'center', right: 'right', distributed: 'center', justify: 'justify' }[hz] || 'left';
      out.push(`<td class="x${s}"${mg ? ` rowspan="${mg.rs}" colspan="${mg.cs}"` : ''}${picker ? ` data-r="${r}" data-c="${c}"` : ''}><div class="v" style="left:${-left}px;width:${w + left + right}px;height:${hh}px;text-align:${ta}${shown.color ? `;color:${shown.color}` : ''}">${runs ? `<span>${runs}</span>` : ''}</div></td>`);
    });
    out.push('</tr>');
  }
  out.push('</table>');
  // Pictures that overlap this page's rows and columns, placed from their anchor cells.
  const b = pg.band;
  if (b) {
    const c0 = b.cols[0], r0 = b.rows[0], cw = sumBetween(c0, b.cols[b.cols.length - 1] + 1, L.width), rh = sumBetween(r0, b.rows[b.rows.length - 1] + 1, L.height);
    for (const im of sh.images) {
      const f = im.from, x = sumBetween(c0, f.c, L.width) + f.co, y = sumBetween(r0, f.r, L.height) + f.ro;
      const w = im.to ? sumBetween(f.c, im.to.c, L.width) + im.to.co - f.co : im.w, h = im.to ? sumBetween(f.r, im.to.r, L.height) + im.to.ro - f.ro : im.h;
      if (x >= cw || y >= rh || x + w <= 0 || y + h <= 0) continue;
      out.push(`<img class="pic" alt="" src="${im.src}" style="left:${pg.headW + b.tw + x}px;top:${pg.headH + b.th + y}px;width:${Math.max(1, w)}px;height:${Math.max(1, h)}px">`);
    }
  }
  return out.join('');
}
const sumBetween = (a, b, size) => { let n = 0; for (let i = Math.min(a, b); i < Math.max(a, b); i++) n += size(i); return a <= b ? n : -n; };

function resolveOptions(o, sh, wb) {
  const loc = Intl.DateTimeFormat().resolvedOptions().locale || '';
  return {
    fit: o.fit || 'sheet', orientation: o.orientation && o.orientation !== 'auto' ? o.orientation : sh.setup.orientation,
    paper: PAPER[o.paper] ? o.paper : sh.setup.paper || (/[-_](US|CA)$/i.test(loc) ? 'letter' : 'a4'),
    margins: MARGINS[o.margins] || sh.margins || MARGINS.normal,
    grid: o.gridlines === 'on' || (o.gridlines !== 'off' && (sh.print.grid || !!wb.plain)),
    heads: !!o.headings || !!sh.print.heads, center: !!o.center || !!sh.print.center,
    over: o.order === 'over' || (o.order !== 'down' && !!sh.setup.over),
  };
}

// What to print: [{ sheet, area }] following Excel's choices.
function targets(wb, o) {
  const visible = wb.sheets.filter((s) => !s.hidden);
  const active = wb.sheets[wb.active] && !wb.sheets[wb.active].hidden ? wb.sheets[wb.active] : visible[0];
  const out = [];
  const add = (sh, a) => {
    const L = layoutOf(sh, wb);
    if (!L.used) return;
    const u = L.used;
    const r = a ? { r1: a.r1, c1: a.c1, r2: a.r2 === Infinity ? u.r2 : a.r2, c2: a.c2 === Infinity ? u.c2 : a.c2 } : u;
    if (r.r1 <= r.r2 && r.c1 <= r.c2) out.push({ sh, L, a: r });
  };
  if (o.print === 'selection') {
    const list = areas(o.cells);
    if (!list.length) throw new Error('Choose the cells to print, for example A1:F20.');
    for (const a of list) {
      const sh = a.sheet ? wb.sheets.find((s) => s.name.toLowerCase() === a.sheet.toLowerCase()) : active;
      if (!sh) throw new Error(`There is no sheet called “${a.sheet}”.`);
      add(sh, a);
    }
    return out;
  }
  for (const sh of o.print === 'active' ? [active] : visible) {
    const pa = !o.ignoreArea && wb.areas[sh.name] ? areas(wb.areas[sh.name]) : [];
    if (pa.length) pa.forEach((a) => add(sh, a)); else add(sh, null);
  }
  return out;
}
function titlesOf(wb, sh) {
  const t = { rows: null, cols: null };
  for (const a of areas(wb.titles[sh.name] || '')) { if (a.c2 === Infinity) t.rows = a; else if (a.r2 === Infinity) t.cols = a; }
  return t;
}

async function toPdf(input, opts, out, ctx) {
  ctx.progress?.(0.05, 'Reading workbook');
  const wb = await readWorkbook(input);
  const list = targets(wb, opts || {});
  if (!list.length) throw new Error(opts?.print === 'selection' ? 'The chosen cells are empty.' : 'There is nothing to print: the sheets are empty.');
  const pages = [];
  for (const t of list) {
    const o = resolveOptions(opts || {}, t.sh, wb);
    for (const pg of paginate(t.sh, t.L, t.a, o, titlesOf(wb, t.sh))) pages.push({ ...pg, t, o });
  }
  if (pages.length > 3000) throw new Error(`That would print ${pages.length} pages. Choose a print area or a selection, or fit the columns on one page.`);
  ctx.progress?.(0.3, `Laying out ${pages.length} page${pages.length === 1 ? '' : 's'}`);
  const sizes = [...new Set(pages.map((p) => `${p.o.paper}-${p.land ? 'l' : 'p'}`))];
  const now = new Date(), file = path.basename(input);
  const css = [fontFaces(), CSS, ...wb.st.xfs.map((x, i) => xfCss(x, i, wb.st.font)),
    ...sizes.map((k, i) => { const [p, l] = k.split('-'), [w, h] = l === 'l' ? [...PAPER[p]].reverse() : PAPER[p]; return `@page s${i}{size:${w}mm ${h}mm;margin:0}.s${i}{page:s${i};width:${w}mm;height:${h - 0.2}mm}`; })].join('\n');
  const body = pages.map((pg, i) => {
    const { sh, L } = pg.t, o = pg.o, m = o.margins.map((x) => x * 96), k = sizes.indexOf(`${o.paper}-${pg.land ? 'l' : 'p'}`);
    const hctx = { page: i + 1, pages: pages.length, date: now.toLocaleDateString(), time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), file, sheet: sh.name };
    const footer = sh.footer || (opts?.pageNumbers ? '&CPage &P of &N' : '');
    const hf = (s, top) => { if (!s) return ''; const x = hfText(s, hctx); return `<div class="hf" style="${top ? `top:${m[4]}px` : `bottom:${m[5]}px`};padding:0 ${m[1]}px 0 ${m[0]}px;${x.bold ? 'font-weight:700;' : ''}${x.size ? `font-size:${(x.size * PX).toFixed(1)}px` : ''}"><span>${esc(x.l)}</span><span>${esc(x.c)}</span><span>${esc(x.r)}</span></div>`; };
    const tableW = (pg.headW + pg.cols.reduce((n, c) => n + L.width(c), 0)) * pg.s;
    const dx = o.center ? Math.max(0, (pg.pb[0] - tableW) / 2) : 0;
    return `<section class="pg s${k}">${hf(sh.header, true)}<div class="bd" style="left:${m[0]}px;top:${m[2]}px;width:${pg.pb[0]}px;height:${pg.pb[1]}px"><div class="z" style="left:${dx}px;transform:scale(${pg.s})">${pageTable(sh, L, wb, pg, o)}</div></div>${hf(footer, false)}</section>`;
  }).join('\n');
  await require('./office').htmlToPdf(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(U.base(input))}</title><style>${css}</style></head><body>${body}</body></html>`, out, ctx, { css: true });
  const charts = [...new Set(list.map((t) => t.sh))].reduce((n, s) => n + (s.charts || 0), 0);
  return { path: out, note: `${pages.length} page${pages.length === 1 ? '' : 's'}${charts ? ` · ${charts} chart${charts === 1 ? '' : 's'} not drawn` : ''}` };
}

// The first 400 rows and 60 columns of each visible sheet, for choosing cells to print.
async function preview(input) {
  const wb = await readWorkbook(input);
  const css = [fontFaces(true), CSS, ...wb.st.xfs.map((x, i) => xfCss(x, i, wb.st.font))].join('\n');
  const sheets = wb.sheets.filter((s) => !s.hidden).map((sh) => {
    const L = layoutOf(sh, wb), u = L.used || { r1: 0, c1: 0, r2: 0, c2: 0 };
    const rows = [], cols = [];
    for (let r = 0; r <= Math.min(u.r2 + 5, 399); r++) if (L.height(r) > 0) rows.push(r);
    for (let c = 0; c <= Math.min(u.c2 + 3, 59); c++) if (L.width(c) > 0) cols.push(c);
    const html = pageTable(sh, L, wb, { rows, cols, headW: Math.max(28, String(rows[rows.length - 1] + 1).length * 7 + 14), headH: 20 }, { grid: true }, true);
    return { name: sh.name, ref: quote(sh.name), html, used: L.used && `${colName(L.used.c1)}${L.used.r1 + 1}:${colName(L.used.c2)}${L.used.r2 + 1}`, area: wb.areas[sh.name] || '' };
  });
  return { css, sheets, active: Math.max(0, wb.sheets.filter((s) => !s.hidden).indexOf(wb.sheets[wb.active])) };
}

module.exports = { toPdf, preview, readWorkbook, areas, colName, quote };
