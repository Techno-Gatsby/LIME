import { $, $$, esc, h, nameOf, dirOf, sep, clean } from './ui.js';

// The audio and video editor. Every change is a value in one edit list (E): the preview shows it live (WebGL for the
// picture, Web Audio for the sound, a cleaned-up copy for noise and pitch), and Save hands the same list to the worker,
// which renders it with one FFmpeg run.
const IC = {
  play: 'M8 5.5v13l10.5-6.5z', pause: 'M8 5h3v14H8zM13 5h3v14h-3z', stepBack: 'M17 6l-7 6 7 6zM7 6v12', stepFwd: 'M7 6l7 6-7 6zM17 6v12',
  trim: 'M9 4H5v16h4M15 4h4v16h-4', split: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM8.2 7.8L20 19M8.2 16.2L20 5',
  crop: 'M6 2v16h16M2 6h16v16', rotate: 'M19 12a7 7 0 11-2.05-4.95M19 4v4h-4', flipH: 'M12 3v18M9 7L3 17h6zM15 7l6 10h-6z', flipV: 'M3 12h18M7 9L17 3v6zM7 15l10 6v-6z',
  resize: 'M4 14v6h6M20 10V4h-6M4 20l7-7M20 4l-7 7', speed: 'M4.9 18a9 9 0 1114.2 0M12 13l4-5',
  colour: 'M12 3a9 9 0 100 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 005-5c0-4.2-4-7.8-9-7.8zM7.5 11.5h.01M10.5 7.5h.01M15 7.5h.01',
  title: 'M5 7V5h14v2M12 5v14M9 19h6', fade: 'M3 19L21 5v14z', sound: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12', mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6',
  music: 'M9 18V6l10-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zM19 16a3 3 0 11-6 0 3 3 0 016 0z', subs: 'M3 5h18v14H3zM10.5 10.2a2.5 2.5 0 100 3.6M17.5 10.2a2.5 2.5 0 100 3.6',
  scenes: 'M4 5h16v14H4zM9 5v14M15 5v14', stabilise: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 16a4 4 0 100-8 4 4 0 000 8z', frame: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  eq: 'M6 4v16M12 4v16M18 4v16M4 14h4M10 8h4M16 16h4', clean: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z',
  pitch: 'M3 12c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 4.5 0 3 4 4.5 0', channels: 'M5 7h5v10H5zM14 7h5v10h-5z', volume: 'M4 9h4l5-4v14l-5-4H4z',
  markIn: 'M10 4H6v16h4M13 12h7M17 9l3 3-3 3', markOut: 'M14 4h4v16h-4M4 12h7M8 9l3 3-3 3', cutPart: 'M4 7h16M7 7v12h10V7M10 4h4', loop: 'M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4',
  reverse: 'M10 7l-5 5 5 5M19 12H5',
};
const TOOLS = {
  trim: ['trim', 'Trim', 'Drag the handles to trim; split with S and press Delete to cut a part out.'],
  crop: ['crop', 'Crop', 'Crop, turn and flip the picture.'],
  resize: ['resize', 'Resize', 'Make the saved video smaller or larger.'],
  speed: ['speed', 'Speed', 'Faster or slower, backwards and looped.'],
  colour: ['colour', 'Colour', 'Brightness, contrast, warmth and FilmCraft looks.'],
  titles: ['title', 'Titles', 'Words on the picture, with their own timing.'],
  fade: ['fade', 'Fade', 'Fade in from black and out to black.'],
  sound: ['sound', 'Sound', 'Volume, loudness, EQ, noise and more.'],
  volume: ['volume', 'Volume', 'Louder, quieter or levelled to a standard loudness.'],
  eq: ['eq', 'EQ', 'Bass, treble and presets for voice and music.'],
  clean: ['clean', 'Clean up', 'Take out noise and hum, or cut the silences.'],
  pitch: ['pitch', 'Pitch', 'Higher or lower without changing the speed.'],
  channels: ['channels', 'Channels', 'Mono, or move the sound left or right.'],
  music: ['music', 'Music', 'Add a music track, under the sound or instead of it.'],
  subs: ['subs', 'Subtitles', 'Burn a subtitle file into the picture.'],
  scenes: ['scenes', 'Scenes', 'FilmCraft finds each cut, so you can split the clip at every shot.'],
  stabilise: ['stabilise', 'Stabilise', 'Steady shaky footage.'],
  frame: ['frame', 'Frame', 'Save the frame under the playhead as a picture.'],
};
const GROUPS = {
  video: [['Edit', ['trim', 'crop', 'resize', 'speed']], ['Look', ['colour', 'titles', 'fade']], ['Sound', ['sound', 'music', 'subs']], ['FilmCraft', ['scenes', 'stabilise', 'frame']]],
  audio: [['Edit', ['trim', 'fade', 'speed']], ['Sound', ['volume', 'eq', 'clean']], ['Shape', ['pitch', 'channels']]],
};
const FONTS = [['sans', 'Noto Sans', '"Noto Sans",sans-serif'], ['serif', 'Noto Serif', '"Noto Serif",serif'], ['carlito', 'Carlito', 'Carlito,sans-serif'], ['mono', 'Noto Sans Mono', '"Noto Sans Mono",monospace'], ['caveat', 'Caveat', 'Caveat,cursive'], ['dancing', 'Dancing Script', '"Dancing Script",cursive']];
const fontCss = (f) => (FONTS.find((x) => x[0] === f) || FONTS[0])[2];
const COLORS = ['#ffffff', '#000000', '#ffd60a', '#ff9f0a', '#ff453a', '#30d158', '#64d2ff', '#0a84ff', '#bf5af2'];
const EQS = [['flat', 'Flat', {}], ['bass', 'Bass boost', { bass: 6 }], ['treble', 'Treble boost', { treble: 5 }], ['voice', 'Voice', { lowcut: 90, bass: -2, mid: 3, midHz: 3000 }],
  ['warm', 'Warm', { bass: 3, treble: -2 }], ['bright', 'Bright', { treble: 3, mid: 2, midHz: 5000 }], ['rumble', 'Low cut', { lowcut: 120 }]];
const SIZES = [[0, 'Original'], [2160, '2160p (4K)'], [1440, '1440p'], [1080, '1080p (Full HD)'], [720, '720p (HD)'], [480, '480p'], [360, '360p']];
const ASPECTS = [['free', 'Free'], ['orig', 'Full'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:5', '4:5'], ['4:3', '4:3']];
const ZERO_COLOUR = { temperature: 0, tint: 0, brightness: 0, contrast: 0, gamma: 0, saturation: 0 };
const ZERO_AUDIO = { gain: 0, normalise: false, target: -16, eq: 'flat', bass: 0, treble: 0, mid: 0, midHz: 3000, lowcut: 0, denoise: '', hum: 0, pitch: 0, mono: false, balance: 0 };
const N = 64; // colour cube steps, as the worker's HALD picture

const fmtT = (t, frac = 2) => {
  t = Math.max(0, Number(t) || 0);
  const hh = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t - Math.floor(t / 60) * 60;
  const ss = s.toFixed(frac).padStart(frac ? frac + 3 : 2, '0');
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const parseT = (v) => { const p = String(v).trim().split(':').map(Number); return p.some((x) => !Number.isFinite(x)) ? null : p.reduce((a, x) => a * 60 + x, 0); };
const mediaUrl = (p) => `media://file/${encodeURI(String(p).replace(/\\/g, '/')).replace(/[?#]/g, encodeURIComponent)}`;
const ev = (x) => Math.max(2, Math.round(x / 2) * 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dB = (x) => 10 ** (x / 20);

// ── Colour ───────────────────────────────────────────────────────────────────────────────────────────────────────
// White balance follows FFmpeg's colortemperature (a black-body tint that keeps the lightness), made relative to 6500 K
// so the middle of the slider changes nothing; the rest follows eq. The result is one cube shared by preview and save.
function kelvin(k) {
  const t = k / 100;
  const r = t <= 66 ? 1 : 1.29293618606 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 0.39008157877 * Math.log(t) - 0.63184144379 : 1.12989086090 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 1 : t <= 19 ? 0 : 0.54320678911 * Math.log(t - 10) - 1.19625408914;
  return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1)];
}
function sample(lut, r, g, b) {
  const x = clamp(r, 0, 1) * (N - 1), y = clamp(g, 0, 1) * (N - 1), z = clamp(b, 0, 1) * (N - 1);
  const x0 = Math.min(N - 2, Math.floor(x)), y0 = Math.min(N - 2, Math.floor(y)), z0 = Math.min(N - 2, Math.floor(z)), fx = x - x0, fy = y - y0, fz = z - z0, out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const at = (i, j, k) => lut[((k * N + j) * N + i) * 3 + c];
    const a = at(x0, y0, z0) + (at(x0 + 1, y0, z0) - at(x0, y0, z0)) * fx, bb = at(x0, y0 + 1, z0) + (at(x0 + 1, y0 + 1, z0) - at(x0, y0 + 1, z0)) * fx;
    const cc = at(x0, y0, z0 + 1) + (at(x0 + 1, y0, z0 + 1) - at(x0, y0, z0 + 1)) * fx, d = at(x0, y0 + 1, z0 + 1) + (at(x0 + 1, y0 + 1, z0 + 1) - at(x0, y0 + 1, z0 + 1)) * fx;
    out[c] = ((a + (bb - a) * fy) * (1 - fz) + (cc + (d - cc) * fy) * fz) / 255;
  }
  return out;
}
function buildCube(c, look, log, mix) {
  const plain = Object.keys(ZERO_COLOUR).every((k) => !c[k]);
  if (plain && !look && !log) return null;
  const base = kelvin(6500), warm = kelvin(6500 - c.temperature * 40), m = [warm[0] / base[0], warm[1] / base[1] * (1 - c.tint * 0.0025), warm[2] / base[2]];
  const bright = c.brightness / 400, con = 1 + c.contrast / 100, gam = 2 ** (c.gamma / 100), sat = 1 + c.saturation / 100, k = (mix ?? 100) / 100;
  const out = new Uint8Array(N * N * N * 3);
  let o = 0;
  for (let bi = 0; bi < N; bi++) for (let gi = 0; gi < N; gi++) for (let ri = 0; ri < N; ri++) {
    let r = ri / (N - 1), g = gi / (N - 1), b = bi / (N - 1);
    if (log) [r, g, b] = sample(log, r, g, b);
    if (c.temperature || c.tint) {
      const l0 = Math.max(r, g, b) + Math.min(r, g, b) + 1e-6;
      let nr = r * m[0], ng = g * m[1], nb = b * m[2];
      const l = l0 / (Math.max(nr, ng, nb) + Math.min(nr, ng, nb) + 1e-6);
      nr *= l; ng *= l; nb *= l;
      r = nr; g = ng; b = nb;
    }
    if (!plain) {
      const f = (x) => Math.max(0, (x + bright - 0.5) * con + 0.5) ** (1 / gam);
      r = f(r); g = f(g); b = f(b);
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = y + (r - y) * sat; g = y + (g - y) * sat; b = y + (b - y) * sat;
    }
    if (look) { const [lr, lg, lb] = sample(look, r, g, b); r += (lr - r) * k; g += (lg - g) * k; b += (lb - b) * k; }
    out[o++] = clamp(Math.round(r * 255), 0, 255); out[o++] = clamp(Math.round(g * 255), 0, 255); out[o++] = clamp(Math.round(b * 255), 0, 255);
  }
  return out;
}

// ── Titles ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Drawn the same way for the preview and, at the output size, for the picture FFmpeg lays over the video.
function drawTitle(g, W, H, t, op = 1) {
  if (!String(t.text || '').trim() || op <= 0) return null;
  const lines = String(t.text).split('\n');
  let px = Math.max(4, t.size * H);
  g.save();
  g.globalAlpha = clamp(op, 0, 1);
  g.textBaseline = 'middle';
  g.textAlign = t.align || 'center';
  const font = () => { g.font = `${t.bold ? 700 : 400} ${px}px ${fontCss(t.font)}`; return Math.max(...lines.map((l) => g.measureText(l).width)); };
  let bw = font();
  // Words that would run off a narrow (cropped or upright) picture are made smaller to fit.
  if (bw > W * 0.92) { px *= (W * 0.92) / bw; bw = font(); }
  const lh = px * 1.22, bh = lh * lines.length, cx = t.x * W, cy = t.y * H;
  const x = t.align === 'left' ? cx - bw / 2 : t.align === 'right' ? cx + bw / 2 : cx;
  if (t.style === 'box') {
    const pad = px * 0.36;
    g.fillStyle = t.box || 'rgba(0,0,0,0.62)';
    g.beginPath();
    g.roundRect(cx - bw / 2 - pad, cy - bh / 2 - pad * 0.55, bw + pad * 2, bh + pad * 1.1, px * 0.2);
    g.fill();
  }
  lines.forEach((l, i) => {
    const y = cy - bh / 2 + lh * (i + 0.5);
    if (t.style === 'outline') { g.lineWidth = px * 0.14; g.lineJoin = 'round'; g.strokeStyle = /^#(f|e|d)/i.test(t.color) ? '#000' : '#fff'; g.strokeText(l, x, y); }
    if (t.style === 'shadow') { g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = px * 0.14; g.shadowOffsetY = px * 0.04; }
    g.fillStyle = t.color;
    g.fillText(l, x, y);
  });
  g.restore();
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}
const titleOpacity = (t, o) => {
  if (o < t.start || o > t.end) return 0;
  const f = Math.min(t.fade || 0, (t.end - t.start) / 2);
  return f > 0 ? clamp(Math.min((o - t.start) / f, (t.end - o) / f), 0, 1) : 1;
};

// ── Preview drawing ───────────────────────────────────────────────────────────────────────────────────────────────
const VS = `#version 300 es
in vec2 p; out vec2 uv; void main() { uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float; precision highp sampler3D;
uniform sampler2D tex; uniform sampler3D cube; uniform mat3 map; uniform bool useCube; uniform float fade;
in vec2 uv; out vec4 o;
void main() {
  vec2 s = (map * vec3(uv, 1.)).xy;
  vec3 c = texture(tex, s).rgb;
  if (useCube) c = texture(cube, c * (63. / 64.) + .5 / 64.).rgb;
  o = vec4(c * fade, 1.);
}`;
function glView(canvas) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram();
  try { gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); } catch (_) { return null; }
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(), cube = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_3D, cube);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
  gl.uniform1i(gl.getUniformLocation(pr, 'tex'), 0);
  gl.uniform1i(gl.getUniformLocation(pr, 'cube'), 1);
  const U = (n) => gl.getUniformLocation(pr, n), uMap = U('map'), uUse = U('useCube'), uFade = U('fade');
  let hasCube = false;
  return {
    cube(data) {
      hasCube = !!data;
      if (!data) return;
      gl.activeTexture(gl.TEXTURE1);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, N, N, N, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
    },
    draw(src, map, fade) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE0);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch (_) { return; }
      gl.uniformMatrix3fv(uMap, false, map);
      gl.uniform1i(uUse, hasCube ? 1 : 0);
      gl.uniform1f(uFade, fade);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
// Without WebGL the picture is drawn with the 2D canvas and the colour cube applied to the pixels on screen.
function flatView(canvas) {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  let cube = null;
  return {
    cube(data) { cube = data; },
    draw(src, map, fade) {
      const W = canvas.width, H = canvas.height, sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
      if (!sw || !sh) return;
      // map takes output (u, v) to source (s, t): s = a u + c v + e, t = b u + d v + f (column-major mat3).
      const [a, b, , c, d, , e, f] = map, det = a * d - b * c;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
      g.setTransform((ia * W) / sw, (ib * H) / sw, (ic * W) / sh, (id * H) / sh, (-(ia * e + ic * f)) * W, (-(ib * e + id * f)) * H);
      g.drawImage(src, 0, 0, sw, sh);
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (!cube && fade >= 0.999) return;
      const img = g.getImageData(0, 0, W, H), p = img.data, s = (N - 1) / 255;
      for (let i = 0; i < p.length; i += 4) {
        let r = p[i], gg = p[i + 1], bb = p[i + 2];
        if (cube) { const o = ((Math.round(bb * s) * N + Math.round(gg * s)) * N + Math.round(r * s)) * 3; r = cube[o]; gg = cube[o + 1]; bb = cube[o + 2]; }
        p[i] = r * fade; p[i + 1] = gg * fade; p[i + 2] = bb * fade;
      }
      g.putImageData(img, 0, 0);
    },
  };
}

export function openEditor(view, { file }, ctx) {
  const { icon, toast, api, go } = ctx;
  const call = (m, ...a) => api.invoke('edit:call', 'media', m, ...a);
  const ic = (n, size) => (IC[n] ? icon('doc', size).replace(/<path d="[^"]*"/, `<path d="${IC[n]}"`) : icon(n, size));
  if (!document.querySelector('link[href="mediaedit.css"]')) document.head.append(h('<link rel="stylesheet" href="mediaedit.css">'));

  const st = {
    s: null, kind: 'video', E: null, hist: [], fut: [], saved: '', savePath: null, tool: 'trim', t: 0, playing: false, iter: 0, zoom: 0, scroll: 0, sel: -1, selTitle: null,
    cube: null, looks: null, luts: new Map(), prep: null, prepFor: '', loud: null, loudFor: '', thumbs: new Map(), wave: null, cues: [], musicDur: 0, busy: false, ready: false, rate: 1,
  };
  const root = h(`<div class="editor media-ed">
    <header class="ed-head">
      <div class="topbar">
        <button class="tb icon" data-a="close" title="Close">${icon('back')}</button>
        <div class="doc">${icon('video')}<b title="${esc(file)}">${esc(nameOf(file))}</b><span class="dirty" hidden>Unsaved</span></div>
        <div class="seg"><button class="tb icon" data-a="undo" title="Undo (Ctrl+Z)" disabled>${icon('undo')}</button><button class="tb icon" data-a="redo" title="Redo (Ctrl+Y)" disabled>${icon('redo')}</button></div>
        <div class="grow"></div>
        <div class="me-info"></div>
        <button class="btn" data-a="saveas">Save as…</button>
        <button class="btn primary" data-a="save">${icon('save', 'sm')}Save</button>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Tools"></div>
    </header>
    <div class="me-body">
      <section class="me-main">
        <div class="me-stage"><div class="me-frame"><canvas class="me-gl"></canvas><canvas class="me-over"></canvas><div class="me-subs" hidden></div></div><div class="me-badges"></div></div>
        <div class="me-transport">
          <button class="tb icon" data-a="start" title="Go to the start (Home)">${ic('stepBack')}</button>
          <button class="tb play" data-a="play" title="Play (Space)">${ic('play')}</button>
          <button class="tb icon" data-a="back" title="Previous frame (←)">${ic('stepBack', 'sm')}</button>
          <button class="tb icon" data-a="fwd" title="Next frame (→)">${ic('stepFwd', 'sm')}</button>
          <div class="me-time"></div>
          <div class="seg"><button class="tb icon" data-a="in" title="Trim the start to the playhead (I)">${ic('markIn')}</button><button class="tb icon" data-a="split" title="Split at the playhead (S)">${ic('split')}</button><button class="tb icon" data-a="out" title="Trim the end to the playhead (O)">${ic('markOut')}</button><button class="tb icon" data-a="cut" title="Cut out the selected part (Delete)">${ic('cutPart')}</button></div>
          <span class="me-len" title="Length of the saved clip"></span>
          <div class="grow"></div>
          <div class="me-vol" title="Preview volume (not saved)">${ic('volume', 'sm')}<input type="range" min="0" max="1" step="0.01" value="1" aria-label="Preview volume"></div>
          <div class="seg"><button class="tb icon" data-a="zout" title="Zoom out (−)">${icon('zoomOut', 'sm')}</button><button class="tb icon" data-a="zfit" title="Fit the whole clip">${icon('fit', 'sm')}</button><button class="tb icon" data-a="zin" title="Zoom in (+)">${icon('zoomIn', 'sm')}</button></div>
        </div>
        <div class="me-tl"><canvas></canvas><div class="hbar"><div></div></div></div>
      </section>
      <aside class="props" aria-label="Properties"></aside>
    </div>
    <div class="ed-status" hidden></div>
  </div>`);
  view.append(root);
  const stage = $('.me-stage', root), frameEl = $('.me-frame', root), glc = $('.me-gl', root), over = $('.me-over', root), subsEl = $('.me-subs', root), badges = $('.me-badges', root);
  const props = $('.props', root), status = $('.ed-status', root), tl = $('.me-tl', root), tlc = $('canvas', tl), hbar = $('.hbar', tl), timeEl = $('.me-time', root), lenEl = $('.me-len', root);
  let disposed = false, viewer = null, media = null, aux = null, musicEl = null;

  // ── Edit list ──────────────────────────────────────────────────────────────────────────────────────────────────
  const fresh = (d) => ({
    inT: 0, outT: d, segs: [{ a: 0, b: d, off: false }], loop: 1, speed: 1, reverse: false,
    rotate: 0, hflip: false, vflip: false, crop: null, aspect: 'free', size: 0, color: { ...ZERO_COLOUR }, look: '', lookMix: 100, log: '', stabilise: false,
    titles: [], subs: null, fadeIn: 0, fadeOut: 0, fadePicture: true, fadeSound: true, mute: false, music: null, audio: { ...ZERO_AUDIO },
  });
  const E = () => st.E;
  const dur = () => st.s?.duration || 0;
  function kept() {
    const e = E(), out = [];
    for (const g of e.segs) {
      if (g.off) continue;
      const a = Math.max(g.a, e.inT), b = Math.min(g.b, e.outT);
      if (b - a < 0.02) continue;
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - a) < 1e-6) last[1] = b; else out.push([a, b]);
    }
    return out;
  }
  const keptLen = (K = kept()) => K.reduce((x, [a, b]) => x + b - a, 0);
  const outLen = () => (keptLen() * E().loop) / E().speed;
  function progOf(s, K = kept()) {
    let p = 0;
    for (const [a, b] of K) { if (s < a) return p; if (s <= b) return p + s - a; p += b - a; }
    return p;
  }
  const outOf = (s) => (st.iter * keptLen() + progOf(s)) / E().speed;
  const inKept = (s, K = kept()) => K.some(([a, b]) => s >= a - 1e-4 && s <= b + 1e-4);
  const segAt = (t) => { const i = E().segs.findIndex((g) => t >= g.a && t < g.b); return i < 0 ? E().segs.length - 1 : i; };
  const fps = () => st.s?.video?.fps || 30;
  function geom() {
    const v = st.s.video, e = E();
    if (!v) return null;
    const [W0, H0] = e.rotate % 180 ? [v.height, v.width] : [v.width, v.height];
    const crop = e.crop ? [Math.round((e.crop.x * W0) / 2) * 2, Math.round((e.crop.y * H0) / 2) * 2, ev(e.crop.w * W0), ev(e.crop.h * H0)] : null;
    if (crop) { crop[2] = Math.min(crop[2], W0 - crop[0]); crop[3] = Math.min(crop[3], H0 - crop[1]); }
    // A shape picked from the presets is kept exact (9:16 stays 9:16 in whole even pixels), so a resize gives 1080 × 1920.
    if (crop && /^\d+:\d+$/.test(e.aspect)) {
      const [p, q] = e.aspect.split(':').map(Number);
      let k = Math.floor(Math.min(crop[2] / p, crop[3] / q));
      while (k > 1 && ((p * k) % 2 || (q * k) % 2)) k--;
      if (k > 0) { const w = p * k, hh = q * k; crop[0] = clamp(Math.round((crop[0] + (crop[2] - w) / 2) / 2) * 2, 0, W0 - w); crop[1] = clamp(Math.round((crop[1] + (crop[3] - hh) / 2) / 2) * 2, 0, H0 - hh); crop[2] = w; crop[3] = hh; }
    }
    const cw = crop ? crop[2] : W0, ch = crop ? crop[3] : H0;
    let W = ev(cw), H = ev(ch);
    if (e.size && Math.min(cw, ch) !== e.size) { const k = e.size / Math.min(cw, ch); W = ev(cw * k); H = ev(ch * k); }
    return { rotate: e.rotate, hflip: e.hflip, vflip: e.vflip, crop, out: [W, H], W, H, W0, H0, cw, ch };
  }

  // ── History ────────────────────────────────────────────────────────────────────────────────────────────────────
  let lastKey = null, lastAt = 0;
  // One step per action; a slider dragged or a field typed in keeps adding to the same step for a moment.
  function edit(fn, key, quiet) {
    const now = Date.now();
    if (!(key && key === lastKey && now - lastAt < 1200)) { st.hist.push(JSON.stringify(st.E)); if (st.hist.length > 300) st.hist.shift(); st.fut = []; }
    lastKey = key; lastAt = now;
    fn(st.E);
    changed(quiet);
  }
  function undo() { if (!st.hist.length) return; st.fut.push(JSON.stringify(st.E)); st.E = JSON.parse(st.hist.pop()); lastKey = null; changed(); }
  function redo() { if (!st.fut.length) return; st.hist.push(JSON.stringify(st.E)); st.E = JSON.parse(st.fut.pop()); lastKey = null; changed(); }
  function changed(quiet) {
    if (st.sel >= E().segs.length) st.sel = -1;
    if (st.selTitle && !E().titles.some((t) => t.id === st.selTitle)) st.selTitle = null;
    refreshColour();
    applySound();
    loadMusic();
    syncMusic(true);
    keepPrepared();
    keepLoudness();
    loadCues();
    if (!quiet) renderProps();
    chrome();
    layoutFrame();
    redraw();
    drawTl();
  }

  // ── Player ─────────────────────────────────────────────────────────────────────────────────────────────────────
  let ac = null, nodes = null;
  function makeMedia() {
    media = document.createElement(st.kind === 'video' ? 'video' : 'audio');
    Object.assign(media, { preload: 'auto', playsInline: true, className: 'me-media', crossOrigin: 'anonymous' });
    aux = Object.assign(document.createElement('audio'), { preload: 'auto', className: 'me-media', crossOrigin: 'anonymous' });
    musicEl = Object.assign(document.createElement('audio'), { preload: 'auto', className: 'me-media', crossOrigin: 'anonymous', loop: false });
    stage.append(media, aux, musicEl);
    media.addEventListener('seeked', () => { redraw(); drawTl(); });
    media.addEventListener('loadeddata', () => redraw());
    media.addEventListener('ended', () => { if (st.playing) tick(); });
    if (media.requestVideoFrameCallback) { const onFrame = () => { if (disposed) return; redraw(); media.requestVideoFrameCallback(onFrame); }; media.requestVideoFrameCallback(onFrame); }
  }
  // The sound path: original (or cleaned-up copy) → low cut, bass, presence, treble → mono or balance → gain → fade →
  // with the music → limiter → preview volume. The music dips while the clip's own sound is loud, as when saved.
  function makeGraph() {
    try { ac = new AudioContext(); } catch (_) { return; }
    const n = {};
    n.src = ac.createMediaElementSource(media);
    n.aux = ac.createMediaElementSource(aux);
    n.music = ac.createMediaElementSource(musicEl);
    n.input = ac.createGain();
    const bq = (type, f) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; return b; };
    n.low = bq('highpass', 10); n.low.Q.value = 0.7071;
    n.bass = bq('lowshelf', 150); n.mid = bq('peaking', 3000); n.treble = bq('highshelf', 5000);
    n.chan = ac.createGain();
    n.up = ac.createGain();
    Object.assign(n.up, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    n.split = ac.createChannelSplitter(2); n.gl = ac.createGain(); n.gr = ac.createGain(); n.merge = ac.createChannelMerger(2);
    n.gain = ac.createGain(); n.fade = ac.createGain(); n.key = ac.createAnalyser(); n.key.fftSize = 1024;
    n.mus = ac.createGain(); n.duck = ac.createGain(); n.bus = ac.createGain();
    n.lim = ac.createDynamicsCompressor(); n.lim.knee.value = 0; n.lim.attack.value = 0.003; n.lim.release.value = 0.06;
    n.master = ac.createGain();
    n.src.connect(n.input); n.aux.connect(n.input);
    n.input.connect(n.low).connect(n.bass).connect(n.mid).connect(n.treble).connect(n.chan).connect(n.up).connect(n.split);
    n.split.connect(n.gl, 0); n.split.connect(n.gr, 1); n.gl.connect(n.merge, 0, 0); n.gr.connect(n.merge, 0, 1);
    n.merge.connect(n.gain).connect(n.fade);
    n.fade.connect(n.key);
    n.fade.connect(n.bus);
    n.music.connect(n.mus).connect(n.duck).connect(n.bus);
    n.bus.connect(n.lim).connect(n.master).connect(ac.destination);
    nodes = n;
  }
  function totalGain() {
    const a = E().audio;
    // Levelling sets the gain that brings the edit to the target loudness; otherwise it is the slider's.
    if (a.normalise) return st.loud && st.loudFor === loudKey() && Number.isFinite(st.loud.lufs) ? clamp(a.target - st.loud.lufs, -30, 30) : 0;
    return a.gain;
  }
  function applySound() {
    const e = E(), a = e.audio;
    if (media) {
      media.playbackRate = e.speed * st.rate;
      aux.playbackRate = e.speed * st.rate;
      media.preservesPitch = aux.preservesPitch = true;
      const usePrep = !!st.prep;
      media.muted = usePrep || (st.kind === 'video' && (e.mute || e.music?.mode === 'replace'));
      aux.muted = !usePrep || e.mute || e.music?.mode === 'replace';
    }
    if (!nodes) return;
    const n = nodes, now = ac.currentTime, set = (p, v) => p.setTargetAtTime(v, now, 0.015);
    n.low.frequency.value = a.lowcut > 0 ? a.lowcut : 10;
    set(n.bass.gain, a.bass); set(n.treble.gain, a.treble);
    n.mid.frequency.value = a.midHz || 3000; set(n.mid.gain, a.mid || 0);
    // Mono: down to one channel the way speakers mix it, then the same on both sides; a mono clip still gets two
    // channels so it can be moved left or right.
    Object.assign(n.chan, { channelCount: a.mono ? 1 : 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    const bal = a.mono ? 0 : a.balance;
    set(n.gl.gain, Math.min(1, 1 - bal)); set(n.gr.gain, Math.min(1, 1 + bal));
    set(n.gain.gain, dB(totalGain()));
    set(n.mus.gain, e.music ? dB(e.music.volume) : 0);
    const boost = totalGain() > 0 || !!e.music;
    n.lim.threshold.value = boost ? -1 : 0; n.lim.ratio.value = boost ? 20 : 1;
  }
  function frameMap(full) {
    const e = E(), g = geom();
    // Output (u, v) → before the crop → before the flips → before the turn: source (s, t), as a column-major mat3.
    let m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const mul = (A, B) => { const r = new Array(9); for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) r[c * 3 + rr] = A[rr] * B[c * 3] + A[3 + rr] * B[c * 3 + 1] + A[6 + rr] * B[c * 3 + 2]; return r; };
    if (!full && g.crop) m = mul([g.crop[2] / g.W0, 0, 0, 0, g.crop[3] / g.H0, 0, g.crop[0] / g.W0, g.crop[1] / g.H0, 1], m);
    if (e.hflip) m = mul([-1, 0, 0, 0, 1, 0, 1, 0, 1], m);
    if (e.vflip) m = mul([1, 0, 0, 0, -1, 0, 0, 1, 1], m);
    if (e.rotate === 90) m = mul([0, -1, 0, 1, 0, 0, 0, 1, 1], m);
    else if (e.rotate === 180) m = mul([-1, 0, 0, 0, -1, 0, 1, 1, 1], m);
    else if (e.rotate === 270) m = mul([0, 1, 0, -1, 0, 0, 1, 0, 1], m);
    return m;
  }
  const cropping = () => st.tool === 'crop' && st.kind === 'video';
  function layoutFrame() {
    if (st.kind !== 'video' || !st.s) return;
    const g = geom(), full = cropping(), aw = full ? g.W0 : g.cw, ah = full ? g.H0 : g.ch;
    const r = stage.getBoundingClientRect(), w = Math.max(40, r.width - 36), hh = Math.max(40, r.height - 36), k = Math.min(w / aw, hh / ah);
    const cw = Math.round(aw * k), ch = Math.round(ah * k), dpr = devicePixelRatio || 1;
    Object.assign(frameEl.style, { width: `${cw}px`, height: `${ch}px` });
    for (const c of [glc, over]) { const W = Math.round(cw * dpr), H = Math.round(ch * dpr); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } }
    placeCrop();
  }
  let drawQueued = false;
  function redraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; paint(); });
  }
  function fadeAt(o) {
    const e = E(), D = outLen();
    return clamp(Math.min(e.fadeIn > 0 ? o / e.fadeIn : 1, e.fadeOut > 0 ? (D - o) / e.fadeOut : 1), 0, 1);
  }
  function paint() {
    if (!st.s || disposed) return;
    const s = st.playing && media ? media.currentTime : st.t, o = outOf(s), e = E();
    if (st.kind === 'video' && viewer && media.readyState >= 2) viewer.draw(media, frameMap(cropping()), e.fadePicture ? fadeAt(o) : 1);
    const g = over.getContext('2d');
    g.clearRect(0, 0, over.width, over.height);
    $$('.me-titlebox', frameEl).forEach((x) => x.remove());
    subsEl.hidden = true;
    if (st.kind === 'video' && !cropping()) {
      for (const t of e.titles) {
        const op = st.selTitle === t.id && st.tool === 'titles' && !st.playing ? Math.max(titleOpacity(t, o), 0.35) : titleOpacity(t, o);
        const box = drawTitle(g, over.width, over.height, t, op);
        if (box && st.tool === 'titles' && st.selTitle === t.id && !st.playing) {
          const k = 1 / (devicePixelRatio || 1), el = h(`<div class="me-titlebox" style="left:${box.x * k - 6}px;top:${box.y * k - 4}px;width:${box.w * k + 12}px;height:${box.h * k + 8}px"></div>`);
          el.addEventListener('pointerdown', (ev2) => dragTitle(ev2, t));
          frameEl.append(el);
        }
      }
      const cue = e.subs && inKept(s) ? st.cues.find((c) => s >= c.start && s < c.end) : null;
      subsEl.hidden = !cue;
      if (cue) {
        const H = frameEl.clientHeight, size = (e.subs.size / 288) * H, ow = Math.max(1, size / 12);
        subsEl.textContent = cue.text;
        Object.assign(subsEl.style, { fontSize: `${size}px`, bottom: `${(e.subs.size * 0.9 / 288) * H}px`, textShadow: [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [1, 0], [0, -1], [-1, 0]].map(([x, y]) => `${x * ow}px ${y * ow}px 0 #000`).join(',') });
      }
    }
    const tags = [];
    if (!inKept(s)) tags.push(['cut', 'Cut from the saved clip']);
    if (e.reverse) tags.push(['', 'Reversed when saved']);
    if (e.stabilise) tags.push(['', 'Stabilised when saved']);
    badges.innerHTML = tags.map(([c, t]) => `<span class="me-badge ${c}">${esc(t)}</span>`).join('');
    timeEl.innerHTML = `${fmtT(s)} <span>/ ${fmtT(dur())}</span>`;
  }
  // Colour: the cube is rebuilt whenever a slider, the look or its strength changes; looks come from the worker.
  let cubeQueued = false;
  function refreshColour() {
    if (cubeQueued) return;
    cubeQueued = true;
    requestAnimationFrame(async () => {
      cubeQueued = false;
      const e = E(), need = [e.look, e.log].filter(Boolean).filter((id) => !st.luts.has(id));
      if (need.length) { await Promise.all(need.map(lutOf)); if (disposed) return; }
      st.cube = st.kind === 'video' ? buildCube(e.color, st.luts.get(e.look) || null, st.luts.get(e.log) || null, e.lookMix) : null;
      viewer?.cube(st.cube);
      redraw();
    });
  }
  const lutOf = (id) => (st.luts.has(id) ? Promise.resolve(st.luts.get(id)) : call('lut', id).then((b) => { const u = new Uint8Array(b); st.luts.set(id, u); return u; }).catch((er) => { toast(clean(er), { type: 'error' }); return null; }));

  // Playing skips what is cut, repeats for Loop and stops at the end.
  let raf = 0;
  function tick() {
    raf = 0;
    if (!st.playing || disposed) return;
    const K = kept(), s = media.currentTime, eps = st.kind === 'video' ? 0.6 / fps() : 0.01;
    if (!K.some(([a, b]) => s >= a - 0.002 && s < b - eps)) {
      const next = K.find(([a]) => a > s + 0.002);
      if (next) seekRaw(next[0]);
      else if (st.iter + 1 < E().loop && K.length) { st.iter++; seekRaw(K[0][0]); }
      else { pause(); seekRaw(K.length ? K[K.length - 1][1] : s); st.iter = 0; return; }
    }
    st.t = media.currentTime;
    follow();
    syncAux();
    syncMusic();
    if (nodes) {
      const e = E(), o = outOf(st.t), now = ac.currentTime;
      nodes.fade.gain.setTargetAtTime(e.fadeSound ? fadeAt(o) : 1, now, 0.01);
      if (e.music?.duck > 0) {
        const buf = new Float32Array(nodes.key.fftSize);
        nodes.key.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const x of buf) sum += x * x;
        const loud = Math.sqrt(sum / buf.length) > 0.01, want = loud ? dB(-e.music.duck) : 1;
        nodes.duck.gain.setTargetAtTime(want, now, loud ? 0.02 : 0.15);
      } else nodes.duck.gain.value = 1;
    }
    if (st.kind === 'video' && !media.requestVideoFrameCallback) redraw();
    else if (st.kind !== 'video') paint();
    drawTl();
    raf = requestAnimationFrame(tick);
  }
  function syncAux() {
    if (!st.prep) return;
    if (Math.abs(aux.currentTime - media.currentTime) > 0.08) aux.currentTime = media.currentTime;
    if (st.playing && aux.paused) aux.play().catch(() => {});
  }
  function syncMusic(force) {
    const m = E()?.music;
    if (!musicEl || !m) { if (musicEl && !musicEl.paused) musicEl.pause(); return; }
    const o = outOf(media ? media.currentTime : st.t), md = st.musicDur || 0;
    const at = m.loop && md && !m.fit ? o % md : o, live = st.playing && (!md || m.loop || o < md);
    if (force || Math.abs(musicEl.currentTime - at) > 0.12) { try { musicEl.currentTime = at; } catch (_) {} }
    if (live && musicEl.paused) musicEl.play().catch(() => {});
    if (!live && !musicEl.paused) musicEl.pause();
  }
  function seekRaw(t) { media.currentTime = clamp(t, 0, dur()); if (st.prep) aux.currentTime = media.currentTime; }
  function seek(t) {
    st.t = clamp(t, 0, dur());
    if (media) seekRaw(st.t);
    st.iter = 0;
    syncMusic(true);
    redraw();
    drawTl();
  }
  async function play() {
    if (!media || st.playing) return;
    const K = kept();
    if (!K.length) { tip('Every part is cut. Keep a part to play it.'); return; }
    const s = media.currentTime;
    if (!K.some(([a, b]) => s >= a - 0.002 && s < b - 0.02)) { const next = K.find(([a]) => a > s); seekRaw(next ? next[0] : K[0][0]); if (!next) st.iter = 0; }
    ac?.resume();
    st.playing = true;
    $('[data-a="play"]', root).innerHTML = ic('pause');
    await media.play().catch(() => {});
    syncAux();
    syncMusic(true);
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function pause() {
    st.playing = false;
    st.rate = 1;
    media?.pause(); aux?.pause(); musicEl?.pause();
    applySound();
    $('[data-a="play"]', root).innerHTML = ic('play');
    st.t = media ? media.currentTime : st.t;
    redraw();
    drawTl();
  }
  const playPause = () => (st.playing ? pause() : play());
  function step(n) { pause(); seek((media?.currentTime ?? st.t) + n / (st.kind === 'video' ? fps() : 10)); }

  // ── Timeline ───────────────────────────────────────────────────────────────────────────────────────────────────
  const PAD = 14;
  const rows = () => {
    const H = tlc.clientHeight, r = { ruler: [0, 22] };
    if (st.kind === 'video') {
      const extra = [E()?.titles.length && 'titles', E()?.music && 'music'].filter(Boolean), rest = Math.max(20, H - 82 - extra.length * 15);
      r.strip = [24, 54];
      r.wave = [80, st.s?.audio ? rest : 0];
      let y = 80 + r.wave[1] + 1;
      for (const k of extra) { r[k] = [y, 14]; y += 15; }
    } else r.wave = [26, Math.max(40, H - 30)];
    return r;
  };
  const xOf = (t) => PAD + t * st.zoom - st.scroll;
  const tOf = (x) => clamp((x - PAD + st.scroll) / st.zoom, 0, dur());
  const fitZoom = () => Math.max(1e-3, (tlc.clientWidth - PAD * 2) / Math.max(0.1, dur()));
  function setZoom(z, atX) {
    const fz = fitZoom(), nz = clamp(z, fz, Math.max(fz, 600)), x = atX ?? tlc.clientWidth / 2, t = (x - PAD + st.scroll) / st.zoom;
    st.zoom = nz;
    st.atFit = nz <= fz * 1.0001;
    st.scroll = clamp(t * nz + PAD - x, 0, Math.max(0, dur() * nz + PAD * 2 - tlc.clientWidth));
    $('div', hbar).style.width = `${dur() * nz + PAD * 2}px`;
    hbar.scrollLeft = st.scroll;
    drawTl();
  }
  function follow() {
    const x = xOf(st.t), w = tlc.clientWidth;
    if (x > w - 40 || x < PAD) { st.scroll = clamp(st.t * st.zoom - w * 0.25, 0, Math.max(0, dur() * st.zoom + PAD * 2 - w)); hbar.scrollLeft = st.scroll; }
  }
  let tlQueued = false;
  function drawTl() {
    if (tlQueued) return;
    tlQueued = true;
    requestAnimationFrame(() => { tlQueued = false; paintTl(); });
  }
  const css = (n) => getComputedStyle(root).getPropertyValue(n).trim();
  let thumbWant = new Set(), thumbT = null;
  function paintTl() {
    if (!st.s || disposed) return;
    const dpr = devicePixelRatio || 1, W = tlc.clientWidth, H = tlc.clientHeight;
    if (tlc.width !== Math.round(W * dpr) || tlc.height !== Math.round(H * dpr)) { tlc.width = Math.round(W * dpr); tlc.height = Math.round(H * dpr); }
    const g = tlc.getContext('2d'), R = rows(), e = E(), d = dur(), dark = document.documentElement.dataset.theme === 'dark';
    const C = Object.fromEntries(['--surface', '--surface-2', '--line', '--line-2', '--ink-3', '--green-2', '--danger', '--accent'].map((n) => [n, css(n)]));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = C['--surface-2']; g.fillRect(0, 0, W, H);
    // Ruler.
    const steps = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600], stp = steps.find((x) => x * st.zoom >= 76) || 3600;
    g.fillStyle = C['--surface']; g.fillRect(0, R.ruler[0], W, R.ruler[1]);
    g.font = '10.5px system-ui, sans-serif'; g.textBaseline = 'middle';
    for (let t = Math.floor(tOf(0) / stp) * stp; t <= d + 1e-6 && xOf(t) < W + 50; t += stp) {
      const x = Math.round(xOf(t)) + 0.5;
      g.fillStyle = C['--line-2']; g.fillRect(x, R.ruler[1] - 7, 1, 7);
      for (let k = 1; k < 4; k++) { const xx = Math.round(xOf(t + (stp * k) / 4)) + 0.5; if (t + (stp * k) / 4 <= d) g.fillRect(xx, R.ruler[1] - 3, 1, 3); }
      g.fillStyle = C['--ink-3']; g.fillText(fmtT(t, stp < 1 ? (stp < 0.1 ? 2 : 1) : 0), x + 4, 9);
    }
    const x0 = xOf(0), x1 = xOf(d), top = R.strip ? R.strip[0] : R.wave[0], last = R.music || R.titles || R.wave, bottom = last[0] + last[1];
    // Pictures along the clip, fetched for the slots in view at this zoom.
    if (R.strip) {
      const [y, hh] = R.strip, v = st.s.video, tw = Math.max(24, (hh * v.width) / v.height), slot = tw / st.zoom;
      g.fillStyle = dark ? '#0b0c0e' : '#2a2d31'; g.fillRect(Math.max(0, x0), y, Math.min(W, x1) - Math.max(0, x0), hh);
      const first = Math.max(0, Math.floor(tOf(0) / slot)), want = [];
      for (let i = first; i * slot < d && xOf(i * slot) < W; i++) {
        const t = Math.min(d - 0.05, i * slot + slot / 2), key = Math.round(t * 10) / 10, img = st.thumbs.get(key);
        if (img && img !== 'wait') g.drawImage(img, xOf(i * slot), y, tw, hh);
        else if (!img) want.push(key);
      }
      g.fillStyle = 'rgba(0,0,0,.25)';
      for (let i = first; i * slot < d && xOf(i * slot) < W; i++) g.fillRect(Math.round(xOf(i * slot)), y, 1, hh);
      if (want.length) { want.forEach((k) => thumbWant.add(k)); clearTimeout(thumbT); thumbT = setTimeout(fetchThumbs, 60); }
    }
    // Waveform, on a decibel scale so quiet sound shows, at the level the gain makes it.
    if (R.wave && R.wave[1]) {
      const [y, hh] = R.wave, mid = y + hh / 2, gain = dB(totalGain()) * (e.mute ? 0 : 1);
      g.fillStyle = C['--surface']; g.fillRect(Math.max(0, x0), y, Math.min(W, x1) - Math.max(0, x0), hh);
      g.fillStyle = C['--line']; g.fillRect(Math.max(0, x0), Math.round(mid), Math.min(W, x1) - Math.max(0, x0), 1);
      if (st.kind === 'audio') for (const f of [0.25, 0.75]) g.fillRect(Math.max(0, x0), Math.round(y + hh * f), Math.min(W, x1) - Math.max(0, x0), 1);
      if (st.wave) {
        const fill = g.createLinearGradient(0, y, 0, y + hh);
        fill.addColorStop(0, css('--lime-500')); fill.addColorStop(0.5, C['--green-2']); fill.addColorStop(1, css('--lime-500'));
        const { per, peaks } = st.wave, amp = (p) => clamp(((p / 255) * gain) ** 0.6, 0, 1);
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, x1); x++) {
          const a = Math.floor(tOf(x) * per), b = Math.max(a + 1, Math.floor(tOf(x + 1) * per));
          let m = 0;
          for (let i = a; i < b && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
          const v = amp(m), hv = Math.max(0.5, (v * hh) / 2 - 1);
          g.fillStyle = (m / 255) * gain > 0.999 ? C['--danger'] : fill;
          g.fillRect(x, mid - hv, 1, hv * 2);
        }
      } else { g.fillStyle = C['--line']; g.fillRect(Math.max(0, x0), mid, Math.min(W, x1) - Math.max(0, x0), 1); }
    }
    // Titles and music, where they fall in the clip (their times are in the saved clip, before any loop).
    const pieces = (o0, o1) => {
      const out = [], k = e.speed;
      let P = 0;
      for (const [a, b] of kept()) { const s0 = Math.max(a, a + o0 * k - P), s1 = Math.min(b, a + o1 * k - P); if (s1 > s0) out.push([s0, s1]); P += b - a; }
      return out;
    };
    const bar = (row, list, colour, label) => {
      const [y, hh] = row;
      for (const [s0, s1] of list) {
        const xa = xOf(s0), w = Math.max(3, xOf(s1) - xa);
        g.fillStyle = colour; g.beginPath(); g.roundRect(xa, y + 1, w, hh - 2, 3); g.fill();
        if (label && w > 40) { g.save(); g.beginPath(); g.rect(xa, y, w, hh); g.clip(); g.fillStyle = '#fff'; g.font = '600 9.5px system-ui, sans-serif'; g.fillText(label, xa + 5, y + hh / 2 + 0.5); g.restore(); }
      }
    };
    if (R.titles) for (const t of e.titles) bar(R.titles, pieces(t.start, t.end), st.selTitle === t.id ? C['--accent'] : '#5b7fd6', String(t.text).split('\n')[0]);
    if (R.music && e.music) bar(R.music, pieces(0, e.music.loop || e.music.fit || !st.musicDur ? outLen() / e.loop : Math.min(st.musicDur, outLen() / e.loop)), '#9a6bd1', nameOf(e.music.file));
    // What is cut: hatched, darker; the part selected for Delete is outlined.
    const hatch = (a, b) => {
      const xa = Math.max(-2, xOf(a)), xb = Math.min(W + 2, xOf(b));
      if (xb <= xa) return;
      g.save();
      g.beginPath(); g.rect(xa, top, xb - xa, bottom - top); g.clip();
      g.fillStyle = dark ? 'rgba(0,0,0,.6)' : 'rgba(20,24,30,.52)'; g.fillRect(xa, top, xb - xa, bottom - top);
      g.strokeStyle = 'rgba(255,90,80,.55)'; g.lineWidth = 1;
      for (let x = xa - (bottom - top); x < xb; x += 7) { g.beginPath(); g.moveTo(x, bottom); g.lineTo(x + (bottom - top), top); g.stroke(); }
      g.restore();
    };
    for (const sg of e.segs) if (sg.off) hatch(sg.a, sg.b);
    if (e.inT > 0) hatch(0, e.inT);
    if (e.outT < d) hatch(e.outT, d);
    for (let i = 1; i < e.segs.length; i++) {
      const x = Math.round(xOf(e.segs[i].a)) + 0.5;
      if (x < -5 || x > W + 5) continue;
      g.fillStyle = dark ? '#fff' : '#111'; g.fillRect(x - 0.5, top, 1.5, bottom - top);
      g.beginPath(); g.moveTo(x - 5, top); g.lineTo(x + 5.5, top); g.lineTo(x + 0.25, top + 6); g.fill();
    }
    if (st.sel >= 0 && e.segs[st.sel]) {
      const sg = e.segs[st.sel], xa = xOf(Math.max(sg.a, e.inT)), xb = xOf(Math.min(sg.b, e.outT));
      if (xb > xa) { g.strokeStyle = C['--accent']; g.lineWidth = 2; g.strokeRect(xa + 1, top + 1, xb - xa - 2, bottom - top - 2); }
    }
    // Trim handles.
    const handle = (t, left) => {
      const x = xOf(t);
      g.fillStyle = '#f5b400';
      g.beginPath(); g.roundRect(left ? x - 1 : x - 9, top, 10, bottom - top, left ? [5, 0, 0, 5] : [0, 5, 5, 0]); g.fill();
      g.fillStyle = 'rgba(0,0,0,.55)';
      for (const k of [-4, 0, 4]) g.fillRect(left ? x + 3 : x - 5, (top + bottom) / 2 + k - 0.5, 2, 1.5);
      g.fillStyle = '#f5b400'; g.fillRect(left ? x - 1 : x - 9, top, 10, 2); g.fillRect(left ? x - 1 : x - 9, bottom - 2, 10, 2);
    };
    handle(e.inT, true); handle(e.outT, false);
    // Playhead.
    const px = Math.round(xOf(st.playing && media ? media.currentTime : st.t)) + 0.5;
    g.fillStyle = '#ff3b30'; g.fillRect(px - 0.75, 4, 1.5, bottom - 4);
    g.beginPath(); g.moveTo(px - 6, 2); g.lineTo(px + 6, 2); g.lineTo(px + 6, 10); g.lineTo(px, 16); g.lineTo(px - 6, 10); g.closePath(); g.fill();
  }
  async function fetchThumbs() {
    const list = [...thumbWant].filter((k) => !st.thumbs.has(k)).slice(0, 18);
    thumbWant = new Set();
    if (!list.length || !st.s?.video) return;
    list.forEach((k) => st.thumbs.set(k, 'wait'));
    const bufs = await call('thumbs', st.s.id, list, 54).catch(() => []);
    await Promise.all(list.map(async (k, i) => {
      if (!bufs[i]) { st.thumbs.delete(k); return; }
      try { st.thumbs.set(k, await createImageBitmap(new Blob([bufs[i]], { type: 'image/jpeg' }))); } catch (_) { st.thumbs.delete(k); }
    }));
    drawTl();
  }
  // Dragging on the ruler or in the strip moves the playhead (and picks the part under it); the yellow handles trim;
  // the black marks between parts can be dragged to move a split.
  tlc.addEventListener('pointerdown', (ev0) => {
    if (!st.s || ev0.button !== 0) return;
    const r = tlc.getBoundingClientRect(), x = ev0.clientX - r.left, y = ev0.clientY - r.top, e = E(), R = rows(), near = (t, px = 7) => Math.abs(xOf(t) - x) <= px;
    const top = R.strip ? R.strip[0] : R.wave[0];
    let drag = null;
    if (y >= top) {
      if (near(e.inT, 9) && x >= xOf(e.inT) - 3) drag = { kind: 'in' };
      else if (near(e.outT, 9) && x <= xOf(e.outT) + 3) drag = { kind: 'out' };
      else { const i = e.segs.findIndex((g, k) => k > 0 && near(g.a, 5)); if (i > 0) drag = { kind: 'split', i }; }
    }
    tlc.setPointerCapture(ev0.pointerId);
    if (drag) {
      const snap = JSON.stringify(st.E);
      let moved = false;
      const mv = (ev) => {
        const t = tOf(ev.clientX - r.left);
        moved = true;
        if (drag.kind === 'in') e.inT = clamp(t, 0, e.outT - 0.05);
        if (drag.kind === 'out') e.outT = clamp(t, e.inT + 0.05, dur());
        if (drag.kind === 'split') { const a = e.segs[drag.i - 1], b = e.segs[drag.i], v = clamp(t, a.a + 0.05, b.b - 0.05); a.b = v; b.a = v; }
        seek(drag.kind === 'out' ? e.outT : drag.kind === 'in' ? e.inT : e.segs[drag.i].a);
        chrome();
      };
      const up = () => { tlc.removeEventListener('pointermove', mv); tlc.removeEventListener('pointerup', up); if (moved) { st.hist.push(snap); st.fut = []; lastKey = null; changed(); } };
      tlc.addEventListener('pointermove', mv);
      tlc.addEventListener('pointerup', up);
      return;
    }
    pause();
    const pick = (ev) => { const t = tOf(ev.clientX - r.left); seek(t); if (y >= top && segAt(t) !== st.sel) { st.sel = segAt(t); renderPropsIf('trim'); } };
    pick(ev0);
    const up = () => { tlc.removeEventListener('pointermove', pick); tlc.removeEventListener('pointerup', up); };
    tlc.addEventListener('pointermove', pick);
    tlc.addEventListener('pointerup', up);
  });
  tlc.addEventListener('pointermove', (ev) => {
    if (ev.buttons || !st.s) return;
    const r = tlc.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, e = E(), R = rows(), top = R.strip ? R.strip[0] : R.wave[0];
    const near = (t, px) => Math.abs(xOf(t) - x) <= px;
    tlc.style.cursor = y >= top && (near(e.inT, 9) || near(e.outT, 9) || e.segs.some((g, k) => k > 0 && near(g.a, 5))) ? 'ew-resize' : 'default';
  });
  tlc.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) { setZoom(st.zoom * Math.exp(-clamp(ev.deltaY, -60, 60) * 0.01), ev.clientX - tlc.getBoundingClientRect().left); return; }
    hbar.scrollLeft += Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
  }, { passive: false });
  hbar.addEventListener('scroll', () => { st.scroll = hbar.scrollLeft; drawTl(); });

  // ── Crop and title dragging on the picture ─────────────────────────────────────────────────────────────────────
  let cropEl = null;
  function placeCrop() {
    if (!cropping()) { cropEl?.remove(); cropEl = null; return; }
    if (!cropEl) {
      cropEl = h(`<div class="me-crop">${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => `<span class="hd" data-d="${d}"></span>`).join('')}<span class="sz"></span></div>`);
      cropEl.addEventListener('pointerdown', dragCrop);
      frameEl.append(cropEl);
    }
    const c = E().crop || { x: 0, y: 0, w: 1, h: 1 }, W = frameEl.clientWidth, H = frameEl.clientHeight, g = geom();
    Object.assign(cropEl.style, { left: `${c.x * W}px`, top: `${c.y * H}px`, width: `${c.w * W}px`, height: `${c.h * H}px` });
    const pos = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };
    $$('.hd', cropEl).forEach((hd) => { const [l, t] = pos[hd.dataset.d]; Object.assign(hd.style, { left: `${l}%`, top: `${t}%`, cursor: `${hd.dataset.d}-resize` }); });
    $('.sz', cropEl).textContent = `${g.cw} × ${g.ch}`;
  }
  const aspectOf = (a) => { const g = geom(); if (!a || a === 'free') return 0; const [p, q] = a === 'orig' ? [g.W0, g.H0] : a.split(':').map(Number); return (p / q) * (g.H0 / g.W0); };
  function dragCrop(ev0) {
    ev0.preventDefault();
    ev0.stopPropagation();
    const d = ev0.target.dataset.d || 'move', W = frameEl.clientWidth, H = frameEl.clientHeight, c0 = { ...(E().crop || { x: 0, y: 0, w: 1, h: 1 }) }, k = aspectOf(E().aspect), snap = JSON.stringify(st.E);
    const min = 32 / Math.min(W, H);
    const mv = (ev) => {
      const dx = (ev.clientX - ev0.clientX) / W, dy = (ev.clientY - ev0.clientY) / H;
      let { x, y, w, h: hh } = c0;
      if (d === 'move') { x = clamp(x + dx, 0, 1 - w); y = clamp(y + dy, 0, 1 - hh); }
      else {
        if (d.includes('w')) { const nx = clamp(x + dx, 0, x + w - min); w += x - nx; x = nx; }
        if (d.includes('e')) w = clamp(w + dx, min, 1 - x);
        if (d.includes('n')) { const ny = clamp(y + dy, 0, y + hh - min); hh += y - ny; y = ny; }
        if (d.includes('s')) hh = clamp(hh + dy, min, 1 - y);
        if (k) {
          // Keep the shape: the dragged side leads, the other follows, within the picture.
          if (d === 'n' || d === 's') w = hh * k; else hh = w / k;
          if (x + w > 1) { w = 1 - x; hh = w / k; }
          if (y + hh > 1) { hh = 1 - y; w = hh * k; }
          if (d.includes('n')) y = c0.y + c0.h - hh;
          if (d.includes('w')) x = c0.x + c0.w - w;
        }
      }
      E().crop = { x, y, w, h: hh };
      placeCrop();
      redraw();
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      if (JSON.stringify(st.E) !== snap) { st.hist.push(snap); st.fut = []; lastKey = null; const c = E().crop; if (c && c.x < 1e-3 && c.y < 1e-3 && c.w > 0.999 && c.h > 0.999) E().crop = null; changed(); }
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }
  function dragTitle(ev0, t) {
    ev0.preventDefault();
    ev0.stopPropagation();
    const W = frameEl.clientWidth, H = frameEl.clientHeight, x0 = t.x, y0 = t.y, snap = JSON.stringify(st.E);
    const mv = (ev) => { t.x = clamp(x0 + (ev.clientX - ev0.clientX) / W, 0, 1); t.y = clamp(y0 + (ev.clientY - ev0.clientY) / H, 0, 1); paint(); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (JSON.stringify(st.E) !== snap) { st.hist.push(snap); st.fut = []; lastKey = null; changed(); } };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }

  // ── Worker jobs that follow the edit ───────────────────────────────────────────────────────────────────────────
  let prepRun = 0;
  const prepKey = () => { const a = E().audio; return a.denoise || a.hum || a.pitch ? `${a.denoise}|${a.hum}|${a.pitch}` : ''; };
  function keepPrepared(force) {
    if (!st.s?.audio) return Promise.resolve();
    const want = prepKey();
    if (want === st.prepFor && !force) return st.prepping || Promise.resolve();
    st.prepFor = want;
    const run = ++prepRun, a = E().audio;
    if (!want) { st.prep = null; st.prepping = null; applySound(); loadWave(); return Promise.resolve(); }
    st.prepping = (async () => {
      const res = await job('prepare', () => call('prepare', st.s.id, { denoise: a.denoise, hum: a.hum, pitch: a.pitch }), 'Cleaning up the sound…')
        .catch((er) => { if (run === prepRun && !/cancel/i.test(clean(er))) toast(clean(er), { type: 'error' }); return null; });
      if (run !== prepRun || disposed) return;
      st.prep = res;
      st.prepping = null;
      if (res) { aux.src = mediaUrl(res.path); aux.currentTime = media.currentTime; if (st.playing) aux.play().catch(() => {}); }
      applySound();
      loadWave();
      keepLoudness();
    })();
    return st.prepping;
  }
  const loudKey = () => { const e = E(), a = e.audio; return JSON.stringify([kept(), st.prepFor, a.lowcut, a.bass, a.mid, a.midHz, a.treble, a.mono, a.balance]); };
  let loudT = null;
  function keepLoudness() {
    if (!E().audio.normalise || !st.s?.audio) return;
    const want = loudKey();
    if (want === st.loudFor && st.loud) return;
    clearTimeout(loudT);
    loudT = setTimeout(async () => {
      if (st.prepFor !== prepKey()) return;
      const e = edlBase();
      const r = await call('loudness', st.s.id, { keep: e.keep, audio: { ...E().audio, prep: st.prep?.key || null } }).catch(() => null);
      if (disposed || want !== loudKey()) return;
      st.loud = r; st.loudFor = want;
      applySound(); renderPropsIf('sound', 'volume'); drawTl();
    }, 500);
  }
  async function loadWave() {
    if (!st.s?.audio) return;
    const w = await call('waveform', st.s.id, st.prep?.key || null).catch(() => null);
    if (w && !disposed) { st.wave = { per: w.per, peaks: new Uint8Array(w.peaks) }; drawTl(); }
  }
  let cueFor = null;
  async function loadCues() {
    const f = E().subs?.file || null;
    if (f === cueFor) return;
    cueFor = f;
    st.cues = f ? await call('subs', st.s.id, f).catch((er) => { toast(clean(er), { type: 'error' }); return []; }) : [];
    redraw();
  }
  let musicFor = null, musicT = null;
  // Remix runs again only once the length has stopped changing for a moment.
  function loadMusic() {
    const m = E().music, key = m ? `${m.file}|${m.fit ? outLen().toFixed(1) : ''}` : null;
    if (key === musicFor) return;
    clearTimeout(musicT);
    musicT = setTimeout(async () => {
      musicFor = key;
      if (!m) { musicEl.removeAttribute('src'); musicEl.load(); st.musicDur = 0; return; }
      let src = m.file;
      if (m.fit) src = await job('remix', () => call('remix', st.s.id, m.file, outLen()), 'Fitting the music with FilmCraft…').catch((er) => { toast(clean(er), { type: 'error' }); return m.file; });
      if (disposed || musicFor !== key) return;
      musicEl.src = mediaUrl(src);
      const info = await call('info', src).catch(() => null);
      st.musicDur = info?.duration || 0;
      syncMusic(true);
    }, m?.fit ? 700 : 0);
  }
  // A job in the worker with its progress in the status line.
  async function job(kind, fn, label) {
    let done = false;
    const poll = async () => { while (!done && !disposed) { const p = (await call('progress', st.s.id).catch(() => ({})))[kind]; if (!done) tip(`${p?.label || label.replace(/…$/, '')}… ${p?.f ? `${Math.round(p.f * 100)}%` : ''}`, true); await new Promise((r) => setTimeout(r, 250)); } };
    tip(label, true);
    poll();
    try { return await fn(); } finally { done = true; tip(null); }
  }

  // ── Header, info and properties ────────────────────────────────────────────────────────────────────────────────
  function chrome() {
    if (!st.s) return;
    const dirty = JSON.stringify(st.E) !== st.saved;
    $('.dirty', root).hidden = !dirty;
    $('[data-a="undo"]', root).disabled = !st.hist.length;
    $('[data-a="redo"]', root).disabled = !st.fut.length;
    const s = st.s, g = geom(), D = outLen();
    const src = [s.video && `${s.video.width} × ${s.video.height}`, s.video && `${Math.round(s.video.fps * 100) / 100} fps`, !s.video && s.audio && `${s.audio.rate / 1000} kHz`, !s.video && s.audio && (s.audio.channels === 1 ? 'mono' : s.audio.channels === 2 ? 'stereo' : `${s.audio.channels} channels`), fmtT(s.duration, 1)].filter(Boolean).join(' · ');
    const to = [g && (g.W !== s.video.width || g.H !== s.video.height) && `${g.W} × ${g.H}`, Math.abs(D - s.duration) > 0.01 && fmtT(D, 1)].filter(Boolean).join(' · ');
    $('.me-info', root).innerHTML = `${esc(src)}${to ? ` → <b>${esc(to)}</b>` : ''}`;
    lenEl.textContent = `Saved length ${fmtT(D, 1)}`;
  }
  function tip(msg, keep) {
    status.hidden = !msg;
    status.textContent = msg || '';
    clearTimeout(tip.t);
    if (msg && !keep) tip.t = setTimeout(() => { status.hidden = true; }, 4500);
  }
  function selectTool(t) {
    st.tool = t;
    $$('[data-tool]', root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === t));
    if (t === 'titles' && !st.selTitle && E().titles.length) st.selTitle = E().titles[0].id;
    renderProps();
    layoutFrame();
    redraw();
    tip(TOOLS[t]?.[2]);
  }
  const renderPropsIf = (...tools) => { if (tools.includes(st.tool)) renderProps(); };
  const paintRange = (r) => r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`);
  props.addEventListener('input', (e) => { if (e.target.type === 'range') paintRange(e.target); });
  function renderProps() {
    const keepScroll = props.scrollTop;
    props.innerHTML = '';
    if (!st.s) return;
    (PANELS[st.tool] || PANELS.trim)();
    props.querySelectorAll('input[type=range]').forEach(paintRange);
    props.scrollTop = keepScroll;
  }
  // Small builders for the panels.
  const sec = (title, ...kids) => { const el = h(`<div class="me-sec">${title ? `<h3>${esc(title)}</h3>` : ''}</div>`); kids.flat().filter(Boolean).forEach((k) => el.append(typeof k === 'string' ? h(k) : k)); props.append(el); return el; };
  const note = (txt) => h(`<p class="tip">${esc(txt)}</p>`);
  // `local` controls set the panel's own settings (not the edit list), so they leave no undo step.
  function slider(label, get, set, { min, max, step = 1, fmt = (v) => v, key, local }) {
    const v = get(), el = h(`<div class="field"><label class="label">${esc(label)}</label><div class="range"><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${esc(label)}"><output>${esc(fmt(v))}</output></div></div>`);
    const r = $('input', el), out = $('output', el), put = (x, quiet) => (local ? set(null, x) : edit((e) => set(e, x), key || label, quiet));
    r.addEventListener('input', () => { const x = Number(r.value); out.textContent = fmt(x); put(x, true); });
    r.addEventListener('change', () => { if (!local) renderProps(); });
    r.addEventListener('dblclick', () => { const d = min <= 0 && max >= 0 ? 0 : min; r.value = d; out.textContent = fmt(d); paintRange(r); put(d); });
    return el;
  }
  function seg(items, val, set, { wide = true, key, local } = {}) {
    const el = h(`<div class="seg${wide ? ' wide' : ''}" role="group">${items.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(val) === String(v)}">${esc(l)}</button>`).join('')}</div>`);
    el.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (local) { set(null, b.dataset.v); $$('button', el).forEach((x) => x.setAttribute('aria-pressed', x === b)); } else edit((e) => set(e, b.dataset.v), key);
    });
    return el;
  }
  function switcher(label, val, set) {
    const el = h(`<label class="switch"><span>${esc(label)}</span><input type="checkbox" ${val ? 'checked' : ''}></label>`);
    $('input', el).addEventListener('change', (ev) => edit((e) => set(e, ev.target.checked)));
    return el;
  }
  function button(label, fn, { primary, iconName, danger } = {}) {
    const el = h(`<button class="btn${primary ? ' primary' : ''}${danger ? ' danger' : ''}">${iconName ? ic(iconName, 'sm') : ''}${esc(label)}</button>`);
    el.addEventListener('click', fn);
    return el;
  }
  function timeField(label, get, set, setHere) {
    const el = h(`<div class="me-row"><span class="label grow">${esc(label)}</span><input class="input time" value="${fmtT(get())}" spellcheck="false"><button class="btn" title="Use the playhead">${ic('markIn', 'sm')}Here</button></div>`);
    const inp = $('input', el);
    inp.addEventListener('change', () => { const t = parseT(inp.value); if (t == null) { inp.value = fmtT(get()); return; } edit((e) => set(e, t)); });
    inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); });
    $('button', el).addEventListener('click', () => edit((e) => setHere(e)));
    return el;
  }
  const dbFmt = (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)} dB`;
  const PANELS = {
    trim() {
      const e = E();
      sec('Trim and cut', note('Drag the yellow handles to trim the start and end. Split at the playhead with S, pick a part and press Delete to cut it out.'),
        timeField('Start', () => e.inT, (x, t) => { x.inT = clamp(t, 0, x.outT - 0.05); }, (x) => { x.inT = clamp(st.t, 0, x.outT - 0.05); }),
        timeField('End', () => e.outT, (x, t) => { x.outT = clamp(t, x.inT + 0.05, dur()); }, (x) => { x.outT = clamp(st.t, x.inT + 0.05, dur()); }));
      const list = h('<div class="me-parts"></div>');
      e.segs.forEach((g, i) => {
        const a = Math.max(g.a, e.inT), b = Math.min(g.b, e.outT), out = b - a < 0.02;
        const row = h(`<div class="me-part${g.off || out ? ' off' : ''}${st.sel === i ? ' sel' : ''}" data-i="${i}"><i></i><span>${fmtT(g.a)} – ${fmtT(g.b)}</span><small>${out ? 'Trimmed' : g.off ? 'Cut' : 'Kept'}</small></div>`);
        row.addEventListener('click', () => { st.sel = i; seek(Math.max(g.a, e.inT)); renderProps(); drawTl(); });
        list.append(row);
      });
      const cur = e.segs[st.sel];
      sec(`Parts (${e.segs.length})`, list, h('<div class="me-btns"></div>'));
      const btns = props.lastChild.querySelector('.me-btns');
      btns.append(button('Split', () => act('split'), { iconName: 'split' }), button(cur?.off ? 'Keep part' : 'Cut part', () => act('cut'), { iconName: 'cutPart' }));
      if (cur && st.sel < e.segs.length - 1) btns.append(button('Join with next', () => edit((x) => { const [p, q] = x.segs.splice(st.sel, 2); x.segs.splice(st.sel, 0, { a: p.a, b: q.b, off: p.off && q.off }); })));
      if (e.segs.length > 1 || e.inT > 0 || e.outT < dur()) sec('', button('Reset trim and cuts', () => edit((x) => { x.inT = 0; x.outT = dur(); x.segs = [{ a: 0, b: dur(), off: false }]; st.sel = -1; })));
      if (st.s.audio) silencePanel();
    },
    crop() {
      const e = E(), g = geom();
      PANELS.rotate();
      sec('Crop', note('Drag the frame or its handles on the picture.'), seg(ASPECTS, e.aspect, (x, v) => {
        x.aspect = v;
        if (v === 'orig') { x.crop = null; return; }
        if (v === 'free') return;
        const k = aspectOf(v), c = x.crop || { x: 0, y: 0, w: 1, h: 1 };
        let w = c.w, hh = w / k;
        if (hh > 1) { hh = 1; w = k; }
        if (w > 1) { w = 1; hh = 1 / k; }
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
        x.crop = { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - hh / 2, 0, 1 - hh), w, h: hh };
      }), h(`<p class="tip">${g.cw} × ${g.ch} pixels</p>`), e.crop ? button('Reset crop', () => edit((x) => { x.crop = null; x.aspect = 'free'; })) : null);
    },
    rotate() {
      const e = E();
      sec('Turn and flip', h(`<div class="me-btns"></div>`));
      const b = props.lastChild.querySelector('.me-btns');
      b.append(button('Left', () => edit((x) => { x.rotate = (x.rotate + 270) % 360; x.crop = null; x.aspect = 'free'; }), { iconName: 'rotate' }), button('Right', () => edit((x) => { x.rotate = (x.rotate + 90) % 360; x.crop = null; x.aspect = 'free'; }), { iconName: 'rotate' }));
      b.firstChild.querySelector('svg').style.transform = 'scaleX(-1)';
      const f = h('<div class="me-btns"></div>');
      props.lastChild.append(f);
      f.append(button('Flip horizontal', () => edit((x) => { x.hflip = !x.hflip; }), { iconName: 'flipH' }), button('Flip vertical', () => edit((x) => { x.vflip = !x.vflip; }), { iconName: 'flipV' }));
    },
    resize() {
      const e = E(), g = geom(), short = Math.min(g.cw, g.ch);
      const items = SIZES.map(([v, l]) => { const k = v ? v / short : 1, W = ev(g.cw * k), H = ev(g.ch * k); return [v, `${l}`, `${W} × ${H}${v > short ? ' (larger)' : ''}`]; });
      const el = h(`<div class="me-parts" style="max-height:none">${items.map(([v, l, d]) => `<div class="me-part${e.size === v ? ' sel' : ''}" data-v="${v}"><span>${esc(l)}</span><small>${esc(d)}</small></div>`).join('')}</div>`);
      el.addEventListener('click', (ev2) => { const r = ev2.target.closest('[data-v]'); if (r) edit((x) => { x.size = Number(r.dataset.v); }); });
      sec('Size of the saved video', el, note('The shorter side is set to the size you pick; the shape stays as it is.'));
    },
    speed() {
      const e = E(), toPos = (v) => Math.log2(v) * 50, fromPos = (p) => Math.round(2 ** (p / 50) * 100) / 100;
      sec('Speed', slider('Playback speed', () => toPos(e.speed), (x, p) => { x.speed = clamp(fromPos(p), 0.25, 4); }, { min: -100, max: 100, step: 1, fmt: (p) => `${fromPos(p)}×`, key: 'speed' }),
        seg([[0.5, '0.5×'], [1, '1×'], [1.5, '1.5×'], [2, '2×'], [4, '4×']], e.speed, (x, v) => { x.speed = Number(v); }),
        st.s.audio ? note('The sound keeps its pitch.') : null);
      sec('Backwards and loop', switcher('Reverse', e.reverse, (x, v) => { x.reverse = v; }), e.reverse ? h('<p class="me-note">The preview plays forwards; the saved clip runs backwards.</p>') : null,
        slider('Play', () => e.loop, (x, v) => { x.loop = v; }, { min: 1, max: 10, step: 1, fmt: (v) => (v === 1 ? 'Once' : `${v} times`), key: 'loop' }));
      sec('', note(`Saved length ${fmtT(outLen(), 2)}.`));
    },
    colour() {
      const e = E(), c = e.color, pct = (v) => `${v > 0 ? '+' : ''}${v}`;
      const s1 = sec('Adjust');
      [['temperature', 'Temperature'], ['tint', 'Tint'], ['brightness', 'Brightness'], ['contrast', 'Contrast'], ['saturation', 'Saturation'], ['gamma', 'Midtones']]
        .forEach(([k, l]) => s1.append(slider(l, () => c[k], (x, v) => { x.color[k] = v; }, { min: -100, max: 100, fmt: pct, key: `c.${k}` })));
      looksPanel();
      if (Object.values(c).some(Boolean) || e.look || e.log) sec('', button('Reset colour', () => edit((x) => { x.color = { ...ZERO_COLOUR }; x.look = ''; x.log = ''; x.lookMix = 100; })));
    },
    titles() {
      const e = E();
      const list = h('<div class="me-titles"></div>');
      e.titles.forEach((t) => {
        const row = h(`<div class="me-part${st.selTitle === t.id ? ' sel' : ''}"><span>${esc(String(t.text).split('\n')[0] || 'Title')}</span><small>${fmtT(t.start, 1)} – ${fmtT(t.end, 1)}</small></div>`);
        row.addEventListener('click', () => { st.selTitle = t.id; renderProps(); redraw(); drawTl(); });
        list.append(row);
      });
      sec('Titles', e.titles.length ? list : note('Add a title, type the words and drag it on the picture.'), button('Add title', addTitle, { primary: !e.titles.length, iconName: 'title' }));
      const t = e.titles.find((x) => x.id === st.selTitle);
      if (!t) return;
      const set = (fn, key) => edit((x) => fn(x.titles.find((y) => y.id === t.id)), key, true);
      const text = h(`<textarea class="input" spellcheck="true" placeholder="Title text">${esc(t.text)}</textarea>`);
      text.addEventListener('input', () => set((y) => { y.text = text.value; }, `t.text.${t.id}`));
      text.addEventListener('change', () => renderProps());
      text.addEventListener('keydown', (ev2) => ev2.stopPropagation());
      const font = h(`<select class="input">${FONTS.map(([id, l, cs]) => `<option value="${id}" style="font-family:${esc(cs)}" ${t.font === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
      font.addEventListener('change', () => { set((y) => { y.font = font.value; }); redraw(); });
      const bold = h(`<button class="tb icon" aria-pressed="${!!t.bold}" title="Bold">${icon('bold')}</button>`);
      bold.addEventListener('click', () => { set((y) => { y.bold = !y.bold; }); renderProps(); });
      const row = h('<div class="me-row"></div>'); font.classList.add('grow'); row.append(font, h('<div class="seg"></div>')); row.lastChild.append(bold);
      const sw = h(`<div class="swatches">${COLORS.map((cc) => `<button style="background:${cc}" data-c="${cc}" aria-label="${cc}" aria-pressed="${cc === t.color}"></button>`).join('')}<label class="custom" title="Custom colour"><input type="color" value="${t.color}"></label></div>`);
      sw.addEventListener('click', (ev2) => { const b = ev2.target.closest('[data-c]'); if (b) { set((y) => { y.color = b.dataset.c; }); renderProps(); } });
      $('input', sw).addEventListener('change', (ev2) => { set((y) => { y.color = ev2.target.value; }); renderProps(); });
      const pos = h(`<div class="me-pos">${[0.15, 0.5, 0.85].flatMap((y) => [0.18, 0.5, 0.82].map((x) => `<button data-x="${x}" data-y="${y}" aria-pressed="${Math.abs(t.x - x) < 0.02 && Math.abs(t.y - y) < 0.02}" title="Place here"></button>`)).join('')}</div>`);
      pos.addEventListener('click', (ev2) => { const b = ev2.target.closest('button'); if (b) { set((y) => { y.x = Number(b.dataset.x); y.y = Number(b.dataset.y); y.align = b.dataset.x === '0.18' ? 'left' : b.dataset.x === '0.82' ? 'right' : 'center'; }); renderProps(); } });
      sec('Text', text, row, slider('Size', () => Math.round(t.size * 1000) / 10, (x, v) => { x.titles.find((y) => y.id === t.id).size = v / 100; }, { min: 2, max: 25, step: 0.5, fmt: (v) => `${v}%`, key: `t.size.${t.id}` }),
        h('<div class="label">Colour</div>'), sw,
        h('<div class="label">Style</div>'), seg([['plain', 'Plain'], ['shadow', 'Shadow'], ['outline', 'Outline'], ['box', 'Box']], t.style, (x, v) => { x.titles.find((y) => y.id === t.id).style = v; }),
        h('<div class="me-row"><span class="label grow">Position</span></div>'));
      props.lastChild.lastChild.append(pos);
      sec('Timing in the saved clip',
        timeField('From', () => t.start, (x, v) => { const y = x.titles.find((q) => q.id === t.id); y.start = clamp(v, 0, y.end - 0.1); }, (x) => { const y = x.titles.find((q) => q.id === t.id); y.start = clamp(outOf(st.t), 0, y.end - 0.1); }),
        timeField('To', () => t.end, (x, v) => { const y = x.titles.find((q) => q.id === t.id); y.end = clamp(v, y.start + 0.1, outLen()); }, (x) => { const y = x.titles.find((q) => q.id === t.id); y.end = clamp(outOf(st.t), y.start + 0.1, outLen()); }),
        slider('Fade', () => t.fade, (x, v) => { x.titles.find((y) => y.id === t.id).fade = v; }, { min: 0, max: 2, step: 0.1, fmt: (v) => `${v.toFixed(1)} s`, key: `t.fade.${t.id}` }));
      sec('', button('Delete title', () => edit((x) => { x.titles = x.titles.filter((y) => y.id !== t.id); }), { danger: true, iconName: 'delete' }));
    },
    fade() {
      const e = E(), max = Math.min(10, Math.floor((outLen() / 2) * 10) / 10);
      sec(st.kind === 'video' ? 'Fade in and out' : 'Fade',
        slider('Fade in', () => e.fadeIn, (x, v) => { x.fadeIn = v; }, { min: 0, max: Math.max(0.1, Math.min(max, 10)), step: 0.1, fmt: (v) => `${v.toFixed(1)} s`, key: 'fadeIn' }),
        slider('Fade out', () => e.fadeOut, (x, v) => { x.fadeOut = v; }, { min: 0, max: Math.max(0.1, Math.min(max, 10)), step: 0.1, fmt: (v) => `${v.toFixed(1)} s`, key: 'fadeOut' }));
      if (st.kind === 'video') sec('', switcher('Picture (to black)', e.fadePicture, (x, v) => { x.fadePicture = v; }), st.s.audio ? switcher('Sound', e.fadeSound, (x, v) => { x.fadeSound = v; }) : null);
    },
    sound() {
      if (!st.s.audio) { sec('Sound', note('This video has no sound. Add music to give it some.')); return; }
      volumePanel(); eqPanel(); cleanPanel(); pitchPanel(); channelsPanel();
    },
    volume() { volumePanel(); },
    eq() { eqPanel(); },
    clean() { cleanPanel(); silencePanel(); },
    pitch() { pitchPanel(); },
    channels() { channelsPanel(); },
    music() {
      const m = E().music;
      if (!m) { sec('Music', note('Add a song or any sound file. It plays from the start, under the clip’s own sound or instead of it.'), button('Choose music…', chooseMusic, { primary: true, iconName: 'music' })); return; }
      sec('Music', h(`<div class="me-file">${ic('music', 'sm')}<span title="${esc(m.file)}">${esc(nameOf(m.file))}</span></div>`), h('<div class="me-btns"></div>'));
      props.lastChild.querySelector('.me-btns').append(button('Change…', chooseMusic), button('Remove', () => edit((x) => { x.music = null; }), { danger: true }));
      const set = (fn) => (x, v) => fn(x.music, v);
      sec('Mix', slider('Volume', () => m.volume, set((y, v) => { y.volume = v; }), { min: -30, max: 6, step: 0.5, fmt: dbFmt, key: 'm.volume' }),
        st.s.audio ? seg([['mix', 'Under the sound'], ['replace', 'Instead of it']], m.mode, set((y, v) => { y.mode = v; })) : null,
        st.s.audio && m.mode === 'mix' ? slider('Lower while there’s sound', () => m.duck, set((y, v) => { y.duck = v; }), { min: 0, max: 24, step: 1, fmt: (v) => (v ? `−${v} dB` : 'Off'), key: 'm.duck' }) : null);
      sec('Length', switcher('Repeat to the end', m.loop && !m.fit, set((y, v) => { y.loop = v; if (v) y.fit = false; })),
        st.s.can.film ? switcher('Fit to the clip (FilmCraft Remix)', !!m.fit, set((y, v) => { y.fit = v; if (v) y.loop = false; })) : null,
        m.fit ? note('FilmCraft re-cuts the music on its beats so it ends with the clip.') : null,
        slider('Fade out at the end', () => m.fadeOut, set((y, v) => { y.fadeOut = v; }), { min: 0, max: 8, step: 0.5, fmt: (v) => `${v.toFixed(1)} s`, key: 'm.fade' }));
    },
    subs() {
      const sb = E().subs;
      if (!sb) { sec('Subtitles', note('Choose an SRT, VTT or ASS file. The words are drawn into the picture, timed to the cuts you make.'), button('Choose subtitles…', chooseSubs, { primary: true, iconName: 'subs' })); return; }
      sec('Subtitles', h(`<div class="me-file">${ic('subs', 'sm')}<span title="${esc(sb.file)}">${esc(nameOf(sb.file))}</span></div>`), note(`${st.cues.length} lines`), h('<div class="me-btns"></div>'));
      props.lastChild.querySelector('.me-btns').append(button('Change…', chooseSubs), button('Remove', () => edit((x) => { x.subs = null; }), { danger: true }));
      sec('Look', slider('Size', () => sb.size, (x, v) => { x.subs.size = v; }, { min: 10, max: 36, step: 1, fmt: (v) => String(v), key: 'subs.size' }));
    },
    scenes() {
      const can = st.s.can.film;
      sec('Scene edit detection', note('FilmCraft looks for the cuts between shots. Each one becomes a split, so you can keep or cut shots in Trim.'),
        slider('Sensitivity', () => st.sens ?? 50, (x, v) => { st.sens = v; }, { min: 1, max: 100, fmt: (v) => String(v), local: true }),
        can ? button('Find scenes', findScenes, { primary: true, iconName: 'scenes' }) : note('FilmCraft isn’t in this build of Lime.'));
      if (can) sec('Save each scene', note('FilmCraft saves every shot of the original file as a clip of its own, in a folder beside it.'), button('Save scenes', saveScenes, { iconName: 'save' }));
    },
    stabilise() {
      const e = E(), can = st.s.can.stabilise;
      sec('Stabilise', can ? switcher('Steady the picture', e.stabilise, (x, v) => { x.stabilise = v; }) : note('This copy of FFmpeg can’t stabilise video.'),
        note(can === 'vidstab' ? 'The shake is measured over the whole edit first, then smoothed out; the edges are zoomed in a little to hide the movement. You’ll see it in the saved clip.' : 'Small shakes are smoothed out when you save.'));
    },
    frame() {
      sec('Save this frame', note('The picture under the playhead, with your crop, colour and titles, as a PNG or JPEG beside the original.'),
        seg([['png', 'PNG'], ['jpg', 'JPEG']], st.frameFmt || 'png', (x, v) => { st.frameFmt = v; }, { local: true }), button('Save frame', saveFrame, { primary: true, iconName: 'frame' }));
    },
  };
  function volumePanel() {
    const e = E(), a = e.audio, norm = a.normalise && st.loud && st.loudFor === loudKey() ? clamp(a.target - st.loud.lufs, -30, 30) : null;
    sec('Volume', a.normalise ? null : slider('Gain', () => a.gain, (x, v) => { x.audio.gain = v; }, { min: -20, max: 20, step: 0.5, fmt: dbFmt, key: 'gain' }),
      switcher('Level the loudness', a.normalise, (x, v) => { x.audio.normalise = v; }),
      a.normalise ? seg([[-14, 'Music −14'], [-16, 'Web −16'], [-23, 'TV −23']], a.target, (x, v) => { x.audio.target = Number(v); }) : null,
      a.normalise ? note(norm == null ? 'Measuring the loudness…' : `It measures ${st.loud.lufs.toFixed(1)} LUFS, so the gain is set to ${dbFmt(norm)} to reach ${a.target} LUFS (EBU R128).`) : null,
      st.kind === 'video' ? switcher('Mute the clip’s sound', e.mute, (x, v) => { x.mute = v; }) : null);
  }
  function eqPanel() {
    const a = E().audio;
    const chips = h(`<div class="chips">${EQS.map(([v, l]) => `<button type="button" class="chip" data-v="${v}" aria-pressed="${a.eq === v}">${esc(l)}</button>`).join('')}</div>`);
    chips.addEventListener('click', (ev2) => { const b = ev2.target.closest('[data-v]'); if (b) edit((x) => setEq(x, b.dataset.v)); });
    sec('EQ', chips,
      slider('Bass', () => a.bass, (x, v) => { x.audio.bass = v; x.audio.eq = 'custom'; }, { min: -12, max: 12, step: 0.5, fmt: dbFmt, key: 'bass' }),
      slider('Presence', () => a.mid, (x, v) => { x.audio.mid = v; x.audio.eq = 'custom'; }, { min: -12, max: 12, step: 0.5, fmt: dbFmt, key: 'mid' }),
      slider('Treble', () => a.treble, (x, v) => { x.audio.treble = v; x.audio.eq = 'custom'; }, { min: -12, max: 12, step: 0.5, fmt: dbFmt, key: 'treble' }));
  }
  const setEq = (x, v) => { const p = EQS.find((q) => q[0] === v)?.[2] || {}; Object.assign(x.audio, { eq: v, bass: 0, treble: 0, mid: 0, midHz: 3000, lowcut: 0, ...p }); };
  function cleanPanel() {
    const a = E().audio, film = st.s.can.film;
    sec('Noise', seg([['', 'Off'], ['light', 'Light'], ['strong', 'Strong'], ...(film ? [['voice', 'Voice']] : [])], a.denoise, (x, v) => { x.audio.denoise = v; }),
      note(a.denoise === 'voice' ? 'FilmCraft’s dialogue repair takes noise and rumble out of speech.' : a.denoise ? 'FFmpeg’s noise reduction follows the background noise as it changes.' : 'Takes steady background noise (fans, hiss, traffic) out of the sound.'),
      h('<div class="label">Mains hum</div>'), seg([[0, 'Off'], [50, '50 Hz'], [60, '60 Hz']], a.hum, (x, v) => { x.audio.hum = Number(v); }));
  }
  function silencePanel() {
    st.sil ||= { db: -40, min: 0.8 };
    sec('Remove silence', note('Cuts every pause longer than the time below, leaving a little room either side. Each one shows as a cut part you can keep again.'),
      slider('Quieter than', () => st.sil.db, (x, v) => { st.sil.db = v; }, { min: -70, max: -20, step: 1, fmt: (v) => `${v} dB`, local: true }),
      slider('For at least', () => st.sil.min, (x, v) => { st.sil.min = v; }, { min: 0.3, max: 5, step: 0.1, fmt: (v) => `${v.toFixed(1)} s`, local: true }),
      button('Remove silence', removeSilence, { iconName: 'cutPart' }));
  }
  function pitchPanel() {
    const a = E().audio;
    sec('Pitch', slider('Semitones', () => a.pitch, (x, v) => { x.audio.pitch = v; }, { min: -12, max: 12, step: 1, fmt: (v) => (v > 0 ? `+${v}` : String(v)), key: 'pitch' }),
      note('Higher or lower without changing the speed.'));
  }
  function channelsPanel() {
    const a = E().audio;
    sec('Channels', switcher('Mono (both sides the same)', a.mono, (x, v) => { x.audio.mono = v; }),
      a.mono ? null : slider('Balance', () => a.balance, (x, v) => { x.audio.balance = v; }, { min: -1, max: 1, step: 0.05, fmt: (v) => (Math.abs(v) < 0.01 ? 'Centre' : v < 0 ? `Left ${Math.round(-v * 100)}%` : `Right ${Math.round(v * 100)}%`), key: 'balance' }));
  }
  function looksPanel() {
    const e = E();
    if (!st.s.can.film) { sec('Looks', note('FilmCraft isn’t in this build of Lime, so its looks aren’t available.')); return; }
    const box = sec('Looks', note('FilmCraft’s Lumetri looks and creative LUTs.'));
    if (!st.looks) { box.append(note('Loading…')); loadLooks(); return; }
    const groups = [...new Set(st.looks.looks.map((l) => l.group))];
    const swatch = (l) => `<button class="me-look" data-look="${esc(l.id)}" aria-pressed="${e.look === l.id}" title="${esc(l.desc || l.name)}"><img alt="" data-swatch="${esc(l.id)}"><span>${esc(l.name)}</span></button>`;
    box.append(h(`<div class="me-looks">${swatch({ id: '', name: 'None' })}</div>`));
    for (const g of groups) box.append(h(`<div class="me-group">${esc(g)}</div>`), h(`<div class="me-looks">${st.looks.looks.filter((l) => l.group === g).map(swatch).join('')}</div>`));
    box.addEventListener('click', (ev2) => { const b = ev2.target.closest('[data-look]'); if (b) edit((x) => { x.look = b.dataset.look; }); });
    if (e.look) box.append(slider('Strength', () => e.lookMix, (x, v) => { x.lookMix = v; }, { min: 0, max: 100, fmt: (v) => `${v}%`, key: 'lookMix' }));
    const logs = h(`<select class="input"><option value="">None</option>${st.looks.logs.map((l) => `<option value="${esc(l.id)}" ${e.log === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`);
    logs.addEventListener('change', () => edit((x) => { x.log = logs.value; }));
    sec('Camera log', note('For footage shot in a log profile: turns it into normal-looking colour first.'), logs);
    paintSwatches();
  }
  async function loadLooks() {
    if (st.loadingLooks) return;
    st.loadingLooks = true;
    st.looks = await call('looks').catch((er) => { toast(clean(er), { type: 'error' }); return { looks: [], logs: [] }; });
    st.loadingLooks = false;
    renderPropsIf('colour');
  }
  // Each look shown on the frame under the playhead.
  async function paintSwatches() {
    const imgs = $$('img[data-swatch]', props);
    if (!imgs.length || !media || media.readyState < 2) return;
    const W = 120, H = 68, c = document.createElement('canvas');
    c.width = W; c.height = H;
    flatView(c).draw(media, frameMap(false), 1);
    const base = c.getContext('2d').getImageData(0, 0, W, H);
    for (const img of imgs) {
      const id = img.dataset.swatch;
      if (!id) { img.src = c.toDataURL(); continue; }
      const lut = await lutOf(id);
      if (!lut || !img.isConnected) continue;
      const out = new ImageData(new Uint8ClampedArray(base.data), W, H), p = out.data;
      for (let i = 0; i < p.length; i += 4) { const [r, g, b] = sample(lut, p[i] / 255, p[i + 1] / 255, p[i + 2] / 255); p[i] = r * 255; p[i + 1] = g * 255; p[i + 2] = b * 255; }
      const cc = document.createElement('canvas'); cc.width = W; cc.height = H; cc.getContext('2d').putImageData(out, 0, 0);
      img.src = cc.toDataURL();
    }
  }
  function addTitle() {
    const D = outLen(), at = clamp(outOf(st.t), 0, Math.max(0, D - 0.5)), id = `t${Date.now().toString(36)}`;
    edit((x) => { x.titles.push({ id, text: 'Title', font: 'sans', bold: true, size: 0.08, color: '#ffffff', style: 'shadow', x: 0.5, y: 0.85, align: 'center', start: at, end: Math.min(D, at + Math.min(4, D)), fade: 0.3 }); });
    st.selTitle = id;
    renderProps();
    const ta = $('textarea', props);
    ta?.focus(); ta?.select();
  }
  async function chooseMusic() {
    const [f] = await api.invoke('dialog:open', { multi: false, filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'aiff', 'aif', 'wma', 'mp4', 'mov', 'webm'] }] });
    if (!f) return;
    const info = await call('info', f).catch(() => null);
    if (!info?.audio) { toast(`${nameOf(f)} has no sound.`, { type: 'error' }); return; }
    edit((x) => { x.music = { file: f, volume: -8, mode: 'mix', duck: st.s.audio ? 10 : 0, loop: true, fit: false, fadeOut: 2, ...(x.music ? { volume: x.music.volume, mode: x.music.mode, duck: x.music.duck } : {}) }; });
  }
  async function chooseSubs() {
    const [f] = await api.invoke('dialog:open', { multi: false, filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa', 'sub', 'smi', 'ttml', 'scc', 'lrc'] }] });
    if (f) edit((x) => { x.subs = { file: f, size: x.subs?.size || 18 }; });
  }
  async function findScenes() {
    const cuts = await job('scenes', () => call('scenes', st.s.id, st.sens ?? 50), 'Finding scenes with FilmCraft…').catch((er) => { toast(clean(er), { type: 'error' }); return null; });
    if (!cuts) return;
    if (!cuts.length) { toast('FilmCraft found one continuous shot, so there’s nothing to split.'); return; }
    edit((x) => { for (const t of cuts) splitAt(x, t); });
    toast(`Split at ${cuts.length} cut${cuts.length === 1 ? '' : 's'}: ${cuts.slice(0, 6).map((t) => fmtT(t, 1)).join(', ')}${cuts.length > 6 ? '…' : ''}`, { type: 'success' });
    selectTool('trim');
  }
  async function saveScenes() {
    const r = await job('scenes', () => call('saveScenes', st.s.id, st.sens ?? 50), 'Saving each scene with FilmCraft…').catch((er) => { toast(clean(er), { type: 'error' }); return null; });
    if (r?.path) toast(r.note || `Saved ${nameOf(r.path)}`, { type: 'success', actions: [{ label: 'Show in folder', fn: () => api.invoke('shell:show', r.path) }] });
  }
  async function removeSilence() {
    const quiet = await job('silence', () => call('silences', st.s.id, { db: st.sil.db, min: st.sil.min, key: st.prep?.key }), 'Finding the silences…').catch((er) => { toast(clean(er), { type: 'error' }); return null; });
    if (!quiet) return;
    const pad = 0.12, parts = quiet.map(([a, b]) => [a + (a > 0.01 ? pad : 0), b - (b < dur() - 0.01 ? pad : 0)]).filter(([a, b]) => b - a > 0.1);
    if (!parts.length) { toast('No silences that long were found.'); return; }
    edit((x) => { for (const [a, b] of parts) { splitAt(x, a); splitAt(x, b); for (const g of x.segs) if (g.a >= a - 1e-3 && g.b <= b + 1e-3) g.off = true; } });
    toast(`Cut ${parts.length} silence${parts.length === 1 ? '' : 's'}, ${fmtT(parts.reduce((s, [a, b]) => s + b - a, 0), 1)} in all.`, { type: 'success' });
    selectTool('trim');
  }
  function splitAt(x, t) {
    const i = x.segs.findIndex((g) => t > g.a + 0.04 && t < g.b - 0.04);
    if (i < 0) return false;
    const g = x.segs[i];
    x.segs.splice(i, 1, { a: g.a, b: t, off: g.off }, { a: t, b: g.b, off: g.off });
    return true;
  }
  function act(a) {
    const t = media ? media.currentTime : st.t;
    if (a === 'split') {
      const snap = JSON.stringify(st.E), i = segAt(t);
      if (splitAt(st.E, t)) { st.hist.push(snap); st.fut = []; lastKey = null; st.sel = i + 1; changed(); tip('Split. Pick a part and press Delete to cut it out.'); }
      else tip('Move the playhead away from the edge of a part to split it.');
    }
    if (a === 'cut') {
      const i = st.sel >= 0 && st.sel < E().segs.length ? st.sel : segAt(t);
      edit((x) => { x.segs[i].off = !x.segs[i].off; });
      st.sel = i;
      if (!kept().length) tip('Every part is cut. Nothing would be saved.');
    }
    if (a === 'in') edit((x) => { x.inT = clamp(t, 0, x.outT - 0.05); });
    if (a === 'out') edit((x) => { x.outT = clamp(t, x.inT + 0.05, dur()); });
  }

  // ── Saving ─────────────────────────────────────────────────────────────────────────────────────────────────────
  function edlBase() {
    const e = E(), g = geom();
    return {
      keep: kept(), loop: e.loop, speed: e.speed, reverse: e.reverse, stabilise: e.stabilise && !!st.s.can.stabilise,
      geom: g && { rotate: g.rotate, hflip: g.hflip, vflip: g.vflip, crop: g.crop, out: g.out }, lut: st.cube,
      subs: e.subs, fadeIn: e.fadeIn, fadeOut: e.fadeOut, fadePicture: e.fadePicture, fadeSound: e.fadeSound, mute: e.mute,
      music: e.music && { ...e.music, duck: e.music.mode === 'mix' ? e.music.duck : 0 },
      audio: { ...e.audio, gain: totalGain(), prep: st.prep?.key || null },
    };
  }
  async function titlePngs(list, W, H, at) {
    const out = [];
    for (const t of list) {
      if (!String(t.text).trim()) continue;
      await document.fonts.load(`${t.bold ? 700 : 400} ${Math.round(t.size * H)}px ${fontCss(t.font)}`).catch(() => {});
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      drawTitle(c.getContext('2d'), W, H, t, 1);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      out.push({ png: new Uint8Array(await blob.arrayBuffer()), start: t.start, end: t.end, fade: t.fade, opacity: at == null ? 1 : titleOpacity(t, at) });
    }
    return out;
  }
  // Everything that runs in the background (the cleaned-up sound, the loudness, the colour cube) is finished first, so
  // the file matches what was shown.
  async function ready() {
    await keepPrepared(prepKey() && !st.prep && !st.prepping);
    await st.prepping;
    if (E().audio.normalise && st.s.audio && st.loudFor !== loudKey()) {
      const e = edlBase();
      st.loud = await call('loudness', st.s.id, { keep: e.keep, audio: { ...E().audio, prep: st.prep?.key || null } }).catch(() => null);
      st.loudFor = loudKey();
    }
    if (cubeQueued || [E().look, E().log].some((id) => id && !st.luts.has(id))) { await Promise.all([E().look, E().log].filter(Boolean).map(lutOf)); st.cube = st.kind === 'video' ? buildCube(E().color, st.luts.get(E().look), st.luts.get(E().log), E().lookMix) : null; }
  }
  async function save(as) {
    if (st.busy) return false;
    if (!kept().length) { toast('Every part of the clip is cut, so there is nothing to save.', { type: 'error' }); return false; }
    let target = st.savePath, opts = { format: 'same', quality: 'high' };
    const base = nameOf(file).replace(/\.[^.]+$/, '');
    if (as) {
      const pick = await formatDialog();
      if (!pick) return false;
      opts = pick;
      const ext = pick.format === 'hevc' ? 'mp4' : pick.format;
      target = await api.invoke('dialog:save', { defaultPath: `${dirOf(file)}${sep}${base} (edited).${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
      if (!target) return false;
    } else if (!target) target = `${dirOf(file)}${sep}${base} (edited).${st.s.save.ext}`;
    else opts = st.saveOpts || opts;
    pause();
    st.busy = true;
    const card = h(`<div class="me-busy"><div class="card"><b>Saving ${esc(nameOf(target))}</b><div class="me-bar"><i></i></div><div class="row"><span class="lbl">Getting ready…</span><button class="btn">Cancel</button></div></div></div>`);
    $('button', card).addEventListener('click', () => { call('cancel', st.s.id, 'save'); $('.lbl', card).textContent = 'Stopping…'; });
    (st.kind === 'video' ? stage : tl).append(card);
    let done = false;
    const poll = async () => { while (!done && !disposed) { const p = (await call('progress', st.s.id).catch(() => ({}))).save; if (p && !done) { $('i', card).style.width = `${Math.round(p.f * 100)}%`; $('.lbl', card).textContent = `${p.label}… ${Math.round(p.f * 100)}%`; } await new Promise((r) => setTimeout(r, 200)); } };
    try {
      await ready();
      const e = edlBase(), g = geom();
      if (g) e.titles = await titlePngs(E().titles, g.W, g.H);
      poll();
      const res = await call('save', st.s.id, e, target, opts);
      st.savePath = target; st.saveOpts = opts;
      st.saved = JSON.stringify(st.E);
      toast(`Saved ${nameOf(res.path)}`, { type: 'success', actions: [{ label: 'Open', fn: () => api.invoke('shell:open', res.path) }, { label: 'Show in folder', fn: () => api.invoke('shell:show', res.path) }] });
      return true;
    } catch (er) {
      const m = clean(er);
      if (!/cancel/i.test(m)) toast(m, { type: 'error' }); else tip('Saving stopped.');
      return false;
    } finally { done = true; st.busy = false; card.remove(); chrome(); }
  }
  function formatDialog() {
    const v = !!st.s.video, list = [
      ...(v ? [['mp4', 'MP4', 'H.264, plays everywhere'], ['hevc', 'MP4 (HEVC)', 'Smaller, newer devices'], ['webm', 'WebM', 'VP9 for the web'], ['mov', 'MOV', 'H.264 for Apple apps'], ['gif', 'GIF', 'Short silent loop']] : []),
      ['mp3', 'MP3', 'Sound only'], ['m4a', 'M4A', 'AAC sound'], ['wav', 'WAV', 'Uncompressed'], ['flac', 'FLAC', 'Lossless, smaller'], ...(v ? [] : [['ogg', 'Ogg', 'Vorbis'], ['opus', 'Opus', 'Small, for speech']])];
    let fmt = v ? (['mp4', 'webm', 'mov'].includes(st.s.save.ext) ? st.s.save.ext : 'mp4') : (list.some(([x]) => x === st.s.save.ext) ? st.s.save.ext : 'mp3'), q = 'high';
    return new Promise((resolve) => {
      const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>Save as</h2><div class="me-fmts">${list.map(([id, l, d]) => `<button data-f="${id}" aria-pressed="${id === fmt}"><b>${esc(l)}</b><small>${esc(d)}</small></button>`).join('')}</div>
        <div class="field"><span class="label">Quality</span><div class="seg wide" data-q>${[['high', 'High'], ['balanced', 'Balanced'], ['small', 'Smaller file']].map(([id, l]) => `<button data-v="${id}" aria-pressed="${id === q}">${l}</button>`).join('')}</div></div></div>
        <div class="foot"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="ok">Save as…</button></div></div></div>`);
      document.body.append(s);
      s.addEventListener('click', (ev2) => {
        const f = ev2.target.closest('[data-f]'), qq = ev2.target.closest('[data-q] button'), a = ev2.target.closest('[data-a]')?.dataset.a;
        if (f) { fmt = f.dataset.f; $$('[data-f]', s).forEach((b) => b.setAttribute('aria-pressed', b === f)); }
        if (qq) { q = qq.dataset.v; $$('[data-q] button', s).forEach((b) => b.setAttribute('aria-pressed', b === qq)); }
        if (a) { s.remove(); resolve(a === 'ok' ? { format: fmt, quality: q } : null); }
      });
      s.addEventListener('keydown', (ev2) => { ev2.stopPropagation(); if (ev2.key === 'Escape') { s.remove(); resolve(null); } });
    });
  }
  async function saveFrame() {
    if (!st.s.video) return;
    pause();
    await ready();
    const t = media.currentTime, o = outOf(t), e = edlBase(), g = geom(), fmt = st.frameFmt || 'png';
    const cue = E().subs && inKept(t) ? st.cues.find((c) => t >= c.start && t < c.end)?.text : null;
    const titles = (await titlePngs(E().titles, g.W, g.H, o)).filter((x) => x.opacity > 0);
    const out = `${dirOf(file)}${sep}${nameOf(file).replace(/\.[^.]+$/, '')} - ${fmtT(t, 2).replace(/:/g, '.')}.${fmt}`;
    try {
      const r = await call('frame', st.s.id, e, { t, titles, cue, fade: E().fadePicture ? fadeAt(o) : 1 }, out);
      toast(`Saved ${nameOf(r.path)}`, { type: 'success', actions: [{ label: 'Open', fn: () => api.invoke('shell:open', r.path) }, { label: 'Show in folder', fn: () => api.invoke('shell:show', r.path) }] });
    } catch (er) { toast(clean(er), { type: 'error' }); }
  }
  async function close() {
    if (JSON.stringify(st.E) !== st.saved && st.s) {
      const choice = await new Promise((resolve) => {
        const s = h(`<div class="scrim"><div class="dialog"><div class="body"><h2>Save changes to ${esc(nameOf(file))}?</h2><p class="muted" style="margin:0">Your edits will be lost if you don’t save them.</p></div><div class="foot"><button class="btn primary" data-a="save">Save</button><button class="btn" data-a="discard">Don’t save</button><button class="btn" data-a="cancel">Cancel</button></div></div></div>`);
        document.body.append(s);
        s.addEventListener('click', (ev2) => { const a = ev2.target.closest('[data-a]')?.dataset.a; if (a) { s.remove(); resolve(a); } });
      });
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await save(false))) return;
    }
    go();
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────────────────────────────────────────
  root.addEventListener('click', (ev2) => {
    // Space plays and pauses, so it mustn't also press the button last clicked.
    if (ev2.target.closest('.toolbar, .me-transport, .topbar')) ev2.target.closest('button')?.blur();
    const t = ev2.target.closest('[data-tool]');
    if (t) { selectTool(t.dataset.tool); return; }
    const a = ev2.target.closest('[data-a]')?.dataset.a;
    if (!a || !st.s) return;
    ({
      close, undo, redo, save: () => save(false), saveas: () => save(true), play: playPause, start: () => { pause(); seek(kept()[0]?.[0] ?? 0); }, back: () => step(-1), fwd: () => step(1),
      in: () => act('in'), out: () => act('out'), split: () => act('split'), cut: () => act('cut'), zin: () => setZoom(st.zoom * 1.6), zout: () => setZoom(st.zoom / 1.6), zfit: () => setZoom(fitZoom()),
    })[a]?.();
  });
  $('.me-vol input', root).addEventListener('input', (ev2) => { if (nodes) nodes.master.gain.value = Number(ev2.target.value) ** 2; else if (media) media.volume = Number(ev2.target.value); });
  const onKey = (ev2) => {
    if (document.querySelector('.scrim') || !st.s) return;
    if (ev2.target.matches?.('input:not([type=range]):not([type=checkbox]), textarea, select')) return;
    const c = ev2.ctrlKey || ev2.metaKey, k = ev2.key.toLowerCase();
    if (c && k === 'z' && !ev2.shiftKey) { ev2.preventDefault(); undo(); }
    else if (c && (k === 'y' || (ev2.shiftKey && k === 'z'))) { ev2.preventDefault(); redo(); }
    else if (c && k === 's') { ev2.preventDefault(); save(ev2.shiftKey); }
    else if (c) return;
    else if (ev2.key === ' ' || k === 'k') { ev2.preventDefault(); if (k === "k") pause(); else playPause(); }
    else if (k === 'l') { if (st.playing) { st.rate = Math.min(4, st.rate * 2); applySound(); } else play(); }
    else if (k === 'j') { pause(); seek((media?.currentTime ?? st.t) - 1); }
    else if (ev2.key === 'ArrowLeft') { ev2.preventDefault(); step(ev2.shiftKey ? -fps() : -1); }
    else if (ev2.key === 'ArrowRight') { ev2.preventDefault(); step(ev2.shiftKey ? fps() : 1); }
    else if (ev2.key === 'Home') { pause(); seek(E().inT); }
    else if (ev2.key === 'End') { pause(); seek(E().outT); }
    else if (k === 'i') act('in');
    else if (k === 'o') act('out');
    else if (k === 's') act('split');
    else if (ev2.key === 'Delete' || ev2.key === 'Backspace') { ev2.preventDefault(); if (st.tool === 'titles' && st.selTitle) edit((x) => { x.titles = x.titles.filter((y) => y.id !== st.selTitle); }); else act('cut'); }
    else if (ev2.key === '+' || ev2.key === '=') setZoom(st.zoom * 1.6);
    else if (ev2.key === '-') setZoom(st.zoom / 1.6);
  };
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => { if (!st.s || !st.zoom) return; setZoom(st.atFit ? fitZoom() : st.zoom); layoutFrame(); redraw(); });
  ro.observe(stage); ro.observe(tl);
  const themeWatch = new MutationObserver(() => drawTl());
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('beforeunload', () => { if (st.s) call('close', st.s.id).catch(() => {}); });

  async function load() {
    try { st.s = await call('open', file); } catch (er) { toast(clean(er), { type: 'error' }); go(); return; }
    const s = st.s;
    st.kind = s.video ? 'video' : 'audio';
    root.classList.add(st.kind);
    (st.kind === 'video' ? stage : tl).append(status);
    if (st.kind === 'audio') $('.doc', root).firstElementChild.outerHTML = icon('music');
    st.E = fresh(s.duration);
    st.saved = JSON.stringify(st.E);
    st.tool = 'trim';
    $('.toolbar', root).innerHTML = GROUPS[st.kind].map(([name, ids], gi) => `<div class="tgroup${gi ? ' opt' : ''}" role="group" aria-label="${name}">${ids.map((id) => { const [icn, label, tp] = TOOLS[id]; return `<button class="tool" data-tool="${id}" aria-pressed="${id === st.tool}" title="${esc(`${label}: ${tp}`)}">${ic(icn)}<span class="lbl">${label}</span></button>`; }).join('')}</div>`).join('');
    makeMedia();
    if (st.kind === 'video') { viewer = glView(glc); st.view = viewer ? 'webgl' : '2d'; viewer ||= flatView(glc); }
    makeGraph();
    applySound();
    let src = s.playable ? file : null;
    const proxy = () => job('proxy', () => call('proxy', s.id), 'Making a preview copy…');
    try {
      if (!src) src = await proxy();
      const loaded = (u) => new Promise((resolve) => {
        media.src = mediaUrl(u);
        const ok = () => resolve(st.kind !== 'video' || media.videoWidth > 0), bad = () => resolve(false);
        media.addEventListener('loadeddata', ok, { once: true });
        media.addEventListener('error', bad, { once: true });
        setTimeout(bad, 8000);
      });
      if (!(await loaded(src)) && src === file) { src = await proxy(); await loaded(src); }
    } catch (er) { toast(clean(er), { type: 'error' }); }
    if (disposed) return;
    st.zoom = fitZoom();
    setZoom(st.zoom);
    loadWave();
    renderProps();
    chrome();
    layoutFrame();
    refreshColour();
    seek(0);
    st.ready = true;
    tip(st.kind === 'video' ? 'Space plays. Drag the yellow handles to trim; S splits at the playhead.' : 'Space plays. Drag the yellow handles to trim; S splits at the playhead.');
  }
  // For the tests and screenshots.
  window.__media = { st, E, seek, act, selectTool, save, play, pause, kept, outLen, geom, edit: (fn) => edit(fn), addTitle, setTool: selectTool };
  load();

  return () => {
    disposed = true;
    document.removeEventListener('keydown', onKey);
    ro.disconnect();
    themeWatch.disconnect();
    cancelAnimationFrame(raf);
    if (st.s) call('close', st.s.id).catch(() => {});
    ac?.close().catch(() => {});
  };
}
