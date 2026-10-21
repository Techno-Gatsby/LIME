'use strict';
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const U = require('./util');
const { fs, fsp, path, os } = U;

// `opens` is what each app is offered for on the wheel: file groups (see util.GROUPS) or extensions.
const APPS = {
  photocraft: { name: 'PhotoCraft', role: 'Image editing', short: 'Photos', opens: ['image', 'raw'], except: ['svg', 'svgz', 'ico', 'cur', 'icns'] },
  lightcraft: { name: 'LightCraft', role: 'RAW development', short: 'RAW', opens: ['raw', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic', 'heif', 'webp', 'avif', 'jxl'] },
  vectorcraft: { name: 'VectorCraft', role: 'Vector art', short: 'Vector', opens: ['vector', 'svg', 'pdf', 'eps', 'ai', 'emf', 'wmf', 'dxf', 'afdesign'] },
  designcraft: { name: 'DesignCraft', role: 'Page layout', short: 'Layout', opens: ['layout', 'idml', 'indd'] },
  effectcraft: { name: 'EffectCraft', role: 'Motion graphics', short: 'Motion', opens: ['motion', 'lottie', 'ecproj'] },
  filmcraft: { name: 'FilmCraft', role: 'Video editing', short: 'Video', opens: ['video', 'timeline', 'fcproj', 'otio', 'fcpxml'] },
  pdfcraft: { name: 'PdfCraft', role: 'PDF workbench', short: 'PDF', opens: ['pdf'] },
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
    return await U.run(bin, args, { signal: ctx?.signal, cwd: opts.cwd || os.tmpdir(), okCodes: opts.okCodes, timeout: opts.timeout, errorMessage: `${APPS[id].name} couldn’t finish`, env: { NO_COLOR: '1' } });
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
async function commentSummary(p, opts, ctx) {
  const out = ctx.out.file(p, `${U.base(p)} - comments.pdf`);
  const [, list] = await pdfScript([openDoc(p, opts.password), { tool: 'comment_list', args: { doc: 1 } }, { tool: 'comments_summarize', args: { doc: 1, out, sort: 'page' } }], ctx, 'Summarising comments');
  const n = list?.count || 0;
  if (!n) { await fsp.rm(out, { force: true }); throw new Error('This PDF has no comments.'); }
  return { path: out, note: plural(n, 'comment') };
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
let bundled = null;
const bundledApps = () => { if (!bundled) { try { bundled = JSON.parse(fs.readFileSync(path.join(U.cfg.apps, 'manifest.json'), 'utf8')); } catch (_) { bundled = {}; } } return bundled; };
const appSource = (id) => path.join(U.cfg.apps, U.isWin ? `${id}.exe.br` : `${id}.app.tar.br`);
// Whether the full app can be opened: installed on this computer, or shipped inside Lime.
const hasApp = (id) => !!APPS[id] && (!!installedApp(id) || (!!bundledApps()[id] && fs.existsSync(appSource(id))));
const opens = (id, f) => !APPS[id].except?.includes(U.ext(f)) && (APPS[id].opens.includes(U.ext(f)) || APPS[id].opens.includes(U.groupOf(f)));
// The apps that open every one of these files, the likeliest first.
function appsFor(files) {
  if (!files.length) return [];
  const first = PREF[U.ext(files[0])] || BY_GROUP[U.groupOf(files[0])];
  const ids = Object.keys(APPS).filter((id) => files.every((f) => opens(id, f)));
  return first && ids.includes(first) ? [first, ...ids.filter((id) => id !== first)] : ids;
}
function appFor(file) {
  const id = appsFor([file])[0];
  return id && hasApp(id) ? { id, ...APPS[id] } : null;
}
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

module.exports = { APPS, cli, photo, render, develop, merge, vector, layout, motion, timeline, optimizePdf, auditPdf, pdfInfo, pdfScript, toPdfA, comparePdf, makeFillable, enhanceScan, appFor, appsFor, hasApp, openApp, bundledApp, status,
  autoTone, sharpenPhoto, denoisePhoto, liftShadows, paintPhoto, straightenScans, exportLayers, layerInfo, lookPhoto, smartBw, straightenPhoto, removeDust, hdrBatch,
  traceImage, outlineText, exportArtboards, logoPackage, vectorInfo, preflightLayout, packageLayout, layoutPdf, fixedEpub, bookletPdf, posterFrame, alphaRender, frameSequence, motionInfo,
  splitScenes, mediaInfo, videoLook, cleanVoice, editReady, sanitizePdf, batesPdf, accessCheck, linkUrls, splitChapters, wordCount, printCheck, commentSummary, LIGHT_PRESETS, VIDEO_LOOKS };
