// Plain-language reading of a window, generated from structured facts (no model, no verdict).
import type { WindowMetrics } from './metrics.ts';
import type { MetricFilter } from './player.ts';
import { short } from './format.ts';

export interface Sentence {
  text: string;
  filter: MetricFilter | null; // clicking the sentence highlights these swaps
  tone?: 'up' | 'down' | 'neutral';
}

export const usd = (x: number | null) => (x == null ? '' : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e4 ? `$${(x / 1e3).toFixed(0)}k` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}k` : `$${x.toFixed(0)}`);
const sol = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const secs = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`;
};

/** Money in dollars when a dated SOL/USD exists, SOL otherwise. */
export const money = (solAmount: number, solUsd: number | null) => (solUsd ? usd(solAmount * solUsd) : `${sol(solAmount)} SOL`);

export function summarize(m: WindowMetrics, solUsd: number | null): Sentence[] {
  const out: Sentence[] = [];
  if (!m.count) return [{ text: `No trade in these ${secs(m.b - m.a)}.`, filter: null }];
  if (m.changePct != null) {
    const mc = m.fdvStart.usd != null && m.fdvEnd.usd != null ? ` — market cap ${usd(m.fdvStart.usd)} → ${usd(m.fdvEnd.usd)}` : '';
    out.push({ text: `Price ${m.changePct >= 0 ? '+' : '−'}${Math.abs(m.changePct).toFixed(0)}% in ${secs(m.b - m.a)}${mc}.`, filter: null, tone: m.changePct >= 0 ? 'up' : 'down' });
  }
  const n = m.distinctBuyers.length;
  out.push({ text: `${n} wallet${n === 1 ? '' : 's'} bought for ${money(m.buySol, solUsd)}. Sellers took out ${money(m.sellSol, solUsd)}.`, filter: 'buys' });
  if (m.largestBuyShare.value != null && m.buys.length > 1) {
    out.push({ text: `Biggest buy: ${money(m.largestBuyShare.numerator, solUsd)}, ${pct(m.largestBuyShare.value)} of all the buying.`, filter: 'largestBuy' });
  }
  if (m.top3Share.value != null && n > 3) {
    out.push({ text: `The 3 biggest buyers did ${pct(m.top3Share.value)} of the buying.`, filter: 'top3' });
  }
  if (m.earlySellers.length) {
    out.push({ text: `${m.earlySellers.length} of the very first buyers sold here.`, filter: 'earlySellers', tone: 'down' });
  } else if (m.clusters.length) {
    const c = m.clusters[0];
    out.push({ text: `${c.wallets.length} buyers were funded by the same wallet (${short(c.funder)}). A hint, not proof.`, filter: 'clusters' });
  }
  return out;
}

/** One-line definitions shown next to every metric. */
export const DEFINITIONS: Record<string, string> = {
  swaps: 'Every buy and sell in the selected time range.',
  bought: 'Money spent by buyers in the range. Net = bought − sold.',
  sold: 'Money received by sellers in the range.',
  largest: 'The single biggest trade, buy or sell.',
  buyers: 'Different wallets that bought. One person can own several wallets.',
  largestBuy: 'Biggest single buy ÷ all buying in the range.',
  top3: 'What the 3 biggest buying wallets spent ÷ all buying.',
  early: 'Wallets among the first 20 buyers of the token that sold in this range.',
  funding: 'Wallets whose first SOL came from the same address. A hint, not proof of control.',
  price: 'Price per token, read from the pool after each trade.',
  mcap: 'Price × total supply, in dollars at that minute.',
};
