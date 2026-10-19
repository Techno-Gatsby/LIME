// electron-builder afterPack hook: swap in Windows-only native binaries, drop dev/other-OS payloads,
// and stamp the icon + version info into Clementine.exe without needing Wine (resedit is pure JS).
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const app = path.join(ctx.appOutDir, 'resources', 'app');
  const nm = path.join(app, 'node_modules');
  const rm = (p) => fs.rmSync(path.join(nm, p), { recursive: true, force: true });
  // sharp: Windows libvips build in, Linux builds out
  const img = path.join(nm, '@img');
  for (const d of fs.existsSync(img) ? fs.readdirSync(img) : []) if (/linux|darwin|wasm32/.test(d)) rm(`@img/${d}`);
  fs.cpSync(path.resolve(__dirname, '../vendor/npm/sharp-win32-x64'), path.join(img, 'sharp-win32-x64'), { recursive: true });
  // onnxruntime (background removal): keep only win32
  const ort = path.join(nm, 'onnxruntime-node', 'bin');
  if (fs.existsSync(ort)) for (const v of fs.readdirSync(ort)) for (const os of ['linux', 'darwin']) fs.rmSync(path.join(ort, v, os), { recursive: true, force: true });
  // dev-only binaries (the packaged app uses resources/bin)
  ['ffmpeg-static', 'ffprobe-static', 'resedit', 'pe-library', '@fluentui'].forEach(rm);
  // icon + version resource
  const ResEdit = await import('resedit');
  const R = ResEdit.default || ResEdit;
  const exePath = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const exe = R.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = R.NtExecutableResource.from(exe);
  const ico = R.Data.IconFile.from(fs.readFileSync(path.resolve(__dirname, '../build/icon.ico')));
  const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, 1033, ico.icons.map((i) => i.data));
  const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0] || R.Resource.VersionInfo.createEmpty();
  const ver = ctx.packager.appInfo.version.split('.').map(Number);
  vi.setFileVersion(ver[0], ver[1], ver[2], 0, 1033);
  vi.setProductVersion(ver[0], ver[1], ver[2], 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'Clementine', ProductName: 'Clementine', CompanyName: 'Clementine',
    LegalCopyright: 'Open source. See resources/LICENSES.', OriginalFilename: 'Clementine.exe', InternalName: 'Clementine',
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • afterPack: Windows natives swapped, icon and version stamped');
};
