import { useEffect, useMemo, useState } from 'react';
import type { DataMode } from '../../core/types.ts';
import { openLaunch, type LaunchHandle } from '../data/sources.ts';
import { Chart, Overview } from '../player/Chart.tsx';
import { CandlePanel } from '../player/CandlePanel.tsx';
import { Transport, usePlayer, usePlayerKeys } from '../player/usePlayer.tsx';
import { Link } from '../router.tsx';
import { fmtPct, fmtTplus } from '../../core/format.ts';

interface Observation {
  text: string;
  at: number; // tl ms
  seen: number; // swaps visible when recorded
  price: number | null;
}

/**
 * Blind Replay (R&D): the name and the future of the curve are hidden. Metrics only use events
 * with tl <= playhead, i.e. what was available at the moment being played.
 */
export function Blind({ mode, mint }: { mode: DataMode; mint: string }) {
  const [h, setH] = useState<LaunchHandle | null>(null);
  useEffect(() => {
    let got: LaunchHandle | null = null;
    openLaunch(mode, mint).then((x) => {
      got = x;
      setH(x);
    });
    return () => got?.release();
  }, [mode, mint]);
  if (!h) return <div className="center-empty dots-bg"><p className="muted mono">Loading tape…</p></div>;
  return <BlindView h={h} />;
}

function BlindView({ h }: { h: LaunchHandle }) {
  const p = usePlayer(h);
  const { ctrl, st } = p;
  usePlayerKeys(ctrl, 'global');
  const [revealed, setRevealed] = useState(false);
  const [text, setText] = useState('');
  const [obs, setObs] = useState<Observation | null>(null);
  const code = useMemo(() => `#${(parseInt(h.mint.slice(-8).replace(/[^0-9a-f]/gi, '') || '7', 16) % 9000) + 1000}`, [h.mint]);
  useEffect(() => {
    ctrl.isLive = false;
    const s = ctrl.series.start;
    ctrl.set({ blind: true, following: false, playhead: s, playing: true, viewport: [s - 2000, s + 40_000], selection: null });
  }, [ctrl]);
  const record = () => {
    if (!text.trim()) return;
    const o = { text: text.trim(), at: st.playhead, seen: h.series.indexAt(st.playhead) + 1, price: h.series.priceAt(st.playhead) };
    setObs(o);
    ctrl.pause();
    try {
      const k = 'tapezero.blind';
      const prev = JSON.parse(localStorage.getItem(k) ?? '[]');
      prev.push({ mint: h.mint, mode: h.mode, ...o, recordedAt: Date.now() });
      localStorage.setItem(k, JSON.stringify(prev.slice(-100)));
    } catch {
      /* private mode */
    }
  };
  const reveal = () => {
    setRevealed(true);
    ctrl.set({ blind: false });
    ctrl.fit();
  };
  const after = obs && revealed ? h.series.swaps.filter((s) => s.tl > obs.at) : [];
  const peakAfter = after.reduce((m, s) => Math.max(m, s.priceSol), 0);
  const endPrice = h.series.last?.priceSol ?? null;
  return (
    <div className="live-grid blind">
      <aside className="feed">
        <div className="feed-inner">
          <p className="eyebrow">Blind replay</p>
          <h2>{revealed ? `${h.bundle.launch.name} ($${h.bundle.launch.symbol})` : `Launch ${code}`}</h2>
          <p className="small muted">Name and future hidden. Everything you see was available at the moment played — metrics are computed from events up to the playhead only.</p>
          <label className="obs">
            Your observation at {fmtTplus(st.playhead, p.t0)}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="What do you see in the buys so far?" disabled={!!obs} />
          </label>
          {!obs ? (
            <button type="button" className="btn btn-primary" onClick={record} disabled={!text.trim()}>
              Record observation
            </button>
          ) : (
            <p className="small">
              Recorded at <span className="mono">{fmtTplus(obs.at, p.t0)}</span> with {obs.seen} swaps visible.
            </p>
          )}
          {obs && !revealed && (
            <button type="button" className="btn btn-primary" onClick={reveal}>
              Reveal the rest
            </button>
          )}
          {revealed && obs && obs.price && (
            <div className="sub small">
              <p>After your observation:</p>
              <p className="mono">highest {fmtPct((peakAfter / obs.price - 1) * 100)} · end {fmtPct(((endPrice ?? obs.price) / obs.price - 1) * 100)}</p>
              <p className="muted">Outcome computed only after reveal, from events later than your observation.</p>
            </div>
          )}
          <Link to={`/app/${h.mode}/archive`} className="btn btn-ghost btn-s">Back to archive</Link>
        </div>
      </aside>
      <main className="center">
        <Chart ctrl={ctrl} t0={p.t0} gaps={h.bundle.gaps} isLive={false} usdPerSol={p.usdPerSol} supply={h.bundle.launch.supply} label="Blind replay timeline: only events up to the playhead are shown." />
        <Overview ctrl={ctrl} gaps={h.bundle.gaps} />
        <Transport ctrl={ctrl} h={h} t0={p.t0} blind />
      </main>
      <aside className="panel">
        <CandlePanel ctrl={ctrl} m={p.metrics} tape={p.tape} t0={p.t0} mode={h.mode} filter={st.filter} highlight={st.highlight} onShare={() => {}} compact solUsd={p.usdPerSol} />
      </aside>
    </div>
  );
}
