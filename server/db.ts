// SQLite persistence (node:sqlite, WAL). Worker writes, API reads; both can run at once.
// Production path: same schema on PostgreSQL (see README).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { FundingEvidence, Gap, Launch, SwapLeg, UsdRef } from '../src/core/types.ts';

export const DB_PATH = resolve(process.env.TAPEZERO_DB ?? 'data/tapezero.db');

export function openDb(): DatabaseSync {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS launches (
      mint TEXT PRIMARY KEY, name TEXT, symbol TEXT, uri TEXT, creator TEXT, bonding_curve TEXT,
      created_slot INTEGER, created_at INTEGER, create_sig TEXT, origin TEXT NOT NULL, phase TEXT NOT NULL,
      pool TEXT, first_observed_at INTEGER NOT NULL, supply REAL NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS launches_updated ON launches(updated_at);
    CREATE TABLE IF NOT EXISTS swaps (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, mint TEXT NOT NULL, venue TEXT NOT NULL,
      signature TEXT NOT NULL, ev_index INTEGER NOT NULL, slot INTEGER NOT NULL, chain_time INTEGER NOT NULL,
      observed_at INTEGER NOT NULL, source TEXT NOT NULL, wallet TEXT NOT NULL, side TEXT NOT NULL,
      sol REAL NOT NULL, tokens REAL NOT NULL, price_sol REAL NOT NULL, reserve_sol REAL
    );
    CREATE INDEX IF NOT EXISTS swaps_mint ON swaps(mint, chain_time);
    CREATE INDEX IF NOT EXISTS swaps_time ON swaps(chain_time);
    CREATE TABLE IF NOT EXISTS gaps (
      id TEXT PRIMARY KEY, mint TEXT, from_time INTEGER NOT NULL, to_time INTEGER NOT NULL,
      from_slot INTEGER, to_slot INTEGER, status TEXT NOT NULL, note TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usd_refs (t INTEGER PRIMARY KEY, sol_usd REAL NOT NULL, source TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS funding (
      wallet TEXT PRIMARY KEY, funder TEXT, sol REAL, signature TEXT, chain_time INTEGER,
      method TEXT, status TEXT NOT NULL, checked_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS launch_stats (mint TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pools (pool TEXT PRIMARY KEY, mint TEXT NOT NULL, quote_mint TEXT, source TEXT);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

type Row = Record<string, unknown>;

export const rowToLeg = (r: Row): SwapLeg => ({
  id: r.id as string,
  seq: r.seq as number,
  mint: r.mint as string,
  venue: r.venue as SwapLeg['venue'],
  signature: r.signature as string,
  evIndex: r.ev_index as number,
  slot: r.slot as number,
  chainTime: r.chain_time as number,
  observedAt: r.observed_at as number,
  source: r.source as SwapLeg['source'],
  wallet: r.wallet as string,
  side: r.side as SwapLeg['side'],
  sol: r.sol as number,
  tokens: r.tokens as number,
  priceSol: r.price_sol as number,
  reserveSol: (r.reserve_sol as number | null) ?? null,
});

export const rowToLaunch = (r: Row): Launch => ({
  mint: r.mint as string,
  name: (r.name as string) || '',
  symbol: (r.symbol as string) || '',
  creator: (r.creator as string) ?? null,
  createdSlot: (r.created_slot as number) ?? null,
  createdAt: (r.created_at as number) ?? null,
  createSignature: (r.create_sig as string) ?? null,
  origin: r.origin as Launch['origin'],
  phase: r.phase as Launch['phase'],
  pool: (r.pool as string) ?? null,
  firstObservedAt: r.first_observed_at as number,
  supply: r.supply as number,
  mode: 'live',
});

export const rowToGap = (r: Row): Gap => ({
  id: r.id as string,
  mint: (r.mint as string) ?? null,
  fromTime: r.from_time as number,
  toTime: r.to_time as number,
  fromSlot: (r.from_slot as number) ?? null,
  toSlot: (r.to_slot as number) ?? null,
  status: r.status as Gap['status'],
  note: r.note as string,
});

export const rowToUsd = (r: Row): UsdRef => ({ t: r.t as number, solUsd: r.sol_usd as number, source: r.source as string });

export const rowToFunding = (r: Row): FundingEvidence => ({
  wallet: r.wallet as string,
  funder: r.funder as string,
  sol: r.sol as number,
  signature: r.signature as string,
  chainTime: (r.chain_time as number) ?? null,
  method: r.method as string,
});

export function getMeta(db: DatabaseSync, key: string): string | null {
  const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
  return r ? (r.value as string) : null;
}
export function setMeta(db: DatabaseSync, key: string, value: string) {
  db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export const RETENTION_HOURS = Number(process.env.RETENTION_HOURS ?? 48);
