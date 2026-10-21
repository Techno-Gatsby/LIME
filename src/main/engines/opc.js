'use strict';
// Word, Excel and PowerPoint files (Open Packaging Conventions) and OpenDocument files as the zip of parts they are:
// read part by part, changed in place, and written back with everything Lime didn't touch kept byte for byte.
const U = require('./util');
const { fsp, path } = U;
const { unzipSync, zipSync, strToU8, strFromU8 } = require('fflate');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  x: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  cp: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  dc: 'http://purl.org/dc/elements/1.1/',
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  presentation: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
  manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  config: 'urn:oasis:names:tc:opendocument:xmlns:config:1.0',
};
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

function parse(s, what = 'part') {
  return new DOMParser({ errorHandler: { warning() {}, error() {}, fatalError(e) { throw new Error(`The file’s ${what} is damaged (${String(e).split('\n')[0]}).`); } } }).parseFromString(s, 'text/xml');
}
const serialize = (d) => new XMLSerializer().serializeToString(d);

// Small DOM helpers. Names are matched by namespace and local name, so prefixes don't matter.
const ELEMENT = 1, TEXT = 3;
const is = (n, ns, name) => !!n && n.nodeType === ELEMENT && n.namespaceURI === ns && (!name || n.localName === name || (Array.isArray(name) && name.includes(n.localName)));
const all = (root, ns, name) => Array.from(root.getElementsByTagNameNS(ns, name));
const kids = (n, ns, name) => Array.from(n.childNodes).filter((c) => c.nodeType === ELEMENT && (!ns || is(c, ns, name)));
const child = (n, ns, name) => kids(n, ns, name)[0] || null;
const up = (n, ns, name) => { for (let p = n.parentNode; p && p.nodeType === ELEMENT; p = p.parentNode) if (is(p, ns, name)) return p; return null; };
const remove = (n) => n?.parentNode?.removeChild(n);
function unwrap(n) { const p = n.parentNode; while (n.firstChild) p.insertBefore(n.firstChild, n); p.removeChild(n); }
function rename(n, qname, ns = n.namespaceURI) {
  const m = n.ownerDocument.createElementNS(ns, qname);
  for (const a of Array.from(n.attributes)) m.setAttributeNS(a.namespaceURI, a.name, a.value);
  while (n.firstChild) m.appendChild(n.firstChild);
  n.parentNode.replaceChild(m, n);
  return m;
}
const make = (doc, ns, qname, attrs = {}, ...children) => {
  const e = doc.createElementNS(ns, qname);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttributeNS(k.startsWith('xml:') ? 'http://www.w3.org/XML/1998/namespace' : k.includes(':') ? NS[k.split(':')[0]] || ns : null, k, String(v));
  for (const c of children) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
  return e;
};
const attr = (n, ns, name) => (n?.getAttributeNS(ns, name) ?? n?.getAttribute?.(name)) || '';
const after = (ref, n) => ref.parentNode.insertBefore(n, ref.nextSibling);
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const posix = path.posix;
const relsOf = (part) => (part ? `${posix.dirname(part) === '.' ? '' : `${posix.dirname(part)}/`}_rels/${posix.basename(part)}.rels` : '_rels/.rels');
const ownerOf = (rels) => (rels === '_rels/.rels' ? '' : rels.replace(/(^|\/)_rels\/([^/]+)\.rels$/, '$1$2'));
function resolve(from, target) {
  let t = target;
  try { t = decodeURIComponent(t); } catch (_) {}
  if (t.startsWith('/')) return t.slice(1);
  const dir = from ? posix.dirname(from) : '';
  return posix.normalize(posix.join(dir === '.' ? '' : dir, t)).replace(/^\/+/, '');
}
const relative = (from, to) => { const dir = from ? posix.dirname(from) : ''; return posix.relative(dir === '.' ? '' : dir, to) || posix.basename(to); };

class Package {
  constructor(files, name = 'file') {
    this.files = files;
    this.name = name;
    this.doms = new Map();
    this.odf = !files['[Content_Types].xml'] && !!files['content.xml'];
  }
  static async open(file) {
    let z;
    try { z = unzipSync(new Uint8Array(await fsp.readFile(file))); } catch (_) { throw new Error(`${path.basename(file)} isn’t a Word, Excel, PowerPoint or OpenDocument file Lime can open.`); }
    const p = new Package(z, path.basename(file));
    if (!p.odf && !z['[Content_Types].xml']) throw new Error(`${path.basename(file)} isn’t a Word, Excel, PowerPoint or OpenDocument file.`);
    return p;
  }
  clone() { const c = new Package({ ...this.files }, this.name); for (const [k, d] of this.doms) c.files[k] = strToU8(serialize(d)); return c; }
  has(n) { return !!this.files[n] || this.doms.has(n); }
  list(re) { return [...new Set([...Object.keys(this.files), ...this.doms.keys()])].filter((n) => !n.endsWith('/') && (!re || re.test(n))).sort(natural); }
  bytes(n) { if (this.doms.has(n)) return strToU8(serialize(this.doms.get(n))); return this.files[n]; }
  text(n) { if (this.doms.has(n)) return serialize(this.doms.get(n)); return this.files[n] ? strFromU8(this.files[n]) : ''; }
  dom(n) {
    if (!this.doms.has(n)) { if (!this.files[n]) return null; this.doms.set(n, parse(strFromU8(this.files[n]), posix.basename(n))); }
    return this.doms.get(n);
  }
  set(n, data) { this.doms.delete(n); this.files[n] = typeof data === 'string' ? strToU8(data) : data; }
  remove(n) { this.doms.delete(n); delete this.files[n]; }
  rename(from, to) { if (this.doms.has(from)) { this.doms.set(to, this.doms.get(from)); this.doms.delete(from); } if (this.files[from]) { this.files[to] = this.files[from]; delete this.files[from]; } }

  // Relationships of a part ('' for the package itself), with absolute targets.
  rels(part) {
    const d = this.dom(relsOf(part));
    if (!d) return [];
    return all(d, NS.rel, 'Relationship').map((el) => {
      const external = /^external$/i.test(el.getAttribute('TargetMode') || ''), raw = el.getAttribute('Target') || '';
      return { id: el.getAttribute('Id'), type: (el.getAttribute('Type') || '').split('/').pop(), fullType: el.getAttribute('Type') || '', target: external ? raw : resolve(part, raw), external, el };
    });
  }
  rel(part, id) { return this.rels(part).find((r) => r.id === id) || null; }
  addRel(part, type, target, external = false) {
    const name = relsOf(part);
    if (!this.has(name)) this.set(name, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS.rel}"></Relationships>`);
    const d = this.dom(name), used = new Set(this.rels(part).map((r) => r.id));
    let n = used.size + 1;
    while (used.has(`rId${n}`)) n++;
    d.documentElement.appendChild(make(d, NS.rel, 'Relationship', { Id: `rId${n}`, Type: type.includes('/') ? type : REL + type, Target: external ? target : relative(part, target), ...(external ? { TargetMode: 'External' } : {}) }));
    return `rId${n}`;
  }
  removeRel(part, id) { const r = this.rel(part, id); if (r) remove(r.el); }
  main() { const r = this.rels('').find((x) => x.type === 'officeDocument' && !x.external); return r ? r.target : null; }

  // Content types: an override per part, or a default per extension.
  types() { return this.dom('[Content_Types].xml'); }
  typeOf(part) {
    const d = this.types();
    if (!d) return '';
    const o = all(d, NS.ct, 'Override').find((e) => (e.getAttribute('PartName') || '').replace(/^\//, '').toLowerCase() === part.toLowerCase());
    if (o) return o.getAttribute('ContentType');
    const ext = posix.extname(part).slice(1).toLowerCase(), df = all(d, NS.ct, 'Default').find((e) => (e.getAttribute('Extension') || '').toLowerCase() === ext);
    return df ? df.getAttribute('ContentType') : '';
  }
  setType(part, type) {
    const d = this.types();
    this.unsetType(part);
    d.documentElement.appendChild(make(d, NS.ct, 'Override', { PartName: `/${part}`, ContentType: type }));
  }
  unsetType(part) { const d = this.types(); for (const e of all(d, NS.ct, 'Override')) if ((e.getAttribute('PartName') || '').replace(/^\//, '').toLowerCase() === part.toLowerCase()) remove(e); }
  ensureDefault(ext, type) {
    const d = this.types();
    if (!all(d, NS.ct, 'Default').some((e) => (e.getAttribute('Extension') || '').toLowerCase() === ext.toLowerCase())) d.documentElement.insertBefore(make(d, NS.ct, 'Default', { Extension: ext, ContentType: type }), d.documentElement.firstChild);
  }
  // Drops every part no relationship leads to any more, with its content type override.
  prune() {
    if (this.odf) return [];
    const keep = new Set(['[Content_Types].xml']), queue = [''];
    while (queue.length) {
      const p = queue.shift();
      if (p) keep.add(p);
      if (this.has(relsOf(p))) keep.add(relsOf(p));
      for (const r of this.rels(p)) if (!r.external && !keep.has(r.target) && this.has(r.target)) { keep.add(r.target); queue.push(r.target); }
    }
    const gone = this.list().filter((n) => !keep.has(n));
    for (const n of gone) { this.remove(n); this.unsetType(n); }
    return gone;
  }
  async save(out) {
    // Content types for parts that aren't there (some writers leave them) go, so the package stays consistent.
    if (!this.odf && this.types()) for (const e of all(this.types(), NS.ct, 'Override')) if (!this.has((e.getAttribute('PartName') || '').replace(/^\//, ''))) remove(e);
    const files = {};
    if (this.odf && this.files.mimetype) files.mimetype = [this.files.mimetype, { level: 0 }];
    for (const n of this.list()) if (n !== 'mimetype' || !this.odf) files[n] = this.bytes(n);
    await fsp.writeFile(out, zipSync(files, { level: 6 }));
    return out;
  }
}
const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true });

// ODF manifest entries, for files added to or taken out of an OpenDocument package.
function manifestSet(pkg, name, type) {
  const d = pkg.dom('META-INF/manifest.xml');
  if (!d) return;
  for (const e of all(d, NS.manifest, 'file-entry')) if (attr(e, NS.manifest, 'full-path') === name) remove(e);
  if (type) d.documentElement.appendChild(make(d, NS.manifest, 'manifest:file-entry', { 'manifest:full-path': name, 'manifest:media-type': type }));
}

// What kind of document a package holds, from its main part or its OpenDocument mimetype.
function familyOf(pkg) {
  if (pkg.odf) {
    const m = strFromU8(pkg.files.mimetype || new Uint8Array()).trim();
    return /text/.test(m) ? 'word' : /spreadsheet/.test(m) ? 'excel' : /presentation/.test(m) ? 'powerpoint' : 'other';
  }
  const main = pkg.main() || '';
  return main.startsWith('word/') ? 'word' : main.startsWith('xl/') ? 'excel' : main.startsWith('ppt/') ? 'powerpoint' : 'other';
}

// ───────── Text across runs ─────────
// A paragraph's text sits in pieces (Word and PowerPoint runs, the text nodes between OpenDocument spans). Each
// segment reads and writes one piece; a match may start in one and end in another, and the replacement takes the
// formatting of the piece it starts in.
function segment(node) {
  if (node.nodeType === TEXT) return { node, get: () => node.data, set: (v) => { node.data = v; } };
  return {
    node,
    get: () => node.textContent || '',
    set: (v) => {
      while (node.firstChild) node.removeChild(node.firstChild);
      if (v) node.appendChild(node.ownerDocument.createTextNode(v));
      if (is(node, NS.w, 't')) { if (/^\s|\s$/.test(v)) node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); }
    },
  };
}
const ODF_PARA = ['p', 'h'];
// The paragraphs of a part with their text segments: w:p/w:t (Word), a:p/a:t (DrawingML), si/is with t (Excel strings)
// and text:p/text:h with their text nodes (OpenDocument). A text box's paragraphs are their own, not the outer one's.
function paragraphs(doc) {
  const out = [];
  const add = (paras, segsOf) => { for (const el of paras) out.push({ el, segs: segsOf(el).map(segment) }); };
  const own = (el, ns, name) => (t) => up(t, ns, name) === el;
  add(all(doc, NS.w, 'p'), (el) => all(el, NS.w, 't').filter(own(el, NS.w, 'p')).filter((t) => !up(t, NS.w, ['del', 'moveFrom'])));
  add(all(doc, NS.a, 'p'), (el) => all(el, NS.a, 't').filter(own(el, NS.a, 'p')));
  add([...all(doc, NS.x, 'si'), ...all(doc, NS.x, 'is')], (el) => all(el, NS.x, 't').filter((t) => !up(t, NS.x, 'rPh')));
  const odf = [...all(doc, NS.text, 'p'), ...all(doc, NS.text, 'h')];
  add(odf, (el) => {
    const t = [];
    const walk = (n) => { for (const c of Array.from(n.childNodes)) { if (c.nodeType === TEXT) t.push(c); else if (c.nodeType === ELEMENT && !is(c, NS.text, ODF_PARA) && !is(c, NS.office, 'annotation') && !is(c, NS.text, ['note', 'tracked-changes'])) walk(c); } };
    walk(el);
    return t;
  });
  return out;
}

// Replaces every match of `re` (global) across the segments; `rep` is a string with $1/$& or a function of the match.
function replaceAcross(segs, re, rep) {
  const texts = segs.map((s) => s.get()), starts = [];
  let acc = 0;
  for (const t of texts) { starts.push(acc); acc += t.length; }
  const full = texts.join('');
  const hits = [...full.matchAll(re)].filter((m) => m[0].length);
  if (!hits.length) return 0;
  const lens = texts.map((t) => t.length), at = (pos) => lens.findIndex((n, i) => pos >= starts[i] && pos < starts[i] + n);
  const changed = new Set();
  for (const m of hits.reverse()) {
    const a = m.index, b = a + m[0].length, value = typeof rep === 'function' ? rep(m) : expand(rep, m);
    const si = at(a), ei = at(b - 1);
    texts[si] = texts[si].slice(0, a - starts[si]) + value + (si === ei ? texts[si].slice(b - starts[si]) : '');
    for (let k = si + 1; k < ei; k++) texts[k] = '';
    if (ei > si) texts[ei] = texts[ei].slice(b - starts[ei]);
    for (let k = si; k <= ei; k++) changed.add(k);
  }
  for (const k of changed) segs[k].set(texts[k]);
  return hits.length;
}
const expand = (rep, m) => String(rep).replace(/\$(\$|&|\d{1,2})/g, (x, k) => (k === '$' ? '$' : k === '&' ? m[0] : m[Number(k)] ?? ''));
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The pattern Find and replace looks for: plain text unless asked for a regular expression, whole words optional.
function pattern(find, o = {}) {
  let src = o.regex ? String(find) : escRe(find);
  if (o.wholeWords) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try { return new RegExp(src, `gu${o.matchCase ? '' : 'i'}`); } catch (e) { throw new Error(`“${find}” isn’t a valid pattern: ${e.message.replace(/^.*: /, '')}`); }
}

module.exports = { NS, REL, expand, parse, serialize, is, all, kids, child, up, remove, unwrap, rename, make, attr, after, xmlEsc, relsOf, ownerOf, resolve, relative, Package, manifestSet, familyOf, paragraphs, segment, replaceAcross, pattern, escRe, natural, strToU8, strFromU8, ELEMENT, TEXT };
