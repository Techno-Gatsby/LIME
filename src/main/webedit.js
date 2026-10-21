'use strict';
const U = require('./engines/util');
const W = require('./engines/web');
const { fs, fsp, path } = U;

const remote = (u) => /^([a-z][\w+.-]*:)?\/\//i.test(u) || /^[a-z][\w+.-]*:/i.test(u) || u.startsWith('#');
const attrOf = (tag, n) => new RegExp(`\\s${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
const resolveLocal = (href, dir) => { let p = href.split(/[?#]/)[0]; try { p = decodeURI(p); } catch (_) {} return path.resolve(dir, p); };
const relHref = (from, to) => encodeURI(path.relative(from, to).split(path.sep).join('/')).replace(/[?#]/g, encodeURIComponent);

function stylesheets(src, dir) {
  const out = [];
  for (const m of src.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(m[0])) continue;
    const a = attrOf(m[0], 'href'), href = a && (a[1] ?? a[2] ?? a[3]);
    if (!href || remote(href)) continue;
    const p = resolveLocal(href, dir);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) out.push({ href, path: p });
  }
  return out;
}

async function open(file) {
  const raw = await fsp.readFile(file, 'utf8'), src = raw.replace(/^﻿/, ''), dir = path.dirname(file), kind = W.kindOf(file);
  const css = kind === 'html' && U.ext(file) !== 'svg' ? await Promise.all(stylesheets(src, dir).map(async (s) => ({ ...s, text: await fsp.readFile(s.path, 'utf8') }))) : [];
  return { src, dir, kind, ext: U.ext(file), bom: raw.startsWith('﻿'), css, sep: path.sep };
}

function rebase(src, fromDir, toDir) {
  if (path.resolve(fromDir) === path.resolve(toDir)) return src;
  return src.replace(/(<[a-z][^>]*?\s(?:src|href|poster|data)\s*=\s*)(["'])([^"']*)\2/gi, (all, head, q, url) => {
    if (!url || remote(url) || url.startsWith('/')) return all;
    const [p, ...rest] = url.split('#'), abs = resolveLocal(p, fromDir);
    if (!p || !fs.existsSync(abs)) return all;
    return `${head}${q}${relHref(toDir, abs)}${rest.length ? `#${rest.join('#')}` : ''}${q}`;
  });
}

async function save(file, target, payload = {}) {
  const dir = path.dirname(file), out = target || path.join(dir, `${U.base(file)} (edited).${U.ext(file)}`), outDir = path.dirname(out);
  let src = String(payload.src ?? '');
  const wrote = [];
  for (const c of payload.css || []) {
    if (!c?.path || c.text == null) continue;
    const dest = path.join(path.dirname(c.path), `${U.base(c.path).replace(/ \(edited\)$/, '')} (edited).css`);
    await fsp.writeFile(dest, c.text);
    wrote.push(dest);
    src = src.replace(/<link\b[^>]*>/gi, (tag) => {
      const a = attrOf(tag, 'href'), href = a && (a[1] ?? a[2] ?? a[3]);
      return href && !remote(href) && resolveLocal(href, dir) === c.path ? tag.replace(a[0], ` href="${relHref(dir, dest)}"`) : tag;
    });
  }
  src = rebase(src, dir, outDir);
  await fsp.writeFile(out, `${payload.bom ? '﻿' : ''}${src}`);
  return { path: out, css: wrote };
}

async function check(src, dir) {
  return { problems: W.validate(src), links: await W.checkLinks(src, dir) };
}
const format = (src, kind, opts) => W.format(src, kind, opts);
const markdown = (src) => require('marked').parse(String(src || ''));

const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp']);
const SKIP = new Set(['node_modules', '__MACOSX']);
const freePath = (p) => { if (!fs.existsSync(p)) return p; const e = path.extname(p), b = p.slice(0, p.length - e.length); for (let i = 2; ; i++) if (!fs.existsSync(`${b}-${i}${e}`)) return `${b}-${i}${e}`; };
const plainName = (n) => String(n || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').trim() || 'file';

async function copyInto(file, dir) {
  const inside = path.relative(dir, file);
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) return file;
  const dest = freePath(path.join(dir, 'images', plainName(path.basename(file))));
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(file, dest);
  return dest;
}
async function saveBytes(dir, name, bytes) {
  const dest = freePath(path.join(dir, 'images', plainName(name)));
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, Buffer.from(bytes));
  return dest;
}
async function listSite(dir, { depth = 5, images = false } = {}) {
  const out = [];
  const walk = async (d, level) => {
    let ents = [];
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (_) { return; }
    ents.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const e of ents) {
      if (SKIP.has(e.name) || e.name.startsWith('.') || out.length > 2000) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!images) out.push({ path: p, dir: true, level }); if (level < depth) await walk(p, level + 1); } else if (!images || IMAGES.has(U.ext(e.name))) out.push({ path: p, dir: false, level, ext: U.ext(e.name) });
    }
  };
  await walk(dir, 0);
  return out;
}
const stat = async (p) => { try { const s = await fsp.stat(p); return { mtime: s.mtimeMs, size: s.size }; } catch (_) { return null; } };
async function imageOp(file, op, o = {}) {
  const sharp = require('sharp'), e = U.ext(file), keep = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(e) ? e : 'png';
  const dest = freePath(path.join(path.dirname(file), `${U.base(file)}-${op === 'rotate' ? 'rotated' : 'cropped'}.${keep}`));
  let img = sharp(file, { failOn: 'none', animated: false }).rotate();
  if (op === 'rotate') img = img.rotate(Number(o.angle) || 90);
  if (op === 'crop') {
    const m = await sharp(file, { failOn: 'none' }).rotate().toBuffer({ resolveWithObject: true }).then((r) => r.info);
    const W = m.width, H = m.height, left = Math.max(0, Math.round(o.x * W)), top = Math.max(0, Math.round(o.y * H));
    img = sharp(file, { failOn: 'none', animated: false }).rotate().extract({ left, top, width: Math.max(1, Math.min(W - left, Math.round(o.w * W))), height: Math.max(1, Math.min(H - top, Math.round(o.h * H))) });
  }
  await img.toFile(dest);
  return dest;
}
async function newPage(dir, name) {
  const dest = freePath(path.join(dir, `${plainName(name).replace(/\.html?$/i, '')}.html`)), title = U.base(dest).replace(/[<&]/g, '');
  await fsp.writeFile(dest, `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${title}</title>\n</head>\n<body>\n  <h1>${title}</h1>\n  <p>Start writing here.</p>\n</body>\n</html>\n`);
  return dest;
}
async function newFolder(dir, name) { const dest = freePath(path.join(dir, plainName(name))); await fsp.mkdir(dest, { recursive: true }); return dest; }
async function rename(p, name) {
  const dest = path.join(path.dirname(p), plainName(name));
  if (fs.existsSync(dest)) throw new Error(`There is already a ${path.basename(dest)} there.`);
  await fsp.rename(p, dest);
  return dest;
}
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function matcher(o) {
  if (!o.find) throw new Error('Type what to find.');
  try { return new RegExp(o.regex ? o.find : escRe(o.find), `g${o.matchCase ? '' : 'i'}`); } catch (e) { throw new Error(`That pattern doesn’t work: ${e.message}`); }
}
function textRanges(src) {
  const out = [], re = /<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->|<[^>]*>/gi;
  let last = 0, m;
  while ((m = re.exec(src))) { if (m.index > last) out.push([last, m.index]); last = re.lastIndex; }
  if (last < src.length) out.push([last, src.length]);
  return out;
}
function findIn(src, o) {
  const re = matcher(o), hits = [], spans = o.textOnly ? textRanges(src) : [[0, src.length]];
  for (const [a, b] of spans) {
    const part = src.slice(a, b);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(part))) { if (!m[0].length) { re.lastIndex++; continue; } hits.push({ from: a + m.index, to: a + m.index + m[0].length, text: m[0] }); if (hits.length > 5000) return hits; }
  }
  return hits;
}
function replaceIn(src, o) {
  const hits = findIn(src, o), re = matcher(o);
  let out = '', last = 0;
  for (const x of hits) { out += src.slice(last, x.from) + (o.regex ? x.text.replace(new RegExp(re.source, re.flags.replace('g', '')), o.replace ?? '') : (o.replace ?? '')); last = x.to; }
  return { text: out + src.slice(last), count: hits.length };
}
const SITE_TEXT = new Set(['html', 'htm', 'xhtml', 'css', 'js', 'mjs', 'md', 'svg', 'txt', 'json', 'xml']);
const MARKUP = ['html', 'htm', 'xhtml', 'svg'];
async function siteFind(dir, o) {
  const out = [];
  for (const f of (await listSite(dir)).filter((x) => !x.dir && SITE_TEXT.has(x.ext))) {
    const src = await fsp.readFile(f.path, 'utf8').catch(() => '');
    for (const x of findIn(src, { ...o, textOnly: o.textOnly && MARKUP.includes(f.ext) }).slice(0, 200)) {
      const ls = src.lastIndexOf('\n', x.from - 1) + 1, le = src.indexOf('\n', x.to);
      out.push({ path: f.path, line: src.slice(0, x.from).split('\n').length, from: x.from, to: x.to, snippet: src.slice(ls, le < 0 ? src.length : le).trim().slice(0, 160) });
    }
    if (out.length > 3000) break;
  }
  return out;
}
async function siteReplace(dir, o, skip = []) {
  const changed = [];
  for (const f of (await listSite(dir)).filter((x) => !x.dir && SITE_TEXT.has(x.ext) && !skip.includes(x.path))) {
    const src = await fsp.readFile(f.path, 'utf8').catch(() => null);
    if (src == null) continue;
    const r = replaceIn(src, { ...o, textOnly: o.textOnly && MARKUP.includes(f.ext) });
    if (r.count) { await fsp.writeFile(f.path, r.text); changed.push({ path: f.path, count: r.count }); }
  }
  return changed;
}
async function burnWatermark(file, o) {
  const tool = require('./tools').get('watermark-image'), tmp = await U.tmpDir('webmark');
  try {
    const ctx = { signal: new AbortController().signal, out: U.outputPlanner({ dest: { kind: 'dir', path: tmp } }), host: async () => null, progress: () => {} };
    const [r] = await tool.run([file], { kind: o.kind === 'image' ? 'image' : 'text', text: o.text || '©', image: o.image || '', layout: o.position === 'tiled' ? 'tiled' : 'single', position: ['tiled', 'centre'].includes(o.position) ? 'center' : o.position || 'center', opacity: Math.round(Number(o.opacity) || 30), color: o.color || '#ffffff' }, ctx);
    const made = typeof r === 'string' ? r : r.path, dest = freePath(path.join(path.dirname(file), `${U.base(file)}-watermarked${path.extname(made)}`));
    await fsp.copyFile(made, dest);
    return dest;
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}
const readText = async (p) => (await fsp.readFile(p, 'utf8')).replace(/^﻿/, '');
async function saveText(file, text) {
  const dest = path.join(path.dirname(file), `${U.base(file).replace(/ \(edited\)$/, '')} (edited)${path.extname(file)}`);
  await fsp.writeFile(dest, text);
  return dest;
}

module.exports = { open, save, check, format, markdown, rebase, copyInto, saveBytes, listSite, stat, imageOp, newPage, newFolder, rename, findIn, replaceIn, siteFind, siteReplace, burnWatermark, readText, saveText };
