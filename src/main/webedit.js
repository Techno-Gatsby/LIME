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

module.exports = { open, save, check, format, markdown, rebase };
