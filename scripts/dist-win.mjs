import fs from 'node:fs';
import path from 'node:path';
import { ROOT, OUT, pkg, sh, which, rm, ls, pack, addResources } from './pack.mjs';

const ARCH = process.argv[2] || 'x64';
const name = pkg.productName;
const { dir, T } = await pack('win32', ARCH, {
  icon: path.join(ROOT, 'build/icon.ico'),
  win32metadata: { CompanyName: name, FileDescription: name, ProductName: name, InternalName: name, OriginalFilename: `${name}.exe` },
});
addResources(path.join(dir, 'resources'), T);
for (const l of ls(path.join(dir, 'locales'))) if (!/^en-(US|GB)\.pak$/.test(l)) rm(dir, 'locales', l);

const setup = path.join(OUT, `${name}-Setup-${pkg.version}-${ARCH}.exe`);
const makensis = which('MAKENSIS', 'makensis');
if (!makensis) throw new Error('Install NSIS (makensis) to build the Windows installer.');
const kb = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? kb(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size / 1024), 0);
sh(makensis, ['-V2', '-INPUTCHARSET', 'UTF8', `-DSRC=${dir}`, `-DOUT=${setup}`, `-DVERSION=${pkg.version}`, `-DSIZE=${Math.round(kb(dir))}`, path.join(ROOT, 'build/lime.nsi')], { stdio: 'inherit' });
console.log('✓', path.relative(ROOT, setup), `${(fs.statSync(setup).size / 1048576).toFixed(0)} MB`);
