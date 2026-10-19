import { icon } from './icons.js';
import { api, $, nameOf, toast, applyTheme } from './ui.js';
import { openEditor } from './editor.js';

let settings = await applyTheme();
api.on('settings', (s) => { settings = s; });
const data = await api.invoke('editor:data');
if (!data) window.close();
document.title = nameOf(data.file);
openEditor($('#view'), data, { icon, toast, api, go: () => window.close(), settings: () => settings });
