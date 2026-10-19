import { icon } from './icons.js';
import { limeSvg } from './petal.js';
import { api, $, h, esc, nameOf, applyTheme } from './ui.js';

let s = await applyTheme();
const info = await api.invoke('app:info');
const isMac = api.platform === 'darwin';
if (!isMac) document.body.classList.add('solid');
const app = $('#app');
const set = async (patch) => { s = await api.invoke('settings:set', patch); render(); };

function seg(key, choices) {
  return `<div class="seg" data-k="${key}">${choices.map(([v, l]) => `<button data-v="${v}" aria-pressed="${String(s[key]) === v}">${l}</button>`).join('')}</div>`;
}
const sw = (key, invert) => `<label class="switch"><input type="checkbox" data-k="${key}" ${(invert ? !s[key] : s[key]) ? 'checked' : ''}></label>`;
const row = (ic, title, sub, ctl) => `<div class="row">${ic ? icon(ic, '').replace('class="ic', 'class="ic lead') : ''}<div class="t"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${ctl || ''}</div>`;

async function render() {
  const eng = await api.invoke('engines:status').catch(() => ({ crafts: [] }));
  const found = (ok, label) => `<span class="tag">${ok ? 'Found' : 'Not found'}</span><span class="dot ${ok ? 'on' : ''}" title="${label}"></span>`;
  app.innerHTML = `
  <header>${limeSvg(52, 'p')}<div><h1>Lime</h1><p>Version ${esc(info.version)} · Everything runs on this ${isMac ? 'Mac' : 'PC'}</p></div></header>
  <section><h2>Saving</h2><div class="group">
    ${row('save', 'Ask where to save', 'Choose a name and folder before Lime writes anything', sw('askSave'))}
    ${s.askSave ? '' : row('folder', 'Save results', s.outMode === 'folder' ? esc(s.outFolder) : 'Next to the original file', `${seg('outMode', [['beside', 'Beside original'], ['folder', 'Folder']])}${s.outMode === 'folder' ? '<button class="btn" data-a="folder">Choose…</button>' : ''}`)}
    ${row('open', isMac ? 'Show in Finder when done' : 'Show in folder when done', '', sw('reveal'))}
    ${row('info', 'Notify when done', 'Only while the wheel is in the background', sw('notify'))}
  </div></section>
  <section><h2>Wheel</h2><div class="group">
    ${row('circle', 'Size', '', seg('size', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]))}
    ${row('layers', 'Float above windows', 'Off keeps it on the desktop, behind your apps', sw('float'))}
    ${row('sparkle', 'Appearance', '', seg('theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]))}
    ${isMac ? row('grid', 'Show in Dock', 'Lime always lives in the menu bar', sw('dock')) : ''}
    ${row('again', 'Open at login', '', sw('login'))}
    ${row('cursor', 'Show or hide the wheel', isMac ? 'With files selected in Finder, opens them in the wheel' : '', '<kbd>⌃</kbd><kbd>⌥</kbd><kbd>L</kbd>')}
    ${row('fit', 'Reset position', '', '<button class="btn" data-a="reset">Reset</button>')}
  </div></section>
  <section><h2>Built-in engines</h2><div class="group crafts">
    ${eng.crafts.map((c) => row('', esc(c.name), `${esc(c.role)}${c.version ? ` · ${esc(c.version)}` : ''}`, `<span class="dot ${c.bundled ? 'on' : ''}"></span>`)).join('')}
  </div>
  <div class="group" style="margin-top:10px">
    ${row('video', 'FFmpeg', 'Video and audio conversion', '<span class="dot on"></span>')}
    ${row('image', 'libvips · MuPDF · Tesseract', 'Images, PDF and text recognition in 13 languages', '<span class="dot on"></span>')}
    ${row('ruler', 'LibreDWG · OpenCascade', 'DWG drawings and STEP, IGES and BREP models', '<span class="dot on"></span>')}
  </div></section>
  <section><h2>Also used when installed</h2><div class="group">
    ${row('doc', 'LibreOffice', 'Exact Word, Excel and PowerPoint layouts', found(!!eng.libreoffice, 'LibreOffice'))}
    ${isMac ? row('layers', 'Pages · Keynote · Numbers', 'Opens and exports Apple iWork files', found(eng.pages || eng.keynote || eng.numbers, 'iWork')) : ''}
    ${row('text', 'Pandoc', 'LaTeX, reStructuredText and Org files', found(!!eng.pandoc, 'Pandoc'))}
  </div></section>
  <section><h2>About</h2><div class="group">
    ${row('info', 'Open-source licences', 'Lime is AGPL-3.0. ArtCraft engines are MIT or Apache-2.0', '<button class="btn" data-a="licenses">View</button>')}
  </div></section>`;
}
app.addEventListener('click', async (e) => {
  const b = e.target.closest('.seg button');
  if (b) { set({ [b.parentElement.dataset.k]: b.dataset.v }); return; }
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'folder') { const [d] = await api.invoke('dialog:open', { folders: true, multi: false, create: true }); if (d) set({ outFolder: d }); }
  if (a === 'reset') { await api.invoke('settings:set', { anchor: null }); }
  if (a === 'licenses') { const p = await api.invoke('app:paths'); api.invoke('shell:open', `${p.licenses}/THIRD-PARTY-NOTICES.txt`); }
});
app.addEventListener('change', (e) => { const i = e.target.closest('input[type=checkbox][data-k]'); if (i) set({ [i.dataset.k]: i.checked }); });
api.on('settings', (n) => { s = n; render(); });
render();
