// Build the reference replay from Helius parsed transactions (100 per call) — for pools too busy for getTransaction.
//   node --env-file=.env scripts/fetch-reference-helius.ts
// Each trade = the token transfers between one wallet and the pool in one successful transaction:
//   pool → wallet (base)  ⇒ BUY,   wallet → pool (base) ⇒ SELL; the quote leg (TTWO) is the matching transfer.
// Price = execution price of the trade (quote ÷ base). Pool reserves are not part of this source.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { compactBundle, REFERENCE } from '../src/core/reference.ts';
import type { LaunchBundle, SwapLeg, UsdRef } from '../src/core/types.ts';

const REF = {
  ...REFERENCE,
  from: Date.UTC(2026, 10, 18, 15, 55, 0) / 1000,
  to: Date.UTC(2026, 10, 18, 15, 58, 50) / 1000,
  quoteMint: 'TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo',
  quoteUsdPool: '6PTm7MkUmtsLU7w6dWrMHJAt8PnzoCgcZdKyTKEhUAPL',
};
const RPC = process.env.SOLANA_RPC_URL ?? '';
const KEY = new URL(RPC || 'https://x').searchParams.get('api-key');
if (!KEY) throw new Error('Set SOLANA_RPC_URL to a Helius URL with ?api-key=… in .env');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJSON<T>(url: string, tries = 8): Promise<T> {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (r && r.ok) return (await r.json()) as T;
    if (i >= tries) throw new Error(`HTTP ${r?.status} ${url.replace(/api-key=[^&]+/, 'api-key=***')}`);
    await sleep(700 * 2 ** Math.min(i, 5));
  }
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = (await r.json()) as { result: T };
  return j.result;
}

interface HTx {
  signature: string;
  slot: number;
  timestamp: number;
  transactionError: unknown;
  tokenTransfers: { fromUserAccount: string; toUserAccount: string; mint: string; tokenAmount: number }[];
}

async function main() {
  // anchor: the newest pool signature at the end of the window
  let before: string | undefined;
  const cacheFile = `data/${REF.key}.cache.json`;
  if (existsSync(cacheFile)) {
    // reuse the window-end anchor found by scripts/fetch-reference.ts
    before = JSON.parse(readFileSync(cacheFile, 'utf8')).sigs?.[0]?.signature;
    console.log('anchor from cache');
  }
  if (!before) {
    const sigs = await rpc<{ signature: string; blockTime: number }[]>('getSignaturesForAddress', [REF.pool, { limit: 1000 }]);
    // walk back with plain signatures until we pass the window end (cheap: signatures only)
    let page = sigs;
    let guard = 0;
    while (page.length && page[page.length - 1].blockTime > REF.to && guard++ < 400) {
      before = page[page.length - 1].signature;
      page = await rpc<{ signature: string; blockTime: number }[]>('getSignaturesForAddress', [REF.pool, { limit: 1000, before }]);
      if (guard % 20 === 0) console.log('seeking window end…', new Date(page[page.length - 1].blockTime * 1000).toISOString());
    }
    const hit = page.find((s) => s.blockTime <= REF.to);
    if (!hit) throw new Error('window end not found');
    before = page[page.indexOf(hit) - 1]?.signature ?? before;
  }
  console.log('anchor found, fetching parsed transactions');
  const txs: HTx[] = [];
  for (let call = 0; call < 2000; call++) {
    const url: string = `https://api.helius.xyz/v0/addresses/${REF.pool}/transactions?api-key=${KEY}&limit=100${before ? `&before=${before}` : ''}`;
    const page: HTx[] = await getJSON<HTx[]>(url);
    if (!page.length) break;
    for (const t of page) if (t.timestamp >= REF.from && t.timestamp <= REF.to) txs.push(t);
    before = page[page.length - 1].signature;
    if (call % 20 === 0) console.log('call', call, 'at', new Date(page[page.length - 1].timestamp * 1000).toISOString(), 'kept', txs.length);
    if (page[page.length - 1].timestamp < REF.from) break;
    await sleep(350);
  }
  // pages can overlap: keep each transaction once
  {
    const seen = new Set<string>();
    for (let i = txs.length - 1; i >= 0; i--) {
      if (seen.has(txs[i].signature)) txs.splice(i, 1);
      else seen.add(txs[i].signature);
    }
  }
  console.log('transactions in window (unique)', txs.length);

  // dated references
  const usd: UsdRef[] = [];
  {
    const rows = await getJSON<number[][]>(`https://api.exchange.coinbase.com/products/SOL-USD/candles?granularity=60&start=${new Date((REF.from - 300) * 1000).toISOString()}&end=${new Date((REF.to + 300) * 1000).toISOString()}`);
    for (const [t, , , , close] of rows) usd.push({ t: t * 1000, solUsd: close, source: 'Coinbase SOL-USD 1-min close' });
    usd.sort((a, b) => a.t - b.t);
  }
  const quoteUsd: { t: number; usd: number }[] = [];
  {
    const j = await getJSON<any>(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${REF.quoteUsdPool}/ohlcv/minute?aggregate=1&before_timestamp=${REF.to + 600}&limit=60&currency=usd&token=base`);
    for (const c of j.data.attributes.ohlcv_list) quoteUsd.push({ t: c[0] * 1000, usd: c[4] });
  }
  const nearest = <T extends { t: number }>(arr: T[], t: number): T => arr.reduce((m, x) => (Math.abs(x.t - t) < Math.abs(m.t - t) ? x : m));
  const toSol = (quote: number, tMs: number) => (quote * nearest(quoteUsd, tMs).usd) / nearest(usd, tMs).solUsd;

  // trades
  const legs: SwapLeg[] = [];
  let skipped = 0;
  for (const t of txs.sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature))) {
    if (t.transactionError) continue;
    const byWallet = new Map<string, { base: number; quoteIn: number; quoteOut: number }>();
    const acc = (w: string) => byWallet.get(w) ?? (byWallet.set(w, { base: 0, quoteIn: 0, quoteOut: 0 }), byWallet.get(w)!);
    for (const tr of t.tokenTransfers ?? []) {
      if (tr.mint === REF.mint && tr.fromUserAccount === REF.pool) acc(tr.toUserAccount).base += tr.tokenAmount; // buy
      else if (tr.mint === REF.mint && tr.toUserAccount === REF.pool) acc(tr.fromUserAccount).base -= tr.tokenAmount; // sell
      else if (tr.mint === REF.quoteMint && tr.toUserAccount === REF.pool) acc(tr.fromUserAccount).quoteIn += tr.tokenAmount;
      else if (tr.mint === REF.quoteMint && tr.fromUserAccount === REF.pool) acc(tr.toUserAccount).quoteOut += tr.tokenAmount;
    }
    let ev = 0;
    for (const [wallet, v] of byWallet) {
      if (!v.base) continue;
      const side = v.base > 0 ? 'buy' : 'sell';
      const base = Math.abs(v.base);
      const quote = side === 'buy' ? v.quoteIn : v.quoteOut;
      if (!quote || !base) {
        skipped++;
        continue;
      }
      const tMs = t.timestamp * 1000;
      legs.push({ id: `${t.signature}:${ev}`, seq: 0, mint: REF.mint, venue: 'pumpswap', signature: t.signature, evIndex: ev++, slot: t.slot, chainTime: t.timestamp, observedAt: tMs, source: 'backfill', wallet, side, sol: toSol(quote, tMs), tokens: base, priceSol: toSol(quote / base, tMs), reserveSol: null });
    }
  }
  legs.forEach((l, i) => (l.seq = i + 1));
  const bundle: LaunchBundle & { provenance: Record<string, unknown> } = {
    launch: { mint: REF.mint, name: REF.name, symbol: REF.symbol, creator: null, createdSlot: null, createdAt: null, createSignature: null, origin: 'search', phase: 'migrated', pool: REF.pool, firstObservedAt: REF.from * 1000, supply: 1_000_000_000, mode: 'live' },
    legs,
    gaps: [],
    usd,
    funding: [],
    coverage: { mode: 'live', collectorStartedAt: null, retentionHours: 0, oldestEventAt: legs[0]?.chainTime ?? null, venues: [{ venue: 'pumpswap', status: 'live', note: `Every successful trade of pool ${REF.pool} in the window.` }], commitment: 'confirmed (historical)', note: REF.context },
    provenance: {
      mint: REF.mint,
      pool: REF.pool,
      windowUtc: [new Date(REF.from * 1000).toISOString(), new Date(REF.to * 1000).toISOString()],
      rpc: 'Helius parsed transactions API (api.helius.xyz/v0/addresses/{pool}/transactions)',
      method: 'token transfers between each wallet and the pool, per successful transaction; price = execution price (quote ÷ base)',
      signatures: txs.length,
      failedTransactions: txs.filter((t) => t.transactionError).length,
      unavailable: skipped,
      swaps: legs.length,
      builtAt: new Date().toISOString(),
      context: REF.context,
      quote: { mint: REF.quoteMint, symbol: 'TTWO', usdReference: `GeckoTerminal minute close of pool ${REF.quoteUsdPool} (TTWO/USDC)`, conversion: 'SOL-equivalent = TTWO amount × TTWO/USD ÷ SOL/USD, both at the nearest minute' },
    },
  };
  mkdirSync('public/data', { recursive: true });
  const out = `public/data/${REF.key}.json`;
  writeFileSync(out, JSON.stringify(compactBundle(bundle)));
  console.log(`wrote ${out}: ${legs.length} trades (${skipped} skipped), ${usd.length} SOL/USD refs`);
}

main().catch((e) => {
  console.error(String(e).replace(/api-key=[^&\s]+/g, 'api-key=***'));
  process.exit(1);
});
