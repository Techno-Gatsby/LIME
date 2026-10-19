// The wheel that pops up at the mouse pointer from File Explorer (right-click › Convert with Clementine, or Ctrl+Shift+Space).
import { icon } from './icons.js';
import { createWheel } from './wheel.js';
import { api, h, esc, nameOf, thumbEl, runPick } from './common.js';

const [data, info, settings, catalog] = await Promise.all([api.invoke('overlay:data'), api.invoke('app:info'), api.invoke('settings:get'), api.invoke('catalog')]);
document.documentElement.dataset.theme = settings.theme !== 'system' ? settings.theme : (info.dark ? 'dark' : 'light');
document.documentElement.style.setProperty('--accent', info.accent);
if (!data) api.invoke('overlay:close');

const holder = h(`<div class="ov-holder"></div>`);
const x = Math.min(Math.max(data.x, 215), innerWidth - 215), y = Math.min(Math.max(data.y, 260), innerHeight - 260);
Object.assign(holder.style, { left: `${x}px`, top: `${y}px` });
document.body.append(holder);
const chip = h(`<div class="ov-file"></div>`);
chip.append(thumbEl(data.files[0], icon, 26), h(`<span>${esc(data.files.length === 1 ? nameOf(data.files[0]) : `${data.files.length} files`)}</span>`));
const wheel = createWheel(holder, { keys: settings.keys, mode: 'click', onPick: pick, onCancel: () => api.invoke('overlay:close'), centerHint: 'Pick a slice' });
holder.prepend(chip);
wheel.setItems(data.wheels);
wheel.setGroup('convert');

document.addEventListener('keydown', (e) => { if (!card) wheel.onKey(e); else if (e.key === 'Escape') api.invoke('overlay:close'); });
document.addEventListener('pointermove', (e) => { if (!card) wheel.hoverAt(e.clientX, e.clientY); });
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.qw, .ov-card, .ov-file')) api.invoke('overlay:close'); });

let card = null;
async function pick(item) {
  const r = await runPick(item, data.files, catalog);
  if (r.navigate) { await api.invoke('main:show', { route: 'tool', ...r.navigate }); api.invoke('overlay:close'); return; }
  if (r.message) { showCard(r.message, true); setTimeout(() => api.invoke('overlay:close'), 1400); return; }
  if (!r.jobId) { api.invoke('overlay:close'); return; }
  api.invoke('overlay:keep', true);
  holder.remove();
  card = h(`<div class="ov-card" style="left:${x}px;top:${y}px"><b>${esc(r.tool.name)}</b><div class="progress indeterminate"><i></i></div><small class="muted">Starting…</small><div class="acts"><button class="btn subtle" data-a="bg">Run in background</button></div></div>`);
  document.body.append(card);
  card.querySelector('[data-a=bg]').addEventListener('click', () => api.invoke('overlay:close'));
  api.on('jobs', (list) => {
    const j = list.find((z) => z.id === r.jobId);
    if (!j) return;
    const bar = card.querySelector('.progress');
    if (j.status === 'running') { bar.classList.toggle('indeterminate', !j.progress); bar.querySelector('i').style.width = `${Math.round(j.progress * 100)}%`; card.querySelector('small').textContent = `${j.label || 'Working'} · ${Math.round(j.progress * 100)}%`; }
    if (j.status === 'done') {
      const outs = j.results.flatMap((z) => z.paths || (z.path ? [z.path] : []));
      const note = j.results.map((z) => z.note).filter(Boolean)[0];
      card.innerHTML = `<div style="display:flex;gap:10px;align-items:center">${icon('check')}<b>Done</b></div><small class="muted">${esc(outs.length === 1 ? nameOf(outs[0]) : `${outs.length} files`)}${note && !note.includes('\n') ? ` · ${esc(note)}` : ''}</small><div class="acts">${outs[0] ? '<button class="btn primary" data-a="open">Open</button><button class="btn" data-a="show">Show in folder</button>' : ''}<button class="btn subtle" data-a="close">Close</button></div>`;
      card.querySelector('.ic').style.color = 'var(--success)';
      card.onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'open') api.invoke('shell:open', outs[0]); if (a === 'show') api.invoke('shell:show', outs[0]); if (a) api.invoke('overlay:close'); };
      setTimeout(() => api.invoke('overlay:close'), 8000);
    }
    if (j.status === 'error' || j.status === 'cancelled') {
      card.innerHTML = `<b>Couldn’t finish</b><small>${esc(j.error)}</small><div class="acts">${j.code === 'ENGINE_MISSING' ? '<button class="btn primary" data-a="settings">Open settings</button>' : ''}<button class="btn" data-a="close">Close</button></div>`;
      card.onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'settings') api.invoke('main:show', { route: 'settings' }); if (a) api.invoke('overlay:close'); };
    }
  });
}
function showCard(msg) {
  holder.remove();
  card = h(`<div class="ov-card" style="left:${x}px;top:${y}px"><div style="display:flex;gap:10px;align-items:center">${icon('check')}<span>${esc(msg)}</span></div></div>`);
  document.body.append(card);
}
