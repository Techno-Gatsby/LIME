import { icon } from './icons.js';

export const api = window.lime;
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export const nameOf = (p) => String(p || '').split(/[\\/]/).pop();
export const dirOf = (p) => String(p || '').replace(/[\\/][^\\/]*$/, '');
export const extOf = (p) => { const m = /\.([^.\\/]+)$/.exec(p || ''); return m ? m[1].toLowerCase() : ''; };
export const sep = api?.platform === 'win32' ? '\\' : '/';
export const fmtBytes = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
export const clean = (m) => String(m?.message || m || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export async function applyTheme() {
  const [s, info] = await Promise.all([api.invoke('settings:get'), api.invoke('app:info')]);
  const set = (dark) => { document.documentElement.dataset.theme = s.theme === 'system' ? (dark ? 'dark' : 'light') : s.theme; };
  set(info.dark);
  api.on('theme', (t) => set(t.dark));
  api.on('settings', (n) => { s.theme = n.theme; set(matchMedia('(prefers-color-scheme: dark)').matches); });
  document.documentElement.classList.add(`os-${api.platform}`);
  return s;
}
export function toast(msg, { type, actions = [], ms = 4200 } = {}) {
  let host = $('.toasts');
  if (!host) { host = h('<div class="toasts"></div>'); document.body.append(host); }
  const el = h(`<div class="toast ${type || ''}">${type === 'error' ? icon('warning') : type === 'success' ? icon('check') : icon('info')}<span>${esc(msg)}</span>${actions.map((a, i) => `<button class="btn subtle" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`);
  el.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) { actions[b.dataset.i].fn(); el.remove(); } });
  host.append(el);
  setTimeout(() => el.remove(), ms);
}

export function defaultsFor(tool) {
  const o = {};
  for (const opt of tool?.options || []) o[opt.key] = Array.isArray(opt.default) ? [...opt.default] : opt.default;
  return o;
}
export function visible(o, opts) {
  if (!o.when) return true;
  return Object.entries(o.when).every(([k, v]) => (Array.isArray(v) ? v.includes(String(opts[k])) : String(opts[k]) === String(v)));
}
export function missingRequired(tool, opts) {
  return (tool.options || []).find((o) => o.required && visible(o, opts) && (opts[o.key] === '' || opts[o.key] == null));
}
export function form(tool, opts, onChange, ctx = {}) {
  const box = h('<div class="form"></div>');
  const draw = () => {
    box.innerHTML = '';
    const list = (tool.options || []).filter((o) => visible(o, opts));
    const basic = list.filter((o) => !o.advanced), adv = list.filter((o) => o.advanced);
    basic.forEach((o) => box.append(control(o)));
    if (adv.length) {
      const d = h('<details class="more"><summary>More options</summary><div class="form"></div></details>');
      adv.forEach((o) => d.querySelector('.form').append(control(o)));
      d.addEventListener('toggle', () => requestAnimationFrame(fit));
      box.append(d);
    }
    requestAnimationFrame(fit);
  };
  const fit = () => $$('.seg.wide', box).forEach((s) => { if (s.fallback && s.clientWidth && s.scrollWidth > s.clientWidth + 1) s.replaceWith(s.fallback()); });
  const set = (o, v) => {
    opts[o.key] = v;
    onChange?.(opts);
    if ((tool.options || []).some((x) => x.when && Object.keys(x.when).includes(o.key))) draw();
  };
  const control = (o) => {
    const id = `o-${o.key}`;
    const val = opts[o.key];
    if (o.type === 'toggle') {
      const el = h(`<label class="switch"><span>${esc(o.label)}</span><input type="checkbox" id="${id}" ${val ? 'checked' : ''}></label>`);
      $('input', el).addEventListener('change', (e) => set(o, e.target.checked));
      return el;
    }
    const wrap = h(`<div class="field"><label class="label" for="${id}">${esc(o.label)}${o.required ? '' : ''}</label></div>`);
    let el;
    switch (o.type) {
      case 'choice':
        el = h(`<div class="seg wide" role="group">${o.choices.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(val) === String(v)}">${esc(l)}</button>`).join('')}</div>`);
        el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('button', el).forEach((x) => x.setAttribute('aria-pressed', x === b)); set(o, b.dataset.v); });
        el.fallback = () => control({ ...o, type: 'select' }).lastChild;
        break;
      case 'select':
        el = h(`<select class="input" id="${id}">${o.choices.map(([v, l]) => `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
        el.addEventListener('change', (e) => set(o, e.target.value));
        break;
      case 'range': {
        el = h(`<div class="range"><input type="range" id="${id}" min="${o.min}" max="${o.max}" step="${o.step || 1}" value="${esc(val)}"><output>${esc(val)}${o.unit || ''}</output></div>`);
        const r = $('input', el), out = $('output', el);
        const paint = () => r.style.setProperty('--p', `${((r.value - o.min) / (o.max - o.min)) * 100}%`);
        paint();
        r.addEventListener('input', () => { out.textContent = `${r.value}${o.unit || ''}`; paint(); set(o, Number(r.value)); });
        break;
      }
      case 'textarea':
        el = h(`<textarea class="input" id="${id}" placeholder="${esc(o.placeholder || '')}">${esc(val)}</textarea>`);
        el.addEventListener('input', (e) => set(o, e.target.value));
        break;
      case 'color':
        el = h(`<div class="row"><input type="color" id="${id}" value="${esc(val)}"><span class="muted">${esc(val)}</span></div>`);
        $('input', el).addEventListener('input', (e) => { $('span', el).textContent = e.target.value; set(o, e.target.value); });
        break;
      case 'file':
        el = h(`<div class="row"><button class="btn" type="button" id="${id}" value="${esc(val)}">Choose…</button><span class="muted ell">${val ? esc(nameOf(val)) : 'No file chosen'}</span></div>`);
        $('button', el).addEventListener('click', async (e) => { const b = e.currentTarget, [f] = await api.invoke('dialog:open', { multi: false, filters: o.filters }); if (f) { set(o, f); b.value = f; $('span', el).textContent = nameOf(f); } });
        break;
      case 'cells': {
        el = h(`<div class="row"><input class="input" id="${id}" type="text" value="${esc(val)}" placeholder="${esc(o.placeholder || '')}" autocomplete="off" spellcheck="false"><button class="btn" type="button">Choose…</button></div>`);
        const input = $('input', el);
        input.addEventListener('input', (e) => set(o, e.target.value));
        $('button', el).addEventListener('click', async () => {
          ctx.busy?.(true);
          const v = await api.invoke('cells:pick', ctx.files?.[0], input.value).catch(() => null).finally(() => ctx.busy?.(false));
          if (v != null) { input.value = v; set(o, v); }
        });
        break;
      }
      case 'multi':
        el = h(`<div class="chips">${o.choices.map(([v, l]) => `<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${(val || []).includes(v)}">${esc(l)}</button>`).join('')}</div>`);
        el.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          const cur = new Set(opts[o.key] || []);
          cur.has(b.dataset.v) ? cur.delete(b.dataset.v) : cur.add(b.dataset.v);
          b.setAttribute('aria-pressed', cur.has(b.dataset.v));
          set(o, [...cur]);
        });
        break;
      default: {
        const type = o.type === 'password' ? 'password' : o.type === 'number' ? 'number' : 'text';
        el = h(`<input class="input" id="${id}" type="${type}" value="${esc(val)}" placeholder="${esc(o.placeholder || '')}" ${o.min != null ? `min="${o.min}"` : ''} ${o.required ? 'required aria-required="true"' : ''} autocomplete="off" spellcheck="false">`);
        el.addEventListener('input', (e) => set(o, o.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value));
      }
    }
    wrap.append(el);
    return wrap;
  };
  draw();
  return box;
}
