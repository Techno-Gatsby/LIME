'use strict';
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const U = require('./util');
const { fs, fsp, path, os } = U;

const APPS = {
  photocraft: { name: 'PhotoCraft', role: 'Image editing' },
  lightcraft: { name: 'LightCraft', role: 'RAW development' },
  vectorcraft: { name: 'VectorCraft', role: 'Vector art' },
  designcraft: { name: 'DesignCraft', role: 'Page layout' },
  effectcraft: { name: 'EffectCraft', role: 'Motion graphics' },
  filmcraft: { name: 'FilmCraft', role: 'Video editing' },
  pdfcraft: { name: 'PdfCraft', role: 'PDF workbench' },
};
const exe = (id) => `${id}-cli${U.isWin ? '.exe' : ''}`;
const unpacking = new Map();

async function cli(id) {
  const raw = path.join(U.cfg.crafts, exe(id));
  if (fs.existsSync(raw)) return raw;
  const br = `${raw}.br`;
  if (!fs.existsSync(br)) throw Object.assign(new Error(`The ${APPS[id].name} engine isn’t in this build of Lime.`), { code: 'ENGINE_MISSING' });
  const dest = path.join(U.cfg.user, 'crafts', `${id}-${fs.statSync(br).size}`, exe(id));
  if (fs.existsSync(dest)) return dest;
  if (!unpacking.has(id)) {
    unpacking.set(id, (async () => {
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      const part = `${dest}.part`;
      await pipeline(fs.createReadStream(br), zlib.createBrotliDecompress(), fs.createWriteStream(part, { mode: 0o755 }));
      await fsp.rename(part, dest);
      for (const d of await fsp.readdir(path.join(U.cfg.user, 'crafts'))) if (d.startsWith(`${id}-`) && d !== path.basename(path.dirname(dest))) fsp.rm(path.join(U.cfg.user, 'crafts', d), { recursive: true, force: true }).catch(() => {});
      return dest;
    })().finally(() => unpacking.delete(id)));
  }
  return unpacking.get(id);
}
function quiet(s) { return String(s).split(/\r?\n/).filter((l) => l && !/WARN|warning:/.test(l)).slice(-2).join(' — '); }
async function run(id, args, ctx, label, opts = {}) {
  const bin = await cli(id);
  ctx?.progress?.(0.15, label);
  let tick = 0.15;
  const t = setInterval(() => { tick = Math.min(0.92, tick + (0.95 - tick) * 0.06); ctx?.progress?.(tick, label); }, 400);
  try {
    return await U.run(bin, args, { signal: ctx?.signal, cwd: opts.cwd || os.tmpdir(), okCodes: opts.okCodes, errorMessage: `${APPS[id].name} couldn’t finish`, env: { NO_COLOR: '1' } });
  } catch (e) {
    e.message = e.message.replace(/\(([\s\S]*)\)$/, (m, inner) => `(${quiet(inner)})`);
    throw e;
  } finally { clearInterval(t); }
}
const jsonLines = (s) => String(s).split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
const lastJson = (s) => { try { return JSON.parse(String(s).slice(String(s).indexOf('{'))); } catch (_) { return jsonLines(s).pop() || null; } };

async function photo(p, opts, ctx) {
  const to = opts.to || 'png';
  const out = ctx.out.file(p, `${U.base(p)}${U.ext(p) === to ? '-converted' : ''}.${to}`);
  const args = ['convert', p, out];
  if (opts.quality && ['jpg', 'webp'].includes(to)) args.push('--quality', String(opts.quality));
  if (to === 'tif' && opts.layers) args.push('--tiff-layers');
  await run('photocraft', args, ctx, `Rendering with PhotoCraft`);
  return out;
}
async function render(p, out, opts = {}, ctx) {
  const args = ['render', p, '-o', out, '--opt', 'metadata=none'];
  if (opts.quality) args.push('--quality', String(opts.quality));
  await run('lightcraft', args, ctx, 'Rendering with LightCraft');
  return out;
}
async function develop(p, opts, ctx) {
  const to = opts.to || 'jpg';
  const out = ctx.out.file(p, `${U.base(p)}${opts.auto ? '-enhanced' : ''}.${to}`);
  const size = Number(opts.size) || 0;
  if (opts.auto) {
    const args = ['run', '--import', p, 'develop.auto', 'app.export', `path=${out}`];
    if (size) args.push(`longEdge=${size}`);
    if (opts.quality) args.push(`quality=${Number(opts.quality)}`);
    const r = await run('lightcraft', args, ctx, 'Auto-developing with LightCraft');
    const fail = jsonLines(r.stdout).find((j) => j.ok === false);
    if (fail) throw new Error(fail.error || 'LightCraft couldn’t develop this photo.');
  } else {
    const args = ['render', p, '-o', out];
    if (size) args.push('--size', String(size));
    if (opts.quality) args.push('--quality', String(opts.quality));
    if (opts.preset) args.push('--preset', opts.preset);
    await run('lightcraft', args, ctx, 'Developing with LightCraft');
  }
  if (!fs.existsSync(out)) throw new Error('LightCraft finished without writing a file.');
  return out;
}
async function merge(files, opts, ctx) {
  const mode = opts.mode === 'panorama' ? 'panorama' : 'hdr';
  const r = await run('lightcraft', ['merge', mode, ...files], ctx, mode === 'hdr' ? 'Merging HDR' : 'Stitching panorama');
  const j = lastJson(r.stdout) || {};
  const tag = mode === 'hdr' ? '-HDR' : '-Pano';
  const dng = j.path || j.output || path.join(path.dirname(files[0]), `${U.base(files[0])}${tag}.dng`);
  if (!fs.existsSync(dng)) throw new Error('The merge didn’t produce a file. Use overlapping (panorama) or bracketed (HDR) shots.');
  const outs = [];
  const keep = ctx.out.file(files[0], `${U.base(files[0])}${tag}.dng`);
  if (path.resolve(keep) !== path.resolve(dng)) { await fsp.rename(dng, keep).catch(async () => { await fsp.copyFile(dng, keep); await fsp.rm(dng, { force: true }); }); }
  outs.push(keep);
  if (opts.jpg !== false) outs.unshift(await develop(keep, { to: 'jpg', quality: 92 }, { ...ctx, progress: () => {} }));
  return { path: outs[0], paths: outs, note: `Merged ${files.length} photos` };
}
async function vector(p, opts, ctx) {
  const to = opts.to || 'svg';
  const out = ctx.out.file(p, `${U.base(p)}${U.ext(p) === to ? '-converted' : ''}.${to}`);
  const args = ['convert', p, out];
  if (opts.scale && ['png', 'jpg', 'webp', 'tif', 'bmp', 'gif', 'tga', 'psd'].includes(to)) args.push('--scale', String(opts.scale));
  if (opts.outlineText && to === 'svg') args.push('--outline-text');
  if (opts.legacyAi && to === 'ai') args.push('--ai-version', '7');
  await run('vectorcraft', args, ctx, 'Converting with VectorCraft');
  if (!fs.existsSync(out)) {
    const alt = fs.readdirSync(path.dirname(out)).find((f) => f.startsWith(`${U.base(out)}-`) && f.endsWith(`.${to}`));
    if (alt) return path.join(path.dirname(out), alt);
    throw new Error('VectorCraft finished without writing a file.');
  }
  return out;
}
async function layout(p, opts, ctx) {
  const to = opts.to || 'pdf';
  if (to === 'png') {
    const dir = ctx.out.folder(p, `${U.base(p)} - pages`);
    await run('designcraft', ['run', '--in', p, '--scale', String(opts.scale || 2), '--all-pages', `${dir}${path.sep}`], ctx, 'Rendering pages');
    return dir;
  }
  const out = ctx.out.file(p, `${U.base(p)}.${to}`);
  await run('designcraft', ['run', '--in', p, '--export', out], ctx, `Exporting ${to.toUpperCase()}`);
  return out;
}
const MOTION_FORMAT = { mp4: 'h264', mov: 'prores', webm: 'webm', gif: 'gif', hevc: 'hevc' };
async function motion(p, opts, ctx) {
  const to = opts.to || 'mp4';
  const dir = await U.tmpDir('motion');
  try {
    let project = p;
    if (U.ext(p) !== 'ecproj') {
      project = path.join(dir, 'anim.ecproj');
      await run('effectcraft', ['--empty', '--save-as', project, 'run', 'file.importLottie', JSON.stringify({ path: p })], ctx, 'Reading animation');
    }
    const ext = to === 'hevc' ? 'mp4' : to;
    const out = ctx.out.file(p, `${U.base(p)}.${ext}`);
    const args = ['--project', project, 'render', '--out', out, '--format', MOTION_FORMAT[to] || 'h264'];
    if (opts.resolution && opts.resolution !== 'full') args.push('--resolution', opts.resolution);
    await run('effectcraft', args, ctx, `Rendering ${ext.toUpperCase()}`);
    return out;
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const TIMELINE = { otio: 'otio', fcpxml: 'fcpxml', xml: 'xml', edl: 'edl', aaf: 'aaf' };
async function timeline(p, opts, ctx) {
  const to = opts.to || 'mp4';
  const dir = await U.tmpDir('film');
  try {
    let project = p;
    if (U.ext(p) !== 'fcproj') {
      project = path.join(dir, 'timeline.fcproj');
      const script = path.join(dir, 'import.jsonl');
      await fsp.writeFile(script, `${JSON.stringify({ id: 'file.import', params: { paths: [p] } })}\n`);
      await run('filmcraft', ['--compact', '--save-as', project, 'run', script], ctx, 'Reading timeline');
    }
    const out = ctx.out.file(p, `${U.base(p)}${U.ext(p) === to ? '-converted' : ''}.${to}`);
    if (TIMELINE[to]) {
      const script = path.join(dir, 'export.jsonl');
      await fsp.writeFile(script, `${JSON.stringify({ id: 'file.exportInterchange', params: { format: TIMELINE[to], path: out } })}\n`);
      await run('filmcraft', ['--compact', '--project', project, 'run', script], ctx, `Writing ${to.toUpperCase()}`);
    } else {
      await run('filmcraft', ['--project', project, 'export', out, '--allow-offline', ...(opts.scale ? ['--scale', String(opts.scale)] : [])], ctx, 'Rendering timeline', { okCodes: [1] });
    }
    if (!fs.existsSync(out)) throw new Error('FilmCraft finished without writing a file. Keep the timeline’s media next to it.');
    return out;
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function optimizePdf(p, opts, ctx) {
  const dir = await U.tmpDir('pdfopt');
  try {
    await run('pdfcraft', ['batch', p, '--steps', 'optimize', '--out-dir', dir, ...(opts.quality ? ['--quality', String(opts.quality)] : [])], ctx, 'Optimizing with PdfCraft');
    const made = (await fsp.readdir(dir)).find((f) => f.toLowerCase().endsWith('.pdf'));
    if (!made) throw new Error('PdfCraft didn’t produce a file.');
    const out = ctx.out.file(p, `${U.base(p)}-optimized.pdf`);
    await fsp.copyFile(path.join(dir, made), out);
    const a = (await fsp.stat(p)).size, b = (await fsp.stat(out)).size;
    return { path: out, note: b < a ? `${U.fmtBytes(a)} → ${U.fmtBytes(b)} (${Math.round((1 - b / a) * 100)}% smaller)` : 'Already optimized' };
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function auditPdf(p, opts, ctx) {
  const r = await run('pdfcraft', ['audit', p], ctx, 'Checking redactions', { okCodes: [1] });
  const j = lastJson(r.stdout) || { count: 0 };
  return { note: j.count ? `${j.count} fake redaction${j.count === 1 ? '' : 's'} found: text is still under black boxes` : 'No hidden text under redactions', text: JSON.stringify(j.findings || [], null, 2) };
}
async function pdfInfo(p) {
  const r = await run('pdfcraft', ['info', p], null, '');
  return lastJson(r.stdout);
}

function installedApp(id) {
  const name = APPS[id]?.name;
  if (!name) return null;
  const cands = process.platform === 'darwin'
    ? [`/Applications/${name}.app`, path.join(os.homedir(), 'Applications', `${name}.app`)]
    : U.isWin ? [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean).map((b) => path.join(b, name, `${id}.exe`)) : [`/usr/bin/${id}`, `/usr/local/bin/${id}`];
  return cands.find((c) => fs.existsSync(c)) || null;
}
const PREF = { psd: 'photocraft', psb: 'photocraft', pcraft: 'photocraft', svg: 'vectorcraft', ai: 'vectorcraft', eps: 'vectorcraft', afdesign: 'vectorcraft', pdf: 'pdfcraft', idml: 'designcraft', indd: 'designcraft', ecproj: 'effectcraft', lottie: 'effectcraft', fcproj: 'filmcraft', otio: 'filmcraft', fcpxml: 'filmcraft' };
const BY_GROUP = { image: 'photocraft', raw: 'lightcraft', vector: 'vectorcraft', cad2d: 'vectorcraft', layout: 'designcraft', motion: 'effectcraft', timeline: 'filmcraft', video: 'filmcraft', pdf: 'pdfcraft' };
function appFor(file) {
  const id = PREF[U.ext(file)] || BY_GROUP[U.groupOf(file)];
  return id && installedApp(id) ? { id, ...APPS[id] } : null;
}
const bundledApps = () => { try { return JSON.parse(fs.readFileSync(path.join(U.cfg.apps, 'manifest.json'), 'utf8')); } catch (_) { return {}; } };
const appSource = (id) => path.join(U.cfg.apps, U.isWin ? `${id}.exe.br` : `${id}.app.tar.br`);
const unpackingApps = new Map();
async function bundledApp(id) {
  const m = bundledApps()[id];
  if (!m || !fs.existsSync(appSource(id))) return null;
  const root = path.join(U.cfg.user, 'apps'), dir = path.join(root, `${id}-${m.version}`), target = path.join(dir, m.file);
  if (fs.existsSync(target)) return target;
  if (!unpackingApps.has(id)) {
    unpackingApps.set(id, (async () => {
      const part = `${dir}.part`;
      await fsp.rm(part, { recursive: true, force: true });
      await fsp.mkdir(part, { recursive: true });
      const unbrotli = () => fs.createReadStream(appSource(id)).pipe(zlib.createBrotliDecompress());
      if (U.isWin) await pipeline(unbrotli(), fs.createWriteStream(path.join(part, m.file)));
      else {
        await new Promise((ok, no) => {
          const tar = spawn('/usr/bin/tar', ['-xf', '-', '-C', part], { stdio: ['pipe', 'ignore', 'pipe'] });
          let err = '';
          tar.stderr.on('data', (d) => { err += d; });
          tar.on('error', no);
          tar.on('close', (c) => (c === 0 ? ok() : no(new Error(err.trim() || `tar exited with ${c}`))));
          pipeline(unbrotli(), tar.stdin).catch(no);
        });
      }
      await fsp.rm(dir, { recursive: true, force: true });
      await fsp.rename(part, dir);
      for (const d of await fsp.readdir(root)) if (d.startsWith(`${id}-`) && d !== path.basename(dir)) fsp.rm(path.join(root, d), { recursive: true, force: true }).catch(() => {});
      return target;
    })().finally(() => unpackingApps.delete(id)));
  }
  return unpackingApps.get(id);
}
async function openApp(id, files = []) {
  if (!APPS[id]) throw new Error('Unknown app.');
  const app = installedApp(id) || (await bundledApp(id));
  if (!app) throw new Error(`${APPS[id].name} isn’t in this build of Lime.`);
  const child = process.platform === 'darwin' ? spawn('open', ['-a', app, ...files], { detached: true, stdio: 'ignore' }) : spawn(app, files, { detached: true, stdio: 'ignore', cwd: path.dirname(app) });
  child.on('error', () => {});
  child.unref();
  return app;
}
function status() {
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(U.cfg.crafts, 'manifest.json'), 'utf8')); } catch (_) {}
  const apps = bundledApps();
  return Object.entries(APPS).map(([id, a]) => ({ id, ...a, version: manifest[id] || apps[id]?.version || null, bundled: fs.existsSync(path.join(U.cfg.crafts, exe(id))) || fs.existsSync(path.join(U.cfg.crafts, `${exe(id)}.br`)), app: !!installedApp(id) || (!!apps[id] && fs.existsSync(appSource(id))) }));
}

module.exports = { APPS, cli, photo, render, develop, merge, vector, layout, motion, timeline, optimizePdf, auditPdf, pdfInfo, appFor, openApp, bundledApp, status };
