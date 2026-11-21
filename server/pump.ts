// Decoders for pump.fun (bonding curve) and PumpSwap (AMM) Anchor events found in program logs.
// Verified against live mainnet logs on 2026-11-21 (see README "Sources").
import { createHash } from 'node:crypto';

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMPSWAP_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const WSOL = 'So11111111111111111111111111111111111111112';

const disc = (n: string) => createHash('sha256').update(`event:${n}`).digest().subarray(0, 8).toString('hex');
const D = {
  trade: disc('TradeEvent'),
  create: disc('CreateEvent'),
  complete: disc('CompleteEvent'),
  migrate: disc('CompletePumpAmmMigrationEvent'),
  buy: disc('BuyEvent'),
  sell: disc('SellEvent'),
  createPool: disc('CreatePoolEvent'),
};

const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58(buf: Uint8Array): string {
  let x = 0n;
  for (const b of buf) x = (x << 8n) | BigInt(b);
  let s = '';
  while (x > 0n) {
    s = A[Number(x % 58n)] + s;
    x /= 58n;
  }
  for (const b of buf) {
    if (b === 0) s = '1' + s;
    else break;
  }
  return s;
}
export function b58decode(s: string): Uint8Array | null {
  let x = 0n;
  for (const c of s) {
    const i = A.indexOf(c);
    if (i < 0) return null;
    x = x * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (x > 0n) {
    out.unshift(Number(x & 255n));
    x >>= 8n;
  }
  for (const c of s) {
    if (c === '1') out.unshift(0);
    else break;
  }
  return Uint8Array.from(out);
}
export const isPubkey = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && b58decode(s)?.length === 32;

export type Decoded =
  | { kind: 'create'; mint: string; name: string; symbol: string; uri: string; bondingCurve: string; user: string; creator: string | null; ts: number | null }
  | { kind: 'trade'; mint: string; sol: number; tokens: number; isBuy: boolean; user: string; ts: number; vSol: number; vTok: number; realSol: number }
  | { kind: 'complete'; mint: string; ts: number }
  | { kind: 'migrate'; mint: string; pool: string; ts: number }
  | { kind: 'amm'; side: 'buy' | 'sell'; pool: string; user: string; ts: number; base: number; quote: number; poolBase: number; poolQuote: number }
  | { kind: 'createPool'; pool: string; baseMint: string; quoteMint: string; baseDec: number; quoteDec: number; ts: number };

export interface DecodedEvent {
  ev: Decoded;
  evIndex: number;
  program: string;
}

const u64 = (b: Buffer, o: number) => Number(b.readBigUInt64LE(o));
const i64 = (b: Buffer, o: number) => Number(b.readBigInt64LE(o));
const pk = (b: Buffer, o: number) => b58(b.subarray(o, o + 32));

function decodeOne(program: string, b: Buffer): Decoded | null {
  const h = b.subarray(0, 8).toString('hex');
  if (program === PUMP_PROGRAM) {
    if (h === D.trade && b.length >= 8 + 32 + 8 + 8 + 1 + 32 + 8 + 8 * 4) {
      let o = 8;
      const mint = pk(b, o);
      o += 32;
      const sol = u64(b, o) / 1e9;
      o += 8;
      const tokens = u64(b, o) / 1e6;
      o += 8;
      const isBuy = b[o] === 1;
      o += 1;
      const user = pk(b, o);
      o += 32;
      const ts = i64(b, o);
      o += 8;
      const vSol = u64(b, o) / 1e9;
      o += 8;
      const vTok = u64(b, o) / 1e6;
      o += 8;
      const realSol = u64(b, o) / 1e9;
      return { kind: 'trade', mint, sol, tokens, isBuy, user, ts, vSol, vTok, realSol };
    }
    if (h === D.create) {
      let o = 8;
      const str = () => {
        const L = b.readUInt32LE(o);
        o += 4;
        const s = b.subarray(o, o + L).toString('utf8');
        o += L;
        return s;
      };
      const name = str();
      const symbol = str();
      const uri = str();
      const mint = pk(b, o);
      o += 32;
      const bondingCurve = pk(b, o);
      o += 32;
      const user = pk(b, o);
      o += 32;
      let creator: string | null = null;
      let ts: number | null = null;
      if (b.length >= o + 40) {
        creator = pk(b, o);
        o += 32;
        ts = i64(b, o);
      }
      return { kind: 'create', mint, name: clean(name), symbol: clean(symbol), uri, bondingCurve, user, creator, ts };
    }
    if (h === D.complete && b.length >= 8 + 96 + 8) return { kind: 'complete', mint: pk(b, 40), ts: i64(b, 104) };
    if (h === D.migrate && b.length >= 168) return { kind: 'migrate', mint: pk(b, 40), ts: i64(b, 128), pool: pk(b, 136) };
    return null;
  }
  if (program === PUMPSWAP_PROGRAM) {
    if ((h === D.buy || h === D.sell) && b.length >= 184) {
      const ts = i64(b, 8);
      const baseAmt = u64(b, 16);
      const poolBase = u64(b, 48);
      const poolQuote = u64(b, 56);
      const quoteGross = u64(b, 64); // quote_amount_in (buy) / quote_amount_out (sell)
      const quoteUser = u64(b, 112); // user_quote_amount_in / user_quote_amount_out
      const isBuy = h === D.buy;
      return {
        kind: 'amm',
        side: isBuy ? 'buy' : 'sell',
        ts,
        pool: pk(b, 120),
        user: pk(b, 152),
        base: baseAmt,
        quote: quoteUser,
        poolBase: isBuy ? poolBase - baseAmt : poolBase + baseAmt,
        poolQuote: isBuy ? poolQuote + quoteGross : poolQuote - quoteGross,
      };
    }
    if (h === D.createPool && b.length >= 205) {
      return { kind: 'createPool', ts: i64(b, 8), baseMint: pk(b, 50), quoteMint: pk(b, 82), baseDec: b[114], quoteDec: b[115], pool: pk(b, 173) };
    }
  }
  return null;
}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64);

/** Walk a transaction's logs, attribute each "Program data:" line to the program currently executing. */
export function decodeLogs(logs: string[]): DecodedEvent[] {
  const stack: string[] = [];
  const out: DecodedEvent[] = [];
  let idx = 0;
  for (const l of logs) {
    if (l.startsWith('Program ') && l.includes(' invoke [')) {
      stack.push(l.slice(8, l.indexOf(' ', 8)));
      continue;
    }
    if (l.startsWith('Program ') && (l.endsWith(' success') || l.includes(' failed'))) {
      stack.pop();
      continue;
    }
    if (!l.startsWith('Program data: ')) continue;
    const prog = stack[stack.length - 1];
    if (prog !== PUMP_PROGRAM && prog !== PUMPSWAP_PROGRAM) continue;
    let b: Buffer;
    try {
      b = Buffer.from(l.slice(14), 'base64');
    } catch {
      continue;
    }
    const ev = (() => {
      try {
        return decodeOne(prog, b);
      } catch {
        return null;
      }
    })();
    if (ev) out.push({ ev, evIndex: idx, program: prog });
    idx++; // index counts every event of our programs, decoded or not — stable between stream and backfill
  }
  return out;
}
