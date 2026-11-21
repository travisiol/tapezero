import type { Side, Swap, SwapLeg } from './types.ts';

/** Total order known on-chain: chain second, then slot, then event index, then signature (tie-break, not time). */
export function cmpLeg(a: { chainTime: number; slot: number; evIndex: number; signature: string }, b: typeof a): number {
  return a.chainTime - b.chainTime || a.slot - b.slot || a.signature.localeCompare(b.signature) || a.evIndex - b.evIndex;
}

const econKey = (l: SwapLeg) => `${l.signature}|${l.wallet}|${l.side}|${l.mint}`;

/**
 * Ordered, de-duplicated swap series for one mint.
 * - Legs are idempotent by id (stream + backfill + reconnect never duplicate).
 * - Legs of one tx / wallet / direction merge into one economic swap (routes).
 * - Layout time `tl` spreads events inside a chain second evenly. It is a drawing aid only:
 *   labels never show sub-second precision.
 */
export class SwapSeries {
  readonly mint: string;
  swaps: Swap[] = [];
  private legIds = new Set<string>();
  private byEcon = new Map<string, Swap>();
  version = 0;
  duplicatesDropped = 0;
  lastReceivedAt = 0;
  maxSeq = 0;

  constructor(mint: string) {
    this.mint = mint;
  }

  get size() {
    return this.swaps.length;
  }
  get first(): Swap | undefined {
    return this.swaps[0];
  }
  get last(): Swap | undefined {
    return this.swaps[this.swaps.length - 1];
  }
  /** Live edge = layout time of the latest known event. */
  get liveEdge(): number {
    const l = this.last;
    return l ? l.tl : 0;
  }
  get start(): number {
    const f = this.first;
    return f ? f.tl : 0;
  }

  hasLeg(id: string) {
    return this.legIds.has(id);
  }

  /** Add legs; returns number of NEW legs. */
  add(legs: SwapLeg[], receivedAt: number): number {
    let added = 0;
    let minDirtySec = Infinity;
    let appendOnly = true;
    for (const leg of legs) {
      if (leg.mint !== this.mint) continue;
      if (this.legIds.has(leg.id)) {
        this.duplicatesDropped++;
        continue;
      }
      this.legIds.add(leg.id);
      if (leg.seq > this.maxSeq) this.maxSeq = leg.seq;
      added++;
      const key = econKey(leg);
      const ex = this.byEcon.get(key);
      if (ex) {
        ex.sol += leg.sol;
        ex.tokens += leg.tokens;
        ex.legs += 1;
        ex.legIds.push(leg.id);
        if (leg.evIndex > ex.evIndex) {
          ex.priceSol = leg.priceSol;
          ex.reserveSol = leg.reserveSol;
        }
        continue;
      }
      const s: Swap = { ...leg, legs: 1, legIds: [leg.id], tl: leg.chainTime * 1000, rank: 0, receivedAt };
      this.byEcon.set(key, s);
      const last = this.last;
      if (!last || cmpLeg(last, s) <= 0) {
        this.swaps.push(s);
      } else {
        appendOnly = false;
        // binary insert (backfill / out of order)
        let lo = 0,
          hi = this.swaps.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cmpLeg(this.swaps[mid], s) <= 0) lo = mid + 1;
          else hi = mid;
        }
        this.swaps.splice(lo, 0, s);
      }
      if (leg.chainTime < minDirtySec) minDirtySec = leg.chainTime;
    }
    if (added) {
      this.lastReceivedAt = receivedAt;
      this.relayout(minDirtySec, appendOnly);
      this.version++;
    }
    return added;
  }

  private relayout(fromSec: number, appendOnly: boolean) {
    const a = this.swaps;
    // find first index of fromSec
    let i = appendOnly ? Math.max(0, a.length - 1) : 0;
    if (appendOnly) {
      while (i > 0 && a[i - 1].chainTime >= fromSec) i--;
    } else {
      while (i < a.length && a[i].chainTime < fromSec) i++;
    }
    while (i < a.length) {
      const sec = a[i].chainTime;
      let j = i;
      while (j < a.length && a[j].chainTime === sec) j++;
      const n = j - i;
      for (let k = i; k < j; k++) {
        a[k].tl = sec * 1000 + Math.round(((k - i + 0.5) / n) * 1000);
        a[k].rank = k;
      }
      i = j;
    }
    if (!appendOnly) for (let k = 0; k < a.length; k++) a[k].rank = k;
  }

  /** Index of the last swap with tl <= t (or -1). */
  indexAt(t: number): number {
    const a = this.swaps;
    let lo = 0,
      hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid].tl <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  /** Swaps with a <= tl <= b. */
  range(a: number, b: number): Swap[] {
    if (b < a) [a, b] = [b, a];
    const i0 = this.indexAt(a - 0.0001) + 1;
    const i1 = this.indexAt(b);
    return this.swaps.slice(i0, i1 + 1);
  }

  priceAt(t: number): number | null {
    const i = this.indexAt(t);
    return i >= 0 ? this.swaps[i].priceSol : null;
  }

  byId(idOrSig: string): Swap | undefined {
    const q = idOrSig.trim();
    if (!q) return undefined;
    return this.swaps.find((s) => s.id === q || s.signature === q || s.legIds.includes(q)) ??
      (q.length >= 6 ? this.swaps.find((s) => s.signature.startsWith(q)) : undefined);
  }

  /** Copy limited to events available at time t (Blind Replay must not see the future). */
  cutoff(t: number): Swap[] {
    return this.swaps.slice(0, this.indexAt(t) + 1);
  }
}

export interface Candle {
  t0: number;
  t1: number;
  open: number;
  high: number;
  low: number;
  close: number;
  buySol: number;
  sellSol: number;
  count: number;
  i0: number;
  i1: number; // swap index range (inclusive)
}

/** Candles over [from,to] with bucket size `ms`, aligned to the absolute clock. Open = previous close. */
export function buildCandles(series: SwapSeries, from: number, to: number, ms: number, upTo = Infinity): Candle[] {
  const out: Candle[] = [];
  const a = series.swaps;
  if (!a.length) return out;
  const start = Math.floor(from / ms) * ms;
  let i = Math.max(0, series.indexAt(start - 0.0001) + 1);
  let prevClose = i > 0 ? a[i - 1].priceSol : a[0].priceSol;
  for (let t0 = start; t0 < to; t0 += ms) {
    const t1 = t0 + ms;
    const c: Candle = { t0, t1, open: prevClose, high: prevClose, low: prevClose, close: prevClose, buySol: 0, sellSol: 0, count: 0, i0: i, i1: i - 1 };
    while (i < a.length && a[i].tl < t1 && a[i].tl <= upTo) {
      const s = a[i];
      if (s.priceSol > c.high) c.high = s.priceSol;
      if (s.priceSol < c.low) c.low = s.priceSol;
      c.close = s.priceSol;
      if (s.side === 'buy') c.buySol += s.sol;
      else c.sellSol += s.sol;
      c.count++;
      c.i1 = i;
      i++;
    }
    prevClose = c.close;
    if (t0 > upTo) break;
    out.push(c);
  }
  return out;
}

export const BUCKETS = [1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000];
export function pickBucket(spanMs: number, targetCandles = 70): number {
  for (const b of BUCKETS) if (spanMs / b <= targetCandles) return b;
  return BUCKETS[BUCKETS.length - 1];
}

export const sideLabel = (s: Side) => (s === 'buy' ? 'BUY' : 'SELL');
