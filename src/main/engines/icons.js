'use strict';
// ICO, CUR and ICNS readers and writers. ICNS follows Filee's IcnsFile (MIT, KnifeLemon).
const sharp = () => require('./image').sharp();
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b) => b.length > 8 && b.subarray(0, 8).equals(PNG_SIG);
const isJp2 = (b) => (b.length > 8 && b.readUInt32BE(0) === 12 && b.toString('latin1', 4, 8) === 'jP  ') || (b.length > 4 && b.readUInt32BE(0) === 0xff4fff51);
const rgba = async (s) => s.ensureAlpha().toColourspace('srgb').raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
const png = (data, width, height) => sharp()(data, { raw: { width, height, channels: 4 } }).png().toBuffer();

// 32-bit BMP DIB as stored in ICO/CUR: BITMAPINFOHEADER (height doubled), BGRA rows bottom-up, then the 1-bit AND mask.
function dib(px, w, h) {
  const and = ((w + 31) >> 5) * 4, xor = w * h * 4, out = Buffer.alloc(40 + xor + and * h);
  out.writeUInt32LE(40, 0); out.writeInt32LE(w, 4); out.writeInt32LE(h * 2, 8); out.writeUInt16LE(1, 12); out.writeUInt16LE(32, 14); out.writeUInt32LE(xor, 20);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4, d = 40 + (y * w + x) * 4;
      if (px[s + 3]) { out[d] = px[s + 2]; out[d + 1] = px[s + 1]; out[d + 2] = px[s]; out[d + 3] = px[s + 3]; } else out[40 + xor + y * and + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}
// entries: { w, h, a, b, data } where a/b are planes/bit count in an icon and the hotspot in a cursor.
function container(type, entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(type, 2); head.writeUInt16LE(entries.length, 4);
  let off = head.length;
  entries.forEach((e, i) => {
    const o = 6 + 16 * i;
    head[o] = e.w & 255; head[o + 1] = e.h & 255;
    head.writeUInt16LE(e.a, o + 4); head.writeUInt16LE(e.b, o + 6); head.writeUInt32LE(e.data.length, o + 8); head.writeUInt32LE(off, o + 12);
    off += e.data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
}

// The 256 px entry is PNG, smaller ones are DIBs, which every icon loader reads.
async function writeIco(src, sizes = [256, 128, 64, 48, 32, 24, 16]) {
  const entries = [];
  for (const s of sizes) {
    const { data } = await rgba(sharp()(src).resize(s, s, { fit: 'contain', background: CLEAR }));
    entries.push({ w: s, h: s, a: 1, b: 32, data: s >= 256 ? await png(data, s, s) : dib(data, s, s) });
  }
  return container(1, entries);
}
async function writeCur(src, hotspot = 'topleft') {
  const { data, info } = await rgba(sharp()(src).resize(256, 256, { fit: 'inside', withoutEnlargement: true }));
  const { width: w, height: h } = info, centre = hotspot === 'center';
  return container(2, [{ w, h, a: centre ? w >> 1 : 0, b: centre ? h >> 1 : 0, data: dib(data, w, h) }]);
}

// Largest entry of an ICO or CUR file, as PNG.
async function readIco(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || ![1, 2].includes(buf.readUInt16LE(2))) throw new Error('This is not an ICO or CUR file.');
  let best = null;
  for (let i = 0, n = buf.readUInt16LE(4); i < n && 6 + 16 * i + 16 <= buf.length; i++) {
    const o = 6 + 16 * i, size = buf.readUInt32LE(o + 8), off = buf.readUInt32LE(o + 12);
    if (size < 40 || off + size > buf.length) continue;
    const data = buf.subarray(off, off + size), area = isPng(data) ? data.readUInt32BE(16) * data.readUInt32BE(20) : data.readInt32LE(4) * (Math.abs(data.readInt32LE(8)) / 2);
    const depth = isPng(data) ? 32 : data.readUInt16LE(14);
    if (!best || area > best.area || (area === best.area && depth > best.depth)) best = { data, area, depth };
  }
  if (!best) throw new Error('The icon file has no readable image.');
  if (isPng(best.data)) return best.data;
  const d = best.data, hs = d.readUInt32LE(0), w = d.readInt32LE(4), h = Math.abs(d.readInt32LE(8)) / 2, bpp = d.readUInt16LE(14), comp = d.readUInt32LE(16);
  if (![1, 4, 8, 24, 32].includes(bpp) || (comp !== 0 && !(comp === 3 && bpp === 32))) throw new Error(`Lime can’t read ${bpp}-bit compressed icon images.`);
  const colours = bpp <= 8 ? d.readUInt32LE(32) || 1 << bpp : 0, stride = ((w * bpp + 31) >> 5) * 4, xor = hs + colours * 4 + (comp === 3 && hs === 40 ? 12 : 0);
  const andAt = xor + stride * h, andStride = ((w + 31) >> 5) * 4, out = Buffer.alloc(w * h * 4);
  let anyAlpha = false;
  for (let y = 0; y < h; y++) {
    const row = xor + (h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let p = bpp === 32 ? row + x * 4 : bpp === 24 ? row + x * 3 : -1;
      if (p < 0) { const bit = x * bpp; p = hs + 4 * ((d[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1)); }
      out[o] = d[p + 2]; out[o + 1] = d[p + 1]; out[o + 2] = d[p];
      out[o + 3] = bpp === 32 ? d[p + 3] : 255;
      if (out[o + 3]) anyAlpha = true;
    }
  }
  if (bpp < 32 || !anyAlpha) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = andAt + (h - 1 - y) * andStride + (x >> 3);
      out[(y * w + x) * 4 + 3] = a < d.length && (d[a] >> (7 - (x & 7))) & 1 ? 0 : 255;
    }
  }
  return png(out, w, h);
}

const ICNS_OUT = [['icp4', 16], ['ic11', 32], ['icp5', 32], ['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024]];
const ICNS_IN = { icp4: 16, ic04: 16, icsb: 18, sb24: 24, icp5: 32, ic11: 32, ic05: 32, icsB: 36, SB24: 48, icp6: 64, ic12: 64, ic07: 128, ic08: 256, ic13: 256, ic09: 512, ic14: 512, ic10: 1024 };
const LEGACY = { is32: [16, 's8mk'], il32: [32, 'l8mk'], ih32: [48, 'h8mk'], it32: [128, 't8mk'] };
const tag = (type, len) => { const b = Buffer.alloc(8); b.write(type, 0, 'latin1'); b.writeUInt32BE(len, 4); return b; };

async function writeIcns(src) {
  const m = await sharp()(src).metadata(), side = Math.max(m.width, m.height), dx = side - m.width, dy = side - m.height;
  const square = await sharp()(src).ensureAlpha().extend({ top: dy >> 1, bottom: dy - (dy >> 1), left: dx >> 1, right: dx - (dx >> 1), background: CLEAR }).png().toBuffer();
  const sizes = new Map();
  for (const [, s] of ICNS_OUT) if (!sizes.has(s)) sizes.set(s, await sharp()(square).resize(s, s, { kernel: 'lanczos3', fit: 'fill' }).ensureAlpha().png({ compressionLevel: 9 }).toBuffer());
  const entries = ICNS_OUT.map(([t, s]) => [t, sizes.get(s)]);
  const toc = Buffer.concat([tag('TOC ', 8 + 8 * entries.length), ...entries.map(([t, d]) => tag(t, 8 + d.length))]);
  const body = Buffer.concat([toc, ...entries.flatMap(([t, d]) => [tag(t, 8 + d.length), d])]);
  return Buffer.concat([tag('icns', 8 + body.length), body]);
}

function unpackBits(src, length) {
  const out = Buffer.alloc(length);
  for (let w = 0, i = 0; w < length && i < src.length;) {
    const c = src[i++];
    if (c < 0x80) { const n = Math.min(c + 1, length - w, src.length - i); src.copy(out, w, i, i + n); i += c + 1; w += n; } else {
      if (i >= src.length) break;
      const v = src[i++], n = Math.min(c - 125, length - w);
      out.fill(v, w, w + n); w += n;
    }
  }
  return out;
}
function legacy(type, data, mask, size) {
  const px = size * size, out = Buffer.alloc(px * 4), raw = data.length === 4 * px;
  const planes = raw ? null : unpackBits(type === 'it32' ? data.subarray(4) : data, 3 * px);
  for (let i = 0; i < px; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = raw ? data[4 * i + 1 + c] : planes[c * px + i];
    out[i * 4 + 3] = mask && mask.length >= px ? mask[i] : 255;
  }
  return out;
}
function argb(data, size) {
  const px = size * size, p = unpackBits(data.subarray(4), 4 * px), out = Buffer.alloc(px * 4);
  for (let i = 0; i < px; i++) { out[i * 4] = p[px + i]; out[i * 4 + 1] = p[2 * px + i]; out[i * 4 + 2] = p[3 * px + i]; out[i * 4 + 3] = p[i]; }
  return out;
}

// Largest decodable image of an ICNS file, as PNG. JPEG 2000 entries go through decodeJp2(buffer) → PNG.
async function readIcns(buf, decodeJp2) {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'icns') throw new Error('Not an ICNS file (the ‘icns’ signature is missing).');
  const end = Math.min(buf.readUInt32BE(4), buf.length), entries = [];
  for (let off = 8; off + 8 <= end;) {
    const len = buf.readUInt32BE(off + 4);
    if (len < 8 || off + len > end) break;
    entries.push({ type: buf.toString('latin1', off, off + 4), data: buf.subarray(off + 8, off + len) });
    off += len;
  }
  const cands = [];
  for (const { type, data } of entries) {
    const size = ICNS_IN[type];
    if (size && (isPng(data) || isJp2(data))) cands.push({ size, data });
    else if (size && data.toString('latin1', 0, 4) === 'ARGB') cands.push({ size, raw: () => argb(data, size) });
    else if (LEGACY[type]) { const [s, mk] = LEGACY[type]; cands.push({ size: s, raw: () => legacy(type, data, entries.find((e) => e.type === mk)?.data, s) }); }
  }
  if (!cands.length) throw new Error('The ICNS file contains no image Lime can read (only 1-bit or 8-bit palette icons).');
  cands.sort((a, b) => b.size - a.size || !!a.raw - !!b.raw);
  for (const c of cands) {
    try {
      if (c.raw) return await png(c.raw(), c.size, c.size);
      return isPng(c.data) ? await sharp()(c.data).png().toBuffer() : await decodeJp2(c.data);
    } catch (_) {}
  }
  throw new Error('No image in the ICNS file could be decoded.');
}

module.exports = { writeIco, writeCur, readIco, writeIcns, readIcns, unpackBits, dib };
