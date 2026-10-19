'use strict';
const U = require('./util');
const OE = require('./engines-optional');
const { fs, fsp, path } = U;
const { pathToFileURL } = require('url');

/* ---------- LibreOffice ---------- */
let loQueue = Promise.resolve();
/** LibreOffice can only run one headless conversion per profile at a time, so calls are serialised. */
function soffice(input, toSpec, outDir, opts = {}) {
  const run = async () => {
    const bin = OE.libreOfficePath();
    if (!bin) throw OE.missing('libreoffice', 'This conversion needs LibreOffice.');
    const profile = path.join(U.cfg.user, 'lo-profile');
    await fsp.mkdir(profile, { recursive: true });
    const args = ['--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard', `-env:UserInstallation=${pathToFileURL(profile).href}`];
    if (opts.infilter) args.push(`--infilter=${opts.infilter}`);
    args.push('--convert-to', toSpec, '--outdir', outDir, input);
    await U.run(bin, args, { signal: opts.signal, errorMessage: 'LibreOffice couldn’t convert this file' });
    const stem = path.basename(input, path.extname(input));
    const ext = toSpec.split(':')[0];
    const produced = path.join(outDir, `${stem}.${ext}`);
    if (!fs.existsSync(produced)) throw new Error('LibreOffice finished without producing a file. The document may be damaged or password-protected.');
    return produced;
  };
  const p = loQueue.then(run, run);
  loQueue = p.catch(() => {});
  return p;
}
async function viaLibreOffice(input, to, ctx, opts = {}) {
  const tmp = await U.tmpDir('lo');
  try {
    const filters = {
      docx: 'docx:MS Word 2007 XML', doc: 'doc:MS Word 97', odt: 'odt', rtf: 'rtf', txt: 'txt:Text (encoded):UTF8', html: 'html:XHTML Writer File:UTF8', epub: 'epub',
      xlsx: 'xlsx:Calc MS Excel 2007 XML', xls: 'xls:MS Excel 97', ods: 'ods', csv: 'csv:Text - txt - csv (StarCalc):44,34,76,1',
      pptx: 'pptx:Impress MS PowerPoint 2007 XML', ppt: 'ppt:MS PowerPoint 97', odp: 'odp', png: 'png', jpg: 'jpg', svg: 'svg',
      pdf: opts.pdfa ? 'pdf:writer_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}' : 'pdf',
    };
    let spec = filters[to] || to;
    const g = U.groupOf(input);
    if (to === 'pdf' && opts.pdfa) {
      const exp = g === 'sheet' ? 'calc_pdf_Export' : g === 'slides' ? 'impress_pdf_Export' : g === 'vector' ? 'draw_pdf_Export' : 'writer_pdf_Export';
      spec = `pdf:${exp}:{"SelectPdfVersion":{"type":"long","value":"2"}}`;
    }
    ctx?.progress(0.2, 'Converting with LibreOffice');
    const produced = await soffice(input, spec, tmp, { infilter: opts.infilter, signal: ctx?.signal });
    const out = opts.out || ctx.out.file(input, `${U.base(input)}.${to}`);
    await fsp.copyFile(produced, out);
    return out;
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

/* ---------- Pandoc ---------- */
async function viaPandoc(input, to, ctx) {
  const bin = OE.pandocPath();
  if (!bin) throw OE.missing('pandoc', 'This conversion needs Pandoc.');
  const out = ctx.out.file(input, `${U.base(input)}.${to}`);
  const from = { md: 'markdown', markdown: 'markdown', txt: 'markdown', htm: 'html', tex: 'latex', rst: 'rst', org: 'org', fb2: 'fb2' }[U.ext(input)];
  const args = [input, '-o', out, '--standalone'];
  if (from) args.push('-f', from);
  if (to === 'md') args.push('-t', 'gfm');
  if (to === 'epub') args.push('--metadata', `title=${U.base(input)}`);
  if (to === 'pdf') throw new Error('Use Document to PDF for PDF output.');
  await U.run(bin, args, { cwd: path.dirname(input), signal: ctx?.signal, errorMessage: 'Pandoc couldn’t convert this file' });
  return out;
}

/* ---------- built-in fallbacks ---------- */
const PRINT_CSS = `body{font:11pt/1.5 "Segoe UI",Calibri,Arial,sans-serif;color:#1b1b1b;margin:0}img{max-width:100%}table{border-collapse:collapse;width:100%;font-size:9.5pt}th,td{border:1px solid #c8c8c8;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f3f3f3}pre,code{font-family:Consolas,monospace;font-size:9.5pt}pre{white-space:pre-wrap;background:#f6f6f6;padding:10px;border-radius:4px}h1,h2,h3{line-height:1.2}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:12px;color:#555}`;
const htmlDoc = (title, body, css = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${PRINT_CSS}${css}</style></head><body>${body}</body></html>`;
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function htmlToPdf(html, out, ctx, opts = {}) {
  if (!ctx?.host) throw new Error('HTML rendering is only available in the app.');
  const tmp = await U.tmpDir('html');
  const file = path.join(tmp, 'page.html');
  await fsp.writeFile(file, html, 'utf8');
  try {
    await ctx.host('htmlToPdf', { file, out, landscape: !!opts.landscape, pageSize: opts.pageSize || 'A4', margins: opts.margins || 'default' });
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
  return out;
}
async function docxToHtml(input) {
  const mammoth = require('mammoth');
  const { value } = await mammoth.convertToHtml({ path: input }, { convertImage: mammoth.images.dataUri });
  return value;
}
async function markdownToHtml(md) {
  const { marked } = require('marked');
  return marked.parse(md, { gfm: true });
}
function stripMarkdown(md) {
  return md.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1 ($2)').replace(/(\*\*|__)(.*?)\1/g, '$2').replace(/`([^`]+)`/g, '$1').replace(/^>\s?/gm, '');
}
function htmlToText(html) {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- spreadsheets (SheetJS) ---------- */
function readBook(input) {
  const XLSX = require('xlsx');
  const e = U.ext(input);
  return XLSX.readFile(input, { cellDates: true, dense: false, raw: e === 'csv' || e === 'tsv' ? false : undefined, FS: e === 'tsv' ? '\t' : undefined });
}
async function convertSheet(input, to, ctx, opts = {}) {
  const XLSX = require('xlsx');
  const wb = readBook(input);
  const names = wb.SheetNames;
  if (['csv', 'tsv', 'txt', 'json'].includes(to) && names.length > 1 && opts.allSheets !== false) {
    const folder = ctx.out.folder(input, `${U.base(input)} - sheets`);
    for (const n of names) await writeSheet(XLSX, wb.Sheets[n], to, path.join(folder, `${U.sanitize(n)}.${to}`));
    return folder;
  }
  const out = ctx.out.file(input, `${U.base(input)}.${to}`);
  if (['xlsx', 'xls', 'ods', 'xlsb', 'xlsm', 'fods'].includes(to)) { XLSX.writeFile(wb, out, { bookType: to === 'xls' ? 'biff8' : to, compression: true }); return out; }
  if (to === 'html') { await fsp.writeFile(out, htmlDoc(U.base(input), names.map((n) => `<h2>${escHtml(n)}</h2>${XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })}`).join(''))); return out; }
  if (to === 'pdf') {
    if (OE.libreOfficePath()) return viaLibreOffice(input, 'pdf', ctx, { out });
    const body = names.map((n) => `<h2>${escHtml(n)}</h2>${XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })}`).join('<div style="page-break-after:always"></div>');
    return htmlToPdf(htmlDoc(U.base(input), body, 'body{font-size:9pt}'), out, ctx, { landscape: true });
  }
  return writeSheet(XLSX, wb.Sheets[names[0]], to, out);
}
async function writeSheet(XLSX, ws, to, out) {
  if (to === 'json') await fsp.writeFile(out, JSON.stringify(XLSX.utils.sheet_to_json(ws, { defval: '' }), null, 2));
  else if (to === 'tsv' || to === 'txt') await fsp.writeFile(out, XLSX.utils.sheet_to_csv(ws, { FS: '\t' }));
  else await fsp.writeFile(out, `\ufeff${XLSX.utils.sheet_to_csv(ws)}`);
  return out;
}
async function mergeSheets(inputs, opts, ctx) {
  const XLSX = require('xlsx');
  const out = ctx.out.file(inputs[0], `${opts.mode === 'stack' ? 'Combined' : 'Merged'} workbook.${opts.to || 'xlsx'}`);
  const wb = XLSX.utils.book_new();
  if (opts.mode === 'stack') {
    const rows = [];
    inputs.forEach((p, i) => {
      const src = readBook(p);
      const aoa = XLSX.utils.sheet_to_json(src.Sheets[src.SheetNames[0]], { header: 1, defval: '' });
      rows.push(...(i && opts.skipHeaders !== false ? aoa.slice(1) : aoa));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Combined');
  } else {
    const used = new Set();
    for (const p of inputs) {
      const src = readBook(p);
      for (const n of src.SheetNames) {
        let name = (src.SheetNames.length > 1 ? `${U.base(p)} ${n}` : U.base(p)).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
        let k = 2;
        while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${k++}`;
        used.add(name.toLowerCase());
        XLSX.utils.book_append_sheet(wb, src.Sheets[n], name);
      }
    }
  }
  XLSX.writeFile(wb, out, { compression: true });
  return out;
}

/* ---------- the router ---------- */
const LO_IN = new Set([...U.GROUPS.doc, ...U.GROUPS.sheet, ...U.GROUPS.slides, ...U.GROUPS.vector].filter((e) => !['md', 'markdown', 'epub', 'tex', 'rst', 'org', 'fb2'].includes(e)));
const PANDOC_IN = new Set(['md', 'markdown', 'docx', 'odt', 'html', 'htm', 'epub', 'rtf', 'tex', 'rst', 'org', 'fb2', 'txt']);
const PANDOC_OUT = new Set(['md', 'docx', 'odt', 'html', 'epub', 'rtf', 'tex', 'rst', 'txt']);

async function convertDocument(input, opts, ctx) {
  const to = opts.to;
  const from = U.ext(input);
  const g = U.groupOf(input);
  if (from === to) throw new Error(`This file is already ${to.toUpperCase()}.`);
  if (g === 'sheet' && ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'html', 'pdf', 'xlsb', 'txt'].includes(to)) return convertSheet(input, to, ctx, opts);
  const lo = OE.libreOfficePath();
  const pandoc = OE.pandocPath();
  const out = (e) => ctx.out.file(input, `${U.base(input)}.${e}`);

  // Pandoc is best for ebooks and markup formats
  if ((to === 'epub' || from === 'epub' || ['md', 'markdown', 'tex', 'rst', 'org'].includes(from) || (to === 'md' && from !== 'html')) && pandoc && PANDOC_IN.has(from) && PANDOC_OUT.has(to)) return viaPandoc(input, to, ctx);
  // LibreOffice for Office fidelity
  if (lo && LO_IN.has(from) && to !== 'md' && to !== 'epub') return viaLibreOffice(input, to, ctx, { pdfa: opts.pdfa });
  if (lo && from === 'epub' && to === 'pdf' && pandoc) {
    const tmp = await viaPandoc(input, 'docx', { ...ctx, out: { file: (s, n) => path.join(U.cfg.tmp, `${Date.now()}-${n}`) } });
    return viaLibreOffice(tmp, 'pdf', ctx, { out: out('pdf') });
  }

  // Built-in paths (no extra engines)
  if (from === 'docx' || from === 'docm' || from === 'dotx') {
    if (to === 'html') { const p = out('html'); await fsp.writeFile(p, htmlDoc(U.base(input), await docxToHtml(input))); return p; }
    if (to === 'txt') { const mammoth = require('mammoth'); const { value } = await mammoth.extractRawText({ path: input }); const p = out('txt'); await fsp.writeFile(p, `\ufeff${value}`); return p; }
    if (to === 'md') { const mammoth = require('mammoth'); const { value } = await mammoth.convertToMarkdown({ path: input }); const p = out('md'); await fsp.writeFile(p, value); return p; }
    if (to === 'pdf') return htmlToPdf(htmlDoc(U.base(input), await docxToHtml(input)), out('pdf'), ctx);
  }
  if (from === 'md' || from === 'markdown') {
    const md = await fsp.readFile(input, 'utf8');
    if (to === 'html') { const p = out('html'); await fsp.writeFile(p, htmlDoc(U.base(input), await markdownToHtml(md))); return p; }
    if (to === 'pdf') return htmlToPdf(htmlDoc(U.base(input), await markdownToHtml(md)), out('pdf'), ctx);
    if (to === 'txt') { const p = out('txt'); await fsp.writeFile(p, stripMarkdown(md)); return p; }
  }
  if (from === 'html' || from === 'htm' || from === 'xhtml') {
    const html = await fsp.readFile(input, 'utf8');
    if (to === 'pdf') { const o = out('pdf'); await ctx.host('htmlToPdf', { file: input, out: o }); return o; }
    if (to === 'txt') { const p = out('txt'); await fsp.writeFile(p, htmlToText(html)); return p; }
  }
  if (from === 'txt' || from === 'log' || from === 'csv') {
    const txt = await fsp.readFile(input, 'utf8');
    if (to === 'pdf') return htmlToPdf(htmlDoc(U.base(input), `<pre style="white-space:pre-wrap;font:10pt/1.45 Consolas,monospace;background:none;padding:0">${escHtml(txt)}</pre>`), out('pdf'), ctx);
    if (to === 'html') { const p = out('html'); await fsp.writeFile(p, htmlDoc(U.base(input), `<pre style="white-space:pre-wrap">${escHtml(txt)}</pre>`)); return p; }
    if (to === 'md') { const p = out('md'); await fsp.copyFile(input, p); return p; }
  }
  if (pandoc && PANDOC_IN.has(from) && PANDOC_OUT.has(to)) return viaPandoc(input, to, ctx);
  if (!lo && (LO_IN.has(from) || to === 'pdf')) throw OE.missing('libreoffice', `Converting ${from.toUpperCase()} to ${to.toUpperCase()} needs LibreOffice for an accurate result.`);
  if (!pandoc && (from === 'epub' || to === 'epub')) throw OE.missing('pandoc', `Converting ${from.toUpperCase()} to ${to.toUpperCase()} needs Pandoc.`);
  throw new Error(`Clementine can’t convert ${from.toUpperCase()} to ${to.toUpperCase()} yet.`);
}
/** Anything → PDF (used by Merge documents and the Convert wheel). */
async function anyToPdf(input, ctx, outPath) {
  const g = U.groupOf(input);
  const sub = outPath ? { ...ctx, out: { file: () => outPath, folder: ctx.out.folder, dirFor: ctx.out.dirFor } } : ctx;
  if (g === 'pdf') { if (outPath) await fsp.copyFile(input, outPath); return outPath || input; }
  if (g === 'image' || g === 'raw') return require('./pdf').imagesToPdf([input], { pageSize: 'fit' }, outPath || ctx.out.file(input, `${U.base(input)}.pdf`), ctx);
  return convertDocument(input, { to: 'pdf' }, sub);
}
async function urlToPdf(url, opts, ctx) {
  let u = String(url || '').trim();
  if (!u) throw new Error('Enter a web address.');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  let host;
  try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (_) { throw new Error('That isn’t a valid web address.'); }
  const out = ctx.out.file(null, `${host}.${opts.format === 'png' ? 'png' : 'pdf'}`);
  ctx.progress(0.2, `Loading ${host}`);
  await ctx.host(opts.format === 'png' ? 'urlToImage' : 'htmlToPdf', { url: u, out, landscape: opts.landscape, pageSize: opts.pageSize || 'A4', fullPage: true });
  return out;
}

module.exports = { soffice, viaLibreOffice, viaPandoc, convertDocument, convertSheet, mergeSheets, anyToPdf, urlToPdf, htmlToPdf, docxToHtml, markdownToHtml, readBook };
