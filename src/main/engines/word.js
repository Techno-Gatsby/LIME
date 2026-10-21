'use strict';
// Word documents as Word itself edits them: tracked changes accepted or rejected, two versions compared into tracked
// changes, mail merge, statistics, splitting at headings and watermarks, all on the document's own XML so formatting,
// pictures and everything else Lime doesn't touch stay as they were. Works without LibreOffice.
const U = require('./util');
const { fsp, path } = U;
const O = require('./opc');
const { NS, all, kids, child, up, remove, unwrap, rename, make, attr, is } = O;
const W = NS.w;
const office = () => require('./office');

const WORD_EXT = ['docx', 'docm', 'dotx', 'dotm'];
const STORY = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
const stories = (pkg, withNotes = true) => pkg.list(STORY).filter((n) => withNotes || /document\.xml$/.test(n));
const nowStamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

// Any document as a Word file Lime can work on: Word files as they are, others through LibreOffice when it is there,
// or through Lime's own reader.
async function asDocx(file, ctx) {
  const e = U.ext(file);
  if (WORD_EXT.includes(e)) return { file, done: () => {} };
  const dir = await U.tmpDir('docx'), out = path.join(dir, `${U.base(file)}.docx`), done = () => fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  try {
    if (office().libreOfficePath() && !['md', 'markdown', 'txt', 'html', 'htm'].includes(e)) await office().viaLibreOffice(file, 'docx', { ...ctx, progress: () => {} }, { out });
    else {
      const src = await office().readHtml(file);
      if (!src) throw new Error(`Lime can’t read ${e.toUpperCase()} files on this computer without LibreOffice.`);
      await office().htmlToDocx(src.html, U.base(file), out);
    }
    return { file: out, done };
  } catch (err) { done(); throw err; }
}
async function openWord(file) {
  const pkg = await O.Package.open(file), main = pkg.main();
  if (O.familyOf(pkg) !== 'word' || !main) throw new Error(`${path.basename(file)} isn’t a Word document.`);
  return { pkg, main, doc: pkg.dom(main) };
}

// ───────── Runs and their text ─────────
const OBJ = '￼';
function pieceText(c) {
  if (!c || c.nodeType !== 1) return '';
  if (c.namespaceURI !== W) return c.localName === 'AlternateContent' ? OBJ : '';
  switch (c.localName) {
    case 't': return c.textContent || '';
    case 'tab': case 'ptab': return '\t';
    case 'br': case 'cr': return '\n';
    case 'noBreakHyphen': return '‑';
    case 'drawing': case 'pict': case 'object': case 'sym': return OBJ;
    default: return '';
  }
}
// A paragraph's own runs: not those of a text box inside it, nor deleted ones.
const runsOf = (p) => all(p, W, 'r').filter((r) => up(r, W, 'p') === p && !up(r, W, ['del', 'moveFrom']));
const runText = (r) => kids(r).map(pieceText).join('');
const paraText = (p) => runsOf(p).map(runText).join('');
function spans(p) {
  let pos = 0;
  return runsOf(p).map((run) => { const len = runText(run).length, s = { run, start: pos, end: pos + len }; pos += len; return s; });
}
// Splits a run at k characters in, leaving the first part in place; returns the second part.
function splitRun(run, k) {
  const right = run.cloneNode(true);
  const cut = (r, left) => {
    let pos = 0;
    for (const c of kids(r)) {
      if (is(c, W, 'rPr')) continue;
      const t = pieceText(c), s = pos, e = pos + t.length;
      pos = e;
      if (left ? e <= k && (e > s || s < k) : s >= k) continue;
      if (s < k && k < e && is(c, W, 't')) O.segment(c).set(left ? t.slice(0, k - s) : t.slice(k - s));
      else remove(c);
    }
  };
  cut(run, true);
  cut(right, false);
  O.after(run, right);
  return right;
}
function splitAt(p, pos) {
  const s = spans(p).find((x) => x.start < pos && pos < x.end);
  if (s) splitRun(s.run, pos - s.start);
}
let revId = 9000;
const revAttrs = (meta) => ({ 'w:id': String(++revId), 'w:author': meta.author, 'w:date': meta.date });
const outside = (n) => { while (is(n.parentNode, W, ['ins', 'del'])) n = n.parentNode; return n; };
// Wraps the characters a..b of a paragraph in a tracked insertion.
function markInserted(p, a, b, meta) {
  splitAt(p, a);
  splitAt(p, b);
  let wrap = null;
  for (const s of spans(p)) {
    if (s.start < a || s.end > b || s.end === s.start) continue;
    if (wrap && wrap.parentNode === s.run.parentNode && wrap.nextSibling === s.run) { wrap.appendChild(s.run); continue; }
    wrap = make(p.ownerDocument, W, 'w:ins', revAttrs(meta));
    s.run.parentNode.insertBefore(wrap, s.run);
    wrap.appendChild(s.run);
  }
}
function deletedRun(doc, text, rPr) {
  const r = make(doc, W, 'w:r');
  if (rPr) r.appendChild(rPr.cloneNode(true));
  for (const part of text.split(/([\t\n])/)) {
    if (part === '\t') r.appendChild(make(doc, W, 'w:tab'));
    else if (part === '\n') r.appendChild(make(doc, W, 'w:br'));
    else if (part.replace(new RegExp(OBJ, 'g'), '')) r.appendChild(make(doc, W, 'w:delText', { 'xml:space': 'preserve' }, part.replace(new RegExp(OBJ, 'g'), '')));
  }
  return r;
}
// Puts deleted text back at a position of a paragraph, as a tracked deletion in the formatting around it.
function insertDeleted(p, pos, text, meta) {
  splitAt(p, pos);
  const list = spans(p), at = list.find((s) => s.start === pos && s.end > s.start) || list.find((s) => s.start >= pos), before = [...list].reverse().find((s) => s.end <= pos && s.end > s.start);
  const rPr = child((before || at || {}).run || p, W, 'rPr');
  const del = make(p.ownerDocument, W, 'w:del', revAttrs(meta), deletedRun(p.ownerDocument, text, rPr));
  if (at) { const ref = outside(at.run); ref.parentNode.insertBefore(del, ref); } else if (before) O.after(outside(before.run), del); else p.appendChild(del);
}
function markParagraph(p, kind, meta) {
  let pPr = child(p, W, 'pPr');
  if (!pPr) { pPr = make(p.ownerDocument, W, 'w:pPr'); p.insertBefore(pPr, p.firstChild); }
  let rPr = child(pPr, W, 'rPr');
  if (!rPr) { rPr = make(p.ownerDocument, W, 'w:rPr'); pPr.insertBefore(rPr, child(pPr, W, 'sectPr') || child(pPr, W, 'pPrChange')); }
  rPr.insertBefore(make(p.ownerDocument, W, `w:${kind}`, revAttrs(meta)), rPr.firstChild);
}
function insertedParagraph(p, meta) {
  let wrap = null;
  for (const run of runsOf(p)) {
    if (wrap && wrap.nextSibling === run) { wrap.appendChild(run); continue; }
    wrap = make(p.ownerDocument, W, 'w:ins', revAttrs(meta));
    run.parentNode.insertBefore(wrap, run);
    wrap.appendChild(run);
  }
  markParagraph(p, 'ins', meta);
}
// A paragraph of the older document brought into the newer one as deleted: its own formatting kept, anything that
// points into the older file (pictures, links, notes, comments, numbering) left out.
function deletedParagraph(doc, old, meta) {
  const p = doc.importNode(old, true);
  for (const n of ['hyperlink', 'fldSimple', 'smartTag', 'customXml', 'sdt', 'sdtContent']) for (const e of all(p, W, n)) if (e.parentNode) unwrap(e);
  for (const n of ['drawing', 'pict', 'object', 'footnoteReference', 'endnoteReference', 'commentReference', 'commentRangeStart', 'commentRangeEnd', 'bookmarkStart', 'bookmarkEnd', 'numPr', 'sectPr', 'sdtPr', 'sdtEndPr', 'ins', 'del', 'rPrChange', 'pPrChange']) for (const e of all(p, W, n)) remove(e);
  for (const e of all(p, '*', '*')) for (const a of Array.from(e.attributes)) if (a.namespaceURI === NS.r) e.removeAttributeNode(a);
  for (const t of all(p, W, 't')) rename(t, 'w:delText');
  for (const t of all(p, W, 'instrText')) rename(t, 'w:delInstrText');
  let wrap = null;
  for (const run of all(p, W, 'r').filter((r) => up(r, W, 'p') === p)) {
    if (wrap && wrap.nextSibling === run) { wrap.appendChild(run); continue; }
    wrap = make(doc, W, 'w:del', revAttrs(meta));
    run.parentNode.insertBefore(wrap, run);
    wrap.appendChild(run);
  }
  markParagraph(p, 'del', meta);
  return p;
}

// ───────── Accepting and rejecting tracked changes ─────────
const PROP_CHANGES = ['rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'tblGridChange', 'trPrChange', 'tcPrChange', 'tblPrExChange', 'numberingChange'];
const KEEP_ON_RESTORE = { pPr: ['rPr', 'sectPr'], sectPr: ['headerReference', 'footerReference'] };
// The properties before a formatting change, put back.
function restoreProps(change) {
  const old = kids(change)[0], parent = change.parentNode, keep = KEEP_ON_RESTORE[parent.localName] || [];
  for (const c of kids(parent)) if (c !== change && !keep.includes(c.localName)) remove(c);
  const at = kids(parent).find((c) => c !== change) || change;
  if (old) while (old.firstChild) parent.insertBefore(old.firstChild, at);
}
// A paragraph whose mark is gone runs on into the next paragraph; an empty one simply goes.
function joinNext(p) {
  if (!p.parentNode) return;
  const own = kids(p).filter((c) => !is(c, W, 'pPr')), hasRuns = own.some((c) => is(c, W, 'r') || all(c, W, 'r').length);
  let next = p.nextSibling;
  while (next && next.nodeType !== 1) next = next.nextSibling;
  if (child(child(p, W, 'pPr') || p, W, 'sectPr')) return;
  if (!is(next, W, 'p')) { if (!hasRuns && (!is(p.parentNode, W, 'tc') || kids(p.parentNode, W, 'p').length > 1)) remove(p); return; }
  const at = child(next, W, 'pPr') ? child(next, W, 'pPr').nextSibling : next.firstChild;
  for (const c of own) next.insertBefore(c, at);
  remove(p);
}
// Accepts (or rejects) every tracked change in one Word part. Returns how many there were, by author.
function settleWord(doc, accept) {
  const st = { changes: 0, authors: new Map() };
  const note = (e) => { st.changes++; const a = attr(e, W, 'author') || 'Unknown'; st.authors.set(a, (st.authors.get(a) || 0) + 1); };
  const gone = accept ? ['del', 'moveFrom'] : ['ins', 'moveTo'], kept = accept ? ['ins', 'moveTo'] : ['del', 'moveFrom'];
  const joins = [];
  for (const name of [...gone, ...kept]) for (const e of all(doc, W, name)) {
    const parent = e.parentNode;
    if (is(parent, W, 'rPr') && is(parent.parentNode, W, 'pPr')) { note(e); if (gone.includes(name)) joins.push(parent.parentNode.parentNode); remove(e); } else if (is(parent, W, ['rPr', 'trPr'])) { note(e); if (gone.includes(name)) remove(parent.parentNode); else remove(e); }
  }
  for (const n of ['cellIns', 'cellDel', 'cellMerge']) for (const e of all(doc, W, n)) { note(e); if ((n === 'cellIns' && !accept) || (n === 'cellDel' && accept)) remove(up(e, W, 'tc')); else remove(e); }
  for (const name of gone) for (const e of all(doc, W, name)) if (e.parentNode) { note(e); remove(e); }
  for (const name of kept) for (const e of all(doc, W, name)) {
    if (!e.parentNode) continue;
    note(e);
    for (const t of all(e, W, 'delText')) rename(t, 'w:t');
    for (const t of all(e, W, 'delInstrText')) rename(t, 'w:instrText');
    unwrap(e);
  }
  for (const n of ['moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd']) all(doc, W, n).forEach(remove);
  for (const n of PROP_CHANGES) for (const e of all(doc, W, n)) { note(e); if (!accept && n !== 'numberingChange') restoreProps(e); remove(e); }
  for (const p of joins) joinNext(p);
  return st;
}

// OpenDocument keeps deleted text in a list at the top and marks where insertions start and end.
function settleOdf(doc, accept) {
  const T = NS.text, st = { changes: 0, authors: new Map() }, regions = new Map();
  for (const r of all(doc, T, 'changed-region')) {
    const id = attr(r, T, 'id') || r.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id'), kind = kids(r)[0];
    if (!kind) continue;
    regions.set(id, kind);
    const who = all(kind, NS.dc, 'creator')[0]?.textContent || 'Unknown';
    st.changes++;
    st.authors.set(who, (st.authors.get(who) || 0) + 1);
  }
  const marks = (name) => new Map(all(doc, T, name).map((m) => [attr(m, T, 'change-id'), m]));
  const starts = marks('change-start'), ends = marks('change-end');
  for (const [id, s] of starts) {
    const e = ends.get(id), kind = regions.get(id);
    if (!accept && kind?.localName === 'insertion' && e) removeBetween(s, e); else { remove(s); remove(e); }
  }
  for (const [id, m] of marks('change')) {
    const kind = regions.get(id);
    if (!accept && kind?.localName === 'deletion') restoreDeleted(m, kids(kind).filter((c) => !is(c, NS.office, 'change-info')));
    remove(m);
  }
  all(doc, T, 'tracked-changes').forEach(remove);
  return st;
}
const PARA = (n) => up(n, NS.text, ['p', 'h']);
function removeBetween(a, b) {
  if (a.parentNode === b.parentNode) { while (a.nextSibling && a.nextSibling !== b) remove(a.nextSibling); remove(a); remove(b); return; }
  const pa = PARA(a), pb = PARA(b);
  if (!pa || !pb) { remove(a); remove(b); return; }
  for (let n = a; n !== pa; n = n.parentNode) while (n.nextSibling) remove(n.nextSibling);
  for (let n = b; n !== pb; n = n.parentNode) while (n.previousSibling) remove(n.previousSibling);
  if (pa.parentNode === pb.parentNode) while (pa.nextSibling && pa.nextSibling !== pb) remove(pa.nextSibling);
  remove(a); remove(b);
  while (pb.firstChild) pa.appendChild(pb.firstChild);
  remove(pb);
}
function restoreDeleted(marker, content) {
  if (!content.length) return;
  const isPara = (n) => is(n, NS.text, ['p', 'h']), doc = marker.ownerDocument;
  const copy = content.map((c) => c.cloneNode(true));
  if (copy.length === 1 && isPara(copy[0])) { while (copy[0].firstChild) marker.parentNode.insertBefore(copy[0].firstChild, marker); return; }
  const p = PARA(marker);
  if (!p) return;
  let top = marker;
  while (top.parentNode !== p) top = top.parentNode;
  const tail = p.cloneNode(false);
  while (top.nextSibling) tail.appendChild(top.nextSibling);
  let at = p;
  copy.forEach((c, i) => {
    if (i === 0 && isPara(c)) { while (c.firstChild) marker.parentNode.insertBefore(c.firstChild, marker); return; }
    if (i === copy.length - 1 && isPara(c)) { while (c.lastChild) tail.insertBefore(c.lastChild, tail.firstChild); return; }
    at = O.after(at, doc.importNode(c, true));
  });
  O.after(at, tail);
}

function summary(st) {
  const who = [...st.authors].sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} (${n})`).join(', ');
  return `${st.changes} change${st.changes === 1 ? '' : 's'}${who ? ` by ${who}` : ''}`;
}
async function trackChanges(file, o, ctx) {
  const accept = o.action !== 'reject', pkg = await O.Package.open(file), st = { changes: 0, authors: new Map() };
  const add = (s) => { st.changes += s.changes; for (const [a, n] of s.authors) st.authors.set(a, (st.authors.get(a) || 0) + n); };
  if (pkg.odf) for (const n of ['content.xml', 'styles.xml']) { if (pkg.has(n)) add(settleOdf(pkg.dom(n), accept)); } else {
    if (O.familyOf(pkg) !== 'word') throw new Error(`${path.basename(file)} isn’t a Word or OpenDocument text file.`);
    for (const n of pkg.list(/^word\/[^/]+\.xml$/)) if (/<w:(ins|del|moveFrom|moveTo|rPrChange|pPrChange|sectPrChange|tblPrChange|tblGridChange|trPrChange|tcPrChange|tblPrExChange|cellIns|cellDel)\b/.test(pkg.text(n))) add(settleWord(pkg.dom(n), accept));
    if (o.stopTracking !== false && pkg.has('word/settings.xml')) all(pkg.dom('word/settings.xml'), W, 'trackRevisions').forEach(remove);
  }
  if (!st.changes) return { note: 'This document has no tracked changes.' };
  const out = ctx.out.file(file, `${U.base(file)}-${accept ? 'accepted' : 'rejected'}.${U.ext(file)}`);
  await pkg.save(out);
  return { path: out, note: `${accept ? 'Accepted' : 'Rejected'} ${summary(st)}` };
}

// ───────── Compare ─────────
// Myers' difference algorithm, giving up past `cap` edits (two unrelated texts) so it stays fast and small.
function diff(a, b, eq = (x, y) => x === y, cap = 4000) {
  let lo = 0, hiA = a.length, hiB = b.length;
  while (lo < hiA && lo < hiB && eq(a[lo], b[lo])) lo++;
  while (hiA > lo && hiB > lo && eq(a[hiA - 1], b[hiB - 1])) { hiA--; hiB--; }
  const A = a.slice(lo, hiA), B = b.slice(lo, hiB), N = A.length, M = B.length, max = N + M;
  const ops = [];
  for (let i = 0; i < lo; i++) ops.push(['=', i, i]);
  const tail = () => { for (let i = 0; i < a.length - hiA; i++) ops.push(['=', hiA + i, hiB + i]); return ops; };
  if (!max) return tail();
  const V = new Int32Array(2 * max + 3), off = max + 1, trace = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, cap) && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1, y = x - k;
      while (x < N && y < M && eq(A[x], B[y])) { x++; y++; }
      V[off + k] = x;
      if (x >= N && y >= M) { found = d; break; }
    }
    trace.push(V.slice(off - d, off + d + 1));
  }
  const mid = [];
  if (found < 0) {
    for (let i = 0; i < N; i++) mid.push(['-', lo + i, null]);
    for (let j = 0; j < M; j++) mid.push(['+', null, lo + j]);
  } else {
    let x = N, y = M;
    for (let d = found; d > 0; d--) {
      const prev = trace[d - 1], get = (k) => prev[k + d - 1], k = x - y;
      const down = k === -d || (k !== d && get(k - 1) < get(k + 1)), pk = down ? k + 1 : k - 1, px = get(pk), py = px - pk;
      const xm = down ? px : px + 1, ym = down ? py + 1 : py;
      while (x > xm && y > ym) mid.push(['=', lo + --x, lo + --y]);
      mid.push(down ? ['+', null, lo + py] : ['-', lo + px, null]);
      x = px; y = py;
    }
    while (x > 0 && y > 0) mid.push(['=', lo + --x, lo + --y]);
    mid.reverse();
  }
  ops.push(...mid);
  return tail();
}
// Words for comparing: a number like 1,284.50 or 2026-04-19 and a word like don’t are one each.
const WORDS = /\p{N}+(?:[.,:/-]\p{N}+)*|[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}]+)*|\s+|[^\p{L}\p{M}\p{N}_\s]/gu;
const tokens = (t, chars) => (chars ? Array.from(t) : t.match(WORDS) || []);
// How alike two paragraphs are, the way LibreOffice's document comparison judges it: lengths within three times
// each other, and enough text in long common stretches (the sum of their squared lengths).
function alike(a, b, o) {
  const la = a.length, lb = b.length;
  if (!la || !lb) return la === lb;
  if (Math.min(la, lb) * 3 < Math.max(la, lb)) return false;
  const ta = tokens(a, false), tb = tokens(b, false), key = o.key;
  const ops = diff(ta.map(key), tb.map(key), undefined, 400);
  let sq = 0, run = 0;
  for (const [op, i] of ops) { if (op === '=') run += ta[i].length; else { sq += run * run; run = 0; } }
  sq += run * run;
  const avg = (la + lb) / 2;
  return !(avg >= 8 && sq * 32 < avg * avg);
}
// Pairs the paragraphs of a changed stretch that look like versions of each other (longest common subsequence).
function pairUp(oldIdx, newIdx, sim) {
  const n = oldIdx.length, m = newIdx.length;
  if (!n || !m || n * m > 40000) return [...oldIdx.map((i) => ['-', i, null]), ...newIdx.map((j) => ['+', null, j])];
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1)), ok = (i, j) => sim(oldIdx[i], newIdx[j]);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = Math.max(L[i + 1][j], L[i][j + 1], ok(i, j) ? L[i + 1][j + 1] + 1 : 0);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ok(i, j) && L[i][j] === L[i + 1][j + 1] + 1) { out.push(['~', oldIdx[i++], newIdx[j++]]); continue; }
    if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) out.push(['-', oldIdx[i++], null]); else out.push(['+', null, newIdx[j++]]);
  }
  return out;
}
// Everything that differs between two paragraph lists, in document order: '=' same, '~' changed, '-' gone, '+' new.
function comparePlan(oldT, newT, o) {
  const ops = diff(oldT.map(o.key), newT.map(o.key)), plan = [];
  const sim = (i, j) => alike(oldT[i], newT[j], o);
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] === '=') { plan.push(ops[k++]); continue; }
    const dels = [], ins = [];
    while (k < ops.length && ops[k][0] !== '=') { const [op, i, j] = ops[k++]; if (op === '-') dels.push(i); else ins.push(j); }
    plan.push(...pairUp(dels, ins, sim));
  }
  return plan;
}
// Word- (or character-) level edits turning one paragraph into the other: kept, inserted and deleted stretches.
function inline(a, b, o) {
  const ta = tokens(a, o.chars), tb = tokens(b, o.chars);
  const out = [];
  const push = (kind, text) => { const last = out[out.length - 1]; if (last && last.kind === kind) last.text += text; else out.push({ kind, text }); };
  for (const [op, i, j] of diff(ta.map(o.key), tb.map(o.key))) push(op === '=' ? '=' : op === '-' ? 'del' : 'ins', op === '-' ? ta[i] : tb[j]);
  return out;
}
function storyParagraphs(doc) {
  const body = all(doc, W, 'body')[0];
  return body ? all(body, W, 'p').filter((p) => !up(p, W, 'p')) : [];
}
function headingLevels(pkg) {
  const levels = {}, d = pkg.dom('word/styles.xml');
  if (!d) return levels;
  const styles = all(d, W, 'style').filter((s) => attr(s, W, 'type') === 'paragraph'), byId = new Map(styles.map((s) => [attr(s, W, 'styleId'), s]));
  const own = (s) => {
    const name = attr(child(s, W, 'name'), W, 'val').toLowerCase(), m = /^heading\s*(\d)$/.exec(name);
    if (m) return Number(m[1]);
    if (name === 'title') return 1;
    const ol = child(child(s, W, 'pPr') || s, W, 'outlineLvl');
    return ol && Number(attr(ol, W, 'val')) < 9 ? Number(attr(ol, W, 'val')) + 1 : 0;
  };
  for (const [id, s] of byId) {
    let lv = 0;
    for (let x = s, n = 0; x && !lv && n < 10; n++) { lv = own(x); x = byId.get(attr(child(x, W, 'basedOn'), W, 'val')); }
    if (lv) levels[id] = lv;
  }
  return levels;
}
function levelOf(p, levels) {
  const pPr = child(p, W, 'pPr'), ol = child(pPr || p, W, 'outlineLvl');
  if (ol && Number(attr(ol, W, 'val')) < 9) return Number(attr(ol, W, 'val')) + 1;
  return levels[attr(child(pPr || p, W, 'pStyle'), W, 'val')] || 0;
}

async function compare(files, o, ctx) {
  const [older, newer] = files;
  ctx.progress?.(0.05, 'Reading both versions');
  const [ao, an] = [await asDocx(older, ctx), await asDocx(newer, ctx)];
  try {
    const A = await openWord(ao.file), B = await openWord(an.file);
    for (const x of [A, B]) for (const n of stories(x.pkg)) settleWord(x.pkg.dom(n), true);
    const props = B.pkg.dom('docProps/core.xml');
    const meta = { author: String(o.author || '').trim() || all(props || B.doc, NS.cp, 'lastModifiedBy')[0]?.textContent || all(props || B.doc, NS.dc, 'creator')[0]?.textContent || 'Lime', date: nowStamp() };
    revId = Math.max(9000, ...(B.pkg.text(B.main).match(/w:id="(\d+)"/g) || []).map((s) => Number(/\d+/.exec(s)[0]) + 1));
    const OP = storyParagraphs(A.doc), NP = storyParagraphs(B.doc), oldT = OP.map(paraText), newT = NP.map(paraText);
    const opt = { ignoreCase: !!o.ignoreCase, chars: o.level === 'char', key: (t) => (o.ignoreCase ? t.toLowerCase() : t) };
    ctx.progress?.(0.3, 'Comparing');
    const plan = comparePlan(oldT, newT, opt);
    const levels = headingLevels(B.pkg), oldLevels = headingLevels(A.pkg), html = [];
    const body = all(B.doc, W, 'body')[0], inTable = (p) => !!up(p, W, 'tc');
    let ins = 0, del = 0, cursor = null;
    const nextNew = plan.map((_, k) => plan.slice(k + 1).find((x) => x[2] != null)?.[2] ?? null);
    const tag = (lv) => (lv ? `h${Math.min(lv, 4)}` : 'p');
    plan.forEach(([op, i, j], k) => {
      if (op === '=') { cursor = NP[j]; html.push(`<${tag(levelOf(NP[j], levels))}>${O.xmlEsc(newT[j])}</${tag(levelOf(NP[j], levels))}>`); return; }
      if (op === '+') { ins++; insertedParagraph(NP[j], meta); cursor = NP[j]; html.push(`<${tag(levelOf(NP[j], levels))}><ins>${O.xmlEsc(newT[j]) || '¶'}</ins></${tag(levelOf(NP[j], levels))}>`); return; }
      if (op === '-') {
        del++;
        const p = deletedParagraph(B.doc, OP[i], meta), next = nextNew[k] != null ? NP[nextNew[k]] : null;
        if (cursor && !(next && inTable(cursor) !== inTable(OP[i]) && inTable(next) === inTable(OP[i]))) O.after(cursor, p);
        else if (next) next.parentNode.insertBefore(p, next);
        else body.insertBefore(p, child(body, W, 'sectPr'));
        cursor = p;
        html.push(`<${tag(levelOf(OP[i], oldLevels))}><del>${O.xmlEsc(oldT[i]) || '¶'}</del></${tag(levelOf(OP[i], oldLevels))}>`);
        return;
      }
      cursor = NP[j];
      const parts = inline(oldT[i], newT[j], opt), edits = [];
      let pos = 0;
      for (const s of parts) {
        if (s.kind === 'del') { edits.push({ at: pos, del: s.text }); continue; }
        if (s.kind === 'ins') edits.push({ at: pos, end: pos + s.text.length });
        pos += s.text.length;
      }
      for (const e of edits.sort((x, y) => y.at - x.at || (x.del ? 1 : -1))) { if (e.del != null) { del++; insertDeleted(NP[j], e.at, e.del, meta); } else { ins++; markInserted(NP[j], e.at, e.end, meta); } }
      html.push(`<${tag(levelOf(NP[j], levels))}>${parts.map((s) => (s.kind === '=' ? O.xmlEsc(s.text) : `<${s.kind}>${O.xmlEsc(s.text)}</${s.kind}>`)).join('')}</${tag(levelOf(NP[j], levels))}>`);
    });
    const note = !ins && !del ? 'The two versions have the same text.' : `${ins} insertion${ins === 1 ? '' : 's'} and ${del} deletion${del === 1 ? '' : 's'}`;
    ctx.progress?.(0.8, 'Writing');
    if (o.output === 'pdf') {
      const out = ctx.out.file(newer, `${U.base(newer)} - compared.pdf`);
      const head = `<div class="cmp">Changes from <b>${O.xmlEsc(path.basename(older))}</b> to <b>${O.xmlEsc(path.basename(newer))}</b>: ${note.replace(/\.$/, '')}.</div>`;
      const css = 'ins{color:#1d6f2b;background:#e3f5dc;text-decoration:underline}del{color:#b3261e;background:#fbe4e2}.cmp{font-size:9pt;color:#4b5443;border-bottom:1px solid #cfd5c8;padding-bottom:6pt;margin-bottom:12pt}p{margin:0 0 8pt;white-space:pre-wrap}';
      await office().htmlToPdf(`<!doctype html><html><head><meta charset="utf-8"><style>body{font:11pt/1.5 -apple-system,"Helvetica Neue","Segoe UI",Arial,sans-serif;color:#1d2117}${css}</style></head><body>${head}${html.join('')}</body></html>`, out, ctx, { pageSize: 'A4', margins: { top: 0.8, right: 0.8, bottom: 0.8, left: 0.8 } });
      return { path: out, note };
    }
    const out = ctx.out.file(newer, `${U.base(newer)} - compared.docx`);
    await B.pkg.save(out);
    return { path: out, note };
  } finally { ao.done(); an.done(); }
}

// ───────── Mail merge ─────────
const fieldKey = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
async function mergeData(file) {
  const XLSX = require('xlsx'), wb = office().readBook(file);
  const ws = wb.SheetNames.map((n) => wb.Sheets[n]).find((s) => Object.keys(s).some((k) => k[0] !== '!'));
  if (!ws) throw new Error(`${path.basename(file)} has no rows to merge.`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).map((r) => r.map((v) => String(v ?? '')));
  const head = (rows.shift() || []).map((h) => h.trim());
  const records = rows.filter((r) => r.some((v) => v.trim())).map((r) => Object.fromEntries(head.map((h, i) => [fieldKey(h), r[i] ?? ''])));
  if (!head.some(Boolean) || !records.length) throw new Error(`${path.basename(file)} needs a header row and at least one row of data.`);
  return { head, records };
}
const MERGEFIELD = /^\s*MERGEFIELD\s+(?:"([^"]+)"|(\S+))/i;
// Fills one copy of the template: Word merge fields (simple and complex) and «Name» or {{Name}} placeholders.
function fillWord(pkg, rec, missing) {
  const value = (name) => { const k = fieldKey(name); if (k in rec) return rec[k]; missing.add(name.trim()); return null; };
  let filled = 0;
  for (const n of stories(pkg)) {
    const doc = pkg.dom(n);
    for (const f of all(doc, W, 'fldSimple')) {
      const m = MERGEFIELD.exec(attr(f, W, 'instr'));
      if (!m) continue;
      const v = value(m[1] || m[2]) ?? '', ts = all(f, W, 't');
      if (ts.length) { O.segment(ts[0]).set(v); ts.slice(1).forEach((t) => O.segment(t).set('')); } else f.appendChild(make(doc, W, 'w:r', {}, make(doc, W, 'w:t', { 'xml:space': 'preserve' }, v)));
      unwrap(f);
      filled++;
    }
    const runs = all(doc, W, 'r');
    for (let i = 0; i < runs.length; i++) {
      const begin = all(runs[i], W, 'fldChar').find((c) => attr(c, W, 'fldCharType') === 'begin');
      if (!begin) continue;
      let depth = 0, k = i, instr = '', sep = -1, end = -1;
      for (; k < runs.length; k++) {
        for (const c of kids(runs[k])) {
          const t = is(c, W, 'fldChar') ? attr(c, W, 'fldCharType') : '';
          if (t === 'begin') depth++;
          else if (t === 'separate' && depth === 1) sep = k;
          else if (t === 'end' && --depth === 0) end = k;
          else if (is(c, W, 'instrText') && depth === 1 && sep < 0) instr += c.textContent;
        }
        if (end >= 0) break;
      }
      const m = MERGEFIELD.exec(instr);
      if (!m || end < 0) continue;
      const v = value(m[1] || m[2]) ?? '', result = sep >= 0 ? runs.slice(sep + 1, end) : [], ts = result.flatMap((r) => all(r, W, 't'));
      if (ts.length) { O.segment(ts[0]).set(v); ts.slice(1).forEach((t) => O.segment(t).set('')); } else { const r = make(doc, W, 'w:r', {}, make(doc, W, 'w:t', { 'xml:space': 'preserve' }, v)); const rPr = child(runs[i], W, 'rPr'); if (rPr) r.insertBefore(rPr.cloneNode(true), r.firstChild); runs[i].parentNode.insertBefore(r, runs[i]); }
      for (const r of [...runs.slice(i, sep >= 0 ? sep + 1 : end), runs[end]]) remove(r);
      filled++;
      i = end;
    }
    for (const { segs } of O.paragraphs(doc)) filled += O.replaceAcross(segs, /«\s*([^«»]+?)\s*»|\{\{\s*([^{}]+?)\s*\}\}/gu, (m) => value(m[1] || m[2]) ?? m[0]);
    // Line breaks in the data become line breaks in the document.
    for (const t of all(doc, W, 't')) if (/\n/.test(t.textContent)) {
      const parts = t.textContent.replace(/\r\n?/g, '\n').split('\n');
      O.segment(t).set(parts[0]);
      let at = t;
      for (const part of parts.slice(1)) { at = O.after(at, make(doc, W, 'w:br')); at = O.after(at, make(doc, W, 'w:t', { 'xml:space': 'preserve' }, part)); }
    }
  }
  const settings = pkg.dom('word/settings.xml');
  if (settings) all(settings, W, 'mailMerge').forEach(remove);
  return filled;
}
// Several filled copies one after another in one document, each starting on a new page with the template's own
// page setup.
function joinCopies(copies) {
  const base = copies[0], doc = base.pkg.dom(base.main), body = all(doc, W, 'body')[0], sect = child(body, W, 'sectPr');
  copies.forEach((c, n) => {
    const d = c.pkg.dom(c.main), b = all(d, W, 'body')[0];
    if (n) {
      for (const e of [...all(d, W, 'bookmarkStart'), ...all(d, W, 'bookmarkEnd')]) e.setAttributeNS(W, 'w:id', String(Number(attr(e, W, 'id')) + n * 100000));
      for (const e of kids(b)) if (!is(e, W, 'sectPr')) body.insertBefore(doc.importNode(e, true), sect);
    }
    const last = kids(body).filter((e) => !is(e, W, 'sectPr')).pop();
    if (n < copies.length - 1 && sect) {
      let p = last;
      if (!is(p, W, 'p')) { p = make(doc, W, 'w:p'); body.insertBefore(p, sect); }
      let pPr = child(p, W, 'pPr');
      if (!pPr) { pPr = make(doc, W, 'w:pPr'); p.insertBefore(pPr, p.firstChild); }
      const s = sect.cloneNode(true);
      for (const t of kids(s, W, 'type')) remove(t);
      s.insertBefore(make(doc, W, 'w:type', { 'w:val': 'nextPage' }), kids(s).find((x) => !is(x, W, ['headerReference', 'footerReference', 'footnotePr', 'endnotePr'])) || null);
      pPr.appendChild(s);
    }
  });
  let id = 1;
  for (const e of all(doc, 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'docPr')) e.setAttribute('id', String(id++));
  all(doc, W, 'bookmarkStart').forEach((e, k) => { if (k) e.setAttributeNS(W, 'w:name', `${attr(e, W, 'name')}_${k}`); });
  return base.pkg;
}
async function mailMerge(file, o, ctx) {
  if (!o.data) throw new Error('Choose the list of names and details to merge (CSV or Excel).');
  const { head, records } = await mergeData(o.data);
  if (records.length > 5000) throw new Error(`The list has ${records.length} rows; Lime merges up to 5,000 at a time.`);
  const src = await asDocx(file, ctx);
  try {
    const tpl = await openWord(src.file), missing = new Set(), copies = [];
    let filled = 0;
    records.forEach((rec, i) => {
      const pkg = tpl.pkg.clone();
      filled += fillWord(pkg, rec, missing);
      copies.push({ pkg, main: tpl.main, rec, n: i + 1 });
      ctx.progress?.(0.1 + (0.4 * i) / records.length, 'Merging');
    });
    if (!filled) throw new Error(`The document has no merge fields. Put «Name» or {{Name}} where each column of ${path.basename(o.data)} should go (${head.filter(Boolean).slice(0, 3).join(', ')}…).`);
    const note = `${records.length} ${records.length === 1 ? 'copy' : 'copies'}${missing.size ? `; no column for ${[...missing].slice(0, 4).map((m) => `“${m}”`).join(', ')}` : ''}`;
    const to = o.to === 'pdf' ? 'pdf' : 'docx';
    const asPdf = async (docx, out) => { const r = await office().convertDocument(docx, { to: 'pdf' }, { ...ctx, progress: () => {}, out: { ...ctx.out, file: () => out } }); return typeof r === 'string' ? r : r.path; };
    if (o.combine === 'one') {
      const pkg = joinCopies(copies), out = ctx.out.file(file, `${U.base(file)} - merged.${to}`);
      if (to === 'docx') { await pkg.save(out); return { path: out, note }; }
      const tmp = path.join(await U.tmpDir('merge'), `${U.base(file)} - merged.docx`);
      try { await pkg.save(tmp); ctx.progress?.(0.7, 'Making the PDF'); await asPdf(tmp, out); } finally { fsp.rm(path.dirname(tmp), { recursive: true, force: true }).catch(() => {}); }
      return { path: out, note };
    }
    const folder = ctx.out.folder(file, `${U.base(file)} - merged`), used = new Set(), tmp = to === 'pdf' ? await U.tmpDir('merge') : null;
    const nameOf = (c) => {
      const want = String(o.name || '').trim();
      let n = want ? want.replace(/\{\s*([^{}]+?)\s*\}/g, (m, k) => c.rec[fieldKey(k)] ?? m) : `${U.base(file)} ${String(c.n).padStart(String(records.length).length, '0')}`;
      n = U.sanitize(n.replace(/\s+/g, ' ').trim()) || String(c.n);
      let u = n;
      for (let k = 2; used.has(u.toLowerCase()); k++) u = `${n} ${k}`;
      used.add(u.toLowerCase());
      return u;
    };
    try {
      for (const [i, c] of copies.entries()) {
        const name = nameOf(c);
        ctx.progress?.(0.5 + (0.5 * i) / copies.length, `Saving ${i + 1} of ${copies.length}`);
        if (to === 'docx') await c.pkg.save(path.join(folder, `${name}.docx`));
        else { const d = path.join(tmp, `${i}.docx`); await c.pkg.save(d); await asPdf(d, path.join(folder, `${name}.pdf`)); }
      }
    } finally { if (tmp) fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
    return { path: folder, note };
  } finally { src.done(); }
}

// ───────── Statistics ─────────
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/u;
function countWords(t) {
  let n = 0;
  for (const chunk of t.split(/\s+/)) {
    if (!chunk) continue;
    const cjk = (chunk.match(new RegExp(CJK.source, 'gu')) || []).length, rest = chunk.replace(new RegExp(CJK.source, 'gu'), ' ').trim();
    n += cjk + (rest ? rest.split(/\s+/).length : 0);
  }
  return n;
}
function syllables(w) {
  w = w.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, (w.match(/[aeiouy]{1,2}/g) || []).length);
}
// Words, characters and readability, counted the way Word's Word Count and Readability Statistics do.
function measure(paras) {
  const text = paras.join('\n'), words = paras.reduce((s, p) => s + countWords(p), 0);
  const latin = text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  const sentences = Math.max(words ? 1 : 0, (text.match(/[^.!?。！？\s][^.!?。！？]*[.!?。！？]+(?=\s|$)/gu) || []).length + (/[^.!?。！？\s]\s*$/u.test(text) ? 1 : 0));
  const syl = latin.reduce((s, w) => s + syllables(w), 0);
  const english = latin.length >= Math.max(10, words * 0.6);
  const wps = sentences ? latin.length / sentences : 0, spw = latin.length ? syl / latin.length : 0;
  return {
    words, characters: [...text.replace(/\n/g, '')].length, charactersNoSpaces: [...text.replace(/\s/g, '')].length, paragraphs: paras.filter((p) => p.trim()).length, sentences,
    wordsPerSentence: sentences ? words / sentences : 0, readingEase: english ? 206.835 - 1.015 * wps - 84.6 * spw : null, grade: english ? 0.39 * wps + 11.8 * spw - 15.59 : null,
  };
}
async function stats(file, o, ctx) {
  const e = U.ext(file);
  let paras = [], extra = {};
  if (WORD_EXT.includes(e)) {
    const { pkg, doc } = await openWord(file), x = pkg.text(pkg.main());
    paras = [...storyParagraphs(doc).map(paraText), ...['word/footnotes.xml', 'word/endnotes.xml'].filter((n) => pkg.has(n)).flatMap((n) => all(pkg.dom(n), W, 'p').map(paraText))].map((t) => t.replace(new RegExp(OBJ, 'g'), ''));
    const app = pkg.text('docProps/app.xml'), levels = headingLevels(pkg);
    extra = { pages: Number((/<Pages>(\d+)<\/Pages>/.exec(app) || [])[1]) || 0, tables: (x.match(/<w:tbl>/g) || []).length, pictures: (x.match(/<w:drawing>|<w:pict>/g) || []).length,
      headings: storyParagraphs(doc).filter((p) => levelOf(p, levels)).length, comments: (pkg.text('word/comments.xml').match(/<w:comment\b/g) || []).length, changes: (x.match(/<w:(ins|del) /g) || []).length };
  } else if (['pptx', 'pptm', 'ppsx', 'potx'].includes(e)) {
    const deck = await require('./slides').readDeck(file);
    paras = deck.slides.flatMap((s) => [...s.title ? [s.title] : [], ...s.body.map((b) => b.text), ...s.notes]);
    extra = { slides: deck.slides.length, pictures: deck.pictures };
  } else if (['odt', 'ott', 'fodt'].includes(e)) {
    const pkg = await O.Package.open(file), doc = pkg.dom('content.xml');
    paras = O.paragraphs(doc).map((p) => p.segs.map((s) => s.get()).join(''));
    const st = all(pkg.dom('meta.xml') || doc, NS.meta, 'document-statistic')[0];
    extra = { pages: Number(attr(st, NS.meta, 'page-count')) || 0, tables: all(doc, NS.table, 'table').length, pictures: all(doc, NS.draw, 'image').length, comments: all(doc, NS.office, 'annotation').length };
  } else {
    const src = await office().readHtml(file);
    if (!src) throw new Error(`Lime can’t read ${e.toUpperCase()} files.`);
    paras = (src.plain ?? office().htmlToText(src.html)).split(/\r?\n/);
  }
  const m = measure(paras), n = (v) => Math.round(v).toLocaleString('en-US');
  const minutes = (wpm) => { const t = m.words / wpm; return t < 1 ? 'under a minute' : `${Math.round(t)} minute${Math.round(t) === 1 ? '' : 's'}`; };
  const pages = extra.pages || (extra.slides ? 0 : Math.max(1, Math.ceil(m.words / 500)));
  const lines = [
    ['Pages', pages ? `${n(pages)}${extra.pages ? '' : ' (estimated)'}` : ''], ['Slides', extra.slides ? n(extra.slides) : ''], ['Words', n(m.words)], ['Characters (no spaces)', n(m.charactersNoSpaces)], ['Characters (with spaces)', n(m.characters)],
    ['Paragraphs', n(m.paragraphs)], ['Sentences', n(m.sentences)], ['Words per sentence', m.wordsPerSentence.toFixed(1)],
    ['Flesch reading ease', m.readingEase == null ? '' : `${Math.max(0, Math.min(100, m.readingEase)).toFixed(1)} (${ease(m.readingEase)})`], ['Flesch-Kincaid grade level', m.grade == null ? '' : Math.max(0, m.grade).toFixed(1)],
    ['Reading time', m.words ? minutes(238) : ''], ['Speaking time', m.words ? minutes(130) : ''],
    ['Headings', extra.headings ? n(extra.headings) : ''], ['Tables', extra.tables ? n(extra.tables) : ''], ['Pictures', extra.pictures ? n(extra.pictures) : ''], ['Comments', extra.comments ? n(extra.comments) : ''], ['Tracked changes', extra.changes ? n(extra.changes) : ''],
  ].filter(([, v]) => v);
  const text = `${path.basename(file)}\n${lines.map(([k, v]) => `${k}: ${v}`).join('\n')}`;
  let out;
  if (o.save) { out = ctx.out.file(file, `${U.base(file)} - statistics.txt`); await fsp.writeFile(out, `${text}\n`); }
  return { path: out, note: `${n(m.words)} words · ${n(m.charactersNoSpaces)} characters${m.readingEase == null ? '' : ` · reading ease ${Math.max(0, Math.min(100, m.readingEase)).toFixed(0)}`}`, text, stats: { ...m, ...extra, pages } };
}
const ease = (s) => (s >= 90 ? 'very easy' : s >= 70 ? 'easy' : s >= 60 ? 'plain English' : s >= 50 ? 'fairly difficult' : s >= 30 ? 'difficult' : 'very difficult');

// ───────── Split at headings ─────────
// Relationships the body uses by id; any the part no longer mentions can go with what they point to.
const BODY_RELS = new Set(['image', 'hyperlink', 'oleObject', 'package', 'chart', 'diagramData', 'diagramLayout', 'diagramQuickStyle', 'diagramColors', 'diagramDrawing', 'video', 'audio', 'media', 'control', 'subDocument', 'aFChunk']);
function dropUnusedRels(pkg, part) {
  const xml = pkg.text(part);
  for (const r of pkg.rels(part)) if (BODY_RELS.has(r.type) && !xml.includes(`"${r.id}"`)) pkg.removeRel(part, r.id);
  pkg.prune();
}
async function splitDoc(file, o, ctx) {
  const src = await asDocx(file, ctx);
  try {
    const { pkg, main, doc } = await openWord(src.file), body = all(doc, W, 'body')[0], levels = headingLevels(pkg), max = Number(o.level) || 1;
    const blocks = kids(body).filter((e) => !is(e, W, 'sectPr')), parts = [];
    for (const b of blocks) {
      const lv = is(b, W, 'p') ? levelOf(b, levels) : 0;
      if ((lv && lv <= max) || !parts.length) parts.push({ title: lv && lv <= max ? paraText(b).replace(new RegExp(OBJ, 'g'), '').trim() : '', blocks: [] });
      parts[parts.length - 1].blocks.push(b);
    }
    const real = parts.filter((p) => p.title || p.blocks.some((b) => paraText(b).trim() || all(b, W, 'drawing').length || is(b, W, 'tbl')));
    if (real.filter((p) => p.title).length < 1 || real.length < 2) return { note: `Nothing to split at Heading ${max}: the document would stay in one piece.` };
    const folder = ctx.out.folder(file, `${U.base(file)} - parts`), used = new Set(), width = String(real.length).length;
    for (const [i, part] of real.entries()) {
      const copy = pkg.clone(), d = copy.dom(main), b = all(d, W, 'body')[0], sect = child(b, W, 'sectPr');
      for (const e of kids(b)) if (e !== sect) remove(e);
      for (const blk of part.blocks) b.insertBefore(d.importNode(blk, true), sect);
      dropUnusedRels(copy, main);
      let name = U.sanitize(`${String(i + 1).padStart(width, '0')} ${(part.title || 'Start').slice(0, 80)}`.trim());
      for (let k = 2; used.has(name.toLowerCase()); k++) name = `${name} ${k}`;
      used.add(name.toLowerCase());
      await copy.save(path.join(folder, `${name}.docx`));
      ctx.progress?.((i + 1) / real.length, 'Splitting');
    }
    return { path: folder, note: `${real.length} parts` };
  } finally { src.done(); }
}

// ───────── Watermark and page numbers ─────────
const HDR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header', FTR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const VML = { v: 'urn:schemas-microsoft-com:vml', o: 'urn:schemas-microsoft-com:office:office', w10: 'urn:schemas-microsoft-com:office:word' };
const TEXTPATH_TYPE = '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>';
function watermarkXml(o, n) {
  const text = String(o.text).trim(), diagonal = o.layout !== 'horizontal', wPt = 460, hPt = Math.max(40, Math.min(160, (wPt / Math.max(4, [...text].length)) * 1.6));
  const color = /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : '#c0c0c0', opacity = Math.max(0.05, Math.min(1, (Number(o.opacity) || 50) / 100));
  return `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:pict>${TEXTPATH_TYPE}<v:shape id="PowerPlusWaterMarkObject${n}" o:spid="_x0000_s${2049 + n}" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:${wPt}pt;height:${hPt.toFixed(1)}pt;${diagonal ? 'rotation:315;' : ''}z-index:-251654144;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="${color}" stroked="f"><v:fill opacity="${opacity}"/><v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="${O.xmlEsc(text)}"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r></w:p>`;
}
const pageNumberXml = (align) => `<w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="${align}"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
const ROOT_NS = `xmlns:w="${W}" xmlns:r="${NS.r}" xmlns:v="${VML.v}" xmlns:o="${VML.o}" xmlns:w10="${VML.w10}"`;
function appendXml(pkg, part, xml) {
  const d = pkg.dom(part), frag = O.parse(`<x ${ROOT_NS}>${xml}</x>`);
  const root = d.documentElement;
  for (const [p, ns] of [['v', VML.v], ['o', VML.o], ['w10', VML.w10]]) if (!root.getAttribute(`xmlns:${p}`)) root.setAttribute(`xmlns:${p}`, ns);
  const before = kids(root).filter((e) => is(e, W, 'sectPr'))[0] || null;
  for (const e of kids(frag.documentElement)) root.insertBefore(d.importNode(e, true), before);
}
function newPart(pkg, kind) {
  let n = 1;
  while (pkg.has(`word/${kind}${n}.xml`)) n++;
  const name = `word/${kind}${n}.xml`, tag = kind === 'header' ? 'hdr' : 'ftr';
  pkg.set(name, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${tag} ${ROOT_NS}></w:${tag}>`);
  pkg.setType(name, `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`);
  return name;
}
async function watermark(file, o, ctx) {
  const text = String(o.text ?? 'CONFIDENTIAL').trim();
  if (!text && !o.pageNumbers) throw new Error('Type a watermark, or turn on page numbers.');
  const { pkg, main, doc } = await openWord(file);
  const sects = all(doc, W, 'sectPr').filter((s) => !up(s, W, 'sectPrChange')), done = new Set();
  let n = 0;
  const each = (kind, xml) => {
    const type = kind === 'header' ? HDR : FTR, refName = kind === 'header' ? 'headerReference' : 'footerReference';
    sects.forEach((s, i) => {
      const refs = kids(s, W, refName);
      for (const r of refs) { const t = pkg.rel(main, attr(r, NS.r, 'id'))?.target; if (t && !done.has(t)) { done.add(t); appendXml(pkg, t, xml(++n)); } }
      // A section without its own default header or footer shows the previous section's; the first needs one made.
      const need = i === 0 ? ['default', ...(child(s, W, 'titlePg') ? ['first'] : [])] : [];
      for (const type0 of need) if (!refs.some((r) => attr(r, W, 'type') === type0)) {
        const part = newPart(pkg, kind), id = pkg.addRel(main, type, part);
        appendXml(pkg, part, xml(++n));
        s.insertBefore(make(doc, W, `w:${refName}`, { 'w:type': type0, 'r:id': id }), s.firstChild);
        done.add(part);
      }
    });
  };
  if (text) each('header', (k) => watermarkXml({ ...o, text }, k));
  if (o.pageNumbers) { done.clear(); each('footer', () => pageNumberXml(o.numberAlign === 'right' ? 'right' : 'center')); }
  const out = ctx.out.file(file, `${U.base(file)}-watermarked.${U.ext(file)}`);
  await pkg.save(out);
  return { path: out, note: [text && `“${text}” on every page`, o.pageNumbers && 'page numbers in the footer'].filter(Boolean).join(', ') };
}

module.exports = { asDocx, openWord, settleWord, settleOdf, trackChanges, compare, comparePlan, diff, inline, alike, mailMerge, fillWord, mergeData, stats, measure, countWords, splitDoc, headingLevels, watermark, paraText, storyParagraphs, runsOf, WORD_EXT };
