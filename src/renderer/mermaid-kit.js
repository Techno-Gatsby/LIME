// Mermaid, loaded only when a diagram is drawn. Shared by the wheel's diagram tool and WebCraft's Diagram block.
let lib = null;
const FONT = '-apple-system, "Segoe UI", system-ui, Roboto, Helvetica, Arial, sans-serif';
async function mermaid(theme) {
  const { mermaid: m } = await (lib ||= import('./vendor/diagram/mermaid.js'));
  m.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: FONT, htmlLabels: false, flowchart: { htmlLabels: false }, class: { htmlLabels: false }, state: { htmlLabels: false } });
  return m;
}
let seq = 0;
export async function renderMermaid(blocks, theme = 'default') {
  const m = await mermaid(theme), out = [];
  for (const text of blocks) {
    const id = `lime-mermaid-${Date.now().toString(36)}-${++seq}`;
    try {
      const { svg } = await m.render(id, String(text));
      out.push({ svg });
    } catch (e) {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      out.push({ error: String(e?.message || e).split('\n')[0] });
    }
  }
  return out;
}
