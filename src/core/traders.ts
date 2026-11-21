// What a trader wants to know at any point of the replay — always "as of the playhead",
// so rewinding shows what was knowable at that moment, never what came after.
import type { Swap } from './types.ts';
import { EARLY_BUYERS_N } from './metrics.ts';

export interface Trader {
  wallet: string;
  trades: number;
  buys: number;
  sells: number;
  boughtSol: number;
  soldSol: number;
  /** Tokens bought in the replay and still held (average-cost accounting). */
  held: number;
  /** SOL paid for the tokens still held. */
  costHeld: number;
  /** Profit on tokens both bought and sold in the replay. */
  realizedSol: number;
  /** Sold tokens that were bought before the replay starts: no known cost, kept apart. */
  preSoldTokens: number;
  preSoldSol: number;
  /** Value of the held tokens at the current price minus what they cost. */
  unrealizedSol: number;
  pnlSol: number;
  firstAt: number; // tl ms
  lastAt: number;
  earlyRank: number | null;
}

export interface TraderBook {
  upto: number; // number of swaps included
  price: number | null;
  traders: Trader[];
  inProfit: number;
  inLoss: number;
  /** Share of supply held by the 10 biggest net buyers of the replay. */
  top10Share: number | null;
  top10Tokens: number;
}

/** Per-wallet book from swaps[0..end). Average cost: a sell releases cost in proportion to the tokens sold. */
export function traderBook(swaps: Swap[], end: number, supply: number): TraderBook {
  const m = new Map<string, Trader>();
  let early = 0;
  const n = Math.max(0, Math.min(end, swaps.length));
  for (let i = 0; i < n; i++) {
    const s = swaps[i];
    let t = m.get(s.wallet);
    if (!t) {
      t = { wallet: s.wallet, trades: 0, buys: 0, sells: 0, boughtSol: 0, soldSol: 0, held: 0, costHeld: 0, realizedSol: 0, preSoldTokens: 0, preSoldSol: 0, unrealizedSol: 0, pnlSol: 0, firstAt: s.tl, lastAt: s.tl, earlyRank: null };
      m.set(s.wallet, t);
    }
    t.trades++;
    t.lastAt = s.tl;
    if (s.side === 'buy') {
      if (t.buys === 0 && early < EARLY_BUYERS_N) t.earlyRank = ++early;
      t.buys++;
      t.boughtSol += s.sol;
      t.held += s.tokens;
      t.costHeld += s.sol;
    } else {
      t.sells++;
      t.soldSol += s.sol;
      const matched = Math.min(s.tokens, t.held);
      const k = s.tokens > 0 ? matched / s.tokens : 0;
      if (matched > 0) {
        const cost = t.costHeld * (matched / t.held);
        t.realizedSol += s.sol * k - cost;
        t.costHeld -= cost;
        t.held -= matched;
        if (t.held < 1e-9) (t.held = 0), (t.costHeld = 0);
      }
      if (k < 1) {
        t.preSoldTokens += s.tokens - matched;
        t.preSoldSol += s.sol * (1 - k);
      }
    }
  }
  const price = n ? swaps[n - 1].priceSol : null;
  let inProfit = 0;
  let inLoss = 0;
  const traders = [...m.values()];
  for (const t of traders) {
    t.unrealizedSol = price != null ? t.held * price - t.costHeld : 0;
    t.pnlSol = t.realizedSol + t.unrealizedSol;
    if (t.buys === 0) continue; // only sold tokens from before the replay: no PnL to judge
    if (t.pnlSol > 0) inProfit++;
    else if (t.pnlSol < 0) inLoss++;
  }
  const top10Tokens = [...traders]
    .sort((a, b) => b.held - a.held)
    .slice(0, 10)
    .reduce((x, t) => x + t.held, 0);
  return { upto: n, price, traders, inProfit, inLoss, top10Share: supply > 0 ? top10Tokens / supply : null, top10Tokens };
}

export type TraderSort = 'pnl' | 'bought' | 'held' | 'trades';
export function sortTraders(ts: Trader[], by: TraderSort): Trader[] {
  const key: Record<TraderSort, (t: Trader) => number> = {
    pnl: (t) => t.pnlSol,
    bought: (t) => t.boughtSol,
    held: (t) => t.held,
    trades: (t) => t.trades,
  };
  const f = key[by];
  return [...ts].sort((a, b) => f(b) - f(a));
}

// ───────────────────────── the strip above the chart ─────────────────────────

export interface Prefix {
  /** ath[i] = highest price over swaps[0..i]. */
  ath: Float64Array;
  athAt: Int32Array;
  /** traders[i] = distinct wallets over swaps[0..i]. */
  traders: Int32Array;
}

export function prefixes(swaps: Swap[]): Prefix {
  const n = swaps.length;
  const ath = new Float64Array(n);
  const athAt = new Int32Array(n);
  const traders = new Int32Array(n);
  const seen = new Set<string>();
  let best = -Infinity;
  let bi = 0;
  for (let i = 0; i < n; i++) {
    if (swaps[i].priceSol > best) (best = swaps[i].priceSol), (bi = i);
    ath[i] = best;
    athAt[i] = bi;
    seen.add(swaps[i].wallet);
    traders[i] = seen.size;
  }
  return { ath, athAt, traders };
}

export interface Pulse {
  price: number;
  firstPrice: number;
  ath: number;
  athAt: number; // tl
  fromAth: number; // 0..1 below the high
  traders: number;
  /** Last `windowMs` of trading before the playhead. */
  windowMs: number;
  buySol: number;
  sellSol: number;
  buys: number;
  sells: number;
  buyers: number;
  sellers: number;
}

/** State of the launch at swap index i (the last trade at or before the playhead). */
export function pulseAt(swaps: Swap[], p: Prefix, i: number, windowMs = 60_000): Pulse | null {
  if (i < 0 || i >= swaps.length) return null;
  const s = swaps[i];
  let buySol = 0,
    sellSol = 0,
    buys = 0,
    sells = 0;
  const buyers = new Set<string>();
  const sellers = new Set<string>();
  for (let j = i; j >= 0 && swaps[j].tl > s.tl - windowMs; j--) {
    const x = swaps[j];
    if (x.side === 'buy') (buySol += x.sol), buys++, buyers.add(x.wallet);
    else (sellSol += x.sol), sells++, sellers.add(x.wallet);
  }
  return {
    price: s.priceSol,
    firstPrice: swaps[0].priceSol,
    ath: p.ath[i],
    athAt: swaps[p.athAt[i]].tl,
    fromAth: p.ath[i] > 0 ? 1 - s.priceSol / p.ath[i] : 0,
    traders: p.traders[i],
    windowMs,
    buySol,
    sellSol,
    buys,
    sells,
    buyers: buyers.size,
    sellers: sellers.size,
  };
}
