'use strict';
const U = require('./util');
const { fs, fsp, path } = U;

let _sharp;
const sharp = () => {
  if (!_sharp) { _sharp = require('sharp'); _sharp.cache(false); _sharp.concurrency(Math.max(1, require('os').cpus().length - 1)); }
  return _sharp;
};
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
const SHARP_IN = new Set(['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'tif', 'tiff', 'avif']);
const apng = () => require('./apng');
const icons = () => require('./icons');
const heic = () => require('./heic');

// opts.side: the long edge an SVG should render at (icons, thumbnails); otherwise its intrinsic size.
async function open(p, opts = {}) {
  const e = U.ext(p);
  const s = sharp();
  const lim = { limitInputPixels: false, animated: !!opts.animated, failOn: 'none' };
  if (e === 'heic' || e === 'heif' || e === 'hif') return openHeif(p, lim);
  if (e === 'psd') {
    const { readPsd, initializeCanvas } = require('ag-psd');
    // ag-psd makes its pixel buffers through a canvas, which Node doesn't have; plain buffers are all it needs here.
    initializeCanvas(() => { throw new Error('This PSD needs PhotoCraft to open.'); }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
    const psd = readPsd(await fsp.readFile(p), { useImageData: true, skipLayerImageData: true, skipThumbnail: true });
    if (!psd.imageData) throw new Error('This PSD was saved without a flattened preview. Open it in PhotoCraft and save with “Maximize compatibility”.');
    const d = psd.imageData;
    return s(Buffer.from(d.data.buffer, d.data.byteOffset, d.data.byteLength), { raw: { width: d.width, height: d.height, channels: 4 }, limitInputPixels: false });
  }
  if (e === 'svg') return openSvg(p, opts);
  if ((e === 'png' || e === 'apng') && !opts.animated && await apng().isAnimated(p)) {
    const a = await apng().read(await fsp.readFile(p), 1);
    return s(a.frames[0].data, { raw: { width: a.width, height: a.height, channels: 4 }, limitInputPixels: false });
  }
  if (SHARP_IN.has(e) || e === 'apng') {
    try {
      const inst = s(p, lim);
      await inst.metadata();
      return inst;
    } catch (_) {}
  }
  if (e === 'ico' || e === 'cur') return s(await icons().readIco(await fsp.readFile(p)).catch(() => ffmpegDecode(p, ['-f', 'ico'])), lim);
  if (e === 'icns') return s(await icons().readIcns(await fsp.readFile(p), (b) => decodeBuffer(b, 'jp2')), lim);
  if (e === 'hdr' || e === 'exr') { const t = await hdrDecode(p); return s(t.data, { raw: t.info, limitInputPixels: false }); }
  if (U.GROUPS.raw.includes(e)) {
    const preview = await rawPreview(p);
    if (preview) return s(preview, lim);
    throw new Error('This camera RAW file has no embedded preview. Open it in LightCraft from Studio Apps to develop it.');
  }
  if (e === 'jxl') return s(await jxlDecode(p), lim);
  return s(await ffmpegDecode(p), lim);
}
// heic-decode gives bare RGBA, so the ICC profile and Exif (read by libheif without decoding) go back in as PNG chunks.
async function openHeif(p, lim) {
  const buf = await fsp.readFile(p);
  let img;
  try { img = await require('heic-decode')({ buffer: buf }); } catch (_) {
    try { const inst = sharp()(buf, lim); await inst.stats(); return inst; } catch (__) { return sharp()(await ffmpegDecode(p), lim); }
  }
  const raw = sharp()(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 }, limitInputPixels: false });
  const m = await sharp()(buf).metadata().catch(() => ({}));
  if (!m.icc && !m.exif) return raw;
  const png = await raw.png({ compressionLevel: 1 }).toBuffer();
  const extra = [];
  if (m.icc) extra.push(apng().chunk('iCCP', Buffer.concat([Buffer.from('ICC Profile\0\0', 'latin1'), require('zlib').deflateSync(m.icc)])));
  if (m.exif) { const x = heic().patchExif(m.exif); extra.push(apng().chunk('eXIf', x.toString('latin1', 0, 6) === 'Exif\0\0' ? x.subarray(6) : x)); }
  return sharp()(Buffer.concat([png.subarray(0, 33), ...extra, png.subarray(33)]), lim);
}
async function openSvg(p, opts) {
  const m = await sharp()(p, { limitInputPixels: false }).metadata();
  const w = m.width || 300, h = m.height || 150, long = Math.max(w, h);
  const k = Math.min(opts.side ? opts.side / long : 1, 16384 / long, Math.sqrt(1e8 / (w * h)));
  return sharp()(p, { limitInputPixels: false, failOn: 'none', density: U.clamp(opts.density || 72 * k, 1, 100000) });
}
async function jxlDecode(p) {
  const dir = await U.tmpDir('dec');
  const out = await require('./crafts').render(p, path.join(dir, 'frame.png'));
  const buf = await fsp.readFile(out);
  fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  return buf;
}
async function ffmpegDecode(p, pre = []) {
  const dir = await U.tmpDir('dec');
  const out = path.join(dir, 'frame.png');
  await U.run(U.binPath('ffmpeg'), ['-v', 'error', '-y', ...pre, '-i', p, '-frames:v', '1', out], { errorMessage: `Couldn’t read ${path.basename(p)} as an image` });
  const buf = await fsp.readFile(out);
  fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  return buf;
}
async function decodeBuffer(buf, e) {
  const dir = await U.tmpDir('dec');
  try { const f = path.join(dir, `in.${e}`); await fsp.writeFile(f, buf); return await ffmpegDecode(f); } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// Radiance HDR and OpenEXR are linear light: tone-map them to sRGB (Filee's HdrToneMap) instead of clipping.
async function hdrDecode(p) {
  const dir = await U.tmpDir('hdr');
  try {
    const f = path.join(dir, 'px.raw');
    const r = await U.run(U.binPath('ffmpeg'), ['-hide_banner', '-nostdin', '-y', '-i', p, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gbrapf32le', f], { errorMessage: `Couldn’t read ${path.basename(p)} as an image` });
    const [w, h] = (/Video: [^\n]*?(\d+)x(\d+)/.exec(r.stderr) || []).slice(1).map(Number);
    let buf = await fsp.readFile(f);
    if (!w || buf.length < w * h * 16) throw new Error(`Couldn’t read ${path.basename(p)} as an image`);
    if (buf.byteOffset % 4) buf = Buffer.from(buf);
    return { data: toneMap(new Float32Array(buf.buffer, buf.byteOffset, w * h * 4), w * h), info: { width: w, height: h, channels: 4 } };
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
function toneMap(f, px) {
  const pos = (v) => (v > 0 ? Math.min(v, 65504) : 0), G = 0, B = px, R = 2 * px, A = 3 * px;
  const step = Math.ceil(px / 65536), lum = [];
  let peak = 0;
  for (let i = 0; i < px; i++) {
    const r = pos(f[R + i]), g = pos(f[G + i]), b = pos(f[B + i]);
    peak = Math.max(peak, r, g, b);
    if (i % step === 0) lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  lum.sort((a, b) => a - b);
  const white = U.clamp(lum[Math.round(0.99 * (lum.length - 1))] || 1, 1, 4), range = Math.max(1, (peak / white - 0.8) / 0.2);
  const lut = new Uint8Array(65536);
  for (let i = 0; i < 65536; i++) { const v = i / 65535; lut[i] = Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); }
  const enc = (v) => lut[Math.round(U.clamp(v, 0, 1) * 65535)], out = Buffer.alloc(px * 4);
  for (let i = 0; i < px; i++) {
    const r = pos(f[R + i]) / white, g = pos(f[G + i]) / white, b = pos(f[B + i]) / white, m = Math.max(r, g, b);
    let k = 1;
    if (m > 0.8) { const x = (m - 0.8) / 0.2; k = Math.min(1, 0.8 + (0.2 * x * (1 + x / (range * range))) / (1 + x)) / m; }
    out[i * 4] = enc(r * k); out[i * 4 + 1] = enc(g * k); out[i * 4 + 2] = enc(b * k);
    out[i * 4 + 3] = Number.isNaN(f[A + i]) ? 255 : Math.round(U.clamp(f[A + i], 0, 1) * 255);
  }
  return out;
}

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
  jpg: (s, q) => s.jpeg({ quality: q, mozjpeg: true }),
  png: (s, q, o) => s.png({ compressionLevel: 9, palette: !!o.palette, quality: o.palette ? q : 100 }),
  webp: (s, q, o) => s.webp({ quality: q, lossless: !!o.lossless, effort: 5 }),
  avif: (s, q) => s.avif({ quality: Math.max(30, q - 20), effort: 4 }),
  tiff: (s) => s.tiff({ compression: 'lzw' }),
  gif: (s) => s.gif({ effort: 7 }),
};
const rgba = (s) => s.ensureAlpha().toColourspace('srgb').raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
// JS writers for what neither sharp nor FFmpeg can write.
const WRITERS = {
  heic: async (s, q, o) => {
    const m = await s.metadata(), icc = m.icc && ['srgb', 'rgb', 'rgb16'].includes(m.space) ? m.icc : null;
    const { data, info } = await (icc ? s.keepIccProfile() : s).toColourspace('srgb').removeAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
    return heic().encode(data, info.width, info.height, { quality: q, icc, exif: m.exif && !o.strip ? heic().patchExif(m.exif) : null });
  },
  apng: async (s) => { const { data, info } = await rgba(s); return apng().write({ width: info.width, height: info.height, frames: [{ data, delay: 0 }] }); },
  ico: async (s) => icons().writeIco(await s.png().toBuffer()),
  cur: async (s, q, o) => icons().writeCur(await s.png().toBuffer(), o.hotspot),
  icns: async (s) => icons().writeIcns(await s.png().toBuffer()),
  dds: async (s) => {
    const { data, info } = await rgba(s), h = Buffer.alloc(128);
    h.write('DDS ', 0, 'latin1');
    [[4, 124], [8, 0x100f], [12, info.height], [16, info.width], [20, info.width * 4], [76, 32], [80, 0x41], [88, 32], [92, 0xff0000], [96, 0xff00], [100, 0xff], [104, 0xff000000], [108, 0x1000]].forEach(([o, v]) => h.writeUInt32LE(v >>> 0, o));
    for (let i = 0; i < data.length; i += 4) { const r = data[i]; data[i] = data[i + 2]; data[i + 2] = r; }
    return Buffer.concat([h, data]);
  },
  xpm: async (s, q, o) => {
    const { data, info } = await rgba(sharp()(await s.png({ palette: true, colours: 256, dither: 0 }).toBuffer()));
    const ids = new Map(), px = [];
    for (let i = 0; i < data.length; i += 4) {
      const c = data[i + 3] < 128 ? 'None' : `#${data.readUIntBE(i, 3).toString(16).padStart(6, '0').toUpperCase()}`;
      if (!ids.has(c)) ids.set(c, ids.size);
      px.push(ids.get(c));
    }
    const CH = '!#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~', cpp = ids.size <= 92 ? 1 : 2;
    const code = (n) => (cpp === 1 ? CH[n] : CH[n % 92] + CH[Math.floor(n / 92)]);
    const rows = [];
    for (let y = 0; y < info.height; y++) rows.push(`"${px.slice(y * info.width, (y + 1) * info.width).map(code).join('')}"`);
    const name = String(o.name || 'image').replace(/\W/g, '_').replace(/^(\d)/, '_$1');
    return Buffer.from(`/* XPM */\nstatic char *${name}[] = {\n"${info.width} ${info.height} ${ids.size} ${cpp}",\n${[...ids].map(([c, n]) => `"${code(n)} c ${c}",`).join('\n')}\n${rows.join(',\n')}\n};\n`);
  },
};
// FFmpeg encoders; the extension picks the encoder.
const FF_ARGS = { bmp: ['-pix_fmt', 'bgr24'], ras: ['-rle', '0'], jp2: ['-c:v', 'libopenjpeg'] };
const FF_OUT = new Set(['bmp', 'tga', 'qoi', 'pcx', 'ppm', 'pgm', 'pbm', 'pam', 'pfm', 'sgi', 'ras', 'xbm', 'wbmp', 'jp2']);
const NO_ALPHA = new Set(['jpg', 'bmp', 'heic', 'pcx', 'ppm', 'pgm', 'pbm', 'pfm', 'ras', 'xbm', 'wbmp']);
const BILEVEL = new Set(['pbm', 'xbm', 'wbmp']);
const KEEP_ICC = new Set(['jpg', 'png', 'webp', 'avif', 'tiff']);
const KEEP_EXIF = new Set(['jpg', 'png', 'webp', 'avif']);
const MAX_SIDE = { jpg: 65500, webp: 16383, avif: 16384, gif: 65535 };
const ALIAS = { jpeg: 'jpg', jfif: 'jpg', tif: 'tiff', heif: 'heic', hif: 'heic', targa: 'tga', sun: 'ras', jpeg2000: 'jp2' };
const extFor = (to) => ALIAS[to] || to;

// Orientation is applied to the pixels by the caller's rotate(); the ICC profile stays, Exif stays unless opts.strip.
async function writeAs(pipe, to, out, opts = {}) {
  to = extFor(to);
  const q = Number(opts.quality) || 85;
  if (NO_ALPHA.has(to)) pipe = pipe.flatten({ background: opts.background || '#ffffff' });
  if (BILEVEL.has(to)) pipe = pipe.threshold(128);
  if (KEEP_ICC.has(to)) pipe = pipe.keepIccProfile();
  if (KEEP_EXIF.has(to) && !opts.strip) pipe = pipe.keepExif();
  try {
    if (FORMATS[to]) await FORMATS[to](pipe, q, opts).toFile(out);
    else if (WRITERS[to]) await fsp.writeFile(out, await WRITERS[to](pipe, q, { name: U.base(out), ...opts }));
    else await viaPng(pipe, to, out, q);
    return out;
  } catch (e) {
    if (!MAX_SIDE[to] || opts.shrunk || !/too large for the \w+ format|Maximum supported image dimension/.test(e.message)) throw e;
    const big = `${out}.big.png`;
    try {
      await pipe.png({ compressionLevel: 1 }).toFile(big);
      const m = await sharp()(big, { limitInputPixels: false }).metadata(), k = MAX_SIDE[to] / Math.max(m.width, m.height);
      const w = Math.max(1, Math.floor(m.width * k)), h = Math.max(1, Math.floor(m.height * k));
      await writeAs(sharp()(big, { limitInputPixels: false }).resize(w, h, { fit: 'fill' }), to, out, { ...opts, shrunk: true });
      return { path: out, note: `Reduced to ${w} × ${h} px, the largest a ${to.toUpperCase()} can be` };
    } finally { fsp.rm(big, { force: true }).catch(() => {}); }
  }
}
async function viaPng(pipe, to, out, q) {
  const tmp = `${out}.tmp.png`;
  await pipe.png().toFile(tmp);
  try {
    if (to === 'jxl') await require('./crafts').render(tmp, out, { quality: q });
    else if (FF_OUT.has(to)) await U.run(U.binPath('ffmpeg'), ['-v', 'error', '-y', '-i', tmp, ...(FF_ARGS[to] || []), '-frames:v', '1', '-update', '1', out], { errorMessage: `Couldn’t write ${to.toUpperCase()}` });
    else throw new Error(`Lime can’t write ${to.toUpperCase()} images.`);
  } finally { fsp.rm(tmp, { force: true }).catch(() => {}); }
}
const makeIco = (png) => icons().writeIco(png);

// Animations: GIF and WebP through libvips, animated PNG through apng.js; frames are full RGBA canvases.
const MOVING = new Set(['gif', 'webp', 'apng', 'tiff']);
async function isAnimated(p) {
  const e = U.ext(p);
  if (e === 'gif' || e === 'webp') return ((await sharp()(p).metadata().catch(() => ({}))).pages || 1) > 1;
  return (e === 'png' || e === 'apng') && apng().isAnimated(p);
}
async function readAnimation(p) {
  if (U.ext(p) !== 'gif' && U.ext(p) !== 'webp') return apng().read(await fsp.readFile(p));
  const s = sharp()(p, { animated: true, limitInputPixels: false, failOn: 'none' }), m = await s.metadata();
  const { data, info } = await rgba(s), h = m.pageHeight || info.height, size = info.width * h * 4;
  const frames = Array.from({ length: info.height / h }, (_, i) => ({ data: data.subarray(i * size, (i + 1) * size), delay: m.delay?.[i] ?? 100 }));
  return { width: info.width, height: h, loop: m.loop ?? 0, frames };
}
async function writeAnimation(a, to, out, opts = {}) {
  if (to === 'apng') { await fsp.writeFile(out, await apng().write(a)); return out; }
  const s = sharp()(Buffer.concat(a.frames.map((f) => f.data)), { raw: { width: a.width, height: a.height * a.frames.length, channels: 4, pageHeight: a.height }, limitInputPixels: false });
  const delay = a.frames.map((f) => Math.round(f.delay)), loop = a.loop || 0;
  if (to === 'gif') await s.gif({ delay, loop, effort: 7 }).toFile(out);
  else if (to === 'webp') await s.webp({ delay, loop, quality: Number(opts.quality) || 85, lossless: !!opts.lossless, effort: 5 }).toFile(out);
  else await s.tiff({ compression: 'lzw' }).toFile(out);
  return out;
}

const pageCount = async (p) => (['tif', 'tiff'].includes(U.ext(p)) ? (await sharp()(p).metadata().catch(() => ({}))).pages || 1 : 1);
const ICON_SIDE = { ico: 256, cur: 256, icns: 1024 };

async function convert(p, opts, ctx) {
  const to = extFor(opts.to || 'png');
  const e = U.ext(p), out = () => ctx.out.file(p, `${U.base(p)}.${to}`);
  if (MOVING.has(to) && await isAnimated(p)) {
    if (to !== 'apng' && (e === 'gif' || e === 'webp')) return writeAs(await open(p, { animated: true }), to, out(), opts);
    return writeAnimation(await readAnimation(p), to, out(), opts);
  }
  const n = await pageCount(p);
  if (n < 2) return writeAs((await open(p, { side: ICON_SIDE[to] })).rotate(), to, out(), opts);
  if (to === 'tiff') { const o = out(); try { return await writeAs(sharp()(p, { pages: -1, limitInputPixels: false }), to, o, opts); } catch (_) { await fsp.rm(o, { force: true }); } }
  const dir = ctx.out.folder(p, `${U.base(p)} - pages`);
  for (let i = 0; i < n; i++) {
    ctx.progress?.(i / n, `Page ${i + 1} of ${n}`);
    await writeAs(sharp()(p, { page: i, limitInputPixels: false, failOn: 'none' }).rotate(), to, path.join(dir, `${U.base(p)} - page ${i + 1}.${to}`), opts);
  }
  return dir;
}
// Every page of a multi-page TIFF becomes a PDF page.
async function toPdf(inputs, opts, out, ctx) {
  const dir = await U.tmpDir('pages'), list = [];
  try {
    for (const f of inputs) {
      const n = await pageCount(f);
      if (n < 2) { list.push(f); continue; }
      for (let i = 0; i < n; i++) { const pg = path.join(dir, `${list.length}.png`); await sharp()(f, { page: i, limitInputPixels: false, failOn: 'none' }).rotate().png().toFile(pg); list.push(pg); }
    }
    return await require('./pdf').imagesToPdf(list, opts, out, ctx);
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
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
  await writeAs(pipe, to, out, { quality: q, palette: to === 'png' && level !== 'low', strip: true });
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
    const m = await (await open(opts.image, { side: target })).resize(target, target, { fit: 'inside' }).ensureAlpha().png().toBuffer();
    const raw = await sharp()(m).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 3; i < raw.data.length; i += 4) raw.data[i] = Math.round(raw.data[i] * opacity);
    mark = await sharp()(raw.data, { raw: raw.info }).png().toBuffer();
  } else {
    const size = Math.round(Math.min(W, H) * (Number(opts.size) || 6) / 100);
    const text = escXml(opts.text || '© Lime');
    const tw = Math.ceil(text.length * size * 0.62) + size;
    mark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${Math.ceil(size * 1.6)}"><text x="50%" y="70%" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="${size}" fill="${opts.color || '#ffffff'}" fill-opacity="${opacity}" stroke="#000" stroke-opacity="${opacity * 0.35}" stroke-width="${Math.max(1, size / 30)}">${text}</text></svg>`);
    if (Number(opts.rotation)) mark = await sharp()(mark).rotate(-Number(opts.rotation), { background: '#0000' }).png().toBuffer();
  }
  const pos = opts.position || 'bottom-right';
  const gravity = { 'top-left': 'northwest', top: 'north', 'top-right': 'northeast', left: 'west', center: 'centre', right: 'east', 'bottom-left': 'southwest', bottom: 'south', 'bottom-right': 'southeast' }[pos] || 'southeast';
  const comp = opts.layout === 'tiled' ? [{ input: mark, tile: true, gravity: 'northwest' }] : [{ input: mark, gravity }];
  const to = keepExt(p);
  return writeAs(sharp()(buf).composite(comp), to, ctx.out.file(p, `${U.base(p)}-watermarked.${to}`), { quality: 92 });
}
// A white bold caption with a black outline, as large as fits in w × h.
async function caption(t, w, h) {
  const text = await sharp()({ text: { text: `<span foreground="white">${escXml(String(t).toUpperCase())}</span>`, font: 'Noto Sans Bold', fontfile: path.join(U.cfg.data, 'fonts', 'NotoSans-Bold.ttf'), rgba: true, width: w, height: h, align: 'centre', wrap: 'word' } }).png().toBuffer();
  const m = await sharp()(text).metadata(), r = Math.max(2, Math.round(m.height / 10));
  const padded = await sharp()(text).extend({ top: r, bottom: r, left: r, right: r, background: CLEAR }).png().toBuffer();
  const edge = await sharp()(await sharp()(padded).extractChannel(3).png().toBuffer()).blur(r / 2).linear(6, 0).png().toBuffer();
  const outline = await sharp()({ create: { width: m.width + 2 * r, height: m.height + 2 * r, channels: 3, background: '#000000' } }).joinChannel(edge).png().toBuffer();
  const out = await sharp()(outline).composite([{ input: padded }]).png().toBuffer();
  return sharp()(out).resize(w, h, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
}
async function meme(p, opts, ctx) {
  const anim = U.ext(p) !== 'png' && await isAnimated(p);
  const s = anim ? await open(p, { animated: true }) : sharp()(await (await open(p)).rotate().png().toBuffer());
  const m = await s.metadata(), W = m.width, H = anim ? m.pageHeight : m.height, n = anim ? m.pages : 1, pad = Math.round(H * 0.03);
  const layers = [];
  for (const [t, top] of [[opts.top, true], [opts.bottom, false]]) {
    if (!String(t || '').trim()) continue;
    const { data, info } = await caption(t, Math.round(W * 0.94), Math.round(H * 0.22));
    for (let i = 0; i < n; i++) layers.push({ input: data, left: (W - info.width) >> 1, top: i * H + (top ? pad : H - info.height - pad) });
  }
  if (!layers.length) throw new Error('Type a top or bottom caption.');
  const to = anim ? U.ext(p) : keepExt(p);
  return writeAs(s.composite(layers), to, ctx.out.file(p, `${U.base(p)}-meme.${to}`), { quality: 90 });
}
async function strip(p, opts, ctx) {
  const to = keepExt(p);
  const out = ctx.out.file(p, `${U.base(p)}-clean.${to}`);
  await writeAs((await open(p)).rotate(), to, out, { quality: 95, strip: true });
  return { path: out, note: 'Removed EXIF, GPS location and camera data' };
}
async function removeBackground(p, opts, ctx) {
  ctx.progress(0.1, 'Loading the cut-out model');
  const dir = await U.tmpDir('cutout'), src = path.join(dir, 'in.png'), made = path.join(dir, 'out.png');
  try {
    await (await open(p)).rotate().png().toFile(src);
    await new Promise((resolve, reject) => {
      const child = require('child_process').fork(path.join(__dirname, 'cutout.js'), [], { execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      let err = '', said = null;
      const stop = () => child.kill();
      ctx.signal?.addEventListener('abort', stop);
      child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
      child.on('message', (m) => { if (m.progress != null) ctx.progress(0.1 + 0.8 * m.progress, 'Cutting out the subject'); if (m.error) said = m.error; });
      child.on('exit', (code, signal) => {
        ctx.signal?.removeEventListener('abort', stop);
        if (code === 0) resolve();
        else reject(new Error(said || `The cut-out engine stopped${signal ? ` (${signal})` : ''}${err.trim() ? `: ${err.trim().split('\n').slice(-3).join(' ')}` : ''}`));
      });
      child.send({ input: src, out: made, model: opts.quality === 'fast' ? 'small' : 'medium' });
    });
    let out = await fsp.readFile(made);
    if (opts.background && opts.background !== 'transparent') out = await sharp()(out).flatten({ background: opts.background }).png().toBuffer();
    const dest = ctx.out.file(p, `${U.base(p)}-cutout.png`);
    await fsp.writeFile(dest, out);
    return dest;
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function upscale(p, opts, ctx) {
  const factor = Number(opts.factor) || 2;
  const to = keepExt(p) === 'gif' ? 'png' : keepExt(p);
  const out = ctx.out.file(p, `${U.base(p)}-${factor}x.${to}`);
  const s = (await open(p)).rotate();
  const meta = await s.metadata();
  const W = meta.autoOrient?.width || meta.width, H = meta.autoOrient?.height || meta.height;
  ctx.progress?.(0.3, `Upscaling ${factor}×`);
  await writeAs(s.resize(Math.round(W * factor), Math.round(H * factor), { kernel: 'lanczos3' }).sharpen({ sigma: 0.7, m1: 0.6, m2: 2 }), to, out, { quality: 94 });
  return { path: out, note: `${W}×${H} → ${Math.round(W * factor)}×${Math.round(H * factor)}` };
}
async function info(p) {
  const s = await open(p);
  const m = await s.metadata();
  return { width: m.width, height: m.height, format: m.format, space: m.space, channels: m.channels, density: m.density, hasAlpha: m.hasAlpha, pages: m.pages, exif: !!m.exif, icc: !!m.icc };
}
async function thumbnail(p, size = 240) {
  return (await open(p, { side: size })).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
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

const roundRect = (w, h, r, fill) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"/></svg>`);
// Width and corner radius are percentages of the shorter side; rounded corners and shadows need a format with alpha.
async function border(p, opts, ctx) {
  let buf = await (await open(p)).rotate().png().toBuffer();
  const { width: W, height: H } = await sharp()(buf).metadata(), short = Math.min(W, H);
  const b = Math.round((short * (Number(opts.width) || 0)) / 100), r = Math.round((short * (Number(opts.radius) || 0)) / 200);
  if (r) buf = await sharp()(buf).ensureAlpha().composite([{ input: roundRect(W, H, r, '#fff'), blend: 'dest-in' }]).png().toBuffer();
  if (b) buf = await sharp()({ create: { width: W + 2 * b, height: H + 2 * b, channels: 4, background: CLEAR } }).composite([{ input: roundRect(W + 2 * b, H + 2 * b, r && r + b, opts.color || '#ffffff') }, { input: buf, left: b, top: b }]).png().toBuffer();
  if (opts.shadow) {
    const { width: fw, height: fh } = await sharp()(buf).metadata(), s = Math.max(4, Math.round(short * 0.025)), pad = 3 * s;
    const shadow = await sharp()({ create: { width: fw + 2 * pad, height: fh + 2 * pad, channels: 4, background: CLEAR } }).composite([{ input: roundRect(fw, fh, r && r + b, 'rgba(0,0,0,0.5)'), left: pad + (s >> 1), top: pad + s }]).png().toBuffer();
    buf = await sharp()(await sharp()(shadow).blur(s).png().toBuffer()).composite([{ input: buf, left: pad, top: pad }]).png().toBuffer();
  }
  const keep = keepExt(p), to = (r || opts.shadow) && ['jpg', 'tiff'].includes(keep) ? 'png' : keep;
  return writeAs(sharp()(buf), to, ctx.out.file(p, `${U.base(p)}-framed.${to}`), { quality: 92 });
}

const FACE_MODEL = path.join(__dirname, '../../../assets/models/version-RFB-320.onnx');
function detect(tiles, signal) {
  return new Promise((resolve, reject) => {
    const child = require('child_process').fork(path.join(__dirname, 'faces.js'), [], { execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced' });
    let err = '';
    const stop = () => child.kill();
    signal?.addEventListener('abort', stop, { once: true });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('message', (m) => { if (m.error) reject(new Error(m.error)); else resolve(m.done); child.kill(); });
    child.on('exit', () => {
      signal?.removeEventListener('abort', stop);
      reject(Object.assign(new Error(signal?.aborted ? 'Cancelled' : `Face detection stopped${err.trim() ? ` (${err.trim().split('\n').pop()})` : ''}`), { cancelled: !!signal?.aborted }));
    });
    child.send({ model: FACE_MODEL, tiles });
  });
}
// The whole picture plus overlapping tiles on big pictures, so small faces in group photos are found too.
async function findFaces(buf, W, H, signal) {
  const regions = [{ x: 0, y: 0, w: W, h: H }];
  for (const n of [2, 3]) {
    if (Math.min(W, H) < 640 * (n - 1)) break;
    const w = Math.min(W, Math.ceil((W / n) * 1.3)), h = Math.min(H, Math.ceil((H / n) * 1.3));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) regions.push({ x: Math.round((i * (W - w)) / (n - 1)), y: Math.round((j * (H - h)) / (n - 1)), w, h });
  }
  const tiles = await Promise.all(regions.map(async (r) => ({ data: await sharp()(buf).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).resize(320, 240, { fit: 'fill' }).removeAlpha().raw().toBuffer() })));
  const boxes = (await detect(tiles, signal)).flatMap((list, k) => list.map(([score, x1, y1, x2, y2]) => {
    const r = regions[k];
    return { score, x1: r.x + x1 * r.w, y1: r.y + y1 * r.h, x2: r.x + x2 * r.w, y2: r.y + y2 * r.h };
  })).sort((a, b) => b.score - a.score);
  const area = (a) => Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const iou = (a, b) => { const i = area({ x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), x2: Math.min(a.x2, b.x2), y2: Math.min(a.y2, b.y2) }); return i / (area(a) + area(b) - i || 1); };
  return boxes.reduce((kept, b) => (kept.some((k) => iou(k, b) > 0.3) ? kept : [...kept, b]), []);
}
async function blurFaces(p, opts, ctx) {
  const buf = await (await open(p)).rotate().png().toBuffer();
  const { width: W, height: H } = await sharp()(buf).metadata();
  ctx.progress?.(0.2, 'Looking for faces');
  const faces = await findFaces(buf, W, H, ctx.signal), k = U.clamp(Number(opts.strength) || 60, 1, 100) / 100, patches = [];
  for (const f of faces) {
    const mx = (f.x2 - f.x1) * 0.15, my = (f.y2 - f.y1) * 0.15;
    const left = Math.max(0, Math.floor(f.x1 - mx)), top = Math.max(0, Math.floor(f.y1 - my));
    const width = Math.min(W, Math.ceil(f.x2 + mx)) - left, height = Math.min(H, Math.ceil(f.y2 + my)) - top;
    if (width < 2 || height < 2) continue;
    const part = sharp()(buf).extract({ left, top, width, height }), cell = Math.max(2, Math.min(width, height) * (0.04 + 0.16 * k));
    const input = opts.mode === 'pixelate'
      ? await sharp()(await part.resize(Math.ceil(width / cell), Math.ceil(height / cell), { fit: 'fill' }).png().toBuffer()).resize(width, height, { fit: 'fill', kernel: 'nearest' }).png().toBuffer()
      : await part.blur(cell).png().toBuffer();
    patches.push({ input, left, top });
  }
  const to = keepExt(p), out = ctx.out.file(p, `${U.base(p)}-faces-hidden.${to}`);
  await writeAs(sharp()(buf).composite(patches), to, out, { quality: 92 });
  return { path: out, note: patches.length ? `${patches.length} face${patches.length === 1 ? '' : 's'} ${opts.mode === 'pixelate' ? 'pixelated' : 'blurred'}` : 'No faces found. Saved an unchanged copy.' };
}

// Filee's AnimationTiming.ChangeSpeed: delays are rescaled in the target's ticks on a running total, and frames
// that would last under 20 ms are dropped, their time going to the frame before.
function changeSpeed(frames, speed, to) {
  if (frames.length < 2 || !(speed > 0) || speed === 1) return frames;
  const ticks = to === 'gif' ? 100 : 1000, min = Math.floor(ticks / 50), starts = [0];
  frames.forEach((f, i) => starts.push(starts[i] + ((f.delay <= 10 ? 100 : f.delay) * ticks) / 1000 / speed));
  const kept = [];
  frames.forEach((f, i) => { const s = Math.round(starts[i]); if (!kept.length || s - kept[kept.length - 1].s >= min) kept.push({ f, s }); });
  const end = Math.round(starts[frames.length]);
  if (kept.length > 1 && end - kept[kept.length - 1].s < min) kept.pop();
  return kept.map(({ f, s }, i) => ({ ...f, delay: (Math.max(min, (i + 1 < kept.length ? kept[i + 1].s : end) - s) * 1000) / ticks }));
}
async function animationSpeed(p, opts, ctx) {
  if (!(await isAnimated(p))) throw new Error('This image has only one frame.');
  const e = U.ext(p), to = e === 'png' ? 'apng' : e, a = await readAnimation(p);
  let frames = changeSpeed(a.frames, Number(opts.speed) || 1, to);
  if (opts.reverse) frames = [...frames].reverse();
  const out = ctx.out.file(p, `${U.base(p)}-speed.${e}`);
  await writeAnimation({ ...a, frames }, to, out, { quality: 90 });
  return { path: out, note: `${a.frames.length} frames → ${frames.length}, ${(frames.reduce((t, f) => t + f.delay, 0) / 1000).toFixed(2)} s` };
}

module.exports = { open, toPngOrJpeg, writeAs, makeIco, convert, toPdf, isAnimated, readAnimation, writeAnimation, changeSpeed, compress, resize, crop, rotate, adjust, watermark, meme, border, blurFaces, animationSpeed, strip, removeBackground, upscale, info, thumbnail, collage, sharp };
