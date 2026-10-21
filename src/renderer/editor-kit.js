import { $, esc, h, nameOf } from './ui.js';

export function setDocName(root, file) {
  document.title = nameOf(file);
  const b = $('.topbar .doc b', root);
  if (b) { b.textContent = nameOf(file); b.title = file; }
}

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
export async function offerRestore(rec, file) {
  const when = new Date(rec.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (await ask('Restore unsaved edits?', `Lime kept the changes made to ${nameOf(file)} at ${when}, which were never saved.`, [['restore', 'Restore', 'primary'], ['discard', 'Discard']])) === 'restore';
}
