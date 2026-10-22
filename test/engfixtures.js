'use strict';
// Sample engineering files, all made here: map data around a Dubai plot (GeoJSON, a shapefile, KML/KMZ, GPX, a
// GeoPackage, CSVs with coordinates, a DEM as GeoTIFF and ASCII grid), a small SWMM stormwater model, a HEC-RAS style
// results file (HDF5), a HEC-DSS file with hydrographs, and an MS Project schedule. Used by engineering.test.js.
const fs = require('fs');
const path = require('path');

const LON = 55.2708, LAT = 25.2048;
const SITE = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Site office', kind: 'building', storeys: 2 }, geometry: { type: 'Point', coordinates: [LON, LAT] } },
    { type: 'Feature', properties: { name: 'Gate', kind: 'access', storeys: 0 }, geometry: { type: 'Point', coordinates: [LON + 0.004, LAT - 0.002] } },
    { type: 'Feature', properties: { name: 'Access road', kind: 'road', storeys: 0 }, geometry: { type: 'LineString', coordinates: [[LON - 0.006, LAT - 0.004], [LON, LAT - 0.001], [LON + 0.006, LAT + 0.002]] } },
    { type: 'Feature', properties: { name: 'Plot A', kind: 'plot', storeys: 4 }, geometry: { type: 'Polygon', coordinates: [[[LON - 0.002, LAT + 0.001], [LON + 0.002, LAT + 0.001], [LON + 0.002, LAT + 0.004], [LON - 0.002, LAT + 0.004], [LON - 0.002, LAT + 0.001]]] } },
  ],
};
const PLOTS = {
  type: 'FeatureCollection',
  features: [0, 1, 2].map((i) => ({ type: 'Feature', properties: { plot: `P-${101 + i}`, area_m2: 1200 + i * 150, zone: i === 2 ? 'Commercial' : 'Residential' },
    geometry: { type: 'Polygon', coordinates: [[[LON + i * 0.0012, LAT - 0.006], [LON + i * 0.0012 + 0.001, LAT - 0.006], [LON + i * 0.0012 + 0.001, LAT - 0.005], [LON + i * 0.0012, LAT - 0.005], [LON + i * 0.0012, LAT - 0.006]]] } })),
};
const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Survey</name>
<Placemark><name>Benchmark BM1</name><description>Level 4.215 m DMD</description><Point><coordinates>${LON - 0.001},${LAT + 0.0005},0</coordinates></Point></Placemark>
<Placemark><name>Benchmark BM2</name><description>Level 3.980 m DMD</description><Point><coordinates>${LON + 0.003},${LAT - 0.0015},0</coordinates></Point></Placemark>
<Placemark><name>Drain line</name><LineString><coordinates>${LON - 0.004},${LAT},0 ${LON},${LAT - 0.0005},0 ${LON + 0.004},${LAT - 0.001},0</coordinates></LineString></Placemark>
</Document></kml>`;
const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Lime test" xmlns="http://www.topografix.com/GPX/1/1">
<wpt lat="${LAT}" lon="${LON}"><ele>5.2</ele><name>Start</name></wpt>
<trk><name>Site walk</name><trkseg>${Array.from({ length: 12 }, (_, i) => `<trkpt lat="${(LAT + i * 0.0003).toFixed(6)}" lon="${(LON + Math.sin(i / 2) * 0.0008).toFixed(6)}"><ele>${(5 + i * 0.2).toFixed(1)}</ele></trkpt>`).join('')}</trkseg></trk>
</gpx>`;
const CSV_LL = `id,name,latitude,longitude,level_m\n1,Borehole BH1,${LAT},${LON},4.1\n2,Borehole BH2,${LAT + 0.001},${LON + 0.0015},4.3\n3,Borehole BH3,${LAT - 0.0012},${LON + 0.002},3.9\n`;
// The same boreholes in Dubai Local TM (EPSG:3997) metres.
const CSV_XY = 'id,name,easting,northing\n1,BH1,493697.76,2788742.23\n2,BH2,493849.10,2788853.20\n3,BH3,493899.70,2788609.40\n';

const W = 60, H = 40;
const DEM = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => 2 + 0.15 * x + 6 * Math.exp(-(((x - 40) ** 2) + ((y - 15) ** 2)) / 60)));
const ASC = `ncols ${W}\nnrows ${H}\nxllcorner ${LON - 0.015}\nyllcorner ${LAT - 0.01}\ncellsize 0.0005\nNODATA_value -9999\n${DEM.map((r) => r.map((v) => v.toFixed(2)).join(' ')).join('\n')}\n`;

// A small SWMM 5.2 model: three subcatchments draining through pipes and a channel to an outfall in a 2-hour storm.
const INP = fs.readFileSync(path.join(__dirname, 'samples', 'eng', 'plot-drainage.inp'), 'utf8');

const MSP = fs.readFileSync(path.join(__dirname, 'samples', 'eng', 'villa-works.xml'), 'utf8');

async function geoFiles(out) {
  const geo = require('../src/main/engines/geo');
  const f = (n, s) => { const p = path.join(out, n); fs.writeFileSync(p, s); return p; };
  const files = { geojson: f('site.geojson', JSON.stringify(SITE)), plotsJson: f('plots.json', JSON.stringify(PLOTS)), kml: f('survey.kml', KML), gpx: f('walk.gpx', GPX), csv: f('boreholes.csv', CSV_LL), csvXY: f('boreholes-dltm.csv', CSV_XY), asc: f('dem.asc', ASC) };
  const { zipSync, strToU8, unzipSync } = require('fflate');
  files.kmz = f('survey.kmz', zipSync({ 'doc.kml': strToU8(KML) }));
  const ctx = { progress: () => {}, out: { file: (s, n) => path.join(out, n), folder: (s, n) => { const d = path.join(out, n); fs.mkdirSync(d, { recursive: true }); return d; } } };
  const zip = await geo.convert(files.plotsJson, { to: 'shp' }, ctx);
  files.shpZip = path.join(out, 'plots-shp.zip');
  fs.renameSync(zip.path, files.shpZip);
  const shp = path.join(out, 'shapefile');
  fs.mkdirSync(shp, { recursive: true });
  for (const [n, d] of Object.entries(unzipSync(fs.readFileSync(files.shpZip)))) fs.writeFileSync(path.join(shp, n), d);
  files.shp = path.join(shp, 'plots.shp');
  const gp = await geo.convert(files.geojson, { to: 'gpkg' }, ctx);
  files.gpkg = path.join(out, 'site-layers.gpkg');
  fs.renameSync(gp.path, files.gpkg);
  const tif = await geo.warp(files.asc, { crs: '4326', from: '4326' }, ctx);
  files.tif = path.join(out, 'dem.tif');
  fs.renameSync(tif.path, files.tif);
  return files;
}
function hydroFiles(out) {
  const f = (n, s) => { const p = path.join(out, n); fs.writeFileSync(p, s); return p; };
  return { inp: f('plot-drainage.inp', INP), msp: f('villa-works.xml', MSP) };
}
module.exports = { geoFiles, hydroFiles, SITE, PLOTS, LON, LAT, DEM, W, H };
