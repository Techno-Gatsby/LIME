'use strict';
// Map data: GeoJSON, shapefiles, KML/KMZ, GPX, GeoPackage, GML, FlatGeobuf, CSV with coordinates, DXF and rasters
// such as GeoTIFF, read, converted and reprojected with GDAL (gdal3.js: GDAL, PROJ and GEOS as WebAssembly, so every
// platform runs the same code and the full EPSG database is inside). Files are read in place through a mounted folder.
const U = require('./util');
const { fs, fsp, path } = U;
const S = require('./geosniff');

let gdalP = null;
const gdal = () => (gdalP ||= (async () => {
  const dir = path.dirname(require.resolve('gdal3.js/package.json'));
  // gdal3.js reads its data package at "./" + path, which only works for a path relative to the working folder.
  const rf = fs.readFileSync;
  fs.readFileSync = function (p, ...a) { if (typeof p === 'string' && p.startsWith('./') && path.isAbsolute(p.slice(2))) p = p.slice(2); return rf.call(this, p, ...a); };
  const con = { log: console.log, error: console.error, warn: console.warn };
  try {
    Object.assign(console, { log: () => {}, warn: () => {}, error: () => {} });
    const G = await require(path.join(dir, 'node.js'))({ path: path.join(dir, 'dist', 'package'), useWorker: false });
    const set = (k, v) => G.Module.ccall('CPLSetConfigOption', null, ['string', 'string'], [k, v]);
    // Never write .aux.xml or other side files next to the user's data.
    set('GDAL_PAM_ENABLED', 'NO');
    set('OGR_GEOJSON_MAX_OBJ_SIZE', '0');
    return G;
  } finally { fs.readFileSync = rf; Object.assign(console, con); }
})().catch((e) => { gdalP = null; throw e; }));

// GDAL reports through stderr; each call collects what it says, so a failure can name the reason.
let said = [];
async function quiet(fn) {
  const con = { log: console.log, error: console.error, warn: console.warn };
  said = [];
  const keep = (...a) => { const s = a.join(' ').replace(/^gdal stderr:\s*/, '').trim(); if (s) said.push(s); };
  Object.assign(console, { log: keep, error: keep, warn: keep });
  try { return await fn(); } catch (e) {
    const why = said.filter((s) => /ERROR/.test(s) && !/Pointer '\w+' is NULL/.test(s)).map((s) => s.replace(/^ERROR \d+:\s*/, ''))[0] || e?.message || String(e);
    throw new Error(why.trim());
  } finally { Object.assign(console, con); }
}

let mounts = 0;
// Opens a file with GDAL through a mount of its folder. Returns { G, ds, path, done() }.
async function openFile(file, { openOptions = [], vfs } = {}) {
  const G = await gdal(), FS = G.Module.FS, mount = `/input/m${++mounts}`;
  FS.mkdir(mount);
  FS.mount(G.Module.NODEFS, { root: path.dirname(path.resolve(file)) }, mount);
  const done = async (ds) => { try { if (ds) await G.close(ds); } catch (_) {} try { FS.unmount(mount); FS.rmdir(mount); } catch (_) {} };
  let inner = `${mount}/${path.basename(file)}`, handlers = [];
  const e = U.ext(file);
  if (e === 'zip') handlers = ['vsizip'];
  if (e === 'kmz') {
    const kml = S.zipNames(file).find((n) => /\.kml$/i.test(n) && !/\//.test(n)) || S.zipNames(file).find((n) => /\.kml$/i.test(n));
    if (!kml) { await done(); throw new Error(`${path.basename(file)} has no KML inside.`); }
    inner += `/${kml}`; handlers = ['vsizip'];
  }
  if (vfs) handlers = vfs;
  try {
    const r = await quiet(() => G.open(inner, openOptions, handlers));
    if (!r.datasets.length) throw new Error(r.errors?.[0]?.message?.trim() || `GDAL can’t read ${path.basename(file)}.`);
    const ds = r.datasets[0];
    return { G, ds, type: ds.type, done: () => done(ds) };
  } catch (err) { await done(); throw new Error(`${path.basename(file)} couldn’t be read as map data: ${err.message.replace(/\s+/g, ' ').slice(0, 200)}`); }
}
// A CSV's coordinate columns, as GDAL open options.
function csvOptions(file) {
  const c = S.csvColumns(file);
  if (!c) return [];
  const o = ['AUTODETECT_TYPE=YES', 'KEEP_GEOM_COLUMNS=YES'];
  if (c.x && c.y) o.push(`X_POSSIBLE_NAMES=${c.x}`, `Y_POSSIBLE_NAMES=${c.y}`); else if (c.wkt) o.push(`GEOM_POSSIBLE_NAMES=${c.wkt}`);
  if (c.sep === ';') o.push('SEPARATOR=SEMICOLON'); else if (c.sep === '\t') o.push('SEPARATOR=TAB');
  return o;
}
// A CSV whose columns are named latitude and longitude holds WGS 84 degrees.
const lonLatCsv = (file) => ['csv', 'tsv', 'txt'].includes(U.ext(file)) && /^(lon|long|lng|longitude)$/.test(S.csvColumns(file)?.x || '');
const openOf = (file) => (['csv', 'tsv', 'txt'].includes(U.ext(file)) ? { openOptions: csvOptions(file) } : {});

// Coordinate systems offered when reprojecting; any EPSG code works through "custom".
const CRS = [['4326', 'WGS 84 (latitude, longitude)'], ['utm', 'UTM zone of the data (WGS 84)'], ['3857', 'Web Mercator'], ['3997', 'Dubai Local Transverse Mercator (DLTM)'],
  ['32640', 'UTM zone 40N (UAE east, Oman)'], ['32639', 'UTM zone 39N (UAE west, Qatar, Bahrain)'], ['32638', 'UTM zone 38N (Saudi Arabia, Kuwait)'], ['27040', 'Nahrwan 1967 / UTM zone 40N'], ['27039', 'Nahrwan 1967 / UTM zone 39N'],
  ['32643', 'UTM zone 43N (India west)'], ['32644', 'UTM zone 44N (India east)'], ['27700', 'British National Grid'], ['2154', 'RGF93 / Lambert-93 (France)'], ['custom', 'Another EPSG code']];
const epsgOf = (o) => String(o.crs === 'custom' ? o.epsg : o.crs || '').replace(/^\s*epsg:\s*/i, '').trim();

// A coordinate system's name and EPSG code, from GDAL's PROJJSON or, failing that, its WKT.
function crsOf(cs) {
  if (!cs || (!cs.projjson && !cs.wkt)) return null;
  const id = cs.projjson?.id || cs.projjson?.base_crs?.id;
  if (cs.projjson) return { name: cs.projjson.name, epsg: id && id.authority === 'EPSG' ? String(id.code) : null, wkt: cs.wkt };
  const ids = [...cs.wkt.matchAll(/ID\["EPSG",(\d+)\]\s*\]\s*$/g)];
  return { name: /^\w+\["([^"]+)"/.exec(cs.wkt)?.[1] || 'Unknown', epsg: ids.length ? ids[ids.length - 1][1] : /^GEOGCRS\["WGS 84"/.test(cs.wkt) ? '4326' : null, wkt: cs.wkt };
}
async function vectorInfo(G, ds) {
  const j = await quiet(() => G.ogrinfo(ds, ['-json', '-so', '-al']));
  // GPX also lists every track and route point as a layer of its own; the tracks and routes already hold them.
  const gpx = j.driverShortName === 'GPX';
  return (j.layers || []).map((l) => {
    const g = l.geometryFields?.[0] || {};
    return { name: l.name, type: g.type || 'None', count: l.featureCount ?? null, fields: (l.fields || []).map((f) => ({ name: f.name, type: f.type })), extent: g.extent || null, crs: crsOf(g.coordinateSystem) };
  }).filter((l) => !(gpx && /^(route|track)_points$/.test(l.name)) && !(gpx && l.count === 0));
}
async function transformPoints(G, pts, from, to = '4326') {
  if (!from || from === to) return pts;
  const r = await quiet(() => G.gdaltransform(pts, ['-s_srs', `EPSG:${from}`, '-t_srs', `EPSG:${to}`, '-output_xy']));
  return r.map((p) => [p[0], p[1]]);
}
const utmFor = ([x0, y0, x1, y1]) => { const lon = (x0 + x1) / 2, lat = (y0 + y1) / 2, zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1)); return String((lat >= 0 ? 32600 : 32700) + zone); };
async function wgsExtent(G, layers, from) {
  const ex = layers.map((l) => l.extent).filter(Boolean);
  if (!ex.length) return null;
  const b = [Math.min(...ex.map((e) => e[0])), Math.min(...ex.map((e) => e[1])), Math.max(...ex.map((e) => e[2])), Math.max(...ex.map((e) => e[3]))];
  const epsg = from || layers.find((l) => l.crs?.epsg)?.crs.epsg;
  if (!epsg) return Math.abs(b[0]) <= 180 && Math.abs(b[2]) <= 180 && Math.abs(b[1]) <= 90 && Math.abs(b[3]) <= 90 ? b : null;
  const c = await transformPoints(G, [[b[0], b[1]], [b[2], b[3]], [b[0], b[3]], [b[2], b[1]]], epsg).catch(() => null);
  return c && [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))];
}

// Everything about a file: layers, fields, coordinate system and extent, or the raster's size, bands and values.
async function describe(file) {
  const src = await openFile(file, openOf(file));
  try {
    if (src.type === 'raster') {
      const j = await quiet(() => src.G.gdalinfo(src.ds, ['-json', '-mm']));
      return { kind: 'raster', driver: j.driverLongName, size: j.size, bands: (j.bands || []).map((b) => ({ type: b.type, min: b.computedMin ?? b.minimum, max: b.computedMax ?? b.maximum, nodata: b.noDataValue, colour: b.colorInterpretation })),
        pixel: j.geoTransform ? [j.geoTransform[1], Math.abs(j.geoTransform[5])] : null, crs: crsOf(j.coordinateSystem),
        corners: j.cornerCoordinates || null, wgs84: j.wgs84Extent?.coordinates?.[0] || null };
    }
    const layers = await vectorInfo(src.G, src.ds);
    return { kind: 'vector', driver: src.ds.info?.driverLongName || '', layers, wgs84: await wgsExtent(src.G, layers) };
  } finally { await src.done(); }
}

const fmtN = (n) => (n == null ? '?' : Math.abs(n) >= 1000 ? n.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : String(+Number(n).toFixed(6)));
function infoText(file, d) {
  const out = [path.basename(file)];
  const crs = (c) => (c ? `${c.name}${c.epsg ? ` (EPSG:${c.epsg})` : ''}` : 'not set');
  if (d.kind === 'raster') {
    out.push(`Raster ${d.size?.[0]} × ${d.size?.[1]} pixels, ${d.bands.length} band${d.bands.length === 1 ? '' : 's'} (${[...new Set(d.bands.map((b) => b.type))].join(', ')})`);
    out.push(`Coordinate system: ${crs(d.crs)}`);
    if (d.pixel) out.push(`Pixel size: ${fmtN(d.pixel[0])} × ${fmtN(d.pixel[1])}`);
    d.bands.forEach((b, i) => out.push(`Band ${i + 1}: ${b.colour || ''} ${b.min != null ? `values ${fmtN(b.min)} to ${fmtN(b.max)}` : ''}${b.nodata != null ? `, no data ${fmtN(b.nodata)}` : ''}`.replace(/\s+/g, ' ').trim()));
    if (d.corners) out.push(`Extent: ${fmtN(d.corners.lowerLeft[0])}, ${fmtN(d.corners.lowerLeft[1])} to ${fmtN(d.corners.upperRight[0])}, ${fmtN(d.corners.upperRight[1])}`);
  } else {
    out.push(`${d.layers.length} layer${d.layers.length === 1 ? '' : 's'}${d.driver ? ` (${d.driver})` : ''}`);
    for (const l of d.layers) {
      out.push('', `Layer “${l.name}”: ${l.count == null ? 'unknown number of' : fmtN(l.count)} feature${l.count === 1 ? '' : 's'}, ${l.type}`);
      out.push(`Coordinate system: ${crs(l.crs)}`);
      if (l.extent) out.push(`Extent: ${l.extent.map(fmtN).join(', ')}`);
      if (l.fields.length) out.push(`Fields: ${l.fields.map((f) => `${f.name} (${f.type})`).join(', ')}`);
    }
  }
  if (d.wgs84) out.push('', `Lies within longitude ${fmtN(Math.min(...[].concat(d.wgs84).flat().filter((_, i) => i % 2 === 0)))} to ${fmtN(Math.max(...[].concat(d.wgs84).flat().filter((_, i) => i % 2 === 0)))}, latitude ${fmtN(Math.min(...[].concat(d.wgs84).flat().filter((_, i) => i % 2 === 1)))} to ${fmtN(Math.max(...[].concat(d.wgs84).flat().filter((_, i) => i % 2 === 1)))}`);
  return out.join('\n');
}
async function info(file, opts, ctx) {
  ctx.progress?.(0.2, 'Reading');
  const d = await describe(file), text = infoText(file, d);
  let out = null;
  if (opts.save) { out = ctx.out.file(file, `${U.base(file)} - info.txt`); await fsp.writeFile(out, `${text}\n`); }
  const note = d.kind === 'raster' ? `${d.size?.join(' × ')} px · ${d.crs?.epsg ? `EPSG:${d.crs.epsg}` : d.crs?.name || 'no coordinate system'}` : `${d.layers.length} layer${d.layers.length === 1 ? '' : 's'} · ${d.layers.reduce((s, l) => s + (l.count || 0), 0)} features · ${d.layers[0]?.crs?.epsg ? `EPSG:${d.layers[0].crs.epsg}` : d.layers[0]?.crs?.name || 'no coordinate system'}`;
  return { path: out, note, text };
}

// ogr2ogr into the in-memory /output folder; the files written are copied out and removed. Returns host paths.
async function translate(G, ds, args, name, dir) {
  const r = await quiet(() => G.ogr2ogr(ds, args, name));
  return copyOut(G, r.all.map((f) => f.local), dir);
}
function copyOut(G, locals, dir) {
  const FS = G.Module.FS, out = [];
  fs.mkdirSync(dir, { recursive: true });
  for (const l of locals) {
    let data;
    try { data = FS.readFile(l); } catch (_) { continue; }
    const p = path.join(dir, path.basename(l));
    fs.writeFileSync(p, data);
    out.push(p);
    try { FS.unlink(l); } catch (_) {}
  }
  return out;
}
const DRIVER = { geojson: ['GeoJSON', 'geojson', ['-lco', 'RFC7946=NO', '-lco', 'WRITE_NAME=NO']], kml: ['KML', 'kml', []], gpkg: ['GPKG', 'gpkg', []], shp: ['ESRI Shapefile', 'shp', ['-lco', 'ENCODING=UTF-8']], csv: ['CSV', 'csv', ['-lco', 'GEOMETRY=AS_WKT']],
  dxf: ['DXF', 'dxf', []], gml: ['GML', 'gml', []], fgb: ['FlatGeobuf', 'fgb', []] };
const SINGLE = new Set(['geojson', 'csv', 'shp', 'dxf', 'fgb']);
const FORMATS = [['geojson', 'GeoJSON'], ['kml', 'KML (Google Earth)'], ['gpkg', 'GeoPackage'], ['shp', 'Shapefile (zipped)'], ['gpx', 'GPX (GPS)'], ['csv', 'CSV with coordinates'], ['dxf', 'DXF (CAD)'], ['gml', 'GML'], ['fgb', 'FlatGeobuf']];
const outExt = (to) => (to === 'shp' ? 'zip' : to);
const POINTS = /^(3D )?(Multi )?Point/i, LINES = /^(3D )?(Multi )?(Line ?String|Curve)/i, POLYS = /^(3D )?(Multi )?(Polygon|Surface)/i;

// A vector file to another format, optionally into another coordinate system.
async function convert(file, opts, ctx, { reproject = false } = {}) {
  const to = opts.to;
  ctx.progress?.(0.05, 'Opening');
  const src = await openFile(file, openOf(file));
  const tmp = await U.tmpDir('geo');
  try {
    if (src.type === 'raster') throw new Error(`${path.basename(file)} is a raster (a grid of values), not points, lines and shapes. Use “Raster to picture” or Reproject for it.`);
    const layers = await vectorInfo(src.G, src.ds);
    if (!layers.length) throw new Error(`${path.basename(file)} has no map layers.`);
    const from = String(opts.from || '').replace(/^epsg:/i, '').trim() || (!layers.some((l) => l.crs) && lonLatCsv(file) ? '4326' : '');
    let target = reproject ? epsgOf(opts) : '';
    if (target === 'utm') { const b = await wgsExtent(src.G, layers, from); if (!b) throw new Error('The data has no coordinate system, so its UTM zone isn’t known. Choose “Coordinates are in” first.'); target = utmFor(b); }
    if (reproject && !/^\d{4,6}$/.test(target)) throw new Error(`“${opts.epsg || opts.crs}” isn’t an EPSG code. Use a number such as 32640.`);
    if (reproject && !from && !layers.some((l) => l.crs)) throw new Error(`${path.basename(file)} doesn’t say which coordinate system it uses. Choose “Coordinates are in”, then reproject.`);
    const t = target || (to === 'kml' ? '4326' : '');
    const srs = t ? [...(from ? ['-s_srs', `EPSG:${from}`] : []), '-t_srs', `EPSG:${t}`] : from ? ['-a_srs', `EPSG:${from}`] : [];
    ctx.progress?.(0.3, 'Converting');
    const stem = U.sanitize(U.base(file).replace(/\.shp$/i, ''));
    let made;
    if (to === 'gpx') made = [await writeGpx(src, layers, srs, path.join(tmp, `${stem}.gpx`))];
    // GeoJSON holds any mix of geometry, so several layers become one file, each feature naming its layer.
    else if (to === 'geojson' && layers.length > 1 && !t) {
      const all = await asGeoJSON(src, layers, srs), p = path.join(tmp, `${stem}.geojson`);
      await fsp.writeFile(p, JSON.stringify({ type: 'FeatureCollection', features: all.flatMap((l) => l.geojson.features.map((f) => ({ ...f, properties: { layer: l.name, ...f.properties } }))) }));
      made = [p];
    }
    else if (to === 'shp') made = [await writeShapes(src, layers, srs, tmp, stem)];
    else {
      const [drv, e, lco] = DRIVER[to];
      if (!drv) throw new Error(`Lime can’t write ${to}.`);
      const parts = SINGLE.has(to) && layers.length > 1 ? layers.map((l) => [l.name]) : [[]];
      made = [];
      for (const names of parts) {
        const name = names.length ? `${stem}-${U.sanitize(names[0])}` : stem;
        const layer = names.length ? layers.find((l) => l.name === names[0]) : layers[0];
        const lcos = to === 'csv' ? ['-lco', layers.length === 1 || names.length ? (/^(3D )?Point/i.test(layer?.type || '') ? 'GEOMETRY=AS_XY' : 'GEOMETRY=AS_WKT') : 'GEOMETRY=AS_WKT'] : lco;
        const got = await translate(src.G, src.ds, ['-f', drv, ...lcos, ...srs, ...(to === 'dxf' ? ['-skipfailures'] : []), ...names], name, tmp);
        const main = got.find((p) => U.ext(p) === e) || got[0];
        if (!main) throw new Error(`GDAL wrote no ${to.toUpperCase()} file.`);
        made.push(main);
      }
    }
    ctx.progress?.(0.9, 'Saving');
    const e = outExt(to), suffix = reproject ? `-EPSG${target}` : '';
    if (made.length === 1) {
      const out = ctx.out.file(file, `${stem}${suffix}.${e}`);
      await fsp.copyFile(made[0], out);
      return { path: out, note: noteFor(layers, target) };
    }
    const dir = ctx.out.folder(file, `${stem}${suffix}`);
    for (const m of made) await fsp.copyFile(m, U.uniquePath(path.join(dir, path.basename(m))));
    return { path: dir, note: `${made.length} layers${target ? ` in EPSG:${target}` : ''}` };
  } finally { await src.done(); fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}
const noteFor = (layers, target) => `${layers.reduce((s, l) => s + (l.count || 0), 0)} features${layers.length > 1 ? ` in ${layers.length} layers` : ''}${target ? ` · EPSG:${target}` : ''}`;

// Shapefiles hold one kind of geometry each; a layer with several kinds becomes one shapefile per kind. All in one ZIP.
async function writeShapes(src, layers, srs, tmp, stem) {
  const dir = path.join(tmp, 'shp'), files = [];
  for (const l of layers) {
    const base = layers.length > 1 ? `${stem}-${U.sanitize(l.name)}` : stem;
    const mixed = !(POINTS.test(l.type) || LINES.test(l.type) || POLYS.test(l.type));
    const kinds = mixed ? [['points', "OGR_GEOMETRY IN ('POINT','MULTIPOINT')", 'MULTIPOINT'], ['lines', "OGR_GEOMETRY IN ('LINESTRING','MULTILINESTRING')", 'MULTILINESTRING'], ['polygons', "OGR_GEOMETRY IN ('POLYGON','MULTIPOLYGON')", 'MULTIPOLYGON']] : [[null]];
    for (const [k, where, nlt] of kinds) {
      const got = await translate(src.G, src.ds, ['-f', 'ESRI Shapefile', '-lco', 'ENCODING=UTF-8', ...srs, ...(where ? ['-where', where, '-nlt', nlt] : ['-nlt', 'PROMOTE_TO_MULTI']), l.name], k ? `${base}-${k}` : base, dir).catch((e) => { if (where) return []; throw e; });
      // A filtered kind that has no features leaves a shapefile with no records: leave it out.
      const shp = got.find((p) => U.ext(p) === 'shp');
      if (where && shp && fs.statSync(shp).size <= 100) { got.forEach((p) => fs.rmSync(p, { force: true })); continue; }
      files.push(...got);
    }
  }
  if (!files.some((p) => U.ext(p) === 'shp')) throw new Error('There were no features to write.');
  const zip = path.join(tmp, `${stem}.zip`);
  fs.writeFileSync(zip, require('fflate').zipSync(Object.fromEntries(files.map((p) => [path.basename(p), fs.readFileSync(p)]))));
  return zip;
}

// The data as GeoJSON in WGS 84, one FeatureCollection per layer (for GPX and the map window).
async function asGeoJSON(src, layers, srs, max = Infinity) {
  const tmp = await U.tmpDir('geojson'), out = [];
  try {
    for (const l of layers) {
      if (l.count != null && l.count > max) { out.push({ ...l, skipped: true }); continue; }
      const s = srs.filter((x, i, a) => !(x === '-t_srs' || a[i - 1] === '-t_srs')).map((x) => (x === '-a_srs' ? '-s_srs' : x));
      const [p] = await translate(src.G, src.ds, ['-f', 'GeoJSON', '-lco', 'RFC7946=YES', '-lco', 'WRITE_NAME=NO', ...s, '-t_srs', 'EPSG:4326', l.name], `l${out.length}`, tmp);
      out.push({ ...l, geojson: p ? JSON.parse(fs.readFileSync(p, 'utf8')) : { type: 'FeatureCollection', features: [] } });
    }
    return out;
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}
const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// GPX holds points (waypoints) and paths (tracks). Lines and the outlines of areas become tracks; attributes go into
// the description, and a name, ele or time field is used where GPX has a place for it.
async function writeGpx(src, layers, srs, out) {
  const all = await asGeoJSON(src, layers, srs), wpt = [], trk = [];
  const nameOf = (p) => p.name ?? p.Name ?? p.NAME ?? p.title ?? p.id ?? '';
  const desc = (p) => Object.entries(p).filter(([k]) => !/^(name|ele|time)$/i.test(k)).map(([k, v]) => `${k}: ${v}`).join('; ');
  const pt = (c, tag, p = {}) => `<${tag} lat="${+c[1].toFixed(7)}" lon="${+c[0].toFixed(7)}">${c[2] != null ? `<ele>${+c[2].toFixed(2)}</ele>` : p.ele != null ? `<ele>${xml(p.ele)}</ele>` : ''}${tag === 'wpt' ? `${p.time ? `<time>${xml(p.time)}</time>` : ''}<name>${xml(nameOf(p))}</name>${desc(p) ? `<desc>${xml(desc(p))}</desc>` : ''}` : ''}</${tag}>`;
  const lines = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
  const walk = (g, p) => {
    if (!g) return;
    if (g.type === 'GeometryCollection') return g.geometries.forEach((x) => walk(x, p));
    if (g.type === 'Point') return wpt.push(pt(g.coordinates, 'wpt', p));
    if (g.type === 'MultiPoint') return g.coordinates.forEach((c) => wpt.push(pt(c, 'wpt', p)));
    const segs = lines(g);
    if (segs.length) trk.push(`<trk><name>${xml(nameOf(p))}</name>${desc(p) ? `<desc>${xml(desc(p))}</desc>` : ''}${segs.map((s) => `<trkseg>${s.map((c) => pt(c, 'trkpt')).join('')}</trkseg>`).join('')}</trk>`);
  };
  for (const l of all) for (const f of l.geojson.features) walk(f.geometry, f.properties || {});
  if (!wpt.length && !trk.length) throw new Error('There were no points or lines to write.');
  await fsp.writeFile(out, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Lime" xmlns="http://www.topografix.com/GPX/1/1">\n${wpt.join('\n')}\n${trk.join('\n')}\n</gpx>\n`);
  return out;
}

// --- Rasters -----------------------------------------------------------------------------------------------------------
// Reads band 1 (or bands 1-3) of a raster as numbers at most `max` pixels across, optionally warped to another system.
async function rasterGrid(file, { max = 2048, to = null } = {}) {
  const src = await openFile(file);
  const G = src.G, FS = G.Module.FS, made = [];
  try {
    if (src.type !== 'raster') throw new Error(`${path.basename(file)} isn’t a raster.`);
    const j = await quiet(() => G.gdalinfo(src.ds, ['-json']));
    const [W, H] = j.size, scale = Math.min(1, max / Math.max(W, H)), w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    const bands = j.bands.length, rgb = bands >= 3 && j.bands.slice(0, 3).every((b) => b.type === 'Byte');
    let ds = src.ds;
    if (to) {
      const r = await quiet(() => G.gdalwarp(ds, ['-of', 'GTiff', '-t_srs', `EPSG:${to}`, '-r', rgb ? 'bilinear' : 'near', '-ts', String(w), '0', '-dstnodata', rgb ? '0' : '-3.4e38', ...(rgb ? ['-dstalpha'] : [])], 'warped'));
      made.push(...r.all.map((f) => f.local));
      ds = (await quiet(() => G.open(r.local))).datasets[0];
    }
    const info = await quiet(() => G.gdalinfo(ds, ['-json']));
    const [ow, oh] = to ? info.size : [w, h];
    const t = await quiet(() => G.gdal_translate(ds, ['-of', 'ENVI', '-ot', 'Float32', ...(to ? [] : ['-outsize', String(ow), String(oh)]), '-b', '1', ...(rgb ? ['-b', '2', '-b', '3'] : []), ...(rgb && to ? ['-b', String(info.bands.length)] : [])], 'grid'));
    made.push(...t.all.map((f) => f.local));
    const raw = FS.readFile(t.all.find((f) => !/\.(hdr|xml)$/.test(f.local)).local);
    const n = ow * oh, nb = raw.byteLength / 4 / n, data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    if (to) await G.close(ds);
    const gt = info.geoTransform, nodata = j.bands[0].noDataValue;
    return { w: ow, h: oh, bands: Math.round(nb), rgb, data, nodata: to ? (rgb ? null : -3.4e38) : nodata, extent: gt ? [gt[0], gt[3] + gt[5] * oh * (to ? 1 : H / oh), gt[0] + gt[1] * ow * (to ? 1 : W / ow), gt[3]] : null,
      crs: info.coordinateSystem?.projjson?.name || null, size: [W, H], type: j.bands[0].type };
  } finally { for (const f of made) { try { FS.unlink(f); } catch (_) {} } await src.done(); }
}
// Elevation colours, low to high: sea-level greens through browns to white.
const RAMP = [[0, [38, 115, 77]], [0.2, [104, 166, 92]], [0.4, [196, 207, 121]], [0.6, [214, 175, 112]], [0.8, [158, 106, 74]], [1, [245, 245, 240]]];
const rampAt = (t) => { for (let i = 1; i < RAMP.length; i++) if (t <= RAMP[i][0]) { const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i], k = (t - a) / (b - a || 1); return ca.map((v, j) => Math.round(v + (cb[j] - v) * k)); } return RAMP[RAMP.length - 1][1]; };
const isNo = (v, nodata) => !Number.isFinite(v) || v <= -3e38 || (nodata != null && v === nodata);
// Pixels for a grid: RGB bands as they are, one band through the elevation ramp with hill shading.
function colourise(g, { shade = true } = {}) {
  const { w, h, data, nodata } = g, n = w * h, px = Buffer.alloc(n * 4);
  if (g.rgb) {
    for (let i = 0; i < n; i++) { const a = g.bands >= 4 ? data[3 * n + i] : 255; px[i * 4] = data[i]; px[i * 4 + 1] = data[n + i]; px[i * 4 + 2] = data[2 * n + i]; px[i * 4 + 3] = a > 0 ? 255 : 0; }
    return { px, min: null, max: null };
  }
  const vals = [];
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 200000))) if (!isNo(data[i], nodata)) vals.push(data[i]);
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.02)] ?? 0, hi = vals[Math.floor(vals.length * 0.98)] ?? 1, span = hi - lo || 1;
  const cell = (x, y) => { const v = data[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]; return isNo(v, nodata) ? null : v; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = data[i];
    if (isNo(v, nodata)) continue;
    const c = rampAt(Math.min(1, Math.max(0, (v - lo) / span)));
    let k = 1;
    if (shade) {
      const l = cell(x - 1, y) ?? v, r = cell(x + 1, y) ?? v, u = cell(x, y - 1) ?? v, d = cell(x, y + 1) ?? v;
      const dx = (r - l) / span * 8, dy = (d - u) / span * 8, len = Math.hypot(dx, dy, 1);
      k = 0.65 + 0.35 * Math.max(0, (-dx * -0.5 + -dy * -0.5 + 0.7) / len / 1.0);
    }
    px[i * 4] = Math.min(255, c[0] * k); px[i * 4 + 1] = Math.min(255, c[1] * k); px[i * 4 + 2] = Math.min(255, c[2] * k); px[i * 4 + 3] = 255;
  }
  return { px, min: vals[0], max: vals[vals.length - 1], lo, hi };
}
// A raster as a picture: elevation and other single-band grids in colour with a legend, photos as they are.
async function picture(file, opts, ctx) {
  ctx.progress?.(0.1, 'Reading');
  const to = opts.to === 'jpg' ? 'jpg' : 'png', g = await rasterGrid(file, { max: Number(opts.size) || 4096 });
  ctx.progress?.(0.6, 'Colouring');
  const { px, min, max } = colourise(g, { shade: opts.shade !== false });
  let img = require('sharp')(px, { raw: { width: g.w, height: g.h, channels: 4 } });
  if (!g.rgb && opts.legend !== false) {
    const lh = 40, svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${g.w}" height="${lh}"><defs><linearGradient id="r">${RAMP.map(([t, c]) => `<stop offset="${t}" stop-color="rgb(${c})"/>`).join('')}</linearGradient></defs>
      <rect width="100%" height="100%" fill="#fff"/><rect x="10" y="8" width="${Math.max(20, g.w - 20)}" height="12" fill="url(#r)"/><text x="10" y="34" font-family="Helvetica, Arial" font-size="11">${fmtN(min)}</text><text x="${g.w - 10}" y="34" font-family="Helvetica, Arial" font-size="11" text-anchor="end">${fmtN(max)}</text></svg>`;
    if (g.w >= 40) img = require('sharp')(await img.png().toBuffer()).extend({ bottom: lh, background: '#ffffff' }).composite([{ input: Buffer.from(svg), top: g.h, left: 0 }]);
  }
  const out = ctx.out.file(file, `${U.base(file)}.${to}`);
  await (to === 'jpg' ? img.flatten({ background: '#ffffff' }).jpeg({ quality: 90 }) : img.png()).toFile(out);
  return { path: out, note: g.rgb ? `${g.w} × ${g.h}` : `${g.w} × ${g.h} · values ${fmtN(min)} to ${fmtN(max)}` };
}
// A raster into another coordinate system, as GeoTIFF.
async function warp(file, opts, ctx) {
  let target = epsgOf(opts);
  const src = await openFile(file);
  const tmp = await U.tmpDir('warp');
  try {
    if (src.type !== 'raster') throw new Error(`${path.basename(file)} isn’t a raster.`);
    const j = await quiet(() => src.G.gdalinfo(src.ds, ['-json']));
    const from = String(opts.from || '').trim();
    if (!j.coordinateSystem?.wkt && !from) throw new Error(`${path.basename(file)} doesn’t say which coordinate system it uses. Choose “Coordinates are in”, then reproject.`);
    if (target === 'utm') { const c = j.wgs84Extent?.coordinates?.[0]; if (!c) throw new Error('The raster’s position isn’t known, so its UTM zone isn’t either.'); target = utmFor([Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))]); }
    if (!/^\d{4,6}$/.test(target)) throw new Error(`“${opts.epsg || opts.crs}” isn’t an EPSG code. Use a number such as 32640.`);
    ctx.progress?.(0.3, 'Reprojecting');
    const r = await quiet(() => src.G.gdalwarp(src.ds, ['-of', 'GTiff', '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', ...(from ? ['-s_srs', `EPSG:${from}`] : []), '-t_srs', `EPSG:${target}`, '-r', 'bilinear'], 'warped'));
    const [made] = copyOut(src.G, r.all.map((f) => f.local), tmp);
    const out = ctx.out.file(file, `${U.base(file)}-EPSG${target}.tif`);
    await fsp.copyFile(made, out);
    return { path: out, note: `EPSG:${target}` };
  } finally { await src.done(); fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}
const reproject = (file, opts, ctx) => (S.kind(file) === 'raster' ? warp(file, opts, ctx) : convert(file, { ...opts, to: sameFormat(file) }, ctx, { reproject: true }));
// The format a reprojected file keeps: its own where GDAL can write it.
function sameFormat(file) {
  const e = U.ext(file);
  return { geojson: 'geojson', json: 'geojson', gpkg: 'gpkg', shp: 'shp', zip: 'shp', csv: 'csv', tsv: 'csv', txt: 'csv', dxf: 'dxf', gml: 'gml', fgb: 'fgb' }[e] || 'gpkg';
}
const reprojectExt = (file) => (S.kind(file) === 'raster' ? 'tif' : outExt(sameFormat(file)));

// --- The map window ----------------------------------------------------------------------------------------------------
// Layers for the map: vectors as GeoJSON in WGS 84, rasters as a picture in Web Mercator with their values for identify.
async function mapLayers(file, opts = {}) {
  const kind = S.kind(file) || (await describe(file)).kind;
  if (kind === 'raster') {
    const g = await rasterGrid(file, { max: 2048, to: '3857' });
    const { px, min, max } = colourise(g, { shade: true });
    const png = await require('sharp')(px, { raw: { width: g.w, height: g.h, channels: 4 } }).png().toBuffer();
    const s = Math.max(1, Math.ceil(Math.max(g.w, g.h) / 512)), vw = Math.ceil(g.w / s), vh = Math.ceil(g.h / s), values = g.rgb ? null : new Float32Array(vw * vh);
    if (values) for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) { const v = g.data[Math.min(g.h - 1, y * s) * g.w + Math.min(g.w - 1, x * s)]; values[y * vw + x] = isNo(v, g.nodata) ? NaN : v; }
    const d = await describe(file).catch(() => null);
    return { kind: 'raster', name: path.basename(file), png: `data:image/png;base64,${png.toString('base64')}`, extent: g.extent, min, max, rgb: g.rgb, values: values && { w: vw, h: vh, data: Array.from(values, (v) => (Number.isNaN(v) ? null : +v.toFixed(3))) }, info: d };
  }
  const src = await openFile(file, openOf(file));
  try {
    const layers = await vectorInfo(src.G, src.ds);
    const from = String(opts.from || '').trim() || (!layers.some((l) => l.crs) && lonLatCsv(file) ? '4326' : '');
    if (!from && !layers.some((l) => l.crs)) {
      const b = await wgsExtent(src.G, layers, null);
      if (!b) return { kind: 'vector', name: path.basename(file), needCrs: true, layers: layers.map(({ crs, ...l }) => l) };
    }
    const got = await asGeoJSON(src, layers, from ? ['-s_srs', `EPSG:${from}`] : [], 200000);
    return { kind: 'vector', name: path.basename(file), layers: got.map(({ crs, ...l }) => ({ ...l, crs: crs ? { name: crs.name, epsg: crs.epsg } : null })) };
  } finally { await src.done(); }
}
const basemapFile = () => [process.env.LIME_GEO && path.join(process.env.LIME_GEO, 'basemap.json.br'), process.resourcesPath && path.join(process.resourcesPath, 'geo', 'basemap.json.br'), path.join(__dirname, '../../../vendor/geo/basemap.json.br'), U.cfg.geo && path.join(U.cfg.geo, 'basemap.json.br')].find((f) => f && fs.existsSync(f));
async function basemap() {
  const f = basemapFile();
  if (!f) return null;
  return require('zlib').brotliDecompressSync(await fsp.readFile(f)).toString('utf8');
}
// WKT for EPSG codes, for the coordinate readout's own conversions.
async function crsWkt(codes) {
  const G = await gdal(), M = G.Module, out = {};
  for (const c of [].concat(codes)) {
    const srs = M.ccall('OSRNewSpatialReference', 'number', ['string'], ['']);
    try {
      if (M.ccall('OSRSetFromUserInput', 'number', ['number', 'string'], [srs, `EPSG:${c}`]) !== 0) continue;
      const pp = M._malloc(4);
      M.ccall('OSRExportToWkt', 'number', ['number', 'number'], [srs, pp]);
      out[c] = M.UTF8ToString(M.getValue(pp, '*'));
      M._free(pp);
    } finally { M.ccall('OSRDestroySpatialReference', null, ['number'], [srs]); }
  }
  return out;
}
// The map view as a PDF page: the picture, a title, scale and coordinate system.
async function mapPdf(target, { png, title, scale, crs, width, height, note }) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const doc = await PDFDocument.create(), img = await doc.embedPng(Buffer.from(String(png).replace(/^data:image\/png;base64,/, ''), 'base64'));
  const land = (width || img.width) >= (height || img.height), W = land ? 1190.55 : 841.89, H = land ? 841.89 : 1190.55, m = 36, foot = 54;
  const page = doc.addPage([W, H]), font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const k = Math.min((W - 2 * m) / img.width, (H - 2 * m - foot) / img.height), iw = img.width * k, ih = img.height * k;
  page.drawImage(img, { x: (W - iw) / 2, y: m + foot + (H - 2 * m - foot - ih) / 2, width: iw, height: ih });
  page.drawRectangle({ x: (W - iw) / 2, y: m + foot + (H - 2 * m - foot - ih) / 2, width: iw, height: ih, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.6 });
  page.drawText(String(title || 'Map').slice(0, 120), { x: m, y: m + 30, size: 14, font: bold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText([scale, crs, note, `Made with Lime · ${new Date().toISOString().slice(0, 10)}`].filter(Boolean).join('   ·   ').slice(0, 200), { x: m, y: m + 12, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  doc.setTitle(String(title || 'Map'));
  doc.setCreator('Lime');
  await fsp.writeFile(target, await doc.save());
  return { path: target };
}
const write = (target, data) => require('../diagrams').write(target, data);

const crsList = () => CRS;
module.exports = { crsList, gdal, describe, info, infoText, convert, reproject, reprojectExt, picture, warp, mapLayers, basemap, basemapFile, crsWkt, mapPdf, write, colourise, rasterGrid, CRS, FORMATS, outExt, sameFormat, utmFor };
