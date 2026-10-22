'use strict';
// One open database for one SQLite window, in a thread of its own so a long query can be stopped by ending the thread.
const { parentPort, workerData } = require('worker_threads');
const U = require('./engines/util');
U.configure(workerData.cfg);
const S = require('./engines/sqlite');
const { fs, fsp, path } = U;

let db = null, file = null, allow = false, dirty = false;
const PAGE = 200, QUERY_ROWS = 1000;
const guard = () => { if (!db) throw new Error('No database is open.'); };
const applyMode = () => db.run(`PRAGMA query_only = ${allow ? 0 : 1}`);
const changeMark = () => `${db.exec('SELECT total_changes()')[0].values[0][0]}:${db.exec('PRAGMA schema_version')[0].values[0][0]}`;
function info() {
  const list = S.objects(db);
  return { file, name: path.basename(file), size: fs.statSync(file).size, allow, dirty, wal: walPending(), objects: list.map((o) => ({ ...o, rows: o.type === 'table' || o.type === 'view' ? safeCount(o.name) : null })) };
}
const safeCount = (name) => { try { return S.count(db, name); } catch (_) { return null; } };
const walPending = () => { try { return fs.statSync(`${file}-wal`).size > 0; } catch (_) { return false; } };
const show = (rows) => rows.map((r) => r.map((v) => (v instanceof Uint8Array ? { blob: v.length } : typeof v === 'string' && v.length > 2000 ? `${v.slice(0, 2000)}…` : v)));

const CALLS = {
  async open(p) {
    db?.close();
    db = await S.load(p);
    file = p; allow = false; dirty = false;
    applyMode();
    return info();
  },
  info() { guard(); return info(); },
  browse(name, { offset = 0, limit = PAGE, order = null, desc = false } = {}) {
    guard();
    const obj = S.objects(db).find((o) => o.name === name && (o.type === 'table' || o.type === 'view'));
    if (!obj) throw new Error(`There is no table or view called ${name}.`);
    const cols = obj.type === 'table' ? S.columns(db, name).filter((c) => !c.hidden) : null;
    const by = order != null ? ` ORDER BY ${S.q(order)}${desc ? ' DESC' : ''}` : '';
    const r = S.rowsOf(db, `SELECT * FROM ${S.q(name)}${by} LIMIT ? OFFSET ?`, [Math.max(1, Math.min(5000, limit)), Math.max(0, offset)]);
    return { name, type: obj.type, columns: r.columns, types: cols ? Object.fromEntries(cols.map((c) => [c.name, c.type])) : {}, rows: show(r.rows), total: S.count(db, name), offset, order, desc };
  },
  // Every statement runs; the last one that returns rows is shown (its first thousand rows).
  query(sql) {
    guard();
    const before = changeMark(), t0 = Date.now();
    let shown = null, statements = 0;
    try {
      for (const st of db.iterateStatements(String(sql))) {
        statements++;
        try {
          const cols = st.getColumnNames(), rows = [];
          let more = false;
          while (st.step()) { if (rows.length >= QUERY_ROWS) { more = true; break; } rows.push(st.get()); }
          if (cols.length) shown = { columns: cols, rows: show(rows), more };
        } finally { st.free(); }
      }
    } catch (e) {
      const ro = /readonly|query_only/i.test(e.message);
      throw new Error(ro ? 'This query changes the database. Turn on “Allow changes” first.' : e.message.replace(/^Error: /, ''));
    }
    const changed = changeMark() !== before;
    if (changed) dirty = true;
    return { ...(shown || { columns: [], rows: [], more: false }), statements, changed, changes: db.getRowsModified(), ms: Date.now() - t0, dirty };
  },
  setAllow(on) { guard(); allow = !!on; applyMode(); return info(); },
  async save() {
    guard();
    if (walPending()) throw new Error('Another app still has changes in this database’s log (the -wal file). Close it, then save.');
    const bytes = db.export();
    applyMode();
    const tmp = `${file}.lime-${process.pid}.part`;
    await fsp.writeFile(tmp, Buffer.from(bytes));
    await fsp.rename(tmp, file).catch(async (e) => { await fsp.rm(tmp, { force: true }); throw e; });
    dirty = false;
    return info();
  },
  async exportRows({ table, sql }, format, out) {
    guard();
    // Exporting a query result never runs its changes a second time.
    db.run('PRAGMA query_only = 1');
    let r;
    try { r = table ? S.rowsOf(db, `SELECT * FROM ${S.q(table)}`) : (() => { const all = db.exec(String(sql)); return all.length ? { columns: all[all.length - 1].columns, rows: all[all.length - 1].values } : { columns: [], rows: [] }; })(); } finally { applyMode(); }
    await S.writeRows(r.columns, r.rows, format, out);
    return { path: out, rows: r.rows.length };
  },
  schema() { guard(); return S.schemaSql(db, file); },
  close() { db?.close(); db = null; return true; },
};

parentPort.on('message', async ({ id, method, args }) => {
  try {
    const fn = CALLS[method];
    if (!fn) throw new Error(`Unknown call ${method}`);
    parentPort.postMessage({ id, result: await fn(...(args || [])) });
  } catch (e) { parentPort.postMessage({ id, error: e.message }); }
});
