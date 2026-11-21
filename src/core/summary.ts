// Plain-language reading of a window, generated from structured facts (no model, no verdict).
import type { WindowMetrics } from './metrics.ts';
import type { MetricFilter } from './player.ts';
import { short } from './format.ts';

export interface Sentence {
  text: string;
  filter: MetricFilter | null; // clicking the sentence highlights these swaps
  tone?: 'up' | 'down' | 'neutral';
}

const sol = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
export const usd = (x: number | null) => (x == null ? '' : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}k` : `$${x.toFixed(0)}`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const secs = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 120 ? `${s} seconds` : `${Math.round(s / 60)} minutes`;
};

export function summarize(m: WindowMetrics, solUsd: number | null): Sentence[] {
  const out: Sentence[] = [];
  const inUsd = (x: number) => (solUsd ? ` (≈ ${usd(x * solUsd)})` : '');
  if (!m.count) return [{ text: `No swap in these ${secs(m.b - m.a)}.`, filter: null }];
  if (m.changePct != null) {
    const dir = m.changePct >= 0 ? 'rose' : 'fell';
    const mc = m.fdvStart.usd != null && m.fdvEnd.usd != null ? ` — market cap ${usd(m.fdvStart.usd)} → ${usd(m.fdvEnd.usd)}` : '';
    out.push({ text: `In ${secs(m.b - m.a)} the price ${dir} ${Math.abs(m.changePct).toFixed(0)}%${mc}.`, filter: null, tone: m.changePct >= 0 ? 'up' : 'down' });
  }
  out.push({
    text: `${m.distinctBuyers.length} wallet${m.distinctBuyers.length === 1 ? '' : 's'} bought ${sol(m.buySol)} SOL${inUsd(m.buySol)} in ${m.buys.length} buy${m.buys.length === 1 ? '' : 's'}; ${m.sells.length} sell${m.sells.length === 1 ? '' : 's'} took out ${sol(m.sellSol)} SOL.`,
    filter: 'buys',
  });
  const lb = m.largestBuyShare;
  if (lb.value != null && m.buys.length > 1) {
    const w = m.buys.reduce((a, s) => (s.sol > a.sol ? s : a));
    out.push({ text: `The biggest single buy, ${sol(lb.numerator)} SOL by ${short(w.wallet)}, is ${pct(lb.value)} of all the buying.`, filter: 'largestBuy' });
  }
  if (m.top3Share.value != null && m.distinctBuyers.length > 3) {
    out.push({ text: `The top 3 buyers account for ${pct(m.top3Share.value)} of the buying; the other ${m.distinctBuyers.length - 3} share the rest.`, filter: 'top3' });
  }
  if (m.firstTimeBuyers.length) {
    out.push({ text: `${m.firstTimeBuyers.length} of these buyers had never bought this token before${m.historyTruncated ? ' (in the observed history)' : ''}.`, filter: 'firstTime' });
  }
  if (m.earlySellers.length) {
    out.push({ text: `${m.earlySellers.length} of the first 20 buyers sold during this window.`, filter: 'earlySellers', tone: 'down' });
  }
  for (const c of m.clusters.slice(0, 1)) {
    out.push({ text: `${c.wallets.length} active wallets received SOL from the same address (${short(c.funder)}) — a link worth checking, not proof they are one trader.`, filter: 'clusters' });
  }
  return out;
}

/** One-line definitions shown next to every metric. */
export const DEFINITIONS: Record<string, string> = {
  swaps: 'Every buy and sell in the selected time range.',
  bought: 'SOL spent by buyers in the range. Net = bought − sold.',
  sold: 'SOL received by sellers in the range.',
  largest: 'The single biggest swap, buy or sell.',
  buyers: 'Different wallet addresses that bought. One person can control several addresses.',
  largestBuy: 'Biggest single buy divided by all buy volume in the range.',
  top3: 'Buy volume of the 3 biggest buying wallets divided by all buy volume.',
  early: 'Wallets among the first 20 buyers of the token that sold in this range.',
  funding: 'Wallets whose first SOL came from the same address. A hint, not proof of control.',
  price: 'Price per token in SOL, read from the pool reserves after each swap.',
  mcap: 'Price × total supply × SOL/USD at that minute (fully diluted market cap).',
};
