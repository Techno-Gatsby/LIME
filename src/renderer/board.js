import { $, esc, h, nameOf, dirOf, sep, clean } from './ui.js';
import { setDocName, confirm3 } from './editor-kit.js';
import { key, shortcuts, helpButton } from './shortcuts.js';

const KIND = { rectangle: 'box', diamond: 'diamond', ellipse: 'oval', arrow: 'arrow', line: 'line', freedraw: 'drawing', text: 'text', image: 'picture', frame: 'frame', embeddable: 'embed', magicframe: 'frame', iframe: 'embed' };
const plural = (n, w) => (n === 1 ? `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w}` : `${n} ${w === 'box' ? 'boxes' : `${w}s`}`);
const what = (list) => { const kinds = [...new Set(list.map((e) => KIND[e.type] || 'shape'))]; return kinds.length === 1 ? plural(list.length, kinds[0]) : plural(list.length, 'shape'); };
const MOVE_KEYS = ['x', 'y', 'version', 'versionNonce', 'updated', 'seed'];
const moved = (a, b) => Object.keys(b).every((k) => MOVE_KEYS.includes(k) || JSON.stringify(a[k]) === JSON.stringify(b[k]));
export const KEYS = [
  ['Draw', [key(['V', '1'], 'Select'), key(['R', '2'], 'Box'), key(['D', '3'], 'Diamond'), key(['O', '4'], 'Oval'), key(['A', '5'], 'Arrow'), key(['L', '6'], 'Line'), key(['P', '7'], 'Pen'), key(['T', '8'], 'Text'), key('9', 'Picture'), key(['E', '0'], 'Eraser'), key('H', 'Move the board'), key('F', 'Frame')]],
  ['Edit', [key('Mod+Z', 'Undo'), key(['Mod+Shift+Z', 'Mod+Y'], 'Redo'), key('Mod+D', 'Duplicate'), key('Mod+G', 'Group'), key('Mod+Shift+G', 'Ungroup'), key('Mod+A', 'Select all'), key(['Delete', 'Backspace'], 'Delete'), key('Mod+Shift+L', 'Lock or unlock'), key('Enter', 'Type in the shape')]],
  ['View', [key(['Mod+Plus', 'Mod+Minus'], 'Zoom in or out'), key('Shift+1', 'Fit everything'), key('Mod+0', 'Actual size'), key('Space', 'Hold to move the board'), key('Alt+Z', 'Zen mode'), key('?', 'Keyboard shortcuts')]],
  ['Board', [key('Mod+S', 'Save'), key('Mod+Shift+S', 'Save as…'), key('Mod+Shift+E', 'Export a picture'), key('Mod+W', 'Close')]],
];

let lib = null;
async function libs() {
  window.EXCALIDRAW_ASSET_PATH = new URL('vendor/diagram/', location.href).href;
  if (!document.querySelector('link[href="vendor/diagram/whiteboard.css"]')) document.head.append(h('<link rel="stylesheet" href="vendor/diagram/whiteboard.css">'));
  return (lib ||= import('./vendor/diagram/whiteboard.js'));
}

export function openEditor(view, { file }, ctx) {
  const { toast, api, go } = ctx;
  ctx.onClose?.(close);
  const icon = (n, s = '') => ctx.icon(n, s);
  const call = (m, ...a) => api.invoke('edit:call', 'diagram', m, ...a);
  if (!document.querySelector('link[href="board.css"]')) document.head.append(h('<link rel="stylesheet" href="board.css">'));
  const st = { ready: false, disposed: false, file: file || '', savePath: null, saved: '', hist: [], at: 0, lastSig: '', restoring: false, undo: true, redo: true };
  let X = null, xapi = null, reactRoot = null, histT = null, obs = null;

  const root = h(`<div class="editor board">
    <header class="ed-head">
      <div class="topbar">
        <button class="tb icon" data-a="close" title="Close">${icon('back')}</button>
        <div class="doc">${icon('shapes')}<b></b><span class="dirty" hidden>Unsaved</span></div>
        <div class="seg"><button class="tb icon" data-a="undo" title="Undo (Ctrl+Z)" disabled>${icon('undo')}</button><button class="tb icon" data-a="redo" title="Redo (Ctrl+Y)" disabled>${icon('redo')}</button><button class="tb icon" data-a="history" title="History">${icon('clock')}</button></div>
        <div class="grow"></div>
        <button class="tb" data-a="new" title="A new, empty board">${icon('add', 'sm')}<span class="lbl">New</span></button>
        <button class="tb" data-a="export" title="Export a PNG or SVG picture, with the board inside it so it opens again here (Ctrl+Shift+E)">${icon('image', 'sm')}<span class="lbl">Export</span></button>
        ${helpButton()}
        <button class="btn" data-a="saveas">Save as…</button>
        <button class="btn primary" data-a="save">${icon('save', 'sm')}Save</button>
      </div>
    </header>
    <div class="bd-body"><div class="bd-canvas"></div><div class="ed-status" hidden></div></div>
  </div>`);
  view.append(root);
  const statusEl = $('.ed-status', root);
  const showName = () => { setDocName(root, st.savePath || st.file || 'New board'); if (!st.file && !st.savePath) document.title = 'New board'; };
  showName();

  function tip(msg) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg || '';
    clearTimeout(tip.t);
    if (msg) tip.t = setTimeout(() => { statusEl.hidden = true; }, 4000);
  }
  const elements = () => xapi?.getSceneElements() || [];
  const sig = () => (xapi ? `${X.getSceneVersion(xapi.getSceneElementsIncludingDeleted())}|${xapi.getAppState().viewBackgroundColor}|${Object.keys(xapi.getFiles()).length}` : '');
  const dirty = () => st.ready && sig() !== st.saved && !(st.saved === 'new' && !elements().length);
  function chrome() {
    $('.dirty', root).hidden = !dirty();
    $('[data-a=undo]', root).disabled = !st.undo;
    $('[data-a=redo]', root).disabled = !st.redo;
  }
  function watchHistory() {
    const u = $('[data-testid=button-undo]', root), r = $('[data-testid=button-redo]', root);
    if (!u || !r) return false;
    const read = () => { st.undo = !u.disabled; st.redo = !r.disabled; chrome(); };
    obs = new MutationObserver(read);
    for (const b of [u, r]) obs.observe(b, { attributes: true, attributeFilter: ['disabled'] });
    read();
    return true;
  }
  const press = (id) => $(`[data-testid=button-${id}]`, root)?.click();

  function snapshot() {
    const els = xapi.getSceneElements().map((e) => ({ ...e })), bg = xapi.getAppState().viewBackgroundColor;
    const prev = st.hist[st.at];
    let label = 'Changed the board';
    if (prev) {
      const was = new Map(prev.els.map((e) => [e.id, e])), now = new Map(els.map((e) => [e.id, e]));
      const added = els.filter((e) => !was.has(e.id)), gone = prev.els.filter((e) => !now.has(e.id)), changed = els.filter((e) => was.has(e.id) && was.get(e.id).version !== e.version);
      if (added.length && !gone.length) label = `Added ${what(added)}`;
      else if (gone.length && !added.length) label = `Deleted ${what(gone)}`;
      else if (changed.length && !added.length && !gone.length) label = `${changed.every((e) => moved(was.get(e.id), e)) ? 'Moved' : changed.every((e) => e.type === 'text') ? 'Edited' : 'Changed'} ${what(changed)}`;
      else if (bg !== prev.bg) label = 'Changed the background';
    }
    return { els, bg, label, at: Date.now() };
  }
  function onChange() {
    if (!st.ready || st.disposed) return;
    chrome();
    clearTimeout(histT);
    histT = setTimeout(() => {
      if (st.restoring || xapi.getAppState().editingTextElement || xapi.getAppState().newElement) return;
      const s = sig();
      if (s === st.lastSig) return;
      st.lastSig = s;
      st.hist.splice(st.at + 1);
      st.hist.push(snapshot());
      if (st.hist.length > 200) st.hist.shift();
      st.at = st.hist.length - 1;
    }, 600);
  }
  function history() {
    const old = $('.bd-hist', root);
    if (old) { old.remove(); return; }
    const when = (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const pop = h(`<div class="popmenu bd-hist" role="menu">${st.hist.map((x, i) => `<button class="mi${i === st.at ? ' cur' : ''}" data-i="${i}">${icon(i ? 'clock' : 'open', 'sm')}<span class="grow">${esc(x.label)}</span><small>${when(x.at)}</small></button>`).reverse().join('')}</div>`);
    place(pop, $('[data-a=history]', root));
    pop.addEventListener('click', (e) => {
      const it = e.target.closest('[data-i]');
      if (!it) return;
      pop.remove();
      const i = Number(it.dataset.i), s = st.hist[i];
      st.restoring = true;
      const keep = new Set(s.els.map((x) => x.id));
      xapi.updateScene({ elements: [...s.els, ...xapi.getSceneElementsIncludingDeleted().filter((x) => !keep.has(x.id)).map((x) => ({ ...x, isDeleted: true }))], appState: { viewBackgroundColor: s.bg }, captureUpdate: X.CaptureUpdateAction.IMMEDIATELY });
      st.at = i;
      st.lastSig = sig();
      setTimeout(() => { st.restoring = false; chrome(); }, 0);
      tip(`Back to: ${s.label}`);
    });
  }
  function place(pop, btn) {
    const b = btn.getBoundingClientRect();
    root.append(pop);
    pop.style.top = `${b.bottom + 6}px`;
    pop.style.left = `${Math.max(8, Math.min(b.left, innerWidth - pop.offsetWidth - 8))}px`;
    setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  }

  const stem = () => nameOf(st.savePath || st.file || 'Board').replace(/\.excalidraw(\.(png|svg|json))?$|\.[^.]+$/i, '').replace(/ \(edited\)$/, '');
  const where = () => dirOf(st.savePath || st.file);
  const scene = () => X.serializeAsJSON(xapi.getSceneElements(), xapi.getAppState(), xapi.getFiles(), 'local');
  async function save(as) {
    if (!st.ready) return false;
    let target = as ? null : st.savePath;
    if (!target && !as && st.file && /\.excalidraw$/i.test(st.file)) target = `${where()}${sep}${stem()} (edited).excalidraw`;
    if (!target) {
      const d = where();
      target = await api.invoke('dialog:save', { defaultPath: `${d ? `${d}${sep}` : ''}${stem()}${st.file ? ' (edited)' : ''}.excalidraw`, filters: [{ name: 'Whiteboard', extensions: ['excalidraw'] }] });
      if (!target) return false;
    }
    try {
      const r = await call('save', target, scene());
      st.savePath = r.path;
      st.saved = sig();
      showName();
      chrome();
      toast(`Saved ${nameOf(r.path)}`, { type: 'success', actions: [{ label: 'Show in folder', fn: () => api.invoke('shell:show', r.path) }] });
      return true;
    } catch (e) { toast(clean(e), { type: 'error' }); return false; }
  }
  async function exportAs(kind, { background = true, scale = 2 } = {}) {
    if (!elements().length) { tip('Draw something first.'); return; }
    const d = where(), target = await api.invoke('dialog:save', { defaultPath: `${d ? `${d}${sep}` : ''}${stem()}.${kind}`, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] });
    if (!target) return;
    try {
      const data = await picture(kind, { background, scale });
      const r = await call('write', target, data);
      toast(`Exported ${nameOf(r.path)}`, { type: 'success', actions: [{ label: 'Open', fn: () => api.invoke('shell:open', r.path) }, { label: 'Show in folder', fn: () => api.invoke('shell:show', r.path) }] });
    } catch (e) { toast(clean(e), { type: 'error' }); }
  }
  async function picture(kind, { background = true, scale = 2 } = {}) {
    const appState = { ...xapi.getAppState(), exportEmbedScene: true, exportBackground: background, exportWithDarkMode: false, exportScale: scale };
    const args = { elements: xapi.getSceneElements(), appState, files: xapi.getFiles(), exportPadding: 16 };
    if (kind === 'svg') return new TextEncoder().encode((await X.exportToSvg(args)).outerHTML);
    return new Uint8Array(await (await X.exportToBlob({ ...args, mimeType: 'image/png', getDimensions: (w, hh) => ({ width: w * scale, height: hh * scale, scale }) })).arrayBuffer());
  }
  function exportMenu() {
    const old = $('.bd-export', root);
    if (old) { old.remove(); return; }
    const pop = h(`<div class="popmenu bd-export" role="menu">
      <button class="mi" data-k="png">${icon('image', 'sm')}<span class="grow">PNG picture</span><small>2×</small></button>
      <button class="mi" data-k="svg">${icon('shapes', 'sm')}<span class="grow">SVG picture</span><small>Vector</small></button>
      <label class="mi"><input type="checkbox" data-bg checked><span class="grow">Background</span></label>
      <div class="note">The board goes inside the picture, so it opens here again.</div></div>`);
    place(pop, $('[data-a=export]', root));
    pop.addEventListener('click', (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (k) { const background = $('[data-bg]', pop).checked; pop.remove(); exportAs(k, { background }); } });
  }
  async function close() {
    if (dirty()) {
      const c = await confirm3(`Save changes to ${st.savePath || st.file ? nameOf(st.savePath || st.file) : 'this board'}?`, 'Your drawing will be lost if you don’t save it.');
      if (c === 'cancel') return;
      if (c === 'save' && !(await save(false))) return;
    }
    go();
  }
  async function fresh() {
    if (dirty()) {
      const c = await confirm3('Save this board first?', 'A new board replaces this one in the window.');
      if (c === 'cancel') return;
      if (c === 'save' && !(await save(false))) return;
    }
    st.file = '';
    st.savePath = null;
    xapi.resetScene();
    xapi.history.clear();
    st.saved = 'new';
    st.hist = [{ ...snapshot(), label: 'New board' }];
    st.at = 0;
    st.lastSig = sig();
    api.invoke('editor:switched', '', 'board');
    showName();
    chrome();
  }

  const keys = shortcuts(KEYS);
  function onKey(e) {
    if (document.querySelector('.scrim') || !st.ready) return;
    const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    const take = (fn) => { e.preventDefault(); e.stopImmediatePropagation(); fn(); };
    if (c && k === 's') take(() => save(e.shiftKey));
    else if (c && k === 'w') take(close);
    else if (c && e.shiftKey && k === 'e') take(exportMenu);
    else if (c && k === 'o') take(() => {});
  }
  document.addEventListener('keydown', onKey, true);

  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'close') { if (st.ready) close(); else go(); return; }
    if (!st.ready) return;
    if (a === 'undo') press('undo');
    if (a === 'redo') press('redo');
    if (a === 'history') history();
    if (a === 'help') keys.help();
    if (a === 'save') save(false);
    if (a === 'saveas') save(true);
    if (a === 'export') exportMenu();
    if (a === 'new') fresh();
  });

  const theme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  function render(initialData) {
    const { createElement: el, Excalidraw, MainMenu } = X;
    reactRoot.render(el(Excalidraw, {
      excalidrawAPI: (a) => { xapi = a; },
      initialData, theme: theme(), langCode: 'en', autoFocus: true, handleKeyboardGlobally: true, aiEnabled: false,
      onChange,
      UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: null, changeViewBackgroundColor: true, clearCanvas: true }, tools: { image: true } },
      validateEmbeddable: () => false,
      onLinkOpen: (element, ev) => { const u = element.link || ''; ev.preventDefault(); if (/^https?:/i.test(u)) api.invoke('shell:external', u).catch(() => {}); },
    }, el(MainMenu, null, el(MainMenu.DefaultItems.ClearCanvas), el(MainMenu.DefaultItems.ChangeCanvasBackground), el(MainMenu.DefaultItems.Help))));
  }

  (async () => {
    try {
      X = await libs();
      let initialData = { appState: { viewBackgroundColor: '#ffffff' }, scrollToContent: true };
      if (file) {
        const d = await call('open', file);
        const blob = d.text != null ? new Blob([d.text], { type: 'application/json' }) : new Blob([d.bytes], { type: d.mime });
        const s = await X.loadFromBlob(blob, null, null);
        initialData = { elements: s.elements, appState: { ...s.appState, theme: undefined }, files: s.files, scrollToContent: true };
      }
      if (st.disposed) return;
      reactRoot = X.createRoot($('.bd-canvas', root));
      render(initialData);
      for (let i = 0; i < 200 && !xapi; i++) await new Promise((r) => setTimeout(r, 25));
      for (let i = 0; i < 80 && !watchHistory(); i++) await new Promise((r) => setTimeout(r, 25));
      if (!xapi) throw new Error('The whiteboard didn’t start.');
      await new Promise((r) => setTimeout(r, 60));
      st.saved = file ? sig() : 'new';
      st.lastSig = sig();
      st.hist = [{ ...snapshot(), label: file ? 'Opened' : 'New board' }];
      st.ready = true;
      chrome();
      obs2.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    } catch (e) {
      toast(clean(e), { type: 'error' });
      go();
    }
  })();
  const obs2 = new MutationObserver(() => xapi?.updateScene({ appState: { theme: theme() }, captureUpdate: X.CaptureUpdateAction.NEVER }));

  window.__board = { st, api: () => xapi, save, picture, exportAs, scene, sig, dirty, fresh };
  const dispose = () => {
    if (st.disposed) return;
    st.disposed = true;
    document.removeEventListener('keydown', onKey, true);
    keys.dispose();
    obs?.disconnect();
    obs2.disconnect();
    clearTimeout(histT);
    try { reactRoot?.unmount(); } catch (_) {}
  };
  window.addEventListener('pagehide', dispose);
  return dispose;
}
