'use strict';
// Narrow bridge between the sandboxed UI and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE = /^(app|catalog|files|wheel|jobs|dialog|shell|clip|settings|recent|engines|craft|editor|main|overlay|dock):/;
const EVENTS = new Set(['jobs', 'recent', 'settings', 'theme', 'open', 'engines:progress', 'craft:progress']);

contextBridge.exposeInMainWorld('clem', {
  invoke: (channel, ...args) => {
    if (!INVOKE.test(channel) && channel !== 'catalog') return Promise.reject(new Error(`Blocked channel ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, fn) => {
    if (!EVENTS.has(channel)) throw new Error(`Blocked event ${channel}`);
    const handler = (e, payload) => fn(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  startDrag: (paths) => ipcRenderer.send('drag:start', paths),
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
  platform: process.platform,
});
