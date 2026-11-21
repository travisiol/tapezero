// TAPEZERO public API + SSE + static site. Read-only on the event store (except on-demand tracking/funding).
//   node server/api.ts         (PORT, default 8787)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { openDb, getMeta, rowToGap, rowToLaunch, rowToLeg, rowToUsd, rowToFunding, RETENTION_HOURS } from './db.ts';
import { isPubkey } from './pump.ts';
import { RateLimiter, rpc } from './rpc.ts';
import type { Coverage, LaunchBundle } from '../src/core/types.ts';

const PORT = Number(process.env.PORT ?? 8790);
const DIST = resolve(process.env.STATIC_DIR ?? 'dist');
const db = openDb();
const rpcLimiter = new RateLimiter(Number(process.env.API_RPC_MAX_RPS ?? 2));

// ───────────── helpers ─────────────
function json(res: ServerResponse, code: number, body: unknown, cache = 'no-store') {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

const hits = new Map<string, { n: number; t: number }>();
function limited(req: IncomingMessage, key: string, max: number, perMs: number): boolean {
  const ip = (req.socket.remoteAddress ?? '?') + key;
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > perMs) {
    hits.set(ip, { n: 1, t: now });
    return false;
  }
  h.n++;
  return h.n > max;
}

function health() {
  const h = getMeta(db, 'health');
  return h ? JSON.parse(h) : null;
}

function coverage(): Coverage {
  const started = Number(getMeta(db, 'collector_started_at')) || null;
  const oldest = db.prepare('SELECT MIN(chain_time) AS t FROM swaps').get() as { t: number | null };
  return {
    mode: 'live',
    collectorStartedAt: started,
    retentionHours: RETENTION_HOURS,
    oldestEventAt: oldest.t ?? null,
    venues: [
      { venue: 'pump-bc', status: 'live', note: 'pump.fun bonding-curve TradeEvents of launches created after the collector started (or tracked on request).' },
      { venue: 'pumpswap', status: 'partial', note: 'PumpSwap Buy/Sell events for pools created by the migration of a tracked launch.' },
    ],
    commitment: 'confirmed',
    note: 'Source: Solana JSON-RPC logsSubscribe on both programs. No history exists before the collector start; outages are recorded as gaps and backfilled from RPC when possible.',
  };
}

function bundle(mint: string): LaunchBundle | null {
  const lr = db.prepare('SELECT * FROM launches WHERE mint = ?').get(mint);
  if (!lr) return null;
  const legs = db.prepare('SELECT * FROM swaps WHERE mint = ? ORDER BY chain_time, slot, seq').all(mint).map(rowToLeg);
  const first = legs[0]?.chainTime ?? Math.floor(Date.now() / 1000);
  const gaps = db
    .prepare('SELECT * FROM gaps WHERE (mint IS NULL OR mint = ?) AND to_time >= ?')
    .all(mint, first)
    .map(rowToGap);
  const usd = db.prepare('SELECT * FROM usd_refs WHERE t >= ? ORDER BY t').all((first - 900) * 1000).map(rowToUsd);
  const wallets = [...new Set(legs.map((l) => l.wallet))];
  const funding = wallets.length
    ? db
        .prepare(`SELECT * FROM funding WHERE status = 'found' AND wallet IN (${wallets.map(() => '?').join(',')})`)
        .all(...wallets)
        .map(rowToFunding)
    : [];
  return { launch: rowToLaunch(lr), legs, gaps, usd, funding, coverage: coverage() };
}

// ───────────── SSE ─────────────
interface Client {
  res: ServerResponse;
  mint: string;
  after: number;
}
const clients = new Set<Client>();
let maxSeq = (db.prepare('SELECT MAX(seq) AS s FROM swaps').get() as { s: number | null }).s ?? 0;
const selNew = db.prepare('SELECT * FROM swaps WHERE seq > ? ORDER BY seq LIMIT 5000');
const selMintAfter = db.prepare('SELECT * FROM swaps WHERE mint = ? AND seq > ? ORDER BY seq');

// poll the store written by the worker; push only new rows (incremental, never the whole chart)
setInterval(() => {
  const rows = selNew.all(maxSeq);
  if (!rows.length) return;
  maxSeq = rows[rows.length - 1].seq as number;
  const byMint = new Map<string, ReturnType<typeof rowToLeg>[]>();
  for (const r of rows) {
    const l = rowToLeg(r);
    const a = byMint.get(l.mint) ?? [];
    a.push(l);
    byMint.set(l.mint, a);
  }
  for (const c of clients) {
    const legs = byMint.get(c.mint)?.filter((l) => l.seq > c.after);
    if (!legs?.length) continue;
    c.after = legs[legs.length - 1].seq;
    c.res.write(`id: ${c.after}\nevent: legs\ndata: ${JSON.stringify(legs)}\n\n`);
  }
}, 150);

// heartbeat with collector status, launch phase, gaps
setInterval(() => {
  const h = health();
  for (const c of clients) {
    const lr = db.prepare('SELECT * FROM launches WHERE mint = ?').get(c.mint);
    const gaps = db.prepare('SELECT * FROM gaps WHERE (mint IS NULL OR mint = ?)').all(c.mint).map(rowToGap);
    c.res.write(`event: status\ndata: ${JSON.stringify({ collector: h, launch: lr ? rowToLaunch(lr) : undefined, gaps })}\n\n`);
  }
}, 3000);

function stream(req: IncomingMessage, res: ServerResponse, url: URL) {
  const mint = url.searchParams.get('mint') ?? '';
  if (!isPubkey(mint)) return json(res, 400, { error: 'invalid mint' });
  if (clients.size > 2000) return json(res, 503, { error: 'too many streams' });
  // resume: Last-Event-ID (automatic EventSource reconnect) wins over ?after
  const after = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0) || 0;
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 2000\n\n');
  const c: Client = { res, mint, after };
  const missed = selMintAfter.all(mint, after).map(rowToLeg);
  if (missed.length) {
    c.after = missed[missed.length - 1].seq;
    res.write(`id: ${c.after}\nevent: legs\ndata: ${JSON.stringify(missed)}\n\n`);
  }
  res.write(`event: status\ndata: ${JSON.stringify({ collector: health() })}\n\n`);
  clients.add(c);
  req.on('close', () => clients.delete(c));
}

// ───────────── funding lookup (on demand, cached, rate-limited) ─────────────
async function funding(wallet: string) {
  const cached = db.prepare('SELECT * FROM funding WHERE wallet = ?').get(wallet) as any;
  if (cached && (cached.status === 'found' || Date.now() - cached.checked_at < 3600_000)) {
    return cached.status === 'found' ? { status: 'found', evidence: rowToFunding(cached) } : { status: cached.status, note: cached.method };
  }
  const save = (status: string, f: { funder?: string; sol?: number; signature?: string; chainTime?: number | null; method: string }) =>
    db.prepare('INSERT OR REPLACE INTO funding(wallet, funder, sol, signature, chain_time, method, status, checked_at) VALUES(?,?,?,?,?,?,?,?)').run(wallet, f.funder ?? null, f.sol ?? null, f.signature ?? null, f.chainTime ?? null, f.method, status, Date.now());
  let before: string | undefined;
  let oldest: any = null;
  for (let page = 0; page < 3; page++) {
    await rpcLimiter.take();
    const sigs = await rpc<any[]>('getSignaturesForAddress', [wallet, { limit: 1000, before }]);
    if (!sigs.length) break;
    oldest = sigs[sigs.length - 1];
    if (sigs.length < 1000) {
      before = undefined;
      break;
    }
    before = oldest.signature;
  }
  if (before) {
    save('too-long', { method: 'history longer than 3000 transactions — first funding not resolved' });
    return { status: 'too-long', note: 'History longer than 3000 transactions.' };
  }
  if (!oldest) {
    save('none', { method: 'no transactions' });
    return { status: 'none' };
  }
  await rpcLimiter.take();
  const tx = await rpc<any>('getTransaction', [oldest.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]);
  const ixs = [...(tx?.transaction?.message?.instructions ?? []), ...(tx?.meta?.innerInstructions ?? []).flatMap((i: any) => i.instructions)];
  const t = ixs.find((ix: any) => ix?.program === 'system' && (ix.parsed?.type === 'transfer' || ix.parsed?.type === 'createAccount') && (ix.parsed?.info?.destination === wallet || ix.parsed?.info?.newAccount === wallet));
  if (!t) {
    save('none', { method: 'oldest transaction has no inbound system transfer' });
    return { status: 'none', note: 'No inbound SOL transfer in the oldest transaction.' };
  }
  const info = t.parsed.info;
  const ev = { funder: info.source, sol: Number(info.lamports) / 1e9, signature: oldest.signature, chainTime: tx.blockTime ?? null, method: 'first inbound SOL transfer (oldest signature, system program)' };
  save('found', ev);
  return { status: 'found', evidence: { wallet, ...ev } };
}

// ───────────── static ─────────────
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.wav': 'audio/wav' };
function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
  let p = normalize(join(DIST, decodeURIComponent(path)));
  if (!p.startsWith(DIST)) return json(res, 403, { error: 'forbidden' });
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
  if (!existsSync(p)) return json(res, 404, { error: 'build the site first: npm run build' });
  const st = statSync(p);
  const type = MIME[extname(p)] ?? 'application/octet-stream';
  const range = req.headers.range;
  const immutable = p.includes(`${join(DIST, 'assets')}`);
  if (range && type === 'video/mp4') {
    const [a, b] = range.replace('bytes=', '').split('-');
    const start = Number(a);
    const end = b ? Number(b) : st.size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    return createReadStream(p, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', 'accept-ranges': 'bytes' });
  createReadStream(p).pipe(res);
}

// ───────────── router ─────────────
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/health') return json(res, 200, { collector: health(), coverage: coverage(), serverTime: Date.now() });
    if (p === '/api/launches') {
      const rows = db
        .prepare(`SELECT l.*, s.json AS stats FROM launches l JOIN launch_stats s ON s.mint = l.mint ORDER BY COALESCE(json_extract(s.json, '$.lastSwapAt'), 0) DESC LIMIT 600`)
        .all();
      const nowS = Date.now() / 1000;
      return json(res, 200, {
        rows: rows
          .map((r) => {
            const stats = JSON.parse(r.stats as string);
            return { launch: rowToLaunch(r), stats, active: stats.lastSwapAt != null && nowS - stats.lastSwapAt < 300 };
          })
          .filter((r) => r.stats.swaps > 0),
        coverage: coverage(),
        collector: health(),
      });
    }
    const m = p.match(/^\/api\/launch\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    if (m) {
      const b = bundle(m[1]);
      return b ? json(res, 200, b) : json(res, 404, { error: 'not in archive (48 h retention, or never observed)' });
    }
    if (p === '/api/stream') return stream(req, res, url);
    const f = p.match(/^\/api\/funding\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    if (f) {
      if (limited(req, 'funding', 30, 60_000)) return json(res, 429, { status: 'rate-limited' });
      return json(res, 200, await funding(f[1]));
    }
    if (p === '/api/track' && req.method === 'POST') {
      if (limited(req, 'track', 10, 60_000)) return json(res, 429, { ok: false, note: 'Too many requests.' });
      let body = '';
      for await (const ch of req) {
        body += ch;
        if (body.length > 1000) break;
      }
      const mint = (() => {
        try {
          return String(JSON.parse(body).mint ?? '');
        } catch {
          return '';
        }
      })();
      if (!isPubkey(mint)) return json(res, 400, { ok: false, note: 'Not a valid mint address.' });
      const n = (db.prepare("SELECT COUNT(*) AS n FROM launches WHERE origin = 'search'").get() as { n: number }).n;
      const exists = db.prepare('SELECT 1 FROM launches WHERE mint = ?').get(mint);
      if (!exists && n >= 300) return json(res, 429, { ok: false, note: 'On-demand tracking is full.' });
      if (!exists)
        db.prepare("INSERT INTO launches(mint, name, symbol, origin, phase, first_observed_at, supply, updated_at) VALUES(?, '', '', 'search', 'bonding', ?, 1000000000, ?)").run(mint, Date.now(), Date.now());
      return json(res, 200, { ok: true, note: exists ? 'Already tracked.' : 'Tracking from now on: earlier swaps were not observed. Swaps appear when this token trades on pump.fun.' });
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    return serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'internal error' });
  }
}).listen(PORT, () => console.log(`TAPEZERO api on http://localhost:${PORT}`));
