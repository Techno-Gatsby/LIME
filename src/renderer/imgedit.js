import { $, $$, esc, h, nameOf, dirOf, sep } from './ui.js';

// The image editor. Light, colour, crop, healing and the rest are LightCraft develop settings rendered by the
// worker (imgedit.js there), so what is shown is a screen-sized rendering of exactly what Save writes. Text and
// shapes are drawn here, on a canvas, the same way for the screen and for the saved file.
const TOOLS = [
  ['adjust', 'sliders', 'Adjust', 'Light, colour, detail and effects. Double-click a slider’s name to reset it.'],
  ['looks', 'looks', 'Looks', 'Pick a look; the amount slider sets how strong it is.'],
  ['enhance', 'wand', 'Enhance', 'One-click fixes from LightCraft, PhotoCraft and Lime. Each is a step you can undo.'],
  ['crop', 'crop', 'Crop', 'Drag the corners or edges, or drag outside the frame to straighten.'],
  ['resize', 'resize', 'Resize', 'Set the size in pixels or percent, or the canvas around the image.'],
  ['heal', 'heal', 'Heal', 'Click a spot, or brush over a blemish or wire, to remove it.'],
  ['redeye', 'pupil', 'Red eye', 'Click the middle of each red eye.'],
  ['mask', 'mask', 'Masks', 'Light and colour in one part of the photo: drag a gradient or paint where it should go.'],
  ['text', 'textT', 'Text', 'Click where you want to type.'],
  ['draw', 'pen', 'Draw', 'Draw freehand with the mouse, pen or finger.'],
  ['rect', 'square', 'Box', 'Drag to draw a rectangle. Hold Shift for a square.'],
  ['ellipse', 'circle', 'Oval', 'Drag to draw an oval. Hold Shift for a circle.'],
  ['arrow', 'arrow', 'Arrow', 'Drag to draw an arrow.'],
  ['line', 'line', 'Line', 'Drag to draw a line. Hold Shift for straight angles.'],
];
const GROUPS = [['Develop', ['adjust', 'looks', 'enhance']], ['Frame', ['crop', 'resize']], ['Retouch', ['heal', 'redeye', 'mask']], ['Mark up', ['text', 'draw', 'rect', 'ellipse', 'arrow', 'line']]];
const MARKUP = new Set(['text', 'draw', 'rect', 'ellipse', 'arrow', 'line']);
const KEYS = { c: 'crop', j: 'heal', t: 'text', p: 'draw', r: 'rect', o: 'ellipse', a: 'arrow', l: 'line', e: 'redeye', m: 'mask', d: 'adjust' };
const COLORS = ['#ffffff', '#000000', '#d13438', '#ff8c00', '#ffd400', '#2fb344', '#0f6cbd', '#8a3ffc', '#ff4fa3'];
const FONTS = [['sans', 'Noto Sans', '"Noto Sans",Arial,sans-serif'], ['serif', 'Noto Serif', '"Noto Serif",Georgia,serif'], ['mono', 'Noto Sans Mono', '"Noto Sans Mono",Consolas,monospace'],
  ['carlito', 'Carlito', 'Carlito,Calibri,sans-serif'], ['caveat', 'Caveat (handwriting)', 'Caveat,cursive'], ['dancing', 'Dancing Script', '"Dancing Script",cursive']];
const fontCss = (f) => (String(f).startsWith('sys:') ? `"${String(f).slice(4).replace(/["\\]/g, '')}","Noto Sans",sans-serif` : (FONTS.find((x) => x[0] === f) || FONTS[0])[2]);
const ASPECTS = [['free', 'Free'], ['orig', 'Original'], ['1:1', '1:1'], ['4:5', '4:5'], ['3:2', '3:2'], ['4:3', '4:3'], ['16:9', '16:9'], ['5:7', '5:7'], ['2:1', '2:1']];
// The camera's orientation tag as a turn (quarter turns clockwise) after an optional mirror.
const ORIENT = { Normal: [0, 0], FlipH: [0, 1], Rotate180: [2, 0], FlipV: [2, 1], Rotate90: [1, 0], Rotate270: [3, 0], Transverse: [1, 1], Transpose: [3, 1] };
const orientName = (rot, flip) => Object.keys(ORIENT).find((k) => ORIENT[k][0] === rot && ORIENT[k][1] === flip) || 'Normal';
const HUES = [['red', '#e8453c'], ['orange', '#f08a24'], ['yellow', '#f2d230'], ['green', '#4cb84c'], ['aqua', '#2ec4c4'], ['blue', '#3d7be8'], ['purple', '#8a5ce6'], ['magenta', '#d64fc0']];
const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const getPath = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((x, k) => (x[k] ??= {}), o)[last] = v; };
const signed = (n, d = 0) => `${n > 0 ? '+' : ''}${Number(n).toFixed(d)}`;
const plain = (msg) => String(msg?.message || msg || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// Lightroom's basic panel and the rest, as LightCraft develop controls.
const TEMP = { key: 'temp', label: 'Temp', min: -100, max: 100, step: 1, mid: true, track: 'linear-gradient(90deg,#3d7be8,#e9e2c8,#f2c230)' };
const TINT = { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, mid: true, track: 'linear-gradient(90deg,#3fae4a,#e6e1e6,#d64fc0)' };
const S = (key, label, min = -100, max = 100, step = 1, more = {}) => ({ key, label, min, max, step, mid: min < 0, ...more });
const PANELS = [
  ['Light', [S('light.exposure', 'Exposure', -5, 5, 0.01, { fmt: (v) => signed(v, 2) }), S('light.contrast', 'Contrast'), S('light.highlights', 'Highlights'), S('light.shadows', 'Shadows'), S('light.whites', 'Whites'), S('light.blacks', 'Blacks')]],
  ['Colour', [TEMP, TINT, S('color.vibrance', 'Vibrance'), S('color.saturation', 'Saturation')]],
  ['Presence', [S('effects.texture', 'Texture'), S('effects.clarity', 'Clarity'), S('effects.dehaze', 'Dehaze')]],
  ['Curve', [S('curve.highlights', 'Highlights'), S('curve.lights', 'Lights'), S('curve.darks', 'Darks'), S('curve.shadows', 'Shadows')]],
  ['Colour mixer', []],
  ['Colour grading', []],
  ['Detail', [S('detail.sharpen_amount', 'Sharpening', 0, 150), S('detail.sharpen_radius', 'Radius', 0.5, 3, 0.1, { fmt: (v) => Number(v).toFixed(1) }), S('detail.nr_luminance', 'Noise', 0, 100), S('detail.nr_color', 'Colour noise', 0, 100)]],
  ['Effects', [S('vignette.amount', 'Vignette'), S('vignette.midpoint', 'Midpoint', 0, 100), S('vignette.feather', 'Feather', 0, 100), S('grain.amount', 'Grain', 0, 100), S('grain.size', 'Grain size', 0, 100), S('grain.roughness', 'Roughness', 0, 100)]],
  ['Optics', [S('optics.distortion', 'Distortion'), S('optics.vignetting', 'Vignetting')]],
];
const DEFAULTS = { 'mask.amount': 100, 'mask.feather': 50, 'detail.sharpen_radius': 1, 'detail.nr_detail': 50, 'vignette.midpoint': 50, 'vignette.feather': 50, 'grain.size': 25, 'grain.roughness': 50, 'grading.blending': 50, 'profile.amount': 100 };
const RAINBOW = 'linear-gradient(90deg,#e8453c,#f2d230,#4cb84c,#2ec4c4,#3d7be8,#d64fc0,#e8453c)';

const ENHANCE = [
  ['LightCraft', [['auto', 'develop', 'sparkle', 'Auto settings', 'Sets light and colour for this photo; the sliders show what it did.'], ['bw', 'develop', 'looks', 'Smart B&W', 'Black and white mixed from the photo’s own colours.'],
    ['straighten', 'develop', 'level', 'Auto straighten', 'Levels a tilted horizon and crops the edges.'], ['dust', 'develop', 'heal', 'Remove dust', 'Finds sensor-dust spots and heals them.'],
    ['upright', 'develop', 'grid', 'Auto perspective', 'Upright: straightens leaning buildings and lines.']]],
  ['PhotoCraft', [['autoTone', 'step', 'sun', 'Auto tone', 'Fixes dull, flat or colour-cast photos.'], ['autoContrast', 'step', 'sun', 'Auto contrast', 'Stretches the darkest and lightest tones.'], ['autoColor', 'step', 'sun', 'Auto colour', 'Neutralises a colour cast.'],
    ['sharpen', 'step', 'sparkle', 'Smart sharpen', 'Brings back crisp detail.'], ['denoise', 'step', 'sparkle', 'Reduce noise', 'Removes grain and JPEG blocks.'], ['shadows', 'step', 'sun', 'Lift shadows', 'Brightens dark areas and keeps the sky.']]],
  ['Lime', [['removeBg', 'step', 'image', 'Remove background', 'Cuts out the subject, on this computer.'], ['blurFaces', 'step', 'eye', 'Blur faces', 'Finds faces and blurs them.'], ['upscale', 'step', 'resize', 'Upscale 2×', 'Doubles the size with sharp detail.']]],
];
const PAINT = [['oil', 'Oil paint'], ['watercolor', 'Watercolour'], ['poster', 'Poster'], ['ink', 'Ink outlines'], ['pencil', 'Coloured pencil'], ['sketch', 'Graphic pen'], ['glow', 'Diffuse glow'], ['tiltShift', 'Tilt-shift']];
const BUSY = { autoTone: 'Balancing tones', autoContrast: 'Stretching contrast', autoColor: 'Correcting colour', sharpen: 'Sharpening', denoise: 'Reducing noise', shadows: 'Lifting shadows', removeBg: 'Removing the background', blurFaces: 'Finding faces', upscale: 'Upscaling', auto: 'Working out settings', bw: 'Mixing black and white', straighten: 'Levelling', dust: 'Finding dust spots', upright: 'Straightening lines' };

export function openEditor(view, { file }, ctx) {
  const { icon, toast, api, go } = ctx;
  ctx.onClose?.(close);
  const call = (m, ...a) => api.invoke('edit:call', 'image', m, ...a);
  if (!document.querySelector('link[href="imgedit.css"]')) document.head.append(h('<link rel="stylesheet" href="imgedit.css">'));
  const st = {
    sess: null, base: 0, dims: [], dev: null, output: { resize: null, canvas: null }, overlays: [],
    hist: [], at: -1, savedKey: '', savePath: null, saveFmt: null,
    tool: 'adjust', zoom: 'fit', sel: null, spotSel: -1, eyeSel: -1, busy: false, before: false, look: null, mixer: 'red',
    style: { font: 'sans', size: 0.06, color: '#ffffff', bold: true, italic: false, align: 'left', textStyle: 'shadow', bg: '#000000', opacity: 1, stroke: '#d13438', width: 0.006, fill: 'none' },
    heal: { mode: 'remove', size: 0.02, feather: 50, opacity: 100 }, eye: { size: 0.025, pupil: 50, darken: 50 },
    maskSel: -1, maskNew: 'linear', paint: { size: 0.04, feather: 50, flow: 100, erase: false },
    seq: 0, fonts: [], looks: null, thumbs: new Map(),
  };
  const root = h(`<div class="editor imged">
    <header class="ed-head">
      <div class="topbar">
        <button class="tb icon" data-a="close" title="Close">${icon('back')}</button>
        <div class="doc">${icon('image')}<b title="${esc(file)}">${esc(nameOf(file))}</b><span class="dirty" hidden>Unsaved</span></div>
        <div class="seg"><button class="tb icon" data-a="undo" title="Undo (Ctrl+Z)">${icon('undo')}</button><button class="tb icon" data-a="redo" title="Redo (Ctrl+Y)">${icon('redo')}</button><button class="tb icon" data-a="history" title="History">${icon('clock')}</button></div>
        <div class="grow"></div>
        <button class="tb compare" data-a="compare" title="Before and after: hold to see the original (or hold \\)">${icon('compare', 'sm')}<span class="lbl">Before</span></button>
        <div class="seg zoombar"><button class="tb icon" data-a="zoomout" title="Zoom out (Ctrl −)">${icon('zoomOut', 'sm')}</button><select class="zoom" title="Zoom" aria-label="Zoom"></select><button class="tb icon" data-a="zoomin" title="Zoom in (Ctrl +)">${icon('zoomIn', 'sm')}</button><button class="tb icon" data-a="fit" title="Fit (Ctrl 0)">${icon('fit', 'sm')}</button></div>
        <button class="btn" data-a="saveas">Save as…</button>
        <button class="btn primary" data-a="save">${icon('save', 'sm')}Save</button>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Tools">
        ${GROUPS.map(([name, ids], gi) => `<div class="tgroup${gi > 1 ? ' opt' : ''}" role="group" aria-label="${name}">${ids.map((id) => {
    const [, ic, label, tip] = TOOLS.find((x) => x[0] === id);
    return `<button class="tool" data-tool="${id}" aria-pressed="false" title="${esc(`${label}: ${tip}`)}">${icon(ic)}<span class="lbl">${label}</span></button>`;
  }).join('')}</div>`).join('')}
      </div>
    </header>
    <div class="ed-body">
      <section class="stage" tabindex="-1"><div class="pad"><div class="sheet"><div class="loading">Opening…</div></div></div></section>
      <aside class="props" aria-label="Properties"></aside>
    </div>
    <div class="ed-status" hidden></div>
  </div>`);
  view.append(root);
  const stage = $('.stage', root), sheet = $('.sheet', root), props = $('.props', root), status = $('.ed-status', root);
  let disposed = false;
  const photo = h('<img class="photo" alt="" draggable="false">');
  const ink = h('<canvas class="ink"></canvas>');
  const marks = h('<div class="marks"></div>');

  // ── Geometry ────────────────────────────────────────────────────────────────────────────────────────────────
  // The frame is the image after rotation and mirroring; straightening turns the picture inside it about the
  // middle, and the crop is a rectangle in that frame (fractions of its width and height), as LightCraft has it.
  const dimsOf = () => st.dims[st.base] || { w: 1, h: 1 };
  const swapped = () => ORIENT[st.dev.orientation]?.[0] % 2 === 1;
  const frame = () => { const d = dimsOf(); return swapped() ? [d.h, d.w] : [d.w, d.h]; };
  const L = () => Math.max(...frame());
  const geo = () => st.dev.crop.geometry;
  const outSize = () => { const [W, H] = frame(), r = geo().rect; return [Math.max(1, Math.round((r.x1 - r.x0) * W)), Math.max(1, Math.round((r.y1 - r.y0) * H))]; };
  const finalSize = () => {
    const [w, h0] = outSize(), r = st.output.resize, c = st.output.canvas;
    let rw = w, rh = h0;
    if (r) { rw = Math.max(1, Math.round(r.w)); rh = Math.max(1, Math.round(r.lock ? r.w * h0 / w : r.h)); }
    return c ? [Math.round(c.w), Math.round(c.h), rw, rh] : [rw, rh, rw, rh];
  };
  const rot = (x, y, a, cx, cy) => { const c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy; return [cx + c * dx - s * dy, cy + s * dx + c * dy]; };
  const rad = () => (geo().angle * Math.PI) / 180;
  // Whether a crop (in frame pixels) lies wholly on the turned picture.
  function inside(x0, y0, x1, y1, a = rad()) {
    const [W, H] = frame(), e = 1e-6 * Math.max(W, H);
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].every(([x, y]) => { const [u, v] = rot(x, y, -a, W / 2, H / 2); return u >= -e && v >= -e && u <= W + e && v <= H + e; });
  }
  const toPx = (r) => { const [W, H] = frame(); return [r.x0 * W, r.y0 * H, r.x1 * W, r.y1 * H]; };
  const toRect = ([x0, y0, x1, y1]) => { const [W, H] = frame(); return { x0: x0 / W, y0: y0 / H, x1: x1 / W, y1: y1 / H }; };
  // Moves a crop towards the middle, then shrinks it, until it fits the turned picture (LightCraft's own rule).
  function fitCrop(r, a = rad()) {
    const [W, H] = frame();
    let [x0, y0, x1, y1] = toPx(r);
    const w = x1 - x0, hh = y1 - y0;
    if (inside(x0, y0, x1, y1, a)) return r;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (let i = 1; i <= 32; i++) {
      const t = i / 32, nx = cx + (W / 2 - cx) * t, ny = cy + (H / 2 - cy) * t;
      if (inside(nx - w / 2, ny - hh / 2, nx + w / 2, ny + hh / 2, a)) return toRect([nx - w / 2, ny - hh / 2, nx + w / 2, ny + hh / 2]);
    }
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (inside(W / 2 - w * m / 2, H / 2 - hh * m / 2, W / 2 + w * m / 2, H / 2 + hh * m / 2, a)) lo = m; else hi = m; }
    [x0, y0, x1, y1] = [W / 2 - w * lo / 2, H / 2 - hh * lo / 2, W / 2 + w * lo / 2, H / 2 + hh * lo / 2];
    return toRect([x0, y0, x1, y1]);
  }
  // The largest crop of a shape (width ÷ height in pixels) centred on the picture.
  function largest(ratio) {
    const [W, H] = frame();
    let w = W, hh = W / ratio;
    if (hh > H) { hh = H; w = H * ratio; }
    return fitCrop(toRect([(W - w) / 2, (H - hh) / 2, (W + w) / 2, (H + hh) / 2]));
  }
  // Points LightCraft keeps for spots and red eye are fractions of the turned image before straightening.
  function normFromOut(ox, oy) {
    const [W, H] = frame(), r = geo().rect, [u, v] = rot(r.x0 * W + ox, r.y0 * H + oy, -rad(), W / 2, H / 2);
    return [u / W, v / H];
  }
  function outFromNorm(u, v) {
    const [W, H] = frame(), r = geo().rect, [x, y] = rot(u * W, v * H, rad(), W / 2, H / 2);
    return [x - r.x0 * W, y - r.y0 * H];
  }
  // Text and shapes are kept in the frame, in units of its long edge, so they stay with the picture when the crop
  // changes and keep their size when it is upscaled.
  const outFromL = (x, y) => { const [W, H] = frame(), r = geo().rect, l = L(); return [x * l - r.x0 * W, y * l - r.y0 * H]; };
  const lFromOut = (ox, oy) => { const [W, H] = frame(), r = geo().rect, l = L(); return [(ox + r.x0 * W) / l, (oy + r.y0 * H) / l]; };

  // ── Edit state and history ──────────────────────────────────────────────────────────────────────────────────
  const editState = () => ({ base: st.base, dev: st.dev, output: effectiveOutput() });
  const snap = () => clone({ base: st.base, dev: st.dev, output: st.output, overlays: st.overlays.map(strip) });
  const strip = (o) => { const { _b, ...rest } = o; return rest; };
  const keyOf = (s) => JSON.stringify(s);
  function commit(label) {
    const s = snap();
    if (st.at >= 0 && keyOf(st.hist[st.at].state) === keyOf(s)) return;
    st.hist = st.hist.slice(0, st.at + 1);
    st.hist.push({ label, state: s });
    st.at = st.hist.length - 1;
    // Making another change ends the look being tried, so the next look starts from here.
    if (label !== 'Look') st.look = null;
    chrome();
  }
  function restore(i) {
    if (i < 0 || i >= st.hist.length) return;
    st.at = i;
    const s = clone(st.hist[i].state);
    Object.assign(st, { base: s.base, dev: s.dev, output: s.output, overlays: s.overlays, sel: null, spotSel: -1, eyeSel: -1, look: null, maskSel: Math.min(st.maskSel, (s.dev.masks || []).length - 1) });
    endText(true);
    layout();
    renderProps();
    chrome();
  }
  const undo = () => { if (editing) { endText(); return; } restore(st.at - 1); };
  const redo = () => restore(st.at + 1);
  function chrome() {
    const dirty = st.sess && keyOf(snap()) !== st.savedKey;
    $('.dirty', root).hidden = !dirty;
    $('[data-a=undo]', root).disabled = st.at <= 0;
    $('[data-a=redo]', root).disabled = st.at >= st.hist.length - 1;
    $('[data-a=undo]', root).title = st.at > 0 ? `Undo ${st.hist[st.at].label} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
    $('[data-a=redo]', root).title = st.at < st.hist.length - 1 ? `Redo ${st.hist[st.at + 1].label} (Ctrl+Y)` : 'Redo (Ctrl+Y)';
  }
  function effectiveOutput() {
    const o = clone(st.output), [w, hh] = outSize();
    if (o.resize) o.resize = { w: Math.round(o.resize.w), h: Math.round(o.resize.lock ? o.resize.w * hh / w : o.resize.h) };
    return o;
  }

  // ── Opening ─────────────────────────────────────────────────────────────────────────────────────────────────
  async function load() {
    try {
      st.sess = await call('open', file);
    } catch (e) {
      toast(plain(e), { type: 'error' });
      go();
      return;
    }
    if (disposed) { call('close', st.sess.id).catch(() => {}); return; }
    st.dims[0] = { w: st.sess.w, h: st.sess.h, alpha: st.sess.alpha };
    st.dev = st.sess.dev;
    st.dev.spots ||= []; st.dev.red_eye ||= []; st.dev.masks ||= [];
    st.style.size = 0.06; st.style.width = 0.006;
    sheet.innerHTML = '';
    sheet.append(photo, ink, marks);
    st.hist = [{ label: 'Open', state: snap() }];
    st.at = 0;
    st.savedKey = keyOf(snap());
    selectTool('adjust');
    layout();
    await refresh();
    chrome();
    if (st.sess.note) toast(st.sess.note);
    api.invoke('editor:call', 'fonts').then((list) => { st.fonts = list || []; if (MARKUP.has(st.tool)) renderProps(); }).catch(() => {});
  }

  // ── Preview ─────────────────────────────────────────────────────────────────────────────────────────────────
  const dpr = () => window.devicePixelRatio || 1;
  let kd = 1; // CSS pixels per pixel of the cropped image (or of the frame while cropping)
  const viewMode = () => (st.before ? 'before' : st.tool === 'crop' ? 'frame' : 'normal');
  function previewSize(mode, draft) {
    const [W, H] = mode === 'frame' ? frame() : outSize(), long = Math.max(W, H);
    const want = Math.ceil(long * kd * dpr());
    return Math.max(64, Math.min(long, draft ? Math.max(480, Math.round(want * 0.5)) : want));
  }
  const pv = { busy: false, again: false, draft: false, key: '', url: null };
  function pvKey(mode, size) {
    const d = st.dev, g = { orientation: d.orientation, crop: d.crop };
    return keyOf([mode === 'before' ? 0 : st.base, mode, size, mode === 'before' ? g : mode === 'frame' ? { ...d, crop: { ...d.crop, geometry: null }, vignette: null } : d]);
  }
  let refreshT = null;
  const later = (ms, draft = false) => { clearTimeout(refreshT); refreshT = setTimeout(() => { refreshT = null; refresh(draft); }, ms); };
  // Renders the newest state; while one rendering is under way, later changes wait for it and only the last is drawn.
  async function refresh(draft = false) {
    clearTimeout(refreshT);
    refreshT = null;
    pv.draft = draft;
    if (pv.busy) { pv.again = true; return; }
    if (!st.sess) return;
    pv.busy = true;
    try {
      do {
        pv.again = false;
        const mode = viewMode(), size = previewSize(mode, pv.draft), key = pvKey(mode, size);
        if (key === pv.key) continue;
        const r = await call('preview', st.sess.id, editState(), { size, mode, draft: pv.draft });
        if (disposed) return;
        const url = URL.createObjectURL(new Blob([r.data], { type: r.type }));
        const im = new Image();
        im.src = url;
        await im.decode().catch(() => {});
        if (disposed) return;
        if (pv.url) URL.revokeObjectURL(pv.url);
        pv.url = url;
        pv.key = key;
        photo.src = url;
        drawHistogram(im);
      } while (pv.again);
      // A quick rendering while dragging is followed by a sharp one once things settle.
      if (pv.draft) { pv.draft = false; later(220); }
    } catch (e) {
      if (!disposed) tip(plain(e));
    } finally { pv.busy = false; }
  }

  // ── Layout and zoom ─────────────────────────────────────────────────────────────────────────────────────────
  function fitScale() {
    const aw = Math.max(80, stage.clientWidth - 56), ah = Math.max(80, stage.clientHeight - 56);
    if (st.tool === 'crop') { const [W, H] = frame(); return Math.min(aw / W, ah / H); }
    const [w, hh] = outSize(), [cw, ch, rw, rh] = finalSize();
    return Math.min(aw / (cw * w / rw), ah / (ch * hh / rh));
  }
  // Puts the photo, the drawing layer and the handles at the current zoom.
  function layout(at) {
    if (!st.dev) return;
    const before = at && photo.getBoundingClientRect();
    const cropping = st.tool === 'crop';
    kd = cropping || st.zoom === 'fit' ? fitScale() : st.zoom / dpr();
    $$('.frame', sheet).forEach((x) => x.remove());
    if (cropping) {
      const [W, H] = frame();
      Object.assign(sheet.style, { width: `${W * kd}px`, height: `${H * kd}px`, background: '' });
      const fr = h('<div class="frame"></div>');
      fr.append(photo);
      sheet.prepend(fr);
      Object.assign(photo.style, { left: '0px', top: '0px', width: `${W * kd}px`, height: `${H * kd}px`, transform: `rotate(${geo().angle}deg)` });
    } else {
      const [w, hh] = outSize(), [cw, ch, rw, rh] = finalSize(), c = st.output.canvas;
      const sw = cw * (w / rw) * kd, sh = ch * (hh / rh) * kd, pw = w * kd, ph = hh * kd;
      const ax = c ? (c.anchor || [0.5, 0.5])[0] : 0, ay = c ? (c.anchor || [0.5, 0.5])[1] : 0;
      const left = c ? (sw - pw) * ax : 0, top = c ? (sh - ph) * ay : 0;
      Object.assign(sheet.style, { width: `${sw}px`, height: `${sh}px`, background: c && c.color !== 'transparent' ? c.color : '' });
      if (photo.parentElement !== sheet) sheet.prepend(photo);
      Object.assign(photo.style, { left: `${left}px`, top: `${top}px`, width: `${pw}px`, height: `${ph}px`, transform: '' });
      Object.assign(ink.style, { left: `${left}px`, top: `${top}px`, width: `${pw}px`, height: `${ph}px`, inset: 'auto' });
      Object.assign(marks.style, { left: `${left}px`, top: `${top}px`, width: `${pw}px`, height: `${ph}px`, inset: 'auto' });
      sheet.style.overflow = c ? 'hidden' : '';
    }
    if (cropping) Object.assign(marks.style, { left: '0px', top: '0px', width: sheet.style.width, height: sheet.style.height, inset: 'auto' });
    sheet.classList.toggle('alpha', !!dimsOf().alpha || st.output.canvas?.color === 'transparent');
    ink.hidden = cropping || st.before;
    zoomMenu();
    if (at && before) {
      // Keep the spot under the pointer where it was.
      const after = photo.getBoundingClientRect(), fx = (at.x - before.left) / before.width, fy = (at.y - before.top) / before.height;
      stage.scrollLeft += after.left + fx * after.width - at.x;
      stage.scrollTop += after.top + fy * after.height - at.y;
    }
    drawInk();
    drawMarks();
    later(at ? 160 : 0);
  }
  const ZOOMS = [0.25, 0.5, 1, 2, 4];
  function zoomMenu() {
    const sel = $('.zoom', root), z = st.zoom === 'fit' ? kd * dpr() : st.zoom, pct = Math.round(z * 100);
    sel.innerHTML = `<option value="fit">Fit${st.zoom === 'fit' ? ` (${pct}%)` : ''}</option>${ZOOMS.map((v) => `<option value="${v}">${Math.round(v * 100)}%</option>`).join('')}${st.zoom !== 'fit' && !ZOOMS.includes(st.zoom) ? `<option value="${st.zoom}">${pct}%</option>` : ''}`;
    sel.value = String(st.zoom);
    sel.disabled = st.tool === 'crop';
  }
  function setZoom(z, at) {
    if (st.tool === 'crop') return;
    const cur = st.zoom === 'fit' ? kd * dpr() : st.zoom;
    const nz = z === 'fit' ? 'fit' : clamp(z, 0.05, 8);
    if (nz !== 'fit' && Math.abs(nz - cur) < 1e-4) return;
    st.zoom = nz;
    layout(at || (nz === 'fit' ? null : { x: stage.getBoundingClientRect().left + stage.clientWidth / 2, y: stage.getBoundingClientRect().top + stage.clientHeight / 2 }));
  }

  // ── Histogram ───────────────────────────────────────────────────────────────────────────────────────────────
  let histData = null;
  function drawHistogram(im) {
    const c = document.createElement('canvas'), w = 200, hh = Math.max(1, Math.round(200 * im.naturalHeight / im.naturalWidth));
    c.width = w; c.height = hh;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(im, 0, 0, w, hh);
    const d = cx.getImageData(0, 0, w, hh).data, bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let clipLo = 0, clipHi = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      bins[0][d[i]]++; bins[1][d[i + 1]]++; bins[2][d[i + 2]]++; n++;
      if (d[i] >= 254 && d[i + 1] >= 254 && d[i + 2] >= 254) clipHi++;
      if (d[i] <= 1 && d[i + 1] <= 1 && d[i + 2] <= 1) clipLo++;
    }
    histData = { bins, n, clipLo, clipHi };
    paintHistogram();
  }
  function paintHistogram() {
    const c = $('.hist', props);
    if (!c || !histData) return;
    const w = c.clientWidth * dpr(), hh = c.clientHeight * dpr();
    c.width = w; c.height = hh;
    const cx = c.getContext('2d'), { bins } = histData;
    const peak = Math.max(1, ...bins.map((b) => [...b].slice(2, 254).sort((a, b2) => b2 - a)[3] || 1));
    cx.globalCompositeOperation = 'lighter';
    ['rgba(232,69,60,.75)', 'rgba(76,184,76,.75)', 'rgba(61,123,232,.8)'].forEach((col, k) => {
      cx.fillStyle = col;
      cx.beginPath();
      cx.moveTo(0, hh);
      for (let i = 0; i < 256; i++) cx.lineTo((i / 255) * w, hh - Math.min(1, bins[k][i] / peak) * (hh - 4));
      cx.lineTo(w, hh);
      cx.fill();
    });
    const info = $('.histinfo', props);
    if (info) info.innerHTML = `<span>${histData.clipLo / histData.n > 0.01 ? 'Shadows clipped' : ''}</span><span>${histData.clipHi / histData.n > 0.01 ? 'Highlights clipped' : ''}</span>`;
  }

  // ── Text and shapes ─────────────────────────────────────────────────────────────────────────────────────────
  // Draws every added thing; t maps frame units to canvas pixels (k pixels per unit, minus the crop corner).
  function drawObjects(cx, t, skip) {
    for (const o of st.overlays) {
      if (o === skip) continue;
      cx.save();
      cx.globalAlpha = o.opacity ?? 1;
      if (o.type === 'text') drawText(cx, o, t); else drawShape(cx, o, t);
      cx.restore();
    }
  }
  const P = (t, x, y) => [x * t.k - t.ox, y * t.k - t.oy];
  function textMetrics(cx, o, px) {
    cx.font = `${o.italic ? 'italic ' : ''}${o.bold ? 700 : 400} ${px}px ${fontCss(o.font)}`;
    const m = cx.measureText('Mg'), asc = m.fontBoundingBoxAscent ?? px * 0.9, desc = m.fontBoundingBoxDescent ?? px * 0.25;
    const lines = String(o.text).split('\n'), widths = lines.map((l) => cx.measureText(l).width);
    return { lines, widths, asc, desc, lh: px * 1.2, bw: Math.max(1, ...widths) };
  }
  function drawText(cx, o, t) {
    const px = o.size * t.k, [x0, y0] = P(t, o.x, o.y), m = textMetrics(cx, o, px), bh = m.lines.length * m.lh;
    // A font not loaded yet draws as a stand-in; draw again once it has arrived.
    if (!document.fonts.check(cx.font)) document.fonts.load(cx.font).then(() => { if (document.fonts.check(cx.font)) drawInk(); }).catch(() => {});
    o._b = [o.x, o.y, m.bw / t.k, bh / t.k];
    if (o.textStyle === 'label') {
      const p = px * 0.28;
      cx.fillStyle = o.bg || '#000000';
      cx.beginPath();
      cx.roundRect(x0 - p, y0 - p * 0.6, m.bw + 2 * p, bh + p * 1.2, px * 0.22);
      cx.fill();
    }
    cx.fillStyle = o.color;
    cx.textBaseline = 'alphabetic';
    if (o.textStyle === 'shadow') { cx.shadowColor = 'rgba(0,0,0,.6)'; cx.shadowBlur = px * 0.18; cx.shadowOffsetY = px * 0.05; }
    m.lines.forEach((l, i) => {
      const lx = x0 + (o.align === 'center' ? (m.bw - m.widths[i]) / 2 : o.align === 'right' ? m.bw - m.widths[i] : 0);
      const by = y0 + i * m.lh + (m.lh - (m.asc + m.desc)) / 2 + m.asc;
      if (o.textStyle === 'outline') { cx.save(); cx.lineWidth = Math.max(1, px * 0.12); cx.lineJoin = 'round'; cx.strokeStyle = o.bg || '#000000'; cx.strokeText(l, lx, by); cx.restore(); }
      cx.fillText(l, lx, by);
    });
  }
  function drawShape(cx, o, t) {
    cx.strokeStyle = o.color;
    cx.lineWidth = Math.max(0.5, o.width * t.k);
    cx.lineCap = 'round';
    cx.lineJoin = 'round';
    if (o.type === 'rect' || o.type === 'ellipse') {
      const [x, y] = P(t, o.x, o.y), w = o.w * t.k, hh = o.h * t.k, lw = cx.lineWidth;
      cx.beginPath();
      if (o.type === 'rect') cx.rect(x + lw / 2, y + lw / 2, Math.max(0, w - lw), Math.max(0, hh - lw));
      else cx.ellipse(x + w / 2, y + hh / 2, Math.max(0, w / 2 - lw / 2), Math.max(0, hh / 2 - lw / 2), 0, 0, Math.PI * 2);
      if (o.fill && o.fill !== 'none') { cx.fillStyle = o.fill; cx.fill(); }
      cx.stroke();
    } else if (o.type === 'line' || o.type === 'arrow') {
      const [ax, ay] = P(t, o.x1, o.y1), [bx, by] = P(t, o.x2, o.y2);
      cx.beginPath();
      cx.moveTo(ax, ay);
      cx.lineTo(bx, by);
      if (o.type === 'arrow') {
        const a = Math.atan2(by - ay, bx - ax), len = Math.max(o.width * 4.5, 0.012) * t.k;
        for (const d of [-0.45, 0.45]) { cx.moveTo(bx, by); cx.lineTo(bx - len * Math.cos(a + d), by - len * Math.sin(a + d)); }
      }
      cx.stroke();
    } else if (o.type === 'ink' && o.points.length) {
      cx.beginPath();
      o.points.forEach(([x, y], i) => { const [px, py] = P(t, x, y); if (i) cx.lineTo(px, py); else cx.moveTo(px, py); });
      if (o.points.length === 1) { const [px, py] = P(t, ...o.points[0]); cx.lineTo(px + 0.01, py); }
      cx.stroke();
    }
  }
  function displayT(scale) {
    const [W, H] = frame(), r = geo().rect, l = L();
    return { k: l * scale, ox: r.x0 * W * scale, oy: r.y0 * H * scale };
  }
  function drawInk() {
    if (!st.dev || st.tool === 'crop') return;
    const w = parseFloat(ink.style.width) || 0, hh = parseFloat(ink.style.height) || 0;
    ink.width = Math.max(1, Math.round(w * dpr()));
    ink.height = Math.max(1, Math.round(hh * dpr()));
    const cx = ink.getContext('2d');
    cx.clearRect(0, 0, ink.width, ink.height);
    if (st.before) return;
    drawObjects(cx, displayT(kd * dpr()), editing);
  }
  // The added things at the cropped image's full size, for Save (smaller if a canvas that big can't be made).
  async function renderOverlay() {
    if (!st.overlays.length) return null;
    const [w, hh] = outSize(), k = Math.min(1, 16000 / Math.max(w, hh), Math.sqrt(2.6e8 / (w * hh)));
    await loadFonts();
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k));
    drawObjects(c.getContext('2d'), displayT(k));
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }
  const loadFonts = () => Promise.all(st.overlays.filter((o) => o.type === 'text').map((o) => document.fonts.load(`${o.italic ? 'italic ' : ''}${o.bold ? 700 : 400} 40px ${fontCss(o.font)}`).catch(() => {})));
  function bbox(o) {
    if (o.type === 'text') return o._b || [o.x, o.y, o.size * 2, o.size * 1.2];
    if (o.type === 'rect' || o.type === 'ellipse') return [o.x, o.y, o.w, o.h];
    const xs = o.type === 'ink' ? o.points.map((p) => p[0]) : [o.x1, o.x2], ys = o.type === 'ink' ? o.points.map((p) => p[1]) : [o.y1, o.y2], pd = o.width / 2;
    const x0 = Math.min(...xs) - pd, y0 = Math.min(...ys) - pd;
    return [x0, y0, Math.max(...xs) + pd - x0, Math.max(...ys) + pd - y0];
  }
  const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
  function hit(x, y) {
    const tol = 7 / (kd * L());
    for (let i = st.overlays.length - 1; i >= 0; i--) {
      const o = st.overlays[i];
      if (o.type === 'line' || o.type === 'arrow') { if (segDist(x, y, o.x1, o.y1, o.x2, o.y2) <= o.width / 2 + tol) return o; continue; }
      if (o.type === 'ink') { if (o.points.some((p, j) => segDist(x, y, ...(o.points[j - 1] || p), ...p) <= o.width / 2 + tol)) return o; continue; }
      const [bx, by, bw, bh] = bbox(o);
      if (x >= bx - tol && x <= bx + bw + tol && y >= by - tol && y <= by + bh + tol) return o;
    }
    return null;
  }
  function shiftObj(o, dx, dy) {
    if (o.type === 'ink') o.points = o.points.map(([x, y]) => [x + dx, y + dy]);
    else if (o.x1 != null) Object.assign(o, { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy });
    else Object.assign(o, { x: o.x + dx, y: o.y + dy });
  }
  // Scales from the top-left corner of the thing's box; text grows its letters.
  function scaleObj(o, snapO, sx, sy) {
    const [bx, by] = bbox(snapO), f = (x, y) => [bx + (x - bx) * sx, by + (y - by) * sy];
    if (o.type === 'text') o.size = Math.max(0.004, snapO.size * Math.max(0.05, (sx + sy) / 2));
    else if (o.type === 'rect' || o.type === 'ellipse') { o.w = Math.max(0.002, snapO.w * sx); o.h = Math.max(0.002, snapO.h * sy); }
    else if (o.type === 'ink') o.points = snapO.points.map(([x, y]) => f(x, y));
    else { [o.x1, o.y1] = f(snapO.x1, snapO.y1); [o.x2, o.y2] = f(snapO.x2, snapO.y2); }
  }

  // ── Marks layer: selection, crop handles, spots, eyes ───────────────────────────────────────────────────────
  let brush = null;
  function drawMarks() {
    marks.innerHTML = '';
    brush = null;
    if (!st.dev || st.before) return;
    if (st.tool === 'crop') return drawCropBox();
    const sc = kd;
    if (st.tool === 'heal') {
      const l = L();
      st.dev.spots.forEach((sp, i) => {
        const p = sp.points[0], r = Math.max(4, sp.size * l * sc);
        const pts = sp.points.map((q) => outFromNorm(q.x, q.y).map((v) => v * sc));
        const [tx, ty] = pts[0];
        // A brushed spot shows the path it covers.
        if (pts.length > 1) marks.append(h(`<svg class="spotpath" width="100%" height="100%"><polyline points="${pts.map((q) => q.join(',')).join(' ')}" stroke-width="${2 * r}"/></svg>`));
        const el = h(`<div class="spot${i === st.spotSel ? ' sel' : ''}" title="Spot ${i + 1}: click to select, Delete removes it" style="left:${tx}px;top:${ty}px;width:${2 * r}px;height:${2 * r}px"></div>`);
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); st.spotSel = i; drawMarks(); renderProps(); });
        marks.append(el);
        if (i === st.spotSel && sp.source_offset) {
          const [sx, sy] = outFromNorm(p.x + sp.source_offset.x, p.y + sp.source_offset.y).map((v) => v * sc);
          const len = Math.hypot(sx - tx, sy - ty);
          if (len > 2 * r) marks.append(h(`<div class="spotline" style="left:${tx + (sx - tx) * r / len}px;top:${ty + (sy - ty) * r / len}px;width:${len - 2 * r}px;transform:rotate(${Math.atan2(sy - ty, sx - tx)}rad)"></div>`));
          const src = h(`<div class="spot src sel" title="Where the spot takes from: drag to move it" style="left:${sx}px;top:${sy}px;width:${2 * r}px;height:${2 * r}px"></div>`);
          src.addEventListener('pointerdown', (e) => dragSource(e, i));
          marks.append(src);
        }
      });
    }
    if (st.tool === 'redeye') {
      const l = L();
      st.dev.red_eye.forEach((re, i) => {
        const [x, y] = outFromNorm(re.center.x, re.center.y).map((v) => v * sc);
        const el = h(`<div class="eye${i === st.eyeSel ? ' sel' : ''}" title="Red eye ${i + 1}: click to select, Delete removes it" style="left:${x}px;top:${y}px;width:${2 * re.rx * l * sc}px;height:${2 * re.ry * l * sc}px"></div>`);
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); st.eyeSel = i; drawMarks(); renderProps(); });
        marks.append(el);
      });
    }
    if (st.tool === 'mask') drawMaskMarks();
    if (st.tool === 'heal' || st.tool === 'redeye' || (st.tool === 'mask' && maskKind() === 'brush')) {
      brush = h('<div class="brush" hidden></div>');
      marks.append(brush);
      sizeBrush();
    }
    if (editEl) marks.append(editEl);
    if (st.sel && st.overlays.includes(st.sel) && st.sel !== editing) {
      const [x, y, w, hh] = bbox(st.sel), [ox, oy] = outFromL(x, y);
      const box = h(`<div class="selbox" style="left:${ox * sc}px;top:${oy * sc}px;width:${w * L() * sc}px;height:${hh * L() * sc}px"><span class="handle" title="Drag to resize"></span></div>`);
      $('.handle', box).addEventListener('pointerdown', (e) => dragObj(e, st.sel, true));
      marks.append(box);
    }
  }
  function sizeBrush() {
    if (!brush) return;
    const d = 2 * (st.tool === 'heal' ? (st.spotSel >= 0 ? st.dev.spots[st.spotSel]?.size ?? st.heal.size : st.heal.size) : st.tool === 'mask' ? st.paint.size : st.eye.size) * L() * kd;
    Object.assign(brush.style, { width: `${d}px`, height: `${d}px` });
  }

  // ── Crop ────────────────────────────────────────────────────────────────────────────────────────────────────
  let cropIntent = null;
  function drawCropBox() {
    const [x0, y0, x1, y1] = toPx(geo().rect).map((v) => v * kd);
    const box = h(`<div class="cropbox" style="left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px">
      ${[1, 2].map((i) => `<i class="third v" style="left:${(i * 100) / 3}%"></i><i class="third h" style="top:${(i * 100) / 3}%"></i>`).join('')}
      ${[['nw', 0, 0], ['n', 50, 0], ['ne', 100, 0], ['e', 100, 50], ['se', 100, 100], ['s', 50, 100], ['sw', 0, 100], ['w', 0, 50]].map(([d, l, t]) => `<b class="hd ${d}" data-h="${d}" style="left:${l}%;top:${t}%"></b>`).join('')}
      <span class="cropsize">${outSize().join(' × ')}</span></div>`);
    box.addEventListener('pointerdown', (e) => dragCrop(e, e.target.closest('[data-h]')?.dataset.h || 'move'));
    marks.append(...['t', 'b', 'l', 'r'].map((k) => h(`<div class="shade" data-s="${k}"></div>`)), box);
    shade(x0, y0, x1, y1);
  }
  // Darkens what the crop leaves out.
  function shade(x0, y0, x1, y1) {
    const W = marks.clientWidth || parseFloat(marks.style.width), H = marks.clientHeight || parseFloat(marks.style.height);
    const at = { t: [0, 0, W, y0], b: [0, y1, W, H - y1], l: [0, y0, x0, y1 - y0], r: [x1, y0, W - x1, y1 - y0] };
    for (const [k, [l, t, w, hh]] of Object.entries(at)) {
      const el = $(`.shade[data-s="${k}"]`, marks);
      if (el) Object.assign(el.style, { left: `${l}px`, top: `${t}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, hh)}px` });
    }
  }
  function aspectRatio() {
    const a = st.cropAspect || 'free';
    if (a === 'free') return null;
    if (a === 'orig') { const d = dimsOf(); return swapped() ? d.h / d.w : d.w / d.h; }
    const [p, q] = a.split(':').map(Number);
    return st.cropFlip ? q / p : p / q;
  }
  function dragCrop(e, handle) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const box = e.currentTarget, start = toPx(geo().rect), [W, H] = frame(), sx = e.clientX, sy = e.clientY;
    let last = start.slice();
    box.classList.add('live');
    const move = (ev) => {
      const dx = (ev.clientX - sx) / kd, dy = (ev.clientY - sy) / kd;
      let [x0, y0, x1, y1] = start;
      if (handle === 'move') {
        const w = x1 - x0, hh = y1 - y0;
        x0 = clamp(x0 + dx, 0, W - w); y0 = clamp(y0 + dy, 0, H - hh); x1 = x0 + w; y1 = y0 + hh;
      } else {
        if (handle.includes('w')) x0 = clamp(x0 + dx, 0, x1 - 8);
        if (handle.includes('e')) x1 = clamp(x1 + dx, x0 + 8, W);
        if (handle.includes('n')) y0 = clamp(y0 + dy, 0, y1 - 8);
        if (handle.includes('s')) y1 = clamp(y1 + dy, y0 + 8, H);
        const ratio = aspectRatio() || (ev.shiftKey ? (start[2] - start[0]) / (start[3] - start[1]) : null);
        if (ratio) {
          // Keep the shape: the dragged side leads, the other follows from the opposite corner or edge.
          let w = x1 - x0, hh = y1 - y0;
          if (handle === 'n' || handle === 's') w = hh * ratio; else if (handle === 'e' || handle === 'w') hh = w / ratio; else if (w / hh > ratio) w = hh * ratio; else hh = w / ratio;
          if (handle.includes('w')) x0 = x1 - w; else if (handle.includes('e')) x1 = x0 + w; else { const cx = (start[0] + start[2]) / 2; x0 = cx - w / 2; x1 = cx + w / 2; }
          if (handle.includes('n')) y0 = y1 - hh; else if (handle.includes('s')) y1 = y0 + hh; else { const cy = (start[1] + start[3]) / 2; y0 = cy - hh / 2; y1 = cy + hh / 2; }
          if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) return;
        }
      }
      // Never past the turned picture: go as far towards the pointer as fits.
      const target = [x0, y0, x1, y1];
      if (!inside(...target)) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2, c = last.map((v, k) => v + (target[k] - v) * m); if (inside(...c)) lo = m; else hi = m; }
        [x0, y0, x1, y1] = last.map((v, k) => v + (target[k] - v) * lo);
      }
      last = [x0, y0, x1, y1];
      geo().rect = toRect(last);
      Object.assign(box.style, { left: `${x0 * kd}px`, top: `${y0 * kd}px`, width: `${(x1 - x0) * kd}px`, height: `${(y1 - y0) * kd}px` });
      shade(x0 * kd, y0 * kd, x1 * kd, y1 * kd);
      $('.cropsize', box).textContent = outSize().join(' × ');
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); box.classList.remove('live'); cropIntent = null; commit('Crop'); renderProps(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function setAngle(a, live) {
    if (!cropIntent) cropIntent = clone(geo().rect);
    const r = clamp(Math.round(a * 100) / 100, -45, 45);
    st.dev.crop.geometry = { angle: r, rect: fitCrop(cropIntent, (r * Math.PI) / 180) };
    if (st.tool === 'crop') {
      photo.style.transform = `rotate(${r}deg)`;
      marks.innerHTML = '';
      drawCropBox();
      $('.cropbox', marks)?.classList.add('live', 'fine');
    }
    if (!live) { cropIntent = null; commit('Straighten'); if (st.tool !== 'crop') layout(); else { drawMarks(); renderProps(); } }
  }
  // Drag outside the crop to turn the picture, as in Lightroom.
  function dragRotate(e) {
    const r = sheet.getBoundingClientRect(), c = [r.left + r.width / 2, r.top + r.height / 2];
    const a0 = Math.atan2(e.clientY - c[1], e.clientX - c[0]), start = geo().angle;
    cropIntent = clone(geo().rect);
    const move = (ev) => { const a = Math.atan2(ev.clientY - c[1], ev.clientX - c[0]); setAngle(start + ((a - a0) * 180) / Math.PI, true); syncAngle(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setAngle(geo().angle, false); renderProps(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  const syncAngle = () => { const r = $('[data-k="angle"] input', props); if (r) { r.value = geo().angle; paintRange(r); $('[data-k="angle"] output', props).textContent = `${geo().angle.toFixed(1)}°`; } };
  // Turning or mirroring moves the crop, the spots, the red eyes and what was added along with the picture.
  function reorient(kind) {
    const [W, H] = frame(), l = L(), w = W / l, hh = H / l, d = st.dev, g = d.crop.geometry, r = g.rect;
    const [turn, flip] = ORIENT[d.orientation] || [0, 0];
    const cw = kind === 'right' || kind === 'left';
    // Turning left is three turns right; mirroring vertically is mirroring and turning twice.
    const steps = kind === 'right' ? 1 : kind === 'left' ? 3 : 0;
    const P1 = (u, v) => { for (let i = 0; i < steps; i++) [u, v] = [1 - v, u]; if (kind === 'flipH') u = 1 - u; if (kind === 'flipV') v = 1 - v; return [u, v]; };
    const V1 = (x, y) => { for (let i = 0; i < steps; i++) [x, y] = [-y, x]; if (kind === 'flipH') x = -x; if (kind === 'flipV') y = -y; return [x, y]; };
    const [a, b] = P1(r.x0, r.y0), [c2, d2] = P1(r.x1, r.y1);
    g.rect = { x0: Math.min(a, c2), y0: Math.min(b, d2), x1: Math.max(a, c2), y1: Math.max(b, d2) };
    if (!cw) g.angle = -g.angle;
    d.orientation = kind === 'right' ? orientName((turn + 1) % 4, flip) : kind === 'left' ? orientName((turn + 3) % 4, flip) : kind === 'flipH' ? orientName((4 - turn) % 4, flip ^ 1) : orientName((6 - turn) % 4, flip ^ 1);
    d.spots = d.spots.map((s) => ({ ...s, points: s.points.map((p) => { const [x, y] = P1(p.x, p.y); return { x, y }; }), source_offset: s.source_offset && (([x, y]) => ({ x, y }))(V1(s.source_offset.x, s.source_offset.y)) }));
    d.red_eye = d.red_eye.map((e) => { const [x, y] = P1(e.center.x, e.center.y); return { ...e, center: { x, y }, ...(steps % 2 ? { rx: e.ry, ry: e.rx } : {}) }; });
    const NP = (q) => { const [x, y] = P1(q.x, q.y); return { x, y }; };
    for (const m of d.masks || []) for (const c of m.components || []) {
      const sh = c.shape;
      if (sh.kind === 'linear') { sh.start = NP(sh.start); sh.end = NP(sh.end); }
      if (sh.kind === 'radial') { sh.center = NP(sh.center); sh.angle = cw ? sh.angle + 90 * steps : -sh.angle; }
      if (sh.kind === 'brush') sh.strokes = sh.strokes.map((k) => ({ ...k, points: k.points.map(NP) }));
    }
    // Frame units: points move with the picture; text keeps reading the right way and moves by its middle.
    const F = (x, y) => { const [u, v] = P1(x / w, y / hh), [nw, nh] = steps % 2 ? [hh, w] : [w, hh]; return [u * nw, v * nh]; };
    for (const o of st.overlays) {
      if (o.type === 'ink') o.points = o.points.map(([x, y]) => F(x, y));
      else if (o.x1 != null) { [o.x1, o.y1] = F(o.x1, o.y1); [o.x2, o.y2] = F(o.x2, o.y2); }
      else {
        const [bx, by, bw, bh] = bbox(o), [cx, cy] = F(bx + bw / 2, by + bh / 2);
        const [nw, nh] = o.type === 'text' || !(steps % 2) ? [bw, bh] : [bh, bw];
        o.x = cx - nw / 2; o.y = cy - nh / 2;
        if (o.type !== 'text') { o.w = nw; o.h = nh; }
      }
    }
    commit(kind === 'right' || kind === 'left' ? 'Rotate' : 'Flip');
    layout();
    renderProps();
  }

  // ── Pointer on the image ────────────────────────────────────────────────────────────────────────────────────
  const outPt = (e) => { const r = marks.getBoundingClientRect(); return [(e.clientX - r.left) / kd, (e.clientY - r.top) / kd]; };
  marks.addEventListener('pointermove', (e) => {
    if (!brush) return;
    const r = marks.getBoundingClientRect();
    brush.hidden = false;
    Object.assign(brush.style, { left: `${e.clientX - r.left}px`, top: `${e.clientY - r.top}px` });
  });
  marks.addEventListener('pointerleave', () => { if (brush) brush.hidden = true; });
  marks.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || spaceDown || !st.dev || st.before) return;
    if (st.tool === 'crop') { if (!e.target.closest('.cropbox')) { e.preventDefault(); dragRotate(e); } return; }
    if (editing && e.target.closest('.tedit')) return;
    endText();
    const [ox, oy] = outPt(e), [lx, ly] = lFromOut(ox, oy);
    if (st.tool === 'heal') { e.preventDefault(); brushSpot(e); return; }
    if (st.tool === 'redeye') { e.preventDefault(); addEye(ox, oy); return; }
    if (st.tool === 'mask') { e.preventDefault(); maskPointer(e); return; }
    const o = MARKUP.has(st.tool) ? hit(lx, ly) : null;
    if (o) { select(o); dragObj(e, o, false); return; }
    if (!MARKUP.has(st.tool)) { select(null); return; }
    e.preventDefault();
    const s = st.style;
    if (st.tool === 'text') {
      const t = addObj({ type: 'text', x: lx, y: ly - s.size * 0.6, text: '', size: s.size, font: s.font, color: s.color, bold: s.bold, italic: s.italic, align: s.align, textStyle: s.textStyle, bg: s.bg, opacity: s.opacity });
      select(t);
      setTimeout(() => editText(t, false), 0);
      return;
    }
    const t = st.tool, base = { color: s.stroke, width: s.width, opacity: s.opacity };
    const o2 = t === 'draw' ? { type: 'ink', points: [[lx, ly]], ...base } : t === 'line' || t === 'arrow' ? { type: t, x1: lx, y1: ly, x2: lx, y2: ly, ...base } : { type: t, x: lx, y: ly, w: 0, h: 0, fill: s.fill, ...base };
    st.overlays.push(o2);
    const move = (ev) => {
      const [mx, my] = lFromOut(...outPt(ev));
      if (o2.type === 'ink') o2.points.push([mx, my]);
      else if (o2.x1 != null) {
        o2.x2 = mx; o2.y2 = my;
        if (ev.shiftKey) { const a = Math.round(Math.atan2(my - ly, mx - lx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(mx - lx, my - ly); o2.x2 = lx + len * Math.cos(a); o2.y2 = ly + len * Math.sin(a); }
      } else {
        let w = mx - lx, hh = my - ly;
        if (ev.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * m; hh = Math.sign(hh || 1) * m; }
        Object.assign(o2, { x: Math.min(lx, lx + w), y: Math.min(ly, ly + hh), w: Math.abs(w), h: Math.abs(hh) });
      }
      drawInk();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const px = 3 / (kd * L()), [, , bw, bh] = bbox(o2);
      const tiny = o2.type === 'ink' ? o2.points.length < 2 : o2.x1 != null ? Math.hypot(o2.x2 - o2.x1, o2.y2 - o2.y1) < px : bw < px || bh < px;
      if (tiny) { st.overlays = st.overlays.filter((x) => x !== o2); drawInk(); return; }
      if (o2.type === 'ink') o2.points = simplify(o2.points, 0.6 / (kd * L()));
      select(o2);
      commit({ ink: 'Draw', rect: 'Box', ellipse: 'Oval', arrow: 'Arrow', line: 'Line' }[o2.type]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  // Fewer points for a drawn line, so the history stays small; what it looks like doesn't change.
  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const keep = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) if (Math.hypot(pts[i][0] - keep[keep.length - 1][0], pts[i][1] - keep[keep.length - 1][1]) > eps) keep.push(pts[i]);
    keep.push(pts[pts.length - 1]);
    return keep;
  }
  function addObj(o) { o.id = ++st.seq; st.overlays.push(o); return o; }
  function select(o) {
    st.sel = o;
    drawMarks();
    renderProps();
  }
  function dragObj(e, o, handle) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = lFromOut(...outPt(e)), before = clone(strip(o)), [, , bw, bh] = bbox(o);
    let moved = false;
    const move = (ev) => {
      const [x, y] = lFromOut(...outPt(ev)), dx = x - start[0], dy = y - start[1];
      if (Math.abs(dx) + Math.abs(dy) > 1e-4) moved = true;
      if (handle) { const sx = Math.max(0.05, (bw + dx) / bw), sy = o.type === 'text' ? sx : Math.max(0.05, (bh + dy) / bh); scaleObj(o, before, sx, sy); }
      else { Object.assign(o, clone(before)); shiftObj(o, dx, dy); }
      drawInk();
      drawMarks();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) { commit(handle ? 'Resize' : 'Move'); renderProps(); } else if (o.type === 'text' && st.tool === 'text' && !handle) editText(o, false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  let editing = null, editEl = null;
  function editText(o, selectAll) {
    endText(true);
    editing = o;
    const [ox, oy] = outFromL(o.x, o.y), px = o.size * L() * kd;
    editEl = h('<div class="tedit" spellcheck="false"></div>');
    editEl.textContent = o.text;
    Object.assign(editEl.style, {
      left: `${ox * kd}px`, top: `${oy * kd}px`, font: `${o.italic ? 'italic ' : ''}${o.bold ? 700 : 400} ${px}px ${fontCss(o.font)}`, lineHeight: '1.2', color: o.color, textAlign: o.align, opacity: String(o.opacity ?? 1),
      textShadow: o.textStyle === 'shadow' ? `0 ${px * 0.05}px ${px * 0.18}px rgba(0,0,0,.6)` : '', WebkitTextStroke: o.textStyle === 'outline' ? `${Math.max(1, px * 0.12)}px ${o.bg}` : '', paintOrder: 'stroke fill',
      background: o.textStyle === 'label' ? o.bg : '', borderRadius: `${px * 0.22}px`, padding: o.textStyle === 'label' ? `${px * 0.17}px ${px * 0.28}px` : '0', margin: o.textStyle === 'label' ? `${-px * 0.17}px 0 0 ${-px * 0.28}px` : '0',
    });
    drawInk();
    drawMarks();
    editEl.contentEditable = 'plaintext-only';
    editEl.focus();
    const r = document.createRange();
    r.selectNodeContents(editEl);
    if (!selectAll) r.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    editEl.addEventListener('input', () => { o.text = editEl.innerText.replace(/\n$/, ''); });
    editEl.addEventListener('keydown', (e) => {
      const fmt = (e.ctrlKey || e.metaKey) && { b: 'bold', i: 'italic' }[e.key.toLowerCase()];
      if (fmt) { e.preventDefault(); o[fmt] = !o[fmt]; restyleEdit(); renderProps(); }
      else if (e.key === 'Escape') { e.preventDefault(); endText(); }
      e.stopPropagation();
    });
    editEl.addEventListener('blur', () => setTimeout(() => { if (editing === o && document.activeElement !== editEl && !props.contains(document.activeElement)) endText(); }, 0));
  }
  function restyleEdit() { if (editing) { const o = editing; endText(true); editText(o, false); } }
  function endText(quiet) {
    const o = editing;
    if (!o) return;
    editing = null;
    o.text = editEl.innerText.replace(/\n$/, '');
    editEl.remove();
    editEl = null;
    if (!o.text.trim()) { st.overlays = st.overlays.filter((x) => x !== o); if (st.sel === o) st.sel = null; }
    drawInk();
    if (!quiet || o.text.trim()) commit(o.text.trim() ? 'Text' : 'Delete');
    drawMarks();
  }
  function removeSel() {
    if (st.sel) { st.overlays = st.overlays.filter((x) => x !== st.sel); st.sel = null; commit('Delete'); drawInk(); drawMarks(); renderProps(); return true; }
    if (st.tool === 'heal' && st.spotSel >= 0) { st.dev.spots.splice(st.spotSel, 1); st.spotSel = -1; commit('Remove spot'); refresh(); drawMarks(); renderProps(); return true; }
    if (st.tool === 'mask' && st.maskSel >= 0) { st.dev.masks.splice(st.maskSel, 1); st.maskSel = -1; commit('Delete mask'); refresh(); drawMarks(); renderProps(); return true; }
    if (st.tool === 'redeye' && st.eyeSel >= 0) { st.dev.red_eye.splice(st.eyeSel, 1); st.eyeSel = -1; commit('Remove red eye'); refresh(); drawMarks(); renderProps(); return true; }
    return false;
  }

  // ── Heal and red eye ────────────────────────────────────────────────────────────────────────────────────────
  // A click is a round spot, a drag a brushed one; LightCraft picks where to take from, once, when it is added.
  function brushSpot(e) {
    const pts = [outPt(e)], r = st.heal.size * L();
    const trail = h('<canvas class="ink" style="pointer-events:none"></canvas>');
    const w = marks.clientWidth, hh = marks.clientHeight;
    trail.width = w * dpr(); trail.height = hh * dpr();
    Object.assign(trail.style, { width: `${w}px`, height: `${hh}px`, left: '0', top: '0' });
    marks.append(trail);
    const tc = trail.getContext('2d');
    const paint = () => { tc.clearRect(0, 0, trail.width, trail.height); tc.strokeStyle = 'rgba(255,255,255,.45)'; tc.lineCap = 'round'; tc.lineJoin = 'round'; tc.lineWidth = 2 * r * kd * dpr(); tc.beginPath(); pts.forEach(([x, y], i) => (i ? tc.lineTo(x * kd * dpr(), y * kd * dpr()) : tc.moveTo(x * kd * dpr(), y * kd * dpr()))); if (pts.length === 1) tc.lineTo(pts[0][0] * kd * dpr() + 0.1, pts[0][1] * kd * dpr()); tc.stroke(); };
    paint();
    const move = (ev) => { const p = outPt(ev), q = pts[pts.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > r * 0.25) { pts.push(p); paint(); } if (brush) { const b = marks.getBoundingClientRect(); Object.assign(brush.style, { left: `${ev.clientX - b.left}px`, top: `${ev.clientY - b.top}px` }); } };
    const up = async () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const points = pts.map(([x, y]) => normFromOut(x, y));
      await work('Healing', async () => {
        const res = await call('develop', st.sess.id, editState(), 'spot', { mode: st.heal.mode, points, size: st.heal.size, feather: st.heal.feather, opacity: st.heal.opacity });
        st.dev = res.dev;
        st.spotSel = st.dev.spots.length - 1;
        commit('Heal');
      }, true);
      trail.remove();
      drawMarks();
      renderProps();
      refresh();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function dragSource(e, i) {
    e.preventDefault();
    e.stopPropagation();
    const sp = st.dev.spots[i], start = { ...sp.source_offset }, [sx, sy] = outPt(e);
    const [ux, uy] = normFromOut(sx, sy);
    const move = (ev) => { const [u, v] = normFromOut(...outPt(ev)); sp.source_offset = { x: start.x + u - ux, y: start.y + v - uy }; drawMarks(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (sp.source_offset.x !== start.x || sp.source_offset.y !== start.y) { commit('Move source'); refresh(); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function addEye(ox, oy) {
    const [u, v] = normFromOut(ox, oy), e = st.eye;
    st.dev.red_eye.push({ center: { x: u, y: v }, rx: e.size, ry: e.size, pupil_size: e.pupil, darken: e.darken, pet: !!e.pet, catchlight: null });
    st.eyeSel = st.dev.red_eye.length - 1;
    commit('Red eye');
    drawMarks();
    renderProps();
    refresh();
  }

  // ── Masks ───────────────────────────────────────────────────────────────────────────────────────────────────
  // Lightroom's local adjustments: a linear or radial gradient, or painted strokes, each with its own sliders.
  // Shapes are kept where LightCraft keeps them, in fractions of the turned image before straightening.
  const MASK_ADJUST = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temp: 0, tint: 0, texture: 0, clarity: 0, dehaze: 0, hue: 0, saturation: 0, sharpness: 0, noise: 0, moire: 0, defringe: 0, color_hue: 0, color_sat: 0, amount: 100 };
  const MASK_KINDS = [['linear', 'line', 'Linear'], ['radial', 'circle', 'Radial'], ['brush', 'pen', 'Brush']];
  const maskOf = () => (st.maskSel >= 0 ? st.dev.masks[st.maskSel] : null);
  const maskKind = () => maskOf()?.components?.[0]?.shape?.kind || st.maskNew;
  function newMask(shape) {
    const id = Math.max(0, ...st.dev.masks.map((m) => m.id || 0)) + 1;
    st.dev.masks.push({ id, name: `Mask ${id}`, visible: true, invert: false, adjust: { ...MASK_ADJUST }, components: [{ op: 'add', invert: false, shape }] });
    st.maskSel = st.dev.masks.length - 1;
    return st.dev.masks[st.maskSel];
  }
  const dispN = (q) => outFromNorm(q.x, q.y).map((v) => v * kd);
  const normAt = (e) => { const [u, v] = normFromOut(...outPt(e)); return { x: u, y: v }; };
  function drawMaskMarks() {
    const m = maskOf();
    st.dev.masks.forEach((mk, i) => {
      const sh = mk.components?.[0]?.shape;
      const at = sh?.kind === 'linear' ? { x: (sh.start.x + sh.end.x) / 2, y: (sh.start.y + sh.end.y) / 2 } : sh?.kind === 'radial' ? sh.center : sh?.strokes?.[0]?.points?.[0];
      if (!at || mk === m) return;
      const [x, y] = dispN(at);
      const pin = h(`<div class="mpin" title="${esc(mk.name)}: click to select" style="left:${x}px;top:${y}px"></div>`);
      pin.addEventListener('pointerdown', (e) => { e.stopPropagation(); st.maskSel = i; drawMarks(); renderProps(); });
      marks.append(pin);
    });
    if (!m) return;
    const sh = m.components[0].shape, l = L() * kd;
    const dot = (x, y, part, title) => { const d = h(`<div class="mdot" data-part="${part}" title="${title}" style="left:${x}px;top:${y}px"></div>`); d.addEventListener('pointerdown', (e) => dragMask(e, part)); marks.append(d); };
    if (sh.kind === 'linear') {
      const [ax, ay] = dispN(sh.start), [bx, by] = dispN(sh.end), ang = Math.atan2(by - ay, bx - ax), len = Math.hypot(bx - ax, by - ay);
      // Full effect at the first line, none past the second.
      const clip = h('<div class="mclip"></div>');
      for (const [x, y, cls] of [[ax, ay, 'full'], [bx, by, 'none']]) clip.append(h(`<div class="mline ${cls}" style="left:${x}px;top:${y}px;transform:translate(-50%,0) rotate(${ang + Math.PI / 2}rad)"></div>`));
      clip.append(h(`<div class="mspan" style="left:${ax}px;top:${ay}px;width:${len}px;transform:rotate(${ang}rad)"></div>`));
      marks.append(clip);
      dot(ax, ay, 'start', 'Full effect here: drag to move');
      dot(bx, by, 'end', 'No effect past here: drag to move');
      dot((ax + bx) / 2, (ay + by) / 2, 'move', 'Drag to move the gradient');
    } else if (sh.kind === 'radial') {
      const [cx, cy] = dispN(sh.center), a = ((sh.angle || 0) + geo().angle) * Math.PI / 180;
      marks.append(h(`<div class="mell" style="left:${cx}px;top:${cy}px;width:${2 * sh.rx * l}px;height:${2 * sh.ry * l}px;transform:translate(-50%,-50%) rotate(${a}rad)"></div>`));
      dot(cx, cy, 'move', 'Drag to move');
      dot(cx + Math.cos(a) * sh.rx * l, cy + Math.sin(a) * sh.rx * l, 'rx', 'Drag to resize and turn');
      dot(cx - Math.sin(a) * sh.ry * l, cy + Math.cos(a) * sh.ry * l, 'ry', 'Drag to resize');
    } else if (sh.kind === 'brush') {
      const svg = h('<svg class="spotpath mpaint" width="100%" height="100%"></svg>');
      svg.innerHTML = sh.strokes.map((k) => `<polyline class="${k.erase ? 'erase' : ''}" points="${k.points.map((q) => dispN(q).join(',')).join(' ')}" stroke-width="${Math.max(2, 2 * k.size * l)}"/>`).join('');
      marks.append(svg);
    }
  }
  function maskPointer(e) {
    const m = maskOf(), kind = maskKind();
    if (m && kind === 'brush') return paintMask(e, m);
    if (m) { st.maskSel = -1; drawMarks(); renderProps(); }
    const start = normAt(e);
    const l = L(), [W, H] = frame();
    const shape = st.maskNew === 'linear' ? { kind: 'linear', start, end: { ...start } } : st.maskNew === 'radial' ? { kind: 'radial', center: start, rx: 0.001, ry: 0.001, angle: -geo().angle, feather: 50, invert: false } : { kind: 'brush', strokes: [] };
    const mk = newMask(shape);
    if (shape.kind === 'brush') { paintMask(e, mk, true); return; }
    const move = (ev) => {
      const p = normAt(ev);
      if (shape.kind === 'linear') shape.end = p;
      else { const [ox, oy] = outFromNorm(start.x, start.y), [px, py] = outPt(ev); shape.rx = Math.max(0.005, Math.abs(px - ox) / l); shape.ry = Math.max(0.005, Math.abs(py - oy) / l); }
      drawMarks();
      refresh(true);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // A click without a drag makes a gradient of a useful size.
      if (shape.kind === 'linear' && Math.hypot((shape.end.x - start.x) * W, (shape.end.y - start.y) * H) < 4 / kd) shape.end = { x: start.x, y: Math.min(1, start.y + 0.25) };
      if (shape.kind === 'radial' && shape.rx < 0.01 && shape.ry < 0.01) { shape.rx = 0.2; shape.ry = 0.15; }
      commit(shape.kind === 'linear' ? 'Linear gradient' : 'Radial gradient');
      drawMarks(); renderProps(); refresh();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function paintMask(e, m, fresh) {
    const sh = m.components[0].shape, p = st.paint;
    const stroke = { auto_mask: false, density: 100, erase: !!p.erase, feather: p.feather, flow: p.flow, points: [normAt(e)], size: p.size };
    sh.strokes.push(stroke);
    drawMarks();
    const move = (ev) => {
      const q = normAt(ev), last = stroke.points[stroke.points.length - 1], [W, H] = frame();
      if (Math.hypot((q.x - last.x) * W, (q.y - last.y) * H) < p.size * L() * 0.2) return;
      stroke.points.push(q);
      drawMarks();
      if (brush) { const b = marks.getBoundingClientRect(); Object.assign(brush.style, { left: `${ev.clientX - b.left}px`, top: `${ev.clientY - b.top}px`, }); brush.hidden = false; }
      refresh(true);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); commit(fresh ? 'Brush mask' : stroke.erase ? 'Erase' : 'Brush'); drawMarks(); renderProps(); refresh(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function dragMask(e, part) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const m = maskOf(), sh = m.components[0].shape, before = clone(sh), p0 = normAt(e), l = L();
    const move = (ev) => {
      const p = normAt(ev), dx = p.x - p0.x, dy = p.y - p0.y;
      if (sh.kind === 'linear') {
        if (part === 'start' || part === 'move') sh.start = { x: before.start.x + dx, y: before.start.y + dy };
        if (part === 'end' || part === 'move') sh.end = { x: before.end.x + dx, y: before.end.y + dy };
      } else if (part === 'move') sh.center = { x: before.center.x + dx, y: before.center.y + dy };
      else {
        // Radii and turn from where the handle is dragged, measured in the turned image.
        const [cx, cy] = outFromNorm(sh.center.x, sh.center.y), [px, py] = outPt(ev), r = Math.hypot(px - cx, py - cy) / l;
        if (part === 'rx') { sh.rx = Math.max(0.005, r); sh.angle = Math.atan2(py - cy, px - cx) * 180 / Math.PI - geo().angle; } else sh.ry = Math.max(0.005, r);
      }
      drawMarks();
      refresh(true);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); commit('Move mask'); refresh(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ── Steps that run in the worker ────────────────────────────────────────────────────────────────────────────
  async function work(label, fn, quiet) {
    if (st.busy) return null;
    st.busy = true;
    root.classList.add('busy');
    if (!quiet) tipBusy(`${label}…`);
    try { return await fn(); } catch (e) { if (!disposed) toast(plain(e), { type: 'error' }); return null; } finally {
      st.busy = false;
      root.classList.remove('busy');
      if (!quiet) tip(null);
      $$('.act', props).forEach((b) => { b.disabled = false; });
    }
  }
  async function runDevelop(kind, params = {}, label) {
    return work(BUSY[kind] || 'Working', async () => {
      const res = await call('develop', st.sess.id, editState(), kind, params);
      if (kind === 'straighten' && res.result && res.result.changed === false) { toast(res.result.reason ? `Nothing to straighten: ${res.result.reason}.` : 'This photo is already level.'); return; }
      if (kind === 'dust' && res.dev.spots.length === st.dev.spots.length) { toast('No dust spots were found.'); return; }
      const turned = res.dev.crop?.geometry?.angle !== st.dev.crop.geometry.angle || keyOf(res.dev.crop) !== keyOf(st.dev.crop);
      st.dev = res.dev;
      st.dev.spots ||= []; st.dev.red_eye ||= [];
      commit(label);
      if (kind === 'dust') toast(`${res.dev.spots.length - st.hist[st.at - 1].state.dev.spots.length} dust spots healed.`, { type: 'success' });
      if (turned) layout(); else refresh();
      renderProps();
    });
  }
  async function runStep(kind, label, opts = {}) {
    return work(BUSY[kind] || label, async () => {
      const res = await call('step', st.sess.id, editState(), kind, opts);
      st.dims[res.base] = { w: res.w, h: res.h, alpha: res.alpha };
      st.base = res.base;
      if (res.dev) { st.dev = res.dev; st.dev.spots ||= []; st.dev.red_eye ||= []; toast('The RAW was developed into the picture first; its light and colour sliders start again from here.'); }
      commit(label);
      layout();
      renderProps();
    });
  }

  // ── Tools and the panel ─────────────────────────────────────────────────────────────────────────────────────
  function selectTool(t) {
    endText();
    const was = st.tool;
    st.tool = t;
    st.sel = MARKUP.has(t) ? st.sel : null;
    $$('[data-tool]', root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === t));
    stage.className = `stage t-${t}`;
    if (was === 'crop' || t === 'crop') { cropIntent = null; layout(); } else { drawMarks(); drawInk(); }
    tip(TOOLS.find((x) => x[0] === t)?.[3]);
    renderProps();
  }
  function tip(msg, keep) {
    status.hidden = !msg;
    status.textContent = msg || '';
    clearTimeout(tip.t);
    if (msg && !keep) tip.t = setTimeout(() => { status.hidden = true; }, 4500);
  }
  function tipBusy(msg) { status.hidden = false; status.innerHTML = `<span class="spin"></span>${esc(msg)}`; clearTimeout(tip.t); }
  const paintRange = (r) => r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`);
  props.addEventListener('input', (e) => { if (e.target.type === 'range') paintRange(e.target); });
  function renderProps() {
    const scroll = props.scrollTop;
    drawProps();
    props.querySelectorAll('input[type=range]').forEach(paintRange);
    props.scrollTop = scroll;
    paintHistogram();
  }
  const head = (txt, extra = '') => h(`<div class="head"><h3>${esc(txt)}</h3>${extra}</div>`);
  const swatch = (list, val, fn, extra = []) => {
    const el = h(`<div class="swatches">${[...extra, ...list].map((c) => `<button style="background:${c === 'none' || c === 'transparent' ? '#fff' : c}" data-c="${c}" aria-label="${c}" aria-pressed="${c.toLowerCase() === String(val).toLowerCase()}"></button>`).join('')}<label class="custom" title="Custom colour"><input type="color" value="${/^#[0-9a-f]{6}$/i.test(val) ? val : '#000000'}" aria-label="Custom colour"></label></div>`);
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { fn(b.dataset.c); renderProps(); } });
    $('input', el).addEventListener('change', (e) => { fn(e.target.value); renderProps(); });
    return el;
  };
  // Relative white balance like Lightroom shows for JPEGs: 0 is as shot, ±100 about ±80 mired; RAWs show kelvin.
  const asShot = () => st.sess.asShot || [6500, 0];
  function wbGet(key) {
    const wb = st.dev.wb, [k0, t0] = asShot();
    if (wb.mode === 'asShot') return 0;
    if (key === 'tint') return Math.round(clamp((wb.tint ?? t0) - t0, -100, 100));
    return Math.round(clamp((1e6 / k0 - 1e6 / (wb.temp || k0)) / 0.8, -100, 100));
  }
  function wbSet(key, v) {
    const [k0, t0] = asShot(), r = key === 'temp' ? v : wbGet('temp'), t = key === 'tint' ? v : wbGet('tint');
    st.dev.wb = !r && !t ? { mode: 'asShot', temp: k0, tint: t0, ...(st.sess.kelvin ? { scale: 'kelvin' } : {}) } : { mode: 'custom', temp: Math.round(1e6 / (1e6 / k0 - 0.8 * r)), tint: t0 + t, ...(st.sess.kelvin ? { scale: 'kelvin' } : {}) };
  }
  const value = (d) => (d.get ? d.get() : d.key === 'temp' || d.key === 'tint' ? wbGet(d.key) : Number(getPath(st.dev, d.key) ?? 0));
  const defaultOf = (d) => DEFAULTS[d.key] ?? 0;
  const fmtOf = (d, v) => (d.key === 'temp' && st.sess.kelvin ? `${st.dev.wb.mode === 'asShot' ? asShot()[0] : st.dev.wb.temp} K` : d.fmt ? d.fmt(v) : d.mid ? signed(v) : String(Math.round(v)));
  function slider(d, onSet = null) {
    const v = value(d);
    const el = h(`<div class="sl${d.mid ? ' mid' : ''}${d.track ? ' track' : ''}${Math.abs(v - defaultOf(d)) > 1e-9 ? ' changed' : ''}" data-k="${esc(d.key)}"><label title="Double-click to reset">${esc(d.label)}</label><input type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}" aria-label="${esc(d.label)}"${d.track ? ` style="--track:${d.track}"` : ''}><output>${esc(fmtOf(d, v))}</output></div>`);
    const input = $('input', el), out = $('output', el);
    const set = (n) => {
      if (onSet) onSet(n); else if (d.key === 'temp' || d.key === 'tint') wbSet(d.key, n); else setPath(st.dev, d.key, n);
      out.textContent = fmtOf(d, n);
      el.classList.toggle('changed', Math.abs(n - defaultOf(d)) > 1e-9);
    };
    input.addEventListener('input', () => { set(Number(input.value)); if (d.live) d.live(Number(input.value)); else refresh(true); });
    input.addEventListener('change', () => { if (d.done) d.done(Number(input.value)); else { commit(d.label); refresh(); } });
    $('label', el).addEventListener('dblclick', () => { input.value = defaultOf(d); paintRange(input); set(defaultOf(d)); if (d.done) d.done(defaultOf(d)); else { commit(d.label); refresh(); } });
    return el;
  }
  function section(title, rows, { open = true, reset } = {}) {
    const el = h(`<details class="sec"${open && !(st.closed || []).includes(title) ? ' open' : ''}><summary>${esc(title)}${reset ? '<button class="reset" title="Reset this section">Reset</button>' : ''}</summary></details>`);
    rows.forEach((r) => el.append(r));
    el.addEventListener('toggle', () => { st.closed = (st.closed || []).filter((x) => x !== title).concat(el.open ? [] : [title]); });
    if (reset) $('.reset', el).addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); reset(); commit(`Reset ${title.toLowerCase()}`); renderProps(); refresh(); });
    return el;
  }
  function resetKeys(keys) { for (const k of keys) { if (k === 'temp' || k === 'tint') wbSet(k, 0); else setPath(st.dev, k, DEFAULTS[k] ?? 0); } }

  function drawProps() {
    props.innerHTML = '';
    props.onclick = null;
    if (!st.dev) return;
    const t = st.tool;
    if (t === 'adjust') return adjustPanel();
    if (t === 'looks') return looksPanel();
    if (t === 'enhance') return enhancePanel();
    if (t === 'crop') return cropPanel();
    if (t === 'resize') return resizePanel();
    if (t === 'heal') return healPanel();
    if (t === 'redeye') return eyePanel();
    if (t === 'mask') return maskPanel();
    return markupPanel();
  }
  function adjustPanel() {
    const bw = st.dev.treatment === 'bw';
    props.append(h('<canvas class="hist" aria-label="Histogram"></canvas>'), h('<div class="histinfo"></div>'));
    const top = h(`<div class="row nowrap"><button class="btn" data-x="auto" title="LightCraft sets light and colour for this photo">${icon('sparkle', 'sm')}Auto</button><div class="seg" role="group"><button data-x="color" aria-pressed="${!bw}">Colour</button><button data-x="bw" aria-pressed="${bw}">B&amp;W</button></div></div>`);
    top.addEventListener('click', (e) => {
      const x = e.target.closest('[data-x]')?.dataset.x;
      if (x === 'auto') runDevelop('auto', {}, 'Auto');
      if (x === 'color' || x === 'bw') { st.dev.treatment = x === 'bw' ? 'bw' : 'color'; commit(x === 'bw' ? 'Black & white' : 'Colour'); renderProps(); refresh(); }
    });
    props.append(top);
    props.append(profileRow());
    for (const [title, defs] of PANELS) {
      if (title === 'Colour mixer') { props.append(mixerSection(bw)); continue; }
      if (title === 'Colour grading') { props.append(gradingSection()); continue; }
      const rows = defs.filter((d) => !(bw && ['color.vibrance', 'color.saturation'].includes(d.key))).map((d) => slider(d));
      if (title === 'Curve') rows.push(curveWidget());
      if (title === 'Optics') rows.unshift(toggle('optics.lens_profile', 'Lens profile corrections'), toggle('optics.remove_ca', 'Remove chromatic aberration'));
      props.append(section(title, rows, { open: ['Light', 'Colour', 'Presence'].includes(title), reset: () => { resetKeys(defs.map((d) => d.key)); if (title === 'Curve') Object.assign(st.dev.curve, { master: [], red: [], green: [], blue: [] }); if (title === 'Optics') Object.assign(st.dev.optics, { lens_profile: false, remove_ca: false }); } }));
    }
    const all = h(`<button class="btn subtle" data-x="resetall" style="justify-self:start" title="Back to the original image; Undo brings the edits back">${icon('again', 'sm')}Reset all edits</button>`);
    all.addEventListener('click', resetAll);
    props.append(all);
  }
  // LightCraft's profiles, as Lightroom's: the starting look, with an amount for the creative ones.
  function profileRow() {
    const box = h('<div class="field"></div>'), p = st.dev.profile || { id: 'lc.color', amount: 100 };
    const groups = [...new Set((st.profiles || []).map((x) => x.group))];
    const sel = h(`<select class="input" aria-label="Profile">${st.profiles ? groups.map((g) => `<optgroup label="${esc(g)}">${st.profiles.filter((x) => x.group === g).map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</optgroup>`).join('') : `<option value="${esc(p.id)}">${esc(p.id === 'lc.color' ? 'Color' : p.id)}</option>`}</select>`);
    sel.value = p.id;
    sel.addEventListener('change', () => { st.dev.profile = { ...p, id: sel.value, amount: 100 }; commit('Profile'); renderProps(); refresh(); });
    const row = h('<div class="sl"><label>Profile</label></div>');
    row.append(sel);
    sel.style.gridColumn = 'span 2';
    box.append(row);
    if (p.id !== 'lc.color') box.append(slider(S('profile.amount', 'Amount', 0, 200, 1, { mid: false, fmt: (v) => `${Math.round(v)}%` })));
    if (!st.profiles) call('profiles').then((list) => { st.profiles = list; if (st.tool === 'adjust') renderProps(); }).catch(() => { st.profiles = []; });
    return box;
  }
  function toggle(key, label) {
    const el = h(`<label class="switch"><span class="text-sm">${esc(label)}</span><input type="checkbox"${getPath(st.dev, key) ? ' checked' : ''}></label>`);
    $('input', el).addEventListener('change', (e) => { setPath(st.dev, key, e.target.checked); commit(label); refresh(); });
    return el;
  }
  function gradingSection() {
    const rows = [];
    for (const [k, label] of [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']]) {
      rows.push(h(`<div class="label">${label}</div>`));
      const hue = Number(getPath(st.dev, `grading.${k}.hue`) || 0), col = `hsl(${hue},75%,55%)`;
      rows.push(slider({ ...S(`grading.${k}.hue`, 'Hue', 0, 360), mid: false, track: RAINBOW, fmt: (v) => `${Math.round(v)}°` }), slider({ ...S(`grading.${k}.sat`, 'Saturation', 0, 100), track: `linear-gradient(90deg,#9a9a9a,${col})` }));
    }
    rows.push(slider(S('grading.blending', 'Blending', 0, 100)), slider(S('grading.balance', 'Balance')));
    return section('Colour grading', rows, { open: false, reset: () => resetKeys(['shadows', 'midtones', 'highlights'].flatMap((k) => [`grading.${k}.hue`, `grading.${k}.sat`]).concat(['grading.blending', 'grading.balance'])) });
  }
  function mixerSection(bw) {
    if (bw) return section('B&W mix', HUES.map(([k, c]) => slider({ ...S(`bw_mix.${k}`, k[0].toUpperCase() + k.slice(1)), track: `linear-gradient(90deg,#222,${c},#eee)` })), { open: false, reset: () => resetKeys(HUES.map(([k]) => `bw_mix.${k}`)) });
    const cur = st.mixer, col = HUES.find(([k]) => k === cur)[1];
    const dots = h(`<div class="dots" role="group" aria-label="Colour">${HUES.map(([k, c]) => `<button data-hue="${k}" style="background:${c}" title="${k[0].toUpperCase() + k.slice(1)}" aria-pressed="${k === cur}"></button>`).join('')}</div>`);
    dots.addEventListener('click', (e) => { const b = e.target.closest('[data-hue]'); if (b) { st.mixer = b.dataset.hue; renderProps(); } });
    const i = HUES.findIndex(([k]) => k === cur), prev = HUES[(i + 7) % 8][1], next = HUES[(i + 1) % 8][1];
    return section('Colour mixer', [dots,
      slider({ ...S(`mixer.${cur}.hue`, 'Hue'), track: `linear-gradient(90deg,${prev},${col},${next})` }),
      slider({ ...S(`mixer.${cur}.sat`, 'Saturation'), track: `linear-gradient(90deg,#9a9a9a,${col})` }),
      slider({ ...S(`mixer.${cur}.lum`, 'Luminance'), track: `linear-gradient(90deg,#222,${col},#fff)` })], { open: false, reset: () => resetKeys(HUES.flatMap(([k]) => ['hue', 'sat', 'lum'].map((p) => `mixer.${k}.${p}`))) });
  }
  // Point curves, like Curves: one for the whole image and one for each of red, green and blue. Drag a point, click
  // to add one, drag one off the square to remove it.
  const CURVES = [['master', 'RGB', '#3d8a28'], ['red', 'Red', '#e8453c'], ['green', 'Green', '#3fae4a'], ['blue', 'Blue', '#3d7be8']];
  function curveWidget() {
    const box = h('<div class="field"></div>'), ch = st.curveCh || 'master', [, , colour] = CURVES.find((x) => x[0] === ch);
    const tabs = h(`<div class="seg" role="group" aria-label="Curve">${CURVES.map(([id, label]) => `<button data-ch="${id}" aria-pressed="${id === ch}"${(st.dev.curve[id] || []).length ? ' style="font-weight:650"' : ''}>${label}</button>`).join('')}</div>`);
    tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-ch]'); if (b) { st.curveCh = b.dataset.ch; renderProps(); } });
    const c = h('<canvas class="curve" title="Click to add a point; drag a point off the square to remove it"></canvas>');
    box.append(tabs, c);
    const pts = () => { const m = st.dev.curve[ch] || []; return m.length ? m.map((p) => [p.x, p.y]) : [[0, 0], [1, 1]]; };
    const paint = () => {
      const w = (c.clientWidth || 260) * dpr(), hh = Math.round(w / 1.3);
      c.width = w; c.height = hh;
      const cx = c.getContext('2d'), p = pts();
      cx.strokeStyle = 'rgba(128,128,128,.25)'; cx.lineWidth = 1;
      for (let i = 1; i < 4; i++) { cx.beginPath(); cx.moveTo((i / 4) * w, 0); cx.lineTo((i / 4) * w, hh); cx.moveTo(0, (i / 4) * hh); cx.lineTo(w, (i / 4) * hh); cx.stroke(); }
      if (histData) { cx.fillStyle = 'rgba(128,128,128,.18)'; const lum = histData.bins[{ red: 0, blue: 2 }[ch] ?? 1], peak = Math.max(...lum.slice(2, 254)) || 1; cx.beginPath(); cx.moveTo(0, hh); for (let i = 0; i < 256; i++) cx.lineTo((i / 255) * w, hh - Math.min(1, lum[i] / peak) * hh * 0.9); cx.lineTo(w, hh); cx.fill(); }
      cx.strokeStyle = ch === 'master' ? getComputedStyle(root).getPropertyValue('--accent') || colour : colour; cx.lineWidth = 2 * dpr();
      cx.beginPath();
      const f = spline(p);
      for (let i = 0; i <= 100; i++) { const x = i / 100; const y = clamp(f(x), 0, 1); if (i) cx.lineTo(x * w, (1 - y) * hh); else cx.moveTo(x * w, (1 - y) * hh); }
      cx.stroke();
      cx.fillStyle = '#fff';
      p.forEach(([x, y]) => { cx.beginPath(); cx.arc(x * w, (1 - y) * hh, 5 * dpr(), 0, Math.PI * 2); cx.fill(); cx.stroke(); });
    };
    requestAnimationFrame(paint);
    c.addEventListener('pointerdown', (e) => {
      const r = c.getBoundingClientRect(), at = (ev) => [clamp((ev.clientX - r.left) / r.width, 0, 1), clamp(1 - (ev.clientY - r.top) / r.height, 0, 1)];
      let p = pts(), [x, y] = at(e);
      let i = p.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 0.05);
      if (i < 0) { p.push([x, y]); p.sort((a, b) => a[0] - b[0]); i = p.findIndex((q) => q[0] === x && q[1] === y); }
      c.setPointerCapture(e.pointerId);
      const save = () => { st.dev.curve[ch] = p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1 ? [] : p.map(([px, py]) => ({ x: px, y: py })); };
      const move = (ev) => {
        const out = (ev.clientX < r.left - 20 || ev.clientX > r.right + 20 || ev.clientY < r.top - 20 || ev.clientY > r.bottom + 20) && i > 0 && i < p.length - 1;
        [x, y] = at(ev);
        const lo = i > 0 ? p[i - 1][0] + 0.01 : 0, hi = i < p.length - 1 ? p[i + 1][0] - 0.01 : 1;
        p[i] = [i === 0 ? Math.min(x, hi) : i === p.length - 1 ? Math.max(x, lo) : clamp(x, lo, hi), y];
        c.style.opacity = out ? '.5' : '';
        c._out = out;
        save(); paint(); refresh(true);
      };
      const up = () => { c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.style.opacity = ''; if (c._out) { p.splice(i, 1); c._out = false; } save(); paint(); commit('Curve'); refresh(); };
      c.addEventListener('pointermove', move);
      c.addEventListener('pointerup', up);
      save(); paint();
    });
    // Drawn again when its section opens, at its real size.
    requestAnimationFrame(() => c.closest('details')?.addEventListener('toggle', () => requestAnimationFrame(paint)));
    return box;
  }
  // Monotone cubic through the points, the shape a point curve takes.
  function spline(p) {
    const n = p.length, xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    if (n < 2) return () => 0;
    const d = [], m = [];
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    return (x) => {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0;
      while (x > xs[i + 1]) i++;
      const hh = xs[i + 1] - xs[i], t = (x - xs[i]) / hh, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1];
    };
  }
  function resetAll() {
    const first = st.hist[0].state;
    st.dev = clone(first.dev);
    st.base = first.base;
    st.overlays = [];
    st.output = { resize: null, canvas: null };
    st.sel = null;
    commit('Reset');
    layout();
    renderProps();
  }

  async function looksPanel() {
    props.append(head('Looks'), h('<p class="tip">LightCraft’s looks set the sliders in Adjust, so you can fine-tune them afterwards.</p>'));
    const amount = h('<div></div>');
    props.append(amount);
    if (st.look) {
      amount.append(slider({ key: 'amount', label: 'Amount', min: 0, max: 200, step: 1, fmt: (v) => `${Math.round(v)}%`, live: () => {}, done: (v) => applyLook(st.look.id, v) }, (v) => { st.look.amount = v; }));
      $('input', amount).value = st.look.amount;
      $('output', amount).textContent = `${st.look.amount}%`;
    }
    const grid = h('<div class="looks"></div>');
    props.append(grid);
    const sec = h('<div></div>');
    props.append(sec);
    sec.append(section('Paint effects', [h('<p class="tip">PhotoCraft filters, applied as a step on the picture.</p>'), (() => {
      const box = h(`<div class="actions">${PAINT.map(([id, label]) => `<button class="act" data-p="${id}">${icon('looks')}<span><b>${esc(label)}</b><small>PhotoCraft</small></span></button>`).join('')}</div>`);
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b && !st.busy) { $$('.act', props).forEach((x) => { x.disabled = true; }); runStep(b.dataset.p, PAINT.find((p) => p[0] === b.dataset.p)[1]); } });
      return box;
    })()], { open: true }));
    if (!st.looks) { grid.innerHTML = '<p class="note">Loading looks…</p>'; st.looks = await call('looks').catch(() => []); if (st.tool !== 'looks') return; }
    const all = [{ id: '', name: 'None', group: '' }, ...st.looks];
    grid.innerHTML = all.map((l) => `<button class="look" data-l="${esc(l.id)}" aria-pressed="${(st.look?.id || '') === l.id && (!!st.look || !l.id)}" title="${esc(l.group ? `${l.name} (${l.group})` : 'No look')}"><div class="tn"></div><span>${esc(l.name)}</span></button>`).join('');
    grid.addEventListener('click', (e) => { const b = e.target.closest('[data-l]'); if (b) applyLook(b.dataset.l, st.look?.amount ?? 100); });
    // Thumbnails of each look on this photo, a few at a time.
    const queue = all.filter((l) => !st.thumbs.has(l.id));
    const show = () => $$('.look', grid).forEach((b) => { const u = st.thumbs.get(b.dataset.l); if (u) $('.tn', b).style.backgroundImage = `url(${u})`; });
    show();
    const worker = async () => {
      while (queue.length && !disposed) {
        const l = queue.shift();
        const data = await call('lookThumb', st.sess.id, l.id || null, 180).catch(() => null);
        if (data) st.thumbs.set(l.id, URL.createObjectURL(new Blob([data], { type: 'image/jpeg' })));
        if (st.tool === 'looks') show();
      }
    };
    if (queue.length && !st.thumbing) { st.thumbing = true; Promise.all([worker(), worker(), worker()]).finally(() => { st.thumbing = false; }); }
  }
  // Trying looks one after another replaces the last one (one history step); other edits end the trying.
  async function applyLook(id, amount) {
    const trying = st.look && st.look.entry === st.at ? st.look : { before: clone(st.dev), entry: -1 };
    let dev = clone(trying.before);
    if (id) {
      const res = await work('Applying look', () => call('develop', st.sess.id, { ...editState(), dev: trying.before }, 'look', { id, amount }), true);
      if (!res) return;
      dev = res.dev;
    }
    if (trying.entry === st.at && st.at > 0) { st.at--; st.hist.length = st.at + 1; }
    st.dev = dev;
    st.dev.spots ||= []; st.dev.red_eye ||= [];
    commit('Look');
    st.look = id ? { id, amount, before: trying.before, entry: st.hist[st.at].label === 'Look' ? st.at : -1 } : null;
    renderProps();
    refresh();
  }
  function enhancePanel() {
    props.append(head('Enhance'));
    for (const [group, items] of ENHANCE) {
      const box = h(`<div class="actions">${items.map(([id, , ic, label, desc]) => `<button class="act" data-e="${id}"${st.busy ? ' disabled' : ''}>${icon(ic)}<span><b>${esc(label)}</b><small>${esc(desc)}</small></span></button>`).join('')}</div>`);
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-e]');
        if (!b || st.busy) return;
        const [id, kind, , label] = items.find((x) => x[0] === b.dataset.e);
        $$('.act', props).forEach((x) => { x.disabled = true; });
        if (kind === 'develop') runDevelop(id, id === 'upright' ? { mode: 'auto' } : {}, label);
        else runStep(id, label, id === 'removeBg' ? { quality: 'best', background: 'transparent' } : id === 'upscale' ? { factor: '2' } : id === 'blurFaces' ? { mode: 'blur', strength: 60 } : {});
      });
      props.append(section(group, [box]));
    }
  }
  function cropPanel() {
    const g = geo();
    props.append(head('Crop and straighten', '<button class="btn" data-x="done">Done</button>'));
    const chips = h(`<div class="chips aspects">${ASPECTS.map(([id, label]) => `<button class="chip" data-r="${id}" aria-pressed="${(st.cropAspect || 'free') === id}">${label}</button>`).join('')}<button class="chip" data-r="swap" title="Swap width and height" aria-pressed="${!!st.cropFlip}">⇄</button></div>`);
    chips.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      if (b.dataset.r === 'swap') st.cropFlip = !st.cropFlip; else st.cropAspect = b.dataset.r;
      const ratio = aspectRatio();
      if (ratio) { geo().rect = largest(ratio); commit('Crop'); layout(); }
      renderProps();
    });
    props.append(h('<div class="label">Shape</div>'), chips);
    props.append(slider({ key: 'angle', label: 'Straighten', min: -45, max: 45, step: 0.1, mid: true, fmt: (v) => `${Number(v).toFixed(1)}°`, live: (v) => setAngle(v, true), done: (v) => setAngle(v, false) }, () => {}));
    $('[data-k="angle"] input', props).value = g.angle;
    $('[data-k="angle"] output', props).textContent = `${g.angle.toFixed(1)}°`;
    const ops = h(`<div class="seg full">${[['left', 'rotate', 'Rotate left', 'transform:scaleX(-1)'], ['right', 'rotate', 'Rotate right', ''], ['flipH', 'flipH', 'Flip across', ''], ['flipV', 'flipV', 'Flip down', '']].map(([id, ic, label, css]) => `<button class="tb" data-o="${id}" title="${label}"><span style="${css}">${icon(ic)}</span><span class="lbl">${label}</span></button>`).join('')}</div>`);
    ops.addEventListener('click', (e) => { const b = e.target.closest('[data-o]'); if (b) reorient(b.dataset.o); });
    props.append(ops);
    const more = h(`<div class="row"><button class="btn" data-x="auto">${icon('level', 'sm')}Auto straighten</button><button class="btn" data-x="reset">Reset</button></div>`);
    props.append(more);
    props.onclick = cropClicks;
    props.append(h(`<p class="tip">Crop: ${outSize().join(' × ')} px. Drag outside the frame to straighten; Shift keeps the shape.</p>`));
  }
  function cropClicks(e) {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'done') selectTool('adjust');
    if (x === 'auto') runDevelop('straighten', {}, 'Straighten');
    if (x === 'reset') { st.dev.crop = { ...st.dev.crop, geometry: { angle: 0, rect: { x0: 0, y0: 0, x1: 1, y1: 1 } } }; st.cropAspect = 'free'; commit('Reset crop'); layout(); renderProps(); }
  }
  function resizePanel() {
    const [w, hh] = outSize(), r = st.output.resize, c = st.output.canvas, [fw, fh, rw, rh] = finalSize();
    props.append(head('Image size'));
    const lock = r ? r.lock !== false : true;
    const dims = h(`<div class="dims"><div class="field"><label class="label">Width</label><input class="input" type="number" min="1" data-d="w" value="${rw}"></div><button class="tb icon" data-d="lock" aria-pressed="${lock}" title="Keep the shape">${icon(lock ? 'check' : 'close', 'sm')}</button><div class="field"><label class="label">Height</label><input class="input" type="number" min="1" data-d="h" value="${rh}"${lock ? ' disabled' : ''}></div></div>`);
    const pct = h(`<div class="row"><div class="field" style="flex:1"><label class="label">Percent</label><input class="input" type="number" min="1" max="1000" data-d="pct" value="${Math.round((rw / w) * 100)}"></div><button class="btn" data-d="reset" style="align-self:end;flex:none">Original size</button></div>`);
    const apply = (nw, nh) => { st.output.resize = Math.round(nw) === w && (lock ? true : Math.round(nh) === hh) ? null : { w: Math.max(1, Math.round(nw)), h: Math.max(1, Math.round(nh)), lock }; commit('Resize'); layout(); renderProps(); };
    dims.addEventListener('change', (e) => { const d = e.target.dataset.d; if (d === 'w') apply(Number(e.target.value) || w, lock ? (Number(e.target.value) || w) * hh / w : rh); if (d === 'h') apply(rw, Number(e.target.value) || hh); });
    dims.addEventListener('click', (e) => { if (e.target.closest('[data-d=lock]')) { st.output.resize = { w: rw, h: rh, lock: !lock }; if (!lock) st.output.resize.h = Math.round(rw * hh / w); commit('Resize'); renderProps(); layout(); } });
    pct.addEventListener('change', (e) => { const p = Number(e.target.value) || 100; apply(w * p / 100, hh * p / 100); });
    pct.addEventListener('click', (e) => { if (e.target.closest('[data-d=reset]')) { st.output.resize = null; commit('Resize'); layout(); renderProps(); } });
    props.append(dims, pct, h(`<p class="tip">The crop is ${w} × ${hh} px.</p>`));
    // Canvas: more room around the picture (or less), from an anchor, like Photoshop's Canvas Size.
    const canvasRows = [];
    const cdims = h(`<div class="dims"><div class="field"><label class="label">Width</label><input class="input" type="number" min="1" data-c="w" value="${c ? c.w : rw}"></div><span></span><div class="field"><label class="label">Height</label><input class="input" type="number" min="1" data-c="h" value="${c ? c.h : rh}"></div></div>`);
    const anchor = (c?.anchor || [0.5, 0.5]).join(',');
    const grid = h(`<div class="field"><div class="label">Anchor</div><div class="anchor">${[0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => `<button data-an="${x},${y}" aria-pressed="${anchor === `${x},${y}`}" title="Keep the picture ${y === 0 ? 'at the top' : y === 1 ? 'at the bottom' : 'in the middle'}${x === 0 ? ', left' : x === 1 ? ', right' : ''}"></button>`)).join('')}</div></div>`);
    const setCanvas = (patch) => { const cur = st.output.canvas || { w: rw, h: rh, anchor: [0.5, 0.5], color: '#ffffff' }; st.output.canvas = { ...cur, ...patch }; if (st.output.canvas.w === rw && st.output.canvas.h === rh && patch.w != null) st.output.canvas = null; commit('Canvas'); layout(); renderProps(); };
    const colour = h('<div class="field"><div class="label">Colour</div></div>');
    colour.append(swatch(['#ffffff', '#000000', '#808080', '#f3efe6', '#d13438', '#0f6cbd'], c?.color || '#ffffff', (col) => setCanvas({ color: col }), ['transparent']));
    cdims.addEventListener('change', (e) => { const d = e.target.dataset.c; if (d) setCanvas({ [d]: Math.max(1, Number(e.target.value) || (d === 'w' ? rw : rh)) }); });
    grid.addEventListener('click', (e) => { const b = e.target.closest('[data-an]'); if (b) setCanvas({ anchor: b.dataset.an.split(',').map(Number) }); });
    const quick = h(`<div class="row"><button class="btn" data-q="5">Add 5%</button><button class="btn" data-q="sq">Square</button><button class="btn" data-q="none">None</button></div>`);
    quick.addEventListener('click', (e) => {
      const q = e.target.closest('[data-q]')?.dataset.q;
      if (q === '5') { const m = Math.round(Math.max(rw, rh) * 0.05); setCanvas({ w: rw + 2 * m, h: rh + 2 * m }); }
      if (q === 'sq') { const m = Math.max(rw, rh); setCanvas({ w: m, h: m }); }
      if (q === 'none') { st.output.canvas = null; commit('Canvas'); layout(); renderProps(); }
    });
    canvasRows.push(cdims, grid, colour, quick);
    props.append(section('Canvas', canvasRows, { open: !!c }));
    props.append(h(`<p class="tip"><b>Saves at ${fw} × ${fh} px.</b></p>`));
  }
  function healPanel() {
    const sel = st.spotSel >= 0 ? st.dev.spots[st.spotSel] : null, s = sel || st.heal;
    props.append(head(sel ? `Spot ${st.spotSel + 1}` : 'Heal', sel ? `<button class="btn danger" data-x="del">${icon('delete', 'sm')}Delete</button>` : ''));
    const modes = h(`<div class="seg full text">${[['remove', 'Remove', 'Rebuilds the spot from what is around it'], ['heal', 'Heal', 'Blends in texture from nearby'], ['clone', 'Clone', 'Copies another place exactly']].map(([id, label, title]) => `<button class="tb" data-m="${id}" aria-pressed="${s.mode === id}" title="${title}"><span class="lbl">${label}</span></button>`).join('')}</div>`);
    modes.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; if (sel) { sel.mode = b.dataset.m; commit('Spot'); refresh(); } else st.heal.mode = b.dataset.m; renderProps(); });
    props.append(modes);
    const target = sel || st.heal, upd = (k) => (v) => { target[k] = v; if (k === 'size') sizeBrush(); };
    const fin = (lbl) => () => { if (sel) { commit(lbl); refresh(); drawMarks(); } };
    props.append(slider({ key: 'size', label: 'Size', min: 0.003, max: 0.15, step: 0.001, fmt: (v) => `${Math.round(v * L())} px`, live: () => { if (sel) drawMarks(); }, done: fin('Spot size') }, upd('size')));
    $('[data-k="size"] input', props).value = target.size;
    $('[data-k="size"] output', props).textContent = `${Math.round(target.size * L())} px`;
    props.append(slider({ key: 'feather', label: 'Feather', min: 0, max: 100, step: 1, live: () => {}, done: fin('Spot feather') }, upd('feather')));
    $('[data-k="feather"] input', props).value = target.feather;
    $('[data-k="feather"] output', props).textContent = Math.round(target.feather);
    props.append(slider({ key: 'opacity', label: 'Opacity', min: 1, max: 100, step: 1, fmt: (v) => `${Math.round(v)}%`, live: () => {}, done: fin('Spot opacity') }, upd('opacity')));
    $('[data-k="opacity"] input', props).value = target.opacity;
    $('[data-k="opacity"] output', props).textContent = `${Math.round(target.opacity)}%`;
    const more = h(`<div class="row"><button class="btn" data-x="dust">${icon('sparkle', 'sm')}Find dust spots</button>${st.dev.spots.length ? '<button class="btn" data-x="clear">Clear all</button>' : ''}</div>`);
    props.append(more, h(`<p class="tip">${st.dev.spots.length ? `${st.dev.spots.length} spot${st.dev.spots.length === 1 ? '' : 's'}. Click one to change it; drag its dashed circle to take from somewhere else.` : 'Click a spot or brush along a mark. LightCraft picks a clean place to take from.'}</p>`));
    props.onclick = (e) => {
      const x = e.target.closest('[data-x]')?.dataset.x;
      if (st.tool !== 'heal' || !x) return;
      if (x === 'del') removeSel();
      if (x === 'dust') runDevelop('dust', { sensitivity: 50 }, 'Remove dust');
      if (x === 'clear') { st.dev.spots = []; st.spotSel = -1; commit('Clear spots'); refresh(); drawMarks(); renderProps(); }
    };
  }
  function eyePanel() {
    const sel = st.eyeSel >= 0 ? st.dev.red_eye[st.eyeSel] : null;
    props.append(head(sel ? `Red eye ${st.eyeSel + 1}` : 'Red eye', sel ? `<button class="btn danger" data-x="del">${icon('delete', 'sm')}Delete</button>` : ''));
    const upd = (k) => (v) => { if (sel) { if (k === 'size') { sel.rx = v; sel.ry = v; } else sel[k === 'pupil' ? 'pupil_size' : 'darken'] = v; } else st.eye[k] = v; if (k === 'size') { sizeBrush(); if (sel) drawMarks(); } };
    const fin = (lbl) => () => { if (sel) { commit(lbl); refresh(); } };
    for (const [k, label, min, max, step, val, fmt] of [['size', 'Size', 0.005, 0.08, 0.001, sel ? sel.rx : st.eye.size, (v) => `${Math.round(v * L())} px`], ['pupil', 'Pupil size', 0, 100, 1, sel ? sel.pupil_size : st.eye.pupil, (v) => String(Math.round(v))], ['darken', 'Darken', 0, 100, 1, sel ? sel.darken : st.eye.darken, (v) => String(Math.round(v))]]) {
      props.append(slider({ key: k, label, min, max, step, fmt, live: () => {}, done: fin(label) }, upd(k)));
      $(`[data-k="${k}"] input`, props).value = val;
      $(`[data-k="${k}"] output`, props).textContent = fmt(val);
    }
    // Animals' eyes glow green, yellow or white rather than red; LightCraft treats them differently.
    const pet = h(`<label class="switch"><span class="text-sm">Pet eye</span><input type="checkbox"${(sel ? sel.pet : st.eye.pet) ? ' checked' : ''}></label>`);
    $('input', pet).addEventListener('change', (ev) => { if (sel) { sel.pet = ev.target.checked; commit('Pet eye'); refresh(); } else st.eye.pet = ev.target.checked; });
    props.append(pet, h(`<p class="tip">${st.dev.red_eye.length ? `${st.dev.red_eye.length} eye${st.dev.red_eye.length === 1 ? '' : 's'} fixed. ` : ''}Click the middle of each red eye; the pupil inside the circle is found and darkened.</p>`));
    props.onclick = (e) => { if (st.tool === 'redeye' && e.target.closest('[data-x=del]')) removeSel(); };
  }
  function maskPanel() {
    const m = maskOf(), kind = maskKind();
    props.append(head(m ? m.name : 'Masks', m ? `<button class="btn danger" data-x="del">${icon('delete', 'sm')}Delete</button>` : ''));
    const kinds = h(`<div class="seg full">${MASK_KINDS.map(([id, ic, label]) => `<button class="tb" data-k="${id}" aria-pressed="${!m && st.maskNew === id}" title="New ${label.toLowerCase()} mask">${icon(ic)}<span class="lbl">${label}</span></button>`).join('')}</div>`);
    kinds.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { st.maskNew = b.dataset.k; st.maskSel = -1; drawMarks(); renderProps(); tip(`Drag on the photo to ${b.dataset.k === 'brush' ? 'paint the mask' : `place the ${b.dataset.k} gradient`}.`); } });
    props.append(h('<div class="label">New mask</div>'), kinds);
    if (st.dev.masks.length) {
      const list = h(`<div class="chips">${st.dev.masks.map((mk, i) => `<button class="chip" data-m="${i}" aria-pressed="${i === st.maskSel}">${esc(mk.name)} · ${esc({ linear: 'Linear', radial: 'Radial', brush: 'Brush' }[mk.components?.[0]?.shape?.kind] || 'Mask')}</button>`).join('')}</div>`);
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) { st.maskSel = Number(b.dataset.m); drawMarks(); renderProps(); } });
      props.append(list);
    }
    props.onclick = (e) => { if (st.tool === 'mask' && e.target.closest('[data-x=del]')) removeSel(); };
    if (!m) {
      props.append(h(`<p class="tip">${{ linear: 'Drag from where the effect is strongest to where it fades out, such as from the top of a sky down to the horizon.', radial: 'Drag out an oval around what to brighten or darken; Invert works outside it instead.', brush: 'Paint over the part to change; the size and softness are set after you start.' }[st.maskNew]}</p>`));
      return;
    }
    const sh = m.components[0].shape;
    const A = (key, label, min = -100, max = 100, step = 1, more = {}) => slider({ key: `mask.${key}`, label, min, max, step, mid: min < 0, get: () => m.adjust[key] ?? (key === 'amount' ? 100 : 0), ...more }, (v) => { m.adjust[key] = v; });
    props.append(section('Light', [A('exposure', 'Exposure', -4, 4, 0.01, { fmt: (v) => signed(v, 2) }), A('contrast', 'Contrast'), A('highlights', 'Highlights'), A('shadows', 'Shadows'), A('whites', 'Whites'), A('blacks', 'Blacks')]));
    props.append(section('Colour', [A('temp', 'Temp', -100, 100, 1, { track: TEMP.track }), A('tint', 'Tint', -100, 100, 1, { track: TINT.track }), A('saturation', 'Saturation')]));
    props.append(section('Presence and detail', [A('texture', 'Texture'), A('clarity', 'Clarity'), A('dehaze', 'Dehaze'), A('sharpness', 'Sharpness'), A('noise', 'Noise', 0, 100)]));
    const shape = [A('amount', 'Amount', 0, 200, 1, { mid: false, fmt: (v) => `${Math.round(v)}%` })];
    if (kind === 'radial') shape.push(slider({ key: 'mask.feather', label: 'Feather', min: 0, max: 100, step: 1, get: () => sh.feather ?? 50 }, (v) => { sh.feather = v; }));
    if (kind !== 'brush') {
      const inv = h(`<label class="switch"><span class="text-sm">${kind === 'radial' ? 'Invert: change outside the oval' : 'Invert'}</span><input type="checkbox"${m.invert ? ' checked' : ''}></label>`);
      $('input', inv).addEventListener('change', (e) => { m.invert = e.target.checked; commit('Invert mask'); refresh(); });
      shape.push(inv);
    } else {
      const P = st.paint, upd = (k) => (v) => { P[k] = v; if (k === 'size') sizeBrush(); };
      for (const [k, label, min, max, step, fmt] of [['size', 'Brush size', 0.005, 0.25, 0.001, (v) => `${Math.round(v * L())} px`], ['feather', 'Softness', 0, 100, 1, (v) => String(Math.round(v))], ['flow', 'Flow', 1, 100, 1, (v) => `${Math.round(v)}%`]]) {
        shape.push(slider({ key: `paint.${k}`, label, min, max, step, fmt, get: () => P[k], live: () => {}, done: () => {} }, upd(k)));
      }
      const er = h(`<div class="seg full text"><button class="tb" data-er="0" aria-pressed="${!P.erase}"><span class="lbl">Paint</span></button><button class="tb" data-er="1" aria-pressed="${!!P.erase}"><span class="lbl">Erase</span></button></div>`);
      er.addEventListener('click', (e) => { const b = e.target.closest('[data-er]'); if (b) { P.erase = b.dataset.er === '1'; renderProps(); } });
      shape.push(er);
    }
    props.append(section(kind === 'brush' ? 'Brush' : 'Shape', shape));
  }
  function markupPanel() {
    const o = st.sel, s = st.style, t = o ? (o.type === 'ink' ? 'draw' : o.type) : st.tool, v = o || s;
    const apply = (patch) => { if (o) { Object.assign(o, patch); drawInk(); drawMarks(); commit('Style'); if (editing === o) restyleEdit(); } else Object.assign(s, patch); };
    const l = L(), px = (u) => Math.max(1, Math.round(u * l));
    if (t === 'text') {
      props.append(head(o ? 'Text' : 'Add text'));
      const opt = ([id, label, css]) => `<option value="${esc(id)}" style="font-family:${esc(css)}">${esc(label)}</option>`;
      const mine = st.fonts.map((f) => [`sys:${f.family}`, f.family, fontCss(`sys:${f.family}`)]);
      const fontSel = h(`<select class="input" title="Font"><optgroup label="Lime">${FONTS.map(opt).join('')}</optgroup>${mine.length ? `<optgroup label="On this computer">${mine.map(opt).join('')}</optgroup>` : ''}</select>`);
      fontSel.value = v.font;
      if (fontSel.value !== v.font) fontSel.value = 'sans';
      fontSel.addEventListener('change', async () => { await document.fonts.load(`40px ${fontCss(fontSel.value)}`).catch(() => {}); apply({ font: fontSel.value }); });
      const size = h(`<input class="input" type="number" min="4" max="5000" step="1" value="${px(v.size)}" title="Size in pixels of the image">`);
      size.addEventListener('change', () => apply({ size: Math.max(2, Number(size.value) || 40) / l }));
      const row = h('<div class="row2"></div>'); row.append(fontSel, size); props.append(row);
      const btn = (key, ic, title) => `<button class="tb icon" data-s="${key}" aria-pressed="${!!v[key]}" title="${title}">${icon(ic)}</button>`;
      const al = (a, ic, title) => `<button class="tb icon" data-al="${a}" aria-pressed="${(v.align || 'left') === a}" title="${title}">${icon(ic)}</button>`;
      const style = h(`<div class="tstyle"><div class="seg">${btn('bold', 'bold', 'Bold (Ctrl B)')}${btn('italic', 'italic', 'Italic (Ctrl I)')}</div><div class="seg">${al('left', 'alignLeft', 'Align left')}${al('center', 'alignCenter', 'Centre')}${al('right', 'alignRight', 'Align right')}</div></div>`);
      style.addEventListener('click', (e) => { const b = e.target.closest('[data-s]'), a = e.target.closest('[data-al]'); if (b) apply({ [b.dataset.s]: !v[b.dataset.s] }); if (a) apply({ align: a.dataset.al }); if (b || a) renderProps(); });
      const looks = h(`<div class="seg full text">${[['plain', 'Plain'], ['shadow', 'Shadow'], ['outline', 'Outline'], ['label', 'Label']].map(([id, label]) => `<button class="tb" data-ts="${id}" aria-pressed="${(v.textStyle || 'plain') === id}"><span class="lbl">${label}</span></button>`).join('')}</div>`);
      looks.addEventListener('click', (e) => { const b = e.target.closest('[data-ts]'); if (b) { apply({ textStyle: b.dataset.ts }); renderProps(); } });
      props.append(style, h('<div class="label">Colour</div>'), swatch(COLORS, v.color, (c) => apply({ color: c })), h('<div class="label">Style</div>'), looks);
      if (v.textStyle === 'outline' || v.textStyle === 'label') props.append(h(`<div class="label">${v.textStyle === 'label' ? 'Label colour' : 'Outline colour'}</div>`), swatch(COLORS, v.bg || '#000000', (c) => apply({ bg: c })));
    } else {
      props.append(head({ draw: 'Draw', rect: 'Box', ellipse: 'Oval', arrow: 'Arrow', line: 'Line' }[t] || 'Shape'));
      props.append(h('<div class="label">Colour</div>'), swatch(COLORS, o ? o.color : s.stroke, (c) => (o ? apply({ color: c }) : (s.stroke = c))));
      props.append(slider({ key: 'width', label: 'Thickness', min: 1, max: 80, step: 1, fmt: (n) => `${Math.round(n)} px`, live: (n) => { if (o) { o.width = n / l; drawInk(); drawMarks(); } }, done: () => { if (o) commit('Thickness'); } }, (n) => { if (!o) s.width = n / l; }));
      $('[data-k="width"] input', props).value = px(v.width);
      $('[data-k="width"] output', props).textContent = `${px(v.width)} px`;
      if (t === 'rect' || t === 'ellipse') props.append(h('<div class="label">Fill</div>'), swatch(COLORS, (o || s).fill || 'none', (c) => apply({ fill: c }), ['none']));
    }
    props.append(slider({ key: 'opacity', label: 'Opacity', min: 0.1, max: 1, step: 0.05, fmt: (n) => `${Math.round(n * 100)}%`, live: (n) => { if (o) { o.opacity = n; drawInk(); } }, done: () => { if (o) commit('Opacity'); } }, (n) => { if (!o) s.opacity = n; }));
    $('[data-k="opacity"] input', props).value = v.opacity ?? 1;
    $('[data-k="opacity"] output', props).textContent = `${Math.round((v.opacity ?? 1) * 100)}%`;
    if (o) {
      const del = h(`<button class="btn danger" style="justify-self:start">${icon('delete', 'sm')}Delete</button>`);
      del.addEventListener('click', removeSel);
      props.append(del, h(`<p class="tip">${o.type === 'text' ? 'Click it with Text to type. ' : ''}Drag to move; drag the dot to resize.</p>`));
    } else props.append(h(`<p class="tip">${TOOLS.find((x) => x[0] === st.tool)?.[3] || ''}</p>`));
  }

  // ── History menu ────────────────────────────────────────────────────────────────────────────────────────────
  function historyMenu(btn) {
    document.querySelector('.histmenu')?.remove();
    const r = btn.getBoundingClientRect(), base = root.getBoundingClientRect();
    const menu = h(`<div class="histmenu" style="left:${r.left - base.left}px;top:${r.bottom - base.top + 6}px">${st.hist.map((x, i) => `<button data-i="${i}" class="${i === st.at ? 'cur' : i > st.at ? 'ahead' : ''}">${i === st.at ? icon('check', 'sm') : '<span style="width:16px"></span>'}${esc(x.label)}</button>`).reverse().join('')}</div>`);
    root.append(menu);
    const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', close, true); } };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
    menu.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { restore(Number(b.dataset.i)); menu.remove(); document.removeEventListener('pointerdown', close, true); } });
  }

  // ── Before and after ────────────────────────────────────────────────────────────────────────────────────────
  let badge = null;
  function showBefore(on) {
    if (st.before === on || !st.dev) return;
    st.before = on;
    $('[data-a=compare]', root).setAttribute('aria-pressed', on);
    badge?.remove();
    badge = on ? h('<div class="badge">Original</div>') : null;
    if (badge) stage.append(badge);
    pv.key = '';
    ink.hidden = on || st.tool === 'crop';
    drawInk();
    drawMarks();
    refresh();
  }

  // ── Saving ──────────────────────────────────────────────────────────────────────────────────────────────────
  const FORMATS = [['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP'], ['avif', 'AVIF'], ['tiff', 'TIFF'], ['heic', 'HEIC']];
  const LOSSY = ['jpg', 'webp', 'avif', 'heic'];
  const stem = () => nameOf(file).replace(/\.[^.]+$/, '');
  async function save(as) {
    endText();
    let target = st.savePath, fmt = st.saveFmt || { to: st.sess.keep };
    if (as || !target) {
      if (as) {
        const pick = await formatDialog(fmt);
        if (!pick) return false;
        fmt = pick;
        target = await api.invoke('dialog:save', { defaultPath: `${dirOf(file)}${sep}${stem()}.${pick.to}`, filters: [{ name: pick.to.toUpperCase(), extensions: [pick.to] }] });
        if (!target) return false;
        if (!/\.[a-z0-9]+$/i.test(target)) target += `.${pick.to}`;
      } else target = `${dirOf(file)}${sep}${stem()} (edited).${fmt.to}`;
    }
    if (target === file) { toast('Choose another name: the original stays as it is.', { type: 'error' }); return false; }
    const overlay = await renderOverlay();
    const res = await work('Saving', () => call('save', st.sess.id, editState(), overlay, target, fmt));
    if (!res) return false;
    st.savePath = res.path; st.saveFmt = fmt;
    st.savedKey = keyOf(snap());
    chrome();
    toast(`Saved ${nameOf(res.path)} (${res.w} × ${res.h})`, { type: 'success', actions: [{ label: 'Open', fn: () => api.invoke('shell:open', res.path) }, { label: 'Show in folder', fn: () => api.invoke('shell:show', res.path) }] });
    return true;
  }
  function formatDialog(fmt) {
    return new Promise((resolve) => {
      let to = FORMATS.some(([f]) => f === fmt.to) ? fmt.to : 'jpg', q = fmt.quality || 90;
      const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>Save as</h2>
        <div class="fmt">${FORMATS.map(([id, label]) => `<button class="chip" data-f="${id}" aria-pressed="${id === to}">${label}</button>`).join('')}</div>
        <div class="field" data-q><label class="label">Quality</label><div class="range"><input type="range" min="40" max="100" step="1" value="${q}"><output>${q}</output></div></div>
        <p class="muted text-sm" style="margin:0" data-n></p></div>
        <div class="foot"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">Choose where…</button></div></div></div>`);
      document.body.append(s);
      const range = $('input[type=range]', s), note = $('[data-n]', s);
      const sync = () => {
        $$('[data-f]', s).forEach((b) => b.setAttribute('aria-pressed', b.dataset.f === to));
        $('[data-q]', s).hidden = !LOSSY.includes(to);
        note.textContent = { jpg: 'Small and universal. No transparency.', png: 'Lossless, keeps transparency.', webp: 'Small, for the web; keeps transparency.', avif: 'Smallest, for modern browsers and apps.', tiff: st.dims[0] && st.sess.raw ? 'Lossless 16-bit, for print and further editing.' : 'Lossless, for print and further editing.', heic: 'Small, as iPhones save photos. No transparency.' }[to];
        paintRange(range);
      };
      sync();
      range.addEventListener('input', () => { q = Number(range.value); $('output', s).textContent = q; paintRange(range); });
      const done = (v) => { s.remove(); resolve(v); };
      s.addEventListener('click', (e) => {
        const f = e.target.closest('[data-f]');
        if (f) { to = f.dataset.f; sync(); }
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a) done(a === 'ok' ? { to, quality: LOSSY.includes(to) ? q : undefined } : null);
      });
      s.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); if (e.key === 'Enter') done({ to, quality: q }); e.stopPropagation(); });
    });
  }
  function confirm3(title, text) {
    return new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>${esc(title)}</h2><p class="muted" style="margin:0">${esc(text)}</p></div><div class="foot"><button class="btn primary" data-a="save">Save</button><button class="btn" data-a="discard">Don’t save</button><button class="btn" data-a="cancel">Cancel</button></div></div></div>`);
      document.body.append(s);
      $('[data-a=save]', s).focus();
      s.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { s.remove(); resolve(a); } });
    });
  }
  async function close() {
    endText();
    if (st.sess && keyOf(snap()) !== st.savedKey) {
      const choice = await confirm3(`Save changes to ${nameOf(file)}?`, 'Your edits will be lost if you don’t save them.');
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await save(false))) return;
    }
    go();
  }

  // ── Wiring ──────────────────────────────────────────────────────────────────────────────────────────────────
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]');
    if (t) { selectTool(t.dataset.tool); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || !st.sess) { if (a === 'close') go(); return; }
    if (a === 'close') close();
    if (a === 'undo') undo();
    if (a === 'redo') redo();
    if (a === 'history') historyMenu(e.target.closest('button'));
    if (a === 'zoomin') setZoom((st.zoom === 'fit' ? kd * dpr() : st.zoom) * 1.25);
    if (a === 'zoomout') setZoom((st.zoom === 'fit' ? kd * dpr() : st.zoom) / 1.25);
    if (a === 'fit') setZoom('fit');
    if (a === 'save') save(false);
    if (a === 'saveas') save(true);
  });
  const cmp = $('[data-a=compare]', root);
  cmp.addEventListener('pointerdown', (e) => { if (e.button === 0) showBefore(true); });
  ['pointerup', 'pointerleave'].forEach((ev) => cmp.addEventListener(ev, () => showBefore(false)));
  $('.zoom', root).addEventListener('change', (e) => setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value)));
  const onKey = (e) => {
    if (document.querySelector('.scrim') || editing) return;
    // A slider keeps its arrow keys, but the shortcuts still work after dragging one.
    const slid = e.target.matches?.('input[type=range], input[type=checkbox]');
    if (e.target.matches?.('input, textarea, select') && !slid) return;
    if (slid && (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')) return;
    const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === '\\' && !c) { e.preventDefault(); showBefore(e.type === 'keydown'); return; }
    if (e.type !== 'keydown') return;
    if (c && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (c && k === 'y') { e.preventDefault(); redo(); }
    else if (c && k === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (c && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom((st.zoom === 'fit' ? kd * dpr() : st.zoom) * 1.25); }
    else if (c && e.key === '-') { e.preventDefault(); setZoom((st.zoom === 'fit' ? kd * dpr() : st.zoom) / 1.25); }
    else if (c && e.key === '0') { e.preventDefault(); setZoom('fit'); }
    else if (c && e.key === '1') { e.preventDefault(); setZoom(1); }
    else if (c && k === 'd' && st.sel) { e.preventDefault(); const o = addObj(clone(strip(st.sel))); shiftObj(o, 0.02, 0.02); select(o); commit('Duplicate'); drawInk(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && removeSel()) e.preventDefault();
    else if (st.sel && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = (e.shiftKey ? 10 : 1) / L(), dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      shiftObj(st.sel, dx, dy); drawInk(); drawMarks(); commit('Move');
    }
    else if (e.key === 'Enter' && st.tool === 'crop') selectTool('adjust');
    else if (e.key === 'Escape') { if (st.sel || st.spotSel >= 0 || st.eyeSel >= 0) { st.sel = null; st.spotSel = -1; st.eyeSel = -1; drawMarks(); renderProps(); } else if (st.tool !== 'adjust') selectTool('adjust'); }
    else if (!c && !e.altKey && KEYS[k]) selectTool(KEYS[k]);
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKey);
  stage.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || st.tool === 'crop') return;
    e.preventDefault();
    const d = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
    setZoom((st.zoom === 'fit' ? kd * dpr() : st.zoom) * Math.exp(-d * 0.0065), { x: e.clientX, y: e.clientY });
  }, { passive: false });
  // Hold Space and drag (or drag with the middle button) to move around a zoomed-in photo.
  let spaceDown = false;
  const onSpace = (e) => { if (e.code === 'Space' && !editing && !e.target.matches?.('input, textarea, select, [contenteditable]')) { spaceDown = e.type === 'keydown'; stage.classList.toggle('panning', spaceDown); if (spaceDown) e.preventDefault(); } };
  document.addEventListener('keydown', onSpace);
  document.addEventListener('keyup', onSpace);
  stage.addEventListener('pointerdown', (e) => {
    if (!(spaceDown || e.button === 1)) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, l0 = stage.scrollLeft, t0 = stage.scrollTop;
    stage.classList.add('grabbing');
    const mv = (ev) => { stage.scrollLeft = l0 - (ev.clientX - sx); stage.scrollTop = t0 - (ev.clientY - sy); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); stage.classList.remove('grabbing'); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }, true);
  let roT = null;
  const ro = new ResizeObserver(() => { clearTimeout(roT); roT = setTimeout(() => { if (st.zoom === 'fit' || st.tool === 'crop') layout(); }, 60); });
  ro.observe(stage);
  // For the tests: the edit as data, and a way to wait for the preview to catch up.
  root.__imged = { st, refresh, layout, commit, selectTool, idle: () => !pv.busy && !st.busy && !pv.again && !refreshT, normFromOut, outFromNorm };

  load();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKey);
    document.removeEventListener('keydown', onSpace);
    document.removeEventListener('keyup', onSpace);
    ro.disconnect();
    if (pv.url) URL.revokeObjectURL(pv.url);
    st.thumbs.forEach((u) => URL.revokeObjectURL(u));
    if (st.sess) call('close', st.sess.id).catch(() => {});
  };
  // The window closing ends the session too, so its working copies are removed.
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
