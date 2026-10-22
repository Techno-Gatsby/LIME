'use strict';
// Dictation pipeline, in its own process: voice activity (Silero, here), live partials and the final text
// (Whisper, in the AI host process: its threads would starve the VAD if both ran in one process).
// Each pause in speech closes an utterance, which is transcribed in full straight away, so on Stop
// only the last few seconds are left to do. Partials re-read the open utterance about once a second
// and keep the words two readings agree on (the LocalAgreement idea from ufal/whisper_streaming, MIT).
const U = require('./engines/util');
let workerData = {};

const SR = 16000, FRAME = 512;
// A pause closes an utterance once it is a few seconds long, so a short dictation is read in one pass at the end.
const ON = 0.5, OFF = 0.35, PAD = 0.3 * SR, PAUSE = 0.7 * SR, SHORT_PAUSE_UTT = 6 * SR, LONG_PAUSE = 1.2 * SR, MAX_UTT = 24 * SR, AUTO_STOP = 1.5 * SR, MIN_UTT = 0.25 * SR;
const engine = () => {
  if (workerData.engine) return require(workerData.engine);
  const w = require('./engines/whisper');
  return { transcribePcm: w.transcribePcm, ready: w.warm };
};
let vadP = null;
const vad = () => (vadP ||= workerData.vad ? require('./engines/vad').load(workerData.vad) : Promise.resolve(null));
const post = (m) => { if (process.connected) process.send(m); };

const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean);
const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const NOISE = /\[[^\]]*\]|\((?:[^)]*(?:music|applause|laugh|silence|noise|inaudible)[^)]*)\)|♪+/gi;
const GHOSTS = /^(?:thank you\.?|thanks for watching!?|thank you for watching\.?|you|bye\.?|\.+)$/i;
const clean = (t, secs) => { const s = String(t || '').replace(NOISE, ' ').replace(/\s+/g, ' ').trim(); return secs < 2.5 && GHOSTS.test(s) ? '' : s; };

class Session {
  constructor(id, opts) {
    Object.assign(this, { id, opts, buf: new Float32Array(SR * 30), len: 0, vadAt: 0, speaking: false, quiet: 0, heard: false, peak: 0 });
    this.open = null; // { start, lastSpeech }
    this.utts = []; // { start, end, text, done }
    this.queue = [];
    this.busy = false;
    this.partial = { at: 0, len: 0, prev: [], stable: [], text: '' };
    this.lang = opts.lang && opts.lang !== 'auto' ? opts.lang : '';
    this.stopped = false;
    this.cancelled = false;
  }
  push(pcm) {
    if (this.len + pcm.length > this.buf.length) { const b = new Float32Array(Math.max(this.buf.length * 2, this.len + pcm.length)); b.set(this.buf.subarray(0, this.len)); this.buf = b; }
    this.buf.set(pcm, this.len);
    this.len += pcm.length;
    let s = 0;
    for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
    const rms = Math.sqrt(s / Math.max(1, pcm.length));
    this.peak = Math.max(this.peak, rms);
    post({ type: 'level', id: this.id, rms, speaking: this.speaking });
  }
  async detect() {
    const v = await vad();
    while (this.vadAt + FRAME <= this.len) {
      const at = this.vadAt;
      const p = v ? await v.prob(this.buf.slice(at, at + FRAME)) : this.energy(at);
      this.vadAt += FRAME;
      if (p > ON) {
        if (!this.speaking) { this.speaking = true; if (!this.open) this.open = { start: Math.max(this.utts.at(-1)?.end || 0, at - PAD), lastSpeech: at, low: [] }; }
        this.open.lastSpeech = at + FRAME;
        this.heard = true;
      } else if (p < OFF && this.speaking) this.speaking = false;
      if (this.open) {
        this.open.low.push([at, p]);
        if (!this.speaking && this.vadAt - this.open.lastSpeech >= (this.vadAt - this.open.start >= SHORT_PAUSE_UTT ? PAUSE : LONG_PAUSE)) this.close(Math.min(this.vadAt, this.open.lastSpeech + 0.25 * SR));
        else if (this.vadAt - this.open.start >= MAX_UTT) {
          const tail = this.open.low.filter(([a]) => a > this.vadAt - 4 * SR);
          this.close(tail.reduce((m, x) => (x[1] < m[1] ? x : m), tail[0])[0]);
          if (this.speaking) this.open = { start: this.utts.at(-1).end, lastSpeech: this.vadAt, low: [] };
        }
      }
      if (this.opts.autoStop && this.heard && !this.open && !this.autoStopped && this.vadAt - (this.utts.at(-1)?.end || 0) >= AUTO_STOP - 0.25 * SR) { this.autoStopped = true; post({ type: 'autostop', id: this.id }); }
    }
  }
  energy(at) { let s = 0; for (let i = at; i < at + FRAME; i++) s += this.buf[i] * this.buf[i]; return Math.sqrt(s / FRAME) > 0.02 ? 1 : 0; }
  close(end) {
    const u = { start: this.open.start, end, text: this.partial.text, done: false };
    this.open = null;
    this.partial = { at: 0, len: 0, prev: [], stable: [], text: '' };
    if (u.end - u.start < MIN_UTT) return;
    this.utts.push(u);
    this.queue.push(u);
  }
  prompt() {
    const said = this.utts.filter((u) => u.done && u.text).map((u) => u.text).join(' ').slice(-220);
    return [this.opts.prompt, said].filter(Boolean).join(' ').trim();
  }
  async hear(pcm, fit) {
    const t0 = Date.now();
    const r = await engine().transcribePcm(pcm, { lang: this.lang || undefined, translate: !!this.opts.translate, prompt: this.prompt() || undefined, model: this.opts.model, fit });
    const text = typeof r === 'string' ? r : r?.text;
    if (!this.lang && r?.lang && (this.opts.lang === 'auto' || !this.opts.lang)) this.lang = r.lang;
    return { text: clean(text, pcm.length / SR), ms: Date.now() - t0 };
  }
  async pump() {
    if (this.busy || this.cancelled) return;
    this.busy = true;
    try {
      while (!this.cancelled) {
        const u = this.queue.shift();
        if (u) {
          const r = await this.hear(this.buf.slice(u.start, u.end));
          Object.assign(u, { text: r.text, done: true, ms: r.ms });
          this.emit();
          continue;
        }
        if (this.stopped || !this.open) break;
        const end = this.len, start = Math.max(this.open.start, end - MAX_UTT);
        if (end - start < 1.2 * SR || end - this.partial.len < 0.5 * SR || Date.now() - this.partial.at < 900) break;
        this.partial.at = Date.now();
        this.partial.len = end;
        const open = this.open;
        const r = await this.hear(this.buf.slice(start, end), true);
        if (this.open !== open && !this.utts.some((x) => x.start === open.start && !x.done)) continue;
        this.agree(words(r.text), open);
        this.emit();
      }
    } catch (e) { post({ type: 'error', id: this.id, message: e.message }); } finally { this.busy = false; }
    if (this.stopped && !this.busy) this.finish();
    else if (!this.cancelled && this.open) setTimeout(() => this.pump(), 120);
  }
  agree(cur, open) {
    const p = this.open === open ? this.partial : null;
    if (!p) { const u = this.utts.find((x) => x.start === open.start); if (u && !u.done) u.text = cur.join(' '); return; }
    let n = 0;
    while (n < cur.length && n < p.prev.length && norm(cur[n]) === norm(p.prev[n])) n++;
    if (n < p.stable.length && p.stable.every((w, i) => norm(w) === norm(cur[i] || ''))) n = p.stable.length;
    p.stable = n >= p.stable.length ? cur.slice(0, n) : p.stable;
    p.tail = cur.slice(p.stable.length);
    p.prev = cur;
    p.text = cur.join(' ');
  }
  emit() {
    const committed = this.utts.map((u) => u.text).filter(Boolean).join(' ');
    post({ type: 'partial', id: this.id, committed, stable: this.partial.stable.join(' '), tail: (this.partial.tail || []).join(' ') });
  }
  async stop() {
    this.stopped = true;
    await this.detect();
    if (this.open) this.close(this.len);
    if (!this.utts.length && !this.heard && this.peak > 0.02 && this.len > 0.5 * SR) this.queue.push(this.utts[this.utts.push({ start: 0, end: this.len, text: '', done: false }) - 1]);
    this.stopAt = Date.now();
    this.pump();
  }
  finish() {
    if (this.finished || this.queue.length || this.utts.some((u) => !u.done)) return;
    this.finished = true;
    const raw = this.utts.map((u) => u.text).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    post({ type: 'final', id: this.id, raw, lang: this.lang || this.opts.lang || '', ms: Date.now() - this.stopAt, secs: this.len / SR, calls: this.utts.map((u) => u.ms) });
    sessions.delete(this.id);
  }
}

const sessions = new Map();
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));
process.on('message', (m) => {
  const s = sessions.get(m.id);
  if (m.type === 'init') { workerData = m; U.configure(m.cfg); }
  else if (m.type === 'warm') serial(async () => { await vad(); await engine().ready?.({ model: m.model }); post({ type: 'warm' }); }).catch((e) => post({ type: 'error', message: e.message }));
  else if (m.type === 'start') { sessions.set(m.id, new Session(m.id, m.opts || {})); vad().then((v) => v?.reset()).catch(() => {}); }
  else if (m.type === 'audio' && s && !s.stopped) serial(async () => { s.push(m.pcm); await s.detect(); s.pump(); }).catch((e) => post({ type: 'error', id: m.id, message: e.message }));
  else if (m.type === 'stop' && s) serial(() => s.stop()).catch((e) => post({ type: 'error', id: m.id, message: e.message }));
  else if (m.type === 'cancel' && s) { s.cancelled = true; sessions.delete(m.id); }
});
