'use strict';
// Runs the upscale and object-removal models in their own process (onnxruntime must not run in Lime's worker thread).
// Pictures come and go as raw RGB bytes. Upscaling works tile by tile, each tile read with a margin of its neighbours
// so the seams don't show, which keeps memory flat however big the picture is.
const sessions = new Map();
async function session(model) {
  if (!sessions.has(model)) {
    const ort = require('onnxruntime-node');
    sessions.set(model, await ort.InferenceSession.create(model, { logSeverityLevel: 3, graphOptimizationLevel: 'all' }));
  }
  return sessions.get(model);
}
const planar = (src, sw, x0, y0, w, h) => {
  const px = w * h, out = new Float32Array(3 * px);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y0 + y) * sw + x0 + x) * 3, d = y * w + x;
    out[d] = src[s] / 255; out[px + d] = src[s + 1] / 255; out[2 * px + d] = src[s + 2] / 255;
  }
  return out;
};
async function upscale({ model, data, width: W, height: H, scale = 4, shrink = 1, tile = 320, margin = 16 }) {
  // shrink 2 averages each 2×2 block of the model's 4× result, for a clean 2×.
  const ort = require('onnxruntime-node'), s = await session(model), f = scale / shrink, OW = W * f, out = Buffer.alloc(OW * H * f * 3), n = shrink * shrink;
  const cols = Math.ceil(W / tile), rows = Math.ceil(H / tile);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = c * tile, y0 = r * tile, x1 = Math.min(W, x0 + tile), y1 = Math.min(H, y0 + tile);
    const ax = Math.max(0, x0 - margin), ay = Math.max(0, y0 - margin), bx = Math.min(W, x1 + margin), by = Math.min(H, y1 + margin);
    const w = bx - ax, h = by - ay;
    const { output } = await s.run({ input: new ort.Tensor('float32', planar(data, W, ax, ay, w, h), [1, 3, h, w]) });
    const o = output.data, ow = w * scale, opx = ow * h * scale;
    for (let y = y0 * f; y < y1 * f; y++) for (let x = x0 * f; x < x1 * f; x++) {
      const d = (y * OW + x) * 3;
      for (let ch = 0; ch < 3; ch++) {
        let v = 0;
        for (let j = 0; j < shrink; j++) for (let i = 0; i < shrink; i++) v += o[ch * opx + (y * shrink + j - ay * scale) * ow + x * shrink + i - ax * scale];
        out[d + ch] = Math.max(0, Math.min(255, Math.round((v / n) * 255)));
      }
    }
    process.send({ progress: (r * cols + c + 1) / (rows * cols) });
  }
  return out;
}
async function inpaint({ model, image, mask, size = 512 }) {
  const ort = require('onnxruntime-node'), s = await session(model), px = size * size, m = new Float32Array(px);
  for (let i = 0; i < px; i++) m[i] = mask[i] > 127 ? 1 : 0;
  const { output } = await s.run({ image: new ort.Tensor('float32', planar(image, size, 0, 0, size, size), [1, 3, size, size]), mask: new ort.Tensor('float32', m, [1, 1, size, size]) });
  const o = output.data, out = Buffer.alloc(px * 3);
  for (let i = 0; i < px; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.max(0, Math.min(255, Math.round(o[c * px + i] * 255)));
  return out;
}
process.on('message', async (job) => {
  try { process.send({ done: await (job.task === 'inpaint' ? inpaint : upscale)(job) }); } catch (e) { process.send({ error: e.message }); }
});
