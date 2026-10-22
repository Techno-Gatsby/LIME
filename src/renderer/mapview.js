// Maps: a Lime window for map data. Layers over an offline Natural Earth basemap, drawn with OpenLayers on a canvas
// (no GPU needed); files are read by GDAL in the engine and arrive here as GeoJSON or as a coloured raster picture.
import { $, $$, esc, h, nameOf, dirOf, sep, clean } from './ui.js';
import { setDocName } from './editor-kit.js';
import { key, shortcuts, helpButton } from './shortcuts.js';

const PALETTE = ['#2a6fdb', '#e8590c', '#2b8a3e', '#ae3ec9', '#c92a2a', '#0b7285', '#5c940d', '#d6336c'];
export const KEYS = [
  ['Map', [key('I', 'Identify'), key('D', 'Measure a distance'), key('A', 'Measure an area'), key('Escape', 'Stop measuring'), key('F', 'Zoom to all layers'), key(['Plus', 'Minus'], 'Zoom in or out')]],
  ['File', [key('Mod+O', 'Add a layer'), key('Mod+Shift+E', 'Export the view'), key('Mod+T', 'Attribute table'), key('Mod+W', 'Close')]],
];
const READOUTS = [['dd', 'Latitude, longitude'], ['dms', 'Degrees, minutes, seconds'], ['utm', 'UTM (zone of the pointer)'], ['3997', 'Dubai Local TM (DLTM)'], ['32640', 'UTM 40N'], ['32639', 'UTM 39N'], ['3857', 'Web Mercator']];
const dms = (v, pos, neg) => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60; return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${v >= 0 ? pos : neg}`; };
const fmtLen = (m) => (m >= 1000 ? `${(m / 1000).toFixed(3)} km` : `${m.toFixed(2)} m`);
const fmtArea = (m2) => (m2 >= 1e6 ? `${(m2 / 1e6).toFixed(4)} km² (${(m2 / 1e4).toFixed(2)} ha)` : `${m2.toFixed(1)} m² (${(m2 / 1e4).toFixed(4)} ha)`);

let libP = null;
async function libs() {
  if (!document.querySelector('link[href="vendor/geo/ol.css"]')) document.head.append(h('<link rel="stylesheet" href="vendor/geo/ol.css">'));
  if (!document.querySelector('link[href="mapview.css"]')) document.head.append(h('<link rel="stylesheet" href="mapview.css">'));
  return (libP ||= import('./vendor/geo/maplibs.js'));
}

export function openEditor(view, { file }, ctx) {
  const { toast, api, go } = ctx;
  ctx.onClose?.(close);
  const icon = (n, s = '') => ctx.icon(n, s);
  const call = (m, ...a) => api.invoke('edit:call', 'geo', m, ...a);
  const st = { ready: false, disposed: false, file: file || '', layers: [], seq: 0, mode: 'identify', readout: 'dd', table: null, measures: [] };
  let L = null, map = null, base = [], measureSrc = null, measureLayer = null, draw = null, popup = null;

  const root = h(`<div class="editor mapview">
    <header class="ed-head">
      <div class="topbar">
        <button class="tb icon" data-a="close" title="Close">${icon('back')}</button>
        <div class="doc">${icon('map')}<b></b></div>
        <div class="grow"></div>
        <button class="tb" data-a="add" title="Add a layer (Ctrl+O)">${icon('add', 'sm')}<span class="lbl">Add layer</span></button>
        <div class="seg mv-modes">
          <button class="tb on" data-m="identify" title="Identify: click a feature to see its attributes (I)">${icon('info', 'sm')}<span class="lbl">Identify</span></button>
          <button class="tb" data-m="distance" title="Measure a distance (D)">${icon('ruler', 'sm')}<span class="lbl">Distance</span></button>
          <button class="tb" data-m="area" title="Measure an area (A)">${icon('shapes', 'sm')}<span class="lbl">Area</span></button>
        </div>
        <button class="tb" data-a="table" title="Attribute table (Ctrl+T)">${icon('grid', 'sm')}<span class="lbl">Table</span></button>
        <button class="tb" data-a="export" title="Export the view as PNG or PDF (Ctrl+Shift+E)">${icon('image', 'sm')}<span class="lbl">Export</span></button>
        ${helpButton()}
      </div>
    </header>
    <div class="mv-body">
      <aside class="mv-side"><div class="mv-h">Layers</div><ul class="mv-layers"></ul>
        <div class="mv-base"><label>Basemap <select data-a="basemap" aria-label="Basemap"><option value="ne">Natural Earth · offline</option><option value="osm">OpenStreetMap · online</option><option value="none">None</option></select></label><small class="mv-credit" hidden>© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors</small></div></aside>
      <div class="mv-main"><div class="mv-map"></div><div class="mv-table" hidden></div></div>
    </div>
    <footer class="mv-status"><span class="mv-coord">–</span><select class="mv-readout" title="Coordinates shown">${READOUTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><span class="grow mv-msg"></span><span class="mv-scale"></span></footer>
  </div>`);
  view.append(root);
  setDocName(root, st.file || 'New map');
  const msg = (t) => { $('.mv-msg', root).textContent = t || ''; };

  // --- Styles ------------------------------------------------------------------------------------------------------
  function styleFor(layer) {
    const { Style, Fill, Stroke, CircleStyle, Text } = L;
    const cache = new Map();
    return (f, res) => {
      const s = layer.style, label = s.label ? String(f.get(s.label) ?? '') : '';
      const k = `${s.color}|${s.width}|${s.opacity}|${label}|${f.getGeometry()?.getType()}`;
      if (cache.has(k)) return cache.get(k);
      const fill = new Fill({ color: hexA(s.color, 0.25 * s.opacity) }), stroke = new Stroke({ color: hexA(s.color, s.opacity), width: s.width });
      const st2 = new Style({ fill, stroke, image: new CircleStyle({ radius: 4 + s.width, fill: new Fill({ color: hexA(s.color, s.opacity) }), stroke: new Stroke({ color: '#fff', width: 1.5 }) }),
        text: label ? new Text({ text: label, font: '12px system-ui, sans-serif', offsetY: -12, fill: new Fill({ color: '#1d1d1f' }), stroke: new Stroke({ color: '#fff', width: 3 }), overflow: true }) : undefined });
      if (cache.size > 400) cache.clear();
      cache.set(k, st2);
      return st2;
    };
  }
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

  async function basemap() {
    const text = await call('basemap');
    if (!text) { $('[data-a=basemap] option[value=ne]', root)?.remove(); setBase(localStorage.getItem('lime.map.base') === 'osm' ? 'osm' : 'none'); return; }
    const bm = JSON.parse(text), fmt = new L.GeoJSON(), { Style, Fill, Stroke, CircleStyle, Text } = L;
    const read = (k) => new L.VectorSource({ features: fmt.readFeatures(bm.layers[k], { featureProjection: 'EPSG:3857' }) });
    const dark = () => document.documentElement.dataset.theme === 'dark';
    const mk = (k, style, extra = {}) => new L.VectorLayer({ source: read(k), style, declutter: k === 'places', updateWhileInteracting: false, properties: { base: true, name: k }, ...extra });
    const land = new Style({ fill: new Fill({ color: '#eef0e6' }), stroke: new Stroke({ color: '#b9b4a6', width: 0.8 }) });
    const landDark = new Style({ fill: new Fill({ color: '#2a2e28' }), stroke: new Stroke({ color: '#555b50', width: 0.8 }) });
    const water = new Style({ fill: new Fill({ color: '#cfe3f3' }), stroke: new Stroke({ color: '#9cc3e4', width: 1 }) });
    const urban = new Style({ fill: new Fill({ color: 'rgba(214, 204, 186, .55)' }) });
    const region = new Style({ stroke: new Stroke({ color: '#bcb6a8', width: 0.7, lineDash: [4, 3] }) });
    const roads = {}, road = (f, res) => { const r = f.get('r') || 8, t = f.get('t'); if (res > 2400 && r > 4) return null; if (res > 600 && r > 6) return null; const k = `${t}${r < 5}`; return (roads[k] ||= new Style({ stroke: new Stroke({ color: t === 'x' ? '#e8a33d' : '#d9cfb8', width: t === 'x' ? 1.6 : 1 }) })); };
    const places = {}, place = (f, res) => { const r = f.get('r') ?? 10; if (r > Math.max(0, 11 - Math.log2(160000 / res) * 1.1)) return null; const k = `${f.get('name')}|${f.get('cap')}`; return (places[k] ||= new Style({ image: new CircleStyle({ radius: f.get('cap') ? 4 : 2.5, fill: new Fill({ color: '#555' }), stroke: new Stroke({ color: '#fff', width: 1 }) }), text: new Text({ text: f.get('name'), font: `${f.get('cap') ? '600 ' : ''}11px system-ui, sans-serif`, offsetY: -10, fill: new Fill({ color: dark() ? '#ddd' : '#333' }), stroke: new Stroke({ color: dark() ? '#222' : '#fff', width: 3 }) }) })); };
    base = [mk('countries', () => (dark() ? landDark : land)), mk('urban', urban, { minZoom: 6 }), mk('lakes', water), mk('rivers', new Style({ stroke: new Stroke({ color: '#9cc3e4', width: 1 }) }), { minZoom: 4 }), mk('regions', region, { minZoom: 4 }), mk('roads', road, { minZoom: 5 }), mk('places', place, { minZoom: 3 })];
    base.forEach((l, i) => { l.setZIndex(i - 100); map.addLayer(l); });
    setBase(localStorage.getItem('lime.map.base') || 'ne');
  }

  // OpenStreetMap's standard tiles, drawn only while chosen and online; Natural Earth needs no connection.
  let osm = null;
  function setBase(v) {
    if (v === 'osm' && !osm) { osm = new L.TileLayer({ source: new L.OSM({ attributions: [] }), zIndex: -200, properties: { base: true, name: 'osm' } }); map.addLayer(osm); }
    osm?.setVisible(v === 'osm');
    base.forEach((l) => l.setVisible(v === 'ne'));
    $('.mv-credit', root).hidden = v !== 'osm';
    const sel = $('[data-a=basemap]', root);
    if (sel) sel.value = v;
    try { localStorage.setItem('lime.map.base', v); } catch (_) {}
    if (v === 'osm' && !navigator.onLine) toast('OpenStreetMap needs an internet connection. Natural Earth works offline.');
  }

  // --- Layers ------------------------------------------------------------------------------------------------------
  async function addFile(path, opts = {}) {
    msg(`Reading ${nameOf(path)}…`);
    try {
      const d = await call('mapLayers', path, opts);
      if (d.needCrs) {
        const from = await pickCrs(nameOf(path));
        if (!from) { msg(''); return []; }
        return addFile(path, { from });
      }
      const added = [];
      if (d.kind === 'raster') added.push(addRaster(d, path));
      else for (const l of d.layers) if (l.geojson) added.push(addVector(l, path, d.layers.length > 1));
      const skipped = d.layers?.filter((l) => l.skipped) || [];
      msg(skipped.length ? `${skipped.map((l) => l.name).join(', ')} left out: too many features to draw` : '');
      renderList();
      zoomTo(added);
      return added;
    } catch (e) { msg(''); toast(clean(e), { type: 'error' }); return []; }
  }
  function addVector(l, path, many) {
    const features = new L.GeoJSON().readFeatures(l.geojson, { featureProjection: 'EPSG:3857' });
    const layer = { id: ++st.seq, kind: 'vector', name: many ? `${nameOf(path)} · ${l.name}` : nameOf(path), path, count: features.length, fields: l.fields.map((f) => f.name), crs: l.crs, geomType: l.type,
      style: { color: PALETTE[(st.seq - 1) % PALETTE.length], width: 2, opacity: 1, label: '' }, visible: true };
    layer.source = new L.VectorSource({ features });
    layer.ol = new L.VectorLayer({ source: layer.source, style: styleFor(layer), properties: { lime: layer.id } });
    features.forEach((f, i) => f.set('__row', i, true));
    st.layers.unshift(layer);
    map.addLayer(layer.ol);
    restack();
    return layer;
  }
  function addRaster(d, path) {
    const layer = { id: ++st.seq, kind: 'raster', name: nameOf(path), path, info: d.info, min: d.min, max: d.max, rgb: d.rgb, values: d.values, extent: d.extent, style: { opacity: 1 }, visible: true };
    layer.ol = new L.ImageLayer({ source: new L.ImageStatic({ url: d.png, imageExtent: d.extent, projection: 'EPSG:3857' }), properties: { lime: layer.id } });
    st.layers.unshift(layer);
    map.addLayer(layer.ol);
    restack();
    return layer;
  }
  const restack = () => st.layers.forEach((l, i) => l.ol.setZIndex(st.layers.length - i));
  function zoomTo(list = st.layers) {
    const ex = L.createEmpty();
    for (const l of list) { if (l.kind === 'raster') L.extend(ex, l.extent); else if (l.source.getFeatures().length) L.extend(ex, l.source.getExtent()); }
    if (!L.isEmpty(ex)) map.getView().fit(ex, { padding: [40, 40, 40, 40], maxZoom: 18, duration: 0 });
  }
  function renderList() {
    const ul = $('.mv-layers', root);
    ul.innerHTML = st.layers.map((l, i) => `<li data-id="${l.id}" class="${st.table === l.id ? 'cur' : ''}">
      <div class="r1"><input type="checkbox" data-k="vis" ${l.visible ? 'checked' : ''} title="Show or hide">${l.kind === 'vector' ? `<input type="color" data-k="color" value="${l.style.color}" title="Colour">` : `<span class="sw">${icon('image', 'sm')}</span>`}
        <span class="n" title="${esc(l.path)}">${esc(l.name)}</span>
        <button class="tb icon sm" data-k="up" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button><button class="tb icon sm" data-k="down" title="Move down" ${i === st.layers.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="tb icon sm" data-k="zoom" title="Zoom to layer">⤢</button><button class="tb icon sm" data-k="remove" title="Remove layer">✕</button></div>
      <div class="r2"><label title="Opacity">Opacity <input type="range" data-k="opacity" min="10" max="100" value="${Math.round(l.style.opacity * 100)}"></label>
        ${l.kind === 'vector' ? `<label title="Line width">Width <input type="range" data-k="width" min="1" max="8" value="${l.style.width}"></label><select data-k="label" title="Label features by"><option value="">No labels</option>${l.fields.map((f) => `<option ${l.style.label === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>` : ''}</div>
      <div class="r3">${l.kind === 'vector' ? `${l.count} feature${l.count === 1 ? '' : 's'} · ${esc(l.geomType || '')}${l.crs ? ` · ${esc(l.crs.epsg ? `EPSG:${l.crs.epsg}` : l.crs.name)}` : ''}` : `${l.rgb ? 'Picture' : `Values ${num(l.min)} to ${num(l.max)}`}${l.info?.crs ? ` · ${esc(l.info.crs.epsg ? `EPSG:${l.info.crs.epsg}` : l.info.crs.name)}` : ''}`}</div></li>`).join('') || '<li class="empty">Add a layer, or drop map files here: GeoJSON, shapefiles, KML/KMZ, GPX, GeoPackage, GeoTIFF or CSV with coordinates.</li>';
  }
  const num = (v) => (v == null ? '?' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : +Number(v).toPrecision(5));
  const byId = (id) => st.layers.find((l) => l.id === +id);
  function onList(e) {
    const li = e.target.closest('li[data-id]'), k = e.target.dataset.k;
    if (!li || !k) return;
    const l = byId(li.dataset.id), i = st.layers.indexOf(l);
    if (k === 'vis') { l.visible = e.target.checked; l.ol.setVisible(l.visible); }
    else if (k === 'color') { l.style.color = e.target.value; l.ol.changed(); }
    else if (k === 'opacity') { l.style.opacity = e.target.value / 100; if (l.kind === 'raster') l.ol.setOpacity(l.style.opacity); else l.ol.changed(); }
    else if (k === 'width') { l.style.width = +e.target.value; l.ol.changed(); }
    else if (k === 'label') { l.style.label = e.target.value; l.ol.changed(); }
    else if (k === 'up' || k === 'down') { const j = k === 'up' ? i - 1 : i + 1; [st.layers[i], st.layers[j]] = [st.layers[j], st.layers[i]]; restack(); renderList(); }
    else if (k === 'zoom') zoomTo([l]);
    else if (k === 'remove') { map.removeLayer(l.ol); st.layers.splice(i, 1); if (st.table === l.id) table(null); renderList(); }
  }

  // --- Attribute table ---------------------------------------------------------------------------------------------
  function table(id = st.layers.find((l) => l.kind === 'vector')?.id) {
    const box = $('.mv-table', root), l = id != null ? byId(id) : null;
    st.table = l && l.kind === 'vector' ? l.id : null;
    box.hidden = !st.table;
    renderList();
    if (!st.table) { map.updateSize(); return; }
    const feats = l.source.getFeatures().slice(0, 5000);
    box.innerHTML = `<div class="tb-head"><b>${esc(l.name)}</b><span class="muted">${l.count} feature${l.count === 1 ? '' : 's'}${l.count > 5000 ? ', first 5000 shown' : ''}</span><input type="search" class="tb-filter" placeholder="Filter rows"><button class="tb icon sm" data-t="close" title="Close the table">✕</button></div>
      <div class="tb-scroll"><table><thead><tr><th>#</th>${l.fields.map((f) => `<th>${esc(f)}</th>`).join('')}</tr></thead><tbody>${feats.map((f, i) => `<tr data-i="${i}"><td>${i + 1}</td>${l.fields.map((k) => `<td>${esc(f.get(k) ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    box.onclick = (e) => {
      if (e.target.closest('[data-t=close]')) { table(null); return; }
      const tr = e.target.closest('tr[data-i]');
      if (!tr) return;
      $$('tr.sel', box).forEach((x) => x.classList.remove('sel'));
      tr.classList.add('sel');
      const f = feats[+tr.dataset.i];
      map.getView().fit(f.getGeometry().getExtent(), { padding: [80, 80, 80, 80], maxZoom: 18, duration: 200 });
      showPopup(f, l, L.getCenter(f.getGeometry().getExtent()));
    };
    $('.tb-filter', box).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('tbody tr', box).forEach((tr) => { tr.hidden = !!q && !tr.textContent.toLowerCase().includes(q); }); };
    requestAnimationFrame(() => map.updateSize());
  }

  // --- Identify, measure, coordinates ------------------------------------------------------------------------------
  function showPopup(f, l, coord) {
    const props = Object.entries(f.getProperties()).filter(([k]) => k !== 'geometry' && !k.startsWith('__'));
    const g = f.getGeometry(), type = g.getType(), extra = /Line/.test(type) ? `Length ${fmtLen(L.getLength(g))}` : /Polygon/.test(type) ? `Area ${fmtArea(L.getArea(g))}` : '';
    popup.getElement().innerHTML = `<div class="mv-pop"><b>${esc(l.name)}</b>${props.map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v ?? '')}</div>`).join('') || '<div class="muted">No attributes</div>'}${extra ? `<div class="meas">${extra}</div>` : ''}</div>`;
    popup.setPosition(coord);
  }
  function identify(e) {
    let hit = null;
    map.forEachFeatureAtPixel(e.pixel, (f, layer) => { const id = layer?.get('lime'); if (id && !hit) hit = [f, byId(id)]; return !!hit; }, { hitTolerance: 5 });
    if (hit) return showPopup(hit[0], hit[1], e.coordinate);
    const r = st.layers.find((l) => l.kind === 'raster' && l.visible && l.values && L.boundingExtent([e.coordinate]) && e.coordinate[0] >= l.extent[0] && e.coordinate[0] <= l.extent[2] && e.coordinate[1] >= l.extent[1] && e.coordinate[1] <= l.extent[3]);
    if (r) {
      const { w, h: hh, data } = r.values, x = Math.min(w - 1, Math.floor((e.coordinate[0] - r.extent[0]) / (r.extent[2] - r.extent[0]) * w)), y = Math.min(hh - 1, Math.floor((r.extent[3] - e.coordinate[1]) / (r.extent[3] - r.extent[1]) * hh));
      const v = data[y * w + x];
      popup.getElement().innerHTML = `<div class="mv-pop"><b>${esc(r.name)}</b><div><span>Value</span>${v == null ? 'No data' : num(v)}</div></div>`;
      popup.setPosition(e.coordinate);
      return;
    }
    popup.setPosition(undefined);
  }
  function setMode(m) {
    st.mode = m;
    $$('.mv-modes [data-m]', root).forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    if (draw) { map.removeInteraction(draw); draw = null; }
    popup?.setPosition(undefined);
    if (m === 'identify') { msg(''); return; }
    draw = new L.Draw({ source: measureSrc, type: m === 'area' ? 'Polygon' : 'LineString' });
    draw.on('drawend', (ev) => {
      const g = ev.feature.getGeometry(), text = m === 'area' ? `Area ${fmtArea(L.getArea(g))} · perimeter ${fmtLen(L.getLength(g))}` : `Distance ${fmtLen(L.getLength(g))}`;
      ev.feature.set('label', text);
      st.measures.push(text);
      msg(`${text} (geodesic). Esc stops measuring.`);
    });
    map.addInteraction(draw);
    msg(m === 'area' ? 'Click the corners of the area; double-click to finish.' : 'Click along the line; double-click to finish.');
  }
  const wkt = new Map();
  async function crsReady(code) {
    if (wkt.has(code)) return wkt.get(code);
    const p = call('crsWkt', [code]).then((r) => { if (r[code]) { L.proj4.defs(`EPSG:${code}`, r[code]); L.registerProj4(L.proj4); return true; } return false; }).catch(() => false);
    wkt.set(code, p);
    return p;
  }
  let lastCoord = null;
  async function readout(c = lastCoord) {
    if (!c) return;
    lastCoord = c;
    const [lon, lat] = L.toLonLat(c), el = $('.mv-coord', root), m = st.readout;
    if (m === 'dd') { el.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`; return; }
    if (m === 'dms') { el.textContent = `${dms(lat, 'N', 'S')} ${dms(lon, 'E', 'W')}`; return; }
    if (m === '3857') { el.textContent = `X ${c[0].toFixed(1)}  Y ${c[1].toFixed(1)}`; return; }
    const code = m === 'utm' ? String((lat >= 0 ? 32600 : 32700) + Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1))) : m;
    if (!(await crsReady(code))) { el.textContent = '–'; return; }
    const [x, y] = L.transform(c, 'EPSG:3857', `EPSG:${code}`);
    el.textContent = `E ${x.toFixed(2)}  N ${y.toFixed(2)}${m === 'utm' ? `  (zone ${code.slice(-2)}${lat >= 0 ? 'N' : 'S'})` : ''}`;
  }

  // --- Export ------------------------------------------------------------------------------------------------------
  async function picture() {
    await new Promise((r) => { map.once('rendercomplete', r); map.renderSync(); });
    const size = map.getSize(), out = document.createElement('canvas');
    out.width = size[0] * devicePixelRatio; out.height = size[1] * devicePixelRatio;
    const c = out.getContext('2d');
    c.fillStyle = document.documentElement.dataset.theme === 'dark' ? '#1b2633' : '#dbe9f5';
    c.fillRect(0, 0, out.width, out.height);
    for (const cv of $$('.mv-map .ol-layer canvas', root)) {
      if (!cv.width) continue;
      const op = cv.parentNode.style.opacity || cv.style.opacity;
      c.globalAlpha = op === '' ? 1 : Number(op);
      const tr = cv.style.transform, m = /^matrix\(([^)]*)\)$/.exec(tr);
      if (m) c.setTransform(...m[1].split(',').map(Number)); else c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(cv, 0, 0);
    }
    c.globalAlpha = 1; c.setTransform(1, 0, 0, 1, 0, 0);
    const sl = $('.ol-scale-line-inner', root);
    if (sl) { const w = sl.offsetWidth * devicePixelRatio, x = 16 * devicePixelRatio, y = out.height - 18 * devicePixelRatio; c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(x - 6, y - 22 * devicePixelRatio, w + 12, 30 * devicePixelRatio); c.strokeStyle = '#222'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w, y - 6); c.stroke(); c.fillStyle = '#222'; c.font = `${12 * devicePixelRatio}px system-ui, sans-serif`; c.fillText(sl.textContent, x, y - 9 * devicePixelRatio); }
    return out.toDataURL('image/png');
  }
  const stem = () => (st.layers[st.layers.length - 1]?.name || nameOf(st.file) || 'Map').replace(/\.[^.]+$/, '').replace(/ · .*$/, '');
  async function exportAs(kind) {
    const d = dirOf(st.file || st.layers[0]?.path || ''), target = await api.invoke('dialog:save', { defaultPath: `${d ? `${d}${sep}` : ''}${stem()} map.${kind}`, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] });
    if (!target) return null;
    return exportTo(target, kind);
  }
  async function exportTo(target, kind) {
    try {
      const png = await picture(), size = map.getSize();
      const r = kind === 'pdf' ? await call('mapPdf', target, { png, title: stem(), scale: $('.ol-scale-line-inner', root)?.textContent ? `Scale bar ${$('.ol-scale-line-inner', root).textContent}` : '', crs: 'Web Mercator view; coordinates WGS 84', width: size[0], height: size[1], note: st.layers.map((l) => l.name).join(', ') })
        : await call('write', target, Uint8Array.from(atob(png.split(',')[1]), (ch) => ch.charCodeAt(0)));
      toast(`Exported ${nameOf(r.path)}`, { type: 'success', actions: [{ label: 'Open', fn: () => api.invoke('shell:open', r.path) }, { label: 'Show in folder', fn: () => api.invoke('shell:show', r.path) }] });
      return r.path;
    } catch (e) { toast(clean(e), { type: 'error' }); return null; }
  }
  function exportMenu() {
    const old = $('.mv-export', root);
    if (old) { old.remove(); return; }
    const pop = h(`<div class="popmenu mv-export" role="menu"><button class="mi" data-k="png">${icon('image', 'sm')}<span class="grow">PNG picture</span></button><button class="mi" data-k="pdf">${icon('pdf', 'sm')}<span class="grow">PDF page</span><small>A3, with scale</small></button></div>`);
    const b = $('[data-a=export]', root).getBoundingClientRect();
    root.append(pop);
    pop.style.top = `${b.bottom + 6}px`; pop.style.left = `${Math.max(8, Math.min(b.left, innerWidth - pop.offsetWidth - 8))}px`;
    const off = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off); } };
    setTimeout(() => document.addEventListener('pointerdown', off), 0);
    pop.addEventListener('click', (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (k) { pop.remove(); exportAs(k); } });
  }

  // --- Dialogs and plumbing ----------------------------------------------------------------------------------------
  async function pickCrs(name) {
    const list = await call('crsList');
    return new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog" role="dialog" aria-modal="true"><div class="body"><h2>Which coordinates does ${esc(name)} use?</h2><p class="muted">The file doesn’t say, and its numbers aren’t latitude and longitude.</p>
        <select class="mv-crs">${list.filter(([v]) => v !== 'utm').map(([v, l]) => `<option value="${v}">${esc(l)}${/^\d+$/.test(v) ? ` · EPSG:${v}` : ''}</option>`).join('')}</select><input class="mv-epsg" placeholder="EPSG code" hidden></div>
        <div class="foot"><button class="btn primary" data-a="ok">Show</button><button class="btn" data-a="cancel">Cancel</button></div></div></div>`);
      document.body.append(s);
      const sel = $('.mv-crs', s), inp = $('.mv-epsg', s);
      sel.value = '3997';
      sel.onchange = () => { inp.hidden = sel.value !== 'custom'; };
      s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return; s.remove(); resolve(a === 'ok' ? (sel.value === 'custom' ? inp.value.replace(/\D/g, '') : sel.value) : null); });
    });
  }
  async function addDialog() {
    const files = await api.invoke('dialog:open', { title: 'Add map layers', filters: [{ name: 'Map data', extensions: ['geojson', 'json', 'shp', 'zip', 'kml', 'kmz', 'gpx', 'gpkg', 'fgb', 'gml', 'csv', 'tsv', 'tif', 'tiff', 'asc', 'hgt', 'dxf', 'topojson', 'tab', 'mif', 'osm', 'pbf', 'dgn', 'e00', 'gmt', 'geojsonl', 'geojsons', 'mvt', 'pmtiles', 'mbtiles', 'sxf', 'jml', 'mapml', 'dem', 'dt0', 'dt1', 'dt2', 'bil', 'bip', 'bsq', 'grd', 'adf', 'kap', 'sdat', 'ers', 'ntf', 'img', 'jpg', 'jpeg', 'png'] }] });
    for (const f of files) await addFile(f);
  }
  function close() { go(); }
  const keys = shortcuts([['Map', [key('I', 'Identify', () => setMode('identify')), key('D', 'Distance', () => setMode('distance')), key('A', 'Area', () => setMode('area')), key('Escape', 'Stop', () => setMode('identify')), key('F', 'Zoom to all', () => zoomTo())]],
    ['File', [key('Mod+O', 'Add a layer', addDialog), key('Mod+Shift+E', 'Export', exportMenu), key('Mod+T', 'Table', () => table(st.table ? null : undefined)), key('Mod+W', 'Close', close)]]]);
  root.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m && st.ready) { setMode(m); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') close();
    else if (a === 'help') keys.help();
    else if (!st.ready) return;
    else if (a === 'add') addDialog();
    else if (a === 'table') table(st.table ? null : (st.layers.find((l) => l.id === st.table) || st.layers.find((l) => l.kind === 'vector'))?.id);
    else if (a === 'export') exportMenu();
  });
  root.addEventListener('change', (e) => { if (e.target.dataset.a === 'basemap') setBase(e.target.value); if (e.target.matches('.mv-readout')) { st.readout = e.target.value; readout(); } });
  $('.mv-layers', root).addEventListener('input', onList);
  $('.mv-layers', root).addEventListener('click', (e) => { if (e.target.closest('button[data-k]')) onList(e); else { const li = e.target.closest('li[data-id]'); if (li && !e.target.closest('input,select,label') && st.table) table(li.dataset.id); } });
  // Files dropped on the map are added as layers rather than replacing it.
  root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  root.addEventListener('drop', async (e) => {
    const paths = [...(e.dataTransfer?.files || [])].map((f) => api.pathFor(f)).filter(Boolean);
    if (!paths.length) return;
    e.preventDefault();
    for (const p of paths) await addFile(p);
  });

  (async () => {
    try {
      L = await libs();
      if (st.disposed) return;
      popup = new L.Overlay({ element: h('<div class="mv-popup"></div>'), autoPan: { animation: { duration: 150 } }, offset: [0, -6], positioning: 'bottom-center' });
      measureSrc = new L.VectorSource();
      const { Style, Fill, Stroke, Text, CircleStyle } = L;
      measureLayer = new L.VectorLayer({ source: measureSrc, zIndex: 1000, style: (f) => new Style({ fill: new Fill({ color: 'rgba(232, 89, 12, .15)' }), stroke: new Stroke({ color: '#e8590c', width: 2.5, lineDash: [6, 4] }), image: new CircleStyle({ radius: 4, fill: new Fill({ color: '#e8590c' }) }),
        text: f.get('label') ? new Text({ text: f.get('label'), font: '600 12px system-ui, sans-serif', fill: new Fill({ color: '#7a2d00' }), stroke: new Stroke({ color: '#fff', width: 3 }), overflow: true }) : undefined }) });
      map = new L.Map({ target: $('.mv-map', root), layers: [measureLayer], overlays: [popup], controls: L.defaultControls({ attribution: false }).extend([new L.ScaleLine({ units: 'metric' })]), view: new L.View({ center: L.fromLonLat([55.27, 25.2]), zoom: 4, maxZoom: 22 }) });
      map.on('pointermove', (e) => { if (!e.dragging) readout(e.coordinate); });
      map.on('singleclick', (e) => { if (st.mode === 'identify') identify(e); });
      map.getView().on('change:resolution', () => { $('.mv-scale', root).textContent = `Zoom ${map.getView().getZoom().toFixed(1)}`; });
      await basemap().catch((e) => toast(`The basemap couldn’t be drawn: ${clean(e)}`, { type: 'error' }));
      st.ready = true;
      renderList();
      if (st.file) await addFile(st.file);
      st.loaded = true;
    } catch (e) { toast(clean(e), { type: 'error' }); go(); }
  })();

  window.__map = { st, map: () => map, L: () => L, addFile, table, setMode, picture, exportTo, readout, zoomTo, pickCrs };
  const dispose = () => {
    if (st.disposed) return;
    st.disposed = true;
    keys.dispose();
    try { map?.setTarget(null); } catch (_) {}
  };
  window.addEventListener('pagehide', dispose);
  return dispose;
}
