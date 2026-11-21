// Data sources for the browser. Demo and live data are kept strictly apart (separate handles, URLs, caches).
import { DEMO_LIVE_OPEN_AT, DEMO_SCRIPTS, demoBundle, demoCoverage, demoMint, demoKeyFromMint } from '../../core/demo.ts';
import { SwapSeries } from '../../core/series.ts';
import { makeCtx } from '../../core/context.ts';
import { launchStats, type LaunchStats } from '../../core/metrics.ts';
import type { Coverage, DataMode, FundingEvidence, Gap, Launch, LaunchBundle, SwapLeg } from '../../core/types.ts';

export interface CollectorHealth {
  ws: 'connected' | 'connecting' | 'reconnecting' | 'down';
  connectedSince: number | null;
  reconnects: number;
  lastMessageAt: number | null;
  lastEventSlot: number | null;
  eventsPerMin: number;
  chainLagP50: number | null; // ms, collector observed − on-chain clock
  chainLagP95: number | null;
  rpcCalls: number;
  rpcErrors: number;
  rateLimited: number;
  openGaps: number;
  decodeErrors: number;
  trackedMints: number;
  updatedAt: number;
}

export interface StreamStatus {
  state: 'connecting' | 'live' | 'reconnecting' | 'offline' | 'replay';
  reconnects: number;
  lastMsgAt: number; // browser ms
  collector: CollectorHealth | null;
  resumedFrom: number | null; // seq
  duplicatesDropped: number;
  displayLag: { collectorToScreen: number | null; chainToScreen: number | null }; // ms of last batch
}

export interface LaunchHandle {
  mode: DataMode;
  mint: string;
  bundle: LaunchBundle;
  series: SwapSeries;
  status: StreamStatus;
  live: boolean;
  subscribe(fn: () => void): () => void;
  release(): void;
  chainNow(): number; // estimated chain clock, ms
  setOffline?(v: boolean): void;
  offline?: boolean;
}

export interface LaunchRow {
  launch: Launch;
  stats: LaunchStats;
  active: boolean; // traded within the last 5 minutes (chain clock)
}

// ───────────────────────── demo ─────────────────────────

let demoSessionStart = 0;
const demoHandles = new Map<string, LaunchHandle>();

function demoClockFor(b: LaunchBundle) {
  const first = b.legs[0];
  if (!demoSessionStart) demoSessionStart = Date.now();
  return () => (first.chainTime + DEMO_LIVE_OPEN_AT) * 1000 + (Date.now() - demoSessionStart);
}

function openDemo(mint: string): LaunchHandle | null {
  const hit = demoHandles.get(mint);
  if (hit) return hit;
  const key = demoKeyFromMint(mint);
  if (!key) return null;
  const bundle = demoBundle(key)!;
  const series = new SwapSeries(mint);
  const listeners = new Set<() => void>();
  const isLive = key === 'orbit';
  const status: StreamStatus = {
    state: isLive ? 'live' : 'replay',
    reconnects: 0,
    lastMsgAt: Date.now(),
    collector: null,
    resumedFrom: null,
    duplicatesDropped: 0,
    displayLag: { collectorToScreen: null, chainToScreen: null },
  };
  const notify = () => listeners.forEach((l) => l());
  let h: LaunchHandle;
  if (!isLive) {
    series.add(bundle.legs, Date.now());
    h = { mode: 'demo', mint, bundle, series, status, live: false, subscribe: (f) => (listeners.add(f), () => listeners.delete(f)), release() {}, chainNow: () => (series.last?.chainTime ?? 0) * 1000 };
  } else {
    const clock = demoClockFor(bundle);
    let cursor = 0;
    let wasOffline = false;
    const deliver = () => {
      if (h.offline) {
        if (status.state !== 'reconnecting') {
          status.state = 'reconnecting';
          wasOffline = true;
          notify();
        }
        return;
      }
      const now = clock();
      const batch: SwapLeg[] = [];
      if (wasOffline) {
        // reconnect: resume from the last seq we had, and re-send a few legs on purpose to prove de-duplication
        status.resumedFrom = series.maxSeq;
        status.reconnects++;
        const replayFrom = Math.max(0, cursor - 12);
        for (let i = replayFrom; i < cursor; i++) batch.push(bundle.legs[i]);
        wasOffline = false;
      }
      while (cursor < bundle.legs.length && bundle.legs[cursor].observedAt <= now) batch.push(bundle.legs[cursor++]);
      if (status.state !== 'live') status.state = 'live';
      if (batch.length) {
        const before = series.duplicatesDropped;
        const recv = Date.now();
        series.add(batch, recv);
        status.duplicatesDropped += series.duplicatesDropped - before;
        const last = batch[batch.length - 1];
        status.displayLag = { collectorToScreen: now - last.observedAt, chainToScreen: now - last.chainTime * 1000 };
        status.lastMsgAt = recv;
      }
      notify();
    };
    h = {
      mode: 'demo',
      mint,
      bundle,
      series,
      status,
      live: true,
      offline: false,
      subscribe: (f) => (listeners.add(f), () => listeners.delete(f)),
      release() {},
      chainNow: clock,
      setOffline(v) {
        h.offline = v;
        deliver();
      },
    };
    deliver();
    setInterval(deliver, 200);
  }
  demoHandles.set(mint, h);
  return h;
}

export const DEMO_DEFAULT_MINT = demoMint('orbit');

function demoRows(): LaunchRow[] {
  return DEMO_SCRIPTS.map((sc) => {
    const mint = demoMint(sc.key);
    const h = openDemo(mint)!;
    const stats = launchStats(makeCtx(h.bundle, h.series));
    return { launch: h.bundle.launch, stats, active: h.live };
  });
}

// ───────────────────────── live ─────────────────────────

const liveHandles = new Map<string, { h: LaunchHandle; refs: number; es: EventSource | null; timer: number | null }>();

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => '')}`.trim());
  return r.json() as Promise<T>;
}

async function openLive(mint: string): Promise<LaunchHandle> {
  if (mint === REFERENCE.mint) return referenceHandle();
  const hit = liveHandles.get(mint);
  if (hit) {
    hit.refs++;
    if (!hit.es) connect(hit);
    return hit.h;
  }
  const bundle = await getJSON<LaunchBundle>(`/api/launch/${encodeURIComponent(mint)}`);
  const series = new SwapSeries(mint);
  series.add(bundle.legs, Date.now());
  const listeners = new Set<() => void>();
  const status: StreamStatus = {
    state: 'connecting',
    reconnects: 0,
    lastMsgAt: Date.now(),
    collector: null,
    resumedFrom: null,
    duplicatesDropped: 0,
    displayLag: { collectorToScreen: null, chainToScreen: null },
  };
  const entry = {
    refs: 1,
    es: null as EventSource | null,
    timer: null as number | null,
    h: {
      mode: 'live' as const,
      mint,
      bundle,
      series,
      status,
      live: true,
      subscribe: (f: () => void) => (listeners.add(f), () => listeners.delete(f)),
      release: () => {
        entry.refs--;
        if (entry.refs <= 0) {
          entry.es?.close();
          entry.es = null;
          if (entry.timer) clearInterval(entry.timer);
          entry.timer = null;
        }
      },
      chainNow: () => Date.now(),
      _notify: () => listeners.forEach((l) => l()),
    } as LaunchHandle & { _notify: () => void },
  };
  liveHandles.set(mint, entry);
  connect(entry);
  return entry.h;
}

function connect(entry: { h: LaunchHandle; es: EventSource | null; timer: number | null; refs?: number }) {
  const h = entry.h as LaunchHandle & { _notify: () => void };
  const after = h.series.maxSeq;
  h.status.resumedFrom = after || null;
  const es = new EventSource(`/api/stream?mint=${encodeURIComponent(h.mint)}&after=${after}`);
  entry.es = es;
  // liveness: the server sends a status heartbeat every 3 s. A proxy can keep a dead stream half-open,
  // so after 10 s of silence we reconnect ourselves and resume from the last sequence we hold.
  let lastAny = Date.now();
  const touch = () => (lastAny = Date.now());
  ['open', 'legs', 'status'].forEach((t) => es.addEventListener(t, touch));
  if (entry.timer) clearInterval(entry.timer);
  entry.timer = window.setInterval(() => {
    if (entry.es !== es) return;
    if (Date.now() - lastAny > 10_000) {
      es.close();
      h.status.state = 'reconnecting';
      h.status.reconnects++;
      h._notify();
      connect(entry);
    }
  }, 2000);
  es.addEventListener('open', () => {
    h.status.state = 'live';
    h._notify();
  });
  es.addEventListener('error', () => {
    // EventSource reconnects by itself and sends Last-Event-ID; we only report it.
    h.status.state = es.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting';
    h.status.reconnects++;
    h._notify();
  });
  es.addEventListener('legs', (ev) => {
    const legs = JSON.parse((ev as MessageEvent).data) as SwapLeg[];
    const recv = Date.now();
    const before = h.series.duplicatesDropped;
    h.series.add(legs, recv);
    h.status.duplicatesDropped += h.series.duplicatesDropped - before;
    const last = legs[legs.length - 1];
    if (last) h.status.displayLag = { collectorToScreen: recv - last.observedAt, chainToScreen: recv - last.chainTime * 1000 };
    h.status.lastMsgAt = recv;
    h.status.state = 'live';
    h._notify();
  });
  es.addEventListener('status', (ev) => {
    const d = JSON.parse((ev as MessageEvent).data) as { collector: CollectorHealth; launch?: Launch; gaps?: Gap[]; funding?: FundingEvidence[] };
    h.status.collector = d.collector;
    if (d.launch) h.bundle.launch = d.launch;
    if (d.gaps) h.bundle.gaps = d.gaps;
    if (d.funding) h.bundle.funding = d.funding;
    h._notify();
  });
}

// ───────────────────────── public API ─────────────────────────

export async function openLaunch(mode: DataMode, mint: string): Promise<LaunchHandle> {
  if (mode === 'demo') {
    const h = openDemo(mint);
    if (!h) throw new Error('Unknown demo launch');
    return h;
  }
  return openLive(mint);
}

export interface LaunchList {
  rows: LaunchRow[];
  coverage: Coverage;
  collector: CollectorHealth | null;
}

export async function listLaunches(mode: DataMode): Promise<LaunchList> {
  if (mode === 'demo') return { rows: demoRows(), coverage: demoCoverage(), collector: null };
  const ref = await referenceHandle()
    .then((h): LaunchRow => ({ launch: h.bundle.launch, stats: launchStats(makeCtx(h.bundle, h.series)), active: false }))
    .catch(() => null);
  try {
    const l = await getJSON<LaunchList>('/api/launches');
    if (ref && !l.rows.some((r) => r.launch.mint === ref.launch.mint)) l.rows.unshift(ref);
    return l;
  } catch (e) {
    if (!ref) throw e;
    return { rows: [ref], coverage: ref.launch && (await referenceHandle()).bundle.coverage, collector: null };
  }
}

export async function fetchFunding(wallet: string): Promise<{ status: string; evidence?: FundingEvidence; note?: string }> {
  return getJSON(`/api/funding/${encodeURIComponent(wallet)}`);
}

export async function trackMint(mint: string): Promise<{ ok: boolean; note: string }> {
  const r = await fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint }) });
  return r.json();
}

let liveAvailable: Promise<boolean> | null = null;
export function isLiveAvailable(): Promise<boolean> {
  if (!liveAvailable)
    liveAvailable = fetch('/api/health')
      .then((r) => r.ok)
      .catch(() => false);
  return liveAvailable;
}

/** A frozen replay of the first `seconds` of a demo launch (landing page, film). Not live. */
const replayCache = new Map<string, LaunchHandle>();
export function demoReplayHandle(key: string, seconds: number): LaunchHandle {
  const id = `${key}:${seconds}`;
  const hit = replayCache.get(id);
  if (hit) return hit;
  const full = demoBundle(key)!;
  const start = full.legs[0].chainTime;
  const legs = full.legs.filter((l) => l.chainTime <= start + seconds);
  const bundle: LaunchBundle = { ...full, legs };
  const series = new SwapSeries(full.launch.mint);
  series.add(legs, 0);
  const h: LaunchHandle = {
    mode: 'demo',
    mint: full.launch.mint,
    bundle,
    series,
    live: false,
    status: { state: 'replay', reconnects: 0, lastMsgAt: 0, collector: null, resumedFrom: null, duplicatesDropped: 0, displayLag: { collectorToScreen: null, chainToScreen: null } },
    subscribe: () => () => {},
    release() {},
    chainNow: () => (series.last?.chainTime ?? 0) * 1000,
  };
  replayCache.set(id, h);
  return h;
}

/** Shared demo links may point past the demo clock: move the (demo-only) clock forward so the range exists. */
export function ensureDemoClock(mint: string, tlMs: number) {
  const key = demoKeyFromMint(mint);
  if (key !== 'orbit') return;
  const b = demoBundle(key)!;
  const clock = demoClockFor(b);
  const need = tlMs + 3000 - clock();
  if (need > 0) demoSessionStart -= need;
}

// ───────────────────────── reference replays (real, archived, static) ─────────────────────────

export interface Provenance {
  mint: string;
  pool: string;
  windowUtc: [string, string];
  rpc: string;
  method: string;
  signatures: number;
  failedTransactions: number;
  unavailable: number;
  swaps: number;
  builtAt: string;
  context: string;
}

export const REFERENCE = {
  key: 'dacity-gta6',
  mint: 'nxPqZ4F7ux8Vph5NFu25rEP6Kx9Gr1U6Fmj36Rjpump',
  url: '/data/dacity-gta6.json',
  context: 'A GTA VI trailer shows a fictional “Dacity Coin”. The real Solana token with that name goes from $96k to $540k market cap in 35 seconds. These are those swaps.',
};

const refCache = new Map<string, Promise<LaunchHandle & { provenance: Provenance }>>();

/** Real on-chain swaps rebuilt from mainnet (scripts/fetch-reference.ts). A replay: never live, explorer links on. */
export function referenceHandle(url = REFERENCE.url): Promise<LaunchHandle & { provenance: Provenance }> {
  let p = refCache.get(url);
  if (!p) {
    p = getJSON<LaunchBundle & { provenance: Provenance }>(url).then((bundle) => {
      const series = new SwapSeries(bundle.launch.mint);
      series.add(bundle.legs, 0);
      return {
        mode: 'live' as const,
        mint: bundle.launch.mint,
        bundle,
        series,
        live: false,
        provenance: bundle.provenance,
        status: { state: 'replay' as const, reconnects: 0, lastMsgAt: 0, collector: null, resumedFrom: null, duplicatesDropped: 0, displayLag: { collectorToScreen: null, chainToScreen: null } },
        subscribe: () => () => {},
        release() {},
        chainNow: () => (series.last?.chainTime ?? 0) * 1000,
      };
    });
    refCache.set(url, p);
  }
  return p;
}
