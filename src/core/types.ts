// TAPEZERO — shared event model. Used by the web app, the API, the ingestion worker and the film.
// No DOM, no Node APIs: this file must stay portable.

export type Venue = 'pump-bc' | 'pumpswap' | 'demo';
export type Side = 'buy' | 'sell';
export type DataMode = 'live' | 'demo';
export type SwapSource = 'stream' | 'backfill' | 'demo';

/**
 * One decoded swap leg, as stored by the collector.
 * `id` is stable (`signature:eventIndex`) so stream + backfill + reconnect are idempotent.
 */
export interface SwapLeg {
  id: string;
  seq: number; // server insertion sequence (monotonic) — resume cursor for SSE
  mint: string;
  venue: Venue;
  signature: string;
  evIndex: number; // index of the decoded event inside the transaction logs
  slot: number;
  chainTime: number; // on-chain clock, unix SECONDS (1 s resolution — never invent ms)
  observedAt: number; // unix ms when the collector first received it
  source: SwapSource;
  wallet: string;
  side: Side;
  sol: number; // quote amount, SOL
  tokens: number; // base amount, UI units
  priceSol: number; // SOL per token right after the swap (from reserves)
  reserveSol: number | null; // observable SOL liquidity after the swap (real curve SOL / pool quote reserve)
}

/** An economic swap: legs of one transaction by one wallet in one direction, merged. */
export interface Swap extends SwapLeg {
  legs: number;
  legIds: string[];
  /** Layout position on the timeline, ms. chainTime*1000 + ordinal spacing inside the second (layout only). */
  tl: number;
  /** Rank in the covered history (0 = first observed swap). */
  rank: number;
  /** Time the browser received the event (ms) — distinct from chain time. */
  receivedAt: number;
}

export type LaunchOrigin = 'create-event' | 'search' | 'demo';
export type Phase = 'bonding' | 'complete' | 'migrated';

export interface Launch {
  mint: string;
  name: string;
  symbol: string;
  creator: string | null;
  createdSlot: number | null;
  createdAt: number | null; // chain seconds
  createSignature: string | null;
  origin: LaunchOrigin; // 'search' => creation and early swaps were NOT observed
  phase: Phase;
  pool: string | null;
  firstObservedAt: number; // ms (collector)
  supply: number; // UI units
  mode: DataMode;
  /** Metadata JSON set by the creator (name, image). */
  uri?: string | null;
}

export interface Gap {
  id: string;
  mint: string | null; // null = collector-wide outage
  fromTime: number; // chain seconds
  toTime: number;
  fromSlot: number | null;
  toSlot: number | null;
  status: 'open' | 'backfilled' | 'partial' | 'unrecovered';
  note: string;
}

export interface UsdRef {
  t: number; // ms
  solUsd: number;
  source: string;
}

export interface FundingEvidence {
  wallet: string;
  funder: string;
  sol: number;
  signature: string;
  chainTime: number | null;
  method: string;
}

export interface Coverage {
  mode: DataMode;
  collectorStartedAt: number | null; // ms
  retentionHours: number;
  oldestEventAt: number | null; // chain seconds
  venues: { venue: Venue; status: 'live' | 'partial' | 'not-covered'; note: string }[];
  commitment: string;
  note: string;
}

export interface LaunchBundle {
  launch: Launch;
  legs: SwapLeg[];
  gaps: Gap[];
  usd: UsdRef[];
  funding: FundingEvidence[];
  coverage: Coverage;
}

export const SOL_EXPLORER_TX = (sig: string) => `https://solscan.io/tx/${sig}`;
export const SOL_EXPLORER_ADDR = (a: string) => `https://solscan.io/account/${a}`;
export const SOL_EXPLORER_TOKEN = (m: string) => `https://solscan.io/token/${m}`;
