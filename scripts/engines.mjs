import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
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
const V = process.env.LIME_VENDOR || path.join(ROOT, 'vendor');
const CACHE = path.join(V, '.cache');
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
// Speech: Whisper (MIT) as int8 ONNX exported by k2-fsa/sherpa-onnx (Apache-2.0), and Silero VAD (MIT).
const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';
const WHISPER = {
  whisper: { name: 'base', sha: '911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de' },
  // Small reads Hindi and translates to English far better than base, at about 200 MB more; opt in with LIME_WHISPER_SMALL=1.
  'whisper-small': { name: 'small', sha: '486a46afbb7ba798507190ffe02fea2dd726049af212e774537efac6afb210a6', optional: 'LIME_WHISPER_SMALL' },
};
const VAD = { url: `${SHERPA}/silero_vad.onnx`, sha: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6' };
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
  if (PLAT === 'darwin') return thin(Buffer.from(unzipOne(await get(`${rel}/${id}-cli-${v}-macos-universal.zip`), new RegExp(`/${exe}$`))));
  if (WIN) return Buffer.from(unzipOne(await get(`${rel}/${id}-${v}-windows-${ARCH}-portable.zip`), new RegExp(`/${exe.replace('.', '\\.')}$`)));
  const a = ARCH === 'arm64' ? 'aarch64' : 'x86_64', tmp = mk(path.join(CACHE, `${id}-linux`));
  sh(TAR, ['-xzf', await get(`${rel}/${id === 'pdfcraft' ? 'pdfcraft-cli' : id}-${v}-linux-${a}.tar.gz`), '-C', tmp]);
  const find = (d) => fs.readdirSync(d, { withFileTypes: true }).map((e) => path.join(d, e.name)).flatMap((p) => fs.statSync(p).isDirectory() ? find(p) : path.basename(p) === exe ? [p] : []);
  return fs.readFileSync(find(tmp)[0]);
}
async function crafts() {
  mk(CRAFTS);
  const manifest = { ...CRAFT };
  // On Mac and Windows the CLI ships inside its app's archive (see apps), so only the versions are written here.
  if (PLAT === 'darwin' || WIN) for (const f of ls(CRAFTS)) if (f !== 'manifest.json') fs.rmSync(path.join(CRAFTS, f), { force: true });
  else await Promise.all(Object.entries(CRAFT).map(async ([id, v]) => {
    const exe = `${id}-cli`, dest = path.join(CRAFTS, `${exe}.br`);
    if (has(dest) || has(path.join(CRAFTS, exe))) return;
    const buf = await cliBuffer(id, v);
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
    if (WIN) {
      const skip = new RegExp(`/(${id}-cli\\.exe|portable\\.txt)$`);
      const zip = unzipSync(fs.readFileSync(await get(`${rel}/${id}-${v}-windows-${ARCH}-portable.zip`)), { filter: (f) => !f.name.endsWith('/') && !skip.test(f.name) });
      app = mk(path.join(tmp, id));
      for (const [name, data] of Object.entries(zip)) { const out = path.join(app, ...name.split('/').slice(1)); mk(path.dirname(out)); fs.writeFileSync(out, data); }
    } else app = appFromDmg(await get(`${rel}/${id}-${v}-macos-universal.dmg`), mk(tmp));
    fs.writeFileSync(path.join(tmp, cli), await cliBuffer(id, v), { mode: 0o755 });
    const tar = path.join(CACHE, `${id}-app.tar`);
    sh(TAR, ['-cf', tar, '-C', tmp, cli, path.basename(app)]);
    await brotli(fs.readFileSync(tar), dest, 11, true);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tar, { force: true });
    manifest[id] = { version: v, file: WIN ? `${id}/${id}.exe` : path.basename(app), cli };
    console.log('▣', manifest[id].file, '+', cli, `${(fs.statSync(dest).size / 1048576).toFixed(0)} MB`);
    fs.writeFileSync(file, JSON.stringify(manifest));
  });
  for (const f of ls(APPS)) if (f !== 'manifest.json' && !Object.keys(CRAFT).some((id) => f === `${id}.tar.br`)) fs.rmSync(path.join(APPS, f), { force: true });
}

async function webs() {
  mk(WEBS);
  const file = path.join(WEBS, 'manifest.json');
  const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  await pool(WEB, async (id) => {
    const v = CRAFT[id], dest = path.join(WEBS, `${id}.tar.br`);
    if (has(dest) && manifest[id]?.version === v) return;
    const zip = unzipSync(fs.readFileSync(await get(`${release(id, v)}/${id}-web-${v}.zip`)), { filter: (f) => !f.name.endsWith('/') });
    const tmp = path.join(CACHE, `${id}-web`);
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const [name, buf] of Object.entries(zip)) { const out = path.join(tmp, 'site', ...name.split('/').slice(1)); mk(path.dirname(out)); fs.writeFileSync(out, buf); }
    const tar = path.join(CACHE, `${id}-web.tar`);
    sh(TAR, ['-cf', tar, '-C', tmp, 'site']);
    await brotli(fs.readFileSync(tar), dest);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tar, { force: true });
    manifest[id] = { version: v };
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
// ONNX metadata (ModelProto field 14) as a plain object, read straight from the protobuf.
function onnxMeta(file) {
  const b = fs.readFileSync(file), out = {};
  const varint = (st) => { let v = 0, m = 1, c; do { c = b[st.i++]; v += (c & 127) * m; m *= 128; } while (c & 128); return v; };
  const st = { i: 0 };
  while (st.i < b.length) {
    const tag = varint(st), field = Math.floor(tag / 8), wire = tag & 7;
    if (wire === 0) { varint(st); continue; }
    if (wire === 1) { st.i += 8; continue; }
    if (wire === 5) { st.i += 4; continue; }
    const len = varint(st), end = st.i + len;
    if (field === 14) {
      const e = { i: st.i }, kv = {};
      while (e.i < end) { const t = varint(e), l = varint(e); kv[t >> 3] = b.toString('utf8', e.i, e.i + l); e.i += l; }
      out[kv[1]] = kv[2];
    }
    st.i = end;
  }
  return out;
}
const packDir = async (dir, dest) => {
  const tar = `${dest}.tar`;
  sh(TAR, ['-cf', tar, '-C', dir, '.']);
  await new Promise((ok, no) => fs.createReadStream(tar).pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } })).pipe(fs.createWriteStream(dest)).on('finish', ok).on('error', no));
  fs.rmSync(tar, { force: true });
};
async function speech() {
  const AI = path.join(V, 'ai', TARGET), DICT = path.join(V, 'dictate', TARGET);
  mk(AI); mk(DICT);
  const read = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')); } catch { return {}; } };
  const ai = read(AI), dict = read(DICT);
  for (const [id, w] of Object.entries(WHISPER)) {
    const dest = path.join(AI, `${id}.tar.br`), version = `${w.name}-int8-${w.sha.slice(0, 8)}`;
    if (w.optional && !process.env[w.optional]) continue;
    if (has(dest) && ai[id]?.version === version) continue;
    const src = await pinned(`${SHERPA}/sherpa-onnx-whisper-${w.name}.tar.bz2`, w.sha);
    const tmp = path.join(CACHE, `${id}-x`), out = path.join(CACHE, id);
    for (const d of [tmp, out]) { fs.rmSync(d, { recursive: true, force: true }); mk(d); }
    const top = `sherpa-onnx-whisper-${w.name}`;
    sh(TAR, ['-xjf', src, '-C', tmp, `${top}/${w.name}-encoder.int8.onnx`, `${top}/${w.name}-decoder.int8.onnx`, `${top}/${w.name}-tokens.txt`]);
    const x = (n) => path.join(tmp, top, `${w.name}-${n}`);
    fs.renameSync(x('encoder.int8.onnx'), path.join(out, 'encoder.onnx'));
    fs.renameSync(x('tokens.txt'), path.join(out, 'tokens.txt'));
    fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(onnxMeta(path.join(out, 'encoder.onnx'))));
    const py = which('python3', 'python');
    try { execFileSync(py, [path.join(ROOT, 'scripts', 'whisper-shrink.py'), x('decoder.int8.onnx'), path.join(out, 'decoder.onnx')], { stdio: 'inherit' }); } catch {
      console.warn(`! python with onnx isn't installed, so the ${w.name} decoder ships with its fp32 token table (bigger)`);
      fs.renameSync(x('decoder.int8.onnx'), path.join(out, 'decoder.onnx'));
    }
    await packDir(out, dest);
    for (const d of [tmp, out]) fs.rmSync(d, { recursive: true, force: true });
    ai[id] = { version, file: 'encoder.onnx' };
    fs.writeFileSync(path.join(AI, 'manifest.json'), JSON.stringify(ai));
    console.log('◉', `whisper ${w.name}`, `${(fs.statSync(dest).size / 1048576).toFixed(0)} MB`);
  }
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
if (!only || only === 'models') await models();
if (!only || only === 'codecs') await codecs();
if (!only || only === 'diagrams') { const DV = await import('./diagramvendor.mjs'); await DV.buildDrawio(path.join(V, 'diagrams'), CACHE); await DV.buildTranslate(path.join(V, 'translate'), CACHE); }
if (!only || only === 'speech') await speech();
fs.rmSync(path.join(CACHE, 'thin'), { recursive: true, force: true });
console.log('✓ engines ready for', TARGET);
