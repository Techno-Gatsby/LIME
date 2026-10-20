'use strict';
const assert = require('assert');
const { detector } = require('../src/main/dragwatch');

function run(frames, opts) {
  const log = [];
  let i = 0;
  const tick = detector(() => frames[i], { onDrag: (shift) => log.push(shift ? 'drag+shift' : 'drag'), onShift: () => log.push('shift'), onEnd: () => log.push('end') }, opts);
  for (; i < frames.length; i++) tick();
  return log;
}
const mac = (left, shift, count) => ({ left, shift, count });
const win = (left, shift, x, y, fm = 'explorer.exe', shellDrag = false) => ({ left, shift, x, y, at: () => fm, shellDrag: () => shellDrag, fileManager: (n) => n === 'explorer.exe' });
const cases = {
  'mac: Finder drag with Shift held from the start': [[mac(false, false, 5), mac(true, true, 5), mac(true, true, 6), mac(true, true, 6), mac(false, false, 6)], ['drag+shift', 'shift', 'end']],
  'mac: Shift pressed during the drag': [[mac(false, false, 5), mac(true, false, 6), mac(true, false, 6), mac(true, true, 6), mac(false, true, 6)], ['drag', 'shift', 'end']],
  'mac: drag starts in the same poll as the press': [[mac(false, false, 9), mac(true, true, 10), mac(false, false, 10)], ['drag+shift', 'shift', 'end']],
  'mac: plain click with Shift is not a drag': [[mac(false, false, 3), mac(true, true, 3), mac(true, true, 3), mac(false, false, 3)], []],
  'mac: window move (no pasteboard change) is ignored': [[mac(false, false, 3), mac(true, false, 3), mac(true, true, 3), mac(false, false, 3)], []],
  'mac: two drags in a row': [[mac(false, false, 1), mac(true, true, 2), mac(false, false, 2), mac(true, false, 2), mac(true, false, 3), mac(true, true, 3), mac(false, false, 3)], ['drag+shift', 'shift', 'end', 'drag', 'shift', 'end']],
  'win: Shift-drag from Explorer past the threshold': [[win(false, false, 0, 0), win(true, true, 100, 100), win(true, true, 104, 103), win(true, true, 112, 109), win(false, false, 112, 109)], ['drag+shift', 'shift', 'end']],
  'win: small jitter is not a drag': [[win(true, true, 100, 100), win(true, true, 103, 102), win(false, false, 103, 102)], []],
  'win: drag in a non-file-manager app is ignored': [[win(true, true, 100, 100, 'notepad.exe'), win(true, true, 140, 140, 'notepad.exe'), win(false, false, 140, 140, 'notepad.exe')], []],
  'win: shell drag image counts even outside Explorer': [[win(true, false, 100, 100, 'chrome.exe', true), win(true, false, 130, 100, 'chrome.exe', true), win(true, true, 140, 100, 'chrome.exe', true), win(false, false, 0, 0)], ['drag', 'shift', 'end']],
};
let failed = 0;
for (const [name, [frames, want]] of Object.entries(cases)) {
  const got = run(frames);
  try { assert.deepStrictEqual(got, want); console.log(`PASS ${name}`); } catch (_) { failed++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
console.log(`\n${Object.keys(cases).length - failed}/${Object.keys(cases).length} drag-watch cases passed`);
process.exit(failed ? 1 : 0);
