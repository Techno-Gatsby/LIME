'use strict';
// Settings: the search box (and Ctrl/Cmd+F), and About with the version and the update check.
const http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async ({ check, js, openPrefs, prefs, app, dir }) => {
  await sleep(600);
  openPrefs();
  let pw = null;
  for (let i = 0; i < 50 && !(pw = prefs()); i++) await sleep(100);
  const wc = pw.webContents, pjs = (code) => js(code, wc);
  while (wc.isLoading()) await sleep(200);
  for (let i = 0; i < 50 && !(await pjs('!!document.querySelector(".prefs-search input") && !!document.querySelector("#about")')); i++) await sleep(150);
  const type = (q) => pjs(`(() => { const i = document.querySelector('.prefs-search input'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); })()`);
  const shown = () => pjs(`[...document.querySelectorAll('#app > section:not([hidden])')].map((s) => s.querySelector('h2').textContent + ': ' + [...s.querySelectorAll('.row:not([hidden]) .t b, li:not([hidden]) .n')].map((b) => b.textContent).join(', '))`);

  await check('settings · search filters sections and rows', async () => {
    await type('dark');
    const dark = await shown();
    if (dark.length !== 1 || !/^Wheel: Appearance$/.test(dark[0])) throw new Error(`“dark” shows ${JSON.stringify(dark)}`);
    await type('pandoc');
    const pan = await shown();
    if (pan.length !== 1 || !/Pandoc$/.test(pan[0])) throw new Error(`“pandoc” shows ${JSON.stringify(pan)}`);
    await type('saving');
    const whole = await shown();
    if (whole.length !== 1 || whole[0].split(', ').length < 3) throw new Error(`a section name should show the whole section: ${JSON.stringify(whole)}`);
    await type('qwxz');
    const none = await pjs('document.querySelector(".prefs-empty")?.textContent');
    if (!/No settings match/.test(none || '')) throw new Error('no “nothing matches” note');
    await pjs('document.querySelector(".prefs-search input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
    const all = await shown();
    if (all.length < 6 || (await pjs('document.querySelector(".prefs-search input").value'))) throw new Error(`Escape should clear the search: ${all.length} sections`);
    return `“dark” → ${dark[0]}; “pandoc” → ${pan[0]}; a section name keeps its rows; Escape shows all ${all.length} sections`;
  });

  await check('settings · Ctrl/Cmd+F goes to the search box', async () => {
    pw.focus();
    await pjs('document.activeElement?.blur()');
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    await sleep(300);
    const focused = await pjs('document.activeElement === document.querySelector(".prefs-search input")');
    if (!focused) throw new Error(`focus is on ${await pjs('document.activeElement?.tagName')}`);
    for (const c of 'sounds') { wc.sendInputEvent({ type: 'char', keyCode: c }); await sleep(30); }
    await sleep(300);
    const v = await pjs('document.querySelector(".prefs-search input").value'), typed = await shown();
    await type('');
    if (!v || !typed.length || !typed.every((s) => s.toLowerCase().includes(v.toLowerCase()) || /Sounds/.test(s))) throw new Error(`typed “${v}”: ${JSON.stringify(typed)}`);
    return `search box focused; typing “${v}” shows ${typed.join('; ')}`;
  });

  await check('settings · About shows the version and finds a newer release', async () => {
    const about = await pjs('[...document.querySelectorAll("#about .row .t")].map((t) => t.textContent)');
    if (!about.some((t) => t.startsWith(`Lime ${app.getVersion()}`))) throw new Error(`About: ${about.join(' | ')}`);
    const good = Buffer.from('a new Lime'), sha = crypto.createHash('sha256').update(good).digest('hex');
    const feed = { version: '99.0.0', file: 'Lime-Setup-99.0.0-x64.exe', size: good.length, sha256: sha };
    const server = http.createServer((req, res) => {
      if (req.url.endsWith(`lime-update-${process.platform}-${process.arch}.json`)) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(feed)); }
      if (req.url.endsWith('good.exe')) return res.end(good);
      if (req.url.endsWith('bad.exe')) return res.end(Buffer.from('tampered'));
      res.statusCode = 404; res.end();
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const was = process.env.LIME_UPDATE_URL;
    process.env.LIME_UPDATE_URL = `http://127.0.0.1:${server.address().port}`;
    try {
      await pjs('document.querySelector(\'[data-a="update-check"]\').click()');
      let sub = '';
      for (let i = 0; i < 40; i++) { sub = await pjs('document.querySelector("#update-row small").textContent'); if (/is out|Couldn’t/.test(sub)) break; await sleep(150); }
      if (!/Lime 99\.0\.0 is out/.test(sub)) throw new Error(`update row says “${sub}”`);
      const btn = await pjs('document.querySelector("#update-row .btn").textContent');
      const want = process.platform === 'win32' && app.isPackaged ? 'Download' : 'Download update';
      if (btn !== want) throw new Error(`button “${btn}”, expected “${want}”`);
      const U = require('../src/main/updater'), tmp = fs.mkdtempSync(path.join(dir, 'upd-'));
      await U.fetchVerified(`${process.env.LIME_UPDATE_URL}/good.exe`, path.join(tmp, 'good.exe'), sha, good.length);
      let refused = '';
      await U.fetchVerified(`${process.env.LIME_UPDATE_URL}/bad.exe`, path.join(tmp, 'bad.exe'), sha, good.length).catch((e) => { refused = e.message; });
      if (!fs.existsSync(path.join(tmp, 'good.exe')) || !/checksum/.test(refused) || fs.readdirSync(tmp).length !== 1) throw new Error(`checksum: ${refused || 'tampered file kept'}; ${fs.readdirSync(tmp).join(', ')}`);
      return `“${sub}” with “${btn}”; a matching download is kept, a tampered one is thrown away`;
    } finally {
      if (was === undefined) delete process.env.LIME_UPDATE_URL; else process.env.LIME_UPDATE_URL = was;
      server.close();
    }
  });
  pw.close();
};
