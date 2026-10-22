'use strict';
// Engineering: map data (GIS), hydrology models and results, and project schedules. Tools and wheel slices, added to
// tools.js in one place, like diagramtools.js.
const U = require('./engines/util');
const S = require('./engines/geosniff');
const geo = () => require('./engines/geo'), hydro = () => require('./engines/hydro'), proj = () => require('./engines/project');

// Files that are map, hydrology or schedule data although their extension says otherwise.
function groupOf(p, e) {
  if ((e === 'tif' || e === 'tiff') && S.geotiff(p)) return 'gis';
  if (e === 'asc' && S.ascGrid(p)) return 'gis';
  if (e === 'out' && S.swmmOut(p)) return 'hydro';
  if (e === 'xml' && S.msProject(p)) return 'project';
  return null;
}
const GEO_EXTRA = ['csv', 'tsv', 'txt', 'zip', 'json', 'dxf', 'tif', 'tiff', 'asc', 'img', 'jpg', 'jpeg', 'png'];
const all = (fn) => (files) => files.every(fn);
const vector = all((f) => S.kind(f) === 'vector'), raster = all((f) => S.kind(f) === 'raster'), anyGeo = all((f) => !!S.kind(f));
const swmm = all((f) => S.swmmInp(f) || S.swmmOut(f)), swmmIn = all((f) => S.swmmInp(f)), ras = all((f) => S.rasHdf(f) || (S.hdf5(f) && /\.hdf$/i.test(f))), dss = all((f) => S.dss(f));
const msp = all((f) => U.ext(f) !== 'xml' || S.msProject(f));
const hydroAny = all((f) => S.swmmInp(f) || S.swmmOut(f) || S.rasHdf(f) || S.dss(f));

function register({ TOOLS, WHEELS, EDITOR_FILE, W, each }) {
  EDITOR_FILE.map = 'vendor/geo/maplibs.js';
  const G = geo, crs = G().CRS;
  const crsOpts = (def = '4326') => [{ key: 'crs', type: 'select', label: 'Into', choices: crs, default: def }, { key: 'epsg', type: 'text', label: 'EPSG code', default: '', placeholder: 'e.g. 32640', required: true, when: { crs: 'custom' } }];
  const from = { key: 'from', type: 'select', label: 'Coordinates are in', choices: [['', 'As the file says (or latitude, longitude)'], ...crs.filter(([v]) => !['utm', 'custom'].includes(v))], default: '', advanced: true };
  const to = (choices, def, extra = {}) => ({ key: 'to', type: 'choice', label: 'Format', choices, default: def, ...extra });
  const base = (files) => U.base(files[0] || 'map');
  TOOLS.push(
    { id: 'open-map', cat: 'eng', name: 'Maps', desc: 'See map data on an offline basemap: layers, styles, attributes, identify, measure, and export the view as PNG or PDF.', tags: 'gis qgis map geojson shapefile kml gpx geopackage geotiff layers', accepts: ['gis'], extAccept: GEO_EXTRA, ok: anyGeo, max: 1, editor: 'map' },
    { id: 'geo-convert', cat: 'eng', name: 'Convert map data', desc: 'GeoJSON, shapefile, KML, GPX, GeoPackage, CSV with coordinates, DXF, GML or FlatGeobuf, with GDAL.', tags: 'gis gdal ogr2ogr shapefile kml kmz gpx geopackage gpkg geojson dxf csv', accepts: ['gis'], extAccept: GEO_EXTRA, ok: vector,
      ext: (o) => G().outExt(o.to), options: [to(G().FORMATS, 'geojson'), from], run: each((f, o, c) => G().convert(f, o, c)) },
    { id: 'geo-reproject', cat: 'eng', name: 'Reproject', desc: 'Into another coordinate system: WGS 84, UTM, Dubai Local TM or any EPSG code. Rasters become GeoTIFF.', tags: 'gis crs epsg projection utm dltm wgs84 coordinate system transform warp', accepts: ['gis'], extAccept: GEO_EXTRA, ok: anyGeo, suffix: '-reprojected',
      ext: (o, files) => G().reprojectExt(files[0] || ''), options: [...crsOpts('4326'), from], run: each((f, o, c) => G().reproject(f, o, c)) },
    { id: 'geo-info', cat: 'eng', name: 'Layer info', desc: 'Coordinate system, layers, feature counts, fields and extent; a raster’s size, bands and values.', tags: 'gis crs fields extent ogrinfo gdalinfo', accepts: ['gis'], extAccept: GEO_EXTRA, ok: anyGeo, save: 'none',
      options: [{ key: 'save', type: 'toggle', label: 'Save a report', default: false }], run: each((f, o, c) => G().info(f, o, c)) },
    { id: 'geo-picture', cat: 'eng', name: 'Raster to picture', desc: 'Elevation and other grids in colour, with hill shading and a legend; aerial photos as they are.', tags: 'geotiff dem elevation hillshade raster png jpg preview', accepts: ['gis'], extAccept: ['tif', 'tiff', 'asc'], ok: raster,
      ext: (o) => (o.to === 'jpg' ? 'jpg' : 'png'), options: [to([['png', 'PNG'], ['jpg', 'JPG']], 'png'), { key: 'shade', type: 'toggle', label: 'Hill shading', default: true }, { key: 'legend', type: 'toggle', label: 'Legend', default: true, advanced: true }], run: each((f, o, c) => G().picture(f, o, c)) },

    { id: 'open-hydro', cat: 'eng', name: 'Hydrology', desc: 'Run a SWMM model and see its hydrographs and network, or browse HEC-RAS and HEC-DSS results.', tags: 'swmm hec-ras hec-hms dss hydrograph stormwater drainage flood', accepts: ['hydro'], ok: hydroAny, max: 1, editor: 'hydro' },
    { id: 'swmm-run', cat: 'eng', name: 'Run SWMM model', desc: 'Runs an EPA SWMM 5.2 model and saves its report, with the continuity errors and peak outflow.', tags: 'swmm epa stormwater drainage rainfall runoff routing inp report', accepts: ['hydro'], ok: swmmIn, engine: 'swmm5', ext: 'rpt', run: each((f, o, c) => hydro().swmmRun(f, o, c)) },
    { id: 'swmm-results', cat: 'eng', name: 'SWMM results', desc: 'Every node, link and subcatchment over time, with a summary of peaks, as Excel or CSV.', tags: 'swmm results hydrograph flow depth excel csv', accepts: ['hydro'], ok: swmm, engine: 'swmm5', ext: (o) => (o.to === 'csv' ? 'csv' : 'xlsx'),
      outName: (files, o) => `${base(files)}-${o.to === 'csv' ? o.what || 'link-flow' : 'results'}.${o.to === 'csv' ? 'csv' : 'xlsx'}`,
      options: [to([['xlsx', 'Excel'], ['csv', 'CSV']], 'xlsx'), { key: 'what', type: 'select', label: 'Quantity', choices: [['link-flow', 'Link flow'], ['link-velocity', 'Link velocity'], ['link-capacity', 'Capacity used'], ['node-depth', 'Node depth'], ['node-inflow', 'Node inflow'], ['node-flooding', 'Flooding'], ['sub-runoff', 'Runoff'], ['sub-rainfall', 'Rainfall']], default: 'link-flow', when: { to: 'csv' } }],
      run: each((f, o, c) => hydro().swmmExport(f, o, c)) },
    { id: 'swmm-plot', cat: 'eng', name: 'Hydrographs', desc: 'Flow or depth over time for the largest outfalls, links, nodes or subcatchments, with the rainfall.', tags: 'swmm hydrograph chart plot flow depth png svg', accepts: ['hydro'], ok: swmm, engine: 'swmm5', ext: (o) => (o.to === 'svg' ? 'svg' : 'png'),
      outName: (files, o) => `${base(files)}-${o.what || 'outfalls'}.${o.to === 'svg' ? 'svg' : 'png'}`,
      options: [to([['png', 'PNG'], ['svg', 'SVG']], 'png'), { key: 'what', type: 'choice', label: 'Show', choices: [['outfalls', 'Outfalls'], ['links', 'Links'], ['nodes', 'Node depth'], ['subcatchments', 'Runoff']], default: 'outfalls' }], run: each((f, o, c) => hydro().swmmPlot(f, o, c)) },
    { id: 'ras-table', cat: 'eng', name: 'HEC-RAS water levels', desc: 'Water surface, depth, flow and velocity at each cross section for every profile, from a plan’s results (.p01.hdf).', tags: 'hec-ras hdf profile water surface elevation cross section excel csv', accepts: ['hydro'], ok: ras,
      ext: (o) => (o.to === 'csv' ? 'csv' : 'xlsx'), outName: (files, o) => `${base(files)}-profiles.${o.to === 'csv' ? 'csv' : 'xlsx'}`, options: [to([['xlsx', 'Excel'], ['csv', 'CSV']], 'xlsx')], run: each((f, o, c) => hydro().rasTable(f, o, c)) },
    { id: 'ras-plot', cat: 'eng', name: 'HEC-RAS profile plot', desc: 'The water surface of every profile along the reach, over the channel bed.', tags: 'hec-ras profile plot water surface png svg', accepts: ['hydro'], ok: ras,
      ext: (o) => (o.to === 'svg' ? 'svg' : 'png'), outName: (files, o) => `${base(files)}-profile.${o.to === 'svg' ? 'svg' : 'png'}`, options: [to([['png', 'PNG'], ['svg', 'SVG']], 'png')], run: each((f, o, c) => hydro().rasPlot(f, o, c)) },
    { id: 'ras-info', cat: 'eng', name: 'HEC-RAS plan info', desc: 'The plan, its cross sections and profiles, and the highest water levels.', tags: 'hec-ras plan info', accepts: ['hydro'], ok: ras, save: 'none', run: each((f, o, c) => hydro().rasInfo(f, o, c)) },
    { id: 'dss-export', cat: 'eng', name: 'DSS time series', desc: 'HEC-DSS time series (HEC-HMS and HEC-RAS results) as Excel or CSV, one column per record.', tags: 'hec-dss dss hec-hms time series hydrograph excel csv', accepts: ['hydro'], ok: dss, engine: 'dsstool',
      ext: (o) => (o.to === 'csv' ? 'csv' : 'xlsx'), options: [to([['xlsx', 'Excel'], ['csv', 'CSV']], 'xlsx'), { key: 'filter', type: 'text', label: 'Only records containing', default: '', placeholder: 'e.g. FLOW or OUTLET', advanced: true }], run: each((f, o, c) => hydro().dssExport(f, o, c)) },
    { id: 'dss-plot', cat: 'eng', name: 'DSS plot', desc: 'HEC-DSS time series as a chart: flows first, or the records you name.', tags: 'hec-dss dss hec-hms hydrograph chart png svg', accepts: ['hydro'], ok: dss, engine: 'dsstool',
      ext: (o) => (o.to === 'svg' ? 'svg' : 'png'), outName: (files, o) => `${base(files)}-plot.${o.to === 'svg' ? 'svg' : 'png'}`, options: [to([['png', 'PNG'], ['svg', 'SVG']], 'png'), { key: 'filter', type: 'text', label: 'Only records containing', default: '', placeholder: 'FLOW', advanced: true }], run: each((f, o, c) => hydro().dssPlot(f, o, c)) },
    { id: 'dss-info', cat: 'eng', name: 'DSS catalogue', desc: 'Every record in a HEC-DSS file.', tags: 'hec-dss catalog pathnames', accepts: ['hydro'], ok: dss, engine: 'dsstool', save: 'none', run: each((f, o, c) => hydro().dssInfo(f, o, c)) },

    { id: 'project-convert', cat: 'eng', name: 'Convert schedule', desc: 'Microsoft Project, ProjectLibre, Primavera P6 or GanttProject files to an Excel or CSV task list, MS Project XML or MPX.', tags: 'mpp microsoft project projectlibre pod primavera xer schedule tasks excel', accepts: ['project'], ok: msp, engine: 'projectlibre',
      ext: (o) => o.to || 'xlsx', outName: (files, o) => `${base(files)}${['xlsx', 'csv'].includes(o.to || 'xlsx') ? '-tasks' : U.ext(files[0] || '') === o.to ? '-converted' : ''}.${o.to || 'xlsx'}`,
      options: [to([['xlsx', 'Excel task list'], ['csv', 'CSV task list'], ['xml', 'MS Project XML'], ['mpx', 'MPX']], 'xlsx')], run: each((f, o, c) => proj().convert(f, o, c)) },
    { id: 'project-gantt', cat: 'eng', name: 'Gantt chart', desc: 'The schedule as a Gantt chart with links, progress and resources.', tags: 'gantt chart schedule mpp microsoft project timeline pdf png', accepts: ['project'], ok: msp, engine: 'projectlibre',
      ext: (o) => o.to || 'pdf', outName: (files, o) => `${base(files)}-gantt.${o.to || 'pdf'}`, options: [to([['pdf', 'PDF'], ['png', 'PNG'], ['svg', 'SVG']], 'pdf')], run: each((f, o, c) => proj().gantt(f, o, c)) },
    { id: 'project-info', cat: 'eng', name: 'Schedule info', desc: 'Dates, tasks, milestones, progress and resources.', tags: 'mpp schedule summary', accepts: ['project'], ok: msp, engine: 'projectlibre', save: 'none', run: each((f, o, c) => proj().info(f, o, c)) },
  );
  const mapW = W('open-map', 'Map', 'Open'), infoW = W('geo-info', 'Info', 'Layers');
  WHEELS.gis = {
    convert: [W('geo-convert', 'GeoJSON', 'Web', { to: 'geojson' }, { not: ['geojson'] }), W('geo-convert', 'KML', 'Google Earth', { to: 'kml' }, { not: ['kml'] }), W('geo-convert', 'SHP', 'Shapefile', { to: 'shp' }, { not: ['shp'] }), W('geo-convert', 'GPKG', 'GeoPackage', { to: 'gpkg' }, { not: ['gpkg'] }),
      W('geo-convert', 'GPX', 'GPS', { to: 'gpx' }, { not: ['gpx'] }), W('geo-convert', 'CSV', 'Table', { to: 'csv' }), W('geo-convert', 'DXF', 'CAD', { to: 'dxf' }), W('geo-picture', 'PNG', 'Colour', { to: 'png' }), W('geo-picture', 'JPG', 'Picture', { to: 'jpg' }),
      W('geo-reproject', 'WGS 84', 'Lat, long', { crs: '4326' }), W('geo-reproject', 'DLTM', 'Dubai', { crs: '3997' })],
    tools: [mapW, infoW, W('geo-reproject', 'Reproject', 'EPSG', {}, { ask: true }), W('geo-reproject', 'UTM', 'Metres', { crs: 'utm' }), W('geo-convert', 'Convert', 'Options', {}, { ask: true }), W('create-archive', 'ZIP', 'Archive', { format: 'zip' }), W('file-hash', 'Checksum', 'Verify')],
  };
  // Map data hiding in other kinds of file: a CSV of coordinates, a zipped shapefile, GeoJSON saved as .json, a DXF.
  const extra = (list, only) => list.map((w) => ({ ...w, only }));
  WHEELS.sheet.tools.unshift(...extra([W('open-map', 'Map', 'Points'), W('geo-convert', 'GeoJSON', 'Map data', { to: 'geojson' }), W('geo-convert', 'KML', 'Google Earth', { to: 'kml' })], ['csv', 'tsv']));
  WHEELS.archive.tools.unshift(...extra([mapW, W('geo-convert', 'GeoJSON', 'Shapefile', { to: 'geojson' }), W('geo-convert', 'GPKG', 'GeoPackage', { to: 'gpkg' }), infoW], ['zip']));
  WHEELS.data.tools.unshift(...extra([mapW, W('geo-convert', 'SHP', 'Shapefile', { to: 'shp' }), W('geo-convert', 'KML', 'Google Earth', { to: 'kml' })], ['json']));
  WHEELS.cad2d.tools.push(...extra([W('geo-convert', 'GIS', 'Shapefile', { to: 'shp' }, { ask: true }), W('geo-convert', 'GeoJSON', 'GIS', { to: 'geojson' }, { ask: true })], ['dxf']));
  WHEELS.hydro = {
    convert: [W('swmm-run', 'Run', 'Report'), W('swmm-results', 'XLSX', 'Results', { to: 'xlsx' }), W('swmm-plot', 'PNG', 'Hydrographs', { to: 'png', what: 'outfalls' }), W('swmm-results', 'CSV', 'Link flow', { to: 'csv', what: 'link-flow' }),
      W('ras-table', 'XLSX', 'Water levels', { to: 'xlsx' }), W('ras-plot', 'PNG', 'Profile', { to: 'png' }), W('ras-table', 'CSV', 'Water levels', { to: 'csv' }),
      W('dss-export', 'XLSX', 'Time series', { to: 'xlsx' }), W('dss-plot', 'PNG', 'Chart', { to: 'png' }), W('dss-export', 'CSV', 'Time series', { to: 'csv' })],
    tools: [W('open-hydro', 'Open', 'Hydrology'), W('swmm-plot', 'Links', 'Flows', { to: 'png', what: 'links' }), W('swmm-plot', 'Depths', 'Nodes', { to: 'png', what: 'nodes' }), W('ras-info', 'Info', 'Plan'), W('dss-info', 'Records', 'Catalogue'), W('ras-plot', 'SVG', 'Profile', { to: 'svg' }),
      W('create-archive', 'ZIP', 'Archive', { format: 'zip' }), W('file-hash', 'Checksum', 'Verify')],
  };
  WHEELS.project = {
    convert: [W('project-convert', 'XLSX', 'Task list', { to: 'xlsx' }), W('project-gantt', 'PDF', 'Gantt', { to: 'pdf' }), W('project-gantt', 'PNG', 'Gantt', { to: 'png' }), W('project-convert', 'XML', 'MS Project', { to: 'xml' }, { not: ['xml'] }), W('project-convert', 'CSV', 'Task list', { to: 'csv' }), W('project-convert', 'MPX', 'Exchange', { to: 'mpx' }, { not: ['mpx'] })],
    tools: [W('project-info', 'Info', 'Dates'), W('project-gantt', 'SVG', 'Gantt', { to: 'svg' }), W('create-archive', 'ZIP', 'Archive', { format: 'zip' }), W('file-hash', 'Checksum', 'Verify')],
  };
}
// Whether a tool's engine is in this build (the SWMM and DSS WebAssembly, or ProjectLibre's Java runtime).
function engineReady(id) {
  if (id === 'projectlibre') { const m = require('./engines/crafts').bundledManifest(); return !!(m.java && m.projectlibre); }
  return hydro().have(id);
}
module.exports = { register, groupOf, engineReady };
