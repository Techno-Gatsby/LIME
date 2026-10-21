import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'src', 'renderer', 'vendor');
const require = createRequire(path.join(ROOT, 'package.json'));
const nodePaths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);

const ENTRY = `
export { default as grapesjs } from 'grapesjs';
export { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, highlightSpecialChars, rectangularSelection, crosshairCursor } from '@codemirror/view';
export { EditorState, EditorSelection, Compartment } from '@codemirror/state';
export { foldGutter, foldKeymap, bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
export { defaultKeymap, indentWithTab } from '@codemirror/commands';
export { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
export { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
export { tags } from '@lezer/highlight';
export { html } from '@codemirror/lang-html';
export { css } from '@codemirror/lang-css';
export { javascript } from '@codemirror/lang-javascript';
export { markdown } from '@codemirror/lang-markdown';
`;

export async function buildWebVendor({ quiet } = {}) {
  const esbuild = require('esbuild');
  fs.mkdirSync(OUT, { recursive: true });
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: 'js' }, nodePaths, bundle: true, format: 'esm', minify: true, target: 'chrome130',
    outfile: path.join(OUT, 'weblibs.js'), legalComments: 'eof', logLevel: quiet ? 'error' : 'warning',
  });
  const grapes = path.dirname(require.resolve('grapesjs/package.json', { paths: [ROOT, ...nodePaths] }));
  fs.copyFileSync(path.join(grapes, 'dist', 'css', 'grapes.min.css'), path.join(OUT, 'grapes.min.css'));
  await buildDiagramVendor({ quiet }).catch((e) => console.warn(`! the whiteboard and diagram libraries weren't built: ${e.message}`));
  return OUT;
}

// Excalidraw and Mermaid share chunks, and only load when a board or a diagram opens. Nothing is fetched from the web:
// Excalidraw's font fallback points back at our own copy, and its translations other than English are left out.
const DIAGRAM_ENTRY = {
  whiteboard: `export { Excalidraw, MainMenu, exportToSvg, exportToBlob, serializeAsJSON, loadFromBlob, restore, getSceneVersion, CaptureUpdateAction } from '@excalidraw/excalidraw';
export { createElement } from 'react';
export { createRoot } from 'react-dom/client';`,
  mermaid: "export { default as mermaid } from 'mermaid';",
};
const offline = {
  name: 'offline',
  setup(b) {
    b.onLoad({ filter: /@excalidraw[\\/]excalidraw[\\/]dist[\\/]prod[\\/].*\.js$/ }, (a) => {
      let s = fs.readFileSync(a.path, 'utf8');
      const i = s.indexOf('`https://esm.sh/'), j = i < 0 ? -1 : s.indexOf('/dist/prod/`', i);
      if (j > 0) s = `${s.slice(0, i)}(window.EXCALIDRAW_ASSET_PATH||"./")${s.slice(j + 12)}`;
      return { contents: s, loader: 'js' };
    });
    b.onResolve({ filter: /locales[\\/]([a-z]{2,3}-[A-Z]{2,3}|ka[ab])-[A-Z0-9]+\.js$/ }, () => ({ path: 'none', namespace: 'nolocale' }));
    b.onLoad({ filter: /.*/, namespace: 'nolocale' }, () => ({ contents: 'export default {}', loader: 'js' }));
  },
};
export async function buildDiagramVendor({ quiet } = {}) {
  const esbuild = require('esbuild'), dest = path.join(OUT, 'diagram'), out = `${dest}.part`;
  const ex = path.dirname(require.resolve('@excalidraw/excalidraw', { paths: [ROOT, ...nodePaths] }));
  fs.rmSync(out, { recursive: true, force: true });
  await esbuild.build({
    entryPoints: Object.keys(DIAGRAM_ENTRY).map((k) => ({ in: `diagram:${k}`, out: k })), nodePaths, bundle: true, format: 'esm', splitting: true, minify: true, target: 'chrome130',
    outdir: out, chunkNames: 'c/[hash]', legalComments: 'eof', logLevel: quiet ? 'error' : 'warning', absWorkingDir: ROOT,
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}' },
    plugins: [offline, { name: 'entries', setup(b) { b.onResolve({ filter: /^diagram:/ }, (a) => ({ path: a.path.slice(8), namespace: 'entry' })); b.onLoad({ filter: /.*/, namespace: 'entry' }, (a) => ({ contents: DIAGRAM_ENTRY[a.path], resolveDir: ROOT, loader: 'js' })); } }],
  });
  fs.copyFileSync(path.join(ex, 'index.css'), path.join(out, 'whiteboard.css'));
  fs.cpSync(path.join(ex, 'fonts'), path.join(out, 'fonts'), { recursive: true, filter: (f) => !/[\\/]Xiaolai([\\/]|$)/.test(f) });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(out, dest);
  return dest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  buildWebVendor().then((d) => console.log(`web editor libraries in ${path.relative(ROOT, d)}`)).catch((e) => { console.warn(`! the web editor libraries weren't built: ${e.message}`); process.exitCode = 0; });
}
