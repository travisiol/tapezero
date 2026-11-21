// TAPEZERO launch film — 35 s, 1920×1080, 30 fps. Built from the real terminal components and the same demo tape.
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, Easing, delayRender, continueRender } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import * as THREE from 'three';
import { useEffect, useMemo, useState } from 'react';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../src/web/styles.css';
import './film.css';
import { FILM_CUES as Q, FPS } from './cues.ts';
import { ZeroRig } from '../src/web/three/ZeroScene.tsx';
import { Chart } from '../src/web/player/Chart.tsx';
import { CandlePanel, SwapList } from '../src/web/player/CandlePanel.tsx';
import { CompareView, CompareTable } from '../src/web/terminal/Compare.tsx';
import { PlayerController } from '../src/core/player.ts';
import { SwapSeries } from '../src/core/series.ts';
import { demoBundle } from '../src/core/demo.ts';
import { makeCtx } from '../src/core/context.ts';
import { compareSide, computeWindow } from '../src/core/metrics.ts';
import { peakWindow } from '../src/web/landing/LandingPlayer.tsx';
import { C } from '../src/core/theme.ts';
import { fmtClock, fmtDur, fmtTplus } from '../src/core/format.ts';

const W = 1920;
const H = 1080;
const ease = Easing.bezier(0.22, 1, 0.36, 1);
const smooth = (a: number, b: number, x: number) => interpolate(x, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });

function useFonts() {
  const [h] = useState(() => delayRender('fonts'));
  useEffect(() => {
    Promise.all(['400 20px "Space Grotesk"', '500 20px "Space Grotesk"', '700 20px "Space Grotesk"', '400 20px "IBM Plex Mono"', '500 20px "IBM Plex Mono"'].map((f) => document.fonts.load(f)))
      .then(() => document.fonts.ready)
      .then(() => continueRender(h));
  }, [h]);
}

// ───────────── data ─────────────
const orbit = demoBundle('orbit')!;
const full = (() => {
  const s = new SwapSeries(orbit.launch.mint);
  s.add(orbit.legs, 0);
  return s;
})();
const T0 = full.start;
const PEAK = peakWindow(full);

/** Demo seconds after first swap that are "live" at film time t. */
function liveSecAt(t: number): number {
  if (t < Q.liveStart) return 20;
  if (t < Q.rewind) return 20 + 24 * Math.pow((t - Q.liveStart) / (Q.rewind - Q.liveStart), 1.35);
  return 44 + (t - Q.rewind) * 2.1;
}

function seriesUpTo(sec: number): SwapSeries {
  const s = new SwapSeries(orbit.launch.mint);
  const cut = T0 / 1000 + sec;
  s.add(orbit.legs.filter((l) => l.chainTime + (l.observedAt % 1000) / 1000 <= cut), 0);
  return s;
}

// ───────────── pieces ─────────────
function Caption({ text, from, to, t }: { text: string; from: number; to: number; t: number }) {
  const a = smooth(from, from + 0.45, t) * (1 - smooth(to - 0.35, to, t));
  if (a <= 0) return null;
  const y = (1 - smooth(from, from + 0.6, t)) * 26;
  return (
    <div style={{ position: 'absolute', left: 120, bottom: 70, opacity: a, transform: `translateY(${y}px)`, fontFamily: 'Space Grotesk', fontWeight: 500, fontSize: 76, letterSpacing: '-0.03em', color: C.text, textShadow: '0 4px 30px rgba(29,12,25,0.9)' }}>
      {text}
    </div>
  );
}

function Dots({ opacity = 1 }: { opacity?: number }) {
  return (
    <AbsoluteFill
      style={{
        opacity,
        backgroundImage: 'radial-gradient(circle, rgba(255,120,80,0.30) 1.4px, transparent 2px)',
        backgroundSize: '26px 26px',
        WebkitMaskImage: 'radial-gradient(ellipse 45% 40% at 50% 22%, #000 10%, transparent 80%)',
      }}
    />
  );
}

function Zero({ t, split, spin = 0, scale = 1, y = 0 }: { t: number; split: number; spin?: number; scale?: number; y?: number }) {
  return (
    <ThreeCanvas width={W} height={H} camera={{ position: [0, 0, 6], fov: 30 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05, preserveDrawingBuffer: true }}>
      <ZeroRig t={t} split={split} spin={spin} scale={scale} position={[0, y, 0]} glow={1.1} />
    </ThreeCanvas>
  );
}

/** A slim graduation with the coral playhead (opening + ending shots). */
function Graduation({ t, head, live, opacity }: { t: number; head: number; live: number | null; opacity: number }) {
  const ticks = Array.from({ length: 61 }, (_, i) => i);
  void t;
  return (
    <div style={{ position: 'absolute', left: 360, right: 360, bottom: 190, height: 40, opacity }}>
      {ticks.map((i) => (
        <div key={i} style={{ position: 'absolute', left: `${(i / 60) * 100}%`, bottom: 0, width: 1, height: i % 10 === 0 ? 18 : i % 5 === 0 ? 11 : 6, background: 'rgba(201,173,183,0.45)' }} />
      ))}
      {live != null && <div style={{ position: 'absolute', left: `${live * 100}%`, bottom: -4, width: 1, height: 34, borderLeft: '1px dashed rgba(255,240,231,0.7)' }} />}
      {live != null && (
        <div style={{ position: 'absolute', left: `${live * 100}%`, bottom: 36, transform: 'translateX(-50%)', font: '600 13px IBM Plex Mono', color: C.bg, background: C.text, borderRadius: 8, padding: '1px 7px' }}>LIVE</div>
      )}
      <div style={{ position: 'absolute', left: `${head * 100}%`, bottom: -6, width: 3, height: 46, background: C.accent, boxShadow: '0 0 24px rgba(255,104,73,0.8)', transform: 'translateX(-1px)' }} />
    </div>
  );
}

function TermFrame({ children, statusRight, tab = 'Live' }: { children: React.ReactNode; statusRight?: React.ReactNode; tab?: string }) {
  return (
    <div style={{ position: 'absolute', left: 80, top: 56, width: W - 160, height: 830, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: 18, overflow: 'hidden', boxShadow: '0 40px 120px rgba(0,0,0,0.5)' }}>
      <div className="topbar" style={{ height: 56 }}>
        <span className="wordmark" style={{ fontSize: 18 }}>
          TAPEZER<span className="wm-zero">O</span>
        </span>
        <nav className="tabs">
          {['Live', 'Archive', 'Compare'].map((x) => (
            <span key={x} className={`tab${x === tab ? ' on' : ''}`}>{x}</span>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>{statusRight}</div>
      </div>
      {children}
    </div>
  );
}

// ───────────── terminal shots (4 → 22.9 s) ─────────────
function TerminalShot({ t }: { t: number }) {
  const liveSec = liveSecAt(t);
  const series = useMemo(() => seriesUpTo(liveSec), [Math.round(liveSec * 20)]);
  const edge = series.liveEdge;
  // playhead: follows live, then rewinds 15 s at the cue and stays there
  const rw = smooth(Q.rewind, Q.rewind + 0.75, t);
  const rewindFrom = T0 + 44 * 1000;
  const rewindTo = rewindFrom - 15_000;
  let playhead = t < Q.rewind ? edge : rewindFrom + (rewindTo - rewindFrom) * rw;
  // zoom on the peak
  const z = smooth(Q.peakZoom, Q.peakZoom + 1.2, t);
  const vSpan = 46_000;
  const followView: [number, number] = [edge - vSpan * 0.85, edge + vSpan * 0.15];
  const holdView: [number, number] = [T0 + 44_000 - vSpan * 0.85, T0 + 44_000 + vSpan * 0.15];
  const baseView = t < Q.rewind ? followView : holdView;
  const peakView: [number, number] = [PEAK[0] - 9000, PEAK[1] + 7000];
  const viewport: [number, number] = [baseView[0] + (peakView[0] - baseView[0]) * z, baseView[1] + (peakView[1] - baseView[1]) * z];
  if (t >= Q.peakZoom) playhead = rewindTo + (PEAK[1] - rewindTo) * z;
  // the candle opens
  const open = smooth(Q.peakZoom + 0.6, Q.peakZoom + 1.4, t);
  const selection: [number, number] | null = open > 0 ? [PEAK[1] - (PEAK[1] - PEAK[0]) * open, PEAK[1]] : null;
  const m = useMemo(() => {
    if (!selection || open < 1) return null;
    const s2 = seriesUpTo(liveSec);
    return computeWindow(makeCtx(orbit, s2), PEAK[0], PEAK[1], s2.range(PEAK[0], PEAK[1]));
  }, [open >= 1, Math.round(liveSec)]);
  const top3 = m ? [...m.buys].sort((a, b) => b.sol - a.sol).slice(0, 3).sort((a, b) => a.tl - b.tl) : [];
  const litIdx = Q.swapPings.filter((p) => t >= p).length - 1;
  const highlight = litIdx >= 0 ? top3[litIdx]?.id ?? null : null;
  const dim = m && litIdx >= 0 ? new Set(top3.slice(0, litIdx + 1).map((s) => s.id)) : null;
  const ctrl = useMemo(() => new PlayerController(series, true), [series]);
  ctrl.s = { ...ctrl.s, playhead, viewport, following: t < Q.rewind, playing: false, selection, highlight, filter: null };
  ctrl.version++;
  // two brief ghosts during the rewind — the doubled edge of the zero
  const ghosts: { t: number; a: number }[] = [];
  if (t >= Q.rewind && t < Q.rewind + 0.55) {
    const k = (t - Q.rewind) / 0.55;
    const ph = (dt: number) => rewindFrom + (rewindTo - rewindFrom) * smooth(Q.rewind, Q.rewind + 0.75, t - dt);
    ghosts.push({ t: ph(0.08), a: 1 - k }, { t: ph(0.16), a: (1 - k) * 0.7 });
  }
  const behind = Math.max(0, edge - playhead);
  const tapeEnd = series.indexAt(playhead);
  const tape = series.swaps.slice(Math.max(0, tapeEnd - 13), tapeEnd + 1).reverse();
  const usd = 150;
  return (
    <TermFrame
      statusRight={
        <>
          <span className="badge badge-demo">Demo data</span>
          <span className="pill pill-live">● Stream connected</span>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 470px', height: 830 - 56 }}>
        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h1 className="token-name" style={{ fontSize: 30 }}>
              Orbit Index <span className="muted">$ORBT</span>
            </h1>
            <span className="mono muted" style={{ fontSize: 16 }}>pump.fun bonding curve · {series.size} swaps</span>
          </div>
          <Chart ctrl={ctrl} t0={T0} gaps={[]} isLive usdPerSol={usd} supply={orbit.launch.supply} dimIds={dim} label="film" fixed={{ w: 1290, h: 560 }} staticGhosts={ghosts} />
          <div className="transport" style={{ paddingTop: 4, gap: 28 }}>
            <div className="readout mono">
              <span className="ph" style={{ fontSize: 22 }}>{fmtTplus(playhead, T0)}</span>
              <span className="muted" style={{ fontSize: 15 }}>{fmtClock(playhead / 1000)} UTC</span>
            </div>
            <div className="readout mono" style={{ fontSize: 16 }}>
              <span className={behind > 500 ? 'behind on' : 'behind'} style={{ fontSize: 22 }}>{behind > 500 ? `${fmtDur(behind, true)} behind live` : 'at live edge'}</span>
              <span className="muted">new swaps keep arriving</span>
            </div>
            <span className={`btn btn-live${behind < 500 ? ' is-live' : ''}`} style={{ marginLeft: 'auto', fontSize: 16, padding: '10px 18px' }}>
              <span className="dot" /> {behind < 500 ? 'Live' : 'Go Live'}
            </span>
          </div>
        </div>
        <aside className="panel" style={{ fontSize: 15, overflow: 'hidden' }}>
          {m ? (
            <CandlePanel ctrl={ctrl} m={m} tape={[]} t0={T0} mode="demo" filter={null} highlight={highlight} onShare={() => {}} compact />
          ) : (
            <div className="panel-body">
              <p className="eyebrow">Tape</p>
              <SwapList swaps={tape} t0={T0} mode="demo" ctrl={ctrl} highlight={null} />
            </div>
          )}
        </aside>
      </div>
    </TermFrame>
  );
}

function CompareShot({ t }: { t: number }) {
  const sides = useMemo(() => ['holo', 'stak'].map((k) => {
    const b = demoBundle(k)!;
    const s = new SwapSeries(b.launch.mint);
    s.add(b.legs, 0);
    return compareSide(makeCtx(b, s), 30_000);
  }), []);
  const dt = 30_000 * smooth(Q.compare + 0.4, Q.compare + 3.6, t);
  const tbl = smooth(Q.compare + 3.2, Q.compare + 3.8, t);
  return (
    <TermFrame tab="Compare" statusRight={<span className="badge badge-demo">Demo data</span>}>
      <div style={{ padding: '18px 28px' }} className="film-compare">
        <p className="eyebrow" style={{ fontSize: 14 }}>Compare · aligned on the first swap · 30 s</p>
        <CompareView sides={sides} names={['HOLO · Hollow Choir', 'STAK · Single Stack']} windowMs={30_000} dt={dt} height={380} />
        <div style={{ opacity: tbl, marginTop: 12 }}>
          <CompareTable sides={sides} names={['HOLO', 'STAK']} />
        </div>
      </div>
    </TermFrame>
  );
}

// ───────────── film ─────────────
export function Film() {
  useFonts();
  const frame = useCurrentFrame();
  const t = frame / FPS;
  // opening split: drifts apart, realigns exactly on the first impact
  const openSplit = smooth(Q.splitStart, Q.splitStart + 0.7, t) * (1 - smooth(Q.align - 0.45, Q.align, t));
  const endSplit = smooth(Q.finalImpact - 0.9, Q.finalImpact - 0.35, t) * (1 - smooth(Q.finalImpact - 0.25, Q.finalImpact, t)) * 0.6;
  const termIn = smooth(Q.liveStart - 0.25, Q.liveStart + 0.25, t);
  const termOut = 1 - smooth(Q.compare - 0.2, Q.compare + 0.15, t);
  const cmpIn = smooth(Q.compare - 0.1, Q.compare + 0.3, t) * (1 - smooth(Q.outroCalm - 0.3, Q.outroCalm, t));
  const outroIn = smooth(Q.outroCalm - 0.2, Q.outroCalm + 0.5, t);
  const head1 = interpolate(t, [Q.playheadOn, Q.align], [0.62, 0.5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const head2 = interpolate(t, [Q.outroCalm + 0.3, Q.liveReturn], [0.42, 0.78], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  return (
    <AbsoluteFill className="film" style={{ background: C.bg, fontFamily: 'Space Grotesk' }}>
      <Audio src={staticFile('film/score.wav')} />
      {/* 1 · opening — the glass zero */}
      <Sequence from={0} durationInFrames={Math.ceil((Q.liveStart + 0.3) * FPS)}>
        <AbsoluteFill style={{ opacity: 1 - termIn }}>
          <Zero t={t} split={openSplit * 0.85} spin={interpolate(t, [0, Q.align], [-0.35, 0], { extrapolateRight: 'clamp', easing: ease })} scale={0.68} y={0.12} />
          <Dots opacity={smooth(0.2, 1.4, t) * 0.8} />
          <Graduation t={t} head={head1} live={null} opacity={smooth(Q.playheadOn - 0.05, Q.playheadOn + 0.1, t)} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 82, textAlign: 'center', opacity: smooth(Q.align, Q.align + 0.4, t) }}>
            <span className="wordmark" style={{ fontSize: 64, letterSpacing: '0.12em' }}>
              TAPEZER<span className="wm-zero">O</span>
            </span>
          </div>
        </AbsoluteFill>
      </Sequence>
      {/* 2–4 · live, rewind, inspect — the real terminal */}
      <Sequence from={Math.floor((Q.liveStart - 0.3) * FPS)} durationInFrames={Math.ceil((Q.compare - Q.liveStart + 0.8) * FPS)}>
        <AbsoluteFill style={{ opacity: termIn * termOut, transform: `scale(${0.97 + 0.03 * termIn})` }}>
          <TerminalShot t={t} />
        </AbsoluteFill>
      </Sequence>
      {/* 5 · compare */}
      <Sequence from={Math.floor((Q.compare - 0.2) * FPS)} durationInFrames={Math.ceil((Q.outroCalm - Q.compare + 0.4) * FPS)}>
        <AbsoluteFill style={{ opacity: cmpIn }}>
          <CompareShot t={t} />
        </AbsoluteFill>
      </Sequence>
      {/* 6 · back to the zero */}
      <Sequence from={Math.floor((Q.outroCalm - 0.3) * FPS)}>
        <AbsoluteFill style={{ opacity: outroIn }}>
          <Zero t={t} split={endSplit} spin={interpolate(t, [Q.outroCalm, Q.end], [0.25, -0.05])} scale={0.5} y={0.08} />
          <Dots opacity={0.8} />
          <Graduation t={t} head={head2} live={0.78} opacity={1 - smooth(Q.finalImpact - 0.6, Q.finalImpact, t) * 0.6} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 64, textAlign: 'center', opacity: smooth(Q.liveReturn + 0.2, Q.liveReturn + 0.8, t) }}>
            <span className="wordmark" style={{ fontSize: 44, letterSpacing: '0.12em' }}>
              TAPEZER<span className="wm-zero">O</span>
            </span>
          </div>
        </AbsoluteFill>
      </Sequence>
      {/* captions — the film must read without sound */}
      <Caption text="A launch moves in seconds." from={Q.liveStart + 0.3} to={Q.rewind} t={t} />
      <Caption text="Rewind while it’s live." from={Q.rewind + 0.1} to={Q.peakZoom} t={t} />
      <Caption text="See the swaps behind the move." from={Q.peakZoom + 0.3} to={Q.compare} t={t} />
      <Caption text="Compare the first seconds." from={Q.compare + 0.3} to={Q.outroCalm} t={t} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 120, textAlign: 'center', opacity: smooth(Q.liveReturn + 0.6, Q.liveReturn + 1.3, t), fontFamily: 'Space Grotesk', fontWeight: 500, fontSize: 84, letterSpacing: '-0.035em', color: C.text }}>
        Every launch, frame by frame.
      </div>
    </AbsoluteFill>
  );
}

/** Still compositions: hero poster / share image, faithful to the logo. */
export function PosterStill({ w, h, title = false }: { w: number; h: number; title?: boolean }) {
  useFonts();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <ThreeCanvas width={w} height={h} camera={{ position: [0, 0, 6], fov: 30 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05, preserveDrawingBuffer: true }}>
        <ZeroRig t={6} split={0} position={title ? [1.75, -0.05, 0] : [1.35, 0.05, 0]} scale={title ? 0.66 : 1} glow={1.1} />
      </ThreeCanvas>
      {title && (
        <div style={{ position: 'absolute', left: 80, top: h / 2 - 150, width: w * 0.5 }}>
          <div className="eyebrow" style={{ fontSize: 18 }}>Solana launch player</div>
          <div style={{ fontFamily: 'Space Grotesk', fontWeight: 500, fontSize: 84, lineHeight: 1, letterSpacing: '-0.035em', color: C.text }}>Every launch, frame by frame.</div>
          <div style={{ marginTop: 22, fontSize: 26, color: C.text2 }}>Rewind live Solana launches. Inspect the swaps behind every move.</div>
          <div style={{ marginTop: 30 }}>
            <span className="wordmark" style={{ fontSize: 30 }}>
              TAPEZER<span className="wm-zero">O</span>
            </span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
}
