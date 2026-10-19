// Helpers shared by the app window, the Explorer overlay and the drop dock.
export const api = window.clem;
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

const GROUPS = {
  pdf: 'pdf', jpg: 'image', jpeg: 'image', jfif: 'image', png: 'image', webp: 'image', gif: 'image', bmp: 'image', tif: 'image', tiff: 'image', avif: 'image', heic: 'image', heif: 'image', svg: 'image', ico: 'image', psd: 'image', tga: 'image', jxl: 'image',
  cr2: 'raw', cr3: 'raw', nef: 'raw', arw: 'raw', dng: 'raw', orf: 'raw', rw2: 'raw', raf: 'raw', srw: 'raw', pef: 'raw',
  mp4: 'video', m4v: 'video', mov: 'video', mkv: 'video', webm: 'video', avi: 'video', wmv: 'video', flv: 'video', mpg: 'video', mpeg: 'video', ts: 'video', mts: 'video', m2ts: 'video', '3gp': 'video', ogv: 'video', vob: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio', wma: 'audio', aiff: 'audio', aif: 'audio', amr: 'audio', ac3: 'audio', m4b: 'audio',
  docx: 'doc', doc: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc', md: 'doc', markdown: 'doc', html: 'doc', htm: 'doc', epub: 'doc', pages: 'doc',
  xlsx: 'sheet', xls: 'sheet', xlsm: 'sheet', ods: 'sheet', csv: 'sheet', tsv: 'sheet', numbers: 'sheet',
  pptx: 'slides', ppt: 'slides', odp: 'slides', key: 'slides',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive', xz: 'archive', zst: 'archive', iso: 'archive', cab: 'archive', wim: 'archive', dmg: 'archive', jar: 'archive', apk: 'archive', msi: 'archive',
  srt: 'subtitle', vtt: 'subtitle', ass: 'subtitle', ai: 'vector', eps: 'vector', emf: 'vector', wmf: 'vector',
};
export const extOf = (p) => { const m = /\.([^.\\/]+)$/.exec(p || ''); return m ? m[1].toLowerCase() : ''; };
export const nameOf = (p) => String(p || '').split(/[\\/]/).pop();
export const dirOf = (p) => String(p || '').replace(/[\\/][^\\/]*$/, '');
export const groupOf = (p) => GROUPS[extOf(p)] || (extOf(p) ? 'any' : 'folder');
export const GROUP_CAT = { pdf: 'pdf', image: 'image', raw: 'image', video: 'media', audio: 'media', doc: 'docs', sheet: 'docs', slides: 'docs', vector: 'docs', archive: 'archive', subtitle: 'media', any: 'utility', folder: 'archive' };
export const GROUP_ICON = { pdf: 'pdf', image: 'image', raw: 'camera', video: 'video', audio: 'music', doc: 'document', sheet: 'excel', slides: 'powerpoint', vector: 'vector', archive: 'zip', subtitle: 'captions', any: 'document', folder: 'folder' };

export const fmtBytes = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
export function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'Just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/* ---------- thumbnails ---------- */
const thumbCache = new Map();
export function thumbUrl(path, size = 160) {
  const key = `${path}|${size}`;
  if (!thumbCache.has(key)) {
    thumbCache.set(key, api.invoke('files:thumb', path, size).then((r) => (r?.png ? URL.createObjectURL(new Blob([r.png], { type: 'image/png' })) : null)).catch(() => null));
  }
  return thumbCache.get(key);
}
/** A square thumbnail element that fills itself in asynchronously. */
export function thumbEl(path, icon, size = 40) {
  const g = groupOf(path);
  const el = h(`<div class="thumb" data-cat="${GROUP_CAT[g]}" style="width:${size}px;height:${size}px">${['image', 'pdf', 'video', 'raw'].includes(g) ? `<span class="ext">${esc(extOf(path).toUpperCase().slice(0, 4))}</span>` : icon(GROUP_ICON[g])}</div>`);
  if (['image', 'pdf', 'video', 'raw'].includes(g)) {
    thumbUrl(path).then((u) => { if (u) el.innerHTML = `<img src="${u}" alt="">`; });
  }
  return el;
}

/* ---------- running things picked on the wheel ---------- */
export function defaultsFor(tool) {
  const o = {};
  for (const opt of tool?.options || []) o[opt.key] = Array.isArray(opt.default) ? [...opt.default] : opt.default;
  return o;
}
/** Runs a wheel pick. Returns { jobId } for background work, { navigate } when the tool needs input, or { message }. */
export async function runPick(item, files, catalog) {
  if (item.action) return { message: await api.invoke('wheel:action', item, files) };
  const tool = catalog.tools.find((t) => t.id === item.tool);
  if (!tool) return { message: 'That tool isn’t available.' };
  const needsInput = item.open || tool.editor || (tool.options || []).some((o) => o.required && !(item.opts || {})[o.key]);
  if (needsInput) return { navigate: { tool: tool.id, files, opts: item.opts || {} } };
  const jobId = await api.invoke('jobs:submit', { tool: tool.id, files, opts: { ...defaultsFor(tool), ...(item.opts || {}) } });
  return { jobId, tool };
}

/* ---------- drag-in helpers ---------- */
const MIME_EXT = [
  [/pdf/, 'pdf'], [/^image\/(svg)/, 'svg'], [/^image\//, 'png'], [/^video\//, 'mp4'], [/^audio\//, 'mp3'],
  [/wordprocessingml|msword|opendocument\.text|rtf/, 'docx'], [/spreadsheetml|ms-excel|opendocument\.spreadsheet|csv/, 'xlsx'],
  [/presentationml|ms-powerpoint|opendocument\.presentation/, 'pptx'], [/zip|rar|7z|tar|gzip|compressed/, 'zip'],
  [/markdown|text\/plain|html/, 'txt'],
];
/** Mid-drag the browser only reveals MIME types; turn them into stand-in names so the wheel can show likely options. */
export function guessFromDrag(dt) {
  const items = [...(dt?.items || [])].filter((i) => i.kind === 'file');
  if (!items.length) return [];
  return items.map((i, n) => {
    const hit = MIME_EXT.find(([re]) => re.test(i.type || ''));
    return `C:\\drag\\file${n}.${hit ? hit[1] : 'bin'}`;
  });
}
export function pathsFromDrop(dt) {
  return [...(dt?.files || [])].map((f) => api.pathFor(f)).filter(Boolean);
}
