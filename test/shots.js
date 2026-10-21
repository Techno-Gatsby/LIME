'use strict';
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async ({ wheel, showWheel, openPrefs, openEditor, BrowserWindow, app, summon, peek, screen, debug, dir }) => {
  fs.mkdirSync(dir, { recursive: true });
  const samples = process.env.LIME_SAMPLES || path.join(dir, 'samples');
  const steps = (process.env.LIME_STEPS || 'all').split(',');
  const w = () => wheel();
  const js = (code) => w().webContents.executeJavaScript(code, true);
  const wheelRect = () => {
    const d = debug(), r = d.placed, t = d.tab, W = d.window;
    const x0 = Math.min(r.x, t.x - 48) - 24, y0 = Math.min(r.y, t.y - 48) - 24, x1 = Math.max(r.x + r.width, t.x + 48) + 24, y1 = Math.max(r.y + r.height, t.y + 48) + 24;
    return { x: Math.max(0, x0 - W.x), y: Math.max(0, y0 - W.y), width: Math.min(W.width, x1 - W.x) - Math.max(0, x0 - W.x), height: Math.min(W.height, y1 - W.y) - Math.max(0, y0 - W.y) };
  };
  const shot = async (name, win = w()) => {
    await sleep(Number(process.env.LIME_SHOT_WAIT) || 700);
    const img = await (win === w() ? win.webContents.capturePage(wheelRect()) : win.webContents.capturePage());
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    console.log('shot', name, img.getSize());
  };
  const until = async (code, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(code)) return true; await sleep(250); } return false; };
  while (!w() || w().webContents.isLoading()) await sleep(200);
  await sleep(1500);
  showWheel();
  const want = (s) => steps.includes('all') || steps.includes(s);
  try {
    await js('window.lime.invoke("settings:set", { askSave: false })');
    if (want('idle')) await shot('01-idle');
    if (want('bloom')) {
      const frame = async (name) => { const img = await w().webContents.capturePage(wheelRect()); fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG()); console.log('shot', name, img.getSize()); };
      await js('window.__lime.fold()');
      await sleep(1200);
      await frame('b0-tab');
      await js('document.querySelector(".tab").classList.add("peek"); document.querySelector(".tab-lime").style.transform = "translateX(6px) rotate(-30deg)"');
      await sleep(600);
      await frame('b1-tab-hover');
      await js('document.querySelector(".tab-lime").style.transform = ""');
      await js('window.__lime.expand("edge")');
      for (const t of [40, 110, 200, 320, 520, 900]) { await sleep(t - (frame.last || 0)); frame.last = t; await frame(`b2-bloom-${String(t).padStart(3, '0')}ms`); }
      frame.last = 0;
      await sleep(400);
      js('window.__lime.fold()');
      for (const t of [60, 160, 260, 420]) { await sleep(t - (frame.last || 0)); frame.last = t; await frame(`b3-fold-${String(t).padStart(3, '0')}ms`); }
      await sleep(800);
      await frame('b4-tucked-again');
    }
    const img = path.join(samples, 'photo.jpg');
    if (want('apps')) {
      const pdfFile = path.join(samples, 'doc.pdf');
      await js('window.__lime.fold()');
      await sleep(900);
      await js('window.__lime.expand("click"); window.__lime.loadHome()');
      await sleep(900);
      await shot('30-apps-home');
      await js('window.__lime.setHot(window.__lime.S.ring.findIndex((x) => x.label === "PdfCraft"))');
      await shot('31-apps-hover-pdfcraft');
      await js('window.__lime.pick(window.__lime.S.ring.find((x) => x.label === "PdfCraft"))');
      await shot('32-pdfcraft-ring');
      await js('window.__lime.back(); window.__lime.S.app = "photocraft"; window.__lime.redraw()');
      await shot('33-photocraft-ring');
      await js('window.__lime.fold()');
      await sleep(900);
      await js(`window.__lime.openWith(${JSON.stringify([pdfFile])})`);
      await sleep(900);
      await shot('34-pdf-tools');
      await js('window.__lime.setMode("apps")');
      await shot('35-pdf-apps');
      await js('window.__lime.fold()');
      await sleep(900);
      const a = screen.getPrimaryDisplay().workArea, at = { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) };
      peek([img]);
      summon('shift', at);
      await until('window.__lime.S.peek && window.__lime.S.ring.length > 0');
      await shot('36-shift-live');
      const frame = async (name) => { const im = await w().webContents.capturePage(wheelRect()); fs.writeFileSync(path.join(dir, `${name}.png`), im.toPNG()); console.log('shot', name, im.getSize()); };
      js('window.__lime.fold()');
      for (const t of [80, 180, 280]) { await sleep(100); await frame(`37-fold-${t}ms`); }
    }
    if (want('drag')) {
      const a = screen.getPrimaryDisplay().workArea, at = { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) };
      const over = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const b = el.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2; const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.txt')); document.elementFromPoint(x, y).dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true })); })()`);
      await js('window.__lime.fold()');
      await sleep(900);
      summon('edge', at);
      await shot('20-ready-empty');
      await js('window.__lime.fold()');
      await sleep(900);
      peek([img]);
      summon('shift', at);
      await until('window.__lime.S.peek && window.__lime.S.ring.length > 0');
      await shot('21-drag-live');
      await over('.petal[data-i="1"] text.l');
      await shot('22-drag-hover');
      await js('window.__lime.fold()');
      await sleep(900);
      await js(`window.__lime.openWith(${JSON.stringify([path.join(samples, 'doc.pdf')])}).then(() => window.__lime.setMode('tools'))`);
      await sleep(600);
      await shot('23-dense-tools');
      await js('window.__lime.collapse()');
      await sleep(600);
    }
    if (want('menu')) {
      await js(`window.__lime.openWith(${JSON.stringify([img])})`);
      await shot('02-menu-convert');
      await js('window.__lime.setHot(1)');
      await shot('03-hover');
      await js('window.__lime.setMode("tools")');
      await sleep(300);
      await js('window.__lime.setHot(2)');
      await shot('04-tools');
      await js('window.__lime.setMode("more")');
      await shot('05-more');
      await js('window.__lime.showAll()');
      await shot('06-all-tools');
      await js(`window.__lime.collapse()`);
      await sleep(500);
    }
    if (want('glass')) {
      const mouse = async (sel, dx = 0, dy = 0) => {
        const p = await js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2 + ${dx}), y: Math.round(b.y + b.height / 2 + ${dy}) }; })()`);
        w().webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
        await sleep(40);
        w().webContents.sendInputEvent({ type: 'mouseMove', x: p.x + 1, y: p.y });
        return p;
      };
      await js(`window.__lime.openWith(${JSON.stringify([img])})`);
      await sleep(500);
      await mouse('.petal[data-i="1"] text.l', 10, -6);
      await shot('g1-pointer-topright');
      console.log('glass', await js('(() => { const L = window.__lime, g = document.querySelector(".petal.hot"), d = document.querySelector(".dial"); return { hot: L.S.hot, light: [...document.querySelectorAll("fePointLight")].map((l) => l.getAttribute("x") + "," + l.getAttribute("y")), nudge: g && getComputedStyle(g).translate, tilt: d.style.cssText }; })()'));
      await mouse('.petal[data-i="5"] text.l', -16, 10);
      await shot('g2-pointer-bottomleft');
      console.log('shade offsets', await js('[...document.querySelectorAll("feOffset.away, feOffset.toward")].map((o) => o.getAttribute("dx") + "," + o.getAttribute("dy")).join(" ")'));
      await mouse('.center', 0, -30);
      await shot('g3-pointer-centre');
      await js('window.lime.invoke("settings:set", { theme: "dark" })');
      await sleep(400);
      await mouse('.petal[data-i="2"] text.l', 8, 8);
      await shot('g4-pointer-dark');
      await js('window.lime.invoke("settings:set", { theme: "system" })');
      w().webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });
      await sleep(900);
      const cost = await js(`(async () => {
        const L = window.__lime, r = document.querySelector('.dial').getBoundingClientRect(), c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        const tick = () => new Promise((res) => requestAnimationFrame(res));
        const run = async (n, step) => { const f = []; let last = performance.now(); for (let i = 0; i < n; i++) { step(i); await tick(); const t = performance.now(); f.push(t - last); last = t; } f.sort((a, b) => a - b); return { median: Math.round(f[n >> 1]), p90: Math.round(f[Math.floor(n * 0.9)]), worst: Math.round(f[n - 1]) }; };
        const best = (a, b) => (a && a.median <= b.median ? a : b);
        let still = null, light = null, all = null;
        for (let k = 0; k < 3; k++) {
          still = best(still, await run(60, () => {}));
          light = best(light, await run(60, (i) => L.glassAt(c.x + Math.cos(i / 9) * 120, c.y + Math.sin(i / 9) * 120)));
          L.setHot(1);
          all = best(all, await run(60, (i) => L.glassAt(c.x + 60 + Math.cos(i / 7) * 30, c.y - 60 + Math.sin(i / 7) * 30)));
          L.setHot(-1);
        }
        return { still, light, all };
      })()`);
      console.log('frame cost (ms)', JSON.stringify(cost));
      await js('window.__lime.collapse()');
      await sleep(500);
    }
    if (want('options')) {
      const pdf = path.join(samples, 'doc.pdf');
      await js(`window.__lime.openWith(${JSON.stringify([pdf])})`);
      await sleep(400);
      await js('window.__lime.showOptions(window.__lime.catalog["protect-pdf"], { userPassword: "", allowPrint: true, allowCopy: true, allowEdit: false })');
      await shot('07-options');
      await js('window.__lime.collapse()');
      await sleep(500);
    }
    if (want('run')) {
      await js(`window.__lime.openWith(${JSON.stringify([img])})`);
      await sleep(300);
      await js('window.__lime.pick(window.__lime.S.ring.find((x) => x.label === "PNG"))');
      await sleep(250);
      await shot('08-busy');
      await until('window.__lime.S.state === "done" || window.__lime.S.state === "failed"');
      await js('window.__lime.setHot(-1)');
      await shot('09-done');
      await js('window.__lime.collapse()');
      await sleep(500);
    }
    if (want('dark')) {
      await js('window.lime.invoke("settings:set", { theme: "dark" })');
      await sleep(400);
      await shot('10-idle-dark');
      await js(`window.__lime.openWith(${JSON.stringify([path.join(samples, 'clip.mp4')])})`);
      await js('window.__lime.setHot(0)');
      await shot('11-menu-dark');
      await js('window.__lime.collapse()');
      await js('window.lime.invoke("settings:set", { theme: "system" })');
      await sleep(500);
    }
    if (want('multi')) {
      await js(`window.__lime.openWith(${JSON.stringify([img, path.join(samples, 'photo2.jpg'), path.join(samples, 'photo3.png')])})`);
      await shot('12-multi');
      await js('window.__lime.collapse()');
      await sleep(400);
    }
    if (want('cad')) {
      await js(`window.__lime.openWith(${JSON.stringify([path.join(samples, 'part.stp')])})`);
      await sleep(1500);
      await shot('13-cad');
      await js('window.__lime.collapse()');
      await sleep(400);
    }
    if (want('cad-options')) {
      await js(`window.__lime.openWith(${JSON.stringify([path.join(samples, 'box.stl')])})`);
      await sleep(600);
      await shot('13a-cad3d-ring');
      await js('window.__lime.showOptions(window.__lime.catalog["convert-model"], { to: "step", ascii: false, refine: true, units: "in", centre: "floor", scale: 100, repair: false, keep: 100 })');
      await shot('13b-convert-model-options');
      await js('window.__lime.showOptions(window.__lime.catalog["model-drawing"], { to: "pdf", views: "four", hidden: true, sheet: "a3", scale: "", angle: "first", title: "" })');
      await shot('13c-drawing-options');
      await js('window.__lime.collapse()');
      await sleep(400);
    }
    if (want('prefs')) {
      openPrefs();
      await sleep(2500);
      const p = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Lime Settings');
      if (p) await shot('14-prefs', p);
    }
    if (want('print')) {
      const book = path.join(samples, 'print.xlsx');
      await js(`window.__lime.openWith(${JSON.stringify([book])})`);
      await sleep(400);
      await js('(() => { const t = window.__lime.catalog["convert-sheet"], o = Object.fromEntries(t.options.map((x) => [x.key, x.default])); Object.assign(o, { to: "pdf", print: "selection", cells: "Budget!B3:C6" }); window.__lime.showOptions(t, o); })()');
      await shot('16-print-options');
      js(`window.lime.invoke('cells:pick', ${JSON.stringify(book)}, 'Budget!B3:C6, Budget!F12:H14')`);
      let pk = null;
      for (let t = 0; t < 60 && !pk; t++) { await sleep(250); pk = BrowserWindow.getAllWindows().find((x) => x.pickerData && !x.webContents.isLoading()); }
      if (pk) { await sleep(1500); await shot('17-picker', pk); pk.close(); }
      await js('window.__lime.collapse()');
      await sleep(500);
    }
    if (want('editor')) {
      openEditor(path.join(samples, 'doc.pdf'), 'edit');
      await sleep(4500);
      const e = BrowserWindow.getAllWindows().find((x) => x.editorData);
      if (e) {
        await shot('15-editor', e);
        const ejs = (code) => e.webContents.executeJavaScript(code, true);
        await ejs(`document.querySelector('[data-tool="addtext"]').click(); (() => { const l = document.querySelector('.pdfpage .layer'), b = l.getBoundingClientRect(); l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: b.left + 60, clientY: b.top + 160 })); })()`);
        await sleep(300);
        await ejs(`(() => { const el = document.querySelector('.obj.text[contenteditable]'); el.textContent = 'Styled text'; el.dispatchEvent(new Event('input', { bubbles: true })); for (const s of ['[data-s="bold"]', '[data-s="underline"]', '.swatches [data-c="#fff4ce"]']) document.querySelector('.props ' + s).click(); document.querySelector('.props details.more').open = true; })()`);
        await shot('16-editor-text', e);
        await ejs(`document.querySelector('[data-tool="select"]').click()`);
        await sleep(800);
        await shot('17-editor-select', e);
        const place = (fx_, fy) => ejs(`(() => { const l = document.querySelector('.pdfpage .layer'), b = l.getBoundingClientRect(), x = b.left + b.width * ${fx_}, y = b.top + b.height * ${fy}; l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y })); window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y })); })()`);
        await ejs(`document.querySelector('[data-tool="stamp"]').click()`);
        await place(0.62, 0.3);
        await ejs(`document.querySelector('.props [data-st="mark:check"]').click()`);
        await place(0.1, 0.36);
        await ejs(`document.querySelector('.props [data-st="date"]').click()`);
        await place(0.14, 0.355);
        await ejs(`document.querySelector('.props [data-st="CONFIDENTIAL"]').click()`);
        await shot('18-editor-stamp', e);
        await ejs(`(() => { const el = [...document.querySelectorAll('.obj.text')].find((x) => x.textContent === 'APPROVED'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', {})); const n = document.querySelector('.props input.num[aria-label="Rotation (°)"]'); n.value = -15; n.dispatchEvent(new Event('change')); })()`);
        await shot('18b-editor-stamp-selected', e);
        await ejs(`document.querySelector('[data-tool="highlight"]').click(); document.querySelector('.props [data-m="underline"]').click()`);
        await shot('19-editor-markup', e);
      }
    }
    const STUDIO = [
      ['studio-vector', 'logo.svg', 'vectorcraft', ['select', 'color', 'arrange', 'path', 'type', 'artboard', 'export'], async (ejs) => { await ejs(`document.querySelector('.vobj')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); window.dispatchEvent(new PointerEvent('pointerup', {}))`); }],
      ['studio-layout', 'layout.idml', 'designcraft', ['select', 'story', 'swatches', 'fonts', 'pages', 'preflight', 'export'], async (ejs) => { await ejs(`document.querySelectorAll('.dframe.text')[1]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`); }],
      ['studio-motion', 'anim.json', 'effectcraft', ['layers', 'text', 'color', 'time', 'comp', 'export'], async (ejs) => { await ejs(`document.querySelectorAll('.lrow .name')[1]?.click()`); }],
      ['studio-timeline', 'timeline.otio', 'filmcraft', ['select', 'clip', 'look', 'title', 'sequence', 'export'], async (ejs) => { await ejs(`document.querySelectorAll('.clip.video')[1]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`); }],
    ];
    for (const [step, sample, appId, panels, pick] of STUDIO) {
      if (!want(step) && !want('studio')) continue;
      openEditor(path.join(samples, sample), `studio:${appId}`);
      let e = null;
      for (let t = 0; t < 40 && !e; t++) { await sleep(250); e = BrowserWindow.getAllWindows().find((x) => x.editorData?.mode === `studio:${appId}` && !x.webContents.isLoading()); }
      if (!e) continue;
      const ejs = (code) => e.webContents.executeJavaScript(code, true);
      for (let t = 0; t < 120 && !(await ejs('!!document.querySelector(".studio .props h3") && !document.querySelector(".studio.working")')); t++) await sleep(250);
      await sleep(2500);
      await shot(`${step}-0`, e);
      for (const [i, p] of panels.entries()) {
        await ejs(`document.querySelector('[data-tool="${p}"]').click()`);
        for (let t = 0; t < 60 && (await ejs('!!document.querySelector(".studio.working")')); t++) await sleep(250);
        await sleep(1200);
        await shot(`${step}-${i + 1}-${p}`, e);
        if (i) continue;
        await pick(ejs);
        await sleep(1500);
        await shot(`${step}-${i + 1}-${p}-picked`, e);
      }
      e.destroy();
    }
    if (want('studio-flows')) {
      const open = async (sample, appId) => {
        openEditor(path.join(samples, sample), `studio:${appId}`);
        let e = null;
        for (let t = 0; t < 40 && !e; t++) { await sleep(250); e = BrowserWindow.getAllWindows().find((x) => x.editorData?.mode === `studio:${appId}` && !x.webContents.isLoading()); }
        const ejs = (code) => e.webContents.executeJavaScript(code, true);
        const idle = async () => { await sleep(300); for (let t = 0; t < 240 && (await ejs('!!document.querySelector(".studio.working, .monitor.preparing")')); t++) await sleep(250); await sleep(900); };
        for (let t = 0; t < 120 && !(await ejs('!!document.querySelector(".studio .props h3") && !document.querySelector(".studio.working")')); t++) await sleep(250);
        await sleep(1500);
        return { e, ejs, idle };
      };
      const press = (sel, fx, fy, tx, ty) => `(() => { const l = document.querySelector('${sel}'), b = l.getBoundingClientRect(), x = b.left + b.width * ${fx}, y = b.top + b.height * ${fy}; l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y })); window.dispatchEvent(new PointerEvent('pointermove', { clientX: b.left + b.width * ${tx ?? fx}, clientY: b.top + b.height * ${ty ?? fy} })); window.dispatchEvent(new PointerEvent('pointerup', { clientX: b.left + b.width * ${tx ?? fx}, clientY: b.top + b.height * ${ty ?? fy} })); })()`;
      let w = await open('logo.svg', 'vectorcraft');
      await w.ejs(`document.querySelector('[data-tool="shape"]').click(); document.querySelector('.props [data-v="star"]').click()`);
      await w.ejs(press('.pdfpage .layer', 0.72, 0.1, 0.95, 0.45));
      await w.idle();
      await w.ejs(`document.querySelector('[data-tool="text"]').click()`);
      await w.ejs(press('.pdfpage .layer', 0.08, 0.06));
      await sleep(300);
      await w.ejs(`(() => { const i = document.querySelector('.vtype'); i.value = 'Fresh'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      await w.idle();
      await w.ejs(`document.querySelector('[data-tool="select"]').click()`);
      await w.idle();
      await shot('studio-flows-1-vector-drawn', w.e);
      await w.ejs(`document.querySelector('[data-a="history"]').click()`);
      await shot('studio-flows-2-vector-history', w.e);
      await w.ejs(`document.querySelector('.hist')?.remove(); document.querySelector('[data-a="saveas"]').click()`);
      await shot('studio-flows-3-vector-saveas', w.e);
      w.e.destroy();
      w = await open('layout.idml', 'designcraft');
      await w.ejs(`document.querySelector('[data-tool="preflight"]').click()`);
      await w.idle();
      await shot('studio-flows-4-layout-preflight', w.e);
      await w.ejs(`document.querySelector('[data-tool="find"]').click(); document.querySelector('[data-k=dfind]').value = 'grid'; [...document.querySelectorAll('.props .btn')].find((b) => b.textContent.trim() === 'Find').click()`);
      await w.idle();
      await shot('studio-flows-5-layout-find', w.e);
      w.e.destroy();
      w = await open('anim.json', 'effectcraft');
      await w.ejs(`document.querySelector('[data-tool="color"]').click()`);
      await w.idle();
      await w.ejs(`[...document.querySelectorAll('.props .switch input')].pop()?.click()`);
      await w.idle();
      await shot('studio-flows-6-motion-transparent', w.e);
      await w.ejs(`document.querySelector('[data-m="play"]').click()`);
      await w.idle();
      await sleep(1500);
      await shot('studio-flows-7-motion-playing', w.e);
      w.e.destroy();
      w = await open('timeline.otio', 'filmcraft');
      await w.ejs(`document.querySelectorAll('.clip.video')[2].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`);
      await w.idle();
      await w.ejs(`[...document.querySelectorAll('.props .btn')].find((b) => b.title === 'End earlier').click()`);
      await w.idle();
      await w.ejs(`document.querySelector('[data-tool="title"]').click()`);
      await w.ejs(`[...document.querySelectorAll('.props .btn')].find((b) => /playhead/.test(b.textContent)).click()`);
      await w.idle();
      await shot('studio-flows-8-timeline-edited', w.e);
      w.e.destroy();
    }
    if (want('imgedit')) {
      openEditor(process.env.LIME_SHOT_PHOTO || path.join(samples, 'photo.jpg'), 'image');
      let e = null;
      for (let t = 0; t < 60 && !e; t++) { await sleep(250); e = BrowserWindow.getAllWindows().find((x) => x.editorData?.mode === 'image' && !x.webContents.isLoading()); }
      const ejs = (code) => e.webContents.executeJavaScript(code, true);
      const settle = async () => { for (let t = 0; t < 120; t++) { if (await ejs('(() => { const x = document.querySelector(".imged")?.__imged; return !!x && x.idle() && !!document.querySelector(".imged .photo[src]"); })()')) break; await sleep(150); } await sleep(400); };
      const slide = (key, v) => ejs(`(() => { const r = document.querySelector('.props [data-k="${key}"] input'); r.value = ${v}; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      const tool = (t) => ejs(`document.querySelector('[data-tool="${t}"]').click()`);
      if (e) {
        await settle();
        await shot('40-imgedit-open', e);
        await slide('light.exposure', 0.35); await slide('light.shadows', 40); await slide('light.highlights', -30); await slide('color.vibrance', 25); await slide('effects.clarity', 20);
        await settle();
        await shot('41-imgedit-adjust', e);
        await tool('looks');
        await sleep(4000);
        await ejs('document.querySelector(\'.look[data-l="lc.golden-hour"]\')?.click()');
        await settle();
        await shot('42-imgedit-looks', e);
        await tool('enhance');
        await shot('43-imgedit-enhance', e);
        await tool('crop');
        await settle();
        await ejs('document.querySelector(\'.props [data-r="4:5"]\').click()');
        await slide('angle', 4);
        await settle();
        await shot('44-imgedit-crop', e);
        await tool('text');
        await ejs(`(() => { const m = document.querySelector('.imged .marks'), b = m.getBoundingClientRect(); m.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: b.left + b.width * 0.08, clientY: b.top + b.height * 0.12 })); })()`);
        await sleep(300);
        await ejs(`(() => { const el = document.querySelector('.tedit'); el.textContent = 'Golden hour'; el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); })()`);
        await sleep(300);
        await tool('arrow');
        await ejs(`(() => { const m = document.querySelector('.imged .marks'), b = m.getBoundingClientRect(), p = (fx, fy) => ({ bubbles: true, button: 0, clientX: b.left + b.width * fx, clientY: b.top + b.height * fy }); m.dispatchEvent(new PointerEvent('pointerdown', p(0.25, 0.3))); window.dispatchEvent(new PointerEvent('pointermove', p(0.42, 0.5))); window.dispatchEvent(new PointerEvent('pointerup', p(0.42, 0.5))); })()`);
        await settle();
        await shot('45-imgedit-markup', e);
        await tool('heal');
        await settle();
        await shot('46-imgedit-heal', e);
        await tool('mask');
        await ejs(`(() => { const m = document.querySelector('.imged .marks'), b = m.getBoundingClientRect(), p = (fx, fy) => ({ bubbles: true, button: 0, clientX: b.left + b.width * fx, clientY: b.top + b.height * fy }); m.dispatchEvent(new PointerEvent('pointerdown', p(0.5, 0.02))); window.dispatchEvent(new PointerEvent('pointermove', p(0.5, 0.45))); window.dispatchEvent(new PointerEvent('pointerup', p(0.5, 0.45))); })()`);
        await sleep(300);
        await slide('mask.exposure', -1.3);
        await slide('mask.temp', -30);
        await settle();
        await shot('46b-imgedit-mask', e);
        await ejs('window.lime.invoke("settings:set", { theme: "dark" })');
        await tool('adjust');
        await settle();
        await shot('47-imgedit-dark', e);
        await ejs('window.lime.invoke("settings:set", { theme: "system" })');
        await ejs('document.querySelectorAll(".props details.sec").forEach((d) => { d.open = !["Light", "Colour", "Presence"].includes(d.querySelector("summary").textContent.replace("Reset", "")); }); document.querySelector(".props").scrollTop = 520');
        await sleep(500);
        await shot('48-imgedit-panels', e);
        await tool('resize');
        await ejs('document.querySelector(\'.props [data-q="5"]\').click()');
        await settle();
        await shot('49-imgedit-resize', e);
        await ejs('document.querySelector(\'[data-a="history"]\').click()');
        await sleep(300);
        await shot('50-imgedit-history', e);
        await ejs('document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))');
        await ejs('document.querySelector(\'[data-a="compare"]\').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))');
        await settle();
        await shot('51-imgedit-before', e);
        await ejs('document.querySelector(\'[data-a="compare"]\').dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))');
        await tool('crop');
        await settle();
        await shot('52-imgedit-crop-again', e);
        await tool('text');
        await ejs(`(() => { const m = document.querySelector('.imged .marks'), b = m.getBoundingClientRect(); m.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: b.left + b.width * 0.1, clientY: b.top + b.height * 0.8 })); })()`);
        await sleep(300);
        await ejs(`(() => { const el = document.querySelector('.tedit'); el.textContent = 'Typing here'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await sleep(300);
        await shot('53-imgedit-typing', e);
        await ejs('document.querySelector(\'[data-a="saveas"]\').click()');
        await sleep(400);
        await shot('54-imgedit-saveas', e);
        await ejs('document.querySelector(".scrim [data-a=no]").click()');
        await tool('adjust');
        e.setSize(860, 620);
        await sleep(600);
        await settle();
        await shot('55-imgedit-narrow', e);
        e.destroy();
      }
    }
    if (want('imgedit2')) {
      openEditor(path.join(samples, 'faces.png'), 'image');
      let e = null;
      for (let t = 0; t < 60 && !e; t++) { await sleep(250); e = BrowserWindow.getAllWindows().find((x) => x.editorData?.mode === 'image' && !x.webContents.isLoading()); }
      const ejs = (code) => e.webContents.executeJavaScript(code, true);
      const settle = async () => { for (let t = 0; t < 400; t++) { if (await ejs('(() => { const x = document.querySelector(".imged")?.__imged; return !!x && x.idle() && !!document.querySelector(".imged .photo[src]"); })()')) break; await sleep(150); } await sleep(400); };
      const tool = (t) => ejs(`document.querySelector('[data-tool="${t}"]').click()`);
      const press = (fx_, fy, to) => ejs(`(() => { const m = document.querySelector('.imged .marks'), b = m.getBoundingClientRect(), p = (x, y) => ({ bubbles: true, button: 0, clientX: b.left + b.width * x, clientY: b.top + b.height * y }); m.dispatchEvent(new PointerEvent('pointerdown', p(${fx_}, ${fy}))); ${to ? `window.dispatchEvent(new PointerEvent('pointermove', p(${to[0]}, ${to[1]})));` : ''} window.dispatchEvent(new PointerEvent('pointerup', p(${(to || [fx_])[0]}, ${(to || [0, fy])[1]}))); })()`);
      if (e) {
        await settle();
        await tool('redeye');
        await press(0.268, 0.5);
        await press(0.356, 0.5);
        await settle();
        await shot('60-imgedit-redeye', e);
        await tool('heal');
        await press(0.2, 0.33, [0.24, 0.36]);
        await settle();
        await ejs('document.querySelector(".imged .marks").dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: document.querySelector(".imged .marks").getBoundingClientRect().left + 300, clientY: document.querySelector(".imged .marks").getBoundingClientRect().top + 120 }))');
        await shot('61-imgedit-heal-spot', e);
        await tool('crop');
        await ejs('document.querySelector(\'.props [data-o="right"]\').click()');
        await tool('heal');
        await settle();
        await shot('62-imgedit-turned-spot', e);
        await tool('enhance');
        await ejs('document.querySelector(\'.props [data-e="removeBg"]\').click()');
        await sleep(1000);
        await shot('63-imgedit-working', e);
        await settle();
        await shot('64-imgedit-cutout', e);
        await ejs('document.querySelector(".zoom").value = "1"; document.querySelector(".zoom").dispatchEvent(new Event("change"))');
        await settle();
        await shot('65-imgedit-100', e);
        e.destroy();
      }
    }
    if (want('media')) {
      const { execFileSync } = require('child_process');
      const ff = require(path.join(__dirname, '..', 'src', 'main', 'engines', 'util')).binPath('ffmpeg'), demo = path.join(dir, 'Lake walk.mp4'), talk = path.join(dir, 'Interview.wav');
      if (!fs.existsSync(demo)) {
        execFileSync(ff, ['-v', 'error', '-y', '-loop', '1', '-i', path.join(samples, 'photo.jpg'), '-loop', '1', '-i', path.join(samples, 'photo2.jpg'),
          '-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*190*t)*(0.55+0.45*sin(2*PI*1.7*t))*gt(sin(2*PI*0.35*t)+0.2,0)':s=48000:d=12",
          '-filter_complex', "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='1+0.0012*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1280x720:fps=25[a];[1:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='1.1-0.0006*on':d=150:s=1280x720:fps=25[b];[a][b]concat=n=2:v=1:a=0,format=yuv420p[v]",
          '-map', '[v]', '-map', '2:a', '-t', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', demo]);
        execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.6*sin(2*PI*160*t+3*sin(2*PI*3*t))*(0.5+0.5*sin(2*PI*2.3*t))*gt(sin(2*PI*0.3*t)+0.35,0)+0.01*random(0)':s=44100:d=20", talk]);
      }
      const media = async (file, steps) => {
        openEditor(file, 'media');
        let e = null;
        for (let t = 0; t < 40 && !e; t++) { await sleep(250); e = BrowserWindow.getAllWindows().find((x) => x.editorData?.file === file && !x.webContents.isLoading()); }
        if (!e) return;
        const ejs = (code) => e.webContents.executeJavaScript(`(async () => { ${code} })()`, true).catch((er) => console.error('media step failed:', er.message));
        e.webContents.on('console-message', (ev) => { if (ev.level === 'error' || ev.level === 3) console.error('renderer:', ev.message); });
        for (let t = 0; t < 80 && !(await e.webContents.executeJavaScript('!!window.__media?.st.ready').catch(() => false)); t++) await sleep(250);
        await sleep(2500);
        for (const [name, code, wait] of steps) { if (code) { const r = await ejs(code); if (r !== undefined) console.log(name, r); } await sleep(wait || 1200); await shot(name, e); }
        e.destroy();
      };
      await media(demo, [
        ['40-media', 'window.__media.seek(2.4); await new Promise((r) => setTimeout(r, 500)); return window.__media.st.view'],
        ['41-media-cuts', 'const M = window.__media; M.seek(0.6); M.act("in"); M.seek(10.8); M.act("out"); M.seek(4.2); M.act("split"); M.seek(6.1); M.act("split"); M.st.sel = 1; M.act("cut"); M.seek(3.2)'],
        ['42-media-colour', 'document.querySelector(\'[data-tool="colour"]\').click()', 5000],
        ['43-media-look', 'window.__media.edit((x) => { x.look = "lumetri:Golden Dusk"; x.color.contrast = 12; }); document.querySelector(\'[data-tool="colour"]\').click()', 4000],
        ['44-media-title', 'document.querySelector(\'[data-tool="titles"]\').click(); window.__media.addTitle(); const ta = document.querySelector(".props textarea"); ta.value = "Morning by the lake"; ta.dispatchEvent(new Event("input", { bubbles: true })); ta.dispatchEvent(new Event("change", { bubbles: true })); window.__media.seek(3.4)'],
        ['45-media-crop', 'document.querySelector(\'[data-tool="crop"]\').click(); document.querySelector(\'.props [data-v="9:16"]\').click()'],
        ['46-media-sound', 'document.querySelector(\'[data-tool="sound"]\').click()'],
        ['47-media-saveas', 'document.querySelector(\'[data-a="saveas"]\').click()'],
        ['50-media-speed', 'document.querySelector(\'.scrim [data-a="no"]\').click(); document.querySelector(\'[data-tool="speed"]\').click()'],
        ['51-media-resize', 'document.querySelector(\'[data-tool="resize"]\').click()'],
        ['52-media-music', `window.__media.edit((x) => { x.music = { file: ${JSON.stringify(path.join(samples, 'song.mp3'))}, volume: -8, mode: 'mix', duck: 10, loop: true, fit: false, fadeOut: 2 }; x.subs = { file: ${JSON.stringify(path.join(samples, 'sub.srt'))}, size: 18 }; }); document.querySelector('[data-tool="music"]').click()`],
        ['53-media-subs', 'document.querySelector(\'[data-tool="subs"]\').click(); window.__media.seek(1.2)'],
        ['54-media-scenes', 'document.querySelector(\'[data-tool="scenes"]\').click()'],
        ['55-media-stabilise', 'document.querySelector(\'[data-tool="stabilise"]\').click()'],
        ['56-media-fade', 'document.querySelector(\'[data-tool="fade"]\').click()'],
        ['57-media-dark', 'document.documentElement.dataset.theme = "dark"; document.querySelector(\'[data-tool="trim"]\').click()'],
      ]);
      await media(talk, [
        ['48-audio', 'window.__media.seek(5.2)'],
        ['49-audio-clean', 'document.querySelector(\'[data-tool="clean"]\').click(); window.__media.edit((x) => { x.audio.gain = 4; })'],
        ['58-audio-volume', 'document.querySelector(\'[data-tool="volume"]\').click(); window.__media.edit((x) => { x.audio.normalise = true; })', 4000],
        ['59-audio-eq', 'document.querySelector(\'[data-tool="eq"]\').click(); document.querySelector(\'.props [data-v="voice"]\').click()'],
        ['60-audio-channels', 'document.querySelector(\'[data-tool="channels"]\').click()'],
        ['61-audio-cuts', 'const M = window.__media; M.seek(3); M.act("split"); M.seek(6); M.act("split"); M.st.sel = 1; M.act("cut"); M.seek(4.5); document.querySelector(\'[data-tool="trim"]\').click()'],
      ]);
    }
    if (want('pdftools')) {
      const src = path.join(dir, 'tools.pdf');
      fs.copyFileSync(path.join(samples, 'chapters.pdf'), src);
      openEditor(src, 'edit');
      let e = null;
      for (let t = 0; t < 40 && !e; t++) { await sleep(250); e = BrowserWindow.getAllWindows().find((x) => x.editorData && !x.webContents.isLoading()); }
      if (e) {
        e.webContents.on('console-message', (ev, level, message) => { const lv = ev?.level ?? level, msg = ev?.message ?? message; if (lv === 3 || lv === 'error') console.log('editor error:', String(msg).slice(0, 300)); });
        const ejs = (code) => e.webContents.executeJavaScript(code, true);
        const wait = async (code, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ejs(code)) return true; await sleep(150); } return false; };
        await wait('!!document.querySelector(".pdfpage img.r[src]")');
        await sleep(800);
        const at = (fx_, fy, extra = '') => `(() => { const l = document.querySelector('.pdfpage .layer'), b = l.getBoundingClientRect(), x = b.left + b.width * ${fx_}, y = b.top + b.height * ${fy}; l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y })); ${extra} window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y })); })()`;
        const drag = (fx0, fy0, fx1, fy1) => `(() => { const l = document.querySelector('.pdfpage .layer'), b = l.getBoundingClientRect(), p = (u, v) => ({ clientX: b.left + b.width * u, clientY: b.top + b.height * v }); l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ...p(${fx0}, ${fy0}) })); window.dispatchEvent(new PointerEvent('pointermove', p(${fx1}, ${fy1}))); window.dispatchEvent(new PointerEvent('pointerup', p(${fx1}, ${fy1}))); })()`;
        await ejs(`document.querySelector('[data-tool="note"]').click()`);
        await ejs(at(0.62, 0.1));
        await wait('!!document.querySelector(".cm.sel textarea")');
        await ejs(`(() => { const t = document.querySelector('.cm.sel textarea'); t.value = 'Should this heading be bigger?'; t.dispatchEvent(new Event('change')); })()`);
        await sleep(900);
        await ejs(`(() => { const i = document.querySelector('.cm.sel .cmrow input'); i.value = 'Yes, 24 pt.'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
        await sleep(900);
        await ejs(`document.querySelector('[data-tool="highlight"]').click()`);
        await ejs(drag(0.1, 0.165, 0.5, 0.18));
        await sleep(300);
        await shot('40-comments', e);
        await ejs(`document.querySelector('[data-side="bookmarks"]').click()`);
        await sleep(400);
        await ejs(`document.querySelector('.bm')?.click()`);
        await shot('41-bookmarks', e);
        await ejs(`document.querySelector('[data-tool="link"]').click()`);
        await ejs(drag(0.1, 0.075, 0.6, 0.11));
        await sleep(300);
        await ejs(`(() => { const i = document.querySelector('.props [data-l=url]'); if (i) i.value = 'getartcraft.com'; })()`);
        await shot('42-link', e);
        await ejs(`document.querySelector('.props .cmrow .btn.primary')?.click()`);
        await sleep(1200);
        await ejs(`document.querySelector('[data-tool="field"]').click()`);
        await ejs(drag(0.1, 0.3, 0.5, 0.33));
        await wait('document.querySelectorAll(".pfield.edit").length >= 1', 8000);
        await ejs(`document.querySelector('.props [data-fk="checkbox"]')?.click()`);
        await ejs(at(0.12, 0.37));
        await wait('document.querySelectorAll(".pfield.edit").length >= 2', 8000);
        await ejs(`document.querySelector('[data-side="fields"]').click()`);
        await shot('43-fields-prepare', e);
        await ejs(`document.querySelector('[data-tool="select"]').click()`);
        await sleep(400);
        await ejs(`(() => { const i = document.querySelector('.pfield.fill input[type=text]'); if (i) { i.value = 'Jay Kadam'; i.dispatchEvent(new Event('input')); } const c = document.querySelector('.pfield.fill input[type=checkbox]'); if (c) { c.checked = true; c.dispatchEvent(new Event('change')); } })()`);
        await shot('44-fields-fill', e);
        await ejs(`document.querySelector('[data-tool="redact"]').click()`);
        await ejs(drag(0.1, 0.13, 0.45, 0.15));
        await sleep(300);
        await shot('45-redact', e);
        await ejs(`document.querySelector('[data-tool="measure"]').click()`);
        await ejs(drag(0.1, 0.6, 0.7, 0.6));
        await sleep(300);
        await shot('46-measure', e);
        await ejs(`document.querySelector('[data-tool="crop"]').click()`);
        await ejs(drag(0.06, 0.05, 0.94, 0.7));
        await sleep(300);
        await shot('47-crop', e);
        await ejs(`document.querySelector('[data-tool="select"]').click(); document.querySelector('[data-a="docmenu"]').click()`);
        await sleep(300);
        await shot('48-docmenu', e);
        await ejs(`document.querySelector('.popmenu [data-d="headerFooter"]').click()`);
        await sleep(400);
        await ejs(`(() => { const i = document.querySelector('[data-box="header_left"]'); i.value = 'Lime handbook'; i.dispatchEvent(new Event('input', { bubbles: true })); const j = document.querySelector('[data-box="footer_right"]'); j.focus(); document.querySelector('[data-tok="<<Page 1 of n>>"]').click(); })()`);
        await sleep(1500);
        await shot('49-header-footer', e);
        await ejs(`document.querySelector('.scrim [data-a=cancel]').click(); document.querySelector('[data-a="docmenu"]').click()`);
        await sleep(200);
        await ejs(`document.querySelector('.popmenu [data-d="props"]').click()`);
        await sleep(1200);
        await shot('50-properties', e);
        await ejs(`document.querySelector('.scrim [data-a=cancel]').click(); document.querySelector('[data-a="saveopts"]').click()`);
        await sleep(300);
        await shot('51-save-options', e);
        await ejs(`document.querySelector('.popmenu')?.remove(); document.querySelector('[data-tool="edittext"]').click()`);
        await ejs(`document.querySelector('.props [data-k="paragraph"]')?.click()`);
        await sleep(800);
        await shot('52-paragraphs', e);
      }
    }
  } catch (e) { console.error('shots failed', e); }
  app.isQuitting = true;
  app.quit();
};
