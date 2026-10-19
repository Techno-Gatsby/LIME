const f = (n) => (Math.round(n * 100) / 100).toString();
const at = (a, r) => [r * Math.sin(a), -r * Math.cos(a)];
const ang = ([x, y]) => Math.atan2(x, -y);
const P = (p) => `${f(p[0])} ${f(p[1])}`;

export function petal(i, n, rIn, rOut, gap = 4, cOut = rOut * 0.065, cIn = rIn * 0.05) {
  if (n === 1) return `M0 ${-rOut}A${rOut} ${rOut} 0 1 1 0 ${rOut}A${rOut} ${rOut} 0 1 1 0 ${-rOut}ZM0 ${-rIn}A${rIn} ${rIn} 0 1 0 0 ${rIn}A${rIn} ${rIn} 0 1 0 0 ${-rIn}Z`;
  const step = (Math.PI * 2) / n;
  const a0 = i * step - step / 2, a1 = i * step + step / 2;
  const g = gap / 2;
  const side = (a, s, r) => { const t = Math.sqrt(Math.max(0, r * r - g * g)); return [s * g * Math.cos(a) + t * Math.sin(a), s * g * Math.sin(a) - t * Math.cos(a)]; };
  const along = (a, s, t) => [s * g * Math.cos(a) + t * Math.sin(a), s * g * Math.sin(a) - t * Math.cos(a)];
  const tO = Math.sqrt(rOut * rOut - g * g), tI = Math.sqrt(rIn * rIn - g * g);
  const mid = i * step;
  const rel = (p) => { let a = ang(p) - mid; while (a > Math.PI) a -= Math.PI * 2; while (a <= -Math.PI) a += Math.PI * 2; return a; };
  const O0 = side(a0, 1, rOut), O1 = side(a1, -1, rOut), I0 = side(a0, 1, rIn), I1 = side(a1, -1, rIn);
  const span = rel(O1) - rel(O0);
  const co = Math.min(cOut, (tO - tI) * 0.45, span * rOut * 0.3), ci = Math.min(cIn, (tO - tI) * 0.2, (rel(I1) - rel(I0)) * rIn * 0.3);
  const A = along(a0, 1, tI + ci), B = along(a0, 1, tO - co), C = at(mid + rel(O0) + co / rOut, rOut), D = at(mid + rel(O1) - co / rOut, rOut);
  const E = along(a1, -1, tO - co), F = along(a1, -1, tI + ci), G = at(mid + rel(I1) - ci / rIn, rIn), H = at(mid + rel(I0) + ci / rIn, rIn);
  const large = span - (2 * co) / rOut > Math.PI ? 1 : 0;
  return `M${P(A)}L${P(B)}Q${P(O0)} ${P(C)}A${f(rOut)} ${f(rOut)} 0 ${large} 1 ${P(D)}Q${P(O1)} ${P(E)}L${P(F)}Q${P(I1)} ${P(G)}A${f(rIn)} ${f(rIn)} 0 0 0 ${P(H)}Q${P(I0)} ${P(A)}Z`;
}
export function labelAt(i, n, r) {
  const a = n === 1 ? Math.PI : (i * Math.PI * 2) / n;
  return at(a, n === 1 ? (r) : r);
}
export function hitIndex(x, y, n, rIn, rOut) {
  const d = Math.hypot(x, y);
  if (!n || d < rIn - 2 || d > rOut + 10) return -1;
  if (n === 1) return 0;
  const step = (Math.PI * 2) / n;
  let a = Math.atan2(x, -y);
  if (a < 0) a += Math.PI * 2;
  return Math.round(a / step) % n;
}
export function arc(r, frac) {
  const a = Math.min(0.9999, Math.max(0, frac)) * Math.PI * 2;
  const [x, y] = at(a, r);
  return `M0 ${-r}A${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${f(x)} ${f(y)}`;
}
export function limeSvg(size = 64, id = 'lm') {
  const segs = Array.from({ length: 10 }, (_, i) => `<path d="${petal(i, 10, 7, 47.5, 3.2, 7, 1.5)}"/>`).join('');
  return `<svg viewBox="-64 -64 128 128" width="${size}" height="${size}" aria-hidden="true"><defs><linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fd04a"/><stop offset="1" stop-color="#3b8a1d"/></linearGradient><radialGradient id="${id}p" r=".6"><stop offset="0" stop-color="#eaf8b4"/><stop offset="1" stop-color="#a9d84f"/></radialGradient></defs><circle r="60" fill="url(#${id}r)"/><circle r="53.5" fill="#f5fbe3"/><g fill="url(#${id}p)">${segs}</g><circle r="3.6" fill="#f5fbe3"/></svg>`;
}
