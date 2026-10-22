'use strict';
// Speech tools on the bundled models, all offline: subtitles and transcripts from speech, subtitles added
// to a video, voice clean-up, vocals and backing split apart, and documents read aloud.
const U = require('./util');
const ai = require('./speech-ai');
const whisper = require('./whisper');
const { fsp, path } = U;
const media = () => require('./media');

const ISO3 = { en: 'eng', hi: 'hin', ar: 'ara', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', nl: 'nld', ru: 'rus', uk: 'ukr', pl: 'pol', tr: 'tur', ur: 'urd', bn: 'ben', ta: 'tam', zh: 'zho', ja: 'jpn', ko: 'kor', id: 'ind', vi: 'vie', th: 'tha', fa: 'fas', he: 'heb', el: 'ell', sv: 'swe' };
const VOICES = [['en-GB', 'English (British)'], ['en-US', 'English (American)'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish']];
const CODEC = { mp3: ['-c:a', 'libmp3lame', '-q:a', '2'], m4a: ['-c:a', 'aac', '-b:a', '192k'], aac: ['-c:a', 'aac', '-b:a', '192k'], ogg: ['-c:a', 'libvorbis', '-q:a', '6'], opus: ['-c:a', 'libopus', '-b:a', '128k'], flac: ['-c:a', 'flac'], wav: ['-c:a', 'pcm_s16le'], aiff: ['-c:a', 'pcm_s16be'] };
const part = (ctx, from, to) => ({ ...ctx, progress: (f, l) => ctx.progress?.(from + (to - from) * (f || 0), l) });
const sound = async (f) => { const info = await media().probe(f); if (!info.audio) throw new Error(`${path.basename(f)} has no sound.`); return info; };

// Raw float32 samples become a file like the source: the same video with its sound replaced, or an audio file.
async function encode(src, raw, { rate, channels }, info, ctx, name, label, ext) {
  const kind = media().sameKind(src, info);
  ext = ext || (info.video ? kind.ext : CODEC[kind.ext] ? kind.ext : 'mp3');
  const out = ctx.out.file(src, `${name}.${ext}`), input = ['-f', 'f32le', '-ar', String(rate), '-ac', String(channels), '-i', raw];
  const args = info.video
    ? ['-i', src, ...input, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', ...(ext === 'webm' ? ['-c:a', 'libopus', '-b:a', '128k'] : ['-c:a', 'aac', '-b:a', '192k']), '-shortest', ...(['mp4', 'm4v', 'mov'].includes(ext) ? ['-movflags', '+faststart'] : []), out]
    : [...input, ...(CODEC[ext] || []), out];
  await media().ffmpeg(args, ctx, info.duration, label, out);
  return out;
}

// A file with no speech in it (music, a tone, silence) gives no segments: say so rather than save an empty file.
// Whisper can loop over trailing silence, repeating the sentence it just heard; those repeats are dropped.
const said = (x) => String(x.text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const heard = (r, f) => {
  if (!r.segments?.some((x) => String(x.text || '').trim())) throw new Error(`No speech heard in ${path.basename(f)}.`);
  const seen = new Set();
  r.segments = r.segments.filter((x) => { const k = said(x); if (k.split(' ').length >= 3 && seen.has(k)) return false; seen.add(k); return true; });
  if (r.text != null) r.text = r.segments.map((x) => String(x.text || '').trim()).join(' ');
  return r;
};
async function transcribe(f, o, ctx) {
  const to = o.to || 'srt';
  await sound(f);
  const r = heard(await whisper.transcribeFile(f, o, ctx), f);
  const out = ctx.out.file(f, `${U.base(f)}.${to}`);
  await fsp.writeFile(out, to === 'srt' ? whisper.toSrt(r.segments) : to === 'vtt' ? whisper.toVtt(r.segments) : whisper.toText(r.segments));
  return out;
}
async function subtitleVideo(f, o, ctx) {
  const info = await sound(f);
  if (!info.video) throw new Error(`${path.basename(f)} has no picture: choose Subtitles from speech instead.`);
  const tmp = await U.tmpDir('subs');
  try {
    const r = heard(await whisper.transcribeFile(f, o, part(ctx, 0, 0.85)), f);
    const srt = path.join(tmp, 'subtitles.srt');
    await fsp.writeFile(srt, whisper.toSrt(r.segments));
    const rest = part(ctx, 0.85, 1);
    if (o.how === 'burn') return await media().burnSubtitles(f, { subtitles: srt, size: o.size }, rest);
    const e = U.ext(f), mp4 = ['mp4', 'm4v', 'mov'].includes(e), out = ctx.out.file(f, `${U.base(f)}-subtitled.${mp4 ? e : 'mkv'}`);
    const lang = ISO3[o.translate ? 'en' : r.lang] || 'und';
    await media().ffmpeg(['-i', f, '-i', srt, '-map', '0', '-map', '1', '-c', 'copy', '-c:s', mp4 ? 'mov_text' : 'srt', `-metadata:s:s:${info.subtitles}`, `language=${lang}`, out], rest, info.duration, 'Adding subtitles', out);
    return out;
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

async function cleanVoice(f, o, ctx) {
  const info = await sound(f), tmp = await U.tmpDir('voice');
  try {
    ctx.progress?.(0.01, 'Getting ready');
    const dir = await ai.payload('denoise', () => ctx.progress?.(0.02, 'Unpacking the voice model'));
    const channels = Math.min(2, info.audio.channels || 1), raw = path.join(tmp, 'in.f32'), clean = path.join(tmp, 'clean.f32');
    ctx.progress?.(0.03, 'Reading the sound');
    await ai.pcm(f, raw, { rate: 48000, channels, signal: ctx.signal });
    await ai.call('denoise', { dir, pcm: raw, channels, out: clean, keep: o.strength === 'gentle' ? 0.12 : 0 }, { signal: ctx.signal, progress: (p) => ctx.progress?.(0.05 + 0.85 * p, 'Cleaning up the voice') });
    return await encode(f, clean, { rate: 48000, channels }, info, part(ctx, 0.9, 1), `${U.base(f)}-clean`, 'Saving');
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

async function separate(f, ctx) {
  const info = await sound(f), tmp = await U.tmpDir('stems');
  ctx.progress?.(0.01, 'Getting ready');
  const dir = await ai.payload('stems', () => ctx.progress?.(0.02, 'Unpacking the stem splitter'));
  const raw = path.join(tmp, 'in.f32'), out = { vocals: path.join(tmp, 'vocals.f32'), accompaniment: path.join(tmp, 'backing.f32') };
  ctx.progress?.(0.03, 'Reading the music');
  await ai.pcm(f, raw, { rate: 44100, channels: 2, signal: ctx.signal });
  await ai.call('stems', { dir, pcm: raw, out }, { signal: ctx.signal, progress: (p, l) => ctx.progress?.(0.05 + 0.8 * p, l === 'Separating' && info.duration > 120 ? 'Separating (slow on a CPU)' : l) });
  return { info, tmp, out };
}
async function splitStems(f, o, ctx) {
  const { info, tmp, out } = await separate(f, ctx);
  try {
    const folder = ctx.out.folder(f, `${U.base(f)} - stems`), ext = CODEC[o.format] ? o.format : 'wav';
    for (const [name, raw] of [['vocals', out.vocals], ['backing', out.accompaniment]]) {
      const file = U.uniquePath(path.join(folder, `${name}.${ext}`));
      await media().ffmpeg(['-f', 'f32le', '-ar', '44100', '-ac', '2', '-i', raw, ...CODEC[ext], file], part(ctx, 0.85, 1), info.duration, 'Saving', file);
    }
    return folder;
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}
async function removeVocals(f, o, ctx) {
  const { info, tmp, out } = await separate(f, ctx);
  try { return await encode(f, out.accompaniment, { rate: 44100, channels: 2 }, info, part(ctx, 0.85, 1), `${U.base(f)}-no-vocals`, 'Saving'); } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

async function textOf(f) {
  if (U.ext(f) === 'pdf') {
    const { doc } = await require('./pdf').readPdf(f), parts = [];
    for (let i = 0; i < doc.countPages(); i++) parts.push(doc.loadPage(i).toStructuredText('').asText());
    return parts.join('\n\n');
  }
  const office = require('./office'), r = await office.readHtml(f).catch(() => null);
  if (r) return r.plain || office.htmlToText(r.html);
  return (await fsp.readFile(f, 'utf8')).replace(/^﻿/, '');
}
async function readAloud(f, o, ctx) {
  const text = (await textOf(f)).replace(/\f/g, '\n\n').trim();
  if (!/[\p{L}\p{N}]/u.test(text)) throw new Error(`There is no text to read in ${path.basename(f)}.`);
  const voice = VOICES.some(([v]) => v === o.voice) ? o.voice : 'en-GB', tmp = await U.tmpDir('speak');
  try {
    ctx.progress?.(0.01, 'Getting ready');
    const [espeakDir, voiceDir] = await Promise.all([ai.payload('espeak'), ai.payload(`voice-${voice}`, () => ctx.progress?.(0.02, 'Unpacking the voice'))]);
    const raw = path.join(tmp, 'speech.f32'), words = text.split(/\s+/).length;
    const r = await ai.call('tts', { espeakDir, model: path.join(voiceDir, 'voice.onnx'), text, speed: Number(o.speed) || 1, out: raw }, { signal: ctx.signal, progress: (p) => ctx.progress?.(0.03 + 0.9 * p, words > 1500 ? 'Reading (a long text takes a while)' : 'Reading') });
    const ext = o.to === 'wav' ? 'wav' : 'mp3', out = ctx.out.file(f, `${U.base(f)}.${ext}`);
    await media().ffmpeg(['-f', 'f32le', '-ar', String(r.rate), '-ac', '1', '-i', raw, ...CODEC[ext], out], part(ctx, 0.93, 1), r.samples / r.rate, 'Saving', out);
    return out;
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

// Speech in one language spoken again in another: whisper hears it, the translation models translate each line, and
// a Piper voice reads every line at the moment it was said (a little faster when the translation runs longer). A video
// keeps its picture, with the original sound low underneath and the translated subtitles as a track.
async function translateSpeech(f, o, ctx) {
  const T = require('./translate'), info = await sound(f), to = VOICES.some(([v]) => v === o.to) ? o.to : 'en-GB', lang = to.slice(0, 2);
  const tmp = await U.tmpDir('dub');
  try {
    let r = heard(await whisper.transcribeFile(f, { ...o, lang: o.from || 'auto', translate: false }, part(ctx, 0, 0.35)), f);
    let from = r.lang;
    // A language the translation models don't know is heard again straight into English, and goes on from there.
    if (from !== lang && !T.route(from, lang)) { r = heard(await whisper.transcribeFile(f, { ...o, lang: from, translate: true }, part(ctx, 0.35, 0.45)), f); from = 'en'; }
    const segs = r.segments.filter((x) => String(x.text || '').trim());
    const lines = from === lang ? segs.map((x) => x.text.trim()) : await T.translate(segs.map((x) => x.text.trim()), from, lang, { progress: (p) => ctx.progress?.(0.45 + 0.1 * p, 'Translating'), signal: ctx.signal });
    const subs = segs.map((x, i) => ({ ...x, text: lines[i] }));
    const srt = path.join(tmp, 'translated.srt');
    await fsp.writeFile(srt, whisper.toSrt(subs));
    if (o.output === 'srt') { const out = ctx.out.file(f, `${U.base(f)}-${lang}.srt`); await fsp.copyFile(srt, out); return out; }
    const [espeakDir, voiceDir] = await Promise.all([ai.payload('espeak'), ai.payload(`voice-${to}`)]);
    const say = async (text, speed, i) => { const raw = path.join(tmp, `l${i}.f32`); const q = await ai.call('tts', { espeakDir, model: path.join(voiceDir, 'voice.onnx'), text, speed, out: raw }, { signal: ctx.signal }); return { pcm: new Float32Array((await fsp.readFile(raw)).buffer.slice(0)), rate: q.rate }; };
    const parts = [];
    for (let i = 0; i < subs.length; i++) {
      const x = subs[i], slot = Math.max(0.5, (subs[i + 1]?.start ?? x.end + 1) - x.start);
      let a = await say(x.text, 1, i);
      const len = a.pcm.length / a.rate;
      if (len > slot * 1.05) a = await say(x.text, Math.min(1.6, len / slot), i);
      parts.push({ start: x.start, ...a });
      ctx.progress?.(0.55 + 0.35 * ((i + 1) / subs.length), `Speaking line ${i + 1} of ${subs.length}`);
    }
    const rate = parts[0]?.rate || 22050, total = Math.max(info.duration || 0, ...parts.map((p) => p.start + p.pcm.length / rate)) + 0.25;
    const mix = new Float32Array(Math.ceil(total * rate));
    let cursor = 0;
    for (const p of parts) { const at = Math.max(Math.round(p.start * rate), cursor); mix.set(p.pcm.subarray(0, Math.max(0, mix.length - at)), at); cursor = at + p.pcm.length; }
    const raw = path.join(tmp, 'dub.f32');
    await fsp.writeFile(raw, Buffer.from(mix.buffer));
    const pcm = ['-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', raw], rest = part(ctx, 0.9, 1);
    if (info.video && o.output !== 'audio') {
      const e = U.ext(f), mp4 = ['mp4', 'm4v', 'mov'].includes(e), out = ctx.out.file(f, `${U.base(f)}-${lang}.${mp4 ? e : 'mkv'}`);
      const keep = Number(o.original ?? 0.15);
      const audio = keep > 0 ? ['-filter_complex', `[0:a]volume=${keep}[o];[1:a]aresample=48000[d];[o][d]amix=inputs=2:duration=longest:normalize=0[a]`, '-map', '0:v', '-map', '[a]'] : ['-map', '0:v', '-map', '1:a'];
      await media().ffmpeg(['-i', f, ...pcm, '-i', srt, ...audio, '-map', '2', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-c:s', mp4 ? 'mov_text' : 'srt', '-metadata:s:a:0', `language=${ISO3[lang]}`, '-metadata:s:s:0', `language=${ISO3[lang]}`, out], rest, total, 'Saving', out);
      return out;
    }
    const out = ctx.out.file(f, `${U.base(f)}-${lang}.mp3`);
    await media().ffmpeg([...pcm, ...CODEC.mp3, out], rest, total, 'Saving', out);
    return out;
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { translateSpeech, VOICES, transcribe, subtitleVideo, cleanVoice, splitStems, removeVocals, readAloud, textOf };
