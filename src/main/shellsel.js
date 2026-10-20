'use strict';
// Reads the selection of the Explorer window (or desktop) a drag started from, so the wheel can show
// choices before the drop. Logic follows og-converter's ShellSelectionService (GPL-3.0); the COM work
// runs in a long-lived PowerShell so a shell hiccup can never take Lime down.
const { spawn } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$shell = New-Object -ComObject Shell.Application
function Read-Selection($doc) {
  $out = @()
  if ($doc -eq $null) { return ,$out }
  foreach ($item in @($doc.SelectedItems())) { if ($item.Path) { $out += [string]$item.Path } }
  if ($out.Count -eq 0 -and $doc.FocusedItem) { $out += [string]$doc.FocusedItem.Path }
  return ,$out
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $found = @()
  try {
    $q = $line | ConvertFrom-Json
    foreach ($t in @($q.targets)) {
      if ($t.desktop) {
        $desk = $shell.Windows().FindWindowSW(0, $null, 8, [ref]0, 1)
        if ($desk) { $found = Read-Selection $desk.Document }
      } else {
        $wins = @($shell.Windows() | Where-Object { [int64]$_.HWND -eq [int64]$t.hwnd })
        $w = $wins | Where-Object { $t.tab -and $_.LocationName -eq $t.tab } | Select-Object -First 1
        if (-not $w) { $w = $wins | Select-Object -First 1 }
        if ($w) { $found = Read-Selection $w.Document }
      }
      if ($found.Count) { break }
    }
  } catch {}
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject @($found) -Compress))
  [Console]::Out.Flush()
}
`;

let ps = null, buf = '', idleT = null;
const waiting = [];
function warm() {
  if (ps || process.platform !== 'win32') return ps;
  ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) waiting.shift()?.(buf.slice(0, i).trim());
  });
  const gone = () => { ps = null; buf = ''; waiting.splice(0).forEach((w) => w('[]')); };
  ps.on('exit', gone);
  ps.on('error', gone);
  ps.stdin.on('error', () => {});
  return ps;
}
function stop() {
  clearTimeout(idleT);
  if (ps) { ps.stdin.end(); ps.kill(); ps = null; }
}
function query(targets, timeout = 4000) {
  const p = warm();
  if (!p) return Promise.resolve([]);
  clearTimeout(idleT);
  idleT = setTimeout(stop, 15 * 60000);
  return new Promise((resolve) => {
    let done = false;
    const finish = (line) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      let v = [];
      try { v = JSON.parse(line || '[]'); } catch (_) {}
      resolve((Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && x));
    };
    const t = setTimeout(() => finish('[]'), timeout);
    waiting.push(finish);
    p.stdin.write(`${JSON.stringify({ targets })}\n`);
  });
}

module.exports = { query, warm, stop };
