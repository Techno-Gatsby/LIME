'use strict';
// PDF work that leans on qpdf and Ghostscript as well as MuPDF: repair, fast web view,
// a stronger Strong compression and PDF/A for files PdfCraft alone can't make compliant.
const U = require('./util');
const { fsp, path } = U;
const C = require('./codecs');
const pdf = () => require('./pdf');

async function look(buf) {
  try {
    const m = await pdf().mupdf(), d = m.Document.openDocument(buf, 'application/pdf');
    if (d.needsPassword()) return { pages: 0, text: '' };
    let text = '';
    const pages = d.countPages();
    for (let i = 0; i < pages; i++) { try { text += d.loadPage(i).toStructuredText('').asText(); } catch (_) {} }
    let forms = false;
    try { const a = d.getTrailer().get('Root').get('AcroForm'); forms = a.isDictionary() && a.get('Fields').length > 0; } catch (_) {}
    return { pages, text: text.replace(/\s+/g, ' ').trim(), forms };
  } catch (_) { return null; }
}
const words = (t) => t.split(' ').filter(Boolean);
function sameText(a, b) {
  if (a === b) return true;
  const x = words(a), y = new Set(words(b));
  return x.length > 0 && x.filter((w) => y.has(w)).length / x.length >= 0.98;
}
async function renders(buf, n = 4) {
  const m = await pdf().mupdf(), d = m.Document.openDocument(buf, 'application/pdf'), out = [];
  for (let i = 0; i < Math.min(n, d.countPages()); i++) out.push(Buffer.from(d.loadPage(i).toPixmap(m.Matrix.scale(0.75, 0.75), m.ColorSpace.DeviceRGB, false).asPNG()));
  return out;
}
// Mean absolute difference of the first pages, drawn small: catches lost pictures, marks and fonts.
async function looksSame(a, b) {
  const sharp = require('sharp'), x = await renders(a), y = await renders(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    const p = await sharp(x[i]).raw().toBuffer({ resolveWithObject: true });
    const q = await sharp(y[i]).resize(p.info.width, p.info.height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    let d = 0;
    for (let k = 0; k < q.length; k++) d += Math.abs(p.data[k] - q[k]);
    if (d / q.length > 6) return false;
  }
  return true;
}

// Each way of rebuilding is tried and the one that keeps the most pages and text wins.
async function repair(input, out, opts = {}, ctx) {
  const src = await fsp.readFile(input), cands = [];
  const add = async (how, buf) => { const l = buf && await look(buf); if (l && l.pages) cands.push({ how, buf, ...l }); };
  ctx?.progress?.(0.1, 'Checking the file');
  await add('qpdf', await C.qpdf(input, [], opts.password).then((r) => r.pdf).catch(() => null));
  ctx?.progress?.(0.4, 'Rebuilding');
  const m = await pdf().mupdf();
  let mu = null;
  try {
    const d = m.Document.openDocument(src, 'application/pdf');
    if (d.needsPassword() && !d.authenticatePassword(opts.password || '')) throw Object.assign(new Error(`${path.basename(input)} is password-protected. Enter its password in the options.`), { code: 'PASSWORD' });
    for (const how of ['garbage=deduplicate,compress=yes,clean=yes', 'garbage=compact,compress=yes', 'compress=yes']) {
      try { mu = Buffer.from(d.saveToBuffer(how).asUint8Array()); break; } catch (_) {}
    }
    if (!mu) {
      const fresh = new m.PDFDocument(), g = fresh.newGraftMap();
      for (let i = 0; i < d.countPages(); i++) { try { g.graftPage(-1, d, i); } catch (_) {} }
      if (fresh.countPages()) mu = Buffer.from(fresh.saveToBuffer('garbage=compact,compress=yes').asUint8Array());
    }
  } catch (e) { if (e.code === 'PASSWORD') throw e; }
  await add('mupdf', mu);
  if (mu) {
    ctx?.progress?.(0.7, 'Tidying');
    const tmp = path.join(await U.tmpDir('repair'), 'mu.pdf');
    try { await fsp.writeFile(tmp, mu); await add('mupdf+qpdf', await C.qpdf(tmp, ['--object-streams=generate']).then((r) => r.pdf).catch(() => null)); } finally { fsp.rm(path.dirname(tmp), { recursive: true, force: true }).catch(() => {}); }
  }
  if (!cands.length) throw new Error(`${path.basename(input)} is too damaged to rebuild: no pages could be read.`);
  const best = cands.sort((a, b) => b.pages - a.pages || b.text.length - a.text.length || (a.how === 'mupdf+qpdf' ? -1 : b.how === 'mupdf+qpdf' ? 1 : 0))[0];
  await fsp.writeFile(out, best.buf);
  const was = await look(src);
  return { path: out, note: `${was?.pages ? 'Rebuilt' : 'Recovered'} ${best.pages} page${best.pages === 1 ? '' : 's'}` };
}

// Linearised: a browser shows page one while the rest is still arriving.
async function webView(input, out, opts = {}) {
  const r = await C.qpdf(input, ['--linearize', '--object-streams=generate', '--compress-streams=y'], opts.password);
  if (!/\/Linearized\s/.test(r.pdf.subarray(0, 2048).toString('latin1'))) throw new Error('qpdf couldn’t make this PDF ready for fast web view.');
  await fsp.writeFile(out, r.pdf);
  return { path: out, note: `Ready for fast web view · ${U.fmtBytes(r.pdf.length)}` };
}

// Strong also tries Ghostscript first (it subsets fonts and rewrites page drawing), then Lime's own
// picture recompression on top. Its result is used only if it keeps the pages, text and look.
async function compress(input, opts, out, ctx) {
  const res = await pdf().compress(input, opts, out, ctx);
  if ((opts.level || 'recommended') !== 'extreme' || !C.hasGhostscript()) return res;
  const dir = await U.tmpDir('gscompress');
  try {
    const src = await fsp.readFile(input), before = await look(src);
    if (!before?.pages || before.forms) return res;
    ctx?.progress?.(0.85, 'Trying Ghostscript');
    const r = await C.ghostscript(['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.7', '-dPDFSETTINGS=/ebook', '-dDetectDuplicateImages=true', ...(opts.password ? [`-sPDFPassword=${opts.password}`] : []), '-sOutputFile=/o.pdf', '/i.pdf'], { '/i.pdf': src }, ['/o.pdf']);
    if (r.code || !r.files['/o.pdf']) return res;
    const mid = path.join(dir, 'gs.pdf'), fin = path.join(dir, 'fin.pdf');
    await fsp.writeFile(mid, r.files['/o.pdf']);
    await pdf().compress(mid, { level: 'extreme' }, fin, null);
    const buf = await fsp.readFile(fin), mine = (await fsp.stat(out)).size;
    if (buf.length >= mine * 0.95) return res;
    const after = await look(buf);
    if (!after || after.pages !== before.pages || !sameText(before.text, after.text) || !(await looksSame(src, buf))) return res;
    await fsp.writeFile(out, buf);
    return { path: out, note: `${U.fmtBytes(src.length)} → ${U.fmtBytes(buf.length)} (${Math.round((1 - buf.length / src.length) * 100)}% smaller)` };
  } catch (_) { return res; } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

const PDFA_DEF = `%!
/ICCProfile (%rom%iccprofiles/srgb.icc) def
[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark
[{icc_PDFA} <</N 3>> /PUT pdfmark
[{icc_PDFA} ICCProfile (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark
[{OutputIntent_PDFA} << /Type /OutputIntent /S /GTS_PDFA1 /DestOutputProfile {icc_PDFA} /OutputConditionIdentifier (sRGB) >> /PUT pdfmark
[{Catalog} <</OutputIntents [ {OutputIntent_PDFA} ]>> /PUT pdfmark
`;
const verify = async (file, level, ctx) => (await require('./crafts').pdfScript([{ tool: 'doc_open', args: { path: file } }, { tool: 'pdfa_verify', args: { doc: 1, level } }], ctx, 'Checking'))[1] || {};
const issuesOf = (v) => [...new Set((v?.issues || []).map((i) => i.message))];
// PdfCraft first; when it can't meet the standard (fonts that aren't embedded, mostly), Ghostscript
// embeds matching fonts and an sRGB profile, and PdfCraft checks the result.
async function toPdfA(p, opts, ctx) {
  const crafts = require('./crafts'), level = opts.level === '3b' ? '3b' : '2b';
  let first = null;
  try { first = await crafts.toPdfA(p, opts, ctx); if (/checked: no issues/.test(first.note || '')) return first; } catch (e) { if (!C.hasGhostscript()) throw e; }
  if (!C.hasGhostscript()) return first;
  const out = first?.path || ctx.out.file(p, `${U.base(p)}-pdfa.pdf`), dir = await U.tmpDir('pdfa');
  try {
    ctx.progress?.(0.6, 'Embedding fonts with Ghostscript');
    const src = await fsp.readFile(p);
    const r = await C.ghostscript([`-dPDFA=${level[0]}`, '-dPDFACompatibilityPolicy=1', '-sColorConversionStrategy=RGB', '-sDEVICE=pdfwrite', ...(opts.password ? [`-sPDFPassword=${opts.password}`] : []), '-sOutputFile=/o.pdf', '/pdfa.ps', '/i.pdf'], { '/i.pdf': src, '/pdfa.ps': PDFA_DEF }, ['/o.pdf']);
    if (r.code || !r.files['/o.pdf']) return first || Promise.reject(new Error('This PDF couldn’t be saved as PDF/A.'));
    const tmp = path.join(dir, 'gs.pdf');
    await fsp.writeFile(tmp, r.files['/o.pdf']);
    const before = await look(src), after = await look(r.files['/o.pdf']);
    if (!after || after.pages !== before?.pages || !sameText(before.text, after.text)) return first;
    const v = await verify(tmp, level, ctx);
    if (!v.compliant && first) return first;
    await fsp.copyFile(tmp, out);
    return { path: out, note: v.compliant ? `PDF/A-${level}, checked: no issues` : `Saved as PDF/A-${level}, but ${issuesOf(v).slice(0, 3).join('; ')}` };
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { repair, webView, compress, toPdfA, look, sameText, looksSame };
