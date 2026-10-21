import { $, $$, esc, h, nameOf, dirOf, sep } from './ui.js';

const PT = 96 / 72;
const TOOLS = [
  ['select', 'cursor', 'Select', 'Select anything on the page (pictures, tables, drawings, text blocks) or what you’ve added. Delete removes it.'],
  ['edittext', 'textEdit', 'Edit text', 'Click any line of text to change it. Clear a line completely to delete it.'],
  ['addtext', 'textT', 'Add text', 'Click where you want to type.'],
  ['whiteout', 'whiteout', 'Erase', 'Drag over an area to erase it. Text underneath is removed for good.'],
  ['highlight', 'highlight', 'Highlight', 'Drag over text to highlight it.'],
  ['draw', 'pen', 'Draw', 'Draw freehand with the mouse, pen or finger.'],
  ['rect', 'square', 'Box', 'Drag to draw a rectangle.'],
  ['ellipse', 'circle', 'Oval', 'Drag to draw an oval.'],
  ['arrow', 'arrow', 'Arrow', 'Drag to draw an arrow.'],
  ['line', 'line', 'Line', 'Drag to draw a line.'],
];
const COLORS = ['#000000', '#3b3b3b', '#d13438', '#ca5010', '#ffb900', '#107c10', '#0f6cbd', '#5c2e91', '#ffffff'];
const HL = ['#ffe14d', '#a6f0a0', '#9fd8ff', '#ffb3d9', '#ffc58a'];
const TEXT_BG = ['none', '#fff4ce', '#dff6dd', '#cfe4fa', '#fde7e9', '#e8e0f5', '#ffffff', '#000000'];
// Lime's own fonts, the standard PDF fonts (which add nothing to the file for plain text), then the computer's own.
const BUILT_IN_FONTS = [['sans', 'Noto Sans', '"Noto Sans","Segoe UI",Arial,sans-serif'], ['serif', 'Noto Serif', '"Noto Serif","Times New Roman",serif'], ['carlito', 'Carlito (like Calibri)', 'Carlito,Calibri,sans-serif'],
  ['helvetica', 'Helvetica (like Arial)', 'Helvetica,Arial,sans-serif'], ['times', 'Times', '"Times New Roman",Times,serif'], ['courier', 'Courier', '"Courier New",Courier,monospace'],
  ['mono', 'Noto Sans Mono', '"Noto Sans Mono",Consolas,monospace'], ['caveat', 'Caveat (handwriting)', 'Caveat,cursive'], ['dancing', 'Dancing Script', '"Dancing Script",cursive']];
const fontCss = (f) => (String(f).startsWith('sys:') ? `"${String(f).slice(4).replace(/["\\]/g, '')}","Noto Sans",sans-serif` : (BUILT_IN_FONTS.find((x) => x[0] === f) || BUILT_IN_FONTS[0])[2]);

export function openEditor(view, { file, mode }, ctx) {
  const { icon, toast, api, go } = ctx;
  const call = (m, ...a) => api.invoke('editor:call', m, ...a);
  const st = {
    sess: null, file, savePath: null, zoom: 1, tool: mode === 'sign' ? 'select' : mode === 'pages' ? 'select' : 'edittext',
    pending: [], sel: null, pick: null, pages: [], renders: new Map(), lines: new Map(), objs: new Map(), selPages: new Set([0]), hits: [], hitIdx: -1,
    fonts: [], style: { font: 'sans', size: 14, color: '#000000', bold: false, italic: false, underline: false, strike: false, bg: 'none', align: 'left', lineHeight: 1.2, spacing: 0, opacity: 1, stroke: '#d13438', fill: 'none', width: 2, hl: '#ffe14d', erase: '#ffffff' },
    seq: 0, busy: false,
  };
  const root = h(`<div class="editor">
    <div class="cmdbar" role="toolbar" aria-label="PDF editor">
      <button class="tb" data-a="close" title="Close">${icon('back')}</button>
      <div class="doc">${icon('pdf')}<b title="${esc(file)}">${esc(nameOf(file))}</b><span class="dirty faint" hidden>• Unsaved</span></div>
      <div class="sep"></div>
      <button class="tb" data-a="undo" title="Undo (Ctrl+Z)">${icon('undo')}</button>
      <button class="tb" data-a="redo" title="Redo (Ctrl+Y)">${icon('redo')}</button>
      <div class="sep"></div>
      ${TOOLS.map(([id, ic, label]) => `<button class="tb" data-tool="${id}" title="${label}" aria-pressed="false">${icon(ic)}<span class="lbl ${['select', 'edittext', 'addtext', 'whiteout'].includes(id) ? '' : 'opt'}">${label}</span></button>`).join('')}
      <button class="tb" data-a="image" title="Add image">${icon('imageAdd')}<span class="lbl opt">Image</span></button>
      <button class="tb" data-a="sign" title="Add signature">${icon('signature')}<span class="lbl">Sign</span></button>
      <div class="grow"></div>
      <div class="search" style="width:200px;margin:0 6px">${icon('search', 'sm')}<input class="find" type="search" placeholder="Find" aria-label="Find in document"></div><button class="tb" data-a="replace" title="Find and replace (Ctrl H)">${icon('again')}</button>
      <button class="tb" data-a="zoomout" title="Zoom out (Ctrl −)">${icon('zoomOut')}</button><select class="zoom" title="Zoom" aria-label="Zoom"></select><button class="tb" data-a="zoomin" title="Zoom in (Ctrl +)">${icon('zoomIn')}</button>
      <button class="tb" data-a="fit" title="Fit width (Ctrl 0)">${icon('fit')}</button>
      <button class="tb" data-a="thumbs" title="Pages panel" aria-pressed="true">${icon('grid')}</button>
      <div class="sep"></div>
      <button class="btn" data-a="saveas">Save as…</button>
      <button class="btn primary" data-a="save">${icon('save', 'sm')}Save</button>
    </div>
    <div class="ed-body">
      <aside class="thumbs" aria-label="Pages"><div class="ops">
        <button class="tb" data-p="rotl" title="Rotate left">${icon('rotate', 'sm')}</button>
        <button class="tb" data-p="rotr" title="Rotate right" style="transform:scaleX(-1)">${icon('rotate', 'sm')}</button>
        <button class="tb" data-p="dup" title="Duplicate">${icon('copy', 'sm')}</button>
        <button class="tb" data-p="blank" title="Insert blank page">${icon('docAdd', 'sm')}</button>
        <button class="tb" data-p="file" title="Insert pages from a file">${icon('add', 'sm')}</button>
        <button class="tb" data-p="extract" title="Save selected pages as a new PDF">${icon('extract', 'sm')}</button>
        <button class="tb" data-p="del" title="Delete">${icon('delete', 'sm')}</button>
      </div><div class="tlist"></div></aside>
      <section class="pages" tabindex="-1"><div class="ed-status" hidden></div></section>
      <aside class="props" aria-label="Properties"></aside>
    </div></div>`);
  view.append(root);
  const pagesEl = $('.pages', root), tlist = $('.tlist', root), props = $('.props', root), status = $('.ed-status', root), body = $('.ed-body', root);
  let disposed = false;
  const k = () => st.zoom * PT;

  call('fonts').then((list) => { st.fonts = list || []; if (st.sel?.type === 'text' || st.sel?.type === 'replace' || ['addtext', 'edittext'].includes(st.tool)) renderProps(); }).catch(() => {});
  async function load(password) {
    try {
      st.sess = await call('open', file, password);
    } catch (e) {
      const msg = String(e.message || e);
      if (/password/i.test(msg)) {
        const pw = await prompt('This PDF is protected', 'Enter the password to open it for editing.', 'password');
        if (pw) return load(pw);
      }
      toast(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { type: 'error' });
      go();
      return;
    }
    layout(true);
    fitWidth();
    selectTool(st.tool);
    if (mode === 'sign') setTimeout(signDialog, 200);
    if (mode === 'pages') tip('Drag pages in the panel to reorder. Select several with Ctrl or Shift.');
  }

  let io = null, tio = null;
  function layout(rebuildThumbs) {
    io?.disconnect();
    pagesEl.querySelectorAll('.pdfpage').forEach((p) => p.remove());
    st.renders.forEach((r) => URL.revokeObjectURL(r.url));
    st.renders.clear();
    st.lines.clear();
    st.objs.clear();
    st.pick = null;
    st.pages = st.sess.pages.map((p, i) => {
      const el = h(`<div class="pdfpage" data-p="${i}"><img class="r" alt=""><span class="num">${i + 1}</span><div class="layer"></div></div>`);
      pagesEl.append(el);
      return { ...p, el, layer: $('.layer', el), img: $('img', el), visible: false };
    });
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const p = st.pages[Number(en.target.dataset.p)];
        if (!p) continue;
        p.visible = en.isIntersecting;
        if (en.isIntersecting) { renderPage(p, Number(en.target.dataset.p)); if (st.tool === 'edittext') showLines(Number(en.target.dataset.p)); if (st.tool === 'select') showObjects(Number(en.target.dataset.p)); }
      }
    }, { root: pagesEl, rootMargin: '600px 0px' });
    st.pages.forEach((p) => io.observe(p.el));
    sizePages();
    st.pages.forEach((p, i) => p.layer.addEventListener('pointerdown', (e) => onPointerDown(e, i)));
    st.pending.forEach(mountObj);
    if (rebuildThumbs) buildThumbs();
    updateChrome();
  }
  // Zoom presets in the toolbar menu; the current zoom shows first when it isn't one of them.
  const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
  function zoomMenu() {
    const z = Math.round(st.zoom * 100), sel = $('.zoom', root);
    sel.innerHTML = `${ZOOMS.includes(z / 100) ? '' : `<option value="${st.zoom}">${z}%</option>`}${ZOOMS.map((v) => `<option value="${v}">${Math.round(v * 100)}%</option>`).join('')}<option value="width">Fit width</option><option value="page">Fit page</option>`;
    sel.value = String(ZOOMS.includes(z / 100) ? z / 100 : st.zoom);
  }
  let decorT = null;
  function sizePages(quick) {
    for (const p of st.pages) { p.el.style.width = `${p.w * k()}px`; p.el.style.height = `${p.h * k()}px`; }
    zoomMenu();
    st.pending.forEach(positionObj);
    // During a pinch only the pages and what's been added follow at once; the clickable lines and outlines are
    // rebuilt when it settles.
    const decorate = () => {
      if (st.tool === 'edittext') st.pages.forEach((p, i) => p.visible && showLines(i));
      if (st.tool === 'select') st.pages.forEach((p, i) => p.visible && showObjects(i));
      drawHits();
    };
    clearTimeout(decorT);
    if (quick) { pagesEl.querySelectorAll('.tline:not(.mask), .pobj').forEach((x) => x.remove()); decorT = setTimeout(decorate, 160); return; }
    decorate();
  }
  async function renderPage(p, i) {
    const scale = Math.min(4, k() * (window.devicePixelRatio || 1));
    const have = st.renders.get(i);
    if (have && Math.abs(have.scale - scale) < 0.01) return;
    if (p.rendering === scale) return;
    p.rendering = scale;
    try {
      const png = await call('render', st.sess.id, i, scale);
      if (disposed || p.rendering !== scale) return;
      const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
      if (have) URL.revokeObjectURL(have.url);
      st.renders.set(i, { scale, url });
      p.img.src = url;
    } catch (_) {} finally { if (p.rendering === scale) p.rendering = null; }
  }
  let rerenderT = null;
  // Zooming keeps the spot under the pointer (or the middle of the view) where it is, so the page doesn't jump away;
  // the pages are drawn sharp again once it settles.
  function setZoom(z, at) {
    const old = st.zoom, nz = Math.min(5, Math.max(0.2, z));
    if (Math.abs(nz - old) < 1e-4 || !st.pages.length) return;
    const r = pagesEl.getBoundingClientRect(), ax = at ? at.x : r.left + pagesEl.clientWidth / 2, ay = at ? at.y : r.top + pagesEl.clientHeight / 2;
    const page = st.pages.find((p) => { const b = p.el.getBoundingClientRect(); return ay >= b.top - 12 && ay <= b.bottom + 12; }) || st.pages.find((p) => p.visible) || st.pages[0];
    const b0 = page.el.getBoundingClientRect(), fx = (ax - b0.left) / b0.width, fy = (ay - b0.top) / b0.height;
    st.zoom = nz;
    sizePages(true);
    const b1 = page.el.getBoundingClientRect();
    pagesEl.scrollLeft += b1.left + fx * b1.width - ax;
    pagesEl.scrollTop += b1.top + fy * b1.height - ay;
    clearTimeout(rerenderT);
    rerenderT = setTimeout(() => st.pages.forEach((p, i) => p.visible && renderPage(p, i)), 180);
  }
  function fitWidth() {
    const avail = pagesEl.clientWidth - 96;
    const w = Math.max(...st.pages.map((p) => p.w));
    setZoom(Math.min(3, avail / (w * PT)));
  }
  function fitPage() {
    const p = st.pages.find((x) => x.visible) || st.pages[0];
    if (!p) return;
    setZoom(Math.min((pagesEl.clientWidth - 96) / (p.w * PT), (pagesEl.clientHeight - 56) / (p.h * PT)));
    p.el.scrollIntoView({ block: 'center' });
  }

  function buildThumbs() {
    tio?.disconnect();
    tlist.innerHTML = '';
    tio = new IntersectionObserver(async (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting || en.target.dataset.done) continue;
        en.target.dataset.done = '1';
        const i = Number(en.target.dataset.i);
        const png = await call('render', st.sess.id, i, 150 / Math.max(st.sess.pages[i].w, st.sess.pages[i].h)).catch(() => null);
        if (png && !disposed) $('img', en.target).src = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
      }
    }, { root: tlist.parentElement, rootMargin: '300px' });
    st.sess.pages.forEach((p, i) => {
      const t = h(`<div class="pthumb ${st.selPages.has(i) ? 'sel' : ''}" draggable="true" data-i="${i}" tabindex="0" aria-label="Page ${i + 1}"><img alt="" style="aspect-ratio:${p.w}/${p.h}"><small>${i + 1}</small></div>`);
      t.addEventListener('click', (e) => {
        if (e.ctrlKey) { if (st.selPages.has(i)) st.selPages.delete(i); else st.selPages.add(i); }
        else if (e.shiftKey) { const a = Math.min(...st.selPages, i), b = Math.max(...st.selPages, i); st.selPages = new Set(Array.from({ length: b - a + 1 }, (_, x) => a + x)); }
        else { st.selPages = new Set([i]); st.pages[i].el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        $$('.pthumb', tlist).forEach((x) => x.classList.toggle('sel', st.selPages.has(Number(x.dataset.i))));
      });
      t.addEventListener('dragstart', (e) => { if (!st.selPages.has(i)) { st.selPages = new Set([i]); } e.dataTransfer.setData('text/x-page', String(i)); e.dataTransfer.effectAllowed = 'move'; });
      t.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-page')) { e.preventDefault(); t.classList.add('drop-before'); } });
      t.addEventListener('dragleave', () => t.classList.remove('drop-before'));
      t.addEventListener('drop', (e) => { e.preventDefault(); t.classList.remove('drop-before'); pageOp({ type: 'move', pages: [...st.selPages], to: i }); });
      tlist.append(t);
      tio.observe(t);
    });
    const end = h(`<div style="height:40px" aria-hidden="true"></div>`);
    end.addEventListener('dragover', (e) => e.preventDefault());
    end.addEventListener('drop', (e) => { e.preventDefault(); pageOp({ type: 'move', pages: [...st.selPages], to: st.sess.pages.length }); });
    tlist.append(end);
  }
  async function busy(label, fn) {
    if (st.busy) return null;
    st.busy = true;
    tip(label, true);
    try { return await fn(); }
    catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { type: 'error' }); return null; }
    finally { st.busy = false; tip(null); }
  }
  async function flush() {
    commitEditing();
    if (!st.pending.length) return true;
    const edits = st.pending.map(serialize).filter(Boolean);
    const info = await call('apply', st.sess.id, edits);
    st.pending.forEach((o) => o.el?.remove());
    st.pending = [];
    st.sel = null;
    st.sess = info;
    return true;
  }
  async function pageOp(op) {
    await busy('Updating pages…', async () => {
      await flush();
      st.sess = await call('pageOp', st.sess.id, op);
      st.selPages = new Set([Math.min(op.to ?? [...st.selPages][0] ?? 0, st.sess.pages.length - 1)]);
      layout(true);
    });
  }
  $('.ops', root).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const sel = [...st.selPages].sort((a, c) => a - c);
    const a = b.dataset.p;
    if (a === 'rotl' || a === 'rotr') pageOp({ type: 'rotate', pages: sel, angle: a === 'rotl' ? -90 : 90 });
    if (a === 'del') { if (sel.length >= st.sess.pages.length) { toast('A PDF needs at least one page.', { type: 'error' }); return; } pageOp({ type: 'delete', pages: sel }); }
    if (a === 'dup') pageOp({ type: 'duplicate', pages: sel });
    if (a === 'blank') pageOp({ type: 'blank', at: (sel[sel.length - 1] ?? 0) + 1 });
    if (a === 'file') { const [f] = await api.invoke('dialog:open', { multi: false, filters: [{ name: 'PDF or image', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'tif', 'tiff'] }] }); if (f) pageOp({ type: 'insertFile', file: f, at: (sel[sel.length - 1] ?? 0) + 1 }); }
    if (a === 'extract') {
      const out = await api.invoke('dialog:save', { defaultPath: `${dirOf(file)}${sep}${nameOf(file).replace(/\.pdf$/i, '')} - pages ${sel.map((x) => x + 1).join(',')}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (out) await busy('Saving pages…', async () => { await flush(); layout(false); await call('exportPages', st.sess.id, sel, out); toast(`Saved ${nameOf(out)}`, { type: 'success', actions: [{ label: 'Show in folder', fn: () => api.invoke('shell:show', out) }] }); });
    }
  });

  async function showLines(i) {
    const p = st.pages[i];
    if (!p) return;
    if (!st.lines.has(i)) st.lines.set(i, call('text', st.sess.id, i).catch(() => []));
    const lines = await st.lines.get(i);
    if (st.tool !== 'edittext' || disposed) return;
    p.layer.querySelectorAll('.tline:not(.mask)').forEach((x) => x.remove());
    const kk = k();
    const taken = new Set(st.pending.filter((o) => o.page === i && o.lineId).map((o) => o.lineId));
    for (const l of lines) {
      if (!l.editable || taken.has(l.id)) continue;
      const [x0, y0, x1, y1] = l.bbox;
      const el = h(`<div class="tline" style="left:${x0 * kk}px;top:${y0 * kk}px;width:${(x1 - x0) * kk}px;height:${(y1 - y0) * kk}px" title="Click to edit"></div>`);
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); beginLineEdit(i, l, el); });
      p.layer.append(el);
    }
  }
  function hideLines() { pagesEl.querySelectorAll('.tline:not(.mask)').forEach((x) => x.remove()); }
  // In Select, the page's own pictures, tables, drawings and text blocks can be picked too, and removed from the file
  // for good (not covered over) when it is saved.
  const KIND = { image: 'Picture', table: 'Table', drawing: 'Drawing', text: 'Text block' };
  async function showObjects(i) {
    const p = st.pages[i];
    if (!p) return;
    if (!st.objs.has(i)) st.objs.set(i, call('objects', st.sess.id, i).catch(() => []));
    const list = await st.objs.get(i);
    if (st.tool !== 'select' || disposed) return;
    p.layer.querySelectorAll('.pobj').forEach((x) => x.remove());
    const kk = k(), gone = new Set(st.pending.filter((o) => o.type === 'erase' && o.page === i).map((o) => o.objId));
    const under = p.layer.firstChild;
    for (const it of list) {
      if (gone.has(it.id)) continue;
      const [x0, y0, x1, y1] = it.bbox;
      const el = h(`<div class="pobj${st.pick?.obj.id === it.id ? ' sel' : ''}" data-id="${it.id}" title="${KIND[it.kind]}: click to select, then Delete" style="left:${x0 * kk}px;top:${y0 * kk}px;width:${(x1 - x0) * kk}px;height:${(y1 - y0) * kk}px"></div>`);
      el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); pickObj(i, it); });
      p.layer.insertBefore(el, under);
    }
  }
  function hideObjects() { pagesEl.querySelectorAll('.pobj').forEach((x) => x.remove()); st.pick = null; }
  function pickObj(i, it) {
    commitEditing();
    st.sel = null;
    st.pending.forEach((x) => x.el?.classList.remove('sel'));
    st.pick = { page: i, obj: it };
    pagesEl.querySelectorAll('.pobj').forEach((x) => x.classList.toggle('sel', x.dataset.id === it.id));
    renderProps();
  }
  function erasePicked() {
    const { page, obj } = st.pick;
    st.pick = null;
    const [x0, y0, x1, y1] = obj.bbox;
    const o = addObj({ type: 'erase', page, rect: [x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2], bbox: obj.bbox, kind: obj.kind, objId: obj.id });
    showObjects(page);
    select(o);
  }
  // The closest font for an edited line: the same font if it's installed, a look-alike if not (Carlito for Calibri,
  // Helvetica for Arial, Times for Times New Roman), else serif, sans or mono as the original was.
  function matchFont(l) {
    const norm = (n) => String(n || '').replace(/^[A-Z]{6}\+/, '').replace(/[-,_ ]?(Bold|Italic|Oblique|Regular|Roman|Medium|Semibold|SemiBold|Light|Black|BoldItalic|BoldOblique|BdIt|Bd|It)+$/i, '').replace(/(MT|PS|Std|Pro)$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const base = norm(l.font);
    if (base) {
      const hit = st.fonts.find((f) => norm(f.family) === base);
      if (hit) return `sys:${hit.family}`;
      if (/calibri/.test(base)) return 'carlito';
      if (/arial|helvetica/.test(base)) return 'helvetica';
      if (/times/.test(base)) return 'times';
      if (/courier/.test(base)) return 'courier';
    }
    return l.mono ? 'mono' : l.serif ? 'serif' : 'sans';
  }
  function beginLineEdit(page, line, el) {
    commitEditing();
    el.remove();
    const o = addObj({
      type: 'replace', page, lineId: line.id, bbox: line.bbox, x: line.origin[0], y: line.origin[1], text: line.text, original: line.text,
      size: line.size, font: matchFont(line), bold: line.bold, italic: line.italic, color: line.color,
    });
    select(o);
    editText(o, true);
  }

  function addObj(o) {
    o.id = ++st.seq;
    st.pending.push(o);
    mountObj(o);
    updateChrome();
    return o;
  }
  function mountObj(o) {
    const p = st.pages[o.page];
    if (!p) return;
    o.el?.remove();
    o.mask?.remove();
    if (o.type === 'replace' || o.type === 'deleteText') {
      const [x0, y0, x1, y1] = o.bbox;
      o.mask = h(`<div class="tline mask"></div>`);
      o.mask._box = [x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2];
      p.layer.append(o.mask);
      // The mask is the page itself with this line's text taken out, so only the words change on screen.
      const mask = o.mask;
      call('patch', st.sess.id, o.page, o.bbox, Math.min(4, k() * (window.devicePixelRatio || 1) * 1.5)).then((png) => {
        if (!png || o.mask !== mask) return;
        mask.style.backgroundImage = `url(${URL.createObjectURL(new Blob([png], { type: 'image/png' }))})`;
        mask.classList.add('ready');
      }).catch(() => mask.classList.add('plain'));
    }
    let el;
    if (o.type === 'replace' || o.type === 'text') {
      el = h(`<div class="obj text" spellcheck="false"></div>`);
      el.textContent = o.text;
    } else if (o.type === 'deleteText') return positionObj(o);
    else if (o.type === 'whiteout') el = h(`<div class="obj"></div>`);
    else if (o.type === 'erase') {
      // What the page looks like with it gone, as saving will leave it.
      el = h(`<div class="obj erase" title="Removed ${esc(KIND[o.kind] || 'area').toLowerCase()}: select and press Delete to put it back"></div>`);
      const box = el;
      call('patch', st.sess.id, o.page, o.bbox, Math.min(4, k() * (window.devicePixelRatio || 1) * 1.5), 'erase').then((png) => { if (png && o.el === box) box.style.backgroundImage = `url(${URL.createObjectURL(new Blob([png], { type: 'image/png' }))})`; }).catch(() => { box.style.background = '#fff'; });
    }
    else if (o.type === 'highlight') el = h(`<div class="obj" style="mix-blend-mode:multiply"></div>`);
    else if (o.type === 'image' || o.type === 'signature') el = h(`<div class="obj"><img alt="" src="${o.data}"></div>`);
    else el = h(`<div class="obj"><svg></svg></div>`);
    el.append(h(`<span class="handle" aria-hidden="true"></span>`));
    el.addEventListener('pointerdown', (e) => onObjPointer(e, o));
    el.addEventListener('dblclick', () => { if (o.type === 'text' || o.type === 'replace') editText(o, false); });
    o.el = el;
    p.layer.append(el);
    positionObj(o);
  }
  function positionObj(o) {
    const kk = k();
    if (o.mask) {
      const [x, y, w, hh] = o.mask._box;
      Object.assign(o.mask.style, { left: `${x * kk}px`, top: `${y * kk}px`, width: `${w * kk}px`, height: `${hh * kk}px` });
    }
    const el = o.el;
    if (!el) return;
    const css = (x, y, w, hh) => Object.assign(el.style, { left: `${x * kk}px`, top: `${y * kk}px`, width: w == null ? '' : `${w * kk}px`, height: hh == null ? '' : `${hh * kk}px` });
    if (o.type === 'text' || o.type === 'replace') {
      css(o.x, o.y - o.size * 0.86);
      Object.assign(el.style, {
        fontSize: `${o.size * kk}px`, color: o.color, fontWeight: o.bold ? '700' : '400', fontStyle: o.italic ? 'italic' : 'normal', fontFamily: fontCss(o.font),
        textDecoration: [o.underline && 'underline', o.strike && 'line-through'].filter(Boolean).join(' ') || 'none', textAlign: o.align || 'left',
        lineHeight: String(o.lineHeight || 1.2), letterSpacing: `${(o.spacing || 0) * kk}px`, opacity: String(o.opacity ?? 1),
        // The background reaches a little past the words, as it will in the saved file.
        background: o.bg && o.bg !== 'none' ? o.bg : '', boxShadow: o.bg && o.bg !== 'none' ? `0 0 0 ${o.size * 0.18 * kk}px ${o.bg}` : '',
      });
      return;
    }
    if (o.rect) {
      const [x, y, w, hh] = o.rect;
      css(x, y, w, hh);
      if (o.type === 'whiteout') el.style.background = o.fill || '#ffffff';
      if (o.type === 'highlight') el.style.background = o.color;
      if (o.type === 'highlight') el.style.opacity = '0.5';
      if (o.type === 'rect' || o.type === 'ellipse') {
        const sw = (o.width || 2) * kk;
        const shape = o.type === 'rect' ? `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, w * kk - sw)}" height="${Math.max(0, hh * kk - sw)}"` : `<ellipse cx="${w * kk / 2}" cy="${hh * kk / 2}" rx="${Math.max(0, w * kk / 2 - sw / 2)}" ry="${Math.max(0, hh * kk / 2 - sw / 2)}"`;
        $('svg', el).innerHTML = `${shape} fill="${o.fill && o.fill !== 'none' ? o.fill : 'none'}" stroke="${o.stroke}" stroke-width="${sw}"/>`;
      }
      return;
    }
    if (o.type === 'line' || o.type === 'arrow') {
      const x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2);
      css(x, y, Math.max(1, Math.abs(o.x2 - o.x1)), Math.max(1, Math.abs(o.y2 - o.y1)));
      const sw = (o.width || 2) * kk;
      const ax = (o.x1 - x) * kk, ay = (o.y1 - y) * kk, bx = (o.x2 - x) * kk, by = (o.y2 - y) * kk;
      let head = '';
      if (o.type === 'arrow') {
        const a = Math.atan2(by - ay, bx - ax), L = (6 + (o.width || 2) * 3) * kk;
        head = [-0.45, 0.45].map((d) => `<line x1="${bx}" y1="${by}" x2="${bx - L * Math.cos(a + d)}" y2="${by - L * Math.sin(a + d)}"/>`).join('');
      }
      $('svg', el).innerHTML = `<g stroke="${o.stroke}" stroke-width="${sw}" stroke-linecap="round"><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>${head}</g>`;
      return;
    }
    if (o.type === 'ink') {
      const xs = o.points.map((q) => q[0]), ys = o.points.map((q) => q[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      css(x, y, Math.max(1, Math.max(...xs) - x), Math.max(1, Math.max(...ys) - y));
      $('svg', el).innerHTML = `<polyline fill="none" stroke="${o.stroke}" stroke-width="${(o.width || 2) * kk}" stroke-linecap="round" stroke-linejoin="round" points="${o.points.map((q) => `${(q[0] - x) * kk},${(q[1] - y) * kk}`).join(' ')}"/>`;
    }
  }
  const textStyle = (o) => ({ size: o.size, font: o.font, bold: o.bold, italic: o.italic, color: o.color, underline: !!o.underline, strike: !!o.strike, bg: o.bg && o.bg !== 'none' ? o.bg : '', align: o.align || 'left', lineHeight: o.lineHeight || 1.2, spacing: o.spacing || 0, opacity: o.opacity ?? 1 });
  function serialize(o) {
    const base = { page: o.page, type: o.type };
    switch (o.type) {
      case 'replace': return o.text === o.original && !o.styled ? null : (o.text.trim() ? { ...base, bbox: o.bbox, x: o.x, y: o.y, text: o.text, ...textStyle(o) } : { page: o.page, type: 'deleteText', bbox: o.bbox });
      case 'deleteText': return { ...base, bbox: o.bbox };
      case 'text': return o.text.trim() ? { ...base, x: o.x, y: o.y, text: o.text, ...textStyle(o) } : null;
      case 'whiteout': return { ...base, rect: o.rect, fill: o.fill };
      case 'erase': return { ...base, rect: o.rect };
      case 'highlight': return { ...base, rect: o.rect, color: o.color, opacity: 0.45 };
      case 'rect': case 'ellipse': return { ...base, rect: o.rect, stroke: o.stroke, fill: o.fill, width: o.width };
      case 'line': case 'arrow': return { ...base, x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, stroke: o.stroke, width: o.width };
      case 'ink': return { ...base, points: o.points, stroke: o.stroke, width: o.width };
      case 'image': case 'signature': return { ...base, rect: o.rect, data: o.data };
      default: return null;
    }
  }
  // Copies of added things: everything about them except where they live on screen.
  let clip = null;
  const serializeObj = (o) => { const { el, mask, id, ...rest } = o; return rest; };
  function shiftObj(o, dx, dy) {
    if (o.rect) o.rect = [o.rect[0] + dx, o.rect[1] + dy, o.rect[2], o.rect[3]];
    else if (o.points) o.points = o.points.map((q) => [q[0] + dx, q[1] + dy]);
    else if (o.x1 != null) Object.assign(o, { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy });
    else if (o.x != null) Object.assign(o, { x: o.x + dx, y: o.y + dy });
    positionObj(o);
    updateChrome();
  }
  function duplicate(o, by) {
    if (o.type === 'replace' || o.type === 'deleteText' || o.type === 'erase') return;
    const c = addObj(JSON.parse(JSON.stringify(serializeObj(o))));
    shiftObj(c, by, by);
    select(c);
  }
  function removeObj(o) {
    o.el?.remove(); o.mask?.remove();
    st.pending = st.pending.filter((x) => x !== o);
    if (st.sel === o) st.sel = null;
    if (o.type === 'replace' && st.tool === 'edittext') showLines(o.page);
    if (o.type === 'erase' && st.tool === 'select') showObjects(o.page);
    renderProps(); updateChrome();
  }
  function select(o) {
    st.sel = o;
    st.pick = null;
    pagesEl.querySelectorAll('.pobj.sel').forEach((x) => x.classList.remove('sel'));
    st.pending.forEach((x) => x.el?.classList.toggle('sel', x === o));
    renderProps();
  }
  let editing = null;
  function editText(o, selectAll) {
    commitEditing();
    editing = o;
    o.el.contentEditable = 'plaintext-only';
    o.el.focus();
    const r = document.createRange();
    r.selectNodeContents(o.el);
    if (!selectAll) r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    o.el.oninput = () => { o.text = o.el.innerText.replace(/\n$/, ''); updateChrome(); };
    o.el.onkeydown = (e) => {
      const fmt = (e.ctrlKey || e.metaKey) && { b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()];
      if (fmt) { e.preventDefault(); o[fmt] = !o[fmt]; if (o.type === 'replace') o.styled = true; positionObj(o); renderProps(); }
      else if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && o.type === 'replace')) { e.preventDefault(); commitEditing(); }
      e.stopPropagation();
    };
    o.el.onblur = () => setTimeout(() => { if (editing === o && document.activeElement !== o.el) commitEditing(); }, 0);
  }
  function commitEditing() {
    const o = editing;
    if (!o) return;
    editing = null;
    o.el.contentEditable = 'false';
    o.text = o.el.innerText.replace(/\n$/, '');
    if (o.type === 'text' && !o.text.trim()) removeObj(o);
    else if (o.type === 'replace' && o.text === o.original && !o.styled) removeObj(o);
    else if (o.type === 'replace' && !o.text.trim()) { o.el.remove(); o.el = null; o.type = 'deleteText'; positionObj(o); }
    updateChrome();
  }

  const ptOf = (e, i) => { const r = st.pages[i].el.getBoundingClientRect(); return [(e.clientX - r.left) / k(), (e.clientY - r.top) / k()]; };
  function onObjPointer(e, o) {
    if (editing === o) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    commitEditing();
    select(o);
    if (o.type === 'erase') return;
    const handle = e.target.classList.contains('handle');
    const start = ptOf(e, o.page);
    const snap = JSON.parse(JSON.stringify({ rect: o.rect, x: o.x, y: o.y, x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, points: o.points, size: o.size }));
    let moved = false;
    const move = (ev) => {
      const [x, y] = ptOf(ev, o.page);
      const dx = x - start[0], dy = y - start[1];
      if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true;
      if (handle) {
        if (o.rect) {
          let w = Math.max(6, snap.rect[2] + dx), hh = Math.max(6, snap.rect[3] + dy);
          if (o.type === 'image' || o.type === 'signature') hh = w * (snap.rect[3] / snap.rect[2]);
          o.rect = [snap.rect[0], snap.rect[1], w, hh];
        } else if (o.type === 'text' || o.type === 'replace') { o.size = Math.max(4, snap.size + dy / 2); o.styled = true; }
      } else if (o.rect) o.rect = [snap.rect[0] + dx, snap.rect[1] + dy, snap.rect[2], snap.rect[3]];
      else if (o.type === 'text' || o.type === 'replace') { o.x = snap.x + dx; o.y = snap.y + dy; o.styled = true; }
      else if (o.points) o.points = snap.points.map((q) => [q[0] + dx, q[1] + dy]);
      else if (o.x1 != null) { o.x1 = snap.x1 + dx; o.y1 = snap.y1 + dy; o.x2 = snap.x2 + dx; o.y2 = snap.y2 + dy; }
      positionObj(o);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (!moved && (o.type === 'text' || o.type === 'replace') && st.tool !== 'select') editText(o, false); renderProps(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function onPointerDown(e, i) {
    if (e.button !== 0 || e.target.closest('.obj')) return;
    commitEditing();
    const s = st.style;
    const [x0, y0] = ptOf(e, i);
    st.selPages = new Set([i]);
    if (st.tool === 'select' || st.tool === 'edittext') { select(null); return; }
    if (st.tool === 'addtext') {
      e.preventDefault();
      const o = addObj({ type: 'text', page: i, x: x0, y: y0 + s.size * 0.86, text: '', size: s.size, font: s.font, bold: s.bold, italic: s.italic, color: s.color, underline: s.underline, strike: s.strike, bg: s.bg, align: s.align, lineHeight: s.lineHeight, spacing: s.spacing, opacity: s.opacity });
      select(o);
      setTimeout(() => editText(o, false), 0);
      return;
    }
    e.preventDefault();
    let o;
    const t = st.tool;
    if (t === 'draw') o = addObj({ type: 'ink', page: i, points: [[x0, y0]], stroke: s.stroke, width: s.width });
    else if (t === 'line' || t === 'arrow') o = addObj({ type: t, page: i, x1: x0, y1: y0, x2: x0, y2: y0, stroke: s.stroke, width: s.width });
    else o = addObj({ type: t, page: i, rect: [x0, y0, 0, 0], stroke: s.stroke, fill: t === 'whiteout' ? s.erase : s.fill, width: s.width, color: s.hl });
    const move = (ev) => {
      const [x, y] = ptOf(ev, i);
      if (o.points) o.points.push([x, y]);
      else if (o.x1 != null) { o.x2 = x; o.y2 = y; if (ev.shiftKey) { const a = Math.round(Math.atan2(y - y0, x - x0) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(x - x0, y - y0); o.x2 = x0 + L * Math.cos(a); o.y2 = y0 + L * Math.sin(a); } }
      else { let w = x - x0, hh = y - y0; if (ev.shiftKey && (t === 'rect' || t === 'ellipse')) { const m = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * m; hh = Math.sign(hh || 1) * m; } o.rect = [Math.min(x0, x0 + w), Math.min(y0, y0 + hh), Math.abs(w), Math.abs(hh)]; }
      positionObj(o);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const tiny = o.rect ? o.rect[2] < 3 || o.rect[3] < 3 : o.points ? o.points.length < 2 : Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 3;
      if (tiny) removeObj(o); else select(o);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function selectTool(t) {
    commitEditing();
    st.tool = t;
    $$('[data-tool]', root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === t));
    pagesEl.className = `pages tool-${t}`;
    if (t === 'edittext') st.pages.forEach((p, i) => p.visible && showLines(i)); else hideLines();
    if (t === 'select') st.pages.forEach((p, i) => p.visible && showObjects(i)); else hideObjects();
    const info = TOOLS.find((x) => x[0] === t);
    tip(info?.[3]);
    renderProps();
  }
  function tip(msg, keep) {
    status.hidden = !msg;
    status.textContent = msg || '';
    clearTimeout(tip.t);
    if (msg && !keep) tip.t = setTimeout(() => { status.hidden = true; }, 4500);
  }
  function renderProps() {
    const o = st.sel;
    const s = st.style;
    const t = o ? o.type : st.tool;
    props.innerHTML = '';
    const head = (txt) => props.append(h(`<h3>${esc(txt)}</h3>`));
    const swatch = (list, val, fn) => { const el = h(`<div class="swatches">${list.map((c) => `<button style="background:${c}" data-c="${c}" aria-label="${c}" aria-pressed="${c.toLowerCase() === String(val).toLowerCase()}"></button>`).join('')}<input type="color" value="${val}" style="width:28px;height:24px" aria-label="Custom colour"></div>`); el.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { fn(b.dataset.c); renderProps(); } }); $('input', el).addEventListener('change', (e) => { fn(e.target.value); renderProps(); }); return el; };
    const apply = (patch) => { if (o) { Object.assign(o, patch); if (o.type === 'replace') o.styled = true; positionObj(o); } else Object.assign(s, patch); };
    if (!o && st.pick) {
      const it = st.pick.obj;
      head(KIND[it.kind]);
      if (it.text) props.append(h(`<p class="tip">“${esc(it.text)}${it.text.length >= 80 ? '…' : ''}”</p>`));
      props.append(h(`<p class="tip">Delete takes it out of the file when you save: ${it.kind === 'table' ? 'its lines, shading and text' : it.kind === 'image' ? 'the picture' : it.kind === 'drawing' ? 'the lines and shapes' : 'the text'}, leaving what is around it as it is.</p>`));
      const del = h(`<button class="btn danger" style="justify-self:start">${icon('delete', 'sm')}Remove from page</button>`);
      del.addEventListener('click', erasePicked);
      props.append(del);
      return;
    }
    if (o?.type === 'erase') {
      head(`Removed ${(KIND[o.kind] || 'area').toLowerCase()}`);
      props.append(h(`<p class="tip">It is taken out of the file when you save.</p>`));
      const back = h(`<button class="btn" style="justify-self:start">${icon('undo', 'sm')}Put it back</button>`);
      back.addEventListener('click', () => removeObj(o));
      props.append(back);
      return;
    }
    if (t === 'text' || t === 'replace' || t === 'addtext' || t === 'edittext') {
      const v = o || s;
      head(o?.type === 'replace' ? 'Edited text' : t === 'edittext' ? 'Edit text' : 'Text');
      if (t === 'edittext' && !o) { props.append(h(`<p class="tip">Click a line on the page to edit it. The original text is removed from the file when you save, not just covered.</p><p class="tip">Lines in rotated or vertical text can’t be edited directly; erase them and add new text instead.</p>`)); return; }
      const opt = ([id, label, css]) => `<option value="${esc(id)}" style="font-family:${esc(css)}">${esc(label)}</option>`;
      const mine = st.fonts.map((f) => [`sys:${f.family}`, f.family, fontCss(`sys:${f.family}`)]);
      const fontSel = h(`<select class="input" title="Font"><optgroup label="Lime">${BUILT_IN_FONTS.map(opt).join('')}</optgroup>${mine.length ? `<optgroup label="On this computer">${mine.map(opt).join('')}</optgroup>` : ''}</select>`);
      fontSel.value = v.font;
      if (fontSel.value !== v.font) fontSel.value = 'sans';
      fontSel.addEventListener('change', () => apply({ font: fontSel.value }));
      const size = h(`<input class="input" type="number" min="4" max="200" step="0.5" value="${Number(v.size).toFixed(1)}" title="Size">`);
      size.addEventListener('input', () => apply({ size: Number(size.value) || 12 }));
      const row = h(`<div class="row2"></div>`); row.append(fontSel, size); props.append(row);
      const btn = (key, ic, title) => `<button class="tb" data-s="${key}" aria-pressed="${!!v[key]}" title="${title}">${icon(ic)}</button>`;
      const alignBtn = (a, ic, title) => `<button class="tb" data-al="${a}" aria-pressed="${(v.align || 'left') === a}" title="${title}">${icon(ic)}</button>`;
      const style = h(`<div class="tstyle">${btn('bold', 'bold', 'Bold (Ctrl B)')}${btn('italic', 'italic', 'Italic (Ctrl I)')}${btn('underline', 'underline', 'Underline (Ctrl U)')}${btn('strike', 'strike', 'Strikethrough')}<span class="sep"></span>${alignBtn('left', 'alignLeft', 'Align left')}${alignBtn('center', 'alignCenter', 'Centre')}${alignBtn('right', 'alignRight', 'Align right')}</div>`);
      style.addEventListener('click', (e) => {
        const b = e.target.closest('[data-s]'), al = e.target.closest('[data-al]');
        if (b) apply({ [b.dataset.s]: !(o || s)[b.dataset.s] });
        if (al) apply({ align: al.dataset.al });
        if (b || al) renderProps();
      });
      props.append(style, h(`<div class="label">Colour</div>`), swatch(COLORS, v.color, (c) => apply({ color: c })), h(`<div class="label">Background</div>`), swatch(TEXT_BG, v.bg || 'none', (c) => apply({ bg: c })));
      const slider = (key, label, min, max, step, fmt) => {
        const f = h(`<div class="field"><label class="label">${label}</label><div class="range"><input type="range" min="${min}" max="${max}" step="${step}" value="${v[key] ?? (key === 'lineHeight' ? 1.2 : key === 'opacity' ? 1 : 0)}"><output>${fmt(v[key] ?? (key === 'lineHeight' ? 1.2 : key === 'opacity' ? 1 : 0))}</output></div></div>`);
        $('input', f).addEventListener('input', (e) => { const n = Number(e.target.value); $('output', f).textContent = fmt(n); apply({ [key]: n }); });
        return f;
      };
      const more = h(`<details class="more"><summary>Spacing and opacity</summary></details>`);
      more.append(slider('lineHeight', 'Line spacing', 0.8, 3, 0.05, (n) => `${Number(n).toFixed(2)}×`), slider('spacing', 'Letter spacing', -2, 10, 0.1, (n) => `${Number(n).toFixed(1)} pt`), slider('opacity', 'Opacity', 0.1, 1, 0.05, (n) => `${Math.round(n * 100)}%`));
      props.append(more);
      if (o) props.append(h(`<p class="tip">${o.type === 'replace' ? 'Changes replace the original line when you save.' : 'Double-click to edit. Drag to move. Drag the dot to resize.'}</p>`));
    } else if (t === 'whiteout') {
      head('Erase');
      props.append(h(`<p class="tip">Covers the area and permanently removes any text underneath.</p>`), swatch(['#ffffff', '#000000', '#f3f3f3'], (o || s).fill || s.erase, (c) => (o ? apply({ fill: c }) : (s.erase = c))));
    } else if (t === 'highlight') {
      head('Highlight');
      props.append(swatch(HL, (o || s).color || s.hl, (c) => (o ? apply({ color: c }) : (s.hl = c))));
    } else if (['rect', 'ellipse', 'line', 'arrow', 'draw', 'ink'].includes(t)) {
      head({ rect: 'Box', ellipse: 'Oval', line: 'Line', arrow: 'Arrow', draw: 'Pen', ink: 'Drawing' }[t]);
      props.append(h(`<div class="label">Colour</div>`), swatch(COLORS, (o || s).stroke, (c) => apply({ stroke: c })));
      const w = h(`<div class="field"><label class="label">Thickness</label><div class="range"><input type="range" min="0.5" max="12" step="0.5" value="${(o || s).width}"><output>${(o || s).width} pt</output></div></div>`);
      $('input', w).addEventListener('input', (e) => { $('output', w).textContent = `${e.target.value} pt`; apply({ width: Number(e.target.value) }); });
      props.append(w);
      if (t === 'rect' || t === 'ellipse') props.append(h(`<div class="label">Fill</div>`), swatch(['none', ...COLORS.slice(0, 8), '#dff6dd', '#fff4ce'], (o || s).fill || 'none', (c) => apply({ fill: c })));
      props.append(h(`<p class="tip">Hold Shift for squares, circles and straight angles.</p>`));
    } else if (t === 'image' || t === 'signature') {
      head(t === 'signature' ? 'Signature' : 'Image');
      props.append(h(`<p class="tip">Drag to move. Drag the dot to resize.</p>`));
    } else {
      head(`${st.sess?.pages.length || 0} pages`);
      props.append(h(`<p class="tip">Pick a tool above. Everything you add stays editable until you save.</p><p class="tip">Use the Pages panel to reorder, rotate, delete or insert pages.</p>`));
    }
    if (o) {
      const del = h(`<button class="btn danger" style="justify-self:start">${icon('delete', 'sm')}Delete</button>`);
      del.addEventListener('click', () => removeObj(o));
      props.append(del);
    }
  }
  function updateChrome() {
    const dirty = st.pending.some((o) => serialize(o)) || st.sess?.dirty;
    $('.dirty', root).hidden = !dirty;
    $('[data-a=undo]', root).disabled = !(st.pending.length || st.sess?.canUndo);
    $('[data-a=redo]', root).disabled = !(st.sess?.canRedo && !st.pending.length);
  }

  function visiblePage() {
    const top = pagesEl.getBoundingClientRect().top;
    let best = 0, bestD = Infinity;
    st.pages.forEach((p, i) => { const d = Math.abs(p.el.getBoundingClientRect().top - top); if (d < bestD) { bestD = d; best = i; } });
    return best;
  }
  async function placeImage(dataUrl, type, maxW) {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = dataUrl; });
    const i = visiblePage();
    const p = st.pages[i];
    const w = Math.min(maxW, p.w * 0.6);
    const hh = w * (img.naturalHeight / img.naturalWidth);
    selectTool('select');
    const o = addObj({ type, page: i, rect: [(p.w - w) / 2, Math.max(20, p.h * 0.4 - hh / 2), w, hh], data: dataUrl });
    select(o);
    o.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  async function addImage() {
    const [f] = await api.invoke('dialog:open', { multi: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'svg', 'bmp', 'tif', 'tiff'] }] });
    if (!f) return;
    const url = await api.invoke('files:dataUrl', f, 2000);
    placeImage(url, 'image', 240);
  }
  function trimCanvas(c) {
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 <= x0) return null;
    const o = document.createElement('canvas');
    o.width = x1 - x0 + 8; o.height = y1 - y0 + 8;
    o.getContext('2d').drawImage(c, x0 - 4, y0 - 4, o.width, o.height, 0, 0, o.width, o.height);
    return o.toDataURL('image/png');
  }
  async function signDialog() {
    const saved = (ctx.settings().signatures || []).slice(0, 6);
    const scrim = h(`<div class="scrim"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="sigT"><div class="body">
      <h2 id="sigT">Add a signature</h2>
      <div class="seg" role="tablist"><button data-t="draw" aria-pressed="true">Draw</button><button data-t="type" aria-pressed="false">Type</button>${saved.length ? '<button data-t="saved" aria-pressed="false">Saved</button>' : ''}</div>
      <div data-pane="draw"><canvas class="sig-pad" width="1040" height="360"></canvas><div style="display:flex;justify-content:space-between;margin-top:6px"><span class="faint" style="font-size:12px">Sign with your mouse, pen or finger.</span><button class="btn subtle" data-a="clear">Clear</button></div></div>
      <div data-pane="type" hidden><input class="input" placeholder="Your name" data-a="name"><div class="seg" style="margin-top:8px"><button data-f="Caveat" aria-pressed="true" style="font-family:Caveat;font-size:20px">Caveat</button><button data-f="Dancing Script" aria-pressed="false" style="font-family:'Dancing Script';font-size:20px">Dancing</button></div><div class="sig-type" style="margin-top:8px;font-family:Caveat"></div></div>
      <div data-pane="saved" hidden><div class="sig-list">${saved.map((s, i) => `<button data-s="${i}"><img src="${s}" alt="Saved signature ${i + 1}"></button>`).join('')}</div></div>
      <label class="switch"><input type="checkbox" checked data-a="remember"><span>Save for next time</span></label>
    </div><div class="foot"><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="ok">Place signature</button></div></div></div>`);
    document.body.append(scrim);
    let pane = 'draw', font = 'Caveat';
    const pad = $('canvas', scrim), pctx = pad.getContext('2d');
    pctx.lineWidth = 5; pctx.lineCap = 'round'; pctx.lineJoin = 'round'; pctx.strokeStyle = '#111827';
    let drawing = false, last = null;
    const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * (pad.width / r.width), (e.clientY - r.top) * (pad.height / r.height)]; };
    pad.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); pad.setPointerCapture(e.pointerId); });
    pad.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); pctx.lineWidth = e.pressure && e.pointerType === 'pen' ? 2 + e.pressure * 6 : 5; pctx.beginPath(); pctx.moveTo(...last); pctx.lineTo(...p); pctx.stroke(); last = p; });
    pad.addEventListener('pointerup', () => { drawing = false; });
    const nameIn = $('[data-a=name]', scrim), preview = $('.sig-type', scrim);
    nameIn.addEventListener('input', () => { preview.textContent = nameIn.value; });
    const close = () => scrim.remove();
    scrim.addEventListener('click', async (e) => {
      const tb = e.target.closest('[data-t]');
      if (tb) { pane = tb.dataset.t; $$('[data-t]', scrim).forEach((b) => b.setAttribute('aria-pressed', b === tb)); $$('[data-pane]', scrim).forEach((p) => { p.hidden = p.dataset.pane !== pane; }); }
      const fb = e.target.closest('[data-f]');
      if (fb) { font = fb.dataset.f; $$('[data-f]', scrim).forEach((b) => b.setAttribute('aria-pressed', b === fb)); preview.style.fontFamily = `'${font}'`; }
      const sb = e.target.closest('[data-s]');
      if (sb) { close(); placeImage(saved[Number(sb.dataset.s)], 'signature', 170); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'clear') pctx.clearRect(0, 0, pad.width, pad.height);
      if (a === 'cancel' || e.target === scrim) close();
      if (a === 'ok') {
        let url = null;
        if (pane === 'draw') url = trimCanvas(pad);
        if (pane === 'type' && nameIn.value.trim()) {
          await document.fonts.load(`96px '${font}'`);
          const c = document.createElement('canvas'); const cx = c.getContext('2d');
          cx.font = `96px '${font}'`; c.width = Math.ceil(cx.measureText(nameIn.value).width) + 40; c.height = 150;
          const c2 = c.getContext('2d'); c2.font = `96px '${font}'`; c2.fillStyle = '#111827'; c2.textBaseline = 'middle'; c2.fillText(nameIn.value, 20, 75);
          url = trimCanvas(c);
        }
        if (!url) { toast(pane === 'draw' ? 'Draw your signature first.' : 'Type your name first.', { type: 'error' }); return; }
        if ($('[data-a=remember]', scrim).checked) {
          const list = [url, ...(ctx.settings().signatures || [])].slice(0, 6);
          api.invoke('settings:set', { signatures: list });
        }
        close();
        placeImage(url, 'signature', 170);
      }
    });
  }

  const find = $('.find', root);
  let lastQ = '';
  find.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const q = find.value.trim();
    if (!q) { st.hits = []; drawHits(); return; }
    if (q !== lastQ) { lastQ = q; st.hits = (await call('search', st.sess.id, q)).flatMap((r) => r.rects.map((rect) => ({ page: r.page, rect }))); st.hitIdx = -1; if (!st.hits.length) toast(`“${q}” wasn’t found.`); }
    if (!st.hits.length) return;
    st.hitIdx = (st.hitIdx + (e.shiftKey ? -1 : 1) + st.hits.length) % st.hits.length;
    drawHits();
    const cur = $('.searchhit.cur', root);
    cur?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    tip(`${st.hitIdx + 1} of ${st.hits.length}`);
  });
  function drawHits() {
    pagesEl.querySelectorAll('.searchhit').forEach((x) => x.remove());
    const kk = k();
    st.hits.forEach((hit, i) => {
      const p = st.pages[hit.page]; if (!p) return;
      const [x0, y0, x1, y1] = hit.rect;
      p.el.append(h(`<div class="searchhit ${i === st.hitIdx ? 'cur' : ''}" style="left:${x0 * kk}px;top:${y0 * kk}px;width:${(x1 - x0) * kk}px;height:${(y1 - y0) * kk}px"></div>`));
    });
  }

  async function save(as) {
    let target = st.savePath;
    if (as || !target) {
      const suggested = `${dirOf(file)}${sep}${nameOf(file).replace(/\.pdf$/i, '')}${as ? '' : ' (edited)'}.pdf`;
      if (as) { target = await api.invoke('dialog:save', { defaultPath: suggested, filters: [{ name: 'PDF', extensions: ['pdf'] }] }); if (!target) return false; }
      else target = suggested;
    }
    const ok = await busy('Saving…', async () => {
      await flush();
      st.sess = await call('save', st.sess.id, target);
      st.savePath = target;
      layout(false);
      return true;
    });
    if (ok) toast(`Saved ${nameOf(target)}`, { type: 'success', actions: [{ label: 'Open', fn: () => api.invoke('shell:open', target) }, { label: 'Show in folder', fn: () => api.invoke('shell:show', target) }] });
    updateChrome();
    return !!ok;
  }
  async function undo() {
    if (editing) { commitEditing(); return; }
    if (st.pending.length) { removeObj(st.pending[st.pending.length - 1]); return; }
    if (st.sess.canUndo) await busy('Undoing…', async () => { st.sess = await call('undo', st.sess.id); layout(true); });
  }
  async function redo() { if (st.sess.canRedo) await busy('Redoing…', async () => { st.sess = await call('redo', st.sess.id); layout(true); }); }
  async function close() {
    commitEditing();
    const dirty = st.pending.some((o) => serialize(o)) || st.sess?.dirty;
    if (dirty) {
      const choice = await confirm3(`Save changes to ${nameOf(file)}?`, 'Your edits will be lost if you don’t save them.');
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await save(false))) return;
    }
    go();
  }

  function prompt(title, text, type = 'text') {
    return new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>${esc(title)}</h2><p class="muted" style="margin:0">${esc(text)}</p><input class="input" type="${type}"></div><div class="foot"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">Open</button></div></div></div>`);
      document.body.append(s);
      const inp = $('input', s); inp.focus();
      const done = (v) => { s.remove(); resolve(v); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); });
      s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) done(a === 'ok' ? inp.value : null); });
    });
  }
  // Find and replace across the document: every line with the words becomes an edited line, in the closest font, so
  // nothing changes until Save and each one can still be adjusted or undone.
  function replaceDialog() {
    const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>Find and replace</h2><input class="input" data-f="q" placeholder="Find" value="${esc(find.value)}"><input class="input" data-f="r" placeholder="Replace with" style="margin-top:8px"><label class="row" style="margin-top:8px;gap:6px;font-size:12px"><input type="checkbox" data-f="case">Match case</label></div><div class="foot"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">Replace all</button></div></div></div>`);
    document.body.append(s);
    const q = $('[data-f=q]', s), r = $('[data-f=r]', s);
    (q.value ? r : q).focus();
    const done = async (go) => { const v = [q.value, r.value, $('[data-f=case]', s).checked]; s.remove(); if (go && v[0]) await replaceAll(...v); };
    s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) done(a === 'ok'); });
  }
  async function replaceAll(q, r, matchCase) {
    commitEditing();
    const re = () => new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
    let n = 0;
    for (const o of st.pending) if ((o.type === 'replace' || o.type === 'text') && re().test(o.text)) { o.text = o.text.replace(re(), r); if (o.el) o.el.textContent = o.text; positionObj(o); n++; }
    for (let i = 0; i < st.pages.length; i++) {
      if (!st.lines.has(i)) st.lines.set(i, call('text', st.sess.id, i).catch(() => []));
      const taken = new Set(st.pending.filter((o) => o.page === i && o.lineId).map((o) => o.lineId));
      for (const l of await st.lines.get(i)) {
        if (!l.editable || taken.has(l.id) || !re().test(l.text)) continue;
        addObj({ type: 'replace', page: i, lineId: l.id, bbox: l.bbox, x: l.origin[0], y: l.origin[1], text: l.text.replace(re(), r), original: l.text, size: l.size, font: matchFont(l), bold: l.bold, italic: l.italic, color: l.color });
        n++;
      }
    }
    if (st.tool === 'edittext') st.pages.forEach((p, i) => p.visible && showLines(i));
    updateChrome();
    toast(n ? `Replaced in ${n} line${n === 1 ? '' : 's'}. Save to keep it.` : `“${q}” wasn’t found.`, { type: n ? 'success' : undefined });
  }
  function confirm3(title, text) {
    return new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>${esc(title)}</h2><p class="muted" style="margin:0">${esc(text)}</p></div><div class="foot"><button class="btn primary" data-a="save">Save</button><button class="btn" data-a="discard">Don’t save</button><button class="btn" data-a="cancel">Cancel</button></div></div></div>`);
      document.body.append(s);
      $('[data-a=save]', s).focus();
      s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { s.remove(); resolve(a); } });
    });
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]');
    if (t) { selectTool(t.dataset.tool); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'close') close();
    if (a === 'undo') undo();
    if (a === 'redo') redo();
    if (a === 'image') addImage();
    if (a === 'sign') signDialog();
    if (a === 'zoomin') setZoom(st.zoom * 1.2);
    if (a === 'zoomout') setZoom(st.zoom / 1.2);
    if (a === 'fit') fitWidth();
    if (a === 'fitpage') fitPage();
    if (a === 'replace') replaceDialog();
    if (a === 'save') save(false);
    if (a === 'saveas') save(true);
    if (a === 'thumbs') { const on = body.classList.toggle('no-thumbs'); e.target.closest('button').setAttribute('aria-pressed', !on); }
  });
  const onKey = (e) => {
    if (document.querySelector('.scrim')) return;
    if (editing) return;
    if (e.target.matches?.('input, textarea, select')) return;
    const c = e.ctrlKey || e.metaKey;
    if (c && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (c && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
    else if (c && e.key.toLowerCase() === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (c && e.key.toLowerCase() === 'f') { e.preventDefault(); find.focus(); }
    else if (c && e.key.toLowerCase() === 'h') { e.preventDefault(); replaceDialog(); }
    else if (c && e.key.toLowerCase() === 'd' && st.sel) { e.preventDefault(); duplicate(st.sel, 12); }
    else if (c && e.key.toLowerCase() === 'c' && st.sel) { e.preventDefault(); clip = JSON.parse(JSON.stringify(serializeObj(st.sel))); }
    else if (c && e.key.toLowerCase() === 'v' && clip) { e.preventDefault(); const page = [...st.selPages][0] ?? clip.page; const o = addObj({ ...JSON.parse(JSON.stringify(clip)), page }); shiftObj(o, 12, 12); select(o); }
    else if (st.sel && e.key.startsWith('Arrow') && st.sel.type !== 'erase') {
      // Arrow keys nudge what's selected by a point, Shift by ten.
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      shiftObj(st.sel, dx, dy);
      if (st.sel.type === 'replace') st.sel.styled = true;
    }
    else if (c && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(st.zoom * 1.2); }
    else if (c && e.key === '-') { e.preventDefault(); setZoom(st.zoom / 1.2); }
    else if (c && e.key === '0') { e.preventDefault(); fitWidth(); }
    else if (c && e.key === '1') { e.preventDefault(); setZoom(1); }
    else if (c && e.key === '9') { e.preventDefault(); fitPage(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel) { e.preventDefault(); removeObj(st.sel); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && st.pick) { e.preventDefault(); erasePicked(); }
    else if (e.key === 'Escape') { if (st.sel || st.pick) select(null); else selectTool('select'); }
    else if (!c && !e.altKey) {
      const map = { v: 'select', e: 'edittext', t: 'addtext', x: 'whiteout', h: 'highlight', p: 'draw', r: 'rect', o: 'ellipse', a: 'arrow', l: 'line' };
      if (map[e.key.toLowerCase()]) selectTool(map[e.key.toLowerCase()]);
    }
  };
  document.addEventListener('keydown', onKey);
  // Ctrl or ⌘ with the scroll wheel, or a trackpad pinch (which arrives as Ctrl + wheel), zooms smoothly at the pointer:
  // the step follows how far the wheel or fingers moved, so a pinch glides instead of lurching 10% per event.
  pagesEl.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const d = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
    setZoom(st.zoom * Math.exp(-d * 0.0065), { x: e.clientX, y: e.clientY });
  }, { passive: false });
  $('.zoom', root).addEventListener('change', (e) => { const v = e.target.value; if (v === 'width') fitWidth(); else if (v === 'page') fitPage(); else setZoom(Number(v)); });
  // Hold Space and drag (or drag with the middle button) to move around the page, as in design apps.
  let spaceDown = false;
  const onSpace = (e) => { if (e.code === 'Space' && !editing && !e.target.matches?.('input, textarea, select, [contenteditable]')) { spaceDown = e.type === 'keydown'; pagesEl.classList.toggle('panning', spaceDown); if (spaceDown) e.preventDefault(); } };
  document.addEventListener('keydown', onSpace);
  document.addEventListener('keyup', onSpace);
  pagesEl.addEventListener('pointerdown', (e) => {
    if (!(spaceDown || e.button === 1)) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, l0 = pagesEl.scrollLeft, t0 = pagesEl.scrollTop;
    pagesEl.classList.add('grabbing');
    const mv = (ev) => { pagesEl.scrollLeft = l0 - (ev.clientX - sx); pagesEl.scrollTop = t0 - (ev.clientY - sy); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); pagesEl.classList.remove('grabbing'); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }, true);
  const ro = new ResizeObserver(() => {});
  ro.observe(pagesEl);

  load();

  return () => {
    disposed = true;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keydown', onSpace);
    document.removeEventListener('keyup', onSpace);
    io?.disconnect(); tio?.disconnect(); ro.disconnect();
    st.renders.forEach((r) => URL.revokeObjectURL(r.url));
    if (st.sess) call('close', st.sess.id).catch(() => {});
  };
}
