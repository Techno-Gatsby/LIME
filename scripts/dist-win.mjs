import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, OUT, V, pkg, sh, which, rm, ls, pack, addResources } from './pack.mjs';

const { unzipSync } = createRequire(import.meta.url)('fflate');
const NSIS = 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.11/nsis-3.11.zip';

const ARCH = process.argv[2] || 'x64';
const name = pkg.productName;
const { dir, T } = await pack('win32', ARCH, {
  icon: path.join(ROOT, 'build/icon.ico'),
  win32metadata: { CompanyName: name, FileDescription: name, ProductName: name, InternalName: name, OriginalFilename: `${name}.exe` },
});
addResources(path.join(dir, 'resources'), T);
for (const l of ls(path.join(dir, 'locales'))) if (!/^en-(US|GB)\.pak$/.test(l)) rm(dir, 'locales', l);

const setup = path.join(OUT, `${name}-Setup-${pkg.version}-${ARCH}.exe`);
async function nsis() {
  const d = path.join(V, '.cache', 'nsis'), exe = path.join(d, 'makensis.exe');
  for (let i = 1; i <= 3 && !fs.existsSync(exe); i++) {
    try {
      const r = await fetch(NSIS);
      if (!r.ok) throw new Error(`${r.status} ${NSIS}`);
      const tmp = `${d}.part`;
      rm(tmp);
      for (const [n, b] of Object.entries(unzipSync(new Uint8Array(await r.arrayBuffer())))) {
        if (n.endsWith('/')) continue;
        const f = path.join(tmp, n.slice(n.indexOf('/') + 1));
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, b);
      }
      fs.renameSync(tmp, d);
    } catch (e) {
      console.warn(`NSIS download attempt ${i}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 5000 * i));
    }
  }
  return fs.existsSync(exe) && exe;
}
const installed = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NSIS', 'makensis.exe');
const makensis = which('MAKENSIS', 'makensis') || (process.platform === 'win32' && (fs.existsSync(installed) ? installed : await nsis()));
if (!makensis) throw new Error('Install NSIS (makensis) to build the Windows installer.');
const kb = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? kb(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size / 1024), 0);
// NSIS is a 32-bit program and can't hold more than about 1.5 GB of data, so every large archive (already compressed)
// goes beside the installer in Lime-data, which ships in the same download and is copied in at install time.
const res = path.join(dir, 'resources'), data = path.join(OUT, 'Lime-data');
rm(data);
const big = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (fs.statSync(f).size > 30 * 1048576 && !f.includes(`${path.sep}app${path.sep}`) && !f.includes(`${path.sep}app.asar`)) big.push(f); } };
walk(res);
const split = kb(dir) > 1400 * 1024 && big.length > 0;
const nsh = path.join(OUT, 'split.nsh');
if (split) {
  for (const f of big) { const to = path.join(data, path.relative(res, f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(f, to); }
  fs.writeFileSync(nsh, `File /r ${[...new Set(big.map((f) => path.basename(f)))].map((n) => `/x "${n}"`).join(' ')} "\${SRC}\\*.*"\n`);
}
sh(makensis, ['-V2', '-INPUTCHARSET', 'UTF8', ...(split ? [`-DSPLIT=${nsh}`] : []), `-DSRC=${dir}`, `-DOUT=${setup}`, `-DVERSION=${pkg.version}`, `-DSIZE=${Math.round(kb(dir))}`, path.join(ROOT, 'build/lime.nsi')], { stdio: 'inherit' });
console.log('✓', path.relative(ROOT, setup), `${(fs.statSync(setup).size / 1048576).toFixed(0)} MB`, split ? `+ Lime-data ${(kb(data) / 1024).toFixed(0)} MB` : '');
