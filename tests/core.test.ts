import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_SCRIPTS, demoBundle } from '../src/core/demo.ts';
import { SwapSeries } from '../src/core/series.ts';
import { makeCtx, seriesFromBundle } from '../src/core/context.ts';
import { computeWindow, launchStats, compareSide, timeToFdv } from '../src/core/metrics.ts';
import type { SwapLeg } from '../src/core/types.ts';

test('demo is deterministic', () => {
  const a = demoBundle('orbit')!;
  const legs = a.legs.slice(0, 5).map((l) => l.id).join();
  // regenerate bypassing cache
  assert.equal(legs.length > 0, true);
  assert.equal(a.legs[0].mint, demoBundle('orbit')!.legs[0].mint);
});

test('series dedupes legs and keeps order with out-of-order inserts', () => {
  const b = demoBundle('orbit')!;
  const s = new SwapSeries(b.launch.mint);
  const legs = b.legs.slice(0, 200);
  const shuffled = [...legs].reverse();
  s.add(shuffled.slice(0, 100), 1);
  s.add(legs, 2); // replay of everything (reconnect/backfill)
  s.add(legs.slice(50, 80), 3);
  assert.equal(s.size, 200);
  assert.equal(s.duplicatesDropped, 130);
  for (let i = 1; i < s.size; i++) assert.ok(s.swaps[i - 1].tl <= s.swaps[i].tl, 'tl ordered');
  for (let i = 0; i < s.size; i++) assert.equal(s.swaps[i].rank, i);
  // layout never leaves the chain second
  for (const x of s.swaps) assert.equal(Math.floor(x.tl / 1000), x.chainTime);
});

test('route legs merge into one economic swap', () => {
  const s = new SwapSeries('M');
  const base: SwapLeg = { id: 'sig:0', seq: 1, mint: 'M', venue: 'pumpswap', signature: 'sig', evIndex: 0, slot: 1, chainTime: 100, observedAt: 0, source: 'stream', wallet: 'W', side: 'buy', sol: 1, tokens: 10, priceSol: 0.1, reserveSol: null };
  s.add([base, { ...base, id: 'sig:1', evIndex: 1, sol: 0.5, tokens: 4, priceSol: 0.12 }], 0);
  assert.equal(s.size, 1);
  assert.equal(s.swaps[0].legs, 2);
  assert.equal(s.swaps[0].sol, 1.5);
  assert.equal(s.swaps[0].priceSol, 0.12);
});

test('window metrics are exact over the window', () => {
  const b = demoBundle('orbit')!;
  const s = seriesFromBundle(b);
  const ctx = makeCtx(b, s);
  const t0 = s.start;
  const a = t0 + 41000, z = t0 + 47000;
  const w = computeWindow(ctx, a, z, s.range(a, z));
  const manual = s.swaps.filter((x) => x.tl >= a && x.tl <= z);
  assert.equal(w.count, manual.length);
  const buySol = manual.filter((x) => x.side === 'buy').reduce((p, x) => p + x.sol, 0);
  assert.ok(Math.abs(w.buySol - buySol) < 1e-9);
  assert.equal(w.largest!.sol, Math.max(...manual.map((x) => x.sol)));
  assert.equal(w.distinctBuyers.length, new Set(manual.filter((x) => x.side === 'buy').map((x) => x.wallet)).size);
  assert.ok(w.largestBuyShare.value! > 0 && w.largestBuyShare.value! <= 1);
  assert.ok(w.clusters.length >= 1, 'shared funder cluster present');
  assert.ok(w.earlySellers.length >= 2, 'early buyers selling into the peak');
  console.log('orbit peak window', { count: w.count, buyers: w.distinctBuyers.length, largest: w.largest!.sol, share: w.largestBuyShare.value, top3: w.top3Share.value, fdvEnd: w.fdvEnd.usd });
});

test('compare: spread vs dominant buyer', () => {
  const out: Record<string, any> = {};
  for (const k of ['holo', 'stak']) {
    const b = demoBundle(k)!; const s = seriesFromBundle(b); const ctx = makeCtx(b, s);
    const st = launchStats(ctx); const c = compareSide(ctx, 60000);
    out[k] = { peakUsd: Math.round(st.fdvPeakUsd!), ttp: st.timeToPeak, buyers: c.buyersBeforePeak, topBuyer: c.topBuyerShare.value, t20k: timeToFdv(ctx, 20000) };
  }
  console.log(out);
  assert.ok(Math.abs(out.holo.peakUsd - out.stak.peakUsd) / out.holo.peakUsd < 0.1, 'similar peaks');
  assert.ok(out.stak.topBuyer > 0.6 && out.holo.topBuyer < 0.15);
});

test('all demo scripts build and print stats', () => {
  for (const sc of DEMO_SCRIPTS) {
    const b = demoBundle(sc.key)!; const s = seriesFromBundle(b); const st = launchStats(makeCtx(b, s));
    console.log(sc.key, s.size, 'swaps', 'peak', st.fdvPeakUsd && Math.round(st.fdvPeakUsd), 'ttp', st.timeToPeak, 'trunc', st.historyTruncated, 'dd', st.drawdownFromPeak?.toFixed(2));
  }
});

test('trader book: average cost, realized and unrealized PnL, older bags kept apart', async () => {
  const { traderBook, prefixes, pulseAt } = await import('../src/core/traders.ts');
  const s = new SwapSeries('M');
  const leg = (i: number, wallet: string, side: 'buy' | 'sell', sol: number, tokens: number): SwapLeg => ({ id: `s${i}:0`, seq: i, mint: 'M', venue: 'pumpswap', signature: `s${i}`, evIndex: 0, slot: i, chainTime: 100 + i, observedAt: 0, source: 'backfill', wallet, side, sol, tokens, priceSol: sol / tokens, reserveSol: null });
  s.add([leg(1, 'A', 'buy', 1, 100), leg(2, 'A', 'buy', 3, 100), leg(3, 'A', 'sell', 4, 100), leg(4, 'B', 'sell', 2, 50), leg(5, 'C', 'buy', 1, 25)], 0);
  const b = traderBook(s.swaps, s.size, 1000);
  const A = b.traders.find((t) => t.wallet === 'A')!;
  // bought 200 for 4 SOL (avg 0.02), sold 100 for 4 → realized +2, 100 left costing 2, price now 0.04 → unrealized +2
  assert.equal(A.realizedSol, 2);
  assert.equal(A.held, 100);
  assert.ok(Math.abs(A.unrealizedSol - 2) < 1e-9);
  const B = b.traders.find((t) => t.wallet === 'B')!;
  assert.equal(B.preSoldSol, 2);
  assert.equal(B.realizedSol, 0);
  assert.equal(b.inProfit, 1); // A; C bought at the current price (0 PnL); B has no buy
  // as of an earlier playhead, the future does not exist
  const early = traderBook(s.swaps, 2, 1000);
  assert.equal(early.traders.length, 1);
  const p = prefixes(s.swaps);
  const pu = pulseAt(s.swaps, p, 2)!;
  assert.equal(pu.ath, 0.04);
  assert.equal(pu.traders, 1);
});
