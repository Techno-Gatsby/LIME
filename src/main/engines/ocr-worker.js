'use strict';
const { parentPort } = require('worker_threads');
const worker = require('tesseract.js/src/worker-script');
let core = null;
parentPort.on('message', (packet) => worker.dispatchHandlers(packet, (obj) => parentPort.postMessage(obj)));
worker.setAdapter({
  getCore: async (oem, _, res) => {
    if (!core) { res.progress({ status: 'loading tesseract core', progress: 0 }); core = require('tesseract.js-core/tesseract-core-simd-lstm'); res.progress({ status: 'loading tesseract core', progress: 1 }); }
    return core;
  },
  gunzip: require('tesseract.js/src/worker-script/node/gunzip'),
  fetch: global.fetch,
  ...require('tesseract.js/src/worker-script/node/cache'),
});
