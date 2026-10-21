'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

module.exports = async ({ submit, jobs, tools, dir }) => {
  const FX = process.env.LIME_FX, fx = (f) => path.join(FX, f);
  const OUT = path.join(dir, 'apps2');
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;
  const E = (n) => require(path.join(__dirname, '..', 'src', 'main', 'engines', n));
  const U = E('util'), crafts = E('crafts');
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const near = (a, b, tol, what) => ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const unzip = (f) => require('fflate').unzipSync(new Uint8Array(fs.readFileSync(f)));
  const has = new Set(crafts.status().filter((c) => c.bundled).map((c) => c.id));
  const results = [];
  const check = async (name, app, fn) => {
    name = `apps: ${name}`;
    if (only && !only.test(name)) return;
    if (app && !has.has(app)) { console.log(`SKIP ${name.padEnd(34)} no ${crafts.APPS[app].name} engine on this platform`); results.push({ name, status: 'SKIP', detail: `no ${app}` }); return; }
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { status = 'FAIL'; detail = e.message; }
    console.log(`${status} ${name.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 240));
    results.push({ name, status, detail });
  };
  let n = 0;
  const run = async (tool, files, opts = {}) => {
    const d = path.join(OUT, `${String(++n).padStart(2, '0')}-${tool}`);
    fs.mkdirSync(d, { recursive: true });
    const t = tools.get(tool), all = { ...Object.fromEntries((t.options || []).map((o) => [o.key, o.default])), ...opts };
    const id = submit({ tool, files, opts: all, dest: { kind: 'dir', path: d } });
    let j;
    for (const t0 = Date.now(); ; ) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; if (Date.now() - t0 > 300000) throw new Error(`${tool}: timeout`); await sleep(100); }
    ok(j.status === 'done', `${tool}: ${j.status}: ${j.error}`);
    return { outs: j.results.flatMap((r) => r.paths || (r.path ? [r.path] : [])), notes: j.results.map((r) => r.note || ''), texts: j.results.map((r) => r.text || '') };
  };
  const pdfText = async (file) => { const { doc } = await E('pdf').readPdf(file); let t = ''; for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText('').asText(); return { text: t, pages: doc.countPages() }; };
  const integrated = async (file) => {
    const out = await new Promise((res) => { const p = require('child_process').spawn(U.binPath('ffmpeg'), ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-']); let s = ''; p.stderr.on('data', (d) => { s += d; }); p.on('close', () => res(s)); });
    const m = /Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(out);
    return m ? Number(m[1]) : NaN;
  };
  const duration = async (file) => (await E('media').probe(file)).duration;

  await check('every new app has its tools and opens its files', null, async () => {
    const ids = ['cadcraft', 'soundcraft', 'wordcraft', 'gridcraft', 'deckcraft'];
    const by = Object.fromEntries(ids.map((id) => [id, tools.TOOLS.filter((t) => t.craft === id).sort((a, b) => a.prio - b.prio).map((t) => t.id)]));
    for (const id of ids) ok(crafts.APPS[id] && by[id].length >= 3, `${id}: ${by[id]}`);
    ok(crafts.appsFor([fx('test.dxf')])[0] === 'cadcraft', `DXF opens in ${crafts.appsFor([fx('test.dxf')])}`);
    ok(crafts.appsFor([fx('song.mp3')])[0] === 'soundcraft', 'MP3 is not SoundCraft');
    ok(crafts.appsFor([fx('doc.docx')])[0] === 'wordcraft' && crafts.appsFor([fx('book.xlsx')])[0] === 'gridcraft' && crafts.appsFor([fx('deck.pptx')])[0] === 'deckcraft', 'Office files do not open in their apps');
    const names = tools.TOOLS.filter((t) => ids.includes(t.craft)).map((t) => t.name);
    ok(!names.some((x) => /sanitize|bates|overkill|purge|audit|lufs/i.test(x)), `jargon in ${names}`);
    ok(tools.wheelsFor([fx('test.dxf')]).convert.some((w) => w.tool === 'cad-dwg'), 'no DWG on the drawing ring');
    return ids.map((id) => `${crafts.APPS[id].name}: ${by[id].join(', ')}`).join(' · ');
  });

  await check('CADCraft saves DWG that reads back', 'cadcraft', async () => {
    const { outs: [dwg] } = await run('cad-dwg', [fx('test.dxf')]);
    ok(/\.dwg$/.test(dwg) && fs.readFileSync(dwg).toString('latin1', 0, 6) === 'AC1032', `${path.basename(dwg)} is not DWG 2018`);
    const back = await E('cad').info(dwg), src = await E('cad').info(fx('test.dxf'));
    ok(back.entities === src.entities && Math.abs(back.width - src.width) < 0.01, `read back ${back.entities} objects ${back.width}×${back.height}, not ${src.entities}`);
    const { outs: [old] } = await run('cad-dwg', [fx('sample_2018.dwg')], { version: '2000' });
    ok(/-2000\.dwg$/.test(old) && fs.readFileSync(old).toString('latin1', 0, 6) === 'AC1015', `${path.basename(old)} is not DWG 2000`);
    ok((await E('cad').info(old)).entities === (await E('cad').info(fx('sample_2018.dwg'))).entities, 'the 2000 copy lost objects');
    return `${back.entities} objects through DWG 2018; ${path.basename(old)} is AC1015`;
  });
  await check('CADCraft cleans up, prints sheets and counts blocks', 'cadcraft', async () => {
    const { outs: [clean], notes: [cn] } = await run('cad-clean', [fx('layers.dxf')]);
    ok(/-clean\.dxf$/.test(clean) && /SECTION[\s\S]*EOF/.test(fs.readFileSync(clean, 'latin1')), `clean: ${clean}`);
    const { outs: [pdf], notes: [sn] } = await run('cad-sheets', [fx('paper.dxf')]);
    const p = await pdfText(pdf);
    ok(p.pages === 2 && /2 sheets/.test(sn), `${p.pages} pages, ${sn}`);
    const { outs: [csv], notes: [bn] } = await run('cad-blocks', [fx('layers.dxf')]);
    ok(/^Count,Name\r?\n3,BLK/.test(fs.readFileSync(csv, 'utf8')) && /3 blocks/.test(bn), `${fs.readFileSync(csv, 'utf8')} / ${bn}`);
    const { notes: [ln], texts: [lt] } = await run('cad-layers', [fx('sample_2018.dwg')]);
    ok(/Tavolo 1/.test(lt) && /3 layers/.test(ln), `${ln} / ${lt}`);
    const { notes: [dn] } = await run('cad-compare', [fx('test.dxf'), fx('lines.dxf')]);
    ok(/3 added, 12 removed/.test(dn), dn);
    return `${cn} · ${sn} · ${bn} · ${ln} · ${dn}`;
  });

  await check('SoundCraft masters to the loudness asked', 'soundcraft', async () => {
    const { outs: [mp3], notes: [note] } = await run('master-audio', [fx('song.mp3')], { loudness: '-14' });
    ok(/-mastered\.mp3$/.test(mp3), mp3);
    const l = await integrated(mp3);
    near(l, -14, 1.5, 'loudness');
    near(await duration(mp3), await duration(fx('song.mp3')), 0.15, 'length');
    const { outs: [wav] } = await run('master-audio', [fx('tone.wav')], { loudness: '-23' });
    near(await integrated(wav), -23, 1.5, 'broadcast loudness');
    return `${note}; measured ${l} LUFS`;
  });
  await check('SoundCraft polishes a voice, adds reverb and mixes', 'soundcraft', async () => {
    const { outs: [v] } = await run('polish-voice', [fx('ramp.wav')]);
    ok(/-voice\.wav$/.test(v), v);
    near(await duration(v), await duration(fx('ramp.wav')), 0.15, 'voice length');
    const { outs: [r] } = await run('add-reverb', [fx('tone.wav')], { space: 'hall', amount: 40 });
    ok(/-reverb\.wav$/.test(r) && (await duration(r)) >= (await duration(fx('tone.wav'))) - 0.05, r);
    const { outs: [m] } = await run('mix-tracks', [fx('tone.wav'), fx('song.mp3')]);
    near(await duration(m), Math.max(await duration(fx('tone.wav')), await duration(fx('song.mp3'))), 0.2, 'mix length');
    near(await integrated(m), -14, 1.5, 'mix loudness');
    return [v, r, m].map((f) => path.basename(f)).join(', ');
  });

  await check('SoundCraft sessions export a mix and stems', 'soundcraft', async () => {
    const session = path.join(OUT, 'band.scraft');
    execFileSync(await crafts.cli('soundcraft'), ['run', '--cmd', `file.import_audio=${JSON.stringify({ paths: [fx('tone.wav'), fx('song.mp3')] })}`, '--save', session], { stdio: 'ignore' });
    const { outs: [mix] } = await run('session-mix', [session]);
    ok(/band\.wav$/.test(mix), mix);
    near(await duration(mix), 3, 0.2, 'mix length');
    const { outs: [stems], notes: [sn] } = await run('session-stems', [session]);
    const wavs = fs.readdirSync(stems).filter((f) => f.endsWith('.wav'));
    ok(wavs.length === 2 && /2 stems/.test(sn), `stems ${wavs} / ${sn}`);
    return `${path.basename(mix)} and ${wavs.join(', ')}`;
  });
  await check('WordCraft prints comments, adds contents and locks', 'wordcraft', async () => {
    const { outs: [pdf] } = await run('doc-markup', [fx('tracked.docx')]);
    const t = await pdfText(pdf);
    ok(/Please check/.test(t.text) && /Ana Author/.test(t.text), `markup text: ${t.text.slice(0, 200)}`);
    const { outs: [toc] } = await run('doc-contents', [fx('chapters.docx')]);
    const xml = Buffer.from(unzip(toc)['word/document.xml']).toString('utf8');
    ok(/TOC \\/.test(xml) && /Contents/.test(xml) && xml.indexOf('Contents') < xml.indexOf('Preface'), 'no contents at the start');
    const { outs: [locked] } = await run('doc-password', [fx('doc.docx')], { password: 'lime123' });
    ok(fs.readFileSync(locked).toString('hex', 0, 8) === 'd0cf11e0a1b11ae1', 'not an encrypted Word file');
    const { outs: [up] } = await run('doc-upgrade', [fx('doc.rtf')]);
    ok(unzip(up)['word/document.xml'], 'not DOCX');
    const { outs: [pages], notes: [pn] } = await run('doc-pages', [fx('letter.docx')]);
    const pngs = fs.readdirSync(pages).filter((f) => f.endsWith('.png'));
    ok(pngs.length >= 1 && (await require('sharp')(path.join(pages, pngs[0])).metadata()).width > 1000, `pages ${pngs}`);
    return `comments in the margin, contents first, locked as CFB, RTF to DOCX, ${pn}`;
  });

  await check('GridCraft adds a chart and a table, and checks formulas', 'gridcraft', async () => {
    const { outs: [c] } = await run('sheet-chart', [fx('sheet.xlsx')]);
    const z = unzip(c), chart = Object.keys(z).find((k) => /^xl\/charts\/chart\d+\.xml$/.test(k));
    ok(chart && /barChart|lineChart/.test(Buffer.from(z[chart]).toString('utf8')) && /sheet/.test(Buffer.from(z[chart]).toString('utf8')), `no chart: ${Object.keys(z)}`);
    const { outs: [t], notes: [tn] } = await run('sheet-table', [fx('people.csv')]);
    ok(Object.keys(unzip(t)).some((k) => /^xl\/tables\/table\d+\.xml$/.test(k)) && /A1:/.test(tn), `no table: ${tn}`);
    const { notes: [rn] } = await run('sheet-recalc', [fx('book.xlsx')]);
    ok(/8 formulas/.test(rn), rn);
    const { notes: [kn] } = await run('sheet-check', [fx('book.xlsx')]);
    ok(/All 8 formulas add up/.test(kn), kn);
    return `${tn} · ${rn} · ${kn}`;
  });

  await check('DeckCraft makes slides from notes and a GIF', 'deckcraft', async () => {
    const md = path.join(OUT, 'plan.md');
    fs.writeFileSync(md, '# Quarterly plan\n- Grow sales\n- Hire two people\n\n# Budget\n- Travel\n- Tools\n');
    const { outs: [pptx] } = await run('make-slides', [md], { theme: 'Harbor' });
    const z = unzip(pptx), slides = Object.keys(z).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    ok(slides.length === 2, `${slides.length} slides`);
    ok(/Quarterly plan/.test(Buffer.from(z['ppt/slides/slide1.xml']).toString('utf8')) && /Hire two people/.test(Buffer.from(z['ppt/slides/slide1.xml']).toString('utf8')), 'slide 1 text');
    const { outs: [gif] } = await run('slides-gif', [fx('deck.pptx')], { seconds: 2 });
    const m = await require('sharp')(gif, { animated: true }).metadata();
    const count = Object.keys(unzip(fx('deck.pptx'))).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).length;
    ok(m.format === 'gif' && m.pages === count, `${m.pages} frames for ${count} slides`);
    const { outs: [g] } = await run('slide-graphics', [fx('deck2.pptx')]);
    const pngs = fs.readdirSync(g).filter((f) => f.endsWith('.png'));
    ok(pngs.length >= 1 && (await require('sharp')(path.join(g, pngs[0])).metadata()).hasAlpha, `graphics ${pngs}`);
    return `2 slides from notes, ${m.pages}-frame GIF, ${pngs.length} see-through slides`;
  });

  return results;
};
