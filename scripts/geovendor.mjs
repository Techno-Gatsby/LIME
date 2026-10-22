// Builds Lime's offline basemap (vendor/geo/basemap.json.br) from Natural Earth (public domain), version-pinned and
// SHA-256 checked. The Maps window draws it under the user's layers; nothing is fetched at run time.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson';
export const BASEMAP_VERSION = 'ne-5.1.2-1';
// Each layer keeps a few properties and is simplified to roughly the scale it is drawn at.
const LAYERS = {
  countries: { file: 'ne_10m_admin_0_countries.geojson', sha: '239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255', tol: 0.004, keep: (p) => ({ name: p.NAME }) },
  regions: { file: 'ne_10m_admin_1_states_provinces_lines.geojson', sha: '1a1f30ccaaf4cc9c4bde34266f0b8cbb955d3a4cf254b756912255f2ec7c75b6', tol: 0.004, keep: () => ({}) },
  lakes: { file: 'ne_10m_lakes.geojson', sha: '2d036f53dedec578001c5c30c2959ee7d4eebc1306900fa4367c49929ec8f2d9', tol: 0.004, keep: (p) => ({ name: p.name || '' }), want: (p) => p.scalerank <= 8 },
  rivers: { file: 'ne_10m_rivers_lake_centerlines.geojson', sha: 'bb854a900ecbd3b408df46d5e16e3e0f974ba55993f9d8b5c26e855273c0905a', tol: 0.004, keep: (p) => ({ name: p.name || '' }) },
  urban: { file: 'ne_10m_urban_areas.geojson', sha: '5136ffd816a9b28c0f295e6797b4c03eaa421be80d78b90f542db4a932dd4497', tol: 0.003, keep: () => ({}), want: (p) => p.area_sqkm >= 8 },
  roads: { file: 'ne_10m_roads.geojson', sha: '66a0c7b438e92fd124822cc5921cfa11042f48c294ade5e0f03f2c6640fd0248', tol: 0.004, keep: (p) => ({ r: p.scalerank, t: p.expressway ? 'x' : p.type === 'Major Highway' ? 'm' : 's' }), want: (p) => p.scalerank <= 8 && p.featurecla !== 'Ferry' },
  places: { file: 'ne_10m_populated_places_simple.geojson', sha: 'fd3fa867a320cbd5c5b6bb5bc550afeec2939fb2cef688e508007282a55ac42f', tol: 0, keep: (p) => ({ name: p.name, r: p.scalerank, cap: p.adm0cap ? 1 : 0 }) },
};

const q = (v) => Math.round(v * 1e4) / 1e4;
function simplify(pts, tol) {
  if (pts.length < 3 || !tol) return pts.map(([x, y]) => [q(x), q(y)]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]], t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    let far = -1, best = t2;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > best) { best = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) { const p = [q(pts[i][0]), q(pts[i][1])]; const l = out[out.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p); }
  return out;
}
const ring = (r, tol) => { const s = simplify(r, tol); return s.length >= 4 ? s : null; };
function geom(g, tol) {
  if (!g) return null;
  if (g.type === 'Point') return { type: 'Point', coordinates: [q(g.coordinates[0]), q(g.coordinates[1])] };
  if (g.type === 'LineString') { const c = simplify(g.coordinates, tol); return c.length >= 2 ? { type: 'LineString', coordinates: c } : null; }
  if (g.type === 'MultiLineString') { const c = g.coordinates.map((l) => simplify(l, tol)).filter((l) => l.length >= 2); return c.length ? { type: 'MultiLineString', coordinates: c } : null; }
  if (g.type === 'Polygon') { const c = g.coordinates.map((r) => ring(r, tol)); return c[0] ? { type: 'Polygon', coordinates: c.filter(Boolean) } : null; }
  if (g.type === 'MultiPolygon') { const c = g.coordinates.map((p) => p.map((r) => ring(r, tol))).filter((p) => p[0]).map((p) => p.filter(Boolean)); return c.length ? { type: 'MultiPolygon', coordinates: c } : null; }
  return null;
}

async function fetchPinned(url, sha, cache) {
  const f = path.join(cache, path.basename(url));
  if (!fs.existsSync(f)) {
    for (let i = 1; ; i++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(600000) });
        if (!r.ok) throw new Error(`${r.status} ${url}`);
        fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
        break;
      } catch (e) { if (i === 3) throw e; console.warn(`retrying ${url}: ${e.message}`); }
    }
  }
  const got = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  if (got !== sha) { fs.rmSync(f, { force: true }); throw new Error(`${path.basename(url)}: SHA-256 ${got} isn't the pinned ${sha}`); }
  return f;
}

export async function buildBasemap(out, cache, { tidy = false } = {}) {
  const dest = path.join(out, 'basemap.json.br'), mf = path.join(out, 'manifest.json');
  const manifest = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : {};
  if (fs.existsSync(dest) && manifest.basemap?.version === BASEMAP_VERSION) return fs.statSync(dest).size;
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });
  const layers = {};
  for (const [id, L] of Object.entries(LAYERS)) {
    const file = await fetchPinned(`${NE}/${L.file}`, L.sha, cache);
    const src = JSON.parse(fs.readFileSync(file, 'utf8'));
    layers[id] = { type: 'FeatureCollection', features: src.features.filter((f) => !L.want || L.want(f.properties)).map((f) => ({ type: 'Feature', properties: L.keep(f.properties), geometry: geom(f.geometry, L.tol) })).filter((f) => f.geometry) };
    if (tidy) fs.rmSync(file, { force: true });
  }
  const json = Buffer.from(JSON.stringify({ version: BASEMAP_VERSION, source: 'Natural Earth 1:10m (public domain), naturalearthdata.com', layers }));
  fs.writeFileSync(dest, zlib.brotliCompressSync(json, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length } }));
  fs.writeFileSync(mf, JSON.stringify({ ...manifest, basemap: { version: BASEMAP_VERSION, file: 'basemap.json.br' } }));
  console.log('◍', 'basemap', `${(json.length / 1048576).toFixed(1)} MB → ${(fs.statSync(dest).size / 1048576).toFixed(1)} MB`, Object.entries(layers).map(([k, v]) => `${k} ${v.features.length}`).join(', '));
  return fs.statSync(dest).size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  await buildBasemap(process.argv[2] || path.join(import.meta.dirname, '..', 'vendor', 'geo'), process.argv[3] || path.join(import.meta.dirname, '..', 'vendor', '.cache'));
}
