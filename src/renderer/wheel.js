import { icon, GROUP_ICON } from './icons.js';
import { wedge, labelAt, arc, limeSvg, hitIndex } from './petal.js';
import { api, $, $$, h, esc, nameOf, extOf, fmtBytes, clean, applyTheme, defaultsFor, missingRequired, visible, form } from './ui.js';

const R_IN = 60, R_OUT = 138, R_LABEL = 100, R_PROG = 142.5, LIFT = 5, DWELL = 450;
const TAB = 76;
const SIZES = { s: 0.88, m: 1, l: 1.14 };
const MODES = [['convert', 'Convert'], ['tools', 'Tools'], ['more', 'More']];
const isMac = api.platform === 'darwin';
const stage = $('#stage'), wheelEl = $('.wheel'), svg = $('.dial'), petalsG = $('.petals'), center = $('.center'), pill = $('.pill'), card = $('.card');
const capName = $('.caption .name'), capMeta = $('.caption .meta');

let settings = await applyTheme();
const catalog = Object.fromEntries((await api.invoke('catalog')).map((t) => [t.id, t]));
const S = { state: 'idle', files: [], items: null, mode: 'convert', hot: -1, ring: [], job: null, result: null, last: null, thumbs: new Map(), info: null, cardFor: null, depth: 0, peek: null, baseMode: 'convert', modKey: null };
let k = SIZES[settings.size] || 1;
let collapseT = null, foldT = null, shown = 'tab', geo = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
$('.tab-lime').insertAdjacentHTML('afterbegin', limeSvg(52, 't'));

async function layout() {
  const open = S.state !== 'idle';
  const cardH = card.hidden ? 0 : Math.min(card.scrollHeight, 380) + 14;
  const L = open ? { w: 330, h: 392 + (cardH ? cardH + 4 : 0), cx: 165, cy: 194 } : { w: TAB, h: TAB, cx: TAB / 2, cy: TAB / 2 };
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
function offsetTo(pt) {
  if (!pt || !geo) return { x: 140, y: 0 };
  return { x: (pt.x - geo.bounds.x) / k - 165, y: (pt.y - geo.bounds.y) / k - 194 };
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
async function fold({ keepJob = false } = {}) {
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
  if (S.state === 'busy' && !keepJob) { stage.classList.remove('folding'); return; }
  if (!keepJob) { S.files = []; S.items = null; S.result = null; }
  S.hot = -1;
  S.dragSummon = false;
  S.peek = null;
  peekSeq++;
  dwellOn(null);
  setState('idle');
  stage.classList.remove('folding');
  drawRing([]);
  drawCenter();
  await layout();
  stage.classList.add('tuck-in');
  setTimeout(() => stage.classList.remove('tuck-in'), 700);
}
const armFold = (ms) => { clearTimeout(foldT); foldT = setTimeout(() => { if (S.state === 'ready' && !S.depth && !stage.matches(':hover')) fold(); }, ms); };
function expand(why, at, peek) {
  if (S.state !== 'idle') return;
  S.bloomAt = at || null;
  S.pop = why === 'shift';
  S.dragSummon = ['shift', 'corner', 'edge'].includes(why);
  S.peek = null;
  S.items = null;
  setState('ready');
  S.hot = -1;
  drawPill();
  drawRing([]);
  drawCenter();
  drawCaption();
  layout();
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
  if (S.depth > 0) stage.classList.add('over');
  if (state === 'ready' && S.peek) stage.classList.add('live');
  if (!card.hidden) stage.classList.add('card-open');
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
    return `<g class="petal${it.danger ? ' danger' : ''}${dim ? ' dim' : ''}" data-i="${i}" style="${style}">${body}<text class="l" x="${x.toFixed(1)}" y="${(y - (it.hint ? 6 : 0)).toFixed(1)}">${esc(it.label)}</text>${hint}</g>`;
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
let centerSeq = 0;
const capsule = (html, cls = '') => `<div class="cap ${cls}">${html}</div>`;
function sizeText(files) {
  if (files.length > 1) return `${files.length} files`;
  const i = S.info;
  if (!i) return extOf(files[0]).toUpperCase() || 'File';
  return i.isDir ? 'Folder' : fmtBytes(i.size);
}
async function drawCenter() {
  const seq = ++centerSeq;
  const it = S.ring[S.hot];
  const files = S.files.length ? S.files : S.peek || [];
  const hot = it ? capsule(esc(it.label), 'hot') : '';
  let html;
  if (S.state === 'busy') {
    const j = S.job || {};
    html = `${files[0] ? await fileVisual(files[0]) : ''}${capsule(`<span class="p">${j.status === 'queued' ? 'Waiting' : `${Math.round((j.progress || 0) * 100)}%`}</span><span class="x">${icon('close', 'sm')}Cancel</span>`)}`;
  } else if (S.state === 'done') {
    const out = S.result?.outs?.[0];
    html = `${out && !S.result.inPlace ? await fileVisual(out) : `<div class="glyph">${icon('check', 'lg')}</div>`}<div class="tick">${icon('check', 'sm')}</div>${hot}`;
  } else if (S.state === 'failed') html = `<div class="glyph bad">${icon('warning', 'lg')}</div>${hot || capsule('Didn’t finish', 'bad')}`;
  else if (files.length && (S.state === 'open' || S.state === 'ready')) html = `${await fileVisual(files[0])}${files.length > 1 ? `<div class="badge">${files.length}</div>` : ''}${hot || capsule(esc(sizeText(files)))}`;
  else html = limeSvg(62, 'c').replace('<svg', '<svg class="logo"');
  if (seq !== centerSeq) return;
  center.innerHTML = html;
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
    capName.textContent = S.files.length === 1 ? nameOf(S.files[0]) : `${S.files.length} files`;
    if (it?.tool) {
      const key = `${it.tool}|${JSON.stringify(it.opts || {})}`;
      if (!suggestCache.has(key)) suggestCache.set(key, api.invoke('tools:suggest', it.tool, S.files, { ...defaultsFor(catalog[it.tool]), ...(it.opts || {}) }).catch(() => null));
      const s = await suggestCache.get(key);
      if (S.ring[S.hot] !== it) return;
      capMeta.textContent = catalog[it.tool]?.editor ? `Opens ${catalog[it.tool].name}` : s?.kind === 'file' ? `→ ${s.name}` : s?.kind === 'folder' ? `→ ${s.name}/` : s?.kind === 'dir' ? `→ ${S.files.length} new files` : catalog[it.tool]?.name || '';
    } else capMeta.textContent = it ? it.hint || '' : S.files.length === 1 ? describe(S.info, S.files[0]) : `${new Set(S.files.map((f) => extOf(f).toUpperCase())).size > 1 ? 'Mixed' : extOf(S.files[0]).toUpperCase()} · ${fmtBytes(S.info?.total || 0)}`;
  } else if (S.state === 'busy') {
    capName.textContent = S.job?.name || 'Working';
    capMeta.textContent = S.job?.label || '';
  } else if (S.state === 'done') {
    const r = S.result;
    capName.textContent = r.outs.length === 1 ? nameOf(r.outs[0]) : r.outs.length ? `${r.outs.length} files saved` : r.title;
    capMeta.textContent = it?.hint ? `${it.label} · ${it.hint}` : r.note || (r.outs.length ? 'Drag from the centre, or pick an action' : '');
  } else if (S.state === 'failed') {
    capName.textContent = `${S.result?.title || 'That'} didn’t finish`;
    capMeta.textContent = S.result?.error || '';
  } else if (S.state === 'ready' && S.peek && S.ring.length) {
    capName.textContent = S.peek.length === 1 ? nameOf(S.peek[0]) : `${S.peek.length} files`;
    capMeta.textContent = it ? `Release to ${actionText(it)}` : `Drop on a choice${modHint()}`;
  } else if (S.state === 'ready') {
    capName.textContent = 'Drop files here';
    capMeta.textContent = 'or click the lime to choose';
  }
}

function actionText(it) {
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
  const modes = S.state === 'open' ? MODES : S.state === 'ready' && S.peek ? MODES.filter(([m]) => ringFor(m).length) : [];
  pill.innerHTML = `${modes.map(([id, l]) => `<button role="tab" data-m="${id}" aria-selected="${S.mode === id}">${l}</button>`).join('')}<button class="x" data-a="close" title="Close (Esc)">${icon('close', 'sm')}</button>`;
}
function ringFor(mode) {
  if (!S.items) return [];
  return mode === 'more' ? S.items.more : S.items[mode] || [];
}
function setMode(m) {
  S.mode = m;
  S.hot = -1;
  drawPill();
  drawRing(ringFor(m));
  drawCenter();
  drawCaption();
}

async function openWith(files, { mode } = {}) {
  if (!files?.length) return;
  clearTimeout(collapseT);
  closeCard(true);
  S.files = files;
  S.result = null;
  S.info = null;
  S.peek = null;
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
    S.result = { title: j.name, outs, note: note.includes('\n') ? note.split('\n')[0] : note, fullNote: note, text, inPlace: j.results[0]?.inPlace };
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
function showAll() {
  const ids = S.items.all || [];
  const node = h(`<div><div class="search"><input class="input" type="search" placeholder="Search ${ids.length} tools" spellcheck="false"><button class="btn subtle icon" data-a="x">${icon('close', 'sm')}</button></div><div class="list"></div></div>`);
  const list = $('.list', node), q = $('input', node);
  let kb = -1;
  const render = () => {
    const term = q.value.trim().toLowerCase();
    const tools = ids.map((id) => catalog[id]).filter((t) => t && (!term || `${t.name} ${t.desc} ${t.craft || ''}`.toLowerCase().includes(term)));
    list.innerHTML = CATS.map(([c, label]) => {
      const ts = tools.filter((t) => t.cat === c);
      return ts.length ? `<div class="grp">${label}</div>${ts.map((t) => `<button data-t="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span>${t.craft ? `<i>${CRAFT[t.craft]}</i>` : ''}</button>`).join('')}` : '';
    }).join('') || '<p class="muted" style="padding:8px">No tools match.</p>';
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
    if (t.editor) { pick({ tool: t.id }); return; }
    if ((t.options || []).length) showOptions(t, defaultsFor(t)); else run(t, defaultsFor(t));
  });
  openCard(node);
  render();
  setTimeout(() => q.focus(), 60);
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
const ringIndexAt = (x, y) => hitIndex(...toWheel(x, y), S.ring.length, R_IN - 2, R_OUT + 14);
const inCenter = (x, y) => Math.hypot(...toWheel(x, y)) < R_IN - 4;
const petalAt = (e) => (['open', 'done', 'failed'].includes(S.state) ? ringIndexAt(e.clientX, e.clientY) : -1);
wheelEl.addEventListener('pointermove', (e) => { if (['open', 'done', 'failed'].includes(S.state)) setHot(petalAt(e)); });
wheelEl.addEventListener('pointerleave', () => { if (['open', 'done', 'failed'].includes(S.state)) setHot(-1); });
let downAt = null, dragging = false;
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.pill, .card, input, button, select, textarea')) return;
  const onBtn = e.target.classList?.contains('btn') || inCenter(e.clientX, e.clientY);
  const onPetal = petalAt(e) >= 0;
  downAt = { x: e.screenX, y: e.screenY, onBtn, onPetal, i: petalAt(e) };
  dragging = false;
  if (onPetal) $(`.petal[data-i="${downAt.i}"]`)?.classList.add('press');
});
window.addEventListener('pointermove', (e) => {
  if (!downAt || dragging) return;
  if (Math.hypot(e.screenX - downAt.x, e.screenY - downAt.y) > 4 && (S.state === 'idle' || (!downAt.onPetal && !downAt.onBtn) || (S.state === 'idle' && downAt.onBtn))) {
    dragging = true;
    $$('.petal.press').forEach((g) => g.classList.remove('press'));
    api.invoke('wheel:dragStart');
  }
});
window.addEventListener('pointerup', async (e) => {
  const d = downAt;
  downAt = null;
  $$('.petal.press').forEach((g) => g.classList.remove('press'));
  if (!d) return;
  if (dragging) { dragging = false; api.invoke('wheel:dragEnd'); return; }
  if (d.onPetal) { const i = petalAt(e); if (i === d.i) pick(S.ring[i], { options: e.altKey }); return; }
  if (S.state === 'idle' && e.target.closest('.tab')) { expand('click'); return; }
  if (d.onBtn || e.target.closest('.center')) {
    if (S.state === 'ready') { S.asking = true; const files = await api.invoke('dialog:open', { title: 'Choose files for Lime' }).finally(() => { S.asking = false; }); if (files.length) openWith(files); }
    else if (S.state === 'busy' && S.job) api.invoke('jobs:cancel', S.job.id);
    else if (S.ring[S.hot]) pick(S.ring[S.hot]);
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
let wheelAcc = 0;
stage.addEventListener('wheel', (e) => {
  if (e.target.closest('.card')) return;
  if (['idle', 'busy', 'ready'].includes(S.state) || !S.ring.length) return;
  e.preventDefault();
  wheelAcc += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  const n = S.ring.length;
  while (Math.abs(wheelAcc) >= 26) {
    const dir = Math.sign(wheelAcc);
    wheelAcc -= dir * 26;
    setHot(S.hot < 0 ? (dir > 0 ? 0 : n - 1) : (S.hot + dir + n) % n);
  }
}, { passive: false });
pill.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.a === 'close') { if (S.state === 'busy') { collapseKeepJob(); } else collapse(); return; }
  if (b.dataset.m) { closeCard(); setMode(b.dataset.m); }
});
function collapseKeepJob() {
  fold({ keepJob: true }).then(() => tabProgress(S.job?.progress || 0));
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select') && e.key !== 'Escape') return;
  if (e.key === 'Escape') { e.preventDefault(); if (!card.hidden) closeCard(); else if (S.state === 'busy') collapseKeepJob(); else collapse(); return; }
  if (S.state === 'idle' || S.state === 'busy') return;
  if (S.state === 'ready') return;
  const n = S.ring.length;
  if (e.key === 'Tab' && S.state === 'open') { e.preventDefault(); const i = MODES.findIndex(([m]) => m === S.mode); closeCard(true); setMode(MODES[(i + (e.shiftKey ? 2 : 1)) % 3][0]); return; }
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
window.addEventListener('dragenter', (e) => {
  if (!isFiles(e)) return;
  e.preventDefault();
  if (++S.depth === 1) {
    stage.classList.add('over');
    clearTimeout(collapseT);
    clearTimeout(foldT);
    if (S.state === 'idle') expand('edge');
  }
});
window.addEventListener('dragover', (e) => {
  if (!isFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  if (S.state !== 'ready' || !S.peek) return;
  dragMods(e);
  const tab = e.target.closest?.('.pill button[data-m]');
  dwellOn(tab || null);
  setHot(tab ? -1 : ringIndexAt(e.clientX, e.clientY));
});
window.addEventListener('dragleave', () => {
  if (--S.depth > 0) return;
  S.depth = 0;
  stage.classList.remove('over');
  dwellOn(null);
  if (S.state === 'ready') { setHot(-1); armFold(1400); }
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  S.depth = 0;
  clearTimeout(foldT);
  dwellOn(null);
  stage.classList.remove('over');
  const real = [...(e.dataTransfer?.files || [])].map((f) => api.pathFor(f)).filter(Boolean);
  const files = real.length ? real : S.peek || [];
  if (!files.length) return;
  const it = S.state === 'ready' && S.peek ? S.ring[ringIndexAt(e.clientX, e.clientY)] : null;
  S.dropping = true;
  if (!it) { openWith(files).finally(() => { S.dropping = false; }); return; }
  const want = itemKey(it);
  S.settle = true;
  await openWith(files, { mode: S.mode }).finally(() => { S.settle = false; S.dropping = false; });
  const match = [S.mode, 'convert', 'tools', 'more'].flatMap((m) => ringFor(m)).find((x) => itemKey(x) === want);
  if (!match) { flash(`${it.label} isn’t available for ${files.length === 1 ? nameOf(files[0]) : 'these files'}`); return; }
  setHot(S.ring.indexOf(match));
  pick(match);
});
window.addEventListener('blur', () => { if ((S.state === 'open' || (S.state === 'ready' && !S.dragSummon)) && card.hidden && !S.asking) armCollapse(900); });
window.addEventListener('focus', () => { if (S.state === 'open' || S.state === 'ready') clearTimeout(collapseT); });
stage.addEventListener('pointerenter', () => { clearTimeout(collapseT); clearTimeout(foldT); });
stage.addEventListener('pointerleave', () => { if (S.state === 'done') armCollapse(6000); if (S.state === 'ready' && !S.depth) armFold(2500); });

api.on('wheel:files', (files) => openWith(files));
api.on('wheel:summon', ({ why, at, peek }) => { if (S.state === 'idle') expand(why, at, peek); else if (why === 'show') window.focus(); else if (S.state === 'ready' && peek?.length) setPeek(peek); });
api.on('wheel:peek', (files) => { if (S.state === 'ready') setPeek(files); });
api.on('wheel:dragEnded', () => { if (S.state === 'ready' && S.dragSummon) setTimeout(() => { if (S.state === 'ready' && !S.depth && !S.dropping) fold(); }, 260); });
api.on('wheel:fold', () => { if (S.state === 'busy') collapseKeepJob(); else collapse(); });
api.on('settings', (s) => { settings = s; const nk = SIZES[s.size] || 1; if (nk !== k) { k = nk; layout(); } });

setState('idle');
drawRing([]);
drawCenter();
layout();
window.__lime = { S, openWith, collapse, fold, expand, pick, setHot, setMode, showAll, showOptions, setPeek, ringIndexAt, catalog, geo: () => geo };
