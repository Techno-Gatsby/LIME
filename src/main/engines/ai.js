'use strict';
// Upscaling and object removal with small neural networks, on this computer. The models ship packed with Lime
// (vendor/models) and are unpacked into the user folder the first time they're needed.
//   upscale: Real-ESRGAN compact models (realesr-general-x4v3 for photos, realesr-animevideov3 for drawings), BSD-3-Clause.
//   lama:    LaMa big-lama inpainting at 512×512, Apache-2.0.
const U = require('./util');
const { fsp, path } = U;
const img = () => require('./image');
const sharp = () => img().sharp();

const NAMES = { upscale: 'The upscale model', lama: 'The object removal model' };
const MAX_OUT = 120e6;
const SIZE = 512;

async function model(id, file, progress = () => {}) {
  const first = await require('../helpers').ensure(id, U.cfg.models, path.join(U.cfg.user, 'models'), (p) => p.phase === 'unpack' && progress());
  if (!first) throw new Error(`${NAMES[id]} isn’t in this build of Lime.`);
  return path.join(path.dirname(first), file);
}
const available = (id) => !!require('../helpers').bundled(id, U.cfg.models);

function infer(job, { signal, progress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = require('child_process').fork(path.join(__dirname, 'onnxrun.js'), [], { execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced' });
    let err = '', settled = false;
    const stop = () => child.kill();
    signal?.addEventListener('abort', stop, { once: true });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('message', (m) => {
      if (m.progress != null) return progress(m.progress);
      settled = true;
      if (m.error) reject(new Error(m.error)); else resolve(Buffer.from(m.done.buffer, m.done.byteOffset, m.done.byteLength));
      child.kill();
    });
    child.on('exit', (code, sig) => {
      signal?.removeEventListener('abort', stop);
      if (settled) return;
      reject(Object.assign(new Error(signal?.aborted ? 'Cancelled' : `The model stopped${sig ? ` (${sig})` : ''}${err.trim() ? `: ${err.trim().split('\n').pop()}` : ''}`), { cancelled: !!signal?.aborted }));
    });
    child.send(job);
  });
}

async function upscale(p, opts, ctx) {
  const factor = opts.factor === '2' ? 2 : 4, kind = opts.kind === 'drawing' ? 'drawing' : 'photo';
  const say = (k, label) => ctx.progress?.(k, label);
  const buf = await (await img().open(p)).rotate().png({ compressionLevel: 1 }).toBuffer();
  const meta = await sharp()(buf).metadata(), W = meta.width, H = meta.height;
  if (W * H * factor * factor > MAX_OUT) throw new Error(`This picture is too big to enlarge ${factor}× (${Math.round(W * factor)}×${Math.round(H * factor)} pixels).${factor === 4 ? ' Try 2×.' : ''}`);
  say(0.02, 'Preparing the model');
  const file = await model('upscale', `${kind}.onnx`, () => say(0.03, 'Unpacking the model'));
  const rgb = await sharp()(buf).removeAlpha().raw().toBuffer();
  say(0.05, `Upscaling ${factor}×`);
  const out = await infer({ model: file, data: rgb, width: W, height: H, scale: 4, shrink: 4 / factor }, { signal: ctx.signal, progress: (k) => say(0.05 + 0.9 * k, `Upscaling ${factor}×`) });
  const OW = W * factor, OH = H * factor;
  let pipe = sharp()(out, { raw: { width: OW, height: OH, channels: 3 }, limitInputPixels: false });
  if (meta.hasAlpha) {
    const rgba = await sharp()(buf, { limitInputPixels: false }).resize(OW, OH, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
    for (let i = 0; i < OW * OH; i++) out.copy(rgba, i * 4, i * 3, i * 3 + 3);
    pipe = sharp()(rgba, { raw: { width: OW, height: OH, channels: 4 }, limitInputPixels: false });
  }
  const to = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tif', 'tiff'].includes(U.ext(p)) ? U.ext(p).replace('jpeg', 'jpg').replace(/^tif$/, 'tiff') : 'png';
  const dest = ctx.out.file(p, `${U.base(p)}-${factor}x.${to}`);
  await img().writeAs(pipe, to, dest, { quality: 94 });
  return { path: dest, note: `${W}×${H} → ${OW}×${OH}` };
}

// Fills the brushed area of a picture. The model sees a 512-pixel square around the brush (scaled down when the area
// is bigger than that); only the brushed part, softly edged, goes back into the full-size picture.
async function erase(file, { points, size }, dest, { signal } = {}) {
  const src = sharp()(file, { failOn: 'none', limitInputPixels: false });
  const meta = await src.metadata(), W = meta.width, H = meta.height, long = Math.max(W, H);
  const r = Math.max(2, size * long), pts = points.map((q) => [q[0] * W, q[1] * H]);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]), grow = r * 1.15 + 3;
  const bx0 = Math.max(0, Math.floor(Math.min(...xs) - grow)), by0 = Math.max(0, Math.floor(Math.min(...ys) - grow));
  const bx1 = Math.min(W, Math.ceil(Math.max(...xs) + grow)), by1 = Math.min(H, Math.ceil(Math.max(...ys) + grow));
  if (bx1 <= bx0 || by1 <= by0) throw new Error('Brush over the part of the picture to remove.');
  // a square with as much again of the surroundings, so the model sees what to continue
  const side = Math.min(Math.max(W, H), Math.max(Math.min(SIZE, W, H), Math.round(Math.max(bx1 - bx0, by1 - by0) * 2)));
  const cw = Math.min(W, side), ch = Math.min(H, side);
  const cx = Math.round(U.clamp((bx0 + bx1) / 2 - cw / 2, 0, W - cw)), cy = Math.round(U.clamp((by0 + by1) / 2 - ch / 2, 0, H - ch));
  const k = SIZE / Math.max(cw, ch), sw = Math.max(1, Math.round(cw * k)), sh = Math.max(1, Math.round(ch * k));
  const stroke = (w, x0, y0, s) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w[0]}" height="${w[1]}"><rect width="100%" height="100%" fill="#000"/><polyline points="${pts.map(([x, y]) => `${((x - x0) * s).toFixed(2)},${((y - y0) * s).toFixed(2)}`).join(' ')}${pts.length === 1 ? ` ${((pts[0][0] - x0) * s + 0.01).toFixed(2)},${((pts[0][1] - y0) * s).toFixed(2)}` : ''}" fill="none" stroke="#fff" stroke-width="${(2 * grow * s).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
  const gray = (svg, w, h) => sharp()(svg).resize(w, h, { fit: 'fill' }).extractChannel(0).raw().toBuffer();
  const pad = { top: 0, left: 0, bottom: SIZE - sh, right: SIZE - sw };
  const crop = await sharp()(await src.clone().removeAlpha().extract({ left: cx, top: cy, width: cw, height: ch }).raw().toBuffer(), { raw: { width: cw, height: ch, channels: 3 } });
  const image = await crop.clone().resize(sw, sh, { fit: 'fill', kernel: 'lanczos3' }).extend({ ...pad, extendWith: 'mirror' }).raw().toBuffer();
  const small = await gray(stroke([sw, sh], cx, cy, k), sw, sh), mask = Buffer.alloc(SIZE * SIZE);
  for (let y = 0; y < sh; y++) small.copy(mask, y * SIZE, y * sw, (y + 1) * sw);
  const filled = await infer({ task: 'inpaint', model: await model('lama', 'lama.onnx'), image, mask, size: SIZE }, { signal });
  const back = await sharp()(filled, { raw: { width: SIZE, height: SIZE, channels: 3 } }).extract({ left: 0, top: 0, width: sw, height: sh }).resize(cw, ch, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  const soft = await sharp()(await gray(stroke([cw, ch], cx, cy, 1), cw, ch), { raw: { width: cw, height: ch, channels: 1 } }).blur(Math.max(0.6, Math.min(4, grow * 0.08))).extractChannel(0).raw().toBuffer();
  const patch = Buffer.alloc(cw * ch * 4);
  for (let i = 0; i < cw * ch; i++) { back.copy(patch, i * 4, i * 3, i * 3 + 3); patch[i * 4 + 3] = soft[i]; }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await src.clone().composite([{ input: patch, raw: { width: cw, height: ch, channels: 4 }, left: cx, top: cy }]).png().toFile(dest);
  return dest;
}

module.exports = { upscale, erase, available };
