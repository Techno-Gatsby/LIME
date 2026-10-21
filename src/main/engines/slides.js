'use strict';
// PowerPoint decks part by part: speaker notes and outlines out, decks merged with their designs, slides kept,
// reordered or dropped. Everything else in the file stays as PowerPoint wrote it.
const U = require('./util');
const { fsp, path } = U;
const O = require('./opc');
const { NS, all, kids, child, remove, make, attr, is } = O;
const P = NS.p, A = NS.a, R = NS.r;
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main', SECTIONS = '{521415D9-36F7-43E2-AB2F-B90AF26B5E84}';
const PPT_EXT = ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'];

async function openDeck(file) {
  const pkg = await O.Package.open(file);
  if (O.familyOf(pkg) !== 'powerpoint') throw new Error(`${path.basename(file)} isn’t a presentation.`);
  return pkg;
}
const slideList = (pkg, main = pkg.main()) => all(pkg.dom(main), P, 'sldId').map((el) => ({ el, id: Number(el.getAttribute('id')), rid: attr(el, R, 'id'), part: pkg.rel(main, attr(el, R, 'id'))?.target })).filter((s) => s.part && pkg.has(s.part));
const paraLines = (root) => all(root, A, 'p').map((p) => ({ text: kids(p).flatMap((c) => (is(c, A, 'r') || is(c, A, 'fld') ? [all(c, A, 't').map((t) => t.textContent).join('')] : is(c, A, 'br') ? ['\n'] : [])).join(''), level: Number(attr(child(p, A, 'pPr'), null, 'lvl')) || 0 })).filter((l) => l.text.trim());
const phType = (sp) => { const ph = all(sp, P, 'ph')[0]; return ph ? ph.getAttribute('type') || 'body' : null; };

// Each slide's title, the rest of its text with outline levels, its speaker notes and whether it is hidden.
async function readDeck(file) {
  const pkg = await O.Package.open(file);
  if (pkg.odf) return readOdp(pkg);
  if (O.familyOf(pkg) !== 'powerpoint') throw new Error(`${path.basename(file)} isn’t a presentation.`);
  let pictures = 0;
  const slides = slideList(pkg).map((s, i) => {
    const doc = pkg.dom(s.part), out = { n: i + 1, title: '', body: [], notes: [], hidden: doc.documentElement.getAttribute('show') === '0' };
    pictures += all(doc, P, 'pic').length;
    for (const sp of all(doc, P, 'sp')) {
      const t = phType(sp);
      if (['sldNum', 'dt', 'ftr', 'hdr', 'sldImg'].includes(t)) continue;
      const lines = paraLines(sp);
      if ((t === 'title' || t === 'ctrTitle') && !out.title) out.title = lines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
      else out.body.push(...lines);
    }
    for (const tbl of all(doc, A, 'tbl')) for (const tr of all(tbl, A, 'tr')) out.body.push({ text: all(tr, A, 'tc').map((tc) => paraLines(tc).map((l) => l.text).join(' ')).join(' | '), level: 0 });
    const notes = pkg.rels(s.part).find((r) => r.type === 'notesSlide');
    if (notes && pkg.has(notes.target)) for (const sp of all(pkg.dom(notes.target), P, 'sp')) if (phType(sp) === 'body') out.notes.push(...paraLines(sp).map((l) => l.text));
    return out;
  });
  return { slides, pictures };
}
function readOdp(pkg) {
  const doc = pkg.dom('content.xml'), PR = NS.presentation;
  const text = (n) => O.paragraphs(n).map((p) => p.segs.map((s) => s.get()).join('')).filter((t) => t.trim());
  let pictures = 0;
  const slides = all(doc, NS.draw, 'page').map((pg, i) => {
    const out = { n: i + 1, title: '', body: [], notes: [], hidden: false };
    const notes = all(pg, PR, 'notes')[0];
    for (const f of all(pg, NS.draw, 'frame')) {
      if (notes && isInside(f, notes)) continue;
      if (all(f, NS.draw, 'image').length) pictures++;
      const cls = attr(f, PR, 'class'), lines = text(f);
      if (cls === 'title' && !out.title) out.title = lines.join(' ');
      else if (!['page-number', 'footer', 'date-time', 'header'].includes(cls)) out.body.push(...lines.map((t) => ({ text: t, level: 0 })));
    }
    if (notes) for (const f of all(notes, NS.draw, 'frame')) if (attr(f, PR, 'class') === 'notes') out.notes.push(...text(f));
    return out;
  });
  return { slides, pictures };
}
const isInside = (n, root) => { for (let p = n.parentNode; p; p = p.parentNode) if (p === root) return true; return false; };

async function exportNotes(file, o, ctx) {
  const deck = await readDeck(file), what = o.include || 'both', to = o.to || 'docx';
  const withNotes = deck.slides.filter((s) => s.notes.length);
  if (what === 'notes' && !withNotes.length) throw new Error('This presentation has no speaker notes.');
  const list = what === 'notes' ? withNotes : deck.slides;
  const heading = (s) => `Slide ${s.n}${s.title ? `: ${s.title}` : ''}${s.hidden ? ' (hidden)' : ''}`;
  const out = ctx.out.file(file, `${U.base(file)} - ${what === 'outline' ? 'outline' : 'notes'}.${to}`);
  const showBody = what !== 'notes', showNotes = what !== 'outline';
  if (to === 'docx') {
    const D = require('docx'), kidsOf = [];
    kidsOf.push(new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun(U.base(file))] }));
    for (const s of list) {
      kidsOf.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun(heading(s))] }));
      if (showBody) for (const l of s.body) kidsOf.push(new D.Paragraph({ bullet: { level: Math.min(8, l.level) }, children: lines(D, l.text) }));
      if (showNotes && s.notes.length) {
        if (showBody) kidsOf.push(new D.Paragraph({ spacing: { before: 160 }, children: [new D.TextRun({ text: 'Notes', bold: true, italics: true })] }));
        for (const t of s.notes) kidsOf.push(new D.Paragraph({ spacing: { after: 120 }, children: lines(D, t) }));
      }
    }
    await fsp.writeFile(out, await D.Packer.toBuffer(new D.Document({ creator: 'Lime', title: U.base(file), sections: [{ children: kidsOf }] })));
  } else {
    const md = to === 'md', parts = [md ? `# ${U.base(file)}` : U.base(file)];
    for (const s of list) {
      const block = [md ? `## ${heading(s)}` : heading(s)];
      if (showBody && s.body.length) block.push(s.body.map((l) => `${'  '.repeat(l.level)}${md ? '-' : '•'} ${l.text.replace(/\n/g, ' ')}`).join('\n'));
      if (showNotes && s.notes.length) block.push(...(showBody ? [md ? '**Notes**' : 'Notes:'] : []), ...s.notes);
      parts.push(block.join('\n\n'));
    }
    await fsp.writeFile(out, `${parts.join('\n\n')}\n`);
  }
  return { path: out, note: what === 'outline' ? `${list.length} slides` : `Notes from ${withNotes.length} of ${deck.slides.length} slides` };
}
const lines = (D, t) => String(t).split('\n').map((x, i) => new D.TextRun({ text: x, break: i ? 1 : undefined }));

// ───────── Merging decks ─────────
const MASTER_MIN = 2147483648;
function freeName(pkg, want, taken) {
  const m = /^(.*?)(\d*)(\.[^./]+)$/.exec(want);
  if (!m) return want;
  for (let n = 1; ; n++) { const name = `${m[1]}${n}${m[3]}`; if (!pkg.has(name) && !taken.has(name)) { taken.add(name); return name; } }
}
const relsXml = (list) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS.rel}">${list.map((r) => `<Relationship Id="${O.xmlEsc(r.id)}" Type="${O.xmlEsc(r.type)}" Target="${O.xmlEsc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
const DROP_RELS = new Set(['comments', 'commentAuthors', 'authors']);
// Copies a part from another deck with everything it leads to, under names free in this one; relationship ids
// stay the same, so the copied XML needs no changes. `map` decides parts that shouldn't be copied.
function copyGraph(dst, src, start, memo, taken, map) {
  const copy = (part) => {
    if (memo.has(part)) return memo.get(part);
    const mapped = map(part);
    if (mapped !== undefined) { memo.set(part, mapped); return mapped; }
    const name = freeName(dst, part, taken);
    memo.set(part, name);
    dst.set(name, src.bytes(part));
    const type = src.typeOf(part), ext = path.posix.extname(part).slice(1).toLowerCase();
    if (src.types() && O.all(src.types(), NS.ct, 'Override').some((e) => (e.getAttribute('PartName') || '').replace(/^\//, '').toLowerCase() === part.toLowerCase())) dst.setType(name, type);
    else if (type) dst.ensureDefault(ext, type);
    const rels = [];
    for (const r of src.rels(part)) {
      if (r.external) { rels.push({ id: r.id, type: r.fullType, target: r.target, external: true }); continue; }
      if (DROP_RELS.has(r.type) || !src.has(r.target)) continue;
      const t = copy(r.target);
      if (t) rels.push({ id: r.id, type: r.fullType, target: O.relative(name, t) });
    }
    if (rels.length) dst.set(O.relsOf(name), relsXml(rels));
    return name;
  };
  return copy(start);
}
const layoutsOf = (pkg, main) => pkg.rels(main).filter((r) => r.type === 'slideMaster').flatMap((m) => pkg.rels(m.target).filter((r) => r.type === 'slideLayout').map((r) => r.target));
const layoutKey = (pkg, part) => { const d = pkg.dom(part); return { type: d.documentElement.getAttribute('type') || '', name: all(d, P, 'cSld')[0]?.getAttribute('name') || '' }; };
function listEl(pres, name, afterNames) {
  const root = pres.documentElement;
  let el = child(root, P, name);
  if (!el) {
    el = make(pres, P, `p:${name}`);
    const prev = afterNames.map((n) => child(root, P, n)).filter(Boolean).pop();
    root.insertBefore(el, prev ? prev.nextSibling : root.firstChild);
  }
  return el;
}
function sectionList(pres) {
  const ext = all(pres, P, 'ext').find((e) => e.getAttribute('uri') === SECTIONS);
  return ext ? all(ext, P14, 'sectionLst')[0] : null;
}
const guid = () => `{${require('crypto').randomUUID().toUpperCase()}}`;

async function mergeDecks(files, o, ctx) {
  const base = await openDeck(files[0]), main = base.main(), pres = base.dom(main), keep = o.design !== 'first';
  const sz = (pkg) => { const s = all(pkg.dom(pkg.main()), P, 'sldSz')[0]; return s ? `${s.getAttribute('cx')}x${s.getAttribute('cy')}` : ''; };
  const ids = (name) => all(pres, P, name).map((e) => Number(e.getAttribute('id')) || 0);
  let slideId = Math.max(255, ...ids('sldId')) + 1;
  // Master and layout ids share one range and must stay unique across the merged deck.
  let masterId = Math.max(MASTER_MIN - 1, ...ids('sldMasterId'), ...base.rels(main).filter((r) => r.type === 'slideMaster').flatMap((m) => all(base.dom(m.target), P, 'sldLayoutId').map((e) => Number(e.getAttribute('id')) || 0))) + 1;
  let notesMaster = base.rels(main).find((r) => r.type === 'notesMaster')?.target || null;
  const baseLayouts = layoutsOf(base, main).map((p) => ({ part: p, ...layoutKey(base, p) }));
  const sldIdLst = listEl(pres, 'sldIdLst', ['sldMasterIdLst', 'notesMasterIdLst', 'handoutMasterIdLst']);
  const sections = sectionList(pres), taken = new Set();
  let added = 0, resized = false;
  for (const [fi, f] of files.slice(1).entries()) {
    ctx.progress?.((fi + 1) / files.length, `Adding ${path.basename(f)}`);
    const src = await openDeck(f), memo = new Map();
    if (sz(src) !== sz(base)) resized = true;
    const map = (part) => {
      if (/slideLayouts\/[^/]+\.xml$/.test(part) && !keep) {
        const k = layoutKey(src, part);
        return (baseLayouts.find((l) => k.type && l.type === k.type) || baseLayouts.find((l) => k.name && l.name === k.name) || baseLayouts[0])?.part || null;
      }
      if (/notesMasters\/[^/]+\.xml$/.test(part) && notesMaster) return notesMaster;
      return undefined;
    };
    const newIds = [];
    for (const s of slideList(src)) {
      const part = copyGraph(base, src, s.part, memo, taken, map), rid = base.addRel(main, 'slide', part);
      sldIdLst.appendChild(make(pres, P, 'p:sldId', { id: slideId, 'r:id': rid }));
      newIds.push(slideId++);
      added++;
    }
    for (const [from, to] of memo) {
      if (!to || from === to) continue;
      if (/slideMasters\/[^/]+\.xml$/.test(from) && !base.rels(main).some((r) => r.target === to)) {
        const rid = base.addRel(main, 'slideMaster', to), md = base.dom(to);
        for (const l of all(md, P, 'sldLayoutId')) l.setAttribute('id', String(++masterId));
        listEl(pres, 'sldMasterIdLst', []).appendChild(make(pres, P, 'p:sldMasterId', { id: ++masterId, 'r:id': rid }));
      }
      if (/notesMasters\/[^/]+\.xml$/.test(from) && !notesMaster) {
        notesMaster = to;
        const rid = base.addRel(main, 'notesMaster', to);
        listEl(pres, 'notesMasterIdLst', ['sldMasterIdLst']).appendChild(make(pres, P, 'p:notesMasterId', { 'r:id': rid }));
      }
    }
    if (sections && newIds.length) {
      const sec = pres.createElementNS(P14, 'p14:section');
      sec.setAttribute('name', U.base(f));
      sec.setAttribute('id', guid());
      const list = pres.createElementNS(P14, 'p14:sldIdLst');
      for (const id of newIds) { const e = pres.createElementNS(P14, 'p14:sldId'); e.setAttribute('id', String(id)); list.appendChild(e); }
      sec.appendChild(list);
      sections.appendChild(sec);
    }
  }
  if (masterId >= 4294967295) throw new Error('These presentations have too many layouts to merge.');
  slideCount(base);
  const out = ctx.out.file(files[0], `${U.base(files[0])} - merged.${U.ext(files[0])}`);
  await base.save(out);
  return { path: out, note: `${slideList(base).length} slides${resized ? '; slides of another size were added at this deck’s size' : ''}` };
}
function slideCount(pkg) {
  if (!pkg.has('docProps/app.xml')) return;
  pkg.set('docProps/app.xml', pkg.text('docProps/app.xml').replace(/<Slides>\d+<\/Slides>/, `<Slides>${slideList(pkg).length}</Slides>`).replace(/<HiddenSlides>\d+<\/HiddenSlides>/, `<HiddenSlides>${slideList(pkg).filter((s) => pkg.dom(s.part).documentElement.getAttribute('show') === '0').length}</HiddenSlides>`));
}

// ───────── Keeping, reordering and dropping slides ─────────
async function pickSlides(file, o, ctx) {
  const pkg = await openDeck(file), main = pkg.main(), pres = pkg.dom(main), slides = slideList(pkg, main);
  const hidden = (s) => pkg.dom(s.part).documentElement.getAttribute('show') === '0';
  let order = U.parseRanges(o.slides || 'all', slides.length).filter((v, i, a) => a.indexOf(v) === i).map((i) => slides[i]);
  if (o.dropHidden !== false) order = order.filter((s) => !hidden(s));
  if (!order.length) throw new Error('That leaves no slides.');
  const keptIds = new Set(order.map((s) => s.id)), gone = slides.filter((s) => !keptIds.has(s.id));
  if (!gone.length && order.every((s, i) => s === slides[i])) return { note: o.dropHidden !== false && (!o.slides || o.slides === 'all') ? 'This presentation has no hidden slides.' : 'Nothing to change: the slides are already like that.' };
  const lst = child(pres.documentElement, P, 'sldIdLst');
  for (const s of slides) remove(s.el);
  for (const s of order) lst.appendChild(s.el);
  for (const s of gone) pkg.removeRel(main, s.rid);
  const goneRids = new Set(gone.map((s) => s.rid)), goneParts = new Set(gone.map((s) => s.part));
  for (const e of all(pres, P, 'sld')) if (goneRids.has(attr(e, R, 'id'))) remove(e);
  const sections = sectionList(pres);
  if (sections) {
    const reordered = order.some((s, i) => i && slides.indexOf(s) < slides.indexOf(order[i - 1]));
    if (reordered) remove(all(pres, P, 'ext').find((e) => e.getAttribute('uri') === SECTIONS));
    else for (const e of all(sections, P14, 'sldId')) if (!keptIds.has(Number(e.getAttribute('id')))) remove(e);
  }
  // Links to slides that are gone go too.
  for (const s of order) for (const r of pkg.rels(s.part)) if (r.type === 'slide' && goneParts.has(r.target)) {
    pkg.removeRel(s.part, r.id);
    for (const n of ['hlinkClick', 'hlinkHover']) for (const e of all(pkg.dom(s.part), A, n)) if (attr(e, R, 'id') === r.id) remove(e);
  }
  pkg.prune();
  slideCount(pkg);
  const out = ctx.out.file(file, `${U.base(file)}-slides.${U.ext(file)}`);
  await pkg.save(out);
  return { path: out, note: `${order.length} of ${slides.length} slides kept${gone.length ? `, ${gone.length} removed` : ''}` };
}

module.exports = { readDeck, exportNotes, mergeDecks, pickSlides, slideList, openDeck, PPT_EXT };
