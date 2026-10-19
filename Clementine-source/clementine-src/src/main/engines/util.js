'use strict';
// Shared helpers for all engines. No Electron imports, so engines run in worker threads and in tests.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const isWin = process.platform === 'win32';

const cfg = {
  bin: process.env.CLEM_BIN || path.join(__dirname, '../../../vendor/bin', process.platform),
  data: process.env.CLEM_DATA || path.join(__dirname, '../../../vendor/data'),
  user: process.env.CLEM_USER || path.join(os.tmpdir(), 'clementine-user'),
  tmp: path.join(os.tmpdir(), 'clementine'),
  soffice: process.env.CLEM_SOFFICE || '',
};
function configure(c) { Object.assign(cfg, c || {}); }

/* ---------- file typing ---------- */
const GROUPS = {
  pdf: ['pdf'],
  image: ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif', 'svg', 'ico', 'psd', 'tga', 'jp2', 'jxl', 'dds', 'pcx', 'ppm', 'pgm', 'exr', 'hdr', 'qoi'],
  raw: ['cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'orf', 'rw2', 'raf', 'srw', 'pef', 'x3f', '3fr', 'erf', 'kdc', 'mrw', 'rwl', 'iiq'],
  video: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp', '3g2', 'ogv', 'vob', 'asf', 'f4v', 'rm', 'rmvb', 'divx', 'mxf'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'amr', 'ac3', 'mka', 'alac', 'ape', 'wv', 'm4b', 'caf', 'au', 'mid', 'midi'],
  doc: ['docx', 'doc', 'docm', 'dotx', 'odt', 'rtf', 'txt', 'md', 'markdown', 'html', 'htm', 'xhtml', 'epub', 'pages', 'wpd', 'wps', 'fodt', 'tex', 'rst', 'org', 'xml', 'fb2'],
  sheet: ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv', 'numbers', 'fods', 'dif', 'sylk'],
  slides: ['pptx', 'ppt', 'pptm', 'ppsx', 'pps', 'odp', 'key', 'fodp'],
  vector: ['ai', 'eps', 'ps', 'emf', 'wmf', 'cdr', 'vsd', 'vsdx', 'odg'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'tbz', 'tbz2', 'xz', 'txz', 'zst', 'lz', 'lzma', 'z', 'iso', 'img', 'cab', 'wim', 'dmg', 'arj', 'lzh', 'cpio', 'rpm', 'deb', 'jar', 'apk', 'xpi', 'msi', 'vhd', 'vhdx', 'chm', 'udf', 'squashfs'],
  subtitle: ['srt', 'vtt', 'ass', 'ssa', 'sub'],
  data: ['json', 'yaml', 'yml'],
};
const EXT_GROUP = {};
for (const [g, list] of Object.entries(GROUPS)) for (const e of list) if (!EXT_GROUP[e]) EXT_GROUP[e] = g;
EXT_GROUP.svg = 'image';
const ext = (p) => path.extname(p || '').slice(1).toLowerCase();
const base = (p) => path.basename(p, path.extname(p));
function groupOf(p) {
  try { if (fs.statSync(p).isDirectory()) return 'folder'; } catch (_) { /* missing */ }
  const lower = path.basename(p).toLowerCase();
  if (/\.tar\.(gz|bz2|xz|zst)$/.test(lower)) return 'archive';
  return EXT_GROUP[ext(p)] || 'any';
}

/* ---------- binaries ---------- */
function binPath(name) {
  const exe = isWin ? `${name}.exe` : name;
  const local = path.join(cfg.bin, exe);
  if (fs.existsSync(local)) return local;
  if (name === 'ffmpeg') { try { return require('ffmpeg-static'); } catch (_) { /* fall through */ } }
  if (name === 'ffprobe') { try { return require('ffprobe-static').path; } catch (_) { /* fall through */ } }
  if (name === '7z' && !isWin) {
    const z = path.join(cfg.bin, '7zz');
    if (fs.existsSync(z)) return z;
  }
  return exe;
}
function enginePath(...parts) { return path.join(cfg.user, 'engines', ...parts); }

/* ---------- processes ---------- */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true, env: { ...process.env, ...(opts.env || {}) } });
    let stdout = '';
    let stderr = '';
    let killedForCancel = false;
    if (opts.signal) {
      if (opts.signal.aborted) child.kill();
      opts.signal.addEventListener('abort', () => { killedForCancel = true; child.kill(); }, { once: true });
    }
    child.stdout.on('data', (d) => { const s = d.toString(); stdout += s; if (stdout.length > 4e6) stdout = stdout.slice(-2e6); opts.onStdout?.(s); });
    child.stderr.on('data', (d) => { const s = d.toString(); stderr += s; if (stderr.length > 2e6) stderr = stderr.slice(-1e6); opts.onStderr?.(s); });
    child.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? `${path.basename(cmd)} is missing. Reinstall Clementine or check Settings › Engines.` : e.message)));
    child.on('close', (code) => {
      if (killedForCancel) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      if (code === 0 || (opts.okCodes || []).includes(code)) resolve({ code, stdout, stderr });
      else {
        const tail = (stderr || stdout).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' — ');
        reject(new Error(opts.errorMessage ? `${opts.errorMessage}${tail ? ` (${tail})` : ''}` : (tail || `${path.basename(cmd)} exited with code ${code}`)));
      }
    });
    if (opts.input != null) child.stdin.end(opts.input); else child.stdin.end();
  });
}

/* ---------- paths & output naming ---------- */
async function tmpDir(prefix = 'job') {
  await fsp.mkdir(cfg.tmp, { recursive: true });
  return fsp.mkdtemp(path.join(cfg.tmp, `${prefix}-`));
}
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const e = path.extname(p);
  const b = path.basename(p, e);
  for (let i = 1; i < 10000; i++) {
    const c = path.join(dir, `${b} (${i})${e}`);
    if (!fs.existsSync(c)) return c;
  }
  return path.join(dir, `${b}-${Date.now()}${e}`);
}
const sanitize = (n) => String(n).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+$/, '').slice(0, 180) || 'file';

/** Output planner bound to a job: decides the folder (beside source or chosen folder) and unique names. */
function outputPlanner(job) {
  const reserved = new Set();
  function dirFor(src) {
    if (job.outMode === 'folder' && job.outFolder) return job.outFolder;
    if (src && fs.existsSync(path.dirname(src))) return path.dirname(src);
    return job.outFolder || path.join(os.homedir(), 'Downloads');
  }
  function file(src, name) {
    const dir = dirFor(src);
    fs.mkdirSync(dir, { recursive: true });
    let p = uniquePath(path.join(dir, sanitize(name)));
    while (reserved.has(p)) p = uniquePath(p.replace(/(\.[^.]+)?$/, ` x$1`));
    reserved.add(p);
    return p;
  }
  function folder(src, name) {
    const p = uniquePath(path.join(dirFor(src), sanitize(name)));
    fs.mkdirSync(p, { recursive: true });
    return p;
  }
  return { file, folder, dirFor };
}

/* ---------- misc ---------- */
async function hashFile(p, algo) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}
/** Parse page range strings like "1-3, 5, 8-" against a page count. Returns 0-based indices. */
function parseRanges(spec, count) {
  const s = String(spec || '').trim();
  if (!s || s.toLowerCase() === 'all') return [...Array(count).keys()];
  const out = [];
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*|last)\s*(?:-\s*(\d*|last))?$/i.exec(part);
    if (!m) throw new Error(`“${part}” isn’t a page range. Use something like 1-3, 5, 8-.`);
    const val = (x, d) => (x === '' || x == null ? d : x.toLowerCase() === 'last' ? count : parseInt(x, 10));
    const a = val(m[1], 1);
    const b = m[2] !== undefined ? val(m[2], count) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= count) out.push(i - 1);
  }
  if (!out.length) throw new Error(`No pages match “${s}”. This file has ${count} page${count === 1 ? '' : 's'}.`);
  return out;
}
/** Split a range spec into groups: "1-3, 4-6" → [[0,1,2],[3,4,5]]. */
function parseRangeGroups(spec, count) {
  return String(spec || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean).map((g) => parseRanges(g, count));
}
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

module.exports = {
  cfg, configure, isWin, GROUPS, groupOf, ext, base, binPath, enginePath, run, tmpDir, uniquePath, sanitize,
  outputPlanner, hashFile, parseRanges, parseRangeGroups, fmtBytes, clamp, fs, fsp, path, os,
};
