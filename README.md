# TAPEZERO

**Every launch, frame by frame.**
Rewind live Solana launches. Inspect the swaps behind every move.

TAPEZERO is an interactive player for pump.fun launches: scrub back into the first transactions while the live feed keeps
running, select a slice of the chart, open the candle to see the swaps (and wallets) behind it, share the exact passage,
compare two launches aligned on their first swap.

It shows observable activity only — no buy/sell signals, no "rug/safe" verdicts, no price prediction.

## Run it

Requirements: Node.js ≥ 22.5 (uses the built-in `node:sqlite`; tested on Node 24.15, Windows 11).

```bash
npm install
cp .env.example .env          # optional — defaults use the public Solana RPC
npm run worker                # terminal 1 — long-running collector (pump.fun + PumpSwap → SQLite)
npm start                     # terminal 2 — API + SSE + static site on http://localhost:8790
npm run dev                   # terminal 3 — Vite dev server on http://localhost:5173 (proxies /api to 8790)
```

Production: `npm run build` then `npm start` serves `dist/` and the API from one process; run `npm run worker`
on a long-lived runtime (VM, container, Fly/Render worker…) — not on a request-scoped/serverless platform.

Without the worker/API the site still works in **Demo data** mode (`/app/demo`), fully client-side.

Other commands:

| command | what it does |
| --- | --- |
| `npm test` | unit tests of the event model, de-duplication, window metrics and demo scenarios |
| `npm run typecheck` | TypeScript, all packages |
| `npm run film:score` | re-synthesise the score → `public/film/score.wav` |
| `npm run film:studio` | open the film in Remotion Studio |
| `npm run film:render` | render film (MP4 H.264 + AAC), film poster, hero poster and share image |

## Layout

```
src/core/      shared, framework-free: event model, ordered/deduplicated series, metrics, player controller,
               demo tape, theme. Used by the web app, the worker and the film.
src/web/       React app — landing (3D hero, embedded player), terminal (/app: Live, Archive, Compare, Blind Replay)
server/        worker.ts (ingestion), api.ts (REST + SSE + static), pump.ts (event decoders), db.ts, rpc.ts
film/          Remotion film (uses the real terminal components) + shared audio/picture cues
scripts/       score.ts (original synthesised score), render-film.mjs
public/film/   tapezero-film.mp4, poster.jpg, score.wav   ·   public/hero-poster.jpg, og.jpg, favicon.svg
tests/         node:test suites
```

## Routes

- `/` — landing. `Open Terminal` → `/app`, `Watch the Film` → modal player (video fetched on open).
- `/app/live/token/<mint>?from=<s>&to=<s>&t=<s>` — mainnet player; `from`/`to`/`t` reopen an exact range (chain-time seconds).
- `/app/demo/token/<mint>?…` — the same player on the deterministic demo tape. Demo and mainnet never mix (separate
  handles, caches and URLs; a demo mint opened in live mode is refused and vice-versa).
- `/app/<mode>/archive`, `/app/<mode>/compare?a=<mint>&b=<mint>&w=30000|60000|300000`, `/app/<mode>/blind/<mint>`.

## Sources (verified 2026-11-21)

| need | source | result |
| --- | --- | --- |
| live launches + bonding-curve swaps | Solana JSON-RPC `logsSubscribe` (mentions pump.fun program `6EF8…F6P`, commitment `confirmed`) | ✅ CreateEvent, TradeEvent, CompleteEvent, CompletePumpAmmMigrationEvent decoded from `Program data:` logs, attributed by the program invoke stack |
| PumpSwap swaps | same, on the pools of tracked launches (`mentions: <pool>`), or the whole program with `PUMPSWAP_FULL=1` | ✅ BuyEvent/SellEvent decoded (pool → mint from the migration event). Live-tested on the whole program; per-pool mode only fires when a tracked launch migrates |
| gap recovery | `getSignaturesForAddress(mint)` + `getTransaction` (maxSupportedTransactionVersion 1) | ✅ backfills active launches after a disconnect; idempotent (`signature:eventIndex`) |
| SOL/USD for FDV | Coinbase spot, sampled every 60 s, stored with its timestamp | ✅ FDV shows its method; absent reference ⇒ "n/a" |
| funding hints | `getSignaturesForAddress(wallet)` → oldest tx → inbound system transfer | ✅ on demand, cached, rate-limited; shown as a hint, never as proof of control |
| GMGN | — | not evaluated: no access provided |

**Measured on the public endpoint (`api.mainnet-beta.solana.com`)** — see the delivery notes in the final report for the
exact numbers of this session. In short: the free WebSocket drops every ~1–2 min (code 1006) and the delivered logs lag the
chain clock by tens of seconds when subscribed to both programs. Gaps are recorded and backfilled, and the UI always shows
chain→screen and collector→screen freshness, but **for real-time use configure a dedicated RPC** (`SOLANA_WS_URL`,
`SOLANA_RPC_URL`). No code change is needed.

Coverage is honest by construction: the archive starts when the collector starts (`collector_started_at`), launches are
followed from their CreateEvent, a mint searched later is tracked "from first observed swap" and labelled as such.

## Data model and rules

- **Event id** = `signature:eventIndex` (index of the event among pump/PumpSwap events in the tx logs) → stream, backfill
  and reconnects are idempotent (`INSERT OR IGNORE`, client de-dup by id).
- **Order**: chain second → slot → signature/event index. On-chain time has 1 s resolution: labels never show
  milliseconds. Inside a second, events are spread evenly *for drawing only*.
- **Economic swaps**: legs of one tx by one wallet in one direction are merged (route legs); the raw list keeps every leg id.
- **Commitment**: `confirmed` only — no provisional events, so nothing needs retracting. Switching to `processed` would
  require the reconciliation path described in the code comments.
- **Price** from curve/pool reserves after each swap; **FDV** = price × supply × dated SOL/USD. Market cap is not shown
  (circulating supply is not observable reliably).
- Every window metric is computed in code from the events, clickable to highlight its swaps, with an explicit
  denominator and a raw list to check the computation. Metrics that depend on history (first-time buyers, early buyers)
  are flagged when the history is truncated.
- No LLM anywhere in the pipeline.

## Art direction

Coral glass on deep bordeaux, diffused orange light, a dot grid that fades out, and the signature detail: the zero's
upper-right edge doubled like two successive frames. Used at full intensity in the hero and the film, as two brief
playhead ghosts when you rewind in the terminal, and not at all behind the data (sober technical grid). Palette and
fonts live in `src/core/theme.ts` and `src/web/styles.css`.

## Film

`film/Film.tsx` — 35 s, 1920×1080, 30 fps. The terminal shots are the real `Chart`, `CandlePanel`, `SwapList`,
`CompareView` and `CompareTable` components driven frame by frame from the same demo tape as the site. The zero is the
same Three.js scene as the hero. Picture and sound share `film/cues.ts` (105 BPM). The score is synthesised by
`scripts/score.ts` (no samples, no third-party audio) and muxed as AAC.

On Windows, if the project path is very long, Chrome cannot start (MAX_PATH). Copy
`node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/` to a short path and set
`REMOTION_BROWSER_EXECUTABLE`.
