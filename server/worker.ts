// TAPEZERO ingestion worker — long-running. Collects pump.fun + PumpSwap events independently of visitors.
//   node server/worker.ts
// Source: Solana JSON-RPC `logsSubscribe` (commitment: confirmed) on both programs; HTTP RPC for backfill.
import type { DatabaseSync } from 'node:sqlite';
import { openDb, getMeta, setMeta, rowToLeg, rowToGap, rowToUsd, rowToFunding, rowToLaunch, RETENTION_HOURS } from './db.ts';
import { decodeLogs, PUMP_PROGRAM, PUMPSWAP_PROGRAM, WSOL, type Decoded } from './pump.ts';
import { RateLimiter, rpc } from './rpc.ts';
import { SwapSeries } from '../src/core/series.ts';
import { launchStats } from '../src/core/metrics.ts';
import type { Launch, SwapLeg } from '../src/core/types.ts';

const WS_URL = process.env.SOLANA_WS_URL ?? 'wss://api.mainnet-beta.solana.com';
const PRICE_URL = process.env.SOL_USD_URL ?? 'https://api.coinbase.com/v2/prices/SOL-USD/spot';
const COMMITMENT = 'confirmed';
const MAX_TRACKED = Number(process.env.MAX_TRACKED_MINTS ?? 20000);

const db = openDb();
const limiter = new RateLimiter(Number(process.env.RPC_MAX_RPS ?? 4));
const now = () => Date.now();

if (!getMeta(db, 'collector_started_at')) setMeta(db, 'collector_started_at', String(now()));
setMeta(db, 'worker_boot_at', String(now()));

// ───────────── state ─────────────
const tracked = new Map<string, { launch: Launch; series: SwapSeries; dirty: boolean; lastSwapAt: number }>();
const poolToMint = new Map<string, string>();
const health = {
  ws: 'connecting' as 'connected' | 'connecting' | 'reconnecting' | 'down',
  connectedSince: null as number | null,
  reconnects: 0,
  lastMessageAt: null as number | null,
  lastEventSlot: null as number | null,
  eventsWindow: [] as number[],
  lags: [] as number[],
  rpcCalls: 0,
  rpcErrors: 0,
  rateLimited: 0,
  decodeErrors: 0,
  unpriced: 0,
  inserted: 0,
  duplicates: 0,
};

function loadState() {
  const since = Math.floor(now() / 1000) - RETENTION_HOURS * 3600;
  for (const r of db.prepare('SELECT * FROM launches').all()) {
    const l = rowToLaunch(r);
    tracked.set(l.mint, { launch: l, series: new SwapSeries(l.mint), dirty: true, lastSwapAt: 0 });
  }
  const rows = db.prepare('SELECT * FROM swaps WHERE chain_time >= ? ORDER BY seq').all(since);
  for (const r of rows) {
    const leg = rowToLeg(r);
    const t = tracked.get(leg.mint);
    if (t) {
      t.series.add([leg], 0);
      t.lastSwapAt = Math.max(t.lastSwapAt, leg.chainTime);
    }
  }
  for (const r of db.prepare('SELECT pool, mint FROM pools').all()) poolToMint.set(r.pool as string, r.mint as string);
  log(`loaded ${tracked.size} launches, ${rows.length} swaps, ${poolToMint.size} pools`);
}

function log(...a: unknown[]) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

// ───────────── writes ─────────────
const insLaunch = db.prepare(`INSERT INTO launches(mint,name,symbol,uri,creator,bonding_curve,created_slot,created_at,create_sig,origin,phase,pool,first_observed_at,supply,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(mint) DO UPDATE SET name=excluded.name, symbol=excluded.symbol, uri=excluded.uri, creator=excluded.creator, bonding_curve=excluded.bonding_curve,
    created_slot=excluded.created_slot, created_at=excluded.created_at, create_sig=excluded.create_sig, origin=excluded.origin, updated_at=excluded.updated_at`);
const insSwap = db.prepare(`INSERT OR IGNORE INTO swaps(id,mint,venue,signature,ev_index,slot,chain_time,observed_at,source,wallet,side,sol,tokens,price_sol,reserve_sol)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const setPhase = db.prepare('UPDATE launches SET phase = ?, pool = COALESCE(?, pool), updated_at = ? WHERE mint = ?');

function insertLeg(leg: Omit<SwapLeg, 'seq'>): boolean {
  const r = insSwap.run(leg.id, leg.mint, leg.venue, leg.signature, leg.evIndex, leg.slot, leg.chainTime, leg.observedAt, leg.source, leg.wallet, leg.side, leg.sol, leg.tokens, leg.priceSol, leg.reserveSol);
  if (Number(r.changes) === 0) {
    health.duplicates++;
    return false;
  }
  health.inserted++;
  const t = tracked.get(leg.mint);
  if (t) {
    t.series.add([{ ...leg, seq: Number(r.lastInsertRowid) }], now());
    t.dirty = true;
    t.lastSwapAt = Math.max(t.lastSwapAt, leg.chainTime);
  }
  return true;
}

function ensureLaunch(mint: string, patch: Partial<Launch> & { uri?: string; bondingCurve?: string }, origin: Launch['origin']) {
  let t = tracked.get(mint);
  if (!t) {
    if (tracked.size >= MAX_TRACKED) return null;
    const l: Launch = { mint, name: '', symbol: '', creator: null, createdSlot: null, createdAt: null, createSignature: null, origin, phase: 'bonding', pool: null, firstObservedAt: now(), supply: 1_000_000_000, mode: 'live' };
    t = { launch: l, series: new SwapSeries(mint), dirty: true, lastSwapAt: 0 };
    tracked.set(mint, t);
  }
  Object.assign(t.launch, patch);
  const l = t.launch;
  insLaunch.run(l.mint, l.name, l.symbol, patch.uri ?? null, l.creator, patch.bondingCurve ?? null, l.createdSlot, l.createdAt, l.createSignature, l.origin, l.phase, l.pool, l.firstObservedAt, l.supply, now());
  return t;
}

/** Turn decoded events of one transaction into rows. Shared by the stream and the backfill. */
function ingestTx(signature: string, slot: number, logs: string[], observedAt: number, source: 'stream' | 'backfill', blockTime: number | null) {
  let events;
  try {
    events = decodeLogs(logs);
  } catch {
    health.decodeErrors++;
    return 0;
  }
  let n = 0;
  for (const { ev, evIndex } of events) n += apply(ev, evIndex, signature, slot, observedAt, source, blockTime);
  return n;
}

function apply(ev: Decoded, evIndex: number, signature: string, slot: number, observedAt: number, source: 'stream' | 'backfill', blockTime: number | null): number {
  switch (ev.kind) {
    case 'create': {
      ensureLaunch(ev.mint, { name: ev.name, symbol: ev.symbol, creator: ev.creator ?? ev.user, createdSlot: slot, createdAt: ev.ts ?? blockTime, createSignature: signature, origin: 'create-event', uri: ev.uri, bondingCurve: ev.bondingCurve }, 'create-event');
      return 0;
    }
    case 'trade': {
      if (!tracked.has(ev.mint)) return 0; // we follow launches from their creation (or on request)
      if (!ev.vSol || !ev.vTok) {
        health.unpriced++;
        return 0;
      }
      const leg = { id: `${signature}:${evIndex}`, mint: ev.mint, venue: 'pump-bc' as const, signature, evIndex, slot, chainTime: ev.ts, observedAt, source, wallet: ev.user, side: ev.isBuy ? ('buy' as const) : ('sell' as const), sol: ev.sol, tokens: ev.tokens, priceSol: ev.vSol / ev.vTok, reserveSol: ev.realSol };
      if (!insertLeg(leg)) return 0;
      noteLag(observedAt, ev.ts, source);
      return 1;
    }
    case 'complete': {
      if (!tracked.has(ev.mint)) return 0;
      tracked.get(ev.mint)!.launch.phase = 'complete';
      setPhase.run('complete', null, now(), ev.mint);
      return 0;
    }
    case 'migrate': {
      if (!tracked.has(ev.mint)) return 0;
      const t = tracked.get(ev.mint)!;
      t.launch.phase = 'migrated';
      t.launch.pool = ev.pool;
      setPhase.run('migrated', ev.pool, now(), ev.mint);
      if (!poolToMint.has(ev.pool)) subscribePool(ev.pool);
      poolToMint.set(ev.pool, ev.mint);
      db.prepare('INSERT OR IGNORE INTO pools(pool, mint, quote_mint, source) VALUES(?,?,?,?)').run(ev.pool, ev.mint, WSOL, 'migration-event');
      return 0;
    }
    case 'createPool': {
      if (!tracked.has(ev.baseMint) || ev.quoteMint !== WSOL) return 0;
      if (!poolToMint.has(ev.pool)) subscribePool(ev.pool);
      poolToMint.set(ev.pool, ev.baseMint);
      db.prepare('INSERT OR IGNORE INTO pools(pool, mint, quote_mint, source) VALUES(?,?,?,?)').run(ev.pool, ev.baseMint, ev.quoteMint, 'create-pool-event');
      return 0;
    }
    case 'amm': {
      const mint = poolToMint.get(ev.pool);
      if (!mint) return 0;
      const sol = ev.quote / 1e9;
      const tokens = ev.base / 1e6;
      const priceSol = ev.poolBase > 0 ? ev.poolQuote / 1e9 / (ev.poolBase / 1e6) : 0;
      if (!priceSol) {
        health.unpriced++;
        return 0;
      }
      const ok = insertLeg({ id: `${signature}:${evIndex}`, mint, venue: 'pumpswap', signature, evIndex, slot, chainTime: ev.ts, observedAt, source, wallet: ev.user, side: ev.side, sol, tokens, priceSol, reserveSol: ev.poolQuote / 1e9 });
      if (ok) noteLag(observedAt, ev.ts, source);
      return ok ? 1 : 0;
    }
  }
}

function noteLag(observedAt: number, ts: number, source: string) {
  if (source !== 'stream') return;
  health.lags.push(observedAt - ts * 1000);
  if (health.lags.length > 1000) health.lags.splice(0, health.lags.length - 1000);
  health.eventsWindow.push(observedAt);
}

// ───────────── stream ─────────────
let ws: WebSocket | null = null;
let lastSlot: number | null = null;
let lastMsg = 0;
let outageStart: { at: number; slot: number | null } | null = null;
let backoff = 1000;
let subscribePool: (pool: string) => void = () => {};

const ROTATE_MS = Number(process.env.WS_ROTATE_SEC ?? 30) * 1000;
const retired = new WeakSet<WebSocket>();
let rotations = 0;

/** Open a socket. With `retiring`, this is an overlapping rotation: the old socket closes once the new one delivers. */
function connect(retiring?: WebSocket) {
  if (!retiring) health.ws = health.reconnects ? 'reconnecting' : 'connecting';
  const sock = new WebSocket(WS_URL);
  ws = sock;
  let delivered = false;
  const subs = new Map<number, string>();
  let nextId = 1;
  const sub = (addr: string) => {
    subs.set(nextId, addr);
    sock.send(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'logsSubscribe', params: [{ mentions: [addr] }, { commitment: COMMITMENT }] }));
  };
  subscribePool = (pool: string) => {
    if (sock.readyState === WebSocket.OPEN) sub(pool);
  };
  sock.onopen = () => {
    // pump.fun program: every launch + bonding-curve trade.
    sub(PUMP_PROGRAM);
    // PumpSwap: only the pools of tracked, migrated launches (the whole program is ~3x the volume and
    // makes the public endpoint fall behind). Set PUMPSWAP_FULL=1 with a dedicated RPC to take everything.
    if (process.env.PUMPSWAP_FULL === '1') sub(PUMPSWAP_PROGRAM);
    else for (const pool of poolToMint.keys()) sub(pool);
  };
  sock.onmessage = (m) => {
    lastMsg = now();
    health.lastMessageAt = lastMsg;
    let j: any;
    try {
      j = JSON.parse(String(m.data));
    } catch {
      return;
    }
    if (j.id && j.result !== undefined) {
      log(`subscribed ${subs.get(j.id)?.slice(0, 6)} → ${j.result}`);
      if (health.ws !== 'connected') {
        health.ws = 'connected';
        health.connectedSince = now();
        backoff = 1000;
      }
      return;
    }
    if (j.error) {
      log('rpc ws error', JSON.stringify(j.error));
      health.rpcErrors++;
      return;
    }
    const v = j.params?.result?.value;
    const slot = j.params?.result?.context?.slot;
    if (!v || v.err || !Array.isArray(v.logs)) return;
    if (!delivered) {
      delivered = true;
      if (retiring) setTimeout(() => {
        retired.add(retiring);
        retiring.close();
      }, 3000);
    }
    if (outageStart && slot) closeOutage(slot);
    lastSlot = slot;
    health.lastEventSlot = slot;
    ingestTx(v.signature, slot, v.logs, lastMsg, 'stream', null);
  };
  sock.onclose = (e) => {
    if (retired.has(sock) || ws !== sock) return;
    log(`ws closed ${e.code} ${e.reason}`);
    health.ws = 'reconnecting';
    health.connectedSince = null;
    health.reconnects++;
    if (!outageStart) outageStart = { at: now(), slot: lastSlot };
    setTimeout(connect, backoff);
    backoff = Math.min(30_000, backoff * 2);
  };
  sock.onerror = () => {
    /* onclose follows */
  };
}

// overlapping rotation: public endpoints fall further behind the longer a subscription lives
if (ROTATE_MS > 0)
  setInterval(() => {
    if (ws && health.ws === 'connected') {
      rotations++;
      connect(ws);
    }
  }, ROTATE_MS);

// watchdog: the public endpoint can stall silently
setInterval(() => {
  if (ws && health.ws === 'connected' && now() - lastMsg > 20_000) {
    log('no message for 20 s — reconnecting');
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws.onclose?.({ code: 4000, reason: 'watchdog' } as CloseEvent);
  }
}, 5000);

// ───────────── gaps + backfill ─────────────
function closeOutage(resumeSlot: number) {
  const o = outageStart!;
  outageStart = null;
  const fromTime = Math.floor(o.at / 1000) - 2;
  const toTime = Math.floor(now() / 1000) + 2;
  const id = `gap-${o.at}`;
  db.prepare('INSERT OR REPLACE INTO gaps(id, mint, from_time, to_time, from_slot, to_slot, status, note) VALUES(?,?,?,?,?,?,?,?)').run(id, null, fromTime, toTime, o.slot, resumeSlot, 'open', 'Stream disconnected; backfill pending.');
  log(`gap ${toTime - fromTime}s (slots ${o.slot}→${resumeSlot}); backfilling active mints`);
  void backfillGap(id, fromTime, toTime);
}

async function backfillGap(id: string, fromTime: number, toTime: number) {
  // active = traded in the 10 minutes before the outage
  const active = [...tracked.values()].filter((t) => t.lastSwapAt >= fromTime - 600).slice(0, 40);
  let recovered = 0;
  let failed = 0;
  for (const t of active) {
    try {
      recovered += await backfillMint(t.launch.mint, fromTime, toTime);
    } catch (e) {
      failed++;
      log('backfill error', t.launch.mint.slice(0, 6), String(e));
    }
  }
  const status = failed ? 'partial' : 'backfilled';
  db.prepare('UPDATE gaps SET status = ?, note = ? WHERE id = ?').run(status, `Backfill checked ${active.length} active launches, recovered ${recovered} swaps${failed ? `, ${failed} failed` : ''}. Launches created during the outage are not recovered.`, id);
  log(`gap ${id} ${status}: +${recovered}`);
}

/** Fetch signatures touching `mint` inside [fromTime, toTime] and ingest the ones we do not have. Idempotent. */
async function backfillMint(mint: string, fromTime: number, toTime: number): Promise<number> {
  let before: string | undefined;
  let got = 0;
  for (let page = 0; page < 5; page++) {
    const sigs = await call<any[]>('getSignaturesForAddress', [mint, { limit: 200, before, commitment: COMMITMENT }]);
    if (!sigs.length) break;
    for (const s of sigs) {
      if (s.err || s.blockTime == null) continue;
      if (s.blockTime > toTime) continue;
      if (s.blockTime < fromTime) return got;
      if (db.prepare('SELECT 1 FROM swaps WHERE signature = ? LIMIT 1').get(s.signature)) continue;
      const tx = await call<any>('getTransaction', [s.signature, { maxSupportedTransactionVersion: 1, commitment: COMMITMENT }]);
      const logs = tx?.meta?.logMessages;
      if (!logs || tx.meta.err) continue;
      got += ingestTx(s.signature, tx.slot, logs, now(), 'backfill', tx.blockTime ?? null);
    }
    before = sigs[sigs.length - 1].signature;
  }
  return got;
}

async function call<T>(method: string, params: unknown[]): Promise<T> {
  await limiter.take();
  health.rpcCalls++;
  try {
    return await rpc<T>(method, params);
  } catch (e) {
    health.rpcErrors++;
    if (String(e).includes('429')) health.rateLimited++;
    throw e;
  }
}

// ───────────── on-demand tracking (search) ─────────────
setInterval(() => {
  // the API inserts searched mints with origin 'search'; pick them up
  for (const r of db.prepare("SELECT * FROM launches WHERE origin = 'search'").all()) {
    const l = rowToLaunch(r);
    if (!tracked.has(l.mint)) {
      tracked.set(l.mint, { launch: l, series: new SwapSeries(l.mint), dirty: true, lastSwapAt: 0 });
      log(`tracking on request ${l.mint}`);
    }
  }
}, 2000);

// ───────────── SOL/USD reference ─────────────
async function pollUsd() {
  try {
    const r = await fetch(PRICE_URL, { headers: { 'user-agent': 'tapezero-collector' } });
    const j: any = await r.json();
    const v = Number(j?.data?.amount ?? j?.price ?? j?.solana?.usd);
    if (isFinite(v) && v > 0) db.prepare('INSERT OR REPLACE INTO usd_refs(t, sol_usd, source) VALUES(?,?,?)').run(now(), v, new URL(PRICE_URL).hostname + ' spot');
  } catch (e) {
    log('usd ref error', String(e));
  }
}

// ───────────── stats + health + retention ─────────────
function flushStats() {
  const usd = db.prepare('SELECT * FROM usd_refs WHERE t >= ?').all(now() - (RETENTION_HOURS + 1) * 3600_000).map(rowToUsd);
  const gaps = db.prepare('SELECT * FROM gaps').all().map(rowToGap);
  const funding = db.prepare("SELECT * FROM funding WHERE status = 'found'").all().map(rowToFunding);
  const up = db.prepare('INSERT OR REPLACE INTO launch_stats(mint, json, updated_at) VALUES(?,?,?)');
  db.exec('BEGIN');
  for (const t of tracked.values()) {
    if (!t.dirty) continue;
    t.dirty = false;
    const first = t.series.first;
    const myGaps = gaps.filter((g) => (g.mint == null || g.mint === t.launch.mint) && first && g.toTime >= first.chainTime && g.fromTime <= (t.series.last?.chainTime ?? 0));
    const ctx = { launch: t.launch, all: t.series.swaps, gaps: myGaps, usd, funding, historyTruncated: t.launch.origin === 'search' };
    up.run(t.launch.mint, JSON.stringify({ ...launchStats(ctx), lastSwapAt: t.series.last?.chainTime ?? null }), now());
  }
  db.exec('COMMIT');
}

function flushHealth() {
  const t = now();
  health.eventsWindow = health.eventsWindow.filter((x) => t - x < 60_000);
  const lags = [...health.lags].sort((a, b) => a - b);
  const q = (p: number) => (lags.length ? lags[Math.min(lags.length - 1, Math.floor(lags.length * p))] : null);
  const openGaps = (db.prepare("SELECT COUNT(*) AS n FROM gaps WHERE status = 'open'").get() as any).n;
  const h = {
    ws: health.ws,
    connectedSince: health.connectedSince,
    reconnects: health.reconnects,
    lastMessageAt: health.lastMessageAt,
    lastEventSlot: health.lastEventSlot,
    eventsPerMin: health.eventsWindow.length,
    chainLagP50: q(0.5),
    chainLagP95: q(0.95),
    rpcCalls: health.rpcCalls,
    rpcErrors: health.rpcErrors,
    rateLimited: health.rateLimited,
    openGaps,
    decodeErrors: health.decodeErrors,
    trackedMints: tracked.size,
    inserted: health.inserted,
    duplicates: health.duplicates,
    unpriced: health.unpriced,
    rotations,
    updatedAt: t,
  };
  setMeta(db, 'health', JSON.stringify(h));
}

function prune() {
  const cut = Math.floor(now() / 1000) - RETENTION_HOURS * 3600;
  const r = db.prepare('DELETE FROM swaps WHERE chain_time < ?').run(cut);
  db.prepare('DELETE FROM launches WHERE COALESCE(created_at, first_observed_at / 1000) < ? AND mint NOT IN (SELECT DISTINCT mint FROM swaps)').run(cut);
  db.prepare('DELETE FROM launch_stats WHERE mint NOT IN (SELECT mint FROM launches)').run();
  db.prepare('DELETE FROM gaps WHERE to_time < ?').run(cut);
  db.prepare('DELETE FROM usd_refs WHERE t < ?').run((cut - 3600) * 1000);
  for (const [m, t] of tracked) if ((t.launch.createdAt ?? t.launch.firstObservedAt / 1000) < cut && t.lastSwapAt < cut) tracked.delete(m);
  if (Number(r.changes)) log(`pruned ${r.changes} swaps older than ${RETENTION_HOURS} h`);
}

/** A worker restart is an outage too: record it as a gap and backfill it. */
function recordDowntime() {
  const prev = getMeta(db, 'health');
  const last = prev ? (JSON.parse(prev).lastMessageAt as number | null) : null;
  if (!last || now() - last < 5000) return;
  outageStart = { at: last, slot: JSON.parse(prev!).lastEventSlot ?? null };
  log(`worker was down since ${new Date(last).toISOString()} — gap will be backfilled on first event`);
}

export function start(d: DatabaseSync = db) {
  void d;
  loadState();
  recordDowntime();
  connect();
  void pollUsd();
  setInterval(pollUsd, 60_000);
  setInterval(flushStats, 2000);
  setInterval(flushHealth, 2000);
  setInterval(prune, 10 * 60_000);
  prune();
  log(`collector up · ${WS_URL.replace(/api-key=[^&]+/, 'api-key=***')} · commitment ${COMMITMENT}`);
}

start();
process.on('SIGINT', () => {
  log('stopping');
  flushStats();
  flushHealth();
  process.exit(0);
});
