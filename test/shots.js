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
      // Retouching and a cut-out, on the faces sample.
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
        await press(0.355, 0.24);
        await press(0.18, 0.24);
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
  } catch (e) { console.error('shots failed', e); }
  app.isQuitting = true;
  app.quit();
};
