'use strict';
// The seven ArtCraft Crafting Apps (MIT OR Apache-2.0, github.com/storytold). Clementine installs the official
// portable builds on demand, keeps them updated, and opens your files in them. Nothing is modified or rebranded.
const { spawn } = require('child_process');
const U = require('./engines/util');
const OE = require('./engines/engines-optional');
const { fs, fsp, path } = U;

const APPS = [
  { id: 'photocraft', name: 'PhotoCraft', role: 'Image editor', desc: 'Layers, masks, adjustment layers, type, brushes and real PSD files.', icon: 'brush', opens: ['psd', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'bmp', 'gif'], groups: ['image'] },
  { id: 'vectorcraft', name: 'VectorCraft', role: 'Vector illustration', desc: 'Paths, shapes, type and artboards for logos and illustration.', icon: 'vector', opens: ['svg', 'ai', 'eps', 'pdf'], groups: ['vector'] },
  { id: 'filmcraft', name: 'FilmCraft', role: 'Video editor', desc: 'Timeline editing, colour grading and sound.', icon: 'film', opens: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'mp3', 'wav'], groups: ['video'] },
  { id: 'lightcraft', name: 'LightCraft', role: 'Photo library & RAW', desc: 'Organise photos and develop camera RAW files.', icon: 'camera', opens: ['dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2', 'jpg', 'jpeg', 'heic'], groups: ['raw'] },
  { id: 'pdfcraft', name: 'PdfCraft', role: 'PDF reader & organiser', desc: 'Read, organise and protect PDFs.', icon: 'pdf', opens: ['pdf'], groups: ['pdf'] },
  { id: 'effectcraft', name: 'EffectCraft', role: 'Motion graphics & VFX', desc: 'Compositing, motion graphics and visual effects.', icon: 'sparkle', opens: ['mp4', 'mov', 'png', 'json'], groups: [] },
  { id: 'designcraft', name: 'DesignCraft', role: 'Page layout', desc: 'Layout and publishing for print and digital.', icon: 'grid', opens: ['idml', 'pdf'], groups: [] },
];
const REPO = (id) => `storytold/${id}`;
const dirOf = (id) => path.join(U.cfg.user, 'studio', id);
const metaOf = (id) => path.join(dirOf(id), '.clementine.json');

function assetPattern() {
  if (process.platform === 'win32') return process.arch === 'arm64' ? /windows-arm64-portable\.zip$/ : /windows-x64-portable\.zip$/;
  if (process.platform === 'darwin') return /macos.*\.(zip|tar\.gz)$/;
  return /linux-x86_64\.tar\.gz$|linux-x64\.tar\.gz$/;
}
function exeOf(id) {
  const re = process.platform === 'win32' ? new RegExp(`^${id}\\.exe$`, 'i') : new RegExp(`^${id}$`, 'i');
  return OE.findFile(dirOf(id), re, 5);
}
function readMeta(id) { try { return JSON.parse(fs.readFileSync(metaOf(id), 'utf8')); } catch (_) { return null; } }

function list() {
  return APPS.map((a) => {
    const meta = readMeta(a.id);
    const exe = meta ? exeOf(a.id) : null;
    return { ...a, installed: !!exe, version: meta?.tag || null, checkedAt: meta?.checkedAt || 0, repo: `https://github.com/${REPO(a.id)}` };
  });
}
async function latest(id) {
  return OE.githubAsset(REPO(id), assetPattern());
}
async function install(id, onProgress, signal) {
  const app = APPS.find((a) => a.id === id);
  if (!app) throw new Error('Unknown app.');
  onProgress?.(0.02, 'Finding the latest release');
  const asset = await latest(id);
  const tmpFile = path.join(U.cfg.tmp, asset.name);
  await OE.download(asset.url, tmpFile, (f, l) => onProgress?.(0.05 + f * 0.8, `Downloading ${app.name} ${asset.tag} · ${l}`), signal);
  onProgress?.(0.9, 'Unpacking');
  const target = dirOf(id);
  const staging = `${target}.new`;
  await fsp.rm(staging, { recursive: true, force: true });
  await OE.unpack(tmpFile, staging);
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.rename(staging, target);
  await fsp.writeFile(metaOf(id), JSON.stringify({ tag: asset.tag, installedAt: Date.now(), checkedAt: Date.now() }));
  fsp.rm(tmpFile, { force: true }).catch(() => {});
  const exe = exeOf(id);
  if (!exe) throw new Error(`${app.name} downloaded, but its program file wasn’t found. Try again later.`);
  if (process.platform !== 'win32') await fsp.chmod(exe, 0o755);
  onProgress?.(1, `${app.name} ${asset.tag} is ready`);
  return list().find((a) => a.id === id);
}
async function checkUpdate(id) {
  const meta = readMeta(id);
  if (!meta) return { update: false };
  const a = await latest(id);
  meta.checkedAt = Date.now();
  await fsp.writeFile(metaOf(id), JSON.stringify(meta));
  return { update: a.tag !== meta.tag, current: meta.tag, latest: a.tag };
}
async function uninstall(id) {
  await fsp.rm(dirOf(id), { recursive: true, force: true });
  return list().find((a) => a.id === id);
}
function open(id, files = []) {
  const exe = exeOf(id);
  if (!exe) throw new Error('Install this app first.');
  const child = spawn(exe, files, { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return true;
}
/** Which Crafting App suits a file best (for the Actions wheel and “Open in…” buttons). */
function suggestFor(file) {
  const e = U.ext(file);
  const g = U.groupOf(file);
  const pref = { psd: 'photocraft', svg: 'vectorcraft', ai: 'vectorcraft', eps: 'vectorcraft', pdf: 'pdfcraft', idml: 'designcraft' }[e];
  if (pref) return APPS.find((a) => a.id === pref);
  return APPS.find((a) => a.groups.includes(g)) || APPS.find((a) => a.opens.includes(e)) || null;
}

module.exports = { APPS, list, install, uninstall, checkUpdate, open, suggestFor };
