// Compiles build/clementine.nsi with NSIS's own compiler — works on Windows, Linux and macOS, no Wine needed.
// Run after `npx electron-builder --win --dir` has produced dist/win-unpacked.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const win = process.platform === 'win32';
const cache = win ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'electron-builder', 'Cache') : path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/electron-builder' : '.cache/electron-builder');
function find(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = find(p); if (r) return r; }
    else if (win ? e.name === 'makensis.exe' && !p.includes(`${path.sep}Bin${path.sep}`) : e.name === 'makensis' && p.includes(process.platform === 'darwin' ? `${path.sep}mac${path.sep}` : `${path.sep}linux${path.sep}`)) return p;
  }
  return null;
}
const makensis = process.env.MAKENSIS || find(cache);
if (!makensis) throw new Error('makensis not found. Run `npx electron-builder --win` once to download NSIS, or set MAKENSIS.');
const nsisDir = win ? path.dirname(makensis) : path.dirname(path.dirname(makensis));
execFileSync(makensis, ['-V2', '-INPUTCHARSET', 'UTF8', 'clementine.nsi'], { cwd: path.resolve('build'), stdio: 'inherit', env: { ...process.env, NSISDIR: nsisDir } });
console.log('✓ dist/Clementine-Setup-1.0.0.exe');
