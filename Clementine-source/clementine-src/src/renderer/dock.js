// Floating drop target above the taskbar. Drag files onto it from anywhere; tap a key for the wheel.
import { icon } from './icons.js';
import { createWheel } from './wheel.js';
import { api, h, guessFromDrag, pathsFromDrop, runPick } from './common.js';

const [info, settings, catalog] = await Promise.all([api.invoke('app:info'), api.invoke('settings:get'), api.invoke('catalog')]);
document.documentElement.dataset.theme = settings.theme !== 'system' ? settings.theme : (info.dark ? 'dark' : 'light');
document.documentElement.style.setProperty('--accent', info.accent);

const tile = h(`<div class="dock-tile" title="Drop files here. Tap Shift, Ctrl or Alt while dragging for the wheel."><img src="assets/logo.svg" alt=""><small>Drop files</small><button class="btn subtle x" aria-label="Hide dock">${icon('dismiss', 'sm')}</button></div>`);
document.body.append(tile);
tile.querySelector('.x').addEventListener('click', () => api.invoke('dock:hide'));
tile.addEventListener('dblclick', () => api.invoke('main:show'));

let wheel = null, holder = null, depth = 0, items = null, expanded = false, collapseT = null;
const expand = async (on) => { if (on === expanded) return; expanded = on; await api.invoke('dock:expand', on); };
const reset = () => { holder?.remove(); holder = null; wheel = null; tile.classList.remove('over'); clearTimeout(collapseT); collapseT = setTimeout(() => expand(false), 150); };
window.addEventListener('dragenter', async (e) => {
  depth++;
  clearTimeout(collapseT);
  if (depth === 1) { tile.classList.add('over'); items = await api.invoke('wheel:items', guessFromDrag(e.dataTransfer)); }
});
window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) reset(); });
window.addEventListener('dragover', async (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const keys = settings.keys;
  const g = ['convert', 'tools', 'actions'].find((x) => { const k = keys[x]; return (k === 'Shift' && e.shiftKey) || (k === 'Control' && e.ctrlKey) || (k === 'Alt' && e.altKey); });
  if (g && !wheel && items) {
    await expand(true);
    holder = h(`<div class="dock-wheel"></div>`);
    document.body.append(holder);
    wheel = createWheel(holder, { keys, mode: 'drag', centerHint: 'Drop here to open in Clementine' });
    wheel.setMode('drag');
    wheel.setItems(items);
    wheel.setGroup(g);
  } else if (g && wheel && g !== wheel.group) wheel.setGroup(g);
  wheel?.hoverAt(e.clientX, e.clientY);
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  depth = 0;
  const files = pathsFromDrop(e.dataTransfer);
  const pick = wheel?.current();
  const group = wheel?.group;
  reset();
  if (!files.length) return;
  if (!pick) { api.invoke('main:show', { files }); return; }
  const real = await api.invoke('wheel:items', files);
  const item = (real[group] || []).find((x) => (x.tool ? x.tool === pick.tool && x.label === pick.label : x.action === pick.action));
  if (!item) { api.invoke('main:show', { files, toast: `${pick.label} doesn’t apply to these files. Pick a tool instead.` }); return; }
  const r = await runPick(item, files, catalog);
  if (r.navigate) api.invoke('main:show', { route: 'tool', ...r.navigate });
});
