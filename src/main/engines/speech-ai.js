'use strict';
// The speech and music models ship inside Lime as brotli tarballs (vendor/ai/<target>, resources/ai when
// packaged). The first use unpacks one into userData/helpers with helpers.ensure — never the network.
// Inference runs in one long-lived child process (ai/host.js) so a model loads once per session.
const U = require('./util');
const { fs, fsp, path } = U;

const NAMES = { whisper: 'Speech recognition', 'whisper-small': 'Speech recognition (more languages)', espeak: 'Pronunciation', denoise: 'Voice clean-up', stems: 'Stem splitter' };
const dir = () => process.env.LIME_AI || U.cfg.ai || path.join(__dirname, '../../../vendor/ai', `${process.platform}-${process.arch}`);
const root = () => path.join(U.cfg.user, 'helpers');
const have = (id) => !!require('../helpers').bundled(id, dir());
const unpacking = new Map();
async function payload(id, progress) {
  if (!have(id)) throw new Error(`${NAMES[id] || 'This voice'} isn’t included in this build of Lime.`);
  if (!unpacking.has(id)) unpacking.set(id, require('../helpers').ensure(id, dir(), root(), progress).finally(() => unpacking.delete(id)));
  return path.dirname(await unpacking.get(id));
}

let child = null, seq = 0, idle = null;
const waiting = new Map();
function host() {
  clearTimeout(idle);
  if (child && child.connected) return child;
  child = require('child_process').fork(path.join(__dirname, 'ai', 'host.js'), [], { execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced' });
  let err = '';
  const me = child;
  child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  child.on('message', (m) => {
    const w = waiting.get(m.id);
    if (!w) return;
    if (m.progress != null) return w.progress(m.progress, m.label);
    waiting.delete(m.id);
    m.error ? w.reject(new Error(m.error)) : w.resolve(m.done);
    if (!waiting.size) { clearTimeout(idle); idle = setTimeout(() => me.kill(), 120000); }
  });
  child.on('exit', (code, sig) => {
    if (child === me) child = null;
    for (const [id, w] of waiting) if (w.child === me) { waiting.delete(id); w.reject(Object.assign(new Error(w.signal?.aborted ? 'Cancelled' : `The AI engine stopped${sig ? ` (${sig})` : ''}${err.trim() ? `: ${err.trim().split('\n').slice(-2).join(' ')}` : ''}`), { cancelled: !!w.signal?.aborted })); }
  });
  return child;
}
function call(op, args, { signal, progress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
    const c = host(), id = ++seq, kill = () => c.kill();
    const off = (fn) => (v) => { signal?.removeEventListener('abort', kill); fn(v); };
    waiting.set(id, { resolve: off(resolve), reject: off(reject), progress, signal, child: c });
    signal?.addEventListener('abort', kill, { once: true });
    c.send({ id, op, args });
  });
}
const stop = () => { if (child) child.kill(); };

// Decodes any audio or video into raw float32 samples at the given rate.
async function pcm(file, out, { rate = 16000, channels = 1, signal, filter } = {}) {
  await U.run(U.binPath('ffmpeg'), ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', file, '-vn', '-map', '0:a:0', ...(filter ? ['-af', filter] : []), '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', out], { signal, errorMessage: `Couldn’t read the sound in ${path.basename(file)}` });
  return (await fsp.stat(out)).size / 4 / channels;
}
const readPcm = (f) => { const b = fs.readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };

module.exports = { dir, have, payload, call, stop, pcm, readPcm };
