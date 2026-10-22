'use strict';
// Screenshots of the dictation panel: listening, done, dark, Arabic, and Settings › Dictation.
const fs = require('fs');
const path = require('path');

module.exports = async ({ dictate, js, sleep, dir, openPrefs, BrowserWindow }) => {
  const panelShot = async (name) => {
    await sleep(500);
    const w = dictate.window(), img = await w.webContents.capturePage(), { width, height } = img.getSize();
    const dark = await w.webContents.executeJavaScript('document.documentElement.dataset.theme === "dark"');
    // The panel is glass over a transparent window; lay it on a desktop-like backdrop so it reads as it would on screen.
    const sharp = require('sharp');
    const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${dark ? '#1f2a3a' : '#9fc3e6'}"/><stop offset="1" stop-color="${dark ? '#3b2a3f' : '#e9c9a8'}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
    await sharp(bg).composite([{ input: img.toPNG() }]).png().toFile(path.join(dir, `${name}.png`));
    console.log('shot', name, img.getSize());
  };
  const until = async (fn, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(200); } return false; };
  const take = async (wav, prefix, at = 6500) => {
    await dictate.feed(wav);
    await sleep(at);
    await panelShot(`${prefix}-listening`);
    await until(() => dictate.current()?.done);
    await panelShot(`${prefix}-done`);
  };
  await js('window.lime.invoke("settings:set", { theme: "light", dictation: { autoCopy: true } })');
  await take(process.env.LIME_DICTATE_WAV, '90-dictate');
  await js('window.lime.invoke("settings:set", { theme: "dark" })');
  await take(process.env.LIME_DICTATE_WAV, '92-dictate-dark');
  if (process.env.LIME_DICTATE_AR) {
    await js('window.lime.invoke("settings:set", { theme: "light", dictation: { lang: "ar", autoCopy: true } })');
    await take(process.env.LIME_DICTATE_AR, '94-dictate-arabic', 2500);
    await js('window.lime.invoke("settings:set", { dictation: { lang: "auto", autoCopy: true } })');
  }
  dictate.close();
  await js('window.lime.invoke("settings:set", { theme: "light" })');
  openPrefs('dictation');
  await sleep(2500);
  const p = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Lime Settings');
  if (p) {
    p.setSize(560, 900);
    await p.webContents.executeJavaScript('document.querySelector("#dictation")?.scrollIntoView(); 1');
    await sleep(600);
    fs.writeFileSync(path.join(dir, '96-prefs-dictation.png'), (await p.webContents.capturePage()).toPNG());
    console.log('shot 96-prefs-dictation');
  }
};
