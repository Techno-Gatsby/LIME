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
const APP_ICON = { photocraft: 'image', lightcraft: 'sparkle', vectorcraft: 'pen', designcraft: 'layers', effectcraft: 'eye', filmcraft: 'video', pdfcraft: 'pdf', cadcraft: 'compass', soundcraft: 'wave', wordcraft: 'doc', gridcraft: 'grid', deckcraft: 'present', webcraft: 'web', code: 'code', python: 'python', sqlite: 'database' };
const BUCKET_ICON = { office: 'doc', design: 'sparkle', coding: 'code', engineering: 'compass' };
const fail = (t, why) => { const n = t.querySelector('.why') || t.appendChild(Object.assign(document.createElement('small'), { className: 'why' })); n.textContent = why; n.style.color = 'var(--danger)'; };
const reason = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const catalog = await api.invoke('apps:catalog').catch(() => ({ buckets: {}, apps: {} }));
const BUCKET_CSS = `.buckets { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .bucket-col h3 { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; margin: 0 6px 6px; }
  .bucket-col h3 .ic { color: var(--green); }
  .bucket-col h3 .nm { flex: 1; }
  .bucket-col h3 .acts { display: flex; gap: 2px; opacity: .5; }
  .bucket-col:hover h3 .acts, .bucket-col h3:focus-within .acts { opacity: 1; }
  .bucket-col ol { list-style: none; margin: 0; padding: 4px 0; min-height: 44px; }
  .bucket-col li { display: flex; align-items: center; gap: 8px; padding: 4px 6px 4px 12px; cursor: grab; position: relative; }
  .bucket-col li .ic { color: var(--green); flex: none; }
  .bucket-col li .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bucket-col li.off .n, .bucket-col li.off > .ic { opacity: .45; }
  .bucket-col li.off .n::after { content: " · hidden"; color: var(--ink-3); font-size: 11px; }
  .bucket-col .acts { display: flex; gap: 2px; opacity: .5; align-items: center; }
  .bucket-col li:hover .acts, .bucket-col li:focus-within .acts { opacity: 1; }
  .bucket-col .acts .btn { min-width: 0; width: 26px; height: 26px; padding: 0; display: grid; place-items: center; }
  .bucket-col .acts select { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: transparent; cursor: pointer; appearance: none; position: relative; }
  .bucket-col .acts .move { position: relative; width: 26px; height: 26px; display: grid; place-items: center; }
  .bucket-col .acts .move .ic { position: absolute; pointer-events: none; color: var(--ink-2); }
  .bucket-col .acts .move select:focus-visible { outline: 2px solid var(--accent-soft); }
  .bucket-col .acts .move select option { color: var(--ink); background: var(--surface); }
  .bucket-col li.dragging { opacity: .4; }
  .bucket-col li.drop-before { box-shadow: inset 0 2px 0 var(--green); }
  .bucket-col li.drop-after { box-shadow: inset 0 -2px 0 var(--green); }
  .bucket-col ol.drop-end { box-shadow: inset 0 0 0 2px var(--green); }
  .buckets-foot { display: flex; justify-content: flex-end; margin-top: 8px; }`;
document.head.append(Object.assign(document.createElement('style'), { textContent: BUCKET_CSS }));
const blank = () => ({ order: Object.keys(catalog.buckets), apps: Object.fromEntries(Object.keys(catalog.buckets).map((k) => [k, []])), hidden: [] });
// Settings › Wheel apps: the buckets in order, the apps in each, and which apps are hidden from the wheel.
function bucketsSection() {
  const b = s.buckets || blank(), B = catalog.buckets, nm = (id) => catalog.apps[id]?.name || id;
  const item = (k, id, i, list) => `<li draggable="true" data-id="${esc(id)}" data-bucket="${k}" class="${b.hidden.includes(id) ? 'off' : ''}">${icon(APP_ICON[id] || 'layers', 'sm')}<span class="n" title="${esc(catalog.apps[id]?.role || '')}">${esc(nm(id))}</span><span class="acts">
    <button class="btn subtle icon" data-a="app-up" title="Move up" aria-label="Move ${esc(nm(id))} up" ${i === 0 ? 'disabled' : ''}>${icon('up', 'sm')}</button>
    <button class="btn subtle icon" data-a="app-down" title="Move down" aria-label="Move ${esc(nm(id))} down" ${i === list.length - 1 ? 'disabled' : ''}>${icon('down', 'sm')}</button>
    <span class="move" title="Move to another bucket">${icon('chevron', 'sm')}<select data-a="app-bucket" aria-label="Move ${esc(nm(id))} to another bucket">${b.order.map((o) => `<option value="${o}" ${o === k ? 'selected' : ''}>${esc(B[o]?.name || o)}</option>`).join('')}</select></span>
    <button class="btn subtle icon" data-a="app-hide" title="${b.hidden.includes(id) ? 'Show on the wheel' : 'Hide from the wheel'}" aria-label="${b.hidden.includes(id) ? 'Show' : 'Hide'} ${esc(nm(id))}" aria-pressed="${b.hidden.includes(id)}">${icon(b.hidden.includes(id) ? 'add' : 'eye', 'sm')}</button></span></li>`;
  const col = (k, i) => { const list = b.apps[k] || [], shown = list.filter((id) => !b.hidden.includes(id)).length;
    return `<div class="bucket-col" data-bucket="${k}"><h3>${icon(BUCKET_ICON[k] || 'bucket', 'sm')}<span class="nm">${esc(B[k]?.name || k)}</span><span class="tag">${shown} of ${list.length}</span><span class="acts">
      <button class="btn subtle icon" data-a="bucket-up" title="Move the bucket earlier" aria-label="Move ${esc(B[k]?.name || k)} earlier" ${i === 0 ? 'disabled' : ''}>${icon('up', 'sm')}</button>
      <button class="btn subtle icon" data-a="bucket-down" title="Move the bucket later" aria-label="Move ${esc(B[k]?.name || k)} later" ${i === b.order.length - 1 ? 'disabled' : ''}>${icon('down', 'sm')}</button></span></h3>
      <ol class="group" data-bucket="${k}">${list.map((id, j) => item(k, id, j, list)).join('')}</ol></div>`; };
  return `<section class="wheel-apps"><h2>Wheel apps</h2><p class="note">Clicking the lime shows these buckets, each opening a ring of its apps. Drag apps to reorder them or into another bucket, move buckets up or down, and hide apps you don’t use.</p>
    <div class="buckets">${b.order.map(col).join('')}</div>
    <div class="buckets-foot"><button class="btn" data-a="buckets-reset">Reset to default</button></div></section>`;
}
async function setBuckets(fn, focus) {
  const cur = s.buckets || blank(), b = { order: [...cur.order], apps: Object.fromEntries(Object.entries(cur.apps).map(([k, v]) => [k, [...v]])), hidden: [...cur.hidden] };
  if (fn && fn(b) === false) return;
  s = await api.invoke('settings:set', { buckets: fn ? b : null });
  await render();
  if (focus) (app.querySelector(`li[data-id="${focus[0]}"] [data-a="${focus[1]}"]:not([disabled])`) || app.querySelector(`.bucket-col[data-bucket="${focus[0]}"] [data-a="${focus[1]}"]:not([disabled])`) || app.querySelector(`li[data-id="${focus[0]}"] [data-a]:not([disabled])`))?.focus();
}
function moveApp(b, id, to, at) {
  const from = Object.keys(b.apps).find((k) => b.apps[k].includes(id));
  if (!from || !b.apps[to]) return false;
  b.apps[from].splice(b.apps[from].indexOf(id), 1);
  b.apps[to].splice(Math.max(0, Math.min(at ?? b.apps[to].length, b.apps[to].length)), 0, id);
  return true;
}
let dragId = null;
const clearDrop = () => app.querySelectorAll('.drop-before, .drop-after, .drop-end, .dragging').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-end', 'dragging'));
function dropAt(e) {
  const ol = e.target.closest?.('.bucket-col ol') || e.target.closest?.('.bucket-col')?.querySelector('ol');
  if (!ol) return null;
  const li = e.target.closest('li'), bucket = ol.dataset.bucket, ids = [...ol.querySelectorAll('li')].map((n) => n.dataset.id);
  if (!li) return { bucket, at: ids.length, ol };
  const after = e.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
  return { bucket, at: ids.indexOf(li.dataset.id) + (after ? 1 : 0), li, after, ol };
}
app.addEventListener('dragstart', (e) => { const li = e.target.closest?.('.bucket-col li'); if (!li) return; dragId = li.dataset.id; e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); });
app.addEventListener('dragend', () => { dragId = null; clearDrop(); });
app.addEventListener('dragover', (e) => {
  const d = dragId && dropAt(e);
  if (!d) return;
  app.querySelectorAll('.drop-before, .drop-after, .drop-end').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-end'));
  e.preventDefault();
  if (d.li) d.li.classList.add(d.after ? 'drop-after' : 'drop-before'); else d.ol.classList.add('drop-end');
});
app.addEventListener('drop', (e) => {
  const d = dragId && dropAt(e), id = dragId;
  clearDrop();
  if (!d) return;
  e.preventDefault();
  setBuckets((b) => { const list = b.apps[d.bucket] || [], was = list.indexOf(id); return moveApp(b, id, d.bucket, was >= 0 && was < d.at ? d.at - 1 : d.at); });
});
app.addEventListener('change', (e) => {
  const sel = e.target.closest?.('select[data-a="app-bucket"]');
  if (!sel) return;
  const id = sel.closest('li').dataset.id;
  setBuckets((b) => moveApp(b, id, sel.value), [id, 'app-bucket']);
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
  <section><h2>Apps</h2><div class="group apps">
    ${eng.crafts.map((c) => row(APP_ICON[c.id] || 'layers', esc(c.name), `${esc(c.role)}${c.version ? ` · ${esc(c.version)}` : ''}`, c.app ? `<button class="btn" data-a="app" data-id="${c.id}">Open</button>` : absent)).join('')}
  </div></section>
  ${bucketsSection()}
  <section><h2>Built-in engines</h2>
  <div class="group">
    ${eng.crafts.some((c) => c.artcraft !== false) ? row('cube', 'ArtCraft engines', eng.crafts.filter((c) => c.artcraft !== false).map((c) => c.name.replace('Craft', '')).join(' · '), `<span class="dot ${eng.crafts.filter((c) => c.artcraft !== false).every((c) => c.bundled) ? 'on' : ''}"></span>`) : ''}
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
  if (a === 'buckets-reset') setBuckets(null);
  if (a === 'app-up' || a === 'app-down') {
    const li = e.target.closest('li'), id = li.dataset.id, k = li.dataset.bucket;
    setBuckets((b) => moveApp(b, id, k, b.apps[k].indexOf(id) + (a === 'app-up' ? -1 : 1)), [id, a]);
  }
  if (a === 'app-hide') {
    const id = e.target.closest('li').dataset.id;
    setBuckets((b) => { b.hidden = b.hidden.includes(id) ? b.hidden.filter((x) => x !== id) : [...b.hidden, id]; }, [id, a]);
  }
  if (a === 'bucket-up' || a === 'bucket-down') {
    const k = e.target.closest('.bucket-col').dataset.bucket;
    setBuckets((b) => { const i = b.order.indexOf(k), j = i + (a === 'bucket-up' ? -1 : 1); if (j < 0 || j >= b.order.length) return false; b.order.splice(i, 1); b.order.splice(j, 0, k); }, [k, a]);
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
