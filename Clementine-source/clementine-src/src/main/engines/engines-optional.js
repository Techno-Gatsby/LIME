'use strict';
// Engines that are too large to bundle but give the best results. Each installs on demand from its official source.
const U = require('./util');
const { fs, fsp, path } = U;

/* ---------- downloads ---------- */
async function download(url, dest, onProgress, signal) {
  const res = await fetch(url, { redirect: 'follow', signal });
  if (!res.ok) throw new Error(`Download failed (${res.status}). Check your internet connection and try again.`);
  const total = Number(res.headers.get('content-length')) || 0;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const file = fs.createWriteStream(dest);
  let got = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!file.write(Buffer.from(value))) await new Promise((r) => file.once('drain', r));
      if (total) onProgress?.(got / total, `${U.fmtBytes(got)} of ${U.fmtBytes(total)}`);
    }
  } finally { await new Promise((r) => file.end(r)); }
  return dest;
}
/** Resolve the newest release asset on GitHub without the rate-limited API. */
async function githubAsset(repo, pattern, tag) {
  let t = tag;
  if (!t) {
    const r = await fetch(`https://github.com/${repo}/releases/latest`, { redirect: 'manual' });
    const loc = r.headers.get('location') || '';
    t = decodeURIComponent(loc.split('/tag/')[1] || '');
    if (!t) throw new Error(`Couldn’t find the latest release of ${repo}.`);
  }
  const html = await (await fetch(`https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(t)}`)).text();
  const hrefs = [...html.matchAll(/href="([^"]+\/releases\/download\/[^"]+)"/g)].map((m) => m[1]);
  const hit = hrefs.find((h) => pattern.test(decodeURIComponent(h.split('/').pop())));
  if (!hit) throw new Error(`No download for this computer was found in ${repo} ${t}.`);
  return { url: `https://github.com${hit}`, tag: t, name: decodeURIComponent(hit.split('/').pop()) };
}
async function unpack(archive, dest) {
  await fsp.mkdir(dest, { recursive: true });
  await U.run(U.binPath('7z'), ['x', archive, `-o${dest}`, '-y', '-bso0', '-bsp0']);
  // tar.gz → tar → files
  for (const f of await fsp.readdir(dest)) {
    if (/\.tar$/i.test(f)) { await U.run(U.binPath('7z'), ['x', path.join(dest, f), `-o${dest}`, '-y', '-bso0']); await fsp.rm(path.join(dest, f)); }
  }
  return dest;
}
function findFile(dir, re, depth = 4) {
  if (!fs.existsSync(dir) || depth < 0) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && re.test(e.name)) return p;
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { const r = findFile(path.join(dir, e.name), re, depth - 1); if (r) return r; }
  }
  return null;
}

/* ---------- LibreOffice ---------- */
function libreOfficePath() {
  const cands = [];
  if (U.cfg.soffice) cands.push(U.cfg.soffice);
  if (U.isWin) {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)']) {
      if (base) cands.push(path.join(base, 'LibreOffice', 'program', 'soffice.exe'), path.join(base, 'LibreOffice 7', 'program', 'soffice.exe'));
    }
    cands.push(U.enginePath('libreoffice', 'program', 'soffice.exe'));
  } else cands.push('/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice');
  return cands.find((c) => c && fs.existsSync(c)) || null;
}
async function installLibreOffice(onProgress, signal) {
  if (!U.isWin) throw new Error('Install LibreOffice with your system package manager.');
  const base = 'https://download.documentfoundation.org/libreoffice/stable/';
  const html = await (await fetch(base)).text();
  const versions = [...html.matchAll(/href="(\d+\.\d+\.\d+)\/"/g)].map((m) => m[1]).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (!versions.length) throw new Error('Couldn’t reach the LibreOffice download server.');
  const v = versions[0];
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const file = `LibreOffice_${v}_Win_${arch === 'aarch64' ? 'aarch64' : 'x86-64'}.msi`;
  const msi = path.join(U.cfg.tmp, file);
  await download(`${base}${v}/win/${arch}/${file}`, msi, (f, l) => onProgress?.(f * 0.85, `Downloading LibreOffice ${v} · ${l}`), signal);
  onProgress?.(0.9, 'Installing LibreOffice (approve the Windows prompt)');
  await U.run('msiexec', ['/i', msi, '/passive', '/norestart', 'RebootYesNo=No', 'UI_LANGS=en_US'], { okCodes: [3010] });
  fsp.rm(msi, { force: true }).catch(() => {});
  if (!libreOfficePath()) throw new Error('LibreOffice didn’t finish installing. Try again, or install it from libreoffice.org.');
  return libreOfficePath();
}

/* ---------- Pandoc ---------- */
function pandocPath() {
  return findFile(U.enginePath('pandoc'), U.isWin ? /^pandoc\.exe$/i : /^pandoc$/) || (U.isWin ? null : ['/usr/bin/pandoc', '/usr/local/bin/pandoc'].find((p) => fs.existsSync(p)) || null);
}
async function installPandoc(onProgress, signal) {
  const pat = U.isWin ? /windows-x86_64\.zip$/ : process.platform === 'darwin' ? /(arm64|x86_64)-macOS\.zip$/ : /linux-amd64\.tar\.gz$/;
  const a = await githubAsset('jgm/pandoc', pat);
  const file = path.join(U.cfg.tmp, a.name);
  await download(a.url, file, (f, l) => onProgress?.(f * 0.9, `Downloading Pandoc ${a.tag} · ${l}`), signal);
  await fsp.rm(U.enginePath('pandoc'), { recursive: true, force: true });
  await unpack(file, U.enginePath('pandoc'));
  fsp.rm(file, { force: true }).catch(() => {});
  const p = pandocPath();
  if (p && !U.isWin) await fsp.chmod(p, 0o755);
  return p;
}

/* ---------- Real-ESRGAN (AI upscaling, ncnn + Vulkan) ---------- */
function realesrganPath() {
  return findFile(U.enginePath('realesrgan'), U.isWin ? /^realesrgan-ncnn-vulkan\.exe$/i : /^realesrgan-ncnn-vulkan$/);
}
async function installRealesrgan(onProgress, signal) {
  const pat = U.isWin ? /windows\.zip$/ : process.platform === 'darwin' ? /macos\.zip$/ : /ubuntu\.zip$/;
  const a = await githubAsset('xinntao/Real-ESRGAN', pat, 'v0.2.5.0');
  const file = path.join(U.cfg.tmp, a.name);
  await download(a.url, file, (f, l) => onProgress?.(f * 0.9, `Downloading Real-ESRGAN · ${l}`), signal);
  await fsp.rm(U.enginePath('realesrgan'), { recursive: true, force: true });
  await unpack(file, U.enginePath('realesrgan'));
  fsp.rm(file, { force: true }).catch(() => {});
  const p = realesrganPath();
  if (p && !U.isWin) await fsp.chmod(p, 0o755);
  return p;
}

function status() {
  return {
    libreoffice: { installed: !!libreOfficePath(), path: libreOfficePath() },
    pandoc: { installed: !!pandocPath(), path: pandocPath() },
    realesrgan: { installed: !!realesrganPath(), path: realesrganPath() },
  };
}
const INSTALLERS = { libreoffice: installLibreOffice, pandoc: installPandoc, realesrgan: installRealesrgan };
async function uninstall(name) {
  if (name === 'libreoffice') throw new Error('Remove LibreOffice from Windows Settings › Apps.');
  await fsp.rm(U.enginePath(name), { recursive: true, force: true });
}
function missing(engine, why) {
  const names = { libreoffice: 'LibreOffice', pandoc: 'Pandoc', realesrgan: 'the AI upscaler' };
  const e = new Error(`${why} Install ${names[engine]} (free) from Settings › Engines, then try again.`);
  e.code = 'ENGINE_MISSING';
  e.engine = engine;
  return e;
}

module.exports = { download, githubAsset, unpack, findFile, libreOfficePath, installLibreOffice, pandocPath, installPandoc, realesrganPath, installRealesrgan, status, INSTALLERS, uninstall, missing };
