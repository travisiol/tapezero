// TAPEZERO trailer — 10 s, plays inline on the homepage. Real Dacity Coin swaps (15 Oct 2026), real terminal components.
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, delayRender, continueRender, interpolate, Easing } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { useEffect, useMemo, useState } from 'react';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../src/web/styles.css';
import './film.css';
import { TRAILER_CUES as Q, FPS } from './cues.ts';
import { ZeroRig } from '../src/web/three/ZeroScene.tsx';
import { Chart } from '../src/web/player/Chart.tsx';
import { CandlePanel, SwapList } from '../src/web/player/CandlePanel.tsx';
import { PlayerController } from '../src/core/player.ts';
import { SwapSeries } from '../src/core/series.ts';
import { makeCtx } from '../src/core/context.ts';
import { computeWindow, usdAt } from '../src/core/metrics.ts';
import { busiestCandle } from '../src/web/landing/LandingPlayer.tsx';
import { BrandMark } from './BrandMark.tsx';
import { C } from '../src/core/theme.ts';
import { fmtClock, fmtDur, fmtUsd } from '../src/core/format.ts';
import type { LaunchBundle } from '../src/core/types.ts';

const W = 1920;
const H = 1080;
const sm = (a: number, b: number, x: number) => interpolate(x, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });

function useBundle() {
  const [b, setB] = useState<LaunchBundle | null>(null);
  const [h] = useState(() => delayRender('data'));
  useEffect(() => {
    Promise.all([
      fetch(staticFile('data/dacity-gta6.json')).then((r) => r.json()),
      ...['400 20px "Space Grotesk"', '500 20px "Space Grotesk"', '700 20px "Space Grotesk"', '400 20px "IBM Plex Mono"', '500 20px "IBM Plex Mono"'].map((f) => document.fonts.load(f)),
    ]).then(([j]) => {
      setB(j as LaunchBundle);
      continueRender(h);
    });
  }, [h]);
  return b;
}

function Backdrop({ glow = 1 }: { glow?: number }) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 45% 50% at 50% 66%, rgba(255,104,73,${0.32 * glow}), transparent 70%), radial-gradient(ellipse 70% 75% at 50% 50%, #3a1424 0%, ${C.bg} 75%)`,
      }}
    >
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(circle, rgba(255,120,80,0.30) 1.4px, transparent 2px)', backgroundSize: '26px 26px', WebkitMaskImage: 'radial-gradient(ellipse 45% 38% at 50% 18%, #000 10%, transparent 80%)' }} />
    </AbsoluteFill>
  );
}

function Zero({ t, split, scale, y }: { t: number; split: number; scale: number; y: number }) {
  return (
    <ThreeCanvas width={W} height={H} camera={{ position: [0, 0, 6], fov: 30 }} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}>
      <ZeroRig t={t} split={split} scale={scale} position={[0, y, 0]} intro={false} />
    </ThreeCanvas>
  );
}

function Caption({ text, from, to, t, top = false }: { text: string; from: number; to: number; t: number; top?: boolean }) {
  const a = sm(from, from + 0.25, t) * (1 - sm(to - 0.2, to, t));
  if (a <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: 90, [top ? 'top' : 'bottom']: top ? 40 : 58, opacity: a, transform: `translateY(${(1 - sm(from, from + 0.35, t)) * 18}px)`, fontFamily: 'Space Grotesk', fontWeight: 500, fontSize: 92, letterSpacing: '-0.035em', color: C.text, textShadow: '0 4px 40px rgba(29,12,25,0.95)' }}>
      {text}
    </div>
  );
}

function Terminal({ t, b }: { t: number; b: LaunchBundle }) {
  const full = useMemo(() => {
    const s = new SwapSeries(b.launch.mint);
    s.add(b.legs, 0);
    return s;
  }, [b]);
  const t0 = full.start;
  const end = full.liveEdge;
  // 'live' run: the tape plays from the first swap to ~70% of the window, accelerating
  const k = Math.pow(sm(Q.live, Q.rewind, t), 1.2);
  const n = full.size;
  const at = (f: number) => full.swaps[Math.max(0, Math.min(n - 1, Math.floor(n * f)))].tl;
  const liveAt = t < Q.rewind ? at(0.08 + 0.67 * k) : at(Math.min(0.98, 0.75 + (t - Q.rewind) * 0.06));
  const series = useMemo(() => {
    const s = new SwapSeries(b.launch.mint);
    s.add(b.legs.filter((l) => l.chainTime * 1000 + 500 <= liveAt), 0);
    return s;
  }, [Math.round(liveAt / 250)]);
  const edge = series.liveEdge;
  const rw = sm(Q.rewind, Q.rewind + 0.55, t);
  const rewFrom = at(0.75);
  const rewTo = rewFrom - 15_000;
  const [ca, cb] = busiestCandle(full);
  const open = sm(Q.inspect - 0.25, Q.inspect + 0.2, t);
  let playhead = t < Q.rewind ? edge : rewFrom + (rewTo - rewFrom) * rw;
  if (t >= Q.inspect - 0.3) playhead = rewTo + (cb - rewTo) * sm(Q.inspect - 0.3, Q.inspect + 0.1, t);
  const span = Math.max(30_000, (end - t0) * 0.95);
  const view: [number, number] = t < Q.rewind ? [Math.max(t0 - 2000, edge - span * 0.8), Math.max(t0 - 2000, edge - span * 0.8) + span] : [t0 - 2000, t0 - 2000 + span];
  const zoom = sm(Q.inspect - 0.4, Q.inspect + 0.3, t);
  const target: [number, number] = [ca - 14_000, cb + 12_000];
  const viewport: [number, number] = [view[0] + (target[0] - view[0]) * zoom, view[1] + (target[1] - view[1]) * zoom];
  const selection: [number, number] | null = open > 0 ? [cb - (cb - ca) * open, cb] : null;
  const usd = usdAt(b.usd, ca)?.solUsd ?? null;
  const m = useMemo(() => (open >= 1 ? computeWindow(makeCtx(b, full), ca, cb, full.range(ca, cb)) : null), [open >= 1]);
  const top3 = m ? [...m.buys].sort((x, y) => y.sol - x.sol).slice(0, 3) : [];
  const lit = Q.pings.filter((p) => t >= p).length;
  const highlight = lit ? top3[lit - 1]?.id ?? null : null;
  const dim = m && lit ? new Set(top3.slice(0, lit).map((s) => s.id)) : null;
  const ctrl = useMemo(() => new PlayerController(series, true), [series]);
  ctrl.s = { ...ctrl.s, playhead, viewport, following: t < Q.rewind, playing: false, selection, highlight, filter: null };
  ctrl.version++;
  const ghosts: { t: number; a: number }[] = [];
  if (t >= Q.rewind && t < Q.rewind + 0.45) {
    const g = (t - Q.rewind) / 0.45;
    const ph = (d: number) => rewFrom + (rewTo - rewFrom) * sm(Q.rewind, Q.rewind + 0.55, t - d);
    ghosts.push({ t: ph(0.07), a: 1 - g }, { t: ph(0.14), a: (1 - g) * 0.7 });
  }
  const behind = Math.max(0, edge - playhead);
  const tapeI = series.indexAt(playhead);
  const tape = series.swaps.slice(Math.max(0, tapeI - 11), tapeI + 1).reverse();
  const mc = usd && series.last ? fmtUsd(series.last.priceSol * 1e9 * usd) : '';
  return (
    <div style={{ position: 'absolute', left: 70, top: 60, width: W - 140, height: 800, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 18, overflow: 'hidden', boxShadow: '0 40px 120px rgba(0,0,0,0.5)' }}>
      <div className="topbar" style={{ height: 58 }}>
        <span className="wordmark" style={{ fontSize: 19 }}>
          TAPEZER<span className="wm-zero">O</span>
        </span>
        <span className="badge badge-real" style={{ marginLeft: 'auto', fontSize: 13 }}>Real on-chain data</span>
        <span className="mono muted" style={{ fontSize: 15 }}>15 Oct 2026 · {fmtClock(playhead / 1000)} UTC</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 520px', height: 742 }}>
        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
            <h1 className="token-name" style={{ fontSize: 34 }}>Dacity Coin</h1>
            <span className="mono" style={{ fontSize: 22, color: C.buy }}>{mc && `market cap ${mc}`}</span>
          </div>
          <Chart ctrl={ctrl} t0={t0} gaps={[]} isLive usdPerSol={usd} supply={1e9} dimIds={dim} label="trailer" fixed={{ w: 1186, h: 570 }} staticGhosts={ghosts} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, fontSize: 22 }} className="mono">
            <span className={behind > 500 ? 'behind on' : 'behind'}>{behind > 500 ? `${fmtDur(behind)} behind live` : '● at live edge'}</span>
            <span className={`btn btn-live${behind < 500 ? ' is-live' : ''}`} style={{ marginLeft: 'auto', fontSize: 17, padding: '10px 18px' }}>
              <span className="dot" /> {behind < 500 ? 'Live' : 'Go Live'}
            </span>
          </div>
        </div>
        <aside className="panel trailer-panel" style={{ overflow: 'hidden' }}>
          {m ? (
            <CandlePanel ctrl={ctrl} m={m} tape={[]} t0={t0} mode="live" filter={null} highlight={highlight} onShare={() => {}} compact solUsd={usd} />
          ) : (
            <div className="panel-body">
              <p className="panel-kicker">Latest swaps</p>
              <SwapList swaps={tape} t0={t0} mode="live" ctrl={ctrl} highlight={null} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export function Trailer() {
  const b = useBundle();
  const t = useCurrentFrame() / FPS;
  const split = sm(Q.splitStart, Q.splitStart + 0.5, t) * (1 - sm(Q.align - 0.3, Q.align, t));
  const endSplit = sm(Q.final - 0.45, Q.final - 0.2, t) * (1 - sm(Q.final - 0.15, Q.final, t)) * 0.7;
  const termIn = sm(Q.live - 0.15, Q.live + 0.15, t) * (1 - sm(Q.outro - 0.2, Q.outro + 0.1, t));
  return (
    <AbsoluteFill className="film" style={{ background: C.bg, fontFamily: 'Space Grotesk' }}>
      <Audio src={staticFile('film/trailer.wav')} />
      <Backdrop />
      <Sequence from={0} durationInFrames={Math.ceil((Q.live + 0.3) * FPS)}>
        <AbsoluteFill style={{ opacity: 1 - sm(Q.live - 0.15, Q.live + 0.15, t) }}>
          <BrandMark t={t} split={split} size={760} y={40} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 80, textAlign: 'center', opacity: sm(Q.align - 0.1, Q.align + 0.2, t) }}>
            <span className="wordmark" style={{ fontSize: 70, letterSpacing: '0.12em' }}>
              TAPEZER<span className="wm-zero">O</span>
            </span>
          </div>
        </AbsoluteFill>
      </Sequence>
      {b && (
        <Sequence from={Math.floor((Q.live - 0.2) * FPS)} durationInFrames={Math.ceil((Q.outro - Q.live + 0.5) * FPS)}>
          <AbsoluteFill style={{ opacity: termIn }}>
            <Terminal t={t} b={b} />
          </AbsoluteFill>
        </Sequence>
      )}
      <Sequence from={Math.floor((Q.outro - 0.2) * FPS)}>
        <AbsoluteFill style={{ opacity: sm(Q.outro - 0.1, Q.outro + 0.2, t) }}>
          <BrandMark t={t} split={endSplit} size={600} y={110} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 120, textAlign: 'center', fontFamily: 'Space Grotesk', fontWeight: 500, fontSize: 96, letterSpacing: '-0.035em', color: C.text }}>
            Every launch, frame by frame.
          </div>
        </AbsoluteFill>
      </Sequence>
      <Caption text="A launch moves in seconds." from={Q.live + 0.15} to={Q.rewind} t={t} />
      <Caption text="Rewind while it trades." from={Q.rewind + 0.05} to={Q.inspect - 0.1} t={t} />
      <Caption text="See who bought the move." from={Q.inspect} to={Q.outro} t={t} />
    </AbsoluteFill>
  );
}
