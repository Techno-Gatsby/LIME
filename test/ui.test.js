'use strict';
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async ({ openCraftWeb, wheel, sensor, watcher, summon, shiftSummon, setCursor, debug, dialog, BrowserWindow, app, openEditor, editors, openPrefs, prefs, openWelcome, welcome, peek, screen, dir }) => {
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
  const box = () => debug().placed;
  const dragIn = (wc, type = 'dragenter') => js(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.txt', { type: 'text/plain' })); window.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { dataTransfer: dt, bubbles: true, cancelable: true })); })()`, wc);
  await check('starts as the lime tab on the right edge', async () => {
    await until('return L.S.state === "idle"');
    const b = box(), a = wa();
    if (b.width > 120 || b.height > 120) throw new Error(`tab window is ${b.width}×${b.height}`);
    if (Math.abs(b.x + b.width - (a.x + a.width)) > 1) throw new Error(`tab not at the right edge: ${b.x + b.width} vs ${a.x + a.width}`);
    return `${b.width}×${b.height} at x=${b.x}`;
  });
  await check('dragging a file onto the tab blooms the wheel', async () => {
    await dragIn(wheel().webContents);
    if (!(await until('return L.S.state === "ready"'))) throw new Error('did not open');
    await sleep(900);
    const b = box(), a = wa();
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
    const b = box();
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
      const centre = () => debug().bloomAt;
      const c0 = centre(), d0 = Math.hypot(cur.x - c0.x, cur.y - c0.y);
      if (d0 < 150 || d0 > 200) throw new Error(`pointer ${Math.round(d0)} px from the centre`);
      const away = Math.sign(cur.x - c0.x) || 1;
      cur.x += away * 260; cur.y += 40;
      await sleep(700);
      const c1 = centre(), d1 = Math.hypot(cur.x - c1.x, cur.y - c1.y);
      if (Math.hypot(c1.x - c0.x, c1.y - c0.y) < 200) throw new Error(`moved only ${Math.round(Math.hypot(c1.x - c0.x, c1.y - c0.y))} px`);
      if (Math.abs(d1 - d0) > 6) throw new Error(`leash ${Math.round(d0)} → ${Math.round(d1)} px`);
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
      const wc = wheel().webContents, b0 = box();
      Object.assign(cur, { x: b0.x + r.x, y: b0.y + r.y });
      wc.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
      wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await sleep(40);
      wc.sendInputEvent({ type: 'mouseMove', x: r.x + 12, y: r.y + 8, modifiers: ['leftButtonDown'] });
      await sleep(80);
      cur.x -= 70; cur.y -= 45;
      wc.sendInputEvent({ type: 'mouseMove', x: r.x - 70, y: r.y - 45, modifiers: ['leftButtonDown'] });
      await sleep(250);
      wc.sendInputEvent({ type: 'mouseUp', x: r.x - 70, y: r.y - 45, button: 'left', clickCount: 1 });
      await sleep(200);
      const b1 = box();
      return { dx: b1.x - b0.x, dy: b1.y - b0.y };
    };
    try {
      await lime('L.expand("click");');
      if (!(await until('return L.S.state === "ready" && L.S.ring.some((x) => x.homeMore)', 4000))) throw new Error('no apps around the lime');
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
  if (fs.existsSync(fx('photo.jpg'))) await check('a picture from Settings replaces the lime, and the lime comes back', async () => {
    await js(`window.lime.invoke('icon:set', ${JSON.stringify(fx('photo.jpg'))})`);
    if (!(await until('return /^data:image\\/png/.test(document.querySelector(".tab-lime img.lime")?.src || "")', 4000))) throw new Error('the tab still shows the lime');
    await lime('L.expand("click");');
    if (!(await until('return document.querySelector(".center img.lime")?.classList.contains("custom")', 4000))) throw new Error('the middle still shows the lime');
    await js("window.lime.invoke('icon:set', null)");
    if (!(await until('return /assets\\/lime-/.test(document.querySelector(".tab-lime img.lime")?.src || "")', 4000))) throw new Error('the lime did not come back');
    wheel().webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    return 'picture shown on the tab and in the middle; Use the lime put it back';
  });
  await check('click opens the first ring of apps; More apps opens the rest; each opens its own ring', async () => {
    await lime('L.expand("click");');
    if (!(await until('return L.S.state === "ready" && L.S.ring.some((x) => x.homeMore)', 4000))) throw new Error('no apps around the lime');
    await sleep(700);
    const ring = () => lime('return { labels: L.S.ring.map((x) => x.label), shown: [...document.querySelectorAll(".petal text.l")].filter((t) => getComputedStyle(t).display !== "none").length, sizes: [...new Set([...document.querySelectorAll(".petal[data-i] text.l")].map((t) => getComputedStyle(t).fontSize))], back: document.querySelector(".pill [data-a=home]")?.textContent || "" };');
    const home = await ring();
    const first = ['PdfCraft', 'PhotoCraft', 'DesignCraft', 'CADCraft', 'SoundCraft', 'FilmCraft'], second = ['VectorCraft', 'LightCraft', 'EffectCraft', 'DeckCraft', 'GridCraft', 'WordCraft'];
    if (first.join() !== home.labels.filter((l) => first.includes(l)).join()) throw new Error(`first ring ${home.labels}`);
    if (home.labels[home.labels.length - 1] !== 'More apps' || home.labels.some((l) => second.includes(l) || l === 'Recent')) throw new Error(`first ring ${home.labels}`);
    if (home.shown !== home.labels.length || home.labels.length > 10) throw new Error(`${home.shown} of ${home.labels.length} labels visible`);
    if (home.sizes.length !== 1) throw new Error(`label sizes ${home.sizes}`);
    await click(`.petal[data-i="${home.labels.indexOf('More apps')}"] text.l`);
    if (!(await until('return L.S.homeMore && L.S.ring.some((x) => x.homeBack)', 3000))) throw new Error('More apps did not open the second ring');
    const more = await ring();
    if (second.join() !== more.labels.slice(0, 6).join() || more.labels.slice(-2).join() !== 'Recent,Back') throw new Error(`second ring ${more.labels}`);
    if (more.sizes.length !== 1 || !/First ring/.test(more.back)) throw new Error(`second ring sizes ${more.sizes}, pill ${more.back}`);
    await click(`.petal[data-i="${more.labels.indexOf('GridCraft')}"] text.l`);
    if (!(await until('return L.S.app === "gridcraft"', 3000))) throw new Error('GridCraft did not open its ring');
    const grid = await ring();
    if (!grid.labels.includes('Chart') || !/More apps/.test(grid.back)) throw new Error(`GridCraft ring ${grid.labels} · ${grid.back}`);
    wheel().webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    if (!(await until('return !L.S.app && L.S.homeMore', 2000))) throw new Error('Esc did not go back to More apps');
    await click(`.petal[data-i="${more.labels.indexOf('Back')}"] text.l`);
    if (!(await until('return !L.S.homeMore && L.S.ring.some((x) => x.homeMore)', 2000))) throw new Error('Back did not return to the first ring');
    await click(`.petal[data-i="${home.labels.indexOf('PdfCraft')}"] text.l`);
    if (!(await until('return L.S.app === "pdfcraft" && L.S.ring[0]?.label === "Open"', 3000))) throw new Error('PdfCraft did not open its ring');
    const pdf = await ring();
    if (!pdf.labels.includes('Repair')) throw new Error(`PdfCraft ring ${pdf.labels}`);
    if (!/All apps/.test(pdf.back)) throw new Error('no way back to the apps');
    if (!(await lime('return !!L.S.ring[0]?.appOpen && L.S.ring[1]?.label === "Full app"'))) throw new Error('Open is not the app in a Lime window');
    wheel().webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    if (!(await until('return !L.S.app && L.S.ring.some((x) => x.homeMore)', 2000))) throw new Error('Esc did not go back to the apps');
    return `${home.labels.join(', ')} | ${more.labels.join(', ')} · ${home.sizes[0]} and ${more.sizes[0]}`;
  });
  await check('Settings decide which ring each app is on', async () => {
    const labels = () => lime('return L.S.ring.map((x) => x.label);');
    await lime('L.expand("click"); await L.loadHome();');
    await until('return L.S.ring.some((x) => x.homeMore)', 3000);
    await js('window.lime.invoke("settings:set", { rings: { first: ["wordcraft", "pdfcraft", "photocraft", "nosuchapp"], second: ["vectorcraft"] } })');
    if (!(await until('return L.S.ring[0]?.label === "WordCraft" && L.S.ring[1]?.label === "PdfCraft" && L.S.ring.length === 4', 4000))) throw new Error(`first ring did not follow: ${await labels()}`);
    const saved = await js('window.lime.invoke("settings:get")');
    if (saved.rings.first.join() !== 'wordcraft,pdfcraft,photocraft' || saved.rings.second[0] !== 'vectorcraft' || saved.rings.second.length < 9) throw new Error(`stored ${JSON.stringify(saved.rings)}`);
    await lime('L.pick(L.S.ring.find((x) => x.homeMore));');
    const more = await labels();
    if (more[0] !== 'VectorCraft' || more.includes('WordCraft') || more.includes('PhotoCraft')) throw new Error(`second ring ${more}`);
    await lime('L.back();');
    await js('window.lime.invoke("settings:set", { rings: null })');
    if (!(await until('return L.S.ring[0]?.label === "PdfCraft" && L.S.ring[1]?.label === "PhotoCraft"', 4000))) throw new Error(`reset did not restore the rings: ${await labels()}`);
    return `moved WordCraft first and back; unknown ids dropped; the rest went to More apps (${saved.rings.second.length})`;
  });
  const Crafts = require(path.join(__dirname, '..', 'src', 'main', 'engines', 'crafts'));
  const craftWindow = async (id, src) => {
    const win = await openCraftWeb(id, src);
    const wjs = (code) => win.webContents.executeJavaScript(code, true);
    let state = 'loading';
    for (const t0 = Date.now(); Date.now() - t0 < 90000 && state === 'loading'; await sleep(250)) state = await wjs('document.body.dataset.state');
    return { win, wjs, state };
  };
  const waitFile = async (f, ms = 8000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) if (fs.existsSync(f)) return true; return false; };
  if (fs.existsSync(fx('book.xlsx'))) await check('GridCraft opens in a Lime window and saves beside the original', async () => {
    if (!Crafts.hasWeb('gridcraft')) throw Object.assign(new Error('no GridCraft web app in this build'), { skip: true });
    const d = target(), src = path.join(d, 'book.xlsx');
    fs.copyFileSync(fx('book.xlsx'), src);
    const { win, wjs, state } = await craftWindow('gridcraft', src);
    try {
      if (state === 'loading') throw new Error('GridCraft never started');
      const info = await wjs('window.limeCraft.info()');
      if (!info.bridge || info.fileName !== 'book.xlsx' || !/host=parent/.test(await wjs('document.getElementById("app").src'))) throw new Error(`host mode: ${JSON.stringify(info)}`);
      const post = (msg) => wjs(`document.getElementById('app').contentWindow.eval(${JSON.stringify(`parent.postMessage(${msg}, location.origin)`)})`);
      await post("{ type: 'gridcraft:save', name: 'book.xlsx', bytes: new Uint8Array([80, 75, 5, 6, 1]).buffer }");
      const edited = path.join(d, 'book (edited).xlsx');
      if (!(await waitFile(edited))) throw new Error(`nothing saved: ${fs.readdirSync(d)}`);
      if (fs.readFileSync(edited).length !== 5 || !fs.readFileSync(src).equals(fs.readFileSync(fx('book.xlsx')))) throw new Error('the save went to the wrong file');
      await post("{ type: 'gridcraft:save', name: 'book.xlsx', bytes: new Uint8Array([80, 75, 5, 6, 1, 2]).buffer }");
      await post("{ type: 'gridcraft:save', name: 'book.pdf', bytes: new Uint8Array([37, 80, 68, 70]).buffer }");
      if (!(await waitFile(path.join(d, 'book.pdf')))) throw new Error(`no export: ${fs.readdirSync(d)}`);
      if (fs.readFileSync(edited).length !== 6 || fs.existsSync(path.join(d, 'book (edited) 2.xlsx'))) throw new Error(`a second save did not replace its own file: ${fs.readdirSync(d)}`);
      const toast = await wjs('document.querySelector(".toast").hidden ? "" : document.querySelector(".toast span").textContent');
      if (!/Saved book\.pdf/.test(toast)) throw new Error(`toast: ${toast}`);
      await post("{ type: 'gridcraft:dirty', dirty: true }");
      for (const t0 = Date.now(); Date.now() - t0 < 3000 && !win.craftWeb.dirty; ) await sleep(100);
      if (!win.craftWeb.dirty) throw new Error('unsaved changes were not reported');
      win.craftWeb.dirty = false;
      return `${state}; saved book (edited).xlsx and book.pdf beside the original, which stayed as it was`;
    } finally { if (!win.isDestroyed()) win.destroy(); }
  });
  if (fs.existsSync(fx('doc.docx'))) await check('WordCraft opens in a Lime window; its downloads save beside the file', async () => {
    if (!Crafts.hasWeb('wordcraft')) throw Object.assign(new Error('no WordCraft web app in this build'), { skip: true });
    const d = target(), src = path.join(d, 'doc.docx');
    fs.copyFileSync(fx('doc.docx'), src);
    const { win, wjs, state } = await craftWindow('wordcraft', src);
    try {
      if (state !== 'ready') throw new Error(`state ${state}`);
      await wjs(`document.getElementById('app').contentWindow.eval(${JSON.stringify("const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['PK'])); a.download = 'doc.docx'; document.body.append(a); a.click();")})`);
      const edited = path.join(d, 'doc (edited).docx');
      if (!(await waitFile(edited))) throw new Error(`nothing saved: ${fs.readdirSync(d)}`);
      if (!fs.readFileSync(src).equals(fs.readFileSync(fx('doc.docx')))) throw new Error('the original changed');
      return 'the document went in by drop; Save wrote doc (edited).docx';
    } finally { if (!win.isDestroyed()) win.destroy(); }
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
    if (!r.labels.includes('Archive') || r.tab !== 'PdfCraft') throw new Error(JSON.stringify(r));
    const before = editors.size;
    await click('.center');
    const t = Date.now();
    while (editors.size === before && Date.now() - t < 8000) await sleep(150);
    if (editors.size === before) throw new Error('the middle did not open a Lime window');
    const win = [...editors].pop(), mode = win.editorData?.mode;
    win.destroy();
    if (mode !== 'edit') throw new Error(`opened in ${mode}`);
    return `apps: ${list.join(', ')} · PdfCraft: ${r.labels.join(', ')} · the middle opened the PDF editor`;
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
  const wheels = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isWheel).length;
  const healthy = async (label) => {
    if (!(await until('return L.S.state === "idle" && !L.folding()', 8000))) throw new Error(`${label}: stuck in ${await lime('return L.S.state;')}`);
    await sleep(900);
    const b = box(), a = wa();
    const r = await lime('const t = document.querySelector(".tab"), cs = getComputedStyle(t); return { shown: cs.display !== "none" && cs.visibility !== "hidden", over: L.S.over, cls: document.querySelector("#stage").className };');
    if (wheels() !== 1) throw new Error(`${label}: ${wheels()} wheel windows`);
    if (b.width > 120 || b.height > 120 || Math.abs(b.x + b.width - (a.x + a.width)) > 1) throw new Error(`${label}: the lime is ${b.width}×${b.height} at ${b.x},${b.y}, not at the edge`);
    if (!r.shown) throw new Error(`${label}: the lime is hidden (${r.cls})`);
    if (r.over) throw new Error(`${label}: still thinks files are over it`);
    await dragIn(wheel().webContents);
    if (!(await until('return L.S.state === "ready"', 3000))) throw new Error(`${label}: a drag onto the lime didn't open the wheel`);
    await sleep(700);
    if (box().width < 300) throw new Error(`${label}: opened but the wheel stayed small: ${JSON.stringify({ bounds: box(), main: debug(), page: await lime('return { state: L.S.state, cls: document.querySelector("#stage").className, geo: L.geo() };') })}`);
    await dragIn(wheel().webContents, 'dragleave');
    if (!(await until('return L.S.state === "idle" && !L.folding()', 5000))) throw new Error(`${label}: didn't fold after the drag left`);
    await sleep(600);
    await click('.tab');
    if (!(await until('return L.S.state === "ready" && L.S.ring.some((x) => x.homeMore)', 3000))) throw new Error(`${label}: a click on the lime didn't open the apps`);
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
      const st = await lime('return { s: L.S.state, f: L.folding() };'), w = box().width;
      if (st.s === 'idle' && !st.f && w > 120) { await sleep(400); if (box().width > 120 && (await lime('return L.S.state === "idle" && !L.folding();'))) throw new Error(`cycle ${i}: idle but the window is ${w} wide`); }
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
      require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$w = @((New-Object -ComObject Shell.Application).Windows() | Where-Object { [int64]$_.HWND -eq ${Number(koffi.address(h))} })[0]; $w.Document.SelectItem($w.Document.Folder.ParseName('${path.basename(want)}'), 29)`], { windowsHide: true, timeout: 20000 });
      const tab = child(h, null, 'ShellTabWindowClass', null), b = new Uint16Array(260);
      const title = tab ? String.fromCharCode(...b.subarray(0, text(tab, b, 260))) : '';
      const t = Date.now();
      while (!(got.length === 1 && path.basename(got[0]) === path.basename(want)) && Date.now() - t < 15000) { got = await require(path.join(__dirname, '..', 'src', 'main', 'shellsel')).query([{ hwnd: Number(koffi.address(h)), tab: title }]); if (got[0] !== want) await sleep(1000); }
      post(h, 0x0010, 0, 0);
    }
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
            if (end !== 'done' && /engine isn’t in this build/.test(r.error)) throw Object.assign(new Error(r.error), { skip: true });
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
        } catch (e) { status = e.skip ? 'SKIP' : 'FAIL'; detail = e.message; }
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
          for (const el of document.querySelectorAll('.caption > *')) { const b = el.getBoundingClientRect(); if (b.height && b.bottom > innerHeight - 4) out.push(name + ': "' + el.textContent + '" is cut off at the bottom'); }
          return { n: petals.length, out };`);
        if (r.n) rings++;
        bad.push(...r.out);
      }
    }
    await lime(`if (L.S.state !== 'idle') await L.collapse();`);
    await sleep(250);
    await lime('L.expand("click"); await L.loadHome();');
    await sleep(700);
    for (const id of [null, ':more', 'photocraft', 'lightcraft', 'vectorcraft', 'designcraft', 'effectcraft', 'filmcraft', 'pdfcraft', 'cadcraft', 'soundcraft', 'wordcraft', 'gridcraft', 'deckcraft']) {
      const r = await lime(`
        L.S.homeMore = ${JSON.stringify(id === ':more')}; L.S.app = ${JSON.stringify(id === ':more' ? null : id)}; L.redraw();
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
  await check('wheel rings · labels share one size in each ring', async () => {
    const probe = (name) => lime(`
      await new Promise((res) => setTimeout(res, 450));
      const out = [];
      for (const cls of ['l', 'h']) {
        const sizes = [...new Set([...document.querySelectorAll('.petal[data-i] text.' + cls)].map((t) => getComputedStyle(t).fontSize))];
        if (sizes.length > 1) out.push(${JSON.stringify(name)} + ' · ' + cls + ' sizes ' + sizes.join(', '));
        if (sizes.length && parseFloat(sizes[0]) < (cls === 'l' ? 7 : 5) - 0.01) out.push(${JSON.stringify(name)} + ' · ' + cls + ' is only ' + sizes[0]);
      }
      const l = document.querySelector('.petal[data-i] text.l');
      return { n: document.querySelectorAll('.petal[data-i]').length, out, size: l ? getComputedStyle(l).fontSize : '' };`);
    const bad = [];
    let rings = 0;
    for (const files of [[fx('photo.jpg')], [fx('doc.pdf')], [fx('clip.mp4')], [fx('doc.docx')], [fx('deck.pptx')]].filter((s) => s.every((f) => fs.existsSync(f)))) {
      await lime(`if (L.S.state !== 'idle') await L.collapse();`);
      await sleep(250);
      await lime(`await L.openWith(${JSON.stringify(files)});`);
      await sleep(600);
      const appIds = await lime('return (L.S.items?.apps || []).map((a) => a.id);');
      for (const mode of ['convert', 'tools', 'apps', ...appIds.map((id) => `apps:${id}`), 'more']) {
        await lime(`L.S.app = ${JSON.stringify(mode.split(':')[1] || null)}; L.setMode(${JSON.stringify(mode.split(':')[0])});`);
        const r = await probe(`${path.basename(files[0])} · ${mode}`);
        if (r.n) rings++;
        bad.push(...r.out);
      }
    }
    await lime(`if (L.S.state !== 'idle') await L.collapse();`);
    await sleep(250);
    await lime('L.expand("click"); await L.loadHome();');
    await sleep(700);
    let home = '';
    for (const id of [null, ':more', 'photocraft', 'vectorcraft', 'pdfcraft', 'cadcraft', 'gridcraft']) {
      await lime(`L.S.homeMore = ${JSON.stringify(id === ':more')}; L.S.app = ${JSON.stringify(id === ':more' ? null : id)}; L.redraw();`);
      const r = await probe(`home · ${id || 'apps'}`);
      if (r.n) rings++;
      bad.push(...r.out);
      if (!id) home = r.size;
    }
    await lime(`if (L.S.state !== 'idle') await L.collapse();`);
    if (bad.length) throw new Error(`${bad.length} problems: ${bad.slice(0, 6).join(' · ')}`);
    return `${rings} rings, one size each; the apps share ${home}`;
  });
  if (fs.existsSync(fx('photo.jpg'))) await check('wheel sounds · a tick per slice, a thud on drop, silent when off', async () => {
    await lime(`await L.openWith(${JSON.stringify([fx('photo.jpg')])});`);
    await sleep(500);
    const sweep = () => lime(`
      const before = L.sounds.played.tick;
      for (let i = 0; i < L.S.ring.length; i++) { L.setHot(i); await new Promise((res) => setTimeout(res, 60)); }
      L.setHot(-1);
      return { n: L.S.ring.length, ticks: L.sounds.played.tick - before };`);
    const a = await sweep();
    if (a.ticks !== a.n) throw new Error(`${a.ticks} ticks over ${a.n} slices`);
    const fast = await lime('const b = L.sounds.played.tick; for (let k = 0; k < 4; k++) for (let i = 0; i < L.S.ring.length; i++) L.setHot(i); L.setHot(-1); return L.sounds.played.tick - b;');
    if (fast > 2) throw new Error(`${fast} ticks in one burst`);
    await lime('await L.collapse();');
    await sleep(500);
    await summonWith([fx('photo.jpg')]);
    const d0 = await lime('return L.sounds.played.drop;');
    await dragAt('drop', '.center');
    if (!(await until('return L.S.state === "open"', 4000))) throw new Error('the drop did not open the wheel');
    const d1 = await lime('return L.sounds.played.drop;');
    if (d1 !== d0 + 1) throw new Error(`the drop sound played ${d1 - d0} times`);
    const levels = await lime(`
      const out = {};
      for (const kind of ['tick', 'drop', 'open', 'fold', 'done']) {
        const c = new OfflineAudioContext(1, 48000, 48000);
        L.sounds.play(kind, c, 0.01);
        const d = (await c.startRendering()).getChannelData(0);
        let peak = 0, last = 0;
        for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; if (v > 0.001) last = i; }
        out[kind] = { db: Math.round(20 * Math.log10(peak)), ms: Math.round((last / 48000 - 0.01) * 1000) };
      }
      return out;`);
    for (const [kind, { db, ms }] of Object.entries(levels)) {
      if (db > -12 || db < -30) throw new Error(`${kind} peaks at ${db} dBFS`);
      if (ms > (kind === 'done' ? 600 : 130)) throw new Error(`${kind} lasts ${ms} ms`);
    }
    await lime('await L.collapse();');
    await sleep(400);
    await js('window.lime.invoke("settings:set", { sounds: false })');
    await sleep(400);
    await lime(`await L.openWith(${JSON.stringify([fx('photo.jpg')])});`);
    await sleep(500);
    const off = await sweep();
    await js('window.lime.invoke("settings:set", { sounds: true })');
    await sleep(300);
    if (off.ticks) throw new Error(`${off.ticks} ticks with sounds off`);
    return `${a.n} ticks, ${fast} in a burst, one thud; ${Object.entries(levels).map(([k, v]) => `${k} ${v.db} dB ${v.ms} ms`).join(', ')}; silent when off`;
  });
  if (fs.existsSync(fx('photo.jpg'))) {
    const lightAt = () => js('(() => { const l = document.querySelector("#fRim fePointLight"); return [Number(l.getAttribute("x")), Number(l.getAttribute("y"))]; })()');
    const spot = async (sel, dx, dy) => {
      const p = await js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2 + ${dx}), y: Math.round(b.y + b.height / 2 + ${dy}) }; })()`);
      wheel().webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
      await sleep(30);
      wheel().webContents.sendInputEvent({ type: 'mouseMove', x: p.x + 1, y: p.y });
      return p;
    };
    const toDial = (p) => js(`(() => { const r = document.querySelector('.dial').getBoundingClientRect(), k = 300 / r.width; return [(${p.x} - (r.left + r.width / 2)) * k, (${p.y} - (r.top + r.height / 2)) * k]; })()`);
    await check('glass · the light follows the pointer and drifts when it leaves', async () => {
      await lime(`await L.openWith(${JSON.stringify([fx('photo.jpg')])});`);
      await sleep(600);
      const before = await lightAt();
      const p = await spot('.petal[data-i="1"] text.l', 8, -6);
      await sleep(500);
      const after = await lightAt(), want = await toDial(p);
      const off = Math.hypot(after[0] - want[0], after[1] - want[1]);
      if (after[0] === before[0] && after[1] === before[1]) throw new Error(`the light stayed at ${before}`);
      if (off > 12) throw new Error(`the light is ${Math.round(off)} units from the pointer (light ${after.map(Math.round)}, pointer ${want.map(Math.round)})`);
      const shade = await js('document.querySelector("#fRim feOffset.away").getAttribute("dx")');
      if (!(Number(shade) > 0.5)) throw new Error(`the shade did not turn away from the light: dx ${shade}`);
      wheel().webContents.sendInputEvent({ type: 'mouseMove', x: 3, y: 3 });
      await sleep(1500);
      const gone = await lightAt(), moved = Math.hypot(gone[0] - after[0], gone[1] - after[1]), radius = Math.hypot(...gone);
      if (moved < 15) throw new Error(`the light moved only ${Math.round(moved)} units after the pointer left`);
      if (radius < 120) throw new Error(`drifting at radius ${Math.round(radius)}, inside the wheel`);
      const dbg = wheel().webContents.debugger;
      let still;
      try {
        dbg.attach('1.3');
        await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await sleep(300);
        const l0 = await lightAt();
        await spot('.petal[data-i="4"] text.l', 6, 4);
        await sleep(500);
        const l1 = await lightAt();
        still = { l0, l1, nudge: await js('getComputedStyle(document.querySelector(".petal.hot")).translate') };
      } finally {
        await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
        dbg.detach();
      }
      wheel().webContents.sendInputEvent({ type: 'mouseMove', x: 3, y: 3 });
      if (Math.hypot(still.l1[0] - still.l0[0], still.l1[1] - still.l0[1]) > 0.5) throw new Error(`with reduced motion the light still moved from ${still.l0} to ${still.l1}`);
      if (still.nudge !== 'none') throw new Error(`with reduced motion the slice still leaned ${still.nudge}`);
      return `followed to ${Math.round(off)} units from the pointer, shade turned (dx ${shade}); drifted ${Math.round(moved)} units, now at radius ${Math.round(radius)}; still under reduced motion`;
    });
    await check('glass · the middle is a dome with a real displacement map', async () => {
      await lime(`await L.openWith(${JSON.stringify([fx('photo.jpg')])});`);
      await sleep(400);
      const r = await js(`(async () => {
        const vis = document.querySelector('.center .vis'), filter = getComputedStyle(vis).filter, href = document.querySelector('#fLens feImage').getAttribute('href');
        const scales = ['r', 'g', 'b'].map((c) => Number(document.querySelector('#fLens .lens-' + c).getAttribute('scale')));
        const img = new Image(); img.src = href; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const at = (fx, fy) => [...g.getImageData(Math.round(img.width * fx), Math.round(img.height * fy), 1, 1).data].slice(0, 3);
        return { filter, size: [img.width, img.height], scales, centre: at(0.5, 0.5), inner: at(0.5, 0.25), right: at(0.97, 0.5), left: at(0.03, 0.5), bottom: at(0.5, 0.97), magnify: getComputedStyle(vis.firstElementChild).scale, dome: getComputedStyle(document.querySelector('.glaze .dome')).filter };
      })()`);
      if (!/fLens/.test(r.filter)) throw new Error(`the middle's filter is ${r.filter}`);
      if (!/fDome/.test(r.dome)) throw new Error(`the dome's filter is ${r.dome}`);
      if (!(r.scales[0] > 1 && r.scales[0] < r.scales[1] && r.scales[1] < r.scales[2])) throw new Error(`channel scales ${r.scales}`);
      for (const [name, px] of [['middle', r.centre], ['inside the bevel', r.inner]]) if (Math.abs(px[0] - 128) > 2 || Math.abs(px[1] - 128) > 2 || px[2] > 2) throw new Error(`the ${name} of the map is ${px}, not flat`);
      if (r.right[0] < 200 || r.left[0] > 55 || r.bottom[1] < 200 || r.right[2] < 250) throw new Error(`the rim of the map is right ${r.right}, left ${r.left}, bottom ${r.bottom}`);
      if (r.magnify !== '1.03') throw new Error(`magnify ${r.magnify}`);
      return `${r.size.join('×')} map: flat ${r.centre} in the middle, ${r.right} at the right rim; channel scales ${r.scales.join(', ')} px; magnify ${r.magnify}`;
    });
    await check('glass · the lit slice leans toward the pointer and stays under it', async () => {
      await lime(`await L.openWith(${JSON.stringify([fx('photo.jpg')])});`);
      await sleep(400);
      const out = [];
      for (const [i, dx, dy] of [[1, 22, -14], [5, -20, 12], [3, 14, 16]]) {
        const p = await spot(`.petal[data-i="${i}"] text.l`, dx, dy);
        await sleep(600);
        const r = await js(`(() => { const L = window.__lime, g = document.querySelector('.petal.hot'), el = document.elementFromPoint(${p.x}, ${p.y}), s = g ? getComputedStyle(g).translate : 'none', t = s === 'none' ? [0, 0] : s.split(' ').map(parseFloat); return { hot: L.S.hot, under: el && el.closest('.petal')?.dataset.i, ring: L.ringIndexAt(${p.x}, ${p.y}), nudge: Math.hypot(t[0], t[1] || 0) }; })()`);
        if (r.hot !== i) throw new Error(`slice ${i}: hot is ${r.hot}`);
        if (!(r.nudge >= 0.3 && r.nudge <= 3.05)) throw new Error(`slice ${i}: leaned ${r.nudge.toFixed(2)} px`);
        if (String(r.under) !== String(i) || r.ring !== i) throw new Error(`slice ${i}: leaned ${r.nudge.toFixed(2)} px and now slice ${r.under} is under the pointer (hit test says ${r.ring})`);
        out.push(`${i}: ${r.nudge.toFixed(1)} px`);
      }
      wheel().webContents.sendInputEvent({ type: 'mouseMove', x: 3, y: 3 });
      return `leaned ${out.join(', ')}; always still under the pointer`;
    });
  }
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
      while (!found && Date.now() - t4 < 20000) { found = fs.readdirSync(OUT).map((d) => path.join(OUT, d, 'editme (edited).pdf')).find((p) => fs.existsSync(p)); await sleep(200); }
      if (!found) throw new Error('Save As wrote nothing');
      await sleep(400);
      const shown = await js('[document.title, document.querySelector(".topbar .doc b").textContent]', win.webContents);
      if (shown[0] !== 'editme (edited).pdf' || shown[1] !== 'editme (edited).pdf') throw new Error(`after Save as the title shows ${shown.join(' / ')}`);
      ed.detail = `${path.relative(OUT, want)}, ${path.relative(OUT, found)}; title follows Save as`;
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
    await ejs('document.querySelector(\'[data-tool="edittext"]\').click()');
    if (!(await wait('[...document.querySelectorAll(".tline")].length > 3'))) throw new Error('no editable lines');
    await ejs(`(() => { const rows = [...document.querySelectorAll('.tline:not(.mask)')].sort((a, b) => a.offsetTop - b.offsetTop); const el = rows[3]; el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); })()`);
    if (!(await wait('!!document.querySelector(".tline.mask.ready")', 6000))) throw new Error('the edited line has no page-coloured mask');
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await sleep(300);
    await ejs('document.querySelector(\'[data-tool="select"]\').click()');
    if (!(await wait('document.querySelectorAll(".pobj").length >= 3'))) throw new Error(`Select shows ${await ejs('document.querySelectorAll(".pobj").length')} things on the page`);
    const kinds = await ejs('[...document.querySelectorAll(".pobj")].map((x) => x.title.split(":")[0])');
    const rect = (want) => ejs(`(() => { const r = document.querySelector('.pobj[title^="${want}"]').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
    const tb = await rect('Table'), pc = await rect('Picture'), from = { x: Math.round(tb.l - 12), y: Math.round(tb.b - 6) }, to = { x: Math.round(pc.l + 60), y: Math.round(pc.b + 10) };
    wc.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
    for (let n = 1; n <= 6; n++) { wc.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x + ((to.x - from.x) * n) / 6), y: Math.round(from.y + ((to.y - from.y) * n) / 6), modifiers: ['leftButtonDown'] }); await sleep(30); }
    wc.sendInputEvent({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 });
    if (!(await wait('document.querySelectorAll(".pobj.sel").length >= 2 && /objects/.test(document.querySelector(".props h3")?.textContent || "")', 4000))) throw new Error(`a box across the table and the picture picked ${await ejs('document.querySelectorAll(".pobj.sel").length')}: ${await ejs('document.querySelector(".props h3")?.textContent')}`);
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    if (!(await wait('!document.querySelector(".pobj.sel")', 3000))) throw new Error('Escape did not let go of the picked objects');
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

  const tight = { name: 'edit pdf · a line taken out at single spacing keeps its neighbours', status: 'PASS', detail: '' };
  try {
    const { PDFDocument, StandardFonts } = require('pdf-lib');
    const doc = await PDFDocument.create(), page = doc.addPage([300, 200]), f = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Top line, gjpqy. fully - done_', { x: 20, y: 150, size: 12, font: f });
    page.drawText('bdfhkl Second line stays', { x: 20, y: 138, size: 12, font: f });
    page.drawText('Third line here', { x: 20, y: 126, size: 12, font: f });
    const src = path.join(OUT, 'tight.pdf');
    fs.writeFileSync(src, await doc.save());
    const E = require('../src/main/pdfedit');
    const got = async (label, edits) => {
      const s = await E.open(src), lines = await E.text(s.id, 0);
      await E.apply(s.id, edits(lines[0], lines[1]));
      const out = path.join(OUT, `tight-${label}.pdf`);
      await E.save(s.id, out);
      const s2 = await E.open(out);
      return (await E.text(s2.id, 0)).map((l) => l.text).join(' | ');
    };
    const box = (t) => [t.bbox[0], t.bbox[1], t.bbox[2] - t.bbox[0], t.bbox[3] - t.bbox[1]];
    const cases = {
      deleted: await got('deleted', (t) => [{ type: 'deleteText', page: 0, bbox: t.bbox }]),
      whiteout: await got('whiteout', (t) => [{ type: 'whiteout', page: 0, rect: box(t), color: '#ffffff' }]),
      redacted: await got('redacted', (t) => [{ type: 'redact', page: 0, rect: [64, t.bbox[1], 34, t.bbox[3] - t.bbox[1]], boxes: true }]),
      replaced: await got('replaced', (t, u) => [{ type: 'replace', page: 0, bbox: [t.bbox[0], t.bbox[1], Math.max(t.bbox[2], u.bbox[2]), u.bbox[3]], x: t.origin[0], y: t.origin[1], text: 'New words here', size: 12, font: 'sans' }]),
    };
    for (const [k, v] of Object.entries(cases)) {
      if (!/bdfhkl Second line stays/.test(v) && k !== 'replaced') throw new Error(`${k}: the second line lost letters: ${v}`);
      if (!/Third line here/.test(v)) throw new Error(`${k}: the third line lost letters: ${v}`);
      if (/gjpqy/.test(v)) throw new Error(`${k}: the word under it is still there: ${v}`);
    }
    if (!/New words here/.test(cases.replaced) || /Second/.test(cases.replaced)) throw new Error(`replace: ${cases.replaced}`);
    tight.detail = `deleted, whited out, redacted and replaced: the lines beside kept every letter`;
  } catch (e) { tight.status = 'FAIL'; tight.detail = e.message; }
  console.log(`${tight.status} ${tight.name.padEnd(44)}        ${tight.detail}`);
  results.push(tight);

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
    await ejs(`(() => { const el = [...document.querySelectorAll('.obj.text')].find((x) => x.textContent === 'APPROVED'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 1, clientY: 1 })); window.dispatchEvent(new PointerEvent('pointerup', {})); })()`);
    if (!(await wait('document.querySelector(".props h3")?.textContent === "Stamp"', 2000))) throw new Error('selecting the stamp did not show its settings');
    for (const [label, v] of [['Size (pt)', 24], ['Rotation (°)', 30], ['Opacity (%)', 80]]) await ejs(`(() => { const n = document.querySelector('.props input.num[aria-label="${label}"]'); n.value = ${v}; n.dispatchEvent(new Event('change')); })()`);
    const turned = await ejs(`getComputedStyle([...document.querySelectorAll('.obj.text')].find((x) => x.textContent === 'APPROVED')).transform`);
    if (!/matrix\(0\.86/.test(turned)) throw new Error(`stamp preview not turned: ${turned} ${JSON.stringify(await ejs(`(() => { const els = [...document.querySelectorAll('.obj.text')]; return { n: els.length, styles: els.map((x) => x.getAttribute('style')), panel: document.querySelector('.props h3')?.textContent, rot: document.querySelector('.props input.num[aria-label="Rotation (°)"]')?.value, sel: document.querySelectorAll('.obj.sel').length, editing: document.activeElement?.className }; })()`))}`);
    await ejs('document.querySelector(\'[data-tool="stamp"]\').click()');
    await ejs(`(() => { const i = [...document.querySelectorAll('.props input[type=text]')].find((x) => /own words/.test(x.closest('.field').textContent)); i.value = 'CHECKED BY JK'; i.dispatchEvent(new Event('input')); })()`);
    await press(0.55, 0.62);
    if (!(await wait('[...document.querySelectorAll(".obj.text")].some((x) => x.textContent === "CHECKED BY JK")', 2000))) throw new Error('own words stamp missing');
    await ejs('document.querySelector(\'.props [data-st="mark:check"]\').click()');
    await press(0.1, 0.5);
    if (!(await wait('!!document.querySelector(".obj svg path")', 2000))) throw new Error('no tick on the page');
    await ejs('document.querySelector(\'.props [data-st="date"]\').click()');
    await press(0.1, 0.56);
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
  const E = require('../src/main/pdfedit');
  const editorTest = async (name, srcName, make, fn) => {
    if (process.env.LIME_EDITOR && !new RegExp(process.env.LIME_EDITOR, 'i').test(name)) return;
    const r = { name, status: 'PASS', detail: '' };
    let win = null;
    const openDialog = dialog.showOpenDialog;
    try {
      const src = path.join(OUT, srcName);
      if (typeof make === 'function') fs.writeFileSync(src, await make()); else fs.copyFileSync(fx(make), src);
      await js('window.lime.invoke("settings:set", { editors: {} })');
      openEditor(src, 'edit');
      win = [...editors].pop();
      const wc = win.webContents, ejs = (code) => js(code, wc);
      while (wc.isLoading()) await sleep(200);
      const wait = async (code, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code)) return true; await sleep(150); } return false; };
      if (!(await wait('!!document.querySelector(".pdfpage img.r[src]") && !!document.querySelector(".props h3")'))) throw new Error('editor did not load');
      await sleep(500);
      const at = (page) => `const l = document.querySelectorAll('.pdfpage .layer')[${page}], b = l.getBoundingClientRect(), p = (u, v) => ({ clientX: b.left + b.width * u, clientY: b.top + b.height * v });`;
      const ed = {
        ejs, wait, wc, src,
        idle: async () => { await sleep(250); return wait('document.querySelector(".ed-status").hidden || !/…$/.test(document.querySelector(".ed-status").textContent)', 20000); },
        click: (u, v, page = 0) => ejs(`(() => { ${at(page)} l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ...p(${u}, ${v}) })); window.dispatchEvent(new PointerEvent('pointerup', p(${u}, ${v}))); })()`),
        drag: (u0, v0, u1, v1, page = 0) => ejs(`(() => { ${at(page)} l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ...p(${u0}, ${v0}) })); window.dispatchEvent(new PointerEvent('pointermove', p(${(u0 + u1) / 2}, ${(v0 + v1) / 2}))); window.dispatchEvent(new PointerEvent('pointermove', p(${u1}, ${v1}))); window.dispatchEvent(new PointerEvent('pointerup', p(${u1}, ${v1}))); })()`),
        tool: (t) => ejs(`document.querySelector('[data-tool="${t}"]').click()`),
        set: (sel, value, ev = 'input') => ejs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(${JSON.stringify(ev)}, { bubbles: true })); return true; })()`),
        press: (sel) => ejs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`),
        pick: (file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); },
        save: async () => {
          const out = path.join(OUT, `${srcName.replace(/\.pdf$/, '')} (edited).pdf`), was = fs.existsSync(out) ? fs.statSync(out).mtimeMs : 0;
          await ejs('document.querySelector(\'[data-a="save"]\').click()');
          const t = Date.now();
          while (!(fs.existsSync(out) && fs.statSync(out).mtimeMs !== was) && Date.now() - t < 30000) await sleep(200);
          if (!fs.existsSync(out) || fs.statSync(out).mtimeMs === was) throw new Error('Save wrote nothing');
          await sleep(600);
          return out;
        },
      };
      r.detail = await fn(ed);
    } catch (e) { r.status = 'FAIL'; r.detail = e.message; }
    dialog.showOpenDialog = openDialog;
    win?.destroy();
    console.log(`${r.status} ${r.name.padEnd(44)}        ${r.detail}`);
    results.push(r);
  };
  const annotsOf = async (file, password) => { const s = await E.open(file, password); return { s, list: E.annots(s.id) }; };

  await editorTest('edit pdf · notes, replies and markup as comments', 'notes.pdf', 'doc.pdf', async (ed) => {
    await ed.tool('note');
    await ed.click(0.62, 0.1);
    if (!(await ed.wait('!!document.querySelector(".cm.sel textarea")', 8000))) throw new Error('the new note did not open in the Comments panel');
    await ed.set('.cm.sel textarea', 'Should this heading be bigger?', 'change');
    await ed.idle();
    await ed.set('.cm.sel .cmrow input', 'Yes, 24 pt.');
    await ed.ejs(`document.querySelector('.cm.sel .cmrow input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    if (!(await ed.wait('!!document.querySelector(".cm.sel .cmreply")', 8000))) throw new Error('the reply did not show');
    await ed.tool('highlight');
    await ed.drag(0.1, 0.135, 0.5, 0.152);
    await ed.tool('rect');
    await ed.drag(0.55, 0.5, 0.8, 0.6);
    await ed.press('[data-tool="select"]');
    const out = await ed.save();
    const { list } = await annotsOf(out);
    const note = list.find((a) => a.type === 'Text' && a.replyTo == null), reply = list.find((a) => a.replyTo != null);
    if (note?.contents !== 'Should this heading be bigger?') throw new Error(`note: ${JSON.stringify(note)}`);
    if (reply?.contents !== 'Yes, 24 pt.' || reply.replyTo !== note.num) throw new Error(`reply: ${JSON.stringify(reply)}`);
    for (const t of ['Highlight', 'Square']) if (!list.some((a) => a.type === t && a.page === 0)) throw new Error(`no ${t} comment in ${list.map((a) => a.type)}`);
    await ed.press('[data-a="saveopts"]');
    await ed.press('.popmenu [data-k="flatten"]');
    await ed.ejs('document.querySelector(".popmenu")?.remove()');
    await ed.ejs('document.querySelector(".pdfpage .layer").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))');
    await ed.tool('highlight');
    await ed.drag(0.1, 0.17, 0.4, 0.19);
    const flat = await ed.save();
    const after = await annotsOf(flat);
    if (after.list.length) throw new Error(`flattened file still has ${after.list.map((a) => a.type)}`);
    const { data, info } = await require('sharp')(await E.render(after.s.id, 0, 1)).raw().toBuffer({ resolveWithObject: true });
    let yellow = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i] > 200 && data[i + 1] > 180 && data[i + 2] < 140) yellow++;
    if (yellow < 300) throw new Error(`flattened highlight: ${yellow} yellow pixels`);
    return `note by ${note.author || 'someone'} with a reply, highlight and box saved as comments; flattened on the second save (${yellow} px of highlight)`;
  });

  await editorTest('edit pdf · links and bookmarks', 'links.pdf', 'chapters.pdf', async (ed) => {
    await ed.tool('link');
    await ed.drag(0.1, 0.07, 0.6, 0.11);
    if (!(await ed.wait('!!document.querySelector(".props [data-l=url]")', 4000))) throw new Error('no link panel');
    await ed.set('.props [data-l=url]', 'example.com/lime');
    await ed.press('.props .cmrow .btn.primary');
    await ed.idle();
    await ed.drag(0.1, 0.13, 0.5, 0.15);
    await ed.press('.props [data-to="page"]');
    await ed.set('.props [data-l=page]', '3');
    await ed.press('.props .cmrow .btn.primary');
    await ed.idle();
    if (!(await ed.wait('document.querySelectorAll(".plink:not(.draft):not(.new)").length === 2', 6000))) throw new Error(`${await ed.ejs('document.querySelectorAll(".plink").length')} links on the page`);
    await ed.press('[data-side="bookmarks"]');
    if (!(await ed.wait('document.querySelectorAll(".bm").length === 3', 4000))) throw new Error('the bookmarks are not listed');
    await ed.press('.bm[data-path="2"]');
    await ed.press('[data-b="del"]');
    await ed.idle();
    await ed.press('.bm[data-path="1"]');
    await ed.press('[data-b="add"]');
    if (!(await ed.wait('!!document.querySelector(".bmedit")', 4000))) throw new Error('a new bookmark did not ask for its name');
    await ed.set('.bmedit', 'Appendix');
    await ed.ejs(`document.querySelector('.bmedit').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await ed.idle();
    if (!(await ed.wait('[...document.querySelectorAll(".bm .t")].some((t) => t.textContent === "Appendix")', 4000))) throw new Error('the new bookmark is not listed');
    await ed.ejs(`[...document.querySelectorAll('.bm')].find((b) => b.textContent.includes('Appendix')).click()`);
    await ed.press('[data-b="in"]');
    await ed.idle();
    const out = await ed.save();
    const s = await E.open(out), links = E.links(s.id), tree = E.outline(s.id);
    if (!links.some((l) => l.page === 0 && l.url === 'https://example.com/lime')) throw new Error(`links ${JSON.stringify(links)}`);
    if (!links.some((l) => l.page === 0 && l.toPage === 2)) throw new Error(`no link to page 3: ${JSON.stringify(links)}`);
    const shape = JSON.stringify(tree.map((b) => [b.title, b.kids.map((k) => k.title)]));
    if (shape !== JSON.stringify([['Introduction', []], ['Middle', ['Appendix']]])) throw new Error(`bookmarks ${shape}`);
    return `a web link and a link to page 3; bookmarks ${shape}`;
  });

  await editorTest('edit pdf · prepare a form: add, rename and fill fields', 'formmake.pdf', 'doc.pdf', async (ed) => {
    await ed.tool('field');
    await ed.drag(0.1, 0.3, 0.5, 0.33);
    if (!(await ed.wait('document.querySelectorAll(".pfield.edit").length === 1', 10000))) throw new Error('no text field');
    await ed.press('.props [data-fk="checkbox"]');
    await ed.click(0.12, 0.37);
    if (!(await ed.wait('document.querySelectorAll(".pfield.edit").length === 2', 10000))) throw new Error('no tick box');
    await ed.press('.props [data-fk="combo"]');
    await ed.drag(0.1, 0.4, 0.4, 0.43);
    if (!(await ed.wait('document.querySelectorAll(".pfield.edit").length === 3 && !!document.querySelector(".props textarea")', 10000))) throw new Error('no drop-down');
    await ed.set('.props textarea', 'Tea\nCoffee\nWater', 'change');
    await ed.idle();
    await ed.ejs(`(() => { const f = [...document.querySelectorAll('.pfield.edit')].find((x) => x.title === 'Text1'); const b = f.getBoundingClientRect(); f.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: b.left + 5, clientY: b.top + 5 })); window.dispatchEvent(new PointerEvent('pointerup', { clientX: b.left + 5, clientY: b.top + 5 })); })()`);
    if (!(await ed.wait('document.querySelector(".props .field input")?.value === "Text1"', 4000))) throw new Error('selecting the field did not show its name');
    await ed.set('.props .field input', 'Full name', 'change');
    await ed.idle();
    if (!(await ed.wait('[...document.querySelectorAll(".pfield.edit")].some((x) => x.title === "Full name")', 6000))) throw new Error('the field was not renamed');
    await ed.tool('select');
    if (!(await ed.wait('document.querySelectorAll(".pfield.fill").length === 3', 4000))) throw new Error('no inputs to fill in');
    await ed.set('.pfield.fill input[type=text]', 'Ada Lovelace');
    await ed.ejs(`(() => { const c = document.querySelector('.pfield.fill input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await ed.set('.pfield.fill select', 'Coffee', 'change');
    const out = await ed.save();
    const s = await E.open(out), fields = Object.fromEntries(E.fields(s.id).map((f) => [f.name, f]));
    if (fields['Full name']?.value !== 'Ada Lovelace') throw new Error(`Full name = ${fields['Full name']?.value}`);
    if (!fields['Check Box1'] || fields['Check Box1'].value === 'Off' || !fields['Check Box1'].value) throw new Error(`tick box = ${fields['Check Box1']?.value}`);
    if (fields.Dropdown1?.value !== 'Coffee' || fields.Dropdown1.options.join() !== 'Tea,Coffee,Water') throw new Error(`drop-down = ${fields.Dropdown1?.value} of ${fields.Dropdown1?.options}`);
    await ed.press('[data-a="docmenu"]');
    await ed.press('.popmenu [data-d="flatfields"]');
    await ed.idle();
    const flat = await ed.save();
    const f2 = await E.open(flat), text = (await E.text(f2.id, 0)).map((l) => l.text).join(' ');
    if (E.fields(f2.id).length) throw new Error('flattened file still has fields');
    if (!text.includes('Ada Lovelace')) throw new Error(`the typed name is not on the page: ${text.slice(0, 160)}`);
    return 'text field renamed “Full name”, tick box and drop-down (Tea, Coffee, Water) filled and saved, then flattened';
  });

  await editorTest('edit pdf · fill in an existing form', 'fillme.pdf', 'fillable.pdf', async (ed) => {
    if (!(await ed.wait('document.querySelector(\'[data-tool="select"]\').getAttribute("aria-pressed") === "true" && document.querySelectorAll(".pfield.fill").length === 4', 8000))) throw new Error('the form did not open ready to fill in');
    await ed.ejs(`(() => { const by = (n) => [...document.querySelectorAll('.pfield.fill')].find((x) => x.dataset.name === n); const t = by('Full name').querySelector('input'); t.value = 'Grace Hopper'; t.dispatchEvent(new Event('input', { bubbles: true })); const d = by('Date of birth').querySelector('input'); d.value = '9 December 1906'; d.dispatchEvent(new Event('input', { bubbles: true })); const c = by('Agree').querySelector('input'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); const s = by('Colour').querySelector('select'); s.value = 'Blue'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await ed.press('[data-side="fields"]');
    if (!(await ed.wait('[...document.querySelectorAll(".fl .cmtext")].some((x) => x.textContent === "Grace Hopper")', 3000))) throw new Error('the Fields panel does not show the typed value');
    const out = await ed.save();
    const s = await E.open(out), v = Object.fromEntries(E.fields(s.id).map((f) => [f.name, f.value]));
    const got = [v['Full name'], v['Date of birth'], v.Agree, v.Colour];
    if (JSON.stringify(got) !== JSON.stringify(['Grace Hopper', '9 December 1906', 'Yes', 'Blue'])) throw new Error(`saved ${JSON.stringify(got)}`);
    return `saved ${got.join(', ')}`;
  });

  await editorTest('edit pdf · redact words, e-mails and an area', 'redact.pdf', 'doc.pdf', async (ed) => {
    await ed.tool('redact');
    await ed.set('.props .field input', 'Invoice 2026-0419');
    await ed.press('.props .field .btn');
    if (!(await ed.wait('document.querySelectorAll(".obj.redact").length >= 1', 6000))) throw new Error('finding the words marked nothing');
    await ed.idle();
    const terms = await ed.ejs('document.querySelectorAll(".obj.redact").length');
    await ed.press('.props [data-pat="email"]');
    if (!(await ed.wait(`document.querySelectorAll(".obj.redact").length >= ${terms + 3}`, 8000))) throw new Error('no e-mail address marked');
    await ed.drag(0.15, 0.4, 0.35, 0.5);
    const marked = await ed.ejs('document.querySelectorAll(".obj.redact").length');
    await ed.ejs(`[...document.querySelectorAll('.props .btn')].find((b) => /Apply redactions/.test(b.textContent)).click()`);
    await ed.idle();
    if (!(await ed.wait('!document.querySelector(".obj.redact")', 8000))) throw new Error('the marks are still waiting');
    const out = await ed.save();
    const s = await E.open(out);
    let all = '';
    for (let i = 0; i < 3; i++) all += (await E.text(s.id, i)).map((l) => l.text).join(' ');
    if (/2026-0419|hello@example\.com/.test(all)) throw new Error(`still readable: ${all.slice(0, 200)}`);
    if (!/quick brown fox/.test(all)) throw new Error('too much was removed');
    const { data, info } = await require('sharp')(await E.render(s.id, 0, 1)).raw().toBuffer({ resolveWithObject: true });
    let black = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i] < 20 && data[i + 1] < 20 && data[i + 2] < 20) black++;
    if (black < 4000) throw new Error(`only ${black} black pixels: no boxes`);
    return `${marked} marks applied: the invoice number and e-mail addresses are gone from all pages, black boxes in their place`;
  });

  await editorTest('edit pdf · edit a paragraph, measure and crop', 'para.pdf', async () => {
    const { PDFDocument, StandardFonts } = require('pdf-lib');
    const doc = await PDFDocument.create(), page = doc.addPage([400, 500]), f = await doc.embedFont(StandardFonts.Helvetica);
    ['Lime keeps every line of this paragraph', 'together, so that editing one word lets', 'the rest flow on to the next line as it', 'would in a word processor.'].forEach((t, i) => page.drawText(t, { x: 40, y: 440 - i * 14, size: 11, font: f }));
    page.drawText('A line well below the paragraph.', { x: 40, y: 200, size: 11, font: f });
    return doc.save();
  }, async (ed) => {
    await ed.tool('edittext');
    await ed.press('.props [data-k="paragraph"]');
    if (!(await ed.wait('document.querySelectorAll(".tline.para").length >= 2', 6000))) throw new Error('no paragraphs to click');
    await ed.ejs(`(() => { const el = [...document.querySelectorAll('.tline.para')].sort((a, b) => b.offsetHeight - a.offsetHeight)[0]; el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); })()`);
    if (!(await ed.wait('!!document.querySelector(".obj.text[contenteditable=plaintext-only]")', 3000))) throw new Error('the paragraph did not open for editing');
    const words = 'Lime now keeps every single line of this rather longer paragraph together, so that editing any one word lets all of the rest flow on to the next line, as it would in a word processor, and nothing runs off the side.';
    await ed.ejs(`(() => { const el = document.querySelector('.obj.text[contenteditable=plaintext-only]'); el.textContent = ${JSON.stringify(words)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    ed.wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await sleep(300);
    await ed.tool('measure');
    await ed.drag(0.1, 0.8, 0.6, 0.8);
    const value = await ed.ejs('document.querySelector(".props .readout")?.textContent || ""');
    if (!/^\d+(\.\d+)? mm$/.test(value)) throw new Error(`measured “${value}”`);
    await ed.tool('crop');
    await ed.drag(0.05, 0.05, 0.95, 0.75);
    await ed.ejs(`[...document.querySelectorAll('.props .btn')].find((b) => b.textContent === 'Crop this page').click()`);
    await ed.idle();
    const out = await ed.save();
    const s = await E.open(out), lines = await E.text(s.id, 0), { list } = await annotsOf(out);
    const para = lines.filter((l) => l.bbox[1] < 140);
    const text = para.map((l) => l.text).join(' ');
    if (!text.includes('nothing runs off the side')) throw new Error(`paragraph text: ${text}`);
    if (para.length < 6) throw new Error(`the paragraph has ${para.length} lines: it did not rewrap`);
    const right = Math.max(...para.map((l) => l.bbox[2]));
    if (right > 40 + 225) throw new Error(`a line runs to ${right.toFixed(0)} pt, past the paragraph's width`);
    const m = list.find((a) => a.type === 'Line' && a.intent === 'LineDimension');
    if (!m || m.contents !== value) throw new Error(`measurement comment ${JSON.stringify(m)} for ${value}`);
    if (Math.abs(s.pages[0].h - 500 * 0.7) > 4 || Math.abs(s.pages[0].w - 400 * 0.9) > 4) throw new Error(`cropped to ${s.pages[0].w}×${s.pages[0].h}`);
    return `paragraph rewrapped into ${para.length} lines within its width; measured ${value}; page cropped to ${Math.round(s.pages[0].w)}×${Math.round(s.pages[0].h)} pt`;
  });

  await editorTest('edit pdf · header, footer, watermark, properties and password', 'decor.pdf', 'doc.pdf', async (ed) => {
    await ed.press('[data-a="docmenu"]');
    await ed.press('.popmenu [data-d="headerFooter"]');
    if (!(await ed.wait('!!document.querySelector(\'[data-box="header_left"]\')', 3000))) throw new Error('no header and footer dialog');
    await ed.set('[data-box="header_left"]', 'Lime handbook');
    await ed.ejs(`document.querySelector('[data-box="footer_right"]').focus(); document.querySelector('[data-tok="<<Page 1 of n>>"]').click()`);
    if (!(await ed.wait('!!document.querySelector(".dlgpreview img")?.src', 6000))) throw new Error('no preview');
    await ed.press('.scrim [data-a="ok"]');
    await ed.idle();
    await ed.press('[data-a="docmenu"]');
    await ed.press('.popmenu [data-d="watermark"]');
    await ed.set('.scrim [data-o="text"]', 'DRAFT');
    await ed.press('.scrim [data-a="ok"]');
    await ed.idle();
    await ed.press('[data-a="docmenu"]');
    await ed.press('.popmenu [data-d="props"]');
    if (!(await ed.wait('!!document.querySelector(\'.scrim [data-p="title"]\')', 6000))) throw new Error('no properties dialog');
    await ed.set('.scrim [data-p="title"]', 'The Lime handbook');
    await ed.set('.scrim [data-p="author"]', 'Ada');
    await ed.press('.scrim [data-a="ok"]');
    await ed.idle();
    await ed.press('[data-a="saveopts"]');
    await ed.press('.popmenu [data-d="security"]');
    await ed.press('.scrim [data-on="1"]');
    await ed.set('.scrim [data-f="pw"]', 'lime123');
    await ed.set('.scrim [data-f="pw2"]', 'lime123');
    await ed.press('.scrim [data-a="ok"]');
    const out = await ed.save();
    let locked = false;
    try { await E.open(out); } catch (e) { locked = /password/i.test(e.message); }
    if (!locked) throw new Error('the saved file opens without a password');
    const s = await E.open(out, 'lime123');
    let all = '';
    for (let i = 0; i < 3; i++) all += `${(await E.text(s.id, i)).map((l) => l.text).join(' ')} `;
    for (const want of ['Lime handbook', 'Page 1 of 3', 'Page 3 of 3', 'DRAFT']) if (!all.includes(want)) throw new Error(`“${want}” is not in the file: ${all.slice(0, 240)}`);
    const p = await E.props(s.id);
    if (p.title !== 'The Lime handbook' || p.author !== 'Ada') throw new Error(`properties ${p.title} / ${p.author}`);
    return 'header, page numbers and a DRAFT watermark on every page, title and author set, saved with a password';
  });

  await editorTest('edit pdf · bulleted text and a replaced picture', 'lists.pdf', 'doc.pdf', async (ed) => {
    await ed.tool('addtext');
    await ed.click(0.1, 0.8);
    if (!(await ed.wait('!!document.querySelector(".obj.text[contenteditable=plaintext-only]")', 3000))) throw new Error('no text box');
    await ed.ejs(`(() => { const el = document.querySelector('.obj.text[contenteditable=plaintext-only]'); el.textContent = 'Milk\\nEggs\\nBread'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await ed.press('.props [data-list="bullet"]');
    if (!(await ed.wait('document.querySelector(".obj.text")?.textContent.startsWith("• Milk")', 2000))) throw new Error('no bullets');
    ed.wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await sleep(200);
    await ed.tool('select');
    if (!(await ed.wait('!!document.querySelector(\'.pobj[title^="Picture"]\')', 6000))) throw new Error('the picture is not selectable');
    await ed.ejs(`document.querySelector('.pobj[title^="Picture"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`);
    ed.pick(fx('photo2.jpg'));
    await ed.ejs(`[...document.querySelectorAll('.props .btn')].find((b) => /Replace/.test(b.textContent)).click()`);
    if (!(await ed.wait('!!document.querySelector(".obj img") && !!document.querySelector(".obj.erase")', 8000))) throw new Error('the picture was not replaced');
    await ed.press('.props [data-x="h"]');
    await ed.ejs(`(() => { const n = document.querySelector('.props input.num[aria-label="Opacity (%)"]'); n.value = 60; n.dispatchEvent(new Event('change')); })()`);
    await ed.ejs(`(() => { const n = document.querySelector('.props input.num[aria-label="Left (%)"]'); n.value = 25; n.dispatchEvent(new Event('change')); })()`);
    await sleep(500);
    await ed.set('.props textarea', 'A photo of a lime');
    const out = await ed.save();
    const s = await E.open(out), lines = (await E.text(s.id, 0)).map((l) => l.text);
    for (const w of ['Milk', 'Eggs', 'Bread']) if (!lines.some((l) => l.startsWith('•') && l.includes(w))) throw new Error(`no bullet for ${w}: ${lines.join(' | ')}`);
    const before = await E.open(fx('doc.pdf'));
    const px = async (id) => { const { data, info } = await require('sharp')(await E.render(id, 0, 0.5)).raw().toBuffer({ resolveWithObject: true }); return { data, info }; };
    const a = await px(before.id), b = await px(s.id);
    const box = (await E.objects(before.id, 0)).find((o) => o.kind === 'image').bbox.map((v) => Math.round(v * 0.5));
    let changed = 0;
    for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) { const i = (y * a.info.width + x) * a.info.channels; if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) > 40) changed++; }
    if (changed < (box[2] - box[0]) * (box[3] - box[1]) * 0.3) throw new Error(`the picture looks the same (${changed} pixels changed)`);
    const pic = (await E.objects(s.id, 0)).find((o) => o.kind === 'image');
    if (!pic || pic.bbox[2] - pic.bbox[0] > (box[2] - box[0]) * 2 * 0.8) throw new Error(`the cropped picture is ${pic ? (pic.bbox[2] - pic.bbox[0]).toFixed(0) : 'missing'} pt wide`);
    const [, figs] = await require('../src/main/engines/crafts').pdfScript([{ tool: 'doc_open', args: { path: out } }, { tool: 'accessibility_figures', args: { doc: 1 } }], null, '');
    if (!figs?.figures?.some((f) => f.alt === 'A photo of a lime' && f.page === 1)) throw new Error(`figures ${JSON.stringify(figs)}`);
    return 'three bulleted lines; the page’s picture replaced, flipped, cropped, at 60% and tagged with its alternative text';
  });

  await editorTest('edit pdf · recognise text in a scan', 'scanned.pdf', 'scan.pdf', async (ed) => {
    const before = (await E.text((await E.open(ed.src)).id, 0)).length;
    await ed.press('[data-a="docmenu"]');
    await ed.press('.popmenu [data-d="ocr"]');
    await ed.press('.scrim [data-a="ok"]');
    await sleep(400);
    if (!(await ed.wait('!/Recognising/.test(document.querySelector(".ed-status").textContent) || document.querySelector(".ed-status").hidden', 90000))) throw new Error('recognising did not finish');
    const out = await ed.save();
    const s = await E.open(out), text = (await E.text(s.id, 0)).map((l) => l.text).join(' ');
    if (before || !/quick/i.test(text) || !/fox/i.test(text)) throw new Error(`text ${before} → “${text.slice(0, 120)}”`);
    const a = await require('sharp')(await E.render((await E.open(ed.src)).id, 0, 0.5)).raw().toBuffer(), b = await require('sharp')(await E.render(s.id, 0, 0.5)).raw().toBuffer();
    let off = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 8) off++;
    if (a.length !== b.length || off > a.length * 0.002) throw new Error(`the page looks different after recognising (${off} values changed)`);
    return `found “${text.slice(0, 40)}…”; the page looks as it did`;
  });


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

  const sharp = require('sharp');
  const openImage = async (src) => {
    openEditor(src, 'image');
    const win = [...editors].pop(), wc = win.webContents, ejs = (code) => js(code, wc);
    while (wc.isLoading()) await sleep(200);
    const wait = async (code, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code)) return true; await sleep(150); } return false; };
    const idle = () => wait('(() => { const x = document.querySelector(".imged")?.__imged; return !!x && x.idle() && !!document.querySelector(".imged .photo[src]"); })()');
    if (!(await idle())) throw new Error('the editor did not show the image');
    await ejs('document.querySelector(\'[data-tool="adjust"]\').click()');
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
    asked = [];
    await ejs('document.querySelector(\'[data-a="saveas"]\').click()');
    if (!(await wait('!!document.querySelector(".scrim [data-f=png]")', 3000))) throw new Error('no format choice for Save as');
    await ejs('document.querySelector(".scrim [data-f=png]").click(); document.querySelector(".scrim [data-a=ok]").click()');
    const t = Date.now();
    let png = null;
    while (!png && Date.now() - t < 30000) { png = fs.readdirSync(OUT).map((d) => path.join(OUT, d, 'editimg (edited).png')).find((p) => fs.existsSync(p)); await sleep(200); }
    if (!png) throw new Error('Save as PNG wrote nothing');
    await sleep(500);
    const pm = await sharp(png).metadata();
    if (pm.format !== 'png' || pm.width !== b.w || pm.height !== b.h) throw new Error(`Save as wrote ${pm.format} ${pm.width}×${pm.height}`);
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

  const ee = { name: 'edit image · erase object, undo, save', status: 'PASS', detail: '' };
  if (!require('../src/main/engines/ai').available('lama')) { ee.status = 'SKIP'; ee.detail = 'the object removal model isn’t packed (vendor/models or LIME_MODELS)'; } else try {
    const src = path.join(OUT, 'erase.png'), W = 800, H = 600;
    const bg = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = 128 + 50 * Math.sin((x + 0.5 * y) / 9), i = (y * W + x) * 3; bg[i] = v; bg[i + 1] = v * 0.8 + 20; bg[i + 2] = 255 - v * 0.6; }
    await sharp(bg, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><circle cx="400" cy="300" r="50" fill="#e02020"/></svg>`) }]).png().toFile(src);
    const { win, ejs, wait, idle, press, saved } = await openImage(src);
    await ejs('document.querySelector(\'[data-tool="erase"]\').click()');
    if (!(await wait('!!document.querySelector(\'.props [data-k="size"]\')', 3000))) throw new Error('no brush size in the panel');
    await ejs('document.querySelector(".imged").__imged.st.erase.size = 0.06');
    await press(0.47, 0.5, [0.53, 0.5]);
    if (!(await wait('document.querySelector(".imged").__imged.st.base === 1 && document.querySelector(".imged").__imged.idle()', 90000))) throw new Error('the erase did not make a new step');
    const label = await ejs('document.querySelector(".imged").__imged.st.hist.at(-1).label');
    await ejs('document.querySelector(\'[data-a="undo"]\').click()');
    if (!(await wait('document.querySelector(".imged").__imged.st.base === 0', 3000))) throw new Error('undo did not bring the object back');
    await ejs('document.querySelector(\'[data-a="redo"]\').click()');
    if (!(await wait('document.querySelector(".imged").__imged.st.base === 1', 3000))) throw new Error('redo did not remove it again');
    await idle();
    await ejs('document.querySelector(\'[data-a="save"]\').click()');
    const out = await saved(path.join(OUT, 'erase (edited).png'));
    const b = await statsOf(out), a = await statsOf(src);
    if (b.w !== W || b.h !== H) throw new Error(`saved ${b.w}×${b.h}`);
    if (a.red < 5000 || b.red > 50) throw new Error(`red pixels ${a.red} → ${b.red}`);
    ee.detail = `“${label}” step: red disc ${a.red} → ${b.red} pixels, undo and redo, saved ${b.w}×${b.h}`;
    win.destroy();
  } catch (e) { ee.status = 'FAIL'; ee.detail = e.message; }
  console.log(`${ee.status} ${ee.name.padEnd(44)}        ${ee.detail}`);
  results.push(ee);

  const mediaEditor = async (src) => {
    openEditor(src, 'media');
    const win = [...editors].pop(), wc = win.webContents, ejs = (code) => js(code, wc);
    while (wc.isLoading()) await sleep(200);
    const wait = async (code, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code).catch(() => false)) return true; await sleep(150); } return false; };
    if (!(await wait('!!window.__media?.st.ready'))) throw new Error('the editor did not load');
    const key = (k) => ejs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
    const at = async (t, k) => { await ejs(`window.__media.seek(${t})`); await sleep(120); await key(k); await sleep(120); };
    const slide = (label, v) => ejs(`(() => { const r = document.querySelector('.props input[type=range][aria-label=${JSON.stringify(label)}]'); r.value = ${v}; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const press = (text) => ejs(`(() => { const b = [...document.querySelectorAll('.props button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); b.click(); return true; })()`);
    return { win, wc, ejs, wait, key, at, slide, press };
  };
  const probeMedia = (p) => require(path.join(__dirname, '..', 'src', 'main', 'engines', 'media')).probe(p);
  const ffmpegBin = require(path.join(__dirname, '..', 'src', 'main', 'engines', 'util')).binPath('ffmpeg');
  const frameAt = async (p, t) => {
    const png = path.join(OUT, `frame-${Date.now()}-${Math.round(t * 1000)}.png`);
    require('child_process').execFileSync(ffmpegBin, ['-v', 'error', '-y', '-ss', String(t), '-i', p, '-frames:v', '1', '-vf', 'scale=in_color_matrix=bt709', png]);
    return require('sharp')(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const loudness = (p, from, len) => {
    const r = require('child_process').spawnSync(ffmpegBin, ['-hide_banner', '-ss', String(from), '-t', String(len), '-i', p, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    return Number((/mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr) || [])[1]);
  };
  await check('edit video · trim, cut, title, fade, save', async () => {
    const src = path.join(OUT, 'clipedit.mp4');
    fs.copyFileSync(fx('clip.mp4'), src);
    const ed = await mediaEditor(src), { ejs, at, key } = ed;
    await at(0.5, 'i');
    await at(3.5, 'o');
    await at(1.5, 's');
    await at(2.0, 's');
    await ejs(`(() => { const c = document.querySelector('.me-tl canvas'), r = c.getBoundingClientRect(), M = window.__media, x = r.left + 14 + 1.75 * M.st.zoom - M.st.scroll, y = r.top + 50;
      c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 })); c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1 })); })()`);
    await sleep(150);
    await key('Delete');
    const keep = await ejs('JSON.stringify(window.__media.kept())');
    if (keep !== '[[0.5,1.5],[2,3.5]]') throw new Error(`kept ${keep}`);
    await ejs('window.__media.seek(1.3); window.__media.play()');
    await sleep(900);
    const played = await ejs('(() => { const t = document.querySelector("video").currentTime; window.__media.pause(); return t; })()');
    if (!(played > 2.05 && played < 3.5)) throw new Error(`playing from 1.3 s reached ${played.toFixed(2)} s instead of skipping the cut`);
    await ejs(`document.querySelector('[data-tool="titles"]').click(); window.__media.seek(2)`);
    await ed.press('Add title');
    await sleep(200);
    await ejs(`(() => { const ta = document.querySelector('.props textarea'); ta.value = 'Lime'; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const title = await ejs('JSON.stringify(window.__media.E().titles.map((t) => [t.text, t.start, t.end]))');
    await ejs(`document.querySelector('[data-tool="fade"]').click()`);
    await sleep(200);
    await ed.slide('Fade in', 0.5);
    await ed.slide('Fade out', 0.5);
    if (!(await ejs('!document.querySelector(".dirty").hidden'))) throw new Error('no Unsaved mark after editing');
    await ejs(`document.querySelector('[data-a="save"]').click()`);
    const out = path.join(OUT, 'clipedit (edited).mp4');
    if (!(await ed.wait(`!window.__media.st.busy && ${JSON.stringify(out)} === window.__media.st.savePath`, 120000))) throw new Error('Save did not finish');
    if (!fs.existsSync(out)) throw new Error('Save wrote nothing');
    const info = await probeMedia(out);
    if (!info.video || !info.audio) throw new Error(`saved streams: video ${!!info.video}, audio ${!!info.audio}`);
    if (Math.abs(info.duration - 2.5) > 0.15) throw new Error(`saved ${info.duration.toFixed(2)} s, expected 2.5 s`);
    const luma = ({ data, info: i }, y0, y1, x0 = 0, x1 = 1) => { let s = 0, n = 0; for (let y = Math.floor(i.height * y0); y < i.height * y1; y += 2) for (let x = Math.floor(i.width * x0); x < i.width * x1; x += 2) { const o = (y * i.width + x) * 3; s += i.channels === 3 ? (data[o] + data[o + 1] + data[o + 2]) / 3 : 0; n++; } return s / n; };
    const first = luma(await frameAt(out, 0.02), 0, 1), mid = luma(await frameAt(out, 1.2), 0, 1);
    if (!(first < mid * 0.35)) throw new Error(`no fade in: first frame ${first.toFixed(0)}, later ${mid.toFixed(0)}`);
    const [a, b] = [await frameAt(out, 1.6), await frameAt(src, 2.6)];
    const diff = (y0, y1, x0, x1) => { let s = 0, n = 0; for (let y = Math.floor(a.info.height * y0); y < a.info.height * y1; y++) for (let x = Math.floor(a.info.width * x0); x < a.info.width * x1; x++) { const o = (y * a.info.width + x) * 3; s += Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2]); n++; } return s / n / 3; };
    const inTitle = diff(0.76, 0.88, 0.42, 0.58), elsewhere = diff(0.1, 0.4, 0.1, 0.4);
    if (!(inTitle > 12 && inTitle > elsewhere * 4)) throw new Error(`title not found: ${inTitle.toFixed(1)} under it, ${elsewhere.toFixed(1)} elsewhere (${title})`);
    const view = await ed.ejs('window.__media.st.view');
    ed.win.destroy();
    return `${view} preview played past the cut; ${path.basename(out)}: ${info.duration.toFixed(2)} s, ${info.video.width}×${info.video.height} with sound; fade ${first.toFixed(0)}→${mid.toFixed(0)}, title ${inTitle.toFixed(0)} vs ${elsewhere.toFixed(1)}`;
  });
  await check('edit video · crop, look, music, frame, save as WebM', async () => {
    const src = path.join(OUT, 'clipgrade.mp4');
    fs.copyFileSync(fx('clip.mp4'), src);
    const ed = await mediaEditor(src), { ejs } = ed;
    await ejs(`document.querySelector('[data-tool="crop"]').click()`);
    await sleep(150);
    await ed.press('Right');
    await sleep(100);
    await ed.press('Flip horizontal');
    await sleep(100);
    await ejs(`document.querySelector('.props [data-v="1:1"]').click()`);
    await ejs(`document.querySelector('[data-tool="colour"]').click()`);
    if (!(await ed.wait('!!document.querySelector(\'.props [data-look="lumetri:Neutral Mono"]\')', 30000))) throw new Error('FilmCraft looks did not load');
    await ejs(`document.querySelector('.props [data-look="lumetri:Neutral Mono"]').click()`);
    await ejs(`window.__media.edit((x) => { x.music = { file: ${JSON.stringify(fx('song.mp3'))}, volume: -6, mode: 'mix', duck: 10, loop: true, fit: false, fadeOut: 1 }; })`);
    if (!(await ed.wait('!!window.__media.st.cube', 15000))) throw new Error('the look was not applied to the preview');
    const grey = await ejs(`(() => { const c = document.querySelector('.me-gl'), t = document.createElement('canvas'); t.width = 64; t.height = 64; const g = t.getContext('2d'); g.drawImage(c, 0, 0, 64, 64); const d = g.getImageData(0, 0, 64, 64).data; let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2])); return m; })()`);
    if (grey > 24) throw new Error(`the preview still has colour (${grey})`);
    await ejs('window.__media.seek(1)');
    await ejs(`document.querySelector('[data-tool="frame"]').click()`);
    await sleep(150);
    await ed.press('Save frame');
    const still = path.join(OUT, 'clipgrade - 0.01.00.png');
    const t0 = Date.now();
    while (!fs.existsSync(still) && Date.now() - t0 < 20000) await sleep(200);
    if (!fs.existsSync(still)) throw new Error('Save frame wrote nothing');
    const sm = await require('sharp')(still).metadata();
    if (sm.width !== 720 || sm.height !== 720) throw new Error(`frame is ${sm.width}×${sm.height}`);
    const shown = await ejs(`(() => { const c = document.querySelector('.me-gl'), t = document.createElement('canvas'); t.width = 24; t.height = 24; const g = t.getContext('2d'); g.drawImage(c, 0, 0, 24, 24); return [...g.getImageData(0, 0, 24, 24).data].filter((_, i) => i % 4 !== 3); })()`);
    const saved = await require('sharp')(still).resize(24, 24, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const off = shown.reduce((s_, v, i) => s_ + Math.abs(v - saved[i]), 0) / shown.length;
    if (off > 14) throw new Error(`the preview and the saved frame differ by ${off.toFixed(1)} on average`);
    asked = [];
    await ejs(`document.querySelector('[data-a="saveas"]').click()`);
    if (!(await ed.wait('!!document.querySelector(\'.scrim [data-f="webm"]\')', 5000))) throw new Error('no format choice');
    await ejs(`document.querySelector('.scrim [data-f="webm"]').click(); document.querySelector('.scrim [data-v="small"]').click(); document.querySelector('.scrim [data-a="ok"]').click()`);
    if (!(await ed.wait('!!window.__media.st.savePath && /\\.webm$/.test(window.__media.st.savePath) && !window.__media.st.busy', 180000))) throw new Error('Save as did not finish');
    const out = await ejs('window.__media.st.savePath');
    if (!asked.length || !fs.existsSync(out)) throw new Error('not saved where asked');
    const info = await probeMedia(out);
    if (info.video?.codec !== 'vp9' || info.audio?.codec !== 'opus') throw new Error(`saved ${info.video?.codec} and ${info.audio?.codec}`);
    if (info.video.width !== 720 || info.video.height !== 720) throw new Error(`saved ${info.video.width}×${info.video.height}`);
    const { data } = await frameAt(out, 1.5);
    let colour = 0;
    for (let i = 0; i < data.length; i += 3) colour = Math.max(colour, Math.abs(data[i] - data[i + 1]), Math.abs(data[i + 1] - data[i + 2]));
    if (colour > 24) throw new Error(`the saved picture still has colour (${colour})`);
    ed.win.destroy();
    return `turned, flipped, square crop and Neutral Mono shown and saved alike (${off.toFixed(1)} apart; ${path.relative(OUT, out)}, ${info.video.width}×${info.video.height} VP9 + Opus), frame ${sm.width}×${sm.height}`;
  });
  await check('edit video · HEVC phone clip plays from a preview copy', async () => {
    const src = path.join(OUT, 'phone.mov');
    fs.copyFileSync(fx('phone.mov'), src);
    const ed = await mediaEditor(src), { ejs } = ed;
    const v = await ejs('(() => { const m = document.querySelector("video"); return { src: decodeURIComponent(m.currentSrc), w: m.videoWidth, h: m.videoHeight }; })()');
    if (!/preview\.mp4$/.test(v.src) || !v.w) throw new Error(`playing ${v.src} (${v.w}×${v.h})`);
    await ejs(`document.querySelector('[data-a="save"]').click()`);
    const out = path.join(OUT, 'phone (edited).mov');
    if (!(await ed.wait(`!window.__media.st.busy && ${JSON.stringify(out)} === window.__media.st.savePath`, 60000))) throw new Error('Save did not finish');
    const info = await probeMedia(out), was = await probeMedia(src);
    if (info.video.width !== was.video.width || info.video.height !== was.video.height || Math.abs(info.duration - was.duration) > 0.1) throw new Error(`saved ${info.video.width}×${info.video.height}, ${info.duration} s`);
    ed.win.destroy();
    return `preview ${v.w}×${v.h} H.264; saved ${path.basename(out)} ${info.video.width}×${info.video.height} ${info.video.codec}`;
  });
  await check('edit video · FilmCraft finds the scenes', async () => {
    const src = path.join(OUT, 'scenes.mp4');
    fs.copyFileSync(fx('scenes.mp4'), src);
    const ed = await mediaEditor(src), { ejs } = ed;
    await ejs(`document.querySelector('[data-tool="scenes"]').click()`);
    await sleep(150);
    await ed.press('Find scenes');
    if (!(await ed.wait('window.__media.E().segs.length >= 3', 60000))) throw new Error(`found ${await ejs('window.__media.E().segs.length')} parts`);
    const cuts = await ejs('window.__media.E().segs.slice(1).map((g) => g.a.toFixed(2)).join(", ")');
    ed.win.destroy();
    return `split at ${cuts} s`;
  });
  await check('edit audio · remove silence, clean up, save MP3', async () => {
    const src = path.join(OUT, 'talk.wav');
    require('child_process').execFileSync(ffmpegBin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*220*t)*gt(mod(t,3),1.5)+0.002*random(0)':s=44100:d=9", src]);
    const ed = await mediaEditor(src), { ejs } = ed;
    await ejs(`document.querySelector('[data-tool="clean"]').click()`);
    await sleep(150);
    await ejs(`document.querySelector('.props [data-v="light"]').click()`);
    await ed.press('Remove silence');
    if (!(await ed.wait('window.__media.E().segs.some((g) => g.off)', 30000))) throw new Error('no silence was cut');
    const kept = await ejs('window.__media.outLen()');
    await ejs(`document.querySelector('[data-a="saveas"]').click()`);
    if (!(await ed.wait('!!document.querySelector(\'.scrim [data-f="mp3"]\')', 5000))) throw new Error('no format choice');
    await ejs(`document.querySelector('.scrim [data-f="mp3"]').click(); document.querySelector('.scrim [data-a="ok"]').click()`);
    if (!(await ed.wait('!!window.__media.st.savePath && /\\.mp3$/.test(window.__media.st.savePath) && !window.__media.st.busy', 60000))) throw new Error('Save as did not finish');
    const out = await ejs('window.__media.st.savePath'), info = await probeMedia(out);
    if (info.audio?.codec !== 'mp3' || Math.abs(info.duration - kept) > 0.15 || info.duration > 7) throw new Error(`saved ${info.audio?.codec}, ${info.duration} s (edit ${kept.toFixed(2)} s)`);
    const prep = await ejs('window.__media.st.prep?.key');
    if (prep !== 'light|0|0') throw new Error(`noise reduction not prepared (${prep})`);
    const cut = await ejs('window.__media.E().segs.filter((g) => g.off).length');
    ed.win.destroy();
    return `9 s → ${info.duration.toFixed(2)} s with ${cut} pauses cut and noise reduced, ${path.relative(OUT, out)}`;
  });
  await check('edit audio · trim, gain, fade, save', async () => {
    const src = path.join(OUT, 'toneedit.wav');
    fs.copyFileSync(fx('tone.wav'), src);
    const ed = await mediaEditor(src), { ejs, at } = ed;
    await at(0.2, 'i');
    await at(2.5, 'o');
    await ejs(`document.querySelector('[data-tool="volume"]').click()`);
    await sleep(150);
    await ed.slide('Gain', 6);
    await ejs(`document.querySelector('[data-tool="fade"]').click()`);
    await sleep(150);
    await ed.slide('Fade in', 0.5);
    await ejs(`document.querySelector('[data-a="save"]').click()`);
    const out = path.join(OUT, 'toneedit (edited).wav');
    if (!(await ed.wait(`!window.__media.st.busy && ${JSON.stringify(out)} === window.__media.st.savePath`, 60000))) throw new Error('Save did not finish');
    const info = await probeMedia(out);
    if (!info.audio || Math.abs(info.duration - 2.3) > 0.05) throw new Error(`saved ${info.duration} s`);
    const was = loudness(src, 1.2, 1), now = loudness(out, 1.0, 1), start = loudness(out, 0, 0.1);
    if (!(now - was > 5 && now - was < 7)) throw new Error(`gain ${(now - was).toFixed(1)} dB, expected +6`);
    if (!(start < now - 10)) throw new Error(`no fade in: ${start} dB at the start, ${now} dB later`);
    ed.win.destroy();
    return `${path.basename(out)}: ${info.duration.toFixed(2)} s, ${(now - was).toFixed(1)} dB louder, fades in from ${start.toFixed(0)} dB`;
  });

  await check('editors · one set of shortcuts, ? lists them', async () => {
    const out = [];
    const keyDown = (wc, key, mods = []) => { wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods }); wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods }); };
    const opened = async (file, mode, ready) => {
      openEditor(file, mode);
      const win = [...editors].pop(), wc = win.webContents, ejs = (code) => js(code, wc);
      while (wc.isLoading()) await sleep(200);
      const wait = async (code, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code).catch(() => false)) return true; await sleep(150); } return false; };
      if (!(await wait(ready))) throw new Error(`${mode} editor did not load`);
      await sleep(400);
      return { win, wc, ejs, wait };
    };
    const src = path.join(OUT, 'keys.pdf');
    fs.copyFileSync(fx('doc.pdf'), src);
    let ed = await opened(src, 'edit', '!!document.querySelector(".pdfpage img.r[src]") && !!document.querySelector(".props h3")');
    keyDown(ed.wc, '?', ['shift']);
    if (!(await ed.wait('!!document.querySelector(".scrim.keys .krow")', 3000))) throw new Error('? did not show the shortcuts');
    const rows = await ed.ejs('[...document.querySelectorAll(".scrim.keys .krow > span:first-child")].map((x) => x.textContent)');
    for (const want of ['Save', 'Save as…', 'Close', 'Undo', 'Redo', 'Zoom in', 'Crop', 'Select']) if (!rows.includes(want)) throw new Error(`the PDF list lacks ${want}: ${rows.join(', ')}`);
    keyDown(ed.wc, 'Escape');
    if (!(await ed.wait('!document.querySelector(".scrim.keys")', 3000))) throw new Error('Escape did not close the list');
    await ed.ejs('document.querySelector(\'[data-a="help"]\').click()');
    if (!(await ed.wait('!!document.querySelector(".scrim.keys")', 3000))) throw new Error('the Help button did not show the list');
    await ed.ejs('document.querySelector(".scrim.keys [data-a=ok]").click()');
    keyDown(ed.wc, 'C');
    if (!(await ed.wait('document.querySelector(\'[data-tool="crop"]\').getAttribute("aria-pressed") === "true"', 3000))) throw new Error('C did not pick Crop');
    keyDown(ed.wc, 'Escape');
    if (!(await ed.wait('document.querySelector(\'[data-tool="select"]\').getAttribute("aria-pressed") === "true"', 3000))) throw new Error('Escape did not go back to Select');
    keyDown(ed.wc, 'S', ['control']);
    const saved = path.join(OUT, 'keys (edited).pdf');
    const t = Date.now();
    while (!fs.existsSync(saved) && Date.now() - t < 20000) await sleep(200);
    if (!fs.existsSync(saved)) throw new Error('Ctrl+S did not save');
    out.push(`PDF: ? and Help list ${rows.length} keys, C = Crop, Esc = Select, Ctrl+S saved ${path.basename(saved)}`);
    ed.win.destroy();
    const img = path.join(OUT, 'keys.jpg');
    fs.copyFileSync(fx('photo.jpg'), img);
    ed = await opened(img, 'image', '(() => { const x = document.querySelector(".imged")?.__imged; return !!x && x.idle() && !!document.querySelector(".imged .photo[src]"); })()');
    for (const [k, tool] of [['C', 'crop'], ['Y', 'redeye'], ['K', 'mask'], ['T', 'text']]) {
      keyDown(ed.wc, k);
      if (!(await ed.wait(`document.querySelector('[data-tool="${tool}"]').getAttribute("aria-pressed") === "true"`, 3000))) throw new Error(`${k} did not pick ${tool} in the image editor`);
    }
    keyDown(ed.wc, '?', ['shift']);
    if (!(await ed.wait('!!document.querySelector(".scrim.keys .krow")', 3000))) throw new Error('? did not show the image editor’s shortcuts');
    const irows = await ed.ejs('[...document.querySelectorAll(".scrim.keys .krow > span:first-child")].map((x) => x.textContent)');
    for (const want of ['Save', 'Close', 'Heal', 'Mask', 'Red eye', 'Hold to see the original']) if (!irows.includes(want)) throw new Error(`the image list lacks ${want}: ${irows.join(', ')}`);
    out.push(`image: C, Y, K, T pick their tools, ? lists ${irows.length} keys`);
    ed.win.destroy();
    const clip = path.join(OUT, 'keys.mp4');
    fs.copyFileSync(fx('clip.mp4'), clip);
    ed = await opened(clip, 'media', '!!window.__media?.st.ready');
    await ed.ejs('window.__media.seek(1.5); window.__media.act("split"); window.__media.st.sel = 1; window.__media.selectTool("trim")');
    keyDown(ed.wc, 'Escape');
    if (!(await ed.wait('window.__media.st.sel === -1', 3000))) throw new Error('Escape did not let go of the part');
    keyDown(ed.wc, '?', ['shift']);
    if (!(await ed.wait('!!document.querySelector(".scrim.keys .krow")', 3000))) throw new Error('? did not show the video editor’s shortcuts');
    const mrows = await ed.ejs('[...document.querySelectorAll(".scrim.keys .krow > span:first-child")].map((x) => x.textContent)');
    for (const want of ['Save', 'Play or pause', 'Split at the playhead', 'Zoom in on the timeline']) if (!mrows.includes(want)) throw new Error(`the video list lacks ${want}: ${mrows.join(', ')}`);
    out.push(`video: Esc deselects, ? lists ${mrows.length} keys`);
    ed.win.destroy();
    return out.join('; ');
  });

  await check('editors · unsaved edits come back after the window dies', async () => {
    const out = [], rdir = path.join(app.getPath('userData'), 'recovery');
    const kept = () => (fs.existsSync(rdir) ? fs.readdirSync(rdir) : []);
    const opened = async (file, mode, ready) => {
      openEditor(file, mode);
      const win = [...editors].pop(), wc = win.webContents, ejs = (code) => js(code, wc);
      while (wc.isLoading()) await sleep(200);
      const wait = async (code, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code).catch(() => false)) return true; await sleep(150); } return false; };
      if (!(await wait(ready))) throw new Error(`${mode} editor did not get to: ${ready.slice(0, 60)}`);
      await sleep(400);
      return { win, wc, ejs, wait };
    };
    const offer = '!!document.querySelector(".scrim [data-a=restore]")';
    const restore = (ed) => ed.ejs('document.querySelector(".scrim [data-a=restore]").click()');
    const src = path.join(OUT, 'recover.pdf');
    fs.copyFileSync(fx('doc.pdf'), src);
    let ed = await opened(src, 'edit', '!!document.querySelector(".pdfpage img.r[src]") && !!document.querySelector(".props h3")');
    await ed.ejs('document.querySelector(\'[data-p="rotr"]\').click()');
    if (!(await ed.wait('document.querySelector(".ed-status").hidden && !!document.querySelector(".pdfpage img.r[src]") && document.querySelector(".pdfpage").offsetWidth > document.querySelector(".pdfpage").offsetHeight', 20000))) throw new Error('the page did not turn');
    await ed.ejs('document.querySelector(\'[data-tool="addtext"]\').click()');
    await ed.ejs(`(() => { const l = document.querySelector('.pdfpage .layer'), b = l.getBoundingClientRect(); l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: b.left + 60, clientY: b.top + b.height * 0.5 })); })()`);
    if (!(await ed.wait('!!document.querySelector(".obj.text[contenteditable]")', 3000))) throw new Error('no text box');
    await ed.ejs(`(() => { const el = document.querySelector('.obj.text[contenteditable]'); el.textContent = 'Back from the dead'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    ed.wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await sleep(300);
    if (!(await ed.ejs('window.__recovery.now()'))) throw new Error('the autosave wrote nothing');
    let files = kept();
    if (!files.some((f) => f.endsWith('.json')) || !files.some((f) => f.endsWith('.pdf'))) throw new Error(`the recovery folder holds ${files.join(', ') || 'nothing'}`);
    ed.win.destroy();
    ed = await opened(src, 'edit', offer);
    await restore(ed);
    if (!(await ed.wait('!!document.querySelector(".pdfpage img.r[src]") && [...document.querySelectorAll(".obj.text")].some((x) => x.textContent === "Back from the dead") && !document.querySelector(".dirty").hidden', 20000))) throw new Error('the typed text did not come back');
    if (!(await ed.ejs('document.querySelector(".pdfpage").offsetWidth > document.querySelector(".pdfpage").offsetHeight'))) throw new Error('the turned page did not come back');
    await ed.ejs('document.querySelector(\'[data-a="save"]\').click()');
    const saved = path.join(OUT, 'recover (edited).pdf');
    const t = Date.now();
    while (!fs.existsSync(saved) && Date.now() - t < 30000) await sleep(200);
    if (!fs.existsSync(saved)) throw new Error('Save wrote nothing');
    await sleep(800);
    const s = await E.open(saved), text = (await E.text(s.id, 0)).map((l) => l.text).join(' ');
    if (!text.includes('Back from the dead') || !(s.pages[0].w > s.pages[0].h)) throw new Error(`saved ${s.pages[0].w}×${s.pages[0].h}: ${text.slice(0, 80)}`);
    files = kept();
    if (files.some((f) => f.endsWith('.pdf'))) throw new Error(`the kept copy was not dropped after saving: ${files.join(', ')}`);
    ed.win.destroy();
    out.push('PDF: a turned page and typed text came back and saved');
    const clip = path.join(OUT, 'recover.mp4');
    fs.copyFileSync(fx('clip.mp4'), clip);
    ed = await opened(clip, 'media', '!!window.__media?.st.ready');
    await ed.ejs('window.__media.seek(0.5); window.__media.act("in")');
    if (!(await ed.ejs('window.__recovery.now()'))) throw new Error('the video autosave wrote nothing');
    ed.win.destroy();
    ed = await opened(clip, 'media', offer);
    await restore(ed);
    if (!(await ed.wait('window.__media.E().inT === 0.5 && !document.querySelector(".dirty").hidden', 10000))) throw new Error(`the trim did not come back: start ${await ed.ejs('window.__media.E().inT')}`);
    ed.win.destroy();
    out.push('video: the trimmed start came back');
    const img = path.join(OUT, 'recover.jpg');
    fs.copyFileSync(fx('photo.jpg'), img);
    const idle = '(() => { const x = document.querySelector(".imged")?.__imged; return !!x && x.idle() && !!document.querySelector(".imged .photo[src]"); })()';
    ed = await opened(img, 'image', idle);
    await ed.ejs('document.querySelector(\'[data-tool="adjust"]\').click()');
    await ed.ejs(`(() => { const r = document.querySelector('.props [data-k="light.exposure"] input'); r.value = 1; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    if (!(await ed.wait(idle))) throw new Error('the image editor did not settle');
    if (!(await ed.ejs('window.__recovery.now()'))) throw new Error('the image autosave wrote nothing');
    ed.win.destroy();
    ed = await opened(img, 'image', offer);
    await restore(ed);
    if (!(await ed.wait('document.querySelector(".imged")?.__imged.st.dev.light.exposure === 1 && !document.querySelector(".dirty").hidden', 15000))) throw new Error('the exposure did not come back');
    ed.win.destroy();
    out.push('image: the exposure came back');
    return out.join('; ');
  });

  await check('welcome · four steps, Got it marks it seen', async () => {
    openWelcome();
    let w = null;
    for (let t = 0; t < 50 && !(w = welcome()); t++) await sleep(100);
    if (!w) throw new Error('the welcome window did not open');
    while (w.webContents.isLoading()) await sleep(100);
    await sleep(800);
    const wjs = (code) => js(code, w.webContents);
    const steps = await wjs('[...document.querySelectorAll(".steps li .t b")].map((b) => b.textContent.replace(/^\\d/, ""))');
    if (steps.length !== 4) throw new Error(`${steps.length} steps: ${steps.join(' | ')}`);
    if (!(await wjs('document.scrollingElement.scrollHeight <= innerHeight + 1 && document.querySelectorAll(".steps svg, .steps img.lime").length >= 6'))) throw new Error('the welcome scrolls or has no drawings');
    await wjs('document.querySelector("[data-a=ok]").click()');
    for (let t = 0; t < 50 && welcome(); t++) await sleep(100);
    if (welcome()) throw new Error('Got it did not close it');
    await sleep(600);
    const s = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
    if (!s.welcomed) throw new Error('settings.welcomed is not set');
    return `${steps.join(' · ')}; closed with Got it, marked as seen`;
  });

  await editorTest('edit pdf · the history lists each step and goes back to any', 'history.pdf', 'doc.pdf', async (ed) => {
    const landscape = 'document.querySelector(".pdfpage").offsetWidth > document.querySelector(".pdfpage").offsetHeight';
    const rows = () => ed.ejs('[...document.querySelectorAll(".bm.hs")].map((r) => r.querySelector(".t").textContent)');
    const dim = () => ed.ejs('[...document.querySelectorAll(".bm.hs")].map((r) => r.classList.contains("ahead") ? "a" : r.classList.contains("sel") ? "s" : "-").join("")');
    await ed.tool('stamp');
    if (!(await ed.wait('document.querySelectorAll(".props .stampbtn").length >= 8', 3000))) throw new Error('no stamp choices');
    await ed.press('.props [data-st="APPROVED"]');
    await ed.click(0.1, 0.12);
    await ed.press('[data-p="rotr"]');
    if (!(await ed.wait(`document.querySelector(".ed-status").hidden && ${landscape}`, 20000))) throw new Error('the page did not turn');
    await ed.tool('note');
    await ed.click(0.62, 0.1);
    if (!(await ed.wait('!!document.querySelector(".cm.sel textarea")', 8000))) throw new Error('the note did not open');
    await ed.press('[data-side="history"]');
    const want = ['Opened', 'Stamp APPROVED on page 1', 'Turned page 1', 'Added a note on page 1'];
    let got = await rows();
    if (got.join('|') !== want.join('|')) throw new Error(`history: ${got.join(' | ')}`);
    if ((await dim()) !== '---s') throw new Error(`marks ${await dim()}`);
    await ed.press('.bm.hs[data-i="1"]');
    await ed.idle();
    if (!(await ed.wait(`!(${landscape})`, 10000))) throw new Error('going back did not turn the page upright');
    if ((await dim()) !== '-saa') throw new Error(`marks after going back: ${await dim()}`);
    if (!(await ed.ejs('document.querySelector(\'[data-a="undo"]\').title.includes("Stamp APPROVED")'))) throw new Error(`undo says ${await ed.ejs('document.querySelector(\'[data-a="undo"]\').title')}`);
    await ed.press('.bm.hs[data-i="3"]');
    await ed.idle();
    if (!(await ed.wait(landscape, 10000))) throw new Error('going forward did not turn the page again');
    got = await rows();
    if (got.join('|') !== want.join('|') || (await dim()) !== '---s') throw new Error(`after going forward: ${got.join(' | ')} ${await dim()}`);
    const out = await ed.save();
    const { s, list } = await annotsOf(out);
    const text = (await E.text(s.id, 0)).map((l) => l.text).join(' ');
    if (!text.includes('APPROVED') || !(s.pages[0].w > s.pages[0].h) || !list.some((a) => a.type === 'Text')) throw new Error(`saved ${s.pages[0].w}×${s.pages[0].h}, note ${list.length}: ${text.slice(0, 60)}`);
    return `${want.length - 1} steps named, went back to step 1 (page upright, later steps dimmed) and forward to the last; stamp, turn and note saved`;
  });
  await require('./editor-fields.ui')(editorTest);

  await check('editors · remember the last tool, and a file dropped on the window opens in it', async () => {
    const opened = async (file, mode, ready) => {
      openEditor(file, mode);
      const win = [...editors].pop(), wc = win.webContents, ejs = (code) => js(code, wc);
      while (wc.isLoading()) await sleep(200);
      const wait = async (code, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code).catch(() => false)) return true; await sleep(150); } return false; };
      if (!(await wait(ready))) throw new Error(`${mode} editor did not get to: ${ready.slice(0, 60)}`);
      await sleep(600);
      return { win, wc, ejs, wait };
    };
    const pressed = (ed) => ed.ejs('document.querySelector(\'[data-tool][aria-pressed="true"]\')?.dataset.tool');
    const pdfReady = '!!document.querySelector(".pdfpage img.r[src]") && !!document.querySelector(".props h3")';
    const src = path.join(OUT, 'memory.pdf');
    fs.copyFileSync(fx('doc.pdf'), src);
    let ed = await opened(src, 'edit', pdfReady);
    await ed.ejs('document.querySelector(\'[data-tool="note"]\').click()');
    await ed.ejs('document.querySelector(\'[data-a="zoomin"]\').click()');
    await ed.ejs('document.querySelector(\'[data-side="bookmarks"]\').click()');
    const zoom = await ed.ejs('document.querySelector(".zoom").value');
    await sleep(800);
    ed.win.destroy();
    ed = await opened(src, 'edit', pdfReady);
    const back = { tool: await pressed(ed), zoom: await ed.ejs('document.querySelector(".zoom").value'), side: await ed.ejs('document.querySelector(\'[data-side][aria-pressed="true"]\')?.dataset.side') };
    if (back.tool !== 'note' || back.zoom !== zoom || back.side !== 'bookmarks') throw new Error(`the PDF editor came back with ${JSON.stringify(back)}, zoom was ${zoom}`);
    const form = path.join(OUT, 'memory-form.pdf');
    fs.copyFileSync(fx('fillable.pdf'), form);
    ed.win.destroy();
    ed = await opened(form, 'edit', pdfReady);
    if (!(await ed.wait('document.querySelector(".ed-status").textContent.includes("form")', 8000)) || (await pressed(ed)) !== 'select') throw new Error(`a form opened in ${await pressed(ed)}`);
    await ed.ejs('document.querySelector(\'[data-tool="edittext"]\').click()');
    await ed.ejs('document.querySelector(\'[data-side="pages"]\').click()');
    await sleep(800);
    const photo = path.join(OUT, 'memory.jpg');
    fs.copyFileSync(fx('photo.jpg'), photo);
    const idle = '(() => { const x = document.querySelector(".imged")?.__imged; return !!x && x.idle() && !!document.querySelector(".imged .photo[src]"); })()';
    if (!(await ed.ejs(`window.__page.openFile(${JSON.stringify(photo)})`))) throw new Error('the dropped photo did not open');
    if (!(await ed.wait(idle))) throw new Error('the photo did not show in the same window');
    if (ed.win.editorData.mode !== 'image' || ed.win.editorData.file !== photo || !ed.win.getTitle().startsWith('memory.jpg')) throw new Error(`after the drop: ${JSON.stringify(ed.win.editorData)} titled ${ed.win.getTitle()}`);
    await ed.ejs('document.querySelector(\'[data-tool="text"]\').click()');
    await sleep(800);
    ed.win.destroy();
    ed = await opened(photo, 'image', idle);
    const imgTool = await pressed(ed);
    await ed.ejs('document.querySelector(\'[data-tool="adjust"]\').click()');
    await sleep(800);
    ed.win.destroy();
    if (imgTool !== 'text') throw new Error(`the image editor came back in ${imgTool}`);
    return `PDF came back in Note at ${back.zoom} with Bookmarks open, a form still opens in Select; a photo dropped on the PDF window opened there and came back in Text`;
  });

  const webSite = async (name, body) => {
    const site = path.join(OUT, name);
    fs.mkdirSync(path.join(site, 'images'), { recursive: true });
    await require('sharp')({ create: { width: 48, height: 32, channels: 3, background: '#3d8a28' } }).png().toFile(path.join(site, 'images', 'pic.png'));
    fs.writeFileSync(path.join(site, 'style.css'), 'body { font-family: Georgia, serif; }\nh1 { color: #2f6f1e; }\n');
    const src = path.join(site, 'page.html');
    fs.writeFileSync(src, `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>Test page</title>\n  <link rel="stylesheet" href="style.css">\n  <style>\n    .note { color: #8a5a00; }\n  </style>\n</head>\n<body>\n${body}\n  <script>window.x = 1;</script>\n</body>\n</html>\n`);
    openEditor(src, 'web');
    const win = [...editors].pop(), wc = win.webContents, ejs = (code) => js(code, wc);
    while (wc.isLoading()) await sleep(200);
    const wait = async (code, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code).catch(() => false)) return true; await sleep(150); } return false; };
    if (!(await wait('!!window.__web?.st.ready'))) throw new Error('the editor did not load');
    const save = async () => {
      await ejs('document.querySelector(\'[data-a="save"]\').click()');
      const out = path.join(site, 'page (edited).html');
      if (!(await wait(`window.__web.st.savePath === ${JSON.stringify(out)} && document.querySelector('.dirty').hidden`, 15000))) throw new Error('Save did not finish');
      return fs.readFileSync(out, 'utf8');
    };
    return { site, src, win, ejs, wait, save, code: () => ejs('window.__web.textOf(0)') };
  };
  const ODD = '<div class="keep">\n\t<p   data-x=\'1\'  >Odd   spacing &amp; &copy; entities<br/>kept</p >\n</div>';

  await check('edit web page · design and code in step, save', async () => {
    const { src, win, ejs, wait, save } = await webSite('site', `  <h1>Old heading</h1>\n  <img src="images/pic.png" alt="A green box">\n  <p class="note">A note.</p>\n  ${ODD}`);
    if (!(await wait('(() => { const i = window.__web.gjs().Canvas.getDocument().querySelector("img"); return !!i && i.complete && i.naturalWidth === 48; })()', 8000))) throw new Error('the picture did not load in Design view');
    await ejs('void window.__web.gjs().getWrapper().find("h1")[0].components("Fresh heading")');
    if (!(await wait('window.__web.textOf(0).includes("<h1>Fresh heading</h1>")', 5000))) throw new Error('the Design edit did not reach the code');
    await ejs(`(() => { const cm = window.__web.cm(), t = cm.state.doc.toString(), i = t.indexOf('#8a5a00'); cm.dispatch({ changes: { from: i, to: i + 7, insert: '#c4291f' } }); })()`);
    if (!(await wait('/196, 41, 31|c4291f/i.test(window.__web.gjs().getCss())', 5000))) throw new Error('the Code edit did not reach Design view');
    if (!(await ejs('window.__web.gjs().getWrapper().find("h1")[0].getInnerHTML() === "Fresh heading"'))) throw new Error('the heading was lost when the code was reloaded');
    await ejs(`(() => { const cm = window.__web.cm(), t = cm.state.doc.toString(), i = t.indexOf('A note.'); cm.dispatch({ changes: { from: i, to: i + 7, insert: 'A note from the code.' } }); })()`);
    if (!(await wait('window.__web.gjs().getWrapper().find("p.note")[0]?.getEl()?.textContent === "A note from the code."', 5000))) throw new Error(`a text edit in Code did not show in Design view: ${await ejs('JSON.stringify([window.__web.gjs().getWrapper().find("p.note").map((x) => x.getEl()?.outerHTML), window.__web.st.designStale, window.__web.textOf(0).match(/<p class="note">.*/)?.[0]])')}`);
    const key = (k, extra = '') => ejs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', ctrlKey: true, bubbles: true${extra} }))`);
    await key('z');
    if (!(await wait('window.__web.textOf(0).includes("A note.</p>")', 4000))) throw new Error('Ctrl+Z did not undo the text edit');
    await key('y');
    if (!(await wait('window.__web.textOf(0).includes("A note from the code.")', 4000))) throw new Error('Ctrl+Y did not redo it');
    const saved = await save();
    const want = { doctype: saved.startsWith('<!DOCTYPE html>'), heading: saved.includes('<h1>Fresh heading</h1>'), css: saved.includes('.note { color: #c4291f; }'), image: saved.includes('<img src="images/pic.png" alt="A green box">'), link: saved.includes('href="style.css"'), script: saved.includes('<script>window.x = 1;</script>'), untouched: saved.includes(ODD) };
    const missing = Object.entries(want).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`saved page lacks ${missing.join(', ')}:\n${saved}`);
    const expect = fs.readFileSync(src, 'utf8').replace('<h1>Old heading</h1>', '<h1>Fresh heading</h1>').replace('#8a5a00', '#c4291f').replace('A note.', 'A note from the code.');
    if (saved !== expect) throw new Error(`more than the edits changed:\n${saved}`);
    if (fs.readFileSync(src, 'utf8').includes('Fresh')) throw new Error('the original was changed');
    win.destroy();
    return 'heading from Design, colour and text from Code, undo and redo; the saved file is the original byte for byte apart from the three edits';
  });

  await check('edit web page · bold text, picture, table row, watermark', async () => {
    const { site, win, ejs, wait, save, code } = await webSite('site2', '  <p class="lead">Plain words here.</p>\n  <table>\n    <tr><td>One</td><td>1</td></tr>\n    <tr><td>Two</td><td>2</td></tr>\n  </table>');
    await ejs(`(async () => { const g = window.__web.gjs(), p = g.getWrapper().find('p.lead')[0]; g.select(p); p.trigger('active'); await new Promise((r) => setTimeout(r, 400)); const el = p.getEl(), doc = el.ownerDocument, r = doc.createRange(); r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 5); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); doc.dispatchEvent(new Event('selectionchange')); })()`);
    if (!(await wait('!!document.querySelector(".we-fbar [data-x=bold]")', 4000))) throw new Error('no format bar while typing');
    await ejs('document.querySelector(".we-fbar [data-x=bold]").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); document.querySelector(".we-fbar [data-x=bold]").click()');
    await sleep(200);
    await ejs('window.__web.gjs().select(null); 0');
    if (!(await wait('window.__web.textOf(0).includes("<p class=\\"lead\\"><strong>Plain</strong> words here.</p>")', 5000))) throw new Error(`bold did not reach the code: ${(await code()).match(/<p class="lead">.*?<\/p>/)?.[0]}`);
    const outside = path.join(OUT, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    const pic = path.join(outside, 'sunset photo.png');
    await require('sharp')({ create: { width: 300, height: 200, channels: 3, background: '#e0851f' } }).png().toFile(pic);
    const realOpen = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pic] });
    try {
      await ejs('window.__web.gjs().select(window.__web.gjs().getWrapper().find("p.lead")[0]); document.querySelector(\'[data-a="image"]\').click()');
      if (!(await wait('/<img src="images\\/sunset%20photo\\.png"/.test(window.__web.textOf(0))', 6000))) throw new Error(`the picture was not inserted with a relative src: ${await code()}`);
    } finally { dialog.showOpenDialog = realOpen; }
    if (!fs.existsSync(path.join(site, 'images', 'sunset photo.png'))) throw new Error('the picture was not copied into images/');
    if (!(await wait('document.querySelector(".we-pane[data-pane=element] [data-insp=width]")', 3000))) throw new Error(`no width in the Properties panel: ${await ejs('JSON.stringify([window.__web.gjs().getSelected()?.getName(), document.querySelector(".we-props").dataset.on, document.querySelector(".we-pane[data-pane=element]").innerHTML.slice(0, 300)])')}`);
    await ejs(`(() => { const i = document.querySelector('.we-pane[data-pane=element] [data-insp=width]'); i.value = '150'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    if (!(await wait('/<img src="images\\/sunset%20photo\\.png" alt="sunset photo" width="150" height="100">/.test(window.__web.textOf(0))', 5000))) throw new Error(`the picture was not resized: ${(await code()).match(/<img src="images\/sunset[^>]*>/)?.[0]}`);
    const resizable = await ejs('!!window.__web.gjs().getSelected()?.get("resizable")');
    await ejs('const g = window.__web.gjs(); g.select(g.getWrapper().find("td")[2]); 0');
    await sleep(300);
    await ejs('document.querySelector(\'.we-pane[data-pane=element] [data-insa="rowbelow"]\').click()');
    if (!(await wait('(window.__web.textOf(0).match(/<tr>/g) || []).length === 3', 5000))) throw new Error(`no new row: ${(await code()).match(/<table>[\s\S]*<\/table>/)?.[0]}`);
    await ejs('window.__web.gjs().select(null); document.querySelector(\'[data-a="watermark"]\').click()');
    if (!(await wait('!!document.querySelector(".scrim [data-f=text]")', 3000))) throw new Error('no watermark dialog');
    await ejs(`(() => { const i = document.querySelector('.scrim [data-f=text]'); i.value = 'CONFIDENTIAL'; i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.scrim [data-a=ok]').click(); })()`);
    if (!(await wait('/class="webcraft-watermark"[^>]*pointer-events: ?none[\\s\\S]*CONFIDENTIAL/.test(window.__web.textOf(0))', 5000))) throw new Error(`no watermark in the code: ${await code()}`);
    const look = await ejs('(() => { const el = window.__web.gjs().Canvas.getDocument().querySelector(".webcraft-watermark"); if (!el) return null; const s = getComputedStyle(el); return { pe: s.pointerEvents, pos: s.position, text: el.textContent }; })()');
    if (!look || look.pe !== 'none' || look.pos !== 'fixed' || look.text !== 'CONFIDENTIAL') throw new Error(`the watermark doesn’t render as an overlay: ${JSON.stringify(look)}`);
    await ejs('document.querySelector(\'[data-view="preview"]\').click()');
    if (!(await wait('(() => { const d = document.querySelector(".we-preview iframe").contentDocument; return d?.querySelector(".webcraft-watermark")?.textContent === "CONFIDENTIAL"; })()', 5000))) throw new Error('the watermark is not in the preview');
    const saved = await save();
    for (const [what, re] of [['bold', /<strong>Plain<\/strong>/], ['picture', /<img src="images\/sunset%20photo\.png" alt="sunset photo" width="150" height="100">/], ['row', /(<tr>[\s\S]*){3}/], ['watermark', /webcraft-watermark[\s\S]*CONFIDENTIAL/]]) if (!re.test(saved)) throw new Error(`saved page lacks the ${what}:\n${saved}`);
    win.destroy();
    return `<strong> from the format bar; picture copied to images/ with a relative src and resized to 150×100${resizable ? ' (drag handles on)' : ''}; a third table row; a CONFIDENTIAL overlay in the code, Design view and Preview`;
  });

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
  results.push(...(await require('./diagrams.test').ui({ openEditor, editors, dir })));
  await require('./settings-search.ui')({ check, js, openPrefs, prefs, app, dir });

  const fail = results.filter((r) => r.status === 'FAIL'), skip = results.filter((r) => r.status === 'SKIP');
  console.log(`\n${results.length - fail.length - skip.length}/${results.length - skip.length} passed through the wheel${skip.length ? `, ${skip.length} skipped` : ''}`);
  fs.writeFileSync(path.join(dir, 'ui-report.json'), JSON.stringify(results, null, 1));
  app.isQuitting = true;
  app.exit(fail.length ? 1 : 0);
};
