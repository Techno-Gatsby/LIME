import { icon, GROUP_ICON } from './icons.js';
import { wedge, labelAt, arc, limeSvg, hitIndex } from './petal.js';
import { api, $, $$, h, esc, nameOf, dirOf, extOf, fmtBytes, clean, applyTheme, defaultsFor, missingRequired, visible, form } from './ui.js';

const R_IN = 60, R_OUT = 138, R_LABEL = 100, R_PROG = 142.5, LIFT = 5, DWELL = 450;
// The lime's window has room left of and below the lime for its shadow, which would otherwise be cut off.
const TAB = 76, PAD_L = 10, PAD_B = 20;
const SIZES = { s: 0.88, m: 1, l: 1.14 };
const MODES = [['convert', 'Convert'], ['tools', 'Tools'], ['apps', 'Apps'], ['more', 'More']];
// Each ArtCraft app's mark in the middle of the wheel: an icon and its colour.
const APP_LOOK = { photocraft: ['image', '#2f7fe0'], lightcraft: ['sun', '#e0851f'], vectorcraft: ['pen', '#e2553f'], designcraft: ['layers', '#8b5cf6'], effectcraft: ['sparkle', '#d946a8'], filmcraft: ['video', '#0f9d9a'], pdfcraft: ['pdf', '#d93b3b'] };
const isMac = api.platform === 'darwin';
const stage = $('#stage'), wheelEl = $('.wheel'), svg = $('.dial'), petalsG = $('.petals'), center = $('.center'), pill = $('.pill'), card = $('.card');
const capName = $('.caption .name'), capMeta = $('.caption .meta');

let settings = await applyTheme();
const catalog = Object.fromEntries((await api.invoke('catalog')).map((t) => [t.id, t]));
const S = { state: 'idle', files: [], items: null, mode: 'convert', hot: -1, ring: [], job: null, result: null, last: null, thumbs: new Map(), info: null, cardFor: null, over: false, peek: null, baseMode: 'convert', modKey: null, app: null, home: null, homeOn: false };
let k = SIZES[settings.size] || 1;
let collapseT = null, foldT = null, shown = 'tab', geo = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
$('.tab-lime').insertAdjacentHTML('afterbegin', limeSvg(52, '', k));

async function layout() {
  const open = S.state !== 'idle';
  const cardH = card.hidden ? 0 : Math.min(card.scrollHeight, 380) + 14;
  const L = open ? { w: 330, h: cardH ? 364 + cardH : 416, cx: 165, cy: 194 } : { w: TAB + PAD_L, h: TAB + PAD_B, cx: PAD_L + TAB / 2, cy: TAB / 2 };
  const growing = open && shown === 'tab';
  if (growing) stage.classList.add('pre');
  stage.style.setProperty('--w', `${L.w}px`);
  stage.style.setProperty('--h', `${L.h}px`);
  stage.style.setProperty('--cx', `${L.cx}px`);
  stage.style.setProperty('--cy', `${L.cy}px`);
  stage.style.setProperty('--k', k);
  const at = growing ? S.bloomAt : null;
  S.bloomAt = null;
  shown = open ? 'open' : 'tab';
  const r = await api.invoke('wheel:layout', { w: Math.ceil(L.w * k), h: Math.ceil(L.h * k), ax: Math.round(L.cx * k), ay: Math.round(L.cy * k), mode: open ? 'open' : 'tab', at: at || undefined });
  if (r) geo = r;
  if (growing) { if (S.pop) popIn(); else bloomFrom(at || r?.tab); }
  S.pop = false;
  return r;
}
// Where the wheel grows from or folds toward, kept inside the window: the lime at the edge can be far outside it
// (after a Shift-drag or a move), and an animation heading there was cut off half-way.
function offsetTo(pt) {
  if (!pt || !geo) return { x: 120, y: 0 };
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  return { x: cl((pt.x - geo.bounds.x) / k - 165, -125, 125), y: cl((pt.y - geo.bounds.y) / k - 194, -150, 180) };
}
function bloomFrom(pt) {
  const o = offsetTo(pt);
  stage.style.setProperty('--ox', `${o.x}px`);
  stage.style.setProperty('--oy', `${o.y}px`);
  stage.classList.remove('folding');
  stage.classList.add('blooming');
  requestAnimationFrame(() => stage.classList.remove('pre'));
  clearTimeout(bloomFrom.t);
  bloomFrom.t = setTimeout(() => stage.classList.remove('blooming'), 900);
}
function popIn() {
  stage.classList.remove('folding');
  stage.classList.add('popping');
  requestAnimationFrame(() => stage.classList.remove('pre'));
  clearTimeout(popIn.t);
  popIn.t = setTimeout(() => stage.classList.remove('popping'), 500);
}
// One fold at a time: two at once (a timer and the end of a drag) used to race each other.
let folding = null;
const fold = (o) => folding || (folding = doFold(o).finally(() => { folding = null; }));
async function doFold({ keepJob = false } = {}) {
  if (S.state === 'idle') return;
  if (S.state === 'busy' && !keepJob) return;
  clearTimeout(collapseT);
  clearTimeout(foldT);
  closeCard(true);
  const o = offsetTo(geo?.tab);
  stage.style.setProperty('--ox', `${o.x}px`);
  stage.style.setProperty('--oy', `${o.y}px`);
  stage.classList.remove('blooming');
  stage.classList.add('folding');
  await sleep(330);
  // A job that started, or files dragged back over it, keep the wheel open.
  if ((S.state === 'busy' && !keepJob) || (S.over && !keepJob && S.state === 'ready')) { stage.classList.remove('folding'); return; }
  toIdle(keepJob);
  // The lime stays hidden until the window is back at the edge, so it never shows where the wheel was.
  stage.classList.add('tucking');
  try { await layout(); } finally {
    requestAnimationFrame(() => { stage.classList.remove('tucking'); stage.classList.add('tuck-in'); setTimeout(() => stage.classList.remove('tuck-in'), 700); });
  }
  // Files dragged over it while it folded: open again for them.
  if (S.over && S.state === 'idle') expand('edge');
}
function toIdle(keepJob) {
  closeCard(true);
  if (!keepJob) { S.files = []; S.items = null; S.result = null; }
  S.hot = -1;
  S.dragSummon = false;
  S.peek = null;
  S.app = null;
  S.homeOn = false;
  peekSeq++;
  dwellOn(null);
  setState('idle');
  drawRing([]);
  drawCenter();
}
// After a drag leaves, the mouse's hover state is from before the drag and means nothing, so it doesn't hold the fold.
const armFold = (ms, { drag = false } = {}) => { clearTimeout(foldT); foldT = setTimeout(() => { if (S.state === 'ready' && !S.over && card.hidden && (drag || !stage.matches(':hover'))) fold(); }, ms); };
function expand(why, at, peek) {
  if (S.state !== 'idle') return;
  S.bloomAt = at || null;
  S.pop = why === 'shift';
  S.dragSummon = ['shift', 'corner', 'edge'].includes(why);
  S.peek = null;
  S.items = null;
  S.app = null;
  // Opened by a click, the wheel shows the seven apps around the lime (and Recent); opened by a drag, it waits for
  // the files to say what they can become.
  S.homeOn = !S.dragSummon;
  setState('ready');
  S.hot = -1;
  drawPill();
  drawRing(S.homeOn && S.home ? homeRing() : []);
  drawCenter();
  drawCaption();
  layout();
  if (S.homeOn && !S.home) loadHome().then(() => { if (S.state === 'ready' && S.homeOn && !S.peek) redraw(); });
  if (!S.dragSummon) armFold(12000);
  if (peek?.length) setPeek(peek);
  else if (S.dragSummon) api.invoke('wheel:peek').then((p) => p?.length && setPeek(p)).catch(() => {});
}
let peekSeq = 0;
async function setPeek(files) {
  if (S.state !== 'ready' || !files?.length || S.peek?.join('\n') === files.join('\n')) return;
  const seq = ++peekSeq;
  const items = await api.invoke('wheel:items', files).catch(() => null);
  if (seq !== peekSeq || S.state !== 'ready' || !items) return;
  S.peek = files;
  S.items = items;
  S.app = null;
  marks();
  S.baseMode = items.convert.length ? 'convert' : items.tools.length ? 'tools' : 'more';
  S.mode = S.baseMode;
  S.modKey = null;
  S.hot = -1;
  S.info = null;
  stage.classList.add('live');
  drawPill();
  drawRing(ringFor(S.mode));
  drawCenter();
  drawCaption();
  if (files.length === 1) api.invoke('files:describe', files[0]).then((info) => { if (S.peek === files) { S.info = info; drawCenter(); } }).catch(() => {});
}
function tabProgress(p) {
  const t = $('.tab');
  t.classList.toggle('working', p != null);
  t.style.setProperty('--p', p == null ? 0 : Math.max(0.03, p));
}
function setState(state) {
  S.state = state;
  stage.className = state;
  if (S.over) stage.classList.add('over');
  if (state === 'ready' && S.peek) stage.classList.add('live');
  if (!card.hidden) stage.classList.add('card-open');
  marks();
}
const atHome = () => S.state === 'ready' && S.homeOn && !S.peek;
function marks() {
  stage.classList.toggle('home', atHome());
  stage.classList.toggle('drilled', atHome() && !!S.app);
}
// The seven apps, each with its ring of actions; fetched once.
let homeP = null;
const loadHome = () => (homeP ||= api.invoke('wheel:home').then((list) => { S.home = list; }).catch(() => { homeP = null; }));
const appsList = () => (S.items ? S.items.apps || [] : S.home || []);
const appName = (id) => appsList().find((a) => a.id === id)?.name || S.home?.find((a) => a.id === id)?.name || 'That app';
const drillItem = (a) => ({ drill: a.id, label: a.name, hint: a.short, desc: `${a.role} · ${a.ring.length > 1 ? `${a.ring.length - 1} one-click action${a.ring.length === 2 ? '' : 's'}` : 'open the app'}` });
function homeRing() {
  const a = S.home?.find((x) => x.id === S.app);
  return a ? a.ring : [...(S.home || []).map(drillItem), { recent: true, label: 'Recent', hint: 'Results', desc: 'What Lime made lately' }];
}
// The app whose ring is showing, if any: one picked from the list, or the only app the files have.
function currentApp() {
  if (atHome()) return S.home?.find((a) => a.id === S.app) || null;
  if (S.mode !== 'apps' || !S.items || !['open', 'ready'].includes(S.state)) return null;
  const list = S.items.apps || [];
  return list.find((a) => a.id === S.app) || (list.length === 1 ? list[0] : null);
}
const canBack = () => !!S.app && (atHome() || (S.mode === 'apps' && appsList().length > 1));
function back() { S.app = null; S.hot = -1; redraw(); }
function redraw() {
  marks();
  drawPill();
  drawRing(atHome() ? homeRing() : ringFor(S.mode));
  drawCenter();
  drawCaption();
}

function drawRing(list, { dim = false } = {}) {
  S.ring = list || [];
  const n = S.ring.length, count = n || 8;
  petalsG.classList.toggle('dense', n > 8);
  petalsG.classList.toggle('settled', !!S.settle);
  petalsG.innerHTML = Array.from({ length: count }, (_, i) => {
    const it = S.ring[i], d = wedge(i, count, R_IN, R_OUT), a = (i * Math.PI * 2) / count, lift = count === 1 ? 0 : LIFT;
    const body = `<path class="glass" d="${d}"/><path class="tint" d="${d}"/><path class="sheen" d="${d}"/>`;
    const style = `--i:${i};--dx:${(Math.sin(a) * lift).toFixed(2)}px;--dy:${(-Math.cos(a) * lift).toFixed(2)}px`;
    if (!it) return `<g class="petal" style="${style}">${body}</g>`;
    const [x, y] = labelAt(i, count, count === 1 ? (R_IN + R_OUT) / 2 : R_LABEL);
    const hint = it.hint ? `<text class="h" x="${x.toFixed(1)}" y="${(y + 9).toFixed(1)}">${esc(String(it.hint).toUpperCase())}</text>` : '';
    return `<g class="petal${it.danger ? ' danger' : ''}${it.off ? ' off' : ''}${dim ? ' dim' : ''}" data-i="${i}" style="${style}">${body}<text class="l" x="${x.toFixed(1)}" y="${(y - (it.hint ? 6 : 0)).toFixed(1)}">${esc(it.label)}</text>${hint}</g>`;
  }).join('');
  fitLabels(count);
  setHot(S.hot >= n ? -1 : S.hot, true);
}
function fitLabels(n) {
  const max = Math.max(36, Math.min(R_OUT - R_IN - 12, 2 * R_LABEL * Math.sin(Math.PI / Math.max(n, 2)) - 16));
  $$('.petal text', petalsG).forEach((t) => {
    const len = t.getComputedTextLength?.() || 0;
    if (len > max) t.style.fontSize = `${(parseFloat(getComputedStyle(t).fontSize) * max) / len}px`;
  });
}
function setHot(i, force) {
  if (i === S.hot && !force) return;
  if (i >= 0 && i !== S.hot && S.state === 'ready') api.invoke('wheel:haptic').catch(() => {});
  S.hot = i;
  $$('.petal', petalsG).forEach((g) => g.classList.toggle('hot', Number(g.dataset.i) === i));
  drawCenter();
  drawCaption();
}

const thumbUrl = (p) => {
  if (!S.thumbs.has(p)) S.thumbs.set(p, api.invoke('files:thumb', p, 160).then((r) => (r?.png ? URL.createObjectURL(new Blob([r.png], { type: 'image/png' })) : null)).catch(() => null));
  return S.thumbs.get(p);
};
function groupOfFile(p) {
  const e = extOf(p);
  const m = { pdf: 'pdf', mp4: 'video', mov: 'video', mkv: 'video', webm: 'video', mp3: 'audio', wav: 'audio', m4a: 'audio', flac: 'audio', docx: 'doc', doc: 'doc', txt: 'doc', md: 'doc', html: 'doc', xlsx: 'sheet', csv: 'sheet', pptx: 'slides', key: 'slides', zip: 'archive', rar: 'archive', '7z': 'archive', dwg: 'cad2d', dxf: 'cad2d', stl: 'cad3d', step: 'cad3d', stp: 'cad3d', obj: 'cad3d', glb: 'cad3d', fbx: 'cad3d', ai: 'vector', eps: 'vector', svg: 'image', idml: 'layout' };
  return m[e] || (/^(jpe?g|png|heic|heif|webp|gif|tiff?|avif|bmp|psd)$/.test(e) ? 'image' : e ? 'any' : 'folder');
}
async function fileVisual(p) {
  const url = await thumbUrl(p);
  return url ? `<img class="thumb" src="${url}" alt="">` : `<div class="glyph">${icon(GROUP_ICON[groupOfFile(p)] || 'doc', 'lg')}</div>`;
}
// The middle is a few layers changed in place. Rebuilding it on every hover and progress tick restarted its animations
// and decoded the thumbnail again each time, and it waited for the thumbnail before showing anything: that was the
// stutter, and the freeze while a big file's picture was being made.
center.innerHTML = '<div class="vis"></div><div class="badge" hidden></div><div class="tick" hidden></div><div class="cap" hidden></div>';
const cVis = $('.vis', center), cBadge = $('.badge', center), cTick = $('.tick', center), cCap = $('.cap', center);
cTick.innerHTML = icon('check', 'sm');
let visKey = '';
function setVis(key, html, thumbOf) {
  if (key === visKey) return;
  visKey = key;
  cVis.innerHTML = html;
  // The file's own picture replaces its icon once it's ready, holding nothing else up.
  if (thumbOf) thumbUrl(thumbOf).then((url) => { if (url && visKey === key) cVis.innerHTML = `<img class="thumb" src="${url}" alt="">`; });
}
function setCap(html, cls = '') {
  const key = `${cls}\n${html}`;
  if (cCap.dataset.key === key) return;
  // It pops in when it appears or changes kind; new words alone (hovering, progress) just change.
  const pop = cCap.hidden || cCap.dataset.cls !== cls;
  Object.assign(cCap.dataset, { key, cls });
  cCap.className = `cap ${cls}`;
  cCap.innerHTML = html;
  cCap.hidden = !html;
  if (pop && html) { cCap.style.animation = 'none'; void cCap.offsetWidth; cCap.style.animation = ''; }
}
const glyph = (name, cls = '') => `<div class="glyph ${cls}">${icon(name, 'lg')}</div>`;
const appGlyph = (id) => `<div class="glyph app" style="--app:${APP_LOOK[id]?.[1] || 'var(--green)'}">${icon(APP_LOOK[id]?.[0] || 'grid', 'lg')}</div>`;
const showFile = (p) => setVis(`f:${p}`, glyph(GROUP_ICON[groupOfFile(p)] || 'doc'), p);
// Long names are shortened in the middle, so the extension always shows (after LightCraft's widgets.rs).
function shortName(n, max = 40) {
  if (n.length <= max) return n;
  const dot = n.lastIndexOf('.'), ext = dot > 0 && n.length - dot <= 8 ? n.slice(dot) : '', stem = ext ? n.slice(0, dot) : n;
  const room = max - ext.length - 1, head = Math.ceil(room * 0.62);
  return `${stem.slice(0, head)}…${stem.slice(stem.length - (room - head))}${ext}`;
}
function sizeText(files) {
  if (files.length > 1) return `${files.length} files`;
  const i = S.info;
  if (!i) return extOf(files[0]).toUpperCase() || 'File';
  return i.isDir ? 'Folder' : fmtBytes(i.size);
}
function drawCenter() {
  const it = S.ring[S.hot];
  const files = S.files.length ? S.files : S.peek || [];
  const hot = it ? esc(it.label) : '';
  const app = currentApp();
  cBadge.hidden = !(files.length > 1 && ['open', 'ready', 'busy'].includes(S.state) && !app);
  if (!cBadge.hidden) cBadge.textContent = files.length;
  cTick.hidden = S.state !== 'done';
  if (S.state === 'busy') {
    const j = S.job || {};
    if (files[0]) showFile(files[0]); else setVis('logo', limeSvg(96, 'logo', k));
    setCap(`<span class="p">${j.status === 'queued' ? 'Waiting' : `${Math.floor((j.progress || 0) * 100)}%`}</span><span class="x">${icon('close', 'sm')}Cancel</span>`, 'busy');
  } else if (S.state === 'done') {
    const out = S.result?.outs?.[0];
    if (out && !S.result.inPlace) showFile(out); else setVis('check', glyph('check'));
    setCap(hot, 'hot');
  } else if (S.state === 'failed') {
    setVis('bad', glyph('warning', 'bad'));
    setCap(hot || 'Didn’t finish', hot ? 'hot' : 'bad');
  } else if (app || it?.drill) {
    // Inside an app, or hovering one on the list: its mark sits in the middle.
    // Its name is in the caption below, so the mark shows whole until a slice is lit.
    const id = it?.drill || app.id;
    setVis(`app:${id}`, appGlyph(id));
    setCap(hot, 'hot');
  } else if (files.length && (S.state === 'open' || S.state === 'ready')) {
    showFile(files[0]);
    setCap(hot || esc(sizeText(files)), hot ? 'hot' : '');
  } else {
    setVis(it?.recent ? 'recent' : 'logo', it?.recent ? glyph('clock') : limeSvg(96, 'logo', k));
    setCap(hot, 'hot');
  }
  center.draggable = S.state === 'done' && !!S.result?.outs?.length;
}
function describe(info, p) {
  if (!info) return extOf(p).toUpperCase();
  const bits = [extOf(p).toUpperCase() || (info.isDir ? 'Folder' : 'File')];
  if (!info.isDir) bits.push(fmtBytes(info.size));
  if (info.width && info.height) bits.push(`${info.width}×${info.height}`);
  else if (info.video?.width) bits.push(`${info.video.width}×${info.video.height}`);
  if (info.duration) bits.push(`${Math.floor(info.duration / 60)}:${String(Math.round(info.duration % 60)).padStart(2, '0')}`);
  if (info.pages) bits.push(`${info.pages} page${info.pages === 1 ? '' : 's'}`);
  const c = info.cad;
  if (c?.kind === '3d') bits.push(`${c.size.map((v) => Math.round(v)).join('×')} mm`, `${c.triangles.toLocaleString()} triangles`);
  if (c?.kind === '2d') bits.push(`${Math.round(c.width)}×${Math.round(c.height)} ${c.units || ''}`.trim(), `${c.layers} layers`);
  return bits.join(' · ');
}
const suggestCache = new Map();
async function drawCaption() {
  const it = S.ring[S.hot];
  if (S.state === 'open') {
    capName.textContent = S.files.length === 1 ? shortName(nameOf(S.files[0])) : `${S.files.length} files`;
    if (it?.tool) {
      const key = `${it.tool}|${JSON.stringify(it.opts || {})}`;
      if (!suggestCache.has(key)) suggestCache.set(key, api.invoke('tools:suggest', it.tool, S.files, { ...defaultsFor(catalog[it.tool]), ...(it.opts || {}) }).catch(() => null));
      const s = await suggestCache.get(key);
      if (S.ring[S.hot] !== it) return;
      capMeta.textContent = catalog[it.tool]?.editor ? `Opens ${catalog[it.tool].name}` : s?.kind === 'file' ? `→ ${s.name}` : s?.kind === 'folder' ? `→ ${s.name}/` : s?.kind === 'dir' ? `→ ${S.files.length} new files` : catalog[it.tool]?.name || '';
    } else capMeta.textContent = it ? it.desc || it.hint || '' : S.files.length === 1 ? describe(S.info, S.files[0]) : `${new Set(S.files.map((f) => extOf(f).toUpperCase())).size > 1 ? 'Mixed' : extOf(S.files[0]).toUpperCase()} · ${fmtBytes(S.info?.total || 0)}`;
  } else if (S.state === 'busy') {
    capName.textContent = S.job?.name || 'Working';
    capMeta.textContent = S.job?.label || '';
  } else if (S.state === 'done') {
    const r = S.result;
    capName.textContent = r.outs.length === 1 ? shortName(nameOf(r.outs[0])) : r.outs.length ? `${r.outs.length} files saved` : r.title;
    capMeta.textContent = it?.hint ? `${it.label} · ${it.hint}` : r.note || (r.outs.length ? 'Drag from the centre, or pick an action' : '');
  } else if (S.state === 'failed') {
    capName.textContent = `${S.result?.title || 'That'} didn’t finish`;
    capMeta.textContent = S.result?.error || '';
  } else if (S.state === 'ready' && S.peek && S.ring.length) {
    capName.textContent = S.peek.length === 1 ? shortName(nameOf(S.peek[0])) : `${S.peek.length} files`;
    capMeta.textContent = it ? `Release to ${actionText(it)}` : `Drop on a choice${modHint()}`;
  } else if (atHome()) {
    const app = currentApp(), t = it?.tool && catalog[it.tool];
    if (t) { capName.textContent = t.name; capMeta.textContent = t.desc || ''; }
    else if (it) { capName.textContent = it.action === 'craft' ? `Open ${appName(it.app)}` : it.label; capMeta.textContent = it.desc || it.hint || ''; }
    else if (app) { capName.textContent = app.name; capMeta.textContent = `${app.role} · pick an action, or drop files`; }
    else { capName.textContent = 'Drop files here'; capMeta.textContent = 'or click the lime to choose'; }
  } else if (S.state === 'ready') {
    capName.textContent = 'Drop files here';
    capMeta.textContent = 'or click the lime to choose';
  }
}

function actionText(it) {
  if (it.action === 'craft') return `open in ${appName(it.app)}`;
  if (it.drill) return `see ${it.label}’s actions`;
  const t = it.tool && catalog[it.tool];
  const v = t ? verbFor(t, { ...defaultsFor(t), ...(it.opts || {}) }) : it.label;
  return /^[A-Z][a-z]/.test(v) ? v[0].toLowerCase() + v.slice(1) : v;
}
const KEYS = isMac ? { tools: '⌥', more: '⌃' } : { tools: 'Alt', more: 'Ctrl' };
function modHint() {
  const bits = ['tools', 'more'].filter((m) => m !== S.mode && ringFor(m).length).map((m) => `${KEYS[m]} ${m === 'tools' ? 'Tools' : 'More'}`);
  return bits.length ? ` · hold ${bits.join(', ')}` : '';
}
function drawPill() {
  if (atHome()) { pill.innerHTML = S.app ? `<button data-a="home" title="All apps (Esc)">${icon('back', 'sm')}All apps</button>` : ''; return; }
  const modes = S.state === 'open' ? MODES.filter(([m]) => m !== 'apps' || ringFor(m).length) : S.state === 'ready' && S.peek ? MODES.filter(([m]) => ringFor(m).length) : [];
  // Inside one app of several, the Apps tab names it and leads back to the list.
  const label = (id, l) => (id === 'apps' && S.mode === 'apps' && canBack() ? `${icon('back', 'sm')}${esc(appName(S.app))}` : l);
  pill.innerHTML = modes.map(([id, l]) => `<button role="tab" data-m="${id}" aria-selected="${S.mode === id}">${label(id, l)}</button>`).join('');
}
function ringFor(mode) {
  if (!S.items) return [];
  if (mode === 'apps') {
    const list = S.items.apps || [], a = list.find((x) => x.id === S.app) || (list.length === 1 ? list[0] : null);
    return a ? a.ring : list.map(drillItem);
  }
  return mode === 'more' ? S.items.more : S.items[mode] || [];
}
function setMode(m) {
  S.mode = m;
  marks();
  S.hot = -1;
  drawPill();
  drawRing(ringFor(m));
  drawCenter();
  drawCaption();
}

async function openWith(files, { mode, app } = {}) {
  if (!files?.length) return;
  clearTimeout(collapseT);
  closeCard(true);
  S.files = files;
  S.result = null;
  S.info = null;
  S.peek = null;
  S.homeOn = false;
  S.app = app || null;
  S.items = await api.invoke('wheel:items', files);
  if (mode && ringFor(mode).length) S.mode = mode;
  else if (!S.items.convert.length && S.items.tools.length) S.mode = 'tools'; else S.mode = S.items.convert.length ? 'convert' : 'more';
  setState('open');
  await layout();
  drawPill();
  S.hot = -1;
  drawRing(ringFor(S.mode));
  drawCenter();
  drawCaption();
  window.focus();
  if (files.length === 1) api.invoke('files:describe', files[0]).then((info) => { S.info = info; if (S.state === 'open' && S.hot < 0) drawCaption(); });
  else Promise.all(files.slice(0, 50).map((f) => api.invoke('files:describe', f).catch(() => null))).then((all) => { S.info = { total: all.reduce((s, i) => s + (i?.size || 0), 0) }; if (S.state === 'open' && S.hot < 0) drawCaption(); });
}
async function collapse() {
  if (S.state === 'busy') { closeCard(true); return; }
  await fold();
}

async function pick(it, { options = false } = {}) {
  if (!it) return;
  if (S.state === 'done' || S.state === 'failed') return doneAction(it);
  if (it.drill) { S.app = it.drill; S.hot = -1; redraw(); return; }
  if (it.recent) return showRecent();
  if (it.appAll) return showAll({ app: it.appAll });
  if (it.off) { flash(it.desc || `${appName(it.app)} isn’t in this build of Lime`); return; }
  if (it.tool && !S.files.length) return chooseFor(it);
  if (it.action) {
    if (it.action === 'all') return showAll();
    const msg = await api.invoke('wheel:action', it, S.files).catch((e) => clean(e));
    if (it.action === 'trash') { await collapse(); return; }
    if (msg) flash(msg);
    return;
  }
  const tool = catalog[it.tool];
  if (!tool) return;
  if (tool.editor) {
    await api.invoke('editor:open', S.files[0], tool.editor);
    collapse();
    return;
  }
  const opts = { ...defaultsFor(tool), ...smartDefaults(tool), ...(it.opts || {}) };
  if (options || it.ask || missingRequired(tool, opts) || needsCard(tool, opts, it)) return showOptions(tool, opts, it);
  return run(tool, opts);
}
// A tool picked inside an app with no files yet asks for files of the kinds it takes, then runs as if they'd been dropped.
async function chooseFor(it) {
  const t = catalog[it.tool];
  if (!t) return;
  S.asking = true;
  const files = await api.invoke('dialog:open', { title: `Choose files for ${t.name}`, filters: it.exts?.length ? [{ name: t.name, extensions: it.exts }] : undefined }).catch(() => []).finally(() => { S.asking = false; });
  if (!files.length) return;
  const want = itemKey(it);
  S.settle = true;
  await openWith(files, { mode: 'apps', app: S.app }).finally(() => { S.settle = false; });
  const ring = ringFor('apps'), match = ring.find((x) => itemKey(x) === want) || ring.find((x) => x.tool === it.tool);
  if (match) { setHot(S.ring.indexOf(match)); pick(match); return; }
  // Not among the slices (it was under More): run it all the same if it takes these files.
  if (S.items?.all?.includes(it.tool)) { pick({ tool: it.tool, opts: it.opts }); return; }
  flash(`${t.name} can’t use ${files.length === 1 ? nameOf(files[0]) : 'those files'}`);
}
function needsCard(tool, opts, it) {
  if (it.quick) return false;
  if (tool.ordered && S.files.length > 1) return true;
  const preset = Object.keys(it.opts || {});
  return (tool.options || []).some((o) => !o.advanced && visible(o, opts) && !preset.includes(o.key));
}
function smartDefaults(tool) {
  const n = S.files.length === 1 ? S.info?.pages : 0;
  if (tool.id === 'split-pdf' && n > 1) {
    const half = Math.ceil(n / 2);
    return { ranges: n > 2 ? `1-${half}, ${half + 1}-${n}` : '1, 2', every: Math.max(1, Math.min(2, n - 1)), pages: n > 2 ? `1, ${n}` : '1' };
  }
  return {};
}
async function run(tool, opts) {
  const files = S.files.slice();
  if (!files.length) return;
  S.asking = true;
  clearTimeout(collapseT);
  const dest = await api.invoke('save:ask', { tool: tool.id, files, opts }).catch((e) => { flash(clean(e)); return null; }).finally(() => { S.asking = false; });
  if (dest === null) return;
  closeCard(true);
  S.files = files;
  const id = await api.invoke('jobs:submit', { tool: tool.id, files, opts, dest: dest.kind === 'none' || dest.kind === 'auto' ? null : dest }).catch((e) => { fail(tool.name, clean(e), { tool, opts, files }); return null; });
  if (!id) return;
  S.last = { tool, opts, files };
  rememberTool(tool.id);
  S.job = { id, name: tool.name, progress: 0, label: 'Starting', status: 'queued' };
  setState('busy');
  drawPill();
  drawRing(S.ring, { dim: true });
  drawProgress(0);
  drawCenter();
  drawCaption();
  layout();
}
function drawProgress(p) {
  const prog = $('.prog');
  prog.style.opacity = p == null ? 0 : 1;
  prog.setAttribute('d', p == null ? '' : arc(R_PROG, Math.max(0.015, p)));
}
api.on('jobs', (list) => {
  if (!S.job) return;
  const j = list.find((x) => x.id === S.job.id);
  if (!j) return;
  S.job = j;
  if (j.status === 'running' || j.status === 'queued') {
    drawProgress(j.progress || 0);
    if (S.state === 'busy') { drawCenter(); drawCaption(); } else if (S.state === 'idle') tabProgress(j.progress || 0);
    return;
  }
  const job = S.job;
  S.job = null;
  tabProgress(null);
  if (j.status === 'done') {
    drawProgress(1);
    setTimeout(() => drawProgress(null), 600);
    const outs = j.results.flatMap((r) => r.paths || (r.path ? [r.path] : []));
    const note = j.results.map((r) => r.note).find(Boolean) || '';
    const text = j.results.map((r) => r.text).filter(Boolean).join('\n\n');
    S.result = { title: j.name, outs, note: note.includes('\n') ? note.split('\n')[0] : note, fullNote: note, text, inPlace: j.results[0]?.inPlace, edit: j.edit };
    showDone();
  } else if (j.status === 'cancelled') {
    drawProgress(null);
    if (S.state === 'busy') { setState('open'); drawPill(); drawRing(ringFor(S.mode)); drawCenter(); drawCaption(); }
  } else {
    drawProgress(null);
    fail(job.name, j.error, S.last, j.code);
  }
});
function showDone() {
  const r = S.result;
  const ring = [];
  if (r.outs.length) ring.push({ act: 'open', label: 'Open', hint: r.outs.length > 1 ? `${r.outs.length} files` : 'Default app' }, { act: 'reveal', label: isMac ? 'Finder' : 'Show', hint: 'Reveal' });
  if (r.text) ring.push({ act: 'copy', label: 'Copy', hint: 'Text' }, { act: 'view', label: 'View', hint: 'Text' });
  if (r.outs.length && !r.inPlace) ring.push({ act: 'next', label: 'Next', hint: 'Use result' });
  if (r.edit) ring.push({ act: 'craft', app: r.edit.app, label: r.edit.name, hint: 'Edit in' });
  ring.push({ act: 'again', label: 'Again', hint: 'Other format' }, { act: 'close', label: 'Done', hint: 'Close' });
  if (S.state === 'idle') { flash(`${r.title} finished`); }
  setState('done');
  S.hot = -1;
  drawPill();
  drawRing(ring);
  stage.classList.add('open');
  drawCenter();
  drawCaption();
  layout();
  armCollapse(14000);
  if (r.text && r.outs.length === 0) showText();
}
function fail(title, error, last, code) {
  S.result = { title, error: error || 'Something went wrong.', code };
  if (last) S.last = last;
  setState('failed');
  S.hot = -1;
  drawPill();
  drawRing([{ act: 'retry', label: 'Retry', hint: 'Run again' }, { act: 'options', label: 'Options', hint: 'Change' }, { act: 'again', label: 'Back', hint: 'Choose' }, { act: 'close', label: 'Close', hint: '' }]);
  stage.classList.add('open');
  drawCenter();
  drawCaption();
  layout();
}
async function doneAction(it) {
  const r = S.result || {};
  switch (it.act) {
    case 'open': r.outs.slice(0, 12).forEach((o) => api.invoke('shell:open', o)); armCollapse(1800); break;
    case 'reveal': api.invoke('shell:show', r.outs[0]); armCollapse(1800); break;
    case 'copy': await api.invoke('clip:text', r.text); flash('Text copied'); break;
    case 'view': showText(); break;
    case 'next': openWith(r.outs.filter(Boolean)); break;
    case 'craft': flash(await api.invoke('wheel:action', { action: 'craft', app: it.app }, r.outs.slice(0, 1)).catch((e) => clean(e))); armCollapse(4000); break;
    case 'again': if (S.last?.files?.length) openWith(S.last.files); else collapse(); break;
    case 'retry': if (S.last) { S.files = S.last.files; run(S.last.tool, S.last.opts); } break;
    case 'options': if (S.last) { S.files = S.last.files; setState('open'); drawPill(); drawRing(ringFor(S.mode)); showOptions(S.last.tool, { ...S.last.opts }); } break;
    case 'close': collapse(); break;
    default:
  }
}
function armCollapse(ms) {
  clearTimeout(collapseT);
  collapseT = setTimeout(() => { if (!S.asking && !stage.matches(':hover') && card.hidden && ['done', 'open', 'ready'].includes(S.state)) collapse(); }, ms);
}
let flashT = null;
function flash(msg) {
  const keep = capMeta.textContent;
  capMeta.textContent = msg;
  stage.classList.add('flash');
  clearTimeout(flashT);
  flashT = setTimeout(() => { stage.classList.remove('flash'); drawCaption(); if (capMeta.textContent === msg) capMeta.textContent = keep; }, 2200);
}

function openCard(node) {
  card.innerHTML = '';
  card.append(node);
  card.hidden = false;
  stage.classList.add('card-open');
  requestAnimationFrame(() => layout());
}
function closeCard(silent) {
  if (card.hidden) return;
  card.hidden = true;
  card.innerHTML = '';
  stage.classList.remove('card-open');
  S.cardFor = null;
  if (!silent) layout();
}
const VERB = { 'merge-pdf': 'Merge PDF', 'split-pdf': 'Split PDF', 'compress-pdf': 'Compress PDF', 'jpg-to-pdf': 'Create PDF', 'to-pdf': 'Make PDF', 'page-numbers': 'Add page numbers', 'ocr-pdf': 'Make searchable', 'watermark-pdf': 'Add watermark', 'watermark-image': 'Add watermark', 'enhance-photo': 'Enhance', 'html-to-pdf': 'Save as PDF', 'screenshot-url': 'Capture page', 'video-to-gif': 'Make GIF', 'image-to-text': 'Read text', 'video-frames': 'Save frames', collage: 'Make collage', 'images-to-gif': 'Make GIF', 'images-to-video': 'Make slideshow', panorama: 'Stitch', 'hdr-merge': 'Merge HDR', 'cad-info': 'Measure', 'file-hash': 'Calculate', 'rename-files': 'Rename', 'audit-pdf': 'Check', 'normalize-audio': 'Level loudness', 'speed-media': 'Change speed', 'strip-metadata': 'Remove info', 'merge-documents': 'Merge into PDF', 'merge-media': 'Merge', 'merge-sheets': 'Merge', 'remove-background': 'Remove background', 'extract-archive': 'Extract', 'create-archive': 'Compress', 'test-archive': 'Test', 'remove-pages': 'Remove pages', 'extract-pages': 'Extract pages', 'extract-images-pdf': 'Extract images', 'burn-subtitles': 'Add subtitles' };
const verbFor = (tool, opts) => {
  if (/^convert|^develop|^render|^pdf-to|^json-to/.test(tool.id)) return opts.to || opts.format ? `Convert to ${String(opts.to || opts.format).toUpperCase().replace('HEVC', 'HEVC MP4')}` : 'Convert';
  return VERB[tool.id] || tool.name.split(' ')[0];
};
function showOptions(tool, opts, it) {
  S.cardFor = tool.id;
  const about = S.files.length === 1 ? describe(S.info, S.files[0]) : `${S.files.length} files`;
  const node = h(`<div><div class="head"><h3>${esc(tool.name)}</h3><button class="btn subtle icon" data-a="x" title="Close">${icon('close', 'sm')}</button></div><p class="desc">${esc(tool.desc || '')}</p><p class="about">${esc(S.files.length === 1 ? `${nameOf(S.files[0])} · ${about}` : about)}</p></div>`);
  const btn = h(`<button class="btn primary">${esc(verbFor(tool, opts))}</button>`);
  if (tool.ordered && S.files.length > 1) node.append(orderList(tool, () => { btn.disabled = S.files.length < (tool.min || 1); btn.title = btn.disabled ? `${tool.name} needs at least ${tool.min} files` : ''; }));
  node.append(form(tool, opts, () => { btn.textContent = verbFor(tool, opts); requestAnimationFrame(layout); }, { files: S.files, busy: (v) => { S.asking = v; } }));
  const foot = h('<div class="foot"><button class="btn" data-a="x">Cancel</button></div>');
  foot.append(btn);
  node.append(foot);
  node.addEventListener('click', (e) => { if (e.target.closest('[data-a="x"]')) closeCard(); });
  btn.addEventListener('click', () => {
    const miss = missingRequired(tool, opts);
    if (miss) { flash(`Fill in “${miss.label}” first`); node.querySelector(`#o-${miss.key}`)?.focus(); return; }
    run(tool, opts);
  });
  openCard(node);
  setTimeout(() => node.querySelector('input.input, textarea, select')?.focus(), 60);
}
function orderList(tool, changed) {
  const box = h(`<div class="order"><div class="otop"><span class="label">Order</span><span class="muted">Drag to rearrange</span></div><ol></ol><div class="obar"><button class="btn subtle" type="button" data-o="add">${icon('add', 'sm')}Add files</button><button class="btn subtle" type="button" data-o="sort">A–Z</button><button class="btn subtle" type="button" data-o="rev">Reverse</button></div></div>`);
  const ol = $('ol', box);
  const draw = () => {
    ol.innerHTML = S.files.map((f, i) => `<li data-i="${i}" draggable="true"><span class="n">${i + 1}</span><span class="pic" data-p="${esc(f)}"></span><span class="nm" title="${esc(f)}">${esc(nameOf(f))}</span><button type="button" class="ob" data-mv="-1" ${i ? '' : 'disabled'} title="Move up">${icon('up', 'sm')}</button><button type="button" class="ob" data-mv="1" ${i < S.files.length - 1 ? '' : 'disabled'} title="Move down">${icon('down', 'sm')}</button><button type="button" class="ob" data-rm title="Remove">${icon('close', 'sm')}</button></li>`).join('');
    $$('.pic', ol).forEach(async (el) => { el.innerHTML = await fileVisual(el.dataset.p); });
    changed();
    requestAnimationFrame(layout);
  };
  const move = (from, to) => { if (to < 0 || to >= S.files.length || from === to) return; const [f] = S.files.splice(from, 1); S.files.splice(to, 0, f); draw(); };
  box.addEventListener('click', async (e) => {
    const li = e.target.closest('li'), i = li ? Number(li.dataset.i) : -1;
    const mv = e.target.closest('[data-mv]');
    if (mv) return move(i, i + Number(mv.dataset.mv));
    if (e.target.closest('[data-rm]')) { S.files.splice(i, 1); return draw(); }
    const o = e.target.closest('[data-o]')?.dataset.o;
    if (o === 'sort') { S.files.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true, sensitivity: 'base' })); draw(); }
    if (o === 'rev') { S.files.reverse(); draw(); }
    if (o === 'add') {
      S.asking = true;
      const add = await api.invoke('dialog:open', { title: `Add files to ${tool.name}` }).catch(() => []).finally(() => { S.asking = false; });
      const ok = await api.invoke('tools:accepts', tool.id, [...S.files, ...add]).catch(() => true);
      if (!ok) { flash(`${tool.name} can’t use those files`); return; }
      S.files.push(...add.filter((f) => !S.files.includes(f)));
      draw();
    }
  });
  let dragFrom = -1;
  ol.addEventListener('dragstart', (e) => { const li = e.target.closest('li'); if (!li) return; dragFrom = Number(li.dataset.i); li.classList.add('lift'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-lime-order', String(dragFrom)); });
  ol.addEventListener('dragover', (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
    const li = e.target.closest('li');
    $$('li', ol).forEach((x) => x.classList.remove('before', 'after'));
    if (li && Number(li.dataset.i) !== dragFrom) { const r = li.getBoundingClientRect(); li.classList.add(e.clientY < r.top + r.height / 2 ? 'before' : 'after'); }
  });
  ol.addEventListener('drop', (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const li = e.target.closest('li');
    if (li) { const r = li.getBoundingClientRect(); let to = Number(li.dataset.i) + (e.clientY < r.top + r.height / 2 ? 0 : 1); if (to > dragFrom) to--; move(dragFrom, to); }
    dragFrom = -1;
  });
  ol.addEventListener('dragend', () => { dragFrom = -1; $$('li', ol).forEach((x) => x.classList.remove('lift', 'before', 'after')); });
  draw();
  return box;
}
const CATS = [['pdf', 'PDF'], ['image', 'Images'], ['media', 'Video & audio'], ['docs', 'Documents'], ['cad', 'CAD & vector'], ['archive', 'Archives'], ['utility', 'Utilities']];
const CRAFT = { photocraft: 'PhotoCraft', lightcraft: 'LightCraft', vectorcraft: 'VectorCraft', designcraft: 'DesignCraft', effectcraft: 'EffectCraft', filmcraft: 'FilmCraft', pdfcraft: 'PdfCraft' };
// Search ranks what it finds: letters in a row and at the start of words count more, and an exact name comes first
// (after PhotoCraft's palette.rs). With nothing typed, the tools used lately come first.
function fuzzy(q, text) {
  const t = text.toLowerCase();
  let score = 0, ti = 0, last = -2;
  for (const c of q.toLowerCase()) {
    while (ti < t.length && t[ti] !== c) ti++;
    if (ti >= t.length) return null;
    score += (last === ti - 1 ? 8 : 1) + (ti === 0 || t[ti - 1] === ' ' ? 5 : 0);
    last = ti++;
  }
  return score - Math.floor(t.length / 8);
}
const recentTools = () => { try { return JSON.parse(localStorage.getItem('lime.recentTools') || '[]'); } catch (_) { return []; } };
function rememberTool(id) { try { localStorage.setItem('lime.recentTools', JSON.stringify([id, ...recentTools().filter((x) => x !== id)].slice(0, 8))); } catch (_) {} }
function showAll({ app } = {}) {
  // From an app's More slice: just that app's actions (all of them with no files yet, else the ones that fit).
  const a = app && (appsList().find((x) => x.id === app) || S.home?.find((x) => x.id === app));
  const ids = a ? a.all : S.items.all || [];
  const node = h(`<div><div class="search"><input class="input" type="search" placeholder="Search ${ids.length} tools" spellcheck="false"><button class="btn subtle icon" data-a="x">${icon('close', 'sm')}</button></div><div class="list"></div></div>`);
  const list = $('.list', node), q = $('input', node);
  let kb = -1;
  const row = (t) => `<button data-t="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span>${t.craft ? `<i>${CRAFT[t.craft]}</i>` : ''}</button>`;
  const render = () => {
    const term = q.value.trim().toLowerCase();
    const tools = ids.map((id) => catalog[id]).filter(Boolean);
    if (term) {
      const hits = tools.map((t) => {
        const name = fuzzy(term, t.name), rest = `${t.desc} ${CRAFT[t.craft] || ''}`.toLowerCase().includes(term);
        return { t, score: name == null ? (rest ? -50 : null) : name + (t.name.toLowerCase() === term ? 1000 : 0) };
      }).filter((x) => x.score != null).sort((a, b) => b.score - a.score);
      list.innerHTML = hits.length ? `<div class="grp">Best matches</div>${hits.map((x) => row(x.t)).join('')}` : '<p class="muted" style="padding:8px">No tools match.</p>';
    } else {
      const recent = recentTools().map((id) => catalog[id]).filter((t) => t && ids.includes(t.id)).slice(0, 4);
      list.innerHTML = (recent.length ? `<div class="grp">Used lately</div>${recent.map(row).join('')}` : '') + CATS.map(([c, label]) => {
        const ts = tools.filter((t) => t.cat === c);
        return ts.length ? `<div class="grp">${label}</div>${ts.map(row).join('')}` : '';
      }).join('');
    }
    kb = -1;
    requestAnimationFrame(layout);
  };
  q.addEventListener('input', render);
  q.addEventListener('keydown', (e) => {
    const bs = $$('button[data-t]', list);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); kb = Math.max(0, Math.min(bs.length - 1, kb + (e.key === 'ArrowDown' ? 1 : -1))); bs.forEach((b, i) => b.classList.toggle('kb', i === kb)); bs[kb]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter' && bs[Math.max(0, kb)]) bs[Math.max(0, kb)].click();
  });
  node.addEventListener('click', (e) => {
    if (e.target.closest('[data-a="x"]')) { closeCard(); return; }
    const b = e.target.closest('button[data-t]');
    if (!b) return;
    const t = catalog[b.dataset.t];
    if (!S.files.length) { closeCard(true); chooseFor({ tool: t.id, exts: a?.exts?.[t.id] }); return; }
    if (t.editor) { pick({ tool: t.id }); return; }
    if ((t.options || []).length) showOptions(t, defaultsFor(t)); else run(t, defaultsFor(t));
  });
  openCard(node);
  render();
  setTimeout(() => q.focus(), 60);
}
async function showRecent() {
  const list = (await api.invoke('recent:list').catch(() => [])).filter((r) => r.kind === 'output').slice(0, 14);
  const node = h(`<div><div class="head"><h3>Recent results</h3><button class="btn subtle icon" data-a="x" title="Close">${icon('close', 'sm')}</button></div><p class="desc">Pick one to keep working on it.</p><div class="list recent"></div></div>`);
  $('.list', node).innerHTML = list.length ? list.map((r) => `<button data-p="${esc(r.path)}"><b>${esc(nameOf(r.path))}</b><span>${esc(dirOf(r.path))}</span><i data-show title="Show in folder">${isMac ? 'Finder' : 'Show'}</i></button>`).join('') : '<p class="muted" style="padding:8px">Nothing yet. What Lime makes shows up here.</p>';
  node.addEventListener('click', (e) => {
    if (e.target.closest('[data-a="x"]')) { closeCard(); return; }
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    if (e.target.closest('[data-show]')) api.invoke('shell:show', b.dataset.p);
    else openWith([b.dataset.p]);
  });
  openCard(node);
}
function showText() {
  const node = h(`<div><div class="head"><h3>Recognised text</h3><button class="btn subtle icon" data-a="x">${icon('close', 'sm')}</button></div><div class="textout"></div><div class="foot"><button class="btn primary" data-a="copy">${icon('copy', 'sm')}Copy text</button></div></div>`);
  $('.textout', node).textContent = S.result?.text || '';
  node.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'x') closeCard();
    if (a === 'copy') { await api.invoke('clip:text', S.result?.text || ''); flash('Text copied'); }
  });
  openCard(node);
}

function toWheel(x, y) {
  const r = svg.getBoundingClientRect(), k2 = 300 / r.width;
  return [(x - (r.left + r.width / 2)) * k2, (y - (r.top + r.height / 2)) * k2];
}
const ringIndexAt = (x, y) => hitIndex(...toWheel(x, y), S.ring.length, R_IN - 2, R_OUT + 14, S.hot);
const inCenter = (x, y) => Math.hypot(...toWheel(x, y)) < R_IN - 4;
const interactive = () => ['open', 'done', 'failed'].includes(S.state) || atHome();
const petalAt = (e) => (interactive() ? ringIndexAt(e.clientX, e.clientY) : -1);
wheelEl.addEventListener('pointermove', (e) => { if (interactive() && !moving) setHot(petalAt(e)); });
wheelEl.addEventListener('pointerleave', () => { if (interactive() && !moving) setHot(-1); });
// Press and drag anywhere moves the wheel, with files or without: a press that travels a few pixels is a move, not a
// click. Only the middle of a finished job drags its results out instead. The window follows on every frame drawn.
let downAt = null, moving = false, justMoved = false;
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.card, input, select, textarea')) return;
  const i = petalAt(e);
  downAt = { x: e.clientX, y: e.clientY, id: e.pointerId, i, onPetal: i >= 0, onBtn: e.target.classList?.contains('btn') || inCenter(e.clientX, e.clientY), onPill: !!e.target.closest('.pill') };
  if (i >= 0) $(`.petal[data-i="${i}"]`)?.classList.add('press');
});
window.addEventListener('pointermove', (e) => {
  if (!downAt || moving || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) <= 5) return;
  if (S.state === 'done' && downAt.onBtn && S.result?.outs?.length) return;
  moving = true;
  $$('.petal.press').forEach((g) => g.classList.remove('press'));
  setHot(-1);
  stage.classList.add('moving');
  try { stage.setPointerCapture(downAt.id); } catch (_) {}
  api.invoke('wheel:dragStart');
  const step = () => { if (!moving) return; api.moveTick(); requestAnimationFrame(step); };
  requestAnimationFrame(step);
});
function endMove() {
  if (!moving) return false;
  moving = false;
  stage.classList.remove('moving');
  api.invoke('wheel:dragEnd');
  justMoved = true;
  setTimeout(() => { justMoved = false; }, 0);
  return true;
}
window.addEventListener('click', (e) => { if (justMoved) { e.preventDefault(); e.stopPropagation(); } }, true);
stage.addEventListener('pointercancel', () => { downAt = null; endMove(); });
stage.addEventListener('lostpointercapture', () => { if (moving) { downAt = null; endMove(); } });
window.addEventListener('pointerup', async (e) => {
  const d = downAt;
  downAt = null;
  $$('.petal.press').forEach((g) => g.classList.remove('press'));
  if (!d || endMove() || d.onPill) return;
  if (d.onPetal) { const i = petalAt(e); if (i === d.i) pick(S.ring[i], { options: e.altKey }); return; }
  if (S.state === 'idle' && e.target.closest('.tab')) { expand('click'); return; }
  if (d.onBtn || e.target.closest('.center')) {
    if (atHome() && S.app) back();
    else if (S.state === 'ready') { S.asking = true; const files = await api.invoke('dialog:open', { title: 'Choose files for Lime' }).finally(() => { S.asking = false; }); if (files.length) openWith(files); }
    else if (S.state === 'busy' && S.job) api.invoke('jobs:cancel', S.job.id);
    else if (S.ring[S.hot]) pick(S.ring[S.hot]);
    else if (canBack()) back();
    else if (S.state === 'done' && S.result?.outs?.[0]) api.invoke('shell:show', S.result.outs[0]);
  }
});
svg.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const i = petalAt(e);
  if (i >= 0 && S.state === 'open' && S.ring[i]?.tool) pick(S.ring[i], { options: true });
  else api.invoke('wheel:menu');
});
svg.addEventListener('pointerover', (e) => stage.classList.toggle('btn-hover', !!e.target.classList?.contains('btn')));
center.addEventListener('dragstart', (e) => {
  e.preventDefault();
  if (S.state === 'done' && S.result?.outs?.length) api.drag(S.result.outs);
});
// One slice per mouse notch, however many pixels the system calls a notch (Windows says about 100, which used to skip
// three or four slices); trackpad motion adds up, a bounded amount per event, and starts over after a pause. After
// PdfCraft's wheel_pager.rs.
let wheelAcc = 0, wheelAt = 0;
stage.addEventListener('wheel', (e) => {
  if (e.target.closest('.card')) return;
  if (['idle', 'busy'].includes(S.state) || (S.state === 'ready' && !atHome()) || !S.ring.length) return;
  e.preventDefault();
  const dy = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX, now = performance.now(), idle = now - wheelAt;
  wheelAt = now;
  if (!dy) return;
  if (idle > 150) wheelAcc = 0;
  const n = S.ring.length, turn = (dir) => setHot(S.hot < 0 ? (dir > 0 ? 0 : n - 1) : (S.hot + dir + n) % n);
  if (e.deltaMode !== 0 || (Math.abs(dy) >= 50 && idle >= 20)) { wheelAcc = 0; turn(Math.sign(dy)); return; }
  wheelAcc += Math.max(-26, Math.min(26, dy));
  if (Math.abs(wheelAcc) >= 26) { turn(Math.sign(wheelAcc)); wheelAcc = 0; }
}, { passive: false });
pill.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.a === 'close') { if (S.state === 'busy') { collapseKeepJob(); } else collapse(); return; }
  if (b.dataset.a === 'home') { closeCard(); back(); return; }
  if (b.dataset.m) { closeCard(); if (b.dataset.m === 'apps' && S.mode === 'apps' && canBack()) back(); else setMode(b.dataset.m); }
});
// The ✕ at the top right folds the wheel back into the lime from any state; a running job carries on.
const closeBtn = $('.close');
closeBtn.innerHTML = icon('close', 'sm');
closeBtn.addEventListener('click', () => { closeCard(true); if (S.state === 'busy') collapseKeepJob(); else collapse(); });
function collapseKeepJob() {
  fold({ keepJob: true }).then(() => tabProgress(S.job?.progress || 0));
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select') && e.key !== 'Escape') return;
  if (e.key === 'Escape') { e.preventDefault(); if (!card.hidden) closeCard(); else if (canBack()) back(); else if (S.state === 'busy') collapseKeepJob(); else collapse(); return; }
  if (S.state === 'idle' || S.state === 'busy') return;
  if (S.state === 'ready' && !atHome()) return;
  if (e.key === 'Backspace' && canBack()) { e.preventDefault(); back(); return; }
  const n = S.ring.length;
  if (e.key === 'Tab' && S.state === 'open') {
    e.preventDefault();
    const modes = MODES.filter(([m]) => m !== 'apps' || ringFor(m).length), i = modes.findIndex(([m]) => m === S.mode);
    closeCard(true);
    setMode(modes[(i + (e.shiftKey ? modes.length - 1 : 1)) % modes.length][0]);
    return;
  }
  if (n && ['ArrowRight', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setHot((S.hot + 1 + n) % n); }
  if (n && ['ArrowLeft', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setHot(S.hot < 0 ? n - 1 : (S.hot - 1 + n) % n); }
  if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) pick(S.ring[Number(e.key) - 1]);
  if ((e.key === 'Enter' || e.key === ' ') && S.ring[S.hot]) { e.preventDefault(); pick(S.ring[S.hot], { options: e.altKey }); }
});

const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
const itemKey = (it) => JSON.stringify([it.tool || null, it.opts || null, it.action || null, it.act || null, it.label]);
let dwellBtn = null, dwellT = null;
function dwellOn(btn) {
  if (btn === dwellBtn) return;
  dwellBtn?.classList.remove('dwell');
  clearTimeout(dwellT);
  dwellBtn = btn;
  if (!btn || btn.dataset.m === S.mode) return;
  btn.style.setProperty('--dwell', `${DWELL}ms`);
  btn.classList.add('dwell');
  dwellT = setTimeout(() => { const m = btn.dataset.m; dwellBtn = null; S.modKey = 'dwell'; S.baseMode = m; setMode(m); }, DWELL);
}
function dragMods(e) {
  const key = e.altKey ? 'tools' : e.ctrlKey ? 'more' : null;
  if (key === S.modKey || (S.modKey === 'dwell' && !key)) return;
  S.modKey = key;
  const m = key && ringFor(key).length ? key : S.baseMode;
  if (m !== S.mode) setMode(m);
}
// Whether files are being dragged over the window. Counting enters against leaves drifted whenever the ring was redrawn
// under the pointer (a slice that is replaced never reports its leave), and once the count was off, dragging onto the
// lime stopped opening the wheel. Moving between parts of the wheel fires an enter just before its leave, so a leave
// with no enter in the same moment is the drag leaving the window.
let entering = false;
function dragOver(on) {
  S.over = on;
  stage.classList.toggle('over', on);
}
window.addEventListener('dragenter', (e) => {
  if (!isFiles(e)) return;
  e.preventDefault();
  entering = true;
  setTimeout(() => { entering = false; }, 0);
  if (S.over && S.state !== 'idle') return;
  dragOver(true);
  clearTimeout(collapseT);
  clearTimeout(foldT);
  if (S.state === 'idle') expand('edge');
});
// Holding dragged files over an app for a moment opens its actions, so a drop runs one in the same gesture (as
// LightCraft opens a folder held over while dragging).
let drillWait = null, drillT = null;
function drillOn(it) {
  const id = it?.drill || null;
  if (id === drillWait) return;
  clearTimeout(drillT);
  drillWait = id;
  if (id) drillT = setTimeout(() => { if (S.ring[S.hot]?.drill === id) { S.app = id; S.hot = -1; redraw(); } drillWait = null; }, DWELL);
}
window.addEventListener('dragover', (e) => {
  if (!isFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  if (S.state !== 'ready' || !(S.peek || atHome())) return;
  if (S.peek) dragMods(e);
  const tab = e.target.closest?.('.pill button[data-m]');
  dwellOn(tab || null);
  setHot(tab ? -1 : ringIndexAt(e.clientX, e.clientY));
  drillOn(tab ? null : S.ring[S.hot]);
});
window.addEventListener('dragleave', () => {
  if (entering || !S.over) return;
  dragOver(false);
  dwellOn(null);
  if (S.state === 'ready') { setHot(-1); armFold(1400, { drag: true }); }
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragOver(false);
  clearTimeout(foldT);
  dwellOn(null);
  const real = [...(e.dataTransfer?.files || [])].map((f) => api.pathFor(f)).filter(Boolean);
  const files = real.length ? real : S.peek || [];
  if (!files.length) return;
  const it = S.state === 'ready' && (S.peek || atHome()) ? S.ring[ringIndexAt(e.clientX, e.clientY)] : null;
  S.dropping = true;
  if (!it || it.recent) { openWith(files).finally(() => { S.dropping = false; }); return; }
  // Dropped on an app: its ring for these files. Dropped on one of an app's actions: that action.
  const home = atHome();
  if (it.drill) { openWith(files, { mode: 'apps', app: it.drill }).finally(() => { S.dropping = false; }); return; }
  const want = itemKey(it);
  S.settle = true;
  await openWith(files, home ? { mode: 'apps', app: S.app } : { mode: S.mode, app: S.app }).finally(() => { S.settle = false; S.dropping = false; });
  const match = [S.mode, 'convert', 'tools', 'apps', 'more'].flatMap((m) => ringFor(m)).find((x) => itemKey(x) === want);
  if (!match) { flash(`${it.app && it.action ? `${appName(it.app)} can’t open` : `${it.label} isn’t available for`} ${files.length === 1 ? nameOf(files[0]) : 'these files'}`); return; }
  setHot(S.ring.indexOf(match));
  pick(match);
});
window.addEventListener('blur', () => { if ((S.state === 'open' || (S.state === 'ready' && !S.dragSummon)) && card.hidden && !S.asking) armCollapse(900); });
window.addEventListener('focus', () => { if (S.state === 'open' || S.state === 'ready') clearTimeout(collapseT); });
stage.addEventListener('pointerenter', () => { clearTimeout(collapseT); clearTimeout(foldT); });
stage.addEventListener('pointerleave', () => { if (S.state === 'done') armCollapse(6000); if (S.state === 'ready' && !S.over) armFold(2500); });

api.on('wheel:files', (files) => openWith(files));
api.on('wheel:summon', ({ why, at, peek, tab }) => {
  // The window is tucked at the edge but the page thinks it's open (a fold that never finished): start over from the lime.
  if (tab && !folding && ['ready', 'open', 'done', 'failed'].includes(S.state)) { toIdle(); stage.classList.remove('folding', 'tucking'); }
  if (S.state === 'idle') expand(why, at, peek); else if (why === 'show') window.focus(); else if (S.state === 'ready' && peek?.length) setPeek(peek);
});
api.on('wheel:peek', (files) => { if (S.state === 'ready') setPeek(files); });
api.on('wheel:dragEnded', () => {
  // The system says the drag is over, so nothing is over the wheel any more, whatever its events said.
  dragOver(false);
  dwellOn(null);
  if (S.state === 'ready' && S.dragSummon) setTimeout(() => { if (S.state === 'ready' && !S.over && !S.dropping) fold(); }, 260);
});
api.on('wheel:flash', (msg) => flash(msg));
api.on('wheel:fold', () => { if (S.state === 'busy') collapseKeepJob(); else collapse(); });
api.on('settings', (s) => { settings = s; const nk = SIZES[s.size] || 1; if (nk !== k) { k = nk; $$('img.lime').forEach((i) => { i.sizes = `${Math.ceil(i.width * k)}px`; }); layout(); } });

setState('idle');
drawRing([]);
drawCenter();
layout();
window.__lime = { S, drawCenter, folding: () => !!folding, openWith, collapse, fold, expand, pick, setHot, setMode, showAll, showOptions, setPeek, ringIndexAt, catalog, geo: () => geo, atHome, homeRing, currentApp, back, redraw, loadHome, ringFor };
