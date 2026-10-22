const api = window.limeCraft;
const info = await api.info();
const frame = document.getElementById('app'), toast = document.querySelector('.toast');
let toastT = null, shown = null;
document.title = info.fileName ? `${info.fileName} — ${info.name}` : info.name;
document.querySelector('.wait p').textContent = `Opening ${info.name}…`;

function tell(r) {
  if (!r) return;
  shown = r.path || null;
  toast.classList.toggle('bad', !r.path);
  toast.querySelector('span').textContent = r.path ? `Saved ${r.path.split(/[\\/]/).pop()}` : r.error;
  toast.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { toast.hidden = true; }, 5000);
}
toast.querySelector('button').addEventListener('click', () => { if (shown) api.show(shown); toast.hidden = true; });
api.onSaved(tell);

const fileBytes = async () => { const b = await api.read(); return b ? new Uint8Array(b) : null; };
// A file opens into an empty app rather than beside its sample document (SoundCraft's flag is ?empty, DeckCraft's ?blank).
const query = info.bridge ? '?host=parent' : info.empty && info.file ? `?${info.empty === true ? 'empty' : info.empty}` : '';
frame.src = `app/index.html${query}`;

window.addEventListener('message', async (e) => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
  const d = e.data || {}, type = String(d.type || '');
  if (!type.startsWith(`${info.id}:`)) return;
  const kind = type.slice(info.id.length + 1);
  if (kind === 'ready') {
    if (info.file) { const bytes = await fileBytes(); if (bytes) frame.contentWindow.postMessage({ type: `${info.id}:open`, name: info.fileName, bytes }, location.origin, [bytes.buffer]); }
    document.body.dataset.state = 'ready';
  } else if (kind === 'save') {
    try { tell(await api.save(d.name, new Uint8Array(d.bytes))); } catch (err) { tell({ error: `Couldn’t save ${d.name}` }); }
  } else if (kind === 'dirty') api.dirty(!!d.dirty);
  else if (kind === 'failed') document.body.dataset.state = 'failed';
});

if (!info.bridge) {
  const t0 = Date.now();
  const drop = async () => {
    const w = frame.contentWindow, canvas = w?.document?.querySelector('canvas');
    if (!canvas || !w.wasmBindings || w.document.querySelector('[id$="_loading"]') || Date.now() - t0 < 1500) { if (Date.now() - t0 < 60000) setTimeout(drop, 250); else document.body.dataset.state = 'failed'; return; }
    document.body.dataset.state = 'ready';
    const bytes = info.file && (await fileBytes());
    if (!bytes) return;
    const dt = new w.DataTransfer();
    dt.items.add(new w.File([bytes], info.fileName));
    const r = canvas.getBoundingClientRect(), at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, dataTransfer: dt };
    for (const t of ['dragenter', 'dragover', 'drop']) canvas.dispatchEvent(new w.DragEvent(t, at));
  };
  frame.addEventListener('load', () => setTimeout(drop, 300), { once: true });
}
