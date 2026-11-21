// Build a reference replay from real on-chain data (no synthetic values).
//   node scripts/fetch-reference.ts
// Finds every PumpSwap swap of one pool inside a UTC window, decodes it from the transaction logs
// (same decoder as the live worker), attaches a dated SOL/USD reference, and writes a static bundle with provenance.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { decodeLogs } from '../server/pump.ts';
import { rpc, RPC_URL } from '../server/rpc.ts';
import type { LaunchBundle, SwapLeg, UsdRef } from '../src/core/types.ts';
import { compactBundle } from '../src/core/reference.ts';

const REF = {
  key: 'dcty',
  mint: '9hjBLBrc7WZW2H8UQvBAvG5WiTZotXUv2Bdcn4f4pump',
  pool: 'DChXQ4qFPpNPEDfZLNiwvPhrVuuFGfqEDLAAZbiZHUWf',
  name: 'DacityCoin',
  symbol: 'DCTY',
  from: Date.UTC(2026, 10, 18, 15, 55, 0) / 1000,
  to: Date.UTC(2026, 10, 18, 15, 58, 50) / 1000,
  context: 'DacityCoin (DCTY) goes from $730k to $7.4M market cap in four minutes on 18 Nov 2026.',
  // The pool is quoted in TTWO (Backpack tokenized Take-Two shares, 6 decimals), not SOL.
  quoteMint: 'TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo',
  quoteSymbol: 'TTWO',
  quoteDecimals: 6,
  quoteUsdPool: '6PTm7MkUmtsLU7w6dWrMHJAt8PnzoCgcZdKyTKEhUAPL', // TTWO/USDC, for a dated TTWO/USD reference
};
const OUT = `public/data/${REF.key}.json`;
const CACHE = `data/${REF.key}.cache.json`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function call<T>(m: string, p: unknown[], tries = 8): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await rpc<T>(m, p);
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(600 * 2 ** Math.min(i, 5));
    }
  }
}

/** JSON-RPC batch (one HTTP request, many calls). Retries the whole batch on rate limits. */
async function batch<T>(method: string, paramsList: unknown[][], tries = 8): Promise<(T | null)[]> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(paramsList.map((params, id) => ({ jsonrpc: '2.0', id, method, params }))), signal: AbortSignal.timeout(30_000) });
      if (r.status === 429) throw new Error('429');
      const j = (await r.json()) as { id: number; result?: T; error?: { code: number } }[];
      if (!Array.isArray(j)) throw new Error('not a batch reply');
      if (j.some((x) => x.error?.code === 429 || x.error?.code === -32429)) throw new Error('429 in batch');
      const out: (T | null)[] = new Array(paramsList.length).fill(null);
      for (const x of j) out[x.id] = x.result ?? null;
      return out;
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(800 * 2 ** Math.min(i, 5));
    }
  }
}

async function slotAt(ts: number): Promise<number> {
  let hi = await call<number>('getSlot', [{ commitment: 'finalized' }]);
  let lo = hi - 40_000_000;
  // binary search on block time (skipped slots are handled by probing forward)
  const timeOf = async (s: number): Promise<number> => {
    for (let k = 0; k < 20; k++) {
      try {
        const t = await call<number | null>('getBlockTime', [s + k], 6);
        if (t != null) return t;
      } catch {
        /* skipped slot */
      }
    }
    throw new Error('no block near ' + s);
  };
  while (hi - lo > 50) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await timeOf(mid)) < ts) lo = mid;
    else hi = mid;
  }
  return hi;
}

async function anchorSignature(ts: number): Promise<string> {
  const slot = await slotAt(ts);
  console.log('slot near', new Date(ts * 1000).toISOString(), '=', slot);
  for (let s = slot; s < slot + 400; s++) {
    let b: any;
    try {
      b = await call<any>('getBlock', [s, { transactionDetails: 'accounts', maxSupportedTransactionVersion: 1, rewards: false }], 2);
    } catch {
      continue;
    }
    for (const tx of b?.transactions ?? []) {
      const keys: string[] = tx.transaction.accountKeys.map((k: any) => k.pubkey ?? k);
      if (keys.includes(REF.pool)) return tx.transaction.signatures[0];
    }
  }
  throw new Error('no anchor tx found');
}

async function main() {
  mkdirSync('public/data', { recursive: true });
  mkdirSync('data', { recursive: true });
  type Sig = { signature: string; slot: number; blockTime: number; err: unknown };
  const cache: { sigs?: Sig[]; tx: Record<string, { slot: number; blockTime: number; logs: string[] } | null> } = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : { tx: {} };
  if (!cache.sigs) {
    const anchor = await anchorSignature(REF.to + 30);
    console.log('anchor', anchor);
    const sigs: Sig[] = [];
    let before = anchor;
    for (let page = 0; page < 60; page++) {
      const r = await call<any[]>('getSignaturesForAddress', [REF.pool, { before, limit: 1000 }]);
      if (!r.length) break;
      for (const s of r) if (s.blockTime >= REF.from && s.blockTime <= REF.to) sigs.push(s);
      before = r[r.length - 1].signature;
      console.log('page', page, 'oldest', new Date(r[r.length - 1].blockTime * 1000).toISOString(), 'kept', sigs.length);
      if (r[r.length - 1].blockTime < REF.from) break;
    }
    cache.sigs = sigs;
    writeFileSync(CACHE, JSON.stringify(cache));
  }
  // optional narrower window inside the listed one (env FETCH_FROM / FETCH_TO, unix seconds)
  const lo = Number(process.env.FETCH_FROM ?? REF.from);
  const hi = Number(process.env.FETCH_TO ?? REF.to);
  const inWin = (x: { blockTime: number }) => x.blockTime >= lo && x.blockTime <= hi;
  const todo = cache.sigs.filter((s) => !s.err && inWin(s) && !(s.signature in cache.tx)).reverse();
  console.log(`${cache.sigs.length} signatures in window, ${todo.length} transactions to fetch`);
  let done = 0;
  const B = Number(process.env.FETCH_BATCH ?? 1);
  const worker = async () => {
    for (;;) {
      const chunk = todo.splice(0, B);
      if (!chunk.length) return;
      const txs = B > 1
        ? await batch<any>('getTransaction', chunk.map((s) => [s.signature, { maxSupportedTransactionVersion: 1, commitment: 'confirmed' }])).catch(() => chunk.map(() => null))
        : [await call<any>('getTransaction', [chunk[0].signature, { maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]).catch(() => null)];
      chunk.forEach((s, i) => {
        const tx = txs[i];
        cache.tx[s.signature] = tx && !tx.meta?.err ? { slot: tx.slot, blockTime: tx.blockTime, logs: tx.meta.logMessages ?? [] } : null;
      });
      done += chunk.length - 1;
      if (++done % 500 < B) {
        console.log('fetched', done);
        writeFileSync(CACHE, JSON.stringify(cache));
      }
      await sleep(Number(process.env.FETCH_GAP_MS ?? 450));
    }
  };
  await Promise.all(Array.from({ length: Number(process.env.FETCH_WORKERS ?? 2) }, worker));
  writeFileSync(CACHE, JSON.stringify(cache));

  // dated SOL/USD: Coinbase 1-minute candles (close), one reference per minute
  const usd: UsdRef[] = [];
  try {
    const r = await fetch(`https://api.exchange.coinbase.com/products/SOL-USD/candles?granularity=60&start=${new Date((REF.from - 300) * 1000).toISOString()}&end=${new Date((REF.to + 300) * 1000).toISOString()}`, { headers: { 'user-agent': 'tapezero-reference' } });
    const rows = (await r.json()) as number[][];
    for (const [t, , , , close] of rows) usd.push({ t: t * 1000, solUsd: close, source: 'Coinbase SOL-USD 1-min close' });
    usd.sort((a, b) => a.t - b.t);
  } catch (e) {
    console.log('no usd reference', String(e));
  }

  // dated TTWO/USD: GeckoTerminal minute closes of the TTWO/USDC pool
  const quoteUsd: { t: number; usd: number }[] = [];
  {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${REF.quoteUsdPool}/ohlcv/minute?aggregate=1&before_timestamp=${hi + 600}&limit=60&currency=usd&token=base`);
    const j = (await r.json()) as any;
    for (const c of j.data.attributes.ohlcv_list) quoteUsd.push({ t: c[0] * 1000, usd: c[4] });
    quoteUsd.sort((x, y) => x.t - y.t);
  }
  const nearest = <T extends { t: number }>(arr: T[], t: number): T => arr.reduce((m, x) => (Math.abs(x.t - t) < Math.abs(m.t - t) ? x : m));
  const toSol = (quoteUnits: number, tMs: number) => (quoteUnits * nearest(quoteUsd, tMs).usd) / nearest(usd, tMs).solUsd;
  const qd = 10 ** REF.quoteDecimals;
  // decode
  const legs: SwapLeg[] = [];
  let seq = 0;
  const win = cache.sigs.filter(inWin);
  for (const s of win) {
    const t = cache.tx[s.signature];
    if (!t) continue;
    for (const { ev, evIndex } of decodeLogs(t.logs)) {
      if (ev.kind !== 'amm' || ev.pool !== REF.pool || !ev.poolBase) continue;
      legs.push({
        id: `${s.signature}:${evIndex}`,
        seq: 0,
        mint: REF.mint,
        venue: 'pumpswap',
        signature: s.signature,
        evIndex,
        slot: t.slot,
        chainTime: ev.ts,
        observedAt: t.blockTime * 1000,
        source: 'backfill',
        wallet: ev.user,
        side: ev.side,
        sol: toSol(ev.quote / qd, ev.ts * 1000),
        tokens: ev.base / 1e6,
        priceSol: toSol(ev.poolQuote / qd / (ev.poolBase / 1e6), ev.ts * 1000),
        reserveSol: toSol(ev.poolQuote / qd, ev.ts * 1000),
      });
    }
  }
  legs.sort((a, b) => a.chainTime - b.chainTime || a.slot - b.slot || a.signature.localeCompare(b.signature) || a.evIndex - b.evIndex);
  for (const l of legs) l.seq = ++seq;

  const bundle: LaunchBundle & { provenance: Record<string, unknown> } = {
    launch: { mint: REF.mint, name: REF.name, symbol: REF.symbol, creator: null, createdSlot: null, createdAt: null, createSignature: null, origin: 'search', phase: 'migrated', pool: REF.pool, firstObservedAt: REF.from * 1000, supply: 1_000_000_000, mode: 'live' },
    legs,
    gaps: [],
    usd,
    funding: [],
    coverage: {
      mode: 'live',
      collectorStartedAt: null,
      retentionHours: 0,
      oldestEventAt: legs[0]?.chainTime ?? null,
      venues: [{ venue: 'pumpswap', status: 'live', note: `Every swap of pool ${REF.pool} between the two timestamps.` }],
      commitment: 'confirmed (historical)',
      note: `Reference replay rebuilt from Solana mainnet on ${new Date().toISOString().slice(0, 10)}: ${REF.context}`,
    },
    provenance: {
      mint: REF.mint,
      pool: REF.pool,
      windowUtc: [new Date(lo * 1000).toISOString(), new Date(hi * 1000).toISOString()],
      rpc: RPC_URL.replace(/api-key=[^&]+/, 'api-key=***'),
      method: 'getSignaturesForAddress(pool) + getTransaction, PumpSwap BuyEvent/SellEvent decoded from logs',
      signatures: win.length,
      failedTransactions: win.filter((s) => s.err).length,
      unavailable: win.filter((s) => !s.err && !cache.tx[s.signature]).length,
      swaps: legs.length,
      builtAt: new Date().toISOString(),
      context: REF.context,
      quote: { mint: REF.quoteMint, symbol: REF.quoteSymbol, decimals: REF.quoteDecimals, usdReference: `GeckoTerminal minute close of pool ${REF.quoteUsdPool} (TTWO/USDC)`, conversion: 'SOL-equivalent = TTWO amount × TTWO/USD ÷ SOL/USD, both at the nearest minute' },
    },
  };
  writeFileSync(OUT, JSON.stringify(compactBundle(bundle)));
  console.log(`wrote ${OUT}: ${legs.length} swaps, ${usd.length} usd refs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
