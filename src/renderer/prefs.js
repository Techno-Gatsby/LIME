import { icon } from './icons.js';
import { limeSvg, setIcon } from './petal.js';
import { api, $, h, esc, nameOf, applyTheme } from './ui.js';
import * as dictation from './prefs-dictate.js';
import { aboutRows, wireAbout } from './prefs-about.js';
import { wireSearch } from './prefs-search.js';

let s = await applyTheme();
const info = await api.invoke('app:info');
let update = await api.invoke('update:status').catch(() => ({ phase: 'idle' }));
const isMac = api.platform === 'darwin';
if (!isMac) document.body.classList.add('solid');
const app = $('#app');
const set = async (patch) => { s = await api.invoke('settings:set', patch); render(); };

function seg(key, choices) {
  return `<div class="seg" data-k="${key}">${choices.map(([v, l]) => `<button data-v="${v}" aria-pressed="${String(s[key]) === v}">${l}</button>`).join('')}</div>`;
}
const sw = (key, on = s[key]) => `<label class="switch"><input type="checkbox" data-k="${key}" ${on ? 'checked' : ''}></label>`;
const APP_ICON = { photocraft: 'image', lightcraft: 'sparkle', vectorcraft: 'pen', designcraft: 'layers', effectcraft: 'eye', filmcraft: 'video', pdfcraft: 'pdf', cadcraft: 'compass', soundcraft: 'wave', wordcraft: 'doc', gridcraft: 'grid', deckcraft: 'present', maps: 'map', hydro: 'drop', projectlibre: 'gantt' };
const fail = (t, why) => { const n = t.querySelector('.why') || t.appendChild(Object.assign(document.createElement('small'), { className: 'why' })); n.textContent = why; n.style.color = 'var(--danger)'; };
const reason = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const RING_CAP = { first: 9, second: 10 };
const RING_CSS = `.rings { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .ring-col h3 { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; font-weight: 600; margin: 0 6px 6px; }
  .ring-col ol { list-style: none; margin: 0; padding: 4px 0; min-height: 44px; }
  .ring-col li { display: flex; align-items: center; gap: 8px; padding: 4px 6px 4px 12px; cursor: grab; position: relative; }
  .ring-col li .ic { color: var(--green); flex: none; }
  .ring-col li .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ring-col li .acts { display: flex; gap: 2px; opacity: .5; }
  .ring-col li:hover .acts, .ring-col li:focus-within .acts { opacity: 1; }
  .ring-col li .acts .btn { min-width: 0; width: 26px; height: 26px; padding: 0; display: grid; place-items: center; }
  .ring-col li.dragging { opacity: .4; }
  .ring-col li.drop-before { box-shadow: inset 0 2px 0 var(--green); }
  .ring-col li.drop-after { box-shadow: inset 0 -2px 0 var(--green); }
  .ring-col ol.drop-end { box-shadow: inset 0 0 0 2px var(--green); }
  .rings-foot { display: flex; justify-content: flex-end; margin-top: 8px; }`;
document.head.append(Object.assign(document.createElement('style'), { textContent: RING_CSS }));
function ringsSection(eng) {
  const rings = s.rings || { first: [], second: [] }, names = Object.fromEntries(eng.crafts.map((c) => [c.id, c.name]));
  const other = (k) => (k === 'first' ? 'second' : 'first');
  const item = (k, id, i) => `<li draggable="true" data-id="${esc(id)}" data-ring="${k}">${icon(APP_ICON[id] || 'layers', 'sm')}<span class="n">${esc(names[id] || id)}</span><span class="acts">
    <button class="btn subtle icon" data-a="ring-up" title="Move up" aria-label="Move ${esc(names[id] || id)} up" ${i === 0 ? 'disabled' : ''}>${icon('up', 'sm')}</button>
    <button class="btn subtle icon" data-a="ring-down" title="Move down" aria-label="Move ${esc(names[id] || id)} down" ${i === rings[k].length - 1 ? 'disabled' : ''}>${icon('down', 'sm')}</button>
    <button class="btn subtle icon" data-a="ring-move" title="${k === 'first' ? 'Move to More apps' : 'Move to the first ring'}" aria-label="Move ${esc(names[id] || id)} to ${k === 'first' ? 'More apps' : 'the first ring'}" ${rings[other(k)].length >= RING_CAP[other(k)] ? 'disabled' : ''}>${icon(k === 'first' ? 'chevron' : 'back', 'sm')}</button></span></li>`;
  return `<section class="wheel-apps"><h2>Wheel apps</h2><p class="note">Which apps the wheel shows first, and which wait one slice away under More apps. Drag them to reorder, or across to move them.</p>
    <div class="rings">${['first', 'second'].map((k) => `<div class="ring-col" data-ring="${k}"><h3>${k === 'first' ? 'First ring' : 'More apps'}<span class="tag">${rings[k].length} of ${RING_CAP[k]}</span></h3><ol class="group" data-ring="${k}">${rings[k].map((id, i) => item(k, id, i)).join('')}</ol></div>`).join('')}</div>
    <div class="rings-foot"><button class="btn" data-a="rings-reset">Reset to default</button></div></section>`;
}
async function setRings(fn, focus) {
  const r = { first: [...(s.rings?.first || [])], second: [...(s.rings?.second || [])] };
  if (fn && fn(r) === false) return;
  s = await api.invoke('settings:set', { rings: fn ? r : null });
  await render();
  if (focus) (app.querySelector(`li[data-id="${focus[0]}"] [data-a="${focus[1]}"]:not([disabled])`) || app.querySelector(`li[data-id="${focus[0]}"] [data-a]:not([disabled])`))?.focus();
}
function moveApp(r, id, to, at) {
  const from = r.first.includes(id) ? 'first' : 'second';
  if (from !== to && r[to].length >= RING_CAP[to]) return false;
  const i = r[from].indexOf(id);
  r[from].splice(i, 1);
  r[to].splice(Math.max(0, Math.min(at ?? r[to].length, r[to].length)), 0, id);
  return true;
}
let dragId = null;
const clearDrop = () => app.querySelectorAll('.drop-before, .drop-after, .drop-end, .dragging').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-end', 'dragging'));
function dropAt(e) {
  const ol = e.target.closest?.('.ring-col ol');
  if (!ol) return null;
  const li = e.target.closest('li'), ring = ol.dataset.ring, ids = [...ol.querySelectorAll('li')].map((n) => n.dataset.id);
  if (!li) return { ring, at: ids.length, ol };
  const after = e.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
  return { ring, at: ids.indexOf(li.dataset.id) + (after ? 1 : 0), li, after, ol };
}
app.addEventListener('dragstart', (e) => { const li = e.target.closest?.('.ring-col li'); if (!li) return; dragId = li.dataset.id; e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); });
app.addEventListener('dragend', () => { dragId = null; clearDrop(); });
app.addEventListener('dragover', (e) => {
  const d = dragId && dropAt(e);
  if (!d) return;
  const full = !(s.rings?.[d.ring] || []).includes(dragId) && (s.rings?.[d.ring] || []).length >= RING_CAP[d.ring];
  app.querySelectorAll('.drop-before, .drop-after, .drop-end').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-end'));
  if (full) return;
  e.preventDefault();
  if (d.li) d.li.classList.add(d.after ? 'drop-after' : 'drop-before'); else d.ol.classList.add('drop-end');
});
app.addEventListener('drop', (e) => {
  const d = dragId && dropAt(e), id = dragId;
  clearDrop();
  if (!d) return;
  e.preventDefault();
  setRings((r) => { const same = r[d.ring].includes(id), was = r[d.ring].indexOf(id); return moveApp(r, id, d.ring, same && was < d.at ? d.at - 1 : d.at); });
});
const row = (ic, title, sub, ctl) => `<div class="row">${ic ? icon(ic, '').replace('class="ic', 'class="ic lead') : ''}<div class="t"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${ctl || ''}</div>`;

async function render() {
  setIcon(s.icon);
  const eng = await api.invoke('engines:status').catch(() => ({ crafts: [] }));
  const found = (ok, label) => `<span class="tag">${ok ? 'Found' : 'Not installed'}</span><span class="dot ${ok ? 'on' : ''}" title="${label}"></span>`;
  const absent = '<span class="tag">Not included</span>';
  const helper = (key, p, what) => `${p ? `<span class="tag" title="${esc(p)}">${eng.bundled?.[key] && !s[key] ? 'Included' : 'Found'}</span>` : eng.bundled?.[key] ? '<span class="tag">Included · getting ready…</span>' : absent}<button class="btn" data-a="locate" data-k="${key}" data-what="${what}">${p ? 'Change…' : 'Locate…'}</button>`;
  const dictHtml = await dictation.html();
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
  ${dictHtml}
  <section><h2>ArtCraft apps</h2><div class="group apps">
    ${eng.crafts.map((c) => row(APP_ICON[c.id] || 'layers', esc(c.name), `${esc(c.role)}${c.version ? ` · ${esc(c.version)}` : ''}`, c.app ? `<button class="btn" data-a="app" data-id="${c.id}">Open</button>` : absent)).join('')}
  </div></section>
  ${ringsSection(eng)}
  <section><h2>Built-in engines</h2>
  <div class="group">
    ${eng.crafts.length ? row('cube', 'ArtCraft engines', eng.crafts.map((c) => c.name.replace('Craft', '')).join(' · '), `<span class="dot ${eng.crafts.every((c) => c.bundled) ? 'on' : ''}"></span>`) : ''}
    ${row('video', 'FFmpeg', 'Video and audio conversion', '<span class="dot on"></span>')}
    ${row('image', 'libvips · MuPDF · Tesseract', 'Images, PDF and text recognition in 13 languages', '<span class="dot on"></span>')}
    ${row('ruler', 'LibreDWG · OpenCascade', 'DWG drawings and STEP, IGES and BREP models', '<span class="dot on"></span>')}
    ${row('sparkle', 'Real-ESRGAN · LaMa', 'Upscale with AI and Erase object, on this computer', `<span class="dot ${eng.models?.length === 2 ? 'on' : ''}"></span>`)}
  </div></section>
  <section><h2>Optional helpers</h2><p class="note">Lime converts Office documents on its own. If these free apps are on this ${isMac ? 'Mac' : 'PC'}, it uses them for even more exact layouts and extra formats.</p><div class="group">
    ${row('doc', 'LibreOffice', eng.libreoffice ? esc(eng.libreoffice) : 'Exact Word, Excel and PowerPoint layouts', helper('soffice', eng.libreoffice, 'LibreOffice'))}
    ${isMac ? row('layers', 'Pages · Keynote · Numbers', 'Opens and exports Apple iWork files', found(eng.pages || eng.keynote || eng.numbers, 'iWork')) : ''}
    ${row('text', 'Pandoc', eng.pandoc ? esc(eng.pandoc) : 'LaTeX, reStructuredText and Org files', helper('pandoc', eng.pandoc, 'Pandoc'))}
  </div></section>
  <section id="about"><h2>About</h2><div class="group">
    ${aboutRows(row, sw, info, s, update)}
    ${row('eye', 'How Lime works', 'The four steps shown the first time Lime ran', '<button class="btn" data-a="welcome">Show again</button>')}
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
  if (a === 'locate') {
    const el = e.target.closest('[data-a]');
    const [f] = await api.invoke('dialog:open', { title: `Find ${el.dataset.what}`, multi: false, filters: isMac ? undefined : [{ name: 'Programs', extensions: ['exe'] }] });
    if (f) { const p = isMac && /\.app$/i.test(f) ? `${f}/Contents/MacOS/soffice` : f; set({ [el.dataset.k]: p }); }
  }
  if (a === 'rings-reset') setRings(null);
  if (['ring-up', 'ring-down', 'ring-move'].includes(a)) {
    const li = e.target.closest('li'), id = li.dataset.id, k = li.dataset.ring;
    setRings((r) => { const i = r[k].indexOf(id); return a === 'ring-move' ? moveApp(r, id, k === 'first' ? 'second' : 'first') : moveApp(r, id, k, a === 'ring-up' ? i - 1 : i + 1); }, [id, a]);
  }
  if (a === 'licenses') { const p = await api.invoke('app:paths'); api.invoke('shell:open', `${p.licenses}/THIRD-PARTY-NOTICES.txt`); }
  if (a === 'welcome') api.invoke('welcome:open');
});
app.addEventListener('change', (e) => { const i = e.target.closest('input[type=checkbox][data-k]'); if (i) set({ [i.dataset.k]: i.checked }); });
api.on('settings', (n) => { s = n; render(); });
dictation.wire(app, render);
wireAbout(app, api, (u) => { update = u; });
const search = wireSearch(app);
await render();
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
api.on('prefs:tab', (t) => document.getElementById(t)?.scrollIntoView({ behavior: 'smooth' }));
