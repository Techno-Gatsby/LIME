'use strict';
// Dictation: tidy rules, then known clips fed in place of the microphone through the whole pipeline.
// Clips live in LIME_DICTATE_CLIPS (en10.wav, name.wav, cmd.wav, um.wav, hi.wav, ar.wav, made with Piper);
// the speech payload comes from LIME_AI and LIME_DICTATE (vendor/ai and vendor/dictate for a target).
const fs = require('fs');
const path = require('path');
const { clipboard } = require('electron');

module.exports = async ({ dir }) => {
  const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;
  const results = [];
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const skip = (m) => { throw Object.assign(new Error(m), { skip: true }); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = async (name, fn) => {
    name = `dictate: ${name}`;
    if (only && !only.test(name)) return;
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { status = e.skip ? 'SKIP' : 'FAIL'; detail = e.message; }
    console.log(`${status} ${name.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 300));
    results.push({ name, status, detail });
  };
  const { tidy, replaceAll } = require('../src/main/engines/tidy');
  const dictate = require('../src/main/dictate');
  const words = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
  // Word error rate: Levenshtein over words.
  const wer = (hyp, ref) => {
    const a = words(hyp), b = words(ref), d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length] / Math.max(1, b.length);
  };
  const pct = (x) => `${(x * 100).toFixed(0)}%`;

  await check('tidy: fillers, repeats, capitals, full stop', () => {
    const cases = [
      ['um so I think we should, uh, meet tomorrow', 'So I think we should meet tomorrow.'],
      ["I'll, I'll send it to the, to the site team", "I'll send it to the site team."],
      ['you know, the level eight pour is, like, late, you know', 'The level eight pour is late.'],
      ["let's meet on Mon- on Tuesday", "Let's meet on Tuesday."],
      ['i think that that is right', 'I think that that is right.'],
      ['So, um, the RFI is open. Uh, the NCR too.', 'So the RFI is open. The NCR too.'],
      ['The 3.5 metre beam, e.g. this one', 'The 3.5 metre beam, e.g. this one.'],
    ];
    for (const [i, o] of cases) ok(tidy(i) === o, `${JSON.stringify(i)} → ${JSON.stringify(tidy(i))}, not ${JSON.stringify(o)}`);
    return `${cases.length} cases`;
  });
  await check('tidy: spoken punctuation and commands', () => {
    const cases = [
      ['Dear Priya comma thanks for the update full stop new paragraph can we meet on Tuesday question mark', 'Dear Priya, thanks for the update.\n\nCan we meet on Tuesday?'],
      ['Dear Priya, comma, thanks for the update. Full stop. New paragraph. Can we meet on Tuesday? Question mark.', 'Dear Priya, thanks for the update.\n\nCan we meet on Tuesday?'],
      ['first line new line second line exclamation mark', 'First line\nSecond line!'],
      ['the trial period ends on Friday period', 'The trial period ends on Friday.'],
      ['one colon two semicolon three', 'One: two; three.'],
    ];
    for (const [i, o] of cases) ok(tidy(i) === o, `${JSON.stringify(i)} → ${JSON.stringify(tidy(i))}, not ${JSON.stringify(o)}`);
    return `${cases.length} cases`;
  });
  await check('tidy: numbers and dates', () => {
    const cases = [
      ['we need twenty five percent more and one or two trucks', 'We need 25% more and one or two trucks.'],
      ['it costs one hundred and twenty thousand dirhams', 'It costs 120,000 dirhams.'],
      ['the trial period ends on the third of October', 'The trial period ends on 3 October.'],
      ['send it by October 3rd at 3 p.m.', 'Send it by 3 October at 3 pm.'],
      ['level eight is forty two metres up', 'Level eight is 42 metres up.'],
    ];
    for (const [i, o] of cases) ok(tidy(i) === o, `${JSON.stringify(i)} → ${JSON.stringify(tidy(i))}, not ${JSON.stringify(o)}`);
    return `${cases.length} cases`;
  });
  await check('tidy: Hindi and Arabic keep their script and ending', () => {
    ok(tidy('नमस्ते आज की बैठक तीन बजे होगी', { lang: 'hi' }) === 'नमस्ते आज की बैठक तीन बजे होगी।', 'Hindi');
    ok(tidy('مرحبا الاجتماع في الساعة الثالثة', { lang: 'ar' }) === 'مرحبا الاجتماع في الساعة الثالثة.', 'Arabic');
    return 'danda and full stop';
  });
  await check('dictionary: replace list, whole words only', () => {
    const r = [['sober realty', 'Sobha Realty'], ['r f i', 'RFI']];
    ok(tidy('please call sober realty about the r f i', { replace: r }) === 'Please call Sobha Realty about the RFI.', tidy('please call sober realty about the r f i', { replace: r }));
    ok(replaceAll('a sober realty, sober realty.', r) === 'a Sobha Realty, Sobha Realty.', 'twice');
    ok(replaceAll('the sobered', [['sober', 'Sobha']]) === 'the sobered', 'inside a word');
    return 'ok';
  });

  const CLIPS = process.env.LIME_DICTATE_CLIPS;
  const have = (f) => CLIPS && fs.existsSync(path.join(CLIPS, f));
  const ready = () => { try { return require('../src/main/engines/speech-ai').have('whisper') && !!dictate.vendorOk(); } catch (_) { return false; } };
  const needs = (f) => { if (!ready()) skip('the speech payload isn’t vendored (set LIME_AI and LIME_DICTATE)'); if (!have(f)) skip(`no ${f} in LIME_DICTATE_CLIPS`); };
  const setDict = async (patch) => dictate.setConf(patch);
  const run = async (file, { speed = 2, autoEnd = true } = {}) => {
    const partials = [];
    const id = await dictate.feed(path.join(CLIPS, file), { speed, autoEnd, onPartial: (p) => partials.push(p) });
    const t0 = Date.now();
    while (!dictate.current()?.done) { if (Date.now() - t0 > 240000) throw new Error('took too long'); await sleep(100); }
    const c = dictate.current();
    ok(c.id === id, 'another dictation took over');
    if (c.error) throw new Error(c.error);
    return { ...c, partials };
  };
  const EN10 = 'Please send the revised level 8 formwork sequence to Hutchinson by Friday. Copy Tom Hill and the site team, and ask them to confirm the delivery dates for the concrete pour next week.';
  let base = null;
  await check('a 10 s clip: live partials, then tidied text under 15% WER', async () => {
    needs('en10.wav');
    await setDict({ lang: 'en', translate: false, tidy: true, autoCopy: true, autoStop: false, words: ['Hutchinson', 'Tom Hill'], replace: [] });
    const r = await run('en10.wav');
    base = r;
    ok(r.partials.length >= 2, `only ${r.partials.length} partials`);
    const live = r.partials.filter((p) => p.committed || p.stable || p.tail);
    ok(live.length >= 1, 'no partial carried text');
    const e = wer(r.text, EN10);
    ok(e < 0.15, `WER ${pct(e)}: ${JSON.stringify(r.text)}`);
    ok(/^[A-Z]/.test(r.text) && /[.!?]$/.test(r.text), 'not tidied');
    return `WER ${pct(e)} · ${r.partials.length} partials · final text ${(r.ms / 1000).toFixed(1)} s after stop · ${JSON.stringify(r.text)}`;
  });
  await check('copy puts the text on the clipboard', async () => {
    needs('en10.wav');
    ok(base, 'no dictation yet');
    const got = String(clipboard.readText() || '');
    ok(got === base.text, `clipboard has ${JSON.stringify(got.slice(0, 60))}`);
    return 'auto-copied on done';
  });
  await check('the hotkey registers', () => {
    const h = dictate.hotkey();
    ok(h.ok, `no shortcut could be registered (wanted ${h.wanted})`);
    return `${h.accel}${h.fellBack ? ` (fell back from ${h.wanted})` : ''}`;
  });
  await check('spoken commands become punctuation and paragraphs', async () => {
    needs('cmd.wav');
    await setDict({ lang: 'en', translate: false, tidy: true, autoCopy: false, words: ['Priya'], replace: [] });
    const r = await run('cmd.wav');
    ok(r.text.includes('\n\n'), `no new paragraph: ${JSON.stringify(r.text)}`);
    ok(/\?$/.test(r.text), `no question mark at the end: ${JSON.stringify(r.text)}`);
    ok(/^Dear Priya,/.test(r.text), `no comma after the name: ${JSON.stringify(r.text)}`);
    return JSON.stringify(r.text);
  });
  await check('fillers and false starts are dropped from speech', async () => {
    needs('um.wav');
    await setDict({ lang: 'en', translate: false, tidy: true, autoCopy: false, words: [], replace: [] });
    const r = await run('um.wav');
    ok(!/\b(um|uh)\b/i.test(r.text), `filler kept: ${JSON.stringify(r.text)}`);
    ok(!/\bI think,? I think\b/i.test(r.text), `repeat kept: ${JSON.stringify(r.text)}`);
    ok(/3 October/.test(r.text), `date not written as a number: ${JSON.stringify(r.text)}`);
    return `${JSON.stringify(r.raw)} → ${JSON.stringify(r.text)}`;
  });
  await check('the dictionary prompt helps on a made-up name', async () => {
    needs('name.wav');
    const NAME = 'Zorvathi Kelmont';
    await setDict({ lang: 'en', translate: false, tidy: true, autoCopy: false, words: [], replace: [] });
    const plain = await run('name.wav', { speed: 4 });
    await setDict({ words: [NAME] });
    const primed = await run('name.wav', { speed: 4 });
    const hit = (t) => words(t).filter((w) => words(NAME).includes(w)).length;
    ok(hit(primed.text) >= hit(plain.text), `with the name in the dictionary: ${JSON.stringify(primed.text)}; without: ${JSON.stringify(plain.text)}`);
    ok(hit(primed.text) >= 1, `the name never came through: ${JSON.stringify(primed.text)}`);
    return `${hit(plain.text)}/2 name words without, ${hit(primed.text)}/2 with · ${JSON.stringify(primed.text)}`;
  });
  await check('the replace list fixes a misheard name', async () => {
    needs('name.wav');
    await setDict({ lang: 'en', translate: false, tidy: true, autoCopy: false, words: [], replace: [['before noon', 'before 12:00']] });
    const r = await run('name.wav', { speed: 4 });
    ok(r.text.includes('before 12:00'), JSON.stringify(r.text));
    return JSON.stringify(r.text);
  });
  const HI = 'नमस्ते आज की बैठक तीन बजे होगी', AR = 'مرحبا الاجتماع سيكون في الساعة الثالثة';
  await check('Hindi is recognised', async () => {
    needs('hi.wav');
    await setDict({ lang: 'hi', translate: false, tidy: true, autoCopy: false, words: [], replace: [] });
    const r = await run('hi.wav', { speed: 4 });
    const e = wer(r.text, HI);
    if (!/[ऀ-ॿ]/.test(r.text) || e > 0.6) skip(`the ${dictate.hasSmall() ? 'small' : 'base'} model can’t read this Hindi clip (WER ${pct(e)}): ${JSON.stringify(r.text)}`);
    ok(r.text.endsWith('।'), `no danda: ${JSON.stringify(r.text)}`);
    return `WER ${pct(e)} · ${JSON.stringify(r.text)}`;
  });
  await check('Arabic is recognised and shown right to left', async () => {
    needs('ar.wav');
    await setDict({ lang: 'ar', translate: false, tidy: true, autoCopy: false, words: [], replace: [] });
    const r = await run('ar.wav', { speed: 4 });
    const e = wer(r.text, AR);
    if (!/[؀-ۿ]/.test(r.text) || e > 0.6) skip(`the model can’t read this Arabic clip (WER ${pct(e)}): ${JSON.stringify(r.text)}`);
    const dirAttr = await dictate.window().webContents.executeJavaScript('document.querySelector(".text").dir');
    ok(dirAttr === 'rtl', `text direction ${dirAttr}`);
    return `WER ${pct(e)} · ${JSON.stringify(r.text)}`;
  });
  await check('“Give me English” translates Hindi', async () => {
    needs('hi.wav');
    if (!dictate.hasSmall()) skip('the small model isn’t vendored (LIME_WHISPER_SMALL=1 at build); base can’t translate Hindi');
    await setDict({ lang: 'auto', translate: true, tidy: true, autoCopy: false, words: [], replace: [] });
    const r = await run('hi.wav', { speed: 4 });
    ok(/meeting/i.test(r.text) && /3|three/i.test(r.text), JSON.stringify(r.text));
    return JSON.stringify(r.text);
  });
  await check('stop when I stop talking', async () => {
    needs('name.wav');
    await setDict({ lang: 'en', translate: false, tidy: true, autoCopy: false, autoStop: true, words: [], replace: [] });
    const r = await run('name.wav', { speed: 1, autoEnd: false });
    ok(r.text, 'no text');
    return `stopped on its own, ${(r.secs || 0).toFixed(1)} s heard`;
  });
  await setDict({ lang: 'auto', translate: false, autoCopy: true, autoStop: false, words: [], replace: [] });
  dictate.close();
  return results;
};
