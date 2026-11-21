// Pure canvas renderer for the TAPEZERO timeline. Used by the terminal, the landing replay and the film.
import { buildCandles, pickBucket, type Candle, type SwapSeries } from '../../core/series.ts';
import type { Gap, Swap } from '../../core/types.ts';
import type { PlayerState } from '../../core/player.ts';
import { C, FONT_MONO, alpha } from '../../core/theme.ts';
import { fmtPrice, fmtUsd } from '../../core/format.ts';

export const RULER_H = 26;
export const TRACK_H = 62;
export const GUTTER_R = 64;

export interface ChartOpts {
  t0: number; // reference for T+ labels (first observed swap)
  gaps: Gap[];
  isLive: boolean;
  usdPerSol: number | null; // for the FDV axis; null → price axis in SOL
  supply: number;
  dimIds?: Set<string> | null; // when a metric filter is active: ids to keep bright
  ghosts?: { t: number; a: number }[];
  compact?: boolean;
  hoverX?: number | null;
  hoverY?: number | null;
}

export interface ChartLayout {
  w: number;
  h: number;
  plotW: number;
  priceTop: number;
  priceBottom: number;
  trackTop: number;
  trackBottom: number;
  v0: number;
  v1: number;
  bucket: number;
  candles: Candle[];
  x: (t: number) => number;
  t: (x: number) => number;
  yMin: number;
  yMax: number;
}

const TICKS = [1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000];

export function layoutChart(series: SwapSeries, st: PlayerState, w: number, h: number, opts: ChartOpts): ChartLayout {
  const plotW = Math.max(10, w - GUTTER_R);
  const [v0, v1] = st.viewport;
  const x = (t: number) => ((t - v0) / (v1 - v0)) * plotW;
  const t = (px: number) => v0 + (px / plotW) * (v1 - v0);
  const trackH = opts.compact ? 46 : TRACK_H;
  const priceTop = RULER_H + 10;
  const trackBottom = h - 6;
  const trackTop = trackBottom - trackH;
  const priceBottom = trackTop - 10;
  const bucket = st.bucket ?? pickBucket(v1 - v0, opts.compact ? 48 : Math.max(30, Math.min(90, plotW / 12)));
  const upTo = st.blind ? st.playhead : Infinity;
  const candles = buildCandles(series, v0, Math.min(v1, series.liveEdge + bucket), bucket, upTo);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const c of candles) {
    if (c.low < yMin) yMin = c.low;
    if (c.high > yMax) yMax = c.high;
  }
  if (!isFinite(yMin)) {
    const p = series.last?.priceSol ?? 1e-8;
    yMin = p * 0.9;
    yMax = p * 1.1;
  }
  const pad = (yMax - yMin) * 0.12 || yMax * 0.05;
  // volume lives in the bottom 18% of the price pane: give the candles room above it
  const lo = st.yRange ? st.yRange[0] : yMin - pad - (yMax - yMin + 2 * pad) * 0.22;
  const hi = st.yRange ? st.yRange[1] : yMax + pad;
  return { w, h, plotW, priceTop, priceBottom, trackTop, trackBottom, v0, v1, bucket, candles, x, t, yMin: lo, yMax: hi };
}

export function drawChart(ctx: CanvasRenderingContext2D, series: SwapSeries, st: PlayerState, L: ChartLayout, opts: ChartOpts) {
  const { w, h, plotW, priceTop, priceBottom, trackTop, trackBottom, x } = L;
  const y = (p: number) => priceBottom - ((p - L.yMin) / (L.yMax - L.yMin)) * (priceBottom - priceTop);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.chart;
  ctx.fillRect(0, 0, w, h);

  // technical grid — sober, behind the data
  const span = L.v1 - L.v0;
  const maxTicks = Math.max(3, Math.min(opts.compact ? 6 : 10, Math.floor(plotW / 78)));
  const tick = TICKS.find((k) => span / k <= maxTicks) ?? TICKS[TICKS.length - 1];
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const firstTick = Math.ceil((L.v0 - opts.t0) / tick) * tick + opts.t0;
  for (let t = firstTick; t <= L.v1; t += tick) {
    const px = Math.round(x(t)) + 0.5;
    ctx.moveTo(px, RULER_H);
    ctx.lineTo(px, trackBottom);
  }
  for (let i = 0; i <= 4; i++) {
    const py = Math.round(priceTop + ((priceBottom - priceTop) * i) / 4) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(plotW, py);
  }
  ctx.stroke();
  // ruler + track separators
  ctx.strokeStyle = C.divider;
  ctx.beginPath();
  ctx.moveTo(0, RULER_H + 0.5);
  ctx.lineTo(w, RULER_H + 0.5);
  ctx.moveTo(0, trackTop - 4.5);
  ctx.lineTo(plotW, trackTop - 4.5);
  ctx.moveTo(plotW + 0.5, RULER_H);
  ctx.lineTo(plotW + 0.5, h);
  ctx.stroke();

  // ruler labels (whole seconds — no invented precision)
  ctx.font = `12px ${FONT_MONO}`;
  ctx.fillStyle = C.text2;
  ctx.textBaseline = 'middle';
  for (let t = firstTick; t <= L.v1; t += tick) {
    const px = x(t);
    const rel = Math.round((t - opts.t0) / 1000);
    void rel;
    // wall-clock (UTC) labels: seconds while zoomed in, minutes otherwise
    const lab = new Date(t).toISOString().slice(11, tick < 60000 ? 19 : 16);
    ctx.fillText(lab, px + 4, RULER_H / 2);
    ctx.fillRect(Math.round(px), RULER_H - 6, 1, 6);
  }

  // gaps: hatched, explicitly labelled
  for (const g of opts.gaps) {
    const a = x(g.fromTime * 1000);
    const b = x(g.toTime * 1000 + 999);
    if (b < 0 || a > plotW) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(a, RULER_H + 1, b - a, trackBottom - RULER_H);
    ctx.clip();
    ctx.fillStyle = alpha(C.bg, 0.55);
    ctx.fillRect(a, RULER_H, b - a, h);
    ctx.strokeStyle = alpha(C.text2, 0.18);
    ctx.beginPath();
    for (let k = a - h; k < b; k += 7) {
      ctx.moveTo(k, trackBottom);
      ctx.lineTo(k + h, RULER_H);
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = C.text2;
    ctx.font = `10px ${FONT_MONO}`;
    ctx.fillText('NO DATA', Math.max(a, 0) + 6, priceTop + 10);
  }

  // selection — discreet peach veil with precise handles
  if (st.selection) {
    const a = x(st.selection[0]);
    const b = x(st.selection[1]);
    ctx.fillStyle = alpha(C.peach, 0.09);
    ctx.fillRect(a, RULER_H + 1, Math.max(1, b - a), trackBottom - RULER_H);
    ctx.fillStyle = C.peach;
    for (const px of [a, b]) {
      ctx.fillRect(Math.round(px) - 0.5, RULER_H + 1, 1, trackBottom - RULER_H);
      roundRect(ctx, Math.round(px) - 3, priceTop + (priceBottom - priceTop) / 2 - 10, 6, 20, 3);
      ctx.fill();
    }
  }

  // volume — buys over sells, bottom of the price pane
  {
    let vmax = 0;
    for (const c of L.candles) vmax = Math.max(vmax, c.buySol + c.sellSol);
    if (vmax > 0) {
      const volH = (priceBottom - priceTop) * 0.18;
      const vw = Math.max(1.5, Math.min(18, ((L.bucket / (L.v1 - L.v0)) * plotW) * 0.62));
      for (const c of L.candles) {
        if (!c.count) continue;
        const cx = x(c.t0 + L.bucket / 2);
        const hb = (c.buySol / vmax) * volH;
        const hs = (c.sellSol / vmax) * volH;
        ctx.fillStyle = alpha(C.buy, 0.28);
        ctx.fillRect(cx - vw / 2, priceBottom - hb, vw, hb);
        ctx.fillStyle = alpha(C.sell, 0.28);
        ctx.fillRect(cx - vw / 2, priceBottom - hb - hs, vw, hs);
      }
    }
  }

  // candles — up: filled; down: hollow (shape, not only colour)
  const cw = Math.max(1.5, Math.min(18, ((L.bucket / (L.v1 - L.v0)) * plotW) * 0.62));
  const future = (t: number) => t > st.playhead + 1 && !st.following;
  for (const c of L.candles) {
    if (!c.count && c.i1 < c.i0) {
      // empty bucket: a thin flat tick at the carried price
      const cx = x(c.t0 + L.bucket / 2);
      ctx.fillStyle = alpha(C.text2, 0.25);
      ctx.fillRect(cx - cw / 2, y(c.close), cw, 1);
      continue;
    }
    const cx = x(c.t0 + L.bucket / 2);
    const up = c.close >= c.open;
    const col = up ? C.buy : C.sell;
    const dim = future(c.t0) ? 0.3 : 1;
    ctx.globalAlpha = dim;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx) + 0.5, y(c.high));
    ctx.lineTo(Math.round(cx) + 0.5, y(c.low));
    ctx.stroke();
    const top = y(Math.max(c.open, c.close));
    const bh = Math.max(1, y(Math.min(c.open, c.close)) - top);
    if (up) ctx.fillRect(cx - cw / 2, top, cw, bh);
    else {
      ctx.fillStyle = C.chart;
      ctx.fillRect(cx - cw / 2, top, cw, bh);
      ctx.strokeRect(cx - cw / 2 + 0.5, top + 0.5, cw - 1, Math.max(0, bh - 1));
    }
    ctx.globalAlpha = 1;
  }

  // swap track: ▲ buys above the midline (filled), ▼ sells below (hollow); size ∝ √SOL
  const mid = (trackTop + trackBottom) / 2;
  const i0 = Math.max(0, series.indexAt(L.v0) - 1);
  const i1 = st.blind ? series.indexAt(Math.min(L.v1, st.playhead)) : series.indexAt(L.v1);
  const many = i1 - i0 > plotW * 1.5;
  ctx.strokeStyle = alpha(C.text2, 0.25);
  ctx.beginPath();
  ctx.moveTo(0, Math.round(mid) + 0.5);
  ctx.lineTo(plotW, Math.round(mid) + 0.5);
  ctx.stroke();
  let hi: Swap | null = null;
  for (let i = Math.max(0, i0); i <= i1; i++) {
    const s = series.swaps[i];
    if (!s) continue;
    const px = x(s.tl);
    if (px < -10 || px > plotW + 10) continue;
    if (s.id === st.highlight) hi = s;
    const keep = !opts.dimIds || opts.dimIds.has(s.id);
    let a = keep ? 1 : 0.16;
    if (future(s.tl)) a *= 0.35;
    const r = many ? 1.6 : Math.min(opts.compact ? 7 : 9, 2.4 + Math.sqrt(s.sol) * 3);
    ctx.globalAlpha = a;
    if (s.side === 'buy') {
      ctx.fillStyle = C.buy;
      tri(ctx, px, mid - 4 - r, r, 1);
      ctx.fill();
    } else {
      ctx.strokeStyle = C.sell;
      ctx.lineWidth = 1.4;
      tri(ctx, px, mid + 4 + r, r, -1);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.text2;
  ctx.font = `10px ${FONT_MONO}`;
  ctx.fillText('▲ BUY', plotW + 8, trackTop + 12);
  ctx.fillText('▼ SELL', plotW + 8, trackBottom - 10);

  // price line pass-through dots for the highlighted swap
  if (hi) {
    const px = x(hi.tl);
    ctx.strokeStyle = alpha(C.peach, 0.6);
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(px, RULER_H);
    ctx.lineTo(px, trackBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, hi.side === 'buy' ? mid - 10 : mid + 10, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, y(hi.priceSol), 4, 0, Math.PI * 2);
    ctx.fillStyle = C.accent;
    ctx.fill();
  }

  // price axis (FDV when a dated SOL/USD reference exists, else SOL price)
  ctx.fillStyle = C.text2;
  ctx.font = `11.5px ${FONT_MONO}`;
  for (let i = 0; i <= 4; i++) {
    const p = L.yMax - ((L.yMax - L.yMin) * i) / 4;
    const py = priceTop + ((priceBottom - priceTop) * i) / 4;
    const lab = opts.usdPerSol && st.yMode === 'mcap' ? fmtUsd(p * opts.supply * opts.usdPerSol) : fmtPrice(p);
    ctx.fillText(lab, plotW + 8, py);
  }
  ctx.fillStyle = alpha(C.text2, 0.7);
  ctx.fillText(opts.usdPerSol && st.yMode === 'mcap' ? 'MCap' : 'SOL/tok', plotW + 8, priceTop - 6);
  if (st.yRange) {
    ctx.fillStyle = C.peach;
    ctx.fillText('manual', plotW + 8, priceBottom + 4);
  }

  // live edge marker — dashed cream + LIVE tag, distinct from the playhead
  if (opts.isLive) {
    const lx = x(series.liveEdge);
    if (lx >= -2 && lx <= plotW + 2) {
      ctx.strokeStyle = alpha(C.text, 0.55);
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(lx) + 0.5, RULER_H);
      ctx.lineTo(Math.round(lx) + 0.5, trackBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!st.following) {
        ctx.font = `600 9px ${FONT_MONO}`;
        const tw = ctx.measureText('LIVE').width + 10;
        ctx.fillStyle = C.text;
        roundRect(ctx, Math.min(lx - tw / 2, plotW - tw), RULER_H + 4, tw, 14, 7);
        ctx.fill();
        ctx.fillStyle = C.bg;
        ctx.fillText('LIVE', Math.min(lx - tw / 2, plotW - tw) + 5, RULER_H + 11.5);
      }
    }
  }

  // rewind ghosts — two brief echoes of the playhead (the doubled edge of the zero)
  for (const g of opts.ghosts ?? []) {
    const gx = x(g.t);
    ctx.fillStyle = alpha(C.accent, 0.35 * g.a);
    ctx.fillRect(gx - 1, 0, 2, trackBottom);
    ctx.fillStyle = alpha(C.peach, 0.12 * g.a);
    ctx.fillRect(gx - 5, RULER_H, 10, trackBottom - RULER_H);
  }

  // playhead — coral, full height, handle in the ruler
  const px = x(st.playhead);
  if (px >= -4 && px <= plotW + 4) {
    const glow = ctx.createLinearGradient(px - 14, 0, px + 14, 0);
    glow.addColorStop(0, alpha(C.accent, 0));
    glow.addColorStop(0.5, alpha(C.accent, 0.16));
    glow.addColorStop(1, alpha(C.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(px - 14, RULER_H, 28, trackBottom - RULER_H);
    ctx.fillStyle = C.accent;
    ctx.fillRect(Math.round(px) - 1, 2, 2, trackBottom - 2);
    ctx.beginPath();
    ctx.moveTo(px - 7, 2);
    ctx.lineTo(px + 7, 2);
    ctx.lineTo(px + 7, 12);
    ctx.lineTo(px, 19);
    ctx.lineTo(px - 7, 12);
    ctx.closePath();
    ctx.fill();
    const p = series.priceAt(st.playhead);
    if (p != null) {
      ctx.beginPath();
      ctx.arc(px, y(p), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = C.text;
      ctx.fill();
    }
  }

  // crosshair + legend of the hovered candle (like a trading terminal)
  if (opts.hoverX != null && opts.hoverX >= 0 && opts.hoverX <= plotW) {
    const hx = Math.round(opts.hoverX) + 0.5;
    ctx.strokeStyle = alpha(C.text, 0.28);
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(hx, RULER_H);
    ctx.lineTo(hx, trackBottom);
    const hy = opts.hoverY;
    if (hy != null && hy >= priceTop && hy <= priceBottom) {
      ctx.moveTo(0, Math.round(hy) + 0.5);
      ctx.lineTo(plotW, Math.round(hy) + 0.5);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 11px ${FONT_MONO}`;
    // time tag on the ruler
    const tt = new Date(L.t(opts.hoverX)).toISOString().slice(11, 19);
    const tw = ctx.measureText(tt).width + 12;
    ctx.fillStyle = C.text;
    roundRect(ctx, Math.min(Math.max(0, hx - tw / 2), plotW - tw), 4, tw, 17, 4);
    ctx.fill();
    ctx.fillStyle = C.bg;
    ctx.fillText(tt, Math.min(Math.max(0, hx - tw / 2), plotW - tw) + 6, 13);
    // value tag on the axis
    if (hy != null && hy >= priceTop && hy <= priceBottom) {
      const pv = L.yMax - ((hy - priceTop) / (priceBottom - priceTop)) * (L.yMax - L.yMin);
      const lab = opts.usdPerSol && st.yMode === 'mcap' ? fmtUsd(pv * opts.supply * opts.usdPerSol) : fmtPrice(pv);
      ctx.fillStyle = C.text;
      roundRect(ctx, plotW + 2, hy - 9, GUTTER_R - 4, 18, 4);
      ctx.fill();
      ctx.fillStyle = C.bg;
      ctx.fillText(lab, plotW + 7, hy + 0.5);
    }
    // legend
    const c = L.candles.find((k) => k.t0 <= L.t(opts.hoverX!) && L.t(opts.hoverX!) < k.t1);
    if (c) {
      const fmt = (p: number) => (opts.usdPerSol && st.yMode === 'mcap' ? fmtUsd(p * opts.supply * opts.usdPerSol) : fmtPrice(p));
      const chg = c.open ? ((c.close / c.open - 1) * 100).toFixed(2) : '0';
      const usd = (sol: number) => (opts.usdPerSol ? fmtUsd(sol * opts.usdPerSol) : sol.toFixed(2) + ' SOL');
      const parts: [string, string][] = [
        ['O', fmt(c.open)],
        ['H', fmt(c.high)],
        ['L', fmt(c.low)],
        ['C', fmt(c.close)],
        ['', (Number(chg) >= 0 ? '+' : '') + chg + '%'],
        ['Vol', usd(c.buySol + c.sellSol)],
        ['', c.count + ' trades'],
      ];
      let lx = 8;
      const ly = RULER_H + 14;
      ctx.font = `500 11.5px ${FONT_MONO}`;
      for (const [k, v] of parts) {
        if (k) {
          ctx.fillStyle = C.text2;
          ctx.fillText(k, lx, ly);
          lx += ctx.measureText(k).width + 4;
        }
        ctx.fillStyle = k === '' && v.endsWith('%') ? (Number(chg) >= 0 ? C.buy : C.sell) : C.text;
        ctx.fillText(v, lx, ly);
        lx += ctx.measureText(v).width + 12;
      }
    }
  }
}

function tri(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, dir: 1 | -1) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * dir);
  ctx.lineTo(cx + r * 0.95, cy + r * 0.7 * dir);
  ctx.lineTo(cx - r * 0.95, cy + r * 0.7 * dir);
  ctx.closePath();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Hit-test the swap track. */
export function hitSwap(series: SwapSeries, L: ChartLayout, st: PlayerState, px: number, py: number): Swap | null {
  if (py < L.trackTop - 6 || py > L.trackBottom + 2) return null;
  const t = L.t(px);
  const tol = ((L.v1 - L.v0) / L.plotW) * 9;
  const a = series.range(t - tol, t + tol).filter((s) => !st.blind || s.tl <= st.playhead);
  let best: Swap | null = null;
  let bd = Infinity;
  for (const s of a) {
    const d = Math.abs(L.x(s.tl) - px);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}
