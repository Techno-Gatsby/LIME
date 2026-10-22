'use strict';
// Small native bits for dictation: is the hotkey still held, which app had focus, and Ctrl+V / Cmd+V
// into it. Like Handy (MIT), Paste puts the text on the clipboard and sends the paste keystroke.
const { execFile } = require('child_process');
const isMac = process.platform === 'darwin', isWin = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WIN_VK = { Space: 0x20, Enter: 0x0d, Return: 0x0d, Tab: 0x09, Backspace: 0x08, Delete: 0x2e, Insert: 0x2d, Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22, Up: 0x26, Down: 0x28, Left: 0x25, Right: 0x27, '`': 0xc0, '-': 0xbd, '=': 0xbb, '[': 0xdb, ']': 0xdd, ';': 0xba, "'": 0xde, ',': 0xbc, '.': 0xbe, '/': 0xbf, '\\': 0xdc };
const MAC_KC = { A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9, B: 11, Q: 12, W: 13, E: 14, R: 15, Y: 16, T: 17, 1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, '=': 24, 9: 25, 7: 26, '-': 27, 8: 28, 0: 29, ']': 30, O: 31, U: 32, '[': 33, I: 34, P: 35, Return: 36, Enter: 36, L: 37, J: 38, "'": 39, K: 40, ';': 41, '\\': 42, ',': 43, '/': 44, N: 45, M: 46, '.': 47, Tab: 48, Space: 49, '`': 50, Backspace: 51, F5: 96, F6: 97, F7: 98, F3: 99, F8: 100, F9: 101, F11: 103, F10: 109, F12: 111, F4: 118, F2: 120, F1: 122, Left: 123, Right: 124, Down: 125, Up: 126 };
const keyOf = (accel) => String(accel || '').split('+').pop();
const winVk = (k) => WIN_VK[k] || (/^[A-Z0-9]$/i.test(k) ? k.toUpperCase().charCodeAt(0) : /^F(\d{1,2})$/.test(k) ? 0x6f + Number(k.slice(1)) : 0);

let lib = null;
function native() {
  if (lib !== null) return lib;
  lib = false;
  try {
    const koffi = require('koffi');
    if (isWin) {
      const u = koffi.load('user32.dll');
      lib = {
        key: u.func('int16_t __stdcall GetAsyncKeyState(int vKey)'),
        fg: u.func('void * __stdcall GetForegroundWindow()'),
        setFg: u.func('bool __stdcall SetForegroundWindow(void *hwnd)'),
        press: u.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)'),
      };
    } else if (isMac) {
      const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
      const ax = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices');
      const objc = koffi.load('/usr/lib/libobjc.A.dylib');
      const cls = objc.func('void *objc_getClass(const char *name)'), sel = objc.func('void *sel_registerName(const char *name)');
      const obj = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
      const num = objc.func('objc_msgSend', 'int64_t', ['void *', 'void *']);
      const withNum = objc.func('objc_msgSend', 'bool', ['void *', 'void *', 'uint64_t']);
      const byPid = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'int32_t']);
      lib = {
        held: cg.func('bool CGEventSourceKeyState(int32_t state, uint16_t key)'),
        event: cg.func('void * CGEventCreateKeyboardEvent(void *src, uint16_t key, bool down)'),
        flags: cg.func('void CGEventSetFlags(void *ev, uint64_t flags)'),
        post: cg.func('void CGEventPost(uint32_t tap, void *ev)'),
        release: cg.func('void CFRelease(void *ref)'),
        trusted: ax.func('bool AXIsProcessTrusted()'),
        frontPid: () => { const a = obj(obj(cls('NSWorkspace'), sel('sharedWorkspace')), sel('frontmostApplication')); return a ? Number(num(a, sel('processIdentifier'))) : 0; },
        activate: (pid) => { const a = byPid(cls('NSRunningApplication'), sel('runningApplicationWithProcessIdentifier:'), pid); return a ? withNum(a, sel('activateWithOptions:'), 2) : false; },
      };
    }
  } catch (_) { lib = false; }
  return lib;
}

// True while the hotkey's main key is down; null where that can't be read (Linux), so hold-to-talk falls back to a toggle.
function heldCheck(accel) {
  const n = native(), k = keyOf(accel);
  if (isWin && n) { const vk = winVk(k); return vk ? () => (n.key(vk) & 0x8000) !== 0 : null; }
  if (isMac && n) { const kc = MAC_KC[/^[a-z]$/.test(k) ? k.toUpperCase() : k]; return kc == null ? null : () => n.held(0, kc); }
  return null;
}

// Which app to paste into later. The dictation panel never takes focus while listening, so usually this is still in front.
function remember() {
  const n = native();
  try { if (isWin && n) return { hwnd: n.fg() }; if (isMac && n) return { pid: n.frontPid() }; } catch (_) {}
  return {};
}

const run = (cmd, args) => new Promise((ok, no) => execFile(cmd, args, { timeout: 4000, windowsHide: true }, (e) => (e ? no(e) : ok())));
async function paste(prev = {}, { selfPid = process.pid } = {}) {
  const n = native();
  if (isWin) {
    if (!n) throw new Error('Paste isn’t available on this PC. The text is on the clipboard: press Ctrl+V.');
    if (prev.hwnd) n.setFg(prev.hwnd);
    await sleep(120);
    for (const k of [0x10, 0x11, 0x12, 0x5b]) if (n.key(k) & 0x8000) n.press(k, 0, 2, 0);
    n.press(0x11, 0, 0, 0); n.press(0x56, 0, 0, 0); n.press(0x56, 0, 2, 0); n.press(0x11, 0, 2, 0);
    return true;
  }
  if (isMac) {
    if (!n) throw new Error('Paste isn’t available on this Mac. The text is on the clipboard: press ⌘V.');
    if (!n.trusted()) { const e = new Error('To paste for you, Lime needs Accessibility. Turn on Lime in System Settings › Privacy & Security › Accessibility. The text is on the clipboard: press ⌘V.'); e.code = 'ACCESSIBILITY'; throw e; }
    if (prev.pid && prev.pid !== selfPid) n.activate(prev.pid);
    await sleep(160);
    for (const down of [true, false]) { const ev = n.event(null, 9, down); n.flags(ev, 0x100000); n.post(0, ev); n.release(ev); }
    return true;
  }
  await sleep(120);
  await run('xdotool', ['key', '--clearmodifiers', 'ctrl+v']).catch(() => { throw new Error('Paste needs xdotool on Linux. The text is on the clipboard: press Ctrl+V.'); });
  return true;
}

module.exports = { heldCheck, remember, paste, keyOf };
