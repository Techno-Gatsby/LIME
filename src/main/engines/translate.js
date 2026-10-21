'use strict';
// Offline translation with Bergamot (Firefox Translations): a WebAssembly Marian runtime and small per-language models,
// all shipped inside Lime and unpacked on first use. Text goes through the models in HTML mode, so markup such as
// Word's run boundaries or a subtitle's <i> survives translation.
const U = require('./util');
const { fs, fsp, path } = U;
const helpers = require('../helpers');
const { translateVendor } = require('../diagrams');

const LANGS = [['en', 'English'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['hi', 'Hindi'], ['ar', 'Arabic']];
const NAME = Object.fromEntries(LANGS);
const vendor = () => translateVendor();
const root = () => path.join(U.cfg.user, 'helpers');
const shipped = (pair) => !!helpers.bundled(pair, vendor());
const available = () => !!helpers.bundled('bergamot', vendor());
const missing = (what) => Object.assign(new Error(`${what} isn’t in this build of Lime.`), { code: 'ENGINE_MISSING' });

function route(from, to) {
  if (from === to) return [];
  if (shipped(`${from}${to}`)) return [`${from}${to}`];
  if (from !== 'en' && to !== 'en' && shipped(`${from}en`) && shipped(`en${to}`)) return [`${from}en`, `en${to}`];
  throw missing(`Translating ${NAME[from] || from} into ${NAME[to] || to}`);
}

// The runtime runs in this thread rather than a thread of its own: Electron stalls a worker thread made once a window
// exists. Bergamot's worker script gets a stand-in for the web worker it expects, and its messages go straight through.
let engine = null, seq = 0;
const waits = new Map(), loaded = [];
async function start() {
  if (engine) return engine;
  const entry = await helpers.ensure('bergamot', vendor(), root());
  if (!entry) throw missing('Translation');
  const dir = path.dirname(entry), vm = require('vm');
  const scope = {
    onmessage: null,
    addEventListener(ev, cb) { if (ev === 'message') this.onmessage = cb; },
    postMessage({ id, result, error }) { const p = waits.get(id); if (!p) return; waits.delete(id); error ? p.no(Object.assign(new Error(error.message), { name: error.name })) : p.ok(result); },
    importScripts(...names) { for (const n of names) vm.runInThisContext(fs.readFileSync(path.join(dir, n), 'utf8'), { filename: path.join(dir, n) }); },
    async fetch(url) { return new Response(await fsp.readFile(url.pathname), { headers: { 'Content-Type': 'application/wasm' } }); },
    location: require('url').pathToFileURL(entry),
  };
  const had = { exception: process.listeners('uncaughtException'), rejection: process.listeners('unhandledRejection') };
  global.self = scope;
  try {
    vm.runInThisContext(fs.readFileSync(entry, 'utf8'), { filename: entry });
    engine = scope;
    await call('initialize', { cacheSize: 0 });
  } finally {
    // Emscripten's Node glue hooks the process to abort on any stray error; this thread is shared, so those come off again.
    for (const l of process.listeners('uncaughtException')) if (!had.exception.includes(l)) process.off('uncaughtException', l);
    for (const l of process.listeners('unhandledRejection')) if (!had.rejection.includes(l)) process.off('unhandledRejection', l);
  }
  return engine;
}
const call = (name, ...args) => new Promise((ok, no) => { const id = ++seq; waits.set(id, { ok, no }); engine.onmessage({ data: { id, name, args } }); });
async function load(pair) {
  if (loaded.includes(pair)) return;
  const file = await helpers.ensure(pair, vendor(), root());
  if (!file) throw missing(`The ${pair} model`);
  const dir = path.dirname(file), names = await fsp.readdir(dir);
  const buf = async (re) => { const b = await fsp.readFile(path.join(dir, names.find((n) => re.test(n)))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
  // The runtime's memory is small: keep the models a pivot needs, let the rest go.
  while (loaded.length >= 2) await call('freeTranslationModel', { from: loaded[0].slice(0, 2), to: loaded[0].slice(2) }).then(() => loaded.shift());
  await call('loadTranslationModel', { from: pair.slice(0, 2), to: pair.slice(2) }, { model: await buf(/^model\./), shortlist: await buf(/^lex\./), vocabs: [await buf(/^vocab\./)] });
  loaded.push(pair);
}

// Translates a list of strings; empty ones stay empty. html: the strings are HTML fragments.
async function translate(texts, from, to, { html = false, progress = () => {}, signal } = {}) {
  const pairs = route(from, to);
  if (!pairs.length) return texts.slice();
  await start();
  for (const p of pairs) await load(p);
  const models = pairs.map((p) => ({ from: p.slice(0, 2), to: p.slice(2) }));
  const out = texts.slice(), todo = texts.map((t, i) => [t, i]).filter(([t]) => /\p{L}/u.test(String(t || '').replace(/<[^>]*>/g, '')));
  for (let i = 0; i < todo.length; i += 24) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    const batch = todo.slice(i, i + 24);
    const res = await call('translate', { models, texts: batch.map(([t]) => ({ text: t, html })) });
    batch.forEach(([, at], k) => { out[at] = res[k].target.text; });
    progress(Math.min(1, (i + batch.length) / todo.length));
  }
  return out;
}

const STOP = {
  en: /\b(the|and|of|to|is|in|that|it|with|for|you|this|are|was)\b/g,
  de: /\b(der|die|und|das|ist|nicht|ich|mit|sie|ein|eine|auf|für|zu|den)\b/g,
  fr: /\b(le|la|les|et|est|des|une|un|pas|que|pour|dans|vous|du|sur)\b/g,
  es: /\b(el|la|los|las|y|es|que|una|un|por|para|con|del|se|no)\b/g,
};
function detect(text) {
  const s = String(text).slice(0, 20000);
  const arabic = (s.match(/[؀-ۿ]/g) || []).length, deva = (s.match(/[ऀ-ॿ]/g) || []).length, latin = (s.match(/[A-Za-zÀ-ɏ]/g) || []).length;
  if (arabic > latin && arabic >= deva) return 'ar';
  if (deva > latin) return 'hi';
  const low = s.toLowerCase(), score = Object.fromEntries(Object.entries(STOP).map(([k, re]) => [k, (low.match(re) || []).length]));
  return Object.entries(score).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(score).sort((a, b) => b[1] - a[1])[0][0] : 'en';
}

const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unHtml = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

// Plain text: paragraphs of wrapped lines translate as one piece, short or list-like lines one by one.
function textUnits(text) {
  const lines = text.split(/\r?\n/), units = [];
  let para = [];
  const flush = () => {
    if (!para.length) return;
    const wrapped = para.length > 1 && para.slice(0, -1).every((l) => l.trim().length > 40) && !para.some((l) => /^\s*([-*•]|\d+[.)])\s/.test(l));
    if (wrapped) units.push({ lines: para.length, text: para.map((l) => l.trim()).join(' '), lead: /^\s*/.exec(para[0])[0] });
    else for (const l of para) units.push({ lines: 1, text: l.trim(), lead: /^\s*/.exec(l)[0] });
    para = [];
  };
  for (const l of lines) { if (!l.trim() || l === '\f') { flush(); units.push({ raw: l }); } else para.push(l); }
  flush();
  return units;
}
async function plain(text, from, to, o) {
  const units = textUnits(text), todo = units.filter((u) => u.raw == null);
  const res = await translate(todo.map((u) => escHtml(u.text)), from, to, { ...o, html: true });
  todo.forEach((u, i) => { u.out = unHtml(res[i]); });
  return units.map((u) => (u.raw != null ? u.raw : `${u.lead}${u.out}`)).join('\n');
}

// Markdown: code, front matter and raw HTML blocks stay; inline code and link targets are protected.
async function markdown(text, from, to, o) {
  const lines = text.split(/\r?\n/), jobs = [];
  let fence = null, front = lines[0] === '---';
  lines.forEach((l, i) => {
    if (front) { if (i > 0 && /^(---|\.\.\.)\s*$/.test(l)) front = false; return; }
    const f = /^\s*(```+|~~~+)/.exec(l);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; return; }
    if (f) { fence = f[1]; return; }
    if (!l.trim() || /^\s*<\/?[a-z][^>]*>\s*$/i.test(l) || /^\s*(\|?\s*:?-{3,}:?\s*)+\|?\s*$/.test(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l) || /^ {4}|\t/.test(l)) return;
    if (/^\s*\|.*\|\s*$/.test(l)) { l.split('|').forEach((cell, c, all) => { if (c > 0 && c < all.length - 1 && cell.trim()) jobs.push({ i, cell: c, text: cell }); }); return; }
    const m = /^(\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)*)(.*)$/.exec(l);
    jobs.push({ i, lead: m[1], text: m[2] });
  });
  const keep = [];
  const prot = (s) => {
    let o = '', last = 0;
    for (const m of s.matchAll(/`[^`]+`|(!?)\[([^\]]*)\]\(([^)]*)\)/g)) {
      o += escHtml(s.slice(last, m.index)) + (m[0][0] === '`' ? `<code>${keep.push(m[0]) - 1}</code>` : `${m[1]}<a href="${keep.push(m[3]) - 1}">${escHtml(m[2])}</a>`);
      last = m.index + m[0].length;
    }
    return o + escHtml(s.slice(last));
  };
  const res = await translate(jobs.map((j) => prot(j.text.trim())), from, to, { ...o, html: true });
  const back = (s) => unHtml(s.replace(/<code>\s*(\d+)\s*<\/code>/g, '\u0001$1\u0002').replace(/<a href="(\d+)">([\s\S]*?)<\/a>/g, (a, n, t) => `[${t}](\u0001${n}\u0002)`)).replace(/\s*\u0001(\d+)\u0002\s*/g, (a, n, at, all) => `${at ? ' ' : ''}${keep[n]}${at + a.length < all.length ? ' ' : ''}`).replace(/\]\( (\S+) \)/g, ']($1)').replace(/ ([.,)])/g, '$1');
  jobs.forEach((j, k) => {
    const t = back(res[k]);
    if (j.cell != null) { const parts = lines[j.i].split('|'); const pad = /^\s*/.exec(j.text)[0], end = /\s*$/.exec(j.text)[0]; parts[j.cell] = `${pad}${t}${end}`; lines[j.i] = parts.join('|'); } else lines[j.i] = `${j.lead}${t}`;
  });
  return lines.join('\n');
}

// Subtitles: cue numbers and timings are copied exactly; only the words change.
const TIMING = /-->/;
async function subtitles(text, from, to, o, vtt) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n', blocks = text.replace(/^﻿/, '').split(/\r?\n\r?\n/), jobs = [];
  blocks.forEach((b, bi) => {
    const ls = b.split(/\r?\n/), t = ls.findIndex((l) => TIMING.test(l));
    if (t < 0 || (vtt && /^(NOTE|STYLE|REGION)\b/.test(ls[0]))) return;
    const body = ls.slice(t + 1);
    if (body.some((l) => l.trim())) jobs.push({ bi, head: ls.slice(0, t + 1), n: body.length, text: body.join(' ').replace(/\s+/g, ' ').trim() });
  });
  const res = await translate(jobs.map((j) => j.text.replace(/&(?![a-z#0-9]+;)/gi, '&amp;').replace(/<(?![/a-z])/gi, '&lt;')), from, to, { ...o, html: true });
  jobs.forEach((j, k) => {
    let t = unHtml(res[k].replace(/<(\/?)(i|b|u)>/g, '\u0001$1$2\u0002')).replace(/\u0001(\/?)(i|b|u)\u0002/g, '<$1$2>');
    if (j.n > 1 && t.length > 30) { const mid = t.length / 2, cut = [...t.matchAll(/ /g)].map((m) => m.index).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0]; if (cut) t = `${t.slice(0, cut)}${nl}${t.slice(cut + 1)}`; }
    blocks[j.bi] = [...j.head, t].join(nl);
  });
  return blocks.join(nl + nl);
}

// Word: each paragraph translates as one sentence group, with every run marked so its formatting comes back.
const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlUn = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (a, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (a, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const RUN = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, WT = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\s*\/>/g;
function paragraphs(xml) {
  const list = [];
  let s = xml, n = 0;
  const LEAF = /<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g;
  for (let guard = 0; guard < 20 && LEAF.test(s); guard++) {
    LEAF.lastIndex = 0;
    s = s.replace(LEAF, (p) => { list.push(p); return `\u0000${n++}\u0000`; });
  }
  return { list, skeleton: s };
}
async function word(file, from, to, o, out) {
  const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
  const z = unzipSync(new Uint8Array(await fsp.readFile(file)));
  const parts = Object.keys(z).filter((k) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(k));
  if (!parts.includes('word/document.xml')) throw new Error(`${path.basename(file)} isn’t a Word document.`);
  const docs = parts.map((k) => ({ k, ...paragraphs(strFromU8(z[k])) }));
  const jobs = [];
  for (const d of docs) d.list.forEach((p, pi) => {
    const runs = [];
    p.replace(/\u0000\d+\u0000/g, '').replace(RUN, (r) => { const t = [...r.matchAll(WT)].map((m) => xmlUn(m[1] || '')).join(''); runs.push(t); return r; });
    if (runs.join('').trim() && /\p{L}/u.test(runs.join(''))) jobs.push({ d, pi, runs, html: runs.map((t, i) => (t ? `<span id="r${i}">${escHtml(t)}</span>` : '')).join('') });
  });
  const res = await translate(jobs.map((j) => j.html), from, to, { ...o, html: true });
  jobs.forEach((j, k) => {
    const got = j.runs.map(() => '');
    let last = j.runs.findIndex((t) => t);
    const html = res[k];
    let at = 0;
    for (const m of html.matchAll(/<span id="r(\d+)">([\s\S]*?)<\/span>/g)) {
      const before = unHtml(html.slice(at, m.index));
      if (before) got[last] += before;
      last = Number(m[1]);
      got[last] += unHtml(m[2]);
      at = m.index + m[0].length;
    }
    const tail = unHtml(html.slice(at));
    if (tail) got[last] += tail;
    if (!/<span id="r\d+">/.test(html)) got[last] = unHtml(html);
    let ri = 0;
    j.d.list[j.pi] = j.d.list[j.pi].replace(RUN, (r) => {
      const t = got[ri++];
      if (t == null) return r;
      let first = true;
      return r.replace(WT, () => { if (!first) return '<w:t xml:space="preserve"></w:t>'; first = false; return `<w:t xml:space="preserve">${xmlEsc(t)}</w:t>`; });
    });
  });
  for (const d of docs) {
    let s = d.skeleton;
    for (let guard = 0; guard < 20 && /\u0000\d+\u0000/.test(s); guard++) s = s.replace(/\u0000(\d+)\u0000/g, (a, n) => d.list[n]);
    z[d.k] = strToU8(s);
  }
  if (z['word/settings.xml'] && to) z['word/settings.xml'] = strToU8(strFromU8(z['word/settings.xml']).replace(/(<w:themeFontLang\b[^>]*\bw:val=")[^"]*/, `$1${to}`));
  await fsp.writeFile(out, zipSync(z, { level: 6 }));
  return out;
}

const OUT_EXT = { pdf: 'txt', markdown: 'md' };
async function run(file, opts, ctx) {
  if (!available()) throw missing('Translation');
  const e = U.ext(file), to = opts.to || 'en';
  const o = { progress: (f) => ctx.progress(0.1 + f * 0.85, 'Translating'), signal: ctx.signal };
  ctx.progress(0.02, 'Reading');
  let text = null;
  if (e === 'pdf') {
    const tmp = await U.tmpDir('translate');
    try { text = (await fsp.readFile(await require('./pdf').toText(file, { password: opts.password }, path.join(tmp, 'p.txt')), 'utf8')).replace(/^﻿/, ''); } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
  } else if (e !== 'docx') text = (await fsp.readFile(file, 'utf8')).replace(/^﻿/, '');
  let from = opts.from && opts.from !== 'auto' ? opts.from : null;
  if (!from) {
    if (text == null) { const { unzipSync, strFromU8 } = require('fflate'); const x = strFromU8(unzipSync(new Uint8Array(await fsp.readFile(file)), { filter: (f) => f.name === 'word/document.xml' })['word/document.xml'] || new Uint8Array()); text = [...x.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(' '); from = detect(text); text = null; } else from = detect(text);
  }
  if (from === to) throw new Error(`This already looks like ${NAME[to]}. Choose another language, or set “From” if Lime guessed wrong.`);
  const out = ctx.out.file(file, `${U.base(file)}-${to}.${OUT_EXT[e] || e}`);
  if (e === 'docx') await word(file, from, to, o, out);
  else {
    const res = e === 'srt' ? await subtitles(text, from, to, o, false) : e === 'vtt' ? await subtitles(text, from, to, o, true) : e === 'md' || e === 'markdown' ? await markdown(text, from, to, o) : await plain(text, from, to, o);
    await fsp.writeFile(out, res, 'utf8');
  }
  ctx.progress(1, 'Done');
  return { path: out, note: `${NAME[from]} → ${NAME[to]}` };
}

module.exports = { LANGS, available, shipped, route, translate, detect, run, plain, markdown, subtitles, word };
