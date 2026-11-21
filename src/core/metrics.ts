import type { FundingEvidence, Gap, Launch, Swap, UsdRef } from './types.ts';

/** Number of first distinct buyers considered "early buyers". Shown in the UI. */
export const EARLY_BUYERS_N = 20;

export interface Share {
  value: number | null; // 0..1
  numerator: number; // SOL
  denominator: number; // SOL
  label: string;
}

export interface WalletVol {
  wallet: string;
  sol: number;
  swaps: number;
}

export interface EarlySeller {
  wallet: string;
  earlyRank: number; // 1-based rank among early buyers
  firstBuy: Swap;
  sells: Swap[];
  soldSol: number;
}

export interface FundingCluster {
  funder: string;
  wallets: string[];
  evidence: FundingEvidence[];
}

export interface UsdValue {
  usd: number | null;
  method: string;
}

export interface WindowMetrics {
  a: number;
  b: number;
  swaps: Swap[];
  count: number;
  buys: Swap[];
  sells: Swap[];
  buySol: number;
  sellSol: number;
  netSol: number;
  largest: Swap | null;
  priceStart: number | null; // last price at or before a (or first in window)
  priceEnd: number | null;
  changePct: number | null;
  fdvStart: UsdValue;
  fdvEnd: UsdValue;
  fdvStartSol: number | null;
  fdvEndSol: number | null;
  distinctBuyers: string[];
  firstTimeBuyers: string[];
  firstTimeBuyerSwaps: Swap[];
  historyTruncated: boolean;
  truncationNote: string | null;
  largestBuyShare: Share;
  top3: WalletVol[];
  top3Share: Share;
  earlySellers: EarlySeller[];
  clusters: FundingCluster[];
  gapsInWindow: Gap[];
}

export interface Ctx {
  launch: Launch;
  all: Swap[]; // full series, ordered
  gaps: Gap[];
  usd: UsdRef[];
  funding: FundingEvidence[];
  /** True when the covered history may not start at the token's first swap. */
  historyTruncated: boolean;
}

export function usdAt(usd: UsdRef[], tMs: number): UsdRef | null {
  if (!usd.length) return null;
  let best: UsdRef | null = null;
  let bd = Infinity;
  for (const r of usd) {
    const d = Math.abs(r.t - tMs);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  // Only accept a reference within 10 minutes of the event.
  return best && bd <= 10 * 60_000 ? best : null;
}

export function fdvUsd(ctx: Ctx, priceSol: number | null, tMs: number): UsdValue {
  if (priceSol == null) return { usd: null, method: 'no swap yet' };
  const ref = usdAt(ctx.usd, tMs);
  if (!ref) return { usd: null, method: 'no dated SOL/USD reference within 10 min' };
  return {
    usd: priceSol * ctx.launch.supply * ref.solUsd,
    method: `FDV = price × ${fmtSupply(ctx.launch.supply)} supply × SOL/USD ${ref.solUsd.toFixed(2)} (${ref.source}, ${new Date(ref.t).toISOString().slice(11, 19)} UTC)`,
  };
}

const fmtSupply = (n: number) => (n >= 1e9 ? `${n / 1e9}B` : n >= 1e6 ? `${n / 1e6}M` : String(n));

/** Earliest buy per wallet in the covered history. */
export function firstBuys(all: Swap[]): Map<string, Swap> {
  const m = new Map<string, Swap>();
  for (const s of all) if (s.side === 'buy' && !m.has(s.wallet)) m.set(s.wallet, s);
  return m;
}

export function earlyBuyers(all: Swap[], n = EARLY_BUYERS_N): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of all) {
    if (s.side !== 'buy' || m.has(s.wallet)) continue;
    m.set(s.wallet, m.size + 1);
    if (m.size >= n) break;
  }
  return m;
}

export function computeWindow(ctx: Ctx, a: number, b: number, swapsInWindow: Swap[]): WindowMetrics {
  if (b < a) [a, b] = [b, a];
  const swaps = swapsInWindow;
  const buys = swaps.filter((s) => s.side === 'buy');
  const sells = swaps.filter((s) => s.side === 'sell');
  const buySol = sum(buys.map((s) => s.sol));
  const sellSol = sum(sells.map((s) => s.sol));
  let largest: Swap | null = null;
  for (const s of swaps) if (!largest || s.sol > largest.sol) largest = s;

  // price at start: last swap strictly before the window, else first swap in window
  let before: Swap | null = null;
  for (const s of ctx.all) {
    if (s.tl < a) before = s;
    else break;
  }
  const priceStart = before ? before.priceSol : swaps[0]?.priceSol ?? null;
  const priceEnd = swaps.length ? swaps[swaps.length - 1].priceSol : priceStart;
  const changePct = priceStart && priceEnd ? (priceEnd / priceStart - 1) * 100 : null;

  const buyerVol = new Map<string, WalletVol>();
  for (const s of buys) {
    const w = buyerVol.get(s.wallet) ?? { wallet: s.wallet, sol: 0, swaps: 0 };
    w.sol += s.sol;
    w.swaps++;
    buyerVol.set(s.wallet, w);
  }
  const distinctBuyers = [...buyerVol.keys()];
  const fb = firstBuys(ctx.all);
  const firstTimeBuyerSwaps = buys.filter((s) => fb.get(s.wallet)?.id === s.id);
  const firstTimeBuyers = firstTimeBuyerSwaps.map((s) => s.wallet);

  const largestBuy = buys.reduce<Swap | null>((m, s) => (!m || s.sol > m.sol ? s : m), null);
  const largestBuyShare: Share = {
    value: buySol > 0 && largestBuy ? largestBuy.sol / buySol : null,
    numerator: largestBuy?.sol ?? 0,
    denominator: buySol,
    label: 'largest single buy ÷ all buy volume in window',
  };
  const top3 = [...buyerVol.values()].sort((x, y) => y.sol - x.sol).slice(0, 3);
  const top3Sol = sum(top3.map((w) => w.sol));
  const top3Share: Share = {
    value: buySol > 0 ? top3Sol / buySol : null,
    numerator: top3Sol,
    denominator: buySol,
    label: `buy volume of top ${top3.length} wallets ÷ all buy volume in window`,
  };

  const eb = earlyBuyers(ctx.all);
  const sellerMap = new Map<string, EarlySeller>();
  for (const s of sells) {
    const r = eb.get(s.wallet);
    if (!r) continue;
    const e = sellerMap.get(s.wallet) ?? { wallet: s.wallet, earlyRank: r, firstBuy: fb.get(s.wallet)!, sells: [], soldSol: 0 };
    e.sells.push(s);
    e.soldSol += s.sol;
    sellerMap.set(s.wallet, e);
  }
  const earlySellers = [...sellerMap.values()].sort((x, y) => x.earlyRank - y.earlyRank);

  // Funding clusters among wallets active in the window — evidence only.
  const active = new Set(swaps.map((s) => s.wallet));
  const byFunder = new Map<string, FundingEvidence[]>();
  for (const f of ctx.funding) {
    if (!active.has(f.wallet)) continue;
    const l = byFunder.get(f.funder) ?? [];
    l.push(f);
    byFunder.set(f.funder, l);
  }
  const clusters: FundingCluster[] = [];
  for (const [funder, ev] of byFunder) {
    const wallets = [...new Set(ev.map((e) => e.wallet))];
    if (wallets.length >= 2 || active.has(funder)) clusters.push({ funder, wallets, evidence: ev });
  }

  const gapsInWindow = ctx.gaps.filter((g) => g.toTime * 1000 >= a && g.fromTime * 1000 <= b);
  const tStartMs = before ? before.chainTime * 1000 : a;
  const supply = ctx.launch.supply;

  return {
    a,
    b,
    swaps,
    count: swaps.length,
    buys,
    sells,
    buySol,
    sellSol,
    netSol: buySol - sellSol,
    largest,
    priceStart,
    priceEnd,
    changePct,
    fdvStart: fdvUsd(ctx, priceStart, tStartMs),
    fdvEnd: fdvUsd(ctx, priceEnd, swaps.length ? swaps[swaps.length - 1].chainTime * 1000 : b),
    fdvStartSol: priceStart != null ? priceStart * supply : null,
    fdvEndSol: priceEnd != null ? priceEnd * supply : null,
    distinctBuyers,
    firstTimeBuyers,
    firstTimeBuyerSwaps,
    historyTruncated: ctx.historyTruncated,
    truncationNote: ctx.historyTruncated
      ? 'Covered history starts after the token was created: "first-time" and "early buyer" only refer to the observed history.'
      : null,
    largestBuyShare,
    top3,
    top3Share,
    earlySellers,
    clusters,
    gapsInWindow,
  };
}

// ───────────────────────── launch-level stats (archive) ─────────────────────────

export interface LaunchStats {
  mint: string;
  swaps: number;
  firstSwapAt: number | null; // chain s
  lastSwapAt: number | null;
  firstPrice: number | null;
  peakPrice: number | null;
  peakAt: number | null; // chain s
  timeToPeak: number | null; // s from first observed swap
  lastPrice: number | null;
  drawdownFromPeak: number | null; // 0..1
  fdvPeakUsd: number | null;
  fdvPeakMethod: string;
  buyersBeforePeak: number;
  topBuyerShareBeforePeak: number | null; // 0..1
  topSwapShareBeforePeak: number | null;
  buySol: number;
  sellSol: number;
  distinctBuyers: number;
  liquiditySol: number | null;
  /** Seconds after first observed swap when FDV first reached thresholdUsd (computed client-side for any threshold). */
  historyTruncated: boolean;
  gaps: number;
  usdMissing: boolean;
  /** Max FDV (USD) reached within N seconds of the first observed swap. */
  maxFdvWithin: Record<string, number | null>;
}

export const FDV_WINDOWS = [10, 20, 30, 60, 120, 300, 900];

export function launchStats(ctx: Ctx): LaunchStats {
  const all = ctx.all;
  const f = all[0];
  const l = all[all.length - 1];
  let peak: Swap | null = null;
  for (const s of all) if (!peak || s.priceSol > peak.priceSol) peak = s;
  const prePeak = peak ? all.slice(0, peak.rank + 1) : [];
  const buyVol = new Map<string, number>();
  let preBuy = 0;
  let maxSwap = 0;
  for (const s of prePeak) {
    if (s.side !== 'buy') continue;
    preBuy += s.sol;
    buyVol.set(s.wallet, (buyVol.get(s.wallet) ?? 0) + s.sol);
    if (s.sol > maxSwap) maxSwap = s.sol;
  }
  const topBuyer = Math.max(0, ...buyVol.values());
  const fdv = peak ? fdvUsd(ctx, peak.priceSol, peak.chainTime * 1000) : { usd: null, method: 'no swaps' };
  const buyers = new Set(all.filter((s) => s.side === 'buy').map((s) => s.wallet));
  return {
    mint: ctx.launch.mint,
    swaps: all.length,
    firstSwapAt: f?.chainTime ?? null,
    lastSwapAt: l?.chainTime ?? null,
    firstPrice: f?.priceSol ?? null,
    peakPrice: peak?.priceSol ?? null,
    peakAt: peak?.chainTime ?? null,
    timeToPeak: peak && f ? peak.chainTime - f.chainTime : null,
    lastPrice: l?.priceSol ?? null,
    drawdownFromPeak: peak && l ? 1 - l.priceSol / peak.priceSol : null,
    fdvPeakUsd: fdv.usd,
    fdvPeakMethod: fdv.method,
    buyersBeforePeak: buyVol.size,
    topBuyerShareBeforePeak: preBuy > 0 ? topBuyer / preBuy : null,
    topSwapShareBeforePeak: preBuy > 0 ? maxSwap / preBuy : null,
    buySol: sum(all.filter((s) => s.side === 'buy').map((s) => s.sol)),
    sellSol: sum(all.filter((s) => s.side === 'sell').map((s) => s.sol)),
    distinctBuyers: buyers.size,
    liquiditySol: l?.reserveSol ?? null,
    historyTruncated: ctx.historyTruncated,
    gaps: ctx.gaps.length,
    usdMissing: fdv.usd == null,
    maxFdvWithin: Object.fromEntries(
      FDV_WINDOWS.map((n) => {
        if (!f) return [String(n), null];
        let mx: number | null = null;
        for (const s of all) {
          if (s.chainTime - f.chainTime > n) break;
          const v = fdvUsd(ctx, s.priceSol, s.chainTime * 1000).usd;
          if (v != null && (mx == null || v > mx)) mx = v;
        }
        return [String(n), mx];
      }),
    ),
  };
}

/** First time (s after first swap) FDV reached `usd`; null if never or no valuation. */
export function timeToFdv(ctx: Ctx, usd: number): number | null {
  const f = ctx.all[0];
  if (!f) return null;
  for (const s of ctx.all) {
    const v = fdvUsd(ctx, s.priceSol, s.chainTime * 1000).usd;
    if (v != null && v >= usd) return s.chainTime - f.chainTime;
  }
  return null;
}

// ───────────────────────── compare ─────────────────────────

export interface CompareSide {
  t0: number; // tl of first observed swap
  firstIsCreation: boolean;
  windowMs: number;
  swaps: Swap[];
  normalized: { dt: number; v: number }[]; // dt ms since t0, v = price/firstPrice - 1
  peakDt: number | null;
  peakChange: number | null;
  buyersBeforePeak: number;
  topSwapShare: Share;
  topBuyerShare: Share;
  buySol: number;
  sellSol: number;
  earlySellers: number;
  earlySoldSol: number;
  liquidityEnd: number | null;
  gaps: { fromDt: number; toDt: number }[];
}

export function compareSide(ctx: Ctx, windowMs: number, upToDt = Infinity): CompareSide {
  const all = ctx.all;
  const t0 = all[0]?.tl ?? 0;
  const p0 = all[0]?.priceSol ?? 1;
  const lim = Math.min(windowMs, upToDt);
  const swaps = all.filter((s) => s.tl - t0 <= lim);
  let peak: Swap | null = null;
  for (const s of swaps) if (!peak || s.priceSol > peak.priceSol) peak = s;
  const pre = peak ? swaps.filter((s) => s.rank <= peak!.rank) : [];
  const preBuys = pre.filter((s) => s.side === 'buy');
  const preBuySol = sum(preBuys.map((s) => s.sol));
  const byW = new Map<string, number>();
  for (const s of preBuys) byW.set(s.wallet, (byW.get(s.wallet) ?? 0) + s.sol);
  const topW = Math.max(0, ...byW.values());
  const topS = Math.max(0, ...preBuys.map((s) => s.sol));
  const eb = earlyBuyers(all);
  const earlySells = swaps.filter((s) => s.side === 'sell' && eb.has(s.wallet));
  return {
    t0,
    firstIsCreation: !ctx.historyTruncated,
    windowMs,
    swaps,
    normalized: swaps.map((s) => ({ dt: s.tl - t0, v: s.priceSol / p0 - 1 })),
    peakDt: peak ? peak.tl - t0 : null,
    peakChange: peak ? peak.priceSol / p0 - 1 : null,
    buyersBeforePeak: byW.size,
    topSwapShare: { value: preBuySol ? topS / preBuySol : null, numerator: topS, denominator: preBuySol, label: 'largest buy ÷ buy volume up to peak' },
    topBuyerShare: { value: preBuySol ? topW / preBuySol : null, numerator: topW, denominator: preBuySol, label: 'top wallet buy volume ÷ buy volume up to peak' },
    buySol: sum(swaps.filter((s) => s.side === 'buy').map((s) => s.sol)),
    sellSol: sum(swaps.filter((s) => s.side === 'sell').map((s) => s.sol)),
    earlySellers: new Set(earlySells.map((s) => s.wallet)).size,
    earlySoldSol: sum(earlySells.map((s) => s.sol)),
    liquidityEnd: swaps.length ? swaps[swaps.length - 1].reserveSol : null,
    gaps: ctx.gaps.map((g) => ({ fromDt: g.fromTime * 1000 - t0, toDt: g.toTime * 1000 - t0 })).filter((g) => g.toDt >= 0 && g.fromDt <= windowMs),
  };
}

export function sum(a: number[]): number {
  let s = 0;
  for (const x of a) s += x;
  return s;
}
