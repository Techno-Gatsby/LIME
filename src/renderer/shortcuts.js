import { $, esc, h } from './ui.js';

// One set of keys for every editor. Each editor registers the keys it has (Save, undo, zoom, its tool letters, and
// the ones it handles itself, for the list), and ? shows them all. A key is named as in a table: 'Mod+S' (Ctrl, or
// ⌘ on a Mac), 'Mod+Shift+Z', 'Escape', 'Plus', 'V', 'Space', 'ArrowLeft'.
const isMac = window.lime?.platform === 'darwin';
const NAMED = { ' ': 'Space', '+': 'Plus', '=': 'Plus', '-': 'Minus', '_': 'Minus' };
export function keyOf(e) {
  let k = e.key;
  if (k in NAMED) k = NAMED[k];
  else if (k.length === 1) k = k.toUpperCase();
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Mod');
  if (e.altKey) mods.push('Alt');
  // Shift names letters and special keys; ? and + are already the shifted key.
  if (e.shiftKey && (/^[A-Z0-9]$/.test(k) || k.length > 1)) mods.push('Shift');
  return [...mods, k].join('+');
}
const SHOW = { Mod: isMac ? '⌘' : 'Ctrl', Shift: isMac ? '⇧' : 'Shift', Alt: isMac ? '⌥' : 'Alt', Plus: '+', Minus: '−', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Backspace: isMac ? '⌫' : 'Backspace', Enter: isMac ? '↩' : 'Enter', Space: 'Space' };
const kbd = (combo) => combo.split('+').map((p) => `<kbd class="k">${esc(SHOW[p] || p)}</kbd>`).join('');

// A row of the table: keys (one, or several that do the same), what it does, and what runs (none when the editor
// handles the key itself and only wants it listed). `always` keys work while typing in a field too (Save, Close).
export const key = (keys, label, run = null, o = {}) => ({ keys: [keys].flat(), label, run, ...o });
// The letters that pick tools mean the same in every editor.
export const TOOL_KEYS = { V: 'Select', E: 'Edit text', T: 'Text', X: 'Erase', N: 'Note', H: 'Mark up', P: 'Draw', R: 'Box', O: 'Oval', A: 'Arrow', L: 'Line', M: 'Measure', C: 'Crop', K: 'Mask', J: 'Heal', Y: 'Red eye', D: 'Adjust', B: 'Razor' };
export const toolKeys = (map, pick) => Object.entries(map).map(([k, id]) => key(k.toUpperCase(), TOOL_KEYS[k.toUpperCase()] || id, () => pick(id)));

export const helpIcon = (size = '') => `<svg class="ic ${size}" viewBox="0 0 24 24" width="${size === 'sm' ? 16 : 20}" height="${size === 'sm' ? 16 : 20}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 100-18 9 9 0 000 18zM9.6 9.4a2.5 2.5 0 014.9.6c0 1.7-2.5 2-2.5 3.6M12 17h.01"/></svg>`;
export const helpButton = () => `<button class="tb icon" data-a="help" title="Keyboard shortcuts (?)">${helpIcon()}</button>`;

// groups: [[name, [key(...), ...]], ...]. `typing()` says when the editor is in a text being edited on the page.
export function shortcuts(groups, { typing = () => false } = {}) {
  const map = new Map();
  for (const [, items] of groups) for (const it of items) if (it.run) for (const c of it.keys) map.set(c, it);
  const inField = (e) => !!(e.target.matches?.('input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select') || e.target.isContentEditable || typing());
  const onKey = (e) => {
    const k = keyOf(e), it = map.get(k);
    if (document.querySelector('.scrim, .popmenu')) return;
    if (k === '?' && !inField(e)) { e.preventDefault(); e.stopImmediatePropagation(); help(); return; }
    if (!it || (inField(e) && !it.always)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    it.run(e);
  };
  // Before the editor's own listeners, so a key taken here is not also taken there.
  document.addEventListener('keydown', onKey, true);
  function help() {
    const s = h(`<div class="scrim keys"><div class="dialog keys" role="dialog" aria-modal="true" aria-labelledby="keysT"><div class="body"><h2 id="keysT">Keyboard shortcuts</h2><div class="keycols">${groups.map(([name, items]) => `<section><h3>${esc(name)}</h3>${items.map((it) => `<div class="krow"><span>${esc(it.label)}</span><span class="kk">${it.keys.map(kbd).join('<i>or</i>')}</span></div>`).join('')}</section>`).join('')}</div></div>
      <div class="foot"><span class="tip grow">Press ? any time to see these.</span><button class="btn primary" data-a="ok">Done</button></div></div></div>`);
    document.body.append(s);
    const close = () => s.remove();
    s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-a=ok]')) close(); });
    s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' || e.key === '?' || e.key === 'Enter') { e.preventDefault(); close(); } });
    $('[data-a=ok]', s).focus();
  }
  return { help, groups, dispose: () => document.removeEventListener('keydown', onKey, true) };
}
