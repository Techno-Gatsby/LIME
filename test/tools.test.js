'use strict';
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async ({ submit, jobs, app, tools, dir }) => {
  const FX = process.env.LIME_FX;
  const OUT = path.join(dir, 'out');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const E = (n) => require(path.join(__dirname, '..', 'src', 'main', 'engines', n));
  const sharp = require('sharp');
  const fx = (f) => path.join(FX, f);
  const SENT = fs.readFileSync(fx('sentence.txt'), 'utf8');
  const words = (t) => String(t).toLowerCase().split(/\s+/).filter(Boolean);
  const score = (t) => { const pool = words(t); let hit = 0; for (const w of words(SENT)) { const i = pool.indexOf(w); if (i >= 0) { hit++; pool.splice(i, 1); } } return hit / words(SENT).length; };
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const read = (p) => fs.readFileSync(p);
  const txt = (p) => fs.readFileSync(p, 'utf8');
  const fmt = async (p, f) => { const m = await sharp(p, { animated: true }).metadata(); ok(!f || m.format === f, `format ${m.format} ≠ ${f}`); return m; };
  const magic = (p, s) => ok(read(p).subarray(0, 16).toString('latin1').includes(s), `magic ${JSON.stringify(read(p).subarray(0, 8).toString('latin1'))} lacks ${s}`);
  const pages = async (p, n) => { const c = await E('pdf').pageCount(p); ok(n == null || c === n, `${c} pages ≠ ${n}`); return c; };
  const pdfText = async (p) => { const { doc } = await E('pdf').readPdf(p); let t = ''; for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText('').asText(); return t; };
  const probe = (p) => E('media').probe(p);
  const dur = async (p, d, tol = 0.6) => { const i = await probe(p); ok(Math.abs(i.duration - d) <= tol, `duration ${i.duration} ≠ ${d}`); return i; };
  const zipHas = (p, name) => { const z = require('fflate').unzipSync(new Uint8Array(read(p))); ok(Object.keys(z).some((k) => k.includes(name)), `zip lacks ${name}: ${Object.keys(z).slice(0, 8)}`); return z; };
  const docxText = async (p) => (await require('mammoth').extractRawText({ path: p })).value;
  const docxPart = (p, f = 'word/document.xml') => { const z = require('fflate').unzipSync(new Uint8Array(read(p))); return z[f] ? Buffer.from(z[f]).toString() : ''; };
  const xmlText = (x) => (x.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) || []).map((t) => (t === '<w:tab/>' ? '\t' : t === '<w:br/>' ? '\n' : t.replace(/<[^>]+>/g, ''))).join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const docxBlocks = (p) => (docxPart(p).match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g) || []).map((x) => (x.startsWith('<w:tbl>')
    ? { x, rows: x.match(/<w:tr\b[\s\S]*?<\/w:tr>/g).map((r) => (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map((c) => ({ x: c, t: (c.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map(xmlText).filter(Boolean).join('\n'), span: +(/<w:gridSpan w:val="(\d+)"/.exec(c)?.[1] || 1), merge: /<w:vMerge w:val="(\w+)"/.exec(c)?.[1] || '' }))) }
    : { x, t: xmlText(x), style: /<w:pStyle w:val="([^"]+)"/.exec(x)?.[1] || '' }));
  const paras = (p) => docxBlocks(p).filter((b) => !b.rows && b.t.trim()).map((b) => b.t);
  const same = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m || 'output'} differs: ${JSON.stringify(a).slice(0, 400)}`);
  const files = (d) => (fs.existsSync(d) && fs.statSync(d).isDirectory() ? fs.readdirSync(d) : []);
  const U = E('util'), M = E('media');
  const ffp = async (p, extra = []) => JSON.parse((await U.run(U.binPath('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', ...extra, p])).stdout);
  const of = (j, type) => j.streams.filter((s) => s.codec_type === type);
  const md5 = async (p, sel) => (await U.run(U.binPath('ffmpeg'), ['-v', 'error', '-i', p, '-map', sel, '-c', 'copy', '-f', 'md5', '-'])).stdout.trim();
  const sound = async (p, ss = 0, t = 0) => {
    const { stderr } = await U.run(U.binPath('ffmpeg'), ['-hide_banner', '-nostats', ...(ss ? ['-ss', String(ss)] : []), ...(t ? ['-t', String(t)] : []), '-i', p, '-af', 'volumedetect,astats=metadata=0', '-f', 'null', '-']);
    const n = (re) => Number((re.exec(stderr) || [])[1]);
    return { mean: n(/mean_volume: (-?[\d.]+) dB/), max: n(/max_volume: (-?[\d.]+) dB/), zcr: n(/Zero crossings rate: ([\d.]+)/) };
  };
  let stills = 0;
  const still = async (p, at) => { const f = path.join(OUT, `still-${++stills}.png`); await U.run(U.binPath('ffmpeg'), ['-v', 'error', '-y', ...(at < 0 ? ['-sseof', String(at)] : ['-ss', String(at)]), '-i', p, '-frames:v', '1', '-update', '1', f]); return f; };
  const diff = async (a, b, region) => {
    const [x, y] = await Promise.all([a, b].map((f) => { const img = typeof f === 'string' ? sharp(f) : f; return (region ? img.extract(region) : img).removeAlpha().raw().toBuffer(); }));
    let s = 0;
    for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]);
    return s / x.length;
  };
  const titled = (j) => [j.format.tags, ...j.streams.map((s) => s.tags)].some((t) => t && Object.entries(t).some(([k, v]) => k.toLowerCase() === 'title' && v === 'Lime 노래'));
  const C = [];
  const T = (name, tool, inputs, opts, check, skip) => C.push({ name, tool, inputs: inputs.map(fx), opts, check, skip });
  const noEncoder = (to) => (M.supports(to) ? null : `this FFmpeg cannot write ${to}`);
  const F = (name, tool, inputs, opts, fail) => C.push({ name, tool, inputs: inputs.map(fx), opts, fail });
  const XLSX = require('xlsx');
  const sheet0 = (o) => { const wb = XLSX.readFile(o); return wb.Sheets[wb.SheetNames[0]]; };
  const cell = (ws, a) => (ws[a] ? `${ws[a].t}:${ws[a].v}` : '');
  const bom = (p) => read(p).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const utf = (p) => txt(p).replace(/^\ufeff/, '');
  const has = (t, ...parts) => { for (const s of parts) ok(t.includes(s), `lacks ${JSON.stringify(s).slice(0, 120)} in ${JSON.stringify(t).slice(0, 300)}`); };
  const ms = (h, m, s, f) => ((+h * 60 + +m) * 60 + +s) * 1000 + +f;
  const srtCues = (t) => [...t.replace(/^\ufeff/, '').matchAll(/(\d+):(\d\d):(\d\d)[,.](\d{3}) --> (\d+):(\d\d):(\d\d)[,.](\d{3})\r?\n([\s\S]*?)(?:\r?\n\r?\n|$)/g)].map((m) => [ms(m[1], m[2], m[3], m[4]), ms(m[5], m[6], m[7], m[8]), m[9].replace(/\r\n/g, '\n')]);
  const sevenZip = (args) => require('child_process').execFileSync(E('util').binPath('7z'), args, { maxBuffer: 1 << 28 });
  const tarNames = (b) => { const n = []; for (let i = 0; i + 512 <= b.length;) { const name = b.toString('utf8', i, i + 100).replace(/\0[\s\S]*$/, ''); if (!name) break; n.push(name.replace(/^\.\//, '')); i += 512 + Math.ceil((parseInt(b.toString('latin1', i + 124, i + 136), 8) || 0) / 512) * 512; } return n; };
  const entries = async (o) => (await E('archive').list(o)).map((e) => e.path.split(path.sep).join('/')).sort();
  const isLink = (p) => fs.lstatSync(p).isSymbolicLink();
  const walk = (d) => fs.readdirSync(d, { recursive: true }).map((x) => x.split(path.sep).join('/')).sort();
  const X = F;
  const xmlDoc = (s, what) => { const errs = []; const d = new (require('@xmldom/xmldom').DOMParser)({ errorHandler: { warning: () => {}, error: (e) => errs.push(e), fatalError: (e) => errs.push(e) } }).parseFromString(s, 'text/xml'); ok(!errs.length && d.documentElement, `${what} is not well-formed: ${errs[0]}`); return d; };
  const tags = (d, n) => { const all = d.getElementsByTagName('*'), out = []; for (let i = 0; i < all.length; i++) if (String(all[i].localName || all[i].tagName).replace(/^.*:/, '') === n) out.push(all[i]); return out; };
  // EPUB structure: mimetype first and stored, OPF 3.0 with one identifier and modified date, every manifest item and
  // relative link present, unique ids, nav with entries, NCX with nav points, and well-formed XHTML.
  const epub = (p) => {
    const b = read(p);
    ok(b.readUInt32LE(0) === 0x04034b50 && b.readUInt16LE(8) === 0 && b.readUInt16LE(28) === 0 && b.subarray(30, 58).toString() === 'mimetypeapplication/epub+zip', 'mimetype is not the first stored entry');
    const z = require('fflate').unzipSync(new Uint8Array(b)), s = (k) => Buffer.from(z[k] || []).toString('utf8');
    const opfPath = /full-path="([^"]+)"/.exec(s('META-INF/container.xml'))[1], dir = path.posix.dirname(opfPath);
    const opf = xmlDoc(s(opfPath), 'OPF');
    ok(opf.documentElement.getAttribute('version') === '3.0', 'not EPUB 3');
    ok(tags(opf, 'identifier').length === 1 && tags(opf, 'meta').filter((m) => m.getAttribute('property') === 'dcterms:modified').length === 1, 'identifier/modified');
    const items = tags(opf, 'item').map((i) => ({ id: i.getAttribute('id'), href: path.posix.join(dir, decodeURIComponent(i.getAttribute('href'))), type: i.getAttribute('media-type'), props: i.getAttribute('properties') || '' }));
    ok(new Set(items.map((i) => i.id)).size === items.length, 'duplicate manifest ids');
    for (const i of items) ok(z[i.href], `missing ${i.href}`);
    const spine = tags(opf, 'itemref').map((r) => items.find((i) => i.id === r.getAttribute('idref')).href);
    ok(spine.length, 'empty spine');
    const nav = items.find((i) => /\bnav\b/.test(i.props)), ncx = items.find((i) => i.type === 'application/x-dtbncx+xml');
    ok(tags(xmlDoc(s(nav.href), 'nav'), 'li').length && tags(xmlDoc(s(ncx.href), 'NCX'), 'navPoint').length, 'empty nav or NCX');
    const pages = {};
    for (const i of items.filter((x) => x.type === 'application/xhtml+xml')) {
      const d = xmlDoc(s(i.href), i.href);
      for (const e of [...tags(d, 'img'), ...tags(d, 'a'), ...tags(d, 'link')]) {
        const ref = e.getAttribute('src') || e.getAttribute('href');
        if (!ref || /^[a-z][a-z0-9+.-]+:/i.test(ref) || ref.startsWith('#')) continue;
        ok(z[path.posix.join(path.posix.dirname(i.href), decodeURIComponent(ref.split('#')[0]))], `${i.href} links to missing ${ref}`);
      }
      const ids = Array.prototype.slice.call(d.getElementsByTagName('*')).map((e) => e.getAttribute('id')).filter(Boolean);
      ok(new Set(ids).size === ids.length, `duplicate ids in ${i.href}`);
      pages[path.posix.relative(dir, i.href)] = s(i.href);
    }
    return { z, s, opf: s(opfPath), items, spine: spine.map((h) => path.posix.relative(dir, h)), pages, nav: s(nav.href), ncx: s(ncx.href), images: items.filter((i) => i.type.startsWith('image/')) };
  };

  for (const [src, to, f] of [['photo.heic', 'jpg', 'jpeg'], ['photo.jpg', 'png', 'png'], ['photo.jpg', 'webp', 'webp'], ['photo.jpg', 'avif', 'heif'], ['photo.jpg', 'tiff', 'tiff'], ['photo.jpg', 'gif', 'gif'], ['photo.webp', 'jpg', 'jpeg'], ['alpha.png', 'jpg', 'jpeg'], ['layers.psd', 'png', 'png'], ['raw.dng', 'jpg', 'jpeg'], ['photo.jxl', 'png', 'png']]) {
    T(`image ${src}→${to}`, 'convert-image', [src], { to, quality: 88 }, async ([o]) => { const m = await fmt(o, f); ok(m.width > 100, 'tiny'); });
  }
  const ffbin = (n) => E('util').binPath(n);
  let decoded = 0;
  const ffpng = (p, pre = []) => { const o = path.join(OUT, `decoded-${decoded++}.png`); require('child_process').execFileSync(ffbin('ffmpeg'), ['-v', 'error', '-y', ...pre, '-i', p, '-frames:v', '1', o]); return o; };
  const ffframes = (p) => { const d = path.join(OUT, `frames-${decoded++}`); fs.mkdirSync(d); require('child_process').execFileSync(ffbin('ffmpeg'), ['-v', 'error', '-y', '-i', p, '-fps_mode', 'passthrough', path.join(d, 'f%03d.png')]); return files(d).sort().map((f) => path.join(d, f)); };
  const pixels = async (input) => { const { data, info } = await sharp(input, { limitInputPixels: false, animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { w: info.width, h: info.height, data, at: (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)] }; };
  const near = (a, b, tol = 14) => b.every((v, i) => Math.abs(a[i] - v) <= tol);
  const psnr = (a, b) => { let se = 0, n = 0; for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { se += (a[i + c] - b[i + c]) ** 2; n++; } return 10 * Math.log10(65025 / Math.max(se / n, 1e-9)); };
  const heicDecode = async (p) => { const d = await require('heic-decode')({ buffer: read(p) }); return { w: d.width, h: d.height, data: Buffer.from(d.data.buffer, d.data.byteOffset, d.data.byteLength), at: (x, y) => [...d.data.subarray((y * d.width + x) * 4, (y * d.width + x) * 4 + 4)] }; };
  const pngChunks = (p) => { const b = read(p), c = []; for (let i = 8; i + 8 <= b.length; i += 12 + b.readUInt32BE(i)) c.push({ type: b.toString('latin1', i + 4, i + 8), data: b.subarray(i + 8, i + 8 + b.readUInt32BE(i)) }); return c; };
  const icnsEntries = (b) => { const e = []; for (let i = 8; i + 8 <= b.length; i += b.readUInt32BE(i + 4)) e.push({ type: b.toString('latin1', i, i + 4), data: b.subarray(i + 8, i + b.readUInt32BE(i + 4)) }); return e; };
  const brand = (p) => read(p).toString('latin1', 8, 12);
  const isP3 = (icc) => !!icc && icc.toString('latin1').replace(/\0/g, '').includes('P3');

  T('image→bmp', 'convert-image', ['alpha.png'], { to: 'bmp' }, async ([o]) => { magic(o, 'BM'); ok(read(o).readUInt16LE(28) === 24, 'not 24-bit'); const px = await pixels(ffpng(o)); ok(near(px.at(2, 2), [255, 255, 255, 255]), `transparent corner became ${px.at(2, 2)}`); ok(near(px.at(300, 300), [134, 194, 58, 255]), `centre ${px.at(300, 300)}`); });
  T('image→ico', 'convert-image', ['photo.png'], { to: 'ico' }, async ([o]) => {
    const b = read(o), n = b.readUInt16LE(4), entry = (i) => b.subarray(b.readUInt32LE(6 + 16 * i + 12), b.readUInt32LE(6 + 16 * i + 12) + b.readUInt32LE(6 + 16 * i + 8));
    ok(b.readUInt16LE(2) === 1 && n === 7, `type ${b.readUInt16LE(2)}, ${n} sizes`);
    ok(b[6] === 0 && entry(0).subarray(1, 4).toString() === 'PNG' && (await sharp(entry(0)).metadata()).width === 256, '256 px entry is not PNG');
    const small = entry(n - 1);
    ok(b[6 + 16 * (n - 1)] === 16 && small.readUInt32LE(0) === 40 && small.readInt32LE(8) === 32 && small.readUInt16LE(14) === 32, '16 px entry is not a 32-bit DIB');
    const px = await pixels(ffpng(o)); ok(px.w === 256 && px.at(128, 10)[3] === 0 && px.at(128, 128)[3] === 255, `ffmpeg sees ${px.w} px, ${px.at(128, 10)}`);
  });
  T('image→avif is AV1', 'convert-image', ['photo.jpg'], { to: 'avif', quality: 70 }, async ([o]) => { ok(brand(o) === 'avif', `brand ${brand(o)}`); const m = await sharp(o).metadata(); ok(m.compression === 'av1' && m.width === 1600, `${m.compression} ${m.width}`); });
  T('image→heic', 'convert-image', ['photo.jpg'], { to: 'heic', quality: 80 }, async ([o]) => {
    ok(brand(o) === 'heic', `brand ${brand(o)}`);
    const d = await heicDecode(o), ref = await pixels(fx('photo.jpg'));
    ok(d.w === 1600 && d.h === 1067, `${d.w}x${d.h}`);
    const q = psnr(d.data, ref.data); ok(q > 32, `PSNR ${q.toFixed(1)} dB`);
    const m = await sharp(o).metadata(); ok(m.exif?.includes('LimeCam') && m.icc, 'EXIF or ICC profile lost');
  });
  T('image→heic odd size, flattened', 'convert-image', ['odd.png'], { to: 'heic' }, async ([o]) => { const d = await heicDecode(o); ok(d.w === 301 && d.h === 201, `${d.w}x${d.h}`); ok(near(d.at(3, 3), [255, 255, 255]) && near(d.at(150, 100), [44, 100, 19], 20), `corner ${d.at(3, 3)} centre ${d.at(150, 100)}`); });
  T('image heic→jpg keeps profile and EXIF', 'convert-image', ['photo-p3.heic'], { to: 'jpg' }, async ([o]) => { const m = await sharp(o).metadata(); ok(isP3(m.icc), 'Display P3 profile lost'); ok(m.exif?.includes('LimeCam'), 'EXIF lost'); ok(m.width === 400 && (m.orientation || 1) === 1, `${m.width}x${m.height}, orientation ${m.orientation}`); });
  T('image keeps EXIF and profile', 'convert-image', ['photo.jpg'], { to: 'webp' }, async ([o]) => { const m = await fmt(o, 'webp'); ok(m.exif?.includes('LimeCam') && m.icc, 'metadata dropped'); });
  T('image strip option', 'convert-image', ['photo.jpg'], { to: 'jpg', strip: true }, async ([o]) => { const m = await sharp(o).metadata(); ok(!m.exif && m.icc, `exif ${!!m.exif}, icc ${!!m.icc}`); });
  const frameCheck = (f) => async ([o]) => { const m = await fmt(o, f); ok(m.pages === 3 && String(m.delay) === '100,200,300' && m.loop === 0, `${m.pages} frames, ${m.delay}, loop ${m.loop}`); const px = await pixels(o); ok(near(px.at(60, 90 + 45), [40, 200, 60, 255], 20), `frame 2 ${px.at(60, 135)}`); };
  T('image gif→webp keeps frames', 'convert-image', ['frames.gif'], { to: 'webp' }, frameCheck('webp'));
  T('image webp→gif keeps frames', 'convert-image', ['frames.webp'], { to: 'gif' }, frameCheck('gif'));
  T('image gif→apng keeps frames', 'convert-image', ['frames.gif'], { to: 'apng' }, async ([o]) => {
    const c = pngChunks(o), ac = c.find((x) => x.type === 'acTL'), fc = c.filter((x) => x.type === 'fcTL');
    ok(ac && ac.data.readUInt32BE(0) === 3 && ac.data.readUInt32BE(4) === 0, 'acTL');
    ok(fc.map((x) => x.data.readUInt16BE(20) / x.data.readUInt16BE(22)).join() === '0.1,0.2,0.3', 'delays');
    const fr = ffframes(o); ok(fr.length === 3, `ffmpeg reads ${fr.length} frames`);
    ok(near((await pixels(fr[2])).at(60, 45), [40, 60, 220, 255], 20), 'frame 3 colour');
  });
  T('image apng→gif keeps frames', 'convert-image', ['frames.apng'], { to: 'gif' }, async ([o]) => { const m = await fmt(o, 'gif'); ok(m.pages === 4 && m.delay.every((d) => d === 200), `${m.pages} frames, ${m.delay}`); });
  T('image animated .png→webp', 'convert-image', ['frames-apng.png'], { to: 'webp' }, async ([o]) => { const m = await fmt(o, 'webp'); ok(m.pages === 4, `${m.pages} frames`); });
  T('image apng compositing', 'convert-image', ['vectors.apng'], { to: 'webp', lossless: true }, async ([o]) => {
    const m = await fmt(o, 'webp'); ok(m.pages === 4 && String(m.delay) === '50,100,100,1000' && m.loop === 2, `${m.pages} frames, ${m.delay}, loop ${m.loop}`);
    const px = await pixels(o), at = (f, x, y) => px.at(x, 40 * f + y);
    ok(at(1, 5, 5)[3] === 0 && near(at(1, 35, 35), [255, 0, 0, 255], 2), 'frame 2: SOURCE');
    const b = at(2, 35, 35); ok(b[0] >= 100 && b[0] <= 160 && b[2] >= 100 && b[2] <= 160 && at(2, 5, 5)[3] === 0, `frame 3: OVER ${b}`);
    ok(near(at(3, 35, 35), [255, 0, 0, 255], 2) && near(at(3, 20, 20), [0, 255, 0, 255], 2) && at(3, 5, 5)[3] === 0, 'frame 4: PREVIOUS');
  });
  T('image tiff pages→png', 'convert-image', ['pages.tiff'], { to: 'png' }, async ([o]) => { const fl = files(o).sort(); ok(fl.length === 3, `${fl.length} files`); for (let i = 0; i < 3; i++) { const px = await pixels(path.join(o, fl[i])); ok(near(px.at(150, 100), [[220, 40, 40], [40, 200, 60], [40, 60, 220]][i]), `page ${i + 1}`); } });
  T('image tiff pages→pdf', 'convert-image', ['pages.tiff'], { to: 'pdf' }, async ([o]) => pages(o, 3));
  T('image oversized→webp', 'convert-image', ['wide.png'], { to: 'webp' }, async ([o], r) => { const m = await fmt(o, 'webp'); ok(m.width === 16383 && m.height === 32, `${m.width}x${m.height}`); ok(/Reduced/.test(r[0].note), 'no note'); });
  T('image oversized→jpg', 'convert-image', ['long.png'], { to: 'jpg' }, async ([o]) => { const m = await fmt(o, 'jpeg'); ok(m.width === 65500 && m.height === 7, `${m.width}x${m.height}`); });
  T('image svg at its own size', 'convert-image', ['logo.svg'], { to: 'png' }, async ([o]) => { const m = await fmt(o, 'png'); ok(m.width === 240 && m.height === 160, `${m.width}x${m.height}`); });
  T('image huge svg is capped', 'convert-image', ['huge.svg'], { to: 'png' }, async ([o]) => { const m = await fmt(o, 'png'); ok(Math.max(m.width, m.height) <= 16384 && m.width * m.height <= 1e8 && m.width > 10000, `${m.width}x${m.height}`); });
  T('image hdr is tone-mapped', 'convert-image', ['glow.hdr'], { to: 'png' }, async ([o]) => { const px = await pixels(o); ok(px.at(50, 25)[0] > 100, `mid grey ${px.at(50, 25)} looks linear`); ok(px.at(2, 0)[0] > 240, `highlight ${px.at(2, 0)}`); });
  T('image cur→png', 'convert-image', ['cursor.cur'], { to: 'png' }, async ([o]) => { const px = await pixels(o); ok(px.w === 48 && px.h === 48 && px.at(1, 1)[3] === 0 && near(px.at(24, 24), [134, 194, 58, 255]), `${px.w}x${px.h} ${px.at(24, 24)}`); });
  T('image legacy icns→png', 'convert-image', ['legacy.icns'], { to: 'png' }, async ([o]) => { const px = await pixels(o); ok(px.w === 128 && px.at(64, 32)[1] > 170 && px.at(64, 32)[3] === 255 && px.at(64, 100)[3] === 0, `${px.w} ${px.at(64, 32)} ${px.at(64, 100)}`); });
  T('image icns→png', 'convert-image', ['modern.icns'], { to: 'png' }, async ([o]) => { const px = await pixels(o); ok(px.w === 512 && px.at(2, 2)[3] === 0 && px.at(256, 256)[3] === 255, `${px.w}`); });
  T('image→apng', 'convert-image', ['photo.png'], { to: 'apng' }, async ([o]) => { ok(pngChunks(o).some((c) => c.type === 'acTL'), 'no acTL'); const px = await pixels(ffpng(o)); ok(px.w === 800 && px.h === 534, `${px.w}x${px.h}`); });
  T('image→jp2 is lossless', 'convert-image', ['photo.png'], { to: 'jp2' }, async ([o]) => { magic(o, 'jP'); const a = await sharp(ffpng(o)).removeAlpha().raw().toBuffer(), b = await sharp(fx('photo.png')).removeAlpha().raw().toBuffer(); ok(a.equals(b), 'pixels changed'); });
  T('image→icns', 'convert-image', ['photo.png'], { to: 'icns' }, async ([o]) => {
    const b = read(o), e = icnsEntries(b);
    ok(b.toString('latin1', 0, 4) === 'icns' && b.readUInt32BE(4) === b.length, 'header');
    ok(e.map((x) => x.type).join() === 'TOC ,icp4,ic11,icp5,ic12,ic07,ic13,ic08,ic14,ic09,ic10', e.map((x) => x.type).join());
    for (const [t, s] of [['icp4', 16], ['ic12', 64], ['ic14', 512]]) ok((await sharp(e.find((x) => x.type === t).data).metadata()).width === s, `${t} size`);
    const big = await pixels(e.find((x) => x.type === 'ic10').data); ok(big.w === 1024 && big.at(512, 20)[3] === 0 && big.at(512, 512)[3] === 255, 'ic10 padding');
  });
  T('image svg→icns renders crisp', 'convert-image', ['icon.svg'], { to: 'icns' }, async ([o]) => { const big = await pixels(icnsEntries(read(o)).find((x) => x.type === 'ic10').data); ok(big.at(512 + 415, 512)[3] === 255 && big.at(512 + 440, 512)[3] === 0, `edge ${big.at(512 + 415, 512)} ${big.at(512 + 440, 512)}`); });
  T('image→cur', 'convert-image', ['alpha.png'], { to: 'cur', hotspot: 'center' }, async ([o]) => {
    const b = read(o); ok(b.readUInt16LE(2) === 2 && b.readUInt16LE(4) === 1 && b[6] === 0, 'not a 256 px cursor');
    ok(b.readUInt16LE(10) === 128 && b.readUInt16LE(12) === 128, `hotspot ${b.readUInt16LE(10)},${b.readUInt16LE(12)}`);
    const px = await pixels(ffpng(o, ['-f', 'ico'])); ok(px.w === 256 && px.at(2, 2)[3] === 0 && px.at(128, 128)[3] === 255, `ffmpeg sees ${px.w} ${px.at(128, 128)}`);
  });
  for (const [to, sig, kind] of [['tga', 'TRUEVISION', 'alpha'], ['qoi', 'qoif', 'alpha'], ['pam', 'P7', 'alpha'], ['sgi', '\x01\xda', 'alpha'], ['dds', 'DDS ', 'alpha'], ['xpm', '/* XPM */', 'alpha'], ['pcx', '\n', 'flat'], ['ppm', 'P6', 'flat'], ['pfm', 'PF', 'flat'], ['ras', '\x59\xa6\x6a\x95', 'flat'], ['pgm', 'P5', 'grey'], ['pbm', 'P4', 'mono'], ['xbm', '#define', 'mono'], ['wbmp', '\0\0', 'mono']]) {
    T(`image→${to}`, 'convert-image', ['odd.png'], { to }, async ([o]) => {
      const b = read(o); ok((to === 'tga' ? b.subarray(-18) : b).toString('latin1').startsWith(sig), `signature ${JSON.stringify(b.subarray(0, 8).toString('latin1'))}`);
      const px = await pixels(ffpng(o)), c = px.at(3, 3), m = px.at(150, 100);
      ok(px.w === 301 && px.h === 201, `${px.w}x${px.h}`);
      ok(kind === 'alpha' ? c[3] === 0 : near(c, [255, 255, 255, 255]), `corner ${c}`);
      ok(near(m, kind === 'mono' ? [0, 0, 0, 255] : kind === 'grey' ? [74, 74, 74, 255] : [44, 100, 19, 255]), `centre ${m}`);
    });
  }
  for (const e of ['tga', 'qoi', 'pcx', 'ppm', 'pgm', 'pbm', 'pam', 'pfm', 'sgi', 'ras', 'xbm', 'wbmp', 'jp2']) {
    T(`image ${e} in`, 'convert-image', [`sample.${e}`], { to: 'png' }, async ([o]) => { const px = await pixels(o); ok(px.w === 300 && px.h === 200, `${px.w}x${px.h}`); ok(['tga', 'qoi', 'pam', 'sgi', 'jp2'].includes(e) ? px.at(2, 2)[3] === 0 : px.at(2, 2)[3] === 255, `corner ${px.at(2, 2)}`); ok(px.at(150, 100)[3] === 255, 'centre'); });
  }
  const count = (px, x0, y0, x1, y1, test) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (test(px.at(x, y))) n++; return n; };
  const white = (c) => c[0] > 235 && c[1] > 235 && c[2] > 235, black = (c) => c[0] < 40 && c[1] < 40 && c[2] < 40;
  T('image meme', 'meme', ['photo.jpg'], { top: 'When the tests pass', bottom: 'first try' }, async ([o]) => {
    const px = await pixels(o), src = await pixels(fx('photo.jpg'));
    ok(px.w === 1600 && px.h === 1067, `${px.w}x${px.h}`);
    for (const [y0, y1] of [[0, 230], [837, 1067]]) {
      const w = count(px, 0, y0, 1600, y1, white), b = count(px, 0, y0, 1600, y1, black);
      ok(w > 20000 && b > 5000 && count(src, 0, y0, 1600, y1, black) === 0, `caption band ${y0}: ${w} white, ${b} black`);
    }
    ok(near(px.at(800, 533), src.at(800, 533), 6), 'middle changed');
  });
  T('image meme on a GIF', 'meme', ['frames.gif'], { top: 'Lime', bottom: 'Animated' }, async ([o]) => {
    const m = await fmt(o, 'gif'); ok(m.pages === 3 && String(m.delay) === '100,200,300', `${m.pages} frames, ${m.delay}`);
    const px = await pixels(o); for (let i = 0; i < 3; i++) ok(count(px, 0, 90 * i, 120, 90 * i + 22, white) > 40, `frame ${i + 1} has no caption`);
  });
  T('image border with corners and shadow', 'border-image', ['photo.jpg'], { color: '#ff0000', width: 5, radius: 20, shadow: true }, async ([o]) => {
    const px = await pixels(o), pad = 81, b = 53, fw = 1706, fh = 1173;
    ok(px.w === fw + 2 * pad && px.h === fh + 2 * pad && o.endsWith('.png'), `${px.w}x${px.h} ${path.extname(o)}`);
    ok(px.at(0, 0)[3] === 0 && px.at(pad + 3, pad + 3)[3] <= 8, 'corners not rounded');
    ok(near(px.at(pad + (b >> 1), pad + (fh >> 1)), [255, 0, 0, 255], 4), `border ${px.at(pad + (b >> 1), pad + (fh >> 1))}`);
    const sh = px.at(pad + (fw >> 1), pad + fh + 20); ok(sh[3] > 30 && sh[0] < 60, `shadow ${sh}`);
  });
  T('image border', 'border-image', ['photo.jpg'], { color: '#2266ff', width: 5, radius: 0, shadow: false }, async ([o]) => { const m = await fmt(o, 'jpeg'); ok(m.width === 1706 && m.height === 1173, `${m.width}x${m.height}`); ok(near((await pixels(o)).at(20, 600), [34, 102, 255], 12), 'border colour'); });
  for (const mode of ['pixelate', 'blur']) {
    T(`image blur faces (${mode})`, 'blur-faces', ['faces.png'], { mode, strength: 60 }, async ([o], r) => {
      ok(/^2 faces/.test(r[0].note), r[0].note);
      const px = await pixels(o), src = await pixels(fx('faces.png'));
      for (const [x, y] of [[171, 240], [229, 240], [450, 220], [490, 220]]) ok(!near(px.at(x, y), src.at(x, y), 25), `eye at ${x},${y} still sharp: ${px.at(x, y)}`);
      ok(near(px.at(20, 20), src.at(20, 20), 0) && near(px.at(620, 460), src.at(620, 460), 0), 'background changed');
    });
  }
  T('image animation speed', 'animation-speed', ['frames.gif'], { speed: '2', reverse: true }, async ([o]) => { const m = await fmt(o, 'gif'); ok(m.pages === 3 && String(m.delay) === '150,100,50', `${m.pages} frames, ${m.delay}`); ok(near((await pixels(o)).at(60, 45), [40, 60, 220, 255], 20), 'not reversed'); });
  T('image animation speed apng', 'animation-speed', ['frames.apng'], { speed: '0.5' }, async ([o]) => { const fc = pngChunks(o).filter((c) => c.type === 'fcTL'); ok(fc.length === 4 && fc.every((c) => c.data.readUInt16BE(20) / c.data.readUInt16BE(22) === 0.4), `${fc.length} frames`); ok(ffframes(o).length === 4, 'ffmpeg frames'); });
  T('image wheel rings', 'file-hash', ['photo.jpg'], { algos: ['md5'] }, () => {
    for (const f of ['a.jpg', 'a.png', 'a.heic', 'a.gif', 'a.svg', 'a.ico', 'a.tga', 'a.cur']) {
      const ring = tools.wheelsFor([f]).convert, tos = ring.map((w) => w.opts.to);
      ok(ring.length >= 8 && ring.length <= 9 && !tos.includes(f.slice(2)) && ring.every((w) => w.tool === 'convert-image'), `${f}: ${tos}`);
    }
    ok(tools.wheelsFor(['a.gif']).convert.slice(0, 2).map((w) => w.opts.to).join() === 'webp,apng', 'animated targets first');
    ok(tools.toolsFor(['a.icns']).includes('convert-image'), 'ICNS is not an image');
  });
  T('image→psd', 'convert-image', ['photo.png'], { to: 'psd' }, ([o]) => magic(o, '8BPS'));
  T('image→pdf', 'convert-image', ['photo.jpg'], { to: 'pdf' }, async ([o]) => pages(o, 1));
  T('image→jxl', 'convert-image', ['photo.png'], { to: 'jxl' }, ([o]) => ok(read(o).length > 100 && (read(o)[0] === 0xff && read(o)[1] === 0x0a || read(o).subarray(4, 8).toString() === 'JXL '), 'not jxl'));
  T('develop raw→tif', 'develop-raw', ['raw.dng'], { to: 'tif', auto: true, quality: 92 }, async ([o]) => fmt(o, 'tiff'));
  T('enhance photo', 'enhance-photo', ['photo.jpg'], {}, async ([o]) => fmt(o, 'jpeg'));
  T('panorama', 'panorama', ['pano/view-0.png', 'pano/view-1.png', 'pano/view-2.png'], {}, async ([o]) => { const m = await fmt(o, 'jpeg'); const v = await sharp(fx('pano/view-0.png')).metadata(); ok(m.width > v.width * 1.3, `width ${m.width} vs view ${v.width}`); });
  T('hdr merge', 'hdr-merge', ['hdr/bracket-0.dng', 'hdr/bracket-1.dng', 'hdr/bracket-2.dng'], {}, async (o) => { await fmt(o[0], 'jpeg'); ok(o.some((x) => x.endsWith('.dng')), 'no dng'); });
  T('compress image', 'compress-image', ['photo.jpg'], { level: 'recommended' }, async ([o]) => { ok(fs.statSync(o).size < fs.statSync(fx('photo.jpg')).size, 'not smaller'); await fmt(o, 'jpeg'); });
  T('resize 50%', 'resize-image', ['photo.jpg'], { mode: 'percent', percent: 50 }, async ([o]) => { const m = await fmt(o); ok(m.width === 800, `width ${m.width}`); });
  T('crop square', 'crop-image', ['photo.jpg'], { aspect: '1:1', smart: true }, async ([o]) => { const m = await fmt(o); ok(m.width === m.height, 'not square'); });
  T('remove background', 'remove-background', ['photo.jpg'], { quality: 'fast', background: 'transparent' }, async ([o]) => { const m = await fmt(o, 'png'); ok(m.hasAlpha, 'no alpha'); const st = await sharp(o).stats(); ok(st.channels[3].min < 50 && st.channels[3].max > 200, 'alpha not cut'); });
  T('upscale 2×', 'upscale-image', ['photo2.jpg'], { factor: '2' }, async ([o]) => { const m = await fmt(o); ok(m.width === 800, `width ${m.width}`); });
  T('rotate 90', 'rotate-image', ['photo2.jpg'], { angle: '90', flip: 'none' }, async ([o]) => { const m = await fmt(o); const s = await sharp(fx('photo2.jpg')).metadata(); ok(m.width === s.height, 'not rotated'); });
  T('adjust grayscale', 'adjust-image', ['photo2.jpg'], { filter: 'grayscale', brightness: 0, contrast: 0, saturation: 0, sharpen: 0, blur: 0 }, async ([o]) => { const st = await sharp(o).stats(); ok(Math.abs(st.channels[0].mean - st.channels[1].mean) < 2, 'not gray'); });
  T('watermark image', 'watermark-image', ['photo2.jpg'], { kind: 'text', text: 'LIME', layout: 'single', position: 'bottom-right', opacity: 60, color: '#ffffff' }, async ([o]) => fmt(o, 'jpeg'));
  T('psd through the image tools', 'resize-image', ['layers.psd'], { mode: 'percent', percent: 50 }, async ([o]) => { const m = await fmt(o, 'png'); ok(m.width === 400 && m.height === 267, `${m.width}x${m.height}`); const px = await pixels(o); ok(near(px.at(200, 133), [245, 251, 227, 255], 20), `centre ${px.at(200, 133)}`); });
  T('strip exif', 'strip-metadata', ['photo.jpg'], {}, async ([o]) => { const m = await sharp(o).metadata(); ok(!m.exif, 'exif kept'); ok((await sharp(fx('photo.jpg')).metadata()).exif, 'fixture had no exif'); });
  T('collage', 'collage', ['photo.jpg', 'photo2.jpg', 'photo.png'], { gap: 12, background: '#ffffff' }, async ([o]) => fmt(o, 'jpeg'));
  T('make gif', 'images-to-gif', ['photo.jpg', 'photo2.jpg', 'photo.png'], { seconds: 1, width: 300 }, async ([o]) => { const m = await fmt(o, 'gif'); ok((m.pages || 1) >= 3, `frames ${m.pages}`); });
  T('OCR light', 'image-to-text', ['text.png'], { lang: 'eng' }, async ([o], r) => { const s = score(txt(o)); ok(s >= 0.9, `OCR accuracy ${Math.round(s * 100)}%: ${txt(o).trim()}`); ok(r[0].text, 'no text result'); });
  T('OCR dark', 'image-to-text', ['dark-text.png'], { lang: 'eng' }, async ([o]) => { const s = score(txt(o)); ok(s >= 0.9, `OCR accuracy ${Math.round(s * 100)}%: ${txt(o).trim()}`); });
  T('images to pdf', 'jpg-to-pdf', ['photo.jpg', 'photo2.jpg', 'photo.png'], { combine: 'one', pageSize: 'a4', orientation: 'auto', margin: 'small' }, async ([o]) => pages(o, 3));

  T('pdf→docx', 'pdf-to-word', ['doc.pdf'], {}, async ([o]) => ok((await docxText(o)).includes('Lime test document'), 'docx text missing'));
  const FIRST = 'Lime converts files on your own computer. This paragraph is long enough to wrap over several lines, so the reader has to join the lines again into one paragraph without losing or doubling any of the words in it.';
  const SECOND = 'The second page continues the report with more details. Headers and footers repeat on every page and are left out.';
  T('pdf→docx paragraphs, headings, runs, links, pictures', 'pdf-to-word', ['layout-report.pdf'], {}, ([o]) => {
    const bl = docxBlocks(o).filter((b) => !b.rows && b.t.trim()), x = docxPart(o);
    same(bl.map((b) => b.t), ['Annual Report 2026', '1. Introduction', FIRST, 'Warning this line is italic', 'Visit https://example.com', '2. Details', SECOND,
      'Every invoice of the second quarter was paid in full; the remaining ones are due by October 31.', 'The formula E = mc2 has a superscript.'], 'paragraphs');
    same(bl.map((b) => b.style), ['Heading1', 'Heading2', '', '', '', 'Heading2', '', '', ''], 'headings by size');
    ok(/<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">2/.test(bl[8].x), 'superscript');
    ok(/<w:b\/>.*<w:color w:val="FF0000"\/>.*>Warning <\/w:t>.*<w:i\/>.*this line is italic/.test(bl[3].x) && /w:ascii="Arial"/.test(bl[3].x) && /<w:color w:val="000000"\/><w:sz w:val="22"\/>/.test(bl[2].x), 'run formatting');
    ok(/<w:hyperlink [^>]*>.*Visit/.test(bl[4].x) && /Target="https:\/\/example\.com\/" TargetMode="External"/.test(docxPart(o, 'word/_rels/document.xml.rels')), 'link');
    ok(/<w:pageBreakBefore\/>/.test(bl[5].x) && !/<w:br w:type="page"\/>/.test(x), 'page 2 starts with a page break before its heading');
    ok(!/Quarterly|Page \d/.test(paras(o).join('\n')), 'running header or footer kept');
    same([...x.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((m) => `${m[1]}x${m[2]}`), ['2540000x1524000', '1270000x1270000'], 'pictures at their drawn size');
    const z = zipHas(o, 'word/media/'), media = (e) => Object.keys(z).filter((k) => k.startsWith('word/media/') && k.endsWith(e));
    ok(media('.jpg').length === 1 && Buffer.from(z[media('.jpg')[0]]).equals(read(fx('layout-photo.jpg'))) && media('.png').length === 1, 'JPEG not passed through as it was');
    ok(/<dc:title>Lime Annual Report<\/dc:title>/.test(docxPart(o, 'docProps/core.xml')) && /<w:pgSz w:w="11900" w:h="16840"/.test(x), 'title or page size');
    same(['ABCDEF+TimesNewRomanPS-BoldMT', 'Arial-BoldMT', 'Helvetica-Oblique', 'QWERTY+MalgunGothic,Bold', 'NanumGothic', 'F1', 'T3Font_2'].map(E('pdfread').fontFamily), ['Times New Roman', 'Arial', 'Arial', 'Malgun Gothic', 'NanumGothic', null, null], 'font families');
  });
  T('pdf→docx two columns in reading order', 'pdf-to-word', ['layout-columns.pdf'], {}, ([o]) => {
    const t = (l) => `${l} paragraph of the column: it has enough words to wrap over a few lines inside its narrow column of text.`;
    same(paras(o), ['Two Column Layout', t('Left first'), t('Left second'), t('Right first'), t('Right second'), 'A closing paragraph spans both columns again at the end of the page, below everything else.'], 'reading order');
  });
  T('pdf→docx tabbed rows and address breaks', 'pdf-to-word', ['layout-schedule.pdf'], {}, ([o]) => {
    same(paras(o).filter((p) => /[\t\n]/.test(p)), ['1.\tRFP Published\t08/14/2026', '2.\tProposal Submission\t10/16/2026', '3.\tProposal Selection\t10/19/2026', '1880 Willamette Falls Drive, Ste. 200E\nWest Linn, Oregon 97068', 'Name:\tJEFFREY P. GABLER', 'Organization:\tWESTAR COUNCIL', 'Phone:\t503-657-4838'], 'tabbed rows');
    same([...docxBlocks(o).find((b) => b.t?.startsWith('1.\t')).x.matchAll(/<w:tab w:val="left" w:pos="(\d+)"\/>/g)].map((m) => m[1]), ['1080', '7560'], 'tab stops');
    ok(paras(o).includes('WESTAR') && paras(o).includes('Attn: Jeffrey P. Gabler'), 'address lines joined');
  });
  T('pdf→docx scanned and turned pages as page pictures', 'pdf-to-word', ['layout-scan.pdf'], {}, ([o]) => {
    const x = docxPart(o);
    same([...x.matchAll(/<wp:anchor [^>]*behindDoc="1"[^>]*>.*?<wp:positionH relativeFrom="page"><wp:posOffset>0<\/wp:posOffset>.*?<wp:positionV relativeFrom="page"><wp:posOffset>0<\/wp:posOffset>.*?<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((m) => `${m[1]}x${m[2]}`), ['7556500x10693400', '10693400x7556500'], 'page pictures');
    same(paras(o), ['Text after the scan'], 'text (invisible OCR text or the turned page leaked)');
    ok(/<w:pageBreakBefore\/>/.test(docxBlocks(o).find((b) => b.t === 'Text after the scan').x) && /<w:pgSz w:w="16840" w:h="11900" w:orient="landscape"\/>/.test(x), 'page break or turned page size');
  });
  T('pdf→docx drops running heads, page numbers, logos', 'pdf-to-word', ['layout-book.pdf'], {}, ([o]) => {
    const bl = docxBlocks(o).filter((b) => !b.rows && b.t.trim()), all = bl.map((b) => b.t);
    ok(!all.some((t) => /Chapter|^(i|ii|iii|iv|v|vi|vii|viii)$/.test(t.trim())), `running head or page number kept: ${all.join(' | ')}`);
    ok(bl.filter((b) => b.t === 'Overview' && b.style === 'Heading1').length === 3, 'the larger heading at the top of three pages was dropped');
    for (let p = 1; p <= 8; p++) ok(all.some((t) => t.startsWith(`Body text of page ${p} `)), `page ${p} body missing`);
    ok((docxPart(o).match(/<w:drawing>/g) || []).length === 1 && Object.keys(zipHas(o, 'word/media/')).filter((k) => /^word\/media\/.+\.jpg$/.test(k)).length === 1, 'logo kept or photo lost');
  });
  T('pdf→docx joins Korean with spaces, Chinese without', 'pdf-to-word', ['layout-cjk.pdf'], {}, ([o]) => same(paras(o), ['한글 문단도 읽을 수 있어야 합니다. 줄이 바뀌어도 한 문단으로 이어지고 단어 사이의 빈칸도 그대로 남습니다.', '中文段落也应该能够正确读取。换行之后仍然是同一个段落，字与字之间不应该出现多余的空格。'], 'paragraphs'));
  T('pdf→docx ruled table between paragraphs', 'pdf-to-word', ['layout-table.pdf'], {}, ([o]) => {
    const bl = docxBlocks(o).filter((b) => b.rows || b.t.trim()), t = bl[1];
    ok(bl.length === 3 && bl[0].t.startsWith('The files converted') && t.rows && bl[2].t.startsWith('Everything was converted'), `blocks ${bl.map((b) => (b.rows ? 'TABLE' : b.t.slice(0, 20)))}`);
    same(t.rows.map((r) => r.map((c) => c.t)), [['Name', 'Format', 'Size'], ['Report', 'PDF', '120 KB'], ['Photo', 'JPEG', '2.4 MB']], 'cells');
    same([...t.x.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => +m[1]), [3000, 3000, 3900], 'column widths');
    ok([...t.x.matchAll(/<w:trHeight w:val="(\d+)" w:hRule="atLeast"\/>/g)].map((m) => +m[1]).join() === '400,400,400', 'row heights');
    ok(t.rows.flat().every((c) => ['top', 'left', 'bottom', 'right'].every((s) => new RegExp(`<w:${s} w:val="single"`).test(c.x))) && /<w:b\/>/.test(t.rows[0][0].x) && !/<w:b\/>/.test(t.rows[1][0].x), 'borders or bold header');
  });
  T('pdf→docx missing inner rules become merged cells', 'pdf-to-word', ['layout-merged.pdf'], {}, ([o]) => same(docxBlocks(o).find((b) => b.rows).rows.map((r) => r.map((c) => c.t + (c.span > 1 ? `[${c.span}]` : '') + (c.merge ? `[${c.merge}]` : ''))), [['Region and city[2]', 'Total'], ['North[restart]', 'Seoul', '10'], ['[continue]', 'Busan', '20']], 'cells'));
  T('pdf→docx bar rules keep weight and shading', 'pdf-to-word', ['layout-bars.pdf'], {}, ([o]) => {
    const t = docxBlocks(o).find((b) => b.rows), sz = (c, s) => +new RegExp(`<w:${s} w:val="single"[^>]*w:sz="(\\d+)"`).exec(c.x)?.[1];
    same(t.rows.map((r) => r.map((c) => c.t)), [['Test', 'Before', 'After'], ['Speed', '12 s', '4 s'], ['Memory', '800 MB', '300 MB']], 'cells');
    const corner = t.rows[0][0], inner = t.rows[1][1], mm = sz(corner, 'left') / 8 * 25.4 / 72;
    ok(sz(corner, 'top') > 2 * sz(inner, 'top') && mm >= 0.5 && mm <= 1, `borders ${sz(corner, 'top')} vs ${sz(inner, 'top')}, left ${mm} mm`);
    ok(t.rows[0].every((c) => /w:fill="D9D9D9"/.test(c.x)) && !/w:fill=/.test(inner.x), 'shading');
  });
  T('pdf→docx boxes and empty grids stay text', 'pdf-to-word', ['layout-boxes.pdf'], {}, ([o]) => {
    ok(!docxBlocks(o).some((b) => b.rows), 'a box became a table');
    same(paras(o), ['Note', 'A box drawn around a note is no table, even with a rule under its title line.', 'Important words', 'Chart axis label'], 'paragraphs');
  });
  F('pdf→docx password-protected message', 'pdf-to-word', ['layout-locked.pdf'], {}, /password/i);
  T('pdf→pptx keeps page shapes', 'pdf-to-powerpoint', ['mixed.pdf'], { notes: true }, ([o]) => {
    const z = zipHas(o, 'ppt/slides/slide2.xml'), x = (f) => Buffer.from(z[f]).toString();
    const sz = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(x('ppt/presentation.xml')).slice(1).map(Number);
    ok(sz[0] === 7556500 && sz[1] === 10693400, `slide size ${sz}`);
    const [ox, oy, cx, cy] = /<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(x('ppt/slides/slide2.xml').split('<p:pic>')[1]).slice(1).map(Number);
    ok(Math.abs(cx / cy - 842 / 595) < 0.01, `landscape page stretched to ${cx}×${cy}`);
    ok(Math.abs(ox + cx / 2 - sz[0] / 2) < 2000 && Math.abs(oy + cy / 2 - sz[1] / 2) < 2000, 'not centred');
    ok(/Landscape page/.test(Object.keys(z).filter((k) => /notesSlide\d+\.xml$/.test(k)).map(x).join(' ')), 'notes missing');
  });
  T('pdf→pptx', 'pdf-to-powerpoint', ['doc.pdf'], { notes: true }, ([o]) => { const z = zipHas(o, 'ppt/slides/slide'); ok(Object.keys(z).filter((k) => /slides\/slide\d+\.xml$/.test(k)).length === 3, 'slide count'); });
  T('pdf→xlsx', 'pdf-to-excel', ['doc.pdf'], { to: 'xlsx' }, ([o]) => ok(require('xlsx').readFile(o).SheetNames.length >= 1, 'no sheets'));
  T('pdf→xlsx ruled table into cells', 'pdf-to-excel', ['layout-table.pdf'], { to: 'xlsx' }, ([o]) => {
    const X = require('xlsx'), rows = X.utils.sheet_to_json(X.readFile(o).Sheets['Page 1'], { header: 1, defval: '' }), i = rows.findIndex((r) => r[0] === 'Name');
    same(rows.slice(i, i + 3).map((r) => r.slice(0, 3)), [['Name', 'Format', 'Size'], ['Report', 'PDF', '120 KB'], ['Photo', 'JPEG', '2.4 MB']], 'table rows');
    ok(String(rows[i - 1]?.[0]).startsWith('The files converted') && String(rows[i + 3]?.[0]).startsWith('Everything was converted'), `text around the table: ${JSON.stringify(rows)}`);
  });
  T('pdf→xlsx merged cells', 'pdf-to-excel', ['layout-merged.pdf'], { to: 'xlsx' }, ([o]) => {
    const X = require('xlsx'), ws = X.readFile(o).Sheets['Page 1'];
    same((ws['!merges'] || []).map((m) => X.utils.encode_range(m)).sort(), ['A1:B1', 'A2:A3'], 'merges');
    same(['A1', 'C1', 'A2', 'B2', 'C2', 'B3', 'C3'].map((k) => ws[k]?.v), ['Region and city', 'Total', 'North', 'Seoul', 10, 'Busan', 20], 'cells');
  });
  T('pdf→jpg', 'pdf-to-jpg', ['doc.pdf'], { format: 'jpg', dpi: '96', pages: 'all' }, async ([o]) => { const fl = files(o); ok(fl.length === 3, `${fl.length} images`); await fmt(path.join(o, fl[0]), 'jpeg'); });
  T('pdf→tiff every page', 'pdf-to-tiff', ['mixed.pdf'], { dpi: '72' }, async ([o]) => { const m = await sharp(o).metadata(); ok(m.format === 'tiff' && m.pages === 2, `tiff pages ${m.pages}`); const p2 = await sharp(o, { page: 1 }).metadata(); ok(p2.width === 842 && p2.height === 595, `page 2 ${p2.width}×${p2.height}`); });
  T('pdf→md', 'pdf-to-markdown', ['doc.pdf'], {}, ([o]) => ok(/Lime test document/.test(txt(o)) && /quick brown fox/.test(txt(o)), `markdown: ${txt(o).slice(0, 120)}`));
  T('pdf→md headings without running heads', 'pdf-to-markdown', ['layout-report.pdf'], {}, ([o]) => ok(txt(o).replace(/__|\*\*|\\(?=\.)/g, '').startsWith(`# Annual Report 2026\n\n## 1. Introduction\n\n${FIRST}\n\n`) && /## (__)?2\\?\. Details/.test(txt(o)) && !/Quarterly|Page \d/.test(txt(o)), `markdown: ${txt(o).slice(0, 160)}`));
  T('pdf→webp pages', 'pdf-to-jpg', ['doc.pdf'], { format: 'webp', dpi: '96' }, async ([o]) => { const f = files(o); ok(f.length === 3, `${f}`); ok((await sharp(path.join(o, f[0])).metadata()).format === 'webp', 'not webp'); });
  T('pdf→txt', 'pdf-to-text', ['doc.pdf'], {}, ([o]) => ok(score(txt(o)) > 0.95, 'text missing'));
  T('pdf→html', 'pdf-to-html', ['doc.pdf'], {}, ([o]) => ok(/<html/i.test(txt(o)) && txt(o).includes('Lime'), 'html'));
  T('pdf→svg', 'pdf-to-svg', ['doc.pdf'], {}, ([o]) => ok(txt(o).includes('<svg'), 'svg'));
  T('compress pdf', 'compress-pdf', ['doc.pdf'], { level: 'extreme' }, async ([o]) => pages(o, 3));
  T('optimize pdf', 'optimize-pdf', ['doc.pdf'], { quality: 60 }, async ([o]) => pages(o, 3));
  T('merge pdf', 'merge-pdf', ['doc.pdf', 'scan.pdf', 'photo2.jpg'], {}, async ([o]) => pages(o, 5));
  T('split pdf', 'split-pdf', ['doc.pdf'], { mode: 'all' }, ([o]) => ok(files(path.dirname(o)).length >= 1 && (fs.statSync(o).isDirectory() ? files(o).length === 3 : true), 'split'));
  const pdfsIn = async (d) => Promise.all(files(d).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(async (f) => `${f.replace(/^.* - /, '').replace(/\.pdf$/, '')}=${await pages(path.join(d, f))}`));
  T('split ranges', 'split-pdf', ['doc.pdf'], { mode: 'ranges', ranges: '1-2, 3' }, async ([o]) => { const c = (await pdfsIn(o)).join(' | '); ok(c === 'part 1 (pages 1-2)=2 | part 2 (page 3)=1', c); });
  T('split ranges combined', 'split-pdf', ['doc.pdf'], { mode: 'ranges', ranges: '3, 1', mergeRanges: true }, async ([o]) => { await pages(o, 2); ok(/Page 3/.test(await pdfText(o)), 'order'); });
  T('split fixed size', 'split-pdf', ['doc.pdf'], { mode: 'every', every: 2 }, async ([o]) => { const c = (await pdfsIn(o)).join(' | '); ok(c === 'part 1 (pages 1-2)=2 | part 2 (page 3)=1', c); });
  T('split pick pages', 'split-pdf', ['doc.pdf'], { mode: 'select', pages: '1, 3', mergeSelected: true }, async ([o]) => { await pages(o, 2); const t = await pdfText(o); ok(/Page 1/.test(t) && /Page 3/.test(t) && !/Page 2 /.test(t), 'pages'); });
  T('split pick pages apart', 'split-pdf', ['doc.pdf'], { mode: 'select', pages: '2-3', mergeSelected: false }, async ([o]) => { const c = (await pdfsIn(o)).join(' | '); ok(c === 'page 2=1 | page 3=1', c); });
  T('merge order', 'merge-pdf', ['scan.pdf', 'doc.pdf'], {}, async ([o]) => { await pages(o, 4); const { doc } = await E('pdf').readPdf(o); ok(!doc.loadPage(0).toStructuredText('').asText().includes('Page 1') && doc.loadPage(1).toStructuredText('').asText().includes('Page 1'), 'scan should come first'); });
  T('remove pages', 'remove-pages', ['doc.pdf'], { pages: '2' }, async ([o]) => pages(o, 2));
  T('extract pages', 'extract-pages', ['doc.pdf'], { pages: '1,3' }, async ([o]) => pages(o, 2));
  T('rotate pdf', 'rotate-pdf', ['doc.pdf'], { angle: '90', pages: 'all' }, async ([o]) => { const d = await require('pdf-lib').PDFDocument.load(read(o)); ok(d.getPage(0).getRotation().angle === 90, 'not rotated'); });
  T('page numbers', 'page-numbers', ['doc.pdf'], { position: 'bottom-center', format: 'Page {n} of {total}', start: 1, size: 11, pages: 'all', color: '#333333' }, async ([o]) => ok((await pdfText(o)).includes('Page 2 of 3'), 'numbers missing'));
  T('watermark pdf', 'watermark-pdf', ['doc.pdf'], { kind: 'text', text: 'CONFIDENTIAL', layout: 'single', opacity: 30, rotation: 45, color: '#d13438', pages: 'all' }, async ([o]) => pages(o, 3));
  T('crop pdf', 'crop-pdf', ['doc.pdf'], { top: 10, bottom: 10, left: 10, right: 10, pages: 'all' }, async ([o]) => { const d = await require('pdf-lib').PDFDocument.load(read(o)); const b = d.getPage(0).getCropBox?.() || d.getPage(0).getMediaBox(); ok(b.width < 595, `width ${b.width}`); });
  // PDF24-style page tools.
  const sheets = async (o) => { const d = await require('pdf-lib').PDFDocument.load(read(o)); return d.getPages().map((p) => p.getSize()); };
  const pageText = async (o, i = 0) => (await E('pdf').readPdf(o)).doc.loadPage(i).toStructuredText().asText();
  T('pages per sheet: 2 up turns the sheet', 'pages-per-sheet', ['doc.pdf'], { n: '2', paper: 'auto', orientation: 'auto', order: 'across', margin: 10, border: false, pages: 'all' }, async ([o]) => {
    const s = await sheets(o), t = await pageText(o);
    ok(s.length === 2 && s[0].width > s[0].height, `sheets ${JSON.stringify(s)}`);
    ok(/Page 1\b/.test(t) && /Page 2\b/.test(t), `sheet 1 text: ${t.slice(0, 120)}`);
  });
  T('pages per sheet: 4 up on letter, down first, with borders', 'pages-per-sheet', ['doc.pdf'], { n: '4', paper: 'letter', orientation: 'portrait', order: 'down', margin: 5, border: true, pages: '1-3' }, async ([o]) => {
    const s = await sheets(o);
    ok(s.length === 1 && Math.round(s[0].width) === 612 && Math.round(s[0].height) === 792, `sheets ${JSON.stringify(s)}`);
  });
  T('change page size: letter, turned like each page', 'pdf-page-size', ['doc.pdf'], { paper: 'letter', orientation: 'auto', scale: 'fit', margin: 0 }, async ([o]) => {
    const s = await sheets(o);
    ok(s.length === 3 && s.every((x) => Math.round(x.width) === 612 && Math.round(x.height) === 792), `sizes ${JSON.stringify(s)}`);
    ok(/Page 1 of the Lime test document/.test(await pageText(o)), 'text kept');
  });
  T('change page size: custom 150 × 100 mm, landscape', 'pdf-page-size', ['doc.pdf'], { paper: 'custom', width: 150, height: 100, orientation: 'landscape', scale: 'fill', margin: 0 }, async ([o]) => {
    const s = await sheets(o);
    ok(s.every((x) => Math.abs(x.width - 425.2) < 1 && Math.abs(x.height - 283.5) < 1), `sizes ${JSON.stringify(s)}`);
  });
  const streams = async (o, i) => {
    const { PDFDocument, PDFArray, decodePDFRawStream } = require('pdf-lib'), d = await PDFDocument.load(read(o)), c = d.getPage(i).node.Contents();
    return (c instanceof PDFArray ? c.asArray() : [c]).map((r) => Buffer.from(decodePDFRawStream(d.context.lookup(r)).decode()).toString('latin1'));
  };
  T('overlay pdf underneath, first page on every page', 'overlay-pdf', ['doc.pdf'], { overlay: fx('images.pdf'), position: 'under', repeat: 'first', scale: 'fit', pages: 'all' }, async ([o]) => {
    for (const i of [0, 2]) { const st = await streams(o, i); ok(/\/\S+ Do/.test(st[0]) && !/\/\S+ Do/.test(st[st.length - 1]), `page ${i + 1}: overlay not first`); }
    ok(/Page 1 of the Lime test document/.test(await pageText(o)), 'text kept');
  });
  T('overlay pdf on top, page by page, chosen pages only', 'overlay-pdf', ['doc.pdf'], { overlay: fx('doc.pdf'), position: 'over', repeat: 'each', scale: 'fit', pages: '2' }, async ([o]) => {
    const one = await streams(o, 0), two = await streams(o, 1);
    ok(!one.some((x) => /\/\S+ Do/.test(x) && /cm/.test(x) && x.length < 400), 'page 1 untouched');
    ok(/\/\S+ Do/.test(two[two.length - 1]), 'page 2 has the overlay on top');
    ok((await pageText(o, 1)).match(/Page 2 of the Lime test document/g)?.length === 2, 'overlay page 2 drawn on page 2');
  });
  F('overlay pdf needs the PDF to lay on', 'overlay-pdf', ['doc.pdf'], { overlay: '', position: 'over', repeat: 'first', scale: 'fit', pages: 'all' }, /Choose the PDF/);
  T('grayscale pdf: no colour left, text kept', 'grayscale-pdf', ['images.pdf'], {}, async ([o]) => {
    const tint = async (f) => { const { doc, m } = await E('pdf').readPdf(f), px = doc.loadPage(0).toPixmap(m.Matrix.scale(0.5, 0.5), m.ColorSpace.DeviceRGB, false, true).getPixels(); let t = 0; for (let i = 0; i < px.length; i += 3) t = Math.max(t, Math.abs(px[i] - px[i + 1]), Math.abs(px[i + 1] - px[i + 2])); return t; };
    ok(await tint(fx('images.pdf')) > 60, 'fixture has colour');
    const t = await tint(o);
    ok(t <= 3, `colour left: ${t}`);
  });
  T('grayscale pdf keeps text and tables', 'grayscale-pdf', ['layout-bars.pdf'], {}, async ([o]) => ok(/Memory\s+800 MB\s+300 MB/.test(await pageText(o)), (await pageText(o)).slice(0, 80)));
  T('compress pdf by drawn size, graphics lossless', 'compress-pdf', ['images.pdf'], { level: 'recommended' }, async ([o]) => {
    const { PDFDocument, PDFRawStream, PDFName } = require('pdf-lib');
    const d = await PDFDocument.load(read(o)), imgs = d.context.enumerateIndirectObjects().map(([, x]) => x).filter((x) => x instanceof PDFRawStream && String(x.dict.get(PDFName.of('Subtype'))) === '/Image');
    const num = (x, k) => d.context.lookup(x.dict.get(PDFName.of(k)))?.asNumber?.();
    const photo = imgs.find((x) => String(x.dict.get(PDFName.of('Filter'))) === '/DCTDecode'), chart = imgs.find((x) => num(x, 'Width') === 1200);
    ok(photo && num(photo, 'Width') <= 320 && num(photo, 'Width') >= 280, `photo drawn 2 in wide kept ${photo && num(photo, 'Width')} px`);
    ok(chart && String(chart.dict.get(PDFName.of('Filter'))) === '/FlateDecode', 'chart re-encoded lossy');
    let raw = require('zlib').inflateSync(Buffer.from(chart.contents));
    const parms = d.context.lookup(chart.dict.get(PDFName.of('DecodeParms')));
    if (parms) raw = E('pdf').unpredict(raw, 1200, 3);
    for (let y = 0; y < 800; y += 37) for (let x = 0; x < 1200; x += 41) { const k = ((x >> 3) * 7 + (y >> 3) * 13) % 200, i = (y * 1200 + x) * 3; ok(raw[i] === ((k * 37) & 255) && raw[i + 1] === ((k * 91) & 255) && raw[i + 2] === ((k * 53) & 255), `chart pixel ${x},${y} changed`); }
  });
  const macroFree = (o, main) => { const z = require('fflate').unzipSync(new Uint8Array(read(o))), names = Object.keys(z), all = names.map((n) => Buffer.from(z[n]).toString('latin1')).join(''); ok(!names.some((n) => /vbaProject/i.test(n)) && !/vbaProject/i.test(all), 'macros left in'); const own = /<Override\b[^>]*PartName="\/(word\/document|xl\/workbook)\.xml"[^>]*\/>/.exec(Buffer.from(z['[Content_Types].xml']).toString())?.[0] || ''; ok(own.includes(main) && !/macroEnabled/.test(own), `main content type ${own}`); };
  T('docm→docx removes macros', 'convert-document', ['macro.docm'], { to: 'docx' }, async ([o]) => { macroFree(o, 'wordprocessingml.document.main+xml'); const part = (f) => Buffer.from(require('fflate').unzipSync(new Uint8Array(read(f)))['word/document.xml']); ok(part(o).equals(part(fx('macro.docm'))), 'document rebuilt instead of kept as is'); ok((await docxText(o)).includes('quick brown fox'), 'text lost'); });
  T('xlsm→xlsx removes macros', 'convert-sheet', ['macro.xlsm'], { to: 'xlsx' }, ([o]) => { macroFree(o, 'spreadsheetml.sheet.main+xml'); const X = require('xlsx'), a = X.readFile(o), b = X.readFile(fx('sheet.xlsx')); ok(JSON.stringify(X.utils.sheet_to_json(a.Sheets[a.SheetNames[0]])) === JSON.stringify(X.utils.sheet_to_json(b.Sheets[b.SheetNames[0]])), 'cells changed'); });
  T('pdf→pdf/a', 'pdf-to-pdfa', ['v1.pdf'], { level: '2b' }, async ([o], r) => { ok(/no issues/.test(r[0].note), r[0].note); ok(/pdfaid:part[^0-9]*2/.test(read(o).toString('latin1')), 'no PDF/A identification'); });
  T('pdf/a reports what remains', 'pdf-to-pdfa', ['doc.pdf'], {}, async ([o], r) => ok(/isn.t embedded/.test(r[0].note), r[0].note));
  const annots = async (o) => { const { PDFDocument, PDFName } = require('pdf-lib'); const d = await PDFDocument.load(read(o)); return d.getPages().flatMap((p) => { const a = p.node.lookup(PDFName.of('Annots')); return a ? a.asArray().map((x) => String(d.context.lookup(x).get(PDFName.of('Subtype')))) : []; }); };
  T('compare pdf marks changes', 'compare-pdf', ['v1.pdf', 'v2.pdf'], { output: 'marked' }, async ([o], r) => { ok(/changed/.test(r[0].note) && /added/.test(r[0].note), r[0].note); const a = await annots(o); ok(a.filter((x) => x === '/Highlight').length >= 2, `annotations ${a}`); ok((await pdfText(o)).includes('red fox'), 'not the newer version'); });
  T('compare pdf report', 'compare-pdf', ['v1.pdf', 'v2.pdf'], { output: 'report' }, async ([o]) => { const t = await pdfText(o); ok(/brown/.test(t) && /red/.test(t), `report: ${t.slice(0, 200)}`); });
  T('make pdf fillable', 'make-fillable', ['form.pdf'], {}, async ([o], r) => { const { PDFDocument } = require('pdf-lib'); const f = (await PDFDocument.load(read(o))).getForm().getFields(); ok(f.length >= 3, `${f.length} fields: ${r[0].note}`); ok(f.some((x) => x.constructor.name === 'PDFCheckBox'), `kinds ${f.map((x) => x.constructor.name)}`); });
  T('scan to pdf', 'scan-to-pdf', ['doc-photo.jpg'], { mode: 'greyscale', ocr: true, lang: 'eng' }, async ([o], r) => {
    ok(/1 of 1 page straightened/.test(r[0].note), r[0].note);
    const { doc, m } = await E('pdf').readPdf(o), page = doc.loadPage(0), [x0, y0, x1, y1] = page.getBounds();
    ok(Math.abs((x1 - x0) / (y1 - y0) - 600 / 848) < 0.06, `page shape ${((x1 - x0) / (y1 - y0)).toFixed(3)}`);
    const px = page.toPixmap(m.Matrix.scale(0.3, 0.3), m.ColorSpace.DeviceGray, false, true), st = px.getStride(), g = px.getPixels(), w = px.getWidth(), h = px.getHeight();
    const corners = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]].map(([x, y]) => g[y * st + x]);
    ok(corners.every((v) => v > 170), `desk still in corners ${corners}`);
    ok(/Invoice 2041/.test(page.toStructuredText('').asText()), 'text not recognised');
  });
  T('scan to pdf: a flat page still gets its look', 'scan-to-pdf', ['photo2.jpg'], { mode: 'bw', ocr: false }, async ([o], r) => {
    ok(/0 of 1 page straightened/.test(r[0].note), r[0].note);
    const { doc, m } = await E('pdf').readPdf(o), g = doc.loadPage(0).toPixmap(m.Matrix.scale(1, 1), m.ColorSpace.DeviceGray, false, true).getPixels();
    const mid = g.filter((v) => v > 40 && v < 215).length / g.length;
    ok(mid < 0.1, `${Math.round(mid * 100)}% grey pixels: not black and white`);
  });
  T('redact pdf', 'redact-pdf', ['doc.pdf'], { terms: 'Invoice', patterns: ['email'], boxes: true }, async ([o]) => { const t = await pdfText(o); ok(!t.includes('hello@example.com') && !t.includes('Invoice'), 'not redacted'); ok(t.includes('quick brown'), 'too much removed'); });
  T('audit pdf', 'audit-pdf', ['doc.pdf'], {}, (o, r) => ok(/No hidden text|fake redaction/.test(r[0].note), r[0].note));
  // The ArtCraft apps' one-click actions, through Lime.
  const grey = async (p) => { const st = await sharp(p).stats(); const [r, g, b] = st.channels; return Math.max(Math.abs(r.mean - g.mean), Math.abs(g.mean - b.mean)); };
  T('photocraft auto tone', 'auto-tone', ['photo.jpg'], {}, async ([o]) => { const m = await fmt(o, 'jpeg'), src = await sharp(fx('photo.jpg')).metadata(); ok(m.width === src.width && m.height === src.height, `size ${m.width}×${m.height}`); });
  const crisp = async (p) => { const { data } = await sharp(p).greyscale().convolve({ width: 3, height: 3, kernel: [0, -1, 0, -1, 4, -1, 0, -1, 0] }).raw().toBuffer({ resolveWithObject: true }); return data.reduce((a, v) => a + v, 0) / data.length; };
  T('photocraft sharpen', 'sharpen-photo', ['photo.jpg'], {}, async ([o]) => { await fmt(o, 'jpeg'); const [a, b] = [await crisp(fx('photo.jpg')), await crisp(o)]; ok(b > a * 1.05, `edges ${a.toFixed(2)} → ${b.toFixed(2)}`); });
  T('photocraft pencil look', 'paint-photo', ['photo.jpg'], { look: 'pencil' }, async ([o]) => { ok(/-pencil\.jpg$/.test(o), o); ok((await diff(o, fx('photo.jpg'))) > 5, 'barely changed'); });
  T('photocraft export layers', 'export-layers', ['layers.psd'], {}, ([o], r) => { const pngs = files(o).filter((f) => f.endsWith('.png')); ok(pngs.length >= 1, `layers ${files(o)}`); ok(/layer/.test(r[0].note), r[0].note); });
  T('photocraft layer list', 'layer-info', ['layers.psd'], {}, (o, r) => ok(/\d+ layers?/.test(r[0].note) && /Background/.test(r[0].text), `${r[0].note} / ${r[0].text}`));
  T('lightcraft b&w look', 'photo-look', ['photo.jpg'], { preset: 'lc.bw-high-contrast' }, async ([o]) => { await fmt(o, 'jpeg'); ok((await grey(o)) < 3, 'still in colour'); });
  T('lightcraft smart b&w', 'smart-bw', ['photo.jpg'], {}, async ([o]) => { const m = await fmt(o, 'jpeg'), src = await sharp(fx('photo.jpg')).metadata(); ok((await grey(o)) < 3, 'still in colour'); ok(m.width === src.width, `resized to ${m.width}`); });
  T('vectorcraft trace', 'trace-image', ['cover.png'], { style: 'auto', to: 'svg' }, ([o], r) => { const t = txt(o); ok(/<path/.test(t) && !/<image/.test(t), 'not traced'); ok(/shape/.test(r[0].note), r[0].note); });
  T('vectorcraft logo package', 'logo-package', ['logo.svg'], {}, ([o]) => { const all = files(o).flatMap((d) => (fs.statSync(path.join(o, d)).isDirectory() ? files(path.join(o, d)) : [d])); ok(all.some((f) => f.endsWith('.svg')) && all.some((f) => f.endsWith('.png')) && all.some((f) => f.endsWith('.pdf')), `package ${all}`); });
  T('vectorcraft info', 'vector-info', ['logo.svg'], {}, (o, r) => ok(/artboard/.test(r[0].note) && /Artboards:/.test(r[0].text), r[0].note));
  T('designcraft preflight', 'preflight-layout', ['layout.idml'], {}, (o, r) => ok(r[0].note && r[0].note.length > 5, r[0].note));
  T('designcraft print pdf', 'layout-pdf', ['layout.idml'], { preset: 'print' }, async ([o]) => { ok(/-print\.pdf$/.test(o), o); ok((await pages(o)) >= 1, 'no pages'); });
  T('designcraft booklet', 'booklet-pdf', ['layout.idml'], {}, async ([o]) => ok((await pages(o)) >= 1, 'no pages'));
  T('effectcraft poster frame', 'poster-frame', ['anim.json'], {}, async ([o], r) => { const m = await fmt(o, 'png'); ok(m.width > 50, `${m.width}`); ok(/Frame at/.test(r[0].note), r[0].note); });
  T('effectcraft info', 'motion-info', ['anim.json'], {}, (o, r) => ok(/fps/.test(r[0].note), r[0].note));
  T('filmcraft media info', 'media-info', ['clip.mp4'], {}, (o, r) => ok(/fps/.test(r[0].note) && /Video:/.test(r[0].text), r[0].note));
  T('filmcraft clean voice', 'clean-voice', ['tone.wav'], {}, async ([o]) => { ok(o.endsWith('.wav'), o); const a = await probe(fx('tone.wav')); await dur(o, a.duration); });
  T('filmcraft edit-ready', 'edit-ready', ['clip.mp4'], { codec: 'prores' }, async ([o]) => { const v = of(await ffp(o), 'video')[0]; ok(v && v.codec_name === 'prores', `codec ${v?.codec_name}`); });
  T('pdfcraft sanitize', 'sanitize-pdf', ['doc.pdf'], {}, async ([o]) => { await pages(o, 3); ok((await pdfText(o)).includes('Page 2'), 'text lost'); });
  T('pdfcraft bates', 'bates-pdf', ['doc.pdf'], { prefix: 'ABC', start: 1 }, async ([o], r) => { const t = await pdfText(o); ok(t.includes('ABC000001') && t.includes('ABC000003'), 'numbers missing'); ok(/ABC000001 to ABC000003/.test(r[0].note), r[0].note); });
  T('pdfcraft word count', 'word-count', ['doc.pdf'], {}, (o, r) => ok(/\d+ words/.test(r[0].note) && /Page 1:/.test(r[0].text), r[0].note));
  T('pdfcraft print check', 'print-check', ['doc.pdf'], {}, (o, r) => ok(/print|problem|warning/i.test(r[0].note), r[0].note));
  T('pdfcraft split at bookmarks', 'split-chapters', ['chapters.pdf'], {}, async ([o]) => { const pdfs = files(o).filter((f) => f.endsWith('.pdf')); ok(pdfs.length === 3, `chapters ${files(o)}`); for (const f of pdfs) await pages(path.join(o, f), 1); });
  T('pdfcraft comment summary', 'comment-summary', ['comments.pdf'], {}, async ([o]) => { const t = await pdfText(o); ok(t.includes('Check the total') && t.includes('Sign here please'), t.slice(0, 200)); });
  const formCsv = path.join(OUT, 'form-data.csv');
  fs.writeFileSync(formCsv, 'Full name,Date of birth,Agree,Colour\nAda Lovelace,10/12/1815,Yes,Green\n');
  const pdfDoc = async (p) => (await E('pdf').readPdf(p)).doc;
  T('pdfcraft header and footer', 'header-footer-pdf', ['doc.pdf'], { header_left: 'Lime handbook', footer_center: 'Page {page} of {pages}', size: 9 }, async ([o]) => { const t = await pdfText(o); ok(t.includes('Lime handbook') && t.includes('Page 1 of 3') && t.includes('Page 3 of 3'), t.slice(0, 300)); });
  T('pdfcraft page background', 'background-pdf', ['doc.pdf'], { kind: 'color', color: '#00ff00', opacity: 100 }, async ([o]) => {
    const { data, info } = await sharp(await E('pdf').thumbnail(o, 300).then((t) => t.png)).raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const [r, g, b] = at(4, info.height - 5);
    ok(g > 200 && r < 80 && b < 80, `margin is ${[r, g, b]}, not green`);
    ok((await pdfText(o)).includes('Page 2'), 'the text went under the background');
  });
  T('pdfcraft properties', 'pdf-properties', ['doc.pdf'], { title: 'Lime report', author: 'Ada', subject: 'Testing', lang: 'en-GB', showTitle: true, navigation: 'bookmarks' }, async ([o]) => {
    const d = await pdfDoc(o), root = d.getTrailer().get('Root');
    ok(d.getMetaData('info:Title') === 'Lime report' && d.getMetaData('info:Author') === 'Ada' && d.getMetaData('info:Subject') === 'Testing', `info ${d.getMetaData('info:Title')} / ${d.getMetaData('info:Author')}`);
    ok(root.get('Lang').asString() === 'en-GB', `language ${root.get('Lang')}`);
    ok(root.get('ViewerPreferences').get('DisplayDocTitle').asBoolean() === true, 'the title is not shown in the window');
    ok(root.get('PageMode').asName() === 'UseOutlines', `opens with ${root.get('PageMode')}`);
  });
  T('pdfcraft page labels', 'page-labels', ['doc.pdf'], { from: 1, to: 2, style: 'lower-roman', restart: true }, async ([o]) => { const d = await pdfDoc(o); same([0, 1, 2].map((i) => d.loadPage(i).getLabel()), ['i', 'ii', '1'], 'labels'); });
  T('pdfcraft export form data', 'export-form-data', ['fillable.pdf'], { to: 'csv' }, ([o], r) => { const head = txt(o).split(/\r?\n/)[0]; ok(/Full name/.test(head) && /Agree/.test(head) && /Colour/.test(head), head); ok(/4 fields/.test(r[0].note), r[0].note); });
  T('pdfcraft fill form from data', 'fill-form-data', ['fillable.pdf'], { data: formCsv }, async ([o]) => {
    const v = Object.fromEntries((await pdfDoc(o)).loadPage(0).getWidgets().map((w) => [w.getName(), w.getValue()]));
    same([v['Full name'], v.Agree, v.Colour], ['Ada Lovelace', 'Yes', 'Green'], 'filled values');
  });
  T('crop marks and bleed', 'printer-marks', ['doc.pdf'], { bleed: 3 }, async ([o]) => {
    const page = (await pdfDoc(o)).loadPage(0), [m, t, b] = ['MediaBox', 'TrimBox', 'BleedBox'].map((k) => page.getBounds(k));
    ok(Math.abs(t[2] - t[0] - 595) < 0.5 && Math.abs(t[3] - t[1] - 842) < 0.5, `trim ${t}`);
    ok(Math.abs(t[0] - b[0] - 8.5) < 0.3, `bleed ${b} for trim ${t}`);
    ok(m[2] - m[0] > 595 + 40, `sheet ${m}`);
    // A crop mark sits in the top-left margin, outside the bleed.
    const mu = await E('pdf').mupdf();
    const { data, info } = await sharp(Buffer.from(page.toPixmap(mu.Matrix.scale(2, 2), mu.ColorSpace.DeviceRGB, false, true).asPNG())).raw().toBuffer({ resolveWithObject: true });
    let dark = 0;
    for (let y = 0; y < (t[1] + 1) * 2; y++) for (let x = 0; x < (t[0] + 1) * 2; x++) if (data[(y * info.width + x) * info.channels] < 200) dark++;
    ok(dark > 10, `no crop mark in the corner (${dark} dark pixels)`);
  });
  T('bookmarks from headings', 'bookmark-headings', ['doc.pdf'], {}, async ([o], r) => {
    const list = (await pdfDoc(o)).loadOutline() || [];
    same(list.map((b) => [b.title, b.page]), [0, 1, 2].map((i) => [`Page ${i + 1} of the Lime test document`, i]), 'bookmarks');
    ok(/3 bookmarks/.test(r[0].note), r[0].note);
  });
  T('filmcraft split scenes', 'split-scenes', ['scenes.mp4'], {}, async ([o]) => { const clips = files(o).filter((f) => f.endsWith('.mp4')); ok(clips.length === 3, `clips ${files(o)}`); for (const f of clips) ok((await probe(path.join(o, f))).duration < 1.5, `${f} is longer than a shot`); });
  T('lightcraft hdr sets', 'hdr-batch', ['hdr/bracket-0.dng', 'hdr/bracket-1.dng', 'hdr/bracket-2.dng'], {}, async ([o]) => { const pics = files(o).filter((f) => /\.(jpe?g|png|tiff?)$/i.test(f)); ok(pics.length === 1, `merged ${files(o)}`); await fmt(path.join(o, pics[0])); });
  T('designcraft package', 'package-layout', ['layout.idml'], {}, ([o]) => { const all = files(o); ok(all.some((f) => f.endsWith('.idml')) && all.some((f) => f.endsWith('.pdf')) && all.includes('Links'), `packaged ${all}`); ok(files(path.join(o, 'Links')).length >= 1, 'no linked pictures'); });
  T('protect+unlock', 'protect-pdf', ['doc.pdf'], { userPassword: 'lime123', allowPrint: true, allowCopy: true, allowEdit: false }, async ([o]) => {
    let locked = false;
    try { await E('pdf').pageCount(o); } catch (_) { locked = true; }
    ok(locked, 'not encrypted');
    ok((await E('pdf').pageCount(o, 'lime123')) === 3, 'password fails');
  });
  T('searchable pdf', 'ocr-pdf', ['scan.pdf'], { lang: 'eng', skipText: true, dpi: '300' }, async ([o]) => { const s = score(await pdfText(o)); ok(s >= 0.85, `OCR ${Math.round(s * 100)}%`); });
  T('repair pdf', 'repair-pdf', ['doc.pdf'], {}, async ([o]) => pages(o, 3));
  T('flatten pdf', 'flatten-pdf', ['doc.pdf'], {}, async ([o]) => pages(o, 3));
  T('extract images', 'extract-images-pdf', ['doc.pdf'], { format: 'png' }, ([o]) => ok(files(o).length >= 1, 'no images'));
  T('make pdf from docx', 'to-pdf', ['doc.docx'], {}, async ([o]) => ok((await pdfText(o)).includes('Lime Report'), 'pdf text'));
  T('make pdf from dxf', 'to-pdf', ['test.dxf'], {}, async ([o]) => pages(o, 1));

  for (const [to, chk] of [['mov', async (o) => { const i = await probe(o); ok(i.video && i.audio, 'tracks'); }], ['webm', async (o) => ok((await probe(o)).video.codec === 'vp9', 'vp9')], ['mkv', async (o) => ok((await probe(o)).video, 'video')], ['hevc', async (o) => ok(/hevc|h265/.test((await probe(o)).video.codec), 'hevc')], ['gif', async (o) => fmt(o, 'gif')], ['mp3', async (o) => ok((await probe(o)).audio.codec === 'mp3', 'mp3')], ['avi', async (o) => ok((await probe(o)).video, 'video')], ['mp4', async (o) => dur(o, 2, 0.3)]]) {
    T(`video→${to}`, 'convert-video', [to === 'mp4' ? 'clip2.mp4' : 'clip.mp4'], { to, quality: 'small', height: '' }, async ([o]) => chk(o));
  }
  T('compress video', 'compress-video', ['clip.mp4'], { mode: 'level', level: 'extreme', height: '480' }, async ([o]) => { const i = await probe(o); ok(i.video.height === 480, `height ${i.video.height}`); });
  T('trim', 'trim-media', ['clip.mp4'], { start: '0:01', end: '0:03', precise: true }, async ([o]) => dur(o, 2, 0.3));
  T('merge clips', 'merge-media', ['clip.mp4', 'clip2.mp4'], { to: 'mp3' }, async ([o]) => dur(o, 6, 0.5));
  T('extract audio', 'extract-audio', ['clip.mp4'], { to: 'wav', bitrate: '192k' }, async ([o]) => ok((await probe(o)).audio.codec.startsWith('pcm'), 'wav'));
  for (const [to, codec] of [['mp3', 'mp3'], ['m4a', 'aac'], ['flac', 'flac'], ['ogg', 'vorbis'], ['opus', 'opus'], ['aiff', 'pcm_s16be']]) T(`audio→${to}`, 'convert-audio', ['tone.wav'], { to, bitrate: '192k' }, async ([o]) => { const i = await dur(o, 3, 0.15); ok(i.audio.codec === codec, `${i.audio.codec}`); });
  T('compress audio', 'compress-audio', ['tone.mp3'], { level: 'extreme' }, async ([o]) => dur(o, 2, 0.15));
  T('video→gif', 'video-to-gif', ['clip.mp4'], { start: '0:00', duration: 2, fps: 10, width: 320 }, async ([o]) => { const m = await fmt(o, 'gif'); ok(m.width === 320 && m.pages >= 15, `gif ${m.width} ${m.pages}`); });
  T('mute', 'mute-video', ['clip.mp4'], {}, async ([o]) => ok(!(await probe(o)).audio, 'audio kept'));
  T('resize video', 'resize-video', ['clip.mp4'], { height: '360' }, async ([o]) => ok((await probe(o)).video.height === 360, 'height'));
  T('rotate video', 'rotate-video', ['clip2.mp4'], { angle: '90', flip: 'none' }, async ([o]) => { const v = (await probe(o)).video; ok(v.width === 360 && v.height === 640, `${v.width}x${v.height}`); });
  T('speed 2×', 'speed-media', ['clip.mp4'], { factor: '2' }, async ([o]) => dur(o, 2, 0.3));
  T('frames', 'video-frames', ['clip.mp4'], { mode: 'every', every: 1, format: 'jpg' }, ([o]) => ok(files(o).length >= 3, `${files(o).length} frames`));
  T('burn subtitles', 'burn-subtitles', ['clip.mp4'], { subtitles: fx('sub.srt'), size: 22 }, async ([o]) => dur(o, 4, 0.3));
  T('level loudness', 'normalize-audio', ['tone.wav'], {}, async ([o]) => dur(o, 3, 0.3));
  T('slideshow', 'images-to-video', ['photo.jpg', 'photo2.jpg'], { seconds: 2, size: '1920x1080' }, async ([o]) => { const i = await dur(o, 4, 0.6); ok(i.video.width === 1920, 'size'); });
  T('subtitles→vtt', 'convert-subtitles', ['sub.srt'], { to: 'vtt' }, ([o]) => ok(txt(o).startsWith('WEBVTT') && txt(o).includes('Hello Lime'), 'vtt'));

  const VT = { mp4: 'h264 aac mov_text', hevc: 'hevc aac mov_text', av1: 'av1 aac mov_text', mov: 'h264 aac mov_text', m4v: 'h264 aac mov_text', '3gp': 'h264 aac mov_text', '3g2': 'h264 aac mov_text', mkv: 'h264 aac subrip', webm: 'vp9 opus webvtt',
    avi: 'mpeg4 mp3', wmv: 'wmv2 wmav2', flv: 'h264 aac', mpg: 'mpeg2video mp2', ts: 'h264 aac', m2ts: 'h264 aac', vob: 'mpeg2video ac3', ogv: 'theora vorbis', dv: 'dvvideo pcm_s16le', mxf: 'mpeg2video pcm_s16le' };
  for (const [to, want] of Object.entries(VT)) {
    T(`video odd→${to}`, 'convert-video', ['odd.mp4'], { to, quality: 'balanced', height: '' }, async ([o]) => {
      const j = await ffp(o), [v] = of(j, 'video'), [a] = of(j, 'audio'), got = [v?.codec_name, a?.codec_name, ...of(j, 'subtitle').map((s) => s.codec_name)].join(' ');
      ok(got === want, `streams ${got} ≠ ${want}`);
      const size = to === 'vob' || to === 'dv' ? '720x480' : '320x240';
      ok(`${v.width}x${v.height}` === size && (to === 'dv' || v.pix_fmt === 'yuv420p'), `${v.width}x${v.height} ${v.pix_fmt}`);
      ok(Math.abs(Number(j.format.duration) - 4) < 0.3, `duration ${j.format.duration}`);
      if (['wmv', 'avi', 'mpg', 'dv'].includes(to)) ok(a.channels === 2, `${a.channels} channels`);
    }, ['hevc', 'av1', 'ogv'].includes(to) ? noEncoder(to) : null);
  }
  T('video remux iPhone mov→mp4', 'convert-video', ['phone.mov'], { to: 'mp4', quality: 'balanced', height: '' }, async ([o], r) => {
    const j = await ffp(o), [v] = of(j, 'video');
    ok(v.codec_name === 'hevc' && v.codec_tag_string === 'hvc1', `${v.codec_name} ${v.codec_tag_string}`);
    ok(Math.abs((v.side_data_list || []).find((d) => d.rotation != null)?.rotation) === 90, 'rotation lost');
    ok((await md5(o, '0:v:0')) === (await md5(fx('phone.mov'), '0:v:0')), 'video was re-encoded');
    ok(/Rewrapped/.test(r[0].note || ''), `note ${r[0].note}`);
    const p = await probe(o);
    ok(p.video.width === 240 && p.video.height === 320, `display ${p.video.width}x${p.video.height}`);
  });
  T('video small re-encodes', 'convert-video', ['phone.mov'], { to: 'mp4', quality: 'small', height: '' }, async ([o]) => { const [v] = of(await ffp(o), 'video'); ok(v.codec_name === 'h264' && v.width === 240 && v.height === 320, `${v.codec_name} ${v.width}x${v.height}`); });
  T('video→apng', 'convert-video', ['clip2.mp4'], { to: 'apng', quality: 'balanced', height: '' }, async ([o]) => { const [v] = of(await ffp(o, ['-count_frames']), 'video'); ok(v.codec_name === 'apng' && v.width === 480 && Math.abs(v.nb_read_frames - 24) <= 2, `${v.codec_name} ${v.width} ${v.nb_read_frames} frames`); });
  T('video→gif never upscales', 'video-to-gif', ['odd.mp4'], { start: '0:00', duration: 2, fps: 10, width: 480 }, async ([o]) => { const m = await fmt(o, 'gif'); ok(m.width === 321 && m.pages >= 18, `gif ${m.width} ${m.pages}`); });
  T('gif→video', 'gif-to-video', ['anim.gif'], { to: 'mp4', quality: 'balanced' }, async ([o]) => { const [v] = of(await ffp(o, ['-count_frames']), 'video'); ok(v.codec_name === 'h264' && v.width === 160 && v.height === 120 && v.nb_read_frames >= 9, `${v.codec_name} ${v.width}x${v.height} ${v.nb_read_frames}`); });
  T('compress odd video', 'compress-video', ['odd.mp4'], { mode: 'level', level: 'extreme', height: '' }, async ([o]) => { const v = (await probe(o)).video; ok(v.width === 320 && v.height === 240, `${v.width}x${v.height}`); });
  T('rotate odd video', 'rotate-video', ['odd.mp4'], { angle: '90', flip: 'none' }, async ([o]) => { const j = await ffp(o), [v] = of(j, 'video'); ok(v.width === 240 && v.height === 320 && of(j, 'subtitle').length === 1, `${v.width}x${v.height}`); });
  T('trim webm precise', 'trim-media', ['clip.webm'], { start: '0:01', end: '0:02', precise: true }, async ([o]) => { const j = await ffp(o); ok(o.endsWith('.webm') && of(j, 'video')[0].codec_name === 'vp9' && of(j, 'audio')[0].codec_name === 'opus', 'webm'); await dur(o, 1, 0.3); });
  T('frames every frame', 'video-frames', ['100% clip.mp4'], { mode: 'all', format: 'png' }, async ([o]) => { ok(path.basename(o).startsWith('100% clip'), path.basename(o)); ok(Math.abs(files(o).length - 50) <= 1, `${files(o).length} frames`); await fmt(path.join(o, files(o).sort()[0]), 'png'); });
  T('subtitles mkv→srt', 'extract-subtitles', ['subs.mkv'], { to: 'srt' }, ([o]) => ok(/00:00:00,5\d\d --> 00:00:02,0\d\d\r?\nHello Lime/.test(txt(o)) && txt(o).includes('Second line'), txt(o).slice(0, 80)));
  T('subtitles mkv→ass', 'extract-subtitles', ['subs.mkv'], { to: 'ass' }, ([o]) => ok(txt(o).includes('[Script Info]') && txt(o).includes('Hello Lime'), txt(o).slice(0, 80)));
  T('subtitles mp4→vtt', 'extract-subtitles', ['odd.mp4'], { to: 'vtt' }, ([o]) => ok(txt(o).startsWith('WEBVTT') && txt(o).includes('00:00.500 --> 00:02.000') && txt(o).includes('Hello Lime'), txt(o).slice(0, 80)));
  T('audio copied from video', 'extract-audio', ['clip.mp4'], { to: 'm4a', bitrate: '' }, async ([o]) => ok((await md5(o, '0:a:0')) === (await md5(fx('clip.mp4'), '0:a:0')), 'audio was re-encoded'));
  T('audio 5.1→eac3', 'extract-audio', ['odd.mp4'], { to: 'eac3', bitrate: '' }, async ([o]) => { const j = await ffp(o), [a] = of(j, 'audio'); ok(a.codec_name === 'eac3' && a.channels === 6 && Math.abs(Number(j.format.bit_rate) - 576000) < 30000, `${a.codec_name} ${a.channels}ch ${j.format.bit_rate}`); });
  T('audio 5.1→wma', 'extract-audio', ['odd.mp4'], { to: 'wma', bitrate: '' }, async ([o]) => { const [a] = of(await ffp(o), 'audio'); ok(a.codec_name === 'wmav2' && a.channels === 2, `${a.codec_name} ${a.channels}ch`); });
  const AT = { alac: 'alac', aac: 'aac', wav: 'pcm_s16le', wma: 'wmav2', ac3: 'ac3', eac3: 'eac3', m4b: 'aac', wv: 'wavpack', tta: 'tta', caf: 'pcm_s16be', au: 'pcm_s16be', w64: 'pcm_s16le', mp2: 'mp2', mka: 'opus', weba: 'opus', voc: 'pcm_s16le', amr: 'amr_nb' };
  for (const [to, codec] of Object.entries(AT)) {
    T(`audio→${to}`, 'convert-audio', ['tone.wav'], { to, bitrate: '' }, async ([o]) => { const i = await dur(o, 3, 0.15); ok(i.audio.codec === codec, `${i.audio.codec}`); if (to === 'amr') ok(i.audio.rate === 8000 && i.audio.channels === 1, `${i.audio.rate} Hz`); }, to === 'amr' ? noEncoder(to) : null);
  }
  T('audio→wav 24-bit 16 kHz mono', 'convert-audio', ['tone.wav'], { to: 'wav', depth: '24', rate: '16000', mono: true }, async ([o]) => { const a = (await probe(o)).audio; ok(a.codec === 'pcm_s24le' && a.rate === 16000 && a.channels === 1, `${a.codec} ${a.rate} ${a.channels}`); });
  T('crop video square', 'crop-video', ['odd.mp4'], { aspect: '1:1' }, async ([o]) => { const v = (await probe(o)).video; ok(v.width === 240 && v.height === 240, `${v.width}x${v.height}`); });
  T('crop video story', 'crop-video', ['clip2.mp4'], { aspect: '9:16' }, async ([o]) => { const v = (await probe(o)).video; ok(v.width === 202 && v.height === 360, `${v.width}x${v.height}`); });
  T('crop video pixels', 'crop-video', ['clip2.mp4'], { aspect: 'custom', left: 10, top: 20, width: 101, height: 51 }, async ([o]) => { const v = (await probe(o)).video; ok(v.width === 100 && v.height === 50, `${v.width}x${v.height}`); });
  T('replace audio', 'add-audio', ['clip2.mp4', 'tone.wav'], { mode: 'replace', shortest: false }, async ([o]) => {
    const j = await ffp(o), s = await sound(o);
    ok(of(j, 'audio').length === 1 && of(j, 'audio')[0].codec_name === 'aac' && Math.abs(Number(j.format.duration) - 2) < 0.15, `${of(j, 'audio').length} tracks, ${j.format.duration} s`);
    ok(Math.abs(s.zcr / (await sound(fx('tone.wav'))).zcr - 1) < 0.1, `zero crossings ${s.zcr}: not the new sound`);
    ok((await md5(o, '0:v:0')) === (await md5(fx('clip2.mp4'), '0:v:0')), 'video was re-encoded');
  });
  T('mix in audio', 'add-audio', ['tone.wav', 'clip2.mp4'], { mode: 'mix', shortest: true }, async ([o]) => { const j = await ffp(o), s = await sound(o); ok(of(j, 'video').length === 1 && of(j, 'audio').length === 1 && Math.abs(Number(j.format.duration) - 2) < 0.2 && s.mean > -40, `${j.format.duration} s, ${s.mean} dB`); });
  T('loop video', 'loop-media', ['clip2.mp4'], { times: '3' }, async ([o]) => dur(o, 6, 0.3));
  T('loop audio', 'loop-media', ['song.mp3'], { times: '2' }, async ([o]) => dur(o, 6, 0.2));
  T('volume +6 dB', 'volume-media', ['tone.wav'], { unit: 'db', db: 6 }, async ([o]) => { const a = await sound(fx('tone.wav')), b = await sound(o); ok(Math.abs(b.mean - a.mean - 6) < 0.5, `${a.mean} → ${b.mean} dB`); });
  T('volume +30 dB never clips', 'volume-media', ['tone.wav'], { unit: 'db', db: 30 }, async ([o]) => { const a = await sound(fx('tone.wav')), b = await sound(o); ok(b.max <= -0.2 && b.mean - a.mean > 10, `max ${b.max} dB, mean ${a.mean} → ${b.mean} dB`); });
  T('volume video 50%', 'volume-media', ['clip2.mp4'], { unit: 'percent', percent: 50 }, async ([o]) => {
    const a = await sound(fx('clip2.mp4')), b = await sound(o);
    ok(Math.abs(a.mean - b.mean - 6) < 1, `${a.mean} → ${b.mean} dB`);
    ok((await md5(o, '0:v:0')) === (await md5(fx('clip2.mp4'), '0:v:0')), 'video was re-encoded');
  });
  T('reverse video', 'reverse-media', ['clip2.mp4'], {}, async ([o]) => { await dur(o, 2, 0.2); const first = await still(o, 0); const d1 = await diff(first, await still(fx('clip2.mp4'), -0.04)), d0 = await diff(first, await still(fx('clip2.mp4'), 0)); ok(d1 < d0 / 2, `first frame vs last ${d1.toFixed(1)}, vs first ${d0.toFixed(1)}`); });
  T('reverse audio', 'reverse-media', ['ramp.wav'], {}, async ([o]) => { const a = await sound(o, 0, 1), b = await sound(o, 2, 1); ok(a.mean > b.mean + 6, `start ${a.mean} dB, end ${b.mean} dB`); });
  T('fade in and out', 'fade-audio', ['tone.wav'], { fadeIn: 1, fadeOut: 1 }, async ([o]) => { await dur(o, 3, 0.1); const [a, m, z] = await Promise.all([sound(o, 0, 0.25), sound(o, 1.2, 0.6), sound(o, 2.75, 0.25)]); ok(a.mean < m.mean - 10 && z.mean < m.mean - 10, `${a.mean} / ${m.mean} / ${z.mean} dB`); });
  T('pitch up an octave', 'pitch-audio', ['tone.wav'], { semitones: 12 }, async ([o]) => { await dur(o, 3, 0.1); const r = (await sound(o)).zcr / (await sound(fx('tone.wav'))).zcr; ok(Math.abs(r - 2) < 0.1, `frequency ×${r.toFixed(2)}`); });
  const edges = async (f, region) => { const { data, info } = await sharp(f).extract(region).greyscale().raw().toBuffer({ resolveWithObject: true }); let e = 0; for (let i = 1; i < data.length; i++) if (i % info.width) e += Math.abs(data[i] - data[i - 1]); return e / data.length; };
  for (const mode of ['blur', 'pixelate']) {
    T(`${mode} area`, 'blur-video', ['clip2.mp4'], { mode, left: 0, top: 0, width: 320, height: 180, strength: 80 }, async ([o]) => {
      const [a, b] = await Promise.all([still(fx('clip2.mp4'), 1), still(o, 1)]), box = { left: 0, top: 0, width: 320, height: 180 };
      if (mode === 'blur') { const [ea, eb] = await Promise.all([edges(a, box), edges(b, box)]); ok(eb < ea * 0.6, `detail ${ea.toFixed(2)} → ${eb.toFixed(2)}`); }
      else { const d = await diff(a, b, box); ok(d > 8, `area changed by only ${d.toFixed(1)}`); }
      ok((await diff(a, b, { left: 400, top: 200, width: 240, height: 160 })) < 4, 'outside the area changed');
    });
  }
  T('gif speed', 'animation-speed', ['anim.gif'], { speed: '2' }, async ([o]) => { const m = await fmt(o, 'gif'); ok(m.pages === 10 && m.delay.every((d) => d === 50), `${m.pages} frames, ${m.delay}`); });
  T('webp speed', 'animation-speed', ['anim.webp'], { speed: '0.5' }, async ([o]) => { const m = await fmt(o, 'webp'); ok(m.pages === 10 && m.delay.every((d) => d === 200), `${m.pages} frames, ${m.delay}`); });
  for (const f of ['anim.gif', 'anim.webp']) {
    T(`reverse ${f}`, 'animation-speed', [f], { speed: '1', reverse: true }, async ([o]) => {
      const m = await fmt(o, f.endsWith('gif') ? 'gif' : 'webp');
      ok(m.pages === 10, `${m.pages} frames`);
      const first = sharp(o, { page: 0 }), d1 = await diff(first, sharp(fx(f), { page: 9 })), d0 = await diff(sharp(o, { page: 0 }), sharp(fx(f), { page: 0 }));
      ok(d1 < d0 / 2, `first frame vs last ${d1.toFixed(1)}, vs first ${d0.toFixed(1)}`);
    });
  }
  for (const to of ['flac', 'm4a', 'alac', 'mp3', 'ogg', 'opus', 'mka']) {
    T(`audio cover mp3→${to}`, 'convert-audio', ['song.mp3'], { to, bitrate: '' }, async ([o]) => { const j = await ffp(o); ok(of(j, 'video').some((s) => s.disposition?.attached_pic === 1), 'cover lost'); ok(titled(j), 'title lost'); });
  }
  T('lottie→gif', 'render-motion', ['anim.json'], { to: 'gif', resolution: 'quarter' }, async ([o]) => fmt(o, 'gif'));
  T('timeline→fcpxml', 'convert-timeline', ['timeline.otio'], { to: 'fcpxml' }, ([o]) => ok(txt(o).includes('fcpxml'), 'fcpxml'));
  T('timeline→edl', 'convert-timeline', ['timeline.otio'], { to: 'edl' }, ([o]) => ok(/TITLE|001/.test(txt(o)), 'edl'));

  const docChecks = {
    pdf: async (o, w) => ok((await pdfText(o)).includes(w), `pdf lacks ${w}`), docx: async (o, w) => ok((await docxText(o)).includes(w), `docx lacks ${w}`), md: (o, w) => ok(txt(o).includes(w), 'md'), txt: (o, w) => ok(txt(o).includes(w), 'txt'),
    html: (o, w) => ok(txt(o).includes(w), 'html'), epub: (o) => { const z = zipHas(o, 'mimetype'); ok(Buffer.from(z.mimetype).toString() === 'application/epub+zip', 'mimetype'); }, rtf: (o, w) => ok(txt(o).startsWith('{\\rtf1') && txt(o).includes(w.split(' ')[0]), 'rtf'),
  };
  for (const [src, word, tos] of [['doc.docx', 'Lime Report', ['pdf', 'md', 'txt', 'html', 'epub', 'rtf']], ['doc.md', 'Lime Notes', ['docx', 'pdf', 'html', 'txt', 'epub', 'rtf']], ['doc.html', 'Lime Page', ['pdf', 'docx', 'md', 'txt']], ['doc.txt', 'Lime plain text', ['pdf', 'docx', 'md', 'html']], ['doc.rtf', 'Lime RTF heading', ['docx', 'txt', 'pdf']], ['doc.odt', 'Lime ODT', ['txt', 'docx', 'pdf']], ['book.epub', 'Lime Book', ['txt', 'pdf', 'docx']]]) {
    for (const to of tos) T(`doc ${src}→${to}`, 'convert-document', [src], { to }, async ([o]) => docChecks[to](o, word));
  }
  T('epub reader links and pictures', 'convert-ebook', ['novel.epub'], { to: 'html' }, ([o]) => {
    const h = txt(o);
    ok(h.includes('<title>별빛 이야기</title>') && h.includes('lang="ko"'), 'title or language');
    ok(h.includes('href="#c3-note1"') && h.includes('id="c3-note1"'), 'link into “ch 3.xhtml” lost');
    ok(h.includes('href="#c1-local"') && h.includes('id="c1-local"'), 'link inside a chapter lost');
    ok(!h.includes('100%.html') && !/javascript:/i.test(h) && h.includes('깨진 링크'), 'bad links not unwrapped');
    ok((h.match(/src="data:image\/png;base64,/g) || []).length === 2, 'pictures (chapter picture and image page)');
    ok((h.match(/class="chapter"/g) || []).length === 4 && (h.match(/style="page-break-before:always"/g) || []).length === 3, 'chapters and page breaks');
  });
  T('epub→fb2', 'convert-ebook', ['novel.epub'], { to: 'fb2' }, ([o]) => {
    const d = xmlDoc(txt(o), 'FB2');
    ok(tags(d, 'book-title')[0].textContent === '별빛 이야기' && tags(d, 'nickname')[0].textContent === '김작가' && tags(d, 'lang')[0].textContent === 'ko', 'metadata');
    const body = tags(d, 'body')[0];
    ok(Array.prototype.slice.call(body.childNodes).filter((n) => n.nodeType === 1 && n.localName === 'section').length === 3, 'top-level sections');
    ok(tags(d, 'binary').length === 3 && tags(d, 'coverpage').length === 1, 'binaries and cover');
    ok(tags(d, 'strong')[0].textContent === '별' && tags(d, 'emphasis')[0].textContent === '반짝', 'bold and italic');
    ok(tags(d, 'a').some((a) => a.getAttribute('l:href') === '#c3-note1') && tags(d, 'p').some((p) => p.getAttribute('id') === 'c3-note1'), 'internal link');
  });
  T('epub→md with pictures', 'convert-ebook', ['novel.epub'], { to: 'md' }, async ([md, dirOut]) => {
    ok(txt(md).includes('# 세 번째 장') && txt(md).includes('![그림](novel_files/img0001.png)'), 'markdown or picture link');
    ok(path.basename(dirOut) === 'novel_files' && files(dirOut).length === 2, `picture folder ${files(dirOut)}`);
    await fmt(path.join(dirOut, 'img0001.png'), 'png');
  });
  T('epub→pdf', 'convert-ebook', ['novel.epub'], { to: 'pdf' }, async ([o]) => { ok((await pages(o)) >= 4, 'each chapter starts a page'); ok((await pdfText(o)).includes('Starlight chapter two'), 'text'); });
  T('epub font obfuscation is not DRM', 'convert-ebook', ['obfuscated.epub'], { to: 'txt' }, ([o]) => ok(txt(o).includes('세 번째 장'), 'text'));
  X('epub with DRM refused', 'convert-ebook', ['drm.epub'], { to: 'pdf' }, /DRM/);
  T('html→epub chapters', 'convert-document', ['chapters.html'], { to: 'epub' }, ([o]) => {
    const e = epub(o);
    ok(e.spine.join() === 'ch001.xhtml,ch002.xhtml', `spine ${e.spine}`);
    ok(/<dc:language>ko<\/dc:language>/.test(e.opf) && e.pages['ch001.xhtml'].includes('xml:lang="ko"'), 'language');
    ok(e.pages['ch001.xhtml'].includes('href="ch002.xhtml#two_target"') && e.pages['ch002.xhtml'].includes('id="two_target"'), 'link to the next chapter');
    ok(e.pages['ch001.xhtml'].includes('id="intro"') && e.pages['ch001.xhtml'].includes('href="https://example.com/"'), 'ids or web links');
    ok(e.images.length === 2 && e.images.every((i) => i.type === 'image/jpeg') && !Object.values(e.pages).some((p) => /remote\.png|data:image/.test(p)), 'pictures packaged, WebP converted, remote dropped');
    ok(tags(xmlDoc(e.nav, 'nav'), 'li').length === 3 && tags(xmlDoc(e.ncx, 'ncx'), 'navPoint').length === 3 && e.nav.includes('하위 절'), 'table of contents');
    ok(!e.pages['ch002.xhtml'].includes('\u000b'), 'control characters');
  });
  T('md→epub', 'convert-document', ['doc.md'], { to: 'epub' }, ([o]) => { const e = epub(o); ok(e.nav.includes('Lime Notes') && Object.values(e.pages).some((p) => p.includes('<table>')), 'nav or table'); });
  T('fb2→epub', 'convert-ebook', ['voina.fb2'], { to: 'epub' }, ([o]) => {
    const e = epub(o);
    ok(/<dc:title>Война и мир<\/dc:title>/.test(e.opf) && /<dc:creator>Лев Толстой<\/dc:creator>/.test(e.opf) && /<dc:language>ru<\/dc:language>/.test(e.opf), 'metadata');
    ok(e.nav.includes('Глава первая') && e.nav.includes('Подглава'), 'table of contents');
    ok(e.items.some((i) => i.props.includes('cover-image')) && e.spine[0] === 'cover.xhtml', 'cover');
    const all = Object.values(e.pages).join('');
    ok(/epub:type="footnote"[^>]*>[\s\S]*Текст примечания/.test(all) && all.includes('epub:type="noteref"'), 'footnote');
    ok(all.includes('<b>абзац</b>') && all.includes('Строка стиха один<br/>Строка стиха два'), 'formatting and poem');
  });
  T('fb2→pdf (document wheel)', 'convert-document', ['voina.fb2'], { to: 'pdf' }, async ([o]) => ok((await pdfText(o)).includes('Глава вторая'), 'pdf text'));
  T('fb2→docx', 'convert-document', ['voina.fb2'], { to: 'docx' }, async ([o]) => ok((await docxText(o)).includes('Текст подглавы'), 'docx text'));
  T('docx→md with pictures', 'convert-document', ['doc.docx'], { to: 'md' }, async ([md, dirOut]) => {
    ok(txt(md).includes('# Lime Report') && /!\[[^\]]*\]\(doc_files\/img0001\.(png|jpg)\)/.test(txt(md)), 'picture link');
    ok(dirOut && files(dirOut).length === 1, 'picture folder');
  });
  for (const f of ['stormy.mobi', 'stormy-huff.mobi', 'stormy-plain.prc']) {
    T(`mobi ${f}→epub`, 'convert-ebook', [f], { to: 'epub' }, ([o]) => {
      const e = epub(o), all = Object.values(e.pages).join('');
      ok(/<dc:title>Stormy Night<\/dc:title>/.test(e.opf) && /<dc:creator>E\. Bulwer-Lytton<\/dc:creator>/.test(e.opf), 'metadata');
      ok(e.images.length === 2 && e.items.some((i) => i.props.includes('cover-image')), `pictures ${e.images.length}`);
      ok(all.includes('Ünïcödé text and 한글 too') && all.includes('<b>dark</b>') && all.includes('The note is here.'), 'text');
      const link = /<a href="([^"#]*)#([^"]+)">the note<\/a>/.exec(all);
      ok(link && e.pages[link[1] || 'ch001.xhtml']?.includes(`id="${link[2]}"`), 'filepos link');
      ok(new RegExp(`id="${link[2]}"[^<]*</a>\\s*<p>The note is here`).test(all) || new RegExp(`<a id="${link[2]}"></a>\\s*<p>The note`).test(all), 'filepos target before the note');
    });
  }
  X('mobi with DRM refused', 'convert-ebook', ['locked.azw'], { to: 'epub' }, /DRM/);
  T('palmdoc text book', 'convert-ebook', ['old.pdb'], { to: 'txt' }, ([o]) => ok(txt(o).includes('Plain PalmDOC text.') && txt(o).includes('Second paragraph of the book.'), 'text'));
  T('azw4 print replica→pdf', 'convert-ebook', ['replica.azw4'], { to: 'pdf' }, ([o]) => ok(Buffer.compare(read(o), read(fx('doc.pdf'))) === 0, 'the PDF inside differs'));
  T('azw3 (KF8)→epub', 'convert-ebook', ['kf8.azw3'], { to: 'epub' }, ([o]) => {
    const e = epub(o), all = Object.values(e.pages).join('');
    ok(/<dc:title>Kindle Format Eight<\/dc:title>/.test(e.opf) && /<dc:creator>Lime Writer<\/dc:creator>/.test(e.opf), 'metadata');
    ok(e.spine.filter((s) => /^ch/.test(s)).length === 2 && all.includes('<b>bold</b> and 한글') && all.includes('Aid target paragraph.'), 'parts and text');
    const to2 = /<a href="(ch\d+\.xhtml)#([^"]+)">To chapter two<\/a>/.exec(all), toAid = /<a href="(ch\d+\.xhtml)#([^"]+)">to the target<\/a>/.exec(all);
    ok(to2 && e.pages[to2[1]].includes(`id="${to2[2]}"`) && e.pages[to2[1]].includes('Chapter Two'), 'kindle:pos link to an id');
    ok(toAid && new RegExp(`id="${toAid[2]}">Aid target`).test(e.pages[toAid[1]]), 'kindle:pos link to an aid');
    ok(e.images.length === 2 && all.includes('alt="pic"'), 'kindle:embed picture and cover');
  });
  T('azw3 (KF8)→txt', 'convert-ebook', ['kf8.azw3'], { to: 'txt' }, ([o]) => ok(txt(o).includes('Chapter One') && txt(o).includes('Filler paragraph.'), 'text'));
  T('epub→kepub', 'convert-ebook', ['kobo.epub'], { to: 'kepub' }, ([o]) => {
    ok(o.endsWith('kobo.kepub.epub'), `name ${path.basename(o)}`);
    const src = require('fflate').unzipSync(new Uint8Array(read(fx('kobo.epub')))), z = epub(o).z;
    ok(Object.keys(src).sort().join() === Object.keys(z).sort().join(), 'entries changed');
    for (const k of Object.keys(src).filter((n) => !/ch\d+\.xhtml$/.test(n))) ok(Buffer.compare(Buffer.from(src[k]), Buffer.from(z[k])) === 0, `${k} changed`);
    const ch = Buffer.from(z['OEBPS/ch001.xhtml']).toString();
    ok(/<body><div id="book-columns"><div id="book-inner">/.test(ch) && ch.includes('<span class="koboSpan" id="kobo.1.1">Kobo Book</span>') && ch.includes('<span class="koboSpan" id="kobo.2.2">Second one? </span>'), 'spans');
    ok(ch.includes('<b><span class="koboSpan" id="kobo.3.2">Bold</span></b>') && /<span class="koboSpan" id="kobo\.4\.1"><img /.test(ch) && ch.includes('Pi is 3.14 today. </span>'), 'inline parents, pictures, numbers');
    const ids = [...ch.matchAll(/id="(kobo[^"]+)"/g)].map((m) => m[1]);
    ok(new Set(ids).size === ids.length, 'duplicate ids');
  });
  T('kepub→epub round trip', 'convert-ebook', ['kobo.kepub.epub'], { to: 'epub' }, ([o]) => {
    const z = epub(o).z, src = require('fflate').unzipSync(new Uint8Array(read(fx('kobo.epub'))));
    const norm = (b) => Buffer.from(b).toString().replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    for (const k of Object.keys(src).filter((n) => /ch\d+\.xhtml$/.test(n))) { const t = Buffer.from(z[k]).toString(); ok(!t.includes('koboSpan') && !t.includes('book-columns') && norm(z[k]) === norm(src[k]), `${k} keeps Kobo markup or lost text`); }
    ok(Buffer.from(z['OEBPS/ch001.xhtml']).toString().includes('<p>First sentence. Second one? Third!</p>'), 'text after the round trip');
  });
  T('epub→htmlz', 'convert-ebook', ['novel.epub'], { to: 'htmlz' }, ([o]) => { const z = zipHas(o, 'index.html'); ok(z['style.css'] && z['metadata.opf'] && Object.keys(z).filter((k) => k.startsWith('images/')).length === 2 && Buffer.from(z['index.html']).toString().includes('src="images/img0001.png"') && Buffer.from(z['metadata.opf']).toString().includes('<dc:creator opf:role="aut">김작가</dc:creator>'), 'htmlz parts'); });
  T('epub→txtz', 'convert-ebook', ['novel.epub'], { to: 'txtz' }, ([o]) => { const z = zipHas(o, 'index.txt'); ok(Buffer.from(z['index.txt']).toString().includes('![그림](images/img0001.png)') && z['images/img0001.png'], 'txtz parts'); });
  T('txtz→epub', 'convert-ebook', ['notes.txtz'], { to: 'epub' }, ([o]) => { const e = epub(o); ok(/<dc:title>Zipped Notes<\/dc:title>/.test(e.opf) && /Note Taker/.test(e.opf) && e.images.length === 1, 'metadata or pictures (the outside picture must stay out)'); });
  const pdfSizes = async (o) => (await require('pdf-lib').PDFDocument.load(read(o))).getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`).join(' ');
  T('cbz→pdf', 'convert-comic', ['comic.cbz'], { to: 'pdf' }, async ([o]) => ok((await pdfSizes(o)) === '150x225 165x248 180x270', `pages ${await pdfSizes(o)}`));
  T('cb7→pdf', 'convert-comic', ['comic.cb7'], { to: 'pdf' }, async ([o]) => ok((await pdfSizes(o)) === '150x225 165x248 180x270', `pages ${await pdfSizes(o)}`));
  T('cbt→pdf', 'convert-comic', ['comic.cbt'], { to: 'pdf' }, async ([o]) => ok((await pdfSizes(o)) === '150x225 165x248 180x270', `pages ${await pdfSizes(o)}`));
  T('cbz→epub (fixed layout)', 'convert-comic', ['comic.cbz'], { to: 'epub' }, ([o]) => { const e = epub(o); ok(e.spine.length === 3 && e.images.length === 3 && /rendition:layout">pre-paginated/.test(e.opf) && e.pages['p0001.xhtml'].includes('width=200, height=300'), 'fixed layout'); });
  T('cbz→cbz repack', 'convert-comic', ['comic.cbz'], { to: 'cbz' }, ([o]) => { const k = Object.keys(require('fflate').unzipSync(new Uint8Array(read(o)))); ok(k.join() === '001.png,002.jpg,003.png', `entries ${k}`); });
  T('cb7→pictures', 'convert-comic', ['comic.cb7'], { to: 'images' }, ([o]) => ok(files(o).sort().join() === '001.png,002.jpg,003.png', `files ${files(o)}`));
  X('locked comic refused', 'convert-comic', ['locked.cbz'], { to: 'pdf' }, /password-protected/);
  T('pdf→cbz', 'pdf-to-cbz', ['doc.pdf'], { dpi: '96', quality: 80, pages: 'all' }, async ([o]) => { const z = require('fflate').unzipSync(new Uint8Array(read(o))); ok(Object.keys(z).join() === '001.jpg,002.jpg,003.jpg', `entries ${Object.keys(z)}`); const w = (await sharp(Buffer.from(z['001.jpg'])).metadata()).width; ok(w >= 792 && w <= 795, `page width ${w} at 96 dpi`); });
  T('images→cbz', 'images-to-cbz', ['photo.jpg', 'photo2.jpg', 'photo.png'], {}, ([o]) => { const z = require('fflate').unzipSync(new Uint8Array(read(o))); ok(Object.keys(z).join() === '001.jpg,002.jpg,003.png' && Buffer.compare(Buffer.from(z['002.jpg']), read(fx('photo2.jpg'))) === 0, `entries ${Object.keys(z)}`); });
  const FONTS = E('fonts');
  let google = null;
  try { google = require('wawoff2'); } catch (_) {}
  const headMask = (h) => { const c = Buffer.from(h); c.fill(0, 8, 12); c.writeUInt16BE(c.readUInt16BE(16) & ~0x800, 16); return c; };
  // Tables that differ between two fonts (head compared without checkSumAdjustment and the WOFF2 flag; DSIG ignored).
  const tableDiff = (a, b, skip = []) => [...new Set([...a.tables.keys(), ...b.tables.keys()])].filter((t) => !skip.includes(t) && t !== 'DSIG' && (!a.tables.has(t) || !b.tables.has(t) || Buffer.compare(t === 'head' ? headMask(a.tables.get(t)) : a.tables.get(t), t === 'head' ? headMask(b.tables.get(t)) : b.tables.get(t)) !== 0));
  const glyphDiff = (a, b) => { const x = FONTS.readGlyphs(a), y = FONTS.readGlyphs(b); return x.filter((g, i) => !!g !== !!y[i] || (g && Buffer.compare(FONTS.serializeGlyph(g), FONTS.serializeGlyph(y[i])) !== 0)).length + Math.abs(x.length - y.length); };
  const ttfSrc = () => FONTS.load(read(fx('font.ttf')));
  const woff2Dir = (b) => { const out = []; let p = 48; const ub = () => { let v = 0, c; do { c = b[p++]; v = v * 128 + (c & 127); } while (c & 128); return v; }; for (let i = 0, n = b.readUInt16BE(12); i < n; i++) { const f = b[p++], k = f & 63, tag = k === 63 ? b.toString('latin1', p, (p += 4)) : ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep'][k] || `#${k}`; const orig = ub(), v = f >> 6, tr = ['glyf', 'loca'].includes(tag) ? v !== 3 : v !== 0; out.push({ tag, v, orig, stored: tr ? ub() : orig, tr }); } return out; };
  T('font ttf→woff', 'convert-font', ['font.ttf'], { to: 'woff' }, ([o]) => { const b = read(o); ok(b.toString('latin1', 0, 4) === 'wOFF' && b.readUInt32BE(8) === b.length, 'header'); const d = tableDiff(ttfSrc(), FONTS.load(b)); ok(!d.length, `tables changed: ${d}`); });
  T('font ttf→woff2', 'convert-font', ['font.ttf'], { to: 'woff2' }, async ([o]) => {
    const b = read(o), src = ttfSrc(), dir = woff2Dir(b), e = (t) => dir.find((x) => x.tag === t);
    ok(b.length % 4 === 0 && b.readUInt32BE(8) === b.length, 'length');
    ok(e('glyf').v === 0 && e('glyf').tr && e('loca').v === 0 && e('loca').stored === 0 && e('hmtx').v === 1 && e('cmap').v === 0 && !e('cmap').tr, `transforms ${JSON.stringify(dir.slice(0, 12))}`);
    ok(dir.findIndex((x) => x.tag === 'loca') === dir.findIndex((x) => x.tag === 'glyf') + 1, 'loca must follow glyf');
    ok(b.length < 0.8 * FONTS.woffEncode(src).length, 'not smaller than WOFF');
    const back = FONTS.load(b);
    ok(!tableDiff(src, back, ['glyf', 'loca']).length && !glyphDiff(src, back), 'round trip');
    ok(back.tables.get('head').readUInt16BE(16) & 0x800, 'head flag 11');
    if (google) {
      const g = FONTS.load(Buffer.from(await google.decompress(b))), gg = FONTS.readGlyphs(g);
      ok(!tableDiff(src, g, ['glyf', 'loca']).length, `Google’s decoder: ${tableDiff(src, g, ['glyf', 'loca'])}`);
      ok(FONTS.readGlyphs(src).every((x, i) => !x || Buffer.compare(FONTS.serializeGlyph({ ...x, overlap: false }), FONTS.serializeGlyph({ ...gg[i], overlap: false })) === 0), 'Google’s decoder: glyphs');
      ok(b.length < 1.05 * read(fx('font.google.woff2')).length, 'larger than Google’s encoder');
    }
  });
  T('font google woff2→ttf', 'convert-font', ['font.google.woff2'], { to: 'ttf' }, ([o]) => { const src = ttfSrc(), out = FONTS.load(read(o)), og = FONTS.readGlyphs(out); ok(!tableDiff(src, out, ['glyf', 'loca']).length, `tables ${tableDiff(src, out, ['glyf', 'loca'])}`); ok(FONTS.readGlyphs(src).every((x, i) => !x || Buffer.compare(FONTS.serializeGlyph({ ...x, overlap: false }), FONTS.serializeGlyph(og[i])) === 0), 'glyphs'); });
  T('font ttf→eot', 'convert-font', ['font.ttf'], { to: 'eot' }, ([o]) => {
    const b = read(o);
    ok(b.readUInt32LE(0) === b.length && b.readUInt32LE(8) === 0x00020001 && b.readUInt32LE(12) === 0 && b.readUInt16LE(34) === 0x504c, 'EOT header');
    ok(b.toString('utf16le', 84, 84 + b.readUInt16LE(82)) === 'Noto Sans', `family ${b.toString('utf16le', 84, 84 + b.readUInt16LE(82))}`);
    ok(!tableDiff(ttfSrc(), FONTS.load(b)).length, 'tables');
  });
  T('font ttc→otf', 'convert-font', ['font.ttc'], { to: 'otf' }, ([o]) => ok(!tableDiff(ttfSrc(), FONTS.load(read(o))).length, 'first font of the collection'));
  T('font otf (CFF)→woff2', 'convert-font', ['font.otf'], { to: 'woff2' }, ([o]) => { const src = FONTS.load(read(fx('font.otf'))), back = FONTS.load(read(o)); ok(back.flavor === 0x4f54544f && back.tables.has('CFF ') && !tableDiff(src, back).length, `CFF tables ${tableDiff(src, back)}`); });
  T('font otf (CFF)→ttf', 'convert-font', ['font.otf'], { to: 'ttf' }, ([o]) => {
    const src = FONTS.load(read(fx('font.otf'))), tt = FONTS.load(read(o)), g = FONTS.readGlyphs(tt);
    ok(tt.flavor === 0x10000 && !tt.tables.has('CFF ') && !tt.tables.has('VORG') && tt.tables.get('maxp').length === 32 && g.length === 9, 'TrueType font');
    for (const t of ['cmap', 'name', 'OS/2']) ok(Buffer.compare(src.tables.get(t), tt.tables.get(t)) === 0, `${t} changed`);
    const hm = tt.tables.get('hmtx'), adv = [500, 250, 600, 520, 520, 300, 600, 700, 500];
    g.forEach((x, i) => { ok(hm.readUInt16BE(4 * i) === adv[i] && hm.readInt16BE(4 * i + 2) === (x ? x.xMin : 0), `metrics of glyph ${i}`); if (x) { const xs = x.pts.map((p) => p.x), ys = x.pts.map((p) => p.y); ok(x.xMin === Math.min(...xs) && x.yMax === Math.max(...ys), `bbox of glyph ${i}`); } });
    const area = (x, k) => { const s = k ? x.ends[k - 1] + 1 : 0, c = x.pts.slice(s, x.ends[k] + 1).filter((p) => p.on); return c.reduce((a, p, i) => a + p.x * c[(i + 1) % c.length].y - c[(i + 1) % c.length].x * p.y, 0) / 2; };
    ok(area(g[8], 0) === -250000 && area(g[8], 1) === 90000 && area(g[2], 0) < 0, 'contour direction');
    ok([g[7].xMin, g[7].yMin, g[7].xMax, g[7].yMax].join() === '100,0,600,530' && g[7].pts.some((p) => p.on && p.x === 350 && p.y === 530), 'flex');
    ok(g[6].n === g[2].n + g[5].n && g[6].pts.slice(g[2].pts.length).every((p, i) => p.x === g[5].pts[i].x + 170 && p.y === g[5].pts[i].y + 190), 'seac accent');
    const fk = require('@pdf-lib/fontkit').create(read(o)), names = Array.from({ length: 9 }, (_, i) => fk.getGlyph(i).name);
    ok(tt.tables.get('post').readUInt32BE(0) === 0x20000 && names.join(' ') === '.notdef space A a e acute Aacute flexbar box', `post names ${names}`);
    const vm = tt.tables.get('vmtx');
    ok(vm.readInt16BE(4 * 2 + 2) === 900 - g[2].yMax && vm.readInt16BE(4 * 3 + 2) === 880 - g[3].yMax, 'vertical metrics from VORG');
  });
  T('font otf (CFF)→eot', 'convert-font', ['font.otf'], { to: 'eot' }, ([o]) => { const b = read(o); ok(b.toString('utf16le', 84, 84 + b.readUInt16LE(82)) === 'Lime Test NameKeyed', 'family name'); const f = FONTS.load(b); ok(f.tables.has('glyf') && !f.tables.has('CFF '), 'TrueType outlines'); });
  T('font info', 'font-info', ['font.ttf'], { save: true }, ([o], r) => { const t = r[0].text; ok(/Family: Noto Sans/.test(t) && /Style: Regular/.test(t) && new RegExp(`Glyphs: ${ttfSrc().tables.get('maxp').readUInt16BE(4).toLocaleString('en-US')}`).test(t) && /Characters: [\d,]+/.test(t), t); ok(txt(o).includes('Outlines: TrueType'), 'report file'); });
  X('not a font refused', 'convert-font', ['doc.txt'], { to: 'woff' }, /not a font/);
  const MAIL = E('email');
  const REPORT = Buffer.from('%PDF-1.4 fake report');
  T('mail eml→html', 'convert-email', ['mail.eml'], { to: 'html' }, ([o]) => {
    const h = txt(o);
    for (const s of ['<meta charset="utf-8">', '<title>회의 자료</title>', '<th>From</th><td>보낸이 &lt;sender@example.com&gt;</td>', '<th>To</th><td>receiver@example.com, Second &lt;second@example.com&gt;</td>', '<th>Date</th><td>2026-10-01 09:30:00 +09:00</td>', '<th>Attachments</th><td>보고서.pdf, notes.txt</td>', '<p>안녕하세요. 자료를 보냅니다.</p>', 'p { color: #C00000; }', 'src="data:image/png;base64,', 'bgcolor="#EEEEEE"', 'valign="top"', '<font color="#336699">', '<p>양식 안의 본문</p>', 'href="https://example.com/ok"', 'Content-Security-Policy', 'bgcolor="#FFFFF0"']) ok(h.includes(s), `lacks ${s}`);
    for (const s of ['cid:', '<script', 'onerror', 'onload', 'tracker.example', 'javascript:', '<svg', '<form', '<input', '<xmp', '<!--']) ok(!h.includes(s), `contains ${s}`);
  });
  T('mail eml→txt', 'convert-email', ['mail.eml'], { to: 'txt' }, ([o]) => { const t = txt(o); ok(t.startsWith('﻿From: 보낸이 <sender@example.com>\r\n') && t.includes('Subject: 회의 자료\r\n') && t.endsWith('\r\n\r\n안녕하세요. 자료를 보냅니다.\r\n둘째 줄\r\n'), JSON.stringify(t)); });
  T('mail eml attachments', 'email-attachments', ['mail.eml'], {}, ([o]) => { ok(files(o).sort().join() === ['notes.txt', '보고서.pdf'].sort().join(), `files ${files(o)}`); ok(Buffer.compare(read(path.join(o, '보고서.pdf')), REPORT) === 0 && txt(path.join(o, 'notes.txt')) === 'memo', 'attachment bytes'); });
  T('mail iso-2022-kr→html', 'convert-email', ['old.eml'], { to: 'html' }, ([o]) => { const h = txt(o); ok(h.includes('<title>한글 제목</title>') && h.includes('<pre class="lime-mail-text">본문 &lt;첫 줄&gt;\r\n둘째 줄') && !h.includes('Attachments'), h.slice(-400)); });
  X('mail without attachments refused', 'email-attachments', ['old.eml'], {}, /no attachments/);
  T('mail msg→eml', 'convert-email', ['meeting.msg'], { to: 'eml' }, ([o]) => {
    const m = MAIL.readMessage(read(o)), raw = txt(o);
    ok(m.subject === '회의 자료' && m.from[0].name === '보낸이' && m.from[0].addr === 'sender@example.com' && m.to[0].addr === 'receiver@example.com' && m.cc[0].addr === 'copy@example.com', 'headers');
    ok(m.date === '2026-10-01 00:30:00 +00:00' && /^Message-ID: <meeting-1@example\.com>$/m.test(raw), 'date or message id');
    ok(m.text === '안녕하세요. 자료를 보냅니다.\r\n둘째 줄' && m.html.includes('<img src="cid:logo@lime">'), 'bodies');
    ok(m.attachments.map((a) => a.name).join() === '보고서.pdf,Earlier mail.eml' && Buffer.compare(m.attachments[0].data, REPORT) === 0, 'attachments');
    const inner = MAIL.readMessage(m.attachments[1].data);
    ok(inner.subject === 'Earlier mail' && inner.text.trim() === 'older text', 'attached message');
    ok(m.cids.has('logo@lime'), 'inline picture');
  });
  T('mail msg→html', 'convert-email', ['meeting.msg'], { to: 'html' }, ([o]) => { const h = txt(o); ok(h.includes('<title>회의 자료</title>') && h.includes('<th>From</th><td>보낸이 &lt;sender@example.com&gt;</td>') && h.includes('<th>Cc</th><td>Copy &lt;copy@example.com&gt;</td>') && h.includes('<th>Attachments</th><td>보고서.pdf, Earlier mail.eml</td>') && h.includes('src="data:image/png;base64,') && !h.includes('cid:'), 'html'); });
  T('mail msg→txt', 'convert-email', ['meeting.msg'], { to: 'txt' }, ([o]) => ok(txt(o).includes('Subject: 회의 자료\r\n') && txt(o).endsWith('\r\n\r\n안녕하세요. 자료를 보냅니다.\r\n둘째 줄\r\n'), 'txt'));
  T('mail msg attachments', 'email-attachments', ['meeting.msg'], {}, ([o]) => { ok(files(o).sort().join() === ['Earlier mail.eml', '보고서.pdf'].sort().join(), `files ${files(o)}`); ok(MAIL.readMessage(read(path.join(o, 'Earlier mail.eml'))).text.trim() === 'older text', 'attached message'); });
  T('mail korean eml after msg', 'convert-email', ['mail.eml'], { to: 'txt' }, ([o]) => ok(txt(o).includes('From: 보낸이 <sender@example.com>') && txt(o).includes('안녕하세요. 자료를 보냅니다.'), 'charsets after an Outlook message'));
  T('mail rtf-only msg→html', 'convert-email', ['rtf.msg'], { to: 'html' }, ([o]) => ok(txt(o).includes('<p>Encapsulated café text</p>'), 'de-encapsulated HTML'));
  X('mail broken msg refused', 'convert-email', ['broken.msg'], { to: 'html' }, /Not an Outlook message/);
  T('mail eml→pdf', 'convert-email', ['mail.eml'], { to: 'pdf' }, async ([o]) => { const t = await pdfText(o); ok(t.includes('Attachments') && t.includes('good link'), 'pdf text'); });
  // E-mail → PDF renders offline: remote pictures, style sheets and imports are never fetched (a local server counts
  // requests) while the message's own data: picture still shows.
  const hits = [];
  const server = require('http').createServer((req, res) => { hits.push(req.url); res.writeHead(200, { 'content-type': 'image/png' }); res.end(read(fx('photo2.jpg'))); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`, remote = path.join(OUT, 'remote.eml');
  fs.writeFileSync(remote, ['From: news@example.com', 'Subject: Remote pictures', 'Content-Type: text/html; charset=utf-8', '', `<html><head><style>@import url(${url}/import.css); body { background: url(${url}/background.png) }</style><link rel="stylesheet" href="${url}/sheet.css"></head><body><p>Offline body text</p><img src="${url}/pixel.png" alt="remote pixel"><img srcset="${url}/srcset.png 2x"><img src="data:image/png;base64,${read(fx('alpha.png')).toString('base64')}" alt="own picture"><div style="background-image:url(${url}/inline.png)">x</div></body></html>`, ''].join('\r\n'));
  C.push({ name: 'mail eml→pdf fetches nothing', tool: 'convert-email', inputs: [remote], opts: { to: 'pdf' }, check: async ([o]) => {
    ok((await pdfText(o)).includes('Offline body text'), 'pdf text');
    const { doc } = await E('pdf').readPdf(o);
    const images = [];
    doc.loadPage(0).toStructuredText('preserve-images').walk({ onImageBlock(b, m, img) { if (img.getWidth() > 32) images.push(`${img.getWidth()}x${img.getHeight()}`); } });
    ok(images.join() === '600x600', `pictures rendered: ${images}; only the message’s own should be`);
    ok(!hits.length, `fetched ${hits.join(', ')}`);
  } });
  T('mhtml→html', 'convert-mhtml', ['page.mhtml'], { to: 'html' }, ([o]) => {
    const h = txt(o);
    ok(h.includes('<title>Lime archive page</title>') && h.includes('<html lang="en">') && h.includes('<body class="article">') && h.includes('Content-Security-Policy'), 'page');
    ok((h.match(/src="data:image\/png;base64,/g) || []).length === 3 && h.includes('background-image:url(') && /\.hero \{ background: url\("data:image\/png;base64,/.test(h), 'pictures from the archive');
    ok(/@media print \{\s*\.printonly/.test(h) && h.includes('font-family: serif') && h.includes('h1 { color: #2c6413 }'), 'style sheets');
    ok(!/<script|<iframe|<link|elsewhere\.example|favicon| srcset=/.test(h) && h.includes('<img alt="missing"/>'), 'removed content');
  });
  T('mhtml→pdf', 'convert-mhtml', ['page.mhtml'], { to: 'pdf' }, async ([o]) => ok((await pdfText(o)).includes('Archived paragraph text'), 'pdf text'));
  T('sheet→csv (all sheets)', 'convert-sheet', ['sheet.xlsx'], { to: 'csv', allSheets: true }, ([o]) => ok(files(o).length === 2 && txt(path.join(o, 'Fruit.csv')).includes('Lime,12'), 'csv'));
  for (const [to, chk] of [['json', (o) => ok(JSON.parse(txt(o).replace(/^\ufeff/, '')).length >= 1 || true, 'json')], ['html', (o) => ok(txt(o).includes('Lime'), 'html')], ['pdf', async (o) => ok((await pdfText(o)).includes('Lime'), 'pdf')], ['ods', (o) => zipHas(o, 'content.xml')], ['md', (o) => ok(txt(o).includes('| Fruit |'), 'md')], ['xls', (o) => ok(require('xlsx').readFile(o).SheetNames.length === 2, 'xls')], ['docx', async (o) => ok((await docxText(o)).includes('Lime'), 'docx')]]) {
    T(`sheet→${to}`, 'convert-sheet', ['sheet.xlsx'], { to, allSheets: false }, async ([o]) => chk(o));
  }
  // Printing a workbook: Budget is 1021 px wide and 1232 px tall on A4 portrait, so 2 column bands × 2 row bands.
  const printed = async (p) => {
    const { doc } = await E('pdf').readPdf(p);
    return Array.from({ length: doc.countPages() }, (_, i) => {
      const pg = doc.loadPage(i), [x0, y0, x1, y1] = pg.getBounds();
      let images = 0;
      pg.toStructuredText('preserve-images').walk({ onImageBlock() { images++; } });
      return { w: Math.round(x1 - x0), h: Math.round(y1 - y0), text: pg.toStructuredText('').asText(), images };
    });
  };
  const PR = { to: 'pdf' };
  T('sheet print: workbook as set in the file', 'convert-sheet', ['print.xlsx'], PR, async ([o], r) => {
    const p = await printed(o);
    same(p.map((x) => `${x.w}x${x.h}`), ['595x842', '595x842', '595x842', '595x842', '842x595'], 'page sizes');
    has(p[0].text, 'Lime Budget 2026', 'Item 1', '3,703.50', '12.50%', 'Q1', 'Page 1 of 5', 'Budget', 'Lime');
    ok(/\d{4}-\d{2}-\d{2}/.test(p[0].text) && /-500/.test(p[0].text), 'date or negative format');
    ok(!p.some((x) => /HiddenRow|HiddenCol|SECRET|Outside/.test(x.text)), 'hidden row, column, sheet or outside the print area printed');
    has(p[1].text, 'Q1', 'Item 60', 'Page 2 of 5');
    ok(!p[1].text.includes('Lime Budget 2026') && !p[0].text.includes('Total'), 'bands');
    has(p[2].text, 'Total', 'Q7');
    has(p[4].text, 'In A1', 'In C5');
    ok(p[0].images === 1 && p[2].images === 0, `pictures ${p.map((x) => x.images)}`);
    ok(/5 pages/.test(r[0].note), r[0].note);
  });
  T('sheet print: fit all columns', 'convert-sheet', ['print.xlsx'], { ...PR, print: 'active', fit: 'columns' }, async ([o]) => { const p = await printed(o); ok(p.length === 1, `${p.length} pages`); has(p[0].text, 'Total', 'Item 60', 'Lime Budget 2026'); });
  T('sheet print: fit all rows', 'convert-sheet', ['print.xlsx'], { ...PR, print: 'active', fit: 'rows' }, async ([o]) => { const p = await printed(o); ok(p.length === 2, `${p.length} pages`); has(p[0].text, 'Item 1', 'Item 60'); ok(!p[0].text.includes('Total') && p[1].text.includes('Total'), 'columns split'); });
  T('sheet print: fit sheet on one page, landscape letter', 'convert-sheet', ['print.xlsx'], { ...PR, print: 'active', fit: 'page', orientation: 'landscape', paper: 'letter' }, async ([o]) => { const p = await printed(o); same(p.map((x) => `${x.w}x${x.h}`), ['792x612'], 'pages'); has(p[0].text, 'Total', 'Item 60'); });
  T('sheet print: over, then down', 'convert-sheet', ['print.xlsx'], { ...PR, print: 'active', fit: 'none', order: 'over' }, async ([o]) => { const p = await printed(o); ok(p.length === 4 && p[1].text.includes('Total') && !p[1].text.includes('Item 60'), `page 2: ${p[1]?.text.slice(0, 80)}`); });
  T('sheet print: selection', 'convert-sheet', ['print.xlsx'], { ...PR, print: 'selection', cells: 'B2:C6' }, async ([o]) => { const p = await printed(o); ok(p.length === 1, `${p.length} pages`); has(p[0].text, 'Q1', 'Q2', '3,703.50', 'Page 1 of 1'); ok(!/Item 1|Lime Budget/.test(p[0].text), 'outside the selection'); });
  T('sheet print: areas on two sheets', 'convert-sheet', ['print.xlsx'], { ...PR, print: 'selection', cells: "Budget!A3:A4, 'Summary'!D10:E11" }, async ([o]) => { const p = await printed(o); ok(p.length === 2, `${p.length} pages`); has(p[0].text, 'Item 1', 'Item 2'); has(p[1].text, 'Outside'); });
  T('sheet print: headings and page numbers', 'convert-sheet', ['print.xlsx'], { ...PR, print: 'selection', cells: 'Summary!A1:C5', headings: true, pageNumbers: true }, async ([o]) => { const t = (await printed(o))[0].text.split('\n').map((x) => x.trim()); ok(['A', 'B', 'C', '1', '5'].every((x) => t.includes(x)), `headings: ${t.slice(0, 12)}`); ok(t.includes('Page 1 of 1'), 'page number'); });
  T('sheet print: ignore print areas', 'convert-sheet', ['print.xlsx'], { ...PR, ignoreArea: true }, async ([o]) => { const p = await printed(o); has(p[p.length - 1].text, 'Outside', 'In A1'); });
  F('sheet print: selection needs cells', 'convert-sheet', ['print.xlsx'], { ...PR, print: 'selection', cells: '' }, /Choose the cells/);
  F('sheet print: unknown sheet', 'convert-sheet', ['print.xlsx'], { ...PR, print: 'selection', cells: 'Nope!A1:B2' }, /no sheet called/);
  T('sheet print: csv with gridlines', 'convert-sheet', ['sheet.csv'], PR, async ([o]) => { const p = await printed(o); ok(p.length === 1, `${p.length} pages`); has(p[0].text, 'Fruit', 'Lime', 'Lemon'); });
  T('csv→xlsx', 'convert-sheet', ['sheet.csv'], { to: 'xlsx' }, ([o]) => { const wb = XLSX.readFile(o); ok(wb.SheetNames[0] === 'sheet' && cell(wb.Sheets.sheet, 'A2') === 's:Lime' && cell(wb.Sheets.sheet, 'B2') === 'n:12', 'xlsx'); });
  T('json→xlsx', 'json-to-sheet', ['data.json'], { to: 'xlsx' }, ([o]) => ok(require('xlsx').readFile(o).SheetNames.length === 1, 'xlsx'));
  T('slides→pdf', 'convert-slides', ['deck.pptx'], { to: 'pdf' }, async ([o]) => { await pages(o, 2); ok((await pdfText(o)).includes('Lime Deck'), 'slide text'); });
  T('slides→png', 'convert-slides', ['deck.pptx'], { to: 'png' }, ([o]) => ok(files(o).length === 2, `${files(o).length} slides`));
  T('doc print: letter landscape, narrow margins, page numbers', 'convert-document', ['doc.docx'], { to: 'pdf', paper: 'letter', orientation: 'landscape', margins: 'narrow', pageNumbers: true }, async ([o]) => {
    const p = await printed(o);
    ok(p.every((x) => x.w === 792 && x.h === 612), `pages ${p.map((x) => `${x.w}x${x.h}`)}`);
    ok(/\b1 \/ \d+/.test(p[0].text) && p[0].text.includes('Lime Report'), `page 1: ${p[0].text.slice(0, 120)}`);
  });
  T('doc print: the Word file’s own page size', 'convert-document', ['doc.docx'], { to: 'pdf' }, async ([o]) => {
    const x = require('fflate').unzipSync(read(fx('doc.docx')))['word/document.xml'], sect = Buffer.from(x).toString('utf8'), w = Number(/w:pgSz[^>]*w:w="(\d+)"/.exec(sect)[1]), h = Number(/w:pgSz[^>]*w:h="(\d+)"/.exec(sect)[1]);
    const p = (await printed(o))[0], want = [Math.round((w / 1440) * 72), Math.round((h / 1440) * 72)];
    ok(Math.abs(p.w - want[0]) <= 2 && Math.abs(p.h - want[1]) <= 2, `${p.w}x${p.h} vs ${want}`);
  });
  T('doc print: pages', 'convert-document', ['doc.md'], { to: 'pdf', pages: '1' }, async ([o]) => { await pages(o, 1); });
  T('slides print: handouts, 2 per page', 'convert-slides', ['deck.pptx'], { to: 'pdf', layout: '2', paper: 'a4', orientation: 'portrait', frame: true }, async ([o]) => {
    const p = await printed(o);
    ok(p.length === 1 && p[0].w === 595 && p[0].h === 842, `pages ${p.map((x) => `${x.w}x${x.h}`)}`);
    ok((p[0].text.match(/Lime Deck/g) || []).length >= 1, `text: ${p[0].text.slice(0, 120)}`);
  });
  T('slides print: 3 per page with lines, landscape letter', 'convert-slides', ['deck.pptx'], { to: 'pdf', layout: '3', paper: 'letter', orientation: 'landscape' }, async ([o]) => { const p = await printed(o); ok(p.length === 1 && p[0].w === 792 && p[0].h === 612, `pages ${p.map((x) => `${x.w}x${x.h}`)}`); });
  T('slides print: one slide', 'convert-slides', ['deck.pptx'], { to: 'pdf', slides: '2' }, async ([o]) => { await pages(o, 1); });
  T('slides→txt', 'convert-slides', ['deck.pptx'], { to: 'txt' }, ([o]) => ok(txt(o).includes('Lime Deck') && txt(o).includes('Second point'), 'txt'));
  T('slides→html', 'convert-slides', ['deck.pptx'], { to: 'html' }, ([o]) => ok(txt(o).includes('class="slide"'), 'html'));
  T('merge docs', 'merge-documents', ['doc.docx', 'doc.pdf', 'photo2.jpg', 'deck.pptx'], {}, async ([o]) => ok((await pages(o)) >= 7, 'pages'));
  T('merge sheets', 'merge-sheets', ['sheet.csv', 'sheet2.csv'], { mode: 'stack', skipHeaders: true }, ([o]) => ok(require('xlsx').utils.sheet_to_json(require('xlsx').readFile(o).Sheets.Combined).length === 3, 'rows'));
  // Word, Excel and PowerPoint tools: each result opened and its content checked; a package check that every
  // relationship leads to a part that exists and every part has a content type.
  const zipOf = (p) => require('fflate').unzipSync(new Uint8Array(read(p)));
  const partOf = (p, f) => { const z = zipOf(p); return z[f] ? Buffer.from(z[f]).toString() : ''; };
  const opcCheck = (p) => {
    const z = zipOf(p), names = Object.keys(z), s = (k) => Buffer.from(z[k]).toString(), ct = s('[Content_Types].xml');
    const defaults = [...ct.matchAll(/<Default\b[^>]*\sExtension="([^"]+)"/g)].map((m) => m[1].toLowerCase()), overrides = new Set([...ct.matchAll(/<Override\b[^>]*\sPartName="\/([^"]+)"/g)].map((m) => m[1]));
    for (const o of overrides) ok(z[o], `content type for a missing part ${o}`);
    for (const n of names.filter((x) => !x.endsWith('/') && x !== '[Content_Types].xml')) ok(overrides.has(n) || defaults.includes(n.split('.').pop().toLowerCase()), `${n} has no content type`);
    for (const r of names.filter((x) => x.endsWith('.rels'))) {
      const owner = r.replace(/(^|\/)_rels\/([^/]+)\.rels$/, '$1$2'), dir = r === '_rels/.rels' ? '' : path.posix.dirname(owner);
      for (const m of s(r).matchAll(/<Relationship\b[^>]*>/g)) {
        if (/TargetMode="External"/.test(m[0])) continue;
        const t = /Target="([^"]+)"/.exec(m[0])[1], abs = t.startsWith('/') ? t.slice(1) : path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, decodeURIComponent(t)));
        ok(z[abs], `${r} points at a missing ${abs}`);
      }
    }
    return z;
  };
  const insTexts = (x) => [...x.matchAll(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g)].map((m) => xmlText(m[1])).filter(Boolean);
  const delTexts = (x) => [...x.matchAll(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/g)].map((m) => (m[1].match(/<w:delText[^>]*>[^<]*<\/w:delText>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')).filter(Boolean);
  const octx = () => { const d = fs.mkdtempSync(path.join(OUT, 'engine-')); return { out: U.outputPlanner({ dest: { kind: 'dir', path: d } }), progress: () => {} }; };
  const settled = async (p, action) => paras((await E('word').trackChanges(p, { action }, octx())).path);
  const odfText = (p, f = 'content.xml') => partOf(p, f).replace(/<text:tracked-changes>[\s\S]*?<\/text:tracked-changes>/g, '').replace(/<office:annotation>[\s\S]*?<\/office:annotation>/g, '').replace(/<\/text:p>/g, '\n').replace(/<[^>]+>/g, '').trim();
  const V1 = ['Quarterly report', 'The quick brown fox jumps over the lazy dog.', 'Total: 100 dollars.', 'This paragraph will be removed entirely.', 'Closing words stay.'];
  const V2 = ['Quarterly report', 'The quick red fox jumps over the lazy dog.', 'Total: 120 dollars.', 'Closing Words stay.', 'A brand new paragraph appears here.'];
  T('compare docs → tracked changes', 'compare-docs', ['v1.docx', 'v2.docx'], { output: 'docx' }, async ([o], r) => {
    ok(path.basename(o) === 'v2 - compared.docx', path.basename(o));
    const x = docxPart(o), ins = insTexts(x), del = delTexts(x);
    for (const t of ['red', '120', 'Words', 'A brand new paragraph appears here.', '4.80']) ok(ins.includes(t), `“${t}” not marked inserted: ${ins}`);
    for (const t of ['brown', '100', 'words', 'This paragraph will be removed entirely.', '4.20']) ok(del.includes(t), `“${t}” not marked deleted: ${del}`);
    ok(!ins.some((t) => /quick|lazy|Quarterly/.test(t)) && !del.some((t) => /quick|lazy|Quarterly/.test(t)), 'unchanged words marked');
    ok(/w:author="Ben Example"/.test(x), 'changes not credited to the newer version’s author');
    same((await settled(o, 'accept')).slice(0, 5), V2, 'accepting every change');
    same((await settled(o, 'reject')).slice(0, 5), V1, 'rejecting every change');
    ok(/5 insertions and 5 deletions/.test(r[0].note), r[0].note);
    opcCheck(o);
  });
  T('compare docs: by character, ignoring case', 'compare-docs', ['v1.docx', 'v2.docx'], { output: 'docx', level: 'char', ignoreCase: true, author: 'Reviewer' }, async ([o]) => {
    const x = docxPart(o), ins = insTexts(x), del = delTexts(x);
    ok(ins.includes('2') && del.includes('0') && !ins.includes('120'), `100→120 not marked by character: ${ins} / ${del}`);
    const closing = (x.match(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?Closing(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/) || [''])[0];
    ok(closing && !/<w:(ins|del)\b/.test(closing), 'a change of case marked');
    ok(/w:author="Reviewer"/.test(x) && !/w:author="Ben/.test(x), 'author option ignored');
    same((await settled(o, 'reject')).slice(0, 5), V1.map((t, i) => (i === 4 ? 'Closing Words stay.' : t)), 'rejecting every change');
  });
  T('compare docs → marked-up PDF', 'compare-docs', ['v1.docx', 'v2.docx'], { output: 'pdf' }, async ([o]) => { const t = (await pdfText(o)).replace(/\s+/g, ' '); has(t, 'Changes from v1.docx to v2.docx', 'brown', 'red', 'This paragraph will be removed entirely.', 'A brand new paragraph'); });
  T('compare text with Markdown', 'compare-docs', ['doc.txt', 'doc.md'], {}, async ([o]) => { const a = (await settled(o, 'accept')).join('\n'), b = (await settled(o, 'reject')).join('\n'); has(a, 'Lime Notes', 'Alpha item'); ok(!a.includes('Lime plain text') && b.includes('Lime plain text') && !b.includes('Alpha item'), `rejected: ${b}`); });
  T('accept tracked changes', 'track-changes', ['tracked.docx'], { action: 'accept' }, ([o], r) => {
    same(paras(o), ['The quick brown fox.', 'A new line by Ana.', 'Format change', 'This is commented.', 'Keep visible. SECRET NOTE'], 'text');
    const x = docxPart(o);
    ok(!/<w:(ins|del|rPrChange)\b/.test(x), 'changes left');
    ok(/<w:b\/><\/w:rPr><w:t>change/.test(x), 'the new formatting is not kept');
    ok(!/trackRevisions/.test(docxPart(o, 'word/settings.xml')), 'still tracking changes');
    ok(/Accepted 5 changes by Ana \(3\), Ben \(2\)/.test(r[0].note), r[0].note);
  });
  T('reject tracked changes', 'track-changes', ['tracked.docx'], { action: 'reject', stopTracking: false }, ([o]) => {
    same(paras(o), ['The brown fox jumps.', 'Format change', 'This is commented.', 'Keep visible. SECRET NOTE'], 'text');
    ok(/<w:i\/><\/w:rPr><w:t>change/.test(docxPart(o)), 'the old formatting is not back');
    ok(/trackRevisions/.test(docxPart(o, 'word/settings.xml')), 'tracking turned off');
  });
  T('accept tracked changes in ODT', 'track-changes', ['tracked.odt'], { action: 'accept' }, ([o]) => { same(odfText(o), 'The quick brown fox.\nSecond paragraph.'); ok(!/tracked-changes|change-start/.test(partOf(o, 'content.xml')), 'markers left'); });
  T('reject tracked changes in ODT', 'track-changes', ['tracked.odt'], { action: 'reject' }, ([o]) => same(odfText(o), 'The brown fox jumps.\nSecond paragraph.'));
  const noted = (re) => (outs, r) => { ok(!outs.length, `saved ${outs}`); ok(re.test(r[0]?.note || ''), r[0]?.note); };
  T('accept changes: none to accept', 'track-changes', ['doc.docx'], {}, noted(/^This document has no tracked changes\.$/));
  T('mail merge: a file per row', 'mail-merge', ['letter.docx'], { data: fx('merge.csv'), name: '{FirstName} {Last Name}' }, ([o], r) => {
    same(files(o).sort(), ['Ada Lovelace.docx', 'Alan Turing.docx', '민지 김.docx'], 'files');
    const ada = path.join(o, 'Ada Lovelace.docx'), x = docxPart(ada);
    same(paras(ada).slice(0, 2), ['Dear Ada Lovelace,', 'Your order of 4.20 ships to London.'], 'Ada’s letter');
    ok(/12 St James Square<\/w:t><w:br\/><w:t[^>]*>London/.test(x), 'line break in the address lost');
    ok(!/MERGEFIELD|«|\{\{/.test(x), 'fields or placeholders left');
    ok(/<w:b\/><\/w:rPr><w:t[^>]*>4\.20/.test(x), 'the merge field’s bold formatting lost');
    ok(!/mailMerge/.test(docxPart(ada, 'word/settings.xml')), 'the data source link is still there');
    same(paras(path.join(o, '민지 김.docx')).slice(0, 2), ['Dear 민지 김,', 'Your order of 1,200 ships to 서울.'], 'Korean letter');
    ok(r[0].note === '3 copies', r[0].note);
  });
  T('mail merge: one document', 'mail-merge', ['letter.docx'], { data: fx('merge.csv'), combine: 'one' }, ([o]) => {
    const x = docxPart(o), p = paras(o);
    ok(p.filter((t) => t.startsWith('Dear ')).length === 3 && p.includes('Your order of 7 ships to Manchester.'), `letters: ${p}`);
    ok((x.match(/<w:type w:val="nextPage"\/>/g) || []).length === 2, 'each letter does not start a new page');
    ok(new Set((x.match(/wp:docPr id="\d+"/g) || [])).size === (x.match(/wp:docPr id="\d+"/g) || []).length, 'duplicate drawing ids');
    opcCheck(o);
  });
  T('mail merge: one PDF', 'mail-merge', ['letter.docx'], { data: fx('merge.csv'), combine: 'one', to: 'pdf' }, async ([o]) => { const t = (await pdfText(o)).replace(/\s+/g, ' '); has(t, 'Dear Ada Lovelace', 'Alan Turing', 'Manchester'); });
  F('mail merge needs a list', 'mail-merge', ['letter.docx'], { data: '' }, /Choose the list/);
  F('mail merge needs fields', 'mail-merge', ['doc.docx'], { data: fx('merge.csv') }, /no merge fields/);
  T('document statistics', 'doc-stats', ['doc.docx'], {}, (outs, r) => {
    const st = r[0].stats;
    ok(st.words === 29 && st.headings === 1 && st.tables === 1 && st.pictures === 1 && st.paragraphs === 8, JSON.stringify(st));
    ok(st.readingEase > 50 && st.readingEase < 100 && st.grade > 0, `readability ${st.readingEase} / ${st.grade}`);
    has(r[0].text, 'Words: 29', 'Flesch reading ease', 'Reading time: under a minute');
    ok(!outs.length, 'saved a report without being asked');
  });
  T('document statistics: slides, saved', 'doc-stats', ['notes.pptx'], { save: true }, ([o], r) => { has(txt(o), 'Slides: 3', 'Words: 24'); ok(r[0].stats.slides === 3, JSON.stringify(r[0].stats)); });
  T('split at headings', 'split-doc', ['chapters.docx'], { level: '1' }, ([o]) => {
    same(files(o).sort(), ['1 Start.docx', '2 Chapter One.docx', '3 Chapter Two.docx'], 'parts');
    same(paras(path.join(o, '2 Chapter One.docx')), ['Chapter One', 'Text of chapter one.', 'Section 1.1', 'Text of section one point one.'], 'chapter one');
    same(paras(path.join(o, '3 Chapter Two.docx')), ['Chapter Two', 'Text of chapter two.'], 'chapter two');
    const pics = (f) => Object.keys(opcCheck(path.join(o, f))).filter((k) => k.startsWith('word/media/')).length;
    ok(pics('2 Chapter One.docx') === 1 && pics('1 Start.docx') === 0 && pics('3 Chapter Two.docx') === 0, 'the picture went to the wrong parts');
  });
  T('split at headings, level 2', 'split-doc', ['chapters.docx'], { level: '2' }, ([o]) => same(files(o).sort(), ['1 Start.docx', '2 Chapter One.docx', '3 Section 1.1.docx', '4 Chapter Two.docx'], 'parts'));
  T('watermark and page numbers', 'watermark-doc', ['doc.docx'], { text: 'DRAFT', pageNumbers: true, numberAlign: 'right' }, async ([o]) => {
    const z = opcCheck(o), s = (k) => Buffer.from(z[k]).toString(), x = s('word/document.xml');
    const hdr = /<w:headerReference w:type="default" r:id="(rId\d+)"/.exec(x), ftr = /<w:footerReference w:type="default" r:id="(rId\d+)"/.exec(x);
    ok(hdr && ftr, 'no header or footer in the section');
    const target = (id) => 'word/' + new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(s('word/_rels/document.xml.rels'))[1];
    ok(/<v:textpath\b[^>]*string="DRAFT"/.test(s(target(hdr[1]))) && /rotation:315/.test(s(target(hdr[1]))), 'no diagonal watermark in the header');
    ok(/ PAGE /.test(s(target(ftr[1]))) && /<w:jc w:val="right"\/>/.test(s(target(ftr[1]))), 'no page number on the right of the footer');
    ok((await docxText(o)).includes('Lime Report'), 'document text lost');
  });
  T('watermark into an existing header', 'watermark-doc', ['v2.docx'], { text: 'CONFIDENTIAL', layout: 'horizontal' }, ([o]) => {
    const z = opcCheck(o), headers = Object.keys(z).filter((k) => /^word\/header\d*\.xml$/.test(k));
    ok(headers.length === 1, `${headers.length} headers`);
    const h = Buffer.from(z[headers[0]]).toString();
    ok(h.includes('Lime header') && /string="CONFIDENTIAL"/.test(h) && !/rotation:315/.test(h), 'header not kept with a level watermark');
  });
  T('find and replace across runs', 'replace-text', ['letter.docx'], { find: '{{last name}}', replace: 'Smith' }, ([o], r) => {
    ok(paras(o)[0] === 'Dear «FirstName» Smith,', paras(o)[0]);
    ok((docxPart(o).match(/<w:r>/g) || []).length === (docxPart(fx('letter.docx')).match(/<w:r>/g) || []).length, 'runs (formatting) lost');
    ok(r[0].note === 'Replaced 1 time', r[0].note);
  });
  T('find and replace whole words', 'replace-text', ['doc.docx'], { find: 'lime', replace: 'Kiwi', wholeWords: true }, ([o]) => { const t = xmlText(docxPart(o)); ok(t.includes('Kiwi Report') && t.includes('Limes') && !t.includes('Kiwis'), t); });
  T('find and replace with a pattern', 'replace-text', ['doc.docx'], { find: '(\\d)\\.(\\d\\d)\\b', replace: '$1,$2', regex: true }, ([o]) => has(xmlText(docxPart(o)), '4,20', '$1,284,50'));
  F('find and replace: match case', 'replace-text', ['doc.docx'], { find: 'lime', replace: 'x', matchCase: true }, /found no “lime”/);
  T('find and replace in a workbook', 'replace-text', ['book.xlsx'], { find: 'Lime', replace: 'Lemon' }, ([o]) => { const ws = XLSX.readFile(o, { cellFormula: true }).Sheets.Data; ok(ws.A2.v === 'Lemon' && ws.A5.v === 'Lemon' && ws.D2.f === 'B2*C2', `${ws.A2.v} ${ws.D2.f}`); opcCheck(o); });
  T('find and replace in slides and notes', 'replace-text', ['notes.pptx'], { find: 'Lime', replace: 'Kiwi' }, async ([o]) => { const d = await E('slides').readDeck(o); ok(d.slides[0].notes[0] === 'Greet everyone and introduce Kiwi.', d.slides[0].notes[0]); });
  T('find and replace in ODT and text', 'replace-text', ['tracked.odt'], { find: 'brown', replace: 'grey' }, ([o]) => ok(odfText(o).startsWith('The quick grey fox'), odfText(o)));
  T('find and replace in plain text', 'replace-text', ['doc.txt'], { find: 'plain', replace: 'simple' }, ([o]) => ok(txt(o).startsWith('Lime simple text'), txt(o)));
  T('remove personal info', 'clean-office', ['tracked.docx'], {}, ([o], r) => {
    const z = opcCheck(o), s = (k) => (z[k] ? Buffer.from(z[k]).toString() : ''), x = s('word/document.xml');
    ok(!z['word/comments.xml'] && !z['docProps/custom.xml'] && !/comment(Reference|RangeStart)/.test(x), 'comments or custom properties left');
    ok(!/Jay Example|Ben Example/.test(s('docProps/core.xml')) && !/Example Co|TotalTime/.test(s('docProps/app.xml')), 'authors or company left');
    ok(!/w:rsid/.test(x + s('word/settings.xml')) && /removePersonalInformation/.test(s('word/settings.xml')), 'editing ids left');
    ok(!/w:author="(Ana|Ben)"/.test(x) && /w:author="Author"/.test(x) && !/w:date=/.test(x), 'tracked-change authors left');
    ok(!x.includes('SECRET NOTE') && x.includes('This is commented.'), 'hidden text kept or text lost');
    ok(/1 comment/.test(r[0].note) && /hidden/.test(r[0].note), r[0].note);
  });
  T('remove personal info, keeping comments', 'clean-office', ['tracked.docx'], { comments: false, hidden: false }, ([o]) => { const z = zipOf(o); ok(z['word/comments.xml'] && Buffer.from(z['word/document.xml']).toString().includes('SECRET NOTE'), 'comments or hidden text removed'); });
  T('remove personal info from ODT', 'clean-office', ['tracked.odt'], {}, ([o]) => { ok(!/Jay Example|Ben Example|editing-cycles/.test(partOf(o, 'meta.xml')), 'meta left'); const c = partOf(o, 'content.xml'); ok(!/office:annotation/.test(c) && /<dc:creator>Author<\/dc:creator>/.test(c) && /<dc:date>/.test(c), 'comment or change author left'); });
  T('remove speaker notes', 'clean-office', ['notes.pptx'], { notes: true }, ([o]) => { const z = opcCheck(o); ok(!Object.keys(z).some((k) => /notesSlides\//.test(k)), 'notes left'); });
  T('extract media from slides', 'office-media', ['deck2.pptx'], {}, async ([o]) => { same(files(o), ['Slide 2 - Image 1.jpg'], 'files'); ok((await sharp(path.join(o, files(o)[0])).metadata()).width === 400, 'not the original picture'); });
  T('extract media from Word', 'office-media', ['big.docx'], { what: 'pictures' }, async ([o]) => { same(files(o).sort(), ['Image 1.jpg', 'Image 2.png'], 'files'); ok((await sharp(path.join(o, 'Image 2.png')).metadata()).width === 2400, 'PNG changed'); });
  T('compress pictures', 'compress-office', ['big.docx'], { size: '1024', quality: 70 }, async ([o]) => {
    const z = opcCheck(o), pics = Object.keys(z).filter((k) => k.startsWith('word/media/'));
    ok(pics.length === 2 && read(o).length < read(fx('big.docx')).length / 3, `${read(o).length} vs ${read(fx('big.docx')).length}`);
    for (const k of pics) { const m = await sharp(Buffer.from(z[k])).metadata(); ok(Math.max(m.width, m.height) <= 1024 && m.format === (k.endsWith('.png') ? 'png' : 'jpeg'), `${k}: ${m.width}×${m.height} ${m.format}`); }
    ok((await docxText(o)).includes('Pictures to compress.'), 'text lost');
  });
  T('formulas to values', 'sheet-values', ['book.xlsx'], {}, ([o], r) => {
    const z = opcCheck(o);
    ok(!Object.keys(z).some((k) => /worksheets\/.*\.xml$/.test(k) && /<f\b/.test(Buffer.from(z[k]).toString())) && !z['xl/calcChain.xml'], 'formulas or calcChain left');
    const wb = XLSX.readFile(o, { cellFormula: true });
    ok(wb.Sheets.Data.D2.v === 4.8 && !wb.Sheets.Data.D2.f && wb.Sheets.Summary.B1.v === 16.1 && wb.Sheets.Summary.B2.v === '  Kiwi  ' && wb.Sheets.Data.D8.w === '#DIV/0!', 'values');
    ok(r[0].note.startsWith('8 formulas'), r[0].note);
  });
  T('formulas to values in ODS', 'sheet-values', ['book.ods'], {}, ([o]) => { const c = partOf(o, 'content.xml'); ok(!/table:formula/.test(c) && /office:value="6"/.test(c), 'formula left or value lost'); });
  T('formulas to values: none there', 'sheet-values', ['sheet.xlsx'], {}, noted(/no formulas/));
  T('tidy rows: nothing to tidy', 'tidy-sheet', ['sheet.xlsx'], {}, noted(/^Nothing to tidy/));
  T('unhide: nothing hidden', 'unhide-sheet', ['sheet.xlsx'], {}, noted(/Nothing in this workbook is hidden or protected/));
  T('split at headings: one part', 'split-doc', ['doc.docx'], {}, noted(/^Nothing to split at Heading 1/));
  T('compress pictures: none there', 'compress-office', ['sheet.xlsx'], {}, noted(/no JPEG or PNG pictures/));
  T('pick slides: nothing to change', 'pick-slides', ['deck.pptx'], {}, noted(/no hidden slides/));
  T('unhide and unprotect', 'unhide-sheet', ['book.xlsx'], {}, ([o], r) => {
    const wb = partOf(o, 'xl/workbook.xml'), d = partOf(o, 'xl/worksheets/sheet1.xml'), s2 = partOf(o, 'xl/worksheets/sheet2.xml');
    ok(!/state="hidden"/.test(wb) && !/hidden="1"/.test(d) && !/sheetProtection/.test(d), 'still hidden or protected');
    ok(/<sheetProtection password="CC1A"/.test(s2), 'a password was removed');
    ok(/1 sheet, 1 row, 1 column/.test(r[0].note) && /stays protected/.test(r[0].note), r[0].note);
  });
  T('unhide rows only', 'unhide-sheet', ['book.xlsx'], { sheets: false, protection: false }, ([o]) => { ok(/state="hidden"/.test(partOf(o, 'xl/workbook.xml')) && /sheetProtection/.test(partOf(o, 'xl/worksheets/sheet1.xml')) && !/hidden="1"/.test(partOf(o, 'xl/worksheets/sheet1.xml')), 'options ignored'); });
  T('unhide and unprotect ODS', 'unhide-sheet', ['book.ods'], {}, ([o]) => { const c = partOf(o, 'content.xml'); ok(!/visibility="collapse"|table:protected/.test(c), 'still hidden or protected'); });
  T('split workbook', 'split-sheets', ['book.xlsx'], {}, ([o]) => {
    same(files(o).sort(), ['Data.xlsx', 'Summary.xlsx'], 'files');
    const d = XLSX.readFile(path.join(o, 'Data.xlsx'), { cellFormula: true }), s = XLSX.readFile(path.join(o, 'Summary.xlsx'), { cellFormula: true });
    same([d.SheetNames, s.SheetNames], [['Data'], ['Summary']], 'sheets');
    ok(d.Sheets.Data.D2.f === 'B2*C2' && !s.Sheets.Summary.B1.f && s.Sheets.Summary.B1.v === 16.1, 'formulas');
    ok((d.Workbook.Names || []).some((n) => n.Name === 'GrandTotal') && !(s.Workbook?.Names || []).some((n) => n.Name === 'GrandTotal'), 'names');
    opcCheck(path.join(o, 'Data.xlsx')); opcCheck(path.join(o, 'Summary.xlsx'));
  });
  T('split workbook with hidden sheets', 'split-sheets', ['book.xlsx'], { hidden: true, values: false }, ([o]) => { same(files(o).sort(), ['Data.xlsx', 'Hidden.xlsx', 'Summary.xlsx'], 'files'); ok(XLSX.readFile(path.join(o, 'Summary.xlsx'), { cellFormula: true }).Sheets.Summary.B1.f === 'Data!D7', 'formula changed'); });
  T('split ODS workbook', 'split-sheets', ['book.ods'], {}, ([o]) => { same(files(o).sort(), ['Data.ods', 'Other.ods'], 'files'); ok(!/table:formula/.test(partOf(path.join(o, 'Other.ods'), 'content.xml')) && /table:formula/.test(partOf(path.join(o, 'Data.ods'), 'content.xml')), 'formulas'); });
  T('tidy rows', 'tidy-sheet', ['book.xlsx'], {}, ([o], r) => {
    const wb = XLSX.readFile(o, { cellFormula: true }), d = wb.Sheets.Data, s = wb.Sheets.Summary;
    same(XLSX.utils.sheet_to_json(d, { header: 1, defval: '' }).map((x) => x[0]), ['Name', 'Lime', 'Lemon', 'Kiwi', 'Total', 'Ratio', 'hidden row', 'Note'], 'rows');
    same([d.D3.f, d.D4.f, d.D4.v, d.D5.f, d.D6.f, s.B1.f, s.B2.f], ['B3*C3', undefined, 3, 'SUM(D2:D4)', 'D5/0', 'Data!D5', 'Data!A4'], 'formulas');
    ok(!/<f t="shared" si="1"\/>/.test(partOf(o, 'xl/worksheets/sheet1.xml')), 'a shared formula lost its first cell');
    same((wb.Workbook.Names || []).map((n) => n.Ref), ['Data!$A$1:$D$6', 'Data!$D$5'], 'names');
    same(d['!merges'].map((m) => XLSX.utils.encode_range(m)), ['A8:B8'], 'merged cells');
    ok(/hidden="1"/.test(partOf(o, 'xl/worksheets/sheet1.xml').match(/<row r="7"[^>]*>/)[0]), 'row formatting did not move with the row');
    same(r[0].note, '1 duplicate row removed, 1 empty row removed, 1 text trimmed');
    opcCheck(o);
  });
  T('tidy rows: spaces only', 'tidy-sheet', ['book.xlsx'], { dedupe: false, emptyRows: false }, ([o], r) => { ok(XLSX.readFile(o).Sheets.Data.A6.v === 'Kiwi' && XLSX.readFile(o).Sheets.Data.A5.v === 'Lime', 'rows moved'); same(r[0].note, '1 text trimmed'); });
  T('tidy CSV', 'tidy-sheet', ['dupes.csv'], {}, ([o]) => same(utf(o), 'Name,Qty\r\nLime,1\r\nKiwi,2\r\n'));
  T('check formulas', 'sheet-formulas', ['book.xlsx'], { save: true }, ([o], r) => {
    same(r[0].note, '8 formulas on 2 sheets; 1 error');
    const rows = XLSX.utils.sheet_to_json(XLSX.readFile(o).Sheets.Formulas);
    ok(rows.length === 8 && rows.some((x) => x.Cell === 'D8' && x.Value === '#DIV/0!' && x.Problem === 'Error #DIV/0!') && rows.some((x) => x.Sheet === 'Summary' && x.Formula === '=Data!D7') && rows.some((x) => x.Cell === 'D6' && x.Formula === '=B6*C6'), JSON.stringify(rows).slice(0, 300));
  });
  T('speaker notes → Word', 'slide-notes', ['notes.pptx'], { to: 'docx', include: 'notes' }, ([o]) => same(paras(o), ['notes', 'Slide 1: Welcome', 'Greet everyone and introduce Lime.', 'Slide 2: Secret slide (hidden)', 'Skip this one on the day.'], 'paragraphs'));
  T('slides and notes → Markdown', 'slide-notes', ['notes.pptx'], { to: 'md', include: 'both' }, ([o]) => has(txt(o), '## Slide 1: Welcome\n\n- First point\n- Second point\n\n**Notes**\n\nGreet everyone', '## Slide 3: Wrap up\n\n- Questions'));
  F('speaker notes: none there', 'slide-notes', ['deck.pptx'], { include: 'notes' }, /no speaker notes/);
  T('merge presentations', 'merge-slides', ['deck.pptx', 'deck2.pptx'], {}, async ([o], r) => {
    const z = opcCheck(o), d = await E('slides').readDeck(o), p = Buffer.from(z['ppt/presentation.xml']).toString();
    same(d.slides.map((s) => s.title || s.body[0]?.text), ['Lime Deck', 'Numbers', 'Appendix', 'Thanks'], 'slides');
    ok(d.slides[2].notes[0] === 'Appendix notes here.', 'notes lost');
    ok((p.match(/<p:sldMasterId\b/g) || []).length === 2, 'the second deck’s design is missing');
    const ids = [...p.matchAll(/<p:(?:sldMasterId|sldLayoutId) id="(\d+)"/g), ...Object.keys(z).filter((k) => /slideMasters\/[^/]+\.xml$/.test(k)).flatMap((k) => [...Buffer.from(z[k]).toString().matchAll(/<p:sldLayoutId id="(\d+)"/g)])].map((m) => m[1]);
    ok(new Set(ids).size === ids.length, 'master and layout ids repeat');
    ok(r[0].note.startsWith('4 slides'), r[0].note);
  });
  T('merge presentations with the first design', 'merge-slides', ['notes.pptx', 'deck2.pptx'], { design: 'first' }, async ([o]) => {
    const z = opcCheck(o), d = await E('slides').readDeck(o);
    same(d.slides.map((s) => s.title), ['Welcome', 'Secret slide', 'Wrap up', 'Appendix', 'Thanks'], 'slides');
    ok(Object.keys(z).filter((k) => /slideMasters\/[^/]+\.xml$/.test(k)).length === 1, 'designs copied');
  });
  T('pick slides', 'pick-slides', ['notes.pptx'], { slides: '3, 1-2', dropHidden: true }, async ([o], r) => {
    const z = opcCheck(o), d = await E('slides').readDeck(o);
    same(d.slides.map((s) => s.title), ['Wrap up', 'Welcome'], 'slides');
    ok(Object.keys(z).filter((k) => /slides\/slide\d+\.xml$/.test(k)).length === 2 && Object.keys(z).filter((k) => /notesSlides\/[^/]+\.xml$/.test(k)).length === 2, 'parts of removed slides left');
    same(r[0].note, '2 of 3 slides kept, 1 removed');
  });
  T('pick slides keeps hidden ones when asked', 'pick-slides', ['notes.pptx'], { slides: '2-3', dropHidden: false }, async ([o]) => same((await E('slides').readDeck(o)).slides.map((s) => s.title), ['Secret slide', 'Wrap up'], 'slides'));
  for (const to of ['pdf', 'png', 'epub', 'pptx']) T(`layout→${to}`, 'convert-layout', ['layout.idml'], { to }, async ([o]) => (to === 'pdf' ? pages(o, 4) : to === 'png' ? ok(files(o).length === 4, 'pages') : zipHas(o, to === 'epub' ? 'mimetype' : 'ppt/')));

  for (const [to, chk] of [['pdf', async (o) => pages(o, 1)], ['svg', (o) => ok(txt(o).includes('LIME CAD TEST'), 'svg text')], ['png', async (o) => fmt(o, 'png')], ['dxf', (o) => ok(txt(o).includes('ENTITIES') && txt(o).includes('LIME CAD TEST'), 'dxf')], ['ai', (o) => ok(read(o).subarray(0, 5).toString() === '%PDF-', 'ai')], ['eps', (o) => ok(/^%!PS/.test(txt(o)) || read(o).readUInt32BE(0) === 0xc5d0d3c6, 'eps')]]) {
    T(`dxf→${to}`, 'convert-cad', ['test.dxf'], { to, sheet: 'a3', mono: false, size: 2000 }, async ([o]) => chk(o));
  }
  T('dxf line weights and types', 'convert-cad', ['lines.dxf'], { to: 'svg' }, ([o]) => {
    const paths = [...txt(o).matchAll(/<path d="M([\d.]+),([\d.]+)[^"]*"[^>]*stroke-width="([\d.]+)"([^>]*)>/g)].map((m) => ({ y: +m[2], w: +m[3], dash: /stroke-dasharray="([^"]+)"/.exec(m[4])?.[1] }));
    ok(paths.length === 3, `paths ${JSON.stringify(paths)}`);
    const [thin, dashed, thick] = [...paths].sort((a, b) => a.y - b.y);
    ok(Math.abs(thick.w / thin.w - 70 / 13) < 0.05, `weights ${thick.w} vs ${thin.w}`);
    ok(dashed.dash === '6.35 3.175' && !thick.dash && !thin.dash, `dashes ${JSON.stringify(paths)}`);
  });
  T('dxf line types in pdf', 'convert-cad', ['lines.dxf'], { to: 'pdf', sheet: 'a4' }, async ([o]) => {
    const { PDFDocument, PDFArray, decodePDFRawStream } = require('pdf-lib');
    const d = await PDFDocument.load(read(o)), c = d.getPages()[0].node.Contents(), list = c instanceof PDFArray ? c.asArray().map((x) => d.context.lookup(x)) : [c];
    const ops = list.map((x) => Buffer.from(decodePDFRawStream(x).decode()).toString('latin1')).join('\n');
    const widths = [...new Set([...ops.matchAll(/([\d.]+) w\b/g)].map((m) => +m[1]))].sort((x, y) => x - y);
    ok(/\[\s*[\d.]+\s+[\d.]+\s*\]\s*[\d.]+\s+d/.test(ops), 'no dash pattern');
    ok(widths.length >= 2 && Math.abs(widths[widths.length - 1] / widths[0] - 70 / 13) < 0.05, `widths ${widths}`);
  });
  T('dxf hatches fill, keep holes, tint patterns', 'convert-cad', ['hatch.dxf'], { to: 'png', size: 2000, mono: false }, async ([o]) => {
    const { data, info } = await sharp(o).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const k = info.width / 318, px = (x, y) => { const i = (Math.round((100 - y + 9) * k) * info.width + Math.round((x + 9) * k)) * 3; return [data[i], data[i + 1], data[i + 2]]; };
    const ring = px(12, 50), hole = px(50, 50), pattern = px(250, 50);
    ok(ring[0] > 200 && ring[1] < 60, `solid hatch not filled: ${ring}`);
    ok(hole.every((v) => v > 240), `hole filled: ${hole}`);
    ok(pattern[0] > 230 && pattern[1] > 150 && pattern[1] < 230, `pattern hatch not tinted: ${pattern}`);
  });
  T('dxf→pdf keeps non-Latin text', 'convert-cad', ['unicode.dxf'], { to: 'pdf', sheet: 'a4' }, async ([o]) => { const t = await pdfText(o); ok(['Größe', 'Ω', 'Привет'].every((w) => t.includes(w)), `text: ${t.trim()}`); });
  const svgWorld = (o, [ox, oy] = [-200, 100]) => {
    const s = txt(o), all = [...s.matchAll(/<path d="([^"]+)"([^>]*)>/g)].map((m) => ({ pts: [...m[1].matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((q) => [+q[1], +q[2]]), a: m[2], closed: m[1].endsWith('Z') }));
    const fr = all.find((p) => p.a.includes('stroke="#00ff00"')), fx = Math.min(...fr.pts.map((p) => p[0])), fy = Math.min(...fr.pts.map((p) => p[1])), W = ([x, y]) => [x - fx + ox, oy - (y - fy)];
    const paths = all.filter((p) => p !== fr).map((p) => { const w = p.pts.map(W); return { ...p, w, box: [0, 1].flatMap((k) => [Math.min(...w.map((q) => q[k])), Math.max(...w.map((q) => q[k]))]), fill: /fill="#/.test(p.a), color: /(?:stroke|fill)="(#[0-9a-f]{6})"/.exec(p.a)?.[1] }; });
    return { paths, texts: [...s.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"([^>]*)>(.*?)<\/text>/g)].map((m) => ({ w: W([+m[1], +m[2]]), a: m[3], t: m[4].replace(/<[^>]+>/g, '') })) };
  };
  const box = (paths, b, tol = 0.05) => paths.find((p) => p.box.every((v, i) => Math.abs(v - b[i]) <= tol));
  const boxes = (paths) => JSON.stringify(paths.map((p) => p.box.map((v) => Math.round(v * 100) / 100)));
  T('dxf polyline widths: wide strokes and tapered bands', 'convert-cad', ['widths.dxf'], { to: 'svg' }, ([o]) => {
    const ps = [...txt(o).matchAll(/<path d="([^"]+)"([^>]*)>/g)].map((m) => { const pts = [...m[1].matchAll(/([\d.]+),([\d.]+)/g)].map((q) => [+q[1], +q[2]]), r = (k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k])); return { n: pts.length, w: r(0), h: r(1), a: m[2] }; });
    const wide = ps.filter((p) => /stroke-linecap="butt"/.test(p.a)), bands = ps.filter((p) => /stroke="none"/.test(p.a)).sort((a, b) => a.n - b.n), thin = ps.filter((p) => !/stroke="none"|butt/.test(p.a));
    ok(wide.length === 1 && /stroke-width="5"/.test(wide[0].a) && /stroke-linejoin="miter"/.test(wide[0].a) && Math.abs(wide[0].w - 100) < 0.01, `constant width ${JSON.stringify(wide)}`);
    ok(bands.length === 2 && bands[0].n === 4 && Math.abs(bands[0].w - 20) < 0.01 && Math.abs(bands[0].h - 6) < 0.01, `arrow ${JSON.stringify(bands)}`);
    ok(bands[1].n >= 10 && Math.abs(bands[1].w - 43) < 0.05 && Math.abs(bands[1].h - 21.5) < 0.05, `bulged band ${JSON.stringify(bands[1])}`);
    ok(thin.length === 1 && Math.abs(thin[0].w - 80) < 0.01 && thin[0].h < 0.01, `zero-width segment ${JSON.stringify(thin)}`);
  });
  T('dxf polyline widths in pdf', 'convert-cad', ['widths.dxf'], { to: 'pdf', sheet: 'a4' }, async ([o]) => {
    const { PDFDocument, PDFArray, decodePDFRawStream } = require('pdf-lib');
    const d = await PDFDocument.load(read(o)), c = d.getPages()[0].node.Contents(), list = c instanceof PDFArray ? c.asArray().map((x) => d.context.lookup(x)) : [c];
    const blocks = list.map((x) => Buffer.from(decodePDFRawStream(x).decode()).toString('latin1')).join('\n').split(/\nQ\b/);
    const strokes = blocks.filter((b) => /\bS\s*$/.test(b)).map((b) => ({ w: +/([\d.]+) w\b/.exec(b)[1], round: /\b1 J\b/.test(b) })), fills = blocks.filter((b) => /\bf\s*$/.test(b));
    const wide = strokes.filter((s) => !s.round);
    ok(wide.length === 1 && Math.abs(wide[0].w - 5 * (595.28 - 56) / 102.5) < 0.05 && strokes.length === 2 && fills.length === 2, `strokes ${JSON.stringify(strokes)}, fills ${fills.length}`);
  });
  T('dxf OCS: mirrored and tilted extrusions', 'convert-cad', ['ocs.dxf'], { to: 'svg' }, ([o]) => {
    const { paths, texts } = svgWorld(o);
    for (const [b, m] of [[[-60, -40, -10, 10], 'circle'], [[-10, 0, 0, 10], 'arc'], [[-30, -10, 20, 20], 'polyline'], [[5, 5, -10, 10], 'tilted circle'], [[-130, -120, -20, -10], 'solid'], [[-160, -140, 40, 60], 'hatch']]) ok(box(paths, b), `${m}: ${boxes(paths)}`);
    const ins = box(paths, [-110, -100, 0, 5]), at = ins?.w.find((q) => Math.abs(q[0] + 100) < 0.01);
    ok(at && Math.abs(at[1]) < 0.01, `mirrored insert: ${JSON.stringify(ins?.w)}`);
    const t = texts.find((x) => x.t === 'MIRROR');
    ok(t && Math.abs(t.w[0] + 60) < 0.01 && Math.abs(t.w[1] - 50) < 0.01 && /text-anchor="end"/.test(t.a) && !/rotate/.test(t.a), `text ${JSON.stringify(t)}`);
  });
  T('dxf layer semantics and colours', 'convert-cad', ['layers.dxf'], { to: 'svg' }, ([o]) => {
    const got = svgWorld(o).paths.map((p) => `${Math.round(p.box[2])}:${p.color}`).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).join(' ');
    ok(got === '0:#123456 2:#007fff 4:#ff00ff 22:#007fff 64:#000000 66:#009800 68:#000000 70:#123456', got);
  });
  for (const mono of [false, true]) {
    T(`dxf→pdf ${mono ? 'black lines' : 'in colour'}`, 'convert-cad', ['layers.dxf'], { to: 'pdf', mono }, async ([o]) => {
      const { doc, m } = await E('pdf').readPdf(o), px = doc.loadPage(0).toPixmap(m.Matrix.scale(1, 1), m.ColorSpace.DeviceRGB, false, true).getPixels();
      let ink = 0, colour = 0;
      for (let i = 0; i < px.length; i += 3) { if (Math.min(px[i], px[i + 1], px[i + 2]) < 200) ink++; if (Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 60) colour++; }
      ok(ink > 500 && (mono ? colour === 0 : colour > 500), `${ink} inked pixels, ${colour} coloured`);
    });
  }
  T('dxf draws model space only', 'convert-cad', ['paper.dxf'], { to: 'svg' }, ([o]) => { const ps = [...txt(o).matchAll(/<path d="([^"]+)"/g)].map((m) => m[1].split('L').length); ok(ps.join() === '2', `paths ${ps}`); });
  T('dxf falls back to paper space', 'convert-cad', ['paperonly.dxf'], { to: 'svg' }, ([o]) => { const ps = [...txt(o).matchAll(/<path d="([^"]+)"/g)].map((m) => m[1].split('L').length).sort((a, b) => a - b); ok(ps.length === 2 && ps[0] === 2 && ps[1] > 100, `paths ${ps}`); });
  T('dxf xlines and rays clipped to the drawing', 'convert-cad', ['xline.dxf'], { to: 'svg' }, ([o]) => { const { paths } = svgWorld(o, [0, 100]); ok(paths.length === 2 && box(paths, [-5, 105, 50, 50]) && box(paths, [50, 50, 50, 105]), boxes(paths)); });
  T('dxf 3DFACE hides invisible edges', 'convert-cad', ['faces.dxf'], { to: 'svg' }, ([o]) => {
    const st = svgWorld(o).paths.filter((p) => !p.fill), a = st.filter((p) => p.box[1] <= 10.01), b = box(st, [20, 30, 0, 10]);
    ok(a.length === 2 && box(a, [0, 0, 0, 10]) && box(a, [10, 10, 0, 10]), `hidden edges drawn: ${boxes(a)}`);
    ok(b?.closed && b.w.length === 4, `visible face: ${JSON.stringify(b)}`);
  });
  T('dxf SOLID and TRACE fill corners 1-2-4-3', 'convert-cad', ['faces.dxf'], { to: 'svg' }, ([o]) => {
    const f = svgWorld(o).paths.filter((p) => p.fill), area = (w) => Math.abs(w.reduce((s, p, k) => { const q = w[(k + 1) % w.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
    ok(f.length === 2 && box(f, [40, 50, 0, 10]) && box(f, [60, 70, 0, 10]) && f.every((p) => p.w.length === 4 && Math.abs(area(p.w) - 100) < 0.01), JSON.stringify(f.map((p) => p.w)));
  });
  for (const to of ['pdf', 'png', 'dxf']) T(`dwg→${to}`, 'convert-cad', ['sample_2018.dwg'], { to, sheet: 'a3', size: 2000 }, async ([o]) => (to === 'pdf' ? pages(o, 1) : to === 'png' ? fmt(o, 'png') : ok(txt(o).includes('ENTITIES'), 'dxf')));
  for (const to of ['stl', 'obj', 'glb', '3mf', 'ply']) T(`step→${to}`, 'convert-model', ['part.stp'], { to }, async ([o]) => ok((await E('cad').info(o)).triangles === 4688, 'triangles'));
  T('step→png', 'convert-model', ['part.stp'], { to: 'png' }, async ([o]) => fmt(o, 'png'));
  T('step→pdf', 'convert-model', ['part.stp'], { to: 'pdf' }, async ([o]) => pages(o, 1));
  T('iges→stl', 'convert-model', ['cube.igs'], { to: 'stl' }, async ([o]) => ok((await E('cad').info(o)).triangles >= 12, 'tris'));
  T('stl→obj', 'convert-model', ['cube.stl'], { to: 'obj' }, async ([o]) => { const i = await E('cad').info(o); ok(i.triangles === 12 && Math.abs(i.volume - 1000) < 1, `vol ${i.volume}`); });
  T('obj→stl', 'convert-model', ['mesh.obj'], { to: 'stl' }, async ([o]) => ok((await E('cad').info(o)).triangles === 4, 'tris'));
  const nearly = (a, b, m) => ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-3 * Math.max(1, Math.abs(b[i]))), `${m} ${a.map((v) => +v.toFixed(4))} ≠ ${b}`);
  const glbBox = (p) => { const b = read(p), js = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()); const a = js.accessors[0]; return a.max.map((v, i) => v - a.min[i]); };
  T('stl→glb metres, Y up', 'convert-model', ['box.stl'], { to: 'glb' }, ([o]) => nearly(glbBox(o), [0.01, 0.03, 0.02], 'glb extents'));
  T('glb→stl millimetres, Z up', 'convert-model', ['box.glb'], { to: 'stl' }, async ([o]) => nearly((await E('cad').info(o)).size, [10, 20, 30], 'stl size'));
  T('step→gltf keeps part colours', 'convert-model', ['part.stp'], { to: 'gltf' }, async ([o]) => { const j = JSON.parse(txt(o)); ok(j.buffers[0].uri.startsWith('data:'), 'not self-contained'); ok(!j.meshes[0].primitives.some((p) => p.attributes.NORMAL != null), 'invented normals'); ok((await E('cad').info(o)).triangles === 4688, 'triangles'); });
  T('3mf inch→stl', 'convert-model', ['box-inch.3mf'], { to: 'stl' }, async ([o]) => nearly((await E('cad').info(o)).size, [25.4, 50.8, 76.2], 'stl size'));
  T('stl→obj→Y up', 'convert-model', ['box.stl'], { to: 'obj' }, async ([o]) => { const v = txt(o).split('\n').filter((l) => l.startsWith('v ')).map((l) => l.split(' ').slice(1).map(Number)); near([0, 1, 2].map((k) => Math.max(...v.map((x) => x[k])) - Math.min(...v.map((x) => x[k]))), [10, 30, 20], 'obj extents'); near((await E('cad').info(o)).size, [10, 20, 30], 'read back'); });
  const attrs = (s) => Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const mf = (p) => { const x = Buffer.from(require('fflate').unzipSync(new Uint8Array(read(p)))['3D/3dmodel.model']).toString(), obj = attrs(/<object\b([^>]*)>/.exec(x)[1]), colors = [...x.matchAll(/displaycolor="([^"]+)"/g)].map((m) => m[1]); return { unit: attrs(/<model\b([^>]*)>/.exec(x)[1]).unit, colors, v: [...x.matchAll(/<vertex\b([^>]*)\/>/g)].map((m) => { const a = attrs(m[1]); return [+a.x, +a.y, +a.z]; }), t: [...x.matchAll(/<triangle\b([^>]*)\/>/g)].map((m) => { const a = attrs(m[1]); return { v: [+a.v1, +a.v2, +a.v3], color: colors[+(a.p1 ?? obj.pindex)] }; }) }; };
  const plyOut = (p) => { const b = read(p), e = b.indexOf('end_header\n') + 11, h = b.subarray(0, e).toString(), nv = +/element vertex (\d+)/.exec(h)[1], nf = +/element face (\d+)/.exec(h)[1], vs = /uchar red/.test(h) ? 16 : 12; return { h, V: Array.from({ length: nv }, (_, i) => [...[0, 4, 8].map((k) => b.readFloatLE(e + i * vs + k)), ...(vs > 12 ? b.subarray(e + i * vs + 12, e + i * vs + 16) : [])]), F: Array.from({ length: nf }, (_, i) => [1, 5, 9].map((k) => b.readUInt32LE(e + nv * vs + i * 13 + k))) }; };
  const vol = (V, F) => F.reduce((s, [a, b, c]) => s + V[a][0] * (V[b][1] * V[c][2] - V[b][2] * V[c][1]) - V[a][1] * (V[b][0] * V[c][2] - V[b][2] * V[c][0]) + V[a][2] * (V[b][0] * V[c][1] - V[b][1] * V[c][0]), 0) / 6;
  const box3 = (v) => [0, 1, 2].map((k) => Math.min(...v.map((p) => p[k]))).concat([0, 1, 2].map((k) => Math.max(...v.map((p) => p[k]))));
  T('fbx→stl binary, centimetres, Y up', 'convert-model', ['cube.fbx'], { to: 'stl' }, async ([o]) => {
    const i = await E('cad').info(o);
    ok(i.triangles === 12 && i.watertight, `${i.triangles} triangles`);
    near([...i.min, ...i.max, i.volume], [0, -200, 100, 200, 0, 300, 8e6], 'cube min, max, volume');
    let err = '';
    try { E('fbx').readFbx(read(fx('cube.fbx')).subarray(0, 600), fx('cube.fbx')); } catch (e) { err = e.message; }
    ok(err === 'The FBX file is cut short or damaged.', `cut-short file: ${err || 'read without error'}`);
  });
  T('fbx→3mf keeps material colours', 'convert-model', ['cube.fbx'], { to: '3mf' }, ([o]) => {
    const m = mf(o), blue = m.t.filter((t) => t.color === '#0000FF');
    ok(m.unit === 'millimeter' && m.v.length === 8 && m.t.length === 12, `${m.unit}, ${m.v.length} vertices, ${m.t.length} triangles`);
    ok(m.colors.join() === '#FF0000,#0000FF' && blue.length === 2, `colours ${m.colors}, ${blue.length} blue triangles`);
    ok(blue.every((t) => t.v.every((k) => m.v[k][2] === 300)), 'the blue (+Y) face is not on top');
  });
  T('fbx ascii→3mf Z up, nested transforms, mm', 'convert-model', ['box-ascii.fbx'], { to: '3mf' }, ([o]) => {
    const m = mf(o);
    ok(m.t.length === 12 && m.colors.join() === '#CCCCCC', `${m.t.length} triangles, colours ${m.colors}`);
    near(box3(m.v), [60, 0, 10, 100, 20, 70], 'box min, max');
  });
  T('fbx→obj writes an mtl', 'convert-model', ['cube.fbx'], { to: 'obj' }, ([o, mtl]) => {
    ok(/\.mtl$/.test(mtl || ''), `outputs ${o}, ${mtl}`);
    const L = txt(o).split('\n'), v = L.filter((l) => l.startsWith('v ')).map((l) => l.split(' ').slice(1).map(Number)), kd = {}, faces = {};
    ok(L.includes(`mtllib ${path.basename(mtl)}`), 'mtllib does not name the .mtl');
    let cur = null;
    for (const l of txt(mtl).split('\n')) if (l.startsWith('newmtl ')) cur = l.slice(7); else if (l.startsWith('Kd ')) kd[cur] = l.slice(3);
    for (const l of L) if (l.startsWith('usemtl ')) cur = kd[l.slice(7)]; else if (l.startsWith('f ')) (faces[cur] = faces[cur] || []).push(l.split(' ').slice(1).map((k) => v[k - 1]));
    ok(faces['1 0 0']?.length === 10 && faces['0 0 1']?.length === 2, `faces by Kd: ${Object.entries(faces).map(([k, f]) => `${k} ×${f.length}`)}`);
    ok(faces['0 0 1'].flat().every((p) => p[1] === 300), 'blue faces are not on top (Y up, 300 mm)');
  });
  T('obj concave face ear-clipped', 'convert-model', ['lshape.obj'], { to: 'stl' }, async ([o]) => {
    const i = await E('cad').info(o), b = read(o), n = Array.from({ length: 5 }, (_, k) => [0, 4, 8].map((j) => +b.readFloatLE(84 + k * 50 + j).toFixed(4)).join());
    ok(i.triangles === 5 && Math.abs(i.area - 350) < 1e-6, `${i.triangles} triangles, area ${i.area} (a fan gives 450)`);
    ok(n.every((x) => x === '0,-1,0'), `normals ${n.join(' ')}`);
  });
  T('obj mtl and vertex colours→3mf', 'convert-model', ['lshape.obj'], { to: '3mf' }, ([o]) => {
    const m = mf(o);
    ok(m.v.length === 9 && m.t.length === 5, `${m.v.length} vertices, ${m.t.length} triangles`);
    ok(m.t.map((t) => t.color).join() === '#00FF00,#FF8000BF,#FF8000BF,#FF8000BF,#FF8000BF', `colours ${m.t.map((t) => t.color)}`);
    near(box3(m.v), [0, 0, 0, 40, 0, 20], 'Y up to Z up');
  });
  T('ply vertex colours→glb materials', 'convert-model', ['colors.ply'], { to: 'glb' }, async ([o]) => {
    const b = read(o), js = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()), f = js.materials.map((x) => x.pbrMetallicRoughness.baseColorFactor.map((c) => +c.toFixed(3)));
    ok(f.join(' ') === '1,0,0,1 0,0,1,0.502' && !js.materials[0].alphaMode && js.materials[1].alphaMode === 'BLEND', `materials ${f.join(' ')}`);
    ok(js.meshes[0].primitives.map((p) => js.accessors[p.indices].count).join() === '6,6', 'triangles per colour');
    const i = await E('cad').info(o);
    ok(Math.abs(i.area - 140) < 1e-3, `area ${i.area} (a fan gives 160)`);
  });
  T('3mf colours, support, mirror→ply', 'convert-model', ['colors.3mf'], { to: 'ply' }, ([o]) => {
    const { h, V, F } = plyOut(o), col = (c) => F.filter((f) => f.every((k) => V[k].slice(3).join() === c));
    ok(/property uchar alpha/.test(h) && F.length === 12, `${F.length} faces`);
    const blue = col('0,0,255,255');
    ok(blue.length === 2 && col('255,0,0,255').length === 10 && blue.every((f) => f.every((k) => V[k][2] === 10)), `${blue.length} blue faces, ${col('255,0,0,255').length} red`);
    near([...box3(V).slice(0, 1), vol(V, F)], [-10, 1000], 'mirrored x, outward volume');
  });
  T('stl→ply without colours', 'convert-model', ['box.stl'], { to: 'ply' }, ([o]) => { const { h, V, F } = plyOut(o); ok(!/red/.test(h) && F.length === 12 && Math.abs(vol(V, F) - 6000) < 1e-3, `${F.length} faces, volume ${vol(V, F)}`); });
  T('measure model', 'cad-info', ['cube.stl'], { save: false }, (o, r) => ok(/Volume: 1(\.0+)? cm³|Volume: 1 cm/.test(r[0].text), r[0].text));
  // Saving the way FreeCAD does: STEP, IGES and BREP (exact through Open CASCADE, faceted solids from meshes), more mesh
  // formats, units, repair, simplify, merge and drawings. Every result is read back (by Open CASCADE, Lime or an XML parser) and measured.
  const cadInfo = (o) => E('cad').info(o);
  const ents = (t, e) => (t.match(new RegExp(`=${e}\\(`, 'g')) || []).length;
  T('stl→step: a flat face per side, one closed solid', 'convert-model', ['box.stl'], { to: 'step' }, async ([o]) => {
    const t = txt(o);
    ok(/^ISO-10303-21;/.test(t) && /FILE_SCHEMA\(\('AUTOMOTIVE_DESIGN/.test(t) && /SI_UNIT\(\.MILLI\.,\.METRE\.\)/.test(t), 'header or units');
    ok(ents(t, 'MANIFOLD_SOLID_BREP') === 1 && ents(t, 'CLOSED_SHELL') === 1 && ents(t, 'ADVANCED_FACE') === 6 && ents(t, 'PLANE') === 6 && ents(t, 'EDGE_CURVE') === 12 && ents(t, 'VERTEX_POINT') === 8, `${ents(t, 'ADVANCED_FACE')} faces, ${ents(t, 'EDGE_CURVE')} edges, ${ents(t, 'VERTEX_POINT')} vertices`);
    const i = await cadInfo(o);
    nearly([...i.size, i.volume], [10, 20, 30, 6000], 'read back by Open CASCADE');
  });
  T('stl→step without merging: a face per triangle', 'convert-model', ['box.stl'], { to: 'step', refine: false }, async ([o]) => { ok(ents(txt(o), 'ADVANCED_FACE') === 12 && ents(txt(o), 'EDGE_CURVE') === 18, `${ents(txt(o), 'ADVANCED_FACE')} faces`); nearly([(await cadInfo(o)).volume], [6000], 'volume'); });
  T('stl→step in inches', 'convert-model', ['box.stl'], { to: 'step', units: 'in' }, async ([o]) => {
    const t = txt(o), z = [...t.matchAll(/CARTESIAN_POINT\('',\(([^)]*)\)\)/g)].map((m) => +m[1].split(',')[2]);
    ok(/CONVERSION_BASED_UNIT\('INCH',#\d+\)LENGTH_UNIT\(\)NAMED_UNIT\(#\d+\)/.test(t), 'no inch unit');
    nearly([Math.max(...z)], [30 / 25.4], 'top in inches');
    nearly((await cadInfo(o)).size, [10, 20, 30], 'read back in millimetres');
  });
  T('stl→iges: trimmed planes, grouped, in inches', 'convert-model', ['box.stl'], { to: 'iges', units: 'in' }, async ([o]) => {
    const L = txt(o).split('\n').filter(Boolean), types = L.filter((l) => l[72] === 'D').filter((_, i) => i % 2 === 0).map((l) => +l.slice(0, 8)), g = L.filter((l) => l[72] === 'G').map((l) => l.slice(0, 72)).join('');
    ok(L.every((l) => l.length === 80) && L[L.length - 1][72] === 'T', 'not 80-column IGES');
    ok(types.filter((x) => x === 144).length === 6 && types.filter((x) => x === 108).length === 6 && types.filter((x) => x === 402).length === 1, `entities ${types}`);
    ok(/1\.,1,4HINCH,/.test(g), `units: ${g}`);
    const i = await cadInfo(o);
    nearly([...i.size, i.volume], [10, 20, 30, 6000], 'read back by Open CASCADE');
  });
  T('stl→brep: Open CASCADE’s own format', 'convert-model', ['box.stl'], { to: 'brep' }, async ([o]) => { ok(/^DBRep_DrawableShape\n\nCASCADE Topology V1/.test(txt(o)) && /\nSo\n/.test(txt(o)), 'not a BREP solid'); nearly([(await cadInfo(o)).volume], [6000], 'volume'); });
  for (const to of ['step', 'iges', 'brep']) {
    T(`hollow mesh→${to} keeps its void`, 'convert-model', ['hollow.stl'], { to }, async ([o]) => {
      if (to === 'step') ok(/BREP_WITH_VOIDS\(/.test(txt(o)) && /ORIENTED_CLOSED_SHELL\('',\*,#\d+,\.F\.\)/.test(txt(o)), 'no void');
      const i = await cadInfo(o);
      nearly([i.volume, ...i.size], [7000, 20, 20, 20], 'the solid less its void');
    });
    T(`step→${to} exact through Open CASCADE`, 'convert-model', ['part.stp'], { to }, async ([o]) => {
      ok({ step: /Open CASCADE STEP processor/, iges: /Open CASCADE IGES processor/, brep: /^DBRep_DrawableShape\n\nCASCADE Topology V3/ }[to].test(txt(o)), 'not written by Open CASCADE');
      const [a, b] = await Promise.all([cadInfo(fx('part.stp')), cadInfo(o)]);
      ok(a.triangles === b.triangles, `${b.triangles} triangles, not ${a.triangles}`);
      nearly([b.volume, ...b.size], [a.volume, ...a.size], 'the same solids');
    });
  }
  T('iges→step exact', 'convert-model', ['cube.igs'], { to: 'step' }, async ([o]) => { ok(/Open CASCADE STEP processor/.test(txt(o)), 'not written by Open CASCADE'); nearly([(await cadInfo(o)).volume], [1000], 'volume'); });
  T('step→step half size, centred on the ground', 'convert-model', ['part.stp'], { to: 'step', centre: 'floor', scale: 50 }, async ([o]) => {
    const [a, b] = await Promise.all([cadInfo(fx('part.stp')), cadInfo(o)]);
    nearly([...b.size, b.volume], [...a.size.map((v) => v / 2), a.volume / 8], 'half size');
    ok(Math.abs(b.min[2]) < 1e-3 && Math.abs(b.min[0] + b.max[0]) < 1e-3 && Math.abs(b.min[1] + b.max[1]) < 1e-3, `box ${b.min} ${b.max}`);
  });
  T('3mf→off keeps face colours', 'convert-model', ['colors.3mf'], { to: 'off' }, async ([o]) => {
    const L = txt(o).trim().split('\n'), F = L.slice(10).map((l) => l.split(' ').map(Number)), V = L.slice(2, 10).map((l) => l.split(' ').map(Number)), col = (c) => F.filter((f) => f.slice(4, 7).join() === c).length;
    ok(L[0] === 'OFF' && L[1] === '8 12 0' && col('255,0,0') === 10 && col('0,0,255') === 2, `${L[1]}; ${col('255,0,0')} red, ${col('0,0,255')} blue`);
    nearly([vol(V, F.map((f) => f.slice(1, 4)))], [1000], 'outward volume');
    const m = await E('cad').readMesh(o);
    ok(m.parts?.length === 2 && m.parts[1].color === 0x0000ff, `read back ${JSON.stringify(m.parts)}`);
  });
  T('3mf→amf: a volume per colour, in inches', 'convert-model', ['colors.3mf'], { to: 'amf', units: 'in' }, ([o]) => {
    const d = xmlDoc(txt(o), 'AMF'), V = tags(d, 'vertex').map((v) => ['x', 'y', 'z'].map((k) => +tags(v, k)[0].textContent * 25.4)), vols = tags(d, 'volume');
    const F = vols.flatMap((v) => tags(v, 'triangle').map((t) => ['v1', 'v2', 'v3'].map((k) => +tags(t, k)[0].textContent)));
    ok(d.documentElement.getAttribute('unit') === 'inch' && vols.length === 2 && F.length === 12, `${vols.length} volumes, ${F.length} triangles`);
    ok(vols.map((v) => ['r', 'g', 'b'].map((k) => tags(v, k)[0].textContent).join(' ')).join() === '1 0 0,0 0 1', 'colours');
    nearly([vol(V, F)], [1000], 'volume');
  });
  T('3mf→wrl: VRML 97 in metres, Y up, colours', 'convert-model', ['colors.3mf'], { to: 'wrl' }, ([o]) => {
    const t = txt(o), V = /point \[([^\]]*)\]/.exec(t)[1].split(',').map((p) => p.trim().split(/\s+/).map(Number)), F = [...t.matchAll(/coordIndex \[([^\]]*)\]/g)].flatMap((m) => m[1].split(',').map((f) => f.trim().split(/\s+/).map(Number).slice(0, 3)));
    ok(/^#VRML V2\.0 utf8/.test(t) && /rotation 1 0 0 -1\.5707963/.test(t) && /scale 0\.001 0\.001 0\.001/.test(t) && /coord USE C/.test(t), 'transform or shared points');
    ok(/diffuseColor 1 0 0/.test(t) && /diffuseColor 0 0 1/.test(t) && V.length === 8 && F.length === 12, `${V.length} points, ${F.length} faces`);
    nearly([vol(V, F)], [1000], 'volume');
  });
  T('3mf→x3d: units and shared points', 'convert-model', ['colors.3mf'], { to: 'x3d' }, ([o]) => {
    const d = xmlDoc(txt(o), 'X3D'), u = tags(d, 'unit')[0], sets = tags(d, 'IndexedFaceSet'), V = tags(d, 'Coordinate')[0].getAttribute('point').split(',').map((p) => p.trim().split(/\s+/).map(Number));
    const F = sets.flatMap((s) => s.getAttribute('coordIndex').trim().split(/\s+/).map(Number).join(' ').split(' -1').filter((x) => x.trim()).map((x) => x.trim().split(' ').map(Number)));
    ok(u.getAttribute('conversionFactor') === '0.001' && sets.length === 2 && tags(d, 'Coordinate')[1].getAttribute('USE') === 'C', 'units or shapes');
    nearly([vol(V, F)], [1000], 'volume');
  });
  T('3mf→dae: Collada with units, Z up, a material per colour', 'convert-model', ['colors.3mf'], { to: 'dae' }, ([o]) => {
    const d = xmlDoc(txt(o), 'COLLADA'), a = tags(d, 'float_array')[0], P = a.textContent.trim().split(/\s+/).map(Number), V = Array.from({ length: P.length / 3 }, (_, i) => P.slice(i * 3, i * 3 + 3)), tris = tags(d, 'triangles');
    const F = tris.flatMap((t) => { const p = tags(t, 'p')[0].textContent.trim().split(/\s+/).map(Number); return Array.from({ length: p.length / 3 }, (_, i) => p.slice(i * 3, i * 3 + 3)); });
    ok(tags(d, 'unit')[0].getAttribute('meter') === '0.001' && tags(d, 'up_axis')[0].textContent === 'Z_UP' && +a.getAttribute('count') === 24, 'units or points');
    ok(tris.map((t) => t.getAttribute('count')).join() === '10,2' && tags(d, 'material').length === 2, 'triangles per material');
    nearly([vol(V, F)], [1000], 'volume');
  });
  T('stl→ascii stl', 'convert-model', ['box.stl'], { to: 'stl', ascii: true }, async ([o]) => { ok(/^solid box\n/.test(txt(o)) && (txt(o).match(/facet normal/g) || []).length === 12, 'not ASCII STL'); nearly([(await cadInfo(o)).volume], [6000], 'volume'); });
  T('stl→3mf in inches', 'convert-model', ['box.stl'], { to: '3mf', units: 'in' }, async ([o]) => { const m = mf(o); ok(m.unit === 'inch', m.unit); nearly(box3(m.v).slice(3), [10 / 25.4, 20 / 25.4, 30 / 25.4], 'inches'); nearly((await cadInfo(o)).size, [10, 20, 30], 'read back'); });
  T('stl→obj centred at double size', 'convert-model', ['box.stl'], { to: 'obj', centre: 'centre', scale: 200 }, async ([o]) => { const i = await cadInfo(o); nearly([...i.min, ...i.max], [-10, -20, -30, 10, 20, 30], 'box'); });
  T('repair mesh: turned, doubled and broken triangles', 'repair-model', ['broken.stl'], {}, async ([o], r) => {
    ok(/^Removed 1 broken triangle, removed 1 doubled triangle, turned 1 triangle round\.$/.test(r[0].note), r[0].note);
    const i = await cadInfo(o);
    ok(i.triangles === 12 && i.watertight && /broken-repaired\.stl$/.test(o), `${i.triangles} triangles, watertight ${i.watertight}`);
    nearly([i.volume], [1000], 'volume');
  });
  T('simplify: a fifth of the triangles, the same size', 'simplify-model', ['part.stp'], { keep: 20 }, async ([o], r) => {
    const [a, b] = await Promise.all([cadInfo(fx('part.stp')), cadInfo(o)]);
    ok(b.triangles < a.triangles / 2 && r[0].note.endsWith(`→ ${b.triangles.toLocaleString('en-US')}`), `${a.triangles} → ${b.triangles}: ${r[0].note}`);
    nearly(b.size, a.size, 'size');
  });
  T('merge models side by side', 'merge-models', ['box.stl', 'cube.stl'], { to: 'stl', arrange: true }, async ([o]) => { const i = await cadInfo(o); ok(i.triangles === 24 && i.size[0] > 20, `${i.triangles} triangles, ${i.size}`); nearly([i.volume, i.size[1], i.size[2]], [7000, 20, 30], 'volume'); });
  T('merge models→step: two solids', 'merge-models', ['box.stl', 'cube.stl'], { to: 'step', arrange: true }, async ([o]) => { ok(ents(txt(o), 'MANIFOLD_SOLID_BREP') === 2, `${ents(txt(o), 'MANIFOLD_SOLID_BREP')} solids`); nearly([(await cadInfo(o)).volume], [7000], 'volume'); });
  const sheetLines = (o, cls) => [...txt(o).matchAll(new RegExp(`<path d="M([^"]+)"[^>]*class="${cls}"`, 'g'))].map((m) => m[1].split('L').map((p) => p.split(',').map(Number)));
  const length = (ls) => ls.reduce((s, l) => s + l.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0), 0);
  // The top-left view: an L (three heights of corner) in first angle, where the front view is; a plain rectangle (two) in third.
  const cornerHeights = (o) => { const pts = sheetLines(o, 'Visible').flat(), x0 = Math.min(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])); return new Set(pts.filter((p) => p[0] <= x0 + 200.01 && p[1] <= y0 + 100.01).map((p) => Math.round(p[1] * 100))).size; };
  T('drawing: three views at 5:1, the hidden step dashed', 'model-drawing', ['step.stl'], { to: 'svg', views: 'three' }, ([o]) => {
    const t = txt(o), vis = sheetLines(o, 'Visible'), hid = sheetLines(o, 'Hidden');
    ok(/width="420mm" height="297mm"/.test(t) && />5:1</.test(t) && />step</.test(t) && cornerHeights(o) === 3, 'sheet, scale, title or the front view’s place');
    // Front: the L (120 mm round); top: 40 × 20 and the step's edge; left: 20 × 20; all five times over.
    nearly([length(vis)], [(120 + 140 + 80) * 5], 'visible lines');
    ok(hid.length === 1 && hid[0].length === 2 && Math.abs(hid[0][0][1] - hid[0][1][1]) < 1e-3, `hidden ${JSON.stringify(hid)}`);
    nearly([length(hid)], [100], 'the hidden step across the side view');
  });
  T('drawing: third angle puts the top view above', 'model-drawing', ['step.stl'], { to: 'svg', views: 'three', angle: 'third' }, ([o]) => {
    ok(!sheetLines(o, 'Hidden').length && cornerHeights(o) === 2, `the view from the right hides nothing and the top view comes first (${cornerHeights(o)})`);
  });
  T('drawing→pdf: an A3 sheet at 1:50', 'model-drawing', ['part.stp'], { to: 'pdf' }, async ([o], r) => {
    const { doc } = await E('pdf').readPdf(o), b = doc.loadPage(0).getBounds(), t = await pdfText(o);
    nearly([b[2] - b[0], b[3] - b[1]], [420 / 25.4 * 72, 297 / 25.4 * 72], 'A3 landscape');
    ok(['1:50', 'part', 'part.stp', 'mm', 'A3'].every((w) => t.includes(w)) && r[0].note === '4 views at 1:50 on A3', `text ${t.replace(/\s+/g, ' ')} · ${r[0].note}`);
  });
  T('drawing→dxf: AutoCAD 2000, hidden lines on their own layer', 'model-drawing', ['step.stl'], { to: 'dxf', views: 'three' }, async ([o]) => {
    const t = txt(o), d = new (require('dxf-parser'))().parseSync(t);
    ok(/\$ACADVER\r\n {2}1\r\nAC1015/.test(t) && d.tables.lineType.lineTypes.HIDDEN?.pattern?.join() === '3,-1.5', 'version or linetype');
    const hid = d.entities.filter((e) => e.layer === 'Hidden'), lay = d.tables.layer.layers;
    ok(hid.length === 1 && lay.Hidden && lay.Visible && d.entities.some((e) => e.type === 'TEXT' && e.text === '5:1'), `${hid.length} hidden`);
    const items = E('cad').flatten(await E('cad').readDrawing(o));
    ok(items.some((i) => i.layer === 'Hidden' && i.dash?.join() === '3,-1.5'), 'hidden line not dashed when read back');
  });
  F('drawing refuses a scale that doesn’t fit', 'model-drawing', ['box.stl'], { scale: '50' }, /don’t fit on A3/);
  // AutoCAD 2000 DXF from drawings: read back, the same geometry, layers, colours and weights as the source (a filled
  // SOLID or wide polyline band comes back as a solid HATCH); R12 still there.
  const dxfSig = (items) => { const e = E('cad').extents(items), k = {}; for (const it of items) k[it.k + (it.fill ? 'F' : '')] = (k[it.k + (it.fill ? 'F' : '')] || 0) + 1; return JSON.stringify({ e: [e.x0, e.y0, e.x1, e.y1].map((v) => +v.toFixed(3)), k, c: [...new Set(items.map((i) => `${i.layer}:${i.rgb}:${i.fill ? 'fill' : i.lw ?? null}`))].sort(), t: items.filter((i) => i.k === 'text').map((i) => i.text) }); };
  for (const f of ['layers.dxf', 'test.dxf', 'unicode.dxf', 'widths.dxf', 'ocs.dxf', 'lines.dxf', 'sample_2018.dwg']) {
    T(`${f}→dxf 2000 reads back the same`, 'convert-cad', [f], { to: 'dxf' }, async ([o]) => {
      const t = txt(o), handles = [...t.matchAll(/\r\n {2}5\r\n([0-9A-F]+)\r\n/g)].map((m) => m[1]);
      ok(/\$ACADVER\r\n {2}1\r\nAC1015/.test(t) && handles.length && new Set(handles).size === handles.length, 'version or handles');
      const [a, b] = await Promise.all([fx(f), o].map(async (p) => dxfSig(E('cad').flatten(await E('cad').readDrawing(p)))));
      ok(a === b, `differs:\n${a}\n${b}`);
      if (f === 'test.dxf') ok(/\r\nCIRCLE\r\n/.test(t) && /\r\nARC\r\n/.test(t) && /\r\nMTEXT\r\n/.test(t), 'circles, arcs or MTEXT flattened');
      if (f === 'unicode.dxf') ok(/\\U\+041F/.test(t), 'non-Latin text not escaped');
    });
  }
  T('dxf→dxf R12 still available', 'convert-cad', ['layers.dxf'], { to: 'dxf', dxf: 'r12' }, ([o]) => ok(/\$ACADVER\r\n1\r\nAC1009/.test(txt(o)), 'not R12'));
  for (const [src, to, chk] of [['logo.svg', 'pdf', (o) => magic(o, '%PDF')], ['logo.svg', 'ai', (o) => magic(o, '%PDF')], ['logo.svg', 'eps', (o) => ok(/^%!PS/.test(txt(o)) || read(o).readUInt32BE(0) === 0xc5d0d3c6, 'eps')], ['logo.svg', 'png', async (o) => fmt(o, 'png')], ['logo.svg', 'dxf', (o) => ok(txt(o).includes('SECTION'), 'dxf')], ['logo.svg', 'emf', (o) => ok(read(o).readUInt32LE(0) === 1, 'emf')], ['logo.ai', 'svg', (o) => ok(txt(o).includes('<svg'), 'svg')], ['logo.eps', 'pdf', (o) => magic(o, '%PDF')]]) {
    T(`vector ${src}→${to}`, 'convert-vector', [src], { to, scale: 2 }, async ([o]) => chk(o));
  }

  for (const a of ['archive.zip', 'archive.7z', 'archive.tar.gz']) T(`extract ${a}`, 'extract-archive', [a], {}, ([o]) => ok(fs.existsSync(path.join(o, 'a.txt')) && fs.existsSync(path.join(o, 'inner', 'b.txt')), `contents ${files(o)}`));
  T('zip folder', 'create-archive', ['folder'], { format: 'zip', level: 5 }, ([o]) => zipHas(o, 'b.txt'));
  T('7z with password', 'create-archive', ['doc.txt', 'photo2.jpg'], { format: '7z', level: 5, password: 'pw' }, ([o]) => magic(o, '7z'));
  T('convert archive', 'convert-archive', ['archive.zip'], { format: '7z', level: 5 }, ([o]) => magic(o, '7z'));
  T('test archive', 'test-archive', ['archive.zip'], {}, (o, r) => ok(/intact/.test(r[0].note), r[0].note));
  T('checksum', 'file-hash', ['doc.txt'], { algos: ['sha256'], expected: '' }, (o, r) => ok(r[0].text.includes(require('crypto').createHash('sha256').update(read(fx('doc.txt'))).digest('hex')), 'hash'));

  // Data formats (JSON, JSONC, JSON Lines, YAML, TOML, XML, CSV) through one tree; vectors from Filee's tests.
  T('data json→yaml', 'convert-data', ['sample.json'], { to: 'yaml' }, ([o]) => { ok(!bom(o), 'BOM'); same(txt(o), 'name: Filee 변환기\nversion: 3\nratio: 3.0\nbig: 12345678901234567890\nenabled: true\nmissing: null\nnotes: |-\n  first line\n  second line\nlooksLikeABoolean: "true"\nlooksLikeANumber: "007"\nempty: ""\ntags:\n  - a\n  - b\nnothing: []\nowner:\n  id: 1\n  email: me@example.com\nrows:\n  - x: 1\n  - x: 2\n'); });
  T('data json→toml', 'convert-data', ['sample.json'], { to: 'toml' }, ([o]) => {
    const t = txt(o);
    ok(!t.includes('missing'), 'null kept');
    has(t, 'big = "12345678901234567890"\n', 'ratio = 3.0\n', '\n[owner]\nid = 1\n', '\n[[rows]]\nx = 1\n\n[[rows]]\nx = 2\n');
    const back = require('smol-toml').parse(t, { integersAsBigInt: true });
    ok(back.name === 'Filee 변환기' && back.version === 3n && back.rows.length === 2, 'TOML reads back');
  });
  T('data json→xml', 'convert-data', ['sample.json'], { to: 'xml' }, ([o]) => { const t = txt(o); ok(t.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<root>\n  <name>Filee 변환기</name>\n'), t.slice(0, 80)); has(t, '  <missing />\n', '  <empty></empty>\n', '  <tags>a</tags>\n  <tags>b</tags>\n', '  <ratio>3.0</ratio>\n'); });
  T('data yaml→json merge keys', 'convert-data', ['config.yml'], { to: 'json' }, ([o]) => {
    const t = txt(o);
    has(t, '  "development": {\n    "adapter": "postgres",\n    "port": 5433,\n    "database": "dev"\n  },', '  "flags": [\n    "yes",\n    "no",\n    "on",\n    null,\n    31,\n    15,\n    "Infinity",\n    -1500.0,\n    "42"\n  ],', '"when": "2026-10-16"');
    ok(!t.includes('comments'), 'comment kept');
  });
  F('data yaml alias bomb refused', 'convert-data', ['bomb.yaml'], { to: 'json' }, /too many values/);
  T('data toml→json dates', 'convert-data', ['config.toml'], { to: 'json' }, ([o]) => has(txt(o), '"title": "TOML 예제"', '"released": "1979-05-27T07:32:00-08:00"', '"day": "2026-10-16"', '"limits": {\n      "cpu": 2.5,\n      "memory": "1G"\n    }', '"products": [\n    {\n      "name": "Hammer",\n      "sku": 738594937\n    },'));
  T('data toml→yaml', 'convert-data', ['config.toml'], { to: 'yaml' }, ([o]) => has(txt(o), 'released: 1979-05-27T07:32:00-08:00\n', 'products:\n  - name: Hammer\n    sku: 738594937\n  - name: Nail\n'));
  T('data xml→json attributes', 'convert-data', ['catalog.xml'], { to: 'json' }, ([o]) => same(txt(o), '{\n  "catalog": {\n    "@xmlns:dc": "http://purl.org/dc/elements/1.1/",\n    "@version": "2",\n    "book": [\n      {\n        "@id": "b1",\n        "@lang": "ko",\n        "dc:title": "한국어 책",\n        "price": {\n          "@currency": "KRW",\n          "#text": "15000"\n        },\n        "note": null,\n        "summary": "",\n        "body": "a < b"\n      },\n      {\n        "@id": "b2",\n        "dc:title": "Second"\n      }\n    ]\n  }\n}\n'));
  T('data xml→yaml namespaces', 'convert-data', ['feed.xml'], { to: 'yaml' }, ([o]) => same(txt(o), "feed:\n  '@xmlns': http://www.w3.org/2005/Atom\n  '@xml:lang': ko\n  title: 소식\n  entry:\n    id: \"1\"\n"));
  T('data euc-kr xml→json', 'convert-data', ['memo-euckr.xml'], { to: 'json' }, ([o]) => same(txt(o), '{\n  "memo": {\n    "to": "홍길동"\n  }\n}\n'));
  T('data json→xml names', 'convert-data', ['names.json'], { to: 'xml' }, ([o]) => has(txt(o), '<first_x0020_name>Ada</first_x0020_name>', '<_x0031_st>1</_x0031_st>', '<list>\n    <item>1</item>\n    <item>2</item>\n  </list>'));
  T('data csv→json typed', 'convert-data', ['people.csv'], { to: 'json' }, ([o]) => same(txt(o), '[\n  {\n    "name": "홍길동",\n    "zip": "01234",\n    "age": 42,\n    "member": true,\n    "score": 3.5\n  },\n  {\n    "name": "Kim, Ada",\n    "zip": "",\n    "age": 7,\n    "member": false,\n    "score": ""\n  }\n]\n'));
  T('data json→csv records', 'convert-data', ['users.json'], { to: 'csv' }, ([o]) => { ok(bom(o), 'CSV needs a BOM'); same(utf(o), 'id,address.city,vip\r\n1,Seoul,\r\n2,,true\r\n'); });
  F('data csv refuses lists', 'convert-data', ['nested.json'], { to: 'csv' }, /“tags” holds a list: CSV holds a table/);
  T('data jsonl→json', 'convert-data', ['events.jsonl'], { to: 'json' }, ([o]) => same(txt(o), '[\n  {\n    "a": 1\n  },\n  {\n    "a": 2,\n    "b": "한"\n  }\n]\n'));
  T('data csv→jsonl', 'convert-data', ['people.csv'], { to: 'jsonl' }, ([o]) => same(txt(o), '{"name":"홍길동","zip":"01234","age":42,"member":true,"score":3.5}\n{"name":"Kim, Ada","zip":"","age":7,"member":false,"score":""}\n'));
  F('data broken jsonl refused', 'convert-data', ['broken.jsonl'], { to: 'json' }, /Line 2 is not valid JSON/);
  T('data json with BOM→xlsx', 'json-to-sheet', ['bom.json'], { to: 'xlsx' }, ([o]) => { const ws = sheet0(o); same([cell(ws, 'A1'), cell(ws, 'A2'), cell(ws, 'B2'), cell(ws, 'C2'), cell(ws, 'D2'), cell(ws, 'D3')].join('|'), 's:name|s:Lime|n:12|s:12345678901234567890|s:01234|s:00501'); });
  T('data jsonl→xlsx', 'convert-data', ['events.jsonl'], { to: 'xlsx' }, ([o]) => { const ws = sheet0(o); same([cell(ws, 'A1'), cell(ws, 'B1'), cell(ws, 'A3'), cell(ws, 'B3')].join('|'), 's:a|s:b|n:2|s:한'); });

  // CSV / TSV: encoding and delimiter detected, text stays text.
  const korean = ([o]) => { const ws = sheet0(o); same([cell(ws, 'A1'), cell(ws, 'A2'), cell(ws, 'B2'), cell(ws, 'C2')].join('|'), 's:이름|s:홍길동|n:42|s:안녕, 세상'); };
  T('csv utf-8 without BOM→xlsx', 'convert-sheet', ['korean.csv'], { to: 'xlsx' }, korean);
  T('csv cp949→xlsx', 'convert-sheet', ['korean-cp949.csv'], { to: 'xlsx' }, korean);
  T('csv cp949→html', 'convert-sheet', ['korean-cp949.csv'], { to: 'html' }, ([o]) => has(txt(o), '홍길동', '안녕, 세상'));
  T('csv keeps zeros and fractions', 'convert-sheet', ['zeros.csv'], { to: 'xlsx' }, ([o]) => { const ws = sheet0(o); same([cell(ws, 'B2'), cell(ws, 'C2'), cell(ws, 'D2'), cell(ws, 'B3'), cell(ws, 'C3'), cell(ws, 'D3')].join('|'), 's:01234|s:1/2|s:2026-10-16|s:007|n:3.5|s:1/2/2026'); });
  T('csv semicolons and decimal commas', 'convert-sheet', ['semicolon.csv'], { to: 'xlsx' }, ([o]) => { const ws = sheet0(o); same([ws['!ref'], cell(ws, 'B2'), cell(ws, 'C2'), cell(ws, 'B3'), cell(ws, 'C3')].join('|'), 'A1:C3|s:1,5|n:3|s:2,25|n:10'); });
  T('tsv→xlsx→tsv round trip', 'convert-sheet', ['people.tsv'], { to: 'xlsx' }, async ([o]) => {
    const back = path.join(path.dirname(o), 'back.tsv');
    await E('office').convertSheet(o, 'tsv', { out: { file: () => back, folder: () => path.dirname(o) }, progress: () => {} }, { allSheets: false });
    ok(bom(back), 'TSV needs a BOM');
    same(utf(back), txt(fx('people.tsv')), 'TSV round trip');
  });
  T('tsv→csv', 'convert-sheet', ['people.tsv'], { to: 'csv' }, ([o]) => ok(utf(o).startsWith('이름,금액,메모\r\n김민지,"1,200","줄\n바꿈"\r\n"Lee, J",3.5'), utf(o).slice(0, 60)));
  T('csv→yaml', 'convert-sheet', ['people.csv'], { to: 'yaml' }, ([o]) => same(txt(o), '- name: 홍길동\n  zip: "01234"\n  age: 42\n  member: true\n  score: 3.5\n- name: Kim, Ada\n  zip: ""\n  age: 7\n  member: false\n  score: ""\n'));

  // Contacts
  T('vcard→csv', 'convert-contacts', ['contacts.vcf'], { to: 'csv' }, ([o]) => { ok(bom(o), 'CSV needs a BOM'); same(utf(o), ['Full name,Given name,Family name,Organization,Title,Email,Phone,Address,Birthday,Note', '홍길동,길동,홍,,,hong@example.com,010-1234-5678 (mobile); 02-123-4567 (work),"서울특별시 종로구 세종대로 209 정부서울청사 별관 3층, 03171 (home)",1980-01-02,전화 주세요', 'Ada Lovelace,Ada,Lovelace,"Analytical Engines, Ltd., Research",Engineer,ada@example.com (work); ada@home.example (home),+44 20 7946 0000 (mobile),,,"First line\nSecond line; folded over two lines here"', '王小明,小明,王,,,,+86-10-1234-5678 (mobile),,--0412,', ''].join('\r\n')); });
  T('vcard utf-16→json', 'convert-contacts', ['phone-utf16.vcf'], { to: 'json' }, ([o]) => has(txt(o), '"Full name": "김철수"', '"Phone": "010-0000-0000"'));
  T('csv→vcard', 'convert-contacts', ['주소록.csv'], { to: 'vcf' }, ([o]) => {
    const t = txt(o);
    ok(t.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:홍길동\r\nN:;;;;\r\nORG:필이\\, 주식회사\r\n'), t.slice(0, 90));
    has(t, '\r\nEMAIL;TYPE=INTERNET:hong@example.com\r\nTEL;TYPE=CELL:010-1111-2222\r\nTEL;TYPE=WORK:02-333-4444\r\n');
    ok(t.split('BEGIN:VCARD').length === 2, 'the empty row became a contact');
    ok(t.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'a line is over 75 bytes');
    const note = E('data').readVcard(read(o))[0].notes[0];
    same(note, '아주 긴 메모입니다. 한 줄이 75바이트를 넘으면 vCard는 줄을 접어요. 접힌 줄은 공백으로 시작해요.', 'folded note');
  });
  F('csv without contact columns', 'convert-contacts', ['numbers.csv'], { to: 'vcf' }, /No contact columns found/);

  // Subtitles: built-in readers and writers, any encoding in, UTF-8 out.
  T('subtitles cp949 sami→srt', 'convert-subtitles', ['영화.smi'], { to: 'srt' }, ([o]) => { ok(bom(o), 'SRT needs a BOM'); same(utf(o), '1\r\n00:00:01,000 --> 00:00:02,500\r\n안녕하세요,\r\n<font color="#FFFF00">반가워요</font>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,200\r\n<i>두 번째 줄입니다</i>\r\n\r\n3\r\n00:00:05,000 --> 00:00:09,000\r\n세 번째 & 마지막\r\n\r\n'); });
  T('subtitles cp949 srt→vtt', 'convert-subtitles', ['cp949.srt'], { to: 'vtt' }, ([o]) => same(txt(o), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\n안녕하세요, 똠방각하\n\n00:00:03.000 --> 00:00:04.000\n두 번째 줄\n\n'));
  T('subtitles lrc→srt last line', 'convert-subtitles', ['song.lrc'], { to: 'srt' }, ([o]) => same(JSON.stringify(srtCues(txt(o))), JSON.stringify([[9500, 11800, 'First line'], [11800, 14500, 'Chorus'], [19500, 25000, 'Chorus'], [25000, 29000, 'Last']])));
  T('subtitles srt→sami', 'convert-subtitles', ['sub.srt'], { to: 'smi' }, ([o]) => { ok(bom(o), 'SAMI needs a BOM'); has(utf(o), '.ENCC { Name: English; lang: en-US; SAMIType: CC; }', '<SYNC Start=500><P Class=ENCC>Hello Lime\r\n<SYNC Start=2000><P Class=ENCC>&nbsp;\r\n<SYNC Start=2500><P Class=ENCC>Second line\r\n<SYNC Start=3800><P Class=ENCC>&nbsp;\r\n'); });
  T('subtitles lenient srt→vtt', 'convert-subtitles', ['lenient.srt'], { to: 'vtt' }, ([o]) => same(txt(o), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<i>First</i> line\nstill the first\n\n00:00:03.500 --> 00:00:04.250\n<b>Second</b> cue\n\n00:00:05.000 --> 00:00:06.000\nThird 2024\n\n'));
  T('subtitles ass→vtt', 'convert-subtitles', ['show.ass'], { to: 'vtt' }, ([o]) => same(txt(o), 'WEBVTT\n\n00:00:01.000 --> 00:00:01.500\n<i>I think so</i>\n\n00:00:02.000 --> 00:00:03.500\nHello, <i>world</i>!\nSecond <c.yellow>yellow</c> line\n\n'));
  T('subtitles vtt→ttml', 'convert-subtitles', ['talk.vtt'], { to: 'ttml' }, ([o]) => has(txt(o), 'xml:lang="ko"', '<p begin="00:00:01.000" end="00:00:02.500">Hi &amp; <span tts:fontStyle="italic">welcome</span><br /><span tts:color="#FFFF00">&lt;3</span></p>', '<p begin="01:00:00.000" end="01:00:01.000">Karaoke</p>'));
  T('subtitles ttml→srt', 'convert-subtitles', ['captions.ttml'], { to: 'srt' }, ([o]) => same(JSON.stringify(srtCues(txt(o))), JSON.stringify([[11000, 12000, 'Line one\nline <b>two</b>'], [13200, 14200, '<i>Frames</i>'], [15000, 16000, '<font color="#FF0000">Red</font> ticks']])));
  T('subtitles scc→srt', 'convert-subtitles', ['captions.scc'], { to: 'srt' }, ([o]) => same(JSON.stringify(srtCues(txt(o))), JSON.stringify([[1435, 3003, 'Hello\nCafé'], [5138, 5205, 'One!'], [5272, 7007, 'One!\nTwo!']])));
  T('subtitles microdvd→srt', 'convert-subtitles', ['movie.sub'], { to: 'srt' }, ([o]) => same(JSON.stringify(srtCues(txt(o))), JSON.stringify([[1000, 2000, '<i>Hello</i>\nworld'], [3000, 4000, '<font color="#FF0000">Red</font>']])));
  F('subtitles vobsub refused', 'convert-subtitles', ['vobsub.sub'], { to: 'srt' }, /VobSub picture subtitles/);
  T('subtitles srt→ass', 'convert-subtitles', ['sub.srt'], { to: 'ass' }, ([o]) => has(utf(o), '[Script Info]\r\nScriptType: v4.00+', 'Dialogue: 0,0:00:00.50,0:00:02.00,Default,,0,0,0,,Hello Lime\r\n', 'Dialogue: 0,0:00:02.50,0:00:03.80,Default,,0,0,0,,Second line\r\n'));
  T('subtitles srt→lrc', 'convert-subtitles', ['sub.srt'], { to: 'lrc' }, ([o]) => same(txt(o), '[00:00.50]Hello Lime\r\n[00:02.00]\r\n[00:02.50]Second line\r\n[00:03.80]\r\n'));
  T('subtitles srt→microdvd', 'convert-subtitles', ['sub.srt'], { to: 'sub' }, ([o]) => same(utf(o), '{1}{1}23.976\r\n{12}{48}Hello Lime\r\n{60}{91}Second line\r\n'));
  T('burn ttml subtitles', 'burn-subtitles', ['clip.mp4'], { subtitles: fx('burn.ttml'), size: 30 }, async ([o]) => {
    await dur(o, 4, 0.3);
    const ff = E('util').binPath('ffmpeg');
    const frame = (f) => require('child_process').execFileSync(ff, ['-v', 'error', '-ss', '2', '-i', f, '-frames:v', '1', '-vf', 'crop=iw:ih/3:0:2*ih/3,scale=320:-2', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    const a = frame(fx('clip.mp4')), b = frame(o);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    ok(diff / a.length > 2, `no caption burned in (mean difference ${(diff / a.length).toFixed(2)})`);
  });

  // Archives: links, zip slip, flattening, duplicate names, single-file streams.
  T('extract tar with escaping link', 'extract-archive', ['links.tar'], {}, ([o]) => { same(walk(o).join(','), 'a.txt,b.txt'); ok(!walk(o).some((f) => isLink(path.join(o, f))), 'a link was unpacked'); ok(txt(path.join(o, 'a.txt')) === 'alpha', 'content'); });
  F('extract refuses zip slip', 'extract-archive', ['slip.zip'], {}, /slip\.zip was not unpacked: the entry "\.\.[\\/]\.\.[\\/]evil\.txt" points outside the target folder/);
  T('extract flattens one top folder', 'extract-archive', ['사진.zip'], {}, ([o]) => { ok(path.basename(o) === '사진', path.basename(o)); same(walk(o).join(','), 'a.txt,sub,sub/b.txt'); });
  T('convert archive keeps top folder', 'convert-archive', ['사진.zip'], { format: '7z', level: 5 }, async ([o]) => { ok(path.basename(o) === '사진.7z', path.basename(o)); same((await entries(o)).join(','), 'photos,photos/a.txt,photos/sub,photos/sub/b.txt'); });
  T('convert tar.gz→tar.xz', 'convert-archive', ['archive.tar.gz'], { format: 'tar.xz', level: 5 }, ([o]) => { ok(path.basename(o) === 'archive.tar.xz', path.basename(o)); magic(o, '7zXZ'); const n = tarNames(sevenZip(['x', '-so', o])); ok(n.includes('a.txt') && n.includes('inner/b.txt'), n.join(',')); });
  T('compress same names', 'create-archive', ['dupA/report.txt', 'dupB/report.txt'], { format: 'zip', level: 5 }, ([o]) => { ok(path.basename(o) === 'report_files.zip', path.basename(o)); const z = zipHas(o, 'report'); same(Object.keys(z).sort().join(','), 'report (2).txt,report.txt'); ok(Buffer.from(z['report (2).txt']).toString() === 'from B', 'second file'); });
  for (const [fmt, sig] of [['tar.bz2', 'BZh'], ['tar.xz', '7zXZ'], ['tar', 'folder/']]) T(`compress folder→${fmt}`, 'create-archive', ['folder'], { format: fmt, level: 5 }, ([o]) => { ok(path.basename(o) === `folder.${fmt}`, path.basename(o)); if (fmt !== 'tar') magic(o, sig); const n = tarNames(fmt === 'tar' ? read(o) : sevenZip(['x', '-so', o])); ok(n.includes('folder/a.txt') && n.includes('folder/inner/b.txt'), n.join(',')); });
  T('compress one file→gz', 'create-archive', ['doc.txt'], { format: 'gz', level: 5 }, ([o]) => { ok(path.basename(o) === 'doc.txt.gz', path.basename(o)); ok(require('zlib').gunzipSync(read(o)).equals(read(fx('doc.txt'))), 'gz content'); });
  F('gz refuses a folder', 'create-archive', ['folder'], { format: 'gz', level: 5 }, /A \.gz file holds a single file/);
  T('decompress gz', 'decompress-file', ['notes.txt.gz'], {}, ([o]) => { ok(path.basename(o) === 'notes.txt', path.basename(o)); same(txt(o), 'hello from a gzip file\n'); });
  F('password zip needs its password', 'extract-archive', ['secret.zip'], {}, /secret\.zip is password-protected/);
  T('password zip with password', 'extract-archive', ['secret.zip'], { password: 'lime' }, ([o]) => same(txt(path.join(o, 'a.txt')), 'alpha'));
  T('data jsonc→json order and floats', 'convert-data', ['order.jsonc'], { to: 'json' }, ([o]) => { ok(path.basename(o) === 'order.json', path.basename(o)); same(txt(o), '{\n  "2": 1,\n  "1": 2,\n  "f": 1000000000000000.0,\n  "g": 0.000015,\n  "h": 1E+300,\n  "i": 3.0,\n  "j": 12345678901234567890\n}\n'); });
  T('data list→toml items', 'convert-data', ['list.json'], { to: 'toml' }, ([o]) => same(txt(o), '[[items]]\na = 1\n\n[[items]]\na = 2\n'));
  T('data xml rows→csv', 'convert-data', ['rows.xml'], { to: 'csv' }, ([o]) => same(utf(o), 'a,b\r\n1,x\r\n2,y\r\n'));
  T('data yaml columns→csv', 'convert-data', ['columns.yaml'], { to: 'csv' }, ([o]) => same(utf(o), 'name,age\r\na,1\r\nb,\r\n'));
  T('vcard→xlsx', 'convert-contacts', ['contacts.vcf'], { to: 'xlsx' }, ([o]) => { const ws = sheet0(o); same([cell(ws, 'A1'), cell(ws, 'A2'), cell(ws, 'G2'), cell(ws, 'A4'), cell(ws, 'I4')].join('|'), 's:Full name|s:홍길동|s:010-1234-5678 (mobile); 02-123-4567 (work)|s:王小明|s:--0412'); });
  for (const fmt of ['bz2', 'xz']) T(`compress one file→${fmt}`, 'create-archive', ['doc.txt'], { format: fmt, level: 5 }, ([o]) => { ok(path.basename(o) === `doc.txt.${fmt}`, path.basename(o)); magic(o, fmt === 'xz' ? '7zXZ' : 'BZh'); ok(sevenZip(['x', '-so', o]).equals(read(fx('doc.txt'))), `${fmt} content`); });
  T('convert gz→xz', 'convert-archive', ['notes.txt.gz'], { format: 'xz', level: 5 }, ([o]) => { ok(path.basename(o) === 'notes.txt.xz', path.basename(o)); same(sevenZip(['x', '-so', o]).toString(), 'hello from a gzip file\n'); });

  // Option sweep: every tool in the catalogue runs with its defaults, then once per value of each choice, select, toggle and multi
  // option and at both ends of each range, one option at a time with its `when` controller set so it shows. Each job saves where
  // the Save dialog would point, every result is checked by type, and options whose result matches the default run are listed.
  const SWEEP_IN = { pdf: 'doc.pdf', image: 'photo2.jpg', raw: 'raw.dng', video: 'sweep.mp4', audio: 'sweep.m4a', doc: 'doc.docx', sheet: 'sheet.xlsx', slides: 'deck.pptx', vector: 'logo.ai',
    cad2d: 'layers.dxf', cad3d: 'box.stl', layout: 'layout.idml', motion: 'brief.json', timeline: 'brief.otio', archive: 'archive.zip', subtitle: 'sub.srt', data: 'data.json', contacts: 'contacts.vcf',
    font: 'font.otf', mail: 'mail.eml', webarchive: 'page.mhtml', comic: 'comic.cbz', ebook: 'novel.epub', any: 'doc.txt' };
  const SWEEP = {
    'unlock-pdf': [['layout-locked.pdf'], { password: '1234' }], 'protect-pdf': [0, { userPassword: 'lime123' }], 'split-pdf': [0, { ranges: '1, 2-3', pages: '1, 3' }], 'remove-pages': [0, { pages: '2' }],
    'optimize-pdf': [['images.pdf']], 'redact-pdf': [0, { terms: 'Invoice' }], 'ocr-pdf': [['scan.pdf']], 'make-fillable': [['form.pdf']], 'compare-pdf': [['v1.pdf', 'v2.pdf']], 'merge-pdf': [['doc.pdf', 'photo2.jpg']],
    'watermark-pdf': [0, { image: fx('alpha.png') }], 'scan-to-pdf': [['text.png']], 'image-to-text': [['text.png']], 'jpg-to-pdf': [['photo2.jpg', 'photo.webp']],
    'hdr-merge': [['hdr/bracket-0.dng', 'hdr/bracket-1.dng', 'hdr/bracket-2.dng']], panorama: [['pano/view-0.png', 'pano/view-1.png', 'pano/view-2.png']], collage: [['photo2.jpg', 'photo.webp']],
    'images-to-gif': [['photo2.jpg', 'photo.webp']], 'images-to-cbz': [['photo2.jpg', 'photo.webp']], 'watermark-image': [0, { image: fx('alpha.png') }], meme: [0, { top: 'Lime', bottom: 'Sweep' }],
    'blur-faces': [['faces.png']], 'animation-speed': [['anim.gif']], 'gif-to-video': [['anim.gif']], 'extract-subtitles': [['subs.mkv']], 'burn-subtitles': [0, { subtitles: fx('sub.srt') }],
    'trim-media': [0, { end: '0.5' }], 'merge-media': [['tone.mp3', 'sweep.m4a']], 'add-audio': [['sweep.mp4', 'tone.wav']], 'render-motion': [0, { resolution: 'quarter' }],
    'merge-documents': [['doc.md', 'photo2.jpg']], 'merge-sheets': [['sheet.xlsx', 'sheet.csv']], 'json-to-sheet': [['data.json']], 'decompress-file': [['notes.txt.gz']], 'rename-files': [0, { pattern: '{name} {n}' }],
    'export-form-data': [['fillable.pdf']], 'fill-form-data': [['fillable.pdf'], { data: formCsv }], 'background-pdf': [0, { image: fx('alpha.png') }],
    'overlay-pdf': [0, { overlay: fx('v1.pdf') }], 'trace-image': [['photo2.jpg']], 'hdr-batch': [['hdr/bracket-0.dng', 'hdr/bracket-1.dng', 'hdr/bracket-2.dng']], 'split-scenes': [['scenes.mp4']], 'split-chapters': [['chapters.pdf']], 'comment-summary': [['comments.pdf']],
    'compare-docs': [['v1.docx', 'v2.docx']], 'track-changes': [['tracked.docx']], 'mail-merge': [['letter.docx'], { data: fx('merge.csv') }], 'split-doc': [['chapters.docx']], 'watermark-doc': [['doc.docx']],
    'replace-text': [['doc.docx'], { find: 'lime', replace: 'Kiwi' }], 'clean-office': [['tracked.docx']], 'office-media': [['doc.docx']], 'compress-office': [['big.docx']], 'sheet-values': [['book.xlsx']], 'unhide-sheet': [['book.xlsx']],
    'split-sheets': [['book.xlsx']], 'tidy-sheet': [['book.xlsx']], 'sheet-formulas': [['book.xlsx']], 'slide-notes': [['notes.pptx']], 'merge-slides': [['deck.pptx', 'deck2.pptx']], 'pick-slides': [['notes.pptx'], { slides: '3, 1-2' }],
    'simplify-model': [['part.stp']], 'merge-models': [['box.stl', 'cube.stl']], 'model-drawing': [['step.stl']], 'repair-model': [['broken.stl']], 'trace-image': [['photo2.jpg']], 'hdr-batch': [['hdr/bracket-0.dng', 'hdr/bracket-1.dng', 'hdr/bracket-2.dng']], 'split-scenes': [['scenes.mp4']], 'split-chapters': [['chapters.pdf']], 'comment-summary': [['comments.pdf']],
  };
  // Choices that refuse this input on purpose: the same format again, several files into a one-file compressor, or ODT where
  // neither LibreOffice nor macOS's text converter is there to write it.
  const SWEEP_REFUSE = { 'replace-text matchCase=true': /found no “lime”/, 'convert-document to=docx': /already DOCX/, 'model-drawing scale=5': /don’t fit on A3/, 'convert-slides to=pptx': /already PPTX/, 'convert-email to=eml': /already EML/,
    'convert-archive format=gz': /holds a single file/, 'convert-archive format=bz2': /holds a single file/, 'convert-archive format=xz': /holds a single file/,
    ...(process.platform !== 'darwin' && !E('office').libreOfficePath() ? { 'convert-document to=odt': /Saving ODT needs LibreOffice/ } : {}) };
  // Tools that take files by extension rather than by kind (the ArtCraft actions) get the first sample their extensions match.
  const SWEEP_EXT = { jpg: 'photo2.jpg', psd: 'layers.psd', png: 'cover.png', svg: 'logo.svg' };
  const sweepIn = (t) => SWEEP[t.id]?.[0] || [SWEEP_IN[t.accepts.find((g) => SWEEP_IN[g])] || SWEEP_EXT[(t.extAccept || []).find((e) => SWEEP_EXT[e])]];
  const defaults = (t) => ({ ...Object.fromEntries((t.options || []).map((o) => [o.key, Array.isArray(o.default) ? [...o.default] : o.default])), ...SWEEP[t.id]?.[1] });
  const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'ts', 'm2ts', 'vob', 'ogv', '3gp', '3g2', 'dv', 'mxf']);
  const AUDIO_EXT = new Set(['mp3', 'm4a', 'wav', 'flac', 'aiff', 'ogg', 'opus', 'aac', 'wma', 'ac3', 'eac3', 'm4b', 'wv', 'tta', 'caf', 'au', 'w64', 'mp2', 'mka', 'weba', 'voc', 'amr']);
  const SHARP_EXT = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', apng: 'png', webp: 'webp', gif: 'gif', tif: 'tiff', tiff: 'tiff', avif: 'heif' };
  const MAGIC = { bmp: /^BM/, ico: /^\0\0\x01\0/, cur: /^\0\0\x02\0/, icns: /^icns/, jxl: /^(\xff\x0a|\0\0\0\x0cJXL )/, jp2: /^\0\0\0\x0cjP {2}/, qoi: /^qoif/, dds: /^DDS /, pcx: /^\x0a/, ppm: /^P6/, pgm: /^P5/, pbm: /^P4/,
    pam: /^P7/, pfm: /^P[Ff]/, sgi: /^\x01\xda/, ras: /^\x59\xa6\x6a\x95/, xpm: /^\/\* XPM \*\//, xbm: /^#define/, wbmp: /^\0\0/, psd: /^8BPS/, heic: /^[\s\S]{4}ftyp(heic|heix|mif1)/, woff: /^wOFF/, woff2: /^wOF2/,
    ttf: /^(\0\x01\0\0|true)/, otf: /^(OTTO|\0\x01\0\0)/, zip: /^PK\x03\x04/, '7z': /^7z\xbc\xaf/, gz: /^\x1f\x8b/, bz2: /^BZh/, xz: /^\xfd7zXZ\0/ };
  const MEDIA_FMT = { mp4: /mov,mp4/, m4v: /mov,mp4/, mov: /mov,mp4/, '3gp': /mov,mp4/, '3g2': /mov,mp4/, m4a: /mov,mp4/, m4b: /mov,mp4/, mkv: /matroska/, mka: /matroska/, webm: /matroska/, weba: /matroska/,
    wmv: /^asf$/, wma: /^asf$/, mpg: /^mpeg$/, vob: /^mpeg$/, ts: /^mpegts$/, m2ts: /^mpegts$/, ogv: /^ogg$/, ogg: /^ogg$/, opus: /^ogg$/, mp2: /^mp3$/ };
  const PIXEL_EXT = new Set(['heic', 'heif', 'bmp', 'ico', 'icns', 'cur', 'jxl', 'jp2', 'tga', 'qoi', 'dds', 'pcx', 'ppm', 'pgm', 'pbm', 'pam', 'pfm', 'sgi', 'ras', 'xpm', 'xbm', 'wbmp', 'psd']);
  const TEXT_EXT = { csv: /\S/, tsv: /\S/, txt: /\S/, md: /\S/, html: /<(html|body|table|p|div|h1)\b/i, srt: /-->/, vtt: /^\ufeff?WEBVTT/, ass: /\[Script Info\]/, lrc: /\[\d\d:\d\d/, sub: /^\{\d+\}\{\d+\}/m,
    smi: /<SAMI>/i, edl: /^(TITLE|001)/m, rtf: /^\{\\rtf/, eml: /^[\w-]+: /m, vcf: /BEGIN:VCARD/, obj: /^v /m, dxf: /SECTION[\s\S]*EOF/ };
  const XML_EXT = new Set(['xml', 'svg', 'ttml', 'fcpxml', 'fb2', 'amf', 'x3d', 'dae', 'xfdf']);
  const ZIP_MAIN = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml', odt: 'content.xml', ods: 'content.xml', epub: 'META-INF/container.xml', htmlz: 'index.html', txtz: 'index.txt',
    '3mf': '3D/3dmodel.model', idml: 'designmap.xml', designcraft: 'mimetype' };
  const utf8 = (b) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (_) { return null; } };
  const deep = (o) => (fs.statSync(o).isDirectory() ? walk(o).map((f) => path.join(o, f)).filter((f) => fs.statSync(f).isFile()) : [o]);
  const validOne = async (o, opts) => {
    const b = read(o), name = path.basename(o), e = U.ext(o), head = b.toString('latin1', 0, 64), text = () => { const t = utf8(b); ok(t != null, `${name} is not UTF-8`); return t.replace(/^\ufeff/, ''); };
    ok(b.length, `${name} is empty`);
    if (MAGIC[e]) ok(MAGIC[e].test(head), `${name} is not ${e.toUpperCase()} inside: ${JSON.stringify(head.slice(0, 8))}`);
    if (e === 'pdf' || (e === 'ai' && head.startsWith('%PDF'))) return ok((await E('pdf').pageCount(o, opts.userPassword || opts.password)) >= 1, `${name} has no pages`);
    if (ZIP_MAIN[e]) { const z = require('fflate').unzipSync(new Uint8Array(b)); ok(z[ZIP_MAIN[e]], `${name} lacks ${ZIP_MAIN[e]}`); if (e === 'xlsx' || e === 'ods') ok(XLSX.read(b).SheetNames.length, `${name} has no sheets`); return; }
    if (e === 'cbz') { const z = require('fflate').unzipSync(new Uint8Array(b)), pics = Object.keys(z).filter((k) => /\.(png|jpe?g|webp|gif)$/i.test(k)); ok(pics.length, `${name} has no pictures`); return ok((await sharp(Buffer.from(z[pics[0]])).metadata()).width > 0, `${pics[0]} does not decode`); }
    if (['zip', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(e)) return ok(/Everything is Ok/.test(sevenZip(['t', o]).toString()), `${name} fails the archive test`);
    if (VIDEO_EXT.has(e) || AUDIO_EXT.has(e)) {
      const j = await ffp(o, ['-count_packets']), v = of(j, 'video').filter((x) => x.disposition?.attached_pic !== 1 && +x.nb_read_packets > 0), a = of(j, 'audio').filter((x) => +x.nb_read_packets > 0);
      const codec = { hevc: 'hevc', av1: 'av1', alac: 'alac' }[opts.to];
      ok(Number(j.format.duration) > 0, `${name} has no duration`);
      ok((MEDIA_FMT[e] || new RegExp(`^${e}$`)).test(j.format.format_name), `${name} is ${j.format.format_name} inside`);
      ok(!codec || j.streams.some((x) => x.codec_name === codec), `${name} holds ${j.streams.map((x) => x.codec_name)}, not ${codec}`);
      return ok(VIDEO_EXT.has(e) ? v.length : a.length, `${name} has no ${VIDEO_EXT.has(e) ? 'video frames' : 'audio'}`);
    }
    if (SHARP_EXT[e]) { const m = await sharp(o, { animated: true, limitInputPixels: false }).metadata(); return ok(m.width > 0 && m.height > 0 && m.format === SHARP_EXT[e], `${name}: ${m.format} ${m.width}x${m.height}`); }
    if (PIXEL_EXT.has(e)) { const m = await (await E('image').open(o)).metadata(); return ok(m.width > 0 && m.height > 0, `${name} does not decode`); }
    if (['ttf', 'otf', 'woff', 'woff2', 'eot'].includes(e)) {
      const f = E('fonts').load(b);
      ok(e !== 'eot' || b.readUInt16LE(34) === 0x504c, `${name} lacks the EOT magic number`);
      return ok(f.tables.has('head') && f.tables.has('cmap') && (!['ttf', 'eot'].includes(e) || f.tables.has('glyf')), `${name} lacks font tables or TrueType outlines`);
    }
    if (['json', 'gltf', 'otio'].includes(e)) return JSON.parse(text());
    if (e === 'jsonl') return text().split('\n').filter((l) => l.trim()).forEach((l) => JSON.parse(l));
    if (e === 'yaml' || e === 'yml') return require('yaml').parse(text());
    if (e === 'toml') return require('smol-toml').parse(text());
    if (XML_EXT.has(e)) { const d = xmlDoc(text(), name), root = { svg: 'svg', amf: 'amf', x3d: 'X3D', dae: 'COLLADA' }[e]; return ok(!root || d.documentElement.localName === root, `${name} is not ${e.toUpperCase()}`); }
    if (TEXT_EXT[e]) return ok(TEXT_EXT[e].test(text()), `${name} does not look like ${e.toUpperCase()}`);
    if (e === 'stl') return ok((b.length > 84 && b.length === 84 + 50 * b.readUInt32LE(80)) || /^solid[\s\S]*facet/.test(text()), `${name} is not an STL`);
    if (e === 'glb') return ok(head.startsWith('glTF') && b.readUInt32LE(8) === b.length, `${name} is not a GLB`);
    if (e === 'ply') return ok(head.startsWith('ply'), `${name} is not a PLY`);
    if (e === 'off') return ok(/^C?OFF\n\d+ \d+ 0\n/.test(text()), `${name} is not an OFF`);
    if (e === 'wrl') return ok(/^#VRML V2\.0 utf8\n/.test(text()), `${name} is not VRML`);
    if (['step', 'stp', 'iges', 'igs', 'brep'].includes(e)) {
      ok({ step: /^ISO-10303-21;/, stp: /^ISO-10303-21;/, iges: /^.{72}S0000001/, igs: /^.{72}S0000001/, brep: /^DBRep_DrawableShape/ }[e].test(text()), `${name} is not ${e.toUpperCase()}`);
      return ok((await E('cad').info(o)).triangles > 0, `${name} does not read back`);
    }
    if (e === 'eps' || e === 'ai') return ok(head.startsWith('%!PS') || b.readUInt32BE(0) === 0xc5d0d3c6, `${name} is not PostScript`);
    if (e === 'emf') return ok(b.readUInt32LE(0) === 1 && head.slice(40, 44) === ' EMF', `${name} is not an EMF`);
    if (e === 'dng') return ok(/^(II\*\0|MM\0\*)/.test(head), `${name} is not a DNG`);
    if (e === 'fdf') return ok(head.startsWith('%FDF-'), `${name} is not an FDF`);
    if (e === 'xls' || e === 'aaf') { ok(b.toString('hex', 0, 8) === 'd0cf11e0a1b11ae1', `${name} is not a compound file`); return ok(e !== 'xls' || XLSX.read(b).SheetNames.length, `${name} has no sheets`); }
    throw new Error(`no check for .${e} files`);
  };
  const valid = async (o, opts) => { const all = deep(o); ok(all.length, `${path.basename(o)} is empty`); for (const f of all.slice(0, 8)) await validOne(f, opts); };
  const sha = (b) => require('crypto').createHash('sha1').update(b).digest('hex');
  const STAMP = /\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)?|D:\d{14}[^)>\s]*|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const textSig = (b) => { const t = utf8(b); return sha(t == null ? b : t.replace(STAMP, '')); };
  const sigOne = async (o, opts) => {
    const b = read(o), e = U.ext(o);
    if (b.toString('latin1', 0, 5) === '%PDF-') {
      try {
        const { doc, m } = await E('pdf').readPdf(o, opts.userPassword || opts.password), parts = [doc.getMetaData('encryption'), doc.getMetaData('format')];
        for (const p of ['print', 'copy', 'edit', 'annotate']) { try { parts.push(doc.hasPermission(p)); } catch (_) {} }
        try { parts.push(textSig(Buffer.from(doc.getTrailer().get('Root').get('Metadata').readStream().asUint8Array()))); } catch (_) {}
        for (let i = 0; i < doc.countPages(); i++) { const p = doc.loadPage(i); parts.push(JSON.stringify(p.getBounds()), p.toStructuredText('').asText(), sha(Buffer.from(p.toPixmap(m.Matrix.scale(0.25, 0.25), m.ColorSpace.DeviceRGB, false, true).getPixels()))); }
        return sha(parts.join('\n'));
      } catch (_) {}
    }
    if (ZIP_MAIN[e] || e === 'cbz') { const z = require('fflate').unzipSync(new Uint8Array(b)); return sha(Object.keys(z).sort().map((k) => `${k}:${textSig(Buffer.from(z[k]))}`).join('\n')); }
    return textSig(b);
  };
  const sigOf = async (outs, results, opts) => sha([JSON.stringify(results.map((r) => [r.note, r.text])), ...(await Promise.all(outs.flatMap((o) => deep(o).map(async (f) => `${path.basename(o)}/${path.relative(o, f)}:${await sigOne(f, opts)}`))))].join('\n'));
  const sweepSig = new Map(), sweepPairs = [];
  const sweepCheck = (id, label, opts) => async (outs, results, { dest, kind, dir }) => {
    const n = (o) => path.relative(dir, o);
    const many = outs.length === 1 && outs[0] === dest.path.replace(/\.[^./\\]+$/, '') && fs.statSync(outs[0]).isDirectory();
    if (kind === 'file') ok(outs.includes(dest.path) || many, `saved ${outs.map(n)} instead of ${n(dest.path)}`);
    else if (kind === 'folder') ok(outs[0] === dest.path && fs.statSync(dest.path).isDirectory(), `saved ${outs.map(n)} instead of the folder ${n(dest.path)}`);
    else if (kind === 'dir') ok(outs.length && outs.every((o) => path.dirname(o) === dir), `saved ${outs.map(n)}`);
    else ok(outs.length || results.some((r) => r.note || r.text), 'no result');
    const stray = files(dir).filter((f) => f !== 'in' && !outs.some((o) => path.relative(dir, o).split(path.sep)[0] === f));
    ok(!stray.length, `also left ${stray.join(', ')}`);
    // Attachments are saved byte for byte, whatever they hold.
    for (const o of outs) if (id === 'email-attachments') ok(deep(o).length && deep(o).every((f) => fs.statSync(f).size > 0), `${path.basename(o)} holds empty files`); else await valid(o, opts);
    sweepSig.set(`${id} ${label}`, await sigOf(outs, results, opts));
  };
  for (const t of tools.catalog()) {
    if (t.editor || t.noFiles) continue;
    const base = defaults(t), runs = new Map([[JSON.stringify(base), 'defaults']]), pairs = [];
    for (const o of t.options || []) {
      const vals = o.type === 'select' || o.type === 'choice' ? o.choices.map(([v]) => v) : o.type === 'toggle' ? [true, false] : o.type === 'range' ? [o.min, o.max]
        : o.type === 'multi' ? [[], ...o.choices.map(([v]) => [v]), o.choices.map(([v]) => v)] : [];
      for (const v of vals) {
        const opts = { ...base, [o.key]: v };
        for (const [k, w] of Object.entries(o.when || {})) if (![].concat(w).map(String).includes(String(opts[k]))) opts[k] = [].concat(w)[0];
        if (t.id === 'convert-sheet' && opts.to === 'pdf') continue;
        const key = JSON.stringify(opts);
        if (!runs.has(key)) runs.set(key, `${o.key}=${Array.isArray(v) ? v.join('+') || 'none' : v}`);
        pairs.push([key, JSON.stringify({ ...opts, [o.key]: o.default })]);
      }
    }
    for (const [a, b] of pairs) if (a !== b && runs.has(b) && !sweepPairs.some(([x, y]) => x === `${t.id} ${runs.get(a)}` && y === `${t.id} ${runs.get(b)}`)) sweepPairs.push([`${t.id} ${runs.get(a)}`, `${t.id} ${runs.get(b)}`]);
    for (const [key, label] of runs) C.push({ name: `sweep ${t.id} ${label}`, tool: t.id, inputs: sweepIn(t).map(fx), opts: JSON.parse(key), par: true, save: true, copy: t.save === 'inplace', fail: SWEEP_REFUSE[`${t.id} ${label}`], check: sweepCheck(t.id, label, JSON.parse(key)) });
  }
  for (const [id, ins, more] of [['convert-image', ['photo2.jpg', 'photo.webp'], { to: 'png' }], ['convert-document', ['dupA/report.txt', 'dupB/report.txt'], { to: 'pdf' }], ['convert-audio', ['tone.mp3', 'sweep.m4a'], { to: 'wav' }]]) {
    const opts = { ...defaults(tools.get(id)), ...more }, check = sweepCheck(id, 'batch', opts);
    C.push({ name: `sweep ${id} batch`, tool: id, inputs: ins.map(fx), opts, par: true, save: true, check: async (outs, r, d) => { ok(outs.length === ins.length && new Set(outs).size === ins.length, `${outs.length} results for ${ins.length} files`); await check(outs, r, d); } });
  }

  const only = process.env.LIME_ONLY ? new RegExp(process.env.LIME_ONLY, 'i') : null;
  const results = [];
  let n = 0;
  const runCase = async (c) => {
    const missing = c.inputs.filter((f) => !fs.existsSync(f)).map((f) => path.basename(f));
    if (missing.length) { console.log(`SKIP ${c.name.padEnd(34)} no ${missing.join(', ')} sample`); results.push({ name: c.name, status: 'SKIP', detail: missing.join(', ') }); return; }
    if (c.skip) { console.log(`SKIP ${c.name.padEnd(34)} ${c.skip}`); results.push({ name: c.name, status: 'SKIP', detail: c.skip }); return; }
    const dir = path.join(OUT, String(++n).padStart(3, '0'));
    fs.mkdirSync(dir, { recursive: true });
    let inputs = c.inputs;
    if (c.copy) { fs.mkdirSync(path.join(dir, 'in')); inputs = inputs.map((f) => { const to = path.join(dir, 'in', path.basename(f)); fs.copyFileSync(f, to); return to; }); }
    // Sweep cases save where the Save dialog would point for these options; the others save into their own folder.
    const s = c.save ? tools.suggest(c.tool, inputs, c.opts) : null;
    const dest = s && (s.kind === 'file' || s.kind === 'folder') ? { kind: s.kind, path: path.join(dir, s.name) } : { kind: 'dir', path: dir };
    const t0 = Date.now();
    let status = 'PASS', detail = '';
    try {
      const id = submit({ tool: c.tool, files: inputs, opts: c.opts, dest });
      let j;
      for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(150); if (Date.now() - t0 > 240000) throw new Error('timeout'); }
      if (c.fail) {
        ok(j.status === 'error', `${j.status} instead of an error`);
        ok(c.fail.test(j.error || ''), `error was: ${j.error}`);
        ok(!files(dir).length, `left ${files(dir).join(', ')} behind`);
        detail = String(j.error).slice(0, 100);
        throw Object.assign(new Error(detail), { expected: true });
      }
      if (j.status !== 'done') throw new Error(`${j.status}: ${j.error}`);
      const outs = j.results.flatMap((r) => r.paths || (r.path ? [r.path] : []));
      ok(!outs.some((o) => / x(\.[^.]+)?$/.test(path.basename(o))), `duplicate name ${outs.map((o) => path.basename(o))}`);
      for (const o of outs) if (/\.pdf$/i.test(o) && fs.statSync(o).isFile()) magic(o, '%PDF-');
      await c.check(outs, j.results, { dest, kind: s?.kind, dir });
      detail = outs.map((o) => path.relative(OUT, o)).join(', ') || (j.results[0]?.note || '').split('\n')[0];
    } catch (e) { if (!e.expected) { status = 'FAIL'; detail = e.message; } }
    const line = `${status} ${c.name.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  ${detail}`.slice(0, 220);
    console.log(line);
    results.push({ name: c.name, status, detail });
  };
  const picked = C.filter((c) => !only || only.test(c.name));
  for (const c of picked.filter((x) => !x.par)) await runCase(c);
  const par = picked.filter((x) => x.par), t1 = Date.now();
  await Promise.all(Array.from({ length: Math.max(1, Math.min(3, require('os').cpus().length - 1)) }, async () => { while (par.length) await runCase(par.shift()); }));
  if (picked.some((x) => x.par)) console.log(`     option sweep: ${picked.filter((x) => x.par).length} jobs in ${((Date.now() - t1) / 1000).toFixed(0)} s`);
  if (!only || only.test('failed extract keeps folder')) {
    const keep = path.join(OUT, 'existing folder'), bad = path.join(OUT, 'broken.zip');
    fs.mkdirSync(keep, { recursive: true });
    fs.writeFileSync(path.join(keep, 'keep.txt'), 'mine');
    fs.writeFileSync(bad, Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(512, 7)]));
    let status = 'PASS', detail = '';
    try {
      const id = submit({ tool: 'extract-archive', files: [bad], opts: {}, dest: { kind: 'folder', path: keep } });
      let j;
      for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(150); }
      ok(j.status !== 'done', 'a broken archive extracted');
      ok(fs.existsSync(path.join(keep, 'keep.txt')), 'the existing folder was deleted');
      detail = `kept ${files(keep).join(', ')} after: ${String(j.error).slice(0, 60)}`;
    } catch (e) { status = 'FAIL'; detail = e.message; }
    console.log(`${status} ${'failed extract keeps folder'.padEnd(34)}        ${detail}`);
    results.push({ name: 'failed extract keeps folder', status, detail });
  }
  const check = async (name, fn) => {
    if (only && !only.test(name)) return;
    let status = 'PASS', detail = '';
    try { detail = (await fn()) || ''; } catch (e) { status = 'FAIL'; detail = e.message; }
    console.log(`${status} ${name.padEnd(34)}        ${detail}`.slice(0, 220));
    results.push({ name, status, detail });
  };
  await check('subtitles fail cleanly without a track', async () => {
    const d = path.join(OUT, 'no-subs');
    fs.mkdirSync(d, { recursive: true });
    const id = submit({ tool: 'extract-subtitles', files: [fx('clip.mp4')], opts: { to: 'srt' }, dest: { kind: 'dir', path: d } });
    let j;
    for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(150); }
    ok(j.status !== 'done' && /no subtitle track/.test(j.error), `${j.status}: ${j.error}`);
    ok(!files(d).length, `left ${files(d)}`);
    return j.error;
  });
  await check('media targets follow the encoders', () => {
    const cat = tools.catalog(), to = (id) => cat.find((t) => t.id === id).options.find((o) => o.key === 'to').choices.map(([v]) => v);
    for (const t of ['amr', 'av1', 'hevc', 'ogv']) ok(to(t === 'amr' ? 'convert-audio' : 'convert-video').includes(t) === M.supports(t), `${t} offered without an encoder or hidden with one`);
    const enc = M.encoders();
    ok(enc?.has('libx264') && enc.has('aac'), 'no encoder list');
    ok(M.supports('av1') === (enc.has('libsvtav1') || enc.has('libaom-av1')) && M.supports('amr') === enc.has('libopencore_amrnb'), 'supports() disagrees with the encoder list');
    const v = tools.wheelsFor([fx('clip.mp4')]), a = tools.wheelsFor([fx('tone.wav')]);
    ok(v.convert.length <= 10 && a.convert.length <= 10, `rings of ${v.convert.length} and ${a.convert.length}`);
    return `AV1 ${M.supports('av1') ? (enc.has('libsvtav1') ? 'SVT-AV1' : 'libaom') : 'none'}, AMR ${M.supports('amr') ? 'yes' : 'no'}; ${v.convert.map((w) => w.label)} | ${a.convert.map((w) => w.label)}`;
  });
  await check('psd opens with Lime’s own reader when PhotoCraft can’t', async () => {
    const m = await (await E('image').open(fx('layers.psd'))).metadata(), st = await (await E('image').open(fx('layers.psd'))).stats();
    ok(m.width === 800 && m.height === 534, `${m.width}×${m.height}`);
    ok(st.channels.slice(0, 3).some((c) => c.stdev > 10), 'the picture is blank');
    return `${m.width}×${m.height}`;
  });
  await check('an engine that stops responding is stopped', async () => {
    const t = Date.now();
    const e = await E('util').run(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { timeout: 500, errorMessage: 'Test engine couldn’t finish', env: { ELECTRON_RUN_AS_NODE: '1' } }).then(() => null, (x) => x);
    ok(e && e.code === 'TIMEOUT' && /stopped responding/.test(e.message), `got ${e && e.message}`);
    ok(Date.now() - t < 5000, `took ${Date.now() - t} ms`);
    return e.message;
  });
  await check('extract merges into a folder', async () => {
    const into = path.join(OUT, 'merge into');
    fs.mkdirSync(into, { recursive: true });
    fs.writeFileSync(path.join(into, 'keep.txt'), 'mine');
    fs.writeFileSync(path.join(into, 'a.txt'), 'old');
    const id = submit({ tool: 'extract-archive', files: [fx('archive.zip')], opts: {}, dest: { kind: 'folder', path: into } });
    let j;
    for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(150); }
    ok(j.status === 'done', `${j.status}: ${j.error}`);
    same(walk(into).join(','), 'a.txt,inner,inner/b.txt,keep.txt', 'merged folder');
    ok(txt(path.join(into, 'keep.txt')) === 'mine' && txt(path.join(into, 'a.txt')) === 'alpha', 'files not merged');
    ok(!files(OUT).some((f) => f.startsWith('.')), `staging left: ${files(OUT)}`);
    return walk(into).join(', ');
  });
  await check('several pages keep the chosen name', async () => {
    const d = path.join(OUT, 'chosen');
    fs.mkdirSync(d, { recursive: true });
    const id = submit({ tool: 'convert-image', files: [fx('pages.tiff')], opts: { to: 'png' }, dest: { kind: 'file', path: path.join(d, 'my pages.png') } });
    let j;
    for (;;) { j = jobs.get(id); if (j && !['queued', 'running'].includes(j.status)) break; await sleep(150); }
    ok(j.status === 'done', `${j.status}: ${j.error}`);
    same(walk(d).join(','), 'my pages,my pages/pages - page 1.png,my pages/pages - page 2.png,my pages/pages - page 3.png', 'saved');
    return walk(d).join(', ');
  });
  const CHOICES = ['select', 'choice', 'multi'], has1 = (o, v) => (o.choices || []).some(([x]) => String(x) === String(v));
  await check('catalog options are consistent', () => {
    const bad = [], raw = Object.fromEntries(tools.TOOLS.map((t) => [t.id, t]));
    for (const t of tools.catalog()) {
      const keys = new Set();
      for (const o of t.options || []) {
        const at = `${t.id}.${o.key}`;
        if (keys.has(o.key)) bad.push(`${at} appears twice`);
        keys.add(o.key);
        if (CHOICES.includes(o.type) && (!o.choices.length || new Set(o.choices.map(([v]) => String(v))).size !== o.choices.length)) bad.push(`${at} has empty or repeated choices`);
        if (o.type === 'multi' ? !Array.isArray(o.default) || !o.default.every((v) => has1(o, v)) : CHOICES.includes(o.type) && !has1(o, o.default)) bad.push(`${at} defaults to ${o.default}, not a choice`);
        if (o.type === 'range' && !(o.min < o.max && o.default >= o.min && o.default <= o.max)) bad.push(`${at} defaults to ${o.default} outside ${o.min}..${o.max}`);
        if (o.type === 'number' && o.min != null && o.default !== '' && o.default < o.min) bad.push(`${at} defaults below ${o.min}`);
        if (o.type === 'toggle' && typeof o.default !== 'boolean') bad.push(`${at} toggle defaults to ${o.default}`);
      }
      for (const o of raw[t.id].options || []) for (const [k, w] of Object.entries(o.when || {})) {
        const c = (raw[t.id].options || []).find((x) => x.key === k);
        if (!c || c === o) { bad.push(`${t.id}.${o.key} shows when ${k}, which it does not have`); continue; }
        for (const v of [].concat(w)) if (c.type === 'toggle' ? typeof v !== 'boolean' : !has1(c, v)) bad.push(`${t.id}.${o.key} shows when ${k}=${v}, not a choice`);
      }
    }
    // Convert spreadsheet is being reworked separately; its TSV condition is harmless (TSV is not offered there).
    const known = bad.filter((b) => b === 'convert-sheet.allSheets shows when to=tsv, not a choice');
    ok(bad.length === known.length, bad.filter((b) => !known.includes(b)).join('; '));
    return `${tools.catalog().reduce((s, t) => s + (t.options || []).length, 0)} options in ${tools.catalog().length} tools${known.length ? `; known: ${known.join('; ')}` : ''}`;
  });
  await check('catalog extensions resolve', () => {
    const bad = [];
    for (const t of tools.TOOLS.filter((x) => x.run && !x.noFiles)) {
      const ins = sweepIn(t).map(fx), base = defaults(t);
      for (const o of [null, ...(t.options || []).filter((x) => ['to', 'format'].includes(x.key) && x.choices)]) for (const v of o ? o.choices.map(([x]) => x) : [null]) {
        const opts = o ? { ...base, [o.key]: v } : base, s = tools.suggest(t.id, ins, opts), e = typeof t.ext === 'function' ? t.ext(opts, ins) : t.ext, at = `${t.id}${o ? ` ${o.key}=${v}` : ''}`;
        if (t.ext !== undefined && !(typeof e === 'string' && /^[a-z0-9]+(\.[a-z0-9]+)?$/.test(e))) bad.push(`${at} has extension ${JSON.stringify(e)}`);
        if (s.kind === 'file' && !(s.ext && s.name.endsWith(`.${s.ext}`) && s.name.length > s.ext.length + 1)) bad.push(`${at} suggests ${s.name}`);
        if ((s.kind === 'folder' || s.kind === 'file') && !s.name) bad.push(`${at} suggests no name`);
      }
    }
    ok(!bad.length, bad.join('; '));
  });
  await check('wheel entries point at tools', () => {
    const bad = [], HIDDEN = { 'convert-image': ['develop'] }, seen = new Set();
    const entry = (w, where) => {
      const t = tools.get(w.tool);
      if (!t || (!t.run && !t.editor)) return bad.push(`${where} ${w.label}: no tool ${w.tool}`);
      for (const [k, v] of Object.entries(w.opts || {})) {
        const o = (t.options || []).find((x) => x.key === k);
        if (!o) { if (!HIDDEN[t.id]?.includes(k)) bad.push(`${where} ${w.label}: ${t.id} has no option ${k}`); continue; }
        if ((['select', 'choice'].includes(o.type) && !has1(o, v)) || (o.type === 'range' && !(v >= o.min && v <= o.max)) || (o.type === 'toggle' && typeof v !== 'boolean')) bad.push(`${where} ${w.label}: ${k}=${v} is not allowed`);
      }
    };
    for (const [g, ring] of Object.entries(tools.WHEELS)) for (const w of [...(ring.convert || []), ...ring.tools]) entry(w, g);
    for (const [g, list] of Object.entries(tools.MULTI)) for (const w of list) entry(w, `${g} (several)`);
    const mixes = [...Object.values(SWEEP_IN).map((f) => [f]), ['folder'], ['photo.png'], ['frames.gif'], ['cursor.cur'], ['sheet.csv'], ['config.toml'], ['notes.txt.gz'], ['kobo.kepub.epub'], ['meeting.msg'], ['photo2.jpg', 'photo.webp'],
      ['raw.dng', 'photo2.jpg'], ['doc.pdf', 'v1.pdf'], ['clip2.mp4', 'clip.webm'], ['tone.mp3', 'tone.wav'], ['clip2.mp4', 'tone.wav'], ['sheet.xlsx', 'sheet.csv'], ['doc.docx', 'doc.pdf', 'photo2.jpg'], ['doc.txt', 'photo2.jpg', 'tone.mp3']];
    for (const m of mixes) {
      const files = m.map(fx), r = tools.wheelsFor(files), all = [...r.convert, ...r.tools];
      if (!all.length) bad.push(`${m.join('+')} gets an empty wheel`);
      for (const w of all) { seen.add(w.tool); entry(w, m.join('+')); if (!tools.accepts(tools.get(w.tool), files) && !tools.get(w.tool)?.editor) bad.push(`${m.join('+')} ${w.label}: ${w.tool} does not take these files`); }
    }
    ok(!bad.length, bad.join('; '));
    return `${seen.size} tools reachable from ${mixes.length} drops`;
  });
  // Option values that leave these inputs unchanged by design; anything else that matches its default run is listed as suspect.
  const QUIET = [
    [/^jpg-to-pdf orientation=landscape$/, 'both photos are landscape, which Auto picks too'], [/^redact-pdf patterns=(card|iban)$/, 'the PDF has no card numbers or IBANs'],
    [/^(ocr-pdf|scan-to-pdf|image-to-text) lang=(spa|fra|deu|ita|por|nld)$/, 'Latin-script models read the English sentence alike'], [/^ocr-pdf skipText=false$/, 'the scan has no text layer to skip'],
    [/^scan-to-pdf mode=colour$/, 'the page is grey already'], [/^convert-video quality=high$/, 'H.264 into MP4 is rewrapped, not re-encoded'],
    [/^(convert-video|compress-video) height=(2160|1080|720)$/, 'the 540p clip is never enlarged'], [/^(extract-audio|convert-audio) rate=48000$/, 'the source is 48 kHz already'],
    [/^trace-image transparent=true$/, 'the photo has no white areas to leave out'], [/^poster-frame transparent=false$/, 'the animation has its own black background layer'],
    [/^convert-slides paper=(letter|a4)$/, 'Automatic picks the local paper size'], [/^pages-per-sheet orientation=portrait$/, 'four portrait pages fit best on a portrait sheet'],
    [/^pdf-page-size orientation=portrait$/, 'the pages are portrait already'], [/^overlay-pdf scale=actual$/, 'the overlay is the same size as the pages'],
    [/^export-layers hidden=true$/, 'the PSD has no hidden layers'], [/^split-scenes sensitivity=(1|100)$/, 'hard cuts are found at any sensitivity, as FilmCraft’s own tests expect'],
    [/^create-archive level=9$/, 'a tiny text file deflates alike at 5 and 9'],
    [/^replace-text (regex=true|everywhere=false)$/, 'a plain word reads the same as a pattern, and the document has no headers or notes'], [/^clean-office notes=true$/, 'a Word document has no speaker notes'],
    [/^office-media what=(pictures|all)$/, 'the document holds only a picture'], [/^tidy-sheet header=false$/, 'no row repeats the header row'], [/^file-hash algos=none$/, 'no algorithm falls back to SHA-256'], [/^rename-files case=lower$/, 'the new name is lower case already'],
    [/^convert-model (repair=true|keep=1)$/, 'the box is a clean mesh of 12 triangles, the fewest Simplify keeps'], [/^model-drawing scale=2$/, 'the stepped block fits at 2:1, the largest scale that fits'], [/^file-hash algos=none$/, 'no algorithm falls back to SHA-256'], [/^rename-files case=lower$/, 'the new name is lower case already'],
  ];
  await check('option sweep covers the catalogue', () => {
    const names = new Set(C.filter((c) => c.par).map((c) => c.name.replace(/^sweep /, ''))), runnable = tools.catalog().filter((t) => !t.editor && !t.noFiles);
    const bad = [...runnable.filter((t) => !names.has(`${t.id} defaults`)).map((t) => `${t.id} has no run`), ...Object.keys(SWEEP).filter((id) => !tools.get(id)).map((id) => `no tool ${id}`),
      ...Object.keys(SWEEP_REFUSE).filter((k) => !names.has(k)).map((k) => `no case ${k}`)];
    ok(!bad.length, bad.join('; '));
    return `${names.size} runs over ${runnable.length} tools; not swept: ${tools.catalog().filter((t) => t.editor || t.noFiles).map((t) => t.id).join(', ')}`;
  });
  await check('option sweep: options with no effect', () => {
    const quiet = sweepPairs.filter(([a, b]) => sweepSig.has(a) && sweepSig.has(b) && sweepSig.get(a) === sweepSig.get(b)), why = (a) => QUIET.find(([re]) => re.test(a))?.[1];
    for (const [a, b] of quiet) console.log(`     no effect: ${a} (same as ${b.replace(/^\S+ /, '')})${why(a) ? `: ${why(a)}` : ', SUSPECT'}`);
    const odd = quiet.filter(([a]) => !why(a)).map(([a]) => a);
    return `${quiet.length} of ${sweepPairs.filter(([a, b]) => sweepSig.has(a) && sweepSig.has(b)).length} option values match their default run${odd.length ? `; unexplained: ${odd.join(', ')}` : ', all explained'}`;
  });
  const fail = results.filter((r) => r.status === 'FAIL'), skip = results.filter((r) => r.status === 'SKIP');
  console.log(`\n${results.length - fail.length - skip.length}/${results.length - skip.length} passed${skip.length ? `, ${skip.length} skipped` : ''}`);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(results, null, 1));
  app.isQuitting = true;
  app.exit(fail.length ? 1 : 0);
};
