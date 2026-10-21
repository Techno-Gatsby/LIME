'use strict';
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async ({ wheel, showWheel, openPrefs, openEditor, BrowserWindow, app, summon, peek, screen, dir }) => {
  fs.mkdirSync(dir, { recursive: true });
  const samples = process.env.LIME_SAMPLES || path.join(dir, 'samples');
  const steps = (process.env.LIME_STEPS || 'all').split(',');
  const w = () => wheel();
  const js = (code) => w().webContents.executeJavaScript(code, true);
  const shot = async (name, win = w()) => {
    await sleep(Number(process.env.LIME_SHOT_WAIT) || 700);
    const img = await win.webContents.capturePage();
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
      const frame = async (name) => { const img = await w().webContents.capturePage(); fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG()); console.log('shot', name, img.getSize()); };
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
      const frame = async (name) => { const im = await w().webContents.capturePage(); fs.writeFileSync(path.join(dir, `${name}.png`), im.toPNG()); console.log('shot', name, im.getSize()); };
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
        await ejs(`document.querySelector('[data-tool="highlight"]').click(); document.querySelector('.props [data-m="underline"]').click()`);
        await shot('19-editor-markup', e);
      }
    }
    // The app editors: each opened on a sample, then a few of its panels.
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
    // A few things done in each editor, the way a person would: drawing, typing, the history and Save as.
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
  } catch (e) { console.error('shots failed', e); }
  app.isQuitting = true;
  app.quit();
};
