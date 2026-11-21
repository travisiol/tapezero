// Deterministic demo tape. Every number here is SYNTHETIC and labelled "Demo data" in the UI.
// The same tape drives the landing replay, the terminal demo mode and the launch film.
import type { Coverage, FundingEvidence, Gap, Launch, LaunchBundle, SwapLeg, UsdRef } from './types.ts';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(rng: () => number, n: number) {
  let s = '';
  for (let i = 0; i < n; i++) s += B58[Math.floor(rng() * 58)];
  return s;
}

/** Fixed demo epoch: 2026-11-20 14:00:00 UTC. */
export const DEMO_EPOCH = Date.UTC(2026, 10, 20, 14, 0, 0) / 1000;
export const DEMO_SOL_USD = 150;
const SUPPLY = 1_000_000_000;

interface Ev {
  t: number; // seconds after launch start (fractional, internal only)
  wallet: string;
  side: 'buy' | 'sell';
  sol?: number; // for buys
  sellFrac?: number; // for sells: fraction of wallet's holdings
}

class Curve {
  vSol = 30;
  vTok = 1_073_000_000;
  realSol = 0;
  holdings = new Map<string, number>();
  buy(w: string, sol: number) {
    const k = this.vSol * this.vTok;
    const out = this.vTok - k / (this.vSol + sol);
    this.vSol += sol;
    this.vTok -= out;
    this.realSol += sol;
    this.holdings.set(w, (this.holdings.get(w) ?? 0) + out);
    return out;
  }
  sell(w: string, frac: number) {
    const h = this.holdings.get(w) ?? 0;
    const tok = h * Math.min(1, frac);
    if (tok <= 0) return null;
    const k = this.vSol * this.vTok;
    const sol = this.vSol - k / (this.vTok + tok);
    this.vSol -= sol;
    this.vTok += tok;
    this.realSol -= sol;
    this.holdings.set(w, h - tok);
    return { tok, sol };
  }
  get price() {
    return this.vSol / this.vTok;
  }
}

export interface DemoScript {
  key: string;
  name: string;
  symbol: string;
  startOffset: number; // seconds after DEMO_EPOCH
  origin: Launch['origin'];
  initialVSol?: number;
  usd: boolean;
  gaps: [number, number][]; // seconds after start, collector outage (events inside are dropped)
  blurb: string;
  events: (rng: () => number, W: (i: number) => string, e: Emitter) => void;
}

export interface Emitter {
  push(ev: Ev): void;
  price(): number;
}

const r = (rng: () => number, a: number, b: number) => a + rng() * (b - a);

export const DEMO_SCRIPTS: DemoScript[] = [
  {
    key: 'orbit',
    name: 'Orbit Index',
    symbol: 'ORBT',
    startOffset: 0,
    origin: 'demo',
    usd: true,
    gaps: [],
    blurb: 'Accelerates, peaks on three large buys (two share a funder), early buyers sell into it.',
    events(rng, W, e) {
      e.push({ t: 0, wallet: W(0), side: 'buy', sol: 1.5 }); // creator buy
      let t = 0.6;
      let n = 1;
      // phase 1 — slow open
      while (t < 20) {
        e.push({ t, wallet: W(n++), side: 'buy', sol: r(rng, 0.08, 0.6) });
        if (rng() < 0.15) e.push({ t: t + 0.3, wallet: W(1 + Math.floor(rng() * (n - 1))), side: 'sell', sellFrac: r(rng, 0.2, 0.5) });
        t += r(rng, 0.9, 2.0);
      }
      // phase 2 — acceleration
      while (t < 41) {
        e.push({ t, wallet: W(n++), side: 'buy', sol: r(rng, 0.25, 1.3) * (1 + (t - 20) / 25) });
        if (rng() < 0.12) e.push({ t: t + 0.2, wallet: W(30 + Math.floor(rng() * 40)), side: 'buy', sol: r(rng, 0.1, 0.4) });
        if (rng() < 0.1) e.push({ t: t + 0.35, wallet: W(1 + Math.floor(rng() * (n - 1))), side: 'sell', sellFrac: 0.3 });
        t += r(rng, 0.35, 0.8);
      }
      // the peak — three standout buys, two from wallets funded by the same address
      e.push({ t: 41.6, wallet: W(200), side: 'buy', sol: 4.2 });
      e.push({ t: 42.1, wallet: W(n++), side: 'buy', sol: 0.42 });
      e.push({ t: 42.9, wallet: W(201), side: 'buy', sol: 3.1 });
      e.push({ t: 43.4, wallet: W(n++), side: 'buy', sol: 0.6 });
      e.push({ t: 43.8, wallet: W(2), side: 'sell', sellFrac: 1 }); // early buyer #3 exits into the move
      e.push({ t: 44.5, wallet: W(202), side: 'buy', sol: 2.6 });
      e.push({ t: 45.0, wallet: W(n++), side: 'buy', sol: 0.35 });
      e.push({ t: 45.6, wallet: W(4), side: 'sell', sellFrac: 1 }); // early buyer #5
      e.push({ t: 46.2, wallet: W(n++), side: 'buy', sol: 0.8 });
      t = 47;
      // phase 3 — distribution
      const sellers = [1, 3, 6, 7, 9, 200];
      for (const s of sellers) {
        e.push({ t, wallet: W(s), side: 'sell', sellFrac: s === 200 ? 0.6 : 1 });
        t += r(rng, 0.8, 1.8);
        e.push({ t, wallet: W(n++), side: 'buy', sol: r(rng, 0.1, 0.5) });
        t += r(rng, 0.5, 1.2);
      }
      // phase 4 — long tail that keeps the live demo moving (30 minutes)
      const settle = e.price() * 0.82;
      while (t < 1800) {
        const wave = t > 160 && t < 240 ? 1.25 : 1;
        const target = settle * wave * (1 + 0.08 * Math.sin(t / 90));
        const pBuy = e.price() < target ? 0.62 : 0.22;
        if (rng() < pBuy) e.push({ t, wallet: W(n++ % 400), side: 'buy', sol: r(rng, 0.05, 0.7) });
        else e.push({ t, wallet: W(5 + Math.floor(rng() * Math.min(n, 300))), side: 'sell', sellFrac: r(rng, 0.3, 1) });
        t += r(rng, 0.6, 3.2) / wave;
      }
    },
  },
  {
    key: 'holo',
    name: 'Hollow Choir',
    symbol: 'HOLO',
    startOffset: 3600,
    origin: 'demo',
    usd: true,
    gaps: [],
    blurb: 'Brief peak spread across ~38 buyers, then fades.',
    events(rng, W, e) {
      e.push({ t: 0, wallet: W(0), side: 'buy', sol: 0.8 });
      let t = 0.8;
      let n = 1;
      let total = 0.8;
      while (total < 36.2) {
        const sol = Math.min(r(rng, 0.45, 1.5), 36.2 - total + 0.01);
        e.push({ t, wallet: W(n++), side: 'buy', sol });
        total += sol;
        t += r(rng, 0.25, 0.75);
      }
      // collapse
      for (let i = 1; i < n; i++) {
        e.push({ t, wallet: W(i), side: 'sell', sellFrac: 1 });
        t += r(rng, 0.3, 1.4);
      }
      while (t < 300) {
        e.push({ t, wallet: W(500 + Math.floor(rng() * 30)), side: rng() < 0.4 ? 'buy' : 'sell', sol: r(rng, 0.01, 0.08), sellFrac: 0.5 });
        t += r(rng, 4, 14);
      }
    },
  },
  {
    key: 'stak',
    name: 'Single Stack',
    symbol: 'STAK',
    startOffset: 7200,
    origin: 'demo',
    usd: true,
    gaps: [],
    blurb: 'Same peak as Hollow Choir, reached with one dominant buy.',
    events(rng, W, e) {
      e.push({ t: 0, wallet: W(0), side: 'buy', sol: 0.8 });
      let t = 1.1;
      let n = 1;
      let total = 0.8;
      while (t < 18) {
        const sol = r(rng, 0.12, 0.7);
        e.push({ t, wallet: W(n++), side: 'buy', sol });
        total += sol;
        t += r(rng, 0.9, 2.2);
      }
      e.push({ t: 19.2, wallet: W(99), side: 'buy', sol: 36.2 - total }); // one wallet does most of the move
      t = 20.5;
      while (t < 70) {
        if (rng() < 0.45) e.push({ t, wallet: W(n++), side: 'buy', sol: r(rng, 0.05, 0.4) });
        else e.push({ t, wallet: W(1 + Math.floor(rng() * (n - 1))), side: 'sell', sellFrac: r(rng, 0.3, 1) });
        t += r(rng, 1.2, 3.5);
      }
      e.push({ t: 72, wallet: W(99), side: 'sell', sellFrac: 1 });
      t = 74;
      while (t < 300) {
        e.push({ t, wallet: W(1 + Math.floor(rng() * (n - 1))), side: rng() < 0.3 ? 'buy' : 'sell', sol: r(rng, 0.02, 0.2), sellFrac: 0.6 });
        t += r(rng, 3, 10);
      }
    },
  },
  {
    key: 'kite',
    name: 'Paper Kite',
    symbol: 'KITE',
    startOffset: 10800,
    origin: 'demo',
    usd: true,
    gaps: [],
    blurb: 'Ten wallets in the opening slots (shared funder evidence), $20k in seconds, then empties.',
    events(rng, W, e) {
      e.push({ t: 0, wallet: W(0), side: 'buy', sol: 2 });
      for (let i = 1; i <= 10; i++) e.push({ t: 0.2 + i * 0.12, wallet: W(i), side: 'buy', sol: r(rng, 2.2, 3.4) });
      let t = 2.5;
      let n = 11;
      while (t < 14) {
        e.push({ t, wallet: W(n++), side: 'buy', sol: r(rng, 0.2, 1.1) });
        t += r(rng, 0.4, 1.1);
      }
      for (let i = 1; i <= 10; i++) {
        e.push({ t, wallet: W(i), side: 'sell', sellFrac: 1 });
        t += r(rng, 0.4, 0.9);
      }
      while (t < 240) {
        e.push({ t, wallet: W(11 + Math.floor(rng() * (n - 11))), side: 'sell', sellFrac: 1 });
        t += r(rng, 3, 12);
      }
    },
  },
  {
    key: 'tide',
    name: 'Late Tide',
    symbol: 'TIDE',
    startOffset: 14400,
    origin: 'demo',
    usd: true,
    gaps: [],
    blurb: 'Slow launch: six minutes of steady buying, no spike.',
    events(rng, W, e) {
      e.push({ t: 0, wallet: W(0), side: 'buy', sol: 0.5 });
      let t = 2;
      let n = 1;
      while (t < 600) {
        if (rng() < 0.72) e.push({ t, wallet: W(n++), side: 'buy', sol: r(rng, 0.05, 0.5) });
        else e.push({ t, wallet: W(1 + Math.floor(rng() * (n - 1))), side: 'sell', sellFrac: r(rng, 0.2, 0.7) });
        t += r(rng, 1.5, 6);
      }
    },
  },
  {
    key: 'nova',
    name: 'Nova Relay',
    symbol: 'NOVA',
    startOffset: 18000,
    origin: 'search',
    initialVSol: 48,
    usd: false,
    gaps: [[40, 62]],
    blurb: 'Joined mid-curve (first swap not captured), a 22 s collector gap, and no USD reference.',
    events(rng, W, e) {
      let t = 0;
      let n = 0;
      while (t < 180) {
        if (rng() < 0.6) e.push({ t, wallet: W(n++), side: 'buy', sol: r(rng, 0.1, 0.9) });
        else e.push({ t, wallet: W(Math.floor(rng() * Math.max(1, n))), side: 'sell', sellFrac: r(rng, 0.3, 1) });
        t += r(rng, 0.8, 2.5);
      }
    },
  },
];

const DEMO_FUNDING: Record<string, { funder: number; wallets: number[]; sol: number }[]> = {
  orbit: [{ funder: 900, wallets: [200, 201], sol: 8 }],
  kite: [{ funder: 900, wallets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], sol: 3.5 }],
};

export const demoMint = (key: string) => {
  const rng = mulberry32(hash(key) ^ 0x51ed);
  return `DEMo${key[0].toUpperCase()}${key.slice(1)}${b58(rng, 32 - key.length)}demo`;
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const cache = new Map<string, LaunchBundle>();

export function demoBundle(key: string): LaunchBundle | null {
  const hit = cache.get(key);
  if (hit) return hit;
  const sc = DEMO_SCRIPTS.find((s) => s.key === key);
  if (!sc) return null;
  const rng = mulberry32(hash(sc.key));
  const wrng = mulberry32(hash(sc.key) ^ 0xabc);
  const wallets = new Map<number, string>();
  const W = (i: number) => {
    let w = wallets.get(i);
    if (!w) {
      w = b58(wrng, 44);
      wallets.set(i, w);
    }
    return w;
  };
  const mint = demoMint(sc.key);
  const start = DEMO_EPOCH + sc.startOffset;
  const curve = new Curve();
  if (sc.initialVSol) {
    curve.vSol = sc.initialVSol;
    curve.vTok = (30 * 1_073_000_000) / sc.initialVSol;
    curve.realSol = sc.initialVSol - 30;
  }
  const legs: SwapLeg[] = [];
  const srng = mulberry32(hash(sc.key) ^ 0x777);
  const baseSlot = 400_000_000 + sc.startOffset * 2.5;
  let seq = 0;
  let lastT = 0;
  const apply = (ev0: Ev) => {
    const ev = { ...ev0, t: Math.max(lastT, ev0.t) }; // emission order is time order
    lastT = ev.t;
    let sol: number;
    let tokens: number;
    if (ev.side === 'buy') {
      sol = Math.max(0.001, ev.sol ?? 0.1);
      tokens = curve.buy(ev.wallet, sol);
    } else {
      const res = curve.sell(ev.wallet, ev.sellFrac ?? 1);
      if (!res) return;
      sol = res.sol;
      tokens = res.tok;
    }
    const inGap = sc.gaps.some(([a, b]) => ev.t >= a && ev.t < b);
    const chainTime = Math.floor(start + ev.t);
    const signature = b58(srng, 88);
    if (inGap) return; // the collector was down: the event happened but was not observed
    legs.push({
      id: `${signature}:0`,
      seq: ++seq,
      mint,
      venue: 'demo',
      signature,
      evIndex: 0,
      slot: Math.floor(baseSlot + ev.t * 2.5),
      chainTime,
      observedAt: Math.round((start + ev.t) * 1000 + 900 + srng() * 700),
      source: 'demo',
      wallet: ev.wallet,
      side: ev.side,
      sol: round(sol, 9),
      tokens: round(tokens, 6),
      priceSol: curve.price,
      reserveSol: round(curve.realSol, 9),
    });
  };
  sc.events(rng, W, { push: apply, price: () => curve.price });
  const launch: Launch = {
    mint,
    name: sc.name,
    symbol: sc.symbol,
    creator: sc.origin === 'search' ? null : W(0),
    createdSlot: sc.origin === 'search' ? null : Math.floor(baseSlot),
    createdAt: sc.origin === 'search' ? null : start,
    createSignature: null,
    origin: sc.origin,
    phase: 'bonding',
    pool: null,
    firstObservedAt: start * 1000,
    supply: SUPPLY,
    mode: 'demo',
  };
  const usd: UsdRef[] = [];
  if (sc.usd) for (let t = start - 120; t < start + 1900; t += 60) usd.push({ t: t * 1000, solUsd: DEMO_SOL_USD, source: 'demo fixed reference' });
  const gaps: Gap[] = sc.gaps.map(([a, b], i) => ({
    id: `${sc.key}-gap-${i}`,
    mint,
    fromTime: Math.floor(start + a),
    toTime: Math.floor(start + b),
    fromSlot: Math.floor(baseSlot + a * 2.5),
    toSlot: Math.floor(baseSlot + b * 2.5),
    status: 'unrecovered',
    note: 'Scripted collector outage — events in this range were not observed.',
  }));
  const funding: FundingEvidence[] = [];
  const frng = mulberry32(hash(sc.key) ^ 0xf00d);
  for (const f of DEMO_FUNDING[sc.key] ?? [])
    for (const w of f.wallets)
      funding.push({ wallet: W(w), funder: W(f.funder), sol: f.sol, signature: b58(frng, 88), chainTime: start - 300, method: 'demo: scripted SOL transfer (first inbound transfer)' });
  const bundle: LaunchBundle = { launch, legs, gaps, usd, funding, coverage: demoCoverage() };
  cache.set(key, bundle);
  return bundle;
}

export function demoCoverage(): Coverage {
  return {
    mode: 'demo',
    collectorStartedAt: DEMO_EPOCH * 1000,
    retentionHours: 48,
    oldestEventAt: DEMO_EPOCH,
    venues: [{ venue: 'demo', status: 'live', note: 'Deterministic synthetic tape' }],
    commitment: 'n/a (synthetic)',
    note: 'Demo data — six scripted launches. Wallets, signatures and amounts are synthetic.',
  };
}

export const demoKeyFromMint = (mint: string) => DEMO_SCRIPTS.find((s) => demoMint(s.key) === mint)?.key ?? null;
export const isDemoMint = (mint: string) => mint.startsWith('DEMo') && mint.endsWith('demo');

function round(x: number, d: number) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/** Seconds after first swap at which the live demo session opens. */
export const DEMO_LIVE_OPEN_AT = 32;
