'use strict';
const U = require('./util');
const { fs, fsp, path } = U;
const { pathToFileURL } = require('url');
const isMac = process.platform === 'darwin';

const home = require('os').homedir(), env = process.env;
const isFile = (p) => { try { return !!p && fs.statSync(p).isFile(); } catch (_) { return false; } };
const onPath = (names) => String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean).flatMap((d) => names.map((n) => path.join(d, n))).find(isFile) || null;
const subdirs = (d, re) => { try { return fs.readdirSync(d).filter((n) => re.test(n)).map((n) => path.join(d, n)); } catch (_) { return []; } };
const programDirs = () => [...new Set([env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')].filter(Boolean))];
function regDefault(key) {
  try { return /REG_(?:EXPAND_)?SZ\s+(.+)/.exec(require('child_process').execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 4000 }))?.[1].trim() || null; } catch (_) { return null; }
}
let loFound = null;
function libreOfficePath() {
  if (env.LIME_NO_LO) return null;
  if (isFile(U.cfg.soffice)) return U.cfg.soffice;
  if (isFile(loFound)) return loFound;
  const c = ['/Applications/LibreOffice.app/Contents/MacOS/soffice', path.join(home, 'Applications/LibreOffice.app/Contents/MacOS/soffice'), '/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice'];
  if (U.isWin) {
    for (const b of programDirs()) for (const d of subdirs(b, /^libreoffice/i)) c.push(path.join(d, 'program', 'soffice.exe'));
    for (const k of ['HKLM\\SOFTWARE\\LibreOffice\\UNO\\InstallPath', 'HKLM\\SOFTWARE\\WOW6432Node\\LibreOffice\\UNO\\InstallPath', 'HKCU\\SOFTWARE\\LibreOffice\\UNO\\InstallPath']) { const v = regDefault(k); if (v) c.push(path.join(v, 'soffice.exe')); }
  }
  return (loFound = c.find(isFile) || onPath(U.isWin ? ['soffice.exe'] : ['soffice', 'libreoffice']));
}
let pandocFound = null;
function pandocPath() {
  if (isFile(U.cfg.pandoc)) return U.cfg.pandoc;
  if (isFile(pandocFound)) return pandocFound;
  const c = ['/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc', '/usr/bin/pandoc', '/opt/local/bin/pandoc', path.join(home, '.local/bin/pandoc'), path.join(home, '.cabal/bin/pandoc')];
  if (U.isWin) c.push(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Pandoc', 'pandoc.exe'), ...programDirs().map((b) => path.join(b, 'Pandoc', 'pandoc.exe')), env.ProgramData && path.join(env.ProgramData, 'chocolatey', 'bin', 'pandoc.exe'), path.join(home, 'scoop', 'shims', 'pandoc.exe'), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'pandoc.exe'));
  return (pandocFound = c.find(isFile) || onPath([U.isWin ? 'pandoc.exe' : 'pandoc']));
}
const iworkPath = (app) => (isMac && ['/Applications', '/System/Applications'].map((d) => path.join(d, `${app}.app`)).find((p) => fs.existsSync(p))) || null;
const missing = (why) => Object.assign(new Error(why), { code: 'ENGINE_MISSING' });

let loQueue = Promise.resolve();
function soffice(input, toSpec, outDir, opts = {}) {
  const job = async () => {
    const profile = path.join(U.cfg.user, 'lo-profile');
    await fsp.mkdir(profile, { recursive: true });
    const args = ['--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard', `-env:UserInstallation=${pathToFileURL(profile).href}`];
    if (opts.infilter) args.push(`--infilter=${opts.infilter}`);
    args.push('--convert-to', toSpec, '--outdir', outDir, input);
    await U.run(libreOfficePath(), args, { signal: opts.signal, errorMessage: 'LibreOffice couldn’t convert this file' });
    const produced = path.join(outDir, `${path.basename(input, path.extname(input))}.${toSpec.split(':')[0]}`);
    if (!fs.existsSync(produced)) throw new Error('LibreOffice finished without producing a file.');
    return produced;
  };
  const p = loQueue.then(job, job);
  loQueue = p.catch(() => {});
  return p;
}
const LO_FILTER = { docx: 'docx:MS Word 2007 XML', doc: 'doc:MS Word 97', txt: 'txt:Text (encoded):UTF8', html: 'html:XHTML Writer File:UTF8', xlsx: 'xlsx:Calc MS Excel 2007 XML', xls: 'xls:MS Excel 97', csv: 'csv:Text - txt - csv (StarCalc):44,34,76,1', pptx: 'pptx:Impress MS PowerPoint 2007 XML', ppt: 'ppt:MS PowerPoint 97' };
async function viaLibreOffice(input, to, ctx, opts = {}) {
  const tmp = await U.tmpDir('lo');
  try {
    ctx?.progress?.(0.2, 'Converting with LibreOffice');
    const produced = await soffice(input, LO_FILTER[to] || to, tmp, { infilter: opts.infilter, signal: ctx?.signal });
    const out = opts.out || ctx.out.file(input, `${U.base(input)}.${to}`);
    await fsp.copyFile(produced, out);
    return out;
  } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}
async function viaPandoc(input, to, ctx, out) {
  const args = [input, '-o', out, '--standalone'];
  if (to === 'md') args.push('-t', 'gfm');
  if (to === 'epub') args.push('--metadata', `title=${U.base(input)}`);
  await U.run(pandocPath(), args, { cwd: path.dirname(input), signal: ctx?.signal, errorMessage: 'Pandoc couldn’t convert this file' });
  return out;
}
const TEXTUTIL = new Set(['txt', 'html', 'rtf', 'doc', 'docx', 'odt', 'webarchive', 'wordml', 'rtfd']);
async function viaTextutil(input, to, out) {
  await U.run('/usr/bin/textutil', ['-convert', to, '-output', out, input], { errorMessage: 'macOS couldn’t convert this document' });
  return out;
}
const IWORK = {
  Pages: { pdf: 'PDF', docx: 'Microsoft Word', epub: 'EPUB', txt: 'unformatted text', rtf: 'formatted text' },
  Keynote: { pdf: 'PDF', pptx: 'Microsoft PowerPoint', mov: 'QuickTime movie', html: 'HTML' },
  Numbers: { pdf: 'PDF', xlsx: 'Microsoft Excel', csv: 'CSV' },
};
async function viaIWork(app, input, to, out) {
  const fmt = IWORK[app]?.[to];
  if (!fmt || !iworkPath(app)) return null;
  const q = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await U.run('/usr/bin/osascript', ['-e', `tell application "${app}"\nset d to open (POSIX file "${q(input)}")\nexport d to (POSIX file "${q(out)}") as ${fmt}\nclose d saving no\nend tell`], { errorMessage: `${app} couldn’t export this file` });
  return fs.existsSync(out) ? out : null;
}

const CSS = 'body{font:11pt/1.55 -apple-system,"Helvetica Neue","Segoe UI",Arial,sans-serif;color:#1d2117;margin:0}img{max-width:100%}table{border-collapse:collapse;width:100%;font-size:9.5pt;margin:8pt 0}th,td{border:1px solid #cfd5c8;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f1f5ea}pre,code{font-family:Menlo,Consolas,monospace;font-size:9.5pt}pre{white-space:pre-wrap;background:#f5f7f1;padding:10px;border-radius:6px}h1,h2,h3{line-height:1.25}blockquote{border-left:3px solid #9bd452;margin-left:0;padding-left:12px;color:#4b5443}';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const htmlDoc = (title, body, css = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}${css}</style></head><body>${body}</body></html>`;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', bull: '•' };
const unesc = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));

const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'col', 'source', 'wbr']);
function parseHtml(html) {
  const root = { tag: 'root', attrs: {}, kids: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\w[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const src = (body ? body[1] : html).replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, '');
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[5] != null) { top.kids.push({ text: unesc(m[5]) }); continue; }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) { const i = stack.map((s) => s.tag).lastIndexOf(tag); if (i > 0) stack.length = i; continue; }
    const attrs = {};
    m[3].replace(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/g, (x, k, v, a, b, c) => { attrs[k.toLowerCase()] = unesc(a ?? b ?? c ?? ''); });
    const node = { tag, attrs, kids: [] };
    top.kids.push(node);
    if (!VOID.has(tag) && !m[4]) stack.push(node);
  }
  return root;
}
const textOf = (n) => (n.text != null ? n.text : (n.kids || []).map(textOf).join(''));
const BLOCK = new Set(['p', 'div', 'li', 'ul', 'ol', 'table', 'tr', 'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'figure', 'hr', 'dl', 'dt', 'dd', 'main', 'nav', 'aside', 'center', 'body']);
function fmtOf(tag, attrs, f) {
  const g = { ...f };
  if (tag === 'b' || tag === 'strong') g.bold = true;
  if (tag === 'i' || tag === 'em') g.italic = true;
  if (tag === 'u' || tag === 'ins') g.underline = true;
  if (tag === 's' || tag === 'del' || tag === 'strike') g.strike = true;
  if (tag === 'code' || tag === 'kbd' || tag === 'tt') g.code = true;
  if (tag === 'a') g.link = attrs.href;
  if (tag === 'sup') g.sup = true;
  if (tag === 'sub') g.sub = true;
  return g;
}
function inline(n, f = {}, skipLists = false) {
  const runs = [];
  const walk = (k, fmt) => {
    for (const c of k.kids || []) {
      if (c.text != null) { runs.push({ text: c.text.replace(/\s+/g, ' '), ...fmt }); continue; }
      if (skipLists && (c.tag === 'ul' || c.tag === 'ol')) continue;
      if (c.tag === 'br') { runs.push({ text: '\n', ...fmt }); continue; }
      walk(c, fmtOf(c.tag, c.attrs, fmt));
    }
  };
  walk(n, f);
  if (runs.length) { runs[0].text = runs[0].text.replace(/^\s+/, ''); runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, ''); }
  return runs.filter((r) => r.text);
}
function rowsOf(table) {
  const rows = [];
  const walk = (n) => { for (const k of n.kids || []) { if (k.tag === 'tr') rows.push((k.kids || []).filter((c) => c.tag === 'td' || c.tag === 'th').map((c) => ({ text: textOf(c).replace(/\s+/g, ' ').trim(), head: c.tag === 'th' }))); else if (k.kids) walk(k); } };
  walk(table);
  return rows;
}
function blocks(root) {
  const out = [];
  const walk = (n, ctx) => {
    for (const k of n.kids || []) {
      if (k.text != null) { if (k.text.trim() || ctx.open) push(ctx, [{ text: k.text.replace(/\s+/g, ' '), ...ctx.fmt }]); continue; }
      const t = k.tag;
      if (t === 'br') { push(ctx, [{ text: '\n', ...ctx.fmt }]); continue; }
      if (t === 'img') { out.push({ type: 'img', src: k.attrs.src, alt: k.attrs.alt }); ctx.open = null; continue; }
      if (t === 'hr') { out.push({ type: 'hr' }); ctx.open = null; continue; }
      if (t === 'table') { out.push({ type: 'table', rows: rowsOf(k) }); ctx.open = null; continue; }
      if (t === 'pre') { out.push({ type: 'pre', text: textOf(k).replace(/\n$/, '') }); ctx.open = null; continue; }
      if (/^h[1-6]$/.test(t)) { out.push({ type: 'h', level: Number(t[1]), runs: inline(k) }); ctx.open = null; continue; }
      if (t === 'li') {
        out.push({ type: 'li', ordered: ctx.ordered, depth: ctx.depth, index: ++ctx.counter.n, runs: inline(k, {}, true) });
        ctx.open = null;
        for (const c of k.kids || []) if (c.tag === 'ul' || c.tag === 'ol') walk({ kids: [c] }, { ...ctx, open: null });
        continue;
      }
      if (t === 'ul' || t === 'ol') { walk(k, { ...ctx, ordered: t === 'ol', depth: ctx.inList ? ctx.depth + 1 : 0, inList: true, counter: { n: 0 }, open: null }); ctx.open = null; continue; }
      if (t === 'blockquote') { walk(k, { ...ctx, quote: true, open: null }); ctx.open = null; continue; }
      if (BLOCK.has(t)) { ctx.open = null; walk(k, ctx); ctx.open = null; continue; }
      walk(k, { ...ctx, fmt: fmtOf(t, k.attrs, ctx.fmt), parent: ctx });
    }
  };
  const push = (ctx, runs) => {
    let c = ctx;
    while (c.parent) c = c.parent;
    if (!c.open) { c.open = { type: ctx.quote ? 'quote' : 'p', runs: [] }; out.push(c.open); }
    c.open.runs.push(...runs);
    ctx.open = c.open;
  };
  walk(root, { fmt: {}, counter: { n: 0 }, depth: 0, ordered: false, open: null });
  for (const b of out) if (b.runs) { const r = b.runs; if (r.length) { r[0].text = r[0].text.replace(/^\s+/, ''); r[r.length - 1].text = r[r.length - 1].text.replace(/\s+$/, ''); } b.runs = r.filter((x) => x.text); }
  return out.filter((b) => !b.runs || b.runs.length || b.type === 'li');
}
const plain = (runs) => runs.map((r) => r.text).join('');
function htmlToText(html) {
  return blocks(parseHtml(html)).map((b) => {
    if (b.type === 'li') return `${'  '.repeat(b.depth || 0)}${b.ordered ? `${b.index}.` : '•'} ${plain(b.runs)}`;
    if (b.type === 'table') return b.rows.map((r) => r.map((c) => c.text).join('\t')).join('\n');
    if (b.type === 'pre') return b.text;
    if (b.type === 'hr') return '────────';
    if (b.type === 'img') return b.alt ? `[${b.alt}]` : '';
    return plain(b.runs);
  }).filter((x) => x !== '').join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function htmlToMd(html) {
  const md = (runs) => runs.map((r) => { let t = r.text; if (r.code) t = `\`${t}\``; if (r.bold) t = `**${t}**`; if (r.italic) t = `*${t}*`; if (r.strike) t = `~~${t}~~`; if (r.link) t = `[${t}](${r.link})`; return t; }).join('');
  return blocks(parseHtml(html)).map((b) => {
    if (b.type === 'h') return `${'#'.repeat(b.level)} ${md(b.runs)}`;
    if (b.type === 'li') return `${'  '.repeat(b.depth || 0)}${b.ordered ? `${b.index}.` : '-'} ${md(b.runs)}`;
    if (b.type === 'quote') return `> ${md(b.runs)}`;
    if (b.type === 'pre') return `\`\`\`\n${b.text}\n\`\`\``;
    if (b.type === 'hr') return '---';
    if (b.type === 'img') return b.src && !b.src.startsWith('data:') ? `![${b.alt || ''}](${b.src})` : '';
    if (b.type === 'table') { const [h, ...r] = b.rows; if (!h) return ''; return [`| ${h.map((c) => c.text).join(' | ')} |`, `|${h.map(() => ' --- ').join('|')}|`, ...r.map((x) => `| ${x.map((c) => c.text).join(' | ')} |`)].join('\n'); }
    return md(b.runs);
  }).filter(Boolean).join('\n\n').replace(/\n(\s*[-\d.]+ .*)\n\n(?=\s*[-\d.]+ )/g, '\n$1\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function htmlToRtf(html) {
  const e = (t) => t.replace(/[\\{}]/g, '\\$&').replace(/\n/g, '\\line ').replace(/[^\x00-\x7f]/g, (c) => { const n = c.charCodeAt(0); return `\\u${n > 32767 ? n - 65536 : n}?`; });
  const runs = (rs) => rs.map((r) => `{${r.bold ? '\\b ' : ''}${r.italic ? '\\i ' : ''}${r.underline ? '\\ul ' : ''}${r.code ? '\\f1 ' : ''}${e(r.text)}}`).join('');
  const body = blocks(parseHtml(html)).map((b) => {
    if (b.type === 'h') return `{\\pard\\sb240\\sa120\\b\\fs${[0, 40, 32, 28, 24, 22, 22][b.level]} ${runs(b.runs)}\\par}`;
    if (b.type === 'li') return `{\\pard\\li${360 * ((b.depth || 0) + 1)}\\fi-240 ${b.ordered ? `${b.index}.` : '\\bullet'}\\tab ${runs(b.runs)}\\par}`;
    if (b.type === 'pre') return `{\\pard\\f1\\fs18 ${e(b.text)}\\par}`;
    if (b.type === 'table') return b.rows.map((r) => `{\\pard ${r.map((c) => e(c.text)).join('\\tab ')}\\par}`).join('');
    if (b.type === 'quote') return `{\\pard\\li480\\i ${runs(b.runs)}\\par}`;
    if (b.type === 'p') return `{\\pard\\sa160 ${runs(b.runs)}\\par}`;
    return '';
  }).join('\n');
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}{\\f1 Menlo;}}\\fs22\n${body}\n}`;
}
function rtfToHtml(rtf) {
  let out = '', para = '', bold = false, italic = false, depth = 0, uc = 1, skipChars = 0;
  const skip = [];
  const stack = [];
  const re = /\\([a-z]+)(-?\d+)? ?|\\'([0-9a-f]{2})|\\([\\{}~_*-])|([{}])|\r?\n|([^\\{}\r\n]+)/gi;
  const flush = () => { if (para.trim()) out += `<p>${para}</p>`; para = ''; };
  const add = (t) => { if (!t) return; para += italic ? `<i>${bold ? `<b>${t}</b>` : t}</i>` : bold ? `<b>${t}</b>` : t; };
  let m;
  while ((m = re.exec(rtf))) {
    if (m[5] === '{') { stack.push({ bold, italic }); depth++; continue; }
    if (m[5] === '}') { const s = stack.pop(); if (s) ({ bold, italic } = s); if (skip.length && skip[skip.length - 1] === depth) skip.pop(); depth--; continue; }
    if (m[4] === '*') { skip.push(depth); continue; }
    if (skip.length) continue;
    if (m[1]) {
      const w = m[1].toLowerCase();
      if (['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'listtable', 'listoverridetable', 'generator', 'themedata', 'datastore', 'latentstyles', 'xmlnstbl', 'rsidtbl', 'fldinst', 'object'].includes(w)) { skip.push(depth); continue; }
      if (w === 'par') { flush(); continue; }
      if (w === 'line') { para += '<br>'; continue; }
      if (w === 'tab') { para += ' '; continue; }
      if (w === 'b') bold = m[2] !== '0';
      else if (w === 'i') italic = m[2] !== '0';
      else if (w === 'plain') bold = italic = false;
      else if (w === 'uc') uc = Number(m[2]) || 1;
      else if (w === 'u' && m[2]) { add(esc(String.fromCharCode(Number(m[2]) < 0 ? Number(m[2]) + 65536 : Number(m[2])))); skipChars = uc; }
      else if (w === 'bullet') add('•');
      else if (w === 'emdash') add('—');
      else if (w === 'endash') add('–');
      else if (w === 'lquote' || w === 'rquote') add(w === 'lquote' ? '‘' : '’');
      else if (w === 'ldblquote' || w === 'rdblquote') add(w === 'ldblquote' ? '“' : '”');
      continue;
    }
    if (m[3]) { if (skipChars) { skipChars--; continue; } add(esc(Buffer.from(m[3], 'hex').toString('latin1'))); continue; }
    if (m[4]) { add(m[4] === '~' ? ' ' : /[\\{}]/.test(m[4]) ? esc(m[4]) : ''); continue; }
    if (m[6]) { let t = m[6]; if (skipChars) { const k = Math.min(skipChars, t.length); t = t.slice(k); skipChars -= k; } add(esc(t)); }
  }
  flush();
  return out;
}
async function zipEntries(file) { return require('fflate').unzipSync(new Uint8Array(await fsp.readFile(file))); }
const utf8 = (u8) => Buffer.from(u8 || []).toString('utf8');
async function odtToHtml(file) {
  const xml = utf8((await zipEntries(file))['content.xml']);
  return xml.replace(/[\s\S]*<office:text[^>]*>/, '').replace(/<\/office:text>[\s\S]*/, '')
    .replace(/<text:h[^>]*outline-level="(\d)"[^>]*>([\s\S]*?)<\/text:h>/g, '<h$1>$2</h$1>').replace(/<text:h[^>]*>([\s\S]*?)<\/text:h>/g, '<h2>$1</h2>')
    .replace(/<text:p[^>]*\/>/g, '').replace(/<text:p[^>]*>/g, '<p>').replace(/<\/text:p>/g, '</p>').replace(/<text:list-item[^>]*>/g, '<li>').replace(/<\/text:list-item>/g, '</li>').replace(/<text:list\b[^>]*>/g, '<ul>').replace(/<\/text:list>/g, '</ul>')
    .replace(/<text:line-break\/>/g, '<br>').replace(/<text:tab\/>/g, ' ').replace(/<text:s[^>]*\/>/g, ' ').replace(/<table:table-row[^>]*>/g, '<tr>').replace(/<\/table:table-row>/g, '</tr>').replace(/<table:table-cell[^>]*>/g, '<td>').replace(/<\/table:table-cell>/g, '</td>')
    .replace(/<table:table\b[^>]*>/g, '<table>').replace(/<\/table:table>/g, '</table>').replace(/<(?!\/?(h\d|p|li|ul|br|tr|td|table)\b)[^>]+>/g, '');
}
async function epubToHtml(file) {
  const z = await zipEntries(file);
  const opfPath = (/full-path="([^"]+)"/.exec(utf8(z['META-INF/container.xml'])) || [])[1] || Object.keys(z).find((k) => k.endsWith('.opf'));
  const opf = utf8(z[opfPath]);
  const dir = path.posix.dirname(opfPath);
  const items = {};
  for (const [, a] of opf.matchAll(/<item\b([^>]*)>/g)) { const id = (/\bid="([^"]+)"/.exec(a) || [])[1]; const href = (/href="([^"]+)"/.exec(a) || [])[1]; if (id && href) items[id] = decodeURIComponent(href); }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => items[m[1]]).filter(Boolean);
  const title = (/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/.exec(opf) || [])[1] || U.base(file);
  const parts = spine.map((href) => {
    const p = path.posix.normalize(dir === '.' ? href : `${dir}/${href}`);
    const html = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(utf8(z[p])) || [, utf8(z[p])])[1];
    return html.replace(/<img\b([^>]*?)src="([^"]+)"/g, (m, pre, src) => {
      const data = z[path.posix.normalize(`${path.posix.dirname(p)}/${decodeURIComponent(src)}`)];
      if (!data) return m;
      const mime = /\.png$/i.test(src) ? 'image/png' : /\.svg$/i.test(src) ? 'image/svg+xml' : /\.gif$/i.test(src) ? 'image/gif' : 'image/jpeg';
      return `<img${pre}src="data:${mime};base64,${Buffer.from(data).toString('base64')}"`;
    });
  });
  return { title: unesc(title), html: parts.join('<div style="page-break-after:always"></div>') };
}
async function pagesPreview(file) {
  const z = await zipEntries(file).catch(() => ({}));
  const pdf = Object.keys(z).find((k) => /QuickLook\/Preview\.pdf$/i.test(k));
  return pdf ? Buffer.from(z[pdf]) : null;
}
const PLAIN_IN = new Set(['txt', 'log', 'text', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'tex', 'rst', 'org', 'srt', 'vtt', 'ini', 'conf', 'cfg', 'js', 'ts', 'py', 'css', 'sh', 'c', 'cpp', 'h', 'java', 'swift', 'go', 'rs', 'sql']);
async function readHtml(input) {
  const from = U.ext(input);
  if (['docx', 'docm', 'dotx'].includes(from)) {
    const mammoth = require('mammoth');
    return { html: (await mammoth.convertToHtml({ path: input }, { convertImage: mammoth.images.dataUri })).value };
  }
  if (from === 'md' || from === 'markdown') return { html: require('marked').marked.parse(await fsp.readFile(input, 'utf8'), { gfm: true }) };
  if (['html', 'htm', 'xhtml'].includes(from)) return { html: await fsp.readFile(input, 'utf8'), file: input };
  if (from === 'epub') return epubToHtml(input);
  if (from === 'odt') return { html: await odtToHtml(input) };
  if (from === 'rtf') return { html: rtfToHtml(await fsp.readFile(input, 'latin1')) };
  if (isMac && TEXTUTIL.has(from)) {
    const tmp = path.join(await U.tmpDir('tu'), 'doc.html');
    await viaTextutil(input, 'html', tmp);
    return { html: await fsp.readFile(tmp, 'utf8') };
  }
  if (PLAIN_IN.has(from)) {
    const txt = (await fsp.readFile(input, 'utf8')).replace(/^\ufeff/, '');
    return { html: txt.split(/\r?\n\s*\r?\n/).map((p) => `<p>${esc(p).replace(/\r?\n/g, '<br>')}</p>`).join('\n'), plain: txt };
  }
  return null;
}
async function htmlToPdf(html, out, ctx, opts = {}) {
  if (!ctx?.host) throw new Error('HTML rendering is only available in the app.');
  const tmp = await U.tmpDir('html');
  const file = path.join(tmp, 'page.html');
  await fsp.writeFile(file, html, 'utf8');
  try { await ctx.host('htmlToPdf', { file, out, landscape: !!opts.landscape, pageSize: opts.pageSize || 'A4', margins: opts.margins, offline: !!opts.offline }); } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
  return out;
}

async function htmlToDocx(html, title, out) {
  const D = require('docx');
  const sharp = require('sharp');
  const runsOf = (rs, extra = {}) => rs.flatMap((r) => r.text.split('\n').map((t, i) => new D.TextRun({ text: t, bold: r.bold || extra.bold, italics: r.italic || extra.italic, underline: r.underline ? {} : undefined, strike: r.strike, font: r.code ? 'Menlo' : undefined, superScript: r.sup, subScript: r.sub, color: r.link ? '2E6B10' : undefined, break: i ? 1 : undefined })));
  const children = [];
  for (const b of blocks(parseHtml(html))) {
    if (b.type === 'h') children.push(new D.Paragraph({ heading: D.HeadingLevel[`HEADING_${Math.min(6, b.level)}`], children: runsOf(b.runs) }));
    else if (b.type === 'li') children.push(new D.Paragraph({ children: runsOf(b.runs), ...(b.ordered ? { numbering: { reference: 'num', level: Math.min(8, b.depth || 0) } } : { bullet: { level: Math.min(8, b.depth || 0) } }) }));
    else if (b.type === 'pre') children.push(...b.text.split('\n').map((l) => new D.Paragraph({ children: [new D.TextRun({ text: l || ' ', font: 'Menlo', size: 18 })], shading: { type: D.ShadingType.CLEAR, fill: 'F3F5EF' } })));
    else if (b.type === 'quote') children.push(new D.Paragraph({ children: runsOf(b.runs, { italic: true }), indent: { left: 540 } }));
    else if (b.type === 'hr') children.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 1 } } }));
    else if (b.type === 'table' && b.rows.length) {
      const cols = Math.max(...b.rows.map((r) => r.length));
      children.push(new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, rows: b.rows.map((r) => new D.TableRow({ children: Array.from({ length: cols }, (_, i) => new D.TableCell({ children: [new D.Paragraph({ children: [new D.TextRun({ text: r[i]?.text || '', bold: r[i]?.head })] })] })) })) }));
      children.push(new D.Paragraph(''));
    } else if (b.type === 'img' && /^data:image\//.test(b.src || '')) {
      try {
        const buf = Buffer.from(b.src.split(',')[1], 'base64');
        const meta = await sharp(buf).metadata();
        const ok = ['jpeg', 'png', 'gif', 'bmp'].includes(meta.format);
        const k = Math.min(1, 600 / (meta.width || 600));
        children.push(new D.Paragraph({ children: [new D.ImageRun({ data: ok ? buf : await sharp(buf).png().toBuffer(), type: ok ? (meta.format === 'jpeg' ? 'jpg' : meta.format) : 'png', transformation: { width: Math.round((meta.width || 600) * k), height: Math.round((meta.height || 400) * k) } })] }));
      } catch (_) {}
    } else if (b.runs?.length) children.push(new D.Paragraph({ children: runsOf(b.runs), spacing: { after: 120 } }));
  }
  const doc = new D.Document({
    creator: 'Lime', title,
    styles: { default: { document: { run: { font: 'Helvetica Neue', size: 22 } } } },
    numbering: { config: [{ reference: 'num', levels: Array.from({ length: 9 }, (_, i) => ({ level: i, format: D.LevelFormat.DECIMAL, text: `%${i + 1}.`, alignment: D.AlignmentType.START, style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } } })) }] },
    sections: [{ children: children.length ? children : [new D.Paragraph('')] }],
  });
  await fsp.writeFile(out, await D.Packer.toBuffer(doc));
  return out;
}
async function htmlToEpub(html, title, out) {
  const { zipSync, strToU8 } = require('fflate');
  const imgs = {};
  let n = 0;
  const body = html.replace(/src="data:image\/(png|jpeg|gif|svg\+xml);base64,([^"]+)"/g, (m, t, d) => { const e = t === 'jpeg' ? 'jpg' : t === 'svg+xml' ? 'svg' : t; const name = `img${++n}.${e}`; imgs[name] = { data: Buffer.from(d, 'base64'), type: `image/${t}` }; return `src="${name}"`; });
  const attrs = (node) => Object.entries(node.attrs || {}).filter(([k]) => /^(src|href|alt|title|colspan|rowspan)$/.test(k)).map(([k, v]) => ` ${k}="${esc(v).replace(/"/g, '&quot;')}"`).join('');
  const ok = /^(p|h[1-6]|ul|ol|li|b|strong|i|em|u|s|a|img|br|hr|table|thead|tbody|tr|td|th|blockquote|pre|code|sup|sub|span|div|figure|figcaption)$/;
  const xhtml = (node) => (node.text != null ? esc(node.text) : node.tag === 'root' || !ok.test(node.tag) ? (node.kids || []).map(xhtml).join('') : VOID.has(node.tag) ? `<${node.tag}${attrs(node)}/>` : `<${node.tag}${attrs(node)}>${node.kids.map(xhtml).join('')}</${node.tag}>`);
  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:${require('crypto').randomUUID()}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="content.xhtml" media-type="application/xhtml+xml"/>${Object.entries(imgs).map(([k, v], i) => `<item id="i${i}" href="${k}" media-type="${v.type}"/>`).join('')}</manifest><spine><itemref idref="c1"/></spine></package>`),
    'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(title)}</title></head><body><nav epub:type="toc"><ol><li><a href="content.xhtml">${esc(title)}</a></li></ol></nav></body></html>`),
    'OEBPS/content.xhtml': strToU8(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(title)}</title><style>body{font-family:serif;line-height:1.5}img{max-width:100%}</style></head><body>${xhtml(parseHtml(body))}</body></html>`),
  };
  for (const [k, v] of Object.entries(imgs)) files[`OEBPS/${k}`] = new Uint8Array(v.data);
  await fsp.writeFile(out, zipSync(files));
  return out;
}

const EMU = 9525;
async function pptxToHtml(file) {
  const z = await zipEntries(file);
  const get = (p) => utf8(z[p]);
  const rels = (p) => {
    const r = {};
    for (const [, a] of get(`${path.posix.dirname(p)}/_rels/${path.posix.basename(p)}.rels`).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = (/Id="([^"]+)"/.exec(a) || [])[1], t = (/Target="([^"]+)"/.exec(a) || [])[1];
      if (id && t) r[id] = t.startsWith('/') ? t.slice(1) : path.posix.normalize(`${path.posix.dirname(p)}/${t}`);
    }
    return r;
  };
  const pres = get('ppt/presentation.xml');
  const sz = /<p:sldSz\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(pres) || [0, 12192000, 6858000];
  const W = Number(sz[1]) / EMU, H = Number(sz[2]) / EMU;
  const presRels = rels('ppt/presentation.xml');
  const order = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => presRels[m[1]]).filter(Boolean);
  const theme = get(Object.keys(z).find((k) => /^ppt\/theme\/theme\d+\.xml$/.test(k)) || '');
  const scheme = {};
  for (const k of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink']) { const m = new RegExp(`<a:${k}>[\\s\\S]*?(?:val|lastClr)="([0-9A-Fa-f]{6})"`).exec(theme); if (m) scheme[k] = `#${m[1]}`; }
  Object.assign(scheme, { tx1: scheme.dk1 || '#000000', bg1: scheme.lt1 || '#ffffff', tx2: scheme.dk2 || '#333333', bg2: scheme.lt2 || '#eeeeee' });
  const color = (x) => { if (!x) return null; const s = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(x); if (s) return `#${s[1]}`; const c = /<a:schemeClr val="(\w+)"/.exec(x); return c ? scheme[c[1]] || null : null; };
  const xfrm = (x) => { const o = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(x || ''), e = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(x || ''); return o && e ? { x: o[1] / EMU, y: o[2] / EMU, w: e[1] / EMU, h: e[2] / EMU } : null; };
  const phKey = (b) => { const ph = /<p:ph\b([^>]*?)\/?>/.exec(b); if (!ph) return null; return { type: (/type="(\w+)"/.exec(ph[1]) || [])[1] || 'body', idx: (/idx="(\d+)"/.exec(ph[1]) || [])[1] }; };
  const cache = {};
  const placeholders = (p) => {
    if (cache[p]) return cache[p];
    const map = {};
    for (const sp of get(p).match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) {
      const k = phKey(sp);
      if (!k) continue;
      const v = { box: xfrm(sp), size: ((/<a:defRPr\b[^>]*sz="(\d+)"/.exec(sp) || /<a:rPr\b[^>]*sz="(\d+)"/.exec(sp) || [])[1] || 0) / 100 || null };
      if (k.idx) map[`i${k.idx}`] = v;
      if (!map[`t${k.type}`]) map[`t${k.type}`] = v;
    }
    return (cache[p] = map);
  };
  const master = get('ppt/slideMasters/slideMaster1.xml');
  const msz = { title: ((/<p:titleStyle>[\s\S]*?sz="(\d+)"/.exec(master) || [])[1] || 4400) / 100, body: ((/<p:bodyStyle>[\s\S]*?sz="(\d+)"/.exec(master) || [])[1] || 2800) / 100 };
  const media = (t) => { const d = z[t]; const e = path.extname(t || '').slice(1).toLowerCase(); return d && ['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp'].includes(e) ? `data:image/${e === 'jpg' ? 'jpeg' : e === 'svg' ? 'svg+xml' : e};base64,${Buffer.from(d).toString('base64')}` : null; };
  const slides = [], texts = [];
  for (const sp of order) {
    const xml = get(sp), r = rels(sp);
    const layout = Object.values(r).find((t) => /slideLayout/.test(t));
    const masterPath = layout && Object.values(rels(layout)).find((t) => /slideMaster/.test(t));
    const lay = layout ? placeholders(layout) : {}, mas = masterPath ? placeholders(masterPath) : {};
    const bgOf = (x) => (/<p:bg>([\s\S]*?)<\/p:bg>/.exec(x) || [])[1];
    const bg = color(bgOf(xml) || bgOf(layout ? get(layout) : '') || bgOf(masterPath ? get(masterPath) : '')) || '#ffffff';
    let els = '';
    const st = [];
    for (const [, kind, body] of xml.matchAll(/<p:(sp|pic|graphicFrame|cxnSp)>([\s\S]*?)<\/p:\1>/g)) {
      const k = phKey(body);
      const alias = k && (k.type === 'ctrTitle' ? 'title' : k.type === 'subTitle' ? 'body' : k.type);
      const inh = k ? lay[`i${k.idx}`] || lay[`t${k.type}`] || mas[`t${k.type}`] || mas[`t${alias}`] || {} : {};
      const box = xfrm((/<p:spPr>[\s\S]*?<\/p:spPr>|<p:xfrm>[\s\S]*?<\/p:xfrm>/.exec(body) || [])[0]) || inh.box;
      if (!box) continue;
      const pos = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
      if (kind === 'pic') { const src = media(r[(/r:embed="([^"]+)"/.exec(body) || [])[1]]); if (src) els += `<img src="${src}" style="position:absolute;${pos}">`; continue; }
      if (kind === 'graphicFrame') {
        const rows = [...body.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map((tr) => [...tr[1].matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map((tc) => [...tc[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => unesc(t[1])).join('')));
        if (rows.length) { els += `<table style="position:absolute;${pos}">${rows.map((row, i) => `<tr>${row.map((c) => `<${i ? 'td' : 'th'}>${esc(c)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`; st.push(rows.map((x) => x.join('\t')).join('\n')); }
        continue;
      }
      const spPr = (/<p:spPr>([\s\S]*?)<\/p:spPr>/.exec(body) || [])[1] || '';
      const noLn = spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>/, '');
      const fill = /<a:noFill\/>/.test(noLn) ? null : color(noLn);
      const ln = /<a:ln\b[^>]*>([\s\S]*?)<\/a:ln>/.exec(spPr);
      const stroke = ln && !/<a:noFill\/>/.test(ln[1]) ? color(ln[1]) : null;
      const geom = (/<a:prstGeom prst="(\w+)"/.exec(spPr) || [])[1];
      const anchor = (/<a:bodyPr\b[^>]*anchor="(\w+)"/.exec(body) || [])[1] || (k && /title/i.test(k.type) ? 'ctr' : 't');
      const def = inh.size || (k && /title/i.test(k.type) ? msz.title : k && k.type === 'subTitle' ? msz.body * 0.8 : msz.body);
      let paras = '';
      for (const [, pb = ''] of body.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\/>/g)) {
        const algn = (/<a:pPr\b[^>]*algn="(\w+)"/.exec(pb) || [])[1] || (k && (k.type === 'ctrTitle' || k.type === 'subTitle') ? 'ctr' : null);
        const bullet = /<a:buChar\b/.test(pb) || (k && k.type === 'body' && !/<a:buNone\/>/.test(pb) && !/<a:buNone\/>/.test(get(layout || '')));
        let runs = '', txt = '';
        for (const [, rb] of pb.matchAll(/<a:r>([\s\S]*?)<\/a:r>|<a:br\/>/g)) {
          if (!rb) { runs += '<br>'; continue; }
          const rp = /<a:rPr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/a:rPr>)/.exec(rb) || [];
          const t = unesc((/<a:t>([^<]*)<\/a:t>/.exec(rb) || [])[1] || '');
          txt += t;
          const s = (/\bsz="(\d+)"/.exec(rp[1] || '') || [])[1];
          const c = color(rp[2] || '');
          runs += `<span style="font-size:${((s ? s / 100 : def) * 4) / 3}px;${/\bb="1"/.test(rp[1] || '') ? 'font-weight:700;' : ''}${/\bi="1"/.test(rp[1] || '') ? 'font-style:italic;' : ''}${/\bu="sng"/.test(rp[1] || '') ? 'text-decoration:underline;' : ''}${c ? `color:${c};` : ''}">${esc(t)}</span>`;
        }
        if (txt) st.push(txt);
        paras += `<p style="${algn === 'ctr' ? 'text-align:center;' : algn === 'r' ? 'text-align:right;' : ''}${bullet && txt ? 'padding-left:1.1em;text-indent:-.75em;' : ''}">${bullet && txt ? '• ' : ''}${runs || '&nbsp;'}</p>`;
      }
      els += `<div class="sp" style="${pos};${fill ? `background:${fill};` : ''}${stroke ? `border:1.5px solid ${stroke};` : ''}border-radius:${geom === 'ellipse' ? '50%' : geom === 'roundRect' ? '14px' : '0'};justify-content:${anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start'};color:${scheme.tx1}">${paras}</div>`;
    }
    slides.push(`<section class="slide" style="background:${bg}">${els}</section>`);
    texts.push(st.join('\n'));
  }
  const css = `@page{size:${W}px ${H}px;margin:0}html,body{margin:0;padding:0}body{font-family:-apple-system,"Helvetica Neue",Calibri,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.slide{position:relative;width:${W}px;height:${H}px;overflow:hidden;break-after:page}.sp{position:absolute;display:flex;flex-direction:column;padding:4px 10px;box-sizing:border-box;overflow:hidden;line-height:1.18}.sp p{margin:0 0 .3em}table{border-collapse:collapse;font-size:15px}th,td{border:1px solid #bbb;padding:3px 6px}`;
  return { html: `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${slides.join('')}</body></html>`, width: W, height: H, texts, count: slides.length };
}
async function convertSlides(input, to, ctx) {
  const from = U.ext(input);
  const out = ctx.out.file(input, `${U.base(input)}.${to}`);
  if (libreOfficePath() && ['pdf', 'pptx', 'ppt', 'odp'].includes(to) && from !== to) return viaLibreOffice(input, to, ctx, { out });
  if (isMac && iworkPath('Keynote') && IWORK.Keynote[to]) {
    ctx.progress?.(0.2, 'Converting with Keynote');
    const r = await viaIWork('Keynote', input, to, out).catch(() => null);
    if (r) return r;
  }
  if (!['pptx', 'pptm', 'ppsx', 'potx'].includes(from)) throw missing(`${from.toUpperCase()} slides need ${isMac ? 'Keynote or ' : ''}LibreOffice on this computer.`);
  ctx.progress?.(0.2, 'Reading slides');
  const deck = await pptxToHtml(input);
  if (to === 'html') { await fsp.writeFile(out, deck.html); return out; }
  if (to === 'txt' || to === 'md') { await fsp.writeFile(out, `${deck.texts.map((t, i) => (to === 'md' ? `## Slide ${i + 1}\n\n${t}` : `Slide ${i + 1}\n${t}`)).join('\n\n')}\n`); return out; }
  if (to === 'pdf' || to === 'png') {
    const pdfOut = to === 'png' ? path.join(await U.tmpDir('slides'), `${U.base(input)}.pdf`) : out;
    await htmlToPdf(deck.html, pdfOut, ctx, { pageSize: { width: deck.width / 96, height: deck.height / 96 }, margins: 'none' });
    if (to === 'pdf') return out;
    fsp.rm(out, { force: true }).catch(() => {});
    return require('./pdf').toImages(pdfOut, { format: 'png', dpi: '150' }, { ...ctx, out: { ...ctx.out, folder: () => ctx.out.folder(input, `${U.base(input)} - slides`) } });
  }
  throw missing(`PowerPoint to ${to.toUpperCase()} needs ${isMac ? 'Keynote or ' : ''}LibreOffice on this computer.`);
}

const data = () => require('./data');
const CSV_IN = ['csv', 'tsv', 'tab'];
const sheetName = (n) => n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet1';
function readBook(input, opts = {}) {
  const XLSX = require('xlsx');
  const e = U.ext(input), D = data();
  if (e === 'json' || CSV_IN.includes(e)) {
    // CSV cells stay text unless they are plain numbers: no dates from "1/2", no lost leading zeros, any encoding.
    const rows = e === 'json' ? D.table(D.readTree(input, 'json')) : D.csvRows(fs.readFileSync(input), e !== 'csv', false);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, D.rowsToSheet(rows), e === 'json' ? 'Data' : sheetName(U.base(input)));
    return wb;
  }
  return XLSX.readFile(input, { cellDates: true, ...opts });
}
const hasCells = (ws) => Object.keys(ws).some((k) => k[0] !== '!' && ws[k].v != null && ws[k].v !== '');
async function convertSheet(input, to, ctx, opts = {}) {
  const XLSX = require('xlsx');
  const from = U.ext(input);
  if (from === 'numbers') {
    const out = ctx.out.file(input, `${U.base(input)}.${to}`);
    const r = await viaIWork('Numbers', input, to, out).catch(() => null);
    if (r) return r;
    if (libreOfficePath()) return viaLibreOffice(input, to, ctx, { out });
    throw missing('Numbers files need the Numbers app on this Mac.');
  }
  if (CSV_IN.includes(from) && ['json', 'jsonl', 'yaml', 'toml', 'xml', 'vcf'].includes(to)) return data().convert(input, { to }, ctx);
  const flat = ['csv', 'tsv', 'txt', 'json'].includes(to);
  const wb = readBook(input, flat ? { cellStyles: true } : {});
  const names = wb.SheetNames, filled = names.filter((n) => hasCells(wb.Sheets[n]));
  if (flat && filled.length > 1 && opts.allSheets !== false) {
    const folder = ctx.out.folder(input, `${U.base(input)} - sheets`);
    for (const n of filled) await writeSheet(XLSX, wb.Sheets[n], to, path.join(folder, `${U.sanitize(n)}.${to}`));
    return folder;
  }
  const out = ctx.out.file(input, `${U.base(input)}${from === to ? '-converted' : ''}.${to}`);
  if (['xlsx', 'xls', 'ods', 'xlsb', 'xlsm', 'fods'].includes(to)) { XLSX.writeFile(wb, out, { bookType: to === 'xls' ? 'biff8' : to, compression: true }); return out; }
  const tables = names.map((n) => `<h2>${esc(n)}</h2>${XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })}`);
  if (to === 'html') { await fsp.writeFile(out, htmlDoc(U.base(input), tables.join(''))); return out; }
  if (to === 'md') { await fsp.writeFile(out, htmlToMd(tables.join(''))); return out; }
  if (to === 'docx') return htmlToDocx(tables.join(''), U.base(input), out);
  if (to === 'pdf') {
    if (libreOfficePath() && CSV_IN.includes(from)) {
      const tmp = path.join(await U.tmpDir('csv'), `${U.base(input)}.xlsx`);
      XLSX.writeFile(wb, tmp, { compression: true });
      try { return await viaLibreOffice(tmp, 'pdf', ctx, { out }); } finally { fsp.rm(path.dirname(tmp), { recursive: true, force: true }).catch(() => {}); }
    }
    if (libreOfficePath()) return viaLibreOffice(input, 'pdf', ctx, { out });
    return htmlToPdf(htmlDoc(U.base(input), tables.join('<div style="page-break-after:always"></div>'), 'body{font-size:8.5pt}h2{font-size:12pt}'), out, ctx, { landscape: true });
  }
  return writeSheet(XLSX, wb.Sheets[filled[0] || names[0]], to, out);
}
// What the sheet shows, rows and columns from A1 to the used range's far corner, hidden ones left out.
function sheetRows(XLSX, ws) {
  if (!ws['!ref'] || !hasCells(ws)) return [];
  const r = XLSX.utils.decode_range(ws['!ref']);
  const hidden = (list) => new Set((list || []).map((x, i) => (x?.hidden ? i : -1)));
  const hr = hidden(ws['!rows']), hc = hidden(ws['!cols']);
  const rows = [];
  for (let R = 0; R <= r.e.r; R++) {
    if (hr.has(R)) continue;
    const row = [];
    for (let C = 0; C <= r.e.c; C++) {
      if (hc.has(C)) continue;
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      row.push(!cell || cell.v == null ? '' : cell.w ?? XLSX.utils.format_cell(cell));
    }
    rows.push(row);
  }
  return rows;
}
async function writeSheet(XLSX, ws, to, out) {
  if (to === 'json') await fsp.writeFile(out, JSON.stringify(XLSX.utils.sheet_to_json(ws, { defval: '' }), null, 2));
  else await fsp.writeFile(out, data().csvText(sheetRows(XLSX, ws), to === 'csv' ? ',' : '\t'));
  return out;
}
async function mergeSheets(inputs, opts, ctx) {
  const XLSX = require('xlsx');
  const out = ctx.out.file(inputs[0], `${opts.mode === 'stack' ? 'Combined' : 'Merged'} workbook.xlsx`);
  const wb = XLSX.utils.book_new();
  if (opts.mode === 'stack') {
    const rows = [];
    inputs.forEach((p, i) => { const src = readBook(p); const aoa = XLSX.utils.sheet_to_json(src.Sheets[src.SheetNames[0]], { header: 1, defval: '' }); rows.push(...(i && opts.skipHeaders !== false ? aoa.slice(1) : aoa)); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Combined');
  } else {
    const used = new Set();
    for (const p of inputs) {
      const src = readBook(p);
      for (const n of src.SheetNames) {
        let name = (src.SheetNames.length > 1 ? `${U.base(p)} ${n}` : U.base(p)).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
        for (let k = 2; used.has(name.toLowerCase()); k++) name = `${name.slice(0, 28)} ${k}`;
        used.add(name.toLowerCase());
        XLSX.utils.book_append_sheet(wb, src.Sheets[n], name);
      }
    }
  }
  XLSX.writeFile(wb, out, { compression: true });
  return out;
}

async function convertDocument(input, opts, ctx) {
  const to = opts.to;
  const from = U.ext(input);
  const g = U.groupOf(input);
  if (from === to) throw new Error(`This file is already ${to.toUpperCase()}.`);
  if (g === 'sheet' || (from === 'json' && ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'html', 'md'].includes(to))) return convertSheet(input, to, ctx, opts);
  if (g === 'slides') return convertSlides(input, to, ctx);
  const out = ctx.out.file(input, `${U.base(input)}.${to}`);
  if (libreOfficePath() && !['md', 'epub', 'html', 'txt'].includes(to) && !['md', 'markdown', 'epub', 'html', 'htm', 'txt'].includes(from)) return viaLibreOffice(input, to, ctx, { out });
  if (pandocPath() && ['tex', 'rst', 'org'].includes(from)) return viaPandoc(input, to, ctx, out);
  if (from === 'pages') {
    const r = await viaIWork('Pages', input, to, out).catch(() => null);
    if (r) return r;
    const pv = await pagesPreview(input);
    if (pv && to === 'pdf') { await fsp.writeFile(out, pv); return { path: out, note: 'Saved the document’s built-in preview. Open it in Pages for an exact copy.' }; }
    throw missing('Pages documents need the Pages app on this Mac.');
  }
  if (isMac && TEXTUTIL.has(from) && TEXTUTIL.has(to) && !['html', 'txt'].includes(from)) { ctx.progress?.(0.3, 'Converting'); return viaTextutil(input, to, out); }
  ctx.progress?.(0.2, 'Reading');
  const src = await readHtml(input);
  if (!src) throw missing(`${from.toUpperCase()} files need ${isMac ? 'Pages or ' : ''}LibreOffice on this computer.`);
  const title = src.title || U.base(input);
  ctx.progress?.(0.6, `Writing ${to.toUpperCase()}`);
  switch (to) {
    case 'pdf':
      if (src.file) { await ctx.host('htmlToPdf', { file: src.file, out }); return out; }
      return htmlToPdf(htmlDoc(title, src.plain != null ? `<pre style="white-space:pre-wrap;font:10pt/1.45 Menlo,Consolas,monospace;background:none;padding:0;margin:0">${esc(src.plain)}</pre>` : src.html), out, ctx);
    case 'html': await fsp.writeFile(out, src.file ? await fsp.readFile(src.file, 'utf8') : htmlDoc(title, src.html)); return out;
    case 'txt': await fsp.writeFile(out, src.plain ?? htmlToText(src.html)); return out;
    case 'md': await fsp.writeFile(out, ['docx', 'docm'].includes(from) ? (await require('mammoth').convertToMarkdown({ path: input })).value : htmlToMd(src.html)); return out;
    case 'docx': return htmlToDocx(src.html, title, out);
    case 'epub': return htmlToEpub(src.html, title, out);
    case 'rtf': await fsp.writeFile(out, htmlToRtf(src.html)); return out;
    case 'odt': case 'doc':
      if (isMac) { const tmp = path.join(await U.tmpDir('tu'), `${U.base(input)}.html`); await fsp.writeFile(tmp, htmlDoc(title, src.html)); return viaTextutil(tmp, to, out); }
      throw missing(`Saving ${to.toUpperCase()} needs LibreOffice on this computer.`);
    default: throw new Error(`Lime can’t convert ${from.toUpperCase()} to ${to.toUpperCase()}.`);
  }
}
async function anyToPdf(input, ctx, outPath) {
  const g = U.groupOf(input);
  const sub = outPath ? { ...ctx, out: { ...ctx.out, file: () => outPath } } : ctx;
  if (g === 'pdf') { if (outPath) await fsp.copyFile(input, outPath); return outPath || input; }
  if (g === 'image' || g === 'raw') return require('./pdf').imagesToPdf([input], { pageSize: 'fit' }, outPath || ctx.out.file(input, `${U.base(input)}.pdf`), ctx);
  if (g === 'vector' || g === 'cad2d') return require('./crafts').vector(input, { to: 'pdf' }, sub);
  if (g === 'layout') return require('./crafts').layout(input, { to: 'pdf' }, sub);
  const r = await convertDocument(input, { to: 'pdf' }, sub);
  return typeof r === 'string' ? r : r.path;
}
async function urlToPdf(url, opts, ctx) {
  let u = String(url || '').trim();
  if (!u) throw new Error('Enter a web address.');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  let host;
  try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (_) { throw new Error('That isn’t a valid web address.'); }
  const out = ctx.out.file(null, `${host}.${opts.format === 'png' ? 'png' : 'pdf'}`);
  ctx.progress(0.2, `Loading ${host}`);
  await ctx.host(opts.format === 'png' ? 'urlToImage' : 'htmlToPdf', { url: u, out, landscape: opts.landscape, pageSize: opts.pageSize || 'A4' });
  return out;
}
const status = () => ({ libreoffice: libreOfficePath(), pandoc: pandocPath(), pages: !!iworkPath('Pages'), keynote: !!iworkPath('Keynote'), numbers: !!iworkPath('Numbers'), textutil: isMac });

module.exports = { libreOfficePath, pandocPath, viaLibreOffice, convertDocument, convertSheet, convertSlides, mergeSheets, anyToPdf, urlToPdf, htmlToPdf, readHtml, htmlToDocx, htmlToEpub, htmlToMd, htmlToText, htmlToRtf, rtfToHtml, pptxToHtml, readBook, status, parseHtml, blocks };
