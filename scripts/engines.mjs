import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { patchDeckcraft } from './patch-deckcraft.mjs';

const require = createRequire(import.meta.url);
const { unzipSync } = require('fflate');
const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET = process.argv[2] || `${process.platform}-${process.arch}`;
const [PLAT, ARCH] = TARGET.split('-');
const WIN = PLAT === 'win32';
const V = process.env.LIME_VENDOR || path.join(ROOT, 'vendor');
const CACHE = path.join(V, '.cache');
const AI = path.join(V, 'ai', TARGET);
const WEBS = path.join(V, 'web'), BIN = path.join(V, 'bin', TARGET), CRAFTS = path.join(V, 'crafts', TARGET), APPS = path.join(V, 'apps', TARGET), HELPERS = path.join(V, 'helpers', TARGET), DATA = path.join(V, 'data'), NPM = path.join(V, 'npm', TARGET);
const CRAFT = { photocraft: '0.10.0', vectorcraft: '0.13.1', filmcraft: '0.9.0', lightcraft: '0.9.1', pdfcraft: '0.9.0', effectcraft: '0.11.1', designcraft: '0.9.0', cadcraft: '0.10.0', soundcraft: '0.10.0', wordcraft: '0.9.0', gridcraft: '0.9.0', deckcraft: '0.9.0' };
const REPO = { gridcraft: 'sheetcraft', deckcraft: 'slidecraft' };
// SolidCraft (MIT OR Apache-2.0) publishes the same kinds of release files as the ArtCraft apps, from its own repository.
// It isn't ours, so every file it's built from is pinned by SHA-256 (from its release's SHA256SUMS.txt).
CRAFT.solidcraft = '0.19.0';
const OWNER = { solidcraft: 'bherbruck/solidcraft' };
const PINS = {
  'solidcraft-0.19.0-macos-universal.dmg': 'cc704fce1497e9f51731614f0cf529c41bc8cb0ba9ef3b7b1e369490afe1d195',
  'solidcraft-cli-0.19.0-macos-universal.zip': 'e9ec50c3a838336feeffd7028dc2594fef791cdfee3ccbf5cbf235f78ba88245',
  'solidcraft-0.19.0-windows-x64-portable.zip': 'e4eb659123be862a5642c7b7828e18f94a91ecbc4b147e6ee71319cf410a79ec',
  'solidcraft-0.19.0-windows-arm64-portable.zip': '5280c9045673d6ac88ca3665800f749abe57b0af542ab1e34f324a3e1ed8ac31',
  'solidcraft-0.19.0-linux-x86_64.tar.gz': '1e3650237a617667f557a16e865bbf544b20ece1dec39f7c380239d7058d632d',
  'solidcraft-0.19.0-linux-aarch64.tar.gz': '109a495c3a6049edd790304f5bd6abbd0abd79063120adf3847ca9c305f375c6',
  'solidcraft-web-0.19.0.zip': '79fb985db8c564b879cadb313cc224910d798974259560a9e124211d4348360a',
};
const release = (id, v) => `https://github.com/${OWNER[id] || `storytold/${REPO[id] || id}`}/releases/download/v${v}`;
// A release file: pinned ones are checked, and a third-party app missing a file for this platform is left out, not fatal.
const asset = (url) => { const sha = PINS[decodeURIComponent(path.basename(new URL(url).pathname))]; return sha ? pinned(url, sha) : get(url); };
const optional = (id, e) => { if (!OWNER[id]) throw e; console.warn(`! ${id} is left out of this ${TARGET} build: ${e.message}`); return null; };
// LIME_CRAFTS_ONLY=solidcraft,blender builds just those apps (for trying one out).
const ONLY = process.env.LIME_CRAFTS_ONLY?.split(',');
if (ONLY) for (const id of Object.keys(CRAFT)) if (!ONLY.includes(id)) delete CRAFT[id];
const WEB = ['cadcraft', 'gridcraft', 'wordcraft', 'soundcraft', 'deckcraft', 'solidcraft'].filter((id) => CRAFT[id]);
const FF = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1';
const SEVEN = 'https://github.com/ip7z/7zip/releases/download/26.04';
const NOTO = 'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts';
const GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl';
const TESS = 'https://raw.githubusercontent.com/tesseract-ocr';
// Speech models come from k2-fsa/sherpa-onnx's releases (see ai() below); dictation adds Silero VAD (MIT).
const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const VAD = { url: `${SHERPA}/asr-models/silero_vad.onnx`, sha: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6' };
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

const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);
// Quality 11 with a large window takes about ten minutes per app, so the archives are made a few at a time.
const pool = async (items, fn, n = 4) => { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); };
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
// A 256 MB window (large-window brotli) lets an archive's second binary reuse the first: an app and its
// CLI share most of their code, so together they pack a third smaller than apart.
const brotli = (buf, dest, q = 11, large = false) => new Promise((ok, no) => zlib.brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: q, [zlib.constants.BROTLI_PARAM_LGWIN]: large ? 28 : 24, [zlib.constants.BROTLI_PARAM_LARGE_WINDOW]: large ? 1 : 0, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }, (e, out) => e ? no(e) : ok(fs.writeFileSync(dest, out))));

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

// The CLI engine's bytes for this target.
async function cliBuffer(id, v) {
  const exe = `${id}-cli${WIN ? '.exe' : ''}`, rel = release(id, v);
  if (PLAT === 'darwin') return thin(Buffer.from(unzipOne(await asset(`${rel}/${id}-cli-${v}-macos-universal.zip`), new RegExp(`/${exe}$`))));
  if (WIN) return Buffer.from(unzipOne(await asset(`${rel}/${id}-${v}-windows-${ARCH}-portable.zip`), new RegExp(`/${exe.replace('.', '\\.')}$`)));
  const a = ARCH === 'arm64' ? 'aarch64' : 'x86_64', tmp = mk(path.join(CACHE, `${id}-linux`));
  sh(TAR, ['-xzf', await asset(`${rel}/${id === 'pdfcraft' ? 'pdfcraft-cli' : id}-${v}-linux-${a}.tar.gz`), '-C', tmp]);
  const find = (d) => fs.readdirSync(d, { withFileTypes: true }).map((e) => path.join(d, e.name)).flatMap((p) => fs.statSync(p).isDirectory() ? find(p) : path.basename(p) === exe ? [p] : []);
  return fs.readFileSync(find(tmp)[0]);
}
async function crafts() {
  mk(CRAFTS);
  const manifest = { ...CRAFT };
  // On Mac and Windows the CLI ships inside its app's archive (see apps), so only the versions are written here.
  // (Braced: the else used to pair with the inner if, so Linux never built its engines here.)
  if (PLAT === 'darwin' || WIN) { for (const f of ls(CRAFTS)) if (f !== 'manifest.json') fs.rmSync(path.join(CRAFTS, f), { force: true }); }
  else await Promise.all(Object.entries(CRAFT).map(async ([id, v]) => {
    const exe = `${id}-cli`, dest = path.join(CRAFTS, `${exe}.br`);
    if (has(dest) || has(path.join(CRAFTS, exe))) return;
    const buf = await cliBuffer(id, v).catch((e) => optional(id, e));
    if (!buf) { delete manifest[id]; return; }
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
  // The outermost app: Blender's bundle has others inside it.
  const plist = walk(path.join(tmp, 'x')).filter((f) => /\.app[\\/]Contents[\\/]Info\.plist$/.test(f)).sort((a, b) => a.length - b.length)[0];
  if (!plist) throw new Error(`no app in ${path.basename(dmg)}`);
  const app = path.dirname(path.dirname(plist));
  for (const f of walk(app)) {
    const buf = fs.readFileSync(f);
    if (buf.length > 4 && buf.readUInt32BE(0) === 0xcafebabe) fs.writeFileSync(f, thin(buf));
    if (/[\\/]Contents[\\/]MacOS[\\/]/.test(f)) fs.chmodSync(f, 0o755);
  }
  return app;
}
// One archive per app: the app and its CLI engine together, so the shared code is stored once.
async function apps() {
  if (PLAT !== 'darwin' && !WIN) return;
  mk(APPS);
  const file = path.join(APPS, 'manifest.json');
  const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  await pool(Object.entries(CRAFT), async ([id, v]) => {
    const dest = path.join(APPS, `${id}.tar.br`), cli = `${id}-cli${WIN ? '.exe' : ''}`;
    if (has(dest) && manifest[id]?.version === v && manifest[id]?.cli === cli) return;
    const rel = release(id, v);
    const tmp = path.join(CACHE, `${id}-app`);
    fs.rmSync(tmp, { recursive: true, force: true });
    let app;
    try {
      if (WIN) {
        const skip = new RegExp(`/(${id}-cli\\.exe|portable\\.txt)$`);
        const zip = unzipSync(fs.readFileSync(await asset(`${rel}/${id}-${v}-windows-${ARCH}-portable.zip`)), { filter: (f) => !f.name.endsWith('/') && !skip.test(f.name) });
        app = mk(path.join(tmp, id));
        for (const [name, data] of Object.entries(zip)) { const out = path.join(app, ...name.split('/').slice(1)); mk(path.dirname(out)); fs.writeFileSync(out, data); }
      } else app = appFromDmg(await asset(`${rel}/${id}-${v}-macos-universal.dmg`), mk(tmp));
      fs.writeFileSync(path.join(tmp, cli), await cliBuffer(id, v), { mode: 0o755 });
    } catch (e) {
      optional(id, e);
      fs.rmSync(tmp, { recursive: true, force: true });
      delete manifest[id];
      return;
    }
    const tar = path.join(CACHE, `${id}-app.tar`);
    sh(TAR, ['-cf', tar, '-C', tmp, cli, '-C', path.dirname(app), path.basename(app)]);
    await brotli(fs.readFileSync(tar), dest, 11, true);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tar, { force: true });
    manifest[id] = { version: v, file: WIN ? `${id}/${id}.exe` : path.basename(app), cli };
    console.log('▣', manifest[id].file, '+', cli, `${(fs.statSync(dest).size / 1048576).toFixed(0)} MB`);
    fs.writeFileSync(file, JSON.stringify(manifest));
  });
  await blender(manifest);
  fs.writeFileSync(file, JSON.stringify(manifest));
  for (const f of ls(APPS)) if (f !== 'manifest.json' && !Object.keys(manifest).some((id) => f === `${id}.tar.br`)) fs.rmSync(path.join(APPS, f), { force: true });
}

// Blender LTS (GPL-2.0-or-later), the official build, pinned by SHA-256 (the Homebrew and Scoop manifests carry the same sums as
// blender.org's .sha256 files). Lime ships it as an app like the others, trimmed of what it never uses (scripts/blender-trim.mjs).
const BLENDER = {
  version: '5.2.2',
  'darwin-arm64': { url: 'https://download.blender.org/release/Blender5.2/blender-5.2.2-macos-arm64.dmg', sha: 'dc4125399b8bfefe283cc1624d6cfc7809d1cac20ace51072127eb371f31f210' },
  'win32-x64': { url: 'https://download.blender.org/release/Blender5.2/blender-5.2.2-windows-x64.zip', sha: '3849d17a682cba006075aaa3f3597ecb5c9c30ec31035b2e092c53e40679b535' },
};
const BLENDER_TRIM = 1; // bump when blender-trim.mjs changes, so the archive is made again
async function blender(manifest) {
  const B = BLENDER[TARGET], dest = path.join(APPS, 'blender.tar.br'), version = `${BLENDER.version}-t${BLENDER_TRIM}`;
  if (!B || process.env.LIME_NO_BLENDER) { delete manifest.blender; return; }
  if (ONLY && !ONLY.includes('blender')) return;
  if (has(dest) && manifest.blender?.version === version) return;
  const { trimBlender } = await import('./blender-trim.mjs');
  const tmp = path.join(CACHE, 'blender-app');
  fs.rmSync(tmp, { recursive: true, force: true });
  mk(tmp);
  const src = await pinned(B.url, B.sha);
  let root, file, cli;
  if (WIN) {
    const z = which('7zz', '7z');
    if (z) sh(z, ['x', '-y', `-o${tmp}`, src]);
    else if (process.platform !== 'linux') sh(TAR, ['-xf', src, '-C', tmp]);
    else throw new Error('Install 7-Zip to unpack Blender for Windows on this machine.');
    const top = fs.readdirSync(tmp).find((n) => /^blender-/.test(n));
    if (!top) throw new Error('Blender for Windows: the zip has no blender folder');
    root = path.join(tmp, 'blender');
    fs.renameSync(path.join(tmp, top), root);
    [file, cli] = ['blender/blender-launcher.exe', 'blender/blender.exe'];
  } else {
    root = appFromDmg(src, tmp);
    [file, cli] = [path.basename(root), `${path.basename(root)}/Contents/MacOS/Blender`];
  }
  const freed = trimBlender(root);
  const tar = path.join(CACHE, 'blender-app.tar');
  sh(TAR, ['-cf', tar, '-C', path.dirname(root), path.basename(root)]);
  fs.rmSync(tmp, { recursive: true, force: true });
  await brotli(fs.readFileSync(tar), dest, 11, true);
  fs.rmSync(tar, { force: true });
  manifest.blender = { version, file, cli };
  console.log('▣', file, BLENDER.version, `trimmed ${(freed / 1048576).toFixed(0)} MB,`, `${(fs.statSync(dest).size / 1048576).toFixed(0)} MB`);
}

async function webs() {
  mk(WEBS);
  const file = path.join(WEBS, 'manifest.json');
  const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  await pool(WEB, async (id) => {
    const v = CRAFT[id], dest = path.join(WEBS, `${id}.tar.br`);
    const ver = id === 'deckcraft' ? `${v}-p1` : v;
    if (has(dest) && manifest[id]?.version === ver) return;
    const web = await asset(`${release(id, v)}/${id}-web-${v}.zip`).catch((e) => optional(id, e));
    if (!web) return;
    const zip = unzipSync(fs.readFileSync(web), { filter: (f) => !f.name.endsWith('/') });
    const tmp = path.join(CACHE, `${id}-web`);
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const [name, buf] of Object.entries(zip)) { const out = path.join(tmp, 'site', ...name.split('/').slice(1)); mk(path.dirname(out)); fs.writeFileSync(out, buf); }
    if (id === 'deckcraft' && patchDeckcraft(path.join(tmp, 'site'))) console.log('◎', 'deckcraft web: patched the start-up panic (instance_id)');
    const tar = path.join(CACHE, `${id}-web.tar`);
    sh(TAR, ['-cf', tar, '-C', tmp, 'site']);
    await brotli(fs.readFileSync(tar), dest);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tar, { force: true });
    manifest[id] = { version: ver };
    console.log('◎', `${id} web`, `${(fs.statSync(dest).size / 1048576).toFixed(0)} MB`);
    fs.writeFileSync(file, JSON.stringify(manifest));
  });
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

const sha256 = (f) => new Promise((ok, no) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', no); });
async function pinned(url, sha) {
  const f = await get(url);
  const got = await sha256(f);
  if (got !== sha) { fs.rmSync(f, { force: true }); throw new Error(`${path.basename(f)}: SHA-256 ${got} isn't the pinned ${sha}`); }
  return f;
}
const packDir = async (dir, dest) => {
  const tar = `${dest}.tar`;
  sh(TAR, ['-cf', tar, '-C', dir, '.']);
  await new Promise((ok, no) => fs.createReadStream(tar).pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } })).pipe(fs.createWriteStream(dest)).on('finish', ok).on('error', no));
  fs.rmSync(tar, { force: true });
};
// Dictation's voice-activity model; Whisper itself is in vendor/ai, built by ai().
async function speech() {
  const DICT = path.join(V, 'dictate', TARGET);
  mk(DICT);
  const read = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')); } catch { return {}; } };
  const dict = read(DICT);
  const vadDest = path.join(DICT, 'vad.tar.br');
  if (!has(vadDest) || dict.vad?.version !== VAD.sha.slice(0, 8)) {
    const out = path.join(CACHE, 'vad');
    fs.rmSync(out, { recursive: true, force: true });
    fs.copyFileSync(await pinned(VAD.url, VAD.sha), path.join(mk(out), 'silero_vad.onnx'));
    await packDir(out, vadDest);
    fs.rmSync(out, { recursive: true, force: true });
    dict.vad = { version: VAD.sha.slice(0, 8), file: 'silero_vad.onnx' };
    fs.writeFileSync(path.join(DICT, 'manifest.json'), JSON.stringify(dict));
    console.log('◉', 'silero vad', `${(fs.statSync(vadDest).size / 1024).toFixed(0)} KB`);
  }
}

async function helpers() {
  const H = createRequire(import.meta.url)('../src/main/helpers.js');
  mk(HELPERS);
  const file = path.join(HELPERS, 'manifest.json');
  const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  for (const id of PLAT === 'darwin' || WIN ? ['soffice', 'pandoc'] : ['pandoc']) {
    const dest = path.join(HELPERS, `${id}.tar.br`), v = await H.latest(id);
    if (has(dest) && manifest[id]?.version === v) continue;
    const tmp = mk(path.join(CACHE, `${id}-helper`));
    fs.rmSync(tmp, { recursive: true, force: true });
    mk(tmp);
    const exe = await H.HELPERS[id].unpack(await get(H.HELPERS[id].url(v)), tmp);
    if (!exe) throw new Error(`${id}: the program was not in the download`);
    const root = id === 'soffice' ? (WIN ? path.dirname(path.dirname(exe)) : path.join(tmp, 'LibreOffice.app')) : path.join(tmp, path.relative(tmp, exe).split(/[\\/]/)[0]);
    const tar = path.join(CACHE, `${id}.tar`);
    sh(TAR, ['-cf', tar, '-C', path.dirname(root), path.basename(root)]);
    await new Promise((ok, no) => fs.createReadStream(tar).pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_LGWIN]: 28, [zlib.constants.BROTLI_PARAM_LARGE_WINDOW]: 1 } })).pipe(fs.createWriteStream(dest)).on('finish', ok).on('error', no));
    fs.rmSync(tar, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    manifest[id] = { version: v, file: path.relative(path.dirname(root), exe) };
    console.log('▣', manifest[id].file, v, `${(fs.statSync(dest).size / 1048576).toFixed(0)} MB`);
    fs.writeFileSync(file, JSON.stringify(manifest));
  }
}

// The speech and music models: the same bytes on every platform, packed per target so an installer carries one
// copy. Each becomes <id>.tar.br, unpacked into userData on first use. SHA-256 pins every download.
const PIPER = { 'en-GB': 'en_GB-alba-medium', 'en-US': 'en_US-lessac-medium', ar: 'ar_JO-kareem-medium', hi: 'hi_IN-rohan-medium', fr: 'fr_FR-siwis-medium', de: 'de_DE-thorsten-medium', es: 'es_ES-davefx-medium' };
const PIPER_SHA = { 'en-GB': 'f7581d123ae977f64f3032bb247d4deeac8440e881d918d36fdd36d8f1030fb7', 'en-US': 'f1c6d0295cf16087b05f80fdca5b44daca5cd78e2c425d419a42ba34929805f9', ar: '215910431bbe8236b77242b19d869a4eda6073e9cd424bec45b6d4a59a790d82', hi: 'b306822fe16516d3c882e070a7205d781524bd9e8f2d121c3da3e504afe20e05',
  fr: '3909cff9b3cfd4820c66aa13bf554315c82e34899c161f0b446ece372bc4b5ec', de: '07e240b7b9c1fc9211d5a69512f8cbe11b3286c2ed79c15c076ac6ed427fdf13', es: '8bb8ac1cefb727caec9bd9c6c3185c673c8b42c53bd29bb25d5a7715dac37125' };
const AI_MODELS = {
  whisper: { version: 'base-int8', url: `${SHERPA}/asr-models/sherpa-onnx-whisper-base.tar.bz2`, sha: '911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de', pick: { 'encoder.onnx': 'base-encoder.int8.onnx', 'decoder.onnx': 'base-decoder.int8.onnx', 'tokens.txt': 'base-tokens.txt' }, whisper: true },
  'whisper-small': { version: 'small-int8', url: `${SHERPA}/asr-models/sherpa-onnx-whisper-small.tar.bz2`, sha: '486a46afbb7ba798507190ffe02fea2dd726049af212e774537efac6afb210a6', pick: { 'encoder.onnx': 'small-encoder.int8.onnx', 'decoder.onnx': 'small-decoder.int8.onnx', 'tokens.txt': 'small-tokens.txt' }, whisper: true },
  denoise: { version: 'DeepFilterNet3', url: 'https://raw.githubusercontent.com/Rikorose/DeepFilterNet/v0.5.6/models/DeepFilterNet3_onnx.tar.gz', sha: 'c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616', pick: { 'enc.onnx': 'enc.onnx', 'erb_dec.onnx': 'erb_dec.onnx', 'df_dec.onnx': 'df_dec.onnx' } },
  stems: { version: 'spleeter-2stems-fp16', url: `${SHERPA}/source-separation-models/sherpa-onnx-spleeter-2stems-fp16.tar.bz2`, sha: 'd54561979bd2e08a51e7dbd99ac36bb47564e089eefd403636dbca93e811bba2', pick: { 'vocals.onnx': 'vocals.fp16.onnx', 'accompaniment.onnx': 'accompaniment.fp16.onnx' } },
  espeak: { version: '0.3.5', url: 'https://registry.npmjs.org/@echogarden/espeak-ng-emscripten/-/espeak-ng-emscripten-0.3.5.tgz', sha: '6b0bac048e123de9a690e3fe79346ed377c18797e9b09c3e0d8761a3ac00abe6', pick: { 'espeak-ng.js': 'espeak-ng.js', 'espeak-ng.data': 'espeak-ng.data', COPYING: 'COPYING' } },
  ...Object.fromEntries(Object.entries(PIPER).map(([lang, v]) => [`voice-${lang}`, { version: v, url: `${SHERPA}/tts-models/vits-piper-${v}-int8.tar.bz2`, sha: PIPER_SHA[lang], pick: { 'voice.onnx': `${v}.onnx`, 'voice.onnx.json': `${v}.onnx.json`, MODEL_CARD: 'MODEL_CARD' } }])),
};
async function ai() {
  mk(AI);
  const file = path.join(AI, 'manifest.json');
  const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  // Small reads Hindi and other languages far better than base, at about 200 MB more: opt in with LIME_WHISPER_SMALL=1.
  const want = process.env.LIME_AI_ONLY ? process.env.LIME_AI_ONLY.split(',') : Object.keys(AI_MODELS).filter((id) => id !== 'whisper-small' || process.env.LIME_WHISPER_SMALL);
  for (const id of want) {
    const M = AI_MODELS[id], dest = path.join(AI, `${id}.tar.br`);
    if (has(dest) && manifest[id]?.version === M.version) continue;
    const archive = await get(M.url), sum = await sha256(archive);
    if (sum !== M.sha) { fs.rmSync(archive, { force: true }); throw new Error(`${id}: ${path.basename(M.url)} does not match its pinned SHA-256 (got ${sum})`); }
    const tmp = path.join(CACHE, `${id}-ai`);
    fs.rmSync(tmp, { recursive: true, force: true });
    const x = mk(path.join(tmp, 'x')), out = mk(path.join(tmp, id));
    sh(TAR, ['-xf', archive, '-C', x]);
    const all = walk(x);
    for (const [name, from] of Object.entries(M.pick)) {
      const src = all.find((f) => path.basename(f) === from);
      if (!src) throw new Error(`${id}: ${from} is not in ${path.basename(M.url)}`);
      fs.renameSync(src, path.join(out, name));
    }
    if (M.whisper) {
      const { slim, metadata } = await import('./whisper-slim.mjs');
      fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(metadata(fs.readFileSync(path.join(out, 'encoder.onnx')))));
      fs.writeFileSync(path.join(out, 'decoder.onnx'), slim(fs.readFileSync(path.join(out, 'decoder.onnx'))));
    }
    fs.rmSync(x, { recursive: true, force: true });
    await new Promise((ok, no) => { const tar = spawn(TAR, ['-cf', '-', '-C', tmp, id], { stdio: ['ignore', 'pipe', 'inherit'] }); tar.on('error', no); tar.stdout.pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } })).pipe(fs.createWriteStream(dest)).on('finish', ok).on('error', no); });
    fs.rmSync(tmp, { recursive: true, force: true });
    if (process.env.LIME_AI_TIDY) fs.rmSync(archive, { force: true });
    manifest[id] = { version: M.version, file: `${id}/${Object.keys(M.pick)[0]}` };
    console.log('♪', id, `${(fs.statSync(dest).size / 1048576).toFixed(1)} MB`);
    fs.writeFileSync(file, JSON.stringify(manifest));
  }
}

// Upscale and object-removal models, the same for every platform. scripts/models.py writes them as ONNX from the
// published PyTorch weights (it needs Python 3 with numpy and onnx, fetched here if missing).
const MODELS_V = '1';
const MODELS = {
  upscale: {
    'photo.onnx': ['compact', 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth', '8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292'],
    'drawing.onnx': ['compact', 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-animevideov3.pth', 'b8a8376811077954d82ca3fcf476f1ac3da3e8a68a4f4d71363008000a18b75d'],
  },
  lama: { 'lama.onnx': ['lama', 'https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt', '344c77bbcb158f17dd143070d1e789f38a66c04202311ae3a258ef66667a9ea9'] },
};
async function models() {
  const dir = mk(path.join(V, 'models')), file = path.join(dir, 'manifest.json');
  const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const todo = Object.keys(MODELS).filter((id) => !(has(path.join(dir, `${id}.tar.br`)) && manifest[id]?.version === MODELS_V));
  if (!todo.length) return;
  const py = which('python3', 'python'), env = { ...process.env };
  if (!py) throw new Error('Python 3 is needed to build the upscale and object-removal models');
  try { execFileSync(py, ['-c', 'import numpy, onnx'], { stdio: 'ignore' }); } catch {
    const lib = path.join(CACHE, 'py');
    sh(py, ['-m', 'pip', 'install', '--quiet', '--target', lib, 'numpy>=1.26', 'onnx>=1.16,<2']);
    env.PYTHONPATH = lib;
  }
  for (const id of todo) {
    const tmp = path.join(CACHE, `${id}-model`);
    fs.rmSync(tmp, { recursive: true, force: true });
    mk(tmp);
    for (const [name, [kind, url, sum]] of Object.entries(MODELS[id])) {
      const src = await get(url);
      if (crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex') !== sum) { fs.rmSync(src); throw new Error(`${url}: the download doesn't match its checksum`); }
      execFileSync(py, [path.join(ROOT, 'scripts', 'models.py'), kind, src, path.join(tmp, name)], { stdio: ['ignore', 'ignore', 'inherit'], env });
    }
    const tar = path.join(CACHE, `${id}.tar`), dest = path.join(dir, `${id}.tar.br`);
    sh(TAR, ['-cf', tar, '-C', tmp, ...Object.keys(MODELS[id])]);
    await new Promise((ok, no) => fs.createReadStream(tar).pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } })).pipe(fs.createWriteStream(dest)).on('finish', ok).on('error', no));
    fs.rmSync(tar, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    manifest[id] = { version: MODELS_V, file: Object.keys(MODELS[id])[0] };
    console.log('▣', id, `${(fs.statSync(dest).size / 1048576).toFixed(1)} MB`);
    fs.writeFileSync(file, JSON.stringify(manifest));
  }
}

// Ghostscript as WebAssembly (one build for every platform; fonts and colour profiles are inside it).
const GS = { version: '10.06.0', url: 'https://registry.npmjs.org/@okathira/ghostpdl-wasm/-/ghostpdl-wasm-1.1.0.tgz', sha256: '1c266b526354429272b0a446b3340d86d3652a563a453b2550a2ef32bec4084d' };
async function codecs() {
  const dir = mk(path.join(V, 'codecs', TARGET)), file = path.join(dir, 'manifest.json'), dest = path.join(dir, 'ghostscript.tar.br');
  const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  // The version is in the folder name, so a newer build unpacks beside the old one rather than being skipped.
  const top = `ghostscript-${GS.version}`;
  if (has(dest) && manifest.ghostscript?.file === `${top}/gs.mjs`) return;
  const tgz = await get(GS.url, 'ghostpdl-wasm-1.1.0.tgz');
  const sum = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(tgz)).digest('hex');
  if (sum !== GS.sha256) throw new Error(`ghostpdl-wasm: SHA-256 ${sum} is not the pinned ${GS.sha256}`);
  const tmp = path.join(CACHE, 'gs');
  fs.rmSync(tmp, { recursive: true, force: true });
  mk(path.join(tmp, top));
  sh(TAR, ['-xzf', tgz, '-C', path.join(tmp, top), '--strip-components=2', 'package/dist/gs.js', 'package/dist/gs.wasm']);
  sh(TAR, ['-xzf', tgz, '-C', path.join(tmp, top), '--strip-components=1', 'package/LICENSE']);
  fs.renameSync(path.join(tmp, top, 'gs.js'), path.join(tmp, top, 'gs.mjs'));
  const tar = path.join(CACHE, 'gs.tar');
  sh(TAR, ['-cf', tar, '-C', tmp, top]);
  await brotli(fs.readFileSync(tar), dest);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(tar, { force: true });
  manifest.ghostscript = { version: GS.version, file: `${top}/gs.mjs` };
  fs.writeFileSync(file, JSON.stringify(manifest));
  console.log('▣ ghostscript', GS.version, `${(fs.statSync(dest).size / 1048576).toFixed(1)} MB`);
}

const only = process.argv[3];
if (!only || only === 'engines') await Promise.all([binaries(), data(), natives()]);
if (!only || only === 'crafts') await crafts();
if (!only || only === 'apps') await apps();
if (!only || only === 'web') await webs();
if (!only || only === 'helpers') await helpers();
if (!only || only === 'ai') await ai();
if (!only || only === 'models') await models();
if (!only || only === 'codecs') await codecs();
if (!only || only === 'diagrams') { const DV = await import('./diagramvendor.mjs'); await DV.buildDrawio(path.join(V, 'diagrams'), CACHE); await DV.buildTranslate(path.join(V, 'translate'), CACHE); }
if (!only || only === 'speech') await speech();
fs.rmSync(path.join(CACHE, 'thin'), { recursive: true, force: true });
console.log('✓ engines ready for', TARGET);
