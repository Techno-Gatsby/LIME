'use strict';
// Piper text to speech on onnxruntime. Text becomes IPA phonemes with eSpeak NG (compiled to JavaScript,
// GPL-3.0), then phoneme ids, the same way piper-phonemize does it, and each sentence is spoken by the
// voice's VITS model.
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');

let espeak = null;
async function speaker(dir) {
  if (espeak) return espeak;
  const { default: init } = await import(pathToFileURL(path.join(dir, 'espeak-ng.js')).href);
  const mod = await init(), w = new mod.eSpeakNGWorker(), ids = new Map();
  for (const v of w.list_voices()) for (const l of v.languages) if (!ids.has(l.name)) ids.set(l.name, v.identifier);
  const str = (ptr) => { const H = mod.HEAPU8; let e = ptr; while (H[e]) e++; return Buffer.from(H.subarray(ptr, e)).toString('utf8'); };
  espeak = (text, voice) => {
    if (w.set_voice(ids.get(voice) || voice) !== 0) throw new Error(`No eSpeak voice ${voice}`);
    return str(w.convert_to_phonemes(text, true).ptr).replace(/_/g, '').replace(/\([a-z-]+\)/g, '').replace(/\s*\|\s*/g, ' ').trim();
  };
  return espeak;
}

const voices = new Map();
async function voice(ort, file) {
  if (voices.has(file)) return voices.get(file);
  const cfg = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
  const session = await ort.InferenceSession.create(file, { logSeverityLevel: 3, intraOpNumThreads: Math.max(1, Math.min(8, require('os').cpus().length)) });
  const v = { session, cfg, rate: cfg.audio.sample_rate };
  voices.set(file, v);
  return v;
}

// Sentences, each a list of clauses that keep their closing punctuation, as piper-phonemize does.
function sentences(text) {
  const out = [];
  for (const para of String(text).replace(/\r/g, '').split(/\n\s*\n+/)) {
    const flat = para.replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    const parts = flat.match(/[^.!?;:,。！？،؟।]+[.!?;:,。！？،؟।]*\s*/g) || [flat];
    let cur = [];
    for (const p of parts) {
      cur.push(p.trim());
      if (/[.!?。！？؟।]$/.test(p.trim()) || cur.join(' ').length > 400) { out.push(cur); cur = []; }
    }
    if (cur.length) out.push(cur);
    out.push(null);
  }
  return out;
}
const PUNCT = { '،': ',', '؟': '?', '।': '.', '。': '.', '！': '!', '？': '?' };

async function speak(ort, { espeakDir, model, text, speed = 1 }, progress = () => {}) {
  const say = await speaker(espeakDir), v = await voice(ort, model), map = v.cfg.phoneme_id_map, inf = v.cfg.inference || {};
  const id = (c) => map[c]?.[0];
  const parts = sentences(text), chunks = [];
  let len = 0;
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (!s) { const gap = new Float32Array(Math.round(v.rate * 0.35)); chunks.push(gap); len += gap.length; continue; }
    let ipa = '';
    for (const clause of s) {
      const end = /([.!?;:,。！？،؟।])$/.exec(clause)?.[1];
      const body = end ? clause.slice(0, -1) : clause;
      if (/[\p{L}\p{N}]/u.test(body)) ipa += `${say(body, v.cfg.espeak.voice)}`;
      ipa += end ? `${PUNCT[end] || end} ` : ' ';
    }
    const seq = [id('^'), id('_')];
    for (const c of Array.from(ipa.trim())) { const x = id(c); if (x !== undefined) seq.push(x, id('_')); }
    seq.push(id('$'));
    if (seq.length < 5) continue;
    const out = await v.session.run({
      input: new ort.Tensor('int64', BigInt64Array.from(seq, BigInt), [1, seq.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(seq.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / speed, inf.noise_w ?? 0.8]), [3]),
    });
    const pcm = out.output.data;
    chunks.push(pcm, new Float32Array(Math.round(v.rate * 0.12)));
    len += pcm.length + Math.round(v.rate * 0.12);
    progress((i + 1) / parts.length);
  }
  const all = new Float32Array(len);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return { pcm: all, rate: v.rate };
}

module.exports = { speak, sentences };
