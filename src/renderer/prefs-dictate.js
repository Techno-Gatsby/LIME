// Settings › Dictation: the shortcut, language, tidying, and the personal dictionary.
import { icon } from './icons.js';
import { api, esc } from './ui.js';

const isMac = api.platform === 'darwin';
const keyName = (a) => (isMac ? a.replace(/Control\+/g, '⌃').replace(/Alt\+|Option\+/g, '⌥').replace(/Shift\+/g, '⇧').replace(/(Command|Cmd|Super|Meta)\+/g, '⌘') : a.replace(/Control\+/g, 'Ctrl+').replace(/Super\+/g, 'Win+'));
const kbd = (a) => keyName(a).split(isMac ? /(?<=[⌃⌥⇧⌘])/ : '+').map((k) => `<kbd>${esc(k)}</kbd>`).join('');
const CSS = `.dict-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px 4px; }
  .dict-chips:empty { display: none; }
  .dict-chip { display: inline-flex; align-items: center; gap: 2px; height: 24px; padding: 0 4px 0 10px; border-radius: 12px; background: var(--surface-3); font-size: 12px; font-weight: 500; }
  .dict-chip .btn { width: 20px; height: 20px; min-width: 0; padding: 0; border-radius: 50%; }
  .dict-add { display: flex; gap: 8px; padding: 8px 14px 12px; align-items: center; }
  .dict-add .input { flex: 1; }
  .dict-add .arrow { color: var(--ink-3); }
  .row kbd + kbd { margin-left: 3px; }
  .rec { box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 3px var(--ring); }`;
document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));

let info = null;
const sw = (k, on) => `<label class="switch"><input type="checkbox" data-dk="${k}" ${on ? 'checked' : ''}></label>`;
const row = (ic, title, sub, ctl) => `<div class="row">${ic ? icon(ic, '').replace('class="ic', 'class="ic lead') : ''}<div class="t"><b>${title}</b>${sub ? `<small class="why">${sub}</small>` : ''}</div>${ctl || ''}</div>`;

export async function html() {
  info = await api.invoke('dictate:info').catch(() => null);
  if (!info) return '';
  const d = info, langs = Object.entries(d.langs);
  const keyNote = !d.hotkeyOk ? 'Another app is using every shortcut Lime tried. Choose another.' : d.fellBack ? `${esc(keyName(d.hotkey))} is taken by another app, so Lime uses this one.` : d.hold && d.canHold ? 'Hold to talk and let go to finish, or tap to start and tap again to stop' : 'Press to start, press again to stop';
  return `<section id="dictation"><h2>Dictation</h2><p class="note">Speak and Lime types it out for you, on this ${isMac ? 'Mac' : 'PC'}. Nothing you say leaves it. You can also hold the lime in the wheel.</p><div class="group">
    ${row('mic', 'Shortcut', keyNote, `${d.hotkeyNow ? kbd(d.hotkeyNow) : '<span class="tag">None</span>'}<button class="btn" data-da="key">Change…</button>`)}
    ${d.canHold || d.platform !== 'linux' ? row('cursor', 'Hold to talk', 'Off: press once to start and again to stop', sw('hold', d.hold)) : ''}
    ${row('text', 'Language', d.translate ? 'Whatever you speak comes out in English' : '', `<div class="seg" data-dseg="lang">${langs.map(([v, l]) => `<button data-v="${v}" aria-pressed="${!d.translate && d.lang === v}">${l}</button>`).join('')}</div>`)}
    ${row('again', 'Give me English', 'Translates what you say into English', sw('translate', d.translate))}
    ${row('sparkle', 'Tidy up my words', 'Takes out “um” and repeats, adds capitals and full stops, and turns “comma” or “new line” into punctuation', sw('tidy', d.tidy))}
    ${row('copy', 'Copy when done', 'The text goes on the clipboard as soon as it’s ready', sw('autoCopy', d.autoCopy))}
    ${row('clock', 'Stop when I stop talking', 'After about one and a half seconds of quiet', sw('autoStop', d.autoStop))}
    ${row('mic', 'Try it', '', '<button class="btn primary" data-da="try">Dictate now</button>')}
  </div></section>
  <section><h2>Dictionary</h2><p class="note">Names and words Lime should listen for, such as Sobha, Hutchinson or RFI. When you fix a word before copying, Lime offers to add it here.</p><div class="group">
    <div class="dict-chips">${d.words.map((w, i) => `<span class="dict-chip">${esc(w)}<button class="btn subtle" data-da="unword" data-i="${i}" title="Remove" aria-label="Remove ${esc(w)}">${icon('close', 'sm')}</button></span>`).join('')}</div>
    <div class="dict-add"><input class="input" data-df="word" placeholder="Add a word or name" maxlength="60"><button class="btn" data-da="word">Add</button></div>
  </div></section>
  <section><h2>Always change</h2><p class="note">Fix words Lime hears wrongly, every time.</p><div class="group">
    ${d.replace.map(([a, b], i) => row('', `${esc(a)} <span class="faint">→</span> ${esc(b)}`, '', `<button class="btn subtle" data-da="unrep" data-i="${i}" title="Remove">${icon('close', 'sm')}</button>`)).join('')}
    <div class="dict-add"><input class="input" data-df="from" placeholder="sober realty" maxlength="80"><span class="arrow">→</span><input class="input" data-df="to" placeholder="Sobha Realty" maxlength="80"><button class="btn" data-da="rep">Add</button></div>
  </div></section>`;
}

const ACCEL_KEY = (e) => (e.code === 'Space' ? 'Space' : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^F\d{1,2}$/.test(e.code) ? e.code : null);
export function wire(root, rerender) {
  const save = async (patch) => { await api.invoke('settings:set', { dictation: { ...strip(info), ...patch } }); rerender(); };
  const strip = (d) => ({ hotkey: d.hotkey, hold: d.hold, lang: d.lang, translate: d.translate, tidy: d.tidy, autoCopy: d.autoCopy, autoStop: d.autoStop, words: d.words, replace: d.replace });
  let rec = null;
  root.addEventListener('change', (e) => { const k = e.target.dataset?.dk; if (k && info) save({ [k]: e.target.checked }); });
  root.addEventListener('keydown', (e) => {
    if (rec) {
      e.preventDefault();
      if (e.key === 'Escape') { rec = null; rerender(); return; }
      const k = ACCEL_KEY(e);
      if (!k) return;
      const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && (isMac ? 'Command' : 'Super')].filter(Boolean);
      if (!mods.length && !/^F\d/.test(k)) return;
      rec = null;
      save({ hotkey: [...mods, k].join('+') });
      return;
    }
    if (e.key === 'Enter' && e.target.dataset?.df) root.querySelector(`[data-da="${e.target.dataset.df === 'word' ? 'word' : 'rep'}"]`)?.click();
  });
  root.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-dseg] button');
    if (seg && info) { save({ lang: seg.dataset.v, translate: false }); return; }
    const b = e.target.closest('[data-da]');
    if (!b || !info) return;
    const a = b.dataset.da, val = (f) => root.querySelector(`[data-df="${f}"]`)?.value.trim();
    if (a === 'key') { rec = true; b.textContent = 'Press keys…'; b.classList.add('rec'); b.focus(); }
    if (a === 'try') api.invoke('dictate:start');
    if (a === 'word' && val('word')) save({ words: [...info.words.filter((w) => w.toLowerCase() !== val('word').toLowerCase()), val('word')] });
    if (a === 'unword') save({ words: info.words.filter((_, i) => i !== Number(b.dataset.i)) });
    if (a === 'rep' && val('from') && val('to')) save({ replace: [...info.replace.filter(([x]) => x.toLowerCase() !== val('from').toLowerCase()), [val('from'), val('to')]] });
    if (a === 'unrep') save({ replace: info.replace.filter((_, i) => i !== Number(b.dataset.i)) });
  });
}
