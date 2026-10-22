'use strict';
// Speech to text with Whisper, bundled and offline. transcribeFile and transcribePcm return
// { text, lang, segments: [{ start, end, text, conf }] } (seconds); the model stays loaded between calls.
const U = require('./util');
const ai = require('./speech-ai');
const { fsp, path } = U;

const LANGS = [['auto', 'Detect'], ['en', 'English'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['pl', 'Polish'], ['tr', 'Turkish'],
  ['ur', 'Urdu'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['id', 'Indonesian'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['fa', 'Persian'], ['he', 'Hebrew'], ['el', 'Greek'], ['sv', 'Swedish']];
const ready = () => ai.have('whisper');
// English goes to the base model (fast, near-perfect); every other language, and detection, to small when it ships.
// A caller can ask for one: dictation asks for base to keep live partials quick.
const model = (o = {}) => (o.model === 'base' || (o.lang === 'en' && o.model !== 'small') || !ai.have('whisper-small') ? 'whisper' : 'whisper-small');
const args = (o = {}) => ({ lang: o.lang || 'auto', translate: !!o.translate, prompt: o.prompt || '', accurate: o.accurate === true || o.accuracy === 'high', fit: !!o.fit });

async function transcribePcm(samples, opts = {}, ctx = {}) {
  const dir = await ai.payload(model(opts));
  return ai.call('asr', { dir, samples, opts: args(opts) }, { signal: ctx.signal, progress: ctx.progress });
}
// Loads the model ahead of time (a second of silence). opts.fit encodes only as much as the clip needs,
// which makes live partials of a few seconds quick.
const warm = (opts = {}) => transcribePcm(new Float32Array(16000), { ...opts, lang: 'en', fit: true });
async function transcribeFile(file, opts = {}, ctx = {}) {
  const say = (f, l) => ctx.progress?.(f, l);
  say(0.01, 'Getting ready');
  const dir = await ai.payload(model(opts), () => say(0.02, 'Unpacking the speech model'));
  const tmp = await U.tmpDir('whisper');
  try {
    const raw = path.join(tmp, 'in.f32');
    say(0.03, 'Reading the sound');
    await ai.pcm(file, raw, { rate: 16000, signal: ctx.signal });
    return await ai.call('asr', { dir, pcm: raw, opts: args(opts) }, { signal: ctx.signal, progress: (f) => say(0.05 + 0.93 * f, 'Listening') });
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

const clock = (s, sep) => { const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, x = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
// Long segments are split into lines a viewer can read: at most ~84 characters and 6 seconds each.
function cues(segments) {
  const out = [];
  for (const s of segments) {
    const words = s.text.split(/\s+/).filter(Boolean), dur = Math.max(0.3, s.end - s.start);
    const parts = Math.max(Math.ceil(s.text.length / 84), Math.ceil(dur / 6));
    const per = Math.ceil(words.length / parts);
    for (let i = 0, k = 0; i < words.length; i += per, k++) {
      const n = Math.min(parts, Math.ceil(words.length / per));
      out.push({ start: s.start + (dur * k) / n, end: s.start + (dur * (k + 1)) / n, text: words.slice(i, i + per).join(' ') });
    }
  }
  return out;
}
const toSrt = (segments) => cues(segments).map((c, i) => `${i + 1}\n${clock(c.start, ',')} --> ${clock(c.end, ',')}\n${c.text}\n`).join('\n');
const toVtt = (segments) => `WEBVTT\n\n${cues(segments).map((c) => `${clock(c.start, '.')} --> ${clock(c.end, '.')}\n${c.text}\n`).join('\n')}`;
const toText = (segments) => segments.map((s) => s.text).join('\n');

module.exports = { LANGS, ready, transcribeFile, transcribePcm, warm, hasSmall: () => ai.have('whisper-small'), toSrt, toVtt, toText, cues };
