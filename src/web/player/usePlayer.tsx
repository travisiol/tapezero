import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { PlayerController, SPEEDS, type PlayerState } from '../../core/player.ts';
import { pickBucket } from '../../core/series.ts';
import { computeWindow, usdAt, type WindowMetrics } from '../../core/metrics.ts';
import { makeCtx } from '../../core/context.ts';
import { fmtClock, fmtDur, fmtTplus } from '../../core/format.ts';
import type { LaunchHandle } from '../data/sources.ts';
import { useCtrl } from './Chart.tsx';
import { copyText, isEditable } from '../util.ts';

export interface PlayerInit {
  from?: number; // seconds (layout clock)
  to?: number;
  t?: number;
}

export function readInit(search: string): PlayerInit {
  const q = new URLSearchParams(search);
  const n = (k: string) => (q.has(k) && isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
  return { from: n('from'), to: n('to'), t: n('t') };
}

function initialState(h: LaunchHandle, init?: PlayerInit): Partial<PlayerState> | undefined {
  if (!init || (init.from == null && init.t == null)) return undefined;
  const sel: [number, number] | null = init.from != null && init.to != null ? [init.from * 1000, init.to * 1000] : null;
  const ph = init.t != null ? init.t * 1000 : sel ? sel[1] : h.series.liveEdge;
  const span = sel ? Math.max(20_000, (sel[1] - sel[0]) * 3) : 60_000;
  const c = sel ? (sel[0] + sel[1]) / 2 : ph;
  return { selection: sel, playhead: ph, following: false, playing: false, viewport: [c - span / 2, c + span / 2] };
}

export function usePlayer(h: LaunchHandle, init?: PlayerInit) {
  const ctrl = useMemo(() => new PlayerController(h.series, h.live, initialState(h, init)), [h]);
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      ctrl.tick(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ctrl]);
  // stream updates: throttle React work to ~5 Hz (the canvas redraws on its own)
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const un = h.subscribe(() => {
      if (!t)
        t = setTimeout(() => {
          t = null;
          force();
        }, 200);
    });
    return () => {
      un();
      if (t) clearTimeout(t);
    };
  }, [h]);
  const st = useCtrl(ctrl);
  const sv = h.series.version;
  const [fundingVer, setFundingVer] = useState(0);
  const ctx = useMemo(() => makeCtx(h.bundle, h.series), [h, sv, fundingVer]);
  const sel = st.selection;
  const metrics: WindowMetrics | null = useMemo(() => {
    if (!sel) return null;
    const upTo = st.blind ? Math.min(sel[1], st.playhead) : sel[1];
    const swaps = h.series.range(sel[0], upTo);
    const c = st.blind ? { ...ctx, all: h.series.cutoff(st.playhead) } : ctx;
    return computeWindow(c, sel[0], sel[1], swaps);
  }, [sel?.[0], sel?.[1], sv, ctx, st.blind && st.playhead]);
  const phIndex = h.series.indexAt(st.playhead);
  const tape = useMemo(() => h.series.swaps.slice(Math.max(0, phIndex - 59), phIndex + 1), [phIndex, sv]);
  const ref = usdAt(h.bundle.usd, (h.series.last?.chainTime ?? 0) * 1000);
  return {
    ctrl,
    st,
    ctx,
    metrics,
    tape,
    usdPerSol: ref?.solUsd ?? null,
    t0: h.series.start,
    addFunding: (ev: LaunchHandle['bundle']['funding']) => {
      const seen = new Set(h.bundle.funding.map((f) => f.wallet));
      for (const e of ev) if (!seen.has(e.wallet)) h.bundle.funding.push(e);
      setFundingVer((v) => v + 1);
    },
  };
}

export function shareUrl(h: LaunchHandle, st: PlayerState): string {
  const q = new URLSearchParams();
  if (st.selection) {
    q.set('from', (st.selection[0] / 1000).toFixed(3));
    q.set('to', (st.selection[1] / 1000).toFixed(3));
  }
  q.set('t', (st.playhead / 1000).toFixed(3));
  return `${location.origin}/app/${h.mode}/token/${h.mint}?${q}`;
}

/** Keyboard: Space, ←/→ (swap by swap), Shift+←/→ (extend selection), Esc, L, [ ], + / −. Never inside inputs. */
export function usePlayerKeys(ctrl: PlayerController, scope: 'global' | React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (scope !== 'global' && !(scope.current && scope.current.contains(document.activeElement))) return;
      const t = e.target as HTMLElement;
      if (e.key === ' ' && (t.tagName === 'BUTTON' || t.tagName === 'A')) {
        // let Space activate focused buttons/links natively
        return;
      }
      let handled = true;
      switch (e.key) {
        case ' ':
          ctrl.togglePlay();
          break;
        case 'ArrowLeft':
          if (e.shiftKey) ctrl.extendSelection(-1);
          else ctrl.step(-1);
          break;
        case 'ArrowRight':
          if (e.shiftKey) ctrl.extendSelection(1);
          else ctrl.step(1);
          break;
        case 'Escape':
          if (ctrl.s.selection) ctrl.clearSelection();
          else handled = false;
          break;
        case 'l':
        case 'L':
          ctrl.goLive();
          break;
        case '[':
          ctrl.select(ctrl.s.playhead, ctrl.s.selection ? ctrl.s.selection[1] : ctrl.s.playhead + 5000);
          break;
        case ']':
          ctrl.select(ctrl.s.selection ? ctrl.s.selection[0] : ctrl.s.playhead - 5000, ctrl.s.playhead);
          break;
        case '+':
        case '=':
          ctrl.zoom(1 / 1.3);
          break;
        case '-':
          ctrl.zoom(1.3);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctrl, scope]);
}

export function Transport({ ctrl, h, t0, compact, onShare, blind }: { ctrl: PlayerController; h: LaunchHandle; t0: number; compact?: boolean; onShare?: () => void; blind?: boolean }) {
  const st = ctrl.s;
  const behind = ctrl.behindMs;
  const [q, setQ] = useState('');
  const [qMsg, setQMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, []);
  const ph = h.series.swaps[h.series.indexAt(st.playhead)];
  const sinceLast = Math.max(0, now - h.series.lastReceivedAt);
  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const s = h.series.byId(q);
    if (s) {
      ctrl.highlightSwap(s.id);
      setQMsg(`Found · ${fmtTplus(s.tl, t0)}`);
    } else setQMsg(q.trim() ? 'Not in this launch' : null);
  };
  return (
    <div className={`transport${compact ? ' compact' : ''}`} role="toolbar" aria-label="Playback">
      <div className="row gap-s">
        <button type="button" className="btn btn-icon" onClick={() => ctrl.step(-1)} aria-label="Previous swap (←)" title="Previous swap (←)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3v10M13 3 6 8l7 5z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button type="button" className="btn btn-icon btn-play" onClick={() => ctrl.togglePlay()} aria-label={st.playing || st.following ? 'Pause (Space)' : 'Play (Space)'} title="Play / pause (Space)">
          {st.playing || st.following ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11L13 8z" fill="currentColor" /></svg>
          )}
        </button>
        <button type="button" className="btn btn-icon" onClick={() => ctrl.step(1)} aria-label="Next swap (→)" title="Next swap (→)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12 3v10M3 3l7 5-7 5z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button type="button" className="btn btn-s" onClick={() => ctrl.rewind(15_000)} title="Rewind 15 seconds">−15 s</button>
        <div className="seg" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={st.speed === s ? 'on' : ''} aria-pressed={st.speed === s} onClick={() => ctrl.set({ speed: s })}>
              {s}×
            </button>
          ))}
        </div>
      </div>
      <div className="readout mono">
        <span className="ph">{fmtClock(st.playhead / 1000)} UTC</span>
        <span className="muted">{fmtTplus(st.playhead, t0).replace('T+', '+')} since the first trade shown{ph ? ` · slot ${ph.slot}` : ''}</span>
      </div>
      {h.live && !blind && (
        <div className="readout mono">
          <span className={behind > 500 ? 'behind on' : 'behind'}>{behind > 500 ? `${fmtDur(behind, true)} behind live` : 'at live edge'}</span>
          <span className="muted">last event received {fmtDur(sinceLast, true)} ago</span>
        </div>
      )}
      <div className="row gap-s grow-end">
        {!compact && (
          <form onSubmit={search} className="txsearch" role="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find tx signature" aria-label="Find a transaction by signature" spellCheck={false} />
            {qMsg && <span className="small muted" role="status">{qMsg}</span>}
          </form>
        )}
        {onShare && !compact && (
          <button type="button" className="btn btn-ghost btn-s" onClick={onShare}>Share</button>
        )}
        {h.live && !blind && (
          <button type="button" className={`btn btn-live${st.following ? ' is-live' : ''}`} onClick={() => ctrl.goLive()} aria-label="Go Live (L)" title="Return to the latest event (L)">
            <span className="dot" aria-hidden="true" /> {st.following ? 'Live' : 'Go Live'}
          </button>
        )}
      </div>
    </div>
  );
}

export function useShare(h: LaunchHandle, ctrl: PlayerController) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const share = async () => {
    const url = shareUrl(h, ctrl.s);
    const ok = await copyText(url);
    history.replaceState(null, '', url.replace(location.origin, ''));
    setMsg(ok ? 'Link copied — it reopens this exact range.' : url);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 4000);
  };
  return { share, msg };
}

const SIZES: [number | null, string][] = [
  [null, 'Auto'],
  [1000, '1s'],
  [5000, '5s'],
  [15000, '15s'],
  [60000, '1m'],
  [300000, '5m'],
];
const label = (ms: number) => (ms < 60000 ? `${ms / 1000}s` : `${ms / 60000}m`);

/** Candle size: automatic (follows the zoom) or fixed. Auto shows the size it picked. */
export function CandleSize({ ctrl, compact }: { ctrl: PlayerController; compact?: boolean }) {
  const st = ctrl.s;
  void compact;
  const auto = pickBucket(ctrl.series.liveEdge - ctrl.series.start, 120);
  return (
    <div className="candle-size" role="group" aria-label="Candle size">
      <span className="candle-size-label">Candles</span>
      <div className="seg">
        {SIZES.map(([ms, name]) => {
          const on = st.bucket === ms;
          return (
            <button key={name} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => ctrl.set({ bucket: ms })} title={ms ? `One candle = ${label(ms)} of trades` : 'Size follows the zoom level'}>
              {ms === null && on ? `Auto · ${label(auto)}` : name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Axis unit and reset, next to the candle size (trading-terminal style). */
export function ChartTools({ ctrl }: { ctrl: PlayerController }) {
  const st = ctrl.s;
  return (
    <div className="chart-tools">
      <div className="seg" role="group" aria-label="Axis">
        <button type="button" className={st.yMode === 'mcap' ? 'on' : ''} aria-pressed={st.yMode === 'mcap'} onClick={() => ctrl.set({ yMode: 'mcap' })}>
          MCap
        </button>
        <button type="button" className={st.yMode === 'price' ? 'on' : ''} aria-pressed={st.yMode === 'price'} onClick={() => ctrl.set({ yMode: 'price' })}>
          Price
        </button>
      </div>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => ctrl.fit()} title="Show the whole launch and reset the price scale (double-click the chart)">
        Fit
      </button>
    </div>
  );
}
