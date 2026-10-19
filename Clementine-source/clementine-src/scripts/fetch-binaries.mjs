// Downloads the native engines Clementine bundles. Run: node scripts/fetch-binaries.mjs [--linux]
// Windows (always): FFmpeg 8.1 GPL shared (BtbN), full 7-Zip (7z.exe + 7z.dll, reads RAR), ffprobe.
// Shared: Tesseract English model, Noto fonts for PDF text editing, signature fonts.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const vendor = path.join(root, 'vendor');
const tmp = path.join(vendor, '.tmp');
const SEVEN = '26.04';
const SEVEN_TAG = SEVEN.replace('.', '');
const FF = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip';

fs.mkdirSync(tmp, { recursive: true });
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

async function get(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  console.log('↓', url);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

// 1. Host 7-Zip (Linux build machine) used to unpack the Windows installers.
const linux7z = path.join(vendor, 'bin', 'linux', '7zz');
if (!fs.existsSync(linux7z)) {
  const tx = await get(`https://github.com/ip7z/7zip/releases/download/${SEVEN}/7z${SEVEN_TAG}-linux-x64.tar.xz`, path.join(tmp, '7z-linux.tar.xz'));
  fs.mkdirSync(path.dirname(linux7z), { recursive: true });
  sh('tar', ['-xJf', tx, '-C', path.dirname(linux7z), '7zz']);
}
const z = (args) => sh(linux7z, args, { stdio: 'ignore' });

// 2. Windows 7-Zip: the x64 installer is a 7z archive containing 7z.exe + 7z.dll (full codec set incl. RAR).
const win = path.join(vendor, 'bin', 'win32');
fs.mkdirSync(win, { recursive: true });
if (!fs.existsSync(path.join(win, '7z.dll'))) {
  const inst = await get(`https://github.com/ip7z/7zip/releases/download/${SEVEN}/7z${SEVEN_TAG}-x64.exe`, path.join(tmp, '7z-x64.exe'));
  z(['e', inst, `-o${win}`, '7z.exe', '7z.dll', 'License.txt', '-y']);
  fs.renameSync(path.join(win, 'License.txt'), path.join(win, '7-Zip-License.txt'));
}

// 3. Windows FFmpeg + FFprobe (shared build: both exes share one set of DLLs).
if (!fs.existsSync(path.join(win, 'ffmpeg.exe'))) {
  const zip = await get(FF, path.join(tmp, 'ffmpeg-win.zip'));
  const out = path.join(tmp, 'ff');
  z(['x', zip, `-o${out}`, '-y']);
  const dir = fs.readdirSync(out).map((d) => path.join(out, d)).find((d) => fs.existsSync(path.join(d, 'bin')));
  for (const f of fs.readdirSync(path.join(dir, 'bin'))) {
    if (f === 'ffplay.exe') continue;
    fs.copyFileSync(path.join(dir, 'bin', f), path.join(win, f));
  }
  fs.copyFileSync(path.join(dir, 'LICENSE.txt'), path.join(win, 'FFmpeg-License.txt'));
}

// 4. OCR model + fonts.
const data = path.join(vendor, 'data');
await get('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata', path.join(data, 'tessdata', 'eng.traineddata'));
const NOTO = 'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts';
const fonts = {
  'NotoSans-Regular.ttf': `${NOTO}/NotoSans/hinted/ttf/NotoSans-Regular.ttf`,
  'NotoSans-Bold.ttf': `${NOTO}/NotoSans/hinted/ttf/NotoSans-Bold.ttf`,
  'NotoSans-Italic.ttf': `${NOTO}/NotoSans/hinted/ttf/NotoSans-Italic.ttf`,
  'NotoSans-BoldItalic.ttf': `${NOTO}/NotoSans/hinted/ttf/NotoSans-BoldItalic.ttf`,
  'NotoSerif-Regular.ttf': `${NOTO}/NotoSerif/hinted/ttf/NotoSerif-Regular.ttf`,
  'NotoSerif-Bold.ttf': `${NOTO}/NotoSerif/hinted/ttf/NotoSerif-Bold.ttf`,
  'NotoSansMono-Regular.ttf': `${NOTO}/NotoSansMono/hinted/ttf/NotoSansMono-Regular.ttf`,
  'Caveat.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf',
  'DancingScript.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/dancingscript/DancingScript%5Bwght%5D.ttf',
};
for (const [name, url] of Object.entries(fonts)) await get(url, path.join(data, 'fonts', name));

// 5. Linux test binaries (only for developing on Linux).
if (process.argv.includes('--linux')) {
  const lin = path.join(vendor, 'bin', 'linux');
  fs.copyFileSync(linux7z, path.join(lin, '7z'));
  fs.chmodSync(path.join(lin, '7z'), 0o755);
}
fs.rmSync(path.join(tmp, 'ff'), { recursive: true, force: true });
console.log('✓ engines ready in', vendor);
