'use strict';
// SQLite databases through sql.js (SQLite compiled to WebAssembly, MIT): the same engine on every platform. A database is
// read whole into memory, so the original file is never touched unless the person saves.
const U = require('./util');
const { fs, fsp, path } = U;

const MAX = 1536 * 1048576;
let sqlP = null;
const SQL = () => (sqlP ||= require('sql.js')());
const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function load(p) {
  const st = await fsp.stat(p);
  if (st.size > MAX) throw new Error(`${path.basename(p)} is ${U.fmtBytes(st.size)}; Lime opens databases up to ${U.fmtBytes(MAX)}.`);
  const bytes = await fsp.readFile(p);
  if (bytes.length && bytes.toString('latin1', 0, 16) !== 'SQLite format 3\0') throw new Error(`${path.basename(p)} isn’t an SQLite database.`);
  // A database in write-ahead-log mode can't be opened in memory as it is; marking it as a rollback-journal database (the
  // two header bytes 18 and 19) reads the same tables. Only this copy changes.
  if (bytes.length > 19 && bytes[18] === 2) { bytes[18] = 1; bytes[19] = 1; }
  const db = new (await SQL()).Database(bytes);
  try { db.exec('PRAGMA schema_version'); } catch (e) { db.close(); throw new Error(`${path.basename(p)} can’t be read (${e.message}).`); }
  return db;
}
const rowsOf = (db, sql, params) => {
  const st = db.prepare(sql);
  try { if (params) st.bind(params); const out = []; while (st.step()) out.push(st.get()); return { columns: st.getColumnNames(), rows: out }; } finally { st.free(); }
};
function objects(db) {
  const { rows } = rowsOf(db, "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END, name");
  return rows.map(([type, name, table, sql]) => ({ type, name, table, sql: sql || '' }));
}
const tables = (db) => objects(db).filter((o) => o.type === 'table');
function columns(db, name) {
  return rowsOf(db, `PRAGMA table_xinfo(${q(name)})`).rows.map(([, n, type, notnull, dflt, pk, hidden]) => ({ name: n, type: type || '', notnull: !!notnull, default: dflt, pk: !!pk, hidden: !!hidden }));
}
const count = (db, name) => rowsOf(db, `SELECT count(*) FROM ${q(name)}`).rows[0][0];

// The whole schema as SQL that rebuilds it: tables first, then views, indexes and triggers.
function schemaSql(db, file) {
  const list = objects(db).filter((o) => o.sql);
  const head = [`-- Schema of ${path.basename(file)}`, `-- ${list.filter((o) => o.type === 'table').length} tables, ${list.filter((o) => o.type === 'view').length} views, ${list.filter((o) => o.type === 'index').length} indexes, ${list.filter((o) => o.type === 'trigger').length} triggers`, ''];
  return `${[...head, ...list.map((o) => `${o.sql.trim().replace(/;?\s*$/, ';')}\n`)].join('\n')}`;
}
async function schema(p, opts, ctx) {
  const db = await load(p);
  try {
    const n = objects(db).filter((o) => o.sql).length;
    if (!n) throw new Error('This database is empty: it has no tables.');
    const out = ctx.out.file(p, `${U.base(p)} - schema.sql`);
    await fsp.writeFile(out, schemaSql(db, p));
    return { path: out, note: `${n} statement${n === 1 ? '' : 's'}` };
  } finally { db.close(); }
}

// A cell as a spreadsheet or text file can hold it: binary data is described, not dumped.
const cell = (v, limit = 32767) => (v == null ? null : v instanceof Uint8Array ? `[BLOB ${v.length} bytes]` : typeof v === 'string' && v.length > limit ? `${v.slice(0, limit - 1)}…` : v);
const sheetName = (name, used) => {
  let base = String(name).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet', n = base, i = 2;
  while (used.has(n.toLowerCase())) { const tail = ` (${i++})`; n = `${base.slice(0, 31 - tail.length)}${tail}`; }
  used.add(n.toLowerCase());
  return n;
};
const EXCEL_ROWS = 1048575;
async function tablesXlsx(p, opts, ctx) {
  const db = await load(p), XLSX = require('xlsx');
  try {
    const list = tables(db);
    if (!list.length) throw new Error('This database has no tables.');
    const wb = XLSX.utils.book_new(), used = new Set();
    let cut = 0;
    list.forEach((t, i) => {
      ctx?.progress?.((i + 0.5) / list.length, `Reading ${t.name}`);
      const { columns: cols, rows } = rowsOf(db, `SELECT * FROM ${q(t.name)} LIMIT ${EXCEL_ROWS}`);
      if (rows.length === EXCEL_ROWS && count(db, t.name) > EXCEL_ROWS) cut++;
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols, ...rows.map((r) => r.map((v) => cell(v)))]), sheetName(t.name, used));
    });
    const out = ctx.out.file(p, `${U.base(p)} - tables.xlsx`);
    XLSX.writeFile(wb, out, { compression: true });
    return { path: out, note: `${list.length} table${list.length === 1 ? '' : 's'}, one sheet each${cut ? `; ${cut} cut to Excel’s 1,048,575 rows` : ''}` };
  } finally { db.close(); }
}

// Writing a table or query result for the browser window's Export.
function writeRows(columns, rows, format, out) {
  if (format === 'json') return fsp.writeFile(out, `${JSON.stringify(rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] instanceof Uint8Array ? Buffer.from(r[i]).toString('base64') : r[i]]))), null, 2)}\n`);
  if (format === 'xlsx') {
    const XLSX = require('xlsx'), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([columns, ...rows.slice(0, EXCEL_ROWS).map((r) => r.map((v) => cell(v)))]), 'Data');
    XLSX.writeFile(wb, out, { compression: true });
    return Promise.resolve();
  }
  const esc = (v) => { const s = v == null ? '' : v instanceof Uint8Array ? Buffer.from(v).toString('base64') : String(v); return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return fsp.writeFile(out, `﻿${[columns, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')}\r\n`);
}

module.exports = { load, objects, tables, columns, count, rowsOf, schemaSql, schema, tablesXlsx, writeRows, cell, q, MAX };
