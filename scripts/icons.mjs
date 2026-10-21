import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'build'), assets = path.join(root, 'src', 'renderer', 'assets');
fs.mkdirSync(out, { recursive: true });

const squircle = (s, inset, n = 5) => {
  const r = (s - inset * 2) / 2, c = s / 2;
  const pts = [];
  for (let i = 0; i < 360; i++) {
    const t = (i / 360) * Math.PI * 2, ct = Math.cos(t), st = Math.sin(t);
    pts.push(`${(c + Math.sign(ct) * Math.abs(ct) ** (2 / n) * r).toFixed(2)},${(c + Math.sign(st) * Math.abs(st) ** (2 / n) * r).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
};

const SRC = ['png', 'jpg', 'jpeg', 'webp'].map((e) => path.join(out, `lime-source.${e}`)).find((f) => fs.existsSync(f));
if (!SRC) throw new Error('Put the lime photo at build/lime-source.png (or .jpg/.webp).');
async function fruit(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info, n = W * H;
  if (data[3] > 16) {
    const bg = new Uint8Array(n), stack = [];
    const white = (i) => data[i * 4] > 228 && data[i * 4 + 1] > 228 && data[i * 4 + 2] > 228;
    for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
    while (stack.length) {
      const i = stack.pop();
      if (bg[i] || !white(i)) continue;
      bg[i] = 1;
      const x = i % W;
      if (x > 0) stack.push(i - 1);
      if (x < W - 1) stack.push(i + 1);
      if (i >= W) stack.push(i - W);
      if (i < n - W) stack.push(i + W);
    }
    for (let i = 0; i < n; i++) if (bg[i]) data[i * 4 + 3] = 0;
  }
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] > 24) { const x = i % W, y = (i - x) / W; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const side = Math.max(x1 - x0, y1 - y0) + 3, pad = side;
  const padded = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp(padded).extract({ left: Math.round((x0 + x1 - side) / 2) + pad, top: Math.round((y0 + y1 - side) / 2) + pad, width: side, height: side }).png().toBuffer();
}
const lime = await fruit(SRC);
const at = (px) => { const r = sharp(lime).resize(px, px, { kernel: 'lanczos3' }); return (px <= 384 ? r.sharpen({ sigma: 0.5, m1: 0.6, m2: 2 }) : r).png().toBuffer(); };
const shadow = (size, x, y, d, blur, dy, opacity) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="${blur}"/><feOffset dy="${dy}"/><feComponentTransfer><feFuncA type="linear" slope="${opacity}"/></feComponentTransfer></filter></defs><image href="data:image/png;base64,${lime.toString('base64')}" x="${x}" y="${y}" width="${d}" height="${d}" filter="url(#s)"/></svg>`)).png().toBuffer();
const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef4e4"/></linearGradient>
  <filter id="ish" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity=".22"/></filter></defs>
  <path d="${squircle(1024, 100)}" fill="url(#bg)" filter="url(#ish)"/><path d="${squircle(1024, 100)}" fill="none" stroke="#ffffff" stroke-opacity=".9" stroke-width="2"/></svg>`);
const tray = (s, color = '#000') => {
  const spokes = Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return `M${(9 + 2 * Math.sin(a)).toFixed(2)} ${(9 - 2 * Math.cos(a)).toFixed(2)}L${(9 + 5.4 * Math.sin(a)).toFixed(2)} ${(9 - 5.4 * Math.cos(a)).toFixed(2)}`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.6" fill="none" stroke="${color}" stroke-width="1.5"/><path d="${spokes}" stroke="${color}" stroke-width="1.3" stroke-linecap="round"/><circle cx="9" cy="9" r="1" fill="${color}"/></svg>`;
};

const png = (svg, file, size) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(path.join(out, file));

async function icon(s, mac) {
  const k = s / 1024, [d, x, y, blur, dy, opacity] = mac ? [704, 160, 160, 9, 8, 0.26] : [944, 40, 30, 10, 10, 0.28];
  const D = Math.round(d * k), X = Math.round(x * k), Y = Math.round(y * k);
  const base = mac ? sharp(plate, { density: 72 * k }).resize(s, s) : sharp({ create: { width: s, height: s, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  return base.composite([{ input: await shadow(s, X, Y, D, blur * k, dy * k, opacity) }, { input: await at(D), left: X, top: Y }]).png().toBuffer();
}
fs.writeFileSync(path.join(out, 'icon.png'), await icon(1024, true));
fs.writeFileSync(path.join(out, 'icon-win.png'), await icon(1024, false));
for (const [file, px] of [['logo.png', 512], ['tray.png', 32], ['drag.png', 64], ['drag@2x.png', 128]]) fs.writeFileSync(path.join(out, file), await at(px));
await png(tray(18), 'trayTemplate.png', 18);
await png(tray(36), 'trayTemplate@2x.png', 36);
for (const size of [52, 96]) for (const k of [1, 2, 3, 4]) fs.writeFileSync(path.join(assets, `lime-${size}${k > 1 ? `@${k}x` : ''}.png`), await at(size * k));

const icns = async () => {
  const types = [['icp4', 16], ['icp5', 32], ['ic11', 32], ['icp6', 64], ['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024]];
  const chunks = [];
  for (const [t, s] of types) {
    const data = await icon(s, true);
    const head = Buffer.alloc(8);
    head.write(t, 0, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    chunks.push(head, data);
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(path.join(out, 'icon.icns'), Buffer.concat([head, body]));
};
const ico = async (draw, sizes, file) => {
  const imgs = await Promise.all(sizes.map(draw));
  const head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = head.length;
  imgs.forEach((b, i) => {
    const o = 6 + i * 16, s = sizes[i];
    head.writeUInt8(s >= 256 ? 0 : s, o); head.writeUInt8(s >= 256 ? 0 : s, o + 1);
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(b.length, o + 8); head.writeUInt32LE(off, o + 12);
    off += b.length;
  });
  fs.writeFileSync(path.join(out, file), Buffer.concat([head, ...imgs]));
};
await icns();

await ico((s) => icon(s, false), [16, 24, 32, 48, 64, 128, 256], 'icon.ico');
await ico(at, [16, 20, 24, 32, 40, 48, 64], 'tray.ico');
console.log('icons written to', out);
