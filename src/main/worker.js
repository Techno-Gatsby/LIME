'use strict';

const { parentPort, workerData } = require('worker_threads');
const U = require('./engines/util');
U.configure(workerData.cfg);

const tools = require('./tools');
const editor = require('./pdfedit');

const controllers = new Map();
const hostCalls = new Map();
let hostSeq = 0;

function host(method, payload) {
  return new Promise((resolve, reject) => {
    const id = ++hostSeq;
    hostCalls.set(id, { resolve, reject });
    parentPort.postMessage({ type: 'host', id, method, payload });
  });
}
function normalise(res) {
  const list = (Array.isArray(res) ? res : [res]).flat(Infinity);
  return list.filter(Boolean).map((r) => (typeof r === 'string' ? { path: r } : r));
}
const CALLS = {
  sheetPreview: (p) => require('./engines/sheetprint').preview(p),
  async thumbnail(p, size = 240) {
    const g = U.groupOf(p);
    if (g === 'pdf') { const t = await require('./engines/pdf').thumbnail(p, size); return { png: t.png, pages: t.pages }; }
    if (g === 'image' || g === 'raw') return { png: await require('./engines/image').thumbnail(p, size) };
    if (g === 'video') { const b = await require('./engines/media').thumbnail(p); return b ? { png: b } : null; }
    if (g === 'cad2d' || g === 'cad3d') return { png: await require('./engines/cad').thumbnail(p, size) };
    if (g === 'vector' || g === 'layout') {
      const tmp = await U.tmpDir('vthumb');
      try {
        const out = g === 'vector' ? await require('./engines/crafts').vector(p, { to: 'png', scale: 1 }, { out: { file: (s, n) => require('path').join(tmp, n) } }) : null;
        return out ? { png: await require('sharp')(out).resize(size, size, { fit: 'inside' }).png().toBuffer() } : null;
      } finally { U.fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
    }
    return null;
  },
  async describe(p) {
    const g = U.groupOf(p);
    const st = await U.fsp.stat(p);
    const out = { group: g, size: st.size, modified: st.mtimeMs, isDir: st.isDirectory() };
    try {
      if (g === 'pdf') Object.assign(out, await require('./engines/pdf').readMetadata(p));
      else if (g === 'image') Object.assign(out, await require('./engines/image').info(p));
      else if (g === 'video' || g === 'audio') Object.assign(out, await require('./engines/media').probe(p));
      else if (g === 'cad2d' || g === 'cad3d') out.cad = await require('./engines/cad').info(p);
      else if (g === 'archive') { const items = await require('./engines/archive').list(p); out.entries = items.length; out.unpacked = items.reduce((s, i) => s + i.size, 0); out.encrypted = items.some((i) => i.encrypted); }
    } catch (e) { out.error = e.message; if (e.code) out.errorCode = e.code; }
    return out;
  },
  pdfMetadata: (p) => require('./engines/pdf').readMetadata(p),
  archiveList: (p, pw) => require('./engines/archive').list(p, pw),
  probe: (p) => require('./engines/media').probe(p),
  enginesStatus: () => ({ ...require('./engines/office').status(), crafts: require('./engines/crafts').status() }),
  'editor.open': editor.open, 'editor.render': editor.render, 'editor.patch': editor.patch, 'editor.objects': editor.objects, 'editor.fonts': editor.fonts, 'editor.text': editor.text, 'editor.search': editor.search,
  'editor.apply': editor.apply, 'editor.pageOp': editor.pageOp, 'editor.undo': editor.undo, 'editor.redo': editor.redo,
  'editor.save': editor.save, 'editor.exportPages': editor.exportPages, 'editor.close': editor.close,
};

// The image, audio/video and app editors each live in their own module: 'image.open' calls imgedit.js's open, and so on.
const EDITORS = { image: './imgedit', media: './mediaedit', studio: './studio' };
function editorCall(method) {
  const [ns, name] = String(method).split('.');
  const m = EDITORS[ns] ? require(EDITORS[ns]) : null;
  return m && typeof m[name] === 'function' ? m[name] : null;
}

parentPort.on('message', async (msg) => {
  if (msg.type === 'cancel') { controllers.get(msg.jobId)?.abort(); return; }
  if (msg.type === 'hostResult') {
    const h = hostCalls.get(msg.id);
    if (h) { hostCalls.delete(msg.id); if (msg.error) h.reject(new Error(msg.error)); else h.resolve(msg.result); }
    return;
  }
  if (msg.type === 'config') { U.configure(msg.cfg); return; }
  if (msg.type === 'call') {
    try {
      const fn = CALLS[msg.method] || editorCall(msg.method);
      if (!fn) throw new Error(`Unknown call ${msg.method}`);
      const result = await fn(...(msg.args || []));
      parentPort.postMessage({ type: 'callResult', id: msg.id, result });
    } catch (e) {
      parentPort.postMessage({ type: 'callResult', id: msg.id, error: e.message, code: e.code });
    }
    return;
  }
  if (msg.type === 'run') {
    const { job } = msg;
    const ac = new AbortController();
    controllers.set(job.id, ac);
    let last = 0;
    const ctx = {
      signal: ac.signal,
      out: U.outputPlanner(job),
      host,
      progress: (f, label) => {
        const now = Date.now();
        if (now - last < 120 && f < 1) return;
        last = now;
        parentPort.postMessage({ type: 'progress', jobId: job.id, progress: Math.max(0, Math.min(1, f || 0)), label });
      },
    };
    try {
      const tool = tools.get(job.tool);
      if (!tool || !tool.run) throw new Error('This tool can’t run in the background.');
      const results = normalise(await tool.run(job.files, job.opts || {}, ctx));
      parentPort.postMessage({ type: 'done', jobId: job.id, results });
    } catch (e) {
      if (!e.cancelled) console.error(`[${job.tool}]`, e);
      parentPort.postMessage({ type: 'failed', jobId: job.id, error: e.cancelled ? 'Cancelled' : (e.message || String(e)), code: e.code, engine: e.engine, cancelled: !!e.cancelled || ac.signal.aborted });
    } finally {
      controllers.delete(job.id);
    }
  }
});
