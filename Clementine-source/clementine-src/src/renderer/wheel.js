// The quick wheel. One component, three hosts: the app window, the Explorer overlay and the drop dock.
export const GROUPS = ['convert', 'tools', 'actions'];
export const GROUP_NAME = { convert: 'Convert', tools: 'Tools', actions: 'Actions' };
export const KEY_LABEL = { Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt' };

const SIZE = 400, C = 200, R0 = 64, R1 = 184;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function wedge(r0, r1, a0, a1) {
  const p = (r, a) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}

/**
 * createWheel(host, { keys, onPick, onCancel, mode })
 *  keys: { convert:'Shift', tools:'Control', actions:'Alt' }
 *  mode: 'drag' (selection follows the pointer anywhere) or 'click' (only inside the dial)
 */
export function createWheel(host, opts = {}) {
  const keys = opts.keys || { convert: 'Shift', tools: 'Control', actions: 'Alt' };
  const el = document.createElement('div');
  el.className = 'qw';
  el.innerHTML = `<div class="qw-dial"><svg viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true"></svg><div class="qw-center" aria-live="polite"></div></div><div class="qw-tabs" role="tablist"></div>`;
  host.append(el);
  const svg = el.querySelector('svg'), center = el.querySelector('.qw-center'), tabs = el.querySelector('.qw-tabs');
  const st = { groups: { convert: [], tools: [], actions: [] }, group: 'convert', hover: -1, mode: opts.mode || 'click', subtitle: '', busy: null };

  function draw() {
    const items = st.groups[st.group] || [];
    const n = items.length;
    let out = `<circle class="qw-rind" cx="${C}" cy="${C}" r="${R1 + 12}"/><circle class="qw-pith" cx="${C}" cy="${C}" r="${R1 + 4}"/>`;
    if (n) {
      const step = (2 * Math.PI) / n, gap = n > 1 ? 0.045 : 0;
      items.forEach((it, i) => {
        const mid = -Math.PI / 2 + i * step;
        const a0 = mid - step / 2 + gap / 2;
        const a1 = Math.min(a0 + step - gap, a0 + 2 * Math.PI - 0.002);
        const lr = (R0 + R1) / 2 + 6;
        const x = C + lr * Math.cos(mid), y = C + lr * Math.sin(mid);
        out += `<g class="qw-seg${i === st.hover ? ' hot' : ''}" data-i="${i}"><path d="${wedge(R0, R1, a0, a1)}"/><text class="l" x="${x.toFixed(1)}" y="${(y - 2).toFixed(1)}">${esc(it.label)}</text><text class="h" x="${x.toFixed(1)}" y="${(y + 13).toFixed(1)}">${esc(it.hint || '')}</text></g>`;
      });
    }
    out += `<circle class="qw-core" cx="${C}" cy="${C}" r="${R0 - 6}"/>`;
    svg.innerHTML = out;
    svg.classList.toggle('dense', n > 8);
    tabs.innerHTML = GROUPS.map((g) => `<button type="button" role="tab" data-g="${g}" aria-selected="${g === st.group}"><kbd>${KEY_LABEL[keys[g]] || keys[g]}</kbd>${GROUP_NAME[g]}</button>`).join('');
    drawCenter();
  }
  function drawCenter() {
    const items = st.groups[st.group] || [];
    const it = items[st.hover];
    if (st.busy) { center.innerHTML = `<div class="g">${esc(st.busy.label)}</div><div class="o">${Math.round((st.busy.progress || 0) * 100)}%</div>`; return; }
    if (!items.length) center.innerHTML = `<div class="g">${GROUP_NAME[st.group]}</div><div class="none">Nothing here for this file. Try another key.</div>`;
    else if (it) center.innerHTML = `<div class="g">${GROUP_NAME[st.group]}</div><div class="o">${esc(it.label)}</div><div class="n">${esc(it.hint || '')}</div>`;
    else center.innerHTML = `<div class="g">${GROUP_NAME[st.group]}</div><div class="none">${esc(opts.centerHint || (st.mode === 'drag' ? 'Drop here to cancel' : 'Pick a slice'))}</div>${st.subtitle ? `<div class="n" title="${esc(st.subtitle)}">${esc(st.subtitle.length > 20 ? `${st.subtitle.slice(0, 18)}…` : st.subtitle)}</div>` : ''}`;
  }
  function setHover(i) {
    if (i === st.hover) return;
    st.hover = i;
    svg.querySelectorAll('.qw-seg').forEach((g, k) => g.classList.toggle('hot', k === i));
    drawCenter();
  }
  function hoverAt(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    const scale = r.width / SIZE;
    const dx = (clientX - (r.left + r.width / 2)) / scale, dy = (clientY - (r.top + r.height / 2)) / scale;
    const d = Math.hypot(dx, dy);
    const n = (st.groups[st.group] || []).length;
    if (st.mode === 'click' && d > R1 + 18) return;
    if (!n || d < R0 - 4) { setHover(-1); return; }
    const step = (2 * Math.PI) / n;
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    setHover(Math.round(a / step) % n);
  }
  function setGroup(g) {
    if (!GROUPS.includes(g)) return;
    st.group = g;
    st.hover = st.mode === 'click' && (st.groups[g] || []).length ? 0 : -1;
    draw();
  }
  const current = () => (st.groups[st.group] || [])[st.hover] || null;
  function pick() { const it = current(); if (it) opts.onPick?.(it, st.group); return it; }
  function groupForEvent(e) {
    for (const g of GROUPS) {
      const k = keys[g];
      if ((k === 'Shift' && e.shiftKey) || (k === 'Control' && (e.ctrlKey || e.metaKey)) || (k === 'Alt' && e.altKey)) return g;
    }
    return null;
  }
  function onKey(e) {
    const n = (st.groups[st.group] || []).length;
    const keyGroup = GROUPS.find((g) => keys[g] === e.key || (keys[g] === 'Control' && e.key === 'Meta'));
    if (keyGroup) { e.preventDefault(); if (keyGroup !== st.group) setGroup(keyGroup); return true; }
    if (e.key === 'Escape') { e.preventDefault(); opts.onCancel?.(); return true; }
    if (e.key === 'Tab') { e.preventDefault(); setGroup(GROUPS[(GROUPS.indexOf(st.group) + (e.shiftKey ? 2 : 1)) % 3]); return true; }
    if (n && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) { e.preventDefault(); setHover((st.hover + 1 + n) % n); return true; }
    if (n && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) { e.preventDefault(); setHover((st.hover - 1 + n) % n); return true; }
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) { setHover(Number(e.key) - 1); pick(); return true; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); return true; }
    return false;
  }
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-g]'); if (b) { e.stopPropagation(); setGroup(b.dataset.g); } });
  svg.addEventListener('pointermove', (e) => { if (st.mode === 'click') hoverAt(e.clientX, e.clientY); });
  svg.addEventListener('click', (e) => { if (st.mode !== 'click') return; hoverAt(e.clientX, e.clientY); if (st.hover >= 0) pick(); else opts.onCancel?.(); });

  return {
    el,
    setItems(groups) { st.groups = { convert: [], tools: [], actions: [], ...groups }; setGroup(st.group); },
    setGroup, setHover, hoverAt, pick, current, onKey, groupForEvent,
    setMode(m) { st.mode = m; el.classList.toggle('qw-drag', m === 'drag'); },
    setSubtitle(s) { st.subtitle = s; drawCenter(); },
    setBusy(b) { st.busy = b; drawCenter(); el.classList.toggle('busy', !!b); },
    get group() { return st.group; },
    get hover() { return st.hover; },
    destroy() { el.remove(); },
  };
}
