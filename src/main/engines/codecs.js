'use strict';
// Small WebAssembly codecs: gifski (GIFs), oxipng (lossless PNG), qpdf (PDF repair and fast web view)
// and Ghostscript (strong PDF compression, PDF/A). All run inside Lime; nothing is fetched.
const U = require('./util');
const { fs, fsp, path } = U;
const { pathToFileURL } = require('url');

const T = `${process.platform}-${process.arch}`;
U.cfg.codecs ||= process.env.LIME_CODECS || path.join(__dirname, '../../../vendor/codecs', T);

function pkg(name) {
  for (const d of require.resolve.paths(name) || []) if (fs.existsSync(path.join(d, name, 'package.json'))) return path.join(d, name);
  throw new Error(`${name} is missing. Reinstall Lime.`);
}
const esm = (name, rel) => import(pathToFileURL(path.join(pkg(name), rel)).href);
const once = (fn) => { let p; return () => (p ||= fn().catch((e) => { p = null; throw e; })); };

const gifskiLib = once(async () => {
  const m = await esm('gifski-wasm', 'dist/encode.js');
  await m.init(await WebAssembly.compile(await fsp.readFile(path.join(pkg('gifski-wasm'), 'pkg/gifski_wasm_bg.wasm'))));
  return m;
});
// frames: [{ data: RGBA, delay: ms }] all the same size.
async function gifski(frames, width, height, { quality = 90, fps, loop = true } = {}) {
  // gifski needs two frames or more; one picture is a still GIF.
  if (frames.length === 1) return require('sharp')(frames[0].data, { raw: { width, height, channels: 4 } }).gif({ effort: 10, dither: 0.5 }).toBuffer();
  const { encode } = await gifskiLib();
  const opts = { frames: frames.map((f) => new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.length)), width, height, quality, repeat: loop ? -1 : 0 };
  if (fps) opts.fps = fps; else opts.frameDurations = frames.map((f) => Math.max(20, Math.round(f.delay || 100)));
  return Buffer.from(await encode(opts));
}
// Pictures (paths or buffers) → GIF, each fitted inside width × height on a background.
async function gifFromImages(inputs, out, { width = 600, height, delays, quality = 90, fit = 'contain', background = '#ffffff', progress = () => {} } = {}) {
  const img = require('./image');
  const H = height || width, frames = [];
  for (let i = 0; i < inputs.length; i++) {
    progress(i / inputs.length * 0.5, 'Preparing frames');
    const s = Buffer.isBuffer(inputs[i]) ? require('sharp')(inputs[i]) : await img.open(inputs[i]);
    const { data, info } = await s.rotate().resize(width, H, { fit, background, withoutEnlargement: fit === 'inside' }).flatten({ background }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    frames.push({ data, delay: delays?.[i] ?? 1000, w: info.width, h: info.height });
  }
  const w = frames[0].w, h = frames[0].h;
  const same = await Promise.all(frames.map(async (f) => (f.w === w && f.h === h ? f : { ...f, data: await require('sharp')(f.data, { raw: { width: f.w, height: f.h, channels: 4 } }).resize(w, h, { fit: 'contain', background }).raw().toBuffer() })));
  progress(0.5, 'Making GIF');
  await fsp.writeFile(out, await gifski(same, w, h, { quality }));
  return out;
}

const oxipngLib = once(async () => {
  const m = await esm('@jsquash/oxipng', 'codec/pkg/squoosh_oxipng.js');
  m.initSync(await fsp.readFile(path.join(pkg('@jsquash/oxipng'), 'codec/pkg/squoosh_oxipng_bg.wasm')));
  return m;
});
// Lossless: the same pixels, fewer bytes. Level 2 is quick, 4–6 try harder.
async function oxipng(png, { level = 3, alpha = true } = {}) {
  const { optimise } = await oxipngLib();
  const out = Buffer.from(optimise(new Uint8Array(png), level, false, alpha));
  return out.length && out.length < png.length ? out : Buffer.from(png);
}
// Big pictures get a quicker pass so a conversion never stalls on the optimiser.
async function oxipngFile(file, { level = 2, alpha = false } = {}) {
  const png = await fsp.readFile(file), px = png.readUInt32BE(16) * png.readUInt32BE(20);
  const lv = px <= 4e6 ? level : px <= 16e6 ? Math.min(level, 2) : 0;
  if (!lv) return file;
  const out = await oxipng(png, { level: lv, alpha });
  if (out.length < png.length) await fsp.writeFile(file, out);
  return file;
}

// Emscripten programs: a fresh instance for every run, the compiled module kept.
// Some builds ignore print/printErr and bind the console when they start, so the console is
// borrowed for the length of one run. Runs are synchronous, so nothing else logs meanwhile.
function emscripten(load, wasm) {
  const mod = once(async () => WebAssembly.compile(await fsp.readFile(wasm)));
  return async (args, files = {}, want = []) => {
    const compiled = await mod(), factory = await load();
    let log = '';
    const say = (...t) => { log = (log + t.join(' ') + '\n').slice(-6000); };
    const con = { log: console.log, error: console.error, warn: console.warn }, exit = process.exitCode;
    Object.assign(console, { log: say, error: say, warn: say });
    try {
      const m = await factory({ print: say, printErr: say, noInitialRun: true, thisProgram: 'lime', quit: (c, e) => { throw e; },
        instantiateWasm: (imports, ok) => { WebAssembly.instantiate(compiled, imports).then((i) => ok(i)); return {}; } });
      for (const [name, data] of Object.entries(files)) m.FS.writeFile(name, data);
      let code = 0;
      try { code = m.callMain(args) ?? 0; } catch (e) { if (typeof e?.status !== 'number') throw e; code = e.status; }
      const got = {};
      for (const name of want) { try { got[name] = Buffer.from(m.FS.readFile(name)); } catch (_) {} }
      return { code, log: log.trim(), files: got };
    } finally { Object.assign(console, con); process.exitCode = exit; }
  };
}

let qpdfRun = null;
// qpdf exit codes: 0 fine, 3 fine with warnings (it fixed something), 2 failed.
async function qpdf(input, args, password, { check = false } = {}) {
  qpdfRun ||= emscripten(async () => require(path.join(pkg('@neslinesli93/qpdf-wasm'), 'dist/qpdf.js')), path.join(pkg('@neslinesli93/qpdf-wasm'), 'dist/qpdf.wasm'));
  const r = await qpdfRun([...(password ? [`--password=${password}`] : []), ...args, '/in.pdf', ...(check ? [] : ['/out.pdf'])], { '/in.pdf': await fsp.readFile(input) }, ['/out.pdf']);
  if (check) { if (r.code === 2) throw new Error(r.log.split('\n').pop()); return { warnings: r.code === 3, log: r.log }; }
  if (r.code === 2 || !r.files['/out.pdf']) {
    const why = (r.log.split('\n').filter((l) => l && !/WARNING/.test(l)).pop() || 'it could not be read').replace(/^(lime|this\.program): /, '').replace(/^\/in\.pdf:?\s*/, '');
    throw new Error(/password/i.test(why) ? 'This PDF needs its password.' : `qpdf couldn’t read this PDF (${why})`);
  }
  return { pdf: r.files['/out.pdf'], warnings: r.log.split('\n').filter((l) => /WARNING/.test(l)).length };
}

const GS = 'ghostscript';
async function gsDir() {
  if (process.env.LIME_GS) return process.env.LIME_GS;
  const H = require('../helpers'), m = H.bundled(GS, U.cfg.codecs);
  if (!m) return null;
  const exe = await H.ensure(GS, U.cfg.codecs, path.join(U.cfg.user, 'codecs'));
  return exe && path.dirname(exe);
}
let gsRun = null;
const hasGhostscript = () => !!(process.env.LIME_GS || require('../helpers').bundled(GS, U.cfg.codecs));
async function ghostscript(args, files, want) {
  if (!gsRun) {
    const dir = await gsDir();
    if (!dir) throw Object.assign(new Error('Ghostscript isn’t in this build of Lime.'), { code: 'ENGINE_MISSING' });
    const js = ['gs.mjs', 'gs.js'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    gsRun = emscripten(async () => (await import(pathToFileURL(js).href)).default, path.join(dir, 'gs.wasm'));
  }
  return gsRun(['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', ...args], files, want);
}

module.exports = { pkg, esm, gifski, gifFromImages, oxipng, oxipngFile, qpdf, ghostscript, hasGhostscript };
