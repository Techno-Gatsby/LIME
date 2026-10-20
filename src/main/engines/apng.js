'use strict';
// Animated PNG reader and writer, ported from Filee's Apng (MIT, KnifeLemon).
// Animations are { width, height, loop, frames: [{ data: RGBA full canvas, delay: ms }] }.
const zlib = require('zlib');
const { fsp } = require('./util');

const sharp = () => require('./image').sharp();
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NONE = Buffer.alloc(0);

function chunk(type, data) {
  const t = Buffer.from(type, 'latin1'), head = Buffer.alloc(4), crc = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([head, t, data, crc]);
}
function chunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('The file is not a PNG image.');
  const out = [];
  for (let p = 8; p + 12 <= buf.length;) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    if (len > buf.length - p - 12) throw new Error('The PNG file is damaged (a chunk runs past the end).');
    out.push({ type, data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

async function isAnimated(p) {
  let fh;
  try {
    fh = await fsp.open(p, 'r');
    const h = Buffer.alloc(8);
    if ((await fh.read(h, 0, 8, 0)).bytesRead < 8 || !h.equals(SIG)) return false;
    for (let pos = 8; ;) {
      if ((await fh.read(h, 0, 8, pos)).bytesRead < 8) return false;
      const len = h.readUInt32BE(0), type = h.toString('latin1', 4, 8);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND' || len > 0x7fffffff) return false;
      pos += 12 + len;
    }
  } catch (_) { return false; } finally { await fh?.close(); }
}

function frameControl(d, W, H) {
  if (d.length !== 26) throw new Error('The APNG file is damaged (fcTL chunk).');
  const f = { w: d.readUInt32BE(4), h: d.readUInt32BE(8), x: d.readUInt32BE(12), y: d.readUInt32BE(16), num: d.readUInt16BE(20), den: d.readUInt16BE(22), dispose: d[24], blend: d[25], parts: [] };
  if (!f.w || !f.h || f.x + f.w > W || f.y + f.h > H || f.dispose > 2 || f.blend > 1) throw new Error('The APNG file is damaged (a frame lies outside the picture).');
  return f;
}
function paste(canvas, W, pic, f) {
  if (!f.blend) { for (let y = 0; y < f.h; y++) pic.copy(canvas, ((f.y + y) * W + f.x) * 4, y * f.w * 4, (y + 1) * f.w * 4); return; }
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const s = (y * f.w + x) * 4, d = ((f.y + y) * W + f.x + x) * 4, sa = pic[s + 3] / 255;
      if (sa === 1) { pic.copy(canvas, d, s, s + 4); continue; }
      if (!sa) continue;
      const da = canvas[d + 3] / 255, ao = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) canvas[d + c] = Math.round((pic[s + c] * sa + canvas[d + c] * da * (1 - sa)) / ao);
      canvas[d + 3] = Math.round(ao * 255);
    }
  }
}

// Returns null for a still PNG. Frames come back composed onto the full canvas.
async function read(buf, max = Infinity) {
  const cs = chunks(buf);
  if (cs[0]?.type !== 'IHDR' || cs[0].data.length !== 13) throw new Error('The file is not a PNG image or is damaged.');
  const ihdr = cs[0].data, W = ihdr.readUInt32BE(0), H = ihdr.readUInt32BE(4);
  const ac = cs.find((c) => c.type === 'acTL');
  if (!ac || ac.data.length !== 8) return null;
  const all = [], shared = [];
  let cur = null, seen = false;
  for (const c of cs.slice(1)) {
    if (c.type === 'fcTL') all.push(cur = frameControl(c.data, W, H));
    else if (c.type === 'IDAT') { seen = true; cur?.parts.push(c.data); }
    else if (c.type === 'fdAT') { if (c.data.length < 4 || !cur) throw new Error('The APNG file is damaged (fdAT chunk).'); cur.parts.push(c.data.subarray(4)); }
    else if (c.type !== 'IEND' && c.type !== 'acTL' && !seen) shared.push(chunk(c.type, c.data));
  }
  const list = all.filter((f) => f.parts.some((d) => d.length));
  if (!list.length) throw new Error('The APNG file has no frames.');
  const canvas = Buffer.alloc(W * H * 4), frames = [];
  for (let i = 0; i < Math.min(list.length, max); i++) {
    const f = list[i], head = Buffer.from(ihdr);
    head.writeUInt32BE(f.w, 0); head.writeUInt32BE(f.h, 4);
    const png = Buffer.concat([SIG, chunk('IHDR', head), ...shared, chunk('IDAT', Buffer.concat(f.parts)), chunk('IEND', NONE)]);
    const pic = await sharp()(png).ensureAlpha().toColourspace('srgb').raw({ depth: 'uchar' }).toBuffer();
    const dispose = i === 0 && f.dispose === 2 ? 1 : f.dispose, saved = dispose === 2 ? Buffer.from(canvas) : null;
    paste(canvas, W, pic, f);
    frames.push({ data: Buffer.from(canvas), delay: f.den ? (f.num * 1000) / f.den : f.num * 10 });
    if (dispose === 1) for (let y = 0; y < f.h; y++) canvas.fill(0, ((f.y + y) * W + f.x) * 4, ((f.y + y) * W + f.x + f.w) * 4);
    else if (saved) saved.copy(canvas);
  }
  return { width: W, height: H, loop: ac.data.readUInt32BE(4), frames };
}

function changedRegion(a, b, W, H) {
  const stride = W * 4;
  let top = -1, bottom = -1, left = W, right = -1;
  for (let y = 0; y < H; y++) {
    const ra = a.subarray(y * stride, (y + 1) * stride), rb = b.subarray(y * stride, (y + 1) * stride);
    if (ra.equals(rb)) continue;
    if (top < 0) top = y;
    bottom = y;
    let k = 0;
    while (k < stride && ra[k] === rb[k]) k++;
    const first = (k / 4) | 0;
    let last = W - 1;
    while (last > first && ra.compare(rb, last * 4, last * 4 + 4, last * 4, last * 4 + 4) === 0) last--;
    left = Math.min(left, first); right = Math.max(right, last);
  }
  return top < 0 ? { x: 0, y: 0, w: 1, h: 1 } : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}
function fitDelay(n, d) { while (n > 65535 || d > 65535) { n = Math.floor((n + 1) / 2); d = Math.max(1, Math.floor((d + 1) / 2)); } return [n, d]; }

// Each frame after the first stores only the rectangle that changed (dispose NONE, blend SOURCE).
async function write({ width: W, height: H, loop = 0, frames }) {
  let alpha = false;
  for (const f of frames) for (let i = 3; i < f.data.length && !alpha; i += 4) if (f.data[i] !== 255) alpha = true;
  const pics = [];
  for (const f of frames) {
    const last = pics[pics.length - 1], ms = Math.max(0, Math.round(f.delay));
    if (last && last.data.equals(f.data)) last.num += ms; else pics.push({ data: f.data, num: ms });
  }
  const out = [SIG];
  let seq = 0, ihdr;
  for (let i = 0; i < pics.length; i++) {
    const r = i === 0 ? { x: 0, y: 0, w: W, h: H } : changedRegion(pics[i - 1].data, pics[i].data, W, H);
    const part = await sharp()(pics[i].data, { raw: { width: W, height: H, channels: 4 }, limitInputPixels: false })
      .extract({ left: r.x, top: r.y, width: r.w, height: r.h })[alpha ? 'ensureAlpha' : 'removeAlpha']().png({ compressionLevel: 9 }).toBuffer();
    const cs = chunks(part), data = Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data));
    if (i === 0) {
      ihdr = cs[0].data;
      out.push(chunk('IHDR', ihdr));
      for (const c of cs.slice(1)) { if (c.type === 'IDAT') break; out.push(chunk(c.type, c.data)); }
      const ac = Buffer.alloc(8);
      ac.writeUInt32BE(pics.length); ac.writeUInt32BE(loop, 4);
      out.push(chunk('acTL', ac));
    } else if (!cs[0].data.subarray(8).equals(ihdr.subarray(8))) throw new Error('APNG frames were encoded with different pixel formats.');
    const [n, d] = fitDelay(pics[i].num, 1000), fc = Buffer.alloc(26);
    fc.writeUInt32BE(seq++); fc.writeUInt32BE(r.w, 4); fc.writeUInt32BE(r.h, 8); fc.writeUInt32BE(r.x, 12); fc.writeUInt32BE(r.y, 16);
    fc.writeUInt16BE(n, 20); fc.writeUInt16BE(d, 22);
    out.push(chunk('fcTL', fc));
    for (let off = 0; off === 0 || off < data.length; off += 1 << 20) {
      const piece = data.subarray(off, off + (1 << 20));
      if (i === 0) out.push(chunk('IDAT', piece));
      else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++); out.push(chunk('fdAT', Buffer.concat([s, piece]))); }
    }
  }
  out.push(chunk('IEND', NONE));
  return Buffer.concat(out);
}

module.exports = { SIG, chunk, chunks, isAnimated, read, write, changedRegion, fitDelay };
