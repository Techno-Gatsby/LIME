// WebCraft's Diagram block: Mermaid text drawn as a picture inside <figure data-mermaid>, so the saved page needs no script.
import { $, h } from './ui.js';
import { renderMermaid } from './mermaid-kit.js';

export const DIAGRAM_START = 'flowchart LR\n  A[Idea] --> B{Worth doing?}\n  B -- Yes --> C[Plan it]\n  B -- No --> D[Park it]';
const b64 = (s) => { const b = new TextEncoder().encode(s); let o = ''; for (let i = 0; i < b.length; i += 0x8000) o += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(o); };
const picture = (svg) => `<img alt="Diagram" src="data:image/svg+xml;base64,${b64(svg)}" style="max-width:100%;height:auto">`;
const LOCK = { selectable: false, hoverable: false, editable: false, draggable: false, droppable: false, copyable: false, layerable: false, removable: false };
const lock = (c) => c.components().forEach((ch) => ch.set(LOCK));

export async function drawInto(c, text) {
  const [r] = await renderMermaid([text]);
  if (r.error) throw new Error(r.error);
  c.addAttributes({ 'data-mermaid': text });
  c.components(picture(r.svg));
  lock(c);
}

export function diagramType(edit) {
  return (ed) => ed.DomComponents.addType('lime-diagram', {
    isComponent: (el) => el.tagName === 'FIGURE' && el.hasAttribute?.('data-mermaid'),
    model: { defaults: { tagName: 'figure', name: 'Diagram', droppable: false, attributes: { class: 'lime-diagram', 'data-mermaid': DIAGRAM_START } }, init() { lock(this); } },
    view: { events: { dblclick: 'onEdit' }, onEdit(e) { e.stopPropagation(); edit(this.model); } },
  });
}

// The text on the left, the drawing on the right as you type.
export function editDiagram(c) {
  return new Promise((resolve) => {
    const start = c.getAttributes()['data-mermaid'] || DIAGRAM_START;
    const s = h(`<div class="scrim"><div class="dialog we-mermaid"><div class="body"><h2>Diagram</h2>
      <p class="muted" style="margin:0 0 10px">Write it in Mermaid: flowcharts, sequences, timelines, pies and more.</p>
      <div class="we-mmgrid"><textarea class="input" spellcheck="false" rows="14"></textarea><div class="we-mmview"></div></div><p class="tip we-mmerr" hidden></p></div>
      <div class="foot"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">Done</button></div></div></div>`);
    const ta = $('textarea', s), viewEl = $('.we-mmview', s), err = $('.we-mmerr', s);
    ta.value = start;
    let t = null, good = null;
    const draw = async () => {
      const [r] = await renderMermaid([ta.value]);
      err.hidden = !r.error;
      err.textContent = r.error ? `Not drawn yet: ${r.error}` : '';
      if (r.svg) { good = ta.value; viewEl.innerHTML = picture(r.svg); }
      $('[data-a=ok]', s).disabled = !!r.error;
    };
    ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 300); });
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); } });
    const done = async (ok) => {
      clearTimeout(t);
      s.remove();
      if (ok && good != null && good !== start) { await drawInto(c, good); resolve(true); } else resolve(false);
    };
    s.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
    s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) done(a === 'ok'); });
    document.body.append(s);
    ta.focus();
    draw();
  });
}
