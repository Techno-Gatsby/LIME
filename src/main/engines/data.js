'use strict';
// Structured data: JSON (with comments), JSON Lines, YAML, TOML, XML and CSV read into one tree and written from it,
// plus vCard ↔ CSV. Keys keep their order (Maps), integers stay exact (BigInt), floats stay floats (3.0), TOML dates
// keep their spelling. Logic adapted from Filee by KnifeLemon (MIT).

const U = require('./util');
const { fs, fsp } = U;
const { decodeText, strictUtf8, encodingName, iconv } = require('./textcodec');

const MAX = 256;
class DataDate { constructor(text) { this.text = text; } toString() { return this.text; } }
const isScalar = (v) => !(v instanceof Map) && !Array.isArray(v);
const deep = () => new Error('The data is nested too deeply.');
const lineCol = (text, at) => { const before = text.slice(0, at).split('\n'); return `line ${before.length}, column ${before[before.length - 1].length + 1}`; };

const number = (t) => (/^[-+]?\d+$/.test(t) ? BigInt(t) : Number(t));
function formatDouble(d) {
  if (Object.is(d, -0)) return '-0.0';
  const [m, e] = d.toExponential().split('e');
  const exp = Number(e);
  const s = exp > -5 && exp < 15 ? String(d) : `${m}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  return /[.eE]/.test(s) ? s : `${s}.0`;
}
function text(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : formatDouble(v);
  return String(v);
}
// {"users": [...]} and XML's <rows><row/>…</rows> are wrappers around the records.
function unwrapRecords(root) {
  let node = root;
  for (let i = 0; i < MAX && node instanceof Map && node.size === 1; i++) {
    const only = node.values().next().value;
    if (only instanceof Map || (Array.isArray(only) && only.some((x) => x instanceof Map))) node = only;
    else break;
  }
  return node;
}

// ───────── JSON ─────────
function readJson(src, prefix = 'Not valid JSON: ', oneLine = false) {
  const jsonc = require('jsonc-parser');
  const errors = [];
  let root;
  try { root = jsonc.parseTree(src, errors, { allowTrailingComma: true, disallowComments: false }); } catch (e) { if (e instanceof RangeError) throw deep(); throw e; }
  if (errors.length || !root) {
    const e = errors[0] || { error: 4, offset: 0 }, what = jsonc.printParseErrorCode(e.error).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    throw new Error(`${prefix}${what} at ${oneLine ? `column ${e.offset + 1}` : lineCol(src, e.offset)}.`);
  }
  const walk = (n, depth) => {
    if (depth > MAX) throw deep();
    switch (n.type) {
      case 'object': { const m = new Map(); for (const p of n.children || []) m.set(p.children[0].value, p.children[1] ? walk(p.children[1], depth + 1) : null); return m; }
      case 'array': return (n.children || []).map((c) => walk(c, depth + 1));
      case 'number': return number(src.slice(n.offset, n.offset + n.length));
      default: return n.value;
    }
  };
  return walk(root, 0);
}
function readJsonLines(src) {
  const out = [];
  src.split('\n').forEach((raw, i) => { const line = raw.trim(); if (line) out.push(readJson(line, `Line ${i + 1} is not valid JSON: `, true)); });
  return out;
}
// Floats as plain decimals with a fraction ("3.0", "1000000000000000.0"); only beyond .NET decimal range in E notation.
function jsonFloat(d) {
  const s = formatDouble(d), a = Math.abs(d);
  const m = /^(-?)(\d+)(?:\.(\d+))?E([-+]\d+)$/.exec(s);
  if (!m || a >= 7.9228162514264337593543950335e28 || (a > 0 && a < 1e-28)) return s;
  const digits = m[2] + (m[3] || ''), point = m[2].length + Number(m[4]);
  return m[1] + (point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? `${digits}${'0'.repeat(point - digits.length)}.0` : `${digits.slice(0, point)}.${digits.slice(point)}`);
}
function writeJson(v, pretty = true, depth = 0, pad = '') {
  if (depth > MAX) throw deep();
  const inner = `${pad}  `;
  const wrap = (open, close, parts) => (!parts.length ? open + close : pretty ? `${open}\n${parts.map((p) => inner + p).join(',\n')}\n${pad}${close}` : open + parts.join(',') + close);
  if (v instanceof Map) return wrap('{', '}', [...v].map(([k, x]) => `${JSON.stringify(k)}:${pretty ? ' ' : ''}${writeJson(x, pretty, depth + 1, inner)}`));
  if (Array.isArray(v)) return wrap('[', ']', v.map((x) => writeJson(x, pretty, depth + 1, inner)));
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (typeof v === 'number' && Number.isFinite(v)) return jsonFloat(v);
  return JSON.stringify(text(v));
}
const writeJsonLines = (root) => { const r = unwrapRecords(root); return (Array.isArray(r) ? r : [root]).map((x) => `${writeJson(x, false)}\n`).join(''); };

// ───────── YAML (1.2 core schema) ─────────
const YAML11 = /^(y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|[-+]?[0-9][0-9_]*(\.[0-9_]*)?|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}([Tt ].*)?|[0-9]+(:[0-5]?[0-9])+(\.[0-9_]*)?)$/;
function resolveYaml(t) {
  if (['', '~', 'null', 'Null', 'NULL'].includes(t)) return null;
  if (['true', 'True', 'TRUE'].includes(t)) return true;
  if (['false', 'False', 'FALSE'].includes(t)) return false;
  if (['.inf', '.Inf', '.INF', '+.inf', '+.Inf', '+.INF'].includes(t)) return Infinity;
  if (['-.inf', '-.Inf', '-.INF'].includes(t)) return -Infinity;
  if (['.nan', '.NaN', '.NAN'].includes(t)) return NaN;
  if (/^[-+]?[0-9]+$/.test(t)) return BigInt(t.replace(/^\+/, ''));
  if (/^0x[0-9a-fA-F]+$/.test(t)) return BigInt(t);
  if (/^0o[0-7]+$/.test(t)) return BigInt(`0o${t.slice(2)}`);
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(t)) return Number(t);
  return t;
}
function readYaml(src) {
  const YAML = require('yaml');
  const docs = YAML.parseAllDocuments(src, { schema: 'failsafe', strict: false, uniqueKeys: false, prettyErrors: true });
  const list = Array.isArray(docs) ? docs : [docs];
  for (const d of list) if (d.errors?.length) throw new Error(`Not valid YAML: ${d.errors[0].message.split('\n')[0].replace(/:$/, '.')}`);
  let count = 0;
  const value = (n, doc, depth, aliases) => {
    if (depth > MAX) throw new Error('The YAML is nested too deeply (or an alias refers to itself).');
    if (++count > 5e6) throw new Error('The YAML expands to too many values (aliases repeated too often).');
    if (!n) return null;
    if (YAML.isAlias(n)) { if (!aliases.has(n)) aliases.set(n, n.resolve(doc)); return value(aliases.get(n), doc, depth + 1, aliases); }
    if (YAML.isSeq(n)) return n.items.map((x) => value(x, doc, depth + 1, aliases));
    if (YAML.isMap(n)) {
      const m = new Map();
      const own = new Set(n.items.map((p) => (YAML.isScalar(p.key) ? String(p.key.value) : null)).filter((k) => k != null && k !== '<<'));
      for (const p of n.items) {
        if (YAML.isScalar(p.key) && p.key.value === '<<' && p.key.type === 'PLAIN' && !p.key.tag) {
          for (const from of YAML.isSeq(p.value) ? p.value.items : [p.value]) {
            const merged = value(from, doc, depth + 1, aliases);
            if (!(merged instanceof Map)) throw new Error('A YAML merge key (<<) must refer to a mapping.');
            for (const [k, v] of merged) if (!m.has(k) && !own.has(k)) m.set(k, v);
          }
          continue;
        }
        const k = YAML.isAlias(p.key) ? p.key.resolve(doc) : p.key;
        const key = !k ? '' : YAML.isScalar(k) ? String(k.value ?? '') : writeJson(value(k, doc, depth + 1, aliases)).trim();
        m.set(key, value(p.value, doc, depth + 1, aliases));
      }
      return m;
    }
    if (YAML.isScalar(n)) {
      let t = String(n.value ?? '');
      const tag = n.tag || '';
      // A clipped block scalar that ends the file without a line break has none.
      if (n.type?.startsWith('BLOCK') && n.range && /^[|>]\d?\s*(#.*)?\n/.test(src.slice(n.range[0])) && !src.slice(n.range[0], n.range[2]).endsWith('\n') && n.range[2] === src.length) t = t.replace(/\n$/, '');
      if (tag === 'tag:yaml.org,2002:str') return t;
      if (tag === 'tag:yaml.org,2002:null') return null;
      if (tag === 'tag:yaml.org,2002:bool') { const r = resolveYaml(t); if (typeof r !== 'boolean') throw new Error(`“${t}” is not a YAML boolean.`); return r; }
      if (tag === 'tag:yaml.org,2002:int' || tag === 'tag:yaml.org,2002:float') { const r = resolveYaml(t); if (typeof r !== 'bigint' && typeof r !== 'number') throw new Error(`“${t}” is not a YAML number.`); return r; }
      return n.type === 'PLAIN' && (tag === '' || tag === '?') ? resolveYaml(t) : t;
    }
    return null;
  };
  const vals = list.map((d) => value(d.contents, d, 0, new Map()));
  return vals.length === 0 ? null : vals.length === 1 ? vals[0] : vals;
}
const printable = (t) => !/[\u0000-\u0009\u000b-\u001f\u007f-\u0084\u0086-\u009f\ud800-\udfff\ufeff\ufffe\uffff]/.test(t.replace(/[\ud800-\udbff][\udc00-\udfff]/g, 'x'));
const needsQuotes = (t) => typeof resolveYaml(t) !== 'string' || YAML11.test(t) || t.trim() !== t;
function plainOk(t) {
  if (!t || t.trim() !== t || /[\r\n\u0085\u2028\u2029]/.test(t) || !printable(t)) return false;
  if (/^[#,[\]{}&*!|>'"%@`]/.test(t) || /^[-?:](\s|$)/.test(t) || /^(---|\.\.\.)/.test(t)) return false;
  return !t.includes(': ') && !t.includes(' #') && !t.endsWith(':');
}
function dq(t) {
  const esc = { '"': '\\"', '\\': '\\\\', '\0': '\\0', '\x07': '\\a', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\v': '\\v', '\f': '\\f', '\r': '\\r', '\x1b': '\\e', '\u0085': '\\N', '\u00a0': '\\_', '\u2028': '\\L', '\u2029': '\\P' };
  return `"${t.replace(/["\\\u0000-\u001f\u007f-\u009f\u00a0\u2028\u2029\ufeff\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, (c) => esc[c] || (c.charCodeAt(0) <= 0xff ? `\\x${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}` : `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`))}"`;
}
function yamlString(t, ind, block) {
  if (block && t.includes('\n') && printable(t.replace(/\n/g, ' ')) && !/ \n/.test(t) && !t.endsWith(' ')) {
    const trail = /\n*$/.exec(t)[0].length;
    const body = trail ? t.slice(0, -1) : t;
    const lines = body.split('\n').map((l) => (l ? ind + l : ''));
    return `|${t.startsWith(' ') ? '2' : ''}${trail === 0 ? '-' : trail > 1 ? '+' : ''}\n${lines.join('\n')}`;
  }
  if (needsQuotes(t) || t.includes('\n')) return dq(t);
  if (plainOk(t)) return t;
  return printable(t) && !/[\r\n\u0085\u2028\u2029]/.test(t) ? `'${t.replace(/'/g, "''")}'` : dq(t);
}
function yamlScalar(v, ind) {
  if (typeof v === 'string') return yamlString(v, ind, true);
  if (v == null) return 'null';
  if (typeof v === 'number') return Number.isNaN(v) ? '.nan' : v === Infinity ? '.inf' : v === -Infinity ? '-.inf' : formatDouble(v);
  return text(v);
}
const yamlEmpty = (v) => (v instanceof Map && !v.size ? '{}' : Array.isArray(v) && !v.length ? '[]' : null);
function yamlMap(m, ind, depth) {
  if (depth > MAX) throw deep();
  return [...m].map(([k, v]) => `${ind}${yamlString(k, ind, false)}:${yamlAfter(v, ind, depth)}`).join('');
}
function yamlSeq(a, ind, depth) {
  if (depth > MAX) throw deep();
  return a.map((v) => `${ind}-${yamlItem(v, ind, depth)}`).join('');
}
function yamlAfter(v, ind, depth) {
  if (v instanceof Map && v.size) return `\n${yamlMap(v, `${ind}  `, depth + 1)}`;
  if (Array.isArray(v) && v.length) return `\n${yamlSeq(v, `${ind}  `, depth + 1)}`;
  return ` ${yamlEmpty(v) ?? yamlScalar(v, `${ind}  `)}\n`;
}
function yamlItem(v, ind, depth) {
  if (v instanceof Map && v.size) return ` ${yamlMap(v, `${ind}  `, depth + 1).slice(ind.length + 2)}`;
  if (Array.isArray(v) && v.length) return ` ${yamlSeq(v, `${ind}  `, depth + 1).slice(ind.length + 2)}`;
  return ` ${yamlEmpty(v) ?? yamlScalar(v, `${ind}  `)}\n`;
}
function writeYaml(root) {
  if (root instanceof Map && root.size) return yamlMap(root, '', 0);
  if (Array.isArray(root) && root.length) return yamlSeq(root, '', 0);
  return `${yamlEmpty(root) ?? yamlScalar(root, '  ')}\n`;
}

// ───────── TOML ─────────
function readToml(src) {
  const toml = require('smol-toml');
  let doc;
  try { doc = toml.parse(src, { integersAsBigInt: true }); } catch (e) { throw new Error(`Not valid TOML: ${String(e.message).split('\n')[0].replace(/^Invalid TOML document: /, '')}${e.line ? ` at line ${e.line}, column ${e.column}` : ''}.`); }
  const conv = (v) => {
    if (v instanceof toml.TomlDate) return new DataDate(v.toISOString().replace(/\.(\d*?)0*(?=Z|[+-]\d\d:\d\d|$)/, (_, f) => (f ? `.${f}` : '')));
    if (Array.isArray(v)) return v.map(conv);
    if (v && typeof v === 'object') return new Map(Object.entries(v).map(([k, x]) => [k, conv(x)]));
    return v;
  };
  return conv(doc);
}
const tomlQuote = (t) => `"${t.replace(/["\\\u0000-\u001f\u007f-\u009f]/g, (c) => ({ '"': '\\"', '\\': '\\\\', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' })[c] || `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)}"`;
const tomlKey = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlQuote(k));
const INT64 = [-(2n ** 63n), 2n ** 63n - 1n];
function tomlInline(v, depth) {
  if (depth > MAX) throw deep();
  if (v instanceof Map) { const e = [...v].filter(([, x]) => x != null); return e.length ? `{ ${e.map(([k, x]) => `${tomlKey(k)} = ${tomlInline(x, depth + 1)}`).join(', ')} }` : '{}'; }
  if (Array.isArray(v)) return `[${v.filter((x) => x != null).map((x) => tomlInline(x, depth + 1)).join(', ')}]`;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'bigint') return v >= INT64[0] && v <= INT64[1] ? String(v) : tomlQuote(String(v));
  if (typeof v === 'number') return Number.isNaN(v) ? 'nan' : v === Infinity ? 'inf' : v === -Infinity ? '-inf' : formatDouble(v);
  if (v instanceof DataDate) return v.text;
  return tomlQuote(text(v));
}
function tomlTable(out, trail, table, depth) {
  if (depth > MAX) throw deep();
  const nested = [];
  for (const [k, v] of table) {
    if (v == null) continue;
    if (v instanceof Map || (Array.isArray(v) && v.length && v.every((x) => x instanceof Map))) nested.push([k, v]);
    else out.push(`${tomlKey(k)} = ${tomlInline(v, depth + 1)}\n`);
  }
  for (const [k, v] of nested) {
    const child = [...trail, k], header = child.map(tomlKey).join('.');
    if (v instanceof Map) { out.push(`\n[${header}]\n`); tomlTable(out, child, v, depth + 1); } else for (const item of v) { out.push(`\n[[${header}]]\n`); tomlTable(out, child, item, depth + 1); }
  }
}
function writeToml(root) {
  const out = [];
  tomlTable(out, [], root instanceof Map ? root : new Map([['items', root]]), 0);
  const t = out.join('').replace(/^\n+/, '');
  return !t || t.endsWith('\n') ? t : `${t}\n`;
}

// ───────── XML ("@attribute / #text") ─────────
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const NC_START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const NC_FIRST = new RegExp(`[${NC_START}]`, 'u'), NC_REST = new RegExp(`[${NC_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F\\u2040]`, 'u');
const isNcName = (n) => { const cs = [...n]; return cs.length > 0 && NC_FIRST.test(cs[0]) && cs.every((c) => NC_REST.test(c)); };
function encodeName(name) {
  if (!name) return '_';
  const cs = [...name];
  return cs.map((c, i) => {
    if (c === '_' && /^_[xX]([0-9A-Fa-f]{4}|[0-9A-Fa-f]{8})_/.test(cs.slice(i).join(''))) return '_x005F_';
    if (i === 0 ? NC_FIRST.test(c) : NC_REST.test(c)) return c;
    const cp = c.codePointAt(0);
    return `_x${cp.toString(16).toUpperCase().padStart(cp > 0xffff ? 8 : 4, '0')}_`;
  }).join('');
}
const decodeName = (n) => n.replace(/_[xX]([0-9A-Fa-f]{8})_|_[xX]([0-9A-Fa-f]{4})_/g, (m, a, b) => { const cp = parseInt(a || b, 16); return cp <= 0x10ffff ? String.fromCodePoint(cp) : m; });
function decodeXml(bytes) {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) return decodeText(bytes);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  const m = /^\s*<\?xml[^>]*?encoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/.exec(Buffer.from(bytes.subarray(0, 1024)).toString('latin1'));
  if (m && !/^utf-?(8|16)$/i.test(m[1])) {
    if (!iconv.encodingExists(encodingName(m[1]))) throw new Error(`Not valid XML: the encoding “${m[1]}” is not supported.`);
    return iconv.decode(bytes, encodingName(m[1]));
  }
  const s = strictUtf8(bytes);
  if (s == null) throw new Error('Not valid XML: the file is not valid UTF-8 text and declares no other encoding.');
  return s;
}
function readXml(bytes) {
  const { SaxesParser } = require('saxes');
  const parser = new SaxesParser({ xmlns: true });
  const stack = [];
  let root = null;
  const qname = (prefix, local) => (prefix ? `${prefix}:${decodeName(local)}` : decodeName(local));
  parser.on('opentag', (n) => {
    if (stack.length > MAX) throw new Error('The XML is nested too deeply.');
    const attrs = Object.values(n.attributes).map((a) => [a.prefix === 'xmlns' ? `xmlns:${a.local}` : a.name === 'xmlns' ? 'xmlns' : qname(a.prefix, a.local), a.value]);
    stack.push({ name: qname(n.prefix, n.local), attrs, kids: [], texts: [], empty: n.isSelfClosing });
  });
  const addText = (t, cdata) => { const top = stack[stack.length - 1]; if (top && (cdata || t.trim())) top.texts.push(t); };
  parser.on('text', (t) => addText(t, false));
  parser.on('cdata', (t) => addText(t, true));
  parser.on('closetag', () => {
    const e = stack.pop();
    let value;
    if (!e.attrs.length && !e.kids.length) value = e.empty ? null : e.texts.join('');
    else {
      value = new Map(e.attrs.map(([k, v]) => [`@${k}`, v]));
      if (!e.kids.length) { if (!e.empty) value.set('#text', e.texts.join('')); } else {
        const mixed = e.texts.map((t) => t.trim()).filter(Boolean).join(' ');
        if (mixed) value.set('#text', mixed);
        for (const [k, v] of e.kids) { const had = value.get(k); if (!value.has(k)) value.set(k, v); else if (Array.isArray(had)) had.push(v); else value.set(k, [had, v]); }
      }
    }
    if (stack.length) stack[stack.length - 1].kids.push([e.name, value]); else root = new Map([[e.name, value]]);
  });
  const src = decodeXml(bytes);
  try { parser.write(src).close(); } catch (e) {
    if (/nested too deeply/.test(e.message)) throw e;
    if (!root && !stack.length && /root/i.test(e.message)) throw new Error('The XML file has no root element.');
    const m = /^(\d+):(\d+): (.*?)\.?$/s.exec(e.message);
    throw new Error(`Not valid XML: ${m ? `${m[3]} (line ${m[1]}, column ${m[2]})` : e.message}.`);
  }
  if (!root) throw new Error('The XML file has no root element.');
  return root;
}
const xmlClean = (t) => t.replace(/[^\t\n\r\u0020-\ud7ff\ue000-\ufffd\ud800-\udbff\udc00-\udfff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
const xmlText = (t) => xmlClean(t).replace(/\r\n?/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlAttr = (t) => xmlClean(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');
function xmlResolve(name, element, scope) {
  const i = name.indexOf(':');
  if (i > 0 && i < name.length - 1) {
    const prefix = name.slice(0, i);
    let ns = prefix === 'xml' ? XML_NS : null;
    for (let s = scope; !ns && s; s = s.parent) if (s.ns.has(prefix)) ns = s.ns.get(prefix);
    if (ns && isNcName(prefix)) return `${prefix}:${encodeName(name.slice(i + 1))}`;
  }
  return encodeName(name);
}
function xmlElement(name, value, parent, depth, flat) {
  if (depth > MAX) throw deep();
  const scope = { ns: new Map(), parent };
  if (value instanceof Map) for (const [k, v] of value) { if (k === '@xmlns') scope.ns.set('', text(v)); else if (k.startsWith('@xmlns:')) scope.ns.set(k.slice(7), text(v)); }
  const tag = xmlResolve(name, true, scope), pad = flat ? '' : `\n${'  '.repeat(depth)}`;
  let open = `${pad}<${tag}`;
  const close = (inner, kids) => `${open}>${inner}${kids ? pad : ''}</${tag}>`;
  if (value instanceof Map) {
    for (const [k, v] of value) {
      if (!k.startsWith('@')) continue;
      const a = k.slice(1), val = xmlAttr(isScalar(v) ? text(v) : writeJson(v).trim());
      open += ` ${a === 'xmlns' || a.startsWith('xmlns:') ? a : xmlResolve(a, false, scope)}="${val}"`;
    }
    const hasText = value.has('#text') && value.get('#text') != null;
    let inner = hasText ? xmlText(text(value.get('#text'))) : '', kids = false;
    for (const [k, v] of value) {
      if (k.startsWith('@') || k === '#text') continue;
      for (const item of Array.isArray(v) ? v : [v]) { inner += xmlElement(k, item, scope, depth + 1, flat || hasText); kids = true; }
    }
    return hasText || kids ? close(inner, kids && !hasText && !flat) : `${open} />`;
  }
  if (Array.isArray(value)) return value.length ? close(value.map((x) => xmlElement('item', x, scope, depth + 1, flat)).join(''), !flat) : `${open} />`;
  if (value == null) return `${open} />`;
  return close(xmlText(text(value)), false);
}
function writeXml(root) {
  const only = root instanceof Map && root.size === 1 ? [...root][0] : null;
  const body = only && only[0] && !/^[@#]/.test(only[0]) && !Array.isArray(only[1]) ? xmlElement(only[0], only[1], null, 0, false) : xmlElement('root', root, null, 0, false);
  return `<?xml version="1.0" encoding="utf-8"?>${body}\n`;
}

// ───────── CSV / TSV ─────────
function parseCsv(src, d) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"' && !field) quoted = true;
    else if (ch === d) { row.push(field); field = ''; } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function detectDelimiter(src) {
  const n = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of src.slice(0, 4096)) { if (ch === '"') quoted = !quoted; else if (!quoted && ch in n) n[ch]++; }
  return [',', ';', '\t'].reduce((best, c) => (n[c] > n[best] ? c : best), ',');
}
// Rows of a CSV/TSV file: encoding and (for CSV) delimiter detected; TSV is always tab.
function csvRows(bytes, tab = false, dropEmpty = true) {
  const src = decodeText(bytes);
  const rows = parseCsv(src, tab ? '\t' : detectDelimiter(src));
  return dropEmpty ? rows.filter((r) => r.some((c) => c !== '')) : rows;
}
const quoteCell = (v, d) => (v.includes(d) || /["\r\n]/.test(v) || v.startsWith(' ') || v.endsWith(' ') ? `"${v.replace(/"/g, '""')}"` : v);
const csvText = (rows, d = ',') => `\ufeff${rows.map((r) => `${r.map((v) => quoteCell(String(v ?? ''), d)).join(d)}\r\n`).join('')}`;
// A plain number a spreadsheet stores as a number: "12", "-3.5", "1e3"; not "007", "1,234", "1/2".
const isNumber = (v) => v.length > 0 && v.length < 20 && /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v) && !/^-?0\d/.test(v);
function displayWidth(t) {
  let longest = 0;
  for (const line of t.split('\n')) {
    let w = 0;
    for (const ch of line) { const c = ch.charCodeAt(0); w += c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60)) ? 2 : 1; }
    longest = Math.max(longest, w);
  }
  return longest;
}
// Rows as a SheetJS sheet: text stays text (leading zeros, "1/2"), plain numbers become numbers, columns sized to fit.
function rowsToSheet(rows) {
  const XLSX = require('xlsx');
  const ws = {}, widths = [];
  rows.forEach((row, r) => row.forEach((v, c) => {
    if (v === '' || v == null) return;
    v = String(v);
    ws[XLSX.utils.encode_cell({ r, c })] = isNumber(v) ? { t: 'n', v: Number(v), w: v } : { t: 's', v };
    widths[c] = Math.max(widths[c] || 0, displayWidth(v));
  }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: Math.max(0, widths.length - 1) } });
  ws['!cols'] = widths.map((w) => w && { wch: U.clamp(w + 1, 4, 50) });
  return ws;
}
function uniqueHeaders(row) {
  const used = new Set();
  return row.map((h, c) => {
    const name = h.trim() || `column${c + 1}`;
    let u = name;
    for (let i = 2; used.has(u); i++) u = `${name}_${i}`;
    used.add(u);
    return u;
  });
}
const typed = (c) => (c.length > 0 && c.length < 20 && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$/.test(c) ? number(c) : /^true$/i.test(c) ? true : /^false$/i.test(c) ? false : c);
function records(rows) {
  if (!rows.length) return [];
  const headers = uniqueHeaders(rows[0]);
  return rows.slice(1).map((row) => {
    while (headers.length < row.length) headers.push(`column${headers.length + 1}`);
    return new Map(headers.map((h, c) => [h, typed(c < row.length ? row[c] : '')]));
  });
}
const notTable = (what) => new Error(`${what}: CSV holds a table. Convert an array of objects (one level of nesting at most), an object of arrays or an array of arrays.`);
function table(root) {
  const node = unwrapRecords(root);
  if (Array.isArray(node)) {
    if (!node.length) return [];
    if (node.every((x) => x == null || x instanceof Map)) return recordRows(node.map((x) => x || new Map()));
    if (node.every((x) => Array.isArray(x) && x.every(isScalar))) return node.map((x) => x.map(text));
    if (node.every(isScalar)) return [['value'], ...node.map((x) => [text(x)])];
    throw notTable('The array mixes objects, lists and single values');
  }
  if (node instanceof Map) {
    const vals = [...node.values()];
    if (vals.length && vals.every((v) => Array.isArray(v) && v.every(isScalar))) {
      const height = Math.max(...vals.map((v) => v.length));
      return [[...node.keys()], ...Array.from({ length: height }, (_, r) => vals.map((v) => (r < v.length ? text(v[r]) : '')))];
    }
    return recordRows([node]);
  }
  throw notTable('The data is a single value');
}
function recordRows(list) {
  const cols = [], known = new Set();
  const flat = list.map((rec, r) => {
    const cells = new Map();
    const add = (col, v) => { if (!known.has(col)) { known.add(col); cols.push(col); } cells.set(col, text(v)); };
    for (const [k, v] of rec) {
      if (v instanceof Map) {
        for (const [ck, cv] of v) { if (!isScalar(cv)) throw notTable(`Row ${r + 1}, “${k}.${ck}” is nested more than one level`); add(`${k}.${ck}`, cv); }
      } else if (Array.isArray(v)) throw notTable(`Row ${r + 1}, “${k}” holds a list`);
      else add(k, v);
    }
    return cells;
  });
  return [cols, ...flat.map((cells) => cols.map((c) => cells.get(c) ?? ''))];
}

// ───────── vCard ─────────
const VCARD_COLUMNS = ['Full name', 'Given name', 'Family name', 'Organization', 'Title', 'Email', 'Phone', 'Address', 'Birthday', 'Note'];
const newContact = () => ({ fn: '', given: '', family: '', org: '', title: '', emails: [], phones: [], addresses: [], bday: '', notes: [] });
const isCjk = (t) => [...t].every((c) => /[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f\u4e00-\u9fff\u3040-\u30ff]/.test(c));
function finishContact(c) {
  if (c.fn) return;
  c.fn = !c.family || !c.given ? c.family + c.given : isCjk(c.family) && isCjk(c.given) ? c.family + c.given : `${c.given} ${c.family}`;
}
const vUnescape = (v) => v.replace(/\\(.)/gs, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
function components(v) {
  const parts = [];
  let cur = '';
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '\\' && i + 1 < v.length) { cur += v.slice(i, i + 2); i++; } else if (v[i] === ';') { parts.push(vUnescape(cur)); cur = ''; } else cur += v[i];
  }
  parts.push(vUnescape(cur));
  return parts;
}
function splitOutsideQuotes(s, sep) {
  const out = [];
  let cur = '', q = false;
  for (const ch of s) { if (ch === '"') q = !q; if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur);
  return out;
}
function vDecode(bytes, charset) {
  if (charset && iconv.encodingExists(encodingName(charset))) return iconv.decode(bytes, encodingName(charset));
  return strictUtf8(bytes) ?? iconv.decode(bytes, 'cp949');
}
function vProperty(line) {
  let colon = -1, q = false;
  for (let i = 0; i < line.length; i++) { if (line[i] === '"') q = !q; else if (line[i] === ':' && !q) { colon = i; break; } }
  if (colon <= 0) return null;
  const head = splitOutsideQuotes(line.slice(0, colon), ';');
  const raw = line.slice(colon + 1);
  const p = { name: head[0].slice(head[0].lastIndexOf('.') + 1).trim().toUpperCase(), raw, value: '', binary: false, kind: null };
  let encoding = null, charset = null;
  const types = [];
  for (const param of head.slice(1)) {
    const eq = param.indexOf('=');
    const key = (eq < 0 ? 'TYPE' : param.slice(0, eq)).trim().toUpperCase();
    const val = (eq < 0 ? param : param.slice(eq + 1)).trim().replace(/^"+|"+$/g, '');
    if (key === 'ENCODING') encoding = val.toUpperCase();
    else if (key === 'CHARSET') charset = val;
    else if (key === 'TYPE') types.push(...val.split(',').map((t) => t.trim()).filter(Boolean));
    else if (key === 'VALUE' && /^binary$/i.test(val)) p.binary = true;
    if (eq < 0 && ['QUOTED-PRINTABLE', 'BASE64', 'B'].includes(val.toUpperCase())) encoding = val.toUpperCase();
  }
  if (encoding === 'BASE64' || encoding === 'B') { p.binary = true; return p; }
  let bytes = Buffer.from(raw, 'latin1');
  if (encoding === 'QUOTED-PRINTABLE') {
    const out = [];
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x3d && i + 2 < bytes.length && /^[0-9A-Fa-f]{2}$/.test(bytes.toString('latin1', i + 1, i + 3))) { out.push(parseInt(bytes.toString('latin1', i + 1, i + 3), 16)); i += 2; } else if (!(bytes[i] === 0x3d && i === bytes.length - 1)) out.push(bytes[i]);
    }
    bytes = Buffer.from(out);
  }
  p.value = vDecode(bytes, charset);
  const kinds = [];
  for (const t of types.map((x) => x.toUpperCase())) {
    const k = { CELL: p.name === 'TEL' && 'mobile', HOME: 'home', WORK: 'work', FAX: p.name === 'TEL' && 'fax', PAGER: p.name === 'TEL' && 'pager', MAIN: p.name === 'TEL' && 'main' }[t];
    if (k && !kinds.includes(k)) kinds.push(k);
  }
  p.kind = kinds.length ? kinds.join(', ') : null;
  return p;
}
function readVcard(bytes) {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) bytes = Buffer.from(decodeText(bytes), 'utf8');
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  const lines = Buffer.from(bytes).toString('latin1').split(/\r\n|\n|\r/);
  const logical = [];
  for (const line of lines) {
    const cur = logical[logical.length - 1];
    if (cur != null && cur.endsWith('=') && /QUOTED-PRINTABLE/i.test(cur.slice(0, Math.max(0, cur.indexOf(':'))))) logical[logical.length - 1] = cur.slice(0, -1) + line;
    else if (cur != null && /^[ \t]/.test(line)) logical[logical.length - 1] = cur + line.slice(1);
    else logical.push(line);
  }
  const contacts = [];
  let c = null, depth = 0;
  const add = (list, v, kind) => { v = v.trim(); if (v) list.push([v, kind]); };
  for (const line of logical) {
    const p = vProperty(line);
    if (!p) continue;
    if (p.name === 'BEGIN' && /^vcard$/i.test(p.raw.trim())) { if (depth++ === 0) c = newContact(); continue; }
    if (p.name === 'END' && /^vcard$/i.test(p.raw.trim())) { if (depth > 0 && --depth === 0 && c) { finishContact(c); contacts.push(c); c = null; } continue; }
    if (!c || depth !== 1 || p.binary) continue;
    const v = p.value;
    switch (p.name) {
      case 'FN': c.fn = vUnescape(v).trim(); break;
      case 'N': { const n = components(v); c.family = (n[0] || '').trim(); c.given = n.slice(1, 3).map((x) => x.trim()).filter(Boolean).join(' '); break; }
      case 'ORG': c.org = components(v).map((x) => x.trim()).filter(Boolean).join(', '); break;
      case 'TITLE': c.title = vUnescape(v).trim(); break;
      case 'EMAIL': add(c.emails, vUnescape(v).replace(/^mailto:/i, ''), p.kind); break;
      case 'TEL': add(c.phones, vUnescape(v).replace(/^tel:/i, ''), p.kind); break;
      case 'ADR': add(c.addresses, components(v).map((x) => x.trim().replace(/\r\n|\n|\r/g, ', ')).filter(Boolean).join(', '), p.kind); break;
      case 'BDAY': { const b = vUnescape(v).trim(); c.bday = /^\d{8}$/.test(b) ? `${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6)}` : b; break; }
      case 'NOTE': { const n = vUnescape(v).trim(); if (n) c.notes.push(n); break; }
      default:
    }
  }
  if (!contacts.length) throw new Error('The file has no vCard contacts.');
  return contacts;
}
const joinValues = (list) => list.map(([v, k]) => (k ? `${v} (${k})` : v)).join('; ');
const vcardRows = (contacts) => [VCARD_COLUMNS, ...contacts.map((c) => [c.fn, c.given, c.family, c.org, c.title, joinValues(c.emails), joinValues(c.phones), joinValues(c.addresses), c.bday, c.notes.join('\n')])];
const FIELDS = {
  fn: 'fullname name displayname 이름 성명 姓名 名称', given: 'givenname firstname given first 名', family: 'familyname lastname surname family last 성 姓',
  org: 'organization organisation company org 회사 소속 公司 单位', title: 'title jobtitle 직함 직책 직위 职位 职务', emails: 'email emails emailaddress mail 이메일 전자메일 메일 邮箱 电子邮件',
  phones: 'phone phones telephone tel mobile phonenumber cell 전화 전화번호 휴대폰 휴대전화 연락처 电话 手机', addresses: 'address addresses 주소 地址',
  bday: 'birthday bday birthdate dateofbirth 생일 생년월일 生日', notes: 'note notes memo 메모 비고 备注',
};
const fieldOf = (h) => { const key = h.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(); return Object.keys(FIELDS).find((f) => FIELDS[f].split(' ').includes(key)) || null; };
function contactsFromRows(rows) {
  if (!rows.length) throw new Error('The CSV file is empty.');
  const fields = rows[0].map(fieldOf);
  if (fields.every((f) => !f)) throw new Error('No contact columns found. Name the columns Full name, Email, Phone, Address and so on.');
  const split = (cell) => cell.split(';').map((x) => x.trim()).filter(Boolean).map((part) => { const m = /^(.*?)\s*\(([^()]*)\)$/.exec(part); return m ? [m[1].trim(), m[2].trim()] : [part, null]; });
  const out = [];
  for (const row of rows.slice(1)) {
    const c = newContact();
    row.forEach((cell, i) => {
      const v = String(cell).trim(), f = fields[i];
      if (!v || !f) return;
      if (f === 'emails' || f === 'phones' || f === 'addresses') c[f].push(...split(v));
      else if (f === 'notes') c.notes.push(v);
      else c[f] = v;
    });
    if (!c.fn && !c.given && !c.family && !c.org && !c.emails.length && !c.phones.length) continue;
    finishContact(c);
    if (!c.fn) c.fn = c.org || c.emails[0]?.[0] || c.phones[0][0];
    out.push(c);
  }
  if (!out.length) throw new Error('The CSV file has no contacts.');
  return out;
}
const vEscape = (v) => v.replace(/\\/g, '\\\\').replace(/\r\n?/g, '\n').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
function vTypes(kind, prop) {
  const out = [];
  for (const w of String(kind || '').split(/[, ]+/).filter(Boolean).map((x) => x.toLowerCase())) {
    const tel = prop === 'TEL';
    const t = ['mobile', 'cell', '휴대폰', '手机'].includes(w) && tel ? 'CELL' : ['home', '집', '家'].includes(w) ? 'HOME' : ['work', 'office', '직장', '회사', '工作'].includes(w) ? 'WORK'
      : ['fax', '팩스', '传真'].includes(w) && tel ? 'FAX' : w === 'pager' && tel ? 'PAGER' : w === 'main' && tel ? 'MAIN' : null;
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
function vFold(line) {
  let out = '', bytes = 0;
  for (const { segment } of new Intl.Segmenter().segment(line)) {
    const n = Buffer.byteLength(segment);
    if (bytes + n > 75) { out += '\r\n '; bytes = 1; }
    out += segment;
    bytes += n;
  }
  return `${out}\r\n`;
}
function writeVcard(contacts) {
  return contacts.map((c) => {
    const L = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vEscape(c.fn)}`, `N:${vEscape(c.family)};${vEscape(c.given)};;;`];
    if (c.org) L.push(`ORG:${vEscape(c.org)}`);
    if (c.title) L.push(`TITLE:${vEscape(c.title)}`);
    for (const [v, k] of c.emails) L.push(`EMAIL;TYPE=${['INTERNET', ...vTypes(k, 'EMAIL')].join(',')}:${vEscape(v)}`);
    for (const [v, k] of c.phones) { const t = vTypes(k, 'TEL'); L.push(t.length ? `TEL;TYPE=${t.join(',')}:${vEscape(v)}` : `TEL:${vEscape(v)}`); }
    for (const [v, k] of c.addresses) { const t = vTypes(k, 'ADR'); L.push(`${t.length ? `ADR;TYPE=${t.join(',')}` : 'ADR'}:;;${vEscape(v)};;;;`); }
    if (c.bday) L.push(`BDAY:${vEscape(c.bday)}`);
    if (c.notes.length) L.push(`NOTE:${vEscape(c.notes.join('\n'))}`);
    L.push('END:VCARD');
    return L.map(vFold).join('');
  }).join('');
}

// ───────── Files ─────────
const FORMAT = { json: 'json', jsonc: 'json', jsonl: 'jsonl', ndjson: 'jsonl', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml', csv: 'csv', tsv: 'tsv', tab: 'tsv', vcf: 'vcf', vcard: 'vcf' };
const formatOf = (f) => FORMAT[U.ext(f)] || null;
function readTree(file, fmt = formatOf(file)) {
  const bytes = fs.readFileSync(file);
  if (fmt === 'xml') return readXml(bytes);
  if (fmt === 'csv' || fmt === 'tsv') return records(csvRows(bytes, fmt === 'tsv'));
  if (fmt === 'vcf') return records(vcardRows(readVcard(bytes)));
  const src = decodeText(bytes);
  if (fmt === 'json') return readJson(src);
  if (fmt === 'jsonl') return readJsonLines(src);
  if (fmt === 'yaml') return readYaml(src);
  if (fmt === 'toml') return readToml(src);
  throw new Error(`Lime can’t read ${U.ext(file).toUpperCase()} as data.`);
}
const WRITERS = { json: (t) => `${writeJson(t)}\n`, jsonl: writeJsonLines, yaml: writeYaml, toml: writeToml, xml: writeXml, csv: (t) => csvText(table(t)), tsv: (t) => csvText(table(t), '\t') };
// Rows of any table file for contacts: CSV/TSV text, or the first sheet of a workbook.
function tableRows(file) {
  const fmt = formatOf(file);
  if (fmt === 'csv' || fmt === 'tsv') return csvRows(fs.readFileSync(file), fmt === 'tsv');
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(file);
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }).map((r) => r.map(String)).filter((r) => r.some((c) => c !== ''));
}

async function convert(input, opts, ctx) {
  const from = formatOf(input), to = opts.to || 'json';
  ctx.progress?.(0.1, 'Reading');
  let out;
  if (to === 'vcf') out = writeVcard(from === 'vcf' ? readVcard(fs.readFileSync(input)) : contactsFromRows(tableRows(input)));
  else if (to === 'xlsx') {
    const XLSX = require('xlsx');
    const rows = from === 'vcf' ? vcardRows(readVcard(fs.readFileSync(input))) : table(readTree(input, from));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, rowsToSheet(rows), U.base(input).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
    out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
  } else if (from === 'vcf' && to === 'csv') out = csvText(vcardRows(readVcard(fs.readFileSync(input))));
  else {
    if (!WRITERS[to]) throw new Error(`Lime can’t write data as ${to.toUpperCase()}.`);
    const tree = readTree(input, from);
    ctx.progress?.(0.6, `Writing ${to.toUpperCase()}`);
    out = WRITERS[to](tree);
  }
  const file = ctx.out.file(input, `${U.base(input)}${U.ext(input) === to ? '-converted' : ''}.${to}`);
  await fsp.writeFile(file, out);
  return file;
}

module.exports = {
  convert, readTree, formatOf, DataDate, number, formatDouble, text, unwrapRecords, table, records,
  readJson, readJsonLines, writeJson, writeJsonLines, readYaml, writeYaml, readToml, writeToml, readXml, writeXml, encodeName, decodeName,
  parseCsv, detectDelimiter, csvRows, csvText, isNumber, displayWidth, rowsToSheet, readVcard, vcardRows, contactsFromRows, writeVcard, tableRows,
};
