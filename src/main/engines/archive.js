'use strict';
// Archives through the bundled 7-Zip. Every listing is checked before anything is written (entries leaving the target
// folder, encryption, entry bombs, disk space), symbolic links are never unpacked or followed, compressed TARs are
// unpacked stage by stage, and results appear only when complete (staging folder, temporary archive name). Safety
// rules and staging adapted from Filee by KnifeLemon (MIT).

const U = require('./util');
const { fs, fsp, path } = U;
const crypto = require('crypto');
const { spawn } = require('child_process');

const seven = () => U.binPath('7z');
const NO_PASSWORD = '-plime-no-password';
const MAX_ENTRIES = 1e6, RESERVE = 64 * 1048576;
const TAR_WRAPPED = /\.(tar\.(gz|bz2?|xz|zst|7z|z|lzma)|tgz|taz|tpz|tbz2?|txz|tzst)$/i;
const SINGLE = { gz: 'gzip', bz2: 'bzip2', xz: 'xz' };
const TAR_TYPE = { 'tar.gz': 'gzip', 'tar.bz2': 'bzip2', 'tar.xz': 'xz' };
const hex8 = () => crypto.randomBytes(4).toString('hex');
const stem = (p) => path.basename(p).replace(/\.(tar\.(gz|bz2?|xz|zst|7z|z|lzma)|t[gbx]z|tbz2|tzst|taz|tpz|part0*1\.rar|7z\.001|zip\.001|[^.]+)$/i, '') || 'Extracted';
const progressOf = (ctx, label, from = 0, to = 1) => (s) => { const m = s.match(/(\d{1,3})%/g); if (m) ctx?.progress?.(from + (to - from) * (Number(m[m.length - 1].slice(0, -1)) / 100), label); };

// 7-Zip run that keeps its whole output as UTF-8 (names can be any script) and never rejects on an exit code.
function run7(args, ctx = {}, onOut) {
  return new Promise((resolve, reject) => {
    const child = spawn(seven(), args, { windowsHide: true });
    const out = [], err = [];
    const abort = () => child.kill();
    if (ctx.signal?.aborted) abort(); else ctx.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (d) => { out.push(d); onOut?.(d.toString('latin1')); });
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? '7-Zip is missing. Reinstall Lime.' : e.message)));
    child.on('close', (code) => {
      ctx.signal?.removeEventListener('abort', abort);
      if (ctx.signal?.aborted) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
}
function errorLines(r) {
  const out = [];
  let under = false;
  for (const raw of `${r.stderr}\n${r.stdout}`.split(/\r?\n/)) {
    const l = raw.trim();
    if (l === 'ERRORS:' || l === 'WARNINGS:') { under = true; continue; }
    if (!l) { under = false; continue; }
    if (under || /^(ERROR|Open ERROR|WARNING)/i.test(l)) out.push(l);
  }
  return out;
}
const errorText = (r) => { const l = [...new Set(errorLines(r))].slice(0, 3); return (l.length ? l : r.stderr.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 3)).join(' '); };
const passwordError = (name, password) => new Error(password ? `The password for ${name} is wrong.` : `${name} is password-protected. Enter its password in the options and try again.`);
function failure(p, r, password) {
  const name = path.basename(p), t = `${r.stderr}\n${r.stdout}`;
  if (/Wrong password|encrypted archive|Can not open encrypted/i.test(t)) return passwordError(name, password);
  if (/Cannot open the file as|Is not archive|Can not open the file as/i.test(t)) return new Error(`${name} is not a valid archive, or not the kind its extension says.`);
  if (/Missing volume/i.test(t)) return new Error(`${name} is incomplete: a part of this multi-volume archive is missing. Keep all parts in the same folder.`);
  if (/Unexpected end|Data Error|CRC Failed|Headers Error/i.test(t)) return new Error(`${name} is damaged or incomplete (${errorText(r)}).`);
  return new Error(`7-Zip could not read ${name} (exit ${r.code}). ${errorText(r)}`.trim());
}
// Exit 2 only because 7-Zip refused a link (one pointing outside): Lime never wants links anyway.
const onlyLinkErrors = (r) => { const e = errorLines(r); return e.length > 0 && e.every((l) => /symbolic link|Dangerous link/i.test(l)); };

function parseListing(stdout) {
  const items = [];
  let cur = null, started = false;
  const flush = () => {
    if (cur?.Path != null) {
      const mode = cur.Mode || cur.Attributes || '';
      items.push({
        path: cur.Path, size: Number(cur.Size) || 0, packed: Number(cur['Packed Size']) || 0, modified: cur.Modified,
        folder: cur.Folder === '+' || /^D/.test(cur.Attributes || ''), encrypted: cur.Encrypted === '+', hardLink: cur['Hard Link'] || null,
        symlink: !!cur['Symbolic Link'] || mode.split(' ').some((x) => x.length === 10 && x[0] === 'l'),
      });
    }
    cur = null;
  };
  for (const line of stdout.split(/\r?\n/)) {
    if (!started) { started = line.startsWith('----------'); continue; }
    if (!line) { flush(); continue; }
    const i = line.indexOf(' = ');
    if (i > 0) (cur ||= {})[line.slice(0, i)] = line.slice(i + 3);
    else if (line.endsWith(' =')) (cur ||= {})[line.slice(0, -2)] = '';
  }
  flush();
  return items;
}
async function list(p, password) {
  const r = await run7(['l', '-slt', '-sccUTF-8', '-bsp0', password ? `-p${password}` : NO_PASSWORD, '--', p]);
  if (r.code > 1) throw failure(p, r, password);
  return parseListing(r.stdout);
}

const unsafePath = (p) => /^[/\\]/.test(p) || /^[A-Za-z]:/.test(p) || p.split(/[/\\]/).includes('..');
function fmtSize(n) {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let v = n, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return u === 0 ? `${n} bytes` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}
async function checkListing(entries, name, dir, password) {
  if (entries.length > MAX_ENTRIES) throw new Error(`${name} has more than 1,000,000 entries; Lime does not unpack it.`);
  for (const e of entries) {
    if (e.encrypted && !password) throw passwordError(name);
    if (unsafePath(e.path) || (e.hardLink && unsafePath(e.hardLink))) throw new Error(`${name} was not unpacked: the entry "${e.path}" points outside the target folder.`);
  }
  const bytes = entries.reduce((s, e) => s + (e.folder ? 0 : e.size), 0);
  if (bytes <= 0) return;
  let free;
  try { const s = await fsp.statfs(dir); free = s.bavail * s.bsize; } catch (_) { return; }
  if (bytes > free - RESERVE) throw new Error(`${name} unpacks to ${fmtSize(bytes)}, but only ${fmtSize(free)} is free on ${path.parse(path.resolve(dir)).root}.`);
}
// Deletes symbolic links and junctions below dir without following them.
async function removeLinks(dir) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) await fsp.unlink(p).catch(() => fsp.rmdir(p));
    else if (e.isDirectory()) await removeLinks(p);
  }
}
async function extractOnce(archive, dir, scratch, opts, ctx) {
  const entries = await list(archive, opts.password);
  await checkListing(entries, path.basename(archive), dir, opts.password);
  const args = [opts.flat ? 'e' : 'x', '-y', '-aou', '-sccUTF-8', '-scsUTF-8', '-bsp1', '-bso0', '-bb0', opts.password ? `-p${opts.password}` : NO_PASSWORD, `-o${dir}`];
  const links = entries.filter((e) => e.symlink).map((e) => e.path);
  if (links.length) {
    const file = path.join(scratch, `exclude-${hex8()}.txt`);
    await fsp.writeFile(file, links.join('\n'));
    args.push('-spd', `-x@${file}`);
  }
  const r = await run7([...args, '--', archive], ctx, progressOf(ctx, 'Extracting'));
  if (r.code > 1 && !(r.code === 2 && onlyLinkErrors(r))) throw failure(archive, r, opts.password);
}
async function isTar(p) {
  if (/\.tar$/i.test(p)) return true;
  const fd = await fsp.open(p, 'r');
  try { const b = Buffer.alloc(262); return (await fd.read(b, 0, 262, 0)).bytesRead === 262 && b.toString('latin1', 257, 262) === 'ustar'; } finally { await fd.close(); }
}
// The single file a stage produced that must be unpacked too: the TAR inside a .tar.gz (and co.) or an RPM payload.
async function innerArchive(original, dir) {
  if (!TAR_WRAPPED.test(original) && U.ext(original) !== 'rpm') return null;
  const names = await fsp.readdir(dir);
  if (names.length !== 1) return null;
  const p = path.join(dir, names[0]);
  if (!(await fsp.stat(p)).isFile()) return null;
  if (await isTar(p)) return p;
  return U.ext(original) === 'rpm' && /\.(cpio|gz|bz2|xz|lzma|z|zst)$/i.test(p) ? p : null;
}
// Unpacks into scratch/x0, x1 … (at most three stages) and returns the folder holding the files.
async function unpack(archive, opts, scratch, ctx) {
  let cur = archive, prev = null;
  for (let stage = 0; ; stage++) {
    const dir = path.join(scratch, `x${stage}`);
    await fsp.mkdir(dir, { recursive: true });
    await extractOnce(cur, dir, scratch, stage ? { ...opts, password: '' } : opts, ctx);
    await removeLinks(dir);
    if (prev) await fsp.rm(prev, { recursive: true, force: true }).catch(() => {});
    const inner = stage < 2 && opts.nested !== false && !opts.flat ? await innerArchive(archive, dir) : null;
    if (!inner) return dir;
    prev = dir;
    cur = inner;
  }
}

async function rename(from, to) {
  for (let i = 0; ; i++) {
    try { return await fsp.rename(from, to); } catch (e) {
      if (e.code === 'EXDEV' || i >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}
async function moveFile(from, to) {
  try { await rename(from, to); } catch (e) { if (e.code !== 'EXDEV') throw e; await fsp.copyFile(from, to); await fsp.rm(from, { force: true }); }
}
// Moves an unpacked folder into place; an existing folder receives the files (same names replaced, others kept).
async function moveInto(src, dst) {
  const st = await fsp.lstat(dst).catch(() => null);
  if (st?.isSymbolicLink()) throw new Error(`${dst} is a link; Lime does not extract into links.`);
  if (st && !st.isDirectory()) throw new Error(`A file named ${path.basename(dst)} is in the way of the extracted folder.`);
  if (st && !(await fsp.readdir(dst)).length) await fsp.rmdir(dst).catch(() => {});
  if (!fs.existsSync(dst)) { try { return await rename(src, dst); } catch (_) {} }
  await fsp.mkdir(dst, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, e.name), to = path.join(dst, e.name);
    const there = await fsp.lstat(to).catch(() => null);
    if (e.isDirectory()) {
      if (there && !there.isDirectory()) await fsp.rm(to, { force: true });
      await moveInto(from, to);
    } else {
      if (there?.isDirectory()) throw new Error(`A folder named ${e.name} is in the way of a file in the archive.`);
      await moveFile(from, to);
    }
  }
}
async function contentRoot(dir) {
  const names = await fsp.readdir(dir);
  if (names.length === 1 && (await fsp.lstat(path.join(dir, names[0]))).isDirectory()) return path.join(dir, names[0]);
  return dir;
}

async function extract(p, opts, ctx) {
  const target = ctx.out.folder(p, stem(p));
  const fresh = !(await fsp.readdir(target).catch(() => [])).length;
  const near = path.join(path.dirname(target), `.${path.basename(target)}.lime-${hex8()}`);
  const staging = await fsp.mkdir(near).then(() => near, () => U.tmpDir('extract'));
  try {
    const dir = await unpack(p, opts, staging, { ...ctx, progress: (f, l) => ctx.progress?.(f * 0.95, l) });
    await moveInto(opts.flat ? dir : await contentRoot(dir), target);
    return target;
  } catch (e) {
    if (fresh) await fsp.rmdir(target).catch(() => {});
    throw e;
  } finally { await fsp.rm(staging, { recursive: true, force: true }).catch(() => {}); }
}
async function decompress(p, opts, ctx) {
  const work = await U.tmpDir('decompress');
  try {
    const dir = await unpack(p, { password: opts.password, nested: false }, work, ctx);
    const names = await fsp.readdir(dir);
    if (names.length !== 1 || !(await fsp.stat(path.join(dir, names[0]))).isFile()) throw new Error(`${path.basename(p)} holds more than one file. Use Extract instead.`);
    const out = ctx.out.file(p, names[0]);
    await moveFile(path.join(dir, names[0]), out);
    return out;
  } finally { await fsp.rm(work, { recursive: true, force: true }).catch(() => {}); }
}

// Each item under its own name; a name already used (any case) becomes "name (2).ext".
function uniqueEntries(paths) {
  const used = new Set();
  return paths.map((src) => {
    const own = path.basename(src.replace(/[/\\]+$/, ''));
    const e = path.extname(own), s = path.basename(own, e);
    let name = own;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${s} (${n})${e}`;
    used.add(name.toLowerCase());
    return { src, name };
  });
}
// 7-Zip stores every path under its own file name: renamed duplicates are linked or copied under their entry name.
async function namedAs(items, work) {
  const out = [];
  for (const it of items) {
    if (path.basename(it.src) === it.name) { out.push(path.resolve(it.src)); continue; }
    const dir = path.join(work, `rename-${hex8()}`), copy = path.join(dir, it.name);
    await fsp.mkdir(dir);
    if ((await fsp.stat(it.src)).isDirectory()) await fsp.cp(it.src, copy, { recursive: true, preserveTimestamps: true, filter: (s) => !fs.lstatSync(s).isSymbolicLink() });
    else await fsp.link(it.src, copy).catch(() => fsp.copyFile(it.src, copy));
    out.push(copy);
  }
  return out;
}
// Archive paths of the links inside dropped folders, so 7-Zip leaves them out instead of following them.
async function linksIn(items) {
  const out = [];
  const walk = async (dir, rel) => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const r = path.join(rel, e.name);
      if (e.isSymbolicLink()) out.push(r); else if (e.isDirectory()) await walk(path.join(dir, e.name), r);
    }
  };
  for (const it of items) if ((await fsp.lstat(it.src)).isDirectory()) await walk(it.src, it.name);
  return out;
}
async function add7(archive, args, paths, exclude, work, ctx, label, from, to) {
  const list = path.join(work, `items-${hex8()}.txt`);
  await fsp.writeFile(list, paths.join('\n'));
  const a = ['a', ...args, '-ssw', '-sse', '-y', '-sccUTF-8', '-scsUTF-8', '-bsp1', '-bso0', '-bb0'];
  if (exclude.length) { const x = path.join(work, `exclude-${hex8()}.txt`); await fsp.writeFile(x, exclude.join('\n')); a.push('-spd', `-x@${x}`); }
  const r = await run7([...a, archive, `@${list}`], ctx, progressOf(ctx, label, from, to));
  if (r.code > 1) throw new Error(`7-Zip could not create the archive (exit ${r.code}). ${errorText(r)}`.trim());
}
// Writes items ({src, name}) as one archive; built under a temporary name and renamed when complete.
async function pack(items, out, fmt, opts, ctx) {
  const split = Number(opts.splitMB) > 0 && (fmt === 'zip' || fmt === '7z');
  const tmp = split ? out : path.join(path.dirname(out), `.${path.basename(out)}.lime-${hex8()}.tmp`);
  const work = await U.tmpDir('pack');
  const mx = `-mx${U.clamp(Math.round(Number(opts.level ?? 5)), 0, 9)}`;
  try {
    for (const it of items) if (!fs.existsSync(it.src)) throw new Error(`${it.src} was not found.`);
    if (SINGLE[fmt] && (items.length !== 1 || !(await fsp.stat(items[0].src)).isFile())) throw new Error(`A .${fmt} file holds a single file. Choose TAR.${fmt.toUpperCase()} to compress several files or folders.`);
    const paths = await namedAs(items, work), exclude = await linksIn(items);
    if (fmt === 'zip' || fmt === '7z') {
      const args = [`-t${fmt}`, mx];
      if (fmt === 'zip') args.push('-mcu=on');
      if (fmt === '7z') args.push('-mmt=on');
      if (opts.password) args.push(`-p${opts.password}`, ...(fmt === 'zip' ? ['-mem=AES256'] : opts.encryptNames !== false ? ['-mhe=on'] : []));
      if (split) args.push(`-v${Math.round(Number(opts.splitMB))}m`);
      await add7(tmp, args, paths, exclude, work, ctx, 'Compressing', 0, 1);
    } else if (fmt === 'tar') await add7(tmp, ['-ttar'], paths, exclude, work, ctx, 'Packing', 0, 1);
    else if (TAR_TYPE[fmt]) {
      const tar = path.join(work, path.basename(out).replace(/\.(gz|bz2|xz)$/i, '').replace(/(\.tar)?$/i, '.tar'));
      await add7(tar, ['-ttar'], paths, exclude, work, ctx, 'Packing', 0, 0.4);
      await add7(tmp, [`-t${TAR_TYPE[fmt]}`, mx], [tar], [], work, ctx, 'Compressing', 0.4, 1);
    } else if (SINGLE[fmt]) await add7(tmp, [`-t${SINGLE[fmt]}`, mx], paths, [], work, ctx, 'Compressing', 0, 1);
    else throw new Error(`Lime can’t write ${fmt.toUpperCase()} archives.`);
    if (split) return fs.existsSync(out) ? out : path.dirname(out);
    if (!fs.existsSync(tmp)) throw new Error('7-Zip could not create the archive.');
    await rename(tmp, out);
    return out;
  } catch (e) {
    if (!split) await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  } finally { await fsp.rm(work, { recursive: true, force: true }).catch(() => {}); }
}
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
// "photo.jpg" → photo.zip, a folder → folder.zip, one file as GZ → photo.jpg.gz, several files → {first}_files.zip.
function archiveName(inputs, fmt) {
  const first = inputs[0], own = path.basename(first.replace(/[/\\]+$/, ''));
  if (SINGLE[fmt]) return `${own}.${fmt}`;
  if (inputs.length > 1) return `${U.base(first) || own}_files.${fmt}`;
  return `${isDir(first) ? own : U.base(first) || own}.${fmt}`;
}
async function compress(inputs, opts, ctx) {
  const fmt = opts.format || 'zip';
  return pack(uniqueEntries(inputs), ctx.out.file(inputs[0], archiveName(inputs, fmt)), fmt, opts, ctx);
}
// Archive → archive: everything unpacked (TARs inside included) is packed again as it was, top folder kept.
async function convert(p, opts, ctx) {
  const fmt = opts.format || 'zip';
  const work = await U.tmpDir('rearchive');
  try {
    const dir = await unpack(p, { password: opts.password, nested: !SINGLE[fmt] }, work, { ...ctx, progress: (f, l) => ctx.progress?.(f * 0.45, l) });
    const names = (await fsp.readdir(dir)).sort();
    if (SINGLE[fmt] && names.length !== 1) throw new Error(`A .${fmt} file holds a single file. Choose TAR.${fmt.toUpperCase()} to compress several files or folders.`);
    const out = ctx.out.file(p, SINGLE[fmt] ? `${names[0]}.${fmt}` : `${stem(p)}.${fmt}`);
    return await pack(names.map((n) => ({ src: path.join(dir, n), name: n })), out, fmt, opts, { ...ctx, progress: (f, l) => ctx.progress?.(0.5 + f * 0.5, l) });
  } finally { await fsp.rm(work, { recursive: true, force: true }).catch(() => {}); }
}
async function test(p, opts) {
  const r = await run7(['t', '-sccUTF-8', '-bsp0', '-bso0', opts.password ? `-p${opts.password}` : NO_PASSWORD, '--', p]);
  if (r.code > 1) throw failure(p, r, opts.password);
  return { note: `${path.basename(p)} is intact. Every file passed its checksum.` };
}

module.exports = { list, extract, decompress, compress, convert, test, stem, parseListing, unsafePath, uniqueEntries, archiveName, fmtSize };
