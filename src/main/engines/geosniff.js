'use strict';
// Quick looks inside files that may or may not be map data (a CSV with coordinates, a TIFF with a map position, a ZIP
// holding a shapefile, JSON that is GeoJSON), so the wheel can offer the map tools for them. Reads a few KB at most.
const fs = require('fs');
const path = require('path');

const head = (p, n = 8192) => { try { const fd = fs.openSync(p, 'r'), b = Buffer.alloc(n), got = fs.readSync(fd, b, 0, n, 0); fs.closeSync(fd); return b.subarray(0, got); } catch (_) { return Buffer.alloc(0); } };
const tail = (p, n = 65536) => { try { const fd = fs.openSync(p, 'r'), size = fs.fstatSync(fd).size, len = Math.min(n, size), b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, size - len); fs.closeSync(fd); return b; } catch (_) { return Buffer.alloc(0); } };
const ext = (p) => path.extname(p || '').slice(1).toLowerCase();
const memo = new Map();
const cached = (key, p, fn) => {
  let st;
  try { st = fs.statSync(p); } catch (_) { return false; }
  const k = `${key}|${p}|${st.size}|${st.mtimeMs}`;
  if (!memo.has(k)) { if (memo.size > 500) memo.clear(); memo.set(k, fn()); }
  return memo.get(k);
};

const X = /^(x|lon|long|lng|longitude|easting|east|e|x_coord|xcoord|point_x|coord_x)$/, Y = /^(y|lat|latitude|northing|north|n|y_coord|ycoord|point_y|coord_y)$/;
// Which columns of a CSV hold the coordinates, or null. "wkt" or "geometry" columns count too.
function csvColumns(p) {
  return cached('csv', p, () => {
    const t = head(p, 4096).toString('utf8').replace(/^﻿/, '');
    const line = t.split(/\r?\n/)[0] || '', sep = [',', ';', '\t', '|'].sort((a, b) => line.split(b).length - line.split(a).length)[0];
    const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase());
    const x = cols.find((c) => X.test(c)), y = cols.find((c) => Y.test(c)), wkt = cols.find((c) => /^(wkt|geometry|geom|the_geom)$/.test(c));
    return (x && y) || wkt ? { x, y, wkt, sep } : null;
  });
}
// A TIFF with GeoTIFF tags (ModelPixelScale, ModelTiepoint, ModelTransformation or GeoKeyDirectory).
function geotiff(p) {
  return cached('tif', p, () => {
    const fd = (() => { try { return fs.openSync(p, 'r'); } catch (_) { return null; } })();
    if (fd == null) return false;
    try {
      const b = Buffer.alloc(16);
      fs.readSync(fd, b, 0, 16, 0);
      const le = b.toString('latin1', 0, 2) === 'II', u16 = (x, o) => (le ? x.readUInt16LE(o) : x.readUInt16BE(o)), u32 = (x, o) => (le ? x.readUInt32LE(o) : x.readUInt32BE(o));
      const magic = u16(b, 2);
      if (!['II', 'MM'].includes(b.toString('latin1', 0, 2)) || (magic !== 42 && magic !== 43)) return false;
      const big = magic === 43;
      const off = big ? Number(le ? b.readBigUInt64LE(8) : b.readBigUInt64BE(8)) : u32(b, 4);
      const nb = Buffer.alloc(8);
      fs.readSync(fd, nb, 0, big ? 8 : 2, off);
      const n = Math.min(big ? Number(le ? nb.readBigUInt64LE(0) : nb.readBigUInt64BE(0)) : u16(nb, 0), 4096), size = big ? 20 : 12;
      const ents = Buffer.alloc(n * size);
      fs.readSync(fd, ents, 0, ents.length, off + (big ? 8 : 2));
      for (let i = 0; i < n; i++) if ([33550, 33922, 34264, 34735].includes(u16(ents, i * size))) return true;
      return false;
    } catch (_) { return false; } finally { fs.closeSync(fd); }
  });
}
// Names inside a ZIP, from its central directory.
function zipNames(p) {
  const b = tail(p, 262144), names = [];
  for (let i = b.length - 22; i >= 0; i--) {
    if (b.readUInt32LE(i) !== 0x06054b50) continue;
    let at = b.readUInt32LE(i + 16) - (fs.statSync(p).size - b.length);
    const count = b.readUInt16LE(i + 10);
    for (let k = 0; k < count && at >= 0 && at + 46 <= b.length && b.readUInt32LE(at) === 0x02014b50; k++) {
      const nl = b.readUInt16LE(at + 28), xl = b.readUInt16LE(at + 30), cl = b.readUInt16LE(at + 32);
      names.push(b.toString('utf8', at + 46, at + 46 + nl));
      at += 46 + nl + xl + cl;
    }
    break;
  }
  return names;
}
const zipShapefile = (p) => cached('zip', p, () => zipNames(p).some((n) => /\.shp$/i.test(n) && !/(^|\/)__MACOSX\//.test(n)));
const geojson = (p) => cached('json', p, () => /"type"\s*:\s*"(FeatureCollection|Feature)"/.test(head(p, 16384).toString('utf8')) || /"type"\s*:\s*"Topology"/.test(head(p, 2048).toString('utf8')));

// Everything the bundled GDAL reads that is map data by its extension alone: OpenStreetMap extracts, MicroStation and
// ArcInfo exchange files, vector and raster tile packages, elevation (DTED, USGS DEM, SRTM), band-interleaved grids,
// Surfer and SAGA grids, ERS and NITF imagery and BSB nautical charts.
const VECTOR = ['shp', 'geojson', 'kml', 'kmz', 'gpx', 'gpkg', 'fgb', 'gml', 'topojson', 'tab', 'mif', 'osm', 'pbf', 'dgn', 'e00', 'gmt', 'geojsonl', 'geojsons', 'mvt', 'pmtiles', 'mbtiles', 'sxf', 'jml', 'mapml'];
const RASTER = ['hgt', 'dem', 'dt0', 'dt1', 'dt2', 'bil', 'bip', 'bsq', 'grd', 'adf', 'kap', 'sdat', 'ers', 'ntf'];
// A picture placed by a world file beside it (photo.tif + photo.tfw), which GDAL reads as a georeferenced raster.
const WORLD = { tif: ['tfw', 'tifw', 'wld'], tiff: ['tfw', 'tiffw', 'wld'], jpg: ['jgw', 'jpgw', 'wld'], jpeg: ['jgw', 'wld'], png: ['pgw', 'pngw', 'wld'] };
const worldFile = (p) => (WORLD[ext(p)] || []).some((w) => fs.existsSync(p.replace(/\.[^.\\/]+$/, `.${w}`)) || fs.existsSync(p.replace(/\.[^.\\/]+$/, `.${w.toUpperCase()}`)));
// ERDAS Imagine (.img is also a disk image, so the header decides).
const erdas = (p) => cached('img', p, () => head(p, 16).toString('latin1').startsWith('EHFA_HEADER_TAG'));
// An ESRI ASCII grid (.asc is also used for signed text, so the header decides).
const ascGrid = (p) => cached('asc', p, () => /^\s*ncols\s+\d+/i.test(head(p, 256).toString('latin1')));
// 'vector', 'raster' or null.
function kind(p) {
  const e = ext(p);
  if (VECTOR.includes(e)) return 'vector';
  if (RASTER.includes(e) || (e === 'asc' && ascGrid(p))) return 'raster';
  if ((e === 'tif' || e === 'tiff') && geotiff(p)) return 'raster';
  if (WORLD[e] && worldFile(p)) return 'raster';
  if (e === 'img' && erdas(p)) return 'raster';
  if ((e === 'csv' || e === 'tsv' || e === 'txt') && csvColumns(p)) return 'vector';
  if (e === 'zip' && zipShapefile(p)) return 'vector';
  if (e === 'json' && geojson(p)) return 'vector';
  if (e === 'dxf') return 'vector';
  return null;
}
const isGeo = (p) => !!kind(p);

// HEC-RAS, SWMM, HEC-DSS and project schedule files that share an extension with other things.
// EPANET also writes .inp files, with [PIPES]; SWMM's have conduits, outfalls or subcatchments.
const swmmInp = (p) => cached('inp', p, () => { const t = head(p, 262144).toString('latin1').toUpperCase(); return /^\s*\[(SUBCATCHMENTS|CONDUITS|OUTFALLS)\]/m.test(t) && !/^\s*\[PIPES\]/m.test(t); });
const swmmOut = (p) => cached('swout', p, () => { const h = head(p, 4), t = tail(p, 4); return h.length === 4 && h.readInt32LE(0) === 516114522 && t.length === 4 && t.readInt32LE(0) === 516114522; });
const hdf5 = (p) => cached('hdf', p, () => head(p, 8).equals(Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a])));
const rasHdf = (p) => cached('ras', p, () => hdf5(p) && /\.(p|g|u)\d\d\.hdf$/i.test(p) || (hdf5(p) && /HEC-RAS|Plan Data|Geometry\/Cross Sections|Results\/(Unsteady|Steady)/.test(head(p, 1 << 20).toString('latin1'))));
const dss = (p) => cached('dss', p, () => head(p, 4).toString('latin1') === 'ZDSS');
const msProject = (p) => cached('msp', p, () => /<Project[^>]+xmlns\s*=\s*"http:\/\/schemas\.microsoft\.com\/project"/.test(head(p, 4096).toString('utf8')));

module.exports = { ascGrid, kind, isGeo, csvColumns, geotiff, zipNames, zipShapefile, geojson, swmmInp, swmmOut, hdf5, rasHdf, dss, msProject, VECTOR, RASTER };
