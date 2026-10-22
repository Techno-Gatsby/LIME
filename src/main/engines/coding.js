'use strict';
// Code (VSCodium) and Python, both shipped inside Lime. VSCodium runs with its own settings and extensions folders under
// Lime's user data, kept across updates of the app itself, with telemetry and update checks off; the Python app is the
// same VSCodium with Lime's Python runtime set as its interpreter.
const { spawn } = require('child_process');
const U = require('./util');
const { fs, fsp, path } = U;

const crafts = () => require('./crafts');
const home = () => path.join(U.cfg.user, 'code');
// Short names: VSCodium keeps its single-instance socket in the data folder, and a socket path may only be ~100 characters.
const dirs = () => ({ data: path.join(home(), 'data'), extensions: path.join(home(), 'extensions') });
// Settings Lime always holds: Code inside Lime is updated with Lime, never by itself.
const FORCED = { 'update.mode': 'none', 'update.showReleaseNotes': false, 'telemetry.telemetryLevel': 'off', 'extensions.autoUpdate': 'off', 'extensions.autoCheckUpdates': false };
// Defaults the person may change afterwards.
const DEFAULTS = { 'workbench.enableExperiments': false, 'workbench.settings.enableNaturalLanguageSearch': false, 'extensions.ignoreRecommendations': true, 'npm.fetchOnlinePackageInfo': false,
  'typescript.disableAutomaticTypeAcquisition': true, 'json.schemaDownload.enable': false, 'git.autofetch': false, 'workbench.tips.enabled': false };
// Ctrl/Cmd+Shift+B (and Ctrl+F5 in a Python file) runs the open script with Lime's Python.
const TASKS = { version: '2.0.0', tasks: [{ label: 'Run Python file', type: 'process', command: '${config:python.defaultInterpreterPath}', args: ['${file}'], options: { cwd: '${fileDirname}' },
  group: { kind: 'build', isDefault: true }, presentation: { reveal: 'always', panel: 'dedicated', clear: true }, problemMatcher: [] }] };
const KEYS = [{ key: 'ctrl+f5', command: 'workbench.action.tasks.build', when: "editorLangId == 'python'" }];

const pythonPath = () => { const m = crafts().bundledApps().python; const p = m && path.join(crafts().appDir('python'), m.file); return p && fs.existsSync(p) ? p : null; };
async function python() {
  const p = await crafts().bundledApp('python');
  if (!p) throw Object.assign(new Error('Python isn’t included in this build of Lime.'), { code: 'ENGINE_MISSING' });
  return p;
}

async function writeJson(file, fn) {
  const jsonc = require('jsonc-parser');
  let text = await fsp.readFile(file, 'utf8').catch(() => null);
  const fresh = text == null;
  if (fresh) text = '{}';
  let next = text;
  for (const [k, v] of Object.entries(fn(jsonc.parse(next) || {}, fresh))) next = jsonc.applyEdits(next, jsonc.modify(next, [k], v, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  if (next !== text || fresh) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, next); }
}
// The settings Code starts with; with Python unpacked, its interpreter and a terminal where `python` is Lime's Python.
async function configure(py = pythonPath()) {
  const { data } = dirs(), user = path.join(data, 'User');
  await writeJson(path.join(user, 'settings.json'), (cur) => {
    const set = { ...FORCED };
    for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in cur)) set[k] = v;
    if (py) {
      const bin = path.dirname(py), sep = U.isWin ? ';' : ':', env = { PATH: `${bin}${U.isWin ? `${sep}${path.join(bin, 'Scripts')}` : ''}${sep}\${env:PATH}` };
      Object.assign(set, { 'python.defaultInterpreterPath': py, 'python.pythonPath': py, [`terminal.integrated.env.${U.isWin ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'}`]: env });
    }
    return set;
  });
  if (!fs.existsSync(path.join(user, 'tasks.json'))) await fsp.writeFile(path.join(user, 'tasks.json'), JSON.stringify(TASKS, null, 2));
  if (!fs.existsSync(path.join(user, 'keybindings.json'))) await fsp.writeFile(path.join(user, 'keybindings.json'), JSON.stringify(KEYS, null, 2));
  return path.join(user, 'settings.json');
}

// VSCodium's own command line (what its `codium` launcher runs): Electron as Node, with cli.js.
function cliRun(args, { wait = true, timeout = 120000 } = {}) {
  const m = crafts().bundledApps().code, root = crafts().appDir('code');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  for (const k of Object.keys(env)) if (/^(ELECTRON_(?!RUN_AS_NODE)|NODE_OPTIONS|LIME_)/.test(k)) delete env[k];
  const { data, extensions } = dirs();
  const all = [path.join(root, m.clijs), '--user-data-dir', data, '--extensions-dir', extensions, ...args];
  if (!wait) {
    return new Promise((done) => {
      const child = spawn(path.join(root, m.electron), all, { env, detached: true, stdio: 'ignore', windowsHide: true, cwd: path.dirname(path.join(root, m.electron)) });
      child.on('error', (e) => done(e.code || e.message));
      child.on('exit', (code, sig) => done(code || sig ? `exited with ${sig || code}` : null));
      setTimeout(() => { done(null); child.unref(); }, 1500);
    });
  }
  return U.run(path.join(root, m.electron), all, { env, timeout, errorMessage: 'Code couldn’t finish' });
}
const installedExt = (x) => fs.existsSync(path.join(dirs().extensions, `${x.id}-${x.version}`.toLowerCase())) || fs.readdirSync(dirs().extensions).some((d) => d.toLowerCase().startsWith(`${x.id}-${x.version}`.toLowerCase()));
// The extensions inside Lime (basedpyright for Python), installed from their VSIX files on this computer, once per version.
async function extensions() {
  const m = crafts().bundledApps().code;
  await fsp.mkdir(dirs().extensions, { recursive: true });
  for (const x of m.extensions || []) if (!installedExt(x)) await cliRun(['--install-extension', path.join(crafts().appDir('code'), x.file), '--force']);
}

async function prepare(id) {
  const py = id === 'python' ? await python() : pythonPath();
  const app = await crafts().bundledApp('code');
  if (!app) throw new Error('Code isn’t included in this build of Lime.');
  await configure(py);
  await extensions();
  return app;
}
async function open(id, files = []) {
  await prepare(id);
  // Chromium refuses to run as root on Linux with its sandbox (a test machine, never a Mac or Windows PC).
  const root = process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [];
  const why = await cliRun([...root, ...(files.length ? files : ['--new-window'])], { wait: false });
  if (why) throw new Error(`${crafts().APPS[id].name} didn’t start (${why}).`);
  return crafts().bundledApps().code.file;
}

// The wheel's Run: the script runs with Lime's Python, from a scratch folder, within a time limit. What it printed (and any
// error) is saved as text beside it, also when it fails or runs out of time.
const LIMIT = 20000;
async function runPython(p, opts, ctx) {
  const py = await python(), dir = await U.tmpDir('python'), secs = Math.max(1, Math.min(3600, Number(opts.timeout) || 60));
  const args = String(opts.args || '').match(/"[^"]*"|'[^']*'|\S+/g)?.map((a) => a.replace(/^(["'])(.*)\1$/, '$2')) || [];
  const t0 = Date.now();
  ctx?.progress?.(0.1, `Running ${path.basename(p)}`);
  try {
    const r = await new Promise((resolve, reject) => {
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (/^(PYTHON|ELECTRON_|LIME_|NODE_OPTIONS)/.test(k)) delete env[k];
      Object.assign(env,{ PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1', MPLBACKEND: 'Agg' });
      const child = spawn(py, ['-s', p, ...args], { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: !U.isWin });
      const out = [], err = [];
      let size = 0, timedOut = false;
      const keep = (list) => (d) => { if (size < 8e6) { list.push(d); size += d.length; } };
      child.stdout.on('data', keep(out));
      child.stderr.on('data', keep(err));
      const stop = () => { if (U.isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill()); else { try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { child.kill('SIGKILL'); } } };
      const timer = setTimeout(() => { timedOut = true; stop(); }, secs * 1000);
      const tick = setInterval(() => ctx?.progress?.(Math.min(0.95, 0.1 + ((Date.now() - t0) / (secs * 1000)) * 0.85), `Running ${path.basename(p)}`), 400);
      ctx?.signal?.addEventListener('abort', () => { stop(); reject(Object.assign(new Error('Cancelled'), { cancelled: true })); }, { once: true });
      child.on('error', (e) => { clearTimeout(timer); clearInterval(tick); reject(e); });
      child.on('close', (code, sig) => { clearTimeout(timer); clearInterval(tick); resolve({ code, sig, timedOut, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }); });
    });
    const took = (Date.now() - t0) / 1000;
    const status = r.timedOut ? `Stopped after ${secs} s (the time limit)` : r.code === 0 ? 'Finished' : `Ended with exit code ${r.code ?? r.sig}`;
    const text = [`${path.basename(p)} · ${status} · ${took.toFixed(1)} s · Python ${crafts().bundledApps().python?.version?.split('+')[0] || ''}`.trim(), '',
      '── Output ──', r.stdout.replace(/\s+$/, '') || '(nothing)', ...(r.stderr.trim() ? ['', '── Errors ──', r.stderr.replace(/\s+$/, '')] : []), ''].join('\n');
    const out = ctx.out.file(p, `${U.base(p)} - output.txt`);
    await fsp.writeFile(out, text);
    return { path: out, note: `${status} · ${took.toFixed(1)} s`, text: text.length > LIMIT ? `${text.slice(0, LIMIT)}\n…` : text };
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { open, prepare, configure, extensions, runPython, python, pythonPath, dirs, FORCED };
