'use strict';
// PDF pages → paragraphs, ruled tables and pictures in reading order, written as a Word document. Words come from
// MuPDF's characters, rules and pictures from a device run over the page. Adapted from Filee's PdfDocumentReader
// (MIT, KnifeLemon, https://github.com/KnifeLemon/Filee). Geometry is in points, y down from the page's top.
const crypto = require('crypto');

const LIST_START = /^([•◦▪▫●○■□‣⁃∙·\-–—*]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|[ivxIVX]{1,4}[.)]|[①-⑳]|[가-하][.)])$/;
const PAGE_NUMBER = /^[\s\-–—(\[]*(page|p\.|페이지|第)?\s*\d+\s*(\/|of|페이지|쪽|页)?\s*\d*[\s\-–—)\]]*$/i;
const ROMAN_PAGE_NUMBER = /^[\s\-–—(\[]*(?=[ivxlcdm])m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})[\s\-–—)\]]*$/i;
const KNOWN_FONTS = {
  helvetica: 'Arial', arial: 'Arial', arialmt: 'Arial', arialnarrow: 'Arial Narrow', times: 'Times New Roman', timesnewroman: 'Times New Roman',
  timesnewromanps: 'Times New Roman', timesnewromanpsmt: 'Times New Roman', courier: 'Courier New', couriernew: 'Courier New', couriernewps: 'Courier New',
  couriernewpsmt: 'Courier New', malgungothic: 'Malgun Gothic', segoeui: 'Segoe UI', trebuchetms: 'Trebuchet MS', centurygothic: 'Century Gothic',
  bookantiqua: 'Book Antiqua', comicsansms: 'Comic Sans MS', lucidaconsole: 'Lucida Console', palatinolinotype: 'Palatino Linotype',
};
const RENDER_DPI = 150, MAX_SEGMENTS = 5000, MAX_RULE = 4, MIN_RULE = 4, SAME_LINE = 1.5, RULE_GAP = 2.5, EDGE = 3;

const median = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hex = (c) => c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const white = (h) => [0, 2, 4].every((i) => parseInt(h.slice(i, i + 2), 16) >= 242);
const spot = (x, y) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
const isCjk = (ch) => /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uff60\u3000-\u303f]/.test(ch || '');
const sameFmt = (a, b) => a.bold === b.bold && a.italic === b.italic && a.size === b.size && a.font === b.font && a.color === b.color && a.script === b.script;

// "ABCDEF+TimesNewRomanPS-BoldMT" → "Times New Roman"; null for names that are no family (F1, T3Font_0).
function fontFamily(postScript) {
  let name = String(postScript || '').replace(/^[A-Z]{6}\+/, '');
  const cut = name.search(/[-,]/);
  if (cut > 0) name = name.slice(0, cut);
  for (const suffix of ['PSMT', 'MT', 'PS']) {
    if (name.length > suffix.length + 2 && name.endsWith(suffix)) {
      if (KNOWN_FONTS[name.toLowerCase()]) return KNOWN_FONTS[name.toLowerCase()];
      name = name.slice(0, -suffix.length);
    }
  }
  return KNOWN_FONTS[name.toLowerCase()] || (name.length < 3 || /^(F|T3Font_?|Font)\d+$/.test(name) ? null : name);
}

const line = (words, row = 0, tabs = []) => ({
  words, row, tabs, x0: words[0].x0, x1: words[words.length - 1].x1, y0: Math.min(...words.map((w) => w.y0)), y1: Math.max(...words.map((w) => w.y1)),
  base: words[0].base, size: Math.max(...words.map((w) => w.size)), text: words.map((w) => w.text).join(' '),
  ref: words.reduce((a, w) => (w.size > a.size ? w : a)).base,
});
function mainSize(words) {
  const by = new Map();
  for (const w of words) { const k = Math.round(w.size * 2) / 2; by.set(k, (by.get(k) || 0) + w.text.length); }
  let best = 10, n = -1;
  for (const [k, v] of by) if (v > n) { best = k; n = v; }
  return best;
}
// A paragraph, a picture or a ruled table: the unit of reading order.
class Item {
  constructor(lines = [], extra = {}) { this.lines = lines; this.cl = 0; this.cr = 0; Object.assign(this, extra); }
  get box() { return this.pic?.box || this.table?.box; }
  get x0() { return this.box ? this.box[0] : Math.min(...this.lines.map((l) => l.x0)); }
  get x1() { return this.box ? this.box[2] : Math.max(...this.lines.map((l) => l.x1)); }
  get y0() { return this.box ? this.box[1] : this.lines[0].y0; }
  get y1() { return this.box ? this.box[3] : this.lines[this.lines.length - 1].y1; }
  get width() { return this.x1 - this.x0; }
  get size() { return mainSize(this.lines.flatMap((l) => l.words)); }
  get text() { return this.table ? this.table.cells.flatMap((c) => c.words.map((w) => w.text)).join(' ') : this.lines.map((l) => l.text).join(' '); }
}
const pitch = (item) => (item.lines.length < 2 ? item.size * 1.2 : median(item.lines.slice(1).map((l, i) => l.base - item.lines[i].base)));

const quadBox = (q) => [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]), Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])];
const colorHex = (c) => (!c?.length ? '000000' : c.length >= 4 ? hex([0, 1, 2].map((i) => (1 - c[i]) * (1 - c[3]))) : c.length >= 3 ? hex(c.slice(0, 3)) : hex([c[0], c[0], c[0]]));

function pageWords(page, hidden, links) {
  const words = [];
  let cur = null, flat = false;
  const done = () => {
    if (!cur) return;
    const [x0, y0, x1, y1] = cur.box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, size = Math.max(1, median(cur.sizes));
    const text = cur.text.replace(/[\ufb00-\ufb06]/g, (l) => l.normalize('NFKC'));
    const link = links.find((l) => cx >= l.box[0] && cx <= l.box[2] && cy >= l.box[1] && cy <= l.box[3])?.uri || null;
    words.push({ text, x0, y0, x1, y1, base: cur.base, size, fmt: { ...cur.fmt, size: Math.round(size * 2) / 2 }, link });
    cur = null;
  };
  page.toStructuredText('preserve-whitespace').walk({
    beginLine(bbox, wmode, dir) { flat = wmode === 0 && Math.abs(dir[1]) < 0.05 && dir[0] > 0; },
    onChar(c, origin, font, size, quad, color) {
      if (!flat || /^\s*$/.test(c) || hidden.has(spot(origin[0], origin[1]))) return done();
      const b = quadBox(quad);
      if (cur && (b[0] - cur.box[2] > 0.3 * size || Math.abs(size - cur.sizes[0]) > 0.2 * Math.max(size, cur.sizes[0]))) done();
      if (!cur) {
        const name = font.getName();
        cur = { text: '', sizes: [], box: b, base: origin[1], fmt: { bold: font.isBold() || /Bold|Black|Heavy|Semibold|SemiBold|Demi/.test(name), italic: font.isItalic() || /Italic|Oblique/.test(name), font: fontFamily(name), color: colorHex(color) } };
      }
      cur.text += c;
      cur.sizes.push(size);
      cur.box = [Math.min(cur.box[0], b[0]), Math.min(cur.box[1], b[1]), Math.max(cur.box[2], b[2]), Math.max(cur.box[3], b[3])];
    },
    endLine() { done(); },
  });
  done();
  return words;
}

// One device run over the page: invisible (OCR) glyph positions, painted paths and drawn pictures.
function pagePaint(m, page) {
  const hidden = new Set(), paths = [], images = [];
  let segments = 0;
  const at = (c, x, y) => [c[0] * x + c[2] * y + c[4], c[1] * x + c[3] * y + c[5]];
  const colour = (cs, c) => (cs.isCMYK() ? colorHex(c) : c.length >= 3 ? hex(c.slice(0, 3)) : c.length === 1 ? (cs.isGray() ? hex([c[0], c[0], c[0]]) : hex([1 - c[0], 1 - c[0], 1 - c[0]])) : '000000');
  const shape = (p, ctm) => {
    const subs = [];
    let sub = null, start = null, cur = null;
    const open = (q) => { sub = { segs: [], curved: false }; subs.push(sub); start = cur = q; };
    p.walk({
      moveTo(x, y) { open(at(ctm, x, y)); },
      lineTo(x, y) { const q = at(ctm, x, y); if (!sub) open(q); sub.segs.push([cur[0], cur[1], q[0], q[1]]); cur = q; },
      curveTo(x1, y1, x2, y2, x3, y3) { const q = at(ctm, x3, y3); if (!sub) open(q); sub.curved = true; cur = q; },
      closePath() { if (sub) { sub.segs.push([cur[0], cur[1], start[0], start[1]]); cur = start; } },
    });
    segments += subs.reduce((n, s) => n + s.segs.length, 0);
    return subs;
  };
  const dev = new m.Device({
    fillPath(p, evenOdd, ctm, cs, color, alpha) { if (alpha > 0 && segments <= MAX_SEGMENTS) paths.push({ subs: shape(p, ctm), fill: colour(cs, color) }); },
    strokePath(p, stroke, ctm, cs, color, alpha) {
      if (alpha > 0 && segments <= MAX_SEGMENTS) paths.push({ subs: shape(p, ctm), stroke: colour(cs, color), width: stroke.getLineWidth() * Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])), dashed: (stroke.getDashes() || []).length > 0 });
    },
    ignoreText(text, ctm) { text.walk({ showGlyph(font, trm) { const [x, y] = at(ctm, trm[4], trm[5]); hidden.add(spot(x, y)); } }); },
    fillImage(image, ctm) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => at(ctm, u, v));
      images.push({ image, box: [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))] });
    },
  });
  try { page.runPageContents(dev, m.Matrix.identity); dev.close(); } finally { dev.destroy(); }
  return { hidden, paths: segments > MAX_SEGMENTS ? [] : paths, images };
}

// Plain JPEG image XObjects by pixel size, when only one image has that size: written as they are.
function jpegStreams(page) {
  const found = new Map();
  const visit = (res, depth) => {
    const xo = res?.isDictionary?.() ? res.get('XObject') : null;
    if (!xo?.isDictionary()) return;
    xo.forEach((o) => {
      try {
        if (!o.isStream()) return;
        const kind = o.get('Subtype').isName() ? o.get('Subtype').asName() : '';
        if (kind === 'Form' && depth < 3) return visit(o.get('Resources'), depth + 1);
        if (kind !== 'Image') return;
        const f = o.get('Filter'), filter = f.isName() ? f.asName() : f.isArray() && f.length === 1 && f.get(0).isName() ? f.get(0).asName() : null;
        const key = `${o.get('Width').asNumber()}x${o.get('Height').asNumber()}`, id = o.isIndirect() ? o.asIndirect() : -1;
        const seen = found.get(key);
        if (seen && seen.id !== id) found.set(key, { id: -2 });
        else if (!seen) found.set(key, { id, obj: ['DCTDecode', 'DCT'].includes(filter) && o.get('Decode').isNull() ? o : null });
      } catch (_) {}
    });
  };
  visit(page.getObject().getInheritable('Resources'), 0);
  return found;
}

async function pictures(m, page, images, W, H) {
  const out = [], jpegs = jpegStreams(page);
  let rendered = null;
  for (const { image, box } of images.slice(0, 200)) {
    const b = [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(W, box[2]), Math.min(H, box[3])], w = b[2] - b[0], h = b[3] - b[1];
    if (w < 6 || h < 6 || image.getImageMask() || w * h > 0.85 * W * H) continue;
    const jpeg = jpegs.get(`${image.getWidth()}x${image.getHeight()}`)?.obj;
    let pic = null;
    if (jpeg && [1, 3].includes(image.getNumberOfComponents())) pic = { data: Buffer.from(jpeg.readRawStream().asUint8Array()), type: 'jpg' };
    else {
      try {
        let pix = image.toPixmap();
        if (!pix.getColorSpace()?.isGray() && !pix.getColorSpace()?.isRGB()) pix = pix.convertToColorSpace(m.ColorSpace.DeviceRGB);
        pic = { data: Buffer.from(pix.asPNG()), type: 'png' };
      } catch (_) {
        if (!rendered) {
          const pix = render(m, page, W, H);
          rendered = { png: Buffer.from(pix.asPNG()), w: pix.getWidth(), h: pix.getHeight() };
        }
        const sx = rendered.w / W, sy = rendered.h / H;
        const left = clamp(Math.round(b[0] * sx), 0, rendered.w), top = clamp(Math.round(b[1] * sy), 0, rendered.h);
        const width = clamp(Math.round(b[2] * sx), 0, rendered.w) - left, height = clamp(Math.round(b[3] * sy), 0, rendered.h) - top;
        if (width >= 2 && height >= 2) pic = { data: await require('sharp')(rendered.png).extract({ left, top, width, height }).png().toBuffer(), type: 'png' };
      }
    }
    if (pic) out.push(new Item([], { pic: { ...pic, box: b } }));
  }
  return out;
}

// Words on a baseline (smaller superscripts sitting higher included) → lines, split at gaps much wider than a space.
function lines(words) {
  const rows = [];
  const sup = (s, b) => s.size < b.size * 0.8 && s.y1 > b.y0 && s.y0 < b.base;
  for (const w of [...words].sort((a, b) => a.base - b.base || a.x0 - b.x0)) {
    let row = null;
    for (let r = rows.length - 1; r >= Math.max(0, rows.length - 3) && !row; r--) {
      const a = rows[r].anchor;
      if (Math.abs(a.base - w.base) <= 0.5 * Math.min(a.size, w.size) || sup(w, a) || sup(a, w)) row = rows[r];
    }
    if (!row) rows.push(row = { words: [], anchor: w });
    row.words.push(w);
    if (w.size > row.anchor.size) row.anchor = w;
  }
  const gaps = [];
  for (const r of rows) {
    r.words.sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < r.words.length; i++) gaps.push(r.words[i].x0 - r.words[i - 1].x1);
  }
  const space = gaps.length ? Math.max(0.5, median(gaps.filter((g) => g > 0))) : 3;
  const out = [];
  rows.forEach(({ words: ws }, r) => {
    let cur = [ws[0]];
    for (let i = 1; i < ws.length; i++) {
      if (ws[i].x0 - ws[i - 1].x1 > Math.max(5 * space, 1.5 * Math.min(ws[i].size, ws[i - 1].size))) { out.push(line(cur, r)); cur = []; }
      cur.push(ws[i]);
    }
    out.push(line(cur, r));
  });
  return out;
}

// Parts of a split row joined with a tab when no gutter lies between them: after a list number, over 6 em, or where a
// row close above or below has a tab at the same place (a form's value column).
function joinTabbedRows(ls, items) {
  const rows = [];
  for (const l of ls) (rows[l.row] = rows[l.row] || []).push(l);
  const parts = rows.filter(Boolean);
  if (!items.length || parts.every((r) => r.length === 1)) return null;
  const gs = gutters(items, Math.min(...items.map((i) => i.x0)), Math.max(...items.map((i) => i.x1)));
  const candidates = [], tabs = new Set();
  for (const row of parts) {
    for (let p = 1; p < row.length; p++) {
      const before = row[p - 1], after = row[p];
      if (gs.some((g) => g.start >= before.x1 - 2 && g.end <= after.x0 + 2)) continue;
      candidates.push({ row: before.row, part: p, x: after.x0 });
      if ((before.words.length === 1 && LIST_START.test(before.words[0].text)) || after.x0 - before.x1 > 6 * Math.max(before.size, after.size)) tabs.add(`${before.row}:${p}`);
    }
  }
  if (!tabs.size) return null;
  for (let grown = true; grown;) {
    grown = false;
    for (const c of candidates) {
      if (!tabs.has(`${c.row}:${c.part}`) && candidates.some((o) => tabs.has(`${o.row}:${o.part}`) && Math.abs(o.row - c.row) <= 2 && Math.abs(o.x - c.x) <= 1.5)) { tabs.add(`${c.row}:${c.part}`); grown = true; }
    }
  }
  const out = [];
  for (const row of parts) {
    let cur = row[0];
    for (let p = 1; p < row.length; p++) {
      if (tabs.has(`${cur.row}:${p}`)) cur = line([...cur.words, ...row[p].words], cur.row, [...cur.tabs, cur.words.length]);
      else { out.push(cur); cur = row[p]; }
    }
    out.push(cur);
  }
  return out;
}

function paragraphs(ls) {
  const items = [];
  for (const l of ls) {
    let best = null, bestD = Infinity;
    for (const item of items) {
      if (l.tabs.length) break;
      const last = item.lines[item.lines.length - 1], head = item.lines[0];
      if (head.tabs.length && Math.abs(l.x0 - head.words[head.tabs[head.tabs.length - 1]].x0) > 0.5 * l.size) continue;
      const d = l.base - last.base, s = Math.max(last.size, l.size);
      if (d <= 0 || d > 1.9 * s || Math.abs(last.size - l.size) > 0.2 * s) continue;
      if (item.lines.length >= 2 && d > 1.3 * pitch(item)) continue;
      if (Math.min(item.x1, l.x1) - Math.max(item.x0, l.x0) < 0.3 * Math.min(item.width, l.x1 - l.x0)) continue;
      if (d < bestD) { best = item; bestD = d; }
    }
    if (best && !startsParagraph(best, l)) best.lines.push(l);
    else items.push(new Item([l]));
  }
  return items;
}
function startsParagraph(item, l) {
  const last = item.lines[item.lines.length - 1], em = l.size;
  if (LIST_START.test(l.words[0].text) && l.words.length > 1) return true;
  const bodyLeft = item.lines.length > 1 ? Math.min(...item.lines.slice(1).map((x) => x.x0)) : last.x0;
  const listItem = LIST_START.test(item.lines[0].words[0].text) || item.lines[0].tabs.length > 0;
  if (l.x0 > bodyLeft + 0.8 * em && !listItem && (item.lines.length > 1 || l.x0 > last.x0 + 0.8 * em)) return true;
  const right = Math.max(item.x1, l.x1), first = l.words[0].x1 - l.words[0].x0;
  return last.x1 + 0.3 * em + first < right - 0.5 * em && right - item.x0 > 10 * em;
}
function textItems(words) {
  const ls = lines(words);
  const items = paragraphs(ls);
  const joined = joinTabbedRows(ls, items);
  return joined ? paragraphs(joined) : items;
}

function gutters(items, left, right) {
  const width = right - left, narrow = items.filter((i) => i.width < width * 0.6);
  if (narrow.length < 2 || width < 100) return [];
  const bins = Math.ceil(width / 2), covered = new Array(bins).fill(false);
  for (const i of narrow) for (let b = Math.max(0, Math.floor((i.x0 - left) / 2)); b < Math.min(bins, Math.ceil((i.x1 - left) / 2)); b++) covered[b] = true;
  const out = [];
  const textHeight = Math.max(1, (Math.max(...items.map((i) => i.y1)) - Math.min(...items.map((i) => i.y0))) * 0.2);
  const height = (side) => side.reduce((s, i) => s + i.y1 - i.y0, 0), count = (side) => side.reduce((s, i) => s + Math.max(1, i.lines.length), 0);
  for (let b = 0; b < bins;) {
    if (covered[b]) { b++; continue; }
    const start = b;
    while (b < bins && !covered[b]) b++;
    const gl = left + start * 2, gr = left + b * 2;
    if (start === 0 || b >= bins || gr - gl < 6) continue;
    const ls = narrow.filter((i) => i.x1 <= gl + 1), rs = narrow.filter((i) => i.x0 >= gr - 1);
    const side = ls.some((l) => rs.some((r) => Math.min(l.y1, r.y1) - Math.max(l.y0, r.y0) > 2 * Math.max(l.size, r.size)));
    if (height(ls) >= textHeight && height(rs) >= textHeight && count(ls) >= 3 && count(rs) >= 3 && side) out.push({ start: gl, end: gr });
  }
  return out;
}

// Column by column between items spanning the columns; each item gets the edges of its column (cl, cr).
function readingOrder(items) {
  if (!items.length) return items;
  const left = Math.min(...items.map((i) => i.x0)), right = Math.max(...items.map((i) => i.x1));
  for (const i of items) { i.cl = left; i.cr = right; }
  const gs = gutters(items, left, right);
  if (!gs.length) return [...items].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const edges = [left, ...gs.flatMap((g) => [g.start, g.end]), right], n = edges.length / 2;
  const column = (i) => { const c = (i.x0 + i.x1) / 2; for (let k = 0; k < n; k++) if (c <= edges[2 * k + 1] + 1) return k; return n - 1; };
  const spans = (i) => gs.some((g) => i.x0 < g.start - 1 && i.x1 > g.end + 1);
  const inColumns = items.filter((i) => !spans(i));
  for (const i of inColumns) {
    const members = inColumns.filter((o) => column(o) === column(i));
    i.cl = Math.min(...members.map((o) => o.x0));
    i.cr = Math.max(...members.map((o) => o.x1));
  }
  const byColumn = (a, b) => column(a) - column(b) || a.y0 - b.y0;
  const out = [];
  let rest = inColumns;
  for (const sep of items.filter(spans).sort((a, b) => a.y0 - b.y0)) {
    out.push(...rest.filter((i) => i.y0 < sep.y0).sort(byColumn), sep);
    rest = rest.filter((i) => i.y0 >= sep.y0);
  }
  return [...out, ...rest.sort(byColumn)];
}

// Edge text repeated on most pages (digits ignored) unless display-sized, small running heads at one place on 3+ pages,
// page numbers, and the same picture at the same place on most pages (a logo).
function removeRepeated(pages) {
  const text = pages.filter((p) => !p.scanned);
  if (text.length < 2) return;
  const edge = (i, p) => i.y0 < p.height * 0.1 || i.y1 > p.height * 0.9;
  const key = (i) => i.text.replace(/\d+/g, '#').trim();
  const place = (i) => `${key(i)}|${Math.round(i.y0 / 2)}`;
  const picKey = (i) => `${[i.x0, i.y0, i.width, i.y1 - i.y0].map((v) => Math.round(v / 2))}:${crypto.createHash('sha256').update(i.pic.data).digest('hex')}`;
  const tally = (pics, f) => {
    const c = new Map();
    for (const p of text) for (const k of new Set(p.items.filter((i) => !i.pic === !pics && edge(i, p)).map(f))) c.set(k, (c.get(k) || 0) + 1);
    return c;
  };
  const counts = tally(false, key), places = tally(false, place), logos = tally(true, picKey);
  const body = bodySize(text.flatMap((p) => p.items.filter((i) => !i.pic)));
  const needed = Math.max(2, Math.ceil(text.length * 0.5));
  const running = (i) => i.lines.length <= 2 && ((counts.get(key(i)) >= needed && i.size < 1.5 * body) || (places.get(place(i)) >= 3 && i.size <= body + 0.5)
    || PAGE_NUMBER.test(i.text) || ROMAN_PAGE_NUMBER.test(i.text));
  for (const p of text) p.items = p.items.filter((i) => !(edge(i, p) && (i.pic ? logos.get(picKey(i)) >= needed : running(i))));
}
const bodySize = (items) => mainSize(items.flatMap((i) => i.lines.flatMap((l) => l.words)));

function pageRules(paths) {
  const rules = [], shades = [];
  for (const p of paths) {
    for (const { segs, curved } of p.subs) {
      if (p.stroke && !white(p.stroke)) {
        const t = Math.max(0.25, p.width);
        for (const [ax, ay, bx, by] of segs) {
          if (Math.abs(ay - by) <= 0.5 && Math.abs(ax - bx) >= MIN_RULE) rules.push({ h: true, pos: (ay + by) / 2, start: Math.min(ax, bx), end: Math.max(ax, bx), t, color: p.stroke, dashed: p.dashed });
          else if (Math.abs(ax - bx) <= 0.5 && Math.abs(ay - by) >= MIN_RULE) rules.push({ h: false, pos: (ax + bx) / 2, start: Math.min(ay, by), end: Math.max(ay, by), t, color: p.stroke, dashed: p.dashed });
        }
      }
      if (!p.fill || curved || segs.length < 3 || white(p.fill) || !segs.every(([ax, ay, bx, by]) => Math.abs(ax - bx) <= 0.5 || Math.abs(ay - by) <= 0.5)) continue;
      const xs = segs.flatMap((s) => [s[0], s[2]]), ys = segs.flatMap((s) => [s[1], s[3]]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), w = x1 - x0, h = y1 - y0;
      if (h <= MAX_RULE && w >= MIN_RULE && w > 2 * h) rules.push({ h: true, pos: (y0 + y1) / 2, start: x0, end: x1, t: Math.max(0.25, h), color: p.fill, dashed: false });
      else if (w <= MAX_RULE && h >= MIN_RULE && h > 2 * w) rules.push({ h: false, pos: (x0 + x1) / 2, start: y0, end: y1, t: Math.max(0.25, w), color: p.fill, dashed: false });
      else if (w > MAX_RULE && h > MAX_RULE) shades.push({ box: [x0, y0, x1, y1], color: p.fill });
    }
  }
  return { rules: joinRules(rules), shades };
}
function joinRules(rules) {
  const out = [];
  for (const h of [true, false]) {
    const sorted = rules.filter((r) => r.h === h).sort((a, b) => a.pos - b.pos);
    for (let i = 0; i < sorted.length;) {
      let j = i + 1;
      while (j < sorted.length && sorted[j].pos - sorted[j - 1].pos <= SAME_LINE) j++;
      let cur = null;
      for (const r of sorted.slice(i, j).sort((a, b) => a.start - b.start)) {
        if (cur && r.start <= cur.end + RULE_GAP) {
          const longer = r.end - r.start > cur.end - cur.start;
          cur = { ...cur, end: Math.max(cur.end, r.end), t: Math.max(cur.t, r.t), pos: longer ? r.pos : cur.pos, color: longer ? r.color : cur.color, dashed: cur.dashed && r.dashed };
        } else {
          if (cur) out.push(cur);
          cur = r;
        }
      }
      out.push(cur);
      i = j;
    }
  }
  return out;
}
function grids(rules) {
  const parent = rules.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  rules.forEach((a, i) => {
    if (!a.h) return;
    rules.forEach((b, k) => {
      const reach = RULE_GAP + Math.max(a.t, b.t) / 2;
      if (!b.h && b.pos >= a.start - reach && b.pos <= a.end + reach && a.pos >= b.start - reach && a.pos <= b.end + reach) parent[find(i)] = find(k);
    });
  });
  const groups = new Map();
  rules.forEach((r, i) => { const k = find(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  return [...groups.values()].filter((g) => g.some((r) => r.h) && g.some((r) => !r.h) && g.length >= 4);
}
function extent(group) {
  const H = group.filter((r) => r.h), V = group.filter((r) => !r.h);
  return [
    Math.min(...V.map((r) => r.pos), median(H.map((r) => r.start))), Math.min(...H.map((r) => r.pos), median(V.map((r) => r.start))),
    Math.max(...V.map((r) => r.pos), median(H.map((r) => r.end))), Math.max(...H.map((r) => r.pos), median(V.map((r) => r.end))),
  ];
}
const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
function edges(positions) {
  const groups = [];
  for (const p of [...positions].sort((a, b) => a - b)) {
    const g = groups[groups.length - 1];
    if (g && p - g[g.length - 1] <= EDGE) g.push(p); else groups.push([p]);
  }
  return groups.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
}
function covering(rules, pos, from, to) {
  if (to - from <= 0) return null;
  let covered = 0, best = null, bestLen = 0;
  for (const r of rules) {
    if (Math.abs(r.pos - pos) > EDGE + r.t / 2) continue;
    const o = Math.min(to, r.end) - Math.max(from, r.start);
    if (o <= 0) continue;
    covered += o;
    if (o > bestLen) { best = r; bestLen = o; }
  }
  return covered >= 0.5 * (to - from) ? best : null;
}

// A grid of rules as a table, merged cells where inner rules are missing; null unless text sits in 2+ rectangular cells.
function table(group, words, shades) {
  const ext = extent(group), H = group.filter((r) => r.h), V = group.filter((r) => !r.h);
  const xs = edges([...V.map((r) => r.pos).filter((x) => x > ext[0] && x < ext[2]), ext[0], ext[2]]);
  const ys = edges([...H.map((r) => r.pos).filter((y) => y > ext[1] && y < ext[3]), ext[1], ext[3]]);
  const vEdge = (c, r) => covering(V, xs[c], ys[r], ys[r + 1]) !== null, hEdge = (r, c) => covering(H, ys[r], xs[c], xs[c + 1]) !== null;
  const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
  for (;;) {
    const c = range(1, xs.length - 1).find((k) => !range(0, ys.length - 1).some((r) => vEdge(k, r)));
    if (c) { xs.splice(c, 1); continue; }
    const r = range(1, ys.length - 1).find((k) => !range(0, xs.length - 1).some((c2) => hEdge(k, c2)));
    if (!r) break;
    ys.splice(r, 1);
  }
  const rows = ys.length - 1, cols = xs.length - 1;
  if (rows < 2 || cols < 2 || rows * cols > 2500) return null;
  const parent = range(0, rows * cols);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && !vEdge(c + 1, r)) parent[find(r * cols + c)] = find(r * cols + c + 1);
      if (r + 1 < rows && !hEdge(r + 1, c)) parent[find(r * cols + c)] = find((r + 1) * cols + c);
    }
  }
  const units = new Map();
  for (let u = 0; u < rows * cols; u++) { const k = find(u); if (!units.has(k)) units.set(k, []); units.get(k).push(u); }
  const owner = [], cells = [];
  for (const unit of units.values()) {
    const rs = unit.map((u) => Math.floor(u / cols)), cs = unit.map((u) => u % cols);
    const top = Math.min(...rs), bottom = Math.max(...rs), left = Math.min(...cs), right = Math.max(...cs);
    if ((bottom - top + 1) * (right - left + 1) !== unit.length) return null;
    for (const u of unit) owner[u] = cells.length;
    cells.push({ r: top, c: left, rs: bottom - top + 1, cs: right - left + 1, box: [xs[left], ys[top], xs[right + 1], ys[bottom + 1]], words: [] });
  }
  if (cells.length < 4 && (new Set(cells.map((c) => c.r)).size < 2 || new Set(cells.map((c) => c.c)).size < 2)) return null;
  const box = [xs[0], ys[0], xs[cols], ys[rows]];
  for (const w of words) {
    const x = (w.x0 + w.x1) / 2, y = (w.y0 + w.y1) / 2;
    if (x <= box[0] || x >= box[2] || y <= box[1] || y >= box[3]) continue;
    const band = (w.y1 - w.y0) * 0.3;
    if (V.some((v) => v.pos > w.x0 + 1 && v.pos < w.x1 - 1 && v.start < y && v.end > y) || H.some((h) => h.pos > w.y0 + band && h.pos < w.y1 - band && h.start < w.x1 - 1 && h.end > w.x0 + 1)) return null;
    const c = clamp(xs.findLastIndex((e) => e <= x), 0, cols - 1), r = clamp(ys.findLastIndex((e) => e <= y), 0, rows - 1);
    cells[owner[r * cols + c]].words.push(w);
  }
  if (cells.filter((c) => c.words.length).length < 2) return null;
  for (const cell of cells) {
    const [x0, y0, x1, y1] = cell.box;
    cell.borders = { left: covering(V, x0, y0, y1), right: covering(V, x1, y0, y1), top: covering(H, y0, x0, x1), bottom: covering(H, y1, x0, x1) };
    cell.fill = shades.filter((s) => s.box[0] >= box[0] - EDGE && s.box[2] <= box[2] + EDGE && s.box[1] >= box[1] - EDGE && s.box[3] <= box[3] + EDGE && overlap(s.box, cell.box) >= 0.8 * area(cell.box)).pop()?.color || null;
  }
  const padding = clamp(Math.min(...cells.filter((c) => c.words.length).map((c) => Math.min(...c.words.map((w) => w.x0)) - c.box[0])), 1, 8);
  return { box, xs, ys, cells, padding };
}

// Largest grid first; a grid inside a found table stays text in its cell. Table words are taken out of `words`.
function ruledTables(paths, words) {
  const { rules, shades } = pageRules(paths);
  const out = [];
  for (const group of grids(rules).sort((a, b) => area(extent(b)) - area(extent(a)))) {
    const ext = extent(group);
    if (out.some((t) => Math.min(t.box[2], ext[2]) - Math.max(t.box[0], ext[0]) > EDGE && Math.min(t.box[3], ext[3]) - Math.max(t.box[1], ext[1]) > EDGE)) continue;
    const t = table(group, words, shades);
    if (!t) continue;
    out.push(t);
    const taken = new Set(t.cells.flatMap((c) => c.words));
    for (let i = words.length - 1; i >= 0; i--) if (taken.has(words[i])) words.splice(i, 1);
  }
  return out;
}

function pageLinks(page) {
  try { return page.getLinks().map((l) => ({ box: l.getBounds(), uri: l.getURI() || '' })).filter((l) => /^(https?:\/\/|mailto:)/i.test(l.uri)); } catch (_) { return []; }
}
// The page at 150 dpi on white, with annotations and form fields (at most 25 megapixels).
const render = (m, page, W, H) => { const s = Math.min(RENDER_DPI, 72 * Math.sqrt(25e6 / (W * H))) / 72; return page.toPixmap(m.Matrix.scale(s, s), m.ColorSpace.DeviceRGB, false, true); };

async function readPage(m, page) {
  const [bx0, by0, bx1, by1] = page.getBounds(), W = bx1 - bx0, H = by1 - by0;
  const rot = page.getObject().getInheritable('Rotate');
  const paint = pagePaint(m, page);
  const words = pageWords(page, paint.hidden, pageLinks(page));
  if (!words.length || (rot.isNumber() && rot.asNumber() % 180 !== 0)) return { width: W, height: H, scanned: true, scan: Buffer.from(render(m, page, W, H).asJPEG(85, false)) };
  const tables = ruledTables(paint.paths, words);
  const items = [...(words.length ? textItems(words) : []), ...tables.map((t) => new Item([], { table: t })), ...await pictures(m, page, paint.images, W, H)];
  return { width: W, height: H, items };
}

async function readDocument(doc, m, ctx) {
  const n = doc.countPages(), pages = [];
  for (let i = 0; i < n; i++) {
    pages.push(await readPage(m, doc.loadPage(i)));
    ctx?.progress?.((i + 1) / n * 0.8, `Reading page ${i + 1} of ${n}`);
  }
  removeRepeated(pages);
  for (const p of pages) if (!p.scanned) p.items = readingOrder(p.items);
  return { pages, title: (doc.getMetaData('info:Title') || '').trim() || null };
}

const cellItems = (cell, pad) => textItems(cell.words).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map((i) => Object.assign(i, { cl: cell.box[0] + pad, cr: cell.box[2] - pad }));
function pageTables(m, page) {
  const words = pageWords(page, new Set(), []);
  return ruledTables(pagePaint(m, page).paths, words).map((t) => ({
    box: t.box, rows: t.ys.length - 1, cols: t.xs.length - 1,
    cells: t.cells.map((c) => ({ r: c.r, c: c.c, rs: c.rs, cs: c.cs, text: cellItems(c, t.padding).map((i) => pieces(i).map((p) => (p.text === '\t' ? ' ' : p.text)).join('').trim()).join('\n') })),
  }));
}

// Runs of equal format; a line end is a space (none in CJK text or after a word-splitting hyphen), or a line break
// where the line ended early on purpose (an address).
function pieces(item) {
  const out = [];
  item.lines.forEach((l, li) => l.words.forEach((w, k) => {
    const last = out[out.length - 1];
    if (last) {
      if (k > 0 && l.tabs.includes(k)) out.push({ text: '\t', fmt: w.fmt, link: null });
      else if (k > 0) { if (w.x0 - l.words[k - 1].x1 > 0.1 * Math.min(w.size, l.words[k - 1].size)) last.text += ' '; }
      else if (/\p{L}-$/u.test(last.text) && /^\p{Ll}/u.test(w.text)) last.text = last.text.slice(0, -1);
      else if (last.text.endsWith('\u00ad')) last.text = last.text.slice(0, -1);
      else if (endedEarly(item, li)) out.push({ text: '\n', fmt: w.fmt, link: null });
      else if (!isCjk(last.text[last.text.length - 1]) && !isCjk(w.text[0])) last.text += ' ';
    }
    const script = w.size < 0.8 * l.size && (w.base < l.ref - 0.15 * l.size ? 'sup' : w.base > l.ref + 0.1 * l.size ? 'sub' : null);
    out.push({ text: w.text, fmt: script ? { ...w.fmt, size: Math.round(l.size * 2) / 2, script } : w.fmt, link: w.link });
  }));
  const groups = [];
  const lone = (p) => p.text === '\t' || p.text === '\n';
  for (const p of out) {
    const g = groups[groups.length - 1];
    if (g && !lone(g) && !lone(p) && sameFmt(g.fmt, p.fmt) && g.link === p.link) g.text += p.text; else groups.push({ ...p });
  }
  const tail = groups[groups.length - 1];
  if (tail && !lone(tail)) tail.text = tail.text.trimEnd();
  return groups;
}
function endedEarly(item, l) {
  const prev = item.lines[l - 1], cur = item.lines[l];
  if (prev.words[prev.words.length - 1].text.endsWith('-')) return false;
  const em = cur.size, end = prev.x1 + 0.3 * em + (cur.words[0].x1 - cur.words[0].x0);
  if (end < item.x1 - 0.5 * em) return true;
  return end < item.cr - 0.5 * em && item.cr - item.x1 > 0.25 * (item.cr - item.cl);
}
function headingLevels(items, body) {
  const sizes = [...new Set(items.filter((i) => i.lines.length <= 3 && i.text.length <= 200 && i.size >= body * 1.15 && i.size >= body + 1).map((i) => Math.round(i.size)))].sort((a, b) => b - a);
  return new Map(sizes.map((s, i) => [s, Math.min(6, i + 1)]));
}
function lineRatio(items) {
  const ratios = items.filter((i) => i.lines.length >= 2).map((i) => pitch(i) / i.size).filter((r) => r > 0.8 && r < 3);
  return ratios.length ? median(ratios) : 1.2;
}
function margins(pages) {
  const m = { left: Infinity, right: Infinity, top: Infinity, bottom: Infinity };
  for (const p of pages.filter((pg) => !pg.scanned && pg.items.length)) {
    m.left = Math.min(m.left, ...p.items.map((i) => i.x0));
    m.right = Math.min(m.right, ...p.items.map((i) => p.width - i.x1));
    m.top = Math.min(m.top, ...p.items.map((i) => i.y0));
    m.bottom = Math.min(m.bottom, ...p.items.map((i) => p.height - i.y1));
  }
  for (const k in m) m[k] = clamp(Number.isFinite(m[k]) ? m[k] : 72, 18, 108);
  return m;
}
function spaceBefore(item, prev, ratio = 1.2) {
  if (!prev || prev.y1 >= item.y0 + 1 || prev.x1 <= item.x0 || prev.x0 >= item.x1) return 0;
  const above = prev.lines.length ? prev.lines[prev.lines.length - 1].base + 0.25 * prev.size : prev.y1;
  const top = item.lines.length ? item.lines[0].base - 0.95 * item.size : item.y0;
  const extra = top - above - (item.lines.length && prev.lines.length ? (ratio - 1.2) * item.size : 0);
  return extra > 1 ? Math.min(extra, 72) : 0;
}
const tw = (pt) => Math.round(pt * 20);
const centred = (b, item) => { const cw = item.cr - item.cl; return Math.abs((b[0] + b[2]) / 2 - (item.cl + item.cr) / 2) < Math.max(6, cw * 0.05) && b[2] - b[0] < cw * 0.9; };

function runs(D, item) {
  const out = [];
  let link = null;
  for (const g of pieces(item)) {
    const run = g.text === '\t' ? new D.TextRun({ children: [new D.Tab()], size: g.fmt.size * 2 }) : g.text === '\n' ? new D.TextRun({ break: 1, size: g.fmt.size * 2 })
      : new D.TextRun({ text: g.text, bold: g.fmt.bold, italics: g.fmt.italic, size: g.fmt.size * 2, font: g.fmt.font || undefined, color: g.fmt.color, superScript: g.fmt.script === 'sup', subScript: g.fmt.script === 'sub' });
    if (g.link && g.text !== '\t' && g.text !== '\n') {
      if (!link || link.url !== g.link) out.push(link = { url: g.link, kids: [] });
      link.kids.push(run);
    } else { link = null; out.push(run); }
  }
  return out.map((o) => (o.kids ? new D.ExternalHyperlink({ link: o.url, children: o.kids }) : o));
}
function textParagraph(D, item, prev, levels, ratio, pageBreakBefore) {
  const size = item.size, ls = item.lines, cw = Math.max(1, item.cr - item.cl);
  const lefts = ls.map((l) => l.x0 - item.cl), rights = ls.map((l) => item.cr - l.x1), tol = Math.max(3, cw * 0.03);
  const level = ls.length <= 3 && item.text.length <= 200 ? levels.get(Math.round(size)) : undefined;
  let alignment = D.AlignmentType.LEFT, indent;
  if (ls.every((l, i) => Math.abs(lefts[i] - rights[i]) < tol) && Math.min(...lefts) > cw * 0.04) alignment = D.AlignmentType.CENTER;
  else if (rights.every((r) => r < 3) && Math.min(...lefts) > cw * 0.15) alignment = D.AlignmentType.RIGHT;
  else if (ls.length >= 2 && rights.slice(0, -1).every((r) => r < 2.5) && item.width > cw * 0.5) alignment = D.AlignmentType.JUSTIFIED;
  if (alignment === D.AlignmentType.LEFT || alignment === D.AlignmentType.JUSTIFIED) {
    const body = ls.length > 1 ? Math.min(...lefts.slice(1)) : lefts[0], first = lefts[0] - Math.max(0, body);
    if (body > 2 || Math.abs(first) > 2) indent = { left: body > 2 ? tw(body) : undefined, firstLine: first > 2 ? tw(first) : undefined, hanging: first < -2 ? tw(-first) : undefined };
  }
  const stops = [...new Set(ls.flatMap((l) => l.tabs.map((t) => tw(l.words[t].x0 - item.cl))))].sort((a, b) => a - b);
  const lineGap = ls.length >= 2 ? pitch(item) : size * ratio;
  return new D.Paragraph({
    heading: level ? D.HeadingLevel[`HEADING_${level}`] : undefined, alignment, indent, pageBreakBefore,
    tabStops: stops.length ? stops.map((position) => ({ type: D.TabStopType.LEFT, position })) : undefined,
    spacing: { before: tw(spaceBefore(item, prev, ratio)), after: 0, line: tw(clamp(lineGap, size, size * 3)), lineRule: D.LineRuleType.AT_LEAST },
    run: { size: Math.round(size * 2) }, children: runs(D, item),
  });
}
function pictureParagraph(D, item, prev, pageBreakBefore) {
  const [x0, y0, x1, y1] = item.pic.box;
  return new D.Paragraph({
    alignment: centred(item.pic.box, item) ? D.AlignmentType.CENTER : D.AlignmentType.LEFT, pageBreakBefore, spacing: { before: tw(spaceBefore(item, prev)), after: 0 },
    children: [new D.ImageRun({ type: item.pic.type, data: item.pic.data, transformation: { width: (x1 - x0) * 96 / 72, height: (y1 - y0) * 96 / 72 } })],
  });
}
function scanParagraph(D, page, pageBreakBefore) {
  const floating = { horizontalPosition: { relative: D.HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: D.VerticalPositionRelativeFrom.PAGE, offset: 0 }, behindDocument: true, allowOverlap: true, wrap: { type: D.TextWrappingType.NONE } };
  return new D.Paragraph({ pageBreakBefore, run: { size: 2 }, children: [new D.ImageRun({ type: 'jpg', data: page.scan, transformation: { width: page.width * 96 / 72, height: page.height * 96 / 72 }, floating })] });
}
function tableBlock(D, item, ratio) {
  const t = item.table, pad = t.padding, widths = t.xs.slice(1).map((x, c) => tw(x - t.xs[c]));
  const border = (r) => (r ? { style: r.dashed ? D.BorderStyle.DASHED : D.BorderStyle.SINGLE, size: clamp(Math.round(Math.max(0.2835, r.t) * 8), 2, 96), color: r.color } : { style: D.BorderStyle.NONE, size: 0, color: 'auto' });
  const rows = t.ys.slice(1).map(() => []);
  for (const cell of t.cells) {
    const items = cellItems(cell, pad);
    const children = items.map((p, k) => textParagraph(D, p, items[k - 1], new Map(), ratio));
    let verticalAlign = D.VerticalAlignTable.TOP;
    if (items.length) {
      const above = Math.min(...items.map((i) => i.y0)) - cell.box[1], below = cell.box[3] - Math.max(...items.map((i) => i.y1));
      if (above >= 0 && below >= 0 && Math.abs(above - below) <= Math.max(2, 0.25 * (above + below)) && above + below > 4) verticalAlign = D.VerticalAlignTable.CENTER;
      else if (above >= 0 && below >= 0 && below < 0.4 * above && above > items[0].size * 1.5) verticalAlign = D.VerticalAlignTable.BOTTOM;
    }
    rows[cell.r].push(new D.TableCell({
      columnSpan: cell.cs > 1 ? cell.cs : undefined, rowSpan: cell.rs > 1 ? cell.rs : undefined, verticalAlign,
      borders: { top: border(cell.borders.top), bottom: border(cell.borders.bottom), left: border(cell.borders.left), right: border(cell.borders.right) },
      shading: cell.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: cell.fill } : undefined,
      width: { size: widths.slice(cell.c, cell.c + cell.cs).reduce((s, v) => s + v, 0), type: D.WidthType.DXA },
      children: children.length ? children : [new D.Paragraph({})],
    }));
  }
  const center = centred(t.box, item), indent = t.box[0] - item.cl;
  return new D.Table({
    layout: D.TableLayoutType.FIXED, columnWidths: widths, width: { size: widths.reduce((s, v) => s + v, 0), type: D.WidthType.DXA },
    alignment: center ? D.AlignmentType.CENTER : undefined, indent: !center && indent > 2 ? { size: tw(indent), type: D.WidthType.DXA } : undefined,
    borders: D.TableBorders.NONE, margins: { left: tw(pad), right: tw(pad), top: 20, bottom: 20 },
    rows: rows.map((cells, r) => new D.TableRow({ height: { value: tw(t.ys[r + 1] - t.ys[r]), rule: D.HeightRule.ATLEAST }, children: cells })),
  });
}

function wordDocument(layout) {
  const D = require('docx');
  const text = layout.pages.flatMap((p) => (p.scanned ? [] : p.items.filter((i) => !i.pic && !i.table)));
  const body = bodySize(text), levels = headingLevels(text, body), margin = margins(layout.pages), ratio = lineRatio(text);
  const sections = [];
  let sec = null;
  for (const page of layout.pages) {
    const fresh = !sec || Math.abs(sec.w - page.width) > 0.5 || Math.abs(sec.h - page.height) > 0.5;
    if (fresh) sections.push(sec = { w: page.width, h: page.height, children: [] });
    const out = sec.children, first = out.length, brk = fresh ? undefined : true;
    if (page.scanned) out.push(scanParagraph(D, page, brk));
    else {
      let prev = null;
      for (const item of page.items) {
        const start = out.length === first ? brk : undefined;
        if (item.table) {
          if (start) out.push(new D.Paragraph({ pageBreakBefore: true, run: { size: 2 }, spacing: { before: 0, after: 0, line: 20, lineRule: D.LineRuleType.EXACT } }));
          out.push(tableBlock(D, item, ratio));
        } else out.push(item.pic ? pictureParagraph(D, item, prev, start) : textParagraph(D, item, prev, levels, ratio, start));
        prev = item;
      }
      if (out.length === first) out.push(new D.Paragraph({ pageBreakBefore: brk }));
    }
  }
  if (!sections.length) sections.push({ w: 595, h: 842, children: [new D.Paragraph({})] });
  const tws = { top: tw(margin.top), right: tw(margin.right), bottom: tw(margin.bottom), left: tw(margin.left) };
  return new D.Document({
    creator: 'Lime', title: layout.title || undefined,
    styles: { default: { document: { run: { font: 'Calibri', size: Math.round(body * 2) } } } },
    sections: sections.map((s) => ({
      properties: { page: { size: s.w > s.h ? { width: tw(s.h), height: tw(s.w), orientation: D.PageOrientation.LANDSCAPE } : { width: tw(s.w), height: tw(s.h) }, margin: tws } },
      children: s.children,
    })),
  });
}

module.exports = { fontFamily, readDocument, wordDocument, pageTables };
