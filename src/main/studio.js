'use strict';
// The app editors: VectorCraft, DesignCraft, EffectCraft and FilmCraft files opened in Lime. The working copy is kept in
// the app's own format, one file per step, so undo and redo move between files and nothing touches the original until
// it is saved. Every edit, preview and export is made by the app's own engine.
const U = require('./engines/util');
const crafts = require('./engines/crafts');
const { fs, fsp, path } = U;

const sessions = new Map();
let seq = 0;
const TICKS = 254016000000; // FilmCraft time units per second

// "vectorcraft-cli: select.set: invalid parameters for `select.set`: no such object id 9" → "No such object id 9."
function clean(msg) {
  const s = String(msg || '').split(' — ').pop().replace(/^\w+-cli: /, '').replace(/^[a-zA-Z]+(\.[a-zA-Z0-9]+)+: /, '')
    .replace(/^invalid parameters for `[^`]+`: /, '').replace(/^command `[^`]+` is not available right now: /, '').replace(/^edit failed: /, '').trim();
  return s ? `${s[0].toUpperCase()}${s.slice(1)}${/[.!?)]$/.test(s) ? '' : '.'}` : 'The app couldn’t finish.';
}
async function exec(app, args, opts = {}) {
  const bin = await crafts.cli(app);
  try {
    return await U.run(bin, args, { cwd: opts.cwd || U.os.tmpdir(), timeout: opts.timeout || 180000, okCodes: opts.okCodes, env: { NO_COLOR: '1' } });
  } catch (e) { throw Object.assign(new Error(clean(e.message)), { code: e.code }); }
}
const jsonLines = (s) => String(s).split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter((x) => x !== null);
const hex2 = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
const rgbHex = (c) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const exists = (p) => fs.existsSync(p);

// ── VectorCraft ─────────────────────────────────────────────────────────────────────────────────────────────────────
const vargs = (cmds) => cmds.flatMap(([id, params]) => ['--cmd', id, ...(params ? ['--params', JSON.stringify(params)] : [])]);
async function vrun(input, cmds, exports = []) {
  const r = await exec('vectorcraft', ['run', ...(input ? ['--in', input] : []), ...vargs(cmds), ...exports.flatMap((e) => ['--export', e])]);
  const out = {};
  for (const j of jsonLines(r.stdout)) if (j.command) out[j.command] = j.result;
  return out;
}
let fontFamilies = null;
const families = async () => (fontFamilies ||= (await vrun(null, [['text.fontList']]).catch(() => ({})))['text.fontList']?.families || []);
const sel = (p) => (p.ids?.length ? [['select.set', { ids: p.ids }]] : [['select.all']]);
const ARRANGE = { front: 'bringToFront', forward: 'bringForward', backward: 'sendBackward', back: 'sendToBack' };
const PATHFINDER = ['unite', 'minusFront', 'intersect', 'exclude', 'divide'];
const VECTOR_OPS = {
  recolor: (p) => [['select.all'], ['recolor.apply', { map: p.map }]],
  grayscale: (p) => [...sel(p), ['edit.colors.toGrayscale', {}]],
  invert: (p) => [...sel(p), ['edit.colors.invert', {}]],
  saturate: (p) => [...sel(p), ['edit.colors.saturate', { intensity: Number(p.amount) || 0 }]],
  colorMode: (p) => [['file.documentColorMode', { mode: p.mode === 'cmyk' ? 'cmyk' : 'rgb' }]],
  fill: (p) => [['paint.setFill', p.color ? { ids: p.ids, color: p.color } : { ids: p.ids, none: true }]],
  stroke: (p) => [...(p.color !== undefined ? [['paint.setStroke', p.color ? { ids: p.ids, color: p.color } : { ids: p.ids, none: true }]] : []), ...(p.weight != null ? [['stroke.set', { ids: p.ids, weight: Number(p.weight) }]] : [])],
  opacity: (p) => [['transparency.set', { ids: p.ids, opacity: Number(p.value) }]],
  delete: (p) => [['edit.clear', { ids: p.ids }]],
  duplicate: (p) => [['edit.duplicate', { ids: p.ids, dx: 10, dy: 10 }]],
  arrange: (p) => [[`object.arrange.${ARRANGE[p.to] || 'bringToFront'}`, { ids: p.ids }]],
  align: (p) => [...sel(p), ['object.align', { ...(p.horizontal ? { horizontal: p.horizontal } : {}), ...(p.vertical ? { vertical: p.vertical } : {}), to: p.to || (p.ids?.length > 1 ? 'selection' : 'artboard') }]],
  distribute: (p) => [...sel(p), ['object.distribute', { ...(p.horizontal ? { horizontal: p.horizontal } : {}), ...(p.vertical ? { vertical: p.vertical } : {}) }]],
  flip: (p) => [...sel(p), ['object.reflect', { axis: p.axis === 'horizontal' ? 'horizontal' : 'vertical' }]],
  rotate: (p) => [...sel(p), ['object.rotate', { angle: Number(p.angle) || 90 }]],
  scale: (p) => [...sel(p), ['object.scale', { sx: Number(p.percent) || 100, strokes: true, corners: true }]],
  move: (p) => [['object.move', { ids: p.ids, dx: Number(p.dx) || 0, dy: Number(p.dy) || 0 }]],
  group: (p) => [['object.group', { ids: p.ids }]],
  ungroup: (p) => [['object.ungroup', { ids: p.ids }]],
  pathfinder: (p) => [[`object.pathfinder.${PATHFINDER.includes(p.kind) ? p.kind : 'unite'}`, { ids: p.ids }]],
  outlineStroke: (p) => [...sel(p), ['object.path.outlineStroke', {}]],
  expand: (p) => [...sel(p), ['object.expand', {}]],
  simplify: (p) => [...sel(p), ['object.path.simplify', { tolerance: Number(p.tolerance) || 1 }]],
  outlineText: (p) => [...(p.ids?.length ? [['select.set', { ids: p.ids }]] : [['select.object.textObjects']]), ['type.createOutlines', {}]],
  cleanUp: () => [['object.path.cleanUp', {}]],
  shadow: (p) => [...sel(p), ['effect.apply', { effect: 'stylize.dropShadow', params: { opacity: 50, x: 4, y: 4, blur: 6, color: '#000000' } }]],
  addText: (p) => [['text.create', { x: Number(p.x), y: Number(p.y), text: String(p.text || 'Text'), size: Number(p.size) || 24, ...(p.font ? { font: p.font } : {}), color: p.color || '#000000' }]],
  setText: (p) => [['text.setText', { id: p.id, text: String(p.text ?? '') }]],
  textStyle: (p) => [['text.setStyle', { ids: p.ids, ...(p.font ? { font: p.font } : {}), ...(p.size ? { size: Number(p.size) } : {}), ...(p.color ? { fill: p.color } : {}) }]],
  shape: (p) => {
    const [x, y, w, h] = [p.x, p.y, Math.max(1, p.w), Math.max(1, p.h)].map(Number);
    const make = p.kind === 'ellipse' ? ['shape.ellipse', { x, y, width: w, height: h }] : p.kind === 'star' ? ['shape.star', { cx: x + w / 2, cy: y + h / 2, radius1: Math.min(w, h) / 2, radius2: Math.min(w, h) / 4.5, points: 5 }]
      : p.kind === 'line' ? ['shape.line', { x1: x, y1: y, x2: x + w, y2: y + h }] : ['shape.rectangle', { x, y, width: w, height: h }];
    return [make, ...(p.kind === 'line' ? [] : [['paint.setFill', p.fill ? { color: p.fill } : { none: true }]]), ['paint.setStroke', p.stroke ? { color: p.stroke } : { none: true }], ...(p.stroke ? [['stroke.set', { weight: Number(p.weight) || 2 }]] : [])];
  },
  trace: (p) => [['file.place', { path: p.file, link: false, rect: p.rect }], ['imageTrace.makeAndExpand', { preset: p.preset || 'Auto Color', ...(p.ignoreWhite ? { params: { ignoreWhite: true } } : {}) }]],
  place: (p) => [['file.place', { path: p.file, link: false, rect: p.rect }]],
  findReplace: (p) => [['edit.findReplace', { find: String(p.find), replace: String(p.replace ?? ''), matchCase: !!p.matchCase, wholeWord: !!p.wholeWord }]],
  replaceFont: (p) => [['text.replaceFont', { from: { family: p.from }, to: { family: p.to } }]],
  artboard: (p) => [['artboard.setProps', { index: p.index || 0, ...(p.width ? { width: Number(p.width) } : {}), ...(p.height ? { height: Number(p.height) } : {}), ...(p.name ? { name: p.name } : {}), scaleArt: !!p.scaleArt }]],
  fitArtboard: (p) => [['artboard.fitToArt', { index: p.index || 0 }]],
  addArtboard: (p) => [['artboard.new', { width: Number(p.width) || 600, height: Number(p.height) || 600 }]],
  deleteArtboard: (p) => [['artboard.delete', { index: p.index }]],
  background: (p) => [['document.setup', { backgroundContents: p.white ? 'white' : 'transparent' }]],
};
const vector = {
  native: 'vectorcraft',
  writes: ['vectorcraft', 'svg', 'svgz', 'pdf', 'ai', 'eps', 'dxf', 'emf', 'wmf'],
  formats: [['svg', 'SVG'], ['pdf', 'PDF'], ['ai', 'Illustrator (AI)'], ['eps', 'EPS'], ['png', 'PNG (2×)'], ['jpg', 'JPG (2×)'], ['webp', 'WebP (2×)'], ['tif', 'TIFF (2×)'], ['psd', 'Photoshop (PSD)'], ['dxf', 'DXF'], ['emf', 'EMF'], ['vectorcraft', 'VectorCraft']],
  async open(src, out) { await vrun(src, [], [out]); },
  async model(s, file) {
    const r = await vrun(file, [['document.inspect'], ['text.fonts'], ['document.setup']]);
    const d = r['document.inspect'] || {};
    const objects = [], layers = [];
    const visit = (layer, depth) => {
      layers.push({ id: layer.id, name: layer.name, visible: layer.visible !== false, locked: !!layer.locked, depth });
      for (const n of layer.children || []) {
        if (n.kind === 'Layer') { visit(n, depth + 1); continue; }
        objects.push({ id: n.id, kind: n.kind, name: n.name, layer: layer.id, bounds: n.bounds, fill: n.fill, stroke: n.stroke, strokeWidth: n.strokeWidth, opacity: Math.round((n.opacity ?? 1) * 100), text: n.text, visible: n.visible !== false && layer.visible !== false, locked: !!n.locked || !!layer.locked });
      }
    };
    (d.layers || []).forEach((l) => visit(l, 0));
    const colors = objects.length ? ((await vrun(file, [['select.all'], ['recolor.colors']]).catch(() => ({})))['recolor.colors']?.colors || []) : [];
    return {
      artboards: (d.artboards || []).map((a, i) => ({ index: i, name: a.name, x: a.x, y: a.y, w: a.width, h: a.height })),
      objects, layers, colors: colors.map((c) => ({ hex: c.hex, key: c.key, count: c.count, swatch: c.swatch || null })),
      fonts: (r['text.fonts'] || []).map((f) => ({ family: f.family, style: f.style, status: f.status })),
      colorMode: String(d.colorMode || 'rgb').toLowerCase(), units: d.units, background: r['document.setup']?.backgroundContents || 'transparent',
    };
  },
  async apply(s, cur, next, op, p) {
    const fn = VECTOR_OPS[op];
    if (!fn) throw new Error(`Unknown edit ${op}`);
    const r = await vrun(cur, [...fn(p), ['select.none']], [next]).catch((e) => {
      if (/^Nothing selected/.test(e.message)) throw new Error(op === 'outlineText' ? 'There’s no text to outline.' : 'There’s nothing to change: the artboards are empty.');
      throw e;
    });
    // What an edit made is selected afterwards, as in the app.
    const made = Object.entries(r).filter(([k]) => /^(text\.create|shape\.|object\.group|object\.pathfinder\.|imageTrace\.makeAndExpand|file\.place)/.test(k)).map(([, v]) => v?.ids || (v?.id != null ? [v.id] : [])).pop();
    if (made?.length && op !== 'trace' && op !== 'place') return { select: made };
    if (op === 'findReplace') return { note: r['edit.findReplace']?.count ? `Replaced ${plural(r['edit.findReplace'].count, 'time')}` : `“${p.find}” wasn’t found`, unchanged: !r['edit.findReplace']?.count };
    if (op === 'simplify') { const x = r['object.path.simplify']; return x ? { note: `${x.before} → ${x.after} anchor points` } : {}; }
    if (op === 'trace') { const x = r['imageTrace.makeAndExpand']; return x ? { note: `Traced: ${plural(x.paths, 'shape')}, ${plural(x.colors, 'colour')}`, select: [x.id] } : {}; }
    if (op === 'place') return { select: r['file.place']?.ids || [] };
    if (op === 'outlineText') return { note: `${plural(r['type.createOutlines']?.ids?.length || 0, 'text object')} turned into shapes` };
    if (op === 'recolor' && !r['recolor.apply']?.changed) return { unchanged: true, note: 'Nothing has that colour' };
    return {};
  },
  async render(s, file, index, scale, out) {
    await vrun(file, [['document.export', { path: out, format: 'png', artboard: index || 0, scale: Math.max(0.05, Math.min(16, scale)) }]]);
    return out;
  },
  async save(s, file, target) {
    const ext = U.ext(target);
    if (ext === 'vectorcraft') { await fsp.copyFile(file, target); return target; }
    if (['png', 'jpg', 'webp', 'tif', 'tiff', 'bmp', 'gif'].includes(ext)) { await vrun(file, [['document.export', { path: target, artboard: 0, scale: 2 }]]); return target; }
    await vrun(file, [], [target]);
    return target;
  },
};

// ── DesignCraft ─────────────────────────────────────────────────────────────────────────────────────────────────────
const dargs = (cmds) => cmds.flatMap(([id, params]) => ['--cmd', `${id}=${JSON.stringify(params || {})}`]);
async function drun(input, cmds, more = []) {
  const r = await exec('designcraft', ['run', '--in', input, ...dargs(cmds), ...more]);
  return jsonLines(r.stdout);
}
function cmykHex({ c = 0, m = 0, y = 0, k = 0 }) { return rgbHex([(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]); }
const colorHex = (c) => (!c ? null : c.model === 'rgb' ? rgbHex([c.r, c.g, c.b]) : c.model === 'cmyk' ? cmykHex(c) : c.model === 'gray' ? rgbHex([1 - (c.k ?? 0), 1 - (c.k ?? 0), 1 - (c.k ?? 0)]) : c.model === 'lab' ? null : null);
function docJson(file) {
  try {
    const { unzipSync, strFromU8 } = require('fflate');
    const z = unzipSync(fs.readFileSync(file), { filter: (f) => f.name === 'document.json' });
    return JSON.parse(strFromU8(z['document.json']));
  } catch (_) { return {}; }
}
const DESIGN_OPS = {
  findChange: (p) => [['find.change', { find: String(p.find), change: String(p.change ?? ''), grep: !!p.grep, caseSensitive: !!p.caseSensitive, wholeWord: !!p.wholeWord }]],
  storyText: (p) => [['story.setText', { story: p.story, text: String(p.text ?? '') }]],
  fontReplace: (p) => [['font.replace', { family: p.family, ...(p.style ? { style: p.style } : {}), toFamily: p.toFamily, ...(p.toStyle ? { toStyle: p.toStyle } : {}) }]],
  swatch: (p) => [['swatch.options', { name: p.name, color: p.color }]],
  insertPages: (p) => [['layout.pages.insert', { count: Number(p.count) || 1, ...(p.after != null ? { after: p.after } : {}) }]],
  deletePages: (p) => [['layout.pages.delete', { pages: p.pages }]],
  movePage: (p) => [['layout.pages.move', { from: p.from, to: p.to }]],
  duplicatePage: (p) => [['layout.pages.duplicateSpread', { spread: p.spread }]],
  setup: (p) => [
    ...((p.width || p.height || p.facingPages != null || p.bleed != null) ? [['layout.documentSetup', { ...(p.width ? { width: Number(p.width) } : {}), ...(p.height ? { height: Number(p.height) } : {}), ...(p.facingPages != null ? { facingPages: !!p.facingPages } : {}), ...(p.bleed != null ? { bleed: Number(p.bleed) } : {}), adjustLayout: true }]] : []),
    ...((p.margins != null || p.columns || p.gutter != null) ? [['layout.marginsAndColumns', { ...(p.margins != null ? { margins: Number(p.margins) } : {}), ...(p.columns ? { columns: Number(p.columns) } : {}), ...(p.gutter != null ? { gutter: Number(p.gutter) } : {}), adjustLayout: true }]] : []),
  ],
  deleteItems: (p) => [['edit.clear', { ids: p.ids }]],
  itemFill: (p) => [['object.fill', { ids: p.ids, swatch: p.swatch }]],
  itemOpacity: (p) => [['object.opacity', { ids: p.ids, opacity: Math.max(0, Math.min(1, Number(p.value) / 100)) }]],
};
const design = {
  native: 'designcraft',
  writes: ['designcraft', 'idml'],
  formats: [['idml', 'InDesign (IDML)'], ['pdf', 'PDF'], ['epub', 'EPUB'], ['html', 'Web page (HTML)'], ['pptx', 'PowerPoint'], ['txt', 'Text'], ['designcraft', 'DesignCraft']],
  async open(src, out) {
    if (U.ext(src) === 'designcraft') { await fsp.copyFile(src, out); return; }
    await drun(src, [['file.save', { path: out }]]);
  },
  async model(s, file) {
    const [d = {}, fonts = []] = await drun(file, [['document.inspect'], ['font.list']]);
    const pages = [], items = [];
    for (const sp of d.spreads || []) {
      const ps = (sp.pages || []).map((pg) => ({ index: pg.index, name: pg.name, spread: sp.index, x: pg.bounds[0], y: pg.bounds[1], w: pg.bounds[2] - pg.bounds[0], h: pg.bounds[3] - pg.bounds[1], margins: pg.margins, columns: pg.columns, parent: pg.parent }));
      pages.push(...ps);
      for (const it of sp.items || []) {
        const [x0, y0, x1, y1] = it.bounds, cx = (x0 + x1) / 2;
        const pg = ps.find((q) => cx >= q.x && cx <= q.x + q.w) || ps[0];
        if (pg) items.push({ id: it.id, kind: String(it.kind || '').replace(/[<>]/g, ''), page: pg.index, x: x0 - pg.x, y: y0 - pg.y, w: x1 - x0, h: y1 - y0, story: it.story ?? null, fill: it.fill, locked: !!it.locked, hidden: !!it.hidden });
      }
    }
    pages.sort((a, b) => a.index - b.index);
    const doc = docJson(file);
    const swatches = (doc.swatches || []).filter((w) => w.value?.kind === 'color' || w.value?.kind === 'paper').map((w) => ({ name: w.name, hex: colorHex(w.value.color), locked: !!w.locked }));
    return {
      title: d.title, pages, items, settings: d.settings || {}, swatches, paragraphStyles: d.paragraphStyles || [],
      stories: (d.stories || []).map((st) => ({ id: st.id, preview: st.preview, length: st.length, overset: !!st.overset, frames: st.frames })),
      fonts: fonts.map((f) => ({ family: f.family, style: f.style, missing: !!f.missing || f.matchStatus === 'missing', status: f.matchStatus })),
    };
  },
  async apply(s, cur, next, op, p) {
    const fn = DESIGN_OPS[op];
    if (!fn) throw new Error(`Unknown edit ${op}`);
    // A CMYK swatch stays CMYK, so a print document doesn't gain RGB colours.
    if (op === 'swatch' && /^#[0-9a-f]{6}$/i.test(p.color) && (docJson(cur).swatches || []).find((w) => w.name === p.name)?.value?.color?.model === 'cmyk') {
      const [r, g, b] = hexRgb(p.color), k = 1 - Math.max(r, g, b), pc = (x) => Math.round((k >= 1 ? 0 : (1 - x - k) / (1 - k)) * 1000) / 10;
      p = { ...p, color: { c: pc(r), m: pc(g), y: pc(b), k: Math.round(k * 1000) / 10 } };
    }
    const res = await drun(cur, [...fn(p), ['file.save', { path: next }]]);
    if (op === 'findChange') { const n = res.find((x) => x && typeof x.count === 'number')?.count || 0; return { note: n ? `Changed ${plural(n, 'time')}` : `“${p.find}” wasn’t found`, unchanged: !n }; }
    if (op === 'fontReplace') { const n = res.find((x) => x && typeof x.changed === 'number')?.changed; return n != null ? { note: `${plural(n, 'run')} of text changed` } : {}; }
    return {};
  },
  async query(s, file, what, p) {
    if (what === 'story') { const [st] = await drun(file, [['story.get', { story: p.story }]]); return st; }
    if (what === 'find') { const [m] = await drun(file, [['find.find', { find: String(p.find), grep: !!p.grep, caseSensitive: !!p.caseSensitive, wholeWord: !!p.wholeWord }]]); return m || []; }
    if (what === 'preflight') { const [r] = await drun(file, [['preflight.run', { minPpi: Number(p.minPpi) || 150 }]]); return r || { issues: [] }; }
    if (what === 'spelling') { const [r] = await drun(file, [['spelling.check', { suggestions: true }]]); return r || []; }
    throw new Error(`Unknown query ${what}`);
  },
  async render(s, file, index, scale, out) {
    await exec('designcraft', ['run', '--in', file, '--page', String(index || 0), '--scale', String(Math.max(0.05, Math.min(8, scale))), '--export', out]);
    return out;
  },
  async save(s, file, target, opts = {}) {
    const ext = U.ext(target);
    if (ext === 'designcraft') { await fsp.copyFile(file, target); return target; }
    if (ext === 'pdf') {
      const preset = { print: { bleed: true, marks: true, standard: 'x4' }, web: { compressImages: true, tagged: true, bookmarksPanel: true }, archive: { standard: 'a2b', tagged: true } }[opts.preset] || {};
      await exec('designcraft', ['run', '--in', file, '--pdf-options', JSON.stringify(preset), '--export', target]);
      return target;
    }
    if (ext === 'epub') { await drun(file, [[opts.fixed ? 'file.exportFixedEpub' : 'file.exportEpub', { path: target }]]); return target; }
    if (ext === 'html') { await drun(file, [['file.exportHtml', { path: target }]]); return target; }
    if (ext === 'txt') {
      // Every story, in the order they appear, rather than only the one being edited.
      const got = await drun(file, (s.model?.stories || []).map((st) => ['story.get', { story: st.id }]));
      await fsp.writeFile(target, `${got.map((g) => g?.text).filter(Boolean).join('\n\n')}\n`);
      return target;
    }
    await exec('designcraft', ['run', '--in', file, '--export', target]);
    return target;
  },
};

// ── EffectCraft ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Reading and recolouring go through EffectCraft's scripting (the After Effects object model), the rest through its
// commands. Colours are compared to within 1/255.
const JSX_MODEL = `
var c = app.project.activeItem, L = [], T = [], C = [];
function near(a, b) { return Math.abs(a[0] - b[0]) < 0.004 && Math.abs(a[1] - b[1]) < 0.004 && Math.abs(a[2] - b[2]) < 0.004; }
function walk(layer, comp, p) {
  for (var i = 1; i <= p.numProperties; i++) {
    var q = p.property(i);
    if (!q) continue;
    if (q.propertyType === PropertyType.PROPERTY) { if (q.propertyValueType === PropertyValueType.COLOR && q.numKeys === 0) C.push({ layer: layer.id, comp: comp.name, name: layer.name, kind: q.name, value: q.value }); }
    else walk(layer, comp, q);
  }
}
for (var k = 1; k <= app.project.numItems; k++) {
  var it = app.project.item(k);
  if (!(it instanceof CompItem)) continue;
  for (var i = 1; i <= it.numLayers; i++) {
    var l = it.layer(i), s = l.property("Source Text");
    walk(l, it, l);
    if (s) { var d = s.value; T.push({ id: l.id, comp: it.name, name: l.name, text: d.text, fill: d.fillColor, font: d.font, size: d.fontSize }); C.push({ layer: l.id, comp: it.name, name: l.name, kind: "Text", value: d.fillColor }); }
    if (l.source && l.source.mainSource && l.source.mainSource.color) C.push({ layer: l.id, comp: it.name, name: l.name, kind: "Solid", value: l.source.mainSource.color });
  }
}
for (var i = 1; i <= c.numLayers; i++) { var l = c.layer(i); L.push({ id: l.id, index: l.index, name: l.name, inPoint: l.inPoint, outPoint: l.outPoint, startTime: l.startTime, stretch: l.stretch, enabled: l.enabled, video: l.hasVideo, kind: String(l.constructor && l.constructor.name).replace(/Layer$/, '').replace(/^AV$/, l.source instanceof CompItem ? "Composition" : (l.source && l.source.mainSource && l.source.mainSource.color ? "Solid" : "Footage")), label: l.label }); }
JSON.stringify({ comp: { id: c.id, name: c.name, width: c.width, height: c.height, fps: c.frameRate, duration: c.duration, background: c.bgColor, workStart: c.workAreaStart, workDuration: c.workAreaDuration }, layers: L, texts: T, colors: C })`;
const jsxRecolor = (from, to) => `
var from = ${JSON.stringify(hexRgb(from))}, to = ${JSON.stringify(hexRgb(to))}, n = 0;
function near(a, b) { return Math.abs(a[0] - b[0]) < 0.004 && Math.abs(a[1] - b[1]) < 0.004 && Math.abs(a[2] - b[2]) < 0.004; }
function walk(p) {
  for (var i = 1; i <= p.numProperties; i++) {
    var q = p.property(i);
    if (!q) continue;
    if (q.propertyType === PropertyType.PROPERTY) { if (q.propertyValueType === PropertyValueType.COLOR && q.numKeys === 0 && near(q.value, from)) { q.setValue([to[0], to[1], to[2], q.value.length > 3 ? q.value[3] : 1]); n++; } }
    else walk(q);
  }
}
for (var k = 1; k <= app.project.numItems; k++) {
  var it = app.project.item(k);
  if (!(it instanceof CompItem)) continue;
  for (var i = 1; i <= it.numLayers; i++) {
    var l = it.layer(i), s = l.property("Source Text");
    walk(l);
    if (s) { var d = s.value; if (near(d.fillColor, from)) { d.fillColor = to; s.setValue(d); n++; } }
    if (l.source && l.source.mainSource && l.source.mainSource.color && near(l.source.mainSource.color, from)) { l.source.mainSource.color = to; n++; }
  }
}
n`;
const jsxSpeed = (f) => `
var c = app.project.activeItem, f = ${Number(f)};
for (var i = 1; i <= c.numLayers; i++) { var l = c.layer(i), st = l.startTime; l.stretch = l.stretch / f; l.startTime = st / f; }
var ws = c.workAreaStart, wd = c.workAreaDuration;
c.duration = c.duration / f; c.workAreaStart = ws / f; c.workAreaDuration = wd / f;
c.duration`;
// Text layers are found by id in every composition, so text inside nested compositions can be changed too.
const jsxText = (p) => `
var id = ${Number(p.layer)}, done = 0;
for (var k = 1; k <= app.project.numItems && !done; k++) {
  var it = app.project.item(k);
  if (!(it instanceof CompItem)) continue;
  for (var i = 1; i <= it.numLayers; i++) {
    var l = it.layer(i), s = l.property("Source Text");
    if (l.id !== id || !s) continue;
    var d = s.value;
    ${p.text != null ? `d.text = ${JSON.stringify(String(p.text))};` : ''}
    ${p.fill ? `d.fillColor = ${JSON.stringify(hexRgb(p.fill))};` : ''}
    ${p.size ? `d.fontSize = ${Number(p.size)};` : ''}
    ${p.font ? `d.font = ${JSON.stringify(String(p.font))};` : ''}
    s.setValue(d); done = 1; break;
  }
}
done`;
async function ecScript(file, code, saveAs) {
  const r = await exec('effectcraft', ['--project', file, ...(saveAs ? ['--save-as', saveAs] : []), 'script', '--eval', code]);
  const line = String(r.stdout).split(/\r?\n/).find((l) => l.trim());
  let v = null;
  try { v = JSON.parse(line); if (typeof v === 'string' && /^[[{]/.test(v)) v = JSON.parse(v); } catch (_) {}
  return v;
}
const ecRun = (file, saveAs, cmds) => exec('effectcraft', ['--project', file, '--save-as', saveAs, 'run', ...cmds.flatMap(([id, p]) => [id, JSON.stringify(p || {})])]);
const MOTION_RENDER = { mp4: ['h264'], mov: ['prores'], webm: ['webm'], gif: ['gif'] };
const motion = {
  native: 'ecproj',
  writes: ['ecproj', 'json', 'lottie'],
  formats: [['json', 'Lottie (JSON)'], ['lottie', 'Lottie (.lottie)'], ['mp4', 'MP4 video'], ['gif', 'GIF'], ['webm', 'WebM'], ['mov', 'MOV (ProRes)'], ['png', 'PNG frames (folder)'], ['ecproj', 'EffectCraft project']],
  async open(src, out) {
    if (U.ext(src) === 'ecproj') await exec('effectcraft', ['--project', src, 'run', 'file.saveAs', JSON.stringify({ path: out })]);
    else await exec('effectcraft', ['--empty', '--save-as', out, 'run', 'file.importLottie', JSON.stringify({ path: src })]);
  },
  async model(s, file) {
    const m = await ecScript(file, JSX_MODEL);
    if (!m?.comp) throw new Error('EffectCraft couldn’t read this animation.');
    // Colours used anywhere, the most used first, each with the layers that have it.
    const groups = new Map();
    for (const c of m.colors) { const hx = rgbHex(c.value); const g = groups.get(hx) || { hex: hx, uses: [] }; g.uses.push(`${c.name} (${String(c.kind).replace(/^Color$/, 'colour').toLowerCase()})`); groups.set(hx, g); }
    return { comp: { ...m.comp, background: rgbHex(m.comp.background || [0, 0, 0]) }, layers: m.layers, texts: m.texts.map((t) => ({ ...t, fill: rgbHex(t.fill || [1, 1, 1]) })), colors: [...groups.values()].sort((a, b) => b.uses.length - a.uses.length) };
  },
  async apply(s, cur, next, op, p) {
    const m = s.model;
    const all = (m?.layers || []).map((l) => l.id);
    if (op === 'recolor') { const n = await ecScript(cur, jsxRecolor(p.from, p.to), next); return n ? {} : { unchanged: true, note: 'Nothing has that colour' }; }
    if (op === 'speed') { await ecScript(cur, jsxSpeed(Number(p.factor) || 1), next); return { note: `${Number(p.factor)}× speed` }; }
    if (op === 'text') { if (!(await ecScript(cur, jsxText(p), next))) throw new Error('That text layer isn’t there any more.'); return {}; }
    const cmds = {
      comp: () => [['comp.settings', { ...(p.width ? { width: Math.round(p.width) } : {}), ...(p.height ? { height: Math.round(p.height) } : {}), ...(p.fps ? { frameRate: Number(p.fps) } : {}), ...(p.duration ? { duration: Number(p.duration) } : {}), ...(p.background ? { background: p.background } : {}), anchor: 4 }]],
      trim: () => [['comp.workArea', { start: Number(p.start) || 0, end: Number(p.end) }], ['comp.trimToWorkArea', {}]],
      visible: () => [['layer.setSwitch', { layers: [p.layer], switch: 'video', value: !!p.value }]],
      deleteLayer: () => [['edit.clear', { layers: [p.layer] }]],
      opacity: () => [['layer.setTransform', { layers: [p.layer], prop: 'opacity', value: Number(p.value) }]],
      rename: () => [['layer.rename', { layer: p.layer, name: String(p.name) }]],
      reverse: () => [['layer.timeReverse', { layers: all }]],
    }[op];
    if (!cmds) throw new Error(`Unknown edit ${op}`);
    await ecRun(cur, next, cmds());
    return {};
  },
  async render(s, file, time, maxSide, out, opts = {}) {
    await exec('effectcraft', ['--project', file, 'render-frame', '--time', String(Math.max(0, Number(time) || 0)), '--max-side', String(Math.round(Math.max(64, Math.min(4096, maxSide)))), '--out', out, ...(opts.transparent ? ['--transparent'] : [])]);
    return out;
  },
  async preview(s, file, out) {
    await exec('effectcraft', ['--project', file, 'render', '--out', out, '--format', 'h264', '--resolution', s.model.comp.width > 1280 ? 'quarter' : 'half', '--audio', 'off'], { timeout: 600000 });
    return out;
  },
  async save(s, file, target, opts = {}) {
    const ext = U.ext(target);
    if (ext === 'ecproj') { await exec('effectcraft', ['--project', file, 'run', 'file.saveAs', JSON.stringify({ path: target })]); return target; }
    if (ext === 'json' || ext === 'lottie') { await exec('effectcraft', ['--project', file, 'run', 'file.exportLottie', JSON.stringify({ path: target })]); return target; }
    if (ext === 'png') {
      const dir = target.replace(/\.png$/i, '');
      await fsp.mkdir(dir, { recursive: true });
      await exec('effectcraft', ['--project', file, 'render', '--out', path.join(dir, `${U.sanitize(U.base(s.file))}.png`), '--format', 'png', '--channels', 'rgba'], { timeout: 900000 });
      return dir;
    }
    const [format] = MOTION_RENDER[ext] || MOTION_RENDER.mp4;
    const alpha = opts.transparent && (ext === 'gif' || ext === 'mov' || ext === 'webm');
    await exec('effectcraft', ['--project', file, 'render', '--out', target, '--format', format, ...(alpha ? ['--channels', 'rgba', ...(ext === 'mov' ? ['--prores', '4444'] : [])] : []), ...(ext === 'gif' ? ['--resolution', 'half'] : [])], { timeout: 900000 });
    return target;
  },
};

// ── FilmCraft ───────────────────────────────────────────────────────────────────────────────────────────────────────
async function frun(project, steps, saveAs) {
  const dir = await U.tmpDir('film');
  try {
    const script = path.join(dir, 'steps.jsonl');
    await fsp.writeFile(script, steps.map((x) => JSON.stringify(x)).join('\n'));
    const r = await exec('filmcraft', ['--compact', ...(project ? ['--project', project] : []), ...(saveAs ? ['--save-as', saveAs] : []), 'run', script], { okCodes: [1] });
    const lines = jsonLines(r.stdout), bad = lines.find((l) => l.ok === false);
    if (bad) throw new Error(clean(bad.error));
    if (lines.length < steps.length) throw new Error(clean(r.stderr) || 'FilmCraft couldn’t finish.');
    return lines.map((l) => l.result);
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const INTERCHANGE = { otio: 'otio', fcpxml: 'fcpxml', xml: 'xml', edl: 'edl', aaf: 'aaf', omf: 'omf' };
const frames = (ticks, fps) => Math.round((ticks / TICKS) * fps);
const film = {
  native: 'fcproj',
  writes: ['fcproj', 'otio', 'fcpxml', 'xml', 'edl', 'aaf', 'omf'],
  formats: [['otio', 'OpenTimelineIO'], ['fcpxml', 'Final Cut (FCPXML)'], ['xml', 'Premiere / Resolve (XML)'], ['edl', 'EDL (CMX 3600)'], ['aaf', 'Avid (AAF)'], ['mp4', 'MP4 video'], ['mov', 'MOV (ProRes)'], ['fcproj', 'FilmCraft project']],
  async open(src, out) {
    if (U.ext(src) === 'fcproj') { await frun(src, [{ id: 'file.saveAs', params: { path: out } }]); return; }
    const [r] = await frun(null, [{ id: 'file.import', params: { paths: [src] } }], out);
    const doc = r?.documents?.[0];
    if (!r?.sequences?.length && !doc?.sequences?.length) throw new Error((r?.errors || []).join(' ') || 'FilmCraft found no timeline in this file.');
  },
  async model(s, file) {
    const r = await exec('filmcraft', ['--compact', '--project', file, 'inspect', 'sequence']);
    const q = JSON.parse(String(r.stdout).trim() || '{}');
    if (!q.id) throw new Error('FilmCraft found no timeline in this file.');
    s.sequence = q.id;
    const fr = q.settings?.frame_rate || { num: 24, den: 1 }, fps = fr.num / fr.den;
    const track = (kind) => (t, i) => ({
      id: t.id, kind, label: `${kind === 'video' ? 'V' : 'A'}${i + 1}`, name: t.name, muted: !!t.muted, locked: !!t.locked, syncLock: t.syncLock !== false,
      clips: (t.items || []).map((c) => ({ id: c.clip, name: c.name, start: c.startFrame, end: c.endFrame, duration: c.durationFrames, item: c.item, link: c.link, speed: c.speed, reverse: !!c.reverse, enabled: c.enabled !== false, gain: c.gainDb || 0, sourceIn: c.sourceIn, sourceOut: c.sourceOut, label: c.label })),
      transitions: (t.transitions || []).map((x) => ({ id: x.id, effect: x.effect, from: x.from, to: x.to, start: frames(x.start, fps), duration: frames(x.duration, fps) })),
    });
    return {
      name: q.name, fps, width: q.settings?.width, height: q.settings?.height, duration: q.durationFrames,
      video: (q.video || []).map(track('video')), audio: (q.audio || []).map(track('audio')),
      markers: (q.markers || []).map((mk) => ({ id: mk.id, name: mk.name, color: mk.color, at: frames(mk.start, fps) })),
    };
  },
  async apply(s, cur, next, op, p) {
    const m = s.model, at = (f) => Math.round((f / m.fps) * TICKS);
    const tracks = [...m.video, ...m.audio];
    // Sync locks would refuse ripples that the other tracks are in the way of, so ripples are made with them off.
    const unsync = (steps) => [...tracks.map((t) => ({ id: 'timeline.setTrack', params: { track: t.id, syncLock: false } })), ...steps, ...tracks.map((t) => ({ id: 'timeline.setTrack', params: { track: t.id, syncLock: t.syncLock } }))];
    const clipOf = (id) => { for (const t of tracks) { const i = t.clips.findIndex((c) => c.id === id); if (i >= 0) return { t, i, c: t.clips[i] }; } return null; };
    let steps;
    if (op === 'remove') steps = p.ripple ? unsync([{ id: 'edit.rippleDelete', params: { clips: p.clips } }]) : [{ id: 'edit.clear', params: { clips: p.clips } }];
    else if (op === 'trim') steps = unsync([{ id: 'timeline.trim', params: { clip: p.clip, edge: p.edge === 'in' ? 'in' : 'out', mode: p.ripple === false ? 'regular' : 'ripple', deltaFrames: Math.round(Number(p.frames) || 0) } }]);
    else if (op === 'split') steps = [{ id: 'timeline.razor', params: { time: at(p.frame), ...(p.clip ? { clip: p.clip } : {}) } }];
    else if (op === 'speed') steps = unsync([{ id: 'clip.speedDuration', params: { clips: p.clips, speed: Number(p.speed) || 100, reverse: !!p.reverse, ripple: true } }]);
    else if (op === 'rename') steps = [{ id: 'clip.rename', params: { clip: p.clip, name: String(p.name) } }];
    else if (op === 'enable') steps = [{ id: 'clip.enable', params: { clips: p.clips } }];
    else if (op === 'gain') steps = [{ id: 'clip.audioGain', params: { clips: p.clips, mode: 'set', db: Number(p.db) || 0 } }];
    else if (op === 'look') steps = [{ id: 'lumetri.applyPreset', params: { name: p.name, ...(p.clips?.length ? { clips: p.clips } : { clips: m.video.flatMap((t) => t.clips.map((c) => c.id)) }) } }];
    else if (op === 'transition') steps = [{ id: 'sequence.applyVideoTransition', params: { clip: p.clip, effect: p.effect || 'cross_dissolve', edge: p.edge === 'in' ? 'in' : 'out', frames: Math.round(m.fps) } }];
    else if (op === 'title') steps = [{ id: 'graphics.newText', params: { text: String(p.text || 'Title'), seconds: Number(p.seconds) || 3, time: at(p.frame || 0), size: Number(p.size) || 100 } }];
    else if (op === 'sequence') steps = [{ id: 'sequence.settings', params: { ...(p.width ? { width: Math.round(p.width) } : {}), ...(p.height ? { height: Math.round(p.height) } : {}), ...(p.fps ? { fps: Number(p.fps) } : {}), ...(p.name ? { name: String(p.name) } : {}), scaleMotion: true } }];
    else if (op === 'move') {
      // Swap the clip with its neighbour on the track: linked sound goes with it.
      const a = clipOf(p.clip);
      if (!a) throw new Error('That clip isn’t on the timeline any more.');
      const j = p.dir === 'earlier' ? a.i - 1 : a.i + 1, b = a.t.clips[j];
      if (!b) throw new Error(p.dir === 'earlier' ? 'It’s already the first clip.' : 'It’s already the last clip.');
      const [first, second] = j < a.i ? [b, a.c] : [a.c, b];
      steps = unsync([{ id: 'timeline.move', params: { moves: [{ clip: second.id, track: a.t.id, time: at(first.start) }, { clip: first.id, track: a.t.id, time: at(first.start + second.duration) }], insert: false } }]);
    } else throw new Error(`Unknown edit ${op}`);
    await frun(cur, [{ id: 'sequence.open', params: { item: s.sequence } }, ...steps], next);
    return {};
  },
  async query(s, file, what) {
    if (what === 'looks') return (await frun(file, [{ id: 'lumetri.presets', params: {} }]))[0]?.presets || [];
    throw new Error(`Unknown query ${what}`);
  },
  async render(s, file, frame, scale, out) {
    await exec('filmcraft', ['--compact', '--project', file, 'render', '--seconds', String(Math.max(0, frame / s.model.fps)), '--out', out, '--scale', String(Math.max(0.05, Math.min(1, scale))), '--allow-offline'], { okCodes: [1] });
    if (!exists(out)) throw new Error('FilmCraft couldn’t draw this frame.');
    return out;
  },
  // A picture of each clip's own media from the middle of the part that is used, all in one run.
  async thumbs(s, file, list, dir) {
    const todo = list.filter((c) => !exists(path.join(dir, `t-${c.item}-${c.at}.jpg`)));
    if (todo.length) {
      await frun(file, [{ id: 'sequence.open', params: { item: s.sequence } }, ...todo.map((c) => ({ id: 'file.exportFrame', params: { path: path.join(dir, `t-${c.item}-${c.at}.png`), format: 'png', target: 'source', item: c.item, time: c.at } }))]).catch(() => null);
      const sharp = require('sharp');
      for (const c of todo) {
        const png = path.join(dir, `t-${c.item}-${c.at}.png`);
        if (exists(png)) { await sharp(png).resize(240, 135, { fit: 'cover' }).jpeg({ quality: 78 }).toFile(path.join(dir, `t-${c.item}-${c.at}.jpg`)).catch(() => {}); fsp.rm(png, { force: true }).catch(() => {}); }
      }
    }
    const out = {};
    for (const c of list) { const f = path.join(dir, `t-${c.item}-${c.at}.jpg`); if (exists(f)) out[c.key] = await fsp.readFile(f); }
    return out;
  },
  async preview(s, file, out) {
    await exec('filmcraft', ['--compact', '--project', file, 'export', out, '--preset', 'Match Source – Adaptive Low Bitrate', '--scale', s.model.width > 1280 ? '0.25' : '0.5', '--allow-offline'], { timeout: 900000, okCodes: [1] });
    if (!exists(out)) throw new Error('FilmCraft couldn’t render a preview.');
    return out;
  },
  async save(s, file, target, opts = {}) {
    const ext = U.ext(target);
    if (ext === 'fcproj') { await frun(file, [{ id: 'file.saveAs', params: { path: target } }]); return target; }
    if (INTERCHANGE[ext]) { await frun(file, [{ id: 'sequence.open', params: { item: s.sequence } }, { id: 'file.exportInterchange', params: { format: INTERCHANGE[ext], path: target } }]); return target; }
    const args = ['--compact', '--project', file, 'export', target, '--allow-offline'];
    if (ext === 'mov') args.push('--preset', 'Apple ProRes 422');
    else if (opts.scale) args.push('--scale', String(opts.scale));
    await exec('filmcraft', args, { timeout: 1800000, okCodes: [1] });
    if (!exists(target)) throw new Error('FilmCraft finished without writing a file. Keep the timeline’s media next to it.');
    return target;
  },
};

const APPS = { vectorcraft: vector, designcraft: design, effectcraft: motion, filmcraft: film };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const get = (id) => { const s = sessions.get(id); if (!s) throw new Error('This file was closed.'); return s; };
const cur = (s) => s.versions[s.at];

function state(s, extra = {}) {
  return { id: s.id, app: s.app, file: s.file, ext: s.ext, saveExt: s.saveExt, model: s.model, version: s.at, step: s.n, canUndo: s.at > 0, canRedo: s.at < s.versions.length - 1, dirty: s.at !== s.savedAt, rev: path.basename(cur(s) || ''), labels: s.labels.slice(0, s.versions.length), ...extra };
}
async function open(file, app) {
  const A = APPS[app];
  if (!A) throw new Error(`No editor for ${app}`);
  const dir = await U.tmpDir('studio');
  const s = { id: ++seq, app, file, ext: U.ext(file), dir, versions: [], labels: [], at: 0, n: 0, savedAt: 0, cache: new Map(), models: new Map() };
  const v0 = path.join(dir, `v0.${A.native}`);
  try {
    await A.open(file, v0);
    if (!exists(v0)) throw new Error(`${crafts.APPS[app].name} couldn’t open this file.`);
    s.versions.push(v0);
    s.labels.push('Opened');
    s.model = await A.model(s, v0);
    s.models.set(v0, s.model);
  } catch (e) {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
  // Save keeps the original format where the app can write it, else the app's own.
  s.saveExt = A.writes.includes(s.ext) ? s.ext : A.native;
  sessions.set(s.id, s);
  return state(s, { formats: A.formats, families: app === 'vectorcraft' || app === 'designcraft' ? await families() : [] });
}
// One change at a time for each file: the next starts from what the last one made.
function queue(s, fn) {
  const run = (s.queue || Promise.resolve()).catch(() => {}).then(fn);
  s.queue = run;
  return run;
}
const apply = (id, op, params = {}, label) => { const s = get(id); return queue(s, () => change(s, op, params, label)); };
async function change(s, op, params, label) {
  const A = APPS[s.app];
  const next = path.join(s.dir, `v${++s.n}.${A.native}`);
  const res = (await A.apply(s, cur(s), next, op, params)) || {};
  if (res.unchanged) { fsp.rm(next, { force: true }).catch(() => {}); return state(s, { note: res.note, unchanged: true }); }
  if (!exists(next)) throw new Error(`${crafts.APPS[s.app].name} couldn’t make that change.`);
  for (const old of s.versions.splice(s.at + 1)) fsp.rm(old, { force: true }).catch(() => {});
  s.labels.splice(s.at + 1);
  if (s.savedAt > s.at) s.savedAt = -1;
  s.versions.push(next);
  s.labels.push(label || op);
  s.at = s.versions.length - 1;
  s.model = await A.model(s, next);
  s.models.set(next, s.model);
  return state(s, { note: res.note, select: res.select });
}
async function move(s, to) {
  s.at = Math.max(0, Math.min(s.versions.length - 1, to));
  const f = cur(s);
  s.model = s.models.get(f) || (await APPS[s.app].model(s, f));
  s.models.set(f, s.model);
  return state(s);
}
const undo = (id) => { const s = get(id); return queue(s, () => move(s, s.at - 1)); };
const redo = (id) => { const s = get(id); return queue(s, () => move(s, s.at + 1)); };
const goto = (id, at) => { const s = get(id); return queue(s, () => move(s, Number(at))); };

// Previews are cached for each step: an artboard or page at a scale, a frame of the animation or of the timeline.
async function render(id, what, scale, opts = {}) {
  const s = get(id), f = cur(s), A = APPS[s.app];
  const key = `${path.basename(f)}-${what}-${Number(scale).toFixed(3)}-${opts.transparent ? 't' : ''}`;
  if (!s.cache.has(key)) {
    const out = path.join(s.dir, `r-${s.cache.size}.png`);
    s.cache.set(key, A.render(s, f, what, scale, out, opts).then((p) => fsp.readFile(p)).finally(() => fsp.rm(out, { force: true }).catch(() => {})));
    s.cache.get(key).catch(() => s.cache.delete(key));
  }
  return s.cache.get(key);
}
// A small video of the whole thing, for playing back: made once for each step.
const previews = new Map();
async function preview(id) {
  const s = get(id), f = cur(s), A = APPS[s.app];
  if (!A.preview) return null;
  const out = path.join(s.dir, `p-${path.basename(f)}.mp4`);
  if (!previews.has(out)) { previews.set(out, A.preview(s, f, out)); previews.get(out).catch(() => previews.delete(out)); }
  return previews.get(out);
}
async function thumbs(id, list) {
  const s = get(id), A = APPS[s.app];
  if (!A.thumbs) return {};
  await fsp.mkdir(path.join(s.dir, 'thumbs'), { recursive: true });
  return A.thumbs(s, cur(s), list, path.join(s.dir, 'thumbs'));
}
async function query(id, what, params = {}) {
  const s = get(id), A = APPS[s.app];
  if (!A.query) throw new Error('Nothing to look up here.');
  return A.query(s, cur(s), what, params);
}
// Save: "<name> (edited).<ext>" beside the original unless a path is given. The original is never written over.
async function save(id, target, opts = {}) {
  const s = get(id), A = APPS[s.app];
  const out = target || path.join(path.dirname(s.file), `${U.base(s.file)} (edited).${s.saveExt}`);
  if (path.resolve(out) === path.resolve(s.file)) throw new Error('Choose a new name: the original stays as it was.');
  await fsp.mkdir(path.dirname(out), { recursive: true });
  const wrote = await A.save(s, cur(s), out, opts);
  if (!exists(wrote)) throw new Error(`${crafts.APPS[s.app].name} finished without writing a file.`);
  if (!target || U.ext(out) === s.saveExt) s.savedAt = s.at;
  return { path: wrote, ...state(s) };
}

// The app's one-click actions from the wheel, run on the working copy as it is now. What they make goes beside the
// original file, as it would from the wheel.
// The working copy is handed over in the format Save writes, so the actions are the ones the wheel offers for that file.
const probeFile = (s) => (s.saveExt === s.ext ? s.file : path.join(s.dir, `probe.${s.saveExt}`));
function toolList(id) {
  const s = get(id), tools = require('./tools');
  return tools.TOOLS.filter((t) => t.craft === s.app && t.run && tools.accepts(t, [probeFile(s)]))
    .sort((a, b) => (a.prio ?? 50) - (b.prio ?? 50))
    .map((t) => ({ id: t.id, name: t.name, desc: t.desc, options: t.options || [], save: t.save || 'file' }));
}
async function runTool(id, toolId, opts = {}) {
  const s = get(id), tools = require('./tools'), t = tools.get(toolId);
  if (!t?.run || t.craft !== s.app) throw new Error('That action isn’t available here.');
  const dir = path.join(s.dir, `tool-${++s.n}`);
  await fsp.mkdir(dir, { recursive: true });
  try {
    const work = path.join(dir, `${U.base(s.file)}.${s.saveExt}`);
    await APPS[s.app].save(s, cur(s), work);
    const ctx = { signal: undefined, out: U.outputPlanner({ dest: { kind: 'dir', path: path.dirname(s.file) } }), host: async () => null, progress: () => {} };
    const res = await t.run([work], opts, ctx);
    return (Array.isArray(res) ? res : [res]).flat(Infinity).filter(Boolean).map((r) => (typeof r === 'string' ? { path: r } : { path: r.path || null, note: r.note || '', text: r.text || '' }));
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function close(id) {
  const s = sessions.get(id);
  if (!s) return true;
  sessions.delete(id);
  for (const k of previews.keys()) if (k.startsWith(s.dir)) previews.delete(k);
  await fsp.rm(s.dir, { recursive: true, force: true }).catch(() => {});
  return true;
}

module.exports = { open, apply, undo, redo, goto, render, preview, thumbs, query, save, toolList, runTool, close };
