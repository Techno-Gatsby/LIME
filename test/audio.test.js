'use strict';
// The speech tools, end to end on the bundled models: text read aloud by Piper comes back through whisper,
// noise mixed into a clip is taken out again, a voice mixed over backing is split apart, and a video gets
// subtitles. Skipped when the models are not vendored (set LIME_AI to a folder of <id>.tar.br + manifest.json).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

module.exports = async ({ submit, jobs, dir }) => {
  const OUT = path.join(dir, 'audio');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;
  const E = (n) => require(path.join(__dirname, '..', 'src', 'main', 'engines', n));
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const have = (id) => E('speech-ai').have(id);
  const check = async (name, fn, need = 'whisper') => {
    name = `audio: ${name}`;
    if (only && !only.test(name)) return;
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    if (!have(need)) { status = 'SKIP'; detail = `no ${need} payload (LIME_AI)`; } else { try { detail = (await fn()) || ''; } catch (e) { status = 'FAIL'; detail = e.message; } }
    console.log(`${status} ${name.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 240));
    results.push({ name, status, detail });
  };
  const run = async (tool, files, opts, name) => {
    const d = path.join(OUT, name);
    fs.mkdirSync(d, { recursive: true });
    const id = submit({ tool, files, opts, dest: { kind: 'dir', path: d } });
    let j;
    for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(100); }
    ok(j.status === 'done', `${tool}: ${j.status}: ${j.error}`);
    return j.results.flatMap((r) => r.paths || (r.path ? [r.path] : []));
  };
  const ffmpeg = E('util').binPath('ffmpeg');
  const pcm = (f, rate, channels = 1) => { const b = execFileSync(ffmpeg, ['-v', 'error', '-i', f, '-f', 'f32le', '-ar', String(rate), '-ac', String(channels), '-'], { maxBuffer: 1 << 30 }); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
  const probe = (f) => JSON.parse(execFileSync(E('util').binPath('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]).toString());
  const wav = (file, x, rate, channels = 1) => {
    const h = Buffer.alloc(44), n = x.length * 2;
    h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n, 40);
    const d = Buffer.alloc(n);
    for (let i = 0; i < x.length; i++) d.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), i * 2);
    fs.writeFileSync(file, Buffer.concat([h, d]));
    return file;
  };
  const text = (name, t) => { const f = path.join(OUT, name); fs.writeFileSync(f, t); return f; };
  const norm = (t) => String(t).toLowerCase().normalize('NFC').replace(/[\u064b-\u0652\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const wer = (ref, hyp) => {
    const a = norm(ref), b = norm(hyp), d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length] / a.length;
  };
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  // SNR of y against the reference x, after lining y up (an AAC round trip can shift it a few hundred samples).
  const snr = (x, y) => {
    const L = 2400, W = Math.min(48000, x.length - 2 * L);
    let lag = 0, best = -Infinity;
    for (let l = -L; l <= L; l++) { let c = 0; for (let i = L; i < L + W; i++) c += (y[i + l] || 0) * x[i]; if (c > best) { best = c; lag = l; } }
    let s = 0, e = 0;
    for (let i = 0; i < x.length - 2 * L; i++) { s += x[i] * x[i]; e += (x[i] - (y[i + lag] || 0)) ** 2; }
    return 10 * Math.log10(s / e);
  };
  const corr = (a, b, stride = 1) => { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < b.length; i++) { const x = a[i * stride], y = b[i]; ab += x * y; aa += x * x; bb += y * y; } return ab / Math.sqrt(aa * bb); };
  let seed = 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };

  const EN = 'The quick brown fox jumps over the lazy dog. Our meeting has moved to Thursday afternoon, so please bring the updated figures. The weather in London is mild this week, with light rain expected on Friday.';
  const SPEECH = {
    'en-GB': ['en', EN, 0.1],
    'en-US': ['en', 'Please remember to lock the door when you leave tonight. Sales grew by twelve percent in the last quarter, which is better than we expected.', 0.3],
    hi: ['hi', 'आज मौसम बहुत अच्छा है और हम बाज़ार जा रहे हैं। मेरा नाम रोहन है और मैं दिल्ली में रहता हूँ। कृपया यह किताब मेज़ पर रख दीजिए।', 0.4],
    ar: ['ar', 'الطقس جميل اليوم ونحن ذاهبون إلى السوق. اسمي كريم وأنا أسكن في عمان. من فضلك ضع هذا الكتاب على الطاولة.', 0.45],
    fr: ['fr', 'Bonjour à tous. La réunion commence à dix heures dans la grande salle. Merci d’apporter vos documents.', 0.3],
    de: ['de', 'Guten Morgen. Der Zug nach Berlin fährt um acht Uhr von Gleis drei ab. Bitte vergessen Sie Ihre Fahrkarte nicht.', 0.3],
    es: ['es', 'Buenos días. La tienda abre a las nueve y cierra a las ocho de la tarde. Gracias por su visita.', 0.3],
  };
  const spoken = {};
  // Every voice reads its sentence, and whisper reads it back (English on the base model, the rest on small).
  for (const [voice, [lang, t, limit]] of Object.entries(SPEECH)) {
    await check(`read aloud and back · ${voice}`, async () => {
      const [mp3] = await run('read-aloud', [text(`${voice}.txt`, t)], { voice, to: 'wav' }, `tts-${voice}`);
      const info = probe(mp3), dur = Number(info.format.duration);
      ok(dur > 3 && dur < 40, `spoken clip is ${dur} s`);
      spoken[voice] = mp3;
      const [txt] = await run('speech-to-text', [mp3], { to: 'txt', lang }, `asr-${voice}`);
      const w = wer(t, fs.readFileSync(txt, 'utf8'));
      ok(w <= limit, `WER ${pct(w)} over ${pct(limit)}: ${fs.readFileSync(txt, 'utf8').slice(0, 160)}`);
      return `${dur.toFixed(1)} s spoken, WER ${pct(w)}`;
    }, lang === 'en' ? 'whisper' : 'whisper-small');
  }
  const voice = () => { ok(spoken['en-GB'], 'needs the en-GB clip'); return spoken['en-GB']; };

  await check('subtitles · SRT, VTT and English from speech', async () => {
    const [srt] = await run('speech-to-text', [voice()], { to: 'srt', lang: 'auto' }, 'srt');
    const s = fs.readFileSync(srt, 'utf8'), cues = s.match(/\d+:\d\d:\d\d,\d{3} --> \d+:\d\d:\d\d,\d{3}/g) || [];
    // The base model in the default build can hear “quick brown” as “quip-brown”, so the check keys on the rest of the line.
    const said = s.split(/\r?\n/).filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l)).join(' ');
    // Cues can break a sentence anywhere, so the words are read across them.
    ok(cues.length >= 2 && /fox jumps over the lazy dog/i.test(said), `SRT: ${s.slice(0, 200)}`);
    const [vtt] = await run('speech-to-text', [voice()], { to: 'vtt', lang: 'en' }, 'vtt');
    ok(/^WEBVTT/.test(fs.readFileSync(vtt, 'utf8')), 'VTT header');
    return `${cues.length} cues`;
  });
  await check('subtitles · translate to English', async () => {
    const [txt] = await run('speech-to-text', [spoken.fr], { to: 'txt', lang: 'fr', translate: true }, 'translate');
    const t = fs.readFileSync(txt, 'utf8');
    ok(/meeting|documents|hello|morning/i.test(t), `not English: ${t.slice(0, 160)}`);
    return t.trim().slice(0, 80);
  }, 'whisper-small');

  await check('add subtitles to video · track and burned in', async () => {
    const video = path.join(OUT, 'talk.mp4');
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=320x240:r=10', '-i', voice(), '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
    const [soft] = await run('subtitle-video', [video], { how: 'soft', lang: 'en' }, 'soft');
    const subs = probe(soft).streams.filter((s) => s.codec_type === 'subtitle');
    ok(soft.endsWith('.mp4') && subs.length === 1 && subs[0].codec_name === 'mov_text' && subs[0].tags?.language === 'eng', `soft subs: ${JSON.stringify(subs).slice(0, 200)}`);
    const [burn] = await run('subtitle-video', [video], { how: 'burn', lang: 'en', size: 24 }, 'burn');
    ok(!probe(burn).streams.some((s) => s.codec_type === 'subtitle'), 'burned video still has a subtitle stream');
    const frame = (f) => execFileSync(ffmpeg, ['-v', 'error', '-ss', '3', '-i', f, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });
    const a = frame(video), b = frame(burn);
    let lit = 0;
    for (let i = 320 * 160; i < a.length; i++) if (b[i] - a[i] > 80) lit++;
    ok(lit > 200, `only ${lit} bright pixels in the lower part of the burned frame`);
    return `track + ${lit} burned-in pixels`;
  });

  await check('clean up voice noise · SNR improves', async () => {
    const clean = pcm(voice(), 48000), n = clean.length, noisy = new Float32Array(n);
    let p = 0, lp = 0;
    for (let i = 0; i < n; i++) p += clean[i] ** 2;
    const noise = new Float32Array(n);
    let pn = 0;
    for (let i = 0; i < n; i++) { lp = 0.7 * lp + 0.3 * rnd(); noise[i] = lp; pn += lp * lp; }
    const g = Math.sqrt(p / pn / 10 ** 0.5);
    for (let i = 0; i < n; i++) noisy[i] = clean[i] + noise[i] * g;
    const before = snr(clean, noisy);
    const [out] = await run('denoise-voice', [wav(path.join(OUT, 'noisy.wav'), noisy, 48000)], { strength: 'full' }, 'clean');
    const after = snr(clean, pcm(out, 48000));
    ok(after > before + 5, `SNR ${before.toFixed(1)} → ${after.toFixed(1)} dB`);
    const video = path.join(OUT, 'noisy.mp4');
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x120:r=10', '-i', path.join(OUT, 'noisy.wav'), '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
    const [vid] = await run('denoise-voice', [video], { strength: 'gentle' }, 'clean-video');
    const vs = probe(vid).streams;
    ok(vs.some((s) => s.codec_type === 'video') && vs.some((s) => s.codec_type === 'audio'), 'cleaned video lost a stream');
    const vafter = snr(clean, pcm(vid, 48000));
    ok(vafter > before + 3, `video SNR ${before.toFixed(1)} → ${vafter.toFixed(1)} dB`);
    return `SNR ${before.toFixed(1)} → ${after.toFixed(1)} dB (video, gentle: ${vafter.toFixed(1)} dB)`;
  }, 'denoise');

  await check('split song into stems · vocals and backing', async () => {
    const v = pcm(voice(), 44100), n = v.length, back = new Float32Array(n), SR = 44100;
    const chords = [[220, 277, 330], [196, 247, 294], [175, 220, 262], [165, 208, 247]];
    for (let i = 0; i < n; i++) {
      const t = i / SR, chord = chords[Math.floor(t / 2) % 4];
      let x = 0;
      for (const f of chord) for (let h = 1; h <= 4; h++) x += Math.sin(2 * Math.PI * f * h * t) / h;
      x = x * 0.12 + 0.25 * Math.sin(2 * Math.PI * (chord[0] / 2) * t) * (0.6 + 0.4 * Math.sin(4 * Math.PI * t));
      const beat = (t * 2) % 1;
      if (beat < 0.08) x += rnd() * 0.8 * (1 - beat / 0.08);
      back[i] = x;
    }
    let pv = 0, pb = 0;
    for (let i = 0; i < n; i++) { pv += v[i] ** 2; pb += back[i] ** 2; }
    const g = Math.sqrt(pv / pb), mix = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { back[i] *= g; mix[i * 2] = mix[i * 2 + 1] = (v[i] + back[i]) * 0.5; }
    const song = wav(path.join(OUT, 'song.wav'), mix, SR, 2);
    const [folder] = await run('split-stems', [song], { format: 'wav' }, 'stems');
    const files = fs.readdirSync(folder).sort();
    ok(files.join() === 'backing.wav,vocals.wav', `stems folder holds ${files}`);
    const V = pcm(path.join(folder, 'vocals.wav'), SR, 2), B = pcm(path.join(folder, 'backing.wav'), SR, 2);
    const vv = corr(V, v, 2), vb = corr(V, back, 2), bb = corr(B, back, 2), bv = corr(B, v, 2), mv = corr(mix, v, 2);
    ok(vv > 0.8 && vv > mv + 0.1 && vb < 0.3, `vocal stem ~ voice ${vv.toFixed(2)} (mix ${mv.toFixed(2)}), ~ backing ${vb.toFixed(2)}`);
    ok(bb > 0.8 && bv < 0.3, `backing stem ~ backing ${bb.toFixed(2)}, ~ voice ${bv.toFixed(2)}`);
    const [karaoke] = await run('remove-vocals', [song], {}, 'karaoke');
    const K = pcm(karaoke, SR, 2);
    ok(corr(K, back, 2) > 0.8 && corr(K, v, 2) < 0.3, `karaoke ~ backing ${corr(K, back, 2).toFixed(2)}, ~ voice ${corr(K, v, 2).toFixed(2)}`);
    return `vocals ${vv.toFixed(2)}, backing ${bb.toFixed(2)}, karaoke ${corr(K, back, 2).toFixed(2)}`;
  }, 'stems');

  await check('read aloud · Markdown, Word and PDF text', async () => {
    const md = text('story.md', '# A short note\n\nThe **meeting** is on Thursday afternoon.\n\n- bring the figures\n- bring the plan\n');
    const [mp3] = await run('read-aloud', [md], { voice: 'en-GB', to: 'mp3', speed: '1.2' }, 'md');
    ok(mp3.endsWith('.mp3') && Number(probe(mp3).format.duration) > 2, 'short MP3');
    const [txt] = await run('speech-to-text', [mp3], { to: 'txt', lang: 'en' }, 'md-back');
    const t = fs.readFileSync(txt, 'utf8');
    ok(/meeting/i.test(t) && /figures/i.test(t), `read back: ${t.slice(0, 120)}`);
    const FX = process.env.LIME_FX, out = [];
    for (const f of ['doc.docx', 'doc.pdf']) {
      if (!FX || !fs.existsSync(path.join(FX, f))) continue;
      const words = (await E('voice').textOf(path.join(FX, f))).split(/\s+/).filter(Boolean);
      ok(words.length > 5, `${f}: no text`);
      out.push(`${f}: ${words.length} words`);
    }
    return [`${t.trim().slice(0, 50)}…`, ...out].join(' · ');
  }, 'espeak');
  return results;
};
