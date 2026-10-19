'use strict';
const U = require('./util');
const { fs, fsp, path } = U;

let _sharp;
const sharp = () => {
  if (!_sharp) { _sharp = require('sharp'); _sharp.cache(false); _sharp.concurrency(Math.max(1, require('os').cpus().length - 1)); }
  return _sharp;
};
const SHARP_IN = new Set(['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'tif', 'tiff', 'avif', 'svg', 'heif']);

/** Returns a sharp pipeline for any image Clementine can read. */
async function open(p, opts = {}) {
  const e = U.ext(p);
  const s = sharp();
  const lim = { limitInputPixels: false, animated: !!opts.animated, failOn: 'none' };
  if (e === 'heic' || e === 'heif') {
    try {
      const decode = require('heic-decode');
      const img = await decode({ buffer: await fsp.readFile(p) });
      return s(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 }, limitInputPixels: false });
    } catch (_) { return s(await ffmpegDecode(p), lim); }
  }
  if (e === 'psd') {
    const { readPsd } = require('ag-psd');
    const psd = readPsd(await fsp.readFile(p), { useImageData: true, skipLayerImageData: true, skipThumbnail: true });
    if (!psd.imageData) throw new Error('This PSD was saved without a flattened preview. Open it in PhotoCraft and save with “Maximize compatibility”.');
    const d = psd.imageData;
    return s(Buffer.from(d.data.buffer, d.data.byteOffset, d.data.byteLength), { raw: { width: d.width, height: d.height, channels: 4 }, limitInputPixels: false });
  }
  if (SHARP_IN.has(e)) {
    try {
      const inst = s(p, lim);
      await inst.metadata();
      return e === 'svg' ? s(p, { ...lim, density: opts.density || 300 }) : inst;
    } catch (_) { /* fall back to FFmpeg */ }
  }
  if (U.GROUPS.raw.includes(e)) {
    const preview = await rawPreview(p);
    if (preview) return s(preview, lim);
    throw new Error('This camera RAW file has no embedded preview. Open it in LightCraft from Studio Apps to develop it.');
  }
  return s(await ffmpegDecode(p), lim);
}
async function ffmpegDecode(p) {
  const dir = await U.tmpDir('dec');
  const out = path.join(dir, 'frame.png');
  await U.run(U.binPath('ffmpeg'), ['-v', 'error', '-y', '-i', p, '-frames:v', '1', out], { errorMessage: `Couldn’t read ${path.basename(p)} as an image` });
  const buf = await fsp.readFile(out);
  fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  return buf;
}
/** Most RAW formats embed a full-size JPEG preview; pull out the largest one. */
async function rawPreview(p) {
  const buf = await fsp.readFile(p);
  let best = null;
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      const end = buf.indexOf(Buffer.from([0xff, 0xd9]), i + 2);
      if (end < 0) break;
      const len = end + 2 - i;
      if (len > 50000 && (!best || len > best.length)) best = buf.subarray(i, end + 2);
      i = end;
    }
  }
  return best ? Buffer.from(best) : null;
}
/** For embedding into PDFs: JPEG passes through untouched, everything else becomes PNG. */
async function toPngOrJpeg(p) {
  const e = U.ext(p);
  if (e === 'jpg' || e === 'jpeg' || e === 'jfif') {
    const data = await fsp.readFile(p);
    const meta = await sharp()(data).metadata().catch(() => ({}));
    if (meta.space !== 'cmyk' && (!meta.orientation || meta.orientation === 1)) return { data, type: 'jpg' };
    return { data: await sharp()(data).rotate().toColourspace('srgb').jpeg({ quality: 95 }).toBuffer(), type: 'jpg' };
  }
  if (e === 'png') return { data: await fsp.readFile(p), type: 'png' };
  return { data: await (await open(p)).rotate().png().toBuffer(), type: 'png' };
}

const FORMATS = {
  jpg: (s, q) => s.flatten({ background: '#ffffff' }).jpeg({ quality: q, mozjpeg: true }),
  png: (s, q, o) => s.png({ compressionLevel: 9, palette: !!o.palette, quality: o.palette ? q : 100 }),
  webp: (s, q, o) => s.webp({ quality: q, lossless: !!o.lossless, effort: 5 }),
  avif: (s, q) => s.avif({ quality: Math.max(30, q - 20), effort: 4 }),
  tiff: (s, q) => s.tiff({ compression: 'lzw' }),
  gif: (s) => s.gif({ effort: 7 }),
  heif: (s, q) => s.heif({ quality: q, compression: 'av1' }),
};
const extFor = (to) => (to === 'jpeg' ? 'jpg' : to === 'tif' ? 'tiff' : to);

async function writeAs(pipe, to, out, opts = {}) {
  const q = Number(opts.quality) || 85;
  if (FORMATS[to]) { await FORMATS[to](pipe, q, opts).toFile(out); return out; }
  if (to === 'ico') { await fsp.writeFile(out, await makeIco(await pipe.png().toBuffer())); return out; }
  // BMP, TGA, PPM, QOI, JXL and friends go through FFmpeg
  const tmp = `${out}.tmp.png`;
  await pipe.png().toFile(tmp);
  const args = ['-v', 'error', '-y', '-i', tmp];
  if (to === 'bmp') args.push('-pix_fmt', 'bgr24');
  if (to === 'jxl') args.push('-c:v', 'libjxl', '-distance', '1');
  args.push('-frames:v', '1', out);
  try { await U.run(U.binPath('ffmpeg'), args, { errorMessage: `Couldn’t write ${to.toUpperCase()}` }); } finally { fsp.rm(tmp, { force: true }).catch(() => {}); }
  return out;
}
async function makeIco(png) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const imgs = [];
  for (const s of sizes) imgs.push(await sharp()(png).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
  const head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = head.length;
  imgs.forEach((b, i) => {
    const o = 6 + i * 16, s = sizes[i];
    head.writeUInt8(s >= 256 ? 0 : s, o); head.writeUInt8(s >= 256 ? 0 : s, o + 1);
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(b.length, o + 8); head.writeUInt32LE(off, o + 12);
    off += b.length;
  });
  return Buffer.concat([head, ...imgs]);
}

/* ---------- tools ---------- */
async function convert(p, opts, ctx) {
  const to = extFor(opts.to || 'png');
  const out = ctx.out.file(p, `${U.base(p)}.${to}`);
  const animated = to === 'gif' || to === 'webp';
  const s = (await open(p, { animated: animated && ['gif', 'webp'].includes(U.ext(p)) })).rotate();
  return writeAs(s, to, out, opts);
}
async function compress(p, opts, ctx) {
  const level = opts.level || 'recommended';
  const q = { low: 88, recommended: 76, extreme: 58 }[level] || 76;
  let e = U.ext(p);
  if (!['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'tif'].includes(e)) e = 'jpg';
  const to = extFor(e === 'jpeg' ? 'jpg' : e);
  const before = (await fsp.stat(p)).size;
  let pipe = (await open(p, { animated: to === 'gif' || to === 'webp' })).rotate();
  if (opts.maxSide) pipe = pipe.resize({ width: +opts.maxSide, height: +opts.maxSide, fit: 'inside', withoutEnlargement: true });
  const out = ctx.out.file(p, `${U.base(p)}-compressed.${to}`);
  await writeAs(pipe, to, out, { quality: q, palette: to === 'png' && level !== 'low' });
  const after = (await fsp.stat(out)).size;
  if (after >= before) {
    await fsp.copyFile(p, out);
    return { path: out, note: 'Already well compressed. Saved an unchanged copy.' };
  }
  return { path: out, note: `${U.fmtBytes(before)} → ${U.fmtBytes(after)} (${Math.round((1 - after / before) * 100)}% smaller)` };
}
async function resize(p, opts, ctx) {
  const s = (await open(p)).rotate();
  const meta = await s.metadata();
  const W = meta.autoOrient?.width || meta.width, H = meta.autoOrient?.height || meta.height;
  let w, h;
  if (opts.mode === 'percent') { const k = (Number(opts.percent) || 50) / 100; w = Math.round(W * k); h = Math.round(H * k); }
  else { w = Number(opts.width) || null; h = Number(opts.height) || null; if (!w && !h) throw new Error('Enter a width or a height.'); }
  const fit = opts.keepRatio === false ? 'fill' : (opts.fit || 'inside');
  const to = keepExt(p);
  const out = ctx.out.file(p, `${U.base(p)}-${w || 'auto'}x${h || 'auto'}.${to}`);
  return writeAs(s.resize({ width: w || undefined, height: h || undefined, fit, withoutEnlargement: !!opts.noEnlarge, background: { r: 255, g: 255, b: 255, alpha: 0 } }), to, out, { quality: 92 });
}
const keepExt = (p) => { const e = U.ext(p); return ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'tif'].includes(e) ? extFor(e === 'jpeg' ? 'jpg' : e) : 'png'; };
async function crop(p, opts, ctx) {
  const s = (await open(p)).rotate();
  const buf = await s.png().toBuffer();
  const meta = await sharp()(buf).metadata();
  const to = keepExt(p);
  const out = ctx.out.file(p, `${U.base(p)}-cropped.${to}`);
  if (opts.aspect && opts.aspect !== 'custom') {
    const [a, b] = opts.aspect.split(':').map(Number);
    let w = meta.width, h = Math.round((meta.width * b) / a);
    if (h > meta.height) { h = meta.height; w = Math.round((meta.height * a) / b); }
    const position = opts.smart !== false ? sharp().strategy.attention : 'centre';
    return writeAs(sharp()(buf).resize(w, h, { fit: 'cover', position }), to, out, { quality: 92 });
  }
  const left = Math.max(0, Math.round(Number(opts.left) || 0)), top = Math.max(0, Math.round(Number(opts.top) || 0));
  const width = Math.min(meta.width - left, Math.round(Number(opts.width) || meta.width - left));
  const height = Math.min(meta.height - top, Math.round(Number(opts.height) || meta.height - top));
  if (width < 1 || height < 1) throw new Error('That crop area is outside the image.');
  return writeAs(sharp()(buf).extract({ left, top, width, height }), to, out, { quality: 92 });
}
async function rotate(p, opts, ctx) {
  let s = (await open(p)).rotate();
  const a = Number(opts.angle || 90);
  if (a) s = s.rotate(a, { background: '#ffffff00' });
  if (opts.flip === 'horizontal') s = s.flop();
  if (opts.flip === 'vertical') s = s.flip();
  const to = keepExt(p);
  return writeAs(s, to, ctx.out.file(p, `${U.base(p)}-rotated.${to}`), { quality: 92 });
}
async function adjust(p, opts, ctx) {
  let s = (await open(p)).rotate();
  const b = (Number(opts.brightness) || 0) / 100, sat = (Number(opts.saturation) || 0) / 100, hue = Number(opts.hue) || 0;
  if (b || sat || hue) s = s.modulate({ brightness: 1 + b, saturation: 1 + sat, hue });
  const c = (Number(opts.contrast) || 0) / 100;
  if (c) s = s.linear(1 + c, -128 * c);
  if (opts.filter === 'grayscale') s = s.grayscale();
  if (opts.filter === 'sepia') s = s.recomb([[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]]);
  if (opts.filter === 'invert') s = s.negate({ alpha: false });
  if (opts.filter === 'vintage') s = s.modulate({ saturation: 0.7 }).tint({ r: 255, g: 230, b: 200 });
  if (Number(opts.sharpen)) s = s.sharpen({ sigma: 0.5 + Number(opts.sharpen) / 40 });
  if (Number(opts.blur)) s = s.blur(0.3 + Number(opts.blur) / 10);
  const to = keepExt(p);
  return writeAs(s, to, ctx.out.file(p, `${U.base(p)}-edited.${to}`), { quality: 92 });
}
const escXml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
async function watermark(p, opts, ctx) {
  const base = (await open(p)).rotate();
  const buf = await base.png().toBuffer();
  const { width: W, height: H } = await sharp()(buf).metadata();
  const opacity = U.clamp((Number(opts.opacity ?? 40)) / 100, 0.05, 1);
  let mark;
  if (opts.kind === 'image' && opts.image) {
    const target = Math.round(Math.min(W, H) * (Number(opts.scale) || 25) / 100);
    const m = await (await open(opts.image)).resize(target, target, { fit: 'inside' }).ensureAlpha().png().toBuffer();
    const raw = await sharp()(m).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 3; i < raw.data.length; i += 4) raw.data[i] = Math.round(raw.data[i] * opacity);
    mark = await sharp()(raw.data, { raw: raw.info }).png().toBuffer();
  } else {
    const size = Math.round(Math.min(W, H) * (Number(opts.size) || 6) / 100);
    const text = escXml(opts.text || '© Clementine');
    const tw = Math.ceil(text.length * size * 0.62) + size;
    mark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${Math.ceil(size * 1.6)}"><text x="50%" y="70%" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${size}" fill="${opts.color || '#ffffff'}" fill-opacity="${opacity}" stroke="#000" stroke-opacity="${opacity * 0.35}" stroke-width="${Math.max(1, size / 30)}">${text}</text></svg>`);
    if (Number(opts.rotation)) mark = await sharp()(mark).rotate(-Number(opts.rotation), { background: '#0000' }).png().toBuffer();
  }
  const pos = opts.position || 'bottom-right';
  const gravity = { 'top-left': 'northwest', top: 'north', 'top-right': 'northeast', left: 'west', center: 'centre', right: 'east', 'bottom-left': 'southwest', bottom: 'south', 'bottom-right': 'southeast' }[pos] || 'southeast';
  const comp = opts.layout === 'tiled' ? [{ input: mark, tile: true, gravity: 'northwest' }] : [{ input: mark, gravity }];
  const to = keepExt(p);
  return writeAs(sharp()(buf).composite(comp), to, ctx.out.file(p, `${U.base(p)}-watermarked.${to}`), { quality: 92 });
}
async function meme(p, opts, ctx) {
  const buf = await (await open(p)).rotate().png().toBuffer();
  const { width: W, height: H } = await sharp()(buf).metadata();
  const size = Math.round(W / 11);
  const line = (t, y) => (t ? `<text x="50%" y="${y}" text-anchor="middle" font-family="Impact, Haettenschweiler, 'Arial Black', sans-serif" font-size="${size}" fill="#fff" stroke="#000" stroke-width="${Math.max(2, size / 14)}" paint-order="stroke">${escXml(String(t).toUpperCase())}</text>` : '');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${line(opts.top, size * 1.1)}${line(opts.bottom, H - size * 0.35)}</svg>`);
  return writeAs(sharp()(buf).composite([{ input: svg }]), 'jpg', ctx.out.file(p, `${U.base(p)}-meme.jpg`), { quality: 90 });
}
async function strip(p, opts, ctx) {
  const to = keepExt(p);
  const out = ctx.out.file(p, `${U.base(p)}-clean.${to}`);
  await writeAs((await open(p)).rotate(), to, out, { quality: 95 });
  return { path: out, note: 'Removed EXIF, GPS location and camera data' };
}
async function removeBackground(p, opts, ctx) {
  const { removeBackground: rb } = require('@imgly/background-removal-node');
  ctx.progress(0.1, 'Loading the cut-out model');
  const png = await (await open(p)).rotate().png().toBuffer();
  const blob = await rb(new Blob([png], { type: 'image/png' }), {
    model: opts.quality === 'fast' ? 'small' : 'medium',
    output: { format: 'image/png', quality: 1 },
    progress: (key, cur, total) => { if (total) ctx.progress(0.1 + 0.8 * (cur / total), 'Cutting out the subject'); },
  });
  let out = Buffer.from(await blob.arrayBuffer());
  if (opts.background && opts.background !== 'transparent') out = await sharp()(out).flatten({ background: opts.background }).png().toBuffer();
  const dest = ctx.out.file(p, `${U.base(p)}-cutout.png`);
  await fsp.writeFile(dest, out);
  return dest;
}
async function upscale(p, opts, ctx) {
  const factor = Number(opts.factor) || 2;
  const ai = require('./engines-optional').realesrganPath();
  const to = keepExt(p) === 'gif' ? 'png' : keepExt(p);
  const out = ctx.out.file(p, `${U.base(p)}-${factor}x.${to}`);
  if (opts.method !== 'classic' && ai) {
    const dir = await U.tmpDir('up');
    const src = path.join(dir, 'in.png');
    await (await open(p)).rotate().png().toFile(src);
    const dst = path.join(dir, 'out.png');
    const model = opts.content === 'anime' ? 'realesrgan-x4plus-anime' : 'realesrgan-x4plus';
    ctx.progress(0.1, 'Upscaling with Real-ESRGAN');
    await U.run(ai, ['-i', src, '-o', dst, '-n', model, '-s', '4', '-f', 'png'], { cwd: path.dirname(ai), signal: ctx.signal, errorMessage: 'The AI upscaler failed (it needs a GPU with Vulkan support)' });
    const meta = await sharp()(src).metadata();
    await writeAs(sharp()(dst).resize(meta.width * factor, meta.height * factor, { kernel: 'lanczos3' }), to, out, { quality: 94 });
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    return { path: out, note: 'Upscaled with Real-ESRGAN' };
  }
  const s = (await open(p)).rotate();
  const meta = await s.metadata();
  await writeAs(s.resize(Math.round(meta.width * factor), Math.round(meta.height * factor), { kernel: 'lanczos3' }).sharpen({ sigma: 0.8 }), to, out, { quality: 94 });
  return { path: out, note: ai ? undefined : 'Upscaled with Lanczos. Install the AI upscaler in Settings › Engines for sharper detail.' };
}
async function info(p) {
  const s = await open(p);
  const m = await s.metadata();
  return { width: m.width, height: m.height, format: m.format, space: m.space, channels: m.channels, density: m.density, hasAlpha: m.hasAlpha, pages: m.pages, exif: !!m.exif, icc: !!m.icc };
}
async function thumbnail(p, size = 240) {
  return (await open(p)).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}
async function collage(inputs, opts, out) {
  const cols = Math.max(1, Number(opts.columns) || Math.ceil(Math.sqrt(inputs.length)));
  const cell = Number(opts.cell) || 600;
  const gap = Number(opts.gap ?? 12);
  const rows = Math.ceil(inputs.length / cols);
  const tiles = [];
  for (let i = 0; i < inputs.length; i++) {
    const b = await (await open(inputs[i])).rotate().resize(cell, cell, { fit: 'cover', position: sharp().strategy.attention }).png().toBuffer();
    tiles.push({ input: b, left: gap + (i % cols) * (cell + gap), top: gap + Math.floor(i / cols) * (cell + gap) });
  }
  const W = cols * (cell + gap) + gap, H = rows * (cell + gap) + gap;
  await sharp()({ create: { width: W, height: H, channels: 3, background: opts.background || '#ffffff' } }).composite(tiles).jpeg({ quality: 92 }).toFile(out);
  return out;
}

module.exports = { open, toPngOrJpeg, writeAs, makeIco, convert, compress, resize, crop, rotate, adjust, watermark, meme, strip, removeBackground, upscale, info, thumbnail, collage, sharp };
