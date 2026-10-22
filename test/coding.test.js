'use strict';
// The Coding bucket: Python's Run, the SQLite tools, where code files are routed, buckets in crafts.APPS, and (when the
// build carries them) the bundled Code and Python payloads.
const fs = require('fs');
const path = require('path');

module.exports = async ({ submit, jobs, dir }) => {
  const OUT = path.join(dir, 'coding');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const E = (n) => require(path.join(__dirname, '..', 'src', 'main', 'engines', n));
  const tools = require(path.join(__dirname, '..', 'src', 'main', 'tools'));
  const C = E('crafts'), U = E('util');
  const results = [];
  const check = async (name, fn, skip) => {
    name = `coding: ${name}`;
    if (only && !only.test(name)) return;
    if (skip) { console.log(`SKIP ${name.padEnd(34)} ${skip}`); results.push({ name, status: 'SKIP', detail: skip }); return; }
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { status = 'FAIL'; detail = e.message; }
    console.log(`${status} ${name.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 300));
    results.push({ name, status, detail });
  };
  const run = async (tool, files, opts = {}) => {
    const d = path.join(OUT, `${tool}-${results.length}-${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(d, { recursive: true });
    const id = submit({ tool, files, opts, dest: { kind: 'dir', path: d } });
    let j;
    for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(100); }
    return j;
  };
  const write = (name, text) => { const p = path.join(OUT, name); fs.writeFileSync(p, text); return p; };
  const python = C.status().find((c) => c.id === 'python');
  const noPython = python?.bundled ? null : 'Python is not packed in this build (LIME_APPS)';

  await check('every app has a bucket; buckets fill from crafts.APPS', async () => {
    const none = Object.entries(C.APPS).filter(([, a]) => !C.BUCKETS[a.bucket]).map(([id]) => id);
    ok(!none.length, `no bucket: ${none}`);
    const by = (k) => Object.keys(C.APPS).filter((id) => C.APPS[id].bucket === k);
    ok(by('office').join() === 'pdfcraft,wordcraft,gridcraft,deckcraft', `office ${by('office')}`);
    ok(by('design').join() === 'photocraft,lightcraft,vectorcraft,designcraft,effectcraft,filmcraft,soundcraft', `design ${by('design')}`);
    ok(['webcraft', 'code', 'python', 'sqlite'].every((id) => by('coding').includes(id)) && by('engineering').includes('cadcraft'), 'coding or engineering');
    return Object.keys(C.BUCKETS).map((k) => `${k} ${by(k).length}`).join(', ');
  });
  await check('code files open in Code without taking documents from their apps', async () => {
    const f = (n, t = 'x = 1\n') => write(n, t);
    const first = (p) => C.appsFor([p])[0], has = (p, id) => C.appsFor([p]).includes(id);
    ok(first(f('a.py')) === 'python' && has(f('a.py'), 'code'), `py → ${C.appsFor([f('a.py')])}`);
    for (const n of ['a.json', 'a.yml', 'a.sh', 'a.go', 'a.rs', 'a.sql', 'a.toml', 'a.c', 'a.tsx']) ok(first(f(n)) === 'code', `${n} → ${C.appsFor([f(n)])}`);
    ok(first(f('t.ts', 'const a: number = 1;\n')) === 'code', 'TypeScript is not Code');
    const mpegts = path.join(OUT, 'clip.ts'); fs.writeFileSync(mpegts, Buffer.alloc(376, 0x47));
    ok(U.groupOf(mpegts) === 'video' && first(mpegts) === 'filmcraft', `an MPEG-TS goes to ${first(mpegts)}`);
    for (const [n, app] of [['p.html', 'webcraft'], ['s.css', 'webcraft'], ['j.js', 'webcraft'], ['d.md', 'wordcraft'], ['n.txt', 'wordcraft'], ['t.csv', 'gridcraft'], ['l.json', 'effectcraft']]) {
      const p = f(n, n === 'l.json' ? '{"v":"5.7","fr":30,"layers":[]}' : 'x');
      ok(first(p) === app && has(p, 'code'), `${n} → ${C.appsFor([p])}`);
    }
    ok(tools.wheelsFor([f('a.py')]).tools.some((w) => w.tool === 'run-python'), 'no Run on a .py');
    ok(tools.wheelsFor([f('s.css')]).tools.some((w) => w.tool === 'format-html'), 'no Format on a .css');
    return 'py → Python; json, yaml, shell, Go, Rust, SQL, TOML, C, TSX, TypeScript → Code; pages, Markdown, text, CSV and Lottie keep their apps';
  });
  const db = await require('./coding.ui').makeDb(path.join(OUT, 'shop.db'));
  await check('database files are recognised by content', async () => {
    const fake = write('Thumbs.db', 'not sqlite'), real = path.join(OUT, 'store.db');
    fs.copyFileSync(db, real);
    ok(U.groupOf(real) === 'database' && U.groupOf(fake) === 'any' && U.groupOf(write('x.sqlite3', '')) === 'database', `${U.groupOf(real)} ${U.groupOf(fake)}`);
    ok(C.appsFor([real])[0] === 'sqlite', `${C.appsFor([real])}`);
    const w = tools.wheelsFor([real]);
    ok(w.convert.some((x) => x.tool === 'database-tables') && w.tools.some((x) => x.tool === 'edit-database'), JSON.stringify(w));
    return 'SQLite by its header; Thumbs.db stays a plain file';
  });
  await check('Tables: one sheet per table in an XLSX', async () => {
    const j = await run('database-tables', [db]);
    ok(j.status === 'done', `${j.status}: ${j.error}`);
    const X = require('xlsx'), wb = X.readFile(j.results[0].path);
    ok(wb.SheetNames.join() === 'log,odd  name,people', `sheets ${wb.SheetNames}`);
    const rows = X.utils.sheet_to_json(wb.Sheets.people, { header: 1 });
    ok(rows[0].join() === 'id,name,age,photo' && rows[3][1] === 'Café ☕' && rows[1][3] === '[BLOB 3 bytes]' && rows.length === 4, JSON.stringify(rows));
    return `${path.basename(j.results[0].path)}: ${wb.SheetNames.join(', ')} · ${j.results[0].note}`;
  });
  await check('Schema: the SQL that rebuilds the database', async () => {
    const j = await run('database-schema', [db]);
    ok(j.status === 'done', `${j.status}: ${j.error}`);
    const sql = fs.readFileSync(j.results[0].path, 'utf8');
    for (const s of ['CREATE TABLE people', 'CREATE TABLE "odd [name]"', 'CREATE VIEW adults', 'CREATE INDEX people_name', 'CREATE TRIGGER people_log']) ok(sql.includes(s), `schema lacks ${s}`);
    ok(sql.indexOf('CREATE TABLE people') < sql.indexOf('CREATE VIEW') && sql.indexOf('CREATE VIEW') < sql.indexOf('CREATE TRIGGER'), 'tables do not come first');
    // The schema really rebuilds an empty copy.
    const SQL = await require('sql.js')(), copy = new SQL.Database();
    copy.exec(sql);
    ok(copy.exec("SELECT count(*) FROM sqlite_schema")[0].values[0][0] === 6, 'the schema does not rebuild 6 objects');
    copy.close();
    return `${j.results[0].note}; rebuilds the same six objects`;
  });
  await check('database tools refuse what isn’t a database', async () => {
    const empty = path.join(OUT, 'empty.db');
    const SQL = await require('sql.js')(); fs.writeFileSync(empty, Buffer.from(new SQL.Database().export()));
    const a = await run('database-tables', [empty]), b = await run('database-schema', [write('text.sqlite', 'hello there, not a database')]);
    ok(a.status === 'error' && /no tables/.test(a.error), `empty: ${a.status} ${a.error}`);
    ok(b.status === 'error' && /isn’t an SQLite database/.test(b.error), `text: ${b.status} ${b.error}`);
    return `${a.error} · ${b.error}`;
  });
  await check('a database in WAL mode opens read-only from a copy', async () => {
    const wal = path.join(OUT, 'wal.db');
    const b = fs.readFileSync(db); b[18] = 2; b[19] = 2; fs.writeFileSync(wal, b);
    const before = fs.readFileSync(wal);
    const j = await run('database-tables', [wal]);
    ok(j.status === 'done', `${j.status}: ${j.error}`);
    ok(fs.readFileSync(wal).equals(before), 'the database file changed');
    return 'read, file untouched';
  });
  await check('Run: prints, errors, arguments and the time limit', async () => {
    const py = write('hello.py', 'import sys, os, json\nprint("hello", sys.argv[1:])\nprint(json.dumps({"cwd_is_temp": os.path.basename(os.getcwd()).startswith("python-")}))\nprint("warning!", file=sys.stderr)\nsys.exit(3)\n');
    const j = await run('run-python', [py], { timeout: '60', args: 'one "two words"' });
    ok(j.status === 'done', `${j.status}: ${j.error}`);
    const t = fs.readFileSync(j.results[0].path, 'utf8');
    ok(path.basename(j.results[0].path) === 'hello - output.txt', path.basename(j.results[0].path));
    ok(t.includes("hello ['one', 'two words']") && t.includes('"cwd_is_temp": true') && /── Errors ──\nwarning!/.test(t) && /exit code 3/.test(t), t);
    const loop = write('loop.py', 'import time\nprint("tick", flush=True)\nwhile True: time.sleep(0.05)\n');
    const t0 = Date.now(), k = await run('run-python', [loop], { timeout: '10' });
    ok(k.status === 'done' && /Stopped after 10 s/.test(k.results[0].note) && Date.now() - t0 < 30000, `${k.status} ${k.results?.[0]?.note} ${k.error}`);
    ok(fs.readFileSync(k.results[0].path, 'utf8').includes('tick'), 'output before the stop was lost');
    const imp = write('uses_lib.py', 'import helper\nprint(helper.VALUE)\n');
    write('helper.py', 'VALUE = 42\n');
    const m = await run('run-python', [imp]);
    ok(m.status === 'done' && fs.readFileSync(m.results[0].path, 'utf8').includes('42'), 'a module beside the script did not import');
    return `${j.results[0].note}; ${k.results[0].note}; imports a module beside it`;
  }, noPython);
  const code = C.status().find((c) => c.id === 'code');
  await check('Code: unpacks with telemetry and updates off, and Python set up', async () => {
    const K = E('coding');
    await K.prepare('python');
    const set = require('jsonc-parser').parse(fs.readFileSync(path.join(K.dirs().data, 'User', 'settings.json'), 'utf8'));
    ok(set['update.mode'] === 'none' && set['telemetry.telemetryLevel'] === 'off' && set['extensions.autoUpdate'] === 'off', JSON.stringify(set));
    ok(set['python.defaultInterpreterPath'] && fs.existsSync(set['python.defaultInterpreterPath']) && set['python.pythonPath'] === set['python.defaultInterpreterPath'], 'no interpreter');
    const m = C.bundledApps().code;
    for (const x of m.extensions) ok(fs.readdirSync(K.dirs().extensions).some((d) => d.toLowerCase().startsWith(`${x.id}-${x.version}`)), `${x.id} not installed`);
    ok(fs.existsSync(path.join(K.dirs().data, 'User', 'tasks.json')), 'no Run task');
    return `VSCodium ${m.version} with ${m.extensions.map((x) => `${x.id} ${x.version}`).join(', ')}; Python at ${path.relative(U.cfg.user, set['python.defaultInterpreterPath'])}`;
  }, code?.bundled && python?.bundled ? null : 'Code and Python are not packed in this build (LIME_APPS)');
  return results;
};
