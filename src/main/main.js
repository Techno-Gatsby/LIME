'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeTheme, Tray, Menu, globalShortcut, screen, clipboard, Notification, nativeImage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const RES = app.isPackaged ? process.resourcesPath : path.join(ROOT, 'vendor');
const BIN = app.isPackaged ? path.join(RES, 'bin') : path.join(ROOT, 'vendor', 'bin', `${process.platform}-${process.arch}`);
const DATA = path.join(RES, 'data');
const CRAFTS = app.isPackaged ? path.join(RES, 'crafts') : process.env.LIME_CRAFTS || path.join(ROOT, 'vendor', 'crafts', `${process.platform}-${process.arch}`);
const APPS = app.isPackaged ? path.join(RES, 'apps') : path.join(ROOT, 'vendor', 'apps', `${process.platform}-${process.arch}`);
const WEB = app.isPackaged ? path.join(RES, 'web') : process.env.LIME_WEB || path.join(ROOT, 'vendor', 'web');
const HELPERS = app.isPackaged ? path.join(RES, 'helpers') : path.join(ROOT, 'vendor', 'helpers', `${process.platform}-${process.arch}`);
const helperRoot = () => path.join(app.getPath('userData'), 'helpers');
const asset = (n) => path.join(ROOT, 'build', n);

app.setName('Lime');
if (isWin) app.setAppUserModelId('app.lime.converter');
if (process.env.LIME_NO_GPU) app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
  { scheme: 'craft', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let incoming = new Set(), incomingT = null;
const takeFiles = (list) => {
  const ok = (list || []).filter((f) => f && path.isAbsolute(f) && fs.existsSync(f) && path.resolve(f) !== path.resolve(process.execPath));
  ok.forEach((f) => incoming.add(f));
  if (!incoming.size) return ok;
  clearTimeout(incomingT);
  incomingT = setTimeout(() => { const files = [...incoming]; incoming = new Set(); if (app.isReady()) showWheel(files.length ? files : null); }, 300);
  return ok;
};
const argFiles = (argv) => (argv || []).slice(1).filter((a) => typeof a === 'string' && !a.startsWith('-') && a !== '.' && path.resolve(a) !== app.getAppPath());
app.on('open-file', (e, f) => { e.preventDefault(); takeFiles([f]); });
app.on('second-instance', (e, argv) => { if (!takeFiles(argFiles(argv)).length && app.isReady()) showWheel(); });
const log = (err) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'lime.log'), `${new Date().toISOString()} ${err?.stack || err}\n`); } catch (_) {} };
process.on('uncaughtException', log);

const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { theme: 'light', askSave: true, outMode: 'beside', outFolder: '', reveal: false, notify: true, float: true, dock: false, login: false, size: 'm', anchor: null, hidden: false, shiftDrag: true, corner: true, sounds: true, welcomed: false, recent: [], signatures: [], rings: { first: ['pdfcraft', 'photocraft', 'designcraft', 'webcraft', 'cadcraft', 'soundcraft', 'filmcraft'], second: ['vectorcraft', 'lightcraft', 'effectcraft', 'deckcraft', 'gridcraft', 'wordcraft'] } };
let settings = { ...DEFAULTS };
let saveT = null;
const loadSettings = () => {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS(), 'utf8')) }; } catch (_) { settings = { ...DEFAULTS }; }
  if (!settings.outFolder) settings.outFolder = path.join(app.getPath('downloads'), 'Lime');
};
const saveSettings = () => { clearTimeout(saveT); saveT = setTimeout(() => fsp.writeFile(SETTINGS(), JSON.stringify(settings, null, 1)).catch(() => {}), 200); };
const publicSettings = () => { const { recent, ...rest } = settings; return { ...rest, rings: homeRings(), platform: process.platform }; };
const RING_MAX = { first: 9, second: 10 };
function homeRings(r = settings.rings) {
  const known = Object.keys(crafts.APPS), seen = new Set(), def = DEFAULTS.rings;
  const src = r && (Array.isArray(r.first) || Array.isArray(r.second)) ? r : def;
  const take = (list, max) => (Array.isArray(list) ? list : []).filter((id) => known.includes(id) && !seen.has(id) && seen.add(id)).slice(0, max);
  const first = take(src.first, RING_MAX.first), second = take(src.second, RING_MAX.second);
  for (const id of [...def.second, ...def.first, ...known]) {
    if (seen.has(id) || !known.includes(id)) continue;
    seen.add(id);
    (second.length < RING_MAX.second ? second : first).push(id);
  }
  return { first, second };
}
function addRecent(paths, kind) {
  const at = Date.now();
  settings.recent = [...paths.map((p) => ({ path: p, kind, at })), ...settings.recent.filter((r) => !paths.includes(r.path))].slice(0, 30);
  saveSettings();
  buildTray();
}

const engineCfg = () => ({ bin: BIN, data: DATA, crafts: CRAFTS, apps: APPS, web: WEB, helpers: HELPERS, codecs: app.isPackaged ? path.join(RES, 'codecs') : path.join(ROOT, 'vendor', 'codecs', `${process.platform}-${process.arch}`), models: process.env.LIME_MODELS || path.join(RES, 'models'), user: app.getPath('userData'), tmp: path.join(os.tmpdir(), 'lime'), ...Object.fromEntries(['soffice', 'pandoc', ...Object.keys(crafts.APPS)].map((k) => [k, settings[k] || ''])) });
const POOL = Math.max(1, Math.min(3, os.cpus().length - 1));
const pool = [];
let utility = null, seq = 0;
const calls = new Map();
const jobs = new Map();
const queue = [];
function spawnWorker(role) {
  const w = new Worker(path.join(__dirname, 'worker.js'), { workerData: { cfg: engineCfg(), role } });
  w.busy = null;
  w.on('message', (m) => onWorker(w, m));
  w.on('error', (e) => { if (w.busy) failJob(w.busy, e.message || 'The engine stopped unexpectedly.'); });
  w.on('exit', () => {
    if (w.busy) failJob(w.busy, 'The engine stopped unexpectedly. Try again.');
    for (const [id, c] of calls) if (c.w === w) { calls.delete(id); c.reject(new Error('The engine restarted. Try again.')); }
    if (role === 'utility') utility = spawnWorker('utility');
    else { const i = pool.indexOf(w); if (i >= 0) pool[i] = spawnWorker('jobs'); pump(); }
  });
  return w;
}
const call = (method, ...args) => new Promise((resolve, reject) => {
  const id = ++seq;
  calls.set(id, { resolve, reject, w: utility });
  utility.postMessage({ type: 'call', id, method, args });
});
function onWorker(w, m) {
  if (m.type === 'callResult') {
    const c = calls.get(m.id);
    if (!c) return;
    calls.delete(m.id);
    m.error ? c.reject(Object.assign(new Error(m.error), { code: m.code })) : c.resolve(m.result);
  } else if (m.type === 'host') runHost(m.method, m.payload).then((result) => w.postMessage({ type: 'hostResult', id: m.id, result }), (e) => w.postMessage({ type: 'hostResult', id: m.id, error: e.message }));
  else if (m.type === 'progress') patchJob(m.jobId, { progress: m.progress, label: m.label || jobs.get(m.jobId)?.label });
  else if (m.type === 'done') finishJob(w, m.jobId, m.results);
  else if (m.type === 'failed') {
    w.busy = null;
    const j = jobs.get(m.jobId);
    if (j) Object.assign(j, { status: m.cancelled ? 'cancelled' : 'error', error: m.error, code: m.code, finishedAt: Date.now() });
    emitJobs();
    pump();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function loadInto(win, { file, url }) {
  const load = url ? win.loadURL(url, { userAgent: win.webContents.getUserAgent().replace(/Electron\/\S+\s?/, '') }) : win.loadFile(file);
  await Promise.race([load.catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; }), sleep(45000).then(() => { throw new Error('The page took too long to load.'); })]);
  await sleep(url ? 1800 : 400);
}
async function runHost(method, p) {
  if (method.startsWith('diagram:')) return require('./diagramhost').render(method.slice(8), p);
  const win = new BrowserWindow({ show: false, width: method === 'urlToImage' ? 1366 : 1100, height: method === 'urlToImage' ? 900 : 1400, useContentSize: true, webPreferences: { sandbox: true, javascript: !!p.url || !!p.js, ...(p.offline ? { partition: 'lime-offline' } : {}) } });
  if (p.offline) win.webContents.session.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob|about|devtools):/i.test(d.url) }));
  try {
    await loadInto(win, p);
    if (method === 'htmlToPdf') {
      const numbers = p.pageNumbers ? { displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font:8pt Helvetica,Arial,sans-serif;color:#555"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' } : {};
      const margins = p.margins && typeof p.margins === 'object' ? p.margins : { marginType: p.margins === 'none' ? 'none' : 'default' };
      await fsp.writeFile(p.out, await win.webContents.printToPDF(p.css ? { printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } } : { landscape: !!p.landscape, pageSize: p.pageSize || 'A4', printBackground: true, margins, ...numbers }));
      return p.out;
    }
    if (method === 'urlToImage') {
      const h = await win.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)').catch(() => 900);
      win.setContentSize(1366, Math.min(Math.max(900, h), 16000));
      await sleep(700);
      await fsp.writeFile(p.out, (await win.webContents.capturePage()).toPNG());
      return p.out;
    }
    throw new Error(`Unknown host call ${method}`);
  } finally { win.destroy(); }
}

const tools = require('./tools');
function submit({ tool, files = [], opts = {}, dest = null }) {
  const t = tools.get(tool);
  if (!t) throw new Error('Unknown tool.');
  if (!t.run) throw new Error(`${t.name} opens in its own window.`);
  if (!files.length) throw new Error('Drop a file on the wheel first.');
  const id = crypto.randomUUID();
  jobs.set(id, { id, tool, name: t.name, files, opts, dest, status: 'queued', progress: 0, label: 'Waiting', results: [], createdAt: Date.now(), outMode: settings.outMode, outFolder: settings.outFolder });
  queue.push(id);
  if (files.length) addRecent(files.slice(0, 8), 'input');
  pump();
  return id;
}
function pump() {
  for (const w of pool) {
    if (w.busy || !queue.length) continue;
    const id = queue.shift();
    const j = jobs.get(id);
    if (!j || j.status !== 'queued') continue;
    w.busy = id;
    Object.assign(j, { status: 'running', startedAt: Date.now(), label: 'Starting' });
    w.postMessage({ type: 'run', job: { id, tool: j.tool, files: j.files, opts: j.opts, dest: j.dest, outMode: j.outMode, outFolder: j.outFolder } });
  }
  emitJobs();
}
const patchJob = (id, patch) => { const j = jobs.get(id); if (j) { Object.assign(j, patch); emitJobs(); } };
const outputsOf = (j) => j.results.flatMap((r) => r.paths || (r.path ? [r.path] : []));
function finishJob(w, id, results) {
  w.busy = null;
  const j = jobs.get(id);
  if (j) {
    Object.assign(j, { status: 'done', progress: 1, results, finishedAt: Date.now(), label: 'Done' });
    const outs = outputsOf(j);
    if (outs.length) addRecent(outs.slice(0, 8), 'output');
    const edit = outs[0] && !results[0]?.inPlace && crafts.appFor(outs[0]);
    if (edit) j.edit = { app: edit.id, name: edit.name };
    if (settings.reveal && outs[0] && !results[0]?.inPlace) shell.showItemInFolder(outs[0]);
    notify(j, outs);
  }
  emitJobs();
  pump();
}
function failJob(id, error) {
  const j = jobs.get(id);
  if (j && j.status === 'running') Object.assign(j, { status: 'error', error, finishedAt: Date.now() });
  pool.forEach((w) => { if (w.busy === id) w.busy = null; });
  emitJobs();
}
function cancelJob(id) {
  const j = jobs.get(id);
  if (!j) return;
  if (j.status === 'queued') { Object.assign(j, { status: 'cancelled', finishedAt: Date.now() }); queue.splice(queue.indexOf(id), 1); emitJobs(); return; }
  pool.find((w) => w.busy === id)?.postMessage({ type: 'cancel', jobId: id });
}
let emitT = null;
function emitJobs() {
  if (emitT) return;
  emitT = setTimeout(() => {
    emitT = null;
    const now = Date.now(), all = [...jobs.values()];
    const live = all.filter((j) => j.status === 'running' || j.status === 'queued');
    wheel?.webContents.send('jobs', [...live, ...all.filter((j) => j.finishedAt && now - j.finishedAt < 15000)]);
    if (isMac && app.dock) app.dock.setBadge(live.length ? String(live.length) : '');
  }, 80);
}
function notify(j, outs) {
  if (!settings.notify || !Notification.isSupported() || (wheel?.isVisible() && wheel.isFocused())) return;
  const note = j.results.map((r) => r.note).find((n) => n && !n.includes('\n'));
  const n = new Notification({ title: `${j.name} finished`, body: [outs.slice(0, 3).map((o) => path.basename(o)).join(', '), note].filter(Boolean).join('\n') || 'Done', silent: true });
  n.on('click', () => outs[0] && shell.showItemInFolder(outs[0]));
  n.show();
}

let wheel = null, prefsWin = null, welcomeWin = null, tray = null, sensor = null, watcher = null;
const editors = new Set(), pickers = new Set();
const webPrefs = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false };
const workArea = (pt) => screen.getDisplayNearestPoint(pt).workArea;
const SIZE_K = { s: 0.88, m: 1, l: 1.14 };
function defaultAnchor() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - 150, y: wa.y + Math.round(wa.height * 0.6) };
}
let mode = 'tab', bloomAt = null, placed = null, openH = 416, catching = false, moving = false;
const clamp = (v, a, b) => Math.min(Math.max(v, a), Math.max(a, b));
const sizeK = () => SIZE_K[settings.size] || 1;
const TAB = { w: 86, h: 96, ax: 48, ay: 38 }, OPEN = { w: 330, h: 416, ax: 165, ay: 194 };
function tabPoint() {
  const a = settings.anchor || defaultAnchor();
  const wa = workArea(a), k = sizeK();
  return { x: wa.x + wa.width - (TAB.w - TAB.ax) * k, y: clamp(a.y, wa.y + TAB.ay * k, wa.y + wa.height - (TAB.h - TAB.ay) * k) };
}
function reachable(c) {
  const wa = workArea(c), k = sizeK();
  return { x: clamp(c.x, wa.x + OPEN.ax * k, wa.x + wa.width - (OPEN.w - OPEN.ax) * k), y: clamp(c.y, wa.y + OPEN.ay * k, wa.y + wa.height - (OPEN.h - OPEN.ay) * k) };
}
function placeWindow() {
  if (!wheel) return null;
  const tab = tabPoint(), wa = workArea(mode === 'open' && bloomAt ? bloomAt : tab);
  const b = { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  if (!placed || ['x', 'y', 'width', 'height'].some((q) => placed[q] !== b[q])) { wheel.setBounds(b); wheel.webContents.invalidate(); placed = b; }
  if (mode === 'tab' && settings.hidden) { if (wheel.isVisible()) wheel.hide(); } else if (!wheel.isVisible() && !wheel.webContents.isLoading()) wheel.showInactive();
  return { wa: b, tab, at: bloomAt, k: sizeK() };
}
function visibleRect() {
  const k = sizeK();
  if (mode !== 'open' || !bloomAt) { const t = tabPoint(); return { x: Math.round(t.x - TAB.ax * k), y: Math.round(t.y - TAB.ay * k), width: Math.round(TAB.w * k), height: Math.round(TAB.h * k) }; }
  return { x: Math.round(bloomAt.x - OPEN.ax * k), y: Math.round(bloomAt.y - OPEN.ay * k), width: Math.round(OPEN.w * k), height: Math.round(openH * k) };
}
function setCatch(on) {
  if (!wheel || wheel.isDestroyed() || on === catching) return;
  catching = on;
  if (process.platform !== 'linux') wheel.setIgnoreMouseEvents(!on, { forward: true });
}
const near = (p, r, m) => p.x >= r.x - m && p.x <= r.x + r.width + m && p.y >= r.y - m && p.y <= r.y + r.height + m;
let dragging = false, catchT = null;
const catchForDrag = () => { if (wheel && !wheel.isDestroyed()) setCatch(moving || near(screen.getCursorScreenPoint(), visibleRect(), 24)); };
function guardCatch() {
  clearInterval(catchT);
  catchT = setInterval(() => { if (catching && !moving && !dragging && !near(cursorAt(), visibleRect(), 48)) setCatch(false); }, 250);
}
function sendGeo() { const g = placeWindow(); if (g) wheel?.webContents.send('wheel:geo', g); }
const leash = () => (138 + 34) * sizeK();
let cursorAt = () => screen.getCursorScreenPoint(), followT = null;
const reducedMotion = () => { try { return !!require('electron').systemPreferences.getAnimationSettings?.().prefersReducedMotion; } catch (_) { return false; } };
function besidePointer(p) {
  const wa = workArea(p), k = sizeK();
  const side = p.x > wa.x + wa.width / 2 ? -1 : 1;
  const want = { x: p.x + side * leash(), y: p.y - 24 * k };
  const fits = (c) => c.x - OPEN.ax * k >= wa.x && c.x + (OPEN.w - OPEN.ax) * k <= wa.x + wa.width;
  if (!fits(want)) want.x = p.x - side * leash();
  return reachable(want);
}
function follow(on) {
  clearInterval(followT);
  followT = null;
  if (!on) return;
  let last = Date.now();
  followT = setInterval(() => {
    const now = Date.now(), dt = now - last;
    last = now;
    if (!wheel || mode !== 'open' || !bloomAt || moving) return;
    const p = cursorAt(), L = leash();
    const dx = p.x - bloomAt.x, dy = p.y - bloomAt.y, d = Math.hypot(dx, dy);
    if (d <= L + 0.5) return;
    const pull = d > L * 3 || reducedMotion() ? 1 : 1 - Math.exp(-dt / 27);
    const to = reachable({ x: bloomAt.x + dx * (1 - L / d) * pull, y: bloomAt.y + dy * (1 - L / d) * pull });
    if (Math.abs(to.x - bloomAt.x) < 0.5 && Math.abs(to.y - bloomAt.y) < 0.5) return;
    bloomAt = to;
    if (near(to, placed, 0)) wheel.webContents.send('wheel:at', bloomAt); else sendGeo();
  }, 16);
}
function summon(why, at, focus) {
  if (!wheel) createWheel();
  const go = () => { lift(); if (!wheel.isVisible()) wheel.showInactive(); if (focus) wheel.focus(); wheel.webContents.send('wheel:summon', { why, at: at || null, peek, tab: mode === 'tab' }); };
  if (wheel.webContents.isLoading()) wheel.webContents.once('did-finish-load', () => setTimeout(go, 120)); else go();
}
const cornerPoint = () => { const wa = screen.getPrimaryDisplay().workArea; return { x: wa.x + 200, y: wa.y + wa.height - 240 }; };
function placeSensor() {
  if (!sensor) return;
  const wa = screen.getPrimaryDisplay().workArea;
  sensor.setBounds({ x: wa.x, y: wa.y + wa.height - 72, width: 72, height: 72 });
}
function applyCorner() {
  if (settings.corner && !sensor) {
    sensor = new BrowserWindow({
      width: 72, height: 72, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000', title: 'Lime corner', ...(isMac ? { type: 'panel' } : {}), webPreferences: webPrefs,
    });
    sensor.setAlwaysOnTop(true, TOP_LEVEL);
    if (isMac) sensor.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    placeSensor();
    sensor.loadURL('app://local/sensor.html');
    sensor.once('ready-to-show', () => sensor?.showInactive());
    sensor.on('closed', () => { sensor = null; });
  } else if (!settings.corner && sensor) sensor.destroy();
}
let peek = [], peekSeq = 0;
function sendPeek(files) {
  peek = files.filter((f) => { try { return fs.existsSync(f); } catch (_) { return false; } });
  if (peek.length) wheel?.webContents.send('wheel:peek', peek);
}
function startWatcher() {
  watcher = require('./dragwatch').start({
    onDrag: () => {
      dragging = true;
      const seq = ++peekSeq;
      peek = [];
      watcher?.files().then((f) => { if (seq === peekSeq) sendPeek(f); }).catch(log);
    },
    onShift: () => {
      if (settings.shiftDrag === false) return true;
      shiftSummon(screen.getCursorScreenPoint());
      return true;
    },
    onMove: catchForDrag,
    onEnd: () => { dragging = false; peekSeq++; peek = []; follow(false); wheel?.webContents.send('wheel:dragEnded'); },
    onError: log,
  });
  if (watcher && process.platform === 'win32' && settings.shiftDrag !== false) setTimeout(() => require('./shellsel').warm(), 4000);
}
function shiftSummon(p) {
  summon('shift', besidePointer(p));
  follow(true);
}
let rebuiltAt = 0, pingT = null;
function rebuildWheel(why) {
  if (Date.now() - rebuiltAt < 3000) return;
  rebuiltAt = Date.now();
  log(`wheel rebuilt: ${why}`);
  const old = wheel;
  wheel = null;
  placed = null; mode = 'tab'; bloomAt = null; catching = false; moving = false;
  follow(false);
  try { old?.hide(); } catch (_) {}
  try { old?.destroy(); } catch (_) {}
  createWheel();
}
function watchWheel(w) {
  let misses = 0;
  w.webContents.on('render-process-gone', (e, d) => { if (w === wheel) rebuildWheel(`page ${d.reason}`); });
  w.webContents.on('unresponsive', () => { if (w === wheel) rebuildWheel('page not responding'); });
  clearInterval(pingT);
  pingT = setInterval(() => {
    if (w !== wheel || w.isDestroyed() || w.webContents.isLoading() || !w.isVisible()) return;
    let answered = false;
    w.webContents.executeJavaScript('1', true).then(() => { answered = true; misses = 0; }).catch(() => {});
    setTimeout(() => { if (!answered && w === wheel && ++misses >= 2) rebuildWheel('page stopped answering'); }, 4000);
  }, 5000);
}
function createWheel() {
  for (const w of BrowserWindow.getAllWindows()) if (w.isWheel && !w.isDestroyed()) w.destroy();
  const wa = workArea(tabPoint());
  wheel = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height, show: false, frame: false, transparent: true, resizable: false, movable: false, maximizable: false, minimizable: false,
    fullscreenable: false, hasShadow: false, skipTaskbar: true, backgroundColor: '#00000000', title: 'Lime', acceptFirstMouse: true, roundedCorners: false,
    alwaysOnTop: settings.float, ...(isMac ? { type: 'panel' } : {}), webPreferences: webPrefs,
  });
  wheel.isWheel = true;
  placed = { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  catching = true;
  setCatch(false);
  guardCatch();
  watchWheel(wheel);
  applyFloat();
  placeWindow();
  wheel.loadURL('app://local/wheel.html');
  wheel.once('ready-to-show', () => { if (!settings.hidden || pendingShow) { wheel.showInactive(); pendingShow = false; } });
  const self = wheel;
  wheel.on('closed', () => { if (wheel === self) { wheel = null; clearInterval(topT); clearInterval(pingT); } });
  wheel.on('show', raise);
  wheel.on('blur', raise);
  wheel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  wheel.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.env.LIME_SHOTS) wheel.webContents.on('console-message', (e) => console.log('[wheel]', e.message ?? e));
}
let pendingShow = false;
const TOP_LEVEL = isMac ? 'status' : 'screen-saver';
function applyFloat() {
  if (!wheel) return;
  wheel.setAlwaysOnTop(!!settings.float, TOP_LEVEL);
  if (isMac) wheel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !!settings.float, skipTransformProcessType: true });
  keepOnTop();
}
let topT = null;
function raise() {
  if (!wheel || wheel.isDestroyed() || !wheel.isVisible() || (!settings.float && mode === 'tab')) return;
  wheel.setAlwaysOnTop(true, TOP_LEVEL);
  if (isMac) wheel.moveTop();
}
function lift() {
  if (!wheel || wheel.isDestroyed()) return;
  wheel.setAlwaysOnTop(true, TOP_LEVEL);
  wheel.moveTop();
}
function keepOnTop() {
  clearInterval(topT);
  topT = setInterval(raise, 2000);
}
function showWheel(files) {
  if (!files) return summon('show', null, true);
  if (!wheel) createWheel();
  const go = () => {
    if (!wheel.isVisible()) wheel.showInactive();
    wheel.focus();
    wheel.webContents.send('wheel:files', files);
  };
  if (wheel.webContents.isLoading()) { pendingShow = true; wheel.webContents.once('did-finish-load', () => setTimeout(go, 120)); } else go();
}
const toggleWheel = () => (mode === 'open' ? wheel?.webContents.send('wheel:fold') : showWheel());

function openPrefs(tab) {
  if (prefsWin) { prefsWin.show(); prefsWin.focus(); if (tab) prefsWin.webContents.send('prefs:tab', tab); return; }
  prefsWin = new BrowserWindow({
    width: 560, height: 640, minWidth: 480, minHeight: 480, show: false, title: 'Lime Settings', resizable: true, fullscreenable: false,
    ...(isMac ? { titleBarStyle: 'hiddenInset', vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000' } : { autoHideMenuBar: true, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1e1a' : '#f6f8f2' }),
    icon: asset('icon.png'), webPreferences: webPrefs,
  });
  prefsWin.loadURL(`app://local/prefs.html${tab ? `#${tab}` : ''}`);
  prefsWin.once('ready-to-show', () => prefsWin.show());
  prefsWin.on('closed', () => { prefsWin = null; });
}
function openWelcome() {
  if (welcomeWin) { welcomeWin.show(); welcomeWin.focus(); return; }
  welcomeWin = new BrowserWindow({
    width: 700, height: 600, useContentSize: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, show: false, title: 'Welcome to Lime',
    ...(isMac ? { titleBarStyle: 'hiddenInset', vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000' } : { autoHideMenuBar: true, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1e1a' : '#f6f8f2' }),
    icon: asset('icon.png'), webPreferences: webPrefs,
  });
  welcomeWin.loadURL('app://local/welcome.html');
  welcomeWin.once('ready-to-show', () => { welcomeWin?.show(); welcomeWin?.focus(); });
  welcomeWin.on('closed', () => { welcomeWin = null; if (!settings.welcomed) setSettings({ welcomed: true }); });
}
function openEditor(file, mode) {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1240, area.width - 80), height: Math.min(860, area.height - 60), minWidth: 720, minHeight: 520, show: false, title: path.basename(file),
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } } : { autoHideMenuBar: true }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1e1a' : '#f6f8f2', icon: asset('icon.png'), webPreferences: webPrefs,
  });
  win.editorData = { file, mode };
  win.loadURL('app://local/editor.html');
  win.once('ready-to-show', () => win.show());
  editors.add(win);
  win.on('closed', () => editors.delete(win));
  win.on('close', (e) => {
    if (win.closing || win.webContents.isCrashed()) return;
    e.preventDefault();
    win.quitAfter = !!app.isQuitting;
    app.isQuitting = false;
    win.webContents.send('editor:close');
  });
  return true;
}

const craftWins = new Set(), craftSites = new Map();
let craftSes = null;
const craftOf = (wc) => BrowserWindow.fromWebContents(wc)?.craftWeb || null;
function craftSavePath(cw, name) {
  const dir = cw.file ? path.dirname(cw.file) : app.getPath('documents');
  const clean = path.basename(String(name || 'Untitled')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200) || 'Untitled';
  const ext = path.extname(clean), stem = cw.file && path.resolve(dir, clean) === path.resolve(cw.file) ? `${path.basename(clean, ext)} (edited)` : path.basename(clean, ext);
  let target = path.join(dir, `${stem}${ext}`);
  if (cw.saved.has(target)) return target;
  for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${stem} ${i}${ext}`);
  cw.saved.add(target);
  return target;
}
function craftSession() {
  if (craftSes) return craftSes;
  craftSes = session.fromPartition('persist:crafts');
  craftSes.protocol.handle('craft', (req) => {
    const u = new URL(req.url), rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    if (!rel || ['craftweb.js', 'craftweb.css'].includes(rel)) return net.fetch(pathToFileURL(path.join(RENDERER, rel || 'craftweb.html')).href);
    const site = craftSites.get(u.host);
    if (!site || !rel.startsWith('app/')) return new Response('Not found', { status: 404 });
    const file = path.normalize(path.join(site, rel.slice(4)));
    if (!file.startsWith(site + path.sep) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    if (file.endsWith('.wasm')) return new Response(require('stream').Readable.toWeb(fs.createReadStream(file)), { headers: { 'Content-Type': 'application/wasm', 'Content-Length': String(fs.statSync(file).size) } });
    return net.fetch(pathToFileURL(file).href);
  });
  craftSes.on('will-download', (e, item, wc) => {
    const cw = craftOf(wc);
    if (!cw) return;
    const to = craftSavePath(cw, item.getFilename());
    item.setSavePath(to);
    item.once('done', (ev, state) => { if (!wc.isDestroyed()) wc.send('craftweb:saved', state === 'completed' ? { path: to } : { error: `Couldn’t save ${path.basename(to)}` }); });
  });
  return craftSes;
}
async function openCraftWeb(id, file) {
  const a = crafts.APPS[id];
  const site = a && (await crafts.webApp(id));
  if (!site) throw new Error(`${a?.name || 'This app'} can’t open in a Lime window in this build.`);
  craftSites.set(id, path.resolve(site));
  craftSession();
  const area = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1320, area.width - 60), height: Math.min(880, area.height - 40), minWidth: 720, minHeight: 480, show: false, title: file ? `${path.basename(file)} — ${a.name}` : a.name,
    ...(isMac ? {} : { autoHideMenuBar: true }), backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1e1a' : '#f6f8f2', icon: asset('icon.png'),
    webPreferences: { preload: path.join(__dirname, 'craftweb-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, partition: 'persist:crafts' },
  });
  win.craftWeb = { id, name: a.name, file: file || null, saved: new Set(), dirty: false, ...crafts.WEB[id] };
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`craft://${id}/`)) e.preventDefault(); });
  win.on('close', (e) => {
    if (!win.craftWeb.dirty || win.forceClose) return;
    e.preventDefault();
    const pick = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Close without saving', 'Cancel'], defaultId: 1, cancelId: 1, message: `Close ${a.name}?`, detail: 'Changes you haven’t saved will be lost.' });
    if (pick === 0) { win.forceClose = true; win.close(); }
  });
  craftWins.add(win);
  win.on('closed', () => craftWins.delete(win));
  win.once('ready-to-show', () => win.show());
  await win.loadURL(`craft://${id}/`);
  return win;
}

function pickCells(file, value) {
  return new Promise((resolve) => {
    const area = screen.getPrimaryDisplay().workAreaSize;
    const win = new BrowserWindow({
      width: Math.min(1100, area.width - 80), height: Math.min(720, area.height - 60), minWidth: 560, minHeight: 380, show: false, title: `Choose cells — ${path.basename(file)}`,
      ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 22 } } : { autoHideMenuBar: true }),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1e1a' : '#f6f8f2', icon: asset('icon.png'), webPreferences: webPrefs,
    });
    win.pickerData = { file, value };
    win.pick = (v) => { win.pick = null; resolve(v); if (!win.isDestroyed()) win.close(); };
    win.on('closed', () => win.pick?.(null));
    win.loadURL('app://local/picker.html');
    win.once('ready-to-show', () => win.show());
    pickers.add(win);
    win.on('closed', () => pickers.delete(win));
  });
}

function trayImage() {
  const img = nativeImage.createFromPath(asset(isMac ? 'trayTemplate.png' : isWin ? 'tray.ico' : 'tray.png'));
  if (isMac) img.setTemplateImage(true);
  return img;
}
function buildTray() {
  if (!app.isReady()) return;
  if (!tray) {
    tray = new Tray(trayImage());
    tray.setToolTip('Lime');
    if (!isMac) tray.on('click', toggleWheel);
  }
  const recent = settings.recent.filter((r) => r.kind === 'output' && fs.existsSync(r.path)).slice(0, 10);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Wheel', accelerator: 'Control+Alt+L', click: () => showWheel() },
    { label: 'Show Lime at Screen Edge', type: 'checkbox', checked: !settings.hidden, click: (i) => setSettings({ hidden: !i.checked }) },
    { label: 'Choose Files…', click: pickFiles },
    appsMenu(),
    { label: 'New Whiteboard', click: () => openEditor('', 'board') }, ...(require('./diagrams').hasDrawio() ? [{ label: 'New Diagram', click: () => openEditor('', 'drawio') }] : []),
    { label: 'Recent', enabled: recent.length > 0, submenu: recent.length ? recent.map((r) => ({ label: path.basename(r.path), click: () => shell.showItemInFolder(r.path) })) : [{ label: 'Nothing yet', enabled: false }] },
    { type: 'separator' },
    { label: 'Float Above Windows', type: 'checkbox', checked: !!settings.float, click: (i) => setSettings({ float: i.checked }) },
    { label: 'Settings…', accelerator: isMac ? 'Command+,' : undefined, click: () => openPrefs() },
    { label: 'How Lime Works', click: () => openWelcome() },
    { type: 'separator' },
    { label: 'Quit Lime', accelerator: isMac ? 'Command+Q' : undefined, click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}
const appsMenu = () => ({ label: 'Open App', submenu: Object.entries(crafts.APPS).filter(([, a]) => !a.builtin).map(([id, a]) => ({ label: `${a.name} — ${a.role}`, enabled: crafts.hasApp(id), click: () => crafts.openApp(id, []).catch(log) })) });
async function pickFiles() {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory', 'multiSelections'], title: 'Choose files for Lime' });
  if (!r.canceled && r.filePaths.length) showWheel(r.filePaths);
}
const finderSelection = () => new Promise((resolve) => {
  if (!isMac) return resolve([]);
  const script = 'tell application "System Events" to set fp to name of first process whose frontmost is true\nif fp is not "Finder" then return ""\ntell application "Finder"\nset out to ""\nrepeat with f in (selection as alias list)\nset out to out & POSIX path of f & linefeed\nend repeat\nreturn out\nend tell';
  execFile('osascript', ['-e', script], { timeout: 4000 }, (err, stdout) => resolve(err ? [] : String(stdout).split('\n').map((s) => s.trim()).filter((s) => s && fs.existsSync(s))));
});
async function hotkey() {
  const files = await finderSelection();
  if (files.length) showWheel(files.map((f) => f.replace(/\/$/, '')));
  else toggleWheel();
}

const crafts = require('./engines/crafts');
function actionsFor(files) {
  const one = files.length === 1;
  const a = [
    { action: 'open', label: 'Open', hint: one ? 'Default app' : `${files.length} files` },
    { action: 'show', label: isMac ? 'Finder' : 'Show', hint: 'Reveal' },
    { action: 'copyPath', label: 'Path', hint: 'Copy' },
    { action: 'all', label: 'All tools', hint: 'Browse' },
  ];
  if (one) {
    a.push({ action: 'hash', label: 'SHA-256', hint: 'Copy hash' });
    if (isMac) a.push({ action: 'quicklook', label: 'Preview', hint: 'Quick Look' });
  }
  a.push({ action: 'trash', label: 'Trash', hint: 'Move', danger: true });
  return a;
}
async function doAction(item, files) {
  switch (item.action) {
    case 'open': files.slice(0, 20).forEach((f) => shell.openPath(f)); return null;
    case 'show': shell.showItemInFolder(files[0]); return null;
    case 'copyPath': clipboard.writeText(files.join('\n')); return `Copied ${files.length === 1 ? 'path' : `${files.length} paths`}`;
    case 'hash': { const h = await require('./engines/util').hashFile(files[0], 'sha256'); clipboard.writeText(h); return `SHA-256 copied · ${h.slice(0, 12)}…`; }
    case 'craft': {
      if (!crafts.hasApp(item.app)) return `${crafts.APPS[item.app]?.name || 'That app'} isn’t in this build of Lime`;
      crafts.openApp(item.app, files).catch((e) => { log(e); wheel?.webContents.send('wheel:flash', e.message); });
      return `Opening ${crafts.APPS[item.app].name}…`;
    }
    case 'craftweb': {
      openCraftWeb(item.app, files[0]).catch((e) => { log(e); wheel?.webContents.send('wheel:flash', e.message); });
      return `Opening ${crafts.APPS[item.app]?.name || 'the app'}…`;
    }
    case 'quicklook': execFile('qlmanage', ['-p', ...files.slice(0, 10)], () => {}); return null;
    case 'trash': for (const f of files) await shell.trashItem(f); return `Moved ${files.length === 1 ? path.basename(files[0]) : `${files.length} files`} to the Trash`;
    case 'reveal': shell.showItemInFolder(files[0]); return null;
    default: return null;
  }
}

const EDIT_IN = { photocraft: ['edit-image'], lightcraft: ['edit-image'], vectorcraft: ['edit-vector', 'edit-image'], designcraft: ['edit-layout'], effectcraft: ['edit-motion'], filmcraft: ['edit-video', 'edit-audio', 'edit-timeline'], pdfcraft: ['edit-pdf'], soundcraft: ['edit-audio'], webcraft: ['edit-web'] };
function appRing(id, files) {
  const a = crafts.APPS[id];
  const ok = crafts.hasApp(id);
  const full = { action: 'craft', app: id, label: 'Full app', hint: 'Own window', desc: ok ? `${files.length ? `${files.length === 1 ? path.basename(files[0]) : `${files.length} files`} in ` : ''}${a.name}, with every tool` : `${a.name} isn’t in this build of Lime`, ...(ok ? {} : { off: true }) };
  const edit = (EDIT_IN[id] || []).map((t) => tools.get(t)).find((t) => t && (!files.length || tools.accepts(t, files)));
  const web = crafts.hasWeb(id) && files.length <= 1;
  const ring = web ? [{ action: 'craftweb', app: id, label: 'Open', hint: 'In Lime', appOpen: true, desc: `${files.length ? `${path.basename(files[0])} in ` : ''}${a.name}, in a Lime window` }, full] : edit ? [{ tool: edit.id, label: 'Open', hint: 'In Lime', appOpen: true, desc: `${a.name} in a Lime window: ${edit.desc}`, ...(files.length ? {} : { exts: tools.extsFor(edit) }) }, full] : [full];
  if (a.builtin && ring.includes(full)) ring.splice(ring.indexOf(full), 1);
  const list = tools.TOOLS.filter((x) => x.craft === id && (!files.length || tools.accepts(x, files))).sort((x, y) => (x.prio ?? 50) - (y.prio ?? 50));
  for (const t of list) {
    for (const [label, hint, opts] of t.petals || [[t.petal?.[0] || t.name, t.petal?.[1] || '', t.petal?.[2]]]) ring.push({ tool: t.id, label, hint, ...(opts ? { opts } : {}), ...(files.length ? {} : { exts: tools.extsFor(t) }) });
  }
  const MAX = 10;
  const more = ring.length > MAX ? ring.splice(MAX - 1) : [];
  if (more.length) ring.push({ appAll: id, label: 'More', hint: `${more.length} actions`, desc: `Every ${a.name} action for ${files.length ? 'these files' : 'your files'}` });
  return { id, name: a.name, role: a.role, short: a.short, ring, all: [...new Set(list.map((t) => t.id))], ...(files.length ? {} : { exts: Object.fromEntries(list.map((t) => [t.id, tools.extsFor(t)])) }) };
}
function itemsFor(files) {
  const w = tools.wheelsFor(files), apps = crafts.appsFor(files).map((id) => appRing(id, files));
  const first = apps[0];
  if (first && crafts.hasApp(first.id)) w.tools = [...w.tools.slice(0, 9), { action: 'craft', app: first.id, label: first.name, hint: 'Open in', desc: `Edit in ${first.name} · ${first.role}` }];
  return { ...w, apps, more: actionsFor(files), all: tools.toolsFor(files) };
}
function broadcast(ch, payload) { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, payload); }
async function setSettings(patch) {
  const before = { ...settings };
  Object.assign(settings, patch);
  saveSettings();
  if ('theme' in patch) nativeTheme.themeSource = settings.theme;
  if ('float' in patch) applyFloat();
  if ('anchor' in patch || 'hidden' in patch) sendGeo();
  if ('corner' in patch) applyCorner();
  if ('dock' in patch && isMac) settings.dock ? app.dock.show() : app.dock.hide();
  if ('rings' in patch) settings.rings = homeRings(patch.rings);
  if ('login' in patch) app.setLoginItemSettings({ openAtLogin: !!settings.login, openAsHidden: true });
  if (['soffice', 'pandoc', ...Object.keys(crafts.APPS)].some((k) => k in patch && patch[k] !== before[k])) { require('./engines/util').configure(engineCfg()); [...pool, utility].forEach((w) => w.postMessage({ type: 'config', cfg: engineCfg() })); }
  buildTray();
  broadcast('settings', publicSettings());
  return publicSettings();
}
function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a));
  const hE = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(e, ...a));
  h('app:info', () => ({ version: app.getVersion(), platform: process.platform, dark: nativeTheme.shouldUseDarkColors, home: os.homedir() }));
  h('catalog', () => tools.catalog());
  h('wheel:items', (files) => itemsFor(files));
  h('wheel:home', () => { const r = homeRings(); return [...r.first.map((id) => ({ ...appRing(id, []), place: 1 })), ...r.second.map((id) => ({ ...appRing(id, []), place: 2 }))]; });
  h('wheel:action', (item, files) => doAction(item, files));
  h('wheel:layout', ({ mode: m, at, h }) => {
    if (h) openH = h;
    if (m === 'tab') { bloomAt = null; follow(false); if (!settings.float && mode !== 'tab') wheel?.setAlwaysOnTop(false); }
    if (m === 'open' && mode === 'tab') lift();
    if (m === 'open') { const t = tabPoint(); bloomAt = reachable(at || bloomAt || { x: t.x - 150 * sizeK(), y: t.y }); }
    if (m) mode = m;
    return placeWindow();
  });
  h('wheel:peek', () => peek);
  h('wheel:haptic', () => { try { watcher?.probe.haptic?.(); } catch (_) {} });
  h('sensor:enter', () => { if (mode === 'tab') summon('corner', cornerPoint()); });
  h('sensor:drop', (files) => takeFiles(files));
  h('wheel:hide', () => setSettings({ hidden: true }));
  h('wheel:menu', () => Menu.buildFromTemplate([
    { label: 'Choose Files…', click: pickFiles },
    appsMenu(),
    { label: 'New Whiteboard', click: () => openEditor('', 'board') }, ...(require('./diagrams').hasDrawio() ? [{ label: 'New Diagram', click: () => openEditor('', 'drawio') }] : []),
    { label: 'Settings…', click: () => openPrefs() },
    { label: 'How Lime Works', click: () => openWelcome() },
    { type: 'separator' },
    { label: 'Size', submenu: [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([v, l]) => ({ label: l, type: 'radio', checked: settings.size === v, click: () => setSettings({ size: v }) })) },
    { label: 'Float Above Windows', type: 'checkbox', checked: !!settings.float, click: (i) => setSettings({ float: i.checked }) },
    { label: 'Reset Position', click: () => { settings.anchor = null; bloomAt = null; saveSettings(); sendGeo(); } },
    { type: 'separator' },
    { label: 'Hide from Screen Edge', click: () => setSettings({ hidden: true }) },
    { label: 'Quit Lime', click: () => { app.isQuitting = true; app.quit(); } },
  ]).popup({ window: wheel }));
  ipcMain.on('wheel:catch', (e, on) => { if (e.sender === wheel?.webContents) setCatch(!!on); });
  let moveT = null;
  h('wheel:dragStart', () => {
    follow(false);
    moving = true;
    setCatch(true);
    let seen = false;
    clearInterval(moveT);
    moveT = setInterval(() => { try { const left = watcher?.probe().left; if (left) seen = true; else if (seen) { clearInterval(moveT); wheel?.webContents.send('wheel:moveEnd'); } } catch (_) {} }, 100);
  });
  h('wheel:dragEnd', (p) => {
    clearInterval(moveT);
    moving = false;
    if (mode === 'tab') { if (p) settings.anchor = { x: p.x, y: p.y }; saveSettings(); } else if (p) bloomAt = reachable(p);
    return placeWindow();
  });
  h('files:thumb', (p, size) => call('thumbnail', p, size).catch(() => null));
  h('tools:suggest', (tool, files, opts) => tools.suggest(tool, files, opts));
  h('tools:accepts', (tool, files) => tools.accepts(tools.get(tool), files));
  h('files:dataUrl', async (p, max = 1800) => {
    const buf = await (await require('./engines/image').open(p)).rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return `data:image/png;base64,${buf.toString('base64')}`;
  });
  h('app:paths', () => ({ licenses: app.isPackaged ? path.join(RES, 'LICENSES') : path.join(ROOT, 'LICENSES'), userData: app.getPath('userData') }));
  const RECOVER = () => path.join(app.getPath('userData'), 'recovery');
  const recoverKey = (file) => crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 16);
  h('recover:save', async (file, meta, data, ext) => {
    const dir = RECOVER(), key = recoverKey(file);
    await fsp.mkdir(dir, { recursive: true });
    const kind = data || ext ? String(ext || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin' : null;
    if (data) await fsp.writeFile(path.join(dir, `${key}.${kind}`), Buffer.from(data));
    await fsp.writeFile(path.join(dir, `${key}.json`), JSON.stringify({ file, at: Date.now(), ext: kind, meta }));
    return { dir, key, data: kind ? path.join(dir, `${key}.${kind}`) : null };
  });
  h('recover:load', async (file) => {
    const dir = RECOVER(), key = recoverKey(file);
    try {
      const j = JSON.parse(await fsp.readFile(path.join(dir, `${key}.json`), 'utf8'));
      const data = j.ext ? path.join(dir, `${key}.${j.ext}`) : null;
      return data && !fs.existsSync(data) ? null : { ...j, data, dir, key };
    } catch (_) { return null; }
  });
  h('recover:drop', async (file) => {
    const dir = RECOVER(), key = recoverKey(file);
    for (const f of await fsp.readdir(dir).catch(() => [])) if (f.startsWith(key)) await fsp.rm(path.join(dir, f), { force: true }).catch(() => {});
    return true;
  });
  h('files:describe', (p) => call('describe', p).catch(() => null));
  h('files:exists', (paths) => paths.filter((p) => fs.existsSync(p)));
  h('jobs:submit', (job) => submit(job));
  h('save:ask', async ({ tool, files, opts }) => {
    const s = tools.suggest(tool, files, opts);
    if (s.kind === 'none') return { kind: 'none' };
    if (!settings.askSave) return { kind: 'auto' };
    const dir = settings.outMode === 'folder' && settings.outFolder ? settings.outFolder : files[0] ? path.dirname(files[0]) : app.getPath('downloads');
    if (isMac) app.focus({ steal: true });
    if (s.kind === 'dir') {
      const r = await dialog.showOpenDialog({ title: `Save ${files.length} results`, message: `Choose a folder for the ${files.length} new files`, buttonLabel: 'Save Here', defaultPath: dir, properties: ['openDirectory', 'createDirectory'] });
      return r.canceled || !r.filePaths[0] ? null : { kind: 'dir', path: r.filePaths[0] };
    }
    const r = await dialog.showSaveDialog({ title: s.kind === 'folder' ? 'Save Folder As' : 'Save As', nameFieldLabel: s.kind === 'folder' ? 'Folder:' : 'Save As:', defaultPath: path.join(dir, s.name), buttonLabel: 'Save', filters: s.ext ? [{ name: s.ext.toUpperCase(), extensions: [s.ext] }] : undefined, properties: ['createDirectory', 'showOverwriteConfirmation'] });
    return r.canceled || !r.filePath ? null : { kind: s.kind, path: r.filePath };
  });
  h('jobs:cancel', (id) => cancelJob(id));
  h('jobs:list', () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt));
  h('editor:open', (file, mode) => openEditor(file, mode));
  hE('editor:data', (e) => BrowserWindow.fromWebContents(e.sender)?.editorData || null);
  h('editor:modeFor', (file) => tools.TOOLS.find((t) => t.editor && tools.accepts(t, [file]))?.editor || null);
  hE('editor:switched', (e, file, mode) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.editorData = { file, mode }; return true; });
  hE('editor:closeNow', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (!w || w.isDestroyed()) return false; w.closing = true; w.close(); if (w.quitAfter) { app.isQuitting = true; app.quit(); } return true; });
  hE('editor:closeCancel', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w?.quitAfter && !wheel) createWheel(); if (w) w.quitAfter = false; return true; });
  h('cells:pick', (file, value) => (file ? pickCells(file, value || '') : null));
  hE('picker:data', async (e) => { const d = BrowserWindow.fromWebContents(e.sender)?.pickerData; return d ? { ...d, ...(await call('sheetPreview', d.file)) } : null; });
  hE('picker:done', (e, v) => { BrowserWindow.fromWebContents(e.sender)?.pick?.(v); });
  h('editor:call', (method, ...args) => call(`editor.${method}`, ...args));
  h('edit:call', (ns, method, ...args) => (['image', 'media', 'studio', 'web', 'diagram'].includes(ns) ? call(`${ns}.${method}`, ...args) : Promise.reject(new Error(`No editor ${ns}`))));
  hE('dialog:open', async (e, o = {}) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: [o.folders ? 'openDirectory' : 'openFile', ...(o.multi !== false ? ['multiSelections'] : []), ...(o.create ? ['createDirectory'] : [])], filters: o.filters, title: o.title });
    return r.canceled ? [] : r.filePaths;
  });
  hE('dialog:save', async (e, o = {}) => { const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: o.defaultPath, filters: o.filters }); return r.canceled ? null : r.filePath; });
  h('shell:open', (p) => shell.openPath(p));
  h('shell:show', (p) => shell.showItemInFolder(p));
  h('shell:external', (u) => (/^https?:\/\//.test(u) ? shell.openExternal(u) : null));
  h('shell:trash', (p) => shell.trashItem(p));
  h('clip:text', (t) => clipboard.writeText(String(t)));
  ipcMain.on('drag:start', (e, paths) => {
    const list = paths.filter((p) => fs.existsSync(p));
    if (list.length) e.sender.startDrag({ files: list, file: list[0], icon: nativeImage.createFromPath(asset('drag.png')) });
  });
  h('settings:get', () => publicSettings());
  h('settings:set', (patch) => setSettings(patch));
  // A picture for the lime's place: squared and kept small, so it travels with the settings.
  h('icon:set', async (file) => {
    if (!file) return setSettings({ icon: null });
    const png = await require('sharp')(file, { failOn: 'none' }).rotate().resize(256, 256, { fit: 'cover' }).png().toBuffer();
    return setSettings({ icon: `data:image/png;base64,${png.toString('base64')}` });
  });
  h('prefs:open', (tab) => openPrefs(tab));
  h('welcome:open', () => { openWelcome(); return true; });
  h('welcome:done', () => { setSettings({ welcomed: true }); welcomeWin?.close(); return true; });
  h('engines:status', () => call('enginesStatus'));
  hE('helpers:get', async (e, id) => {
    const helpers = require('./helpers'), tell = (p) => { if (!e.sender.isDestroyed()) e.sender.send('helpers:progress', p); };
    const exe = crafts.APPS[id] ? await crafts.getApp(id, tell) : helpers.bundled(id, HELPERS) ? await helpers.ensure(id, HELPERS, helperRoot(), tell) : await helpers.get(id, helperRoot(), tell);
    await setSettings({ [id]: exe });
    return exe;
  });
  h('helpers:cancel', (id) => require('./helpers').cancel(id));
  h('apps:open', async (id, files) => { await crafts.openApp(id, Array.isArray(files) ? files : []); return true; });
  hE('craftweb:info', (e) => { const cw = craftOf(e.sender); return cw && { id: cw.id, name: cw.name, file: cw.file, fileName: cw.file && path.basename(cw.file), bridge: !!cw.bridge, empty: !!cw.empty, dark: nativeTheme.shouldUseDarkColors }; });
  hE('craftweb:read', async (e) => { const cw = craftOf(e.sender); return cw?.file ? fsp.readFile(cw.file) : null; });
  hE('craftweb:save', async (e, name, bytes) => { const cw = craftOf(e.sender); if (!cw) return null; const to = craftSavePath(cw, name); await fsp.writeFile(to, Buffer.from(bytes)); return { path: to }; });
  hE('craftweb:dirty', (e, dirty) => { const cw = craftOf(e.sender); if (cw) cw.dirty = !!dirty; return true; });
  hE('craftweb:show', (e, p) => { const cw = craftOf(e.sender); if (cw && cw.saved.has(p)) shell.showItemInFolder(p); return true; });
  h('recent:list', () => settings.recent.filter((r) => fs.existsSync(r.path)));
}

function registerProtocols() {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'wheel.html';
    if (rel.startsWith('drawio/')) return require('./diagrams').serveDrawio(rel.slice(7), helperRoot());
    const file = path.normalize(path.join(RENDERER, rel));
    return file.startsWith(RENDERER) ? net.fetch(pathToFileURL(file).href) : new Response('Forbidden', { status: 403 });
  });
  protocol.handle('media', (req) => {
    const u = new URL(req.url);
    const p = u.host === 'font' ? path.join(DATA, 'fonts', path.basename(decodeURIComponent(u.pathname))) : decodeURIComponent(u.pathname.slice(1));
    if (!fs.existsSync(p)) return new Response('Not found', { status: 404 });
    return fileResponse(p, req.headers.get('range'));
  });
}
const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg', mkv: 'video/x-matroska', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', weba: 'audio/webm', ttf: 'font/ttf', otf: 'font/otf', woff2: 'font/woff2', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', html: 'text/html', htm: 'text/html', json: 'application/json' };
function fileResponse(p, range) {
  const size = fs.statSync(p).size, headers = { 'Content-Type': MIME[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
  const body = (o) => require('stream').Readable.toWeb(fs.createReadStream(p, o));
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!m || (!m[1] && !m[2])) return new Response(body(), { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])), end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  return new Response(body({ start, end }), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
}

function appMenu() {
  if (!isMac) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Lime', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Command+,', click: () => openPrefs() }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [{ label: 'Choose Files…', accelerator: 'Command+O', click: pickFiles }, { label: 'Show Wheel', accelerator: 'Control+Alt+L', click: () => showWheel() }, { type: 'separator' }, { role: 'close' }] },
    { role: 'editMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'How Lime Works', click: () => openWelcome() }] },
  ]));
}

app.whenReady().then(async () => {
  // LibreOffice and Pandoc come packed with Lime; they are laid out once, a moment after the first launch.
  setTimeout(async () => { const helpers = require('./helpers'); for (const id of ['soffice', 'pandoc']) await helpers.ensure(id, HELPERS, helperRoot()).catch(log); }, 4000);
  loadSettings();
  nativeTheme.themeSource = settings.theme;
  if (isMac && !settings.dock) app.dock.hide();
  registerProtocols();
  registerIpc();
  appMenu();
  utility = spawnWorker('utility');
  for (let i = 0; i < POOL; i++) pool.push(spawnWorker('jobs'));
  buildTray();
  globalShortcut.register('Control+Alt+L', hotkey);
  require('./engines/util').configure(engineCfg());
  createWheel();
  applyCorner();
  startWatcher();
  const files = argFiles(process.argv);
  if (files.length) takeFiles(files);
  if (incoming.size) clearTimeout(incomingT), takeFiles([]);
  const harnessed = ['LIME_TEST', 'LIME_UI', 'LIME_SHOTS'].some((k) => process.env[k]);
  if (!settings.welcomed && !harnessed) setTimeout(openWelcome, 700);
  nativeTheme.on('updated', () => broadcast('theme', { dark: nativeTheme.shouldUseDarkColors }));
  app.on('child-process-gone', (e, d) => { if (d.type === 'GPU' && wheel) setTimeout(() => rebuildWheel(`graphics ${d.reason}`), 400); });
  screen.on('display-removed', () => { placed = null; sendGeo(); placeSensor(); });
  screen.on('display-metrics-changed', () => { placed = null; sendGeo(); placeSensor(); });
  screen.on('display-added', placeSensor);
  const harness = (env, name, api) => { if (!process.env[env] || app.isPackaged) return; try { require(path.join(ROOT, 'test', name))({ ...api, dir: process.env[env] }); } catch (e) { console.error(e); app.exit(1); } };
  harness('LIME_TEST', 'tools.test', { submit, jobs, app, tools });
  harness('LIME_UI', 'ui.test', { openCraftWeb, wheel: () => wheel, sensor: () => sensor, watcher: () => watcher, summon, shiftSummon, setCursor: (fn) => { cursorAt = fn; }, debug: () => ({ mode, placed: visibleRect(), window: placed, tab: tabPoint(), bloomAt, catching }), dialog, BrowserWindow, app, openEditor, editors, openPrefs, prefs: () => prefsWin, openWelcome, welcome: () => welcomeWin, peek: sendPeek, screen });
  harness('LIME_SHOTS', 'shots', { wheel: () => wheel, showWheel, openPrefs, openEditor, openWelcome, welcome: () => welcomeWin, BrowserWindow, app, summon, peek: sendPeek, screen, debug: () => ({ mode, placed: visibleRect(), window: placed, tab: tabPoint(), bloomAt }) });
});
app.on('activate', () => showWheel());
app.on('window-all-closed', (e) => { if (app.isQuitting) app.quit(); });
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (process.platform === 'win32') require('./shellsel').stop(); });
