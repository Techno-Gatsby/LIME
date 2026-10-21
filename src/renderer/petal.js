const f = (n) => (Math.round(n * 100) / 100).toString();
const at = (a, r) => [r * Math.sin(a), -r * Math.cos(a)];
const P = (p) => `${f(p[0])} ${f(p[1])}`;

export function wedge(i, n, rIn, rOut, gap = 7, kOut = 10, kIn = 6) {
  if (n === 1) return `M0 ${-rOut}A${rOut} ${rOut} 0 1 1 0 ${rOut}A${rOut} ${rOut} 0 1 1 0 ${-rOut}ZM0 ${-rIn}A${rIn} ${rIn} 0 1 0 0 ${rIn}A${rIn} ${rIn} 0 1 0 0 ${-rIn}Z`;
  const step = (Math.PI * 2) / n, g = gap / 2, half = Math.sin(Math.min(step, Math.PI) * 0.42);
  const ko = Math.max(2, Math.min(kOut, (rOut * half - g) / (1 + half), (rOut - rIn) * 0.42));
  const ki = Math.max(2, Math.min(kIn, (rIn * half - g) / (1 - half), (rOut - rIn) * 0.3));
  const u = (a) => [Math.sin(a), -Math.cos(a)], t = (a) => [Math.cos(a), Math.sin(a)];
  const pt = (a, s, d) => { const [ux, uy] = u(a), [tx, ty] = t(a); return [ux * s + tx * d, uy * s + ty * d]; };
  const scale = ([x, y], m) => [x * m, y * m];
  const corner = (a, side, r, k, outer) => {
    const s = Math.sqrt((outer ? r - k : r + k) ** 2 - (g + k) ** 2);
    const c = pt(a, s, side * (g + k));
    return { line: pt(a, s, side * g), arc: scale(c, r / (outer ? r - k : r + k)) };
  };
  const a0 = i * step - step / 2, a1 = i * step + step / 2;
  const o0 = corner(a0, 1, rOut, ko, true), o1 = corner(a1, -1, rOut, ko, true), i0 = corner(a0, 1, rIn, ki, false), i1 = corner(a1, -1, rIn, ki, false);
  const large = step > Math.PI ? 1 : 0;
  return `M${P(i0.line)}L${P(o0.line)}A${f(ko)} ${f(ko)} 0 0 1 ${P(o0.arc)}A${f(rOut)} ${f(rOut)} 0 ${large} 1 ${P(o1.arc)}A${f(ko)} ${f(ko)} 0 0 1 ${P(o1.line)}L${P(i1.line)}A${f(ki)} ${f(ki)} 0 0 1 ${P(i1.arc)}A${f(rIn)} ${f(rIn)} 0 ${large} 0 ${P(i0.arc)}A${f(ki)} ${f(ki)} 0 0 1 ${P(i0.line)}Z`;
}
export function labelAt(i, n, r) {
  return at(n === 1 ? Math.PI : (i * Math.PI * 2) / n, r);
}
// `prev` is the slice lit now. It keeps a little extra reach, past its sides and its edges, so a pointer resting on a
// border doesn't flip the highlight back and forth (the hysteresis of PhotoCraft's move_mods.rs `constrain`).
export function hitIndex(x, y, n, rIn, rOut, prev = -1) {
  const d = Math.hypot(x, y), held = prev >= 0 && prev < n;
  const inside = d >= rIn - 2 && d <= rOut + 10;
  if (!n || (!inside && !(held && d >= rIn - 10 && d <= rOut + 18))) return -1;
  if (n === 1) return 0;
  const step = (Math.PI * 2) / n;
  let a = Math.atan2(x, -y);
  if (a < 0) a += Math.PI * 2;
  const k = Math.round(a / step) % n;
  if (held && k !== prev) {
    let off = Math.abs(a - prev * step) % (Math.PI * 2);
    off = Math.min(off, Math.PI * 2 - off);
    if (off < step / 2 + Math.min(step * 0.15, (8 * Math.PI) / 180)) return prev;
  }
  return inside || k === prev ? k : -1;
}
export function arc(r, frac) {
  const a = Math.min(0.9999, Math.max(0, frac)) * Math.PI * 2;
  const [x, y] = at(a, r);
  return `M0 ${-r}A${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${f(x)} ${f(y)}`;
}
// The lime photo, downsampled ahead of time for each screen density so it stays sharp (sizes 52 and 96 exist).
// The wheel is scaled as a whole for its Small and Large sizes, so `scale` makes the browser pick
// a bitmap for the size the logo really appears at instead of stretching one made for 1x.
let custom = null;
export const setIcon = (url) => { custom = url || null; };
export function limeSvg(size = 52, cls = '', scale = 1) {
  if (custom) return `<img class="lime custom${cls ? ` ${cls}` : ''}" src="${custom}" width="${size}" height="${size}" alt="" draggable="false">`;
  const f = (k) => `assets/lime-${size}${k > 1 ? `@${k}x` : ''}.png`;
  return `<img class="lime${cls ? ` ${cls}` : ''}" src="${f(1)}" srcset="${[1, 2, 3, 4].map((k) => `${f(k)} ${size * k}w`).join(', ')}" sizes="${Math.ceil(size * scale)}px" width="${size}" height="${size}" alt="" draggable="false">`;
}
