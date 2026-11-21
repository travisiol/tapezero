import { useMemo, useState } from 'react';
import type { MetricFilter, PlayerController } from '../../core/player.ts';
import type { WindowMetrics } from '../../core/metrics.ts';
import { EARLY_BUYERS_N } from '../../core/metrics.ts';
import type { DataMode, FundingEvidence, Swap } from '../../core/types.ts';
import { SOL_EXPLORER_ADDR, SOL_EXPLORER_TX } from '../../core/types.ts';
import { fmtClock, fmtDur, fmtPct, fmtPrice, fmtShare, fmtSol, fmtTplus, fmtUsd, short } from '../../core/format.ts';
import { fetchFunding } from '../data/sources.ts';
import { DEFINITIONS, money, summarize } from '../../core/summary.ts';
import { emph } from './emph.tsx';

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
  solUsd?: number | null;
  supply?: number;
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
  return <span className={`side side-${side}`}>{side === 'buy' ? '▲ Buy' : '▽ Sell'}</span>;
}

export function TxLink({ sig, mode, icon }: { sig: string; mode: DataMode; icon?: boolean }) {
  if (mode === 'demo') return <span className="muted" title="Demo data — synthetic signature, no on-chain proof">demo tx</span>;
  return (
    <a className="txlink" href={SOL_EXPLORER_TX(sig)} target="_blank" rel="noreferrer noopener" title={`Verify ${sig} on Solscan`} aria-label={`Verify transaction ${short(sig, 6)} on Solscan`}>
      {icon ? "↗" : "Solscan ↗"}
    </a>
  );
}

function Metric({ id, label, value, sub, def, filter, onPick, warn }: { id: MetricFilter; label: string; value: string; sub?: string; def?: string; filter: MetricFilter | null; onPick: (f: MetricFilter | null) => void; warn?: string }) {
  const on = filter === id;
  return (
    <button type="button" className={`metric${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onPick(on ? null : id)} title={`Highlight the swaps behind "${label}"`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value mono">{value}</span>
      {sub && <span className="metric-sub mono">{sub}</span>}
      {def && <span className="metric-def">{def}</span>}
      {warn && <span className="metric-warn">{warn}</span>}
    </button>
  );
}

export function CandlePanel({ ctrl, m, tape, t0, mode, filter, highlight, onShare, onFunding, compact, solUsd, supply }: Props) {
  const [raw, setRaw] = useState(false);
  const [funding, setFunding] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const pick = (f: MetricFilter | null) => ctrl.set({ filter: f });
  const ids = useMemo(() => (m ? filterIds(m, filter) : null), [m, filter]);

  if (!m) {
    return (
      <div className="panel-body">
        <p className="panel-kicker">Latest swaps</p>
        <p className="hint">Click a candle on the chart (or drag across it) to see what moved the price in that moment.</p>
        <SwapList swaps={tape.slice(-60).reverse()} t0={t0} mode={mode} ctrl={ctrl} highlight={highlight} solUsd={solUsd} supply={supply} />
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

  const sentences = summarize(m, solUsd ?? null);
  const tile = (id: MetricFilter | null, label: string, value: string, sub: string, def: string, tone?: string) => (
    <button type="button" className={`key${filter === id && id ? ' on' : ''}`} aria-pressed={!!id && filter === id} onClick={() => id && pick(filter === id ? null : id)} title={def}>
      <span className="key-label">{label}</span>
      <span className={`key-value mono ${tone ?? ''}`}>{value}</span>
      <span className="key-sub">{sub}</span>
    </button>
  );

  return (
    <div className="panel-body">
      <div className="candle-head">
        <div>
          <p className="panel-kicker">Selected moment</p>
          <h3 className="win">
            {fmtClock(m.a / 1000)} → {fmtClock(m.b / 1000)} <span className="muted">UTC · {fmtDur(dur)}</span>
          </h3>
        </div>
        <div className="row gap-s">
          {!compact && (
            <button type="button" className="btn btn-ghost btn-s" onClick={onShare}>
              Share
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-s" onClick={() => ctrl.clearSelection()} aria-label="Close (Esc)">
            ✕
          </button>
        </div>
      </div>

      {m.gapsInWindow.length > 0 && <p className="notice">Part of this range was not recorded (collector outage). Numbers only cover what was observed.</p>}

      <ul className="story" aria-label="What happened">
        {sentences.map((x, i) => (
          <li key={i}>
            <button
              type="button"
              className={`story-line ${x.tone ?? ''}${x.filter && filter === x.filter ? ' on' : ''}`}
              onClick={() => x.filter && pick(filter === x.filter ? null : x.filter)}
              disabled={!x.filter}
              title={x.filter ? 'Highlight these swaps on the chart' : undefined}
            >
              {emph(x.text)}
            </button>
          </li>
        ))}
      </ul>

      <div className="keys">
        {tile(null, 'Price', fmtPct(m.changePct, 0), m.fdvEnd.usd != null ? `market cap ${fmtUsd(m.fdvEnd.usd)}` : 'no USD reference', DEFINITIONS.mcap, m.changePct != null && m.changePct >= 0 ? 'up' : 'down')}
        {tile('buys', 'Bought', money(m.buySol, solUsd ?? null), `${fmtSol(m.buySol)} SOL · ${m.buys.length} buys`, DEFINITIONS.bought)}
        {tile('firstTime', 'Buyers', String(m.distinctBuyers.length), `wallets · ${m.count} trades`, DEFINITIONS.buyers)}
        {tile('largestBuy', 'Biggest buy', money(m.largestBuyShare.numerator, solUsd ?? null), `${fmtShare(m.largestBuyShare.value)} of all buying`, DEFINITIONS.largestBuy)}
      </div>

      <details className="more">
        <summary>Details and definitions</summary>
        <div className="price-row">
          <div>
            <span className="metric-label">Price per token (SOL)</span>
            <span className="mono big">
              {fmtPrice(m.priceStart)} → {fmtPrice(m.priceEnd)}
            </span>
            <span className="metric-sub">{DEFINITIONS.price}</span>
          </div>
          <div>
            <span className="metric-label">Market cap (fully diluted)</span>
            <span className="mono big">
              {fmtUsd(m.fdvStart.usd)} → {fmtUsd(m.fdvEnd.usd)}
            </span>
            <span className="metric-sub">{m.fdvEnd.method}</span>
          </div>
        </div>
        <div className="metrics">
          <Metric id="buys" label="Swaps" value={String(m.count)} sub={`${m.buys.length} buys · ${m.sells.length} sells`} def={DEFINITIONS.swaps} filter={filter} onPick={pick} />
          <Metric id="buys" label="Bought" value={`${fmtSol(m.buySol)} SOL`} sub={`net ${m.netSol >= 0 ? '+' : ''}${fmtSol(m.netSol)} SOL`} def={DEFINITIONS.bought} filter={filter} onPick={pick} />
          <Metric id="sells" label="Sold" value={`${fmtSol(m.sellSol)} SOL`} sub={`${m.sells.length} sells`} def={DEFINITIONS.sold} filter={filter} onPick={pick} />
          <Metric id="largest" label="Largest swap" value={m.largest ? `${fmtSol(m.largest.sol)} SOL` : '—'} sub={m.largest ? `${m.largest.side} · ${short(m.largest.wallet)}` : undefined} def={DEFINITIONS.largest} filter={filter} onPick={pick} />
          <Metric id="firstTime" label="Buyers" value={String(m.distinctBuyers.length)} sub={`${m.firstTimeBuyers.length} first-time`} def={DEFINITIONS.buyers} filter={filter} onPick={pick} warn={trunc} />
          <Metric id="largestBuy" label="Biggest buy share" value={fmtShare(m.largestBuyShare.value)} sub={`${fmtSol(m.largestBuyShare.numerator)} / ${fmtSol(m.largestBuyShare.denominator)} SOL`} def={DEFINITIONS.largestBuy} filter={filter} onPick={pick} />
          <Metric id="top3" label="Top 3 buyers share" value={fmtShare(m.top3Share.value)} sub={`${fmtSol(m.top3Share.numerator)} / ${fmtSol(m.top3Share.denominator)} SOL`} def={DEFINITIONS.top3} filter={filter} onPick={pick} />
          <Metric id="earlySellers" label="Early buyers selling" value={String(m.earlySellers.length)} sub={`of the first ${EARLY_BUYERS_N} buyers`} def={DEFINITIONS.early} filter={filter} onPick={pick} warn={trunc} />
          <Metric id="clusters" label="Shared funder" value={String(m.clusters.length)} sub={m.clusters.length ? 'hint' : 'none loaded'} def={DEFINITIONS.funding} filter={filter} onPick={pick} />
        </div>

      {m.earlySellers.length > 0 && !compact && (
        <section className="sub">
          <h4>First buyers who sold here</h4>
          <ul className="plain">
            {m.earlySellers.map((e) => (
              <li key={e.wallet} className="mono small">
                Buyer #{e.earlyRank} <WalletLink w={e.wallet} mode={mode} /> bought {money(e.firstBuy.sol, solUsd ?? null)} at {fmtClock(e.firstBuy.chainTime)}, sold {money(e.soldSol, solUsd ?? null)} at{' '}
                {e.sells.map((s) => (
                  <button key={s.id} type="button" className="linkbtn" onClick={() => ctrl.highlightSwap(s.id)}>
                    {fmtClock(s.chainTime)}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!compact && (
        <section className="sub">
          <h4>Wallets funded by the same address</h4>
          {m.clusters.length === 0 && <p className="muted small">None found among these wallets.</p>}
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
              {funding.busy ? 'Checking…' : 'Check who funded the top buyers'}
            </button>
          )}
          {funding.note && <p className="muted small">{funding.note}</p>}
        </section>
      )}

      </details>

      <section className="sub">
        <div className="row between">
          <h4>
            Trades in this moment {filter && <span className="muted">· highlighted ({shown.length})</span>}
          </h4>
          <label className="small row gap-s">
            <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> raw events
          </label>
        </div>
        {raw ? <RawList swaps={m.swaps} m={m} /> : <SwapList swaps={shown} t0={t0} mode={mode} ctrl={ctrl} highlight={highlight} m={m} solUsd={solUsd} supply={supply} />}
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

export function SwapList({ swaps, t0, mode, ctrl, highlight, m, solUsd, supply }: { swaps: Swap[]; t0: number; mode: DataMode; ctrl: PlayerController; highlight: string | null; m?: WindowMetrics; solUsd?: number | null; supply?: number }) {
  const mc = (p: number) => (solUsd && supply ? fmtUsd(p * supply * solUsd) : fmtPrice(p));
  void t0;
  const first = new Set(m?.firstTimeBuyerSwaps.map((s) => s.id));
  const top3 = new Set(m?.top3.map((w) => w.wallet));
  const largestId = m?.largest?.id;
  return (
    <div className="trades with-mc" role="table" aria-label="Trades">
      <div className="trades-head" role="row">
        <span role="columnheader">Time</span>
        <span role="columnheader">Side</span>
        <span role="columnheader" className="r">Amount</span>
        <span role="columnheader" className="r">MC</span>
        <span role="columnheader">Wallet</span>
        <span role="columnheader" className="sr-only">Proof</span>
      </div>
      {swaps.slice(0, 400).map((s) => {
        const tags = [s.id === largestId && '🐋 biggest', first.has(s.id) && '✨ new', top3.has(s.wallet) && s.side === 'buy' && '🏆 top 3'].filter(Boolean) as string[];
        return (
          <div key={s.id} role="row" className={`trade${s.id === highlight ? ' hl' : ''}`} onClick={() => ctrl.highlightSwap(s.id)} title={`${fmtSol(s.sol)} SOL · slot ${s.slot} · click to show it on the chart`}>
            <span className="t-time mono">{fmtClock(s.chainTime)}</span>
            <span className={`t-side ${s.side}`}>{s.side === 'buy' ? '▲ Buy' : '▽ Sell'}</span>
            <span className={`t-amt${solUsd && s.sol * solUsd >= 1000 ? " big" : ""}`}>{money(s.sol, solUsd ?? null)}</span>
            <span className="t-mc">{mc(s.priceSol)}</span>
            <span className="t-wallet">
              <button type="button" className="wlink mono" onClick={(e) => (e.stopPropagation(), ctrl.set({ wallet: s.wallet }))} title="Open this wallet">{short(s.wallet)}</button>
              {tags.map((t) => (
                <span key={t} className={`t-tag${t.includes('biggest') ? ' a' : ''}`}>{t}</span>
              ))}
            </span>
            <span className="t-proof" onClick={(e) => e.stopPropagation()}>
              <TxLink sig={s.signature} mode={mode} icon />
            </span>
          </div>
        );
      })}
      {swaps.length > 400 && <p className="muted small pad">+ {swaps.length - 400} more — select a shorter moment</p>}
      {swaps.length === 0 && <p className="muted small pad">No trades in this moment.</p>}
    </div>
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
