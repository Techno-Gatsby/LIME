'use strict';
// Engineering: map data through GDAL, SWMM runs, HEC-RAS and HEC-DSS results, and project schedules through MPXJ on
// the bundled Java runtime. Every check reads the result back and looks at its contents, not only that a file exists.
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) throw new Error(m); };
const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;
const F = require('./engfixtures');
const SAMPLES = path.join(__dirname, 'samples', 'eng');
const engine = (id) => require('../src/main/engtools').engineReady(id);

// Fixtures, made once per folder: map data (GDAL writes the shapefile, GeoPackage and GeoTIFF), the SWMM model, the
// HEC-RAS results, a DSS file written by HEC's own library and the schedule.
const made = new Map();
function fixtures(out) {
  if (!made.has(out)) made.set(out, (async () => {
    fs.mkdirSync(out, { recursive: true });
    const geo = await F.geoFiles(out), more = F.hydroFiles(out);
    const ras = path.join(out, 'wadi.p01.hdf'), dss6 = path.join(out, 'old.dss');
    fs.copyFileSync(path.join(SAMPLES, 'wadi.p01.hdf'), ras);
    fs.copyFileSync(path.join(SAMPLES, 'dss6-sample.dss'), dss6);
    let dss = null;
    if (engine('dsstool')) { await require('../src/main/engines/hydro').wasi('dsstool', ['sample', '/d/hms.dss'], { dirs: { '/d': out } }); dss = path.join(out, 'hms.dss'); }
    return { ...geo, ...more, ras, dss, dss6 };
  })());
  return made.get(out);
}

module.exports = async ({ submit, jobs, dir }) => {
  const OUT = path.join(dir, 'engineering'), results = [];
  fs.rmSync(OUT, { recursive: true, force: true });
  const X = await fixtures(path.join(OUT, 'in'));
  const check = async (name, fn) => {
    name = `engineering: ${name}`;
    if (only && !only.test(name)) return;
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { if (e.skip) { status = 'SKIP'; detail = e.message; } else { status = 'FAIL'; detail = e.message; } }
    console.log(`${status} ${name.padEnd(48)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 300));
    results.push({ name, status, detail });
  };
  const skip = (m) => Object.assign(new Error(m), { skip: true });
  const run = async (tool, files, opts = {}) => {
    const d = path.join(OUT, `${tool}-${results.length}-${Date.now() % 100000}`);
    fs.mkdirSync(d, { recursive: true });
    const id = submit({ tool, files, opts, dest: { kind: 'dir', path: d } });
    let j;
    for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(100); }
    ok(j.status === 'done', `${tool}: ${j.status}: ${j.error}`);
    return j.results[0];
  };
  const fails = async (tool, files, opts, re) => {
    const id = submit({ tool, files, opts, dest: { kind: 'dir', path: path.join(OUT, 'fail') } });
    let j;
    for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(100); }
    ok(j.status === 'error' && re.test(j.error), `expected a refusal like ${re}, got ${j.status}: ${j.error}`);
    return j.error;
  };
  const near = (a, b, tol, what) => ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);
  const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const XLSX = require('xlsx');
  const sheet = (p, name) => { const wb = XLSX.readFile(p); const ws = wb.Sheets[name || wb.SheetNames[0]]; ok(ws, `no sheet ${name} in ${wb.SheetNames}`); return XLSX.utils.sheet_to_json(ws, { header: 1 }); };
  const csvRows = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).map((l) => l.split(','));
  const geo = require('../src/main/engines/geo');

  // --- Map data --------------------------------------------------------------------------------------------------------
  await check('GeoJSON to shapefile keeps every feature, split by geometry', async () => {
    const r = await run('geo-convert', [X.geojson], { to: 'shp' });
    const z = require('fflate').unzipSync(new Uint8Array(fs.readFileSync(r.path))), names = Object.keys(z).sort();
    for (const k of ['points', 'lines', 'polygons']) ok(names.includes(`site-${k}.shp`) && names.includes(`site-${k}.dbf`) && names.includes(`site-${k}.prj`), `no ${k} shapefile in ${names}`);
    const d = await geo.describe(r.path);
    ok(d.layers.reduce((s, l) => s + l.count, 0) === 4, `${d.layers.map((l) => `${l.name}:${l.count}`)}`);
    ok(d.layers.every((l) => l.crs?.epsg === '4326'), 'shapefiles lost WGS 84');
    ok(d.layers.some((l) => l.fields.some((f) => f.name === 'storeys')), 'fields lost');
    return names.join(' ');
  });
  await check('KMZ, GPX, GeoPackage and zipped shapefile convert to GeoJSON', async () => {
    const out = [];
    for (const [f, want, name] of [[X.kmz, 3, 'Benchmark BM1'], [X.gpx, 2, 'Site walk'], [X.gpkg, 4, 'Plot A'], [X.shpZip, 3, null]]) {
      const r = await run('geo-convert', [f], { to: 'geojson' });
      const g = json(r.path);
      ok(g.type === 'FeatureCollection' && g.features.length === want, `${path.basename(f)}: ${g.features.length} features, wanted ${want}`);
      if (name) ok(g.features.some((x) => Object.values(x.properties).includes(name)), `${path.basename(f)} lost “${name}”`);
      const [lon, lat] = (function first(c) { return typeof c[0] === 'number' ? c : first(c[0]); })(g.features[0].geometry.coordinates);
      near(lon, F.LON, 0.02, 'longitude'); near(lat, F.LAT, 0.02, 'latitude');
      out.push(`${path.extname(f)} ${g.features.length}`);
    }
    return out.join(', ');
  });
  await check('CSV with latitude and longitude becomes points; KML and GPX are valid', async () => {
    const g = json((await run('geo-convert', [X.csv], { to: 'geojson' })).path);
    ok(g.features.length === 3 && g.features[0].geometry.type === 'Point', 'not three points');
    near(g.features[0].geometry.coordinates[0], F.LON, 1e-6, 'BH1 longitude');
    ok(g.features[0].properties.name === 'Borehole BH1' && g.features[0].properties.level_m === 4.1, 'attributes lost');
    const kml = fs.readFileSync((await run('geo-convert', [X.geojson], { to: 'kml' })).path, 'utf8');
    ok(/<kml/.test(kml) && /Plot A/.test(kml) && /<Polygon>/.test(kml) && /<LineString>/.test(kml), 'KML lacks the features');
    const gpx = fs.readFileSync((await run('geo-convert', [X.geojson], { to: 'gpx' })).path, 'utf8');
    ok((gpx.match(/<wpt /g) || []).length === 2 && (gpx.match(/<trk>/g) || []).length === 2 && /<name>Site office<\/name>/.test(gpx), 'GPX: 2 waypoints and 2 tracks expected');
    const dxf = fs.readFileSync((await run('geo-convert', [X.geojson], { to: 'dxf' })).path, 'latin1');
    ok(/ENTITIES/.test(dxf) && /(LWPOLYLINE|POLYLINE)/.test(dxf) && /POINT/.test(dxf), 'DXF lacks entities');
    return `3 points, KML ${kml.length} B, GPX ${gpx.length} B`;
  });
  await check('reprojects to Dubai Local TM and back to WGS 84', async () => {
    const r = await run('geo-reproject', [X.csv], { crs: '3997' });
    const rows = csvRows(r.path), head = rows[0], xi = head.indexOf('X'), yi = head.indexOf('Y');
    ok(xi >= 0 && yi >= 0, `no X/Y columns: ${head}`);
    near(+rows[1][xi], 493697.76, 0.5, 'BH1 easting (DLTM)'); near(+rows[1][yi], 2788742.23, 0.5, 'BH1 northing (DLTM)');
    const back = await run('geo-reproject', [X.csvXY], { crs: '4326', from: '3997' });
    const b = csvRows(back.path), bx = b[0].indexOf('X');
    near(+b[1][bx], F.LON, 1e-5, 'longitude back from DLTM');
    const utm = await run('geo-reproject', [X.shp], { crs: 'utm' });
    ok(/EPSG:32640/.test(utm.note), `auto UTM zone: ${utm.note}`);
    await fails('geo-reproject', [X.csvXY], { crs: '4326' }, /coordinate system/);
    return `BH1 E ${rows[1][xi]} N ${rows[1][yi]}; ${utm.note}`;
  });
  await check('GeoTIFF: info, coloured picture, reprojection', async () => {
    const i = await run('geo-info', [X.tif]);
    ok(/60 × 40/.test(i.note) && /EPSG:4326/.test(i.note) && /values 2 to 1[34]/.test(i.text || ''), `info: ${i.note} | ${(i.text || '').slice(0, 200)}`);
    const p = await run('geo-picture', [X.tif], { to: 'png' });
    const m = await require('sharp')(p.path).metadata();
    ok(m.format === 'png' && m.width === 60 && m.height === 80, `picture ${m.width}×${m.height} (60 wide, 40 rows plus the legend)`);
    const { data, info } = await require('sharp')(p.path).raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const low = px(1, 20), high = px(40, 15);
    ok(low[1] > low[0] && high.reduce((s, v) => s + v, 0) > low.reduce((s, v) => s + v, 0), `low ground ${low} should be green and the hill ${high} lighter`);
    const w = await run('geo-reproject', [X.tif], { crs: '32640' });
    const d = await geo.describe(w.path);
    ok(d.crs?.epsg === '32640' && d.kind === 'raster', `warped CRS ${d.crs?.name}`);
    return `${i.note}; warped ${d.size.join('×')} in ${d.crs.name}`;
  });
  await check('layer info lists fields, counts and the coordinate system', async () => {
    const r = await run('geo-info', [X.gpkg], { save: true });
    const t = fs.readFileSync(r.path, 'utf8');
    ok(/4 features/.test(t) && /storeys \(Integer\)/.test(t) && /EPSG:4326/.test(t) && /Lies within longitude 55\.26/.test(t), t.slice(0, 300));
    return r.note;
  });

  // --- Hydrology -------------------------------------------------------------------------------------------------------
  await check('SWMM runs the model: report, continuity and outfall peak', async () => {
    if (!engine('swmm5')) throw skip('the SWMM engine isn’t in this build');
    const r = await run('swmm-run', [X.inp]);
    const t = fs.readFileSync(r.path, 'latin1');
    ok(/EPA STORM WATER MANAGEMENT MODEL - VERSION 5\.2/.test(t) && /Flow Routing Continuity/.test(t) && /Node Depth Summary/.test(t), 'report lacks its sections');
    const m = /Out1 1\.(\d+) CMS/.exec(r.note);
    ok(m, `no outfall peak in “${r.note}”`);
    const cont = /continuity (-?[\d.]+)% runoff, (-?[\d.]+)% routing/.exec(r.note);
    ok(cont && Math.abs(+cont[1]) < 1 && Math.abs(+cont[2]) < 1, `continuity errors: ${r.note}`);
    return r.note;
  });
  await check('SWMM results to Excel, CSV and hydrographs', async () => {
    if (!engine('swmm5')) throw skip('the SWMM engine isn’t in this build');
    const x = await run('swmm-results', [X.inp], { to: 'xlsx' });
    const wb = XLSX.readFile(x.path);
    ok(wb.SheetNames.includes('Summary') && wb.SheetNames.some((n) => /^Link flow/.test(n)), `sheets ${wb.SheetNames}`);
    const s = sheet(x.path, 'Summary'), c3 = s.find((r) => r[0] === 'C3' && r[2] === 'Flow');
    ok(c3 && c3[3] > 1.4 && c3[3] < 1.6 && /2024-06-01 01:/.test(c3[5]), `C3 peak ${c3}`);
    const flow = sheet(x.path, wb.SheetNames.find((n) => /^Link flow/.test(n)));
    ok(flow[0].join() === 'Time,C1,C2,C3' && flow.length === 73, `flow table ${flow[0]} × ${flow.length}`);
    const cs = csvRows((await run('swmm-results', [X.inp], { to: 'csv', what: 'node-depth' })).path);
    ok(cs[0].join() === 'Time,J1,J2,J3,Out1' && cs.length === 73 && Math.max(...cs.slice(1).map((r) => +r[2])) > 0.4, 'node depth CSV');
    const p = await run('swmm-plot', [X.inp], { to: 'svg', what: 'links' });
    const svg = fs.readFileSync(p.path, 'utf8');
    ok((svg.match(/<path d="M/g) || []).length === 3 && /C3/.test(svg) && /Link flow \(CMS\)/.test(svg), 'hydrograph SVG lacks its lines');
    const png = await require('sharp')((await run('swmm-plot', [X.inp], { to: 'png', what: 'outfalls' })).path).metadata();
    ok(png.width > 1000, `PNG ${png.width}`);
    return `C3 peak ${c3[3]} at ${c3[5]}`;
  });
  await check('SWMM model errors are reported, not hidden', async () => {
    if (!engine('swmm5')) throw skip('the SWMM engine isn’t in this build');
    const bad = path.join(OUT, 'in', 'broken.inp');
    fs.writeFileSync(bad, fs.readFileSync(X.inp, 'utf8').replace('C3               J3               Out1', 'C3               J3               Nowhere'));
    const e = await fails('swmm-run', [bad], {}, /SWMM couldn’t run broken\.inp: ERROR/);
    return e.slice(0, 120);
  });
  await check('HEC-RAS results: water levels, profile plot, info', async () => {
    const t = await run('ras-table', [X.ras], { to: 'xlsx' });
    const rows = sheet(t.path, 'Water surface');
    ok(rows[0].slice(0, 6).join() === 'River,Reach,River station,Profile,Min channel elevation,Water surface', `head ${rows[0]}`);
    const r = rows.find((x) => x[2] === '1000' && x[3] === 'PF 100yr');
    ok(r && r[0] === 'Wadi Hatta' && Math.abs(r[5] - 14.1) < 1e-3 && Math.abs(r[6] - 2.1) < 1e-3 && r[7] === 190, `PF 100yr at 1000: ${r}`);
    const mx = rows.find((x) => x[2] === '300' && x[3] === 'Maximum (unsteady)');
    ok(mx && mx[5] > 7.5 && mx[5] < 8.5 && mx[7] === 190 && mx[9], `unsteady maximum at 300: ${mx}`);
    ok(XLSX.readFile(t.path).SheetNames.includes('Stage hydrographs'), 'no stage hydrographs');
    const csv = csvRows((await run('ras-table', [X.ras], { to: 'csv' })).path);
    ok(csv.length === 1 + 8 * 3, `${csv.length - 1} CSV rows`);
    const svg = fs.readFileSync((await run('ras-plot', [X.ras], { to: 'svg' })).path, 'utf8');
    ok(/Water surface profile/.test(svg) && /PF 100yr/.test(svg) && /fill="#bfa780"/.test(svg), 'profile plot lacks profiles or bed');
    const i = await run('ras-info', [X.ras]);
    ok(/Wadi channel 100-year/.test(i.text) && /8 cross sections/.test(i.note), i.note);
    return `${rows.length - 1} rows; ${i.note}`;
  });
  await check('HEC-DSS: catalogue, time series to Excel, plot; version 6 explained', async () => {
    if (!engine('dsstool') || !X.dss) throw skip('the HEC-DSS reader isn’t in this build');
    const i = await run('dss-info', [X.dss]);
    ok(/3 time series/.test(i.note) && /\/WADI HATTA\/OUTLET\/FLOW\/\/15Minute\//.test(i.text), `${i.note} ${i.text}`);
    const x = await run('dss-export', [X.dss], { to: 'xlsx' });
    const ts = sheet(x.path, 'Time series');
    ok(ts[0].length === 4 && ts.length === 97, `table ${ts[0].length} × ${ts.length}`);
    const col = ts[0].findIndex((h) => /BASIN-1 \/ FLOW \(M3\/S\)/.test(h));
    ok(col > 0 && Math.max(...ts.slice(1).map((r) => +r[col] || 0)) === 50, `basin peak in ${ts[0]}`);
    const f = await run('dss-export', [X.dss], { to: 'csv', filter: 'precip' });
    const c = csvRows(f.path);
    ok(c[0].length === 2 && /PRECIP/.test(c[0][1]) && Math.max(...c.slice(1).map((r) => +r[1] || 0)) === 6, `precip CSV ${c[0]}`);
    const svg = fs.readFileSync((await run('dss-plot', [X.dss], { to: 'svg' })).path, 'utf8');
    ok((svg.match(/<path d="M/g) || []).length === 2 && /BASIN-1/.test(svg), 'plot should show the two flows');
    await fails('dss-info', [X.dss6], {}, /version 6/);
    return `${i.note}; ${f.note}`;
  });

  // --- Schedules -------------------------------------------------------------------------------------------------------
  await check('MS Project XML: Excel task list, MPX, Gantt PDF and PNG', async () => {
    if (!engine('projectlibre')) throw skip('ProjectLibre and its Java runtime aren’t in this build');
    const x = await run('project-convert', [X.msp], { to: 'xlsx' });
    const rows = sheet(x.path, 'Tasks');
    ok(rows[0].slice(0, 6).join() === 'ID,WBS,Task,Level,Start,Finish', `head ${rows[0]}`);
    const fnd = rows.find((r) => String(r[2]).trim() === 'Foundations');
    ok(fnd && fnd[4] === '2025-03-12' && fnd[5] === '2025-03-25' && fnd[6] === 10 && fnd[8] === '3', `Foundations ${fnd}`);
    const surv = rows.find((r) => String(r[2]).trim() === 'Survey and setting out');
    ok(surv && surv[7] === 100 && surv[9] === 'Survey crew', `Survey ${surv}`);
    ok(rows.find((r) => String(r[2]).trim() === 'Structure complete')?.[10] === 'Yes', 'milestone lost');
    const mpx = fs.readFileSync((await run('project-convert', [X.msp], { to: 'mpx' })).path, 'latin1');
    ok(/^MPX,/.test(mpx) && /Columns and slab/.test(mpx), 'MPX lacks the tasks');
    const pdf = await run('project-gantt', [X.msp], { to: 'pdf' });
    ok((await require('../src/main/engines/pdf').pageCount(pdf.path)) === 1, 'Gantt PDF pages');
    const { doc } = await require('../src/main/engines/pdf').readPdf(pdf.path);
    const text = doc.loadPage(0).toStructuredText('').asText();
    ok(/Villa plot works/.test(text) && /Foundations/.test(text) && /Excavator/.test(text), `Gantt PDF text: ${text.slice(0, 200)}`);
    const png = await require('sharp')((await run('project-gantt', [X.msp], { to: 'png' })).path).metadata();
    ok(png.width > 800 && png.height > 200, `Gantt PNG ${png.width}×${png.height}`);
    const i = await run('project-info', [X.msp]);
    ok(/5 tasks/.test(i.note) && /2025-03-03 to 2025-04-15/.test(i.note), i.note);
    return `${rows.length - 1} tasks; ${i.note}`;
  });
  await check('MS Project XML round trip through MPXJ keeps the tasks', async () => {
    if (!engine('projectlibre')) throw skip('ProjectLibre and its Java runtime aren’t in this build');
    const mpx = await run('project-convert', [X.msp], { to: 'mpx' });
    const xml = fs.readFileSync((await run('project-convert', [mpx.path], { to: 'xml' })).path, 'utf8');
    ok(/schemas\.microsoft\.com\/project/.test(xml) && (xml.match(/<Task>/g) || []).length >= 7 && /Columns and slab/.test(xml), 'MSPDI from MPX lacks tasks');
    return `${(xml.match(/<Task>/g) || []).length} tasks`;
  });

  // --- Apps and the wheel ----------------------------------------------------------------------------------------------
  await check('wheel and apps route engineering files', async () => {
    const tools = require('../src/main/tools'), crafts = require('../src/main/engines/crafts');
    const ring = (f) => { const w = tools.wheelsFor([f]); return [...w.convert, ...w.tools].map((x) => x.tool); };
    ok(ring(X.geojson).includes('geo-convert') && ring(X.tif).includes('geo-picture') && ring(X.csv).includes('geo-convert') && ring(X.shpZip).includes('geo-convert'), 'map slices missing');
    ok(!ring(path.join(__dirname, 'samples', 'test.dxf')).includes('geo-picture'), 'DXF offered a raster tool');
    ok(ring(X.inp).includes('swmm-run') && ring(X.ras).includes('ras-table') && (!X.dss || ring(X.dss).includes('dss-export')) && ring(X.msp).includes('project-gantt'), 'hydrology or schedule slices missing');
    ok(tools.groupOf(X.msp) === 'project' && tools.groupOf(X.tif) === 'gis' && tools.groupOf(X.inp) === 'hydro', 'groups');
    ok(crafts.appsFor([X.geojson])[0] === 'maps' && crafts.appsFor([X.inp])[0] === 'hydro' && crafts.appsFor([X.msp])[0] === 'projectlibre', `apps ${crafts.appsFor([X.geojson])} ${crafts.appsFor([X.inp])} ${crafts.appsFor([X.msp])}`);
    ok(crafts.appsFor([X.csv]).includes('maps') && !crafts.appsFor([path.join(__dirname, 'samples', 'test.dxf')]).includes('hydro'), 'sniffed apps');
    for (const id of ['maps', 'hydro', 'projectlibre']) ok(crafts.APPS[id].bucket === 'engineering', `${id} bucket`);
    ok(crafts.EXTERNAL.qgis && crafts.EXTERNAL.hecras && crafts.EXTERNAL.hechms && crafts.EXTERNAL.swmm, 'external apps');
    ok(crafts.hasApp('projectlibre') === engine('projectlibre'), 'ProjectLibre full app');
    return `QGIS ${crafts.hasExternal('qgis') ? 'found' : 'not installed'}, HEC-RAS ${crafts.hasExternal('hecras') ? 'found' : 'not installed'}`;
  });
  await check('ProjectLibre starts on the bundled runtime with the schedule', async () => {
    if (!engine('projectlibre')) throw skip('ProjectLibre and its Java runtime aren’t in this build');
    if (process.platform === 'linux' && !process.env.DISPLAY) throw skip('no display');
    const crafts = require('../src/main/engines/crafts');
    const jar = await crafts.openApp('projectlibre', [X.msp]);
    ok(/projectlibre\.jar$/.test(jar), jar);
    await sleep(6000);
    // tasklist shows no command lines, so on Windows they come from CIM.
    const ps = process.platform === 'win32'
      ? require('child_process').execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }']).toString()
      : require('child_process').execFileSync('ps', ['-eo', 'pid,args']).toString();
    const line = ps.split(/\r?\n/).find((l) => /projectlibre\.jar/.test(l) && /villa-works\.xml/.test(l));
    ok(line, 'ProjectLibre is not running');
    try { process.kill(+line.trim().split(/\s+/)[0]); } catch (_) {}
    return 'running';
  });
  return results;
};

// Inputs for the option sweep in tools.test.js, written beside the shared fixtures.
module.exports.sweep = async (FX) => {
  const X = await fixtures(path.join(FX, 'eng-sweep')), rel = (p) => path.relative(FX, p);
  const inputs = { 'geo-convert': [[rel(X.geojson)]], 'geo-reproject': [[rel(X.shp)], { crs: '3997' }], 'geo-info': [[rel(X.gpkg)]], 'geo-picture': [[rel(X.tif)]],
    'swmm-run': [[rel(X.inp)]], 'swmm-results': [[rel(X.inp)]], 'swmm-plot': [[rel(X.inp)]], 'ras-table': [[rel(X.ras)]], 'ras-plot': [[rel(X.ras)]], 'ras-info': [[rel(X.ras)]],
    'project-convert': [[rel(X.msp)]], 'project-gantt': [[rel(X.msp)]], 'project-info': [[rel(X.msp)]] };
  if (X.dss) Object.assign(inputs, { 'dss-export': [[rel(X.dss)]], 'dss-plot': [[rel(X.dss)]], 'dss-info': [[rel(X.dss)]] });
  return { inputs, refuse: { 'geo-reproject crs=custom': /isn’t an EPSG code/ } };
};
module.exports.fixtures = fixtures;

// The Maps and Hydrology windows, run from the UI suite.
module.exports.ui = async ({ openEditor, editors, dir }) => {
  const OUT = path.join(dir, 'engineering-ui'), results = [];
  fs.rmSync(OUT, { recursive: true, force: true });
  const X = await fixtures(path.join(OUT, 'in'));
  const check = async (name, fn) => {
    name = `engineering window · ${name}`;
    if (only && !only.test(name)) return;
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { if (e.skip) { status = 'SKIP'; detail = e.message; } else { status = 'FAIL'; detail = e.message; } }
    console.log(`${status} ${name.padEnd(48)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 300));
    results.push({ name, status, detail });
  };
  // LIME_ENG_SHOTS names a folder for screenshots of each window, to check them by eye.
  const shot = async (win, name) => { const d = process.env.LIME_ENG_SHOTS; if (!d) return; fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `${name}.png`), (await win.webContents.capturePage()).toPNG()); };
  const open = async (file, mode, ready, ms = 60000) => {
    openEditor(file, mode);
    const win = [...editors].pop(), wc = win.webContents;
    while (wc.isLoading()) await sleep(200);
    const ejs = (code) => wc.executeJavaScript(`(async () => { ${code} })()`, true);
    const t = Date.now();
    while (Date.now() - t < ms && !(await ejs(`return !!(${ready})`).catch(() => false))) await sleep(250);
    ok(await ejs(`return !!(${ready})`), `${mode} window did not open`);
    return { win, ejs };
  };
  await check('Maps opens GeoJSON over the basemap, styles, table, identify', async () => {
    const { win, ejs } = await open(X.geojson, 'map', 'window.__map?.st.loaded');
    const s = await ejs('const M = window.__map; return { layers: M.st.layers.map((l) => [l.name, l.count, l.kind]), base: M.map().getLayers().getArray().filter((l) => l.get("base")).map((l) => [l.get("name"), l.getSource().getFeatures().length]) }');
    ok(s.layers.length === 1 && s.layers[0][1] === 4, `layers ${JSON.stringify(s.layers)}`);
    const countries = s.base.find((b) => b[0] === 'countries');
    ok(countries && countries[1] > 200, `basemap ${JSON.stringify(s.base)}`);
    await ejs('document.querySelector(".mv-layers [data-k=color]").value = "#c92a2a"; document.querySelector(".mv-layers [data-k=color]").dispatchEvent(new Event("input", { bubbles: true }))');
    ok(await ejs('return window.__map.st.layers[0].style.color') === '#c92a2a', 'colour change ignored');
    await ejs('document.querySelector("[data-a=table]").click()');
    await sleep(300);
    const rows = await ejs('return [...document.querySelectorAll(".mv-table tbody tr")].map((r) => r.textContent)');
    ok(rows.length === 4 && rows.some((r) => /Plot A/.test(r)), `table ${rows}`);
    await ejs('const f = document.querySelector(".mv-table .tb-filter"); f.value = "gate"; f.dispatchEvent(new Event("input"))');
    ok(await ejs('return [...document.querySelectorAll(".mv-table tbody tr")].filter((r) => !r.hidden).length') === 1, 'filter');
    await ejs('[...document.querySelectorAll(".mv-table tbody tr")].find((r) => /Plot A/.test(r.textContent)).click()');
    await sleep(500);
    const pop = await ejs('return document.querySelector(".mv-pop")?.textContent || ""');
    ok(/Plot A/.test(pop) && /storeys/.test(pop) && /Area \d/.test(pop), `identify popup “${pop}”`);
    const px = await ejs('const M = window.__map, m = M.map(); const f = M.st.layers[0].source.getFeatures().find((x) => x.get("name") === "Site office"); const p = m.getPixelFromCoordinate(f.getGeometry().getCoordinates()); m.dispatchEvent({ type: "singleclick", pixel: p, coordinate: f.getGeometry().getCoordinates(), map: m }); await new Promise((r) => setTimeout(r, 200)); return document.querySelector(".mv-pop")?.textContent || ""');
    ok(/Site office/.test(px), `click identify “${px}”`);
    await shot(win, 'map-geojson');
    win.closing = true; win.destroy();
    return `${s.layers[0][0]}: 4 features over ${countries[1]} countries`;
  });
  await check('Maps measures, reads coordinates in DLTM, adds layers and exports PNG and PDF', async () => {
    const { win, ejs } = await open(X.shp, 'map', 'window.__map?.st.loaded');
    await ejs('window.__map.setMode("distance")');
    ok(await ejs('return /Click along the line/.test(document.querySelector(".mv-msg").textContent)'), 'distance mode message');
    await ejs('window.__map.setMode("identify")');
    await ejs('const sel = document.querySelector(".mv-readout"); sel.value = "3997"; sel.dispatchEvent(new Event("change", { bubbles: true })); await window.__map.readout(window.__map.L().fromLonLat([55.2708, 25.2048]))');
    await sleep(800);
    await ejs('await window.__map.readout(window.__map.L().fromLonLat([55.2708, 25.2048]))');
    const coord = await ejs('return document.querySelector(".mv-coord").textContent');
    const m = /E ([\d.]+)\s+N ([\d.]+)/.exec(coord);
    ok(m && Math.abs(+m[1] - 493697.76) < 2 && Math.abs(+m[2] - 2788742.23) < 2, `DLTM readout “${coord}”`);
    const added = await ejs(`return (await window.__map.addFile(${JSON.stringify(X.tif)})).map((l) => [l.kind, l.min, l.max])`);
    ok(added.length === 1 && added[0][0] === 'raster' && added[0][1] < 3 && added[0][2] > 13, `raster layer ${JSON.stringify(added)}`);
    const added2 = await ejs(`return (await window.__map.addFile(${JSON.stringify(X.kmz)})).map((l) => l.count)`);
    ok(added2[0] === 3, `KMZ layer ${added2}`);
    const png = path.join(OUT, 'view.png'), pdf = path.join(OUT, 'view.pdf');
    await ejs(`await window.__map.exportTo(${JSON.stringify(png)}, 'png'); await window.__map.exportTo(${JSON.stringify(pdf)}, 'pdf')`);
    const meta = await require('sharp')(png).metadata();
    ok(meta.width > 500 && meta.height > 300, `PNG ${meta.width}×${meta.height}`);
    const { data } = await require('sharp')(png).resize(64, 64).raw().toBuffer({ resolveWithObject: true });
    ok(new Set(Array.from({ length: 64 * 64 }, (_, i) => data[i * 3] >> 4)).size > 3, 'exported PNG is blank');
    const { doc } = await require('../src/main/engines/pdf').readPdf(pdf);
    ok(doc.countPages() === 1 && /Made with Lime/.test(doc.loadPage(0).toStructuredText('').asText()), 'PDF page');
    await shot(win, 'map-layers');
    if (process.env.LIME_ENG_SHOTS) fs.copyFileSync(png, path.join(process.env.LIME_ENG_SHOTS, 'map-export.png'));
    win.closing = true; win.destroy();
    return `DLTM ${coord}; PNG ${meta.width}×${meta.height}`;
  });
  await check('Maps asks for the coordinate system of a CSV in metres', async () => {
    const { win, ejs } = await open(X.csvXY, 'map', 'document.querySelector(".mv-crs")', 30000);
    await ejs('document.querySelector(".mv-crs").value = "3997"; document.querySelector(".scrim [data-a=ok]").click()');
    const t = Date.now();
    while (Date.now() - t < 20000 && !(await ejs('return window.__map.st.loaded'))) await sleep(200);
    const l = await ejs('const l = window.__map.st.layers[0]; const L = window.__map.L(); const c = L.toLonLat(l.source.getFeatures()[0].getGeometry().getCoordinates()); return [l.count, c]');
    ok(l[0] === 3 && Math.abs(l[1][0] - 55.2708) < 1e-4 && Math.abs(l[1][1] - 25.2048) < 1e-4, `points ${JSON.stringify(l)}`);
    win.closing = true; win.destroy();
    return `BH1 at ${l[1].map((v) => v.toFixed(5))}`;
  });
  await check('Hydrology runs the SWMM model and draws hydrographs, network and report', async () => {
    if (!engine('swmm5')) throw skip('the SWMM engine isn’t in this build');
    const { win, ejs } = await open(X.inp, 'hydro', 'window.__hydro?.st.ready && window.__hydro.svg()');
    const s = await ejs('const H = window.__hydro; return { kind: H.st.d.kind, steps: H.st.d.times.length, picked: [...H.st.pick].map((i) => H.st.d.ids[H.st.kind][i]), svg: H.svg().length, summary: document.querySelector(".hv-summary").textContent }');
    ok(s.kind === 'swmm' && s.steps === 72 && s.picked.includes('C3') && s.svg > 2000, JSON.stringify(s).slice(0, 300));
    ok(/continuity error/.test(s.summary), s.summary);
    await ejs('document.querySelector("[data-t=network]").click()');
    await sleep(400);
    ok(await ejs('return document.querySelectorAll(".hv-view svg polyline").length === 3 && document.querySelectorAll(".hv-view svg polygon").length === 3'), 'network drawing');
    await ejs('document.querySelector("[data-t=report]").click()');
    await sleep(300);
    ok(await ejs('return /Node Depth Summary/.test(document.querySelector(".hv-view pre").textContent)'), 'report tab');
    await ejs('document.querySelector("[data-t=table]").click()');
    await sleep(300);
    ok(await ejs('return document.querySelectorAll(".hv-view tbody tr").length === 72'), 'table rows');
    await ejs('document.querySelector("[data-t=chart]").click()');
    await sleep(600);
    await shot(win, 'hydro-swmm');
    win.closing = true; win.destroy();
    return `${s.steps} steps, showing ${s.picked.join(', ')}`;
  });
  await check('Hydrology shows HEC-RAS profiles and HEC-DSS series', async () => {
    const r = await open(X.ras, 'hydro', 'window.__hydro?.st.ready && window.__hydro.svg()');
    const t = await r.ejs('return document.querySelector(".hv-view svg").textContent');
    ok(/Water surface profile/.test(t) && /PF 100yr/.test(t), t.slice(0, 200));
    await r.ejs('document.querySelector("[data-t=hydro]").click()');
    await sleep(500);
    ok(/Flow hydrograph/.test(await r.ejs('return document.querySelector(".hv-view svg")?.textContent || ""')), 'RAS hydrograph tab');
    await r.ejs('document.querySelector("[data-t=chart]").click()');
    await sleep(600);
    await shot(r.win, 'hydro-ras');
    r.win.closing = true; r.win.destroy();
    if (!engine('dsstool') || !X.dss) return 'RAS only (no DSS reader)';
    const d = await open(X.dss, 'hydro', 'window.__hydro?.st.ready && window.__hydro.svg()');
    const n = await d.ejs('return document.querySelectorAll(".hv-view svg path[fill=none]").length');
    ok(n === 3, `${n} DSS lines`);
    d.win.closing = true; d.win.destroy();
    return 'RAS profile and hydrograph; DSS chart of 3 series';
  });
  return results;
};
