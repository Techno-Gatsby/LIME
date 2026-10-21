import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { unzipSync } = require('fflate');
const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET = process.argv[2] || `${process.platform}-${process.arch}`;
const [PLAT, ARCH] = TARGET.split('-');
const WIN = PLAT === 'win32';
const V = path.join(ROOT, 'vendor');
const CACHE = path.join(V, '.cache');
const BIN = path.join(V, 'bin', TARGET), CRAFTS = path.join(V, 'crafts', TARGET), APPS = path.join(V, 'apps', TARGET), DATA = path.join(V, 'data'), NPM = path.join(V, 'npm', TARGET);
const CRAFT = { photocraft: '0.10.0', vectorcraft: '0.13.1', filmcraft: '0.9.0', lightcraft: '0.9.1', pdfcraft: '0.9.0', effectcraft: '0.11.1', designcraft: '0.9.0' };
const FF = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1';
const SEVEN = 'https://github.com/ip7z/7zip/releases/download/26.04';
const NOTO = 'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts';
const GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl';
const TESS = 'https://raw.githubusercontent.com/tesseract-ocr';
const LANGS = ['spa', 'fra', 'deu', 'ita', 'por', 'nld', 'rus', 'ara', 'hin', 'jpn', 'chi_sim', 'kor'];
const FONTS = {
  'NotoSans-Regular.ttf': `${NOTO}/NotoSans/hinted/ttf/NotoSans-Regular.ttf`, 'NotoSans-Bold.ttf': `${NOTO}/NotoSans/hinted/ttf/NotoSans-Bold.ttf`,
  'NotoSans-Italic.ttf': `${NOTO}/NotoSans/hinted/ttf/NotoSans-Italic.ttf`, 'NotoSans-BoldItalic.ttf': `${NOTO}/NotoSans/hinted/ttf/NotoSans-BoldItalic.ttf`,
  'NotoSerif-Regular.ttf': `${NOTO}/NotoSerif/hinted/ttf/NotoSerif-Regular.ttf`, 'NotoSerif-Bold.ttf': `${NOTO}/NotoSerif/hinted/ttf/NotoSerif-Bold.ttf`,
  'NotoSansMono-Regular.ttf': `${NOTO}/NotoSansMono/hinted/ttf/NotoSansMono-Regular.ttf`,
  'NotoSansArabic-Regular.ttf': `${NOTO}/NotoSansArabic/hinted/ttf/NotoSansArabic-Regular.ttf`, 'NotoSansDevanagari-Regular.ttf': `${NOTO}/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf`, 'NotoSansThai-Regular.ttf': `${NOTO}/NotoSansThai/hinted/ttf/NotoSansThai-Regular.ttf`,
  'Caveat.ttf': `${GF}/caveat/Caveat%5Bwght%5D.ttf`, 'DancingScript.ttf': `${GF}/dancingscript/DancingScript%5Bwght%5D.ttf`,
  ...Object.fromEntries(['Regular', 'Bold', 'Italic', 'BoldItalic'].map((w) => [`Carlito-${w}.ttf`, `${GF}/carlito/Carlito-${w}.ttf`])),
};

const mk = (d) => (fs.mkdirSync(d, { recursive: true }), d);
const has = (f) => fs.existsSync(f) && fs.statSync(f).size > 0;
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const sh = (c, a) => execFileSync(c, a, { stdio: ['ignore', 'ignore', 'inherit'] });
const which = (...names) => names.find((n) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [n], { stdio: 'ignore' }); return true; } catch { return false; } });

async function get(url, name = decodeURIComponent(path.basename(new URL(url).pathname))) {
  const f = path.join(mk(CACHE), name);
  if (has(f)) return f;
  for (let i = 1; ; i++) {
    console.log('↓', url);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(600000) });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(`${f}.part`));
      fs.renameSync(`${f}.part`, f);
      return f;
    } catch (e) {
      if (i === 3) throw e;
      console.warn(`retrying ${url}: ${e.message}`);
    }
  }
}
const put = async (url, dest) => { if (has(dest)) return; mk(path.dirname(dest)); fs.copyFileSync(await get(url), dest); };
const unzipOne = (zip, re) => Object.values(unzipSync(fs.readFileSync(zip), { filter: (f) => re.test(f.name) }))[0];
const brotli = (buf, dest, q = 11) => new Promise((ok, no) => zlib.brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: q, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }, (e, out) => e ? no(e) : ok(fs.writeFileSync(dest, out))));

function thin(buf) {
  if (PLAT !== 'darwin' || buf.readUInt32BE(0) !== 0xcafebabe) return buf;
  const lipo = which('lipo', 'llvm-lipo', ...[20, 19, 18, 17, 16, 15].map((v) => `llvm-lipo-${v}`));
  if (!lipo) return buf;
  const tmp = mk(path.join(CACHE, 'thin')), a = path.join(tmp, 'fat'), b = path.join(tmp, 'thin');
  fs.writeFileSync(a, buf);
  sh(lipo, [a, '-thin', ARCH === 'x64' ? 'x86_64' : ARCH, '-output', b]);
  return fs.readFileSync(b);
}

async function binaries() {
  mk(BIN);
  const ex = WIN ? '.exe' : '';
  for (const n of ['ffmpeg', 'ffprobe']) {
    const dest = path.join(BIN, n + ex);
    if (has(dest)) continue;
    fs.writeFileSync(dest, zlib.gunzipSync(fs.readFileSync(await get(`${FF}/${n}-${PLAT}-${ARCH}.gz`))), { mode: 0o755 });
  }
  if (PLAT === 'darwin' && !has(path.join(BIN, 'lime-ocr'))) {
    const swiftc = which('swiftc');
    if (swiftc) sh(swiftc, ['-O', '-target', `${ARCH === 'x64' ? 'x86_64' : 'arm64'}-apple-macos12.0`, '-o', path.join(BIN, 'lime-ocr'), path.join(ROOT, 'scripts', 'lime-ocr.swift')]);
    else console.warn('! swiftc is not installed, so this build reads text with tesseract instead of Apple Vision');
  }
  if (PLAT === 'darwin' && !has(path.join(BIN, '7zz'))) {
    const tmp = mk(path.join(CACHE, '7zmac'));
    sh(TAR, ['-xJf', await get(`${SEVEN}/7z2604-mac.tar.xz`), '-C', tmp, '7zz']);
    fs.writeFileSync(path.join(BIN, '7zz'), thin(fs.readFileSync(path.join(tmp, '7zz'))), { mode: 0o755 });
  }
  if (WIN && !has(path.join(BIN, '7z.dll'))) {
    const z = which('7zz', '7z', '7za');
    if (!z) throw new Error('Install 7-Zip on this machine to unpack the Windows 7-Zip engine.');
    sh(z, ['e', await get(`${SEVEN}/7z2604-x64.exe`), `-o${BIN}`, '7z.exe', '7z.dll', '-y']);
  }
  if (PLAT === 'linux' && !has(path.join(BIN, '7zz'))) {
    sh(TAR, ['-xJf', await get(`${SEVEN}/7z2604-linux-${ARCH === 'arm64' ? 'arm64' : 'x64'}.tar.xz`), '-C', BIN, '7zz']);
  }
}

async function crafts() {
  mk(CRAFTS);
  const manifest = {};
  await Promise.all(Object.entries(CRAFT).map(async ([id, v]) => {
    const exe = `${id}-cli${WIN ? '.exe' : ''}`, dest = path.join(CRAFTS, `${exe}.br`);
    manifest[id] = v;
    if (has(dest) || has(path.join(CRAFTS, exe))) return;
    const rel = `https://github.com/storytold/${id}/releases/download/v${v}`;
    let buf;
    if (PLAT === 'darwin') buf = thin(Buffer.from(unzipOne(await get(`${rel}/${id}-cli-${v}-macos-universal.zip`), new RegExp(`/${exe}$`))));
    else if (WIN) buf = Buffer.from(unzipOne(await get(`${rel}/${id}-${v}-windows-${ARCH}-portable.zip`), new RegExp(`/${exe.replace('.', '\\.')}$`)));
    else {
      const a = ARCH === 'arm64' ? 'aarch64' : 'x86_64', tmp = mk(path.join(CACHE, `${id}-linux`));
      sh(TAR, ['-xzf', await get(`${rel}/${id === 'pdfcraft' ? 'pdfcraft-cli' : id}-${v}-linux-${a}.tar.gz`), '-C', tmp]);
      const find = (d) => fs.readdirSync(d, { withFileTypes: true }).map((e) => path.join(d, e.name)).flatMap((p) => fs.statSync(p).isDirectory() ? find(p) : path.basename(p) === exe ? [p] : []);
      buf = fs.readFileSync(find(tmp)[0]);
    }
    console.log('⧉', exe, `${(buf.length / 1048576).toFixed(0)} MB`);
    await brotli(buf, dest);
  }));
  fs.writeFileSync(path.join(CRAFTS, 'manifest.json'), JSON.stringify(manifest));
}

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.isFile() ? [path.join(d, e.name)] : []));
function appFromDmg(dmg, tmp) {
  if (process.platform === 'darwin') {
    const mnt = mk(path.join(tmp, 'mnt'));
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-noverify', '-noautoopen', '-mountpoint', mnt, dmg], { input: 'Y\n', stdio: ['pipe', 'ignore', 'inherit'] });
    try {
      const name = fs.readdirSync(mnt).find((n) => n.endsWith('.app'));
      if (!name) throw new Error(`no app in ${path.basename(dmg)}`);
      sh('ditto', ['--arch', ARCH === 'x64' ? 'x86_64' : 'arm64', path.join(mnt, name), path.join(tmp, name)]);
      return path.join(tmp, name);
    } finally { try { execFileSync('hdiutil', ['detach', mnt, '-force'], { stdio: 'ignore' }); } catch (_) {} }
  }
  const z = which('7zz', '7z');
  if (!z) throw new Error('Install 7-Zip to unpack the Mac apps on this machine.');
  sh(z, ['x', '-y', `-o${path.join(tmp, 'x')}`, '-xr!Applications', dmg]);
  const plist = walk(path.join(tmp, 'x')).find((f) => /\.app[\\/]Contents[\\/]Info\.plist$/.test(f));
  if (!plist) throw new Error(`no app in ${path.basename(dmg)}`);
  const app = path.dirname(path.dirname(plist));
  for (const f of walk(app)) {
    const buf = fs.readFileSync(f);
    if (buf.length > 4 && buf.readUInt32BE(0) === 0xcafebabe) fs.writeFileSync(f, thin(buf));
    if (/[\\/]Contents[\\/]MacOS[\\/]/.test(f)) fs.chmodSync(f, 0o755);
  }
  return app;
}
async function apps() {
  if (PLAT !== 'darwin' && !WIN) return;
  mk(APPS);
  const file = path.join(APPS, 'manifest.json');
  const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  for (const [id, v] of Object.entries(CRAFT)) {
    const dest = path.join(APPS, `${id}.app.tar.br`);
    if (has(dest) && manifest[id]?.version === v) continue;
    const rel = `https://github.com/storytold/${id}/releases/download/v${v}`;
    const tmp = path.join(CACHE, `${id}-app`);
    fs.rmSync(tmp, { recursive: true, force: true });
    let app;
    if (WIN) {
      const skip = new RegExp(`/(${id}-cli\\.exe|portable\\.txt)$`);
      const zip = unzipSync(fs.readFileSync(await get(`${rel}/${id}-${v}-windows-${ARCH}-portable.zip`)), { filter: (f) => !f.name.endsWith('/') && !skip.test(f.name) });
      app = mk(path.join(tmp, id));
      for (const [name, data] of Object.entries(zip)) { const out = path.join(app, ...name.split('/').slice(1)); mk(path.dirname(out)); fs.writeFileSync(out, data); }
    } else app = appFromDmg(await get(`${rel}/${id}-${v}-macos-universal.dmg`), mk(tmp));
    const tar = path.join(tmp, 'app.tar');
    sh(TAR, ['-cf', tar, '-C', path.dirname(app), path.basename(app)]);
    await brotli(fs.readFileSync(tar), dest, 9);
    fs.rmSync(tmp, { recursive: true, force: true });
    manifest[id] = { version: v, file: WIN ? `${id}/${id}.exe` : path.basename(app) };
    console.log('▣', manifest[id].file, `${(fs.statSync(dest).size / 1048576).toFixed(0)} MB`);
    fs.writeFileSync(file, JSON.stringify(manifest));
  }
}

async function data() {
  for (const [n, u] of Object.entries(FONTS)) await put(u, path.join(DATA, 'fonts', n));
  await put(`${TESS}/tessdata_best/main/eng.traineddata`, path.join(DATA, 'tessdata', 'eng.traineddata'));
  for (const l of LANGS) await put(`${TESS}/tessdata_fast/main/${l}.traineddata`, path.join(DATA, 'tessdata', `${l}.traineddata`));
}

async function natives() {
  const opt = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/sharp/package.json'), 'utf8')).optionalDependencies;
  const want = Object.keys(opt).filter((n) => n.endsWith(`-${PLAT}-${ARCH}`));
  for (const n of want) {
    const dest = path.join(NPM, n);
    if (fs.existsSync(path.join(dest, 'package.json'))) continue;
    const r = await (await fetch(`https://registry.npmjs.org/${n}/${opt[n]}`, { signal: AbortSignal.timeout(60000) })).json();
    const tgz = await get(r.dist.tarball, `${n.replace('/', '-')}-${opt[n]}.tgz`);
    mk(dest);
    sh(TAR, ['-xzf', tgz, '-C', dest, '--strip-components=1']);
  }
}

const only = process.argv[3];
if (!only || only === 'engines') await Promise.all([binaries(), data(), natives()]);
if (!only || only === 'crafts') await crafts();
if (!only || only === 'apps') await apps();
fs.rmSync(path.join(CACHE, 'thin'), { recursive: true, force: true });
console.log('✓ engines ready for', TARGET);
