'use strict';
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async ({ wheel, sensor, watcher, summon, dialog, BrowserWindow, app, openEditor, editors, openPrefs, prefs, screen, dir }) => {
  const FX = process.env.LIME_FX;
  const OUT = path.join(dir, 'ui-out');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const fx = (f) => path.join(FX, f);
  while (!wheel() || wheel().webContents.isLoading()) await sleep(200);
  await sleep(1500);
  const js = (code, wc = wheel().webContents) => wc.executeJavaScript(code, true);
  const lime = (code) => js(`(async () => { const L = window.__lime; ${code} })()`);

  const away = new BrowserWindow({ width: 240, height: 120, show: false, frame: false });
  let slot = 0, asked = [];
  const leave = async () => {
    wheel().webContents.sendInputEvent({ type: 'mouseLeave', x: -20, y: -20 });
    away.show();
    away.focus();
    await js('window.dispatchEvent(new Event("blur"))');
    await sleep(1400);
    away.hide();
  };
  const target = () => { const d = path.join(OUT, String(++slot).padStart(3, '0')); fs.mkdirSync(d, { recursive: true }); return d; };
  dialog.showSaveDialog = async (...a) => {
    const o = a[a.length - 1] || {};
    asked.push('file');
    await leave();
    return { canceled: false, filePath: path.join(target(), path.basename(o.defaultPath || 'result')) };
  };
  dialog.showOpenDialog = async (...a) => {
    const o = a[a.length - 1] || {};
    if (!(o.properties || []).includes('openDirectory')) return { canceled: true, filePaths: [] };
    asked.push('dir');
    await leave();
    return { canceled: false, filePaths: [target()] };
  };

  const click = async (sel) => {
    const r = await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const b = el.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    if (!r) throw new Error(`nothing to click at ${sel}`);
    const wc = wheel().webContents;
    wc.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
    await sleep(60);
    wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await sleep(40);
    wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  };
  const settle = async (ms = 240000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const s = await lime('return { state: L.S.state, card: !document.querySelector(".card").hidden, job: !!L.S.job };');
      if (s.state === 'done' || s.state === 'failed') return s.state;
      if (s.state === 'idle' && !s.job && Date.now() - t > 4000) return 'idle';
      await sleep(200);
    }
    return 'timeout';
  };
  const inside = (p) => path.resolve(p).startsWith(path.resolve(OUT) + path.sep);
  const nonEmpty = (p) => { const st = fs.statSync(p); return st.isDirectory() ? fs.readdirSync(p).length > 0 : st.size > 0; };

  const sets = [
    ['photo', [fx('photo.jpg')], ['convert', 'tools']],
    ['two photos', [fx('photo.jpg'), fx('photo2.jpg')], ['convert', 'tools'], ['hdr-merge', 'panorama']],
    ['brackets', ['hdr/bracket-0.dng', 'hdr/bracket-1.dng', 'hdr/bracket-2.dng'].map(fx), ['tools'], [], ['hdr-merge']],
    ['views', ['pano/view-0.png', 'pano/view-1.png', 'pano/view-2.png'].map(fx), ['tools'], [], ['panorama']],
    ['pdf', [fx('doc.pdf')], ['convert', 'tools']],
    ['word', [fx('doc.docx')], ['convert', 'tools']],
    ['sheet', [fx('sheet.xlsx')], ['convert', 'tools']],
    ['slides', [fx('deck.pptx')], ['convert', 'tools']],
    ['video', [fx('clip.mp4')], ['convert', 'tools']],
    ['audio', [fx('tone.wav')], ['convert', 'tools']],
    ['drawing', [fx('test.dxf')], ['convert', 'tools']],
    ['model', [fx('part.stp')], ['convert', 'tools']],
    ['vector', [fx('logo.svg')], ['convert']],
    ['archive', [fx('archive.zip')], ['convert', 'tools']],
    ['folder', [fx('folder')], ['convert', 'tools']],
  ].filter(([, files]) => files.every((f) => fs.existsSync(f)));

  const results = [];
  const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;
  const check = async (name, fn) => {
    if (only && !only.test(name)) return;
    const r = { name, status: 'PASS', detail: '' };
    try { r.detail = (await fn()) || ''; } catch (e) { r.status = e.skip ? 'SKIP' : 'FAIL'; r.detail = e.message; }
    console.log(`${r.status} ${name.padEnd(44)}        ${r.detail}`);
    results.push(r);
    await lime(`if (L.S.state !== 'idle' && L.S.state !== 'busy') await L.fold();`).catch(() => {});
    await sleep(500);
  };
  const until = async (code, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await lime(code)) return true; await sleep(100); } return false; };
  const wa = () => screen.getPrimaryDisplay().workArea;
  const dragIn = (wc, type = 'dragenter') => js(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.txt', { type: 'text/plain' })); window.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { dataTransfer: dt, bubbles: true, cancelable: true })); })()`, wc);
  await check('starts as the lime tab on the right edge', async () => {
    await until('return L.S.state === "idle"');
    const b = wheel().getBounds(), a = wa();
    if (b.width > 90 || b.height > 90) throw new Error(`tab window is ${b.width}×${b.height}`);
    if (Math.abs(b.x + b.width - (a.x + a.width)) > 1) throw new Error(`tab not at the right edge: ${b.x + b.width} vs ${a.x + a.width}`);
    return `${b.width}×${b.height} at x=${b.x}`;
  });
  await check('dragging a file onto the tab blooms the wheel', async () => {
    await dragIn(wheel().webContents);
    if (!(await until('return L.S.state === "ready"'))) throw new Error('did not open');
    await sleep(900);
    const b = wheel().getBounds(), a = wa();
    if (b.width < 300) throw new Error(`window ${b.width}×${b.height}`);
    if (b.x + b.width > a.x + a.width || b.x < a.x) throw new Error('wheel off screen');
    await dragIn(wheel().webContents, 'dragleave');
    if (!(await until('return L.S.state === "idle"', 4000))) throw new Error('did not fold back after the drag left');
    return `bloomed to ${b.width}×${b.height}, folded back`;
  });
  await check('bottom-left corner opens the wheel there', async () => {
    const sn = sensor();
    if (!sn) throw new Error('no corner sensor window');
    while (sn.webContents.isLoading()) await sleep(100);
    const sb = sn.getBounds(), a = wa();
    if (sb.x !== a.x || sb.y + sb.height !== a.y + a.height) throw new Error(`sensor at ${JSON.stringify(sb)}`);
    await dragIn(sn.webContents);
    if (!(await until('return L.S.state === "ready"'))) throw new Error('corner did not open the wheel');
    await sleep(900);
    const b = wheel().getBounds();
    if (b.x > a.x + 120 || b.y + b.height < a.y + a.height - 120) throw new Error(`wheel not near the corner: ${JSON.stringify(b)}`);
    return `wheel at ${b.x},${b.y}`;
  });
  await check('Shift-drag summons the wheel at the pointer', async () => {
    const a = wa(), at = { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) };
    summon('shift', at);
    if (!(await until('return L.S.state === "ready"'))) throw new Error('did not open');
    await sleep(900);
    const b = wheel().getBounds(), g = await lime('return L.geo();');
    const cx = b.x + 165, cy = b.y + 194;
    if (Math.abs(cx - at.x) > 2 || Math.abs(cy - at.y) > 2) throw new Error(`centre ${cx},${cy} vs pointer ${at.x},${at.y}`);
    wheel().webContents.send('wheel:dragEnded');
    if (!(await until('return L.S.state === "idle"', 3000))) throw new Error('did not fold when the drag ended');
    return `centred on ${at.x},${at.y}; folded on drag end${g ? '' : ''}`;
  });
  await check('system mouse and Shift readings', async () => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') throw Object.assign(new Error('only on Mac and Windows'), { skip: true });
    const w = watcher();
    if (!w) throw new Error('drag watcher did not start');
    const p = w.probe();
    if (typeof p.left !== 'boolean' || typeof p.shift !== 'boolean') throw new Error(`probe ${JSON.stringify(p)}`);
    if (process.platform === 'darwin' && !Number.isFinite(p.count)) throw new Error(`drag pasteboard count ${p.count}`);
    if (process.platform === 'win32' && !(Number.isFinite(p.x) && typeof p.at() === 'string' && typeof p.shellDrag() === 'boolean')) throw new Error('cursor or window lookup failed');
    return JSON.stringify({ left: p.left, shift: p.shift, ...(p.count != null ? { count: p.count } : { x: p.x, y: p.y, under: p.at() }) });
  });
  for (const [setName, files, modes, skipTools = [], onlyTools = null] of sets) {
    for (const mode of modes) {
      await lime(`await L.openWith(${JSON.stringify(files)});`);
      await sleep(1000);
      const ring = await lime(`L.setMode(${JSON.stringify(mode)}); return L.S.ring.map((it) => ({ label: it.label, hint: it.hint || '', tool: it.tool || null }));`);
      for (let i = 0; i < ring.length; i++) {
        const it = ring[i];
        const name = `${setName} · ${mode} · ${it.label}${it.hint ? ` ${it.hint}` : ''}`;
        if (only && !only.test(name)) continue;
        if (!it.tool || skipTools.includes(it.tool) || (onlyTools && !onlyTools.includes(it.tool))) continue;
        const t0 = Date.now();
        let status = 'PASS', detail = '';
        try {
          const tool = await lime(`return L.catalog[${JSON.stringify(it.tool)}];`);
          if (tool.editor) continue;
          await lime(`if (L.S.state !== 'idle') await L.collapse();`);
          await sleep(350);
          await lime(`await L.openWith(${JSON.stringify(files)}); L.setMode(${JSON.stringify(mode)});`);
          await sleep(1000);
          asked = [];
          await click(`.petal[data-i="${i}"] text.l`);
          await sleep(500);
          const card = await lime(`const c = document.querySelector('.card'); if (c.hidden) return null; const t = L.catalog[${JSON.stringify(it.tool)}]; return { required: [...c.querySelectorAll('[required]')].some((x) => !x.value) || (t.options || []).some((o) => o.required && c.querySelector('#o-' + o.key) && !c.querySelector('#o-' + o.key).value) };`);
          if (card) {
            if (card.required) { status = 'SKIP'; detail = 'needs typed input'; await lime('await L.collapse();'); }
            else await click('.card .foot .btn.primary');
          }
          if (status !== 'SKIP') {
            const end = await settle();
            const r = await lime('return { state: L.S.state, outs: L.S.result?.outs || [], note: L.S.result?.note || "", error: L.S.result?.error || "", text: !!L.S.result?.text };');
            if (end !== 'done') throw new Error(`${end}${r.error ? `: ${r.error}` : ''}`);
            if (r.outs.length) {
              if (!asked.length) throw new Error('saved without asking where');
              const missing = r.outs.filter((o) => !fs.existsSync(o));
              if (missing.length) throw new Error(`not on disk: ${missing.map((o) => path.basename(o))}`);
              const outside = r.outs.filter((o) => !inside(o));
              if (outside.length) throw new Error(`saved outside the chosen place: ${outside}`);
              const empty = r.outs.filter((o) => !nonEmpty(o));
              if (empty.length) throw new Error(`empty: ${empty.map((o) => path.basename(o))}`);
              for (const o of r.outs) if (/\.pdf$/i.test(o) && fs.statSync(o).isFile() && fs.readFileSync(o).subarray(0, 5).toString() !== '%PDF-') throw new Error(`${path.basename(o)} is not a valid PDF`);
              detail = `${asked.join('+')} → ${r.outs.map((o) => path.relative(OUT, o)).join(', ').slice(0, 120)}`;
            } else if (r.note || r.text) detail = (r.note || 'text result').split('\n')[0];
            else throw new Error('finished without a result');
          }
        } catch (e) { status = 'FAIL'; detail = e.message; }
        console.log(`${status} ${name.padEnd(44)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 240));
        results.push({ name, status, detail });
        await lime(`if (L.S.state !== 'idle') await L.collapse();`).catch(() => {});
      }
    }
  }

  const ord = { name: 'merge pdf · reorder in card', status: 'PASS', detail: '' };
  try {
    await lime(`if (L.S.state !== 'idle') await L.collapse();`);
    await sleep(350);
    await lime(`await L.openWith(${JSON.stringify([fx('scan.pdf'), fx('doc.pdf')])}); L.setMode('convert');`);
    await sleep(1000);
    let i = await lime('return L.S.ring.findIndex((x) => x.tool === "merge-pdf");');
    if (i < 0) { await lime('L.setMode("tools");'); await sleep(600); i = await lime('return L.S.ring.findIndex((x) => x.tool === "merge-pdf");'); }
    if (i < 0) throw new Error('no Merge petal for two PDFs');
    await click(`.petal[data-i="${i}"] text.l`);
    await sleep(500);
    if (!(await lime('return !!document.querySelector(".card .order li");'))) throw new Error('no order list in the card');
    await click('.card .order li[data-i="0"] [data-mv="1"]');
    await sleep(300);
    const order = await lime('return L.S.files.map((f) => f.split(/[\\/]/).pop());');
    if (order[0] !== 'doc.pdf') throw new Error(`order after move: ${order}`);
    asked = [];
    await click('.card .foot .btn.primary');
    if ((await settle()) !== 'done') throw new Error('merge did not finish');
    const [o] = await lime('return L.S.result.outs;');
    const { doc } = await require(path.join(__dirname, '..', 'src', 'main', 'engines', 'pdf')).readPdf(o);
    if (!doc.loadPage(0).toStructuredText('').asText().includes('Page 1')) throw new Error('merged PDF does not start with doc.pdf');
    ord.detail = `${order.join(' → ')} · ${path.relative(OUT, o)}`;
  } catch (e) { ord.status = 'FAIL'; ord.detail = e.message; }
  console.log(`${ord.status} ${ord.name.padEnd(44)}        ${ord.detail}`);
  results.push(ord);
  await lime(`if (L.S.state !== 'idle') await L.collapse();`).catch(() => {});

  const ed = { name: 'edit pdf · save', status: 'PASS', detail: '' };
  try {
    const src = path.join(OUT, 'editme.pdf');
    fs.copyFileSync(fx('doc.pdf'), src);
    openEditor(src, 'edit');
    const win = [...editors].pop();
    while (win.webContents.isLoading()) await sleep(200);
    const t = Date.now();
    while (!(await js('!!document.querySelector(\'[data-a="save"]\') && !document.querySelector(".busy")', win.webContents)) && Date.now() - t < 30000) await sleep(250);
    await sleep(800);
    await js('document.querySelector(\'[data-a="save"]\').click()', win.webContents);
    const want = path.join(OUT, 'editme (edited).pdf');
    const t2 = Date.now();
    while (!fs.existsSync(want) && Date.now() - t2 < 20000) await sleep(200);
    if (!fs.existsSync(want)) throw new Error('Save wrote nothing');
    await sleep(500);
    if (fs.readFileSync(want).subarray(0, 5).toString() !== '%PDF-') throw new Error('saved file is not a PDF');
    asked = [];
    await js('document.querySelector(\'[data-a="saveas"]\')?.click()', win.webContents);
    const t3 = Date.now();
    while (!asked.length && Date.now() - t3 < 5000) await sleep(100);
    if (asked.length) {
      const t4 = Date.now();
      let found = null;
      while (!found && Date.now() - t4 < 20000) { found = fs.readdirSync(OUT).map((d) => path.join(OUT, d, 'editme.pdf')).find((p) => fs.existsSync(p)); await sleep(200); }
      if (!found) throw new Error('Save As wrote nothing');
      ed.detail = `${path.relative(OUT, want)}, ${path.relative(OUT, found)}`;
    } else ed.detail = path.relative(OUT, want);
    win.destroy();
  } catch (e) { ed.status = 'FAIL'; ed.detail = e.message; }
  console.log(`${ed.status} ${ed.name.padEnd(44)}        ${ed.detail}`);
  results.push(ed);

  const again = { name: 'open Lime again while running', status: 'PASS', detail: '' };
  try {
    await lime(`if (L.S.state !== 'idle') await L.collapse();`);
    app.emit('second-instance', {}, [process.execPath]);
    app.emit('second-instance', {}, [process.execPath, '--some-flag']);
    app.emit('second-instance', {}, [process.execPath, fx('photo.jpg')]);
    const t = Date.now();
    while (Date.now() - t < 5000 && !(await lime('return L.S.files.length === 1 && L.S.state === "open";'))) await sleep(150);
    if (!(await lime('return L.S.files.length === 1 && L.S.state === "open";'))) throw new Error('file from the second launch did not open in the wheel');
    again.detail = 'no crash; file opened in the wheel';
    await lime('await L.collapse();');
  } catch (e) { again.status = 'FAIL'; again.detail = e.message; }
  console.log(`${again.status} ${again.name.padEnd(44)}        ${again.detail}`);
  results.push(again);

  const crafts = require(path.join(__dirname, '..', 'src', 'main', 'engines', 'crafts'));
  const { execFileSync } = require('child_process');
  const running = (exe) => {
    try {
      if (process.platform === 'darwin') return execFileSync('pgrep', ['-f', `${exe}/Contents/MacOS/`], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
      return execFileSync('powershell', ['-NoProfile', '-Command', `Get-Process | Where-Object { $_.Path -eq '${exe.replace(/'/g, "''")}' } | ForEach-Object { $_.Id }`], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
    } catch (_) { return []; }
  };
  const stopApp = (pids) => { for (const pid of pids) try { process.kill(Number(pid)); } catch (_) {} };
  openPrefs();
  const pw = prefs();
  while (pw.webContents.isLoading()) await sleep(200);
  await sleep(800);
  for (const { id, name } of crafts.status()) {
    await check(`settings · open ${name}`, async () => {
      const btn = `[data-a="app"][data-id="${id}"]`;
      if (!(await js(`!!document.querySelector('${btn}')`, pw.webContents))) {
        if (process.platform !== 'darwin' && process.platform !== 'win32') throw Object.assign(new Error('apps are bundled only on Mac and Windows'), { skip: true });
        throw new Error('no Open button in Settings');
      }
      await js(`document.querySelector('${btn}').click()`, pw.webContents);
      const t = Date.now();
      let label = '';
      while (Date.now() - t < 120000) { label = await js(`document.querySelector('${btn}').textContent`, pw.webContents); if (label !== 'Opening…') break; await sleep(250); }
      if (label !== 'Open') throw new Error(`${label}: ${await js(`document.querySelector('${btn}').title`, pw.webContents)}`);
      const exe = await crafts.bundledApp(id);
      await sleep(8000);
      const pids = running(exe);
      if (!pids.length) throw new Error(`${path.basename(exe)} is not running 8 s after opening`);
      stopApp(pids);
      return `${path.basename(exe)} running (pid ${pids.join(', ')}) in ${Math.round((Date.now() - t) / 1000)} s`;
    });
  }
  pw.close();

  const fail = results.filter((r) => r.status === 'FAIL'), skip = results.filter((r) => r.status === 'SKIP');
  console.log(`\n${results.length - fail.length - skip.length}/${results.length - skip.length} passed through the wheel${skip.length ? `, ${skip.length} skipped` : ''}`);
  fs.writeFileSync(path.join(dir, 'ui-report.json'), JSON.stringify(results, null, 1));
  app.isQuitting = true;
  app.exit(fail.length ? 1 : 0);
};
