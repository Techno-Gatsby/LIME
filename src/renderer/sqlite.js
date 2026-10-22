// The SQLite browser: an open-source take on DB Browser for SQLite, in a Lime window. The database runs in a thread of its
// own in Lime (src/main/sqlitehost.js); this page lists its tables, pages through rows, runs SQL and exports.
import { $, $$, esc, h, nameOf, dirOf, sep, clean, fmtBytes } from './ui.js';
import { setDocName, confirm3 } from './editor-kit.js';

const PAGE = 200;
const KINDS = [['table', 'Tables'], ['view', 'Views'], ['index', 'Indexes'], ['trigger', 'Triggers']];
const FORMATS = [['csv', 'CSV'], ['xlsx', 'Excel (XLSX)'], ['json', 'JSON']];

export function openEditor(view, { file }, ctx) {
  const { toast, api, go } = ctx;
  const icon = (n, s = '') => ctx.icon(n, s);
  const call = (m, ...a) => api.invoke('sqlite:call', m, ...a);
  if (!document.querySelector('link[href="sqlite.css"]')) document.head.append(h('<link rel="stylesheet" href="sqlite.css">'));
  const st = { info: null, sel: null, tab: 'data', page: null, order: null, desc: false, offset: 0, result: null, lastSql: '', busy: false };
  ctx.onClose?.(close);

  const root = h(`<div class="editor sqlite">
    <header class="ed-head"><div class="topbar">
      <button class="tb icon" data-a="close" title="Close">${icon('back')}</button>
      <div class="doc">${icon('database')}<b></b><span class="dirty" hidden>Unsaved</span></div>
      <div class="grow"></div>
      <label class="allow" title="Off: nothing can change the database. On: SQL may change it, and Save writes the changes to the file."><input type="checkbox" data-a="allow"><span>Allow changes</span></label>
      <button class="tb" data-a="export" title="Save the table or the query result as CSV, Excel or JSON">${icon('share', 'sm')}<span class="lbl">Export</span></button>
      <button class="btn primary" data-a="save" disabled>${icon('save', 'sm')}Save</button>
    </div></header>
    <div class="sq-body">
      <aside class="sq-side"><div class="sq-objs"></div><div class="sq-meta"></div></aside>
      <main class="sq-main">
        <div class="sq-tabs" role="tablist"><button data-tab="data" role="tab">Data</button><button data-tab="schema" role="tab">Schema</button><button data-tab="sql" role="tab">SQL</button></div>
        <section class="sq-pane" data-pane="data"><div class="sq-grid"></div><div class="sq-pager"></div></section>
        <section class="sq-pane" data-pane="schema"><pre class="sq-schema"></pre></section>
        <section class="sq-pane" data-pane="sql">
          <div class="sq-editor"><textarea class="input sq-input" spellcheck="false" placeholder="SELECT * FROM …"></textarea>
          <div class="sq-run"><button class="btn primary" data-a="run">${icon('open', 'sm')}Run</button><span class="muted">Ctrl+Enter runs it</span><span class="sq-msg"></span></div></div>
          <div class="sq-grid sq-result"></div>
        </section>
      </main>
    </div>
    <div class="ed-status" hidden></div>
  </div>`);
  view.append(root);
  setDocName(root, file);
  const statusEl = $('.ed-status', root), input = $('.sq-input', root);
  function tip(msg, bad) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('bad', !!bad);
    clearTimeout(tip.t);
    if (msg) tip.t = setTimeout(() => { statusEl.hidden = true; }, 5000);
  }
  const fail = (e) => { tip(clean(e), true); if (/stopped it/.test(clean(e))) refresh(); };

  const value = (v) => (v == null ? '<i class="null">NULL</i>' : typeof v === 'object' && v.blob != null ? `<i class="blob">BLOB · ${fmtBytes(v.blob)}</i>` : esc(String(v)));
  function grid(el, { columns, rows, types = {} }, sortable) {
    if (!columns.length) { el.innerHTML = '<p class="muted sq-empty">No rows to show.</p>'; return; }
    const head = columns.map((c) => `<th${sortable ? ` data-col="${esc(c)}" class="sort${st.order === c ? (st.desc ? ' desc' : ' asc') : ''}"` : ''} title="${esc(types[c] || '')}">${esc(c)}</th>`).join('');
    el.innerHTML = `<table><thead><tr><th class="n">#</th>${head}</tr></thead><tbody>${rows.map((r, i) => `<tr><td class="n">${(sortable ? st.offset : 0) + i + 1}</td>${r.map((v) => `<td class="${typeof v === 'number' ? 'num' : ''}">${value(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    if (!rows.length) el.insertAdjacentHTML('beforeend', '<p class="muted sq-empty">No rows.</p>');
  }
  function sidebar() {
    const objs = st.info?.objects || [];
    $('.sq-objs', root).innerHTML = KINDS.map(([k, label]) => {
      const list = objs.filter((o) => o.type === k);
      return list.length ? `<div class="grp">${label}<span>${list.length}</span></div>${list.map((o) => `<button class="sq-obj${st.sel?.name === o.name ? ' on' : ''}" data-obj="${esc(o.name)}" data-type="${k}" title="${esc(o.name)}">${icon(k === 'table' ? 'grid' : k === 'view' ? 'eye' : k === 'index' ? 'list' : 'sparkle', 'sm')}<span class="nm">${esc(o.name)}</span>${o.rows != null ? `<span class="ct">${o.rows.toLocaleString()}</span>` : ''}</button>`).join('')}` : '';
    }).join('') || '<p class="muted">This database has no tables yet.</p>';
    const i = st.info;
    $('.sq-meta', root).textContent = i ? `${fmtBytes(i.size)} · ${objs.filter((o) => o.type === 'table').length} tables${i.wal ? ' · has unsaved changes from another app (-wal file)' : ''}` : '';
  }
  function chrome() {
    const i = st.info;
    $('[data-a=allow]', root).checked = !!i?.allow;
    root.classList.toggle('writable', !!i?.allow);
    $('[data-a=save]', root).disabled = !i?.dirty;
    $('.dirty', root).hidden = !i?.dirty;
    $$('.sq-tabs button', root).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === st.tab)));
    $$('.sq-pane', root).forEach((p) => { p.hidden = p.dataset.pane !== st.tab; });
  }
  async function refresh() {
    try { st.info = await call('info'); } catch (e) { tip(clean(e), true); }
    sidebar();
    chrome();
  }
  async function browse() {
    const s = st.sel;
    if (!s || !['table', 'view'].includes(s.type)) { $('.sq-grid', root).innerHTML = `<p class="muted sq-empty">${s ? `${esc(s.name)} is ${s.type === 'index' ? 'an index' : 'a trigger'}: its SQL is under Schema.` : 'Pick a table on the left.'}</p>`; $('.sq-pager', root).innerHTML = ''; return; }
    try {
      st.page = await call('browse', s.name, { offset: st.offset, limit: PAGE, order: st.order, desc: st.desc });
      grid($('[data-pane=data] .sq-grid', root), st.page, true);
      const { total, offset, rows } = st.page;
      $('.sq-pager', root).innerHTML = `<button class="btn subtle" data-a="prev" ${offset ? '' : 'disabled'}>${icon('back', 'sm')}Previous</button><span>${total ? `${(offset + 1).toLocaleString()}–${(offset + rows.length).toLocaleString()} of ${total.toLocaleString()}` : 'No rows'}</span><button class="btn subtle" data-a="next" ${offset + rows.length < total ? '' : 'disabled'}>Next${icon('chevron', 'sm')}</button>`;
    } catch (e) { fail(e); }
  }
  function schema() {
    const objs = st.info?.objects || [], s = st.sel && objs.find((o) => o.name === st.sel.name);
    const list = s ? [s, ...objs.filter((o) => o.table === s.name && o.name !== s.name)] : objs;
    $('.sq-schema', root).textContent = list.filter((o) => o.sql).map((o) => `${o.sql.trim().replace(/;?\s*$/, ';')}`).join('\n\n') || 'No schema.';
  }
  function select(name, type) {
    st.sel = { name, type };
    st.offset = 0; st.order = null; st.desc = false;
    sidebar();
    if (st.tab === 'sql') st.tab = type === 'table' || type === 'view' ? 'data' : 'schema';
    if (st.tab === 'data' && !['table', 'view'].includes(type)) st.tab = 'schema';
    if (!input.value.trim() && (type === 'table' || type === 'view')) input.value = `SELECT * FROM "${name.replace(/"/g, '""')}" LIMIT 100;`;
    chrome();
    browse();
    schema();
  }
  async function run() {
    const sql = input.value.trim();
    if (!sql || st.busy) return;
    st.busy = true;
    $('.sq-msg', root).textContent = 'Running…';
    try {
      const r = await call('query', sql);
      st.result = r; st.lastSql = sql;
      grid($('.sq-result', root), r, false);
      $('.sq-msg', root).textContent = `${r.columns.length ? `${r.rows.length.toLocaleString()}${r.more ? '+' : ''} row${r.rows.length === 1 ? '' : 's'}${r.more ? ' (the first 1,000)' : ''}` : r.changed ? `Done · ${r.changes.toLocaleString()} row${r.changes === 1 ? '' : 's'} changed` : 'Done'} · ${r.ms} ms`;
      if (r.changed) { await refresh(); if (st.sel) { browse(); schema(); } }
    } catch (e) { $('.sq-msg', root).textContent = ''; $('.sq-result', root).innerHTML = `<p class="sq-error">${esc(clean(e))}</p>`; if (/stopped it/.test(clean(e))) refresh(); } finally { st.busy = false; }
  }
  async function setAllow(on) {
    try { st.info = await call('setAllow', on); } catch (e) { fail(e); }
    chrome();
    tip(on ? 'Changes allowed: SQL may change the database, and Save writes it to the file.' : 'Read-only: nothing can change the database.');
  }
  async function save() {
    if (!st.info?.dirty) return true;
    try { st.info = await call('save'); tip(`Saved ${nameOf(file)}`); chrome(); return true; } catch (e) { fail(e); return false; }
  }
  function exportMenu() {
    $('.sq-pop', root)?.remove();
    const what = st.tab === 'sql' && st.result?.columns.length ? { sql: st.lastSql, label: 'the query result' } : st.sel && ['table', 'view'].includes(st.sel.type) ? { table: st.sel.name, label: st.sel.name } : null;
    if (!what) { tip('Pick a table, or run a query, to export it.'); return; }
    const pop = h(`<div class="pop sq-pop"><div class="note">Export ${esc(what.label)} as</div>${FORMATS.map(([k, l]) => `<button class="mi" data-k="${k}">${l}</button>`).join('')}</div>`);
    $('[data-a=export]', root).after(pop);
    pop.addEventListener('click', async (e) => {
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (!k) return;
      pop.remove();
      const stem = what.table || `${nameOf(file).replace(/\.[^.]+$/, '')} - query`;
      const target = await api.invoke('dialog:save', { defaultPath: `${dirOf(file)}${sep}${stem.replace(/[\\/:*?"<>|]/g, '_')}.${k}`, filters: [{ name: k.toUpperCase(), extensions: [k] }] });
      if (!target) return;
      try { const r = await call('exportRows', what, k, target); tip(`Saved ${nameOf(r.path)} · ${r.rows.toLocaleString()} rows`); } catch (err) { fail(err); }
    });
    setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  }
  async function close() {
    if (st.info?.dirty) {
      const c = await confirm3(`Save changes to ${nameOf(file)}?`, 'Your changes to the database will be lost if you don’t save them.');
      if (c === 'cancel') return;
      if (c === 'save' && !(await save())) return;
    }
    go();
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { st.tab = t.dataset.tab; chrome(); if (st.tab === 'sql') input.focus(); return; }
    const o = e.target.closest('[data-obj]');
    if (o) { select(o.dataset.obj, o.dataset.type); return; }
    const c = e.target.closest('th[data-col]');
    if (c) { const col = c.dataset.col; st.desc = st.order === col ? !st.desc : false; st.order = col; st.offset = 0; browse(); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') close();
    if (a === 'save') save();
    if (a === 'export') exportMenu();
    if (a === 'run') run();
    if (a === 'prev') { st.offset = Math.max(0, st.offset - PAGE); browse(); }
    if (a === 'next') { st.offset += PAGE; browse(); }
  });
  root.addEventListener('change', (e) => { if (e.target.matches('[data-a=allow]')) setAllow(e.target.checked); });
  input.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
  function onKey(e) {
    if (document.querySelector('.scrim')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); save(); }
    if ((e.ctrlKey || e.metaKey) && k === 'w') { e.preventDefault(); close(); }
  }
  document.addEventListener('keydown', onKey, true);

  (async () => {
    try {
      st.info = await call('open', file);
      sidebar();
      const tabs = st.info.objects.filter((o) => o.type === 'table'), first = tabs.find((o) => o.rows > 0) || tabs[0] || st.info.objects.find((o) => o.type === 'view');
      if (first) select(first.name, first.type); else { st.tab = 'sql'; chrome(); schema(); }
      if (st.info.wal) tip('Another app has changes in this database’s -wal file that aren’t shown here.');
      document.body.dataset.state = 'ready';
    } catch (e) {
      $('.sq-body', root).innerHTML = `<p class="sq-error big">${esc(clean(e))}</p>`;
      document.body.dataset.state = 'failed';
    }
  })();
  window.__sqlite = { st, run, select, setAllow, save, refresh, call, input };
  return () => { document.removeEventListener('keydown', onKey, true); delete window.__sqlite; delete document.body.dataset.state; };
}
