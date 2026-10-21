import { $, $$, esc, h } from './ui.js';

const KIND = { Text: 'Note', FreeText: 'Text box', Highlight: 'Highlight', Underline: 'Underline', StrikeOut: 'Strike-out', Squiggly: 'Squiggle', Square: 'Box', Circle: 'Oval', Line: 'Line', Ink: 'Drawing',
  Polygon: 'Polygon', PolyLine: 'Lines', Stamp: 'Stamp', Caret: 'Insert', FileAttachment: 'Attachment', Sound: 'Sound' };
export const kindOf = (a) => (a.intent === 'LineDimension' ? 'Distance' : a.intent === 'PolygonDimension' ? 'Area' : a.intent === 'PolyLineDimension' ? 'Perimeter' : KIND[a.type] || a.type);
const FIELD_KIND = { text: 'Text', checkbox: 'Tick box', radio: 'Choice', combo: 'Drop-down', list: 'List', signature: 'Signature' };
const NOTE_COLORS = ['#ffd400', '#ff8a00', '#e8384f', '#2ea043', '#1f8fff', '#a259ff', '#8a8f98'];
const when = (iso) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

export function sidePanels(ed) {
  const { st, root, icon, call, toast } = ed;
  const side = $('.thumbs', root);
  const panes = Object.fromEntries($$('[data-pane]', side).map((p) => [p.dataset.pane, p]));
  let tab = 'pages', bmSel = null, editing = null;

  function show(name) {
    tab = name;
    $$('[data-side]', side).forEach((b) => b.setAttribute('aria-pressed', b.dataset.side === name));
    Object.entries(panes).forEach(([k, p]) => { p.hidden = k !== name; });
    $('.ed-body', root).classList.toggle('side-wide', name !== 'pages');
    if ($('.ed-body', root).classList.contains('no-thumbs')) { $('.ed-body', root).classList.remove('no-thumbs'); $('[data-a=thumbs]', root)?.setAttribute('aria-pressed', 'true'); }
    draw();
  }
  side.addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) show(b.dataset.side); });

  function draw() {
    const n = st.marks.annots.filter((a) => a.replyTo == null).length;
    const badge = $('[data-side=comments] .count', side);
    if (badge) { badge.textContent = n || ''; badge.hidden = !n; }
    if (tab === 'bookmarks') drawBookmarks();
    if (tab === 'comments') drawComments();
    if (tab === 'fields') drawFields();
    if (tab === 'history') drawHistory();
  }

  function drawHistory() {
    const p = panes.history, n = st.history.length - 1, waiting = st.pending.length;
    p.innerHTML = '';
    p.append(h(`<div class="cmhead"><b>${n ? `${n} step${n === 1 ? '' : 's'}` : 'No steps yet'}</b></div>`));
    const list = h('<div class="bmlist" role="list"></div>');
    st.history.forEach((x, i) => list.append(h(`<div class="bm hs${i === st.histAt ? ' sel' : ''}${i > st.histAt ? ' ahead' : ''}" role="listitem" tabindex="0" data-i="${i}" title="${i === st.histAt ? 'Where you are' : i < st.histAt ? 'Go back to here' : 'Go forward to here'}"><span class="t">${esc(x.label)}</span><small>${i || ''}</small></div>`)));
    list.addEventListener('click', (e) => { const row = e.target.closest('.bm'); if (row) ed.goToStep(Number(row.dataset.i)); });
    p.append(list, h(`<p class="tip">${waiting ? `${waiting} edit${waiting === 1 ? '' : 's'} waiting on the pages: they become a step when you save or go to another step. Undo takes them off one at a time.` : 'Click a step to go back to it. The steps after it stay until you make a new change.'}</p>`));
  }

  const at = (path, tree = st.outline) => path.reduce((list, i, k) => (k === path.length - 1 ? list : list[i].kids), tree);
  const nodeAt = (path) => at(path)[path[path.length - 1]];
  async function saveOutline(sel) {
    bmSel = sel ?? bmSel;
    await ed.busy('Saving bookmarks…', async () => { st.sess = await call('setOutline', st.sess.id, st.outline); });
    ed.record('Changed the bookmarks');
    drawBookmarks();
  }
  function drawBookmarks() {
    const p = panes.bookmarks;
    p.innerHTML = '';
    const bar = h(`<div class="ops four">
      <button class="tb" data-b="add" title="Add a bookmark for this page">${icon('add', 'sm')}</button>
      <button class="tb" data-b="up" title="Move up">${icon('up', 'sm')}</button>
      <button class="tb" data-b="down" title="Move down">${icon('down', 'sm')}</button>
      <button class="tb" data-b="in" title="Put under the one above">${icon('indent', 'sm')}</button>
      <button class="tb" data-b="out" title="Move out a level">${icon('outdent', 'sm')}</button>
      <button class="tb" data-b="here" title="Point it at the page in view">${icon('pdf', 'sm')}</button>
      <button class="tb" data-b="rename" title="Rename">${icon('textEdit', 'sm')}</button>
      <button class="tb" data-b="del" title="Delete">${icon('delete', 'sm')}</button>
    </div>`);
    p.append(bar);
    const list = h(`<div class="bmlist" role="tree"></div>`);
    const walk = (items, path) => items.forEach((b, i) => {
      const pp = [...path, i], key = pp.join('.');
      const row = h(`<div class="bm${key === bmSel ? ' sel' : ''}" role="treeitem" tabindex="0" data-path="${key}" style="padding-left:${8 + path.length * 14}px" title="${esc(b.title)}${b.page != null ? ` (page ${b.page + 1})` : ''}"><span class="t">${esc(b.title || 'Untitled')}</span><small>${b.page != null ? b.page + 1 : ''}</small></div>`);
      list.append(row);
      walk(b.kids || [], pp);
    });
    walk(st.outline, []);
    if (!st.outline.length) list.append(h(`<p class="tip">No bookmarks yet. Scroll to a page and press + to add one; bookmarks show in every PDF reader’s side panel.</p>`));
    p.append(list);
    $$('[data-b]', bar).forEach((b) => { b.disabled = !bmSel && !['add'].includes(b.dataset.b); });
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.bm');
      if (!row) return;
      bmSel = row.dataset.path;
      $$('.bm', list).forEach((x) => x.classList.toggle('sel', x === row));
      $$('[data-b]', bar).forEach((b) => { b.disabled = false; });
      const b = nodeAt(bmSel.split('.').map(Number));
      if (b?.page != null) ed.goTo(b.page);
    });
    list.addEventListener('dblclick', (e) => { const row = e.target.closest('.bm'); if (row) rename(row); });
    list.addEventListener('keydown', (e) => { const row = e.target.closest('.bm'); if (row && e.key === 'F2') rename(row); });
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-b]'); if (b) bmAction(b.dataset.b); });
  }
  function rename(row, fresh) {
    const path = row.dataset.path.split('.').map(Number), b = nodeAt(path);
    const t = $('.t', row), inp = h(`<input class="input bmedit" value="${esc(b.title)}" aria-label="Bookmark name">`);
    t.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      if (keep && v && v !== b.title) { b.title = v; saveOutline(row.dataset.path); } else if (fresh) saveOutline(row.dataset.path); else drawBookmarks();
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
  }
  function bmAction(a) {
    const page = ed.visiblePage();
    if (a === 'add') {
      ed.linesOf(page).then((lines) => {
        const title = (lines || []).map((l) => l.text.trim()).find((t) => t.length > 1)?.slice(0, 80) || `Page ${page + 1}`;
        const item = { title, page, kids: [] };
        let sel;
        if (bmSel) { const path = bmSel.split('.').map(Number), list = at(path); list.splice(path[path.length - 1] + 1, 0, item); sel = [...path.slice(0, -1), path[path.length - 1] + 1].join('.'); }
        else { st.outline.push(item); sel = String(st.outline.length - 1); }
        bmSel = sel;
        drawBookmarks();
        const row = $(`.bm[data-path="${sel}"]`, panes.bookmarks);
        if (row) rename(row, true);
      });
      return;
    }
    if (!bmSel) return;
    const path = bmSel.split('.').map(Number), list = at(path), i = path[path.length - 1], b = list[i];
    if (a === 'rename') { const row = $(`.bm[data-path="${bmSel}"]`, panes.bookmarks); if (row) rename(row); return; }
    if (a === 'del') { list.splice(i, 1); bmSel = null; saveOutline(); return; }
    if (a === 'here') { b.page = page; saveOutline(); return; }
    if (a === 'up' && i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; saveOutline([...path.slice(0, -1), i - 1].join('.')); }
    if (a === 'down' && i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; saveOutline([...path.slice(0, -1), i + 1].join('.')); }
    if (a === 'in' && i > 0) { list.splice(i, 1); const prev = list[i - 1]; (prev.kids ||= []).push(b); saveOutline([...path.slice(0, -1), i - 1, prev.kids.length - 1].join('.')); }
    if (a === 'out' && path.length > 1) { list.splice(i, 1); const parentPath = path.slice(0, -1), outer = at(parentPath); outer.splice(parentPath[parentPath.length - 1] + 1, 0, b); saveOutline([...parentPath.slice(0, -1), parentPath[parentPath.length - 1] + 1].join('.')); }
  }

  async function annotOp(op, label = 'Saving…') {
    const r = await ed.busy(label, async () => call('annotOp', st.sess.id, { author: ed.author(), ...op }));
    if (!r) return null;
    st.sess = r;
    ed.record(op.type === 'reply' ? (op.status ? `Marked a comment ${op.status.toLowerCase()}` : 'Replied to a comment') : op.color ? 'Recoloured a comment' : 'Changed a comment');
    await ed.refresh([op.page]);
    return r;
  }
  function drawComments() {
    const p = panes.comments;
    const keepScroll = p.scrollTop;
    p.innerHTML = '';
    const all = st.marks.annots, top = all.filter((a) => a.replyTo == null).sort((a, b) => a.page - b.page || a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
    const kids = (a) => all.filter((x) => x.replyTo === a.num && x.page === a.page);
    p.append(h(`<div class="cmhead"><b>${top.length ? `${top.length} comment${top.length === 1 ? '' : 's'}` : 'No comments'}</b></div>`));
    if (!top.length) p.append(h(`<p class="tip">Add a note with Note in the toolbar. Highlights, underlines, shapes, drawings and measurements show here too, so you can add words to them, reply or delete them.</p>`));
    let page = -1;
    for (const a of top) {
      if (a.page !== page) { page = a.page; p.append(h(`<div class="cmpage">Page ${page + 1}</div>`)); }
      const open = st.annSel === a.id, reps = kids(a);
      const el = h(`<div class="cm${open ? ' sel' : ''}" data-id="${a.id}" tabindex="0">
        <div class="cmtop"><span class="dot" style="background:${esc(a.color || '#ffd400')}"></span><b>${esc(a.author || 'Unknown')}</b><small>${esc(kindOf(a))}${a.date ? ` · ${esc(when(a.date))}` : ''}</small></div>
        ${open ? '' : `<div class="cmtext">${a.contents ? esc(a.contents) : '<i>No words yet</i>'}</div>${reps.length ? `<small class="cmreps">${reps.length} repl${reps.length === 1 ? 'y' : 'ies'}</small>` : ''}`}
      </div>`);
      if (open) {
        const ta = h(`<textarea class="input cmedit" rows="3" placeholder="Add a comment" aria-label="Comment">${esc(a.contents)}</textarea>`);
        ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ta.blur(); });
        ta.addEventListener('change', () => { if (ta.value !== a.contents) annotOp({ type: 'edit', page: a.page, num: a.num, text: ta.value }); });
        const sw = h(`<div class="swatches small">${NOTE_COLORS.map((c) => `<button style="background:${c}" data-c="${c}" aria-label="${c}" aria-pressed="${c === a.color}"></button>`).join('')}</div>`);
        sw.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) annotOp({ type: 'edit', page: a.page, num: a.num, color: b.dataset.c }); });
        el.append(ta, sw);
        for (const r of reps) el.append(h(`<div class="cmreply"><div class="cmtop"><b>${esc(r.author || 'Unknown')}</b><small>${r.status ? `${esc(r.status)} · ` : ''}${esc(when(r.date))}</small></div><div class="cmtext">${esc(r.contents)}</div></div>`));
        const rep = h(`<div class="cmrow"><input class="input" placeholder="Reply" aria-label="Reply"><button class="btn" data-x="reply">Reply</button></div>`);
        const send = () => { const v = $('input', rep).value.trim(); if (v) annotOp({ type: 'reply', page: a.page, to: a.num, text: v }); };
        $('input', rep).addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') send(); });
        $('[data-x=reply]', rep).addEventListener('click', send);
        const acts = h(`<div class="cmrow end"><select class="input" aria-label="Status" title="Review status"><option value="">Set status…</option>${['Accepted', 'Rejected', 'Cancelled', 'Completed'].map((x) => `<option>${x}</option>`).join('')}</select><button class="btn danger" data-x="del">${icon('delete', 'sm')}Delete</button></div>`);
        $('select', acts).addEventListener('change', (e) => { if (e.target.value) annotOp({ type: 'reply', page: a.page, to: a.num, text: `${e.target.value} set by ${ed.author() || 'me'}`, status: e.target.value }); });
        $('[data-x=del]', acts).addEventListener('click', () => removeComment(a));
        el.append(rep, acts);
      }
      p.append(el);
    }
    const me = h(`<label class="field cmme"><span class="label">Your name on comments</span><input class="input" value="${esc(ed.author())}" placeholder="Name"></label>`);
    $('input', me).addEventListener('change', (e) => ed.setAuthor(e.target.value.trim()));
    $('input', me).addEventListener('keydown', (e) => e.stopPropagation());
    p.append(me);
    p.scrollTop = keepScroll;
    p.onclick = (e) => {
      const c = e.target.closest('.cm');
      if (!c || e.target.closest('textarea, input, select, button')) return;
      select(st.annSel === c.dataset.id ? null : c.dataset.id, true);
    };
  }
  async function removeComment(a) {
    if (st.annSel === a.id) st.annSel = null;
    await annotOp({ type: 'delete', page: a.page, num: a.num }, 'Deleting…');
  }
  function select(id, scroll) {
    st.annSel = id;
    if (id && tab !== 'comments') show('comments'); else draw();
    ed.marksChanged();
    const a = st.marks.annots.find((x) => x.id === id);
    if (a && scroll) ed.goTo(a.page, a.rect);
    if (a) setTimeout(() => $(`.cm[data-id="${CSS.escape(id)}"]`, panes.comments)?.scrollIntoView({ block: 'nearest' }), 0);
  }
  function edit(id) {
    select(id);
    setTimeout(() => $(`.cm[data-id="${CSS.escape(id)}"] textarea`, panes.comments)?.focus(), 30);
  }

  function drawFields() {
    const p = panes.fields;
    p.innerHTML = '';
    const seen = new Map();
    for (const f of st.marks.fields) if (!seen.has(f.name)) seen.set(f.name, f);
    const list = [...seen.values()];
    p.append(h(`<div class="cmhead"><b>${list.length ? `${list.length} field${list.length === 1 ? '' : 's'}` : 'No form fields'}</b></div>`));
    if (!list.length) { p.append(h(`<p class="tip">Add fields with Field in the toolbar, or let Make PDF fillable on the wheel find the blanks for you.</p>`)); return; }
    const value = (f) => { const v = f.name in st.fieldVals ? st.fieldVals[f.name] : f.value; return f.type === 'checkbox' ? (v && v !== 'Off' ? 'Ticked' : 'Not ticked') : v === 'Off' ? '' : String(v ?? ''); };
    for (const f of list) {
      const el = h(`<div class="fl${st.fieldSel === f.name ? ' sel' : ''}" tabindex="0" data-name="${esc(f.name)}"><div class="cmtop"><b>${esc(f.name)}</b><small>${FIELD_KIND[f.type] || f.type} · p.${f.page + 1}${f.required ? ' · required' : ''}</small></div><div class="cmtext">${esc(value(f)) || '<i>Empty</i>'}</div></div>`);
      el.addEventListener('click', () => ed.focusField(f));
      p.append(el);
    }
    const acts = h(`<div class="cmrow"><button class="btn" data-x="reset">Clear form</button><button class="btn" data-x="flat" title="Turn the fields into plain page content">Flatten form</button></div>`);
    $('[data-x=reset]', acts).addEventListener('click', async () => { st.fieldVals = {}; const r = await ed.busy('Clearing…', () => call('fieldOp', st.sess.id, { type: 'reset' })); if (r) { st.sess = r; ed.record('Cleared the form'); ed.refresh(); } });
    $('[data-x=flat]', acts).addEventListener('click', () => ed.flattenForm());
    p.append(acts);
  }

  return { show, draw, select, edit, get tab() { return tab; } };
}
