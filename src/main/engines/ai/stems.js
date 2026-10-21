'use strict';
// Vocals and backing with Spleeter (Deezer, MIT) on onnxruntime: 44.1 kHz stereo spectra in blocks of 512
// frames, the two U-nets' magnitude estimates turned into ratio masks, as the sherpa-onnx export expects.
const path = require('path');
const { rfft, irfft, hann, read, write } = require('./dsp');

const SR = 44100, FFT = 4096, HOP = 1024, BINS = FFT / 2 + 1, USED = 1024, BLOCK = 512;

const models = new Map();
async function load(ort, dir) {
  if (models.has(dir)) return models.get(dir);
  const opts = { logSeverityLevel: 3, intraOpNumThreads: Math.max(1, Math.min(4, require('os').cpus().length)) };
  const m = { vocals: await ort.InferenceSession.create(path.join(dir, 'vocals.onnx'), opts), accompaniment: await ort.InferenceSession.create(path.join(dir, 'accompaniment.onnx'), opts) };
  models.set(dir, m);
  return m;
}

const WINDOW = hann(FFT);
function stft(x) {
  const T = Math.max(0, Math.floor((x.length - FFT) / HOP) + 1), re = new Float32Array(T * BINS), im = new Float32Array(T * BINS), frame = new Float64Array(FFT);
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < FFT; i++) frame[i] = x[t * HOP + i] * WINDOW[i];
    const f = rfft(frame);
    re.set(f.re, t * BINS); im.set(f.im, t * BINS);
  }
  return { re, im, T };
}
function istft(S, length) {
  const out = new Float32Array(length), norm = new Float32Array(length), re = new Float64Array(BINS), im = new Float64Array(BINS);
  for (let t = 0; t < S.T; t++) {
    for (let k = 0; k < BINS; k++) { re[k] = S.re[t * BINS + k]; im[k] = S.im[t * BINS + k]; }
    const x = irfft(re, im, FFT);
    for (let i = 0; i < FFT; i++) { const j = t * HOP + i; if (j < length) { out[j] += x[i] * WINDOW[i]; norm[j] += WINDOW[i] * WINDOW[i]; } }
  }
  for (let i = 0; i < length; i++) if (norm[i] > 1e-8) out[i] /= norm[i];
  return out;
}

// args: { dir, pcm (float32 stereo interleaved at 44.1 kHz), out: { vocals, accompaniment } (raw float32 files) }
async function run(ort, { dir, pcm, out }, progress = () => {}) {
  const m = await load(ort, dir), all = read(pcm), n = Math.floor(all.length / 2);
  const chans = [0, 1].map((c) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = all[i * 2 + c]; return x; });
  progress(0.02, 'Reading the music');
  const S = chans.map(stft), T = S[0].T, splits = Math.ceil(T / BLOCK), padded = splits * BLOCK;
  const x = new Float32Array(2 * padded * USED);
  for (let c = 0; c < 2; c++) for (let t = 0; t < T; t++) for (let k = 0; k < USED; k++) { const i = t * BINS + k; x[(c * padded + t) * USED + k] = Math.hypot(S[c].re[i], S[c].im[i]); }
  const mag = { vocals: new Float32Array(x.length), accompaniment: new Float32Array(x.length) };
  // One block of 512 frames (about 12 s) at a time keeps memory flat; the nets see each block on its own.
  for (let b = 0; b < splits; b++) {
    const part = new Float32Array(2 * BLOCK * USED);
    for (let c = 0; c < 2; c++) part.set(x.subarray((c * padded + b * BLOCK) * USED, (c * padded + (b + 1) * BLOCK) * USED), c * BLOCK * USED);
    const input = new ort.Tensor('float32', part, [2, 1, BLOCK, USED]);
    for (const name of ['vocals', 'accompaniment']) {
      const y = (await m[name].run({ x: input })).y.data;
      for (let c = 0; c < 2; c++) mag[name].set(y.subarray(c * BLOCK * USED, (c + 1) * BLOCK * USED), (c * padded + b * BLOCK) * USED);
    }
    progress(0.05 + (0.85 * (b + 1)) / splits, 'Separating');
  }
  const result = {};
  for (const name of ['vocals', 'accompaniment']) {
    const other = name === 'vocals' ? 'accompaniment' : 'vocals', stem = new Float32Array(n * 2);
    for (let c = 0; c < 2; c++) {
      const M = { re: new Float32Array(T * BINS), im: new Float32Array(T * BINS), T };
      for (let t = 0; t < T; t++) for (let k = 0; k < USED; k++) {
        const j = (c * padded + t) * USED + k, a = mag[name][j] ** 2, o = mag[other][j] ** 2, g = (a + 5e-11) / (a + o + 1e-10), i = t * BINS + k;
        M.re[i] = S[c].re[i] * g; M.im[i] = S[c].im[i] * g;
      }
      const y = istft(M, n);
      for (let i = 0; i < n; i++) stem[i * 2 + c] = y[i];
    }
    write(out[name], stem);
    result[name] = out[name];
  }
  progress(1, 'Saving');
  return { samples: n, rate: SR, channels: 2 };
}

module.exports = { run, stft, istft, SR };
