'use strict';
const U = require('./util');
const { fsp, path } = U;
const crypto = require('crypto');
const ebook = () => require('./ebook');
const office = () => require('./office');

// ───────── charsets ─────────
const KOREAN = new Set(['euc-kr', 'ks_c_5601-1987', 'ks_c_5601-1989', 'ksc5601', 'ksc_5601', 'korean', 'windows-949', 'iso-ir-149', 'csksc56011987', 'cseuckr', 'cp949', 'uhc', 'x-windows-949', 'ms949']);
const td = (label, u8) => new TextDecoder(label).decode(u8);
// ISO-2022-KR (RFC 1557): ESC $ ) C designates KS X 1001 as G1, SO shifts to it (pairs of 0x21..0x7E are EUC-KR
// pairs without the high bit), SI or a line end shifts back to ASCII.
function iso2022kr(bytes) {
  const out = [];
  let so = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x1b && bytes[i + 1] === 0x24 && bytes[i + 2] === 0x29 && bytes[i + 3] === 0x43) { i += 3; continue; }
    if (b === 0x0e) { so = true; continue; }
    if (b === 0x0f || b === 0x0a || b === 0x0d) { so = false; if (b === 0x0f) continue; }
    if (so && b >= 0x21 && b <= 0x7e && bytes[i + 1] >= 0x21 && bytes[i + 1] <= 0x7e) { out.push(b | 0x80, bytes[++i] | 0x80); continue; }
    out.push(b);
  }
  return td('euc-kr', Uint8Array.from(out));
}
const validUtf8 = (u8) => { try { new TextDecoder('utf-8', { fatal: true }).decode(u8); return true; } catch (_) { return false; } };
function looksKorean(u8) {
  let pairs = 0, high = 0;
  for (let i = 0; i < u8.length; i++) {
    if (u8[i] < 0x80) continue;
    high++;
    if (u8[i] >= 0xb0 && u8[i] <= 0xc8 && u8[i + 1] >= 0xa1 && u8[i + 1] <= 0xfe) { pairs++; high++; i++; }
  }
  return high > 0 && (pairs * 2) / high > 0.5;
}
function decode(u8, label) {
  const l = String(label || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (l === 'iso-2022-kr' || l === 'csiso2022kr') return iso2022kr(u8);
  if (l) { try { return td(KOREAN.has(l) ? 'euc-kr' : l, u8); } catch (_) {} }
  if (validUtf8(u8)) return td('utf-8', u8);
  const s = Buffer.from(u8).toString('latin1');
  if (s.includes('\x1b$)C')) return iso2022kr(u8);
  return td(looksKorean(u8) ? 'euc-kr' : 'windows-1252', u8);
}
// Raw 8-bit header text: UTF-8 when valid, else CP949 (older Korean mail programs).
const raw8 = (s) => (/[\x80-\xff]/.test(s) ? (validUtf8(Buffer.from(s, 'latin1')) ? td('utf-8', Buffer.from(s, 'latin1')) : td('euc-kr', Buffer.from(s, 'latin1'))) : s);
const CODEPAGE = { 65001: 'utf-8', 20127: 'us-ascii', 28591: 'iso-8859-1', 949: 'euc-kr', 51949: 'euc-kr', 932: 'shift_jis', 936: 'gbk', 950: 'big5', 54936: 'gb18030', 50220: 'iso-2022-jp', 51932: 'euc-jp', 20866: 'koi8-r', 50225: 'iso-2022-kr' };
const codepage = (cp) => CODEPAGE[cp] || (cp >= 1250 && cp <= 1258 ? `windows-${cp}` : cp >= 28592 && cp <= 28606 ? `iso-8859-${cp - 28590}` : null);

// ───────── headers ─────────
function splitHead(buf) {
  const a = buf.indexOf('\r\n\r\n'), b = buf.indexOf('\n\n');
  if (a < 0 && b < 0) return { head: buf.toString('latin1'), body: Buffer.alloc(0) };
  const [at, len] = a >= 0 && (b < 0 || a < b) ? [a, 4] : [b, 2];
  return { head: buf.toString('latin1', 0, at), body: buf.subarray(at + len) };
}
function headers(head) {
  const out = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length) { out[out.length - 1].value += line; continue; }
    const i = line.indexOf(':');
    if (i > 0) out.push({ name: line.slice(0, i).trim(), value: line.slice(i + 1).replace(/^[ \t]+/, '') });
  }
  return out;
}
const hget = (hs, name) => hs.find((h) => h.name.toLowerCase() === name)?.value;
function qBytes(s, underscore) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '=' && /^[0-9a-f]{2}$/i.test(s.slice(i + 1, i + 3))) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; } else if (c === '_' && underscore) out.push(32); else out.push(c.charCodeAt(0) & 255);
  }
  return out;
}
// RFC 2047 encoded words (adjacent words of one charset decoded together) plus raw 8-bit text.
function words(raw) {
  const s = String(raw ?? ''), parts = [];
  let pos = 0;
  for (const m of s.matchAll(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g)) { parts.push({ plain: s.slice(pos, m.index) }); parts.push({ cs: m[1].replace(/\*.*$/, ''), b: m[2].toUpperCase() === 'B', text: m[3] }); pos = m.index + m[0].length; }
  parts.push({ plain: s.slice(pos) });
  let res = '', pend = null;
  const flush = () => { if (pend) { res += decode(Uint8Array.from(pend.bytes), pend.cs); pend = null; } };
  parts.forEach((p, i) => {
    if (p.plain != null) {
      if (!p.plain) return;
      if (/^[ \t\r\n]*$/.test(p.plain) && parts[i - 1]?.cs && parts[i + 1]?.cs) return;
      flush();
      res += raw8(p.plain);
      return;
    }
    const bytes = p.b ? [...Buffer.from(p.text, 'base64')] : qBytes(p.text, true);
    if (pend && pend.cs.toLowerCase() === p.cs.toLowerCase()) pend.bytes.push(...bytes); else { flush(); pend = { cs: p.cs, bytes }; }
  });
  flush();
  return res.replace(/\r?\n[ \t]*/g, ' ');
}
// A structured header value with parameters (RFC 2045, RFC 2231 continuations and charsets).
function params(raw) {
  const s = String(raw ?? '');
  const toks = [];
  let cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && i + 1 < s.length) cur += s[++i]; else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === ';') { toks.push(cur); cur = ''; continue; }
    cur += c;
  }
  toks.push(cur);
  const value = (toks.shift() || '').trim(), raw2231 = {}, plain = {};
  for (const t of toks) {
    const i = t.indexOf('=');
    if (i < 0) continue;
    const name = t.slice(0, i).trim().toLowerCase(), v = t.slice(i + 1).trim();
    const m = /^([^*]+)\*(?:(\d+)\*?|)$/.exec(name), star = name.endsWith('*');
    if (m) (raw2231[m[1]] ||= []).push({ n: m[2] == null ? 0 : Number(m[2]), v, enc: star });
    else if (!(name in plain)) plain[name] = v;
  }
  const out = {};
  for (const [k, v] of Object.entries(plain)) out[k] = words(v);
  for (const [k, segs] of Object.entries(raw2231)) {
    segs.sort((a, b) => a.n - b.n);
    let charset = '';
    const bytes = [];
    segs.forEach((g, i) => {
      let v = g.v;
      if (g.enc && i === 0) { const m = /^([^']*)'[^']*'(.*)$/.exec(v); if (m) { charset = m[1]; v = m[2]; } }
      if (g.enc) bytes.push(...qBytes(v.replace(/%/g, '='), false)); else bytes.push(...Buffer.from(v, 'latin1'));
    });
    out[k] = segs.some((g) => g.enc) ? decode(Uint8Array.from(bytes), charset || 'utf-8') : words(Buffer.from(bytes).toString('latin1'));
  }
  return { value, params: out };
}
function addresses(raw) {
  const s = String(raw ?? ''), out = [];
  let text = '', addr = null, comment = '';
  const push = () => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (addr != null) out.push({ name: words(t), addr: addr.trim() });
    else if (t) out.push({ name: words(comment.trim()), addr: t });
    text = ''; addr = null; comment = '';
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { let v = ''; for (i++; i < s.length && s[i] !== '"'; i++) v += s[i] === '\\' ? s[++i] ?? '' : s[i]; text += v; }
    else if (c === '(') { let d = 1, v = ''; for (i++; i < s.length && d; i++) { if (s[i] === '\\') { v += s[++i] ?? ''; continue; } if (s[i] === '(') d++; else if (s[i] === ')' && !--d) break; v += s[i]; } comment += v; }
    else if (c === '<') { const e = s.indexOf('>', i); addr = s.slice(i + 1, e < 0 ? s.length : e); i = e < 0 ? s.length : e; }
    else if (c === ',') push();
    else if (c === ':' && addr == null) text = '';
    else if (c === ';') push();
    else text += c;
  }
  push();
  return out.filter((a) => a.addr || a.name);
}
const mailbox = (a) => (a.name && a.name.trim() ? `${a.name.trim()} <${a.addr}>` : a.addr);
const ZONES = { UT: 0, UTC: 0, GMT: 0, Z: 0, EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// "yyyy-MM-dd HH:mm:ss +hh:mm" in the header's own offset.
function mailDate(raw) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Za-z]{1,5})?/.exec(String(raw || ''));
  const mon = m && MONTHS.indexOf(m[2].toLowerCase());
  if (!m || mon < 0) return String(raw || '').trim();
  let year = Number(m[3]);
  if (m[3].length <= 2) year += year < 50 ? 2000 : 1900;
  let off = 0;
  if (/^[+-]\d{4}$/.test(m[7] || '')) off = (m[7][0] === '-' ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3)));
  else if (m[7]) off = (ZONES[m[7].toUpperCase()] || 0) * 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${year}-${p(mon + 1)}-${p(m[1])} ${p(m[4])}:${m[5]}:${p(m[6] || 0)} ${off < 0 ? '-' : '+'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

// ───────── MIME parts ─────────
function splitMultipart(body, boundary) {
  const d = Buffer.from(`--${boundary}`, 'latin1'), parts = [];
  let pos = 0, start = -1;
  for (;;) {
    const i = body.indexOf(d, pos);
    if (i < 0) break;
    const after = i + d.length, nx = body[after];
    if ((i > 0 && body[i - 1] !== 0x0a) || !(after >= body.length || nx === 0x2d || nx === 0x0d || nx === 0x0a || nx === 0x20 || nx === 0x09)) { pos = i + 1; continue; }
    if (start >= 0) { let e = i; if (body[e - 1] === 0x0a) e--; if (body[e - 1] === 0x0d) e--; parts.push(body.subarray(start, Math.max(start, e))); }
    if (nx === 0x2d && body[after + 1] === 0x2d) return parts;
    const nl = body.indexOf(0x0a, after);
    if (nl < 0) return parts;
    start = pos = nl + 1;
  }
  if (start >= 0) parts.push(body.subarray(start));
  return parts;
}
function parsePart(buf, depth = 0, counter = { n: 0 }, digest = false) {
  if (++counter.n > 20000) throw new Error('The message has too many parts.');
  const { head, body } = splitHead(buf);
  const hs = headers(head);
  const ct = params(hget(hs, 'content-type') || (digest ? 'message/rfc822' : 'text/plain'));
  const cd = params(hget(hs, 'content-disposition') || '');
  const part = { hs, type: (ct.value || 'text/plain').toLowerCase(), ct: ct.params, disp: cd.value.toLowerCase(), dp: cd.params, cid: String(hget(hs, 'content-id') || '').trim().replace(/^<|>$/g, ''), body, kids: [] };
  part.filename = cd.params.filename || ct.params.name || '';
  if (part.type.startsWith('multipart/') && ct.params.boundary && depth < 16) part.kids = splitMultipart(body, ct.params.boundary).map((c) => parsePart(c, depth + 1, counter, part.type === 'multipart/digest'));
  return part;
}
function qp(buf) {
  const out = Buffer.alloc(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c !== 0x3d) { out[n++] = c; continue; }
    if (buf[i + 1] === 0x0d && buf[i + 2] === 0x0a) { i += 2; continue; }
    if (buf[i + 1] === 0x0a) { i += 1; continue; }
    const h = buf.toString('latin1', i + 1, i + 3);
    if (/^[0-9a-f]{2}$/i.test(h)) { out[n++] = parseInt(h, 16); i += 2; } else out[n++] = c;
  }
  return out.subarray(0, n);
}
function content(part) {
  const cte = String(hget(part.hs, 'content-transfer-encoding') || '').trim().toLowerCase();
  if (cte === 'base64') return Buffer.from(part.body.toString('latin1').replace(/[^A-Za-z0-9+/]/g, ''), 'base64');
  if (cte === 'quoted-printable') return qp(part.body);
  return part.body;
}
const textOf = (part) => decode(content(part), part.ct.charset).replace(/^\ufeff/, '');
const leaves = (p, out = []) => { if (p.type.startsWith('multipart/') && p.kids.length) p.kids.forEach((k) => leaves(k, out)); else out.push(p); return out; };
// MimeKit's body rules: alternative → last match first, related → only its root, others → depth-first.
function findBody(p, kind) {
  if (p.type.startsWith('multipart/')) {
    if (p.type === 'multipart/alternative') { for (let i = p.kids.length - 1; i >= 0; i--) { const r = findBody(p.kids[i], kind); if (r) return r; } return null; }
    if (p.type === 'multipart/related') { const start = String(p.ct.start || '').replace(/^<|>$/g, '').toLowerCase(); const root = (start && p.kids.find((k) => k.cid.toLowerCase() === start)) || p.kids[0]; return root ? findBody(root, kind) : null; }
    for (const k of p.kids) { const r = findBody(k, kind); if (r) return r; }
    return null;
  }
  return p.type === `text/${kind}` && p.disp !== 'attachment' ? p : null;
}
const EXT = { 'application/pdf': '.pdf', 'application/zip': '.zip', 'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx', 'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx', 'application/json': '.json', 'application/xml': '.xml', 'text/plain': '.txt', 'text/html': '.html', 'text/csv': '.csv', 'text/calendar': '.ics', 'text/vcard': '.vcf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp', 'image/svg+xml': '.svg', 'image/tiff': '.tif', 'audio/mpeg': '.mp3', 'video/mp4': '.mp4', 'message/rfc822': '.eml' };
function safeName(name) {
  let n = String(name || '').replace(/\\/g, '/');
  n = n.slice(n.lastIndexOf('/') + 1).replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, '_').replace(/^[ .]+|[ .]+$/g, '') || 'attachment';
  if (n.length > 150) { n = n.slice(0, 150); if (/[\ud800-\udbff]$/.test(n)) n = n.slice(0, -1); }
  return n;
}
function readMessage(buf) {
  const root = parsePart(buf);
  const hs = root.hs, all = leaves(root);
  const cids = new Map();
  for (const p of all) if (p.cid && !cids.has(p.cid.toLowerCase())) cids.set(p.cid.toLowerCase(), p);
  const attachments = [], used = new Set();
  for (const p of all) {
    let name;
    if (p.type === 'message/rfc822') { const inner = content(p); name = `${p.dp.filename || words(hget(headers(splitHead(inner).head), 'subject') || '').trim() || 'message'}.eml`; attachments.push({ name, data: inner, type: p.type }); }
    else if (p.disp === 'attachment' || (p.filename && !p.cid)) attachments.push({ name: p.filename || `attachment${EXT[p.type] || '.bin'}`, data: content(p), type: p.type });
  }
  for (const a of attachments) {
    const base = safeName(a.name), ext = path.extname(base), stem = base.slice(0, base.length - ext.length);
    let n = base;
    for (let k = 2; used.has(n.toLowerCase()); k++) n = `${stem} (${k})${ext}`;
    used.add(n.toLowerCase());
    a.name = n;
  }
  const html = findBody(root, 'html'), text = findBody(root, 'plain');
  return {
    root, hs, cids, attachments,
    subject: words(hget(hs, 'subject') || '').trim(),
    from: addresses(hget(hs, 'from')), to: addresses(hget(hs, 'to')), cc: addresses(hget(hs, 'cc')),
    date: hget(hs, 'date') ? mailDate(hget(hs, 'date')) : '',
    html: html ? textOf(html) : null, text: text ? textOf(text) : null,
  };
}

// ───────── sanitising and pages ─────────
const REMOVE = new Set('script noscript iframe object embed applet frame frameset portal input button textarea select option meta link base svg math template video audio source track noembed noframes xmp plaintext'.split(' '));
const ALLOWED = new Set('class id title lang dir style align valign width height colspan rowspan cellpadding cellspacing border bgcolor color face size nowrap start type span scope headers abbr summary hspace vspace clear noshade frame rules open'.split(' '));
const RASTER = /^data:image\/(?!svg)[a-z0-9.+-]+;base64,/i;
function okHref(h) { if (h.startsWith('#')) return true; try { return ['http:', 'https:', 'mailto:'].includes(new URL(h).protocol); } catch (_) { return false; } }
function filterAttrs(tag, attrs) {
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (ALLOWED.has(k) || (k === 'alt' && tag === 'img') || (k === 'href' && tag === 'a' && okHref(v.trim())) || (k === 'src' && tag === 'img' && RASTER.test(v.trim()))) out[k] = v;
  }
  return out;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Removes active and form content, comments and every attribute outside a small allowlist; collects the
// message's own style sheets for the page head. Pictures must already be data: URIs.
function sanitize(html, keep = {}) {
  const E = ebook();
  const src = String(html).replace(/<!--[\s\S]*?(-->|$)/g, '');
  const styles = [];
  for (const m of src.matchAll(/<style\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/style\s*>/gi)) {
    const a = filterAttrs('style', E.attrsOf(m[1]));
    styles.push(`<style${Object.entries(a).map(([k, v]) => ` ${k}="${E.escA(v)}"`).join('')}>${m[2]}</style>`);
  }
  const doc = E.parse(src.replace(/<style\b[\s\S]*?<\/style\s*>/gi, ''));
  const clean = (n) => {
    n.kids = n.kids.flatMap((k) => {
      if (k.text != null) return [k];
      if (REMOVE.has(k.tag)) return [];
      if (k.tag === 'form') { clean(k); return k.kids; }
      k.attrs = filterAttrs(k.tag, k.attrs);
      clean(k);
      return [k];
    });
  };
  clean(doc.root);
  const bodyAttrs = filterAttrs('div', doc.root.attrs || {});
  const lang = keep.root ? (/^[\w-]+$/.test(doc.lang) ? doc.lang : '') : '';
  return { body: E.toHtml(doc.root), styles, bodyAttrs, lang, title: doc.title };
}
const attrs = (a) => Object.entries(a).map(([k, v]) => ` ${k}="${ebook().escA(v)}"`).join('');
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
function rows(msg) {
  return [['From', msg.from.map(mailbox).join(', ')], ['To', msg.to.map(mailbox).join(', ')], ['Cc', msg.cc.map(mailbox).join(', ')], ['Date', msg.date], ['Subject', msg.subject], ['Attachments', msg.attachments.map((a) => a.name).join(', ')]].filter(([, v]) => String(v || '').trim());
}
function inlineCids(html, cids) {
  return html.replace(/cid:([^"'\s)>]+)/gi, (m, id) => {
    let k = id;
    try { k = decodeURIComponent(id); } catch (_) {}
    const p = cids.get(k.toLowerCase());
    if (!p) return m;
    const data = content(p);
    let type = p.type;
    if (!type.startsWith('image/')) { const s = ebook().sniff(data); if (s) type = `image/${s}`; }
    return `data:${type};base64,${data.toString('base64')}`;
  });
}
function mailPage(msg) {
  const s = msg.html != null ? sanitize(inlineCids(msg.html, msg.cids)) : null;
  const body = s ? (Object.keys(s.bodyAttrs).length ? `<div${attrs(s.bodyAttrs)}>${s.body}</div>` : s.body) : `<pre class="lime-mail-text">${esc(msg.text || '')}</pre>`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(msg.subject)}</title>
<style>
.lime-mail-headers { border-collapse: collapse; margin: 0 0 12px 0; font-family: sans-serif; font-size: 14px; }
.lime-mail-headers th { text-align: left; vertical-align: top; padding: 2px 16px 2px 0; color: #555; font-weight: 600; }
.lime-mail-headers td { padding: 2px 0; }
.lime-mail-text { white-space: pre-wrap; font-family: inherit; }
</style>
${s ? s.styles.join('\n') : ''}
</head>
<body>
<table class="lime-mail-headers">
${rows(msg).map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('\n')}
</table>
<hr>
${body}
</body>
</html>
`;
}
function mailText(msg) {
  const body = msg.text ?? (msg.html != null ? office().htmlToText(sanitize(msg.html).body) : '');
  return `\ufeff${rows(msg).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n${body.replace(/\r\n|\r|\n/g, '\r\n').trimEnd()}\r\n`;
}

// ───────── Outlook .msg → MIME ─────────
const b64lines = (b) => Buffer.from(b).toString('base64').replace(/.{76}(?!$)/g, '$&\r\n');
function encWords(s) {
  if (!/[^\x20-\x7e]/.test(s)) return s;
  const out = [];
  let cur = '';
  for (const ch of s) { if (Buffer.byteLength(cur + ch) > 45) { out.push(cur); cur = ''; } cur += ch; }
  if (cur) out.push(cur);
  return out.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join(' ');
}
const encName = (n) => (/[^\x20-\x7e]/.test(n) ? encWords(n) : /[()<>@,;:\\".[\]]/.test(n) ? `"${n.replace(/["\\]/g, '\\$&')}"` : n);
const fmtAddr = (a) => (a.name ? `${encName(a.name)} <${a.addr}>` : a.addr.includes('@') ? a.addr : `<${a.addr}>`);
const p2231 = (k, v) => (/^[\x20-\x7e]*$/.test(v) && !/["\\]/.test(v) ? `${k}="${v}"` : `${k}*=UTF-8''${encodeURIComponent(v).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`);
function mimeLeaf(type, data, extra = []) { return Buffer.concat([Buffer.from([`Content-Type: ${type}`, ...extra, 'Content-Transfer-Encoding: base64', '', b64lines(data), ''].join('\r\n'))]); }
function multipart(sub, parts, extra = '') {
  const b = `=_Lime_${crypto.randomBytes(9).toString('hex')}`;
  return Buffer.concat([Buffer.from(`Content-Type: multipart/${sub}; boundary="${b}"${extra}\r\n\r\n`), ...parts.flatMap((p) => [Buffer.from(`--${b}\r\n`), p, Buffer.from('\r\n')]), Buffer.from(`--${b}--\r\n`)]);
}
// Rebuilds a message as MimeKit's BodyBuilder would: mixed(alternative(text, related(html, inline pictures)), files).
function buildMime(m) {
  const head = [];
  if (m.from) head.push(`From: ${fmtAddr(m.from)}`);
  for (const [k, list] of [['To', m.to], ['Cc', m.cc], ['Bcc', m.bcc]]) if (list?.length) head.push(`${k}: ${list.map(fmtAddr).join(', ')}`);
  if (m.date) head.push(`Date: ${m.date.toUTCString().replace('GMT', '+0000')}`);
  head.push(`Subject: ${encWords(String(m.subject || '').replace(/[\r\n]+/g, ' '))}`);
  if (m.messageId) head.push(`Message-ID: <${m.messageId}>`);
  head.push('MIME-Version: 1.0');
  const textPart = m.text != null || m.html == null ? mimeLeaf('text/plain; charset=utf-8', Buffer.from(m.text || '')) : null;
  let htmlPart = m.html != null ? mimeLeaf('text/html; charset=utf-8', Buffer.from(m.html)) : null;
  if (htmlPart && m.related?.length) htmlPart = multipart('related', [htmlPart, ...m.related.map((r) => mimeLeaf(`${r.type}; ${p2231('name', r.name)}`, r.data, [`Content-ID: <${r.cid}>`, `Content-Disposition: inline; ${p2231('filename', r.name)}`]))], '; type="text/html"');
  let body = textPart && htmlPart ? multipart('alternative', [textPart, htmlPart]) : htmlPart || textPart;
  if (m.attachments?.length) body = multipart('mixed', [body, ...m.attachments.map((a) => (a.message ? Buffer.concat([Buffer.from(`Content-Type: message/rfc822\r\nContent-Disposition: attachment; ${p2231('filename', a.name)}\r\n\r\n`), a.message]) : mimeLeaf(`${a.type}; ${p2231('name', a.name)}`, a.data, [`Content-Disposition: attachment; ${p2231('filename', a.name)}`])))]);
  return Buffer.concat([Buffer.from(`${head.join('\r\n')}\r\n`), body]);
}
// \fromhtml1 RTF (HTML encapsulated by Outlook) back to the original HTML.
function deEncapsulate(rtf) {
  let out = '', i = 0, supp = false, cp = 'windows-1252', uc = 1, skip = 0, bytes = [];
  const stack = [], flushBytes = () => { if (bytes.length) { out += decode(Uint8Array.from(bytes), cp); bytes = []; } };
  let g = { html: false, dest: false };
  const emit = (t) => { if (skip) { skip--; return; } if (g.html || (!supp && !g.dest)) { flushBytes(); out += t; } };
  while (i < rtf.length) {
    const c = rtf[i];
    if (c === '{') { stack.push(g); g = { ...g }; i++; if (rtf.startsWith('\\*\\htmltag', i)) { g.html = true; i += 2; } else if (rtf.startsWith('\\*', i)) g.dest = true; continue; }
    if (c === '}') { flushBytes(); g = stack.pop() || { html: false, dest: false }; i++; continue; }
    if (c === '\\') {
      const m = /^\\([a-z]+)(-?\d+)? ?|^\\'([0-9a-f]{2})|^\\(.)/i.exec(rtf.slice(i, i + 40));
      if (!m) { i++; continue; }
      i += m[0].length;
      if (m[3]) { if (skip) { skip--; continue; } if (g.html || (!supp && !g.dest)) bytes.push(parseInt(m[3], 16)); continue; }
      if (m[4]) { if (m[4] === '\r' || m[4] === '\n') continue; emit(m[4] === '~' ? '\u00a0' : '{}\\'.includes(m[4]) ? m[4] : ''); continue; }
      const w = m[1], n = m[2];
      if (w === 'htmlrtf') supp = n !== '0';
      else if (w === 'ansicpg') cp = codepage(Number(n)) || cp;
      else if (w === 'uc') uc = Number(n) || 0;
      else if (w === 'u') { emit(String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n))); skip = uc; }
      else if (w === 'par' || w === 'line') emit('\r\n');
      else if (w === 'tab') emit('\t');
      else if (['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict'].includes(w)) g.dest = true;
      continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (skip) { skip--; i++; continue; }
    if (g.html || (!supp && !g.dest)) { flushBytes(); out += c; }
    i++;
  }
  flushBytes();
  return out;
}
function msgToMime(buf) {
  const MsgReader = require('@kenjiuno/msgreader').default;
  let r, f;
  try { r = new MsgReader(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); f = r.getFileData(); } catch (e) { throw new Error(`Not an Outlook message: ${e.message}`); }
  if (!f || f.error || f.dataType !== 'msg') throw new Error(`Not an Outlook message: ${f?.error || 'it isn’t an OLE compound file'}`);
  const box = (name, addr) => { name = String(name || '').replace(/[\r\n]+/g, ' ').trim(); addr = String(addr || '').replace(/[\r\n<>]+/g, '').trim(); if (!name && !addr) return null; if (name.toLowerCase() === addr.toLowerCase()) name = ''; return { name, addr: addr || name }; };
  const recips = { to: [], cc: [], bcc: [] };
  for (const x of f.recipients || []) { const a = box(x.name, x.smtpAddress || x.email); if (a) recips[x.recipType === 'cc' ? 'cc' : x.recipType === 'bcc' ? 'bcc' : 'to'].push(a); }
  let html = null;
  if (f.html?.length) html = decode(f.html, codepage(f.internetCodepage) || 'utf-8');
  else if (f.bodyHtml) html = f.bodyHtml;
  if (!html && f.compressedRtf?.length) {
    try {
      const rtf = Buffer.from(require('@kenjiuno/decompressrtf').decompressRTF([...f.compressedRtf])).toString('latin1');
      html = /\\fromhtml1/.test(rtf) ? deEncapsulate(rtf) : office().rtfToHtml(rtf) || null;
    } catch (_) {}
  }
  const related = [], attachments = [];
  for (const a of f.attachments || []) {
    if (a.innerMsgContent) {
      try { const inner = r.getAttachment(a); attachments.push({ name: a.innerMsgContentFields?.subject || a.name || 'message', message: msgToMime(Buffer.from(inner.content)) }); } catch (_) {}
      continue;
    }
    if (a.dataId == null) continue;
    const data = Buffer.from(r.getAttachment(a).content || []);
    const name = a.fileName || a.fileNameShort || 'attachment';
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(a.attachMimeTag || '') ? a.attachMimeTag.toLowerCase() : Object.entries(EXT).find(([, e]) => e === path.extname(name).toLowerCase())?.[0] || 'application/octet-stream';
    if (a.pidContentId && html && html.toLowerCase().includes(`cid:${a.pidContentId.toLowerCase()}`)) related.push({ name, type, data, cid: a.pidContentId });
    else attachments.push({ name, type, data });
  }
  const when = f.clientSubmitTime || f.messageDeliveryTime;
  const id = String(f.messageId || /^Message-ID:\s*(.+)$/im.exec(f.headers || '')?.[1] || '').trim().replace(/^<|>$/g, '');
  return buildMime({ from: box(f.senderName, f.senderSmtpAddress || f.senderEmail), ...recips, subject: f.subject || '', date: when && !Number.isNaN(Date.parse(when)) ? new Date(when) : null, messageId: id, text: f.body || null, html, related, attachments });
}

// ───────── MHTML → one self-contained page ─────────
const FONT_TYPES = /^(image\/|font\/|application\/(x-)?font-|application\/vnd\.ms-fontobject)/;
// CSS tokens: comments and strings are skipped; url() and @import references go through `fn`.
function cssRefs(css, fn) {
  let out = '', i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); const j = e < 0 ? css.length : e + 2; out += css.slice(i, j); i = j; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < css.length && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1; out += css.slice(i, j + 1); i = j + 1; continue; }
    if (/^url\(/i.test(css.slice(i, i + 4))) {
      let j = i + 4;
      while (/\s/.test(css[j] || '')) j++;
      let ref = '';
      if (css[j] === '"' || css[j] === "'") { const q = css[j]; j++; while (j < css.length && css[j] !== q) { if (css[j] === '\\') j++; ref += css[j++] ?? ''; } j++; } else { while (j < css.length && css[j] !== ')' && !/\s/.test(css[j])) ref += css[j++]; }
      while (j < css.length && css[j] !== ')') j++;
      const r = fn(ref.trim(), 'url');
      out += r == null ? 'url()' : `url("${r.replace(/["\\\n]/g, (x) => `\\${x === '\n' ? 'a ' : x}`)}")`;
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function mhtmlPage(buf) {
  if (buf.length > 256 * 1048576) throw new Error('This MHTML file is too large.');
  const E = ebook(), root = parsePart(buf), top = root.hs, all = leaves(root);
  const snapshot = String(hget(top, 'snapshot-content-location') || '').trim();
  const loc = (p) => String(hget(p.hs, 'content-location') || '').trim();
  const abs = (ref, base) => { try { const u = new URL(ref, base || undefined); u.hash = ''; return u.href; } catch (_) { return null; } };
  const byCid = new Map(), byUrl = new Map(), byRaw = new Map(), byName = new Map();
  const index = (p, base) => {
    if (p.type.startsWith('multipart/')) { const b = String(hget(p.hs, 'content-base') || '').trim() || loc(p) || base; p.kids.forEach((k) => index(k, b)); return; }
    if (p.cid) { byCid.set(p.cid.toLowerCase(), p); try { byCid.set(decodeURIComponent(p.cid).toLowerCase(), p); } catch (_) {} }
    const l = loc(p);
    if (!l) return;
    const u = abs(l, String(hget(p.hs, 'content-base') || '').trim() || base || snapshot || undefined);
    if (u && !byUrl.has(u)) byUrl.set(u, p);
    const raw = l.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!byRaw.has(raw)) byRaw.set(raw, p);
    const name = raw.split(/[/?#]/).filter(Boolean).pop()?.toLowerCase();
    if (name) byName.set(name, byName.has(name) ? null : p);
  };
  index(root, snapshot);
  let rootPart = null;
  const pick = (p) => {
    if (p.type === 'text/html' || p.type === 'application/xhtml+xml') return p;
    if (p.type === 'multipart/related') {
      const start = String(p.ct.start || '').replace(/^<|>$/g, '').toLowerCase();
      let r = (start && p.kids.find((k) => k.cid.toLowerCase() === start)) || p.kids[0];
      if (r?.type === 'multipart/alternative') r = [...r.kids].reverse().find((k) => k.type === 'text/html');
      if (r && !/html/.test(r.type) && /html/.test(p.ct.type || '')) r = p.kids.find((k) => k.type === 'text/html');
      return r || null;
    }
    if (p.type.startsWith('multipart/')) { for (const k of p.kids) { const r = pick(k); if (r) return r; } }
    return null;
  };
  rootPart = pick(root);
  if (!rootPart) throw new Error('This MHTML file contains no web page.');
  let budget = 256 * 1048576, notes = 0;
  const data = (p) => { const d = content(p); if (d.length > 64 * 1048576 || d.length > budget) { notes++; return null; } budget -= d.length; return d; };
  const find = (ref, base) => {
    if (!ref || /^data:/i.test(ref)) return null;
    if (/^cid:/i.test(ref)) { let k = ref.slice(4); try { k = decodeURIComponent(k); } catch (_) {} return byCid.get(k.toLowerCase()) || null; }
    const u = abs(ref, base);
    return (u && byUrl.get(u)) || byRaw.get(ref.replace(/\\/g, '/').replace(/^\.\//, '')) || byName.get(ref.split(/[/?#]/).filter(Boolean).pop()?.toLowerCase() || '') || null;
  };
  const toData = (ref, base, filter) => { if (/^data:/i.test(ref || '')) return ref; const p = find(ref, base); if (!p || (filter && !filter.test(p.type))) return null; const d = data(p); return d && `data:${p.type.startsWith('image/') || !E.sniff(d) ? p.type : `image/${E.sniff(d)}`};base64,${d.toString('base64')}`; };
  const rootLoc = loc(rootPart) || snapshot;
  let html = decode(content(rootPart), rootPart.ct.charset || /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(content(rootPart).toString('latin1', 0, 4096))?.[1]);
  const baseHref = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  const base = (baseHref && abs(baseHref, rootLoc)) || rootLoc || undefined;
  const sheet = (css, cssBase, depth = 0, seen = new Set()) => {
    let n = 0;
    css = css.replace(/@charset\s+"[^"]*"\s*;?/gi, '');
    css = css.replace(/@import\s+(?:url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])\s*([^;]*);/gi, (m, a, b, media) => {
      const p = depth < 8 && find(a || b, cssBase), key = p && (loc(p) || p.cid);
      if (!p || seen.has(key)) return '';
      const d = data(p);
      if (!d) return '';
      const inner = sheet(decode(d, p.ct.charset), abs(loc(p), cssBase) || cssBase, depth + 1, new Set([...seen, key]));
      return media.trim() ? `@media ${media.trim()} {\n${inner}\n}` : inner;
    });
    return cssRefs(css, (ref) => (++n > 10000 ? null : toData(ref, cssBase, FONT_TYPES)));
  };
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (m, o, css, c) => `${o}${sheet(css, base)}${c}`);
  html = html.replace(/<link\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi, (m, a) => {
    const at = E.attrsOf(a), rel = String(at.rel || '').toLowerCase().split(/\s+/);
    if (!rel.includes('stylesheet') || !at.href) return '';
    const p = find(at.href, base), d = p && data(p);
    return d ? `<style${at.media ? ` media="${E.escA(at.media)}"` : ''}>${sheet(decode(d, p.ct.charset), abs(loc(p), base) || base)}</style>` : '';
  });
  html = html.replace(/<([a-z][\w-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi, (m, tag, a) => {
    if (!/\b(srcset|src|background|style)\s*=/i.test(a)) return m;
    const t = tag.toLowerCase(), at = E.attrsOf(a.replace(/\/$/, ''));
    let changed = false;
    if ((t === 'img' || t === 'source') && at.srcset) {
      const cands = at.srcset.split(',').map((x) => x.trim().split(/\s+/)).map(([u, d]) => ({ u, w: parseFloat(d) || 1 })).sort((x, y) => y.w - x.w);
      const hit = cands.map((cnd) => toData(cnd.u, base, /^image\//)).find(Boolean);
      if (hit) at.src = hit;
      delete at.srcset;
      changed = true;
    }
    if (t === 'img' && at.src && !/^data:/i.test(at.src)) { const d = toData(at.src, base, /^image\//); if (d) at.src = d; else delete at.src; changed = true; }
    if (at.background && ['body', 'table', 'td', 'th'].includes(t)) { const d = toData(at.background, base, /^image\//); if (d) at.style = `background-image:url(${d});${at.style || ''}`; delete at.background; changed = true; }
    if (at.style && /url\s*\(/i.test(at.style)) { at.style = sheet(at.style, base); changed = true; }
    return changed ? `<${t}${Object.entries(at).map(([k, v]) => ` ${k}="${E.escA(v)}"`).join('')}>` : m;
  });
  const s = sanitize(html, { root: true });
  const title = s.title || words(hget(top, 'subject') || '').trim();
  const page = `<!DOCTYPE html>\n<html${s.lang ? ` lang="${s.lang}"` : ''}>\n<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; media-src data:; base-uri 'none'; form-action 'none'">\n<title>${esc(title)}</title>\n${s.styles.join('\n')}\n</head>\n<body${attrs(s.bodyAttrs)}>\n${s.body}\n</body>\n</html>\n`;
  return { html: page, title, notes };
}

// ───────── converting ─────────
async function load(input) {
  const buf = await fsp.readFile(input);
  if (U.ext(input) === 'msg') return { eml: msgToMime(buf), msg: true };
  return { eml: buf };
}
async function convert(input, o, ctx) {
  const to = o.to, base = U.base(input), e = U.ext(input);
  ctx.progress?.(0.15, 'Reading the message');
  if (e === 'mht' || e === 'mhtml') {
    const page = mhtmlPage(await fsp.readFile(input));
    const out = ctx.out.file(input, `${base}.${to}`);
    if (to === 'html') await fsp.writeFile(out, page.html);
    else if (to === 'txt') await fsp.writeFile(out, office().htmlToText(page.html));
    else if (to === 'pdf') await office().htmlToPdf(page.html, out, ctx, { offline: true });
    else throw new Error(`Lime can’t save web archives as ${to.toUpperCase()}.`);
    return page.notes ? { path: out, note: `${page.notes} large picture${page.notes === 1 ? ' was' : 's were'} left out.` } : out;
  }
  const { eml } = await load(input);
  if (to === 'eml') { if (e === 'eml') throw new Error('This file is already EML.'); const out = ctx.out.file(input, `${base}.eml`); await fsp.writeFile(out, eml); return out; }
  const msg = readMessage(eml);
  if (to === 'attachments') {
    if (!msg.attachments.length) throw new Error('The e-mail has no attachments.');
    const dir = ctx.out.folder(input, `${base} - attachments`);
    for (const a of msg.attachments) await fsp.writeFile(path.join(dir, a.name), a.data);
    return { path: dir, note: `${msg.attachments.length} attachment${msg.attachments.length === 1 ? '' : 's'} saved` };
  }
  const out = ctx.out.file(input, `${base}.${to}`);
  ctx.progress?.(0.5, `Writing ${to.toUpperCase()}`);
  if (to === 'html') await fsp.writeFile(out, mailPage(msg));
  else if (to === 'txt') await fsp.writeFile(out, mailText(msg));
  else if (to === 'pdf') await office().htmlToPdf(mailPage(msg), out, ctx, { offline: true });
  else throw new Error(`Lime can’t save e-mail as ${to.toUpperCase()}.`);
  return out;
}

module.exports = { convert, readMessage, mailPage, mailText, sanitize, mhtmlPage, msgToMime, buildMime, decode, iso2022kr, words, params, addresses, mailDate, deEncapsulate };
