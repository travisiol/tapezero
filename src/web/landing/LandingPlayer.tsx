import { useEffect, useMemo, useRef, useState } from 'react';
import { REFERENCE, referenceHandle, type LaunchHandle, type Provenance } from '../data/sources.ts';
import { Chart } from '../player/Chart.tsx';
import { Transport, usePlayer, usePlayerKeys, shareUrl } from '../player/usePlayer.tsx';
import { filterIds, SideTag, TxLink } from '../player/CandlePanel.tsx';
import { Link } from '../router.tsx';
import { fmtSol, fmtShare, fmtPct, fmtUsd, short, fmtClock } from '../../core/format.ts';
import { summarize, usd } from '../../core/summary.ts';
import { buildCandles, type SwapSeries } from '../../core/series.ts';
import { SOL_EXPLORER_ADDR } from '../../core/types.ts';

/** The window that built the peak: the 6 chain-seconds ending with the highest-priced swap. */
export function peakWindow(series: SwapSeries): [number, number] {
  let pk = series.swaps[0];
  for (const s of series.swaps) if (s.priceSol > pk.priceSol) pk = s;
  const end = pk.chainTime * 1000 + 999;
  return [end - 5999, end];
}

/** The 5-second candle with the most SOL bought. */
export function busiestCandle(series: SwapSeries, ms = 5000): [number, number] {
  const cs = buildCandles(series, series.start, series.liveEdge + ms, ms);
  let best = cs[0];
  for (const c of cs) if (c.buySol > best.buySol) best = c;
  return [best.t0, best.t1 - 1];
}

export function LandingPlayer() {
  const [h, setH] = useState<(LaunchHandle & { provenance: Provenance }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    referenceHandle().then(setH, (e) => setErr(String(e.message ?? e)));
  }, []);
  if (err) return <div className="lp lp-loading">Could not load the replay ({err}).</div>;
  if (!h) return <div className="lp lp-loading dots-bg">Loading real swaps…</div>;
  return <Player h={h} />;
}

function Player({ h }: { h: LaunchHandle & { provenance: Provenance } }) {
  const p = usePlayer(h);
  const { ctrl, st, metrics } = p;
  const box = useRef<HTMLDivElement>(null);
  usePlayerKeys(ctrl, box);
  const dimIds = useMemo(() => (metrics ? filterIds(metrics, st.filter) : null), [metrics, st.filter]);
  const fit = () => ctrl.set({ viewport: [h.series.start - 2000, h.series.liveEdge + 3000] });
  useEffect(() => {
    fit();
    const [a, b] = busiestCandle(h.series);
    ctrl.select(a, b);
    ctrl.seek(b, true);
  }, [ctrl]);
  const openBusiest = () => {
    fit();
    const [a, b] = busiestCandle(h.series);
    ctrl.select(a, b);
    ctrl.seek(b, true);
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const replay = () => {
    ctrl.clearSelection();
    fit();
    ctrl.set({ playhead: h.series.start, playing: true, speed: 2 });
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const rewind = () => {
    ctrl.rewind(15_000);
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const sentences = metrics ? summarize(metrics, p.usdPerSol) : [];
  const top = metrics ? [...metrics.buys].sort((x, y) => y.sol - x.sol).slice(0, 3) : [];
  const termUrl = shareUrl(h, st).replace(location.origin, '');
  const prov = h.provenance;
  const [w0, w1] = prov.windowUtc.map((x) => new Date(x));
  return (
    <>
      <div className="lp" ref={box} tabIndex={-1} aria-label="Replay of real Dacity Coin swaps">
        <div className="lp-head">
          <div>
            <span className="badge badge-real">Real on-chain data</span>
            <span className="lp-title">
              Dacity Coin <span className="muted">· PumpSwap</span>
            </span>
            <span className="muted small">
              15 Oct 2026, {fmtClock(w0.getTime() / 1000)}–{fmtClock(w1.getTime() / 1000)} UTC · {h.series.size} swaps
            </span>
          </div>
          <div className="row gap-s wrap">
            <button type="button" className="btn btn-primary btn-s" onClick={replay}>
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.5v11L13 8z" fill="currentColor" /></svg> Replay
            </button>
            <button type="button" className="btn btn-s" onClick={rewind}>−15 s</button>
          </div>
        </div>
        <p className="lp-context">{REFERENCE.context}</p>
        <div className="lp-body">
          <div className="lp-chart">
            <Chart ctrl={ctrl} t0={p.t0} gaps={[]} isLive={false} usdPerSol={p.usdPerSol} supply={h.bundle.launch.supply} dimIds={dimIds} compact label="Dacity Coin price and swaps. Click a candle to see who bought it." />
            <Transport ctrl={ctrl} h={h} t0={p.t0} compact />
          </div>
          <div className="lp-side" aria-live="polite">
            {metrics ? (
              <>
                <p className="panel-kicker">
                  {fmtClock(metrics.a / 1000)} → {fmtClock(metrics.b / 1000)} UTC
                </p>
                <ul className="story">
                  {sentences.slice(0, 4).map((x, i) => (
                    <li key={i}>
                      <button type="button" className={`story-line${x.filter && st.filter === x.filter ? ' on' : ''}`} disabled={!x.filter} onClick={() => x.filter && ctrl.set({ filter: st.filter === x.filter ? null : x.filter })}>
                        {x.text}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="keys">
                  <div className="key">
                    <span className="key-label">Price</span>
                    <span className={`key-value mono ${metrics.changePct != null && metrics.changePct >= 0 ? 'up' : 'down'}`}>{fmtPct(metrics.changePct, 0)}</span>
                    <span className="key-sub">market cap {fmtUsd(metrics.fdvEnd.usd)}</span>
                  </div>
                  <div className="key">
                    <span className="key-label">Biggest buy</span>
                    <span className="key-value mono">{fmtShare(metrics.largestBuyShare.value)}</span>
                    <span className="key-sub">of all the buying</span>
                  </div>
                </div>
                <ol className="lp-top" aria-label="Largest buys in the range">
                  {top.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="swaprow" onClick={() => ctrl.highlightSwap(s.id)}>
                        <SideTag side={s.side} />
                        <span className="mono num">{p.usdPerSol ? usd(s.sol * p.usdPerSol) : `${fmtSol(s.sol)} SOL`}</span>
                        <span className="mono muted">{fmtClock(s.chainTime)}</span>
                        <span className="mono muted">{short(s.wallet)}</span>
                      </button>
                      <TxLink sig={s.signature} mode="live" />
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <div className="lp-empty">
                <p>Click a candle on the chart.</p>
                <p className="muted small">You will see how many wallets bought, how much, and how much of the buying came from the single largest buy.</p>
              </div>
            )}
            <Link to={termUrl} className="btn btn-ghost btn-s lp-open">
              Open in the terminal →
            </Link>
          </div>
        </div>
        <details className="lp-prov small muted">
          <summary>Where this data comes from</summary>
          <p>
            Every trade of the PumpSwap pool <a href={SOL_EXPLORER_ADDR(prov.pool)} target="_blank" rel="noreferrer noopener" className="mono">{short(prov.pool, 5)}</a>, read directly from Solana ({prov.swaps} trades; {prov.failedTransactions} failed transactions left out). This pool is priced in TTWO, a tokenized Take-Two share, so dollar values use the TTWO and SOL prices of the same minute. Every trade links to Solscan.
          </p>
        </details>
      </div>


    </>
  );
}
