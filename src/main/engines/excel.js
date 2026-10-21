'use strict';
// Workbooks changed in place, as Excel would: formulas to values, hidden sheets, rows and columns shown, protection
// without a password lifted, one file per sheet, duplicate and empty rows removed with every reference kept pointing
// at the same cells, and a list of formulas and errors. Styles, charts and pictures stay as they were.
const U = require('./util');
const { fs, fsp, path } = U;
const O = require('./opc');
const { NS, all, kids, child, remove, attr } = O;
const T = NS.table;

const XLSX_EXT = ['xlsx', 'xlsm', 'xltx', 'xltm'];
async function openBook(file) {
  const pkg = await O.Package.open(file), fam = O.familyOf(pkg);
  if (fam !== 'excel') throw new Error(`${path.basename(file)} isn’t a spreadsheet Lime can change in place.`);
  return pkg;
}
// The workbook's sheets in tab order: name, part, state, and the <sheet> element's text.
function sheetsOf(pkg) {
  const main = pkg.main(), wb = pkg.text(main);
  return [...wb.matchAll(/<sheet\b[^>]*\/>/g)].map((m, i) => {
    const a = (k) => (new RegExp(`\\s${k}="([^"]*)"`).exec(m[0]) || [])[1] || '';
    const rid = a('r:id');
    return { i, tag: m[0], name: unxml(a('name')), state: a('state') || 'visible', rid, part: pkg.rel(main, rid)?.target };
  });
}
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const dropAttr = (tag, name) => tag.replace(new RegExp(`\\s${name}="[^"]*"`), '');
const getAttr = (tag, name) => (new RegExp(`\\s${name}="([^"]*)"`).exec(tag) || [])[1];
function dropCalcChain(pkg) {
  const main = pkg.main();
  for (const r of pkg.rels(main)) if (r.type === 'calcChain') { pkg.removeRel(main, r.id); pkg.remove(r.target); pkg.unsetType(r.target); }
}
const outFor = (file, ctx, suffix) => ctx.out.file(file, `${U.base(file)}${suffix}.${U.ext(file)}`);

// ───────── Formulas to values ─────────
function cellsToValues(xml, keep = () => true) {
  let done = 0, kept = 0;
  const out = xml.replace(/<c\b([^>]*?)(?<!\/)>([\s\S]*?)<\/c>/g, (m, a, inner) => {
    const f = /<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/.exec(inner);
    if (!f || !keep(f[0])) return m;
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
    if (!v) { kept++; return m; }
    done++;
    if (/\st="str"/.test(a)) return `<c${a.replace(/\st="str"/, ' t="inlineStr"')}><is><t xml:space="preserve">${v[1]}</t></is></c>`;
    return `<c${a}>${inner.replace(f[0], '')}</c>`;
  });
  return { xml: out, done, kept };
}
async function toValues(file, o, ctx) {
  const pkg = await openBook(file);
  let done = 0, kept = 0;
  if (pkg.odf) {
    const x = pkg.text('content.xml');
    done = (x.match(/\stable:formula="[^"]*"/g) || []).length;
    pkg.set('content.xml', x.replace(/\stable:formula="[^"]*"/g, ''));
  } else {
    for (const s of sheetsOf(pkg)) {
      if (!s.part || !pkg.has(s.part)) continue;
      const r = cellsToValues(pkg.text(s.part));
      if (r.done) pkg.set(s.part, r.xml);
      done += r.done; kept += r.kept;
    }
    dropCalcChain(pkg);
  }
  if (!done) return { note: kept ? 'The formulas in this workbook have no saved results to keep. Open it in Excel and save it once first.' : 'This workbook has no formulas.' };
  const out = outFor(file, ctx, '-values');
  await pkg.save(out);
  return { path: out, note: `${done} formula${done === 1 ? '' : 's'} replaced by ${done === 1 ? 'its value' : 'their values'}${kept ? `; ${kept} without a saved result left as they were` : ''}` };
}

// ───────── Unhide and unprotect ─────────
const HAS_PASSWORD = /\s(password|hashValue|workbookPassword|workbookHashValue|revisionsPassword|revisionsHashValue)="[^"]+"/;
async function unhide(file, o, ctx) {
  const pkg = await openBook(file), n = { sheets: 0, rows: 0, cols: 0, unprotected: 0, locked: 0 };
  if (pkg.odf) unhideOds(pkg, o, n);
  else {
    const main = pkg.main();
    let wb = pkg.text(main);
    if (o.sheets !== false) wb = wb.replace(/<sheet\b[^>]*\/>/g, (t) => (/\sstate="(hidden|veryHidden)"/.test(t) ? (n.sheets++, dropAttr(t, 'state')) : t));
    if (o.protection !== false) wb = wb.replace(/<workbookProtection\b[^>]*\/>/g, (t) => (HAS_PASSWORD.test(t) ? (n.locked++, t) : (n.unprotected++, '')));
    pkg.set(main, wb);
    for (const s of sheetsOf(pkg)) {
      if (!s.part || !pkg.has(s.part)) continue;
      let x = pkg.text(s.part);
      if (o.rows !== false) {
        x = x.replace(/<row\b[^>]*>/g, (t) => {
          if (!/\shidden="(1|true)"/.test(t) && !/\sht="0(\.0*)?"/.test(t)) return t;
          n.rows++;
          t = dropAttr(t, 'hidden');
          return /\sht="0(\.0*)?"/.test(t) ? dropAttr(dropAttr(t, 'ht'), 'customHeight') : t;
        });
        x = x.replace(/<col\b[^>]*\/>/g, (t) => {
          if (!/\shidden="(1|true)"/.test(t) && !/\swidth="0(\.0*)?"/.test(t)) return t;
          n.cols += Math.max(1, Number(getAttr(t, 'max')) - Number(getAttr(t, 'min')) + 1 || 1);
          t = dropAttr(t, 'hidden');
          return t.replace(/\swidth="0(\.0*)?"/, ' width="9.140625"');
        });
      }
      if (o.protection !== false) x = x.replace(/<sheetProtection\b[^>]*\/>/g, (t) => (HAS_PASSWORD.test(t) ? (n.locked++, t) : (n.unprotected++, '')));
      pkg.set(s.part, x);
    }
  }
  const parts = [n.sheets && `${n.sheets} sheet${n.sheets === 1 ? '' : 's'}`, n.rows && `${n.rows} row${n.rows === 1 ? '' : 's'}`, n.cols && `${n.cols} column${n.cols === 1 ? '' : 's'}`].filter(Boolean);
  const msg = [parts.length && `Showed ${parts.join(', ')}`, n.unprotected && `removed protection from ${n.unprotected} ${n.unprotected === 1 ? 'place' : 'places'}`, n.locked && `${n.locked} protected with a password ${n.locked === 1 ? 'stays' : 'stay'} protected`].filter(Boolean);
  if (!parts.length && !n.unprotected) return { note: n.locked ? 'Nothing is hidden, and the protection here has a password. Lime doesn’t remove passwords.' : 'Nothing in this workbook is hidden or protected.' };
  const out = outFor(file, ctx, '-unhidden');
  await pkg.save(out);
  return { path: out, note: msg.join('; ').replace(/^./, (c) => c.toUpperCase()) };
}
function unhideOds(pkg, o, n) {
  for (const name of ['content.xml', 'styles.xml']) {
    if (!pkg.has(name)) continue;
    const d = pkg.dom(name);
    if (o.rows !== false) for (const tag of ['table-row', 'table-column']) for (const e of all(d, T, tag)) {
      if (!/^(collapse|filter)$/.test(attr(e, T, 'visibility'))) continue;
      e.removeAttributeNS(T, 'visibility');
      n[tag === 'table-row' ? 'rows' : 'cols'] += Number(attr(e, T, tag === 'table-row' ? 'number-rows-repeated' : 'number-columns-repeated')) || 1;
    }
    if (o.sheets !== false) for (const p of all(d, NS.style, 'table-properties')) if (attr(p, T, 'display') === 'false') { p.setAttributeNS(T, 'table:display', 'true'); n.sheets++; }
    if (o.protection !== false) for (const e of [...all(d, T, 'table'), ...all(d, NS.office, 'spreadsheet')]) {
      const flag = e.localName === 'table' ? 'protected' : 'structure-protected';
      if (attr(e, T, flag) !== 'true') continue;
      if (attr(e, T, 'protection-key')) n.locked++; else { e.removeAttributeNS(T, flag); n.unprotected++; }
    }
  }
}

// ───────── One file per sheet ─────────
const sheetRef = (name) => new RegExp(`(?:'${O.escRe(name.replace(/'/g, "''"))}'|(?<![\\w.'])${O.escRe(name)})!`, 'i');
async function splitSheets(file, o, ctx) {
  const pkg = await openBook(file), folder = ctx.out.folder(file, `${U.base(file)} - sheets`), used = new Set(), names = [];
  const save = async (copy, name) => {
    let n = U.sanitize(name) || 'Sheet';
    for (let k = 2; used.has(n.toLowerCase()); k++) n = `${U.sanitize(name)} ${k}`;
    used.add(n.toLowerCase());
    names.push(n);
    await copy.save(path.join(folder, `${n}.${U.ext(file)}`));
  };
  if (pkg.odf) {
    const tables = all(pkg.dom('content.xml'), T, 'table').filter((t) => t.parentNode.localName === 'spreadsheet');
    if (tables.length < 2) return { note: 'This workbook has only one sheet.' };
    for (const [i, t] of tables.entries()) {
      const name = attr(t, T, 'name'), copy = pkg.clone(), d = copy.dom('content.xml');
      const mine = all(d, T, 'table').filter((x) => x.parentNode.localName === 'spreadsheet');
      mine.forEach((x, k) => { if (k !== i) remove(x); });
      const others = tables.filter((x, k) => k !== i).map((x) => attr(x, T, 'name'));
      const refers = (s) => others.some((nm) => s.includes(`$${nm}.`) || s.includes(`'${nm}'.`) || s.includes(`[${nm}.`) || s.includes(`$'${nm}'.`));
      for (const e of [...all(d, T, 'named-range'), ...all(d, T, 'named-expression')]) if (refers(attr(e, T, 'cell-range-address') + attr(e, T, 'expression'))) remove(e);
      if (o.values !== false) for (const c of all(d, T, 'table-cell')) if (refers(attr(c, T, 'formula'))) c.removeAttributeNS(T, 'formula');
      await save(copy, name);
      ctx.progress?.((i + 1) / tables.length, 'Splitting');
    }
    return { path: folder, note: `${names.length} sheets` };
  }
  const main = pkg.main(), sheets = sheetsOf(pkg).filter((s) => s.part && pkg.has(s.part)), wanted = sheets.filter((s) => o.hidden || s.state === 'visible');
  if (sheets.length < 2) return { note: 'This workbook has only one sheet.' };
  if (!wanted.length) return { note: 'Every sheet in this workbook is hidden; turn on Hidden sheets too.' };
  for (const [k, s] of wanted.entries()) {
    const copy = pkg.clone(), others = sheets.filter((x) => x !== s);
    let wb = copy.text(main);
    for (const x of others) { wb = wb.replace(x.tag, ''); copy.removeRel(main, x.rid); }
    wb = wb.replace(s.tag, dropAttr(s.tag, 'state')).replace(/<workbookView\b[^>]*>/g, (t) => dropAttr(dropAttr(t, 'activeTab'), 'firstSheet'));
    wb = wb.replace(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g, (m, a, body) => {
      const local = getAttr(a, 'localSheetId');
      if (local != null) return Number(local) === s.i ? m.replace(/localSheetId="\d+"/, 'localSheetId="0"') : '';
      return others.some((x) => sheetRef(x.name).test(unxml(body))) ? '' : m;
    }).replace(/<definedNames>\s*<\/definedNames>/, '');
    copy.set(main, wb);
    if (o.values !== false) {
      const r = cellsToValues(copy.text(s.part), (f) => others.some((x) => sheetRef(x.name).test(unxml(f))) || /\[\d+\]/.test(f));
      copy.set(s.part, r.xml);
    }
    dropCalcChain(copy);
    if (copy.has('docProps/app.xml')) copy.set('docProps/app.xml', copy.text('docProps/app.xml').replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>|<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/g, ''));
    copy.prune();
    await save(copy, s.name);
    ctx.progress?.((k + 1) / wanted.length, 'Splitting');
  }
  return { path: folder, note: `${names.length} sheet${names.length === 1 ? '' : 's'}${wanted.length < sheets.length ? `; ${sheets.length - wanted.length} hidden left out` : ''}` };
}

// ───────── Removing rows, with references kept right ─────────
const colNum = (s) => [...s.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
// Moves the row numbers in cell references to where the rows are now: a reference to a removed row becomes #REF!,
// a range shrinks to the rows that are left. `mine(sheet)` says whether a sheet-qualified reference points here.
function shiftRefs(formula, rows, mine) {
  const first = (r) => { for (let x = r; x <= rows.max; x++) if (rows.map(x) != null) return rows.map(x); return null; };
  const last = (r) => { for (let x = Math.min(r, rows.max); x >= 1; x--) if (rows.map(x) != null) return rows.map(x); return r > rows.max ? rows.map(r) : null; };
  const re = /(?<![\w.$\]!])((?:'(?:[^']|'')+'|[A-Za-z_À-￿][\w.À-￿]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?(?![\w(!])|(?<![\w.$\]!])((?:'(?:[^']|'')+'|[A-Za-z_À-￿][\w.À-￿]*)!)?(\$?)(\d+):(\$?)(\d+)(?![\w(])/g;
  return String(formula).split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : part.replace(re, (m, sh, d1, c1, d2, r1, d3, c2, d4, r2, rsh, e1, ra, e2, rb) => {
    const sheet = sh ?? rsh;
    if (!mine(sheet ? sheet.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : null)) return m;
    if (c1 && colNum(c1) > 16384) return m;
    if (c1 && !r2) { const n = rows.map(Number(r1)); return n == null ? `${sheet || ''}#REF!` : `${sheet || ''}${d1}${c1}${d2}${n}`; }
    const [a, b] = c1 ? [Number(r1), Number(r2)] : [Number(ra), Number(rb)], na = first(Math.min(a, b)), nb = last(Math.max(a, b));
    if (na == null || nb == null || na > nb) return `${sheet || ''}#REF!`;
    return c1 ? `${sheet || ''}${d1}${c1}${d2}${na}:${d3}${c2}${d4}${nb}` : `${sheet || ''}${e1}${na}:${e2}${nb}`;
  }))).join('');
}
const shiftRange = (s, rows) => String(s).split(/\s+/).filter(Boolean).map((r) => shiftRefs(r, rows, (sh) => !sh)).filter((r) => !r.includes('#REF!')).join(' ');
function cleanText(s) {
  return s.replace(/_x00(?:0[0-8BbCcEeFf]|1[0-9A-Fa-f])_/g, '').replace(/[\t\r\n ]/g, ' ').replace(/ {2,}/g, ' ');
}
// Shared strings, trimmed like Excel's TRIM and CLEAN: spaces at either end and doubled spaces inside, and control characters.
function trimStrings(xml, tag) {
  let n = 0;
  const out = xml.replace(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'), (m, inner) => {
    const ts = [...inner.matchAll(/<t\b([^>]*)>([^<]*)<\/t>/g)];
    if (!ts.length || /<rPh\b/.test(inner)) return m;
    const vals = ts.map((t) => cleanText(t[2]));
    vals[0] = vals[0].replace(/^ +/, '');
    vals[vals.length - 1] = vals[vals.length - 1].replace(/ +$/, '');
    for (let i = 1; i < vals.length; i++) if (/ $/.test(vals[i - 1])) vals[i] = vals[i].replace(/^ +/, '');
    if (vals.every((v, i) => v === ts[i][2])) return m;
    n++;
    let k = 0;
    return `<${tag}>${inner.replace(/<t\b([^>]*)>([^<]*)<\/t>/g, (x, a) => `<t${a}>${vals[k++]}</t>`)}</${tag}>`;
  });
  return { xml: out, n };
}
function cellValue(inner, a, sst) {
  const t = getAttr(a, 't'), v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
  if (t === 's') return sst[Number(v)] ?? '';
  if (t === 'inlineStr') return unxml([...inner.matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join(''));
  return v == null ? '' : `${t || 'n'}:${unxml(v)}`;
}
async function tidy(file, o, ctx) {
  const e = U.ext(file);
  if (['csv', 'tsv', 'tab'].includes(e)) return tidyCsv(file, o, ctx);
  if (!XLSX_EXT.includes(e)) return tidyRebuild(file, o, ctx);
  const pkg = await openBook(file), main = pkg.main(), sheets = sheetsOf(pkg).filter((s) => s.part && pkg.has(s.part));
  const n = { trimmed: 0, dup: 0, empty: 0 };
  const sstName = pkg.rels(main).find((r) => r.type === 'sharedStrings')?.target;
  if (o.trim !== false && sstName) { const r = trimStrings(pkg.text(sstName), 'si'); pkg.set(sstName, r.xml); n.trimmed += r.n; }
  const sst = sstName ? [...pkg.text(sstName).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join(''))) : [];
  const changed = [];
  for (const s of sheets) {
    let x = pkg.text(s.part);
    if (o.trim !== false) { const r = trimStrings(x, 'is'); x = r.xml; n.trimmed += r.n; }
    const rows = [...x.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)].map((m) => {
      const cells = [...(m[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => ({ col: (/r="([A-Z]+)/.exec(c[1]) || [])[1], val: cellValue(c[2] || '', c[1], sst) })).filter((c) => c.val !== '');
      return { r: Number(getAttr(m[1], 'r')), sig: JSON.stringify(cells.map((c) => [c.col, c.val])), empty: !cells.length };
    });
    const data = rows.filter((r) => !r.empty);
    if (!data.length) { pkg.set(s.part, x); continue; }
    const top = data[0].r, bottom = data[data.length - 1].r, gone = new Set(), seen = new Set();
    if (o.emptyRows !== false) for (let r = top; r <= bottom; r++) if (!data.some((d) => d.r === r)) { gone.add(r); n.empty++; }
    if (o.dedupe !== false) for (const d of data) { if (o.header !== false && d.r === top) continue; if (seen.has(d.sig)) { gone.add(d.r); n.dup++; } else seen.add(d.sig); }
    pkg.set(s.part, x);
    if (gone.size) changed.push({ s, gone });
  }
  for (const { s, gone } of changed) removeRows(pkg, s, gone, sheets);
  if (changed.length) dropCalcChain(pkg);
  if (!n.trimmed && !n.dup && !n.empty) return { note: NOTHING };
  const out = outFor(file, ctx, '-tidy');
  await pkg.save(out);
  return { path: out, note: tidyNote(n) };
}
const NOTHING = 'Nothing to tidy: no duplicate or empty rows, and no extra spaces.';
const tidyNote = (n) => [n.dup && `${n.dup} duplicate row${n.dup === 1 ? '' : 's'} removed`, n.empty && `${n.empty} empty row${n.empty === 1 ? '' : 's'} removed`, n.trimmed && `${n.trimmed} text${n.trimmed === 1 ? '' : 's'} trimmed`].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase());
// Takes rows out of one sheet and moves everything below them up, in this sheet and wherever other parts point at it.
function removeRows(pkg, s, gone, sheets) {
  const sorted = [...gone].sort((a, b) => a - b), max = 1048576;
  const rows = { max, map: (r) => { if (gone.has(r)) return null; let k = 0; while (k < sorted.length && sorted[k] < r) k++; return r - k; } };
  const here = (sh) => !sh, named = (sh) => sh != null && sh.toLowerCase() === s.name.toLowerCase();
  const fixF = (xml, mine) => xml.replace(/(<f\b[^>]*?(?<!\/)>)([\s\S]*?)(<\/f>)/g, (m, a, f, b) => `${a}${O.xmlEsc(shiftRefs(unxml(f), rows, mine)).replace(/&quot;/g, '"')}${b}`);
  let x = pkg.text(s.part);
  // A shared formula whose first cell goes leaves its other cells with nothing to copy from: they keep their values.
  const orphans = new Set();
  x.replace(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g, (m, a, b, inner) => { if (gone.has(Number(getAttr(a, 'r')))) for (const f of (inner || '').matchAll(/<f\b[^>]*t="shared"[^>]*\bref="[^"]*"[^>]*>/g)) orphans.add(getAttr(f[0], 'si')); return m; });
  if (orphans.size) x = x.replace(/<c\b([^>]*?)(?<!\/)>([\s\S]*?)<\/c>/g, (m, a, inner) => { const f = /<f\b[^>]*t="shared"[^>]*\/>/.exec(inner); return f && orphans.has(getAttr(f[0], 'si')) && /<v>/.test(inner) ? `<c${a}>${inner.replace(f[0], '')}</c>` : m; });
  x = x.replace(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g, (m, a) => {
    const r = Number(getAttr(a, 'r'));
    if (gone.has(r)) return '';
    const nr = rows.map(r);
    return nr === r ? m : m.replace(/<row\b[^>]*?\sr="\d+"/, (t) => t.replace(/\sr="\d+"/, ` r="${nr}"`)).replace(/(<c\b[^>]*?\sr=")([A-Z]+)(\d+)"/g, (t, p, c) => `${p}${c}${nr}"`);
  });
  x = fixF(x, here).replace(/(<f\b[^>]*\sref=")([^"]+)"/g, (m, p, r) => `${p}${shiftRange(r, rows) || r}"`);
  // Whatever covered only removed rows goes with them.
  x = x.replace(/(<(?:dimension|autoFilter|selection)\b[^>]*?\s(?:ref|sqref)=")([^"]+)"/g, (m, p, r) => `${p}${shiftRange(r, rows) || 'A1'}"`)
    .replace(/(<(?:hyperlink|mergeCell|conditionalFormatting|dataValidation)\b[^>]*?\s(?:ref|sqref)=")([^"]+)"/g, (m, p, r) => `${p}${shiftRange(r, rows)}"`)
    .replace(/<(hyperlink|mergeCell|dataValidation)\b[^>]*\s(?:ref|sqref)=""[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g, '').replace(/<conditionalFormatting\b[^>]*\ssqref=""[^>]*>[\s\S]*?<\/conditionalFormatting>/g, '')
    .replace(/(<formula\d?>)([\s\S]*?)(<\/formula\d?>)/g, (m, a, f, b) => `${a}${O.xmlEsc(shiftRefs(unxml(f), rows, here)).replace(/&quot;/g, '"')}${b}`)
    .replace(/<brk\b([^>]*?)id="(\d+)"/g, (m, a, id) => (rows.map(Number(id)) == null ? m : `<brk${a}id="${rows.map(Number(id))}"`));
  x = x.replace(/<mergeCells count="\d+">/, `<mergeCells count="${(x.match(/<mergeCell\b/g) || []).length}">`).replace(/<mergeCells count="0"><\/mergeCells>/, '')
    .replace(/<dataValidations count="\d+">/, `<dataValidations count="${(x.match(/<dataValidation\b/g) || []).length}">`).replace(/<dataValidations count="0"><\/dataValidations>|<hyperlinks><\/hyperlinks>/g, '');
  pkg.set(s.part, x);
  for (const r of pkg.rels(s.part)) {
    if (r.type === 'table' && pkg.has(r.target)) pkg.set(r.target, pkg.text(r.target).replace(/(<(?:table|autoFilter)\b[^>]*?\sref=")([^"]+)"/g, (m, p, v) => `${p}${shiftRange(v, rows) || v}"`));
    if (r.type === 'drawing' && pkg.has(r.target)) pkg.set(r.target, pkg.text(r.target).replace(/(<xdr:row>)(\d+)(<\/xdr:row>)/g, (m, a, v, b) => { let k = Number(v) + 1; while (gone.has(k)) k++; return `${a}${rows.map(k) - 1}${b}`; }));
  }
  for (const o of sheets) if (o !== s && pkg.has(o.part)) pkg.set(o.part, fixF(pkg.text(o.part), named));
  const main = pkg.main();
  pkg.set(main, pkg.text(main).replace(/(<definedName\b([^>]*)>)([\s\S]*?)(<\/definedName>)/g, (m, a, attrs, f, b) => {
    const local = getAttr(attrs, 'localSheetId'), mine = (sh) => named(sh) || (!sh && local != null && Number(local) === s.i);
    return `${a}${O.xmlEsc(shiftRefs(unxml(f), rows, mine)).replace(/&quot;/g, '"')}${b}`;
  }));
  for (const c of pkg.list(/^xl\/charts\/chart\d+\.xml$/)) pkg.set(c, pkg.text(c).replace(/(<c:f>)([\s\S]*?)(<\/c:f>)/g, (m, a, f, b) => `${a}${O.xmlEsc(shiftRefs(unxml(f), rows, named))}${b}`));
}
function tidyRows(rows, o, n) {
  if (o.trim !== false) rows = rows.map((r) => r.map((v) => { if (typeof v !== 'string') return v; const t = cleanText(v).trim(); if (t !== v) n.trimmed++; return t; }));
  const blank = (r) => r.every((v) => v === '' || v == null);
  let last = rows.length;
  while (last && blank(rows[last - 1])) last--;
  const firstData = rows.findIndex((r) => !blank(r)), seen = new Set(), out = [];
  rows.slice(0, last).forEach((r, i) => {
    if (blank(r)) { if (o.emptyRows !== false && i > firstData) { n.empty++; return; } out.push(r); return; }
    const sig = JSON.stringify(r.map((v) => (v instanceof Date ? v.toISOString() : v)));
    if (o.dedupe !== false && !(o.header !== false && i === firstData) && seen.has(sig)) { n.dup++; return; }
    seen.add(sig);
    out.push(r);
  });
  return out;
}
async function tidyCsv(file, o, ctx) {
  const D = require('./data'), { decodeText } = require('./textcodec'), bytes = await fsp.readFile(file), src = decodeText(bytes);
  const d = U.ext(file) === 'csv' ? D.detectDelimiter(src) : '\t', n = { trimmed: 0, dup: 0, empty: 0 };
  const rows = tidyRows(D.parseCsv(src, d), o, n);
  if (!n.trimmed && !n.dup && !n.empty) return { note: NOTHING };
  const out = outFor(file, ctx, '-tidy');
  await fsp.writeFile(out, D.csvText(rows, d));
  return { path: out, note: tidyNote(n) };
}
// Formats Lime can't change in place (ODS, XLS, XLSB) are read and written again; cell formatting isn't kept.
async function tidyRebuild(file, o, ctx) {
  const XLSX = require('xlsx'), wb = XLSX.readFile(file, { cellDates: true }), n = { trimmed: 0, dup: 0, empty: 0 };
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name], rows = tidyRows(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: true }), o, n);
    const fresh = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
    if (ws['!cols']) fresh['!cols'] = ws['!cols'];
    wb.Sheets[name] = fresh;
  }
  if (!n.trimmed && !n.dup && !n.empty) return { note: NOTHING };
  const out = outFor(file, ctx, '-tidy'), e = U.ext(file);
  XLSX.writeFile(wb, out, { bookType: e === 'xls' ? 'biff8' : e === 'fods' ? 'fods' : e === 'xlsb' ? 'xlsb' : 'ods', compression: true });
  return { path: out, note: `${tidyNote(n)} (cell formatting isn’t kept for ${e.toUpperCase()})` };
}

// ───────── Formulas and errors ─────────
const VOLATILE = /\b(NOW|TODAY|RAND|RANDBETWEEN|OFFSET|INDIRECT|CELL|INFO)\s*\(/i;
async function formulas(file, o, ctx) {
  const XLSX = require('xlsx'), wb = XLSX.readFile(file, { cellFormula: true, cellNF: false, cellDates: true });
  const list = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    for (const ref of Object.keys(ws)) {
      if (ref[0] === '!') continue;
      const c = ws[ref], f = c.f ? `=${c.f}` : '';
      const problem = c.t === 'e' ? `Error ${c.w || XLSX.SSF.format('General', c.v)}` : /#REF!/.test(f) ? 'Broken reference' : /\[\d+\]|\[[^\]]+\.xls/i.test(f) ? 'Uses another file' : VOLATILE.test(f) ? 'Recalculates every time' : '';
      if (f || c.t === 'e') list.push({ sheet: name, cell: ref, formula: f, value: c.t === 'e' ? c.w || '#ERROR' : c.w ?? (c.v instanceof Date ? c.v.toISOString().slice(0, 10) : String(c.v ?? '')), problem });
    }
  }
  const order = (a) => { const m = /^([A-Z]+)(\d+)$/.exec(a.cell); return m ? Number(m[2]) * 20000 + colNum(m[1]) : 0; };
  list.sort((a, b) => wb.SheetNames.indexOf(a.sheet) - wb.SheetNames.indexOf(b.sheet) || order(a) - order(b));
  const count = list.filter((x) => x.formula).length, errors = list.filter((x) => /^Error|Broken/.test(x.problem));
  if (!list.length) return { note: 'This workbook has no formulas or errors.' };
  const sheetsWith = new Set(list.filter((x) => x.formula).map((x) => x.sheet)).size;
  const head = `${count} formula${count === 1 ? '' : 's'} on ${sheetsWith} sheet${sheetsWith === 1 ? '' : 's'}; ${errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : 'no errors'}`;
  const text = [head, ...list.filter((x) => x.problem).slice(0, 40).map((x) => `${x.sheet}!${x.cell}  ${x.problem}${x.formula ? `  ${x.formula}` : ''}`)].join('\n');
  let out;
  if (o.save) {
    out = ctx.out.file(file, `${U.base(file)} - formulas.xlsx`);
    const book = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet([['Sheet', 'Cell', 'Formula', 'Value', 'Problem'], ...list.map((x) => [x.sheet, x.cell, x.formula, x.value, x.problem])]);
    ws['!cols'] = [{ wch: 16 }, { wch: 8 }, { wch: 48 }, { wch: 16 }, { wch: 24 }];
    ws['!autofilter'] = { ref: `A1:E${list.length + 1}` };
    XLSX.utils.book_append_sheet(book, ws, 'Formulas');
    XLSX.writeFile(book, out, { compression: true });
  }
  return { path: out, note: head, text, list };
}

module.exports = { toValues, unhide, splitSheets, tidy, formulas, shiftRefs, sheetsOf, cellsToValues, XLSX_EXT };
