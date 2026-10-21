import { $, $$, esc, h, nameOf, dirOf, sep, clean } from './ui.js';
import { parseDoc, parseCss, setDecl } from './websource.js';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp'];
const BLOCK_TAGS = [['p', 'Paragraph'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4'], ['h5', 'Heading 5'], ['h6', 'Heading 6'], ['pre', 'Preformatted'], ['blockquote', 'Quote'], ['div', 'Div']];
const FONT_CHOICES = [['', 'Font'], ['-apple-system, "Segoe UI", system-ui, sans-serif', 'System sans'], ['Helvetica, Arial, sans-serif', 'Helvetica, Arial'], ['Georgia, serif', 'Georgia'], ['"Times New Roman", serif', 'Times'], ['Verdana, sans-serif', 'Verdana'], ['ui-monospace, Menlo, Consolas, monospace', 'Monospace']];
const SIZE_CHOICES = [['', 'Size'], ['1', 'Tiny'], ['2', 'Small'], ['3', 'Normal'], ['4', 'Large'], ['5', 'Larger'], ['6', 'Huge'], ['7', 'Giant']];
const SPECIAL = ['©', '®', '™', '—', '–', '…', '€', '£', '¥', '°', '±', '×', '÷', '§', '¶', '•', '←', '→', '↑', '↓', '«', '»', '“', '”', '‘', '’', ' '];
const INSERTS = [
  ['Structure', [['div', 'Div', 'square', '<div>\n  <p>New box</p>\n</div>'], ['section', 'Section', 'layers', '<section>\n  <h2>Section heading</h2>\n  <p>Section text.</p>\n</section>'], ['header', 'Header', 'layers', '<header>\n  <h1>Site name</h1>\n</header>'], ['footer', 'Footer', 'layers', '<footer>\n  <p>© Your name</p>\n</footer>'], ['nav', 'Navigation', 'link', '<nav>\n  <a href="index.html">Home</a>\n  <a href="about.html">About</a>\n  <a href="contact.html">Contact</a>\n</nav>']]],
  ['Text', [['heading', 'Heading', 'textT', '<h2>Heading</h2>'], ['paragraph', 'Paragraph', 'text', '<p>Type your text here.</p>'], ['list', 'List', 'list', '<ul>\n  <li>First item</li>\n  <li>Second item</li>\n</ul>'], ['hr', 'Horizontal rule', 'line', '<hr>'], ['br', 'Line break', 'outdent', '<br>'], ['special', 'Special character…', 'sparkle', null], ['comment', 'Comment', 'comment', null], ['date', 'Date', 'clock', null]]],
  ['Media', [['image', 'Image…', 'image', null], ['siteimage', 'Image from the site…', 'grid', null], ['video', 'Video…', 'video', null], ['audio', 'Audio…', 'music', null], ['embed', 'Embed or iframe…', 'web', null]]],
  ['Forms and tables', [['table', 'Table…', 'grid', null], ['button', 'Button', 'square', '<a class="button" href="#">Button</a>'], ['form', 'Form', 'field', '<form action="#" method="post">\n  <p><label>Name <input type="text" name="name"></label></p>\n  <p><button type="submit">Send</button></p>\n</form>'], ['input', 'Text field', 'field', '<label>Label <input type="text" name="field"></label>'], ['textarea', 'Text box', 'field', '<label>Message <textarea name="message" rows="4"></textarea></label>'], ['checkbox', 'Tick box', 'check', '<label><input type="checkbox" name="agree"> I agree</label>'], ['submit', 'Send button', 'square', '<button type="submit">Send</button>']]],
];
const POSITIONS = [['centre', 'Centre'], ['tiled', 'Tiled'], ['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']];
const svgText = (text, size, colour, angle) => {
  const w = Math.max(160, Math.round(text.length * size * 0.62 + size * 2)), hgt = Math.round(w * 0.75);
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${hgt}'><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' font-family='Helvetica, Arial, sans-serif' font-weight='700' font-size='${size}' fill='${colour}' transform='rotate(${-angle} ${w / 2} ${hgt / 2})'>${text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])}</text></svg>`;
};

export function designTools(E) {
  const { st, api, call, icon, toast, tip } = E;
  const g = () => E.gjs();
  const sel = () => g()?.getSelected() || null;
  const tagOf = (c) => String(c?.get('tagName') || '').toLowerCase();
  const frameDoc = () => g()?.Canvas.getDocument();
  const frameWin = () => g()?.Canvas.getWindow();
  const absOf = (src) => { try { const u = new URL(src, E.dirUrl(st.dir)); return u.protocol === 'media:' ? decodeURIComponent(u.pathname.slice(1)).replace(/^\/([a-z]:)/i, '$1') : null; } catch (_) { return null; } };
  const changed = (why) => { st.why = why; E.onDesignEdit(); };
  const nameOf2 = (c) => (c?.getName?.() || 'element').toLowerCase();

  function ask(title, fields, okLabel = 'OK') {
    return new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>${esc(title)}</h2><div class="dlgform"></div></div><div class="foot"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">${esc(okLabel)}</button></div></div></div>`);
      const vals = {};
      for (const f of fields) {
        vals[f.key] = f.value ?? (f.kind === 'check' ? false : '');
        let el;
        if (f.kind === 'check') el = h(`<label class="row"><input type="checkbox" ${f.value ? 'checked' : ''}>${esc(f.label)}</label>`);
        else if (f.kind === 'select') el = h(`<label><span class="label">${esc(f.label)}</span><select class="input">${f.choices.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`);
        else if (f.kind === 'area') el = h(`<label><span class="label">${esc(f.label)}</span><textarea class="input" rows="${f.rows || 5}" spellcheck="false"></textarea></label>`);
        else el = h(`<label><span class="label">${esc(f.label)}</span><input class="input" type="${f.kind === 'number' ? 'number' : 'text'}" placeholder="${esc(f.placeholder || '')}" spellcheck="false"></label>`);
        const inp = $('input, select, textarea', el);
        if (f.kind !== 'check' && f.kind !== 'select') inp.value = f.value ?? '';
        inp.dataset.k = f.key;
        const upd = () => { vals[f.key] = f.kind === 'check' ? inp.checked : f.kind === 'number' ? Number(inp.value) : inp.value; };
        inp.addEventListener('input', upd);
        inp.addEventListener('change', upd);
        $('.dlgform', s).append(el);
      }
      document.body.append(s);
      ($('.dlgform input:not([type=checkbox]), .dlgform textarea', s) || $('[data-a=ok]', s)).focus();
      $('.dlgform input:not([type=checkbox])', s)?.select?.();
      const done = (ok) => { s.remove(); resolve(ok ? vals : null); };
      s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.target.matches('textarea')) done(true); if (e.key === 'Escape') done(false); });
      s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) done(a === 'ok'); });
    });
  }
  function menu(at, items, onPick) {
    $$('.popmenu.we-menu').forEach((x) => x.remove());
    const m = h(`<div class="popmenu we-menu" role="menu">${items.map((it) => (it === '-' ? '<div class="we-sep"></div>' : typeof it === 'string' ? `<div class="mlabel">${esc(it)}</div>` : `<button class="mi" data-id="${esc(it[0])}" ${it[3] ? 'disabled' : ''}>${icon(it[2] || 'doc', 'sm')}<span>${esc(it[1])}</span>${it[4] ? `<kbd>${esc(it[4])}</kbd>` : ''}</button>`)).join('')}</div>`);
    document.body.append(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(at.x, innerWidth - r.width - 8))}px`;
    m.style.top = `${Math.max(8, Math.min(at.y, innerHeight - r.height - 8))}px`;
    const off = (e) => { if (!m.contains(e.target)) close(); };
    const close = () => { m.remove(); document.removeEventListener('pointerdown', off, true); frameDoc()?.removeEventListener('pointerdown', close, true); };
    setTimeout(() => { document.addEventListener('pointerdown', off, true); frameDoc()?.addEventListener('pointerdown', close, true); }, 0);
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) { close(); onPick(b.dataset.id); } });
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    return m;
  }

  function insertHtml(html, why) {
    const ed = g();
    if (!ed) return null;
    let at = sel(), parent, index;
    const typing = ed.getEditing();
    const inside = typing?.view?.el?.contains(frameDoc()?.getSelection()?.anchorNode);
    if (typing && typing.view?.rteEnabled && typing === at && inside && /^<(br|span|a|b|strong|em|i|img)\b|^[^<]/.test(html)) { frameDoc().execCommand('insertHTML', false, html); changed(why); return null; }
    if (!at || at === ed.getWrapper()) { parent = ed.getWrapper(); index = parent.components().length; } else { parent = at.parent(); index = at.index() + 1; }
    while (parent && parent !== ed.getWrapper() && !parent.get('droppable')) { at = parent; parent = parent.parent(); index = at.index() + 1; }
    const added = [].concat(parent.append(html, { at: index }));
    const first = added.find((x) => x && !['textnode', 'comment'].includes(x.get('type')));
    if (first) ed.select(first);
    changed(why);
    return first;
  }
  async function imageFile(file) {
    const dest = await call('copyInto', file, st.dir);
    return E.relPath(st.dir, dest);
  }
  async function insertImage() {
    const [f] = await api.invoke('dialog:open', { multi: false, filters: [{ name: 'Pictures', extensions: IMAGE_EXT }] });
    if (!f) return;
    const src = await imageFile(f);
    insertHtml(`<img src="${esc(src)}" alt="${esc(nameOf(f).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '))}">`, `Added the picture ${nameOf(f)}`);
  }
  async function pickSiteImage() {
    const list = await call('listSite', st.dir, { images: true });
    return new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog wide"><div class="body"><h2>Pictures in this site</h2>${list.length ? `<div class="we-gallery">${list.map((x, i) => `<button data-i="${i}" title="${esc(E.relPath(st.dir, x.path))}"><img src="${esc(E.mediaUrl(x.path))}" alt="" loading="lazy"><span>${esc(nameOf(x.path))}</span></button>`).join('')}</div>` : '<p class="muted">There are no pictures in this page’s folder yet.</p>'}</div><div class="foot"><button class="btn" data-a="no">Cancel</button></div></div></div>`);
      document.body.append(s);
      const done = (v) => { s.remove(); resolve(v); };
      s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(null); });
      s.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) done(list[Number(b.dataset.i)].path); else if (e.target.closest('[data-a=no]') || e.target === s) done(null); });
    });
  }
  async function insertFromSite() {
    const f = await pickSiteImage();
    if (f) insertHtml(`<img src="${esc(E.relPath(st.dir, f))}" alt="${esc(nameOf(f).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '))}">`, `Added the picture ${nameOf(f)}`);
  }
  async function insertMedia(kind) {
    const ext = kind === 'video' ? ['mp4', 'webm', 'ogv', 'mov', 'm4v'] : ['mp3', 'm4a', 'ogg', 'oga', 'wav', 'opus', 'flac'];
    const [f] = await api.invoke('dialog:open', { multi: false, filters: [{ name: kind === 'video' ? 'Videos' : 'Sound', extensions: ext }] });
    if (!f) return;
    const src = E.relPath(st.dir, await call('copyInto', f, st.dir));
    insertHtml(kind === 'video' ? `<video src="${esc(src)}" controls width="640"></video>` : `<audio src="${esc(src)}" controls></audio>`, `Added the ${kind} ${nameOf(f)}`);
  }
  async function insertTable() {
    const v = await ask('Insert table', [{ key: 'rows', label: 'Rows', kind: 'number', value: 3 }, { key: 'cols', label: 'Columns', kind: 'number', value: 3 }, { key: 'head', label: 'First row is a header', kind: 'check', value: true }], 'Insert');
    if (!v) return;
    const rows = Math.max(1, Math.min(200, v.rows || 3)), cols = Math.max(1, Math.min(30, v.cols || 3));
    const cell = (t) => `<${t}>&nbsp;</${t}>`;
    const row = (t) => `    <tr>${Array.from({ length: cols }, () => cell(t)).join('')}</tr>`;
    const body = Array.from({ length: rows - (v.head ? 1 : 0) }, () => row('td')).join('\n');
    insertHtml(`<table>\n${v.head ? `  <thead>\n${row('th')}\n  </thead>\n` : ''}  <tbody>\n${body}\n  </tbody>\n</table>`, `Added a table of ${rows} × ${cols}`);
  }
  async function insertEmbed() {
    const v = await ask('Embed', [{ key: 'url', label: 'Address of the page or video', placeholder: 'https://…' }], 'Insert');
    if (!v?.url) return;
    let url = v.url.trim();
    const yt = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{6,})/.exec(url);
    if (yt) url = `https://www.youtube-nocookie.com/embed/${yt[1]}`;
    insertHtml(`<iframe src="${esc(url)}" width="560" height="315" loading="lazy" allowfullscreen></iframe>`, 'Added an embed');
  }
  async function insertSpecial() {
    const ch = await new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>Special character</h2><div class="we-chars">${SPECIAL.map((c) => `<button data-c="${esc(c)}" title="${c === ' ' ? 'Non-breaking space' : esc(c)}">${c === ' ' ? 'nbsp' : esc(c)}</button>`).join('')}</div></div><div class="foot"><button class="btn" data-a="no">Cancel</button></div></div></div>`);
      document.body.append(s);
      const done = (v) => { s.remove(); resolve(v); };
      s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(null); });
      s.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) done(b.dataset.c); else if (e.target.closest('[data-a=no]') || e.target === s) done(null); });
    });
    if (!ch) return;
    const ent = { '©': '&copy;', '®': '&reg;', '™': '&trade;', ' ': '&nbsp;', '—': '&mdash;', '–': '&ndash;' }[ch] || ch;
    if (g().getEditing()?.view?.rteEnabled) { frameDoc().execCommand('insertHTML', false, ent); changed(`Added ${ch === ' ' ? 'a non-breaking space' : ch}`); } else insertHtml(`<p>${ent}</p>`, `Added ${ch}`);
  }
  async function insertComment() {
    const v = await ask('Comment', [{ key: 'text', label: 'Note for people reading the code', value: '' }], 'Insert');
    if (v?.text != null) insertHtml(`<!-- ${v.text.replace(/--/g, '—')} -->`, 'Added a comment');
  }
  function insertDate() {
    const d = new Date(), txt = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), iso = d.toISOString().slice(0, 10);
    const html = `<time datetime="${iso}">${txt}</time>`;
    if (g().getEditing()?.view?.rteEnabled) { frameDoc().execCommand('insertHTML', false, html); changed('Added the date'); } else insertHtml(`<p>${html}</p>`, 'Added the date');
  }
  function insertMenu(at) {
    const items = INSERTS.flatMap(([group, list]) => [group, ...list.map(([id, label, ic]) => [id, label, ic])]);
    menu(at, items, (id) => insertById(id));
  }
  function insertById(id) {
    const fixed = INSERTS.flatMap(([, l]) => l).find((x) => x[0] === id);
    if (fixed?.[3]) return insertHtml(fixed[3], `Added ${fixed[1].toLowerCase().replace(/…$/, '')}`);
    return ({ image: insertImage, siteimage: insertFromSite, video: () => insertMedia('video'), audio: () => insertMedia('audio'), embed: insertEmbed, table: insertTable, special: insertSpecial, comment: insertComment, date: insertDate })[id]?.();
  }

  function compAt(node) {
    const ed = g();
    for (let n = node; n; n = n.parentElement) { const v = n.__gjsv || null; if (v?.model) return v.model; }
    const all = ed.getWrapper().find('*');
    for (let n = node; n; n = n.parentElement) { const c = all.find((x) => x.getEl() === n); if (c) return c; }
    return null;
  }
  async function dropFiles(files, target) {
    const pics = [...files].filter((f) => IMAGE_EXT.includes((f.name.split('.').pop() || '').toLowerCase()) || /^image\//.test(f.type));
    if (!pics.length) return false;
    if (target && target !== g().getWrapper()) g().select(target);
    for (const f of pics) {
      const p = api.pathFor?.(f);
      const dest = p ? await call('copyInto', p, st.dir) : await call('saveBytes', st.dir, f.name && f.name !== 'image.png' ? f.name : `pasted-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, new Uint8Array(await f.arrayBuffer()));
      insertHtml(`<img src="${esc(E.relPath(st.dir, dest))}" alt="${esc((f.name || 'picture').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '))}">`, `Added the picture ${nameOf(dest)}`);
    }
    return true;
  }

  const bar = { el: null, range: null };
  function saveRange() { const s = frameDoc()?.getSelection(); if (s?.rangeCount) bar.range = s.getRangeAt(0).cloneRange(); }
  function restoreRange() { const s = frameDoc()?.getSelection(); if (bar.range && s) { s.removeAllRanges(); s.addRange(bar.range); } }
  function exec(cmd, val, why) {
    const doc = frameDoc();
    if (!doc) return;
    restoreRange();
    doc.execCommand('styleWithCSS', false, !['bold', 'italic', 'underline', 'strikeThrough'].includes(cmd));
    doc.execCommand(cmd, false, val ?? null);
    if (cmd === 'bold' || cmd === 'italic') semantic();
    saveRange();
    changed(why);
    syncBar();
  }
  function semantic() {
    const doc = frameDoc(), host = g()?.getEditing()?.view?.getChildrenContainer?.();
    if (!host) return;
    let last = null;
    for (const [from, to] of [['b', 'strong'], ['i', 'em']]) for (const old of host.querySelectorAll(from)) { const n = doc.createElement(to); while (old.firstChild) n.append(old.firstChild); old.replaceWith(n); last = n; }
    if (last) { const r = doc.createRange(); r.selectNodeContents(last); const s2 = doc.getSelection(); s2.removeAllRanges(); s2.addRange(r); }
  }
  async function linkPrompt() {
    saveRange();
    const doc = frameDoc(), cur = bar.range && doc ? (bar.range.startContainer.parentElement?.closest('a')?.getAttribute('href') || '') : '';
    const v = await ask('Link', [{ key: 'href', label: 'Web address, page or e-mail', value: cur, placeholder: 'https://… or page.html' }, { key: 'blank', label: 'Open in a new tab', kind: 'check' }], 'Link');
    if (!v?.href) { restoreRange(); return; }
    let href = v.href.trim();
    if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(href)) href = `mailto:${href}`;
    restoreRange();
    if (bar.range?.collapsed) doc.execCommand('insertHTML', false, `<a href="${esc(href)}"${v.blank ? ' target="_blank"' : ''}>${esc(v.href.trim())}</a>`);
    else { doc.execCommand('createLink', false, href); if (v.blank) { const a = doc.getSelection().anchorNode?.parentElement?.closest('a'); a?.setAttribute('target', '_blank'); } }
    changed('Added a link');
  }
  async function setBlock(tag) {
    const ed = g(), c = ed.getEditing() || sel();
    if (!c || tagOf(c) === tag) return;
    if (ed.getEditing()) await c.view.disableEditing?.();
    const html = c.toHTML(E.htmlOpts()).replace(/^<[a-z0-9-]+/i, `<${tag}`).replace(/<\/[a-z0-9-]+>$/i, `</${tag}>`);
    const [n] = [].concat(c.replaceWith(html));
    if (n) ed.select(n);
    changed(`Made ${nameOf2(c)} a ${BLOCK_TAGS.find((x) => x[0] === tag)?.[1].toLowerCase() || tag}`);
  }
  function makeBar(host) {
    host.innerHTML = '';
    const b = h(`<div class="we-fbar">
      <select data-f="block" title="Paragraph format">${BLOCK_TAGS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <select data-f="font" title="Font">${FONT_CHOICES.map(([v, l]) => `<option value="${esc(v)}">${l}</option>`).join('')}</select>
      <select data-f="size" title="Size">${SIZE_CHOICES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <i></i>
      <button data-x="bold" title="Bold (Ctrl+B)">${icon('bold', 'sm')}</button><button data-x="italic" title="Italic (Ctrl+I)">${icon('italic', 'sm')}</button><button data-x="underline" title="Underline (Ctrl+U)">${icon('underline', 'sm')}</button><button data-x="strikeThrough" title="Strike">${icon('strike', 'sm')}</button>
      <label class="we-fcol" title="Text colour"><span style="--c:#c4291f">A</span><input type="color" data-f="foreColor" value="#c4291f"></label><label class="we-fcol hl" title="Highlight"><span style="--c:#ffe14d">A</span><input type="color" data-f="hiliteColor" value="#ffe14d"></label>
      <i></i>
      <button data-x="justifyLeft" title="Left">${icon('alignLeft', 'sm')}</button><button data-x="justifyCenter" title="Centre">${icon('alignCenter', 'sm')}</button><button data-x="justifyRight" title="Right">${icon('alignRight', 'sm')}</button><button data-x="justifyFull" title="Justify">${icon('text', 'sm')}</button>
      <i></i>
      <button data-x="insertUnorderedList" title="Bulleted list">${icon('list', 'sm')}</button><button data-x="insertOrderedList" title="Numbered list">${icon('listNum', 'sm')}</button><button data-x="outdent" title="Outdent">${icon('outdent', 'sm')}</button><button data-x="indent" title="Indent">${icon('indent', 'sm')}</button>
      <i></i>
      <button data-x="link" title="Link (Ctrl+K)">${icon('link', 'sm')}</button><button data-x="unlink" title="Remove link">${icon('close', 'sm')}</button><button data-x="removeFormat" title="Clear formatting">${icon('whiteout', 'sm')}</button>
    </div>`);
    host.append(b);
    b.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); else saveRange(); });
    b.addEventListener('click', (e) => {
      const x = e.target.closest('[data-x]')?.dataset.x;
      if (!x) return;
      if (x === 'link') linkPrompt(); else exec(x, null, { bold: 'Made text bold', italic: 'Made text italic', underline: 'Underlined text', strikeThrough: 'Struck through text', removeFormat: 'Cleared the formatting', unlink: 'Removed a link', insertUnorderedList: 'Made a bulleted list', insertOrderedList: 'Made a numbered list' }[x] || 'Changed the text');
    });
    b.addEventListener('change', (e) => {
      const f = e.target.dataset.f;
      if (f === 'block') setBlock(e.target.value);
      else if (f === 'font' && e.target.value) exec('fontName', e.target.value, 'Changed the font');
      else if (f === 'size' && e.target.value) exec('fontSize', e.target.value, 'Changed the text size');
      else if (f === 'foreColor' || f === 'hiliteColor') { e.target.previousElementSibling.style.setProperty('--c', e.target.value); exec(f, e.target.value, f === 'foreColor' ? 'Coloured text' : 'Highlighted text'); }
      if (f === 'font' || f === 'size') e.target.value = '';
    });
    b.addEventListener('keydown', (e) => e.stopPropagation());
    bar.el = b;
    syncBar();
  }
  function syncBar() {
    const b = bar.el, doc = frameDoc(), c = g()?.getEditing();
    if (!b || !doc || !c) return;
    const blk = $('[data-f=block]', b);
    blk.value = BLOCK_TAGS.some(([v]) => v === tagOf(c)) ? tagOf(c) : 'div';
    for (const x of ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList']) { let on = false; try { on = doc.queryCommandState(x); } catch (_) {} $(`[data-x=${x}]`, b)?.setAttribute('aria-pressed', on); }
  }
  async function splitOnEnter(e) {
    const ed = g(), c = ed.getEditing();
    if (!c || !/^(p|h[1-6]|li|blockquote|div)$/.test(tagOf(c)) || c === ed.getWrapper()) return false;
    const el = c.view.getChildrenContainer(), doc = el.ownerDocument, s = doc.getSelection();
    if (!s?.rangeCount) return false;
    e.preventDefault();
    const r = s.getRangeAt(0);
    r.deleteContents();
    const tail = doc.createRange();
    tail.setStart(r.endContainer, r.endOffset);
    tail.setEnd(el, el.childNodes.length);
    const box = doc.createElement('div');
    box.append(tail.extractContents());
    const rest = box.innerHTML.replace(/\sdata-(gjs-[\w-]+|lime-src)="[^"]*"/g, '');
    if (!el.innerHTML.trim()) el.innerHTML = '<br>';
    await c.view.disableEditing?.();
    const tag = tagOf(c) === 'li' ? 'li' : 'p', parent = c.parent();
    const [n] = [].concat(parent.append(`<${tag}>${rest.replace(/<br\s*\/?>$/, '') || '<br>'}</${tag}>`, { at: c.index() + 1 }));
    changed('Started a new paragraph');
    if (!n) return true;
    ed.select(n);
    setTimeout(() => { n.trigger('active'); const ne = n.view?.getChildrenContainer?.(); const sel2 = ne?.ownerDocument.getSelection(); if (ne && sel2) { const rr = ne.ownerDocument.createRange(); rr.setStart(ne, 0); rr.collapse(true); sel2.removeAllRanges(); sel2.addRange(rr); ne.focus(); } }, 30);
    return true;
  }
  function frameKeys(e) {
    const ed = g();
    if (!ed?.getEditing()) return false;
    const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (c && k === 'k') { e.preventDefault(); linkPrompt(); return true; }
    if (e.key === 'Enter' && !e.shiftKey && !c) { splitOnEnter(e); return true; }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); frameDoc().execCommand('insertLineBreak'); changed('Added a line break'); return true; }
    if (c && ['b', 'i', 'u'].includes(k)) { setTimeout(() => { semantic(); changed({ b: 'Made text bold', i: 'Made text italic', u: 'Underlined text' }[k]); syncBar(); }, 0); return false; }
    return false;
  }

  async function wrapIn(tag) {
    const c = sel();
    if (!c || c === g().getWrapper()) return;
    const html = `<${tag}>${c.toHTML(E.htmlOpts())}</${tag}>`;
    const [n] = [].concat(c.replaceWith(html));
    if (n) g().select(n);
    changed(`Wrapped ${nameOf2(c)} in a ${tag}`);
  }
  async function editTag() {
    const c = sel();
    if (!c || c === g().getWrapper()) return;
    const v = await ask(`Edit ${c.getName()}`, [{ key: 'html', label: 'HTML', kind: 'area', rows: 8, value: c.toHTML(E.htmlOpts()) }], 'Apply');
    if (!v || !v.html.trim()) return;
    const [n] = [].concat(c.replaceWith(v.html));
    if (n) g().select(n);
    changed(`Edited the tag of ${nameOf2(c)}`);
  }
  async function pastePlain() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (_) {}
    if (!text) { toast('There is no text to paste.'); return; }
    if (g().getEditing()?.view?.rteEnabled) { frameDoc().execCommand('insertText', false, text); changed('Pasted text'); return; }
    insertHtml(text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n'), 'Pasted text');
  }
  function contextMenu(e, c) {
    e.preventDefault();
    const ed = g();
    if (c && c !== ed.getSelected()) ed.select(c);
    const fr = ed.Canvas.getFrameEl().getBoundingClientRect();
    const at = { x: fr.left + e.clientX, y: fr.top + e.clientY };
    const none = !sel() || sel() === ed.getWrapper();
    menu(at, [['cut', 'Cut', 'extract', none, 'Ctrl X'], ['copy', 'Copy', 'copy', none, 'Ctrl C'], ['paste', 'Paste', 'docAdd', false, 'Ctrl V'], ['plain', 'Paste as plain text', 'text'], '-', ['dup', 'Duplicate', 'copy', none], ['del', 'Delete', 'delete', none, 'Del'], '-', ['parent', 'Select parent', 'up', none || sel().parent() === ed.getWrapper()], ['wrap', 'Wrap in Div', 'square', none], ['tag', 'Edit tag…', 'code', none], ['inspect', 'Inspect in code', 'search', none]], (id) => {
      const s = sel();
      if (id === 'copy') ed.runCommand('core:copy');
      if (id === 'cut') { ed.runCommand('core:copy'); const n = nameOf2(s); s.remove(); changed(`Cut ${n}`); }
      if (id === 'paste') { ed.runCommand('core:paste'); changed('Pasted'); }
      if (id === 'plain') pastePlain();
      if (id === 'dup') { const [n] = [].concat(s.parent().append(s.clone(), { at: s.index() + 1 })); if (n) ed.select(n); changed(`Duplicated ${nameOf2(s)}`); }
      if (id === 'del') { const n = nameOf2(s); s.remove(); changed(`Deleted ${n}`); }
      if (id === 'parent') ed.select(s.parent());
      if (id === 'wrap') wrapIn('div');
      if (id === 'tag') editTag();
      if (id === 'inspect') E.inspect(s);
    });
  }

  function hookFrame() {
    const ed = g(), doc = frameDoc(), win = frameWin();
    if (!doc || doc.__webHooked) return;
    doc.__webHooked = true;
    win.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }, true);
    win.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); e.stopPropagation(); dropFiles(e.dataTransfer.files, compAt(doc.elementFromPoint(e.clientX, e.clientY))).then((ok) => { if (!ok) toast('Only pictures can be dropped on the page.'); }); }, true);
    doc.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.some((f) => /^image\//.test(f.type))) { e.preventDefault(); e.stopPropagation(); dropFiles(files, sel()); } }, true);
    doc.addEventListener('contextmenu', (e) => contextMenu(e, compAt(e.target)), true);
    doc.addEventListener('selectionchange', () => { if (ed.getEditing()) { saveRange(); syncBar(); } });
    doc.addEventListener('keydown', (e) => { if (frameKeys(e)) e.stopPropagation(); }, true);
  }

  async function watermark() {
    const ed = g(), c = sel(), img = c && tagOf(c) === 'img' ? c : null;
    const v = await new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog wide"><div class="body"><h2>Watermark</h2><div class="dlg"><div class="dlgform">
        <div class="seg full" data-k="kind"><button class="tb" data-v="text" aria-pressed="true">Text</button><button class="tb" data-v="image" aria-pressed="false">Picture</button></div>
        <label data-for="text"><span class="label">Text</span><input class="input" data-f="text" value="DRAFT" spellcheck="false"></label>
        <div class="we-pick" data-for="image" hidden><input class="input" data-f="image" placeholder="Choose a picture" readonly><button class="btn" data-a="pickmark">Choose…</button></div>
        <div class="row2"><label><span class="label">Opacity</span><div class="range"><input type="range" min="5" max="100" value="18" data-f="opacity"><output>18%</output></div></label><label><span class="label">Angle</span><div class="range"><input type="range" min="-90" max="90" value="30" data-f="angle"><output>30°</output></div></label></div>
        <div class="row2"><label><span class="label">Size</span><div class="range"><input type="range" min="10" max="200" value="64" data-f="size"><output>64</output></div></label><label data-for="text"><span class="label">Colour</span><div class="row"><input type="color" data-f="color" value="#000000"></div></label></div>
        <div class="mlabel">Position</div><div class="seg full we-pos" data-k="position">${POSITIONS.map(([v, l]) => `<button class="tb" data-v="${v}" aria-pressed="${v === 'centre'}">${l}</button>`).join('')}</div>
        <div class="mlabel">On</div><div class="seg full" data-k="scope"><button class="tb" data-v="page" aria-pressed="${!img}">Whole page</button><button class="tb" data-v="image" aria-pressed="${!!img}" ${img ? '' : 'disabled'}>Selected picture</button></div>
        <label class="row" data-for="burn"><input type="checkbox" data-f="burn"> Burn into the picture file (a watermarked copy replaces it on the page)</label>
      </div><div class="dlgpreview"><div class="pvimg we-markpv"></div><small class="muted">Written as CSS: an overlay that ignores clicks.</small></div></div></div>
      <div class="foot"><button class="btn danger" data-a="remove">Remove watermark</button><span class="grow"></span><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">Add watermark</button></div></div></div>`);
      const val = { kind: 'text', position: 'centre', scope: img ? 'image' : 'page' };
      const read = () => { for (const i of $$('[data-f]', s)) val[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.type === 'range' ? Number(i.value) : i.value; };
      const paint = () => {
        read();
        $$('[data-for=text]', s).forEach((x) => { x.hidden = val.kind !== 'text'; });
        $$('[data-for=image]', s).forEach((x) => { x.hidden = val.kind !== 'image'; });
        $('[data-for=burn]', s).hidden = val.scope !== 'image';
        $$('.range', s).forEach((r) => { const i = $('input', r); $('output', r).textContent = `${i.value}${i.dataset.f === 'opacity' ? '%' : i.dataset.f === 'angle' ? '°' : ''}`; });
        $('.we-markpv', s).innerHTML = `<div class="we-markbox">${overlayHtml(val, true)}</div>`;
      };
      s.addEventListener('input', paint);
      s.addEventListener('click', async (e) => {
        const sb = e.target.closest('[data-k] [data-v]');
        if (sb && !sb.disabled) { const k = sb.closest('[data-k]').dataset.k; val[k] = sb.dataset.v; $$('[data-v]', sb.parentElement).forEach((x) => x.setAttribute('aria-pressed', x === sb)); paint(); return; }
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'pickmark') { const [f] = await api.invoke('dialog:open', { multi: false, filters: [{ name: 'Pictures', extensions: IMAGE_EXT }] }); if (f) { $('[data-f=image]', s).value = f; paint(); } return; }
        if (a === 'no' || e.target === s) { s.remove(); resolve(null); }
        if (a === 'remove') { s.remove(); resolve({ remove: true }); }
        if (a === 'ok') { read(); s.remove(); resolve(val); }
      });
      s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { s.remove(); resolve(null); } });
      document.body.append(s);
      paint();
    });
    if (!v) return;
    if (v.remove) return removeWatermark();
    if (v.kind === 'image' && !v.image) { toast('Choose the picture for the watermark.'); return; }
    if (v.kind === 'image') v.src = E.relPath(st.dir, await call('copyInto', v.image, st.dir));
    if (v.scope === 'image' && img && v.burn) {
      const abs = absOf(img.get('src') || img.getAttributes().src);
      if (!abs) { toast('This picture isn’t a file in the site, so it can’t be burned.'); return; }
      const out = await E.busy('Burning the watermark…', () => call('burnWatermark', abs, { ...v, opacity: v.opacity, color: v.color || '#ffffff', position: v.position === 'centre' ? 'center' : v.position }));
      if (out) { img.set('src', E.relPath(st.dir, out)); changed('Burned a watermark into the picture'); }
      return;
    }
    if (v.scope === 'image' && img) {
      const html = `<span class="webcraft-watermark-wrap" style="position: relative; display: inline-block;">${img.toHTML(E.htmlOpts())}${overlayHtml(v, false, 'absolute')}</span>`;
      const [n] = [].concat(img.replaceWith(html));
      if (n) ed.select(n);
      changed('Added a watermark to the picture');
      return;
    }
    for (const old of ed.getWrapper().find('.webcraft-watermark')) old.remove();
    const [n] = [].concat(ed.getWrapper().append(overlayHtml(v, false, 'fixed')));
    if (n) ed.select(n);
    changed('Added a watermark to the page');
  }
  function overlayHtml(v, preview, pos = 'fixed') {
    const op = (Number(v.opacity) || 18) / 100, angle = Number(v.angle) || 0, size = Number(v.size) || 64, colour = v.color || '#000000';
    const align = { centre: ['center', 'center'], 'top-left': ['flex-start', 'flex-start'], 'top-right': ['flex-start', 'flex-end'], 'bottom-left': ['flex-end', 'flex-start'], 'bottom-right': ['flex-end', 'flex-end'] }[v.position] || ['center', 'center'];
    const imgSrc = v.kind === 'image' ? (preview ? E.mediaUrl(v.image || '') : v.src) : '';
    const box = `position: ${preview ? 'absolute' : pos}; inset: 0; pointer-events: none; z-index: 2147483000; overflow: hidden; opacity: ${op}`;
    if (v.position === 'tiled') {
      const bg = v.kind === 'image' ? `url("${imgSrc}")` : `url("data:image/svg+xml,${encodeURIComponent(svgText(v.text || '', Math.round(size * (preview ? 0.4 : 1)), colour, angle))}")`;
      return `<div class="webcraft-watermark" aria-hidden="true" style="${box}; background-image: ${bg}; background-repeat: repeat; background-size: ${v.kind === 'image' ? `${preview ? Math.round(size * 0.6) : size * 2}px auto` : 'auto'};"></div>`;
    }
    const inner = v.kind === 'image' ? `<img src="${esc(imgSrc)}" alt="" style="width: ${preview ? Math.round(size * 0.8) : size * 3}px; height: auto; transform: rotate(${-angle}deg);">` : `<span style="transform: rotate(${-angle}deg); font: 700 ${preview ? Math.round(size * 0.4) : size}px/1 Helvetica, Arial, sans-serif; color: ${colour}; white-space: nowrap;">${esc(v.text || '')}</span>`;
    return `<div class="webcraft-watermark" aria-hidden="true" style="${box}; display: flex; align-items: ${align[0]}; justify-content: ${align[1]}; padding: 4%;">${inner}</div>`;
  }
  function removeWatermark() {
    const ed = g();
    let n = 0;
    for (const w of ed.getWrapper().find('.webcraft-watermark-wrap')) { const kids = w.components().filter((k) => !String(k.getAttributes().class || '').includes('webcraft-watermark')); const at = w.index(), p = w.parent(); for (const k of kids.reverse()) p.append(k.toHTML(E.htmlOpts()), { at }); w.remove(); n++; }
    for (const w of ed.getWrapper().find('.webcraft-watermark')) { w.remove(); n++; }
    if (n) changed('Removed the watermark'); else toast('There is no watermark on this page.');
  }

  const row = (label, ctl, set) => `<div class="we-row${set ? ' set' : ''}"><label>${esc(label)}</label>${ctl}</div>`;
  const inp = (k, v, ph = '', type = 'text') => `<input class="input" data-insp="${k}" type="${type}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" spellcheck="false">`;
  const selectCtl = (k, choices, v) => `<select class="input" data-insp="${k}">${choices.map(([x, l]) => `<option value="${esc(x)}" ${String(x) === String(v ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const segCtl = (k, choices, v) => `<div class="seg" data-inspseg="${k}">${choices.map(([x, l, ic]) => `<button class="tb${ic ? ' icon' : ''}" data-v="${esc(x)}" title="${esc(l)}" aria-pressed="${String(x) === String(v ?? '')}">${ic ? icon(ic, 'sm') : esc(l)}</button>`).join('')}</div>`;
  const btns = (list) => `<div class="we-btns">${list.map(([a, l, ic, off]) => `<button class="btn" data-insa="${a}" ${off ? 'disabled' : ''}>${ic ? icon(ic, 'sm') : ''}${esc(l)}</button>`).join('')}</div>`;
  const linkOf = (c) => (tagOf(c.parent()) === 'a' ? c.parent() : tagOf(c) === 'a' ? c : c.components().length === 1 && tagOf(c.components().at(0)) === 'a' ? c.components().at(0) : null);
  const cellCtx = (c) => { const el = c.getEl(); const tr = el?.closest('tr'), table = el?.closest('table'); return tr && table ? { r: [...table.rows].indexOf(tr), col: el.cellIndex, table } : null; };
  const tableOf = (c) => { for (let x = c; x; x = x.parent()) if (tagOf(x) === 'table') return x; return null; };
  function inspector(pane) {
    const c = sel();
    if (!c || c === g().getWrapper()) { pane.innerHTML = '<h3>Properties</h3><p class="tip">Select something on the page to see its properties: link, alt text, size, table rows and more.</p>'; return; }
    const tag = tagOf(c), a = c.getAttributes() || {}, st2 = c.getStyle() || {}, out = [`<h3>${esc(c.getName())}</h3>`];
    const lk = linkOf(c);
    const common = () => [row('Class', inp('class', a.class, 'Optional')), row('Id', inp('id', a.id, 'Optional'))];
    if (tag === 'img') {
      const w = a.width || parseInt(st2.width, 10) || '', hgt = a.height || parseInt(st2.height, 10) || '', el = c.getEl();
      out.push(btns([['replace', 'Replace…', 'image'], ['fromsite', 'From site…', 'grid'], ['editlime', 'Edit in Lime', 'sliders']]),
        row('Alt text', inp('alt', a.alt, 'Describe the picture'), !!a.alt),
        row('Width', `<div class="we-size">${inp('width', w, el?.naturalWidth ? String(el.naturalWidth) : '', 'number')}<button class="tb icon" data-insa="lock" title="Keep the proportions" aria-pressed="${st.lockRatio !== false}">${icon('lock', 'sm')}</button></div>`, !!w),
        row('Height', `<div class="we-size">${inp('height', hgt, el?.naturalHeight ? String(el.naturalHeight) : '', 'number')}<button class="tb icon" data-insa="resetsize" title="Reset size">${icon('again', 'sm')}</button></div>`, !!hgt),
        row('Link', inp('imglink', lk?.getAttributes().href, 'https://… or page.html'), !!lk),
        row('Align', segCtl('imgalign', [['', 'As it is', 'textT'], ['left', 'Left', 'alignLeft'], ['center', 'Centre', 'alignCenter'], ['right', 'Right', 'alignRight']], st2.float === 'left' ? 'left' : st2.float === 'right' ? 'right' : st2['margin-left'] === 'auto' ? 'center' : '')),
        row('Border', inp('imgborder', parseInt(st2['border-width'] || st2.border, 10) || '', '0', 'number'), !!st2.border),
        btns([['crop', 'Crop…', 'crop'], ['rotate', 'Rotate', 'rotate'], ['watermark', 'Watermark…', 'stamp']]), ...common());
    } else if (tag === 'a') {
      out.push(row('Link', `<div class="we-pick">${inp('href', a.href, 'https://… or page.html')}<button class="btn" data-insa="browse">Browse…</button></div>`, !!a.href),
        row('Opens in', selectCtl('target', [['', 'Same tab'], ['_blank', 'New tab'], ['_parent', 'Parent frame'], ['_top', 'Whole window']], a.target)),
        row('Tooltip', inp('title', a.title, 'Optional')), ...common());
    } else if (tag === 'table') {
      const el = c.getEl(), rows = el?.rows.length || 0, cols = Math.max(0, ...[...(el?.rows || [])].map((r) => [...r.cells].reduce((s, x) => s + (x.colSpan || 1), 0)));
      out.push(row('Rows', inp('rows', rows, '', 'number')), row('Columns', inp('cols', cols, '', 'number')),
        row('Header row', segCtl('thead', [['no', 'No'], ['yes', 'Yes']], el?.tHead ? 'yes' : 'no')),
        row('Cell padding', inp('cellpadding', a.cellpadding, '0', 'number'), !!a.cellpadding), row('Cell spacing', inp('cellspacing', a.cellspacing, '0', 'number'), !!a.cellspacing),
        row('Width', inp('twidth', a.width || st2.width, 'auto'), !!(a.width || st2.width)), row('Border', inp('border', a.border, '0', 'number'), !!a.border), ...common());
    } else if (tag === 'td' || tag === 'th') {
      const cx = cellCtx(c);
      out.push(btns([['rowabove', 'Row above', 'up'], ['rowbelow', 'Row below', 'down'], ['colleft', 'Column left', 'back'], ['colright', 'Column right', 'chevron']]),
        btns([['mergeright', 'Merge right', 'outdent'], ['mergedown', 'Merge down', 'down'], ['split', 'Split', 'split', !((c.getEl()?.colSpan || 1) > 1 || (c.getEl()?.rowSpan || 1) > 1)]]),
        btns([['delrow', 'Delete row', 'delete'], ['delcol', 'Delete column', 'delete'], ['seltable', 'Select table', 'grid']]),
        row('Align', segCtl('cellalign', [['', 'As it is', 'textT'], ['left', 'Left', 'alignLeft'], ['center', 'Centre', 'alignCenter'], ['right', 'Right', 'alignRight']], st2['text-align'] || '')),
        row('Background', `<div class="we-colour"><label class="sw" style="background:${esc(st2['background-color'] || 'transparent')}"><input type="color" data-insp="cellbg" value="${/^#[0-9a-f]{6}$/i.test(st2['background-color'] || '') ? st2['background-color'] : '#ffffff'}"></label>${inp('cellbg', st2['background-color'], 'None')}</div>`, !!st2['background-color']),
        `<p class="tip">Row ${cx ? cx.r + 1 : '?'}, column ${cx ? cx.col + 1 : '?'}.</p>`, ...common());
    } else if (['video', 'audio', 'iframe'].includes(tag)) {
      out.push(row('Source', `<div class="we-pick">${inp('src', c.get('src') || a.src, 'https://… or file')}${tag === 'iframe' ? '' : `<button class="btn" data-insa="browsemedia">Browse…</button>`}</div>`), row('Width', inp('width', a.width, 'auto', 'number')), row('Height', inp('height', a.height, 'auto', 'number')), ...common());
    } else if (['input', 'textarea', 'select', 'button', 'form', 'label'].includes(tag)) {
      if (tag === 'form') out.push(row('Send to', inp('action', a.action, 'Address that receives it')), row('Method', selectCtl('method', [['get', 'GET'], ['post', 'POST']], a.method || 'get')));
      if (tag === 'input') out.push(row('Kind', selectCtl('type', [['text', 'Text'], ['email', 'E-mail'], ['tel', 'Phone'], ['number', 'Number'], ['date', 'Date'], ['checkbox', 'Tick box'], ['radio', 'Choice'], ['password', 'Password'], ['submit', 'Send button']], a.type || 'text')));
      if (tag === 'button') out.push(row('Kind', selectCtl('type', [['submit', 'Send the form'], ['button', 'Plain button'], ['reset', 'Clear the form']], a.type || 'submit')));
      if (['input', 'textarea', 'select'].includes(tag)) out.push(row('Name', inp('name', a.name, 'Sent with the form')), row('Required', segCtl('required', [['', 'No'], ['true', 'Yes']], a.required ? 'true' : '')));
      if (['input', 'textarea'].includes(tag)) out.push(row('Placeholder', inp('placeholder', a.placeholder, 'Optional')));
      out.push(...common());
    } else {
      out.push(row('Format', selectCtl('format', [...BLOCK_TAGS, ...(BLOCK_TAGS.some(([x]) => x === tag) ? [] : [[tag, `<${tag}>`]])], tag)),
        row('Link', inp('textlink', lk?.getAttributes().href, 'https://… or page.html'), !!lk), row('Opens in', selectCtl('linktarget', [['', 'Same tab'], ['_blank', 'New tab']], lk?.getAttributes().target), false), ...common(),
        `<p class="tip">Double-click the text on the page to type. The format bar has bold, lists, links and more.</p>`);
    }
    out.push(`<div class="we-btns">${tableOf(c) && tag !== 'table' ? '' : ''}<button class="btn" data-insa="inspect">${icon('search', 'sm')}Show in code</button></div>`);
    pane.innerHTML = out.join('');
  }
  function setAttr(c, k, v, why) {
    const val = String(v ?? '').trim();
    if (val) c.addAttributes({ [k]: val }); else c.removeAttributes(k);
    changed(why || `Changed the ${k} of ${nameOf2(c)}`);
  }
  function setLink(c, href, target) {
    const lk = linkOf(c);
    const val = String(href ?? '').trim();
    if (lk) {
      if (!val && lk !== c) { const at = lk.index(), p = lk.parent(); const inner = lk.components().map((k) => k.toHTML(E.htmlOpts())).join(''); lk.remove(); p.append(inner, { at }); changed(`Removed the link from ${nameOf2(c)}`); return; }
      if (val) lk.addAttributes({ href: val }); if (target != null) { if (target) lk.addAttributes({ target }); else lk.removeAttributes('target'); }
      changed(`Changed the link of ${nameOf2(c)}`);
      return;
    }
    if (!val) return;
    if (tagOf(c) === 'img') { const [n] = [].concat(c.replaceWith(`<a href="${esc(val)}"${target ? ` target="${esc(target)}"` : ''}>${c.toHTML(E.htmlOpts())}</a>`)); if (n) g().select(n.components().at(0) || n); } else c.components(`<a href="${esc(val)}"${target ? ` target="${esc(target)}"` : ''}>${c.getInnerHTML(E.htmlOpts())}</a>`);
    changed(`Linked ${nameOf2(c)}`);
  }
  async function tableEdit(c, fn, why) {
    const tbl = tableOf(c);
    if (!tbl) return;
    const cx = c !== tbl ? cellCtx(c) : null, t = document.createElement('template');
    t.innerHTML = tbl.toHTML(E.htmlOpts());
    const table = t.content.querySelector('table');
    const focus = fn(table, cx) || cx;
    const [nt] = [].concat(tbl.replaceWith(table.outerHTML));
    if (!nt) return;
    E.nameAll?.(nt);
    if (focus && c !== tbl) { const el = nt.getEl()?.rows[focus.r]?.cells[Math.min(focus.col, (nt.getEl()?.rows[focus.r]?.cells.length || 1) - 1)]; const nc = el && nt.find('td, th').find((x) => x.getEl() === el); g().select(nc || nt); } else g().select(nt);
    changed(why);
  }
  const newCell = (doc, like) => { const td = doc.createElement(like?.tagName?.toLowerCase() === 'th' ? 'th' : 'td'); td.innerHTML = '&nbsp;'; return td; };
  function addRow(table, at, like) { const src = table.rows[Math.min(like, table.rows.length - 1)]; const tr = (src || table).ownerDocument.createElement('tr'); const n = src ? [...src.cells].reduce((s, x) => s + (x.colSpan || 1), 0) : 1; for (let i = 0; i < n; i++) tr.append(newCell(table.ownerDocument, src && src.parentElement.tagName === 'THEAD' ? null : src?.cells[0])); const ref = table.rows[at]; if (ref && ref.parentElement.tagName !== 'THEAD') ref.before(tr); else if (ref) (table.tBodies[0] || table).prepend(tr); else (table.tBodies[table.tBodies.length - 1] || table).append(tr); }
  function setRows(table, n) { n = Math.max(1, Math.min(500, n)); while (table.rows.length < n) addRow(table, table.rows.length, table.rows.length - 1); while (table.rows.length > n) table.rows[table.rows.length - 1].remove(); }
  function setCols(table, n) { n = Math.max(1, Math.min(50, n)); for (const r of table.rows) { let have = [...r.cells].reduce((s, x) => s + (x.colSpan || 1), 0); while (have < n) { r.append(newCell(table.ownerDocument, r.cells[r.cells.length - 1])); have++; } while (have > n && r.cells.length) { const last = r.cells[r.cells.length - 1]; if ((last.colSpan || 1) > 1) last.colSpan--; else last.remove(); have--; } } }
  function setHead(table, on) {
    if (on && !table.tHead) { const first = table.rows[0]; if (!first) return; const th = table.createTHead(); const tr = table.ownerDocument.createElement('tr'); for (const cell of [...first.cells]) { const x = table.ownerDocument.createElement('th'); x.innerHTML = cell.innerHTML; for (const at of cell.attributes) x.setAttribute(at.name, at.value); tr.append(x); } th.append(tr); first.remove(); }
    if (!on && table.tHead) { const rows = [...table.tHead.rows]; const body = table.tBodies[0] || table.createTBody(); for (const r of rows.reverse()) { const tr = table.ownerDocument.createElement('tr'); for (const cell of [...r.cells]) { const x = table.ownerDocument.createElement('td'); x.innerHTML = cell.innerHTML; tr.append(x); } body.prepend(tr); } table.deleteTHead(); }
  }
  async function cropImage(c) {
    const abs = absOf(c.get('src') || c.getAttributes().src);
    if (!abs) { toast('This picture isn’t a file in the site.'); return; }
    const box = await new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog wide"><div class="body"><h2>Crop picture</h2><div class="seg" data-k="aspect">${[['free', 'Free'], ['1', '1:1'], ['1.3333', '4:3'], ['1.7778', '16:9']].map(([v, l]) => `<button class="tb" data-v="${v}" aria-pressed="${v === 'free'}">${l}</button>`).join('')}</div><div class="we-cropwrap"><img src="${esc(E.mediaUrl(abs))}" alt=""><div class="we-cropbox"></div></div></div><div class="foot"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">Crop</button></div></div></div>`);
      document.body.append(s);
      const img = $('img', s), bx = $('.we-cropbox', s);
      let r = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, aspect = 0;
      const draw = () => Object.assign(bx.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
      const fit = () => { if (!aspect || !img.naturalWidth) return; const ia = img.naturalWidth / img.naturalHeight; let w = r.w, hh = (w * ia) / aspect; if (hh > 1 - r.y) { hh = 1 - r.y; w = (hh * aspect) / ia; } r.w = w; r.h = hh; };
      draw();
      $('.we-cropwrap', s).addEventListener('pointerdown', (e) => {
        const b = img.getBoundingClientRect(), x0 = (e.clientX - b.left) / b.width, y0 = (e.clientY - b.top) / b.height;
        const move = (ev) => { const x1 = Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)), y1 = Math.min(1, Math.max(0, (ev.clientY - b.top) / b.height)); r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(0.01, Math.abs(x1 - x0)), h: Math.max(0.01, Math.abs(y1 - y0)) }; fit(); draw(); };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        e.preventDefault();
      });
      s.addEventListener('click', (e) => { const sb = e.target.closest('[data-k] [data-v]'); if (sb) { aspect = sb.dataset.v === 'free' ? 0 : Number(sb.dataset.v); $$('[data-v]', sb.parentElement).forEach((x) => x.setAttribute('aria-pressed', x === sb)); fit(); draw(); return; } const a = e.target.closest('[data-a]')?.dataset.a; if (a) { s.remove(); resolve(a === 'ok' ? r : null); } });
      s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { s.remove(); resolve(null); } });
    });
    if (!box) return;
    const out = await E.busy('Cropping…', () => call('imageOp', abs, 'crop', box));
    if (out) { c.set('src', E.relPath(st.dir, out)); c.removeAttributes(['width', 'height']); changed(`Cropped ${nameOf(abs)}`); E.drawPanels(); }
  }
  const watching = new Map();
  function editInLime(c) {
    const abs = absOf(c.get('src') || c.getAttributes().src);
    if (!abs) { toast('This picture isn’t a file in the site.'); return; }
    api.invoke('editor:open', abs, 'image');
    const dot = abs.lastIndexOf('.'), edited = `${abs.slice(0, dot)} (edited)${abs.slice(dot)}`;
    clearInterval(watching.get(c.cid));
    let seen = null, n = 0;
    call('stat', edited).then((s0) => { seen = s0?.mtime || 0; });
    watching.set(c.cid, setInterval(async () => {
      if (++n > 900 || st.disposed) { clearInterval(watching.get(c.cid)); return; }
      const s1 = await call('stat', edited).catch(() => null);
      if (!s1 || seen == null || s1.mtime === seen) return;
      seen = s1.mtime;
      c.set('src', E.relPath(st.dir, edited));
      const el = c.getEl();
      if (el) el.src = `${E.mediaUrl(edited)}?v=${seen}`;
      changed(`Updated ${nameOf(abs)} from the image editor`);
      toast(`Updated the picture from ${nameOf(edited)}`, { type: 'success' });
    }, 2000));
    tip('Edit the picture, then Save: the page picks up the edited copy.');
  }
  async function inspectorAction(a, c) {
    if (a === 'replace') { const [f] = await api.invoke('dialog:open', { multi: false, filters: [{ name: 'Pictures', extensions: IMAGE_EXT }] }); if (f) { c.set('src', await imageFile(f)); changed(`Replaced the picture with ${nameOf(f)}`); E.drawPanels(); } }
    if (a === 'fromsite') { const f = await pickSiteImage(); if (f) { c.set('src', E.relPath(st.dir, f)); changed(`Replaced the picture with ${nameOf(f)}`); E.drawPanels(); } }
    if (a === 'editlime') editInLime(c);
    if (a === 'lock') { st.lockRatio = st.lockRatio === false; E.drawPanels(); }
    if (a === 'resetsize') { c.removeAttributes(['width', 'height']); c.removeStyle('width'); c.removeStyle('height'); changed(`Reset the size of ${nameOf2(c)}`); E.drawPanels(); }
    if (a === 'crop') cropImage(c);
    if (a === 'rotate') { const abs = absOf(c.get('src') || c.getAttributes().src); if (!abs) return toast('This picture isn’t a file in the site.'); const out = await E.busy('Turning…', () => call('imageOp', abs, 'rotate', { angle: 90 })); if (out) { c.set('src', E.relPath(st.dir, out)); const at = c.getAttributes(); if (at.width && at.height) c.addAttributes({ width: at.height, height: at.width }); changed(`Turned ${nameOf(abs)}`); E.drawPanels(); } }
    if (a === 'watermark') watermark();
    if (a === 'browse' || a === 'browsemedia') { const [f] = await api.invoke('dialog:open', { multi: false }); if (f) { if (a === 'browse') setAttr(c, 'href', E.relPath(st.dir, f), `Linked to ${nameOf(f)}`); else { c.set('src', E.relPath(st.dir, await call('copyInto', f, st.dir))); changed(`Changed the source of ${nameOf2(c)}`); } E.drawPanels(); } }
    if (a === 'inspect') E.inspect(c);
    const ops = {
      rowabove: (t, cx) => { addRow(t, cx.r, cx.r); return { r: cx.r, col: cx.col }; }, rowbelow: (t, cx) => { addRow(t, cx.r + 1, cx.r); return { r: cx.r + 1, col: cx.col }; },
      colleft: (t, cx) => { for (const r of t.rows) { const ref = r.cells[Math.min(cx.col, r.cells.length - 1)]; ref ? ref.before(newCell(t.ownerDocument, ref)) : r.append(newCell(t.ownerDocument)); } return cx; },
      colright: (t, cx) => { for (const r of t.rows) { const ref = r.cells[Math.min(cx.col, r.cells.length - 1)]; ref ? ref.after(newCell(t.ownerDocument, ref)) : r.append(newCell(t.ownerDocument)); } return { r: cx.r, col: cx.col + 1 }; },
      delrow: (t, cx) => { if (t.rows.length > 1) t.rows[cx.r].remove(); return { r: Math.max(0, cx.r - 1), col: cx.col }; },
      delcol: (t, cx) => { for (const r of t.rows) { const x = r.cells[Math.min(cx.col, r.cells.length - 1)]; if (r.cells.length > 1 && x) { if ((x.colSpan || 1) > 1) x.colSpan--; else x.remove(); } } return { r: cx.r, col: Math.max(0, cx.col - 1) }; },
      mergeright: (t, cx) => { const cell = t.rows[cx.r].cells[cx.col], next = t.rows[cx.r].cells[cx.col + 1]; if (next) { cell.innerHTML = `${cell.innerHTML.replace(/&nbsp;$/, '')} ${next.innerHTML.replace(/^&nbsp;$/, '')}`.trim() || '&nbsp;'; cell.colSpan = (cell.colSpan || 1) + (next.colSpan || 1); next.remove(); } return cx; },
      mergedown: (t, cx) => { const cell = t.rows[cx.r].cells[cx.col], below = t.rows[cx.r + (cell.rowSpan || 1)]?.cells[cx.col]; if (below) { cell.innerHTML = `${cell.innerHTML} ${below.innerHTML.replace(/^&nbsp;$/, '')}`.trim(); cell.rowSpan = (cell.rowSpan || 1) + (below.rowSpan || 1); below.remove(); } return cx; },
      split: (t, cx) => { const cell = t.rows[cx.r].cells[cx.col]; if ((cell.colSpan || 1) > 1) { cell.colSpan--; if (cell.colSpan === 1) cell.removeAttribute('colspan'); cell.after(newCell(t.ownerDocument, cell)); } else if ((cell.rowSpan || 1) > 1) { const below = t.rows[cx.r + cell.rowSpan - 1]; cell.rowSpan--; if (cell.rowSpan === 1) cell.removeAttribute('rowspan'); const ref = below?.cells[cx.col]; ref ? ref.before(newCell(t.ownerDocument, cell)) : below?.append(newCell(t.ownerDocument, cell)); } return cx; },
    };
    const label = { rowabove: 'Added a row above', rowbelow: 'Added a row below', colleft: 'Added a column on the left', colright: 'Added a column on the right', delrow: 'Deleted a row', delcol: 'Deleted a column', mergeright: 'Merged cells', mergedown: 'Merged cells', split: 'Split a cell' };
    if (ops[a]) await tableEdit(c, ops[a], label[a]);
    if (a === 'seltable') g().select(tableOf(c));
  }
  async function inspectorChange(k, v, c) {
    const tag = tagOf(c);
    if (k === 'format') return setBlock(v);
    if (k === 'textlink' || k === 'imglink') return setLink(c, v, null);
    if (k === 'linktarget') return setLink(c, linkOf(c)?.getAttributes().href || '', v);
    if (tag === 'img' && (k === 'width' || k === 'height')) {
      const el = c.getEl(), n = Number(v) || 0, ratio = el?.naturalWidth ? el.naturalWidth / el.naturalHeight : 0;
      c.removeStyle(k);
      if (!n) c.removeAttributes(k); else c.addAttributes({ [k]: String(n) });
      if (n && ratio && st.lockRatio !== false) { const other = k === 'width' ? 'height' : 'width'; c.removeStyle(other); c.addAttributes({ [other]: String(Math.round(k === 'width' ? n / ratio : n * ratio)) }); }
      changed(`Resized ${nameOf2(c)}`);
      return E.drawPanels();
    }
    if (k === 'imgborder') { if (Number(v)) c.addStyle({ border: `${Number(v)}px solid currentColor` }); else c.removeStyle('border'); changed(`Changed the border of ${nameOf2(c)}`); return E.drawPanels(); }
    if (k === 'imgalign') { for (const p of ['float', 'display', 'margin-left', 'margin-right']) c.removeStyle(p); if (v === 'left' || v === 'right') c.addStyle({ float: v, [`margin-${v === 'left' ? 'right' : 'left'}`]: '16px' }); if (v === 'center') c.addStyle({ display: 'block', 'margin-left': 'auto', 'margin-right': 'auto' }); changed(`Aligned ${nameOf2(c)}`); return E.drawPanels(); }
    if (k === 'cellalign') { if (v) c.addStyle({ 'text-align': v }); else c.removeStyle('text-align'); changed('Aligned a cell'); return E.drawPanels(); }
    if (k === 'cellbg') { if (v) c.addStyle({ 'background-color': v }); else c.removeStyle('background-color'); changed('Coloured a cell'); return E.drawPanels(); }
    if (k === 'rows') return tableEdit(c, (t) => { setRows(t, Number(v) || 1); }, `Made the table ${Number(v) || 1} rows`);
    if (k === 'cols') return tableEdit(c, (t) => { setCols(t, Number(v) || 1); }, `Made the table ${Number(v) || 1} columns`);
    if (k === 'thead') return tableEdit(c, (t) => { setHead(t, v === 'yes'); }, v === 'yes' ? 'Made the first row a header' : 'Removed the header row');
    if (k === 'twidth') { const val = String(v || '').trim(); c.removeStyle('width'); if (val) c.addAttributes({ width: val }); else c.removeAttributes('width'); changed('Changed the table width'); return E.drawPanels(); }
    if (k === 'src') { c.set('src', String(v || '').trim()); changed(`Changed the source of ${nameOf2(c)}`); return E.drawPanels(); }
    if (k === 'required') { if (v) c.addAttributes({ required: true }); else c.removeAttributes('required'); changed(`Changed ${nameOf2(c)}`); return E.drawPanels(); }
    setAttr(c, k, v);
    E.drawPanels();
  }
  function bindInspector(pane) {
    pane.addEventListener('change', (e) => { const k = e.target.dataset.insp, c = sel(); if (k && c) inspectorChange(k, e.target.value, c); });
    pane.addEventListener('click', (e) => {
      const c = sel();
      if (!c) return;
      const a = e.target.closest('[data-insa]');
      if (a && !a.disabled) { inspectorAction(a.dataset.insa, c); return; }
      const sb = e.target.closest('[data-inspseg] [data-v]');
      if (sb) inspectorChange(sb.closest('[data-inspseg]').dataset.inspseg, sb.dataset.v, c);
    });
    pane.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input.input')) e.target.blur(); });
  }

  function cssSources() {
    const src = E.textOf(0), d = parseDoc(src), out = st.css.map((c, i) => ({ id: `css${i}`, name: nameOf(c.path), tab: i + 1, text: E.textOf(i + 1), base: 0 }));
    d.styles.forEach((x, i) => out.push({ id: `style${i}`, name: x.managed ? '<style> by WebCraft' : `<style>${d.styles.filter((y) => !y.managed).length > 1 ? ` ${i + 1}` : ''} in page`, tab: 0, text: x.text, base: x.open }));
    return out;
  }
  function writeSource(s, text, why) {
    if (s.tab) E.setCode(s.tab, text); else { const full = E.textOf(0); E.setCode(0, full.slice(0, s.base) + text + full.slice(s.base + s.text.length)); }
    st.why = why;
    E.syncFromCode(s.tab);
  }
  function matches(c, selector) {
    const el = c?.getEl?.();
    if (!el) return false;
    try { return el.matches(selector.replace(/::?(hover|focus|active|visited|focus-within|focus-visible|before|after|placeholder|first-line|first-letter|marker|selection)\b/g, '') || '*'); } catch (_) { return false; }
  }
  function cssDesigner(pane) {
    const c = sel(), srcs = cssSources();
    if (!st.cssd) st.cssd = { source: 'all', rule: null, all: false };
    const cd = st.cssd;
    const list = srcs.filter((s) => cd.source === 'all' || s.id === cd.source);
    const rules = list.flatMap((s) => parseCss(s.text).map((r, i) => ({ ...r, src: s, key: `${s.id}:${i}` }))).filter((r) => cd.all || !c || c === g()?.getWrapper() ? true : matches(c, r.selector));
    const cur = rules.find((r) => r.key === cd.rule) || null;
    pane.innerHTML = `<h3>CSS Designer</h3>
      <div class="we-cdsec"><div class="mlabel">Sources</div><div class="we-list">${[{ id: 'all', name: 'All sources' }, ...srcs].map((s) => `<button class="we-li${cd.source === s.id ? ' on' : ''}" data-cdsrc="${s.id}">${icon(s.id === 'all' ? 'layers' : s.tab ? 'code' : 'web', 'sm')}<span>${esc(s.name)}</span></button>`).join('')}</div></div>
      <div class="we-cdsec"><div class="mlabel we-cdhead">Selectors<span class="grow"></span><label class="row"><input type="checkbox" data-cdall ${cd.all ? 'checked' : ''}> All</label><button class="tb" data-cdnew title="A new rule for what is selected">${icon('add', 'sm')}New rule</button></div>
        <div class="we-list">${rules.length ? rules.map((r) => `<button class="we-li${r.key === cd.rule ? ' on' : ''}" data-cdrule="${esc(r.key)}"><code>${esc(r.selector)}</code>${r.media ? `<small>${esc(r.media.replace(/^@media\s*/, ''))}</small>` : ''}<small>${esc(r.src.name)}</small></button>`).join('') : `<p class="tip">${c && !cd.all ? 'No rule styles what is selected. Make a new one.' : 'No rules yet.'}</p>`}</div></div>
      ${cur ? `<div class="we-cdsec"><div class="mlabel">Properties of <code>${esc(cur.selector)}</code></div><div class="we-props2">${cur.decls.map((d, i) => `<div class="we-decl"><span title="${esc(d.name)}">${esc(d.name)}</span><input class="input" data-cdval="${i}" value="${esc(d.value)}" spellcheck="false"><button class="tb icon" data-cddel="${i}" title="Remove">${icon('close', 'sm')}</button></div>`).join('')}
        <div class="we-decl add"><input class="input" data-cdnewname placeholder="property" spellcheck="false" list="we-cssprops"><input class="input" data-cdnewval placeholder="value" spellcheck="false"><button class="tb icon" data-cdadd title="Add">${icon('add', 'sm')}</button></div></div></div>` : '<p class="tip">Pick a selector to see and change its properties.</p>'}`;
    st.cssdRules = rules;
  }
  function bindDesigner(pane) {
    pane.addEventListener('click', async (e) => {
      const cd = st.cssd, t = e.target;
      const s = t.closest('[data-cdsrc]');
      if (s) { cd.source = s.dataset.cdsrc; cd.rule = null; return E.drawPanels(); }
      const r = t.closest('[data-cdrule]');
      if (r) { cd.rule = r.dataset.cdrule; return E.drawPanels(); }
      const cur = st.cssdRules?.find((x) => x.key === cd.rule);
      const del = t.closest('[data-cddel]');
      if (del && cur) { const d = cur.decls[Number(del.dataset.cddel)]; writeSource(cur.src, setDecl(cur.src.text, cur, d.name, ''), `Removed ${d.name} from ${cur.selector}`); return; }
      if (t.closest('[data-cdadd]') && cur) { const n = $('[data-cdnewname]', pane).value.trim(), v = $('[data-cdnewval]', pane).value.trim(); if (n && v) writeSource(cur.src, setDecl(cur.src.text, cur, n.toLowerCase(), v), `Set ${n} in ${cur.selector}`); return; }
      if (t.closest('[data-cdnew]')) {
        const c = sel(), a = c?.getAttributes() || {}, cls = String(a.class || '').split(/\s+/).filter((x) => x && !/^gjs-/.test(x))[0];
        const guess = a.id ? `#${a.id}` : cls ? `.${cls}` : c && c !== g().getWrapper() ? tagOf(c) : 'body';
        const srcs = cssSources().filter((x) => !x.name.includes('WebCraft'));
        const v = await ask('New CSS rule', [{ key: 'selector', label: 'Selector', value: guess }, { key: 'src', label: 'Write it in', kind: 'select', choices: [...srcs.map((x) => [x.id, x.name]), ...(srcs.some((x) => !x.tab) ? [] : [['newstyle', 'A new <style> in the page']])], value: cd.source !== 'all' ? cd.source : srcs[0]?.id || 'newstyle' }], 'Create');
        if (!v?.selector.trim()) return;
        const sel2 = v.selector.trim();
        if (v.src === 'newstyle' || !srcs.length) {
          const full = E.textOf(0), i = full.search(/<\/head\s*>/i), block = `  <style>\n    ${sel2} {\n    }\n  </style>\n`;
          E.setCode(0, i >= 0 ? full.slice(0, i) + block + full.slice(i) : block + full);
          st.why = `Added the rule ${sel2}`;
          E.syncFromCode(0);
          cd.source = 'all';
          return;
        }
        const target = srcs.find((x) => x.id === v.src);
        const pad = target.tab ? '' : '    ', text = `${target.text.replace(/\s*$/, '')}\n${pad}${sel2} {\n${pad}}\n${target.tab ? '' : '  '}`;
        writeSource(target, text, `Added the rule ${sel2}`);
        const after = cssSources().find((x) => x.id === target.id);
        cd.rule = `${target.id}:${parseCss(after.text).length - 1}`;
        cd.source = target.id;
        E.drawPanels();
      }
    });
    pane.addEventListener('change', (e) => {
      const cd = st.cssd, cur = st.cssdRules?.find((x) => x.key === cd.rule);
      if (e.target.matches('[data-cdall]')) { cd.all = e.target.checked; return E.drawPanels(); }
      const i = e.target.dataset.cdval;
      if (i != null && cur) { const d = cur.decls[Number(i)]; writeSource(cur.src, setDecl(cur.src.text, cur, d.name, e.target.value.trim()), `Changed ${d.name} in ${cur.selector}`); }
    });
    pane.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input.input')) { if (e.target.matches('[data-cdnewval]')) $('[data-cdadd]', pane)?.click(); else e.target.blur(); } });
  }

  async function findReplace(initial = {}) {
    const o = { find: '', replace: '', scope: 'file', where: 'code', matchCase: false, regex: false, ...initial };
    const s = h(`<div class="scrim"><div class="dialog wide"><div class="body"><h2>Find and replace</h2><div class="dlgform">
      <div class="row2"><label><span class="label">Find</span><input class="input" data-f="find" spellcheck="false"></label><label><span class="label">Replace with</span><input class="input" data-f="replace" spellcheck="false"></label></div>
      <div class="row2"><div class="seg full" data-k="scope"><button class="tb" data-v="file">This file</button><button class="tb" data-v="site">Whole site</button></div><div class="seg full" data-k="where"><button class="tb" data-v="code">In code</button><button class="tb" data-v="text">Text only</button></div></div>
      <div class="row"><label class="row"><input type="checkbox" data-f="matchCase"> Match case</label><label class="row"><input type="checkbox" data-f="regex"> Pattern (regular expression)</label></div>
      <div class="we-results"></div></div></div>
      <div class="foot"><span class="grow muted we-count"></span><button class="btn" data-a="no">Close</button><button class="btn" data-a="all">Replace all</button><button class="btn primary" data-a="find">Find all</button></div></div></div>`);
    document.body.append(s);
    $('[data-f=find]', s).value = o.find;
    const paint = () => $$('[data-k]', s).forEach((g2) => $$('[data-v]', g2).forEach((b) => b.setAttribute('aria-pressed', o[g2.dataset.k] === b.dataset.v)));
    paint();
    const read = () => { for (const i of $$('[data-f]', s)) o[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value; return { find: o.find, replace: o.replace, matchCase: o.matchCase, regex: o.regex, textOnly: o.where === 'text' }; };
    const results = $('.we-results', s), count = $('.we-count', s);
    let hits = [];
    const run = async () => {
      const q = read();
      if (!q.find) return;
      try {
        if (o.scope === 'file') { const src = E.textOf(0); hits = (await call('findIn', src, q)).map((x) => ({ ...x, path: E.file, line: src.slice(0, x.from).split('\n').length, snippet: src.slice(src.lastIndexOf('\n', x.from - 1) + 1, (src.indexOf('\n', x.to) + 1 || src.length + 1) - 1).trim().slice(0, 160) })); } else hits = await call('siteFind', st.dir, q);
      } catch (e) { count.textContent = clean(e); return; }
      count.textContent = hits.length ? `${hits.length} found${o.scope === 'site' ? ` in ${new Set(hits.map((x) => x.path)).size} files` : ''}` : 'Nothing found';
      results.innerHTML = hits.slice(0, 300).map((x, i) => `<button class="we-hit" data-hit="${i}"><b>${esc(E.relPath(st.dir, x.path))}:${x.line}</b><span>${esc(x.snippet)}</span></button>`).join('');
    };
    const done = () => s.remove();
    s.addEventListener('click', async (e) => {
      const sb = e.target.closest('[data-k] [data-v]');
      if (sb) { o[sb.closest('[data-k]').dataset.k] = sb.dataset.v; paint(); return; }
      const hb = e.target.closest('[data-hit]');
      if (hb) { const x = hits[Number(hb.dataset.hit)]; if (x.path === E.file) { done(); E.gotoRange(x.from, x.to); } else E.openFile(x.path); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'no' || e.target === s) done();
      if (a === 'find') run();
      if (a === 'all') {
        const q = read();
        if (!q.find) return;
        if (o.scope === 'file') {
          E.flush();
          const r = await call('replaceIn', E.textOf(0), q).catch((er) => { count.textContent = clean(er); return null; });
          if (!r) return;
          if (r.count) { E.setCode(0, r.text); st.why = `Replaced ${r.count} × “${q.find}”`; E.syncFromCode(0); }
          count.textContent = r.count ? `Replaced ${r.count}` : 'Nothing found';
          results.innerHTML = '';
          return;
        }
        const files = new Set((await call('siteFind', st.dir, q).catch(() => [])).map((x) => x.path));
        files.delete(E.file);
        if (!files.size) { count.textContent = 'Nothing to replace in the other files'; return; }
        if (!(await E.confirm(`Replace in ${files.size} other ${files.size === 1 ? 'file' : 'files'}?`, 'Those files are changed in place, straight away. This page changes in the editor, to save as usual.'))) return;
        const r = await call('replaceIn', E.textOf(0), q).catch(() => null);
        if (r?.count) { E.setCode(0, r.text); st.why = `Replaced ${r.count} × “${q.find}”`; E.syncFromCode(0); }
        const changedFiles = await call('siteReplace', st.dir, q, [E.file]);
        count.textContent = `Replaced in ${changedFiles.length + (r?.count ? 1 : 0)} files`;
        results.innerHTML = '';
      }
    });
    s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(); if (e.key === 'Enter') run(); });
    $('[data-f=find]', s).focus();
  }

  async function filesPanel(pane) {
    const list = await call('listSite', st.dir).catch(() => []);
    st.files = list;
    const cur = st.fileSel;
    pane.innerHTML = `<div class="we-fbtns"><button class="tb icon" data-fa="newpage" title="New page">${icon('docAdd', 'sm')}</button><button class="tb icon" data-fa="newfolder" title="New folder">${icon('folder', 'sm')}</button><button class="tb icon" data-fa="rename" title="Rename" ${cur ? '' : 'disabled'}>${icon('textEdit', 'sm')}</button><button class="tb icon" data-fa="trash" title="Move to the Trash" ${cur ? '' : 'disabled'}>${icon('trash', 'sm')}</button><button class="tb icon" data-fa="reveal" title="Show in folder">${icon('open', 'sm')}</button><button class="tb icon" data-fa="refresh" title="Refresh">${icon('again', 'sm')}</button></div>
      <div class="we-tree"><div class="we-fi root" style="--lv:0">${icon('folder', 'sm')}<span>${esc(nameOf(st.dir))}</span></div>${list.map((x, i) => `<button class="we-fi${x.dir ? ' dir' : ''}${x.path === E.file ? ' cur' : ''}${x.path === cur ? ' on' : ''}" data-fi="${i}" style="--lv:${x.level + 1}" title="${esc(x.path)}">${icon(x.dir ? 'folder' : /^(html?|xhtml)$/.test(x.ext) ? 'web' : ['css', 'js', 'mjs', 'json'].includes(x.ext) ? 'code' : IMAGE_EXT.includes(x.ext) ? 'image' : 'doc', 'sm')}<span>${esc(nameOf(x.path))}</span></button>`).join('')}</div>`;
  }
  function bindFiles(pane) {
    pane.addEventListener('click', async (e) => {
      const fi = e.target.closest('[data-fi]');
      if (fi) { const x = st.files[Number(fi.dataset.fi)]; st.fileSel = x.path; $$('.we-fi', pane).forEach((b) => b.classList.toggle('on', b === fi)); $$('[data-fa=rename], [data-fa=trash]', pane).forEach((b) => { b.disabled = false; }); if (!x.dir && x.path !== E.file && /^(html?|xhtml|css|js|mjs|json|md|txt|svg|xml)$/.test(x.ext)) E.openFile(x.path); return; }
      const a = e.target.closest('[data-fa]')?.dataset.fa;
      if (!a) return;
      const target = st.fileSel, baseDir = target && st.files.find((x) => x.path === target)?.dir ? target : target ? dirOf(target) : st.dir;
      if (a === 'refresh') return filesPanel(pane);
      if (a === 'reveal') return api.invoke('shell:show', target || E.file);
      if (a === 'newpage') { const v = await ask('New page', [{ key: 'name', label: 'Name', value: 'new-page' }], 'Create'); if (v?.name) { const p = await call('newPage', baseDir, v.name).catch((er) => toast(clean(er), { type: 'error' })); if (p) { st.fileSel = p; await filesPanel(pane); E.openFile(p); } } }
      if (a === 'newfolder') { const v = await ask('New folder', [{ key: 'name', label: 'Name', value: 'images' }], 'Create'); if (v?.name) { await call('newFolder', baseDir, v.name).catch((er) => toast(clean(er), { type: 'error' })); filesPanel(pane); } }
      if (a === 'rename' && target) { if (target === E.file) return toast('Close this page before renaming it.'); const v = await ask('Rename', [{ key: 'name', label: 'New name', value: nameOf(target) }], 'Rename'); if (v?.name && v.name !== nameOf(target)) { st.fileSel = await call('rename', target, v.name).catch((er) => { toast(clean(er), { type: 'error' }); return target; }); filesPanel(pane); } }
      if (a === 'trash' && target) { if (target === E.file) return toast('This page is open: close it first.'); if (await E.confirm(`Move ${nameOf(target)} to the Trash?`, 'You can put it back from the Trash.')) { await api.invoke('shell:trash', target).catch((er) => toast(clean(er), { type: 'error' })); st.fileSel = null; filesPanel(pane); } }
    });
    pane.addEventListener('dblclick', (e) => { const fi = e.target.closest('[data-fi]'); if (fi) { const x = st.files[Number(fi.dataset.fi)]; if (!x.dir && !/^(html?|xhtml|css|js|mjs|json|md|txt|svg|xml)$/.test(x.ext)) api.invoke('shell:open', x.path); } });
  }

  return { insertMenu, insertById, insertHtml, insertImage, watermark, removeWatermark, makeBar, syncBar, hookFrame, inspector, bindInspector, cssDesigner, bindDesigner, findReplace, filesPanel, bindFiles, contextMenu, dropFiles, frameKeys, ask, menu, overlayHtml, tableEdit, setRows };
}
