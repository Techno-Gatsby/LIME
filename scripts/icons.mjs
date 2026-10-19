import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { petal } from '../src/renderer/petal.js';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'build');
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
const slice = (cx, cy, R) => {
  const k = R / 60;
  const segs = Array.from({ length: 10 }, (_, i) => `<path d="${petal(i, 10, 6.5, 47.8, 3, 7.5, 1.4)}"/>`).join('');
  return `<g transform="translate(${cx} ${cy}) scale(${k})">
    <circle r="60" fill="url(#rind)"/>
    <circle r="60" fill="none" stroke="url(#rimHi)" stroke-width="1.2"/>
    <circle r="54" fill="url(#pith)"/>
    <g fill="url(#pulp)">${segs}</g>
    <g fill="url(#gloss)" opacity=".55">${segs}</g>
    <circle r="3.4" fill="#f6fbe6"/>
  </g>`;
};
const defs = `<defs>
  <linearGradient id="rind" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#93d34b"/><stop offset=".55" stop-color="#5daa2a"/><stop offset="1" stop-color="#357f18"/></linearGradient>
  <linearGradient id="rimHi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8f5a0" stop-opacity=".9"/><stop offset=".5" stop-color="#d8f5a0" stop-opacity="0"/></linearGradient>
  <radialGradient id="pith" r=".55"><stop offset=".85" stop-color="#f7fce8"/><stop offset="1" stop-color="#e3f2bf"/></radialGradient>
  <radialGradient id="pulp" r=".62"><stop offset="0" stop-color="#eef9c2"/><stop offset=".55" stop-color="#c9e979"/><stop offset="1" stop-color="#9ccf45"/></radialGradient>
  <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".7"/><stop offset=".45" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e9f1dc"/></linearGradient>
  <filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#29520c" flood-opacity=".32"/></filter>
  <filter id="ish" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity=".22"/></filter>
</defs>`;
const appIcon = (s = 1024) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 1024 1024">${defs}
  <path d="${squircle(1024, 100)}" fill="url(#bg)" filter="url(#ish)"/>
  <path d="${squircle(1024, 100)}" fill="none" stroke="#ffffff" stroke-opacity=".9" stroke-width="2"/>
  <g filter="url(#sh)">${slice(512, 512, 300)}</g>
</svg>`;
const logo = (s = 512) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 128 128">${defs}${slice(64, 64, 62)}</svg>`;
const tray = (s, color = '#000') => {
  const spokes = Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return `M${(9 + 2 * Math.sin(a)).toFixed(2)} ${(9 - 2 * Math.cos(a)).toFixed(2)}L${(9 + 5.4 * Math.sin(a)).toFixed(2)} ${(9 - 5.4 * Math.cos(a)).toFixed(2)}`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.6" fill="none" stroke="${color}" stroke-width="1.5"/><path d="${spokes}" stroke="${color}" stroke-width="1.3" stroke-linecap="round"/><circle cx="9" cy="9" r="1" fill="${color}"/></svg>`;
};
const png = (svg, file, size) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(path.join(out, file));

await png(appIcon(), 'icon.png', 1024);
await png(logo(), 'logo.png', 512);
await png(tray(18), 'trayTemplate.png', 18);
await png(tray(36), 'trayTemplate@2x.png', 36);
await png(logo(), 'tray.png', 32);
await png(logo(), 'drag.png', 64);
fs.writeFileSync(path.join(root, 'src', 'renderer', 'assets', 'lime.svg'), logo(128));

const icns = async () => {
  const types = [['icp4', 16], ['icp5', 32], ['ic11', 32], ['icp6', 64], ['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024]];
  const chunks = [];
  for (const [t, s] of types) {
    const data = await sharp(path.join(out, 'icon.png')).resize(s, s).png().toBuffer();
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
const ico = async () => {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const imgs = await Promise.all(sizes.map((s) => sharp(path.join(out, 'icon.png')).resize(s, s).png().toBuffer()));
  const head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = head.length;
  imgs.forEach((b, i) => {
    const o = 6 + i * 16, s = sizes[i];
    head.writeUInt8(s >= 256 ? 0 : s, o); head.writeUInt8(s >= 256 ? 0 : s, o + 1);
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(b.length, o + 8); head.writeUInt32LE(off, o + 12);
    off += b.length;
  });
  fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([head, ...imgs]));
};
await icns();
await ico();
console.log('icons written to', out);
