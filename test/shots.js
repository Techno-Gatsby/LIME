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
    if (want('media')) {
      // A clip with a picture that moves and sound that pauses, so the strip, waveform and looks show something.
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
  } catch (e) { console.error('shots failed', e); }
  app.isQuitting = true;
  app.quit();
};
