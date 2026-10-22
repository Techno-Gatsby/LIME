'use strict';
// Hydrology: EPA SWMM 5.2 models run and read (rainfall-runoff and pipe and channel routing), HEC-RAS results read from
// their HDF5 plan files, and HEC-DSS time series (HEC-HMS and HEC-RAS results) read with HEC's own library. SWMM and
// the DSS reader are WebAssembly builds (scripts/hydrovendor.mjs) run through Node's WASI; HDF5 is read with h5wasm.
const U = require('./util');
const { fs, fsp, path } = U;
const S = require('./geosniff');

// --- WebAssembly programs ------------------------------------------------------------------------------------------
const vendorDir = () => [process.env.LIME_HYDRO, U.cfg.hydro, process.resourcesPath && path.join(process.resourcesPath, 'hydro'), path.join(__dirname, '../../../vendor/hydro')].find((d) => d && fs.existsSync(path.join(d, 'manifest.json')));
const have = (id) => { const d = vendorDir(); return !!d && fs.existsSync(path.join(d, `${id}.wasm`)); };
const compiled = new Map();
const tidy = (d) => fsp.rm(d, { recursive: true, force: true }).catch(() => {});
// Each run gets a thread of its own: Node's WASI blocks the event loop it runs on, and files being written or removed
// elsewhere on that loop at the same time crash the process. Runs take turns, and the thread goes when the run ends.
const RUNNER = `const { parentPort, workerData: d } = require('worker_threads'); const fs = require('fs'); const { WASI } = require('wasi');
(async () => {
  const o = fs.openSync(d.so, 'w'), e = fs.openSync(d.se, 'w');
  try {
    const w = new WASI({ version: 'preview1', args: d.args, env: d.env, preopens: d.dirs, stdout: o, stderr: e, returnOnExit: true });
    const code = w.start(await WebAssembly.instantiate(d.module, w.getImportObject()));
    parentPort.postMessage({ code });
  } catch (err) { parentPort.postMessage({ error: String(err && err.message || err) }); } finally { fs.closeSync(o); fs.closeSync(e); }
})();`;
let queue = Promise.resolve();
const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
// Runs a WASI program with folders mapped in; stdout and stderr are collected into files and returned as text.
const wasi = (id, args, o) => serial(() => wasiRun(id, args, o));
async function wasiRun(id, args, { dirs = {}, env = {}, timeout = 1800000 } = {}) {
  const dir = vendorDir();
  if (!dir || !fs.existsSync(path.join(dir, `${id}.wasm`))) throw Object.assign(new Error(`${id === 'swmm5' ? 'The SWMM engine' : 'The HEC-DSS reader'} isn’t in this build of Lime.`), { code: 'ENGINE_MISSING' });
  if (!compiled.has(id)) compiled.set(id, WebAssembly.compile(await fsp.readFile(path.join(dir, `${id}.wasm`))));
  const tmp = await U.tmpDir(`wasi-${id}`), so = path.join(tmp, 'stdout.txt'), se = path.join(tmp, 'stderr.txt');
  try {
    const { Worker } = require('worker_threads');
    const w = new Worker(RUNNER, { eval: true, workerData: { module: await compiled.get(id), args: [id, ...args], env: { LIME_TMP: '/tmp', ...env }, dirs: { '/tmp': tmp, ...dirs }, so, se } });
    const res = await new Promise((ok, no) => {
      const t = setTimeout(() => { w.terminate(); no(new Error(`${id === 'swmm5' ? 'SWMM' : 'The DSS reader'} stopped responding.`)); }, timeout);
      w.once('message', (m) => { clearTimeout(t); ok(m); });
      w.once('error', (e) => { clearTimeout(t); no(e); });
      w.once('exit', (c) => { clearTimeout(t); no(new Error(`The engine stopped (code ${c}).`)); });
    });
    await w.terminate();
    if (res.error) throw new Error(res.error);
    return { code: res.code, stdout: await fsp.readFile(so, 'utf8'), stderr: await fsp.readFile(se, 'utf8') };
  } finally { await tidy(tmp); }
}

// --- SWMM ----------------------------------------------------------------------------------------------------------
const FLOW_UNITS = ['CFS', 'GPM', 'MGD', 'CMS', 'LPS', 'MLD'];
const SUB_VARS = ['Rainfall', 'Snow depth', 'Evaporation loss', 'Infiltration loss', 'Runoff', 'Groundwater flow', 'Groundwater elevation', 'Soil moisture'];
const NODE_VARS = ['Depth', 'Head', 'Volume', 'Lateral inflow', 'Total inflow', 'Flooding'];
const LINK_VARS = ['Flow', 'Depth', 'Velocity', 'Volume', 'Capacity'];
const SYS_VARS = ['Air temperature', 'Rainfall', 'Snow depth', 'Infiltration', 'Runoff', 'Dry weather inflow', 'Groundwater inflow', 'RDII inflow', 'Direct inflow', 'Total lateral inflow', 'Flooding', 'Outfall flow', 'Storage volume', 'Evaporation', 'Potential evaporation'];
const NODE_TYPES = ['Junction', 'Outfall', 'Storage', 'Divider'];
const LINK_TYPES = ['Conduit', 'Pump', 'Orifice', 'Weir', 'Outlet'];
// Reads a SWMM binary results file (.out): element names, properties and every reported time step.
function readOut(buf) {
  const i32 = (o) => buf.readInt32LE(o), f32 = (o) => buf.readFloatLE(o);
  const MAGIC = 516114522;
  if (buf.length < 64 || i32(0) !== MAGIC || i32(buf.length - 4) !== MAGIC) throw new Error('This isn’t a SWMM results file (or the run stopped before it was finished).');
  const end = buf.length - 24, idPos = i32(end), propPos = i32(end + 4), resPos = i32(end + 8), periods = i32(end + 12), err = i32(end + 16);
  const version = i32(4), flowUnits = i32(8), n = { sub: i32(12), node: i32(16), link: i32(20), poll: i32(24) };
  let at = idPos;
  const names = (k) => Array.from({ length: k }, () => { const len = i32(at); const s = buf.toString('latin1', at + 4, at + 4 + len); at += 4 + len; return s; });
  const ids = { sub: names(n.sub), node: names(n.node), link: names(n.link), poll: names(n.poll) };
  at = propPos;
  // The first property of nodes and links is their type, written as an integer; the rest are floats.
  const props = (k, typed) => { const np = i32(at); at += 4 + 4 * np; return Array.from({ length: k }, () => Array.from({ length: np }, (_, j) => { const v = typed && j === 0 ? i32(at) : f32(at); at += 4; return v; })); };
  const prop = { sub: props(n.sub, false), node: props(n.node, true), link: props(n.link, true) };
  const vars = () => { const k = i32(at); at += 4 + 4 * k; return k; };
  const nv = { sub: vars(), node: vars(), link: vars(), sys: vars() };
  const start = buf.readDoubleLE(at), step = i32(at + 8);
  const per = 8 + 4 * (n.sub * nv.sub + n.node * nv.node + n.link * nv.link + nv.sys);
  // value(kind, index, variable, period)
  const value = (kind, i, v, p) => {
    const base = resPos + p * per + 8;
    if (kind === 'sub') return f32(base + 4 * (i * nv.sub + v));
    if (kind === 'node') return f32(base + 4 * (n.sub * nv.sub + i * nv.node + v));
    if (kind === 'link') return f32(base + 4 * (n.sub * nv.sub + n.node * nv.node + i * nv.link + v));
    return f32(base + 4 * (n.sub * nv.sub + n.node * nv.node + n.link * nv.link + v));
  };
  const time = (p) => new Date(Math.round((buf.readDoubleLE(resPos + p * per) - 25569) * 86400000));
  return { version, flowUnits: FLOW_UNITS[flowUnits] || String(flowUnits), metric: flowUnits >= 3, n, ids, prop, nv, start, step, periods, error: err, value, time };
}
const series = (o, kind, i, v) => Array.from({ length: o.periods }, (_, p) => o.value(kind, i, v, p));
// What the report says about the run: errors, warnings, and the continuity errors.
function readRpt(text) {
  const errors = [...text.matchAll(/^\s*(ERROR \d+:.*(?:\n(?!\s*\n)(?!\s*ERROR).*)*)/gm)].map((m) => m[1].replace(/\s+/g, ' ').trim());
  const warnings = [...text.matchAll(/^\s*(WARNING \d+:.*)/gm)].map((m) => m[1].trim());
  const cont = (label) => { const m = new RegExp(`${label}[\\s\\S]*?Continuity Error \\(%\\)\\s*\\.*\\s*(-?[\\d.]+)`).exec(text); return m ? +m[1] : null; };
  return { errors, warnings, runoffError: cont('Runoff Quantity Continuity'), routingError: cont('Flow Routing Continuity') };
}

// Runs a .inp model; the report and results land in `dir`. Returns { rpt, out, report, results }.
async function runSwmm(inp, dir, ctx = {}) {
  ctx.progress?.(0.1, 'Running SWMM');
  const name = U.sanitize(U.base(inp)).replace(/\s+/g, '_') || 'model';
  const r = await wasi('swmm5', [`/m/${path.basename(inp)}`, `/o/${name}.rpt`, `/o/${name}.out`], { dirs: { '/m': path.dirname(path.resolve(inp)), '/o': dir }, env: { LIME_CWD: '/m' } });
  const rpt = path.join(dir, `${name}.rpt`), out = path.join(dir, `${name}.out`);
  const report = fs.existsSync(rpt) ? readRpt(await fsp.readFile(rpt, 'latin1')) : { errors: [], warnings: [] };
  if (report.errors.length || !fs.existsSync(out) || fs.statSync(out).size < 64) {
    const why = report.errors.slice(0, 3).join(' · ') || r.stdout.trim().split('\n').pop() || `SWMM stopped (code ${r.code})`;
    throw new Error(`SWMM couldn’t run ${path.basename(inp)}: ${why}`);
  }
  return { rpt, out, report, results: readOut(await fsp.readFile(out)) };
}
// The results of a model: an .out beside the .inp (or the .out itself), else a fresh run in a temporary folder.
async function results(file, ctx) {
  if (U.ext(file) === 'out' || S.swmmOut(file)) return { results: readOut(await fsp.readFile(file)), report: null, dir: null };
  const dir = await U.tmpDir('swmm');
  const r = await runSwmm(file, dir, ctx);
  return { ...r, dir };
}
const unitsOf = (o) => ({ flow: o.flowUnits, depth: o.metric ? 'm' : 'ft', rain: o.metric ? 'mm/h' : 'in/h', velocity: o.metric ? 'm/s' : 'ft/s', volume: o.metric ? 'm³' : 'ft³' });
const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const peak = (vals) => vals.reduce((b, v, i) => (v > b.v ? { v, i } : b), { v: -Infinity, i: 0 });
// The tables a results workbook holds: a summary of peaks, then one sheet per quantity, a column per element.
function swmmTables(o) {
  const u = unitsOf(o), times = Array.from({ length: o.periods }, (_, p) => iso(o.time(p)));
  const table = (kind, v) => [['Time', ...o.ids[kind]], ...times.map((t, p) => [t, ...o.ids[kind].map((_, i) => +o.value(kind, i, v, p).toFixed(5))])];
  const summary = [['Element', 'Type', 'Quantity', 'Peak', 'Units', 'Time of peak']];
  o.ids.sub.forEach((id, i) => { const s = peak(series(o, 'sub', i, 4)); summary.push([id, 'Subcatchment', 'Runoff', +s.v.toFixed(5), u.flow, times[s.i]]); });
  o.ids.node.forEach((id, i) => { const d = peak(series(o, 'node', i, 0)), q = peak(series(o, 'node', i, 4)), f = peak(series(o, 'node', i, 5)); const type = NODE_TYPES[o.prop.node[i]?.[0]] || 'Node';
    summary.push([id, type, 'Depth', +d.v.toFixed(4), u.depth, times[d.i]], [id, type, 'Total inflow', +q.v.toFixed(5), u.flow, times[q.i]]); if (f.v > 0) summary.push([id, type, 'Flooding', +f.v.toFixed(5), u.flow, times[f.i]]); });
  o.ids.link.forEach((id, i) => { const q = peak(series(o, 'link', i, 0).map(Math.abs)), v = peak(series(o, 'link', i, 2).map(Math.abs)), c = peak(series(o, 'link', i, 4)); const type = LINK_TYPES[o.prop.link[i]?.[0]] || 'Link';
    summary.push([id, type, 'Flow', +q.v.toFixed(5), u.flow, times[q.i]], [id, type, 'Velocity', +v.v.toFixed(4), u.velocity, times[v.i]], [id, type, 'Capacity used', +c.v.toFixed(4), 'fraction full', times[c.i]]); });
  return [
    ['Summary', summary],
    ...(o.n.sub ? [[`Rainfall (${u.rain})`, table('sub', 0)], [`Runoff (${u.flow})`, table('sub', 4)]] : []),
    ...(o.n.node ? [[`Node depth (${u.depth})`, table('node', 0)], [`Node inflow (${u.flow})`, table('node', 4)], [`Flooding (${u.flow})`, table('node', 5)]] : []),
    ...(o.n.link ? [[`Link flow (${u.flow})`, table('link', 0)], [`Velocity (${u.velocity})`, table('link', 2)], ['Capacity used', table('link', 4)]] : []),
  ];
}
const CSV_VAR = { 'link-flow': ['link', 0], 'link-velocity': ['link', 2], 'link-capacity': ['link', 4], 'node-depth': ['node', 0], 'node-inflow': ['node', 4], 'node-flooding': ['node', 5], 'sub-runoff': ['sub', 4], 'sub-rainfall': ['sub', 0] };
const csvCell = (v) => (typeof v === 'number' ? String(v) : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (rows) => `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
function writeXlsx(out, sheets) {
  const XLSX = require('xlsx'), wb = XLSX.utils.book_new();
  for (const [name, rows] of sheets) { const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = rows[0].map((h, i) => ({ wch: Math.min(28, Math.max(10, ...rows.slice(0, 50).map((r) => String(r[i] ?? '').length + 2))) })); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31).replace(/[\\/?*[\]:]/g, '-')); }
  XLSX.writeFile(wb, out, { compression: true });
  return out;
}
async function swmmRun(file, opts, ctx) {
  const tmp = await U.tmpDir('swmm');
  try {
    const r = await runSwmm(file, tmp, ctx);
    const out = ctx.out.file(file, `${U.base(file)}.rpt`);
    await fsp.copyFile(r.rpt, out);
    const o = r.results, u = unitsOf(o), outfalls = o.ids.node.map((id, i) => [id, i]).filter(([, i]) => o.prop.node[i]?.[0] === 1);
    const q = outfalls.map(([id, i]) => `${id} ${peak(series(o, 'node', i, 4)).v.toFixed(3)} ${u.flow}`);
    return { path: out, note: `Ran ${o.periods} steps · continuity ${r.report.runoffError ?? '–'}% runoff, ${r.report.routingError ?? '–'}% routing${q.length ? ` · peak outflow ${q.join(', ')}` : ''}${r.report.warnings.length ? ` · ${r.report.warnings.length} warning${r.report.warnings.length === 1 ? '' : 's'}` : ''}` };
  } finally { await tidy(tmp); }
}
async function swmmExport(file, opts, ctx) {
  const r = await results(file, ctx);
  try {
    ctx.progress?.(0.7, 'Writing');
    const o = r.results;
    if (opts.to === 'csv') {
      const [kind, v] = CSV_VAR[opts.what] || CSV_VAR['link-flow'];
      if (!o.n[kind]) throw new Error(`The model has no ${kind === 'sub' ? 'subcatchments' : `${kind}s`}.`);
      const out = ctx.out.file(file, `${U.base(file)}-${opts.what || 'link-flow'}.csv`);
      await fsp.writeFile(out, `﻿${toCsv([['Time', ...o.ids[kind]], ...Array.from({ length: o.periods }, (_, p) => [iso(o.time(p)), ...o.ids[kind].map((_, i) => +o.value(kind, i, v, p).toFixed(5))])])}`);
      return { path: out, note: `${o.ids[kind].length} ${kind === 'sub' ? 'subcatchments' : `${kind}s`} × ${o.periods} steps` };
    }
    const out = ctx.out.file(file, `${U.base(file)}-results.xlsx`);
    writeXlsx(out, swmmTables(o));
    return { path: out, note: `${o.n.sub} subcatchments, ${o.n.node} nodes, ${o.n.link} links × ${o.periods} steps` };
  } finally { if (r.dir) await tidy(r.dir); }
}

// --- Charts ----------------------------------------------------------------------------------------------------------
const PALETTE = ['#2a6fdb', '#e8590c', '#2b8a3e', '#ae3ec9', '#c92a2a', '#0b7285', '#5c940d', '#862e9c'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nice = (lo, hi, n = 5) => { const span = hi - lo || Math.abs(hi) || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= step0); const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step; const t = []; for (let v = a; v <= b + step / 2; v += step) t.push(+v.toFixed(10)); return t; };
const fmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-GB') : +v.toPrecision(4) + '');
// A line chart as SVG. x values are numbers (Date times or distances); series: [{ name, points: [[x, y]] }].
function lineChart({ title, subtitle, xLabel, yLabel, series: list, time = true, width = 1100, height = 560, area = null, bars = null }) {
  const L = 76, R = 24, T = subtitle ? 64 : 48, B = 92, w = width - L - R, h = height - T - B;
  const xs = list.flatMap((s) => s.points.map((p) => +p[0])), ys = list.flatMap((s) => s.points.map((p) => p[1]).filter(Number.isFinite)).concat(area ? area.points.map((p) => p[1]) : []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), yt = nice(Math.min(0, ...ys), Math.max(...ys)), y0 = yt[0], y1 = yt[yt.length - 1];
  const X = (v) => L + ((+v - x0) / (x1 - x0 || 1)) * w, Y = (v) => T + h - ((v - y0) / (y1 - y0 || 1)) * h;
  const xt = time ? (() => { const span = x1 - x0, steps = [9e5, 18e5, 36e5, 72e5, 108e5, 216e5, 432e5, 864e5, 1728e5, 6048e5].find((s) => span / s <= 10) || 2592e6; const t = []; for (let v = Math.ceil(x0 / steps) * steps; v <= x1; v += steps) t.push(v); return t; })() : nice(x0, x1, 8).filter((v) => v >= x0 && v <= x1);
  const xl = (v) => { if (!time) return fmt(v); const d = new Date(v); return x1 - x0 > 2 * 864e5 ? `${d.getUTCDate()} ${'JanFebMarAprMayJunJulAugSepOctNovDec'.substr(d.getUTCMonth() * 3, 3)} ${String(d.getUTCHours()).padStart(2, '0')}:00` : `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const path_ = (pts) => pts.filter((p) => Number.isFinite(p[1])).map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const legend = list.map((s, i) => `<g transform="translate(${L + (i % 4) * Math.min(260, w / 4)},${height - 40 + Math.floor(i / 4) * 18})"><rect width="14" height="3" y="-4" fill="${s.color || PALETTE[i % PALETTE.length]}"/><text x="20" font-size="12" fill="#333">${esc(s.name).slice(0, 34)}</text></g>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="${L}" y="26" font-size="17" font-weight="bold" fill="#1d1d1f">${esc(title)}</text>${subtitle ? `<text x="${L}" y="46" font-size="12" fill="#555">${esc(subtitle)}</text>` : ''}
${yt.map((v) => `<line x1="${L}" x2="${L + w}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#e6e6e6"/><text x="${L - 8}" y="${(Y(v) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="#555">${fmt(v)}</text>`).join('')}
${xt.map((v) => `<line x1="${X(v).toFixed(1)}" x2="${X(v).toFixed(1)}" y1="${T + h}" y2="${T + h + 5}" stroke="#999"/><text x="${X(v).toFixed(1)}" y="${T + h + 19}" font-size="11" text-anchor="middle" fill="#555">${esc(xl(v))}</text>`).join('')}
<line x1="${L}" x2="${L + w}" y1="${T + h}" y2="${T + h}" stroke="#999"/>
${area ? `<path d="${path_(area.points)}L${X(area.points[area.points.length - 1][0]).toFixed(1)},${Y(y0)}L${X(area.points[0][0]).toFixed(1)},${Y(y0)}Z" fill="${area.color || '#c9b28a'}" opacity="0.8"/>` : ''}
${bars ? bars.map((b) => `<rect x="${X(b[0]).toFixed(1)}" y="${T}" width="${Math.max(1, X(b[1]) - X(b[0])).toFixed(1)}" height="${(b[2] / (bars.max || 1) * h * 0.3).toFixed(1)}" fill="#74a9e8" opacity="0.6"/>`).join('') : ''}
${list.map((s, i) => `<path d="${path_(s.points)}" fill="none" stroke="${s.color || PALETTE[i % PALETTE.length]}" stroke-width="2" stroke-linejoin="round"><title>${esc(s.name)}</title></path>`).join('\n')}
<text transform="translate(18,${T + h / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="#333">${esc(yLabel)}</text>
<text x="${L + w / 2}" y="${T + h + 40}" font-size="12" text-anchor="middle" fill="#333">${esc(xLabel)}</text>
${legend}
</svg>
`;
}
async function saveChart(svg, file, stem, to, ctx) {
  const out = ctx.out.file(file, `${stem}.${to === 'svg' ? 'svg' : 'png'}`);
  if (to === 'svg') await fsp.writeFile(out, svg); else await require('sharp')(Buffer.from(svg), { density: 144 }).png().toFile(out);
  return out;
}
const PLOT = { outfalls: ['node', 4, 'Outfall flow'], links: ['link', 0, 'Link flow'], nodes: ['node', 0, 'Node depth'], subcatchments: ['sub', 4, 'Subcatchment runoff'] };
async function swmmPlot(file, opts, ctx) {
  const r = await results(file, ctx);
  try {
    const o = r.results, u = unitsOf(o), what = PLOT[opts.what] ? opts.what : 'outfalls', [kind, v, label] = PLOT[what];
    let idx = o.ids[kind].map((_, i) => i);
    if (what === 'outfalls') idx = idx.filter((i) => o.prop.node[i]?.[0] === 1);
    if (!idx.length) throw new Error(`The model has no ${what}.`);
    const peaks = idx.map((i) => [i, peak(series(o, kind, i, v).map(Math.abs)).v]).sort((a, b) => b[1] - a[1]).slice(0, Number(opts.count) || 6);
    const times = Array.from({ length: o.periods }, (_, p) => o.time(p).getTime());
    const list = peaks.map(([i]) => ({ name: o.ids[kind][i], points: times.map((t, p) => [t, o.value(kind, i, v, p)]) }));
    const rain = o.n.sub && opts.rain !== false && kind !== 'node' ? times.map((t, p) => o.value('sub', 0, 0, p)) : null;
    const bars = rain && Math.max(...rain) > 0 ? Object.assign(times.map((t, p) => [t, times[p + 1] || t + o.step * 1000, rain[p]]), { max: Math.max(...rain) }) : null;
    const svg = lineChart({ title: `${label} · ${path.basename(file)}`, subtitle: `${list.length === peaks.length ? `${list.length} largest by peak` : ''}${bars ? ` · rainfall (${u.rain}) hangs from the top` : ''}`, xLabel: 'Time', yLabel: `${label} (${kind === 'node' && v === 0 ? u.depth : u.flow})`, series: list, bars });
    const out = await saveChart(svg, file, `${U.base(file)}-${what}`, opts.to, ctx);
    return { path: out, note: `${list.map((s, i) => `${s.name} ${peaks[i][1].toFixed(3)}`).join(', ')} ${kind === 'node' && v === 0 ? u.depth : u.flow}` };
  } finally { if (r.dir) await tidy(r.dir); }
}

// --- HEC-RAS (HDF5) --------------------------------------------------------------------------------------------------
let h5P = null;
const pkgDir = (name) => { for (const d of require.resolve.paths(name) || []) if (fs.existsSync(path.join(d, name, 'package.json'))) return path.join(d, name); throw new Error(`${name} is missing. Reinstall Lime.`); };
const h5 = () => (h5P ||= (async () => { const m = await import(require('url').pathToFileURL(path.join(pkgDir('h5wasm'), 'dist', 'node', 'hdf5_hl.js')).href); await m.ready; return m; })());
const str = (v) => (v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : String(v ?? '')).replace(/\0+$/, '').trim();
async function openH5(file) {
  const m = await h5();
  const f = new m.File(path.resolve(file), 'r');
  const get = (p) => { try { const x = f.get(p); return x && x.type === 'Dataset' ? x : null; } catch (_) { return null; } };
  const attr = (p, k) => { try { const a = (p === '/' ? f : f.get(p))?.attrs?.[k]; return a ? str(a.value) : ''; } catch (_) { return ''; } };
  return { f, get, attr, close: () => { try { f.close(); } catch (_) {} } };
}
const rows2 = (ds) => { const v = Array.from(ds.value), s = ds.shape; if (s.length < 2) return [v]; return Array.from({ length: s[0] }, (_, i) => v.slice(i * s[1], (i + 1) * s[1])); };
// The cross sections and their results in a HEC-RAS plan file: steady profiles, or the maximum of an unsteady run.
async function rasRead(file) {
  if (!S.hdf5(file)) throw new Error(`${path.basename(file)} isn’t an HDF5 file. HEC-RAS writes its results to the plan’s .p01.hdf (or .p02.hdf …) file.`);
  const H = await openH5(file);
  try {
    const att = H.get('Geometry/Cross Sections/Attributes');
    let xs = [];
    if (att) {
      const names = Array.isArray(att.dtype) ? att.dtype.map((d) => d[0]) : att.dtype?.compound_type?.members?.map((m) => m.name) || [];
      const ri = names.indexOf('River'), ci = names.indexOf('Reach'), si = names.indexOf('RS');
      xs = Array.from(att.value).map((row) => ({ river: str(row[ri]), reach: str(row[ci]), rs: str(row[si]) }));
    } else {
      const rs = H.get('Geometry/Cross Sections/River Stations');
      if (rs) xs = Array.from(rs.value).map((v) => ({ river: '', reach: '', rs: str(v) }));
    }
    if (!xs.length) throw new Error(`${path.basename(file)} has no 1D cross sections. Is it a HEC-RAS plan results file (.p01.hdf)?`);
    const info = H.get('Geometry/Cross Sections/Station Elevation Info'), vals = H.get('Geometry/Cross Sections/Station Elevation Values');
    if (info && vals) {
      const ii = rows2(info), vv = Array.from(vals.value);
      xs.forEach((x, i) => { const [s, n] = ii[i] || [0, 0]; let lo = Infinity; for (let k = s; k < s + n; k++) lo = Math.min(lo, vv[k * 2 + 1]); x.invert = Number.isFinite(lo) ? lo : null; });
    }
    const plan = { title: H.attr('Plan Data/Plan Information', 'Plan Title'), id: H.attr('Plan Data/Plan Information', 'Plan ShortID'), version: H.attr('/', 'File Version') };
    const profiles = [];
    const ST = 'Results/Steady/Output/Output Blocks/Base Output/Steady Profiles';
    const sws = H.get(`${ST}/Cross Sections/Water Surface`);
    if (sws) {
      const names = H.get(`${ST}/Profile Names`), pn = names ? Array.from(names.value).map(str) : [];
      const ws = rows2(sws), q = H.get(`${ST}/Cross Sections/Flow`), v = H.get(`${ST}/Cross Sections/Velocity Total`);
      const qq = q && rows2(q), vv = v && rows2(v);
      ws.forEach((row, p) => profiles.push({ name: pn[p] || `Profile ${p + 1}`, ws: row, flow: qq?.[p] || null, vel: vv?.[p] || null }));
    }
    const UT = 'Results/Unsteady/Output/Output Blocks/Base Output/Unsteady Time Series';
    const uws = H.get(`${UT}/Cross Sections/Water Surface`);
    let times = null;
    if (uws) {
      const ws = rows2(uws), q = H.get(`${UT}/Cross Sections/Flow`), v = H.get(`${UT}/Cross Sections/Velocity Total`), qq = q && rows2(q), vv = v && rows2(v);
      const st = H.get(`${UT}/Time Date Stamp`);
      times = st ? Array.from(st.value).map(str) : ws.map((_, i) => String(i));
      const max = (rows) => rows[0].map((_, i) => rows.reduce((b, r, t) => (r[i] > b[0] ? [r[i], t] : b), [-Infinity, 0]));
      const mw = max(ws);
      profiles.push({ name: 'Maximum (unsteady)', ws: mw.map((m) => m[0]), when: mw.map((m) => times[m[1]]), flow: qq ? max(qq).map((m) => m[0]) : null, vel: vv ? max(vv).map((m) => m[0]) : null, unsteady: true, series: { ws, flow: qq, vel: vv } });
    }
    if (!profiles.length) throw new Error(`${path.basename(file)} holds no results yet. Run the plan in HEC-RAS first (this looks like a geometry-only file).`);
    return { xs, profiles, plan, times };
  } finally { H.close(); }
}
const RAS_HEAD = ['River', 'Reach', 'River station', 'Profile', 'Min channel elevation', 'Water surface', 'Depth', 'Flow', 'Velocity'];
function rasRows(r, which) {
  const rows = [];
  for (const p of r.profiles.filter((p) => which === 'all' || (which === 'max' ? p.unsteady || r.profiles.length === 1 || p === r.profiles[r.profiles.length - 1] : true))) {
    r.xs.forEach((x, i) => rows.push([x.river, x.reach, x.rs, p.name, x.invert != null ? +x.invert.toFixed(3) : '', +p.ws[i].toFixed(3), x.invert != null ? +(p.ws[i] - x.invert).toFixed(3) : '', p.flow ? +p.flow[i].toFixed(3) : '', p.vel ? +p.vel[i].toFixed(3) : '', ...(p.when ? [p.when[i]] : [])]));
  }
  return rows;
}
async function rasTable(file, opts, ctx) {
  ctx.progress?.(0.2, 'Reading');
  const r = await rasRead(file), rows = rasRows(r, 'all'), head = [...RAS_HEAD, ...(r.profiles.some((p) => p.when) ? ['Time of maximum'] : [])];
  const stem = U.base(file).replace(/\.p\d\d$/i, (m) => m);
  if (opts.to === 'csv') { const out = ctx.out.file(file, `${stem}-profiles.csv`); await fsp.writeFile(out, `﻿${toCsv([head, ...rows])}`); return { path: out, note: `${r.xs.length} cross sections × ${r.profiles.length} profile${r.profiles.length === 1 ? '' : 's'}` }; }
  const out = ctx.out.file(file, `${stem}-profiles.xlsx`), sheets = [['Water surface', [head, ...rows]]];
  const u = r.profiles.find((p) => p.series);
  if (u) sheets.push(['Stage hydrographs', [['Time', ...r.xs.map((x) => `${x.reach} ${x.rs}`)], ...u.series.ws.map((row, t) => [r.times[t], ...row.map((v) => +v.toFixed(3))])]]);
  if (u?.series.flow) sheets.push(['Flow hydrographs', [['Time', ...r.xs.map((x) => `${x.reach} ${x.rs}`)], ...u.series.flow.map((row, t) => [r.times[t], ...row.map((v) => +v.toFixed(3))])]]);
  sheets.push(['Plan', [['Plan', r.plan.title || ''], ['Short ID', r.plan.id || ''], ['Written by', r.plan.version || ''], ['Profiles', r.profiles.map((p) => p.name).join(', ')]]]);
  writeXlsx(out, sheets);
  return { path: out, note: `${r.xs.length} cross sections × ${r.profiles.length} profile${r.profiles.length === 1 ? '' : 's'}${r.plan.title ? ` · ${r.plan.title}` : ''}` };
}
// Distance along the reach from the river stations (HEC-RAS numbers them upstream to downstream, falling).
async function rasPlot(file, opts, ctx) {
  const r = await rasRead(file), reach = r.xs[0].reach, idx = r.xs.map((x, i) => i).filter((i) => r.xs[i].reach === reach), st = idx.map((i) => parseFloat(r.xs[i].rs.replace(/\*$/, '')));
  const list = r.profiles.map((p) => ({ name: p.name, points: idx.map((i, k) => [st[k], p.ws[i]]) }));
  const bed = r.xs[0].invert != null ? { points: idx.map((i, k) => [st[k], r.xs[i].invert]), color: '#bfa780' } : null;
  const svg = lineChart({ title: `Water surface profile · ${r.xs[0].river ? `${r.xs[0].river} ${reach}` : path.basename(file)}`, subtitle: [r.plan.title, r.plan.id && `plan ${r.plan.id}`, bed && 'channel bed shaded'].filter(Boolean).join(' · '), xLabel: 'River station (upstream to the right)', yLabel: 'Elevation', series: list, time: false, area: bed });
  const out = await saveChart(svg, file, `${U.base(file)}-profile`, opts.to, ctx);
  return { path: out, note: `${idx.length} cross sections, ${list.length} profile${list.length === 1 ? '' : 's'}` };
}
async function rasInfo(file, opts, ctx) {
  const r = await rasRead(file);
  const text = [path.basename(file), r.plan.title && `Plan: ${r.plan.title}${r.plan.id ? ` (${r.plan.id})` : ''}`, r.plan.version && `Written by ${r.plan.version}`,
    `${r.xs.length} cross sections on ${[...new Set(r.xs.map((x) => `${x.river} ${x.reach}`.trim()))].join(', ')}`, `Profiles: ${r.profiles.map((p) => p.name).join(', ')}`,
    r.times && `Unsteady output: ${r.times.length} steps, ${r.times[0]} to ${r.times[r.times.length - 1]}`,
    ...r.profiles.map((p) => `${p.name}: highest water surface ${Math.max(...p.ws).toFixed(2)}${p.flow ? `, largest flow ${Math.max(...p.flow).toFixed(2)}` : ''}`)].filter(Boolean).join('\n');
  return { path: null, note: `${r.xs.length} cross sections · ${r.profiles.length} profile${r.profiles.length === 1 ? '' : 's'}`, text };
}

// --- HEC-DSS ---------------------------------------------------------------------------------------------------------
async function dssCall(file, args) {
  const b = Buffer.alloc(64), fd = fs.openSync(file, 'r');
  fs.readSync(fd, b, 0, 64, 0); fs.closeSync(fd);
  const head = b.toString('latin1');
  if (!head.startsWith('ZDSS')) throw new Error(`${path.basename(file)} isn’t a HEC-DSS file.`);
  if (/6-[A-Z]{2}/.test(head) && !/7-[A-Z]{2}/.test(head)) throw new Error(`${path.basename(file)} is a HEC-DSS version 6 file. Lime reads version 7, which HEC-HMS 4 and HEC-RAS 5 and later write; HEC-DSSVue converts older files to version 7.`);
  const r = await wasi('dsstool', [args[0], `/d/${path.basename(file)}`, ...args.slice(1)], { dirs: { '/d': path.dirname(path.resolve(file)) } });
  if (r.code !== 0) throw new Error(`The DSS file couldn’t be read: ${r.stderr.trim().split('\n').pop() || `code ${r.code}`}`);
  return r.stdout;
}
const DSS_TS = new Set([100, 105, 110, 115]);
// Every record, condensed so a time series spread over yearly or monthly blocks is one entry (the D part emptied).
async function dssCatalog(file) {
  const lines = (await dssCall(file, ['catalog'])).split('\n').filter(Boolean).map((l) => { const [t, p] = l.split('\t'); return { type: +t, path: p }; });
  const seen = new Map();
  for (const r of lines) {
    const parts = r.path.split('/');
    const key = DSS_TS.has(r.type) && parts.length >= 7 ? [...parts.slice(0, 4), '', ...parts.slice(5)].join('/') : r.path;
    if (!seen.has(key)) seen.set(key, { path: key, type: r.type, ts: DSS_TS.has(r.type), parts: { a: parts[1], b: parts[2], c: parts[3], e: parts[5], f: parts[6] } });
  }
  return [...seen.values()];
}
async function dssSeries(file, pathname) {
  const text = await dssCall(file, ['ts', pathname]), meta = {}, points = [];
  for (const l of text.split('\n')) {
    if (!l) continue;
    if (l.startsWith('# ')) { const [k, v] = l.slice(2).split('\t'); meta[k] = v || ''; continue; }
    const [t, v] = l.split('\t');
    points.push([Date.parse(`${t}Z`), v === '' || v == null ? null : +v]);
  }
  return { path: pathname, units: meta.units || '', type: meta.type || '', points };
}
const matchDss = (recs, filter) => { const f = String(filter || '').trim().toUpperCase(); return recs.filter((r) => r.ts && (!f || r.path.toUpperCase().includes(f))); };
async function dssExport(file, opts, ctx) {
  ctx.progress?.(0.1, 'Reading the catalogue');
  const recs = matchDss(await dssCatalog(file), opts.filter);
  if (!recs.length) throw new Error(opts.filter ? `No time series in ${path.basename(file)} match “${opts.filter}”.` : `${path.basename(file)} holds no time series.`);
  const list = [];
  for (let i = 0; i < Math.min(recs.length, 200); i++) { ctx.progress?.(0.1 + 0.7 * i / recs.length, 'Reading'); list.push(await dssSeries(file, recs[i].path)); }
  const times = [...new Set(list.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b);
  const col = (s) => { const m = new Map(s.points); return times.map((t) => (m.has(t) ? m.get(t) : '')); };
  const head = ['Time', ...list.map((s) => `${s.path.split('/').slice(1, 4).filter(Boolean).join(' / ')}${s.units ? ` (${s.units})` : ''}`)];
  const cols = list.map(col), rows = times.map((t, i) => [new Date(t).toISOString().slice(0, 19).replace('T', ' '), ...cols.map((c) => c[i])]);
  if (opts.to === 'csv') { const out = ctx.out.file(file, `${U.base(file)}.csv`); await fsp.writeFile(out, `﻿${toCsv([head, ...rows])}`); return { path: out, note: `${list.length} series × ${times.length} times` }; }
  const out = ctx.out.file(file, `${U.base(file)}.xlsx`);
  writeXlsx(out, [['Time series', [head, ...rows]], ['Records', [['Pathname', 'Units', 'Type', 'Values', 'First', 'Last', 'Peak'], ...list.map((s) => { const v = s.points.filter((p) => p[1] != null); return [s.path, s.units, s.type, v.length, v[0] ? new Date(v[0][0]).toISOString().slice(0, 16).replace('T', ' ') : '', v.length ? new Date(v[v.length - 1][0]).toISOString().slice(0, 16).replace('T', ' ') : '', v.length ? Math.max(...v.map((p) => p[1])) : '']; })]]]);
  return { path: out, note: `${list.length} series × ${times.length} times` };
}
async function dssPlot(file, opts, ctx) {
  const recs = matchDss(await dssCatalog(file), opts.filter || 'FLOW');
  const use = recs.length ? recs : matchDss(await dssCatalog(file), '');
  if (!use.length) throw new Error(`${path.basename(file)} holds no time series.`);
  const list = [];
  for (const r of use.slice(0, Number(opts.count) || 6)) list.push(await dssSeries(file, r.path));
  const units = [...new Set(list.map((s) => s.units).filter(Boolean))];
  const svg = lineChart({ title: `${path.basename(file)}`, subtitle: `${list.length} of ${use.length} series${opts.filter ? ` matching “${opts.filter}”` : recs.length ? ' with FLOW in the name' : ''}`, xLabel: 'Time', yLabel: units.join(', ') || 'Value', series: list.map((s) => ({ name: s.path.split('/').slice(1, 4).filter(Boolean).join(' / '), points: s.points })) });
  const out = await saveChart(svg, file, `${U.base(file)}-plot`, opts.to, ctx);
  return { path: out, note: list.map((s) => `${s.path.split('/')[2]} peak ${Math.max(...s.points.map((p) => p[1] ?? -Infinity)).toFixed(2)}`).join(', ') };
}
async function dssInfo(file) {
  const recs = await dssCatalog(file), ts = recs.filter((r) => r.ts);
  const text = [path.basename(file), `${recs.length} record${recs.length === 1 ? '' : 's'}, ${ts.length} time series`, '', ...recs.slice(0, 80).map((r) => `${r.ts ? 'TS ' : '   '} ${r.path}`), recs.length > 80 ? `… and ${recs.length - 80} more` : ''].join('\n').trim();
  return { path: null, note: `${ts.length} time series · ${[...new Set(ts.map((r) => r.parts.c))].slice(0, 4).join(', ')}`, text };
}
// For the hydrology window: what a file holds, in one call.
async function open(file) {
  const e = U.ext(file);
  if (e === 'inp' || e === 'out') {
    const r = await results(file, {});
    try {
      const o = r.results, times = Array.from({ length: o.periods }, (_, p) => o.time(p).getTime());
      const kinds = { sub: o.ids.sub, node: o.ids.node, link: o.ids.link };
      const rpt = r.rpt ? await fsp.readFile(r.rpt, 'latin1') : '';
      const geom = e === 'inp' ? swmmGeometry(await fsp.readFile(file, 'latin1')) : null;
      return { kind: 'swmm', name: path.basename(file), units: unitsOf(o), times, ids: kinds, nodeTypes: o.prop.node.map((p) => NODE_TYPES[p[0]] || 'Node'), linkTypes: o.prop.link.map((p) => LINK_TYPES[p[0]] || 'Link'), report: r.report, rpt: rpt.slice(0, 400000), geom,
        vars: { sub: SUB_VARS.slice(0, o.nv.sub), node: NODE_VARS.slice(0, o.nv.node), link: LINK_VARS.slice(0, o.nv.link) },
        values: Object.fromEntries(['sub', 'node', 'link'].map((k) => [k, o.ids[k].map((_, i) => Array.from({ length: Math.min(o.nv[k], 6) }, (_, v) => series(o, k, i, v).map((x) => +x.toFixed(5))))])) };
    } finally { if (r.dir) await tidy(r.dir); }
  }
  if (e === 'dss') { const recs = await dssCatalog(file); return { kind: 'dss', name: path.basename(file), records: recs }; }
  if (S.hdf5(file)) { const r = await rasRead(file); return { kind: 'ras', name: path.basename(file), ...r, profiles: r.profiles.map(({ series: s, ...p }) => ({ ...p, hasSeries: !!s })), series: r.profiles.find((p) => p.series)?.series || null }; }
  throw new Error(`Lime can’t open ${path.basename(file)} as a hydrology model or results file.`);
}
// Node coordinates, link vertices and subcatchment outlines from a .inp, for the model's map.
function swmmGeometry(text) {
  const sec = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, '').trim();
    if (!l) continue;
    const m = /^\[([^\]]+)\]/.exec(l);
    if (m) { cur = m[1].toUpperCase(); sec[cur] = []; continue; }
    if (cur) sec[cur].push(l.split(/\s+/));
  }
  const nodes = Object.fromEntries((sec.COORDINATES || []).map((r) => [r[0], [+r[1], +r[2]]]));
  const links = ['CONDUITS', 'PUMPS', 'ORIFICES', 'WEIRS', 'OUTLETS'].flatMap((k) => (sec[k] || []).map((r) => ({ id: r[0], from: r[1], to: r[2] })));
  const verts = {};
  for (const r of sec.VERTICES || []) (verts[r[0]] ||= []).push([+r[1], +r[2]]);
  const polys = {};
  for (const r of sec.POLYGONS || []) (polys[r[0]] ||= []).push([+r[1], +r[2]]);
  return { nodes, links: links.map((l) => ({ ...l, path: [nodes[l.from], ...(verts[l.id] || []), nodes[l.to]].filter(Boolean) })), subs: polys };
}
const dssValues = (file, pathname) => dssSeries(file, pathname);
// For the hydrology window: its charts are drawn here, so the window and the wheel's plots look the same.
const chart = (spec) => lineChart(spec);
async function savePicture(target, svg) {
  if (/\.svg$/i.test(target)) await fsp.writeFile(target, svg); else await require('sharp')(Buffer.from(svg), { density: 144 }).png().toFile(target);
  return { path: target };
}

module.exports = { chart, savePicture, have, vendorDir, wasi, readOut, readRpt, runSwmm, swmmRun, swmmExport, swmmPlot, swmmTables, rasRead, rasTable, rasPlot, rasInfo, dssCatalog, dssSeries, dssValues, dssExport, dssPlot, dssInfo, open, swmmGeometry, lineChart, write: (t, d) => require('../diagrams').write(t, d) };
