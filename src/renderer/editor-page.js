import { icon } from './icons.js';
import { api, $, nameOf, toast, applyTheme } from './ui.js';
import { openEditor } from './editor.js';

let settings = await applyTheme();
api.on('settings', (s) => { settings = s; });
const data = await api.invoke('editor:data');
if (!data) window.close();
document.title = nameOf(data.file);
// Each kind of editor is a module of its own with the same openEditor(view, data, ctx); PDFs open in editor.js.
const MODULES = { image: './imgedit.js', media: './mediaedit.js', studio: './studio.js', web: './webedit.js' };
const kind = String(data.mode || '').split(':')[0];
const open = MODULES[kind] ? (await import(MODULES[kind])).openEditor : openEditor;
let askClose = null, closing = false;
const go = () => { closing = true; api.invoke('editor:closeNow'); };
open($('#view'), data, { icon, toast, api, go, settings: () => settings, onClose: (fn) => { askClose = fn; } });
api.on('editor:close', async () => { closing = false; if (askClose) await askClose(); else go(); if (!closing) api.invoke('editor:closeCancel'); });
