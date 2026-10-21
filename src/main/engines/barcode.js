'use strict';
// QR codes and barcodes: read with ZXing (WebAssembly), make with bwip-js.
const U = require('./util');
const { fs, fsp, path } = U;

let ready = null;
function zxing() {
  if (!ready) {
    const Z = require('zxing-wasm/reader');
    Z.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')).buffer }, fireImmediately: true });
    ready = Z;
  }
  return ready;
}
const NAMES = { QRCode: 'QR code', MicroQRCode: 'Micro QR code', RMQRCode: 'rMQR code', DataMatrix: 'Data Matrix', PDF417: 'PDF417', Aztec: 'Aztec', MaxiCode: 'MaxiCode', EAN13: 'EAN-13', EAN8: 'EAN-8', UPCA: 'UPC-A', UPCE: 'UPC-E', Code128: 'Code 128', Code39: 'Code 39', Code93: 'Code 93', Codabar: 'Codabar', ITF: 'ITF', DataBar: 'GS1 DataBar', DataBarExpanded: 'GS1 DataBar Expanded', DXFilmEdge: 'DX film edge' };

async function scan(data, width, height) {
  const r = await zxing().readBarcodes({ data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height, colorSpace: 'srgb' }, { tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 255 });
  return r.filter((x) => x.isValid && x.text !== '');
}
async function rgbaOf(s, max = 3000) {
  return s.resize(max, max, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
// Every code in every picture or PDF page, in reading order, duplicates dropped.
async function read(files, opts, ctx) {
  const found = [], seen = new Set();
  const add = (r, where) => { const key = `${r.format}\n${r.text}`; if (seen.has(key)) return; seen.add(key); found.push({ kind: NAMES[r.format] || r.format, text: r.text, where }); };
  for (let i = 0; i < files.length; i++) {
    const f = files[i], label = files.length > 1 ? path.basename(f) : '';
    ctx?.progress?.(i / files.length, 'Looking for codes');
    if (U.ext(f) === 'pdf') {
      const { doc, m } = await require('./pdf').readPdf(f, opts.password);
      const n = Math.min(doc.countPages(), 200);
      for (let p = 0; p < n; p++) {
        ctx?.progress?.((i + p / n) / files.length, `Page ${p + 1} of ${n}`);
        const pix = doc.loadPage(p).toPixmap(m.Matrix.scale(2, 2), m.ColorSpace.DeviceRGB, true);
        const { data, info } = await rgbaOf(require('sharp')(Buffer.from(pix.getPixels()), { raw: { width: pix.getWidth(), height: pix.getHeight(), channels: 4 } }));
        for (const r of await scan(data, info.width, info.height)) add(r, [label, `page ${p + 1}`].filter(Boolean).join(', '));
      }
    } else {
      const s = (await require('./image').open(f)).rotate();
      const { data, info } = await rgbaOf(s);
      for (const r of await scan(data, info.width, info.height)) add(r, label);
    }
  }
  if (!found.length) return { note: 'No QR code or barcode found', text: '' };
  const text = found.map((x) => (found.length > 1 || x.where ? `${x.kind}${x.where ? ` (${x.where})` : ''}:\n${x.text}` : x.text)).join('\n\n');
  return { text, note: found.length === 1 ? `${found[0].kind}: ${found[0].text.replace(/\s+/g, ' ').slice(0, 80)}` : `${found.length} codes found` };
}

// Payloads phones understand: WIFI: for networks, MECARD-free vCard 3.0 for contacts.
const esc = (s) => String(s || '').replace(/([\\;,:"])/g, '\\$1');
const vesc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([;,])/g, '\\$1');
function payload(o) {
  if (o.kind === 'wifi') {
    if (!o.ssid) throw new Error('Enter the network name.');
    const t = o.security === 'none' ? 'nopass' : o.security || 'WPA';
    return `WIFI:T:${t};S:${esc(o.ssid)};${t === 'nopass' ? '' : `P:${esc(o.password)};`}${o.hidden ? 'H:true;' : ''};`;
  }
  if (o.kind === 'contact') {
    if (!o.name && !o.phone && !o.email) throw new Error('Enter a name, phone number or email.');
    const parts = String(o.name || '').trim().split(/\s+/), last = parts.length > 1 ? parts.pop() : '', first = parts.join(' ');
    return ['BEGIN:VCARD', 'VERSION:3.0', `N:${vesc(last)};${vesc(first)};;;`, `FN:${vesc(o.name || o.email || o.phone)}`, o.org && `ORG:${vesc(o.org)}`, o.phone && `TEL;TYPE=CELL:${vesc(o.phone)}`, o.email && `EMAIL:${vesc(o.email)}`, o.url && `URL:${vesc(o.url)}`, 'END:VCARD'].filter(Boolean).join('\r\n');
  }
  const t = String(o.text || '');
  if (!t) throw new Error('Enter the text or link to put in the code.');
  return t;
}
const BCID = { qr: 'qrcode', code128: 'code128', ean13: 'ean13', upca: 'upca', datamatrix: 'datamatrix', pdf417: 'pdf417', aztec: 'azteccode', code39: 'code39' };
const TWO_D = new Set(['qr', 'datamatrix', 'aztec', 'pdf417']);
function options(o) {
  const type = o.kind === 'text' ? o.type || 'qr' : 'qr', two = TWO_D.has(type);
  const fg = String(o.color || '#000000').replace('#', ''), bg = o.transparent ? null : String(o.background || '#ffffff').replace('#', '');
  return { bcid: BCID[type] || 'qrcode', text: payload(o), scale: two ? Math.max(1, Math.min(40, Number(o.scale) || 10)) : Math.max(2, Math.round((Number(o.scale) || 10) * 0.4)), ...(two ? {} : { height: 15, includetext: true, textxalign: 'center' }),
    ...(type === 'qr' ? { eclevel: o.ec || 'M' } : {}), padding: two ? 4 : 10, barcolor: fg, textcolor: fg, ...(bg ? { backgroundcolor: bg } : {}) };
}
// Link files (.url, .webloc) give their address; anything else its text, trimmed.
async function fileText(f) {
  const t = (await fsp.readFile(f, 'utf8')).replace(/^\uFEFF/, '');
  const url = U.ext(f) === 'url' ? /^URL=(.+)$/m.exec(t)?.[1] : U.ext(f) === 'webloc' ? /<string>([^<]+)<\/string>/.exec(t)?.[1] : null;
  return (url || t).trim();
}
async function make(f, opts, ctx) {
  if ((opts.kind || 'file') === 'file') {
    opts = { ...opts, kind: 'text', text: await fileText(f) };
    if (!opts.text) throw new Error(`${path.basename(f)} is empty.`);
    if (opts.text.length > 2900) throw new Error('That’s too much text for one QR code (it holds about 2,900 letters).');
  }
  const bwip = require('bwip-js'), o = options(opts), svg = opts.format === 'svg';
  let data;
  try { data = svg ? Buffer.from(bwip.toSVG(o)) : await bwip.toBuffer(o); } catch (e) { throw new Error(`That can’t go in this kind of code: ${String(e.message || e).replace(/^bwipp?\.\w+#?\d*:\s*/i, '')}`); }
  const stem = opts.kind === 'wifi' ? `Wi-Fi ${opts.ssid}` : opts.kind === 'contact' ? `Contact ${opts.name || opts.email || opts.phone}` : `${U.base(f)} - ${opts.type && opts.type !== 'qr' ? 'barcode' : 'QR'}`;
  const out = ctx.out.file(f, `${U.sanitize(stem)}.${svg ? 'svg' : 'png'}`);
  await fsp.writeFile(out, data);
  return { path: out, note: `${{ qrcode: 'QR code', azteccode: 'Aztec code', datamatrix: 'Data Matrix', pdf417: 'PDF417' }[o.bcid] || o.bcid.toUpperCase()} · ${svg ? 'SVG' : 'PNG'}` };
}

module.exports = { read, make, payload, scan };
