'use strict';
// Tidies dictated text: spoken punctuation, fillers, repeats and false starts, numbers and dates,
// capitals and a closing full stop. Plain rules, so it is quick and works offline.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const latin = (t) => !/[֐-ࣿऀ-෿฀-๿　-鿿가-힯]/.test(t);

// Users' own fixes come first, so "sober realty" becomes "Sobha Realty" before anything else reads it.
function replaceAll(text, pairs = []) {
  let t = text;
  for (const [from, to] of pairs) {
    const f = String(from || '').trim();
    if (!f) continue;
    t = t.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${esc(f).replace(/\s+/g, '[\\s,.-]+')}(?=$|[^\\p{L}\\p{N}])`, 'giu'), (m, pre) => pre + to);
  }
  return t;
}

const MARKS = [
  [/\bnew paragraph\b/, '\n\n'], [/\bnew line\b|\bnext line\b/, '\n'],
  [/\bquestion mark\b/, '?'], [/\bexclamation (?:mark|point)\b/, '!'], [/\bfull stop\b/, '.'],
  [/\bsemicolon\b|\bsemi colon\b/, ';'], [/\bcolon\b/, ':'], [/\bcomma\b/, ','],
  // "period" is a word too ("the trial period ends"), so it counts only where a sentence ends.
  [/\bperiod\b(?=\s*[.,!?]*\s*(?:$|new (?:line|paragraph)\b))/, '.'],
];
function spoken(t) {
  for (const [re, mark] of MARKS) t = t.replace(new RegExp(`[ \\t]*[,.;:]?[ \\t]*${re.source}[ \\t]*[,.;:!?]?[ \\t]*`, 'gi'), mark === '\n' || mark === '\n\n' ? mark : `${mark} `);
  return t;
}

const UM = '(?:u+m+|u+h+m*|e+r+m+|e+h+|hm+|mm+|a+h+)';
// A filler takes one of its commas with it: "we should, uh, meet" reads "we should meet".
const FILLER = new RegExp(`(^|[.!?]\\s*|,?\\s+)${UM}(?:[,.]|(?=\\s|$))(?:\\s*,)?`, 'gi');
const PHRASE = /(^|[.!?]\s+|,?\s+)(?:you know|i mean|like|basically|actually|so)\s*,\s*/gi;
const TRAIL = /,\s*(?:you know|i mean|like)(?=\s*[,.!?]|$)/gi;
function fillers(t) {
  t = t.replace(FILLER, (m, pre) => (/[.!?]/.test(pre) || !pre ? pre : ' ')).replace(PHRASE, (m, pre) => (/[.!?]/.test(pre) || !pre ? pre : ' ')).replace(TRAIL, '');
  return t.replace(/\b(you know|i mean)\b\s*(?=[.!?]|$)/gi, '');
}

const KEEP_DOUBLE = new Set(['that that', 'had had', 'is is', 'bye bye', 'no no', 'very very', 'so so']);
function repeats(t) {
  // False starts: "Mon- on Tuesday", "I'll— I will".
  t = t.replace(/(^|\s)[\p{L}']+(?:-|—|–|…)\s+(?=\p{L})/gu, '$1');
  // "I'll, I'll go" and "to the, to the shop": the last copy stays.
  for (let n = 4; n >= 1; n--) {
    const w = "[\\p{L}\\p{N}'’]+";
    const re = new RegExp(`(^|[^\\p{L}\\p{N}'’])((?:${w}\\s+){${n - 1}}${w})(?:[\\s,.]+\\2)+(?=$|[^\\p{L}\\p{N}'’])`, 'giu');
    t = t.replace(re, (m, pre, g) => (n === 1 && KEEP_DOUBLE.has(`${g} ${g}`.toLowerCase()) ? m : pre + g));
  }
  return t;
}

const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { hundred: 100, thousand: 1e3, million: 1e6 };
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
const NUMWORD = `(?:${[...Object.keys(ONES), ...Object.keys(TENS), ...Object.keys(SCALE)].join('|')})`;
function wordsToNumber(s) {
  let total = 0, cur = 0;
  for (const w of s.toLowerCase().split(/[\s-]+|\band\b/).filter(Boolean)) {
    if (w in ONES) cur += ONES[w];
    else if (w in TENS) cur += TENS[w];
    else if (w === 'hundred') cur = (cur || 1) * 100;
    else if (w in SCALE) { total += (cur || 1) * SCALE[w]; cur = 0; } else return null;
  }
  return total + cur;
}
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const ordWord = `(?:(?:twenty|thirty)[\\s-])?(?:${Object.keys(ORD).join('|')})`;
const ordVal = (s) => { const p = s.toLowerCase().split(/[\s-]+/); return p.length === 2 ? TENS[p[0]] + ORD[p[1]] : ORD[p[0]]; };
function numbers(t) {
  // Number words become digits from 10 up, or before a unit; "one or two" stays as words.
  t = t.replace(new RegExp(`\\b${NUMWORD}(?:[\\s-]+(?:and[\\s-]+)?${NUMWORD})*\\b(\\s*(?:per\\s?cent|percent|%|metres?|meters?|mm|km|kg|hours?|minutes?|days?|weeks?|dollars|pounds|dirhams))?`, 'gi'), (m, unit) => {
    const words = unit ? m.slice(0, m.length - unit.length) : m;
    const n = wordsToNumber(words);
    if (n == null || (n < 10 && !unit) || !/\S/.test(words)) return m;
    return `${n >= 10000 ? n.toLocaleString('en-GB') : n}${unit || ''}`;
  });
  t = t.replace(/(\d)\s*(?:per\s?cent|percent)\b/gi, '$1%');
  // Dates: "the third of October", "October third", "October 3rd" all become "3 October".
  t = t.replace(new RegExp(`\\b(?:the\\s+)?(${ordWord}|\\d{1,2}(?:st|nd|rd|th)?)\\s+of\\s+(${MONTHS})\\b`, 'gi'), (m, d, mo) => `${/^\d/.test(d) ? parseInt(d, 10) : ordVal(d)} ${mo[0].toUpperCase()}${mo.slice(1).toLowerCase()}`);
  t = t.replace(new RegExp(`\\b(${MONTHS})\\s+(?:the\\s+)?(${ordWord}|\\d{1,2}(?:st|nd|rd|th))\\b`, 'gi'), (m, mo, d) => `${/^\d/.test(d) ? parseInt(d, 10) : ordVal(d)} ${mo[0].toUpperCase()}${mo.slice(1).toLowerCase()}`);
  t = t.replace(/\b(\d{1,2})\s*(?:o'clock\s*)?([ap])\.?\s?m\.?(?=\s|$|[,!?])/gi, (m, h, ap) => `${h} ${ap.toLowerCase()}m`);
  return t;
}

function finish(t, lang) {
  t = t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([,.;:!?।؟،])/g, '$1').replace(/([,;:])(?:\s*[,;:])+/g, '$1').replace(/[,;:]+\s*([.!?])/g, '$1').replace(/([.!?])(?:\s*[.,;:!?])+/g, '$1')
    .replace(/([,.;:!?])(?=[\p{L}\p{N}])/gu, (m, p, i, s) => ((/\d/.test(s[i - 1] || '') && /[.,:]/.test(p)) || (p === '.' && /(^|[\s.])\p{L}$/u.test(s.slice(0, i))) ? p : `${p} `))
    .replace(/^[\s,.;:]+/, '').trim();
  if (!t) return t;
  if (latin(t)) {
    t = t.replace(/\bi\b(?=['’]?\w*)/g, 'I').replace(/(^|[.!?]\s+|\n)(\p{Ll})/gu, (m, a, c, i, s) => (/\b(?:\p{L}\.\p{L}|etc|Mr|Mrs|Ms|Dr|St|vs)\.\s+$/u.test(s.slice(0, i + a.length)) ? m : a + c.toUpperCase()));
  }
  // Whisper small ends Hindi sentences with a full stop; Devanagari takes a danda.
  t = t.replace(/([\u0900-\u0963\u0966-\u097f])\.(?=\s|$)/g, '$1।');
  if (!/[.!?।؟…:"'”)]$/.test(t)) t += lang === 'hi' || /[ऀ-ॿ]$/.test(t) ? '।' : lang === 'ar' && /[؀-ۿ]$/.test(t) ? '.' : '.';
  return t;
}

function tidy(raw, { lang = '', replace = [], rules = true } = {}) {
  let t = replaceAll(String(raw || '').replace(/\s+/g, ' ').trim(), replace);
  if (!rules) return t;
  if (latin(t)) t = numbers(fillers(spoken(t)));
  return finish(repeats(t), lang);
}

module.exports = { tidy, replaceAll, wordsToNumber };
