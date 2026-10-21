'use strict';
// The image editor's engine. Light, colour, detail, effects, crop, straighten, rotation, spot healing and red eye
// are LightCraft develop settings, kept as data and rendered by LightCraft from the untouched image each time, so
// every edit stays adjustable. Pixel steps (PhotoCraft actions and Lime's own tools) make a new base image under
// those settings. Text and shapes are drawn by the editor and laid on top when saving.
const U = require('./engines/util');
const { fs, fsp, path, os } = U;

const img = () => require('./engines/image');
const crafts = () => require('./engines/crafts');
const sharp = () => img().sharp();

const sessions = new Map();
let seq = 0;
const get = (id) => { const s = sessions.get(id); if (!s) throw new Error('This image was closed.'); return s; };

// What LightCraft opens itself; anything else is decoded by Lime first.
const LC_READS = new Set(['jpg', 'jpeg', 'jfif', 'png', 'gif', 'webp', 'heic', 'heif', 'hif', 'jxl', 'tif', 'tiff', ...U.GROUPS.raw]);
const SHARP_READS = new Set(['jpg', 'jpeg', 'jfif', 'png', 'webp', 'tif', 'tiff', 'avif']);
// Previews come from the smallest of these copies that has enough pixels, else from the image itself.
const PROXIES = [1280, 2560];
// Formats Save can keep; others are saved as PNG (RAW as JPG).
const KEEP = { jpg: 'jpg', jpeg: 'jpg', jfif: 'jpg', png: 'png', webp: 'webp', avif: 'avif', tif: 'tiff', tiff: 'tiff', heic: 'heic', heif: 'heic', hif: 'heic', gif: 'gif', bmp: 'bmp', jxl: 'jxl', tga: 'tga', qoi: 'qoi', jp2: 'jp2' };
const EXIF_FORMATS = new Set(['jpg', 'png', 'webp', 'avif', 'heic']);
const NO_ALPHA = new Set(['jpg', 'heic', 'bmp']);

async function lightcraft(args, okCodes) {
  const bin = await crafts().cli('lightcraft');
  // The CPU path renders previews and the saved file alike, so what is shown is what is saved.
  return U.run(bin, args, { cwd: os.tmpdir(), okCodes, env: { NO_COLOR: '1', LIGHTCRAFT_GPU: '0' }, errorMessage: 'LightCraft couldn’t finish', timeout: 300000 });
}
const jsonLines = (s) => String(s).split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
// Runs LightCraft commands on one image and returns their results; each step is [command, params].
async function lightRun(s, src, steps) {
  const script = path.join(s.dir, `run-${++s.n}.jsonl`);
  await fsp.writeFile(script, steps.map(([command, params]) => JSON.stringify({ command, params: params || {} })).join('\n'));
  try {
    const r = await lightcraft(['run', '--import', src, '--script', script], [1]);
    const lines = jsonLines(r.stdout), fail = lines.find((j) => j.ok === false);
    if (fail || lines.length < steps.length) throw new Error(fail?.error ? `LightCraft: ${fail.error}` : 'LightCraft couldn’t finish.');
    return lines.map((j) => j.result);
  } finally { fsp.rm(script, { force: true }).catch(() => {}); }
}
async function render(s, src, out, settings, extra = []) {
  const file = path.join(s.dir, `set-${++s.n}.json`);
  await fsp.writeFile(file, JSON.stringify(settings));
  try { await lightcraft(['render', src, '-o', out, '--settings', file, ...extra]); } finally { fsp.rm(file, { force: true }).catch(() => {}); }
  if (!fs.existsSync(out)) throw new Error('LightCraft finished without writing the image.');
  return out;
}
const UNIT = { x0: 0, y0: 0, x1: 1, y1: 1 };
// What a mask (an image's transparency) needs: the same framing and nothing else.
const geometryOnly = (dev) => ({ orientation: dev.orientation, geometry: dev.geometry, crop: { ...dev.crop, flip_h: false, flip_v: false } });
function settingsFor(dev, mode) {
  if (mode === 'before') return geometryOnly(dev);
  if (mode === 'frame') return { ...dev, crop: { ...dev.crop, geometry: { angle: 0, rect: UNIT } }, vignette: { ...dev.vignette, amount: 0 } };
  return dev;
}

// The ICC profile's own name, so the saved file can keep the colour space it came in.
function iccName(buf) {
  try {
    const n = buf.readUInt32BE(128);
    for (let i = 0; i < n; i++) {
      const o = 132 + i * 12;
      if (buf.toString('latin1', o, o + 4) !== 'desc') continue;
      const at = buf.readUInt32BE(o + 4), type = buf.toString('latin1', at, at + 4);
      if (type === 'desc') return buf.toString('latin1', at + 12, at + 11 + buf.readUInt32BE(at + 8));
      if (type === 'mluc') { const len = buf.readUInt32BE(at + 20), off = buf.readUInt32BE(at + 24); return Buffer.from(buf.subarray(at + off, at + off + len)).swap16().toString('utf16le'); }
    }
  } catch (_) {}
  return '';
}
function spaceOf(icc) {
  if (!icc) return 'srgb';
  const n = iccName(icc).toLowerCase();
  if (/srgb|iec61966/.test(n)) return 'srgb';
  if (/p3|sp3c/.test(n)) return 'displayP3';
  if (/adobe ?rgb|compatible with adobe/.test(n)) return 'adobeRgb';
  if (/prophoto|romm/.test(n)) return 'proPhoto';
  if (/2020/.test(n)) return 'rec2020';
  return null;
}

async function makeProxies(s, file, tag) {
  const m = await sharp()(file, { failOn: 'none' }).metadata(), list = [];
  for (const side of PROXIES) {
    if (Math.max(m.width, m.height) <= side) break;
    const out = path.join(s.dir, `${tag}-${side}.tif`);
    await sharp()(file, { failOn: 'none' }).keepIccProfile().resize(side, side, { fit: 'inside' }).tiff({ compression: 'none' }).toFile(out);
    list.push({ side, file: out });
  }
  return list;
}
// The copy to render from for an output of `size` pixels on its long edge, given how much of the frame is kept.
function sourceFor(b, size, dev, mask) {
  const r = dev?.crop?.geometry?.rect, keep = r ? Math.max(0.05, Math.max(r.x1 - r.x0, r.y1 - r.y0)) : 1;
  const need = size / keep, list = mask ? b.maskProxies : b.proxies;
  return (list || []).find((p) => p.side >= need)?.file || (mask ? b.mask : b.path);
}
// A base is a picture LightCraft can read (RGB), with its transparency kept beside it as a grey mask.
async function addBase(s, file, { raw = false } = {}) {
  const i = s.bases.length, tag = `b${i}`;
  let pathRgb = file, mask = null;
  if (!raw) {
    const m = await sharp()(file, { failOn: 'none' }).metadata();
    const alpha = m.hasAlpha && (await sharp()(file, { failOn: 'none' }).extractChannel(m.channels - 1).stats()).channels[0].min < 255;
    if (alpha) {
      mask = path.join(s.dir, `${tag}-mask.png`);
      await sharp()(file, { failOn: 'none' }).extractChannel(m.channels - 1).png().toFile(mask);
    }
    if (alpha || !LC_READS.has(U.ext(file)) || m.space === 'cmyk') {
      pathRgb = path.join(s.dir, `${tag}.tif`);
      await sharp()(file, { failOn: 'none' }).keepIccProfile().removeAlpha().tiff({ compression: 'none' }).toFile(pathRgb);
    }
  }
  const info = (await lightRun(s, pathRgb, [['photo.inspect']]))[0];
  const proxies = raw ? [] : await makeProxies(s, pathRgb, tag);
  const b = { path: pathRgb, mask, w: info.width, h: info.height, raw, proxies, proxy: proxies[proxies.length - 1]?.file || pathRgb, maskProxies: mask ? await makeProxies(s, mask, `${tag}m`) : [], info };
  s.bases.push(b);
  return { base: i, w: b.w, h: b.h, alpha: !!mask, raw };
}

// Working copies left behind by an editor that never closed (Lime quit, or crashed) go after a day.
async function sweep() {
  const now = Date.now();
  for (const d of await fsp.readdir(U.cfg.tmp).catch(() => [])) {
    if (!d.startsWith('imgedit-')) continue;
    const p = path.join(U.cfg.tmp, d), st = await fsp.stat(p).catch(() => null);
    if (st && now - st.mtimeMs > 864e5 && ![...sessions.values()].some((s) => s.dir === p)) fsp.rm(p, { recursive: true, force: true }).catch(() => {});
  }
}
async function open(file) {
  sweep();
  const s = { id: ++seq, file, dir: await U.tmpDir('imgedit'), bases: [], n: 0 };
  sessions.set(s.id, s);
  try {
    const e = U.ext(file), raw = U.groupOf(file) === 'raw';
    let src = file, note = '';
    if (!raw) {
      // Turned upright first when the camera only noted which way up it was, so every tool sees the same pixels.
      const m = await sharp()(file, { failOn: 'none' }).metadata().catch(() => null);
      if (!m || !LC_READS.has(e) || (m.orientation && m.orientation > 1) || ['psd', 'psb', 'pcraft'].includes(e)) {
        src = path.join(s.dir, 'original.tif');
        const deep = m && ['ushort', 'float'].includes(m.depth);
        await (await img().open(file)).rotate().keepIccProfile().toColourspace(deep ? 'rgb16' : 'srgb').tiff({ compression: 'none' }).toFile(src).catch(async () => {
          await (await img().open(file)).rotate().tiff({ compression: 'none' }).toFile(src);
        });
      }
      if (m && (m.pages || 1) > 1) note = U.ext(file) === 'gif' || U.ext(file) === 'webp' ? 'Animated images are edited as a still of the first frame.' : 'Only the first page is edited.';
    }
    const b = await addBase(s, src, { raw });
    const info = s.bases[0].info;
    // The saved file keeps the colour space LightCraft can render in, and the original's Exif: from the original
    // itself when sharp reads it, else from a tiny copy LightCraft writes with the camera data.
    const meta = await sharp()(file, { failOn: 'none' }).metadata().catch(() => null);
    s.space = spaceOf(meta?.icc);
    if (SHARP_READS.has(e) && meta && s.space && meta.space !== 'cmyk') s.carrier = file;
    else {
      s.space = s.space || 'srgb';
      if (LC_READS.has(e)) {
        const c = path.join(s.dir, 'meta.jpg');
        s.carrier = await lightcraft(['render', file, '-o', c, '--size', '64', '--opt', 'metadata=all', '--opt', `colorSpace=${s.space}`]).then(() => c, () => null);
      }
    }
    s.deep = raw || ['ushort', 'float'].includes(meta?.depth);
    return { id: s.id, ...b, name: path.basename(file), ext: e, keep: raw ? 'jpg' : KEEP[e] || 'png', dev: info.develop, asShot: info.as_shot_wb || [6500, 0], kelvin: info.develop?.wb?.scale === 'kelvin', note };
  } catch (err) { close(s.id); throw err; }
}

// Renders what the editor shows: the edit at screen size, the whole frame while cropping, or the original.
async function preview(id, state, opts = {}) {
  const s = get(id), b = opts.mode === 'before' ? s.bases[0] : s.bases[state.base];
  const size = Math.max(16, Math.round(opts.size || 1600));
  const geo = opts.mode === 'frame' ? null : state.dev, src = sourceFor(b, size, geo), k = ++s.n;
  const out = path.join(s.dir, `view-${k}.jpg`);
  try {
    await render(s, src, out, settingsFor(state.dev, opts.mode), ['--size', String(size), '--quality', opts.draft ? '70' : '86', '--opt', 'metadata=none']);
    if (!b.mask) {
      const data = await fsp.readFile(out), m = await sharp()(data).metadata();
      return { data, type: 'image/jpeg', w: m.width, h: m.height };
    }
    const am = path.join(s.dir, `view-${k}-a.png`);
    try {
      await render(s, sourceFor(b, size, geo, true), am, geometryOnly(opts.mode === 'frame' ? settingsFor(state.dev, 'frame') : state.dev), ['--size', String(size), '--opt', 'metadata=none']);
      const m = await sharp()(out).metadata();
      const alpha = await sharp()(am).resize(m.width, m.height, { fit: 'fill' }).extractChannel(0).toBuffer();
      const data = await sharp()(out).joinChannel(alpha).png({ compressionLevel: 1 }).toBuffer();
      return { data, type: 'image/png', w: m.width, h: m.height };
    } finally { fsp.rm(am, { force: true }).catch(() => {}); }
  } finally { fsp.rm(out, { force: true }).catch(() => {}); }
}
// LightCraft's built-in looks, in its own order and groups.
let lookList = null;
async function looks() {
  if (!lookList) {
    const r = await lightcraft(['run', 'presets.list']);
    lookList = (jsonLines(r.stdout)[0]?.result || []).filter((p) => p.builtin).map(({ id, name, group }) => ({ id, name, group }));
  }
  return lookList;
}
// LightCraft's profiles: Color is the plain rendering, the rest are creative starting points.
let profileList = null;
async function profiles() {
  if (!profileList) profileList = (jsonLines((await lightcraft(['run', 'profiles.list'])).stdout)[0]?.result || []).map(({ id, name, group }) => ({ id, name, group }));
  return profileList;
}
// A small rendering of one LightCraft look on the image, for the Looks panel.
async function lookThumb(id, preset, size = 112) {
  const s = get(id), b = s.bases[0], out = path.join(s.dir, `look-${++s.n}.jpg`);
  s.thumbSrc ||= (async () => {
    const small = path.join(s.dir, 'thumb.jpg'), tif = path.join(s.dir, 'thumb.tif');
    await render(s, b.proxies[0]?.file || b.path, small, {}, ['--size', '320', '--quality', '92', '--opt', 'metadata=none']);
    await sharp()(small).tiff({ compression: 'none' }).toFile(tif);
    return tif;
  })();
  try {
    await lightcraft(['render', await s.thumbSrc, '-o', out, '--size', String(size), '--quality', '80', '--opt', 'metadata=none', ...(preset ? ['--preset', preset] : [])]);
    return await fsp.readFile(out);
  } finally { fsp.rm(out, { force: true }).catch(() => {}); }
}

// LightCraft's own automatic edits, which answer with settings: Auto, Auto B&W, a look, auto straighten, dust
// and blemish spots, and spots placed by hand (their source is chosen once here and then kept).
const DEVELOP = {
  auto: () => [['develop.auto']],
  bw: () => [['develop.treatment', { bw: true }], ['develop.autoBwMix']],
  look: (p) => [['preset.apply', { id: p.id, amount: Number(p.amount ?? 100) }]],
  straighten: () => [['crop.autoStraighten']],
  dust: (p) => [['spot.findDust', { sensitivity: Number(p.sensitivity ?? 50) }]],
  blemishes: () => [['spot.findBlemishes']],
  spot: (p) => [['spot.add', p]],
  upright: (p) => [['geometry.upright', { mode: p.mode }]],
};
async function develop(id, state, kind, params = {}) {
  const s = get(id), b = s.bases[state.base];
  if (!DEVELOP[kind]) throw new Error(`Unknown edit ${kind}`);
  const steps = DEVELOP[kind](params);
  const res = await lightRun(s, kind === 'dust' || kind === 'blemishes' ? b.path : b.proxy, [['develop.merge', { settings: state.dev }], ...steps, ['develop.get']]);
  return { dev: res[res.length - 1], result: res[res.length - 2] };
}

// A flat RGB or RGBA picture of the base for tools that change pixels. A RAW is developed first, with everything
// but the framing, the post-crop effects and the spots, which carry on as settings on the new base.
async function pixels(s, state) {
  const b = s.bases[state.base];
  if (b.raw) {
    const out = path.join(s.dir, `dev-${++s.n}.tif`), d = state.dev;
    await render(s, b.path, out, { ...d, crop: { ...d.crop, geometry: { angle: 0, rect: UNIT }, flip_h: false, flip_v: false }, orientation: 'Normal', vignette: { ...d.vignette, amount: 0 }, grain: { ...d.grain, amount: 0 }, spots: [], red_eye: [] },
      ['--opt', 'bitDepth=16', '--opt', 'metadata=none', '--opt', `colorSpace=${s.space}`]);
    return { file: out, baked: true };
  }
  let file = b.path;
  if (!['png', 'tif', 'tiff', 'jpg', 'jpeg'].includes(U.ext(file))) {
    file = path.join(s.dir, `flat-${++s.n}.tif`);
    await render(s, b.path, file, {}, ['--opt', 'metadata=none', '--opt', `colorSpace=${s.space}`]);
  }
  if (b.mask) {
    const out = path.join(s.dir, `rgba-${++s.n}.png`), m = await sharp()(file).metadata();
    await sharp()(file).joinChannel(await sharp()(b.mask).resize(m.width, m.height, { fit: 'fill' }).extractChannel(0).toBuffer()).png().toFile(out);
    file = out;
  }
  return { file, baked: false };
}
async function photocraft(s, file, cmds) {
  const bin = await crafts().cli('photocraft'), out = path.join(s.dir, `pc-${++s.n}.png`);
  const args = ['run', file, ...cmds.flatMap(([c, p]) => ['--cmd', c, ...(p ? ['--params', JSON.stringify(p)] : [])]), '--out', out];
  await U.run(bin, args, { cwd: os.tmpdir(), env: { NO_COLOR: '1' }, errorMessage: 'PhotoCraft couldn’t finish', timeout: 300000 });
  if (!fs.existsSync(out)) throw new Error('PhotoCraft finished without writing the image.');
  return out;
}
const PC = {
  autoTone: [['image.autoTone']],
  autoContrast: [['image.autoContrast']],
  autoColor: [['image.autoColor']],
  sharpen: [['filter.sharpen.smartSharpen', { amount: 120, radius: 1.5, reduceNoise: 10 }]],
  denoise: [['filter.noise.reduceNoise', { strength: 8, preserveDetails: 40, reduceColorNoise: 70, sharpenDetails: 10, removeJpegArtifact: true }]],
  shadows: [['image.adjustments.shadowsHighlights', { shadowAmount: 45, highlightAmount: 10 }]],
  oil: [['filter.stylize.oilPaint']],
  watercolor: [['filter.gallery.watercolor']],
  poster: [['filter.gallery.cutout']],
  ink: [['filter.gallery.inkOutlines']],
  pencil: [['filter.gallery.coloredPencil']],
  sketch: [['filter.gallery.graphicPen']],
  tiltShift: [['filter.blurGallery.tiltShift']],
  glow: [['filter.gallery.diffuseGlow']],
};
const LIME = { removeBg: 'remove-background', blurFaces: 'blur-faces', upscale: 'upscale-image' };
// Applies a PhotoCraft action or a Lime tool to the base; the result becomes a new base under the same settings.
async function step(id, state, kind, opts = {}) {
  const s = get(id), before = s.bases[state.base];
  const { file, baked } = await pixels(s, state);
  let out;
  if (PC[kind]) out = await photocraft(s, file, PC[kind]);
  else if (LIME[kind]) {
    const dir = path.join(s.dir, `tool-${++s.n}`);
    await fsp.mkdir(dir, { recursive: true });
    const ctx = { signal: undefined, out: U.outputPlanner({ dest: { kind: 'dir', path: dir } }), host: async () => null, progress: () => {} };
    const res = await require('./tools').get(LIME[kind]).run([file], opts, ctx);
    out = [res].flat(Infinity).map((r) => (typeof r === 'string' ? r : r?.path)).find(Boolean);
    if (!out) throw new Error('The tool finished without a picture.');
  } else throw new Error(`Unknown step ${kind}`);
  const b = await addBase(s, out);
  let dev = null;
  if (baked) {
    // The RAW's light and colour are now in the pixels; the framing, effects and spots stay settings.
    const d = state.dev, fresh = s.bases[b.base].info.develop;
    dev = { ...fresh, crop: d.crop, orientation: d.orientation, vignette: d.vignette, grain: d.grain, spots: d.spots, red_eye: d.red_eye };
  }
  return { ...b, scale: b.w / before.w, dev };
}

const flatten = (pipe, to, alpha) => (alpha && NO_ALPHA.has(to) ? pipe.flatten({ background: '#ffffff' }) : pipe);
const tiffBuf = (pipe, deep) => (deep ? pipe.toColourspace('rgb16') : pipe).keepIccProfile().tiff({ compression: 'none' }).toBuffer({ resolveWithObject: true });
// Saves the edit at full size: LightCraft renders it, then the drawing goes on top, then the size and canvas change,
// then it is written with the original's metadata and colour profile.
async function save(id, state, overlay, target, fmt = {}) {
  const s = get(id), b = s.bases[state.base];
  const to = fmt.to === 'jpeg' ? 'jpg' : fmt.to === 'tif' ? 'tiff' : fmt.to || (U.groupOf(s.file) === 'raw' ? 'jpg' : KEEP[U.ext(s.file)] || 'png');
  const quality = Number(fmt.quality) || ({ jpg: 92, webp: 90, avif: 80, heic: 88 }[to] || 92);
  const tif = path.join(s.dir, `final-${++s.n}.tif`);
  const deep = to === 'tiff' && s.deep && !b.mask;
  try {
    await render(s, b.path, tif, state.dev, ['--opt', `bitDepth=${deep ? 16 : 8}`, '--opt', 'metadata=none', '--opt', `colorSpace=${s.space}`]);
    let cur = await tiffBuf(sharp()(tif).removeAlpha(), deep);
    const W = cur.info.width, H = cur.info.height;
    if (b.mask) {
      const am = path.join(s.dir, `final-${s.n}-a.png`);
      await render(s, b.mask, am, geometryOnly(state.dev), ['--opt', 'metadata=none']);
      const a = await sharp()(am).resize(W, H, { fit: 'fill' }).extractChannel(0).toBuffer();
      fsp.rm(am, { force: true }).catch(() => {});
      cur = await tiffBuf(sharp()(cur.data).joinChannel(a), deep);
    }
    const alpha = !!b.mask;
    if (overlay?.length) {
      const layer = await sharp()(Buffer.from(overlay)).resize(W, H, { fit: 'fill' }).png().toBuffer();
      cur = await tiffBuf(sharp()(cur.data).composite([{ input: layer }]), deep);
    }
    const o = state.output || {};
    if (o.resize && (o.resize.w !== W || o.resize.h !== H)) cur = await tiffBuf(sharp()(cur.data).resize(Math.max(1, Math.round(o.resize.w)), Math.max(1, Math.round(o.resize.h)), { fit: 'fill', kernel: 'lanczos3' }), deep);
    if (o.canvas) {
      const { width: w, height: h } = cur.info, cw = Math.max(1, Math.round(o.canvas.w)), ch = Math.max(1, Math.round(o.canvas.h));
      const [ax, ay] = o.canvas.anchor || [0.5, 0.5], left = Math.round((cw - w) * ax), top = Math.round((ch - h) * ay);
      const bg = o.canvas.color === 'transparent' ? { r: 0, g: 0, b: 0, alpha: 0 } : o.canvas.color || '#ffffff';
      let pipe = sharp()(cur.data);
      if (o.canvas.color === 'transparent') pipe = pipe.ensureAlpha();
      // Growing pads with the colour; shrinking cuts from around the anchor.
      const ext = { top: Math.max(0, top), bottom: Math.max(0, ch - h - top), left: Math.max(0, left), right: Math.max(0, cw - w - left), background: bg };
      cur = await tiffBuf(pipe.extend(ext), deep);
      if (cw < w || ch < h) cur = await tiffBuf(sharp()(cur.data).extract({ left: Math.max(0, -left), top: Math.max(0, -top), width: cw, height: ch }), deep);
    }
    const hasAlpha = alpha || o.canvas?.color === 'transparent';
    cur = await tiffBuf(flatten(sharp()(cur.data), to, hasAlpha), deep);
    const final = await encode(s, cur.data, to, target, { quality, deep, alpha: hasAlpha && !NO_ALPHA.has(to) });
    const m = await sharp()(cur.data).metadata();
    return { path: final.path || final, w: m.width, h: m.height, to, bytes: fs.statSync(final.path || final).size };
  } finally { fsp.rm(tif, { force: true }).catch(() => {}); }
}
// The original goes in first so its Exif comes along (turned upright), then the edit replaces every pixel; its
// colour profile is the one the edit was rendered in.
async function encode(s, buf, to, out, { quality, alpha, deep }) {
  await fsp.mkdir(path.dirname(out), { recursive: true });
  let pipe;
  if (s.carrier && EXIF_FORMATS.has(to)) {
    const m = await sharp()(buf).metadata();
    pipe = sharp()(s.carrier, { failOn: 'none' }).autoOrient();
    pipe = alpha ? pipe.ensureAlpha() : pipe.removeAlpha();
    pipe = pipe.resize(m.width, m.height, { fit: 'fill' }).composite([{ input: buf, blend: 'source' }]);
  } else pipe = sharp()(buf);
  if (to === 'tiff') { await (deep ? pipe.toColourspace('rgb16') : pipe).keepIccProfile().tiff({ compression: 'lzw' }).toFile(out); return out; }
  return img().writeAs(pipe, to, out, { quality });
}

function close(id) {
  const s = sessions.get(id);
  if (!s) return true;
  sessions.delete(id);
  fsp.rm(s.dir, { recursive: true, force: true }).catch(() => {});
  return true;
}

module.exports = { open, preview, looks, profiles, lookThumb, develop, step, save, close };
