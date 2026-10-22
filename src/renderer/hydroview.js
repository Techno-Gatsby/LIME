// Hydrology: a Lime window for SWMM models (run and read), HEC-RAS plan results and HEC-DSS time series. The engine
// reads the files and draws the charts; this window picks what to show and lays out the chart, tables and network.
import { $, $$, esc, h, nameOf, dirOf, sep, clean } from './ui.js';
import { setDocName } from './editor-kit.js';
import { key, shortcuts, helpButton } from './shortcuts.js';

const KIND = { sub: 'Subcatchments', node: 'Nodes', link: 'Links' };
const num = (v) => (v == null || v === '' ? '' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : +Number(v).toPrecision(5));
const time = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

export function openEditor(view, { file }, ctx) {
  const { toast, api, go } = ctx;
  ctx.onClose?.(() => go());
  const icon = (n, s = '') => ctx.icon(n, s);
  const call = (m, ...a) => api.invoke('edit:call', 'hydro', m, ...a);
  if (!document.querySelector('link[href="mapview.css"]')) document.head.append(h('<link rel="stylesheet" href="mapview.css">'));
  const st = { ready: false, disposed: false, file, d: null, tab: 'chart', kind: 'link', v: 0, pick: new Set(), svg: '', table: [], profiles: new Set(), xs: 0, dss: new Map() };

  const root = h(`<div class="editor hydroview">
    <header class="ed-head"><div class="topbar">
      <button class="tb icon" data-a="close" title="Close">${icon('back')}</button>
      <div class="doc">${icon('drop')}<b></b></div>
      <div class="grow"></div>
      <button class="tb" data-a="rerun" title="Run the model again (after editing the .inp)" hidden>${icon('redo', 'sm')}<span class="lbl">Run again</span></button>
      <button class="tb" data-a="export" title="Save the chart or table">${icon('image', 'sm')}<span class="lbl">Export</span></button>
      ${helpButton()}
    </div></header>
    <div class="hv-body"><aside class="hv-side"></aside>
      <div class="hv-main"><div class="hv-tabs"></div><div class="hv-view"><p class="muted" style="padding:20px">Opening…</p></div><div class="hv-summary"></div></div></div>
  </div>`);
  view.append(root);
  setDocName(root, file);
  const side = $('.hv-side', root), viewEl = $('.hv-view', root), tabsEl = $('.hv-tabs', root), sum = $('.hv-summary', root);

  // --- SWMM --------------------------------------------------------------------------------------------------------
  const peakOf = (k, i, v) => Math.max(...st.d.values[k][i][v].map(Math.abs));
  function swmmDefaults() {
    const d = st.d;
    st.kind = d.ids.link.length ? 'link' : d.ids.node.length ? 'node' : 'sub';
    st.v = st.kind === 'node' ? 4 : st.kind === 'sub' ? 4 : 0;
    pickTop();
  }
  function pickTop() { const ids = st.d.ids[st.kind]; st.pick = new Set(ids.map((_, i) => i).sort((a, b) => peakOf(st.kind, b, st.v) - peakOf(st.kind, a, st.v)).slice(0, 4)); }
  function swmmSide() {
    const d = st.d, ids = d.ids[st.kind], types = st.kind === 'node' ? d.nodeTypes : st.kind === 'link' ? d.linkTypes : null;
    side.innerHTML = `<div class="grp">Show</div><select data-s="kind">${Object.entries(KIND).filter(([k]) => d.ids[k].length).map(([k, l]) => `<option value="${k}" ${k === st.kind ? 'selected' : ''}>${l} (${d.ids[k].length})</option>`).join('')}</select>
      <select data-s="v">${d.vars[st.kind].slice(0, 6).map((n, i) => `<option value="${i}" ${i === st.v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <div class="grp">${KIND[st.kind]}</div>${ids.map((id, i) => `<label><input type="checkbox" data-i="${i}" ${st.pick.has(i) ? 'checked' : ''}>${esc(id)}${types ? ` <small>${esc(types[i])}</small>` : ''}<small>${num(peakOf(st.kind, i, st.v))}</small></label>`).join('')}`;
  }
  const unitFor = () => { const u = st.d.units, n = st.d.vars[st.kind][st.v] || ''; return /Depth|Head|elevation/i.test(n) ? u.depth : /Velocity/.test(n) ? u.velocity : /Volume/.test(n) ? u.volume : /Rain|Evap|Infil/.test(n) ? u.rain : /Capacity|moisture/.test(n) ? 'fraction' : u.flow; };
  async function swmmChart() {
    const d = st.d, list = [...st.pick].map((i) => ({ name: d.ids[st.kind][i], points: d.times.map((t, p) => [t, d.values[st.kind][i][st.v][p]]) }));
    if (!list.length) { viewEl.innerHTML = '<p class="muted" style="padding:20px">Tick one or more elements on the left.</p>'; st.svg = ''; return; }
    st.svg = await call('chart', { title: `${d.vars[st.kind][st.v]} · ${KIND[st.kind].toLowerCase()}`, subtitle: d.name, xLabel: 'Time', yLabel: `${d.vars[st.kind][st.v]} (${unitFor()})`, series: list });
    viewEl.innerHTML = st.svg;
  }
  function swmmTable() {
    const d = st.d, cols = [...st.pick];
    st.table = [['Time', ...cols.map((i) => d.ids[st.kind][i])], ...d.times.map((t, p) => [time(t), ...cols.map((i) => d.values[st.kind][i][st.v][p])])];
    viewEl.innerHTML = tableHtml(st.table);
  }
  function swmmNetwork() {
    const g = st.d.geom;
    if (!g || !Object.keys(g.nodes).length) { viewEl.innerHTML = '<p class="muted" style="padding:20px">The model has no map coordinates ([COORDINATES]).</p>'; st.svg = ''; return; }
    const pts = [...Object.values(g.nodes), ...Object.values(g.subs).flat()], xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), W = 1000, H = Math.max(300, Math.round(1000 * (y1 - y0) / (x1 - x0 || 1))), pad = 40;
    const k = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (y1 - y0 || 1)), X = (x) => pad + (x - x0) * k, Y = (y) => H - pad - (y - y0) * k;
    const li = new Map(st.d.ids.link.map((id, i) => [id, i])), qmax = Math.max(1e-9, ...st.d.ids.link.map((_, i) => peakOf('link', i, 0)));
    const ni = new Map(st.d.ids.node.map((id, i) => [id, i]));
    st.svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif" font-size="11">
      <rect width="100%" height="100%" fill="#fff"/>
      ${Object.entries(g.subs).map(([id, p]) => `<polygon points="${p.map((q) => `${X(q[0])},${Y(q[1])}`).join(' ')}" fill="#cfe8c9" stroke="#7fb36f"><title>${esc(id)}</title></polygon><text x="${X(p[0][0])}" y="${Y(p[0][1]) - 4}" fill="#3d6b31">${esc(id)}</text>`).join('')}
      ${g.links.map((l) => { const q = li.has(l.id) ? peakOf('link', li.get(l.id), 0) : 0; return `<polyline points="${l.path.map((q2) => `${X(q2[0])},${Y(q2[1])}`).join(' ')}" fill="none" stroke="#2a6fdb" stroke-width="${(1.5 + 7 * q / qmax).toFixed(1)}" stroke-linecap="round"><title>${esc(l.id)}: peak ${num(q)} ${st.d.units.flow}</title></polyline>`; }).join('')}
      ${Object.entries(g.nodes).map(([id, p]) => `<g><circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${st.d.nodeTypes[ni.get(id)] === 'Outfall' ? 7 : 5}" fill="${st.d.nodeTypes[ni.get(id)] === 'Outfall' ? '#e8590c' : '#1d1d1f'}"/><text x="${X(p[0]) + 8}" y="${Y(p[1]) + 4}">${esc(id)}</text></g>`).join('')}
      <text x="${pad}" y="22" font-size="14" font-weight="bold">Network · links drawn by peak flow</text></svg>`;
    viewEl.innerHTML = st.svg;
  }
  function swmmSummary() {
    const r = st.d.report || {};
    sum.innerHTML = `${st.d.times.length} time steps · ${st.d.ids.sub.length} subcatchments, ${st.d.ids.node.length} nodes, ${st.d.ids.link.length} links · flow in ${esc(st.d.units.flow)}${r.runoffError != null ? ` · continuity error ${r.runoffError}% runoff, ${r.routingError}% routing` : ''}${r.warnings?.length ? ` · <span class="bad">${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}</span>` : ''}`;
  }

  // --- HEC-RAS -----------------------------------------------------------------------------------------------------
  function rasSide() {
    const d = st.d;
    side.innerHTML = `<div class="grp">Profiles</div>${d.profiles.map((p, i) => `<label><input type="checkbox" data-p="${i}" ${st.profiles.has(i) ? 'checked' : ''}>${esc(p.name)}</label>`).join('')}
      ${d.series ? `<div class="grp">Hydrograph at</div><select data-s="xs">${d.xs.map((x, i) => `<option value="${i}" ${i === st.xs ? 'selected' : ''}>${esc(`${x.reach} ${x.rs}`)}</option>`).join('')}</select>` : ''}
      <div class="grp">Plan</div><label>${esc(d.plan.title || '—')}</label>${d.plan.version ? `<label><small>${esc(d.plan.version)}</small></label>` : ''}`;
  }
  async function rasChart() {
    const d = st.d, st0 = d.xs.map((x) => parseFloat(x.rs));
    const series = [...st.profiles].map((i) => ({ name: d.profiles[i].name, points: d.xs.map((x, k) => [st0[k], d.profiles[i].ws[k]]) }));
    st.svg = await call('chart', { title: 'Water surface profile', subtitle: `${d.xs[0].river} ${d.xs[0].reach} · ${d.plan.title || d.name}`, xLabel: 'River station', yLabel: 'Elevation', series, time: false, area: d.xs[0].invert != null ? { points: d.xs.map((x, k) => [st0[k], x.invert]), color: '#bfa780' } : null });
    viewEl.innerHTML = st.svg;
  }
  async function rasHydro() {
    const d = st.d, t = d.times.map((s) => Date.parse(s.replace(/^(\d\d)(\w{3})(\d{4})/, '$2 $1 $3') + 'Z'));
    const series = [{ name: `Flow at ${d.xs[st.xs].rs}`, points: d.series.flow ? d.series.flow.map((r, i) => [t[i], r[st.xs]]) : [] }];
    st.svg = await call('chart', { title: `Flow hydrograph · river station ${d.xs[st.xs].rs}`, subtitle: d.plan.title || d.name, xLabel: 'Time', yLabel: 'Flow', series });
    viewEl.innerHTML = st.svg;
  }
  function rasTable() {
    const d = st.d;
    st.table = [['River', 'Reach', 'Station', 'Bed', ...[...st.profiles].flatMap((i) => [`${d.profiles[i].name} WS`, `${d.profiles[i].name} flow`])], ...d.xs.map((x, k) => [x.river, x.reach, x.rs, x.invert, ...[...st.profiles].flatMap((i) => [d.profiles[i].ws[k], d.profiles[i].flow?.[k] ?? ''])])];
    viewEl.innerHTML = tableHtml(st.table);
  }

  // --- HEC-DSS -----------------------------------------------------------------------------------------------------
  function dssSide() {
    side.innerHTML = `<div class="grp">Time series (${st.d.records.filter((r) => r.ts).length})</div>${st.d.records.map((r, i) => `<label title="${esc(r.path)}"><input type="checkbox" data-r="${i}" ${st.pick.has(i) ? 'checked' : ''} ${r.ts ? '' : 'disabled'}>${esc([r.parts.b, r.parts.c].filter(Boolean).join(' · '))}<small>${esc(r.parts.e || '')}</small></label>`).join('')}`;
  }
  async function dssLoad() { for (const i of st.pick) if (!st.dss.has(i)) st.dss.set(i, await call('dssValues', file, st.d.records[i].path)); }
  async function dssChart() {
    await dssLoad();
    const list = [...st.pick].map((i) => st.dss.get(i));
    if (!list.length) { viewEl.innerHTML = '<p class="muted" style="padding:20px">Tick one or more records on the left.</p>'; st.svg = ''; return; }
    st.svg = await call('chart', { title: nameOf(file), subtitle: `${list.length} series`, xLabel: 'Time', yLabel: [...new Set(list.map((s) => s.units))].join(', '), series: list.map((s) => ({ name: s.path.split('/').slice(1, 4).filter(Boolean).join(' / '), points: s.points })) });
    viewEl.innerHTML = st.svg;
  }
  async function dssTable() {
    await dssLoad();
    const list = [...st.pick].map((i) => st.dss.get(i)), times = [...new Set(list.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b);
    const maps = list.map((s) => new Map(s.points));
    st.table = [['Time', ...list.map((s) => `${s.path.split('/')[2]} ${s.path.split('/')[3]} (${s.units})`)], ...times.map((t) => [time(t), ...maps.map((m) => m.get(t) ?? '')])];
    viewEl.innerHTML = tableHtml(st.table);
  }

  // --- Layout ------------------------------------------------------------------------------------------------------
  const TABS = { swmm: [['chart', 'Hydrographs'], ['table', 'Table'], ['network', 'Network'], ['report', 'Report']], ras: [['chart', 'Profile'], ['hydro', 'Hydrograph'], ['table', 'Table']], dss: [['chart', 'Chart'], ['table', 'Table']] };
  const tableHtml = (rows) => `<table><thead><tr>${rows[0].map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1, 3001).map((r) => `<tr>${r.map((c) => `<td>${esc(typeof c === 'number' ? num(c) : c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  async function render() {
    const k = st.d.kind;
    tabsEl.innerHTML = TABS[k].filter(([t]) => t !== 'hydro' || st.d.series).map(([t, l]) => `<button class="tb ${st.tab === t ? 'on' : ''}" data-t="${t}">${l}</button>`).join('');
    try {
      if (k === 'swmm') { swmmSide(); if (st.tab === 'chart') await swmmChart(); else if (st.tab === 'table') swmmTable(); else if (st.tab === 'network') swmmNetwork(); else { st.svg = ''; viewEl.innerHTML = `<pre>${esc(st.d.rpt)}</pre>`; } }
      if (k === 'ras') { rasSide(); if (st.tab === 'chart') await rasChart(); else if (st.tab === 'hydro') await rasHydro(); else rasTable(); }
      if (k === 'dss') { dssSide(); if (st.tab === 'chart') await dssChart(); else await dssTable(); }
    } catch (e) { toast(clean(e), { type: 'error' }); }
  }
  async function load() {
    viewEl.innerHTML = `<p class="muted" style="padding:20px">${/\.inp$/i.test(file) ? 'Running the model…' : 'Reading…'}</p>`;
    st.d = await call('open', file);
    $('[data-a=rerun]', root).hidden = st.d.kind !== 'swmm' || !/\.inp$/i.test(file);
    if (st.d.kind === 'swmm') { swmmDefaults(); swmmSummary(); }
    if (st.d.kind === 'ras') { st.profiles = new Set(st.d.profiles.map((_, i) => i)); sum.textContent = `${st.d.xs.length} cross sections · ${st.d.profiles.length} profiles${st.d.times ? ` · ${st.d.times.length} output times` : ''}`; }
    if (st.d.kind === 'dss') { st.pick = new Set(st.d.records.map((r, i) => [r, i]).filter(([r]) => r.ts).slice(0, 3).map(([, i]) => i)); sum.textContent = `${st.d.records.length} records`; }
    st.ready = true;
    await render();
  }
  async function exportView() {
    const d = dirOf(file), b = nameOf(file).replace(/\.[^.]+$/, '');
    if (st.svg) {
      const target = await api.invoke('dialog:save', { defaultPath: `${d}${sep}${b} ${st.tab}.png`, filters: [{ name: 'PNG picture', extensions: ['png'] }, { name: 'SVG picture', extensions: ['svg'] }] });
      if (!target) return;
      const r = await call('savePicture', target, st.svg);
      toast(`Saved ${nameOf(r.path)}`, { type: 'success', actions: [{ label: 'Show in folder', fn: () => api.invoke('shell:show', r.path) }] });
    } else if (st.table.length) {
      const target = await api.invoke('dialog:save', { defaultPath: `${d}${sep}${b} table.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (!target) return;
      const csv = `﻿${st.table.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\r\n')}\r\n`;
      const r = await call('write', target, new TextEncoder().encode(csv));
      toast(`Saved ${nameOf(r.path)}`, { type: 'success', actions: [{ label: 'Show in folder', fn: () => api.invoke('shell:show', r.path) }] });
    }
  }
  const keys = shortcuts([['Hydrology', [key('Mod+Shift+E', 'Export the chart or table', () => exportView()), key('Mod+R', 'Run the model again', () => load()), key('Mod+W', 'Close', () => go())]]]);
  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a, t = e.target.closest('[data-t]')?.dataset.t;
    if (a === 'close') go();
    else if (a === 'help') keys.help();
    else if (a === 'export' && st.ready) exportView().catch((err) => toast(clean(err), { type: 'error' }));
    else if (a === 'rerun' && st.ready) load().catch((err) => toast(clean(err), { type: 'error' }));
    else if (t && st.ready) { st.tab = t; render(); }
  });
  side.addEventListener('change', (e) => {
    const s = e.target.dataset.s, ds = e.target.dataset;
    if (s === 'kind') { st.kind = e.target.value; st.v = st.kind === 'link' ? 0 : 4; if (st.v >= st.d.vars[st.kind].length) st.v = 0; pickTop(); }
    else if (s === 'v') { st.v = +e.target.value; }
    else if (s === 'xs') { st.xs = +e.target.value; if (st.tab !== 'hydro') st.tab = 'hydro'; }
    else if (ds.i != null) { if (e.target.checked) st.pick.add(+ds.i); else st.pick.delete(+ds.i); }
    else if (ds.p != null) { if (e.target.checked) st.profiles.add(+ds.p); else st.profiles.delete(+ds.p); }
    else if (ds.r != null) { if (e.target.checked) st.pick.add(+ds.r); else st.pick.delete(+ds.r); }
    render();
  });
  load().catch((e) => { toast(clean(e), { type: 'error' }); viewEl.innerHTML = `<p class="muted" style="padding:20px">${esc(clean(e))}</p>`; });
  window.__hydro = { st, render, load, exportView, svg: () => st.svg };
  const dispose = () => { if (st.disposed) return; st.disposed = true; keys.dispose(); };
  window.addEventListener('pagehide', dispose);
  return dispose;
}
