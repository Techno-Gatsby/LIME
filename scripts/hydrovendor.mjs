// Builds the hydrology engines as WebAssembly (WASI), the same file for every platform, into vendor/hydro:
//   swmm5.wasm    EPA SWMM 5.2.4's solver and command line (public domain). EPA publishes Windows binaries only.
//   dsstool.wasm  a small HEC-DSS 7 reader (scripts/hydro/dsstool.c) on HEC's heclib (MIT) and zlib.
// Sources and the WASI SDK for this build machine are version-pinned and SHA-256 checked; Lime runs the results with
// Node's built-in WASI, so nothing native ships and nothing is fetched at run time.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const GH = 'https://github.com';
export const SDK = { version: '34.0', base: `${GH}/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34`,
  'linux-x64': ['wasi-sdk-34.0-x86_64-linux.tar.gz', 'b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4'],
  'darwin-arm64': ['wasi-sdk-34.0-arm64-macos.tar.gz', '9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9'],
  'win32-x64': ['wasi-sdk-34.0-x86_64-windows.tar.gz', 'cccb5c323a9b34f0349a9b09e8804a0a7632c68c3310f4b5f437ed57d7e71d8f'] };
export const SWMM = { version: '5.2.4', url: 'https://codeload.github.com/USEPA/Stormwater-Management-Model/tar.gz/refs/tags/v5.2.4', sha: '2671c29306c6e59d94296a0a3f2173dc4e396a3a08ade18ae35dbe111b9af8b8' };
export const HECDSS = { version: '7-JA-7', url: 'https://codeload.github.com/HydrologicEngineeringCenter/hec-dss/tar.gz/refs/tags/7-JA-7', sha: '468f5be712c230e4cf8845d55b48f96d8544ad8dcc7df14df2e4e911ee40317a' };
export const ZLIB = { version: '1.3.1', url: `${GH}/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz`, sha: '9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23' };
const HERE = path.join(import.meta.dirname, 'hydro');
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const mk = (d) => (fs.mkdirSync(d, { recursive: true }), d);

async function pinned(url, sha, cache, name) {
  const f = path.join(mk(cache), name);
  if (!fs.existsSync(f) || !fs.statSync(f).size) {
    for (let i = 1; ; i++) {
      console.log('↓', url);
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(900000) });
        if (!r.ok) throw new Error(`${r.status} ${url}`);
        const { pipeline } = await import('node:stream/promises'), { Readable } = await import('node:stream');
        await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(`${f}.part`));
        fs.renameSync(`${f}.part`, f);
        break;
      } catch (e) { if (i === 3) throw e; console.warn(`retrying ${url}: ${e.message}`); }
    }
  }
  const got = await new Promise((ok, no) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', no); });
  if (got !== sha) { fs.rmSync(f, { force: true }); throw new Error(`${name}: SHA-256 ${got} isn't the pinned ${sha}`); }
  return f;
}
const untar = (file, dir) => { mk(dir); execFileSync(TAR, ['-xzf', file, '-C', dir], { stdio: ['ignore', 'ignore', 'inherit'] }); return path.join(dir, fs.readdirSync(dir)[0]); };
function clang(sdk, args, cwd) {
  // The arguments go in a response file: every heclib source on one command line is past Windows' 32K limit.
  const rsp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lime-cc-')), 'args.rsp');
  fs.writeFileSync(rsp, args.map((a) => `"${a.replace(/\\/g, '/').replace(/"/g, '\\"')}"`).join('\n'));
  const r = spawnSync(path.join(sdk, 'bin', process.platform === 'win32' ? 'clang.exe' : 'clang'), [`@${rsp}`], { encoding: 'utf8', maxBuffer: 1 << 26, cwd });
  fs.rmSync(path.dirname(rsp), { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`clang: ${r.error?.message || ''} ${(r.stderr || '').split('\n').filter((l) => /error/.test(l)).slice(0, 8).join('\n')}`);
}
const common = (sdk) => ['--target=wasm32-wasip1', `--sysroot=${path.join(sdk, 'share', 'wasi-sysroot')}`, '-O2', '-D_WASI_EMULATED_SIGNAL', '-D_WASI_EMULATED_PROCESS_CLOCKS', '-D_WASI_EMULATED_GETPID', '-include', path.join(HERE, 'lime-wasi.h'), '-w'];
const libs = ['-lm', '-lwasi-emulated-signal', '-lwasi-emulated-process-clocks', '-lwasi-emulated-getpid'];

function buildSwmm(sdk, src, out) {
  const solver = path.join(src, 'src', 'solver');
  clang(sdk, [...common(sdk), `-I${path.join(solver, 'include')}`, `-I${solver}`, ...fs.readdirSync(solver).filter((f) => f.endsWith('.c')).map((f) => path.join(solver, f)), path.join(src, 'src', 'run', 'main.c'), path.join(HERE, 'lime-wasi.c'),
    ...libs, '-Wl,-z,stack-size=8388608', '-Wl,--initial-memory=33554432', '-Wl,--max-memory=2147483648', '-o', out]);
}
function buildDss(sdk, src, zlib, out) {
  const lib = path.join(src, 'heclib', 'heclib_c');
  const all = [...fs.readFileSync(path.join(lib, 'CMakeLists.txt'), 'utf8').matchAll(/^\s*(src\/\S+\.c)\s*$/gm)].map((m) => path.join(lib, m[1]));
  const odd = all.filter((f) => /sortfiles\.c$/.test(f)), files = all.filter((f) => !odd.includes(f));
  const z = ['adler32', 'compress', 'crc32', 'deflate', 'infback', 'inffast', 'inflate', 'inftrees', 'trees', 'uncompr', 'zutil'].map((n) => path.join(zlib, `${n}.c`));
  const base = [...common(sdk), '-std=gnu99', '-D__linux__', `-I${path.join(lib, 'src', 'headers')}`, `-I${path.join(src, 'heclib', 'hecdss')}`, `-I${zlib}`];
  const objs = fs.mkdtempSync(path.join(os.tmpdir(), 'lime-dss-'));
  try {
    clang(sdk, [...base, '-c', ...files, ...z, path.join(src, 'heclib', 'hecdss', 'hecdss.c'), path.join(HERE, 'dsstool.c'), path.join(HERE, 'lime-wasi.c')], objs);
    // sortfiles.c declares errno itself; wasm32-wasip1 has no threads, so errno being thread-local makes no difference.
    clang(sdk, [...base, '-D_Thread_local=', '-c', ...odd], objs);
    clang(sdk, [...base, ...fs.readdirSync(objs).filter((f) => f.endsWith('.o')).map((f) => path.join(objs, f)), ...libs, '-Wl,-z,stack-size=4194304', '-Wl,--initial-memory=33554432', '-Wl,--max-memory=1073741824', '-o', out]);
  } finally { fs.rmSync(objs, { recursive: true, force: true }); }
}

export async function buildHydro(out, cache) {
  const mf = path.join(out, 'manifest.json'), manifest = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : {};
  const want = { swmm5: SWMM.version, dsstool: `${HECDSS.version}+${crypto.createHash('sha1').update(fs.readFileSync(path.join(HERE, 'dsstool.c'))).update(fs.readFileSync(path.join(HERE, 'lime-wasi.c'))).digest('hex').slice(0, 8)}` };
  const todo = Object.keys(want).filter((id) => !(fs.existsSync(path.join(out, `${id}.wasm`)) && manifest[id]?.version === want[id]));
  if (!todo.length) return manifest;
  const HOST = `${process.platform}-${process.arch}`;
  if (!SDK[HOST]) throw new Error(`building the hydrology engines needs a ${['linux-x64', 'darwin-arm64', 'win32-x64'].join(', ')} build machine`);
  mk(out);
  const work = path.join(cache, 'hydro-build');
  fs.rmSync(work, { recursive: true, force: true });
  try {
    const sdk = untar(await pinned(`${SDK.base}/${SDK[HOST][0]}`, SDK[HOST][1], cache, SDK[HOST][0]), path.join(work, 'sdk'));
    if (todo.includes('swmm5')) {
      const src = untar(await pinned(SWMM.url, SWMM.sha, cache, `swmm-${SWMM.version}.tar.gz`), path.join(work, 'swmm'));
      buildSwmm(sdk, src, path.join(out, 'swmm5.wasm'));
      manifest.swmm5 = { version: want.swmm5, file: 'swmm5.wasm' };
      console.log('≈', 'SWMM', SWMM.version, `${(fs.statSync(path.join(out, 'swmm5.wasm')).size / 1048576).toFixed(1)} MB`);
    }
    if (todo.includes('dsstool')) {
      const src = untar(await pinned(HECDSS.url, HECDSS.sha, cache, `hec-dss-${HECDSS.version}.tar.gz`), path.join(work, 'dss'));
      const zlib = untar(await pinned(ZLIB.url, ZLIB.sha, cache, `zlib-${ZLIB.version}.tar.gz`), path.join(work, 'zlib'));
      buildDss(sdk, src, zlib, path.join(out, 'dsstool.wasm'));
      manifest.dsstool = { version: want.dsstool, file: 'dsstool.wasm' };
      console.log('≈', 'HEC-DSS reader', HECDSS.version, `${(fs.statSync(path.join(out, 'dsstool.wasm')).size / 1048576).toFixed(1)} MB`);
    }
    fs.writeFileSync(mf, JSON.stringify(manifest));
    return manifest;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const V = process.env.LIME_VENDOR || path.join(import.meta.dirname, '..', 'vendor');
  console.log(await buildHydro(process.argv[2] || path.join(V, 'hydro'), process.argv[3] || path.join(V, '.cache')));
}
