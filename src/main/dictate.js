'use strict';
// Dictate: press the hotkey (or hold the lime), speak, and a small panel shows the words as they come.
// When you stop, the text is tidied and ready to copy or paste into the app you were in.
const { BrowserWindow, ipcMain, globalShortcut, screen, clipboard, systemPreferences, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const { tidy, replaceAll } = require('./engines/tidy');
const native = require('./dictate-native');

const isMac = process.platform === 'darwin', isWin = process.platform === 'win32';
// Tests only: Chromium plays a WAV file as the microphone, so the real capture path runs.
if (process.env.LIME_FAKE_MIC && !require('electron').app.isPackaged) {
  const { app } = require('electron');
  for (const s of ['use-fake-ui-for-media-stream', 'use-fake-device-for-media-stream']) app.commandLine.appendSwitch(s);
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', `${process.env.LIME_FAKE_MIC}%noloop`);
}
const HOTKEYS = isMac ? ['Alt+Space', 'Alt+Shift+Space', 'Control+Alt+D'] : ['Control+Shift+Space', 'Control+Alt+Space', 'Control+Alt+D'];
const DEFAULTS = { hotkey: HOTKEYS[0], hold: true, lang: 'auto', translate: false, tidy: true, autoCopy: true, autoStop: false, words: [], replace: [] };
const LANGS = { auto: 'Auto', en: 'English', hi: 'Hindi', ar: 'Arabic' };
const W = 460, H = 268;
let D = null, win = null, worker = null, seq = 0, cur = null, hot = { accel: '', ok: false }, holdT = null, warmed = false;
const conf = () => ({ ...DEFAULTS, ...(D.settings().dictation || {}) });
const send = (ch, p) => { if (win && !win.isDestroyed()) win.webContents.send(ch, p); };

function vadModel() {
  if (process.env.LIME_VAD_MODEL && fs.existsSync(process.env.LIME_VAD_MODEL)) return Promise.resolve(process.env.LIME_VAD_MODEL);
  return require('./helpers').ensure('vad', D.vendor, D.helperRoot()).catch((e) => { D.log(e); return null; });
}
async function getWorker() {
  if (worker) return worker;
  const vad = await vadModel();
  if (worker) return worker;
  const w = fork(path.join(__dirname, 'dictate-worker.js'), [], { execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced' });
  let err = '';
  w.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  w.on('message', onWorker);
  w.on('error', (e) => { D.log(e); fail(e.message); });
  w.on('exit', (code) => { if (worker === w) { worker = null; warmed = false; } if (code) D.log(`dictation process ended (${code}): ${err.trim().split('\n').slice(-3).join(' ')}`); if (cur && !cur.done) fail('Dictation stopped unexpectedly. Try again.'); });
  w.send({ type: 'init', cfg: D.cfg(), vad, engine: !D.app.isPackaged && process.env.LIME_WHISPER_ENGINE ? process.env.LIME_WHISPER_ENGINE : null });
  worker = w;
  return w;
}
// Load the models a moment before they are needed, so the first words show quickly.
const modelFor = (c) => (c.lang === 'hi' || c.translate ? 'small' : 'base');
async function warm() { if (warmed) return; warmed = true; (await getWorker()).send({ type: 'warm', model: modelFor(conf()) }); }

function onWorker(m) {
  if (m.type === 'warm' || !cur || m.id !== cur.id) return;
  if (m.type === 'level') send('dictate:level', m);
  else if (m.type === 'partial') { cur.partial = m; send('dictate:partial', m); cur.onPartial?.(m); }
  else if (m.type === 'autostop') stop();
  else if (m.type === 'error') fail(m.message);
  else if (m.type === 'final') done(m);
}
function fail(message) {
  if (!cur) return;
  cur.done = true;
  cur.error = message;
  clearInterval(cur.feedT);
  send('dictate:state', { state: 'error', message });
}
async function done(m) {
  const c = conf();
  const text = c.tidy ? tidy(m.raw, { lang: m.lang, replace: c.replace }) : replaceAll(m.raw, c.replace);
  Object.assign(cur, { done: true, raw: m.raw, text, lang: m.lang, ms: m.ms, secs: m.secs });
  const copied = !!text && c.autoCopy;
  // Electron's clipboard is asynchronous: the text is on it before the panel says “Copied”.
  if (copied) await clipboard.writeText(text).catch(() => {});
  send('dictate:done', { id: cur.id, raw: m.raw, text, lang: m.lang, ms: m.ms, secs: m.secs, copied });
  cur.onDone?.(cur);
}

function place() {
  const wr = D.wheelRect?.();
  const pt = wr ? { x: wr.x + wr.width / 2, y: wr.y + wr.height / 2 } : screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  let x = Math.round(wa.x + (wa.width - W) / 2), y = Math.round(wa.y + wa.height - H - 40);
  if (wr) {
    x = Math.round(wr.x + wr.width / 2 - W / 2);
    y = wr.y + wr.height + H + 8 <= wa.y + wa.height ? wr.y + wr.height + 8 : wr.y - H - 8;
  }
  win.setBounds({ x: Math.min(Math.max(x, wa.x + 8), wa.x + wa.width - W - 8), y: Math.min(Math.max(y, wa.y + 8), wa.y + wa.height - H - 8), width: W, height: H });
}
function panel() {
  if (win && !win.isDestroyed()) return Promise.resolve(win);
  win = new BrowserWindow({
    width: W, height: H, show: false, frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, focusable: isMac, backgroundColor: '#00000000', title: 'Lime dictation', roundedCorners: false,
    ...(isMac ? { type: 'panel' } : {}), webPreferences: D.webPrefs,
  });
  win.setAlwaysOnTop(true, D.topLevel);
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.on('closed', () => { win = null; if (cur && !cur.done) cancel(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.env.LIME_SHOTS || process.env.LIME_UI) win.webContents.on('console-message', (e) => console.log('[dictate]', e.message ?? e));
  return new Promise((ok) => { win.webContents.once('did-finish-load', () => ok(win)); win.loadURL('app://local/dictate.html'); });
}

async function micAllowed() {
  if (!isMac) return true;
  const s = systemPreferences.getMediaAccessStatus('microphone');
  if (s === 'granted') return true;
  if (s === 'not-determined') return systemPreferences.askForMediaAccess('microphone');
  return false;
}

// source: 'mic', or { pcm: Float32Array at 16 kHz, speed } to feed known audio in place of the microphone (tests).
async function start(source = 'mic') {
  if (cur && !cur.done) return stop();
  const c = conf(), prev = cur?.prev && win?.isVisible() ? cur.prev : native.remember();
  const id = `d${++seq}`;
  cur = { id, prev, source: source === 'mic' ? 'mic' : 'feed', startedAt: Date.now(), done: false, onPartial: source.onPartial };
  const w = await panel();
  if (!isMac && w.isFocusable()) w.setFocusable(false);
  place();
  w.showInactive();
  const words = c.words.filter(Boolean);
  const opts = { lang: c.translate ? 'auto' : c.lang, translate: c.translate, autoStop: c.autoStop, model: modelFor(c), prompt: words.length ? `${words.join(', ')}.` : '' };
  (await getWorker()).send({ type: 'start', id, opts });
  warm();
  send('dictate:begin', { id, source: cur.source, lang: c.lang, translate: c.translate, langs: LANGS, hotkey: hot.ok ? hot.accel : '', hold: c.hold, platform: process.platform });
  if (cur.source === 'mic') {
    if (!(await micAllowed())) return fail(isMac ? 'Lime can’t hear you. Allow the microphone for Lime in System Settings › Privacy & Security › Microphone.' : 'The microphone is blocked.');
    return id;
  }
  const pcm = source.pcm, step = 800, speed = source.speed || 1;
  let at = 0;
  cur.feedT = setInterval(() => {
    if (!cur || cur.id !== id || cur.done) return;
    // After the clip, an open microphone would go on sending quiet: so does the feed unless autoEnd stops it.
    if (at >= pcm.length && source.autoEnd !== false) { clearInterval(cur.feedT); stop(); return; }
    worker?.send({ type: 'audio', id, pcm: at >= pcm.length ? new Float32Array(step) : pcm.slice(at, at + step) });
    at += step;
  }, 50 / speed);
  return id;
}
function stop() {
  if (!cur || cur.done || cur.stopping) return;
  cur.stopping = true;
  cur.stoppedAt = Date.now();
  clearInterval(cur.feedT);
  send('dictate:state', { state: 'tidying' });
  worker?.send({ type: 'stop', id: cur.id });
}
function cancel() {
  if (!cur) return;
  clearInterval(cur.feedT);
  worker?.send({ type: 'cancel', id: cur.id });
  cur.done = true;
}
function close() { cancel(); if (win && !win.isDestroyed()) win.hide(); }
const toggle = () => (cur && !cur.done ? stop() : start());

// Hold to talk, or tap to start and tap again to stop.
function onHotkey() {
  if (holdT) return;
  if (cur && !cur.done) return stop();
  const held = conf().hold ? native.heldCheck(hot.accel) : null;
  start();
  if (!held) return;
  const t0 = Date.now();
  holdT = setInterval(() => {
    if (held()) return;
    clearInterval(holdT);
    holdT = null;
    if (Date.now() - t0 > 350) stop();
  }, 30);
}
function registerHotkey() {
  if (hot.accel) try { globalShortcut.unregister(hot.accel); } catch (_) {}
  const want = conf().hotkey;
  hot = { accel: '', ok: false, wanted: want };
  for (const a of [want, ...HOTKEYS.filter((k) => k !== want)]) {
    if (!a) continue;
    let ok = false;
    try { ok = globalShortcut.register(a, onHotkey); } catch (_) {}
    if (ok) { hot = { accel: a, ok: true, wanted: want, fellBack: a !== want }; break; }
  }
  return hot;
}

function readWav(file) {
  const b = fs.readFileSync(file);
  let o = 12, fmt = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('Only 16-bit WAV files can be fed in.');
      const n = Math.floor(Math.min(size, b.length - o - 8) / 2 / fmt.ch), out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(o + 8 + i * 2 * fmt.ch) / 32768;
      if (fmt.rate === 16000) return out;
      const k = fmt.rate / 16000, r = new Float32Array(Math.floor(n / k));
      for (let i = 0; i < r.length; i++) { const p = i * k, j = Math.floor(p), f = p - j; r[i] = out[j] * (1 - f) + (out[j + 1] ?? out[j]) * f; }
      return r;
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('No audio in that WAV file.');
}

function learn({ words = [], replace = [] }) {
  const c = conf();
  const w = [...c.words], r = [...c.replace];
  for (const x of words) if (x && !w.some((y) => y.toLowerCase() === x.toLowerCase())) w.push(x);
  for (const [a, b] of replace) if (a && b && !r.some(([x]) => x.toLowerCase() === a.toLowerCase())) r.push([a, b]);
  return D.setSettings({ dictation: { ...c, words: w, replace: r } });
}

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a));
  h('dictate:start', () => start());
  h('dictate:toggle', () => toggle());
  h('dictate:stop', () => stop());
  h('dictate:close', () => close());
  h('dictate:audio', (id, pcm) => { if (cur && id === cur.id && !cur.stopping && !cur.done) worker?.send({ type: 'audio', id, pcm: pcm instanceof Float32Array ? pcm : Float32Array.from(pcm) }); });
  h('dictate:micError', (id, name) => { if (cur && id === cur.id) fail(name === 'NotAllowedError' || name === 'SecurityError' ? (isWin ? 'Windows is blocking the microphone. Turn on “Let desktop apps access your microphone” in Settings › Privacy & security › Microphone.' : isMac ? 'Lime can’t hear you. Allow the microphone for Lime in System Settings › Privacy & Security › Microphone.' : 'The microphone is blocked.') : name === 'NotFoundError' ? 'No microphone was found. Plug one in and try again.' : 'The microphone couldn’t start. Try again.'); });
  h('dictate:micSettings', () => shell.openExternal(isWin ? 'ms-settings:privacy-microphone' : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'));
  h('dictate:copy', async (text) => { await clipboard.writeText(String(text || '')); return true; });
  h('dictate:paste', async (text) => {
    await clipboard.writeText(String(text || ''));
    win?.hide();
    try { await native.paste(cur?.prev); return { ok: true }; } catch (e) { win?.showInactive(); return { ok: false, message: e.message }; }
  });
  h('dictate:focus', () => { if (win && !win.isDestroyed()) { if (!win.isFocusable()) win.setFocusable(true); win.focus(); } return true; });
  h('dictate:lang', (lang, translate) => { const c = conf(); return D.setSettings({ dictation: { ...c, lang: LANGS[lang] ? lang : c.lang, translate: !!translate } }); });
  h('dictate:learn', (patch) => learn(patch || {}));
  h('dictate:info', () => ({ ...conf(), langs: LANGS, hotkeyNow: hot.accel, hotkeyOk: hot.ok, fellBack: !!hot.fellBack, defaults: HOTKEYS, canHold: !!native.heldCheck(hot.accel || conf().hotkey), platform: process.platform }));
}

function init(deps) {
  D = deps;
  registerIpc();
  registerHotkey();
  D.app.on('will-quit', () => { try { worker?.kill(); } catch (_) {} });
}
// Settings › Dictation changed: pick up a new hotkey.
function apply(before) { if (conf().hotkey !== (before?.hotkey || DEFAULTS.hotkey) || !hot.ok) registerHotkey(); }

module.exports = {
  init, apply, start, stop, toggle, close, readWav, conf, LANGS, HOTKEYS,
  hotkey: () => hot, window: () => win, current: () => cur, modelFor,
  setConf: (patch) => D.setSettings({ dictation: { ...conf(), ...patch } }),
  vendorOk: () => !!(process.env.LIME_VAD_MODEL || require('./helpers').bundled('vad', D.vendor)),
  hasSmall: () => require('./engines/whisper').hasSmall(),
  feed: (file, o = {}) => start({ pcm: typeof file === 'string' ? readWav(file) : file, ...o }),
};
