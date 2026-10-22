'use strict';
// Draws diagrams in a hidden window for the wheel's tools: draw.io pages and Mermaid blocks. Only our own pages load.
const { BrowserWindow } = require('electron');
const path = require('path');
const helpers = require('./helpers');
const { diagramVendor } = require('./diagrams');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withWindow(url, fn) {
  const win = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith('app://local/')) e.preventDefault(); });
  if (process.env.LIME_DIAGRAM_DEBUG) win.webContents.on('console-message', (e) => console.log('[diagram]', e.message ?? e));
  try {
    await Promise.race([win.loadURL(url), sleep(60000).then(() => { throw new Error('The diagram took too long to open.'); })]);
    return await fn(win.webContents);
  } finally { win.destroy(); }
}

// Runs in the render page: draw.io only talks to a page that holds it in a frame, so one is made, the diagram loaded, then
// every page exported. Replies come back as messages from the frame.
function drawioJob(p, src) {
  const f = document.createElement('iframe');
  f.style.cssText = 'width:1400px;height:1000px;border:0';
  document.body.append(f);
  f.src = src;
  const wait = (fn, ms = 60000) => new Promise((ok, no) => { const t0 = Date.now(); (function poll() { const v = fn(); if (v) ok(v); else if (Date.now() - t0 > ms) no(new Error('draw.io didn’t start.')); else setTimeout(poll, 50); })(); });
  const reply = (ev) => new Promise((ok) => { const on = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } if (m.event === ev) { removeEventListener('message', on); ok(m); } }; addEventListener('message', on); });
  const send = (msg, ev) => { const r = reply(ev); f.contentWindow.postMessage(JSON.stringify(msg), '*'); return r; };
  return (async () => {
    const ui = await wait(() => f.contentWindow?.limeUi), W = f.contentWindow;
    let xml = p.xml;
    if (p.vsdx) xml = await new Promise((ok, no) => ui.importVisio(new W.Blob([Uint8Array.from(atob(p.vsdx), (c) => c.charCodeAt(0))]), ok, (e) => no(new Error((e && e.message) || 'This Visio file couldn’t be read.')), p.name));
    await send({ action: 'load', xml }, 'load');
    const pages = ui.pages && ui.pages.length ? ui.pages : [null], out = [];
    for (let i = 0; i < pages.length; i++) {
      if (pages[i] && ui.currentPage !== pages[i]) { ui.selectPage(pages[i]); await new Promise((r) => setTimeout(r, 50)); }
      const b = ui.editor.graph.getGraphBounds();
      const m = await send({ action: 'export', format: p.format === 'png' ? 'png' : 'svg', pageId: pages[i] ? pages[i].getId() : undefined, scale: p.format === 'png' ? p.scale || 2 : 1, border: 10, background: p.background === false ? 'none' : '#ffffff' }, 'export');
      out.push({ name: pages[i] ? pages[i].getName() : 'Page 1', data: m.data, width: Math.ceil(b.width / ui.editor.graph.view.scale) + 20, height: Math.ceil(b.height / ui.editor.graph.view.scale) + 20 });
    }
    return out;
  })();
}

async function render(kind, p) {
  if (kind === 'drawio') {
    if (!(await helpers.ensure('drawio', diagramVendor(), p.root))) throw Object.assign(new Error('draw.io isn’t in this build of Lime.'), { code: 'ENGINE_MISSING' });
    const q = new URLSearchParams({ embed: '1', proto: 'json', stealth: '1', lang: 'en', spin: '0', configure: '0', ui: 'min', pwa: '0', splash: '0' });
    return withWindow('app://local/diagram-render.html', (wc) => wc.executeJavaScript(`(${drawioJob})(${JSON.stringify(p)}, ${JSON.stringify(`drawio/lime.html?${q}`)})`, true));
  }
  if (kind === 'mermaid') return withWindow('app://local/diagram-render.html', (wc) => wc.executeJavaScript(`window.renderMermaid(${JSON.stringify(p.blocks)}, ${JSON.stringify(p.theme || 'default')})`, true));
  throw new Error(`Unknown diagram ${path.basename(kind)}`);
}

module.exports = { render };
