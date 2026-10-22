import { icon } from './icons.js';
import { api, $, esc, applyTheme } from './ui.js';

await applyTheme();
const panel = $('.panel'), stateEl = $('.state'), hintEl = $('.hint'), textEl = $('.text'), heardEl = $('.heard'), learnEl = $('.learn'), wave = $('.wave');
const btn = { stop: $('.stop'), again: $('.again'), paste: $('.paste'), copy: $('.copy'), lang: $('.lang'), x: $('.x') };
const isMac = api.platform === 'darwin';
btn.x.innerHTML = icon('close', 'sm');
btn.copy.innerHTML = `${icon('copy', 'sm')}Copy`;
btn.paste.innerHTML = `${icon('paste', 'sm')}Paste`;
btn.again.innerHTML = `${icon('again', 'sm')}Again`;
btn.paste.title = `Paste into the app you were using (${isMac ? '⌘V' : 'Ctrl+V'})`;
for (let i = 0; i < 40; i++) wave.append(document.createElement('i'));
const bars = [...wave.children];

const S = { id: null, state: 'idle', text: '', raw: '', lang: 'auto', translate: false, langs: { auto: 'Auto' }, hotkey: '', levels: [] };
const ORDER = [['auto', false], ['en', false], ['hi', false], ['ar', false], ['auto', true]];
const keyName = (a) => (isMac ? a.replace(/Control\+/g, '⌃').replace(/Alt\+|Option\+/g, '⌥').replace(/Shift\+/g, '⇧').replace(/(Command|Cmd|CommandOrControl)\+/g, '⌘') : a.replace(/Control\+/g, 'Ctrl+'));
const rtl = (t) => /[֐-ࣿ]/.test(t);
const langLabel = () => (S.translate ? 'Give me English' : S.langs[S.lang] || 'Auto');

function setState(state, hint = '') {
  S.state = state;
  panel.dataset.state = state;
  stateEl.textContent = { listening: 'Listening', tidying: 'Tidying…', done: 'Done', copied: 'Copied', pasted: 'Pasted', error: 'Can’t listen' }[state] || 'Ready';
  hintEl.textContent = hint;
  const after = ['done', 'copied', 'pasted'].includes(state);
  btn.stop.hidden = state !== 'listening';
  btn.copy.hidden = btn.paste.hidden = !after;
  btn.again.hidden = !(after || state === 'error');
  btn.copy.disabled = btn.paste.disabled = after && !S.text;
  textEl.contentEditable = after && S.text ? 'plaintext-only' : 'false';
  if (state !== 'listening') { quiet(); stopMic(); }
}
const quiet = () => { $('.orb').style.setProperty('--lv', 0); bars.forEach((b) => { b.style.height = '3px'; }); };
btn.lang.textContent = langLabel();

let mic = null;
async function startMic(id) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    if (S.id !== id || S.state !== 'listening') { stream.getTracks().forEach((t) => t.stop()); return; }
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule('dictate-worklet.js');
    const src = ctx.createMediaStreamSource(stream), node = new AudioWorkletNode(ctx, 'lime-gather'), mute = ctx.createGain();
    mute.gain.value = 0;
    node.port.onmessage = (e) => { if (S.id === id && S.state === 'listening') api.invoke('dictate:audio', id, e.data); };
    src.connect(node).connect(mute).connect(ctx.destination);
    mic = { stream, ctx };
  } catch (e) { api.invoke('dictate:micError', id, e.name || 'Error'); }
}
function stopMic() { if (!mic) return; mic.stream.getTracks().forEach((t) => t.stop()); mic.ctx.close().catch(() => {}); mic = null; }

function showLive(p) {
  const head = [p.committed, p.stable].filter(Boolean).join(' ');
  textEl.dir = rtl(head + p.tail) ? 'rtl' : 'auto';
  textEl.innerHTML = head || p.tail ? `${esc(head)}${p.tail ? `${head ? ' ' : ''}<span class="tail">${esc(p.tail)}</span>` : ''}` : '<span class="ghost">Start speaking…</span>';
  textEl.scrollTop = textEl.scrollHeight;
}

api.on('dictate:begin', (b) => {
  Object.assign(S, { id: b.id, text: '', raw: '', lang: b.lang, translate: b.translate, langs: b.langs, hotkey: b.hotkey, levels: [] });
  btn.lang.textContent = langLabel();
  textEl.dir = 'auto';
  textEl.innerHTML = '<span class="ghost">Start speaking…</span>';
  heardEl.hidden = learnEl.hidden = true;
  setState('listening', b.hotkey ? `${b.hold ? 'Hold or press' : 'Press'} ${keyName(b.hotkey)}, or Stop, to finish` : 'Press Stop to finish');
  if (b.source === 'mic') startMic(b.id);
});
api.on('dictate:level', (m) => {
  if (S.state !== 'listening' || m.id !== S.id) return;
  const lv = Math.min(1, Math.sqrt(m.rms) * 2.4);
  $('.orb').style.setProperty('--lv', lv.toFixed(3));
  S.levels.push(lv);
  if (S.levels.length > bars.length) S.levels.shift();
  const pad = bars.length - S.levels.length;
  bars.forEach((b, i) => { const v = S.levels[i - pad] || 0; b.style.height = `${Math.round(3 + v * 22)}px`; });
});
api.on('dictate:partial', (p) => { if (p.id === S.id && S.state === 'listening') showLive(p); });
api.on('dictate:state', (m) => {
  if (m.state === 'error') {
    setState('error');
    textEl.dir = 'auto';
    textEl.innerHTML = `<span class="error-msg">${esc(m.message)}</span>`;
    if (/microphone/i.test(m.message) && /Settings/.test(m.message)) { learnEl.hidden = false; learnEl.innerHTML = '<button class="btn" data-a="mic">Open microphone settings</button>'; }
  } else setState(m.state);
});
api.on('dictate:done', (d) => {
  if (d.id !== S.id) return;
  Object.assign(S, { text: d.text, raw: d.raw, lang: S.lang });
  textEl.dir = rtl(d.text) ? 'rtl' : 'auto';
  if (d.text) textEl.textContent = d.text; else textEl.innerHTML = '<span class="ghost">Didn’t catch anything. Try again a little closer to the microphone.</span>';
  const plain = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  heardEl.hidden = !d.raw || plain(d.raw) === plain(d.text);
  heardEl.innerHTML = `<b>Heard:</b> ${esc(d.raw)}`;
  heardEl.title = d.raw;
  const took = d.ms != null ? `${(d.ms / 1000).toFixed(1)} s` : '';
  setState(d.copied ? 'copied' : 'done', d.text ? (d.copied ? `On the clipboard${took ? ` · ${took}` : ''}. Edit it, or paste anywhere` : 'Edit the text, then copy it') : '');
  if (d.text && !d.copied) btn.copy.focus({ preventScroll: true });
});

// Words the user fixed before copying can go into the dictionary, so they come out right next time.
function offerLearning() {
  const now = textEl.innerText.trim();
  if (!S.text || now === S.text) return;
  const a = S.text.split(/\s+/), b = now.split(/\s+/);
  let i = 0, j = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const strip = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const from = a.slice(i, a.length - j).map(strip).filter(Boolean).join(' '), to = b.slice(i, b.length - j).map(strip).filter(Boolean).join(' ');
  if (!to || to.split(' ').length > 4 || from.split(' ').length > 4) return;
  const names = to.split(' ').filter((w) => /\p{Lu}|\d/u.test(w.slice(1)) || /^\p{Lu}/u.test(w));
  if (!names.length && !from) return;
  learnEl.hidden = false;
  learnEl.innerHTML = `<span>Add “${esc(to)}” to your dictionary?</span><button class="btn" data-a="learn">Add</button><button class="btn subtle" data-a="nolearn">No</button>`;
  learnEl.dataset.to = to;
  learnEl.dataset.from = from;
}
async function copy() {
  const t = textEl.innerText.trim();
  if (!t) return;
  await api.invoke('dictate:copy', t);
  offerLearning();
  setState('copied', `Paste it anywhere with ${isMac ? '⌘V' : 'Ctrl+V'}`);
}
async function paste() {
  const t = textEl.innerText.trim();
  if (!t) return;
  offerLearning();
  const r = await api.invoke('dictate:paste', t);
  setState(r.ok ? 'pasted' : 'copied', r.ok ? '' : r.message);
}
btn.copy.addEventListener('click', copy);
btn.paste.addEventListener('click', paste);
btn.stop.addEventListener('click', () => api.invoke('dictate:stop'));
btn.again.addEventListener('click', () => api.invoke('dictate:start'));
btn.x.addEventListener('click', () => api.invoke('dictate:close'));
btn.lang.addEventListener('click', async () => {
  const i = ORDER.findIndex(([l, t]) => l === S.lang && t === S.translate);
  [S.lang, S.translate] = ORDER[(i + 1) % ORDER.length];
  btn.lang.textContent = langLabel();
  await api.invoke('dictate:lang', S.lang, S.translate);
  if (S.state !== 'listening') hintEl.textContent = `${langLabel()} from the next take. Press Again`;
});
learnEl.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'mic') api.invoke('dictate:micSettings');
  if (a === 'learn') { const { to, from } = learnEl.dataset; await api.invoke('dictate:learn', { words: [to], replace: from && from.toLowerCase() !== to.toLowerCase() ? [[from, to]] : [] }); learnEl.innerHTML = `<span>Added “${esc(to)}”.</span>`; }
  if (a === 'nolearn') learnEl.hidden = true;
});
textEl.addEventListener('pointerdown', () => { if (textEl.isContentEditable && document.activeElement !== textEl) api.invoke('dictate:focus').then(() => textEl.focus()); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); api.invoke('dictate:close'); }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); copy(); }
});
window.__dictate = { S, copy, paste, setState };
