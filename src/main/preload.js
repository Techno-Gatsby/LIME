'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lime', {
  invoke: (ch, ...args) => ipcRenderer.invoke(ch, ...args),
  on: (ch, fn) => {
    const handler = (e, payload) => fn(payload);
    ipcRenderer.on(ch, handler);
    return () => ipcRenderer.removeListener(ch, handler);
  },
  drag: (paths) => ipcRenderer.send('drag:start', paths),
  moveTick: () => ipcRenderer.send('wheel:dragTick'),
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
  platform: process.platform,
});
