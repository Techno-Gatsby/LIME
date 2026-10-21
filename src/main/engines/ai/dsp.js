'use strict';
// Small signal helpers for the speech and music models: a mixed-radix FFT (sizes made of 2, 3 and 5,
// so 400, 960 and 4096 all work), windows and a simple resampler.

function factors(n) {
  const f = [];
  for (const p of [4, 2, 3, 5]) while (n % p === 0) { f.push(p); n /= p; }
  if (n !== 1) throw new Error(`FFT size must be made of 2, 3 and 5 (left ${n})`);
  return f;
}
const plans = new Map();
function plan(n) {
  if (plans.has(n)) return plans.get(n);
  const cos = new Float64Array(n), sin = new Float64Array(n);
  for (let i = 0; i < n; i++) { cos[i] = Math.cos((-2 * Math.PI * i) / n); sin[i] = Math.sin((-2 * Math.PI * i) / n); }
  const p = { n, f: factors(n), cos, sin, tr: new Float64Array(n), ti: new Float64Array(n) };
  plans.set(n, p);
  return p;
}
// In-place forward complex FFT of (re, im), both length n (inverse with inv = true, unscaled).
function fft(re, im, inv = false) {
  if ((re.length & (re.length - 1)) === 0) return fft2(re, im, inv);
  const P = plan(re.length);
  rec(P, re, im, 0, 1, re.length, 0, P.tr, P.ti, inv ? -1 : 1);
  re.set(P.tr); im.set(P.ti);
}
function rec(P, re, im, off, stride, n, fi, outR, outI, sgn, outOff = 0) {
  if (n === 1) { outR[outOff] = re[off]; outI[outOff] = im[off]; return; }
  const p = P.f[fi], m = n / p, tw = P.n / n;
  for (let q = 0; q < p; q++) rec(P, re, im, off + q * stride, stride * p, m, fi + 1, outR, outI, sgn, outOff + q * m);
  const xr = new Float64Array(p), xi = new Float64Array(p);
  for (let k = 0; k < m; k++) {
    for (let q = 0; q < p; q++) {
      const idx = outOff + q * m + k, t = (q * k * tw) % P.n;
      const c = P.cos[t], s = sgn * P.sin[t], a = outR[idx], b = outI[idx];
      xr[q] = a * c - b * s; xi[q] = a * s + b * c;
    }
    for (let j = 0; j < p; j++) {
      let sr = 0, si = 0;
      for (let q = 0; q < p; q++) {
        const t = ((q * j * m * tw) % P.n);
        const c = P.cos[t], s = sgn * P.sin[t];
        sr += xr[q] * c - xi[q] * s; si += xr[q] * s + xi[q] * c;
      }
      outR[outOff + j * m + k] = sr; outI[outOff + j * m + k] = si;
    }
  }
}
const bits = new Map();
function fft2(re, im, inv) {
  const n = re.length;
  let rev = bits.get(n);
  if (!rev) {
    rev = new Uint32Array(n);
    for (let i = 0, j = 0; i < n; i++) { rev[i] = j; let b = n >> 1; while (j & b) { j ^= b; b >>= 1; } j |= b; }
    bits.set(n, rev);
  }
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  const P = plan(n), sgn = inv ? -1 : 1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, t = 0; j < half; j++, t += step) {
        const c = P.cos[t], s = sgn * P.sin[t], a = i + j, b = a + half;
        const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}
// Real FFT of one frame: returns { re, im } with n/2 + 1 bins.
function rfft(frame) {
  const n = frame.length, re = new Float64Array(n), im = new Float64Array(n);
  re.set(frame);
  fft(re, im);
  return { re: re.subarray(0, n / 2 + 1), im: im.subarray(0, n / 2 + 1) };
}
// Inverse of rfft (n/2 + 1 bins in, n real samples out, scaled by 1/n).
function irfft(binsRe, binsIm, n) {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k <= n / 2; k++) { re[k] = binsRe[k]; im[k] = binsIm[k]; }
  for (let k = 1; k < n / 2; k++) { re[n - k] = binsRe[k]; im[n - k] = -binsIm[k]; }
  fft(re, im, true);
  for (let i = 0; i < n; i++) re[i] /= n;
  return re;
}
const hann = (n, periodic = true) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (periodic ? n : n - 1)));

const read = (f) => { const b = require('fs').readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const write = (f, pcm) => require('fs').writeFileSync(f, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));

module.exports = { fft, rfft, irfft, hann, read, write };
