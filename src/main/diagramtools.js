'use strict';
// Whiteboard, draw.io, Mermaid and translation: tools and wheel slices, added to tools.js in one place.
const U = require('./engines/util');
const { fs, fsp, path } = U;
const D = require('./diagrams');
const T = () => require('./engines/translate');

const EXT = { drawio: 'diagram', dio: 'diagram', excalidraw: 'diagram', mmd: 'diagram', mermaid: 'diagram' };
const DRAWIO_IN = ['drawio', 'dio', 'vsdx'], MERMAID_IN = ['mmd', 'mermaid', 'md', 'markdown'], TRANSLATE_IN = ['txt', 'md', 'markdown', 'docx', 'pdf', 'srt', 'vtt'];
const to = (choices, def, extra = {}) => ({ key: 'to', type: 'choice', label: 'Format', choices, default: def, ...extra });
const dataOf = (url) => { const s = String(url || ''), i = s.indexOf(','); return /;base64$/.test(s.slice(0, i)) ? Buffer.from(s.slice(i + 1), 'base64') : Buffer.from(decodeURIComponent(s.slice(i + 1))); };
const safe = (s) => U.sanitize(String(s || '').trim() || 'Page');

function mermaidBlocks(text, ext) {
  if (ext === 'mmd' || ext === 'mermaid') return [text];
  return [...text.matchAll(/^([ \t]*)(```+|~~~+)[ \t]*mermaid\b[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm)].map((m) => m[3].replace(new RegExp(`^${m[1]}`, 'gm'), ''));
}
async function mermaidExport(file, opts, ctx) {
  const format = opts.to === 'png' ? 'png' : 'svg', blocks = mermaidBlocks((await fsp.readFile(file, 'utf8')).replace(/^﻿/, ''), U.ext(file));
  if (!blocks.length) throw new Error(`There are no Mermaid diagrams in ${path.basename(file)}. Lime looks for blocks that start with \`\`\`mermaid.`);
  ctx.progress(0.1, 'Drawing');
  const res = await ctx.host('diagram:mermaid', { blocks });
  if (!res) throw new Error('Diagrams can only be drawn from the wheel.');
  const ok = res.map((r, i) => ({ ...r, i })).filter((r) => r.svg);
  if (!ok.length) throw new Error(`The diagram couldn’t be drawn: ${res[0]?.error || 'unknown error'}`);
  const many = blocks.length > 1, dir = many ? ctx.out.folder(file, `${U.base(file)} - diagrams`) : null, paths = [];
  for (const r of ok) {
    const name = `${U.base(file)}${many ? `-${r.i + 1}` : ''}.${format}`, out = many ? path.join(dir, name) : ctx.out.file(file, name);
    if (format === 'svg') await fsp.writeFile(out, r.svg.startsWith('<?xml') ? r.svg : `<?xml version="1.0" encoding="UTF-8"?>\n${r.svg}`);
    else await require('sharp')(Buffer.from(r.svg), { density: 192 }).flatten({ background: '#ffffff' }).png().toFile(out);
    paths.push(out);
  }
  const bad = res.filter((r) => r.error);
  return many ? { path: dir, note: `${ok.length} diagram${ok.length === 1 ? '' : 's'}${bad.length ? `; ${bad.length} couldn’t be drawn (${bad[0].error})` : ''}` } : { path: paths[0] };
}

async function drawioExport(file, opts, ctx) {
  const format = ['png', 'svg', 'pdf'].includes(opts.to) ? opts.to : 'png', e = U.ext(file);
  ctx.progress(0.05, 'Opening');
  const p = { root: path.join(U.cfg.user, 'helpers'), format: format === 'png' ? 'png' : 'svg', scale: 2, name: path.basename(file) };
  if (e === 'vsdx') p.vsdx = (await fsp.readFile(file)).toString('base64'); else p.xml = (await fsp.readFile(file, 'utf8')).replace(/^﻿/, '');
  const pages = await ctx.host('diagram:drawio', p);
  if (!pages) throw new Error('Diagrams can only be drawn from the wheel.');
  ctx.progress(0.8, 'Saving');
  if (format === 'pdf') {
    const tmp = await U.tmpDir('drawio-pdf');
    try {
      const html = path.join(tmp, 'pages.html');
      const css = pages.map((pg, i) => `@page p${i} { size: ${pg.width}px ${pg.height}px; margin: 0 } .p${i} { page: p${i}; width: ${pg.width}px; height: ${pg.height}px }`).join('\n');
      const body = pages.map((pg, i) => `<div class="pg p${i}">${dataOf(pg.data).toString('utf8').replace(/^<\?xml[^>]*>\s*/, '').replace(/^<!DOCTYPE[^>]*>\s*/i, '')}</div>`).join('');
      await fsp.writeFile(html, `<!doctype html><meta charset="utf-8"><style>${css}\nhtml,body{margin:0}.pg{overflow:hidden;break-after:page}.pg>svg{display:block;width:100%;height:100%}</style>${body}`);
      const out = ctx.out.file(file, `${U.base(file)}.pdf`);
      await ctx.host('htmlToPdf', { file: html, out, css: true });
      return { path: out, note: pages.length > 1 ? `${pages.length} pages` : '' };
    } finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
  }
  if (pages.length === 1) { const out = ctx.out.file(file, `${U.base(file)}.${format}`); await fsp.writeFile(out, dataOf(pages[0].data)); return { path: out }; }
  const dir = ctx.out.folder(file, `${U.base(file)} - pages`);
  pages.forEach((pg, i) => fs.writeFileSync(U.uniquePath(path.join(dir, `${String(i + 1).padStart(2, '0')} ${safe(pg.name)}.${format}`)), dataOf(pg.data)));
  return { path: dir, note: `${pages.length} pages` };
}

function register({ TOOLS, WHEELS, EDITOR_FILE, W, each }) {
  EDITOR_FILE.board = 'vendor/diagram/whiteboard.js';
  const langs = T().LANGS;
  const drawio = D.hasDrawio(), translate = T().available();
  TOOLS.push(
    { id: 'edit-board', cat: 'docs', name: 'Whiteboard', desc: 'Sketch boxes, arrows and notes by hand, and export PNG or SVG with the board inside.', tags: 'excalidraw whiteboard sketch draw diagram hand-drawn', accepts: [], extAccept: ['excalidraw'], max: 1, editor: 'board' },
    { id: 'mermaid-export', cat: 'docs', name: 'Diagrams to SVG or PNG', desc: 'Draws each Mermaid diagram in the file as a picture.', tags: 'mermaid flowchart sequence gantt chart markdown diagram', accepts: [], extAccept: MERMAID_IN, ext: (o) => o.to,
      options: [to([['svg', 'SVG'], ['png', 'PNG']], 'svg')], run: each(mermaidExport) },
  );
  if (drawio) TOOLS.push(
    { id: 'edit-diagram', cat: 'docs', name: 'Edit diagram', desc: 'Flowcharts, org charts and network diagrams in draw.io. Opens Visio files too.', tags: 'drawio draw.io diagrams.net visio vsdx flowchart uml', accepts: [], extAccept: DRAWIO_IN, max: 1, editor: 'drawio' },
    { id: 'diagram-export', cat: 'docs', name: 'Diagram to PNG, SVG or PDF', desc: 'Every page of a draw.io or Visio diagram as a picture or a PDF.', tags: 'drawio draw.io visio vsdx export picture', accepts: [], extAccept: DRAWIO_IN, ext: (o) => o.to,
      options: [to([['png', 'PNG'], ['svg', 'SVG'], ['pdf', 'PDF']], 'png')], run: each(drawioExport) },
  );
  if (translate) TOOLS.push({
    id: 'translate', cat: 'docs', name: 'Translate', desc: 'Into English, German, French, Spanish, Hindi or Arabic, on this computer. Word keeps its formatting; subtitles keep their timings.', tags: 'translation language german french spanish hindi arabic english offline bergamot', accepts: [], extAccept: TRANSLATE_IN,
    ext: (o, files) => (U.ext(files[0] || '') === 'pdf' ? 'txt' : U.ext(files[0] || '') || 'txt'), outName: (files, o) => `${U.base(files[0])}-${o.to}.${U.ext(files[0]) === 'pdf' ? 'txt' : U.ext(files[0])}`,
    options: [{ key: 'to', type: 'select', label: 'Into', choices: langs, default: 'en' }, { key: 'from', type: 'select', label: 'From', choices: [['auto', 'Detect'], ...langs], default: 'auto', advanced: true }],
    run: each((f, o, c) => T().run(f, o, c)),
  });
  // Speech translated and spoken again: the voices Lime reads with, in the languages it translates between.
  if (translate) TOOLS.push({
    id: 'translate-speech', cat: 'media', name: 'Translate speech', desc: 'Hears the speech, translates it and speaks it in another language at the same moments. A video is dubbed, with translated subtitles.', tags: 'dub dubbing voice translate translation speech language interpreter voiceover whisper piper',
    accepts: ['video', 'audio'], ok: (files) => !files.some((f) => ['mid', 'midi'].includes(U.ext(f))), ai: 'whisper', suffix: '-translated', ext: (o, files) => (o.output === 'srt' ? 'srt' : o.output === 'audio' || U.groupOf(files[0] || '') !== 'video' ? 'mp3' : ['mp4', 'm4v', 'mov'].includes(U.ext(files[0] || '')) ? U.ext(files[0]) : 'mkv'),
    options: [{ key: 'to', type: 'select', label: 'Into', choices: require('./engines/voice').VOICES, default: 'en-GB' },
      { key: 'output', type: 'choice', label: 'Give me', choices: [['dub', 'Translated speech'], ['audio', 'Speech only (MP3)'], ['srt', 'Translated subtitles']], default: 'dub' },
      { key: 'original', type: 'choice', label: 'Original voice', choices: [['0.15', 'Quietly underneath'], ['0', 'Removed']], default: '0.15', when: { output: 'dub' } },
      { key: 'from', type: 'select', label: 'Spoken in', choices: [['auto', 'Detect'], ...langs], default: 'auto', advanced: true }],
    run: each((f, o, c) => require('./engines/voice').translateSpeech(f, o, c)),
  });
  const has = (id) => TOOLS.some((t) => t.id === id);
  WHEELS.diagram = {
    convert: [W('diagram-export', 'PNG', 'Picture', { to: 'png' }), W('diagram-export', 'SVG', 'Vector', { to: 'svg' }), W('diagram-export', 'PDF', 'Document', { to: 'pdf' }), W('mermaid-export', 'SVG', 'Mermaid', { to: 'svg' }), W('mermaid-export', 'PNG', 'Mermaid', { to: 'png' })].filter((w) => has(w.tool)),
    tools: [W('edit-board', 'Edit', 'Whiteboard'), W('edit-diagram', 'Edit', 'draw.io')].filter((w) => has(w.tool)),
  };
  if (drawio) WHEELS.vector.tools.push(W('edit-diagram', 'draw.io', 'Visio', {}, { only: ['vsdx'] }), W('diagram-export', 'Pictures', 'Visio', {}, { only: ['vsdx'], ask: true }));
  WHEELS.doc.tools.push(W('mermaid-export', 'Diagrams', 'Mermaid', { to: 'svg' }, { only: ['md', 'markdown'] }));
  if (translate) {
    const tr = W('translate', 'Translate', 'Language', {}, { ask: true });
    WHEELS.doc.tools.splice(2, 0, { ...tr, only: TRANSLATE_IN });
    WHEELS.subtitle.tools.unshift({ ...tr, only: ['srt', 'vtt'] });
    WHEELS.pdf.tools.push(tr);
    // Translate takes the slot of the least-used slice (Speed, Loop): both stay in search and the tool list.
    const swap = (ring, id) => { const i = ring.findIndex((w) => w.tool === id); const w = W('translate-speech', 'Translate', 'Speech', {}, { ask: true }); if (i >= 0) ring.splice(i, 1, w); else ring.push(w); };
    swap(WHEELS.video.tools, 'speed-media');
    swap(WHEELS.audio.tools, 'loop-media');
  }
}

module.exports = { EXT, register, mermaidBlocks };
