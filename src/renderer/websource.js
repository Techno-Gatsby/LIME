const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript']);
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const SIBLINGS = { li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], option: ['option'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'], thead: ['tbody', 'tfoot'], tbody: ['tbody', 'tfoot'], tfoot: ['tbody'] };
export const MANAGED = 'data-webcraft';

export function indexBody(body) {
  const els = [], stack = [], re = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let out = '', last = 0, m, foreign = 0;
  const end = (el, at, to = at, noEnd = true) => { el.u = at; el.e = to; el.noEnd = noEnd; };
  while ((m = re.exec(body))) {
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.map((x) => x.tag).lastIndexOf(tag);
      if (i < 0) continue;
      for (const x of stack.splice(i + 1)) { end(x, m.index); if (x.tag === 'svg' || x.tag === 'math') foreign--; }
      const el = stack.pop();
      end(el, m.index, re.lastIndex, false);
      if (tag === 'svg' || tag === 'math') foreign--;
      continue;
    }
    const top = stack[stack.length - 1];
    if (top && !foreign && ((top.tag === 'p' && CLOSES_P.has(tag)) || SIBLINGS[tag]?.includes(top.tag))) end(stack.pop(), m.index);
    const el = { tag, s: m.index, t: re.lastIndex, u: re.lastIndex, e: re.lastIndex, noEnd: false, idx: els.length, parent: stack[stack.length - 1]?.idx ?? -1 };
    els.push(el);
    const self = /\/\s*$/.test(m[3]);
    if (tag === 'script') {
      const close = new RegExp('</script\\s*>', 'ig');
      close.lastIndex = re.lastIndex;
      const c = close.exec(body);
      end(el, c ? c.index : body.length, c ? close.lastIndex : body.length, !c);
      out += `${body.slice(last, m.index)}<lime-keep data-lime-src="${el.idx}"></lime-keep>`;
      last = el.e;
      re.lastIndex = el.e;
      continue;
    }
    const at = m.index + 1 + m[2].length;
    out += `${body.slice(last, at)} data-lime-src="${el.idx}"`;
    last = at;
    if (VOID.has(tag) || (self && foreign)) continue;
    if (RAW.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, 'ig');
      close.lastIndex = re.lastIndex;
      const c = close.exec(body);
      end(el, c ? c.index : body.length, c ? close.lastIndex : body.length, !c);
      out += body.slice(last, el.e);
      last = el.e;
      re.lastIndex = el.e;
      continue;
    }
    stack.push(el);
    if (tag === 'svg' || tag === 'math') foreign++;
  }
  for (const x of stack) end(x, body.length);
  out += body.slice(last);
  return { body, inst: out, els };
}

export function parseDoc(src) {
  const open = /<body\b[^>]*>/i.exec(src);
  if (!open) return { whole: false, pre: '', body: src, post: '', styles: [] };
  const endAt = open.index + open[0].length, close = src.toLowerCase().lastIndexOf('</body'), stop = close >= endAt ? close : src.length, pre = src.slice(0, endAt);
  return { whole: true, pre, body: src.slice(endAt, stop), post: src.slice(stop), styles: [...pre.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)].map((x) => ({ at: x.index, len: x[0].length, open: x.index + x[0].indexOf('>') + 1, text: x[2], managed: x[1].includes(MANAGED) })) };
}

export function fmtCss(css, pad = '    ') {
  let out = '', depth = 0, q = null, paren = 0;
  const nl = () => `\n${'  '.repeat(depth)}`;
  for (const c of css) {
    if (q) { out += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; out += c; continue; }
    if (c === '(') paren++;
    if (c === ')') paren = Math.max(0, paren - 1);
    if (paren) { out += c; continue; }
    if (c === '{') { depth++; out = `${out.trimEnd()} {${nl()}`; } else if (c === ';') out += `;${nl()}`;
    else if (c === '}') { depth = Math.max(0, depth - 1); out = `${out.trimEnd()}${nl()}}${nl()}`; } else out += c;
  }
  return out.split('\n').map((l) => l.trimEnd()).filter(Boolean).map((l) => `${pad}${l.replace(/:(?=\S)(?![^(]*\))/, ': ')}`).join('\n');
}

export function withManaged(d, css) {
  const m = d.styles.find((x) => x.managed);
  const indent = /\n([ \t]*)<\/head/i.exec(d.pre)?.[1] ?? '  ';
  const body = css.trim() ? `\n${fmtCss(css, `${indent}  `)}\n${indent}` : '';
  if (m) {
    if (!body) return d.pre.slice(0, m.at).replace(/[ \t]*$/, '') + d.pre.slice(m.at + m.len).replace(/^\r?\n/, '');
    return d.pre.slice(0, m.open) + body + d.pre.slice(m.open + m.text.length);
  }
  if (!body) return d.pre;
  const tag = `<style ${MANAGED}>${body}</style>`;
  const i = d.pre.search(/<\/head\s*>/i);
  return i >= 0 ? `${d.pre.slice(0, i).replace(/[ \t]*$/, '')}${indent}${tag}\n${d.pre.slice(i)}` : d.pre.replace(/<body\b/i, `${tag}\n$&`);
}

export function parseCss(text) {
  const rules = [];
  let i = 0, media = null;
  const n = text.length;
  const skip = () => { for (;;) { while (i < n && /\s/.test(text[i])) i++; if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; } else break; } };
  const until = (chars) => { let q = null, p = 0; while (i < n) { const c = text[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '(') p++; else if (c === ')') p--; else if (!p && chars.includes(c)) return; else if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 1; } i++; } };
  while (i < n) {
    skip();
    if (i >= n) break;
    if (text[i] === '}') { media = null; i++; continue; }
    const s = i;
    until('{;');
    if (i >= n) break;
    const head = text.slice(s, i).trim();
    if (text[i] === ';') { i++; continue; }
    if (/^@(media|supports|container|layer)\b/i.test(head)) { media = head; i++; continue; }
    if (/^@/.test(head) && !/^@(font-face|page)/i.test(head)) { let depth = 0; for (; i < n; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && !--depth) { i++; break; } } continue; }
    const open = i;
    i++;
    const decls = [];
    for (;;) {
      skip();
      if (i >= n || text[i] === '}') break;
      const ds = i;
      until(';}');
      const raw = text.slice(ds, i), colon = raw.indexOf(':');
      if (colon > 0) {
        const name = raw.slice(0, colon).trim(), vs = ds + colon + 1 + (raw.slice(colon + 1).length - raw.slice(colon + 1).trimStart().length), ve = ds + raw.trimEnd().length;
        decls.push({ name: name.toLowerCase(), value: text.slice(vs, ve).replace(/\s*!important$/i, ''), important: /!important\s*$/i.test(text.slice(vs, ve)), start: ds, end: text[i] === ';' ? i + 1 : i, vs, ve });
      }
      if (text[i] === ';') i++;
    }
    rules.push({ selector: head, start: s, open, close: i, media, decls });
    i++;
  }
  return rules;
}

export function setDecl(text, rule, name, value) {
  const d = rule.decls.filter((x) => x.name === name).pop();
  if (d && value) return text.slice(0, d.vs) + value + (d.important ? ' !important' : '') + text.slice(d.ve);
  if (d) { let s = d.start; while (s > rule.open + 1 && /[ \t]/.test(text[s - 1])) s--; let e = d.end; if (text[e] === '\n' && (text[s - 1] === '\n')) e++; return text.slice(0, s) + text.slice(e); }
  if (!value) return text;
  const inner = text.slice(rule.open + 1, rule.close), multi = inner.includes('\n');
  const ind = /\n([ \t]+)\S/.exec(inner)?.[1] ?? '  ';
  if (multi) {
    const before = text.slice(0, rule.close).replace(/[ \t]*$/, ''), semi = /[;{]\s*$/.test(before) ? '' : ';';
    const closeInd = /\n([ \t]*)$/.exec(text.slice(0, rule.close))?.[1] ?? '';
    return `${before.replace(/\s*$/, '')}${semi}\n${ind}${name}: ${value};\n${closeInd}${text.slice(rule.close)}`;
  }
  const t = inner.trim();
  return `${text.slice(0, rule.open + 1)} ${t}${t && !t.endsWith(';') ? ';' : ''}${t ? ' ' : ''}${name}: ${value}; ${text.slice(rule.close)}`;
}

export function decode(html) {
  const t = document.createElement('textarea');
  t.innerHTML = html;
  return t.value;
}
