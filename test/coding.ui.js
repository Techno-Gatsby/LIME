'use strict';
// Settings › Wheel apps (the bucket editor) and the SQLite browser window.
const fs = require('fs'), path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A small database with the awkward parts: a quoted name, a view, an index, a trigger, BLOBs, NULLs and non-ASCII text.
async function makeDb(file, rows = 3) {
  const SQL = await require('sql.js')();
  const db = new SQL.Database();
  db.run(`CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INT, photo BLOB);
    CREATE INDEX people_name ON people(name);
    CREATE VIEW adults AS SELECT id, name FROM people WHERE age >= 18;
    CREATE TABLE "odd [name]"(x, y);
    CREATE TABLE log(at TEXT);
    CREATE TRIGGER people_log AFTER DELETE ON people BEGIN INSERT INTO log VALUES ('gone ' || old.name); END;
    INSERT INTO "odd [name]" VALUES (1, NULL), ('two', 2.5);`);
  const st = db.prepare('INSERT INTO people VALUES (?, ?, ?, ?)');
  const base = [[1, 'Ana', 34, new Uint8Array([1, 2, 3])], [2, 'Bo', 12, null], [3, 'Café ☕', 51, null]];
  for (let i = 0; i < rows; i++) st.run(base[i] || [i + 1, `Person ${i + 1}`, 20 + (i % 60), null]);
  st.free();
  fs.writeFileSync(file, Buffer.from(db.export()));
  db.close();
  return file;
}
async function readDb(file, sql) {
  const SQL = await require('sql.js')();
  const db = new SQL.Database(fs.readFileSync(file));
  try { return db.exec(sql)[0]?.values || []; } finally { db.close(); }
}

module.exports = async ({ check, js, openPrefs, prefs, openEditor, editors, dir }) => {
  const OUT = path.join(dir, 'coding-ui');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const until = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(100); } return false; };

  await check('Settings › Wheel apps · reorder, move, hide, reorder buckets, drag, reset', async () => {
    // A Settings window closed just before may still be going away: wait for it, or calls into it never answer.
    const old = prefs();
    if (old && !old.isDestroyed()) old.close();
    await until(() => !prefs(), 5000);
    openPrefs();
    let pw = null;
    await until(() => (pw = prefs()) && !pw.isDestroyed(), 5000);
    const wc = pw.webContents, pjs = (code) => js(code, wc);
    while (wc.isLoading()) await sleep(150);
    await until(() => pjs('document.querySelectorAll(".wheel-apps .bucket-col").length === 4'), 6000);
    await pjs('window.lime.invoke("settings:set", { buckets: null })');
    await sleep(500);
    const state = () => pjs(`({ cols: [...document.querySelectorAll('.bucket-col')].map((c) => c.querySelector('h3 .nm').textContent + ':' + [...c.querySelectorAll('li')].map((l) => l.querySelector('.n').textContent + (l.classList.contains('off') ? '(hidden)' : '')).join('|')) })`);
    const saved = async () => (await pjs('window.lime.invoke("settings:get")')).buckets;
    const act = async (sel, a) => { await pjs(`document.querySelector(${JSON.stringify(`${sel} [data-a="${a}"]`)}).click()`); await sleep(450); };
    const s0 = await state();
    if (!/^Office:PdfCraft\|WordCraft\|GridCraft\|DeckCraft$/.test(s0.cols[0]) || !/^Coding:WebCraft\|Code\|Python\|SQLite$/.test(s0.cols[2]) || !/^Engineering:.*CADCraft/.test(s0.cols[3])) throw new Error(`editor shows ${JSON.stringify(s0.cols)}`);
    await act('li[data-id="pdfcraft"]', 'app-down');
    if ((await saved()).apps.office.join() !== 'wordcraft,pdfcraft,gridcraft,deckcraft') throw new Error(`move down stored ${JSON.stringify((await saved()).apps.office)}`);
    await pjs(`(() => { const s = document.querySelector('li[data-id="gridcraft"] select[data-a="app-bucket"]'); s.value = 'coding'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(450);
    if (!(await saved()).apps.coding.includes('gridcraft') || (await saved()).apps.office.includes('gridcraft')) throw new Error('GridCraft did not move to Coding');
    await act('li[data-id="deckcraft"]', 'app-hide');
    const s1 = await state();
    if (!(await saved()).hidden.includes('deckcraft') || !s1.cols[0].includes('DeckCraft(hidden)')) throw new Error(`hide: ${JSON.stringify(s1.cols[0])}`);
    await act('.bucket-col[data-bucket="office"] h3', 'bucket-down');
    if ((await saved()).order.slice(0, 2).join() !== 'design,office') throw new Error(`bucket order ${(await saved()).order}`);
    // Drag SoundCraft onto the top of the Office list.
    await pjs(`(() => {
      const from = document.querySelector('li[data-id="soundcraft"]'), to = document.querySelector('.bucket-col[data-bucket="office"] li'), dt = new DataTransfer();
      const b = to.getBoundingClientRect(), at = { clientX: b.x + 20, clientY: b.y + 2, bubbles: true, cancelable: true, dataTransfer: dt };
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      to.dispatchEvent(new DragEvent('dragover', at));
      to.dispatchEvent(new DragEvent('drop', at));
      from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    })()`);
    await sleep(500);
    const dragged = await saved();
    if (dragged.apps.office[0] !== 'soundcraft' || dragged.apps.design.includes('soundcraft')) throw new Error(`drag stored ${JSON.stringify(dragged.apps)}`);
    await act('.wheel-apps', 'buckets-reset');
    const s2 = await state(), back = await saved();
    if (s2.cols.join('\n') !== s0.cols.join('\n') || back.hidden.length || back.order.join() !== 'office,design,coding,engineering') throw new Error(`reset left ${JSON.stringify(s2.cols)}`);
    await pjs(`(() => { const i = document.querySelector('.prefs-search input'); i.value = 'sqlite'; i.dispatchEvent(new Event('input')); })()`);
    const found = await pjs(`[...document.querySelectorAll('.bucket-col li:not([hidden]) .n')].map((n) => n.textContent)`);
    await pjs(`(() => { const i = document.querySelector('.prefs-search input'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
    if (found.join() !== 'SQLite') throw new Error(`searching “sqlite” shows ${found}`);
    pw.close();
    await until(() => !prefs(), 5000);
    return 'moved PdfCraft down, GridCraft to Coding, SoundCraft by drag; hid DeckCraft; Office after Design & media; search finds SQLite; reset restored all';
  });

  await check('SQLite browser · tables, paging, sorting, SQL, read-only until allowed, save, export', async () => {
    const file = await makeDb(path.join(OUT, 'shop.db'), 450);
    process.env.LIME_SQLITE_QUERY_MS = '4000';
    const before = editors.size;
    openEditor(file, 'sqlite');
    await until(() => editors.size > before, 8000);
    const win = [...editors].pop(), wc = win.webContents, ejs = (code) => js(code, wc);
    try {
      while (wc.isLoading()) await sleep(150);
      if (!(await until(() => ejs('document.body.dataset.state === "ready" || document.body.dataset.state === "failed"'), 15000))) throw new Error('the window never opened the database');
      if (await ejs('document.body.dataset.state === "failed"')) throw new Error(await ejs('document.querySelector(".sq-error")?.textContent'));
      const side = await ejs(`[...document.querySelectorAll('.sq-objs .sq-obj')].map((b) => b.dataset.type + ':' + b.dataset.obj + ':' + (b.querySelector('.ct')?.textContent || ''))`);
      for (const want of ['table:people:450', 'table:odd [name]:2', 'view:adults:', 'index:people_name:', 'trigger:people_log:']) if (!side.some((x) => x.startsWith(want))) throw new Error(`sidebar lacks ${want}: ${side}`);
      const page = () => ejs(`({ rows: document.querySelectorAll('[data-pane=data] tbody tr').length, pager: document.querySelector('.sq-pager span')?.textContent, first: [...document.querySelectorAll('[data-pane=data] tbody tr:first-child td')].map((t) => t.textContent) })`);
      await ejs(`window.__sqlite.select('people', 'table')`);
      await until(async () => (await page()).rows === 200);
      const p1 = await page();
      if (p1.pager !== '1–200 of 450' || p1.first[2] !== 'Ana' || !/BLOB/.test(p1.first[4])) throw new Error(`first page ${JSON.stringify(p1)}`);
      await ejs(`document.querySelector('[data-a=next]').click()`);
      await until(async () => (await page()).pager === '201–400 of 450');
      await ejs(`document.querySelector('th[data-col="age"]').click()`);
      await until(async () => (await page()).pager === '1–200 of 450');
      await ejs(`document.querySelector('th[data-col="age"]').click()`);
      await sleep(400);
      const sorted = await page();
      if (Number(sorted.first[3]) < 79) throw new Error(`descending by age starts with ${sorted.first}`);
      const run = async (sql) => { await ejs(`window.__sqlite.input.value = ${JSON.stringify(sql)}; window.__sqlite.run()`); await sleep(150); await until(() => ejs('!window.__sqlite.st.busy'), 8000); return ejs(`({ msg: document.querySelector('.sq-msg').textContent, err: document.querySelector('.sq-result .sq-error')?.textContent || '', rows: document.querySelectorAll('.sq-result tbody tr').length })`); };
      await ejs(`document.querySelector('[data-tab=sql]').click()`);
      const q1 = await run("SELECT name, age FROM people WHERE age >= 18 AND id <= 3 ORDER BY id");
      if (q1.rows !== 2 || !/2 rows/.test(q1.msg)) throw new Error(`query ${JSON.stringify(q1)}`);
      const q2 = await run('DELETE FROM people WHERE id = 2');
      if (!/Allow changes/.test(q2.err) || (await readDb(file, 'SELECT count(*) FROM people'))[0][0] !== 450) throw new Error(`a change ran while read-only: ${JSON.stringify(q2)}`);
      const big = await run('SELECT * FROM people');
      if (big.rows !== 450 && !/first 1,000/.test(big.msg) && big.rows !== 1000) throw new Error(`all rows: ${JSON.stringify(big)}`);
      await ejs(`document.querySelector('[data-a=allow]').click()`);
      await until(() => ejs('window.__sqlite.st.info.allow'));
      const q3 = await run('DELETE FROM people WHERE id = 2');
      if (!/1 row changed/.test(q3.msg) || !(await ejs('!document.querySelector("[data-a=save]").disabled'))) throw new Error(`delete with changes allowed: ${JSON.stringify(q3)}`);
      if ((await readDb(file, 'SELECT count(*) FROM people'))[0][0] !== 450) throw new Error('the file changed before Save');
      await ejs(`document.querySelector('[data-a=save]').click()`);
      await until(() => ejs('!window.__sqlite.st.info.dirty'), 8000);
      const after = await readDb(file, "SELECT (SELECT count(*) FROM people), (SELECT at FROM log)");
      if (after[0][0] !== 449 || after[0][1] !== 'gone Bo') throw new Error(`saved file holds ${JSON.stringify(after)}`);
      // A runaway query is stopped, and the database comes back as saved, read-only again.
      const q4 = await run('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c');
      if (!/stopped it/.test(q4.err)) throw new Error(`runaway query: ${JSON.stringify(q4)}`);
      const back = await ejs(`window.__sqlite.call('info')`);
      if (back.allow || back.dirty || back.objects.find((o) => o.name === 'people').rows !== 449) throw new Error(`after the stop: ${JSON.stringify({ allow: back.allow, dirty: back.dirty })}`);
      const outs = {};
      for (const k of ['csv', 'xlsx', 'json']) outs[k] = await ejs(`window.__sqlite.call('exportRows', { table: 'odd [name]' }, '${k}', ${JSON.stringify(path.join(OUT, `odd.${k}`))})`);
      const csv = fs.readFileSync(path.join(OUT, 'odd.csv'), 'utf8'), json = JSON.parse(fs.readFileSync(path.join(OUT, 'odd.json'), 'utf8'));
      const X = require('xlsx'), ws = X.readFile(path.join(OUT, 'odd.xlsx')).Sheets.Data;
      if (csv !== '﻿x,y\r\n1,\r\ntwo,2.5\r\n' || json[1].y !== 2.5 || json[0].y !== null || ws.A3?.v !== 'two') throw new Error(`exports: ${JSON.stringify(csv)} ${JSON.stringify(json)}`);
      await ejs(`window.__sqlite.call('exportRows', { sql: 'SELECT name FROM people WHERE id = 3' }, 'csv', ${JSON.stringify(path.join(OUT, 'q.csv'))})`);
      if (fs.readFileSync(path.join(OUT, 'q.csv'), 'utf8') !== '﻿name\r\nCafé ☕\r\n') throw new Error('query export');
      return `450 rows paged 200 at a time and sorted; read-only refused a DELETE; allowed, saved, the trigger ran; a runaway query stopped; CSV, XLSX and JSON exports`;
    } finally {
      delete process.env.LIME_SQLITE_QUERY_MS;
      if (!win.isDestroyed()) { win.closing = true; win.close(); }
    }
  });
};
module.exports.makeDb = makeDb;
module.exports.readDb = readDb;
