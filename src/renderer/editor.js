import { $, $$, esc, h, nameOf, dirOf, sep } from './ui.js';
import { sidePanels, kindOf } from './editor-side.js';
import { docTools } from './editor-doc.js';
import { shortcuts, key, toolKeys, helpButton } from './shortcuts.js';
import { setDocName, confirm3, recovery, offerRestore, remember } from './editor-kit.js';

const PT = 96 / 72;
const TOOLS = [
  ['select', 'cursor', 'Select', 'Select anything on the page (pictures, tables, drawings, text blocks), what you’ve added or a comment. Delete removes it. Fill in form fields here too.'],
  ['edittext', 'textEdit', 'Edit text', 'Click any line or paragraph of text to change it. Clear it completely to delete it.'],
  ['addtext', 'textT', 'Add text', 'Click where you want to type.'],
  ['whiteout', 'whiteout', 'Erase', 'Drag over an area to erase it. Text underneath is removed for good.'],
  ['note', 'note', 'Note', 'Click to stick a note on the page, then type it in the Comments panel.'],
  ['highlight', 'highlight', 'Mark up', 'Drag over text to highlight, underline or strike it out.'],
  ['stamp', 'stamp', 'Stamp', 'Pick a stamp, tick, cross or today’s date on the right, then click the page to place it.'],
  ['draw', 'pen', 'Draw', 'Draw freehand with the mouse, pen or finger.'],
  ['rect', 'square', 'Box', 'Drag to draw a rectangle.'],
  ['ellipse', 'circle', 'Oval', 'Drag to draw an oval.'],
  ['arrow', 'arrow', 'Arrow', 'Drag to draw an arrow.'],
  ['line', 'line', 'Line', 'Drag to draw a line.'],
  ['link', 'link', 'Link', 'Drag over an area to link it to a web address or a page. Click a link to change it.'],
  ['field', 'field', 'Field', 'Drag to add a form field: text, tick box, choice, list, date or signature. Click a field to change it.'],
  ['redact', 'redact', 'Redact', 'Drag over what must go, or find words to redact, then apply: it is removed for good.'],
  ['measure', 'ruler', 'Measure', 'Measure distances, perimeters and areas at a scale.'],
  ['crop', 'crop', 'Crop', 'Drag over the part of the page to keep, then crop this page or all of them.'],
];
const SHAPES = ['rect', 'ellipse', 'arrow', 'line'];
const INSERT = [['image', 'imageAdd', 'Image', 'Add a picture from a file.'], ['sign', 'signature', 'Sign', 'Draw, type or reuse your signature.']];
const TOOL_GROUPS = [['Edit', ['select', 'edittext', 'addtext', 'whiteout']], ['Comment', ['note', 'highlight', 'stamp', 'draw', 'shapes']], ['Insert', ['image', 'sign', 'link', 'field']], ['Protect and measure', ['redact', 'measure', 'crop']]];
const COLORS = ['#000000', '#3b3b3b', '#d13438', '#ca5010', '#ffb900', '#107c10', '#0f6cbd', '#5c2e91', '#ffffff'];
const HL = ['#ffe14d', '#a6f0a0', '#9fd8ff', '#ffb3d9', '#ffc58a'];
const NOTE = ['#ffd400', '#ff8a00', '#e8384f', '#2ea043', '#1f8fff', '#a259ff'];
const TEXT_BG = ['none', '#fff4ce', '#dff6dd', '#cfe4fa', '#fde7e9', '#e8e0f5', '#ffffff', '#000000'];
const STAMPS = [['APPROVED', '#107c10'], ['REVIEWED', '#0f6cbd'], ['DRAFT', '#ca5010'], ['CONFIDENTIAL', '#d13438'], ['FINAL', '#0f6cbd'], ['PAID', '#107c10'],
  ['REJECTED', '#d13438'], ['VOID', '#d13438'], ['COPY', '#5c2e91'], ['SIGN HERE', '#ca5010']];
const MARKS = [['check', 'Tick'], ['cross', 'Cross'], ['dot', 'Dot']];
const MARK_LINES = { check: [[[0.1, 0.55], [0.4, 0.85], [0.92, 0.15]]], cross: [[[0.15, 0.15], [0.85, 0.85]], [[0.85, 0.15], [0.15, 0.85]]] };
const markSvg = (kind, w, hh, color, sw) => (kind === 'dot' ? `<circle cx="${w / 2}" cy="${hh / 2}" r="${Math.min(w, hh) * 0.3}" fill="${color}"/>`
  : `<path d="${(MARK_LINES[kind] || MARK_LINES.check).map((ln) => ln.map(([u, v], j) => `${j ? 'L' : 'M'}${u * w} ${v * hh}`).join('')).join('')}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`);
const ROTATES = (o) => o.type === 'text' || o.type === 'mark';
const today = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const BUILT_IN_FONTS = [['sans', 'Noto Sans', '"Noto Sans","Segoe UI",Arial,sans-serif'], ['serif', 'Noto Serif', '"Noto Serif","Times New Roman",serif'], ['carlito', 'Carlito (like Calibri)', 'Carlito,Calibri,sans-serif'],
  ['helvetica', 'Helvetica (like Arial)', 'Helvetica,Arial,sans-serif'], ['times', 'Times', '"Times New Roman",Times,serif'], ['courier', 'Courier', '"Courier New",Courier,monospace'],
  ['mono', 'Noto Sans Mono', '"Noto Sans Mono",Consolas,monospace'], ['caveat', 'Caveat (handwriting)', 'Caveat,cursive'], ['dancing', 'Dancing Script', '"Dancing Script",cursive']];
const fontCss = (f) => (String(f).startsWith('sys:') ? `"${String(f).slice(4).replace(/["\\]/g, '')}","Noto Sans",sans-serif` : (BUILT_IN_FONTS.find((x) => x[0] === f) || BUILT_IN_FONTS[0])[2]);
const UNITS = { mm: 25.4 / 72, cm: 2.54 / 72, m: 0.0254 / 72, in: 1 / 72, ft: 1 / 864 };
const RATIOS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2500, 5000];
const FIELD_KINDS = [['text', 'field', 'Text'], ['checkbox', 'check', 'Tick box'], ['radio', 'circle', 'Choice'], ['combo', 'down', 'Drop-down'], ['list', 'list', 'List'], ['date', 'clock', 'Date'], ['signature', 'signature', 'Signature']];
const LIST_MARK = /^(• |\d+\. )/;

export function openEditor(view, { file, mode }, ctx) {
  const { icon, toast, api, go } = ctx;
  ctx.onClose?.(close);
  const MUTATES = new Set(['apply', 'pageOp', 'annotOp', 'linkOp', 'setOutline', 'fill', 'fieldOp', 'docOp', 'setProps', 'recognise', 'undo', 'redo']);
  const call = (m, ...a) => api.invoke('editor:call', m, ...a).then((r) => { if (MUTATES.has(m)) st.rev++; return r; });
  const pref = ctx.settings() || {};
  const mem = remember(api, ctx.settings, 'pdf');
  const known = (t) => TOOLS.some((x) => x[0] === t) || SHAPES.includes(t);
  const st = {
    sess: null, file, savePath: null, rev: 0, restored: false, history: [{ label: 'Opened' }], histAt: 0, zoom: 1, tool: mode !== 'edit' ? 'select' : known(mem.get('tool')) ? mem.get('tool') : 'edittext', shape: 'rect',
    pending: [], sel: null, pick: null, pages: [], renders: new Map(), lines: new Map(), paras: new Map(), objs: new Map(), selPages: new Set([0]), hits: [], hitIdx: -1,
    fonts: [], style: { font: 'sans', size: 14, color: '#000000', bold: false, italic: false, underline: false, strike: false, bg: 'none', border: 'none', align: 'left', lineHeight: 1.2, spacing: 0, opacity: 1, stroke: '#d13438', fill: 'none', width: 2, hl: '#ffe14d', erase: '#ffffff',
      markup: 'highlight', ul: '#d13438', stamp: 'APPROVED', stampText: '', stampColor: '#d13438', mark: '#107c10', note: '#ffd400', measure: '#d13438' },
    marks: { annots: [], links: [], fields: [] }, outline: [], fieldVals: {}, annSel: null, linkSel: null, linkDraft: null, linkTo: 'url', fieldSel: null, fieldKind: 'text', radioGroup: null, crop: null, draft: null,
    editBy: pref.editBy === 'paragraph' ? 'paragraph' : 'line', measure: { kind: 'distance', ratio: 1, unit: 'mm' }, redact: { boxes: true }, saveOpts: { comments: 'keep', flattenFields: false, protect: undefined },
    seq: 0, busy: false, formTip: false,
  };
  const root = h(`<div class="editor">
    <header class="ed-head">
      <div class="topbar">
        <button class="tb icon" data-a="close" title="Close">${icon('back')}</button>
        <div class="doc">${icon('pdf')}<b title="${esc(file)}">${esc(nameOf(file))}</b><span class="dirty" hidden>Unsaved</span></div>
        <div class="seg"><button class="tb icon" data-a="undo" title="Undo (Ctrl+Z)">${icon('undo')}</button><button class="tb icon" data-a="redo" title="Redo (Ctrl+Y)">${icon('redo')}</button></div>
        <div class="grow"></div>
        <div class="search">${icon('search', 'sm')}<input class="find" type="search" placeholder="Find in document" aria-label="Find in document"><button class="tb icon" data-a="replace" title="Find and replace (Ctrl H)">${icon('again', 'sm')}</button></div>
        <div class="seg zoombar"><button class="tb icon" data-a="zoomout" title="Zoom out (Ctrl −)">${icon('zoomOut', 'sm')}</button><select class="zoom" title="Zoom" aria-label="Zoom"></select><button class="tb icon" data-a="zoomin" title="Zoom in (Ctrl +)">${icon('zoomIn', 'sm')}</button><button class="tb icon" data-a="fit" title="Fit width (Ctrl 0)">${icon('fit', 'sm')}</button></div>
        <button class="tb icon" data-a="thumbs" title="Side panel: pages, bookmarks, comments and fields" aria-pressed="true">${icon('grid')}</button>
        <button class="tb docmenu" data-a="docmenu" title="Headers and footers, watermarks, properties, password and checks">${icon('layers', 'sm')}<span class="lbl">Document</span></button>
        ${helpButton()}
        <button class="btn" data-a="saveas">Save as…</button>
        <div class="splitbtn"><button class="btn primary" data-a="save">${icon('save', 'sm')}Save</button><button class="btn primary more" data-a="saveopts" title="Save options: comments, form fields and password" aria-label="Save options">${icon('down', 'sm')}</button></div>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Tools">
        ${TOOL_GROUPS.map(([name, ids], gi) => `<div class="tgroup${gi ? ' opt' : ''}${gi > 1 ? ' compact' : ''}" role="group" aria-label="${name}">${ids.map((id) => {
    if (id === 'shapes') return `<button class="tool" data-tool="rect" data-shapes aria-pressed="false" title="Shapes: boxes, ovals, arrows and lines">${icon('shapes')}<span class="lbl">Shapes</span></button>`;
    const [, ic, label, tip] = TOOLS.find((x) => x[0] === id) || INSERT.find((x) => x[0] === id);
    return `<button class="tool" ${TOOLS.some((x) => x[0] === id) ? `data-tool="${id}" aria-pressed="false"` : `data-a="${id}"`} title="${esc(`${label}: ${tip}`)}">${icon(ic)}<span class="lbl">${label}</span></button>`;
  }).join('')}</div>`).join('')}
      </div>
    </header>
    <div class="ed-body">
      <aside class="thumbs" aria-label="Side panel">
        <div class="seg sidetabs" role="tablist">
          <button class="tb" data-side="pages" aria-pressed="true" title="Pages">${icon('grid', 'sm')}</button>
          <button class="tb" data-side="bookmarks" aria-pressed="false" title="Bookmarks">${icon('bookmark', 'sm')}</button>
          <button class="tb" data-side="comments" aria-pressed="false" title="Comments">${icon('comment', 'sm')}<span class="count" hidden></span></button>
          <button class="tb" data-side="fields" aria-pressed="false" title="Form fields">${icon('field', 'sm')}</button>
          <button class="tb" data-side="history" aria-pressed="false" title="History">${icon('clock', 'sm')}</button>
        </div>
        <div class="pane" data-pane="pages"><div class="ops">
          <button class="tb" data-p="rotl" title="Rotate left">${icon('rotate', 'sm')}</button>
          <button class="tb" data-p="rotr" title="Rotate right" style="transform:scaleX(-1)">${icon('rotate', 'sm')}</button>
          <button class="tb" data-p="dup" title="Duplicate">${icon('copy', 'sm')}</button>
          <button class="tb" data-p="blank" title="Insert blank page">${icon('docAdd', 'sm')}</button>
          <button class="tb" data-p="file" title="Insert pages from a file">${icon('add', 'sm')}</button>
          <button class="tb" data-p="extract" title="Save selected pages as a new PDF">${icon('extract', 'sm')}</button>
          <button class="tb" data-p="split" title="Split into two PDFs after the selected page">${icon('flipV', 'sm')}</button>
          <button class="tb" data-p="crop" title="Crop pages">${icon('crop', 'sm')}</button>
          <button class="tb" data-p="labels" title="Page labels, like i, ii, iii for the front pages">${icon('listNum', 'sm')}</button>
          <button class="tb" data-p="del" title="Delete">${icon('delete', 'sm')}</button>
        </div><div class="tlist"></div></div>
        <div class="pane" data-pane="bookmarks" hidden></div>
        <div class="pane" data-pane="comments" hidden></div>
        <div class="pane" data-pane="fields" hidden></div>
        <div class="pane" data-pane="history" hidden></div>
      </aside>
      <section class="pages" tabindex="-1"><div class="ed-status" hidden></div></section>
      <aside class="props" aria-label="Properties"></aside>
    </div></div>`);
  view.append(root);
  const pagesEl = $('.pages', root), tlist = $('.tlist', root), props = $('.props', root), status = $('.ed-status', root), body = $('.ed-body', root);
  let disposed = false;
  const k = () => st.zoom * PT;

  call('fonts').then((list) => { st.fonts = list || []; if (st.sel?.type === 'text' || st.sel?.type === 'replace' || ['addtext', 'edittext'].includes(st.tool)) renderProps(); }).catch(() => {});
  async function load(password, src = file, quiet = false) {
    try {
      st.sess = await call('open', src, password);
    } catch (e) {
      const msg = String(e.message || e);
      if (/password/i.test(msg)) {
        const pw = await prompt('This PDF is protected', 'Enter the password to open it for editing.', 'password');
        if (pw) return load(pw, src, quiet);
      }
      if (quiet) return false;
      toast(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { type: 'error' });
      go();
      return false;
    }
    const z = mem.get('zoom'), s = mem.get('side');
    if (s === 'off') { body.classList.add('no-thumbs'); $('[data-a=thumbs]', root).setAttribute('aria-pressed', 'false'); } else if (s && s !== 'pages' && $(`[data-side="${s}"]`, root)) side.show(s);
    layout(true);
    if (z === 'page') fitPage(); else if (typeof z === 'number') setZoom(z); else fitWidth();
    selectTool(st.tool);
    if (mode === 'sign') setTimeout(signDialog, 200);
    if (mode === 'pages') tip('Drag pages in the panel to reorder. Select several with Ctrl or Shift.');
    return true;
  }
  async function start() {
    const rec = await recover.check();
    if (rec && (await offerRestore(rec, file))) {
      let copy = !!rec.data, ok = copy ? await load(undefined, rec.data, true) : await load();
      if (copy && !ok) { toast('The kept copy couldn’t be opened, so here is the file as it was.', { type: 'error' }); copy = false; ok = await load(); }
      if (ok) restoreFrom(rec, copy);
      return;
    }
    if (rec) recover.drop();
    load();
  }
  function restoreFrom(rec, copy) {
    const m = rec.meta || {};
    st.restored = copy;
    for (const o of m.pending || []) if (o.page < st.pages.length) addObj(o);
    st.fieldVals = m.fieldVals || {};
    Object.assign(st.saveOpts, m.saveOpts || {});
    if (TOOLS.some((t) => t[0] === m.tool)) selectTool(m.tool);
    marksChanged();
    side.draw();
    updateChrome();
    toast('Your unsaved edits are back. Save to keep them.', { type: 'success' });
  }
  const recover = recovery(api, file, async () => {
    if (!st.sess || !isDirty()) return null;
    const meta = { pending: st.pending.map(serializeObj), fieldVals: st.fieldVals, saveOpts: { comments: st.saveOpts.comments, flattenFields: st.saveOpts.flattenFields }, tool: st.tool };
    const copy = st.sess.dirty || st.restored;
    return { sig: `${JSON.stringify(meta)}|${st.rev}|${copy ? 'c' : ''}`, meta, ...(copy ? { ext: 'pdf', data: async () => (await call('snapshot', st.sess.id)).bytes } : {}) };
  });

  let io = null, tio = null;
  function layout(rebuildThumbs) {
    io?.disconnect();
    pagesEl.querySelectorAll('.pdfpage').forEach((p) => p.remove());
    st.renders.forEach((r) => URL.revokeObjectURL(r.url));
    st.renders.clear();
    st.lines.clear();
    st.paras.clear();
    st.objs.clear();
    st.pick = null;
    st.pages = st.sess.pages.map((p, i) => {
      const el = h(`<div class="pdfpage" data-p="${i}"><img class="r" alt=""><span class="num">${i + 1}</span><div class="layer"></div></div>`);
      pagesEl.append(el);
      return { ...p, el, layer: $('.layer', el), img: $('img', el), visible: false };
    });
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const i = Number(en.target.dataset.p), p = st.pages[i];
        if (!p) continue;
        p.visible = en.isIntersecting;
        if (en.isIntersecting) decoratePage(i);
      }
    }, { root: pagesEl, rootMargin: '600px 0px' });
    st.pages.forEach((p) => io.observe(p.el));
    sizePages();
    st.pages.forEach((p, i) => p.layer.addEventListener('pointerdown', (e) => onPointerDown(e, i)));
    st.pending.forEach(mountObj);
    if (rebuildThumbs) buildThumbs();
    updateChrome();
    loadMarks();
  }
  function decoratePage(i) {
    renderPage(st.pages[i], i);
    if (st.tool === 'edittext') showLines(i);
    if (st.tool === 'select') showObjects(i);
    drawMarks(i);
  }
  const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
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
    const decorate = () => {
      if (st.tool === 'edittext') st.pages.forEach((p, i) => p.visible && showLines(i));
      if (st.tool === 'select') st.pages.forEach((p, i) => p.visible && showObjects(i));
      st.pages.forEach((p, i) => p.visible && drawMarks(i));
      drawHits();
    };
    clearTimeout(decorT);
    if (quick) { pagesEl.querySelectorAll('.tline:not(.mask), .pobj, .pmark').forEach((x) => x.remove()); decorT = setTimeout(decorate, 160); return; }
    decorate();
  }
  async function renderPage(p, i) {
    const scale = Math.min(6, k() * (window.devicePixelRatio || 1));
    const have = st.renders.get(i);
    if (have && !have.stale && Math.abs(have.scale - scale) < 0.01) return;
    if (p.rendering === scale && !have?.stale) return;
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
  function refresh(pages) {
    for (const [i, r] of st.renders) if (!pages || pages.includes(i)) r.stale = true;
    st.lines.clear(); st.paras.clear(); st.objs.clear();
    st.pages.forEach((p, i) => { if (p.visible && (!pages || pages.includes(i))) { renderPage(p, i); if (st.tool === 'edittext') showLines(i); if (st.tool === 'select') showObjects(i); } });
    $$('.pthumb', tlist).forEach((t) => { if (!pages || pages.includes(Number(t.dataset.i))) { delete t.dataset.done; tio?.unobserve(t); tio?.observe(t); } });
    updateChrome();
    return loadMarks();
  }
  let rerenderT = null;
  function setZoom(z, at, fit = null) {
    st.fit = fit;
    const old = st.zoom, nz = Math.min(8, Math.max(0.2, z));
    if (Math.abs(nz - old) < 1e-4 || !st.pages.length) return;
    const r = pagesEl.getBoundingClientRect(), ax = at ? at.x : r.left + pagesEl.clientWidth / 2, ay = at ? at.y : r.top + pagesEl.clientHeight / 2;
    const page = st.pages.find((p) => { const b = p.el.getBoundingClientRect(); return ay >= b.top - 12 && ay <= b.bottom + 12; }) || st.pages.find((p) => p.visible) || st.pages[0];
    const b0 = page.el.getBoundingClientRect(), fx = (ax - b0.left) / b0.width, fy = (ay - b0.top) / b0.height;
    st.zoom = nz;
    mem.set({ zoom: fit || nz });
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
    setZoom(Math.min(3, avail / (w * PT)), undefined, 'width');
  }
  function fitPage() {
    const p = st.pages.find((x) => x.visible) || st.pages[0];
    if (!p) return;
    setZoom(Math.min((pagesEl.clientWidth - 96) / (p.w * PT), (pagesEl.clientHeight - 56) / (p.h * PT)), undefined, 'page');
    p.el.scrollIntoView({ block: 'center' });
  }
  function goTo(i, rect) {
    const p = st.pages[i];
    if (!p) return;
    if (!rect) { p.el.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    const kk = k(), [x0, y0, x1, y1] = rect, b = p.el.getBoundingClientRect(), r = pagesEl.getBoundingClientRect();
    pagesEl.scrollTo({ top: pagesEl.scrollTop + b.top - r.top + ((y0 + y1) / 2) * kk - pagesEl.clientHeight / 2, left: pagesEl.scrollLeft + b.left - r.left + ((x0 + x1) / 2) * kk - pagesEl.clientWidth / 2, behavior: 'smooth' });
    const f = h(`<div class="flash" style="left:${x0 * kk - 4}px;top:${y0 * kk - 4}px;width:${(x1 - x0) * kk + 8}px;height:${(y1 - y0) * kk + 8}px"></div>`);
    p.el.append(f);
    setTimeout(() => f.remove(), 1400);
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
        if (png && !disposed) { const im = $('img', en.target); if (im.src) URL.revokeObjectURL(im.src); im.src = URL.createObjectURL(new Blob([png], { type: 'image/png' })); }
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
    finishDraft();
    const filled = Object.keys(st.fieldVals).length;
    if (filled) { st.sess = await call('fill', st.sess.id, st.fieldVals); st.fieldVals = {}; record(`Filled in ${filled} field${filled === 1 ? '' : 's'}`); }
    if (!st.pending.length) return true;
    const edits = st.pending.map(serialize).filter(Boolean);
    const info = await call('apply', st.sess.id, edits);
    st.pending.forEach((o) => o.el?.remove());
    st.pending = [];
    st.sel = null;
    st.sess = info;
    if (edits.length) record(describe(edits));
    return true;
  }
  const WHAT = { replace: ['Replaced text', 'Replaced text in {n} places'], deleteText: ['Deleted a line', 'Deleted {n} lines'], text: ['Added text', 'Added {n} texts'], whiteout: ['Erased an area', 'Erased {n} areas'], erase: ['Removed an object', 'Removed {n} objects'], redact: ['Redacted an area', 'Redacted {n} areas'], highlight: ['Marked up text', 'Marked up {n} passages'], mark: ['Added a mark', 'Added {n} marks'], rect: ['Drew a box', 'Drew {n} boxes'], ellipse: ['Drew an oval', 'Drew {n} ovals'], line: ['Drew a line', 'Drew {n} lines'], arrow: ['Drew an arrow', 'Drew {n} arrows'], ink: ['Drew freehand', 'Drew {n} strokes'], measure: ['Measured', 'Measured {n} times'], image: ['Added a picture', 'Added {n} pictures'], signature: ['Signed', 'Signed {n} times'] };
  function describe(edits) {
    const pages = [...new Set(edits.map((e) => e.page))], where = pages.length === 1 ? ` on page ${pages[0] + 1}` : ` on ${pages.length} pages`;
    if (edits.length === 1) { const e = edits[0]; return `${e.type === 'text' && e.border ? `Stamp ${e.text}` : WHAT[e.type]?.[0] || 'Changed'}${where}`; }
    const one = new Set(edits.map((e) => e.type)).size === 1 && WHAT[edits[0].type];
    return `${one ? one[1].replace('{n}', edits.length) : `${edits.length} changes`}${where}`;
  }
  function record(label) {
    st.history = [...st.history.slice(0, st.histAt + 1), { label }];
    if (st.history.length > 31) st.history.splice(1, 1);
    st.histAt = st.history.length - 1;
    updateChrome();
  }
  const PAGE_OPS = { rotate: 'Turned', delete: 'Deleted', duplicate: 'Duplicated', move: 'Moved', crop: 'Cropped', uncrop: 'Uncropped' };
  function pageLabel(op) {
    if (op.type === 'blank') return 'Inserted a blank page';
    if (op.type === 'insertFile') return `Inserted pages from ${nameOf(op.file)}`;
    const n = (op.pages || []).length, pg = n === 1 ? `page ${op.pages[0] + 1}` : `${n} pages`;
    return op.type === 'crop' && op.auto ? `Trimmed the margins of ${pg}` : `${PAGE_OPS[op.type] || 'Changed'} ${pg}`;
  }
  async function goToStep(i) {
    if (i < 0 || i >= st.history.length || (i === st.histAt && !st.pending.length)) return;
    await busy(i < st.histAt ? 'Going back…' : 'Going forward…', async () => {
      await flush();
      while (st.histAt > i && st.sess.canUndo) { st.sess = await call('undo', st.sess.id); st.histAt--; }
      while (st.histAt < i && st.sess.canRedo) { st.sess = await call('redo', st.sess.id); st.histAt++; }
      layout(true);
    });
    if (st.histAt !== i) tip('Only the last 30 steps can be undone.');
    side.draw();
  }
  async function pageOp(op, keep) {
    return busy('Updating pages…', async () => {
      await flush();
      st.sess = await call('pageOp', st.sess.id, op);
      record(pageLabel(op));
      if (!keep) st.selPages = new Set([Math.min(op.to ?? [...st.selPages][0] ?? 0, st.sess.pages.length - 1)]);
      st.crop = null;
      layout(true);
      return true;
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
    if (a === 'crop') selectTool('crop');
    if (a === 'labels') pageLabels(sel);
    const stem = `${dirOf(file)}${sep}${nameOf(file).replace(/\.pdf$/i, '')}`;
    if (a === 'extract') {
      const out = await api.invoke('dialog:save', { defaultPath: `${stem} - pages ${sel.map((x) => x + 1).join(',')}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (out) await busy('Saving pages…', async () => { await flush(); layout(false); await call('exportPages', st.sess.id, sel, out); toast(`Saved ${nameOf(out)}`, { type: 'success', actions: [{ label: 'Show in folder', fn: () => api.invoke('shell:show', out) }] }); });
    }
    if (a === 'split') {
      const n = st.sess.pages.length, at = sel[sel.length - 1] ?? 0;
      if (at >= n - 1) { toast('Select a page before the last one: the split comes after it.', { type: 'error' }); return; }
      const out = await api.invoke('dialog:save', { defaultPath: `${stem} - part 1.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (!out) return;
      const second = out.replace(/(\s*-?\s*part\s*)1(\.pdf)$/i, '$12$2').replace(/^(?!.*part\s*2\.pdf$)(.*)\.pdf$/i, '$1 - part 2.pdf');
      await busy('Splitting…', async () => {
        await flush(); layout(false);
        await call('exportPages', st.sess.id, [...Array(at + 1).keys()], out);
        await call('exportPages', st.sess.id, Array.from({ length: n - at - 1 }, (_, x) => at + 1 + x), second);
        toast(`Saved ${nameOf(out)} and ${nameOf(second)}`, { type: 'success', actions: [{ label: 'Show in folder', fn: () => api.invoke('shell:show', out) }] });
      });
    }
  });
  function pageLabels(sel) {
    const n = st.sess.pages.length, from = (sel[0] ?? 0) + 1, to = (sel[sel.length - 1] ?? 0) + 1;
    const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>Page labels</h2><div class="dlgform one">
      <div class="row2"><label><span class="label">From page</span><input class="input" type="number" min="1" max="${n}" data-f="from" value="${from}"></label><label><span class="label">To page</span><input class="input" type="number" min="1" max="${n}" data-f="to" value="${to === from ? n : to}"></label></div>
      <div class="row2"><label><span class="label">Style</span><select class="input" data-f="style"><option value="decimal">1, 2, 3</option><option value="lower-roman">i, ii, iii</option><option value="upper-roman">I, II, III</option><option value="lower-alpha">a, b, c</option><option value="upper-alpha">A, B, C</option><option value="none">Prefix only</option></select></label>
      <label><span class="label">Start at</span><input class="input" type="number" min="1" data-f="start" value="1"></label></div>
      <label><span class="label">Prefix</span><input class="input" data-f="prefix" placeholder="e.g. A-"></label></div></div>
      <div class="foot"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">Apply</button></div></div></div>`);
    document.body.append(s);
    s.addEventListener('keydown', (e) => e.stopPropagation());
    s.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      const v = Object.fromEntries($$('[data-f]', s).map((x) => [x.dataset.f, x.value]));
      s.remove();
      if (a === 'ok') docChange({ kind: 'labels', opts: v }, 'Page labels set.');
    });
  }

  const linesOf = (i) => { if (!st.lines.has(i)) st.lines.set(i, call('text', st.sess.id, i).catch(() => [])); return st.lines.get(i); };
  const takenLines = (i) => new Set(st.pending.filter((o) => o.page === i).flatMap((o) => o.lineIds || (o.lineId ? [o.lineId] : [])));
  async function showLines(i) {
    const p = st.pages[i];
    if (!p) return;
    const paras = st.editBy === 'paragraph';
    if (paras && !st.paras.has(i)) st.paras.set(i, call('paragraphs', st.sess.id, i).catch(() => []));
    const items = await (paras ? st.paras.get(i) : linesOf(i));
    if (st.tool !== 'edittext' || disposed) return;
    p.layer.querySelectorAll('.tline:not(.mask)').forEach((x) => x.remove());
    const kk = k(), taken = takenLines(i);
    for (const l of items) {
      if (paras ? l.lineIds.some((x) => taken.has(x)) : !l.editable || taken.has(l.id)) continue;
      const [x0, y0, x1, y1] = l.bbox;
      const el = h(`<div class="tline${paras ? ' para' : ''}" style="left:${x0 * kk}px;top:${y0 * kk}px;width:${(x1 - x0) * kk}px;height:${(y1 - y0) * kk}px" title="Click to edit"></div>`);
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); if (paras) beginParaEdit(i, l, el); else beginLineEdit(i, l, el); });
      p.layer.append(el);
    }
  }
  function hideLines() { pagesEl.querySelectorAll('.tline:not(.mask)').forEach((x) => x.remove()); }
  const KIND = { image: 'Picture', table: 'Table', drawing: 'Drawing', text: 'Text block' };
  async function showObjects(i) {
    const p = st.pages[i];
    if (!p) return;
    if (!st.objs.has(i)) st.objs.set(i, call('objects', st.sess.id, i).catch(() => []));
    const list = await st.objs.get(i);
    if (st.tool !== 'select' || disposed) return;
    p.layer.querySelectorAll('.pobj').forEach((x) => x.remove());
    const kk = k(), gone = new Set(st.pending.filter((o) => o.type === 'erase' && o.page === i).map((o) => o.objId)), picked = new Set(pickedObjs().map((x) => x.id));
    const under = p.layer.firstChild;
    for (const it of list) {
      if (gone.has(it.id)) continue;
      const [x0, y0, x1, y1] = it.bbox;
      const el = h(`<div class="pobj${picked.has(it.id) ? ' sel' : ''}" data-id="${it.id}" title="${KIND[it.kind]}: click to select (Shift adds), then Delete" style="left:${x0 * kk}px;top:${y0 * kk}px;width:${(x1 - x0) * kk}px;height:${(y1 - y0) * kk}px"></div>`);
      el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); pickObj(i, it, e.shiftKey); });
      p.layer.insertBefore(el, under);
    }
  }
  function hideObjects() { pagesEl.querySelectorAll('.pobj').forEach((x) => x.remove()); st.pick = null; }
  const pickedObjs = () => (st.pick ? [st.pick.obj, ...(st.pick.more || [])] : []);
  function pickObj(i, it, add) {
    commitEditing();
    st.sel = null;
    st.annSel = null;
    st.pending.forEach((x) => x.el?.classList.remove('sel'));
    let all = [it];
    if (add && st.pick?.page === i) { const had = pickedObjs(); all = had.some((x) => x.id === it.id) ? had.filter((x) => x.id !== it.id) : [...had, it]; }
    st.pick = all.length ? { page: i, obj: all[0], more: all.slice(1) } : null;
    const ids = new Set(all.map((x) => x.id));
    pagesEl.querySelectorAll('.pobj').forEach((x) => x.classList.toggle('sel', ids.has(x.dataset.id)));
    marksChanged();
    renderProps();
  }
  function marquee(e, i, x0, y0) {
    const p = st.pages[i], box = h('<div class="marquee"></div>');
    let r = null;
    const mv = (ev) => {
      const [x1, y1] = ptOf(ev, i), kk = k();
      if (!box.isConnected) { if (Math.hypot(x1 - x0, y1 - y0) * kk < 6) return; p.layer.append(box); }
      r = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
      Object.assign(box.style, { left: `${r[0] * kk}px`, top: `${r[1] * kk}px`, width: `${(r[2] - r[0]) * kk}px`, height: `${(r[3] - r[1]) * kk}px` });
    };
    const up = async () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      box.remove();
      if (!r || !st.objs.has(i)) return;
      const gone = new Set(st.pending.filter((o) => o.type === 'erase' && o.page === i).map((o) => o.objId));
      const hit = (await st.objs.get(i)).filter((it) => !gone.has(it.id) && it.bbox[0] < r[2] && it.bbox[2] > r[0] && it.bbox[1] < r[3] && it.bbox[3] > r[1]);
      if (hit.length && st.tool === 'select') { st.pick = null; hit.forEach((it, n) => pickObj(i, it, n > 0)); }
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }
  function erasePicked() {
    const { page } = st.pick, objs = pickedObjs();
    st.pick = null;
    let o = null;
    for (const obj of objs) { const [x0, y0, x1, y1] = obj.bbox; o = addObj({ type: 'erase', page, rect: [x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2], bbox: obj.bbox, kind: obj.kind, objId: obj.id }); }
    showObjects(page);
    select(o);
    return o;
  }
  async function replacePicture() {
    const { page, obj } = st.pick;
    const [f] = await api.invoke('dialog:open', { multi: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'svg', 'bmp', 'tif', 'tiff'] }] });
    if (!f) return;
    const data = await api.invoke('files:dataUrl', f, 2400);
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = data; });
    erasePicked();
    const [x0, y0, x1, y1] = obj.bbox, bw = x1 - x0, bh = y1 - y0, s = Math.min(bw / img.naturalWidth, bh / img.naturalHeight), w = img.naturalWidth * s, hh = img.naturalHeight * s;
    select(addObj({ type: 'image', page, rect: [x0 + (bw - w) / 2, y0 + (bh - hh) / 2, w, hh], data }));
  }
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
  function beginParaEdit(page, para, el) {
    commitEditing();
    el.remove();
    const o = addObj({
      type: 'replace', page, lineIds: para.lineIds, bbox: para.bbox, x: para.origin[0], y: para.origin[1], text: para.text, original: para.text, wrap: Math.ceil(para.bbox[2] - para.bbox[0] + 2),
      size: para.size, font: matchFont(para), bold: para.bold, italic: para.italic, color: para.color, lineHeight: para.lineHeight, align: para.align,
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
    else if (o.type === 'redact') el = h(`<div class="obj redact" title="Marked for redaction"></div>`);
    else if (o.type === 'erase') {
      el = h(`<div class="obj erase" title="Removed ${esc(KIND[o.kind] || 'area').toLowerCase()}: select and press Delete to put it back"></div>`);
      const box = el;
      call('patch', st.sess.id, o.page, o.bbox, Math.min(4, k() * (window.devicePixelRatio || 1) * 1.5), 'erase').then((png) => { if (png && o.el === box) box.style.backgroundImage = `url(${URL.createObjectURL(new Blob([png], { type: 'image/png' }))})`; }).catch(() => { box.style.background = '#fff'; });
    }
    else if (o.type === 'highlight') el = h(`<div class="obj" style="mix-blend-mode:multiply"></div>`);
    else if (o.type === 'image' || o.type === 'signature') el = h(`<div class="obj"><img alt="" src="${o.data}"></div>`);
    else if (o.type === 'measure') el = h(`<div class="obj measure"><svg></svg></div>`);
    else el = h(`<div class="obj"><svg></svg></div>`);
    el.append(h(`<span class="handle" aria-hidden="true"></span>`));
    if (ROTATES(o)) el.append(h(`<span class="rot" aria-hidden="true" title="Drag to rotate (Shift for steps of 15°)"></span>`));
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
      css(o.x, o.y - o.size * 0.86, o.wrap || null);
      Object.assign(el.style, {
        fontSize: `${o.size * kk}px`, color: o.color, fontWeight: o.bold ? '700' : '400', fontStyle: o.italic ? 'italic' : 'normal', fontFamily: fontCss(o.font),
        textDecoration: [o.underline && 'underline', o.strike && 'line-through'].filter(Boolean).join(' ') || 'none', textAlign: o.align || 'left',
        lineHeight: String(o.lineHeight || 1.2), letterSpacing: `${(o.spacing || 0) * kk}px`, opacity: String(o.opacity ?? 1), whiteSpace: o.wrap ? 'pre-wrap' : '',
        background: o.bg && o.bg !== 'none' ? o.bg : '', boxShadow: o.bg && o.bg !== 'none' ? `0 0 0 ${o.size * 0.18 * kk}px ${o.bg}` : '',
      });
      const bd = o.border && o.border !== 'none' ? o.border : '', pad = o.size * 0.18, bw = Math.max(1, o.size / 12), rad = o.size * 0.22;
      el.classList.toggle('bordered', !!bd);
      el.style.borderRadius = bd ? `${Math.max(0, rad - pad) * kk}px` : '';
      if (bd) for (const [n, v] of [['--bd', bd], ['--bpad', `${(pad + bw) * kk}px`], ['--bw', `${bw * kk}px`], ['--brad', `${(rad + bw / 2) * kk}px`]]) el.style.setProperty(n, v);
      el.style.transform = o.rotate ? `rotate(${o.rotate}deg)` : '';
      return;
    }
    if (o.rect) {
      const [x, y, w, hh] = o.rect;
      css(x, y, w, hh);
      if (o.type === 'whiteout') el.style.background = o.fill || '#ffffff';
      if (o.type === 'image' || o.type === 'signature') el.style.opacity = String(o.opacity ?? 1);
      if (o.type === 'highlight') {
        const line = Math.max(1, hh * 0.08) * kk, at = { underline: 'bottom', strike: '55%' }[o.markup];
        el.style.background = at ? `linear-gradient(${o.color}, ${o.color}) left ${at} / 100% ${line}px no-repeat` : o.color;
        el.style.opacity = at ? '1' : '0.5';
      }
      if (o.type === 'mark') {
        $('svg', el).innerHTML = markSvg(o.kind, w * kk, hh * kk, o.stroke, (o.width || 2) * kk);
        Object.assign(el.style, { opacity: String(o.opacity ?? 1), transform: o.rotate ? `rotate(${o.rotate}deg)` : '' });
      }
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
    if (o.type === 'measure') {
      const xs = o.points.map((q) => q[0]), ys = o.points.map((q) => q[1]), pad = 40;
      const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
      css(x, y, Math.max(...xs) - x + pad, Math.max(...ys) - y + pad);
      const pts = o.points.map((q) => `${(q[0] - x) * kk},${(q[1] - y) * kk}`).join(' '), sw = (o.width || 1.5) * kk;
      const label = measureLabel(o), [lx, ly] = labelAt(o).map((v, i) => (v - (i ? y : x)) * kk);
      const ends = o.kind === 'distance' ? o.points.filter((_, i) => i === 0 || i === o.points.length - 1).map((q) => { const a = Math.atan2(o.points[o.points.length - 1][1] - o.points[0][1], o.points[o.points.length - 1][0] - o.points[0][0]) + Math.PI / 2, L = 5 * kk, cx = (q[0] - x) * kk, cy = (q[1] - y) * kk; return `<line x1="${cx - L * Math.cos(a)}" y1="${cy - L * Math.sin(a)}" x2="${cx + L * Math.cos(a)}" y2="${cy + L * Math.sin(a)}"/>`; }).join('') : '';
      const shape = o.kind === 'area' ? `<polygon points="${pts}" fill="${o.stroke}" fill-opacity="0.08"/>` : `<polyline points="${pts}" fill="none"/>`;
      $('svg', el).innerHTML = `<g stroke="${o.stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${shape}${ends}</g><text x="${lx}" y="${ly}" font-size="${11 * kk}" text-anchor="middle" fill="${o.stroke}" paint-order="stroke" stroke="#fff" stroke-width="${3 * kk}">${esc(label)}</text>`;
      return;
    }
    if (o.type === 'ink') {
      const xs = o.points.map((q) => q[0]), ys = o.points.map((q) => q[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      css(x, y, Math.max(1, Math.max(...xs) - x), Math.max(1, Math.max(...ys) - y));
      $('svg', el).innerHTML = `<polyline fill="none" stroke="${o.stroke}" stroke-width="${(o.width || 2) * kk}" stroke-linecap="round" stroke-linejoin="round" points="${o.points.map((q) => `${(q[0] - x) * kk},${(q[1] - y) * kk}`).join(' ')}"/>`;
    }
  }
  function measureLabel(o) {
    const u = (UNITS[o.unit] || UNITS.mm) * (o.ratio || 1), p = o.points, fmt = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
    if (o.kind === 'area') { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return `${fmt((Math.abs(a) / 2) * u * u)} ${o.unit}²`; }
    let len = 0;
    for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    return `${fmt(len * u)} ${o.unit}`;
  }
  function labelAt(o) {
    const p = o.points;
    if (o.kind === 'area') return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length + 4];
    const [a, b] = [p[p.length - 2] || p[0], p[p.length - 1]];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 6];
  }
  const textStyle = (o) => ({ size: o.size, font: o.font, bold: o.bold, italic: o.italic, color: o.color, underline: !!o.underline, strike: !!o.strike, bg: o.bg && o.bg !== 'none' ? o.bg : '', border: o.border && o.border !== 'none' ? o.border : '', rotate: o.rotate || 0, align: o.align || 'left', lineHeight: o.lineHeight || 1.2, spacing: o.spacing || 0, opacity: o.opacity ?? 1, ...(o.wrap ? { wrap: o.wrap } : {}) });
  const author = () => (ctx.settings() || {}).author || '';
  function serialize(o) {
    const base = { page: o.page, type: o.type }, by = { author: author() };
    switch (o.type) {
      case 'replace': return o.text === o.original && !o.styled ? null : (o.text.trim() ? { ...base, bbox: o.bbox, x: o.x, y: o.y, text: o.text, ...textStyle(o) } : { page: o.page, type: 'deleteText', bbox: o.bbox });
      case 'deleteText': return { ...base, bbox: o.bbox };
      case 'text': return o.text.trim() ? { ...base, x: o.x, y: o.y, text: o.text, ...textStyle(o) } : null;
      case 'whiteout': return { ...base, rect: o.rect, fill: o.fill };
      case 'erase': return { ...base, rect: o.rect };
      case 'redact': return { ...base, rect: o.rect, boxes: st.redact.boxes };
      case 'highlight': return { ...base, ...by, rect: o.rect, color: o.color, opacity: 0.45, markup: o.markup || 'highlight' };
      case 'mark': return { ...base, rect: o.rect, kind: o.kind, stroke: o.stroke, width: o.width, rotate: o.rotate || 0, opacity: o.opacity ?? 1 };
      case 'rect': case 'ellipse': return { ...base, ...by, rect: o.rect, stroke: o.stroke, fill: o.fill, width: o.width };
      case 'line': case 'arrow': return { ...base, ...by, x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, stroke: o.stroke, width: o.width };
      case 'ink': return { ...base, ...by, points: o.points, stroke: o.stroke, width: o.width };
      case 'measure': return o.points.length >= (o.kind === 'area' ? 3 : 2) ? { ...base, ...by, kind: o.kind, points: o.points, stroke: o.stroke, width: o.width || 1.5, contents: measureLabel(o) } : null;
      case 'image': case 'signature': return { ...base, rect: o.rect, data: o.data, opacity: o.opacity ?? 1, ...(o.alt?.trim() ? { alt: o.alt.trim() } : {}) };
      default: return null;
    }
  }
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
    if (st.draft === o) st.draft = null;
    if (o.type === 'replace' && st.tool === 'edittext') showLines(o.page);
    if (o.type === 'erase' && st.tool === 'select') showObjects(o.page);
    renderProps(); updateChrome();
  }
  function select(o) {
    st.sel = o;
    st.pick = null;
    if (o) { st.annSel = null; st.linkSel = null; st.fieldSel = null; }
    pagesEl.querySelectorAll('.pobj.sel').forEach((x) => x.classList.remove('sel'));
    st.pending.forEach((x) => x.el?.classList.toggle('sel', x === o));
    if (o) marksChanged();
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
      else if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && o.type === 'replace' && !o.wrap)) { e.preventDefault(); commitEditing(); }
      else if (e.key === 'Enter' && !e.shiftKey) continueList(e);
      e.stopPropagation();
    };
    o.el.onblur = () => setTimeout(() => { if (editing === o && document.activeElement !== o.el) commitEditing(); }, 0);
  }
  function continueList(e) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0), pre = r.cloneRange();
    pre.selectNodeContents(editing.el);
    pre.setEnd(r.endContainer, r.endOffset);
    const line = pre.toString().split('\n').pop(), m = LIST_MARK.exec(line);
    if (!m) return;
    e.preventDefault();
    if (line === m[0]) { for (let i = 0; i < m[0].length; i++) document.execCommand('delete'); return; }
    const n = /^(\d+)\. /.exec(line);
    document.execCommand('insertText', false, `\n${n ? `${Number(n[1]) + 1}. ` : '• '}`);
  }
  function setList(o, kind) {
    const lines = o.text.split('\n'), has = (l) => (kind === 'bullet' ? /^• /.test(l) : /^\d+\. /.test(l)), all = lines.every(has);
    o.text = lines.map((l, i) => { const bare = l.replace(LIST_MARK, ''); return all ? bare : kind === 'bullet' ? `• ${bare}` : `${i + 1}. ${bare}`; }).join('\n');
    if (o.type === 'replace') o.styled = true;
    setText(o);
    updateChrome();
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
    if (st.draft) { onPointerDown(e, o.page, true); return; }
    commitEditing();
    select(o);
    if (o.type === 'erase') return;
    const handle = e.target.classList.contains('handle');
    if (e.target.classList.contains('rot')) { turnObj(e, o); return; }
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
          if (o.type === 'image' || o.type === 'signature' || o.type === 'mark') hh = w * (snap.rect[3] / snap.rect[2]);
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
  function turnObj(e, o) {
    const r = o.el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const move = (ev) => {
      let a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      if (ev.shiftKey) a = Math.round(a / 15) * 15;
      o.rotate = Math.round(((a + 540) % 360) - 180);
      positionObj(o);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); renderProps(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function setText(o) {
    const t = [...o.el.childNodes].find((n) => n.nodeType === 3) || o.el.insertBefore(document.createTextNode(''), o.el.firstChild);
    t.textContent = o.text;
    positionObj(o);
  }
  function dragBox(e, i, cls, done) {
    const [x0, y0] = ptOf(e, i), kk = k();
    const el = h(`<div class="pmark ${cls}" style="left:${x0 * kk}px;top:${y0 * kk}px"></div>`);
    st.pages[i].layer.append(el);
    let r = [x0, y0, 0, 0];
    const move = (ev) => {
      const [x, y] = ptOf(ev, i);
      r = [Math.min(x0, x), Math.min(y0, y), Math.abs(x - x0), Math.abs(y - y0)];
      Object.assign(el.style, { left: `${r[0] * k()}px`, top: `${r[1] * k()}px`, width: `${r[2] * k()}px`, height: `${r[3] * k()}px` });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); el.remove(); done(r); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function onPointerDown(e, i, force) {
    if (!force && (e.button !== 0 || e.target.closest('.obj, .pmark'))) return;
    commitEditing();
    const s = st.style;
    const [x0, y0] = ptOf(e, i);
    st.selPages = new Set([i]);
    if (st.tool === 'select' || st.tool === 'edittext') { select(null); if (st.annSel) { st.annSel = null; side.draw(); marksChanged(); } if (st.tool === 'select') marquee(e, i, x0, y0); return; }
    if (st.tool === 'addtext') {
      e.preventDefault();
      const o = addObj({ type: 'text', page: i, x: x0, y: y0 + s.size * 0.86, text: '', size: s.size, font: s.font, bold: s.bold, italic: s.italic, color: s.color, underline: s.underline, strike: s.strike, bg: s.bg, border: s.border, align: s.align, lineHeight: s.lineHeight, spacing: s.spacing, opacity: s.opacity });
      select(o);
      setTimeout(() => editText(o, false), 0);
      return;
    }
    if (st.tool === 'stamp') { e.preventDefault(); placeStamp(i, x0, y0); select(null); tip('Placed. Click it to change, move or delete it.'); return; }
    if (st.tool === 'note') { e.preventDefault(); addNote(i, x0, y0); return; }
    if (st.tool === 'link') {
      e.preventDefault();
      st.linkSel = null;
      dragBox(e, i, 'plink draft', (r) => { if (r[2] < 4 || r[3] < 4) { st.linkDraft = null; renderProps(); marksChanged(); return; } st.linkDraft = { page: i, rect: r }; marksChanged(); renderProps(); setTimeout(() => $('.props [data-l=url], .props [data-l=page]')?.focus(), 0); });
      return;
    }
    if (st.tool === 'field') {
      e.preventDefault();
      dragBox(e, i, 'pfield draft', (r) => {
        const kind = st.fieldKind, tick = kind === 'checkbox' || kind === 'radio';
        if (tick && (r[2] < 6 || r[3] < 6)) r = [x0 - 7, y0 - 7, 14, 14];
        else if (r[2] < 8 || r[3] < 8) r = [x0, y0 - 10, kind === 'signature' ? 180 : 160, kind === 'signature' ? 40 : kind === 'list' ? 60 : 20];
        if (tick) { const d = Math.min(r[2], r[3]); r = [r[0], r[1], d, d]; }
        addField(i, r);
      });
      return;
    }
    if (st.tool === 'crop') {
      e.preventDefault();
      dragBox(e, i, 'cropdraft', (r) => { if (r[2] > 18 && r[3] > 18) st.crop = { page: i, rect: r }; marksChanged(); renderProps(); });
      return;
    }
    if (st.tool === 'measure') { e.preventDefault(); measureDown(e, i, x0, y0); return; }
    e.preventDefault();
    let o;
    const t = st.tool;
    if (t === 'draw') o = addObj({ type: 'ink', page: i, points: [[x0, y0]], stroke: s.stroke, width: s.width });
    else if (t === 'line' || t === 'arrow') o = addObj({ type: t, page: i, x1: x0, y1: y0, x2: x0, y2: y0, stroke: s.stroke, width: s.width });
    else o = addObj({ type: t, page: i, rect: [x0, y0, 0, 0], stroke: s.stroke, fill: t === 'whiteout' ? s.erase : s.fill, width: s.width, color: t === 'highlight' && s.markup !== 'highlight' ? s.ul : s.hl, ...(t === 'highlight' ? { markup: s.markup } : {}) });
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
  const snap45 = (from, to, on) => { if (!on) return to; const a = Math.round(Math.atan2(to[1] - from[1], to[0] - from[0]) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(to[0] - from[0], to[1] - from[1]); return [from[0] + L * Math.cos(a), from[1] + L * Math.sin(a)]; };
  function measureDown(e, i, x0, y0) {
    const m = st.measure, base = { type: 'measure', kind: m.kind, stroke: st.style.measure, width: 1.5, ratio: m.ratio, unit: m.unit };
    if (m.kind === 'distance') {
      const o = addObj({ ...base, page: i, points: [[x0, y0], [x0, y0]] });
      const move = (ev) => { o.points[1] = snap45(o.points[0], ptOf(ev, i), ev.shiftKey); positionObj(o); renderProps(); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (Math.hypot(o.points[1][0] - x0, o.points[1][1] - y0) < 3) removeObj(o); else select(o); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if (st.draft && st.draft.page !== i) finishDraft();
    if (!st.draft) {
      st.draft = addObj({ ...base, page: i, points: [[x0, y0], [x0, y0]] });
      const follow = (ev) => { const o = st.draft; if (!o) { window.removeEventListener('pointermove', follow); return; } o.points[o.points.length - 1] = snap45(o.points[o.points.length - 2], ptOf(ev, o.page), ev.shiftKey); positionObj(o); };
      window.addEventListener('pointermove', follow);
      tip('Click each corner; double-click the last one, or press Enter.', true);
      return;
    }
    const o = st.draft;
    if (e.detail >= 2) { finishDraft(); return; }
    o.points.push([...o.points[o.points.length - 1]]);
    positionObj(o);
  }
  function finishDraft() {
    const o = st.draft;
    if (!o) return;
    st.draft = null;
    tip(null);
    o.points.pop();
    while (o.points.length > 1 && Math.hypot(o.points[o.points.length - 1][0] - o.points[o.points.length - 2][0], o.points[o.points.length - 1][1] - o.points[o.points.length - 2][1]) < 1) o.points.pop();
    if (o.points.length < (o.kind === 'area' ? 3 : 2)) removeObj(o); else { positionObj(o); select(o); }
  }

  function placeStamp(i, x, y) {
    const s = st.style, v = s.stamp, plain = { font: 'sans', italic: false, underline: false, strike: false, bg: 'none', align: 'left', lineHeight: 1.2, opacity: 1 };
    if (v.startsWith('mark:')) return addObj({ type: 'mark', kind: v.slice(5), page: i, rect: [x, y, 16, 16], stroke: s.mark, width: 2 });
    if (v === 'date') return addObj({ type: 'text', page: i, x, y: y + 12 * 0.86, text: today(), size: 12, color: s.color, bold: false, border: 'none', spacing: 0, ...plain });
    const [text, color] = v === 'custom' ? [s.stampText.trim() || 'STAMP', s.stampColor] : STAMPS.find(([n]) => n === v) || STAMPS[0], size = 16, pad = size * 0.18 + Math.max(1, size / 12);
    return addObj({ type: 'text', page: i, x: x + pad, y: y + pad + size * 0.86, text, size, color, bold: true, border: color, spacing: 0.6, ...plain, opacity: 0.9 });
  }

  async function loadMarks() {
    if (!st.sess) return;
    const id = st.sess.id;
    const [annots, links, fields, outline] = await Promise.all([call('annots', id), call('links', id), call('fields', id), call('outline', id)].map((p) => p.catch(() => [])));
    if (disposed || st.sess?.id !== id) return;
    st.marks = { annots, links, fields };
    st.outline = outline;
    if (st.annSel && !annots.some((a) => a.id === st.annSel)) st.annSel = null;
    if (st.linkSel && !links.some((l) => l.page === st.linkSel.page && l.index === st.linkSel.index)) st.linkSel = null;
    if (st.fieldSel && !fields.some((f) => f.name === st.fieldSel)) st.fieldSel = null;
    marksChanged();
    side.draw();
    if (fields.length && !st.formTip && mode === 'edit') {
      st.formTip = true;
      if (st.tool !== 'field' && st.tool !== 'select' && !st.pending.length) selectTool('select');
      tip('This PDF is a form: click a field to fill it in.');
    }
    if (!props.contains(document.activeElement)) renderProps();
  }
  function marksChanged() { st.pages.forEach((p, i) => p.visible && drawMarks(i)); }
  const FILLS = new Set(['select', 'edittext', 'addtext']);
  function drawMarks(i) {
    const p = st.pages[i];
    if (!p) return;
    p.layer.querySelectorAll('.pmark:not(.draft):not(.cropdraft)').forEach((x) => x.remove());
    const kk = k(), t = st.tool;
    const style = (r) => `left:${r[0] * kk}px;top:${r[1] * kk}px;width:${Math.max(2, (r[2] - r[0]) * kk)}px;height:${Math.max(2, (r[3] - r[1]) * kk)}px`;
    if (t === 'select' || t === 'note') {
      for (const a of st.marks.annots) {
        if (a.page !== i || a.replyTo != null) continue;
        const el = h(`<div class="pmark pannot${st.annSel === a.id ? ' sel' : ''}" style="${style(a.rect)}" title="${esc(`${kindOf(a)}${a.author ? ` by ${a.author}` : ''}${a.contents ? `: ${a.contents.slice(0, 120)}` : ''}`)}"></div>`);
        el.addEventListener('pointerdown', (e) => annotPointer(e, a, el));
        p.layer.append(el);
      }
    }
    if (t === 'link') {
      for (const l of st.marks.links) {
        if (l.page !== i) continue;
        const sel = st.linkSel?.page === i && st.linkSel.index === l.index;
        const el = h(`<div class="pmark plink${sel ? ' sel' : ''}" style="${style(l.rect)}" title="${esc(l.url || (l.toPage != null ? `Page ${l.toPage + 1}` : 'Link'))}"></div>`);
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); st.linkDraft = null; st.linkSel = { page: i, index: l.index }; st.linkTo = l.url ? 'url' : 'page'; select(null); marksChanged(); });
        p.layer.append(el);
      }
      if (st.linkDraft?.page === i) { const r = st.linkDraft.rect; p.layer.append(h(`<div class="pmark plink sel new" style="${style([r[0], r[1], r[0] + r[2], r[1] + r[3]])}"></div>`)); }
    }
    if (t === 'field') for (const f of st.marks.fields) if (f.page === i) p.layer.append(fieldBox(f, style));
    if (FILLS.has(t)) for (const f of st.marks.fields) if (f.page === i) p.layer.append(fieldInput(f, style));
    if (t === 'crop' && st.crop?.page === i) {
      const r = st.crop.rect;
      p.layer.append(h(`<div class="pmark cropdim"><div class="cropbox" style="${style([r[0], r[1], r[0] + r[2], r[1] + r[3]])}"></div></div>`));
    }
  }
  function annotPointer(e, a, el) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    commitEditing();
    select(null);
    const pick = () => { st.annSel = a.id; side.select(a.id); renderProps(); };
    if (a.type !== 'Text') { pick(); return; }
    const x0 = e.clientX, y0 = e.clientY, l0 = parseFloat(el.style.left), t0 = parseFloat(el.style.top);
    let moved = false;
    const move = (ev) => { const dx = ev.clientX - x0, dy = ev.clientY - y0; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; el.style.left = `${l0 + dx}px`; el.style.top = `${t0 + dy}px`; el.classList.add('moving'); };
    const up = async (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!moved) { pick(); return; }
      st.annSel = a.id;
      const dx = (ev.clientX - x0) / k(), dy = (ev.clientY - y0) / k();
      const r = await busy('Moving the note…', () => call('annotOp', st.sess.id, { type: 'edit', page: a.page, num: a.num, dx, dy }));
      if (r) { st.sess = r; record('Moved a note'); refresh([a.page]); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  async function addNote(i, x, y) {
    const r = await busy('Adding a note…', () => call('annotOp', st.sess.id, { type: 'note', page: i, x: x - 3, y: y - 3, text: '', color: st.style.note, author: author() }));
    if (!r) return;
    st.sess = r;
    record(`Added a note on page ${i + 1}`);
    await refresh([i]);
    side.edit(`${i}:${r.num}`);
    tip('Type the note in the Comments panel. Drag the note to move it.');
  }
  async function deleteAnnot(id) {
    const a = st.marks.annots.find((x) => x.id === id);
    if (!a) return;
    st.annSel = null;
    const r = await busy('Deleting…', () => call('annotOp', st.sess.id, { type: 'delete', page: a.page, num: a.num }));
    if (r) { st.sess = r; record('Deleted a comment'); refresh([a.page]); }
  }
  async function linkOp(op) {
    const r = await busy('Saving the link…', () => call('linkOp', st.sess.id, op));
    if (!r) return false;
    st.sess = r;
    record({ add: 'Added a link', edit: 'Changed a link', delete: 'Deleted a link' }[op.type]);
    st.linkDraft = null;
    st.linkSel = op.type === 'delete' ? null : { page: op.page, index: r.index };
    await refresh([op.page]);
    return true;
  }
  function fieldBox(f, style) {
    const el = h(`<div class="pmark pfield edit${st.fieldSel === f.name ? ' sel' : ''}" style="${style(f.rect)}" title="${esc(f.name)}"><span class="fname">${esc(f.name)}</span><span class="handle" aria-hidden="true"></span></div>`);
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation(); e.preventDefault();
      select(null);
      st.fieldSel = f.name;
      $$('.pfield.edit', pagesEl).forEach((x) => x.classList.toggle('sel', x === el));
      renderProps();
      side.draw();
      const resize = e.target.classList.contains('handle'), x0 = e.clientX, y0 = e.clientY, r0 = [...f.rect];
      let moved = false, r = r0;
      const move = (ev) => {
        const dx = (ev.clientX - x0) / k(), dy = (ev.clientY - y0) / k();
        if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
        r = resize ? [r0[0], r0[1], Math.max(r0[0] + 6, r0[2] + dx), Math.max(r0[1] + 6, r0[3] + dy)] : [r0[0] + dx, r0[1] + dy, r0[2] + dx, r0[3] + dy];
        el.setAttribute('style', style(r));
      };
      const up = async () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (moved) fieldOp({ type: 'set', field: f.name, props: { rect: r.map((v) => Math.round(v * 10) / 10) } }, 'Moving the field…');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    return el;
  }
  const dateFmt = (fmt, iso) => { const [y, m, d] = iso.split('-').map(Number); if (!y) return ''; const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return fmt.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/g, (t) => ({ yyyy: y, yy: String(y).slice(2), mmmm: new Date(y, m - 1, 1).toLocaleString('en', { month: 'long' }), mmm: MON[m - 1], mm: String(m).padStart(2, '0'), m, dd: String(d).padStart(2, '0'), d }[t])); };
  const isoOf = (fmt, v) => {
    const parts = String(v || '').match(/\d+|[A-Za-z]+/g), toks = fmt.match(/yyyy|yy|mmmm|mmm|mm|m|dd|d/g);
    if (!parts || !toks || parts.length < 3) return '';
    const o = {};
    toks.forEach((t, i) => { const p = parts[i]; if (!p) return; if (t[0] === 'y') o.y = Number(p.length === 2 ? `20${p}` : p); else if (t[0] === 'd') o.d = Number(p); else o.m = /\d/.test(p) ? Number(p) : new Date(`${p} 1, 2000`).getMonth() + 1; });
    return o.y && o.m && o.d ? `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}` : '';
  };
  function fieldInput(f, style) {
    const v = f.name in st.fieldVals ? st.fieldVals[f.name] : f.value;
    const hh = f.rect[3] - f.rect[1], fs = Math.max(6, Math.min(12, hh * 0.62)) * k(), ro = f.readOnly ? ' disabled' : '';
    const el = h(`<div class="pmark pfield fill ${f.type}" style="${style(f.rect)};font-size:${fs}px" title="${esc(f.name)}${f.required ? ' (required)' : ''}"></div>`);
    el.dataset.name = f.name;
    let inp;
    const set = (val) => { st.fieldVals[f.name] = val; updateChrome(); side.draw(); };
    if (f.type === 'text' && f.date) {
      inp = h(`<input type="date"${ro} value="${esc(isoOf(f.date, v))}" aria-label="${esc(f.name)}">`);
      inp.addEventListener('change', () => set(inp.value ? dateFmt(f.date, inp.value) : ''));
    } else if (f.type === 'text') {
      inp = f.multiline ? h(`<textarea${ro} aria-label="${esc(f.name)}">${esc(v === 'Off' ? '' : v)}</textarea>`) : h(`<input type="text"${ro} value="${esc(v)}"${f.maxLen ? ` maxlength="${f.maxLen}"` : ''} aria-label="${esc(f.name)}">`);
      inp.addEventListener('input', () => set(inp.value));
    } else if (f.type === 'checkbox') {
      inp = h(`<input type="checkbox"${ro}${v && v !== 'Off' && v !== false ? ' checked' : ''} aria-label="${esc(f.name)}">`);
      inp.addEventListener('change', () => set(inp.checked));
    } else if (f.type === 'radio') {
      inp = h(`<input type="radio" name="r-${esc(f.name)}"${ro}${v && v === f.on ? ' checked' : ''} aria-label="${esc(`${f.name}: ${f.on}`)}">`);
      inp.addEventListener('change', () => { if (inp.checked) set(f.on); });
    } else if (f.type === 'combo' || f.type === 'list') {
      inp = h(`<select${ro}${f.type === 'list' ? ' size="3"' : ''} aria-label="${esc(f.name)}"><option value=""></option>${f.options.map((x) => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`);
      inp.addEventListener('change', () => set(inp.value));
    } else if (f.type === 'signature') {
      inp = h(`<button type="button" class="sigfield">${icon('signature', 'sm')}<span>Sign here</span></button>`);
      inp.addEventListener('click', () => signDialog(f));
    }
    if (!inp) return el;
    inp.addEventListener('pointerdown', (e) => e.stopPropagation());
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    el.append(inp);
    return el;
  }
  async function fieldOp(op, label = 'Saving the field…') {
    const r = await busy(label, () => call('fieldOp', st.sess.id, op));
    if (!r) return null;
    st.sess = r;
    const kind = (FIELD_KINDS.find(([id]) => id === op.kind)?.[2] || 'form').toLowerCase();
    const what = { add: `Added a ${kind} field`, set: `Changed the field ${op.field}`, delete: `Deleted the field ${op.field}`, flatten: op.fields === false ? 'Flattened the comments' : 'Flattened the form', reset: 'Cleared the form', detect: r.added ? `Found ${r.added} field${r.added === 1 ? '' : 's'}` : '' }[op.type];
    if (what) record(what);
    if (r.field) st.fieldSel = r.field;
    await refresh();
    return r;
  }
  function addField(i, rect) {
    const kind = st.fieldKind, r = [rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]].map((v) => Math.round(v * 10) / 10);
    const op = { type: 'add', page: i, kind, rect: r };
    if (kind === 'radio') { const n = st.marks.fields.filter((f) => f.type === 'radio' && f.name === st.radioGroup).length; if (st.radioGroup && n) { op.group = st.radioGroup; op.export = `Choice${n + 1}`; } else op.export = 'Choice1'; }
    if (kind === 'combo' || kind === 'list') op.options = ['Option 1', 'Option 2', 'Option 3'];
    fieldOp(op, 'Adding the field…').then((res) => { if (res && kind === 'radio') st.radioGroup = res.field; });
  }
  function focusField(f) {
    if (st.tool === 'field') { st.fieldSel = f.name; marksChanged(); renderProps(); side.draw(); goTo(f.page, f.rect); return; }
    if (!FILLS.has(st.tool)) selectTool('select');
    goTo(f.page, f.rect);
    setTimeout(() => $$('.pfield.fill', pagesEl).find((x) => x.dataset.name === f.name)?.querySelector('input, select, textarea, button')?.focus({ preventScroll: true }), 450);
  }
  async function flattenForm() {
    if (!st.marks.fields.length) { toast('This PDF has no form fields to flatten.'); return; }
    const r = await busy('Flattening the form…', async () => { await flush(); return call('fieldOp', st.sess.id, { type: 'flatten', fields: true, comments: false }); });
    if (r) { st.sess = r; st.fieldSel = null; record('Flattened the form'); refresh(); toast('The form is now part of the pages.', { type: 'success' }); }
  }
  async function docChange(op, msg) {
    const r = await busy('Updating pages…', async () => { await flush(); return call('docOp', st.sess.id, op); });
    if (!r) return;
    st.sess = r;
    record(msg.replace(/\.$/, ''));
    layout(true);
    toast(`${msg} Save to keep it.`, { type: 'success' });
  }

  function selectTool(t) {
    commitEditing();
    if (st.draft) finishDraft();
    st.tool = t;
    if (mode === 'edit') mem.set({ tool: t });
    if (SHAPES.includes(t)) { st.shape = t; $('[data-shapes]', root).dataset.tool = t; }
    if (st.sel) select(null);
    st.linkDraft = null; st.linkSel = null; st.crop = null;
    if (t !== 'select' && t !== 'note') st.annSel = null;
    if (t !== 'field') st.fieldSel = null;
    $$('[data-tool]', root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === t));
    pagesEl.className = `pages tool-${t}`;
    if (t === 'edittext') st.pages.forEach((p, i) => p.visible && showLines(i)); else hideLines();
    if (t === 'select') st.pages.forEach((p, i) => p.visible && showObjects(i)); else hideObjects();
    marksChanged();
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
  const paintRange = (r) => r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`);
  props.addEventListener('input', (e) => { if (e.target.type === 'range') paintRange(e.target); });
  props.addEventListener('keydown', (e) => { if (e.target.matches('input, textarea, select')) e.stopPropagation(); });
  function renderProps() { drawProps(); props.querySelectorAll('input[type=range]').forEach(paintRange); }
  function drawProps() {
    const o = st.sel;
    const s = st.style;
    const t = o ? o.type : st.tool;
    props.innerHTML = '';
    const head = (txt) => props.append(h(`<h3>${esc(txt)}</h3>`));
    const swatch = (list, val, fn) => { const el = h(`<div class="swatches">${list.map((c) => `<button style="background:${c}" data-c="${c}" aria-label="${c}" aria-pressed="${c.toLowerCase() === String(val).toLowerCase()}"></button>`).join('')}<label class="custom" title="Custom colour"><input type="color" value="${/^#[0-9a-f]{6}$/i.test(val) ? val : '#000000'}" aria-label="Custom colour"></label></div>`); el.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { fn(b.dataset.c); renderProps(); } }); $('input', el).addEventListener('change', (e) => { fn(e.target.value); renderProps(); }); return el; };
    const apply = (patch) => { if (o) { Object.assign(o, patch); if (o.type === 'replace') o.styled = true; positionObj(o); } else Object.assign(s, patch); };
    const button = (html, fn, cls = 'btn') => { const b = h(`<button class="${cls}">${html}</button>`); b.addEventListener('click', fn); return b; };
    const kinds = (list, val, fn) => { const el = h(`<div class="seg full">${list.map(([id, ic, label]) => `<button class="tb" data-k="${id}" aria-pressed="${val === id}" title="${label}">${icon(ic)}<span class="lbl">${label}</span></button>`).join('')}</div>`); el.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { fn(b.dataset.k); renderProps(); } }); return el; };
    if (!o && st.pick) {
      const it = st.pick.obj, n = pickedObjs().length;
      head(n > 1 ? `${n} objects` : KIND[it.kind]);
      if (it.text) props.append(h(`<p class="tip">“${esc(it.text)}${it.text.length >= 80 ? '…' : ''}”</p>`));
      props.append(h(`<p class="tip">Delete takes it out of the file when you save: ${it.kind === 'table' ? 'its lines, shading and text' : it.kind === 'image' ? 'the picture' : it.kind === 'drawing' ? 'the lines and shapes' : 'the text'}, leaving what is around it as it is.</p>`));
      const row = h(`<div class="cmrow"></div>`);
      if (it.kind === 'image') row.append(button(`${icon('replace', 'sm')}Replace…`, replacePicture));
      row.append(button(`${icon('delete', 'sm')}Remove from page`, erasePicked, 'btn danger'));
      props.append(row);
      return;
    }
    if (!o && st.annSel) {
      const a = st.marks.annots.find((x) => x.id === st.annSel);
      if (a) {
        head(kindOf(a));
        props.append(h(`<p class="tip">${a.author ? `By ${esc(a.author)}. ` : ''}${a.contents ? `“${esc(a.contents.slice(0, 160))}”` : 'No words yet.'}</p>`), h(`<p class="tip">Its words, colour and replies are in the Comments panel on the left.${a.type === 'Text' ? ' Drag the note to move it.' : ''}</p>`));
        props.append(button(`${icon('delete', 'sm')}Delete`, () => deleteAnnot(a.id), 'btn danger'));
        return;
      }
    }
    if (o?.type === 'erase') {
      head(`Removed ${(KIND[o.kind] || 'area').toLowerCase()}`);
      props.append(h(`<p class="tip">It is taken out of the file when you save.</p>`));
      const back = h(`<button class="btn" style="justify-self:start">${icon('undo', 'sm')}Put it back</button>`);
      back.addEventListener('click', () => removeObj(o));
      props.append(back);
      return;
    }
    const numSlider = (key, label, min, max, def, scale = 1, set = null) => {
      const shown = Math.round(((o || s)[key] ?? def) * scale);
      const f = h(`<div class="field"><label class="label">${label}</label><div class="range"><input type="range" min="${min}" max="${max}" step="1" value="${shown}"><input class="input num" type="number" min="${min}" max="${max}" step="1" value="${shown}" aria-label="${label}"></div></div>`);
      const [r, n] = $$('input', f);
      const put = (x) => { const y = Math.min(max, Math.max(min, Math.round(Number(x)))); if (Number.isNaN(y)) return; if (set) set(y / scale); else apply({ [key]: y / scale }); r.value = y; n.value = y; paintRange(r); };
      r.addEventListener('input', () => put(r.value));
      n.addEventListener('change', () => put(n.value));
      return f;
    };
    if (o?.type === 'text' && o.border && o.border !== 'none') {
      head('Stamp');
      const words = h(`<div class="field"><label class="label">Words</label><input class="input" type="text" maxlength="80" value="${esc(o.text)}"></div>`);
      $('input', words).addEventListener('input', (e) => { o.text = e.target.value; setText(o); updateChrome(); });
      props.append(words, h(`<div class="label">Colour</div>`), swatch(COLORS.slice(0, 8), o.color, (c) => apply({ color: c, border: c })),
        numSlider('size', 'Size (pt)', 6, 120, 16), numSlider('rotate', 'Rotation (°)', -180, 180, 0), numSlider('opacity', 'Opacity (%)', 10, 100, 1, 100),
        h(`<div class="label">Background</div>`), swatch(TEXT_BG, o.bg || 'none', (c) => apply({ bg: c })));
      props.append(h(`<p class="tip">Drag the stamp to move it, the dot to resize it and the knob above it to turn it (Shift for 15° steps). Double-click to type on it.</p>`));
    } else if (t === 'text' || t === 'replace' || t === 'addtext' || t === 'edittext') {
      const v = o || s;
      head(o?.type === 'replace' ? (o.wrap ? 'Edited paragraph' : 'Edited text') : t === 'edittext' ? 'Edit text' : 'Text');
      if (t === 'edittext' && !o) {
        props.append(h(`<div class="label">Click to edit</div>`), kinds([['line', 'text', 'Lines'], ['paragraph', 'alignLeft', 'Paragraphs']], st.editBy, (m) => { st.editBy = m; api.invoke('settings:set', { editBy: m }); st.pages.forEach((p, i) => p.visible && showLines(i)); }));
        props.append(h(`<p class="tip">${st.editBy === 'paragraph' ? 'Click a paragraph to change it as a whole: the words rewrap to its width, here and in the saved file.' : 'Click a line on the page to edit it.'} The original text is removed from the file when you save, not just covered.</p><p class="tip">Rotated or vertical text can’t be edited directly; erase it and add new text instead.</p>`));
        return;
      }
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
      const lines = String(o?.text || '').split('\n'), listed = (re) => !!o && lines.every((l) => re.test(l));
      const style = h(`<div class="tstyle"><div class="seg">${btn('bold', 'bold', 'Bold (Ctrl B)')}${btn('italic', 'italic', 'Italic (Ctrl I)')}${btn('underline', 'underline', 'Underline (Ctrl U)')}${btn('strike', 'strike', 'Strikethrough')}</div><div class="seg">${alignBtn('left', 'alignLeft', 'Align left')}${alignBtn('center', 'alignCenter', 'Centre')}${alignBtn('right', 'alignRight', 'Align right')}</div></div>`);
      const lists = h(`<div class="tstyle"><div class="seg"><button class="tb" data-list="bullet" aria-pressed="${listed(/^• /)}" title="Bulleted list"${o ? '' : ' disabled'}>${icon('list')}</button><button class="tb" data-list="number" aria-pressed="${listed(/^\d+\. /)}" title="Numbered list"${o ? '' : ' disabled'}>${icon('listNum')}</button></div><span class="tip">${o ? 'Enter continues the list.' : 'Lists: select a text box.'}</span></div>`);
      lists.addEventListener('click', (e) => { const b = e.target.closest('[data-list]'); if (b && o) { setList(o, b.dataset.list); renderProps(); } });
      style.addEventListener('click', (e) => {
        const b = e.target.closest('[data-s]'), al = e.target.closest('[data-al]');
        if (b) apply({ [b.dataset.s]: !(o || s)[b.dataset.s] });
        if (al) apply({ align: al.dataset.al });
        if (b || al) renderProps();
      });
      props.append(style, lists, h(`<div class="label">Colour</div>`), swatch(COLORS, v.color, (c) => apply({ color: c })), h(`<div class="label">Background</div>`), swatch(TEXT_BG, v.bg || 'none', (c) => apply({ bg: c })),
        h(`<div class="label">Border</div>`), swatch(['none', ...COLORS.slice(0, 8)], v.border || 'none', (c) => apply({ border: c })));
      const slider = (key, label, min, max, step, fmt) => {
        const f = h(`<div class="field"><label class="label">${label}</label><div class="range"><input type="range" min="${min}" max="${max}" step="${step}" value="${v[key] ?? (key === 'lineHeight' ? 1.2 : key === 'opacity' ? 1 : 0)}"><output>${fmt(v[key] ?? (key === 'lineHeight' ? 1.2 : key === 'opacity' ? 1 : 0))}</output></div></div>`);
        $('input', f).addEventListener('input', (e) => { const n = Number(e.target.value); $('output', f).textContent = fmt(n); apply({ [key]: n }); });
        return f;
      };
      const more = h(`<details class="more"><summary>Spacing and opacity</summary></details>`);
      more.append(slider('lineHeight', 'Line spacing', 0.8, 3, 0.05, (n) => `${Number(n).toFixed(2)}×`), slider('spacing', 'Letter spacing', -2, 10, 0.1, (n) => `${Number(n).toFixed(1)} pt`), slider('opacity', 'Opacity', 0.1, 1, 0.05, (n) => `${Math.round(n * 100)}%`));
      if (o?.type === 'text') more.append(slider('rotate', 'Rotation', -180, 180, 1, (n) => `${Math.round(n)}°`));
      props.append(more);
      if (o) props.append(h(`<p class="tip">${o.type === 'replace' ? (o.wrap ? 'The words rewrap to the paragraph’s width. Changes replace the original paragraph when you save.' : 'Changes replace the original line when you save.') : 'Double-click to edit. Drag to move. Drag the dot to resize.'}</p>`));
    } else if (t === 'whiteout') {
      head('Erase');
      props.append(h(`<p class="tip">Covers the area and permanently removes any text underneath.</p>`), swatch(['#ffffff', '#000000', '#f3f3f3'], (o || s).fill || s.erase, (c) => (o ? apply({ fill: c }) : (s.erase = c))));
    } else if (t === 'note') {
      head('Note');
      props.append(h(`<p class="tip">Click the page where the note goes, then type it in the Comments panel on the left. Replies, colours and deleting are there too.</p>`), h(`<div class="label">Colour</div>`), swatch(NOTE, s.note, (c) => { s.note = c; }),
        button(`${icon('comment', 'sm')}Show comments`, () => side.show('comments')));
    } else if (t === 'highlight') {
      const v = o || s, kind = v.markup || 'highlight', line = kind !== 'highlight';
      head(o ? { highlight: 'Highlight', underline: 'Underline', strike: 'Strike-out' }[kind] : 'Mark up');
      const kindsEl = h(`<div class="seg full">${[['highlight', 'highlight', 'Highlight'], ['underline', 'underline', 'Underline'], ['strike', 'strike', 'Strike out']].map(([id, ic, label]) => `<button class="tb" data-m="${id}" aria-pressed="${kind === id}" title="${label}">${icon(ic)}<span class="lbl">${label}</span></button>`).join('')}</div>`);
      kindsEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        const m = b.dataset.m;
        if (o) apply({ markup: m, color: m === 'highlight' ? (HL.includes(o.color) ? o.color : s.hl) : (HL.includes(o.color) ? s.ul : o.color) }); else s.markup = m;
        renderProps();
      });
      props.append(kindsEl, h(`<div class="label">Colour</div>`), swatch(line ? COLORS : HL, line ? (o ? o.color : s.ul) : (o ? o.color : s.hl), (c) => (o ? apply({ color: c }) : line ? (s.ul = c) : (s.hl = c))));
      props.append(h(`<p class="tip">Saved as comments, so they can be changed or replied to later, here or in any PDF reader.</p>`));
    } else if (t === 'stamp') {
      head('Stamp');
      const pressed = (v) => `aria-pressed="${s.stamp === v}"`;
      const grid = h(`<div class="stamps">${STAMPS.map(([n, c]) => `<button class="stampbtn" data-st="${esc(n)}" ${pressed(n)} style="color:${c}">${esc(n)}</button>`).join('')}</div>`);
      const marks = h(`<div class="seg full">${MARKS.map(([id, label]) => `<button class="tb" data-st="mark:${id}" ${pressed(`mark:${id}`)} title="${label}"><svg viewBox="0 0 20 20" width="18" height="18">${markSvg(id, 20, 20, s.mark, 2.2)}</svg><span class="lbl">${label}</span></button>`).join('')}<button class="tb" data-st="date" ${pressed('date')} title="Today’s date: ${esc(today())}">${icon('clock')}<span class="lbl">Date</span></button></div>`);
      for (const el of [grid, marks]) el.addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (b) { s.stamp = b.dataset.st; renderProps(); } });
      const own = h(`<div class="field"><label class="label">Your own words</label><input class="input" type="text" maxlength="60" placeholder="e.g. RECEIVED 21 OCT" value="${esc(s.stampText)}"></div>`);
      $('input', own).addEventListener('input', (e) => { s.stampText = e.target.value; const was = s.stamp; s.stamp = s.stampText.trim() ? 'custom' : (s.stamp === 'custom' ? 'APPROVED' : s.stamp); if (was !== s.stamp) { grid.querySelectorAll('[data-st]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.st === s.stamp)); ownColour.hidden = s.stamp !== 'custom'; } });
      const ownColour = swatch(COLORS, s.stampColor, (c) => { s.stampColor = c; s.stamp = 'custom'; });
      ownColour.hidden = s.stamp !== 'custom';
      props.append(h(`<div class="label">Stamps</div>`), grid, own, ownColour, h(`<div class="label">Marks and date</div>`), marks);
      if (s.stamp.startsWith('mark:')) props.append(h(`<div class="label">Mark colour</div>`), swatch(COLORS, s.mark, (c) => { s.mark = c; }));
      props.append(h(`<p class="tip">Click the page to place it. Stamps are text, so double-click one to change its words; the date can be edited the same way.</p>`));
    } else if (t === 'mark') {
      head({ check: 'Tick', cross: 'Cross', dot: 'Dot' }[o.kind] || 'Mark');
      const kindsEl = h(`<div class="seg full">${MARKS.map(([id, label]) => `<button class="tb" data-k="${id}" aria-pressed="${o.kind === id}" title="${label}"><svg viewBox="0 0 20 20" width="18" height="18">${markSvg(id, 20, 20, o.stroke, 2.2)}</svg><span class="lbl">${label}</span></button>`).join('')}</div>`);
      kindsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { apply({ kind: b.dataset.k }); renderProps(); } });
      props.append(kindsEl, h(`<div class="label">Colour</div>`), swatch(COLORS, o.stroke, (c) => apply({ stroke: c })));
      const size = numSlider('size', 'Size (pt)', 6, 120, o.rect[2], 1, (z) => { const [rx, ry, rw, rh] = o.rect; apply({ rect: [rx + rw / 2 - z / 2, ry + rh / 2 - z / 2, z, z] }); });
      props.append(size, numSlider('rotate', 'Rotation (°)', -180, 180, 0), numSlider('opacity', 'Opacity (%)', 10, 100, 1, 100));
      if (o.kind !== 'dot') {
        const w = h(`<div class="field"><label class="label">Thickness</label><div class="range"><input type="range" min="0.5" max="6" step="0.5" value="${o.width || 2}"><output>${o.width || 2} pt</output></div></div>`);
        $('input', w).addEventListener('input', (e) => { $('output', w).textContent = `${e.target.value} pt`; apply({ width: Number(e.target.value) }); });
        props.append(w);
      }
      props.append(h(`<p class="tip">Drag to move. Drag the dot to resize.</p>`));
    } else if (['rect', 'ellipse', 'line', 'arrow', 'draw', 'ink'].includes(t)) {
      head({ rect: 'Box', ellipse: 'Oval', line: 'Line', arrow: 'Arrow', draw: 'Pen', ink: 'Drawing' }[t]);
      if (!o && SHAPES.includes(t)) props.append(kinds([['rect', 'square', 'Box'], ['ellipse', 'circle', 'Oval'], ['arrow', 'arrow', 'Arrow'], ['line', 'line', 'Line']], t, (id) => selectTool(id)));
      props.append(h(`<div class="label">Colour</div>`), swatch(COLORS, (o || s).stroke, (c) => apply({ stroke: c })));
      const w = h(`<div class="field"><label class="label">Thickness</label><div class="range"><input type="range" min="0.5" max="12" step="0.5" value="${(o || s).width}"><output>${(o || s).width} pt</output></div></div>`);
      $('input', w).addEventListener('input', (e) => { $('output', w).textContent = `${e.target.value} pt`; apply({ width: Number(e.target.value) }); });
      props.append(w);
      if (t === 'rect' || t === 'ellipse') props.append(h(`<div class="label">Fill</div>`), swatch(['none', ...COLORS.slice(0, 8), '#dff6dd', '#fff4ce'], (o || s).fill || 'none', (c) => apply({ fill: c })));
      props.append(h(`<p class="tip">Hold Shift for squares, circles and straight angles. Shapes and drawings are saved as comments.</p>`));
    } else if (t === 'image' || t === 'signature') {
      head(t === 'signature' ? 'Signature' : 'Image');
      props.append(numSlider('opacity', 'Opacity (%)', 10, 100, 1, 100));
      if (t === 'image') {
        const ops = h(`<div class="seg full"><button class="tb" data-x="rot" title="Turn 90° right">${icon('rotate')}<span class="lbl">Turn</span></button><button class="tb" data-x="h" title="Flip left to right">${icon('flipH')}<span class="lbl">Flip</span></button><button class="tb" data-x="v" title="Flip upside down">${icon('flipV')}<span class="lbl">Flip down</span></button></div>`);
        ops.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (b) transformImage(o, b.dataset.x); });
        const crop = h(`<details class="more"${o.crop?.some(Boolean) ? ' open' : ''}><summary>Crop</summary></details>`);
        [['Left', 0], ['Top', 1], ['Right', 2], ['Bottom', 3]].forEach(([label, i]) => crop.append(numSlider(`crop${i}`, `${label} (%)`, 0, 45, 0, 1, (v) => cropImage(o, i, v))));
        for (const [i, el] of $$('.field', crop).entries()) $$('input', el).forEach((x) => { x.value = o.crop?.[i] || 0; });
        props.append(ops, crop);
      }
      const alt = h(`<div class="field"><label class="label">Alternative text</label><textarea class="input" rows="2" placeholder="What the picture shows, for people who can’t see it">${esc(o.alt || '')}</textarea></div>`);
      $('textarea', alt).addEventListener('input', (e) => { o.alt = e.target.value; updateChrome(); });
      props.append(alt, h(`<p class="tip">${st.sess.tagged ? 'Saved as a tagged figure, read out by screen readers.' : 'Saved as a tagged figure. This PDF isn’t tagged yet, so screen readers may not read it until the rest is tagged too.'}</p>`));
      props.append(h(`<p class="tip">Drag to move. Drag the dot to resize.</p>`));
    } else if (t === 'redact') {
      redactProps(o, head, button);
    } else if (t === 'measure') {
      measureProps(o, head, swatch, kinds);
    } else if (t === 'link') {
      linkProps(head, button);
    } else if (t === 'field') {
      fieldProps(head, button);
    } else if (t === 'crop') {
      cropProps(head, button);
    } else {
      head(`${st.sess?.pages.length || 0} pages`);
      props.append(h(`<p class="tip">Pick a tool above. Everything you add stays editable until you save.</p><p class="tip">Use the side panel for pages, bookmarks, comments and form fields.</p>`));
    }
    if (o) {
      const del = h(`<button class="btn danger" style="justify-self:start">${icon('delete', 'sm')}Delete</button>`);
      del.addEventListener('click', () => removeObj(o));
      props.append(del);
    }
  }
  function redactProps(o, head, button) {
    head(o ? 'Marked for redaction' : 'Redact');
    const marks = st.pending.filter((x) => x.type === 'redact');
    props.append(h(`<p class="tip">Drag over anything that must go: words, pictures, signatures. When you apply (or save), what is under each mark is removed from the file for good${st.redact.boxes ? ' and a black box takes its place' : ''}.</p>`));
    const find = h(`<div class="field"><label class="label">Find words to redact</label><div class="cmrow"><input class="input" placeholder="Name, number…" aria-label="Words to redact"><button class="btn">Mark</button></div></div>`);
    const mark = async (q) => {
      const hits = await call('findRedact', st.sess.id, q).catch(() => []);
      let n = 0;
      for (const hit of hits) {
        const [x0, y0, x1, y1] = hit.rect;
        if (st.pending.some((x) => x.type === 'redact' && x.page === hit.page && Math.abs(x.rect[0] - x0 + 1) < 0.5 && Math.abs(x.rect[1] - y0 + 1) < 0.5)) continue;
        addObj({ type: 'redact', page: hit.page, rect: [x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2] });
        n++;
      }
      toast(n ? `Marked ${n} match${n === 1 ? '' : 'es'}. Apply to remove them.` : 'Nothing new to mark.');
      renderProps();
    };
    const go_ = () => { const v = $('input', find).value.trim(); if (v) mark({ terms: [v] }); };
    $('button', find).addEventListener('click', go_);
    $('input', find).addEventListener('keydown', (e) => { if (e.key === 'Enter') go_(); });
    const pats = h(`<div class="field"><label class="label">Or every</label><div class="chips">${[['email', 'E-mail address'], ['phone', 'Phone number'], ['card', 'Card number'], ['iban', 'IBAN'], ['date', 'Date']].map(([id, label]) => `<button class="chip" data-pat="${id}">${label}</button>`).join('')}</div></div>`);
    pats.addEventListener('click', (e) => { const b = e.target.closest('[data-pat]'); if (b) mark({ patterns: [b.dataset.pat] }); });
    const boxes = h(`<label class="row"><input type="checkbox"${st.redact.boxes ? ' checked' : ''}> Leave black boxes</label>`);
    $('input', boxes).addEventListener('change', (e) => { st.redact.boxes = e.target.checked; renderProps(); });
    props.append(find, pats, boxes, h(`<div class="label">${marks.length ? `${marks.length} area${marks.length === 1 ? '' : 's'} marked` : 'Nothing marked yet'}</div>`));
    if (marks.length) {
      const row = h(`<div class="cmrow"></div>`);
      row.append(button(`${icon('redact', 'sm')}Apply redactions`, applyRedactions, 'btn primary'), button('Clear marks', () => { marks.forEach(removeObj); }));
      props.append(row);
    }
  }
  async function applyRedactions() {
    const n = st.pending.filter((x) => x.type === 'redact').length;
    const ok = await busy('Redacting…', async () => { await flush(); layout(true); return true; });
    if (ok) toast(`Redacted ${n} area${n === 1 ? '' : 's'}. Save to keep it.`, { type: 'success' });
  }
  function measureProps(o, head, swatch, kinds) {
    const m = st.measure;
    head(o ? { distance: 'Distance', perimeter: 'Perimeter', area: 'Area' }[o.kind] : 'Measure');
    if (o) props.append(h(`<div class="readout">${esc(measureLabel(o))}</div>`), h(`<p class="tip">At 1 : ${o.ratio}. Saved as a measurement comment that other readers show too.</p>`), h(`<div class="label">Colour</div>`), swatch(COLORS.slice(0, 8), o.stroke, (c) => { o.stroke = c; positionObj(o); }));
    else {
      props.append(kinds([['distance', 'line', 'Distance'], ['perimeter', 'shapes', 'Perimeter'], ['area', 'square', 'Area']], m.kind, (v) => { if (st.draft) finishDraft(); m.kind = v; }));
      const scale = h(`<div class="row2"><label class="field"><span class="label">Scale</span><select class="input">${RATIOS.map((r) => `<option value="${r}"${r === m.ratio ? ' selected' : ''}>1 : ${r}</option>`).join('')}</select></label><label class="field"><span class="label">Units</span><select class="input">${Object.keys(UNITS).map((u) => `<option${u === m.unit ? ' selected' : ''}>${u}</option>`).join('')}</select></label></div>`);
      const [r, u] = $$('select', scale);
      r.addEventListener('change', () => { m.ratio = Number(r.value); });
      u.addEventListener('change', () => { m.unit = u.value; });
      props.append(scale, h(`<div class="label">Colour</div>`), swatch(COLORS.slice(0, 8), st.style.measure, (c) => { st.style.measure = c; }));
      props.append(h(`<p class="tip">${m.kind === 'distance' ? 'Drag from one point to the other.' : 'Click each corner; double-click the last one, or press Enter.'} Shift keeps lines straight. The scale is real size on the page times the ratio, as on a drawing.</p>`));
    }
  }
  function linkProps(head, button) {
    const l = st.linkSel ? st.marks.links.find((x) => x.page === st.linkSel.page && x.index === st.linkSel.index) : null, draft = st.linkDraft;
    head(draft ? 'New link' : l ? 'Link' : 'Links');
    if (!l && !draft) {
      const n = st.marks.links.length;
      props.append(h(`<p class="tip">Drag over the words or area to link. ${n ? `This PDF has ${n} link${n === 1 ? '' : 's'}, outlined on the pages: click one to change it.` : 'Links already in the file show outlined.'}</p>`));
      return;
    }
    const to = draft ? st.linkTo : l.url ? 'url' : 'page';
    const kind = h(`<div class="seg full"><button class="tb" data-to="url" aria-pressed="${to === 'url'}">${icon('link')}<span class="lbl">Web address</span></button><button class="tb" data-to="page" aria-pressed="${to === 'page'}">${icon('pdf')}<span class="lbl">Page</span></button></div>`);
    const url = h(`<div class="field"${to === 'url' ? '' : ' hidden'}><label class="label">Web address or e-mail</label><input class="input" data-l="url" placeholder="example.com" value="${esc(l?.url || '')}"></div>`);
    const page = h(`<div class="field"${to === 'page' ? '' : ' hidden'}><label class="label">Goes to page</label><input class="input" type="number" min="1" max="${st.sess.pages.length}" data-l="page" value="${l?.toPage != null ? l.toPage + 1 : 1}"></div>`);
    let mode_ = to;
    kind.addEventListener('click', (e) => { const b = e.target.closest('[data-to]'); if (!b) return; mode_ = st.linkTo = b.dataset.to; $$('[data-to]', kind).forEach((x) => x.setAttribute('aria-pressed', x === b)); url.hidden = mode_ !== 'url'; page.hidden = mode_ !== 'page'; });
    const dest = () => (mode_ === 'url' ? { url: $('input', url).value, toPage: null } : { toPage: Math.max(0, Number($('input', page).value) - 1) });
    props.append(kind, url, page);
    const row = h(`<div class="cmrow"></div>`);
    if (draft) {
      const r = draft.rect;
      row.append(button('Add link', () => linkOp({ type: 'add', page: draft.page, rect: [r[0], r[1], r[0] + r[2], r[1] + r[3]], ...dest() }), 'btn primary'), button('Cancel', () => { st.linkDraft = null; marksChanged(); renderProps(); }));
    } else {
      row.append(button('Save', () => linkOp({ type: 'edit', page: l.page, index: l.index, ...dest() }), 'btn primary'));
      row.append(button(l.url ? `${icon('open', 'sm')}Open` : 'Go there', () => (l.url ? api.invoke('shell:external', l.url) : goTo(l.toPage))));
      row.append(button(`${icon('delete', 'sm')}Delete`, () => linkOp({ type: 'delete', page: l.page, index: l.index }), 'btn danger'));
    }
    props.append(row);
    for (const inp of $$('input', props)) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.cmrow .btn.primary', props)?.click(); });
  }
  function fieldProps(head, button) {
    const f = st.fieldSel ? st.marks.fields.find((x) => x.name === st.fieldSel) : null;
    head('Add a field');
    const grid = h(`<div class="fkinds">${FIELD_KINDS.map(([id, ic, label]) => `<button class="tb" data-fk="${id}" aria-pressed="${st.fieldKind === id}">${icon(ic, 'sm')}<span class="lbl">${label}</span></button>`).join('')}</div>`);
    grid.addEventListener('click', (e) => { const b = e.target.closest('[data-fk]'); if (b) { st.fieldKind = b.dataset.fk; st.radioGroup = null; st.fieldSel = null; marksChanged(); renderProps(); } });
    props.append(grid);
    if (!f) {
      props.append(h(`<p class="tip">Drag on the page to place it${['checkbox', 'radio'].includes(st.fieldKind) ? ', or just click' : ''}. ${st.fieldKind === 'radio' ? 'Choices placed one after another form a group: only one can be picked.' : ''} Fields are named as Acrobat names them; click one to rename or change it.</p>`));
      props.append(button(`${icon('sparkle', 'sm')}Find the blanks for me`, async () => {
        const r = await fieldOp({ type: 'detect' }, 'Finding blanks…');
        if (r) toast(r.added ? `Added ${r.added} field${r.added === 1 ? '' : 's'}.` : 'No blanks, lines or boxes were found.', { type: r.added ? 'success' : undefined });
      }));
      return;
    }
    props.append(h(`<h3 class="sub">${esc(f.date ? 'Date' : FIELD_KINDS.find(([id]) => id === f.type)?.[2] || f.type)} field</h3>`));
    const name = h(`<div class="field"><label class="label">Name</label><input class="input" value="${esc(f.name)}"></div>`);
    $('input', name).addEventListener('change', (e) => { const v = e.target.value.trim(); if (v && v !== f.name) fieldOp({ type: 'set', field: f.name, props: { name: v } }, 'Renaming…'); });
    props.append(name);
    if (f.type === 'combo' || f.type === 'list') {
      const opts = h(`<div class="field"><label class="label">Choices, one per line</label><textarea class="input" rows="4">${esc(f.options.join('\n'))}</textarea></div>`);
      $('textarea', opts).addEventListener('change', (e) => { const list = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); if (list.length) fieldOp({ type: 'set', field: f.name, props: { options: list } }); });
      props.append(opts);
    }
    const flag = (key, label, on) => { const el = h(`<label class="row"><input type="checkbox"${on ? ' checked' : ''}> ${label}</label>`); $('input', el).addEventListener('change', (e) => fieldOp({ type: 'set', field: f.name, props: { [key]: e.target.checked } })); return el; };
    if (f.type === 'text' && !f.date) props.append(flag('multiline', 'Several lines', f.multiline));
    props.append(flag('required', 'Must be filled in', f.required), flag('read_only', 'Read only', f.readOnly));
    const tipEl = h(`<div class="field"><label class="label">Description (read out to screen-reader users)</label><input class="input" placeholder="e.g. Your full name"></div>`);
    $('input', tipEl).addEventListener('change', (e) => fieldOp({ type: 'set', field: f.name, props: { tooltip: e.target.value } }));
    props.append(tipEl);
    if (f.type === 'radio') props.append(h(`<p class="tip">Place more choices to add them to this group.</p>`));
    props.append(h(`<p class="tip">Drag the field to move it, the dot to resize it.</p>`));
    const row = h(`<div class="cmrow"></div>`);
    row.append(button(`${icon('delete', 'sm')}Delete field`, () => { const n = f.name; st.fieldSel = null; fieldOp({ type: 'delete', field: n }, 'Deleting the field…'); }, 'btn danger'));
    props.append(row);
    if (f.type === 'radio') st.radioGroup = f.name;
  }
  function cropProps(head, button) {
    head('Crop');
    const c = st.crop, mm = (v) => Math.round(v * 25.4 / 72);
    props.append(h(`<p class="tip">${c ? `Keeps ${mm(c.rect[2])} × ${mm(c.rect[3])} mm of page ${c.page + 1}.` : 'Drag over the part of the page to keep.'} Cropping hides the rest; nothing is deleted, so it can be undone.</p>`));
    const row = h(`<div class="cmrow"></div>`);
    const all = [...Array(st.sess.pages.length).keys()];
    const crop = (pages) => pageOp({ type: 'crop', pages, rect: c.rect }, true);
    const b1 = button('Crop this page', () => crop([c.page]), 'btn primary'), b2 = button('Crop all pages', () => crop(all));
    b1.disabled = b2.disabled = !c;
    row.append(b1, b2);
    const auto = h(`<div class="cmrow"></div>`), page = visiblePage();
    auto.append(button('This page', () => pageOp({ type: 'crop', pages: [page], auto: true }, true)), button('All pages', () => pageOp({ type: 'crop', pages: all, auto: true }, true)));
    props.append(row, h(`<div class="label">Remove white margins</div>`), auto, h(`<div class="label">Undo a crop</div>`), button('Show the whole page again', () => pageOp({ type: 'uncrop', pages: [c?.page ?? page] }, true)));
  }
  const loadImg = async (src) => { const img = new Image(); await new Promise((r) => { img.onload = r; img.src = src; }); return img; };
  async function cropImage(o, side, pct) {
    const was = (o.crop || [0, 0, 0, 0]).map((v) => v / 100);
    if (!o.orig) o.orig = o.data;
    const c = [...(o.crop || [0, 0, 0, 0])];
    c[side] = pct;
    const [l, t, r, b] = c.map((v) => v / 100);
    if (l + r > 0.9 || t + b > 0.9) return;
    const [x, y, w, hh] = o.rect, w0 = w / (1 - was[0] - was[2]), h0 = hh / (1 - was[1] - was[3]), x0 = x - was[0] * w0, y0 = y - was[1] * h0;
    o.crop = c;
    o.rect = [x0 + l * w0, y0 + t * h0, w0 * (1 - l - r), h0 * (1 - t - b)];
    const turn = (o.cropSeq = (o.cropSeq || 0) + 1);
    const img = await loadImg(o.orig), W = img.naturalWidth, H = img.naturalHeight, cv = document.createElement('canvas');
    if (turn !== o.cropSeq) return;
    cv.width = Math.max(1, Math.round(W * (1 - l - r))); cv.height = Math.max(1, Math.round(H * (1 - t - b)));
    cv.getContext('2d').drawImage(img, W * l, H * t, cv.width, cv.height, 0, 0, cv.width, cv.height);
    o.data = cv.toDataURL('image/png');
    $('img', o.el).src = o.data;
    positionObj(o);
    updateChrome();
  }
  async function transformImage(o, how) {
    o.orig = null; o.crop = null;
    const img = await loadImg(o.data);
    const turn = how === 'rot', c = document.createElement('canvas'), w = img.naturalWidth, hh = img.naturalHeight;
    c.width = turn ? hh : w; c.height = turn ? w : hh;
    const g = c.getContext('2d');
    if (turn) { g.translate(hh, 0); g.rotate(Math.PI / 2); } else if (how === 'h') { g.translate(w, 0); g.scale(-1, 1); } else { g.translate(0, hh); g.scale(1, -1); }
    g.drawImage(img, 0, 0);
    o.data = c.toDataURL('image/png');
    if (turn) { const [x, y, rw, rh] = o.rect; o.rect = [x + rw / 2 - rh / 2, y + rh / 2 - rw / 2, rh, rw]; }
    $('img', o.el).src = o.data;
    positionObj(o);
    updateChrome();
  }
  const isDirty = () => st.pending.some((o) => serialize(o)) || !!st.sess?.dirty || st.restored || Object.keys(st.fieldVals).length > 0 || st.saveOpts.protect !== undefined;
  function updateChrome() {
    $('.dirty', root).hidden = !isDirty();
    const u = $('[data-a=undo]', root), rd = $('[data-a=redo]', root), applied = !st.pending.length;
    u.disabled = !(st.pending.length || st.sess?.canUndo);
    rd.disabled = !(st.sess?.canRedo && applied);
    u.title = `Undo${applied && st.histAt > 0 ? `: ${st.history[st.histAt].label}` : ''} (Ctrl+Z)`;
    rd.title = `Redo${applied && st.history[st.histAt + 1] ? `: ${st.history[st.histAt + 1].label}` : ''} (Ctrl+Y)`;
    if (side?.tab === 'history') side.draw();
  }

  function visiblePage() {
    const top = pagesEl.getBoundingClientRect().top;
    let best = 0, bestD = Infinity;
    st.pages.forEach((p, i) => { const d = Math.abs(p.el.getBoundingClientRect().top - top); if (d < bestD) { bestD = d; best = i; } });
    return best;
  }
  async function placeImage(dataUrl, type, maxW, where) {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = dataUrl; });
    const i = where ? where.page : visiblePage();
    const p = st.pages[i];
    let rect;
    if (where) {
      const [x0, y0, x1, y1] = where.rect, bw = x1 - x0, bh = y1 - y0, s = Math.min(bw / img.naturalWidth, bh / img.naturalHeight), w = img.naturalWidth * s, hh = img.naturalHeight * s;
      rect = [x0 + (bw - w) / 2, y0 + (bh - hh) / 2, w, hh];
    } else {
      const w = Math.min(maxW, p.w * 0.6), hh = w * (img.naturalHeight / img.naturalWidth);
      rect = [(p.w - w) / 2, Math.max(20, p.h * 0.4 - hh / 2), w, hh];
    }
    selectTool('select');
    const o = addObj({ type, page: i, rect, data: dataUrl });
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
    const cx = c.getContext('2d');
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 <= x0) return null;
    const o = document.createElement('canvas');
    o.width = x1 - x0 + 8; o.height = y1 - y0 + 8;
    o.getContext('2d').drawImage(c, x0 - 4, y0 - 4, o.width, o.height, 0, 0, o.width, o.height);
    return o.toDataURL('image/png');
  }
  async function signDialog(field) {
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
    const place = (url) => placeImage(url, 'signature', 170, field?.rect ? field : null);
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
    nameIn.addEventListener('keydown', (e) => e.stopPropagation());
    const close = () => scrim.remove();
    scrim.addEventListener('click', async (e) => {
      const tb = e.target.closest('[data-t]');
      if (tb) { pane = tb.dataset.t; $$('[data-t]', scrim).forEach((b) => b.setAttribute('aria-pressed', b === tb)); $$('[data-pane]', scrim).forEach((p) => { p.hidden = p.dataset.pane !== pane; }); }
      const fb = e.target.closest('[data-f]');
      if (fb) { font = fb.dataset.f; $$('[data-f]', scrim).forEach((b) => b.setAttribute('aria-pressed', b === fb)); preview.style.fontFamily = `'${font}'`; }
      const sb = e.target.closest('[data-s]');
      if (sb) { close(); place(saved[Number(sb.dataset.s)]); return; }
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
        place(url);
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

  const saveOptions = () => ({ flattenComments: st.saveOpts.comments === 'flatten', flattenFields: !!st.saveOpts.flattenFields, ...(st.saveOpts.protect !== undefined ? { protect: st.saveOpts.protect } : {}) });
  async function save(as) {
    let target = st.savePath;
    if (as || !target) {
      const suggested = `${dirOf(file)}${sep}${nameOf(file).replace(/\.pdf$/i, '')} (edited).pdf`;
      if (as) { target = await api.invoke('dialog:save', { defaultPath: st.savePath || suggested, filters: [{ name: 'PDF', extensions: ['pdf'] }] }); if (!target) return false; }
      else target = suggested;
    }
    if (target === file) { toast('Choose another name: the original stays as it is.', { type: 'error' }); return false; }
    const redactions = st.pending.filter((x) => x.type === 'redact').length;
    const ok = await busy('Saving…', async () => {
      await flush();
      st.sess = await call('save', st.sess.id, target, saveOptions());
      st.savePath = target;
      st.restored = false;
      layout(false);
      return true;
    });
    if (ok) recover.drop();
    if (ok && as) setDocName(root, target);
    if (ok) toast(`Saved ${nameOf(target)}${redactions ? `, with ${redactions} redaction${redactions === 1 ? '' : 's'} applied` : ''}`, { type: 'success', actions: [{ label: 'Open', fn: () => api.invoke('shell:open', target) }, { label: 'Show in folder', fn: () => api.invoke('shell:show', target) }] });
    updateChrome();
    return !!ok;
  }
  async function undo() {
    if (editing) { commitEditing(); return; }
    if (st.draft) { removeObj(st.draft); return; }
    if (st.pending.length) { removeObj(st.pending[st.pending.length - 1]); return; }
    if (Object.keys(st.fieldVals).length) { st.fieldVals = {}; marksChanged(); side.draw(); updateChrome(); return; }
    if (st.sess.canUndo) await busy('Undoing…', async () => { st.sess = await call('undo', st.sess.id); st.histAt = Math.max(0, st.histAt - 1); layout(true); });
  }
  async function redo() { if (st.sess.canRedo) await busy('Redoing…', async () => { st.sess = await call('redo', st.sess.id); st.histAt = Math.min(st.history.length - 1, st.histAt + 1); layout(true); }); }
  async function close() {
    commitEditing();
    if (isDirty()) {
      const choice = await confirm3(`Save changes to ${nameOf(file)}?`, 'Your edits will be lost if you don’t save them.');
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await save(false))) return;
    }
    recover.drop();
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
  function replaceDialog() {
    const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>Find and replace</h2><input class="input" data-f="q" placeholder="Find" value="${esc(find.value)}"><input class="input" data-f="r" placeholder="Replace with" style="margin-top:8px"><label class="row" style="margin-top:8px;gap:6px;font-size:12px"><input type="checkbox" data-f="case">Match case</label></div><div class="foot"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">Replace all</button></div></div></div>`);
    document.body.append(s);
    const q = $('[data-f=q]', s), r = $('[data-f=r]', s);
    (q.value ? r : q).focus();
    const done = async (ok) => { const v = [q.value, r.value, $('[data-f=case]', s).checked]; s.remove(); if (ok && v[0]) await replaceAll(...v); };
    s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) done(a === 'ok'); });
  }
  async function replaceAll(q, r, matchCase) {
    commitEditing();
    const re = () => new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
    let n = 0;
    for (const o of st.pending) if ((o.type === 'replace' || o.type === 'text') && re().test(o.text)) { o.text = o.text.replace(re(), r); if (o.el) o.el.textContent = o.text; positionObj(o); n++; }
    for (let i = 0; i < st.pages.length; i++) {
      const taken = takenLines(i);
      for (const l of await linesOf(i)) {
        if (!l.editable || taken.has(l.id) || !re().test(l.text)) continue;
        addObj({ type: 'replace', page: i, lineId: l.id, bbox: l.bbox, x: l.origin[0], y: l.origin[1], text: l.text.replace(re(), r), original: l.text, size: l.size, font: matchFont(l), bold: l.bold, italic: l.italic, color: l.color });
        n++;
      }
    }
    if (st.tool === 'edittext') st.pages.forEach((p, i) => p.visible && showLines(i));
    updateChrome();
    toast(n ? `Replaced in ${n} line${n === 1 ? '' : 's'}. Save to keep it.` : `“${q}” wasn’t found.`, { type: n ? 'success' : undefined });
  }
  const ed = {
    st, root, icon, call, toast, api, mem, busy, flush, refresh, updateChrome, visiblePage, goTo, linesOf, marksChanged, focusField, flattenForm, docChange, record, goToStep,
    author, setAuthor: (v) => api.invoke('settings:set', { author: v }),
  };
  const side = sidePanels(ed);
  const doc = docTools(ed);

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
    if (a === 'replace') replaceDialog();
    if (a === 'save') save(false);
    if (a === 'saveas') save(true);
    if (a === 'saveopts') doc.saveMenu(e.target.closest('button'));
    if (a === 'docmenu') doc.menu(e.target.closest('button'));
    if (a === 'help') keys.help();
    if (a === 'thumbs') { const on = body.classList.toggle('no-thumbs'); e.target.closest('button').setAttribute('aria-pressed', !on); mem.set({ side: on ? 'off' : side.tab }); }
  });
  const keys = shortcuts([
    ['Document', [key('Mod+S', 'Save', () => save(false), { always: true }), key('Mod+Shift+S', 'Save as…', () => save(true), { always: true }), key('Mod+W', 'Close', close, { always: true }), key('Mod+F', 'Find', () => find.focus()), key('Mod+H', 'Find and replace', replaceDialog)]],
    ['Edit', [key('Mod+Z', 'Undo', undo), key(['Mod+Shift+Z', 'Mod+Y'], 'Redo', redo), key('Mod+D', 'Duplicate what is selected'), key(['Mod+C', 'Mod+V'], 'Copy and paste it'), key(['Delete', 'Backspace'], 'Delete it'), key(['ArrowLeft', 'ArrowRight'], 'Nudge it (Shift: 10 pt)')]],
    ['View', [key(['Mod+Plus', 'Plus'], 'Zoom in', () => setZoom(st.zoom * 1.2)), key(['Mod+Minus', 'Minus'], 'Zoom out', () => setZoom(st.zoom / 1.2)), key(['Mod+0', '0'], 'Fit width', fitWidth), key('Mod+9', 'Fit page', fitPage), key('Mod+1', 'Actual size', () => setZoom(1)), key('Space', 'Hold and drag to move around'), key('?', 'Keyboard shortcuts')]],
    ['Tools', [...toolKeys({ v: 'select', e: 'edittext', t: 'addtext', x: 'whiteout', n: 'note', h: 'highlight', p: 'draw', r: 'rect', o: 'ellipse', a: 'arrow', l: 'line', m: 'measure', c: 'crop' }, selectTool), key('Escape', 'Deselect, or back to Select'), key('Enter', 'Finish a measurement')]],
  ], { typing: () => !!editing });
  const onKey = (e) => {
    if (document.querySelector('.scrim, .popmenu')) return;
    if (editing) return;
    if (e.target.matches?.('input, textarea, select')) return;
    const c = e.ctrlKey || e.metaKey;
    if (c && e.key.toLowerCase() === 'd' && st.sel) { e.preventDefault(); duplicate(st.sel, 12); }
    else if (c && e.key.toLowerCase() === 'c' && st.sel) { e.preventDefault(); clip = JSON.parse(JSON.stringify(serializeObj(st.sel))); }
    else if (c && e.key.toLowerCase() === 'v' && clip) { e.preventDefault(); const page = [...st.selPages][0] ?? clip.page; const o = addObj({ ...JSON.parse(JSON.stringify(clip)), page }); shiftObj(o, 12, 12); select(o); }
    else if (e.key === 'Enter' && st.draft) { e.preventDefault(); finishDraft(); }
    else if (st.sel && e.key.startsWith('Arrow') && st.sel.type !== 'erase') {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      shiftObj(st.sel, dx, dy);
      if (st.sel.type === 'replace') st.sel.styled = true;
    }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel) { e.preventDefault(); removeObj(st.sel); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && st.pick) { e.preventDefault(); erasePicked(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && st.annSel) { e.preventDefault(); deleteAnnot(st.annSel); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && st.linkSel) { e.preventDefault(); linkOp({ type: 'delete', ...st.linkSel }); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && st.fieldSel && st.tool === 'field') { e.preventDefault(); const n = st.fieldSel; st.fieldSel = null; fieldOp({ type: 'delete', field: n }, 'Deleting the field…'); }
    else if (e.key === 'Escape') {
      if (st.draft) { removeObj(st.draft); tip(null); }
      else if (st.linkDraft || st.crop) { st.linkDraft = null; st.crop = null; marksChanged(); renderProps(); }
      else if (st.sel || st.pick || st.annSel || st.linkSel || st.fieldSel) { st.annSel = null; st.linkSel = null; st.fieldSel = null; select(null); marksChanged(); side.draw(); }
      else selectTool('select');
    }
  };
  document.addEventListener('keydown', onKey);
  pagesEl.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const d = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
    setZoom(st.zoom * Math.exp(-d * 0.0065), { x: e.clientX, y: e.clientY });
  }, { passive: false });
  $('.zoom', root).addEventListener('change', (e) => { const v = e.target.value; if (v === 'width') fitWidth(); else if (v === 'page') fitPage(); else setZoom(Number(v)); });
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
  let fitT = null;
  const ro = new ResizeObserver(() => { if (st.fit) { clearTimeout(fitT); fitT = setTimeout(() => (st.fit === 'page' ? fitPage() : fitWidth()), 80); } });
  ro.observe(pagesEl);

  start();

  const dispose = () => {
    disposed = true;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keydown', onSpace);
    document.removeEventListener('keyup', onSpace);
    keys.dispose();
    recover.dispose();
    io?.disconnect(); tio?.disconnect(); ro.disconnect();
    st.renders.forEach((r) => URL.revokeObjectURL(r.url));
    document.querySelector('.popmenu')?.remove();
    if (st.sess) call('close', st.sess.id).catch(() => {});
  };
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
