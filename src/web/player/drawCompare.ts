import type { CompareSide } from '../../core/metrics.ts';
import { C, FONT_MONO, alpha } from '../../core/theme.ts';

export const SERIES_STYLE = [
  { color: C.peach, dash: [] as number[], label: 'A' },
  { color: C.text2, dash: [6, 4], label: 'B' },
];

/** Overlay of normalized price change since the first observed swap, plus one buy-size track per launch. */
export function drawCompare(ctx: CanvasRenderingContext2D, w: number, h: number, sides: (CompareSide | null)[], windowMs: number, dt: number, names: string[]) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.chart;
  ctx.fillRect(0, 0, w, h);
  const left = 8;
  const right = w - 70;
  const top = 18;
  const tracksH = 44 * sides.length;
  const bottom = h - tracksH - 26;
  const x = (d: number) => left + (Math.max(0, Math.min(windowMs, d)) / windowMs) * (right - left);
  let vMax = 0.1;
  let vMin = 0;
  for (const s of sides) for (const p of s?.normalized ?? []) {
    if (p.v > vMax) vMax = p.v;
    if (p.v < vMin) vMin = p.v;
  }
  vMax *= 1.1;
  const y = (v: number) => bottom - ((v - vMin) / (vMax - vMin)) * (bottom - top);
  // grid
  ctx.strokeStyle = C.grid;
  ctx.beginPath();
  const tick = windowMs <= 30000 ? 5000 : windowMs <= 60000 ? 10000 : 60000;
  ctx.font = `10px ${FONT_MONO}`;
  ctx.fillStyle = C.text2;
  ctx.textBaseline = 'middle';
  for (let t = 0; t <= windowMs; t += tick) {
    ctx.moveTo(Math.round(x(t)) + 0.5, top);
    ctx.lineTo(Math.round(x(t)) + 0.5, h - 18);
    ctx.fillText(`+${t / 1000}s`, x(t) + 3, h - 9);
  }
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = vMin + ((vMax - vMin) * i) / steps;
    ctx.moveTo(left, Math.round(y(v)) + 0.5);
    ctx.lineTo(right, Math.round(y(v)) + 0.5);
    ctx.fillText(`${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`, right + 6, y(v));
  }
  ctx.stroke();
  ctx.strokeStyle = alpha(C.text, 0.3);
  ctx.beginPath();
  ctx.moveTo(left, Math.round(y(0)) + 0.5);
  ctx.lineTo(right, Math.round(y(0)) + 0.5);
  ctx.stroke();

  sides.forEach((s, i) => {
    if (!s) return;
    const st = SERIES_STYLE[i];
    // missing data
    for (const g of s.gaps) {
      ctx.fillStyle = alpha(C.text2, 0.12);
      ctx.fillRect(x(g.fromDt), top, Math.max(2, x(g.toDt) - x(g.fromDt)), bottom - top);
      ctx.fillStyle = C.text2;
      ctx.fillText(`${st.label}: NO DATA`, x(g.fromDt) + 4, top + 10 + i * 12);
    }
    ctx.strokeStyle = st.color;
    ctx.setLineDash(st.dash);
    ctx.lineWidth = 2;
    ctx.beginPath();
    let lastY = y(0);
    ctx.moveTo(x(0), y(0));
    for (const p of s.normalized) {
      if (p.dt > windowMs) break;
      ctx.lineTo(x(p.dt), lastY); // step: price holds until the next swap
      lastY = y(p.v);
      ctx.lineTo(x(p.dt), lastY);
    }
    ctx.lineTo(x(Math.min(windowMs, Math.max(dt, 0))), lastY);
    ctx.stroke();
    ctx.setLineDash([]);
    if (s.peakDt != null && s.peakChange != null) {
      ctx.fillStyle = st.color;
      ctx.beginPath();
      ctx.arc(x(s.peakDt), y(s.peakChange), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(`${st.label} peak`, x(s.peakDt) + 7, y(s.peakChange) + (i === 0 ? -8 : 12));
    }
    // buy-size track
    const ty = bottom + 18 + i * 44;
    ctx.fillStyle = C.text2;
    ctx.fillText(`${st.label} · ${names[i] ?? ''}`.slice(0, 40), left, ty - 2);
    ctx.strokeStyle = alpha(C.text2, 0.25);
    ctx.beginPath();
    ctx.moveTo(left, ty + 22.5);
    ctx.lineTo(right, ty + 22.5);
    ctx.stroke();
    for (const sw of s.swaps) {
      const d = sw.tl - s.t0;
      if (d > windowMs) break;
      const r = Math.min(16, 1.5 + Math.sqrt(sw.sol) * 2.6);
      if (sw.side === 'buy') {
        ctx.fillStyle = alpha(C.buy, d <= dt ? 0.85 : 0.3);
        ctx.fillRect(x(d) - 1.5, ty + 22 - r * 1.2, 3, r * 1.2);
      } else {
        ctx.strokeStyle = alpha(C.sell, d <= dt ? 0.9 : 0.3);
        ctx.strokeRect(x(d) - 1.5, ty + 23, 3, Math.min(14, r * 0.8));
      }
    }
  });
  // synced playhead
  const px = x(dt);
  ctx.fillStyle = C.accent;
  ctx.fillRect(Math.round(px) - 1, top - 10, 2, h - top - 8);
}
