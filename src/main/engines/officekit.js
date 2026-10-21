'use strict';
// Whole-file jobs Word, Excel and PowerPoint share: find and replace that keeps formatting, removing comments and
// personal details (Office's Document Inspector), saving the pictures and media inside, and compressing pictures.
// They work on the files' own XML, for OpenDocument files too, without LibreOffice.
const U = require('./util');
const { fsp, path } = U;
const O = require('./opc');
const { NS, all, kids, child, up, remove, attr, is } = O;
const W = NS.w;

const PLAIN = ['txt', 'md', 'markdown', 'csv', 'tsv', 'html', 'htm', 'xml'];

// ───────── Find and replace ─────────
function storyParts(pkg, fam, more) {
  if (pkg.odf) return ['content.xml', ...(more ? ['styles.xml'] : [])].filter((n) => pkg.has(n));
  if (fam === 'word') return pkg.list(more ? /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/ : /^word\/document\.xml$/);
  if (fam === 'powerpoint') return pkg.list(more ? /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/ : /^ppt\/slides\/slide\d+\.xml$/);
  if (fam === 'excel') return pkg.list(/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/);
  return [];
}
async function replaceText(file, o, ctx) {
  const find = String(o.find ?? '');
  if (!find) throw new Error('Type the text to find.');
  const re = O.pattern(find, o), rep = o.regex ? String(o.replace ?? '') : String(o.replace ?? '').replace(/\$/g, '$$$$');
  const e = U.ext(file), out = ctx.out.file(file, `${U.base(file)}-replaced.${e}`);
  let n = 0;
  if (PLAIN.includes(e)) {
    const { decodeText } = require('./textcodec'), src = decodeText(await fsp.readFile(file));
    const markup = ['html', 'htm', 'xml'].includes(e);
    const raw = String(o.replace ?? '');
    const result = (markup ? src.split(/(<[^>]*>)/) : [src]).map((part, i) => (i % 2 ? part : part.replace(re, (...m) => { n++; return o.regex ? O.expand(raw, m) : raw; }))).join('');
    if (!n) throw notFound(find);
    await fsp.writeFile(out, result);
    return { path: out, note: `Replaced ${n} time${n === 1 ? '' : 's'}` };
  }
  const pkg = await O.Package.open(file), fam = O.familyOf(pkg);
  for (const part of storyParts(pkg, fam, o.everywhere !== false)) {
    if (/worksheets\//.test(part) && !/<is>/.test(pkg.text(part))) continue;
    for (const { segs } of O.paragraphs(pkg.dom(part))) n += O.replaceAcross(segs, re, rep);
  }
  if (!n) throw notFound(find);
  await pkg.save(out);
  return { path: out, note: `Replaced ${n} time${n === 1 ? '' : 's'}` };
}
const notFound = (find) => new Error(`Lime found no “${find.length > 40 ? `${find.slice(0, 40)}…` : find}” in this file.`);

// ───────── Removing comments and personal details ─────────
const COMMENT_RELS = new Set(['comments', 'commentsExtended', 'commentsIds', 'commentsExtensible', 'people', 'person', 'threadedComment', 'commentAuthors', 'authors']);
function dropRels(pkg, test) {
  let n = 0;
  for (const part of ['', ...pkg.list(/\.xml$/)]) for (const r of pkg.rels(part)) if (test(r, part)) { pkg.removeRel(part, r.id); n++; }
  return n;
}
function cleanWord(pkg, o, n) {
  const parts = pkg.list(/^word\/[^/]+\.xml$/);
  if (o.comments !== false) {
    n.comments += (pkg.text('word/comments.xml').match(/<w:comment\b/g) || []).length;
    dropRels(pkg, (r) => COMMENT_RELS.has(r.type));
    for (const p of parts) {
      if (!/<w:comment(RangeStart|RangeEnd|Reference)\b/.test(pkg.text(p))) continue;
      const d = pkg.dom(p);
      for (const name of ['commentRangeStart', 'commentRangeEnd']) all(d, W, name).forEach(remove);
      for (const ref of all(d, W, 'commentReference')) { const run = up(ref, W, 'r'); remove(ref); if (run && !kids(run).some((c) => !is(c, W, 'rPr'))) remove(run); }
    }
  }
  if (o.hidden !== false) for (const p of parts) {
    if (!/<w:vanish\b/.test(pkg.text(p))) continue;
    for (const v of all(pkg.dom(p), W, 'vanish')) {
      const rPr = v.parentNode, run = rPr?.parentNode;
      if (!is(rPr, W, 'rPr') || !is(run, W, 'r') || attr(v, W, 'val') === '0' || attr(v, W, 'val') === 'false') continue;
      n.hidden += (run.textContent || '').length ? 1 : 0;
      remove(run);
    }
  }
  if (o.properties !== false) {
    for (const p of pkg.list(/^word\/[^/]+\.xml$/)) {
      const x = pkg.text(p), y = x.replace(/\sw:rsid\w*="[0-9A-Fa-f]+"/g, '').replace(/(<w:(?:ins|del|moveFrom|moveTo|rPrChange|pPrChange|sectPrChange|tblPrChange|trPrChange|tcPrChange|cellIns|cellDel|comment)\b[^>]*?)\sw:author="[^"]*"/g, '$1 w:author="Author"').replace(/<w:(?:ins|del|moveFrom|moveTo|rPrChange|pPrChange|sectPrChange|tblPrChange|trPrChange|tcPrChange|cellIns|cellDel|comment)\b[^>]*>/g, (t) => t.replace(/\sw:(?:date|initials)="[^"]*"/g, ''));
      if (x !== y) pkg.set(p, y);
    }
    if (pkg.has('word/settings.xml')) {
      const s = pkg.dom('word/settings.xml');
      for (const name of ['rsids', 'attachedTemplate', 'docVars']) all(s, W, name).forEach(remove);
      const root = s.documentElement;
      if (!all(s, W, 'removePersonalInformation').length) root.insertBefore(O.make(s, W, 'w:removePersonalInformation'), root.firstChild);
      if (!all(s, W, 'removeDateAndTime').length) root.insertBefore(O.make(s, W, 'w:removeDateAndTime'), all(s, W, 'removePersonalInformation')[0].nextSibling);
    }
    for (const r of pkg.rels(pkg.main())) if (r.type === 'attachedTemplate') pkg.removeRel(pkg.main(), r.id);
  }
}
function cleanExcel(pkg, o, n) {
  if (o.comments !== false) {
    for (const p of pkg.list(/^xl\/comments\d*\.xml$/)) n.comments += (pkg.text(p).match(/<comment\b/g) || []).length;
    // The VML drawing that shows a sheet's comment boxes goes with them, unless it also holds form controls.
    const vml = new Set();
    dropRels(pkg, (r, part) => {
      if (COMMENT_RELS.has(r.type)) return true;
      if (r.type === 'vmlDrawing' && /worksheets\//.test(part) && !/ObjectType="(?!Note)/.test(pkg.text(r.target))) { vml.add(`${part}|${r.id}`); return true; }
      return false;
    });
    for (const key of vml) { const [part, id] = key.split('|'); pkg.set(part, pkg.text(part).replace(new RegExp(`<legacyDrawing\\b[^>]*r:id="${id}"[^>]*/>`), '')); }
  }
  if (o.properties !== false) {
    const main = pkg.main();
    pkg.set(main, pkg.text(main).replace(/<mc:AlternateContent\b[^>]*>(?:(?!<\/mc:AlternateContent>)[\s\S])*?absPath[\s\S]*?<\/mc:AlternateContent>/g, '').replace(/(<fileSharing\b[^>]*?)\suserName="[^"]*"/g, '$1'));
  }
}
function cleanPowerPoint(pkg, o, n) {
  if (o.comments !== false) {
    for (const p of pkg.list(/^ppt\/comments\/[^/]+\.xml$/)) n.comments += (pkg.text(p).match(/<p:cm\b|<p188:cm\b|:cm\s/g) || []).length;
    dropRels(pkg, (r) => COMMENT_RELS.has(r.type));
  }
  if (o.notes) n.notes += dropRels(pkg, (r, part) => r.type === 'notesSlide' && /slides\/slide\d+\.xml$/.test(part));
  if (o.hidden !== false) for (const p of pkg.list(/^ppt\/slides\/slide\d+\.xml$/)) {
    if (!/hidden="(1|true)"/.test(pkg.text(p))) continue;
    for (const c of all(pkg.dom(p), NS.p, 'cNvPr')) if (/^(1|true)$/.test(c.getAttribute('hidden') || '')) { const shape = c.parentNode?.parentNode; if (shape && shape.parentNode) { remove(shape); n.hidden++; } }
  }
}
function cleanOdf(pkg, o, n) {
  const T = NS.text;
  for (const name of ['content.xml', 'styles.xml']) {
    if (!pkg.has(name)) continue;
    const d = pkg.dom(name);
    if (o.comments !== false) { n.comments += all(d, NS.office, 'annotation').length; for (const a of [...all(d, NS.office, 'annotation'), ...all(d, NS.office, 'annotation-end')]) remove(a); }
    if (o.hidden !== false) for (const tag of ['hidden-text', 'hidden-paragraph']) for (const e of all(d, T, tag)) { n.hidden++; remove(e); }
    if (o.hidden !== false) for (const s of all(d, T, 'section')) if (attr(s, T, 'display') === 'none') { n.hidden++; remove(s); }
    if (o.notes) for (const e of all(d, NS.presentation, 'notes')) { n.notes++; remove(e); }
    if (o.properties !== false) for (const ci of all(d, NS.office, 'change-info')) for (const c of all(ci, NS.dc, 'creator')) c.textContent = 'Author';
  }
  if (o.properties !== false) {
    if (pkg.has('meta.xml')) {
      const m = pkg.dom('meta.xml');
      for (const [ns, tag] of [[NS.meta, 'initial-creator'], [NS.dc, 'creator'], [NS.meta, 'printed-by'], [NS.meta, 'print-date'], [NS.meta, 'editing-cycles'], [NS.meta, 'editing-duration'], [NS.meta, 'user-defined'], [NS.meta, 'template']]) all(m, ns, tag).forEach((e) => { n.props++; remove(e); });
    }
    if (pkg.has('settings.xml')) { const s = pkg.dom('settings.xml'); for (const it of all(s, NS.config, 'config-item')) if (/^Printer(Name|Setup|PaperFromSetup)$/.test(attr(it, NS.config, 'name'))) remove(it); }
  }
}
async function clean(file, o, ctx) {
  const pkg = await O.Package.open(file), fam = O.familyOf(pkg), n = { comments: 0, hidden: 0, notes: 0, props: 0 };
  if (pkg.odf) cleanOdf(pkg, o, n);
  else {
    if (fam === 'word') cleanWord(pkg, o, n);
    else if (fam === 'excel') cleanExcel(pkg, o, n);
    else if (fam === 'powerpoint') cleanPowerPoint(pkg, o, n);
    if (o.properties !== false) {
      if (pkg.has('docProps/core.xml')) {
        const c = pkg.dom('docProps/core.xml');
        for (const [ns, tag] of [[NS.dc, 'creator'], [NS.cp, 'lastModifiedBy'], [NS.cp, 'lastPrinted']]) for (const e of all(c, ns, tag)) { if (e.textContent) n.props++; remove(e); }
        for (const e of all(c, NS.cp, 'revision')) e.textContent = '1';
      }
      if (pkg.has('docProps/app.xml')) pkg.set('docProps/app.xml', pkg.text('docProps/app.xml').replace(/<(Company|Manager|HyperlinkBase|Template)>[^<]*<\/\1>|<TotalTime>\d+<\/TotalTime>/g, (m) => { if (!/>\s*</.test(m) && !/<TotalTime>0</.test(m)) n.props++; return ''; }));
      n.props += dropRels(pkg, (r, part) => !part && r.type === 'custom-properties');
    }
    pkg.prune();
  }
  const what = [n.comments && `${n.comments} comment${n.comments === 1 ? '' : 's'}`, n.props && 'authors and personal details', n.hidden && `${n.hidden} hidden item${n.hidden === 1 ? '' : 's'}`, n.notes && `notes from ${n.notes} slide${n.notes === 1 ? '' : 's'}`].filter(Boolean);
  const out = ctx.out.file(file, `${U.base(file)}-clean.${U.ext(file)}`);
  await pkg.save(out);
  return { path: out, note: what.length ? `Removed ${what.join(', ')}` : 'Nothing personal or hidden was found; saved a clean copy anyway' };
}

// ───────── Pictures and media inside ─────────
const KIND = (type, ext) => (/^image\//.test(type) || /^(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|webp)$/.test(ext) ? 'picture' : /^video\//.test(type) || /^(mp4|m4v|mov|avi|wmv|mpe?g|webm)$/.test(ext) ? 'video' : /^audio\//.test(type) || /^(mp3|m4a|wav|wma|aac|mid|midi)$/.test(ext) ? 'sound' : 'file');
const LABEL = { picture: 'Image', video: 'Video', sound: 'Sound', file: 'Embedded' };
// Media parts in reading order: as the document, each slide in turn or each sheet in turn points to them.
function mediaInOrder(pkg) {
  const fam = O.familyOf(pkg), seen = new Set(), list = [];
  const isMedia = (p) => /\/(media|embeddings)\//.test(p) || /^Pictures\//.test(p) || /^Media\//.test(p);
  const walk = (part, label, depth = 0) => {
    if (depth > 6 || !pkg.has(part)) return;
    const rels = pkg.rels(part), byId = new Map(rels.map((r) => [r.id, r])), xml = pkg.text(part), order = [];
    for (const m of xml.matchAll(/\br:(?:embed|link|id|pict|dm|lo|qs|cs)="([^"]+)"/g)) { const r = byId.get(m[1]); if (r && !order.includes(r)) order.push(r); }
    for (const r of rels) if (!order.includes(r)) order.push(r);
    for (const r of order) {
      if (r.external || seen.has(r.target) || !pkg.has(r.target)) continue;
      if (isMedia(r.target)) { seen.add(r.target); list.push({ part: r.target, label }); } else if (/\.xml$/.test(r.target) && !['slide', 'slideLayout', 'slideMaster', 'notesMaster', 'theme', 'styles', 'numbering', 'settings', 'fontTable', 'webSettings', 'worksheet', 'sharedStrings'].includes(r.type)) walk(r.target, label, depth + 1);
    }
  };
  if (pkg.odf) {
    const refs = ['content.xml', 'styles.xml'].flatMap((n) => [...pkg.text(n).matchAll(/xlink:href="([^"#][^"]*)"/g)].map((m) => decodeURIComponent(m[1]).replace(/^\.\//, '')));
    for (const r of [...refs, ...pkg.list(/^(Pictures|Media)\//)]) if (pkg.has(r) && !seen.has(r) && isMedia(r)) { seen.add(r); list.push({ part: r, label: '' }); }
    return list;
  }
  const main = pkg.main();
  if (fam === 'powerpoint') require('./slides').slideList(pkg).forEach((s, i) => walk(s.part, `Slide ${i + 1}`));
  else if (fam === 'excel') for (const s of require('./excel').sheetsOf(pkg)) if (s.part) walk(s.part, s.name);
  walk(main, '');
  for (const p of ['', ...pkg.list(/\.xml$/)]) if (p !== main) for (const r of pkg.rels(p)) if (!r.external && isMedia(r.target) && !seen.has(r.target) && pkg.has(r.target)) { seen.add(r.target); list.push({ part: r.target, label: '' }); }
  return list;
}
async function extractMedia(file, o, ctx) {
  const pkg = await O.Package.open(file), want = o.what || 'media';
  const items = mediaInOrder(pkg).map((m) => ({ ...m, kind: KIND(pkg.odf ? '' : pkg.typeOf(m.part), path.posix.extname(m.part).slice(1).toLowerCase()) }))
    .filter((m) => m.kind === 'picture' || (want !== 'pictures' && (m.kind !== 'file' || want === 'all')));
  if (!items.length) return { note: `This file has no ${want === 'pictures' ? 'pictures' : 'pictures or media'} inside.` };
  const folder = ctx.out.folder(file, `${U.base(file)} - media`), counts = {}, used = new Set();
  for (const m of items) {
    const key = `${m.label}|${m.kind}`;
    counts[key] = (counts[key] || 0) + 1;
    const ext = path.posix.extname(m.part).toLowerCase().replace('.jpeg', '.jpg');
    let name = U.sanitize(`${m.label ? `${m.label} - ` : ''}${LABEL[m.kind]} ${counts[key]}`);
    for (let k = 2; used.has(`${name}${ext}`.toLowerCase()); k++) name = `${name} ${k}`;
    used.add(`${name}${ext}`.toLowerCase());
    await fsp.writeFile(path.join(folder, `${name}${ext}`), pkg.bytes(m.part));
  }
  const by = (k) => items.filter((m) => m.kind === k).length, parts = [['picture', 'picture'], ['video', 'video'], ['sound', 'sound'], ['file', 'embedded file']].map(([k, w]) => by(k) && `${by(k)} ${w}${by(k) === 1 ? '' : 's'}`).filter(Boolean);
  return { path: folder, note: parts.join(', ') };
}

async function compressPictures(file, o, ctx) {
  const sharp = require('sharp'), pkg = await O.Package.open(file), max = Number(o.size) || 1600, q = Math.round(Number(o.quality) || 80);
  if (!pkg.odf) pkg.prune();
  const pics = pkg.list(pkg.odf ? /^Pictures\/[^/]+\.(jpe?g|png)$/i : /^(word|xl|ppt)\/media\/[^/]+\.(jpe?g|png)$/i);
  if (!pics.length) return { note: 'This file has no JPEG or PNG pictures to compress.' };
  let before = 0, after = 0, smaller = 0;
  for (const [i, p] of pics.entries()) {
    ctx.progress?.(i / Math.max(1, pics.length), 'Compressing pictures');
    const buf = Buffer.from(pkg.bytes(p));
    before += buf.length;
    let best = buf;
    try {
      const meta = await sharp(buf).metadata(), big = Math.max(meta.width || 0, meta.height || 0) > max;
      const base = () => { const s = sharp(buf, { failOn: 'none' }); return big ? s.resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }) : s; };
      const tries = meta.format === 'jpeg' ? [base().jpeg({ quality: q, mozjpeg: true })] : [base().png({ compressionLevel: 9, effort: 8 }), ...(q < 90 ? [base().png({ palette: true, quality: q, compressionLevel: 9, effort: 8 })] : [])];
      for (const t of tries) { const b = await t.toBuffer(); if (b.length < best.length) best = b; }
    } catch (_) {}
    if (best !== buf) { pkg.set(p, new Uint8Array(best)); smaller++; }
    after += best.length;
  }
  const out = ctx.out.file(file, `${U.base(file)}-compressed.${U.ext(file)}`);
  await pkg.save(out);
  return { path: out, note: smaller ? `Pictures ${U.fmtBytes(before)} → ${U.fmtBytes(after)} (${smaller} of ${pics.length} made smaller)` : 'The pictures are already as small as these settings make them' };
}

module.exports = { replaceText, clean, extractMedia, compressPictures, mediaInOrder };
