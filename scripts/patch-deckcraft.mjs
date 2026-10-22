// DeckCraft 0.9.0's web build panics on start: recovery::instance_id() hashes std::process::id(), which panics
// on wasm32-unknown-unknown ("no pids on this platform"). The panic was inlined into the OnceLock initialiser and
// everything after it was dropped as dead code, so the patch puts back the end of that initialiser: it stores an
// instance id made from the RandomState key already loaded (masked to 53 bits with the low 24 clear, as the original
// does), marks the OnceLock complete, restores the frame pointer and leaves through the "already complete" path.
// It applies only to the exact 0.9.0 wasm (by SHA-256); any other build is left alone.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const WASM_SHA = 'e0849d8de375fe7726a621f7e98112b76a7b0d0bc361d701bcae66b639c8e354';
const uleb = (v) => { const o = []; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (v) => { v = BigInt(v); const o = []; for (;;) { const b = Number(v & 0x7fn); v >>= 7n; if ((v === 0n && !(b & 0x40)) || (v === -1n && b & 0x40)) { o.push(b); return o; } o.push(b | 0x80); } };
const readUleb = (b, i) => { let r = 0, s = 0, x; do { x = b[i++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80); return [r, i]; };

// call core::panicking::panic("no pids on this platform", .., &Location{unsupported.rs:335:5}); unreachable
const PANIC = [0x41, ...sleb(5081104), 0x41, ...sleb(49), 0x41, ...sleb(5081128), 0x10, ...uleb(14956), 0x00];
const FIX = [
  0x41, ...sleb(5695280), 0x20, 0x03, 0x42, ...sleb(0x1fffffff000000n), 0x83, 0x42, ...sleb(0x1000000), 0x84, 0x37, 0x03, 0x00, // ID = (k0 & mask) | 1<<24
  0x41, ...sleb(5695288), 0x41, 0x03, 0x3a, 0x00, 0x00, // once.state = Complete
  0x20, 0x02, 0x41, 0x10, 0x6a, 0x21, 0x00, // $0 = frame (it was reused for the keys pointer)
  0x0c, 0x01, // br to the "complete" exit, which pops both frames
];

export function patchDeckcraft(site) {
  const wasm = fs.readdirSync(site).find((f) => /^deckcraft-web-.*_bg\.wasm$/.test(f));
  if (!wasm) return false;
  const file = path.join(site, wasm), b = fs.readFileSync(file);
  if (crypto.createHash('sha256').update(b).digest('hex') !== WASM_SHA) return false;
  // Find the code section, then the one function body holding the panic.
  let i = 8, code = null;
  while (i < b.length) { const id = b[i]; let size; [size, i] = readUleb(b, i + 1); if (id === 10) { code = { start: i, end: i + size }; break; } i += size; }
  let [n, j] = readUleb(b, code.start), hit = null;
  for (let k = 0; k < n && !hit; k++) {
    const head = j; let size; [size, j] = readUleb(b, j);
    const at = b.subarray(j, j + size).indexOf(Buffer.from(PANIC));
    if (at >= 0) hit = { head, body: j, size, at: j + at };
    j += size;
  }
  if (!hit) throw new Error('DeckCraft patch: the panic in instance_id() was not found');
  const body = Buffer.concat([b.subarray(hit.body, hit.at), Buffer.from(FIX), b.subarray(hit.at + PANIC.length, hit.body + hit.size)]);
  const fn = Buffer.concat([Buffer.from(uleb(body.length)), body]);
  const section = Buffer.concat([b.subarray(code.start, hit.head), fn, b.subarray(hit.body + hit.size, code.end)]);
  let s = code.start - 1; while (b[s - 1] & 0x80) s--; // start of the section's size field
  fs.writeFileSync(file, Buffer.concat([b.subarray(0, s), Buffer.from(uleb(section.length)), section, b.subarray(code.end)]));
  // The preload's integrity hash names the bytes: give it the patched file's.
  const index = path.join(site, 'index.html'), sri = `sha384-${crypto.createHash('sha384').update(fs.readFileSync(file)).digest('base64')}`;
  fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(new RegExp(`(<link rel="preload" href="\\./${wasm.replace(/\./g, '\\.')}"[^>]*? integrity=")[^"]*"`), `$1${sri}"`));
  return true;
}
