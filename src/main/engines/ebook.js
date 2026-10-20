'use strict';
const U = require('./util');
const { fsp, path } = U;
const crypto = require('crypto');
const pp = path.posix;

const DRM = 'This book is protected with DRM (copy protection), so it can’t be converted. Lime doesn’t remove DRM; open it in the app it was bought for.';
const office = () => require('./office');

// ───────── bytes, text and XML ─────────
const td = (label, u8, fatal = false) => { try { return new TextDecoder(label, { fatal }).decode(u8); } catch (e) { if (fatal) throw e; return new TextDecoder('utf-8').decode(u8); } };
function decodeText(u8, hint) {
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return td('utf-8', u8.subarray(3));
  if (u8[0] === 0xff && u8[1] === 0xfe) return td('utf-16le', u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return td('utf-16be', u8.subarray(2));
  const head = Buffer.from(u8.subarray(0, 1024)).toString('latin1');
  const label = hint || /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)/i.exec(head)?.[1] || /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  if (label && !/^utf-?8$/i.test(label)) return td(label, u8);
  try { return td('utf-8', u8, true); } catch (_) { return td(label ? 'utf-8' : 'windows-1252', u8); }
}
function xml(text) {
  const { DOMParser } = require('@xmldom/xmldom');
  const errors = [];
  const doc = new DOMParser({ errorHandler: { warning() {}, error: (e) => errors.push(e), fatalError: (e) => errors.push(e) } }).parseFromString(text, 'text/xml');
  if (!doc?.documentElement) throw new Error('The XML is damaged.');
  doc.errors = errors;
  return doc;
}
const arr = (l) => (l ? Array.prototype.slice.call(l) : []);
const local = (e) => String(e.localName || e.tagName || '').replace(/^.*:/, '');
const kids = (e, name) => arr(e?.childNodes).filter((c) => c.nodeType === 1 && (!name || local(c) === name));
const kid = (e, name) => kids(e, name)[0] || null;
const desc = (e, name) => { if (!e) return []; const all = e.getElementsByTagName('*'); const out = []; for (let i = 0; i < all.length; i++) if (local(all[i]) === name) out.push(all[i]); return out; };
const attr = (e, name) => { for (const a of arr(e?.attributes)) if (String(a.localName || a.name).replace(/^.*:/, '') === name) return a.value; return null; };
const textContent = (e) => (e ? String(e.textContent || '') : '');
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } };
const XML_BAD = /[^\t\n\r\x20-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu;
const clean = (s) => String(s ?? '').replace(XML_BAD, '');
const escT = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escA = (s) => escT(s).replace(/"/g, '&quot;');
const pad = (n, w = 4) => String(n).padStart(w, '0');
const MIME = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' };
function sniff(b) {
  if (!b || b.length < 4) return null;
  const s = Buffer.from(b.subarray(0, 12)).toString('latin1');
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (s.startsWith('\x89PNG')) return 'png';
  if (s.startsWith('GIF8')) return 'gif';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'webp';
  if (s.startsWith('BM')) return 'bmp';
  if (/^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(Buffer.from(b.subarray(0, 1024)).toString('utf8'))) return 'svg';
  return null;
}
const dataUri = (buf, mime) => `data:${mime || MIME[sniff(buf)] || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
function fromDataUri(src) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,([\s\S]*)$/i.exec(String(src || '').trim());
  if (!m) return null;
  return { mime: m[1].toLowerCase(), data: m[3] ? Buffer.from(m[4], 'base64') : Buffer.from(safeDecode(m[4]), 'utf8') };
}
// JPEG and PNG (and GIF and SVG when allowed) stay as they are; other pictures become JPEG (opaque photos) or PNG.
async function commonImage(buf, gifAndSvg = true) {
  const t = sniff(buf);
  if (t === 'jpeg' || t === 'png' || (gifAndSvg && (t === 'gif' || t === 'svg'))) return { data: Buffer.from(buf), ext: t === 'jpeg' ? 'jpg' : t, mime: MIME[t] };
  try {
    const sharp = require('sharp');
    const m = await sharp(buf).metadata();
    const jpeg = !m.hasAlpha && ['webp', 'heif', 'jxl', 'tiff'].includes(m.format);
    const data = jpeg ? await sharp(buf).rotate().jpeg({ quality: 90 }).toBuffer() : await sharp(buf).png().toBuffer();
    return { data, ext: jpeg ? 'jpg' : 'png', mime: jpeg ? 'image/jpeg' : 'image/png' };
  } catch (_) { return null; }
}
function guessLang(text) {
  let hangul = 0, kana = 0, han = 0, latin = 0;
  for (const ch of String(text).slice(0, 20000)) {
    if (ch >= '가' && ch <= '힣') hangul++;
    else if (ch >= '\u3040' && ch <= '\u30ff') kana++;
    else if (ch >= '\u4e00' && ch <= '\u9fff') han++;
    else if (/[A-Za-z]/.test(ch)) latin++;
  }
  return hangul && hangul * 3 >= latin ? 'ko' : kana && kana * 3 >= latin ? 'ja' : han && han * 3 >= latin ? 'zh' : 'en';
}

// ───────── ZIP ─────────
function unzip(buf, notZip) {
  const { unzipSync } = require('fflate');
  let total = 0;
  try {
    const raw = unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.length), { filter: (f) => { total += f.originalSize; if (f.originalSize > 512e6 || total > 1e9) throw Object.assign(new Error('The archive is too large to unpack safely.'), { bomb: true }); return !/[\\/]$/.test(f.name); } });
    const map = new Map();
    for (const [k, v] of Object.entries(raw)) { const n = k.replace(/\\/g, '/').replace(/^\/+/, ''); if (n && !n.includes(':') && !n.split('/').includes('..')) map.set(n, v); }
    return map;
  } catch (e) { if (e.bomb) throw e; throw new Error(notZip); }
}
const zget = (z, name) => { if (name == null) return null; if (z.has(name)) return z.get(name); const l = name.toLowerCase(); for (const [k, v] of z) if (k.toLowerCase() === l) return v; return null; };
const inside = (dir, rel) => { const p = pp.normalize(dir && dir !== '.' ? `${dir}/${rel}` : rel); return !p || p.startsWith('../') || p === '..' || p.startsWith('/') ? null : p; };

// ───────── HTML ─────────
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'image']);
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'center', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', shy: '\u00ad', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', zwnj: '\u200c', zwj: '\u200d', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×', divide: '÷', para: '¶', sect: '§', dagger: '†', Dagger: '‡', euro: '€', pound: '£', yen: '¥', cent: '¢', iexcl: '¡', iquest: '¿', frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²', sup3: '³', micro: 'µ', prime: '′', Prime: '″', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', hearts: '♥', ordf: 'ª', ordm: 'º', not: '¬', macr: '¯', acute: '´', cedil: '¸', uml: '¨' };
for (const [k, c] of Object.entries({ A: 'ÀÁÂÃÄÅ', E: 'ÈÉÊË', I: 'ÌÍÎÏ', O: 'ÒÓÔÕÖ', U: 'ÙÚÛÜ', a: 'àáâãäå', e: 'èéêë', i: 'ìíîï', o: 'òóôõö', u: 'ùúûü' })) [...c].forEach((ch, i) => { ENT[`${k}${['grave', 'acute', 'circ', 'tilde', 'uml', 'ring'][i]}`] = ch; });
Object.assign(ENT, { Ccedil: 'Ç', ccedil: 'ç', Ntilde: 'Ñ', ntilde: 'ñ', szlig: 'ß', AElig: 'Æ', aelig: 'æ', Oslash: 'Ø', oslash: 'ø', yuml: 'ÿ', yacute: 'ý', Yacute: 'Ý', eth: 'ð', thorn: 'þ', oelig: 'œ', OElig: 'Œ' });
const entities = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e] ?? (m.endsWith(';') ? ENT[e.toLowerCase()] ?? m : m);
});
function attrsOf(s) {
  const a = {};
  String(s || '').replace(/([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g, (m, k, x, y, z) => { const n = k.toLowerCase(); if (/^[a-z_][\w:.-]*$/.test(n) && !(n in a)) a[n] = entities(x ?? y ?? z ?? ''); return ''; });
  return a;
}
// A forgiving HTML/XHTML parser: { title, lang, root } with root = { tag, attrs, kids } and text nodes { text }.
function parse(html) {
  const s = String(html || '');
  const title = entities((/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(s)?.[1] || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  const lang = /<html\b[^>]*?\s(?:xml:)?lang\s*=\s*["']?([\w-]+)/i.exec(s)?.[1] || '';
  let src = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|head|noscript|template|textarea|title)\b[\s\S]*?<\/\1\s*>/gi, '');
  const b = /<body\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(src);
  if (b) src = b[2]; else src = src.replace(/<\/?(html|head)\b[^>]*>/gi, '');
  const root = { tag: 'body', attrs: b ? attrsOf(b[1]) : {}, kids: [] };
  const stack = [root];
  const open = (t) => stack.map((n) => n.tag).lastIndexOf(t);
  const closeIn = (t, scope) => { const i = open(t); if (i > 0 && !stack.slice(i + 1).some((n) => scope.includes(n.tag))) stack.length = i; };
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<[!?][^>]*>|<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+|<)/g;
  for (let m; (m = re.exec(src));) {
    const top = stack[stack.length - 1];
    if (m[1] != null) { top.kids.push({ text: m[1] }); continue; }
    if (m[6] != null) { top.kids.push({ text: entities(m[6]) }); continue; }
    if (!m[3]) continue;
    const tag = m[3].toLowerCase();
    if (m[2]) { const i = open(tag); if (i > 0) stack.length = i; continue; }
    if (BLOCK.has(tag)) closeIn('p', ['td', 'th', 'table', 'button', 'li', 'blockquote', 'div', 'section', 'aside']);
    if (tag === 'li') closeIn('li', ['ul', 'ol']);
    if (tag === 'dt' || tag === 'dd') { closeIn('dt', ['dl']); closeIn('dd', ['dl']); }
    if (tag === 'tr') closeIn('tr', ['table', 'tbody', 'thead', 'tfoot']);
    if (tag === 'td' || tag === 'th') { closeIn('td', ['tr', 'table']); closeIn('th', ['tr', 'table']); }
    const node = { tag, attrs: attrsOf(m[4]), kids: [] };
    stack[stack.length - 1].kids.push(node);
    if (!VOID.has(tag) && !m[5]) stack.push(node);
  }
  return { title, lang, root };
}
const textOf = (n) => (n.text != null ? n.text : (n.kids || []).map(textOf).join(''));
const walk = (n, fn) => { fn(n); for (const k of n.kids || []) walk(k, fn); };
const hasContent = (n) => { let yes = false; walk(n, (k) => { if (yes) return; if (k.text != null ? /\S/.test(k.text.replace(/\u00a0/g, ' ')) : k.tag === 'img' || k.tag === 'table') yes = true; }); return yes; };
function toHtml(n) {
  if (n.text != null) return escT(n.text);
  const inner = (n.kids || []).map(toHtml).join('');
  if (n.tag === 'body' || n.tag === '#') return inner;
  const a = Object.entries(n.attrs || {}).map(([k, v]) => ` ${k}="${escA(v)}"`).join('');
  return VOID.has(n.tag) ? `<${n.tag}${a}/>` : `<${n.tag}${a}>${inner}</${n.tag}>`;
}
const el = (tag, attrs = {}, kids = []) => ({ tag, attrs, kids });

// ───────── EPUB reading ─────────
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);
function checkEpubDrm(z) {
  if (zget(z, 'META-INF/sinf.xml')) throw new Error(DRM);
  const enc = zget(z, 'META-INF/encryption.xml');
  if (!enc) return;
  let doc;
  try { doc = xml(decodeText(enc)); } catch (_) { return; }
  if (desc(doc, 'EncryptionMethod').some((m) => !FONT_OBFUSCATION.has(attr(m, 'Algorithm') || ''))) throw new Error(DRM);
}
function rootFile(z) {
  const c = zget(z, 'META-INF/container.xml');
  if (c) {
    try {
      const r = desc(xml(decodeText(c)), 'rootfile').find((e) => (attr(e, 'media-type') || 'application/oebps-package+xml') === 'application/oebps-package+xml');
      const p = r && inside('', safeDecode(attr(r, 'full-path') || ''));
      if (p && zget(z, p)) return [...z.keys()].find((k) => k.toLowerCase() === p.toLowerCase());
    } catch (_) {}
  }
  const opf = [...z.keys()].find((k) => /\.opf$/i.test(k));
  if (!opf) throw new Error('This is not a valid EPUB file: it has no package document (content.opf).');
  return opf;
}
function readOpf(z, opfPath) {
  const doc = xml(decodeText(zget(z, opfPath)));
  const root = doc.documentElement, dir = pp.dirname(opfPath);
  const manifest = new Map(), spine = [];
  for (const it of kids(kid(root, 'manifest'), 'item')) {
    const id = attr(it, 'id'), href = attr(it, 'href');
    const p = id && href != null && inside(dir, safeDecode(href.split('#')[0]));
    if (p && !manifest.has(id)) manifest.set(id, { id, path: p, type: (attr(it, 'media-type') || '').trim().toLowerCase(), props: attr(it, 'properties') || '' });
  }
  for (const r of kids(kid(root, 'spine'), 'itemref')) { const it = manifest.get(attr(r, 'idref')); if (it) spine.push(it); }
  const meta = { title: null, authors: [], language: null, description: null, publisher: null, cover: null, identifier: null };
  const md = kid(root, 'metadata');
  if (md) {
    const first = (n) => desc(md, n).map((e) => textContent(e).trim()).find(Boolean) || null;
    Object.assign(meta, { title: first('title'), language: first('language'), description: first('description'), publisher: first('publisher'), identifier: first('identifier') });
    const refines = {};
    for (const m of desc(md, 'meta')) if (attr(m, 'property') === 'role' && attr(m, 'refines')) refines[attr(m, 'refines').replace(/^#/, '')] = textContent(m).trim();
    for (const c of desc(md, 'creator')) {
      const name = textContent(c).trim(), role = attr(c, 'role') || refines[attr(c, 'id')] || null;
      if (name && (!role || role === 'aut') && !meta.authors.includes(name)) meta.authors.push(name);
    }
    let cover = [...manifest.values()].find((i) => i.props.split(/\s+/).includes('cover-image'));
    if (!cover) { const m = desc(md, 'meta').find((e) => attr(e, 'name') === 'cover'); cover = m && manifest.get(attr(m, 'content')); }
    const data = cover && cover.type.startsWith('image/') && zget(z, cover.path);
    if (data) meta.cover = { data: Buffer.from(data), mime: cover.type };
  }
  return { manifest, spine, meta };
}
const DROP = new Set(['script', 'style', 'link', 'meta', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'option', 'textarea', 'noscript', 'template', 'video', 'audio', 'source', 'track', 'canvas', 'math', 'head', 'title', 'guide']);
const garbage = (u8) => { if ((u8[0] === 0xff && u8[1] === 0xfe) || (u8[0] === 0xfe && u8[1] === 0xff)) return false; let bad = 0; const n = Math.min(u8.length, 4096); for (let i = 0; i < n; i++) if (u8[i] < 9 || (u8[i] > 13 && u8[i] < 32)) bad++; return n > 64 && bad / n > 0.05; };
// Reads chapter documents into one book body: every chapter starts a page and carries a bookmark c{n}; element ids
// become c{n}-{id}, links between chapters point at those bookmarks, and pictures come from inside the book only.
function readChapters(list, z) {
  const index = new Map(list.map((c, i) => [c.path.toLowerCase(), i + 1]));
  const anchor = (n, id) => (id == null ? `c${n}` : `c${n}-${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}`);
  const used = new Set();
  let title = null, bad = 0;
  const out = [];
  list.forEach((ch, i) => {
    const n = i + 1;
    let doc;
    if (ch.image) doc = { root: el('body', {}, [el('p', { style: 'text-align:center' }, [el('img', { src: encodeURIComponent(pp.basename(ch.path)) })])]) };
    else {
      const bytes = zget(z, ch.path);
      if (!bytes) return;
      if (garbage(bytes)) { bad++; return; }
      doc = ch.html != null ? parse(ch.html) : parse(decodeText(bytes));
      title ??= doc.title || null;
    }
    const dir = pp.dirname(ch.path);
    const link = (href) => {
      if (href.startsWith('#')) return href.length > 1 ? `#${anchor(n, safeDecode(href.slice(1)))}` : null;
      const colon = href.indexOf(':');
      if (colon > 1 && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(href.slice(0, colon))) return /^(javascript|vbscript|data|file):/i.test(href) ? null : href;
      const [file, frag] = [href.split('#')[0].split('?')[0], href.includes('#') ? safeDecode(href.slice(href.indexOf('#') + 1)) : ''];
      const target = inside(dir, safeDecode(file));
      const k = target != null && index.get(String(target).toLowerCase());
      return k ? `#${anchor(k, frag || null)}` : null;
    };
    const picture = (src) => {
      if (/^data:image\//i.test(src)) return src;
      const p = inside(dir, safeDecode(src.split('#')[0].split('?')[0]));
      const data = p != null && zget(z, p);
      return data && sniff(data) ? dataUri(data) : null;
    };
    const fix = (node) => {
      node.kids = (node.kids || []).flatMap((k) => {
        if (k.text != null) return [k];
        if (DROP.has(k.tag) || k.tag.startsWith('o:')) return [];
        if (k.tag === 'svg') {
          let im = null;
          walk(k, (x) => { if (!im && x.tag === 'image') im = x; });
          const src = im && (im.attrs['xlink:href'] || im.attrs.href);
          if (!src) return [];
          k = el('img', { src, alt: '' });
        }
        const a = k.attrs;
        for (const key of Object.keys(a)) if (/^on/.test(key) || key === 'xmlns' || key.startsWith('xmlns:') || key === 'name' && k.tag !== 'a') delete a[key];
        if (k.tag === 'a' && a.name && !a.id) a.id = a.name;
        delete a.name;
        if (a.id) a.id = anchor(n, a.id);
        if (a.style) a.style = a.style.replace(/url\s*\([^)]*\)/gi, 'none');
        if (k.tag === 'img') {
          const src = a.src && picture(a.src.trim());
          if (!src) return [];
          a.src = src;
        }
        if (k.tag === 'a' && a.href != null) {
          const h = link(a.href.trim());
          if (h) { a.href = h; if (h.startsWith('#')) used.add(h.slice(1)); } else delete a.href;
          delete a.target;
        }
        if (k.tag === 'mbp:pagebreak') { fix(k); return [el('div', { class: 'page-break' }), ...k.kids]; }
        fix(k);
        return [k];
      });
    };
    fix(doc.root);
    if (!hasContent(doc.root)) return;
    out.push(el('section', { class: 'chapter', id: anchor(n), ...(out.length ? { style: 'page-break-before:always' } : {}) }, doc.root.kids));
  });
  if (!out.length) {
    if (bad && bad >= list.filter((c) => !c.image).length / 2) throw new Error('This book may be protected with DRM (its chapters can’t be read). Lime doesn’t remove DRM; open it in the app it was bought for.');
    throw new Error('The book has no readable chapters.');
  }
  const body = el('body', {}, out);
  walk(body, (k) => { if (k.attrs?.id && !used.has(k.attrs.id) && k.tag !== 'section') delete k.attrs.id; if (k.tag === 'a' && k.attrs && !k.attrs.href && !k.attrs.id) k.tag = 'span'; });
  return { html: toHtml(body), title };
}
async function readEpub(file) {
  const z = unzip(await fsp.readFile(file), 'This is not a valid EPUB file (it is not a ZIP package).');
  checkEpubDrm(z);
  const { spine, meta } = readOpf(z, rootFile(z));
  const list = [];
  for (const it of spine) {
    if (['application/xhtml+xml', 'text/html', 'application/xml'].includes(it.type) || (!it.type && /html?$/i.test(it.path))) list.push({ path: it.path });
    else if (it.type.startsWith('image/')) list.push({ path: it.path, image: true });
  }
  if (!list.length) throw new Error('The EPUB has no readable chapters.');
  const r = readChapters(list, z);
  return { ...meta, title: meta.title || r.title, html: r.html };
}

// ───────── EPUB writing ─────────
const CSS = 'body{font-family:serif;line-height:1.6;margin:0 3%;}\nh1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.2em 0 .6em;page-break-after:avoid;}\np{margin:0 0 .6em;}\nli p{margin:.2em 0;}\ntable{border-collapse:collapse;margin:.8em 0;}\ntd,th{border:1px solid #999;padding:.2em .5em;vertical-align:top;}\ntable.plain td,table.plain th{border:none;}\ncaption{font-style:italic;margin-bottom:.3em;}\nimg{max-width:100%;}\npre{white-space:pre-wrap;background:#f4f3f8;padding:.5em .8em;}\ncode,pre{font-family:monospace;}\ncode{background:#f1f0f5;}\nmark{background:#fff3a3;}\nhr{border:none;border-top:1px solid #999;width:30%;margin:1.2em auto;}\n.page-break{page-break-before:always;break-before:page;}\n.box{border:1px solid #999;padding:.3em .6em;display:inline-block;}\naside.footnote,.footnotes{font-size:.9em;}\n';
const LIMIT = 150000;
const KEEP = new Set('a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr'.split(' '));
const RENAME = { center: 'div', font: 'span', big: 'span', tt: 'code', strike: 's', listing: 'pre', xmp: 'pre', nobr: 'span', blink: 'span', marquee: 'div' };
const ATTRS = { a: ['href'], img: ['src', 'alt', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'], ol: ['start', 'type', 'reversed'], li: ['value'], col: ['span'], colgroup: ['span'], time: ['datetime'] };
const GLOBAL = ['id', 'title', 'lang', 'dir', 'style', 'class', 'epub:type'];
const WRAP = new Set(['div', 'section', 'article', 'main', 'body', 'header', 'footer']);
const isBreak = (n) => !!n.attrs && (/page-break-before\s*:\s*always|break-before\s*:\s*(page|always)/i.test(n.attrs.style || '') || /\b(page-break|chapter)\b/.test(n.attrs.class || ''));
const isNote = (n) => !!n.attrs && /\bfootnotes?\b|\bendnotes?\b/.test(`${n.attrs.class || ''} ${n.attrs['epub:type'] || ''}`);
const cleanId = (s) => { const id = String(s).replace(/[^A-Za-z0-9._-]/g, '_'); return /^[A-Za-z_]/.test(id) ? id : `id-${id}`; };
const scheme = (h) => /^([A-Za-z][A-Za-z0-9+.-]+):/.exec(h)?.[1].toLowerCase();
const LABEL = { ko: '목차', zh: '目录', ja: '目次' };

// Flattens wrapper elements that hold chapter starts, so a book can be cut at level-1 headings and page breaks.
function flatten(nodes, out = []) {
  const deep = (n) => n.tag && WRAP.has(n.tag) && !isNote(n) && (n.kids.some((k) => k.tag === 'h1' || isBreak(k) || deep(k)) || textOf(n).length > LIMIT);
  for (const k of nodes) {
    if (!deep(k)) { out.push(k); continue; }
    const start = out.length;
    if (k.attrs.id) out.push(el('div', { id: k.attrs.id }));
    flatten(k.kids, out);
    if (out.length > start && (isBreak(k) || k.tag === 'section')) out[start].$brk = true;
  }
  return out;
}
class Images {
  constructor(base, gifAndSvg = true) { this.base = base; this.gifAndSvg = gifAndSvg; this.list = []; this.by = new Map(); }
  async load(src) {
    const s = String(src || '').trim();
    if (/^data:/i.test(s)) return fromDataUri(s)?.data || null;
    if (!s || /^(https?|ftp|blob|javascript):/i.test(s) || !this.base) return null;
    let p = s;
    if (/^file:/i.test(s)) { try { p = require('url').fileURLToPath(s); } catch (_) { return null; } } else p = path.resolve(this.base, safeDecode(s.split('#')[0].split('?')[0]));
    return fsp.readFile(p).catch(() => null);
  }
  async add(src, cover = false) {
    const data = Buffer.isBuffer(src) ? src : await this.load(src);
    if (!data) return null;
    const key = crypto.createHash('sha1').update(data).digest('hex');
    let it = this.by.get(key);
    if (!it) {
      const c = await commonImage(data, this.gifAndSvg);
      if (!c) return null;
      it = { ...c, key, href: `images/img${pad(this.list.length + 1)}.${c.ext}`, n: this.list.length + 1 };
      this.list.push(it);
      this.by.set(key, it);
    }
    if (cover) it.cover = true;
    return it;
  }
}
function xhtml(n, ctx) {
  if (n.text != null) return escT(n.text);
  let tag = n.tag;
  if (tag === 'body' || tag === '#') return n.kids.map((k) => xhtml(k, ctx)).join('');
  if (DROP.has(tag) || tag === 'svg') return '';
  const a = { ...n.attrs };
  if (RENAME[tag]) { if (tag === 'center') a.style = `text-align:center;${a.style || ''}`; tag = RENAME[tag]; }
  if (!KEEP.has(tag)) return n.kids.map((k) => xhtml(k, ctx)).join('');
  if (tag === 'img') { if (!n.$img) return ''; a.src = n.$img.href; a.alt ??= ''; }
  if (tag === 'a' && a.href != null) {
    const h = a.href.trim();
    if (h.startsWith('#')) {
      const t = ctx.ids.get(h.slice(1));
      if (!t) return n.kids.map((k) => xhtml(k, ctx)).join('');
      a.href = t.ch === ctx.ch ? `#${t.id}` : `${ctx.file(t.ch)}#${t.id}`;
    } else if (!scheme(h) || /^(javascript|vbscript|data|file)$/.test(scheme(h))) {
      if (!a.id) return n.kids.map((k) => xhtml(k, ctx)).join('');
      delete a.href;
    }
    if (/\bnoteref\b/.test(`${a.class || ''} ${a['epub:type'] || ''}`)) a['epub:type'] = 'noteref';
  }
  if (tag === 'aside' && isNote(n)) a['epub:type'] = 'footnote';
  if (tag === 'section' && /\bfootnotes\b/.test(a.class || '')) a['epub:type'] = 'footnotes';
  if (tag === 'p' && !n.$id && !hasContent(n) && !n.kids.some((k) => k.tag === 'br' || k.$id)) return '';
  if (n.$id) a.id = n.$id; else delete a.id;
  const allow = new Set([...GLOBAL, ...(ATTRS[tag] || [])]);
  if (a.style) a.style = a.style.replace(/url\s*\([^)]*\)|expression\s*\(|behavior\s*:[^;]*/gi, '').trim();
  if (a.class) a.class = a.class.split(/\s+/).filter((c) => c && c !== 'chapter').join(' ');
  for (const k of ['width', 'height', 'colspan', 'rowspan', 'start', 'span', 'value']) if (a[k] != null && !/^\d+$/.test(a[k])) delete a[k];
  const attrs = Object.entries(a).filter(([k, v]) => allow.has(k) && v !== '').map(([k, v]) => ` ${k}="${escA(v)}"`).join('');
  if (VOID.has(tag)) return `<${tag}${attrs}/>`;
  return `<${tag}${attrs}>${n.kids.map((k) => xhtml(k, ctx)).join('')}</${tag}>`;
}
const page = (title, body, lang, head = '', css = 'style.css') => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escA(lang)}" xml:lang="${escA(lang)}">\n<head>\n<meta charset="utf-8"/>\n<title>${escT(title)}</title>\n${head}${css ? `<link rel="stylesheet" type="text/css" href="${css}"/>\n` : ''}</head>\n<body>\n${body}</body>\n</html>\n`;
function navXhtml(entries, title, lang) {
  let s = `<nav epub:type="toc" id="toc">\n<h1>${escT(LABEL[lang.split('-')[0].toLowerCase()] || 'Contents')}</h1>\n`, depth = 0;
  for (const e of entries) {
    const level = Math.min(e.level, depth + 1);
    s += level > depth ? '<ol>\n' : '</li>\n';
    for (; depth > level; depth--) s += '</ol>\n</li>\n';
    depth = level;
    s += `<li><a href="${escA(e.target)}">${escT(e.text)}</a>`;
  }
  for (; depth > 0; depth--) s += '</li>\n</ol>\n';
  return page(title, `${s}</nav>\n`, lang);
}
function ncx(entries, title, uid) {
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n<head>\n<meta name="dtb:uid" content="${escA(uid)}"/>\n<meta name="dtb:depth" content="${Math.max(1, ...entries.map((e) => e.level))}"/>\n<meta name="dtb:totalPageCount" content="0"/>\n<meta name="dtb:maxPageNumber" content="0"/>\n</head>\n<docTitle><text>${escT(title)}</text></docTitle>\n<navMap>\n`, depth = 0;
  entries.forEach((e, i) => {
    const level = Math.min(e.level, depth + 1);
    for (; depth >= level; depth--) s += '</navPoint>\n';
    depth = level;
    s += `<navPoint id="nav${i + 1}" playOrder="${i + 1}"><navLabel><text>${escT(e.text)}</text></navLabel><content src="${escA(e.target)}"/>\n`;
  });
  for (; depth > 0; depth--) s += '</navPoint>\n';
  return `${s}</navMap>\n</ncx>\n`;
}
function packageEpub({ title, lang, meta = {}, pages, images, toc, css, fixed = false }) {
  const { zipSync, strToU8 } = require('fflate');
  const uid = `urn:uuid:${crypto.randomUUID()}`;
  const entries = toc.length ? toc : [{ level: 1, text: title, target: pages[0]?.href || 'nav.xhtml' }];
  const cover = images.find((i) => i.cover);
  const opf = `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escA(lang)}"${fixed ? ' prefix="rendition: http://www.idpf.org/vocab/rendition/#"' : ''}>\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n<dc:identifier id="book-id">${uid}</dc:identifier>\n<dc:title>${escT(title)}</dc:title>\n<dc:language>${escT(lang)}</dc:language>\n${(meta.authors || []).map((a) => `<dc:creator>${escT(a)}</dc:creator>\n`).join('')}${meta.publisher ? `<dc:publisher>${escT(meta.publisher)}</dc:publisher>\n` : ''}${meta.description ? `<dc:description>${escT(meta.description)}</dc:description>\n` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>\n${cover ? `<meta name="cover" content="img${cover.n}"/>\n` : ''}${fixed ? '<meta property="rendition:layout">pre-paginated</meta>\n<meta property="rendition:spread">auto</meta>\n' : ''}</metadata>\n<manifest>\n<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n<item id="css" href="style.css" media-type="text/css"/>\n${pages.map((p, i) => `<item id="page${i + 1}" href="${escA(p.href)}" media-type="application/xhtml+xml"/>\n`).join('')}${images.map((m) => `<item id="img${m.n}" href="${m.href}" media-type="${m.mime}"${m.cover ? ' properties="cover-image"' : ''}/>\n`).join('')}</manifest>\n<spine toc="ncx">\n${pages.map((p, i) => `<itemref idref="page${i + 1}"/>\n`).join('')}</spine>\n</package>\n`;
  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n'),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(navXhtml(entries, title, lang)),
    'OEBPS/toc.ncx': strToU8(ncx(entries, title, uid)),
    'OEBPS/style.css': strToU8(css),
  };
  for (const p of pages) files[`OEBPS/${p.href}`] = strToU8(p.content);
  for (const m of images) files[`OEBPS/${m.href}`] = [new Uint8Array(m.data), { level: 0 }];
  return zipSync(files, { level: 6 });
}
// HTML → reflowable EPUB 3 (with an EPUB 2 NCX): chapters split at level-1 headings and page breaks, ids kept and
// links between chapters rewritten, every picture packaged (others converted to JPEG or PNG), remote pictures dropped.
async function writeEpub(html, meta, out) {
  const doc = parse(html);
  const body = doc.root;
  const firstH = (() => { let t = ''; walk(body, (k) => { if (!t && /^h[1-6]$/.test(k.tag || '')) t = textOf(k).replace(/\s+/g, ' ').trim().slice(0, 200); }); return t; })();
  const title = (meta.title || doc.title || firstH || meta.name || 'Untitled').trim();
  const lang = (meta.language || doc.lang || guessLang(textOf(body))).trim();
  const blocks = flatten(body.kids);
  const chapters = [[]];
  let len = 0, has = false;
  for (const b of blocks) {
    if (has && (b.$brk || isBreak(b) || b.tag === 'h1' || (len > LIMIT && b.tag === 'p'))) { chapters.push([]); len = 0; has = false; }
    chapters[chapters.length - 1].push(b);
    len += textOf(b).length;
    has ||= hasContent(b);
  }
  const file = (i) => `ch${pad(i + 1, 3)}.xhtml`;
  const ids = new Map(), usedIds = new Set(), headings = [], imgs = [];
  let hk = 0;
  const uniq = (id) => { let x = id; for (let k = 2; usedIds.has(x); k++) x = `${id}-${k}`; usedIds.add(x); return x; };
  chapters.forEach((list, ch) => list.forEach((b) => walk(b, (k) => {
    if (!k.tag) return;
    if (k.tag === 'a' && k.attrs.name && !k.attrs.id) k.attrs.id = k.attrs.name;
    if (k.attrs.id) { k.$id = uniq(cleanId(k.attrs.id)); if (!ids.has(k.attrs.id)) ids.set(k.attrs.id, { ch, id: k.$id }); }
    if (/^h[1-6]$/.test(k.tag)) {
      if (!k.$id) k.$id = uniq(`_h${++hk}`);
      const text = textOf(k).replace(/\s+/g, ' ').trim();
      if (text) headings.push({ level: Number(k.tag[1]), text, target: `${file(ch)}#${k.$id}` });
    }
    if (k.tag === 'img') imgs.push(k);
  })));
  const images = new Images(meta.base);
  for (const k of imgs) k.$img = await images.add(k.attrs.src);
  const pages = [];
  let coverImg = null;
  if (meta.cover) {
    const data = Buffer.isBuffer(meta.cover) ? meta.cover : meta.cover.data || fromDataUri(meta.cover)?.data;
    coverImg = data && await images.add(data, true);
    if (coverImg && !imgs.some((k) => k.$img === coverImg)) pages.push({ href: 'cover.xhtml', content: page(title, `<div style="text-align:center"><img src="${coverImg.href}" alt="${escA(title)}" style="max-height:100%"/></div>\n`, lang) });
  }
  chapters.forEach((list, ch) => {
    if (!list.length) return;
    const bodyX = list.filter((b) => b.text == null || /\S/.test(b.text)).map((b) => xhtml(b, { ch, ids, file })).filter(Boolean).join('\n');
    const h = headings.find((x) => x.target.startsWith(`${file(ch)}#`));
    pages.push({ href: file(ch), content: page(h?.text || title, `${bodyX}\n`, lang), plain: textOf({ kids: list }).replace(/\s+/g, ' ').trim().slice(0, 60) });
  });
  if (!pages.length) pages.push({ href: file(0), content: page(title, '<p></p>\n', lang), plain: '' });
  let toc;
  if (headings.length) { const top = Math.min(...headings.map((x) => x.level)); toc = headings.filter((x) => x.level <= top + 1).map((x) => ({ ...x, level: x.level - top + 1 })); } else toc = pages.filter((p) => p.href !== 'cover.xhtml').map((p, i) => ({ level: 1, text: i === 0 ? title : p.plain ? `${p.plain}…` : String(i + 1), target: p.href }));
  await fsp.writeFile(out, packageEpub({ title, lang, meta, pages, images: images.list, toc, css: CSS }));
  return out;
}

// ───────── FB2 ─────────
const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
async function readFb2(file) {
  const doc = xml(decodeText(await fsp.readFile(file)));
  const root = doc.documentElement;
  if (local(root) !== 'FictionBook') throw new Error('This is not a FictionBook (FB2) file.');
  const bin = new Map();
  for (const b of kids(root, 'binary')) {
    const id = attr(b, 'id');
    if (!id) continue;
    const data = Buffer.from(textContent(b).replace(/\s+/g, ''), 'base64');
    if (data.length) bin.set(id, dataUri(data, /^image\/(png|gif|jpe?g)$/i.test(attr(b, 'content-type') || '') ? attr(b, 'content-type').toLowerCase().replace('jpg', 'jpeg') : MIME[sniff(data)] || 'image/jpeg'));
  }
  const href = (e) => attr(e, 'href');
  const img = (e) => { const h = href(e); return h && bin.get(h.replace(/^#/, '')); };
  const bodies = kids(root, 'body');
  const isNotes = (b) => ['notes', 'comments'].includes(attr(b, 'name'));
  const notes = new Map();
  for (const b of bodies.filter(isNotes)) for (const s of desc(b, 'section')) if (attr(s, 'id') && !notes.has(attr(s, 'id'))) notes.set(attr(s, 'id'), s);
  const info = kid(kid(root, 'description'), 'title-info');
  const meta = { title: textContent(kid(info, 'book-title')).trim() || null, language: textContent(kid(info, 'lang')).trim() || null, description: textContent(kid(info, 'annotation')).replace(/\s+/g, ' ').trim() || null, publisher: textContent(kid(kid(kid(root, 'description'), 'publish-info'), 'publisher')).trim() || null, authors: [], cover: null };
  for (const a of kids(info, 'author')) {
    const name = ['first-name', 'middle-name', 'last-name'].map((n) => textContent(kid(a, n)).trim()).filter(Boolean).join(' ') || textContent(kid(a, 'nickname')).trim();
    if (name) meta.authors.push(name);
  }
  const cov = kid(kid(info, 'coverpage'), 'image');
  if (cov && img(cov)) meta.cover = fromDataUri(img(cov));
  let fn = 0, pending = [];
  const inl = (e) => arr(e.childNodes).map((c) => {
    if (c.nodeType === 3 || c.nodeType === 4) return escT(String(c.nodeValue).replace(/[ \r\n\t]+/g, ' '));
    if (c.nodeType !== 1) return '';
    const t = local(c), wrap = { strong: 'b', emphasis: 'i', strikethrough: 's', sub: 'sub', sup: 'sup', code: 'code' }[t];
    if (wrap) return `<${wrap}>${inl(c)}</${wrap}>`;
    if (t === 'image') { const s = img(c); return s ? `<img src="${s}" alt=""/>` : ''; }
    if (t === 'a') {
      const h = href(c) || '';
      const note = h.startsWith('#') && notes.get(h.slice(1));
      if (note) {
        const body = kids(note).filter((x) => local(x) !== 'title').map((x) => block(x, 0)).join('');
        if (body) { const k = ++fn; pending.push(`<aside class="footnote" epub:type="footnote" id="fn${k}"><p><a href="#fnref${k}">${k}.</a></p>${body}</aside>`); return `<a class="noteref" epub:type="noteref" href="#fn${k}" id="fnref${k}"><sup>${k}</sup></a>`; }
      }
      return h ? `<a href="${escA(h)}">${inl(c)}</a>` : inl(c);
    }
    return inl(c);
  }).join('');
  const line = (e) => inl(e).replace(/^\s+|\s+$/g, '');
  const idA = (e) => (attr(e, 'id') ? ` id="${escA(attr(e, 'id'))}"` : '');
  const title = (e, depth, center) => { const lines = kids(e, 'p').map(line).filter(Boolean); const lv = Math.min(6, Math.max(1, depth)); return lines.length ? `<h${lv}${center ? ' style="text-align:center"' : ''}>${lines.join('<br/>')}</h${lv}>` : ''; };
  const indent = (s, ind) => (ind ? `<blockquote>${s}</blockquote>` : s);
  function block(e, depth, ind = 0) {
    switch (local(e)) {
      case 'title': return title(e, depth, false);
      case 'section': return section(e, depth + 1);
      case 'p': return `<p${idA(e)}>${line(e)}</p>`;
      case 'subtitle': return `<p${idA(e)} style="text-align:center"><b>${line(e)}</b></p>`;
      case 'empty-line': return '<p><br/></p>';
      case 'epigraph': return epigraph(e);
      case 'annotation': case 'cite': return `<blockquote>${kids(e).map((c) => block(c, depth, ind + 1)).join('')}</blockquote>`;
      case 'text-author': return `<p style="text-align:right"><i>${line(e)}</i></p>`;
      case 'poem': return indent(kids(e).map((c) => {
        if (local(c) === 'title') return title(c, depth + 1, false);
        if (local(c) !== 'stanza') return block(c, depth, ind);
        let s = '';
        const verses = [];
        for (const v of kids(c)) { if (local(v) === 'title' || local(v) === 'subtitle') s += `<p><b>${line(local(v) === 'title' ? kid(v, 'p') || v : v)}</b></p>`; else verses.push(line(v)); }
        return s + (verses.length ? `<p>${verses.join('<br/>')}</p>` : '');
      }).join(''), 1);
      case 'image': { const s = img(e); return s ? `<p style="text-align:center"><img src="${s}" alt=""/></p>` : ''; }
      case 'table': return `<table>${kids(e, 'tr').map((r) => { const cells = kids(r).filter((c) => ['td', 'th'].includes(local(c))); const head = cells.length && cells.every((c) => local(c) === 'th'); return `<tr>${cells.map((c) => { const al = /^(center|right)$/i.test(attr(c, 'align') || '') ? ` style="text-align:${attr(c, 'align').toLowerCase()}"` : ''; const span = ['colspan', 'rowspan'].map((k) => (/^\d+$/.test(attr(c, k) || '') ? ` ${k}="${attr(c, k)}"` : '')).join(''); const t = head || local(c) === 'th' ? 'th' : 'td'; return `<${t}${span}${al}>${line(c)}</${t}>`; }).join('')}</tr>`; }).join('')}</table>`;
      default: return '';
    }
  }
  const epigraph = (e) => kids(e).map((c) => (local(c) === 'p' ? `<p style="text-align:right"><i>${line(c)}</i></p>` : block(c, 0, 1))).join('');
  function section(e, depth) {
    const inner = kids(e).map((c) => block(c, depth)).join('');
    if (!inner) return '';
    if (depth > 1) return `<section${idA(e)}>${inner}</section>`;
    const notesHtml = pending.length ? `<section class="footnotes">${pending.join('')}</section>` : '';
    pending = [];
    return `<section class="chapter"${idA(e)}>${inner}${notesHtml}</section>`;
  }
  let html = '';
  for (const b of bodies.filter((x) => !isNotes(x))) {
    for (const c of kids(b)) {
      const t = local(c);
      html += t === 'title' ? title(c, 1, true) : t === 'epigraph' ? epigraph(c) : t === 'image' ? block(c, 0) : t === 'section' ? section(c, 1) : '';
    }
  }
  if (pending.length) html += `<section class="footnotes">${pending.join('')}</section>`;
  let first = true;
  html = html.replace(/<section class="chapter"/g, (m) => { if (first) { first = false; return m; } return `${m} style="page-break-before:always"`; });
  return { ...meta, html };
}
// Inline runs and blocks of an HTML body, for writers without a DOM model of their own (FB2).
function flow(body) {
  const notes = new Map();
  walk(body, (k) => { if (k.tag && k.attrs.id && (k.tag === 'aside' && isNote(k) || /^(footnote|endnote)-\d+$/.test(k.attrs.id) && k.tag === 'li')) notes.set(k.attrs.id, k); });
  const blocks = [];
  const runs = (n, f = {}, out = []) => {
    for (const k of n.kids || []) {
      if (k.text != null) { out.push({ ...f, text: k.text.replace(/[ \t\r\n]+/g, ' ') }); continue; }
      if (DROP.has(k.tag)) continue;
      if (k.attrs.id) out.push({ anchor: k.attrs.id });
      if (k.tag === 'br') { out.push({ br: true }); continue; }
      if (k.tag === 'img') { out.push({ img: k.attrs.src }); continue; }
      if (k.tag === 'a' && /^#/.test(k.attrs.href || '') && notes.has(k.attrs.href.slice(1))) { out.push({ note: notes.get(k.attrs.href.slice(1)) }); continue; }
      const g = { ...f };
      if (/^(b|strong)$/.test(k.tag)) g.b = true;
      if (/^(i|em|cite|dfn|var)$/.test(k.tag)) g.i = true;
      if (/^(s|del|strike)$/.test(k.tag)) g.s = true;
      if (k.tag === 'sup') g.sup = true;
      if (k.tag === 'sub') g.sub = true;
      if (/^(code|kbd|samp|tt)$/.test(k.tag)) g.code = true;
      if (k.tag === 'a' && k.attrs.href) g.href = k.attrs.href;
      runs(k, g, out);
    }
    return out;
  };
  const trim = (rs) => { const t = rs.filter((r) => r.text != null); if (t.length) { t[0].text = t[0].text.replace(/^\s+/, ''); t[t.length - 1].text = t[t.length - 1].text.replace(/\s+$/, ''); } return rs.filter((r) => r.text !== ''); };
  const align = (k) => /text-align\s*:\s*(center|right)/i.exec(k.attrs?.style || '')?.[1]?.toLowerCase() || (k.tag === 'center' ? 'center' : (k.attrs?.align || '').toLowerCase());
  let carry = [];
  const push = (b) => { if (b.runs && carry.length) { b.runs = [...carry.map((anchor) => ({ anchor })), ...b.runs]; carry = []; } blocks.push(b); };
  const visit = (n, ctx) => {
    let inline = [];
    const flush = () => { const r = trim(inline); if (r.some((x) => x.text?.trim() || x.img || x.note)) push({ type: 'p', runs: r, quote: ctx.quote }); inline = []; };
    for (const k of n.kids || []) {
      if (k.text != null || !(BLOCK.has(k.tag) || ['table', 'tr', 'td', 'th', 'tbody', 'thead', 'tfoot'].includes(k.tag))) { if (k.text != null || !DROP.has(k.tag)) inline.push(...runs({ kids: [k] })); continue; }
      flush();
      if (notes.has(k.attrs.id) || (k.tag === 'section' && /\bfootnotes\b/.test(k.attrs.class || ''))) continue;
      if ((k.tag === 'ol' || k.tag === 'ul') && k.kids.some((c) => c.tag === 'li' && notes.has(c.attrs.id))) continue;
      const id = k.attrs.id ? [{ anchor: k.attrs.id }] : [];
      if (/^h[1-6]$/.test(k.tag)) push({ type: 'h', level: Number(k.tag[1]), runs: [...id, ...trim(runs(k))] });
      else if (k.tag === 'hr') push({ type: 'hr' });
      else if (k.tag === 'pre') push({ type: 'pre', text: textOf(k).replace(/\n$/, '') });
      else if (k.tag === 'table') { const rows = []; walk(k, (r) => { if (r.tag === 'tr') rows.push(r.kids.filter((c) => c.tag === 'td' || c.tag === 'th').map((c) => ({ head: c.tag === 'th', colspan: c.attrs.colspan, rowspan: c.attrs.rowspan, runs: trim(runs(c)).filter((x) => !x.img && !x.br) }))); }); push({ type: 'table', rows }); }
      else if (k.tag === 'li') {
        const depth = ctx.depth || 0, list = ctx.list;
        const own = { ...k, kids: k.kids.filter((c) => c.tag !== 'ul' && c.tag !== 'ol') };
        const marker = list?.ordered ? `${'    '.repeat(depth)}${++list.n}. ` : '    '.repeat(depth);
        const r = trim(runs(own));
        if (r.length) push({ type: 'p', runs: [...id, { text: marker }, ...r] });
        for (const c of k.kids) if (c.tag === 'ul' || c.tag === 'ol') visit({ kids: [c] }, { ...ctx, depth: depth + 1 });
      } else if (k.tag === 'ul' || k.tag === 'ol') visit(k, { ...ctx, list: { ordered: k.tag === 'ol', n: Number(k.attrs.start || 1) - 1 }, depth: ctx.depth || 0 });
      else if (k.tag === 'blockquote') { if (id.length) carry.push(k.attrs.id); visit(k, { ...ctx, quote: true }); }
      else if (k.tag === 'p' || /^(dt|dd|figcaption|address)$/.test(k.tag)) push({ type: 'p', runs: [...id, ...trim(runs(k))], align: align(k), quote: ctx.quote });
      else { if (id.length) carry.push(k.attrs.id); visit(k, ctx); }
    }
    flush();
  };
  visit(body, {});
  return { blocks, notes };
}
async function writeFb2(book, out) {
  const doc = parse(book.html);
  const { blocks } = flow(doc.root);
  const imgs = new Images(book.base, false);
  const binId = (it) => `img${it.n}.${it.ext}`;
  const notes = [];
  const fixId = (s) => { const x = String(s).replace(/[^A-Za-z0-9._-]/g, '_'); return /^[A-Za-z]/.test(x) ? x : `id-${x}`; };
  const xmlImg = async (src) => { const it = await imgs.add(src); return it ? `<image l:href="#${binId(it)}"/>` : ''; };
  async function inl(rs) {
    let s = '';
    for (const r of rs) {
      if (r.img) s += await xmlImg(r.img);
      else if (r.note) { notes.push(r.note); s += `<a l:href="#n${notes.length}" type="note">[${notes.length}]</a>`; }
      else if (r.text != null) {
        let t = escT(r.text.replace(/\t/g, '    '));
        if (r.sup) t = `<sup>${t}</sup>`; else if (r.sub) t = `<sub>${t}</sub>`;
        if (r.s) t = `<strikethrough>${t}</strikethrough>`;
        if (r.i) t = `<emphasis>${t}</emphasis>`;
        if (r.b) t = `<strong>${t}</strong>`;
        if (r.code) t = `<code>${t}</code>`;
        if (r.href) t = `<a l:href="${escA(r.href.startsWith('#') ? `#${fixId(r.href.slice(1))}` : r.href)}">${t}</a>`;
        s += t;
      }
    }
    return s;
  }
  const lines = (rs) => { const ls = [[]]; for (const r of rs) { if (r.br) ls.push([]); else ls[ls.length - 1].push(r); } return ls; };
  async function paras(rs, tag) {
    let s = '';
    for (const l of lines(rs)) { const a = l.find((r) => r.anchor); s += `<${tag}${a ? ` id="${escA(fixId(a.anchor))}"` : ''}>${await inl(l.filter((r) => !r.anchor))}</${tag}>\n`; }
    return s;
  }
  async function blockXml(b) {
    if (b.type === 'hr') return '<subtitle>* * *</subtitle>\n';
    if (b.type === 'pre') return b.text.split('\n').map((l) => `<p><code>${escT(l) || ' '}</code></p>\n`).join('');
    if (b.type === 'table') {
      let s = '<table>\n';
      for (const r of b.rows) { s += '<tr>'; for (const c of r) s += `<${c.head ? 'th' : 'td'}${/^\d+$/.test(c.colspan || '') && c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${/^\d+$/.test(c.rowspan || '') && c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}>${await inl(c.runs.filter((x) => !x.anchor))}</${c.head ? 'th' : 'td'}>`; s += '</tr>\n'; }
      return `${s}</table>\n`;
    }
    const vis = b.runs.filter((r) => !r.anchor);
    if (vis.length === 1 && vis[0].img) return xmlImg(vis[0].img).then((x) => `${x}\n`);
    if (!vis.some((r) => r.img || r.note || r.text?.trim())) return '<empty-line/>\n';
    const bold = b.align === 'center' && vis.filter((r) => r.text?.trim()).every((r) => r.b);
    const body = await paras(b.runs, bold ? 'subtitle' : 'p');
    return b.quote ? `<cite>\n${body}</cite>\n` : body;
  }
  const root = { level: 0, kids: [], blocks: [] };
  const stack = [root];
  for (const b of blocks) {
    if (b.type === 'h') {
      while (stack[stack.length - 1].level >= b.level) stack.pop();
      const s = { level: b.level, title: b.runs, kids: [], blocks: [] };
      stack[stack.length - 1].kids.push(s);
      stack.push(s);
      continue;
    }
    if (stack.length === 1) { const s = { level: 1, kids: [], blocks: [] }; root.kids.push(s); stack.push(s); }
    stack[stack.length - 1].blocks.push(b);
  }
  async function sectionXml(s) {
    const a = s.title?.find((r) => r.anchor);
    let x = `<section${a ? ` id="${escA(fixId(a.anchor))}"` : ''}>\n`;
    if (s.title) x += `<title>\n${await paras(s.title.filter((r) => !r.anchor), 'p')}</title>\n`;
    let content = '';
    for (const b of s.blocks) content += await blockXml(b);
    if (s.kids.length && content) x += `<section>\n${content}</section>\n`; else x += content;
    for (const k of s.kids) x += await sectionXml(k);
    if (!content && !s.kids.length) x += '<empty-line/>\n';
    return `${x}</section>\n`;
  }
  let bodyXml = '';
  for (const s of root.kids) bodyXml += await sectionXml(s);
  if (!bodyXml) bodyXml = '<section><empty-line/></section>\n';
  let notesXml = '';
  for (let i = 0; i < notes.length; i++) {
    const { blocks: nb } = flow({ kids: notes[i].kids });
    let s = '';
    for (const b of nb) { if (b.type === 'p') b.runs = b.runs.filter((r) => !(r.href && /^#/.test(r.href) && /^\s*(\d+\.?|↑|\^)\s*$/.test(r.text || ''))); s += await blockXml(b); }
    notesXml += `<section id="n${i + 1}"><title><p>${i + 1}</p></title>\n${s || '<empty-line/>\n'}</section>\n`;
  }
  const cover = book.cover && await imgs.add(Buffer.isBuffer(book.cover) ? book.cover : book.cover.data || fromDataUri(book.cover)?.data);
  const authors = book.authors?.length ? book.authors : [''];
  const today = new Date().toISOString().slice(0, 10);
  const title = book.title || doc.title || book.name || 'Untitled';
  const lang = (book.language || doc.lang || guessLang(textOf(doc.root))).split('-')[0];
  const xmlOut = `<?xml version="1.0" encoding="utf-8"?>\n<FictionBook xmlns="${FB2_NS}" xmlns:l="http://www.w3.org/1999/xlink">\n<description>\n<title-info>\n<genre>antique</genre>\n${authors.map((a) => { const p = a.split(/\s+/).filter(Boolean); return `<author>${p.length >= 2 ? `<first-name>${escT(p.slice(0, -1).join(' '))}</first-name><last-name>${escT(p[p.length - 1])}</last-name>` : `<nickname>${escT(p[0] || 'Unknown')}</nickname>`}</author>\n`; }).join('')}<book-title>${escT(title)}</book-title>\n${book.description ? `<annotation><p>${escT(book.description)}</p></annotation>\n` : ''}<lang>${escT(lang)}</lang>\n${cover ? `<coverpage><image l:href="#${binId(cover)}"/></coverpage>\n` : ''}</title-info>\n<document-info>\n<author><nickname>Lime</nickname></author>\n<program-used>Lime</program-used>\n<date value="${today}">${today}</date>\n<id>${crypto.randomUUID()}</id>\n<version>1.0</version>\n</document-info>\n</description>\n<body>\n${bodyXml}</body>\n${notesXml ? `<body name="notes">\n${notesXml}</body>\n` : ''}${imgs.list.map((m) => `<binary id="${binId(m)}" content-type="${m.mime}">${m.data.toString('base64').replace(/.{76}/g, '$&\n')}</binary>\n`).join('')}</FictionBook>\n`;
  await fsp.writeFile(out, xmlOut);
  return out;
}

// ───────── Markdown with pictures beside it ─────────
// Pictures become files in "<name>_files/" next to the Markdown file, linked relatively; remote pictures stay links.
async function markdown(html, out, base) {
  const srcs = new Set();
  walk(parse(html).root, (k) => { if (k.tag === 'img' && k.attrs.src) srcs.add(k.attrs.src); });
  const imgs = new Images(base), links = new Map();
  let folder = null;
  for (const src of srcs) {
    if (/^(https?|ftp):/i.test(src)) continue;
    const it = await imgs.add(src);
    if (!it) continue;
    if (!folder) { folder = U.uniquePath(path.join(path.dirname(out), `${path.basename(out, path.extname(out))}_files`)); await fsp.mkdir(folder, { recursive: true }); }
    const name = `img${pad(it.n)}.${it.ext}`;
    await fsp.writeFile(path.join(folder, name), it.data);
    links.set(src, `${encodeURIComponent(path.basename(folder))}/${name}`);
  }
  const md = office().htmlToMd(html, { image: (src) => links.get(src) ?? (/^(https?|ftp):/i.test(src || '') ? src : '') });
  return { md, folder };
}

// ───────── KEPUB (Kobo) ─────────
// Every sentence of the spine's XHTML becomes <span class="koboSpan" id="kobo.P.S">, pictures get a span of their
// own and the body is wrapped in #book-columns > #book-inner; every other file is copied byte for byte.
const SKIP = new Set(['script', 'style', 'textarea', 'select', 'option', 'noscript', 'head', 'title']);
const KBLOCK = new Set('body p div h1 h2 h3 h4 h5 h6 li ol ul dl dt dd blockquote pre td th tr table caption figure figcaption section article aside header footer nav address main hr'.split(' '));
const END = '.!?…。！？', CLOSE = '"\')]”’」』）', WIDE = '。！？';
function sentences(text) {
  const out = [];
  let start = 0, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (!END.includes(c)) { i++; continue; }
    let end = i + 1;
    while (end < text.length && (END.includes(text[end]) || CLOSE.includes(text[end]))) end++;
    if (end < text.length && /\s/.test(text[end])) { while (end < text.length && /\s/.test(text[end])) end++; } else if (!WIDE.includes(c)) { i = end; continue; }
    if (end < text.length) { out.push(text.slice(start, end)); start = end; }
    i = end;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}
function xhtmlDoc(bytes) {
  let t = decodeText(bytes);
  t = t.replace(/&([A-Za-z][A-Za-z0-9]{1,31});/g, (m, n) => (['amp', 'lt', 'gt', 'quot', 'apos'].includes(n) ? m : ENT[n] != null ? [...ENT[n]].map((c) => `&#x${c.codePointAt(0).toString(16).toUpperCase()};`).join('') : m));
  try { const d = xml(t); return d.errors.length ? null : { d, decl: /^\s*<\?xml/.test(t) }; } catch (_) { return null; }
}
const xmlOut = (doc) => { const s = new (require('@xmldom/xmldom').XMLSerializer)().serializeToString(doc.d); return Buffer.from(doc.decl ? s : `<?xml version="1.0" encoding="utf-8"?>\n${s}`); };
const isKobo = (e) => local(e) === 'span' && String(e.getAttribute('class') || '').split(/\s+/).includes('koboSpan');
const isWrap = (e) => local(e) === 'div' && ['book-columns', 'book-inner'].includes(e.getAttribute('id'));
function addSpans(doc) {
  const body = desc(doc.d.documentElement, 'body')[0];
  if (!body || desc(doc.d.documentElement, 'span').some(isKobo)) return false;
  const ns = body.namespaceURI, D = doc.d;
  let block = null, para = 0, sent = 0;
  const blockOf = (n) => { let p = n.parentNode; while (p && !KBLOCK.has(local(p)) && p.parentNode && p.parentNode.nodeType === 1) p = p.parentNode; return p; };
  const span = (b, child) => { if (b !== block) { block = b; para++; sent = 0; } const s = D.createElementNS(ns, 'span'); s.setAttribute('class', 'koboSpan'); s.setAttribute('id', `kobo.${para}.${++sent}`); s.appendChild(child); return s; };
  const visit = (el) => {
    for (const n of arr(el.childNodes)) {
      if (n.nodeType === 3 && n.nodeValue.trim()) {
        const v = n.nodeValue, lead = /^\s*/.exec(v)[0], b = blockOf(n);
        const nodes = [];
        if (lead) nodes.push(D.createTextNode(lead));
        for (const sn of sentences(v.slice(lead.length))) nodes.push(span(b, D.createTextNode(sn)));
        for (const x of nodes) el.insertBefore(x, n);
        el.removeChild(n);
      } else if (n.nodeType === 1) {
        if (n.namespaceURI !== ns || SKIP.has(local(n))) continue;
        if (local(n) === 'img') { const b = blockOf(n); const ref = n.nextSibling; el.removeChild(n); el.insertBefore(span(b, n), ref); } else visit(n);
      }
    }
  };
  visit(body);
  const outer = D.createElementNS(ns, 'div'), inner = D.createElementNS(ns, 'div');
  outer.setAttribute('id', 'book-columns');
  inner.setAttribute('id', 'book-inner');
  for (const n of arr(body.childNodes)) inner.appendChild(n);
  outer.appendChild(inner);
  body.appendChild(outer);
  return true;
}
function removeSpans(doc) {
  const marks = [...desc(doc.d.documentElement, 'span').filter(isKobo), ...desc(doc.d.documentElement, 'div').filter(isWrap)];
  const depth = (n) => { let k = 0; for (let p = n; p; p = p.parentNode) k++; return k; };
  marks.sort((a, b) => depth(b) - depth(a));
  for (const e of marks) { const p = e.parentNode; while (e.firstChild) p.insertBefore(e.firstChild, e); p.removeChild(e); }
  return marks.length > 0;
}
async function rewriteEpub(input, out, fn) {
  const { zipSync, strToU8 } = require('fflate');
  const z = unzip(await fsp.readFile(input), 'This is not a valid EPUB file (it is not a ZIP package).');
  checkEpubDrm(z);
  let docs = new Set();
  try {
    for (const it of readOpf(z, rootFile(z)).spine) if (['application/xhtml+xml', 'text/html'].includes(it.type) || /\.x?html?$/i.test(it.path)) docs.add(it.path);
  } catch (_) {}
  if (!docs.size) docs = new Set([...z.keys()].filter((k) => /\.x?html?$/i.test(k)));
  const files = { mimetype: [strToU8('application/epub+zip'), { level: 0 }] };
  let changed = 0;
  for (const [k, v] of z) {
    if (k === 'mimetype') continue;
    let data = v;
    if (docs.has(k)) { const d = xhtmlDoc(v); if (d && fn(d)) { data = new Uint8Array(xmlOut(d)); changed++; } }
    files[k] = data;
  }
  await fsp.writeFile(out, zipSync(files, { level: 6 }));
  return { changed, documents: docs.size };
}

// ───────── HTMLZ and TXTZ (calibre) ─────────
const metadataOpf = (b, title, lang) => `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uuid_id">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">\n<dc:title>${escT(title)}</dc:title>\n<dc:language>${escT(lang)}</dc:language>\n<dc:identifier id="uuid_id">urn:uuid:${crypto.randomUUID()}</dc:identifier>\n${(b.authors || []).map((a) => `<dc:creator opf:role="aut">${escT(a)}</dc:creator>\n`).join('')}${b.publisher ? `<dc:publisher>${escT(b.publisher)}</dc:publisher>\n` : ''}${b.description ? `<dc:description>${escT(b.description)}</dc:description>\n` : ''}</metadata>\n</package>\n`;
async function writeZipped(book, to, out) {
  const { zipSync, strToU8 } = require('fflate');
  const doc = parse(book.html), imgs = new Images(book.base), links = new Map();
  const nodes = [];
  walk(doc.root, (k) => { if (k.tag === 'img' && k.attrs.src) nodes.push(k); });
  for (const k of nodes) { const it = await imgs.add(k.attrs.src); if (it) links.set(k.attrs.src, `images/img${pad(it.n)}.${it.ext}`); }
  const title = book.title || doc.title || book.name, lang = book.language || doc.lang || guessLang(textOf(doc.root));
  const files = {};
  if (to === 'htmlz') {
    for (const k of nodes) { if (links.has(k.attrs.src)) k.attrs.src = links.get(k.attrs.src); else k.tag = 'span'; }
    files['index.html'] = strToU8(`<!DOCTYPE html>\n<html lang="${escA(lang)}">\n<head>\n<meta charset="utf-8"/>\n<title>${escT(title)}</title>\n<link rel="stylesheet" type="text/css" href="style.css"/>\n</head>\n<body>\n${toHtml(doc.root)}\n</body>\n</html>\n`);
    files['style.css'] = strToU8(CSS);
  } else files['index.txt'] = strToU8(office().htmlToMd(book.html, { image: (src) => links.get(src) || '' }));
  files['metadata.opf'] = strToU8(metadataOpf(book, title, lang));
  for (const m of imgs.list) files[`images/img${pad(m.n)}.${m.ext}`] = [new Uint8Array(m.data), { level: 0 }];
  await fsp.writeFile(out, zipSync(files, { level: 6 }));
  return out;
}
async function readZipped(file) {
  const kind = U.ext(file);
  const z = unzip(await fsp.readFile(file), `This is not a valid ${kind.toUpperCase()} file (it is not a ZIP archive).`);
  const exts = kind === 'htmlz' ? /\.(x?html?)$/i : /\.(txt|md|markdown|text)$/i;
  const main = (kind === 'htmlz' ? zget(z, 'index.html') && 'index.html' : zget(z, 'index.txt') && 'index.txt') || [...z.keys()].filter((k) => exts.test(k)).sort((a, b) => a.split('/').length - b.split('/').length || a.toLowerCase().localeCompare(b.toLowerCase()))[0];
  if (!main) throw new Error(`The ${kind.toUpperCase()} file contains no ${kind === 'htmlz' ? 'HTML page' : 'text file'}.`);
  let meta = {};
  const opf = [...z.keys()].find((k) => /\.opf$/i.test(k));
  if (opf) { try { meta = readOpf(z, opf).meta; } catch (_) {} }
  const ch = { path: main };
  if (kind === 'txtz') ch.html = require('marked').marked.parse(decodeText(zget(z, main)), { gfm: true });
  const r = readChapters([ch], z);
  return { ...meta, title: meta.title || r.title, html: r.html };
}

// ───────── comics ─────────
const PICTURES = /\.(jpe?g|jpe|jfif|png|gif|webp|bmp|avif|jxl|tiff?|heic|heif)$/i;
const isDigit = (c) => c >= '0' && c <= '9';
function naturalCompare(x, y) {
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (isDigit(x[i]) && isDigit(y[j])) {
      const si = i, sj = j;
      while (i < x.length && isDigit(x[i])) i++;
      while (j < y.length && isDigit(y[j])) j++;
      const a = x.slice(si, i).replace(/^0+/, ''), b = y.slice(sj, j).replace(/^0+/, '');
      if (a.length !== b.length) return a.length - b.length;
      if (a !== b) return a < b ? -1 : 1;
      continue;
    }
    const ca = x[i].toLowerCase(), cb = y[j].toLowerCase();
    if (ca !== cb) return ca < cb ? -1 : 1;
    i++; j++;
  }
  return (x.length - i) - (y.length - j);
}
// Pages of a comic archive in reading order: [{ name, data }] (7-Zip opens CBZ, CBR, CB7, CBT and CBC).
async function comicPages(file, ctx, depth = 0) {
  const arc = require('./archive');
  let items;
  try { items = await arc.list(file); } catch (e) { throw new Error(/password/i.test(e.message) ? 'The comic archive is password-protected.' : 'The comic archive can’t be opened (it’s damaged, or not the format its extension says).'); }
  if (items.some((i) => i.encrypted)) throw new Error('The comic archive is password-protected.');
  const tmp = await U.tmpDir('comic');
  try {
    await U.run(U.binPath('7z'), ['x', file, `-o${tmp}`, '-y', '-bso0', '-bsp0', '-p'], { signal: ctx?.signal }).catch(() => { throw new Error('The comic archive can’t be opened (it’s damaged, or not the format its extension says).'); });
    const keep = (k) => !/__macosx/i.test(k) && !k.split(/[\\/]/).some((s) => s.startsWith('.'));
    const entries = items.filter((i) => !i.folder && keep(i.path)).map((i) => ({ key: i.path.replace(/\\/g, '/'), file: path.join(tmp, i.path) }));
    const read = (e) => fsp.readFile(e.file).catch(() => null);
    if (U.ext(file) === 'cbc' && depth === 0) {
      const list = entries.find((e) => /(^|\/)comics\.txt$/i.test(e.key));
      const order = list ? decodeText(await read(list) || Buffer.alloc(0)).split(/\r?\n/).map((l) => l.split(':')[0].trim().toLowerCase()).filter(Boolean) : [];
      const books = entries.filter((e) => /\.cbz$/i.test(e.key)).sort((a, b) => naturalCompare(a.key, b.key));
      const rank = (e) => { const k = order.findIndex((o) => e.key.toLowerCase().endsWith(o)); return k < 0 ? Infinity : k; };
      books.sort((a, b) => rank(a) - rank(b));
      const pages = [];
      for (const b of books) pages.push(...await comicPages(b.file, ctx, 1));
      if (!pages.length) throw new Error('The comic contains no pictures.');
      return pages;
    }
    const pics = entries.filter((e) => PICTURES.test(e.key)).sort((a, b) => naturalCompare(a.key, b.key));
    if (!pics.length) throw new Error('The comic contains no pictures.');
    const pages = [];
    for (const e of pics) { const data = await read(e); if (data) pages.push({ name: e.key, data }); }
    return pages;
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}
async function pagesToPdf(pages, out, ctx) {
  const { PDFDocument } = require('pdf-lib');
  const sharp = require('sharp');
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages.length; i++) {
    ctx?.progress?.(0.3 + (0.6 * i) / pages.length, `Page ${i + 1} of ${pages.length}`);
    const c = await commonImage(pages[i].data, false);
    if (!c) continue;
    let meta;
    try { meta = await sharp(c.data).metadata(); } catch (_) { continue; }
    const dpi = meta.density >= 36 ? meta.density : 96, w = (meta.width / dpi) * 72, h = (meta.height / dpi) * 72;
    const img = c.ext === 'jpg' ? await doc.embedJpg(new Uint8Array(c.data)) : await doc.embedPng(new Uint8Array(c.data));
    doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  if (!doc.getPageCount()) throw new Error('The comic contains no readable pictures.');
  await fsp.writeFile(out, await doc.save());
  return out;
}
async function pagesToEpub(pages, title, out) {
  const sharp = require('sharp');
  const images = new Images(null), list = [];
  for (const p of pages) {
    const it = await images.add(p.data, !images.list.length);
    if (!it || list.some((x) => x.it === it)) continue;
    const m = await sharp(it.data).metadata().catch(() => null);
    if (m) list.push({ it, w: m.width, h: m.height });
  }
  if (!list.length) throw new Error('The comic contains no readable pictures.');
  const pagesX = list.map(({ it, w, h }, i) => ({ href: `p${pad(i + 1)}.xhtml`, content: page(title, `<div class="page"><img src="${it.href}" alt="" width="${w}" height="${h}"/></div>\n`, 'en', `<meta name="viewport" content="width=${w}, height=${h}"/>\n`) }));
  await fsp.writeFile(out, packageEpub({ title, lang: 'en', meta: {}, pages: pagesX, images: images.list, toc: [{ level: 1, text: title, target: pagesX[0].href }], css: 'body{margin:0;padding:0;}\n.page{margin:0;padding:0;}\nimg{display:block;margin:0;padding:0;}\n', fixed: true }));
  return out;
}
async function pagesToCbz(pages, out) {
  const { zipSync } = require('fflate');
  const files = {}, w = Math.max(3, String(pages.length).length);
  pages.forEach((p, i) => { files[`${String(i + 1).padStart(w, '0')}${path.extname(p.name).toLowerCase()}`] = [new Uint8Array(p.data), { level: 0 }]; });
  await fsp.writeFile(out, zipSync(files));
  return out;
}
async function convertComic(input, o, ctx) {
  ctx.progress?.(0.1, 'Opening the comic');
  const pages = await comicPages(input, ctx), name = U.base(input);
  if (o.to === 'pdf') return pagesToPdf(pages, ctx.out.file(input, `${name}.pdf`), ctx);
  if (o.to === 'epub') return pagesToEpub(pages, name, ctx.out.file(input, `${name}.epub`));
  if (o.to === 'cbz') return pagesToCbz(pages, ctx.out.file(input, `${name}${U.ext(input) === 'cbz' ? '-converted' : ''}.cbz`));
  if (o.to === 'images') {
    const dir = ctx.out.folder(input, `${name} - pages`), w = Math.max(3, String(pages.length).length);
    for (let i = 0; i < pages.length; i++) await fsp.writeFile(path.join(dir, `${String(i + 1).padStart(w, '0')}${path.extname(pages[i].name).toLowerCase()}`), pages[i].data);
    return dir;
  }
  throw new Error(`Lime can’t save comics as ${String(o.to).toUpperCase()}.`);
}
async function imagesToCbz(files, ctx) {
  const pages = [];
  for (const f of files) pages.push({ name: path.basename(f), data: await fsp.readFile(f) });
  return pagesToCbz(pages, ctx.out.file(files[0], files.length > 1 ? `${U.base(files[0])} and ${files.length - 1} more.cbz` : `${U.base(files[0])}.cbz`));
}

// ───────── reading and writing books ─────────
const nameOf = (f) => path.basename(f).replace(/(\.kepub)?\.[^.]+$/i, '');
const isKepub = (f) => /\.kepub(\.epub)?$/i.test(f);
async function readBook(input) {
  const e = U.ext(input);
  if (e === 'epub' || e === 'kepub') return readEpub(input);
  if (e === 'fb2') return readFb2(input);
  if (e === 'htmlz' || e === 'txtz') return readZipped(input);
  if (['mobi', 'azw', 'azw3', 'azw4', 'prc', 'pdb'].includes(e)) return require('./mobi').readMobi(input);
  throw new Error(`Lime can’t read ${e.toUpperCase()} books.`);
}
// One self-contained page with the book's text, used for HTML, PDF and the office writers.
const bookPage = (book, extra = '') => `<!DOCTYPE html>\n<html lang="${escA(book.language || 'en')}">\n<head>\n<meta charset="utf-8"/>\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"/>\n<title>${escT(book.title || '')}</title>\n<style>\n${CSS}section.chapter{break-before:page;}section.chapter:first-child{break-before:auto;}${extra}</style>\n</head>\n<body>\n${book.html}\n</body>\n</html>\n`;
async function writeBook(book, to, input, ctx) {
  const name = nameOf(input);
  book.name ??= name;
  book.title ||= name;
  const out = ctx.out.file(input, `${name}.${to === 'kepub' ? 'kepub.epub' : to}`);
  ctx.progress?.(0.6, `Writing ${to.toUpperCase()}`);
  switch (to) {
    case 'epub': return writeEpub(book.html, book, out);
    case 'fb2': return writeFb2(book, out);
    case 'html': await fsp.writeFile(out, bookPage(book, 'body{max-width:42em;margin:2em auto;}')); return out;
    case 'txt': await fsp.writeFile(out, office().htmlToText(book.html)); return out;
    case 'md': { const r = await markdown(book.html, out, book.base); await fsp.writeFile(out, r.md); return r.folder ? [out, r.folder] : out; }
    case 'docx': return office().htmlToDocx(book.html, book.title, out);
    case 'rtf': await fsp.writeFile(out, office().htmlToRtf(book.html)); return out;
    case 'pdf': return office().htmlToPdf(bookPage(book, 'body{margin:0;}'), out, ctx, { offline: true });
    case 'htmlz': case 'txtz': return writeZipped(book, to, out);
    case 'kepub': {
      const tmp = path.join(await U.tmpDir('kepub'), 'book.epub');
      try { await writeEpub(book.html, book, tmp); await rewriteEpub(tmp, out, addSpans); } finally { fsp.rm(path.dirname(tmp), { recursive: true, force: true }).catch(() => {}); }
      return out;
    }
    default: throw new Error(`Lime can’t save books as ${to.toUpperCase()}.`);
  }
}
async function convert(input, o, ctx) {
  const e = U.ext(input), name = nameOf(input);
  if (e === 'azw4') {
    if (o.to !== 'pdf') throw new Error('Print Replica (AZW4) books convert to PDF only.');
    const out = ctx.out.file(input, `${name}.pdf`);
    await fsp.writeFile(out, await require('./mobi').printReplica(input));
    return out;
  }
  if (e === 'epub' && o.to === 'kepub') { const out = ctx.out.file(input, `${name}.kepub.epub`); const r = await rewriteEpub(input, out, addSpans); return r.changed ? out : { path: out, note: 'The book was already a Kobo book; it was copied unchanged.' }; }
  if (isKepub(input) && o.to === 'epub') { const out = ctx.out.file(input, `${name}.epub`); await rewriteEpub(input, out, removeSpans); return out; }
  ctx.progress?.(0.15, 'Reading the book');
  return writeBook(await readBook(input), o.to, input, ctx);
}

module.exports = { convertComic, imagesToCbz, comicPages, naturalCompare, sentences, addSpans, removeSpans, rewriteEpub, xhtmlDoc, attrsOf, convert, readBook, writeBook, readEpub, writeEpub, readFb2, writeFb2, markdown, parse, toHtml, flow, commonImage, sniff, decodeText, xml, unzip, checkEpubDrm, guessLang, dataUri, fromDataUri, readChapters, packageEpub, page, Images, DRM, CSS, escT, escA, nameOf };
