import { icon, GROUP_ICON } from './icons.js';
import { petal, labelAt, arc, limeSvg } from './petal.js';
import { api, $, $$, h, esc, nameOf, extOf, fmtBytes, clean, applyTheme, defaultsFor, missingRequired, form } from './ui.js';

const R_IN = 50, R_OUT = 120, R_LABEL = 86;
const IDLE = 0.6;
const SIZES = { s: 0.88, m: 1, l: 1.14 };
const MODES = [['convert', 'Convert'], ['tools', 'Tools'], ['more', 'More']];
const isMac = api.platform === 'darwin';
const stage = $('#stage'), svg = $('.dial'), petalsG = $('.petals'), center = $('.center'), pill = $('.pill'), card = $('.card');
const capName = $('.caption .name'), capMeta = $('.caption .meta');

let settings = await applyTheme();
const catalog = Object.fromEntries((await api.invoke('catalog')).map((t) => [t.id, t]));
const S = { state: 'idle', files: [], items: null, mode: 'convert', hot: -1, ring: [], job: null, result: null, last: null, thumbs: new Map(), info: null, cardFor: null, depth: 0 };
let k = SIZES[settings.size] || 1;
let collapseT = null;

function layout() {
  const open = S.state !== 'idle';
  const cardH = card.hidden ? 0 : Math.min(card.scrollHeight, 380) + 14;
  const L = open ? { w: 330, h: 392 + (cardH ? cardH + 4 : 0), cx: 165, cy: 194 } : { w: 210, h: 210, cx: 105, cy: 105 };
  stage.style.setProperty('--w', `${L.w}px`);
  stage.style.setProperty('--h', `${L.h}px`);
  stage.style.setProperty('--cx', `${L.cx}px`);
  stage.style.setProperty('--cy', `${L.cy}px`);
  stage.style.setProperty('--k', k);
  stage.style.setProperty('--idle-scale', IDLE);
  $('.wheel').style.setProperty('--ws', open ? 1 : IDLE);
  return api.invoke('wheel:layout', { w: Math.ceil(L.w * k), h: Math.ceil(L.h * k), ax: Math.round(L.cx * k), ay: Math.round(L.cy * k) });
}
function setState(state) {
  S.state = state;
  stage.className = state;
  if (!card.hidden) stage.classList.add('card-open');
}

function drawRing(list, { dim = false } = {}) {
  S.ring = list || [];
  const n = S.ring.length;
  petalsG.classList.toggle('dense', n > 8);
  if (!n) {
    petalsG.innerHTML = Array.from({ length: 8 }, (_, i) => `<g class="petal" style="--i:${i}"><path d="${petal(i, 8, R_IN, R_OUT, 4)}"/></g>`).join('');
    return;
  }
  petalsG.innerHTML = S.ring.map((it, i) => {
    const [x, y] = labelAt(i, n, R_LABEL);
    const hasHint = !!it.hint;
    return `<g class="petal${it.danger ? ' danger' : ''}${dim ? ' dim' : ''}" data-i="${i}" style="--i:${i}"><path d="${petal(i, n, R_IN, R_OUT, 4)}"/><text class="l" x="${x.toFixed(1)}" y="${(y - (hasHint ? 5.5 : 0)).toFixed(1)}">${esc(it.label)}</text>${hasHint ? `<text class="h" x="${x.toFixed(1)}" y="${(y + 8).toFixed(1)}">${esc(String(it.hint).toUpperCase())}</text>` : ''}</g>`;
  }).join('');
  fitLabels(n);
  setHot(S.hot >= n ? -1 : S.hot, true);
}
function fitLabels(n) {
  const max = Math.max(36, 2 * R_LABEL * Math.sin(Math.PI / Math.max(n, 2)) - 12);
  $$('.petal text', petalsG).forEach((t) => {
    const len = t.getComputedTextLength?.() || 0;
    if (len > max) t.style.fontSize = `${(parseFloat(getComputedStyle(t).fontSize) * max) / len}px`;
  });
}
function setHot(i, force) {
  if (i === S.hot && !force) return;
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
  const m = { pdf: 'pdf', mp4: 'video', mov: 'video', mkv: 'video', webm: 'video', mp3: 'audio', wav: 'audio', m4a: 'audio', flac: 'audio', docx: 'doc', doc: 'doc', txt: 'doc', md: 'doc', html: 'doc', xlsx: 'sheet', csv: 'sheet', pptx: 'slides', key: 'slides', zip: 'archive', rar: 'archive', '7z': 'archive', dwg: 'cad2d', dxf: 'cad2d', stl: 'cad3d', step: 'cad3d', stp: 'cad3d', obj: 'cad3d', glb: 'cad3d', ai: 'vector', eps: 'vector', svg: 'image', idml: 'layout' };
  return m[e] || (/^(jpe?g|png|heic|heif|webp|gif|tiff?|avif|bmp|psd)$/.test(e) ? 'image' : e ? 'any' : 'folder');
}
async function fileVisual(p) {
  const url = await thumbUrl(p);
  return url ? `<img class="thumb" src="${url}" alt="">` : `<div class="glyph">${icon(GROUP_ICON[groupOfFile(p)] || 'doc', 'lg')}</div>`;
}
let centerSeq = 0;
async function drawCenter() {
  const seq = ++centerSeq;
  const it = S.ring[S.hot];
  let html = '';
  if (S.state === 'idle') html = limeSvg(58, 'c').replace('<svg', '<svg class="logo"');
  else if (S.state === 'busy') {
    const j = S.job || {};
    html = `<div><div class="pct">${Math.round((j.progress || 0) * 100)}%</div><div class="small">${esc(j.status === 'queued' ? 'Waiting' : (j.label || 'Working').replace(/ · .*/, ''))}</div><div class="cancel">${icon('close')}Cancel</div></div>`;
  } else if (it) html = `<div><div class="big">${esc(it.label)}</div>${it.hint ? `<div class="small">${esc(it.hint)}</div>` : ''}</div>`;
  else if (S.state === 'done') html = S.result?.outs?.[0] && !S.result.inPlace ? `${await fileVisual(S.result.outs[0])}<div class="tick">${icon('check', 'sm')}</div>` : `<div class="ok">${icon('check', 'lg')}</div>`;
  else if (S.state === 'failed') html = `<div class="bad">${icon('warning', 'lg')}</div>`;
  else if (S.files.length) html = `${await fileVisual(S.files[0])}${S.files.length > 1 ? `<div class="badge">${S.files.length}</div>` : ''}`;
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
  }
}

function drawPill() {
  const modes = S.state === 'open' ? MODES : [];
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
  stage.classList.remove('open');
  void stage.offsetWidth;
  stage.classList.add('open');
}

async function openWith(files) {
  if (!files?.length) return;
  clearTimeout(collapseT);
  closeCard(true);
  S.files = files;
  S.result = null;
  S.info = null;
  S.items = await api.invoke('wheel:items', files);
  if (!S.items.convert.length && S.items.tools.length) S.mode = 'tools'; else S.mode = S.items.convert.length ? 'convert' : 'more';
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
  clearTimeout(collapseT);
  closeCard(true);
  if (S.state === 'busy') return;
  S.files = [];
  S.items = null;
  S.result = null;
  S.hot = -1;
  setState('idle');
  drawRing([]);
  drawCenter();
  await new Promise((r) => setTimeout(r, 260));
  if (S.state === 'idle') layout();
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
  const opts = { ...defaultsFor(tool), ...(it.opts || {}) };
  if (options || it.ask || missingRequired(tool, opts)) return showOptions(tool, opts, it);
  return run(tool, opts);
}
async function run(tool, opts) {
  const dest = await api.invoke('save:ask', { tool: tool.id, files: S.files, opts }).catch((e) => { flash(clean(e)); return null; });
  if (dest === null) return;
  closeCard(true);
  const id = await api.invoke('jobs:submit', { tool: tool.id, files: S.files, opts, dest: dest.kind === 'none' || dest.kind === 'auto' ? null : dest }).catch((e) => { fail(tool.name, clean(e), { tool, opts }); return null; });
  if (!id) return;
  S.last = { tool, opts, files: S.files };
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
  prog.setAttribute('d', p == null ? '' : arc(139, Math.max(0.015, p)));
}
api.on('jobs', (list) => {
  if (!S.job) return;
  const j = list.find((x) => x.id === S.job.id);
  if (!j) return;
  S.job = j;
  if (j.status === 'running' || j.status === 'queued') {
    drawProgress(j.progress || 0);
    if (S.state === 'busy') { drawCenter(); drawCaption(); } else if (S.state === 'idle') drawProgress(j.progress || 0);
    return;
  }
  const job = S.job;
  S.job = null;
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
  collapseT = setTimeout(() => { if (!stage.matches(':hover') && card.hidden && (S.state === 'done' || S.state === 'open')) collapse(); }, ms);
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
const verbFor = (tool, opts) => {
  if (/^convert|^develop|^render/.test(tool.id)) return opts.to ? `Convert to ${String(opts.to).toUpperCase().replace('HEVC', 'HEVC MP4')}` : 'Convert';
  return tool.name.split(' ')[0];
};
function showOptions(tool, opts, it) {
  S.cardFor = tool.id;
  const node = h(`<div><div class="head"><h3>${esc(tool.name)}</h3><button class="btn subtle icon" data-a="x" title="Close">${icon('close', 'sm')}</button></div><p class="desc">${esc(tool.desc || '')}</p></div>`);
  const btn = h(`<button class="btn primary">${esc(verbFor(tool, opts))}</button>`);
  node.append(form(tool, opts, () => { btn.textContent = verbFor(tool, opts); requestAnimationFrame(layout); }));
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

function petalFromEvent(e) {
  const g = e.target.closest?.('.petal[data-i]');
  return g ? Number(g.dataset.i) : -1;
}
svg.addEventListener('pointermove', (e) => { if (S.state !== 'idle' && S.state !== 'busy') setHot(petalFromEvent(e)); });
svg.addEventListener('pointerleave', () => { if (S.state !== 'idle' && S.state !== 'busy') setHot(-1); });
let downAt = null, dragging = false;
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.pill, .card, input, button, select, textarea')) return;
  const onBtn = e.target.classList?.contains('btn');
  const onPetal = petalFromEvent(e) >= 0;
  downAt = { x: e.screenX, y: e.screenY, onBtn, onPetal, i: petalFromEvent(e) };
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
  if (d.onPetal) { const i = petalFromEvent(e); if (i === d.i) pick(S.ring[i], { options: e.altKey }); return; }
  if (d.onBtn || e.target.closest('.center')) {
    if (S.state === 'idle') { const files = await api.invoke('dialog:open', { title: 'Choose files for Lime' }); if (files.length) openWith(files); }
    else if (S.state === 'busy' && S.job) api.invoke('jobs:cancel', S.job.id);
    else if (S.ring[S.hot]) pick(S.ring[S.hot]);
    else if (S.state === 'done' && S.result?.outs?.[0]) api.invoke('shell:show', S.result.outs[0]);
  }
});
svg.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const i = petalFromEvent(e);
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
  if (S.state === 'idle' || S.state === 'busy' || !S.ring.length) return;
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
  closeCard(true);
  setState('idle');
  drawRing([]);
  drawCenter();
  setTimeout(layout, 260);
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select') && e.key !== 'Escape') return;
  if (e.key === 'Escape') { e.preventDefault(); if (!card.hidden) closeCard(); else if (S.state === 'busy') collapseKeepJob(); else collapse(); return; }
  if (S.state === 'idle' || S.state === 'busy') return;
  const n = S.ring.length;
  if (e.key === 'Tab' && S.state === 'open') { e.preventDefault(); const i = MODES.findIndex(([m]) => m === S.mode); closeCard(true); setMode(MODES[(i + (e.shiftKey ? 2 : 1)) % 3][0]); return; }
  if (n && ['ArrowRight', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setHot((S.hot + 1 + n) % n); }
  if (n && ['ArrowLeft', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setHot(S.hot < 0 ? n - 1 : (S.hot - 1 + n) % n); }
  if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) pick(S.ring[Number(e.key) - 1]);
  if ((e.key === 'Enter' || e.key === ' ') && S.ring[S.hot]) { e.preventDefault(); pick(S.ring[S.hot], { options: e.altKey }); }
});

const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!isFiles(e)) return;
  e.preventDefault();
  if (++S.depth === 1) { stage.classList.add('over'); clearTimeout(collapseT); }
});
window.addEventListener('dragover', (e) => { if (isFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragleave', () => { if (--S.depth <= 0) { S.depth = 0; stage.classList.remove('over'); } });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  S.depth = 0;
  stage.classList.remove('over');
  const files = [...(e.dataTransfer?.files || [])].map((f) => api.pathFor(f)).filter(Boolean);
  if (files.length) openWith(files);
});
window.addEventListener('blur', () => { if (S.state === 'open' && card.hidden) armCollapse(900); });
window.addEventListener('focus', () => { if (S.state === 'open') clearTimeout(collapseT); });
stage.addEventListener('pointerenter', () => clearTimeout(collapseT));
stage.addEventListener('pointerleave', () => { if (S.state === 'done') armCollapse(6000); });

api.on('wheel:files', (files) => openWith(files));
api.on('wheel:pulse', () => { stage.classList.remove('pulse'); void stage.offsetWidth; stage.classList.add('pulse'); });
api.on('settings', (s) => { settings = s; const nk = SIZES[s.size] || 1; if (nk !== k) { k = nk; layout(); } });

setState('idle');
drawRing([]);
drawCenter();
layout();
window.__lime = { S, openWith, collapse, pick, setHot, setMode, showAll, showOptions, catalog };
