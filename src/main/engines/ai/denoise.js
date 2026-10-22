'use strict';
// Voice clean-up with DeepFilterNet3 (MIT/Apache-2.0) on onnxruntime: 48 kHz spectra, ERB band gains for
// the whole range and a complex "deep filter" on the lowest 96 bins. The features, normalisation, frame
// delays and overlap-add follow libDF's tract runtime; the three ONNX graphs are the model's own export.
const fs = require('fs'), path = require('path');
const { rfft, irfft, read, write } = require('./dsp');

const SR = 48000, FFT = 960, HOP = 480, BINS = FFT / 2 + 1, NB_ERB = 32, NB_DF = 96, ORDER = 5, LOOK = 2;
const ALPHA = Math.exp(-HOP / SR), WNORM = 1 / (FFT * FFT / (2 * HOP));
const MIN_DB = -10, MAX_DB_ERB = 30, MAX_DB_DF = 20;
const CHUNK = 3000, CONTEXT = 100;

const freq2erb = (f) => 9.265 * Math.log1p(f / (24.7 * 9.265)), erb2freq = (n) => 24.7 * 9.265 * (Math.exp(n / 9.265) - 1);
function erbBands() {
  const width = SR / FFT, step = (freq2erb(SR / 2) - freq2erb(0)) / NB_ERB, bands = [];
  let prev = 0, over = 0;
  for (let i = 1; i <= NB_ERB; i++) {
    const fb = Math.round(erb2freq(freq2erb(0) + i * step) / width);
    let n = fb - prev - over;
    if (n < 2) { over = 2 - n; n = 2; } else over = 0;
    bands.push(n); prev = fb;
  }
  bands[NB_ERB - 1] += 1;
  const extra = bands.reduce((a, b) => a + b, 0) - BINS;
  if (extra > 0) bands[NB_ERB - 1] -= extra;
  return bands;
}
const BANDS = erbBands();
const WINDOW = Float64Array.from({ length: FFT }, (_, i) => { const s = Math.sin((0.5 * Math.PI * (i + 0.5)) / (FFT / 2)); return Math.sin(0.5 * Math.PI * s * s); });

const models = new Map();
async function load(ort, dir) {
  if (models.has(dir)) return models.get(dir);
  const opts = { logSeverityLevel: 3, intraOpNumThreads: Math.max(1, Math.min(4, require('os').cpus().length)) };
  const m = {};
  for (const n of ['enc', 'erb_dec', 'df_dec']) m[n] = await ort.InferenceSession.create(path.join(dir, `${n}.onnx`), opts);
  models.set(dir, m);
  return m;
}

// Spectra of one channel: frames of HOP samples, each seen with the previous HOP (the vorbis window spans two).
function analyse(x) {
  const T = Math.ceil(x.length / HOP) + LOOK + 1, re = new Float32Array(T * BINS), im = new Float32Array(T * BINS), frame = new Float64Array(FFT);
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < FFT; i++) { const j = (t - 1) * HOP + i; frame[i] = (j >= 0 && j < x.length ? x[j] : 0) * WINDOW[i]; }
    const f = rfft(frame);
    for (let k = 0; k < BINS; k++) { re[t * BINS + k] = f.re[k] * WNORM; im[t * BINS + k] = f.im[k] * WNORM; }
  }
  return { re, im, T };
}
// Band energies in dB with a running mean taken off, and the low bins scaled by a running magnitude.
function features(S) {
  const { T } = S, erb = new Float32Array(T * NB_ERB), re = new Float32Array(T * NB_DF), im = new Float32Array(T * NB_DF);
  const mean = Float32Array.from({ length: NB_ERB }, (_, i) => -60 - (30 * i) / (NB_ERB - 1)), unit = Float32Array.from({ length: NB_DF }, (_, i) => 0.001 - (0.0009 * i) / (NB_DF - 1));
  for (let t = 0; t < T; t++) {
    const o = t * BINS;
    for (let b = 0, k = 0; b < NB_ERB; b++) {
      let s = 0;
      for (let j = 0; j < BANDS[b]; j++, k++) s += S.re[o + k] * S.re[o + k] + S.im[o + k] * S.im[o + k];
      const v = 10 * Math.log10(s / BANDS[b] + 1e-10);
      mean[b] = v * (1 - ALPHA) + mean[b] * ALPHA;
      erb[t * NB_ERB + b] = (v - mean[b]) / 40;
    }
    for (let k = 0; k < NB_DF; k++) {
      unit[k] = Math.hypot(S.re[o + k], S.im[o + k]) * (1 - ALPHA) + unit[k] * ALPHA;
      const d = Math.sqrt(unit[k]);
      re[t * NB_DF + k] = S.re[o + k] / d; im[t * NB_DF + k] = S.im[o + k] / d;
    }
  }
  return { erb, re, im };
}
// Model inputs for frames from … to: [1, 1, n, 32] band features and [1, 2, n, 96] complex bins.
function slice(F, from, to) {
  const n = to - from, spec = new Float32Array(2 * n * NB_DF);
  spec.set(F.re.subarray(from * NB_DF, to * NB_DF));
  spec.set(F.im.subarray(from * NB_DF, to * NB_DF), n * NB_DF);
  return { n, erb: F.erb.subarray(from * NB_ERB, to * NB_ERB), spec };
}

async function enhance(ort, m, S, atten, progress) {
  const { T } = S, outRe = new Float32Array(T * BINS), outIm = new Float32Array(T * BINS), feats = features(S);
  // Each model step t describes frame t - LOOK: band gains for the whole spectrum and filter taps over frames t - 4 … t.
  for (let start = 0; start < T; start += CHUNK) {
    const from = Math.max(0, start - CONTEXT), to = Math.min(T, start + CHUNK), F = slice(feats, from, to), n = F.n;
    const enc = await m.enc.run({ feat_erb: new ort.Tensor('float32', F.erb, [1, 1, n, NB_ERB]), feat_spec: new ort.Tensor('float32', F.spec, [1, 2, n, NB_DF]) });
    const gains = (await m.erb_dec.run({ emb: enc.emb, e3: enc.e3, e2: enc.e2, e1: enc.e1, e0: enc.e0 })).m.data;
    const coefs = (await m.df_dec.run({ emb: enc.emb, c0: enc.c0 })).coefs.data, lsnr = enc.lsnr.data;
    for (let t = Math.max(start, LOOK); t < to; t++) {
      const k = t - LOOK, r = t - from, snr = lsnr[r], o = k * BINS;
      const useGain = snr >= MIN_DB && snr <= MAX_DB_ERB, useDf = snr >= MIN_DB && snr <= MAX_DB_DF, zero = snr < MIN_DB;
      for (let b = 0, f = 0; b < NB_ERB; b++) {
        const g = zero ? 0 : useGain ? gains[r * NB_ERB + b] : 1;
        for (let j = 0; j < BANDS[b]; j++, f++) { outRe[o + f] = S.re[o + f] * g; outIm[o + f] = S.im[o + f] * g; }
      }
      if (useDf) {
        for (let f = 0; f < NB_DF; f++) {
          let sr = 0, si = 0;
          for (let i = 0; i < ORDER; i++) {
            const ft = t - ORDER + 1 + i;
            if (ft < 0) continue;
            const c = (r * NB_DF + f) * ORDER * 2 + i * 2, cr = coefs[c], ci = coefs[c + 1], xr = S.re[ft * BINS + f], xi = S.im[ft * BINS + f];
            sr += xr * cr - xi * ci; si += xr * ci + xi * cr;
          }
          outRe[o + f] = sr; outIm[o + f] = si;
        }
      }
      if (atten) for (let f = 0; f < BINS; f++) { outRe[o + f] = outRe[o + f] * (1 - atten) + S.re[o + f] * atten; outIm[o + f] = outIm[o + f] * (1 - atten) + S.im[o + f] * atten; }
    }
    progress(to / T);
  }
  return { re: outRe, im: outIm, T };
}
// Overlap-add back to samples; the first hop is the window's lead-in, so the clip lines up with the input.
function synthesise(E, length) {
  const out = new Float32Array(length), mem = new Float64Array(HOP), re = new Float64Array(BINS), im = new Float64Array(BINS);
  for (let t = 0; t < E.T; t++) {
    for (let k = 0; k < BINS; k++) { re[k] = E.re[t * BINS + k]; im[k] = E.im[t * BINS + k]; }
    const x = irfft(re, im, FFT);
    for (let i = 0; i < HOP; i++) {
      const j = (t - 1) * HOP + i, v = x[i] * WINDOW[i] * FFT + mem[i];
      if (j >= 0 && j < length) out[j] = v;
      mem[i] = x[i + HOP] * WINDOW[i + HOP] * FFT;
    }
  }
  return out;
}

// args: { dir, pcm (float32 interleaved at 48 kHz), channels, out, keep (0…1 of the original mixed back) }
async function run(ort, { dir, pcm, channels = 1, out, keep = 0 }, progress = () => {}) {
  const m = await load(ort, dir), all = read(pcm), n = Math.floor(all.length / channels), result = new Float32Array(n * channels);
  for (let c = 0; c < channels; c++) {
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = all[i * channels + c];
    const S = analyse(x);
    const E = await enhance(ort, m, S, keep, (f) => progress((c + f) / channels));
    const y = synthesise(E, n);
    for (let i = 0; i < n; i++) result[i * channels + c] = y[i];
  }
  write(out, result);
  return { samples: n, channels, rate: SR };
}

module.exports = { run, analyse, synthesise, BANDS, SR };
