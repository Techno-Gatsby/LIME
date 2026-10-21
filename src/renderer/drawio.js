import { $, esc, h, nameOf, dirOf, sep, clean } from './ui.js';
import { setDocName, confirm3 } from './editor-kit.js';
import { key, shortcuts, helpButton, keyOf } from './shortcuts.js';

const KEYS = [
  ['Draw', [key('Mod+Shift+K', 'Shapes panel'), key('Mod+Enter', 'Duplicate'), key(['Alt+Shift+ArrowRight', 'Alt+Shift+ArrowLeft'], 'Add a connected shape'), key('F2', 'Type in the shape'), key('Double-click', 'Edit text or add a shape'), key('Alt+Shift+X', 'Layout')]],
  ['Edit', [key('Mod+Z', 'Undo'), key(['Mod+Shift+Z', 'Mod+Y'], 'Redo'), key('Mod+G', 'Group'), key('Mod+Shift+U', 'Ungroup'), key('Mod+A', 'Select all'), key(['Delete', 'Backspace'], 'Delete'), key('Mod+F', 'Find')]],
  ['View', [key(['Mod+Plus', 'Mod+Minus'], 'Zoom in or out'), key('Mod+Shift+H', 'Fit the page'), key('Mod+H', 'Actual size'), key('Mod+Shift+P', 'Format panel'), key('?', 'Keyboard shortcuts')]],
  ['Diagram', [key('Mod+S', 'Save'), key('Mod+Shift+S', 'Save as…'), key('Mod+Shift+E', 'Export a picture'), key('Mod+W', 'Close')]],
];
const CHANGE = { mxChildChange: 'Added or removed', mxGeometryChange: 'Moved or resized', mxValueChange: 'Edited text', mxStyleChange: 'Changed the style', mxTerminalChange: 'Reconnected', mxCellAttributeChange: 'Changed data', mxRootChange: 'Changed the page' };
function labelOf(edit) {
  const kinds = [...new Set((edit.changes || []).map((c) => c.constructor?.name).filter((n) => CHANGE[n]))];
  const kids = (edit.changes || []).filter((c) => c.constructor?.name === 'mxChildChange');
  if (kids.length && kids.every((c) => c.parent)) return `Added ${kids.length === 1 ? 'a shape' : `${kids.length} shapes`}`;
  if (kids.length && kids.every((c) => !c.parent)) return `Deleted ${kids.length === 1 ? 'a shape' : `${kids.length} shapes`}`;
  return CHANGE[kinds[0]] || 'Changed the diagram';
}
const BLANK = '<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

export function openEditor(view, { file }, ctx) {
  const { toast, api, go } = ctx;
  ctx.onClose?.(close);
  const icon = (n, s = '') => ctx.icon(n, s);
  const call = (m, ...a) => api.invoke('edit:call', 'diagram', m, ...a);
  if (!document.querySelector('link[href="board.css"]')) document.head.append(h('<link rel="stylesheet" href="board.css">'));
  const st = { ready: false, disposed: false, file: file || '', savePath: null, saved: '', xml: '', imported: false, waits: new Map(), seq: 0 };
  let frame = null, ui = null, W = null;

  const root = h(`<div class="editor board drawio">
    <header class="ed-head">
      <div class="topbar">
        <button class="tb icon" data-a="close" title="Close">${icon('back')}</button>
        <div class="doc">${icon('shapes')}<b></b><span class="dirty" hidden>Unsaved</span></div>
        <div class="seg"><button class="tb icon" data-a="undo" title="Undo (Ctrl+Z)" disabled>${icon('undo')}</button><button class="tb icon" data-a="redo" title="Redo (Ctrl+Y)" disabled>${icon('redo')}</button><button class="tb icon" data-a="history" title="History">${icon('clock')}</button></div>
        <div class="grow"></div>
        <button class="tb" data-a="new" title="A new, empty diagram">${icon('add', 'sm')}<span class="lbl">New</span></button>
        <button class="tb" data-a="export" title="Export a PNG or SVG picture, with the diagram inside it (Ctrl+Shift+E)">${icon('image', 'sm')}<span class="lbl">Export</span></button>
        ${helpButton()}
        <button class="btn" data-a="saveas">Save as…</button>
        <button class="btn primary" data-a="save">${icon('save', 'sm')}Save</button>
      </div>
    </header>
    <div class="bd-body"><div class="bd-canvas"><iframe title="Diagram"></iframe></div><div class="ed-status" hidden>Opening…</div></div>
  </div>`);
  view.append(root);
  const statusEl = $('.ed-status', root);
  const showName = () => { setDocName(root, st.savePath || st.file || 'New diagram'); if (!st.file && !st.savePath) document.title = 'New diagram'; };
  showName();
  function tip(msg, keep) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg || '';
    clearTimeout(tip.t);
    if (msg && !keep) tip.t = setTimeout(() => { statusEl.hidden = true; }, 4000);
  }
  const dirty = () => st.ready && st.xml !== st.saved;
  function chrome() {
    $('.dirty', root).hidden = !dirty();
    const um = ui?.editor.undoManager;
    $('[data-a=undo]', root).disabled = !um?.canUndo();
    $('[data-a=redo]', root).disabled = !um?.canRedo();
  }
  const post = (msg) => frame.contentWindow.postMessage(JSON.stringify(msg), '*');
  const ask = (msg, event) => new Promise((resolve) => { st.waits.set(event, resolve); post(msg); });
  function onMessage(e) {
    if (!frame || e.source !== frame.contentWindow || typeof e.data !== 'string') return;
    let m;
    try { m = JSON.parse(e.data); } catch (_) { return; }
    if (m.event === 'init') start();
    else if (m.event === 'autosave' || m.event === 'save') { st.xml = m.xml; chrome(); if (m.event === 'save') save(false); }
    else if (m.event === 'load') loaded();
    const w = st.waits.get(m.event);
    if (w) { st.waits.delete(m.event); w(m); }
  }
  window.addEventListener('message', onMessage);

  async function start() {
    ui = frame.contentWindow.limeUi;
    W = frame.contentWindow;
    try {
      let xml = BLANK;
      if (file) {
        const d = await call('open', file);
        if (d.text != null) xml = d.text;
        else xml = await new Promise((ok, no) => ui.importVisio(new W.Blob([d.bytes]), ok, (err) => no(new Error(err?.message || `Lime couldn’t read ${nameOf(file)}.`)), nameOf(file)));
        st.imported = d.text == null;
      }
      st.xml = st.saved = xml;
      post({ action: 'load', xml, autosave: 1, modified: 'unsavedChanges', title: nameOf(file || 'New diagram'), dark: theme() === 'dark' });
    } catch (e) { toast(clean(e), { type: 'error' }); go(); }
  }
  function loaded() {
    if (st.ready) return;
    st.ready = true;
    tip(null);
    if (st.imported) st.saved = '';
    const um = ui.editor.undoManager;
    um.addListener(W.mxEvent.CHANGE, chrome);
    um.addListener(W.mxEvent.UNDO, chrome);
    um.addListener(W.mxEvent.REDO, chrome);
    W.document.addEventListener('keydown', onKey, true);
    if (st.imported) tip('Opened as a draw.io diagram. Save keeps it as a .drawio file.');
    setTimeout(() => { if (!st.imported) st.saved = st.xml; chrome(); }, 300);
  }

  function history() {
    const old = $('.bd-hist', root);
    if (old) { old.remove(); return; }
    const um = ui.editor.undoManager, list = um.history;
    const pop = h(`<div class="popmenu bd-hist" role="menu"><button class="mi${um.indexOfNextAdd === 0 ? ' cur' : ''}" data-i="0">${icon('open', 'sm')}<span class="grow">Opened</span></button>${list.map((x, i) => `<button class="mi${i + 1 === um.indexOfNextAdd ? ' cur' : ''}" data-i="${i + 1}">${icon('clock', 'sm')}<span class="grow">${esc(labelOf(x))}</span><small>${i + 1}</small></button>`).join('')}</div>`);
    place(pop, $('[data-a=history]', root));
    pop.addEventListener('click', (e) => {
      const it = e.target.closest('[data-i]');
      if (!it) return;
      pop.remove();
      const want = Number(it.dataset.i);
      while (um.indexOfNextAdd > want && um.canUndo()) um.undo();
      while (um.indexOfNextAdd < want && um.canRedo()) um.redo();
      chrome();
    });
  }
  function place(pop, btn) {
    const b = btn.getBoundingClientRect();
    root.append(pop);
    pop.style.top = `${b.bottom + 6}px`;
    pop.style.left = `${Math.max(8, Math.min(b.left, innerWidth - pop.offsetWidth - 8))}px`;
    const off = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off); W?.document.removeEventListener('pointerdown', off); } };
    setTimeout(() => { document.addEventListener('pointerdown', off); W?.document.addEventListener('pointerdown', off); }, 0);
  }

  const stem = () => nameOf(st.savePath || st.file || 'Diagram').replace(/\.[^.]+$/, '').replace(/ \(edited\)$/, '');
  const where = () => dirOf(st.savePath || st.file);
  async function save(as) {
    if (!st.ready) return false;
    let target = as ? null : st.savePath;
    if (!target && !as && st.file) target = `${where()}${sep}${stem()} (edited).drawio`;
    if (!target) {
      const d = where();
      target = await api.invoke('dialog:save', { defaultPath: `${d ? `${d}${sep}` : ''}${stem()}${st.file ? ' (edited)' : ''}.drawio`, filters: [{ name: 'draw.io diagram', extensions: ['drawio'] }] });
      if (!target) return false;
    }
    try {
      const xml = st.xml;
      const r = await call('save', target, xml);
      st.savePath = r.path;
      st.saved = xml;
      showName();
      chrome();
      toast(`Saved ${nameOf(r.path)}`, { type: 'success', actions: [{ label: 'Show in folder', fn: () => api.invoke('shell:show', r.path) }] });
      return true;
    } catch (e) { toast(clean(e), { type: 'error' }); return false; }
  }
  async function picture(kind) {
    const m = await ask({ action: 'export', format: kind === 'svg' ? 'xmlsvg' : 'xmlpng', scale: kind === 'svg' ? 1 : 2, border: 10, background: '#ffffff', spinKey: 'export' }, 'export');
    const data = String(m.data || ''), comma = data.indexOf(',');
    const raw = data.slice(comma + 1);
    return /;base64,/.test(data.slice(0, comma + 1)) ? Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(raw));
  }
  async function exportAs(kind) {
    const d = where(), target = await api.invoke('dialog:save', { defaultPath: `${d ? `${d}${sep}` : ''}${stem()}.${kind}`, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] });
    if (!target) return;
    try {
      const r = await call('write', target, await picture(kind));
      toast(`Exported ${nameOf(r.path)}`, { type: 'success', actions: [{ label: 'Open', fn: () => api.invoke('shell:open', r.path) }, { label: 'Show in folder', fn: () => api.invoke('shell:show', r.path) }] });
    } catch (e) { toast(clean(e), { type: 'error' }); }
  }
  function exportMenu() {
    const old = $('.bd-export', root);
    if (old) { old.remove(); return; }
    const pop = h(`<div class="popmenu bd-export" role="menu">
      <button class="mi" data-k="png">${icon('image', 'sm')}<span class="grow">PNG picture</span><small>2×</small></button>
      <button class="mi" data-k="svg">${icon('shapes', 'sm')}<span class="grow">SVG picture</span><small>Vector</small></button>
      <div class="note">The diagram goes inside the picture, so draw.io opens it again. For PDF, use Diagram to PDF on the wheel.</div></div>`);
    place(pop, $('[data-a=export]', root));
    pop.addEventListener('click', (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (k) { pop.remove(); exportAs(k); } });
  }
  async function close() {
    if (dirty()) {
      const c = await confirm3(`Save changes to ${st.savePath || st.file ? nameOf(st.savePath || st.file) : 'this diagram'}?`, 'Your edits will be lost if you don’t save them.');
      if (c === 'cancel') return;
      if (c === 'save' && !(await save(false))) return;
    }
    go();
  }
  async function fresh() {
    if (dirty()) {
      const c = await confirm3('Save this diagram first?', 'A new diagram replaces this one in the window.');
      if (c === 'cancel') return;
      if (c === 'save' && !(await save(false))) return;
    }
    Object.assign(st, { file: '', savePath: null, imported: false, xml: BLANK, saved: BLANK });
    post({ action: 'load', xml: BLANK, autosave: 1, modified: 'unsavedChanges', title: 'New diagram' });
    setTimeout(() => { ui.editor.undoManager.clear(); st.saved = st.xml; chrome(); }, 300);
    api.invoke('editor:switched', '', 'drawio');
    showName();
  }

  const keys = shortcuts(KEYS);
  function onKey(e) {
    if (document.querySelector('.scrim') || !st.ready) return;
    const k = keyOf(e), t = e.target;
    const typing = t?.isContentEditable || t?.matches?.('input, textarea, select');
    const take = (fn) => { e.preventDefault(); e.stopImmediatePropagation(); fn(); };
    if (k === 'Mod+S') take(() => save(false));
    else if (k === 'Mod+Shift+S') take(() => save(true));
    else if (k === 'Mod+W') take(close);
    else if (k === 'Mod+Shift+E') take(exportMenu);
    else if (k === '?' && !typing && e.currentTarget !== document) take(() => keys.help());
  }
  document.addEventListener('keydown', onKey, true);

  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'close') { if (st.ready) close(); else go(); return; }
    if (a === 'help') { keys.help(); return; }
    if (!st.ready) return;
    if (a === 'undo') ui.actions.get('undo').funct();
    if (a === 'redo') ui.actions.get('redo').funct();
    if (a === 'history') history();
    if (a === 'save') save(false);
    if (a === 'saveas') save(true);
    if (a === 'export') exportMenu();
    if (a === 'new') fresh();
    chrome();
  });

  const theme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const themeObs = new MutationObserver(() => { if (ui && ui.setDarkMode) ui.setDarkMode(theme() === 'dark'); });
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  (async () => {
    try {
      tip('Opening…', true);
      await call('ready');
      if (st.disposed) return;
      frame = $('iframe', root);
      const q = new URLSearchParams({ embed: '1', proto: 'json', stealth: '1', lang: 'en', noSaveBtn: '1', noExitBtn: '1', saveAndExit: '0', spin: '1', libraries: '1', configure: '0', ui: 'kennedy', dark: theme() === 'dark' ? '1' : '0', pwa: '0', splash: '0' });
      frame.src = `drawio/lime.html?${q}`;
    } catch (e) { toast(clean(e), { type: 'error' }); go(); }
  })();

  window.__drawio = { st, ui: () => ui, save, picture, post, dirty };
  const dispose = () => {
    if (st.disposed) return;
    st.disposed = true;
    window.removeEventListener('message', onMessage);
    document.removeEventListener('keydown', onKey, true);
    try { W?.document.removeEventListener('keydown', onKey, true); } catch (_) {}
    themeObs.disconnect();
    keys.dispose();
  };
  window.addEventListener('pagehide', dispose);
  return dispose;
}
