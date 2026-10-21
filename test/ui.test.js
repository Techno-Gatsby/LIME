'use strict';
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async ({ wheel, sensor, watcher, summon, shiftSummon, setCursor, debug, dialog, BrowserWindow, app, openEditor, editors, openPrefs, prefs, peek, screen, dir }) => {
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
    if (b.width > 120 || b.height > 120) throw new Error(`tab window is ${b.width}×${b.height}`);
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
  await check('Shift-drag opens the wheel beside the file and it follows the drag', async () => {
    const a = wa(), cur = { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) };
    setCursor(() => ({ ...cur }));
    try {
      shiftSummon({ ...cur });
      if (!(await until('return L.S.state === "ready"'))) throw new Error('did not open');
      await sleep(900);
      const centre = () => { const b = wheel().getBounds(); return { x: b.x + 165, y: b.y + 194 }; };
      const c0 = centre(), d0 = Math.hypot(cur.x - c0.x, cur.y - c0.y);
      // Beside the pointer, outside the ring (radius 147), so neither the file nor what is under it is covered.
      if (d0 < 150 || d0 > 200) throw new Error(`pointer ${Math.round(d0)} px from the centre`);
      // Dragging on pulls it along on its leash…
      const away = Math.sign(cur.x - c0.x) || 1;
      cur.x += away * 260; cur.y += 40;
      await sleep(700);
      const c1 = centre(), d1 = Math.hypot(cur.x - c1.x, cur.y - c1.y);
      if (Math.hypot(c1.x - c0.x, c1.y - c0.y) < 200) throw new Error(`moved only ${Math.round(Math.hypot(c1.x - c0.x, c1.y - c0.y))} px`);
      if (Math.abs(d1 - d0) > 6) throw new Error(`leash ${Math.round(d0)} → ${Math.round(d1)} px`);
      // …and moving toward it leaves it still, so a slice is a short move in.
      cur.x = Math.round(c1.x + (cur.x - c1.x) * 0.45); cur.y = Math.round(c1.y + (cur.y - c1.y) * 0.45);
      await sleep(500);
      const c2 = centre();
      if (Math.hypot(c2.x - c1.x, c2.y - c1.y) > 1) throw new Error('it moved away from the pointer coming toward it');
      wheel().webContents.send('wheel:dragEnded');
      if (!(await until('return L.S.state === "idle"', 3000))) throw new Error('did not fold when the drag ended');
      return `opened ${Math.round(d0)} px beside the pointer; followed ${Math.round(Math.hypot(c1.x - c0.x, c1.y - c0.y))} px; held still when approached`;
    } finally { setCursor(() => screen.getCursorScreenPoint()); }
  });
  await check('the wheel moves when dragged anywhere, with or without files', async () => {
    const cur = { x: 0, y: 0 };
    setCursor(() => ({ ...cur }));
    const drag = async (sel) => {
      const r = await js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
      const wc = wheel().webContents, b0 = wheel().getBounds();
      Object.assign(cur, { x: b0.x + r.x, y: b0.y + r.y });
      wc.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
      wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await sleep(40);
      wc.sendInputEvent({ type: 'mouseMove', x: r.x + 12, y: r.y + 8, modifiers: ['leftButtonDown'] });
      await sleep(80);
      cur.x -= 70; cur.y -= 45;
      await sleep(250);
      wc.sendInputEvent({ type: 'mouseUp', x: r.x + 12, y: r.y + 8, button: 'left', clickCount: 1 });
      await sleep(200);
      const b1 = wheel().getBounds();
      return { dx: b1.x - b0.x, dy: b1.y - b0.y };
    };
    try {
      await lime('L.expand("click");');
      if (!(await until('return L.S.state === "ready" && L.S.ring.length === 8', 4000))) throw new Error('no apps around the lime');
      await sleep(800);
      const a = await drag('.petal[data-i="2"] text.l');
      const still = await lime('return { state: L.S.state, app: L.S.app };');
      if (Math.abs(a.dx + 70) > 2 || Math.abs(a.dy + 45) > 2) throw new Error(`empty wheel moved ${a.dx},${a.dy}`);
      if (still.app) throw new Error('the drag also picked the slice under it');
      await lime(`await L.openWith(${JSON.stringify([fx('doc.pdf')])});`);
      await sleep(700);
      const b = await drag('.petal[data-i="0"] text.l');
      const s2 = await lime('return { state: L.S.state, job: !!L.S.job, card: !document.querySelector(".card").hidden };');
      if (Math.abs(b.dx + 70) > 2 || Math.abs(b.dy + 45) > 2) throw new Error(`wheel with a file moved ${b.dx},${b.dy}`);
      if (s2.state !== 'open' || s2.job || s2.card) throw new Error(`the drag also ran the slice: ${JSON.stringify(s2)}`);
      return `moved ${a.dx},${a.dy} empty and ${b.dx},${b.dy} with a PDF; nothing picked`;
    } finally { setCursor(() => screen.getCursorScreenPoint()); }
  });
  await check('click opens the seven apps; each opens its own ring', async () => {
    await lime('L.expand("click");');
    if (!(await until('return L.S.state === "ready" && L.S.ring.length === 8', 4000))) throw new Error('no apps around the lime');
    await sleep(700);
    const home = await lime('return { labels: L.S.ring.map((x) => x.label), shown: [...document.querySelectorAll(".petal text.l")].filter((t) => getComputedStyle(t).display !== "none").length };');
    for (const n of ['PhotoCraft', 'LightCraft', 'VectorCraft', 'DesignCraft', 'EffectCraft', 'FilmCraft', 'PdfCraft', 'Recent']) if (!home.labels.includes(n)) throw new Error(`no ${n}: ${home.labels}`);
    if (home.shown !== 8) throw new Error(`${home.shown} of 8 labels visible`);
    const i = home.labels.indexOf('PdfCraft');
    await click(`.petal[data-i="${i}"] text.l`);
    if (!(await until('return L.S.app === "pdfcraft" && L.S.ring[0]?.label === "Open"', 3000))) throw new Error('PdfCraft did not open its ring');
    const ring = await lime('return { labels: L.S.ring.map((x) => x.label), back: document.querySelector(".pill [data-a=home]")?.textContent, cap: document.querySelector(".center .cap").textContent };');
    if (!ring.labels.includes('Optimize')) throw new Error(`PdfCraft ring ${ring.labels}`);
    if (!/All apps/.test(ring.back || '')) throw new Error('no way back to the apps');
    wheel().webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    if (!(await until('return !L.S.app && L.S.ring.length === 8', 2000))) throw new Error('Esc did not go back to the apps');
    return `${home.labels.join(', ')} · PdfCraft: ${ring.labels.join(', ')}`;
  });
  if (fs.existsSync(fx('photo.jpg'))) await check('hovering and progress update the middle in place', async () => {
    await lime(`await L.openWith(${JSON.stringify([fx('photo.jpg')])});`);
    if (!(await until('return !!document.querySelector(".center img.thumb")', 6000))) throw new Error('no thumbnail');
    const r = await lime(`
      const img = document.querySelector('.center img.thumb'), cap = document.querySelector('.center .cap');
      const frames = []; let last = performance.now(), on = true;
      const tick = (t) => { frames.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      const n = L.S.ring.length;
      for (let i = 0; i < n * 4; i++) { L.setHot(i % n); await new Promise((res) => setTimeout(res, 16)); }
      L.setHot(-1);
      const sameImg = document.querySelector('.center img.thumb') === img;
      // Progress ticks while a job runs change the words only: no new capsule, no restarted animation.
      L.S.state = 'busy'; L.S.job = { status: 'running', progress: 0 }; L.drawCenter();
      const busyCap = document.querySelector('.center .cap'), anims = new Set();
      for (let p = 1; p <= 40; p++) { L.S.job.progress = p / 40; L.drawCenter(); busyCap.getAnimations().forEach((a) => anims.add(a)); await new Promise((res) => setTimeout(res, 16)); }
      const text = busyCap.textContent;
      L.S.state = 'open'; L.S.job = null; L.drawCenter();
      on = false;
      frames.splice(0, 2);
      return { sameImg, sameCap: busyCap === cap, restarted: anims.size, text, worst: Math.round(Math.max(...frames)), frames: frames.length };`);
    if (!r.sameImg) throw new Error('the thumbnail was rebuilt while hovering');
    if (!r.sameCap) throw new Error('the capsule was rebuilt');
    if (r.restarted > 1) throw new Error(`the capsule re-animated on ${r.restarted} progress ticks`);
    if (!/100%/.test(r.text)) throw new Error(`progress shows ${r.text}`);
    return `thumbnail and capsule kept; worst frame ${r.worst} ms over ${r.frames} frames`;
  });
  await check('the ✕ at the top right folds the wheel back to the lime', async () => {
    const out = [];
    for (const [name, open] of [['apps', 'L.expand("click");'], ['a PDF', `await L.openWith(${JSON.stringify([fx('doc.pdf')])});`], ['a drag', 'L.expand("edge");']]) {
      await lime(open);
      if (!(await until('return L.S.state !== "idle"', 3000))) throw new Error(`${name}: did not open`);
      await sleep(700);
      const r = await js(`(() => { const c = document.querySelector('.close'), b = c.getBoundingClientRect(), p = document.querySelector('.pill').getBoundingClientRect(); return { shown: getComputedStyle(c).display !== 'none', inside: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, overPill: p.width > 0 && b.left < p.right && b.right > p.left && b.top < p.bottom && b.bottom > p.top }; })()`);
      if (!r.shown) throw new Error(`${name}: no ✕`);
      if (!r.inside) throw new Error(`${name}: the ✕ is outside the window`);
      if (r.overPill) throw new Error(`${name}: the ✕ covers the tabs`);
      await click('.close');
      if (!(await until('return L.S.state === "idle" && !L.folding()', 3000))) throw new Error(`${name}: the ✕ did not fold the wheel`);
      await sleep(500);
      out.push(name);
    }
    return `folds from ${out.join(', ')}`;
  });
  if (fs.existsSync(fx('doc.pdf'))) await check('a dropped PDF has an Apps tab with PdfCraft', async () => {
    await lime(`await L.openWith(${JSON.stringify([fx('doc.pdf')])});`);
    await sleep(600);
    const tabs = await js('[...document.querySelectorAll(".pill button[data-m]")].map((b) => b.textContent)');
    if (!tabs.includes('Apps')) throw new Error(`tabs ${tabs}`);
    await click('.pill button[data-m="apps"]');
    await sleep(500);
    const list = await lime('return L.S.ring.map((x) => x.label);');
    if (list[0] !== 'PdfCraft') throw new Error(`apps for a PDF: ${list}`);
    await click('.petal[data-i="0"] text.l');
    if (!(await until('return L.S.app === "pdfcraft"', 2000))) throw new Error('PdfCraft did not open');
    const r = await lime('return { labels: L.S.ring.map((x) => x.label), tab: document.querySelector(".pill button[data-m=apps]").textContent };');
    if (!r.labels.includes('PDF/A') || r.tab !== 'PdfCraft') throw new Error(JSON.stringify(r));
    return `apps: ${list.join(', ')} · PdfCraft: ${r.labels.join(', ')}`;
  });
  await check('system mouse and Shift readings', async () => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') throw Object.assign(new Error('only on Mac and Windows'), { skip: true });
    const w = watcher();
    if (!w) throw new Error('drag watcher did not start');
    const p = w.probe();
    if (typeof p.left !== 'boolean' || typeof p.shift !== 'boolean') throw new Error(`probe ${JSON.stringify(p)}`);
    if (process.platform === 'darwin' && !Number.isFinite(p.count)) throw new Error(`drag pasteboard count ${p.count}`);
    if (process.platform === 'darwin') w.probe.haptic();
    if (process.platform === 'win32' && !(Number.isFinite(p.x) && typeof p.at() === 'string' && typeof p.shellDrag() === 'boolean')) throw new Error('cursor or window lookup failed');
    return JSON.stringify({ left: p.left, shift: p.shift, ...(p.count != null ? { count: p.count } : { x: p.x, y: p.y, under: p.at() }) });
  });
  const dragAt = (type, sel, extra = {}) => js(`(() => {
    const L = window.__lime, el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const b = el.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2;
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.txt', { type: 'text/plain' }));
    (document.elementFromPoint(x, y) || window).dispatchEvent(new DragEvent(${JSON.stringify(type)}, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true, ...${JSON.stringify(extra)} }));
    return { x, y, hot: L.S.hot, mode: L.S.mode, state: L.S.state };
  })()`);
  const summonWith = async (files) => {
    const a = wa();
    peek(files);
    summon('shift', { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) });
    if (!(await until('return L.S.state === "ready" && !!L.S.peek && L.S.ring.length > 0', 6000))) throw new Error('no choices while dragging');
    await sleep(500);
    await dragAt('dragenter', '.center');
  };
  const endDrag = async () => { await dragAt('dragleave', '.center'); wheel().webContents.send('wheel:dragEnded'); await until('return L.S.state === "idle"', 3000); };
  if (fs.existsSync(fx('photo.jpg'))) {
    await check('Shift-drag shows choices for the dragged file', async () => {
      await summonWith([fx('photo.jpg')]);
      const r = await lime('return { labels: L.S.ring.map((x) => x.label), shown: [...document.querySelectorAll(".petal text.l")].filter((t) => getComputedStyle(t).display !== "none").length, cap: document.querySelector(".caption .name").textContent };');
      if (!r.labels.includes('PNG')) throw new Error(`ring ${r.labels}`);
      if (r.shown !== r.labels.length) throw new Error(`${r.shown} of ${r.labels.length} labels visible`);
      if (r.cap !== 'photo.jpg') throw new Error(`caption ${r.cap}`);
      await endDrag();
      return `${r.labels.length} choices: ${r.labels.join(', ')}`;
    });
    await check('hovering a slice while dragging highlights it', async () => {
      await summonWith([fx('photo.jpg')]);
      const i = await lime('return L.S.ring.findIndex((x) => x.label === "PNG");');
      const r = await dragAt('dragover', `.petal[data-i="${i}"] text.l`);
      const meta = await lime('return document.querySelector(".caption .meta").textContent;');
      await endDrag();
      if (r.hot !== i) throw new Error(`hot ${r.hot}, wanted ${i}`);
      if (!/^Release to convert to PNG/.test(meta)) throw new Error(`caption says ${meta}`);
      return meta;
    });
    await check('Option or Alt switches to Tools while dragging', async () => {
      await summonWith([fx('photo.jpg')]);
      const a = await dragAt('dragover', '.center', { altKey: true });
      const b = await dragAt('dragover', '.center', { altKey: false });
      const c = await dragAt('dragover', '.center', { ctrlKey: true });
      await endDrag();
      if (a.mode !== 'tools' || b.mode !== 'convert' || c.mode !== 'more') throw new Error(`modes ${a.mode}, ${b.mode}, ${c.mode}`);
      return 'Alt → Tools, release → Convert, Ctrl → More';
    });
    await check('holding over a tab switches the ring', async () => {
      await summonWith([fx('photo.jpg')]);
      const t = Date.now();
      let r;
      while (Date.now() - t < 900) { r = await dragAt('dragover', '.pill button[data-m="tools"]'); if (r?.mode === 'tools') break; await sleep(50); }
      const ms = Date.now() - t;
      await endDrag();
      if (r?.mode !== 'tools') throw new Error(`still ${r?.mode}`);
      return `switched after ${ms} ms`;
    });
    await check('dropping on a slice converts in one gesture', async () => {
      await summonWith([fx('photo.jpg')]);
      const i = await lime('return L.S.ring.findIndex((x) => x.label === "PNG");');
      await dragAt('dragover', `.petal[data-i="${i}"] text.l`);
      asked = [];
      await dragAt('drop', `.petal[data-i="${i}"] text.l`);
      const end = await settle();
      const r = await lime('return { outs: L.S.result?.outs || [], error: L.S.result?.error || "" };');
      if (end !== 'done') throw new Error(`${end} ${r.error}`);
      const [o] = r.outs;
      if (!o || !fs.existsSync(o) || !inside(o)) throw new Error(`output ${o}`);
      if (fs.readFileSync(o).subarray(1, 4).toString() !== 'PNG') throw new Error('not a PNG');
      return `${asked.join('+')} → ${path.relative(OUT, o)}`;
    });
    await check('dropping in the middle opens all choices', async () => {
      await summonWith([fx('photo.jpg')]);
      await dragAt('drop', '.center');
      const ok = await until('return L.S.state === "open" && L.S.files.length === 1', 4000);
      if (!ok) throw new Error(`state ${await lime('return L.S.state;')}`);
      await lime('await L.collapse();');
      return 'open with photo.jpg';
    });
  }
  // Stress: the wheel must always come back to one lime at the edge that opens again, whatever order things happen in.
  const wheels = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isWheel).length;
  const healthy = async (label) => {
    if (!(await until('return L.S.state === "idle" && !L.folding()', 8000))) throw new Error(`${label}: stuck in ${await lime('return L.S.state;')}`);
    await sleep(900);
    const b = wheel().getBounds(), a = wa();
    const r = await lime('const t = document.querySelector(".tab"), cs = getComputedStyle(t); return { shown: cs.display !== "none" && cs.visibility !== "hidden", over: L.S.over, cls: document.querySelector("#stage").className };');
    if (wheels() !== 1) throw new Error(`${label}: ${wheels()} wheel windows`);
    if (b.width > 120 || b.height > 120 || Math.abs(b.x + b.width - (a.x + a.width)) > 1) throw new Error(`${label}: the lime is ${b.width}×${b.height} at ${b.x},${b.y}, not at the edge`);
    if (!r.shown) throw new Error(`${label}: the lime is hidden (${r.cls})`);
    if (r.over) throw new Error(`${label}: still thinks files are over it`);
    // And it still opens, by a drag and by a click.
    await dragIn(wheel().webContents);
    if (!(await until('return L.S.state === "ready"', 3000))) throw new Error(`${label}: a drag onto the lime didn't open the wheel`);
    await sleep(700);
    if (wheel().getBounds().width < 300) throw new Error(`${label}: opened but the window stayed small: ${JSON.stringify({ bounds: wheel().getBounds(), main: debug(), page: await lime('return { state: L.S.state, cls: document.querySelector("#stage").className, geo: L.geo() };') })}`);
    await dragIn(wheel().webContents, 'dragleave');
    if (!(await until('return L.S.state === "idle" && !L.folding()', 5000))) throw new Error(`${label}: didn't fold after the drag left`);
    await sleep(600);
    await click('.tab');
    if (!(await until('return L.S.state === "ready" && L.S.ring.length === 8', 3000))) throw new Error(`${label}: a click on the lime didn't open the apps`);
    wheel().webContents.sendInputEvent({ type: 'mouseLeave', x: -20, y: -20 });
    await lime('await L.fold();');
    await until('return L.S.state === "idle" && !L.folding()', 3000);
  };
  await check('stress · 400 random opens, folds, drags, drops, keys and moves', async () => {
    const errs = [];
    const onMsg = (e, level, message) => { const lv = e?.level ?? level, msg = e?.message ?? message; if (lv === 3 || lv === 'error') errs.push(String(msg).slice(0, 160)); };
    wheel().webContents.on('console-message', onMsg);
    const files = [fx('photo.jpg'), fx('doc.pdf')].filter((f) => fs.existsSync(f));
    let seed = 20261021;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const a = wa(), mid = { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) };
    const key = (k) => wheel().webContents.sendInputEvent({ type: 'keyDown', keyCode: k });
    const acts = [
      () => lime('L.expand("click");'),
      () => lime('L.fold();'),
      () => dragIn(wheel().webContents),
      () => dragIn(wheel().webContents, 'dragleave'),
      () => dragAt('dragenter', '.petal[data-i="1"]'),
      () => dragAt('dragover', '.petal[data-i="2"]', { altKey: rnd() > 0.5 }),
      () => { peek([files[0]]); return lime(`L.setPeek(${JSON.stringify([files[0]])});`); },
      () => lime(`L.openWith(${JSON.stringify([files[Math.floor(rnd() * files.length)]])});`),
      () => lime(`L.setMode(${JSON.stringify(['convert', 'tools', 'apps', 'more'][Math.floor(rnd() * 4)])});`),
      () => wheel().webContents.send('wheel:dragEnded'),
      () => shiftSummon({ x: mid.x + Math.round((rnd() - 0.5) * 600), y: mid.y + Math.round((rnd() - 0.5) * 400) }),
      () => summon('corner', { x: a.x + 200, y: a.y + a.height - 240 }),
      () => lime('if (L.S.ring.length) L.setHot(Math.floor(Math.random() * L.S.ring.length));'),
      () => lime('L.collapse();'),
      () => lime('if (L.atHome()) { L.S.app = ["pdfcraft", "photocraft", null][Math.floor(Math.random() * 3)]; L.redraw(); }'),
      () => key('Escape'),
      () => key('Tab'),
      () => key('Right'),
      () => wheel().webContents.send('settings', { theme: 'light', size: ['s', 'm', 'l'][Math.floor(rnd() * 3)] }),
    ];
    const counts = new Array(acts.length).fill(0);
    for (let i = 0; i < 400; i++) {
      const n = Math.floor(rnd() * acts.length);
      counts[n]++;
      await Promise.resolve(acts[n]()).catch(() => {});
      await sleep(Math.floor(rnd() * 90));
    }
    wheel().webContents.send('settings', { theme: 'light', size: 'm' });
    wheel().webContents.send('wheel:dragEnded');
    await lime('await L.collapse();').catch(() => {});
    await healthy('after 400 random steps');
    wheel().webContents.off('console-message', onMsg);
    if (errs.length) throw new Error(`${errs.length} page errors: ${[...new Set(errs)].slice(0, 3).join(' · ')}`);
    return `400 steps (${counts.join('/')}), then one lime at the edge that opens by drag and click`;
  });
  await check('stress · dragging across redrawn slices never stops the lime opening', async () => {
    for (let round = 0; round < 25; round++) {
      await dragIn(wheel().webContents);
      if (!(await until('return L.S.state === "ready"', 3000))) throw new Error(`round ${round}: the drag didn't open the wheel`);
      if (fs.existsSync(fx('photo.jpg'))) { peek([fx('photo.jpg')]); await lime(`await L.setPeek(${JSON.stringify([fx('photo.jpg')])});`); }
      // Enter a slice, then redraw the ring under the pointer (switching rings, as Alt or Ctrl do): the old slice is
      // gone without ever reporting a leave. Then the drag leaves the window.
      await dragAt('dragenter', '.petal[data-i="0"]');
      await dragAt('dragover', '.petal[data-i="0"]', { altKey: round % 2 === 0, ctrlKey: round % 3 === 0 });
      await dragAt('dragenter', '.petal[data-i="1"]');
      await dragAt('dragleave', '.petal[data-i="1"]');
      if (!(await until('return L.S.state === "idle" && !L.folding()', 4000))) throw new Error(`round ${round}: didn't fold after the drag left (over=${await lime('return L.S.over;')})`);
    }
    await healthy('after 25 drags');
    return '25 drags across redrawn slices; it folded every time and still opens';
  });
  await check('stress · 60 quick open-and-leave cycles at random speeds', async () => {
    let seed = 99;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 60; i++) {
      await dragIn(wheel().webContents);
      await sleep(Math.floor(rnd() * 400));
      await dragIn(wheel().webContents, 'dragleave');
      await sleep(Math.floor(rnd() * 1800));
      // Whatever moment it is caught in, the page and the window agree.
      const st = await lime('return { s: L.S.state, f: L.folding() };'), w = wheel().getBounds().width;
      if (st.s === 'idle' && !st.f && w > 120) { await sleep(400); if (wheel().getBounds().width > 120 && (await lime('return L.S.state === "idle" && !L.folding();'))) throw new Error(`cycle ${i}: idle but the window is ${w} wide`); }
      if (wheels() !== 1) throw new Error(`cycle ${i}: ${wheels()} wheel windows`);
    }
    await healthy('after 60 cycles');
    return '60 cycles; page and window always agreed; one lime';
  });
  await check('a crashed wheel comes back by itself', async () => {
    const before = wheel();
    before.webContents.forcefullyCrashRenderer();
    const t = Date.now();
    while (Date.now() - t < 10000 && (wheel() === before || !wheel() || wheel().webContents.isLoading())) await sleep(200);
    if (wheel() === before) throw new Error('the crashed wheel was not replaced');
    await sleep(1800);
    await healthy('after the crash');
    return `replaced in ${Date.now() - t} ms; works`;
  });
  await check('reads the files being dragged from the system', async () => {
    const w = watcher();
    if (process.platform !== 'darwin' && process.platform !== 'win32') throw Object.assign(new Error('only on Mac and Windows'), { skip: true });
    if (!w) throw new Error('drag watcher did not start');
    // A folder of its own, where the file isn't the first item, so the selection can't be mistaken for the first item.
    const dir = path.join(OUT, 'drag-selection');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a first.txt'), 'first');
    const want = path.join(dir, 'photo.jpg');
    fs.copyFileSync(fx('photo.jpg'), want);
    if (process.platform === 'darwin') {
      const koffi = require('koffi'), objc = koffi.load('/usr/lib/libobjc.A.dylib');
      const cls = objc.func('void *objc_getClass(const char *name)'), sel = objc.func('void *sel_registerName(const char *name)');
      const obj = objc.func('objc_msgSend', 'void *', ['void *', 'void *']), withStr = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'const char *']), withObj = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']);
      const board = withObj(cls('NSPasteboard'), sel('pasteboardWithName:'), withStr(cls('NSString'), sel('stringWithUTF8String:'), 'Apple CFPasteboard drag'));
      const url = withObj(cls('NSURL'), sel('fileURLWithPath:'), withStr(cls('NSString'), sel('stringWithUTF8String:'), want));
      obj(board, sel('clearContents'));
      withObj(board, sel('writeObjects:'), withObj(cls('NSArray'), sel('arrayWithObject:'), url));
    } else {
      require('child_process').spawn('explorer.exe', [`/select,${want}`], { detached: true, stdio: 'ignore' }).unref();
      await sleep(4000);
    }
    let got = [];
    if (process.platform === 'darwin') got = await w.files();
    else {
      const koffi = require('koffi'), user32 = koffi.load('user32.dll');
      const find = user32.func('void * __stdcall FindWindowW(const char16_t *cls, const char16_t *title)');
      const child = user32.func('void * __stdcall FindWindowExW(void *parent, void *after, const char16_t *cls, const char16_t *title)');
      const text = user32.func('int __stdcall GetWindowTextW(void *hwnd, _Out_ uint16_t *buf, int max)');
      const post = user32.func('bool __stdcall PostMessageW(void *hwnd, uint32_t msg, uintptr_t w, intptr_t l)');
      const h = find('CabinetWClass', null);
      if (!h) throw new Error('Explorer did not open a window');
      // Select the file through Explorer's own selection API (select it alone, focus it): Explorer's /select switch
      // isn't applied reliably on CI machines, and this is what the reader must report.
      require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$w = @((New-Object -ComObject Shell.Application).Windows() | Where-Object { [int64]$_.HWND -eq ${Number(koffi.address(h))} })[0]; $w.Document.SelectItem($w.Document.Folder.ParseName('${path.basename(want)}'), 29)`], { windowsHide: true, timeout: 20000 });
      const tab = child(h, null, 'ShellTabWindowClass', null), b = new Uint16Array(260);
      const title = tab ? String.fromCharCode(...b.subarray(0, text(tab, b, 260))) : '';
      const t = Date.now();
      // Explorer opens with the folder's first item selected and moves to the file a moment later, so wait for it.
      while (!(got.length === 1 && path.basename(got[0]) === path.basename(want)) && Date.now() - t < 15000) { got = await require(path.join(__dirname, '..', 'src', 'main', 'shellsel')).query([{ hwnd: Number(koffi.address(h)), tab: title }]); if (got[0] !== want) await sleep(1000); }
      post(h, 0x0010, 0, 0);
    }
    // Windows may name the same folder by its short 8.3 name (RUNNER~1) or its long one, so compare real paths.
    const real = (p) => { try { return fs.realpathSync.native(p).toLowerCase(); } catch (_) { return path.resolve(p).toLowerCase(); } };
    if (!got.some((g) => real(g) === real(want))) throw new Error(`got ${JSON.stringify(got)}`);
    return got.join(', ');
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
    const order = await lime('return L.S.files.map((f) => f.split(/[\\\\/]/).pop());');
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

  // Every options card, in every variant that reveals more options, with "More options" open: nothing overlaps,
  // no label or button is cut off, nothing runs off the side, and the Cancel/Convert bar never hides a control.
  await check('options cards · no overlapping or cut-off text', async () => {
    await lime(`if (L.S.state !== 'idle') await L.collapse();`);
    await sleep(350);
    await lime(`await L.openWith(${JSON.stringify([fx('photo.jpg')])});`);
    await sleep(800);
    const bad = await lime(`
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const card = document.querySelector('.card'), out = [];
      const ATOMS = 'label.label, .seg, input.input, select, textarea, .btn, .switch, .range, summary, .head h3, .desc, .chips, .order';
      const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      for (const t of Object.values(L.catalog)) {
        if (!(t.options || []).length || t.editor) continue;
        const base = Object.fromEntries(t.options.map((o) => [o.key, o.default]));
        const variants = new Map([[JSON.stringify(base), base]]);
        for (const o of t.options) if (o.when) { const v = { ...base }; for (const [k, vals] of Object.entries(o.when)) v[k] = Array.isArray(vals) ? vals[0] : vals; variants.set(JSON.stringify(v), v); }
        for (const [key, v] of variants) {
          L.showOptions(t, { ...v });
          await frame();
          card.querySelectorAll('details').forEach((d) => { d.open = true; });
          await frame(); await frame();
          const tag = t.id + (key === JSON.stringify(base) ? '' : ' ' + Object.entries(v).filter(([k, x]) => x !== base[k]).map(([k, x]) => k + '=' + x).join(','));
          const cr = card.getBoundingClientRect();
          for (const sel of ['.caption', '.pill', '.wheel']) { const el = document.querySelector(sel); if (el && el.offsetParent && getComputedStyle(el).display !== 'none' && getComputedStyle(el).opacity !== '0') { const r = el.getBoundingClientRect(); if (r.width && hit(r, cr)) out.push(tag + ': the card covers ' + sel); } }
          if (card.scrollWidth > card.clientWidth + 1) { const edge = card.getBoundingClientRect().right - parseFloat(getComputedStyle(card).paddingRight), wide = [...card.querySelectorAll('*')].filter((el) => el.offsetParent && !el.matches('.foot, .search') && el.getBoundingClientRect().right > edge + 1).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0]; out.push(tag + ': ' + (wide ? wide.tagName.toLowerCase() + '.' + wide.className + ' "' + (wide.textContent || '').trim().slice(0, 40) + '"' : 'something') + ' runs off the side by ' + (card.scrollWidth - card.clientWidth) + 'px'); }
          for (const el of card.querySelectorAll('.seg > button, .btn, label.label, .head h3, .switch > span, summary')) if (el.offsetParent && el.scrollWidth > el.clientWidth + 1) out.push(tag + ': cut off "' + el.textContent.trim() + '"');
          const atoms = [...card.querySelectorAll(ATOMS)].filter((el) => el.offsetParent && !el.closest('.foot'));
          const boxes = atoms.map((el) => el.getBoundingClientRect());
          for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
            if (atoms[i].contains(atoms[j]) || atoms[j].contains(atoms[i])) continue;
            if (hit(boxes[i], boxes[j])) out.push(tag + ': "' + (atoms[i].textContent || atoms[i].value || atoms[i].className).trim().slice(0, 24) + '" overlaps "' + (atoms[j].textContent || atoms[j].value || atoms[j].className).trim().slice(0, 24) + '"');
          }
          card.scrollTop = card.scrollHeight;
          await frame();
          const foot = card.querySelector('.foot')?.getBoundingClientRect(), last = atoms.map((el) => el.getBoundingClientRect()).reduce((a, b) => (b.bottom > (a?.bottom ?? -1) ? b : a), null);
          if (foot && last && last.bottom > foot.top + 0.5) out.push(tag + ': the button bar covers the last control');
          if (foot && getComputedStyle(card.querySelector('.foot')).backgroundColor.replace(/\\s/g, '').match(/rgba\\(.*,0\\)$|transparent/)) out.push(tag + ': the button bar is see-through');
        }
      }
      await L.collapse();
      return out;`);
    if (bad.length) throw new Error(`${bad.length} problems: ${bad.slice(0, 6).join(' · ')}`);
    return 'every card and variant is clean';
  });
  // Every wheel ring for every kind of file: each label and hint sits inside its own slice and they don't touch.
  await check('wheel rings · labels stay inside their slices', async () => {
    const kinds = ['photo.jpg', 'anim.gif', 'cursor.cur', 'photo.heic', 'raw.dng', 'doc.pdf', 'doc.docx', 'doc.md', 'sheet.xlsx', 'sheet.csv', 'deck.pptx', 'clip.mp4', 'tone.wav', 'test.dxf', 'part.stp', 'cube.fbx', 'logo.svg', 'archive.zip', 'notes.txt.gz', 'folder',
      'font.ttf', 'mail.eml', 'meeting.msg', 'page.mhtml', 'novel.epub', 'stormy.mobi', 'comic.cbz', 'data.json', 'config.yml', 'contacts.vcf', 'sub.srt', 'timeline.otio', 'anim.json'].map(fx).filter((f) => fs.existsSync(f));
    const sets = [...kinds.map((f) => [f]), [fx('photo.jpg'), fx('photo2.jpg')], [fx('doc.pdf'), fx('v1.pdf')], [fx('clip.mp4'), fx('tone.wav')], [fx('doc.docx'), fx('doc.pdf')]];
    const bad = [];
    let rings = 0;
    for (const files of sets) {
      await lime(`if (L.S.state !== 'idle') await L.collapse();`);
      await sleep(250);
      await lime(`await L.openWith(${JSON.stringify(files)});`);
      await sleep(700);
      const appIds = await lime('return (L.S.items?.apps || []).map((a) => a.id);');
      for (const mode of ['convert', 'tools', 'apps', ...appIds.map((id) => `apps:${id}`), 'more']) {
        const r = await lime(`
          L.S.app = ${JSON.stringify(mode.split(':')[1] || null)};
          L.setMode(${JSON.stringify(mode.split(':')[0])});
          await new Promise((res) => setTimeout(res, 450));
          const out = [], name = ${JSON.stringify(files.map((f) => path.basename(f)).join('+'))} + ' · ' + ${JSON.stringify(mode)};
          const petals = [...document.querySelectorAll('.petal[data-i]')];
          for (const g of petals) {
            const glass = g.querySelector('path.glass'), texts = [...g.querySelectorAll('text')];
            for (const t of texts) {
              const b = t.getBBox(), inset = 0.6;
              const corners = [[b.x + inset, b.y + inset], [b.x + b.width - inset, b.y + inset], [b.x + inset, b.y + b.height - inset], [b.x + b.width - inset, b.y + b.height - inset]];
              if (b.width && corners.some(([x, y]) => !glass.isPointInFill(new DOMPoint(x, y)))) out.push(name + ': "' + t.textContent + '" spills out of its slice');
            }
            if (texts.length === 2) { const [a, c] = texts.map((t) => t.getBBox()); if (a.y < c.y + c.height - 0.5 && c.y < a.y + a.height - 0.5 && a.x < c.x + c.width && c.x < a.x + a.width) out.push(name + ': "' + texts[0].textContent + '" touches its hint'); }
          }
          // The file name and its details under the wheel must fit in the window, shadows included.
          for (const el of document.querySelectorAll('.caption > *')) { const b = el.getBoundingClientRect(); if (b.height && b.bottom > innerHeight - 4) out.push(name + ': "' + el.textContent + '" is cut off at the bottom'); }
          return { n: petals.length, out };`);
        if (r.n) rings++;
        bad.push(...r.out);
      }
    }
    // The apps around the lime, and each app's own ring.
    await lime(`if (L.S.state !== 'idle') await L.collapse();`);
    await sleep(250);
    await lime('L.expand("click"); await L.loadHome();');
    await sleep(700);
    for (const id of [null, 'photocraft', 'lightcraft', 'vectorcraft', 'designcraft', 'effectcraft', 'filmcraft', 'pdfcraft']) {
      const r = await lime(`
        L.S.app = ${JSON.stringify(id)}; L.redraw();
        await new Promise((res) => setTimeout(res, 450));
        const out = [], name = 'home · ' + ${JSON.stringify(id || 'apps')};
        for (const g of document.querySelectorAll('.petal[data-i]')) {
          const glass = g.querySelector('path.glass');
          for (const t of g.querySelectorAll('text')) { const b = t.getBBox(), i = 0.6; if (b.width && [[b.x + i, b.y + i], [b.x + b.width - i, b.y + i], [b.x + i, b.y + b.height - i], [b.x + b.width - i, b.y + b.height - i]].some(([x, y]) => !glass.isPointInFill(new DOMPoint(x, y)))) out.push(name + ': "' + t.textContent + '" spills out of its slice'); }
        }
        return { n: document.querySelectorAll('.petal[data-i]').length, out };`);
      if (r.n) rings++;
      bad.push(...r.out);
    }
    await lime(`if (L.S.state !== 'idle') await L.collapse();`);
    if (bad.length) throw new Error(`${bad.length} problems: ${[...new Set(bad)].slice(0, 6).join(' · ')}`);
    return `${rings} rings checked`;
  });
  await check('sheet print · choose cells in the picker', async () => {
    if (!fs.existsSync(fx('print.xlsx'))) throw Object.assign(new Error('no print.xlsx'), { skip: true });
    await lime(`if (L.S.state !== 'idle') await L.collapse();`);
    await sleep(350);
    await lime(`await L.openWith(${JSON.stringify([fx('print.xlsx')])}); L.setMode('convert');`);
    await sleep(1000);
    const i = await lime('return L.S.ring.findIndex((x) => x.tool === "convert-sheet" && x.opts?.to === "pdf");');
    if (i < 0) throw new Error('no PDF petal for a workbook');
    await click(`.petal[data-i="${i}"] text.l`);
    await sleep(500);
    if (await js('document.querySelector(".card #o-print")?.tagName === "SELECT"')) await js('(() => { const el = document.querySelector(".card #o-print"); el.value = "selection"; el.dispatchEvent(new Event("change", { bubbles: true })); })()');
    else await click('.card [data-v="selection"]');
    await sleep(300);
    await click('.card #o-cells + button');
    let pk = null;
    for (let t = 0; t < 60 && !pk; t++) { await sleep(200); pk = BrowserWindow.getAllWindows().find((w) => /picker\.html/.test(w.webContents.getURL()) && !w.webContents.isLoading()) || null; }
    if (!pk) throw new Error('the cell picker did not open');
    const wc = pk.webContents, pjs = (code) => js(code, wc);
    for (let t = 0; t < 60 && !(await pjs('!!document.querySelector("td[data-r]")')); t++) await sleep(200);
    const tabs = await pjs('[...document.querySelectorAll("#tabs button")].map((b) => b.textContent).join()');
    if (tabs !== 'Budget,Summary') throw new Error(`sheet tabs ${tabs}`);
    const pos = (sel) => pjs(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    const press = async (p, type, extra = {}) => { wc.sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1, ...extra }); await sleep(70); };
    const a = await pos('td[data-r="2"][data-c="1"]'), b = await pos('td[data-r="5"][data-c="2"]');
    await press(a, 'mouseMove'); await press(a, 'mouseDown'); await press(b, 'mouseMove', { modifiers: ['leftButtonDown'] }); await press(b, 'mouseUp');
    const picked = await pjs('document.querySelector("#range").value');
    if (picked !== 'Budget!B3:C6') throw new Error(`the picker shows ${picked}`);
    const u = await pos('[data-a="use"]');
    const cover = await pjs(`(() => { const el = document.elementFromPoint(${u.x}, ${u.y}); return el?.closest('[data-a="use"]') ? '' : (el ? el.tagName + '.' + el.className : 'nothing') + ' at ${u.x},${u.y} in ' + innerWidth + '×' + innerHeight; })()`);
    if (cover) throw new Error(`Use Selection is covered or off-screen: ${cover}`);
    await press(u, 'mouseMove'); await press(u, 'mouseDown'); await press(u, 'mouseUp');
    for (let t = 0; t < 40 && !pk.isDestroyed(); t++) await sleep(100);
    if (!pk.isDestroyed()) throw new Error('the picker stayed open');
    const val = await js('document.querySelector(".card #o-cells").value');
    if (val !== picked) throw new Error(`the Cells field shows ${val}`);
    asked = [];
    await click('.card .foot .btn.primary');
    if ((await settle()) !== 'done') throw new Error(await lime('return L.S.result?.error || "did not finish";'));
    const [o] = await lime('return L.S.result.outs;');
    if (!asked.length || !inside(o)) throw new Error('not saved where asked');
    const { doc } = await require(path.join(__dirname, '..', 'src', 'main', 'engines', 'pdf')).readPdf(o);
    const t = doc.loadPage(0).toStructuredText('').asText();
    if (doc.countPages() !== 1 || !t.includes('3,703.50') || !t.includes('12.50%') || t.includes('Item 1')) throw new Error(`printed ${doc.countPages()} pages: ${t.slice(0, 120)}`);
    return `${picked} → ${path.relative(OUT, o)}`;
  });

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

  const sel = { name: 'edit pdf · select and remove a table and a picture', status: 'PASS', detail: '' };
  try {
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const sharp = require('sharp');
    const doc = await PDFDocument.create(), page = doc.addPage([400, 500]), f = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('A paragraph of free text above the table.', { x: 30, y: 460, size: 11, font: f });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      page.drawRectangle({ x: 30 + c * 120, y: 380 - r * 24, width: 120, height: 24, color: r === 1 ? rgb(0.85, 0.93, 0.8) : rgb(1, 1, 1), borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 0.8 });
      page.drawText(`R${r}C${c} $${(r + 1) * 1000 + c}`, { x: 36 + c * 120, y: 388 - r * 24, size: 10, font: f });
    }
    page.drawImage(await doc.embedPng(await sharp(fx('photo.jpg')).resize(120, 80).png().toBuffer()), { x: 30, y: 180, width: 120, height: 80 });
    const src = path.join(OUT, 'objects.pdf');
    fs.writeFileSync(src, await doc.save());
    openEditor(src, 'edit');
    const win = [...editors].pop(), wc = win.webContents, ejs = (code) => js(code, wc);
    while (wc.isLoading()) await sleep(200);
    const wait = async (code, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code)) return true; await sleep(150); } return false; };
    if (!(await wait('!!document.querySelector(\'[data-tool="select"]\') && !!document.querySelector(".pdfpage img.r[src]")'))) throw new Error('editor did not load');
    // Edit a line in the shaded row: what hides the old words must be the green cell, not a white box.
    await ejs('document.querySelector(\'[data-tool="edittext"]\').click()');
    if (!(await wait('[...document.querySelectorAll(".tline")].length > 3'))) throw new Error('no editable lines');
    await ejs(`(() => { const rows = [...document.querySelectorAll('.tline:not(.mask)')].sort((a, b) => a.offsetTop - b.offsetTop); const el = rows[3]; el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); })()`);
    if (!(await wait('!!document.querySelector(".tline.mask.ready")', 6000))) throw new Error('the edited line has no page-coloured mask');
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await sleep(300);
    await ejs('document.querySelector(\'[data-tool="select"]\').click()');
    if (!(await wait('document.querySelectorAll(".pobj").length >= 3'))) throw new Error(`Select shows ${await ejs('document.querySelectorAll(".pobj").length')} things on the page`);
    const kinds = await ejs('[...document.querySelectorAll(".pobj")].map((x) => x.title.split(":")[0])');
    for (const want of ['Table', 'Picture']) {
      await ejs(`document.querySelector('.pobj[title^="${want}"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`);
      if (!(await wait(`document.querySelector('.props h3')?.textContent === '${want}'`, 3000))) throw new Error(`picking the ${want.toLowerCase()} did not select it`);
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' });
      if (!(await wait(`!document.querySelector('.pobj[title^="${want}"]') && document.querySelectorAll('.obj.erase').length === ${want === 'Table' ? 1 : 2}`, 3000))) throw new Error(`Delete did not remove the ${want.toLowerCase()}`);
    }
    await ejs('document.querySelector(\'[data-a="save"]\').click()');
    const out = path.join(OUT, 'objects (edited).pdf');
    const t2 = Date.now();
    while (!fs.existsSync(out) && Date.now() - t2 < 20000) await sleep(200);
    if (!fs.existsSync(out)) throw new Error('Save wrote nothing');
    await sleep(500);
    const E = require('../src/main/pdfedit');
    const s2 = await E.open(out), left = await E.objects(s2.id, 0), text = (await E.text(s2.id, 0)).map((l) => l.text).join(' | ');
    if (/R\dC\d/.test(text)) throw new Error(`the table's text is still there: ${text}`);
    if (left.some((o) => o.kind === 'image' || o.kind === 'table')) throw new Error(`still on the page: ${left.map((o) => o.kind)}`);
    if (!/free text/.test(text)) throw new Error('the paragraph went too');
    sel.detail = `found ${kinds.join(', ')}; removed the table and the picture, kept the paragraph`;
    win.destroy();
  } catch (e) { sel.status = 'FAIL'; sel.detail = e.message; }
  console.log(`${sel.status} ${sel.name.padEnd(44)}        ${sel.detail}`);
  results.push(sel);

  const sty = { name: 'edit pdf · zoom at the pointer, fonts and text styles', status: 'PASS', detail: '' };
  try {
    const src = path.join(OUT, 'styles.pdf');
    fs.copyFileSync(fx('doc.pdf'), src);
    openEditor(src, 'edit');
    const win = [...editors].pop(), wc = win.webContents, ejs = (code) => js(code, wc);
    while (wc.isLoading()) await sleep(200);
    const wait = async (code, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code)) return true; await sleep(150); } return false; };
    if (!(await wait('!!document.querySelector(".pdfpage img.r[src]")'))) throw new Error('editor did not load');
    await sleep(600);
    // A pinch (Ctrl + wheel) at a spot on the page keeps that spot under the pointer.
    const spot = await ejs(`(() => { const b = document.querySelector('.pdfpage').getBoundingClientRect(); return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + Math.min(b.height, innerHeight - b.top) * 0.4) }; })()`);
    const at = (pt) => ejs(`(() => { const b = document.querySelector('.pdfpage').getBoundingClientRect(); return { fx: (${pt.x} - b.left) / b.width, fy: (${pt.y} - b.top) / b.height, w: b.width, h: b.height }; })()`);
    const before = await at(spot);
    const steps = [];
    for (let i = 0; i < 8; i++) { steps.push(await ejs(`(() => { const p = document.querySelector('.pages'); p.dispatchEvent(new WheelEvent('wheel', { deltaY: -12, ctrlKey: true, clientX: ${spot.x}, clientY: ${spot.y}, bubbles: true, cancelable: true })); return [Math.round(p.scrollTop), p.scrollHeight, p.clientHeight]; })()`)); await sleep(30); }
    await sleep(300);
    const after = await at(spot);
    if (after.w < before.w * 1.4) throw new Error(`pinch zoomed only ${(after.w / before.w).toFixed(2)}×`);
    const drift = Math.hypot((after.fx - before.fx) * after.w, (after.fy - before.fy) * after.h);
    if (drift > 3) throw new Error(`the spot under the pointer moved ${drift.toFixed(1)} px: ${JSON.stringify({ spot, before, after, view: await ejs('[innerWidth, innerHeight, document.querySelector(".pages").clientWidth, document.querySelector(".pages").scrollTop, devicePixelRatio, document.visibilityState, document.hasFocus()]'), steps })}`);
    const zoomed = `${(after.w / before.w).toFixed(2)}× with ${drift.toFixed(1)} px drift`;
    await ejs(`(() => { const z = document.querySelector('select.zoom'); z.value = 'width'; z.dispatchEvent(new Event('change')); })()`);
    await sleep(400);
    // Add text with a font and every style, and save.
    await ejs('document.querySelector(\'[data-tool="addtext"]\').click()');
    await ejs(`(() => { const l = document.querySelector('.pdfpage .layer'), b = l.getBoundingClientRect(); l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: b.left + 60, clientY: b.top + b.height * 0.55 })); })()`);
    if (!(await wait('!!document.querySelector(".obj.text[contenteditable]")', 3000))) throw new Error('no text box');
    await ejs(`(() => { const el = document.querySelector('.obj.text[contenteditable]'); el.textContent = 'Styled Lime text'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await ejs(`(() => { const f = document.querySelector('.props select[title="Font"]'); f.value = 'carlito'; f.dispatchEvent(new Event('change')); })()`);
    for (const sel of ['[data-s="bold"]', '[data-s="underline"]', '[data-s="strike"]', '[data-al="center"]', '.swatches [data-c="#fff4ce"]']) { await ejs(`document.querySelector('.props ${sel}').click()`); await sleep(80); }
    const look = await ejs(`(() => { const s = getComputedStyle(document.querySelector('.obj.text')); return { deco: s.textDecorationLine, weight: s.fontWeight, bg: s.backgroundColor, font: s.fontFamily }; })()`);
    if (!/underline/.test(look.deco) || !/line-through/.test(look.deco) || Number(look.weight) < 600 || !/255, 244, 206/.test(look.bg) || !/Carlito/.test(look.font)) throw new Error(`preview ${JSON.stringify(look)}`);
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await sleep(300);
    await ejs('document.querySelector(\'[data-a="save"]\').click()');
    const out = path.join(OUT, 'styles (edited).pdf');
    const t2 = Date.now();
    while (!fs.existsSync(out) && Date.now() - t2 < 20000) await sleep(200);
    if (!fs.existsSync(out)) throw new Error('Save wrote nothing');
    await sleep(500);
    const E = require('../src/main/pdfedit');
    const s2 = await E.open(out), line = (await E.text(s2.id, 0)).find((l) => /Styled Lime text/.test(l.text));
    if (!line) throw new Error('the new text is not in the file');
    if (!/Carlito-Bold/.test(line.font)) throw new Error(`saved in ${line.font}`);
    const png = await E.render(s2.id, 0, 1), { data, info } = await require('sharp')(png).raw().toBuffer({ resolveWithObject: true });
    const [x0, y0, x1] = line.bbox, px = (x, y) => { const i = (Math.round(y) * info.width + Math.round(x)) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
    const bg = px(x0 - 2, y0 + 1);
    if (Math.abs(bg[0] - 255) > 6 || Math.abs(bg[1] - 244) > 8 || Math.abs(bg[2] - 206) > 10) throw new Error(`no background colour behind the text: ${bg}`);
    sty.detail = `pinch ${zoomed}; saved in ${line.font} with underline, strike, centre and background`;
    win.destroy();
  } catch (e) { sty.status = 'FAIL'; sty.detail = e.message; }
  console.log(`${sty.status} ${sty.name.padEnd(44)}        ${sty.detail}`);
  results.push(sty);

  const rep = { name: 'edit pdf · find and replace across pages', status: 'PASS', detail: '' };
  try {
    const src = path.join(OUT, 'replace.pdf');
    fs.copyFileSync(fx('doc.pdf'), src);
    openEditor(src, 'edit');
    const win = [...editors].pop(), wc = win.webContents, ejs = (code) => js(code, wc);
    while (wc.isLoading()) await sleep(200);
    const wait = async (code, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code)) return true; await sleep(150); } return false; };
    if (!(await wait('!!document.querySelector(".pdfpage img.r[src]")'))) throw new Error('editor did not load');
    await ejs('document.querySelector(\'[data-a="replace"]\').click()');
    if (!(await wait('!!document.querySelector(".scrim [data-f=q]")', 3000))) throw new Error('no replace dialog');
    await ejs(`(() => { const d = document.querySelector('.scrim'); d.querySelector('[data-f=q]').value = 'Page'; d.querySelector('[data-f=r]').value = 'Sheet'; d.querySelector('[data-a=ok]').click(); })()`);
    if (!(await wait('document.querySelectorAll(".obj.text").length >= 3', 8000))) throw new Error(`${await ejs('document.querySelectorAll(".obj.text").length')} lines replaced`);
    await ejs('document.querySelector(\'[data-a="save"]\').click()');
    const out = path.join(OUT, 'replace (edited).pdf');
    const t2 = Date.now();
    while (!fs.existsSync(out) && Date.now() - t2 < 20000) await sleep(200);
    if (!fs.existsSync(out)) throw new Error('Save wrote nothing');
    await sleep(500);
    const E = require('../src/main/pdfedit'), s2 = await E.open(out);
    let all = '';
    for (let i = 0; i < 3; i++) all += (await E.text(s2.id, i)).map((l) => l.text).join(' ') + ' ';
    if (/Page \d/.test(all) || !/Sheet 2/.test(all)) throw new Error(`saved text: ${all.slice(0, 160)}`);
    rep.detail = 'every “Page” became “Sheet” on all 3 pages';
    win.destroy();
  } catch (e) { rep.status = 'FAIL'; rep.detail = e.message; }
  console.log(`${rep.status} ${rep.name.padEnd(44)}        ${rep.detail}`);
  results.push(rep);

  const stamp = { name: 'edit pdf · stamps, ticks, date and markup', status: 'PASS', detail: '' };
  try {
    const src = path.join(OUT, 'stamps.pdf');
    fs.copyFileSync(fx('doc.pdf'), src);
    openEditor(src, 'edit');
    const win = [...editors].pop(), wc = win.webContents, ejs = (code) => js(code, wc);
    while (wc.isLoading()) await sleep(200);
    const wait = async (code, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code)) return true; await sleep(150); } return false; };
    if (!(await wait('!!document.querySelector(".pdfpage img.r[src]")'))) throw new Error('editor did not load');
    const press = (fx_, fy) => ejs(`(() => { const l = document.querySelector('.pdfpage .layer'), b = l.getBoundingClientRect(), x = b.left + b.width * ${fx_}, y = b.top + b.height * ${fy}; l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y })); window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y })); })()`);
    await ejs('document.querySelector(\'[data-tool="stamp"]\').click()');
    if (!(await wait('document.querySelectorAll(".props .stampbtn").length >= 8', 3000))) throw new Error('no stamp choices');
    await ejs('document.querySelector(\'.props [data-st="APPROVED"]\').click()');
    await press(0.1, 0.12);
    const ring = await ejs(`(() => { const el = [...document.querySelectorAll('.obj.text')].find((x) => x.textContent === 'APPROVED'); return el && el.classList.contains('bordered') && getComputedStyle(el, '::after').borderTopColor; })()`);
    if (ring !== 'rgb(16, 124, 16)') throw new Error(`stamp preview border ${ring}`);
    // Select the stamp and turn it, make it bigger and fainter from the panel.
    await ejs(`(() => { const el = [...document.querySelectorAll('.obj.text')].find((x) => x.textContent === 'APPROVED'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 1, clientY: 1 })); window.dispatchEvent(new PointerEvent('pointerup', {})); })()`);
    if (!(await wait('document.querySelector(".props h3")?.textContent === "Stamp"', 2000))) throw new Error('selecting the stamp did not show its settings');
    for (const [label, v] of [['Size (pt)', 24], ['Rotation (°)', 30], ['Opacity (%)', 80]]) await ejs(`(() => { const n = document.querySelector('.props input.num[aria-label="${label}"]'); n.value = ${v}; n.dispatchEvent(new Event('change')); })()`);
    const turned = await ejs(`getComputedStyle([...document.querySelectorAll('.obj.text')].find((x) => x.textContent === 'APPROVED')).transform`);
    if (!/matrix\(0\.86/.test(turned)) throw new Error(`stamp preview not turned: ${turned} ${JSON.stringify(await ejs(`(() => { const els = [...document.querySelectorAll('.obj.text')]; return { n: els.length, styles: els.map((x) => x.getAttribute('style')), panel: document.querySelector('.props h3')?.textContent, rot: document.querySelector('.props input.num[aria-label="Rotation (°)"]')?.value, sel: document.querySelectorAll('.obj.sel').length, editing: document.activeElement?.className }; })()`))}`);
    // A stamp in the user's own words.
    await ejs('document.querySelector(\'[data-tool="stamp"]\').click()');
    await ejs(`(() => { const i = [...document.querySelectorAll('.props input[type=text]')].find((x) => /own words/.test(x.closest('.field').textContent)); i.value = 'CHECKED BY JK'; i.dispatchEvent(new Event('input')); })()`);
    await press(0.55, 0.62);
    if (!(await wait('[...document.querySelectorAll(".obj.text")].some((x) => x.textContent === "CHECKED BY JK")', 2000))) throw new Error('own words stamp missing');
    await ejs('document.querySelector(\'.props [data-st="mark:check"]\').click()');
    await press(0.1, 0.5);
    if (!(await wait('!!document.querySelector(".obj svg path")', 2000))) throw new Error('no tick on the page');
    await ejs('document.querySelector(\'.props [data-st="date"]\').click()');
    await press(0.1, 0.56);
    // Underline part of a line of text with the markup tool.
    await ejs('document.querySelector(\'[data-tool="highlight"]\').click()');
    await ejs('document.querySelector(\'.props [data-m="underline"]\').click()');
    await ejs(`(() => { const l = document.querySelector('.pdfpage .layer'), b = l.getBoundingClientRect(), x = b.left + b.width * 0.15, y = b.top + b.height * 0.4; l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y })); window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + b.width * 0.4, clientY: y + b.height * 0.02 })); window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + b.width * 0.4, clientY: y + b.height * 0.02 })); })()`);
    const kinds = await ejs('[...document.querySelectorAll(".obj")].length');
    if (kinds < 4) throw new Error(`${kinds} things added`);
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await sleep(300);
    await ejs('document.querySelector(\'[data-a="save"]\').click()');
    const out = path.join(OUT, 'stamps (edited).pdf');
    const t2 = Date.now();
    while (!fs.existsSync(out) && Date.now() - t2 < 20000) await sleep(200);
    if (!fs.existsSync(out)) throw new Error('Save wrote nothing');
    await sleep(500);
    const E = require('../src/main/pdfedit'), s1 = await E.open(src), s2 = await E.open(out);
    const lines = await E.text(s2.id, 0), was = (await E.text(s1.id, 0)).map((l) => l.text).join('\n');
    const st_ = lines.find((l) => l.text.includes('APPROVED'));
    if (!st_ || !/Bold/.test(st_.font)) throw new Error(`stamp text ${st_ ? st_.font : 'missing'}`);
    if (!lines.some((l) => l.text.includes('CHECKED BY JK'))) throw new Error('own words stamp not in the file');
    const year = String(new Date().getFullYear());
    if (!lines.some((l) => l.text.includes(year) && !was.includes(l.text))) throw new Error('the date is not in the file');
    // Green ink from the stamp's border and the tick, red from the underline, none of which the page had before.
    const ink = async (id) => {
      const { data, info } = await require('sharp')(await E.render(id, 0, 1.5)).raw().toBuffer({ resolveWithObject: true });
      let green = 0, red = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (g > 90 && g - r > 50 && g - b > 50) green++;
        if (r > 150 && r - g > 80 && r - b > 80) red++;
      }
      return { green, red };
    };
    const a = await ink(s1.id), b = await ink(s2.id);
    if (b.green - a.green < 150) throw new Error(`stamp border and tick: ${b.green - a.green} green pixels`);
    // Turned 30°, the stamp's green reaches much higher and lower than a level one would (about 40 pt tall).
    {
      const { data, info } = await require('sharp')(await E.render(s2.id, 0, 1.5)).raw().toBuffer({ resolveWithObject: true }), { data: d0 } = await require('sharp')(await E.render(s1.id, 0, 1.5)).raw().toBuffer({ resolveWithObject: true });
      let top = Infinity, bottom = -1;
      for (let y = 0; y < info.height * 0.35; y++) for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels, [r, g, bl] = [data[i], data[i + 1], data[i + 2]], was = d0[i + 1] - d0[i];
        if (g > 90 && g - r > 50 && g - bl > 50 && was < 30) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
      }
      if (bottom - top < 1.5 * 70) throw new Error(`stamp is ${((bottom - top) / 1.5).toFixed(0)} pt tall: not turned in the file`);
    }
    if (b.red - a.red < 60) throw new Error(`underline: ${b.red - a.red} red pixels`);
    stamp.detail = `APPROVED in ${st_.font}, turned 30° with its border, own words, a tick, today's date and an underline saved`;
    win.destroy();
  } catch (e) { stamp.status = 'FAIL'; stamp.detail = e.message; }
  console.log(`${stamp.status} ${stamp.name.padEnd(44)}        ${stamp.detail}`);
  results.push(stamp);

  // The app editors: open a sample, make one real change through the panels, Save, and read the saved file back.
  const studio = async (name, sample, appId, fn) => {
    const r = { name, status: 'PASS', detail: '' };
    let win = null;
    try {
      const src = path.join(OUT, `studio-${sample}`);
      fs.copyFileSync(fx(sample), src);
      openEditor(src, `studio:${appId}`);
      win = [...editors].pop();
      const wc = win.webContents, ejs = (code) => js(code, wc);
      while (wc.isLoading()) await sleep(200);
      const wait = async (code, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code)) return true; await sleep(150); } return false; };
      if (!(await wait('!!document.querySelector(".studio .props h3") && !document.querySelector(".studio.working")'))) throw new Error('editor did not load');
      const idle = () => wait('!document.querySelector(".studio.working")', 120000);
      const save = async () => {
        await ejs('document.querySelector(\'[data-a="save"]\').click()');
        const out = path.join(OUT, `studio-${sample.replace(/\.[^.]+$/, '')} (edited).${sample.split('.').pop()}`), t = Date.now();
        while (!fs.existsSync(out) && Date.now() - t < 60000) await sleep(200);
        if (!fs.existsSync(out)) throw new Error('Save wrote nothing');
        await idle();
        if (!(await wait('document.querySelector(".dirty").hidden', 5000))) throw new Error('still marked unsaved after saving');
        return out;
      };
      r.detail = await fn({ ejs, wait, idle, save, src });
    } catch (e) { r.status = 'FAIL'; r.detail = e.message; }
    win?.destroy();
    console.log(`${r.status} ${r.name.padEnd(44)}        ${r.detail}`);
    results.push(r);
  };
  await studio('edit vector · recolour, undo, redo, save', 'logo.svg', 'vectorcraft', async ({ ejs, wait, idle, save }) => {
    await ejs('document.querySelector(\'[data-tool="color"]\').click()');
    if (!(await wait('[...document.querySelectorAll(".rc .t")].some((x) => x.textContent === "#86c23a")', 10000))) throw new Error(`colours listed: ${await ejs('[...document.querySelectorAll(".rc .t")].map((x) => x.textContent).join(" ")')}`);
    const swap = (from, to) => ejs(`(() => { const i = [...document.querySelectorAll('.rc')].find((x) => x.querySelector('.t').textContent === '${from}').querySelector('input'); i.value = '${to}'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const has = (c) => wait(`[...document.querySelectorAll(".rc .t")].some((x) => x.textContent === "${c}") && !document.querySelector(".studio.working")`, 30000);
    await swap('#86c23a', '#d13438');
    if (!(await has('#d13438'))) throw new Error('the new colour did not appear');
    if (await ejs('document.querySelector(".dirty").hidden')) throw new Error('not marked unsaved');
    await ejs('document.querySelector(\'[data-a="undo"]\').click()');
    if (!(await has('#86c23a'))) throw new Error('undo did not bring the colour back');
    await idle();
    await ejs('document.querySelector(\'[data-a="redo"]\').click()');
    if (!(await has('#d13438'))) throw new Error('redo did not');
    const out = await save(), svg = fs.readFileSync(out, 'utf8');
    if (!/#d13438/i.test(svg) || /#86c23a/i.test(svg)) throw new Error(`saved SVG still has the old green: ${svg.slice(0, 200)}`);
    return `${path.relative(OUT, out)}: #86c23a became #d13438 (undo and redo on the way)`;
  });
  await studio('edit layout · find and change text, save IDML', 'layout.idml', 'designcraft', async ({ ejs, wait, save }) => {
    await ejs('document.querySelector(\'[data-a="replace"]\').click()');
    if (!(await wait('!!document.querySelector(".scrim input[data-k=find]")', 5000))) throw new Error('no find and change dialog');
    await ejs(`(() => { const s = document.querySelector('.scrim'), set = (k, v) => { const i = s.querySelector('[data-k=' + k + ']'); if (i.type === 'checkbox') i.checked = v; else i.value = v; i.dispatchEvent(new Event('change')); }; set('find', 'Quiet'); set('change', 'Loud'); set('caseSensitive', true); s.querySelector('[data-a=ok]').click(); })()`);
    if (!(await wait('!document.querySelector(".scrim") && !document.querySelector(".dirty").hidden && !document.querySelector(".studio.working")', 30000))) throw new Error('nothing changed');
    const out = await save();
    const { unzipSync, strFromU8 } = require('fflate'), z = unzipSync(fs.readFileSync(out));
    const stories = Object.entries(z).filter(([n]) => /^Stories\/.*\.xml$/.test(n)).map(([, b]) => strFromU8(b)).join('\n');
    if (!stories.includes('Loud') || stories.includes('Quiet')) throw new Error(`stories in the IDML: ${(stories.match(/<Content>[^<]*<\/Content>/g) || []).slice(0, 4).join(' ')}`);
    return `${path.relative(OUT, out)}: “Quiet” is now “Loud” in the IDML's stories`;
  });
  await studio('edit animation · double the speed, save Lottie', 'anim.json', 'effectcraft', async ({ ejs, wait, save, src }) => {
    const before = JSON.parse(fs.readFileSync(src, 'utf8'));
    await ejs('document.querySelector(\'[data-tool="time"]\').click()');
    if (!(await wait('!!document.querySelector(\'.props [data-v="2"]\')', 5000))) throw new Error('no speed buttons');
    await ejs('document.querySelector(\'.props [data-v="2"]\').click()');
    if (!(await wait('!document.querySelector(".dirty").hidden && !document.querySelector(".studio.working") && document.querySelector(".tc span").textContent === "0:05:00"', 60000))) throw new Error(`length shown: ${await ejs('document.querySelector(".tc span").textContent')}`);
    const out = await save(), j = JSON.parse(fs.readFileSync(out, 'utf8'));
    const len = (a) => (a.op - a.ip) / a.fr;
    if (Math.abs(len(j) - len(before) / 2) > 0.05) throw new Error(`saved ${len(j).toFixed(2)} s long, was ${len(before).toFixed(2)} s`);
    if (!j.layers.every((l) => Math.abs((l.sr || 1) - 0.5) < 0.01)) throw new Error(`layer stretch ${j.layers.map((l) => l.sr)}`);
    return `${path.relative(OUT, out)}: ${len(before).toFixed(2)} s → ${len(j).toFixed(2)} s, every layer at 2×`;
  });
  await studio('edit timeline · remove a clip, save OTIO', 'timeline.otio', 'filmcraft', async ({ ejs, wait, save }) => {
    if (!(await wait('[...document.querySelectorAll(".clip.video")].some((x) => /Aurora/.test(x.title))', 20000))) throw new Error('no clips on the timeline');
    await ejs(`[...document.querySelectorAll('.clip.video')].find((x) => /Aurora/.test(x.title)).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`);
    if (!(await wait('document.querySelector(".props h3")?.textContent.startsWith("Aurora")', 5000))) throw new Error('the clip did not open in the panel');
    await ejs(`[...document.querySelectorAll('.props .btn')].find((b) => b.textContent.trim() === 'Remove').click()`);
    if (!(await wait('!document.querySelector(".studio.working") && ![...document.querySelectorAll(".clip.video")].some((x) => /Aurora/.test(x.title))', 30000))) throw new Error('the clip is still on the timeline');
    const out = await save(), o = JSON.parse(fs.readFileSync(out, 'utf8'));
    const names = o.tracks.children.flatMap((t) => t.children.filter((c) => /^Clip/.test(c.OTIO_SCHEMA)).map((c) => c.name));
    const v1 = o.tracks.children.find((t) => t.kind === 'Video').children.filter((c) => /^Clip/.test(c.OTIO_SCHEMA));
    if (names.some((n) => /Aurora/.test(n)) || v1.length !== 5) throw new Error(`saved clips: ${names.join(', ')}`);
    return `${path.relative(OUT, out)}: Aurora_Timelapse gone from V1 and A1, ${v1.length} clips left on V1`;
  });

  // The image editor: open, edit through its panels, save, and measure what was written.
  const sharp = require('sharp');
  const openImage = async (src) => {
    openEditor(src, 'image');
    const win = [...editors].pop(), wc = win.webContents, ejs = (code) => js(code, wc);
    while (wc.isLoading()) await sleep(200);
    const wait = async (code, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code)) return true; await sleep(150); } return false; };
    const idle = () => wait('(() => { const x = document.querySelector(".imged")?.__imged; return !!x && x.idle() && !!document.querySelector(".imged .photo[src]"); })()');
    if (!(await idle())) throw new Error('the editor did not show the image');
    const slide = (key, v) => ejs(`(() => { const r = document.querySelector('.props [data-k="${key}"] input'); r.value = ${v}; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const press = (fx_, fy, to) => ejs(`(() => { const m = document.querySelector('.imged .marks'), b = m.getBoundingClientRect(), p = (x, y) => ({ bubbles: true, button: 0, clientX: b.left + b.width * x, clientY: b.top + b.height * y }); m.dispatchEvent(new PointerEvent('pointerdown', p(${fx_}, ${fy}))); ${to ? `window.dispatchEvent(new PointerEvent('pointermove', p(${to[0]}, ${to[1]})));` : ''} window.dispatchEvent(new PointerEvent('pointerup', p(${(to || [fx_])[0]}, ${(to || [0, fy])[1]}))); })()`);
    const saved = async (p, ms = 30000) => { const t = Date.now(); while (!fs.existsSync(p) && Date.now() - t < ms) await sleep(200); if (!fs.existsSync(p)) throw new Error(`Save wrote nothing at ${path.basename(p)}`); await sleep(500); return p; };
    return { win, ejs, wait, idle, slide, press, saved };
  };
  const statsOf = async (p) => {
    const { data, info } = await sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let lum = 0, sat = 0, red = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b; sat += mx ? (mx - mn) / mx : 0;
      if (r > 150 && g < 90 && b < 90) red++;
    }
    const n = data.length / info.channels;
    return { w: info.width, h: info.height, lum: lum / n, sat: sat / n, red };
  };

  const ie = { name: 'edit image · crop, rotate, adjust, text, save', status: 'PASS', detail: '' };
  try {
    const src = path.join(OUT, 'editimg.jpg');
    fs.copyFileSync(fx('photo.jpg'), src);
    const { win, ejs, wait, idle, slide, press, saved } = await openImage(src);
    // Crop to 4:5, then turn it a quarter right: 853 × 1067 of the 1600 × 1067 photo, lying on its side.
    await ejs('document.querySelector(\'[data-tool="crop"]\').click()');
    await ejs('document.querySelector(\'.props [data-r="4:5"]\').click()');
    await ejs('document.querySelector(\'.props [data-o="right"]\').click()');
    await ejs('document.querySelector(\'[data-tool="adjust"]\').click()');
    await slide('light.exposure', 0.8);
    await slide('color.saturation', 40);
    await idle();
    await ejs('document.querySelector(\'[data-tool="text"]\').click()');
    await ejs('document.querySelector(\'.props .swatches [data-c="#d13438"]\').click()');
    await ejs('document.querySelector(\'.props [data-ts="plain"]\').click()');
    await press(0.2, 0.3);
    if (!(await wait('!!document.querySelector(".tedit")', 3000))) throw new Error('no text box to type in');
    await ejs(`(() => { const el = document.querySelector('.tedit'); el.textContent = 'LIME'; el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); })()`);
    if (!(await wait('!document.querySelector(".tedit")', 3000))) throw new Error('the text stayed in editing');
    const hist = await ejs('document.querySelector(".imged").__imged.st.hist.map((x) => x.label).join(", ")');
    await ejs('document.querySelector(\'[data-a="save"]\').click()');
    const out = await saved(path.join(OUT, 'editimg (edited).jpg'));
    const a = await statsOf(fx('photo.jpg')), b = await statsOf(out), meta = await sharp(out).metadata();
    if (Math.abs(b.w - 1067) > 2 || Math.abs(b.h - 853) > 2) throw new Error(`saved ${b.w}×${b.h}, wanted about 1067×853 (cropped 4:5 and turned)`);
    if (!(b.lum > a.lum + 12)) throw new Error(`not brighter: luminance ${a.lum.toFixed(1)} → ${b.lum.toFixed(1)}`);
    if (!(b.sat > a.sat + 0.03)) throw new Error(`not more saturated: ${a.sat.toFixed(3)} → ${b.sat.toFixed(3)}`);
    if (b.red < 400 || a.red > 50) throw new Error(`text: ${b.red} red pixels (the photo had ${a.red})`);
    if (!meta.exif || (meta.orientation && meta.orientation !== 1)) throw new Error(`Exif ${meta.exif ? `kept but orientation ${meta.orientation}` : 'lost'}`);
    // Save as… PNG, through the format choice.
    asked = [];
    await ejs('document.querySelector(\'[data-a="saveas"]\').click()');
    if (!(await wait('!!document.querySelector(".scrim [data-f=png]")', 3000))) throw new Error('no format choice for Save as');
    await ejs('document.querySelector(".scrim [data-f=png]").click(); document.querySelector(".scrim [data-a=ok]").click()');
    const t = Date.now();
    let png = null;
    while (!png && Date.now() - t < 30000) { png = fs.readdirSync(OUT).map((d) => path.join(OUT, d, 'editimg.png')).find((p) => fs.existsSync(p)); await sleep(200); }
    if (!png) throw new Error('Save as PNG wrote nothing');
    await sleep(500);
    const pm = await sharp(png).metadata();
    if (pm.format !== 'png' || pm.width !== b.w || pm.height !== b.h) throw new Error(`Save as wrote ${pm.format} ${pm.width}×${pm.height}`);
    // Undo goes back through the steps.
    const before = await ejs('document.querySelector(".imged").__imged.st.at');
    await ejs('document.querySelector(\'[data-a="undo"]\').click()');
    const after = await ejs('document.querySelector(".imged").__imged.st.at');
    if (after !== before - 1) throw new Error(`undo moved from step ${before} to ${after}`);
    ie.detail = `${b.w}×${b.h}, luminance ${a.lum.toFixed(0)} → ${b.lum.toFixed(0)}, saturation ${a.sat.toFixed(2)} → ${b.sat.toFixed(2)}, ${b.red} red text pixels, Exif kept, PNG too (${hist})`;
    win.destroy();
  } catch (e) { ie.status = 'FAIL'; ie.detail = e.message; }
  console.log(`${ie.status} ${ie.name.padEnd(44)}        ${ie.detail}`);
  results.push(ie);

  const ir = { name: 'edit image · RAW, heal, look and PhotoCraft', status: 'PASS', detail: '' };
  try {
    const src = path.join(OUT, 'editraw.dng');
    fs.copyFileSync(fx('raw.dng'), src);
    const { win, ejs, wait, idle, slide, press, saved } = await openImage(src);
    await slide('light.exposure', 1);
    await idle();
    await ejs('document.querySelector(\'[data-tool="heal"]\').click()');
    await press(0.5, 0.5);
    if (!(await wait('document.querySelector(".imged").__imged.st.dev.spots.length === 1 && document.querySelector(".imged").__imged.idle()', 15000))) throw new Error('no healing spot was added');
    const src0 = await ejs('JSON.stringify(document.querySelector(".imged").__imged.st.dev.spots[0].source_offset)');
    if (!src0 || src0 === 'null') throw new Error('the spot has no source');
    await ejs('document.querySelector(\'[data-tool="looks"]\').click()');
    if (!(await wait('!!document.querySelector(\'.look[data-l="lc.bw-high-contrast"]\')', 15000))) throw new Error('no looks');
    await ejs('document.querySelector(\'.look[data-l="lc.bw-high-contrast"]\').click()');
    if (!(await wait('document.querySelector(".imged").__imged.st.dev.treatment === "bw"', 15000))) throw new Error('the B&W look did not apply');
    await ejs('document.querySelector(\'[data-tool="enhance"]\').click()');
    await ejs('document.querySelector(\'.props [data-e="sharpen"]\').click()');
    if (!(await wait('document.querySelector(".imged").__imged.st.base === 1 && document.querySelector(".imged").__imged.idle()', 60000))) throw new Error('PhotoCraft sharpen did not make a new step');
    await idle();
    await ejs('document.querySelector(\'[data-a="save"]\').click()');
    const out = await saved(path.join(OUT, 'editraw (edited).jpg'), 60000);
    const b = await statsOf(out);
    if (b.w !== 1800 || b.h !== 1200) throw new Error(`saved ${b.w}×${b.h}`);
    if (b.sat > 0.03) throw new Error(`not black and white: saturation ${b.sat.toFixed(3)}`);
    ir.detail = `RAW developed +1 EV, a healed spot (source ${src0}), High Contrast B&W, PhotoCraft sharpen → ${path.basename(out)} ${b.w}×${b.h}, saturation ${b.sat.toFixed(3)}`;
    win.destroy();
  } catch (e) { ir.status = 'FAIL'; ir.detail = e.message; }
  console.log(`${ir.status} ${ir.name.padEnd(44)}        ${ir.detail}`);
  results.push(ir);

  const im = { name: 'edit image · mask, resize, canvas, transparency', status: 'PASS', detail: '' };
  try {
    const src = path.join(OUT, 'editalpha.png');
    fs.copyFileSync(fx('alpha.png'), src);
    const { win, ejs, wait, idle, slide, press, saved } = await openImage(src);
    // A linear gradient darkens the top of the green disc and fades out above its middle.
    await ejs('document.querySelector(\'[data-tool="mask"]\').click()');
    await press(0.5, 0.02, [0.5, 0.42]);
    if (!(await wait('document.querySelector(".imged").__imged.st.dev.masks.length === 1', 3000))) throw new Error('no mask was added');
    await slide('mask.exposure', -2);
    await idle();
    await ejs('document.querySelector(\'[data-tool="resize"]\').click()');
    await ejs(`(() => { const i = document.querySelector('.props [data-d="pct"]'); i.value = 50; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await ejs('document.querySelector(\'.props [data-q="5"]\').click()');
    await ejs('document.querySelector(\'.props .swatches [data-c="transparent"]\').click()');
    await idle();
    await ejs('document.querySelector(\'[data-a="save"]\').click()');
    const out = await saved(path.join(OUT, 'editalpha (edited).png'));
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== 330 || info.height !== 330) throw new Error(`saved ${info.width}×${info.height}, wanted 330×330 (half size, then 15 px of canvas around)`);
    const px = (x, y) => data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4);
    if (px(3, 3)[3] !== 0 || px(165, 8)[3] !== 0) throw new Error('the canvas and the clear corners are not transparent');
    const band = (y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 120; x < 210; x++) { const p = px(x, y); if (p[3] > 250) { s += 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; n++; } } return n ? s / n : NaN; };
    const top = band(60, 90), bottom = band(240, 270);
    if (!(top < bottom - 20)) throw new Error(`the mask did not darken the top: ${top.toFixed(0)} against ${bottom.toFixed(0)} below`);
    im.detail = `330×330 with a clear canvas, top of the disc ${top.toFixed(0)} against ${bottom.toFixed(0)} below the gradient`;
    win.destroy();
  } catch (e) { im.status = 'FAIL'; im.detail = e.message; }
  console.log(`${im.status} ${im.name.padEnd(44)}        ${im.detail}`);
  results.push(im);

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
