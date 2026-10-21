'use strict';
// New versions of Lime, from its GitHub releases: the one thing Lime fetches from the internet.
// Each release carries lime-update-<platform>-<arch>.json (version, file, size, sha256), written by scripts/update-feed.mjs.
const { app, net, shell } = require('electron');
const fs = require('fs'), fsp = fs.promises, path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = 'Techno-Gatsby/LIME';
const DAY = 24 * 3600 * 1000;
const isWin = process.platform === 'win32';
// Without a signature Squirrel.Mac refuses to swap the app, so on a Mac the update is a download from the release page.
const canInstall = isWin && app.isPackaged;
// LIME_UPDATE_URL points the checks at a stand-in release folder, for tests.
const base = () => process.env.LIME_UPDATE_URL || `https://github.com/${REPO}/releases`;
const feedName = () => `lime-update-${process.platform}-${process.arch}.json`;
const dir = () => path.join(app.getPath('userData'), 'updates');

let state = { phase: 'idle', current: app.getVersion(), canInstall };
let tell = () => {};
const set = (patch) => { state = { ...state, ...patch }; tell(state); return state; };
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

// releases/latest redirects to the newest release's page, whose address ends in its tag.
async function latestTag() {
  if (process.env.LIME_UPDATE_URL) return 'latest';
  const r = await net.fetch(`${base()}/latest`, { method: 'HEAD' });
  const tag = /\/releases\/tag\/([^/?#]+)$/.exec(r.url || '')?.[1];
  if (!tag) throw new Error(r.ok ? 'No releases yet.' : `GitHub answered ${r.status}.`);
  return decodeURIComponent(tag);
}
async function check() {
  if (['checking', 'downloading'].includes(state.phase)) return state;
  set({ phase: 'checking', error: null });
  try {
    const tag = await latestTag();
    const r = await net.fetch(`${base()}/download/${tag}/${feedName()}`);
    if (r.status === 404) return set({ phase: 'latest', checked: Date.now(), note: 'No update for this kind of computer yet.' });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}.`);
    const feed = await r.json();
    if (!/^\d+\.\d+\.\d+$/.test(feed.version || '') || !/^[a-f0-9]{64}$/.test(feed.sha256 || '') || !feed.file || /[\\/]/.test(feed.file)) throw new Error('The update information is damaged.');
    const page = tag === 'latest' ? base() : `${base()}/tag/${tag}`;
    if (!newer(feed.version, state.current)) return set({ phase: 'latest', checked: Date.now(), note: null });
    const ready = canInstall && path.join(dir(), feed.file);
    if (ready && fs.existsSync(ready) && (await hash(ready)) === feed.sha256) return set({ phase: 'ready', checked: Date.now(), feed, page, tag, file: ready });
    return set({ phase: 'available', checked: Date.now(), feed, page, tag });
  } catch (e) { return set({ phase: 'error', error: e.message }); }
}
const hash = (f) => new Promise((ok, no) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', (d) => h.update(d)).on('error', no).on('end', () => ok(h.digest('hex'))); });

// Streams a file to disk while hashing it; a file that doesn't match its SHA-256 is thrown away.
async function fetchVerified(url, to, sha256, size, progress = () => {}) {
  const part = `${to}.part`;
  try {
    const r = await net.fetch(url);
    if (!r.ok || !r.body) throw new Error(`GitHub answered ${r.status}.`);
    const total = Number(r.headers.get('content-length')) || size || 0, h = crypto.createHash('sha256'), out = fs.createWriteStream(part);
    let got = 0, last = 0;
    for await (const chunk of r.body) {
      h.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
      if (total && Date.now() - last > 200) { last = Date.now(); progress(Math.min(99, Math.floor((got / total) * 100))); }
    }
    await new Promise((ok, no) => out.end((e) => (e ? no(e) : ok())));
    if (h.digest('hex') !== sha256) throw new Error('The download didn’t match its checksum, so it was thrown away.');
    await fsp.rename(part, to);
    return to;
  } catch (e) { await fsp.rm(part, { force: true }).catch(() => {}); throw e; }
}
async function download() {
  if (!canInstall) { if (state.page) shell.openExternal(state.page); return state; }
  if (state.phase !== 'available') return state;
  const { feed } = state;
  set({ phase: 'downloading', pct: 0, error: null });
  try {
    await fsp.mkdir(dir(), { recursive: true });
    for (const f of await fsp.readdir(dir())) await fsp.rm(path.join(dir(), f), { force: true });
    const file = await fetchVerified(`${base()}/download/${state.tag}/${encodeURIComponent(feed.file)}`, path.join(dir(), feed.file), feed.sha256, feed.size, (pct) => set({ pct }));
    return set({ phase: 'ready', file, pct: 100 });
  } catch (e) { return set({ phase: 'available', error: e.message }); }
}
// The installer closes Lime, installs over it silently and opens it again. It is started through cmd's
// start so it isn't a child of Lime, which the installer's taskkill /T would otherwise take down with it.
function install() {
  if (state.phase !== 'ready' || !canInstall) return false;
  const into = path.dirname(process.execPath);
  spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"start "" "${state.file}" /S /D=${into}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
  app.isQuitting = true;
  setTimeout(() => app.quit(), 300);
  return true;
}
// Once a day at most, a little after launch, when the setting allows it.
function schedule(settings, save, notify) {
  if (settings.updateCheck === false || !app.isPackaged || ['LIME_TEST', 'LIME_UI', 'LIME_SHOTS'].some((k) => process.env[k])) return;
  if (Date.now() - (settings.updateChecked || 0) < DAY) return;
  setTimeout(async () => {
    const s = await check();
    if (s.phase === 'error') return;
    save({ updateChecked: Date.now() });
    if (s.phase === 'available' && canInstall) await download();
    if (['available', 'ready'].includes(state.phase)) notify(state);
  }, 15000);
}
function init({ handle, settings, save, broadcast, notify }) {
  tell = (st) => broadcast('update:state', st);
  handle('update:status', () => state);
  handle('update:check', () => check());
  handle('update:get', () => download());
  handle('update:install', () => install());
  schedule(settings, save, notify);
}
module.exports = { init, check, download, install, fetchVerified, status: () => state, newer };
