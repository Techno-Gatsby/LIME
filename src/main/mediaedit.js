'use strict';
const { spawn } = require('child_process');
const crypto = require('crypto');
const U = require('./engines/util');
const M = require('./engines/media');
const { fs, fsp, path } = U;

const sessions = new Map();
let seq = 0;
const TICKS = 254016000000;
const LUT = 64;
const even = (x) => Math.max(2, Math.round(x / 2) * 2);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const f6 = (x) => Number(x).toFixed(6);
const get = (id) => { const s = sessions.get(id); if (!s) throw new Error('This clip is no longer open. Open it again.'); return s; };
let filterSet;
const hasFilter = (f) => { if (filterSet === undefined) filterSet = M.filters(); return !filterSet || filterSet.has(f); };

const PLAY_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'ogv', 'ogg', 'oga', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'opus', 'weba']);
const PLAY_V = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora', 'hevc']);
const PLAY_A = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_u8', 'pcm_f32le']);
const squareOf = (v) => !!v && Math.abs(v.sar - 1) > 0.01;
function colourOf(v) {
  const c = v.color || {}, sd = !(v.width >= 1280 || v.height > 576);
  const mx = { bt709: 'bt709', smpte170m: 'smpte170m', bt470bg: 'bt470bg', bt2020nc: 'bt2020', bt2020c: 'bt2020' }[c.matrix] || (sd ? 'smpte170m' : 'bt709');
  const space = mx === 'bt2020' ? c.matrix : mx, std = mx === 'bt470bg' ? 'bt470bg' : mx === 'bt2020' ? 'bt2020' : mx;
  return { mx, tags: ['-colorspace', space, '-color_primaries', c.primaries || std, '-color_trc', c.transfer || (mx === 'bt2020' ? 'bt709' : mx === 'bt470bg' ? 'gamma28' : mx)] };
}
function playable(p, info) {
  const e = U.ext(p), v = info.video, a = info.audio;
  if (!PLAY_EXT.has(e)) return false;
  if (v && (!PLAY_V.has(v.codec) || v.rotation || squareOf(v) || (v.codec === 'h264' && v.pixFmt && !/^yuvj?420p$/.test(v.pixFmt)))) return false;
  return !a || (PLAY_A.has(a.codec) && (!a.codec.startsWith('pcm_') || e === 'wav'));
}

function grab(args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(U.binPath('ffmpeg'), ['-hide_banner', '-nostdin', '-v', 'error', ...args], { windowsHide: true });
    const out = [];
    let err = '';
    const kill = () => child.kill();
    signal?.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      else if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(err.trim().split('\n').slice(-2).join(' ') || `FFmpeg stopped (${code})`));
    });
  });
}

function begin(s, kind, label) {
  s.tasks.get(kind)?.ac.abort();
  const t = { ac: new AbortController(), f: 0, label };
  s.tasks.set(kind, t);
  return t;
}
const end = (s, kind, t) => { if (s.tasks.get(kind) === t) s.tasks.delete(kind); };
const summary = (err) => [...new Set(String(err).split('\n').map((l) => l.replace(/^(\[[^\]]+\]\s*)+/, '').trim()).filter(Boolean))].slice(-2).join(' ');
async function ff(t, args, { cwd, duration = 0, from = 0, share = 1, label } = {}) {
  let buf = '', err = '';
  if (label) t.label = label;
  try {
    return await U.run(U.binPath('ffmpeg'), ['-hide_banner', '-nostdin', '-y', '-nostats', '-progress', 'pipe:1', ...(args.includes('-v') ? [] : ['-v', 'error']), ...args], {
      cwd, signal: t.ac.signal,
      onStderr: (x) => { err = (err + x).slice(-12000); },
      onStdout: (x) => {
        const lines = (buf + x).split(/\r?\n/);
        buf = lines.pop();
        for (const l of lines) { const m = /^out_time_(?:us|ms)=\s*(\d+)/.exec(l); if (m && duration > 0) t.f = from + share * Math.min(0.99, Number(m[1]) / 1e6 / duration); }
      },
    });
  } catch (e) {
    if (e.cancelled) throw e;
    throw new Error(summary(err) || e.message);
  }
}

const openSteps = (p) => [{ id: 'file.import', params: { paths: [p] } }, { id: 'project.selectAll', params: {} }, { id: 'file.newSequenceFromClip', params: {} }, { id: 'edit.selectAll', params: {} }];
async function film(steps, signal, args = []) {
  const bin = await require('./engines/crafts').cli('filmcraft');
  const dir = await U.tmpDir('film');
  try {
    const script = path.join(dir, 'steps.jsonl');
    await fsp.writeFile(script, steps.map((x) => JSON.stringify(x)).join('\n'));
    const { stdout } = await U.run(bin, ['--compact', ...args, 'run', script], { cwd: dir, signal, okCodes: [1], env: { NO_COLOR: '1' }, errorMessage: 'FilmCraft couldn’t finish' });
    const lines = stdout.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    const bad = lines.find((l) => l.ok === false);
    if (bad || lines.length < steps.length) throw new Error(String(bad?.error || 'FilmCraft couldn’t finish.').replace(/^command `[^`]+` is not available right now: /, '').replace(/^./, (c) => c.toUpperCase()));
    return lines.map((l) => l.result);
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function filmExec(id) {
  const bin = await require('./engines/crafts').cli('filmcraft');
  const { stdout } = await U.run(bin, ['--compact', 'exec', id], { cwd: U.os.tmpdir(), env: { NO_COLOR: '1' }, timeout: 30000, errorMessage: 'FilmCraft couldn’t finish' });
  return JSON.parse(stdout.slice(stdout.indexOf('{')));
}

async function open(file) {
  const info = await M.probe(file);
  if (!info.video && !info.audio) throw new Error(`${path.basename(file)} has no picture or sound to edit.`);
  const id = `m${++seq}`;
  sessions.set(id, { id, file, info, dir: await U.tmpDir('mediaedit'), tasks: new Map(), made: new Map() });
  const v = info.video, a = info.audio;
  let film = false;
  try { film = require('./engines/crafts').status().find((x) => x.id === 'filmcraft')?.bundled || false; } catch (_) {}
  return {
    id, file, duration: info.duration, size: info.size, ext: U.ext(file),
    video: v ? { width: squareOf(v) ? Math.trunc((v.width * v.sar) / 2) * 2 : v.width, height: v.height, fps: v.fps || 30, codec: v.codec } : null,
    audio: a ? { codec: a.codec, channels: a.channels || 2, rate: a.rate || 48000 } : null,
    playable: playable(file, info), save: saveTarget(file, info),
    can: { stabilise: hasFilter('vidstabdetect') && hasFilter('vidstabtransform') ? 'vidstab' : hasFilter('deshake') ? 'deshake' : null, rubberband: hasFilter('rubberband'), film },
  };
}
async function info(file) {
  const i = await M.probe(file);
  return { duration: i.duration, audio: !!i.audio, video: !!i.video };
}
function progress(id) {
  const s = sessions.get(id);
  return s ? Object.fromEntries([...s.tasks].map(([k, t]) => [k, { f: t.f, label: t.label }])) : {};
}
function cancel(id, kind = 'save') { sessions.get(id)?.tasks.get(kind)?.ac.abort(); return true; }
async function close(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  for (const t of s.tasks.values()) t.ac.abort();
  await fsp.rm(s.dir, { recursive: true, force: true }).catch(() => {});
}

async function proxy(id) {
  const s = get(id);
  if (s.proxy) return s.proxy;
  const v = s.info.video, t = begin(s, 'proxy', 'Making a preview copy');
  const out = path.join(s.dir, v ? 'preview.mp4' : 'preview.flac');
  try {
    const short = "'if(gt(iw,ih),-2,min(iw,540))':'if(gt(iw,ih),min(ih,540),-2)'";
    await ff(t, v
      ? ['-i', s.file, '-map', '0:V:0', '-map', '0:a:0?', '-vf', `${squareOf(v) ? "scale=w='trunc(iw*sar/2)*2':h=ih,setsar=1," : ''}scale=${short}:flags=bicubic,format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '24', '-g', '12', ...colourOf(v).tags, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]
      : ['-i', s.file, '-map', '0:a:0', '-c:a', 'flac', out], { duration: s.info.duration });
    s.proxy = out;
    return out;
  } finally { end(s, 'proxy', t); }
}

async function thumbs(id, times, height = 54) {
  const s = get(id), v = s.info.video;
  if (!v) return [];
  const out = new Array(times.length).fill(null), quick = s.info.duration > 600;
  let i = 0;
  const run = async () => {
    while (i < times.length) {
      const k = i++, at = U.clamp(num(times[k]), 0, Math.max(0, s.info.duration - 0.05));
      out[k] = await grab([...(quick ? ['-noaccurate_seek'] : []), '-ss', at.toFixed(3), '-i', s.file, '-map', '0:V:0', '-frames:v', '1',
        '-vf', `${squareOf(v) ? "scale=w='trunc(iw*sar/2)*2':h=ih," : ''}scale=-2:${Math.round(height * 2)}:flags=bilinear`, '-q:v', '5', '-f', 'mjpeg', 'pipe:1']).catch(() => null);
    }
  };
  await Promise.all([run(), run(), run()]);
  return out;
}

async function waveform(id, key) {
  const s = get(id), src = key ? s.made.get(key) : s.file;
  if (!s.info.audio || !src) return null;
  const d = s.info.duration, per = d > 3600 ? 25 : d > 1200 ? 50 : d > 300 ? 100 : 200, rate = 8000, step = rate / per;
  const pcm = await grab(['-i', src, '-map', '0:a:0', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-c:a', 'pcm_s16le', 'pipe:1']);
  const n = Math.floor(pcm.length / 2), count = Math.ceil(n / step), peaks = Buffer.alloc(count);
  for (let i = 0; i < count; i++) {
    let m = 0;
    for (let j = i * step, e = Math.min(n, j + step); j < e; j++) { const x = Math.abs(pcm.readInt16LE(j * 2)); if (x > m) m = x; }
    peaks[i] = Math.min(255, Math.round((m / 32768) * 255));
  }
  return { per, peaks };
}

let lookList = null;
async function looks() {
  if (!lookList) {
    lookList = Promise.all([filmExec('lumetri.presets'), filmExec('lut.list')]).then(([p, l]) => ({
      looks: [...(p.presets || []).map((x) => ({ id: `lumetri:${x.name}`, name: x.name, group: x.folder, desc: x.description })),
        ...(l.builtin || []).filter((x) => !x.input).map((x) => ({ id: `look:${x.ref}`, name: x.name, group: 'Creative', desc: 'FilmCraft creative LUT' }))],
      logs: (l.builtin || []).filter((x) => x.input).map((x) => ({ id: `log:${x.ref}`, name: x.name })),
    }));
    lookList.catch(() => { lookList = null; });
  }
  return lookList;
}
const identity = () => {
  const b = Buffer.alloc(LUT * LUT * LUT * 3);
  for (let i = 0, o = 0; i < LUT ** 3; i++) { b[o++] = Math.round(((i % LUT) * 255) / (LUT - 1)); b[o++] = Math.round(((Math.floor(i / LUT) % LUT) * 255) / (LUT - 1)); b[o++] = Math.round(((Math.floor(i / LUT / LUT)) * 255) / (LUT - 1)); }
  return b;
};
const lutCache = new Map();
function lut(lookId) {
  if (!lutCache.has(lookId)) {
    const p = (async () => {
      const step = String(lookId).startsWith('lumetri:') ? { id: 'lumetri.applyPreset', params: { name: lookId.slice(8) } }
        : String(lookId).startsWith('look:') ? { id: 'lumetri.setLook', params: { lut: lookId.slice(5) } }
          : String(lookId).startsWith('log:') ? { id: 'lumetri.setInputLut', params: { lut: lookId.slice(4) } } : null;
      if (!step) throw new Error('Unknown look.');
      const dir = await U.tmpDir('look');
      try {
        const sharp = require('sharp'), hald = path.join(dir, 'hald.png');
        await sharp(identity(), { raw: { width: 512, height: 512, channels: 3 } }).png({ compressionLevel: 1 }).toFile(hald);
        await film([...openSteps(hald), step, { id: 'file.exportMedia', params: { path: path.join(dir, 'out.png'), format: 'png', range: 'custom', startSeconds: 0, endSeconds: 0.01, wait: true } }]);
        const png = (await fsp.readdir(dir)).filter((f) => /^out.*\.png$/.test(f)).sort()[0];
        if (!png) throw new Error('FilmCraft didn’t grade the look.');
        const { data, info: i } = await sharp(path.join(dir, png)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        if (i.width !== 512 || i.height !== 512) throw new Error('FilmCraft returned the look at the wrong size.');
        return data;
      } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
    })();
    lutCache.set(lookId, p);
    p.catch(() => lutCache.delete(lookId));
  }
  return lutCache.get(lookId);
}
async function scenes(id, sensitivity = 50) {
  const s = get(id), t = begin(s, 'scenes', 'Finding scenes');
  try {
    const res = await film([...openSteps(s.file), { id: 'clip.sceneEditDetection', params: { sensitivity: U.clamp(Math.round(num(sensitivity, 50)), 1, 100), applyCuts: false, generateMarkers: true, wait: true } }], t.ac.signal);
    const cuts = (res[4]?.clips || []).flatMap((c) => c.cuts || []).map((x) => x / TICKS).filter((x) => x > 0.05 && x < s.info.duration - 0.05);
    return [...new Set(cuts.map((x) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);
  } finally { end(s, 'scenes', t); }
}
async function remix(id, file, seconds) {
  const s = get(id), key = `remix|${file}|${seconds.toFixed(2)}`;
  if (s.made.has(key)) return s.made.get(key);
  const t = begin(s, 'remix', 'Fitting the music');
  try {
    const out = path.join(s.dir, `music-${crypto.createHash('md5').update(key).digest('hex').slice(0, 10)}.wav`);
    await film([...openSteps(file), { id: 'clip.remix', params: { seconds: Math.max(1, seconds) } }, { id: 'file.exportMedia', params: { path: out, format: 'wav', wait: true } }], t.ac.signal);
    s.made.set(key, out);
    return out;
  } finally { end(s, 'remix', t); }
}

async function prepare(id, o = {}) {
  const s = get(id), a = s.info.audio;
  if (!a) return null;
  const den = ['light', 'strong', 'voice'].includes(o.denoise) ? o.denoise : '', hum = [50, 60].includes(Number(o.hum)) ? Number(o.hum) : 0, pitch = U.clamp(Math.round(num(o.pitch)), -12, 12);
  if (!den && !hum && !pitch) return null;
  const key = `${den}|${hum}|${pitch}`;
  if (s.made.has(key)) return { key, path: s.made.get(key) };
  const t = begin(s, 'prepare', 'Cleaning up the sound');
  try {
    let src = s.file;
    if (den === 'voice') {
      src = path.join(s.dir, 'voice.wav');
      if (!fs.existsSync(src)) {
        t.label = 'Cleaning up the voice with FilmCraft';
        await film([...openSteps(s.file), { id: 'essentialSound.setType', params: { type: 'dialogue' } },
          { id: 'essentialSound.set', params: { values: { 'repair.noise.on': true, 'repair.noise.amount': 8, 'repair.rumble.on': true } } },
          { id: 'file.exportMedia', params: { path: src, format: 'wav', wait: true } }], t.ac.signal);
      }
    }
    const rate = a.rate || 48000, af = [];
    if (den === 'light') af.push('afftdn=nr=12:nf=-50:tn=1');
    if (den === 'strong') af.push('highpass=f=60', 'afftdn=nr=24:nf=-40:tn=1');
    if (hum) for (const k of [1, 2, 3, 4]) af.push(`equalizer=f=${hum * k}:t=q:w=8:g=-36`);
    if (pitch) {
      const f = 2 ** (pitch / 12);
      af.push(hasFilter('rubberband') ? `rubberband=pitch=${f.toFixed(6)}:pitchq=quality` : `asetrate=${Math.round(rate * f)},aresample=${rate},atempo=${(1 / f).toFixed(6)}`);
    }
    af.push(`aresample=${rate}`);
    const out = path.join(s.dir, `sound-${den || 'none'}-${hum}-${pitch}.wav`);
    await ff(t, ['-i', src, '-map', '0:a:0', '-af', af.join(','), '-ac', String(a.channels || 2), '-c:a', 'pcm_s16le', '-f', 'wav', out], { duration: s.info.duration, label: 'Cleaning up the sound' });
    s.made.set(key, out);
    return { key, path: out };
  } finally { end(s, 'prepare', t); }
}

async function silences(id, o = {}) {
  const s = get(id), src = (o.key && s.made.get(o.key)) || s.file;
  if (!s.info.audio) return [];
  const db = U.clamp(num(o.db, -40), -80, -10), min = U.clamp(num(o.min, 0.6), 0.1, 10);
  const { stderr } = await U.run(U.binPath('ffmpeg'), ['-hide_banner', '-nostdin', '-i', src, '-map', '0:a:0', '-af', `silencedetect=n=${db}dB:d=${min}`, '-f', 'null', '-'], { errorMessage: 'Couldn’t read the sound' });
  const out = [];
  let start = null;
  for (const m of stderr.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    if (m[1] === 'start') start = Math.max(0, Number(m[2]));
    else if (start != null) { out.push([start, Number(m[2])]); start = null; }
  }
  if (start != null) out.push([start, s.info.duration]);
  return out;
}

async function subs(id, file) {
  const S = require('./engines/subtitles');
  const doc = S.read(U.ext(file), await fsp.readFile(file));
  return doc.cues.map((c) => ({ start: c.start / 1000, end: c.end / 1000, text: S.plainText(c.text) }));
}

function ranges(e, dur) {
  const keep = (Array.isArray(e.keep) ? e.keep : [[0, dur]]).map(([a, b]) => [U.clamp(num(a), 0, dur), U.clamp(num(b, dur), 0, dur)]).filter(([a, b]) => b - a >= 0.02);
  if (!keep.length) throw new Error('Nothing is left to save: every part of the clip is cut.');
  return keep;
}
function geometry(e, v) {
  const g = e.geom || {}, rot = [90, 180, 270].includes(Number(g.rotate)) ? Number(g.rotate) : 0;
  const [W0, H0] = rot % 180 ? [v.height, v.width] : [v.width, v.height];
  const f = [];
  if (rot === 90) f.push('transpose=1'); else if (rot === 270) f.push('transpose=2'); else if (rot === 180) f.push('hflip,vflip');
  if (g.hflip) f.push('hflip');
  if (g.vflip) f.push('vflip');
  let cw = W0, ch = H0;
  if (Array.isArray(g.crop)) {
    const x = U.clamp(Math.round(num(g.crop[0]) / 2) * 2, 0, W0 - 16), y = U.clamp(Math.round(num(g.crop[1]) / 2) * 2, 0, H0 - 16);
    cw = U.clamp(even(num(g.crop[2], W0)), 16, W0 - x); ch = U.clamp(even(num(g.crop[3], H0)), 16, H0 - y);
    if (cw !== W0 || ch !== H0) f.push(`crop=${cw}:${ch}:${x}:${y}`);
  }
  let [W, H] = Array.isArray(g.out) ? [even(num(g.out[0], cw)), even(num(g.out[1], ch))] : [cw, ch];
  if (W > 8192 || H > 8192 || W < 16 || H < 16) [W, H] = [cw, ch];
  if (W !== cw || H !== ch) f.push(`scale=${W}:${H}:flags=lanczos`);
  else if (cw % 2 || ch % 2) f.push(`scale=${even(cw)}:${even(ch)}`);
  f.push('setsar=1');
  return { f, W: even(W), H: even(H) };
}
const atempo = (k) => {
  const chain = [];
  let r = k;
  while (r > 2) { chain.push('atempo=2.0'); r /= 2; }
  while (r < 0.5) { chain.push('atempo=0.5'); r /= 0.5; }
  if (Math.abs(r - 1) > 1e-4) chain.push(`atempo=${r.toFixed(5)}`);
  return chain;
};
function tone(q, chIn) {
  const f = [];
  if (num(q.lowcut) > 0) f.push(`highpass=f=${U.clamp(num(q.lowcut), 20, 400)}:t=q:w=0.7071`);
  if (num(q.bass)) f.push(`lowshelf=f=150:t=s:w=1:g=${U.clamp(num(q.bass), -18, 18)}`);
  if (num(q.mid)) f.push(`equalizer=f=${U.clamp(num(q.midHz, 2500), 200, 8000)}:t=q:w=${U.clamp(num(q.midQ, 1), 0.2, 8)}:g=${U.clamp(num(q.mid), -18, 18)}`);
  if (num(q.treble)) f.push(`highshelf=f=5000:t=s:w=1:g=${U.clamp(num(q.treble), -18, 18)}`);
  const bal = U.clamp(num(q.balance), -1, 1), gl = Math.min(1, 1 - bal), gr = Math.min(1, 1 + bal);
  if (q.mono) f.push(chIn === 2 ? 'pan=mono|c0=0.5*c0+0.5*c1' : chIn > 2 ? 'aformat=channel_layouts=mono' : 'anull');
  else if (Math.abs(bal) > 0.005) f.push(chIn === 1 ? `pan=stereo|c0=${gl.toFixed(3)}*c0|c1=${gr.toFixed(3)}*c0` : `pan=stereo|c0=${gl.toFixed(3)}*c0|c1=${gr.toFixed(3)}*c1`);
  return f;
}
const outChannels = (q, chIn) => (q.mono ? 1 : Math.abs(num(q.balance)) > 0.005 ? 2 : chIn);
function joined(s, e, wantV, wantA) {
  const info = s.info, keep = ranges(e, info.duration), loop = U.clamp(Math.round(num(e.loop, 1)), 1, 20);
  const prep = wantA && e.audio?.prep ? s.made.get(e.audio.prep) : null;
  const args = [], fc = [], segs = [];
  let n = 0;
  for (let k = 0; k < loop; k++) {
    for (const [a, b] of keep) {
      const g = { d: b - a };
      if (wantV) { args.push('-ss', f6(a), '-t', f6(b - a), '-i', s.file); g.v = `${n}:V:0`; if (wantA && !prep) g.a = `${n}:a:0`; n++; }
      if (wantA && (prep || !wantV)) { args.push('-ss', f6(a), '-t', f6(b - a), '-i', prep || s.file); g.a = `${n}:a:0`; n++; }
      segs.push(g);
    }
  }
  const smooth = segs.length > 1 ? 0.006 : 0;
  segs.forEach((g, i) => {
    if (!g.a) return;
    if (smooth && g.d > 0.05) { fc.push(`[${g.a}]afade=t=in:d=${smooth},afade=t=out:st=${f6(g.d - smooth)}:d=${smooth}[j${i}]`); g.a = `j${i}`; }
  });
  fc.push(`${segs.map((g) => `${wantV ? `[${g.v}]` : ''}${wantA ? `[${g.a}]` : ''}`).join('')}concat=n=${segs.length}:v=${wantV ? 1 : 0}:a=${wantA ? 1 : 0}${wantV ? '[cv]' : ''}${wantA ? '[ca]' : ''}`);
  const L = keep.reduce((x, [a, b]) => x + b - a, 0);
  return { args, fc, n, L, loop, prep };
}

const FORMATS = {
  mp4: { kind: 'video', target: 'mp4', ext: 'mp4' }, hevc: { kind: 'video', target: 'mp4', ext: 'mp4', codec: 'hevc' }, webm: { kind: 'video', target: 'webm', ext: 'webm' },
  mov: { kind: 'video', target: 'mov', ext: 'mov' }, mkv: { kind: 'video', target: 'mkv', ext: 'mkv' }, gif: { kind: 'gif', ext: 'gif' },
  mp3: { kind: 'audio', target: 'mp3', ext: 'mp3' }, m4a: { kind: 'audio', target: 'm4a', ext: 'm4a' }, wav: { kind: 'audio', target: 'wav', ext: 'wav' },
  flac: { kind: 'audio', target: 'flac', ext: 'flac' }, ogg: { kind: 'audio', target: 'ogg', ext: 'ogg' }, opus: { kind: 'audio', target: 'opus', ext: 'opus' },
};
function saveTarget(file, info) {
  const k = M.sameKind(file, info);
  if (info.video) return ['vob', 'dv', 'mxf'].includes(k.target) ? { kind: 'video', target: 'mp4', ext: 'mp4' } : { kind: 'video', target: k.target, ext: k.ext };
  return { kind: 'audio', target: k.target, ext: k.ext };
}
function formatOf(s, name) {
  const f = name && name !== 'same' ? FORMATS[name] : saveTarget(s.file, s.info);
  if (!f) throw new Error(`Lime can’t save ${String(name).toUpperCase()} here.`);
  if (f.kind !== 'audio' && !s.info.video) throw new Error('This file has no picture to save as video.');
  if (f.kind === 'video' && !M.has(f.codec === 'hevc' ? 'libx265' : M.VIDEO_TARGETS[f.target].v)) return FORMATS.mp4;
  return f;
}
const subPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
const pngOf = (bytes, w, h, file) => require('sharp')(Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength ?? bytes.length), w ? { raw: { width: w, height: h, channels: 3 } } : undefined).png({ compressionLevel: 2 }).toFile(file);
function remapCues(cues, e, info, L, loop, speed) {
  const keep = ranges(e, info.duration), out = [];
  for (const c of cues) {
    for (let k = 0; k < loop; k++) {
      let P = k * L;
      for (const [a, b] of keep) {
        const x = Math.max(a, c.start), y = Math.min(b, c.end);
        if (y - x > 0.02) out.push({ ...c, start: Math.round(((P + x - a) / speed) * 1000), end: Math.round(((P + y - a) / speed) * 1000) });
        P += b - a;
      }
    }
  }
  return out.sort((p, q) => p.start - q.start);
}

async function plan(s, e, tmp, fmt, quality) {
  const info = s.info, v = fmt.kind !== 'audio' ? info.video : null;
  const music = e.music?.file && fmt.kind !== 'gif' ? e.music : null;
  const wantA = !!info.audio && fmt.kind !== 'gif' && !e.mute && !(music && music.mode === 'replace');
  if (fmt.kind === 'audio' && !wantA && !music) throw new Error('There is no sound left to save.');
  const j = joined(s, e, !!v, wantA), { args, fc } = j;
  let n = j.n;
  const speed = U.clamp(num(e.speed, 1), 0.25, 4), D = (j.L * j.loop) / speed;
  if (fmt.kind === 'gif' && D > 60) throw new Error('GIFs are for short clips. Trim this to a minute or less first.');
  if (e.reverse) {
    const vv = info.video, aa = info.audio, bytes = j.L * j.loop * ((v ? vv.width * vv.height * 1.5 * (vv.fps || 30) : 0) + (wantA ? aa.rate * aa.channels * 4 : 0));
    if (bytes > 2 ** 31) throw new Error(`This clip is too long to reverse in one go (it needs about ${U.fmtBytes(bytes)} of memory). Cut it shorter first.`);
  }
  let vl = null, al = wantA ? 'ca' : null, stab = null, W = 0, H = 0;
  const fpsOut = v ? Math.min(60, v.fps || 30) : 0;
  if (v) {
    const pre = [];
    if (squareOf(v)) pre.push("scale=w='trunc(iw*sar/2)*2':h=ih");
    const can = hasFilter('vidstabtransform') ? 'vidstab' : hasFilter('deshake') ? 'deshake' : null;
    if (e.stabilise && can === 'vidstab') {
      pre.push('vidstabtransform=input=shake.trf:smoothing=15:optzoom=1:interpol=bicubic', 'unsharp=5:5:0.6:3:3:0.3');
      const pv = joined(s, e, true, false);
      stab = [...pv.args, '-filter_complex', `${pv.fc.join(';')};[cv]${squareOf(v) ? "scale=w='trunc(iw*sar/2)*2':h=ih," : ''}vidstabdetect=shakiness=6:accuracy=15:result=shake.trf[sv]`, '-map', '[sv]', '-f', 'null', '-'];
    } else if (e.stabilise && can) pre.push('deshake=rx=32:ry=32');
    if (e.reverse) pre.push('reverse');
    const g = geometry(e, info.video);
    W = g.W; H = g.H;
    fc.push(`[cv]${[...pre, ...g.f].join(',')}[gv]`);
    vl = 'gv';
    const cm = colourOf(info.video), rgb = `scale=in_color_matrix=${cm.mx}:out_color_matrix=${cm.mx}`;
    if (e.lut && (e.lut.byteLength ?? e.lut.length) === LUT ** 3 * 3) {
      await pngOf(e.lut, 512, 512, path.join(tmp, 'colour.png'));
      args.push('-i', 'colour.png');
      fc.push(`[${n++}:v]format=rgb24[cube]`, `[${vl}]${rgb},format=rgb24[rgb]`, `[rgb][cube]haldclut=interp=trilinear,${rgb},format=yuv420p[cc]`);
      vl = 'cc';
    }
    const post = [];
    if (speed !== 1) post.push(`setpts=PTS/${speed}`, `fps=${fpsOut}`);
    if (e.subs?.file && fs.existsSync(e.subs.file)) {
      if (!hasFilter('subtitles')) throw new Error('This copy of FFmpeg can’t draw subtitles. Remove them to save.');
      const S = require('./engines/subtitles'), doc = S.read(U.ext(e.subs.file), await fsp.readFile(e.subs.file));
      doc.cues = remapCues(doc.cues.map((c) => ({ ...c, start: c.start / 1000, end: c.end / 1000 })), e, info, j.L, j.loop, speed);
      if (doc.cues.length) {
        await fsp.writeFile(path.join(tmp, 'subs.srt'), S.write(doc, 'srt'));
        const size = U.clamp(num(e.subs.size, 18), 8, 48);
        post.push(`subtitles=subs.srt:fontsdir='${subPath(path.join(U.cfg.data, 'fonts'))}':force_style='FontName=Noto Sans,FontSize=${size},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=${(size / 12).toFixed(1)},Shadow=0,MarginV=${Math.round(size * 0.9)}'`);
      }
    }
    if (post.length) { fc.push(`[${vl}]${post.join(',')}[sp]`); vl = 'sp'; }
    for (const [i, t] of (e.titles || []).entries()) {
      const a = U.clamp(num(t.start), 0, D), b = U.clamp(num(t.end, D), 0, D), fd = Math.min(U.clamp(num(t.fade), 0, 5), (b - a) / 2);
      if (b - a < 0.04 || !t.png) continue;
      await fsp.writeFile(path.join(tmp, `title${i}.png`), Buffer.from(t.png));
      args.push('-loop', '1', '-framerate', String(fpsOut), '-t', f6(D), '-i', `title${i}.png`);
      const fades = fd > 0 ? `,fade=t=in:st=${f6(a)}:d=${f6(fd)}:alpha=1,fade=t=out:st=${f6(b - fd)}:d=${f6(fd)}:alpha=1` : '';
      fc.push(`[${n++}:v]format=rgba,scale=${W}:${H}:${rgb.slice(6)},format=yuva420p${fades}[t${i}]`, `[${vl}][t${i}]overlay=0:0:enable='between(t,${f6(a)},${f6(b)})':format=auto[o${i}]`);
      vl = `o${i}`;
    }
    const fi = U.clamp(num(e.fadeIn), 0, D / 2), fo = U.clamp(num(e.fadeOut), 0, D / 2), fv = [];
    if (e.fadePicture !== false && fi > 0) fv.push(`fade=t=in:st=0:d=${f6(fi)}`);
    if (e.fadePicture !== false && fo > 0) fv.push(`fade=t=out:st=${f6(D - fo)}:d=${f6(fo)}`);
    if (fmt.kind === 'gif') {
      const [gw, gfps, colours, dither] = { high: [640, 15, 256, 'sierra2_4a'], small: [320, 10, 128, 'bayer:bayer_scale=5'] }[quality] || [480, 12, 256, 'bayer:bayer_scale=4'];
      fv.push(`fps=${Math.min(gfps, fpsOut)}`, `scale='min(iw,${gw})':-2:flags=lanczos:in_color_matrix=${cm.mx}`, 'format=bgra', 'split[ga][gb]');
      fc.push(`[${vl}]${fv.join(',')};[ga]palettegen=max_colors=${colours}:stats_mode=diff[pal];[gb][pal]paletteuse=dither=${dither}:diff_mode=rectangle[gif]`);
      vl = 'gif';
    } else if (fv.length) { fc.push(`[${vl}]${fv.join(',')}[fv]`); vl = 'fv'; }
  }
  const q = e.audio || {}, chIn = info.audio?.channels || 2;
  let chOut = wantA ? outChannels(q, chIn) : 2;
  if (al) {
    const af = [];
    if (e.reverse) af.push('areverse');
    af.push(...tone(q, chIn));
    const gain = U.clamp(num(q.gain), -40, 40);
    if (Math.abs(gain) > 0.01) af.push(`volume=${gain.toFixed(2)}dB`);
    af.push(...atempo(speed));
    const fi = U.clamp(num(e.fadeIn), 0, D / 2), fo = U.clamp(num(e.fadeOut), 0, D / 2);
    if (e.fadeSound !== false && fi > 0) af.push(`afade=t=in:st=0:d=${f6(fi)}`);
    if (e.fadeSound !== false && fo > 0) af.push(`afade=t=out:st=${f6(D - fo)}:d=${f6(fo)}`);
    fc.push(`[ca]${af.join(',') || 'anull'}[ac]`);
    al = 'ac';
  }
  if (music) {
    const mfile = music.fit && music.fitted && fs.existsSync(music.fitted) ? music.fitted : music.file;
    args.push(...(music.loop && mfile === music.file ? ['-stream_loop', '-1'] : []), '-i', mfile);
    const mo = U.clamp(num(music.fadeOut, 0), 0, D / 2), mf = [`volume=${U.clamp(num(music.volume, -6), -40, 12).toFixed(2)}dB`, 'apad', `atrim=0:${f6(D)}`, 'asetpts=PTS-STARTPTS'];
    if (mo > 0) mf.push(`afade=t=out:st=${f6(D - mo)}:d=${f6(mo)}`);
    if (q.mono) mf.push('aformat=channel_layouts=mono');
    fc.push(`[${n++}:a:0]${mf.join(',')}[mus]`);
    const duck = U.clamp(num(music.duck), 0, 30);
    if (al) {
      if (duck > 0) {
        const mix = 1 - 10 ** (-duck / 20);
        fc.push(`[${al}]asplit[am][key]`, `[mus][key]sidechaincompress=threshold=0.01:ratio=20:attack=20:release=450:mix=${mix.toFixed(4)}[md]`, `[am][md]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mx]`);
      } else fc.push(`[${al}][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mx]`);
      al = 'mx';
    } else al = 'mus';
    if (!q.mono) chOut = 2;
  }
  if (al && (num(q.gain) > 0 || music)) { fc.push(`[${al}]alimiter=limit=0.891:level=0:attack=5:release=60[al]`); al = 'al'; }
  const out = ['-filter_complex', fc.join(';')];
  if (vl) out.push('-map', `[${vl}]`);
  if (al) out.push('-map', `[${al}]`);
  const cover = fmt.kind === 'audio' && info.cover != null && !info.video && ['mp3', 'm4a', 'flac'].includes(fmt.target);
  if (cover) out.push('-map', `0:${info.cover}`, '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
  const qual = quality || 'high';
  if (fmt.kind === 'gif') out.push('-loop', '0', '-f', 'gif');
  else if (fmt.kind === 'video') {
    const T = M.VIDEO_TARGETS[fmt.target], enc = fmt.codec === 'hevc' ? 'libx265' : T.v, pal = Math.abs(fpsOut - 25) < 0.5 || Math.abs(fpsOut - 50) < 1;
    out.push(...M.videoCodecArgs(fmt.target, enc, qual, { ...info.video, width: W, height: H, fps: fpsOut }, pal), ...colourOf(info.video).tags);
    if (al) out.push(...M.audioCodecArgs(fmt.target, T.a, { quality: qual }, { channels: chOut, rate: info.audio?.rate || 48000 }, true));
    else out.push('-an');
    out.push('-map_metadata', '0', ...M.containerArgs(fmt.target), '-max_muxing_queue_size', '4096', '-f', T.mux);
  } else {
    const T = M.AUDIO_TARGETS[fmt.target], depth = /^pcm_s24/.test(info.audio?.codec || '') ? 'pcm_s24le' : 'pcm_s16le';
    if (!cover) out.push('-vn');
    const enc = fmt.target === 'wav' ? depth : T.a;
    out.push(...M.audioCodecArgs(fmt.target, M.has(enc) ? enc : T.a, { quality: qual }, { channels: chOut, rate: info.audio?.rate || 48000 }, false), '-map_metadata', '0', ...M.containerArgs(fmt.target), '-f', T.mux);
  }
  out.push('-t', f6(D));
  return { args: [...args, ...out], stab, duration: D, W, H };
}

async function save(id, e, out, o = {}) {
  const s = get(id), fmt = formatOf(s, o.format), t = begin(s, 'save', 'Saving');
  const tmp = await fsp.mkdtemp(path.join(s.dir, 'save-')), part = `${out}.lime-part`;
  try {
    if (e.music?.fit) e.music.fitted = await remix(id, e.music.file, (ranges(e, s.info.duration).reduce((x, [a, b]) => x + b - a, 0) * U.clamp(Math.round(num(e.loop, 1)), 1, 20)) / U.clamp(num(e.speed, 1), 0.25, 4)).catch(() => null);
    const p = await plan(s, e, tmp, fmt, o.quality);
    if (p.stab) await ff(t, p.stab, { cwd: tmp, duration: p.duration * U.clamp(num(e.speed, 1), 0.25, 4), share: 0.35, label: 'Measuring the shake' });
    await ff(t, [...p.args, part], { cwd: tmp, duration: p.duration, from: p.stab ? 0.35 : 0, share: p.stab ? 0.65 : 1, label: 'Saving' });
    await fsp.rename(part, out);
    t.f = 1;
    return { path: out, duration: p.duration, width: p.W, height: p.H };
  } catch (err) {
    await fsp.rm(part, { force: true }).catch(() => {});
    throw err;
  } finally {
    end(s, 'save', t);
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function loudness(id, e) {
  const s = get(id);
  if (!s.info.audio) return null;
  const t = begin(s, 'loudness', 'Measuring loudness'), j = joined(s, { ...e, loop: 1 }, false, true);
  try {
    const { stderr } = await ff(t, ['-v', 'info', ...j.args, '-filter_complex', `${j.fc.join(';')};[ca]${[...tone(e.audio || {}, s.info.audio.channels || 2), 'loudnorm=print_format=json'].join(',')}[m]`, '-map', '[m]', '-f', 'null', '-'], { duration: j.L });
    const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(stderr);
    if (!m) throw new Error('Couldn’t measure the loudness.');
    const r = JSON.parse(m[0]);
    return { lufs: Number(r.input_i), peak: Number(r.input_tp) };
  } finally { end(s, 'loudness', t); }
}

async function frame(id, e, at, out) {
  const s = get(id), v = s.info.video;
  if (!v) throw new Error('This file has no picture.');
  const tmp = await fsp.mkdtemp(path.join(s.dir, 'frame-'));
  try {
    const args = ['-ss', f6(U.clamp(num(at.t), 0, Math.max(0, s.info.duration - 0.04))), '-i', s.file], fc = [];
    const g = geometry(e, v);
    let n = 1, vl = 'g';
    const mx = colourOf(v).mx;
    fc.push(`[0:V:0]${[...(squareOf(v) ? ["scale=w='trunc(iw*sar/2)*2':h=ih"] : []), ...g.f, `scale=in_color_matrix=${mx}`, 'format=rgb24'].join(',')}[g]`);
    if (e.lut && (e.lut.byteLength ?? e.lut.length) === LUT ** 3 * 3) {
      await pngOf(e.lut, 512, 512, path.join(tmp, 'colour.png'));
      args.push('-i', 'colour.png');
      fc.push(`[${n++}:v]format=rgb24[cube]`, `[${vl}][cube]haldclut=interp=trilinear[c]`);
      vl = 'c';
    }
    if (at.cue && e.subs) {
      const size = U.clamp(num(e.subs.size, 18), 8, 48);
      await fsp.writeFile(path.join(tmp, 'subs.srt'), `1\n00:00:00,000 --> 10:00:00,000\n${String(at.cue).replace(/\r/g, '')}\n`);
      fc.push(`[${vl}]subtitles=subs.srt:fontsdir='${subPath(path.join(U.cfg.data, 'fonts'))}':force_style='FontName=Noto Sans,FontSize=${size},BorderStyle=1,Outline=${(size / 12).toFixed(1)},Shadow=0,MarginV=${Math.round(size * 0.9)}'[sb]`);
      vl = 'sb';
    }
    for (const [i, t] of (at.titles || []).entries()) {
      await fsp.writeFile(path.join(tmp, `title${i}.png`), Buffer.from(t.png));
      args.push('-i', `title${i}.png`);
      fc.push(`[${n++}:v]format=rgba,scale=${g.W}:${g.H},colorchannelmixer=aa=${U.clamp(num(t.opacity, 1), 0, 1).toFixed(3)}[t${i}]`, `[${vl}][t${i}]overlay=0:0:format=rgb[o${i}]`);
      vl = `o${i}`;
    }
    const k = U.clamp(num(at.fade, 1), 0, 1);
    fc.push(`[${vl}]format=rgb24${k < 0.999 ? `,colorchannelmixer=rr=${k.toFixed(3)}:gg=${k.toFixed(3)}:bb=${k.toFixed(3)}` : ''}[fd]`);
    vl = 'fd';
    const jpg = /\.jpe?g$/i.test(out), part = `${out}.lime-part`;
    await U.run(U.binPath('ffmpeg'), ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args, '-filter_complex', fc.join(';'), '-map', `[${vl}]`, '-frames:v', '1', ...(jpg ? ['-q:v', '2', '-f', 'mjpeg'] : ['-f', 'image2', '-c:v', 'png']), part], { cwd: tmp, errorMessage: 'Couldn’t save the frame' });
    await fsp.rename(part, out);
    return { path: out, width: g.W, height: g.H };
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

async function saveScenes(id, sensitivity) {
  const s = get(id), t = begin(s, 'scenes', 'Saving each scene');
  try {
    const tool = require('./tools').get('split-scenes');
    const ctx = { signal: t.ac.signal, out: U.outputPlanner({ dest: null }), host: async () => null, progress: (f) => { t.f = f; } };
    const res = await tool.run([s.file], { sensitivity }, ctx);
    const r = (Array.isArray(res) ? res.flat(Infinity) : [res]).find(Boolean);
    return typeof r === 'string' ? { path: r } : r;
  } finally { end(s, 'scenes', t); }
}

module.exports = { open, info, progress, cancel, close, proxy, thumbs, waveform, looks, lut, scenes, saveScenes, remix, prepare, silences, subs, save, loudness, frame, plan, FORMATS };
