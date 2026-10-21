import { $, esc, h, nameOf } from './ui.js';

// Small things every editor does the same way: the file's name in the window, the questions it asks, what it
// remembers between files, and the copy of unsaved edits it keeps in case the window goes.

// The file's name in the window title and the top bar: after Save as…, the new one.
export function setDocName(root, file) {
  document.title = nameOf(file);
  const b = $('.topbar .doc b', root);
  if (b) { b.textContent = nameOf(file); b.title = file; }
}

// A question with its answers as buttons; resolves with the key of the one chosen (Escape picks the last).
export function ask(title, text, buttons) {
  return new Promise((resolve) => {
    const s = h(`<div class="scrim"><div class="dialog" role="dialog" aria-modal="true"><div class="body"><h2>${esc(title)}</h2><p class="muted" style="margin:0">${esc(text)}</p></div><div class="foot">${buttons.map(([k, label, cls]) => `<button class="btn ${cls || ''}" data-a="${esc(k)}">${esc(label)}</button>`).join('')}</div></div></div>`);
    document.body.append(s);
    const done = (k) => { s.remove(); resolve(k); };
    $('.btn.primary', s)?.focus();
    s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) done(a); });
    s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(buttons[buttons.length - 1][0]); });
  });
}
export const confirm3 = (title, text) => ask(title, text, [['save', 'Save', 'primary'], ['discard', 'Don’t save'], ['cancel', 'Cancel']]);

// What an editor keeps for the next file of its kind (the last tool, zoom and side panel), in Settings.
export function remember(api, settings, kind) {
  const all = () => (settings()?.editors || {});
  let t = null, patch = {};
  return {
    get: (k) => all()[kind]?.[k],
    set(p) {
      Object.assign(patch, p);
      clearTimeout(t);
      t = setTimeout(() => { const cur = all(); api.invoke('settings:set', { editors: { ...cur, [kind]: { ...cur[kind], ...patch } } }).catch(() => {}); patch = {}; }, 400);
    },
  };
}

// Unsaved edits go to a recovery file in the user folder every two minutes, and are offered back when the same file
// is opened again. `collect()` gives null when nothing is unsaved, else { sig, meta, data?, ext? }: `sig` tells
// whether anything changed since the last copy, `data()` gives bytes to keep beside the JSON when they have.
export function recovery(api, file, collect, every = 120000) {
  let last = '', busy = false;
  async function now() {
    if (busy) return false;
    busy = true;
    try {
      const got = await collect();
      if (!got) { if (last) { last = ''; await api.invoke('recover:drop', file); } return false; }
      if (got.sig === last) return false;
      const bytes = got.data ? await got.data() : null;
      const r = await api.invoke('recover:save', file, got.meta, bytes, got.ext || null);
      if (got.after) await got.after(r);
      last = got.sig;
      return true;
    } catch (_) { return false; } finally { busy = false; }
  }
  const timer = setInterval(now, every);
  const r = { now, check: () => api.invoke('recover:load', file).catch(() => null), drop: () => { last = ''; return api.invoke('recover:drop', file).catch(() => {}); }, dispose: () => clearInterval(timer) };
  window.__recovery = r;
  return r;
}
// Whether to bring back what the recovery file holds.
export async function offerRestore(rec, file) {
  const when = new Date(rec.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (await ask('Restore unsaved edits?', `Lime kept the changes made to ${nameOf(file)} at ${when}, which were never saved.`, [['restore', 'Restore', 'primary'], ['discard', 'Discard']])) === 'restore';
}
