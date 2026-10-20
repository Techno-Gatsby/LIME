'use strict';
// HEIC writer: libx265 (bundled FFmpeg) codes 512 px tiles as IDR pictures, then a JS HEIF muxer wraps them in a grid.
// Ported from Filee's HeicWriter, HevcStream and HeifFile (MIT, KnifeLemon).
const U = require('./util');
const { fsp, path } = U;

const TILE = 512;
const layout = (w, h) => (w <= TILE && h <= TILE
  ? { cols: 1, rows: 1, tw: (w + 1) & ~1, th: (h + 1) & ~1 }
  : { cols: Math.ceil(w / TILE), rows: Math.ceil(h / TILE), tw: TILE, th: TILE });
const crf = (q) => U.clamp(Math.round(50 - 0.4 * U.clamp(Number(q) || 80, 1, 100)), 0, 51);

function ffArgs(w, h, q, out) {
  const { cols, rows, tw, th } = layout(w, h), pw = cols * tw, ph = rows * th, f = [];
  if (pw !== w || ph !== h) f.push(`pad=${pw}:${ph}:0:0`, `fillborders=right=${pw - w}:bottom=${ph - h}:mode=smear`);
  f.push('scale=out_color_matrix=bt601:out_range=pc', 'format=yuv420p');
  if (cols * rows > 1) f.push(`untile=${cols}x${rows}`);
  return ['-hide_banner', '-nostdin', '-nostats', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', 'pipe:0',
    '-vf', f.join(','), '-c:v', 'libx265', '-preset', 'medium', '-crf', String(crf(q)), '-force_key_frames', 'expr:1', '-forced-idr', '1',
    '-x265-params', 'bframes=0:open-gop=0:info=0:range=full:colormatrix=smpte170m:log-level=error', '-f', 'hevc', out];
}

function units(d) {
  const s = [];
  for (let i = 0; i + 2 < d.length; i++) if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1) { s.push(i + 3); i += 2; }
  const u = [];
  for (let k = 0; k < s.length; k++) {
    let e = k + 1 < s.length ? s[k + 1] - 3 : d.length;
    while (e > s[k] && d[e - 1] === 0) e--;
    if (e - s[k] >= 3) u.push(d.subarray(s[k], e));
  }
  return u;
}
function unescape(b) {
  const r = [];
  let z = 0;
  for (const x of b) { if (z >= 2 && x === 3) { z = 0; continue; } r.push(x); z = x === 0 ? z + 1 : 0; }
  return Buffer.from(r);
}
function bitReader(buf) {
  let p = 0;
  const read = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++, p++) { if ((p >> 3) >= buf.length) throw new Error('The HEVC SPS is truncated.'); v = (v << 1) | ((buf[p >> 3] >> (7 - (p & 7))) & 1); }
    return v >>> 0;
  };
  const ue = () => { let z = 0; while (read(1) === 0) if (++z > 30) throw new Error('The HEVC SPS is malformed.'); return (1 << z) - 1 + read(z); };
  return { read, ue };
}
function spsInfo(sps) {
  const b = bitReader(unescape(sps.subarray(2)));
  b.read(4);
  const sub = b.read(3), nested = b.read(1) === 1;
  if (sub) throw new Error('HEVC temporal sub-layers are not supported.');
  const ptl = Buffer.alloc(12);
  for (let i = 0; i < 12; i++) ptl[i] = b.read(8);
  b.ue();
  const chroma = b.ue();
  if (chroma === 3) b.read(1);
  b.ue(); b.ue();
  if (b.read(1)) for (let i = 0; i < 4; i++) b.ue();
  return { ptl, chroma, luma: b.ue() + 8, chromaDepth: b.ue() + 8, layers: sub + 1, nested };
}
function parseHevc(d) {
  let vps, sps, pps;
  const pics = [];
  const same = (k, u) => { if (k && !k.equals(u)) throw new Error('The HEVC stream changes its parameter sets.'); return u; };
  for (const u of units(d)) {
    const t = (u[0] >> 1) & 0x3f;
    if (t === 32) vps = same(vps, u); else if (t === 33) sps = same(sps, u); else if (t === 34) pps = same(pps, u);
    else if (t < 19 || (t > 20 && t < 32)) throw new Error(`The HEVC stream is not an IDR picture (NAL unit type ${t}).`);
    else if (t < 32) { if ((u[2] & 0x80) || !pics.length) pics.push([]); pics[pics.length - 1].push(u); }
  }
  if (!vps || !sps || !pps || !pics.length) throw new Error('The HEVC stream has no parameter sets or no picture.');
  const i = spsInfo(sps);
  const parts = [Buffer.from([1]), i.ptl, Buffer.from([0xf0, 0x00, 0xfc, 0xfc | i.chroma, 0xf8 | (i.luma - 8), 0xf8 | (i.chromaDepth - 8), 0, 0, (i.layers << 3) | (i.nested ? 4 : 0) | 3, 3])];
  for (const [t, u] of [[32, vps], [33, sps], [34, pps]]) { const h = Buffer.alloc(5); h[0] = 0x80 | t; h.writeUInt16BE(1, 1); h.writeUInt16BE(u.length, 3); parts.push(h, u); }
  const lp = (us) => Buffer.concat(us.flatMap((u) => [u32(u.length), u]));
  return { config: Buffer.concat(parts), pictures: pics.map(lp), depth: i.luma };
}

const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
const box = (type, ...p) => { const body = Buffer.concat(p); return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]); };
const fbox = (type, v, f, ...p) => box(type, u32(((v << 24) | f) >>> 0), ...p);
const tiffAt = (e) => { for (let i = 0; i + 3 < e.length && i < 16; i++) if ((e[i] === 0x49 && e[i + 1] === 0x49 && e[i + 2] === 42 && e[i + 3] === 0) || (e[i] === 0x4d && e[i + 1] === 0x4d && e[i + 2] === 0 && e[i + 3] === 42)) return i; return -1; };
function exifPayload(e) { const t = e ? tiffAt(e) : -1; return t < 0 ? null : Buffer.concat([u32(t), e]); }

// Pixels are upright now: Orientation → 1, and IFD1 (the thumbnail, still in the old orientation) is unlinked.
function patchExif(buf) {
  const t = tiffAt(buf);
  if (t < 0) return buf;
  const b = Buffer.from(buf), le = b[t] === 0x49;
  const r16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)), r32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const ifd0 = t + r32(t + 4);
  if (ifd0 + 2 > b.length) return b;
  const n = r16(ifd0);
  if (ifd0 + 6 + 12 * n > b.length) return b;
  for (let k = 0; k < n; k++) { const e = ifd0 + 2 + 12 * k; if (r16(e) === 0x0112) le ? b.writeUInt16LE(1, e + 8) : b.writeUInt16BE(1, e + 8); }
  b.writeUInt32BE(0, ifd0 + 2 + 12 * n);
  return b;
}

function writeHeif({ w, h, hevc, tw, th, cols, rows, icc, exif }) {
  const tiles = hevc.pictures;
  if (tiles.length !== cols * rows) throw new Error(`${tiles.length} coded pictures for ${cols} × ${rows} tiles.`);
  if (cols > 256 || rows > 256) throw new Error('A HEIF grid holds at most 256 × 256 tiles.');
  const grid = cols * rows > 1 || tw !== w || th !== h;
  const tileIds = grid ? tiles.map((_, i) => 2 + i) : [1];
  const ex = exifPayload(exif), exifId = ex ? tileIds[tileIds.length - 1] + 1 : 0;
  const items = [];
  if (grid) { const wide = w > 65535 || h > 65535; items.push([1, Buffer.concat([Buffer.from([0, wide ? 1 : 0, rows - 1, cols - 1]), ...(wide ? [u32(w), u32(h)] : [u16(w), u16(h)])])]); }
  tileIds.forEach((id, i) => items.push([id, tiles[i]]));
  if (ex) items.push([exifId, ex]);
  const ftyp = box('ftyp', Buffer.from('heic'), u32(0), Buffer.from('mif1heic'));
  const d = hevc.depth;
  const props = [box('hvcC', hevc.config), fbox('ispe', 0, 0, u32(tw), u32(th)), fbox('pixi', 0, 0, Buffer.from([3, d, d, d])),
    icc ? box('colr', Buffer.from('prof'), icc) : box('colr', Buffer.from('nclx'), u16(1), u16(13), u16(6), Buffer.from([0x80]))];
  const assoc = [];
  if (grid) {
    props.push(fbox('ispe', 0, 0, u32(w), u32(h)));
    assoc.push([1, [[5, 0], [3, 0], [4, 0]]]);
    for (const id of tileIds) assoc.push([id, [[1, 1], [2, 0]]]);
  } else assoc.push([1, [[1, 1], [2, 0], [3, 0], [4, 0]]]);
  const iprp = box('iprp', box('ipco', ...props), fbox('ipma', 0, 0, u32(assoc.length),
    ...assoc.map(([id, l]) => Buffer.concat([u16(id), Buffer.from([l.length, ...l.map(([ix, e]) => (e ? 0x80 : 0) | ix)])]))));
  const meta = (off) => fbox('meta', 0, 0,
    fbox('hdlr', 0, 0, u32(0), Buffer.from('pict'), Buffer.alloc(12), Buffer.from([0])),
    box('dinf', fbox('dref', 0, 0, u32(1), fbox('url ', 0, 1))),
    fbox('pitm', 0, 0, u16(1)),
    fbox('iloc', 0, 0, Buffer.from([0x44, 0x00]), u16(items.length), ...items.map(([id, b]) => Buffer.concat([u16(id), u16(0), u16(1), u32(off[id] || 0), u32(b.length)]))),
    fbox('iinf', 0, 0, u16(items.length), ...items.map(([id]) => fbox('infe', 2, grid && id !== 1 && id !== exifId ? 1 : 0,
      u16(id), u16(0), Buffer.from(id === exifId ? 'Exif' : id === 1 && grid ? 'grid' : 'hvc1'), Buffer.from([0])))),
    ...(grid || exifId ? [fbox('iref', 0, 0,
      ...(grid ? [box('dimg', u16(1), u16(tileIds.length), ...tileIds.map(u16))] : []),
      ...(exifId ? [box('cdsc', u16(exifId), u16(1), u16(1))] : []))] : []),
    iprp);
  const off = {};
  let at = ftyp.length + meta(off).length + 8;
  for (const [id, b] of items) { off[id] = at; at += b.length; }
  if (at > 0xffffffff) throw new Error('The picture is too large for a HEIC file.');
  const head = meta(off);
  return Buffer.concat([ftyp, head, u32(at - ftyp.length - head.length), Buffer.from('mdat'), ...items.map(([, b]) => b)]);
}

// rgb: 8-bit RGB pixels, upright and without alpha.
async function encode(rgb, w, h, { quality = 80, icc = null, exif = null } = {}) {
  const dir = await U.tmpDir('heic');
  try {
    const hevcPath = path.join(dir, 'tiles.hevc');
    await U.run(U.binPath('ffmpeg'), ffArgs(w, h, quality, hevcPath), { input: rgb, errorMessage: 'Couldn’t encode HEIC' });
    const L = layout(w, h);
    return writeHeif({ w, h, hevc: parseHevc(await fsp.readFile(hevcPath)), ...L, icc, exif });
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { layout, crf, ffArgs, units, parseHevc, exifPayload, patchExif, writeHeif, encode };
