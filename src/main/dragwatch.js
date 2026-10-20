'use strict';
const path = require('path');

function macProbe(koffi) {
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const cls = objc.func('void *objc_getClass(const char *name)');
  const sel = objc.func('void *sel_registerName(const char *name)');
  const num = objc.func('objc_msgSend', 'int64_t', ['void *', 'void *']);
  const obj = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
  const withStr = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'const char *']);
  const withObj = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']);
  const NSEvent = cls('NSEvent');
  const name = withStr(cls('NSString'), sel('stringWithUTF8String:'), 'Apple CFPasteboard drag');
  const board = obj(withObj(cls('NSPasteboard'), sel('pasteboardWithName:'), name), sel('retain'));
  const sButtons = sel('pressedMouseButtons'), sFlags = sel('modifierFlags'), sCount = sel('changeCount');
  return () => ({ left: (Number(num(NSEvent, sButtons)) & 1) === 1, shift: (Number(num(NSEvent, sFlags)) & 0x20000) !== 0, count: Number(num(board, sCount)) });
}

function winProbe(koffi) {
  const user32 = koffi.load('user32.dll'), kernel32 = koffi.load('kernel32.dll');
  const POINT = koffi.struct('LIME_POINT', { x: 'int32_t', y: 'int32_t' });
  const key = user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)');
  const cursor = user32.func('bool __stdcall GetCursorPos(_Out_ LIME_POINT *pt)');
  const atPoint = user32.func('void * __stdcall WindowFromPoint(LIME_POINT pt)');
  const ancestor = user32.func('void * __stdcall GetAncestor(void *hwnd, uint32_t flags)');
  const owner = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)');
  const findWindow = user32.func('void * __stdcall FindWindowW(const char16_t *cls, const char16_t *title)');
  const open = kernel32.func('void * __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
  const imageName = kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *h, uint32_t flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)');
  const close = kernel32.func('bool __stdcall CloseHandle(void *h)');
  const FILE_MANAGERS = new Set(['explorer.exe', 'files.exe', 'dopus.exe', 'totalcmd.exe', 'totalcmd64.exe', 'xyplorer.exe', 'onecommander.exe', 'q-dir.exe', 'freecommander.exe']);
  const processAt = (pt) => {
    const hwnd = atPoint(pt);
    if (!hwnd) return '';
    const pid = [0];
    owner(ancestor(hwnd, 2) || hwnd, pid);
    if (!pid[0] || pid[0] === process.pid) return '';
    const h = open(0x1000, false, pid[0]);
    if (!h) return '';
    try {
      const buf = new Uint16Array(1024), size = [buf.length];
      return imageName(h, 0, buf, size) ? path.win32.basename(String.fromCharCode(...buf.subarray(0, size[0]))).toLowerCase() : '';
    } finally { close(h); }
  };
  return () => {
    const pt = {};
    cursor(pt);
    return { left: (key(0x01) & 0x8000) !== 0, shift: (key(0x10) & 0x8000) !== 0, x: pt.x, y: pt.y, at: () => processAt(pt), shellDrag: () => !!findWindow('SysDragImage', null), fileManager: (name) => FILE_MANAGERS.has(name) };
  };
}

function detector(probe, { onDrag, onShift, onEnd }, threshold = 8) {
  let last = null, press = null, dragging = false, shifted = false;
  return () => {
    const s = probe();
    if (!s.left) {
      if (dragging) onEnd?.();
      dragging = false; shifted = false; press = null;
      last = s;
      return;
    }
    if (!dragging) {
      if ('count' in s) {
        if (last && s.count !== last.count) dragging = true;
      } else {
        if (!press) press = { x: s.x, y: s.y, fm: s.fileManager(s.at()) };
        if (Math.hypot(s.x - press.x, s.y - press.y) >= threshold && (press.fm || s.shellDrag())) dragging = true;
      }
      if (dragging) onDrag?.(s.shift);
    }
    if (dragging && s.shift && !shifted) { shifted = true; onShift?.(); }
    if (!dragging && 'count' in s) last = s;
  };
}

function start(handlers, { interval = 40 } = {}) {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return null;
  let probe;
  try {
    const koffi = require('koffi');
    probe = process.platform === 'darwin' ? macProbe(koffi) : winProbe(koffi);
    probe();
  } catch (e) {
    handlers.onError?.(e);
    return null;
  }
  const tick = detector(probe, handlers);
  const t = setInterval(() => { try { tick(); } catch (e) { clearInterval(t); handlers.onError?.(e); } }, interval);
  return { stop: () => clearInterval(t), probe };
}

module.exports = { start, detector };
