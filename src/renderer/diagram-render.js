// Hidden page that draws Mermaid diagrams for the wheel. Labels are plain SVG text, so the pictures also convert to PNG and PDF.
import { renderMermaid } from './mermaid-kit.js';

window.renderMermaid = renderMermaid;
