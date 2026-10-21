import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

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
const release = (id, v) => `https://github.com/storytold/${REPO[id] || id}/releases/download/v${v}`;
const WEB = ['cadcraft', 'gridcraft', 'wordcraft', 'soundcraft'];
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
    const rel = release(id, v);
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
    const rel = release(id, v);
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

async function webs() {
  mk(WEBS);
  const file = path.join(WEBS, 'manifest.json');
  const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  for (const id of WEB) {
    const v = CRAFT[id], dest = path.join(WEBS, `${id}.tar.br`);
    if (has(dest) && manifest[id]?.version === v) continue;
    const zip = unzipSync(fs.readFileSync(await get(`${release(id, v)}/${id}-web-${v}.zip`)), { filter: (f) => !f.name.endsWith('/') });
    const tmp = path.join(CACHE, `${id}-web`);
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const [name, buf] of Object.entries(zip)) { const out = path.join(tmp, 'site', ...name.split('/').slice(1)); mk(path.dirname(out)); fs.writeFileSync(out, buf); }
    const tar = path.join(CACHE, `${id}-web.tar`);
    sh(TAR, ['-cf', tar, '-C', tmp, 'site']);
    await brotli(fs.readFileSync(tar), dest, 9);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tar, { force: true });
    manifest[id] = { version: v };
    console.log('◎', `${id} web`, `${(fs.statSync(dest).size / 1048576).toFixed(0)} MB`);
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
    await new Promise((ok, no) => fs.createReadStream(tar).pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 7, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } })).pipe(fs.createWriteStream(dest)).on('finish', ok).on('error', no));
    fs.rmSync(tar, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    manifest[id] = { version: v, file: path.relative(path.dirname(root), exe) };
    console.log('▣', manifest[id].file, v, `${(fs.statSync(dest).size / 1048576).toFixed(0)} MB`);
    fs.writeFileSync(file, JSON.stringify(manifest));
  }
}

// The speech and music models: the same bytes on every platform, packed per target so an installer carries one
// copy. Each becomes <id>.tar.br, unpacked into userData on first use. SHA-256 pins every download.
const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
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
const sha256 = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
async function ai() {
  mk(AI);
  const file = path.join(AI, 'manifest.json');
  const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const want = process.env.LIME_AI_ONLY ? process.env.LIME_AI_ONLY.split(',') : Object.keys(AI_MODELS);
  for (const id of want) {
    const M = AI_MODELS[id], dest = path.join(AI, `${id}.tar.br`);
    if (has(dest) && manifest[id]?.version === M.version) continue;
    const archive = await get(M.url), sum = sha256(archive);
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

const only = process.argv[3];
if (!only || only === 'engines') await Promise.all([binaries(), data(), natives()]);
if (!only || only === 'crafts') await crafts();
if (!only || only === 'apps') await apps();
if (!only || only === 'web') await webs();
if (!only || only === 'helpers') await helpers();
if (!only || only === 'ai') await ai();
fs.rmSync(path.join(CACHE, 'thin'), { recursive: true, force: true });
console.log('✓ engines ready for', TARGET);
