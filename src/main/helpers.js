'use strict';
// The optional helpers, fetched from their makers' own download servers and unpacked into Lime's folder: no
// installer, no administrator rights, and nothing else on the computer changes.
const fs = require('fs'), fsp = require('fs/promises'), path = require('path');
const { spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const isMac = process.platform === 'darwin', isWin = process.platform === 'win32', arm = process.arch === 'arm64';
const sys32 = (exe) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe);

const run = (cmd, args) => new Promise((ok, no) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', no);
  p.on('close', (c) => (c === 0 ? ok() : no(new Error(err.trim() || `${path.basename(cmd)} exited with ${c}`))));
});
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
// The first file of that name anywhere under a folder.
async function find(dir, name, depth = 6) {
  let ents = [];
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return null; }
  for (const e of ents) if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return path.join(dir, e.name);
  if (depth) for (const e of ents) if (e.isDirectory()) { const f = await find(path.join(dir, e.name), name, depth - 1); if (f) return f; }
  return null;
}
async function text(url, signal) {
  const r = await fetch(url, { signal, redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.text();
}

const HELPERS = {
  soffice: {
    name: 'LibreOffice', size: 350,
    async latest(signal) {
      const html = await text('https://download.documentfoundation.org/libreoffice/stable/', signal);
      const v = [...html.matchAll(/href="(\d+\.\d+\.\d+)\/"/g)].map((m) => m[1]).sort(cmp).pop();
      if (!v) throw new Error('the list of LibreOffice releases could not be read');
      return v;
    },
    url: (v) => `https://download.documentfoundation.org/libreoffice/stable/${v}/${isWin ? `win/x86_64/LibreOffice_${v}_Win_x86-64.msi` : `mac/${arm ? 'aarch64' : 'x86_64'}/LibreOffice_${v}_MacOS_${arm ? 'aarch64' : 'x86-64'}.dmg`}`,
    async unpack(file, dir) {
      if (isWin) {
        // An administrative install only lays the files out: it needs no rights and installs nothing.
        await run(sys32('msiexec.exe'), ['/a', file, '/qn', `TARGETDIR=${dir}`]);
        return find(dir, 'soffice.exe');
      }
      const mnt = path.join(dir, 'mnt');
      await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noverify', '-mountpoint', mnt, file]);
      try { await run('/usr/bin/ditto', [path.join(mnt, 'LibreOffice.app'), path.join(dir, 'LibreOffice.app')]); } finally { await run('/usr/bin/hdiutil', ['detach', mnt, '-force']).catch(() => {}); }
      return find(path.join(dir, 'LibreOffice.app', 'Contents', 'MacOS'), 'soffice', 0);
    },
  },
  pandoc: {
    name: 'Pandoc', size: 40,
    async latest(signal) {
      // The latest release's page points at its tag; GitHub's API is the fallback.
      const r = await fetch('https://github.com/jgm/pandoc/releases/latest', { signal, redirect: 'manual' });
      const tag = /\/tag\/v?([\d.]+)$/.exec(r.headers.get('location') || '')?.[1];
      if (tag) return tag;
      const v = String(JSON.parse(await text('https://api.github.com/repos/jgm/pandoc/releases/latest', signal)).tag_name || '').replace(/^v/, '');
      if (!v) throw new Error('the latest Pandoc release could not be found');
      return v;
    },
    url: (v) => `https://github.com/jgm/pandoc/releases/download/${v}/pandoc-${v}-${isWin ? 'windows-x86_64.zip' : isMac ? `${arm ? 'arm64' : 'x86_64'}-macOS.zip` : `linux-${arm ? 'arm64' : 'amd64'}.tar.gz`}`,
    async unpack(file, dir) {
      await run(isWin ? sys32('tar.exe') : '/usr/bin/tar', ['-xf', file, '-C', dir]);
      return find(dir, isWin ? 'pandoc.exe' : 'pandoc');
    },
  },
};

// Helpers that came with Lime, packed by scripts/engines.mjs like the apps; they unpack into the same place a
// download would go, so everything else treats the two alike.
const tarExe = isWin ? sys32('tar.exe') : '/usr/bin/tar';
const manifestOf = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (_) { return {}; } };
const bundled = (id, vendor) => { const m = manifestOf(vendor)[id]; return m && fs.existsSync(path.join(vendor, `${id}.tar.br`)) ? m : null; };
// The unpacked program of a bundled helper, if it is there already.
function unpacked(id, vendor, root) { const m = bundled(id, vendor); const exe = m && path.join(root, id, m.file); return exe && fs.existsSync(exe) ? exe : null; }
const settle = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 12 || !['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(e.code)) throw e; await new Promise((r) => setTimeout(r, 250 * (i + 1))); } } };
// Unpacks a bundled helper (once; a second caller finds it done) and gives back its program's path.
async function ensure(id, vendor, root, progress = () => {}) {
  const m = bundled(id, vendor);
  if (!m) return null;
  const dir = path.join(root, id), exe = path.join(dir, m.file);
  if (fs.existsSync(exe)) return exe;
  const part = `${dir}.part-${process.pid}-${Date.now()}`;
  await fsp.mkdir(part, { recursive: true });
  try {
    progress({ id, phase: 'unpack' });
    await new Promise((ok, no) => {
      const tar = spawn(tarExe, ['-xf', '-', '-C', part], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
      let err = '';
      tar.stderr.on('data', (d) => { err += d; });
      tar.on('error', no);
      tar.on('close', (c) => (c === 0 ? ok() : no(new Error(err.trim() || `tar exited with ${c}`))));
      pipeline(fs.createReadStream(path.join(vendor, `${id}.tar.br`)), require('zlib').createBrotliDecompress(), tar.stdin).catch(no);
    });
    if (!fs.existsSync(path.join(part, m.file))) throw new Error(`${HELPERS[id].name} was not in its archive`);
    if (fs.existsSync(exe)) { fsp.rm(part, { recursive: true, force: true }).catch(() => {}); return exe; }
    await settle(() => fsp.rm(dir, { recursive: true, force: true }));
    await settle(() => fsp.rename(part, dir));
    return exe;
  } catch (e) { await fsp.rm(part, { recursive: true, force: true }).catch(() => {}); throw e; }
}
// A version can be pinned from outside (the build does, when a release list cannot be read).
const latest = (id, signal) => process.env[`LIME_${id.toUpperCase()}_VERSION`] || HELPERS[id].latest(signal);
const jobs = new Map();
// Fetches a helper into <root>/<id>, telling `progress` how it is going, and gives back the program's path.
async function get(id, root, progress = () => {}, { version } = {}) {
  const H = HELPERS[id];
  if (!H) throw new Error('Unknown helper.');
  if (jobs.has(id)) throw new Error(`${H.name} is already downloading.`);
  const ctl = new AbortController();
  jobs.set(id, ctl);
  const dir = path.join(root, id), part = `${dir}.part`;
  try {
    await fsp.rm(part, { recursive: true, force: true });
    await fsp.mkdir(part, { recursive: true });
    progress({ id, phase: 'start' });
    const v = version || await latest(id, ctl.signal), url = H.url(v), file = path.join(part, path.basename(new URL(url).pathname));
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    if (!r.ok || !r.body) throw new Error(`${r.status} from ${new URL(url).host}`);
    const total = Number(r.headers.get('content-length')) || H.size * 1048576;
    let got = 0, last = 0;
    const meter = new Transform({ transform(chunk, _, cb) { got += chunk.length; if (Date.now() - last > 150) { last = Date.now(); progress({ id, phase: 'download', got, total, pct: Math.min(99, Math.round((got / total) * 100)) }); } cb(null, chunk); } });
    await pipeline(Readable.fromWeb(r.body, { signal: ctl.signal }), meter, fs.createWriteStream(file));
    progress({ id, phase: 'unpack' });
    const exe = await H.unpack(file, part);
    if (!exe) throw new Error(`${H.name}'s program was not in the download`);
    await fsp.rm(file, { force: true });
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rename(part, dir);
    return path.join(dir, path.relative(part, exe));
  } catch (e) {
    await fsp.rm(part, { recursive: true, force: true }).catch(() => {});
    throw ctl.signal.aborted ? new Error('Stopped.') : e;
  } finally { jobs.delete(id); }
}
const cancel = (id) => { const j = jobs.get(id); if (j) j.abort(); return !!j; };
module.exports = { HELPERS, latest, get, cancel, bundled, unpacked, ensure };
