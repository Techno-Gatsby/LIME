'use strict';
// Upscale with AI and object removal. The models are packed in vendor/models (or LIME_MODELS); without them these skip.
const fs = require('fs');
const path = require('path');

module.exports = async ({ submit, jobs, dir }) => {
  const OUT = path.join(dir, 'ai');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sharp = require('sharp');
  const ai = require(path.join(__dirname, '..', 'src', 'main', 'engines', 'ai'));
  const results = [];
  const check = async (name, need, fn) => {
    name = `ai: ${name}`;
    if (only && !only.test(name)) return;
    if (!ai.available(need)) { console.log(`SKIP ${name.padEnd(34)}        the ${need} model isn’t packed (vendor/models or LIME_MODELS)`); results.push({ name, status: 'SKIP', detail: 'no model' }); return; }
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { status = 'FAIL'; detail = e.message; }
    console.log(`${status} ${name.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 300));
    results.push({ name, status, detail });
  };
  const run = async (tool, files, opts = {}) => {
    const d = path.join(OUT, `${tool}-${results.length}`);
    fs.mkdirSync(d, { recursive: true });
    const id = submit({ tool, files, opts, dest: { kind: 'dir', path: d } });
    let j;
    for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(100); }
    ok(j.status === 'done', `${tool}: ${j.status}: ${j.error}`);
    return j.results[0];
  };
  const raw = async (p, w, h) => sharp(p).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer();
  const luma = (b) => { const y = new Float64Array(b.length / 3); for (let i = 0; i < y.length; i++) y[i] = 0.299 * b[i * 3] + 0.587 * b[i * 3 + 1] + 0.114 * b[i * 3 + 2]; return y; };
  const psnr = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return 10 * Math.log10((255 * 255) / (s / a.length)); };
  // SSIM over 8×8 blocks of luma
  const ssim = (a, b, w, h) => {
    const C1 = 6.5025, C2 = 58.5225;
    let sum = 0, n = 0;
    for (let y = 0; y + 8 <= h; y += 4) for (let x = 0; x + 8 <= w; x += 4) {
      let ma = 0, mb = 0, va = 0, vb = 0, cv = 0;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y + j) * w + x + i; ma += a[k]; mb += b[k]; }
      ma /= 64; mb /= 64;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y + j) * w + x + i, p = a[k] - ma, q = b[k] - mb; va += p * p; vb += q * q; cv += p * q; }
      va /= 63; vb /= 63; cv /= 63;
      sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
    }
    return sum / n;
  };
  // Shrinks a picture, enlarges it again with the model and with Lanczos, and scores both against the original.
  const trial = async (src, factor, kind) => {
    const { data, info } = await sharp(src).removeAlpha().resize({ width: 480 }).raw().toBuffer({ resolveWithObject: true });
    const w = info.width - (info.width % 4), h = info.height - (info.height % 4);
    const orig = await sharp(data, { raw: info }).extract({ left: 0, top: 0, width: w, height: h }).raw().toBuffer();
    const small = path.join(OUT, `small-${kind}-${factor}.png`);
    await sharp(orig, { raw: { width: w, height: h, channels: 3 } }).resize(w / factor, h / factor, { kernel: 'cubic' }).png().toFile(small);
    const t = Date.now(), r = await run('upscale-ai', [small], { factor: String(factor), kind }), ms = Date.now() - t;
    const m = await sharp(r.path).metadata();
    ok(m.width === w && m.height === h, `${m.width}×${m.height}, wanted ${w}×${h}`);
    const lz = luma(await sharp(small).resize(w, h, { kernel: 'lanczos3' }).raw().toBuffer()), mine = luma(await raw(r.path, w, h)), ref = luma(orig);
    return { ai: [psnr(ref, mine), ssim(ref, mine, w, h)], lz: [psnr(ref, lz), ssim(ref, lz, w, h)], ms, w, h };
  };
  const say = (t) => `AI ${t.ai[0].toFixed(2)} dB / ${t.ai[1].toFixed(3)}, Lanczos ${t.lz[0].toFixed(2)} dB / ${t.lz[1].toFixed(3)}, ${t.ms} ms`;
  const FX = process.env.LIME_FX, photo = path.join(FX, 'photo.jpg');
  const drawing = path.join(OUT, 'drawing.png');
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#bfe6ff"/><circle cx="400" cy="70" r="40" fill="#ffd23f" stroke="#222" stroke-width="4"/><path d="M0 280 Q120 200 240 270 T480 250 V360 H0Z" fill="#7bc96f" stroke="#222" stroke-width="4"/><g stroke="#222" stroke-width="4"><ellipse cx="190" cy="200" rx="70" ry="60" fill="#ff8fab"/><circle cx="170" cy="185" r="12" fill="#fff"/><circle cx="215" cy="185" r="12" fill="#fff"/><path d="M170 220 Q192 240 214 220" fill="none"/></g><path d="M330 300 l20 -60 l20 60z" fill="#2a9d8f" stroke="#222" stroke-width="3"/></svg>`)).png().toFile(drawing);

  await check('upscale 2× photo beats Lanczos', 'upscale', async () => {
    const t = await trial(photo, 2, 'photo');
    ok(t.ai[0] > t.lz[0] && t.ai[1] > t.lz[1], say(t));
    return `${t.w}×${t.h}: ${say(t)}`;
  });
  await check('upscale 4× photo, close to Lanczos', 'upscale', async () => {
    // a 4× model draws in texture it can't know, so its PSNR trails a smooth Lanczos slightly while edges are far crisper
    const t = await trial(photo, 4, 'photo');
    ok(t.ai[0] > t.lz[0] - 1.5 && t.ai[1] > t.lz[1] - 0.03, say(t));
    return `${t.w}×${t.h}: ${say(t)}`;
  });
  await check('upscale 4× drawing beats Lanczos', 'upscale', async () => {
    const t = await trial(drawing, 4, 'drawing');
    ok(t.ai[0] > t.lz[0] + 1.5 && t.ai[1] > t.lz[1], say(t));
    return `${t.w}×${t.h}: ${say(t)}`;
  });
  await check('upscale keeps transparency, tiles', 'upscale', async () => {
    const src = path.join(OUT, 'clear.png');
    await sharp({ create: { width: 420, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="300"><circle cx="210" cy="150" r="120" fill="#2a7"/></svg>') }]).png().toFile(src);
    const r = await run('upscale-ai', [src], { factor: '2', kind: 'drawing' });
    const { data, info } = await sharp(r.path).raw().toBuffer({ resolveWithObject: true });
    ok(info.width === 840 && info.height === 600 && info.channels === 4, `${info.width}×${info.height}×${info.channels}`);
    const px = (x, y) => data.subarray((y * 840 + x) * 4, (y * 840 + x) * 4 + 4);
    ok(px(5, 5)[3] === 0 && px(420, 300)[3] === 255, `alpha ${px(5, 5)[3]} at the corner, ${px(420, 300)[3]} in the middle`);
    // the picture spans two tiles; a seam would show as a jump across x = 640 (tile edge 320 × 2)
    let jump = 0; for (let y = 260; y < 340; y++) jump = Math.max(jump, Math.abs(px(639, y)[1] - px(640, y)[1]));
    ok(jump < 12, `a seam at the tile edge: ${jump}`);
    return `${path.basename(r.path)} 840×600 with alpha, ${r.note}, largest step across a tile edge ${jump}`;
  });

  await check('erase a disc from a texture', 'lama', async () => {
    const w = 640, h = 480, R = 48, cx = 300, cy = 220, bg = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = 128 + 50 * Math.sin((x + 0.5 * y) / 9) + 25 * Math.sin(y / 23), i = (y * w + x) * 3;
      bg[i] = v; bg[i + 1] = v * 0.8 + 20; bg[i + 2] = 255 - v * 0.6;
    }
    const src = path.join(OUT, 'disc.png'), out = path.join(OUT, 'disc-erased.png');
    await sharp(bg, { raw: { width: w, height: h, channels: 3 } }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><circle cx="${cx}" cy="${cy}" r="${R}" fill="#e02020"/></svg>`) }]).png().toFile(src);
    const t = Date.now();
    await ai.erase(src, { points: [[(cx - 10) / w, cy / h], [(cx + 10) / w, cy / h]], size: (R - 6) / w }, out);
    const ms = Date.now() - t, got = await sharp(out).removeAlpha().raw().toBuffer();
    const inside = [], truth = [], ring = [0, 0, 0];
    let n = 0, outside = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy), i = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        if (d <= R) { inside.push(got[i + c]); truth.push(bg[i + c]); }
        if (d > R + 6 && d < R + 16) ring[c] += bg[i + c];
        if (d > R + 24) outside = Math.max(outside, Math.abs(got[i + c] - bg[i + c]));
      }
      if (d > R + 6 && d < R + 16) n++;
    }
    const fill = psnr(truth, inside), flat = psnr(truth, truth.map((_, i) => ring[i % 3] / n));
    ok(fill > 20 && fill > flat + 5, `filled ${fill.toFixed(2)} dB, a flat fill of the surrounding colour ${flat.toFixed(2)} dB`);
    ok(outside <= 2, `pixels away from the brush changed by up to ${outside}`);
    return `disc filled to ${fill.toFixed(2)} dB of the true background (flat fill ${flat.toFixed(2)} dB, the disc itself ${psnr(truth, inside.map((_, i) => [224, 32, 32][i % 3])).toFixed(2)} dB), rest untouched (≤ ${outside}), ${ms} ms`;
  });
  return results;
};
