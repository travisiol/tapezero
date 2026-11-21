import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DataMode } from '../../core/types.ts';
import { compareSide, type CompareSide } from '../../core/metrics.ts';
import { makeCtx } from '../../core/context.ts';
import { DEMO_SCRIPTS, demoMint } from '../../core/demo.ts';
import { listLaunches, openLaunch, type LaunchHandle, type LaunchRow } from '../data/sources.ts';
import { navigate } from '../router.tsx';
import { drawCompare, SERIES_STYLE } from '../player/drawCompare.ts';
import { fmtDur, fmtShare, fmtSol } from '../../core/format.ts';
import { prefersReducedMotion } from '../util.ts';

const WINDOWS = [
  { ms: 30_000, label: '30 s' },
  { ms: 60_000, label: '1 min' },
  { ms: 300_000, label: '5 min' },
];

export function Compare({ mode, search }: { mode: DataMode; search: string }) {
  const q = new URLSearchParams(search);
  const a = q.get('a') ?? (mode === 'demo' ? demoMint('holo') : null);
  const b = q.get('b') ?? (mode === 'demo' ? demoMint(a === demoMint('stak') ? 'holo' : 'stak') : null);
  const w = Number(q.get('w')) || 30_000;
  const [rows, setRows] = useState<LaunchRow[]>([]);
  useEffect(() => {
    listLaunches(mode).then((l) => setRows(l.rows)).catch(() => {});
  }, [mode]);
  const setQ = (k: string, v: string) => {
    const n = new URLSearchParams(search);
    n.set(k, v);
    navigate(`/app/${mode}/compare?${n}`, true);
  };
  const ha = useHandle(mode, a);
  const hb = useHandle(mode, b);
  const sides = useMemo(() => [ha, hb].map((h) => (h ? compareSide(makeCtx(h.bundle, h.series), w) : null)), [ha, hb, w, ha?.series.version, hb?.series.version]);
  const [dt, setDt] = useState(w);
  const [playing, setPlaying] = useState(false);
  useEffect(() => setDt(w), [w]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      setDt((d) => {
        const n = d + (now - last);
        if (n >= w) {
          setPlaying(false);
          return w;
        }
        return n;
      });
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, w]);
  const opts = rows.length ? rows : DEMO_SCRIPTS.map((s) => ({ launch: { mint: demoMint(s.key), symbol: s.symbol, name: s.name } }) as LaunchRow);
  const pick = (k: 'a' | 'b', v: string | null) => (
    <select value={v ?? ''} onChange={(e) => setQ(k, e.target.value)} aria-label={`Launch ${k.toUpperCase()}`}>
      <option value="" disabled>
        Pick a launch
      </option>
      {opts.map((r) => (
        <option key={r.launch.mint} value={r.launch.mint}>
          {r.launch.symbol} — {r.launch.name}
        </option>
      ))}
    </select>
  );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Compare</p>
          <h1>Two launches, aligned on their first swap</h1>
          <p className="muted">Same clock for both: the playhead is synchronised. Price is normalised to the first observed swap.</p>
        </div>
        {mode === 'demo' && <span className="badge badge-demo">Demo data</span>}
      </div>
      <div className="compare-controls">
        <label>
          <span className="legend" style={{ color: SERIES_STYLE[0].color }}>━ A</span> {pick('a', a)}
        </label>
        <label>
          <span className="legend" style={{ color: SERIES_STYLE[1].color }}>╍ B</span> {pick('b', b)}
        </label>
        <div className="seg" role="group" aria-label="Window">
          {WINDOWS.map((x) => (
            <button key={x.ms} type="button" className={w === x.ms ? 'on' : ''} aria-pressed={w === x.ms} onClick={() => setQ('w', String(x.ms))}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <CompareView sides={sides} names={[ha?.bundle.launch.symbol ?? '', hb?.bundle.launch.symbol ?? '']} windowMs={w} dt={dt} />
      <div className="row gap-s compare-scrub">
        <button type="button" className="btn btn-icon btn-play" onClick={() => (dt >= w ? (setDt(0), setPlaying(true)) : setPlaying((p) => !p))} aria-label={playing ? 'Pause' : 'Play both'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <input type="range" min={0} max={w} step={100} value={dt} onChange={(e) => (setPlaying(false), setDt(Number(e.target.value)))} aria-label="Synchronised playhead" className="grow" />
        <span className="mono">+{(dt / 1000).toFixed(0)} s</span>
      </div>
      <CompareTable sides={sides} names={[ha?.bundle.launch.symbol ?? 'A', hb?.bundle.launch.symbol ?? 'B']} />
      {sides.some((s) => s && !s.firstIsCreation) && <p className="notice small">For a launch joined mid-way, T+0 is the first <em>observed</em> swap, not the first swap on-chain.</p>}
    </div>
  );
}

function useHandle(mode: DataMode, mint: string | null) {
  const [h, setH] = useState<LaunchHandle | null>(null);
  useEffect(() => {
    setH(null);
    if (!mint) return;
    let alive = true;
    let got: LaunchHandle | null = null;
    openLaunch(mode, mint)
      .then((x) => {
        got = x;
        if (alive) setH(x);
        else x.release();
      })
      .catch(() => {});
    return () => {
      alive = false;
      got?.release();
    };
  }, [mode, mint]);
  return h;
}

export function CompareView({ sides, names, windowMs, dt, height = 340 }: { sides: (CompareSide | null)[]; names: string[]; windowMs: number; dt: number; height?: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(800);
  useLayoutEffect(() => {
    const el = cv.current!.parentElement!;
    const ro = new ResizeObserver(() => setW(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const c = cv.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCompare(ctx, w, height, sides, windowMs, dt, names);
  });
  return (
    <div className="chart compare-chart" style={{ height }}>
      <canvas ref={cv} role="img" aria-label={`Normalised price since first swap for ${names.join(' and ')}, with buy sizes below.`} />
    </div>
  );
}

export function CompareTable({ sides, names }: { sides: (CompareSide | null)[]; names: string[] }) {
  const row = (label: string, f: (s: CompareSide) => string, bar?: (s: CompareSide) => number | null, note?: string) => (
    <tr>
      <th scope="row">
        {label}
        {note && <span className="muted small"> · {note}</span>}
      </th>
      {sides.map((s, i) => {
        const b = s && bar ? bar(s) : null;
        return (
          <td key={i} className="mono">
            {s ? f(s) : '—'}
            {b != null && (
              <span className="bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, b * 100)}%`, background: SERIES_STYLE[i].color }} />
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
  return (
    <div className="table-wrap">
      <table className="cmp">
        <thead>
          <tr>
            <th scope="col">Within the window</th>
            {names.map((n, i) => (
              <th key={i} scope="col">
                <span style={{ color: SERIES_STYLE[i].color }}>{SERIES_STYLE[i].label}</span> {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row('Peak change', (s) => (s.peakChange != null ? `+${(s.peakChange * 100).toFixed(0)}%` : '—'))}
          {row('Time to peak', (s) => (s.peakDt != null ? fmtDur(s.peakDt) : '—'))}
          {row('Distinct buyers before peak', (s) => String(s.buyersBeforePeak))}
          {row('Largest buy share', (s) => `${fmtShare(s.topSwapShare.value)} (${fmtSol(s.topSwapShare.numerator)}/${fmtSol(s.topSwapShare.denominator)} SOL)`, (s) => s.topSwapShare.value, 'up to peak')}
          {row('Top wallet share', (s) => `${fmtShare(s.topBuyerShare.value)} (${fmtSol(s.topBuyerShare.numerator)}/${fmtSol(s.topBuyerShare.denominator)} SOL)`, (s) => s.topBuyerShare.value, 'up to peak')}
          {row('Bought / sold', (s) => `${fmtSol(s.buySol)} / ${fmtSol(s.sellSol)} SOL`)}
          {row('Early buyers selling', (s) => `${s.earlySellers} · ${fmtSol(s.earlySoldSol)} SOL`)}
          {row('Liquidity at end', (s) => (s.liquidityEnd != null ? `${fmtSol(s.liquidityEnd)} SOL` : 'not observable'))}
        </tbody>
      </table>
    </div>
  );
}

export const reducedCompare = prefersReducedMotion;
