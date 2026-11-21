// Trading-terminal chart: TradingView Lightweight Charts (Apache-2.0) for candles, volume, pan/zoom, crosshair and
// price scale — the same feel as Axiom/GMGN — with TAPEZERO's layer on top: playhead, live edge, selected moment,
// click-a-candle to open it, highlighted trade.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type ISeriesMarkersPluginApi,
  type Time,
} from 'lightweight-charts';
import type { PlayerController } from '../../core/player.ts';
import { buildCandles, pickBucket, type Candle } from '../../core/series.ts';
import { C, FONT_MONO, alpha } from '../../core/theme.ts';
import { fmtPrice, fmtUsd } from '../../core/format.ts';
import { useCtrl } from './Chart.tsx';

interface Props {
  ctrl: PlayerController;
  isLive: boolean;
  usdPerSol: number | null;
  supply: number;
  height?: number;
  label: string;
  /** Homepage: the mouse wheel scrolls the page instead of zooming. */
  compact?: boolean;
}

const sec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

export function TVChart({ ctrl, isLive, usdPerSol, supply, height, label, compact }: Props) {
  const st = useCtrl(ctrl);
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleS = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volS = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const bucketRef = useRef(1000);
  const playheadEl = useRef<HTMLDivElement>(null);
  const liveEl = useRef<HTMLDivElement>(null);
  const selEl = useRef<HTMLDivElement>(null);
  const [legend, setLegend] = useState<Candle | null>(null);
  const useMcap = !!usdPerSol && st.yMode === 'mcap';
  const conv = (p: number) => (useMcap ? p * supply * usdPerSol! : p);

  // create once
  useLayoutEffect(() => {
    const c = createChart(host.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: C.chart }, textColor: C.text2, fontFamily: FONT_MONO, fontSize: 12, attributionLogo: false },
      grid: { vertLines: { color: alpha(C.grid, 0.9) }, horzLines: { color: alpha(C.grid, 0.9) } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: alpha(C.text, 0.35), labelBackgroundColor: C.divider }, horzLine: { color: alpha(C.text, 0.35), labelBackgroundColor: C.divider } },
      rightPriceScale: { borderColor: C.divider, scaleMargins: { top: 0.08, bottom: 0.24 }, minimumWidth: 64 },
      timeScale: { borderColor: C.divider, timeVisible: true, secondsVisible: true, rightOffset: 4, barSpacing: 9, minBarSpacing: 1 },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: !compact, pinch: true },
      handleScroll: { mouseWheel: !compact, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    const cs = c.addSeries(CandlestickSeries, {
      upColor: C.buy,
      downColor: alpha(C.sell, 0.15),
      borderUpColor: C.buy,
      borderDownColor: C.sell,
      wickUpColor: C.buy,
      wickDownColor: C.sell,
      priceLineColor: C.accent,
      priceLineStyle: LineStyle.Dashed,
    });
    const vs = c.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.current = c;
    candleS.current = cs;
    volS.current = vs;
    markers.current = createSeriesMarkers(cs, []);
    // click a candle → open it (the TAPEZERO move)
    c.subscribeClick((param) => {
      if (param.time == null) return;
      const t0 = (param.time as number) * 1000;
      const b = bucketRef.current;
      const k = candlesRef.current.find((x) => x.t0 === t0);
      if (k && k.count) {
        ctrl.select(k.t0, k.t1 - 1);
        ctrl.seek(k.t1 - 1, true);
      } else ctrl.seek(t0 + b - 1, true);
    });
    c.subscribeCrosshairMove((param) => {
      if (param.time == null) return setLegend(null);
      const t0 = (param.time as number) * 1000;
      setLegend(candlesRef.current.find((x) => x.t0 === t0) ?? null);
    });
    return () => {
      c.remove();
      chart.current = null;
    };
  }, []);

  // data: candles + volume from the trades, at the chosen candle size
  const bucket = st.bucket ?? defaultBucket(ctrl.series.liveEdge - ctrl.series.start);
  const sv = ctrl.series.version;
  useEffect(() => {
    const s = ctrl.series;
    if (!s.size || !candleS.current || !volS.current) return;
    bucketRef.current = bucket;
    const cs = buildCandles(s, s.start, s.liveEdge + bucket, bucket).filter((c) => c.count > 0);
    candlesRef.current = cs;
    candleS.current.applyOptions({
      priceFormat: { type: 'custom', minMove: useMcap ? 1 : 1e-12, formatter: (v: number) => (v < 0 ? '' : useMcap ? fmtUsd(v) : fmtPrice(v)) },
    });
    candleS.current.setData(cs.map((c) => ({ time: sec(c.t0), open: conv(c.open), high: conv(c.high), low: conv(c.low), close: conv(c.close) })));
    volS.current.setData(cs.map((c) => ({ time: sec(c.t0), value: (c.buySol + c.sellSol) * (usdPerSol ?? 1), color: alpha(c.buySol >= c.sellSol ? C.buy : C.sell, 0.45) })));
  }, [sv, bucket, useMcap, usdPerSol]);

  // first view, and "Fit"
  const fitNonce = st.yRange === null ? ctrl.s.viewport.join() : '';
  const fitted = useRef(false);
  useEffect(() => {
    if (!chart.current || !candlesRef.current.length) return;
    if (!fitted.current) {
      fitted.current = true;
      chart.current.timeScale().fitContent();
    }
  }, [sv, bucket]);
  useEffect(() => {
    // ctrl.fit(), stepping and replay move the viewport: mirror it (live following uses scrollToRealTime)
    const [v0, v1] = ctrl.s.viewport;
    if (!chart.current || !candlesRef.current.length || ctrl.s.following) return;
    try {
      chart.current.timeScale().setVisibleRange({ from: sec(v0), to: sec(v1) });
    } catch {
      /* range outside data */
    }
  }, [fitNonce]);

  // highlighted trade + the opened wallet's trades → markers
  useEffect(() => {
    if (!markers.current) return;
    const s = st.highlight ? ctrl.series.swaps.find((x) => x.id === st.highlight) : null;
    const b = bucketRef.current;
    const at = (x: { tl: number }) => sec(Math.floor(x.tl / b) * b);
    type M = Parameters<ISeriesMarkersPluginApi<Time>['setMarkers']>[0][number];
    const out: M[] = [];
    if (st.wallet) {
      const seen = new Set<string>();
      for (const x of ctrl.series.swaps) {
        if (x.wallet !== st.wallet || x.id === st.highlight) continue;
        const k = at(x) + x.side;
        if (seen.has(k)) continue; // one marker per candle and side
        seen.add(k);
        out.push({ time: at(x), position: x.side === 'buy' ? 'belowBar' : 'aboveBar', color: x.side === 'buy' ? C.buy : C.sell, shape: 'circle', text: x.side === 'buy' ? 'B' : 'S', size: 1 });
        if (out.length >= 200) break;
      }
    }
    if (s) out.push({ time: at(s), position: s.side === 'buy' ? 'belowBar' : 'aboveBar', color: C.accent, shape: s.side === 'buy' ? 'arrowUp' : 'arrowDown', text: s.side === 'buy' ? 'BUY' : 'SELL' });
    out.sort((p, q) => (p.time as number) - (q.time as number));
    markers.current.setMarkers(out);
  }, [st.highlight, st.wallet, bucket, sv]);

  // TAPEZERO layer: playhead, live edge, selected moment — repositioned every frame (cheap)
  useEffect(() => {
    let raf = 0;
    const xOf = (tMs: number): number | null => {
      const c = chart.current;
      const cs = candlesRef.current;
      if (!c || !cs.length) return null;
      const b = bucketRef.current;
      const ts = c.timeScale();
      // nearest existing bar at or before t
      let lo = 0,
        hi = cs.length - 1,
        k = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cs[mid].t0 <= tMs) {
          k = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (k < 0) k = 0;
      const x = ts.timeToCoordinate(sec(cs[k].t0));
      if (x == null) return null;
      const spacing = ts.options().barSpacing;
      const frac = Math.max(0, Math.min(1, (tMs - cs[k].t0) / b));
      return x - spacing / 2 + frac * spacing;
    };
    const place = (el: HTMLDivElement | null, x: number | null, w = 0) => {
      if (!el) return;
      if (x == null) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.style.transform = `translateX(${x}px)`;
      if (w) el.style.width = `${Math.max(2, w)}px`;
    };
    const loop = () => {
      const s = ctrl.s;
      place(playheadEl.current, xOf(s.playhead));
      place(liveEl.current, isLive && !s.following ? xOf(ctrl.series.liveEdge) : null);
      if (s.selection) {
        const a = xOf(s.selection[0]);
        const z = xOf(s.selection[1]);
        place(selEl.current, a, a != null && z != null ? z - a : 0);
      } else place(selEl.current, null);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ctrl, isLive]);

  // live: keep the newest bar in view while following
  useEffect(() => {
    if (st.following && chart.current) chart.current.timeScale().scrollToRealTime();
  }, [sv, st.following]);

  const L = legend;
  const chg = L && L.open ? (L.close / L.open - 1) * 100 : 0;
  const f = (p: number) => (useMcap ? fmtUsd(conv(p)) : fmtPrice(p));
  return (
    <div className="tv-wrap" style={height ? { height } : undefined}>
      <div ref={host} className="tv-host" role="img" aria-label={label} />
      <div className="tv-layer" aria-hidden="true">
        <div ref={selEl} className="tv-sel" />
        <div ref={liveEl} className="tv-live">
          <span>LIVE</span>
        </div>
        <div ref={playheadEl} className="tv-ph" />
      </div>
      <div className="tv-legend">
        {L ? (
          <>
            <span>O <b>{f(L.open)}</b></span>
            <span>H <b>{f(L.high)}</b></span>
            <span>L <b>{f(L.low)}</b></span>
            <span>C <b>{f(L.close)}</b></span>
            <b className={chg >= 0 ? 'up' : 'down'}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</b>
            <span>Vol <b>{usdPerSol ? fmtUsd((L.buySol + L.sellSol) * usdPerSol) : (L.buySol + L.sellSol).toFixed(2) + ' SOL'}</b></span>
            <span><b>{L.count}</b> trades</span>
          </>
        ) : (
          <span className="muted">Click a candle to see who traded it</span>
        )}
      </div>
    </div>
  );
}

/** Auto candle size for the TradingView chart: a readable default for the launch length. */
export function defaultBucket(spanMs: number) {
  return pickBucket(spanMs, 120);
}
