'use strict';
// GIFs made with gifski: it picks colours per frame and dithers over time, so gradients and skin
// keep their tones where a single FFmpeg palette bands.
const U = require('./util');
const { fsp, path } = U;
const C = require('./codecs');
const media = () => require('./media');

const QUALITY = { high: 95, balanced: 85, small: 70 };
const MAX_BYTES = 768 * 1048576;
const readFrames = async (dir) => (await fsp.readdir(dir)).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(dir, f));
async function rgba(files) {
  const sharp = require('sharp'), frames = [];
  for (const f of files) frames.push(await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  return frames;
}

async function fromVideo(p, opts, ctx) {
  if (opts.format === 'apng') return media().toGif(p, opts, ctx);
  const M = media(), info = await M.probe(p);
  if (!info.video) throw new Error(`${path.basename(p)} has no video track.`);
  const q = opts.quality || 'balanced', fps = Math.max(1, Math.min(50, Number(opts.fps) || { high: 15, balanced: 12, small: 10 }[q] || 12));
  const start = M.parseTime(opts.start) || 0, h = Number(opts.height) || 0;
  const dur = M.parseTime(opts.duration) || Math.max(0.1, Math.min(info.duration - start, 15));
  const w = Number(opts.width) || { high: 640, balanced: 480, small: 320 }[q] || 480;
  const sar = Math.abs((info.video.sar || 1) - 1) > 0.01 ? "scale=w='trunc(iw*sar/2)*2':h=ih,setsar=1," : '';
  const outW = Math.min(w, info.video.width || w), outH = Math.round(outW * ((info.video.height || 9) / ((info.video.width || 16) * (info.video.sar || 1))));
  if (outW * Math.min(outH, h || outH) * 4 * Math.ceil(dur * fps) > MAX_BYTES) return M.toGif(p, opts, ctx);
  const dir = await U.tmpDir('gifski');
  try {
    const chain = `fps=${fps},${sar}scale=w='min(iw,${w})':h=${h ? `'min(ih,${Math.max(16, h)})'` : 'ih'}:force_original_aspect_ratio=decrease:flags=lanczos`;
    await M.ffmpeg(['-ss', String(start), '-t', String(dur), '-i', p, '-map', '0:V:0', '-vf', chain, '-an', '-f', 'image2', path.join(dir.replace(/%/g, '%%'), 'f%05d.png')], { ...ctx, progress: (f, l) => ctx.progress(f * 0.4, l) }, dur, 'Reading frames');
    const files = await readFrames(dir);
    if (!files.length) throw new Error('No frames could be read from this video.');
    const frames = await rgba(files);
    ctx.progress(0.5, 'Making GIF');
    const out = ctx.out.file(p, `${U.base(p)}.gif`);
    await fsp.writeFile(out, await C.gifski(frames, frames[0].info.width, frames[0].info.height, { quality: QUALITY[q] || 85, fps }));
    return out;
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function fromImages(inputs, opts, ctx) {
  const out = ctx.out.file(inputs[0], 'Animation.gif'), ms = (Number(opts.seconds) || 1) * 1000, W = Number(opts.width) || 600;
  return C.gifFromImages(inputs, out, { width: W, delays: inputs.map(() => ms), quality: 90, progress: ctx.progress });
}

const SLIDE_W = { small: 480, medium: 800, large: 1200 };
async function fromSlides(p, opts, ctx) {
  const crafts = require('./crafts'), out = ctx.out.file(p, `${U.base(p)}.gif`), seconds = Math.max(0.5, Math.min(60, Number(opts.seconds) || 3));
  const dir = await U.tmpDir('slidegif');
  try {
    ctx.progress(0.1, 'Drawing slides');
    await U.run(await crafts.cli('deckcraft'), ['render', p, '--all', '--scale', '1', dir], { signal: ctx.signal, timeout: 600000, cwd: dir, errorMessage: 'DeckCraft couldn’t finish', env: { NO_COLOR: '1' } });
    const files = await readFrames(dir);
    if (!files.length) throw new Error('DeckCraft finished without drawing any slides.');
    await C.gifFromImages(files, out, { width: SLIDE_W[opts.width] || SLIDE_W.medium, height: 4000, fit: 'inside', delays: files.map(() => seconds * 1000), quality: 90, progress: (f, l) => ctx.progress(0.3 + f * 0.7, l) });
    return out;
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { fromVideo, fromImages, fromSlides };
