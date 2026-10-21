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
  return OUT;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  buildWebVendor().then((d) => console.log(`web editor libraries in ${path.relative(ROOT, d)}`)).catch((e) => { console.warn(`! the web editor libraries weren't built: ${e.message}`); process.exitCode = 0; });
}
