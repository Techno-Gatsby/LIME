import { api, $, $$, esc, nameOf, applyTheme } from './ui.js';

await applyTheme();
document.documentElement.dataset.platform = api.platform;
if (api.platform !== 'darwin') $$('kbd.mod').forEach((k) => { k.textContent = 'Ctrl'; }); else $$('kbd.mod').forEach((k) => { k.textContent = '⌘'; });
const data = await api.invoke('picker:data');
if (!data) window.close();
document.title = `Choose cells — ${nameOf(data.file)}`;
$('head').append(Object.assign(document.createElement('style'), { textContent: data.css }));

const grid = $('#grid'), sheetEl = $('#sheet'), selEl = $('#sel'), field = $('#range'), useBtn = $('[data-a="use"]');
const colName = (c) => { let s = ''; for (let n = c + 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const colNum = (s) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const S = { sheet: data.active, areas: [], drag: null };

let geo = { rows: new Map(), cols: new Map(), rowList: [], colList: [] };
function measure() {
  const base = sheetEl.getBoundingClientRect(), rows = new Map(), cols = new Map();
  for (const td of $$('td.h[data-row]', sheetEl)) { const r = td.getBoundingClientRect(); rows.set(Number(td.dataset.row), { y: r.top - base.top, h: r.height }); }
  for (const td of $$('td.h[data-col]', sheetEl)) { const r = td.getBoundingClientRect(); cols.set(Number(td.dataset.col), { x: r.left - base.left, w: r.width }); }
  geo = { rows, cols, rowList: [...rows.keys()], colList: [...cols.keys()] };
}
const clampTo = (list, v) => (list.includes(v) ? v : list.find((x) => x >= v) ?? list[list.length - 1]);
function rect(a) {
  const r1 = clampTo(geo.rowList, a.r1), r2 = clampTo(geo.rowList, Math.min(a.r2, geo.rowList[geo.rowList.length - 1])), c1 = clampTo(geo.colList, a.c1), c2 = clampTo(geo.colList, Math.min(a.c2, geo.colList[geo.colList.length - 1]));
  const t = geo.rows.get(r1), b = geo.rows.get(r2), l = geo.cols.get(c1), r = geo.cols.get(c2);
  return t && b && l && r ? { left: l.x, top: t.y, width: r.x + r.w - l.x, height: b.y + b.h - t.y } : null;
}
const norm = (a) => ({ ...a, r1: Math.min(a.r1, a.r2), r2: Math.max(a.r1, a.r2), c1: Math.min(a.c1, a.c2), c2: Math.max(a.c1, a.c2) });
const fmt = (a) => (a.cols ? `${colName(a.c1)}:${colName(a.c2)}` : a.rows ? `${a.r1 + 1}:${a.r2 + 1}` : a.r1 === a.r2 && a.c1 === a.c2 ? `${colName(a.c1)}${a.r1 + 1}` : `${colName(a.c1)}${a.r1 + 1}:${colName(a.c2)}${a.r2 + 1}`);
const sheet = () => data.sheets[S.sheet];
const text = () => S.areas.map((a) => `${sheet().ref}!${fmt(norm(a))}`).join(', ');

function paint(fromField) {
  selEl.innerHTML = S.areas.map((a, i) => { const r = rect(norm(a)); return r ? `<div class="${i === S.areas.length - 1 ? 'anchor' : ''}" style="left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px"></div>` : ''; }).join('');
  const on = (k, v) => S.areas.some((a) => { const n = norm(a); return k === 'row' ? v >= n.r1 && v <= n.r2 : v >= n.c1 && v <= n.c2; });
  for (const td of $$('td.h[data-row]', sheetEl)) td.classList.toggle('on', on('row', Number(td.dataset.row)));
  for (const td of $$('td.h[data-col]', sheetEl)) td.classList.toggle('on', on('col', Number(td.dataset.col)));
  if (!fromField) { field.value = text(); field.removeAttribute('aria-invalid'); }
  useBtn.disabled = !S.areas.length;
}

function show(i) {
  S.sheet = i;
  sheetEl.innerHTML = sheet().html;
  $('#tabs').innerHTML = data.sheets.map((s, k) => `<button type="button" role="tab" data-i="${k}" aria-selected="${k === i}">${esc(s.name)}</button>`).join('');
  grid.scrollTo(0, 0);
  requestAnimationFrame(() => { measure(); paint(); });
}

function parse(value) {
  const out = [];
  let sheetIndex = S.sheet;
  for (const m of value.matchAll(/(?:(?:'((?:[^']|'')+)'|([^'!,\s][^'!,]*))!)?\$?([A-Za-z]{0,3})\$?(\d*)(?::\$?([A-Za-z]{0,3})\$?(\d*))?/g)) {
    if (!m[0].trim() || (!m[3] && !m[4])) continue;
    const name = m[1] != null ? m[1].replace(/''/g, "'") : m[2]?.trim();
    if (name) { const k = data.sheets.findIndex((s) => s.name.toLowerCase() === name.toLowerCase()); if (k < 0) return null; sheetIndex = k; }
    const [c1, r1, c2 = m[5] ?? m[3], r2 = m[6] ?? m[4]] = [m[3], m[4], m[5], m[6]];
    const cols = !r1 && !r2, rows = !c1 && !c2;
    out.push({ r1: rows || !cols ? Number(r1) - 1 : 0, r2: rows || !cols ? Number(r2 || r1) - 1 : 1e6, c1: cols || !rows ? colNum(c1) : 0, c2: cols || !rows ? colNum(c2 || c1) : 1e4, cols, rows });
  }
  return out.length ? { sheetIndex, areas: out } : null;
}
field.addEventListener('input', () => {
  const p = field.value.trim() ? parse(field.value) : { sheetIndex: S.sheet, areas: [] };
  if (!p) { field.setAttribute('aria-invalid', 'true'); useBtn.disabled = true; return; }
  field.removeAttribute('aria-invalid');
  S.areas = p.areas;
  if (p.sheetIndex !== S.sheet) { show(p.sheetIndex); S.areas = p.areas; }
  paint(true);
});

function at(e) {
  const td = e.target.closest('td');
  if (!td || !sheetEl.contains(td)) return null;
  if (td.dataset.r != null) {
    const r = Number(td.dataset.r), c = Number(td.dataset.c);
    return { r, c, r2: r + Number(td.rowSpan || 1) - 1, c2: c + Number(td.colSpan || 1) - 1 };
  }
  if (td.dataset.row != null) return { row: Number(td.dataset.row) };
  if (td.dataset.col != null) return { col: Number(td.dataset.col) };
  return { all: true };
}
const lastRow = () => geo.rowList[geo.rowList.length - 1] ?? 0, lastCol = () => geo.colList[geo.colList.length - 1] ?? 0;
sheetEl.addEventListener('mousedown', (e) => {
  const p = at(e);
  if (!p || e.button !== 0) return;
  e.preventDefault();
  if (p.all) { S.areas = [{ r1: 0, c1: 0, r2: lastRow(), c2: lastCol() }]; paint(); return; }
  const add = e.metaKey || e.ctrlKey, cur = S.areas[S.areas.length - 1];
  const area = p.row != null ? { r1: p.row, r2: p.row, c1: 0, c2: lastCol(), rows: true } : p.col != null ? { c1: p.col, c2: p.col, r1: 0, r2: lastRow(), cols: true } : { r1: p.r, c1: p.c, r2: p.r2, c2: p.c2 };
  if (e.shiftKey && cur) { if (p.row != null) cur.r2 = p.row; else if (p.col != null) cur.c2 = p.col; else { cur.r2 = p.r2; cur.c2 = p.c2; } }
  else if (add) S.areas.push(area);
  else S.areas = [area];
  S.drag = S.areas[S.areas.length - 1];
  paint();
});
window.addEventListener('mousemove', (e) => {
  if (!S.drag || !(e.buttons & 1)) { S.drag = null; return; }
  const p = at(e);
  if (!p) return;
  if (S.drag.rows) { if (p.row != null || p.r != null) S.drag.r2 = p.row ?? p.r; }
  else if (S.drag.cols) { if (p.col != null || p.c != null) S.drag.c2 = p.col ?? p.c; }
  else if (p.r != null) { S.drag.r2 = p.r2 >= S.drag.r1 ? p.r2 : p.r; S.drag.c2 = p.c2 >= S.drag.c1 ? p.c2 : p.c; }
  paint();
});
window.addEventListener('mouseup', () => { S.drag = null; });
window.addEventListener('resize', () => { measure(); paint(); });

$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b && Number(b.dataset.i) !== S.sheet) { S.areas = []; show(Number(b.dataset.i)); } });
const done = (v) => api.invoke('picker:done', v);
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'cancel') done(null);
  if (a === 'use' && !useBtn.disabled) done(field.value.trim());
  if (a === 'used') { const p = sheet().used && parse(sheet().used); S.areas = p ? p.areas : []; paint(); }
});
let zoom = 1;
function setZoom(z, at) {
  const nz = Math.min(3, Math.max(0.4, z));
  if (Math.abs(nz - zoom) < 1e-3) return;
  const r = grid.getBoundingClientRect(), ax = at ? at.x - r.left : grid.clientWidth / 2, ay = at ? at.y - r.top : grid.clientHeight / 2;
  const f = nz / zoom, px = grid.scrollLeft + ax, py = grid.scrollTop + ay;
  zoom = nz;
  sheetEl.style.zoom = String(zoom);
  grid.scrollLeft = px * f - ax;
  grid.scrollTop = py * f - ay;
  measure();
  paint(true);
}
grid.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const d = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
  setZoom(zoom * Math.exp(-d * 0.0065), { x: e.clientX, y: e.clientY });
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') done(null);
  if (e.key === 'Enter' && !useBtn.disabled) done(field.value.trim());
  const c = e.ctrlKey || e.metaKey;
  if (c && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(zoom * 1.2); }
  if (c && e.key === '-') { e.preventDefault(); setZoom(zoom / 1.2); }
  if (c && e.key === '0') { e.preventDefault(); setZoom(1); }
});

const start = data.value && parse(data.value);
show(start ? start.sheetIndex : S.sheet);
if (start) { S.areas = start.areas; requestAnimationFrame(() => requestAnimationFrame(() => paint())); }
window.__picker = { S, paint, parse, text, show, setZoom, zoom: () => zoom };
