'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('limeCraft', {
  info: () => ipcRenderer.invoke('craftweb:info'),
  read: () => ipcRenderer.invoke('craftweb:read'),
  save: (name, bytes) => ipcRenderer.invoke('craftweb:save', String(name || ''), bytes),
  dirty: (on) => ipcRenderer.invoke('craftweb:dirty', !!on),
  show: (p) => ipcRenderer.invoke('craftweb:show', String(p || '')),
  onSaved: (fn) => ipcRenderer.on('craftweb:saved', (e, r) => fn(r)),
});
