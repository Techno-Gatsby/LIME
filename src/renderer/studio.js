import { $, $$, esc, h, nameOf, dirOf, sep, form, defaultsFor, clean } from './ui.js';

// The app editors: VectorCraft (Illustrator-like), DesignCraft (InDesign), EffectCraft (After Effects) and FilmCraft
// timelines (Premiere). One shell, like the PDF editor's, and a part for each app. Every change is made by the app's
// engine in the worker (src/main/studio.js) and becomes a step that can be undone.
const PT = 96 / 72;
// Strokes the app editors need beyond icons.js, drawn the same way (24×24, 1.7 px).
const MORE = {
  palette: 'M12 3a9 9 0 000 18c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6h1.9A4.8 4.8 0 0021 10.8C21 6.5 17 3 12 3zM7.5 12.5h.01M9 8h.01M13.5 6.8h.01M17 9.5h.01',
  arrange: 'M4 4v16M8 6h11v4H8zM8 14h7v4H8z',
  shapes: 'M4 13h7v7H4zM16.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM7.5 3l3.5 6H4z',
  artboard: 'M7 3v18M17 3v18M3 7h18M3 17h18',
  trace: 'M4 17l4.5-5 3.5 3.5 2.5-2.5L19 17M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4',
  play: 'M7.5 5.2v13.6a.6.6 0 00.9.5l10.8-6.8a.6.6 0 000-1L8.4 4.7a.6.6 0 00-.9.5z',
  pause: 'M8 5.5v13M16 5.5v13',
  scissors: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM8.2 7.6L20 19M8.2 16.4L20 5',
  shield: 'M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6zM9 12l2.2 2.2L15.5 10',
  frame: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 8h8v8H8z',
  speed: 'M12 21a8 8 0 100-16 8 8 0 000 16zM12 13l3.5-3.5M10 2h4',
  history: 'M3.5 12a8.5 8.5 0 102.5-6M3 4v4.5h4.5M12 8v4.5l3 2',
  eyeOff: 'M3 3l18 18M10.6 5.1A9.7 9.7 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6C4 8.4 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1.1M9.9 9.9a3 3 0 004.2 4.2',
  flipH: 'M12 3v18M9 7l-6 5 6 5zM15 7l6 5-6 5z',
  flipV: 'M3 12h18M7 9l5-6 5 6zM7 15l5 6 5-6z',
  rotL: 'M5 12a7 7 0 107-7H8M8 2L5 5l3 3',
  rotR: 'M19 12a7 7 0 11-7-7h4M16 2l3 3-3 3',
  toFront: 'M9 9h11v11H9zM4 15V4h11',
  toBack: 'M4 4h11v11H4zM9 20h11V9',
  alignL: 'M4 3v18M8 6h12v4H8zM8 14h7v4H8z',
  alignC: 'M12 3v18M6 6h12v4H6zM8.5 14h7v4h-7z',
  alignR: 'M20 3v18M4 6h12v4H4zM9 14h7v4H9z',
  alignT: 'M3 4h18M6 8h4v12H6zM14 8h4v7h-4z',
  alignM: 'M3 12h18M6 6h4v12H6zM14 8.5h4v7h-4z',
  alignB: 'M3 20h18M6 4h4v12H6zM14 9h4v7h-4z',
  distH: 'M4 3v18M20 3v18M9.5 7h5v10h-5z',
  distV: 'M3 4h18M3 20h18M7 9.5h10v5H7z',
  group: 'M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4M8 8h5v5H8zM11 11h5v5h-5z',
  ungroup: 'M5 5h7v7H5zM12 12h7v7h-7z',
  unite: 'M4 4h10v6h6v10H10v-6H4z',
  minus: 'M4 4h10v10H4zM14 10h6v10H10v-6',
  intersect: 'M4 4h10v10H4zM10 10h10v10H10zM10 10h4v4h-4z',
  exclude: 'M4 4h10v6h-4v4H4zM20 20H10v-6h4v-4h6z',
  divide: 'M4 4h10v10H4zM10 10h10v10H10zM10 10v4h4',
  outline: 'M5 7c4-4 10 4 14 0M5 12c4-4 10 4 14 0M5 17c4-4 10 4 14 0',
  simplify: 'M4 17c3-9 6-9 8-4s5 5 8-5',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 12h6M12 9v6',
  broom: 'M14 4l-3 7M7 11h8l2 9H5zM9 15v5M13 15v5',
  shadow: 'M4 4h11v11H4zM15 8h5v12H8v-5',
  textOutline: 'M5 6V4h14v2M12 4v16M9 20h6M3 3h18v18H3z',
  page: 'M7 3h7l5 5v13H7zM14 3v5h5',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  step: 'M6 5v14M18 5l-9 7 9 7z',
  stepF: 'M18 5v14M6 5l9 7-9 7z',
  start: 'M5 5v14M19 5l-9 7 9 7zM12 5v14',
  reverse: 'M8 7H5V4M5 7a8 8 0 0114 5M16 17h3v3M19 17a8 8 0 01-14-5',
  layer: 'M12 4l9 5-9 5-9-5zM3 14l9 5 9-5',
  title: 'M4 6h16v12H4zM8 10h8M10 10v5',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16.5 9a4 4 0 010 6M19 6.5a8 8 0 010 11',
  transition: 'M4 6h8v12H4zM12 6l8 12M20 6l-8 12',
  magic: 'M5 19L15 9M14 4v3M17.5 5.5l-2 2M19 9h-3M10 4.5l1 1.5',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 016.8-1.2',
  fx: 'M5 19L19 5M7 5v4M5 7h4M17 15v4M15 17h4',
};
const svg = (d, size) => `<svg class="ic ${size || ''}" viewBox="0 0 24 24" width="${size === 'sm' ? 16 : size === 'lg' ? 28 : 20}" height="${size === 'sm' ? 16 : size === 'lg' ? 28 : 20}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const COLORS = ['#000000', '#ffffff', '#d13438', '#ffb900', '#86c23a', '#107c10', '#0f6cbd', '#5c2e91'];
const plural = (n, w, many) => `${n} ${n === 1 ? w : many || `${w}s`}`;
const r1 = (n) => Math.round(Number(n) * 10) / 10;
const fmtTime = (s, fps) => { const t = Math.max(0, s), m = Math.floor(t / 60), sec = t - m * 60; return fps ? `${m}:${String(Math.floor(sec)).padStart(2, '0')}:${String(Math.floor((sec % 1) * fps + 1e-6)).padStart(2, '0')}` : `${m}:${sec.toFixed(1).padStart(4, '0')}`; };
const mediaUrl = (p) => `media://file/${encodeURIComponent(p)}`;

export function openEditor(view, { file, mode }, ctx) {
  const { toast, api, go } = ctx;
  ctx.onClose?.(close);
  const app = String(mode || '').split(':')[1];
  const icon = (n, size = '') => (MORE[n] ? svg(MORE[n], size) : ctx.icon(n, size));
  const call = (m, ...a) => api.invoke('edit:call', 'studio', m, ...a);
  if (!document.querySelector('link[href="studio.css"]')) document.head.append(h('<link rel="stylesheet" href="studio.css">'));
  const st = { sess: null, model: null, tool: null, busy: false, savePath: null, families: [], formats: [], tools: null, toolOpts: {}, disposed: false };
  let root, stageWrap, propsEl, sideEl, statusEl, bodyEl;

  // ── Building blocks for the properties panel ──────────────────────────────────────────────────────────────────
  const paintRange = (r) => r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`);
  const ui = {
    head: (t, sub) => h(`<h3>${esc(t)}${sub ? ` <span class="sub">${esc(sub)}</span>` : ''}</h3>`),
    tip: (t) => h(`<p class="tip">${esc(t)}</p>`),
    label: (t) => h(`<div class="label">${esc(t)}</div>`),
    group: (title, ...els) => { const g = h(`<section class="sgroup">${title ? `<div class="label">${esc(title)}</div>` : ''}</section>`); g.append(...els.flat().filter(Boolean)); return g; },
    btn: (label, ic, fn, o = {}) => {
      const b = h(`<button class="btn${o.primary ? ' primary' : ''}${o.danger ? ' danger' : ''}${o.subtle ? ' subtle' : ''}" ${o.disabled ? 'disabled' : ''} title="${esc(o.title || label)}" ${o.data ? `data-x="${esc(o.data)}"` : ''}>${ic ? icon(ic, 'sm') : ''}${esc(label)}</button>`);
      b.addEventListener('click', fn);
      return b;
    },
    row: (...els) => { const d = h('<div class="srow"></div>'); d.append(...els.flat().filter(Boolean)); return d; },
    // A grid of actions, each an icon over a short label.
    tiles: (items) => {
      const d = h(`<div class="tiles">${items.map(([id, ic, label, title, off]) => `<button class="tb" data-t="${esc(id)}" title="${esc(title || label)}" ${off ? 'disabled' : ''}>${icon(ic)}<span class="lbl">${esc(label)}</span></button>`).join('')}</div>`);
      d.addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b && !b.disabled) items.find((x) => x[0] === b.dataset.t)?.[5]?.(); });
      return d;
    },
    seg: (items, val, fn, cls = '') => {
      const d = h(`<div class="seg ${cls}">${items.map(([id, label, ic]) => `<button class="tb" data-v="${esc(id)}" aria-pressed="${String(id) === String(val)}" title="${esc(label)}">${ic ? icon(ic) : ''}${label && (!ic || cls.includes('full')) ? `<span class="lbl">${esc(label)}</span>` : ''}</button>`).join('')}</div>`);
      d.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; $$('[data-v]', d).forEach((x) => x.setAttribute('aria-pressed', x === b)); fn(b.dataset.v); });
      return d;
    },
    swatches: (list, val, fn, o = {}) => {
      const all = [...(o.none ? ['none'] : []), ...list], hex = /^#[0-9a-f]{6}$/i.test(val), other = hex && !list.some((c) => c.toLowerCase() === val.toLowerCase());
      const el = h(`<div class="swatches">${all.map((c) => `<button style="background:${c}" data-c="${c}" aria-label="${c === 'none' ? 'None' : c}" title="${c === 'none' ? 'None' : c}" aria-pressed="${String(c).toLowerCase() === String(val || 'none').toLowerCase()}"></button>`).join('')}<label class="custom${other ? ' cur' : ''}" title="${other ? esc(val) : 'Custom colour'}" ${other ? `style="background:${val}"` : ''}><input type="color" value="${hex ? val : '#000000'}" aria-label="Custom colour"></label></div>`);
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) fn(b.dataset.c === 'none' ? null : b.dataset.c); });
      $('input', el).addEventListener('change', (e) => fn(e.target.value));
      return el;
    },
    slider: (label, min, max, step, val, fmt, commit, live) => {
      const f = h(`<div class="field"><label class="label">${esc(label)}</label><div class="range"><input type="range" min="${min}" max="${max}" step="${step}" value="${val}"><output>${esc(fmt(val))}</output></div></div>`);
      const r = $('input', f);
      paintRange(r);
      r.addEventListener('input', () => { $('output', f).textContent = fmt(Number(r.value)); paintRange(r); live?.(Number(r.value)); });
      r.addEventListener('change', () => commit(Number(r.value)));
      return f;
    },
    num: (label, val, commit, o = {}) => {
      const f = h(`<div class="field"><label class="label">${esc(label)}</label><div class="unit"><input class="input" type="number" value="${esc(val ?? '')}" ${o.min != null ? `min="${o.min}"` : ''} ${o.max != null ? `max="${o.max}"` : ''} step="${o.step ?? 'any'}" placeholder="${esc(o.placeholder || '')}" data-k="${esc(o.key || '')}">${o.unit ? `<span>${esc(o.unit)}</span>` : ''}</div></div>`);
      const i = $('input', f);
      if (commit) { i.addEventListener('change', () => commit(i.value === '' ? null : Number(i.value))); i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); }); }
      return f;
    },
    input: (label, val, commit, o = {}) => {
      const f = h(`<div class="field">${label ? `<label class="label">${esc(label)}</label>` : ''}${o.area ? `<textarea class="input" rows="${o.rows || 4}" placeholder="${esc(o.placeholder || '')}" spellcheck="true"></textarea>` : `<input class="input" type="text" placeholder="${esc(o.placeholder || '')}" spellcheck="false">`}</div>`);
      const i = $('.input', f);
      i.value = val ?? '';
      if (o.key) i.dataset.k = o.key;
      if (commit) { i.addEventListener('change', () => commit(i.value)); if (!o.area) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); }); }
      return f;
    },
    select: (label, options, val, fn, o = {}) => {
      const f = h(`<div class="field">${label ? `<label class="label">${esc(label)}</label>` : ''}<select class="input" ${o.key ? `data-k="${esc(o.key)}"` : ''}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`);
      $('select', f).addEventListener('change', (e) => fn(e.target.value));
      return f;
    },
    toggle: (label, val, fn) => { const el = h(`<label class="switch"><span>${esc(label)}</span><input type="checkbox" ${val ? 'checked' : ''}></label>`); $('input', el).addEventListener('change', (e) => fn(e.target.checked)); return el; },
    list: (items, fn, o = {}) => {
      const el = h(`<div class="slist">${items.map((it, i) => `<button class="sitem ${it.on ? 'on' : ''} ${it.warn ? 'warn' : ''}" data-i="${i}" title="${esc(it.title || it.text)}">${it.swatch ? `<i class="dot" style="background:${esc(it.swatch)}"></i>` : it.icon ? icon(it.icon, 'sm') : ''}<span class="t">${esc(it.text)}</span>${it.meta ? `<span class="m">${esc(it.meta)}</span>` : ''}</button>`).join('') || `<p class="tip">${esc(o.empty || 'Nothing here.')}</p>`}</div>`);
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) fn(items[Number(b.dataset.i)], e); });
      return el;
    },
    colorpick: (val, fn, label) => { const el = h(`<label class="colorpick${label ? ' wide' : ''}" title="${esc(label || 'Colour')}"><input type="color" value="${esc(val)}">${label ? `<span>${esc(val)}</span>` : ''}</label>`); $('input', el).addEventListener('change', (e) => fn(e.target.value)); return el; },
    // Each colour of the work: click to swap it for another everywhere it is used.
    recolor: (colors, fn) => {
      const el = h(`<div class="recolor">${colors.map((c, i) => `<label class="rc" title="${esc(c.title || c.hex)}"><i style="background:${esc(c.hex)}"></i><span class="t">${esc(c.hex)}</span><span class="m">${esc(c.meta || '')}</span><input type="color" value="${esc(c.hex)}" data-i="${i}" aria-label="Change ${esc(c.hex)}"></label>`).join('') || '<p class="tip">No colours.</p>'}</div>`);
      el.addEventListener('change', (e) => { const i = e.target.dataset.i; if (i != null && e.target.value.toLowerCase() !== colors[i].hex.toLowerCase()) fn(colors[i], e.target.value); });
      return el;
    },
  };

  // ── Talking to the worker ────────────────────────────────────────────────────────────────────────────────────
  function tip(msg, keep) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg || '';
    clearTimeout(tip.t);
    if (msg && !keep) tip.t = setTimeout(() => { statusEl.hidden = true; }, 4500);
  }
  async function busy(label, fn) {
    if (st.busy) return null;
    st.busy = true;
    root.classList.add('working');
    tip(label, true);
    try { return await fn(); }
    catch (e) { toast(clean(e), { type: 'error' }); return null; }
    finally { st.busy = false; root.classList.remove('working'); tip(null); }
  }
  function setSess(s) {
    const was = st.sess?.rev;
    st.sess = s;
    st.model = s.model;
    A.sync?.(s, was !== s.rev);
    refresh();
  }
  // Applies one change through the app's engine; it becomes a step in the history.
  async function act(label, op, params = {}) {
    const s = await busy(`${label}…`, () => call('apply', st.sess.id, op, params, label));
    if (!s) return null;
    if (s.unchanged) { toast(s.note || 'Nothing changed.'); return s; }
    setSess(s);
    if (s.note) toast(s.note, { type: 'success' });
    return s;
  }
  const query = (what, params) => call('query', st.sess.id, what, params);
  function refresh() {
    A.stage.refresh?.();
    A.side?.refresh?.();
    drawProps();
    updateChrome();
  }
  function drawProps() {
    if (!st.model) return;
    const keepScroll = propsEl.scrollTop;
    propsEl.innerHTML = '';
    const els = (st.tool === 'export' ? exportPanel() : A.panel(st.tool)) || [];
    propsEl.append(...els.flat().filter(Boolean));
    propsEl.querySelectorAll('input[type=range]').forEach(paintRange);
    propsEl.scrollTop = keepScroll;
  }
  function updateChrome() {
    const s = st.sess;
    $('.dirty', root).hidden = !s?.dirty;
    $('[data-a=undo]', root).disabled = !s?.canUndo;
    $('[data-a=redo]', root).disabled = !s?.canRedo;
    $('[data-a=history]', root).disabled = !s || (s.labels || []).length < 2;
  }
  function selectTool(t) {
    if (!A.tools.flatMap(([, ids]) => ids).some((x) => x[0] === t)) return;
    st.tool = t;
    $$('[data-tool]', root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === t));
    root.dataset.on = t;
    A.onTool?.(t);
    const info = A.tools.flatMap(([, ids]) => ids).find((x) => x[0] === t);
    tip(info?.[3]);
    drawProps();
  }

  // ── Export panel: Save a copy in another format, and the app's one-click actions from the wheel ──────────────
  function exportPanel() {
    const label = A.tools.flatMap(([, ids]) => ids).find((x) => x[0] === 'export')?.[2] || 'Export';
    const out = [ui.head(label), ui.group('Save a copy as', ui.list(st.formats.map(([ext, label]) => ({ text: label, meta: `.${ext}`, icon: 'save' })), (it) => saveAs(st.formats.find(([, l]) => l === it.text)[0])))];
    if (!st.tools) {
      out.push(ui.tip('Loading actions…'));
      call('toolList', st.sess.id).then((list) => { st.tools = list || []; if (st.tool === 'export') drawProps(); }).catch(() => { st.tools = []; });
      return out;
    }
    if (st.tools.length) {
      const g = ui.group(`${A.name} actions`);
      for (const t of st.tools) {
        const opts = st.toolOpts[t.id] ||= defaultsFor(t);
        const card = h(`<div class="action"><div class="at"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></div></div>`);
        if (t.options.length) card.append(form(t, opts, () => {}));
        const res = h('<div class="ares" hidden></div>');
        card.append(ui.row(ui.btn(t.save === 'none' ? 'Check' : 'Run', t.save === 'none' ? 'info' : 'sparkle', () => runTool(t, opts, res), { primary: false })), res);
        g.append(card);
      }
      out.push(g, ui.tip(`What these make is saved next to ${nameOf(file)}, from the file as it is now with your changes.`));
    }
    return out;
  }
  async function runTool(t, opts, res) {
    const r = await busy(`${t.name}…`, () => call('runTool', st.sess.id, t.id, opts));
    if (!r) return;
    const made = r.find((x) => x.path);
    res.hidden = false;
    res.innerHTML = `${r.map((x) => `${x.note ? `<p>${esc(x.note)}</p>` : ''}${x.text ? `<pre>${esc(x.text)}</pre>` : ''}`).join('')}${made ? `<p class="faint">${esc(nameOf(made.path))}</p>` : ''}`;
    if (made) {
      res.append(ui.row(ui.btn('Open', 'open', () => api.invoke('shell:open', made.path), { subtle: true }), ui.btn('Show in folder', 'folder', () => api.invoke('shell:show', made.path), { subtle: true })));
      toast(`Saved ${nameOf(made.path)}`, { type: 'success', actions: [{ label: 'Show in folder', fn: () => api.invoke('shell:show', made.path) }] });
    }
  }

  // ── Saving ────────────────────────────────────────────────────────────────────────────────────────────────────
  const base = nameOf(file).replace(/\.[^.]+$/, '');
  async function save(as) {
    if (as) return saveAs();
    const r = await busy('Saving…', () => call('save', st.sess.id, st.savePath || null));
    if (!r) return false;
    st.savePath = r.path;
    setSess(r);
    toast(`Saved ${nameOf(r.path)}`, { type: 'success', actions: [{ label: 'Open', fn: () => api.invoke('shell:open', r.path) }, { label: 'Show in folder', fn: () => api.invoke('shell:show', r.path) }] });
    return true;
  }
  // Save as…: pick a format (and, for some, how), then where.
  function saveAs(pre) {
    const OPTS = A.saveOptions || {};
    let ext = pre || st.sess.saveExt, opts = {};
    const s = h(`<div class="scrim"><div class="dialog saveas"><div class="body"><h2>Save as</h2><div class="fmts">${st.formats.map(([e, l]) => `<button class="fmt" data-e="${esc(e)}" aria-pressed="${e === ext}"><b>${esc(l)}</b><span>.${esc(e)}</span></button>`).join('')}</div><div class="fopts"></div></div><div class="foot"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">Choose where…</button></div></div></div>`);
    const drawOpts = () => { const box = $('.fopts', s); box.innerHTML = ''; opts = {}; for (const o of OPTS[ext] || []) { opts[o.key] = o.def; box.append(o.kind === 'toggle' ? ui.toggle(o.label, o.def, (v) => { opts[o.key] = v; }) : ui.seg(o.choices, o.def, (v) => { opts[o.key] = v; }, 'full')); } };
    drawOpts();
    document.body.append(s);
    s.addEventListener('click', async (e) => {
      const f = e.target.closest('[data-e]');
      if (f) { ext = f.dataset.e; $$('[data-e]', s).forEach((x) => x.setAttribute('aria-pressed', x === f)); drawOpts(); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'no' || e.target === s) s.remove();
      if (a !== 'ok') return;
      s.remove();
      const label = st.formats.find(([x]) => x === ext)?.[1] || ext.toUpperCase();
      const target = await api.invoke('dialog:save', { defaultPath: `${dirOf(file)}${sep}${base}${ext === st.sess.ext ? ' (edited)' : ''}.${ext}`, filters: [{ name: label, extensions: [ext] }] });
      if (!target) return;
      const r = await busy(`Saving ${label}…`, () => call('save', st.sess.id, target, opts));
      if (!r) return;
      setSess(r);
      if (ext === st.sess.saveExt) st.savePath = r.path;
      toast(`Saved ${nameOf(r.path)}`, { type: 'success', actions: [{ label: 'Open', fn: () => api.invoke('shell:open', r.path) }, { label: 'Show in folder', fn: () => api.invoke('shell:show', r.path) }] });
    });
  }
  async function undo() { const s = await busy('Undoing…', () => call('undo', st.sess.id)); if (s) setSess(s); }
  async function redo() { const s = await busy('Redoing…', () => call('redo', st.sess.id)); if (s) setSess(s); }
  function history() {
    const old = $('.hist', root);
    if (old) { old.remove(); return; }
    const labels = st.sess.labels || [];
    const pop = h(`<div class="hist" role="menu">${labels.map((l, i) => `<button data-i="${i}" class="${i === st.sess.version ? 'cur' : i > st.sess.version ? 'future' : ''}">${icon(i ? 'history' : 'open', 'sm')}<span>${esc(l)}</span></button>`).join('')}</div>`);
    const b = $('[data-a=history]', root).getBoundingClientRect();
    pop.style.left = `${b.left}px`;
    pop.style.top = `${b.bottom + 6}px`;
    root.append(pop);
    pop.addEventListener('click', async (e) => { const it = e.target.closest('[data-i]'); if (!it) return; pop.remove(); const s = await busy('Going back…', () => call('goto', st.sess.id, Number(it.dataset.i))); if (s) setSess(s); });
    setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  }
  async function close() {
    if (st.sess?.dirty) {
      const choice = await confirm3(`Save changes to ${nameOf(file)}?`, 'Your edits will be lost if you don’t save them.');
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await save(false))) return;
    }
    go();
  }
  function confirm3(title, text) {
    return new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>${esc(title)}</h2><p class="muted" style="margin:0">${esc(text)}</p></div><div class="foot"><button class="btn primary" data-a="save">Save</button><button class="btn" data-a="discard">Don’t save</button><button class="btn" data-a="cancel">Cancel</button></div></div></div>`);
      document.body.append(s);
      $('[data-a=save]', s).focus();
      s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { s.remove(); resolve(a); } });
    });
  }
  // A small form in a dialog, e.g. find and replace. Resolves with the values, or null.
  function ask(title, fields, okLabel = 'OK') {
    return new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>${esc(title)}</h2></div><div class="foot"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">${esc(okLabel)}</button></div></div></div>`);
      const vals = {};
      for (const f of fields) {
        vals[f.key] = f.value ?? (f.kind === 'check' ? false : '');
        const el = f.kind === 'check' ? h(`<label class="row chk"><input type="checkbox" ${f.value ? 'checked' : ''}>${esc(f.label)}</label>`) : h(`<input class="input" placeholder="${esc(f.label)}" value="${esc(f.value || '')}">`);
        const inp = el.tagName === 'INPUT' ? el : $('input', el);
        inp.dataset.k = f.key;
        inp.addEventListener('input', () => { vals[f.key] = f.kind === 'check' ? inp.checked : inp.value; });
        inp.addEventListener('change', () => { vals[f.key] = f.kind === 'check' ? inp.checked : inp.value; });
        $('.body', s).append(el);
      }
      document.body.append(s);
      ($('.body input:not([type=checkbox])', s) || $('[data-a=ok]', s)).focus();
      const done = (ok) => { s.remove(); resolve(ok ? vals : null); };
      s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
      s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) done(a === 'ok'); });
    });
  }

  const E = { st, ui, icon, call, api, toast, tip, busy, act, query, setSess, refresh, drawProps, selectTool, ask, file, app, saveAs, root: () => root, side: () => sideEl, wrap: () => stageWrap };
  const A = (APPS[app] || APPS.vectorcraft)(E);

  root = h(`<div class="editor studio s-${esc(app)}" data-on="">
    <header class="ed-head">
      <div class="topbar">
        <button class="tb icon" data-a="close" title="Close">${icon('back')}</button>
        <div class="doc">${icon(A.icon)}<b title="${esc(file)}">${esc(nameOf(file))}</b><span class="appname">${esc(A.name)}</span><span class="dirty" hidden>Unsaved</span></div>
        <div class="seg"><button class="tb icon" data-a="undo" title="Undo (Ctrl+Z)" disabled>${icon('undo')}</button><button class="tb icon" data-a="redo" title="Redo (Ctrl+Y)" disabled>${icon('redo')}</button><button class="tb icon" data-a="history" title="History" disabled>${icon('history')}</button></div>
        <div class="grow"></div>
        ${A.find ? `<div class="search">${icon('search', 'sm')}<input class="find" type="search" placeholder="${esc(A.find)}" aria-label="${esc(A.find)}"><button class="tb icon" data-a="replace" title="Find and replace (Ctrl H)">${icon('again', 'sm')}</button></div>` : ''}
        ${A.zoom ? `<div class="seg zoombar"><button class="tb icon" data-a="zoomout" title="Zoom out (Ctrl −)">${icon('zoomOut', 'sm')}</button><select class="zoom" title="Zoom" aria-label="Zoom"></select><button class="tb icon" data-a="zoomin" title="Zoom in (Ctrl +)">${icon('zoomIn', 'sm')}</button><button class="tb icon" data-a="fit" title="Fit width (Ctrl 0)">${icon('fit', 'sm')}</button></div>` : ''}
        ${A.sideTitle ? `<button class="tb icon" data-a="side" title="${esc(A.sideTitle)} panel" aria-pressed="true">${icon('grid')}</button>` : ''}
        <button class="btn" data-a="saveas">Save as…</button>
        <button class="btn primary" data-a="save">${icon('save', 'sm')}Save</button>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Tools">
        ${A.tools.map(([name, ids], gi) => `<div class="tgroup${gi ? ' opt' : ''}" role="group" aria-label="${esc(name)}">${ids.map(([id, ic, label, t]) => `<button class="tool" data-tool="${esc(id)}" aria-pressed="false" title="${esc(`${label}: ${t}`)}">${icon(ic)}<span class="lbl">${esc(label)}</span></button>`).join('')}</div>`).join('')}
      </div>
    </header>
    <div class="ed-body${A.sideTitle ? '' : ' no-thumbs'}">
      <aside class="thumbs" aria-label="${esc(A.sideTitle || '')}"></aside>
      <div class="stagewrap"><div class="ed-status" hidden></div></div>
      <aside class="props" aria-label="Properties"></aside>
    </div>
  </div>`);
  view.append(root);
  stageWrap = $('.stagewrap', root); propsEl = $('.props', root); sideEl = $('.thumbs', root); statusEl = $('.ed-status', root); bodyEl = $('.ed-body', root);
  stageWrap.prepend(A.stage.el);
  if (A.side) sideEl.append(A.side.el);

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]');
    if (t) { selectTool(t.dataset.tool); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || !st.sess) return;
    if (a === 'close') close();
    if (a === 'undo') undo();
    if (a === 'redo') redo();
    if (a === 'history') history();
    if (a === 'save') save(false);
    if (a === 'saveas') save(true);
    if (a === 'replace') A.replace?.();
    if (a === 'side') { const on = bodyEl.classList.toggle('no-thumbs'); e.target.closest('button').setAttribute('aria-pressed', !on); }
    A.stage.command?.(a);
  });
  $('.find', root)?.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && st.sess) A.find && A.onFind?.(e.target.value.trim(), e.shiftKey); });
  $('.zoom', root)?.addEventListener('change', (e) => A.stage.command?.('zoomto', e.target.value));
  const onKey = (e) => {
    if (document.querySelector('.scrim') || !st.sess) return;
    const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (c && k === 's') { e.preventDefault(); save(e.shiftKey); return; }
    if (e.target.matches?.('input, textarea, select, [contenteditable]')) return;
    if (c && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (c && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); redo(); }
    else if (c && k === 'f' && A.find) { e.preventDefault(); $('.find', root).focus(); }
    else if (c && k === 'h' && A.replace) { e.preventDefault(); A.replace(); }
    else if (A.keys?.(e, c)) e.preventDefault();
    else if (!c && !e.altKey && A.shortcuts?.[k]) selectTool(A.shortcuts[k]);
  };
  document.addEventListener('keydown', onKey);

  (async () => {
    try {
      const s = await call('open', file, app);
      if (st.disposed) { call('close', s.id).catch(() => {}); return; }
      st.families = s.families || [];
      st.formats = s.formats || [];
      st.looks = s.looks || [];
      setSess(s);
      A.ready?.();
      selectTool(A.tools[0][1][0][0]);
    } catch (e) {
      toast(clean(e), { type: 'error' });
      go();
    }
  })();

  const dispose = () => {
    if (st.disposed) return;
    st.disposed = true;
    document.removeEventListener('keydown', onKey);
    A.dispose?.();
    if (st.sess) call('close', st.sess.id).catch(() => {});
  };
  // The working copies are thrown away when the window goes, however it is closed.
  window.addEventListener('pagehide', dispose);
  return dispose;
}

// Playback is a small video the app renders of the whole thing, once for each step. It is made while editing goes on;
// if there has been a change by the time it is ready, it isn't played.
async function prepare(E, el, state) {
  if (state.preparing) return null;
  const rev = E.st.sess.rev;
  state.preparing = true;
  el.classList.add('preparing');
  E.tip('Preparing playback…', true);
  const p = await E.call('preview', E.st.sess.id).catch((e) => { E.toast(clean(e), { type: 'error' }); return null; });
  state.preparing = false;
  el.classList.remove('preparing');
  E.tip(null);
  if (!p || rev !== E.st.sess?.rev) return null;
  state.vid = { rev, path: p };
  return p;
}

// ── Pages and artboards: a scrolling column of pages drawn by the app, with zoom, as in the PDF editor ─────────────
function pageStage(E, cfg) {
  const el = h('<section class="pages" tabindex="-1"></section>');
  const ps = { zoom: 1, pages: [], renders: new Map(), io: null, sig: '' };
  const k = () => ps.zoom * PT;
  const ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
  function build() {
    ps.io?.disconnect();
    el.querySelectorAll('.pdfpage').forEach((p) => p.remove());
    ps.renders.forEach((r) => URL.revokeObjectURL(r.url));
    ps.renders.clear();
    ps.pages = cfg.pages().map((p, i) => {
      const pe = h(`<div class="pdfpage" data-p="${i}"><img class="r" alt=""><span class="num">${esc(p.label ?? i + 1)}</span><div class="layer"></div></div>`);
      el.append(pe);
      const page = { ...p, el: pe, layer: $('.layer', pe), img: $('img', pe), visible: false };
      page.layer.addEventListener('pointerdown', (e) => cfg.pointer?.(e, i, page));
      page.layer.addEventListener('dblclick', (e) => cfg.dblclick?.(e, i, page));
      return page;
    });
    ps.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const i = Number(en.target.dataset.p), p = ps.pages[i];
        if (!p) continue;
        p.visible = en.isIntersecting;
        if (p.visible) { renderPage(p, i); cfg.decorate?.(i, p, k()); }
      }
    }, { root: el, rootMargin: '600px 0px' });
    ps.pages.forEach((p) => ps.io.observe(p.el));
    size();
  }
  function size() {
    for (const p of ps.pages) { p.el.style.width = `${p.w * k()}px`; p.el.style.height = `${p.h * k()}px`; }
    zoomMenu();
    decorate();
  }
  const decorate = () => ps.pages.forEach((p, i) => p.visible && cfg.decorate?.(i, p, k()));
  async function renderPage(p, i) {
    const scale = Math.min(cfg.maxScale || 6, k() * (window.devicePixelRatio || 1));
    const rev = E.st.sess?.rev, have = ps.renders.get(i);
    if (have && have.rev === rev && Math.abs(have.scale - scale) < 0.01) return;
    const want = `${rev}:${scale}`;
    if (p.rendering === want) return;
    p.rendering = want;
    try {
      const png = await cfg.render(i, scale);
      if (p.rendering !== want || E.st.disposed) return;
      const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
      if (have) URL.revokeObjectURL(have.url);
      ps.renders.set(i, { rev, scale, url });
      p.img.src = url;
      p.el.classList.add('ready');
    } catch (_) {} finally { if (p.rendering === want) p.rendering = null; }
  }
  // After a change: the same pages are drawn again in place, or laid out afresh if their number or size changed.
  function refresh() {
    const list = cfg.pages(), sig = list.map((p) => `${r1(p.w)}x${r1(p.h)}`).join(',');
    if (sig !== ps.sig) { const first = !ps.sig; ps.sig = sig; build(); if (first) requestAnimationFrame(fitWidth); return; }
    ps.pages.forEach((p, i) => { Object.assign(p, list[i]); p.el.querySelector('.num').textContent = list[i].label ?? i + 1; if (p.visible) renderPage(p, i); });
    decorate();
  }
  function zoomMenu() {
    const sel = $('.zoom', E.root());
    if (!sel) return;
    const z = Math.round(ps.zoom * 100);
    sel.innerHTML = `${ZOOMS.includes(z / 100) ? '' : `<option value="${ps.zoom}">${z}%</option>`}${ZOOMS.map((v) => `<option value="${v}">${Math.round(v * 100)}%</option>`).join('')}<option value="width">Fit width</option><option value="page">Fit page</option>`;
    sel.value = String(ZOOMS.includes(z / 100) ? z / 100 : ps.zoom);
  }
  let rerenderT = null;
  function setZoom(z, at) {
    const old = ps.zoom, nz = Math.min(12, Math.max(0.1, z));
    if (Math.abs(nz - old) < 1e-4 || !ps.pages.length) { zoomMenu(); return; }
    const r = el.getBoundingClientRect(), ax = at ? at.x : r.left + el.clientWidth / 2, ay = at ? at.y : r.top + el.clientHeight / 2;
    const page = ps.pages.find((p) => { const b = p.el.getBoundingClientRect(); return ay >= b.top - 12 && ay <= b.bottom + 12; }) || ps.pages.find((p) => p.visible) || ps.pages[0];
    const b0 = page.el.getBoundingClientRect(), fx = (ax - b0.left) / b0.width, fy = (ay - b0.top) / b0.height;
    ps.zoom = nz;
    size();
    const b1 = page.el.getBoundingClientRect();
    el.scrollLeft += b1.left + fx * b1.width - ax;
    el.scrollTop += b1.top + fy * b1.height - ay;
    clearTimeout(rerenderT);
    rerenderT = setTimeout(() => ps.pages.forEach((p, i) => p.visible && renderPage(p, i)), 180);
  }
  function fitWidth() {
    if (!ps.pages.length) return;
    const w = Math.max(...ps.pages.map((p) => p.w)), hh = Math.max(...ps.pages.map((p) => p.h));
    // Small artwork is shown big enough to work on, but a page is never wider than the view.
    setZoom(Math.min(cfg.fitMax || 3, (el.clientWidth - 96) / (w * PT), ps.pages.length === 1 ? (el.clientHeight - 72) / (hh * PT) : Infinity));
  }
  function fitPage() {
    const p = ps.pages.find((x) => x.visible) || ps.pages[0];
    if (!p) return;
    setZoom(Math.min((el.clientWidth - 96) / (p.w * PT), (el.clientHeight - 56) / (p.h * PT)));
    p.el.scrollIntoView({ block: 'center' });
  }
  const scrollTo = (i) => ps.pages[i]?.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  function visiblePage() {
    const top = el.getBoundingClientRect().top;
    let best = 0, bestD = Infinity;
    ps.pages.forEach((p, i) => { const d = Math.abs(p.el.getBoundingClientRect().top - top); if (d < bestD) { bestD = d; best = i; } });
    return best;
  }
  el.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const d = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
    setZoom(ps.zoom * Math.exp(-d * 0.0065), { x: e.clientX, y: e.clientY });
  }, { passive: false });
  // Hold Space and drag, or drag with the middle button, to move around.
  let spaceDown = false;
  const onSpace = (e) => { if (e.code === 'Space' && !e.target.matches?.('input, textarea, select, [contenteditable]')) { spaceDown = e.type === 'keydown'; el.classList.toggle('panning', spaceDown); if (spaceDown) e.preventDefault(); } };
  document.addEventListener('keydown', onSpace);
  document.addEventListener('keyup', onSpace);
  el.addEventListener('pointerdown', (e) => {
    if (!(spaceDown || e.button === 1)) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, l0 = el.scrollLeft, t0 = el.scrollTop;
    el.classList.add('grabbing');
    const mv = (ev) => { el.scrollLeft = l0 - (ev.clientX - sx); el.scrollTop = t0 - (ev.clientY - sy); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); el.classList.remove('grabbing'); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }, true);
  function command(a, v) {
    if (a === 'zoomin') setZoom(ps.zoom * 1.25);
    if (a === 'zoomout') setZoom(ps.zoom / 1.25);
    if (a === 'fit') fitWidth();
    if (a === 'zoomto') { if (v === 'width') fitWidth(); else if (v === 'page') fitPage(); else setZoom(Number(v)); }
  }
  const keys = (e, c) => {
    if (c && (e.key === '=' || e.key === '+')) { setZoom(ps.zoom * 1.25); return true; }
    if (c && e.key === '-') { setZoom(ps.zoom / 1.25); return true; }
    if (c && e.key === '0') { fitWidth(); return true; }
    if (c && e.key === '1') { setZoom(1); return true; }
    return false;
  };
  const dispose = () => { ps.io?.disconnect(); document.removeEventListener('keydown', onSpace); document.removeEventListener('keyup', onSpace); ps.renders.forEach((r) => URL.revokeObjectURL(r.url)); };
  return { el, k, refresh, decorate, command, keys, scrollTo, visiblePage, fitWidth, dispose, pages: () => ps.pages };
}

// A strip of page or artboard thumbnails with buttons above, as in the PDF editor.
function thumbStrip(E, cfg) {
  const el = h(`<div class="strip"><div class="ops">${cfg.ops.map(([id, ic, title]) => `<button class="tb" data-op="${id}" title="${esc(title)}">${E.icon(ic, 'sm')}</button>`).join('')}</div><div class="tlist"></div></div>`);
  const list = $('.tlist', el);
  const ts = { sig: '', urls: new Map(), io: null };
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-op]'); if (b && E.st.sess && !b.disabled) cfg.op(b.dataset.op); });
  function build() {
    ts.io?.disconnect();
    ts.urls.forEach((u) => URL.revokeObjectURL(u));
    ts.urls.clear();
    list.innerHTML = '';
    const items = cfg.items();
    ts.io = new IntersectionObserver(async (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting || en.target.dataset.rev === E.st.sess?.rev) continue;
        const i = Number(en.target.dataset.i), rev = E.st.sess?.rev, it = cfg.items()[i];
        if (!it) continue;
        en.target.dataset.rev = rev;
        const png = await cfg.render(i, 150 / Math.max(it.w, it.h)).catch(() => null);
        if (!png || E.st.disposed || rev !== E.st.sess?.rev) continue;
        const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
        if (ts.urls.has(i)) URL.revokeObjectURL(ts.urls.get(i));
        ts.urls.set(i, url);
        $('img', en.target).src = url;
      }
    }, { root: el, rootMargin: '300px' });
    items.forEach((it, i) => {
      const t = h(`<div class="pthumb" draggable="${!!cfg.move}" data-i="${i}" tabindex="0" aria-label="${esc(it.label)}"><img alt="" style="aspect-ratio:${it.w}/${it.h}"><small>${esc(it.label)}</small></div>`);
      t.addEventListener('click', () => cfg.pick(i));
      if (cfg.move) {
        t.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-page', String(i)); e.dataTransfer.effectAllowed = 'move'; });
        t.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-page')) { e.preventDefault(); t.classList.add('drop-before'); } });
        t.addEventListener('dragleave', () => t.classList.remove('drop-before'));
        t.addEventListener('drop', (e) => { e.preventDefault(); t.classList.remove('drop-before'); const from = Number(e.dataTransfer.getData('text/x-page')); if (from !== i) cfg.move(from, i > from ? i - 1 : i); });
      }
      list.append(t);
      ts.io.observe(t);
    });
    mark();
  }
  const mark = () => $$('.pthumb', list).forEach((x) => x.classList.toggle('sel', Number(x.dataset.i) === cfg.current()));
  function refresh() {
    const items = cfg.items(), sig = items.map((it) => `${it.label}:${r1(it.w)}x${r1(it.h)}`).join(',');
    if (sig !== ts.sig) { ts.sig = sig; build(); } else {
      // Thumbnails on screen are drawn again for the new step.
      $$('.pthumb', list).forEach((t) => { const b = t.getBoundingClientRect(), r = el.getBoundingClientRect(); if (b.bottom > r.top - 300 && b.top < r.bottom + 300) { ts.io.unobserve(t); ts.io.observe(t); } });
    }
    mark();
    for (const [id, off] of Object.entries(cfg.disabled?.() || {})) { const b = $(`[data-op="${id}"]`, el); if (b) b.disabled = off; }
  }
  return { el, refresh, mark, dispose: () => { ts.io?.disconnect(); ts.urls.forEach((u) => URL.revokeObjectURL(u)); } };
}

// ── VectorCraft ─────────────────────────────────────────────────────────────────────────────────────────────────────
const SHAPES = [['rect', 'Rectangle', 'square'], ['ellipse', 'Ellipse', 'circle'], ['star', 'Star', 'sparkle'], ['line', 'Line', 'line']];
const TRACE_PRESETS = [['Auto Color', 'Colour (auto)'], ['Flat Logo', 'Flat logo'], ['16 Colors', '16 colours'], ['Black and White Logo', 'Black & white'], ['Line Art', 'Line art'], ['Sketched Art', 'Sketch'], ['High Fidelity Photo', 'Photo (detailed)']];
const BOARD_SIZES = [['same', 'Same as this one'], ['1080x1080', 'Square 1080 px'], ['1920x1080', 'Wide 1920 × 1080'], ['1080x1920', 'Story 1080 × 1920'], ['595x842', 'A4'], ['612x792', 'Letter'], ['1200x628', 'Social link 1200 × 628']];
const KIND_NAME = { Path: 'Path', CompoundPath: 'Compound path', 'Compound Path': 'Compound path', Group: 'Group', Type: 'Text', Image: 'Image', Rectangle: 'Rectangle', Ellipse: 'Ellipse', Polygon: 'Polygon', Star: 'Star', Line: 'Line' };
function vectorApp(E) {
  const { st, ui } = E;
  const v = { sel: [], ab: 0, shape: 'rect', fill: '#0f6cbd', stroke: null, weight: 2, font: '', size: 24, color: '#000000', preset: 'Auto Color', ignoreWhite: false, tolerance: 1, scale: 100, newBoard: 'same', drag: null };
  const objs = () => st.model?.objects || [];
  const selected = () => objs().filter((o) => v.sel.includes(o.id));
  const boards = () => st.model?.artboards || [];
  const ids = () => (v.sel.length ? v.sel : undefined);
  const stage = pageStage(E, {
    pages: () => boards().map((a) => ({ w: a.w, h: a.h, label: a.name })),
    render: (i, scale) => E.call('render', st.sess.id, i, scale),
    decorate, pointer, fitMax: 4, maxScale: 12,
  });
  const side = thumbStrip(E, {
    ops: [['add', 'add', 'Add an artboard'], ['fit', 'fit', 'Fit the artboard to its artwork'], ['del', 'delete', 'Delete the artboard']],
    items: () => boards().map((a) => ({ w: a.w, h: a.h, label: a.name })),
    render: (i, scale) => E.call('render', st.sess.id, i, scale),
    current: () => v.ab,
    pick: (i) => { v.ab = i; side.mark(); stage.scrollTo(i); if (st.tool === 'artboard') E.drawProps(); },
    op: (id) => {
      if (id === 'add') { const a = boards()[v.ab] || { w: 600, h: 600 }; E.act('Add artboard', 'addArtboard', { width: a.w, height: a.h }); }
      if (id === 'fit') E.act('Fit artboard', 'fitArtboard', { index: v.ab });
      if (id === 'del') E.act('Delete artboard', 'deleteArtboard', { index: v.ab });
    },
    disabled: () => ({ del: boards().length < 2 }),
  });
  // Objects on an artboard, back to front so the one in front takes the click.
  function decorate(i, p, k) {
    p.layer.querySelectorAll('.vobj').forEach((x) => x.remove());
    const a = boards()[i];
    if (!a || !['select', 'arrange', 'path', 'color'].includes(st.tool)) return;
    for (const o of [...objs()].reverse()) {
      if (!o.visible || !o.bounds) continue;
      const b = o.bounds, x = (b.x - a.x) * k, y = (b.y - a.y) * k, w = Math.max(3, b.width * k), hh = Math.max(3, b.height * k);
      if (x > a.w * k || y > a.h * k || x + w < 0 || y + hh < 0) continue;
      const el = h(`<div class="vobj ${v.sel.includes(o.id) ? 'sel' : ''} ${o.locked ? 'locked' : ''}" data-id="${o.id}" style="left:${x}px;top:${y}px;width:${w}px;height:${hh}px" title="${esc(`${KIND_NAME[o.kind] || o.kind}${o.text ? `: ${o.text}` : ''}`)}"></div>`);
      if (!o.locked) el.addEventListener('pointerdown', (e) => grab(e, o, k));
      p.layer.append(el);
    }
  }
  function select(list) { v.sel = list; stage.decorate(); E.drawProps(); }
  // Click to select (Shift adds), drag to move: the move is one step when the mouse is let go.
  function grab(e, o, k) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey) { select(v.sel.includes(o.id) ? v.sel.filter((x) => x !== o.id) : [...v.sel, o.id]); return; }
    if (!v.sel.includes(o.id)) select([o.id]);
    const sx = e.clientX, sy = e.clientY, els = $$('.vobj.sel', stage.el);
    let dx = 0, dy = 0;
    const mv = (ev) => { dx = ev.clientX - sx; dy = ev.clientY - sy; els.forEach((x) => { x.style.transform = `translate(${dx}px, ${dy}px)`; }); };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      if (Math.hypot(dx, dy) > 2) E.act('Move', 'move', { ids: v.sel, dx: r1(dx / k), dy: r1(dy / k) }).then((s) => { if (!s) els.forEach((x) => { x.style.transform = ''; }); });
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }
  function pointer(e, i, p) {
    if (e.button !== 0) return;
    const a = boards()[i], k = stage.k(), r = p.layer.getBoundingClientRect();
    const at = (ev) => [Math.max(0, Math.min(a.w, (ev.clientX - r.left) / k)), Math.max(0, Math.min(a.h, (ev.clientY - r.top) / k))];
    v.ab = i;
    side.mark();
    if (st.tool === 'text') { e.preventDefault(); typeAt(p, at(e), a, k); return; }
    if (st.tool === 'shape') {
      e.preventDefault();
      const [x0, y0] = at(e), box = h('<div class="rubber"></div>');
      p.layer.append(box);
      let x1 = x0, y1 = y0;
      const draw = () => { const l = Math.min(x0, x1), t = Math.min(y0, y1); Object.assign(box.style, { left: `${l * k}px`, top: `${t * k}px`, width: `${Math.abs(x1 - x0) * k}px`, height: `${Math.abs(y1 - y0) * k}px` }); box.classList.toggle('round', v.shape === 'ellipse'); };
      const mv = (ev) => { [x1, y1] = at(ev); if (ev.shiftKey && v.shape !== 'line') { const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * d; y1 = y0 + Math.sign(y1 - y0 || 1) * d; } draw(); };
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        box.remove();
        let w = Math.abs(x1 - x0), hh = Math.abs(y1 - y0);
        if (w < 3 && hh < 3) { w = hh = Math.min(a.w, a.h) / 4; x1 = x0 + w; y1 = y0 + hh; }
        const line = v.shape === 'line';
        E.act(SHAPES.find((s) => s[0] === v.shape)[1], 'shape', { kind: v.shape, x: a.x + (line ? x0 : Math.min(x0, x1)), y: a.y + (line ? y0 : Math.min(y0, y1)), w: line ? x1 - x0 : w, h: line ? y1 - y0 : hh, fill: v.fill, stroke: line ? (v.stroke || '#000000') : v.stroke, weight: v.weight });
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
      return;
    }
    if (['select', 'arrange', 'path', 'color'].includes(st.tool) && v.sel.length) select([]);
  }
  // Type where the artboard was clicked: Enter places the text, Escape drops it.
  function typeAt(p, [x, y], a, k) {
    p.layer.querySelector('.vtype')?.remove();
    const box = h(`<input class="vtype" placeholder="Type, then press Enter" style="left:${x * k}px;top:${y * k}px;font-size:${Math.max(12, v.size * k)}px;color:${v.color}">`);
    p.layer.append(box);
    setTimeout(() => box.focus(), 0);
    const done = (ok) => {
      const text = box.value.trim();
      box.remove();
      if (ok && text) E.act('Add text', 'addText', { x: a.x + x, y: a.y + y + v.size * 0.8, text, size: v.size, font: v.font || undefined, color: v.color });
    };
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    box.addEventListener('blur', () => done(true));
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  const fonts = () => [...new Set([...(st.model?.fonts || []).map((f) => f.family), ...st.families])].map((f) => [f, f]);
  function panel(tool) {
    const m = st.model, sel = selected();
    if (tool === 'select') return selectPanel(sel);
    if (tool === 'text') {
      return [ui.head('Text'), ui.tip('Click the artboard where the text should start, type, then press Enter.'),
        ui.select('Font', [['', 'Default'], ...fonts()], v.font, (f) => { v.font = f; }),
        ui.slider('Size', 6, 200, 1, v.size, (n) => `${n} pt`, (n) => { v.size = n; }),
        ui.label('Colour'), ui.swatches(COLORS, v.color, (c) => { v.color = c || '#000000'; E.drawProps(); })];
    }
    if (tool === 'shape') {
      return [ui.head('Shapes'), ui.seg(SHAPES.map(([id, l, ic]) => [id, l, ic]), v.shape, (s) => { v.shape = s; E.drawProps(); }, 'full'),
        ...(v.shape === 'line' ? [] : [ui.label('Fill'), ui.swatches(COLORS, v.fill, (c) => { v.fill = c; E.drawProps(); }, { none: true })]),
        ui.label('Stroke'), ui.swatches(COLORS, v.stroke, (c) => { v.stroke = c; E.drawProps(); }, { none: v.shape !== 'line' }),
        ui.slider('Stroke weight', 0.5, 20, 0.5, v.weight, (n) => `${n} pt`, (n) => { v.weight = n; }),
        ui.tip('Drag on the artboard to draw. Hold Shift for squares and circles. A click makes one a quarter of the artboard’s size.')];
    }
    if (tool === 'color') {
      return [ui.head('Recolour', 'whole artwork'),
        ui.tip('Every colour in the artwork. Pick a new one to change it everywhere it is used, in fills, strokes, text and gradients.'),
        ui.recolor(m.colors.map((c) => ({ hex: c.hex, meta: plural(c.count, 'use'), title: c.swatch ? `${c.hex} (swatch ${c.swatch})` : c.hex })), (c, to) => E.act('Recolour', 'recolor', { map: { [c.hex]: to } })),
        ui.group(sel.length ? 'Adjust the selection' : 'Adjust colours', ui.tiles([
          ['gray', 'palette', 'Greyscale', 'Convert to greyscale', false, () => E.act('Greyscale', 'grayscale', { ids: ids() })],
          ['inv', 'again', 'Invert', 'Invert colours', false, () => E.act('Invert colours', 'invert', { ids: ids() })],
          ['sat', 'sun', 'Saturate', 'More saturated', false, () => E.act('Saturate', 'saturate', { ids: ids(), amount: 25 })],
          ['desat', 'magic', 'Mute', 'Less saturated', false, () => E.act('Mute colours', 'saturate', { ids: ids(), amount: -25 })],
        ])),
        ui.group('Document colour mode', ui.seg([['rgb', 'RGB'], ['cmyk', 'CMYK']], m.colorMode, (mode) => E.act(`Colour mode ${mode.toUpperCase()}`, 'colorMode', { mode }), 'full'), ui.tip('CMYK is for print: every colour is converted.'))];
    }
    if (tool === 'arrange') return arrangePanel(sel);
    if (tool === 'path') {
      const two = sel.length >= 2;
      return [ui.head('Paths', sel.length ? `${sel.length} selected` : 'whole artwork'),
        ui.tiles([
          ['ost', 'outline', 'Outline stroke', 'Turn strokes into filled shapes', false, () => E.act('Outline stroke', 'outlineStroke', { ids: ids() })],
          ['exp', 'expand', 'Expand', 'Bake live shapes, effects and text into plain paths', false, () => E.act('Expand', 'expand', { ids: ids() })],
          ['otx', 'textOutline', 'Outline text', 'Turn text into shapes', false, () => E.act('Outline text', 'outlineText', { ids: ids() })],
          ['cln', 'broom', 'Clean up', 'Remove stray points, empty paths and text', false, () => E.act('Clean up', 'cleanUp', {})],
        ]),
        ui.group('Effects', ui.tiles([
          ['shd', 'shadow', 'Shadow', 'Add a soft drop shadow', false, () => E.act('Drop shadow', 'shadow', { ids: ids() })],
          ['glow', 'sun', 'Glow', 'Add an outer glow', false, () => E.act('Outer glow', 'effect', { ids: ids(), kind: 'glow' })],
          ['round', 'square', 'Round corners', 'Round the corners', false, () => E.act('Round corners', 'effect', { ids: ids(), kind: 'round' })],
          ['feather', 'circle', 'Feather', 'Soften the edges', false, () => E.act('Feather', 'effect', { ids: ids(), kind: 'feather' })],
          ['rough', 'outline', 'Roughen', 'Make the edges rough, like hand-drawn', false, () => E.act('Roughen', 'effect', { ids: ids(), kind: 'roughen' })],
          ['arc', 'simplify', 'Arc', 'Warp into an arc', false, () => E.act('Arc', 'effect', { ids: ids(), kind: 'arc' })],
        ]), ui.tip('Effects stay live: Paths › Expand bakes them in.')),
        ui.group('Simplify', ui.slider('Tolerance', 0.2, 10, 0.1, v.tolerance, (n) => `${n} pt`, (n) => { v.tolerance = n; }), ui.row(ui.btn('Simplify', 'simplify', () => E.act('Simplify', 'simplify', { ids: ids(), tolerance: v.tolerance })))),
        ui.group('Pathfinder', ui.tiles([['unite', 'unite', 'Unite'], ['minusFront', 'minus', 'Minus front'], ['intersect', 'intersect', 'Intersect'], ['exclude', 'exclude', 'Exclude'], ['divide', 'divide', 'Divide']].map(([id, ic, l]) => [id, ic, l, `${l} the selected shapes`, !two, () => E.act(l, 'pathfinder', { ids: v.sel, kind: id })])), two ? null : ui.tip('Select two or more shapes (Shift-click) to combine them.'))];
    }
    if (tool === 'type') {
      const f = { find: '', replace: '', matchCase: false };
      const from = { v: m.fonts[0]?.family || '' }, to = { v: st.families.find((x) => x !== from.v) || '' };
      return [ui.head('Type'),
        ui.group('Find and replace', ui.input('', '', (x) => { f.find = x; }, { placeholder: 'Find', key: 'find' }), ui.input('', '', (x) => { f.replace = x; }, { placeholder: 'Replace with', key: 'replace' }), ui.toggle('Match case', false, (x) => { f.matchCase = x; }),
          ui.row(ui.btn('Replace all', 'again', () => { const fi = $('[data-k=find]', E.root()).value, re = $('[data-k=replace]', E.root()).value; if (fi) E.act('Replace text', 'findReplace', { find: fi, replace: re, matchCase: f.matchCase }); }, { primary: true }))),
        ui.group('Fonts in the artwork', ui.list(m.fonts.map((x) => ({ text: `${x.family} ${x.style}`, meta: x.status === 'exact' ? '' : x.status, warn: x.status !== 'exact', icon: 'textT' })), () => {}, { empty: 'No text.' })),
        m.fonts.length ? ui.group('Replace font', ui.select('Replace', [...new Set(m.fonts.map((x) => x.family))].map((x) => [x, x]), from.v, (x) => { from.v = x; }), ui.select('With', st.families.map((x) => [x, x]), to.v, (x) => { to.v = x; }), ui.row(ui.btn('Replace font', 'textT', () => E.act('Replace font', 'replaceFont', { from: from.v, to: to.v })))) : null,
        ui.row(ui.btn('Outline all text', 'textOutline', () => E.act('Outline text', 'outlineText', {})))];
    }
    if (tool === 'artboard') {
      const a = boards()[v.ab] || boards()[0];
      if (!a) return [ui.head('Artboards')];
      const size = { w: r1(a.w), h: r1(a.h), scaleArt: false };
      return [ui.head('Artboard', a.name),
        ui.row(ui.num('Width', size.w, (n) => { size.w = n; }, { min: 1, unit: 'pt', key: 'abw' }), ui.num('Height', size.h, (n) => { size.h = n; }, { min: 1, unit: 'pt', key: 'abh' })),
        ui.toggle('Scale the artwork with it', false, (x) => { size.scaleArt = x; }),
        ui.row(ui.btn('Resize', 'fit', () => E.act('Resize artboard', 'artboard', { index: v.ab, width: Number($('[data-k=abw]', E.root()).value), height: Number($('[data-k=abh]', E.root()).value), scaleArt: size.scaleArt }), { primary: true }), ui.btn('Fit to artwork', 'expand', () => E.act('Fit artboard', 'fitArtboard', { index: v.ab }))),
        ui.group('Background', ui.seg([['transparent', 'Transparent'], ['white', 'White']], st.model.background, (x) => E.act('Background', 'background', { white: x === 'white' }), 'full'), ui.tip('White fills the background of pictures you export.')),
        ui.group('New artboard', ui.select('', BOARD_SIZES, v.newBoard, (x) => { v.newBoard = x; }), ui.row(ui.btn('Add artboard', 'add', () => { const [w, hh] = v.newBoard === 'same' ? [a.w, a.h] : v.newBoard.split('x').map(Number); E.act('Add artboard', 'addArtboard', { width: w, height: hh }); }))),
        boards().length > 1 ? ui.row(ui.btn('Delete this artboard', 'delete', () => E.act('Delete artboard', 'deleteArtboard', { index: v.ab }), { danger: true })) : null];
    }
    if (tool === 'trace') {
      const pick = async (op) => {
        const [f] = await E.api.invoke('dialog:open', { multi: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'psd'] }] });
        const a = boards()[v.ab] || boards()[0];
        if (f) E.act(op === 'trace' ? 'Trace image' : 'Place image', op, { file: f, preset: v.preset, ignoreWhite: v.ignoreWhite, rect: [a.x, a.y, a.w, a.h] });
      };
      return [ui.head('Image trace'), ui.tip('Turn a picture or a scanned logo into shapes on this artboard.'),
        ui.select('Preset', TRACE_PRESETS, v.preset, (x) => { v.preset = x; }), ui.toggle('Leave out the white', v.ignoreWhite, (x) => { v.ignoreWhite = x; }),
        ui.row(ui.btn('Trace an image…', 'trace', () => pick('trace'), { primary: true })),
        ui.group('Place', ui.row(ui.btn('Place an image…', 'imageAdd', () => pick('place'))), ui.tip('Placed images are embedded in the file.'))];
    }
    return [];
  }
  function selectPanel(sel) {
    const m = st.model;
    if (!sel.length) {
      // Layers, with the eye and the lock as in the app's Layers panel.
      const layers = h(`<div class="lyrs">${m.layers.map((l) => `<div class="lyr" style="padding-left:${6 + l.depth * 14}px"><button class="tb icon" data-ly="${l.id}" data-k="visible" title="${l.visible ? 'Hide' : 'Show'} ${esc(l.name)}">${E.icon(l.visible ? 'eye' : 'eyeOff', 'sm')}</button><button class="tb icon ${l.locked ? 'on' : ''}" data-ly="${l.id}" data-k="locked" title="${l.locked ? 'Unlock' : 'Lock'} ${esc(l.name)}">${E.icon(l.locked ? 'lock' : 'unlock', 'sm')}</button><span>${esc(l.name)}</span></div>`).join('')}</div>`);
      layers.addEventListener('click', (e) => { const b = e.target.closest('[data-ly]'); if (!b) return; const l = m.layers.find((x) => x.id === Number(b.dataset.ly)); E.act(b.dataset.k === 'visible' ? (l.visible ? 'Hide layer' : 'Show layer') : (l.locked ? 'Unlock layer' : 'Lock layer'), 'layer', { id: l.id, [b.dataset.k]: !l[b.dataset.k] }); });
      return [ui.head('Artwork', `${plural(m.objects.length, 'object')}, ${plural(m.artboards.length, 'artboard')}`),
        ui.tip('Click something on the artboard to select it; Shift-click selects more. Drag to move, arrow keys nudge.'),
        ui.group('Layers', layers),
        ui.group('Objects', ui.list(m.objects.map((o) => ({ id: o.id, text: o.text ? `“${o.text}”` : o.name.replace(/^<|>$/g, '') || KIND_NAME[o.kind] || o.kind, meta: KIND_NAME[o.kind] || o.kind, icon: o.kind === 'Type' ? 'textT' : o.kind === 'Group' ? 'layers' : o.kind === 'Image' ? 'image' : 'pen', swatch: /^#/.test(o.fill) ? o.fill : null })), (it, e) => select(e.shiftKey ? [...v.sel, it.id] : [it.id]), { empty: 'The artboards are empty.' }))];
    }
    const o = sel[0], one = sel.length === 1, text = one && o.kind === 'Type';
    const fill = one ? o.fill : null, stroke = one ? o.stroke : null;
    const out = [ui.head(one ? (KIND_NAME[o.kind] || o.kind) : `${sel.length} objects`, one && o.bounds ? `${r1(o.bounds.width)} × ${r1(o.bounds.height)} pt` : '')];
    if (text) {
      out.push(ui.input('Text', o.text, (t) => E.act('Edit text', 'setText', { id: o.id, text: t })),
        ui.row(ui.select('Font', [['', 'Keep'], ...fonts()], '', (f) => f && E.act('Font', 'textStyle', { ids: v.sel, font: f })), ui.num('Size', '', (n) => n && E.act('Text size', 'textStyle', { ids: v.sel, size: n }), { min: 1, unit: 'pt', placeholder: 'Keep' })));
    }
    out.push(ui.label(text ? 'Text colour' : 'Fill'), ui.swatches(COLORS, /^#/.test(fill) ? fill : 'x', (c) => E.act('Fill', text ? 'textStyle' : 'fill', text ? { ids: v.sel, color: c || '#000000' } : { ids: v.sel, color: c }), { none: !text }));
    if (!text) {
      out.push(ui.label('Stroke'), ui.swatches(COLORS, /^#/.test(stroke) ? stroke : stroke === 'None' ? 'none' : 'x', (c) => E.act('Stroke', 'stroke', { ids: v.sel, color: c, ...(c && !(one && o.strokeWidth) ? { weight: 1 } : {}) }), { none: true }),
        ui.slider('Stroke weight', 0, 20, 0.5, one ? o.strokeWidth || 0 : 1, (n) => `${n} pt`, (n) => E.act('Stroke weight', 'stroke', { ids: v.sel, weight: n })));
    }
    out.push(ui.slider('Opacity', 0, 100, 1, one ? Math.round(o.opacity ?? 100) : 100, (n) => `${n}%`, (n) => E.act('Opacity', 'opacity', { ids: v.sel, value: n })),
      ui.group('Arrange', ui.tiles([
        ['front', 'toFront', 'To front', 'Bring to front', false, () => E.act('Bring to front', 'arrange', { ids: v.sel, to: 'front' })],
        ['back', 'toBack', 'To back', 'Send to back', false, () => E.act('Send to back', 'arrange', { ids: v.sel, to: 'back' })],
        ['dup', 'copy', 'Duplicate', 'Duplicate (Ctrl D)', false, () => E.act('Duplicate', 'duplicate', { ids: v.sel })],
        [one && o.kind === 'Group' ? 'ungroup' : 'group', one && o.kind === 'Group' ? 'ungroup' : 'group', one && o.kind === 'Group' ? 'Ungroup' : 'Group', '', !(one && o.kind === 'Group') && sel.length < 2, () => (one && o.kind === 'Group' ? E.act('Ungroup', 'ungroup', { ids: v.sel }) : E.act('Group', 'group', { ids: v.sel }))],
      ])),
      ui.row(ui.btn('Delete', 'delete', () => E.act('Delete', 'delete', { ids: v.sel }), { danger: true })));
    return out;
  }
  function arrangePanel(sel) {
    const many = sel.length > 1, none = !sel.length;
    const al = (h_, v_, l) => () => E.act(l, 'align', { ids: ids(), ...(h_ ? { horizontal: h_ } : {}), ...(v_ ? { vertical: v_ } : {}), to: many ? 'selection' : 'artboard' });
    return [ui.head('Arrange', none ? 'whole artwork' : `${sel.length} selected`),
      ui.group(many ? 'Align to each other' : 'Align to the artboard', ui.tiles([
        ['l', 'alignL', 'Left', 'Align left', false, al('left', null, 'Align left')], ['c', 'alignC', 'Centre', 'Align centres', false, al('center', null, 'Align centre')], ['r', 'alignR', 'Right', 'Align right', false, al('right', null, 'Align right')],
        ['t', 'alignT', 'Top', 'Align tops', false, al(null, 'top', 'Align top')], ['m', 'alignM', 'Middle', 'Align middles', false, al(null, 'center', 'Align middle')], ['b', 'alignB', 'Bottom', 'Align bottoms', false, al(null, 'bottom', 'Align bottom')],
      ])),
      ui.group('Distribute', ui.tiles([
        ['dh', 'distH', 'Across', 'Space evenly across', sel.length < 3, () => E.act('Distribute', 'distribute', { ids: v.sel, horizontal: 'center' })],
        ['dv', 'distV', 'Down', 'Space evenly down', sel.length < 3, () => E.act('Distribute', 'distribute', { ids: v.sel, vertical: 'center' })],
      ]), sel.length < 3 ? ui.tip('Select three or more objects to space them evenly.') : null),
      ui.group('Transform', ui.tiles([
        ['fh', 'flipH', 'Flip across', 'Flip horizontally', false, () => E.act('Flip', 'flip', { ids: ids(), axis: 'vertical' })],
        ['fv', 'flipV', 'Flip down', 'Flip vertically', false, () => E.act('Flip', 'flip', { ids: ids(), axis: 'horizontal' })],
        ['rl', 'rotL', '90° left', 'Rotate 90° left', false, () => E.act('Rotate', 'rotate', { ids: ids(), angle: 90 })],
        ['rr', 'rotR', '90° right', 'Rotate 90° right', false, () => E.act('Rotate', 'rotate', { ids: ids(), angle: -90 })],
      ]), ui.row(ui.num('Scale', v.scale, (n) => { v.scale = n || 100; }, { min: 1, unit: '%', key: 'scale' }), ui.btn('Scale', 'expand', () => E.act('Scale', 'scale', { ids: ids(), percent: Number($('[data-k=scale]', E.root()).value) || 100 })))),
      none ? null : ui.group('Order', ui.tiles([['front', 'toFront', 'Front'], ['forward', 'up', 'Forward'], ['backward', 'down', 'Backward'], ['back', 'toBack', 'Back']].map(([id, ic, l]) => [id, ic, l, `Bring ${l.toLowerCase()}`, false, () => E.act(`Arrange ${l.toLowerCase()}`, 'arrange', { ids: v.sel, to: id })])))];
  }
  function onFind(q) {
    if (!q) return;
    const hit = objs().filter((o) => o.text && o.text.toLowerCase().includes(q.toLowerCase())).map((o) => o.id);
    if (!hit.length) { E.toast(`“${q}” wasn’t found.`); return; }
    E.selectTool('select');
    select(hit);
    E.tip(`${plural(hit.length, 'text object')} with “${q}”`);
  }
  async function replace() {
    const r = await E.ask('Find and replace', [{ key: 'find', label: 'Find', value: $('.find', E.root())?.value || '' }, { key: 'replace', label: 'Replace with' }, { key: 'matchCase', label: 'Match case', kind: 'check' }, { key: 'wholeWord', label: 'Whole words only', kind: 'check' }], 'Replace all');
    if (r?.find) E.act('Replace text', 'findReplace', r);
  }
  function keys(e, c) {
    if (stage.keys(e, c)) return true;
    const k = e.key;
    if (!v.sel.length) return false;
    if (k === 'Delete' || k === 'Backspace') { E.act('Delete', 'delete', { ids: v.sel }); return true; }
    if (k === 'Escape') { select([]); return true; }
    if (c && k.toLowerCase() === 'd') { E.act('Duplicate', 'duplicate', { ids: v.sel }); return true; }
    if (c && k.toLowerCase() === 'g') { E.act(e.shiftKey ? 'Ungroup' : 'Group', e.shiftKey ? 'ungroup' : 'group', { ids: v.sel }); return true; }
    if (k.startsWith('Arrow')) {
      const d = e.shiftKey ? 10 : 1;
      E.act('Nudge', 'move', { ids: v.sel, dx: k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, dy: k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0 });
      return true;
    }
    return false;
  }
  function sync(s) {
    const have = new Set(objs().map((o) => o.id));
    v.sel = s.select?.length ? s.select.filter((x) => have.has(x)) : v.sel.filter((x) => have.has(x));
    v.ab = Math.min(v.ab, Math.max(0, boards().length - 1));
  }
  return {
    name: 'VectorCraft', icon: 'pen', find: 'Find text', zoom: true, sideTitle: 'Artboards', stage, side, panel, keys, sync, onFind, replace,
    tools: [
      ['Edit', [['select', 'cursor', 'Select', 'Click to select, Shift-click for more, drag to move.'], ['text', 'textT', 'Text', 'Click the artboard where the text should go.'], ['shape', 'shapes', 'Shapes', 'Drag on the artboard to draw a shape.']]],
      ['Colour', [['color', 'palette', 'Recolour', 'Swap any colour of the artwork for another, everywhere.']]],
      ['Object', [['arrange', 'arrange', 'Arrange', 'Align, distribute, flip, rotate and scale.'], ['path', 'pen', 'Paths', 'Outline strokes, expand, simplify and combine shapes.']]],
      ['Document', [['type', 'textEdit', 'Type', 'Find and replace text, change fonts.'], ['artboard', 'artboard', 'Artboards', 'Resize, fit and add artboards.'], ['trace', 'trace', 'Trace', 'Turn a picture into shapes.']]],
      ['Out', [['export', 'share', 'Export', 'Save a copy, or export artboards and logo files.']]],
    ],
    shortcuts: { v: 'select', t: 'text', m: 'shape', r: 'color' },
    onTool: () => stage.decorate(),
    saveOptions: {},
    dispose: () => { stage.dispose(); side.dispose(); },
  };
}

// ── DesignCraft ─────────────────────────────────────────────────────────────────────────────────────────────────────
const MM = 72 / 25.4;
const PAGE_SIZES = [['custom', 'Custom'], ['595.28x841.89', 'A4'], ['419.53x595.28', 'A5'], ['841.89x1190.55', 'A3'], ['612x792', 'Letter'], ['612x1008', 'Legal'], ['792x1224', 'Tabloid'], ['396x612', 'Half letter']];
function layoutApp(E) {
  const { st, ui } = E;
  const d = { page: 0, item: null, story: null, storyText: null, finds: null, q: '', preflight: null, minPpi: 150, swatch: null };
  const pages = () => st.model?.pages || [];
  const items = () => st.model?.items || [];
  const stage = pageStage(E, {
    pages: () => pages().map((p) => ({ w: p.w, h: p.h, label: p.name })),
    render: (i, scale) => E.call('render', st.sess.id, i, scale),
    decorate, pointer, dblclick: () => { if (d.item && items().find((x) => x.id === d.item)?.story != null) E.selectTool('story'); }, fitMax: 2, maxScale: 4,
  });
  const side = thumbStrip(E, {
    ops: [['add', 'docAdd', 'Insert a page after this one'], ['dup', 'copy', 'Duplicate this page’s spread'], ['up', 'up', 'Move the page up'], ['down', 'down', 'Move the page down'], ['del', 'delete', 'Delete the page']],
    items: () => pages().map((p) => ({ w: p.w, h: p.h, label: p.name })),
    render: (i, scale) => E.call('render', st.sess.id, i, scale),
    current: () => d.page,
    pick: (i) => { d.page = i; side.mark(); stage.scrollTo(i); },
    move: (from, to) => E.act('Move page', 'movePage', { from, to }),
    op: (id) => {
      const p = pages()[d.page];
      if (id === 'add') E.act('Insert page', 'insertPages', { count: 1, after: d.page }).then((s) => { if (s) d.page = Math.min(d.page + 1, pages().length - 1); });
      if (id === 'dup' && p) E.act('Duplicate spread', 'duplicatePage', { spread: p.spread });
      if (id === 'up' && d.page > 0) E.act('Move page', 'movePage', { from: d.page, to: d.page - 1 }).then((s) => { if (s) d.page--; });
      if (id === 'down' && d.page < pages().length - 1) E.act('Move page', 'movePage', { from: d.page, to: d.page + 1 }).then((s) => { if (s) d.page++; });
      if (id === 'del') E.act('Delete page', 'deletePages', { pages: [d.page] });
    },
    disabled: () => ({ del: pages().length < 2, up: d.page < 1, down: d.page >= pages().length - 1 }),
  });
  function decorate(i, p, k) {
    p.layer.querySelectorAll('.dframe').forEach((x) => x.remove());
    if (!['select', 'story'].includes(st.tool)) return;
    for (const it of items()) {
      if (it.page !== i || it.hidden) continue;
      const text = it.story != null;
      if (st.tool === 'story' && !text) continue;
      const el = h(`<div class="dframe ${text ? 'text' : ''} ${d.item === it.id ? 'sel' : ''}" data-id="${it.id}" style="left:${it.x * k}px;top:${it.y * k}px;width:${Math.max(3, it.w * k)}px;height:${Math.max(3, it.h * k)}px" title="${esc(text ? (st.model.stories.find((s) => s.id === it.story)?.preview || 'Text frame') : it.kind)}"></div>`);
      el.addEventListener('pointerdown', (e) => { if (e.button) return; e.stopPropagation(); pick(it); });
      p.layer.append(el);
    }
  }
  function pick(it) {
    d.item = it?.id ?? null;
    d.page = it ? it.page : d.page;
    side.mark();
    if (it?.story != null) openStory(it.story); else { stage.decorate(); E.drawProps(); }
  }
  async function openStory(id) {
    d.story = id;
    d.storyText = null;
    stage.decorate();
    E.drawProps();
    const s = await E.query('story', { story: id }).catch(() => null);
    if (d.story === id) { d.storyText = s; E.drawProps(); }
  }
  function pointer(e) { if (e.button === 0 && d.item) { d.item = null; stage.decorate(); E.drawProps(); } }
  const swatchOptions = () => (st.model?.swatches || []).map((w) => [w.name, w.name]);
  function storyEditor() {
    const story = st.model.stories.find((s) => s.id === d.story);
    if (!story) return [ui.tip('Pick a text frame on the page, or a story from the list.')];
    if (!d.storyText) return [ui.head('Story', story.preview?.slice(0, 32)), ui.tip('Reading…')];
    const out = [ui.head('Story', `${plural(d.storyText.paragraphs || 1, 'paragraph')}, ${plural(story.length, 'character')}${story.frames?.length > 1 ? `, ${story.frames.length} frames` : ''}`)];
    if (story.overset) out.push(h(`<p class="warnline">${E.icon('warning', 'sm')}Some text doesn’t fit its frames (overset).</p>`));
    const box = ui.input('', d.storyText.text, null, { area: true, rows: Math.max(3, Math.min(14, String(d.storyText.text).split('\n').length + Math.ceil(String(d.storyText.text).length / 38))), key: 'story' });
    out.push(box, ui.row(ui.btn('Apply', 'check', () => { const t = $('textarea', box).value; if (t !== d.storyText.text) E.act('Edit story', 'storyText', { story: d.story, text: t }); }, { primary: true }), ui.btn('Revert', 'undo', () => { $('textarea', box).value = d.storyText.text; }, { subtle: true })),
      ui.tip('The text keeps the styles of the paragraphs it replaces.'));
    return out;
  }
  function panel(tool) {
    const m = st.model;
    if (tool === 'select') {
      const it = items().find((x) => x.id === d.item);
      if (!it) return [ui.head(nameOf(E.file).replace(/\.[^.]+$/, ''), `${plural(m.pages.length, 'page')}`), ui.tip('Click a frame on a page to select it. Text frames open their story to edit.'), ui.group('Document', ui.list([
        { text: `${r1(m.settings.pageWidth / MM)} × ${r1(m.settings.pageHeight / MM)} mm`, meta: m.settings.facingPages ? 'Facing pages' : 'Single pages', icon: 'page' },
        { text: plural(m.stories.length, 'story', 'stories'), meta: m.stories.some((s) => s.overset) ? 'Overset text' : '', warn: m.stories.some((s) => s.overset), icon: 'text' },
        { text: plural(m.fonts.length, 'font'), meta: m.fonts.some((f) => f.missing) ? 'Missing' : '', warn: m.fonts.some((f) => f.missing), icon: 'textT' },
      ], (x) => E.selectTool(x.icon === 'page' ? 'pages' : x.icon === 'text' ? 'story' : 'fonts')))];
      if (it.story != null) return [ui.head('Text frame'), ...storyEditor(), ui.row(ui.btn('Delete frame', 'delete', () => E.act('Delete frame', 'deleteItems', { ids: [it.id] }).then(() => { d.item = null; }), { danger: true }))];
      return [ui.head(it.kind.replace(/^./, (c) => c.toUpperCase()), `${r1(it.w / MM)} × ${r1(it.h / MM)} mm`),
        ui.select('Fill', [['[None]', 'None'], ...swatchOptions()], it.fill, (sw) => E.act('Fill', 'itemFill', { ids: [it.id], swatch: sw })),
        ui.slider('Opacity', 0, 100, 1, 100, (n) => `${n}%`, (n) => E.act('Opacity', 'itemOpacity', { ids: [it.id], value: n })),
        it.kind === 'image' ? ui.group('Fitting', ui.tiles([
          ['fill', 'expand', 'Fill frame', 'Fill the frame, keeping the picture’s shape', false, () => E.act('Fill frame', 'fit', { ids: [it.id], mode: 'fillProportionally' })],
          ['fit', 'fit', 'Fit picture', 'Show the whole picture, keeping its shape', false, () => E.act('Fit picture', 'fit', { ids: [it.id], mode: 'fitProportionally' })],
          ['centre', 'frame', 'Centre', 'Centre the picture in the frame', false, () => E.act('Centre picture', 'fit', { ids: [it.id], mode: 'centerContent' })],
          ['frame', 'artboard', 'Frame to picture', 'Resize the frame to the picture', false, () => E.act('Frame to picture', 'fit', { ids: [it.id], mode: 'fitFrameToContent' })],
        ]), ui.row(ui.btn('Replace picture…', 'imageAdd', async () => {
          const [f] = await E.api.invoke('dialog:open', { multi: false, filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'psd', 'pdf', 'svg', 'webp', 'gif'] }] });
          if (f) E.act('Replace picture', 'replaceImage', { frame: it.id, file: f });
        }))) : null,
        ui.row(ui.btn('Delete', 'delete', () => E.act('Delete', 'deleteItems', { ids: [it.id] }).then(() => { d.item = null; }), { danger: true }))];
    }
    if (tool === 'story') {
      return [ui.head('Stories', plural(m.stories.length, 'story', 'stories')), ui.list(m.stories.map((s) => ({ id: s.id, text: s.preview || '(empty)', meta: s.overset ? 'Overset' : plural(s.length, 'character'), warn: s.overset, on: s.id === d.story, icon: 'text' })), (x) => { const f = items().find((y) => y.story === x.id); if (f) { d.item = f.id; d.page = f.page; stage.scrollTo(f.page); } openStory(x.id); }), d.story != null ? ui.group('', ...storyEditor()) : null];
    }
    if (tool === 'find') {
      const f = { find: d.q, change: '', grep: false, caseSensitive: false, wholeWord: false };
      return [ui.head('Find and change'),
        ui.input('', d.q, (x) => { f.find = x; }, { placeholder: 'Find', key: 'dfind' }), ui.input('', '', (x) => { f.change = x; }, { placeholder: 'Change to', key: 'dchange' }),
        ui.toggle('Match case', false, (x) => { f.caseSensitive = x; }), ui.toggle('Whole words', false, (x) => { f.wholeWord = x; }), ui.toggle('Pattern (GREP)', false, (x) => { f.grep = x; }),
        ui.row(ui.btn('Find', 'search', () => runFind($('[data-k=dfind]', E.root()).value, f)), ui.btn('Change all', 'again', () => { const q = $('[data-k=dfind]', E.root()).value; if (q) E.act('Change text', 'findChange', { ...f, find: q, change: $('[data-k=dchange]', E.root()).value }).then(() => { d.finds = null; }); }, { primary: true })),
        d.finds ? ui.group(d.finds.length ? plural(d.finds.length, 'match', 'matches') : 'No matches', ui.list(d.finds.slice(0, 200).map((x) => ({ story: x.story, text: x.context, meta: `Page ${(items().find((y) => y.story === x.story)?.page ?? 0) + 1}`, icon: 'search' })), (x) => { const fr = items().find((y) => y.story === x.story); if (fr) { stage.scrollTo(fr.page); d.item = fr.id; E.selectTool('story'); openStory(fr.story); } })) : null];
    }
    if (tool === 'swatches') {
      const list = m.swatches.filter((w) => !w.locked && w.hex);
      return [ui.head('Swatches', plural(list.length, 'colour')), ui.tip('Change a swatch and everything that uses it follows: text, frames and gradients.'),
        ui.recolor(list.map((w) => ({ hex: w.hex, meta: w.name, title: w.name })), (c, to) => E.act(`Swatch ${c.meta}`, 'swatch', { name: c.meta, color: to }))];
    }
    if (tool === 'fonts') {
      const sel = { from: m.fonts.find((f) => f.missing) || m.fonts[0], to: st.families.includes('Source Sans 3') ? 'Source Sans 3' : st.families[0] };
      const key = (f) => `${f.family}|${f.style}`;
      return [ui.head('Fonts', plural(m.fonts.length, 'font')), ui.list(m.fonts.map((f) => ({ text: `${f.family} ${f.style}`, meta: f.missing ? 'Missing' : f.status === 'exact' ? '' : 'Substituted', warn: f.missing, icon: 'textT' })), () => {}),
        m.fonts.length ? ui.group('Replace font', ui.select('Replace', m.fonts.map((f) => [key(f), `${f.family} ${f.style}`]), sel.from ? key(sel.from) : '', (x) => { sel.from = m.fonts.find((f) => key(f) === x); }),
          ui.select('With', st.families.map((f) => [f, f]), sel.to, (x) => { sel.to = x; }),
          ui.row(ui.btn('Replace', 'textT', () => sel.from && E.act('Replace font', 'fontReplace', { family: sel.from.family, style: sel.from.style, toFamily: sel.to }), { primary: true })), ui.tip('Paragraph and character styles change too.')) : null];
    }
    if (tool === 'pages') {
      const s = m.settings, p0 = pages()[0] || { margins: {}, columns: 1 }, mg = p0.margins || {};
      const f = { w: r1(s.pageWidth / MM), h: r1(s.pageHeight / MM), margins: r1((mg.top ?? 36) / MM), columns: p0.columns || 1, gutter: 4.2, bleed: 3, facing: !!s.facingPages };
      const size = PAGE_SIZES.find(([v]) => { const [w, hh] = v.split('x').map(Number); return Math.abs(w - s.pageWidth) < 1 && Math.abs(hh - s.pageHeight) < 1; })?.[0] || 'custom';
      const val = (k) => Number($(`[data-k=${k}]`, E.root())?.value);
      return [ui.head('Document setup', plural(m.pages.length, 'page')),
        ui.select('Page size', PAGE_SIZES, size, (x) => { if (x === 'custom') return; const [w, hh] = x.split('x').map(Number); $('[data-k=pw]', E.root()).value = r1(w / MM); $('[data-k=ph]', E.root()).value = r1(hh / MM); }),
        ui.row(ui.num('Width', f.w, null, { min: 10, unit: 'mm', key: 'pw' }), ui.num('Height', f.h, null, { min: 10, unit: 'mm', key: 'ph' })),
        ui.row(ui.num('Margins', f.margins, null, { min: 0, unit: 'mm', key: 'pm' }), ui.num('Bleed', f.bleed, null, { min: 0, unit: 'mm', key: 'pb' })),
        ui.row(ui.num('Columns', f.columns, null, { min: 1, max: 12, step: 1, key: 'pc' }), ui.num('Gutter', f.gutter, null, { min: 0, unit: 'mm', key: 'pg' })),
        ui.toggle('Facing pages', f.facing, (x) => { f.facing = x; }),
        ui.row(ui.btn('Apply', 'check', () => E.act('Document setup', 'setup', { width: val('pw') * MM, height: val('ph') * MM, margins: val('pm') * MM, bleed: val('pb') * MM, columns: val('pc'), gutter: val('pg') * MM, facingPages: f.facing }), { primary: true })),
        ui.tip('Frames move and resize with the new page size and margins.'),
        ui.group('Pages', ui.row(ui.btn('Insert page', 'docAdd', () => E.act('Insert page', 'insertPages', { count: 1, after: d.page })), ui.btn('Delete page', 'delete', () => E.act('Delete page', 'deletePages', { pages: [d.page] }), { danger: true, disabled: m.pages.length < 2 })), ui.tip(`The page buttons and dragging in the pages panel act on page ${pages()[d.page]?.name || 1}.`))];
    }
    if (tool === 'preflight') {
      if (!d.preflight) { runPreflight(); return [ui.head('Preflight'), ui.tip('Checking…')]; }
      const r = d.preflight;
      // Each problem, with the fix where there is one: clicking it shows where it is.
      const fix = (x) => {
        if (x.kind === 'overset' && x.item != null) return ['Grow the frame', () => E.act('Fit frame to text', 'fitFrame', { ids: [x.item] })];
        if (x.kind === 'emptyText' && x.item != null) return ['Delete it', () => E.act('Delete frame', 'deleteItems', { ids: [x.item] })];
        if (x.kind === 'rgbColor') { const sw = m.swatches.find((w) => w.name === x.message.replace(/^[^:]*: /, '')); if (sw) return ['Make it CMYK', () => E.act('Swatch to CMYK', 'swatch', { name: sw.name, color: sw.hex, cmyk: true })]; }
        if (/^missingFont/.test(x.kind)) return ['Replace', () => E.selectTool('fonts')];
        return null;
      };
      const list = h('<div class="issues"></div>');
      for (const x of r.issues) {
        const el = h(`<div class="issue ${x.severity === 'error' ? 'err' : ''}">${E.icon(x.severity === 'error' ? 'warning' : 'info', 'sm')}<div class="it"><span>${esc(x.message)}</span>${x.page != null ? `<small>Page ${x.page + 1}</small>` : ''}</div></div>`);
        $('.it', el).addEventListener('click', () => { const it = items().find((y) => y.id === x.item); if (it) { E.selectTool('select'); pick(it); stage.scrollTo(it.page); } else if (x.page != null) stage.scrollTo(x.page); });
        const f = fix(x);
        if (f) el.append(ui.btn(f[0], null, f[1], { subtle: true }));
        list.append(el);
      }
      return [ui.head('Preflight', r.issues.length ? `${plural(r.errors || 0, 'error')}, ${plural(r.warnings || 0, 'warning')}` : 'No problems'),
        r.issues.length ? list : h(`<p class="okline">${E.icon('check', 'sm')}Ready to print: no overset text, missing fonts or links, or low-resolution pictures.</p>`),
        ui.row(ui.num('Lowest picture resolution', d.minPpi, (n) => { d.minPpi = n || 150; }, { min: 50, unit: 'ppi' })),
        ui.row(ui.btn('Check again', 'again', () => { d.preflight = null; E.drawProps(); }))];
    }
    return [];
  }
  async function runPreflight() {
    const r = await E.query('preflight', { minPpi: d.minPpi }).catch((e) => ({ issues: [{ severity: 'error', message: String(e.message || e) }] }));
    d.preflight = r || { issues: [] };
    if (st.tool === 'preflight') E.drawProps();
  }
  async function runFind(q, f = {}) {
    d.q = q;
    if (!q) return;
    const res = await E.query('find', { ...f, find: q }).catch(() => []);
    // Each match with a little of the story around it.
    const stories = new Map(st.model.stories.map((s) => [s.id, s.preview || '']));
    d.finds = res.map((x) => ({ ...x, context: x.text + (stories.get(x.story) ? `  ·  ${stories.get(x.story).slice(0, 40)}` : '') }));
    if (st.tool !== 'find') E.selectTool('find'); else E.drawProps();
  }
  async function replace() {
    const r = await E.ask('Find and change', [{ key: 'find', label: 'Find', value: $('.find', E.root())?.value || '' }, { key: 'change', label: 'Change to' }, { key: 'caseSensitive', label: 'Match case', kind: 'check' }, { key: 'wholeWord', label: 'Whole words only', kind: 'check' }, { key: 'grep', label: 'Pattern (GREP)', kind: 'check' }], 'Change all');
    if (r?.find) E.act('Change text', 'findChange', r);
  }
  function sync(s) {
    d.page = Math.min(d.page, Math.max(0, pages().length - 1));
    if (d.item != null && !items().some((x) => x.id === d.item)) d.item = null;
    if (d.story != null && !st.model.stories.some((x) => x.id === d.story)) d.story = null;
    if (d.story != null) { d.storyText = null; openStory(d.story); }
    d.preflight = null;
    d.finds = null;
  }
  return {
    name: 'DesignCraft', icon: 'layers', find: 'Find in document', zoom: true, sideTitle: 'Pages', stage, side, panel, sync, replace, onFind: (q) => runFind(q),
    keys: (e, c) => stage.keys(e, c) || (e.key === 'Delete' && d.item && !items().find((x) => x.id === d.item)?.story ? (E.act('Delete', 'deleteItems', { ids: [d.item] }), true) : false),
    tools: [
      ['Edit', [['select', 'cursor', 'Select', 'Click a frame to select it; a text frame opens its story.'], ['story', 'textEdit', 'Stories', 'Edit the text of any story.'], ['find', 'search', 'Find', 'Find and change text, with patterns.']]],
      ['Style', [['swatches', 'palette', 'Swatches', 'Change the document’s colours everywhere they’re used.'], ['fonts', 'textT', 'Fonts', 'See the fonts in use and replace them.']]],
      ['Pages', [['pages', 'page', 'Setup', 'Page size, margins, columns and bleed.'], ['preflight', 'shield', 'Preflight', 'Check for problems before printing.']]],
      ['Out', [['export', 'share', 'Export', 'PDF for print or screen, EPUB, IDML, package and booklet.']]],
    ],
    shortcuts: { v: 'select', t: 'story' },
    onTool: () => stage.decorate(),
    saveOptions: {
      pdf: [{ key: 'preset', def: 'print', choices: [['print', 'Print: PDF/X-4, bleed and marks'], ['web', 'Screen: small and tagged'], ['archive', 'Archive: PDF/A-2b']] }],
      epub: [{ key: 'fixed', def: false, kind: 'toggle', label: 'Fixed layout (every page as designed)' }],
    },
    dispose: () => { stage.dispose(); side.dispose(); },
  };
}

// ── EffectCraft ─────────────────────────────────────────────────────────────────────────────────────────────────────
const COMP_SIZES = [['1920x1080', 'HD 1920 × 1080'], ['1280x720', 'HD 1280 × 720'], ['3840x2160', '4K 3840 × 2160'], ['1080x1080', 'Square 1080 × 1080'], ['1080x1350', 'Portrait 1080 × 1350'], ['1080x1920', 'Story 1080 × 1920'], ['custom', 'Custom']];
const SPEEDS = [['0.5', '0.5×'], ['0.75', '0.75×'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2×']];
const FPS = [['12', '12'], ['15', '15'], ['23.976', '23.976'], ['24', '24'], ['25', '25'], ['29.97', '29.97'], ['30', '30'], ['50', '50'], ['60', '60']];
const LABEL_COLORS = ['#b53838', '#e4d84c', '#a9cbc7', '#e5bcc9', '#a9a9ca', '#e7c19e', '#b3c7b3', '#677de0', '#4aa44c', '#8e2c9a', '#e8920d', '#7f452a', '#f46dd6', '#3da2a5', '#a89677', '#1e401e'];
// A few of EffectCraft's effects for a layer, by id.
const MOTION_EFFECTS = [['ec.blur.gaussian', 'Gaussian Blur'], ['ec.perspective.dropshadow', 'Drop Shadow'], ['ec.stylize.glow', 'Glow'], ['ec.color.tint', 'Tint'], ['ec.color.blackwhite', 'Black & White'], ['ec.color.huesaturation', 'Hue/Saturation'], ['ec.generate.fill', 'Fill'], ['ec.generate.stroke', 'Stroke'], ['ec.blur.radial', 'Radial Blur']];
function motionApp(E) {
  const { st, ui } = E;
  const mo = { time: 0, layer: null, playing: false, frameUrl: null, want: null, transparent: false, vid: null };
  const comp = () => st.model?.comp || { duration: 1, fps: 30, width: 1920, height: 1080 };
  const el = h(`<section class="monitor motion">
    <div class="screen"><div class="canvas"><img alt=""><video muted playsinline preload="auto"></video></div></div>
    <div class="dock">
      <div class="transport">
        <button class="tb icon" data-m="start" title="Go to start (Home)">${E.icon('start')}</button>
        <button class="tb icon play" data-m="play" title="Play (Space)">${E.icon('play')}</button>
        <span class="tc"><b>0:00:00</b> / <span>0:00:00</span></span>
        <div class="grow"></div>
        <label class="chk" title="Show the background as transparent"><input type="checkbox" data-m="alpha">Transparency grid</label>
      </div>
      <div class="tl"><div class="ruler"><div class="wa"></div><div class="ph"></div></div><div class="rows"></div></div>
    </div>
  </section>`);
  const img = $('.screen img', el), video = $('video', el), canvas = $('.canvas', el), ruler = $('.ruler', el), rows = $('.rows', el);
  function fitCanvas() {
    const s = $('.screen', el), c = comp(), r = Math.min((s.clientWidth - 32) / c.width, (s.clientHeight - 32) / c.height);
    canvas.style.width = `${Math.max(20, c.width * r)}px`;
    canvas.style.height = `${Math.max(20, c.height * r)}px`;
  }
  const ro = new ResizeObserver(() => { fitCanvas(); frame(); });
  ro.observe($('.screen', el));
  // The frame under the playhead, drawn by EffectCraft at the size it is shown; while scrubbing only the latest is kept.
  async function frame() {
    if (!st.sess || mo.playing) return;
    const c = comp(), t = Math.min(mo.time, Math.max(0, c.duration - 1 / c.fps)), side = Math.round(Math.min(1600, Math.max(canvas.clientWidth, canvas.clientHeight) * (window.devicePixelRatio || 1)));
    const key = `${st.sess.rev}:${t.toFixed(3)}:${side}:${alpha()}`;
    if (mo.want === key) return;
    mo.want = key;
    const png = await E.call('render', st.sess.id, t, side, { transparent: alpha() }).catch(() => null);
    if (!png || mo.want !== key || E.st.disposed) return;
    const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
    if (mo.frameUrl) URL.revokeObjectURL(mo.frameUrl);
    mo.frameUrl = url;
    img.src = url;
    img.hidden = false;
    video.hidden = true;
  }
  function seek(t) {
    const c = comp();
    mo.time = Math.max(0, Math.min(c.duration, t));
    if (mo.playing) video.currentTime = mo.time;
    drawHead();
    frame();
  }
  function drawHead() {
    const c = comp();
    $('.tc b', el).textContent = fmtTime(mo.time, c.fps);
    $('.tc span', el).textContent = fmtTime(c.duration, c.fps);
    $('.ph', el).style.left = `${(mo.time / c.duration) * 100}%`;
  }
  // Play: a small video of the whole animation, made once for each step.
  async function play() {
    if (mo.playing) { pause(); return; }
    const p = mo.vid?.rev === st.sess.rev ? mo.vid.path : await prepare(E, el, mo);
    if (!p) return;
    if (video.dataset.src !== p) { video.src = mediaUrl(p); video.dataset.src = p; }
    mo.playing = true;
    el.classList.add('playing');
    $('[data-m=play]', el).innerHTML = E.icon('pause');
    video.hidden = false;
    img.hidden = true;
    if (mo.time >= comp().duration - 0.05) mo.time = 0;
    video.currentTime = mo.time;
    video.play().catch(() => pause());
    const tick = () => { if (!mo.playing) return; mo.time = video.currentTime; drawHead(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  function pause() {
    if (!mo.playing) return;
    mo.playing = false;
    el.classList.remove('playing');
    video.pause();
    $('[data-m=play]', el).innerHTML = E.icon('play');
    mo.time = video.currentTime || mo.time;
    drawHead();
    frame();
  }
  video.addEventListener('ended', pause);
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m === 'play') play();
    if (m === 'start') seek(0);
  });
  // With no solid layer showing, the animation is transparent and the grid shows it; otherwise it can be asked for.
  const clear = () => !(st.model?.layers || []).some((l) => l.kind === 'Solid' && l.enabled);
  const alpha = () => mo.transparent || clear();
  const syncAlpha = () => { const box = $('[data-m=alpha]', el); box.checked = alpha(); box.disabled = clear(); canvas.classList.toggle('grid', alpha()); };
  $('[data-m=alpha]', el).addEventListener('change', (e) => { mo.transparent = e.target.checked; syncAlpha(); mo.want = null; frame(); });
  const scrub = (e) => { const r = ruler.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * comp().duration); };
  $('.tl', el).addEventListener('pointerdown', (e) => {
    if (e.target.closest('.lrow .name, .lrow button')) return;
    if (!e.target.closest('.ruler') && !e.target.closest('.track')) return;
    if (mo.playing) pause();
    scrub(e);
    const mv = (ev) => scrub(ev);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  });
  // The composition's layers, front to back, with their time bars, as in the timeline of a motion app.
  function drawRows() {
    const c = comp(), L = st.model?.layers || [];
    $('.wa', el).style.left = `${(c.workStart / c.duration) * 100}%`;
    $('.wa', el).style.width = `${(Math.min(c.duration - c.workStart, c.workDuration) / c.duration) * 100}%`;
    ruler.querySelectorAll('.tick').forEach((x) => x.remove());
    const step = c.duration > 30 ? 5 : c.duration > 12 ? 2 : c.duration > 4 ? 1 : 0.5;
    for (let t = 0; t <= c.duration + 1e-6; t += step) ruler.append(h(`<span class="tick" style="left:${(t / c.duration) * 100}%">${t % 1 ? t.toFixed(1) : t}s</span>`));
    rows.innerHTML = L.map((l) => `<div class="lrow ${mo.layer === l.id ? 'sel' : ''} ${l.enabled ? '' : 'off'}" data-id="${l.id}">
      <button class="tb icon eye" data-eye="${l.id}" title="${l.enabled ? 'Hide' : 'Show'} ${esc(l.name)}">${E.icon(l.enabled ? 'eye' : 'eyeOff', 'sm')}</button>
      <span class="name" title="${esc(`${l.name} (${l.kind})`)}"><i style="background:${LABEL_COLORS[(l.label || 1) - 1] || '#888'}"></i>${esc(l.name)}<small>${esc(l.kind)}</small></span>
      <div class="track"><div class="bar" style="left:${(Math.max(0, l.inPoint) / c.duration) * 100}%;width:${(Math.max(0, Math.min(c.duration, l.outPoint) - Math.max(0, l.inPoint)) / c.duration) * 100}%;--c:${LABEL_COLORS[(l.label || 1) - 1] || '#888'}"></div></div>
    </div>`).join('');
    drawHead();
  }
  rows.addEventListener('click', (e) => {
    const eye = e.target.closest('[data-eye]');
    if (eye) { const l = st.model.layers.find((x) => x.id === Number(eye.dataset.eye)); E.act(l.enabled ? 'Hide layer' : 'Show layer', 'visible', { layer: l.id, value: !l.enabled }); return; }
    const r = e.target.closest('.lrow .name');
    if (r) { mo.layer = Number(r.parentNode.dataset.id); drawRows(); if (st.tool !== 'layers') E.selectTool('layers'); else E.drawProps(); }
  });
  const stage = { el, refresh: () => { fitCanvas(); drawRows(); syncAlpha(); mo.want = null; frame(); } };
  function panel(tool) {
    const m = st.model, c = m.comp;
    if (tool === 'layers') {
      const l = m.layers.find((x) => x.id === mo.layer);
      if (!l) return [ui.head(c.name, `${plural(m.layers.length, 'layer')}`), ui.tip('Click a layer’s name in the timeline to change it. The eye shows or hides it.'), ui.group('Composition', ui.list([
        { text: `${c.width} × ${c.height}`, meta: `${r1(c.fps)} fps`, icon: 'frame' }, { text: `${r1(c.duration)} s`, meta: plural(Math.round(c.duration * c.fps), 'frame'), icon: 'clock' },
      ], () => E.selectTool('comp')))];
      const text = m.texts.find((t) => t.id === l.id);
      return [ui.head(l.name, l.kind), ui.input('Name', l.name, (n) => n && n !== l.name && E.act('Rename layer', 'rename', { layer: l.id, name: n })),
        ...(text ? [ui.input('Text', text.text, (t) => t !== text.text && E.act('Edit text', 'text', { layer: l.id, text: t }), { area: true, rows: 3 }), ui.label('Text colour'), ui.swatches(COLORS, text.fill, (col) => col && E.act('Text colour', 'text', { layer: l.id, fill: col })), ui.slider('Size', 6, 400, 1, Math.round(text.size || 48), (n) => `${n} px`, (n) => E.act('Text size', 'text', { layer: l.id, size: n }))] : []),
        ui.toggle('Visible', l.enabled, (on) => E.act(on ? 'Show layer' : 'Hide layer', 'visible', { layer: l.id, value: on })),
        ui.slider('Opacity', 0, 100, 1, 100, (n) => `${n}%`, (n) => E.act('Opacity', 'opacity', { layer: l.id, value: n })),
        ui.group('Effects', ui.select('', [['', 'Add an effect…'], ...MOTION_EFFECTS], '', (fx) => fx && E.act(MOTION_EFFECTS.find((x) => x[0] === fx)[1], 'effect', { layer: l.id, effect: fx })),
          mo.presets?.length ? ui.select('', [['', 'Animate it in or out…'], ...mo.presets.map((x) => [x.id, x.name])], '', (id) => id && E.act(mo.presets.find((x) => x.id === id).name, 'preset', { layer: l.id, preset: id })) : null),
        ui.tip(`In ${r1(l.inPoint)} s, out ${r1(l.outPoint)} s${l.stretch !== 100 ? `, stretched ${Math.round(l.stretch)}%` : ''}.`),
        ui.row(ui.btn('Delete layer', 'delete', () => E.act('Delete layer', 'deleteLayer', { layer: l.id }).then((s) => { if (s) mo.layer = null; }), { danger: true }))];
    }
    if (tool === 'text') {
      if (!m.texts.length) return [ui.head('Text'), ui.tip('This animation has no text layers.')];
      return [ui.head('Text', plural(m.texts.length, 'text layer')), ...m.texts.map((t) => ui.group(`${t.name}${t.comp !== c.name ? ` · ${t.comp}` : ''}`,
        ui.input('', t.text, (x) => x !== t.text && E.act('Edit text', 'text', { layer: t.id, text: x }), { area: true, rows: 2, key: `t${t.id}` }),
        ui.row(ui.select('', [['', t.font || 'Font'], ...st.families.filter((f) => f !== t.font).map((f) => [f, f])], '', (f) => f && E.act('Font', 'text', { layer: t.id, font: f })), ui.colorpick(t.fill, (col) => E.act('Text colour', 'text', { layer: t.id, fill: col }))),
      )), ui.tip('Text inside nested compositions is listed too.')];
    }
    if (tool === 'color') {
      return [ui.head('Colours', plural(m.colors.length, 'colour')), ui.tip('Every colour that isn’t animated: shape fills and strokes, text and solids. Pick a new one to change it everywhere.'),
        ui.recolor(m.colors.map((x) => ({ hex: x.hex, meta: x.uses.length > 1 ? plural(x.uses.length, 'use') : x.uses[0], title: x.uses.join(', ') })), (x, to) => E.act('Recolour', 'recolor', { from: x.hex, to })),
        ui.group('Background', ui.row(ui.colorpick(c.background, (col) => E.act('Background', 'comp', { background: col }), 'Background colour')), ui.tip('Shown where nothing covers it. Renders with transparency leave it out.'),
          m.layers.some((l) => l.kind === 'Solid') ? ui.toggle('Transparent background', clear(), (on) => E.act(on ? 'Transparent background' : 'Background shown', 'transparent', { on })) : null,
          m.layers.some((l) => l.kind === 'Solid') ? ui.tip('Hides the solid layers behind the animation, so it can go over anything.') : null)];
    }
    if (tool === 'time') {
      const w = { start: r1(c.workStart), end: r1(c.workStart + c.workDuration) };
      return [ui.head('Timing', `${r1(c.duration)} s at ${r1(c.fps)} fps`),
        ui.group('Speed', ui.seg(SPEEDS, '', (f) => E.act(`${f}× speed`, 'speed', { factor: Number(f) }), 'full'), ui.tip('Faster makes the animation shorter; everything keeps its timing relative to the rest.')),
        ui.group('Trim', ui.row(ui.num('Start', w.start, (n) => { w.start = n; }, { min: 0, step: 0.1, unit: 's', key: 'ws' }), ui.num('End', w.end, (n) => { w.end = n; }, { min: 0, step: 0.1, unit: 's', key: 'we' })),
          ui.row(ui.btn('Start here', 'start', () => { $('[data-k=ws]', E.root()).value = r1(mo.time); }, { subtle: true, title: 'Start at the playhead' }), ui.btn('End here', 'stepF', () => { $('[data-k=we]', E.root()).value = r1(mo.time); }, { subtle: true, title: 'End at the playhead' })),
          ui.row(ui.btn('Trim', 'scissors', () => { const s = Number($('[data-k=ws]', E.root()).value), e = Number($('[data-k=we]', E.root()).value); if (e > s) E.act('Trim', 'trim', { start: s, end: e }); }, { primary: true }))),
        ui.group('Length and frame rate', ui.row(ui.num('Length', r1(c.duration), null, { min: 0.1, step: 0.1, unit: 's', key: 'dur' }), ui.select('Frame rate', FPS.some(([f]) => Math.abs(Number(f) - c.fps) < 0.01) ? FPS : [[String(c.fps), r1(c.fps)], ...FPS], FPS.find(([f]) => Math.abs(Number(f) - c.fps) < 0.01)?.[0] || String(c.fps), () => {}, { key: 'fps' })),
          ui.row(ui.btn('Apply', 'check', () => E.act('Length and frame rate', 'comp', { duration: Number($('[data-k=dur]', E.root()).value), fps: Number($('[data-k=fps]', E.root()).value) })))),
        ui.row(ui.btn('Play backwards', 'reverse', () => E.act('Reverse', 'reverse', {})))];
    }
    if (tool === 'comp') {
      const size = COMP_SIZES.find(([v]) => v === `${c.width}x${c.height}`)?.[0] || 'custom';
      return [ui.head('Composition', c.name),
        ui.select('Size', COMP_SIZES, size, (x) => { if (x !== 'custom') { const [w, hh] = x.split('x'); $('[data-k=cw]', E.root()).value = w; $('[data-k=ch]', E.root()).value = hh; } }),
        ui.row(ui.num('Width', c.width, null, { min: 16, step: 1, unit: 'px', key: 'cw' }), ui.num('Height', c.height, null, { min: 16, step: 1, unit: 'px', key: 'ch' })),
        ui.row(ui.btn('Resize', 'frame', () => E.act('Resize composition', 'comp', { width: Number($('[data-k=cw]', E.root()).value), height: Number($('[data-k=ch]', E.root()).value) }), { primary: true })),
        ui.tip('The content stays centred and keeps its size: a smaller frame crops the edges.')];
    }
    return [];
  }
  function keys(e) {
    if (e.code === 'Space') { play(); return true; }
    if (e.key === 'Home') { seek(0); return true; }
    if (e.key === 'End') { seek(comp().duration); return true; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { seek(mo.time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / comp().fps)); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && mo.layer) { E.act('Delete layer', 'deleteLayer', { layer: mo.layer }).then((s) => { if (s) mo.layer = null; }); return true; }
    return false;
  }
  function sync() {
    if (mo.playing) pause();
    const c = comp();
    if (mo.time > c.duration) mo.time = c.duration / 2;
    if (mo.layer && !st.model.layers.some((l) => l.id === mo.layer)) mo.layer = null;
  }
  return {
    name: 'EffectCraft', icon: 'sparkle', stage, panel, keys, sync,
    ready: () => { mo.time = comp().duration / 2; stage.refresh(); E.query('presets').then((l) => { mo.presets = l || []; }).catch(() => {}); },
    tools: [
      ['Edit', [['layers', 'layer', 'Layers', 'Click a layer to rename, hide or delete it.'], ['text', 'textT', 'Text', 'Change the words, font and colour of text layers.']]],
      ['Look', [['color', 'palette', 'Colours', 'Swap any colour for another, everywhere it’s used.']]],
      ['Time', [['time', 'speed', 'Timing', 'Speed up, slow down, trim and change the frame rate.'], ['comp', 'frame', 'Composition', 'Change the size of the frame.']]],
      ['Out', [['export', 'share', 'Render', 'Lottie, MP4, GIF, WebM, ProRes and PNG frames.']]],
    ],
    shortcuts: { v: 'layers', t: 'text' },
    saveOptions: { gif: [{ key: 'transparent', def: false, kind: 'toggle', label: 'Transparent background' }], mov: [{ key: 'transparent', def: false, kind: 'toggle', label: 'Transparent background (ProRes 4444)' }], webm: [{ key: 'transparent', def: false, kind: 'toggle', label: 'Transparent background' }] },
    dispose: () => { ro.disconnect(); video.pause(); if (mo.frameUrl) URL.revokeObjectURL(mo.frameUrl); },
  };
}

// ── FilmCraft timelines ─────────────────────────────────────────────────────────────────────────────────────────────
const SEQ_SIZES = [['1920x1080', 'HD 1920 × 1080'], ['1280x720', 'HD 1280 × 720'], ['3840x2160', '4K 3840 × 2160'], ['1080x1920', 'Vertical 1080 × 1920'], ['1080x1080', 'Square 1080 × 1080'], ['custom', 'Custom']];
const CLIP_COLORS = { Violet: '#8a6fd1', Iris: '#6f86d6', Caribbean: '#2aa198', Lavender: '#b48ae0', Cerulean: '#2f8fd8', Forest: '#3c8a3c', Rose: '#d6587a', Mango: '#e69a2e', Purple: '#9b4fc4', Blue: '#3c6fd8', Teal: '#2a9d9d', Magenta: '#cf4fb0', Tan: '#b8956a', Green: '#4caf50', Brown: '#8a5a3c', Yellow: '#d6c03c' };
// A few of FilmCraft's video effects, by id.
const FILM_EFFECTS = [['black_white', 'Black & White'], ['gaussian_blur', 'Gaussian Blur'], ['sharpen', 'Sharpen'], ['vignette', 'Vignette'], ['brightness_contrast', 'Brightness & Contrast'], ['tint', 'Tint'], ['horizontal_flip', 'Horizontal Flip'], ['mosaic', 'Mosaic'], ['drop_shadow', 'Drop Shadow'], ['camera_shake', 'Camera Shake'], ['light_leaks', 'Light Leaks'], ['rgb_split', 'RGB Split']];
function filmApp(E) {
  const { st, ui } = E;
  const fm = { frame: 0, clip: null, zoom: null, playing: false, vid: null, frameUrl: null, want: null, thumbs: new Map(), trim: 1 };
  const seq = () => st.model || { fps: 24, duration: 1, video: [], audio: [] };
  const tracks = () => [...[...seq().video].reverse(), ...seq().audio];
  const allClips = () => tracks().flatMap((t) => t.clips.map((c) => ({ ...c, track: t })));
  const clipById = (id) => allClips().find((c) => c.id === id);
  const el = h(`<section class="monitor film">
    <div class="screen"><div class="canvas"><img alt=""><video muted playsinline preload="auto"></video></div></div>
    <div class="dock">
      <div class="transport">
        <button class="tb icon" data-m="start" title="Go to start (Home)">${E.icon('start')}</button>
        <button class="tb icon" data-m="back" title="Back a frame (←)">${E.icon('step')}</button>
        <button class="tb icon play" data-m="play" title="Play (Space)">${E.icon('play')}</button>
        <button class="tb icon" data-m="fwd" title="Forward a frame (→)">${E.icon('stepF')}</button>
        <span class="tc"><b>0:00:00</b> / <span>0:00:00</span></span>
        <div class="grow"></div>
        <button class="tb" data-m="split" title="Split the clip under the playhead (S)">${E.icon('scissors', 'sm')}<span class="lbl">Split</span></button>
        <div class="seg"><button class="tb icon" data-m="zout" title="Zoom out">${E.icon('zoomOut', 'sm')}</button><button class="tb icon" data-m="zfit" title="Fit the timeline">${E.icon('fit', 'sm')}</button><button class="tb icon" data-m="zin" title="Zoom in">${E.icon('zoomIn', 'sm')}</button></div>
      </div>
      <div class="tv"><div class="heads"></div><div class="lanes"><div class="inner"><div class="ruler"></div><div class="ltracks"></div><div class="ph"></div></div></div></div>
    </div>
  </section>`);
  const img = $('.screen img', el), video = $('video', el), canvas = $('.canvas', el), lanes = $('.lanes', el), inner = $('.inner', el);
  const pxf = () => fm.zoom || Math.max(0.2, (lanes.clientWidth - 24) / Math.max(1, seq().duration));
  function fitCanvas() {
    const s = $('.screen', el), q = seq(), r = Math.min((s.clientWidth - 24) / (q.width || 16), (s.clientHeight - 24) / (q.height || 9));
    canvas.style.width = `${Math.max(20, (q.width || 16) * r)}px`;
    canvas.style.height = `${Math.max(20, (q.height || 9) * r)}px`;
  }
  const ro = new ResizeObserver(() => { fitCanvas(); draw(); frame(); });
  ro.observe(el);
  async function frame() {
    if (!st.sess || fm.playing) return;
    const q = seq(), f = Math.min(fm.frame, Math.max(0, q.duration - 1)), scale = Math.min(1, Math.max(0.1, (canvas.clientWidth * (window.devicePixelRatio || 1)) / (q.width || 1920)));
    const key = `${st.sess.rev}:${f}:${scale.toFixed(2)}`;
    if (fm.want === key) return;
    fm.want = key;
    const png = await E.call('render', st.sess.id, f, scale).catch(() => null);
    if (!png || fm.want !== key || E.st.disposed) return;
    const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
    if (fm.frameUrl) URL.revokeObjectURL(fm.frameUrl);
    fm.frameUrl = url;
    img.src = url;
    img.hidden = false;
    video.hidden = true;
  }
  function seek(f) {
    fm.frame = Math.max(0, Math.min(seq().duration, Math.round(f)));
    if (fm.playing) video.currentTime = fm.frame / seq().fps;
    drawHead();
    frame();
  }
  function drawHead() {
    const q = seq();
    $('.tc b', el).textContent = fmtTime(fm.frame / q.fps, Math.round(q.fps));
    $('.tc span', el).textContent = fmtTime(q.duration / q.fps, Math.round(q.fps));
    $('.ph', el).style.left = `${fm.frame * pxf()}px`;
  }
  async function play() {
    if (fm.playing) { pause(); return; }
    const p = fm.vid?.rev === st.sess.rev ? fm.vid.path : await prepare(E, el, fm);
    if (!p) return;
    if (video.dataset.src !== p) { video.src = mediaUrl(p); video.dataset.src = p; }
    fm.playing = true;
    el.classList.add('playing');
    $('[data-m=play]', el).innerHTML = E.icon('pause');
    video.hidden = false;
    img.hidden = true;
    if (fm.frame >= seq().duration - 1) fm.frame = 0;
    video.currentTime = fm.frame / seq().fps;
    video.play().catch(() => pause());
    const tick = () => { if (!fm.playing) return; fm.frame = Math.round(video.currentTime * seq().fps); drawHead(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  function pause() {
    if (!fm.playing) return;
    fm.playing = false;
    el.classList.remove('playing');
    video.pause();
    $('[data-m=play]', el).innerHTML = E.icon('play');
    fm.frame = Math.round((video.currentTime || 0) * seq().fps);
    drawHead();
    frame();
  }
  video.addEventListener('ended', pause);
  const split = () => {
    const at = fm.frame, c = fm.clip ? clipById(fm.clip) : allClips().find((x) => x.track.kind === 'video' && at > x.start && at < x.end);
    if (!c || at <= c.start || at >= c.end) { E.toast('Put the playhead over a clip to split it.'); return; }
    E.act('Split', 'split', { frame: at, clip: c.id });
  };
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    if (m === 'play') play();
    if (m === 'start') seek(0);
    if (m === 'back') seek(fm.frame - 1);
    if (m === 'fwd') seek(fm.frame + 1);
    if (m === 'split') split();
    if (m === 'zin') { fm.zoom = pxf() * 1.5; draw(); }
    if (m === 'zout') { fm.zoom = pxf() / 1.5; draw(); }
    if (m === 'zfit') { fm.zoom = null; draw(); }
  });
  lanes.addEventListener('scroll', () => { $('.heads', el).scrollTop = lanes.scrollTop; });
  const scrubAt = (e) => { const r = inner.getBoundingClientRect(); seek((e.clientX - r.left) / pxf()); };
  lanes.addEventListener('pointerdown', (e) => {
    const clip = e.target.closest('.clip');
    if (clip) {
      const c = clipById(Number(clip.dataset.id));
      if (st.tool === 'razor' && c) { const r = inner.getBoundingClientRect(), f = Math.round((e.clientX - r.left) / pxf()); if (f > c.start && f < c.end) E.act('Split', 'split', { frame: f, clip: c.id }); return; }
      fm.clip = c?.id ?? null;
      draw();
      if (st.tool !== 'clip') E.selectTool('clip'); else E.drawProps();
      return;
    }
    if (!e.target.closest('.ruler') && !e.target.closest('.ltracks')) return;
    if (fm.playing) pause();
    if (e.target.closest('.ltracks') && fm.clip) { fm.clip = null; draw(); E.drawProps(); }
    scrubAt(e);
    const mv = (ev) => scrubAt(ev);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  });
  // Tracks top to bottom as in the editing apps: video above (V1 nearest the middle), sound below.
  function draw() {
    const q = seq(), k = pxf(), list = tracks();
    inner.style.width = `${Math.max(lanes.clientWidth, q.duration * k + 40)}px`;
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * q.fps * k >= 70) || 600;
    $('.ruler', el).innerHTML = [...Array(Math.floor(q.duration / q.fps / step) + 1).keys()].map((i) => `<span class="tick" style="left:${i * step * q.fps * k}px">${Math.floor((i * step) / 60)}:${String((i * step) % 60).padStart(2, '0')}</span>`).join('') + (q.markers || []).map((mk) => `<i class="mk" style="left:${mk.at * k}px;--c:${CLIP_COLORS[mk.color] || mk.color || '#e69a2e'}" title="${esc(mk.name)}"></i>`).join('');
    $('.heads', el).innerHTML = `<div class="rh"></div>${list.map((t) => `<div class="th ${t.kind} ${(t.kind === 'video' ? !t.enabled : t.muted) ? 'off' : ''}"><b>${esc(t.label)}</b><span>${esc(t.name)}</span></div>`).join('')}`;
    $('.ltracks', el).innerHTML = list.map((t) => `<div class="lt ${t.kind} ${(t.kind === 'video' ? !t.enabled : t.muted) ? 'off' : ''}">${t.clips.map((c) => `<div class="clip ${t.kind} ${fm.clip === c.id ? 'sel' : ''} ${c.enabled ? '' : 'off'}" data-id="${c.id}" style="left:${c.start * k}px;width:${Math.max(2, c.duration * k - 1)}px;--c:${CLIP_COLORS[c.label] || '#6f86d6'}" title="${esc(`${c.name} · ${fmtTime(c.duration / q.fps)}${c.speed !== 1 ? ` · ${Math.round(c.speed * 100)}%` : ''}`)}">${t.kind === 'video' ? `<i class="th" style="${fm.thumbs.get(c.id) ? `background-image:url(${fm.thumbs.get(c.id)})` : ''}"></i>` : '<i class="wave"></i>'}<span class="cn">${esc(c.name)}</span><span class="cd">${esc(fmtTime(c.duration / q.fps))}${c.speed !== 1 ? ` · ${Math.round(c.speed * 100)}%` : ''}</span></div>`).join('')}${t.transitions.map((x) => `<i class="xf" style="left:${x.start * k}px;width:${Math.max(4, x.duration * k)}px" title="${esc(x.effect.replace(/_/g, ' '))}"></i>`).join('')}</div>`).join('');
    drawHead();
  }
  // Clip pictures come from the clip's own media, from the middle of the part used.
  async function loadThumbs() {
    const want = seq().video.flatMap((t) => t.clips).filter((c) => c.item != null).map((c) => ({ key: c.id, item: c.item, at: Math.round((c.sourceIn + c.sourceOut) / 2) }));
    const got = await E.call('thumbs', st.sess.id, want).catch(() => ({}));
    for (const [id, buf] of Object.entries(got || {})) { const old = fm.thumbs.get(Number(id)); if (old) URL.revokeObjectURL(old); fm.thumbs.set(Number(id), URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }))); }
    draw();
  }
  const stage = { el, refresh: () => { fitCanvas(); draw(); fm.want = null; frame(); loadThumbs(); } };
  // The first picture of an edit is often black (a fade in), so it opens on the middle of the first clip.
  const ready = () => { const c = seq().video.flatMap((t) => t.clips).sort((a, b) => a.start - b.start)[0]; if (c) seek(Math.round(c.start + c.duration / 2)); };
  function panel(tool) {
    const q = seq(), c = fm.clip ? clipById(fm.clip) : null;
    const secs = (f) => `${r1(f / q.fps)} s`;
    if (tool === 'select' || tool === 'razor' || (tool === 'clip' && !c)) {
      return [ui.head(q.name || 'Timeline', `${secs(q.duration)}, ${plural(allClips().length, 'clip')}`),
        ui.tip(tool === 'razor' ? 'Click a clip where it should be cut in two.' : 'Click a clip to trim, retime, rename or remove it. Click the ruler to move the playhead.'),
        ui.group('Clips', ui.list(seq().video.flatMap((t) => t.clips.map((x) => ({ text: x.name, meta: `${t.label} · ${secs(x.duration)}`, icon: 'video', on: x.id === fm.clip, id: x.id }))), (x) => { fm.clip = x.id; seek(clipById(x.id).start); draw(); E.selectTool('clip'); }, { empty: 'No video clips.' }))];
    }
    if (tool === 'clip') {
      const video = c.track.kind === 'video';
      const trim = (edge, n) => E.act(edge === 'in' ? 'Trim start' : 'Trim end', 'trim', { clip: c.id, edge, frames: n });
      const step = fm.trim === 1 ? 1 : Math.round(q.fps);
      return [ui.head(c.name, `${c.track.label} · ${secs(c.duration)}`),
        ui.input('Name', c.name, (n) => n && n !== c.name && E.act('Rename clip', 'rename', { clip: c.id, name: n })),
        ui.group('Trim', ui.seg([['1', 'By a frame'], ['s', 'By a second']], fm.trim === 1 ? '1' : 's', (x) => { fm.trim = x === '1' ? 1 : 's'; E.drawProps(); }, 'full'),
          ui.row(h('<span class="lab">Start</span>'), ui.btn('', 'back', () => trim('in', -step), { title: 'Start earlier' }), ui.btn('', 'chevron', () => trim('in', step), { title: 'Start later' })),
          ui.row(h('<span class="lab">End</span>'), ui.btn('', 'back', () => trim('out', -step), { title: 'End earlier' }), ui.btn('', 'chevron', () => trim('out', step), { title: 'End later' })),
          ui.tip('Later clips move up to close the gap, as with a ripple edit.')),
        ui.group('Speed', ui.seg([['50', '50%'], ['100', '100%'], ['150', '150%'], ['200', '200%']], String(Math.round(c.speed * 100)), (x) => E.act(`Speed ${x}%`, 'speed', { clips: [c.id], speed: Number(x) }), 'full')),
        video ? ui.group('Transition', ui.row(ui.btn('Dissolve in', 'transition', () => E.act('Cross dissolve', 'transition', { clip: c.id, edge: 'in' })), ui.btn('Dissolve out', 'transition', () => E.act('Cross dissolve', 'transition', { clip: c.id, edge: 'out' })))) : null,
        video ? ui.group('Effects', ui.select('', [['', 'Add an effect…'], ...FILM_EFFECTS], '', (fx) => fx && E.act(FILM_EFFECTS.find((x) => x[0] === fx)[1], 'effect', { clips: [c.id], effect: fx })),
          ui.row(ui.btn('Cut at scene changes', 'scissors', () => E.act('Scene edit detection', 'sceneCuts', { clips: [c.id] }), { title: 'Find the cuts inside this clip and split it there' }))) : null,
        !video ? ui.slider('Volume', -30, 12, 0.5, c.gain || 0, (n) => `${n > 0 ? '+' : ''}${n} dB`, (n) => E.act('Volume', 'gain', { clips: [c.id], db: n })) : null,
        ui.toggle('Enabled', c.enabled, () => E.act(c.enabled ? 'Disable clip' : 'Enable clip', 'enable', { clips: [c.id] })),
        ui.group('Order', ui.row(ui.btn('Move earlier', 'up', () => E.act('Move earlier', 'move', { clip: c.id, dir: 'earlier' })), ui.btn('Move later', 'down', () => E.act('Move later', 'move', { clip: c.id, dir: 'later' })))),
        ui.row(ui.btn('Remove', 'delete', () => E.act('Remove clip', 'remove', { clips: [c.id], ripple: true }).then((s) => { if (s) fm.clip = null; }), { danger: true, title: 'Remove the clip and close the gap' }), ui.btn('Lift', 'extract', () => E.act('Lift clip', 'remove', { clips: [c.id], ripple: false }).then((s) => { if (s) fm.clip = null; }), { title: 'Remove the clip and leave a gap' }))];
    }
    if (tool === 'look') {
      if (!fm.looks) { E.query('looks').then((l) => { fm.looks = l || []; if (st.tool === 'look') E.drawProps(); }).catch(() => { fm.looks = []; }); return [ui.head('Looks'), ui.tip('Loading looks…')]; }
      const target = c && c.track.kind === 'video' ? [c.id] : [];
      const groups = [...new Set(fm.looks.map((l) => l.folder))];
      return [ui.head('Looks', target.length ? c.name : 'every clip'), ui.tip(target.length ? 'Applied to the selected clip.' : 'Applied to every clip. Select a clip first to grade just that one.'),
        ...groups.map((g) => ui.group(g, ui.list(fm.looks.filter((l) => l.folder === g).map((l) => ({ text: l.name, meta: '', title: l.description, icon: 'sun' })), (x) => E.act(`Look: ${x.text}`, 'look', { name: x.text, clips: target }))))];
    }
    if (tool === 'title') {
      const t = { text: 'Title', seconds: 3, size: 100 };
      return [ui.head('Title'), ui.input('Text', t.text, (x) => { t.text = x; }, { key: 'ttext' }), ui.row(ui.num('Length', t.seconds, (n) => { t.seconds = n || 3; }, { min: 0.5, step: 0.5, unit: 's', key: 'tsec' }), ui.num('Size', t.size, (n) => { t.size = n || 100; }, { min: 8, step: 1, unit: 'px', key: 'tsize' })),
        ui.row(ui.btn('Add at the playhead', 'title', () => E.act('Add title', 'title', { text: $('[data-k=ttext]', E.root()).value || 'Title', seconds: Number($('[data-k=tsec]', E.root()).value) || 3, size: Number($('[data-k=tsize]', E.root()).value) || 100, frame: fm.frame }), { primary: true })),
        ui.tip('The title goes on a free video track above the pictures.')];
    }
    if (tool === 'sequence') {
      const size = SEQ_SIZES.find(([x]) => x === `${q.width}x${q.height}`)?.[0] || 'custom';
      return [ui.head('Sequence', q.name),
        ui.input('Name', q.name, null, { key: 'sname' }),
        ui.select('Frame size', SEQ_SIZES, size, (x) => { if (x !== 'custom') { const [w, hh] = x.split('x'); $('[data-k=sw]', E.root()).value = w; $('[data-k=sh]', E.root()).value = hh; } }),
        ui.row(ui.num('Width', q.width, null, { min: 16, step: 2, unit: 'px', key: 'sw' }), ui.num('Height', q.height, null, { min: 16, step: 2, unit: 'px', key: 'sh' })),
        ui.select('Frame rate', FPS.some(([f]) => Math.abs(Number(f) - q.fps) < 0.01) ? FPS : [[String(q.fps), r1(q.fps)], ...FPS], FPS.find(([f]) => Math.abs(Number(f) - q.fps) < 0.01)?.[0] || String(q.fps), () => {}, { key: 'sfps' }),
        ui.row(ui.btn('Apply', 'check', () => E.act('Sequence settings', 'sequence', { name: $('[data-k=sname]', E.root()).value, width: Number($('[data-k=sw]', E.root()).value), height: Number($('[data-k=sh]', E.root()).value), fps: Number($('[data-k=sfps]', E.root()).value) }), { primary: true })),
        ui.tip('Clips are scaled to fill the new frame size.'),
        ui.group('Tracks', ...tracks().map((t) => ui.toggle(`${t.label} ${t.name}`, t.kind === 'video' ? t.enabled : !t.muted, (on) => E.act(`${on ? 'Turn on' : 'Turn off'} ${t.label}`, 'track', t.kind === 'video' ? { track: t.id, enabled: on } : { track: t.id, muted: !on }))), ui.tip('A track turned off is left out of the picture or the sound.')),
        ui.group('Markers', q.markers?.length ? ui.list(q.markers.map((mk) => ({ text: mk.name || 'Marker', meta: fmtTime(mk.at / q.fps), swatch: CLIP_COLORS[mk.color] || '#e69a2e', at: mk.at })), (x) => seek(x.at)) : null,
          ui.row(ui.btn('Add a marker at the playhead', 'add', async () => { const r = await E.ask('Add marker', [{ key: 'name', label: 'Name', value: `Marker ${(q.markers?.length || 0) + 1}` }], 'Add'); if (r) E.act('Add marker', 'marker', { frame: fm.frame, name: r.name }); })))];
    }
    return [];
  }
  function keys(e) {
    const k = e.key;
    if (e.code === 'Space') { play(); return true; }
    if (k === 'Home') { seek(0); return true; }
    if (k === 'End') { seek(seq().duration); return true; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { seek(fm.frame + (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? Math.round(seq().fps) : 1)); return true; }
    if (k.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) { split(); return true; }
    if ((k === 'Delete' || k === 'Backspace') && fm.clip) { E.act('Remove clip', 'remove', { clips: [fm.clip], ripple: k === 'Delete' || e.shiftKey }).then((s) => { if (s) fm.clip = null; }); return true; }
    return false;
  }
  function sync() {
    if (fm.playing) pause();
    if (fm.clip && !clipById(fm.clip)) fm.clip = null;
    fm.frame = Math.min(fm.frame, seq().duration);
  }
  return {
    name: 'FilmCraft', icon: 'video', stage, panel, keys, sync, ready,
    tools: [
      ['Edit', [['select', 'cursor', 'Select', 'Click a clip to select it, click the ruler to move the playhead.'], ['razor', 'scissors', 'Razor', 'Click a clip to cut it in two there.']]],
      ['Clip', [['clip', 'video', 'Clip', 'Trim, retime, rename, reorder or remove the selected clip.'], ['look', 'sun', 'Looks', 'Colour grade a clip or the whole edit.'], ['title', 'title', 'Title', 'Add a title at the playhead.']]],
      ['Sequence', [['sequence', 'gear', 'Sequence', 'Frame size, frame rate and markers.']]],
      ['Out', [['export', 'share', 'Export', 'Render an MP4 or hand the edit over as FCPXML, XML, OTIO, EDL or AAF.']]],
    ],
    shortcuts: { v: 'select', c: 'razor' },
    saveOptions: { mp4: [{ key: 'scale', def: '1', choices: [['1', 'Full size'], ['0.5', 'Half size']] }] },
    dispose: () => { ro.disconnect(); video.pause(); if (fm.frameUrl) URL.revokeObjectURL(fm.frameUrl); fm.thumbs.forEach((u) => URL.revokeObjectURL(u)); },
  };
}

const APPS = { vectorcraft: vectorApp, designcraft: layoutApp, effectcraft: motionApp, filmcraft: filmApp };
