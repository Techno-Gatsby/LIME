'use strict';
// Whiteboard, draw.io, Mermaid and translation. The draw.io and translation payloads ship inside the installer;
// a checkout without them (point LIME_DIAGRAMS and LIME_TRANSLATE at built copies) skips those checks.
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) throw new Error(m); };
const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;

const el = (id, type, x, y, w, h, extra = {}) => ({ id, type, x, y, width: w, height: h, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 7, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...extra });
const SCENE = {
  type: 'excalidraw', version: 2, source: 'https://lime.app',
  elements: [
    el('box', 'rectangle', 80, 80, 220, 110, { backgroundColor: '#a5d8ff', roundness: { type: 3 }, boundElements: [{ id: 'lbl', type: 'text' }] }),
    el('lbl', 'text', 120, 118, 140, 35, { text: 'Plan the trip', originalText: 'Plan the trip', fontSize: 28, fontFamily: 5, textAlign: 'center', verticalAlign: 'middle', containerId: 'box', lineHeight: 1.25, autoResize: true }),
    el('oval', 'ellipse', 420, 90, 160, 90, { backgroundColor: '#b2f2bb' }),
    el('go', 'arrow', 310, 135, 100, 0, { points: [[0, 0], [100, 0]], startArrowhead: null, endArrowhead: 'arrow', lastCommittedPoint: null, startBinding: null, endBinding: null }),
    el('note', 'text', 400, 220, 220, 25, { text: 'Lime whiteboard', originalText: 'Lime whiteboard', fontSize: 20, fontFamily: 5, textAlign: 'left', verticalAlign: 'top', containerId: null, lineHeight: 1.25, autoResize: true }),
  ],
  appState: { viewBackgroundColor: '#ffffff', gridSize: 20 }, files: {},
};
const DRAWIO = `<mxfile><diagram id="p1" name="Flow"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10"><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" value="Start here" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="140" height="60" as="geometry"/></mxCell>
<mxCell id="b" value="Finish line" style="ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;" vertex="1" parent="1"><mxGeometry x="280" y="40" width="140" height="60" as="geometry"/></mxCell>
<mxCell id="c" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram><diagram id="p2" name="Second page"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="d" value="Page two box" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="160" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
const MERMAID = 'flowchart TD\n  A[Order placed] --> B{In stock?}\n  B -- Yes --> C[Ship parcel]\n  B -- No --> D[Tell customer]';
const MD = `# Notes\n\nSome text.\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n\nMore text.\n\n\`\`\`mermaid\nsequenceDiagram\n  Alice->>Bob: Hello Bob\n  Bob-->>Alice: Hi Alice\n\`\`\`\n`;
const SRT = '1\n00:00:01,000 --> 00:00:03,500\nThe cat is sleeping on the red chair.\n\n2\n00:00:04,000 --> 00:00:06,250\nI would like to buy\na new house.\n\n3\n00:01:10,040 --> 00:01:12,900\nThe weather is beautiful today.\n';
const VTT = 'WEBVTT\n\nNOTE made by Lime\n\nintro\n00:00:01.000 --> 00:00:03.500 align:center\nThe cat is sleeping on the red chair.\n\n00:00:04.000 --> 00:00:06.250\n<i>I would like to buy a new house.</i>\n';
function docx(file) {
  const { zipSync, strToU8 } = require('fflate');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>The weather today</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">The cat is sleeping on the </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>red</w:t></w:r><w:r><w:t xml:space="preserve"> chair.</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>I would like to buy a new house.</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>The weather is beautiful today.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr/></w:body></w:document>`;
  fs.writeFileSync(file, zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(doc),
  }));
}
function fixtures(out) {
  fs.mkdirSync(out, { recursive: true });
  const f = (n, s) => { const p = path.join(out, n); fs.writeFileSync(p, s); return p; };
  const docxFile = path.join(out, 'letter.docx');
  docx(docxFile);
  return {
    board: f('trip.excalidraw', JSON.stringify(SCENE, null, 1)), drawio: f('flow.drawio', DRAWIO), mmd: f('order.mmd', MERMAID), md: f('notes.md', MD),
    srt: f('film.srt', SRT), vtt: f('film.vtt', VTT), txt: f('note.txt', 'The cat is sleeping on the red chair.\n\nI would like to buy a new house.\n'), docx: docxFile,
  };
}
const pngText = (buf) => { const out = []; for (let i = 8; i < buf.length;) { const n = buf.readUInt32BE(i), t = buf.toString('latin1', i + 4, i + 8); if (t === 'tEXt' || t === 'iTXt') out.push(buf.toString('latin1', i + 8, i + 8 + n)); i += 12 + n; } return out.join('\n'); };
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

module.exports = async ({ submit, jobs, dir }) => {
  const OUT = path.join(dir, 'diagrams'), results = [];
  fs.rmSync(OUT, { recursive: true, force: true });
  const F = fixtures(path.join(OUT, 'in'));
  const check = async (name, fn) => {
    name = `diagrams: ${name}`;
    if (only && !only.test(name)) return;
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { if (e.skip) { status = 'SKIP'; detail = e.message; } else { status = 'FAIL'; detail = e.message; } }
    console.log(`${status} ${name.padEnd(40)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 260));
    results.push({ name, status, detail });
  };
  const skip = (m) => Object.assign(new Error(m), { skip: true });
  const run = async (tool, files, opts = {}) => {
    const d = path.join(OUT, `${tool}-${results.length}-${Date.now() % 100000}`);
    fs.mkdirSync(d, { recursive: true });
    const id = submit({ tool, files, opts, dest: { kind: 'dir', path: d } });
    let j;
    for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(100); }
    ok(j.status === 'done', `${tool}: ${j.status}: ${j.error}`);
    return j.results[0];
  };
  const tools = require('../src/main/tools');
  const D = require('../src/main/diagrams');
  const T = require('../src/main/engines/translate');

  await check('Mermaid file to SVG has the node labels', async () => {
    const r = await run('mermaid-export', [F.mmd], { to: 'svg' });
    const svg = fs.readFileSync(r.path, 'utf8'), words = svg.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    for (const w of ['Order placed', 'In stock?', 'Ship parcel', 'Tell customer']) ok(words.includes(w), `"${w}" missing from the SVG text: ${words.slice(0, 200)}`);
    ok(/^<\?xml[\s\S]*<svg/.test(svg) && !/<foreignObject/.test(svg), 'labels should be SVG text');
    return `${path.basename(r.path)} ${Math.round(svg.length / 1024)} KB`;
  });
  await check('Markdown with two diagrams to PNG', async () => {
    const r = await run('mermaid-export', [F.md], { to: 'png' });
    const files = fs.readdirSync(r.path).sort();
    ok(files.length === 2 && files.every((f) => f.endsWith('.png')), `got ${files.join(', ')}`);
    const sizes = files.map((f) => pngSize(fs.readFileSync(path.join(r.path, f))));
    ok(sizes.every((s) => s.width > 100 && s.height > 50), JSON.stringify(sizes));
    const stats = await require('sharp')(path.join(r.path, files[0])).stats();
    ok(stats.channels.slice(0, 3).some((c) => c.min < 120), 'the picture looks blank');
    return `${files.join(', ')} ${sizes.map((s) => `${s.width}×${s.height}`).join(', ')}`;
  });
  await check('wheel slices for diagrams and translation', async () => {
    const w = tools.wheelsFor([F.mmd]), names = [...w.convert, ...w.tools].map((x) => `${x.tool}:${x.label}`);
    ok(names.includes('mermaid-export:SVG'), names.join(' '));
    ok(tools.wheelsFor([F.board]).tools.some((x) => x.tool === 'edit-board'), 'no whiteboard slice for .excalidraw');
    ok(tools.wheelsFor([F.md]).tools.some((x) => x.tool === 'mermaid-export'), 'no diagrams slice for .md');
    if (T.available()) ok(tools.wheelsFor([F.srt]).tools.some((x) => x.tool === 'translate'), 'no translate slice for .srt');
    return names.join(', ');
  });

  const drawio = D.hasDrawio();
  for (const [to, test] of [['png', (buf) => { const s = pngSize(buf); ok(buf.slice(1, 4).toString() === 'PNG' && s.width > 300, `png ${JSON.stringify(s)}`); return `${s.width}×${s.height}`; }],
    ['svg', (buf) => { const s = buf.toString('utf8'); ok(/<svg/.test(s) && s.includes('Start here') && s.includes('Finish line'), 'labels missing from SVG'); return `${Math.round(buf.length / 1024)} KB`; }],
    ['pdf', (buf) => { ok(buf.slice(0, 5).toString() === '%PDF-', 'not a PDF'); const n = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length; ok(n === 2, `${n} pages, expected 2`); return `${n} pages, ${Math.round(buf.length / 1024)} KB`; }]]) {
    await check(`draw.io diagram to ${to.toUpperCase()}`, async () => {
      if (!drawio) throw skip('draw.io is not bundled here (LIME_DIAGRAMS)');
      const r = await run('diagram-export', [F.drawio], { to });
      if (to === 'pdf') return test(fs.readFileSync(r.path));
      const files = fs.readdirSync(r.path).sort();
      ok(files.length === 2, `expected a file per page, got ${files.join(', ')}`);
      return `${files.join(', ')}: ${test(fs.readFileSync(path.join(r.path, files[0])))}`;
    });
  }

  const tr = async (name, fn) => check(`translate ${name}`, async () => { if (!T.available()) throw skip('the translation models are not bundled here (LIME_TRANSLATE)'); return fn(); });
  await tr('English to German keeps the meaning', async () => {
    const r = await run('translate', [F.txt], { to: 'de' });
    const s = fs.readFileSync(r.path, 'utf8');
    for (const w of [/Katze/, /Stuhl/, /Haus/]) ok(w.test(s), `${w} not in: ${s}`);
    ok(path.basename(r.path) === 'note-de.txt', path.basename(r.path));
    return s.replace(/\n+/g, ' / ').trim();
  });
  await tr('English to French subtitles keep their timings', async () => {
    const r = await run('translate', [F.srt], { to: 'fr' });
    const s = fs.readFileSync(r.path, 'utf8'), times = (t) => t.split('\n').filter((l) => /-->/.test(l) || /^\d+$/.test(l));
    ok(JSON.stringify(times(s)) === JSON.stringify(times(SRT)), `timings changed:\n${times(s).join('\n')}`);
    for (const w of [/chat/i, /chaise/i, /maison/i]) ok(w.test(s), `${w} not in: ${s}`);
    return s.split('\n').filter((l) => l && !/-->|^\d+$/.test(l)).join(' / ');
  });
  await tr('WebVTT to Spanish keeps cue settings and italics', async () => {
    const r = await run('translate', [F.vtt], { to: 'es' });
    const s = fs.readFileSync(r.path, 'utf8');
    ok(s.startsWith('WEBVTT') && s.includes('NOTE made by Lime') && s.includes('00:00:01.000 --> 00:00:03.500 align:center') && s.includes('\nintro\n'), s);
    ok(/<i>[^<]*casa[^<]*<\/i>/i.test(s) && /gato/i.test(s), s);
    return s.split('\n').slice(-1)[0] || s.split('\n').slice(-2)[0];
  });
  await tr('Word keeps bold and italic runs', async () => {
    const r = await run('translate', [F.docx], { to: 'de' });
    const { unzipSync, strFromU8 } = require('fflate');
    const x = strFromU8(unzipSync(fs.readFileSync(r.path))['word/document.xml']);
    const text = [...x.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
    for (const w of [/Katze/, /Haus/, /Wetter/]) ok(w.test(text), `${w} not in: ${text}`);
    ok(/<w:b\/><\/w:rPr><w:t[^>]*>[^<]*rot/i.test(x), `the bold run lost "rot": ${x.slice(0, 900)}`);
    ok(/<w:i\/><\/w:rPr><w:t[^>]*>[^<]*Haus/.test(x), 'the italic run lost its words');
    ok(/<w:pStyle w:val="Heading1"\/>/.test(x) && /<w:tbl>/.test(x), 'paragraph style or table lost');
    return text;
  });
  await tr('pivots German to French through English, and detects the language', async () => {
    const de = path.join(OUT, 'in', 'brief.txt');
    fs.writeFileSync(de, 'Die Katze schläft auf dem roten Stuhl.\n');
    const r = await run('translate', [de], { to: 'fr' });
    const s = fs.readFileSync(r.path, 'utf8');
    ok(/chat/i.test(s) && /chaise/i.test(s) && r.note === 'German → French', `${s} (${r.note})`);
    ok(T.detect('Die Katze schläft und der Hund ist nicht hier.') === 'de' && T.detect('مرحبا بكم في البيت') === 'ar' && T.detect('नमस्ते दुनिया') === 'hi', 'language detection');
    return s;
  });
  return results;
};

// Inputs for the option sweep in tools.test.js, written beside the shared fixtures.
module.exports.sweep = (FX) => {
  const F = fixtures(path.join(FX, 'diagrams-sweep')), rel = (p) => path.relative(FX, p);
  return {
    inputs: { 'mermaid-export': [[rel(F.md)]], 'diagram-export': [[rel(F.drawio)]], translate: [[rel(F.txt)], { to: 'de' }] },
    refuse: { 'translate to=en': /already looks like English/, 'translate from=de': /already looks like German/ },
  };
};

// Editor checks, run from the UI suite.
module.exports.ui = async ({ openEditor, editors, dir }) => {
  const OUT = path.join(dir, 'diagrams-ui'), results = [];
  fs.rmSync(OUT, { recursive: true, force: true });
  const F = fixtures(OUT);
  const check = async (name, fn) => {
    name = `edit diagrams · ${name}`;
    if (only && !only.test(name)) return;
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { if (e.skip) { status = 'SKIP'; detail = e.message; } else { status = 'FAIL'; detail = e.message; } }
    console.log(`${status} ${name.padEnd(44)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 260));
    results.push({ name, status, detail });
  };
  const open = async (file, mode, ready) => {
    openEditor(file, mode);
    const win = [...editors].pop(), wc = win.webContents;
    while (wc.isLoading()) await sleep(200);
    const ejs = (code) => wc.executeJavaScript(`(async () => { ${code} })()`, true);
    const t = Date.now();
    while (Date.now() - t < 30000 && !(await ejs(`return !!(${ready})`).catch(() => false))) await sleep(200);
    ok(await ejs(`return !!(${ready})`), `${mode} editor did not open`);
    return { win, ejs };
  };
  await check('whiteboard opens, exports SVG and PNG with the scene inside, and saves', async () => {
    const { win, ejs } = await open(F.board, 'board', 'window.__board?.st.ready');
    const n = await ejs('return window.__board.api().getSceneElements().length');
    ok(n === 5, `${n} elements on the board`);
    const svgOut = path.join(OUT, 'trip.svg'), pngOut = path.join(OUT, 'trip.png');
    await ejs(`const B = window.__board; await window.lime.invoke('edit:call', 'diagram', 'write', ${JSON.stringify(svgOut)}, await B.picture('svg')); await window.lime.invoke('edit:call', 'diagram', 'write', ${JSON.stringify(pngOut)}, await B.picture('png'));`);
    const svg = fs.readFileSync(svgOut, 'utf8');
    ok(svg.includes('payload-type:application/vnd.excalidraw+json') && svg.includes('Plan the trip') && svg.includes('Lime whiteboard'), 'SVG lacks the scene or the words');
    const png = fs.readFileSync(pngOut), s = pngSize(png);
    ok(/application\/vnd\.excalidraw\+json/.test(pngText(png)), 'PNG has no scene inside');
    ok(s.width > 800 && s.height > 300, `PNG ${s.width}×${s.height}`);
    const back = await ejs(`const r = await window.__board.api(); const x = await (await import('./vendor/diagram/whiteboard.js')).loadFromBlob(new Blob([await (await fetch(${JSON.stringify(`media://file/${pngOut.replace(/\\/g, '/')}`)})).arrayBuffer()], { type: 'image/png' }), null, null); return x.elements.length;`);
    ok(back === 5, `the PNG opened again with ${back} elements`);
    await ejs('const a = window.__board.api(); a.updateScene({ elements: [...a.getSceneElements(), { ...a.getSceneElements()[2], id: "copy", x: 700, version: 2 }] });');
    await sleep(900);
    ok(await ejs('return window.__board.dirty() && !document.querySelector(".dirty").hidden'), 'no Unsaved mark after a change');
    ok(await ejs('return window.__board.st.hist.length >= 2'), 'history did not record the change');
    await ejs('document.querySelector("[data-a=save]").click()');
    const saved = path.join(OUT, 'trip (edited).excalidraw');
    const t = Date.now();
    while (!fs.existsSync(saved) && Date.now() - t < 8000) await sleep(150);
    const j = JSON.parse(fs.readFileSync(saved, 'utf8'));
    ok(j.type === 'excalidraw' && j.elements.filter((e) => !e.isDeleted).length === 6, `saved ${j.elements.length} elements`);
    ok(fs.readFileSync(F.board, 'utf8') === JSON.stringify(SCENE, null, 1), 'the original changed');
    ok(await ejs('return document.querySelector(".dirty").hidden'), 'still Unsaved after saving');
    await ejs('document.documentElement.dataset.theme = "dark"');
    await sleep(400);
    ok(await ejs('return !!document.querySelector(".excalidraw.theme--dark")'), 'the board did not turn dark');
    await ejs('document.documentElement.dataset.theme = "light"');
    await ejs('document.querySelector("[data-a=help]").click()');
    ok(await ejs('return /Box/.test(document.querySelector(".scrim.keys")?.textContent || "")'), 'no keys dialog');
    await ejs('document.querySelector(".scrim.keys [data-a=ok]").click()');
    win.closing = true;
    win.destroy();
    return `SVG ${Math.round(svg.length / 1024)} KB, PNG ${s.width}×${s.height}, saved ${path.basename(saved)}`;
  });
  await check('draw.io opens a diagram and saves it as (edited)', async () => {
    if (!require('../src/main/diagrams').hasDrawio()) throw Object.assign(new Error('draw.io is not bundled here'), { skip: true });
    const { win, ejs } = await open(F.drawio, 'drawio', 'window.__drawio?.st.ready');
    const labels = await ejs('return [...document.querySelector("iframe").contentDocument.querySelectorAll(".geDiagramContainer svg")].map((s) => s.textContent).join(" ")');
    ok(/Start here/.test(labels) && /Finish line/.test(labels), `labels: ${labels.slice(0, 200)}`);
    await ejs('const ui = window.__drawio.ui(), g = ui.editor.graph; g.getModel().beginUpdate(); try { g.insertVertex(g.getDefaultParent(), null, "Added by Lime", 40, 160, 140, 50); } finally { g.getModel().endUpdate(); }');
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && !(await ejs('return window.__drawio.dirty()'))) await sleep(150);
    ok(await ejs('return !document.querySelector(".dirty").hidden && !document.querySelector("[data-a=undo]").disabled'), 'no Unsaved mark or undo after a change');
    await ejs('return window.__drawio.save(false)');
    const saved = path.join(OUT, 'flow (edited).drawio');
    ok(fs.existsSync(saved) && /Added by Lime/.test(fs.readFileSync(saved, 'utf8')), 'saved diagram lacks the new shape');
    const png = await ejs('return (await window.__drawio.picture("png")).length');
    ok(png > 2000, `PNG export ${png} bytes`);
    win.closing = true;
    win.destroy();
    return `saved ${path.basename(saved)}, PNG ${Math.round(png / 1024)} KB`;
  });
  await check('WebCraft draws a Mermaid Diagram block into the page', async () => {
    const page = path.join(OUT, 'site.html');
    fs.writeFileSync(page, '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Flow</title></head><body><h1>How it works</h1><p>Read on.</p></body></html>');
    const { win, ejs } = await open(page, 'web', 'window.__web?.st.ready');
    await ejs('const g = window.__web.gjs(); g.getWrapper().find("h1")[0].parent().append({ type: "lime-diagram" });');
    const t = Date.now();
    while (Date.now() - t < 15000 && !(await ejs('return !!window.__web.gjs().getWrapper().find("figure[data-mermaid] img")[0]'))) await sleep(200);
    const src = await ejs('return window.__web.gjs().getWrapper().find("figure[data-mermaid] img")[0]?.getAttributes().src || ""');
    ok(src.startsWith('data:image/svg+xml;base64,'), `no drawn picture: ${src.slice(0, 60)}`);
    const svg = Buffer.from(src.slice(26), 'base64').toString('utf8');
    ok(/Worth doing/.test(svg.replace(/<[^>]+>/g, '')), 'the picture lacks the diagram text');
    await ejs('window.__web.flush(); return window.__web.save(false)');
    const saved = path.join(OUT, 'site (edited).html');
    ok(fs.existsSync(saved) && /<figure[^>]*data-mermaid="flowchart LR/.test(fs.readFileSync(saved, 'utf8')) && /<img alt="Diagram" src="data:image\/svg\+xml;base64,/.test(fs.readFileSync(saved, 'utf8')), 'the saved page lacks the diagram');
    win.closing = true;
    win.destroy();
    return `drawn ${Math.round(svg.length / 1024)} KB SVG, saved in ${path.basename(saved)}`;
  });
  return results;
};

// Screenshots of the whiteboard in light and dark, for checking by eye.
module.exports.shots = async ({ openEditor, BrowserWindow, shot, dir }) => {
  const F = fixtures(path.join(dir, 'diagrams-in'));
  const show = async (file, mode, ready, names) => {
    openEditor(file, mode);
    let e = null;
    for (let t = 0; t < 40 && !e; t++) { await sleep(250); e = BrowserWindow.getAllWindows().find((x) => x.editorData?.file === file && !x.webContents.isLoading()); }
    if (!e) return;
    e.setSize(1280, 820);
    const ejs = (code) => e.webContents.executeJavaScript(`(async () => { ${code} })()`, true).catch((er) => console.error('diagram step failed:', er.message));
    for (let t = 0; t < 120 && !(await e.webContents.executeJavaScript(`!!(${ready})`).catch(() => false)); t++) await sleep(250);
    await sleep(1500);
    await names(ejs, (n) => shot(n, e));
    e.closing = true;
    e.destroy();
  };
  await show(F.board, 'board', 'window.__board?.st.ready', async (ejs, s) => {
    await ejs('document.documentElement.dataset.theme = "light"');
    await s('d1-board-light');
    await ejs('document.querySelector("[data-a=export]").click()');
    await s('d2-board-export');
    await ejs('document.querySelector(".bd-export")?.remove(); document.documentElement.dataset.theme = "dark"');
    await sleep(500);
    await s('d3-board-dark');
    await ejs('document.querySelector("[data-a=help]").click()');
    await s('d4-board-keys');
  });
  if (require('../src/main/diagrams').hasDrawio()) {
    await show(F.drawio, 'drawio', 'window.__drawio?.st.ready', async (ejs, s) => {
      await ejs('document.documentElement.dataset.theme = "light"');
      await sleep(800);
      await s('d5-drawio-light');
      await ejs('document.documentElement.dataset.theme = "dark"');
      await sleep(800);
      await s('d6-drawio-dark');
    });
  }
};
