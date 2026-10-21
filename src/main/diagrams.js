'use strict';
// Whiteboard and draw.io editors: file reading and writing for the editor window, and where the bundled draw.io lives.
const fs = require('fs'), fsp = require('fs/promises'), path = require('path');
const helpers = require('./helpers');

// Packed apps keep these beside the other resources; a checkout keeps them in vendor/.
function vendorOf(env, area) {
  if (process.env[env]) return process.env[env];
  const res = process.resourcesPath && path.join(process.resourcesPath, area);
  return res && fs.existsSync(res) ? res : path.join(__dirname, '..', '..', 'vendor', area);
}
const diagramVendor = () => vendorOf('LIME_DIAGRAMS', 'diagrams');
const translateVendor = () => vendorOf('LIME_TRANSLATE', 'translate');
const hasDrawio = () => !!helpers.bundled('drawio', diagramVendor());
const drawioSite = (root) => { const exe = helpers.unpacked('drawio', diagramVendor(), root); return exe ? path.dirname(exe) : null; };
const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', xml: 'application/xml', txt: 'text/plain', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', jpg: 'image/jpeg', ico: 'image/x-icon', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2' };
// Serves app://local/drawio/… from the unpacked draw.io; it is on the editor's own origin, so the editor can reach the diagram.
function serveDrawio(rel, root) {
  const site = drawioSite(root);
  if (!site) return new Response('Not found', { status: 404 });
  const file = path.normalize(path.join(site, rel));
  if (!file.startsWith(site + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('Not found', { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { 'Content-Type': MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream' } });
}

async function ready() {
  const exe = await helpers.ensure('drawio', diagramVendor(), path.join(require('./engines/util').cfg.user, 'helpers'));
  if (!exe) throw Object.assign(new Error('draw.io isn’t in this build of Lime.'), { code: 'ENGINE_MISSING' });
  return true;
}
const TEXT = ['excalidraw', 'json', 'drawio', 'dio', 'xml', 'svg', 'mmd', 'mermaid'];
async function open(file) {
  const e = path.extname(file).slice(1).toLowerCase();
  if (TEXT.includes(e)) return { text: (await fsp.readFile(file, 'utf8')).replace(/^﻿/, ''), ext: e };
  return { bytes: await fsp.readFile(file), ext: e, mime: e === 'png' ? 'image/png' : 'application/octet-stream' };
}
async function write(target, data) {
  const tmp = `${target}.lime-${process.pid}.part`;
  await fsp.writeFile(tmp, typeof data === 'string' ? data : Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength ?? data.length));
  await fsp.rename(tmp, target);
  return { path: target };
}
const save = (target, text) => write(target, text);

module.exports = { diagramVendor, translateVendor, hasDrawio, drawioSite, serveDrawio, ready, open, write, save };
