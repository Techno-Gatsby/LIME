'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeTheme, Tray, Menu, globalShortcut, screen, clipboard, Notification, nativeImage } = require('electron');
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
const CRAFTS = app.isPackaged ? path.join(RES, 'crafts') : path.join(ROOT, 'vendor', 'crafts', `${process.platform}-${process.arch}`);
const APPS = app.isPackaged ? path.join(RES, 'apps') : path.join(ROOT, 'vendor', 'apps', `${process.platform}-${process.arch}`);
const asset = (n) => path.join(ROOT, 'build', n);

app.setName('Lime');
if (isWin) app.setAppUserModelId('app.lime.converter');
if (process.env.LIME_NO_GPU) app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
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
const DEFAULTS = { theme: 'light', askSave: true, outMode: 'beside', outFolder: '', reveal: false, notify: true, float: true, dock: false, login: false, size: 'm', anchor: null, hidden: false, shiftDrag: true, corner: true, recent: [], signatures: [] };
let settings = { ...DEFAULTS };
let saveT = null;
const loadSettings = () => {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS(), 'utf8')) }; } catch (_) { settings = { ...DEFAULTS }; }
  if (!settings.outFolder) settings.outFolder = path.join(app.getPath('downloads'), 'Lime');
};
const saveSettings = () => { clearTimeout(saveT); saveT = setTimeout(() => fsp.writeFile(SETTINGS(), JSON.stringify(settings, null, 1)).catch(() => {}), 200); };
const publicSettings = () => { const { recent, ...rest } = settings; return { ...rest, platform: process.platform }; };
function addRecent(paths, kind) {
  const at = Date.now();
  settings.recent = [...paths.map((p) => ({ path: p, kind, at })), ...settings.recent.filter((r) => !paths.includes(r.path))].slice(0, 30);
  saveSettings();
  buildTray();
}

const engineCfg = () => ({ bin: BIN, data: DATA, crafts: CRAFTS, apps: APPS, user: app.getPath('userData'), tmp: path.join(os.tmpdir(), 'lime'), soffice: settings.soffice || '', pandoc: settings.pandoc || '' });
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
  if (j.status === 'queued') { j.status = 'cancelled'; queue.splice(queue.indexOf(id), 1); emitJobs(); return; }
  pool.find((w) => w.busy === id)?.postMessage({ type: 'cancel', jobId: id });
}
let emitT = null;
function emitJobs() {
  if (emitT) return;
  emitT = setTimeout(() => {
    emitT = null;
    const list = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
    broadcast('jobs', list);
    const live = list.filter((j) => j.status === 'running' || j.status === 'queued');
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

let wheel = null, prefsWin = null, tray = null, dragTimer = null, sensor = null, watcher = null;
const editors = new Set(), pickers = new Set();
const webPrefs = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false };
const workArea = (pt) => screen.getDisplayNearestPoint(pt).workArea;
function defaultAnchor() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - 150, y: wa.y + Math.round(wa.height * 0.6) };
}
let layout = { w: 76, h: 76, ax: 38, ay: 38 }, mode = 'tab', bloomAt = null;
const clamp = (v, a, b) => Math.min(Math.max(v, a), Math.max(a, b));
function tabPoint() {
  const a = settings.anchor || defaultAnchor();
  const wa = workArea(a);
  return { x: wa.x + wa.width - 24, y: clamp(a.y, wa.y + 44, wa.y + wa.height - 44) };
}
function placeWheel() {
  if (!wheel) return null;
  const tab = tabPoint();
  const c = mode === 'tab' ? tab : bloomAt || { x: tab.x - 168, y: tab.y };
  const wa = workArea(c);
  const x = mode === 'tab' ? wa.x + wa.width - layout.w : clamp(c.x - layout.ax, wa.x, wa.x + wa.width - layout.w);
  const y = clamp(c.y - layout.ay, wa.y, wa.y + wa.height - layout.h);
  wheel.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(layout.w), height: Math.round(layout.h) });
  if (mode === 'tab' && settings.hidden) { if (wheel.isVisible()) wheel.hide(); } else if (!wheel.isVisible() && !wheel.webContents.isLoading()) wheel.showInactive();
  return { bounds: wheel.getBounds(), tab };
}
function summon(why, at, focus) {
  if (!wheel) createWheel();
  const go = () => { if (!wheel.isVisible()) wheel.showInactive(); if (focus) wheel.focus(); wheel.webContents.send('wheel:summon', { why, at: at || null, peek }); };
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
    sensor.setAlwaysOnTop(true, 'floating');
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
      const seq = ++peekSeq;
      peek = [];
      watcher?.files().then((f) => { if (seq === peekSeq) sendPeek(f); }).catch(log);
    },
    onShift: () => { if (settings.shiftDrag !== false && mode === 'tab') summon('shift', screen.getCursorScreenPoint()); },
    onEnd: () => { peekSeq++; peek = []; wheel?.webContents.send('wheel:dragEnded'); },
    onError: log,
  });
  if (watcher && process.platform === 'win32' && settings.shiftDrag !== false) setTimeout(() => require('./shellsel').warm(), 4000);
}
function createWheel() {
  wheel = new BrowserWindow({
    width: layout.w, height: layout.h, show: false, frame: false, transparent: true, resizable: false, movable: false, maximizable: false, minimizable: false,
    fullscreenable: false, hasShadow: false, skipTaskbar: true, backgroundColor: '#00000000', title: 'Lime', acceptFirstMouse: true, roundedCorners: false,
    alwaysOnTop: settings.float, ...(isMac ? { type: 'panel' } : {}), webPreferences: webPrefs,
  });
  applyFloat();
  placeWheel();
  wheel.loadURL('app://local/wheel.html');
  wheel.once('ready-to-show', () => { if (!settings.hidden || pendingShow) { wheel.showInactive(); pendingShow = false; } });
  wheel.on('closed', () => { wheel = null; });
  wheel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  wheel.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.env.LIME_SHOTS) wheel.webContents.on('console-message', (e) => console.log('[wheel]', e.message ?? e));
}
let pendingShow = false;
function applyFloat() {
  if (!wheel) return;
  wheel.setAlwaysOnTop(!!settings.float, 'floating');
  if (isMac) wheel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !!settings.float, skipTransformProcessType: true });
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
  return true;
}

// A window showing the workbook, for choosing the cells to print. Resolves with the range text, or null.
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
    { label: 'Recent', enabled: recent.length > 0, submenu: recent.length ? recent.map((r) => ({ label: path.basename(r.path), click: () => shell.showItemInFolder(r.path) })) : [{ label: 'Nothing yet', enabled: false }] },
    { type: 'separator' },
    { label: 'Float Above Windows', type: 'checkbox', checked: !!settings.float, click: (i) => setSettings({ float: i.checked }) },
    { label: 'Settings…', accelerator: isMac ? 'Command+,' : undefined, click: () => openPrefs() },
    { type: 'separator' },
    { label: 'Quit Lime', accelerator: isMac ? 'Command+Q' : undefined, click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}
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
    const c = crafts.appFor(files[0]);
    if (c) a.push({ action: 'craft', app: c.id, label: c.name, hint: 'Open in' });
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
    case 'craft': crafts.openApp(item.app, files); return null;
    case 'quicklook': execFile('qlmanage', ['-p', ...files.slice(0, 10)], () => {}); return null;
    case 'trash': for (const f of files) await shell.trashItem(f); return `Moved ${files.length === 1 ? path.basename(files[0]) : `${files.length} files`} to the Trash`;
    case 'reveal': shell.showItemInFolder(files[0]); return null;
    default: return null;
  }
}

function broadcast(ch, payload) { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, payload); }
async function setSettings(patch) {
  const before = { ...settings };
  Object.assign(settings, patch);
  saveSettings();
  if ('theme' in patch) nativeTheme.themeSource = settings.theme;
  if ('float' in patch) applyFloat();
  if ('anchor' in patch || 'hidden' in patch) placeWheel();
  if ('corner' in patch) applyCorner();
  if ('dock' in patch && isMac) settings.dock ? app.dock.show() : app.dock.hide();
  if ('login' in patch) app.setLoginItemSettings({ openAtLogin: !!settings.login, openAsHidden: true });
  if (('soffice' in patch && patch.soffice !== before.soffice) || ('pandoc' in patch && patch.pandoc !== before.pandoc)) { require('./engines/util').configure(engineCfg()); [...pool, utility].forEach((w) => w.postMessage({ type: 'config', cfg: engineCfg() })); }
  buildTray();
  broadcast('settings', publicSettings());
  return publicSettings();
}
function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(...a));
  const hE = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(e, ...a));
  h('app:info', () => ({ version: app.getVersion(), platform: process.platform, dark: nativeTheme.shouldUseDarkColors, home: os.homedir() }));
  h('catalog', () => tools.catalog());
  h('wheel:items', (files) => ({ ...tools.wheelsFor(files), more: actionsFor(files), all: tools.toolsFor(files) }));
  h('wheel:action', (item, files) => doAction(item, files));
  h('wheel:layout', ({ mode: m, at, ...l }) => {
    layout = { ...layout, ...l };
    if (m === 'tab') bloomAt = null;
    if (m === 'open' && at) bloomAt = at;
    if (m) mode = m;
    return placeWheel();
  });
  h('wheel:peek', () => peek);
  h('wheel:haptic', () => { try { watcher?.probe.haptic?.(); } catch (_) {} });
  h('sensor:enter', () => { if (mode === 'tab') summon('corner', cornerPoint()); });
  h('sensor:drop', (files) => takeFiles(files));
  h('wheel:hide', () => setSettings({ hidden: true }));
  h('wheel:menu', () => Menu.buildFromTemplate([
    { label: 'Choose Files…', click: pickFiles },
    { label: 'Settings…', click: () => openPrefs() },
    { type: 'separator' },
    { label: 'Size', submenu: [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([v, l]) => ({ label: l, type: 'radio', checked: settings.size === v, click: () => setSettings({ size: v }) })) },
    { label: 'Float Above Windows', type: 'checkbox', checked: !!settings.float, click: (i) => setSettings({ float: i.checked }) },
    { label: 'Reset Position', click: () => { settings.anchor = null; bloomAt = null; saveSettings(); placeWheel(); } },
    { type: 'separator' },
    { label: 'Hide from Screen Edge', click: () => setSettings({ hidden: true }) },
    { label: 'Quit Lime', click: () => { app.isQuitting = true; app.quit(); } },
  ]).popup({ window: wheel }));
  h('wheel:dragStart', () => {
    clearInterval(dragTimer);
    const start = screen.getCursorScreenPoint();
    const a0 = settings.anchor || defaultAnchor();
    const b = wheel.getBounds(), b0 = bloomAt || { x: b.x + layout.ax, y: b.y + layout.ay };
    dragTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      if (mode === 'tab') settings.anchor = { x: p.x, y: a0.y + p.y - start.y };
      else bloomAt = { x: b0.x + p.x - start.x, y: b0.y + p.y - start.y };
      placeWheel();
    }, 12);
  });
  h('wheel:dragEnd', () => { clearInterval(dragTimer); dragTimer = null; saveSettings(); });
  h('files:thumb', (p, size) => call('thumbnail', p, size).catch(() => null));
  h('tools:suggest', (tool, files, opts) => tools.suggest(tool, files, opts));
  h('tools:accepts', (tool, files) => tools.accepts(tools.get(tool), files));
  h('files:dataUrl', async (p, max = 1800) => {
    const buf = await (await require('./engines/image').open(p)).rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return `data:image/png;base64,${buf.toString('base64')}`;
  });
  h('app:paths', () => ({ licenses: app.isPackaged ? path.join(RES, 'LICENSES') : path.join(ROOT, 'LICENSES'), userData: app.getPath('userData') }));
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
  h('cells:pick', (file, value) => (file ? pickCells(file, value || '') : null));
  hE('picker:data', async (e) => { const d = BrowserWindow.fromWebContents(e.sender)?.pickerData; return d ? { ...d, ...(await call('sheetPreview', d.file)) } : null; });
  hE('picker:done', (e, v) => { BrowserWindow.fromWebContents(e.sender)?.pick?.(v); });
  h('editor:call', (method, ...args) => call(`editor.${method}`, ...args));
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
  h('prefs:open', (tab) => openPrefs(tab));
  h('engines:status', () => call('enginesStatus'));
  h('apps:open', async (id) => { await crafts.openApp(id, []); return true; });
  h('recent:list', () => settings.recent.filter((r) => fs.existsSync(r.path)));
}

function registerProtocols() {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'wheel.html';
    const file = path.normalize(path.join(RENDERER, rel));
    return file.startsWith(RENDERER) ? net.fetch(pathToFileURL(file).href) : new Response('Forbidden', { status: 403 });
  });
  protocol.handle('media', (req) => {
    const u = new URL(req.url);
    const p = u.host === 'font' ? path.join(DATA, 'fonts', path.basename(decodeURIComponent(u.pathname))) : decodeURIComponent(u.pathname.slice(1));
    return fs.existsSync(p) ? net.fetch(pathToFileURL(p).href, { headers: req.headers }) : new Response('Not found', { status: 404 });
  });
}

function appMenu() {
  if (!isMac) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Lime', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Command+,', click: () => openPrefs() }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [{ label: 'Choose Files…', accelerator: 'Command+O', click: pickFiles }, { label: 'Show Wheel', accelerator: 'Control+Alt+L', click: () => showWheel() }, { type: 'separator' }, { role: 'close' }] },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

app.whenReady().then(async () => {
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
  nativeTheme.on('updated', () => broadcast('theme', { dark: nativeTheme.shouldUseDarkColors }));
  screen.on('display-removed', () => { placeWheel(); placeSensor(); });
  screen.on('display-metrics-changed', () => { placeWheel(); placeSensor(); });
  screen.on('display-added', placeSensor);
  const harness = (env, name, api) => { if (!process.env[env] || app.isPackaged) return; try { require(path.join(ROOT, 'test', name))({ ...api, dir: process.env[env] }); } catch (e) { console.error(e); app.exit(1); } };
  harness('LIME_TEST', 'tools.test', { submit, jobs, app, tools });
  harness('LIME_UI', 'ui.test', { wheel: () => wheel, sensor: () => sensor, watcher: () => watcher, summon, dialog, BrowserWindow, app, openEditor, editors, openPrefs, prefs: () => prefsWin, peek: sendPeek, screen });
  harness('LIME_SHOTS', 'shots', { wheel: () => wheel, showWheel, openPrefs, openEditor, BrowserWindow, app, summon, peek: sendPeek, screen });
});
app.on('activate', () => showWheel());
app.on('window-all-closed', (e) => { if (app.isQuitting) app.quit(); });
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (process.platform === 'win32') require('./shellsel').stop(); });
