'use strict';
const {
  app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeTheme, Tray, Menu, globalShortcut,
  screen, clipboard, Notification, nativeImage, systemPreferences,
} = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { Worker } = require('worker_threads');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

const isWin = process.platform === 'win32';
const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const RES = app.isPackaged ? process.resourcesPath : path.join(ROOT, 'vendor');
const BIN = app.isPackaged ? path.join(RES, 'bin') : path.join(ROOT, 'vendor', 'bin', process.platform);
const DATA = path.join(RES, 'data');
const ICON = path.join(ROOT, 'build', isWin ? 'icon.ico' : 'icon.png');

app.setAppUserModelId('com.clementine.converter');
if (process.env.CLEM_DISABLE_GPU) app.disableHardwareAcceleration();

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

/* ---------- single instance & command line ---------- */
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
let pendingArgs = { files: new Set(), mode: null, timer: null };
function parseArgs(argv) {
  const mode = argv.includes('--wheel') ? 'wheel' : argv.includes('--open') ? 'open' : argv.includes('--dock') ? 'dock' : null;
  const files = argv.slice(1).filter((a) => !a.startsWith('--') && a !== '.' && path.isAbsolute(a) && fs.existsSync(a) && path.resolve(a) !== path.resolve(process.execPath));
  return { mode, files };
}
// Explorer launches one process per selected file; gather them into one batch.
function queueArgs(argv) {
  const { mode, files } = parseArgs(argv);
  files.forEach((f) => pendingArgs.files.add(f));
  pendingArgs.mode = pendingArgs.mode || mode;
  clearTimeout(pendingArgs.timer);
  pendingArgs.timer = setTimeout(flushArgs, 350);
}
function flushArgs() {
  const files = [...pendingArgs.files];
  const mode = pendingArgs.mode;
  pendingArgs = { files: new Set(), mode: null, timer: null };
  if (mode === 'dock') { setDock(true); return; }
  if (!files.length) { showMain(); return; }
  if (mode === 'wheel') showOverlay(files);
  else showMain({ files });
}
app.on('second-instance', (e, argv) => queueArgs(argv));

/* ---------- settings ---------- */
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  theme: 'system', outMode: 'beside', outFolder: '', openFolder: false, notify: true,
  dock: false, hotkey: true, contextMenu: isWin, launchAtLogin: false,
  keys: { convert: 'Shift', tools: 'Control', actions: 'Alt' }, recent: [], firstRun: true, signatures: [],
};
let settings = { ...DEFAULTS };
function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) }; } catch (_) { settings = { ...DEFAULTS }; }
  if (!settings.outFolder) settings.outFolder = path.join(app.getPath('downloads'), 'Clementine');
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fsp.writeFile(SETTINGS_FILE(), JSON.stringify(settings, null, 2)).catch(() => {}), 200);
}
function addRecent(entries) {
  const now = Date.now();
  const list = settings.recent.filter((r) => !entries.some((e) => e.path === r.path));
  settings.recent = [...entries.map((e) => ({ ...e, at: now })), ...list].slice(0, 40);
  saveSettings();
  broadcast('recent', settings.recent);
}

/* ---------- engine workers ---------- */
const engineCfg = () => ({ bin: BIN, data: DATA, user: app.getPath('userData'), tmp: path.join(os.tmpdir(), 'clementine'), soffice: settings.soffice || '' });
const POOL_SIZE = Math.max(1, Math.min(3, os.cpus().length - 1));
const pool = [];
let utility = null;
const calls = new Map();
let callSeq = 0;
function spawnWorker(role) {
  const w = new Worker(path.join(__dirname, 'worker.js'), { workerData: { cfg: engineCfg(), role } });
  w.role = role;
  w.busy = null;
  w.on('message', (m) => onWorkerMessage(w, m));
  w.on('error', (e) => { console.error('worker error', e); if (w.busy) failJob(w.busy, e.message || 'The engine stopped unexpectedly.'); });
  w.on('exit', (code) => {
    if (w.busy) failJob(w.busy, 'The engine stopped unexpectedly. Try again.');
    for (const [id, c] of calls) if (c.worker === w) { calls.delete(id); c.reject(new Error('The engine restarted. Try again.')); }
    if (role === 'utility') utility = spawnWorker('utility');
    else { const i = pool.indexOf(w); if (i >= 0) pool[i] = spawnWorker('jobs'); pump(); }
  });
  return w;
}
function call(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = ++callSeq;
    calls.set(id, { resolve, reject, worker: utility });
    utility.postMessage({ type: 'call', id, method, args });
  });
}
function onWorkerMessage(w, m) {
  if (m.type === 'callResult') {
    const c = calls.get(m.id);
    if (!c) return;
    calls.delete(m.id);
    if (m.error) c.reject(Object.assign(new Error(m.error), { code: m.code })); else c.resolve(m.result);
  } else if (m.type === 'host') {
    runHost(m.method, m.payload).then((result) => w.postMessage({ type: 'hostResult', id: m.id, result }), (e) => w.postMessage({ type: 'hostResult', id: m.id, error: e.message }));
  } else if (m.type === 'progress') updateJob(m.jobId, { progress: m.progress, label: m.label || jobs.get(m.jobId)?.label });
  else if (m.type === 'done') finishJob(w, m.jobId, m.results);
  else if (m.type === 'failed') { const job = jobs.get(m.jobId); w.busy = null; if (job) Object.assign(job, { status: m.cancelled ? 'cancelled' : 'error', error: m.error, code: m.code, engine: m.engine, finishedAt: Date.now() }); emitJobs(); pump(); }
}

/* ---------- host services for engines (need Chromium) ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function loadInto(win, { file, url }) {
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('The page took too long to load.')), 45000));
  const load = url ? win.loadURL(url, { userAgent: win.webContents.getUserAgent().replace(/Electron\/\S+\s?/, '') }) : win.loadFile(file);
  await Promise.race([load.catch((e) => { if (!/ERR_ABORTED/.test(e.message)) throw e; }), timeout]);
  await sleep(url ? 1800 : 400);
}
async function runHost(method, p) {
  if (method === 'htmlToPdf') {
    const win = new BrowserWindow({ show: false, width: 1100, height: 1400, webPreferences: { sandbox: true, javascript: !!p.url } });
    try {
      await loadInto(win, p);
      const data = await win.webContents.printToPDF({ landscape: !!p.landscape, pageSize: p.pageSize || 'A4', printBackground: true, margins: { marginType: 'default' } });
      await fsp.writeFile(p.out, data);
      return p.out;
    } finally { win.destroy(); }
  }
  if (method === 'urlToImage') {
    const win = new BrowserWindow({ show: false, width: 1366, height: 900, useContentSize: true, webPreferences: { sandbox: true, offscreen: false } });
    try {
      await loadInto(win, p);
      const h = await win.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)').catch(() => 900);
      win.setContentSize(1366, Math.min(Math.max(900, h), 16000));
      await sleep(700);
      const img = await win.webContents.capturePage();
      await fsp.writeFile(p.out, img.toPNG());
      return p.out;
    } finally { win.destroy(); }
  }
  throw new Error(`Unknown host call ${method}`);
}

/* ---------- jobs ---------- */
const tools = require('./tools');
const jobs = new Map();
const queue = [];
function submit({ tool, files = [], opts = {} }) {
  const t = tools.get(tool);
  if (!t) throw new Error('Unknown tool');
  const id = crypto.randomUUID();
  const job = { id, tool, name: t.name, icon: t.icon, cat: t.cat, files, opts, status: 'queued', progress: 0, label: 'Waiting', results: [], createdAt: Date.now(), outMode: settings.outMode, outFolder: settings.outFolder };
  jobs.set(id, job);
  queue.push(id);
  if (files.length) addRecent(files.slice(0, 10).map((p) => ({ path: p, kind: 'input' })));
  emitJobs();
  pump();
  return id;
}
function pump() {
  for (const w of pool) {
    if (w.busy || !queue.length) continue;
    const id = queue.shift();
    const job = jobs.get(id);
    if (!job || job.status !== 'queued') continue;
    w.busy = id;
    Object.assign(job, { status: 'running', startedAt: Date.now(), label: 'Starting' });
    w.postMessage({ type: 'run', job: { id, tool: job.tool, files: job.files, opts: job.opts, outMode: job.outMode, outFolder: job.outFolder } });
  }
  emitJobs();
}
function updateJob(id, patch) { const j = jobs.get(id); if (j) { Object.assign(j, patch); emitJobs(); } }
function finishJob(w, id, results) {
  w.busy = null;
  const job = jobs.get(id);
  if (job) {
    Object.assign(job, { status: 'done', progress: 1, results, finishedAt: Date.now(), label: 'Done' });
    const outs = results.flatMap((r) => r.paths || (r.path ? [r.path] : []));
    if (outs.length) addRecent(outs.slice(0, 10).map((p) => ({ path: p, kind: 'output', tool: job.tool })));
    notifyDone(job, outs);
    if (settings.openFolder && outs[0] && !results[0]?.inPlace) shell.showItemInFolder(outs[0]);
  }
  emitJobs();
  pump();
}
function failJob(id, error) {
  const job = jobs.get(id);
  if (job && job.status === 'running') Object.assign(job, { status: 'error', error, finishedAt: Date.now() });
  pool.forEach((w) => { if (w.busy === id) w.busy = null; });
  emitJobs();
}
function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === 'queued') { job.status = 'cancelled'; const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1); emitJobs(); return; }
  const w = pool.find((x) => x.busy === id);
  w?.postMessage({ type: 'cancel', jobId: id });
}
let emitTimer = null;
function emitJobs() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    const list = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
    broadcast('jobs', list);
    const running = list.filter((j) => j.status === 'running' || j.status === 'queued');
    const p = running.length ? running.reduce((s, j) => s + (j.progress || 0), 0) / running.length : -1;
    if (mainWin && !mainWin.isDestroyed()) mainWin.setProgressBar(p < 0 ? -1 : Math.max(0.02, p), { mode: running.length ? 'normal' : 'none' });
  }, 90);
}
function notifyDone(job, outs) {
  if (!settings.notify || !Notification.isSupported()) return;
  if (mainWin && mainWin.isFocused()) return;
  const r = job.results[0] || {};
  const n = new Notification({
    title: `${job.name}: done`,
    body: r.note && !/\n/.test(r.note) ? `${outs[0] ? path.basename(outs[0]) : ''}\n${r.note}` : outs.length ? outs.map((o) => path.basename(o)).slice(0, 3).join(', ') : 'Finished',
    icon: ICON, silent: true,
  });
  n.on('click', () => { if (outs[0]) shell.showItemInFolder(outs[0]); });
  n.show();
}

/* ---------- windows ---------- */
let mainWin = null, overlayWin = null, dockWin = null, tray = null;
const prefs = (extra = {}) => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, ...extra });
function themeColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { dark, symbol: dark ? '#ffffff' : '#1b1b1b', bg: dark ? '#202020' : '#f3f3f3' };
}
function accent() {
  try { if (isWin || process.platform === 'darwin') { const a = systemPreferences.getAccentColor(); if (a) return `#${a.slice(0, 6)}`; } } catch (_) { /* ignore */ }
  return '#0f6cbd';
}
function createMain() {
  const t = themeColors();
  const area = screen.getPrimaryDisplay().workAreaSize;
  mainWin = new BrowserWindow({
    width: Math.min(1280, area.width - 80), height: Math.min(840, area.height - 60), minWidth: 400, minHeight: 520,
    show: false, title: 'Clementine', icon: ICON,
    backgroundColor: isWin ? '#00000000' : t.bg,
    ...(isWin ? { backgroundMaterial: 'mica' } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: t.symbol, height: 44 },
    webPreferences: prefs(),
  });
  mainWin.loadURL('app://local/index.html');
  mainWin.once('ready-to-show', () => { mainWin.show(); });
  mainWin.on('closed', () => { mainWin = null; });
  mainWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  mainWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  return mainWin;
}
function showMain(payload) {
  if (!mainWin) createMain();
  const send = () => { if (payload) mainWin.webContents.send('open', payload); };
  if (mainWin.webContents.isLoading()) mainWin.webContents.once('did-finish-load', () => setTimeout(send, 150)); else send();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

/** Tangerine-style wheel that appears at the mouse pointer over whatever you’re doing. */
async function showOverlay(files) {
  const pt = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(pt);
  const b = display.bounds;
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  overlayWin = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, fullscreenable: false, backgroundColor: '#00000000',
    webPreferences: prefs(),
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.overlayData = { files, x: pt.x - b.x, y: pt.y - b.y, wheels: await wheelsFor(files) };
  overlayWin.loadURL('app://local/overlay.html');
  overlayWin.once('ready-to-show', () => { overlayWin.show(); overlayWin.focus(); });
  if (process.env.CLEM_SHOTS) overlayWin.webContents.once('did-finish-load', async () => { await sleep(1500); const img = await overlayWin.webContents.capturePage(); fs.writeFileSync(path.join(process.env.CLEM_SHOTS, 'overlay.png'), img.toPNG()); });
  overlayWin.on('blur', () => { if (overlayWin && !overlayWin.keepOpen) closeOverlay(); });
  overlayWin.on('closed', () => { overlayWin = null; });
}
function closeOverlay() { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy(); overlayWin = null; }

const DOCK_SMALL = 88, DOCK_BIG = 470;
function dockBounds(big) {
  const wa = screen.getPrimaryDisplay().workArea;
  const s = big ? DOCK_BIG : DOCK_SMALL;
  return { x: wa.x + wa.width - s - 16, y: wa.y + wa.height - s - 16, width: s, height: s };
}
function setDock(on) {
  settings.dock = !!on;
  saveSettings();
  if (on && !dockWin) {
    dockWin = new BrowserWindow({
      ...dockBounds(false), frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true,
      hasShadow: false, focusable: true, maximizable: false, minimizable: false, fullscreenable: false, backgroundColor: '#00000000', webPreferences: prefs(),
    });
    dockWin.setAlwaysOnTop(true, 'floating');
    dockWin.loadURL('app://local/dock.html');
    dockWin.on('closed', () => { dockWin = null; });
  } else if (!on && dockWin) { dockWin.destroy(); dockWin = null; }
  buildTray();
  broadcast('settings', publicSettings());
}

function buildTray() {
  if (!tray) {
    const img = nativeImage.createFromPath(path.join(ROOT, 'build', 'tray.png'));
    tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(path.join(ROOT, 'build', 'icon.png')).resize({ width: 16, height: 16 }) : img);
    tray.setToolTip('Clementine');
    tray.on('click', () => showMain());
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Clementine', click: () => showMain() },
    { label: 'Drop dock', type: 'checkbox', checked: !!settings.dock, click: (i) => setDock(i.checked) },
    { label: 'Convert selected files', accelerator: 'Ctrl+Shift+Space', enabled: isWin, click: () => hotkeyWheel() },
    { type: 'separator' },
    { label: 'Activity', click: () => showMain({ route: 'activity' }) },
    { label: 'Settings', click: () => showMain({ route: 'settings' }) },
    { type: 'separator' },
    { label: 'Quit Clementine', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}
async function hotkeyWheel() {
  const files = await require('./explorer').explorerSelection();
  if (files.length) showOverlay(files);
  else showMain({ toast: 'Select files in File Explorer first, then press Ctrl+Shift+Space.' });
}
function applyHotkey() {
  globalShortcut.unregisterAll();
  if (settings.hotkey && isWin) globalShortcut.register('CommandOrControl+Shift+Space', hotkeyWheel);
}

/* ---------- wheels & actions ---------- */
const craft = require('./craft');
async function wheelsFor(files) {
  return { convert: tools.wheelFor(files, 'convert'), tools: tools.wheelFor(files, 'tools'), actions: actionsFor(files) };
}
function actionsFor(files) {
  const one = files.length === 1;
  const a = [
    { action: 'open', label: 'Open', hint: one ? 'Default app' : `${files.length} files` },
    { action: 'show', label: 'Show', hint: 'In Explorer' },
    { action: 'copyFiles', label: 'Copy', hint: one ? 'File' : 'Files' },
    { action: 'copyPath', label: 'Copy path', hint: 'As text' },
    { action: 'app', label: 'All tools', hint: 'Clementine' },
  ];
  if (one) {
    const c = craft.suggestFor(files[0]);
    if (c) a.push({ action: 'craft', app: c.id, label: c.name, hint: 'Open in' });
    a.push({ action: 'hash', label: 'SHA-256', hint: 'Copy hash' });
    if (isWin) a.push({ action: 'properties', label: 'Properties', hint: 'Windows' });
  }
  a.push({ action: 'trash', label: 'Recycle', hint: 'Delete' });
  return a;
}
async function doAction(item, files) {
  switch (item.action) {
    case 'open': files.slice(0, 20).forEach((f) => shell.openPath(f)); return null;
    case 'show': shell.showItemInFolder(files[0]); return null;
    case 'copyPath': clipboard.writeText(files.join('\r\n')); return `Copied ${files.length === 1 ? 'path' : `${files.length} paths`}`;
    case 'copyFiles':
      if (isWin) { await require('./explorer').copyFiles(files); return `Copied ${files.length === 1 ? 'file' : `${files.length} files`}. Paste anywhere.`; }
      clipboard.writeText(files.join('\n')); return 'Copied paths';
    case 'app': showMain({ files }); return null;
    case 'craft': {
      const info = craft.list().find((x) => x.id === item.app);
      if (!info?.installed) { showMain({ route: 'studio', highlight: item.app }); return null; }
      craft.open(item.app, files); return null;
    }
    case 'hash': { const h = await require('./engines/util').hashFile(files[0], 'sha256'); clipboard.writeText(h); return `SHA-256 copied: ${h.slice(0, 16)}…`; }
    case 'properties': require('./explorer').properties(files[0]); return null;
    case 'trash': for (const f of files) await shell.trashItem(f); return `Moved ${files.length === 1 ? path.basename(files[0]) : `${files.length} files`} to the Recycle Bin`;
    default: return null;
  }
}

/* ---------- IPC ---------- */
function broadcast(ch, payload) { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, payload); }
const publicSettings = () => { const { recent, ...rest } = settings; return { ...rest, contextMenuSupported: isWin, hotkeySupported: isWin }; };
const CATEGORIES = [
  { id: 'pdf', name: 'PDF', icon: 'pdf', desc: 'Edit, convert, merge, split, compress, sign and protect PDFs.' },
  { id: 'image', name: 'Images', icon: 'image', desc: 'Convert, compress, resize, cut out and enhance photos.' },
  { id: 'media', name: 'Video & audio', icon: 'video', desc: 'Convert, compress, trim and merge video and sound.' },
  { id: 'docs', name: 'Documents', icon: 'document', desc: 'Word, Excel, PowerPoint, eBooks and text formats.' },
  { id: 'archive', name: 'Archives', icon: 'zip', desc: 'Extract and create ZIP, RAR, 7Z, TAR and more.' },
  { id: 'utility', name: 'Utilities', icon: 'wrench', desc: 'Checksums and batch renaming.' },
];

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, async (e, ...args) => fn(...args));
  const hE = (ch, fn) => ipcMain.handle(ch, async (e, ...args) => fn(e, ...args));
  h('app:info', () => ({ version: app.getVersion(), platform: process.platform, isWin, accent: accent(), dark: nativeTheme.shouldUseDarkColors, home: os.homedir(), downloads: app.getPath('downloads') }));
  h('catalog', () => ({ tools: tools.catalog(), categories: CATEGORIES }));
  h('files:toolsFor', (paths) => tools.toolsFor(paths));
  h('files:describe', (p) => call('describe', p));
  h('files:thumb', (p, size) => call('thumbnail', p, size).catch(() => null));
  h('files:dataUrl', async (p, max = 1800) => {
    const img = require('./engines/image');
    const buf = await (await img.open(p)).rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return `data:image/png;base64,${buf.toString('base64')}`;
  });
  h('files:expand', async (paths) => paths.filter((p) => fs.existsSync(p)));
  h('wheel:items', (files) => wheelsFor(files));
  h('wheel:action', (item, files) => doAction(item, files));
  h('jobs:submit', (job) => submit(job));
  h('jobs:list', () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt));
  h('jobs:cancel', (id) => cancelJob(id));
  h('jobs:clear', () => { for (const [id, j] of jobs) if (!['running', 'queued'].includes(j.status)) jobs.delete(id); emitJobs(); });
  hE('dialog:open', async (e, o = {}) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const props = [o.folders ? 'openDirectory' : 'openFile', ...(o.multi !== false ? ['multiSelections'] : [])];
    const r = await dialog.showOpenDialog(win, { properties: props, filters: o.filters, title: o.title });
    return r.canceled ? [] : r.filePaths;
  });
  hE('dialog:save', async (e, o = {}) => {
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: o.defaultPath, filters: o.filters });
    return r.canceled ? null : r.filePath;
  });
  h('shell:open', (p) => shell.openPath(p));
  h('shell:show', (p) => shell.showItemInFolder(p));
  h('shell:external', (u) => (/^https?:\/\//.test(u) ? shell.openExternal(u) : null));
  h('shell:trash', (p) => shell.trashItem(p));
  h('clip:text', (t) => clipboard.writeText(String(t)));
  h('clip:files', (paths) => doAction({ action: 'copyFiles' }, paths));
  ipcMain.on('drag:start', (e, paths) => {
    const icon = nativeImage.createFromPath(path.join(ROOT, 'build', 'drag.png'));
    e.sender.startDrag({ files: paths, file: paths[0], icon: icon.isEmpty() ? nativeImage.createFromPath(path.join(ROOT, 'build', 'icon.png')).resize({ width: 32, height: 32 }) : icon });
  });
  h('settings:get', () => publicSettings());
  h('settings:set', async (patch) => {
    const before = { ...settings };
    Object.assign(settings, patch);
    saveSettings();
    if ('theme' in patch) { nativeTheme.themeSource = settings.theme; }
    if ('dock' in patch && patch.dock !== before.dock) setDock(patch.dock);
    if ('hotkey' in patch) applyHotkey();
    if ('launchAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!settings.launchAtLogin, args: ['--hidden'] });
    if ('contextMenu' in patch) await require('./explorer').setContextMenu(!!settings.contextMenu).catch((e) => { settings.contextMenu = before.contextMenu; throw e; });
    if ('soffice' in patch) [...pool, utility].forEach((w) => w.postMessage({ type: 'config', cfg: engineCfg() }));
    broadcast('settings', publicSettings());
    return publicSettings();
  });
  h('recent:list', () => settings.recent.filter((r) => fs.existsSync(r.path)));
  h('recent:clear', () => { settings.recent = []; saveSettings(); broadcast('recent', []); });
  h('engines:status', () => require('./engines/engines-optional').status());
  h('engines:install', async (name) => {
    const OE = require('./engines/engines-optional');
    const fn = OE.INSTALLERS[name];
    if (!fn) throw new Error('Unknown engine');
    await fn((f, label) => broadcast('engines:progress', { name, progress: f, label }));
    broadcast('engines:progress', { name, progress: 1, label: 'Installed' });
    return OE.status();
  });
  h('engines:uninstall', async (name) => { const OE = require('./engines/engines-optional'); await OE.uninstall(name); return OE.status(); });
  h('craft:list', () => craft.list());
  h('craft:install', async (id) => craft.install(id, (f, label) => broadcast('craft:progress', { id, progress: f, label })));
  h('craft:uninstall', (id) => craft.uninstall(id));
  h('craft:check', (id) => craft.checkUpdate(id));
  h('craft:open', (id, files) => craft.open(id, files || []));
  h('editor:call', (method, ...args) => call(`editor.${method}`, ...args));
  h('main:show', (payload) => showMain(payload));
  // overlay & dock
  h('overlay:data', () => overlayWin?.overlayData || null);
  h('overlay:keep', (keep) => { if (overlayWin) overlayWin.keepOpen = !!keep; });
  h('overlay:close', () => closeOverlay());
  h('dock:expand', (big) => { if (dockWin) { dockWin.setBounds(dockBounds(big), false); } });
  h('dock:hide', () => setDock(false));
}

/* ---------- protocols ---------- */
function registerProtocols() {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  // media://file/<encoded absolute path> — local previews (video/audio/fonts) for the renderer
  protocol.handle('media', (req) => {
    const u = new URL(req.url);
    const p = u.host === 'font' ? path.join(DATA, 'fonts', path.basename(decodeURIComponent(u.pathname))) : decodeURIComponent(u.pathname.slice(1));
    if (!fs.existsSync(p)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(p).href, { headers: req.headers });
  });
}

/* ---------- lifecycle ---------- */
app.whenReady().then(async () => {
  loadSettings();
  nativeTheme.themeSource = settings.theme;
  registerProtocols();
  registerIpc();
  utility = spawnWorker('utility');
  for (let i = 0; i < POOL_SIZE; i++) pool.push(spawnWorker('jobs'));
  buildTray();
  applyHotkey();
  if (isWin && app.isPackaged) {
    // Toast notifications need a Start menu shortcut carrying our AppUserModelID.
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Clementine.lnk');
    try { shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'update' : 'create', { target: process.execPath, appUserModelId: 'com.clementine.converter', icon: process.execPath, iconIndex: 0 }); } catch (_) { /* best effort */ }
  }
  if (isWin && settings.firstRun) {
    settings.firstRun = false;
    saveSettings();
    if (settings.contextMenu) require('./explorer').setContextMenu(true).catch(() => {});
  }
  if (settings.dock) setDock(true);
  nativeTheme.on('updated', () => {
    const t = themeColors();
    if (mainWin && !mainWin.isDestroyed()) { try { mainWin.setTitleBarOverlay({ symbolColor: t.symbol, color: '#00000000' }); } catch (_) { /* not supported */ } }
    broadcast('theme', { dark: t.dark, accent: accent() });
  });
  const startHidden = process.argv.includes('--hidden');
  const { mode, files } = parseArgs(process.argv);
  if (files.length || mode) queueArgs(process.argv);
  else if (!startHidden) showMain();
  if (process.env.CLEM_SHOTS && mainWin) devScreenshots(process.env.CLEM_SHOTS, (process.env.CLEM_ROUTES || 'home').split('§'));
});

/* Development aid: CLEM_SHOTS=<dir> CLEM_ROUTES=home,cat/pdf,… captures each screen, then quits. */
async function devScreenshots(dir, routes) {
  await new Promise((r) => mainWin.webContents.once('did-finish-load', r));
  await sleep(1500);
  fs.mkdirSync(dir, { recursive: true });
  for (const r of routes) {
    const i = r.indexOf('|'); const hash = i < 0 ? r : r.slice(0, i); const js = i < 0 ? '' : r.slice(i + 1);
    await mainWin.webContents.executeJavaScript(`location.hash = '#/${hash}'`);
    await sleep(1600);
    if (js) { await mainWin.webContents.executeJavaScript(js).catch((e) => console.error('shot js', e)); await sleep(2600); }
    const img = await mainWin.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${String(routes.indexOf(r)).padStart(2, '0')}-${hash.replace(/\W+/g, '_') || 'home'}.png`), img.toPNG());
  }
  app.isQuitting = true;
  app.quit();
}
app.on('window-all-closed', (e) => { if (!settings.dock || app.isQuitting) app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => { app.isQuitting = true; });
