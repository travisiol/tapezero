// The real launch shown on the homepage, in the terminal by default, in the trailer and in the X video.
// Built from Solana mainnet by scripts/fetch-reference.ts (provenance inside the file).
import type { LaunchBundle, SwapLeg } from './types.ts';

export const REFERENCE = {
  key: 'dcty',
  mint: '9hjBLBrc7WZW2H8UQvBAvG5WiTZotXUv2Bdcn4f4pump',
  pool: 'DChXQ4qFPpNPEDfZLNiwvPhrVuuFGfqEDLAAZbiZHUWf',
  name: 'DacityCoin',
  symbol: 'DCTY',
  date: '18 Nov 2026',
  venue: 'PumpSwap',
  url: '/data/dcty.json',
  /** The coin's own logo, from its on-chain metadata (local copy). */
  logo: '/tokens/dcty.webp',
  /** One-line hook shown above the chart. */
  hook: '🎮 Named after the fictional coin in the GTA VI trailer · $685k → $3.2M in under 4 minutes',
  /** One honest sentence of context; numbers are checked against the data file. */
  context: 'DacityCoin (DCTY) is named after the fictional coin in the GTA VI trailer. On 18 Nov 2026 its market cap goes from $685k to $3.2M in under four minutes: 6,230 trades by 1,593 buyers. Here they are, one by one.',
};

/** Compact on-disk format (v2): wallets are de-duplicated, legs are arrays. */
export interface CompactBundle extends Omit<LaunchBundle, 'legs'> {
  v: 2;
  wallets: string[];
  // [signature, evIndex, slot, chainTime, walletIndex, side(1=buy,0=sell), sol, tokens, priceSol, reserveSol]
  rows: [string, number, number, number, number, 0 | 1, number, number, number, number | null][];
  provenance?: Record<string, unknown>;
}

export function compactBundle(b: LaunchBundle & { provenance?: Record<string, unknown> }): CompactBundle {
  const idx = new Map<string, number>();
  const wallets: string[] = [];
  const r = (x: number, d = 6) => Number(x.toPrecision(d));
  const rows = b.legs.map((l) => {
    let w = idx.get(l.wallet);
    if (w === undefined) {
      w = wallets.length;
      idx.set(l.wallet, w);
      wallets.push(l.wallet);
    }
    return [l.signature, l.evIndex, l.slot, l.chainTime, w, l.side === 'buy' ? 1 : 0, r(l.sol), r(l.tokens), r(l.priceSol, 8), l.reserveSol == null ? null : r(l.reserveSol)] as CompactBundle['rows'][number];
  });
  const { legs: _legs, ...rest } = b;
  void _legs;
  return { ...rest, v: 2, wallets, rows };
}

export function expandBundle(j: LaunchBundle | CompactBundle): LaunchBundle & { provenance?: Record<string, unknown> } {
  if ((j as CompactBundle).v !== 2) return j as LaunchBundle;
  const c = j as CompactBundle;
  const mint = c.launch.mint;
  const legs: SwapLeg[] = c.rows.map(([signature, evIndex, slot, chainTime, w, side, sol, tokens, priceSol, reserveSol], i) => ({
    id: `${signature}:${evIndex}`,
    seq: i + 1,
    mint,
    venue: 'pumpswap',
    signature,
    evIndex,
    slot,
    chainTime,
    observedAt: chainTime * 1000,
    source: 'backfill',
    wallet: c.wallets[w],
    side: side ? 'buy' : 'sell',
    sol,
    tokens,
    priceSol,
    reserveSol,
  }));
  const { rows: _r, wallets: _w, v: _v, ...rest } = c;
  void _r, _w, _v;
  return { ...rest, legs };
}
