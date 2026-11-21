import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { DataMode } from '../../core/types.ts';
import { SOL_EXPLORER_TOKEN } from '../../core/types.ts';
import { REFERENCE, DEMO_DEFAULT_MINT, ensureDemoClock, isLiveAvailable, listLaunches, openLaunch, trackMint, type LaunchHandle, type LaunchList, type LaunchRow } from '../data/sources.ts';
import { Link, navigate } from '../router.tsx';
import { Chart, Overview } from '../player/Chart.tsx';
import { CandlePanel, filterIds } from '../player/CandlePanel.tsx';
import { readInit, Transport, usePlayer, usePlayerKeys, useShare, type PlayerInit } from '../player/usePlayer.tsx';
import { fmtDur, fmtSol, fmtUsd, short, fmtDate } from '../../core/format.ts';
import { isDemoMint } from '../../core/demo.ts';
import { Archive } from './Archive.tsx';
import { Compare } from './Compare.tsx';
import { Blind } from './Blind.tsx';
import { Wordmark } from '../landing/Brand.tsx';
import { busiestCandle } from '../landing/LandingPlayer.tsx';

const MemoPanel = memo(CandlePanel);

export default function Terminal({ path, search }: { path: string; search: string }) {
  const parts = path.split('/').filter(Boolean); // app, mode, view, arg
  const mode = parts[1] as DataMode | undefined;
  useEffect(() => {
    if (mode !== 'live' && mode !== 'demo') {
      navigate(`/app/live/token/${REFERENCE.mint}`, true);
    }
  }, [mode]);
  if (mode !== 'live' && mode !== 'demo') return <div className="boot dots-bg"><Wordmark /></div>;
  const view = parts[2] ?? 'token';
  const arg = parts[3] ? decodeURIComponent(parts[3]) : null;
  return (
    <div className={`term mode-${mode}`}>
      <TopBar mode={mode} view={view} arg={arg} />
      {view === 'archive' ? <Archive mode={mode} /> : view === 'compare' ? <Compare mode={mode} search={search} /> : view === 'blind' && arg ? <Blind mode={mode} mint={arg} /> : <LiveView mode={mode} mint={arg} search={search} />}
    </div>
  );
}

function TopBar({ mode, view, arg }: { mode: DataMode; view: string; arg: string | null }) {
  const [live, setLive] = useState<boolean | null>(null);
  useEffect(() => {
    isLiveAvailable().then(setLive);
  }, []);
  const tab = (v: string, label: string, to: string) => (
    <Link to={to} className={`tab${view === v || (v === 'token' && view === 'blind') ? ' on' : ''}`} aria-current={view === v ? 'page' : undefined}>
      {label}
    </Link>
  );
  const switchTo = (m: DataMode) => {
    if (m === mode) return;
    navigate(`/app/${m}${view === 'archive' || view === 'compare' ? '/' + view : ''}`);
  };
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="TAPEZERO home">
        <Wordmark />
      </Link>
      <nav className="tabs" aria-label="Terminal views">
        {tab('token', 'Live', `/app/${mode}${arg && view === 'token' ? `/token/${arg}` : ''}`)}
        {tab('archive', 'Archive', `/app/${mode}/archive`)}
        {tab('compare', 'Compare', `/app/${mode}/compare`)}
      </nav>
      <div className="modeswitch" role="group" aria-label="Data source">
        <button type="button" className={mode === 'live' ? 'on' : ''} aria-pressed={mode === 'live'} onClick={() => switchTo('live')} disabled={live === false} title={live === false ? 'Collector API not reachable — start `npm start` and `npm run worker`' : 'Solana mainnet data'}>
          Mainnet
        </button>
        <button type="button" className={mode === 'demo' ? 'on' : ''} aria-pressed={mode === 'demo'} onClick={() => switchTo('demo')}>
          Demo data
        </button>
      </div>
    </header>
  );
}

// ───────────────────────── Live view ─────────────────────────

function LiveView({ mode, mint, search }: { mode: DataMode; mint: string | null; search: string }) {
  const [list, setList] = useState<LaunchList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      listLaunches(mode)
        .then((l) => alive && (setList(l), setErr(null)))
        .catch((e) => alive && setErr(String(e.message ?? e)));
    load();
    const i = setInterval(load, mode === 'live' ? 3000 : 2000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [mode]);
  // default token
  useEffect(() => {
    if (mint || !list) return;
    const pick = mode === 'demo' ? DEMO_DEFAULT_MINT : REFERENCE.mint;
    if (pick) navigate(`/app/${mode}/token/${pick}`, true);
  }, [mint, list, mode]);
  const wrongMode = mint && (mode === 'demo') !== isDemoMint(mint);
  return (
    <div className={`live-grid${feedOpen ? ' feed-open' : ''}`}>
      <aside className="feed" aria-label="Launch feed">
        <Feed mode={mode} list={list} err={err} current={mint} onPick={() => setFeedOpen(false)} />
      </aside>
      <button type="button" className="btn btn-s feed-toggle" onClick={() => setFeedOpen((v) => !v)} aria-expanded={feedOpen}>
        {feedOpen ? 'Close launches' : 'Launches'}
      </button>
      {wrongMode ? (
        <div className="center-empty dots-bg">
          <p>{mode === 'demo' ? 'This is a mainnet mint — open it in Mainnet mode.' : 'This is a demo mint — demo data never mixes with mainnet data.'}</p>
          <Link className="btn btn-primary" to={`/app/${mode === 'demo' ? 'live' : 'demo'}/token/${mint}${search}`}>
            Open in {mode === 'demo' ? 'Mainnet' : 'Demo'} mode
          </Link>
        </div>
      ) : mint ? (
        <TokenLoader key={mode + mint} mode={mode} mint={mint} init={readInit(search)} />
      ) : (
        <div className="center-empty dots-bg">
          <p className="muted">{mode === 'live' ? (err ? `Collector API unreachable: ${err}` : 'Waiting for the first launch…') : 'Loading demo tape…'}</p>
        </div>
      )}
    </div>
  );
}

function Feed({ mode, list, err, current, onPick }: { mode: DataMode; list: LaunchList | null; err: string | null; current: string | null; onPick: () => void }) {
  const [q, setQ] = useState('');
  const [age, setAge] = useState<'all' | '5m' | '1h' | '48h'>('all');
  const [phase, setPhase] = useState<'all' | 'bonding' | 'migrated'>('all');
  const [minLiq, setMinLiq] = useState(0);
  const [quality, setQuality] = useState<'all' | 'complete' | 'partial'>('all');
  const [msg, setMsg] = useState<string | null>(null);
  const now = Date.now() / 1000;
  const rows = useMemo(() => {
    if (!list) return [];
    const refNow = mode === 'demo' ? Math.max(...list.rows.map((r) => r.stats.lastSwapAt ?? 0)) : now;
    return list.rows
      .filter((r) => {
        const a = refNow - (r.stats.firstSwapAt ?? r.launch.createdAt ?? refNow);
        if (age === '5m' && a > 300) return false;
        if (age === '1h' && a > 3600) return false;
        if (age === '48h' && a > 172800) return false;
        if (phase !== 'all' && (phase === 'bonding' ? r.launch.phase !== 'bonding' : r.launch.phase === 'bonding')) return false;
        if (minLiq > 0 && (r.stats.liquiditySol ?? 0) < minLiq) return false;
        const partial = r.stats.historyTruncated || r.stats.gaps > 0;
        if (quality === 'complete' && partial) return false;
        if (quality === 'partial' && !partial) return false;
        if (q && !(r.launch.mint.startsWith(q.trim()) || r.launch.symbol.toLowerCase().includes(q.trim().toLowerCase()) || r.launch.name.toLowerCase().includes(q.trim().toLowerCase()))) return false;
        return true;
      })
      .slice(0, 200);
  }, [list, q, age, phase, minLiq, quality, Math.floor(now / 5)]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const m = q.trim();
    if (!m) return;
    const hit = list?.rows.find((r) => r.launch.mint === m);
    if (hit) return navigate(`/app/${mode}/token/${m}`);
    if (mode === 'demo') return setMsg('Not a demo launch.');
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) return setMsg('Not a valid base58 mint address.');
    const r = await trackMint(m).catch(() => ({ ok: false, note: 'API unreachable' }));
    setMsg(r.note);
    if (r.ok) navigate(`/app/live/token/${m}`);
  };
  return (
    <div className="feed-inner">
      <div className="feed-status">
        {mode === 'demo' ? (
          <span className="badge badge-demo">Demo data</span>
        ) : (
          <CollectorPill list={list} err={err} />
        )}
      </div>
      <form onSubmit={submit} role="search" className="feed-search">
        <input value={q} onChange={(e) => (setQ(e.target.value), setMsg(null))} placeholder="Search name or paste a mint" aria-label="Search launches by name or mint" spellCheck={false} />
      </form>
      {msg && <p className="small muted" role="status">{msg}</p>}
      <details className="filters">
        <summary>Filters</summary>
        <label>
          Age
          <select value={age} onChange={(e) => setAge(e.target.value as typeof age)}>
            <option value="all">Any</option>
            <option value="5m">&lt; 5 min</option>
            <option value="1h">&lt; 1 h</option>
            <option value="48h">&lt; 48 h</option>
          </select>
        </label>
        <label>
          Phase
          <select value={phase} onChange={(e) => setPhase(e.target.value as typeof phase)}>
            <option value="all">Any</option>
            <option value="bonding">Bonding curve</option>
            <option value="migrated">Completed / PumpSwap</option>
          </select>
        </label>
        <label>
          Min. liquidity (SOL)
          <input type="number" min={0} step={1} value={minLiq} onChange={(e) => setMinLiq(Number(e.target.value) || 0)} />
        </label>
        <label>
          Data quality
          <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
            <option value="all">Any</option>
            <option value="complete">Observed from creation, no gaps</option>
            <option value="partial">Partial history or gaps</option>
          </select>
        </label>
      </details>
      <ul className="feed-list" aria-label="Launches">
        {rows.map((r) => (
          <FeedRow key={r.launch.mint} r={r} mode={mode} on={r.launch.mint === current} onPick={onPick} />
        ))}
        {list && rows.length === 0 && <li className="muted small pad">No launch matches.</li>}
      </ul>
    </div>
  );
}

function FeedRow({ r, mode, on, onPick }: { r: LaunchRow; mode: DataMode; on: boolean; onPick: () => void }) {
  const st = r.stats;
  const partial = st.historyTruncated || st.gaps > 0;
  return (
    <li>
      <Link to={`/app/${mode}/token/${r.launch.mint}`} className={`feed-row${on ? ' on' : ''}`} aria-current={on ? 'true' : undefined} onClick={onPick}>
        <span className="fr-top">
          <span className="fr-sym">{r.launch.symbol || short(r.launch.mint)}</span>
          {r.active && <span className="live-dot" title="Traded in the last 5 minutes" aria-label="active" />}
          <span className="fr-fdv mono">{st.fdvPeakUsd != null ? `peak ${fmtUsd(st.fdvPeakUsd)}` : 'FDV n/a'}</span>
        </span>
        <span className="fr-name">{r.launch.name}</span>
        <span className="fr-meta mono">
          {st.swaps} swaps · {st.distinctBuyers} buyers · {fmtSol(st.liquiditySol)} SOL
          {r.launch.mint === REFERENCE.mint ? <span className="tag tag-a">GTA VI · real data</span> : partial && <span className="tag" title={st.historyTruncated ? 'Tracking started after creation' : 'Collector was offline for a moment'}>partial history</span>}
        </span>
      </Link>
    </li>
  );
}

function CollectorPill({ list, err }: { list: LaunchList | null; err: string | null }) {
  if (err) return <span className="pill" title="The live collector (npm run worker + npm start) is not running">Live collector offline · archived replays only</span>;
  const c = list?.collector;
  if (!c) return <span className="pill">{list ? 'Live collector offline · archived replays' : '◌ connecting…'}</span>;
  const stale = Date.now() - c.updatedAt > 15_000;
  const ok = c.ws === 'connected' && !stale;
  return (
    <span className={`pill ${ok ? 'pill-live' : 'pill-bad'}`} title={`reconnects ${c.reconnects} · open gaps ${c.openGaps} · rpc errors ${c.rpcErrors}`}>
      ● {ok ? 'Collector live' : stale ? 'Collector stale' : `Collector ${c.ws}`} · {c.trackedMints} launches · p50 chain lag {c.chainLagP50 != null ? fmtDur(c.chainLagP50, true) : '—'}
    </span>
  );
}

// ───────────────────────── token player ─────────────────────────

function TokenLoader({ mode, mint, init }: { mode: DataMode; mint: string; init: PlayerInit }) {
  const [h, setH] = useState<LaunchHandle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let got: LaunchHandle | null = null;
    if (mode === 'demo') {
      const far = Math.max(init.to ?? 0, init.t ?? 0) * 1000;
      if (far) ensureDemoClock(mint, far);
    }
    openLaunch(mode, mint)
      .then((x) => {
        got = x;
        if (alive) setH(x);
        else x.release();
      })
      .catch((e) => alive && setErr(String(e.message ?? e)));
    return () => {
      alive = false;
      got?.release();
    };
  }, [mode, mint]);
  if (err)
    return (
      <div className="center-empty dots-bg">
        <p>{err.startsWith('404') ? 'This launch is not in the archive. Data is kept 48 h; it may be older, or it was never observed by the collector.' : `Could not load this launch: ${err}`}</p>
        <Link to={`/app/${mode}/archive`} className="btn">Open the archive</Link>
      </div>
    );
  if (!h) return <div className="center-empty dots-bg"><p className="muted mono">Loading tape…</p></div>;
  return <TokenView h={h} init={init} />;
}

function TokenView({ h, init }: { h: LaunchHandle; init: PlayerInit }) {
  const p = usePlayer(h, init);
  const { ctrl, st, metrics } = p;
  usePlayerKeys(ctrl, 'global');
  const { share, msg } = useShare(h, ctrl);
  const [sheet, setSheet] = useState(false);
  const dimIds = useMemo(() => (metrics ? filterIds(metrics, st.filter) : null), [metrics, st.filter]);
  const L = h.bundle.launch;
  const status = h.status;
  const outOfRange = init.from != null && h.series.size > 0 && init.from * 1000 < h.series.start - 1000;
  const firstOpen = useRef(true);
  useEffect(() => {
    if (st.selection && !firstOpen.current) setSheet(true);
    firstOpen.current = false;
  }, [st.selection?.[0], st.selection?.[1]]);
  const freshness = status.displayLag;
  const isRef = L.mint === REFERENCE.mint;
  // the reference replay opens on its busiest five seconds, so the panel explains something right away
  useEffect(() => {
    if (!isRef || init.from != null) return;
    ctrl.set({ viewport: [h.series.start - 2000, h.series.liveEdge + 3000] });
    const [a, b] = busiestCandle(h.series);
    ctrl.select(a, b);
    ctrl.seek(b, true);
  }, [ctrl]);
  return (
    <>
      <main className="center" aria-label="Player">
        <div className="token-head">
          <div>
            <h1 className="token-name">
              {L.name} <span className="muted">${L.symbol}</span>
            </h1>
            <p className="small muted">
              {isRef ? 'Real swaps · 15 Oct 2026 · PumpSwap · ' : L.phase === 'bonding' ? 'pump.fun · ' : 'PumpSwap · '}
              {h.mode === 'demo' ? <span className="mono">{short(L.mint, 6)}</span> : <a className="mono" href={SOL_EXPLORER_TOKEN(L.mint)} target="_blank" rel="noreferrer noopener">{short(L.mint, 6)} ↗</a>}
              {L.origin === 'search' && !isRef && <span className="tag" title="Tracking started after this token was created: earlier swaps are missing">partial history</span>}
            </p>
          </div>
          <div className="statusline" aria-live="polite">
            {h.mode === 'demo' && <span className="badge badge-demo">Demo data</span>}
            <span className={`pill ${status.state === 'live' ? 'pill-live' : status.state === 'replay' ? '' : 'pill-bad'}`}>
              {status.state === 'live' ? '● Stream connected' : status.state === 'replay' ? (isRef ? 'Replay of real data' : 'Replay') : status.state === 'reconnecting' ? `◌ Reconnecting (${status.reconnects})` : status.state === 'offline' ? '◌ Offline — retrying' : '◌ Connecting'}
            </span>
            {h.live && freshness.chainToScreen != null && (
              <span className="small muted" title="Time between the swap on Solana and its display here (Solana timestamps are to the second)">
                {fmtDur(freshness.chainToScreen, true)} behind the chain
              </span>
            )}
            
            {h.setOffline && (
              <button type="button" className="btn btn-ghost btn-s" onClick={() => h.setOffline!(!h.offline)} title="Demo: cut the stream, then restore it to test resume and de-duplication">
                {h.offline ? 'Restore connection' : 'Simulate disconnect'}
              </button>
            )}
          </div>
        </div>
        {outOfRange && <p className="notice">The shared range starts before the first event available for this token. Data outside the 48 h retention (or before the collector started) cannot be replayed.</p>}
        {isRef && <p className="context">{REFERENCE.context}</p>}
        {h.bundle.gaps.length > 0 && <p className="notice small">Some moments were not recorded (collector offline). They appear as hatched “NO DATA” zones.</p>}
        <Chart
          ctrl={ctrl}
          t0={p.t0}
          gaps={h.bundle.gaps}
          isLive={h.live}
          usdPerSol={p.usdPerSol}
          supply={L.supply}
          dimIds={dimIds}
          label={`Price and swap timeline for ${L.name}. Drag to select a window, click a candle to open it.`}
        />
        <Overview ctrl={ctrl} gaps={h.bundle.gaps} />
        <Transport ctrl={ctrl} h={h} t0={p.t0} onShare={share} />
        {msg && <p className="toast" role="status">{msg}</p>}
        <p className="kbd-hint small muted">
          Click a candle to see who traded it · drag to pick a time range · <kbd>Space</kbd> play/pause · <kbd>←</kbd> <kbd>→</kbd> one swap at a time · <kbd>Esc</kbd> clear
        </p>
        <div className="row gap-s pad-t">
          <Link className="btn btn-ghost btn-s" to={`/app/${h.mode}/compare?a=${L.mint}`}>Compare with…</Link>
          <Link className="btn btn-ghost btn-s" to={`/app/${h.mode}/blind/${L.mint}`}>Blind replay</Link>
          {h.mode === 'live' && h.bundle.coverage.collectorStartedAt && <span className="small muted">Collector observing since {fmtDate(h.bundle.coverage.collectorStartedAt)}</span>}
        </div>
      </main>
      <aside className={`panel${sheet ? ' open' : ''}`} aria-label="Selection details">
        <button type="button" className="sheet-handle" onClick={() => setSheet((v) => !v)} aria-expanded={sheet}>
          {metrics ? `Selection · ${metrics.count} swaps` : `Latest swaps · ${h.series.size}`}
        </button>
        <MemoPanel ctrl={ctrl} m={metrics} tape={p.tape} t0={p.t0} mode={h.mode} filter={st.filter} highlight={st.highlight} onShare={share} onFunding={p.addFunding} solUsd={p.usdPerSol} />
      </aside>
    </>
  );
}
