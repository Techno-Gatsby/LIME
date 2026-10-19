'use strict';
// Archives through the full 7-Zip (7z.exe + 7z.dll on Windows): reads ZIP, RAR/RAR5, 7z, TAR, GZ, BZ2, XZ, ZST, ISO, CAB, WIM, DMG, MSI…
const U = require('./util');
const { fs, fsp, path } = U;

const seven = () => U.binPath('7z');
function progressParser(ctx, label) {
  return (s) => { const m = s.match(/(\d{1,3})%/g); if (m) ctx?.progress(Number(m[m.length - 1].slice(0, -1)) / 100, label); };
}
function friendly(err) {
  const msg = err.message || '';
  if (/Wrong password|Cannot open encrypted|Data Error in encrypted/i.test(msg)) return new Error('This archive is password-protected. Enter its password in the options and try again.');
  if (/Can not open the file as archive|Is not archive/i.test(msg)) return new Error('This file isn’t an archive 7-Zip can open, or it’s damaged.');
  if (/Unexpected end of archive/i.test(msg)) return new Error('This archive is incomplete. If it’s part of a multi-volume set, keep all parts in the same folder.');
  return err;
}

async function list(p, password) {
  const args = ['l', '-slt', '-ba', p, `-p${password || ''}`];
  try {
    const { stdout } = await U.run(seven(), args);
    const items = [];
    let cur = {};
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) { if (cur.Path) items.push(cur); cur = {}; continue; }
      const i = line.indexOf(' = ');
      if (i > 0) cur[line.slice(0, i)] = line.slice(i + 3);
    }
    if (cur.Path) items.push(cur);
    return items.map((x) => ({ path: x.Path, size: Number(x.Size) || 0, packed: Number(x['Packed Size']) || 0, folder: x.Folder === '+' || /D/.test(x.Attributes || ''), encrypted: x.Encrypted === '+', modified: x.Modified }));
  } catch (e) { throw friendly(e); }
}

async function extract(p, opts, ctx) {
  const name = path.basename(p).replace(/\.(tar\.(gz|bz2|xz|zst)|t[gbx]z|tbz2|part0*1\.rar|7z\.001|zip\.001|[^.]+)$/i, '') || 'Extracted';
  const target = ctx.out.folder(p, name);
  const args = ['x', p, `-o${target}`, '-y', '-bsp1', '-bso0', `-p${opts.password || ''}`];
  if (opts.flat) args[0] = 'e';
  try {
    await U.run(seven(), args, { onStdout: progressParser(ctx, 'Extracting'), signal: ctx.signal });
  } catch (e) {
    await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
    throw friendly(e);
  }
  // .tar.gz style: unpack the inner tar too
  if (opts.nested !== false) {
    const inner = await fsp.readdir(target);
    if (inner.length === 1 && /\.tar$/i.test(inner[0])) {
      const tarPath = path.join(target, inner[0]);
      await U.run(seven(), ['x', tarPath, `-o${target}`, '-y', '-bso0'], { signal: ctx.signal }).catch((e) => { throw friendly(e); });
      await fsp.rm(tarPath, { force: true });
    }
  }
  // collapse "Folder/Folder/…" when the archive contains a single top-level folder with the same name
  const entries = await fsp.readdir(target);
  if (entries.length === 1) {
    const only = path.join(target, entries[0]);
    if ((await fsp.stat(only)).isDirectory() && entries[0].toLowerCase() === path.basename(target).toLowerCase()) {
      const tmp = `${target}.__tmp`;
      await fsp.rename(only, tmp);
      await fsp.rmdir(target);
      await fsp.rename(tmp, target);
    }
  }
  return target;
}

async function compress(inputs, opts, ctx) {
  const fmt = opts.format || 'zip';
  const level = String(U.clamp(Number(opts.level ?? 5), 0, 9));
  const first = inputs[0];
  const stem = inputs.length === 1 ? path.basename(first).replace(/\.[^.]+$/, '') || path.basename(first) : (opts.name || path.basename(path.dirname(first)) || 'Archive');
  const finalExt = { zip: 'zip', '7z': '7z', tar: 'tar', 'tar.gz': 'tar.gz', 'tar.xz': 'tar.xz', 'tar.bz2': 'tar.bz2' }[fmt] || 'zip';
  const out = ctx.out.file(first, `${stem}.${finalExt}`);
  const cwd = path.dirname(first);
  const rel = inputs.map((p) => (path.dirname(p) === cwd ? path.basename(p) : p));
  const common = ['-bsp1', '-bso0', '-y'];
  const pw = opts.password ? [`-p${opts.password}`] : [];
  try {
    if (fmt === 'zip' || fmt === '7z') {
      const args = ['a', `-t${fmt}`, out, ...rel, `-mx=${level}`, ...common, ...pw];
      if (fmt === 'zip' && opts.password) args.push('-mem=AES256');
      if (fmt === '7z' && opts.password && opts.encryptNames !== false) args.push('-mhe=on');
      if (fmt === '7z') args.push('-mmt=on');
      if (Number(opts.splitMB) > 0) args.push(`-v${Math.round(Number(opts.splitMB))}m`);
      await U.run(seven(), args, { cwd, onStdout: progressParser(ctx, 'Compressing'), signal: ctx.signal });
    } else {
      const tar = fmt === 'tar' ? out : path.join(await U.tmpDir('tar'), `${stem}.tar`);
      await U.run(seven(), ['a', '-ttar', tar, ...rel, ...common], { cwd, onStdout: progressParser(ctx, 'Packing'), signal: ctx.signal });
      if (fmt !== 'tar') {
        const t = { 'tar.gz': 'gzip', 'tar.xz': 'xz', 'tar.bz2': 'bzip2' }[fmt];
        await U.run(seven(), ['a', `-t${t}`, out, tar, `-mx=${level}`, ...common], { onStdout: progressParser(ctx, 'Compressing'), signal: ctx.signal });
        await fsp.rm(path.dirname(tar), { recursive: true, force: true });
      }
    }
  } catch (e) { await fsp.rm(out, { force: true }).catch(() => {}); throw friendly(e); }
  if (Number(opts.splitMB) > 0 && !fs.existsSync(out)) return path.dirname(out);
  return out;
}

async function test(p, opts) {
  try {
    await U.run(seven(), ['t', p, `-p${opts.password || ''}`, '-bso0', '-bsp0']);
    return { note: `${path.basename(p)} is intact. Every file passed its checksum.` };
  } catch (e) { throw friendly(e); }
}

async function convert(p, opts, ctx) {
  const tmp = await U.tmpDir('rearchive');
  try {
    const sub = { ...ctx, out: { folder: (src, name) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; }, file: ctx.out.file } };
    const dir = await extract(p, { password: opts.password }, { ...sub, progress: (f) => ctx.progress(f * 0.5, 'Extracting') });
    const entries = (await fsp.readdir(dir)).map((e) => path.join(dir, e));
    const res = await compress(entries, { ...opts, name: path.basename(p).replace(/\.(tar\.\w+|[^.]+)$/i, '') }, { ...ctx, out: { file: (src, name) => ctx.out.file(p, name) }, progress: (f) => ctx.progress(0.5 + f * 0.5, 'Compressing') });
    return res;
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { list, extract, compress, test, convert };
