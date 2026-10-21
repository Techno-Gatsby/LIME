import { $, $$, esc, h, nameOf, dirOf, sep, clean } from './ui.js';
import * as L from './vendor/weblibs.js';
import { indexBody, parseDoc, fmtCss, withManaged, decode, MANAGED } from './websource.js';
import { designTools } from './webdesign.js';

const VIEWS = [['split', 'Split', 'split', 'Design above, code below, kept in step'], ['design', 'Design', 'web', 'The page as it looks; click to select, double-click to type'], ['code', 'Code', 'code', 'The HTML, with colours, folding and search (Ctrl+F)'], ['preview', 'Preview', 'eye', 'The finished page, without its scripts']];
const DEVICES = [['desktop', 'Desktop', 'desktop', ''], ['tablet', 'Tablet', 'tablet', '768px'], ['phone', 'Phone', 'phone', '375px']];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp'];
const VIDEO_EXT = ['mp4', 'webm', 'ogv', 'mov', 'm4v'];
const mediaUrl = (p) => `media://file/${encodeURI(String(p).replace(/\\/g, '/')).replace(/[?#]/g, encodeURIComponent)}`;
const dirUrl = (d) => mediaUrl(d).replace(/\/?$/, '/');
const sameSnap = (a, b) => !!a && !!b && a.src === b.src && a.css.length === b.css.length && a.css.every((t, i) => t === b.css[i]);
const TAG_NAMES = { section: 'Section', header: 'Header', footer: 'Footer', main: 'Main', article: 'Article', aside: 'Aside', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', p: 'Paragraph', img: 'Image', a: 'Link', div: 'Box', span: 'Span', ul: 'List', ol: 'Numbered list', li: 'Item', table: 'Table', tr: 'Row', td: 'Cell', th: 'Header cell', thead: 'Table head', tbody: 'Table body', form: 'Form', input: 'Field', textarea: 'Text box', button: 'Button', label: 'Label', video: 'Video', iframe: 'Embed', br: 'Line break', hr: 'Rule', strong: 'Bold', em: 'Italic', b: 'Bold', i: 'Italic', figure: 'Figure', figcaption: 'Caption', blockquote: 'Quote', pre: 'Code block', code: 'Code', nav: 'Navigation', svg: 'Graphic' };
const FONTS = [['', 'As it is'], ['-apple-system, "Segoe UI", system-ui, sans-serif', 'System sans'], ['Helvetica, Arial, sans-serif', 'Helvetica, Arial'], ['Georgia, serif', 'Georgia'], ['"Times New Roman", serif', 'Times'], ['Verdana, sans-serif', 'Verdana'], ['"Trebuchet MS", sans-serif', 'Trebuchet'], ['ui-monospace, Menlo, Consolas, monospace', 'Monospace']];
const WEIGHTS = [['', 'As it is'], ['300', 'Light'], ['normal', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['bold', 'Bold'], ['800', 'Heavy']];
const SECTIONS = [
  ['text', 'Text', [['font-family', 'Font', 'select', FONTS], ['font-size', 'Size', 'unit'], ['font-weight', 'Weight', 'select', WEIGHTS], ['line-height', 'Line height', 'unit'], ['color', 'Colour', 'color'], ['text-align', 'Align', 'seg', [['left', 'Left', 'alignLeft'], ['center', 'Centre', 'alignCenter'], ['right', 'Right', 'alignRight']]], ['font-style', 'Italic', 'seg', [['normal', 'Upright', 'textT'], ['italic', 'Italic', 'italic']]], ['text-decoration-line', 'Line', 'seg', [['none', 'None', 'textT'], ['underline', 'Underline', 'underline'], ['line-through', 'Strike', 'strike']]]]],
  ['size', 'Size', [['width', 'Width', 'unit'], ['height', 'Height', 'unit'], ['max-width', 'Max width', 'unit'], ['min-height', 'Min height', 'unit']]],
  ['spacing', 'Spacing', [['margin', 'Outside', 'unit'], ['padding', 'Inside', 'unit']]],
  ['background', 'Background', [['background-color', 'Colour', 'color'], ['opacity', 'Opacity', 'unit']]],
  ['border', 'Border', [['border-width', 'Width', 'unit'], ['border-style', 'Style', 'select', [['', 'As it is'], ['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double'], ['none', 'None']]], ['border-color', 'Colour', 'color'], ['border-radius', 'Corners', 'unit']]],
  ['layout', 'Layout', [['display', 'Show as', 'select', [['', 'As it is'], ['block', 'Block'], ['inline-block', 'Inline block'], ['inline', 'Inline'], ['flex', 'Row or column'], ['grid', 'Grid'], ['none', 'Hidden']]], ['flex-direction', 'Direction', 'select', [['', 'As it is'], ['row', 'Row'], ['column', 'Column']]], ['justify-content', 'Spread', 'select', [['', 'As it is'], ['flex-start', 'Start'], ['center', 'Centre'], ['flex-end', 'End'], ['space-between', 'Space between'], ['space-around', 'Space around']]], ['align-items', 'Line up', 'select', [['', 'As it is'], ['stretch', 'Stretch'], ['flex-start', 'Start'], ['center', 'Centre'], ['flex-end', 'End']]], ['gap', 'Gap', 'unit']]],
];
const toHex = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); return m ? `#${m.slice(1, 4).map((x) => Number(x).toString(16).padStart(2, '0')).join('')}` : /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#000000'; };
const KEYS = [['Document', [['Save, with the stylesheets', ['Ctrl', 'S']], ['Save as…', ['Ctrl', 'Shift', 'S']], ['Close', ['Ctrl', 'W']], ['Find and replace', ['Ctrl', 'H']], ['Find in the code', ['Ctrl', 'F']], ['Preview in browser', ['F12']]]],
  ['Edit', [['Undo', ['Ctrl', 'Z']], ['Redo', ['Ctrl', 'Shift', 'Z'], ['Ctrl', 'Y']], ['Copy and paste what is selected', ['Ctrl', 'C'], ['Ctrl', 'V']], ['Delete what is selected', ['Delete']], ['Insert an image', ['Ctrl', 'Alt', 'I']], ['More: cut, wrap, edit tag', ['Right-click']], ['Deselect', ['Esc']]]],
  ['Text', [['Type in text', ['Double-click']], ['Bold, italic, underline', ['Ctrl', 'B'], ['Ctrl', 'I']], ['Link', ['Ctrl', 'K']], ['New paragraph', ['Enter']], ['Line break', ['Shift', 'Enter']]]],
  ['View', [['Split', ['Ctrl', '1']], ['Design', ['Ctrl', '2']], ['Code', ['Ctrl', '3']], ['Preview', ['Ctrl', '4']], ['Keyboard shortcuts', ['?']]]],
  ['Code', [['Indent or outdent', ['Tab'], ['Shift', 'Tab']], ['Fold a block', ['Ctrl', 'Shift', '[']], ['Unfold it', ['Ctrl', 'Shift', ']']], ['Comment out', ['Ctrl', '/']], ['Suggestions', ['Ctrl', 'Space']]]]];
const plural = (n, w) => `${n} ${n === 1 ? w : `${w}s`}`;

function relPath(fromDir, file) {
  const a = fromDir.replace(/\\/g, '/').split('/').filter(Boolean), b = file.replace(/\\/g, '/').split('/').filter(Boolean);
  if (/^[a-z]:$/i.test(a[0] || '') && (a[0] || '').toLowerCase() !== (b[0] || '').toLowerCase()) return `file:///${file.replace(/\\/g, '/')}`;
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return encodeURI([...a.slice(i).map(() => '..'), ...b.slice(i)].join('/'));
}
function headField(src, which) {
  if (which === 'title') return /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(src)?.[1].trim() ?? '';
  if (which === 'lang') return /<html\b[^>]*\slang\s*=\s*["']?([^"'\s>]*)/i.exec(src)?.[1] ?? '';
  return /<meta\b(?=[^>]*\bname\s*=\s*["']?description)[^>]*\bcontent\s*=\s*"([^"]*)"/i.exec(src)?.[1] ?? /<meta\b(?=[^>]*\bname\s*=\s*["']?description)[^>]*\bcontent\s*=\s*'([^']*)'/i.exec(src)?.[1] ?? '';
}
function setHeadField(src, which, v) {
  const val = esc(v), headOpen = /<head\b[^>]*>/i;
  const insert = (tag) => (headOpen.test(src) ? src.replace(headOpen, (m) => `${m}\n  ${tag}`) : src);
  if (which === 'title') return /<title\b[^>]*>[\s\S]*?<\/title>/i.test(src) ? src.replace(/(<title\b[^>]*>)[\s\S]*?(<\/title>)/i, (m, a, b) => `${a}${val}${b}`) : insert(`<title>${val}</title>`);
  if (which === 'lang') return /<html\b[^>]*\slang\s*=/i.test(src) ? src.replace(/(<html\b[^>]*\slang\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, (m, a) => `${a}"${val}"`) : src.replace(/<html\b/i, `<html lang="${val}"`);
  const re = /<meta\b(?=[^>]*\bname\s*=\s*["']?description)[^>]*>/i;
  return re.test(src) ? src.replace(re, (m) => (/\bcontent\s*=/i.test(m) ? m.replace(/(\bcontent\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, (x, a) => `${a}"${val}"`) : m.replace(/\s*\/?>$/, ` content="${val}">`))) : insert(`<meta name="description" content="${val}">`);
}

const HL = () => L.HighlightStyle.define([
  { tag: [L.tags.keyword, L.tags.modifier, L.tags.operatorKeyword], color: 'var(--cm-kw)' },
  { tag: [L.tags.tagName, L.tags.heading], color: 'var(--cm-tag)', fontWeight: '550' },
  { tag: [L.tags.attributeName, L.tags.propertyName], color: 'var(--cm-attr)' },
  { tag: [L.tags.string, L.tags.attributeValue, L.tags.special(L.tags.string)], color: 'var(--cm-str)' },
  { tag: [L.tags.number, L.tags.bool, L.tags.atom, L.tags.unit, L.tags.color], color: 'var(--cm-num)' },
  { tag: [L.tags.comment, L.tags.blockComment, L.tags.lineComment], color: 'var(--cm-com)', fontStyle: 'italic' },
  { tag: [L.tags.className, L.tags.labelName, L.tags.typeName], color: 'var(--cm-cls)' },
  { tag: [L.tags.function(L.tags.variableName), L.tags.definition(L.tags.variableName)], color: 'var(--cm-fn)' },
  { tag: [L.tags.angleBracket, L.tags.punctuation, L.tags.bracket], color: 'var(--cm-punc)' },
  { tag: [L.tags.meta, L.tags.processingInstruction, L.tags.documentMeta], color: 'var(--cm-meta)' },
  { tag: [L.tags.link, L.tags.url], color: 'var(--cm-str)', textDecoration: 'underline' },
  { tag: L.tags.strong, fontWeight: '700' }, { tag: L.tags.emphasis, fontStyle: 'italic' }, { tag: L.tags.invalid, color: 'var(--danger)' },
]);
const BLOCKS = (icon) => [
  ['text', 'Text', 'text', '<p>Type your text here.</p>'],
  ['heading', 'Heading', 'textT', '<h2>Heading</h2>'],
  ['image', 'Image', 'image', { type: 'image', activate: true }],
  ['link', 'Link', 'link', { type: 'link', content: 'Link text', attributes: { href: '#' } }],
  ['button', 'Button', 'square', '<a class="button" href="#" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#2f6f1e;color:#fff;text-decoration:none;font-weight:600">Button</a>'],
  ['columns', 'Columns', 'split', '<div style="display:flex;gap:16px;flex-wrap:wrap"><div style="flex:1;min-width:160px;min-height:60px;padding:8px"><p>First column</p></div><div style="flex:1;min-width:160px;min-height:60px;padding:8px"><p>Second column</p></div></div>'],
  ['list', 'List', 'list', '<ul><li>First item</li><li>Second item</li><li>Third item</li></ul>'],
  ['table', 'Table', 'grid', '<table style="border-collapse:collapse;width:100%"><thead><tr><th style="border:1px solid #ccc;padding:6px;text-align:left">Name</th><th style="border:1px solid #ccc;padding:6px;text-align:left">Value</th></tr></thead><tbody><tr><td style="border:1px solid #ccc;padding:6px">One</td><td style="border:1px solid #ccc;padding:6px">1</td></tr><tr><td style="border:1px solid #ccc;padding:6px">Two</td><td style="border:1px solid #ccc;padding:6px">2</td></tr></tbody></table>'],
  ['form', 'Form', 'field', '<form style="display:grid;gap:10px;max-width:420px"><label>Name <input type="text" name="name"></label><label>E-mail <input type="email" name="email"></label><label>Message <textarea name="message" rows="4"></textarea></label><button type="submit">Send</button></form>'],
  ['video', 'Video', 'video', { type: 'video', src: '', style: { width: '100%', height: '320px' } }],
].map(([id, label, ic, content]) => ({ id, label, media: icon(ic, 'lg'), content, category: 'Basic' }));

export function openEditor(view, { file }, ctx) {
  const { toast, api, go } = ctx;
  ctx.onClose?.(close);
  const icon = (n, size = '') => ctx.icon(n, size);
  const call = (m, ...a) => api.invoke('edit:call', 'web', m, ...a);
  for (const css of ['vendor/grapes.min.css', 'webedit.css']) if (!document.querySelector(`link[href="${css}"]`)) document.head.append(h(`<link rel="stylesheet" href="${css}">`));
  const st = { ready: false, busy: false, kind: 'html', ext: '', dir: dirOf(file), css: [], hist: [], at: -1, saved: null, savePath: null, view: 'split', device: 'desktop', tab: 0, doc: null, base: null, keep: [], designStale: true, previewStale: true, linkedStale: true, applying: false, loading: false, bom: false, disposed: false, problems: null, why: '', open: new Set(['text', 'size', 'spacing']) };
  let gjs = null, cm = null, states = [], root, statusEl, codeT = null, designT = null, lang = null, mkState = null, D = null;

  const design = () => st.kind === 'html' && st.ext !== 'svg';
  const views = () => (design() ? VIEWS : VIEWS.filter(([v]) => v === 'code' || (v === 'preview' && ['md', 'svg'].includes(st.ext))));
  const shows = (part) => (part === 'design' ? ['split', 'design'].includes(st.view) : part === 'code' ? ['split', 'code'].includes(st.view) : st.view === 'preview');
  const textOf = (i) => (i === st.tab && cm ? cm.state.doc.toString() : states[i]?.doc.toString() ?? '');
  const snapshot = () => ({ src: textOf(0), css: st.css.map((c, i) => textOf(i + 1)) });

  function tip(msg, keep) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg || '';
    clearTimeout(tip.t);
    if (msg && !keep) tip.t = setTimeout(() => { statusEl.hidden = true; }, 4500);
  }
  async function busy(label, fn) {
    if (st.busy) return null;
    st.busy = true;
    root.classList.add('working');
    tip(label, true);
    try { return await fn(); } catch (e) { toast(clean(e), { type: 'error' }); return null; } finally { st.busy = false; root.classList.remove('working'); tip(null); }
  }
  function updateChrome() {
    const dirty = !sameSnap(st.hist[st.at], st.saved);
    $('.dirty', root).hidden = !dirty;
    $('[data-a=undo]', root).disabled = st.at <= 0;
    $('[data-a=redo]', root).disabled = st.at >= st.hist.length - 1;
    $$('.we-tabs [data-tab]', root).forEach((b) => { const i = Number(b.dataset.tab); b.classList.toggle('edited', i > 0 ? textOf(i) !== (st.css[i - 1].saved ?? st.css[i - 1].text) : textOf(0) !== st.saved?.src); });
  }
  function commit(label) {
    const s = { ...snapshot(), label: label || st.why || 'Changed the page' };
    st.why = '';
    if (sameSnap(s, st.hist[st.at])) return false;
    st.hist.splice(st.at + 1);
    st.hist.push(s);
    if (st.hist.length > 300) st.hist.shift();
    st.at = st.hist.length - 1;
    updateChrome();
    return true;
  }

  function setCode(i, text) {
    const cur = textOf(i);
    if (cur === text) return;
    let a = 0, b = 0;
    while (a < cur.length && a < text.length && cur[a] === text[a]) a++;
    while (b < cur.length - a && b < text.length - a && cur[cur.length - 1 - b] === text[text.length - 1 - b]) b++;
    const changes = { from: a, to: cur.length - b, insert: text.slice(a, text.length - b) };
    if (i === st.tab) { st.applying = true; try { cm.dispatch({ changes }); } finally { st.applying = false; } } else states[i] = states[i].update({ changes }).state;
  }
  function onCodeEdit() {
    clearTimeout(codeT);
    codeT = setTimeout(syncFromCode, 300);
  }
  function syncFromCode(i = st.tab) {
    clearTimeout(codeT);
    codeT = null;
    if (!commit(st.why || (i ? `Edited ${nameOf(st.css[i - 1].path)}` : 'Edited the code'))) return;
    if (i === 0) st.designStale = true; else st.linkedStale = true;
    st.previewStale = true;
    refreshVisible();
    if ($('.we-props', root).dataset.on === 'page') drawPage();
  }
  function refreshVisible() {
    if (design() && shows('design')) { if (st.designStale) loadDesign(); else if (st.linkedStale) paintLinked(); }
    if (shows('preview') && st.previewStale) refreshPreview();
  }

  function rewriteUrls(text, cssPath) {
    const baseUrl = dirUrl(dirOf(cssPath));
    return text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => (/^(data:|[a-z][\w+.-]*:|#|\/\/)/i.test(u.trim()) ? m : `url("${new URL(u.trim(), baseUrl).href}")`));
  }
  function paintLinked() {
    st.linkedStale = false;
    const doc = gjs?.Canvas.getDocument();
    if (!doc?.head) return;
    ensureBase();
    let el = doc.getElementById('lime-linked');
    if (!el) { el = doc.createElement('style'); el.id = 'lime-linked'; doc.head.append(el); }
    el.textContent = st.css.map((c, i) => (c.linked === false ? '' : rewriteUrls(textOf(i + 1), c.path))).join('\n');
  }
  function ensureBase() {
    const doc = gjs?.Canvas.getDocument();
    if (!doc?.head || doc.getElementById('lime-base')) return;
    const b = doc.createElement('base');
    b.id = 'lime-base';
    b.href = dirUrl(st.dir);
    doc.head.prepend(b);
  }
  function nameAll(c) {
    const tag = String(c.get('tagName') || '').toLowerCase();
    if (tag && c !== gjs.getWrapper() && !c.get('name') && c.get('type') !== 'textnode') { const cls = String(c.getAttributes().class || '').split(/\s+/)[0]; c.set('name', `${TAG_NAMES[tag] || tag[0].toUpperCase() + tag.slice(1)}${cls ? ` .${cls}` : ''}`); }
    c.components().forEach(nameAll);
  }
  function selPath() {
    const out = [];
    for (let c = gjs?.getSelected(); c && c.parent(); c = c.parent()) out.unshift(c.index());
    return out;
  }
  const DATTR = 'data-lime-src', VOIDS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const htmlOpts = () => ({ attributes: (c, attrs) => { delete attrs[DATTR]; if (attrs.id && !c.get('attributes')?.id && !String(st.managedNow || '').includes(`#${attrs.id}`)) delete attrs.id; return attrs; } });
  const attrsOf = (c) => { const a = { ...c.getAttrToHTML() }; return htmlOpts().attributes(c, a); };
  const startKey = (c) => `${c.get('tagName')}|${JSON.stringify(Object.entries(attrsOf(c)).sort())}`;
  const startTag = (c) => `<${String(c.get('tagName') || 'div').toLowerCase()}${Object.entries(attrsOf(c)).filter(([, v]) => v != null && v !== false).map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)).join('')}>`;
  const infoOf = (c) => { const i = c.get('attributes')?.[DATTR]; const x = i != null ? st.idx?.els[Number(i)] : null; return x && !x.bad ? x : null; };
  const isElem = (c) => !['textnode', 'comment'].includes(c.get('type'));
  const managedCss = () => gjs.Css.getAll().filter((r) => !st.baseRules.has(r.toCSS())).map((r) => r.toCSS()).filter(Boolean).join('\n');
  const cleanLive = (html) => html.replace(/\sdata-(gjs-[\w-]+|lime-src)="[^"]*"/g, '').replace(/\sclass="gjs-[^"]*"/g, '');
  function emitAll() {
    st.managedNow = managedCss();
    const o = htmlOpts(), ed = gjs.getEditing?.(), edEl = ed?.view?.getChildrenContainer?.(), body = st.idx.body, ranges = new Map(), parts = [];
    let pos = 0;
    const put = (x) => { parts.push(x); pos += x.length; };
    const run = (nodes, from, to) => {
      const html = nodes.map((n) => n.toHTML(o)).join('');
      if (from != null && to != null && to >= from) { const raw = body.slice(from, to); if (raw === html || decode(raw) === decode(html)) return raw; }
      return html;
    };
    const kids = (c, from, to) => {
      let texts = [], prev = from;
      for (const k of c.components().models) {
        if (!isElem(k)) { texts.push(k); continue; }
        const info = infoOf(k);
        if (texts.length) put(run(texts, prev, info ? info.s : null));
        else if (prev != null && info && info.s > prev && /^\s*$/.test(body.slice(prev, info.s))) put(body.slice(prev, info.s));
        texts = [];
        one(k);
        prev = info ? info.e : null;
      }
      if (texts.length) put(run(texts, prev, to));
      else if (prev != null && to != null && to > prev && /^\s*$/.test(body.slice(prev, to))) put(body.slice(prev, to));
    };
    const one = (c) => {
      const start = pos, info = infoOf(c), tag = String(c.get('tagName') || '').toLowerCase(), live = c === ed && edEl;
      if (info && tag === 'lime-keep') put(body.slice(info.s, info.e));
      else if (info && !live && c.toHTML(o) === st.snap.get(c.cid)) put(body.slice(info.s, info.e));
      else if (info) {
        const same = startKey(c) === st.keyAt.get(c.cid) && !(String(st.managedNow).includes(`#${c.getId()}`) && !/\sid\s*=/i.test(body.slice(info.s, info.t)));
        put(same ? body.slice(info.s, info.t) : startTag(c));
        if (!VOIDS.has(tag)) {
          if (live) put(cleanLive(edEl.innerHTML)); else if (!c.components().length && c.get('content')) put(String(c.get('content'))); else kids(c, info.t, info.u);
          put(same ? body.slice(info.u, info.e) : `</${tag}>`);
        }
      } else if (live) put(`${startTag(c)}${cleanLive(edEl.innerHTML)}</${tag}>`);
      else if (['video', 'map'].includes(c.get('type')) || (!c.components().length && c.get('content'))) put(c.toHTML(o));
      else { put(startTag(c)); if (!VOIDS.has(tag)) { kids(c, null, null); put(`</${tag}>`); } }
      ranges.set(c.cid, [start, pos]);
    };
    kids(gjs.getWrapper(), 0, body.length);
    st.ranges = ranges;
    st.lastEmit = parts.join('');
    return st.lastEmit;
  }
  function snapAll() {
    st.snap = new Map();
    st.keyAt = new Map();
    const o = htmlOpts(), w = gjs.getWrapper();
    const walk = (c, parentInfo) => {
      const info = infoOf(c);
      if (c !== w) {
        if (info && ((info.tag === 'script' ? 'lime-keep' : info.tag) !== String(c.get('tagName') || '').toLowerCase() || (parentInfo && info.parent !== parentInfo.idx))) info.bad = true;
        st.snap.set(c.cid, c.toHTML(o));
        st.keyAt.set(c.cid, startKey(c));
      }
      c.components().forEach((k) => walk(k, c === w ? null : infoOf(c)));
    };
    walk(w, null);
  }
  function loadDesign() {
    if (!gjs) return;
    const path = selPath(), d = parseDoc(textOf(0)), idx = indexBody(d.body);
    st.loading = true;
    try {
      ensureBase();
      gjs.select(null);
      gjs.setStyle(d.styles.filter((x) => !x.managed).map((x) => x.text).join('\n'));
      gjs.setComponents(idx.inst);
      st.baseRules = new Set(gjs.Css.getAll().map((r) => r.toCSS()));
      const managed = d.styles.filter((x) => x.managed).map((x) => x.text).join('\n');
      if (managed.trim()) gjs.Css.addRules(managed);
      st.doc = d;
      st.idx = idx;
      st.managedNow = managedCss();
      st.managedLoaded = st.managedNow;
      nameAll(gjs.getWrapper());
      snapAll();
      st.loadEmit = emitAll();
      st.rangeBase = d.whole ? d.pre.length : 0;
      st.codeAtDesign = textOf(0);
      st.base = true;
      paintLinked();
      if (path.length) { let c = gjs.getWrapper(); for (const i of path) c = c?.components().at(i); if (c && c !== gjs.getWrapper()) gjs.select(c); }
    } finally { st.loading = false; }
    drawPanels();
    st.designStale = false;
  }
  function composeFromDesign() {
    const d = st.doc, b = emitAll(), body = b === st.loadEmit ? d.body : b, mc = st.managedNow, same = mc === st.managedLoaded;
    const pre = same ? d.pre : withManaged(d, mc);
    if (d.whole) { st.rangeBase = pre.length; return pre + body + d.post; }
    const head = same ? '' : `<style ${MANAGED}>\n${fmtCss(mc, '  ')}\n</style>\n`;
    st.rangeBase = head.length;
    return head + body;
  }
  function onDesignEdit() {
    if (st.loading || !st.base) return;
    clearTimeout(designT);
    designT = setTimeout(syncFromDesign, 300);
  }
  function syncFromDesign() {
    clearTimeout(designT);
    designT = null;
    if (!gjs || !st.base || st.designStale) return;
    const src = composeFromDesign();
    if (src === textOf(0) || textOf(0) !== st.codeAtDesign) return;
    setCode(0, src);
    st.codeAtDesign = src;
    if (commit(st.why || 'Changed the design')) { st.previewStale = true; if (shows('preview')) refreshPreview(); }
  }
  function flush() {
    if (designT) syncFromDesign();
    if (codeT) syncFromCode();
  }
  function apply(s) {
    setCode(0, s.src);
    s.css.forEach((t, i) => setCode(i + 1, t));
    st.designStale = st.previewStale = st.linkedStale = true;
    refreshVisible();
    updateChrome();
    if ($('.we-props', root).dataset.on === 'page') drawPage();
  }
  function goto(i) { flush(); if (i < 0 || i >= st.hist.length || i === st.at) return; st.at = i; apply(st.hist[i]); drawPanels(); }
  const undo = () => goto(st.at - 1), redo = () => goto(st.at + 1);
  function history() {
    const old = $('.hist', root);
    if (old) { old.remove(); return; }
    flush();
    const pop = h(`<div class="hist" role="menu">${st.hist.map((x, i) => `<button data-i="${i}" class="${i === st.at ? 'cur' : i > st.at ? 'future' : ''}">${icon(i ? 'clock' : 'open', 'sm')}<span>${esc(x.label)}</span><small>${i || ''}</small></button>`).join('')}</div>`);
    const b = $('[data-a=history]', root).getBoundingClientRect();
    pop.style.left = `${b.left}px`;
    pop.style.top = `${b.bottom + 6}px`;
    root.append(pop);
    pop.addEventListener('click', (e) => { const it = e.target.closest('[data-i]'); if (it) { pop.remove(); goto(Number(it.dataset.i)); } });
    setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  }
  function help() {
    if (document.querySelector('.scrim')) return;
    const kb = (k) => k.map((x) => `<kbd>${esc(x)}</kbd>`).join('');
    const s = h(`<div class="scrim"><div class="dialog we-keys"><div class="body"><h2>Keyboard shortcuts</h2><div class="we-keycols">${KEYS.map(([g, rows]) => `<section><div class="mlabel">${esc(g)}</div>${rows.map(([what, ...ks]) => `<div class="we-key"><span>${esc(what)}</span><span class="k">${ks.map(kb).join('<i>or</i>')}</span></div>`).join('')}</section>`).join('')}</div></div><div class="foot"><span class="grow muted">Press ? any time to see these.</span><button class="btn primary" data-a="done">Done</button></div></div></div>`);
    document.body.append(s);
    $('[data-a=done]', s).focus();
    const done = () => s.remove();
    s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' || e.key === 'Enter' || e.key === '?') { e.preventDefault(); done(); } });
    s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-a=done]')) done(); });
  }

  async function previewHtml() {
    let s = textOf(0);
    if (st.ext === 'md') s = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 20px;color:#1d2117}pre{background:#f4f5f2;padding:12px;border-radius:6px;overflow:auto}img{max-width:100%}</style></head><body>${await call('markdown', s)}</body></html>`;
    st.css.forEach((c, i) => {
      const t = textOf(i + 1);
      if (t === c.text) return;
      s = s.replace(/<link\b[^>]*>/gi, (tag) => (/stylesheet/i.test(tag) && new RegExp(`href\\s*=\\s*["']?${c.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\\s>]`, 'i').test(tag) ? `<style>${rewriteUrls(t, c.path)}</style>` : tag));
    });
    const base = `<base href="${esc(dirUrl(st.dir))}">`;
    return /<head\b[^>]*>/i.test(s) ? s.replace(/<head\b[^>]*>/i, (m) => `${m}${base}`) : `${base}${s}`;
  }
  async function refreshPreview() {
    st.previewStale = false;
    const f = $('.we-preview iframe', root), y = (() => { try { return f.contentWindow.scrollY; } catch (_) { return 0; } })();
    f.srcdoc = await previewHtml().catch((e) => `<p>${esc(clean(e))}</p>`);
    f.onload = () => {
      const doc = f.contentDocument;
      if (!doc) return;
      f.contentWindow.scrollTo(0, y);
      doc.addEventListener('click', (e) => {
        const a = e.target.closest?.('a[href]');
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute('href');
        if (href.startsWith('#')) doc.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth' });
        else tip(`Links open from the saved page: ${href}`);
      }, true);
      doc.addEventListener('submit', (e) => e.preventDefault(), true);
      doc.addEventListener('keydown', onKey);
    };
  }

  function setView(v) {
    if (!views().some(([x]) => x === v)) return;
    if (st.view !== v) flush();
    st.view = v;
    root.dataset.v = v;
    $$('[data-view]', root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === v));
    $('.ed-body', root).classList.toggle('no-thumbs', !design() || !shows('design'));
    $('.ed-body', root).classList.toggle('no-props', !design() || st.view === 'preview');
    tip(v === 'code' ? codeHint() : VIEWS.find((x) => x[0] === v)?.[3]);
    refreshVisible();
    if (shows('design')) requestAnimationFrame(() => gjs?.refresh());
    if (shows('code')) requestAnimationFrame(() => cm?.requestMeasure());
  }
  function setDevice(dv) {
    st.device = dv;
    $$('[data-device]', root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.device === dv));
    const w = DEVICES.find((x) => x[0] === dv)?.[3] || '';
    $('.we-preview', root).style.setProperty('--pw', w || '100%');
    $('.we-preview', root).classList.toggle('framed', !!w);
    gjs?.setDevice(dv);
  }
  function setTab(i) {
    if (!cm || i === st.tab) return;
    flush();
    states[st.tab] = cm.state;
    st.tab = i;
    cm.setState(states[i]);
    $$('.we-tabs [data-tab]', root).forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.tab) === i));
    tip(codeHint());
  }
  function codeHint() {
    const what = st.tab ? `${nameOf(st.css[st.tab - 1].path)}: the stylesheet` : { css: 'The stylesheet', js: 'The script', md: 'The Markdown' }[st.ext === 'md' ? 'md' : st.kind] || (st.ext === 'svg' ? 'The SVG' : 'The HTML');
    return `${what}, with colours, folding and search (Ctrl+F)`;
  }
  function gotoLine(n) {
    if (!shows('code')) setView(design() ? 'split' : 'code');
    setTab(0);
    const line = cm.state.doc.line(Math.max(1, Math.min(cm.state.doc.lines, n)));
    cm.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
    cm.focus();
  }
  async function formatCode() {
    flush();
    const i = st.tab, kind = i ? 'css' : st.kind;
    if (!['html', 'css', 'js'].includes(kind)) { toast('Only HTML, CSS and scripts can be formatted.'); return; }
    const out = await busy('Formatting…', () => call('format', textOf(i), kind, {}));
    if (out == null || out === textOf(i)) { if (out != null) tip('Already neatly formatted'); return; }
    setCode(i, out);
    st.why = i ? `Formatted ${nameOf(st.css[i - 1].path)}` : 'Formatted the code';
    syncFromCode();
    tip('Formatted');
  }
  async function checkPage() {
    flush();
    const r = await busy('Checking the page…', () => call('check', textOf(0), st.dir));
    if (!r) return;
    st.problems = [...r.problems, ...r.links.problems].sort((a, b) => a.line - b.line);
    st.linksChecked = r.links;
    showProps('page');
    tip(st.problems.length ? plural(st.problems.length, 'problem') : 'No problems found');
  }

  function showProps(tab) {
    const p = $('.we-props', root);
    p.dataset.on = tab;
    $$('.we-ptabs [data-ptab]', root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.ptab === tab));
    $$('.we-pane', p).forEach((x) => { x.hidden = x.dataset.pane !== tab; });
    drawPanels();
  }
  function drawPanels() {
    const tab = $('.we-props', root).dataset.on;
    if (tab === 'page') drawPage(); else if (tab === 'style') drawStyle(); else if (tab === 'css') D.cssDesigner($('.we-pane[data-pane=css]', root)); else D.inspector($('.we-pane[data-pane=element]', root));
  }
  const sel = () => gjs?.getSelected() || null;
  const nameOfComp = (c) => c?.getName?.() || 'Element';
  function computed(c) { const el = c?.getEl?.(); try { return el ? gjs.Canvas.getWindow().getComputedStyle(el) : null; } catch (_) { return null; } }
  function drawStyle() {
    const pane = $('.we-pane[data-pane=style]', root), c = sel();
    if (!c) { pane.innerHTML = '<h3>Style</h3><p class="tip">Select something on the page to change its font, colours, size and spacing.</p>'; return; }
    const own = c.getStyle() || {}, cs = computed(c), keep = pane.scrollTop;
    const row = ([prop, label, kind, choices]) => {
      const v = own[prop] ?? '', now = cs?.getPropertyValue(prop) || '', set = v !== '' ? ' set' : '';
      let ctl;
      if (kind === 'select') ctl = `<select class="input" data-prop="${prop}">${choices.map(([val, l]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(val === '' && now && prop !== 'font-family' ? `${l} (${now})` : l)}</option>`).join('')}${v && !choices.some(([val]) => val === v) ? `<option value="${esc(v)}" selected>${esc(v)}</option>` : ''}</select>`;
      else if (kind === 'seg') ctl = `<div class="seg" data-segprop="${prop}">${choices.map(([val, l, ic]) => `<button class="tb icon" data-v="${val}" title="${esc(l)}" aria-pressed="${v === val}">${icon(ic, 'sm')}</button>`).join('')}</div>`;
      else if (kind === 'color') ctl = `<div class="we-colour"><label class="sw" style="background:${esc(v || now || 'transparent')}"><input type="color" data-prop="${prop}" value="${toHex(v || now)}"></label><input class="input" data-prop="${prop}" value="${esc(v)}" placeholder="${esc(toHex(now))}" spellcheck="false"></div>`;
      else ctl = `<input class="input" data-prop="${prop}" value="${esc(v)}" placeholder="${esc(now)}" spellcheck="false">`;
      return `<div class="we-row${set}"><label title="${esc(prop)}">${esc(label)}</label>${ctl}</div>`;
    };
    const classes = c.getClasses().map((x) => (typeof x === 'string' ? x : x.get?.('name') || x.name)).filter(Boolean);
    pane.innerHTML = `<h3>${esc(nameOfComp(c))}</h3>
      <div class="we-chips">${classes.map((x) => `<span class="chip">.${esc(x)}<button data-unclass="${esc(x)}" title="Remove the class">${icon('close', 'sm')}</button></span>`).join('')}<button class="chip add" data-a="addclass">${icon('add', 'sm')}Add class</button></div>
      ${SECTIONS.map(([id, title, props]) => `<section class="we-sec${st.open.has(id) ? ' open' : ''}"><div class="we-sech" data-sec="${id}"><b>${esc(title)}</b><span class="grow"></span><button class="we-reset" data-reset="${id}" ${props.some(([p]) => own[p]) ? '' : 'disabled'}>Reset</button>${icon(st.open.has(id) ? 'down' : 'chevron', 'sm')}</div><div class="we-secb">${props.map(row).join('')}</div></section>`).join('')}
      <p class="tip">Changes apply to this ${esc(nameOfComp(c).toLowerCase())} only, in a style block in the page’s head.</p>`;
    pane.scrollTop = keep;
  }
  function setStyle(prop, v, label) {
    const c = sel();
    if (!c) return;
    const val = String(v ?? '').trim();
    if (val) c.addStyle({ [prop]: val }); else c.removeStyle(prop);
    st.why = `Changed the ${label.toLowerCase()} of ${nameOfComp(c).toLowerCase()}`;
    onDesignEdit();
    drawStyle();
  }
  const propLabel = (prop) => SECTIONS.flatMap(([, , ps]) => ps).find(([p]) => p === prop)?.[1] || prop;
  function drawPage() {
    const pane = $('.we-pane[data-pane=page]', root), src = textOf(0);
    const field = (k, label, ph) => `<div class="field"><label class="label">${label}</label><input class="input" data-head="${k}" value="${esc(headField(src, k))}" placeholder="${esc(ph)}" spellcheck="${k === 'lang' ? 'false' : 'true'}"></div>`;
    const list = st.problems;
    pane.innerHTML = `<h3>Page</h3>${design() ? `${field('title', 'Title', 'Shown on the browser tab')}${field('lang', 'Language', 'en-GB')}<div class="field"><label class="label">Description</label><textarea class="input" data-head="description" rows="3" placeholder="For search results and link previews">${esc(headField(src, 'description'))}</textarea></div>` : ''}
      ${st.css.length ? `<h3 class="sub">Linked styles</h3><div class="we-files">${st.css.map((c, i) => `<button class="we-file" data-open="${i + 1}">${icon('code', 'sm')}<span>${esc(c.href)}</span>${textOf(i + 1) !== c.text ? '<em>Edited</em>' : ''}</button>`).join('')}</div>` : ''}
      <h3 class="sub">Check</h3><p class="tip">Unclosed tags, ids used twice, pictures without alt text, missing files and broken #anchors.</p>
      <button class="btn" data-a="check">${icon('check', 'sm')}Check page</button>
      ${list ? (list.length ? `<ul class="we-problems">${list.map((x) => `<li class="${x.level}"><button data-line="${x.line}"><b>Line ${x.line}</b><span>${esc(x.msg)}</span></button></li>`).join('')}</ul>` : '<p class="we-ok">No problems found.</p>') : ''}
      ${list && st.linksChecked?.remote ? `<p class="tip">${plural(st.linksChecked.remote, 'web address')} not checked: Lime works offline.</p>` : ''}`;
  }

  async function pickInto(comp, kind) {
    const ext = kind === 'video' ? VIDEO_EXT : IMAGE_EXT;
    const [f] = await api.invoke('dialog:open', { multi: false, filters: [{ name: kind === 'video' ? 'Videos' : 'Pictures', extensions: ext }] });
    if (!f) return false;
    comp.set('src', relPath(st.dir, await call('copyInto', f, st.dir)));
    if (kind === 'image' && !comp.getAttributes().alt) comp.addAttributes({ alt: nameOf(f).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') });
    return true;
  }
  function makeDesign(el) {
    const keep = (ed) => { ed.DomComponents.addType('image', { model: { defaults: { resizable: { ratioDefault: true } } } }); ed.DomComponents.addType('lime-keep', { isComponent: (n) => n.tagName === 'LIME-KEEP', model: { defaults: { layerable: false, selectable: false, hoverable: false, highlightable: false, draggable: false, droppable: false, copyable: false, removable: false } } }); };
    gjs = L.grapesjs.init({
      container: el, height: '100%', width: 'auto', fromElement: false, storageManager: false, noticeOnUnload: false, showOffsets: true, protectedCss: '', keepUnusedStyles: true, avoidInlineStyle: false, forceClass: false, telemetry: false, cssIcons: '',
      canvasCss: '.gjs-selected{outline:2px solid #3d8a28!important;outline-offset:-2px}.gjs-hovered{outline:1px dashed #3d8a28!important}',
      panels: { defaults: [] },
      canvas: { frameStyle: '* ::-webkit-scrollbar { width: 10px; height: 10px } * ::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, .2); border-radius: 10px; border: 3px solid transparent; background-clip: padding-box }' },
      parser: { optionsHtml: { allowScripts: false, allowUnsafeAttr: true, allowUnsafeAttrValue: true, keepEmptyTextNodes: true } },
      blockManager: { appendTo: $('.we-blocks', root), blocks: BLOCKS(icon) },
      layerManager: { appendTo: $('.we-layers', root) },
      selectorManager: { componentFirst: true },
      deviceManager: { devices: DEVICES.map(([id, name, , width]) => ({ id, name, width, widthMedia: width ? `${parseInt(width, 10) + (id === 'tablet' ? 224 : 105)}px` : '' })) },
      assetManager: { upload: false },
      richTextEditor: { actions: [] },
      plugins: [keep],
    });
    gjs.Commands.add('core:open-assets', { run: (ed, s, o = {}) => { if (o.target) pickInto(o.target, 'image'); } });
    for (const k of ['core:undo', 'core:redo']) gjs.Keymaps.remove(k);
    gjs.on('component:remove', (c) => { if (!st.loading) st.why = `Removed ${nameOfComp(c).toLowerCase()}`; });
    gjs.on('component:input', (c) => { st.why = `Typed in ${nameOfComp(c).toLowerCase()}`; });
    gjs.on('component:add', (c) => { if (st.loading) return; nameAll(c); st.why = st.why || `Added ${nameOfComp(c).toLowerCase()}`; const t = c.get('type'); if ((t === 'image' || t === 'video') && !c.get('src') && !c.getAttributes().src) setTimeout(() => pickInto(c, t).then((ok) => { if (ok) onDesignEdit(); }), 50); });
    gjs.on('rte:enable', () => { D.makeBar(gjs.RichTextEditor.getToolbarEl()); });
    gjs.on('rte:disable', () => { const t = gjs.RichTextEditor.getToolbarEl(); if (t) t.innerHTML = ''; onDesignEdit(); });
    gjs.on('component:deselected', (c) => { if (c?.view?.rteEnabled) c.view.disableEditing?.(); });
    gjs.on('update component:input component:update style:property:update', onDesignEdit);
    gjs.on('component:selected', (c) => { try { gjs.Canvas.scrollTo(c, { behavior: 'smooth' }); } catch (_) {} if (shows('code') && st.tab === 0 && !cm?.hasFocus && !designT) showInCode(c, false); });
    gjs.on('component:toggled', () => { if (!st.loading) drawPanels(); });
    gjs.on('canvas:frame:load', ({ window: w }) => { w?.addEventListener('keydown', onKey); setTimeout(() => D.hookFrame(), 0); });
    return new Promise((ok) => gjs.on('load', () => { D.hookFrame(); ok(); }));
  }
  function makeCode(el, kinds) {
    lang = new L.Compartment();
    const langOf = (k) => (k === 'css' ? L.css() : k === 'js' ? L.javascript() : k === 'md' ? L.markdown() : L.html());
    const theme = L.EditorView.theme({
      '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'var(--surface)', color: 'var(--ink)' },
      '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
      '.cm-content': { caretColor: 'var(--ink)', padding: '8px 0' },
      '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--ink-3)', border: 'none', borderRight: '.5px solid var(--line-2)' },
      '.cm-activeLine': { backgroundColor: 'var(--cm-line)' }, '.cm-activeLineGutter': { backgroundColor: 'var(--cm-line)', color: 'var(--ink-2)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--cm-sel) !important' },
      '.cm-cursor': { borderLeftColor: 'var(--ink)' }, '.cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '.5px solid var(--accent)' },
      '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--ink)' }, '.cm-panels-bottom': { borderTop: '.5px solid var(--line-2)' },
      '.cm-tooltip': { backgroundColor: 'var(--surface)', border: 'none', boxShadow: 'var(--shadow)', borderRadius: '8px' },
      '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-3)', border: 'none', color: 'var(--ink-2)' },
    });
    const ext = (k) => [L.lineNumbers(), L.highlightActiveLineGutter(), L.highlightSpecialChars(), L.foldGutter(), L.drawSelection(), L.dropCursor(), L.EditorState.allowMultipleSelections.of(true), L.indentOnInput(),
      L.syntaxHighlighting(HL()), L.bracketMatching(), L.closeBrackets(), L.autocompletion(), L.rectangularSelection(), L.crosshairCursor(), L.highlightActiveLine(), L.highlightSelectionMatches(), L.indentUnit.of('  '),
      L.keymap.of([...L.closeBracketsKeymap, ...L.defaultKeymap, ...L.searchKeymap, ...L.foldKeymap, ...L.completionKeymap, L.indentWithTab]), lang.of(langOf(k)), theme, L.EditorView.lineWrapping,
      L.EditorView.updateListener.of((u) => { if (u.docChanged && !st.applying) onCodeEdit(); })];
    mkState = (text, k) => L.EditorState.create({ doc: text, extensions: ext(k) });
    states = kinds.map(([text, k]) => mkState(text, k));
    cm = new L.EditorView({ state: states[0], parent: el });
  }
  function dragDivider(e) {
    const stage = $('.we-stage', root), r = stage.getBoundingClientRect();
    root.classList.add('dragging');
    const move = (ev) => { const hgt = Math.max(90, Math.min(r.height - 140, r.bottom - ev.clientY)); stage.style.setProperty('--code-h', `${hgt}px`); };
    const up = () => { root.classList.remove('dragging'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); try { localStorage.setItem('lime.web.code', String(parseInt(stage.style.getPropertyValue('--code-h'), 10) / r.height)); } catch (_) {} gjs?.refresh(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  }

  const base = nameOf(file).replace(/\.[^.]+$/, '');
  async function save(as) {
    if (!st.ready) return false;
    flush();
    let target = as ? null : st.savePath;
    if (as) {
      target = await api.invoke('dialog:save', { defaultPath: `${st.dir}${sep}${base} (edited).${st.ext}`, filters: [{ name: st.kind === 'html' ? 'Web page' : st.ext.toUpperCase(), extensions: [st.ext] }] });
      if (!target) return false;
    }
    const s = snapshot();
    const r = await busy('Saving…', () => call('save', file, target, { src: s.src, bom: st.bom, css: st.css.map((c, i) => ({ path: c.path, text: s.css[i] })).filter((c, i) => c.text !== st.css[i].text) }));
    if (!r) return false;
    st.savePath = r.path;
    st.saved = s;
    st.css.forEach((c, i) => { c.saved = s.css[i]; });
    updateChrome();
    toast(`Saved ${nameOf(r.path)}${r.css.length ? ` and ${plural(r.css.length, 'stylesheet')}` : ''}`, { type: 'success', actions: [{ label: 'Open', fn: () => api.invoke('shell:open', r.path) }, { label: 'Show in folder', fn: () => api.invoke('shell:show', r.path) }] });
    return true;
  }
  async function close() {
    flush();
    if (st.ready && !sameSnap(st.hist[st.at], st.saved)) {
      const choice = await confirm3(`Save changes to ${nameOf(file)}?`, 'Your edits will be lost if you don’t save them.');
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await save(false))) return;
    }
    go();
  }
  function confirm3(title, text) {
    return new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>${esc(title)}</h2><p class="muted" style="margin:0">${esc(text)}</p></div><div class="foot"><button class="btn primary" data-a="save">Save</button><button class="btn" data-a="discard">Don’t save</button><button class="btn" data-a="cancel">Cancel</button></div></div></div>`);
      document.body.append(s);
      $('[data-a=save]', s).focus();
      s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { s.remove(); resolve('cancel'); } });
      s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { s.remove(); resolve(a); } });
    });
  }

  root = h(`<div class="editor webed" data-v="split">
    <header class="ed-head">
      <div class="topbar">
        <button class="tb icon" data-a="close" title="Close">${icon('back')}</button>
        <div class="doc">${icon('web')}<b title="${esc(file)}">${esc(nameOf(file))}</b><span class="dirty" hidden>Unsaved</span></div>
        <div class="seg"><button class="tb icon" data-a="undo" title="Undo (Ctrl+Z)" disabled>${icon('undo')}</button><button class="tb icon" data-a="redo" title="Redo (Ctrl+Y)" disabled>${icon('redo')}</button><button class="tb icon" data-a="history" title="History">${icon('clock')}</button></div>
        <div class="grow"></div>
        <button class="tb icon" data-a="help" title="Keyboard shortcuts (?)">${icon('help')}</button>
        <button class="btn" data-a="saveas">Save as…</button>
        <button class="btn primary" data-a="save">${icon('save', 'sm')}Save</button>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Tools">
        <div class="tgroup we-views" role="group" aria-label="View"></div>
        <div class="tgroup compact we-devices" role="group" aria-label="Width">${DEVICES.map(([id, label, ic]) => `<button class="tool" data-device="${id}" aria-pressed="${id === 'desktop'}" title="${label} width">${icon(ic)}<span class="lbl">${label}</span></button>`).join('')}</div>
        <div class="tgroup opt we-designtools" role="group" aria-label="Insert"><button class="tool" data-a="insert" title="Insert: boxes, text, media, tables and forms">${icon('add')}<span class="lbl">Insert</span></button><button class="tool" data-a="image" title="Image: a picture from your computer (Ctrl+Alt+I)">${icon('image')}<span class="lbl">Image</span></button><button class="tool" data-a="watermark" title="Watermark: text or a picture over the page or a picture">${icon('stamp')}<span class="lbl">Watermark</span></button></div>
        <div class="tgroup compact we-pagetools" role="group" aria-label="Page"><button class="tool" data-a="findall" title="Find and replace in this file or the whole site (Ctrl+H)">${icon('replace')}<span class="lbl">Find</span></button><button class="tool" data-a="check" title="Check page: unclosed tags, duplicate ids, missing alt text and broken links">${icon('check')}<span class="lbl">Check</span></button><button class="tool" data-a="browser" title="Preview in browser: saves, then opens the page (F12)">${icon('open')}<span class="lbl">Browser</span></button></div>
      </div>
    </header>
    <div class="ed-body we-body">
      <aside class="thumbs we-side" aria-label="Blocks and layers">
        <div class="seg sidetabs"><button class="tb" data-stab="blocks" aria-pressed="true" title="Blocks to drag onto the page">${icon('blocks', 'sm')}<span class="lbl">Blocks</span></button><button class="tb" data-stab="layers" aria-pressed="false" title="Everything on the page, nested">${icon('layers', 'sm')}<span class="lbl">Layers</span></button><button class="tb" data-stab="files" aria-pressed="false" title="The site’s files">${icon('folder', 'sm')}<span class="lbl">Files</span></button></div>
        <div class="pane we-blocks" data-spane="blocks"></div>
        <div class="pane we-layers" data-spane="layers" hidden></div>
        <div class="pane we-files2" data-spane="files" hidden></div>
      </aside>
      <div class="we-stage">
        <div class="we-design"></div>
        <div class="we-divider" title="Drag to resize"><i></i></div>
        <div class="we-code"><div class="we-codebar"><div class="we-tabs"></div><div class="grow"></div><button class="tb" data-a="format" title="Format: indent the code neatly">${icon('format', 'sm')}<span class="lbl">Format</span></button><button class="tb" data-a="find" title="Find and replace (Ctrl+F)">${icon('search', 'sm')}<span class="lbl">Find</span></button></div><div class="we-cm"></div></div>
        <div class="we-preview"><iframe sandbox="allow-same-origin" title="Preview"></iframe></div>
        <div class="ed-status" hidden></div>
      </div>
      <aside class="props we-props" data-on="element" aria-label="Properties">
        <div class="seg full we-ptabs"><button class="tb" data-ptab="element" aria-pressed="true">Properties</button><button class="tb" data-ptab="style" aria-pressed="false">Style</button><button class="tb" data-ptab="css" aria-pressed="false">CSS</button><button class="tb" data-ptab="page" aria-pressed="false">Page</button></div>
        <div class="we-pane" data-pane="style" hidden></div>
        <div class="we-pane" data-pane="css" hidden></div>
        <div class="we-pane" data-pane="element"></div>
        <div class="we-pane" data-pane="page" hidden></div>
      </aside>
    </div>
  </div>`);
  view.append(root);
  statusEl = $('.ed-status', root);
  try { const f = Number(localStorage.getItem('lime.web.code')); if (f > 0.1 && f < 0.9) $('.we-stage', root).style.setProperty('--code-h', `${Math.round(f * 100)}%`); } catch (_) {}

  root.addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]');
    if (v) { setView(v.dataset.view); return; }
    const dv = e.target.closest('[data-device]');
    if (dv) { setDevice(dv.dataset.device); if (st.view === 'code') setView(design() ? 'split' : 'preview'); return; }
    const tb = e.target.closest('[data-tab]');
    if (tb) { setTab(Number(tb.dataset.tab)); return; }
    const sp = e.target.closest('[data-stab]');
    if (sp) { $$('[data-stab]', root).forEach((b) => b.setAttribute('aria-pressed', b === sp)); $$('[data-spane]', root).forEach((p) => { p.hidden = p.dataset.spane !== sp.dataset.stab; }); if (sp.dataset.stab === 'files') D.filesPanel($('.we-files2', root)); return; }
    const pt = e.target.closest('[data-ptab]');
    if (pt) { showProps(pt.dataset.ptab); return; }
    const ln = e.target.closest('[data-line]');
    if (ln) { gotoLine(Number(ln.dataset.line)); return; }
    const unc = e.target.closest('[data-unclass]');
    if (unc && sel()) { sel().removeClass(unc.dataset.unclass); st.why = `Removed the class .${unc.dataset.unclass}`; onDesignEdit(); drawStyle(); return; }
    const rs = e.target.closest('[data-reset]');
    if (rs && sel()) { const c = sel(), props = SECTIONS.find(([id]) => id === rs.dataset.reset)[2]; for (const [p] of props) c.removeStyle(p); st.why = `Reset the ${rs.dataset.reset} of ${nameOfComp(c).toLowerCase()}`; onDesignEdit(); drawStyle(); return; }
    const sec = e.target.closest('[data-sec]');
    if (sec) { const id = sec.dataset.sec; if (st.open.has(id)) st.open.delete(id); else st.open.add(id); drawStyle(); return; }
    const sp2 = e.target.closest('[data-segprop] [data-v]');
    if (sp2) { const prop = sp2.closest('[data-segprop]').dataset.segprop; setStyle(prop, sp2.getAttribute('aria-pressed') === 'true' ? '' : sp2.dataset.v, propLabel(prop)); return; }
    const op = e.target.closest('[data-open]');
    if (op) { if (!shows('code')) setView(design() ? 'split' : 'code'); setTab(Number(op.dataset.open)); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || !st.ready) { if (a === 'close') go(); return; }
    if (a === 'close') close();
    if (a === 'undo') undo();
    if (a === 'redo') redo();
    if (a === 'history') history();
    if (a === 'help') help();
    if (a === 'insert') { const b = e.target.closest('[data-a]').getBoundingClientRect(); D.insertMenu({ x: b.left, y: b.bottom + 6 }); }
    if (a === 'image') D.insertImage();
    if (a === 'watermark') D.watermark();
    if (a === 'findall') D.findReplace();
    if (a === 'browser') previewInBrowser();
    if (a === 'addclass') { const b = e.target.closest('[data-a]'), inp = h('<input class="input chipin" placeholder="Class name" spellcheck="false">'); b.replaceWith(inp); inp.focus(); inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = ''; inp.blur(); } }); inp.addEventListener('blur', () => { const n = inp.value.trim().replace(/^\./, '').replace(/\s+/g, '-'); if (n && sel()) { sel().addClass(n); st.why = `Added the class .${n}`; onDesignEdit(); } drawStyle(); }); }
    if (a === 'save') save(false);
    if (a === 'saveas') save(true);
    if (a === 'format') formatCode();
    if (a === 'check') checkPage();
    if (a === 'find') { if (!shows('code')) setView(design() ? 'split' : 'code'); L.openSearchPanel(cm); }
  });
  root.addEventListener('change', (e) => {
    const d = e.target.dataset || {};
    if (d.prop) { setStyle(d.prop, e.target.value, propLabel(d.prop)); return; }
    const k = d.head;
    if (!k) return;
    flush();
    setCode(0, setHeadField(textOf(0), k, e.target.value.trim()));
    st.why = `Changed the ${k === 'lang' ? 'language' : k}`;
    syncFromCode();
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches?.('.we-props input.input')) e.target.blur(); });
  $('.we-divider', root).addEventListener('pointerdown', dragDivider);

  function onKey(e) {
    if (document.querySelector('.scrim') || !st.ready) return;
    const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), t = e.target;
    if (c && k === 's') { e.preventDefault(); save(e.shiftKey); return; }
    if (c && k === 'w') { e.preventDefault(); close(); return; }
    if ((c && k === 'h') || (c && e.shiftKey && k === 'f')) { e.preventDefault(); D.findReplace(); return; }
    if (e.key === 'F12') { e.preventDefault(); previewInBrowser(); return; }
    if (c && e.altKey && k === 'i' && design()) { e.preventDefault(); D.insertImage(); return; }
    if (c && !e.shiftKey && !e.altKey && ['1', '2', '3', '4'].includes(e.key)) { const v = VIEWS[Number(e.key) - 1]?.[0]; if (views().some(([x]) => x === v)) { e.preventDefault(); setView(v); } return; }
    const field = t?.matches?.('input, textarea, select') || t?.isContentEditable;
    if (e.key === '?' && !c && !field) { e.preventDefault(); help(); return; }
    const ours = !field || !!t?.closest?.('.cm-editor');
    if (c && k === 'z' && !e.shiftKey && ours) { e.preventDefault(); undo(); } else if (c && (k === 'y' || (e.shiftKey && k === 'z')) && ours) { e.preventDefault(); redo(); } else if (e.key === 'Escape' && !t?.closest?.('.cm-panel, .cm-tooltip') && !field && gjs?.getSelected()) { e.preventDefault(); gjs.select(null); }
  }
  document.addEventListener('keydown', onKey);

  (async () => {
    try {
      const d = await call('open', file);
      if (st.disposed) return;
      Object.assign(st, { kind: d.kind, ext: d.ext, dir: d.dir, css: d.css, bom: d.bom });
      $('.we-views', root).innerHTML = views().map(([id, label, ic, t]) => `<button class="tool" data-view="${id}" aria-pressed="false" title="${esc(`${label}: ${t}`)}">${icon(ic)}<span class="lbl">${label}</span></button>`).join('');
      $('.we-tabs', root).innerHTML = [nameOf(file), ...d.css.map((c) => nameOf(c.path))].map((n, i) => `<button class="tb" data-tab="${i}" aria-pressed="${i === 0}" title="${esc(i ? d.css[i - 1].path : file)}">${icon(i ? 'code' : 'web', 'sm')}<span class="lbl">${esc(n)}</span></button>`).join('');
      $('.we-devices', root).hidden = !views().some(([v]) => v !== 'code');
      root.classList.toggle('code-only', !design());
      $('.we-pagetools [data-a=check]', root).hidden = !design();
      $('.we-designtools', root).hidden = !design();
      makeCode($('.we-cm', root), [[d.src, d.ext === 'md' ? 'md' : d.kind], ...d.css.map((c) => [c.text, 'css'])]);
      st.hist = [{ ...snapshot(), label: 'Opened' }];
      st.at = 0;
      st.saved = st.hist[0];
      if (design()) await makeDesign($('.we-design', root));
      if (st.disposed) return;
      st.ready = true;
      setView(design() ? 'split' : 'code');
      updateChrome();
    } catch (e) {
      toast(clean(e), { type: 'error' });
      go();
    }
  })();

  function addTab(path, text, kind) {
    st.css.push({ path, text, href: null, linked: false });
    states.push(mkState(text, kind));
    const i = st.css.length;
    $('.we-tabs', root).append(h(`<button class="tb" data-tab="${i}" aria-pressed="false" title="${esc(path)}">${icon('code', 'sm')}<span class="lbl">${esc(nameOf(path))}</span></button>`));
    st.hist = st.hist.map((x) => ({ ...x, css: [...x.css, text] }));
    st.saved = { ...st.saved, css: [...st.saved.css, text] };
    return i;
  }
  async function openFile(p) {
    const ext = (p.split('.').pop() || '').toLowerCase();
    if (/^(html?|xhtml)$/.test(ext)) { if (p !== file) api.invoke('editor:open', p, 'web'); return; }
    if (!['css', 'js', 'mjs', 'json', 'md', 'txt', 'svg', 'xml'].includes(ext)) { api.invoke('shell:open', p); return; }
    let i = st.css.findIndex((c) => c.path === p) + 1;
    if (!i) i = addTab(p, await call('readText', p), ext === 'mjs' ? 'js' : ext);
    if (!shows('code')) setView(design() ? 'split' : 'code');
    setTab(i);
  }
  function gotoRange(from, to, focus = true) {
    if (!shows('code')) setView(design() ? 'split' : 'code');
    setTab(0);
    const n = cm.state.doc.length;
    cm.dispatch({ selection: { anchor: Math.min(from, n), head: Math.min(to, n) }, scrollIntoView: true });
    if (focus) cm.focus();
  }
  function showInCode(c, focus) {
    const r = st.ranges?.get(c.cid);
    if (!r || st.designStale) return false;
    gotoRange(st.rangeBase + r[0], st.rangeBase + r[1], focus);
    return true;
  }
  function inspect(c) {
    flush();
    if (!showInCode(c, true)) toast('Couldn’t find that in the code.');
  }
  async function previewInBrowser() {
    flush();
    if (!sameSnap(st.hist[st.at], st.saved) || !st.savePath) { if (!sameSnap(st.hist[st.at], st.saved) && !(await save(false))) return; }
    api.invoke('shell:open', st.savePath || file);
    tip(`Opened ${nameOf(st.savePath || file)} in your browser`);
  }
  function confirmBox(title, text) {
    return new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>${esc(title)}</h2><p class="muted" style="margin:0">${esc(text)}</p></div><div class="foot"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">OK</button></div></div></div>`);
      document.body.append(s);
      $('[data-a=ok]', s).focus();
      s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { s.remove(); resolve(false); } });
      s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { s.remove(); resolve(a === 'ok'); } });
    });
  }
  D = designTools({ st, api, call, icon, toast, tip, file, gjs: () => gjs, textOf, setCode, flush, onDesignEdit, drawPanels: () => drawPanels(), nameAll: (c) => nameAll(c), relPath, mediaUrl, dirUrl, htmlOpts, busy, syncFromCode, inspect, gotoRange, openFile, confirm: confirmBox });
  D.bindInspector($('.we-pane[data-pane=element]', root));
  D.bindDesigner($('.we-pane[data-pane=css]', root));
  D.bindFiles($('.we-files2', root));

  window.__web = { st, gjs: () => gjs, cm: () => cm, textOf, setCode, flush, setView, setTab, save, syncFromCode, D, openFile, inspect };
  const dispose = () => {
    if (st.disposed) return;
    st.disposed = true;
    document.removeEventListener('keydown', onKey);
    try { gjs?.destroy(); } catch (_) {}
    cm?.destroy();
  };
  window.addEventListener('pagehide', dispose);
  return dispose;
}
