'use strict';
const U = require('./util');
const { fs, fsp, path } = U;

async function probe(p) {
  const { stdout } = await U.run(U.binPath('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', p], { errorMessage: `Couldn’t read ${path.basename(p)}` });
  const j = JSON.parse(stdout || '{}');
  const v = (j.streams || []).find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  const rot = Number(v?.tags?.rotate || v?.side_data_list?.find((d) => d.rotation != null)?.rotation || 0);
  return {
    duration: Number(j.format?.duration) || 0,
    size: Number(j.format?.size) || 0,
    bitrate: Number(j.format?.bit_rate) || 0,
    format: j.format?.format_long_name,
    video: v ? { codec: v.codec_name, width: Math.abs(rot) % 180 === 90 ? v.height : v.width, height: Math.abs(rot) % 180 === 90 ? v.width : v.height, fps: fps(v.avg_frame_rate || v.r_frame_rate) } : null,
    audio: a ? { codec: a.codec_name, channels: a.channels, rate: Number(a.sample_rate) } : null,
    subtitles: (j.streams || []).filter((s) => s.codec_type === 'subtitle').length,
  };
}
const fps = (r) => { const [a, b] = String(r || '0/1').split('/').map(Number); return b ? a / b : a; };

/** Runs FFmpeg with machine-readable progress. */
async function ffmpeg(args, ctx, duration, label) {
  const full = ['-hide_banner', '-v', 'error', '-y', '-nostats', '-progress', 'pipe:1', ...args];
  let buf = '';
  return U.run(U.binPath('ffmpeg'), full, {
    signal: ctx?.signal,
    onStdout: (s) => {
      buf += s;
      const m = buf.match(/out_time_(?:us|ms)=(\d+)/g);
      if (m && duration) {
        const us = Number(m[m.length - 1].split('=')[1]);
        ctx?.progress(Math.min(0.99, us / 1e6 / duration), label);
        buf = buf.slice(-200);
      }
    },
  });
}
const parseTime = (t) => {
  if (t == null || t === '') return null;
  if (typeof t === 'number') return t;
  const parts = String(t).trim().split(':').map(Number);
  if (parts.some((x) => Number.isNaN(x))) throw new Error(`“${t}” isn’t a time. Use seconds (90) or mm:ss (1:30).`);
  return parts.reduce((acc, v) => acc * 60 + v, 0);
};

const VIDEO = {
  mp4: (q) => ['-c:v', 'libx264', '-preset', 'medium', '-crf', q.crf264, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', q.ab, '-movflags', '+faststart'],
  mov: (q) => ['-c:v', 'libx264', '-preset', 'medium', '-crf', q.crf264, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', q.ab],
  mkv: (q) => ['-c:v', 'libx264', '-preset', 'medium', '-crf', q.crf264, '-c:a', 'aac', '-b:a', q.ab, '-c:s', 'copy'],
  webm: (q) => ['-c:v', 'libvpx-vp9', '-crf', q.crfvp9, '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3', '-c:a', 'libopus', '-b:a', q.ab],
  avi: (q) => ['-c:v', 'mpeg4', '-q:v', q.qv, '-c:a', 'libmp3lame', '-b:a', q.ab],
  wmv: (q) => ['-c:v', 'wmv2', '-q:v', q.qv, '-c:a', 'wmav2', '-b:a', q.ab],
  flv: (q) => ['-c:v', 'libx264', '-crf', q.crf264, '-c:a', 'aac', '-b:a', q.ab],
  mpg: (q) => ['-c:v', 'mpeg2video', '-q:v', q.qv, '-c:a', 'mp2', '-b:a', '192k'],
  '3gp': () => ['-c:v', 'libx264', '-profile:v', 'baseline', '-crf', '28', '-vf', 'scale=-2:min(480\\,ih)', '-c:a', 'aac', '-b:a', '64k', '-ac', '1'],
  hevc: (q) => ['-c:v', 'libx265', '-preset', 'medium', '-crf', String(Number(q.crf264) + 4), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', q.ab, '-movflags', '+faststart'],
};
const QUALITY = {
  high: { crf264: '18', crfvp9: '28', qv: '2', ab: '192k' },
  balanced: { crf264: '23', crfvp9: '33', qv: '4', ab: '160k' },
  small: { crf264: '28', crfvp9: '40', qv: '7', ab: '96k' },
};
const AUDIO = {
  mp3: (br) => ['-c:a', 'libmp3lame', '-b:a', br],
  m4a: (br) => ['-c:a', 'aac', '-b:a', br],
  aac: (br) => ['-c:a', 'aac', '-b:a', br],
  ogg: (br) => ['-c:a', 'libvorbis', '-b:a', br],
  opus: (br) => ['-c:a', 'libopus', '-b:a', br],
  flac: () => ['-c:a', 'flac', '-compression_level', '8'],
  wav: () => ['-c:a', 'pcm_s16le'],
  aiff: () => ['-c:a', 'pcm_s16be'],
  wma: (br) => ['-c:a', 'wmav2', '-b:a', br],
  ac3: (br) => ['-c:a', 'ac3', '-b:a', br],
};
const scaleFilter = (h) => (h ? `scale=-2:'min(${h},ih)':flags=lanczos` : null);

async function convertVideo(p, opts, ctx) {
  const to = opts.to || 'mp4';
  if (to === 'gif') return toGif(p, opts, ctx);
  if (AUDIO[to]) return extractAudio(p, { ...opts, to }, ctx);
  const info = await probe(p);
  if (!info.video) throw new Error(`${path.basename(p)} has no video track. Use Convert audio instead.`);
  const q = QUALITY[opts.quality || 'balanced'];
  const outExt = to === 'hevc' ? 'mp4' : to;
  const out = ctx.out.file(p, `${U.base(p)}${U.ext(p) === outExt ? '-converted' : ''}.${outExt}`);
  const vf = [scaleFilter(opts.height)].filter(Boolean);
  const args = ['-i', p, '-map', '0:v:0', '-map', '0:a?', ...(vf.length ? ['-vf', vf.join(',')] : []), ...(VIDEO[to] || VIDEO.mp4)(q)];
  if (to === 'mkv') args.push('-map', '0:s?');
  args.push(out);
  await ffmpeg(args, ctx, info.duration, `Converting to ${to.toUpperCase()}`);
  return out;
}
async function compressVideo(p, opts, ctx) {
  const info = await probe(p);
  if (!info.video) throw new Error('This file has no video track.');
  const out = ctx.out.file(p, `${U.base(p)}-compressed.mp4`);
  const vf = [scaleFilter(opts.height)].filter(Boolean);
  let vargs;
  if (opts.mode === 'size' && Number(opts.targetMB) > 0) {
    const audioK = 96;
    const totalK = (Number(opts.targetMB) * 8192) / Math.max(1, info.duration);
    const vk = Math.max(100, Math.floor(totalK - audioK - 10));
    vargs = ['-c:v', 'libx264', '-preset', 'medium', '-b:v', `${vk}k`, '-maxrate', `${Math.round(vk * 1.3)}k`, '-bufsize', `${vk * 2}k`];
  } else {
    const crf = { low: '23', recommended: '27', extreme: '32' }[opts.level || 'recommended'];
    vargs = ['-c:v', opts.codec === 'hevc' ? 'libx265' : 'libx264', '-preset', 'medium', '-crf', crf];
    if (opts.codec === 'hevc') vargs.push('-tag:v', 'hvc1');
  }
  const args = ['-i', p, '-map', '0:v:0', '-map', '0:a?', ...(vf.length ? ['-vf', vf.join(',')] : []), ...vargs, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out];
  await ffmpeg(args, ctx, info.duration, 'Compressing video');
  const before = (await fsp.stat(p)).size, after = (await fsp.stat(out)).size;
  if (after >= before) {
    await fsp.copyFile(p, out);
    return { path: out, note: 'This video is already smaller than that target. Saved an unchanged copy.' };
  }
  return { path: out, note: `${U.fmtBytes(before)} → ${U.fmtBytes(after)} (${Math.round((1 - after / before) * 100)}% smaller)` };
}
async function trim(p, opts, ctx) {
  const info = await probe(p);
  const start = parseTime(opts.start) || 0;
  const end = parseTime(opts.end) ?? info.duration;
  if (end <= start) throw new Error('The end time must be after the start time.');
  const e = U.ext(p);
  const out = ctx.out.file(p, `${U.base(p)}-trimmed.${e}`);
  let args;
  if (opts.precise) {
    // re-encode: frame-accurate cut points
    args = ['-i', p, '-ss', String(start), '-to', String(end)];
    if (info.video) args.push(...VIDEO.mp4(QUALITY.high)); else args.push(...(AUDIO[e] || AUDIO.m4a)('192k'));
  } else {
    // stream copy: instant and lossless, cuts snap to the nearest keyframe
    args = ['-ss', String(start), '-to', String(end), '-i', p, '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero'];
  }
  args.push(out);
  await ffmpeg(args, ctx, end - start, 'Trimming');
  return out;
}
async function merge(inputs, opts, ctx) {
  const infos = await Promise.all(inputs.map(probe));
  const hasVideo = infos.some((i) => i.video);
  const first = inputs[0];
  const dir = await U.tmpDir('merge');
  try {
    if (!hasVideo) {
      const to = opts.to || (AUDIO[U.ext(first)] ? U.ext(first) : 'mp3');
      const out = ctx.out.file(first, `${U.base(first)} - merged.${to}`);
      const args = [];
      inputs.forEach((p) => args.push('-i', p));
      const fc = `${inputs.map((_, i) => `[${i}:a]`).join('')}concat=n=${inputs.length}:v=0:a=1[a]`;
      args.push('-filter_complex', fc, '-map', '[a]', ...(AUDIO[to] || AUDIO.mp3)('192k'), out);
      await ffmpeg(args, ctx, infos.reduce((s, i) => s + i.duration, 0), 'Merging audio');
      return out;
    }
    const ref = infos.find((i) => i.video).video;
    const W = Math.round((ref.width || 1280) / 2) * 2, H = Math.round((ref.height || 720) / 2) * 2;
    const rate = Math.round(ref.fps || 30) || 30;
    const parts = [];
    const total = infos.reduce((s, i) => s + i.duration, 0);
    let doneDur = 0;
    for (let i = 0; i < inputs.length; i++) {
      const part = path.join(dir, `part${i}.mp4`);
      const inf = infos[i];
      const args = [];
      if (inf.video) args.push('-i', inputs[i]); else args.push('-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${rate}:d=${inf.duration}`, '-i', inputs[i]);
      if (!inf.audio) args.push('-f', 'lavfi', '-t', String(inf.duration || 1), '-i', 'anullsrc=r=48000:cl=stereo');
      const vIdx = 0;
      const aIdx = inf.video ? (inf.audio ? 0 : 1) : 1;
      args.push('-map', `${vIdx}:v:0`, '-map', `${aIdx}:a:0`,
        '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${rate}`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k', '-shortest', part);
      const sub = { progress: (f) => ctx.progress((doneDur + f * inf.duration) / total * 0.95, `Preparing clip ${i + 1} of ${inputs.length}`), signal: ctx.signal };
      await ffmpeg(args, sub, inf.duration);
      doneDur += inf.duration;
      parts.push(part);
    }
    const list = path.join(dir, 'list.txt');
    await fsp.writeFile(list, parts.map((x) => `file '${x.replace(/'/g, "'\\''")}'`).join('\n'));
    const out = ctx.out.file(first, `${U.base(first)} - merged.mp4`);
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], ctx, total, 'Joining clips');
    return out;
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function extractAudio(p, opts, ctx) {
  const info = await probe(p);
  if (!info.audio) throw new Error(`${path.basename(p)} has no audio track.`);
  const to = opts.to || 'mp3';
  const out = ctx.out.file(p, `${U.base(p)}.${to}`);
  const br = opts.bitrate || '192k';
  await ffmpeg(['-i', p, '-vn', '-map', '0:a:0', ...(AUDIO[to] || AUDIO.mp3)(br), out], ctx, info.duration, `Saving ${to.toUpperCase()}`);
  return out;
}
async function convertAudio(p, opts, ctx) {
  const info = await probe(p);
  if (!info.audio) throw new Error(`${path.basename(p)} has no audio.`);
  const to = opts.to || 'mp3';
  const out = ctx.out.file(p, `${U.base(p)}${U.ext(p) === to ? '-converted' : ''}.${to}`);
  const args = ['-i', p, '-vn', '-map', '0:a:0', ...(AUDIO[to] || AUDIO.mp3)(opts.bitrate || '192k')];
  if (opts.rate) args.push('-ar', String(opts.rate));
  if (opts.mono) args.push('-ac', '1');
  args.push('-map_metadata', '0', out);
  await ffmpeg(args, ctx, info.duration, `Converting to ${to.toUpperCase()}`);
  return out;
}
async function compressAudio(p, opts, ctx) {
  const br = { low: '192k', recommended: '128k', extreme: '64k' }[opts.level || 'recommended'];
  const e = ['mp3', 'm4a', 'ogg', 'opus', 'aac'].includes(U.ext(p)) ? U.ext(p) : 'mp3';
  const info = await probe(p);
  const out = ctx.out.file(p, `${U.base(p)}-compressed.${e}`);
  await ffmpeg(['-i', p, '-vn', ...(AUDIO[e] || AUDIO.mp3)(br), ...(opts.level === 'extreme' ? ['-ac', '1'] : []), out], ctx, info.duration, 'Compressing audio');
  return out;
}
async function simpleFilter(p, ctx, suffix, vf, af, label, extra = []) {
  const info = await probe(p);
  const e = U.ext(p);
  const out = ctx.out.file(p, `${U.base(p)}-${suffix}.${info.video ? (VIDEO[e] ? e : 'mp4') : e}`);
  const args = ['-i', p];
  if (vf && info.video) args.push('-vf', vf);
  if (af && info.audio) args.push('-af', af);
  if (info.video) args.push(...(VIDEO[e] || VIDEO.mp4)(QUALITY.high));
  else args.push(...(AUDIO[e] || AUDIO.mp3)('192k'));
  args.push(...extra, out);
  await ffmpeg(args, ctx, info.duration, label);
  return out;
}
async function mute(p, opts, ctx) {
  const info = await probe(p);
  const e = U.ext(p);
  const out = ctx.out.file(p, `${U.base(p)}-muted.${e}`);
  await ffmpeg(['-i', p, '-map', '0:v', '-c', 'copy', '-an', out], ctx, info.duration, 'Removing sound');
  return out;
}
async function resizeVideo(p, opts, ctx) {
  const h = Number(opts.height) || 720;
  return simpleFilter(p, ctx, `${h}p`, `scale=-2:${h}:flags=lanczos`, null, `Resizing to ${h}p`);
}
async function rotateVideo(p, opts, ctx) {
  const f = { 90: 'transpose=1', 180: 'transpose=1,transpose=1', 270: 'transpose=2' }[String(opts.angle || 90)] || '';
  const flip = opts.flip === 'horizontal' ? 'hflip' : opts.flip === 'vertical' ? 'vflip' : '';
  const vf = [f, flip].filter(Boolean).join(',') || 'null';
  return simpleFilter(p, ctx, 'rotated', vf, null, 'Rotating');
}
async function speed(p, opts, ctx) {
  const k = U.clamp(Number(opts.factor) || 2, 0.25, 4);
  const chain = [];
  let r = k;
  while (r > 2) { chain.push('atempo=2.0'); r /= 2; }
  while (r < 0.5) { chain.push('atempo=0.5'); r /= 0.5; }
  chain.push(`atempo=${r.toFixed(4)}`);
  return simpleFilter(p, ctx, `${k}x`, `setpts=PTS/${k}`, chain.join(','), `Changing speed to ${k}×`);
}
async function toGif(p, opts, ctx) {
  const info = await probe(p);
  const start = parseTime(opts.start) || 0;
  const dur = parseTime(opts.duration) || Math.min(info.duration - start, 15);
  const fpsv = Number(opts.fps) || 12;
  const width = Number(opts.width) || 480;
  const out = ctx.out.file(p, `${U.base(p)}.gif`);
  const vf = `fps=${fpsv},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  await ffmpeg(['-ss', String(start), '-t', String(dur), '-i', p, '-vf', vf, '-loop', '0', out], ctx, dur, 'Making GIF');
  return out;
}
async function frames(p, opts, ctx) {
  const info = await probe(p);
  const folder = ctx.out.folder(p, `${U.base(p)} - frames`);
  const fmt = opts.format === 'png' ? 'png' : 'jpg';
  const vf = opts.mode === 'count' ? `fps=${Math.max(1, Number(opts.count) || 10)}/${Math.max(0.1, info.duration)}` : `fps=1/${Math.max(0.04, Number(opts.every) || 1)}`;
  await ffmpeg(['-i', p, '-vf', vf, ...(fmt === 'jpg' ? ['-q:v', '2'] : []), path.join(folder, `frame-%04d.${fmt}`)], ctx, info.duration, 'Saving frames');
  return folder;
}
async function snapshot(p, opts, ctx) {
  const t = parseTime(opts.time) || 0;
  const out = ctx.out.file(p, `${U.base(p)} - ${String(opts.time || '0').replace(/:/g, '.')}s.png`);
  await U.run(U.binPath('ffmpeg'), ['-v', 'error', '-y', '-ss', String(t), '-i', p, '-frames:v', '1', out]);
  return out;
}
const subPath = (s) => s.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
async function burnSubtitles(p, opts, ctx) {
  if (!opts.subtitles) throw new Error('Choose a subtitle file (SRT, VTT or ASS).');
  const style = `FontName=Segoe UI,FontSize=${Number(opts.size) || 22},Outline=2,Shadow=0,MarginV=28`;
  return simpleFilter(p, ctx, 'subtitled', `subtitles='${subPath(opts.subtitles)}':force_style='${style}'`, null, 'Adding subtitles');
}
async function normalize(p, opts, ctx) {
  return simpleFilter(p, ctx, 'normalized', null, 'loudnorm=I=-16:TP=-1.5:LRA=11', 'Leveling loudness', []);
}
async function imagesToVideo(inputs, opts, ctx) {
  const secs = Number(opts.seconds) || 3;
  const [W, H] = (opts.size || '1920x1080').split('x').map(Number);
  const dir = await U.tmpDir('slides');
  try {
    const img = require('./image');
    const list = [];
    for (let i = 0; i < inputs.length; i++) {
      const f = path.join(dir, `s${String(i).padStart(4, '0')}.png`);
      await (await img.open(inputs[i])).rotate().resize(W, H, { fit: 'contain', background: '#000000' }).png().toFile(f);
      list.push(`file '${f.replace(/'/g, "'\\''")}'\nduration ${secs}`);
    }
    list.push(`file '${path.join(dir, `s${String(inputs.length - 1).padStart(4, '0')}.png`).replace(/'/g, "'\\''")}'`);
    const lf = path.join(dir, 'list.txt');
    await fsp.writeFile(lf, list.join('\n'));
    const out = ctx.out.file(inputs[0], 'Slideshow.mp4');
    const args = ['-f', 'concat', '-safe', '0', '-i', lf];
    if (opts.audio) args.push('-i', opts.audio, '-shortest');
    args.push('-vf', `fps=30,format=yuv420p`, '-c:v', 'libx264', '-crf', '20', ...(opts.audio ? ['-c:a', 'aac', '-b:a', '192k'] : []), '-movflags', '+faststart', out);
    await ffmpeg(args, ctx, secs * inputs.length, 'Rendering slideshow');
    return out;
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function imagesToGif(inputs, opts, ctx) {
  const dir = await U.tmpDir('gif');
  try {
    const img = require('./image');
    const W = Number(opts.width) || 600;
    for (let i = 0; i < inputs.length; i++) {
      await (await img.open(inputs[i])).rotate().resize(W, W, { fit: 'contain', background: '#ffffff' }).png().toFile(path.join(dir, `f${String(i).padStart(4, '0')}.png`));
    }
    const out = ctx.out.file(inputs[0], 'Animation.gif');
    const fr = 1 / (Number(opts.seconds) || 0.5);
    await ffmpeg(['-framerate', String(fr), '-i', path.join(dir, 'f%04d.png'), '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', out], ctx, inputs.length / fr, 'Making GIF');
    return out;
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function convertSubtitles(p, opts, ctx) {
  const to = opts.to || 'srt';
  const out = ctx.out.file(p, `${U.base(p)}.${to}`);
  await U.run(U.binPath('ffmpeg'), ['-v', 'error', '-y', '-i', p, out], { errorMessage: 'Couldn’t convert these subtitles' });
  return out;
}
async function thumbnail(p) {
  const info = await probe(p);
  if (!info.video) return null;
  const dir = await U.tmpDir('thumb');
  const out = path.join(dir, 't.jpg');
  await U.run(U.binPath('ffmpeg'), ['-v', 'error', '-y', '-ss', String(Math.min(1, info.duration / 3)), '-i', p, '-frames:v', '1', '-vf', 'scale=320:-2', out]);
  const b = await fsp.readFile(out);
  fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  return b;
}

module.exports = { probe, ffmpeg, parseTime, convertVideo, compressVideo, trim, merge, extractAudio, convertAudio, compressAudio, mute, resizeVideo, rotateVideo, speed, toGif, frames, snapshot, burnSubtitles, normalize, imagesToVideo, imagesToGif, convertSubtitles, thumbnail, VIDEO, AUDIO };
