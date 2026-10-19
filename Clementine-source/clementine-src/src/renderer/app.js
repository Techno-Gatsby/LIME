import { icon } from './icons.js';
import { createWheel, KEY_LABEL } from './wheel.js';
import { api, $, $$, esc, h, extOf, nameOf, dirOf, groupOf, GROUP_CAT, GROUP_ICON, fmtBytes, timeAgo, thumbEl, thumbUrl, defaultsFor, runPick, guessFromDrag, pathsFromDrop } from './common.js';
import { openEditor } from './editor.js';

const S = {
  info: null, catalog: null, tools: new Map(), settings: null, jobs: [], recent: [],
  selection: [], toolState: new Map(), watch: new Set(), notified: new Set(), editor: null, engineProgress: {}, craftProgress: {},
};
let cleanupView = null;

/* ---------- boot ---------- */
async function boot() {
  S.info = await api.invoke('app:info');
  applyTheme(S.info);
  if (S.info.isWin) document.documentElement.classList.add('mica');
  S.catalog = await api.invoke('catalog');
  S.catalog.tools.forEach((t) => S.tools.set(t.id, t));
  S.settings = await api.invoke('settings:get');
  S.jobs = await api.invoke('jobs:list');
  S.recent = await api.invoke('recent:list');
  buildShell();
  api.on('jobs', (list) => { S.jobs = list; onJobs(); });
  api.on('recent', (r) => { S.recent = r; if (route().name === 'home') renderView(); });
  api.on('settings', (s) => { S.settings = s; });
  api.on('theme', (t) => applyTheme({ ...S.info, ...t }));
  api.on('open', onOpenPayload);
  api.on('engines:progress', (p) => { S.engineProgress[p.name] = p; refreshEngineRows(); });
  api.on('craft:progress', (p) => { S.craftProgress[p.id] = p; if (route().name === 'studio') updateCraftProgress(p); });
  window.addEventListener('hashchange', renderView);
  window.addEventListener('resize', autoCompact);
  setupDragWheel();
  setupKeys();
  autoCompact();
  renderView();
}
function applyTheme(t) {
  const theme = S.settings?.theme && S.settings.theme !== 'system' ? S.settings.theme : (t.dark ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  if (t.accent) {
    document.documentElement.style.setProperty('--accent', t.accent);
    const n = parseInt(t.accent.slice(1), 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    document.documentElement.style.setProperty('--on-accent', lum > 0.62 ? '#000000' : '#ffffff');
  }
}

/* ---------- shell ---------- */
const NAV = [
  { id: 'home', label: 'Home', icon: 'home', hash: '#/home' },
  { id: 'cat:pdf', label: 'PDF', icon: 'pdf', hash: '#/cat/pdf' },
  { id: 'cat:image', label: 'Images', icon: 'image', hash: '#/cat/image' },
  { id: 'cat:media', label: 'Video & audio', icon: 'video', hash: '#/cat/media' },
  { id: 'cat:docs', label: 'Documents', icon: 'document', hash: '#/cat/docs' },
  { id: 'cat:archive', label: 'Archives', icon: 'zip', hash: '#/cat/archive' },
  { id: 'cat:utility', label: 'Utilities', icon: 'wrench', hash: '#/cat/utility' },
  { id: 'studio', label: 'Studio apps', icon: 'sparkle', hash: '#/studio' },
  { spacer: true },
  { id: 'activity', label: 'Activity', icon: 'history', hash: '#/activity' },
  { id: 'settings', label: 'Settings', icon: 'settings', hash: '#/settings' },
];
function buildShell() {
  document.body.innerHTML = `
  <div class="app" id="app">
    <header class="titlebar">
      <button class="btn subtle icon nav-toggle" id="navToggle" aria-label="Collapse navigation" title="Navigation">${icon('menu')}</button>
      <div class="brand"><img src="assets/logo.svg" alt="">Clementine</div>
      <div class="search" role="search">
        ${icon('search', 'sm')}
        <input id="search" type="search" placeholder="Search tools" aria-label="Search tools" autocomplete="off" spellcheck="false">
        <kbd>Ctrl K</kbd>
        <div class="search-results" id="searchResults" hidden role="listbox"></div>
      </div>
    </header>
    <nav class="nav" aria-label="Main">
      ${NAV.map((n) => (n.spacer ? '<div class="spacer"></div>' : `<button data-nav="${n.id}" data-hash="${n.hash}" title="${n.label}">${icon(n.icon)}<span>${n.label}</span>${n.id === 'activity' ? '<span class="badge" id="jobBadge" hidden></span>' : ''}</button>`)).join('')}
    </nav>
    <main class="view" id="view" tabindex="-1"></main>
  </div>
  <div class="toasts" id="toasts" aria-live="polite"></div>`;
  $$('.nav button').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.hash; }));
  $('#navToggle').addEventListener('click', () => { S.manualCompact = !$('#app').classList.contains('compact'); $('#app').classList.toggle('compact', S.manualCompact); });
  setupSearch();
  updateBadge();
}
function autoCompact() {
  if (route().name === 'editor') return;
  if (S.manualCompact != null && window.innerWidth >= 1000) { $('#app')?.classList.toggle('compact', S.manualCompact); return; }
  $('#app')?.classList.toggle('compact', window.innerWidth < 1000);
}
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return { name: parts[0] || 'home', arg: decodeURIComponent(parts[1] || '') };
}
function go(hash) { if (location.hash === hash) renderView(); else location.hash = hash; }
function renderView() {
  const r = route();
  const view = $('#view');
  if (cleanupView) { const c = cleanupView; cleanupView = null; c(); }
  const navId = r.name === 'cat' ? `cat:${r.arg}` : r.name === 'tool' ? `cat:${S.tools.get(r.arg)?.cat}` : r.name === 'editor' ? 'cat:pdf' : r.name;
  $$('.nav button').forEach((b) => { if (b.dataset.nav === navId) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  view.innerHTML = '';
  view.style.overflow = r.name === 'editor' ? 'hidden' : '';
  if (r.name === 'editor') $('#app').classList.add('compact'); else autoCompact();
  const screens = { home: renderHome, cat: renderCategory, tool: renderTool, activity: renderActivity, studio: renderStudio, settings: renderSettings, editor: renderEditor };
  (screens[r.name] || renderHome)(view, r.arg);
  if (r.name !== 'editor') view.scrollTop = 0;
}

/* ---------- toasts ---------- */
function toast(msg, opts = {}) {
  const el = h(`<div class="toast ${opts.type || ''}">${icon(opts.type === 'error' ? 'error' : opts.type === 'success' ? 'check' : 'info')}<div class="msg"></div></div>`);
  $('.msg', el).textContent = msg;
  for (const a of opts.actions || []) {
    const b = h(`<button class="btn subtle">${esc(a.label)}</button>`);
    b.addEventListener('click', () => { a.fn(); el.remove(); });
    el.append(b);
  }
  const x = h(`<button class="btn subtle icon" aria-label="Dismiss">${icon('dismiss', 'sm')}</button>`);
  x.addEventListener('click', () => el.remove());
  el.append(x);
  $('#toasts').append(el);
  while ($('#toasts').children.length > 4) $('#toasts').firstElementChild.remove();
  setTimeout(() => el.remove(), opts.timeout || (opts.actions?.length ? 9000 : 5000));
  return el;
}

/* ---------- jobs ---------- */
function updateBadge() {
  const n = S.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  const b = $('#jobBadge');
  if (b) { b.hidden = !n; b.textContent = n; }
}
function onJobs() {
  updateBadge();
  for (const j of S.jobs) {
    if (!S.watch.has(j.id) || S.notified.has(j.id)) continue;
    if (j.status === 'done') { S.notified.add(j.id); resultToast(j); }
    if (j.status === 'error') { S.notified.add(j.id); errorToast(j); }
  }
  const r = route();
  if (r.name === 'activity') renderActivityList();
  if (r.name === 'tool') updateToolJob();
}
const outputsOf = (j) => (j.results || []).flatMap((r) => r.paths || (r.path ? [r.path] : []));
function resultToast(j) {
  const outs = outputsOf(j);
  const note = (j.results || []).map((r) => r.note).filter(Boolean)[0];
  const msg = `${j.name}: ${outs.length ? (outs.length === 1 ? nameOf(outs[0]) : `${outs.length} files`) : 'done'}${note && !note.includes('\n') ? `\n${note}` : ''}`;
  toast(msg, { type: 'success', actions: outs.length ? [{ label: 'Open', fn: () => api.invoke('shell:open', outs[0]) }, { label: 'Show in folder', fn: () => api.invoke('shell:show', outs[0]) }] : [] });
}
function errorToast(j) {
  const actions = [];
  if (j.code === 'ENGINE_MISSING') actions.push({ label: 'Get it', fn: () => go('#/settings') });
  else actions.push({ label: 'Details', fn: () => go('#/activity') });
  toast(`${j.name} didn’t finish\n${j.error}`, { type: 'error', actions });
}
async function runTool(toolId, files, opts) {
  const t = S.tools.get(toolId);
  const id = await api.invoke('jobs:submit', { tool: toolId, files, opts: { ...defaultsFor(t), ...opts } });
  S.watch.add(id);
  return id;
}

/* ---------- search ---------- */
function setupSearch() {
  const input = $('#search'), box = $('#searchResults');
  let active = 0, results = [];
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.hidden = true; return; }
    const words = q.split(/\s+/);
    results = S.catalog.tools.map((t) => {
      const hay = `${t.name} ${t.desc} ${t.cat} ${(t.accepts || []).join(' ')}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      return { t, score: (t.name.toLowerCase().startsWith(q) ? 3 : 0) + (t.name.toLowerCase().includes(q) ? 2 : 0) + (t.featured ? 1 : 0) };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8).map((r) => r.t);
    active = 0;
    box.innerHTML = results.length ? results.map((t, i) => `<button role="option" data-id="${t.id}" class="${i === active ? 'active' : ''}"><span class="tile" data-cat="${t.cat}" style="width:32px;height:32px">${icon(t.icon, 'sm')}</span><span><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></span></button>`).join('') : '<div class="muted" style="padding:12px">No tools match. Try “compress”, “merge” or a format like “heic”.</div>';
    box.hidden = false;
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(1, results.length);
      $$('button', box).forEach((b, i) => b.classList.toggle('active', i === active));
    }
    if (e.key === 'Enter' && results[active]) { openTool(results[active].id); input.value = ''; box.hidden = true; input.blur(); }
    if (e.key === 'Escape') { input.value = ''; box.hidden = true; input.blur(); }
  });
  box.addEventListener('mousedown', (e) => { const b = e.target.closest('button[data-id]'); if (b) { e.preventDefault(); openTool(b.dataset.id); input.value = ''; box.hidden = true; input.blur(); } });
}
function setupKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'o' && route().name !== 'editor') { e.preventDefault(); chooseFiles().then((f) => { if (f.length) setSelection(f); }); }
  });
}

/* ---------- selection & opening ---------- */
async function chooseFiles(opts = {}) { return api.invoke('dialog:open', opts); }
function setSelection(files) {
  S.selection = [...new Set(files)];
  if (route().name !== 'home') go('#/home'); else renderView();
}
function openTool(id, files, opts) {
  const t = S.tools.get(id);
  if (!t) return;
  if (t.editor) {
    const pdf = (files || S.selection).find((f) => groupOf(f) === 'pdf');
    if (pdf) { S.editor = { file: pdf, mode: t.editor }; go('#/editor'); return; }
  }
  const st = toolState(id);
  if (files) { st.files = [...files]; st.job = null; }
  else if (!st.files.length && S.selection.length) st.files = S.selection.filter((f) => acceptsFile(t, f));
  if (opts) Object.assign(st.opts, opts);
  go(`#/tool/${id}`);
}
function onOpenPayload(p) {
  if (p.toast) toast(p.toast);
  if (p.route === 'tool' && p.tool) { openTool(p.tool, p.files, p.opts); return; }
  if (p.route) { S.highlight = p.highlight; go(`#/${p.route}`); }
  if (p.files?.length) setSelection(p.files);
}
function toolState(id) {
  if (!S.toolState.has(id)) S.toolState.set(id, { files: [], opts: defaultsFor(S.tools.get(id)), job: null, showAdvanced: false });
  return S.toolState.get(id);
}
function acceptsFile(t, f) {
  if (t.extAccept) return t.extAccept.includes(extOf(f));
  if (t.accepts.includes('any')) return true;
  return t.accepts.includes(groupOf(f));
}

/* ---------- home ---------- */
function toolCard(t) {
  const el = h(`<button class="tool-card" data-cat="${t.cat}"><span class="tile">${icon(t.icon)}</span><b>${esc(t.name)}</b><p>${esc(t.desc)}</p></button>`);
  el.addEventListener('click', () => openTool(t.id));
  return el;
}
function renderHome(view) {
  const page = h(`<div class="page"></div>`);
  page.append(h(`<div><h1 class="title">Drop files to get started</h1><p class="lead">Convert, compress, edit and combine files on this PC. Nothing is uploaded.</p></div>`));
  const hero = h(`<div class="hero"></div>`);
  hero.append(S.selection.length ? selectionPanel() : dropzone({ onFiles: setSelection, big: true }));
  const k = S.settings.keys;
  hero.append(h(`<section class="card wheel-help" aria-label="Quick wheel">
      <h3>Quick wheel</h3>
      <p class="muted" style="margin:0">Start dragging a file, then tap a key. Drop it on a slice.</p>
      <div class="keyrow"><kbd>${KEY_LABEL[k.convert]}</kbd><span>Convert to another format</span></div>
      <div class="keyrow"><kbd>${KEY_LABEL[k.tools]}</kbd><span>Compress, rotate, split, cut out</span></div>
      <div class="keyrow"><kbd>${KEY_LABEL[k.actions]}</kbd><span>Open, copy, show in Explorer</span></div>
      <p class="faint" style="margin:0;font-size:12px;line-height:16px">${S.info.isWin ? 'In File Explorer: right-click a file › Convert with Clementine, or select files and press Ctrl+Shift+Space.' : 'Works anywhere in this window.'}</p>
    </section>`));
  page.append(hero);
  const POPULAR = ['edit-pdf', 'compress-pdf', 'merge-pdf', 'pdf-to-word', 'convert-image', 'remove-background', 'compress-image', 'convert-video', 'compress-video', 'extract-audio', 'convert-document', 'extract-archive'];
  const featured = POPULAR.map((id) => S.tools.get(id)).filter(Boolean);
  page.append(h(`<h2 class="sub">Popular tools</h2>`));
  const grid = h(`<div class="grid"></div>`);
  featured.slice(0, 12).forEach((t) => grid.append(toolCard(t)));
  page.append(grid);
  page.append(h(`<h2 class="sub">Browse by type</h2>`));
  const cats = h(`<div class="cat-row"></div>`);
  for (const c of S.catalog.categories) {
    const n = S.catalog.tools.filter((t) => t.cat === c.id).length;
    const b = h(`<button class="cat-card" data-cat="${c.id}"><span class="tile">${icon(c.icon)}</span><span><b>${esc(c.name)}</b><small>${n} tools</small></span></button>`);
    b.addEventListener('click', () => go(`#/cat/${c.id}`));
    cats.append(b);
  }
  page.append(cats);
  if (S.recent.length) {
    const head = h(`<div class="section-head"><h2 class="sub">Recent</h2><button class="btn subtle">Clear</button></div>`);
    $('button', head).addEventListener('click', () => api.invoke('recent:clear'));
    page.append(head);
    const list = h(`<div class="card recent"></div>`);
    for (const r of S.recent.slice(0, 8)) {
      const row = h(`<div class="recent-row"></div>`);
      row.append(thumbEl(r.path, icon, 36));
      row.append(h(`<div style="min-width:0"><div class="name">${esc(nameOf(r.path))}</div><small>${esc(dirOf(r.path))} · ${timeAgo(r.at)}</small></div>`));
      row.append(h(`<span class="tag ${r.kind === 'output' ? 'out' : ''}">${r.kind === 'output' ? 'Result' : 'Used'}</span>`));
      const acts = h(`<div style="display:flex;gap:2px"><button class="btn subtle icon" title="Use this file">${icon('add', 'sm')}</button><button class="btn subtle icon" title="Open">${icon('open', 'sm')}</button><button class="btn subtle icon" title="Show in folder">${icon('folder', 'sm')}</button></div>`);
      const [use, open, show] = $$('button', acts);
      use.addEventListener('click', () => setSelection([...S.selection, r.path]));
      open.addEventListener('click', () => api.invoke('shell:open', r.path));
      show.addEventListener('click', () => api.invoke('shell:show', r.path));
      row.append(acts);
      list.append(row);
    }
    page.append(list);
  }
  view.append(page);
}
function dropzone({ onFiles, big, accept }) {
  const el = h(`<div class="dropzone" tabindex="0">
    <div><div class="dz-art" style="margin:0 auto">${icon('docAdd', 'xl')}</div>
    <h2>${big ? 'Drag files or folders here' : 'Add files'}</h2>
    <p>${big ? 'Any format: PDF, Office, images, video, audio, archives and more.' : 'Drop files here or choose them.'}</p>
    <div class="actions"><button class="btn primary" data-a="files">${icon('add', 'sm')}Choose files</button>${big ? '<button class="btn" data-a="folder">Choose a folder</button>' : ''}</div></div></div>`);
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    const files = await chooseFiles(a === 'folder' ? { folders: true } : { filters: accept });
    if (files.length) onFiles(files);
  });
  el.addEventListener('dragover', (e) => { if (!S.dragWheel) { e.preventDefault(); el.classList.add('over'); } });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => { el.classList.remove('over'); });
  el.dataset.dropTarget = '1';
  el._onFiles = onFiles;
  return el;
}
function selectionPanel() {
  const el = h(`<section class="card selection" aria-label="Selected files">
      <div class="selection-head"><h3 class="grow">${S.selection.length} file${S.selection.length === 1 ? '' : 's'} selected</h3>
      <button class="btn" data-a="add">${icon('add', 'sm')}Add</button><button class="btn subtle" data-a="clear">Clear</button></div>
      <div class="filechips"></div>
      <div><h3 style="margin-bottom:10px">What do you want to do?</h3><div class="grid sugg"></div></div>
    </section>`);
  const chips = $('.filechips', el);
  for (const f of S.selection) {
    const c = h(`<div class="filechip"></div>`);
    c.append(thumbEl(f, icon, 36));
    c.append(h(`<div style="min-width:0;flex:1"><div class="name" title="${esc(f)}">${esc(nameOf(f))}</div><small>${esc(extOf(f).toUpperCase() || 'Folder')}</small></div>`));
    const x = h(`<button class="btn subtle icon" aria-label="Remove">${icon('dismiss', 'sm')}</button>`);
    x.addEventListener('click', () => { S.selection = S.selection.filter((p) => p !== f); renderView(); });
    c.append(x);
    chips.append(c);
  }
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'clear') { S.selection = []; renderView(); }
    if (a === 'add') { const f = await chooseFiles(); if (f.length) setSelection([...S.selection, ...f]); }
  });
  api.invoke('files:toolsFor', S.selection).then((ids) => {
    const grid = $('.sugg', el);
    const ordered = ids.map((id) => S.tools.get(id)).filter(Boolean).sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    ordered.slice(0, 12).forEach((t) => grid.append(toolCard(t)));
    if (ordered.length > 12) {
      const more = h(`<button class="btn subtle" style="justify-self:start">Show all ${ordered.length} tools</button>`);
      more.addEventListener('click', () => { more.remove(); ordered.slice(12).forEach((t) => grid.append(toolCard(t))); });
      grid.after(more);
    }
    if (!ordered.length) grid.replaceWith(h(`<p class="muted">No tool takes this combination of files. Try selecting files of one type.</p>`));
  });
  return el;
}

/* ---------- category ---------- */
function renderCategory(view, cat) {
  const c = S.catalog.categories.find((x) => x.id === cat) || S.catalog.categories[0];
  const tools = S.catalog.tools.filter((t) => t.cat === c.id);
  const page = h(`<div class="page" data-cat="${c.id}">
    <div class="tool-head"><span class="tile big">${icon(c.icon, 'lg')}</span><div><h1 class="title">${esc(c.name)}</h1><p>${esc(c.desc)}</p></div></div>
    <div class="grid"></div></div>`);
  const grid = $('.grid', page);
  tools.forEach((t) => grid.append(toolCard(t)));
  view.append(page);
}

/* ---------- tool page ---------- */
let toolView = null;
function renderTool(view, id) {
  const t = S.tools.get(id);
  if (!t) { go('#/home'); return; }
  const st = toolState(id);
  const cat = S.catalog.categories.find((c) => c.id === t.cat);
  const page = h(`<div class="page" data-cat="${t.cat}">
    <div class="crumb"><button data-go="#/cat/${t.cat}">${esc(cat.name)}</button>${icon('chevron', 'sm')}<span>${esc(t.name)}</span></div>
    <div class="tool-head"><span class="tile big">${icon(t.icon, 'lg')}</span><div><h1 class="title">${esc(t.name)}</h1><p>${esc(t.desc)}</p></div></div>
    <div class="tool-body"><section class="card files-panel" aria-label="Files"></section><aside class="card opts" aria-label="Options"></aside></div></div>`);
  $('[data-go]', page).addEventListener('click', (e) => go(e.currentTarget.dataset.go));
  view.append(page);
  toolView = { t, st, page, files: $('.files-panel', page), opts: $('.opts', page) };
  renderFiles();
  renderOptions();
  if (t.prefill === 'pdfMetadata' && st.files[0] && !st.prefilled) {
    st.prefilled = true;
    api.invoke('files:describe', st.files[0]).then((d) => { ['title', 'author', 'subject', 'keywords'].forEach((k) => { if (d[k]) st.opts[k] = d[k]; }); renderOptions(); }).catch(() => {});
  }
  cleanupView = () => { toolView = null; };
}
function renderFiles() {
  const { t, st, files: panel } = toolView;
  panel.innerHTML = '';
  if (t.noFiles) {
    panel.append(h(`<div class="empty-state">${icon('globe', 'xl')}<p>This tool works from a web address. Enter it in the options.</p></div>`));
    return;
  }
  const add = (list) => {
    const ok = list.filter((f) => acceptsFile(t, f));
    const bad = list.length - ok.length;
    if (bad) toast(`${bad} file${bad === 1 ? '' : 's'} skipped: ${t.name} doesn’t take ${bad === 1 ? 'that type' : 'those types'}.`);
    st.files = t.max === 1 ? ok.slice(0, 1) : [...new Set([...st.files, ...ok])];
    st.job = null;
    renderFiles();
    renderOptions();
  };
  if (!st.files.length) {
    const dz = dropzone({ onFiles: add, big: false });
    $('h2', dz).textContent = t.allowNoFiles ? 'Add a file, or use a web address' : (t.min > 1 ? `Add at least ${t.min} files` : 'Add files');
    $('p', dz).textContent = acceptText(t);
    panel.append(dz);
    return;
  }
  const list = h(`<div class="file-list" role="list"></div>`);
  st.files.forEach((f, i) => {
    const row = h(`<div class="file-row" role="listitem" draggable="${t.ordered ? 'true' : 'false'}" data-i="${i}"></div>`);
    row.append(h(t.ordered ? `<span class="grip" title="Drag to reorder">${icon('drag', 'sm')}</span>` : '<span></span>'));
    row.append(thumbEl(f, icon, 40));
    const meta = h(`<div style="min-width:0"><div class="name" title="${esc(f)}">${esc(nameOf(f))}</div><small>${esc(dirOf(f))}</small></div>`);
    row.append(meta);
    api.invoke('files:describe', f).then((d) => {
      const bits = [fmtBytes(d.size)];
      if (d.pages) bits.push(`${d.pages} page${d.pages === 1 ? '' : 's'}`);
      if (d.width && d.height) bits.push(`${d.width} × ${d.height}`);
      if (d.duration) bits.push(`${Math.floor(d.duration / 60)}:${String(Math.round(d.duration % 60)).padStart(2, '0')}`);
      if (d.entries) bits.push(`${d.entries} items${d.encrypted ? ', encrypted' : ''}`);
      if (d.errorCode === 'PASSWORD') bits.push('Password-protected');
      $('small', meta).textContent = bits.filter(Boolean).join(' · ');
    }).catch(() => {});
    const acts = h(`<div style="display:flex;gap:2px">${t.ordered ? `<button class="btn subtle icon" data-m="-1" title="Move up">${icon('up', 'sm')}</button><button class="btn subtle icon" data-m="1" title="Move down">${icon('down', 'sm')}</button>` : ''}<button class="btn subtle icon" data-x title="Remove">${icon('dismiss', 'sm')}</button></div>`);
    acts.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.x !== undefined) st.files.splice(i, 1);
      else { const j = i + Number(b.dataset.m); if (j >= 0 && j < st.files.length) [st.files[i], st.files[j]] = [st.files[j], st.files[i]]; }
      st.job = null; renderFiles(); renderOptions();
    });
    row.append(acts);
    if (t.ordered) {
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-row', String(i)); row.classList.add('dragging'); S.rowDrag = true; });
      row.addEventListener('dragend', () => { row.classList.remove('dragging'); S.rowDrag = false; });
      row.addEventListener('dragover', (e) => { if (S.rowDrag) { e.preventDefault(); e.stopPropagation(); row.classList.add('drop-before'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop-before'));
      row.addEventListener('drop', (e) => {
        const from = Number(e.dataTransfer.getData('text/x-row'));
        if (Number.isNaN(from) || !S.rowDrag) return;
        e.preventDefault(); e.stopPropagation();
        const [moved] = st.files.splice(from, 1);
        st.files.splice(from < i ? i - 1 : i, 0, moved);
        renderFiles();
      });
    }
    list.append(row);
  });
  panel.append(list);
  const foot = h(`<div class="files-foot"><span class="grow muted">${st.files.length} file${st.files.length === 1 ? '' : 's'}${t.ordered && st.files.length > 1 ? ' · drag to set the order' : ''}</span>${t.max === 1 ? '<button class="btn" data-a="replace">Replace</button>' : `<button class="btn" data-a="add">${icon('add', 'sm')}Add files</button>`}<button class="btn subtle" data-a="clear">Clear</button></div>`);
  foot.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'clear') { st.files = []; st.job = null; renderFiles(); renderOptions(); }
    if (a === 'add' || a === 'replace') { const f = await chooseFiles({ multi: t.max !== 1 }); if (f.length) { if (a === 'replace') st.files = []; add(f); } }
  });
  panel.append(foot);
  panel.dataset.dropTarget = '1';
  panel._onFiles = add;
  if (t.preview === 'media' && st.files[0]) {
    const v = h(`<video class="preview-media" controls preload="metadata" src="media://file/${encodeURIComponent(st.files[0])}"></video>`);
    if (groupOf(st.files[0]) === 'audio') v.style.maxHeight = '60px';
    v.addEventListener('timeupdate', () => { S.mediaTime = v.currentTime; });
    panel.append(h('<div style="height:10px"></div>'), v, h(`<p class="faint" style="margin:6px 4px 0;font-size:12px">Play to the moment you want, then use “Set to current time”.</p>`));
  }
}
function acceptText(t) {
  const names = { pdf: 'PDF', image: 'images', raw: 'camera RAW', video: 'video', audio: 'audio', doc: 'documents', sheet: 'spreadsheets', slides: 'presentations', vector: 'vector files', archive: 'archives', subtitle: 'subtitles', any: 'any files or folders' };
  if (t.extAccept) return `Accepts ${t.extAccept.map((x) => x.toUpperCase()).join(', ')}.`;
  return `Accepts ${[...new Set(t.accepts.map((a) => names[a] || a))].join(', ')}.`;
}
function visible(o, st) {
  if (!o.when) return true;
  return Object.entries(o.when).every(([k, v]) => {
    if (k === '$noFiles') return (st.files.length === 0) === v;
    const cur = st.opts[k];
    return Array.isArray(v) ? v.map(String).includes(String(cur)) : String(cur) === String(v);
  });
}
function control(o, st, rerender) {
  const wrap = h(`<div class="field"></div>`);
  const id = `o-${o.key}`;
  const val = st.opts[o.key];
  const set = (v, re) => { st.opts[o.key] = v; if (re || (S.tools.get(toolView.t.id).options || []).some((x) => x.when && Object.keys(x.when).includes(o.key))) rerender(); };
  if (o.type === 'toggle') {
    const el = h(`<label class="switch"><input type="checkbox" id="${id}" ${val ? 'checked' : ''}><span>${esc(o.label)}</span></label>`);
    $('input', el).addEventListener('change', (e) => set(e.target.checked));
    return el;
  }
  wrap.append(h(`<label class="label" for="${id}">${esc(o.label)}</label>`));
  let el;
  switch (o.type) {
    case 'choice':
      el = h(`<div class="seg" role="group" aria-label="${esc(o.label)}">${o.choices.map(([v, l, sub]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(val) === String(v)}">${esc(l)}${sub ? `<small>${esc(sub)}</small>` : ''}</button>`).join('')}</div>`);
      el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('button', el).forEach((x) => x.setAttribute('aria-pressed', x === b)); set(b.dataset.v); });
      break;
    case 'select':
      el = h(`<select class="input" id="${id}">${o.choices.map(([v, l]) => `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
      el.addEventListener('change', (e) => set(e.target.value));
      break;
    case 'range': {
      el = h(`<div class="range"><input type="range" id="${id}" min="${o.min}" max="${o.max}" step="${o.step || 1}" value="${esc(val)}"><output>${esc(val)}${o.unit || ''}</output></div>`);
      const r = $('input', el), out = $('output', el);
      r.addEventListener('input', () => { out.textContent = `${r.value}${o.unit || ''}`; set(Number(r.value)); });
      break;
    }
    case 'textarea':
      el = h(`<textarea class="input" id="${id}" placeholder="${esc(o.placeholder || '')}">${esc(val)}</textarea>`);
      el.addEventListener('input', (e) => set(e.target.value));
      break;
    case 'color':
      el = h(`<div style="display:flex;gap:8px;align-items:center"><input type="color" id="${id}" value="${esc(val)}"><span class="muted">${esc(val)}</span></div>`);
      $('input', el).addEventListener('input', (e) => { $('span', el).textContent = e.target.value; set(e.target.value); });
      break;
    case 'file':
      el = h(`<div style="display:flex;gap:8px;align-items:center;min-width:0"><button class="btn" type="button">Choose…</button><span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${val ? esc(nameOf(val)) : 'No file chosen'}</span></div>`);
      $('button', el).addEventListener('click', async () => { const [f] = await chooseFiles({ multi: false, filters: o.filters }); if (f) { set(f); $('span', el).textContent = nameOf(f); } });
      break;
    case 'multi':
      el = h(`<div class="chips">${o.choices.map(([v, l]) => `<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${(val || []).includes(v)}">${esc(l)}</button>`).join('')}</div>`);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const cur = new Set(st.opts[o.key] || []);
        if (cur.has(b.dataset.v)) cur.delete(b.dataset.v); else cur.add(b.dataset.v);
        b.setAttribute('aria-pressed', cur.has(b.dataset.v));
        set([...cur]);
      });
      break;
    case 'time': {
      el = h(`<div style="display:flex;gap:8px"><input class="input" id="${id}" value="${esc(val)}" placeholder="${esc(o.placeholder || 'm:ss')}" inputmode="decimal"><button class="btn" type="button" title="Use the preview’s current position">Set to current time</button></div>`);
      const inp = $('input', el);
      inp.addEventListener('input', () => set(inp.value));
      $('button', el).addEventListener('click', () => { const s = S.mediaTime || 0; const v = `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; inp.value = v; set(v); });
      break;
    }
    default: {
      const type = o.type === 'password' ? 'password' : o.type === 'number' ? 'number' : 'text';
      el = h(`<input class="input" id="${id}" type="${type}" value="${esc(val)}" placeholder="${esc(o.placeholder || '')}" ${o.min != null ? `min="${o.min}"` : ''} autocomplete="off" spellcheck="false">`);
      el.addEventListener('input', (e) => set(o.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value));
    }
  }
  wrap.append(el);
  return wrap;
}
function renderOptions() {
  if (!toolView) return;
  const { t, st, opts: panel } = toolView;
  panel.innerHTML = '';
  const job = st.job ? S.jobs.find((j) => j.id === st.job) : null;
  if (job && (job.status === 'running' || job.status === 'queued')) {
    panel.append(h(`<div class="result"><h3>${job.status === 'queued' ? 'Waiting to start' : esc(job.label || 'Working')}</h3><div class="progress ${job.progress ? '' : 'indeterminate'}"><i style="width:${Math.round((job.progress || 0) * 100)}%"></i></div><p class="muted" style="margin:0">${Math.round((job.progress || 0) * 100)}% · You can leave this page; it keeps running.</p><div><button class="btn" data-a="cancel">Cancel</button></div></div>`));
    $('[data-a=cancel]', panel).addEventListener('click', () => api.invoke('jobs:cancel', job.id));
    return;
  }
  if (job && job.status === 'done') { panel.append(resultPanel(job)); return; }
  const rerender = () => renderOptions();
  if (job && job.status === 'error') panel.append(errorPanel(job));
  const optsList = (t.options || []).filter((o) => visible(o, st));
  const basic = optsList.filter((o) => !o.advanced), adv = optsList.filter((o) => o.advanced);
  if (basic.length || adv.length) panel.append(h(`<h3>Options</h3>`));
  basic.forEach((o) => panel.append(control(o, st, rerender)));
  if (adv.length) {
    const d = h(`<details class="advanced" ${st.showAdvanced ? 'open' : ''}><summary>More options</summary><div></div></details>`);
    d.addEventListener('toggle', () => { st.showAdvanced = d.open; });
    adv.forEach((o) => $('div', d).append(control(o, st, rerender)));
    panel.append(d);
  }
  if (!t.options?.length) panel.append(h(`<p class="muted" style="margin:0">No settings needed. Add your files and go.</p>`));
  const where = S.settings.outMode === 'folder' ? S.settings.outFolder : 'next to the original';
  const save = h(`<div class="saveto">${icon('folder', 'sm')}<span class="grow" title="${esc(where)}">Saves ${S.settings.outMode === 'folder' ? `to ${esc(where)}` : 'next to the original'}</span><button class="btn subtle" style="min-height:24px;padding:2px 8px;font-size:12px">Change</button></div>`);
  $('button', save).addEventListener('click', () => go('#/settings'));
  if (!t.noFiles) panel.append(save);
  const need = t.noFiles ? 0 : (t.allowNoFiles ? 0 : (t.min || 1));
  const missingReq = (t.options || []).filter((o) => visible(o, st) && o.required && !st.opts[o.key]);
  const btn = h(`<button class="btn primary lg" ${st.files.length < need ? 'disabled' : ''}>${esc(actionLabel(t, st))}</button>`);
  btn.addEventListener('click', async () => {
    if (missingReq.length) { toast(`Fill in “${missingReq[0].label}” first.`, { type: 'error' }); return; }
    if (t.allowNoFiles && !st.files.length && !st.opts.url) { toast('Add a file or enter a web address.', { type: 'error' }); return; }
    st.job = await runTool(t.id, st.files, st.opts);
    S.notified.add(st.job);
    renderOptions();
  });
  panel.append(btn);
  if (st.files.length < need) panel.append(h(`<p class="faint" style="margin:-8px 0 0;font-size:12px">${need > 1 ? `Add at least ${need} files to continue.` : 'Add a file to continue.'}</p>`));
}
function actionLabel(t, st) {
  if (/^(convert|compress|merge|split|rotate|crop|resize|protect|unlock|repair|flatten|extract|trim|mute|redact|watermark|upscale)/i.test(t.name)) {
    const verb = t.name.split(' ')[0];
    const n = st.files.length;
    if (t.id === 'convert-image' || t.id === 'convert-video' || t.id === 'convert-audio' || t.id === 'convert-document' || t.id === 'convert-sheet') return `Convert to ${(st.opts.to || '').toUpperCase().replace('HEVC', 'HEVC MP4')}`;
    return n > 1 && !t.min ? `${verb} ${n} files` : t.name;
  }
  return t.name;
}
function updateToolJob() {
  if (!toolView || !toolView.st.job) return;
  renderOptions();
}
function resultPanel(job) {
  const { t, st } = toolView;
  const el = h(`<div class="result"></div>`);
  el.append(h(`<div class="infobar success">${icon('check')}<div><b>Done</b><div class="muted" style="font-size:12px">${esc(job.name)} finished in ${Math.max(1, Math.round((job.finishedAt - job.startedAt) / 1000))} s</div></div></div>`));
  const outs = [];
  for (const r of job.results || []) {
    const ps = r.paths || (r.path ? [r.path] : []);
    if (r.text && !ps.length) el.append(h(`<div class="text-out">${esc(r.text)}</div>`));
    for (const p of ps.slice(0, 20)) {
      outs.push(p);
      const row = h(`<div class="result-file" draggable="true" title="Drag into Explorer, email or chat"></div>`);
      row.append(thumbEl(p, icon, 44));
      row.append(h(`<div style="min-width:0"><div class="name">${esc(nameOf(p))}</div><small class="muted">${esc(r.note && !r.note.includes('\n') ? r.note : dirOf(p))}</small></div>`));
      const acts = h(`<div class="acts"><button class="btn" data-a="open">${icon('open', 'sm')}Open</button><button class="btn" data-a="show">${icon('folder', 'sm')}Show in folder</button><button class="btn subtle" data-a="copy">${icon('copy', 'sm')}Copy</button></div>`);
      acts.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'open') api.invoke('shell:open', p);
        if (a === 'show') api.invoke('shell:show', p);
        if (a === 'copy') api.invoke('clip:files', [p]).then((m) => toast(m || 'Copied'));
      });
      row.append(acts);
      row.addEventListener('dragstart', (e) => { e.preventDefault(); api.startDrag([p]); });
      el.append(row);
    }
    if (r.note && r.note.includes('\n')) el.append(h(`<div class="text-out">${esc(r.note)}</div>`));
  }
  if (outs.length) {
    api.invoke('files:toolsFor', outs.slice(0, 1)).then((ids) => {
      const next = ids.map((id) => S.tools.get(id)).filter((x) => x && x.id !== t.id && !x.min).sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0)).slice(0, 6);
      if (!next.length) return;
      const box = h(`<div><h3 style="margin-bottom:8px">Continue with</h3><div class="next-tools"></div></div>`);
      next.forEach((n) => { const b = h(`<button class="chip">${icon(n.icon, 'sm')}${esc(n.name)}</button>`); b.addEventListener('click', () => openTool(n.id, outs)); $('.next-tools', box).append(b); });
      el.insertBefore(box, $('.again', el));
    });
  }
  const again = h(`<div class="again" style="display:flex;gap:8px"><button class="btn primary" data-a="new">Start over</button><button class="btn" data-a="same">Change options</button></div>`);
  again.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'new') { st.files = []; st.job = null; renderFiles(); renderOptions(); }
    if (a === 'same') { st.job = null; renderOptions(); }
  });
  el.append(again);
  return el;
}
function errorPanel(job) {
  const el = h(`<div class="infobar error">${icon('error')}<div style="display:grid;gap:8px"><b>${job.status === 'cancelled' ? 'Cancelled' : 'Couldn’t finish'}</b><div style="font-size:13px">${esc(job.error || '')}</div></div></div>`);
  if (job.code === 'ENGINE_MISSING' && job.engine) {
    const names = { libreoffice: 'LibreOffice', pandoc: 'Pandoc', realesrgan: 'AI upscaler' };
    const b = h(`<button class="btn primary" style="justify-self:start">${icon('cloud', 'sm')}Install ${names[job.engine]}</button>`);
    b.addEventListener('click', () => installEngine(job.engine, b));
    $('div', el).append(b);
  }
  return el;
}
async function installEngine(name, btn) {
  btn.disabled = true;
  const label = btn.textContent;
  const off = api.on('engines:progress', (p) => { if (p.name === name) btn.textContent = p.progress >= 1 ? 'Installed' : `${Math.round(p.progress * 100)}% · ${p.label || ''}`.slice(0, 60); });
  try { await api.invoke('engines:install', name); toast('Installed. Run the tool again.', { type: 'success' }); }
  catch (e) { toast(cleanErr(e), { type: 'error' }); btn.textContent = label; btn.disabled = false; }
  finally { off(); }
}
const cleanErr = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/* ---------- editor ---------- */
function renderEditor(view) {
  if (!S.editor?.file) { go('#/cat/pdf'); return; }
  view.style.overflow = 'hidden';
  cleanupView = openEditor(view, S.editor, { icon, toast, api, go, settings: () => S.settings });
}

/* ---------- activity ---------- */
function renderActivity(view) {
  const page = h(`<div class="page"><div class="section-head"><h1 class="title">Activity</h1><button class="btn subtle" id="clearJobs">Clear finished</button></div><p class="lead">Everything you’ve run this session. Jobs keep going while you use other tools.</p><div id="jobList"></div></div>`);
  view.append(page);
  $('#clearJobs', page).addEventListener('click', () => api.invoke('jobs:clear'));
  renderActivityList();
}
function renderActivityList() {
  const box = $('#jobList');
  if (!box) return;
  if (!S.jobs.length) { box.innerHTML = `<div class="card empty-state">${icon('history')}<p>Nothing yet. Results from every tool appear here.</p></div>`; return; }
  const card = h(`<div class="card"></div>`);
  for (const j of S.jobs) {
    const outs = outputsOf(j);
    const row = h(`<div class="job" data-cat="${j.cat}"><span class="tile">${icon(j.icon)}</span><div class="meta"><div><b>${esc(j.name)}</b> <span class="faint" style="font-size:12px">· ${timeAgo(j.createdAt)}</span></div><div class="files" title="${esc(j.files.join('\n'))}">${esc(j.files.map(nameOf).join(', ') || (j.opts?.url || ''))}</div></div><div class="acts"></div></div>`);
    const meta = $('.meta', row), acts = $('.acts', row);
    if (j.status === 'running' || j.status === 'queued') {
      meta.append(h(`<div class="progress ${j.progress ? '' : 'indeterminate'}"><i style="width:${Math.round((j.progress || 0) * 100)}%"></i></div>`));
      meta.append(h(`<div class="note muted">${esc(j.status === 'queued' ? 'Waiting' : j.label || 'Working')} · ${Math.round((j.progress || 0) * 100)}%</div>`));
      const c = h(`<button class="btn">Cancel</button>`); c.addEventListener('click', () => api.invoke('jobs:cancel', j.id)); acts.append(c);
    } else if (j.status === 'done') {
      const notes = (j.results || []).map((r) => r.note).filter(Boolean).join('\n');
      meta.append(h(`<div class="note">${esc(outs.length ? outs.map(nameOf).slice(0, 3).join(', ') + (outs.length > 3 ? ` and ${outs.length - 3} more` : '') : 'Done')}${notes ? `\n<span class="muted">${esc(notes)}</span>` : ''}</div>`));
      if (outs[0]) {
        const o = h(`<button class="btn">${icon('open', 'sm')}Open</button>`); o.addEventListener('click', () => api.invoke('shell:open', outs[0]));
        const s = h(`<button class="btn subtle">${icon('folder', 'sm')}Show</button>`); s.addEventListener('click', () => api.invoke('shell:show', outs[0]));
        acts.append(o, s);
      }
    } else {
      meta.append(h(`<div class="note ${j.status === 'error' ? 'err' : 'muted'}">${esc(j.status === 'cancelled' ? 'Cancelled' : j.error)}</div>`));
      if (j.code === 'ENGINE_MISSING') { const b = h(`<button class="btn primary">Install</button>`); b.addEventListener('click', () => installEngine(j.engine, b)); acts.append(b); }
      const r = h(`<button class="btn">Try again</button>`);
      r.addEventListener('click', async () => { const id = await api.invoke('jobs:submit', { tool: j.tool, files: j.files, opts: j.opts }); S.watch.add(id); });
      acts.append(r);
    }
    card.append(row);
  }
  box.replaceChildren(card);
}

/* ---------- studio apps ---------- */
async function renderStudio(view) {
  const page = h(`<div class="page"><h1 class="title">Studio apps</h1><p class="lead">Seven free, open-source creative apps from the ArtCraft team: a Photoshop-style editor, vector illustration, video editing, RAW photo development, PDF reading, motion graphics and page layout. Clementine installs the official builds and opens your files in them.</p><div class="app-grid"></div><p class="faint" style="margin-top:20px;font-size:12px;line-height:16px">Crafting Apps are © the ArtCraft Team and contributors, MIT or Apache-2.0. They’re downloaded unmodified from github.com/storytold. ArtCraft is a trademark of its owners; Clementine isn’t affiliated with them.</p></div>`);
  view.append(page);
  const grid = $('.app-grid', page);
  const apps = await api.invoke('craft:list');
  for (const a of apps) grid.append(appCard(a));
  if (S.highlight) { const el = $(`[data-app="${S.highlight}"]`, grid); el?.classList.add('highlight'); el?.scrollIntoView({ block: 'center' }); S.highlight = null; }
}
function appCard(a) {
  const el = h(`<article class="card app-card" data-app="${a.id}">
    <header><span class="tile big">${icon(a.icon, 'lg')}</span><div><h3 style="font-size:16px">${esc(a.name)}</h3><small>${esc(a.role)}${a.version ? ` · ${esc(a.version)}` : ''}</small></div></header>
    <p>${esc(a.desc)}</p>
    <div class="chips">${a.opens.slice(0, 6).map((e) => `<span class="tag">.${esc(e)}</span>`).join('')}</div>
    <div class="prog" hidden><div class="progress"><i style="width:0"></i></div><small class="muted"></small></div>
    <div class="acts"></div></article>`);
  const acts = $('.acts', el);
  const draw = (info) => {
    acts.innerHTML = '';
    if (info.installed) {
      const o = h(`<button class="btn primary">${icon('open', 'sm')}Open</button>`);
      o.addEventListener('click', () => api.invoke('craft:open', info.id, []).catch((e) => toast(cleanErr(e), { type: 'error' })));
      const f = h(`<button class="btn">Open a file…</button>`);
      f.addEventListener('click', async () => { const files = await chooseFiles(); if (files.length) api.invoke('craft:open', info.id, files); });
      const u = h(`<button class="btn subtle">Check for update</button>`);
      u.addEventListener('click', async () => {
        u.disabled = true;
        try { const r = await api.invoke('craft:check', info.id); if (r.update) { toast(`${info.name} ${r.latest} is available.`, { actions: [{ label: 'Update', fn: () => install(info) }] }); } else toast(`${info.name} is up to date.`); }
        catch (e) { toast(cleanErr(e), { type: 'error' }); } finally { u.disabled = false; }
      });
      const r = h(`<button class="btn subtle danger">Remove</button>`);
      r.addEventListener('click', async () => draw(await api.invoke('craft:uninstall', info.id)));
      acts.append(o, f, u, r);
    } else {
      const i = h(`<button class="btn primary">${icon('cloud', 'sm')}Install</button>`);
      i.addEventListener('click', () => install(info));
      const g = h(`<button class="btn subtle">Source code</button>`);
      g.addEventListener('click', () => api.invoke('shell:external', info.repo));
      acts.append(i, g);
    }
  };
  const install = async (info) => {
    $('.prog', el).hidden = false;
    acts.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try { draw(await api.invoke('craft:install', info.id)); toast(`${info.name} is ready.`, { type: 'success' }); }
    catch (e) { toast(cleanErr(e), { type: 'error' }); draw(info); }
    finally { $('.prog', el).hidden = true; }
  };
  draw(a);
  return el;
}
function updateCraftProgress(p) {
  const el = $(`[data-app="${p.id}"]`);
  if (!el) return;
  $('.prog', el).hidden = p.progress >= 1;
  $('.progress i', el).style.width = `${Math.round(p.progress * 100)}%`;
  $('.prog small', el).textContent = p.label || '';
}

/* ---------- settings ---------- */
const ENGINE_INFO = {
  libreoffice: { name: 'LibreOffice', desc: 'Best accuracy for Word, Excel and PowerPoint conversions. About 350 MB from libreoffice.org.' },
  pandoc: { name: 'Pandoc', desc: 'eBooks (EPUB), Markdown, LaTeX and other markup formats. About 40 MB from GitHub.' },
  realesrgan: { name: 'AI upscaler (Real-ESRGAN)', desc: 'Sharper 2–4× enlargements. Needs a graphics card with Vulkan. About 45 MB.' },
};
async function renderSettings(view) {
  const s = S.settings;
  const page = h(`<div class="page" style="max-width:1000px"><h1 class="title">Settings</h1><p class="lead">Changes apply right away.</p><div id="sets"></div></div>`);
  view.append(page);
  const root = $('#sets', page);
  const group = (title, rows) => { const g = h(`<section class="settings-group"><h2>${esc(title)}</h2></section>`); rows.forEach((r) => r && g.append(r)); root.append(g); };
  const row = (ic, title, sub, ctrl) => { const r = h(`<div class="setting">${icon(ic)}<div><div>${esc(title)}</div>${sub ? `<small>${esc(sub)}</small>` : ''}</div><div class="ctrl"></div></div>`); $('.ctrl', r).append(...[].concat(ctrl)); return r; };
  const sw = (key, onChange) => { const el = h(`<label class="switch"><input type="checkbox" ${s[key] ? 'checked' : ''}><span class="muted">${s[key] ? 'On' : 'Off'}</span></label>`); $('input', el).addEventListener('change', async (e) => { $('span', el).textContent = e.target.checked ? 'On' : 'Off'; try { await set({ [key]: e.target.checked }); onChange?.(e.target.checked); } catch (err) { toast(cleanErr(err), { type: 'error' }); e.target.checked = !e.target.checked; } }); return el; };
  const seg = (key, choices) => { const el = h(`<div class="seg">${choices.map(([v, l]) => `<button data-v="${v}" aria-pressed="${s[key] === v}">${esc(l)}</button>`).join('')}</div>`); el.addEventListener('click', async (e) => { const b = e.target.closest('button'); if (!b) return; $$('button', el).forEach((x) => x.setAttribute('aria-pressed', x === b)); await set({ [key]: b.dataset.v }); if (key === 'theme') applyTheme({ ...S.info, dark: b.dataset.v === 'dark' || (b.dataset.v === 'system' && matchMedia('(prefers-color-scheme: dark)').matches) }); if (key === 'outMode') renderView(); }); return el; };
  const set = async (patch) => { S.settings = await api.invoke('settings:set', patch); };

  const folderBtn = h(`<button class="btn">Change folder</button>`);
  folderBtn.addEventListener('click', async () => { const [f] = await chooseFiles({ folders: true, multi: false }); if (f) { await set({ outFolder: f }); renderView(); } });
  group('Results', [
    row('folder', 'Where to save results', s.outMode === 'folder' ? s.outFolder : 'Next to the original file, with a new name. Your originals are never changed.', [seg('outMode', [['beside', 'Next to original'], ['folder', 'One folder']]), ...(s.outMode === 'folder' ? [folderBtn] : [])]),
    row('open', 'Show results in File Explorer', 'Open the folder when a job finishes.', sw('openFolder')),
    row('info', 'Notifications', 'A Windows notification when a job finishes while Clementine is in the background.', sw('notify')),
  ]);
  const keySel = (g) => { const el = h(`<select class="input" style="width:110px">${['Shift', 'Control', 'Alt'].map((k) => `<option value="${k}" ${s.keys[g] === k ? 'selected' : ''}>${KEY_LABEL[k]}</option>`).join('')}</select>`); el.addEventListener('change', async () => { const keys = { ...s.keys }; const other = Object.keys(keys).find((x) => keys[x] === el.value); if (other) keys[other] = keys[g]; keys[g] = el.value; await set({ keys }); renderView(); }); return el; };
  group('Quick wheel', [
    row('keyboard', 'Keys', 'Tap while dragging a file to open that part of the wheel.', [h('<span class="muted">Convert</span>'), keySel('convert'), h('<span class="muted">Tools</span>'), keySel('tools'), h('<span class="muted">Actions</span>'), keySel('actions')]),
    s.contextMenuSupported ? row('cursor', 'File Explorer right-click menu', 'Adds “Convert with Clementine” to files and folders. On Windows 11 it’s under “Show more options”.', sw('contextMenu')) : null,
    s.hotkeySupported ? row('keyboard', 'Ctrl + Shift + Space', 'Opens the wheel for files selected in File Explorer.', sw('hotkey')) : null,
    row('pin', 'Drop dock', 'A small target above the taskbar. Drag files onto it from anywhere.', sw('dock')),
  ]);
  group('Appearance', [row('brush', 'Theme', 'Follows Windows by default.', seg('theme', [['system', 'Windows'], ['light', 'Light'], ['dark', 'Dark']]))]);
  const eng = h(`<section class="settings-group"><h2>Engines</h2></section>`);
  root.append(eng);
  S.engineRows = eng;
  await refreshEngineRows();
  group('Included engines', [row('check', 'Built in and ready offline', 'MuPDF and pdf-lib (PDF), libvips (images), FFmpeg 8 (video and audio), 7-Zip (archives, including RAR), Tesseract (OCR), IMG.LY background removal.', h('<span class="tag out">Installed</span>'))]);
  group('Startup', [row('desktop', 'Start with Windows', 'Runs quietly in the system tray so the right-click menu, hotkey and dock respond instantly.', sw('launchAtLogin'))]);
  const lic = h(`<button class="btn subtle">Open-source licences</button>`);
  lic.addEventListener('click', () => api.invoke('shell:external', 'https://github.com/storytold'));
  group('About', [row('info', `Clementine ${S.info.version}`, 'Offline file converter and editor for Windows. Built on open-source engines.', [])]);
}
async function refreshEngineRows() {
  const box = S.engineRows;
  if (!box || !document.body.contains(box)) return;
  const st = await api.invoke('engines:status');
  box.querySelectorAll('.setting').forEach((r) => r.remove());
  for (const [k, info] of Object.entries(ENGINE_INFO)) {
    const p = S.engineProgress[k];
    const busy = p && p.progress < 1;
    const r = h(`<div class="setting">${icon('cloud')}<div><div>${esc(info.name)}</div><small>${esc(busy ? `${Math.round(p.progress * 100)}% · ${p.label || ''}` : info.desc)}</small>${busy ? `<div class="progress" style="margin-top:6px"><i style="width:${Math.round(p.progress * 100)}%"></i></div>` : ''}</div><div class="ctrl"></div></div>`);
    const c = $('.ctrl', r);
    if (st[k].installed) {
      c.append(h('<span class="tag out">Installed</span>'));
      if (k !== 'libreoffice') { const b = h(`<button class="btn subtle">Remove</button>`); b.addEventListener('click', async () => { await api.invoke('engines:uninstall', k); refreshEngineRows(); }); c.append(b); }
    } else {
      const b = h(`<button class="btn primary" ${busy ? 'disabled' : ''}>${icon('cloud', 'sm')}Install</button>`);
      b.addEventListener('click', async () => { b.disabled = true; try { await api.invoke('engines:install', k); toast(`${info.name} installed.`, { type: 'success' }); } catch (e) { toast(cleanErr(e), { type: 'error' }); delete S.engineProgress[k]; } refreshEngineRows(); });
      c.append(b);
    }
    box.append(r);
  }
}

/* ---------- in-window drag wheel ---------- */
function setupDragWheel() {
  let depth = 0, wheel = null, holder = null, guess = [], cacheKey = '', hint = null;
  const close = () => { if (holder) holder.remove(); holder = null; wheel = null; S.dragWheel = false; };
  const hideHint = () => { hint?.remove(); hint = null; };
  const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!isFiles(e) || S.rowDrag || route().name === 'editor') return;
    depth++;
    if (depth === 1) {
      guess = guessFromDrag(e.dataTransfer);
      const k = S.settings.keys;
      hint = h(`<div class="drag-hint"><p>Drop to add · or tap <kbd>${KEY_LABEL[k.convert]}</kbd> <kbd>${KEY_LABEL[k.tools]}</kbd> <kbd>${KEY_LABEL[k.actions]}</kbd> for the wheel</p></div>`);
      document.body.append(hint);
    }
  });
  window.addEventListener('dragleave', () => { if (depth > 0) depth--; if (depth === 0) { hideHint(); close(); } });
  window.addEventListener('dragover', async (e) => {
    if (!isFiles(e) || S.rowDrag || route().name === 'editor') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const keys = S.settings.keys;
    const g = ['convert', 'tools', 'actions'].find((x) => { const k = keys[x]; return (k === 'Shift' && e.shiftKey) || (k === 'Control' && e.ctrlKey) || (k === 'Alt' && e.altKey); });
    if (g && !wheel) {
      S.dragWheel = true;
      holder = h(`<div class="inwin-wheel"></div>`);
      const s = Math.min(1, (Math.min(innerWidth, innerHeight) - 60) / 460);
      holder.style.setProperty('--s', s);
      holder.style.left = `${Math.min(Math.max(e.clientX, 220 * s), innerWidth - 220 * s)}px`;
      holder.style.top = `${Math.min(Math.max(e.clientY, 210 * s), innerHeight - 250 * s)}px`;
      document.body.append(holder);
      wheel = createWheel(holder, { keys, mode: 'drag', centerHint: 'Drop here to just add' });
      wheel.setMode('drag');
      const key = guess.join('|');
      if (key !== cacheKey) { cacheKey = key; S.dragItems = await api.invoke('wheel:items', guess); }
      wheel?.setItems(S.dragItems);
      wheel?.setGroup(g);
    } else if (g && wheel && g !== wheel.group) wheel.setGroup(g);
    if (wheel) wheel.hoverAt(e.clientX, e.clientY);
  });
  window.addEventListener('drop', async (e) => {
    if (!isFiles(e) || S.rowDrag) return;
    e.preventDefault();
    depth = 0;
    hideHint();
    const files = pathsFromDrop(e.dataTransfer);
    const pick = wheel?.current() || null;
    const group = wheel?.group;
    close();
    if (!files.length) return;
    if (pick) {
      const real = await api.invoke('wheel:items', files);
      const item = (real[group] || []).find((x) => (x.tool ? x.tool === pick.tool && x.label === pick.label : x.action === pick.action)) || null;
      if (!item) { setSelection(files); toast(`${pick.label} doesn’t apply to ${files.length === 1 ? nameOf(files[0]) : 'these files'}. Pick a tool below.`); return; }
      const r = await runPick(item, files, S.catalog);
      if (r.jobId) { S.watch.add(r.jobId); toast(`${r.tool.name}: started`, { actions: [{ label: 'Activity', fn: () => go('#/activity') }], timeout: 2500 }); }
      else if (r.navigate) openTool(r.navigate.tool, r.navigate.files, r.navigate.opts);
      else if (r.message) toast(r.message, { type: 'success' });
      return;
    }
    const target = e.target.closest?.('[data-drop-target]');
    if (target?._onFiles) target._onFiles(files);
    else if (route().name === 'tool' && toolView) toolView.files._onFiles?.(files) ?? setSelection(files);
    else setSelection([...S.selection, ...files]);
  });
}

boot().catch((e) => { document.body.innerHTML = `<pre style="padding:24px;color:#c42b1c;white-space:pre-wrap">Clementine couldn’t start.\n${esc(e.stack || e)}</pre>`; });
