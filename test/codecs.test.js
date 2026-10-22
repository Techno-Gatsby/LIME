'use strict';
// GIFs (gifski), PNG (oxipng), PDF (qpdf, Ghostscript), photo info (exifr, piexifjs) and QR codes (ZXing, bwip-js).
const fs = require('fs');
const path = require('path');

module.exports = async ({ submit, jobs, dir }) => {
  const FX = process.env.LIME_FX, fx = (f) => path.join(FX, f);
  const OUT = path.join(dir, 'codecs');
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;
  const E = (n) => require(path.join(__dirname, '..', 'src', 'main', 'engines', n));
  const sharp = require('sharp');
  // The codec packages resolve from the engines, as the app loads them.
  const dep = (n) => require(require.resolve(n, { paths: [path.join(__dirname, '..', 'src', 'main', 'engines')] }));
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = async (name, need, fn) => {
    name = `codecs: ${name}`;
    if (only && !only.test(name)) return;
    const why = need && need();
    if (why) { console.log(`SKIP ${name.padEnd(44)} ${why}`); results.push({ name, status: 'SKIP', detail: why }); return; }
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { status = 'FAIL'; detail = e.message; }
    console.log(`${status} ${name.padEnd(44)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 300));
    results.push({ name, status, detail });
  };
  let n = 0;
  const run = async (tool, files, opts = {}, { fail } = {}) => {
    const d = path.join(OUT, `${String(++n).padStart(2, '0')}-${tool}`);
    fs.mkdirSync(d, { recursive: true });
    const t = require(path.join(__dirname, '..', 'src', 'main', 'tools')).get(tool), all = { ...Object.fromEntries((t.options || []).map((o) => [o.key, o.default])), ...opts };
    const id = submit({ tool, files, opts: all, dest: { kind: 'dir', path: d } });
    let j;
    for (const t0 = Date.now(); ; ) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; if (Date.now() - t0 > 300000) throw new Error(`${tool}: timeout`); await sleep(100); }
    if (fail) { ok(j.status !== 'done' && fail.test(j.error), `${tool}: expected a refusal, got ${j.status} ${j.error || ''}`); return j; }
    ok(j.status === 'done', `${tool}: ${j.status}: ${j.error}`);
    return { outs: j.results.flatMap((r) => r.paths || (r.path ? [r.path] : [])), notes: j.results.map((r) => r.note || ''), texts: j.results.map((r) => r.text || '') };
  };
  const ctxIn = (d) => ({ progress: () => {}, out: { file: (f, name) => path.join(d, name), folder: (f, name) => { const p = path.join(d, name); fs.mkdirSync(p, { recursive: true }); return p; } } });
  const scratch = (k) => { const d = path.join(OUT, `x-${k}`); fs.mkdirSync(d, { recursive: true }); return d; };
  // Frames of a GIF against the same frames cut straight from the source, as PSNR in dB.
  const frames = async (file, vf) => {
    const d = fs.mkdtempSync(path.join(OUT, 'fr-'));
    await E('util').run(E('util').binPath('ffmpeg'), ['-v', 'error', '-i', file, ...(vf ? ['-vf', vf] : []), '-fps_mode', 'passthrough', path.join(d, '%04d.png')]);
    return fs.readdirSync(d).sort().map((f) => path.join(d, f));
  };
  const psnr = async (a, b) => {
    const x = await sharp(a).removeAlpha().raw().toBuffer(), y = await sharp(b).removeAlpha().raw().toBuffer();
    let s = 0;
    for (let i = 0; i < x.length; i++) { const d = x[i] - y[i]; s += d * d; }
    return 10 * Math.log10((255 * 255) / (s / x.length || 1e-9));
  };
  const meanPsnr = async (gif, ref) => { const g = await frames(gif); let s = 0; const k = Math.min(g.length, ref.length); for (let i = 0; i < k; i++) s += await psnr(g[i], ref[i]); return { db: s / k, frames: g.length }; };
  const rgbaSame = async (a, b) => {
    const x = await sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), y = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return x.info.width === y.info.width && x.info.height === y.info.height && x.data.equals(y.data);
  };
  const pdfLook = async (file) => E('pdfplus').look(fs.readFileSync(file));
  const hasDeck = () => { try { return fs.existsSync(path.join(E('util').cfg.crafts, `deckcraft-cli${process.platform === 'win32' ? '.exe' : ''}`)) || fs.existsSync(path.join(E('util').cfg.crafts, `deckcraft-cli${process.platform === 'win32' ? '.exe' : ''}.br`)) ? null : 'no DeckCraft engine on this platform'; } catch (_) { return 'no DeckCraft engine'; } };
  const hasPdfCraft = () => (E('crafts').status().some((c) => c.id === 'pdfcraft' && c.bundled) ? null : 'no PdfCraft engine on this platform');
  const hasGs = () => (E('codecs').hasGhostscript() ? null : 'Ghostscript isn’t packed for this platform (run scripts/engines.mjs <target> codecs)');

  await check('video to GIF: smaller and truer than FFmpeg', null, async () => {
    const opts = { quality: 'balanced', start: '0', duration: '4' };
    const { outs: [g], notes } = await run('video-to-gif', [fx('clip.mp4')], opts);
    const m = await sharp(g, { animated: true }).metadata();
    ok(m.format === 'gif' && m.pages >= 40 && m.loop === 0, `${m.format} ${m.pages} frames, loop ${m.loop}`);
    const d = scratch('ffgif'), old = await E('media').toGif(fx('clip.mp4'), opts, ctxIn(d));
    const ref = await frames(fx('clip.mp4'), "fps=12,scale=w='min(iw,480)':h=ih:force_original_aspect_ratio=decrease:flags=lanczos");
    const a = await meanPsnr(g, ref), b = await meanPsnr(old, ref), sa = fs.statSync(g).size, sb = fs.statSync(old).size;
    ok(a.frames === ref.length, `${a.frames} frames for ${ref.length}`);
    ok(sa < sb, `gifski ${sa} B is not smaller than FFmpeg ${sb} B`);
    ok(a.db > b.db + 1, `gifski ${a.db.toFixed(2)} dB is not clearly truer than FFmpeg ${b.db.toFixed(2)} dB`);
    const { outs: [c] } = await run('convert-video', [fx('clip.mp4')], { to: 'gif' });
    ok((await sharp(c, { animated: true }).metadata()).pages > 10, 'Convert video to GIF made no animation');
    return `${(sa / 1024).toFixed(0)} KB at ${a.db.toFixed(1)} dB vs FFmpeg ${(sb / 1024).toFixed(0)} KB at ${b.db.toFixed(1)} dB (${Math.round((1 - sa / sb) * 100)}% smaller)${notes[0] ? ` · ${notes[0]}` : ''}`;
  });
  await check('pictures to GIF keep their order and timing', null, async () => {
    const { outs: [g] } = await run('images-to-gif', [fx('photo2.jpg'), fx('photo.webp'), fx('photo.png')], { seconds: 2, width: 300 });
    const m = await sharp(g, { animated: true }).metadata();
    ok(m.pages === 3 && m.width === 300 && m.delay.every((d) => Math.abs(d - 2000) <= 10), `${m.pages} frames ${m.width}px delays ${m.delay}`);
    const first = await sharp(g, { page: 0 }).removeAlpha().resize(60, 40, { fit: 'fill' }).raw().toBuffer(), src = await sharp(await sharp(fx('photo2.jpg')).resize(300, 300, { fit: 'contain', background: '#fff' }).png().toBuffer()).removeAlpha().resize(60, 40, { fit: 'fill' }).raw().toBuffer();
    let diff = 0;
    for (let i = 0; i < first.length; i++) diff += Math.abs(first[i] - src[i]);
    ok(diff / first.length < 12, `first frame differs by ${(diff / first.length).toFixed(1)}`);
    return `${m.pages} frames, ${m.delay.join('/')} ms`;
  });
  await check('slides to GIF: one frame per slide', hasDeck, async () => {
    const { outs: [g] } = await run('slides-gif', [fx('deck.pptx')], { seconds: 2 });
    const m = await sharp(g, { animated: true }).metadata(), count = Object.keys(require('fflate').unzipSync(new Uint8Array(fs.readFileSync(fx('deck.pptx'))))).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).length;
    ok(m.format === 'gif' && m.pages === count && m.width === 800, `${m.pages} frames for ${count} slides at ${m.width}px`);
    return `${m.pages} frames, ${(fs.statSync(g).size / 1024).toFixed(0)} KB`;
  });

  await check('PNG: oxipng saves bytes with the same pixels', null, async () => {
    const src = path.join(scratch('png'), 'ui.png');
    // A screenshot-like picture: flat panels, text and a gradient.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><defs><linearGradient id="g"><stop offset="0" stop-color="#2a6"/><stop offset="1" stop-color="#ade"/></linearGradient></defs><rect width="900" height="600" fill="#f4f4f4"/><rect x="20" y="20" width="860" height="80" rx="12" fill="url(#g)"/>${Array.from({ length: 14 }, (_, i) => `<text x="40" y="${150 + i * 30}" font-family="sans-serif" font-size="18" fill="#333">Row ${i + 1}: the quick brown fox jumps over the lazy dog</text>`).join('')}<circle cx="760" cy="380" r="90" fill="#e63" opacity="0.8"/></svg>`;
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(src);
    const before = fs.statSync(src).size;
    const { outs: [conv] } = await run('convert-image', [fx('photo.png')], { to: 'png' });
    ok(await rgbaSame(conv, fx('photo.png')), 'Convert to PNG changed pixels');
    const plain = await sharp(fx('photo.png')).png({ compressionLevel: 9 }).toBuffer();
    ok(fs.statSync(conv).size < plain.length, `convert ${fs.statSync(conv).size} B is not under plain ${plain.length} B`);
    const { outs: [light] } = await run('compress-image', [src], { level: 'low' });
    ok(await rgbaSame(light, src), 'Light compression changed pixels');
    const saved = 1 - fs.statSync(light).size / before;
    ok(saved > 0.05, `lossless saved only ${(saved * 100).toFixed(1)}%`);
    const { outs: [bal] } = await run('compress-image', [src], { level: 'recommended' });
    const old = await sharp(src).png({ compressionLevel: 9, palette: true, quality: 76 }).toBuffer(), now = fs.statSync(bal).size;
    ok(now < old.length, `palette PNG ${now} B is not under the old ${old.length} B`);
    return `lossless −${(saved * 100).toFixed(0)}% (${before} → ${fs.statSync(light).size} B, same pixels) · convert −${Math.round((1 - fs.statSync(conv).size / plain.length) * 100)}% · palette −${Math.round((1 - now / old.length) * 100)}% vs the old settings`;
  });
  await check('JPG and WebP: best encoder settings kept', null, async () => {
    const { outs: [j] } = await run('compress-image', [fx('doc-photo.jpg')]);
    const { outs: [w] } = await run('convert-image', [fx('photo.png')], { to: 'webp', quality: 80 });
    ok((await sharp(j).metadata()).format === 'jpeg' && (await sharp(w).metadata()).format === 'webp', 'wrong formats');
    const plain = await sharp(fx('doc-photo.jpg')).jpeg({ quality: 76 }).toBuffer();
    ok(fs.statSync(j).size < plain.length, `mozjpeg ${fs.statSync(j).size} B is not under libjpeg ${plain.length} B`);
    return `JPG ${fs.statSync(j).size} B (libjpeg would be ${plain.length} B) · WebP ${fs.statSync(w).size} B`;
  });

  await check('repair PDF rebuilds damaged files', null, async () => {
    const d = scratch('broken'), src = fs.readFileSync(fx('chapters.pdf')), s = src.toString('latin1'), good = await pdfLook(fx('chapters.pdf'));
    const cases = {
      'shifted-xref': Buffer.from(s.replace(/startxref\s+(\d+)/, (a, k) => `startxref\n${Number(k) + 37}`), 'latin1'),
      'no-tail': src.subarray(0, s.lastIndexOf('startxref')),
      'junk-front': Buffer.concat([Buffer.from('%garbage\n'.repeat(30)), src]),
    };
    const notes = [];
    for (const [k, buf] of Object.entries(cases)) {
      fs.writeFileSync(path.join(d, `${k}.pdf`), buf);
      const { outs: [o], notes: [note] } = await run('repair-pdf', [path.join(d, `${k}.pdf`)]);
      const l = await pdfLook(o);
      ok(l && l.pages === good.pages && E('pdfplus').sameText(good.text, l.text), `${k}: ${l?.pages} pages for ${good.pages}`);
      ok(/^%PDF-/.test(fs.readFileSync(o, 'latin1').slice(0, 8)) && /%%EOF\s*$/.test(fs.readFileSync(o, 'latin1').slice(-64)), `${k}: not a clean PDF`);
      notes.push(`${k}: ${note}`);
    }
    fs.writeFileSync(path.join(d, 'nothing.pdf'), Buffer.from('not a pdf at all'));
    await run('repair-pdf', [path.join(d, 'nothing.pdf')], {}, { fail: /too damaged/ });
    return notes.join(' · ');
  });
  await check('fast web view linearises', null, async () => {
    const { outs: [o], notes: [note] } = await run('pdf-web-view', [fx('chapters.pdf')]);
    const head = fs.readFileSync(o).subarray(0, 1024).toString('latin1');
    ok(/\/Linearized 1/.test(head), 'no /Linearized dictionary at the start');
    const r = await E('codecs').qpdf(o, ['--check-linearization'], null, { check: true }).catch((e) => ({ err: e.message }));
    ok(!r.err, `qpdf check: ${r.err}`);
    const a = await pdfLook(fx('chapters.pdf')), b = await pdfLook(o);
    ok(a.pages === b.pages && a.text === b.text, 'pages or text changed');
    await run('pdf-web-view', [fx('layout-locked.pdf')], {}, { fail: /password/i });
    return note;
  });
  await check('compress PDF Strong stays valid', null, async () => {
    const notes = [];
    for (const f of ['images.pdf', 'doc.pdf', 'comments.pdf']) {
      const { outs: [o], notes: [note] } = await run('compress-pdf', [fx(f)], { level: 'extreme' });
      const a = await pdfLook(fx(f)), b = await pdfLook(o);
      ok(b && a.pages === b.pages && E('pdfplus').sameText(a.text, b.text), `${f}: pages or text lost`);
      ok(fs.statSync(o).size <= fs.statSync(fx(f)).size, `${f}: grew`);
      notes.push(`${f} ${note}`);
    }
    return notes.join(' · ');
  });
  await check('PDF/A: Ghostscript fixes what PdfCraft can’t', () => hasPdfCraft() || hasGs(), async () => {
    const { outs: [o], notes: [note] } = await run('pdf-to-pdfa', [fx('comments.pdf')], { level: '2b' });
    ok(/checked: no issues/.test(note), note);
    const [, v] = await E('crafts').pdfScript([{ tool: 'doc_open', args: { path: o } }, { tool: 'pdfa_verify', args: { doc: 1, level: '2b' } }], null, 'Checking');
    ok(v.compliant, `not compliant: ${(v.issues || []).map((i) => i.message).join('; ')}`);
    const a = await pdfLook(fx('comments.pdf')), b = await pdfLook(o);
    ok(a.pages === b.pages && E('pdfplus').sameText(a.text, b.text), 'pages or text lost');
    return note;
  });

  await check('make QR codes and barcodes that read back', null, async () => {
    const cases = [
      [{ kind: 'text', text: 'https://example.com/lime?a=1&b=2' }, 'https://example.com/lime?a=1&b=2', 'QR code'],
      [{ kind: 'wifi', ssid: 'Home; Net', password: 'p@ss:word', security: 'WPA' }, 'WIFI:T:WPA;S:Home\\; Net;P:p@ss\\:word;;', 'QR code'],
      [{ kind: 'contact', name: 'Ada Lovelace', phone: '+44 20 7946 0000', email: 'ada@example.com' }, /BEGIN:VCARD[\s\S]*N:Lovelace;Ada;;;[\s\S]*TEL;TYPE=CELL:\+44 20 7946 0000[\s\S]*EMAIL:ada@example.com/, 'QR code'],
      [{ kind: 'text', type: 'code128', text: 'LIME-2024' }, 'LIME-2024', 'Code 128'],
      [{ kind: 'text', type: 'ean13', text: '590123412345' }, '5901234123457', 'EAN-13'],
      [{ kind: 'text', type: 'datamatrix', text: 'Lime data matrix' }, 'Lime data matrix', 'Data Matrix'],
      [{ kind: 'text', text: 'Vector QR', format: 'svg' }, 'Vector QR', 'QR code'],
    ];
    const done = [], noteFile = path.join(scratch('qr'), 'note.txt');
    fs.writeFileSync(noteFile, '\uFEFFhttps://lime.example/from-a-file\n');
    cases.unshift([{ kind: 'file' }, 'https://lime.example/from-a-file', 'QR code']);
    for (const [opts, want, kind] of cases) {
      const { outs: [o] } = await run('make-qr', [noteFile], opts);
      let img = o;
      if (o.endsWith('.svg')) { ok(/<svg[\s\S]*<\/svg>/.test(fs.readFileSync(o, 'utf8')), 'not an SVG'); img = `${o}.png`; await sharp(o, { density: 300 }).flatten({ background: '#fff' }).png().toFile(img); }
      const { texts: [t], notes: [note] } = await run('read-codes', [img]);
      ok(want instanceof RegExp ? want.test(t) : t === want, `${kind}: read “${t}” not “${want}”`);
      ok(note.startsWith(kind), `${note} is not a ${kind}`);
      done.push(kind + (o.endsWith('.svg') ? ' (SVG)' : ''));
    }
    await run('make-qr', [noteFile], { kind: 'text', type: 'ean13', text: 'not digits' }, { fail: /can’t go in this kind of code/ });
    const { outs: [vc] } = await run('make-qr', [fx('contacts.vcf')]);
    const { texts: [vt] } = await run('read-codes', [vc]);
    ok(vt === fs.readFileSync(fx('contacts.vcf'), 'utf8').replace(/^\uFEFF/, '').trim(), 'the contact card did not read back whole');
    return done.join(', ');
  });
  await check('read QR codes in a PDF and a photo', null, async () => {
    const d = scratch('qrpdf'), bwip = dep('bwip-js');
    const q1 = await bwip.toBuffer({ bcid: 'qrcode', text: 'page one code', scale: 4, padding: 4, backgroundcolor: 'FFFFFF' }), q2 = await bwip.toBuffer({ bcid: 'code128', text: 'PAGE-2', scale: 3, height: 12, padding: 10, backgroundcolor: 'FFFFFF' });
    const { PDFDocument } = require('pdf-lib'), doc = await PDFDocument.create();
    for (const q of [q1, q2]) { const p = doc.addPage([400, 400]), im = await doc.embedPng(q); p.drawImage(im, { x: 100, y: 150, width: im.width / 2, height: im.height / 2 }); }
    fs.writeFileSync(path.join(d, 'codes.pdf'), await doc.save());
    const { texts: [t], notes: [note] } = await run('read-codes', [path.join(d, 'codes.pdf')]);
    ok(/page one code/.test(t) && /PAGE-2/.test(t) && /page 1/.test(t) && /page 2/.test(t) && note === '2 codes found', `${note}: ${t}`);
    // A code on a photo, small, tilted and a little blurred.
    const photo = await sharp(fx('photo.png')).composite([{ input: await sharp(q1).rotate(12, { background: '#fff' }).resize(220).blur(0.6).toBuffer(), left: 300, top: 150 }]).jpeg({ quality: 80 }).toBuffer();
    fs.writeFileSync(path.join(d, 'photo.jpg'), photo);
    const { texts: [t2] } = await run('read-codes', [path.join(d, 'photo.jpg')]);
    ok(t2 === 'page one code', `photo: ${t2}`);
    const { notes: [none] } = await run('read-codes', [fx('photo2.jpg')]);
    ok(/No QR code/.test(none), none);
    return `${note}; photo read; ${none}`;
  });

  await check('photo info: read, edit and remove without re-encoding', null, async () => {
    const d = scratch('exif');
    const base = sharp(fx('photo.png')).withExif({ IFD0: { Make: 'Lime', Model: 'Test Camera', Artist: 'Old Name' }, IFD2: { DateTimeOriginal: '2019:07:01 08:09:10' } }).withMetadata({ orientation: 6 });
    const files = { jpg: await base.clone().jpeg({ quality: 90 }).toBuffer(), png: await base.clone().png().toBuffer(), webp: await base.clone().webp().toBuffer() };
    const out = [];
    for (const [e, b] of Object.entries(files)) {
      const f = path.join(d, `cam.${e}`);
      fs.writeFileSync(f, b);
      const { texts: [info], notes: [n1] } = await run('photo-info', [f]);
      ok(/Make: Lime/.test(info) && /Model: Test Camera/.test(info) && /2019-07-01 08:09:10/.test(n1), `${e} view: ${n1} / ${info.slice(0, 200)}`);
      const { outs: [ed], notes: [n2] } = await run('edit-photo-info', [f], { date: '2024-05-31 14:30', author: 'Jay K', copyright: '© 2024 Lime', place: '51.5007, -0.1246' });
      ok(await rgbaSame(ed, f), `${e}: editing changed the pixels`);
      const P = E('photoinfo'), eb = fs.readFileSync(ed), tags = await dep('exifr').parse(P.kind(eb) === 'webp' ? P.getExif(eb) : eb, { tiff: true, exif: true, gps: true });
      ok(tags.Artist === 'Jay K' && tags.Copyright === '© 2024 Lime' && tags.Make === 'Lime' && +tags.DateTimeOriginal === +new Date(2024, 4, 31, 14, 30), `${e} tags: ${JSON.stringify({ a: tags.Artist, c: tags.Copyright, d: tags.DateTimeOriginal })}`);
      ok(Math.abs(tags.latitude - 51.5007) < 1e-4 && Math.abs(tags.longitude + 0.1246) < 1e-4, `${e} place ${tags.latitude}, ${tags.longitude}`);
      ok((await sharp(ed).metadata()).orientation === 6, `${e}: orientation lost`);
      const { outs: [np] } = await run('edit-photo-info', [ed], { noPlace: true });
      const nb = fs.readFileSync(np), t2 = await dep('exifr').parse(P.kind(nb) === 'webp' ? P.getExif(nb) : nb, { gps: true, tiff: true });
      ok(t2.latitude === undefined && t2.Artist === 'Jay K', `${e}: place not removed`);
      const { outs: [cl] } = await run('strip-metadata', [ed]);
      const cb = fs.readFileSync(cl), left = P.kind(cb) === 'webp' ? (P.getExif(cb) ? await dep('exifr').parse(P.getExif(cb), true) : {}) : await dep('exifr').parse(cb, { tiff: true, exif: true, gps: true, iptc: true, xmp: true, icc: false }) || {};
      ok(!left.Make && !left.Artist && left.latitude === undefined && !left.DateTimeOriginal, `${e}: left ${Object.keys(left).join(', ')}`);
      ok(await rgbaSame(cl, f) && (await sharp(cl).metadata()).orientation === 6, `${e}: removing info changed the picture or its orientation`);
      out.push(`${e} ${n2.split(' ·')[0].toLowerCase()}`);
    }
    await run('edit-photo-info', [path.join(d, 'cam.jpg')], { date: '31/31/2024' }, { fail: /Write the date as/ });
    await run('edit-photo-info', [path.join(d, 'cam.jpg')], { place: '123, 456' }, { fail: /off the map/ });
    return out.join(' · ');
  });

  return results;
};
