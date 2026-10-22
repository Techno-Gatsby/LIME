'use strict';
// Silero voice activity detection (MIT) on onnxruntime: one speech probability per 32 ms of 16 kHz audio.
const FRAME = 512;

async function load(model) {
  const ort = require('onnxruntime-node');
  const sess = await ort.InferenceSession.create(model, { logSeverityLevel: 3, intraOpNumThreads: 1, interOpNumThreads: 1 });
  const zeros = () => new ort.Tensor('float32', new Float32Array(128), [2, 1, 64]);
  let h = zeros(), c = zeros();
  return {
    FRAME,
    reset() { h = zeros(); c = zeros(); },
    async prob(frame) {
      const r = await sess.run({ x: new ort.Tensor('float32', frame, [1, FRAME]), h, c });
      h = r.new_h; c = r.new_c;
      return r.prob.data[0];
    },
  };
}

module.exports = { load, FRAME };
