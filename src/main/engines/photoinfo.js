'use strict';
// Photo info: read every tag (exifr), and change or remove EXIF in JPEG, PNG and WebP without
// re-encoding the picture (piexifjs builds the EXIF block; the containers are edited here).
const U = require('./util');
const { fsp, path } = U;

const piexif = () => require('piexifjs');
const exifr = () => require('exifr');
const EDITABLE = ['jpg', 'jpeg', 'png', 'webp'];
const kind = (buf) => (buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg' : buf.readUInt32BE(0) === 0x89504e47 ? 'png' : buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : null);
const bin = (b) => Buffer.from(b).toString('latin1'), buf = (s) => Buffer.from(s, 'latin1');

// JPEG: walk the segments up to the picture data, drop what carries info, keep colour and the scan.
const KEEP_APP = (m, body) => m === 0xe0 || m === 0xee || (m === 0xe2 && body.toString('latin1', 0, 12) === 'ICC_PROFILE\0');
function jpegParts(b) {
  const parts = [];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const m = b[i + 1];
    if (m === 0xd9) break;
    if (m === 0xda) {
      let j = i + 2 + b.readUInt16BE(i + 2);
      while (j + 1 < b.length && !(b[j] === 0xff && b[j + 1] === 0xd9)) j++;
      parts.push({ m, data: b.subarray(i, Math.min(b.length, j + 2)) });
      if (j + 2 < b.length) parts.push({ m: 'tail', data: b.subarray(j + 2) });
      return parts;
    }
    const len = b.readUInt16BE(i + 2);
    parts.push({ m, data: b.subarray(i, i + 2 + len), body: b.subarray(i + 4, i + 2 + len) });
    i += 2 + len;
  }
  parts.push({ m: 0xd9, data: b.subarray(i) });
  return parts;
}
const jpegExif = (b) => { const p = jpegParts(b).find((x) => x.m === 0xe1 && x.body?.toString('latin1', 0, 6) === 'Exif\0\0'); return p ? p.body.subarray(6) : null; };
function jpegWith(b, tiff, strip) {
  // Stripping also drops what follows the picture: extra images and motion-photo video.
  const parts = jpegParts(b).filter((p) => (strip ? !(p.m >= 0xe0 && p.m <= 0xef && !KEEP_APP(p.m, p.body)) && p.m !== 0xfe && p.m !== 'tail' : !(p.m === 0xe1 && p.body?.toString('latin1', 0, 6) === 'Exif\0\0')));
  const app1 = tiff && Buffer.concat([Buffer.from([0xff, 0xe1, 0, 0]), Buffer.from('Exif\0\0', 'latin1'), tiff]);
  if (app1) app1.writeUInt16BE(app1.length - 2, 2);
  const at = Math.max(0, parts.findIndex((p) => p.m !== 0xe0));
  return Buffer.concat([b.subarray(0, 2), ...parts.slice(0, at).map((p) => p.data), ...(app1 ? [app1] : []), ...parts.slice(at).map((p) => p.data)]);
}

const zlib = require('zlib');
function pngChunks(b) {
  const out = [];
  for (let i = 8; i + 8 <= b.length;) { const len = b.readUInt32BE(i), type = b.toString('latin1', i + 4, i + 8); out.push({ type, data: b.subarray(i + 8, i + 8 + len), raw: b.subarray(i, i + 12 + len) }); i += 12 + len; if (type === 'IEND') break; }
  return out;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'latin1'), h = Buffer.alloc(4), c = Buffer.alloc(4);
  h.writeUInt32BE(data.length);
  c.writeUInt32BE(zlib.crc32(data, zlib.crc32(t)) >>> 0);
  return Buffer.concat([h, t, data, c]);
}
const PNG_INFO = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
const pngExif = (b) => pngChunks(b).find((c) => c.type === 'eXIf')?.data || null;
function pngWith(b, tiff, strip) {
  const cs = pngChunks(b).filter((c) => c.type !== 'eXIf' && !(strip && PNG_INFO.has(c.type)));
  const at = cs.findIndex((c) => c.type === 'IDAT');
  const add = tiff ? [pngChunk('eXIf', tiff)] : [];
  return Buffer.concat([b.subarray(0, 8), ...cs.slice(0, at).map((c) => c.raw), ...add, ...cs.slice(at).map((c) => c.raw)]);
}

function webpChunks(b) {
  const out = [];
  for (let i = 12; i + 8 <= b.length;) { const len = b.readUInt32LE(i + 4), type = b.toString('latin1', i, i + 4); out.push({ type, data: b.subarray(i + 8, i + 8 + len) }); i += 8 + len + (len & 1); }
  return out;
}
function webpChunk(type, data) {
  const h = Buffer.alloc(8);
  h.write(type, 0, 'latin1');
  h.writeUInt32LE(data.length, 4);
  return Buffer.concat([h, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
const webpExif = (b) => { const d = webpChunks(b).find((c) => c.type === 'EXIF')?.data; return d ? (d.toString('latin1', 0, 6) === 'Exif\0\0' ? d.subarray(6) : d) : null; };
async function webpWith(b, tiff, strip) {
  let cs = webpChunks(b).filter((c) => c.type !== 'EXIF' && !(strip && c.type === 'XMP '));
  if (!cs.some((c) => c.type === 'VP8X') && tiff) {
    const m = await require('sharp')(b).metadata(), x = Buffer.alloc(10);
    x[0] = m.hasAlpha ? 0x10 : 0;
    x.writeUIntLE(m.width - 1, 4, 3);
    x.writeUIntLE(m.height - 1, 7, 3);
    cs = [{ type: 'VP8X', data: x }, ...cs];
  }
  cs = cs.map((c) => {
    if (c.type !== 'VP8X') return c;
    const d = Buffer.from(c.data);
    d[0] = (d[0] & ~0x08 & (strip ? ~0x04 : 0xff)) | (tiff ? 0x08 : 0);
    return { ...c, data: d };
  });
  const body = Buffer.concat([...cs.map((c) => webpChunk(c.type, c.data)), ...(tiff ? [webpChunk('EXIF', tiff)] : [])]);
  const h = Buffer.alloc(12);
  h.write('RIFF', 0, 'latin1');
  h.writeUInt32LE(body.length + 4, 4);
  h.write('WEBP', 8, 'latin1');
  return Buffer.concat([h, body]);
}

const getExif = (b) => ({ jpg: jpegExif, png: pngExif, webp: webpExif })[kind(b)]?.(b) || null;
const putExif = (b, tiff, strip = false) => ({ jpg: jpegWith, png: pngWith, webp: webpWith })[kind(b)](b, tiff, strip);
const loadDict = (tiff) => { try { return tiff ? piexif().load(`Exif\0\0${bin(tiff)}`) : null; } catch (_) { return null; } };
const dumpDict = (d) => buf(piexif().dump(d)).subarray(6);
const emptyDict = () => ({ '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {}, thumbnail: null });

// Remove every tag, keeping only which way up the picture goes, so it still shows the right way round.
async function strip(p, out) {
  const b = await fsp.readFile(p);
  if (!kind(b)) return null;
  const turn = loadDict(getExif(b))?.['0th']?.[274];
  const keep = turn && turn !== 1 ? dumpDict({ ...emptyDict(), '0th': { 274: turn } }) : null;
  await fsp.writeFile(out, await putExif(b, keep, true));
  return out;
}

// JPG, PNG and WebP lose their tags without being re-encoded; anything else goes the old way.
async function stripTool(p, ctx, other) {
  if (!EDITABLE.includes(U.ext(p)) || !kind(await fsp.readFile(p))) return other();
  const out = ctx.out.file(p, `${U.base(p)}-clean.${U.ext(p) === 'jpeg' ? 'jpg' : U.ext(p)}`);
  await strip(p, out);
  return { path: out, note: 'Removed EXIF, GPS location and camera data · the picture itself is untouched' };
}

const pad = (n) => String(n).padStart(2, '0');
function exifDate(s) {
  const m = /^(\d{4})[-:/.](\d{1,2})[-:/.](\d{1,2})(?:[ T](\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/.exec(String(s).trim());
  if (!m) throw new Error('Write the date as 2024-05-31 or 2024-05-31 14:30.');
  const [, y, mo, d, h = 12, mi = 0, se = 0] = m.map((v, i) => (i && v !== undefined ? Number(v) : v));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) throw new Error('That date isn’t a real date.');
  return `${y}:${pad(mo)}:${pad(d)} ${pad(h)}:${pad(mi)}:${pad(se)}`;
}
function parseGps(s) {
  const nums = String(s).toUpperCase().match(/-?\d+(?:\.\d+)?\s*[NSEW]?/g);
  if (!nums || nums.length !== 2) throw new Error('Write the place as latitude, longitude, like 51.5007, -0.1246.');
  const [lat, lon] = nums.map((v) => { const n = parseFloat(v); return /[SW]/.test(v) ? -Math.abs(n) : n; });
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('That place is off the map: latitude goes to 90 and longitude to 180.');
  return { lat, lon };
}
const dms = (v) => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 10000); return [[d, 1], [m, 1], [s, 10000]]; };

async function edit(p, opts, ctx) {
  const b = await fsp.readFile(p);
  if (!kind(b)) throw new Error(`${path.basename(p)} isn’t a JPG, PNG or WebP. Convert it to one of those first.`);
  const P = piexif(), d = loadDict(getExif(b)) || emptyDict();
  for (const k of ['0th', 'Exif', 'GPS', 'Interop', '1st']) d[k] ||= {};
  const changed = [];
  if (opts.date) { const v = exifDate(opts.date); d['0th'][P.ImageIFD.DateTime] = v; d.Exif[P.ExifIFD.DateTimeOriginal] = v; d.Exif[P.ExifIFD.DateTimeDigitized] = v; changed.push('date'); }
  // EXIF text is bytes; UTF-8 is what readers expect for anything beyond plain ASCII.
  const text = (v) => Buffer.from(String(v), 'utf8').toString('latin1');
  if (opts.author) { d['0th'][P.ImageIFD.Artist] = text(opts.author); changed.push('author'); }
  if (opts.copyright) { d['0th'][P.ImageIFD.Copyright] = text(opts.copyright); changed.push('copyright'); }
  if (opts.noPlace) { d.GPS = {}; delete d['0th'][P.ImageIFD.GPSTag]; changed.push('place removed'); }
  else if (opts.place) {
    const { lat, lon } = parseGps(opts.place);
    d.GPS = { [P.GPSIFD.GPSVersionID]: [2, 3, 0, 0], [P.GPSIFD.GPSLatitudeRef]: lat < 0 ? 'S' : 'N', [P.GPSIFD.GPSLatitude]: dms(lat), [P.GPSIFD.GPSLongitudeRef]: lon < 0 ? 'W' : 'E', [P.GPSIFD.GPSLongitude]: dms(lon) };
    changed.push('place');
  }
  const e = kind(b) === 'jpg' ? 'jpg' : kind(b);
  const out = ctx.out.file(p, `${U.base(p)}-edited.${e}`);
  if (!changed.length) { await fsp.writeFile(out, b); return { path: out, note: 'Nothing filled in to change: saved an unchanged copy' }; }
  let tiff;
  try { tiff = dumpDict(d); } catch (_) {
    // Some cameras write tags piexifjs can't write back; keep the main ones and drop the rest.
    const keep = (ifd, ids) => Object.fromEntries(Object.entries(d[ifd]).filter(([k]) => ids.includes(Number(k))));
    const I = P.ImageIFD, E = P.ExifIFD;
    tiff = dumpDict({ ...emptyDict(), '0th': keep('0th', [I.Make, I.Model, I.Orientation, I.DateTime, I.Artist, I.Copyright, I.Software, I.XResolution, I.YResolution, I.ResolutionUnit]), Exif: keep('Exif', [E.DateTimeOriginal, E.DateTimeDigitized, E.ExposureTime, E.FNumber, E.ISOSpeedRatings, E.FocalLength, E.LensModel]), GPS: d.GPS });
  }
  await fsp.writeFile(out, await putExif(b, tiff));
  return { path: out, note: `Changed ${changed.join(', ')} · the picture itself is untouched` };
}

const SKIP = new Set(['MakerNote', 'UserComment', 'PrintIM', 'ThumbnailOffset', 'ThumbnailLength', 'StripOffsets', 'StripByteCounts', 'ExifIFDPointer', 'GPSInfoIFDPointer', 'InteropIFDPointer', 'ApplicationNotes', 'ImageSourceData']);
const show = (v) => {
  if (v instanceof Date) return Number.isNaN(+v) ? '' : v.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/ 00:00:00$/, '');
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return v.length > 64 ? `${v.length} bytes` : '';
  if (Array.isArray(v)) return v.length > 12 ? `${v.length} values` : v.map(show).join(', ');
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${show(x)}`).join('; ').slice(0, 300);
  return String(v).replace(/\0+$/, '').trim().slice(0, 300);
};
const GROUP = { ifd0: 'Picture', exif: 'Camera', gps: 'Location', iptc: 'IPTC', xmp: 'XMP', icc: 'Colour profile', ihdr: 'PNG', jfif: 'JFIF', ifd1: 'Thumbnail', interop: 'Interop' };
const ICC_KEEP = new Set(['ProfileDescription', 'ProfileCopyright', 'ColorSpaceData', 'ProfileClass']);
async function view(p) {
  const raw = await fsp.readFile(p);
  const img = require('./image'), meta = await (await img.open(p)).metadata().catch(() => ({}));
  let tags = {};
  // exifr doesn't open WebP, but reads the EXIF block on its own.
  const src = kind(raw) === 'webp' ? webpExif(raw) : raw;
  try { if (src) tags = await exifr().parse(src, { tiff: true, ifd1: true, exif: true, gps: true, interop: true, iptc: true, xmp: true, icc: true, jfif: true, ihdr: true, makerNote: false, userComment: false, mergeOutput: false, translateValues: true, reviveValues: true, sanitize: true }) || {}; } catch (_) {}
  const lines = [`File: ${path.basename(p)} · ${U.fmtBytes(raw.length)}`, meta.width ? `Size: ${meta.width} × ${meta.height} px · ${String(meta.format || U.ext(p)).toUpperCase()}${meta.space ? ` · ${meta.space}` : ''}${meta.density ? ` · ${meta.density} dpi` : ''}` : ''];
  let n = 0;
  for (const g of Object.keys(GROUP)) {
    const list = tags[g];
    if (!list || typeof list !== 'object') continue;
    const rows = Object.entries(list).filter(([k, v]) => !SKIP.has(k) && v != null && show(v) !== '' && (g !== 'icc' || ICC_KEEP.has(k)) && !(g === 'gps' && /^(latitude|longitude)$/.test(k))).map(([k, v]) => `  ${k.replace(/([a-z])([A-Z])/g, '$1 $2')}: ${show(v)}`);
    if (!rows.length) continue;
    n += rows.length;
    lines.push('', GROUP[g] || g, ...rows);
  }
  const gps = tags.gps && typeof tags.gps.latitude === 'number' ? `${tags.gps.latitude.toFixed(5)}, ${tags.gps.longitude.toFixed(5)}` : '';
  if (gps) lines.push('', `Map: https://www.openstreetmap.org/?mlat=${tags.gps.latitude.toFixed(5)}&mlon=${tags.gps.longitude.toFixed(5)}`);
  const taken = tags.exif?.DateTimeOriginal || tags.ifd0?.ModifyDate, cam = [tags.ifd0?.Make, tags.ifd0?.Model].filter(Boolean).join(' ');
  const note = n ? [taken && `Taken ${show(taken)}`, cam, gps && `at ${gps}`].filter(Boolean).join(' · ') || `${n} tags` : 'No photo info in this file';
  return { text: lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n').trim(), note };
}

module.exports = { view, edit, strip, stripTool, EDITABLE, getExif, loadDict, kind, exifDate, parseGps };
