'use strict';
// The speech and music models run here, in a child process (onnxruntime must not run in Lime's worker
// thread). It stays up between jobs so models load once. Messages: { id, op, args } in; { id, progress },
// { id, done } or { id, error } out. Large audio goes through raw float32 files.
const { read, write } = require('./dsp');
const OPS = {
  asr: (ort, a, p) => require('./asr').transcribe(ort, a.dir, a.samples || read(a.pcm), a.opts, p),
  async tts(ort, a, p) { const r = await require('./tts').speak(ort, a, p); write(a.out, r.pcm); return { rate: r.rate, samples: r.pcm.length }; },
  denoise: (ort, a, p) => require('./denoise').run(ort, a, p),
  stems: (ort, a, p) => require('./stems').run(ort, a, p),
};

let queue = Promise.resolve();
process.on('message', ({ id, op, args }) => {
  queue = queue.then(async () => {
    try {
      const ort = require('onnxruntime-node');
      let last = 0;
      const progress = (f, label) => { if (Date.now() - last > 200) { last = Date.now(); process.send({ id, progress: f, label }); } };
      process.send({ id, done: await OPS[op](ort, args, progress) });
    } catch (e) { process.send({ id, error: e.message }); }
  });
});
