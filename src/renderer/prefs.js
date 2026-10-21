import { icon } from './icons.js';
import { limeSvg, setIcon } from './petal.js';
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
const sw = (key, on = s[key]) => `<label class="switch"><input type="checkbox" data-k="${key}" ${on ? 'checked' : ''}></label>`;
const APP_ICON = { photocraft: 'image', lightcraft: 'sparkle', vectorcraft: 'pen', designcraft: 'layers', effectcraft: 'eye', filmcraft: 'video', pdfcraft: 'pdf' };
const fail = (t, why) => { const n = t.querySelector('.why') || t.appendChild(Object.assign(document.createElement('small'), { className: 'why' })); n.textContent = why; n.style.color = 'var(--danger)'; };
const reason = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const row = (ic, title, sub, ctl) => `<div class="row">${ic ? icon(ic, '').replace('class="ic', 'class="ic lead') : ''}<div class="t"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${ctl || ''}</div>`;

async function render() {
  setIcon(s.icon);
  const eng = await api.invoke('engines:status').catch(() => ({ crafts: [] }));
  const found = (ok, label) => `<span class="tag">${ok ? 'Found' : 'Not installed'}</span><span class="dot ${ok ? 'on' : ''}" title="${label}"></span>`;
  const SIZE = { soffice: 350, pandoc: 40 };
  const dl = (key, what, cls = '') => `<button class="btn ${cls}" data-a="get" data-k="${key}" data-what="${what}" title="About ${SIZE[key] || 90} MB, from the makers of ${what}; no administrator rights needed">Download…</button>`;
  const helper = (key, p, what) => `${p ? `<span class="tag" title="${esc(p)}">${eng.bundled?.[key] && !s[key] ? 'Included' : 'Found'}</span>` : eng.bundled?.[key] ? '<span class="tag">Included · getting ready…</span>' : dl(key, what, 'primary')}<button class="btn" data-a="locate" data-k="${key}" data-what="${what}">${p ? 'Change…' : 'Locate…'}</button>`;
  app.innerHTML = `
  <header>${limeSvg(52)}<div><h1>Lime</h1><p>Version ${esc(info.version)} · Everything runs on this ${isMac ? 'Mac' : 'PC'}</p></div></header>
  <section><h2>Saving</h2><div class="group">
    ${row('save', 'Ask where to save', 'Choose a name and folder before Lime writes anything', sw('askSave'))}
    ${s.askSave ? '' : row('folder', 'Save results', s.outMode === 'folder' ? esc(s.outFolder) : 'Next to the original file', `${seg('outMode', [['beside', 'Beside original'], ['folder', 'Folder']])}${s.outMode === 'folder' ? '<button class="btn" data-a="folder">Choose…</button>' : ''}`)}
    ${row('open', isMac ? 'Show in Finder when done' : 'Show in folder when done', '', sw('reveal'))}
    ${row('info', 'Notify when done', 'Only while the wheel is in the background', sw('notify'))}
  </div></section>
  <section><h2>Wheel</h2><div class="group">
    ${row('circle', 'Size', '', seg('size', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]))}
    ${row('', `<span class="icon-row">${limeSvg(28)}Icon</span>`, s.icon ? 'Your picture, in place of the lime' : 'The lime', `${s.icon ? '<button class="btn" data-a="icon-reset">Use the lime</button>' : ''}<button class="btn" data-a="icon">Choose picture…</button>`)}
    ${row('layers', 'Float above windows', 'Off keeps it on the desktop, behind your apps', sw('float'))}
    ${row('sparkle', 'Appearance', '', seg('theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]))}
    ${row('music', 'Sounds', 'A tick for each choice, a soft thud when files land', sw('sounds', s.sounds !== false))}
    ${isMac ? row('grid', 'Show in Dock', 'Lime always lives in the menu bar', sw('dock')) : ''}
    ${row('again', 'Open at login', '', sw('login'))}
    ${row('cursor', 'Show or hide the wheel', isMac ? 'With files selected in Finder, opens them in the wheel' : '', '<kbd>⌃</kbd><kbd>⌥</kbd><kbd>L</kbd>')}
    ${row('fit', 'Reset position', '', '<button class="btn" data-a="reset">Reset</button>')}
  </div></section>
  <section><h2>ArtCraft apps</h2><div class="group apps">
    ${eng.crafts.map((c) => row(APP_ICON[c.id] || 'layers', esc(c.name), `${esc(c.role)}${c.version ? ` · ${esc(c.version)}` : ''}`, c.app ? `<button class="btn" data-a="app" data-id="${c.id}">Open</button>` : dl(c.id, c.name))).join('')}
  </div></section>
  <section><h2>Built-in engines</h2>
  <div class="group">
    ${eng.crafts.length ? row('cube', 'ArtCraft engines', eng.crafts.map((c) => c.name.replace('Craft', '')).join(' · '), `<span class="dot ${eng.crafts.every((c) => c.bundled) ? 'on' : ''}"></span>`) : ''}
    ${row('video', 'FFmpeg', 'Video and audio conversion', '<span class="dot on"></span>')}
    ${row('image', 'libvips · MuPDF · Tesseract', 'Images, PDF and text recognition in 13 languages', '<span class="dot on"></span>')}
    ${row('ruler', 'LibreDWG · OpenCascade', 'DWG drawings and STEP, IGES and BREP models', '<span class="dot on"></span>')}
  </div></section>
  <section><h2>Optional helpers</h2><p class="note">Lime converts Office documents on its own. If these free apps are on this ${isMac ? 'Mac' : 'PC'}, it uses them for even more exact layouts and extra formats.</p><div class="group">
    ${row('doc', 'LibreOffice', eng.libreoffice ? esc(eng.libreoffice) : 'Exact Word, Excel and PowerPoint layouts', helper('soffice', eng.libreoffice, 'LibreOffice'))}
    ${isMac ? row('layers', 'Pages · Keynote · Numbers', 'Opens and exports Apple iWork files', found(eng.pages || eng.keynote || eng.numbers, 'iWork')) : ''}
    ${row('text', 'Pandoc', eng.pandoc ? esc(eng.pandoc) : 'LaTeX, reStructuredText and Org files', helper('pandoc', eng.pandoc, 'Pandoc'))}
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
  if (a === 'icon') { const [f] = await api.invoke('dialog:open', { title: 'Choose a picture for the icon', multi: false, filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'avif', 'bmp', 'tif', 'tiff', 'svg'] }] }); if (f) await api.invoke('icon:set', f).catch((err) => alert(String(err?.message || err))); }
  if (a === 'icon-reset') await api.invoke('icon:set', null);
  if (a === 'reset') { await api.invoke('settings:set', { anchor: null }); }
  if (a === 'app') {
    const b = e.target.closest('[data-a]');
    b.disabled = true;
    b.textContent = 'Opening…';
    try { await api.invoke('apps:open', b.dataset.id); b.textContent = 'Open'; } catch (err) {
      b.textContent = 'Try again'; b.title = reason(err);
      fail(b.closest('.row').querySelector('.t'), reason(err));
    } finally { b.disabled = false; }
  }
  if (a === 'get' || a === 'stop') {
    const b = e.target.closest('[data-a]'), k = b.dataset.k, t = b.closest('.row').querySelector('.t');
    if (a === 'stop') { b.disabled = true; api.invoke('helpers:cancel', k); return; }
    const primary = b.classList.contains('primary');
    b.dataset.a = 'stop'; b.textContent = 'Stop'; b.classList.remove('primary');
    t.querySelector('.why')?.remove();
    const sub = t.querySelector('small'), was = sub.textContent;
    try { await api.invoke('helpers:get', k); render(); } catch (err) {
      b.dataset.a = 'get'; b.textContent = 'Download…'; b.classList.toggle('primary', primary); b.disabled = false;
      sub.textContent = was;
      if (reason(err) !== 'Stopped.') fail(t, `Couldn’t download ${b.dataset.what}: ${reason(err)}`);
    }
  }
  if (a === 'locate') {
    const el = e.target.closest('[data-a]');
    const [f] = await api.invoke('dialog:open', { title: `Find ${el.dataset.what}`, multi: false, filters: isMac ? undefined : [{ name: 'Programs', extensions: ['exe'] }] });
    if (f) { const p = isMac && /\.app$/i.test(f) ? `${f}/Contents/MacOS/soffice` : f; set({ [el.dataset.k]: p }); }
  }
  if (a === 'licenses') { const p = await api.invoke('app:paths'); api.invoke('shell:open', `${p.licenses}/THIRD-PARTY-NOTICES.txt`); }
});
app.addEventListener('change', (e) => { const i = e.target.closest('input[type=checkbox][data-k]'); if (i) set({ [i.dataset.k]: i.checked }); });
api.on('settings', (n) => { s = n; render(); });
api.on('helpers:progress', (p) => {
  const sub = $(`.row [data-k="${p.id}"]`)?.closest('.row')?.querySelector('.t small');
  if (sub) sub.textContent = p.phase === 'download' ? `Downloading… ${p.pct}% of ${Math.round(p.total / 1048576)} MB` : p.phase === 'unpack' ? 'Unpacking…' : 'Starting…';
});
render();
