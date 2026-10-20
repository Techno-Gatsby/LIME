'use strict';
// Runs the background-removal model in its own process, so a crash in the native runtime fails one job instead of Lime.
const fs = require('fs');
process.on('message', async ({ input, out, model }) => {
  try {
    const { removeBackground } = require('@imgly/background-removal-node');
    const blob = await removeBackground(new Blob([fs.readFileSync(input)], { type: 'image/png' }), { model, output: { format: 'image/png', quality: 1 }, progress: (k, cur, total) => { if (total) process.send({ progress: cur / total }); } });
    fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
    process.send({ done: true }, () => process.exit(0));
  } catch (e) { process.send({ error: e.message }, () => process.exit(1)); }
});
