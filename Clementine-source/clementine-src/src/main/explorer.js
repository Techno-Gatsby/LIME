'use strict';
// Windows Explorer integration. Everything lives under HKCU so no administrator rights are needed.
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isWin = process.platform === 'win32';
const run = (cmd, args, input) => new Promise((resolve, reject) => {
  const c = execFile(cmd, args, { windowsHide: true, maxBuffer: 8e6 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  if (input) c.stdin.end(input);
});
const ps = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);

const KEYS = [
  { root: 'HKCU\\Software\\Classes\\*\\shell\\Clementine', label: 'Convert with Clementine', arg: '--wheel' },
  { root: 'HKCU\\Software\\Classes\\Directory\\shell\\Clementine', label: 'Compress with Clementine', arg: '--wheel' },
  { root: 'HKCU\\Software\\Classes\\*\\shell\\ClementineOpen', label: 'Open in Clementine', arg: '--open' },
];
async function setContextMenu(enabled, exe = process.execPath) {
  if (!isWin) return false;
  for (const k of KEYS) {
    if (enabled) {
      await run('reg', ['add', k.root, '/ve', '/d', k.label, '/f']);
      await run('reg', ['add', k.root, '/v', 'Icon', '/d', `"${exe}",0`, '/f']);
      await run('reg', ['add', k.root, '/v', 'MultiSelectModel', '/d', 'Player', '/f']);
      await run('reg', ['add', `${k.root}\\command`, '/ve', '/d', `"${exe}" ${k.arg} "%1"`, '/f']);
    } else {
      await run('reg', ['delete', k.root, '/f']).catch(() => {});
    }
  }
  // Send To handles many files in one go
  const sendTo = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'SendTo', 'Clementine.lnk');
  if (enabled) {
    const { shell } = require('electron');
    shell.writeShortcutLink(sendTo, 'create', { target: exe, args: '--wheel', description: 'Convert with Clementine', icon: exe, iconIndex: 0 });
  } else fs.rmSync(sendTo, { force: true });
  return true;
}
async function contextMenuEnabled() {
  if (!isWin) return false;
  try { await run('reg', ['query', KEYS[0].root]); return true; } catch (_) { return false; }
}

/** Files selected in the foreground File Explorer window (used by the global hotkey). */
async function explorerSelection() {
  if (!isWin) return [];
  const script = `
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'
$fg = [W.U]::GetForegroundWindow()
$sh = New-Object -ComObject Shell.Application
foreach ($w in $sh.Windows()) { try { if ($w.HWND -eq [int64]$fg) { $w.Document.SelectedItems() | ForEach-Object { $_.Path } } } catch {} }`;
  try {
    const out = await ps(script);
    return out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && fs.existsSync(s));
  } catch (_) { return []; }
}
/** Put real files on the clipboard (paste into Explorer, Outlook, Teams…). */
async function copyFiles(paths) {
  if (!isWin) return false;
  const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
  await ps(`Set-Clipboard -Path ${list}`);
  return true;
}
async function properties(p) {
  if (!isWin) return false;
  const dir = path.dirname(p).replace(/'/g, "''");
  const name = path.basename(p).replace(/'/g, "''");
  await ps(`$s=New-Object -ComObject Shell.Application; $s.Namespace('${dir}').ParseName('${name}').InvokeVerb('properties'); Start-Sleep -Seconds 8`).catch(() => {});
  return true;
}

module.exports = { setContextMenu, contextMenuEnabled, explorerSelection, copyFiles, properties };
