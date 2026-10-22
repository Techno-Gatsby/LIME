import fs from 'node:fs';
import path from 'node:path';
import { ROOT, OUT, pkg, sh, which, rm, ls, pack, addResources } from './pack.mjs';

const ARCH = process.argv[2] || 'arm64';
const MAC = process.platform === 'darwin';
const { dir, T } = await pack('darwin', ARCH, {
  appBundleId: 'app.lime.converter', helperBundleId: 'app.lime.converter.helper', appCategoryType: 'public.app-category.utilities',
  icon: path.join(ROOT, 'build/icon.icns'), darwinDarkModeSupport: true,
  extendInfo: {
    LSUIElement: true, LSMinimumSystemVersion: '12.0', NSRequiresAquaSystemAppearance: false,
    NSAppleEventsUsageDescription: 'Lime asks Pages, Numbers or Keynote to convert documents when they are installed.',
    NSMicrophoneUsageDescription: 'Lime listens while you dictate. Your voice stays on this Mac.',
    CFBundleDocumentTypes: [{ CFBundleTypeName: 'Any file', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.item', 'public.folder'] }],
  },
});

const app = path.join(dir, `${pkg.productName}.app`);
const res = path.join(app, 'Contents/Resources');
addResources(res, T);
const fw = path.join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources');
for (const d of [fw, res]) for (const l of ls(d)) if (l.endsWith('.lproj') && !/^(en|en_GB|Base)\.lproj$/.test(l)) rm(d, l);

if (MAC) sh('codesign', ['--force', '--deep', '--sign', '-', app]);
else sh(which('RCODESIGN', 'rcodesign'), ['sign', app]);
console.log('✓ signed', path.relative(ROOT, app));

const dmg = path.join(OUT, `${pkg.productName}-${pkg.version}-${ARCH}.dmg`);
const stage = path.join(OUT, `.dmg-${ARCH}`);
rm(stage); rm(dmg);
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(app, path.join(stage, `${pkg.productName}.app`), { recursive: true, verbatimSymlinks: true });
if (MAC) {
  fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
  for (let i = 1; ; i++) {
    try { sh('hdiutil', ['create', '-volname', pkg.productName, '-srcfolder', stage, '-ov', '-format', 'ULMO', dmg]); break; } catch (e) {
      if (i === 4) throw e;
      console.log(`hdiutil failed, trying again (${i})`);
      sh('sleep', [String(10 * i)]);
    }
  }
} else {
  const hfs = `${stage}.hfs`, tool = which('HFSPLUS', 'hfsplus');
  const blocks = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => { const p = path.join(d, e.name); return s + (e.isDirectory() ? blocks(p) + 1 : Math.ceil(fs.lstatSync(p).size / 4096) + 1); }, 0);
  fs.writeFileSync(hfs, '');
  fs.truncateSync(hfs, (Math.ceil((blocks(stage) * 4096 * 1.08) / 1048576) + 48) * 1048576);
  sh(which('MKFS_HFSPLUS', 'mkfs.hfsplus'), ['-v', pkg.productName, hfs]);
  sh(tool, [hfs, 'addall', stage, '--symlinks', 'clone_link']);
  sh(tool, [hfs, 'symlink', '/Applications', '/Applications']);
  sh(tool, [hfs, 'add', path.join(ROOT, 'build/icon.icns'), '/.VolumeIcon.icns']);
  sh(tool, [hfs, 'attr', '/', 'C']);
  sh(which('DMG', 'dmg'), ['-c', 'lzma', 'build', hfs, dmg]);
  rm(hfs);
}
rm(stage);
console.log('✓', path.relative(ROOT, dmg), `${(fs.statSync(dmg).size / 1048576).toFixed(0)} MB`);
