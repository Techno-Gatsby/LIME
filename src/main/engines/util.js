'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const isWin = process.platform === 'win32';

const cfg = {
  bin: process.env.LIME_BIN || path.join(__dirname, '../../../vendor/bin', `${process.platform}-${process.arch}`),
  data: process.env.LIME_DATA || path.join(__dirname, '../../../vendor/data'),
  crafts: process.env.LIME_CRAFTS || path.join(__dirname, '../../../vendor/crafts', `${process.platform}-${process.arch}`),
  apps: process.env.LIME_APPS || path.join(__dirname, '../../../vendor/apps', `${process.platform}-${process.arch}`),
  web: process.env.LIME_WEB || path.join(__dirname, '../../../vendor/web'),
  helpers: process.env.LIME_HELPERS || path.join(__dirname, '../../../vendor/helpers', `${process.platform}-${process.arch}`),
  models: process.env.LIME_MODELS || path.join(__dirname, '../../../vendor/models'),
  user: process.env.LIME_USER || path.join(os.tmpdir(), 'lime-user'),
  tmp: path.join(os.tmpdir(), 'lime'),
  soffice: process.env.LIME_SOFFICE || '',
  pandoc: process.env.LIME_PANDOC || '',
};
function configure(c) { Object.assign(cfg, c || {}); }

const GROUPS = {
  pdf: ['pdf'],
  image: ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif', 'svg', 'ico', 'psd', 'psb', 'pcraft', 'tga', 'jp2', 'jxl', 'dds', 'pcx', 'ppm', 'pgm', 'exr', 'hdr', 'dpx', 'qoi', 'apng', 'cur', 'icns', 'hif', 'j2k', 'pbm', 'pam', 'pfm', 'sgi', 'ras', 'sun', 'xbm', 'xpm', 'wbmp'],
  raw: ['cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'orf', 'rw2', 'raf', 'srw', 'pef', 'x3f', '3fr', 'erf', 'kdc', 'mrw', 'rwl', 'iiq'],
  video: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp', '3g2', 'ogv', 'vob', 'asf', 'f4v', 'rm', 'rmvb', 'divx', 'mxf'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'amr', 'ac3', 'mka', 'alac', 'ape', 'wv', 'm4b', 'caf', 'au', 'mid', 'midi'],
  doc: ['docx', 'doc', 'docm', 'dotx', 'dotm', 'odt', 'rtf', 'txt', 'md', 'markdown', 'html', 'htm', 'xhtml', 'epub', 'pages', 'wpd', 'wps', 'fodt', 'tex', 'rst', 'org', 'xml', 'fb2'],
  sheet: ['xlsx', 'xls', 'xlsm', 'xltx', 'xltm', 'xlsb', 'ods', 'csv', 'tsv', 'numbers', 'fods', 'dif', 'sylk'],
  slides: ['pptx', 'ppt', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm', 'pps', 'odp', 'key', 'fodp'],
  vector: ['ai', 'ait', 'eps', 'epsf', 'ps', 'emf', 'wmf', 'svgz', 'af', 'afdesign', 'afpub', 'vectorcraft', 'cdr', 'vsd', 'vsdx', 'odg'],
  cad2d: ['dxf', 'dwg'],
  cad3d: ['stl', 'obj', 'ply', 'off', 'glb', 'gltf', '3mf', 'fbx', 'step', 'stp', 'iges', 'igs', 'brep'],
  layout: ['idml', 'indd', 'designcraft'],
  motion: ['lottie', 'ecproj'],
  timeline: ['otio', 'fcpxml', 'edl', 'aaf', 'omf', 'fcproj'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'tbz', 'tbz2', 'xz', 'txz', 'zst', 'lz', 'lzma', 'z', 'iso', 'img', 'cab', 'wim', 'dmg', 'arj', 'lzh', 'cpio', 'rpm', 'deb', 'jar', 'apk', 'xpi', 'msi', 'vhd', 'vhdx', 'chm', 'udf', 'squashfs'],
  subtitle: ['srt', 'vtt', 'ass', 'ssa', 'sub'],
  data: ['json', 'yaml', 'yml'],
  gis: ['shp', 'geojson', 'kml', 'kmz', 'gpx', 'gpkg', 'fgb', 'gml', 'topojson', 'tab', 'mif', 'hgt'],
  hydro: ['inp', 'dss', 'hdf', 'h5'],
  project: ['mpp', 'mpt', 'mpx', 'pod', 'xer', 'gan'],
  // Source code no other group claims (a .ts is a video unless it reads as text: see groupOf).
  code: ['py', 'pyw', 'pyi', 'js', 'mjs', 'cjs', 'jsx', 'tsx', 'mts', 'cts', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh',
    'cs', 'java', 'kt', 'kts', 'scala', 'go', 'rs', 'rb', 'php', 'swift', 'dart', 'lua', 'pl', 'r', 'jl', 'sql', 'graphql', 'proto', 'ini', 'cfg', 'conf', 'properties'],
  database: ['sqlite', 'sqlite3', 'db3', 's3db', 'sl3'],
};
const EXT_GROUP = {};
for (const [g, list] of Object.entries(GROUPS)) for (const e of list) if (!EXT_GROUP[e]) EXT_GROUP[e] = g;
EXT_GROUP.svg = 'image';
const ext = (p) => path.extname(p || '').slice(1).toLowerCase();
const base = (p) => path.basename(p, path.extname(p));
function groupOf(p) {
  try { if (fs.statSync(p).isDirectory()) return 'folder'; } catch (_) {}
  const lower = path.basename(p).toLowerCase();
  if (/\.tar\.(gz|bz2|xz|zst)$/.test(lower)) return 'archive';
  const e = ext(p);
  if (e === 'json' && sniff(p, /"layers"\s*:/) && sniff(p, /"fr"\s*:/)) return 'motion';
  if (e === 'xml' && sniff(p, /<xmeml/)) return 'timeline';
  if (e === 'db') return head(p, 16) === 'SQLite format 3\0' ? 'database' : 'any';
  // MPEG transport streams start every 188-byte packet with 0x47; TypeScript is text.
  if (e === 'ts') { const h = head(p, 512); if (h && h[0] !== '\x47' && !/[\x00-\x08\x0e-\x1a]/.test(h)) return 'code'; }
  return EXT_GROUP[e] || 'any';
}
function head(p, n) {
  try { const fd = fs.openSync(p, 'r'), b = Buffer.alloc(n), k = fs.readSync(fd, b, 0, n, 0); fs.closeSync(fd); return b.subarray(0, k).toString('latin1'); } catch (_) { return ''; }
}
function sniff(p, re) {
  try {
    const fd = fs.openSync(p, 'r');
    const b = Buffer.alloc(8192);
    const n = fs.readSync(fd, b, 0, b.length, 0);
    fs.closeSync(fd);
    return re.test(b.subarray(0, n).toString('utf8'));
  } catch (_) { return false; }
}

function binPath(name) {
  const exe = isWin ? `${name}.exe` : name;
  const local = path.join(cfg.bin, exe);
  if (fs.existsSync(local)) return local;
  if (name === 'ffmpeg') { try { return require('ffmpeg-static'); } catch (_) {} }
  if (name === 'ffprobe') { try { return require('ffprobe-static').path; } catch (_) {} }
  if (name === '7z' && !isWin) {
    const z = path.join(cfg.bin, '7zz');
    if (fs.existsSync(z)) return z;
  }
  return exe;
}
function enginePath(...parts) { return path.join(cfg.user, 'engines', ...parts); }

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true, env: { ...process.env, ...(opts.env || {}) } });
    // Engines yield to the wheel, so it keeps moving smoothly while a big conversion runs.
    try { if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) {}
    let stdout = '';
    let stderr = '';
    let killedForCancel = false, timedOut = false;
    // A program that stops responding is stopped with everything it started, and not waited for: on Windows its
    // helpers can keep its output open, so it might never report closing.
    const timer = opts.timeout && setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
      else child.kill('SIGKILL');
      reject(Object.assign(new Error(`${opts.errorMessage || path.basename(cmd)} (it stopped responding)`), { code: 'TIMEOUT' }));
    }, opts.timeout);
    if (opts.signal) {
      if (opts.signal.aborted) child.kill();
      opts.signal.addEventListener('abort', () => { killedForCancel = true; child.kill(); }, { once: true });
    }
    child.stdout.on('data', (d) => { const s = d.toString(); stdout += s; if (stdout.length > 4e6) stdout = stdout.slice(-2e6); opts.onStdout?.(s); });
    child.stderr.on('data', (d) => { const s = d.toString(); stderr += s; if (stderr.length > 2e6) stderr = stderr.slice(-1e6); opts.onStderr?.(s); });
    child.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? `${path.basename(cmd)} is missing. Reinstall Lime.` : e.message)));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killedForCancel) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      if (timedOut) return reject(Object.assign(new Error(`${opts.errorMessage || path.basename(cmd)} (it stopped responding)`), { code: 'TIMEOUT' }));
      if (code === 0 || (opts.okCodes || []).includes(code)) resolve({ code, stdout, stderr });
      else {
        const tail = (stderr || stdout).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' — ');
        reject(new Error(opts.errorMessage ? `${opts.errorMessage}${tail ? ` (${tail})` : ''}` : (tail || `${path.basename(cmd)} exited with code ${code}`)));
      }
    });
    if (opts.input != null) child.stdin.end(opts.input); else child.stdin.end();
  });
}

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

function outputPlanner(job) {
  const reserved = new Set();
  const dest = job.dest || null;
  let used = false;
  function dirFor(src) {
    if (dest) return dest.kind === 'dir' ? dest.path : path.dirname(dest.path);
    if (job.outMode === 'folder' && job.outFolder) return job.outFolder;
    if (src && fs.existsSync(path.dirname(src))) return path.dirname(src);
    return job.outFolder || path.join(os.homedir(), 'Downloads');
  }
  const claim = (p) => { while (reserved.has(p)) p = uniquePath(p.replace(/(\.[^.]+)?$/, ' x$1')); reserved.add(p); return p; };
  const kind = (p) => { const e = path.extname(p).toLowerCase(); return { '.tiff': '.tif', '.jpeg': '.jpg' }[e] || e; };
  function file(src, name) {
    if (dest?.kind === 'file' && !used) {
      used = true;
      const want = path.extname(name).toLowerCase();
      const p = kind(dest.path) === kind(name) || !want ? dest.path : dest.path.replace(/(\.[^./\\]+)?$/, want);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (p !== dest.path || (fs.existsSync(p) && !fs.statSync(p).isFile())) return claim(uniquePath(p));
      fs.rmSync(p, { force: true });
      return claim(p);
    }
    const dir = dest?.kind === 'folder' ? dest.path : dirFor(src);
    fs.mkdirSync(dir, { recursive: true });
    return claim(uniquePath(path.join(dir, sanitize(name))));
  }
  function folder(src, name) {
    if (dest?.kind === 'folder' && !used) { used = true; fs.mkdirSync(dest.path, { recursive: true }); return dest.path; }
    // Asked for one file but the result is several (every sheet, every page): a folder under the chosen name.
    if (dest?.kind === 'file' && !used) { used = true; const p = uniquePath(dest.path.replace(/\.[^./\\]+$/, '')); fs.mkdirSync(p, { recursive: true }); return p; }
    const p = uniquePath(path.join(dest?.kind === 'folder' ? dest.path : dirFor(src), sanitize(name)));
    fs.mkdirSync(p, { recursive: true });
    return p;
  }
  return { file, folder, dirFor };
}

async function hashFile(p, algo) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

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

function parseRangeGroups(spec, count) {
  return String(spec || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean).map((g) => parseRanges(g, count));
}
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

module.exports = {
  cfg, configure, isWin, GROUPS, groupOf, ext, base, binPath, enginePath, run, tmpDir, uniquePath, sanitize,
  outputPlanner, hashFile, parseRanges, parseRangeGroups, fmtBytes, clamp, fs, fsp, path, os,
};
