'use strict';
// The SQLite browser's database thread, one per window. A call that runs too long ends the thread (sql.js can't be
// interrupted from outside); the next call starts a fresh one on the file as saved.
const path = require('path');
const { Worker } = require('worker_threads');

const LIMIT = { query: Number(process.env.LIME_SQLITE_QUERY_MS) || 30000, exportRows: 120000, save: 120000, open: 120000 };
const hosts = new Map();

function hostFor(wc, cfg) {
  let h = hosts.get(wc.id);
  if (h && h.worker) return h;
  if (!h) { h = { file: null, seq: 0, calls: new Map(), worker: null }; hosts.set(wc.id, h); wc.once('destroyed', () => { hosts.get(wc.id)?.worker?.terminate(); hosts.delete(wc.id); }); }
  h.worker = new Worker(path.join(__dirname, 'sqlite-worker.js'), { workerData: { cfg: cfg() } });
  h.worker.on('message', ({ id, result, error }) => { const c = h.calls.get(id); if (!c) return; h.calls.delete(id); clearTimeout(c.t); error ? c.reject(new Error(error)) : c.resolve(result); });
  const gone = (why) => { for (const c of h.calls.values()) { clearTimeout(c.t); c.reject(new Error(why)); } h.calls.clear(); h.worker = null; };
  h.worker.on('error', (e) => gone(e.message));
  h.worker.on('exit', () => gone('The database stopped. Try again.'));
  return h;
}
function send(h, method, args, ms) {
  return new Promise((resolve, reject) => {
    const id = ++h.seq;
    const t = setTimeout(() => {
      h.calls.delete(id);
      const w = h.worker;
      h.worker = null;
      w?.terminate();
      reject(Object.assign(new Error(`That took longer than ${Math.round(ms / 1000)} seconds, so Lime stopped it. Changes not yet saved were lost, and the database is read-only again.`), { code: 'TIMEOUT' }));
    }, ms);
    h.calls.set(id, { resolve, reject, t });
    h.worker.postMessage({ id, method, args });
  });
}
async function call(wc, cfg, method, ...args) {
  let h = hosts.get(wc.id);
  const fresh = !h?.worker;
  h = hostFor(wc, cfg);
  if (method === 'open') { h.file = args[0]; return send(h, 'open', args, LIMIT.open); }
  if (!h.file) throw new Error('No database is open.');
  // A thread that was stopped comes back with the file as it is on disk, read-only again.
  if (fresh) await send(h, 'open', [h.file], LIMIT.open);
  return send(h, method, args, LIMIT[method] || 30000);
}

module.exports = { call, hosts };
