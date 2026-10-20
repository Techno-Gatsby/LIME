'use strict';
// MOBI, AZW, AZW3, PRC and AZW4 books (PalmDB records): MOBI 6 HTML with filepos links and recindex pictures, KF8
// parts assembled from the skeleton and fragment indexes with kindle:pos/embed/flow references, PalmDOC and HUFF/CDIC
// text, plain PalmDOC (TEXtREAd) books, and the PDF inside Print Replica. Books with DRM are refused.
const { fsp } = require('./util');
const E = () => require('./ebook');

const u16 = (b, o) => (o >= 0 && o + 2 <= b.length ? b.readUInt16BE(o) : 0);
const u32 = (b, o) => { if (o < 0 || o + 4 > b.length) return -1; const v = b.readUInt32BE(o); return v === 0xffffffff ? -1 : v; };
function open(buf) {
  const head = buf.toString('latin1', 0, 8);
  if (head.startsWith('CONT') || (buf[0] === 0xea && head.slice(1, 7) === 'DRMION')) throw new Error('This is a KFX book (Kindle’s newest format), which can’t be converted. Download it from Amazon as an AZW3 or MOBI file (“Download & transfer via USB”).');
  if (head.startsWith('TPZ')) throw new Error('This is a Topaz book, which can’t be converted.');
  if (buf.length < 78) throw new Error('The file is too short to be an e-book.');
  const n = buf.readUInt16BE(76);
  if (!n || 78 + n * 8 > buf.length) throw new Error('The e-book’s record table is damaged.');
  const offs = [];
  for (let i = 0; i < n; i++) { const o = buf.readUInt32BE(78 + i * 8); if (o > buf.length || (i && o < offs[i - 1])) throw new Error('The e-book’s record table is damaged.'); offs.push(o); }
  const type = buf.toString('latin1', 60, 68);
  if (type !== 'BOOKMOBI' && type !== 'TEXtREAd') throw new Error(`This is not a Mobipocket or Kindle book (type “${type.replace(/[^\x20-\x7e]/g, '?')}”).`);
  return { name: buf.toString('latin1', 0, 32).replace(/\0.*$/s, ''), type, count: n, rec: (i) => (i < 0 || i >= n ? Buffer.alloc(0) : buf.subarray(offs[i], i + 1 < n ? offs[i + 1] : buf.length)) };
}
function palmdoc(inp) {
  const out = Buffer.alloc(Math.max(16, inp.length * 8));
  let n = 0;
  for (let i = 0; i < inp.length;) {
    const c = inp[i++];
    if (c >= 1 && c <= 8) { for (let k = 0; k < c && i < inp.length; k++) out[n++] = inp[i++]; }
    else if (c < 0x80) out[n++] = c;
    else if (c >= 0xc0) { out[n++] = 0x20; out[n++] = c ^ 0x80; }
    else if (i < inp.length) {
      const pair = (c << 8) | inp[i++], dist = (pair >> 3) & 0x7ff, len = (pair & 7) + 3;
      if (!dist || dist > n) continue;
      for (let k = 0; k < len; k++, n++) out[n] = out[n - dist];
    }
  }
  return out.subarray(0, n);
}
function huffCdic(huff, cdics) {
  if (huff.length < 24 || huff.toString('latin1', 0, 4) !== 'HUFF') throw new Error('The book’s HUFF compression table is damaged.');
  const t1 = huff.readUInt32BE(8), t2 = huff.readUInt32BE(12);
  if (t1 + 1024 > huff.length || t2 + 256 > huff.length) throw new Error('The book’s HUFF compression table is damaged.');
  const table = [], minCode = [], maxCode = [], phrases = [];
  for (let i = 0; i < 256; i++) {
    const v = huff.readUInt32BE(t1 + i * 4), len = v & 0x1f;
    if (!len) throw new Error('The book’s HUFF compression table is damaged.');
    table.push([len, !!(v & 0x80), ((v >>> 8) + 1) * 2 ** (32 - len) - 1]);
  }
  for (let len = 1; len <= 32; len++) { minCode[len] = huff.readUInt32BE(t2 + (len - 1) * 8) * 2 ** (32 - len); maxCode[len] = (huff.readUInt32BE(t2 + (len - 1) * 8 + 4) + 1) * 2 ** (32 - len) - 1; }
  for (const c of cdics) {
    if (c.length < 16 || c.toString('latin1', 0, 4) !== 'CDIC') throw new Error('The book’s CDIC dictionary is damaged.');
    const total = c.readUInt32BE(8), bits = c.readUInt32BE(12), n = Math.min(2 ** Math.min(Math.max(bits, 0), 20), total - phrases.length);
    for (let i = 0; i < n; i++) {
      const off = 16 + u16(c, 16 + i * 2), h = u16(c, off), len = Math.min(h & 0x7fff, Math.max(0, c.length - off - 2));
      phrases.push({ data: c.subarray(off + 2, off + 2 + len), done: !!(h & 0x8000), busy: false });
    }
  }
  const unpack = (data, out, depth) => {
    if (depth > 32) throw new Error('The book’s CDIC dictionary refers to itself.');
    const buf = Buffer.alloc(data.length + 8);
    data.copy(buf);
    let bit = 0, left = data.length * 8;
    for (;;) {
      const b = bit >>> 3, s = bit & 7, hi = buf.readUInt32BE(b);
      const code = s ? (((hi << s) | (buf[b + 4] >>> (8 - s))) >>> 0) : hi;
      let [len, term, max] = table[code >>> 24];
      if (!term) { while (len < 32 && code < minCode[len]) len++; max = maxCode[len]; }
      bit += len;
      left -= len;
      if (left < 0) break;
      const k = Math.floor((max - code) / 2 ** (32 - len));
      if (k < 0 || k >= phrases.length) throw new Error('The book’s compressed text is damaged.');
      const ph = phrases[k];
      if (!ph.done) {
        if (ph.busy) throw new Error('The book’s CDIC dictionary refers to itself.');
        ph.busy = true;
        const tmp = [];
        unpack(ph.data, tmp, depth + 1);
        ph.data = Buffer.concat(tmp);
        ph.done = true;
        ph.busy = false;
      }
      out.push(ph.data);
    }
  };
  return (data) => { const out = []; unpack(data, out, 0); return Buffer.concat(out); };
}
function trailing(rec, flags) {
  let size = 0;
  for (let bits = flags >> 1; bits; bits >>= 1) {
    if (!(bits & 1)) continue;
    let v = 0, shift = 0;
    for (let p = rec.length - size - 1; p >= 0; p--) { const b = rec[p]; v |= (b & 0x7f) << shift; shift += 7; if (b & 0x80 || shift >= 28 || p === 0) break; }
    size += v;
  }
  if (flags & 1 && rec.length - size - 1 >= 0) size += (rec[rec.length - size - 1] & 3) + 1;
  return Math.min(Math.max(size, 0), rec.length);
}
const LOCALE = { 0x04: 'zh', 0x07: 'de', 0x09: 'en', 0x0a: 'es', 0x0c: 'fr', 0x10: 'it', 0x11: 'ja', 0x12: 'ko', 0x13: 'nl', 0x16: 'pt', 0x19: 'ru' };
const cpLabel = (cp) => (cp === 65001 ? 'utf-8' : cp > 0 ? `windows-${cp}` : 'windows-1252');
const dec = (b, cp) => { try { return new TextDecoder(cpLabel(cp)).decode(b); } catch (_) { return new TextDecoder('windows-1252').decode(b); } };
function header(db, i) {
  const d = db.rec(i);
  if (d.length < 16) throw new Error('The book’s header is damaged.');
  const mobi = d.length >= 24 && d.toString('latin1', 16, 20) === 'MOBI', len = mobi ? u32(d, 20) : 0;
  const h = { compression: u16(d, 0), textLength: u32(d, 4), textRecords: u16(d, 8), encryption: u16(d, 12), codepage: mobi ? u32(d, 28) : 1252, version: mobi ? u32(d, 36) : 0, firstImage: mobi ? u32(d, 108) : -1, huff: mobi ? Math.max(0, u32(d, 112)) : 0, huffCount: mobi ? Math.max(0, u32(d, 116)) : 0, extra: mobi && len >= 0xe4 ? u16(d, 0xf2) : 0, fdst: -1, frag: -1, skel: -1, exth: new Map() };
  h.strings = () => [];
  if (!mobi) return h;
  if (h.version >= 8) { h.fdst = len >= 0xe4 ? u32(d, 0xc0) : -1; h.frag = len >= 0xe8 ? u32(d, 0xf8) : -1; h.skel = len >= 0xec ? u32(d, 0xfc) : -1; }
  const no = u32(d, 84), nl = u32(d, 88);
  h.locale = Math.max(0, u32(d, 92));
  if (no > 0 && nl > 0 && no + nl <= d.length) h.fullName = dec(d.subarray(no, no + nl), h.codepage);
  const x = 16 + len;
  if (u32(d, 128) & 0x40 && x + 12 <= d.length && d.toString('latin1', x, x + 4) === 'EXTH') {
    let p = x + 12;
    for (let k = 0, n = u32(d, x + 8); k < n && p + 8 <= d.length; k++) {
      const t = u32(d, p), sz = u32(d, p + 4);
      if (sz < 8 || p + sz > d.length) break;
      if (!h.exth.has(t)) h.exth.set(t, []);
      h.exth.get(t).push(d.subarray(p + 8, p + sz));
      p += sz;
    }
  }
  const num = (t) => { const v = h.exth.get(t)?.[0]; return v?.length === 4 && v.readUInt32BE(0) !== 0xffffffff ? v.readUInt32BE(0) : null; };
  h.kf8 = num(121) > 0 ? num(121) : null;
  h.cover = num(201);
  h.strings = (t) => (h.exth.get(t) || []).map((v) => dec(v, h.codepage).replace(/^[\0 ]+|[\0 ]+$/g, '')).filter(Boolean);
  return h;
}
function text(db, h, start) {
  const fn = h.compression === 1 ? (b) => b : h.compression === 2 ? palmdoc : h.compression === 17480 ? huffCdic(db.rec(start + h.huff), Array.from({ length: Math.max(0, h.huffCount - 1) }, (_, k) => db.rec(start + h.huff + 1 + k))) : null;
  if (!fn) throw new Error(`The book uses an unknown compression (${h.compression}).`);
  const parts = [];
  for (let i = 1; i <= h.textRecords; i++) { const r = db.rec(start + i); parts.push(fn(r.subarray(0, Math.max(0, r.length - trailing(r, h.extra))))); }
  const all = Buffer.concat(parts);
  return h.textLength > 0 && h.textLength < all.length ? all.subarray(0, h.textLength) : all;
}
function picture(db, first, i) {
  if (first < 0 || i < 0) return null;
  const r = db.rec(first + i), s = E().sniff(r);
  return s && s !== 'svg' && s !== 'webp' ? { data: r, ext: s === 'jpeg' ? 'jpg' : s, mime: `image/${s}` } : null;
}
function fvar(b, o) { let v = 0, n = 0; while (o + n < b.length && n < 9) { const x = b[o + n++]; v = v * 128 + (x & 0x7f); if (x & 0x80) break; } return [v, Math.max(1, n)]; }
function indx(db, first, strings) {
  const p = db.rec(first);
  if (p.length < 56 || p.toString('latin1', 0, 4) !== 'INDX') throw new Error('The book’s index is damaged.');
  const hl = u32(p, 4), records = u32(p, 24), cncx = Math.max(0, u32(p, 52));
  if (hl < 0 || hl + 12 > p.length || p.toString('latin1', hl, hl + 4) !== 'TAGX') throw new Error('The book’s index has no tag table.');
  const tl = u32(p, hl + 4), cbytes = u32(p, hl + 8), tags = [];
  for (let i = 12; i + 4 <= tl && hl + i + 4 <= p.length; i += 4) { const q = hl + i; tags.push({ tag: p[q], per: p[q + 1], mask: p[q + 2], end: p[q + 3] === 1 }); }
  for (let c = 0; c < cncx; c++) {
    const r = db.rec(first + records + 1 + c);
    for (let o = 0; o < r.length && r[o] !== 0;) { const s = o, [len, k] = fvar(r, o); o += k; const l = Math.min(len, r.length - o); strings.set(c * 0x10000 + s, r.toString('utf8', o, o + l)); o += l; }
  }
  const entries = [];
  for (let k = 1; k <= records; k++) {
    const r = db.rec(first + k);
    if (r.length < 28 || r.toString('latin1', 0, 4) !== 'INDX') continue;
    const idxt = u32(r, 20), count = u32(r, 24);
    if (idxt < 0 || idxt + 4 + count * 2 > r.length) continue;
    const offs = Array.from({ length: count }, (_, i) => u16(r, idxt + 4 + i * 2)).concat(idxt);
    for (let i = 0; i < count; i++) {
      const s = offs[i];
      if (s >= r.length) continue;
      const kl = r[s], key = r.toString('latin1', s + 1, Math.min(s + 1 + kl, r.length)), start = s + 1 + kl, end = offs[i + 1];
      let ci = 0, pos = start + cbytes;
      const heads = [], vals = new Map();
      for (const t of tags) {
        if (t.end) { ci++; continue; }
        if (start + ci >= r.length) break;
        let v = r[start + ci] & t.mask;
        if (!v) continue;
        if (v === t.mask) { if ([...t.mask.toString(2)].filter((x) => x === '1').length > 1) { const [b, n] = fvar(r, pos); pos += n; heads.push({ tag: t.tag, bytes: b, per: t.per }); } else heads.push({ tag: t.tag, count: 1, per: t.per }); }
        else { let m = t.mask; while (!(m & 1)) { m >>= 1; v >>= 1; } heads.push({ tag: t.tag, count: v, per: t.per }); }
      }
      for (const hd of heads) {
        const list = [];
        if (hd.count != null) for (let j = 0; j < hd.count * hd.per && pos < end; j++) { const [v, n] = fvar(r, pos); pos += n; list.push(v); }
        else for (let read = 0; read < hd.bytes && pos < end;) { const [v, n] = fvar(r, pos); pos += n; read += n; list.push(v); }
        vals.set(hd.tag, list);
      }
      entries.push({ key, tag: (t, j = 0) => vals.get(t)?.[j] ?? -1 });
    }
  }
  return entries;
}
const b32 = (s) => [...s.toUpperCase()].reduce((v, c) => v * 32 + (c <= '9' ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 55), 0);
const part = (i) => `part${String(i).padStart(4, '0')}.xhtml`;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
function mobi6(db, h, files, img) {
  let s = text(db, h, 0).toString('latin1');
  const positions = [...new Set([...s.matchAll(/\bfilepos\s*=\s*['"]?0*(\d{1,12})['"]?/gi)].map((m) => Number(m[1])).filter((p) => p <= s.length))].sort((a, b) => b - a);
  for (const p of positions) {
    let at = p;
    const o = at > 0 ? s.lastIndexOf('<', at - 1) : -1, c = at > 0 ? s.lastIndexOf('>', at - 1) : -1;
    if (o > c) at = o;
    s = `${s.slice(0, at)}<a id="filepos${p}"></a>${s.slice(at)}`;
  }
  s = s.replace(/\bfilepos\s*=\s*['"]?0*(\d{1,12})['"]?/gi, (m, n) => `href="#filepos${Number(n)}"`);
  s = s.replace(/\b(?:hi|lo)?recindex\s*=\s*['"]?(\d{1,9})['"]?/gi, (m, n) => `src="${img(Number(n) - 1) || ''}"`);
  files.set('book/book.html', Buffer.concat([BOM, Buffer.from(dec(Buffer.from(s, 'latin1'), h.codepage), 'utf8')]));
  return ['book/book.html'];
}
function kf8(db, h, start, files, img) {
  const t = text(db, h, start), flows = [];
  const fd = h.fdst >= 0 ? db.rec(start + h.fdst) : Buffer.alloc(0);
  if (fd.length >= 12 && fd.toString('latin1', 0, 4) === 'FDST') {
    const to = u32(fd, 4), n = u32(fd, 8);
    for (let i = 0; i < n; i++) { const a = Math.min(Math.max(u32(fd, to + i * 8), 0), t.length), b = Math.min(Math.max(u32(fd, to + i * 8 + 4), a), t.length); flows.push(t.subarray(a, b)); }
  }
  if (!flows.length) flows.push(t);
  const markup = flows[0], strings = new Map();
  const skels = h.skel >= 0 ? indx(db, start + h.skel, strings) : [], frags = h.frag >= 0 ? indx(db, start + h.frag, strings) : [];
  const parts = [];
  if (!skels.length) parts.push({ text: markup.toString('latin1'), start: 0 });
  let next = 0;
  for (const sk of skels) {
    const ss = Math.min(Math.max(sk.tag(6, 0), 0), markup.length), sl = Math.min(Math.max(sk.tag(6, 1), 0), markup.length - ss);
    let p = markup.toString('latin1', ss, ss + sl), pos = ss + sl;
    for (let i = 0; i < Math.max(0, sk.tag(1)) && next < frags.length; i++, next++) {
      const f = frags[next], len = Math.min(Math.max(f.tag(6, 1), 0), markup.length - pos), slice = markup.toString('latin1', pos, pos + len);
      pos += len;
      let ins = Math.min(Math.max((Number(f.key) || 0) - ss, 0), p.length);
      const before = p.slice(0, ins);
      if (before.lastIndexOf('<') > before.lastIndexOf('>')) {
        const aid = /@aid='([^']+)'/.exec(strings.get(f.tag(2)) || '')?.[1], at = aid ? p.indexOf(`aid="${aid}"`) : -1;
        const from = at >= 0 ? at : ins, e = p.indexOf('>', from);
        ins = e < 0 ? p.length : e + 1;
      }
      p = p.slice(0, ins) + slice + p.slice(ins);
    }
    parts.push({ text: p, start: ss });
  }
  const keys = frags.map((f) => Number(f.key) || 0), aids = new Set();
  const idBefore = (s, pos) => {
    pos = Math.min(Math.max(pos, 0), s.length);
    const o = s.indexOf('<', pos), c = s.indexOf('>', pos);
    if (c >= 0 && (o === pos || o < 0 || c < o)) pos = c + 1;
    for (let end = pos; end > 0;) {
      const te = s.lastIndexOf('>', end - 1);
      if (te < 0) break;
      const ts = s.lastIndexOf('<', te);
      if (ts < 0) break;
      const tag = s.slice(ts, te + 1);
      end = ts;
      if (/^<body/i.test(tag)) return '';
      if (/^<meta/i.test(tag)) continue;
      const id = /^<[^>]*\s(?:id|name)\s*=\s*['"]([^'"]*)['"]/i.exec(tag);
      if (id) return id[1];
      const aid = /^<[^>]+\said\s*=\s*['"]([^'"]+)['"]/i.exec(tag);
      if (aid) { aids.add(aid[1]); return `aid-${aid[1]}`; }
    }
    return '';
  };
  const flowName = (i, mime) => {
    if (i <= 0 || i >= flows.length) return 'missing';
    const name = `flow${String(i).padStart(4, '0')}.${/svg/i.test(mime) ? 'svg' : /css/i.test(mime) ? 'css' : 'txt'}`;
    files.set(`book/${name}`, flows[i]);
    return name;
  };
  const texts = parts.map((pt) => pt.text
    .replace(/kindle:pos:fid:([0-9A-Va-v]{4}):off:([0-9A-Va-v]{10})/g, (m, fid, off) => {
      const position = (keys[b32(fid)] ?? 0) + b32(off), k = parts.findIndex((q) => position >= q.start && position < q.start + q.text.length);
      if (k < 0) return part(0);
      const id = idBefore(parts[k].text, position - parts[k].start);
      return id ? `${part(k)}#${id}` : part(k);
    })
    .replace(/kindle:embed:([0-9A-Va-v]{4})(?:\?mime=[^'")\s]*)?/g, (m, n) => img(b32(n) - 1) || 'missing')
    .replace(/kindle:flow:([0-9A-Va-v]{4})(?:\?mime=([^'")\s]*))?/g, (m, n, mime) => flowName(b32(n), mime || '')));
  return texts.map((x, i) => {
    const s = aids.size ? x.replace(/\said\s*=\s*['"]([^'"]+)['"]/g, (m, a) => (aids.has(a) ? `${m} id="aid-${a}"` : m)) : x;
    files.set(`book/${part(i)}`, Buffer.concat([BOM, Buffer.from(s, 'latin1')]));
    return `book/${part(i)}`;
  });
}
// Plain text into paragraphs: blank lines separate them, else every line is one; hard-wrapped text is rejoined.
function plainHtml(s) {
  const lines = s.replace(/\r\n?/g, '\n').split('\n'), blank = lines.some((l) => !l.trim()), paras = [];
  let cur = [];
  for (const l of lines) { if (!l.trim() || !blank) { if (cur.length) paras.push(cur); cur = []; if (!l.trim()) continue; } cur.push(l.trimEnd()); }
  if (cur.length) paras.push(cur);
  const multi = paras.filter((p) => p.length > 1).flatMap((p) => p.slice(0, -1)), wrapped = multi.length > 0 && multi.filter((l) => l.length >= 50 && l.length <= 100).length > multi.length * 0.7;
  const esc = E().escT;
  return paras.map((p) => `<p>${p.map((l, i) => esc(i && wrapped ? l.trimStart() : l)).join(wrapped ? ' ' : '<br/>')}</p>`).join('\n');
}
async function readMobi(file) {
  const buf = await fsp.readFile(file);
  const db = open(buf);
  if (db.type === 'TEXtREAd') {
    const r0 = db.rec(0), comp = u16(r0, 0), n = u16(r0, 8), parts = [];
    for (let i = 1; i <= n && i < db.count; i++) parts.push(comp === 2 ? palmdoc(db.rec(i)) : db.rec(i));
    const all = Buffer.concat(parts);
    let s;
    try { s = new TextDecoder('utf-8', { fatal: true }).decode(all); } catch (_) { s = new TextDecoder('windows-1252').decode(all); }
    return { title: db.name, authors: [], html: plainHtml(s) };
  }
  const h = header(db, 0);
  if (h.encryption) throw new Error(E().DRM);
  const start = h.version >= 8 ? 0 : h.kf8;
  const files = new Map(), saved = new Map();
  let k = null;
  if (start != null && start >= 0 && start < db.count) { k = start === 0 ? h : header(db, start); if (k.encryption) throw new Error(E().DRM); }
  const first = k && start !== 0 ? h.firstImage : (k || h).firstImage;
  const img = (i) => {
    if (saved.has(i)) return saved.get(i);
    const p = picture(db, first, i), name = p ? `image${String(i + 1).padStart(5, '0')}.${p.ext}` : null;
    if (p) files.set(`book/${name}`, p.data);
    saved.set(i, name);
    return name;
  };
  const list = (k ? kf8(db, k, start, files, img) : mobi6(db, h, files, img)).map((path) => ({ path }));
  const r = E().readChapters(list, files);
  const cover = h.cover != null ? picture(db, first, h.cover) : null;
  const authors = [];
  for (const a of h.strings(100)) for (const n of a.split('&').map((x) => x.trim()).filter(Boolean)) if (!authors.includes(n)) authors.push(n);
  return { title: h.strings(503)[0] || h.fullName || db.name.replace(/_/g, ' '), authors, publisher: h.strings(101)[0] || null, description: h.strings(103)[0] || null, language: h.strings(524)[0] || LOCALE[h.locale & 0xff] || null, cover: cover && { data: cover.data, mime: cover.mime }, html: r.html };
}
async function printReplica(file) {
  const db = open(await fsp.readFile(file)), h = header(db, 0);
  if (h.encryption) throw new Error(E().DRM);
  const t = text(db, h, 0);
  if (t.toString('latin1', 0, 4) === '%MOP' && t.length >= 12) {
    const at = 8 + 4 * Math.min(t.readUInt32BE(4), 1000), off = u32(t, at), len = u32(t, at + 4);
    if (off > 0 && len > 0 && off + len <= t.length) return t.subarray(off, off + len);
  }
  const p = t.indexOf('%PDF-');
  if (p < 0) throw new Error('This isn’t a Print Replica (AZW4) book: it contains no PDF.');
  return t.subarray(p);
}

module.exports = { readMobi, printReplica, palmdoc, huffCdic, trailing, plainHtml };
