// TAPEZERO trailer — 10 s, 1920×1080. Built to read at small sizes (homepage hero, X feed, muted):
// one idea per shot, big type, the real chart only. Data: real DacityCoin (DCTY) trades, 18 Nov 2026.
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, delayRender, continueRender, interpolate, Easing } from 'remotion';
import { useEffect, useMemo, useState } from 'react';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../src/web/styles.css';
import './film.css';
import { TRAILER_CUES as Q, FPS } from './cues.ts';
import { Chart } from '../src/web/player/Chart.tsx';
import { PlayerController } from '../src/core/player.ts';
import { SwapSeries } from '../src/core/series.ts';
import { makeCtx } from '../src/core/context.ts';
import { computeWindow, usdAt } from '../src/core/metrics.ts';
import { busiestCandle } from '../src/web/landing/LandingPlayer.tsx';
import { BrandMark } from './BrandMark.tsx';
import { C } from '../src/core/theme.ts';
import { fmtClock } from '../src/core/format.ts';
import { usd as fmtMoney } from '../src/core/summary.ts';
import type { LaunchBundle } from '../src/core/types.ts';
import { REFERENCE, expandBundle } from '../src/core/reference.ts';

const sm = (a: number, b: number, x: number) => interpolate(x, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
const out = (a: number, b: number, x: number) => interpolate(x, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });

function useBundle() {
  const [b, setB] = useState<LaunchBundle | null>(null);
  const [h] = useState(() => delayRender('data'));
  useEffect(() => {
    Promise.all([
      fetch(staticFile('data/dcty.json')).then((r) => r.json()).then(expandBundle),
      ...['400 20px "Space Grotesk"', '500 20px "Space Grotesk"', '700 20px "Space Grotesk"', '400 20px "IBM Plex Mono"', '500 20px "IBM Plex Mono"'].map((f) => document.fonts.load(f)),
    ]).then(([j]) => {
      setB(j as LaunchBundle);
      continueRender(h);
    });
  }, [h]);
  return b;
}

function Backdrop() {
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 50% 55% at 50% 70%, rgba(255,104,73,0.30), transparent 70%), radial-gradient(ellipse 75% 80% at 50% 50%, #3a1424 0%, ${C.bg} 78%)` }}>
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(circle, rgba(255,120,80,0.30) 1.6px, transparent 2.2px)', backgroundSize: '30px 30px', WebkitMaskImage: 'radial-gradient(ellipse 50% 40% at 50% 15%, #000 10%, transparent 80%)' }} />
    </AbsoluteFill>
  );
}

const big = { fontFamily: 'Space Grotesk', fontWeight: 500, letterSpacing: '-0.035em', color: C.text } as const;

function Caption({ text, from, to, t }: { text: string; from: number; to: number; t: number }) {
  const a = out(from, from + 0.3, t) * (1 - sm(to - 0.2, to, t));
  if (a <= 0) return null;
  return (
    <div style={{ ...big, position: 'absolute', left: 110, bottom: 70, fontSize: 104, opacity: a, transform: `translateY(${(1 - out(from, from + 0.4, t)) * 24}px)` }}>
      {text}
    </div>
  );
}

function Market({ t, b }: { t: number; b: LaunchBundle }) {
  const full = useMemo(() => {
    const s = new SwapSeries(b.launch.mint);
    s.add(b.legs, 0);
    return s;
  }, [b]);
  const n = full.size;
  const at = (f: number) => full.swaps[Math.max(0, Math.min(n - 1, Math.floor(n * f)))].tl;
  // live run: swaps arrive fast; the rewind then pulls the playhead back 15 s while the tape keeps going
  const k = Math.pow(sm(Q.live, Q.rewind, t), 1.15);
  const liveAt = t < Q.rewind ? at(0.05 + 0.75 * k) : at(Math.min(1, 0.8 + (t - Q.rewind) * 0.08));
  const series = useMemo(() => {
    const s = new SwapSeries(b.launch.mint);
    s.add(b.legs.filter((l) => l.chainTime * 1000 + 500 <= liveAt), 0);
    return s;
  }, [Math.round(liveAt / 250)]);
  const edge = series.liveEdge;
  const t0 = full.start;
  const [ca, cb] = busiestCandle(full);
  const rewFrom = at(0.8);
  const rewTo = rewFrom - 15_000;
  const rw = sm(Q.rewind, Q.rewind + 0.5, t);
  let playhead = t < Q.rewind ? edge : rewFrom + (rewTo - rewFrom) * rw;
  const toCandle = sm(Q.inspect - 0.35, Q.inspect, t);
  if (t >= Q.inspect - 0.35) playhead = rewTo + (cb - rewTo) * toCandle;
  const fullView: [number, number] = [t0 + 9000, full.liveEdge + 2500];
  const zoom = sm(Q.inspect - 0.3, Q.inspect + 0.35, t);
  const target: [number, number] = [ca - 12_000, cb + 7_000];
  const viewport: [number, number] = [fullView[0] + (target[0] - fullView[0]) * zoom, fullView[1] + (target[1] - fullView[1]) * zoom];
  const open = sm(Q.inspect - 0.05, Q.inspect + 0.35, t);
  const selection: [number, number] | null = open > 0 ? [cb - (cb - ca) * open, cb] : null;
  const ctrl = useMemo(() => new PlayerController(series, true), [series]);
  ctrl.s = { ...ctrl.s, playhead, viewport, following: t < Q.rewind, playing: false, selection, highlight: null, filter: null };
  ctrl.version++;
  const ghosts: { t: number; a: number }[] = [];
  if (t >= Q.rewind && t < Q.rewind + 0.5) {
    const g = (t - Q.rewind) / 0.5;
    const ph = (d: number) => rewFrom + (rewTo - rewFrom) * sm(Q.rewind, Q.rewind + 0.5, t - d);
    ghosts.push({ t: ph(0.07), a: 1 - g }, { t: ph(0.14), a: (1 - g) * 0.7 });
  }
  const solUsd = usdAt(b.usd, ca)?.solUsd ?? 100;
  const shown = series.swaps[series.indexAt(playhead)] ?? series.first;
  const mcap = shown ? shown.priceSol * 1e9 * solUsd : 0;
  const m = useMemo(() => computeWindow(makeCtx(b, full), ca, cb, full.range(ca, cb)), [b]);
  const card = out(Q.inspect + 0.25, Q.inspect + 0.7, t);
  const behind = Math.max(0, edge - playhead);
  const chartScale = 1.45;
  const CW = 1080;
  const CH = 340;
  return (
    <AbsoluteFill>
      {/* label + live market cap */}
      <div style={{ position: 'absolute', left: 110, top: 64 }}>
        <div style={{ font: '500 30px IBM Plex Mono', color: C.peach, letterSpacing: '0.04em' }}>{REFERENCE.name.toUpperCase()} · {REFERENCE.date.toUpperCase()} · {fmtClock(playhead / 1000)} UTC</div>
        <div style={{ ...big, fontSize: 132, lineHeight: 1.02, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
          {fmtMoney(mcap)} <span style={{ fontSize: 46, color: C.text2, letterSpacing: 0 }}>market cap</span>
        </div>
      </div>
      {/* the real chart, scaled up so it reads on a phone */}
      <div style={{ position: 'absolute', left: 110, top: 300, width: CW, height: CH, transform: `scale(${chartScale})`, transformOrigin: 'top left', opacity: 1 - card * 0.35 }}>
        <Chart ctrl={ctrl} t0={t0} gaps={[]} isLive usdPerSol={solUsd} supply={1e9} label="trailer" fixed={{ w: CW, h: CH }} staticGhosts={ghosts} compact />
      </div>
      {/* rewind stamp */}
      {t >= Q.rewind - 0.05 && t < Q.inspect - 0.2 && (
        <div style={{ position: 'absolute', right: 110, top: 40, opacity: out(Q.rewind, Q.rewind + 0.2, t) * (1 - sm(Q.inspect - 0.45, Q.inspect - 0.2, t)), transform: `scale(${0.9 + 0.1 * out(Q.rewind, Q.rewind + 0.3, t)})` }}>
          <div style={{ ...big, fontSize: 150, lineHeight: 1, color: C.accent, textAlign: 'right' }}>−15 s</div>
          <div style={{ font: '500 32px IBM Plex Mono', color: C.text2, textAlign: 'right' }}>{(behind / 1000).toFixed(0)} s behind live</div>
        </div>
      )}
      {/* what built the candle */}
      {card > 0 && (
        <div style={{ position: 'absolute', right: 90, top: 270, width: 690, padding: '40px 46px', background: 'rgba(37,19,33,0.94)', border: `1px solid ${C.divider}`, borderLeft: `6px solid ${C.accent}`, borderRadius: 22, opacity: card, transform: `translateX(${(1 - card) * 60}px)`, boxShadow: '0 40px 100px rgba(0,0,0,0.5)' }}>
          <div style={{ font: '500 28px IBM Plex Mono', color: C.text2 }}>{fmtClock(ca / 1000)} → {fmtClock(cb / 1000)} UTC</div>
          <div style={{ ...big, fontSize: 92, color: C.buy, marginTop: 10 }}>+{(m.changePct ?? 0).toFixed(0)}% in 5 s</div>
          <div style={{ ...big, fontSize: 56, marginTop: 18, opacity: out(Q.pings[0], Q.pings[0] + 0.2, t) }}>{m.distinctBuyers.length} wallets bought</div>
          <div style={{ ...big, fontSize: 56, marginTop: 6, opacity: out(Q.pings[1], Q.pings[1] + 0.2, t) }}>{fmtMoney(m.buySol * solUsd)} in 5 seconds</div>
          <div style={{ ...big, fontSize: 56, marginTop: 6, color: C.peach, opacity: out(Q.pings[2], Q.pings[2] + 0.2, t) }}>biggest buy {fmtMoney(m.largestBuyShare.numerator * solUsd)}</div>
        </div>
      )}
    </AbsoluteFill>
  );
}

export function Trailer() {
  const b = useBundle();
  const t = useCurrentFrame() / FPS;
  const split = sm(Q.splitStart, Q.splitStart + 0.5, t) * (1 - sm(Q.align - 0.3, Q.align, t));
  const endSplit = sm(Q.final - 0.45, Q.final - 0.2, t) * (1 - sm(Q.final - 0.15, Q.final, t)) * 0.7;
  const marketIn = sm(Q.live - 0.2, Q.live + 0.15, t) * (1 - sm(Q.outro - 0.25, Q.outro, t));
  return (
    <AbsoluteFill className="film" style={{ background: C.bg, fontFamily: 'Space Grotesk' }}>
      <Audio src={staticFile('film/trailer.wav')} />
      <Backdrop />
      <Sequence from={0} durationInFrames={Math.ceil((Q.live + 0.3) * FPS)}>
        <AbsoluteFill style={{ opacity: 1 - sm(Q.live - 0.2, Q.live + 0.1, t), transform: `scale(${1 + 0.04 * sm(0, Q.live, t)})` }}>
          <BrandMark t={t} split={split} size={1000} y={60} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 96, textAlign: 'center', opacity: out(Q.align - 0.1, Q.align + 0.25, t) }}>
            <span className="wordmark" style={{ fontSize: 84, letterSpacing: '0.14em' }}>
              TAPEZER<span className="wm-zero">O</span>
            </span>
          </div>
        </AbsoluteFill>
      </Sequence>
      {b && (
        <Sequence from={Math.floor((Q.live - 0.25) * FPS)} durationInFrames={Math.ceil((Q.outro - Q.live + 0.5) * FPS)}>
          <AbsoluteFill style={{ opacity: marketIn }}>
            <Market t={t} b={b} />
          </AbsoluteFill>
        </Sequence>
      )}
      <Sequence from={Math.floor((Q.outro - 0.25) * FPS)}>
        <AbsoluteFill style={{ opacity: sm(Q.outro - 0.15, Q.outro + 0.2, t) }}>
          <BrandMark t={t} split={endSplit} size={800} y={170} />
          <div style={{ ...big, position: 'absolute', left: 0, right: 0, bottom: 150, textAlign: 'center', fontSize: 112 }}>Every launch, frame by frame.</div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 78, textAlign: 'center', opacity: out(Q.final - 0.2, Q.final + 0.2, t) }}>
            <span className="wordmark" style={{ fontSize: 44, letterSpacing: '0.14em' }}>
              TAPEZER<span className="wm-zero">O</span>
            </span>
          </div>
        </AbsoluteFill>
      </Sequence>
      <Caption text="A launch moves in seconds." from={Q.live + 0.2} to={Q.rewind} t={t} />
      <Caption text="Rewind it while it trades." from={Q.rewind + 0.05} to={Q.inspect - 0.15} t={t} />
      <Caption text="See who bought the move." from={Q.inspect + 0.1} to={Q.outro} t={t} />
    </AbsoluteFill>
  );
}
