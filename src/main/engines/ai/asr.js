'use strict';
// Whisper speech recognition on onnxruntime: log-mel features, language detection and timestamped
// decoding in 30-second windows, following OpenAI's reference decoder (MIT). The ONNX encoder/decoder
// pair with a self-attention cache is the export made by k2-fsa/sherpa-onnx (Apache-2.0).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { rfft, hann } = require('./dsp');

const SR = 16000, NFFT = 400, HOP = 160, WIN = 3000;

let filters = null;
function melFilters(nMels = 80) {
  if (filters) return filters;
  const toMel = (f) => (f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27));
  const toHz = (m) => (m < 15 ? m * (200 / 3) : 1000 * Math.exp((m - 15) * (Math.log(6.4) / 27)));
  const bins = NFFT / 2 + 1, top = toMel(SR / 2);
  const hz = Array.from({ length: nMels + 2 }, (_, i) => toHz((top * i) / (nMels + 1)));
  filters = Array.from({ length: nMels }, (_, m) => {
    const w = new Float32Array(bins), norm = 2 / (hz[m + 2] - hz[m]);
    for (let k = 0; k < bins; k++) {
      const f = (k * SR) / NFFT, lo = (f - hz[m]) / (hz[m + 1] - hz[m]), hi = (hz[m + 2] - f) / (hz[m + 2] - hz[m + 1]);
      w[k] = Math.max(0, Math.min(lo, hi)) * norm;
    }
    return w;
  });
  return filters;
}
// Whisper's features for the whole clip plus 30 s of silence, as [80][frames].
function logMel(samples) {
  const pad = new Float32Array(samples.length + WIN * HOP);
  pad.set(samples);
  const n = pad.length, frames = Math.floor(n / HOP), F = melFilters(), win = hann(NFFT), frame = new Float64Array(NFFT);
  const mel = Array.from({ length: 80 }, () => new Float32Array(frames));
  // Frames that only see the silent padding are all log10(1e-10); filling them in keeps short clips quick.
  const live = Math.min(frames, Math.ceil((samples.length + NFFT / 2) / HOP) + 1);
  for (const row of mel) row.fill(-10, live);
  const span = F.map((w) => { let a = 0, b = w.length; while (a < b && !w[a]) a++; while (b > a && !w[b - 1]) b--; return [a, b]; });
  let max = -10;
  for (let t = 0; t < live; t++) {
    for (let i = 0; i < NFFT; i++) {
      let j = t * HOP + i - NFFT / 2;
      if (j < 0) j = -j; else if (j >= n) j = 2 * n - 2 - j;
      frame[i] = pad[j] * win[i];
    }
    const { re, im } = rfft(frame);
    for (let m = 0; m < 80; m++) {
      const w = F[m], [a, b] = span[m];
      let s = 0;
      for (let k = a; k < b; k++) s += w[k] * (re[k] * re[k] + im[k] * im[k]);
      const v = Math.log10(Math.max(s, 1e-10));
      mel[m][t] = v;
      if (v > max) max = v;
    }
  }
  for (const row of mel) for (let t = 0; t < frames; t++) row[t] = (Math.max(row[t], max - 8) + 4) / 4;
  return { mel, frames: frames - WIN };
}

const GPT2 = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
function tokenizer(file) {
  const byId = [], ids = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const sp = line.lastIndexOf(' ');
    if (sp < 1) continue;
    const id = Number(line.slice(sp + 1)), bytes = Buffer.from(line.slice(0, sp), 'base64');
    byId[id] = bytes;
    ids.set(bytes.toString('latin1'), id);
  }
  // Token ids are the BPE merge ranks, as in tiktoken.
  const bpe = (word) => {
    let parts = [...Buffer.from(word, 'utf8')].map((b) => String.fromCharCode(b));
    for (;;) {
      let best = -1, rank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) { const r = ids.get(parts[i] + parts[i + 1]); if (r !== undefined && r < rank) { rank = r; best = i; } }
      if (best < 0) break;
      parts = [...parts.slice(0, best), parts[best] + parts[best + 1], ...parts.slice(best + 2)];
    }
    return parts.map((p) => ids.get(p)).filter((x) => x !== undefined);
  };
  return {
    decode: (list) => Buffer.concat(list.map((t) => byId[t] || Buffer.alloc(0))).toString('utf8'),
    encode: (text) => (text.match(GPT2) || []).flatMap(bpe),
  };
}

const models = new Map();
async function load(ort, dir) {
  if (models.has(dir)) return models.get(dir);
  const opts = { logSeverityLevel: 3, intraOpNumThreads: Math.max(1, Math.min(8, require('os').cpus().length)), graphOptimizationLevel: 'all' };
  const encoder = await ort.InferenceSession.create(path.join(dir, 'encoder.onnx'), opts);
  const decoder = await ort.InferenceSession.create(path.join(dir, 'decoder.onnx'), opts);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const num = (k) => Number(meta[k]), list = (k) => meta[k].split(',');
  const m = {
    ort, encoder, decoder, tok: tokenizer(path.join(dir, 'tokens.txt')),
    layers: num('n_text_layer'), ctx: num('n_text_ctx'), state: num('n_text_state'), vocab: num('n_vocab'),
    sot: num('sot'), eot: num('eot'), transcribe: num('transcribe'), translate: num('translate'), noTs: num('no_timestamps'), noSpeech: num('no_speech'),
    prev: num('sot_prev'), blank: num('blank_id'), suppress: list('non_speech_tokens').map(Number),
    langs: Object.fromEntries(list('all_language_codes').map((c, i) => [c, Number(list('all_language_tokens')[i])])),
  };
  m.tsBegin = m.noTs + 1;
  models.set(dir, m);
  return m;
}

// win < WIN encodes only the start of the window (whisper.cpp's audio_ctx): a short clip costs a fraction.
async function encode(m, mel, seek, win = WIN) {
  const x = new Float32Array(80 * win);
  for (let r = 0; r < 80; r++) x.set(mel[r].subarray(seek, seek + win), r * win);
  const out = await m.encoder.run({ mel: new m.ort.Tensor('float32', x, [1, 80, win]) });
  return { k: out.n_layer_cross_k, v: out.n_layer_cross_v };
}
function cache(m) {
  const size = m.layers * m.ctx * m.state, dims = [m.layers, 1, m.ctx, m.state];
  return { k: new m.ort.Tensor('float32', new Float32Array(size), dims), v: new m.ort.Tensor('float32', new Float32Array(size), dims) };
}
async function step(m, tokens, st, cross) {
  const out = await m.decoder.run({
    tokens: new m.ort.Tensor('int64', BigInt64Array.from(tokens, BigInt), [1, tokens.length]),
    in_n_layer_self_k_cache: st.self.k, in_n_layer_self_v_cache: st.self.v,
    n_layer_cross_k: cross.k, n_layer_cross_v: cross.v,
    offset: new m.ort.Tensor('int64', BigInt64Array.from([BigInt(st.offset)]), [1]),
  });
  st.self = { k: out.out_n_layer_self_k_cache, v: out.out_n_layer_self_v_cache };
  st.offset += tokens.length;
  const d = out.logits.data, V = m.vocab;
  return { last: d.slice(d.length - V), row: (i) => d.slice(i * V, (i + 1) * V) };
}
const logSoftmax = (x) => { let mx = -Infinity; for (const v of x) if (v > mx) mx = v; let s = 0; for (const v of x) s += Math.exp(v - mx); const l = mx + Math.log(s); return Float32Array.from(x, (v) => v - l); };

async function detect(m, cross) {
  const { last } = await step(m, [m.sot], { self: cache(m), offset: 0 }, cross);
  let best = 'en', top = -Infinity;
  for (const [c, id] of Object.entries(m.langs)) if (last[id] > top) { top = last[id]; best = c; }
  return best;
}

// The rules that keep timestamps paired and in order, from OpenAI's ApplyTimestampRules.
function rules(m, logits, seq, initial) {
  const NEG = -Infinity;
  for (const t of m.suppress) logits[t] = NEG;
  for (let t = m.eot + 1; t < m.tsBegin; t++) logits[t] = NEG;
  if (initial) { logits[m.blank] = NEG; logits[m.eot] = NEG; }
  const n = seq.length, lastTs = n >= 1 && seq[n - 1] >= m.tsBegin, prevTs = n < 2 || seq[n - 2] >= m.tsBegin;
  if (lastTs) {
    if (prevTs) for (let t = m.tsBegin; t < logits.length; t++) logits[t] = NEG;
    else for (let t = 0; t < m.eot; t++) logits[t] = NEG;
  }
  const stamps = seq.filter((t) => t >= m.tsBegin);
  if (stamps.length) {
    const floor = lastTs && !prevTs ? stamps[stamps.length - 1] : stamps[stamps.length - 1] + 1;
    for (let t = m.tsBegin; t < floor; t++) logits[t] = NEG;
  }
  if (initial) {
    for (let t = 0; t < m.tsBegin; t++) logits[t] = NEG;
    for (let t = m.tsBegin + 51; t < logits.length; t++) logits[t] = NEG;
  }
  const lp = logSoftmax(logits);
  let tsMass = -Infinity, textMax = -Infinity;
  for (let t = m.tsBegin; t < lp.length; t++) tsMass = Math.max(tsMass, lp[t]) + Math.log1p(Math.exp(-Math.abs(tsMass - lp[t])));
  for (let t = 0; t < m.tsBegin; t++) if (lp[t] > textMax) textMax = lp[t];
  if (tsMass > textMax) for (let t = 0; t < m.tsBegin; t++) logits[t] = NEG;
  return logits;
}
// A decoder stuck in a loop ("send the revives. Please send the revives. …") is cut at the first repeat.
function looped(seq) {
  for (let n = 3; n <= 12; n++) {
    if (seq.length < 3 * n) continue;
    const a = seq.slice(-n).join(), b = seq.slice(-2 * n, -n).join(), c = seq.slice(-3 * n, -2 * n).join();
    if (a === b && b === c) return seq.length - 2 * n;
  }
  return -1;
}
const pick = (logits, temp) => {
  if (!temp) { let b = 0; for (let i = 1; i < logits.length; i++) if (logits[i] > logits[b]) b = i; return b; }
  const lp = logSoftmax(logits.map((v) => v / temp));
  let r = Math.random();
  for (let i = 0; i < lp.length; i++) { r -= Math.exp(lp[i]); if (r <= 0) return i; }
  return lp.length - 1;
};

async function decodeWindow(m, cross, init, temp, beam) {
  const max = Math.floor(m.ctx / 2) - 1;
  const st = { self: cache(m), offset: 0 };
  let { last, row } = await step(m, init, st, cross);
  const noSpeech = Math.exp(logSoftmax(row(init.indexOf(m.sot)))[m.noSpeech]);
  if (beam > 1 && !temp) return { ...(await beamSearch(m, cross, st, last, beam, max)), noSpeech };
  const seq = [];
  let sum = 0;
  while (seq.length < max) {
    const logits = rules(m, last, seq, seq.length === 0);
    const t = pick(logits, temp);
    sum += logSoftmax(logits)[t];
    seq.push(t);
    if (t === m.eot || st.offset >= m.ctx - 1) break;
    const cut = looped(seq);
    if (cut > 0) { seq.length = cut; break; }
    ({ last } = await step(m, [t], st, cross));
  }
  if (seq[seq.length - 1] === m.eot) seq.pop();
  return { seq, logprob: sum / Math.max(1, seq.length + 1), noSpeech };
}
// Beam search keeps a few candidate continuations, each with its own cache.
async function beamSearch(m, cross, st0, last0, width, max) {
  let beams = [{ seq: [], sum: 0, st: st0, last: last0 }];
  const done = [];
  while (beams.length && done.length < width) {
    const cands = [];
    for (const b of beams) {
      const lp = logSoftmax(rules(m, b.last.slice(), b.seq, b.seq.length === 0));
      const top = [...lp.keys()].filter((i) => lp[i] > -Infinity).sort((a, c) => lp[c] - lp[a]).slice(0, width + 1);
      for (const t of top) cands.push({ from: b, t, sum: b.sum + lp[t] });
    }
    cands.sort((a, c) => c.sum - a.sum);
    const next = [];
    for (const c of cands) {
      if (next.length >= width) break;
      const seq = [...c.from.seq, c.t];
      if (c.t === m.eot || seq.length >= max) { done.push({ seq: c.t === m.eot ? seq.slice(0, -1) : seq, sum: c.sum }); continue; }
      next.push({ seq, sum: c.sum, from: c.from });
    }
    beams = [];
    for (const n of next) {
      const st = { self: n.from.st.self, offset: n.from.st.offset };
      const { last } = await step(m, [n.seq[n.seq.length - 1]], st, cross);
      beams.push({ seq: n.seq, sum: n.sum, st, last });
    }
  }
  if (!done.length) done.push(...beams);
  const best = done.reduce((a, b) => (b.sum / (b.seq.length + 1) > a.sum / (a.seq.length + 1) ? b : a));
  return { seq: best.seq, logprob: best.sum / (best.seq.length + 1) };
}
const ratio = (text) => { const b = Buffer.from(text, 'utf8'); return b.length ? b.length / zlib.gzipSync(b).length : 0; };

async function transcribe(ort, dir, samples, opts = {}, progress = () => {}) {
  const m = await load(ort, dir);
  const { mel, frames } = logMel(samples);
  const segments = [];
  let lang = opts.lang && opts.lang !== 'auto' ? opts.lang : null, prompt = opts.prompt ? m.tok.encode(` ${opts.prompt.trim()}`) : [];
  let seek = 0;
  while (seek < frames) {
    const size = Math.min(WIN, frames - seek), offset = (seek * HOP) / SR;
    const cross = await encode(m, mel, seek, opts.fit && frames - seek < WIN ? Math.min(WIN, Math.max(600, Math.ceil((frames - seek + 150) / 100) * 100)) : WIN);
    if (!lang) lang = await detect(m, cross);
    const init = [...(prompt.length ? [m.prev, ...prompt.slice(-(Math.floor(m.ctx / 2) - 1))] : []), m.sot, m.langs[lang] ?? m.langs.en, opts.translate ? m.translate : m.transcribe];
    let r;
    for (const temp of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      r = await decodeWindow(m, cross, temp ? init.filter((_, i) => i >= init.indexOf(m.sot)) : init, temp, opts.accurate ? 5 : 1);
      const text = m.tok.decode(r.seq.filter((t) => t < m.eot));
      if (ratio(text) <= 2.4 && r.logprob >= -1) break;
      if (r.noSpeech > 0.6) break;
    }
    if (r.noSpeech > 0.6 && r.logprob < -1) { seek += size; progress(Math.min(1, seek / frames)); continue; }
    const seq = r.seq, isTs = seq.map((t) => t >= m.tsBegin), at = (t) => (t - m.tsBegin) * 0.02;
    const cuts = [];
    for (let i = 1; i < seq.length; i++) if (isTs[i] && isTs[i - 1]) cuts.push(i);
    const single = seq.length >= 2 && !isTs[seq.length - 2] && isTs[seq.length - 1];
    const add = (part, a, b) => {
      const text = m.tok.decode(part.filter((t) => t < m.eot)).trim();
      if (text) segments.push({ start: +(offset + a).toFixed(2), end: +(offset + Math.max(a, b)).toFixed(2), text, conf: +Math.exp(r.logprob).toFixed(3) });
    };
    if (cuts.length) {
      if (single) cuts.push(seq.length);
      let last = 0;
      for (const c of cuts) { const part = seq.slice(last, c); add(part, at(part[0]), at(part[part.length - 1])); last = c; }
      seek += single ? size : Math.max(1, Math.round((at(seq[last - 1]) * SR) / HOP));
    } else {
      const stamps = seq.filter((t) => t >= m.tsBegin);
      const end = stamps.length && at(stamps[stamps.length - 1]) > 0 ? at(stamps[stamps.length - 1]) : (size * HOP) / SR;
      add(seq, stamps.length ? at(stamps[0]) : 0, end);
      seek += size;
    }
    prompt = r.logprob > -1 && ratio(segments.slice(-3).map((s) => s.text).join(' ')) <= 2.4 ? seq.filter((t) => t < m.eot) : [];
    progress(Math.min(1, seek / frames));
  }
  return { text: segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(), lang: lang || 'en', segments };
}

module.exports = { transcribe, logMel, tokenizer };
