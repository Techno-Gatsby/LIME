// Whisper decoders from the sherpa-onnx export keep the token table in float32 (a quarter of the model's
// bytes). This rewrites it as int8 once, used both for the embedding lookup and the output projection
// (MatMulInteger), the way the int8 layers already work. A small protobuf codec keeps the rest untouched.

const varint = (b, i) => { let v = 0, m = 1; for (;;) { const c = b[i++]; v += (c & 127) * m; if (c < 128) return [v, i]; m *= 128; } };
function* fields(b) {
  for (let i = 0; i < b.length;) {
    const [tag, j] = varint(b, i), num = Math.floor(tag / 8), wt = tag & 7;
    let k = j, val;
    if (wt === 0) [val, k] = varint(b, k);
    else if (wt === 1) k += 8;
    else if (wt === 2) { const [n, m] = varint(b, k); val = b.subarray(m, m + n); k = m + n; }
    else if (wt === 5) k += 4;
    else throw new Error(`unsupported wire type ${wt}`);
    yield { num, wt, val, raw: b.subarray(i, k) };
    i = k;
  }
}
const uvar = (v) => { const out = []; while (v >= 128) { out.push((v % 128) | 128); v = Math.floor(v / 128); } out.push(v); return Buffer.from(out); };
const svar = (v) => uvar(v < 0 ? v + 2 ** 64 : v);
const bytes = (num, b) => Buffer.concat([uvar(num * 8 + 2), uvar(b.length), b]);
const str = (num, s) => bytes(num, Buffer.from(s, 'utf8'));
const int = (num, v) => Buffer.concat([uvar(num * 8), svar(v)]);
const msg = (...parts) => Buffer.concat(parts);

const strings = (b, num) => [...fields(b)].filter((f) => f.num === num).map((f) => f.val.toString('utf8'));
const node = (b) => ({ raw: b, input: strings(b, 1), output: strings(b, 2), name: strings(b, 3)[0] || '', op: strings(b, 4)[0] || '' });
const tensorName = (b) => strings(b, 8)[0] || '';
// AttributeProto: name 1, i 3, ints 8, type 20 (INT 2, INTS 7)
const attrInt = (name, v) => bytes(5, msg(str(1, name), int(3, v), int(20, 2)));
const attrInts = (name, list) => bytes(5, msg(str(1, name), ...list.map((v) => int(8, v)), int(20, 7)));
const mkNode = (op, inputs, outputs, ...attrs) => bytes(1, msg(...inputs.map((s) => str(1, s)), ...outputs.map((s) => str(2, s)), str(3, `slim/${outputs[0]}`), str(4, op), ...attrs));
// TensorProto: dims 1, data_type 2 (FLOAT 1, INT8 3, INT64 7), name 8, raw_data 9
const mkTensor = (name, type, dims, data) => bytes(5, msg(...dims.map((d) => int(1, d)), int(2, type), str(8, name), bytes(9, data)));

export function metadata(buf) {
  const out = {};
  for (const f of fields(buf)) if (f.num === 14) { const kv = strings(f.val, 1)[0], v = strings(f.val, 2)[0]; out[kv] = v; }
  return out;
}

export function slim(buf) {
  const E = 'textDecoder.token_embedding.weight';
  const top = [...fields(buf)], gi = top.findIndex((f) => f.num === 7);
  if (gi < 0) throw new Error('no graph in the decoder');
  const graph = [...fields(top[gi].val)];
  const ti = graph.findIndex((f) => f.num === 5 && tensorName(f.val) === E);
  if (ti < 0) throw new Error(`${E} is not a float table in this decoder`);
  const tf = [...fields(graph[ti].val)], dims = tf.filter((f) => f.num === 1).map((f) => f.val), type = tf.find((f) => f.num === 2)?.val, raw = tf.find((f) => f.num === 9)?.val;
  if (type !== 1 || dims.length !== 2 || !raw) throw new Error(`${E} is not a float32 [vocab, state] table`);
  const [vocab, state] = dims, w = new Float32Array(raw.buffer, raw.byteOffset, vocab * state);
  const scale = new Float32Array(vocab), qt = new Int8Array(state * vocab);
  for (let v = 0; v < vocab; v++) {
    let mx = 0;
    for (let d = 0; d < state; d++) mx = Math.max(mx, Math.abs(w[v * state + d]));
    scale[v] = mx / 127 || 1e-8;
    for (let d = 0; d < state; d++) qt[d * vocab + v] = Math.max(-127, Math.min(127, Math.round(w[v * state + d] / scale[v])));
  }
  const nodes = graph.map((f, i) => (f.num === 1 ? { i, ...node(f.val) } : null)).filter(Boolean);
  const ident = nodes.find((n) => n.op === 'Identity' && n.input[0] === E), gather = nodes.find((n) => n.op === 'Gather' && n.input[0] === E);
  const mm = ident && nodes.find((n) => n.op === 'MatMul' && n.input[0] === ident.output[0]);
  const tin = mm && nodes.find((n) => n.output[0] === mm.input[1]), tout = mm && nodes.find((n) => n.op === 'Transpose' && n.input[0] === mm.output[0]);
  if (!gather || !mm || !tin || !tout) throw new Error('the decoder’s logits graph is not the one this script knows');
  const X = tin.input[0], OUT = tout.output[0], drop = new Set([ident.i, mm.i, tin.i, tout.i, gather.i]);
  const emb = [mkNode('Gather', ['emb_qt', 'tokens'], ['emb_g'], attrInt('axis', 1)), mkNode('Transpose', ['emb_g'], ['emb_gt'], attrInts('perm', [1, 2, 0])), mkNode('Cast', ['emb_gt'], ['emb_gf'], attrInt('to', 1)),
    mkNode('Gather', ['emb_s', 'tokens'], ['emb_gs']), mkNode('Unsqueeze', ['emb_gs', 'emb_axis'], ['emb_gs3']), mkNode('Mul', ['emb_gf', 'emb_gs3'], [gather.output[0]])];
  const logits = [mkNode('DynamicQuantizeLinear', [X], ['x_q', 'x_s', 'x_z']), mkNode('MatMulInteger', ['x_q', 'emb_qt', 'x_z', 'emb_z'], ['lg_i']), mkNode('Cast', ['lg_i'], ['lg_f'], attrInt('to', 1)),
    mkNode('Mul', ['x_s', 'emb_s'], ['lg_scale']), mkNode('Mul', ['lg_f', 'lg_scale'], [OUT])];
  const tensors = [mkTensor('emb_qt', 3, [state, vocab], Buffer.from(qt.buffer)), mkTensor('emb_s', 1, [vocab], Buffer.from(scale.buffer)), mkTensor('emb_z', 3, [vocab], Buffer.alloc(vocab)),
    mkTensor('emb_axis', 7, [1], Buffer.from(new BigInt64Array([-1n]).buffer))];
  const out = [];
  graph.forEach((f, i) => {
    if (i === ti) { out.push(...tensors); return; }
    if (i === gather.i) out.push(...emb);
    if (i === tin.i) out.push(...logits);
    if (!drop.has(i)) out.push(f.raw);
  });
  return Buffer.concat(top.map((f, i) => (i === gi ? bytes(7, Buffer.concat(out)) : f.raw)));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').replace(/^.*\//, '/'))) {
  const fs = await import('node:fs');
  const [src, dst] = process.argv.slice(2);
  const buf = fs.readFileSync(src);
  if (!dst) console.log(metadata(buf));
  else { fs.writeFileSync(dst, slim(buf)); console.log(`${(buf.length / 1048576).toFixed(0)} MB → ${(fs.statSync(dst).size / 1048576).toFixed(0)} MB`); }
}
