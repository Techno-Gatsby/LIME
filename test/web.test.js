'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async ({ submit, jobs, dir }) => {
  const OUT = path.join(dir, 'web');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'site', 'images'), { recursive: true });
  const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = async (name, fn) => {
    name = `web: ${name}`;
    if (only && !only.test(name)) return;
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { status = 'FAIL'; detail = e.message; }
    console.log(`${status} ${name.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 240));
    results.push({ name, status, detail });
  };
  const run = async (tool, files, opts = {}) => {
    const d = path.join(OUT, `${tool}-${results.length}`);
    fs.mkdirSync(d, { recursive: true });
    const id = submit({ tool, files, opts, dest: { kind: 'dir', path: d } });
    let j;
    for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(100); }
    ok(j.status === 'done', `${tool}: ${j.status}: ${j.error}`);
    return j.results[0];
  };
  const read = (p) => fs.readFileSync(p, 'utf8');

  const site = path.join(OUT, 'site'), page = path.join(site, 'index.html'), css = path.join(site, 'style.css'), js = path.join(site, 'app.js');
  await require('sharp')({ create: { width: 40, height: 30, channels: 3, background: '#86c23a' } }).png().toFile(path.join(site, 'images', 'pic.png'));
  fs.writeFileSync(css, '/* site styles */\nbody {\n  margin: 0;\n  font-family: Georgia, serif;\n}\n.note {\n  color: #c4291f;\n  padding: 4px 8px;\n}\n');
  fs.writeFileSync(js, 'function greet(name) {\n  const message = "Hello, " + name;\n  return message;\n}\nconsole.log(greet("Lime"));\n');
  fs.writeFileSync(path.join(site, 'other.html'), '<!DOCTYPE html><html lang="en"><head><title>Other</title></head><body><h2 id="prices">Prices</h2></body></html>');
  fs.writeFileSync(page, `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Lakeside cabins</title><link rel="stylesheet" href="style.css">
<style>h1 { color: #2f6f1e; }</style></head>
<body><!-- top of the page -->
<h1 id="top">Lakeside cabins</h1><div class="intro"><p class="note">Open from April to October.</p><p>Three   cabins by the water.</p></div>
<img src="images/pic.png" alt="A cabin"><img src="images/missing.png" alt="Missing">
<p><a href="#top">Back up</a> <a href="#nowhere">Nowhere</a> <a href="other.html#prices">Prices</a> <a href="other.html#nope">Nope</a> <a href="gone.html">Gone</a> <a href="https://example.com/">Web</a></p>
<script>var x = 1;</script>
</body>
</html>
`);
  const bad = path.join(site, 'bad.html');
  fs.writeFileSync(bad, '<html>\n<body>\n<div id="a">\n<p>One\n<span id="a">Two</div>\n<img src="images/pic.png">\n</em>\n<section>\n<ul><li>a<li>b</ul>\n</body>\n</html>\n');

  await check('format HTML, CSS and scripts', async () => {
    const minified = path.join(site, 'flat.html');
    fs.writeFileSync(minified, '<!DOCTYPE html><html><head><title>Flat</title></head><body><div><ul><li>One</li><li>Two</li></ul><p>Text <b>bold</b></p></div></body></html>');
    const r = await run('format-html', [minified], { indent: '2' }), out = read(r.path);
    ok(path.basename(r.path) === 'flat-formatted.html', path.basename(r.path));
    ok(out.split('\n').length >= 10, `only ${out.split('\n').length} lines:\n${out}`);
    ok(/\n {6}<li>One<\/li>/.test(out), `list items not indented:\n${out}`);
    ok(out.replace(/\s+/g, '') === read(minified).replace(/\s+/g, ''), 'the markup changed');
    const tabs = read((await run('format-html', [css], { indent: 'tab' })).path);
    ok(/\n\tmargin: 0;/.test(tabs), `CSS not indented with tabs:\n${tabs}`);
    const four = read((await run('format-html', [js], { indent: '4' })).path);
    ok(/\n {4}const message/.test(four), `script not indented with 4 spaces:\n${four}`);
    return `${out.split('\n').length - 1} lines from one; CSS with tabs, script with 4 spaces`;
  });

  await check('minify HTML, CSS and scripts', async () => {
    const h = await run('minify-web', [page]), html = read(h.path);
    ok(path.basename(h.path) === 'index.min.html', path.basename(h.path));
    ok(!html.includes('top of the page') && !/>\s{2,}</.test(html) && html.length < read(page).length, `not minified:\n${html}`);
    ok(html.includes('<p>Three cabins by the water.</p>') && html.includes('h1{color:#2f6f1e}'), `content or CSS lost:\n${html}`);
    const c = read((await run('minify-web', [css])).path);
    ok(c === 'body{margin:0;font-family:Georgia,serif}.note{color:#c4291f;padding:4px 8px}', `CSS: ${c}`);
    const s = read((await run('minify-web', [js])).path);
    ok(!s.includes('message') && s.includes('console.log') && s.length < read(js).length * 0.8, `script: ${s}`);
    return `${h.note}; CSS ${c.length} bytes; script ${s.length} bytes`;
  });

  await check('check links and images', async () => {
    const r = await run('check-links', [page]), t = r.text || '';
    for (const want of ['images/missing.png', '#nowhere', 'other.html#nope', 'gone.html']) ok(t.includes(want), `missed ${want}: ${t}`);
    for (const fine of ['pic.png', '#top:', 'other.html#prices', 'example.com']) ok(!t.includes(fine), `wrongly flagged ${fine}: ${t}`);
    ok(/4 problems/.test(r.note) && /1 web address not checked/.test(r.note), r.note);
    ok(/Line 7: images\/missing\.png/.test(t), `no line numbers: ${t}`);
    return r.note;
  });

  await check('inline CSS for e-mail', async () => {
    const r = await run('inline-css', [page]), out = read(r.path);
    ok(path.basename(r.path) === 'index-email.html', path.basename(r.path));
    ok(!/<link\b/i.test(out), 'the stylesheet link is still there');
    ok(/<p class="note" style="color: #c4291f; padding: 4px 8px;">/.test(out), `linked CSS not inlined:\n${out}`);
    ok(/<h1 id="top" style="color: #2f6f1e;">/.test(out), `page CSS not inlined:\n${out}`);
    return r.note;
  });

  await check('page to PDF', async () => {
    const r = await run('web-to-pdf', [page], { pageSize: 'A4' });
    ok(path.basename(r.path) === 'index.pdf', path.basename(r.path));
    const P = require(path.join(__dirname, '..', 'src', 'main', 'engines', 'pdf')), { doc } = await P.readPdf(r.path);
    const pg = doc.loadPage(0), text = pg.toStructuredText('').asText(), [, , w, h] = pg.getBounds();
    ok(text.includes('Lakeside cabins') && text.includes('Open from April'), `text: ${text}`);
    ok(Math.abs(w - 595) < 3 && Math.abs(h - 842) < 3, `page ${w}×${h}`);
    return `${doc.countPages()} A4 page with the heading and text`;
  });

  await check('extract text', async () => {
    const r = await run('web-text', [page]), t = read(r.path);
    ok(path.basename(r.path) === 'index.txt', path.basename(r.path));
    ok(t.includes('Lakeside cabins') && t.includes('Open from April to October.') && !/[<>]/.test(t) && !t.includes('var x'), `text:\n${t}`);
    return r.note;
  });

  await check('validate', async () => {
    const r = await run('validate-html', [bad]), t = r.text || '';
    for (const want of ['Line 5: id "a" is used again (first on line 3)', 'Line 5: <span> is never closed', 'Line 6: <img> has no alt text', 'Line 7: </em> has no matching <em>', 'Line 8: <section> is never closed', 'No <!DOCTYPE html>', 'The page has no title', '<html> has no lang']) ok(t.includes(want), `missed “${want}”:\n${t}`);
    ok(!/<li>|<p>|<ul>/.test(t), `optional end tags flagged:\n${t}`);
    const good = await run('validate-html', [page]);
    ok(good.note === 'No problems found', `the good page: ${good.note}: ${good.text}`);
    return `${r.note}; the good page: ${good.note.toLowerCase()}`;
  });

  await check('editor save keeps pictures when saved elsewhere', async () => {
    const W = require(path.join(__dirname, '..', 'src', 'main', 'webedit'));
    const d = await W.open(page);
    ok(d.css.length === 1 && d.css[0].href === 'style.css', `linked styles: ${JSON.stringify(d.css)}`);
    const away = path.join(OUT, 'elsewhere', 'copy.html');
    fs.mkdirSync(path.dirname(away), { recursive: true });
    const r = await W.save(page, away, { src: d.src, css: [{ path: css, text: `${d.css[0].text}h2 { color: navy; }\n` }] });
    const out = read(r.path);
    ok(out.includes('src="../site/images/pic.png"') && out.includes('href="../site/style%20(edited).css"') && out.includes('href="#top"'), `references not rebased:\n${out}`);
    ok(read(path.join(site, 'style (edited).css')).includes('navy') && !read(css).includes('navy'), 'the edited stylesheet was not saved beside the original');
    return 'picture and edited stylesheet paths rebased; original stylesheet untouched';
  });

  await check('editor picture tools: copy, crop, rotate, burn a watermark', async () => {
    const W = require(path.join(__dirname, '..', 'src', 'main', 'webedit')), sharp = require('sharp');
    const outside = path.join(OUT, 'outside.png');
    await sharp({ create: { width: 200, height: 100, channels: 3, background: '#2f7fe0' } }).png().toFile(outside);
    const copied = await W.copyInto(outside, site), again = await W.copyInto(outside, site);
    ok(copied === path.join(site, 'images', 'outside.png') && again === path.join(site, 'images', 'outside-2.png'), `copies: ${copied}, ${again}`);
    ok((await W.copyInto(copied, site)) === copied, 'a picture already in the site was copied again');
    const crop = await W.imageOp(copied, 'crop', { x: 0.5, y: 0, w: 0.5, h: 1 }), rot = await W.imageOp(copied, 'rotate', { angle: 90 });
    const [cm, rm] = [await sharp(crop).metadata(), await sharp(rot).metadata()];
    ok(cm.width === 100 && cm.height === 100 && rm.width === 100 && rm.height === 200, `crop ${cm.width}×${cm.height}, rotate ${rm.width}×${rm.height}`);
    const burned = await W.burnWatermark(copied, { kind: 'text', text: 'DRAFT', opacity: 60, position: 'centre', color: '#ffffff' });
    const [a, b] = [await sharp(copied).raw().toBuffer(), await sharp(burned).removeAlpha().raw().toBuffer()];
    let diff = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff += Math.abs(a[i] - b[i]);
    ok(path.basename(burned) === 'outside-watermarked.png' && diff > 1000, `burned ${path.basename(burned)}, difference ${diff}`);
    const hits = await W.siteFind(site, { find: 'cabins', textOnly: true });
    ok(hits.length >= 2 && hits.every((x) => !/class=/.test(x.snippet) || x.snippet.includes('cabins')), JSON.stringify(hits));
    return `copied into images/ (outside-2.png the second time), cropped to 100×100, turned to 100×200, ${path.basename(burned)}; site search found ${hits.length}`;
  });

  return results;
};
