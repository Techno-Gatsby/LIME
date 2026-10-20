'use strict';
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async ({ wheel, showWheel, openPrefs, openEditor, BrowserWindow, app, dir }) => {
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
    if (want('editor')) {
      openEditor(path.join(samples, 'doc.pdf'), 'edit');
      await sleep(4500);
      const e = BrowserWindow.getAllWindows().find((x) => x.editorData);
      if (e) await shot('15-editor', e);
    }
  } catch (e) { console.error('shots failed', e); }
  app.isQuitting = true;
  app.quit();
};
