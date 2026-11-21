import { useMemo, useState } from 'react';
import type { MetricFilter, PlayerController } from '../../core/player.ts';
import type { WindowMetrics } from '../../core/metrics.ts';
import { EARLY_BUYERS_N } from '../../core/metrics.ts';
import type { DataMode, FundingEvidence, Swap } from '../../core/types.ts';
import { SOL_EXPLORER_ADDR, SOL_EXPLORER_TX } from '../../core/types.ts';
import { fmtClock, fmtDur, fmtPct, fmtPrice, fmtShare, fmtSol, fmtTplus, fmtUsd, short } from '../../core/format.ts';
import { fetchFunding } from '../data/sources.ts';

interface Props {
  ctrl: PlayerController;
  m: WindowMetrics | null;
  tape: Swap[];
  t0: number;
  mode: DataMode;
  filter: MetricFilter | null;
  highlight: string | null;
  onShare: () => void;
  onFunding?: (ev: FundingEvidence[]) => void;
  compact?: boolean;
}

export function filterIds(m: WindowMetrics, f: MetricFilter | null): Set<string> | null {
  if (!f) return null;
  const top3 = new Set(m.top3.map((w) => w.wallet));
  const clusterW = new Set(m.clusters.flatMap((c) => [...c.wallets, c.funder]));
  const largestBuy = m.buys.reduce<Swap | null>((a, s) => (!a || s.sol > a.sol ? s : a), null);
  const list: Swap[] =
    f === 'buys' ? m.buys
    : f === 'sells' ? m.sells
    : f === 'largest' ? (m.largest ? [m.largest] : [])
    : f === 'largestBuy' ? (largestBuy ? [largestBuy] : [])
    : f === 'firstTime' ? m.firstTimeBuyerSwaps
    : f === 'top3' ? m.buys.filter((s) => top3.has(s.wallet))
    : f === 'earlySellers' ? m.earlySellers.flatMap((e) => e.sells)
    : m.swaps.filter((s) => clusterW.has(s.wallet));
  return new Set(list.map((s) => s.id));
}

export function SideTag({ side }: { side: 'buy' | 'sell' }) {
  return <span className={`side side-${side}`}>{side === 'buy' ? '▲ BUY' : '▽ SELL'}</span>;
}

export function TxLink({ sig, mode }: { sig: string; mode: DataMode }) {
  if (mode === 'demo') return <span className="muted" title="Demo data — synthetic signature, no on-chain proof">demo tx</span>;
  return (
    <a className="txlink" href={SOL_EXPLORER_TX(sig)} target="_blank" rel="noreferrer noopener" title={`Verify ${sig} on Solscan`} aria-label={`Verify transaction ${short(sig, 6)} on Solscan`}>
      tx ↗
    </a>
  );
}

function Metric({ id, label, value, sub, filter, onPick, warn }: { id: MetricFilter; label: string; value: string; sub?: string; filter: MetricFilter | null; onPick: (f: MetricFilter | null) => void; warn?: string }) {
  const on = filter === id;
  return (
    <button type="button" className={`metric${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onPick(on ? null : id)} title={`Highlight the swaps behind "${label}"`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value mono">{value}</span>
      {sub && <span className="metric-sub mono">{sub}</span>}
      {warn && <span className="metric-warn">{warn}</span>}
    </button>
  );
}

export function CandlePanel({ ctrl, m, tape, t0, mode, filter, highlight, onShare, onFunding, compact }: Props) {
  const [raw, setRaw] = useState(false);
  const [funding, setFunding] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const pick = (f: MetricFilter | null) => ctrl.set({ filter: f });
  const ids = useMemo(() => (m ? filterIds(m, filter) : null), [m, filter]);

  if (!m) {
    return (
      <div className="panel-body">
        <p className="eyebrow">Tape</p>
        <p className="hint">Drag across the chart, click a candle, or press <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> to open a window.</p>
        <SwapList swaps={tape.slice(-60).reverse()} t0={t0} mode={mode} ctrl={ctrl} highlight={highlight} />
      </div>
    );
  }

  const dur = m.b - m.a;
  const trunc = m.historyTruncated ? '* observed history only' : undefined;
  const shown = ids ? m.swaps.filter((s) => ids.has(s.id)) : m.swaps;
  const checkFunding = async () => {
    setFunding({ busy: true, note: null });
    const wallets = [...new Set([...m.top3.map((w) => w.wallet), ...(m.largest ? [m.largest.wallet] : [])])].slice(0, 5);
    const found: FundingEvidence[] = [];
    let unresolved = 0;
    for (const w of wallets) {
      try {
        const r = await fetchFunding(w);
        if (r.evidence) found.push(r.evidence);
        else unresolved++;
      } catch {
        unresolved++;
      }
    }
    onFunding?.(found);
    setFunding({ busy: false, note: `${found.length} funding source(s) found, ${unresolved} unresolved (history too long, rate limit or no inbound SOL transfer).` });
  };

  return (
    <div className="panel-body">
      <div className="candle-head">
        <div>
          <p className="eyebrow">Open the candle</p>
          <h3 className="mono win">
            {fmtTplus(m.a, t0)} → {fmtTplus(m.b, t0)} <span className="muted">· {fmtDur(dur)}</span>
          </h3>
          <p className="muted mono small">
            {fmtClock(m.a / 1000)}–{fmtClock(m.b / 1000)} UTC · chain time, 1 s resolution
          </p>
        </div>
        <div className="row gap-s">
          <button type="button" className="btn btn-ghost btn-s" onClick={onShare}>Share range</button>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => ctrl.clearSelection()} aria-label="Close window (Esc)">✕</button>
        </div>
      </div>

      {m.gapsInWindow.length > 0 && <p className="notice">⚠ {m.gapsInWindow.length} collector gap(s) overlap this window — swaps inside them were not observed.</p>}
      {m.truncationNote && <p className="notice">{m.truncationNote}</p>}

      <div className="price-row">
        <div>
          <span className="metric-label">Price start → end</span>
          <span className="mono big">
            {fmtPrice(m.priceStart)} → {fmtPrice(m.priceEnd)} <span className={m.changePct != null && m.changePct >= 0 ? 'up' : 'down'}>{fmtPct(m.changePct)}</span>
          </span>
          <span className="metric-sub">SOL per token, from curve/pool reserves after each swap</span>
        </div>
        <div title={m.fdvEnd.method}>
          <span className="metric-label">FDV start → end</span>
          <span className="mono big">
            {fmtUsd(m.fdvStart.usd)} → {fmtUsd(m.fdvEnd.usd)}
          </span>
          <span className="metric-sub">{m.fdvEnd.usd == null ? m.fdvEnd.method : 'fully diluted · hover for method'}</span>
        </div>
      </div>

      <div className="metrics">
        <Metric id="buys" label="Swaps" value={String(m.count)} sub={`▲ ${m.buys.length} · ▽ ${m.sells.length}`} filter={filter} onPick={pick} />
        <Metric id="buys" label="Bought" value={`${fmtSol(m.buySol)} SOL`} sub={`net ${m.netSol >= 0 ? '+' : ''}${fmtSol(m.netSol)} SOL`} filter={filter} onPick={pick} />
        <Metric id="sells" label="Sold" value={`${fmtSol(m.sellSol)} SOL`} sub={`${m.sells.length} sells`} filter={filter} onPick={pick} />
        <Metric id="largest" label="Largest swap" value={m.largest ? `${fmtSol(m.largest.sol)} SOL` : '—'} sub={m.largest ? `${m.largest.side.toUpperCase()} · ${short(m.largest.wallet)}` : undefined} filter={filter} onPick={pick} />
        <Metric id="firstTime" label="Distinct buyers" value={String(m.distinctBuyers.length)} sub={`${m.firstTimeBuyers.length} first-time buyers`} filter={filter} onPick={pick} warn={trunc} />
        <Metric id="largestBuy" label="Largest buy share" value={fmtShare(m.largestBuyShare.value)} sub={`${fmtSol(m.largestBuyShare.numerator)} of ${fmtSol(m.largestBuyShare.denominator)} SOL bought`} filter={filter} onPick={pick} />
        <Metric id="top3" label={`Top ${m.top3.length || 3} wallets share`} value={fmtShare(m.top3Share.value)} sub={`${fmtSol(m.top3Share.numerator)} of ${fmtSol(m.top3Share.denominator)} SOL bought`} filter={filter} onPick={pick} />
        <Metric id="earlySellers" label="Early buyers selling" value={String(m.earlySellers.length)} sub={`of first ${EARLY_BUYERS_N} observed buyers`} filter={filter} onPick={pick} warn={trunc} />
        <Metric id="clusters" label="Funding links" value={String(m.clusters.length)} sub={m.clusters.length ? 'shared funder (hint)' : 'no evidence loaded'} filter={filter} onPick={pick} />
      </div>
      <p className="muted small">Denominator for shares: all buy volume inside this window ({fmtSol(m.buySol)} SOL, {m.buys.length} buys). Addresses are counted as addresses — not as independent traders.</p>

      {m.earlySellers.length > 0 && !compact && (
        <section className="sub">
          <h4>Early buyers selling in this window</h4>
          <ul className="plain">
            {m.earlySellers.map((e) => (
              <li key={e.wallet} className="mono small">
                #{e.earlyRank} <WalletLink w={e.wallet} mode={mode} /> bought {fmtSol(e.firstBuy.sol)} at {fmtTplus(e.firstBuy.tl, t0)} · sold {fmtSol(e.soldSol)} SOL in {e.sells.length} tx{' '}
                {e.sells.map((s) => (
                  <button key={s.id} type="button" className="linkbtn" onClick={() => ctrl.highlightSwap(s.id)}>
                    {fmtTplus(s.tl, t0)}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!compact && (
        <section className="sub">
          <h4>Funding links</h4>
          {m.clusters.length === 0 && <p className="muted small">No funding evidence for wallets in this window.</p>}
          {m.clusters.map((c) => (
            <div key={c.funder} className="cluster small">
              <p>
                <span className="tag">hint</span> {c.wallets.length} address(es) received SOL from <WalletLink w={c.funder} mode={mode} />. A shared funder is observable; it does not prove who controls these addresses.
              </p>
              <ul className="plain mono">
                {c.evidence.map((e) => (
                  <li key={e.wallet + e.signature}>
                    <WalletLink w={e.wallet} mode={mode} /> ← {fmtSol(e.sol)} SOL · <TxLink sig={e.signature} mode={mode} /> <span className="muted">({e.method})</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {mode === 'live' && (
            <button type="button" className="btn btn-ghost btn-s" disabled={funding.busy} onClick={checkFunding}>
              {funding.busy ? 'Checking…' : 'Check first funding of top buyers'}
            </button>
          )}
          {funding.note && <p className="muted small">{funding.note}</p>}
        </section>
      )}

      <section className="sub">
        <div className="row between">
          <h4>
            Swaps in window {filter && <span className="muted">· filtered ({shown.length})</span>}
          </h4>
          <label className="small row gap-s">
            <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> raw events
          </label>
        </div>
        {raw ? <RawList swaps={m.swaps} m={m} /> : <SwapList swaps={shown} t0={t0} mode={mode} ctrl={ctrl} highlight={highlight} m={m} />}
      </section>
    </div>
  );
}

function WalletLink({ w, mode }: { w: string; mode: DataMode }) {
  if (mode === 'demo') return <span className="mono">{short(w)}</span>;
  return (
    <a className="mono" href={SOL_EXPLORER_ADDR(w)} target="_blank" rel="noreferrer noopener">
      {short(w)}
    </a>
  );
}

export function SwapList({ swaps, t0, mode, ctrl, highlight, m }: { swaps: Swap[]; t0: number; mode: DataMode; ctrl: PlayerController; highlight: string | null; m?: WindowMetrics }) {
  const first = new Set(m?.firstTimeBuyerSwaps.map((s) => s.id));
  const top3 = new Set(m?.top3.map((w) => w.wallet));
  const largestId = m?.largest?.id;
  return (
    <ol className="swaps" aria-label="Swaps">
      {swaps.slice(0, 400).map((s) => (
        <li key={s.id} className={s.id === highlight ? 'hl' : ''}>
          <button type="button" className="swaprow" onClick={() => ctrl.highlightSwap(s.id)} aria-label={`${s.side} ${fmtSol(s.sol)} SOL by ${s.wallet} at ${fmtTplus(s.tl, t0)}`}>
            <span className="mono muted">{fmtTplus(s.tl, t0)}</span>
            <SideTag side={s.side} />
            <span className="mono num">{fmtSol(s.sol)}</span>
            <span className="mono muted">{short(s.wallet)}</span>
            <span className="tags">
              {s.id === largestId && <span className="tag tag-a">largest</span>}
              {first.has(s.id) && <span className="tag">first buy</span>}
              {top3.has(s.wallet) && s.side === 'buy' && <span className="tag">top 3</span>}
              {s.legs > 1 && <span className="tag">{s.legs} legs</span>}
              {s.source === 'backfill' && <span className="tag">backfill</span>}
            </span>
          </button>
          <TxLink sig={s.signature} mode={mode} />
        </li>
      ))}
      {swaps.length > 400 && <li className="muted small">+ {swaps.length - 400} more (narrow the window)</li>}
      {swaps.length === 0 && <li className="muted small">No swaps.</li>}
    </ol>
  );
}

function RawList({ swaps, m }: { swaps: Swap[]; m: WindowMetrics }) {
  return (
    <div className="raw">
      <p className="mono small muted">
        bought = Σ sol where side=BUY = {fmtSol(m.buySol, 6)} · sold = Σ sol where side=SELL = {fmtSol(m.sellSol, 6)} · n = {m.count}
      </p>
      <div className="raw-scroll">
        <table className="mono small">
          <thead>
            <tr>
              <th>#</th>
              <th>slot</th>
              <th>chain s</th>
              <th>side</th>
              <th>sol</th>
              <th>tokens</th>
              <th>price</th>
              <th>wallet</th>
              <th>legs</th>
              <th>src</th>
              <th>id</th>
            </tr>
          </thead>
          <tbody>
            {swaps.map((s) => (
              <tr key={s.id}>
                <td>{s.rank}</td>
                <td>{s.slot}</td>
                <td>{s.chainTime}</td>
                <td>{s.side}</td>
                <td>{s.sol.toFixed(6)}</td>
                <td>{Math.round(s.tokens)}</td>
                <td>{fmtPrice(s.priceSol)}</td>
                <td>{s.wallet}</td>
                <td>{s.legs}</td>
                <td>{s.source}</td>
                <td>{s.legIds.join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
