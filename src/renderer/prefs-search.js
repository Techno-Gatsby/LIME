// The search box at the top of Settings: hides the sections and rows that don't match as you type.
import { icon } from './icons.js';

// Words people use for a setting that its label doesn't say.
const ALSO = {
  appearance: 'dark light theme mode colour', size: 'big small large wheel', 'open at login': 'startup start boot launch',
  'show or hide the wheel': 'shortcut hotkey keyboard', 'ask where to save': 'save as dialog folder', updates: 'update upgrade new version download',
  'check once a day': 'update automatic auto', 'float above windows': 'on top always', sounds: 'audio mute quiet', libreoffice: 'office word excel powerpoint',
  'open-source licences': 'license licenses legal', 'reset position': 'move place corner', icon: 'picture logo avatar',
};
const CSS = `.prefs-search { position: sticky; top: 0; z-index: 5; padding: 6px 22px 12px; background: linear-gradient(var(--bg) 75%, transparent); max-width: 620px; margin: 0 auto; box-sizing: border-box; }
  .prefs-search label { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; border-radius: 8px; background: color-mix(in srgb, var(--surface) 92%, transparent); box-shadow: var(--shadow-sm); color: var(--ink-3); }
  .prefs-search label:focus-within { box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow-sm); }
  .prefs-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: inherit; color: var(--ink); }
  .prefs-search input::-webkit-search-cancel-button { display: none; }
  .prefs-search kbd { flex: none; }
  .prefs-search .clear { border: 0; background: none; color: var(--ink-3); padding: 2px; cursor: pointer; display: grid; place-items: center; border-radius: 4px; }
  .prefs-empty { text-align: center; color: var(--ink-2); padding: 28px 0; }
  #app .row.lead-shown::before { display: none; }
  #app [hidden] { display: none !important; }`;

const norm = (t) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '');
const textOf = (el) => { const t = norm(el.querySelector('.t b, .n')?.textContent || el.textContent); return `${t} ${norm(el.querySelector('.t small')?.textContent || '')} ${ALSO[t.trim()] || ''}`; };

export function wireSearch(app) {
  const mac = navigator.platform.startsWith('Mac');
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  const bar = Object.assign(document.createElement('div'), { className: 'prefs-search' });
  bar.innerHTML = `<label>${icon('search', 'sm')}<input type="search" placeholder="Search settings" aria-label="Search settings" spellcheck="false"><button class="clear" hidden aria-label="Clear search" title="Clear">${icon('close', 'sm')}</button><kbd>${mac ? '⌘' : 'Ctrl+'}F</kbd></label>`;
  app.before(bar);
  const input = bar.querySelector('input'), clear = bar.querySelector('.clear'), kbd = bar.querySelector('kbd');
  let busy = false;
  function apply() {
    busy = true;
    const words = norm(input.value).split(/\s+/).filter(Boolean);
    clear.hidden = !words.length;
    kbd.hidden = !!words.length;
    app.querySelector('.prefs-empty')?.remove();
    let any = false;
    for (const sec of app.querySelectorAll(':scope > section')) {
      const head = norm(`${sec.querySelector('h2')?.textContent || ''} ${sec.querySelector('.note')?.textContent || ''}`);
      const all = !words.length || words.every((w) => head.includes(w));
      const items = [...sec.querySelectorAll('.row, .ring-col li')];
      let shown = 0;
      for (const el of items) { const ok = all || words.every((w) => textOf(el).includes(w)); el.hidden = !ok; if (ok) shown++; }
      for (const g of sec.querySelectorAll('.group')) { const first = [...g.querySelectorAll(':scope > .row')].find((r) => !r.hidden); g.querySelectorAll('.lead-shown').forEach((r) => r.classList.remove('lead-shown')); first?.classList.add('lead-shown'); }
      sec.querySelectorAll('.ring-col').forEach((c) => { c.hidden = !all && ![...c.querySelectorAll('li')].some((l) => !l.hidden); });
      sec.querySelectorAll('.note, .rings-foot').forEach((n) => { n.hidden = !all; });
      sec.hidden = !all && !shown;
      if (!sec.hidden) any = true;
    }
    app.querySelector(':scope > header')?.toggleAttribute('hidden', !!words.length);
    if (!any) app.append(Object.assign(document.createElement('p'), { className: 'prefs-empty', textContent: `No settings match “${input.value.trim()}”` }));
    queueMicrotask(() => { busy = false; });
  }
  input.addEventListener('input', apply);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; apply(); } });
  clear.addEventListener('click', () => { input.value = ''; apply(); input.focus(); });
  document.addEventListener('keydown', (e) => { if ((mac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); input.focus(); input.select(); } });
  // Settings redraw themselves when anything changes; the filter follows.
  new MutationObserver(() => { if (!busy && input.value) apply(); }).observe(app, { childList: true });
  return { apply, input };
}
