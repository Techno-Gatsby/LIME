'use strict';
// The PDF editor's Edit text tool with the Fields panel open. The narrower page area refits the pages, and a
// refit must never leave the page without its lines to click, even when refits keep coming.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (editorTest) => {
  await editorTest('edit pdf · Edit text with the Fields panel open', 'fields-lines.pdf', async () => {
    const { PDFDocument } = require('pdf-lib');
    const src = await PDFDocument.load(require('fs').readFileSync(require('path').join(process.env.LIME_FX, 'doc.pdf')));
    const one = await PDFDocument.create();
    one.addPage((await one.copyPages(src, [0]))[0]);
    return Buffer.from(await one.save());
  }, async (ed) => {
    const count = () => ed.ejs('document.querySelectorAll(".pdfpage .tline:not(.mask)").length');
    await ed.tool('select');
    await ed.press('[data-side="fields"]');
    if (!(await ed.wait('document.querySelector("[data-side=fields]")?.getAttribute("aria-pressed") === "true"', 3000))) throw new Error('the Fields panel did not open');
    await sleep(600);
    await ed.tool('edittext');
    await sleep(1200);
    const n = await count();
    if (!n) throw new Error('no lines to click after picking Edit text with Fields open');
    // A width where fitting the page brings in the scroll bar, and the narrower fit then takes it away again.
    const w = await ed.ejs(`(() => { const pg = document.querySelector('.pages'), p = document.querySelector('.pdfpage'), r = p.offsetHeight / p.offsetWidth, cs = getComputedStyle(pg);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), w = Math.round((pg.clientHeight - pad) / r + 96 + 5);
      pg.style.width = w + 'px'; pg.style.justifySelf = 'start'; return w; })()`);
    const seen = [];
    for (let i = 0; i < 14; i++) { await sleep(120); seen.push(await count()); }
    const settled = seen.slice(4);
    if (settled.some((c) => !c)) throw new Error(`lines gone while the pages refit at ${w} px: ${seen.join(' ')}`);
    // Refits one after another, as when the window is dragged wider: the lines stay and follow the zoom.
    const during = [];
    for (let i = 0; i < 10; i++) { await ed.ejs(`document.querySelector('.pages').style.width = '${w - 120 + (i % 2) * 90}px'`); await sleep(110); during.push(await count()); }
    await ed.ejs('Object.assign(document.querySelector(".pages").style, { width: "", justifySelf: "" })');
    if (during.some((c) => !c)) throw new Error(`lines gone during repeated refits: ${during.join(' ')}`);
    await sleep(800);
    const fit = await ed.ejs('(() => { const ls = [...document.querySelectorAll(".pdfpage .tline:not(.mask)")], p = ls[0]?.closest(".pdfpage").getBoundingClientRect(); return ls.length && ls.every((l) => { const b = l.getBoundingClientRect(); return b.width > 4 && b.left >= p.left - 1 && b.right <= p.right + 1 && b.bottom <= p.bottom + 1; }); })()');
    if (!fit) throw new Error('the lines are not on the page after the refits');
    await ed.ejs('document.querySelector(".pdfpage .tline:not(.mask)").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))');
    if (!(await ed.wait('/^Edited (text|paragraph)$/.test(document.querySelector(".props h3")?.textContent || "")', 3000))) throw new Error('clicking a line did not start editing it');
    return `${n} lines to click with Fields open; kept through refits at the scroll-bar edge (${settled.join(' ')}) and repeated refits (${during.join(' ')}); one opens for editing`;
  });
};
