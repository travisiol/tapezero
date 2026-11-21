import { SwapSeries } from './series.ts';
import type { Ctx } from './metrics.ts';
import type { LaunchBundle } from './types.ts';

/** Whether the observed history may not start at the token's real first swap. */
export function isTruncated(b: LaunchBundle, series: SwapSeries): boolean {
  if (b.launch.origin === 'search') return true;
  if (b.launch.mode === 'live') {
    // creation observed but our first swap is later than creation by > 60 s and a gap covers the start
    const first = series.first;
    if (!first) return false;
    return b.gaps.some((g) => g.fromTime <= first.chainTime && (b.launch.createdAt ?? 0) <= g.toTime);
  }
  return false;
}

export function makeCtx(b: LaunchBundle, series: SwapSeries): Ctx {
  return { launch: b.launch, all: series.swaps, gaps: b.gaps, usd: b.usd, funding: b.funding, historyTruncated: isTruncated(b, series) };
}

export function seriesFromBundle(b: LaunchBundle, receivedAt = 0): SwapSeries {
  const s = new SwapSeries(b.launch.mint);
  s.add(b.legs, receivedAt);
  return s;
}
