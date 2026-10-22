'use strict';
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const U = require('./util');
const { fs, fsp, path, os } = U;

// `opens` is what each app is offered for on the wheel: file groups (see util.GROUPS) or extensions. `bucket` is the
// slice of the wheel's home ring the app sits in (see BUCKETS); any app with one shows up there by itself.
const CODE_OPEN = ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'json', 'jsonc', 'json5', 'py', 'pyw', 'pyi', 'ipynb', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'xhtml', 'vue', 'svelte', 'md', 'markdown',
  'yml', 'yaml', 'toml', 'xml', 'xsd', 'xsl', 'svg', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'cs', 'java', 'kt', 'kts', 'scala', 'groovy', 'gradle',
  'go', 'rs', 'rb', 'php', 'swift', 'dart', 'lua', 'pl', 'pm', 'r', 'jl', 'sql', 'graphql', 'gql', 'proto', 'ini', 'cfg', 'conf', 'properties', 'env', 'tf', 'hcl',
  'txt', 'log', 'csv', 'tsv', 'tex', 'rst', 'diff', 'patch', 'srt', 'vtt'];
const BUCKETS = {
  office: { name: 'Office', short: 'Documents', role: 'Documents, spreadsheets, slides and PDF' },
  design: { name: 'Design & media', short: 'Creative', role: 'Photos, artwork, layout, motion, video and sound' },
  coding: { name: 'Coding', short: 'Developer', role: 'Code, Python, web pages and databases' },
  engineering: { name: 'Engineering', short: 'Technical', role: 'Drawings, models, maps and plans' },
};
const APPS = {
  photocraft: { name: 'PhotoCraft', role: 'Image editing', short: 'Photos', bucket: 'design', opens: ['image', 'raw'], except: ['svg', 'svgz', 'ico', 'cur', 'icns'] },
  lightcraft: { name: 'LightCraft', role: 'RAW development', short: 'RAW', bucket: 'design', opens: ['raw', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic', 'heif', 'webp', 'avif', 'jxl'] },
  vectorcraft: { name: 'VectorCraft', role: 'Vector art', short: 'Vector', bucket: 'design', opens: ['vector', 'svg', 'pdf', 'eps', 'ai', 'emf', 'wmf', 'dxf', 'afdesign'] },
  designcraft: { name: 'DesignCraft', role: 'Page layout', short: 'Layout', bucket: 'design', opens: ['layout', 'idml', 'indd'] },
  effectcraft: { name: 'EffectCraft', role: 'Motion graphics', short: 'Motion', bucket: 'design', opens: ['motion', 'lottie', 'ecproj'] },
  filmcraft: { name: 'FilmCraft', role: 'Video editing', short: 'Video', bucket: 'design', opens: ['video', 'timeline', 'fcproj', 'otio', 'fcpxml'] },
  pdfcraft: { name: 'PdfCraft', role: 'PDF workbench', short: 'PDF', bucket: 'office', opens: ['pdf'] },
  cadcraft: { name: 'CADCraft', role: '2D drafting', short: 'CAD', bucket: 'engineering', opens: ['cad2d'] },
  soundcraft: { name: 'SoundCraft', role: 'Audio production', short: 'Audio', bucket: 'design', opens: ['audio', 'scraft'] },
  wordcraft: { name: 'WordCraft', role: 'Word processing', short: 'Docs', bucket: 'office', opens: ['docx', 'doc', 'docm', 'dotx', 'dotm', 'odt', 'rtf', 'md', 'markdown', 'txt', 'html', 'htm'] },
  gridcraft: { name: 'GridCraft', role: 'Spreadsheets', short: 'Sheets', bucket: 'office', opens: ['sheet'], except: ['numbers', 'dif', 'sylk'] },
  deckcraft: { name: 'DeckCraft', role: 'Presentations', short: 'Slides', bucket: 'office', opens: ['pptx', 'pptm', 'ppsx', 'potx', 'deckcraft', 'md', 'markdown'] },
  webcraft: { name: 'WebCraft', role: 'Web pages', short: 'Web', bucket: 'coding', opens: ['html', 'htm', 'xhtml', 'css', 'js', 'mjs', 'md', 'svg'], builtin: true },
  // VSCodium and a CPython runtime ship inside Lime (scripts/engines.mjs); Python is Code with Lime's Python set up in it.
  code: { name: 'Code', role: 'Code editor', short: 'VSCodium', bucket: 'coding', opens: CODE_OPEN, bundledOnly: true },
  python: { name: 'Python', role: 'Python IDE', short: 'Python', bucket: 'coding', opens: ['py', 'pyw', 'pyi', 'ipynb'], bundledOnly: true, needs: ['code'] },
  sqlite: { name: 'SQLite', role: 'Database browser', short: 'Database', bucket: 'coding', opens: ['database'], builtin: true },
  // Engineering: Lime's map and hydrology windows (QGIS, HEC-RAS, HEC-HMS and EPA SWMM open as the full app when they
  // are installed), and ProjectLibre, a full app that ships inside Lime with its own Java runtime.
  maps: { name: 'Maps', role: 'GIS maps', short: 'Maps', opens: ['gis'], builtin: true, external: ['qgis'], bucket: 'engineering' },
  hydro: { name: 'Hydrology', role: 'Stormwater and rivers', short: 'Hydro', opens: ['hydro'], builtin: true, external: ['hecras', 'hechms', 'swmm', 'dssvue'], bucket: 'engineering' },
  projectlibre: { name: 'ProjectLibre', role: 'Project schedules', short: 'Projects', opens: ['project'], bucket: 'engineering' },
  // Third-party apps (`optional`): a build without them, or a platform they don't ship for, simply doesn't show them.
  solidcraft: { name: 'SolidCraft', role: 'Parametric 3D CAD', short: '3D CAD', bucket: 'engineering', opens: ['solidcraft', 'solvecraft', 'step', 'stp', 'iges', 'igs', 'fcstd', '3dm'], optional: true },
  blender: { name: 'Blender', role: '3D modelling & animation', short: '3D', bucket: 'design', opens: ['blend', 'glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'usd', 'usda', 'usdc', 'usdz', 'abc'], optional: true },
};
// Files an app also opens that share their extension with other things (a CSV of coordinates, a GeoTIFF, MS Project XML).
const SNIFF = {
  maps: (f) => require('./geosniff').isGeo(f),
  hydro: (f) => { const S = require('./geosniff'); return S.swmmInp(f) || S.swmmOut(f) || S.rasHdf(f); },
  projectlibre: (f) => U.ext(f) === 'xml' && require('./geosniff').msProject(f),
};
// Programs Lime opens files in when they are installed, but never ships: found in their usual install folders.
const EXTERNAL = {
  qgis: { name: 'QGIS', mac: /^QGIS.*\.app$/i, win: [['QGIS *', 'bin', ['qgis-ltr-bin.exe', 'qgis-bin.exe']], ['OSGeo4W*', 'bin', ['qgis-ltr-bin.exe', 'qgis-bin.exe']]], opens: (f) => require('./geosniff').isGeo(f) || ['qgz', 'qgs'].includes(U.ext(f)) },
  hecras: { name: 'HEC-RAS', win: [['HEC/HEC-RAS/*', '', ['Ras.exe']]], opens: (f) => /\.(prj|[pgfu]\d\d|hdf)$/i.test(f) },
  hechms: { name: 'HEC-HMS', mac: /^HEC-HMS.*\.app$/i, win: [['HEC/HEC-HMS/*', '', ['HEC-HMS.exe']]], opens: (f) => /\.(hms|dss|basin|met|control|gage)$/i.test(f) },
  swmm: { name: 'EPA SWMM', win: [['EPA SWMM*', '', ['epaswmm5.exe']]], opens: (f) => /\.inp$/i.test(f) },
  dssvue: { name: 'HEC-DSSVue', mac: /^HEC-DSSVue.*\.app$/i, win: [['HEC/HEC-DSSVue*', '', ['HEC-DSSVue.exe']], ['HEC/HEC-DSSVue/*', '', ['HEC-DSSVue.exe']]], opens: (f) => /\.dss$/i.test(f) },
};
const verCmp = (a, b) => b.localeCompare(a, undefined, { numeric: true });
function findExternal(id) {
  const x = EXTERNAL[id];
  if (!x) return null;
  if (U.cfg[id] && fs.existsSync(U.cfg[id])) return U.cfg[id];
  if (process.platform === 'darwin') {
    if (!x.mac) return null;
    for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) { const hit = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((n) => x.mac.test(n)).sort(verCmp)[0]; if (hit) return path.join(dir, hit); }
    return null;
  }
  if (!U.isWin || !x.win) return null;
  // Each pattern is "folder/folder*" under Program Files; a star picks the newest version folder.
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), 'C:\\'].filter(Boolean);
  const expand = (base, parts) => {
    if (!parts.length) return [base];
    const [p, ...rest] = parts;
    if (!p.includes('*')) return expand(path.join(base, p), rest);
    const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
    let names = [];
    try { names = fs.readdirSync(base).filter((n) => re.test(n)).sort(verCmp); } catch (_) {}
    return names.flatMap((n) => expand(path.join(base, n), rest));
  };
  for (const root of roots) for (const [pattern, sub, exes] of x.win) for (const dir of expand(root, pattern.split('/'))) for (const exe of exes) { const p = path.join(dir, sub, exe); if (fs.existsSync(p)) return p; }
  return null;
}
const hasExternal = (id) => !!findExternal(id);
const bundledManifest = () => bundledApps();
async function openExternal(id, files = []) {
  const app = findExternal(id);
  if (!app) throw new Error(`${EXTERNAL[id]?.name || 'That program'} isn’t installed on this computer.`);
  await launch(app, files, EXTERNAL[id].name);
  return app;
}
const exe = (id) => `${id}-cli${U.isWin ? '.exe' : ''}`;
const unpacking = new Map();

async function cli(id) {
  const raw = path.join(U.cfg.crafts, exe(id));
  if (fs.existsSync(raw)) return raw;
  const br = `${raw}.br`;
  // On Mac and Windows the engine ships inside its app's archive.
  if (!fs.existsSync(br) && bundledApps()[id]?.cli && fs.existsSync(appSource(id))) { await bundledApp(id); return path.join(appDir(id), bundledApps()[id].cli); }
  if (!fs.existsSync(br)) throw Object.assign(new Error(`The ${APPS[id].name} engine isn’t in this build of Lime.`), { code: 'ENGINE_MISSING' });
  const dest = path.join(U.cfg.user, 'crafts', `${id}-${fs.statSync(br).size}`, exe(id));
  if (fs.existsSync(dest)) return dest;
  if (!unpacking.has(id)) {
    unpacking.set(id, (async () => {
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      // Each worker thread unpacks into its own file, so two threads starting at once can't interleave their writes.
      const part = `${dest}.${process.pid}-${require('worker_threads').threadId}.part`;
      await pipeline(fs.createReadStream(br), zlib.createBrotliDecompress(), fs.createWriteStream(part, { mode: 0o755 }));
      await fsp.rename(part, dest).catch((e) => { fsp.rm(part, { force: true }).catch(() => {}); if (!fs.existsSync(dest)) throw e; });
      for (const d of await fsp.readdir(path.join(U.cfg.user, 'crafts'))) if (d.startsWith(`${id}-`) && d !== path.basename(path.dirname(dest))) fsp.rm(path.join(U.cfg.user, 'crafts', d), { recursive: true, force: true }).catch(() => {});
      return dest;
    })().finally(() => unpacking.delete(id)));
  }
  return unpacking.get(id);
}
function quiet(s) { return String(s).split(/\r?\n/).filter((l) => l && !/WARN|warning:/.test(l)).slice(-2).join(' — '); }
async function run(id, args, ctx, label, opts = {}) {
  // The time limit also covers unpacking the engine, which happens before it can start.
  let limit;
  const late = opts.timeout && new Promise((_, rej) => { limit = setTimeout(() => rej(Object.assign(new Error(`${APPS[id].name} couldn’t finish (it stopped responding)`), { code: 'TIMEOUT' })), opts.timeout); });
  const bin = await (late ? Promise.race([cli(id), late]) : cli(id)).finally(() => clearTimeout(limit));
  ctx?.progress?.(0.15, label);
  let tick = 0.15;
  const t = setInterval(() => { tick = Math.min(0.92, tick + (0.95 - tick) * 0.06); ctx?.progress?.(tick, label); }, 400);
  try {
    return await U.run(bin, args, { signal: ctx?.signal, cwd: opts.cwd || os.tmpdir(), okCodes: opts.okCodes, timeout: opts.timeout, errorMessage: `${APPS[id].name} couldn’t finish`, env: { NO_COLOR: '1', ...opts.env } });
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
  await run('photocraft', args, ctx, `Rendering with PhotoCraft`, { timeout: 90000 });
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
    // app.export cuts to a 3000 px long edge unless told otherwise, so full size is asked for explicitly.
    const args = ['run', '--import', p, 'develop.auto', 'app.export', `path=${out}`, `longEdge=${size || 0}`];
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
async function pdfScript(steps, ctx, label) {
  const dir = await U.tmpDir('pdfrun');
  try {
    const file = path.join(dir, 'steps.json');
    await fsp.writeFile(file, JSON.stringify(steps));
    const rep = lastJson((await run('pdfcraft', ['run', '--script', file, '--report'], ctx, label, { okCodes: [1] })).stdout);
    const bad = rep?.steps?.find((st) => st.status === 'error');
    if (!rep?.steps || bad) throw new Error(String(bad?.error || 'PdfCraft couldn’t finish.').replace(/^step \d+ \([a-z_]+\): /, ''));
    return rep.steps.map((st) => st.result?.[0]);
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const openDoc = (p, password) => ({ tool: 'doc_open', args: { path: p, ...(password ? { password } : {}) } });
async function toPdfA(p, opts, ctx) {
  const level = opts.level === '3b' ? '3b' : '2b', out = ctx.out.file(p, `${U.base(p)}-pdfa.pdf`);
  const [, , , v] = await pdfScript([openDoc(p, opts.password), { tool: 'pdfa_convert', args: { doc: 1, level } }, { tool: 'doc_save', args: { doc: 1, path: out, full: true } }, { tool: 'pdfa_verify', args: { doc: 1, level } }], ctx, 'Saving as PDF/A');
  const issues = [...new Set((v?.issues || []).map((i) => i.message))];
  return { path: out, note: v?.compliant ? `PDF/A-${level}, checked: no issues` : `Saved as PDF/A-${level}, but ${issues.length === 1 ? 'one thing still breaks' : `${issues.length} things still break`} the standard: ${issues.slice(0, 3).join('; ')}` };
}
async function comparePdf([older, newer], opts, ctx) {
  const report = opts.output === 'report', out = ctx.out.file(newer, `${U.base(newer)} - ${report ? 'changes' : 'compared'}.pdf`);
  const res = await pdfScript([openDoc(older), openDoc(newer), { tool: 'doc_compare', args: { doc: 2, other: 1, limit: 1 } }, report ? { tool: 'doc_compare_report', args: { doc: 2, other: 1, path: out } } : { tool: 'doc_compare_mark', args: { doc: 2, other: 1 } }, ...(report ? [] : [{ tool: 'doc_save', args: { doc: 2, path: out, full: true } }])], ctx, 'Comparing');
  const c = res[2] || {}, n = (k, w) => (c[k] ? `${c[k]} ${w}` : '');
  return { path: out, note: c.identical ? 'The text is identical' : [n('replaced', 'changed'), n('inserted', 'added'), n('deleted', 'removed')].filter(Boolean).join(', ') || 'Compared' };
}
async function makeFillable(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-fillable.pdf`);
  const [, found] = await pdfScript([openDoc(p, opts.password), { tool: 'form_detect_fields', args: { doc: 1, add: true } }, { tool: 'doc_save', args: { doc: 1, path: out, full: true } }], ctx, 'Finding form fields');
  const k = found?.fields?.length || 0;
  if (!k) { await fsp.rm(out, { force: true }); throw new Error('No blanks, lines or boxes to turn into fields were found.'); }
  return { path: out, note: `Added ${k} field${k === 1 ? '' : 's'}` };
}
async function enhanceScan(pdfIn, opts, ctx) {
  const { doc } = await require('./pdf').readPdf(pdfIn), pages = doc.countPages();
  let straight = 0;
  for (let i = 1; i <= pages; i++) {
    const [x0, y0, x1, y1] = doc.loadPage(i - 1).getBounds(), w = x1 - x0, h = y1 - y0;
    const enhance = (more) => pdfScript([openDoc(pdfIn), { tool: 'page_enhance_camera', args: { doc: 1, page: i, mode: opts.mode || 'greyscale', ...more } }, { tool: 'doc_save', args: { doc: 1 } }], ctx, `Straightening page ${i} of ${pages}`);
    // A flat scan has no desk edges to find: the whole page is the document, so the look still applies.
    try { await enhance({}); straight++; } catch (_) { await enhance({ corners: [0, 0, w, 0, w, h, 0, h] }).catch(() => {}); }
  }
  return straight;
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

// One-click actions from the seven apps, each on its app's ring in the wheel. Every one runs the app's own engine
// headless and was checked on real output (pixels, pages, text, streams), not just for a file being written.
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const cmdArgs = (cmds) => cmds.flatMap(([id, params]) => ['--cmd', id, ...(params ? ['--params', JSON.stringify(params)] : [])]);

// ── PhotoCraft ──────────────────────────────────────────────────────────────────────────────────────────────────
// Filters act on the active layer, so a layered file is merged first (Merge Visible keeps transparency; Flatten would not).
const LAYERED = ['psd', 'psb', 'pcraft', 'tif', 'tiff'];
const photoOut = (p) => (['jpg', 'jpeg', 'png', 'webp'].includes(U.ext(p)) ? (U.ext(p) === 'jpeg' ? 'jpg' : U.ext(p)) : 'png');
async function photoRun(p, cmds, suffix, ctx, label) {
  const to = photoOut(p), out = ctx.out.file(p, `${U.base(p)}${suffix}.${to}`);
  const args = (merge) => ['run', p, ...cmdArgs([...(merge ? [['layer.mergeVisible']] : []), ...cmds]), '--out', out, ...(to === 'jpg' || to === 'webp' ? ['--quality', '92'] : [])];
  const layered = LAYERED.includes(U.ext(p));
  await run('photocraft', args(layered), ctx, label, { timeout: 90000 }).catch((e) => {
    if (layered && /not enough visible layers/.test(e.message)) return run('photocraft', args(false), ctx, label, { timeout: 90000 });
    throw e;
  });
  return out;
}
const autoTone = (p, opts, ctx) => photoRun(p, [['image.autoTone']], '-autotone', ctx, 'Balancing tones');
const sharpenPhoto = (p, opts, ctx) => photoRun(p, [['filter.sharpen.smartSharpen', { amount: Number(opts.amount) || 120, radius: Number(opts.radius) || 1.5, reduceNoise: 10 }]], '-sharpened', ctx, 'Sharpening');
const denoisePhoto = (p, opts, ctx) => photoRun(p, [['filter.noise.reduceNoise', { strength: Number(opts.strength) || 10, preserveDetails: 30, reduceColorNoise: 80, sharpenDetails: 0, removeJpegArtifact: true }]], '-denoised', ctx, 'Reducing noise');
const liftShadows = (p, opts, ctx) => photoRun(p, [['image.adjustments.shadowsHighlights', { shadowAmount: Number(opts.amount ?? 50), highlightAmount: 10 }]], '-shadows', ctx, 'Brightening shadows');
const LOOKS = { oil: 'filter.stylize.oilPaint', watercolor: 'filter.gallery.watercolor', poster: 'filter.gallery.cutout', ink: 'filter.gallery.inkOutlines', pencil: 'filter.gallery.coloredPencil' };
const paintPhoto = (p, opts, ctx) => photoRun(p, [[LOOKS[opts.look] || LOOKS.oil]], `-${LOOKS[opts.look] ? opts.look : 'oil'}`, ctx, 'Painting');
// Crop and Straighten opens one new document per photo it finds; each is saved in turn until there is no next one.
async function straightenScans(p, opts, ctx) {
  const dir = ctx.out.folder(p, `${U.base(p)} - photos`), to = U.ext(p) === 'jpg' || U.ext(p) === 'jpeg' ? 'jpg' : 'png';
  const saves = [...Array(30).keys()].flatMap((i) => [['document.activate', { document: i + 1 }], ['file.saveACopy', { path: path.join(dir, `${U.base(p)} ${String(i + 1).padStart(2, '0')}.${to}`), ...(to === 'jpg' ? { quality: 11 } : {}) }]]);
  const r = await run('photocraft', ['run', p, ...cmdArgs([['file.automate.cropAndStraightenPhotos'], ...saves])], ctx, 'Finding photos', { okCodes: [1], timeout: 90000 });
  const found = jsonLines(r.stdout).find((j) => j.command === 'file.automate.cropAndStraightenPhotos')?.result?.photos || [];
  const made = (await fsp.readdir(dir)).length;
  if (!found.length || !made) { await fsp.rm(dir, { recursive: true, force: true }); throw new Error('No photos were found. Scan them on a plain, light background with a gap between them.'); }
  return { path: dir, note: `${plural(made, 'photo')} cut out and straightened` };
}
async function exportLayers(p, opts, ctx) {
  const dir = ctx.out.folder(p, `${U.base(p)} - layers`);
  const r = await run('photocraft', ['run', p, ...cmdArgs([['file.export.layersToFiles', { dir, format: opts.format || 'png', prefix: '', visibleOnly: opts.hidden !== true }]])], ctx, 'Saving layers', { timeout: 90000 });
  const files = jsonLines(r.stdout).find((j) => j.command === 'file.export.layersToFiles')?.result?.files || [];
  return { path: dir, note: `${plural(files.length, 'layer')} saved` };
}
async function layerInfo(p, opts, ctx) {
  const d = lastJson((await run('photocraft', ['info', p, '--compact'], ctx, 'Reading layers', { timeout: 90000 })).stdout) || {};
  const lines = [], walk = (ls, depth) => (ls || []).forEach((l) => { lines.push(`${'  '.repeat(depth)}${l.visible ? '•' : '◦'} ${l.name} (${l.kind}${l.opacity < 1 ? `, ${Math.round(l.opacity * 100)}%` : ''}${l.blend && l.blend !== 'Normal' ? `, ${l.blend}` : ''})`); walk(l.children || l.layers, depth + 1); });
  walk(d.layers, 0);
  return { note: `${d.width}×${d.height} ${String(d.mode).toUpperCase()} ${d.depth}-bit, ${plural(lines.length, 'layer')}`, text: lines.join('\n') };
}

// ── LightCraft ──────────────────────────────────────────────────────────────────────────────────────────────────
// app.export shrinks to a 3000 px long edge unless told otherwise, so longEdge=0 keeps the full size.
const lightOut = (p, suffix) => `${U.base(p)}${suffix}.${['png', 'tif', 'tiff'].includes(U.ext(p)) ? 'png' : 'jpg'}`;
async function lightRun(p, cmds, suffix, ctx, label) {
  const out = ctx.out.file(p, lightOut(p, suffix));
  const r = await run('lightcraft', ['run', '--import', p, ...cmds.flat(), 'app.export', `path=${out}`, 'longEdge=0', 'quality=92'], ctx, label);
  const lines = jsonLines(r.stdout), fail = lines.find((j) => j.ok === false);
  if (fail) throw new Error(fail.error || 'LightCraft couldn’t finish.');
  if (!fs.existsSync(out)) throw new Error('LightCraft finished without writing a file.');
  return { out, lines };
}
// LightCraft's built-in looks (presets.list), in its own order.
const LIGHT_PRESETS = ['warm-glow', 'cool-morning', 'teal-orange', 'vivid-pop', 'soft-pastel', 'faded-matte', 'warm-film', 'muted-film', 'bw-high-contrast', 'bw-soft', 'bw-selenium', 'bw-sepia', 'crisp-landscape', 'golden-hour', 'blue-hour', 'crisp-vista', 'deep-sky', 'lush-greens', 'desert-warmth', 'misty-morning', 'soft-skin', 'bright-airy', 'moody-portrait', 'golden-glow', 'clean-studio', 'moody', 'cinematic', 'gritty-street', 'neon-night', 'concrete-cool', 'faded-urban', 'fresh-bright', 'warm-table', 'dark-moody-food', 'autumn-gold', 'winter-blue', 'spring-fresh', 'summer-haze', 'instant-70s', 'cross-process', 'bleach-bypass'].map((x) => `lc.${x}`);
const LIGHT_LOOKS = { 'lc.vivid-pop': 'vivid', 'lc.warm-film': 'film', 'lc.cinematic': 'cinematic', 'lc.bw-high-contrast': 'bw', 'lc.instant-70s': '70s', 'lc.bright-airy': 'airy', 'lc.moody': 'moody', 'lc.golden-hour': 'golden' };
async function lookPhoto(p, opts, ctx) {
  const preset = opts.preset || 'lc.vivid-pop', out = ctx.out.file(p, lightOut(p, `-${LIGHT_LOOKS[preset] || preset.replace(/^lc\./, '')}`));
  await run('lightcraft', ['render', p, '-o', out, '--preset', preset, '--quality', '92'], ctx, 'Applying look');
  if (!fs.existsSync(out)) throw new Error('LightCraft finished without writing a file.');
  return out;
}
const smartBw = async (p, opts, ctx) => (await lightRun(p, [['develop.autoBwMix']], '-bw', ctx, 'Mixing black & white')).out;
async function straightenPhoto(p, opts, ctx) {
  const { out, lines } = await lightRun(p, [['crop.autoStraighten']], '-straight', ctx, 'Levelling');
  const r = lines.find((j) => j.command === 'crop.autoStraighten')?.result || {};
  if (!r.changed) { await fsp.rm(out, { force: true }); throw new Error(r.reason ? `Nothing to straighten: ${r.reason}.` : 'This photo is already level.'); }
  return { path: out, note: `Turned ${Math.abs(r.angle).toFixed(1)}° ${r.angle > 0 ? 'clockwise' : 'counter-clockwise'} and cropped` };
}
async function removeDust(p, opts, ctx) {
  const { out, lines } = await lightRun(p, [['spot.findDust', `sensitivity=${Number(opts.sensitivity ?? 50)}`]], '-clean', ctx, 'Removing dust');
  const n = lines.find((j) => j.command === 'spot.findDust')?.result?.added || 0;
  if (!n) { await fsp.rm(out, { force: true }); throw new Error('No dust spots were found.'); }
  return { path: out, note: `${plural(n, 'spot')} healed` };
}
// Merges every bracket set among the files (or in a folder) into an HDR DNG plus a JPG, gathered in one folder.
async function hdrBatch(files, opts, ctx) {
  const r = await run('lightcraft', ['merge', 'hdr-batch', ...files], ctx, 'Merging bracket sets');
  const j = lastJson(r.stdout) || {}, merged = (j.merged || []).map((m) => m.path).filter((f) => fs.existsSync(f));
  if (!merged.length) throw new Error('No bracket sets were found: shoot 3 or more exposures of each scene, less than a second apart.');
  const dir = ctx.out.folder(files[0], `${fs.statSync(files[0]).isDirectory() ? path.basename(files[0]) : U.base(files[0])} - HDR`);
  for (const dng of merged) {
    const keep = path.join(dir, path.basename(dng));
    await fsp.rename(dng, keep).catch(async () => { await fsp.copyFile(dng, keep); await fsp.rm(dng, { force: true }); });
    await run('lightcraft', ['render', keep, '-o', path.join(dir, `${U.base(keep)}.jpg`), '--quality', '92'], ctx, 'Developing');
  }
  return { path: dir, note: `${plural(merged.length, 'HDR photo')} merged${j.failed?.length ? `, ${j.failed.length} set${j.failed.length === 1 ? '' : 's'} couldn’t be` : ''}` };
}

// ── VectorCraft ─────────────────────────────────────────────────────────────────────────────────────────────────
const TRACE = { auto: 'Auto Color', logo: 'Flat Logo', colors16: '16 Colors', photo: 'High Fidelity Photo', bw: 'Black and White Logo', lineart: 'Line Art', sketch: 'Sketched Art' };
async function traceImage(p, opts, ctx) {
  const to = ['svg', 'ai', 'pdf', 'eps'].includes(opts.to) ? opts.to : 'svg', out = ctx.out.file(p, `${U.base(p)}.${to}`);
  const params = { preset: TRACE[opts.style] || TRACE.auto, ...(opts.transparent ? { params: { ignoreWhite: true } } : {}) };
  const r = await run('vectorcraft', ['run', '--in', p, '--cmd', 'select.all', '--cmd', 'imageTrace.makeAndExpand', '--params', JSON.stringify(params), '--export', out], ctx, 'Tracing', { timeout: 120000 });
  const t = jsonLines(r.stdout).find((j) => j.command === 'imageTrace.makeAndExpand')?.result;
  if (!t || !fs.existsSync(out)) throw new Error('VectorCraft couldn’t trace this image.');
  return { path: out, note: `${plural(t.paths, 'shape')}, ${plural(t.colors, 'colour')}` };
}
async function outlineText(p, opts, ctx) {
  const to = ['svg', 'ai', 'eps', 'pdf'].includes(U.ext(p)) ? U.ext(p) : 'pdf', out = ctx.out.file(p, `${U.base(p)}-outlined.${to}`);
  const r = await run('vectorcraft', ['run', '--in', p, '--cmd', 'select.all', '--cmd', 'type.createOutlines', '--export', out], ctx, 'Outlining text', { okCodes: [1] });
  const ids = jsonLines(r.stdout).find((j) => j.command === 'type.createOutlines')?.result?.ids;
  if (!ids) { await fsp.rm(out, { force: true }); throw new Error(/select text objects/.test(r.stderr) ? 'There’s no text to outline.' : `VectorCraft couldn’t finish (${String(r.stderr).trim().split('\n').pop()})`); }
  return { path: out, note: `${plural(ids.length, 'text object')} turned into shapes` };
}
async function exportArtboards(p, opts, ctx) {
  const dir = ctx.out.folder(p, `${U.base(p)} - artboards`), to = opts.to || 'png';
  const row = { format: to, ...(['png', 'jpg', 'webp'].includes(to) ? { scale: Number(opts.scale) || 2, suffix: '' } : {}) };
  const r = await run('vectorcraft', ['run', '--in', p, '--cmd', 'document.exportForScreens', '--params', JSON.stringify({ folder: dir, formats: [row] })], ctx, 'Exporting artboards');
  const files = jsonLines(r.stdout).find((j) => j.command === 'document.exportForScreens')?.result?.files || [];
  return { path: dir, note: `${plural(files.length, 'artboard')} saved` };
}
// The built-in Logo Package preset: SVG, PNG 1× and 2×, PDF, and a print PDF with marks, in svg/png/pdf folders.
async function logoPackage(p, opts, ctx) {
  const dir = ctx.out.folder(p, `${U.base(p)} - logo package`);
  const r = await run('vectorcraft', ['run', '--in', p, '--cmd', 'document.exportForScreens', '--params', JSON.stringify({ folder: dir, exportPreset: 'Logo Package' })], ctx, 'Packaging logo');
  const files = jsonLines(r.stdout).find((j) => j.command === 'document.exportForScreens')?.result?.files || [];
  return { path: dir, note: `${plural(files.length, 'file')}: SVG, PNG, PDF and print PDF` };
}
async function vectorInfo(p, opts, ctx) {
  const d = lastJson((await run('vectorcraft', ['info', p], ctx, 'Reading')).stdout) || {};
  const missing = (d.fonts || []).filter((f) => f.missing || f.status !== 'exact');
  const text = [`Colour mode: ${d.info?.colorMode?.toUpperCase()}`, `Units: ${d.info?.units}`, `Artboards: ${(d.artboards || []).map((a) => `${a.name} (${Math.round(a.rect[2])}×${Math.round(a.rect[3])})`).join(', ')}`,
    `Objects: ${Object.entries(d.kinds || {}).filter(([k]) => k !== 'Layer').map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`, `Fonts: ${(d.fonts || []).map((f) => `${f.family} ${f.style}${f.status !== 'exact' ? ` (${f.missing ? 'missing' : f.status})` : ''}`).join(', ') || 'none'}`,
    ...(d.warnings || []).map((w) => `Note: ${w.message || w}`)].join('\n');
  return { note: `${plural((d.artboards || []).length, 'artboard')}, ${plural((d.fonts || []).length, 'font')}${missing.length ? `, ${missing.length} missing` : ''}`, text };
}

// ── DesignCraft ─────────────────────────────────────────────────────────────────────────────────────────────────
async function preflightLayout(p, opts, ctx) {
  const r = lastJson((await run('designcraft', ['run', '--in', p, '--cmd', `preflight.run=${JSON.stringify({ minPpi: Number(opts.minPpi) || 150 })}`], ctx, 'Preflighting')).stdout) || {};
  const issues = r.issues || [];
  return { note: issues.length ? `${plural(r.errors || 0, 'error')}, ${plural(r.warnings || 0, 'warning')}` : 'Ready to print: no problems found', text: issues.map((i) => `${i.severity === 'error' ? '✗' : '!'} Page ${(i.page ?? 0) + 1}: ${i.message}`).join('\n') };
}
// A folder with the document, an IDML copy, a PDF, its Links/ and fonts (where their licences allow) and a report.
async function packageLayout(p, opts, ctx) {
  const dir = ctx.out.folder(p, `${U.base(p)} Folder`);
  await fsp.rm(dir, { recursive: true, force: true }); // file.package creates the folder itself
  const r = lastJson((await run('designcraft', ['run', '--in', p, '--cmd', `file.package=${JSON.stringify({ dir, idml: true, pdf: opts.pdf !== false })}`], ctx, 'Packaging')).stdout) || {};
  if (!fs.existsSync(dir)) throw new Error('DesignCraft couldn’t package this document.');
  const issues = /Preflight: (\d+) issue/.exec(r.report || '')?.[1];
  return { path: dir, note: `${plural((r.files || []).length, 'file')}${issues ? `; preflight found ${plural(Number(issues), 'issue')}` : ''}` };
}
// print: bleed, crop marks and PDF/X-4. web: compressed images, tagged, opens with bookmarks.
const PDF_PRESETS = { print: { bleed: true, marks: true, standard: 'x4' }, web: { compressImages: true, tagged: true, bookmarksPanel: true } };
async function layoutPdf(p, opts, ctx) {
  const kind = opts.preset === 'web' ? 'web' : 'print', out = ctx.out.file(p, `${U.base(p)}-${kind}.pdf`);
  const r = await run('designcraft', ['run', '--in', p, '--pdf-options', JSON.stringify(PDF_PRESETS[kind]), '--export', out], ctx, kind === 'web' ? 'Exporting web PDF' : 'Exporting print PDF');
  const pages = /\((\d+) pages?/.exec(r.stdout)?.[1];
  return { path: out, note: `${pages ? plural(Number(pages), 'page') : 'PDF'}${kind === 'print' ? ' with bleed and crop marks, PDF/X-4' : ', compressed and tagged'}` };
}
async function fixedEpub(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-fixed.epub`);
  const r = lastJson((await run('designcraft', ['run', '--in', p, '--cmd', `file.exportFixedEpub=${JSON.stringify({ path: out })}`], ctx, 'Exporting EPUB')).stdout) || {};
  if (!fs.existsSync(out)) throw new Error('DesignCraft couldn’t export this EPUB.');
  return { path: out, note: `Fixed layout, ${plural(r.pages || 0, 'page')}` };
}
async function bookletPdf(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-booklet.pdf`);
  const r = lastJson((await run('designcraft', ['run', '--in', p, '--cmd', `file.printBooklet=${JSON.stringify({ path: out, type: 'saddleStitch' })}`], ctx, 'Imposing booklet')).stdout) || {};
  if (!fs.existsSync(out)) throw new Error('DesignCraft couldn’t make a booklet of this document.');
  return { path: out, note: `${plural(r.sheets || 0, 'sheet side')} in booklet order: print double-sided, fold and staple` };
}

// ── EffectCraft ─────────────────────────────────────────────────────────────────────────────────────────────────
async function motionProject(p, dir, ctx) {
  if (U.ext(p) === 'ecproj') return p;
  const project = path.join(dir, 'anim.ecproj');
  await run('effectcraft', ['--empty', '--save-as', project, 'run', 'file.importLottie', JSON.stringify({ path: p })], ctx, 'Reading animation');
  return project;
}
const motionComp = async (project, ctx) => lastJson((await run('effectcraft', ['--project', project, 'info', '--json'], ctx, 'Reading animation')).stdout)?.activeComp || {};
// The middle frame (the first one is often still blank), transparent where the animation has no background.
async function posterFrame(p, opts, ctx) {
  const dir = await U.tmpDir('motion');
  try {
    const project = await motionProject(p, dir, ctx), comp = await motionComp(project, ctx), out = ctx.out.file(p, `${U.base(p)}-poster.png`);
    const time = opts.time != null && opts.time !== '' ? Number(opts.time) : (comp.duration || 0) / 2;
    await run('effectcraft', ['--project', project, 'render-frame', '--time', String(time), '--out', out, ...(opts.transparent !== false ? ['--transparent'] : []), ...(opts.maxSide ? ['--max-side', String(opts.maxSide)] : [])], ctx, 'Rendering frame');
    return { path: out, note: `Frame at ${time.toFixed(1)} s of ${(comp.duration || 0).toFixed(1)} s` };
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
// Transparent GIF (half size by default: full-size GIFs take ~3.5 s per second of animation and get big) or ProRes 4444 MOV.
// WebM with alpha also works (--format webm --channels rgba) but VP9 is slow: 38 s at half size, 127 s full for 10 s of 1080p.
const ALPHA = { gif: ['gif', 'gif'], mov: ['mov', 'prores', '--prores', '4444'] };
async function alphaRender(p, opts, ctx) {
  const [ext, format, ...more] = ALPHA[opts.to] || ALPHA.gif, dir = await U.tmpDir('motion');
  try {
    const project = await motionProject(p, dir, ctx), out = ctx.out.file(p, `${U.base(p)}-transparent.${ext}`);
    await run('effectcraft', ['--project', project, 'render', '--out', out, '--format', format, ...more, '--channels', 'rgba', '--resolution', opts.resolution || (ext === 'mov' ? 'full' : 'half')], ctx, `Rendering ${ext.toUpperCase()}`, { timeout: 300000 });
    return out;
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function frameSequence(p, opts, ctx) {
  const tmp = await U.tmpDir('motion');
  try {
    const project = await motionProject(p, tmp, ctx), dir = ctx.out.folder(p, `${U.base(p)} - frames`);
    await run('effectcraft', ['--project', project, 'render', '--out', path.join(dir, `${U.sanitize(U.base(p))}.png`), '--format', 'png', '--channels', 'rgba', '--resolution', opts.resolution || 'full'], ctx, 'Rendering frames', { timeout: 300000 });
    return { path: dir, note: `${plural((await fsp.readdir(dir)).length, 'frame')} (transparent PNG)` };
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}
async function motionInfo(p, opts, ctx) {
  const dir = await U.tmpDir('motion');
  try {
    const c = await motionComp(await motionProject(p, dir, ctx), ctx), layers = c.layers || [];
    return { note: `${c.width}×${c.height}, ${(c.duration || 0).toFixed(2)} s at ${Math.round((c.frameRate || 0) * 100) / 100} fps, ${plural(layers.length, 'layer')}`, text: [`Composition: ${c.name}`, ...layers.map((l) => `#${l.index} ${l.name} (${l.type}) ${l.in.toFixed(2)}–${l.out.toFixed(2)} s`)].join('\n') };
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// ── FilmCraft ───────────────────────────────────────────────────────────────────────────────────────────────────
const TICKS = 254016000000; // per second
const MATCH = 'Match Source – Adaptive High Bitrate'; // en dash
async function filmScript(p, steps, ctx, label) {
  const dir = await U.tmpDir('film');
  try {
    const script = path.join(dir, 'steps.jsonl');
    const open = [{ id: 'file.import', params: { paths: [p] } }, { id: 'project.selectAll', params: {} }, { id: 'file.newSequenceFromClip', params: {} }, { id: 'edit.selectAll', params: {} }];
    await fsp.writeFile(script, [...open, ...steps].map((s) => JSON.stringify(s)).join('\n'));
    const lines = jsonLines((await run('filmcraft', ['--compact', 'run', script], ctx, label, { okCodes: [1] })).stdout);
    const bad = lines.find((l) => l.ok === false);
    if (bad || lines.length < open.length + steps.length) throw new Error(String(bad?.error || 'FilmCraft couldn’t finish.').replace(/^command `[^`]+` is not available right now: /, ''));
    return lines.slice(open.length).map((l) => l.result);
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const exportStep = (out, preset, more = {}) => ({ id: 'file.exportMedia', params: { path: out, preset, wait: true, ...more } });
async function splitScenes(p, opts, ctx) {
  const [found] = await filmScript(p, [{ id: 'clip.sceneEditDetection', params: { sensitivity: Number(opts.sensitivity) || 50, applyCuts: false, generateMarkers: true, wait: true } }], ctx, 'Finding scenes');
  const cuts = (found?.clips?.[0]?.cuts || []).map((t) => t / TICKS), info = lastJson((await run('filmcraft', ['probe', p], null, '')).stdout) || {};
  const ends = [0, ...cuts, (info.duration || 0) / TICKS].filter((t, i, a) => i === 0 || t - a[i - 1] > 0.05);
  if (ends.length < 3) throw new Error('Only one scene was found, so there’s nothing to split.');
  const dir = ctx.out.folder(p, `${U.base(p)} - scenes`), ext = info.video ? 'mp4' : 'm4a';
  await filmScript(p, ends.slice(1).map((end, i) => exportStep(path.join(dir, `${U.sanitize(U.base(p))} - scene ${String(i + 1).padStart(2, '0')}.${ext}`), info.video ? MATCH : 'AAC Audio 48 kHz 320 kbps', { range: 'custom', startSeconds: ends[i], endSeconds: end })), ctx, 'Saving scenes');
  return { path: dir, note: `${plural(ends.length - 1, 'scene')}, cut at ${cuts.map((t) => `${t.toFixed(1)} s`).join(', ')}` };
}
async function mediaInfo(p, opts, ctx) {
  const d = lastJson((await run('filmcraft', ['probe', p], ctx, 'Reading')).stdout) || {}, v = d.video, secs = (d.duration || 0) / TICKS;
  const fps = v?.frame_rate ? Math.round((v.frame_rate.num / v.frame_rate.den) * 100) / 100 : null;
  const audio = (d.audio_streams || []).map((a) => `${a.codec} ${a.channels === 1 ? 'mono' : a.channels === 2 ? 'stereo' : `${a.channels} ch`} ${a.sample_rate / 1000} kHz`);
  const text = [`Container: ${d.container}`, `Duration: ${secs.toFixed(2)} s`, `Size: ${U.fmtBytes(d.file_size || 0)}`, ...(v ? [`Video: ${v.codec}, ${v.width}×${v.height}, ${fps} fps, ${v.pixel_format}${v.has_alpha ? ', alpha' : ''}${v.bitrate ? `, ${Math.round(v.bitrate / 1000)} kbps` : ''}`, `Colour: ${v.color?.primaries}/${v.color?.transfer}, ${v.color?.range} range`] : []), ...audio.map((a, i) => `Audio ${i + 1}: ${a}`), ...(d.start_timecode ? [`Timecode: ${d.start_timecode}`] : [])].join('\n');
  return { note: [v && `${v.width}×${v.height} ${v.codec.replace(/ \(.*\)/, '')}`, fps && `${fps} fps`, `${secs.toFixed(1)} s`, audio[0]].filter(Boolean).join(', '), text };
}
const VIDEO_LOOKS = ['Teal Shadows, Warm Skin', 'Golden Dusk', 'Steel Blue', 'Hard Sun', 'Night Exterior', 'Faded Print', 'Silver Retention', 'Cross Processed', 'Warm Negative', 'Neutral Mono', 'Hard Mono', 'Sepia Tone', 'Cold Mono'];
async function videoLook(p, opts, ctx) {
  const look = VIDEO_LOOKS.includes(opts.look) ? opts.look : VIDEO_LOOKS[0], out = ctx.out.file(p, `${U.base(p)}-graded.mp4`);
  await filmScript(p, [{ id: 'lumetri.applyPreset', params: { name: look } }, exportStep(out, MATCH)], ctx, 'Grading');
  return { path: out, note: look };
}
// Dialogue noise and rumble removal (Essential Sound ▸ Repair). Audio stays audio; video is re-encoded.
async function cleanVoice(p, opts, ctx) {
  const video = !!(lastJson((await run('filmcraft', ['probe', p], null, '')).stdout) || {}).video, lossless = ['wav', 'aif', 'aiff', 'flac'].includes(U.ext(p));
  const out = ctx.out.file(p, `${U.base(p)}-clean.${video ? 'mp4' : lossless ? 'wav' : 'm4a'}`);
  await filmScript(p, [{ id: 'essentialSound.setType', params: { type: 'dialogue' } }, { id: 'essentialSound.set', params: { values: { 'repair.noise.on': true, 'repair.noise.amount': Number(opts.amount) || 8, 'repair.rumble.on': true } } },
    exportStep(out, video ? MATCH : lossless ? 'Waveform Audio 48 kHz 24-bit' : 'AAC Audio 48 kHz 320 kbps')], ctx, 'Cleaning up the voice');
  return out;
}
// An intra-frame copy that editing apps scrub smoothly: ProRes 422 (Final Cut, Premiere, Resolve) or DNxHR (Avid).
async function editReady(p, opts, ctx) {
  const dnx = opts.codec === 'dnxhr', out = ctx.out.file(p, `${U.base(p)}-${dnx ? 'dnxhr' : 'prores'}.mov`);
  await filmScript(p, [exportStep(out, dnx ? 'Avid DNxHR SQ' : 'Apple ProRes 422')], ctx, dnx ? 'Writing DNxHR' : 'Writing ProRes');
  return out;
}

// ── PdfCraft ────────────────────────────────────────────────────────────────────────────────────────────────────
async function sanitizePdf(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-sanitized.pdf`);
  const [, info, done] = await pdfScript([openDoc(p, opts.password), { tool: 'doc_hidden_info', args: { doc: 1 } }, { tool: 'doc_remove_hidden', args: { doc: 1 } }, { tool: 'doc_save', args: { doc: 1, path: out, full: true } }], ctx, 'Removing hidden data');
  const found = (info?.categories || []).filter((c) => c.count).map((c) => `${c.label.toLowerCase()} (${c.count})`);
  return { path: out, note: done?.removed ? `Removed ${found.join(', ')}` : 'Nothing hidden was found' };
}
async function batesPdf(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-bates.pdf`), start = Number(opts.start) || 1, digits = Number(opts.digits) || 6, prefix = String(opts.prefix ?? '').replace(/#/g, '');
  const token = `<<Bates Number#${digits}#${start}#${prefix}#${String(opts.suffix ?? '').replace(/#/g, '')}>>`;
  const [, , , { pages } = {}] = await pdfScript([openDoc(p, opts.password), { tool: 'doc_header_footer', args: { doc: 1, [`footer_${opts.position || 'right'}`]: token, font_size: 9 } }, { tool: 'doc_save', args: { doc: 1, path: out, full: true } }, openDoc(out)], ctx, 'Numbering pages');
  const num = (n) => `${prefix}${String(n).padStart(digits, '0')}${opts.suffix || ''}`;
  return { path: out, note: `${num(start)} to ${num(start + (pages || 1) - 1)}` };
}
async function accessCheck(p, opts, ctx) {
  const report = opts.report ? ctx.out.file(p, `${U.base(p)} - accessibility.html`) : null;
  const [, r] = await pdfScript([openDoc(p, opts.password), report ? { tool: 'accessibility_report', args: { doc: 1, path: report } } : { tool: 'accessibility_check', args: { doc: 1 } }], ctx, 'Checking accessibility');
  const failed = (r?.results || []).filter((x) => x.status === 'failed'), manual = (r?.results || []).filter((x) => x.status === 'manual');
  const text = [...failed.map((x) => `✗ ${x.name}: ${[...new Set(x.findings.map((f) => f.message))].slice(0, 3).join('; ')}`), ...manual.map((x) => `? ${x.name}: check by hand`)].join('\n');
  return { ...(report ? { path: report } : {}), note: failed.length ? `${r.failed} of ${r.passed + r.failed} checks failed, ${r.manual} need a person` : `All ${r?.passed} automatic checks passed, ${r?.manual} need a person`, text };
}
async function linkUrls(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-linked.pdf`);
  try {
    const [, made] = await pdfScript([openDoc(p, opts.password), { tool: 'links_from_urls', args: { doc: 1 } }, { tool: 'doc_save', args: { doc: 1, path: out, full: true } }], ctx, 'Linking web addresses');
    const n = made?.created?.length || 0;
    return { path: out, note: `${plural(n, 'link')} made: ${[...new Set(made.created)].slice(0, 3).join(', ')}${new Set(made.created).size > 3 ? '…' : ''}` };
  } catch (e) {
    await fsp.rm(out, { force: true });
    throw /no unlinked/.test(e.message) ? new Error('There are no web addresses without links in this PDF.') : e;
  }
}
async function splitChapters(p, opts, ctx) {
  const dir = ctx.out.folder(p, `${U.base(p)} - chapters`);
  try {
    const [, r] = await pdfScript([openDoc(p, opts.password), { tool: 'doc_split', args: { doc: 1, bookmarks: true, out_dir: dir } }], ctx, 'Splitting at bookmarks');
    return { path: dir, note: `${plural(r?.files?.length || 0, 'chapter')}` };
  } catch (e) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw /no top-level bookmarks/.test(e.message) ? new Error('This PDF has no bookmarks to split at. Use Split PDF instead.') : e;
  }
}
async function wordCount(p, opts, ctx) {
  const [, r] = await pdfScript([openDoc(p, opts.password), { tool: 'text_word_count', args: { doc: 1 } }], ctx, 'Counting words');
  const t = r?.total || {}, pages = r?.pages || [];
  return { note: `${t.words?.toLocaleString('en-US')} words, ${t.characters?.toLocaleString('en-US')} characters${r?.pages_without_text ? ` (${plural(r.pages_without_text, 'page')} without text: run OCR first)` : ''}`, text: pages.map((pg) => `Page ${pg.page}: ${pg.counts.words} words, ${pg.counts.characters} characters`).join('\n') };
}
async function printCheck(p, opts, ctx) {
  const [, r] = await pdfScript([openDoc(p, opts.password), { tool: 'print_readiness', args: { doc: 1 } }], ctx, 'Checking for print');
  const f = r?.findings || [], bad = f.filter((x) => x.severity === 'fail'), warn = f.filter((x) => x.severity === 'warn' || x.severity === 'warning');
  return { note: bad.length ? `${plural(bad.length, 'problem')}${warn.length ? `, ${plural(warn.length, 'warning')}` : ''}` : warn.length ? `Printable, ${plural(warn.length, 'warning')}` : 'Ready to print', text: f.map((x) => `${x.severity === 'fail' ? '✗' : x.severity === 'info' ? 'i' : '!'} ${x.page ? `Page ${x.page}: ` : ''}${x.message}`).join('\n') };
}
// Header and footer text in six boxes, with PdfCraft's page, date and Bates tokens, as Acrobat adds them (so they can
// be updated or removed later).
const HF_BOXES = ['header_left', 'header_center', 'header_right', 'footer_left', 'footer_center', 'footer_right'];
const tokens = (s) => String(s || '').replace(/\{page\}/gi, '<<1>>').replace(/\{pages\}/gi, '<<n>>').replace(/\{date\}/gi, '<<d/m/yyyy>>');
const pageList = (spec, n) => { const l = U.parseRanges(spec || 'all', n).map((i) => i + 1); return l.length && l.length < n ? { pages: l } : {}; };
async function headerFooterPdf(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-header.pdf`);
  const boxes = Object.fromEntries(HF_BOXES.map((k) => [k, tokens(opts[k])]).filter(([, v]) => v.trim()));
  if (!Object.keys(boxes).length) throw new Error('Type the header or footer text first.');
  const n = await require('./pdf').pageCount(p, opts.password), mm = Number(opts.margin ?? 12) * 2.834645669;
  const [, , , info] = await pdfScript([openDoc(p, opts.password), { tool: 'doc_header_footer', args: { doc: 1, ...boxes, font_size: Number(opts.size) || 10, ...(opts.color ? { color: opts.color } : {}), margins: [mm, mm, Math.max(mm, 36), Math.max(mm, 36)], start_number: Math.max(1, Number(opts.start) || 1), replace: true, ...pageList(opts.pages, n) } },
    { tool: 'doc_save', args: { doc: 1, path: out, full: true } }, openDoc(out)], ctx, 'Adding the header and footer');
  return { path: out, note: `On ${plural(pageList(opts.pages, n).pages?.length || info?.pages || n, 'page')}` };
}
async function backgroundPdf(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-background.pdf`), n = await require('./pdf').pageCount(p, opts.password);
  const fill = opts.kind === 'image' ? (opts.image ? { file: opts.image, scale: U.clamp((Number(opts.scale) || 100) / 100, 0.05, 1) } : null) : { color: opts.color || '#fff4ce' };
  if (!fill) throw new Error('Choose the picture for the background.');
  await pdfScript([openDoc(p, opts.password), { tool: 'doc_background', args: { doc: 1, ...fill, opacity: U.clamp((Number(opts.opacity) || 100) / 100, 0.02, 1), replace: true, ...pageList(opts.pages, n) } }, { tool: 'doc_save', args: { doc: 1, path: out, full: true } }], ctx, 'Adding the background');
  return out;
}
// Title, author, subject, keywords (in the XMP metadata too), language, and how the file opens.
async function pdfProperties(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-properties.pdf`);
  const steps = ['Title', 'Author', 'Subject', 'Keywords'].filter((k) => opts[k.toLowerCase()] != null && opts[k.toLowerCase()] !== '').map((k) => ({ tool: 'doc_set_info', args: { doc: 1, key: k, value: String(opts[k.toLowerCase()]) } }));
  const view = { ...(opts.lang ? { language: String(opts.lang) } : {}), ...(opts.navigation && opts.navigation !== 'keep' ? { navigation: opts.navigation } : {}), ...(opts.showTitle != null ? { display_title: !!opts.showTitle } : {}) };
  if (Object.keys(view).length) steps.push({ tool: 'doc_initial_view', args: { doc: 1, ...view } });
  if (!steps.length) throw new Error('Fill in at least one property.');
  await pdfScript([openDoc(p, opts.password), ...steps, { tool: 'doc_save', args: { doc: 1, path: out, full: true } }], ctx, 'Setting properties');
  return { path: out, note: [opts.title && `“${opts.title}”`, opts.author && `by ${opts.author}`].filter(Boolean).join(' ') || 'Properties set' };
}
// Page labels: a run of pages numbered i, ii, iii or A-1, A-2 in readers' page boxes.
async function pageLabels(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-labelled.pdf`), n = await require('./pdf').pageCount(p, opts.password);
  const from = U.clamp(Number(opts.from) || 1, 1, n), to = U.clamp(Number(opts.to) || n, from, n);
  await pdfScript([openDoc(p, opts.password), { tool: 'page_number', args: { doc: 1, from, to, style: opts.style || 'lower-roman', start: Math.max(1, Number(opts.start) || 1), ...(opts.prefix ? { prefix: String(opts.prefix) } : {}) } },
    ...(to < n && opts.restart !== false ? [{ tool: 'page_number', args: { doc: 1, from: to + 1, to: n, style: 'decimal', start: 1 } }] : []), { tool: 'doc_save', args: { doc: 1, path: out, full: true } }], ctx, 'Labelling pages');
  return { path: out, note: `Pages ${from}–${to} labelled${to < n && opts.restart !== false ? `, then 1 from page ${to + 1}` : ''}` };
}
// Form data out to a file (CSV, XFDF, FDF or XML), and back in from one.
async function exportFormData(p, opts, ctx) {
  const to = ['csv', 'xfdf', 'fdf', 'xml', 'txt'].includes(opts.to) ? opts.to : 'csv', out = ctx.out.file(p, `${U.base(p)} - form data.${to}`);
  const [, list] = await pdfScript([openDoc(p, opts.password), { tool: 'form_fields', args: { doc: 1 } }, { tool: 'doc_export_data', args: { doc: 1, path: out, what: 'fields' } }], ctx, 'Exporting form data');
  if (!list?.count) { await fsp.rm(out, { force: true }); throw new Error('This PDF has no form fields.'); }
  return { path: out, note: `${plural(list.count, 'field')}, ${list.fields.filter((f) => f.value != null && f.value !== '' && f.value !== false).length} filled in` };
}
async function importFormData(p, opts, ctx) {
  if (!opts.data) throw new Error('Choose the data file to fill the form from.');
  const out = ctx.out.file(p, `${U.base(p)}-filled.pdf`);
  const [, , , list] = await pdfScript([openDoc(p, opts.password), { tool: 'doc_import_data', args: { doc: 1, path: opts.data } }, { tool: 'doc_save', args: { doc: 1, path: out, full: true } }, { tool: 'form_fields', args: { doc: 1 } }], ctx, 'Filling in the form');
  const filled = (list?.fields || []).filter((f) => f.value != null && f.value !== '' && f.value !== false).length;
  return { path: out, note: `${plural(filled, 'field')} filled in` };
}
async function commentSummary(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)} - comments.pdf`);
  const [, list] = await pdfScript([openDoc(p, opts.password), { tool: 'comment_list', args: { doc: 1 } }, { tool: 'comments_summarize', args: { doc: 1, out, sort: 'page' } }], ctx, 'Summarising comments');
  const n = list?.count || 0;
  if (!n) { await fsp.rm(out, { force: true }); throw new Error('This PDF has no comments.'); }
  return { path: out, note: plural(n, 'comment') };
}

const cadCmd = (id, params = {}) => ['--cmd', `${id} ${JSON.stringify(params)}`];
const cadResults = (stdout) => jsonLines(stdout).filter((j) => j && typeof j === 'object' && !Array.isArray(j));
const DWG_VERSIONS = [2018, 2013, 2010, 2007, 2004, 2000];
async function cadSaveAs(p, opts, ctx) {
  const to = opts.to === 'dxf' ? 'dxf' : 'dwg', version = DWG_VERSIONS.includes(Number(opts.version)) ? Number(opts.version) : 2018;
  const out = ctx.out.file(p, `${U.base(p)}${U.ext(p) === to ? `-${version}` : ''}.${to}`);
  await run('cadcraft', ['run', p, ...cadCmd('saveas', { path: out, version })], ctx, `Saving ${to.toUpperCase()}`, { timeout: 180000 });
  if (!fs.existsSync(out)) throw new Error('CADCraft finished without writing a file.');
  return { path: out, note: `${to.toUpperCase()} for AutoCAD ${version} and later` };
}
async function cadClean(p, opts, ctx) {
  const to = U.ext(p) === 'dxf' ? 'dxf' : 'dwg', out = ctx.out.file(p, `${U.base(p)}-clean.${to}`);
  const r = await run('cadcraft', ['run', p, ...cadCmd('audit', { fix: true }), ...cadCmd('purge'), ...cadCmd('overkill'), ...cadCmd('saveas', { path: out })], ctx, 'Cleaning up', { timeout: 180000 });
  if (!fs.existsSync(out)) throw new Error('CADCraft finished without writing a file.');
  const [audit = {}, purge = {}, over = {}] = cadResults(r.stdout);
  const unused = Object.values(purge).filter((v) => typeof v === 'number').reduce((n, v) => n + v, 0);
  const bits = [audit.fixed && `fixed ${plural(audit.fixed, 'error')}`, unused && `removed ${unused} unused name${unused === 1 ? '' : 's'}`, (over.deleted || over.overlapping) && `deleted ${plural((over.deleted || 0) + (over.overlapping || 0), 'doubled object')}`].filter(Boolean);
  return { path: out, note: bits.length ? `${bits.join(', ').replace(/^./, (c) => c.toUpperCase())}` : 'Nothing needed cleaning' };
}
async function cadSheets(p, opts, ctx) {
  const dir = await U.tmpDir('cadsheets');
  try {
    const r = await run('cadcraft', ['run', p, ...cadCmd('publish', { path: path.join(dir, 'sheet.pdf') })], ctx, 'Printing sheets', { timeout: 300000 });
    const sheets = (cadResults(r.stdout).find((j) => j.sheets)?.sheets || []).filter((x) => x.path && fs.existsSync(x.path));
    if (!sheets.length) throw new Error('This drawing has no sheets to print.');
    const out = ctx.out.file(p, `${U.base(p)} - sheets.pdf`);
    await require('./pdf').merge(sheets.map((x) => x.path), out, ctx);
    return { path: out, note: `${plural(sheets.length, 'sheet')}: ${sheets.map((x) => x.layout).join(', ')}` };
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function cadCompare([older, newer], opts, ctx) {
  const r = await run('cadcraft', ['run', newer, ...cadCmd('compare', { path: older })], ctx, 'Comparing drawings', { timeout: 180000 });
  const c = cadResults(r.stdout).find((j) => j.counts);
  if (!c) throw new Error('CADCraft couldn’t compare these drawings.');
  const n = c.counts, kinds = (list) => Object.entries(list.reduce((m, x) => ({ ...m, [x.type]: (m[x.type] || 0) + 1 }), {})).map(([k, v]) => `${v} ${k}`).join(', ');
  const text = [`${path.basename(newer)} compared with ${path.basename(older)}`, `Added: ${n.added}${n.added ? ` (${kinds(c.added)})` : ''}`, `Removed: ${n.removed}${n.removed ? ` (${kinds(c.removed)})` : ''}`, `Changed: ${n.changed}${n.changed ? ` (${kinds(c.changed)})` : ''}`, `The same: ${n.common}`].join('\n');
  return { note: n.added || n.removed || n.changed ? `${n.added} added, ${n.removed} removed, ${n.changed} changed` : 'The drawings are the same', text };
}
async function cadBlocks(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)} - blocks.csv`);
  const r = await run('cadcraft', ['run', p, ...cadCmd('dataextraction', { file: out })], ctx, 'Counting blocks', { timeout: 180000 });
  const d = cadResults(r.stdout).find((j) => j.rows);
  if (!d?.rows?.length) { await fsp.rm(out, { force: true }); throw new Error('This drawing has no blocks.'); }
  const total = d.rows.reduce((s, row) => s + (Number(row[0]) || 0), 0);
  return { path: out, note: `${plural(total, 'block')} of ${plural(d.rows.length, 'kind')}` };
}
async function cadLayers(p, opts, ctx) {
  const d = lastJson((await run('cadcraft', ['info', p], ctx, 'Reading', { timeout: 120000 })).stdout);
  if (!d?.layers) throw new Error('CADCraft couldn’t read this drawing.');
  const state = (l) => [!l.on && 'off', l.frozen && 'frozen', l.locked && 'locked'].filter(Boolean).join(', ');
  const [[x0, y0], [x1, y1]] = d.extents || [[0, 0], [0, 0]], r2 = (v) => Math.round(v * 100) / 100;
  const text = [`Size: ${r2(x1 - x0)} × ${r2(y1 - y0)}`, `Layers: ${d.layers.map((l) => `${l.name}${state(l) ? ` (${state(l)})` : ''}`).join(', ')}`, `Blocks: ${d.blocks?.length ? d.blocks.join(', ') : 'none'}`,
    `Sheets: ${d.layouts?.length ? d.layouts.join(', ') : 'none'}`, `Objects: ${Object.entries(d.counts || {}).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`, ...(d.skipped?.count ? [`Not kept by CADCraft: ${d.skipped.count}`] : [])].join('\n');
  return { note: `${plural(d.layers.length, 'layer')}, ${plural(d.blocks?.length || 0, 'block')}, ${plural(d.entityCount || 0, 'object')}`, text };
}

const SOUND_IN = ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg'];
const LOSSLESS = { wav: 'wav', aif: 'aiff', aiff: 'aiff', flac: 'flac' };
const soundExt = (p) => LOSSLESS[U.ext(p)] || (['mp3', 'm4a', 'ogg', 'opus'].includes(U.ext(p)) ? U.ext(p) : 'm4a');
const soundCmd = (id, params) => ['--cmd', `${id}=${JSON.stringify(params)}`];
async function soundSource(p, dir, ctx) {
  if (SOUND_IN.includes(U.ext(p))) return p;
  const wav = path.join(dir, `${U.base(p)}.wav`);
  await require('./media').convertAudio(p, { to: 'wav', depth: '24' }, { ...ctx, progress: () => {}, out: { file: () => wav } });
  return wav;
}
async function soundSession(sources, dir, ctx) {
  const session = path.join(dir, 'mix.scraft');
  const r = await run('soundcraft', ['run', ...sources.flatMap((src) => soundCmd('file.import_audio', { path: src })), '--save', session], ctx, 'Reading the sound', { timeout: 600000 });
  const tracks = String(r.stdout).split(/\r?\n/).filter((l) => l.startsWith('file.import_audio:')).flatMap((l) => JSON.parse(l.slice(l.indexOf('{'))).imported || []).map((x) => x.track);
  if (!fs.existsSync(session) || tracks.length < sources.length) throw new Error('SoundCraft couldn’t read this sound.');
  return { session, tracks };
}
async function soundBounce({ session, tracks }, chain, out, ctx, label) {
  const inserts = tracks.flatMap((track) => chain.flatMap(([plugin, params]) => soundCmd('mix.insert', { track, plugin, params })));
  const r = await run('soundcraft', ['run', '--in', session, ...inserts, ...soundCmd('file.bounce_mix', { path: out, format: LOSSLESS[U.ext(out)] || 'wav', bit_depth: '24' })], ctx, label, { timeout: 600000 });
  const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('file.bounce_mix:'));
  const res = line ? JSON.parse(line.slice(line.indexOf('{'))) : null;
  if (!res || !fs.existsSync(out)) throw new Error('SoundCraft finished without writing a file.');
  return res;
}
async function soundWork(files, chain, suffix, ctx, label, { target } = {}) {
  const p = files[0], dir = await U.tmpDir('sound');
  try {
    const sources = [];
    for (const f of files) sources.push(await soundSource(f, dir, ctx));
    const mix = await soundSession(sources, dir, ctx);
    const to = soundExt(p), out = ctx.out.file(p, `${U.base(p)}${suffix}.${to}`), wav = LOSSLESS[to] ? out : path.join(dir, 'mix.wav');
    let res = await soundBounce(mix, chain, wav, ctx, label), gain = 0;
    for (let i = 0; target != null && i < 3 && Number.isFinite(res.lufs) && Math.abs(target - res.lufs) > 0.5; i++) {
      gain = Math.max(-30, Math.min(30, gain + target - res.lufs));
      res = await soundBounce(mix, [['gain', { gain: Math.round(gain * 10) / 10 }], ...chain], wav, ctx, label);
    }
    if (wav !== out) await require('./media').convertAudio(wav, { to, bitrate: '256k' }, { ...ctx, progress: () => {}, out: { file: () => out } });
    return { path: out, note: `${Math.round(res.lufs * 10) / 10} LUFS, peaks at ${Math.round(res.true_peak_db * 10) / 10} dB` };
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const MASTER = [['dc_offset_removal', {}], ['eq_7band', { hpf_on: 1, hpf_freq: 30 }], ['compressor', { ratio: 2, threshold: -18, attack: 30, release: 200, makeup: 2 }], ['maximizer', { threshold: -3, ceiling: -1, release: 80 }]];
const masterAudio = (p, opts, ctx) => soundWork([p], MASTER, '-mastered', ctx, 'Mastering', { target: Number(opts.loudness) || -14 });
const VOICE = [['eq_7band', { hpf_on: 1, hpf_freq: 80, high_mid_freq: 3500, high_mid_gain: 2 }], ['expander_gate', { threshold: -50, range: 15, ratio: 3 }], ['de_esser', { threshold: -28, freq: 6500 }], ['compressor', { ratio: 3, threshold: -22, attack: 10, release: 120, makeup: 4 }], ['maximizer', { threshold: -2, ceiling: -1 }]];
const polishVoice = (p, opts, ctx) => soundWork([p], VOICE, '-voice', ctx, 'Polishing the voice', { target: -16 });
const SPACES = { room: 'room_reverb', hall: 'plate_reverb' };
const addReverb = (p, opts, ctx) => soundWork([p], [[SPACES[opts.space] || SPACES.room, { mix: Math.max(5, Math.min(60, Number(opts.amount) || 25)) }]], '-reverb', ctx, 'Adding reverb');
const mixTracks = (files, opts, ctx) => soundWork(files, [], ' - mix', ctx, 'Mixing', { target: -14 });
async function sessionBounce(p, opts, ctx) {
  const stems = opts.what === 'stems';
  if (stems) {
    const dir = ctx.out.folder(p, `${U.base(p)} - stems`);
    await run('soundcraft', ['run', '--in', p, ...soundCmd('file.bounce_stems', { dir, format: 'wav', bit_depth: '24' })], ctx, 'Bouncing stems', { timeout: 900000 });
    const n = (await fsp.readdir(dir).catch(() => [])).filter((f) => /\.(wav|aiff|flac)$/i.test(f)).length;
    if (!n) throw new Error('This session has no tracks to bounce.');
    return { path: dir, note: plural(n, 'stem') };
  }
  const out = ctx.out.file(p, `${U.base(p)}.wav`);
  await run('soundcraft', ['run', '--in', p, ...soundCmd('file.bounce_mix', { path: out, format: 'wav', bit_depth: '24' })], ctx, 'Bouncing the mix', { timeout: 900000 });
  if (!fs.existsSync(out)) throw new Error('SoundCraft finished without writing a file.');
  return out;
}

const WORD_SAVE = ['docx', 'odt', 'rtf'];
const wordOut = (p) => (WORD_SAVE.includes(U.ext(p)) ? U.ext(p) : 'docx');
const wordEnv = { WORDCRAFT_REGION: Intl.DateTimeFormat().resolvedOptions().locale || 'en-GB' };
async function wordRun(args, ctx, label) { return run('wordcraft', args, ctx, label, { timeout: 300000, env: wordEnv }); }
async function wordMarkup(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)} - with comments.pdf`);
  await wordRun(['convert', p, out, '--markup'], ctx, 'Laying out comments and changes');
  if (!fs.existsSync(out)) throw new Error('WordCraft finished without writing a file.');
  return out;
}
async function wordContents(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-contents.${wordOut(p)}`);
  await wordRun(['run', '--file', p, '--cmd', 'caret.docStart', '--cmd', `references.toc=${JSON.stringify({ title: opts.title || 'Contents', levels: Number(opts.levels) || 3 })}`, '--save', out], ctx, 'Adding the contents');
  if (!fs.existsSync(out)) throw new Error('WordCraft finished without writing a file.');
  return out;
}
async function wordPassword(p, opts, ctx) {
  if (!opts.password) throw new Error('Type the password to lock the document with.');
  const out = ctx.out.file(p, `${U.base(p)}-locked.docx`);
  await wordRun(['run', '--file', p, '--cmd', `file.encrypt=${JSON.stringify({ password: String(opts.password) })}`, '--save', out], ctx, 'Locking');
  if (!fs.existsSync(out)) throw new Error('WordCraft finished without writing a file.');
  return out;
}
async function wordFields(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-updated.${wordOut(p)}`);
  await wordRun(['convert', p, out, '--update-fields'], ctx, 'Updating fields');
  if (!fs.existsSync(out)) throw new Error('WordCraft finished without writing a file.');
  return out;
}
async function wordUpgrade(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}.docx`);
  await wordRun(['convert', p, out], ctx, 'Saving as DOCX');
  if (!fs.existsSync(out)) throw new Error('WordCraft finished without writing a file.');
  return out;
}
async function wordPages(p, opts, ctx) {
  const info = lastJson((await wordRun(['info', p], ctx, 'Reading')).stdout) || {};
  const n = Math.max(1, Number(info.pages) || 1), dir = ctx.out.folder(p, `${U.base(p)} - pages`), w = String(n).length;
  for (let i = 1; i <= n; i++) {
    ctx.progress?.(i / (n + 1), `Page ${i} of ${n}`);
    await wordRun(['render', p, path.join(dir, `page-${String(i).padStart(w, '0')}.png`), '--page', String(i), '--scale', String(Number(opts.scale) || 2)], { ...ctx, progress: () => {} }, 'Drawing pages');
  }
  return { path: dir, note: plural(n, 'page') };
}

const gridCmd = (id, params = {}) => ['--cmd', `${id}=${JSON.stringify(params)}`];
async function gridRun(p, cmds, out, ctx, label) {
  const r = await run('gridcraft', ['run', '--in', p, ...cmds, '--out', out], ctx, label, { timeout: 300000 });
  if (!fs.existsSync(out)) throw new Error('GridCraft finished without writing a file.');
  return jsonLines(r.stdout);
}
async function gridChart(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-chart.xlsx`), type = ['column', 'bar', 'line', 'pie', 'area', 'scatter'].includes(opts.type) ? { type: opts.type } : {};
  await gridRun(p, [...gridCmd('insert.chart', type), ...gridCmd('chart.set', { title: opts.title || U.base(p), legend: 'bottom' })], out, ctx, 'Drawing the chart');
  return out;
}
async function gridTable(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-table.xlsx`);
  const res = await gridRun(p, gridCmd('home.formatAsTable', { style: opts.style || 'TableStyleMedium2', header: true }), out, ctx, 'Making a table');
  const t = res.find((j) => j.command === 'home.formatAsTable')?.result;
  return { path: out, note: t?.range ? `Table ${t.range}, with filter buttons` : 'Saved' };
}
async function gridRecalc(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}-recalculated.xlsx`);
  const res = await gridRun(p, gridCmd('formulas.calculateNow'), out, ctx, 'Recalculating');
  const n = res.find((j) => j.command === 'formulas.calculateNow')?.result?.cells;
  return { path: out, note: n ? `${plural(n, 'formula')} recalculated` : 'No formulas to recalculate' };
}
async function gridCheck(p, opts, ctx) {
  const r = await run('gridcraft', ['check', p, '--json', '--max-report', '20'], ctx, 'Checking calculations', { timeout: 300000, okCodes: [1] });
  const f = lastJson(r.stdout)?.files?.[0];
  if (!f?.opened) throw new Error(f?.error || 'GridCraft couldn’t open this workbook.');
  const c = f.calc || {}, bad = c.mismatches || [];
  const cell = (m) => `${m.sheet ? `${m.sheet}!` : ''}${m.cell || m.address || ''}: saved ${m.cached ?? m.expected ?? '?'}, now ${m.computed ?? m.actual ?? '?'}`;
  const text = [`Formulas: ${c.formulaCells || 0}`, `Checked: ${c.checked || 0}`, `Match: ${c.matched || 0}`, `Differ: ${c.mismatched || 0}`, ...(c.staleCache ? ['The saved results are out of date: recalculate before sharing.'] : []), ...bad.slice(0, 20).map(cell)].join('\n');
  return { note: !c.formulaCells ? 'No formulas' : c.mismatched ? `${plural(c.mismatched, 'formula')} out of ${c.checked} show an out-of-date result` : `All ${plural(c.checked, 'formula')} add up`, text };
}

const DECK_THEMES = ['DeckCraft', 'Harbor', 'Ember', 'Meadow', 'Nocturne', 'Paper', 'Coral Reef', 'Slate'];
async function deckOutline(p, opts, ctx) {
  const text = (await fsp.readFile(p, 'utf8')).replace(/^﻿/, '');
  if (!text.trim()) throw new Error('This file is empty.');
  const out = ctx.out.file(p, `${U.base(p)}.pptx`), theme = DECK_THEMES.includes(opts.theme) ? opts.theme : 'DeckCraft';
  await run('deckcraft', ['run', '--cmd', `slide.fromOutline=${JSON.stringify({ text, markdown: true })}`, '--cmd', 'slide.delete={"index":0}', '--cmd', `design.theme=${JSON.stringify({ name: theme })}`, '--save', out], ctx, 'Making slides', { timeout: 300000 });
  if (!fs.existsSync(out)) throw new Error('DeckCraft finished without writing a file.');
  return out;
}
async function deckGif(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)}.gif`), seconds = Math.max(0.5, Math.min(60, Number(opts.seconds) || 3));
  await run('deckcraft', ['run', '--in', p, '--export', out, '--export-params', JSON.stringify({ secondsPerSlide: seconds, width: opts.width || 'medium', loop: true })], ctx, 'Making the GIF', { timeout: 600000 });
  if (!fs.existsSync(out)) throw new Error('DeckCraft finished without writing a file.');
  return out;
}
async function deckGraphics(p, opts, ctx) {
  const dir = ctx.out.folder(p, `${U.base(p)} - slide graphics`);
  await run('deckcraft', ['render', p, '--all', '--transparent', '--scale', String(Number(opts.scale) || 2), dir], ctx, 'Drawing slides', { timeout: 600000 });
  const n = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.png')).length;
  if (!n) throw new Error('DeckCraft finished without drawing any slides.');
  return { path: dir, note: plural(n, 'slide') };
}

// ——— SolidCraft (bherbruck/solidcraft): its CLI rebuilds a design's timeline, so Lime reads and writes .solidcraft through it.
const SOLID_IN = ['solidcraft', 'solvecraft'];
const SOLID_OUT = ['step', 'stl', '3mf', 'obj'];
async function solidRun(args, ctx, label) {
  return run('solidcraft', args, ctx, label, { timeout: 600000 });
}
// The design rebuilt and written straight from SolidCraft: exact STEP, or its own meshes.
async function solidExport(p, to, out, ctx) {
  if (!SOLID_OUT.includes(to)) throw new Error(`SolidCraft saves STEP, STL, 3MF or OBJ, not ${to.toUpperCase()}.`);
  await solidRun(['run', '--in', p, '--out', out, '--quiet'], ctx, 'Rebuilding with SolidCraft');
  if (!fs.existsSync(out)) throw new Error('SolidCraft finished without writing a file.');
  return out;
}
// A STEP copy of the design, so the rest of Lime's 3D tools can read it.
async function solidStep(p, ctx) {
  const out = path.join(await U.tmpDir('solid'), `${U.base(p)}.step`);
  return solidExport(p, 'step', out, ctx);
}
const solidJson = async (p, script, ctx, label) => {
  const dir = await U.tmpDir('solid'), sc = path.join(dir, 'script.json'), res = path.join(dir, 'results.json');
  await fsp.writeFile(sc, JSON.stringify({ commands: script }));
  await solidRun(['run', sc, '--in', p, '--results', '--json-out', res, '--quiet'], ctx, label);
  try { return JSON.parse(await fsp.readFile(res, 'utf8')); } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
};
async function solidParamList(p, ctx) {
  const r = await solidJson(p, [{ command: 'parameters.list', params: { filter: 'user' } }], ctx, 'Reading parameters');
  return (Array.isArray(r) ? r : r?.results || []).flatMap((x) => x?.parameters || []);
}
async function solidParams(p, opts, ctx) {
  const list = await solidParamList(p, ctx);
  if (!list.length) return { note: 'This design has no parameters', text: 'This design has no user parameters. Add them in SolidCraft (Modify ▸ Parameters).' };
  const text = list.map((q) => `${q.name} = ${q.expression}${q.unit && !/[a-z°]\s*$/i.test(q.expression) ? ` ${q.unit}` : ''}${q.comment ? `   (${q.comment})` : ''}${q.error ? `   ⚠ ${q.error}` : ''}`).join('\n');
  if (opts.save) {
    const out = ctx.out.file(p, `${U.base(p)} - parameters.csv`);
    const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
    await fsp.writeFile(out, ['name,expression,unit,value,comment', ...list.map((q) => [q.name, q.expression, q.unit, q.value, q.comment].map(cell).join(','))].join('\n'));
    return { path: out, note: plural(list.length, 'parameter'), text };
  }
  return { note: plural(list.length, 'parameter'), text };
}
// "width = 90 mm, thickness = 8" (one per line, or separated by commas or semicolons).
function parseParams(spec) {
  const out = [];
  for (const part of String(spec || '').split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z_][\w]*)\s*[=:]\s*(.+)$/.exec(part);
    if (!m) throw new Error(`“${part}” isn’t a parameter change. Write it as name = value, like width = 90 mm.`);
    out.push({ name: m[1], expression: m[2].trim() });
  }
  if (!out.length) throw new Error('Type at least one change, like width = 90 mm.');
  return out;
}
async function solidSetParams(p, opts, ctx) {
  const changes = parseParams(opts.params);
  const have = new Set((await solidParamList(p, ctx)).map((q) => q.name));
  const missing = changes.filter((c) => !have.has(c.name)).map((c) => c.name);
  if (missing.length) throw new Error(`This design has no parameter called ${missing.join(', ')}${have.size ? `. It has ${[...have].join(', ')}` : ''}.`);
  const to = opts.to || 'solidcraft';
  const dir = await U.tmpDir('solid'), sc = path.join(dir, 'script.json');
  await fsp.writeFile(sc, JSON.stringify({ commands: changes.map((c) => ({ command: 'parameters.change', params: c })) }));
  const out = ctx.out.file(p, `${U.base(p)}-changed.${to}`);
  try {
    await solidRun(['run', sc, '--in', p, to === 'solidcraft' ? '--save' : '--out', out, '--quiet'], ctx, 'Rebuilding with the new values');
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
  if (!fs.existsSync(out)) throw new Error('SolidCraft finished without writing a file.');
  return { path: out, note: changes.map((c) => `${c.name} = ${c.expression}`).join(', ') };
}

// ——— Blender, headless (blender -b): reads and writes the 3D formats Lime's own code doesn't, and renders.
const BLEND_IN = ['blend', 'usd', 'usda', 'usdc', 'usdz', 'abc']; // Lime reads these only through Blender
const BLEND_READS = [...BLEND_IN, 'glb', 'gltf', 'fbx', 'obj', 'stl', 'ply'];
const BLEND_OUT = ['fbx', 'usdz', 'usd', 'usdc', 'usda', 'abc', 'blend']; // and writes these only through Blender
const BLEND_WRITES = [...BLEND_OUT, 'glb', 'gltf', 'obj', 'stl', 'ply'];
const installedBlender = () => {
  const a = installedApp('blender');
  return a && (a.endsWith('.app') ? path.join(a, 'Contents', 'MacOS', 'Blender') : a);
};
async function blenderExe() {
  if (process.env.LIME_BLENDER && fs.existsSync(process.env.LIME_BLENDER)) return process.env.LIME_BLENDER;
  const m = bundledApps().blender;
  if (m?.cli && fs.existsSync(appSource('blender'))) { await bundledApp('blender'); return path.join(appDir('blender'), m.cli); }
  const own = installedBlender();
  if (own && fs.existsSync(own)) return own;
  throw Object.assign(new Error('Blender isn’t in this build of Lime.'), { code: 'ENGINE_MISSING' });
}
async function blender(job, ctx, label, { timeout = 900000, frames } = {}) {
  let limit;
  const late = new Promise((_, rej) => { limit = setTimeout(() => rej(Object.assign(new Error('Blender couldn’t finish (it stopped responding)'), { code: 'TIMEOUT' })), timeout); });
  const exe = await Promise.race([blenderExe(), late]).finally(() => clearTimeout(limit));
  ctx?.progress?.(0.1, label);
  let tick = 0.1, said = null;
  const t = frames ? null : setInterval(() => { tick = Math.min(0.92, tick + (0.95 - tick) * 0.05); ctx?.progress?.(tick, label); }, 500);
  const onStdout = (s) => {
    for (const line of s.split(/\r?\n/)) {
      if (!line.startsWith('LIME ')) continue;
      const j = (() => { try { return JSON.parse(line.slice(5)); } catch (_) { return null; } })();
      if (j?.error) said = j.error;
      if (j?.frame && frames) ctx?.progress?.(0.05 + 0.85 * (j.frame / j.of), `${label} · frame ${j.frame} of ${j.of}`);
    }
  };
  const args = ['-b', '--factory-startup', '--python-exit-code', '1', '--python', path.join(__dirname, 'blender.py'), '--', JSON.stringify(job)];
  try {
    return await U.run(exe, args, { signal: ctx?.signal, cwd: os.tmpdir(), timeout, onStdout, errorMessage: 'Blender couldn’t finish', env: { BLENDER_USER_RESOURCES: path.join(U.cfg.user || os.tmpdir(), 'blender-user') } });
  } catch (e) {
    if (said) e.message = `Blender couldn’t finish (${said})`;
    throw e;
  } finally { clearInterval(t); }
}
// The Blender-made OBJ brings its .mtl along.
const withMtl = (out) => { const mtl = out.replace(/\.obj$/i, '.mtl'); return /\.obj$/i.test(out) && fs.existsSync(mtl) ? { path: out, paths: [out, mtl] } : out; };
async function blenderConvert(p, to, out, ctx) {
  if (!BLEND_READS.includes(U.ext(p))) throw new Error(`Blender can’t read ${U.ext(p).toUpperCase()} models.`);
  if (!BLEND_WRITES.includes(to)) throw new Error(`Blender can’t save ${to.toUpperCase()} models.`);
  await blender({ op: 'convert', in: p, out }, ctx, `Converting with Blender`);
  if (!fs.existsSync(out)) throw new Error('Blender finished without writing a file.');
  return withMtl(out);
}
// A GLB copy of a file only Blender reads, so the rest of Lime's 3D tools can work on it.
async function blenderGlb(p, ctx) {
  const out = path.join(await U.tmpDir('blend'), `${U.base(p)}.glb`);
  await blenderConvert(p, 'glb', out, ctx);
  return out;
}
// A model Blender can't read itself (STEP, 3MF, a SolidCraft design…) goes in as a GLB that Lime makes first.
async function forBlender(p, ctx, fn) {
  if (BLEND_READS.includes(U.ext(p))) return fn(p);
  const tmp = path.join(await U.tmpDir('blend'), `${U.base(p)}.glb`);
  try {
    await require('./cad').convert(p, { to: 'glb' }, { ...ctx, progress: (f) => ctx?.progress?.(f * 0.1, 'Reading the model'), out: { ...ctx?.out, file: () => tmp } });
    return await fn(tmp);
  } finally { fsp.rm(path.dirname(tmp), { recursive: true, force: true }).catch(() => {}); }
}
const RENDER_SIZE = { small: [1024, 768], medium: [1600, 1200], large: [2560, 1920], square: [1600, 1600], wide: [1920, 1080] };
const renderJob = (opts) => {
  const [width, height] = RENDER_SIZE[opts.size] || RENDER_SIZE.medium;
  const samples = { draft: 24, good: 96, best: 256 }[opts.quality] || Number(opts.samples) || 96;
  return { width: Number(opts.width) || width, height: Number(opts.height) || height, samples, engine: opts.engine === 'eevee' ? 'eevee' : 'cycles', background: opts.background || 'studio', ownCamera: opts.ownCamera !== false, ownLights: opts.ownLights !== false };
};
// Eevee needs a graphics card; without a usable one Blender crashes, so the render is made again with Cycles on the processor.
const eeveeOr = async (job, fn) => {
  try { return await fn(job); } catch (e) { if (job.engine !== 'eevee' || e.code === 'TIMEOUT' || e.name === 'AbortError') throw e; return fn({ ...job, engine: 'cycles' }); }
};
async function studioRender(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)} - render.png`);
  await forBlender(p, ctx, (src) => eeveeOr(renderJob(opts), (job) => blender({ op: 'render', in: src, out, ...job }, ctx, 'Rendering with Blender')));
  if (!fs.existsSync(out)) throw new Error('Blender finished without writing a picture.');
  return out;
}
async function turntable(p, opts, ctx) {
  const to = opts.to === 'gif' ? 'gif' : 'mp4';
  const secs = Math.max(1, Math.min(20, Number(opts.seconds) || 4)), fps = to === 'gif' ? 20 : 30, frames = Math.round(secs * fps);
  const job = { ...renderJob({ size: 'small', quality: 'draft', ...opts }), op: 'turntable', frames };
  if (!opts.size && !opts.width) [job.width, job.height] = to === 'gif' ? [600, 600] : [1280, 720];
  const dir = await U.tmpDir('turntable');
  try {
    await forBlender(p, ctx, (src) => eeveeOr(job, (j) => blender({ ...j, in: src, out: dir }, ctx, 'Rendering the turntable', { frames: true, timeout: 3600000 })));
    const out = ctx.out.file(p, `${U.base(p)} - turntable.${to}`);
    const input = ['-framerate', String(fps), '-i', path.join(dir, 'frame-%04d.png')];
    const args = to === 'gif' ? [...input, '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', out]
      : [...input, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];
    await require('./media').ffmpeg(args, { ...ctx, progress: (f, l) => ctx.progress?.(0.9 + 0.1 * f, l) }, secs, 'Encoding', out);
    return out;
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

function installedApp(id) {
  const name = APPS[id]?.name;
  if (!name || APPS[id].builtin) return null;
  if (U.cfg[id] && fs.existsSync(U.cfg[id])) return U.cfg[id];
  if (APPS[id].bundledOnly) return null;
  if (id === 'blender') {
    // Blender installs into a folder named after its version (Blender Foundation\Blender 5.2) on Windows.
    const win = () => [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean).map((b) => path.join(b, 'Blender Foundation'))
      .flatMap((d) => { try { return fs.readdirSync(d).filter((n) => /^Blender/i.test(n)).sort().reverse().map((n) => path.join(d, n, 'blender.exe')); } catch (_) { return []; } });
    const c = process.platform === 'darwin' ? ['/Applications/Blender.app', path.join(os.homedir(), 'Applications', 'Blender.app')] : U.isWin ? win() : ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender'];
    return c.find((x) => fs.existsSync(x)) || null;
  }
  const cands = process.platform === 'darwin'
    ? [`/Applications/${name}.app`, path.join(os.homedir(), 'Applications', `${name}.app`)]
    : U.isWin ? [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean).map((b) => path.join(b, name, `${id}.exe`)) : [`/usr/bin/${id}`, `/usr/local/bin/${id}`];
  return cands.find((c) => fs.existsSync(c)) || null;
}
const PREF = { psd: 'photocraft', psb: 'photocraft', pcraft: 'photocraft', svg: 'vectorcraft', ai: 'vectorcraft', eps: 'vectorcraft', afdesign: 'vectorcraft', pdf: 'pdfcraft', idml: 'designcraft', indd: 'designcraft', ecproj: 'effectcraft', lottie: 'effectcraft', fcproj: 'filmcraft', otio: 'filmcraft', fcpxml: 'filmcraft',
  dwg: 'cadcraft', dxf: 'cadcraft', scraft: 'soundcraft', md: 'wordcraft', markdown: 'wordcraft', deckcraft: 'deckcraft', html: 'webcraft', htm: 'webcraft', xhtml: 'webcraft', css: 'webcraft', js: 'webcraft', mjs: 'webcraft',
  py: 'python', pyw: 'python', pyi: 'python', ipynb: 'python' };
// Code is first for the source files no other app here takes (TypeScript, JSON, shell scripts, C, Go…), and offered after the
// usual app for documents Lime already sends elsewhere (a page goes to WebCraft first, a CSV to GridCraft).
for (const e of APPS.code.opens) if (!(e in PREF)) PREF[e] = 'code';
const BY_GROUP = { image: 'photocraft', raw: 'lightcraft', vector: 'vectorcraft', cad2d: 'cadcraft', layout: 'designcraft', motion: 'effectcraft', timeline: 'filmcraft', video: 'filmcraft', pdf: 'pdfcraft',
  audio: 'soundcraft', doc: 'wordcraft', sheet: 'gridcraft', slides: 'deckcraft', gis: 'maps', hydro: 'hydro', project: 'projectlibre' };
let bundled = null;
const bundledApps = () => { if (!bundled) { try { bundled = JSON.parse(fs.readFileSync(path.join(U.cfg.apps, 'manifest.json'), 'utf8')); } catch (_) { bundled = {}; } } return bundled; };
const appSource = (id) => path.join(U.cfg.apps, `${id}.tar.br`);
const appDir = (id) => path.join(U.cfg.user, 'apps', `${id}-${bundledApps()[id].version}`);
// Whether the full app can be opened: installed on this computer, or shipped inside Lime.
// A Java app (ProjectLibre) also needs the shared Java runtime that ships beside it.
const shipped = (id) => !!bundledApps()[id] && fs.existsSync(appSource(id)) && (!bundledApps()[id].java || (!!bundledApps().java && fs.existsSync(appSource('java'))));
const hasApp = (id) => !!APPS[id] && !APPS[id].builtin && (!!installedApp(id) || shipped(id)) && (APPS[id].needs || []).every(hasApp);
// Whether this build can run the app's headless tools: its CLI engine (or Blender itself) is here.
function hasEngine(id) {
  if (id === 'blender') return !!(process.env.LIME_BLENDER && fs.existsSync(process.env.LIME_BLENDER)) || (!!bundledApps().blender?.cli && fs.existsSync(appSource('blender'))) || !!installedBlender();
  return fs.existsSync(path.join(U.cfg.crafts, exe(id))) || fs.existsSync(path.join(U.cfg.crafts, `${exe(id)}.br`)) || (!!bundledApps()[id]?.cli && fs.existsSync(appSource(id)));
}
// Checked often (every wheel), so the answers are kept for a few seconds.
let cacheAt = 0, cache = {};
const cached = (key, fn) => { if (Date.now() - cacheAt > 5000) { cacheAt = Date.now(); cache = {}; } return (cache[key] ??= fn()); };
// An optional app that this build has nothing of (no engine, no app, no in-window version) is left off the wheel.
const usable = (id) => !!APPS[id] && (!APPS[id].optional || cached(`u:${id}`, () => hasEngine(id) || hasApp(id) || hasWeb(id)));
const engineHere = (id) => cached(`e:${id}`, () => hasEngine(id));
// Files Lime reads only through one of the optional apps, and whether that app's engine is in this build.
const READ_VIA = { ...Object.fromEntries(SOLID_IN.map((e) => [e, 'solidcraft'])), ...Object.fromEntries(BLEND_IN.map((e) => [e, 'blender'])) };
const readable = (f) => { const id = READ_VIA[U.ext(f)]; return !id || engineHere(id); };
const opens = (id, f) => !APPS[id].except?.includes(U.ext(f)) && (APPS[id].opens.includes(U.ext(f)) || APPS[id].opens.includes(U.groupOf(f)) || !!SNIFF[id]?.(f));
// The apps that open every one of these files, the likeliest first.
function appsFor(files) {
  if (!files.length) return [];
  // A GeoTIFF, SWMM results or MS Project XML belong to the engineering apps, whatever their extension suggests.
  const pref = PREF[U.ext(files[0])], byGroup = BY_GROUP[require('../engtools').groupOf(files[0], U.ext(files[0])) || U.groupOf(files[0])];
  // A file whose contents make it something else (a Lottie .json, a video .ts) goes to that app before Code.
  const first = pref === 'code' && byGroup ? byGroup : pref || byGroup;
  const ids = Object.keys(APPS).filter((id) => usable(id) && files.every((f) => opens(id, f)));
  return first && ids.includes(first) ? [first, ...ids.filter((id) => id !== first)] : ids;
}
function appFor(file) {
  const id = appsFor([file])[0];
  return id && hasApp(id) ? { id, ...APPS[id] } : null;
}
const unpackingApps = new Map();
// Older versions go once a new one is in place. Another process (each tool worker is one) may be unpacking into its own
// .part- folder right now, so a .part- folder is only removed once it is an hour old: a leftover from a run that stopped.
async function sweepOld(root, id, keep) {
  for (const d of await fsp.readdir(root).catch(() => [])) {
    if (!d.startsWith(`${id}-`) || d === path.basename(keep)) continue;
    const p = path.join(root, d);
    if (d.includes('.part-')) { const st = await fsp.stat(p).catch(() => null); if (!st || Date.now() - st.mtimeMs < 3600e3) continue; }
    fsp.rm(p, { recursive: true, force: true }).catch(() => {});
  }
}
// Windows antivirus holds a freshly written program for a moment, and a running copy can't be replaced: wait and retry.
const settle = async (fn) => {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= 12 || !['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(e.code)) throw e; await new Promise((r) => setTimeout(r, 250 * (i + 1))); }
  }
};
async function untar(src, dest) {
  const tarExe = U.isWin ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar';
  await new Promise((ok, no) => {
    const tar = spawn(tarExe, ['-xf', '-', '-C', dest], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    tar.stderr.on('data', (d) => { err += d; });
    tar.on('error', (e) => no(e.code === 'ENOENT' ? new Error('tar.exe is missing: Windows 10 (1803) or later is needed') : e));
    // tar's exit code is the verdict: tar may stop reading at the archive's end marker, before the padding after it, and the
    // pipeline then reports its stdin closed early although every file is out (as in helpers.js).
    let broken = null;
    tar.on('close', (c) => (c === 0 ? ok() : no(new Error(err.trim() || broken?.message || `tar exited with ${c}`))));
    pipeline(fs.createReadStream(src), zlib.createBrotliDecompress({ params: { [zlib.constants.BROTLI_DECODER_PARAM_LARGE_WINDOW]: 1 } }), tar.stdin).catch((e) => { broken = e; });
  });
}
async function bundledApp(id) {
  const m = bundledApps()[id];
  if (!m || !fs.existsSync(appSource(id))) return null;
  const root = path.join(U.cfg.user, 'apps'), dir = appDir(id), target = path.join(dir, m.file);
  if (fs.existsSync(target)) return target;
  if (!unpackingApps.has(id)) {
    unpackingApps.set(id, (async () => {
      // Each unpack has a folder of its own, so two at once (or a leftover from one that stopped) never collide.
      // Tool workers are threads of one process, so the thread and a random part make the folder name unique.
      const part = `${dir}.part-${process.pid}-${require('worker_threads').threadId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await fsp.mkdir(part, { recursive: true });
      await untar(appSource(id), part);
      if (!U.isWin) await new Promise((r) => { const x = spawn('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', part], { stdio: 'ignore' }); x.on('error', r); x.on('close', r); });
      if (fs.existsSync(target)) { fsp.rm(part, { recursive: true, force: true }).catch(() => {}); return target; }
      // Another Lime process can finish the same unpack meanwhile; its result is as good as ours.
      try {
        await settle(async () => { if (fs.existsSync(target)) return; await fsp.rm(dir, { recursive: true, force: true }); await fsp.rename(part, dir); });
      } catch (e) { if (!fs.existsSync(target)) throw e; }
      if (fs.existsSync(part)) fsp.rm(part, { recursive: true, force: true }).catch(() => {});
      await sweepOld(root, id, dir);
      return target;
    })().catch((e) => { throw new Error(`${APPS[id]?.name || (id === 'java' ? 'Java' : id)} couldn’t be unpacked (${e.code || e.message}). Check there is free space, then try again.`); }).finally(() => unpackingApps.delete(id)));
  }
  return unpackingApps.get(id);
}
// A launch that dies at once (blocked, quarantined, a missing runtime) says so instead of silently doing nothing.
const start = (cmd, args, opts) => new Promise((done) => {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts });
  child.on('error', (e) => done(e.code || e.message));
  child.on('exit', (code, sig) => done(code || sig ? `exited with ${sig || code}` : null));
  setTimeout(() => { done(null); child.unref(); }, 800);
});
async function launch(app, files, name) {
  let why = process.platform === 'darwin' && /\.app$/i.test(app) ? await start('open', ['-a', app, ...files]) : await start(app, files, { cwd: path.dirname(app) });
  if (why && U.isWin) { try { why = (await require('electron').shell.openPath(app)) || null; } catch (_) {} }
  if (why) throw new Error(`${name} didn’t start (${why}).`);
}
const IMPORT = { glb: 'import_scene.gltf', gltf: 'import_scene.gltf', fbx: 'import_scene.fbx', obj: 'wm.obj_import', stl: 'wm.stl_import', ply: 'wm.ply_import', usd: 'wm.usd_import', usda: 'wm.usd_import', usdc: 'wm.usd_import', usdz: 'wm.usd_import', abc: 'wm.alembic_import' };
function blenderArgs(files) {
  const blend = files.find((f) => U.ext(f) === 'blend');
  if (blend) return [blend];
  const models = files.filter((f) => IMPORT[U.ext(f)]);
  if (!models.length) return [];
  // The default cube goes, then each model comes in; the paths travel as JSON so any name is safe.
  const expr = `import bpy, json\nfor o in [o for o in bpy.data.objects if o.name in ('Cube',)]: bpy.data.objects.remove(o)\nfor op, p in json.loads(${JSON.stringify(JSON.stringify(models.map((f) => [IMPORT[U.ext(f)], f])))}):\n    m, n = op.split('.'); getattr(getattr(bpy.ops, m), n)(filepath=p)`;
  return ['--python-expr', expr];
}
async function openApp(id, files = []) {
  if (!APPS[id]) throw new Error('Unknown app.');
  if (APPS[id].bundledOnly && !installedApp(id)) return require('./coding').open(id, files);
  const own = installedApp(id);
  if (!own && bundledApps()[id]?.java && shipped(id)) {
    // A Java app runs on the runtime Lime ships with it, in its own folder so it finds its libraries.
    const [jre, jar] = await Promise.all([bundledApp('java'), bundledApp(id)]);
    const mac = process.platform === 'darwin' ? [`-Xdock:name=${APPS[id].name}`, '-Dapple.awt.application.name=' + APPS[id].name] : [];
    const why = await start(jre, [...mac, '-Xmx1g', '-jar', jar, ...files], { cwd: path.dirname(jar) });
    if (why) throw new Error(`${APPS[id].name} didn’t start (${why}).`);
    return jar;
  }
  const app = own || (await bundledApp(id));
  if (!app) throw new Error(`${APPS[id].name} isn’t included in this build of Lime.`);
  if (id === 'blender') {
    // Blender opens .blend files itself; any other model is imported into a new scene as it starts.
    const bin = app.endsWith('.app') ? path.join(app, 'Contents', 'MacOS', 'Blender') : app;
    const why = await start(bin, blenderArgs(files), { cwd: path.dirname(bin) });
    if (why) throw new Error(`${APPS[id].name} didn’t start (${why}).`);
  } else await launch(app, files, APPS[id].name);
  return app;
}
// SolidCraft's web build takes a file dropped on its canvas, as WordCraft's does.
const WEB = { cadcraft: { bridge: true }, gridcraft: { bridge: true }, wordcraft: {}, soundcraft: { empty: true }, deckcraft: { empty: 'blank' }, solidcraft: {} };
let webs = null;
const webManifest = () => { if (!webs) { try { webs = JSON.parse(fs.readFileSync(path.join(U.cfg.web, 'manifest.json'), 'utf8')); } catch (_) { webs = {}; } } return webs; };
const webSource = (id) => path.join(U.cfg.web || '', `${id}.tar.br`);
const hasWeb = (id) => !!WEB[id] && !!webManifest()[id] && fs.existsSync(webSource(id));
const unpackingWeb = new Map();
async function webApp(id) {
  if (!hasWeb(id)) return null;
  const root = path.join(U.cfg.user, 'web'), dir = path.join(root, `${id}-${webManifest()[id].version}`), site = path.join(dir, 'site');
  if (fs.existsSync(path.join(site, 'index.html'))) return site;
  if (!unpackingWeb.has(id)) {
    unpackingWeb.set(id, (async () => {
      const part = `${dir}.part-${process.pid}-${require('worker_threads').threadId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await fsp.mkdir(part, { recursive: true });
      await untar(webSource(id), part);
      if (fs.existsSync(path.join(site, 'index.html'))) { fsp.rm(part, { recursive: true, force: true }).catch(() => {}); return site; }
      const done = () => fs.existsSync(path.join(site, 'index.html'));
      try {
        await settle(async () => { if (done()) return; await fsp.rm(dir, { recursive: true, force: true }); await fsp.rename(part, dir); });
      } catch (e) { if (!done()) throw e; }
      if (fs.existsSync(part)) fsp.rm(part, { recursive: true, force: true }).catch(() => {});
      await sweepOld(root, id, dir);
      return site;
    })().catch((e) => { throw new Error(`${APPS[id].name} couldn’t be unpacked (${e.code || e.message}). Check there is free space, then try again.`); }).finally(() => unpackingWeb.delete(id)));
  }
  return unpackingWeb.get(id);
}
const versions = () => { try { return JSON.parse(fs.readFileSync(path.join(U.cfg.crafts, 'manifest.json'), 'utf8')); } catch (_) { return {}; } };
function status() {
  const manifest = versions(), apps = bundledApps();
  return Object.entries(APPS).filter(([, a]) => !a.builtin).map(([id, a]) => ({ id, ...a, version: manifest[id] || apps[id]?.version?.split('+')[0] || null,
    bundled: a.bundledOnly ? shipped(id) && (a.needs || []).every(shipped) : hasEngine(id),
    web: hasWeb(id), app: hasApp(id), artcraft: !a.bundledOnly }));
}

module.exports = { hasEngine, usable, engineHere, readable, SOLID_IN, SOLID_OUT, solidExport, solidStep, solidParams, solidSetParams, parseParams, BLEND_IN, BLEND_READS, BLEND_OUT, BLEND_WRITES, blenderExe, blenderArgs, blenderConvert, blenderGlb, studioRender, turntable, APPS, BUCKETS, CODE_OPEN, bundledApps, appDir, EXTERNAL, SNIFF, findExternal, hasExternal, openExternal, bundledManifest, cli, photo, render, develop, merge, vector, layout, motion, timeline, optimizePdf, auditPdf, pdfInfo, pdfScript, toPdfA, comparePdf, makeFillable, enhanceScan, appFor, appsFor, hasApp, openApp, bundledApp, status,
  autoTone, sharpenPhoto, denoisePhoto, liftShadows, paintPhoto, straightenScans, exportLayers, layerInfo, lookPhoto, smartBw, straightenPhoto, removeDust, hdrBatch,
  traceImage, outlineText, exportArtboards, logoPackage, vectorInfo, preflightLayout, packageLayout, layoutPdf, fixedEpub, bookletPdf, posterFrame, alphaRender, frameSequence, motionInfo,
  splitScenes, mediaInfo, videoLook, cleanVoice, editReady, sanitizePdf, batesPdf, accessCheck, linkUrls, splitChapters, wordCount, printCheck, commentSummary, LIGHT_PRESETS, VIDEO_LOOKS,
  headerFooterPdf, backgroundPdf, pdfProperties, pageLabels, exportFormData, importFormData, WEB, hasWeb, webApp, DECK_THEMES,
  cadSaveAs, cadClean, cadSheets, cadCompare, cadBlocks, cadLayers, masterAudio, polishVoice, addReverb, mixTracks, sessionBounce, soundExt,
  wordMarkup, wordContents, wordPassword, wordFields, wordUpgrade, wordPages, gridChart, gridTable, gridRecalc, gridCheck, deckOutline, deckGif, deckGraphics };
