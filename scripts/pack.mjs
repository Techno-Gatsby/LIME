import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { packager } from '@electron/packager';
import { buildWebVendor } from './webvendor.mjs';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
export const V = path.join(ROOT, 'vendor'), OUT = path.join(ROOT, 'dist');
export const sh = (c, a, o = {}) => execFileSync(c, a, { stdio: ['ignore', 'ignore', 'inherit'], ...o });
export const which = (env, ...n) => process.env[env] || n.find((x) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [x], { stdio: 'ignore' }); return true; } catch { return false; } });
export const rm = (...p) => fs.rmSync(path.join(...p), { recursive: true, force: true });
export const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);
const walkRel = (d, r = '') => ls(path.join(d, r)).flatMap((f) => (fs.statSync(path.join(d, r, f)).isDirectory() ? walkRel(d, path.posix.join(r, f)) : [path.posix.join(r, f)]));

const KEEP = /^\/(src|build|assets|node_modules|package\.json)(\/|$)/;
const DROP = /^\/build\/(icon\.(icns|ico)|lime\.nsi|.*\.svg)$|\/(tests?|__tests__|docs|examples?|benchmarks?|\.github|@types)\/|\/(?!licen[cs]e|copying|notice)[^/]*\.(md|markdown|map|[mc]?ts|tsbuildinfo|flow)$|\/(yarn\.lock|package-lock\.json|tsconfig[^/]*\.json|\.eslintrc[^/]*|\.npmignore)$/i;
// Copies of a module that Lime never loads: other module formats, other platforms, GPU providers.
const UNUSED = [
  // DirectML.dll stays: the Windows onnxruntime binding links it and won't load without it, even on the CPU provider.
  /^\/node_modules\/onnxruntime-node\/bin\/napi-v3\/.*providers_(cuda|tensorrt|shared)/,
  /^\/node_modules\/tesseract\.js-core\/tesseract-core(?!-simd-lstm\.(js|wasm)$)[^/]*$/,
  /^\/node_modules\/libheif-js\/(libheif\/|libheif-wasm\/(libheif-bundle\.mjs|libheif\.js|libheif\.wasm)$)/,
  /^\/node_modules\/mupdf\/dist\/[^/]*\.br$/,
  /^\/node_modules\/docx\/dist\/[^/]*\.(iife\.js|umd\.cjs)$/,
  /^\/node_modules\/pdf-lib\/(dist|es|ts3\.4)\//,
  /^\/node_modules\/xlsx\/(dist\/(?!cpexcel\.js$)|[^/]*\.png$)/,
  /^\/node_modules\/codepage\/(bits|dist)\//,
  /^\/node_modules\/ag-psd\/dist-es\//,
];

export async function pack(platform, arch, opts) {
  const T = `${platform}-${arch}`;
  const ort = new RegExp(`^/node_modules/onnxruntime-node/bin/napi-v3/(?!${platform}(/${arch}(/|$)|$))`);
  await buildWebVendor({ quiet: true });
  if (!fs.existsSync(path.join(V, 'crafts', T, 'manifest.json'))) execFileSync(process.execPath, [path.join(ROOT, 'scripts/engines.mjs'), T], { stdio: 'inherit' });
  const slim = ({ buildPath }) => {
    const nm = path.join(buildPath, 'node_modules'), pj = path.join(buildPath, 'package.json');
    fs.writeFileSync(pj, JSON.stringify({ ...JSON.parse(fs.readFileSync(pj, 'utf8')), buildDate: new Date().toISOString() }, null, 2));
    for (const d of ls(path.join(nm, '@img'))) if (d.startsWith('sharp-')) rm(nm, '@img', d);
    for (const d of ls(path.join(nm, '@koromix'))) if (d !== `koffi-${T}`) rm(nm, '@koromix', d);
    if (!fs.existsSync(path.join(nm, '@koromix', `koffi-${T}`))) console.warn(`! koffi-${T} isn't installed, so Shift-drag won't work in this build`);
    fs.cpSync(path.join(V, 'npm', T, '@img'), path.join(nm, '@img'), { recursive: true });
    for (const f of ['bunny.drc', 'draco_nodejs_example.js']) rm(nm, 'draco3dgltf', f);
    for (const f of ls(path.join(nm, 'meshoptimizer'))) if (!/^(meshopt_decoder\.cjs|meshopt_encoder\.js|index\.js|package\.json|LICENSE\.md)$/.test(f)) rm(nm, 'meshoptimizer', f);
    for (const d of ['lib', 'bitbybit-dev-occt-64-bit', 'bitbybit-dev-occt-64-bit-mt']) rm(nm, '@bitbybit-dev', 'occt', d);
    if (!ls(path.join(nm, '@bitbybit-dev', 'occt', 'bitbybit-dev-occt')).some((f) => f.endsWith('.wasm'))) console.warn('! @bitbybit-dev/occt has no kernel, so exact STEP, IGES and BREP saving won’t work in this build');
    const keep = (dir, re) => { for (const f of walkRel(path.join(nm, dir))) if (!re.test(f)) rm(nm, dir, f); };
    keep('bwip-js', /^(package\.json|LICENSE|dist\/bwip-js-node\.js)$/);
    keep('zxing-wasm', /^(package\.json|LICENSE|dist\/cjs\/(package\.json|share\.js|reader\/index\.js)|dist\/reader\/zxing_reader\.wasm)$/);
    keep('gifski-wasm', /^(package\.json|LICENSE|dist\/encode\.js|pkg\/gifski_wasm(_bg\.wasm|\.js))$/);
    keep('@jsquash/oxipng', /^(package\.json|LICENSE|codec\/pkg\/squoosh_oxipng(_bg\.wasm|\.js))$/);
    keep('exifr', /^(package\.json|LICENSE|dist\/full\.umd\.js)$/);
    for (const d of ['type-fest', 'tagged-tag', '@types/emscripten']) rm(nm, d);
  };
  const [dir] = await packager({
    dir: ROOT, out: OUT, platform, arch, overwrite: true, asar: false, prune: true, quiet: true,
    name: pkg.productName, executableName: pkg.productName, appVersion: pkg.version, buildVersion: pkg.version,
    appCopyright: 'Open source · see resources/LICENSES', electronZipDir: process.env.LIME_ELECTRON_ZIPS,
    ignore: (p) => !!p && (!KEEP.test(p) || DROP.test(p) || ort.test(p) || UNUSED.some((r) => r.test(p))), afterPrune: [slim], ...opts,
  });
  return { dir, T };
}

// Only the archives a folder's manifest lists, so leftovers from an earlier version or format never ship.
const NAMES = { apps: (id) => [`${id}.tar.br`], ai: (id) => [`${id}.tar.br`], web: (id) => [`${id}.tar.br`], helpers: (id) => [`${id}.tar.br`], crafts: (id) => [`${id}-cli`, `${id}-cli.br`, `${id}-cli.exe`, `${id}-cli.exe.br`] };
const listed = (dir, kind) => {
  const file = path.join(dir, 'manifest.json');
  if (!NAMES[kind] || !fs.existsSync(file)) return null;
  const ok = new Set(['manifest.json', ...Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))).flatMap(NAMES[kind])]);
  return (f) => ok.has(f);
};
export function addResources(res, T) {
  for (const [from, to] of [[`bin/${T}`, 'bin'], [`crafts/${T}`, 'crafts'], [`apps/${T}`, 'apps'], [`helpers/${T}`, 'helpers'], [`ai/${T}`, 'ai'], [`dictate/${T}`, 'dictate'], ['models', 'models'], [`codecs/${T}`, 'codecs'], ['web', 'web'], ['data', 'data'], ['diagrams', 'diagrams'], ['translate', 'translate']]) {
    const src = path.join(V, from);
    if (!fs.existsSync(src)) continue;
    const keep = listed(src, to);
    fs.cpSync(src, path.join(res, to), { recursive: true, dereference: true, filter: (f) => !keep || f === src || keep(path.basename(f)) });
    for (const f of keep ? ls(src).filter((f) => !keep(f)) : []) console.log('  left out', `${from}/${f}`);
  }
  fs.cpSync(path.join(ROOT, 'LICENSES'), path.join(res, 'LICENSES'), { recursive: true });
}
