'use strict';
const { PDFHexString, PDFName, PDFOperator, PDFOperatorNames: Ops, degrees, pushGraphicsState, popGraphicsState, setGraphicsState, beginText, endText, setFontAndSize, setTextRise, rotateAndSkewTextRadiansAndTranslate, setFillingColor, moveTo, lineTo, appendBezierCurve, closePath, fill, concatTransformationMatrix } = require('pdf-lib');

let bidi;
const bidiOf = () => { if (bidi === undefined) { try { bidi = require('bidi-js')(); } catch (_) { bidi = null; } } return bidi; };

const BLOCKS = [[0x0370, 0x03ff, 'greek', 7], [0x0400, 0x052f, 'cyrillic', 9], [0x0530, 0x058f, 'armenian', 10], [0x0590, 0x05ff, 'hebrew', 11], [0x0600, 0x06ff, 'arabic', 13], [0x0750, 0x077f, 'arabic', 13], [0x08a0, 0x08ff, 'arabic', 13], [0xfb50, 0xfdff, 'arabic', 63], [0xfe70, 0xfeff, 'arabic', 67],
  [0x0900, 0x097f, 'devanagari', 15], [0x0980, 0x09ff, 'bengali', 16], [0x0a00, 0x0a7f, 'gurmukhi', 17], [0x0a80, 0x0aff, 'gujarati', 18], [0x0b00, 0x0b7f, 'oriya', 19], [0x0b80, 0x0bff, 'tamil', 20], [0x0c00, 0x0c7f, 'telugu', 21], [0x0c80, 0x0cff, 'kannada', 22], [0x0d00, 0x0d7f, 'malayalam', 23], [0x0d80, 0x0dff, 'sinhala', 73],
  [0x0e00, 0x0e7f, 'thai', 24], [0x0e80, 0x0eff, 'lao', 25], [0x0f00, 0x0fff, 'tibetan', 70], [0x1000, 0x109f, 'myanmar', 74], [0x10a0, 0x10ff, 'georgian', 26], [0x1200, 0x137f, 'ethiopic', 75], [0x1780, 0x17ff, 'khmer', 80],
  [0x3040, 0x309f, 'cjk', 49], [0x30a0, 0x30ff, 'cjk', 50], [0x3400, 0x4dbf, 'cjk', 59], [0x4e00, 0x9fff, 'cjk', 59], [0xac00, 0xd7af, 'hangul', 56]];
const BUNDLED = { arabic: 'arabic', devanagari: 'devanagari', thai: 'thai' };
const WINANSI = /^[\x20-\x7e -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]$/;
const blockOf = (cp) => BLOCKS.find((b) => cp >= b[0] && cp <= b[1]);
const fkOf = (font) => (font.embedder.font?.hasGlyphForCodePoint ? font.embedder.font : null);
const has = (font, cp) => { const fk = fkOf(font); return fk ? fk.hasGlyphForCodePoint(cp) : WINANSI.test(String.fromCodePoint(cp)); };
const letter = (ch) => /\p{L}|\p{M}/u.test(ch);

async function runs(text, o) {
  const b = bidiOf(), lv = b && b.getEmbeddingLevels(text), levels = lv ? lv.levels : new Uint8Array(text.length), mirror = lv ? b.getMirroredCharactersMap(text, lv.levels) : new Map();
  const base = lv ? lv.paragraphs[0]?.level || 0 : 0;
  for (let i = text.length - 1; i >= 0 && /\s/.test(text[i]); i--) levels[i] = base;
  const out = [];
  let cur = null;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i), len = cp > 0xffff ? 2 : 1, ch = mirror.get(i) || String.fromCodePoint(cp), blk = blockOf(cp), script = blk ? blk[2] : letter(ch) ? 'latin' : null;
    let font = cur && (!script || cur.script === script) && has(cur.font, cp) ? cur.font : has(o.chosen, cp) ? o.chosen : null;
    if (!font && script && BUNDLED[script]) font = await o.fontFor(BUNDLED[script]);
    if (!font && script && script !== 'latin' && blk && o.covering) { const key = await o.covering(blk[3]); if (key) font = await o.fontFor(key); }
    if (!font && script) font = await o.fontFor('sans');
    if (!font || !has(font, cp)) font = cur ? cur.font : o.chosen;
    const level = levels[i], s = script || cur?.script || null;
    if (!cur || cur.font !== font || cur.level !== level || (script && cur.script && cur.script !== script)) out.push(cur = { font, level, script: s, text: '', chars: '' });
    else if (script && !cur.script) cur.script = script;
    cur.text += ch;
    cur.chars += text.slice(i, i + len);
    i += len;
  }
  const top = Math.max(0, ...out.map((r) => r.level));
  for (let k = top; k >= 1; k--) for (let i = 0; i < out.length; i++) if (out[i].level >= k) { let j = i; while (j < out.length && out[j].level >= k) j++; out.splice(i, j - i, ...out.slice(i, j).reverse()); i = j; }
  return out;
}

const docs = new WeakMap();
function state(doc, font) {
  if (!docs.has(doc)) docs.set(doc, new Map());
  const m = docs.get(doc);
  if (!m.has(font)) m.set(font, { codes: new Map(), list: [] });
  return m.get(font);
}
function codeOf(st, gid, piece, width) {
  const key = `${gid}|${piece}`;
  if (!st.codes.has(key)) { st.list.push({ gid, piece, width }); st.codes.set(key, st.list.length); }
  return st.codes.get(key);
}
const hex4 = (n) => n.toString(16).padStart(4, '0');
function toUnicode(pieces) {
  const rows = pieces.map((p, i) => `<${hex4(i + 1)}> <${Buffer.from(p, 'utf16le').swap16().toString('hex')}>`), chunks = [];
  for (let i = 0; i < rows.length; i += 100) chunks.push(`${Math.min(100, rows.length - i)} beginbfchar\n${rows.slice(i, i + 100).join('\n')}\nendbfchar`);
  return `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo <</Registry (Adobe) /Ordering (UCS) /Supplement 0>> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <ffff> endcodespacerange\n${chunks.join('\n')}\nendcmap CMapName currentdict /CMap defineresource pop end end`;
}

function shaped(font, text, chars = text, odd = false) {
  const fk = fkOf(font), flip = (t) => [...t].reverse().join('');
  let run = fk.layout(text);
  if (odd && run.direction !== 'rtl') { chars = flip(chars); run = fk.layout(flip(text)); }
  const n = run.glyphs.length, rtl = run.direction === 'rtl', order = [...Array(n).keys()], cps = [...chars], piece = new Array(n).fill('');
  let at = 0, last = -1;
  for (const i of rtl ? order.slice().reverse() : order) { const c = run.glyphs[i].codePoints.length; if (!c) continue; piece[i] = cps.slice(at, at + c).join(''); at += c; last = i; }
  if (at < cps.length && last >= 0) piece[last] += cps.slice(at).join('');
  return { fk, run, piece, width: run.positions.reduce((s, p) => s + p.xAdvance, 0) / fk.unitsPerEm };
}
const plain = (font) => { const fk = fkOf(font); return !fk || fk.cff; };
async function width(doc, text, o) {
  let w = 0;
  for (const r of await runs(text, o)) w += (plain(r.font) ? r.font.widthOfTextAtSize(r.text, o.size) : shaped(r.font, r.text, r.chars, r.level & 1).width * o.size) + (o.spacing || 0) * [...r.text].length;
  return w;
}
async function draw(page, text, o) {
  const rad = ((o.rotate || 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad), sp = o.spacing || 0;
  let dx = 0;
  for (const r of await runs(text, o)) {
    const x = o.x + dx * cos, y = o.y + dx * sin;
    if (plain(r.font)) {
      page.drawText(r.text, { x, y, size: o.size, font: r.font, color: o.color, opacity: o.opacity, rotate: degrees(o.rotate || 0) });
      dx += r.font.widthOfTextAtSize(r.text, o.size) + sp * [...r.text].length;
      continue;
    }
    const { fk, run, piece } = shaped(r.font, r.text, r.chars, r.level & 1), st = state(page.doc, r.font), k = o.size / fk.unitsPerEm;
    const gids = r.font.encodeText(run.direction !== 'rtl' && r.level & 1 ? [...r.text].reverse().join('') : r.text).toString().slice(1, -1).match(/.{4}/g) || [];
    page.setFont(r.font);
    const [, key] = page.getFont(), gs = page.maybeEmbedGraphicsState({ opacity: o.opacity });
    const ops = [pushGraphicsState(), ...(gs ? [setGraphicsState(gs)] : []), beginText(), setFillingColor(o.color), setFontAndSize(key, o.size), rotateAndSkewTextRadiansAndTranslate(rad, 0, 0, x, y)];
    const paths = [], ctx = page.doc.context, em = 1000 / fk.unitsPerEm;
    let pen = 0, rise = 0, parts = [];
    const flush = () => { if (parts.length) ops.push(PDFOperator.of(Ops.ShowTextAdjusted, [ctx.obj(parts)])); parts = []; };
    run.glyphs.forEach((g, i) => {
      const p = run.positions[i], w = Math.round(g.advanceWidth * em);
      if (piece[i]) {
        if (p.yOffset * k !== rise) { flush(); ops.push(setTextRise((rise = p.yOffset * k))); }
        if (p.xOffset) parts.push(-p.xOffset * em);
        parts.push(PDFHexString.of(hex4(codeOf(st, parseInt(gids[i], 16), piece[i], w))));
        const back = (p.xAdvance - p.xOffset) * em - w;
        if (back) parts.push(-back);
        pen += sp;
      } else paths.push({ g, x: pen + p.xOffset * k, y: p.yOffset * k });
      pen += p.xAdvance * k;
    });
    flush();
    ops.push(endText());
    for (const p of paths) {
      ops.push(pushGraphicsState(), setFillingColor(o.color), concatTransformationMatrix(cos, sin, -sin, cos, x + p.x * cos - p.y * sin, y + p.x * sin + p.y * cos));
      let cx = 0, cy = 0;
      for (const c of p.g.path.commands) {
        const a = c.args.map((v) => v * k);
        if (c.command === 'moveTo') ops.push(moveTo(a[0], a[1]));
        else if (c.command === 'lineTo') ops.push(lineTo(a[0], a[1]));
        else if (c.command === 'quadraticCurveTo') ops.push(appendBezierCurve(cx + (2 / 3) * (a[0] - cx), cy + (2 / 3) * (a[1] - cy), a[2] + (2 / 3) * (a[0] - a[2]), a[3] + (2 / 3) * (a[1] - a[3]), a[2], a[3]));
        else if (c.command === 'bezierCurveTo') ops.push(appendBezierCurve(...a));
        else if (c.command === 'closePath') ops.push(closePath());
        if (a.length >= 2) { cx = a[a.length - 2]; cy = a[a.length - 1]; }
      }
      ops.push(fill(), popGraphicsState());
    }
    ops.push(popGraphicsState());
    page.pushOperators(...ops);
    dx += pen;
  }
  return dx;
}
async function finish(doc) {
  const m = docs.get(doc);
  if (!m) return;
  const ctx = doc.context;
  for (const [font, st] of m) {
    await font.embed();
    const dict = ctx.lookup(font.ref), cid = dict.lookup(PDFName.of('DescendantFonts')).lookup(0), map = Buffer.alloc(2 * (st.list.length + 1));
    st.list.forEach((e, i) => map.writeUInt16BE(e.gid, 2 * (i + 1)));
    cid.set(PDFName.of('CIDToGIDMap'), ctx.register(ctx.flateStream(map)));
    cid.set(PDFName.of('W'), ctx.obj([1, st.list.map((e) => e.width)]));
    dict.set(PDFName.of('ToUnicode'), ctx.register(ctx.flateStream(toUnicode(st.list.map((e) => e.piece)))));
  }
  docs.delete(doc);
}
module.exports = { runs, width, draw, finish, toUnicode, blockOf, BLOCKS };
