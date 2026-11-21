// Trader-facing views, always "as of the playhead": rewind and every number goes back in time with you.
import { useMemo, useRef, useState } from 'react';
import type { PlayerController } from '../../core/player.ts';
import type { DataMode, Swap } from '../../core/types.ts';
import { SOL_EXPLORER_ADDR, SOL_EXPLORER_TOKEN, SOL_EXPLORER_TX } from '../../core/types.ts';
import { fmtClock, fmtDur, fmtUsd, short } from '../../core/format.ts';
import { money } from '../../core/summary.ts';
import { prefixes, pulseAt, sortTraders, traderBook, type Trader, type TraderBook, type TraderSort } from '../../core/traders.ts';
import type { SwapSeries } from '../../core/series.ts';
import { copyText } from '../util.ts';
import { TokenLogo } from '../TokenLogo.tsx';

const signed = (sol: number, solUsd: number | null) => (sol >= 0 ? '+' : '−') + money(Math.abs(sol), solUsd);
const pctTxt = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x) >= 100 ? Math.round(Math.abs(x)).toLocaleString('en-US') : Math.abs(x).toFixed(1)}%`;

/** A number that flashes green/pink when it changes. */
function Tick({ v, text, className }: { v: number; text: string; className?: string }) {
  const prev = useRef(v);
  const dir = v > prev.current ? 'up' : v < prev.current ? 'down' : '';
  prev.current = v;
  return (
    <b key={text} className={`tick ${dir ? 'flash-' + dir : ''} ${className ?? ''}`}>
      {text}
    </b>
  );
}

/** Stable color per wallet, so the same trader is recognisable everywhere. */
export function walletHue(w: string) {
  let h = 0;
  for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) >>> 0;
  return h % 360;
}
export function WalletDot({ w }: { w: string }) {
  const h = walletHue(w);
  return <span className="wdot" style={{ background: `conic-gradient(hsl(${h} 85% 68%), hsl(${(h + 70) % 360} 85% 60%), hsl(${h} 85% 68%))` }} aria-hidden="true" />;
}

// ───────────────────────── header ─────────────────────────

export function TokenHeader({ name, symbol, mint, uri, sub, badge, mcap, changePct, mode, children }: { name: string; symbol: string; mint: string; uri?: string | null; sub: string; badge?: string; mcap: number | null; changePct: number | null; mode: DataMode; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(mint);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="thead">
      <div className="thead-id">
        <TokenLogo mint={mint} uri={uri} label={symbol || name} size={50} className="logo-glow" />
        <div className="thead-txt">
          <h1 className="thead-name">
            {name} <span className="thead-sym">${symbol}</span>
            {badge && <span className="badge-real">{badge}</span>}
          </h1>
          <p className="thead-sub">
            <span>{sub}</span>
            <button type="button" className="chip" onClick={copy} title="Copy the contract address">
              {copied ? 'Copied ✓' : <>CA {short(mint, 4)} <span aria-hidden="true">⧉</span></>}
            </button>
            {mode !== 'demo' && (
              <a className="chip" href={SOL_EXPLORER_TOKEN(mint)} target="_blank" rel="noreferrer noopener">
                Solscan ↗
              </a>
            )}
          </p>
        </div>
      </div>
      <div className="thead-mc">
        <span className="thead-mc-label">Market cap</span>
        <span className="thead-mc-val">{mcap != null ? <Tick v={mcap} text={fmtUsd(mcap)} /> : '—'}</span>
        {changePct != null && <span className={`chg ${changePct >= 0 ? 'up' : 'down'}`}>{pctTxt(changePct)}</span>}
      </div>
      {children}
    </div>
  );
}

// ───────────────────────── pulse strip ─────────────────────────

export function usePulse(series: SwapSeries, playhead: number) {
  const sv = series.version;
  const pre = useMemo(() => prefixes(series.swaps), [series, sv]);
  const i = series.indexAt(playhead);
  return useMemo(() => pulseAt(series.swaps, pre, i), [pre, i]);
}

export function PulseStrip({ series, playhead, supply, solUsd, book }: { series: SwapSeries; playhead: number; supply: number; solUsd: number | null; book: TraderBook }) {
  const p = usePulse(series, playhead);
  if (!p) return null;
  const mc = (price: number) => (solUsd ? price * supply * solUsd : null);
  const atAth = p.fromAth < 0.005;
  const flow = p.buySol + p.sellSol;
  const buyPct = flow > 0 ? (p.buySol / flow) * 100 : 50;
  const net = p.buySol - p.sellSol;
  const judged = book.inProfit + book.inLoss;
  return (
    <div className="pulse" aria-label="State of the launch at the playhead">
      <div className="pc">
        <span className="pc-l">ATH</span>
        <span className="pc-v">{fmtUsd(mc(p.ath))}</span>
        <span className={`pc-s ${atAth ? 'hot' : 'down'}`}>{atAth ? '🔥 at the high' : `${pctTxt(-p.fromAth * 100)} from ATH`}</span>
      </div>
      <div className="pc pc-flow">
        <span className="pc-l">Net flow · 1m</span>
        <span className="pc-v">
          <Tick v={net} text={signed(net, solUsd)} className={net >= 0 ? 'up' : 'down'} />
        </span>
        <span className="flowbar" role="img" aria-label={`${Math.round(buyPct)}% of the volume was buying`}>
          <i style={{ width: `${buyPct}%` }} />
        </span>
        <span className="pc-s">
          <span className="up">{money(p.buySol, solUsd)}</span> in · <span className="down">{money(p.sellSol, solUsd)}</span> out
        </span>
      </div>
      <div className="pc">
        <span className="pc-l">Buyers · sellers 1m</span>
        <span className="pc-v">
          <span className="up">{p.buyers}</span> <span className="pc-unit">vs</span> <span className="down">{p.sellers}</span>
        </span>
        <span className="pc-s">{p.buys + p.sells} trades</span>
      </div>
      <div className="pc">
        <span className="pc-l">Wallets</span>
        <span className="pc-v">
          <Tick v={p.traders} text={p.traders.toLocaleString('en-US')} />
        </span>
        <span className="pc-s">{judged ? <><b className="up">{Math.round((book.inProfit / judged) * 100)}%</b> in profit</> : 'no buyer yet'}</span>
      </div>
      <div className="pc">
        <span className="pc-l">Top 10 hold</span>
        <span className="pc-v">{book.top10Share != null ? `${(book.top10Share * 100).toFixed(1)}%` : '—'}</span>
        <span className="pc-s" title="Share of supply held by the 10 biggest buyers of this replay (tokens bought here)">of supply</span>
      </div>
    </div>
  );
}

// ───────────────────────── tags ─────────────────────────

export interface Tag {
  k: string;
  label: string;
  title: string;
}
export function traderTags(t: Trader, supply: number): Tag[] {
  const out: Tag[] = [];
  if (t.earlyRank) out.push({ k: 'early', label: `🎯 early #${t.earlyRank}`, title: `One of the first 20 buyers of the replay (#${t.earlyRank})` });
  if (t.held / supply >= 0.01 || t.boughtSol >= 60) out.push({ k: 'whale', label: '🐋 whale', title: 'Bought 60+ SOL in the replay, or holds 1%+ of the supply' });
  if (t.trades >= 20) out.push({ k: 'bot', label: '🤖 20+ trades', title: '20 trades or more in the replay: often a trading bot' });
  if (t.buys > 0 && t.sells === 0) out.push({ k: 'diamond', label: '💎 never sold', title: 'Bought and has not sold anything yet' });
  else if (t.buys > 0 && t.held === 0) out.push({ k: 'out', label: '🧻 sold it all', title: 'Sold everything bought in the replay' });
  if (t.preSoldSol > 0 && t.buys === 0) out.push({ k: 'bag', label: '📦 older bag', title: 'Sold tokens bought before this replay starts' });
  return out;
}

// ───────────────────────── top traders ─────────────────────────

const SORTS: [TraderSort, string][] = [
  ['pnl', '💰 PnL'],
  ['bought', '🛒 Bought'],
  ['held', '💎 Holding'],
  ['trades', '⚡ Trades'],
];

export function TradersPanel({ book, ctrl, solUsd, supply, playhead }: { book: TraderBook; ctrl: PlayerController; solUsd: number | null; supply: number; playhead: number }) {
  const [by, setBy] = useState<TraderSort>('pnl');
  const rows = useMemo(() => sortTraders(by === 'pnl' ? book.traders.filter((t) => t.buys > 0) : book.traders, by).slice(0, 60), [book, by]);
  const judged = book.inProfit + book.inLoss;
  const best = rows[0];
  return (
    <div className="panel-body">
      <p className="panel-kicker">As of {fmtClock(playhead / 1000)} UTC · rewind and this list goes back in time</p>
      <div className="score-row">
        <div className="score up">
          <b>{book.inProfit.toLocaleString('en-US')}</b>
          <span>buyers in profit</span>
        </div>
        <div className="score down">
          <b>{book.inLoss.toLocaleString('en-US')}</b>
          <span>in loss</span>
        </div>
        <div className="score">
          <b>{judged ? `${Math.round((book.inProfit / judged) * 100)}%` : '—'}</b>
          <span>win rate</span>
        </div>
      </div>
      <div className="seg seg-pill" role="group" aria-label="Sort traders">
        {SORTS.map(([k, l]) => (
          <button key={k} type="button" className={by === k ? 'on' : ''} aria-pressed={by === k} onClick={() => setBy(k)}>
            {l}
          </button>
        ))}
      </div>
      <ol className="lb" aria-label="Top traders">
        {rows.map((t, i) => {
          const tags = traderTags(t, supply);
          const main = by === 'pnl' ? signed(t.pnlSol, solUsd) : by === 'bought' ? money(t.boughtSol, solUsd) : by === 'held' ? `${((t.held / supply) * 100).toFixed(2)}%` : String(t.trades);
          const tone = by === 'pnl' ? (t.pnlSol >= 0 ? 'up' : 'down') : '';
          const roi = t.boughtSol > 0 ? (t.pnlSol / t.boughtSol) * 100 : null;
          return (
            <li key={t.wallet}>
              <button type="button" className="lb-row" onClick={() => ctrl.set({ wallet: t.wallet })} title="Open this wallet: its trades show on the chart">
                <span className={`lb-rank${i < 3 ? ' top' : ''}`}>{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
                <span className="lb-who">
                  <span className="lb-w">
                    <WalletDot w={t.wallet} />
                    <span className="mono">{short(t.wallet)}</span>
                  </span>
                  <span className="lb-tags">
                    {tags.slice(0, 2).map((g) => (
                      <span key={g.k} className={`ttag ttag-${g.k}`} title={g.title}>
                        {g.label}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="lb-num">
                  <b className={tone}>{main}</b>
                  <span className="lb-sub">
                    {by === 'pnl' && roi != null ? `${pctTxt(roi)} · ` : ''}
                    {money(t.boughtSol, solUsd)} in · {t.trades} tx
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {!rows.length && <li className="muted small pad">No trade yet at this point of the replay.</li>}
      </ol>
      {best && (
        <p className="fine">
          PnL = what each wallet made on tokens bought during this replay (sold + still held at the current price). Tokens bought before the replay have no known cost and are left out.
        </p>
      )}
    </div>
  );
}

// ───────────────────────── one wallet ─────────────────────────

export function WalletPanel({ wallet, book, swaps, ctrl, solUsd, supply, mode, playhead }: { wallet: string; book: TraderBook; swaps: Swap[]; ctrl: PlayerController; solUsd: number | null; supply: number; mode: DataMode; playhead: number }) {
  const t = book.traders.find((x) => x.wallet === wallet);
  const mine = useMemo(() => swaps.filter((s) => s.wallet === wallet), [swaps, wallet]);
  const later = mine.filter((s) => s.tl > playhead).length;
  const [copied, setCopied] = useState(false);
  const mc = (price: number) => (solUsd ? price * supply * solUsd : null);
  const tags = t ? traderTags(t, supply) : [];
  const avgEntry = t && t.held > 0 ? t.costHeld / t.held : t && t.boughtSol > 0 ? null : null;
  const firstBuy = mine.find((s) => s.side === 'buy' && s.tl <= playhead);
  return (
    <div className="panel-body">
      <div className="wp-head">
        <button type="button" className="btn btn-ghost btn-s" onClick={() => ctrl.set({ wallet: null })}>
          ← Back
        </button>
        <span className="small muted">As of {fmtClock(playhead / 1000)} UTC</span>
      </div>
      <div className="wp-id">
        <WalletDot w={wallet} />
        <span className="mono wp-addr">{short(wallet, 6)}</span>
        <button
          type="button"
          className="chip"
          onClick={async () => {
            await copyText(wallet);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? 'Copied ✓' : 'Copy ⧉'}
        </button>
        {mode !== 'demo' && (
          <a className="chip" href={SOL_EXPLORER_ADDR(wallet)} target="_blank" rel="noreferrer noopener">
            Solscan ↗
          </a>
        )}
      </div>
      {tags.length > 0 && (
        <div className="lb-tags wp-tags">
          {tags.map((g) => (
            <span key={g.k} className={`ttag ttag-${g.k}`} title={g.title}>
              {g.label}
            </span>
          ))}
        </div>
      )}
      {!t ? (
        <p className="hint">This wallet has not traded yet at this point of the replay{later ? ` — its first trade comes ${fmtDur(mine[0].tl - playhead)} later` : ''}.</p>
      ) : (
        <>
          <div className={`wp-pnl ${t.pnlSol >= 0 ? 'up' : 'down'}`}>
            <span className="wp-pnl-l">{t.buys ? 'PnL on this launch' : 'Sold from an older bag'}</span>
            <b>{t.buys ? signed(t.pnlSol, solUsd) : money(t.preSoldSol, solUsd)}</b>
            {t.buys > 0 && t.boughtSol > 0 && <span className="chg">{pctTxt((t.pnlSol / t.boughtSol) * 100)}</span>}
          </div>
          <div className="keys">
            <div className="key static">
              <span className="key-label">Bought</span>
              <span className="key-value mono">{money(t.boughtSol, solUsd)}</span>
              <span className="key-sub">{t.buys} buys</span>
            </div>
            <div className="key static">
              <span className="key-label">Sold</span>
              <span className="key-value mono">{money(t.soldSol, solUsd)}</span>
              <span className="key-sub">{t.sells} sells</span>
            </div>
            <div className="key static">
              <span className="key-label">Holding</span>
              <span className="key-value mono">{book.price != null ? money(t.held * book.price, solUsd) : '—'}</span>
              <span className="key-sub">{((t.held / supply) * 100).toFixed(2)}% of supply</span>
            </div>
            <div className="key static">
              <span className="key-label">Avg entry</span>
              <span className="key-value mono">{avgEntry != null ? fmtUsd(mc(avgEntry)) : firstBuy ? fmtUsd(mc(firstBuy.priceSol)) : '—'}</span>
              <span className="key-sub">{avgEntry != null ? 'market cap paid, on average' : firstBuy ? 'market cap at first buy' : 'no buy in the replay'}</span>
            </div>
          </div>
          {firstBuy && (
            <p className="wp-line">
              First buy at <b>{fmtClock(firstBuy.chainTime)}</b> for <b>{money(firstBuy.sol, solUsd)}</b> at <b>{fmtUsd(mc(firstBuy.priceSol))}</b> market cap.
            </p>
          )}
        </>
      )}
      <section className="sub">
        <h4>
          Its trades <span className="muted">· shown on the chart</span>
        </h4>
        <div className="trades wtrades" role="table" aria-label="Trades of this wallet">
          <div className="trades-head" role="row">
            <span role="columnheader">Time</span>
            <span role="columnheader">Side</span>
            <span role="columnheader" className="r">Amount</span>
            <span role="columnheader" className="r">MC</span>
            <span role="columnheader" className="sr-only">Proof</span>
          </div>
          {mine.slice(0, 300).map((s) => (
            <div key={s.id} role="row" className={`trade${s.tl > playhead ? ' later' : ''}`} onClick={() => ctrl.highlightSwap(s.id)} title={s.tl > playhead ? 'After the playhead' : 'Show it on the chart'}>
              <span className="t-time mono">{fmtClock(s.chainTime)}</span>
              <span className={`t-side ${s.side}`}>{s.side === 'buy' ? '▲ Buy' : '▽ Sell'}</span>
              <span className="t-amt">{money(s.sol, solUsd)}</span>
              <span className="t-mc">{fmtUsd(mc(s.priceSol))}</span>
              <span className="t-proof" onClick={(e) => e.stopPropagation()}>
                {mode !== 'demo' && (
                  <a className="txlink" href={SOL_EXPLORER_TX(s.signature)} target="_blank" rel="noreferrer noopener" aria-label="Verify on Solscan" title="Verify on Solscan">
                    ↗
                  </a>
                )}
              </span>
            </div>
          ))}
        </div>
        {later > 0 && <p className="small muted pad">{later} of these trades happen after the playhead (dimmed).</p>}
      </section>
    </div>
  );
}

/** Book at the playhead, recomputed only when a trade crosses it. */
export function useBook(series: SwapSeries, playhead: number, supply: number) {
  const sv = series.version;
  const i = series.indexAt(playhead);
  return useMemo(() => traderBook(series.swaps, i + 1, supply), [series, sv, i, supply]);
}
