'use strict';
const U = require('./util');
const { fs, fsp, path } = U;

const HTML_EXT = ['html', 'htm', 'xhtml'];
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'keygen']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const OPTIONAL_END = new Set(['html', 'head', 'body', 'p', 'li', 'dt', 'dd', 'option', 'optgroup', 'rb', 'rt', 'rtc', 'rp', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'caption']);
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const SIBLINGS = { li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], option: ['option'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'], thead: ['tbody', 'tfoot'], tbody: ['tbody', 'tfoot'] };
const plural = (n, w, many) => `${n} ${n === 1 ? w : many || `${w}s`}`;

const readText = async (p) => (await fsp.readFile(p, 'utf8')).replace(/^﻿/, '');
function lineAt(src) {
  const starts = [0];
  for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) starts.push(i + 1);
  return (pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
}
function attrsOf(s, offset) {
  const out = [], re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(s))) out.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? null, at: offset + m.index });
  return out;
}
function tokens(src) {
  const out = [], re = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('<!--')) { out.push({ type: 'comment', at: m.index }); continue; }
    if (/^<!doctype/i.test(m[0])) { out.push({ type: 'doctype', at: m.index }); continue; }
    if (!m[2]) continue;
    const name = m[2].toLowerCase();
    if (m[1]) { out.push({ type: 'close', name, at: m.index }); continue; }
    const self = /\/\s*$/.test(m[3]);
    const t = { type: 'open', name, at: m.index, self, attrs: attrsOf(m[3].replace(/\/\s*$/, ''), m.index + 1 + m[2].length) };
    out.push(t);
    if (RAW.has(name) && !self) {
      const end = new RegExp(`</${name}\\s*>`, 'ig');
      end.lastIndex = re.lastIndex;
      const e = end.exec(src);
      t.text = src.slice(re.lastIndex, e ? e.index : src.length);
      if (e) { out.push({ type: 'close', name, at: e.index }); re.lastIndex = end.lastIndex; } else re.lastIndex = src.length;
    }
  }
  return out;
}
const attr = (t, n) => t.attrs?.find((a) => a.name === n)?.value;

function validate(src) {
  const line = lineAt(src), found = [], stack = [], ids = new Map();
  const add = (level, at, msg) => found.push({ level, line: line(at), msg });
  const toks = tokens(src);
  let foreign = 0;
  const unclosed = (e) => { if (!OPTIONAL_END.has(e.name)) add('error', e.at, `<${e.name}> is never closed`); };
  for (const t of toks) {
    if (t.type === 'open') {
      const id = attr(t, 'id');
      if (id != null && id !== '') { if (ids.has(id)) add('error', t.at, `id "${id}" is used again (first on line ${ids.get(id)})`); else ids.set(id, line(t.at)); }
      if ((t.name === 'img' || t.name === 'area' || (t.name === 'input' && String(attr(t, 'type')).toLowerCase() === 'image')) && attr(t, 'alt') == null) add('error', t.at, `<${t.name}> has no alt text${attr(t, 'src') ? ` (${attr(t, 'src')})` : ''}`);
      if (VOID.has(t.name)) continue;
      if (t.self) { if (foreign) continue; add('warning', t.at, `<${t.name}/>: the slash doesn’t close it in HTML`); }
      const top = stack[stack.length - 1];
      if (top && !foreign && ((top.name === 'p' && CLOSES_P.has(t.name)) || SIBLINGS[t.name]?.includes(top.name))) stack.pop();
      stack.push(t);
      if (t.name === 'svg' || t.name === 'math') foreign++;
    } else if (t.type === 'close') {
      if (VOID.has(t.name)) { if (t.name !== 'br') add('warning', t.at, `</${t.name}> isn’t needed: <${t.name}> has no end tag`); continue; }
      const i = stack.map((e) => e.name).lastIndexOf(t.name);
      if (i < 0) { add('error', t.at, `</${t.name}> has no matching <${t.name}>`); continue; }
      for (const e of stack.splice(i).slice(1)) { if (e.name === 'svg' || e.name === 'math') foreign--; unclosed(e); }
      if (t.name === 'svg' || t.name === 'math') foreign--;
    }
  }
  stack.forEach(unclosed);
  const whole = /<html[\s>]/i.test(src) || /<body[\s>]/i.test(src);
  if (whole && !toks.some((t) => t.type === 'doctype')) found.push({ level: 'warning', line: 1, msg: 'No <!DOCTYPE html>: browsers will use quirks mode' });
  const title = toks.find((t) => t.type === 'open' && t.name === 'title');
  if (whole && (!title || !String(title.text || '').trim())) found.push({ level: 'warning', line: title ? line(title.at) : 1, msg: 'The page has no title' });
  const htmlTag = toks.find((t) => t.type === 'open' && t.name === 'html');
  if (htmlTag && !attr(htmlTag, 'lang')) add('warning', htmlTag.at, '<html> has no lang: screen readers can’t tell the language');
  return found.sort((a, b) => a.line - b.line);
}

const LINK_ATTRS = { a: ['href'], area: ['href'], link: ['href'], img: ['src', 'srcset'], source: ['src', 'srcset'], script: ['src'], video: ['src', 'poster'], audio: ['src'], iframe: ['src'], embed: ['src'], object: ['data'], track: ['src'], input: ['src'] };
const cssUrls = (css, at) => [...String(css).matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)].map((m) => ({ url: m[2].trim(), at }));
function refsOf(src) {
  const out = [];
  for (const t of tokens(src)) {
    if (t.type !== 'open') continue;
    for (const n of LINK_ATTRS[t.name] || []) {
      const v = attr(t, n);
      if (v == null) continue;
      if (n === 'srcset') for (const part of v.split(',')) { const u = part.trim().split(/\s+/)[0]; if (u) out.push({ url: u, at: t.at, tag: t.name }); }
      else out.push({ url: v.trim(), at: t.at, tag: t.name });
    }
    const style = attr(t, 'style');
    if (style) out.push(...cssUrls(style, t.at).map((r) => ({ ...r, tag: 'style' })));
    if (t.name === 'style' && t.text) out.push(...cssUrls(t.text, t.at).map((r) => ({ ...r, tag: 'style' })));
  }
  return out;
}
function anchorsOf(src) {
  const set = new Set();
  for (const t of tokens(src)) if (t.type === 'open') { const id = attr(t, 'id'); if (id) set.add(id); if (t.name === 'a' && attr(t, 'name')) set.add(attr(t, 'name')); }
  return set;
}
function localPath(url, dir) {
  let rel = url.split('?')[0];
  try { rel = decodeURI(rel); } catch (_) {}
  if (!rel.startsWith('/')) return path.resolve(dir, rel);
  for (let d = dir, i = 0; i < 8; i++, d = path.dirname(d)) { const p = path.join(d, rel); if (fs.existsSync(p)) return p; if (path.dirname(d) === d) break; }
  return path.join(dir, rel);
}
async function checkLinks(src, dir) {
  const line = lineAt(src), problems = [], anchors = anchorsOf(src), cache = new Map();
  let local = 0, remote = 0;
  for (const r of refsOf(src)) {
    const u = r.url;
    if (!u || /^(mailto|tel|javascript|data|blob|about|sms):/i.test(u)) continue;
    if (/^([a-z][\w+.-]*:)?\/\//i.test(u)) { remote++; continue; }
    if (/^[a-z][\w+.-]*:/i.test(u)) continue;
    const [p, frag] = u.split('#');
    local++;
    if (!p) {
      if (frag && frag !== 'top' && !anchors.has(decodeURIComponent(frag))) problems.push({ level: 'error', line: line(r.at), msg: `#${frag}: no element on this page has that id` });
      continue;
    }
    let file = localPath(p, dir);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { problems.push({ level: 'error', line: line(r.at), msg: `${u}: ${r.tag === 'img' || r.tag === 'source' ? 'picture' : 'file'} not found` }); continue; }
    if (frag && HTML_EXT.includes(U.ext(file))) {
      if (!cache.has(file)) cache.set(file, anchorsOf(await readText(file).catch(() => '')));
      if (!cache.get(file).has(decodeURIComponent(frag))) problems.push({ level: 'error', line: line(r.at), msg: `${u}: ${path.basename(file)} has no #${frag}` });
    }
  }
  return { problems, local, remote };
}

const kindOf = (p) => { const e = U.ext(p); return HTML_EXT.includes(e) || e === 'svg' ? 'html' : e === 'css' ? 'css' : ['js', 'mjs', 'cjs'].includes(e) ? 'js' : e; };
function format(src, kind, opts = {}) {
  const b = require('js-beautify'), tabs = opts.indent === 'tab';
  const o = { indent_size: tabs ? 1 : Number(opts.indent) || 2, indent_char: tabs ? '\t' : ' ', indent_with_tabs: tabs, end_with_newline: true, preserve_newlines: true, max_preserve_newlines: 2 };
  if (kind === 'css') return b.css(src, o);
  if (kind === 'js') return b.js(src, o);
  return b.html(src, { ...o, indent_inner_html: false, extra_liners: [], wrap_line_length: 0, indent_scripts: 'normal', templating: ['none'] });
}
async function minifyText(src, kind) {
  if (kind === 'css') {
    const r = new (require('clean-css'))({ level: 1 }).minify(src);
    if (r.errors.length) throw new Error(`The CSS couldn’t be read: ${r.errors[0]}`);
    return r.styles;
  }
  if (kind === 'js') {
    try { return (await require('terser').minify(src, { module: /^\s*(import|export)\s/m.test(src) })).code; } catch (e) { throw new Error(`The script couldn’t be read: ${e.message}${e.line ? ` (line ${e.line})` : ''}`); }
  }
  return require('html-minifier-terser').minify(src, { collapseWhitespace: true, conservativeCollapse: true, removeComments: true, collapseBooleanAttributes: true, minifyCSS: true, minifyJS: true, continueOnParseError: true });
}

async function inlineLinked(src, dir) {
  let out = src;
  for (const t of tokens(src).filter((x) => x.type === 'open' && x.name === 'link' && /\bstylesheet\b/i.test(attr(x, 'rel') || ''))) {
    const href = attr(t, 'href');
    if (!href || /^([a-z][\w+.-]*:)?\/\//i.test(href) || /^data:/i.test(href)) continue;
    const css = await readText(localPath(href, dir)).catch(() => null);
    if (css == null) continue;
    const tag = src.slice(t.at, src.indexOf('>', t.at) + 1), media = attr(t, 'media');
    out = out.replace(tag, () => `<style${media ? ` media="${media}"` : ''}>\n${css}\n</style>`);
  }
  return out;
}

async function formatFile(p, opts, ctx) {
  const src = await readText(p), out = ctx.out.file(p, `${U.base(p)}-formatted.${U.ext(p)}`);
  ctx.progress?.(0.4, 'Formatting');
  const text = format(src, kindOf(p), opts);
  await fsp.writeFile(out, text);
  return { path: out, note: `${plural(text.split('\n').length - 1, 'line')}, indented with ${opts.indent === 'tab' ? 'tabs' : `${Number(opts.indent) || 2} spaces`}` };
}
async function minifyFile(p, opts, ctx) {
  const src = await readText(p), e = U.ext(p), out = ctx.out.file(p, `${U.base(p).replace(/\.min$/, '')}.min.${e}`);
  ctx.progress?.(0.4, 'Minifying');
  const text = await minifyText(src, kindOf(p));
  await fsp.writeFile(out, text);
  const a = Buffer.byteLength(src), b = Buffer.byteLength(text);
  return { path: out, note: `${U.fmtBytes(a)} → ${U.fmtBytes(b)} (${a ? Math.round((1 - b / a) * 100) : 0}% smaller)` };
}
async function checkLinksFile(p, opts, ctx) {
  ctx.progress?.(0.3, 'Checking links');
  const r = await checkLinks(await readText(p), path.dirname(p));
  const bad = r.problems.length;
  return { note: `${bad ? `${plural(bad, 'problem')} in ` : 'All '}${plural(r.local, 'local link')}${bad ? '' : ' work'}${r.remote ? `; ${plural(r.remote, 'web address', 'web addresses')} not checked (offline)` : ''}`, text: r.problems.map((x) => `✗ Line ${x.line}: ${x.msg}`).join('\n') };
}
async function validateFile(p, opts, ctx) {
  ctx.progress?.(0.3, 'Checking the page');
  const list = validate(await readText(p)), err = list.filter((x) => x.level === 'error').length, warn = list.length - err;
  return { note: list.length ? [err && plural(err, 'error'), warn && plural(warn, 'warning')].filter(Boolean).join(', ') : 'No problems found', text: list.map((x) => `${x.level === 'error' ? '✗' : '!'} Line ${x.line}: ${x.msg}`).join('\n') };
}
async function inlineCss(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-email.html`);
  ctx.progress?.(0.3, 'Putting the CSS on each element');
  const html = await inlineLinked(await readText(p), path.dirname(p));
  let text;
  try { text = require('juice')(html, { preserveMediaQueries: true, preserveFontFaces: true, removeStyleTags: true, applyWidthAttributes: true, applyHeightAttributes: true, preserveImportant: true }); } catch (e) { throw new Error(`The CSS couldn’t be inlined: ${e.message}`); }
  await fsp.writeFile(out, text);
  const n = (text.match(/\sstyle="/g) || []).length;
  return { path: out, note: `CSS on ${plural(n, 'element')}${/@media/.test(text) ? ', media queries kept in the head' : ''}` };
}
async function pageToPdf(p, opts, ctx) {
  if (!ctx?.host) throw new Error('Pages can only be printed in the app.');
  const out = ctx.out.file(p, `${U.base(p)}.pdf`);
  ctx.progress?.(0.3, 'Printing the page');
  await ctx.host('htmlToPdf', { file: p, out, pageSize: opts.pageSize || 'A4', landscape: opts.orientation === 'landscape' });
  return out;
}
async function extractText(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}.txt`), text = require('./office').htmlToText(await readText(p));
  await fsp.writeFile(out, text);
  return { path: out, note: `${plural(text.split(/\s+/).filter(Boolean).length, 'word')}` };
}

module.exports = { HTML_EXT, tokens, validate, checkLinks, format, minifyText, inlineLinked, kindOf, formatFile, minifyFile, checkLinksFile, validateFile, inlineCss, pageToPdf, extractText };
