import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { PlayerController } from '../../core/player.ts';
import type { Gap } from '../../core/types.ts';
import { drawChart, hitSwap, layoutChart, RULER_H, type ChartLayout, type ChartOpts } from './drawChart.ts';
import { C, alpha } from '../../core/theme.ts';
import { prefersReducedMotion } from '../util.ts';

export function useCtrl(ctrl: PlayerController) {
  useSyncExternalStore(
    (f) => ctrl.subscribe(f),
    () => ctrl.version,
  );
  return ctrl.s;
}

interface Props {
  ctrl: PlayerController;
  t0: number;
  gaps: Gap[];
  isLive: boolean;
  usdPerSol: number | null;
  supply: number;
  dimIds?: Set<string> | null;
  compact?: boolean;
  label: string;
  /** Film: draw synchronously on every render, no interaction, explicit ghosts. */
  staticGhosts?: { t: number; a: number }[];
  onCandle?: (a: number, b: number) => void;
  /** Film: fixed pixel size, no ResizeObserver. */
  fixed?: { w: number; h: number };
}

export function Chart(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const L = useRef<ChartLayout | null>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const drag = useRef<{ mode: 'seek' | 'select' | 'pan' | 'pending' | 'pending-select' | 'yscale'; x0: number; y0: number; t0: number; v?: [number, number]; y?: [number, number] } | null>(null);
  const hover = useRef<number | null>(null);
  const hoverY = useRef<number | null>(null);
  const ghosts = useRef<{ t: number; born: number }[]>([]);
  const prevPh = useRef<number | null>(null);
  const drawFlag = useRef(false);
  const propsRef = useRef(p);
  propsRef.current = p;
  const reduced = prefersReducedMotion();

  const draw = (now = performance.now()) => {
    const c = cv.current;
    if (!c) return;
    const { w, h, dpr } = size.current;
    if (!w || !h) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pr = propsRef.current;
    const st = pr.ctrl.s;
    // ghosts on backward jumps
    if (prevPh.current != null && st.playhead < prevPh.current - 300 && !reduced && !pr.staticGhosts) {
      const from = prevPh.current;
      ghosts.current = [
        { t: from, born: now },
        { t: (from + st.playhead) / 2, born: now + 40 },
      ];
    }
    prevPh.current = st.playhead;
    const LIFE = 300;
    ghosts.current = ghosts.current.filter((g) => now - g.born < LIFE);
    const gs = pr.staticGhosts ?? ghosts.current.map((g) => ({ t: g.t, a: Math.max(0, Math.min(1, 1 - (now - g.born) / LIFE)) }));
    const opts: ChartOpts = { t0: pr.t0, gaps: pr.gaps, isLive: pr.isLive, usdPerSol: pr.usdPerSol, supply: pr.supply, dimIds: pr.dimIds, ghosts: gs, compact: pr.compact, hoverX: hover.current, hoverY: hoverY.current };
    const lay = layoutChart(pr.ctrl.series, st, w, h, opts);
    L.current = lay;
    drawChart(ctx, pr.ctrl.series, st, lay, opts);
  };

  // size
  useLayoutEffect(() => {
    const el = wrap.current!;
    if (propsRef.current.fixed) {
      const { w, h } = propsRef.current.fixed;
      size.current = { w, h, dpr: 1 };
      cv.current!.width = w;
      cv.current!.height = h;
      draw();
      return;
    }
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: r.width, h: r.height, dpr };
      const c = cv.current!;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      draw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // redraw loop (only when something changed)
  useEffect(() => {
    if (p.staticGhosts) return;
    let raf = 0;
    let lastV = -1;
    let lastS = -1;
    const loop = (now: number) => {
      const pr = propsRef.current;
      const v = pr.ctrl.version;
      const sv = pr.ctrl.series.version;
      if (v !== lastV || sv !== lastS || ghosts.current.length || (drawFlag.current && (drawFlag.current = false, true))) {
        lastV = v;
        lastS = sv;
        draw(now);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    drawFlag.current = true;
  });
  // film: draw synchronously on every render
  useLayoutEffect(() => {
    if (propsRef.current.staticGhosts) draw();
  });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /*
   * Navigation like a trading terminal:
   *   drag = move (time, and price when the scale is manual) · wheel = zoom around the cursor
   *   drag on the price axis = stretch the price scale · double-click axis = auto scale · double-click chart = fit
   *   Shift+drag = select a time range · click a candle = open it · drag the top ruler = move the playhead
   */
  const onDown = (e: React.PointerEvent) => {
    if (p.staticGhosts || !L.current) return;
    const { x, y } = local(e);
    const lay = L.current;
    (e.target as Element).setPointerCapture(e.pointerId);
    const t = lay.t(Math.min(x, lay.plotW));
    if (x > lay.plotW) drag.current = { mode: 'yscale', x0: x, y0: y, t0: t, y: [lay.yMin, lay.yMax] };
    else if (y <= RULER_H + 2) {
      drag.current = { mode: 'seek', x0: x, y0: y, t0: t };
      p.ctrl.seek(t, true);
    } else if (e.shiftKey) drag.current = { mode: 'pending-select', x0: x, y0: y, t0: t };
    else drag.current = { mode: 'pending', x0: x, y0: y, t0: t, v: p.ctrl.s.viewport, y: [lay.yMin, lay.yMax] };
  };
  const onMove = (e: React.PointerEvent) => {
    if (p.staticGhosts) return;
    const { x, y } = local(e);
    hover.current = x;
    hoverY.current = y;
    drawFlag.current = true;
    const d = drag.current;
    const lay = L.current;
    if (!d || !lay) return;
    const t = lay.t(x);
    if (d.mode === 'seek') p.ctrl.seek(t, true);
    else if (d.mode === 'yscale' && d.y) {
      // drag down = squeeze (zoom out), up = stretch, around the middle of the range
      const k = Math.exp((y - d.y0) / 180);
      const mid = (d.y[0] + d.y[1]) / 2;
      const half = ((d.y[1] - d.y[0]) / 2) * k;
      p.ctrl.set({ yRange: [mid - half, mid + half] });
    } else if (d.mode === 'pending' && Math.hypot(x - d.x0, y - d.y0) > 3) d.mode = 'pan';
    else if (d.mode === 'pending-select' && Math.abs(x - d.x0) > 4) {
      d.mode = 'select';
      p.ctrl.select(d.t0, t);
    } else if (d.mode === 'select') p.ctrl.select(d.t0, t);
    if (d.mode === 'pan' && d.v && d.y) {
      const dt = ((x - d.x0) / lay.plotW) * (d.v[1] - d.v[0]);
      const patch: Partial<typeof p.ctrl.s> = { viewport: [d.v[0] - dt, d.v[1] - dt], following: false };
      if (p.ctrl.s.yRange) {
        const dp = ((y - d.y0) / (lay.priceBottom - lay.priceTop)) * (d.y[1] - d.y[0]);
        patch.yRange = [d.y[0] + dp, d.y[1] + dp];
      }
      p.ctrl.set(patch);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const lay = L.current;
    if (!d || !lay) return;
    if (d.mode !== 'pending' && d.mode !== 'pending-select') return;
    const { x, y } = local(e);
    const sw = hitSwap(p.ctrl.series, lay, p.ctrl.s, x, y);
    if (sw) {
      p.ctrl.highlightSwap(sw.id);
      return;
    }
    // Open the candle under the pointer
    const t = lay.t(x);
    const b0 = Math.floor(t / lay.bucket) * lay.bucket;
    const c = lay.candles.find((k) => k.t0 === b0);
    if (c && c.count) {
      p.ctrl.select(c.t0, c.t1 - 1);
      p.onCandle?.(c.t0, c.t1 - 1);
    } else p.ctrl.seek(t, true);
  };
  const onDouble = (e: React.MouseEvent) => {
    if (p.staticGhosts || !L.current) return;
    const { x } = local(e);
    if (x > L.current.plotW) p.ctrl.set({ yRange: null });
    else p.ctrl.fit();
  };
  const onWheel = (e: React.WheelEvent) => {
    if (p.staticGhosts || !L.current) return;
    const lay = L.current;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      p.ctrl.pan((e.deltaX / lay.plotW) * (lay.v1 - lay.v0));
      return;
    }
    if (!e.ctrlKey && !e.altKey && p.compact) return; // the homepage keeps normal page scrolling
    const { x } = local(e);
    p.ctrl.zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.ctrl.s.following ? undefined : lay.t(Math.min(x, lay.plotW)));
  };

  // non-passive wheel to prevent page zoom when zooming the chart
  useEffect(() => {
    const el = cv.current!;
    const h = (e: WheelEvent) => {
      if (!propsRef.current.compact || e.ctrlKey || e.altKey) e.preventDefault();
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  return (
    <div ref={wrap} className="chart" style={{ background: C.chart, borderColor: alpha(C.divider, 1), ...(p.fixed ? { width: p.fixed.w, height: p.fixed.h, flex: 'none' } : null) }}>
      <canvas
        ref={cv}
        role="img"
        aria-label={p.label}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={onDouble}
        onPointerLeave={() => {
          hover.current = null;
          hoverY.current = null;
          drawFlag.current = true;
        }}
        onWheel={onWheel}
        style={{ touchAction: p.compact ? 'pan-y' : 'none', cursor: 'crosshair' }}
      />
    </div>
  );
}

/** Whole-launch overview strip with a draggable viewport window. */
export function Overview({ ctrl, gaps }: { ctrl: PlayerController; gaps: Gap[] }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const st = useCtrl(ctrl);
  const dragRef = useRef<{ off: number } | null>(null);
  const range = () => {
    const a = ctrl.series.start;
    const b = Math.max(ctrl.series.liveEdge, a + 10_000);
    const pad = (b - a) * 0.02;
    return [a - pad, b + pad] as const;
  };
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = r.width * dpr;
    c.height = r.height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width;
    const h = r.height;
    ctx.clearRect(0, 0, w, h);
    const [a, b] = range();
    const x = (t: number) => ((t - a) / (b - a)) * w;
    const sw = ctrl.series.swaps;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of sw) {
      if (s.priceSol < lo) lo = s.priceSol;
      if (s.priceSol > hi) hi = s.priceSol;
    }
    const y = (p: number) => h - 4 - ((p - lo) / (hi - lo || 1)) * (h - 8);
    for (const g of gaps) {
      ctx.fillStyle = alpha(C.text2, 0.15);
      ctx.fillRect(x(g.fromTime * 1000), 0, Math.max(2, x(g.toTime * 1000) - x(g.fromTime * 1000)), h);
    }
    ctx.strokeStyle = alpha(C.text2, 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(sw.length / (w * 1.5)));
    for (let i = 0; i < sw.length; i += step) {
      const s = sw[i];
      if (st.blind && s.tl > st.playhead) break;
      if (i === 0) ctx.moveTo(x(s.tl), y(s.priceSol));
      else ctx.lineTo(x(s.tl), y(s.priceSol));
    }
    ctx.stroke();
    if (st.selection) {
      ctx.fillStyle = alpha(C.peach, 0.25);
      ctx.fillRect(x(st.selection[0]), 0, Math.max(2, x(st.selection[1]) - x(st.selection[0])), h);
    }
    const [v0, v1] = st.viewport;
    ctx.strokeStyle = alpha(C.text, 0.5);
    ctx.strokeRect(x(v0) + 0.5, 0.5, Math.max(4, x(v1) - x(v0)) - 1, h - 1);
    ctx.fillStyle = alpha(C.text, 0.05);
    ctx.fillRect(x(v0), 0, x(v1) - x(v0), h);
    ctx.fillStyle = C.accent;
    ctx.fillRect(x(st.playhead) - 1, 0, 2, h);
  });
  const tAt = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect();
    const [a, b] = range();
    return a + ((e.clientX - r.left) / r.width) * (b - a);
  };
  return (
    <canvas
      ref={cv}
      className="overview"
      aria-label="Launch overview. Drag to move the visible window."
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        const t = tAt(e);
        const [v0, v1] = ctrl.s.viewport;
        if (t < v0 || t > v1) {
          const span = v1 - v0;
          ctrl.set({ viewport: [t - span / 2, t + span / 2], following: false });
          dragRef.current = { off: span / 2 };
        } else dragRef.current = { off: t - v0 };
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        const t = tAt(e);
        const [v0, v1] = ctrl.s.viewport;
        const span = v1 - v0;
        const n0 = t - dragRef.current.off;
        ctrl.set({ viewport: [n0, n0 + span], following: false });
      }}
      onPointerUp={() => (dragRef.current = null)}
    />
  );
}
