import { $, $$, esc, h } from './ui.js';

const COLORS = ['#000000', '#3b3b3b', '#6b6b6b', '#d13438', '#ca5010', '#107c10', '#0f6cbd', '#5c2e91'];
const BG = ['#fff4ce', '#dff6dd', '#cfe4fa', '#fde7e9', '#e8e0f5', '#f3f3f3', '#ffffff'];
const LANGS = [['', 'Not set'], ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['fr-FR', 'French'], ['de-DE', 'German'], ['es-ES', 'Spanish'], ['it-IT', 'Italian'], ['nl-NL', 'Dutch'], ['pt-PT', 'Portuguese'], ['pl-PL', 'Polish'], ['sv-SE', 'Swedish'], ['ar', 'Arabic'], ['hi-IN', 'Hindi'], ['zh-CN', 'Chinese'], ['ja-JP', 'Japanese']];
const OCR_LANGS = [['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['ita', 'Italian'], ['por', 'Portuguese'], ['nld', 'Dutch'], ['rus', 'Russian'], ['ara', 'Arabic'], ['hin', 'Hindi'], ['jpn', 'Japanese'], ['chi_sim', 'Chinese'], ['kor', 'Korean']];
const MARKS = { headerFooter: 'header_footer', pageNumbers: 'header_footer', bates: 'header_footer', watermark: 'watermark', background: 'background' };
const TITLES = { headerFooter: 'Header and footer', pageNumbers: 'Page numbers', bates: 'Bates numbering', watermark: 'Watermark', background: 'Background' };

export function docTools(ed) {
  const { st, icon, call, toast, api } = ed;
  const item = (a, ic, label) => `<button class="mi" data-d="${a}">${icon(ic, 'sm')}<span>${label}</span></button>`;

  function popover(anchor, html, onClick) {
    document.querySelector('.popmenu')?.remove();
    const m = h(`<div class="popmenu" role="menu">${html}</div>`);
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = `${r.bottom + 6}px`;
    m.style.left = `${Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth))}px`;
    const close = (e) => { if (e && m.contains(e.target)) return; m.remove(); document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', esc_, true); };
    const esc_ = (e) => { if (e.key === 'Escape') close(); };
    setTimeout(() => { document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', esc_, true); }, 0);
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) { close(); onClick(b.dataset.d); } });
    return m;
  }
  function menu(anchor) {
    popover(anchor, `<div class="mlabel">Pages</div>${item('headerFooter', 'text', 'Header and footer…')}${item('pageNumbers', 'listNum', 'Page numbers…')}${item('bates', 'stamp', 'Bates numbering…')}${item('watermark', 'layers', 'Watermark…')}${item('background', 'image', 'Background…')}
      <div class="mlabel">Document</div>${item('props', 'info', 'Properties…')}${item('security', 'lock', 'Password and permissions…')}${item('flatfields', 'field', 'Flatten form fields')}${item('flatcomments', 'comment', 'Flatten comments')}
      <div class="mlabel">Scans and checks</div>${item('ocr', 'search', 'Recognise text…')}${item('access', 'eye', 'Accessibility check')}${item('print', 'warning', 'Print check')}`, (d) => {
      if (TITLES[d]) marks(d);
      else if (d === 'props') properties();
      else if (d === 'security') security();
      else if (d === 'flatfields') ed.flattenForm();
      else if (d === 'flatcomments') flattenComments();
      else if (d === 'ocr') recognise();
      else check(d);
    });
  }

  function dialog(title, { wide = false, ok = 'Apply', extra = '' } = {}) {
    const s = h(`<div class="scrim"><div class="dialog${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="body"><h2>${esc(title)}</h2><div class="dlg"></div></div>
      <div class="foot">${extra}<span class="grow"></span><button class="btn" data-a="cancel">Cancel</button>${ok ? `<button class="btn primary" data-a="ok">${esc(ok)}</button>` : ''}</div></div></div>`);
    document.body.append(s);
    s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') s.remove(); });
    s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-a=cancel]')) s.remove(); });
    return { s, body: $('.dlg', s), close: () => s.remove(), ok: $('[data-a=ok]', s) };
  }
  const swatches = (list, val, name) => `<div class="swatches" data-sw="${name}">${list.map((c) => `<button type="button" style="background:${c}" data-c="${c}" aria-label="${c}" aria-pressed="${c === val}"></button>`).join('')}<label class="custom" title="Custom colour"><input type="color" value="${/^#[0-9a-f]{6}$/i.test(val) ? val : '#000000'}" aria-label="Custom colour"></label></div>`;
  function wireSwatches(root, vals, onChange) {
    for (const sw of $$('[data-sw]', root)) {
      const set = (c) => { vals[sw.dataset.sw] = c; $$('[data-c]', sw).forEach((b) => b.setAttribute('aria-pressed', b.dataset.c === c)); onChange(); };
      sw.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) set(b.dataset.c); });
      $('input', sw).addEventListener('input', (e) => set(e.target.value));
    }
  }

  function marks(kind) {
    const n = st.sess.pages.length;
    let page = Math.min(ed.visiblePage(), n - 1);
    const o = { size: 10, color: '#3b3b3b', margin: 12, pages: '', replace: true, opacity: kind === 'background' ? 100 : 30, rotation: 45, text: 'CONFIDENTIAL', wmColor: '#d13438', bgColor: '#fff4ce', file: '', scale: 50, behind: false, mode: 'text', prefix: 'ABC', start: 1, digits: 6 };
    const boxes = { header_left: '', header_center: '', header_right: '', footer_left: '', footer_center: '', footer_right: '' };
    if (kind === 'pageNumbers') boxes.footer_center = '<<Page 1 of n>>';
    const bates = () => `<<Bates Number#${Math.min(12, Math.max(1, Number(o.digits) || 6))}#${Math.max(1, Number(o.start) || 1)}#${String(o.prefix).replace(/#/g, '')}#>>`;
    if (kind === 'bates') boxes.footer_right = bates();
    const hf = MARKS[kind] === 'header_footer';
    const d = dialog(TITLES[kind], { wide: true, extra: `<button class="btn subtle" data-a="remove" title="Take off every ${hf ? 'header and footer' : kind} added before">Remove existing</button>` });
    const form = h(`<div class="dlgform"></div>`), pv = h(`<div class="dlgpreview"><div class="pvimg"><img alt="Preview"></div><div class="pvnav"><button class="tb icon" data-p="-1" title="Previous page">${icon('back', 'sm')}</button><span></span><button class="tb icon" data-p="1" title="Next page">${icon('chevron', 'sm')}</button></div></div>`);
    d.body.append(form, pv);
    if (hf) {
      form.append(h(`<div class="hfgrid">${['header_left', 'header_center', 'header_right', 'footer_left', 'footer_center', 'footer_right'].map((k) => `<label><span class="label">${k.startsWith('header') ? 'Header' : 'Footer'} ${k.endsWith('left') ? 'left' : k.endsWith('right') ? 'right' : 'centre'}</span><input class="input" data-box="${k}" value="${esc(boxes[k])}"></label>`).join('')}</div>`),
        h(`<div class="tokrow"><span class="label">Insert</span><button type="button" class="chip" data-tok="<<1>>">Page number</button><button type="button" class="chip" data-tok="<<Page 1 of n>>">Page 1 of n</button><button type="button" class="chip" data-tok="<<d/m/yyyy>>">Date</button><button type="button" class="chip" data-tok="bates">Bates number</button></div>`),
        h(`<div class="batesrow"${kind === 'bates' ? '' : ' hidden'}><label><span class="label">Prefix</span><input class="input" data-o="prefix" value="${esc(o.prefix)}"></label><label><span class="label">First number</span><input class="input" type="number" min="1" data-o="start" value="${o.start}"></label><label><span class="label">Digits</span><input class="input" type="number" min="1" max="12" data-o="digits" value="${o.digits}"></label></div>`),
        h(`<div class="row3"><label><span class="label">Size (pt)</span><input class="input" type="number" min="5" max="48" data-o="size" value="${o.size}"></label><label><span class="label">Margin (mm)</span><input class="input" type="number" min="0" max="80" data-o="margin" value="${o.margin}"></label><label><span class="label">Pages</span><input class="input" data-o="pages" placeholder="All, or 2-5"></label></div>`),
        h(`<div><span class="label">Colour</span>${swatches(COLORS, o.color, 'color')}</div>`));
    } else if (kind === 'watermark') {
      form.append(h(`<div class="seg full" data-mode><button type="button" class="tb" data-m="text" aria-pressed="true">Text</button><button type="button" class="tb" data-m="image" aria-pressed="false">Picture</button></div>`),
        h(`<label data-for="text"><span class="label">Words</span><input class="input" data-o="text" value="${esc(o.text)}"></label>`),
        h(`<div data-for="text"><span class="label">Colour</span>${swatches(['#d13438', '#ca5010', '#107c10', '#0f6cbd', '#5c2e91', '#000000', '#6b6b6b'], o.wmColor, 'wmColor')}</div>`),
        h(`<div data-for="image" hidden class="cmrow"><button type="button" class="btn" data-a="pick">Choose a picture…</button><small class="pickname faint"></small></div>`),
        h(`<label data-for="image" hidden><span class="label">Size (% of the page)</span><input type="range" min="5" max="100" data-o="scale" value="${o.scale}"></label>`),
        h(`<label><span class="label">Opacity</span><input type="range" min="5" max="100" data-o="opacity" value="${o.opacity}"></label>`),
        h(`<label><span class="label">Angle</span><input type="range" min="-90" max="90" data-o="rotation" value="${o.rotation}"></label>`),
        h(`<label class="row"><input type="checkbox" data-o="behind"> Behind the page content</label>`),
        h(`<label><span class="label">Pages</span><input class="input" data-o="pages" placeholder="All, or 2-5"></label>`));
    } else {
      form.append(h(`<div class="seg full" data-mode><button type="button" class="tb" data-m="text" aria-pressed="true">Colour</button><button type="button" class="tb" data-m="image" aria-pressed="false">Picture</button></div>`),
        h(`<div data-for="text"><span class="label">Colour</span>${swatches(BG, o.bgColor, 'bgColor')}</div>`),
        h(`<div data-for="image" hidden class="cmrow"><button type="button" class="btn" data-a="pick">Choose a picture…</button><small class="pickname faint"></small></div>`),
        h(`<label data-for="image" hidden><span class="label">Size (% of the page)</span><input type="range" min="5" max="100" data-o="scale" value="100"></label>`),
        h(`<label><span class="label">Opacity</span><input type="range" min="5" max="100" data-o="opacity" value="${o.opacity}"></label>`),
        h(`<label><span class="label">Pages</span><input class="input" data-o="pages" placeholder="All, or 2-5"></label>`));
      o.scale = 100;
    }
    form.append(h(`<label class="row"><input type="checkbox" data-o="replace" checked> Replace what was added before</label>`));
    let last = form.querySelector('[data-box="footer_center"]');
    const op = () => {
      const base = { pages: o.pages, replace: o.replace, opacity: o.opacity };
      if (hf) return { kind: 'headerFooter', opts: { ...base, ...Object.fromEntries(Object.entries(boxes).filter(([, v]) => v)), size: o.size, margin: o.margin, color: o.color } };
      if (kind === 'watermark') return { kind, opts: { ...base, rotation: o.rotation, behind: o.behind, ...(o.mode === 'image' && o.file ? { file: o.file, scale: o.scale } : { text: o.text || 'CONFIDENTIAL', color: o.wmColor }) } };
      return { kind, opts: { ...base, ...(o.mode === 'image' && o.file ? { file: o.file, scale: o.scale } : { color: o.bgColor }) } };
    };
    let t = null, seq = 0;
    const img = $('img', pv);
    const update = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const my = ++seq;
        $('.pvnav span', pv).textContent = `Page ${page + 1} of ${n}`;
        const w = st.sess.pages[page], scale = Math.min(1.4, 340 / Math.max(w.w, w.h)) * (window.devicePixelRatio || 1);
        try {
          const empty = hf && !Object.values(boxes).some((v) => v.trim());
          const png = await (empty ? call('render', st.sess.id, page, scale) : call('preview', st.sess.id, op(), page, scale));
          if (my !== seq) return;
          if (img.src) URL.revokeObjectURL(img.src);
          img.src = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
          pv.classList.remove('err');
        } catch (e) { pv.classList.add('err'); pv.title = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
      }, 220);
    };
    form.addEventListener('focusin', (e) => { if (e.target.dataset.box) last = e.target; });
    form.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.box) boxes[el.dataset.box] = el.value;
      if (el.dataset.o) o[el.dataset.o] = el.type === 'checkbox' ? el.checked : el.value;
      if (['prefix', 'start', 'digits'].includes(el.dataset.o)) for (const k of Object.keys(boxes)) if (/<<Bates Number#/.test(boxes[k])) { boxes[k] = boxes[k].replace(/<<Bates Number#[^>]*>>/, bates()); $(`[data-box="${k}"]`, form).value = boxes[k]; }
      update();
    });
    form.addEventListener('click', async (e) => {
      const tok = e.target.closest('[data-tok]');
      if (tok && last) {
        if (tok.dataset.tok === 'bates') $('.batesrow', form).hidden = false;
        const v = tok.dataset.tok === 'bates' ? bates() : tok.dataset.tok;
        const at_ = last.selectionStart ?? last.value.length;
        last.value = `${last.value.slice(0, at_)}${v}${last.value.slice(last.selectionEnd ?? at_)}`;
        boxes[last.dataset.box] = last.value;
        last.focus();
        update();
      }
      const m = e.target.closest('[data-m]');
      if (m) {
        o.mode = m.dataset.m;
        $$('[data-m]', form).forEach((b) => b.setAttribute('aria-pressed', b === m));
        $$('[data-for]', form).forEach((x) => { x.hidden = x.dataset.for !== o.mode; });
        update();
      }
      if (e.target.closest('[data-a=pick]')) {
        const [f] = await api.invoke('dialog:open', { multi: false, filters: [{ name: 'Picture or PDF', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'gif', 'bmp', 'pdf'] }] });
        if (f) { o.file = f; $('.pickname', form).textContent = f.split(/[\\/]/).pop(); update(); }
      }
    });
    wireSwatches(form, o, update);
    pv.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) { page = (page + Number(b.dataset.p) + n) % n; update(); } });
    d.ok.addEventListener('click', async () => {
      d.close();
      await ed.docChange(op(), `${TITLES[kind]} added.`);
    });
    $('[data-a=remove]', d.s).addEventListener('click', async () => {
      d.close();
      await ed.docChange({ kind: 'remove', opts: { what: MARKS[kind] } }, `${hf ? 'Headers and footers' : kind === 'watermark' ? 'Watermarks' : 'Backgrounds'} removed.`);
    });
    update();
  }

  async function properties() {
    const p = await ed.busy('Reading properties…', () => call('props', st.sess.id));
    if (!p) return;
    const d = dialog('Document properties', { ok: 'Save' });
    const opt = (list, v) => list.map(([k, label]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(label)}</option>`).join('');
    d.body.append(h(`<div class="dlgform one">
      <label><span class="label">Title</span><input class="input" data-p="title" value="${esc(p.title)}"></label>
      <label><span class="label">Author</span><input class="input" data-p="author" value="${esc(p.author)}"></label>
      <label><span class="label">Subject</span><input class="input" data-p="subject" value="${esc(p.subject)}"></label>
      <label><span class="label">Keywords</span><input class="input" data-p="keywords" value="${esc(p.keywords)}" placeholder="Separated by commas"></label>
      <label><span class="label">Language</span><select class="input" data-p="lang">${opt(LANGS.some(([k]) => k === p.lang) ? LANGS : [...LANGS, [p.lang, p.lang]], p.lang)}</select></label>
      <div class="mlabel">When it opens</div>
      <div class="row2">
        <label><span class="label">Show</span><select class="input" data-p="navigation">${opt([['page', 'Page only'], ['bookmarks', 'Bookmarks and page'], ['pages', 'Pages and page'], ['attachments', 'Attachments and page']], p.navigation)}</select></label>
        <label><span class="label">Layout</span><select class="input" data-p="layout">${opt([['default', 'Reader’s choice'], ['single', 'Single page'], ['continuous', 'Continuous'], ['two_up', 'Two-up'], ['two_up_continuous', 'Two-up continuous'], ['two_up_cover', 'Two-up, cover alone']], p.layout)}</select></label>
        <label><span class="label">Zoom</span><select class="input" data-p="magnification">${opt([['default', 'Reader’s choice'], ['actual', 'Actual size'], ['fit_page', 'Fit page'], ['fit_width', 'Fit width']], p.magnification)}</select></label>
        <label><span class="label">Open at page</span><input class="input" type="number" min="1" max="${p.pages}" data-p="page" value="${p.page}"></label>
      </div>
      <label class="row"><input type="checkbox" data-p="displayTitle"${p.displayTitle ? ' checked' : ''}> Show the title, not the file name, in the window</label>
      <p class="tip">${p.pages} page${p.pages === 1 ? '' : 's'}${p.version ? ` · ${esc(p.version)}` : ''}${p.producer ? ` · made by ${esc(p.producer)}` : ''}</p>
    </div>`));
    d.ok.addEventListener('click', async () => {
      const v = Object.fromEntries($$('[data-p]', d.body).map((el) => [el.dataset.p, el.type === 'checkbox' ? el.checked : el.value]));
      const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => String(x) !== String(p[k])));
      d.close();
      if (!Object.keys(changed).length) return;
      const r = await ed.busy('Saving properties…', async () => { await ed.flush(); return call('setProps', st.sess.id, changed); });
      if (r) { st.sess = r; ed.record('Changed the properties'); ed.refresh(); toast('Properties updated. Save to keep them.', { type: 'success' }); }
    });
  }

  function security() {
    const cur = st.saveOpts.protect, had = st.sess.protected;
    const on = cur ? true : cur === null ? false : had;
    const d = dialog('Password and permissions', { ok: 'Done' });
    d.body.append(h(`<div class="dlgform one">
      <div class="seg full"><button type="button" class="tb" data-on="0" aria-pressed="${!on}">No password</button><button type="button" class="tb" data-on="1" aria-pressed="${on}">Password to open</button></div>
      <div data-pw${on ? '' : ' hidden'}>
        ${had && cur === undefined ? '<p class="tip">This file had a password when you opened it; it keeps it unless you change it here.</p>' : ''}
        <label><span class="label">Password</span><input class="input" type="password" data-f="pw" autocomplete="new-password" placeholder="${had && cur === undefined ? 'Leave empty to keep the old one' : ''}"></label>
        <label><span class="label">Type it again</span><input class="input" type="password" data-f="pw2" autocomplete="new-password"></label>
        <label class="row"><input type="checkbox" data-f="print"${cur?.allowPrint === false ? '' : ' checked'}> Allow printing</label>
        <label class="row"><input type="checkbox" data-f="copy"${cur?.allowCopy === false ? '' : ' checked'}> Allow copying text and pictures</label>
        <label class="row"><input type="checkbox" data-f="edit"${cur?.allowEdit ? ' checked' : ''}> Allow changes</label>
      </div>
      <p class="tip">AES-256, applied when you save. Your working copy here stays open.</p>
    </div>`));
    let want = on;
    d.body.addEventListener('click', (e) => { const b = e.target.closest('[data-on]'); if (b) { want = b.dataset.on === '1'; $$('[data-on]', d.body).forEach((x) => x.setAttribute('aria-pressed', x === b)); $('[data-pw]', d.body).hidden = !want; } });
    d.ok.addEventListener('click', () => {
      const f = (k) => $(`[data-f=${k}]`, d.body);
      if (!want) { st.saveOpts.protect = null; d.close(); ed.updateChrome(); return; }
      const pw = f('pw').value;
      if (!pw && !(had && cur === undefined)) { toast('Type a password, or choose No password.', { type: 'error' }); return; }
      if (pw !== f('pw2').value) { toast('The two passwords are not the same.', { type: 'error' }); return; }
      st.saveOpts.protect = pw ? { userPassword: pw, allowPrint: f('print').checked, allowCopy: f('copy').checked, allowEdit: f('edit').checked } : undefined;
      d.close();
      ed.updateChrome();
      toast(pw ? 'The password goes on when you save.' : 'The file keeps its password.', { type: 'success' });
    });
  }

  async function flattenComments() {
    if (!st.marks.annots.length && !st.pending.length) { toast('There are no comments to flatten.'); return; }
    const r = await ed.busy('Flattening comments…', async () => { await ed.flush(); return call('fieldOp', st.sess.id, { type: 'flatten', comments: true, fields: false }); });
    if (r) { st.sess = r; st.annSel = null; ed.record('Flattened the comments'); ed.refresh(); toast('Comments are now part of the pages.', { type: 'success' }); }
  }

  function recognise() {
    const d = dialog('Recognise text', { ok: 'Recognise' });
    d.body.append(h(`<div class="dlgform one">
      <p class="tip">The words on scanned pages become real text, laid invisibly over the page, so Find, copying and Edit text work. The pages look the same.</p>
      <label><span class="label">Language</span><select class="input" data-f="lang">${OCR_LANGS.map(([k, label]) => `<option value="${k}">${label}</option>`).join('')}</select></label>
      <label class="row"><input type="checkbox" data-f="all"> Pages that have text already, too</label>
    </div>`));
    d.ok.addEventListener('click', async () => {
      const lang = $('[data-f=lang]', d.body).value, all = $('[data-f=all]', d.body).checked;
      d.close();
      const r = await ed.busy('Recognising text…', async () => { await ed.flush(); return call('recognise', st.sess.id, { lang, all }); });
      if (!r) return;
      st.sess = r;
      if (r.recognised) ed.record(`Recognised text on ${r.recognised} page${r.recognised === 1 ? '' : 's'}`);
      ed.refresh();
      toast(r.recognised ? `Recognised ${r.words} word${r.words === 1 ? '' : 's'} on ${r.recognised} page${r.recognised === 1 ? '' : 's'}. Save to keep it.` : 'Every page already has text; nothing to recognise.', { type: r.recognised ? 'success' : undefined });
    });
  }
  async function check(kind) {
    const r = await ed.busy(kind === 'print' ? 'Checking for print…' : 'Checking accessibility…', async () => { await ed.flush(); return call('check', st.sess.id, kind); });
    if (!r) return;
    const d = dialog(kind === 'print' ? 'Print check' : 'Accessibility check', { ok: '', extra: kind === 'access' ? '<button class="btn" data-a="props">Properties…</button>' : '' });
    const lines = String(r.text || '').split('\n').filter(Boolean);
    d.body.append(h(`<div class="dlgform one"><p><b>${esc(r.note || '')}</b></p><ul class="checks">${lines.map((l) => { const bad = /^✗/.test(l), q = /^\?/.test(l); return `<li class="${bad ? 'bad' : q ? 'ask' : 'note'}">${esc(l.replace(/^[✗?!i]\s*/, ''))}</li>`; }).join('') || '<li class="note">Nothing to report.</li>'}</ul>
      ${kind === 'access' ? '<p class="tip">Title and language are set in Properties. Tags and reading order need a tagging tool; Lime can tell you what is missing.</p>' : ''}</div>`));
    $('[data-a=props]', d.s)?.addEventListener('click', () => { d.close(); properties(); });
  }

  function saveMenu(anchor) {
    const o = st.saveOpts, pw = o.protect ? 'a new password' : o.protect === null ? 'no password' : st.sess.protected ? 'its password' : 'no password';
    const m = popover(anchor, `<div class="mlabel">Comments and markup</div>
      <div class="seg full"><button class="tb" data-k="keep" aria-pressed="${o.comments !== 'flatten'}">Keep as comments</button><button class="tb" data-k="flatten" aria-pressed="${o.comments === 'flatten'}">Flatten</button></div>
      <label class="row mrow"><input type="checkbox" data-k="fields"${o.flattenFields ? ' checked' : ''}> Flatten form fields</label>
      <div class="mlabel">Saved with ${pw}</div>${item('security', 'lock', 'Password and permissions…')}`, (dd) => { if (dd === 'security') security(); });
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      if (b.dataset.k === 'fields') o.flattenFields = b.checked;
      else { o.comments = b.dataset.k; $$('[data-k=keep],[data-k=flatten]', m).forEach((x) => x.setAttribute('aria-pressed', x === b)); }
    });
  }

  return { menu, saveMenu, marks, properties, security, check };
}
