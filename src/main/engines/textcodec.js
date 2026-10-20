'use strict';
// Text decoding shared by the data, CSV, vCard and subtitle readers: byte order marks, strict UTF-8, Korean CP949 (as
// saved by Korean Excel and most SAMI files) and the PC's code page for the rest.

const iconv = require('iconv-lite');

const utf8 = new TextDecoder('utf-8', { fatal: true });
const strictUtf8 = (b) => { try { return utf8.decode(b); } catch (_) { return null; } };
const hasBom16 = (b) => b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff));
const utf16 = (b) => iconv.decode(b.subarray(2), b[0] === 0xff ? 'utf-16le' : 'utf-16be');
const KOREAN = new Set(['euc-kr', 'euckr', 'ks_c_5601-1987', 'ks_c_5601', 'korean', 'cp949', 'ms949', 'uhc', 'windows-949']);
const encodingName = (name) => (KOREAN.has(String(name).toLowerCase()) ? 'cp949' : name);

// Data files, CSV/TSV: UTF-16 with BOM, UTF-8 with or without BOM, else CP949.
function decodeText(bytes) {
  if (hasBom16(bytes)) return utf16(bytes);
  const s = strictUtf8(bytes);
  return s != null ? s.replace(/^\ufeff/, '') : iconv.decode(bytes, 'cp949');
}

// True when the non-ASCII bytes are CP949 pairs, mostly KS X 1001 Hangul and hardly any above lead byte C8 (GBK puts
// many common characters there, Korean only rare Hanja); Western text read as CP949 gives ASCII trail bytes.
function looksKorean(b) {
  let pairs = 0, hangul = 0, high = 0;
  for (let i = 0; i < b.length; i++) {
    const lead = b[i];
    if (lead < 0x80) continue;
    if (lead < 0x81 || lead > 0xfe || i + 1 >= b.length) return false;
    const trail = b[++i];
    if (!((trail >= 0x41 && trail <= 0x5a) || (trail >= 0x61 && trail <= 0x7a) || (trail >= 0x81 && trail <= 0xfe))) return false;
    pairs++;
    if (lead >= 0xb0 && lead <= 0xc8 && trail >= 0xa1) hangul++;
    else if (lead > 0xc8) high++;
  }
  return pairs > 0 && hangul * 2 >= pairs && high * 10 <= pairs;
}

// Windows' ANSI code page for the UI language (Node has none of its own).
function ansiCodePage(locale = Intl.DateTimeFormat().resolvedOptions().locale) {
  const l = String(locale).toLowerCase();
  const lang = l.split(/[-_]/)[0];
  if (lang === 'ja') return 932;
  if (lang === 'zh') return /tw|hk|mo|hant/.test(l) ? 950 : 936;
  if (lang === 'ko') return 949;
  const table = { 1250: 'cs pl hu sk sl hr ro', 1251: 'ru uk bg sr be', 1253: 'el', 1254: 'tr az', 1255: 'he', 1256: 'ar fa ur', 1257: 'et lv lt', 1258: 'vi', 874: 'th' };
  for (const [cp, langs] of Object.entries(table)) if (langs.split(' ').includes(lang)) return Number(cp);
  return 1252;
}

// Subtitles: BOM, BOM-less UTF-16LE, strict UTF-8, a declared charset, CP949 when it looks Korean, else the PC's code
// page (Western 1252 on Korean Windows, since CP949 was already ruled out).
function decodeSubtitle(b, ansi = ansiCodePage()) {
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return Buffer.from(b.subarray(3)).toString('utf8');
  if (hasBom16(b)) return utf16(b);
  if (b.length >= 4 && b[1] === 0 && b[3] === 0 && b[0] !== 0) return iconv.decode(b, 'utf-16le');
  const s = strictUtf8(b);
  if (s != null) return s;
  const m = /(?:charset|encoding)\s*=\s*["']?([A-Za-z0-9_.:-]+)/i.exec(Buffer.from(b.subarray(0, 2048)).toString('latin1'));
  if (m && iconv.encodingExists(encodingName(m[1])) && !/^(utf-?8|utf-?16(le|be)?|unicode)$/i.test(m[1])) return iconv.decode(b, encodingName(m[1]));
  if (looksKorean(b)) return iconv.decode(b, 'cp949');
  if ([932, 936, 950].includes(ansi)) return iconv.decode(b, { 932: 'shift_jis', 936: 'gbk', 950: 'big5' }[ansi]);
  return iconv.decode(b, `windows-${ansi > 0 && ![949, 1361, 65001].includes(ansi) ? ansi : 1252}`);
}

module.exports = { decodeText, decodeSubtitle, looksKorean, ansiCodePage, strictUtf8, encodingName, iconv };
