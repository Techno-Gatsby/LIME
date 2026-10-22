import { icon } from './icons.js';
import { api, $, nameOf, toast, applyTheme } from './ui.js';

let settings = await applyTheme();
api.on('settings', (s) => { settings = s; });
const MODULES = { image: './imgedit.js', media: './mediaedit.js', studio: './studio.js', web: './webedit.js', board: './board.js', drawio: './drawio.js', sqlite: './sqlite.js', map: './mapview.js', hydro: './hydroview.js' };
let askClose = null, closing = false, dispose = null, next = null;
const go = () => { closing = true; if (next) { const d = next; next = null; show(d); } else api.invoke('editor:closeNow'); };
async function show(d) {
  dispose?.();
  dispose = askClose = null;
  const view = $('#view');
  view.innerHTML = '';
  document.title = nameOf(d.file);
  api.invoke('editor:switched', d.file, d.mode);
  const { openEditor } = await import(MODULES[String(d.mode || '').split(':')[0]] || './editor.js');
  dispose = openEditor(view, d, { icon, toast, api, go, settings: () => settings, onClose: (fn) => { askClose = fn; } });
}
async function openFile(file, mode) {
  mode ||= await api.invoke('editor:modeFor', file);
  if (!mode) { toast(`Lime can’t edit ${nameOf(file)}.`, { type: 'error' }); return false; }
  next = { file, mode };
  closing = false;
  if (askClose) await askClose(); else go();
  next = null;
  return closing;
}
const data = await api.invoke('editor:data');
if (data) show(data); else window.close();
api.on('editor:close', async () => { closing = false; if (askClose) await askClose(); else go(); if (!closing) api.invoke('editor:closeCancel'); });
document.addEventListener('dragover', (e) => { if (!e.defaultPrevented && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('drop', (e) => {
  if (e.defaultPrevented) return;
  const file = [...(e.dataTransfer?.files || [])].map((f) => api.pathFor(f)).find(Boolean);
  if (!file) return;
  e.preventDefault();
  openFile(file);
});
window.__page = { openFile };
