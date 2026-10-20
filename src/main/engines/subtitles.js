'use strict';
// Text subtitles without FFmpeg: SRT, WebVTT, ASS/SSA, SAMI, LRC, TTML/DFXP, MicroDVD and SCC (CEA-608) are read into
// one cue model and written as SRT, WebVTT, ASS, SAMI, LRC, TTML or MicroDVD, always UTF-8. Korean CP949 files are
// recognised. Cue text uses SRT's own markup: <i> <b> <u> <font color="#RRGGBB">. Logic adapted from Filee by
// KnifeLemon (MIT).

const U = require('./util');
const { fsp, path } = U;
const { decodeSubtitle } = require('./textcodec');

const DEFAULT_MS = 4000;
const READS = { srt: 'srt', vtt: 'vtt', ass: 'ass', ssa: 'ass', smi: 'smi', sami: 'smi', lrc: 'lrc', ttml: 'ttml', dfxp: 'ttml', sub: 'sub', scc: 'scc' };
const WRITES = ['srt', 'vtt', 'ass', 'smi', 'lrc', 'ttml', 'sub'];

// ───────── Markup ─────────
const CANON = /<(\/?)(i|b|u)>|<font color="#([0-9A-Fa-f]{6})">|<\/font>/g;
function tokens(t) {
  const out = [];
  const addText = (s) => s.split('\n').forEach((line, i) => { if (i) out.push({ k: 'br' }); if (line) out.push({ k: 'text', v: line }); });
  let pos = 0;
  for (const m of t.matchAll(CANON)) {
    addText(t.slice(pos, m.index));
    if (m[3]) out.push({ k: 'open', v: `#${m[3].toUpperCase()}` });
    else if (m[0] === '</font>') out.push({ k: 'close', v: 'font' });
    else out.push({ k: m[1] ? 'close' : 'open', v: m[2] });
    pos = m.index + m[0].length;
  }
  addText(t.slice(pos));
  return out;
}
const isColor = (v) => v.startsWith('#');
const render = (toks) => toks.map((t) => (t.k === 'text' ? t.v : t.k === 'br' ? '\n' : t.k === 'open' ? (isColor(t.v) ? `<font color="${t.v}">` : `<${t.v}>`) : `</${t.v}>`)).join('');
const plainText = (t) => tokens(t).map((x) => (x.k === 'text' ? x.v : x.k === 'br' ? '\n' : '')).join('');
// Tags nested properly (overlaps closed and reopened), unclosed ones closed, stray closes and empty styles dropped,
// spaces collapsed, empty lines removed.
function normalize(t) {
  const toks = tokens(String(t).replace(/\r\n?/g, '\n').replace(/[\u00a0\t]/g, ' '));
  const out = [], open = [];
  const closeOf = (v) => (isColor(v) ? 'font' : v);
  for (const tok of toks) {
    if (tok.k === 'open') { if (!isColor(tok.v) && open.includes(tok.v)) continue; open.push(tok.v); out.push(tok); } else if (tok.k === 'close') {
      let i = open.length - 1;
      while (i >= 0 && !(tok.v === 'font' ? isColor(open[i]) : open[i] === tok.v)) i--;
      if (i < 0) continue;
      const reopen = open.slice(i + 1);
      for (let j = open.length - 1; j >= i; j--) out.push({ k: 'close', v: closeOf(open[j]) });
      open.length = i;
      for (const v of reopen) { open.push(v); out.push({ k: 'open', v }); }
    } else out.push(tok);
  }
  for (let j = open.length - 1; j >= 0; j--) out.push({ k: 'close', v: closeOf(open[j]) });
  for (let i = 0; i + 1 < out.length;) if (out[i].k === 'open' && out[i + 1].k === 'close') { out.splice(i, 2); i = Math.max(0, i - 1); } else i++;
  return render(out).split('\n').map((l) => l.replace(/ {2,}/g, ' ').trim()).filter((l) => plainText(l).trim()).join('\n');
}
const COLORS = { white: '#FFFFFF', black: '#000000', red: '#FF0000', lime: '#00FF00', green: '#008000', blue: '#0000FF', yellow: '#FFFF00', cyan: '#00FFFF', aqua: '#00FFFF', magenta: '#FF00FF', fuchsia: '#FF00FF', gray: '#808080', grey: '#808080', silver: '#C0C0C0', orange: '#FFA500', purple: '#800080', maroon: '#800000', navy: '#000080', olive: '#808000', teal: '#008080', pink: '#FFC0CB' };
const VTT_COLORS = ['white', 'lime', 'cyan', 'red', 'yellow', 'magenta', 'blue', 'black'];
function parseColor(value) {
  const v = String(value).trim().replace(/^["']+|["']+$/g, '').trim();
  const rgb = /^rgb[a]?\s*\(([^)]*)\)$/i.exec(v);
  if (rgb) { const p = rgb[1].split(',').map((x) => x.trim()); return p.length >= 3 && p.slice(0, 3).every((x) => /^\d+$/.test(x) && Number(x) <= 255) ? `#${p.slice(0, 3).map((x) => Number(x).toString(16).toUpperCase().padStart(2, '0')).join('')}` : null; }
  if (COLORS[v.toLowerCase()]) return COLORS[v.toLowerCase()];
  const hex = v.replace(/^#+/, '');
  if (!/^[0-9A-Fa-f]+$/.test(hex)) return null;
  return hex.length === 3 ? `#${[...hex].map((c) => c + c).join('').toUpperCase()}` : hex.length === 6 || hex.length === 8 ? `#${hex.slice(0, 6).toUpperCase()}` : null;
}
const colorName = (hex) => VTT_COLORS.find((n) => COLORS[n] === hex) || null;
function assColor(value) {
  let hex = String(value).replace(/^&+|&+$/g, '').replace(/^[Hh]+/, '');
  if (!hex || !/^[0-9A-Fa-f]+$/.test(hex)) return null;
  hex = hex.padStart(6, '0').slice(-6);
  return `#${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`.toUpperCase();
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', deg: '°', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿', shy: '\u00ad', times: '×', divide: '÷' };
const decodeEntities = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m; }
  return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
});
// HTML-like cue text (SRT, WebVTT, SAMI) to markup: i/b/u, colours and WebVTT colour classes kept, br breaks the
// line, other tags dropped with their text kept.
function fromHtml(t, entities) {
  let out = '', pos = 0, colors = 0;
  const classes = [];
  const add = (s) => { out += (entities ? decodeEntities(s) : s).replace(/[\u200e\u200f\u200b]/g, ''); };
  for (const m of t.matchAll(/<\s*(\/?)\s*([^\s>/]+)([^>]*)>/g)) {
    add(t.slice(pos, m.index));
    pos = m.index + m[0].length;
    const closing = !!m[1], name = m[2].toLowerCase();
    if (name === 'c' || name.startsWith('c.')) {
      if (closing) { if (classes.length && classes.pop()) out += '</font>'; continue; }
      const c = name.split('.').slice(1).map((x) => COLORS[x]).find(Boolean);
      classes.push(!!c);
      if (c) out += `<font color="${c}">`;
      continue;
    }
    if (name === 'i' || name === 'em') out += closing ? '</i>' : '<i>';
    else if (name === 'b' || name === 'strong') out += closing ? '</b>' : '<b>';
    else if (name === 'u') out += closing ? '</u>' : '<u>';
    else if (name === 'br') out += '\n';
    else if (name === 'font' && closing) { if (colors > 0) { colors--; out += '</font>'; } } else if (name === 'font') {
      const a = /color\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(m[3]);
      const c = a && parseColor(a[1]);
      if (c) { colors++; out += `<font color="${c}">`; }
    }
  }
  add(t.slice(pos));
  return out;
}

// ───────── Model ─────────
const newDoc = () => ({ cues: [], title: null, language: null });
function add(doc, start, end, t) {
  start = Math.max(0, start);
  const n = normalize(t);
  if (end <= start || !plainText(n).trim()) return;
  doc.cues.push({ start, end, text: n });
}
function finish(doc) {
  const seen = new Set();
  doc.cues = doc.cues.filter((c) => { const k = `${c.start}|${c.end}|${c.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  doc.cues.sort((a, b) => a.start - b.start || a.end - b.end);
  return doc;
}
function guessLanguage(doc) {
  if (doc.language && doc.language.trim()) return doc.language;
  let hangul = 0, kana = 0, han = 0;
  for (const c of doc.cues.map((x) => x.text).join('')) {
    if (/[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/.test(c)) hangul++;
    else if (/[\u3040-\u30ff]/.test(c)) kana++;
    else if (/[\u4e00-\u9fff]/.test(c)) han++;
  }
  if (hangul > 0 && hangul >= kana && hangul >= han / 4) return 'ko-KR';
  return kana > 0 ? 'ja-JP' : han > 0 ? 'zh-CN' : 'en-US';
}
const time = (h, m, s, f) => ((Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0)) * 1000 + (f ? Math.round(parseFloat(`0.${f}`) * 1000) : 0);
const pad = (n, w = 2) => String(n).padStart(w, '0');
const msTime = (ms, sep) => { ms = Math.round(Math.max(0, ms)); return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`; };
const csTime = (ms) => { const cs = Math.round(Math.max(0, ms) / 10); return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`; };
const lrcTime = (ms) => { const cs = Math.round(Math.max(0, ms) / 10); return `${pad(Math.floor(cs / 6000))}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`; };

// ───────── Readers ─────────
const ASS_BLOCK = /\{[^}]*\}/g;
function readSrt(src) {
  const doc = newDoc();
  let cue = null, body = [];
  const flush = (beforeNext) => {
    if (!cue) return;
    while (body.length && !body[body.length - 1].trim()) body.pop();
    if (beforeNext && body.length && /^\d+$/.test(body[body.length - 1].trim())) body.pop();
    add(doc, cue[0], cue[1], fromHtml(body.join('\n').replace(ASS_BLOCK, ''), false));
  };
  for (const line of src.split('\n')) {
    const m = /(\d+):(\d{1,2}):(\d{1,2})(?:[,.:](\d{1,3}))?\s*-+>\s*(\d+):(\d{1,2}):(\d{1,2})(?:[,.:](\d{1,3}))?/.exec(line);
    if (m) { flush(true); cue = [time(m[1], m[2], m[3], m[4]), time(m[5], m[6], m[7], m[8])]; body = []; } else if (cue) body.push(line);
  }
  flush(false);
  return doc;
}
function readVtt(src) {
  const doc = newDoc();
  for (const block of src.replace(/^[\n \ufeff]+|[\n \ufeff]+$/g, '').split(/\n[ \t]*\n+/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0 && lines[0].startsWith('WEBVTT')) { const l = lines.find((x) => /^language:/i.test(x)); if (l) doc.language = l.slice(9).trim(); continue; }
    if (at < 0 || at > 1 || lines[0].startsWith('NOTE')) continue;
    const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s+-->\s+(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(lines[at]);
    if (m) add(doc, time(m[1], m[2], m[3], m[4]), time(m[5], m[6], m[7], m[8]), fromHtml(lines.slice(at + 1).join('\n'), true));
  }
  return doc;
}
const ASS_TAG = /\\(1c|2c|3c|4c|1a|2a|3a|4a|alpha|an|fn|fs|fscx|fscy|fsp|fr[xyz]?|fe|bord|xbord|ybord|shad|xshad|yshad|be|blur|pos|move|org|clip|iclip|fad|fade|kf|ko|k|K|q|t|p|r|i|b|u|s|c|a)([^\\]*)/g;
function assText(t) {
  let out = '', pos = 0, drawing = false;
  const plain = (s) => s.replace(/\\N/g, '\n').replace(/\\n/g, ' ').replace(/\\h/g, '\u00a0');
  for (const b of t.matchAll(ASS_BLOCK)) {
    if (!drawing) out += plain(t.slice(pos, b.index));
    pos = b.index + b[0].length;
    for (const tag of b[0].slice(1, -1).matchAll(ASS_TAG)) {
      const name = tag[1], arg = tag[2].trim();
      if (name === 'i' || name === 'b' || name === 'u') {
        const on = arg !== '' && arg !== '0' && !(name === 'b' && /^\d+$/.test(arg) && Number(arg) > 1 && Number(arg) < 600);
        out += on ? `<${name}>` : `</${name}>`;
      } else if (name === 'c' || name === '1c') { out += '</font>'; const c = assColor(arg); if (c) out += `<font color="${c}">`; } else if (name === 'r') out += '</font></u></b></i>';
      else if (name === 'p') drawing = arg !== '' && arg !== '0';
    }
  }
  if (!drawing) out += plain(t.slice(pos));
  return !plainText(normalize(out)).trim() && t.includes('\\p') ? null : out;
}
function readAss(src) {
  const doc = newDoc();
  let section = '', styleFormat = ['name', 'fontname', 'fontsize', 'primarycolour', 'secondarycolour', 'outlinecolour', 'backcolour', 'bold', 'italic', 'underline'];
  let eventFormat = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  const styles = new Map();
  const ASS_TIME = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?$/;
  for (const raw of src.split('\n')) {
    const line = raw.trim().replace(/^\ufeff+/, '');
    if (line.startsWith('[') && line.endsWith(']')) { section = line.slice(1, -1).trim().toLowerCase(); continue; }
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trimStart();
    if (section === 'script info' && key === 'title' && value && value !== '<untitled>') doc.title = value;
    else if (key === 'format' && section.includes('styles')) styleFormat = value.split(',').map((f) => f.trim().toLowerCase());
    else if (key === 'format' && section === 'events') eventFormat = value.split(',').map((f) => f.trim().toLowerCase());
    else if (key === 'style' && section.includes('styles')) {
      const f = value.split(','), field = (n) => (styleFormat.indexOf(n) >= 0 && styleFormat.indexOf(n) < f.length ? f[styleFormat.indexOf(n)].trim() : '');
      const on = (x) => x === '-1' || x === '1';
      styles.set(field('name').toLowerCase(), (on(field('bold')) ? '<b>' : '') + (on(field('italic')) ? '<i>' : '') + (on(field('underline')) ? '<u>' : ''));
    } else if (key === 'dialogue' && section === 'events') {
      const parts = value.split(','), n = eventFormat.length;
      const f = parts.length > n ? [...parts.slice(0, n - 1), parts.slice(n - 1).join(',')] : parts;
      const field = (name) => (eventFormat.indexOf(name) >= 0 && eventFormat.indexOf(name) < f.length ? f[eventFormat.indexOf(name)].trim() : '');
      const s = ASS_TIME.exec(field('start')), e = ASS_TIME.exec(field('end'));
      if (!s || !e) continue;
      const ti = eventFormat.indexOf('text');
      const markup = assText(ti >= 0 && ti < f.length ? f[ti] : '');
      if (markup == null) continue;
      add(doc, time(s[1], s[2], s[3], s[4]), time(e[1], e[2], e[3], e[4]), (styles.get(field('style').replace(/^\*/, '').toLowerCase()) || '') + markup);
    }
  }
  return doc;
}
function readLrc(src) {
  const doc = newDoc();
  let offset = 0;
  const entries = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim().replace(/^\ufeff+/, '');
    const meta = /^\[([A-Za-z]+):([^\]]*)\]\s*$/.exec(line);
    if (meta) {
      const k = meta[1].toLowerCase(), v = meta[2].trim();
      if (k === 'ti' && v) doc.title = v;
      else if ((k === 'la' || k === 'lang') && v) doc.language = v;
      else if (k === 'offset' && /^[-+]?\d+$/.test(v)) offset = Number(v);
      continue;
    }
    const times = [];
    const re = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/y;
    let m, end = 0;
    while ((m = re.exec(line))) { times.push(time(0, m[1], m[2], m[3])); end = re.lastIndex; }
    if (!times.length) continue;
    const lyric = line.slice(end).replace(/<\d+:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
    for (const t of times) entries.push({ t, lyric });
  }
  entries.sort((a, b) => a.t - b.t);
  entries.forEach((e, i) => { if (e.lyric) add(doc, e.t - offset, (i + 1 < entries.length ? entries[i + 1].t : e.t + DEFAULT_MS) - offset, e.lyric); });
  return doc;
}
function microDvdText(body) {
  const all = [], lines = [];
  const styles = (k, v) => (k.toLowerCase() === 'y' ? [...v.toLowerCase()].filter((c) => 'ibu'.includes(c)) : k.toLowerCase() === 'c' && assColor(v.replace(/^\$/, '')) ? [assColor(v.replace(/^\$/, ''))] : []);
  const open = (s) => s.map((x) => (isColor(x) ? `<font color="${x}">` : `<${x}>`)).join('');
  const close = (s) => [...s].reverse().map((x) => (isColor(x) ? '</font>' : `</${x}>`)).join('');
  for (const part of body.split('|')) {
    const own = [];
    for (const m of part.matchAll(/\{([A-Za-z]):([^}]*)\}/g)) (m[1] === m[1].toUpperCase() ? all : own).push(...styles(m[1], m[2]));
    lines.push(open(own) + part.replace(/\{([A-Za-z]):([^}]*)\}/g, '') + close(own));
  }
  return open(all) + lines.join('\n') + close(all);
}
function readMicroDvd(src) {
  const doc = newDoc();
  let fps = 23.976;
  const lines = [];
  for (const raw of src.split('\n')) {
    const m = /^\{(\d+)\}\{(\d*)\}(.*)$/.exec(raw.trim().replace(/^\ufeff+/, ''));
    if (!m) continue;
    const start = Number(m[1]), end = m[2] ? Number(m[2]) : null, rate = Number(m[3].trim());
    if (!lines.length && start <= 1 && /^\d+(\.\d+)?$/.test(m[3].trim()) && rate > 1 && rate < 200) { fps = rate; continue; }
    lines.push({ start, end, body: m[3] });
  }
  if (!lines.length) throw new Error('This .sub file is not a MicroDVD subtitle ({frame}{frame}text lines). SubViewer and VobSub .sub files are not supported.');
  const at = (f) => (f / fps) * 1000;
  lines.forEach((l, i) => add(doc, at(l.start), l.end != null && l.end > l.start ? at(l.end) : i + 1 < lines.length ? at(lines[i + 1].start) : at(l.start) + DEFAULT_MS, microDvdText(l.body)));
  return doc;
}
function readSami(src) {
  const doc = newDoc();
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src);
  if (title && decodeEntities(title[1]).trim()) doc.title = decodeEntities(title[1]).trim();
  const start = /<body[^>]*>/i.exec(src);
  const body = (start ? src.slice(start.index + start[0].length) : src).replace(/<!--[\s\S]*?-->/g, '');
  const syncs = [...body.matchAll(/<sync\b[^>]*?start\s*=\s*["']?(-?\d+)[^>]*>/gi)];
  const entries = [];
  const textOf = (html) => fromHtml(html.replace(/&nbsp;?/gi, '&nbsp;').replace(/\s+/g, ' '), true);
  syncs.forEach((s, i) => {
    const content = body.slice(s.index + s[0].length, i + 1 < syncs.length ? syncs[i + 1].index : body.length).replace(/<\/body\s*>[\s\S]*|<\/sami\s*>[\s\S]*/i, '');
    const t = Math.max(0, Number(s[1]));
    const ps = [...content.matchAll(/<p\b([^>]*)>/gi)];
    if (!ps.length) { entries.push({ t, cls: '', text: textOf(content) }); return; }
    ps.forEach((p, j) => {
      const cls = /class\s*=\s*["']?([\w-]+)/i.exec(p[1]);
      entries.push({ t, cls: cls ? cls[1].toUpperCase() : '', text: textOf(content.slice(p.index + p[0].length, j + 1 < ps.length ? ps[j + 1].index : content.length)) });
    });
  });
  const counts = new Map();
  for (const e of entries) if (e.cls && plainText(e.text).trim()) counts.set(e.cls, (counts.get(e.cls) || 0) + 1);
  let chosen = '';
  for (const [cls, n] of counts) if (!chosen || n > counts.get(chosen)) chosen = cls;
  const lines = entries.filter((e) => !e.cls || e.cls === chosen).sort((a, b) => a.t - b.t);
  lines.forEach((l, i) => {
    const end = i + 1 < lines.length ? lines[i + 1].t : l.t + DEFAULT_MS;
    if (end === l.t && i + 1 < lines.length) return;
    add(doc, l.t, end, l.text);
  });
  if (chosen) {
    const rule = new RegExp(`\\.${chosen.replace(/[-]/g, '\\-')}\\s*\\{([^}]*)\\}`, 'i').exec(src);
    const lang = rule && /lang\s*:\s*([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)/i.exec(rule[1]);
    if (lang) doc.language = lang[1];
  }
  return doc;
}
function readTtml(src) {
  const { SaxesParser } = require('saxes');
  const parser = new SaxesParser({ xmlns: true });
  let root = null;
  const stack = [];
  parser.on('opentag', (n) => {
    const el = { local: n.local, attrs: Object.values(n.attributes).filter((a) => a.prefix !== 'xmlns' && a.name !== 'xmlns').map((a) => [a.local, a.value.trim()]), kids: [] };
    if (stack.length) stack[stack.length - 1].kids.push(el); else root = el;
    stack.push(el);
  });
  const text = (t) => { if (stack.length) stack[stack.length - 1].kids.push(t); };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', () => stack.pop());
  try { parser.write(src).close(); } catch (e) { throw new Error(`The TTML file is not valid XML: ${e.message}`); }
  if (!root) throw new Error('The TTML file is empty.');
  const attr = (el, name) => el.attrs.find(([k]) => k === name)?.[1] ?? null;
  const elements = (el) => el.kids.filter((k) => typeof k !== 'string');
  const descendants = (el) => elements(el).flatMap((k) => [k, ...descendants(k)]);
  const textOf = (el) => el.kids.map((k) => (typeof k === 'string' ? k : textOf(k))).join('');
  const num = (t, fb) => { const v = parseFloat(t); return /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(t || '') && v > 0 ? v : fb; };
  const ratio = (t) => { const p = String(t || '').split(' ').filter(Boolean); return p.length === 2 && num(p[0], 0) > 0 && num(p[1], 0) > 0 ? num(p[0], 0) / num(p[1], 0) : 1; };
  const doc = newDoc();
  doc.language = attr(root, 'lang');
  const frameRate = num(attr(root, 'frameRate'), 30) * ratio(attr(root, 'frameRateMultiplier'));
  let tickRate = num(attr(root, 'tickRate'), 0);
  if (tickRate <= 0) tickRate = frameRate > 0 ? frameRate : 1;
  const styles = new Map();
  for (const d of descendants(root)) if (d.local === 'style' && attr(d, 'id') != null && !styles.has(attr(d, 'id'))) styles.set(attr(d, 'id'), d);
  const title = descendants(root).find((d) => d.local === 'title' && textOf(d).trim());
  if (title) doc.title = textOf(title).trim();
  const tm = (v) => {
    if (!v || !v.trim()) return null;
    let m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/.exec(v);
    if (m) return (Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]) + (m[4] && frameRate > 0 ? parseFloat(m[4]) / frameRate : 0)) * 1000;
    m = /^(\d+(?:\.\d+)?)(h|ms|m|s|f|t)$/.exec(v);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return { h: n * 3600, m: n * 60, ms: n / 1000, s: n, f: frameRate > 0 ? n / frameRate : 0, t: tickRate > 0 ? n / tickRate : 0 }[m[2]] * 1000;
  };
  const styleOf = (el) => {
    const sources = [...String(attr(el, 'style') || '').split(' ').filter(Boolean).map((id) => styles.get(id)).filter(Boolean), el];
    const out = [];
    for (const s of sources) {
      if (['italic', 'oblique'].includes(attr(s, 'fontStyle')) && !out.includes('i')) out.push('i');
      if (attr(s, 'fontWeight') === 'bold' && !out.includes('b')) out.push('b');
      if (String(attr(s, 'textDecoration') || '').includes('underline') && !out.includes('u')) out.push('u');
      const c = attr(s, 'color') != null && parseColor(attr(s, 'color'));
      if (c && c !== '#FFFFFF') { const i = out.findIndex(isColor); if (i >= 0) out.splice(i, 1); out.push(c); }
    }
    return out;
  };
  const content = (el) => {
    const st = styleOf(el);
    let s = st.map((x) => (isColor(x) ? `<font color="${x}">` : `<${x}>`)).join('');
    for (const k of el.kids) s += typeof k === 'string' ? k.replace(/\s+/g, ' ') : k.local === 'br' ? '\n' : k.local === 'span' ? content(k) : '';
    return s + [...st].reverse().map((x) => (isColor(x) ? '</font>' : `</${x}>`)).join('');
  };
  const visit = (el, parentBegin, parentEnd) => {
    const begin = parentBegin + (tm(attr(el, 'begin')) ?? 0);
    const e = tm(attr(el, 'end')), d = tm(attr(el, 'dur'));
    const end = e != null ? parentBegin + e : d != null ? begin + d : parentEnd;
    if (el.local === 'p') { add(doc, begin, end ?? begin + DEFAULT_MS, content(el)); return; }
    for (const k of elements(el)) if (k.local === 'div' || k.local === 'p') visit(k, begin, end);
  };
  const body = elements(root).find((k) => k.local === 'body');
  if (body) visit(body, 0, null);
  return doc;
}

// SCC: CEA-608 caption channel 1, one byte pair per frame at 29.97 fps; doubled control codes count once.
const FRAME_MS = 1001 / 30;
const SPECIAL = '®°½¿™¢£♪à èâêîôû', EXT1 = 'ÁÉÓÚÜü‘¡*’—©℠•“”ÀÂÇÈÊËëÎÏïÔÙùÛ«»', EXT2 = 'ÃãÍÌìÒòÕõ{}\\^_|~ÄäÖöß¥¤│ÅåØø┌┐└┘';
const BASIC = { 0x2a: 'á', 0x5c: 'é', 0x5e: 'í', 0x5f: 'ó', 0x60: 'ú', 0x7b: 'ç', 0x7c: '÷', 0x7d: 'Ñ', 0x7e: 'ñ', 0x7f: '█' };
class Memory {
  constructor() { this.rows = new Map(); this.row = 15; this.italic = false; this.firstWrite = null; }
  get cur() { if (!this.rows.has(this.row)) this.rows.set(this.row, ''); return this.row; }
  append(t, s) { if (this.firstWrite == null) this.firstWrite = t; const r = this.cur; this.rows.set(r, this.rows.get(r) + s); }
  setItalic(on) { if (on !== this.italic) { const r = this.cur; this.rows.set(r, this.rows.get(r) + (on ? '<i>' : '</i>')); } this.italic = on; }
  moveTo(row, italic) { if (this.italic) { const r = this.cur; this.rows.set(r, `${this.rows.get(r)}</i>`); } this.row = row; this.italic = false; this.setItalic(italic); }
  backspace() { const r = this.cur, s = this.rows.get(r); if (s && !s.endsWith('>')) this.rows.set(r, s.slice(0, -1)); }
  clearRow() { this.rows.delete(this.row); }
  get sorted() { return [...this.rows].sort((a, b) => a[0] - b[0]); }
  get isEmpty() { return this.sorted.every(([, s]) => !plainText(s).trim()); }
  get text() { return this.sorted.map(([, s]) => s + (s.includes('<i>') ? '</i>' : '')).join('\n'); }
  rolledUp(n) {
    const next = new Memory();
    const kept = n > 1 ? this.sorted.filter(([, s]) => plainText(s).trim()).slice(-(n - 1)) : [];
    kept.forEach(([, s], i) => next.rows.set(15 - kept.length + i, s));
    return next;
  }
}
function readScc(src) {
  if (!/^scenarist_scc/i.test(src.replace(/^[\ufeff \n]+/, ''))) throw new Error('This is not an SCC file (it must start with "Scenarist_SCC V1.0").');
  const doc = newDoc();
  let mode = 'pop', rollRows = 2, displayed = new Memory(), hidden = new Memory(), shownSince = null, channelOne = true, last = null, lastTime = 0;
  const target = () => (mode === 'pop' ? hidden : displayed);
  const show = (t, next) => {
    const since = shownSince ?? displayed.firstWrite;
    if (since != null && displayed.text) add(doc, since, t, displayed.text);
    displayed = next;
    shownSince = next.isEmpty ? null : t;
  };
  const character = (t, code) => {
    if (code < 0x20) return;
    target().append(t, BASIC[code] || String.fromCharCode(code));
    if (mode !== 'pop' && shownSince == null) shownSince = displayed.firstWrite;
  };
  const misc = (t, code) => {
    if (code === 0x20) mode = 'pop';
    else if (code === 0x21) target().backspace();
    else if (code === 0x24) target().clearRow();
    else if (code >= 0x25 && code <= 0x27) { if (mode !== 'roll') show(t, new Memory()); mode = 'roll'; rollRows = code - 0x23; } else if (code === 0x29) mode = 'paint';
    else if (code === 0x2c) show(t, new Memory());
    else if (code === 0x2d && mode === 'roll') { show(t, displayed.rolledUp(rollRows)); shownSince = null; } else if (code === 0x2e) hidden = new Memory();
    else if (code === 0x2f) { const next = hidden; hidden = new Memory(); show(t, next); mode = 'pop'; }
  };
  const control = (t, hi, lo) => {
    const channel = hi >= 0x18 ? 2 : 1, basic = hi & 0xf7;
    if ((basic === 0x14 || basic === 0x15) && lo >= 0x20 && lo <= 0x2f) { channelOne = channel === 1 && basic === 0x14; if (channelOne) misc(t, lo); return; }
    channelOne = channel === 1;
    if (!channelOne) return;
    if (lo >= 0x40) {
      const idx = [0x11, 0x12, 0x15, 0x16, 0x17, 0x10, 0x13, 0x14].indexOf(basic);
      let row = idx >= 0 ? (basic === 0x10 ? 11 : [1, 3, 5, 7, 9, 11, 12, 14][idx] + (lo >= 0x60 ? 1 : 0)) : 15;
      if (mode === 'roll') row = 15;
      target().moveTo(row, (lo & 0x1e) === 0x0e);
    } else if (basic === 0x11 && lo >= 0x20 && lo <= 0x2f) { target().append(t, ' '); target().setItalic((lo & 0x0e) === 0x0e); } else if (basic === 0x11 && lo >= 0x30 && lo <= 0x3f) target().append(t, SPECIAL[lo - 0x30]);
    else if ((basic === 0x12 || basic === 0x13) && lo >= 0x20 && lo <= 0x3f) { target().backspace(); target().append(t, (basic === 0x12 ? EXT1 : EXT2)[lo - 0x20]); }
  };
  for (const raw of src.split('\n')) {
    const m = /^(\d{2}):(\d{2}):(\d{2})([:;.,])(\d{2})\s+(.+)$/.exec(raw.trim());
    if (!m) continue;
    const [h, mi, s, f] = [m[1], m[2], m[3], m[5]].map(Number);
    let frames = ((h * 60 + mi) * 60 + s) * 30 + f;
    if (m[4] === ';' || m[4] === '.') { const mins = 60 * h + mi; frames -= 2 * (mins - Math.floor(mins / 10)); }
    m[6].split(/[ \t]+/).filter(Boolean).forEach((w, i) => {
      if (!/^[0-9A-Fa-f]{4}$/.test(w)) return;
      const t = (frames + i) * FRAME_MS, word = parseInt(w, 16), hi = (word >> 8) & 0x7f, lo = word & 0x7f;
      lastTime = t;
      if (hi < 0x10) { last = null; return; }
      if (hi <= 0x1f) { if (last === (hi << 8 | lo)) { last = null; return; } last = hi << 8 | lo; control(t, hi, lo); return; }
      last = null;
      if (!channelOne) return;
      character(t, hi);
      if (lo >= 0x20) character(t, lo);
    });
  }
  const since = shownSince ?? displayed.firstWrite;
  if (since != null) show(Math.max(lastTime, since + DEFAULT_MS), new Memory());
  return doc;
}

function read(fmt, bytes) {
  const f = READS[fmt] || fmt;
  if (f === 'sub' && ((bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0xba) || bytes.subarray(0, 4096).includes(0))) {
    throw new Error('This .sub file holds VobSub picture subtitles (from a DVD), not MicroDVD text. Picture subtitles can’t be turned into text without OCR.');
  }
  const src = decodeSubtitle(bytes).replace(/\r\n?/g, '\n');
  const reader = { srt: readSrt, vtt: readVtt, ass: readAss, lrc: readLrc, sub: readMicroDvd, smi: readSami, ttml: readTtml, scc: readScc }[f];
  if (!reader) throw new Error(`Lime can’t read ${String(fmt).toUpperCase()} subtitles.`);
  const doc = finish(reader(src));
  if (!doc.cues.length) throw new Error(`No subtitles were found in this file (it is empty or not a ${f.toUpperCase()} subtitle file).`);
  return doc;
}

// ───────── Writers ─────────
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const writeSrt = (doc) => doc.cues.map((c, i) => `${i + 1}\r\n${msTime(c.start, ',')} --> ${msTime(c.end, ',')}\r\n${c.text.replace(/\n/g, '\r\n')}\r\n\r\n`).join('');
function writeVtt(doc) {
  let s = `WEBVTT\n${doc.language ? `Language: ${doc.language}\n` : ''}\n`;
  for (const c of doc.cues) {
    s += `${msTime(c.start, '.')} --> ${msTime(c.end, '.')}\n`;
    const colors = [];
    for (const t of tokens(c.text)) {
      if (t.k === 'text') s += esc(t.v).replace(/--&gt;/g, '-&gt;');
      else if (t.k === 'br') s += '\n';
      else if (t.k === 'open' && isColor(t.v)) { const n = colorName(t.v); colors.push(!!n); if (n) s += `<c.${n}>`; } else if (t.k === 'open') s += `<${t.v}>`;
      else if (t.v === 'font') { if (colors.length && colors.pop()) s += '</c>'; } else s += `</${t.v}>`;
    }
    s += '\n\n';
  }
  return s;
}
const assHex = (hex) => `&H${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`;
function assLine(t) {
  let s = '';
  const colors = [];
  for (const tok of tokens(t)) {
    if (tok.k === 'text') s += tok.v.replace(/\{/g, '(').replace(/\}/g, ')');
    else if (tok.k === 'br') s += '\\N';
    else if (tok.k === 'open' && isColor(tok.v)) { colors.push(tok.v); s += `{\\c${assHex(tok.v)}}`; } else if (tok.k === 'open') s += `{\\${tok.v}1}`;
    else if (tok.v === 'font') { colors.pop(); s += `{\\c${colors.length ? assHex(colors[colors.length - 1]) : ''}}`; } else s += `{\\${tok.v}0}`;
  }
  return s.replace(/\}\{/g, '');
}
function writeAss(doc) {
  let s = '[Script Info]\r\n';
  if (doc.title) s += `Title: ${doc.title.replace(/\n/g, ' ')}\r\n`;
  s += 'ScriptType: v4.00+\r\nWrapStyle: 0\r\nScaledBorderAndShadow: yes\r\nPlayResX: 1920\r\nPlayResY: 1080\r\n\r\n[V4+ Styles]\r\n';
  s += 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\r\n';
  s += 'Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,50,1\r\n\r\n[Events]\r\n';
  s += 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r\n';
  return s + doc.cues.map((c) => `Dialogue: 0,${csTime(c.start)},${csTime(c.end)},Default,,0,0,0,,${assLine(c.text)}\r\n`).join('');
}
const html = (t, br) => tokens(t).map((x) => (x.k === 'text' ? esc(x.v) : x.k === 'br' ? br : x.k === 'open' ? (isColor(x.v) ? `<font color="${x.v}">` : `<${x.v}>`) : `</${x.v}>`)).join('');
function samiClass(lang) {
  const code = lang.split('-')[0].toLowerCase();
  const known = { ko: ['KRCC', 'Korean'], en: ['ENCC', 'English'], ja: ['JPCC', 'Japanese'], zh: ['ZHCC', 'Chinese'] }[code];
  if (known) return known;
  let name = code;
  try { name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch (_) {}
  return [`${code.toUpperCase()}CC`, name];
}
function writeSami(doc) {
  const lang = guessLanguage(doc), [cls, name] = samiClass(lang);
  let s = `<SAMI>\r\n<HEAD>\r\n<TITLE>${esc(doc.title || '')}</TITLE>\r\n<STYLE TYPE="text/css">\r\n<!--\r\n`;
  s += 'P { margin-left: 8pt; margin-right: 8pt; margin-bottom: 2pt; margin-top: 2pt; text-align: center; font-size: 20pt; font-family: sans-serif; font-weight: normal; color: white; }\r\n';
  s += `.${cls} { Name: ${name}; lang: ${lang}; SAMIType: CC; }\r\n-->\r\n</STYLE>\r\n</HEAD>\r\n<BODY>\r\n`;
  doc.cues.forEach((c, i) => {
    s += `<SYNC Start=${Math.round(c.start)}><P Class=${cls}>${html(c.text, '<br>')}\r\n`;
    const next = doc.cues[i + 1];
    if (!next || next.start > c.end) s += `<SYNC Start=${Math.round(c.end)}><P Class=${cls}>&nbsp;\r\n`;
  });
  return `${s}</BODY>\r\n</SAMI>\r\n`;
}
function writeLrc(doc) {
  let s = doc.title ? `[ti:${doc.title.replace(/\n/g, ' ').replace(/\]/g, ')')}]\r\n` : '';
  doc.cues.forEach((c, i) => {
    s += `[${lrcTime(c.start)}]${plainText(c.text).split('\n').map((l) => l.trim()).join(' ')}\r\n`;
    const next = doc.cues[i + 1];
    if (!next || next.start - c.end >= 10) s += `[${lrcTime(c.end)}]\r\n`;
  });
  return s;
}
const xmlAttr = (t) => esc(t).replace(/"/g, '&quot;');
function writeTtml(doc) {
  const span = { i: 'tts:fontStyle="italic"', b: 'tts:fontWeight="bold"', u: 'tts:textDecoration="underline"' };
  const body = (t) => tokens(t).map((x) => (x.k === 'text' ? esc(x.v) : x.k === 'br' ? '<br />' : x.k === 'open' ? `<span ${span[x.v] || `tts:color="${x.v}"`}>` : '</span>')).join('');
  const L = ['<?xml version="1.0" encoding="UTF-8"?>', `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="${xmlAttr(guessLanguage(doc))}">`, '  <head>'];
  if (doc.title) L.push('    <metadata>', `      <ttm:title>${esc(doc.title)}</ttm:title>`, '    </metadata>');
  L.push('    <styling>', '      <style xml:id="default" tts:color="white" tts:fontFamily="proportionalSansSerif" tts:textAlign="center" />', '    </styling>',
    '    <layout>', '      <region xml:id="bottom" tts:origin="10% 75%" tts:extent="80% 20%" tts:displayAlign="after" tts:textAlign="center" />', '    </layout>', '  </head>',
    '  <body region="bottom" style="default">', '    <div>');
  for (const c of doc.cues) L.push(`      <p begin="${msTime(c.start, '.')}" end="${msTime(c.end, '.')}">${body(c.text)}</p>`);
  L.push('    </div>', '  </body>', '</tt>');
  return `${L.join('\n')}\n`;
}
function writeMicroDvd(doc) {
  const fps = 23.976;
  let s = `{1}{1}${fps}\r\n`;
  for (const c of doc.cues) {
    const start = Math.round((c.start / 1000) * fps), end = Math.max(start + 1, Math.round((c.end / 1000) * fps));
    const t = tokens(c.text);
    const italic = t.length > 2 && t[0].k === 'open' && t[0].v === 'i' && t[t.length - 1].k === 'close' && t[t.length - 1].v === 'i' && t.filter((x) => x.v === 'i').length === 2;
    s += `{${start}}{${end}}${italic ? '{Y:i}' : ''}${plainText(c.text).split('\n').join('|').replace(/\{/g, '(').replace(/\}/g, ')')}\r\n`;
  }
  return s;
}
function write(doc, fmt) {
  const [txt, bom] = { srt: [writeSrt, true], vtt: [writeVtt, false], ass: [writeAss, true], smi: [writeSami, true], lrc: [writeLrc, false], ttml: [writeTtml, false], sub: [writeMicroDvd, true] }[fmt] || [];
  if (!txt) throw new Error(`Lime can’t write ${String(fmt).toUpperCase()} subtitles.`);
  return Buffer.from(`${bom ? '\ufeff' : ''}${txt(doc)}`, 'utf8');
}

async function convert(input, opts, ctx) {
  const to = opts.to || 'srt';
  const data = write(read(U.ext(input), await fsp.readFile(input)), to);
  const out = ctx.out.file(input, `${U.base(input)}${READS[U.ext(input)] === to ? '-converted' : ''}.${to}`);
  await fsp.writeFile(out, data);
  return out;
}
// A UTF-8 copy FFmpeg's subtitles filter can read: SRT/VTT/ASS re-encoded as they are, other formats as SRT.
async function forFfmpeg(file, dir) {
  const e = U.ext(file), bytes = await fsp.readFile(file);
  const keep = ['srt', 'vtt', 'ass', 'ssa'].includes(e);
  const out = path.join(dir, `subtitles.${keep ? e : 'srt'}`);
  await fsp.writeFile(out, keep ? decodeSubtitle(bytes).replace(/^\ufeff/, '') : write(read(e, bytes), 'srt'));
  return out;
}

module.exports = { read, write, convert, forFfmpeg, normalize, plainText, fromHtml, parseColor, assText, assLine, guessLanguage, READS, WRITES };
