import { useMemo, useRef } from 'react';
import { demoReplayHandle } from '../data/sources.ts';
import { Chart } from '../player/Chart.tsx';
import { Transport, usePlayer, usePlayerKeys, shareUrl } from '../player/usePlayer.tsx';
import { filterIds, SideTag } from '../player/CandlePanel.tsx';
import { Link } from '../router.tsx';
import { fmtSol, fmtShare, fmtTplus, short, fmtUsd } from '../../core/format.ts';
import type { SwapSeries } from '../../core/series.ts';

/** The window that built the peak: the 6 chain-seconds ending with the highest-priced swap. */
export function peakWindow(series: SwapSeries): [number, number] {
  let pk = series.swaps[0];
  for (const s of series.swaps) if (s.priceSol > pk.priceSol) pk = s;
  const end = pk.chainTime * 1000 + 999;
  return [end - 5999, end];
}

export const LANDING_KEY = 'orbit';
export const LANDING_SECONDS = 100;

export function LandingPlayer() {
  const h = useMemo(() => demoReplayHandle(LANDING_KEY, LANDING_SECONDS), []);
  const p = usePlayer(h);
  const { ctrl, st, metrics } = p;
  const box = useRef<HTMLDivElement>(null);
  usePlayerKeys(ctrl, box);
  const dimIds = useMemo(() => (metrics ? filterIds(metrics, st.filter) : null), [metrics, st.filter]);
  const openPeak = () => {
    const [a, b] = peakWindow(h.series);
    ctrl.set({ viewport: [h.series.start - 2000, h.series.start + 75_000] });
    ctrl.select(a, b);
    ctrl.seek(b, true);
  };
  const replay = () => {
    ctrl.clearSelection();
    ctrl.set({ playhead: h.series.start, playing: true, speed: 2, viewport: [h.series.start - 2000, h.series.start + 75_000] });
  };
  const rewind = () => {
    ctrl.rewind(15_000);
    window.dispatchEvent(new Event('tapezero:rewind'));
  };
  const top3 = metrics ? [...metrics.buys].sort((x, y) => y.sol - x.sol).slice(0, 3) : [];
  const termUrl = shareUrl(h, st).replace(location.origin, '');
  return (
    <div className="lp" ref={box} tabIndex={-1} aria-label="Interactive replay of a demo launch">
      <div className="lp-head">
        <div>
          <span className="badge badge-demo">Demo data</span>
          <span className="lp-title">
            {h.bundle.launch.name} <span className="muted">${h.bundle.launch.symbol}</span>
          </span>
          <span className="muted small mono">first {LANDING_SECONDS} s · synthetic tape</span>
        </div>
        <div className="row gap-s wrap">
          <button type="button" className="btn btn-primary btn-s" onClick={replay}>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.5v11L13 8z" fill="currentColor" /></svg> Play replay
          </button>
          <button type="button" className="btn btn-s" onClick={rewind}>−15 s</button>
          <button type="button" className="btn btn-s" onClick={openPeak}>Open the peak</button>
        </div>
      </div>
      <div className="lp-body">
        <div className="lp-chart">
          <Chart ctrl={ctrl} t0={p.t0} gaps={[]} isLive={false} usdPerSol={p.usdPerSol} supply={h.bundle.launch.supply} dimIds={dimIds} compact label="Demo launch timeline. Drag to select, click a candle to open it." />
          <Transport ctrl={ctrl} h={h} t0={p.t0} compact />
        </div>
        <div className="lp-side" aria-live="polite">
          {metrics ? (
            <>
              <p className="eyebrow">Open the candle · {fmtTplus(metrics.a, p.t0)} → {fmtTplus(metrics.b, p.t0)}</p>
              <dl className="lp-stats">
                <div>
                  <dt>Swaps</dt>
                  <dd className="mono">{metrics.count}</dd>
                </div>
                <div>
                  <dt>Distinct buyers</dt>
                  <dd className="mono">{metrics.distinctBuyers.length}</dd>
                </div>
                <div>
                  <dt>Largest buy share</dt>
                  <dd className="mono">{fmtShare(metrics.largestBuyShare.value)}</dd>
                  <dd className="sub mono">
                    {fmtSol(metrics.largestBuyShare.numerator)} of {fmtSol(metrics.largestBuyShare.denominator)} SOL bought
                  </dd>
                </div>
                <div>
                  <dt>FDV end</dt>
                  <dd className="mono">{fmtUsd(metrics.fdvEnd.usd)}</dd>
                </div>
              </dl>
              <ol className="lp-top">
                {top3.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="swaprow" onClick={() => ctrl.highlightSwap(s.id)}>
                      <span className="mono muted">{fmtTplus(s.tl, p.t0)}</span>
                      <SideTag side={s.side} />
                      <span className="mono num">{fmtSol(s.sol)} SOL</span>
                      <span className="mono muted">{short(s.wallet)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="lp-empty">
              <p className="eyebrow">Try it</p>
              <p>Drag across the chart, or click the tallest candle.</p>
              <p className="muted small">The panel shows the swaps that built the move: count, distinct buyers, and how much of the buying came from the largest buy.</p>
            </div>
          )}
          <Link to={termUrl} className="btn btn-ghost btn-s lp-open">
            Open this in the terminal →
          </Link>
        </div>
      </div>
    </div>
  );
}
