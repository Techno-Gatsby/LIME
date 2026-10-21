'use strict';
const { spawnSync } = require('child_process');
const U = require('./util');
const { fs, fsp, path } = U;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ratio = (t, sep) => { const [a, b, x] = String(t ?? '').split(sep).map(Number); return x === undefined && b > 0 && Number.isFinite(a) ? a / b : 0; };
const aspectOf = (w, h, sar, turned) => (w > 0 && h > 0 ? (turned ? w / (h * sar) : (w * sar) / h) : 16 / 9);

function hasProbe() { const b = U.binPath('ffprobe'); return path.isAbsolute(b) && fs.existsSync(b); }
async function probeFf(p) {
  const { stderr } = await U.run(U.binPath('ffmpeg'), ['-hide_banner', '-i', p], { okCodes: [1], errorMessage: `Couldn’t read ${path.basename(p)}` });
  const t = (s) => { const m = /(\d+):(\d+):([\d.]+)/.exec(s || ''); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; };
  const dur = /Duration:\s*([\d:.]+|N\/A)(?:,.*?bitrate:\s*(\d+)\s*kb\/s)?/.exec(stderr) || [];
  const streams = [...stderr.matchAll(/Stream #\d+:(\d+)[^:]*: (Video|Audio|Subtitle): (\w+)([^\n]*)/g)].map((m) => ({ index: +m[1], type: m[2], codec: m[3], rest: m[4], pic: /attached pic/.test(m[4]) }));
  const v = streams.find((s) => s.type === 'Video' && !s.pic);
  const cover = streams.find((s) => s.type === 'Video' && s.pic && /^(mjpeg|png)$/.test(s.codec));
  const dims = v && /, (\d{2,5})x(\d{2,5})/.exec(v.rest);
  const rot = Number((/rotation of (-?[\d.]+) degrees/.exec(stderr) || /rotate\s*:\s*(-?\d+)/.exec(stderr) || [])[1] || 0);
  const turned = Math.abs(rot) % 180 === 90, sar = ratio((v && /SAR (\d+:\d+)/.exec(v.rest))?.[1], ':') || 1;
  const LAYOUT = { mono: 1, stereo: 2, '2.1': 3, quad: 4, '4.0': 4, '5.0': 5, '5.0(side)': 5, '5.1': 6, '5.1(side)': 6, '6.1': 7, '7.1': 8 };
  const audios = streams.filter((s) => s.type === 'Audio').map((s) => { const m = /(\d+) Hz, ([^,]+)/.exec(s.rest) || []; return { index: s.index, codec: s.codec, channels: LAYOUT[(m[2] || '').trim()] || parseInt(m[2], 10) || 2, rate: Number(m[1]) || 0 }; });
  const subs = streams.filter((s) => s.type === 'Subtitle').map((s) => ({ index: s.index, codec: s.codec, language: null }));
  const w = +dims?.[1], h = +dims?.[2];
  return {
    duration: t(dur[1]), size: (await fsp.stat(p)).size, bitrate: (Number(dur[2]) || 0) * 1000, format: null,
    video: v ? { codec: v.codec, width: turned ? h : w, height: turned ? w : h, fps: Number(/([\d.]+) (?:fps|tbr)/.exec(v.rest)?.[1]) || 0, pixFmt: /, ((?:yuv|nv|p0|gray|rgb|bgr|gbr|pal)\w*)/.exec(v.rest)?.[1] || null, sar, rotation: rot, color: null, aspect: aspectOf(w, h, sar, turned) } : null,
    audio: audios[0] || null, audios, cover: cover ? cover.index : null, subs, subtitles: subs.length,
  };
}
async function probe(p) {
  if (!hasProbe()) return probeFf(p);
  const { stdout } = await U.run(U.binPath('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', p], { errorMessage: `Couldn’t read ${path.basename(p)}` });
  const j = JSON.parse(stdout || '{}');
  const streams = Array.isArray(j.streams) ? j.streams : [];
  const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const cover = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic === 1 && ['mjpeg', 'png'].includes(s.codec_name));
  const audios = streams.filter((s) => s.codec_type === 'audio').map((s) => ({ index: s.index, codec: s.codec_name, channels: num(s.channels), rate: num(s.sample_rate) }));
  const subs = streams.filter((s) => s.codec_type === 'subtitle').map((s) => ({ index: s.index, codec: s.codec_name, language: s.tags?.language || null }));
  let video = null;
  if (v) {
    const sd = (v.side_data_list || []).find((d) => typeof d.rotation === 'number');
    const rotation = sd ? Math.round(sd.rotation) : parseInt(v.tags?.rotate, 10) || 0;
    const turned = Math.abs(rotation % 180) === 90, sar = ratio(v.sample_aspect_ratio, ':') || 1;
    const avg = ratio(v.avg_frame_rate, '/'), nom = ratio(v.r_frame_rate, '/');
    const known = (k) => (v[k] && v[k] !== 'unknown' ? v[k] : null);
    video = {
      codec: v.codec_name, width: turned ? v.height : v.width, height: turned ? v.width : v.height,
      fps: avg > 0 && avg < 1000 ? avg : nom > 0 && nom < 1000 ? nom : 0, pixFmt: v.pix_fmt || null, sar, rotation,
      color: { primaries: known('color_primaries'), transfer: known('color_transfer'), matrix: known('color_space') }, aspect: aspectOf(num(v.width), num(v.height), sar, turned),
    };
  }
  return {
    duration: num(j.format?.duration) || Math.max(0, ...streams.map((s) => num(s.duration))),
    size: num(j.format?.size),
    bitrate: num(j.format?.bit_rate),
    format: j.format?.format_long_name,
    video, audio: audios[0] || null, audios, cover: cover ? cover.index : null, subs, subtitles: subs.length,
  };
}

const lists = new Map();
function list(kind) {
  const bin = U.binPath('ffmpeg');
  let key = `${kind}|${bin}`;
  try { key += `|${fs.statSync(bin).mtimeMs}`; } catch (_) {}
  if (!lists.has(key)) {
    const r = spawnSync(bin, ['-hide_banner', `-${kind}`], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    const row = kind === 'encoders' ? (p) => p.length >= 2 && p[0].length === 6 && 'VAS'.includes(p[0][0]) && p[1] !== '=' : (p) => p.length >= 3 && /^[.TSC|]{3}$/.test(p[0]) && p[2].includes('->');
    lists.set(key, r.status === 0 ? new Set(r.stdout.split('\n').map((l) => l.trim().split(/\s+/)).filter(row).map((p) => p[1])) : null);
  }
  return lists.get(key);
}
const encoders = () => list('encoders');
const has = (e) => { const s = encoders(); return !s || s.has(e); };
const need = (e, name = e) => { if (!has(e)) throw new Error(`This FFmpeg has no ${name} encoder (${e}).`); return e; };

async function ffmpeg(args, ctx, duration, label, out) {
  const full = ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-nostats', '-progress', 'pipe:1', ...args];
  const ac = new AbortController();
  const abort = () => ac.abort();
  if (ctx?.signal?.aborted) ac.abort(); else ctx?.signal?.addEventListener('abort', abort, { once: true });
  let buf = '', err = '', seen = Date.now(), stalled = false;
  const watchdog = setInterval(() => { if (Date.now() - seen > 600000) { stalled = true; ac.abort(); } }, 5000);
  try {
    return await U.run(U.binPath('ffmpeg'), full, {
      signal: ac.signal,
      env: { SVT_LOG: '1' },
      onStderr: (s) => { seen = Date.now(); err = (err + s).slice(-8000); },
      onStdout: (s) => {
        seen = Date.now();
        const lines = (buf + s).split(/\r?\n/);
        buf = lines.pop();
        for (const l of lines) {
          const m = /^(out_time_us|out_time_ms|frame_time)=\s*([\d.]+)\s*$/.exec(l);
          if (m && duration > 0) ctx?.progress(Math.min(0.99, Number(m[2]) / (m[1] === 'frame_time' ? 1 : 1e6) / duration), label);
        }
      },
    });
  } catch (e) {
    if (out) await fsp.rm(out, { force: true }).catch(() => {});
    if (stalled) throw new Error('FFmpeg stopped responding (no progress for 10 minutes) and was stopped.');
    if (e.cancelled) throw e;
    throw new Error(summarize(err) || e.message);
  } finally {
    clearInterval(watchdog);
    ctx?.signal?.removeEventListener('abort', abort);
  }
}
function summarize(stderr) {
  const strip = (l) => { let e; while (l.startsWith('[') && (e = l.indexOf('] ')) > 0) l = l.slice(e + 2).trimStart(); return l; };
  return [...new Set(String(stderr).split('\n').map((l) => strip(l.trim())).filter(Boolean))].slice(-3).join(' ');
}
const part = (ctx, from, share) => ({ ...ctx, progress: (f, l) => ctx.progress(from + f * share, l) });
const parseTime = (t) => {
  if (t == null || t === '') return null;
  if (typeof t === 'number') return t;
  const parts = String(t).trim().split(':').map(Number);
  if (parts.some((x) => Number.isNaN(x))) throw new Error(`“${t}” isn’t a time. Use seconds (90) or mm:ss (1:30).`);
  return parts.reduce((acc, v) => acc * 60 + v, 0);
};

const T = (mux, v, a) => ({ mux, v, a });
const VIDEO_TARGETS = {
  mp4: T('mp4', 'libx264', 'aac'), m4v: T('mp4', 'libx264', 'aac'), mov: T('mov', 'libx264', 'aac'), mkv: T('matroska', 'libx264', 'aac'),
  flv: T('flv', 'libx264', 'aac'), ts: T('mpegts', 'libx264', 'aac'), m2ts: T('mpegts', 'libx264', 'aac'), '3gp': T('3gp', 'libx264', 'aac'), '3g2': T('3g2', 'libx264', 'aac'),
  webm: T('webm', 'libvpx-vp9', 'libopus'), avi: T('avi', 'mpeg4', 'libmp3lame'), wmv: T('asf', 'wmv2', 'wmav2'), mpg: T('vob', 'mpeg2video', 'mp2'),
  vob: T('dvd', 'mpeg2video', 'ac3'), ogv: T('ogg', 'libtheora', 'libvorbis'), dv: T('dv', 'dvvideo', 'pcm_s16le'), mxf: T('mxf', 'mpeg2video', 'pcm_s16le'),
};
const AUDIO_TARGETS = {
  mp3: T('mp3', null, 'libmp3lame'), m4a: T('ipod', null, 'aac'), m4b: T('ipod', null, 'aac'), aac: T('adts', null, 'aac'), wav: T('wav', null, 'pcm_s16le'),
  flac: T('flac', null, 'flac'), ogg: T('ogg', null, 'libvorbis'), opus: T('opus', null, 'libopus'), wma: T('asf', null, 'wmav2'), aiff: T('aiff', null, 'pcm_s16be'),
  ac3: T('ac3', null, 'ac3'), eac3: T('eac3', null, 'eac3'), amr: T('amr', null, 'libopencore_amrnb'), au: T('au', null, 'pcm_s16be'), caf: T('caf', null, 'pcm_s16be'),
  weba: T('webm', null, 'libopus'), mka: T('matroska', null, 'libopus'), mp2: T('mp2', null, 'mp2'), voc: T('voc', null, 'pcm_s16le'),
  wv: T('wv', null, 'wavpack'), tta: T('tta', null, 'tta'), w64: T('w64', null, 'pcm_s16le'),
};
const VIDEO_TO = { hevc: ['mp4', 'hevc'], av1: ['mp4', 'av1'] };
const AUDIO_TO = { alac: ['m4a', 'alac'] };
const REMUX = {
  mp4: [['h264', 'hevc'], ['aac', 'alac', 'ac3', 'eac3', 'mp3']],
  m4v: [['h264', 'hevc'], ['aac', 'alac', 'ac3', 'eac3', 'mp3']],
  mov: [['h264', 'hevc', 'prores'], ['aac', 'alac', 'ac3', 'eac3', 'mp3', 'pcm_s16le', 'pcm_s24le']],
  mkv: [['h264', 'hevc', 'vp9', 'av1'], ['aac', 'alac', 'ac3', 'eac3', 'mp3', 'opus', 'vorbis', 'flac']],
  webm: [['vp8', 'vp9', 'av1'], ['opus', 'vorbis']],
  ts: [['h264', 'hevc'], ['aac', 'ac3', 'eac3', 'mp3']],
  m2ts: [['h264', 'hevc'], ['aac', 'ac3', 'eac3']],
};
const APPLE = new Set(['mp4', 'm4v', 'mov', '3gp', '3g2']);
const PLAYABLE = new Set(['yuv420p', 'yuvj420p', 'yuv420p10le']);
const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'microdvd', 'sami', 'realtext', 'subviewer', 'subviewer1', 'jacosub', 'mpl2', 'pjs', 'vplayer', 'stl', 'eia_608']);
const MKV_SUBS = new Set(['subrip', 'ass', 'ssa', 'webvtt', 'hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle']);
const COVER_TARGETS = new Set(['mp3', 'm4a', 'm4b', 'flac']);
const LOSSLESS = new Set(['flac', 'alac', 'wavpack', 'tta']);
const CODEC_OF = { libmp3lame: 'mp3', libvorbis: 'vorbis', libopus: 'opus', libopencore_amrnb: 'amr_nb' };
const WAV_DEPTH = { 8: 'pcm_u8', 16: 'pcm_s16le', 24: 'pcm_s24le', 32: 'pcm_s32le', float: 'pcm_f32le' };
const BROADCAST = [[24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [50, 1], [60000, 1001], [60, 1]];
const MP3_BR = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP2_BR = [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
const AC3_BR = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640];

function supports(to) {
  if (to === 'gif' || to === 'apng') return has(to);
  const [t, c] = VIDEO_TO[to] || AUDIO_TO[to] || [to];
  const v = VIDEO_TARGETS[t], a = AUDIO_TARGETS[t];
  if (v) return (c === 'av1' ? has('libsvtav1') || has('libaom-av1') : has(c === 'hevc' ? 'libx265' : v.v)) && has(v.a);
  return a ? has(c || a.a) : true;
}
function videoEncoder(codec, def) {
  if (codec === 'hevc') return need('libx265', 'HEVC');
  if (codec === 'av1') { if (has('libsvtav1')) return 'libsvtav1'; return need('libaom-av1', 'AV1'); }
  return need(def);
}

const choose = (q, high, balanced, small) => (q === 'high' ? high : q === 'small' ? small : balanced);
function roundHalfEven(x) { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1; }
const even = (v) => Math.max(2, roundHalfEven(v / 2) * 2);
const scaleFilter = (h) => (h > 0 ? `scale=w=-2:h='trunc(min(ih,${Math.max(16, h)})/2)*2'` : "scale=w='trunc(iw/2)*2':h='trunc(ih/2)*2'");
const squarePixels = (v) => (Math.abs(v.sar - 1) > 0.01 ? "scale=w='trunc(iw*sar/2)*2':h=ih,setsar=1," : '');
const isPal = (fps) => Math.abs(fps - 25) < 0.5 || Math.abs(fps - 50) < 1 || Math.abs(fps - 12.5) < 0.3;
function dvdFilter(v, pal) {
  const height = pal ? 576 : 480, wide = v.aspect >= 1.55, fa = wide ? 16 / 9 : 4 / 3;
  const [w, h] = v.aspect > fa ? [720, even((height * fa) / v.aspect)] : [even((720 * v.aspect) / fa), height];
  return `scale=${w}:${h},pad=720:${height}:(ow-iw)/2:(oh-ih)/2:black,setdar=${wide ? '16/9' : '4/3'}`;
}
const rateText = ([n, d]) => (d === 1 ? String(n) : `${n}/${d}`);
function nearestRate(fps) {
  if (fps <= 0) return [];
  const r = BROADCAST.find(([n, d]) => Math.abs(fps - n / d) < 0.01);
  return ['-r', r ? rateText(r) : String(U.clamp(roundHalfEven(fps), 1, 120))];
}
const broadcastRate = (fps) => (fps > 0 ? rateText(BROADCAST.reduce((b, r) => (Math.abs(fps - r[0] / r[1]) < Math.abs(fps - b[0] / b[1]) ? r : b))) : '25');
function highBitDepth(v) {
  const p = v.pixFmt || '', c = v.color || {};
  const ten = /p1[0246]/.test(p) || /^(p01[026]|p21[06]|p41[06]|y21[02]|v210)/.test(p) || c.transfer === 'smpte2084' || c.transfer === 'arib-std-b67';
  return ['-pix_fmt', ten ? 'yuv420p10le' : 'yuv420p', ...(ten ? [['-color_primaries', c.primaries], ['-color_trc', c.transfer], ['-colorspace', c.matrix]].filter(([, x]) => x).flat() : [])];
}
function videoCodecArgs(target, enc, q, v, pal) {
  const qv = String(choose(q, 2, 4, 7));
  switch (enc) {
    case 'libx264': return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(choose(q, 18, 23, 28)), '-pix_fmt', 'yuv420p'];
    case 'libx265': return ['-c:v', 'libx265', '-preset', 'medium', '-crf', String(choose(q, 22, 26, 30)), ...highBitDepth(v), '-x265-params', 'log-level=error', ...(APPLE.has(target) ? ['-tag:v', 'hvc1'] : [])];
    case 'libsvtav1': return ['-c:v', 'libsvtav1', '-preset', '8', '-crf', String(choose(q, 26, 32, 40)), ...highBitDepth(v)];
    case 'libaom-av1': return ['-c:v', 'libaom-av1', '-b:v', '0', '-crf', String(choose(q, 26, 32, 40)), '-usage', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-tiles', '2x2', ...highBitDepth(v)];
    case 'libvpx-vp9': return ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(choose(q, 24, 32, 38)), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p'];
    case 'mpeg4': return ['-c:v', 'mpeg4', '-tag:v', 'XVID', '-q:v', qv, '-g', '250', '-bf', '2', '-pix_fmt', 'yuv420p', ...nearestRate(v.fps)];
    case 'wmv2': return ['-c:v', 'wmv2', '-q:v', qv, '-g', '250', '-pix_fmt', 'yuv420p', ...nearestRate(v.fps)];
    case 'libtheora': return ['-c:v', 'libtheora', '-q:v', String(choose(q, 8, 6, 4)), '-pix_fmt', 'yuv420p', ...nearestRate(v.fps)];
    case 'mpeg2video':
      if (target === 'vob') return ['-c:v', 'mpeg2video', '-b:v', `${choose(q, 8000, 6000, 4000)}k`, '-maxrate', '9000k', '-minrate', '0', '-bufsize', '1835k', '-g', pal ? '15' : '18', '-bf', '2', '-pix_fmt', 'yuv420p', '-r', pal ? '25' : '30000/1001'];
      return ['-c:v', 'mpeg2video', '-q:v', qv, '-g', '15', '-bf', '2', '-pix_fmt', 'yuv420p', '-r', broadcastRate(v.fps)];
    case 'dvvideo': return ['-c:v', 'dvvideo', '-pix_fmt', pal ? 'yuv420p' : 'yuv411p', '-r', pal ? '25' : '30000/1001'];
    default: throw new Error(`Lime can’t encode ${enc}.`);
  }
}
const scaled = (stereo, ch) => Math.trunc((stereo * U.clamp(ch, 1, 8)) / 2);
const br = (k, min, max) => ['-b:a', `${U.clamp(k, min, Math.max(min, max))}k`];
const snap = (k, list) => list.filter((x) => x <= k).pop() ?? list[0];
function audioCodecArgs(target, enc, o, a, inVideo) {
  const q = o.quality, req = o.kbps || 0, ch = a.channels > 0 ? a.channels : 2;
  const args = ['-c:a', enc];
  switch (enc) {
    case 'aac': args.push(...br(req || scaled(choose(q, 256, 192, 128), ch), 16, 256 * ch)); break;
    case 'libopus': args.push(...br(req || scaled(choose(q, 160, 128, 64), ch), 6, 256 * ch)); break;
    case 'libmp3lame': args.push(...(req || inVideo ? br(snap(req || choose(q, 256, 192, 128), MP3_BR), 32, 320) : ['-q:a', String(choose(q, 0, 2, 5))])); break;
    case 'libvorbis': args.push(...(req ? br(req, 32, 500) : ['-q:a', String(choose(q, 6, 4, 2))])); break;
    case 'wmav2': args.push(...br(req || choose(q, 192, 128, 96), 32, 320), ...(ch > 2 ? ['-ac', '2'] : [])); break;
    case 'mp2': args.push(...br(snap(req || choose(q, 320, 224, 160), MP2_BR), 32, 384), ...(a.rate > 0 && a.rate < 32000 ? ['-ar', '32000'] : [])); break;
    case 'ac3':
      if (target === 'vob') args.push(...br(snap(req || (ch > 2 ? 448 : 192), AC3_BR), 64, 448), '-ar', '48000');
      else if (req) args.push(...br(snap(req, AC3_BR), 32, 640));
      break;
    case 'eac3': args.push(...br(req || scaled(choose(q, 256, 192, 128), ch), 32, 6144)); break;
    case 'flac': args.push('-compression_level', '8'); break;
    case 'libopencore_amrnb': args.push('-ar', '8000', '-ac', '1', '-b:a', '12.2k'); break;
    case 'pcm_s16le':
      if (target === 'dv') args.push('-ar', '48000', '-ac', '2');
      else if (target === 'mxf') args.push('-ar', '48000');
      else if (target === 'voc' && ch > 2) args.push('-ac', '2');
      break;
  }
  return args;
}
function channelAndRateArgs(target, enc, o, rate) {
  const args = o.channels && enc !== 'libopencore_amrnb' ? ['-ac', String(o.channels)] : [];
  if ((target === 'wav' || target === 'w64') && o.rate >= 8000 && o.rate <= 192000) args.push('-ar', String(o.rate));
  else if (rate > 192000 && (LOSSLESS.has(enc) || enc.startsWith('pcm_'))) args.push('-ar', '88200');
  else if (rate > 192000 && (enc === 'libvorbis' || enc === 'wmav2')) args.push('-ar', '44100');
  return args;
}
function containerArgs(t) {
  if (APPLE.has(t) || t === 'm4a' || t === 'm4b') return ['-movflags', '+faststart'];
  return { m2ts: ['-mpegts_m2ts_mode', '1'], vob: ['-muxrate', '10080000', '-packetsize', '2048'], mp3: ['-id3v2_version', '3'], wav: ['-rf64', 'auto'] }[t] || [];
}
const metadataArgs = (from = 0) => ['-map_metadata', String(from), '-metadata', 'major_brand=', '-metadata', 'minor_version=', '-metadata', 'compatible_brands='];
const perStream = (args, i) => args.map((x) => (/^-[cbq]:a$/.test(x) ? `${x}:${i}` : x === '-ac' || x === '-ar' ? `${x}:a:${i}` : x));
function subtitleArgs(target, subs) {
  const mkv = target === 'mkv', apple = APPLE.has(target);
  const keep = subs.filter((s) => (mkv && MKV_SUBS.has(s.codec)) || (TEXT_SUBS.has(s.codec) && (mkv || apple || target === 'webm')));
  const codec = (s) => (mkv ? (MKV_SUBS.has(s.codec) ? 'copy' : 'srt') : apple ? (s.codec === 'mov_text' ? 'copy' : 'mov_text') : s.codec === 'webvtt' ? 'copy' : 'webvtt');
  return keep.length ? keep.flatMap((s, i) => ['-map', `0:${s.index}`, `-c:s:${i}`, codec(s)]) : ['-sn'];
}
const mediaOpts = (opts) => ({ quality: opts.quality || 'balanced', height: Number(opts.height) || 0, kbps: parseInt(opts.bitrate, 10) || 0, channels: opts.mono ? 1 : 0, rate: Number(opts.rate) || 0, depth: opts.depth });

function canCopyVideo(target, codec, v, o) {
  if (o.reencode || o.vf || o.quality === 'small' || (o.height > 0 && v.height > Math.max(16, o.height)) || !REMUX[target]) return false;
  const takes = codec === 'hevc' || codec === 'av1' ? v.codec === codec : REMUX[target][0].includes(v.codec);
  return takes && (v.codec === 'prores' || PLAYABLE.has(v.pixFmt));
}
const canCopyAudio = (target, a, o) => !o.reencode && !o.af && o.quality !== 'small' && !o.kbps && !!REMUX[target]?.[1].includes(a.codec);
function videoStream(target, codec, v, o) {
  if (canCopyVideo(target, codec, v, o)) return { copy: true, args: ['-c:v', 'copy', ...(v.codec === 'hevc' && APPLE.has(target) ? ['-tag:v', 'hvc1'] : [])] };
  const pal = isPal(v.fps);
  return { copy: false, args: ['-vf', [o.vf, target === 'vob' || target === 'dv' ? dvdFilter(v, pal) : scaleFilter(o.height)].filter(Boolean).join(','), ...videoCodecArgs(target, videoEncoder(codec, VIDEO_TARGETS[target].v), o.quality, v, pal)] };
}
const videoTail = (target, out) => [...metadataArgs(), ...containerArgs(target), '-max_muxing_queue_size', '4096', '-f', VIDEO_TARGETS[target].mux, out];
function videoArgs(p, out, target, codec, o, info) {
  const tracks = REMUX[target] ? info.audios : info.audios.slice(0, 1);
  const { args: vargs, copy } = videoStream(target, codec, info.video, o);
  const args = [...(o.pre || []), '-i', p, ...(o.extra || []), '-map', '0:V:0', ...tracks.flatMap((a) => ['-map', `0:${a.index}`]), ...vargs];
  if (!tracks.length) args.push('-an');
  else if (o.af) args.push('-af', o.af);
  tracks.forEach((a, i) => args.push(...perStream(canCopyAudio(target, a, o) ? ['-c:a', 'copy'] : audioCodecArgs(target, need(VIDEO_TARGETS[target].a), o, a, true), i)));
  args.push(...(o.subs === false ? ['-sn'] : subtitleArgs(target, info.subs)), ...videoTail(target, out));
  return { args, copy };
}
function audioArgs(p, out, target, want, o, info, extras) {
  const spec = AUDIO_TARGETS[target], a = info.audio;
  const args = [...(o.pre || []), '-i', p, ...(extras?.meta ? ['-i', extras.meta] : []), ...(o.extra || []), '-map', `0:${a.index}`];
  if (info.cover != null && COVER_TARGETS.has(target) && o.cover !== false) args.push('-map', `0:${info.cover}`, '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
  if (extras?.attach) args.push('-attach', extras.attach, '-metadata:s:t', `mimetype=${extras.mime}`, '-metadata:s:t', `filename=${path.basename(extras.attach)}`);
  const enc = need(target === 'wav' || target === 'w64' ? WAV_DEPTH[o.depth] || 'pcm_s16le' : want || spec.a, target.toUpperCase());
  const copy = !o.reencode && !o.af && o.quality !== 'small' && !o.kbps && (!o.channels || o.channels === a.channels) && (!o.rate || o.rate === a.rate)
    && (a.codec === (CODEC_OF[enc] || enc) || (target === 'mka' && REMUX.mkv[1].includes(a.codec)));
  if (o.af) args.push('-af', o.af);
  args.push(...(copy ? ['-c:a', 'copy'] : [...audioCodecArgs(target, enc, o, a, false), ...channelAndRateArgs(target, enc, o, a.rate)]));
  args.push(...metadataArgs(extras?.meta ? 1 : 0), ...containerArgs(target), '-f', spec.mux, out);
  return args;
}
async function coverExtras(p, info, target) {
  if (info.cover == null || !['ogg', 'opus', 'mka'].includes(target)) return null;
  const dir = await U.tmpDir('cover');
  try {
    const raw = path.join(dir, 'cover.bin');
    await U.run(U.binPath('ffmpeg'), ['-v', 'error', '-y', '-i', p, '-map', `0:${info.cover}`, '-c', 'copy', '-frames:v', '1', '-f', 'image2', raw]);
    const img = await fsp.readFile(raw);
    const mime = img[0] === 0xff && img[1] === 0xd8 ? 'image/jpeg' : img.subarray(1, 4).toString() === 'PNG' ? 'image/png' : null;
    if (!mime) return { dir };
    const pic = path.join(dir, mime === 'image/png' ? 'cover.png' : 'cover.jpg');
    await fsp.rename(raw, pic);
    if (target === 'mka') return { dir, attach: pic, mime };
    const meta = path.join(dir, 'metadata.txt');
    await U.run(U.binPath('ffmpeg'), ['-v', 'error', '-y', '-i', p, '-f', 'ffmetadata', meta]);
    const { width, height } = await require('sharp')(img).metadata();
    const m = Buffer.from(mime), block = Buffer.alloc(32 + m.length + img.length);
    let at = 0;
    const int = (x) => { at = block.writeUInt32BE(x, at); };
    int(3); int(m.length); at += m.copy(block, at); int(0); int(width); int(height); int(24); int(0); int(img.length); img.copy(block, at);
    const lines = (await fsp.readFile(meta, 'utf8')).split(/\r?\n/);
    lines.splice(Math.min(1, lines.length), 0, `METADATA_BLOCK_PICTURE=${block.toString('base64').replace(/[=;#\\]/g, '\\$&')}`);
    await fsp.writeFile(meta, `${lines.join('\n')}\n`);
    return { dir, meta };
  } catch (_) { return { dir }; }
}
async function encodeAudio(p, out, to, opts, ctx, info, label) {
  const [target, want] = AUDIO_TO[to] || [to];
  const o = { ...mediaOpts(opts), ...opts.o };
  const extras = o.cover === false ? null : await coverExtras(p, info, target);
  try {
    await ffmpeg(audioArgs(p, out, target, want, o, info, extras), ctx, info.duration, label, out);
  } finally { if (extras) fsp.rm(extras.dir, { recursive: true, force: true }).catch(() => {}); }
  return out;
}
async function audioOut(p, opts, ctx) {
  const to = opts.to || 'mp3';
  const target = (AUDIO_TO[to] || [to])[0];
  if (!AUDIO_TARGETS[target]) throw new Error(`Lime can’t save ${to.toUpperCase()} audio.`);
  const info = await probe(p);
  if (!info.audio) throw new Error(`${path.basename(p)} has no audio track.`);
  const out = ctx.out.file(p, `${U.base(p)}${U.ext(p) === target ? '-converted' : ''}.${target}`);
  return encodeAudio(p, out, to, opts, ctx, info, `Saving ${to.toUpperCase()}`);
}
const VIDEO_ALIAS = { mpeg: 'mpg', vob: 'mpg', mts: 'm2ts', asf: 'wmv', f4v: 'mp4', divx: 'avi' };
const AUDIO_ALIAS = { aif: 'aiff', oga: 'ogg' };
function sameKind(p, info) {
  const e = U.ext(p);
  if (info.video) {
    const t = VIDEO_ALIAS[e] || (VIDEO_TARGETS[e] && e !== 'dv' ? e : 'mp4');
    return supports(t) ? { target: t, ext: VIDEO_ALIAS[e] ? e : t } : { target: 'mp4', ext: 'mp4' };
  }
  const t = AUDIO_ALIAS[e] || (AUDIO_TARGETS[e] ? e : 'mp3');
  return supports(t) ? { target: t, ext: AUDIO_ALIAS[e] ? e : t } : { target: 'mp3', ext: 'mp3' };
}
async function filtered(p, info, out, o, ctx, duration, label) {
  const { target } = sameKind(p, info);
  if (info.video) await ffmpeg(videoArgs(p, out, target, 'default', { quality: 'high', ...o }, info).args, ctx, duration, label, out);
  else await encodeAudio(p, out, target, { quality: 'high', o }, ctx, { ...info, duration }, label);
  return out;
}

async function convertVideo(p, opts, ctx) {
  const to = opts.to || 'mp4';
  if (to === 'gif' || to === 'apng') return toGif(p, { ...opts, format: to }, ctx);
  const [target, codec] = VIDEO_TO[to] || [to, 'default'];
  if (!VIDEO_TARGETS[target]) return audioOut(p, { ...opts, to }, ctx);
  const info = await probe(p);
  if (!info.video) throw new Error(`${path.basename(p)} has no video track. Use Convert audio instead.`);
  const out = ctx.out.file(p, `${U.base(p)}${U.ext(p) === target ? '-converted' : ''}.${target}`);
  const { args, copy } = videoArgs(p, out, target, codec, mediaOpts(opts), info);
  await ffmpeg(args, ctx, info.duration, copy ? `Rewrapping as ${to.toUpperCase()}` : `Converting to ${to.toUpperCase()}`, out);
  return copy ? { path: out, note: 'Rewrapped without re-encoding the video.' } : out;
}
async function compressVideo(p, opts, ctx) {
  const info = await probe(p);
  if (!info.video) throw new Error('This file has no video track.');
  const out = ctx.out.file(p, `${U.base(p)}-compressed.mp4`);
  let vargs;
  if (opts.mode === 'size' && Number(opts.targetMB) > 0) {
    const audioK = 96;
    const totalK = (Number(opts.targetMB) * 8192) / Math.max(1, info.duration);
    const vk = Math.max(100, Math.floor(totalK - audioK - 10));
    vargs = ['-c:v', 'libx264', '-preset', 'medium', '-b:v', `${vk}k`, '-maxrate', `${Math.round(vk * 1.3)}k`, '-bufsize', `${vk * 2}k`];
  } else {
    const crf = { low: '23', recommended: '27', extreme: '32' }[opts.level || 'recommended'];
    vargs = ['-c:v', opts.codec === 'hevc' ? 'libx265' : 'libx264', '-preset', 'medium', '-crf', crf];
    if (opts.codec === 'hevc') vargs.push('-tag:v', 'hvc1', '-x265-params', 'log-level=error');
  }
  const args = ['-i', p, '-map', '0:V:0', '-map', '0:a?', '-vf', scaleFilter(Number(opts.height) || 0), ...vargs, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out];
  await ffmpeg(args, ctx, info.duration, 'Compressing video', out);
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
  if (opts.precise) {
    const out = ctx.out.file(p, `${U.base(p)}-trimmed.${sameKind(p, info).ext}`);
    return filtered(p, info, out, { extra: ['-ss', String(start), '-to', String(end)], reencode: true }, ctx, end - start, 'Trimming');
  }
  const out = ctx.out.file(p, `${U.base(p)}-trimmed.${U.ext(p)}`);
  await ffmpeg(['-ss', String(start), '-to', String(end), '-i', p, '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', out], ctx, end - start, 'Trimming', out);
  return out;
}
async function merge(inputs, opts, ctx) {
  const infos = await Promise.all(inputs.map(probe));
  const hasVideo = infos.some((i) => i.video);
  const first = inputs[0];
  const dir = await U.tmpDir('merge');
  try {
    if (!hasVideo) {
      const to = opts.to || (AUDIO_TARGETS[U.ext(first)] ? U.ext(first) : 'mp3');
      const spec = AUDIO_TARGETS[to] || AUDIO_TARGETS.mp3;
      const out = ctx.out.file(first, `${U.base(first)} - merged.${to}`);
      const args = [];
      inputs.forEach((p) => args.push('-i', p));
      const fc = `${inputs.map((_, i) => `[${i}:a]`).join('')}concat=n=${inputs.length}:v=0:a=1[a]`;
      args.push('-filter_complex', fc, '-map', '[a]', ...audioCodecArgs(to, spec.a, { quality: 'high' }, { channels: Math.max(...infos.map((i) => i.audio?.channels || 2)) }, false), ...containerArgs(to), '-f', spec.mux, out);
      await ffmpeg(args, ctx, infos.reduce((s, i) => s + i.duration, 0), 'Merging audio', out);
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
      args.push('-map', `${vIdx}:V:0`, '-map', `${aIdx}:a:0`,
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
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], ctx, total, 'Joining clips', out);
    return out;
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const extractAudio = (p, opts, ctx) => audioOut(p, opts, ctx);
const convertAudio = (p, opts, ctx) => audioOut(p, opts, ctx);
async function compressAudio(p, opts, ctx) {
  const br = { low: '192k', recommended: '128k', extreme: '64k' }[opts.level || 'recommended'];
  const e = ['mp3', 'm4a', 'ogg', 'opus', 'aac'].includes(U.ext(p)) ? U.ext(p) : 'mp3';
  const info = await probe(p);
  if (!info.audio) throw new Error(`${path.basename(p)} has no audio.`);
  const out = ctx.out.file(p, `${U.base(p)}-compressed.${e}`);
  return encodeAudio(p, out, e, { bitrate: br, mono: opts.level === 'extreme' }, ctx, info, 'Compressing audio');
}
async function simpleFilter(p, ctx, suffix, vf, af, label, o = {}) {
  const info = await probe(p);
  const out = ctx.out.file(p, `${U.base(p)}-${suffix}.${sameKind(p, info).ext}`);
  return filtered(p, info, out, { vf: info.video ? vf : null, af: info.audio ? af : null, ...o }, ctx, info.duration, label);
}
async function mute(p, opts, ctx) {
  const info = await probe(p);
  const e = U.ext(p);
  const out = ctx.out.file(p, `${U.base(p)}-muted.${e}`);
  await ffmpeg(['-i', p, '-map', '0:v', '-c', 'copy', '-an', out], ctx, info.duration, 'Removing sound', out);
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
  return simpleFilter(p, ctx, `${k}x`, `setpts=PTS/${k}`, chain.join(','), `Changing speed to ${k}×`, { subs: false });
}
async function toGif(p, opts, ctx) {
  const info = await probe(p);
  if (!info.video) throw new Error(`${path.basename(p)} has no video track.`);
  const apng = opts.format === 'apng', q = opts.quality || 'balanced', h = Number(opts.height) || 0;
  const start = parseTime(opts.start) || 0;
  const dur = parseTime(opts.duration) || Math.max(0.1, Math.min(info.duration - start, 15));
  const chain = `fps=${Number(opts.fps) || choose(q, 15, 12, 10)},${squarePixels(info.video)}scale=w='min(iw,${Number(opts.width) || choose(q, 640, 480, 320)})':h=${h ? `'min(ih,${Math.max(16, h)})'` : 'ih'}:force_original_aspect_ratio=decrease:flags=lanczos`;
  const input = ['-ss', String(start), '-t', String(dur), '-i', p];
  const out = ctx.out.file(p, `${U.base(p)}.${apng ? 'png' : 'gif'}`);
  if (apng) {
    await ffmpeg([...input, '-map', '0:V:0', '-vf', chain, '-an', '-c:v', 'apng', '-pix_fmt', 'rgb24', '-pred', 'mixed', '-plays', '0', '-f', 'apng', out], ctx, dur, 'Making APNG', out);
    return out;
  }
  const dir = await U.tmpDir('gif');
  const palette = path.join(dir, 'palette.png');
  try {
    await ffmpeg([...input, '-filter_complex', `[0:V:0]${chain},split[a][b];[a]palettegen=max_colors=${choose(q, 256, 256, 128)}[p]`, '-map', '[p]', '-frames:v', '1', '-update', '1', '-f', 'image2', palette,
      '-map', '[b]', '-stats_enc_pre', 'pipe:1', '-stats_enc_pre_fmt', 'frame_time={t}', '-f', 'null', '-'], part(ctx, 0, 0.4), dur, 'Making GIF');
    await ffmpeg([...input, '-i', palette, '-filter_complex', `[0:V:0]${chain}[f];[f][1:v]paletteuse=dither=${choose(q, 'sierra2_4a', 'bayer:bayer_scale=4', 'bayer:bayer_scale=5')}:diff_mode=rectangle[g]`,
      '-map', '[g]', '-loop', '0', '-f', 'gif', out], part(ctx, 0.4, 0.6), dur, 'Making GIF', out);
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
  return out;
}
async function frames(p, opts, ctx) {
  const info = await probe(p);
  const v = info.video;
  if (!v) throw new Error('This file has no video track.');
  const fmt = opts.format === 'png' ? 'png' : 'jpg';
  const all = opts.mode === 'all', count = all ? Math.ceil(info.duration * v.fps) : 0;
  if (count > 100000) throw new Error(`This video has about ${count.toLocaleString('en-US')} frames, more than the 100,000 Lime saves at once. Save one every few seconds instead.`);
  const folder = ctx.out.folder(p, `${U.base(p)} - frames`);
  const hadFiles = (await fsp.readdir(folder).catch(() => [])).length > 0;
  let stage;
  try {
    if (count) {
      const st = await fsp.statfs(folder), need = Math.max(1, v.width * v.sar) * Math.max(1, v.height) * (fmt === 'png' ? 1.5 : 0.25) * count;
      if (need > st.bavail * st.bsize) throw new Error(`Not enough free disk space for the pictures (about ${U.fmtBytes(need)} needed).`);
    }
    stage = await fsp.mkdtemp(path.join(folder, '.lime-frames-'));
    const vf = all ? 'null' : opts.mode === 'count' ? `fps=${Math.max(1, Number(opts.count) || 10)}/${Math.max(0.1, info.duration)}` : `fps=1/${Math.max(0.04, Number(opts.every) || 1)}`;
    await ffmpeg(['-i', p, '-map', '0:V:0', '-vf', squarePixels(v) + vf, ...(all ? ['-fps_mode', 'passthrough'] : []), ...(fmt === 'jpg' ? ['-q:v', '2'] : []), '-f', 'image2', path.join(stage.replace(/%/g, '%%'), `frame-%06d.${fmt}`)], ctx, info.duration, 'Saving frames');
    const list = (await fsp.readdir(stage)).sort();
    if (!list.length) throw new Error('FFmpeg did not write any frames.');
    for (const f of list) await fsp.rename(path.join(stage, f), U.uniquePath(path.join(folder, f)));
  } catch (e) {
    if (!hadFiles) await fsp.rm(folder, { recursive: true, force: true }).catch(() => {});
    throw e;
  } finally { if (stage) await fsp.rm(stage, { recursive: true, force: true }).catch(() => {}); }
  return folder;
}
async function extractSubtitles(p, opts, ctx) {
  const to = opts.to || 'srt';
  const info = await probe(p);
  const s = info.subs.find((x) => TEXT_SUBS.has(x.codec));
  if (!s) throw new Error(info.subs.length ? 'This video’s subtitles are pictures (Blu-ray, DVD or DVB), not text, so they can’t be saved as text.' : 'This video has no subtitle track.');
  const [mux, enc, same] = { srt: ['srt', 'srt', ['subrip', 'srt']], ass: ['ass', 'ass', ['ass']], vtt: ['webvtt', 'webvtt', ['webvtt']] }[to];
  const out = ctx.out.file(p, `${U.base(p)}.${to}`);
  await ffmpeg(['-i', p, '-map', `0:${s.index}`, '-c:s', same.includes(s.codec) ? 'copy' : enc, '-f', mux, out], ctx, info.duration, 'Saving subtitles', out);
  return out;
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
  const style = `FontName=Helvetica Neue,FontSize=${Number(opts.size) || 22},Outline=2,Shadow=0,MarginV=28`;
  return simpleFilter(p, ctx, 'subtitled', `subtitles='${subPath(opts.subtitles)}':force_style='${style}'`, null, 'Adding subtitles');
}
async function normalize(p, opts, ctx) {
  const rate = (await probe(p)).audio?.rate || 48000, target = 'I=-16:TP=-1.5:LRA=11';
  ctx?.progress?.(0, 'Measuring loudness');
  const { stderr } = await U.run(U.binPath('ffmpeg'), ['-hide_banner', '-nostats', '-i', p, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { signal: ctx?.signal, errorMessage: 'Couldn’t measure the loudness' });
  const sum = stderr.slice(stderr.lastIndexOf('Summary:')), num = (re) => Number(re.exec(sum)?.[1]);
  const m = { I: num(/I:\s+(-?[\d.]+) LUFS/), thresh: num(/Threshold:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
  const measured = Object.values(m).every(Number.isFinite) && m.I > -70 ? `:measured_I=${m.I}:measured_TP=${m.TP}:measured_LRA=${m.LRA}:measured_thresh=${m.thresh}:offset=0:linear=true` : '';
  return simpleFilter(p, ctx, 'normalized', null, `loudnorm=${target}${measured},aformat=sample_rates=${rate}`, 'Leveling loudness');
}
const evenDown = (x) => Math.max(2, Math.floor(x / 2) * 2);
async function videoOnly(p) {
  const info = await probe(p);
  if (!info.video) throw new Error(`${path.basename(p)} has no video track.`);
  return info;
}
async function soundOnly(p) {
  const info = await probe(p);
  if (!info.audio) throw new Error(`${path.basename(p)} has no audio track.`);
  return info;
}
async function cropVideo(p, opts, ctx) {
  const { video: v } = await videoOnly(p);
  let vf;
  if (opts.aspect === 'custom') {
    const x = U.clamp(Math.round(Number(opts.left) || 0), 0, v.width - 2), y = U.clamp(Math.round(Number(opts.top) || 0), 0, v.height - 2);
    vf = `crop=${evenDown(Math.min(Number(opts.width) || v.width, v.width - x))}:${evenDown(Math.min(Number(opts.height) || v.height, v.height - y))}:${x}:${y}`;
  } else {
    const [a, b] = String(opts.aspect || '1:1').split(':').map(Number);
    vf = `crop=w='trunc(min(iw,ih*${a}/${b})/2)*2':h='trunc(min(ih,iw*${b}/${a})/2)*2'`;
  }
  return simpleFilter(p, ctx, 'cropped', vf, null, 'Cropping');
}
async function addAudio(files, opts, ctx) {
  const infos = await Promise.all(files.slice(0, 2).map(probe));
  let vi = infos.findIndex((i, k) => i.video && U.groupOf(files[k]) === 'video');
  if (vi < 0) vi = infos.findIndex((i) => i.video);
  if (vi < 0 || files.length < 2) throw new Error('Choose a video and an audio file.');
  const p = files[vi], v = infos[vi], a = infos[1 - vi].audio, mix = opts.mode === 'mix' && v.audio;
  if (!a) throw new Error(`${path.basename(files[1 - vi])} has no audio track.`);
  const { target, ext } = sameKind(p, v), o = { quality: 'high' }, enc = need(VIDEO_TARGETS[target].a);
  const out = ctx.out.file(p, `${U.base(p)}-with-audio.${ext}`);
  const args = ['-i', p, '-i', files[1 - vi], '-map', '0:V:0'];
  if (mix) args.push('-filter_complex', `[0:${v.audio.index}][1:${a.index}]amix=inputs=2:duration=${opts.shortest ? 'shortest' : 'first'}:dropout_transition=0[a]`, '-map', '[a]', ...audioCodecArgs(target, enc, o, { channels: Math.max(v.audio.channels, a.channels) }, true));
  else args.push('-map', `1:${a.index}`, ...(REMUX[target]?.[1].includes(a.codec) ? ['-c:a', 'copy'] : audioCodecArgs(target, enc, o, a, true)));
  args.push(...videoStream(target, 'default', v.video, o).args, ...(opts.shortest ? ['-shortest'] : ['-t', String(v.duration)]), ...videoTail(target, out));
  await ffmpeg(args, ctx, v.duration, mix ? 'Mixing in audio' : 'Replacing audio', out);
  return out;
}
async function loop(p, opts, ctx) {
  const info = await probe(p);
  const n = U.clamp(Math.round(Number(opts.times) || 2), 2, 50);
  const out = ctx.out.file(p, `${U.base(p)}-looped.${sameKind(p, info).ext}`);
  return filtered(p, info, out, { pre: ['-stream_loop', String(n - 1)], reencode: true, subs: false, cover: false }, ctx, info.duration * n, `Looping ${n}×`);
}
async function volume(p, opts, ctx) {
  await soundOnly(p);
  const gain = opts.unit === 'percent' ? (U.clamp(Number(opts.percent) || 100, 0, 1000) / 100).toFixed(3) : `${U.clamp(Number(opts.db) || 0, -60, 60)}dB`;
  return simpleFilter(p, ctx, 'volume', null, `volume=${gain},alimiter=limit=0.95:level=0`, 'Changing volume');
}
async function reverse(p, opts, ctx) {
  const info = await probe(p), v = info.video, a = info.audio;
  const bytes = info.duration * ((v ? v.width * v.height * 1.5 * (v.fps || 30) : 0) + (a ? a.rate * a.channels * 4 : 0));
  if (bytes > 2 ** 31) throw new Error(`This clip is too long to reverse in one go (it needs about ${U.fmtBytes(bytes)} of memory). Trim it into shorter parts first.`);
  return simpleFilter(p, ctx, 'reversed', v ? 'reverse' : null, a ? 'areverse' : null, 'Reversing', { subs: false });
}
async function fade(p, opts, ctx) {
  const info = await soundOnly(p);
  const fin = Math.max(0, Number(opts.fadeIn) || 0), fout = Math.max(0, Number(opts.fadeOut) || 0);
  const af = [fin && `afade=t=in:st=0:d=${fin}`, fout && `afade=t=out:st=${Math.max(0, info.duration - fout).toFixed(3)}:d=${fout}`].filter(Boolean).join(',') || 'anull';
  return simpleFilter(p, ctx, 'faded', null, af, 'Fading');
}
async function pitch(p, opts, ctx) {
  const info = await soundOnly(p);
  const n = U.clamp(Math.round(Number(opts.semitones) || 0), -12, 12), f = 2 ** (n / 12), r = info.audio.rate || 44100;
  const af = list('filters')?.has('rubberband') ? `rubberband=pitch=${f.toFixed(6)}:pitchq=quality` : `asetrate=${Math.round(r * f)},aresample=${r},atempo=${(1 / f).toFixed(6)}`;
  return simpleFilter(p, ctx, `pitch${n > 0 ? '+' : ''}${n}`, null, af, 'Shifting pitch');
}
async function blurArea(p, opts, ctx) {
  const { video: v } = await videoOnly(p);
  const x = U.clamp(Math.round(Number(opts.left) || 0), 0, v.width - 4) & ~1, y = U.clamp(Math.round(Number(opts.top) || 0), 0, v.height - 4) & ~1;
  const w = evenDown(U.clamp(Number(opts.width) || 200, 4, v.width - x)), h = evenDown(U.clamp(Number(opts.height) || 100, 4, v.height - y));
  const s = U.clamp(Number(opts.strength) || 60, 1, 100) / 100, side = Math.min(w, h);
  const block = Math.max(2, Math.round(side * s / 4)), r = Math.max(1, Math.floor(side / 2 * s));
  const fx = opts.mode === 'pixelate' ? `scale=${Math.max(1, Math.round(w / block))}:${Math.max(1, Math.round(h / block))}:flags=area,scale=${w}:${h}:flags=neighbor`
    : `boxblur=lr=${r}:lp=2:cr=${Math.max(1, Math.min(Math.floor(r / 2), Math.floor(side / 4)))}:cp=2`;
  return simpleFilter(p, ctx, 'blurred', `split[a][b];[b]crop=${w}:${h}:${x}:${y},${fx}[c];[a][c]overlay=${x}:${y}`, null, opts.mode === 'pixelate' ? 'Pixelating' : 'Blurring');
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
      await (await img.open(inputs[i])).rotate().resize(W, H, { fit: 'contain', background: '#000000' }).toColourspace('srgb').png().toFile(f);
      list.push(`file '${f.replace(/'/g, "'\\''")}'\nduration ${secs}`);
    }
    list.push(`file '${path.join(dir, `s${String(inputs.length - 1).padStart(4, '0')}.png`).replace(/'/g, "'\\''")}'`);
    const lf = path.join(dir, 'list.txt');
    await fsp.writeFile(lf, list.join('\n'));
    const out = ctx.out.file(inputs[0], 'Slideshow.mp4');
    const args = ['-f', 'concat', '-safe', '0', '-i', lf];
    if (opts.audio) args.push('-i', opts.audio, '-shortest');
    args.push('-vf', 'fps=30,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', ...(opts.audio ? ['-c:a', 'aac', '-b:a', '192k'] : []), '-movflags', '+faststart', out);
    await ffmpeg(args, ctx, secs * inputs.length, 'Rendering slideshow', out);
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
    await ffmpeg(['-framerate', String(fr), '-i', path.join(dir, 'f%04d.png'), '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', out], ctx, inputs.length / fr, 'Making GIF', out);
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

module.exports = {
  probe, probeFf, ffmpeg, parseTime, encoders, supports, convertVideo, compressVideo, trim, merge, extractAudio, convertAudio, compressAudio, mute, resizeVideo, rotateVideo, speed,
  toGif, frames, extractSubtitles, snapshot, burnSubtitles, normalize, cropVideo, addAudio, loop, volume, reverse, fade, pitch, blurArea,
  imagesToVideo, imagesToGif, convertSubtitles, thumbnail, VIDEO_TARGETS, AUDIO_TARGETS,
};
Object.assign(module.exports, { videoCodecArgs, audioCodecArgs, containerArgs, sameKind, has, filters: () => list('filters') });
