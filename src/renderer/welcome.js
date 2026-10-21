import { icon } from './icons.js';
import { limeSvg, wedge, labelAt } from './petal.js';
import { api, $, applyTheme } from './ui.js';

await applyTheme();
const isMac = api.platform === 'darwin';
if (!isMac) document.body.classList.add('solid');
const d = (name) => /d="([^"]+)"/.exec(icon(name))[1];
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const glyph = (name, x, y, k = 1, cls = '') => `<g class="${cls}" transform="translate(${x} ${y}) scale(${k})"><path d="${d(name)}" ${stroke}/></g>`;
const ring = (cx, cy, n, rIn, rOut, lit = -1) => Array.from({ length: n }, (_, i) => `<path d="${wedge(i, n, rIn, rOut, 4, 6, 4)}" transform="translate(${cx} ${cy})" fill="${i === lit ? 'var(--accent)' : 'var(--surface)'}" fill-opacity="${i === lit ? 0.9 : 1}" stroke="var(--line-2)" stroke-width=".6"/>`).join('');
const svg = (inner) => `<svg viewBox="0 0 240 104" aria-hidden="true">${inner}</svg>`;

const APP_ICONS = ['image', 'sparkle', 'pen', 'layers', 'eye', 'video', 'pdf'];
const PICS = [
  `${svg(`<rect x="214" y="-4" width="40" height="112" fill="var(--surface-3)"/><line x1="214" y1="0" x2="214" y2="104" stroke="var(--line-2)"/>
    ${glyph('doc', 42, 28, 2, 'accent')}
    <path d="M96 52C130 52 150 50 196 50" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="4 5" stroke-linecap="round"/><path d="M190 44l8 6-8 6" ${stroke}/>`)}${limeSvg(52, 'edge')}`,
  `${svg(`${ring(176, 52, 8, 13, 40, 5)}
    ${glyph('doc', 60, 46, 1.4, 'faint')}${glyph('cursor', 44, 26, 1.8)}
    <rect x="18" y="68" width="60" height="24" rx="6" fill="var(--surface)" stroke="var(--line-2)" stroke-width=".8"/><text x="48" y="84" text-anchor="middle">⇧ Shift</text>
    <path d="M118 36c8-12 20-18 32-20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 4" stroke-linecap="round"/>`)}`,
  `${svg(`${ring(120, 52, 7, 21, 48)}${APP_ICONS.map((n, i) => { const [x, y] = labelAt(i, 7, 34.5); return glyph(n, 120 + x - 7, 52 + y - 7, 0.58, 'accent'); }).join('')}`)}${limeSvg(52, 'mid')}`,
  `${svg(`${glyph('gear', 22, 24, 2.3, 'faint')}
    ${[['Ask where to save', 24, true], ['Sounds', 52, true], ['LibreOffice helper', 80, false]].map(([label, y, on]) => `<text x="92" y="${y + 4}">${label}</text><rect x="196" y="${y - 7}" width="30" height="16" rx="8" fill="${on ? 'var(--green-2)' : 'var(--surface-3)'}"/><circle cx="${on ? 218 : 204}" cy="${y + 1}" r="6" fill="#fff"/>`).join('')}`)}`,
];
const STEPS = [
  ['Drop a file on the lime', 'The lime waits at the right edge of the screen. Drag any file onto it and a wheel opens with everything that file can become.'],
  ['Hold Shift while you drag', 'The wheel comes to your pointer, wherever you are, and follows along. Drop the file on a slice to convert it in one go.'],
  ['Click the lime for the seven apps', 'PhotoCraft, LightCraft, VectorCraft, DesignCraft, EffectCraft, FilmCraft and PdfCraft: open the full app, or run its tools and editors right here.'],
  ['Settings', `Where results are saved, sounds, and the optional helpers (LibreOffice, Pandoc) for exact Office layouts. It’s under the lime in the ${isMac ? 'menu bar' : 'tray'}.`],
];

$('#app').innerHTML = `
  <header>${limeSvg(52)}<div><h1>Welcome to Lime</h1><p>A small wheel that turns your files into other files, right on this ${isMac ? 'Mac' : 'PC'}. Nothing is uploaded.</p></div></header>
  <ol class="steps">${STEPS.map(([title, text], i) => `<li><div class="pic">${PICS[i]}</div><div class="t"><b><span class="n">${i + 1}</span>${title}</b><p>${text}</p></div></li>`).join('')}</ol>
  <footer><span class="faint">Find this again under <b>How Lime works</b> in the menu.</span><div class="grow"></div><button class="btn" data-a="prefs">Open Settings…</button><button class="btn primary lg" data-a="ok">Got it</button></footer>`;
Object.assign($('.lime.edge').style, { width: '44px', height: '44px', left: 'calc(50% + 72px)', top: '30px' });
Object.assign($('.lime.mid').style, { width: '30px', height: '30px', left: 'calc(50% - 15px)', top: '37px' });

const done = () => api.invoke('welcome:done');
$('[data-a=ok]').addEventListener('click', done);
$('[data-a=prefs]').addEventListener('click', () => { api.invoke('prefs:open'); done(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') done(); });
$('[data-a=ok]').focus();
