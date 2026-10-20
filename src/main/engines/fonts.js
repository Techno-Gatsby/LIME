'use strict';
const U = require('./util');
const { fsp, path } = U;
const zlib = require('zlib');

// Lossless font container conversion (TTF, OTF, TTC, WOFF, WOFF2, EOT) with every table kept, and CFF → TrueType
// outlines for TTF and EOT. Big-endian throughout, except the EOT header.
const DAMAGED = 'The font file is truncated or damaged.';
const cancelled = () => Object.assign(new Error('Cancelled'), { cancelled: true });
class R {
  constructor(b, pos = 0, end = b.length) { this.b = b; this.pos = pos; this.end = Math.min(end, b.length); }
  need(n) { if (n < 0 || this.pos + n > this.end) throw new Error(DAMAGED); const p = this.pos; this.pos += n; return p; }
  u8() { return this.b[this.need(1)]; }
  u16() { return this.b.readUInt16BE(this.need(2)); }
  i16() { return this.b.readInt16BE(this.need(2)); }
  u32() { return this.b.readUInt32BE(this.need(4)); }
  i32() { return this.b.readInt32BE(this.need(4)); }
  bytes(n) { const p = this.need(n); return this.b.subarray(p, p + n); }
  skip(n) { this.need(n); }
  get left() { return this.end - this.pos; }
  u255() { const c = this.u8(); return c === 253 ? this.u16() : c === 254 ? this.u8() + 506 : c === 255 ? this.u8() + 253 : c; }
  ub128() {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.u8();
      if (i === 0 && b === 0x80) throw new Error('Invalid WOFF2 number (leading zeros).');
      if (v & 0xfe000000) throw new Error('Invalid WOFF2 number (overflow).');
      v = ((v << 7) | (b & 0x7f)) >>> 0;
      if (!(b & 0x80)) return v;
    }
    throw new Error('Invalid WOFF2 number (longer than five bytes).');
  }
}
class W {
  constructor(n = 1024) { this.b = Buffer.alloc(n); this.n = 0; }
  room(k) {
    if (this.n + k > this.b.length) { const nb = Buffer.alloc(Math.max(this.b.length * 2, this.n + k)); this.b.copy(nb, 0, 0, this.n); this.b = nb; }
    const p = this.n; this.n += k; return p;
  }
  u8(v) { const p = this.room(1); this.b[p] = v & 0xff; }
  u16(v) { const p = this.room(2); this.b.writeUInt16BE(v & 0xffff, p); }
  i16(v) { const p = this.room(2); this.b.writeInt16BE((((v | 0) + 32768) & 0xffff) - 32768, p); }
  u32(v) { const p = this.room(4); this.b.writeUInt32BE(v >>> 0, p); }
  bytes(d) { if (!d.length) return; const p = this.room(d.length); Buffer.from(d.buffer, d.byteOffset, d.length).copy(this.b, p); }
  pad4() { while (this.n % 4) this.u8(0); }
  u255(v) { if (v < 253) this.u8(v); else if (v < 506) { this.u8(255); this.u8(v - 253); } else if (v < 762) { this.u8(254); this.u8(v - 506); } else { this.u8(253); this.u16(v); } }
  ub128(v) { const g = []; do { g.unshift(v % 128); v = Math.floor(v / 128); } while (v); g.forEach((x, i) => this.u8(i < g.length - 1 ? x | 0x80 : x)); }
  get out() { return this.b.subarray(0, this.n); }
}

// ───────── SFNT ─────────
const TT = 0x00010000, OTTO = 0x4f54544f, TRUE = 0x74727565, TTCF = 0x74746366;
const tagName = (v) => String.fromCharCode(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const tagValue = (t) => ((t.charCodeAt(0) << 24) | (t.charCodeAt(1) << 16) | (t.charCodeAt(2) << 8) | t.charCodeAt(3)) >>> 0;
const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const pad4 = (n) => (n + 3) & ~3;
const lo = (a) => a.reduce((m, v) => Math.min(m, v), Infinity), hi = (a) => a.reduce((m, v) => Math.max(m, v), -Infinity);
function checksum(b) {
  let s = 0;
  const n = b.length & ~3;
  for (let i = 0; i < n; i += 4) s = (s + b.readUInt32BE(i)) >>> 0;
  if (n < b.length) { const t = Buffer.alloc(4); b.copy(t, 0, n); s = (s + t.readUInt32BE(0)) >>> 0; }
  return s;
}
const tableSum = (tag, d) => { if (tag !== 'head' || d.length < 12) return checksum(d); const c = Buffer.from(d); c.fill(0, 8, 12); return checksum(c); };
const clone = (f) => ({ flavor: f.flavor, tables: new Map(f.tables) });
const glyphCount = (f) => { const m = f.tables.get('maxp'); if (!m || m.length < 6) throw new Error('The font has no \'maxp\' table.'); return m.readUInt16BE(4); };
const need = (f, tag) => { const t = f.tables.get(tag); if (!t) throw new Error(`The font has no '${tag.trim()}' table.`); return t; };
const isSfnt = (b) => b.length >= 12 && [TT, OTTO, TRUE, TTCF].includes(b.readUInt32BE(0));
function readSfnt(b, off = 0) {
  const r = new R(b, off);
  const flavor = r.u32();
  if (flavor === TTCF) {
    if (off) throw new Error('Nested font collection.');
    r.skip(4);
    if (!r.u32()) throw new Error('The font collection is empty.');
    return readSfnt(b, r.u32());
  }
  if (![TT, OTTO, TRUE].includes(flavor)) throw new Error('This is not a TrueType or OpenType font.');
  const font = { flavor: flavor === TRUE ? TT : flavor, tables: new Map() };
  const n = r.u16();
  r.skip(6);
  for (let i = 0; i < n; i++) {
    const tag = tagName(r.u32());
    r.skip(4);
    const o = r.u32(), len = r.u32();
    if (o > b.length || len > b.length - o) throw new Error(`The font’s '${tag.trim()}' table lies outside the file.`);
    font.tables.set(tag, b.subarray(o, o + len));
  }
  return font;
}
const TT_ORDER = ['head', 'hhea', 'maxp', 'OS/2', 'hmtx', 'LTSH', 'VDMX', 'hdmx', 'cmap', 'fpgm', 'prep', 'cvt ', 'loca', 'glyf', 'kern', 'name', 'post', 'gasp', 'PCLT'];
const CFF_ORDER = ['head', 'hhea', 'maxp', 'OS/2', 'name', 'cmap', 'post', 'CFF '];
function writeSfnt(font) {
  const tags = [...font.tables.keys()].sort(ordinal);
  const order = font.flavor === OTTO ? CFF_ORDER : TT_ORDER;
  const rank = (t) => (t === 'DSIG' ? 1e9 : order.includes(t) ? order.indexOf(t) : order.length);
  const data = [...tags].sort((a, b) => rank(a) - rank(b) || ordinal(a, b));
  const offs = new Map();
  let pos = 12 + 16 * tags.length;
  for (const t of data) { offs.set(t, pos); pos += pad4(font.tables.get(t).length); }
  const out = Buffer.alloc(pos);
  const n = tags.length, sel = n ? Math.floor(Math.log2(n)) : 0, range = n ? (1 << sel) * 16 : 0;
  out.writeUInt32BE(font.flavor, 0);
  out.writeUInt16BE(n, 4);
  out.writeUInt16BE(range, 6);
  out.writeUInt16BE(sel, 8);
  out.writeUInt16BE(n * 16 - range, 10);
  tags.forEach((t, i) => {
    const d = font.tables.get(t), e = 12 + 16 * i;
    out.writeUInt32BE(tagValue(t), e);
    out.writeUInt32BE(tableSum(t, d), e + 4);
    out.writeUInt32BE(offs.get(t), e + 8);
    out.writeUInt32BE(d.length, e + 12);
    d.copy(out, offs.get(t));
  });
  if (font.tables.get('head')?.length >= 12) {
    const h = offs.get('head');
    out.fill(0, h + 8, h + 12);
    out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, h + 8);
  }
  return out;
}
function fontVersion(font) {
  const h = font.tables.get('head');
  if (!h || h.length < 8) return [0, 0];
  const rev = h.readInt32BE(4) / 65536, major = Math.floor(rev);
  return [U.clamp(major, 0, 0xffff), U.clamp(Math.round((rev - major) * 1000), 0, 0xffff)];
}

// ───────── WOFF 1.0 ─────────
const WOFF = 0x774f4646, WOFF2 = 0x774f4632;
function woffEncode(src) {
  const font = readSfnt(writeSfnt(src));
  const tags = [...font.tables.keys()].sort(ordinal);
  const packed = tags.map((t) => { const d = font.tables.get(t), z = zlib.deflateSync(d, { level: 9 }); return z.length < d.length ? z : d; });
  const w = new W(44 + 20 * tags.length + packed.reduce((s, p) => s + pad4(p.length), 0));
  w.u32(WOFF); w.u32(font.flavor); w.u32(0); w.u16(tags.length); w.u16(0);
  w.u32(12 + 16 * tags.length + tags.reduce((s, t) => s + pad4(font.tables.get(t).length), 0));
  const [major, minor] = fontVersion(font);
  w.u16(major); w.u16(minor);
  for (let i = 0; i < 5; i++) w.u32(0);
  let off = 44 + 20 * tags.length;
  tags.forEach((t, i) => { const d = font.tables.get(t); w.u32(tagValue(t)); w.u32(off); w.u32(packed[i].length); w.u32(d.length); w.u32(tableSum(t, d)); off += pad4(packed[i].length); });
  for (const p of packed) { w.bytes(p); w.pad4(); }
  w.b.writeUInt32BE(w.n, 8);
  return Buffer.from(w.out);
}
function woffDecode(b) {
  const r = new R(b);
  if (r.u32() !== WOFF) throw new Error('This is not a WOFF file.');
  let flavor = r.u32();
  if (![TT, OTTO, TRUE].includes(flavor)) throw new Error('The WOFF file contains an unknown kind of font.');
  if (flavor === TRUE) flavor = TT;
  r.skip(4);
  const n = r.u16();
  r.pos = 44;
  const font = { flavor, tables: new Map() };
  for (let i = 0; i < n; i++) {
    const tag = tagName(r.u32()), off = r.u32(), comp = r.u32(), orig = r.u32();
    r.skip(4);
    if (off > b.length || comp > b.length - off || comp > orig) throw new Error(`The WOFF table '${tag.trim()}' is damaged.`);
    const stored = b.subarray(off, off + comp);
    if (comp === orig) { font.tables.set(tag, stored); continue; }
    let d;
    try { d = zlib.inflateSync(stored, { maxOutputLength: Math.max(orig, 1) }); } catch (_) { throw new Error(`The WOFF table '${tag.trim()}' can’t be decompressed.`); }
    if (d.length !== orig) throw new Error(`The WOFF table '${tag.trim()}' can’t be decompressed.`);
    font.tables.set(tag, d);
  }
  return font;
}

// ───────── TrueType glyphs ─────────
const ARGS_WORDS = 0x1, HAS_SCALE = 0x8, MORE = 0x20, XY_SCALE = 0x40, TWO_BY_TWO = 0x80, HAS_INSTR = 0x100;
function skipComponents(r) {
  let instr = false, flags;
  do {
    flags = r.u16();
    r.skip(2);
    r.skip(flags & ARGS_WORDS ? 4 : 2);
    if (flags & HAS_SCALE) r.skip(2); else if (flags & XY_SCALE) r.skip(4); else if (flags & TWO_BY_TWO) r.skip(8);
    if (flags & HAS_INSTR) instr = true;
  } while (flags & MORE);
  return instr;
}
const compInstr = (g) => g.comps.length > 0 && skipComponents(new R(g.comps));
function parseGlyph(glyf, off, len) {
  if (!len) return null;
  const r = new R(glyf, off, off + len);
  const g = { n: r.i16(), xMin: r.i16(), yMin: r.i16(), xMax: r.i16(), yMax: r.i16(), ends: [], pts: [], ins: Buffer.alloc(0), comps: Buffer.alloc(0), overlap: false, cubic: false };
  if (g.n === -1) {
    const start = r.pos, instr = skipComponents(r);
    g.comps = glyf.subarray(start, r.pos);
    if (instr) g.ins = r.bytes(r.u16());
    return g;
  }
  if (g.n < -1) throw new Error('Invalid TrueType glyph (negative contour count).');
  for (let i = 0; i < g.n; i++) { g.ends.push(r.u16()); if (i && g.ends[i] <= g.ends[i - 1]) throw new Error('Invalid TrueType glyph (contour end points out of order).'); }
  g.ins = r.bytes(r.u16());
  const count = g.n ? g.ends[g.n - 1] + 1 : 0;
  const flags = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const f = r.u8();
    flags[i] = f;
    if (f & 8) for (let k = r.u8(); k > 0; k--) { if (++i >= count) throw new Error('Invalid TrueType glyph (too many point flags).'); flags[i] = f; }
  }
  const coords = (short, same) => { const v = new Array(count); let c = 0; for (let i = 0; i < count; i++) { const f = flags[i]; if (f & short) c += f & same ? r.u8() : -r.u8(); else if (!(f & same)) c += r.i16(); v[i] = c; } return v; };
  const xs = coords(2, 0x10), ys = coords(4, 0x20);
  for (let i = 0; i < count; i++) { g.pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) }); if (flags[i] & 0x80) g.cubic = true; }
  g.overlap = count > 0 && !!(flags[0] & 0x40);
  return g;
}
function bounds(g) {
  if (!g.pts.length) return [0, 0, 0, 0];
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of g.pts) { a = Math.min(a, p.x); b = Math.min(b, p.y); c = Math.max(c, p.x); d = Math.max(d, p.y); }
  return [a, b, c, d];
}
function serializeGlyph(g) {
  const w = new W(16 + g.pts.length * 5 + g.comps.length + g.ins.length);
  w.i16(g.n); w.i16(g.xMin); w.i16(g.yMin); w.i16(g.xMax); w.i16(g.yMax);
  if (g.n < 0) { w.bytes(g.comps); if (compInstr(g)) { w.u16(g.ins.length); w.bytes(g.ins); } return Buffer.from(w.out); }
  for (const e of g.ends) w.u16(e);
  w.u16(g.ins.length);
  w.bytes(g.ins);
  const flags = [], xs = new W(g.pts.length * 2), ys = new W(g.pts.length * 2);
  const delta = (out, d, short, same) => { if (d === 0) return same; if (d > -256 && d < 256) { out.u8(Math.abs(d)); return short | (d > 0 ? same : 0); } out.i16(d); return 0; };
  let lx = 0, ly = 0, last = -1, rep = 0;
  g.pts.forEach((p, i) => {
    let f = p.on ? 1 : 0;
    if (i === 0 && g.overlap) f |= 0x40;
    f |= delta(xs, p.x - lx, 2, 0x10);
    f |= delta(ys, p.y - ly, 4, 0x20);
    lx = p.x; ly = p.y;
    if (f === last && rep < 255) { if (!rep) flags[flags.length - 1] |= 8; rep++; } else { if (rep) flags.push(rep); flags.push(f); rep = 0; }
    last = f;
  });
  if (rep) flags.push(rep);
  w.bytes(Buffer.from(flags)); w.bytes(xs.out); w.bytes(ys.out);
  return Buffer.from(w.out);
}
const MAX_SHORT = 0xffff * 2;
function readLoca(loca, n, long, glyfLen) {
  const r = new R(loca), o = [];
  for (let i = 0; i <= n; i++) o.push(long ? r.u32() : r.u16() * 2);
  return Array.from({ length: n }, (_, i) => { const s = Math.min(o[i], glyfLen), e = Math.min(o[i + 1], glyfLen); return [s, Math.max(0, e - s)]; });
}
const locFormat = (head) => head.readInt16BE(50);
const withLocFormat = (head, long) => { const c = Buffer.from(head); c.writeInt16BE(long ? 1 : 0, 50); return c; };
function readGlyphs(font) {
  const glyf = need(font, 'glyf');
  return readLoca(need(font, 'loca'), glyphCount(font), locFormat(need(font, 'head')) !== 0, glyf.length).map(([o, l]) => parseGlyph(glyf, o, l));
}
function buildGlyf(glyphs, long, align = 4) {
  const al = (n) => Math.ceil(n / align) * align;
  const total = glyphs.reduce((s, g) => s + al(g.length), 0);
  long = long || total > MAX_SHORT;
  if (total > 0x7fffffff) throw new Error('The glyph outlines are too large for a TrueType font.');
  const glyf = Buffer.alloc(total), loca = new W((glyphs.length + 1) * (long ? 4 : 2));
  let off = 0;
  const entry = () => (long ? loca.u32(off) : loca.u16(off / 2));
  for (const g of glyphs) { entry(); g.copy(glyf, off); off += al(g.length); }
  entry();
  return { glyf, loca: Buffer.from(loca.out), long };
}

// ───────── WOFF 2.0 ─────────
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
const hasCff = (f) => f.tables.has('CFF ') && !f.tables.has('glyf');
function triplet(flags, data, on, dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy), o = on ? 0 : 128, xs = dx < 0 ? 0 : 1, ys = dy < 0 ? 0 : 1, signs = xs + 2 * ys;
  if (dx === 0 && ay < 1280) { flags.u8(o + ((ay & 0xf00) >> 7) + ys); data.u8(ay & 0xff); }
  else if (dy === 0 && ax < 1280) { flags.u8(o + 10 + ((ax & 0xf00) >> 7) + xs); data.u8(ax & 0xff); }
  else if (ax < 65 && ay < 65) { flags.u8(o + 20 + ((ax - 1) & 0x30) + (((ay - 1) & 0x30) >> 2) + signs); data.u8((((ax - 1) & 0xf) << 4) | ((ay - 1) & 0xf)); }
  else if (ax < 769 && ay < 769) { flags.u8(o + 84 + 12 * (((ax - 1) & 0x300) >> 8) + (((ay - 1) & 0x300) >> 6) + signs); data.u8((ax - 1) & 0xff); data.u8((ay - 1) & 0xff); }
  else if (ax < 4096 && ay < 4096) { flags.u8(o + 120 + signs); data.u8(ax >> 4); data.u8(((ax & 0xf) << 4) | (ay >> 8)); data.u8(ay & 0xff); }
  else { flags.u8(o + 124 + signs); data.u16(ax); data.u16(ay); }
}
function transformGlyf(font) {
  let glyphs;
  try { glyphs = readGlyphs(font); } catch (_) { return null; }
  if (glyphs.some((g) => g?.cubic)) return null;
  const n = glyphs.length;
  const nc = new W(n * 2), np = new W(n * 4), fl = new W(n * 32), gs = new W(n * 64), cs = new W(), bb = new W(), ins = new W();
  const bitmap = Buffer.alloc(4 * Math.ceil(n / 32)), overlap = Buffer.alloc(Math.ceil(n / 8));
  const xMins = new Array(n).fill(0);
  let hasOverlap = false, glyfLen = 0;
  const box = (g, i) => { bitmap[i >> 3] |= 0x80 >> (i & 7); bb.i16(g.xMin); bb.i16(g.yMin); bb.i16(g.xMax); bb.i16(g.yMax); };
  glyphs.forEach((g, i) => {
    if (!g || g.n === 0) { nc.i16(0); return; }
    xMins[i] = g.xMin;
    glyfLen += pad4(serializeGlyph(g).length);
    if (g.n < 0) {
      nc.i16(-1);
      cs.bytes(g.comps);
      if (compInstr(g)) { gs.u255(g.ins.length); ins.bytes(g.ins); }
      box(g, i);
      return;
    }
    nc.i16(g.n);
    let prev = -1;
    for (const e of g.ends) { np.u255(e - prev); prev = e; }
    let lx = 0, ly = 0;
    for (const p of g.pts) { triplet(fl, gs, p.on, p.x - lx, p.y - ly); lx = p.x; ly = p.y; }
    gs.u255(g.ins.length);
    ins.bytes(g.ins);
    const [a, b, c, d] = bounds(g);
    if (a !== g.xMin || b !== g.yMin || c !== g.xMax || d !== g.yMax) box(g, i);
    if (g.overlap) { overlap[i >> 3] |= 0x80 >> (i & 7); hasOverlap = true; }
  });
  const long = locFormat(need(font, 'head')) !== 0 || glyfLen > MAX_SHORT;
  const w = new W(64 + nc.n + np.n + fl.n + gs.n + cs.n + bitmap.length + bb.n + ins.n + overlap.length);
  w.u16(0); w.u16(hasOverlap ? 1 : 0); w.u16(n); w.u16(long ? 1 : 0);
  for (const s of [nc.n, np.n, fl.n, gs.n, cs.n, bitmap.length + bb.n, ins.n]) w.u32(s);
  for (const s of [nc.out, np.out, fl.out, gs.out, cs.out, bitmap, bb.out, ins.out]) w.bytes(s);
  if (hasOverlap) w.bytes(overlap);
  return { data: Buffer.from(w.out), glyfLen, locaLen: (n + 1) * (long ? 4 : 2), long, xMins };
}
const withSign = (f, v) => (f & 1 ? v : -v);
function reconstructGlyf(data, off, len) {
  const end = off + len, h = new R(data, off, end);
  h.u16();
  const opt = h.u16(), n = h.u16(), long = h.u16() !== 0;
  const sizes = Array.from({ length: 7 }, () => h.u32());
  let pos = h.pos;
  const next = (size) => { if (size > end - pos) throw new Error('The WOFF2 glyph data is damaged.'); const s = new R(data, pos, pos + size); pos += size; return s; };
  const [nc, np, fl, gs, cs, bs, ins] = sizes.map(next);
  const bitmap = bs.bytes(4 * Math.ceil(n / 32)), overlap = opt & 1 ? next(Math.ceil(n / 8)).bytes(Math.ceil(n / 8)) : null;
  const glyphs = [], xMins = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const c = nc.i16(), hasBox = !!(bitmap[i >> 3] & (0x80 >> (i & 7)));
    let g;
    if (c === 0) { if (hasBox) throw new Error('The WOFF2 glyph data is damaged (bounding box on an empty glyph).'); glyphs.push(Buffer.alloc(0)); continue; }
    if (c === -1) {
      if (!hasBox) throw new Error('The WOFF2 glyph data is damaged (composite glyph without bounding box).');
      const start = cs.pos, instr = skipComponents(cs);
      g = { n: -1, ends: [], pts: [], comps: data.subarray(start, cs.pos), ins: Buffer.alloc(0), overlap: false };
      if (instr) g.ins = ins.bytes(gs.u255());
    } else if (c > 0) {
      g = { n: c, ends: [], pts: [], comps: Buffer.alloc(0), ins: null, overlap: false };
      let total = 0;
      for (let k = 0; k < c; k++) { total += np.u255(); if (total > 0xffff) throw new Error('The WOFF2 glyph data is damaged (too many points).'); g.ends.push(total - 1); }
      let x = 0, y = 0;
      for (let k = 0; k < total; k++) {
        let f = fl.u8();
        const on = !(f & 0x80);
        f &= 0x7f;
        let dx, dy;
        if (f < 10) { dx = 0; dy = withSign(f, ((f & 14) << 7) + gs.u8()); }
        else if (f < 20) { dx = withSign(f, (((f - 10) & 14) << 7) + gs.u8()); dy = 0; }
        else if (f < 84) { const b0 = f - 20, b1 = gs.u8(); dx = withSign(f, 1 + (b0 & 0x30) + (b1 >> 4)); dy = withSign(f >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f)); }
        else if (f < 120) { const b0 = f - 84, b1 = gs.u8(), b2 = gs.u8(); dx = withSign(f, 1 + (Math.floor(b0 / 12) << 8) + b1); dy = withSign(f >> 1, 1 + (((b0 % 12) >> 2) << 8) + b2); }
        else if (f < 124) { const b1 = gs.u8(), b2 = gs.u8(), b3 = gs.u8(); dx = withSign(f, (b1 << 4) + (b2 >> 4)); dy = withSign(f >> 1, ((b2 & 0x0f) << 8) + b3); }
        else { dx = withSign(f, gs.u16()); dy = withSign(f >> 1, gs.u16()); }
        x += dx; y += dy;
        g.pts.push({ x, y, on });
      }
      g.ins = ins.bytes(gs.u255());
      g.overlap = !!overlap && !!(overlap[i >> 3] & (0x80 >> (i & 7)));
    } else throw new Error('The WOFF2 glyph data is damaged (invalid contour count).');
    if (hasBox) { g.xMin = bs.i16(); g.yMin = bs.i16(); g.xMax = bs.i16(); g.yMax = bs.i16(); } else [g.xMin, g.yMin, g.xMax, g.yMax] = bounds(g);
    xMins[i] = g.xMin;
    glyphs.push(serializeGlyph(g));
  }
  return { ...buildGlyf(glyphs, long), xMins };
}
function transformHmtx(hmtx, n, metrics, xMins) {
  if (metrics < 1 || metrics > n || hmtx.length !== 4 * metrics + 2 * (n - metrics)) return null;
  const r = new R(hmtx), adv = [], lsb = [];
  for (let i = 0; i < metrics; i++) { adv.push(r.u16()); lsb.push(r.i16()); }
  for (let i = metrics; i < n; i++) lsb.push(r.i16());
  let prop = true, mono = true;
  for (let i = 0; i < n; i++) if (lsb[i] !== xMins[i]) { if (i < metrics) prop = false; else mono = false; }
  if (!prop && !mono) return null;
  const w = new W(hmtx.length);
  w.u8((prop ? 1 : 0) | (mono ? 2 : 0));
  for (const a of adv) w.u16(a);
  if (!prop) for (let i = 0; i < metrics; i++) w.i16(lsb[i]);
  if (!mono) for (let i = metrics; i < n; i++) w.i16(lsb[i]);
  return Buffer.from(w.out);
}
function reconstructHmtx(data, off, len, n, metrics, xMins) {
  if (metrics < 1 || metrics > n || xMins.length < n) throw new Error('The WOFF2 metrics are damaged.');
  const r = new R(data, off, off + len), f = r.u8();
  if (f & 0xfc) throw new Error('The WOFF2 metrics use unknown flags.');
  const adv = Array.from({ length: metrics }, () => r.u16()), lsb = xMins.slice(0, n);
  if (!(f & 1)) for (let i = 0; i < metrics; i++) lsb[i] = r.i16();
  if (!(f & 2)) for (let i = metrics; i < n; i++) lsb[i] = r.i16();
  const w = new W(4 * metrics + 2 * (n - metrics));
  for (let i = 0; i < n; i++) { if (i < metrics) w.u16(adv[i]); w.i16(lsb[i]); }
  return Buffer.from(w.out);
}
function brotli(data, ctx, from = 0.3, to = 0.95) {
  return new Promise((resolve, reject) => {
    const C = zlib.constants;
    const z = zlib.createBrotliCompress({ params: { [C.BROTLI_PARAM_QUALITY]: 11, [C.BROTLI_PARAM_LGWIN]: 22, [C.BROTLI_PARAM_MODE]: C.BROTLI_MODE_FONT, [C.BROTLI_PARAM_SIZE_HINT]: data.length } });
    const chunks = [];
    const onAbort = () => { z.destroy(); reject(cancelled()); };
    if (ctx?.signal?.aborted) return onAbort();
    ctx?.signal?.addEventListener('abort', onAbort, { once: true });
    z.on('data', (c) => chunks.push(c));
    z.on('error', reject);
    z.on('end', () => { ctx?.signal?.removeEventListener('abort', onAbort); resolve(Buffer.concat(chunks)); });
    let off = 0;
    const pump = () => {
      while (off < data.length) {
        const part = data.subarray(off, off + 262144);
        off += part.length;
        ctx?.progress?.(from + ((to - from) * off) / data.length, 'Compressing');
        if (!z.write(part)) { z.once('drain', pump); return; }
      }
      z.end();
    };
    pump();
  });
}
async function woff2Encode(src, ctx) {
  const font = clone(src);
  font.tables.delete('DSIG');
  let tg = null, hm = null;
  if (!hasCff(font) && font.tables.has('glyf') && font.tables.has('loca') && font.tables.has('head')) tg = transformGlyf(font);
  if (tg) {
    const head = withLocFormat(need(font, 'head'), tg.long);
    head.writeUInt16BE(head.readUInt16BE(16) | 0x800, 16);
    font.tables.set('head', head);
    const hhea = font.tables.get('hhea');
    if (font.tables.has('hmtx') && hhea?.length >= 36) hm = transformHmtx(font.tables.get('hmtx'), glyphCount(font), hhea.readUInt16BE(34), tg.xMins);
  }
  // Ordinal tag order, with loca right after glyf as Google's reference encoder writes it.
  const tags = [...font.tables.keys()].sort(ordinal);
  if (tags.includes('glyf') && tags.includes('loca')) { tags.splice(tags.indexOf('loca'), 1); tags.splice(tags.indexOf('glyf') + 1, 0, 'loca'); }
  const entries = [], parts = [];
  let sfntSize = 12 + 16 * tags.length;
  for (const tag of tags) {
    let d = font.tables.get(tag), e;
    if (tag === 'glyf' && tg) { e = { tag, v: 0, orig: tg.glyfLen, stored: tg.data.length, t: true }; d = tg.data; }
    else if (tag === 'loca' && tg) { e = { tag, v: 0, orig: tg.locaLen, stored: 0, t: true }; d = Buffer.alloc(0); }
    else if (tag === 'glyf' || tag === 'loca') e = { tag, v: 3, orig: d.length, stored: d.length, t: false };
    else if (tag === 'hmtx' && hm) { e = { tag, v: 1, orig: d.length, stored: hm.length, t: true }; d = hm; }
    else e = { tag, v: 0, orig: d.length, stored: d.length, t: false };
    entries.push(e);
    parts.push(d);
    sfntSize += pad4(e.orig);
  }
  const packed = await brotli(Buffer.concat(parts), ctx);
  const w = new W(48 + entries.length * 10 + packed.length + 4);
  w.u32(WOFF2); w.u32(font.flavor); w.u32(0); w.u16(entries.length); w.u16(0);
  w.u32(Math.min(sfntSize, 0xffffffff)); w.u32(packed.length);
  const [major, minor] = fontVersion(font);
  w.u16(major); w.u16(minor);
  for (let i = 0; i < 5; i++) w.u32(0);
  for (const e of entries) {
    const k = KNOWN.indexOf(e.tag);
    w.u8((k >= 0 ? k : 63) | (e.v << 6));
    if (k < 0) w.u32(tagValue(e.tag));
    w.ub128(e.orig);
    if (e.t) w.ub128(e.stored);
  }
  w.bytes(packed);
  w.pad4();
  w.b.writeUInt32BE(w.n, 8);
  return Buffer.from(w.out);
}
function woff2Decode(b) {
  const r = new R(b);
  if (r.u32() !== WOFF2) throw new Error('This is not a WOFF2 file.');
  let flavor = r.u32();
  r.skip(4);
  const count = r.u16();
  r.skip(6);
  const compLen = r.u32();
  r.pos = 48;
  const entries = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const f = r.u8(), tag = (f & 63) === 63 ? tagName(r.u32()) : KNOWN[f & 63], v = f >> 6, orig = r.ub128();
    const t = tag === 'glyf' || tag === 'loca' ? v !== 3 : v !== 0;
    if (t && !((tag === 'glyf' || tag === 'loca') && v === 0) && !(tag === 'hmtx' && v === 1)) throw new Error(`The WOFF2 table '${tag.trim()}' uses an unknown transform.`);
    const stored = t ? r.ub128() : orig;
    if (tag === 'loca' && t && stored !== 0) throw new Error('The WOFF2 \'loca\' table is damaged.');
    entries.push({ tag, v, orig, stored, t, off: total });
    total += stored;
  }
  if (total > 0x7fffffff) throw new Error('The WOFF2 file is too large.');
  let selected = entries;
  if (flavor === TTCF) {
    r.u32();
    const fonts = r.u255();
    if (!fonts) throw new Error('The WOFF2 font collection is empty.');
    for (let m = 0; m < fonts; m++) {
      const n = r.u255(), fflavor = r.u32(), idx = Array.from({ length: n }, () => r.u255());
      if (idx.some((i) => i >= entries.length)) throw new Error('The WOFF2 font collection is damaged.');
      if (m === 0) { flavor = fflavor; selected = idx.map((i) => entries[i]); }
    }
  }
  if (![TT, OTTO, TRUE].includes(flavor)) throw new Error('The WOFF2 file contains an unknown kind of font.');
  if (compLen > b.length - r.pos) throw new Error('The WOFF2 file is truncated.');
  let stream;
  try { stream = total ? zlib.brotliDecompressSync(b.subarray(r.pos, r.pos + compLen), { maxOutputLength: total }) : Buffer.alloc(0); } catch (_) { stream = null; }
  if (!stream || stream.length !== total) throw new Error('The WOFF2 font data can’t be decompressed (the file is damaged).');
  const font = { flavor: flavor === TRUE ? TT : flavor, tables: new Map() };
  for (const e of selected.filter((x) => !x.t)) font.tables.set(e.tag, stream.subarray(e.off, e.off + e.stored));
  const ge = selected.find((e) => e.tag === 'glyf'), le = selected.find((e) => e.tag === 'loca');
  if (!ge !== !le || (ge && ge.t !== le.t)) throw new Error('The WOFF2 \'glyf\' and \'loca\' tables don’t match.');
  let xMins = null;
  if (ge?.t) {
    const g = reconstructGlyf(stream, ge.off, ge.stored);
    font.tables.set('glyf', g.glyf);
    font.tables.set('loca', g.loca);
    font.tables.set('head', withLocFormat(need(font, 'head'), g.long));
    xMins = g.xMins;
  }
  const he = selected.find((e) => e.tag === 'hmtx' && e.t);
  if (he) {
    if (!xMins) throw new Error('The WOFF2 \'hmtx\' table is transformed without \'glyf\'.');
    font.tables.set('hmtx', reconstructHmtx(stream, he.off, he.stored, glyphCount(font), need(font, 'hhea').readUInt16BE(34), xMins));
  }
  return font;
}

// ───────── names and EOT ─────────
function names(table) {
  const recs = [];
  if (table && table.length >= 6) {
    try {
      const r = new R(table);
      r.u16();
      const n = r.u16(), so = r.u16();
      for (let i = 0; i < n; i++) {
        const [pl, enc, lang, id, len, off] = [r.u16(), r.u16(), r.u16(), r.u16(), r.u16(), r.u16()];
        if (so + off + len > table.length) continue;
        const bytes = table.subarray(so + off, so + off + len);
        const v = pl === 0 || pl === 3 ? new TextDecoder('utf-16be').decode(bytes) : pl === 1 && enc === 0 ? bytes.toString('latin1') : null;
        if (v != null) recs.push({ pl, lang, id, v });
      }
    } catch (_) {}
  }
  return (id) => { const c = recs.filter((x) => x.id === id); return (c.find((x) => x.pl === 3 && x.lang === 0x409) || c.find((x) => x.pl === 3) || c.find((x) => x.pl === 0) || c[0])?.v || ''; };
}
const isEot = (b) => b.length >= 82 && b.readUInt16LE(34) === 0x504c && [0x00010000, 0x00020001, 0x00020002].includes(b.readUInt32LE(8));
function eotEncode(font) {
  const sfnt = writeSfnt(font), f = readSfnt(sfnt);
  const os2 = f.tables.get('OS/2') || Buffer.alloc(0), head = need(f, 'head'), name = names(f.tables.get('name'));
  const u16 = (o) => (os2.length >= o + 2 ? os2.readUInt16BE(o) : 0), u32 = (o) => (os2.length >= o + 4 ? os2.readUInt32BE(o) : 0);
  const str = (s) => { const b = Buffer.from(s, 'utf16le'), h = Buffer.alloc(2); h.writeUInt16LE(b.length); return Buffer.concat([h, b]); };
  const hdr = Buffer.alloc(82);
  hdr.writeUInt32LE(sfnt.length, 4);
  hdr.writeUInt32LE(0x00020001, 8);
  if (os2.length >= 42) os2.copy(hdr, 16, 32, 42);
  hdr[26] = 1;
  hdr[27] = u16(62) & 1;
  hdr.writeUInt32LE(u16(4), 28);
  hdr.writeUInt16LE(u16(8), 32);
  hdr.writeUInt16LE(0x504c, 34);
  for (let i = 0; i < 4; i++) hdr.writeUInt32LE(u32(42 + 4 * i), 36 + 4 * i);
  for (let i = 0; i < 2; i++) hdr.writeUInt32LE(u32(78 + 4 * i), 52 + 4 * i);
  hdr.writeUInt32LE(head.readUInt32BE(8), 60);
  const z2 = Buffer.alloc(2);
  const eot = Buffer.concat([hdr, str(name(1)), z2, str(name(2)), z2, str(name(5)), z2, str(name(4)), z2, z2, sfnt]);
  eot.writeUInt32LE(eot.length, 0);
  return eot;
}
function eotDecode(b) {
  if (!isEot(b)) throw new Error('This is not an EOT file.');
  const size = b.readUInt32LE(0), fsize = b.readUInt32LE(4), flags = b.readUInt32LE(12);
  if (flags & 4) throw new Error('This EOT file is compressed with MicroType Express, which Lime can’t unpack. Only uncompressed EOT files can be converted.');
  if (size > b.length || size < 82 || fsize > size - 82) throw new Error('The EOT file is truncated or damaged.');
  const data = Buffer.from(b.subarray(size - fsize, size));
  if (flags & 0x10000000) for (let i = 0; i < data.length; i++) data[i] ^= 0x50;
  return readSfnt(data);
}

// ───────── CFF (version 1) ─────────
const STD_STRINGS = '.notdef space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde exclamdown cent sterling fraction yen florin section currency quotesingle quotedblleft guillemotleft guilsinglleft guilsinglright fi fl endash dagger daggerdbl periodcentered paragraph bullet quotesinglbase quotedblbase quotedblright guillemotright ellipsis perthousand questiondown grave acute circumflex tilde macron breve dotaccent dieresis ring cedilla hungarumlaut ogonek caron emdash AE ordfeminine Lslash Oslash OE ordmasculine ae dotlessi lslash oslash oe germandbls onesuperior logicalnot mu trademark Eth onehalf plusminus Thorn onequarter divide brokenbar degree thorn threequarters twosuperior registered minus eth multiply threesuperior copyright Aacute Acircumflex Adieresis Agrave Aring Atilde Ccedilla Eacute Ecircumflex Edieresis Egrave Iacute Icircumflex Idieresis Igrave Ntilde Oacute Ocircumflex Odieresis Ograve Otilde Scaron Uacute Ucircumflex Udieresis Ugrave Yacute Ydieresis Zcaron aacute acircumflex adieresis agrave aring atilde ccedilla eacute ecircumflex edieresis egrave iacute icircumflex idieresis igrave ntilde oacute ocircumflex odieresis ograve otilde scaron uacute ucircumflex udieresis ugrave yacute ydieresis zcaron exclamsmall Hungarumlautsmall dollaroldstyle dollarsuperior ampersandsmall Acutesmall parenleftsuperior parenrightsuperior twodotenleader onedotenleader zerooldstyle oneoldstyle twooldstyle threeoldstyle fouroldstyle fiveoldstyle sixoldstyle sevenoldstyle eightoldstyle nineoldstyle commasuperior threequartersemdash periodsuperior questionsmall asuperior bsuperior centsuperior dsuperior esuperior isuperior lsuperior msuperior nsuperior osuperior rsuperior ssuperior tsuperior ff ffi ffl parenleftinferior parenrightinferior Circumflexsmall hyphensuperior Gravesmall Asmall Bsmall Csmall Dsmall Esmall Fsmall Gsmall Hsmall Ismall Jsmall Ksmall Lsmall Msmall Nsmall Osmall Psmall Qsmall Rsmall Ssmall Tsmall Usmall Vsmall Wsmall Xsmall Ysmall Zsmall colonmonetary onefitted rupiah Tildesmall exclamdownsmall centoldstyle Lslashsmall Scaronsmall Zcaronsmall Dieresissmall Brevesmall Caronsmall Dotaccentsmall Macronsmall figuredash hypheninferior Ogoneksmall Ringsmall Cedillasmall questiondownsmall oneeighth threeeighths fiveeighths seveneighths onethird twothirds zerosuperior foursuperior fivesuperior sixsuperior sevensuperior eightsuperior ninesuperior zeroinferior oneinferior twoinferior threeinferior fourinferior fiveinferior sixinferior seveninferior eightinferior nineinferior centinferior dollarinferior periodinferior commainferior Agravesmall Aacutesmall Acircumflexsmall Atildesmall Adieresissmall Aringsmall AEsmall Ccedillasmall Egravesmall Eacutesmall Ecircumflexsmall Edieresissmall Igravesmall Iacutesmall Icircumflexsmall Idieresissmall Ethsmall Ntildesmall Ogravesmall Oacutesmall Ocircumflexsmall Otildesmall Odieresissmall OEsmall Oslashsmall Ugravesmall Uacutesmall Ucircumflexsmall Udieresissmall Yacutesmall Thornsmall Ydieresissmall 001.000 001.001 001.002 001.003 Black Bold Book Light Medium Regular Roman Semibold'.split(' ');
const MAC_NAMES = '.notdef .null nonmarkingreturn space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute agrave acircumflex adieresis atilde aring ccedilla eacute egrave ecircumflex edieresis iacute igrave icircumflex idieresis ntilde oacute ograve ocircumflex odieresis otilde uacute ugrave ucircumflex udieresis dagger degree cent sterling section bullet paragraph germandbls registered copyright trademark acute dieresis notequal AE Oslash infinity plusminus lessequal greaterequal yen mu partialdiff summation product pi integral ordfeminine ordmasculine Omega ae oslash questiondown exclamdown logicalnot radical florin approxequal Delta guillemotleft guillemotright ellipsis nonbreakingspace Agrave Atilde Otilde OE oe endash emdash quotedblleft quotedblright quoteleft quoteright divide lozenge ydieresis Ydieresis fraction currency guilsinglleft guilsinglright fi fl daggerdbl periodcentered quotesinglbase quotedblbase perthousand Acircumflex Ecircumflex Aacute Edieresis Egrave Iacute Icircumflex Idieresis Igrave Oacute Ocircumflex apple Ograve Uacute Ucircumflex Ugrave dotlessi circumflex tilde macron breve dotaccent ring cedilla hungarumlaut ogonek caron Lslash lslash Scaron scaron Zcaron zcaron brokenbar Eth eth Yacute yacute Thorn thorn minus multiply onesuperior twosuperior threesuperior onehalf onequarter threequarters franc Gbreve gbreve Idotaccent Scedilla scedilla Cacute cacute Ccaron ccaron dcroat'.split(' ');
const STD_ENCODING = (() => {
  const m = new Array(256).fill(0);
  for (let c = 32; c <= 126; c++) m[c] = c - 31;
  for (const [c, s, n] of [[161, 96, 15], [177, 111, 4], [182, 115, 8], [191, 123, 1], [193, 124, 8], [202, 132, 2], [205, 134, 4], [225, 138, 1], [227, 139, 1], [232, 140, 4], [241, 144, 1], [245, 145, 1], [248, 146, 4]]) for (let i = 0; i < n; i++) m[c + i] = s + i;
  return m;
})();
const CFF_BAD = 'The CFF table is damaged.';
function cffIndex(d, pos) {
  const r = new R(d, pos), count = r.u16();
  if (!count) return { items: [], next: r.pos };
  const os = r.u8();
  if (os < 1 || os > 4) throw new Error('The CFF table is damaged (invalid INDEX).');
  const offs = [];
  for (let i = 0; i <= count; i++) { let v = 0; for (let k = 0; k < os; k++) v = v * 256 + r.u8(); offs.push(v); }
  const base = r.pos - 1, items = [];
  for (let i = 0; i < count; i++) {
    const s = base + offs[i], e = base + offs[i + 1];
    if (s < r.pos || e < s || e > d.length) throw new Error('The CFF table is damaged (INDEX data outside the table).');
    items.push(d.subarray(s, e));
  }
  return { items, next: base + offs[count] };
}
function cffDict(d) {
  const dict = new Map(), ops = [], r = new R(d);
  while (r.left > 0) {
    const b = r.u8();
    if (b <= 21) { dict.set(b === 12 ? 1200 + r.u8() : b, ops.splice(0)); continue; }
    if (b === 28) ops.push(r.i16());
    else if (b === 29) ops.push(r.i32());
    else if (b === 30) {
      let s = '';
      for (let done = false; !done;) { const x = r.u8(); for (const nb of [x >> 4, x & 15]) { if (done) break; if (nb <= 9) s += nb; else if (nb === 10) s += '.'; else if (nb === 11) s += 'E'; else if (nb === 12) s += 'E-'; else if (nb === 14) s += '-'; else if (nb === 15) done = true; } }
      const v = Number(s);
      ops.push(Number.isFinite(v) ? v : 0);
    } else if (b >= 32 && b <= 246) ops.push(b - 139);
    else if (b >= 247 && b <= 250) ops.push((b - 247) * 256 + r.u8() + 108);
    else if (b >= 251 && b <= 254) ops.push(-(b - 251) * 256 - r.u8() - 108);
    else throw new Error('The CFF table is damaged (invalid DICT data).');
  }
  return dict;
}
const mul = (a, b) => [b[0] * a[0] + b[2] * a[1], b[1] * a[0] + b[3] * a[1], b[0] * a[2] + b[2] * a[3], b[1] * a[2] + b[3] * a[3], b[0] * a[4] + b[2] * a[5] + b[4], b[1] * a[4] + b[3] * a[5] + b[5]];
function parseCff(d) {
  if (d.length < 4) throw new Error(CFF_BAD);
  if (d[0] !== 1) throw new Error(`CFF version ${d[0]} outlines can’t be converted.`);
  const off = (v) => { if (!(v >= 0 && v < d.length)) throw new Error('The CFF table is damaged (offset outside the table).'); return Math.floor(v); };
  let i = cffIndex(d, d[2]);
  const tops = cffIndex(d, i.next), strings = cffIndex(d, tops.next), gsubrs = cffIndex(d, strings.next);
  if (!tops.items.length) throw new Error('The CFF table has no font.');
  const top = cffDict(tops.items[0]);
  if ((top.get(1206)?.[0] ?? 2) !== 2) throw new Error('The CFF font uses Type 1 charstrings, which aren’t supported.');
  if (!top.has(17)) throw new Error('The CFF font has no glyphs.');
  const charStrings = cffIndex(d, off(top.get(17)[0])).items, n = charStrings.length;
  const DEF = [0.001, 0, 0, 0.001, 0, 0], tm = top.get(1207)?.length === 6 ? top.get(1207) : DEF;
  const priv = (dict) => {
    const e = dict.get(18);
    if (!e || e.length < 2) return [];
    const size = e[0], o = off(e[1]);
    if (size < 0 || size > d.length - o) throw new Error('The CFF private dictionary lies outside the table.');
    const p = cffDict(d.subarray(o, o + size));
    return p.has(19) ? cffIndex(d, off(o + p.get(19)[0])).items : [];
  };
  const cid = top.has(1230);
  let privates, matrices, fdSelect = new Uint8Array(0);
  if (cid) {
    if (!top.has(1236)) throw new Error('The CID-keyed CFF font has no font dictionaries.');
    const fds = cffIndex(d, off(top.get(1236)[0])).items.map(cffDict);
    privates = fds.map(priv);
    matrices = fds.map((fd) => (fd.get(1207)?.length === 6 ? mul(fd.get(1207), tm) : tm));
    if (top.has(1237)) {
      const r = new R(d, off(top.get(1237)[0])), fmt = r.u8();
      fdSelect = new Uint8Array(n);
      if (fmt === 0) for (let g = 0; g < n; g++) fdSelect[g] = r.u8();
      else if (fmt === 3) { const ranges = r.u16(); let first = r.u16(); for (let k = 0; k < ranges; k++) { const fd = r.u8(), next = r.u16(); for (let g = first; g < next && g < n; g++) fdSelect[g] = fd; first = next; } }
      else throw new Error(`Unknown CFF FDSelect format ${fmt}.`);
      if (fdSelect.some((x) => x >= privates.length)) throw new Error('The CFF FDSelect refers to a missing font dictionary.');
    }
  } else { privates = [priv(top)]; matrices = [tm]; }
  let charset = new Array(n).fill(0);
  const cs = top.get(15)?.[0] ?? 0;
  if (cs === 0) charset = charset.map((_, k) => k);
  else if (cs === 1 || cs === 2) charset = null;
  else {
    const r = new R(d, off(cs)), fmt = r.u8();
    for (let g = 1; g < n;) {
      if (fmt === 0) charset[g++] = r.u16();
      else if (fmt === 1 || fmt === 2) { const first = r.u16(), left = fmt === 1 ? r.u8() : r.u16(); for (let k = 0; k <= left && g < n; k++) charset[g++] = first + k; }
      else throw new Error(`Unknown CFF charset format ${fmt}.`);
    }
  }
  const strs = strings.items.map((s) => s.toString('latin1'));
  const bySid = new Map();
  if (charset && !cid) charset.forEach((s, g) => { if (!bySid.has(s)) bySid.set(s, g); });
  return {
    charStrings, gsubrs: gsubrs.items, privates, matrices, cid, count: n,
    fd: (g) => (g < fdSelect.length ? fdSelect[g] : 0),
    name: (g) => { if (cid || !charset || g >= charset.length) return null; const s = charset[g]; return s < STD_STRINGS.length ? STD_STRINGS[s] : strs[s - STD_STRINGS.length] ?? null; },
    glyphBySid: (s) => bySid.get(s) ?? -1,
  };
}
const bias = (n) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);
// Type 2 charstrings → cubic contours [{ start: [x, y], segs: [{ curve, c1, c2, end }] }]; hints are skipped.
function charstring(cff, gid, allowSeac = true) {
  if (gid < 0 || gid >= cff.count) throw new Error('A CFF accent refers to a missing glyph.');
  const st = [], tr = new Array(32).fill(0), contours = [];
  const lsubrs = cff.privates[Math.min(cff.fd(gid), cff.privates.length - 1)], lbias = bias(lsubrs.length), gbias = bias(cff.gsubrs.length);
  let cur = null, stems = 0, widthDone = false, ended = false, x = 0, y = 0, seac = null;
  const pop = () => { if (!st.length) throw new Error('A CFF charstring has too few arguments.'); return st.pop(); };
  const push = (v) => { if (st.length >= 513) throw new Error('A CFF charstring overflows the argument stack.'); st.push(v); };
  const takeWidth = () => st.shift();
  const close = () => { if (cur && cur.segs.length) contours.push(cur); cur = null; };
  const ensure = () => (cur ??= { start: [x, y], segs: [] });
  const line = (dx, dy) => { ensure(); x += dx; y += dy; cur.segs.push({ curve: false, end: [x, y] }); };
  const curve = (a, b, c, d, e, f) => { ensure(); const c1 = [x + a, y + b], c2 = [c1[0] + c, c1[1] + d]; x = c2[0] + e; y = c2[1] + f; cur.segs.push({ curve: true, c1, c2, end: [x, y] }); };
  const curveAt = (i) => curve(st[i], st[i + 1], st[i + 2], st[i + 3], st[i + 4], st[i + 5]);
  const width = (n) => { if (!widthDone && st.length > n) takeWidth(); widthDone = true; };
  const stemOp = () => { if (!widthDone && st.length % 2 === 1) takeWidth(); widthDone = true; stems += st.length >> 1; st.length = 0; };
  const move = (dx, dy) => { close(); x += dx; y += dy; cur = { start: [x, y], segs: [] }; st.length = 0; };
  const needN = (n) => { if (st.length < n) throw new Error('A CFF charstring has too few arguments.'); };
  const bin = (fn) => { const b = pop(), a = pop(); push(fn(a, b)); };
  const run = (code, depth) => {
    if (depth > 10) throw new Error('CFF subroutines are nested too deeply.');
    const r = new R(code);
    while (r.left > 0 && !ended) {
      const b0 = r.u8();
      if (b0 >= 32 || b0 === 28) { push(b0 === 28 ? r.i16() : b0 <= 246 ? b0 - 139 : b0 <= 250 ? (b0 - 247) * 256 + r.u8() + 108 : b0 <= 254 ? -(b0 - 251) * 256 - r.u8() - 108 : r.i32() / 65536); continue; }
      switch (b0) {
        case 1: case 3: case 18: case 23: stemOp(); break;
        case 19: case 20: stemOp(); r.skip((stems + 7) >> 3); break;
        case 21: width(2); move(st[0] || 0, st[1] || 0); break;
        case 22: width(1); move(st[0] || 0, 0); break;
        case 4: width(1); move(0, st[0] || 0); break;
        case 5: for (let i = 0; i + 1 < st.length; i += 2) line(st[i], st[i + 1]); st.length = 0; break;
        case 6: case 7: for (let i = 0; i < st.length; i++) { if ((i % 2 === 0) === (b0 === 6)) line(st[i], 0); else line(0, st[i]); } st.length = 0; break;
        case 8: for (let i = 0; i + 5 < st.length; i += 6) curveAt(i); st.length = 0; break;
        case 24: { let i = 0; for (; i + 7 < st.length; i += 6) curveAt(i); if (i + 1 < st.length) line(st[i], st[i + 1]); st.length = 0; break; }
        case 25: { let i = 0; for (; i + 7 < st.length; i += 2) line(st[i], st[i + 1]); if (i + 5 < st.length) curveAt(i); st.length = 0; break; }
        case 26: { let i = st.length % 2, d1 = i ? st[0] : 0; for (; i + 3 < st.length; i += 4, d1 = 0) curve(d1, st[i], st[i + 1], st[i + 2], 0, st[i + 3]); st.length = 0; break; }
        case 27: { let i = st.length % 2, d1 = i ? st[0] : 0; for (; i + 3 < st.length; i += 4, d1 = 0) curve(st[i], d1, st[i + 1], st[i + 2], st[i + 3], 0); st.length = 0; break; }
        case 30: case 31: {
          let h = b0 === 31;
          for (let i = 0; i + 3 < st.length; i += 4, h = !h) {
            const last = st.length - i === 5 ? st[i + 4] : 0;
            if (h) curve(st[i], 0, st[i + 1], st[i + 2], last, st[i + 3]); else curve(0, st[i], st[i + 1], st[i + 2], st[i + 3], last);
          }
          st.length = 0;
          break;
        }
        case 10: case 29: {
          const [subrs, bs] = b0 === 10 ? [lsubrs, lbias] : [cff.gsubrs, gbias];
          const k = pop() + bs;
          if (k < 0 || k >= subrs.length) throw new Error('A CFF charstring calls a missing subroutine.');
          run(subrs[k], depth + 1);
          break;
        }
        case 11: return;
        case 14:
          if (!widthDone && (st.length === 1 || st.length === 5)) takeWidth();
          widthDone = true;
          if (st.length >= 4) seac = st.slice(-4);
          close();
          ended = true;
          return;
        case 12: {
          const op = r.u8();
          switch (op) {
            case 0: st.length = 0; break;
            case 3: bin((a, b) => (a && b ? 1 : 0)); break;
            case 4: bin((a, b) => (a || b ? 1 : 0)); break;
            case 5: push(pop() ? 0 : 1); break;
            case 9: push(Math.abs(pop())); break;
            case 10: bin((a, b) => a + b); break;
            case 11: bin((a, b) => a - b); break;
            case 12: bin((a, b) => (b === 0 ? 0 : a / b)); break;
            case 14: push(-pop()); break;
            case 15: bin((a, b) => (a === b ? 1 : 0)); break;
            case 18: pop(); break;
            case 20: { const k = Math.trunc(pop()), v = pop(); if (k >= 0 && k < 32) tr[k] = v; break; }
            case 21: { const k = Math.trunc(pop()); push(k >= 0 && k < 32 ? tr[k] : 0); break; }
            case 22: { const v2 = pop(), v1 = pop(), s2 = pop(), s1 = pop(); push(v1 <= v2 ? s1 : s2); break; }
            case 23: push(0.5); break;
            case 24: bin((a, b) => a * b); break;
            case 26: push(Math.sqrt(Math.max(0, pop()))); break;
            case 27: { const v = pop(); push(v); push(v); break; }
            case 28: { const b = pop(), a = pop(); push(b); push(a); break; }
            case 29: { let k = Math.trunc(pop()); if (k < 0) k = 0; push(k < st.length ? st[st.length - 1 - k] : 0); break; }
            case 30: { let j = Math.trunc(pop()); const n = Math.trunc(pop()); if (n > 0 && n <= st.length) { const items = st.slice(st.length - n); j = ((j % n) + n) % n; for (let k = 0; k < n; k++) st[st.length - n + ((k + j) % n)] = items[k]; } break; }
            case 34: needN(7); curve(st[0], 0, st[1], st[2], st[3], 0); curve(st[4], 0, st[5], -st[2], st[6], 0); st.length = 0; break;
            case 35: needN(12); curveAt(0); curveAt(6); st.length = 0; break;
            case 36: needN(9); curve(st[0], st[1], st[2], st[3], st[4], 0); curve(st[5], 0, st[6], st[7], st[8], -(st[1] + st[3] + st[7])); st.length = 0; break;
            case 37: {
              needN(11);
              let dx = 0, dy = 0;
              for (let k = 0; k < 10; k += 2) { dx += st[k]; dy += st[k + 1]; }
              const hz = Math.abs(dx) > Math.abs(dy);
              curveAt(0);
              curve(st[6], st[7], st[8], st[9], hz ? st[10] : -dx, hz ? -dy : st[10]);
              st.length = 0;
              break;
            }
            default: throw new Error(`The CFF charstring uses an unknown operator (12 ${op}).`);
          }
          break;
        }
        case 15: case 16: throw new Error('The font uses CFF2 charstring operators (variable fonts), which aren’t supported.');
        default: throw new Error(`The CFF charstring uses an unknown operator (${b0}).`);
      }
    }
  };
  run(cff.charStrings[gid], 0);
  close();
  if (seac) {
    if (!allowSeac) throw new Error('A CFF accent is itself an accented glyph.');
    const [adx, ady, bc, ac] = seac;
    contours.push(...charstring(cff, cff.glyphBySid(STD_ENCODING[bc & 255]), false));
    const mv = (p) => [p[0] + adx, p[1] + ady];
    for (const c of charstring(cff, cff.glyphBySid(STD_ENCODING[ac & 255]), false)) contours.push({ start: mv(c.start), segs: c.segs.map((s) => ({ curve: s.curve, c1: s.c1 && mv(s.c1), c2: s.c2 && mv(s.c2), end: mv(s.end) })) });
  }
  return contours;
}

// Cubic → quadratic within a tolerance, after the approach of cu2qu (fontTools, Apache-2.0): n equal pieces with one
// control point each, joined by TrueType's implied on-curve midpoints, taking the smallest n that fits.
const V = { add: (a, b) => [a[0] + b[0], a[1] + b[1]], sub: (a, b) => [a[0] - b[0], a[1] - b[1]], mul: (a, s) => [a[0] * s, a[1] * s], len: (a) => Math.hypot(a[0], a[1]), dot: (a, b) => a[0] * b[0] + a[1] * b[1] };
const Z = [0, 0];
function fits(p0, p1, p2, p3, tol, depth) {
  if (V.len(p2) <= tol && V.len(p1) <= tol) return true;
  const mid = V.mul(V.add(V.add(p0, V.mul(V.add(p1, p2), 3)), p3), 0.125);
  if (V.len(mid) > tol) return false;
  if (depth >= 24) return true;
  const der = V.mul(V.sub(V.sub(V.add(p3, p2), p1), p0), 0.125);
  return fits(p0, V.mul(V.add(p0, p1), 0.5), V.sub(mid, der), mid, tol, depth + 1) && fits(mid, V.add(mid, der), V.mul(V.add(p2, p3), 0.5), p3, tol, depth + 1);
}
function isLine(p0, p1, p2, p3, tol) {
  const ch = V.sub(p3, p0), L = V.len(ch);
  if (L < 1e-9) return V.len(V.sub(p1, p0)) < 1e-9 && V.len(V.sub(p2, p0)) < 1e-9;
  for (const p of [p1, p2]) { const v = V.sub(p, p0), along = V.dot(v, ch) / (L * L), dist = Math.abs(v[0] * ch[1] - v[1] * ch[0]) / L; if (along < 0 || along > 1 || dist > tol * 0.01) return false; }
  return true;
}
function single(p0, p1, p2, p3, tol) {
  const ab = V.sub(p1, p0), cd = V.sub(p3, p2), nrm = [-ab[1], ab[0]], den = V.dot(nrm, cd);
  if (Math.abs(den) < 1e-12) return null;
  const q = V.add(p2, V.mul(cd, V.dot(nrm, V.sub(p0, p2)) / den));
  const c1 = V.add(p0, V.mul(V.sub(q, p0), 2 / 3)), c2 = V.add(p3, V.mul(V.sub(q, p3), 2 / 3));
  return fits(Z, V.sub(c1, p1), V.sub(c2, p2), Z, tol, 0) ? [q] : null;
}
function split(p0, p1, p2, p3, n) {
  const c = V.mul(V.sub(p1, p0), 3), b = V.sub(V.mul(V.sub(p2, p1), 3), c), d = p0, a = V.sub(V.sub(V.sub(p3, d), c), b);
  const dt = 1 / n, out = [];
  for (let i = 0; i < n; i++) {
    const t0 = i * dt;
    const a1 = V.mul(a, dt * dt * dt), b1 = V.mul(V.add(V.mul(a, 3 * t0), b), dt * dt), c1 = V.mul(V.add(V.add(V.mul(b, 2 * t0), c), V.mul(a, 3 * t0 * t0)), dt);
    const d1 = V.add(V.add(V.add(V.mul(a, t0 * t0 * t0), V.mul(b, t0 * t0)), V.mul(c, t0)), d);
    const q1 = V.add(V.mul(c1, 1 / 3), d1), q2 = V.add(V.mul(V.add(b1, c1), 1 / 3), q1), q3 = V.add(V.add(V.add(a1, d1), c1), b1);
    out.push([d1, q1, q2, q3]);
  }
  return out;
}
function spline(p0, p1, p2, p3, n, tol) {
  const pieces = split(p0, p1, p2, p3, n);
  const ctrl = pieces.map(([a, b, c, d], i) => { const s = V.add(a, V.mul(V.sub(b, a), 1.5)), e = V.add(d, V.mul(V.sub(c, d), 1.5)); return V.add(s, V.mul(V.sub(e, s), i / (n - 1))); });
  let d1 = Z, q2 = p0;
  for (let i = 0; i < n; i++) {
    const [, c1, c2, c3] = pieces[i], q0 = q2, q1 = ctrl[i];
    q2 = i + 1 < n ? V.mul(V.add(q1, ctrl[i + 1]), 0.5) : c3;
    const d0 = d1;
    d1 = V.sub(q2, c3);
    if (V.len(d1) > tol || !fits(d0, V.sub(V.add(q0, V.mul(V.sub(q1, q0), 2 / 3)), c1), V.sub(V.add(q2, V.mul(V.sub(q1, q2), 2 / 3)), c2), d1, tol, 0)) return null;
  }
  return ctrl;
}
function cubicToQuad(p0, p1, p2, p3, tol) {
  if (isLine(p0, p1, p2, p3, tol)) return [];
  for (let n = 1; n <= 100; n++) { const s = n === 1 ? single(p0, p1, p2, p3, tol) : spline(p0, p1, p2, p3, n, tol); if (s) return s; }
  return spline(p0, p1, p2, p3, 100, Infinity);
}
function quadGlyph(contours, tol) {
  const ends = [], pts = [];
  for (const c of contours) {
    const raw = [[c.start, true]];
    let cur = c.start;
    for (const s of c.segs) { if (s.curve) for (const q of cubicToQuad(cur, s.c1, s.c2, s.end, tol)) raw.push([q, false]); raw.push([s.end, true]); cur = s.end; }
    const round = (v) => Math.floor(v + 0.5);
    const clean = [];
    for (const [p, on] of raw) {
      const q = { x: round(p[0]), y: round(p[1]), on }, l = clean[clean.length - 1];
      if (l && on && l.on && l.x === q.x && l.y === q.y) continue;
      clean.push(q);
    }
    while (clean.length > 1 && clean[clean.length - 1].on && clean[clean.length - 1].x === clean[0].x && clean[clean.length - 1].y === clean[0].y) clean.pop();
    if (clean.length < 3) continue;
    pts.push(clean[0]);
    for (let i = clean.length - 1; i > 0; i--) pts.push(clean[i]);
    if (pts.length > 0xffff) throw new Error('A glyph has more points than TrueType allows.');
    ends.push(pts.length - 1);
  }
  if (!ends.length) return null;
  const g = { n: ends.length, ends, pts, ins: Buffer.alloc(0), comps: Buffer.alloc(0), overlap: false };
  [g.xMin, g.yMin, g.xMax, g.yMax] = bounds(g);
  return g;
}
const GASP = Buffer.from([0, 1, 0, 1, 0xff, 0xff, 0, 0x0f]), PREP = Buffer.from([0xb8, 0x01, 0xff, 0x85, 0xb0, 0x04, 0x8d]);
function postTable(old, list) {
  const head = Buffer.alloc(32);
  if (old) old.copy(head, 0, 0, Math.min(32, old.length));
  const usable = list.every((n) => n && n.length < 256 && /^[\x21-\x7e]+$/.test(n));
  head.writeUInt32BE(usable ? 0x00020000 : 0x00030000, 0);
  if (!usable) return head;
  const w = new W(64 + list.length * 10), std = new Map(MAC_NAMES.map((n, i) => [n, i])), custom = new Map(), extra = [];
  w.bytes(head);
  w.u16(list.length);
  for (const n of list) {
    if (std.has(n)) { w.u16(std.get(n)); continue; }
    if (!custom.has(n)) { custom.set(n, 258 + extra.length); extra.push(n); }
    w.u16(custom.get(n));
  }
  for (const n of extra) { w.u8(n.length); w.bytes(Buffer.from(n, 'latin1')); }
  return Buffer.from(w.out);
}
function metricsOf(table, metrics, n) {
  const r = new R(table), adv = [], bear = [];
  let last = 0;
  for (let i = 0; i < n; i++) { if (i < metrics) last = r.u16(); adv.push(last); bear.push(r.left >= 2 ? r.i16() : 0); }
  return [adv, bear];
}
function metricsTable(adv, bear, metrics) { const w = new W(adv.length * 4); adv.forEach((a, i) => { if (i < metrics) w.u16(a); w.i16(bear[i]); }); return Buffer.from(w.out); }
// CFF outlines → TrueType: new glyf/loca, maxp 1.0 and post; head, hhea/hmtx (and vhea/vmtx from VORG) updated;
// every other table kept as it is. Hints are not converted; gasp and prep ask for smoothing instead.
function cffToTrueType(src, ctx) {
  if (src.tables.has('CFF2')) throw new Error('This is a variable font with CFF2 outlines. Converting CFF2 to TrueType isn’t supported; WOFF, WOFF2 and OTF work.');
  const cff = parseCff(need(src, 'CFF ')), n = glyphCount(src);
  if (cff.count !== n) throw new Error('The font’s CFF outlines and glyph count don’t match.');
  const head = need(src, 'head'), upem = head.readUInt16BE(18), tol = Math.max(upem, 16) * 0.001;
  const mats = cff.matrices.map((m) => { const s = m.map((v) => v * upem); return s.every((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) < 1e-9) ? null : s; });
  const glyphs = [];
  for (let gid = 0; gid < n; gid++) {
    if (gid % 64 === 0) { if (ctx?.signal?.aborted) throw cancelled(); ctx?.progress?.(0.2 + (0.6 * gid) / n, 'Converting outlines'); }
    let cs = charstring(cff, gid);
    const m = mats[Math.min(cff.fd(gid), mats.length - 1)];
    if (m) { const ap = (p) => p && [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; cs = cs.map((c) => ({ start: ap(c.start), segs: c.segs.map((s) => ({ curve: s.curve, c1: ap(s.c1), c2: ap(s.c2), end: ap(s.end) })) })); }
    glyphs.push(quadGlyph(cs, tol));
  }
  const font = clone(src);
  for (const t of ['CFF ', 'VORG', 'DSIG']) font.tables.delete(t);
  font.flavor = TT;
  const built = buildGlyf(glyphs.map((g) => (g ? serializeGlyph(g) : Buffer.alloc(0))), false, 2);
  font.tables.set('glyf', built.glyf);
  font.tables.set('loca', built.loca);
  const outl = glyphs.filter(Boolean);
  const h = withLocFormat(head, built.long);
  if (outl.length) { h.writeInt16BE(lo(outl.map((g) => g.xMin)), 36); h.writeInt16BE(lo(outl.map((g) => g.yMin)), 38); h.writeInt16BE(hi(outl.map((g) => g.xMax)), 40); h.writeInt16BE(hi(outl.map((g) => g.yMax)), 42); }
  h.writeInt16BE(0, 52);
  font.tables.set('head', h);
  const maxp = new W(32);
  maxp.u32(0x00010000); maxp.u16(n); maxp.u16(hi([0, ...glyphs.map((g) => g?.pts.length || 0)])); maxp.u16(hi([0, ...glyphs.map((g) => g?.n || 0)]));
  for (const v of [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0]) maxp.u16(v);
  font.tables.set('maxp', Buffer.from(maxp.out));
  font.tables.set('post', postTable(src.tables.get('post'), Array.from({ length: n }, (_, g) => cff.name(g))));
  const hhea = font.tables.get('hhea'), hmtx = font.tables.get('hmtx');
  const withOut = glyphs.map((g, i) => (g ? i : -1)).filter((i) => i >= 0);
  if (hhea?.length >= 36 && hmtx) {
    const metrics = hhea.readUInt16BE(34), [adv] = metricsOf(hmtx, metrics, n);
    font.tables.set('hmtx', metricsTable(adv, glyphs.map((g) => g?.xMin || 0), metrics));
    const hh = Buffer.from(hhea);
    hh.writeUInt16BE(hi([0, ...adv]), 10);
    if (withOut.length) { hh.writeInt16BE(lo(withOut.map((i) => glyphs[i].xMin)), 12); hh.writeInt16BE(lo(withOut.map((i) => adv[i] - glyphs[i].xMax)), 14); hh.writeInt16BE(hi(withOut.map((i) => glyphs[i].xMax)), 16); }
    font.tables.set('hhea', hh);
  }
  const vorg = src.tables.get('VORG'), vhea = font.tables.get('vhea'), vmtx = font.tables.get('vmtx');
  if (vorg && vhea?.length >= 36 && vmtx) {
    const metrics = vhea.readUInt16BE(34), [hts, tsb] = metricsOf(vmtx, metrics, n), r = new R(vorg);
    r.skip(4);
    const def = r.i16(), cnt = r.u16(), origins = new Map();
    for (let i = 0; i < cnt; i++) origins.set(r.u16(), r.i16());
    glyphs.forEach((g, i) => { if (g) tsb[i] = (origins.has(i) ? origins.get(i) : def) - g.yMax; });
    font.tables.set('vmtx', metricsTable(hts, tsb, metrics));
    const vh = Buffer.from(vhea), ext = (i) => tsb[i] + glyphs[i].yMax - glyphs[i].yMin;
    if (withOut.length) { vh.writeInt16BE(lo(withOut.map((i) => tsb[i])), 12); vh.writeInt16BE(lo(withOut.map((i) => hts[i] - ext(i))), 14); vh.writeInt16BE(hi(withOut.map(ext)), 16); }
    font.tables.set('vhea', vh);
  }
  if (!font.tables.has('gasp') && !font.tables.has('prep')) { font.tables.set('gasp', GASP); font.tables.set('prep', PREP); }
  return font;
}

// ───────── loading, saving and info ─────────
function load(b) {
  if (b.length >= 4) { const sig = b.readUInt32BE(0); if (sig === WOFF) return woffDecode(b); if (sig === WOFF2) return woff2Decode(b); }
  if (isSfnt(b)) return readSfnt(b);
  if (isEot(b)) return eotDecode(b);
  throw new Error('This file is not a font Lime can read (TTF, OTF, WOFF, WOFF2 or EOT).');
}
const trueType = (f, ctx) => (!f.tables.has('glyf') && (f.tables.has('CFF ') || f.tables.has('CFF2')) ? cffToTrueType(f, ctx) : f);
async function save(font, to, ctx) {
  if (to === 'ttf') return writeSfnt(trueType(font, ctx));
  if (to === 'otf') return writeSfnt(font);
  if (to === 'woff') return woffEncode(font);
  if (to === 'woff2') return woff2Encode(font, ctx);
  if (to === 'eot') return eotEncode(trueType(font, ctx));
  throw new Error(`Lime can’t save fonts as ${String(to).toUpperCase()}.`);
}
async function convert(input, o, ctx) {
  ctx.progress?.(0.05, 'Reading the font');
  const font = load(await fsp.readFile(input));
  const data = await save(font, o.to, ctx);
  const out = ctx.out.file(input, `${U.base(input)}${U.ext(input) === o.to ? '-converted' : ''}.${o.to}`);
  await fsp.writeFile(out, data);
  return out;
}
function cmapCount(cmap) {
  if (!cmap || cmap.length < 4) return 0;
  const r = new R(cmap);
  r.u16();
  const n = r.u16(), subs = [];
  for (let i = 0; i < n; i++) subs.push({ pl: r.u16(), enc: r.u16(), off: r.u32() });
  const pick = subs.find((s) => s.pl === 3 && s.enc === 10) || subs.find((s) => s.pl === 0 && s.enc >= 4) || subs.find((s) => s.pl === 3 && s.enc === 1) || subs.find((s) => s.pl === 0) || null;
  if (!pick) return 0;
  try {
    const t = new R(cmap, pick.off), fmt = t.u16();
    const codes = new Set();
    if (fmt === 4) {
      t.skip(4);
      const segs = t.u16() / 2;
      t.skip(6);
      const ends = Array.from({ length: segs }, () => t.u16());
      t.skip(2);
      const starts = Array.from({ length: segs }, () => t.u16()), deltas = Array.from({ length: segs }, () => t.i16()), roPos = t.pos, ros = Array.from({ length: segs }, () => t.u16());
      for (let s = 0; s < segs; s++) for (let c = starts[s]; c <= ends[s] && c !== 0xffff; c++) {
        let g;
        if (!ros[s]) g = (c + deltas[s]) & 0xffff;
        else { const at = roPos + 2 * s + ros[s] + 2 * (c - starts[s]); g = at + 2 <= cmap.length ? cmap.readUInt16BE(at) : 0; if (g) g = (g + deltas[s]) & 0xffff; }
        if (g) codes.add(c);
      }
    } else if (fmt === 12) {
      t.skip(10);
      const groups = t.u32();
      for (let i = 0; i < groups; i++) { const s = t.u32(), e = t.u32(); t.skip(4); for (let c = s; c <= e && codes.size < 2e6; c++) codes.add(c); }
    }
    return codes.size;
  } catch (_) { return 0; }
}
function info(font) {
  const name = names(font.tables.get('name')), os2 = font.tables.get('OS/2'), head = font.tables.get('head');
  const fsType = os2?.length >= 10 ? os2.readUInt16BE(8) : 0;
  const embed = fsType & 2 ? 'Restricted (no embedding)' : fsType & 4 ? 'Preview & print' : fsType & 8 ? 'Editable' : 'Installable';
  const outlines = font.tables.has('glyf') ? 'TrueType (quadratic)' : font.tables.has('CFF2') ? 'CFF2 (variable PostScript)' : font.tables.has('CFF ') ? 'PostScript / CFF (cubic)' : 'Bitmap only';
  const axes = [];
  const fvar = font.tables.get('fvar');
  if (fvar?.length >= 16) { try { const r = new R(fvar); r.skip(4); const ao = r.u16(); r.skip(2); const ac = r.u16(), as = r.u16(); for (let i = 0; i < ac; i++) axes.push(tagName(fvar.readUInt32BE(ao + i * as)).trim()); } catch (_) {} }
  return {
    family: name(16) || name(1), style: name(17) || name(2), fullName: name(4), version: name(5), postscript: name(6), designer: name(9), copyright: name(0), license: name(13),
    glyphs: glyphCount(font), characters: cmapCount(font.tables.get('cmap')), unitsPerEm: head?.length >= 20 ? head.readUInt16BE(18) : 0, outlines,
    weight: os2?.length >= 6 ? os2.readUInt16BE(4) : 0, italic: os2?.length >= 64 ? !!(os2.readUInt16BE(62) & 1) : !!(head?.length >= 46 && head.readUInt16BE(44) & 2), embedding: embed, axes, tables: [...font.tables.keys()].sort(ordinal),
  };
}
async function report(input, o, ctx) {
  const i = info(load(await fsp.readFile(input)));
  const n = (v) => Number(v).toLocaleString('en-US');
  const lines = [
    ['Family', i.family], ['Style', i.style], ['Full name', i.fullName], ['Version', i.version], ['PostScript name', i.postscript], ['Outlines', i.outlines],
    ['Glyphs', n(i.glyphs)], ['Characters', i.characters ? n(i.characters) : ''], ['Units per em', n(i.unitsPerEm)], ['Weight', i.weight ? String(i.weight) : ''], ['Italic', i.italic ? 'yes' : 'no'],
    ['Variable axes', i.axes.join(', ')], ['Embedding', i.embedding], ['Designer', i.designer], ['Copyright', i.copyright], ['Tables', i.tables.map((t) => t.trim()).join(' ')],
  ].filter(([, v]) => v);
  const text = `${path.basename(input)}\n${lines.map(([k, v]) => `${k}: ${v}`).join('\n')}`;
  let out;
  if (o.save) { out = ctx.out.file(input, `${U.base(input)} - info.txt`); await fsp.writeFile(out, `${text}\n`); }
  return { path: out, note: `${i.family} ${i.style} · ${n(i.glyphs)} glyphs`, text, info: i };
}

module.exports = { convert, report, load, save, info, readSfnt, writeSfnt, woffEncode, woffDecode, woff2Encode, woff2Decode, eotEncode, eotDecode, cffToTrueType, parseCff, charstring, readGlyphs, parseGlyph, serializeGlyph, buildGlyf, names, checksum, STD_STRINGS };
