'use strict';
// Face detection in a child process (onnxruntime must not run in Lime's worker thread). The parent sends
// { model, tiles: [{ data: 320×240 RGB }] } and gets back, per tile, [score, x1, y1, x2, y2] boxes in 0..1.
// Model: Ultra-Light-Fast-Generic-Face-Detector-1MB, version-RFB-320 (MIT, Linzaer).
process.on('message', async ({ model, tiles, threshold = 0.7 }) => {
  try {
    const ort = require('onnxruntime-node');
    const session = await ort.InferenceSession.create(model, { logSeverityLevel: 3 });
    const found = [];
    for (const { data } of tiles) {
      const px = 320 * 240, x = new Float32Array(3 * px);
      for (let i = 0; i < px; i++) for (let c = 0; c < 3; c++) x[c * px + i] = (data[i * 3 + c] - 127) / 128;
      const { scores, boxes } = await session.run({ input: new ort.Tensor('float32', x, [1, 3, 240, 320]) });
      const list = [];
      for (let i = 0; i < scores.data.length / 2; i++) if (scores.data[2 * i + 1] >= threshold) list.push([scores.data[2 * i + 1], ...boxes.data.subarray(4 * i, 4 * i + 4)]);
      found.push(list);
    }
    process.send({ done: found });
  } catch (e) { process.send({ error: e.message }); }
});
