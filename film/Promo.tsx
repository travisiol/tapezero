// TAPEZERO — X launch post. 1080×1350 (4:5), ~24.5 s, captions burned in (X autoplays muted).
// Every number comes from the real Dacity Coin swaps of 15 Oct 2026 (public/data/dacity-gta6.json).
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, delayRender, continueRender, interpolate, Easing } from 'remotion';
import { useEffect, useMemo, useState } from 'react';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../src/web/styles.css';
import './film.css';
import { PROMO_CUES as Q, FPS } from './cues.ts';
import { Chart } from '../src/web/player/Chart.tsx';
import { PlayerController } from '../src/core/player.ts';
import { SwapSeries } from '../src/core/series.ts';
import { makeCtx } from '../src/core/context.ts';
import { computeWindow, usdAt } from '../src/core/metrics.ts';
import { busiestCandle } from '../src/web/landing/LandingPlayer.tsx';
import { BrandMark } from './BrandMark.tsx';
import { C } from '../src/core/theme.ts';
import { fmtClock, short } from '../src/core/format.ts';
import { usd } from '../src/core/summary.ts';
import { mulberry32 } from '../src/core/demo.ts';
import type { LaunchBundle } from '../src/core/types.ts';

export const PROMO_W = 1080;
export const PROMO_H = 1350;
const W = PROMO_W;
const H = PROMO_H;

const sm = (a: number, b: number, x: number) => interpolate(x, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
const out = (a: number, b: number, x: number) => interpolate(x, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
const big = { fontFamily: 'Space Grotesk', fontWeight: 500, letterSpacing: '-0.035em', color: C.text, lineHeight: 1.02 } as const;
const mono = (size: number, color: string = C.peach) => ({ font: `500 ${size}px IBM Plex Mono`, color, letterSpacing: '0.04em' }) as const;

function useData() {
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
  return useMemo(() => {
    if (!b) return null;
    const s = new SwapSeries(b.launch.mint);
    s.add(b.legs, 0);
    const [ca, cb] = busiestCandle(s);
    const solUsd = usdAt(b.usd, ca)?.solUsd ?? 100;
    const m = computeWindow(makeCtx(b, s), ca, cb, s.range(ca, cb));
    const mc = (p: number) => p * 1e9 * solUsd;
    let peak = s.swaps[0];
    for (const x of s.swaps) if (x.priceSol > peak.priceSol) peak = x;
    return { b, s, ca, cb, solUsd, m, mcStart: mc(s.swaps[0].priceSol), mcPeak: mc(peak.priceSol), seconds: peak.chainTime - s.swaps[0].chainTime };
  }, [b]);
}
type Data = NonNullable<ReturnType<typeof useData>>;

function Backdrop({ glowY = 70 }: { glowY?: number }) {
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 45% at 50% ${glowY}%, rgba(255,104,73,0.30), transparent 70%), radial-gradient(ellipse 90% 75% at 50% 50%, #3a1424 0%, ${C.bg} 80%)` }}>
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(circle, rgba(255,120,80,0.30) 1.6px, transparent 2.2px)', backgroundSize: '30px 30px', WebkitMaskImage: 'radial-gradient(ellipse 55% 30% at 50% 10%, #000 10%, transparent 80%)' }} />
    </AbsoluteFill>
  );
}

/** A shot fades/slides in and out between two cue times. */
function Shot({ t, from, to, children }: { t: number; from: number; to: number; children: React.ReactNode }) {
  const a = out(from - 0.12, from + 0.18, t) * (1 - sm(to - 0.18, to + 0.02, t));
  if (a <= 0) return null;
  return <AbsoluteFill style={{ opacity: a, transform: `translateY(${(1 - out(from - 0.12, from + 0.3, t)) * 30}px)` }}>{children}</AbsoluteFill>;
}

function Title({ children, top = 110, size = 96, align = 'left' as 'left' | 'center' }: { children: React.ReactNode; top?: number; size?: number; align?: 'left' | 'center' }) {
  return <div style={{ ...big, position: 'absolute', left: 80, right: 80, top, fontSize: size, textAlign: align }}>{children}</div>;
}

// 1 · hook — the real move, as a counter
function Hook({ t, d }: { t: number; d: Data }) {
  const k = out(0.25, Q.hookEnd - 0.25, t);
  const v = d.mcStart + (d.mcPeak - d.mcStart) * k;
  return (
    <>
      <div style={{ ...mono(30), position: 'absolute', top: 360, left: 0, right: 0, textAlign: 'center' }}>DACITY COIN · 15 OCT 2026</div>
      <div style={{ ...big, position: 'absolute', top: 420, left: 0, right: 0, textAlign: 'center', fontSize: 220, fontVariantNumeric: 'tabular-nums', color: k > 0.98 ? C.buy : C.text }}>{usd(v)}</div>
      <div style={{ ...big, position: 'absolute', top: 680, left: 0, right: 0, textAlign: 'center', fontSize: 72, color: C.text2, opacity: out(0.6, 1.1, t) }}>
        market cap, in {d.seconds} seconds.
      </div>
    </>
  );
}

// 2 · a candle hides its trades
function CandleOpen({ t, d }: { t: number; d: Data }) {
  const grow = out(Q.hookEnd, Q.hookEnd + 0.6, t);
  const split = sm(Q.candleSplit - 0.1, Q.candleSplit + 0.6, t);
  const cx = W / 2;
  const top = 470;
  const h = 560 * grow;
  const bw = 210;
  const dots = useMemo(() => {
    const r = mulberry32(7);
    return d.m.swaps.map((s) => ({ s, x: (r() - 0.5) * 1, y: r(), rad: Math.min(26, 7 + Math.sqrt(s.sol) * 6) }));
  }, [d]);
  return (
    <>
      <Title top={120} size={88}>
        {t < Q.candleSplit ? 'A chart shows you this.' : 'Not who’s inside it.'}
      </Title>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <line x1={cx} x2={cx} y1={top + 1080 - 1080 - 40} y2={top + h + 50} stroke={C.buy} strokeWidth={6} opacity={(1 - split) * grow} />
        <rect x={cx - bw / 2} y={top + 560 - h} width={bw} height={h} rx={6} fill={C.buy} opacity={1 - split * 0.92} />
        {dots.map(({ s, x, y, rad }, i) => {
          const delay = (i / dots.length) * 0.5;
          const a = out(Q.candleSplit + delay - 0.1, Q.candleSplit + delay + 0.35, t);
          if (a <= 0) return null;
          const spread = 1 + split * 2.6;
          const px = cx + x * bw * spread;
          const py = top + 40 + y * 480;
          const up = s.side === 'buy';
          const pts = up ? `${px},${py - rad} ${px + rad},${py + rad * 0.7} ${px - rad},${py + rad * 0.7}` : `${px},${py + rad} ${px + rad},${py - rad * 0.7} ${px - rad},${py - rad * 0.7}`;
          return up ? <polygon key={s.id} points={pts} fill={C.buy} opacity={a} /> : <polygon key={s.id} points={pts} fill="none" stroke={C.sell} strokeWidth={3} opacity={a} />;
        })}
      </svg>
      <div style={{ ...mono(30, C.text2), position: 'absolute', bottom: 120, left: 0, right: 0, textAlign: 'center', opacity: out(Q.candleSplit + 0.4, Q.candleSplit + 0.8, t) }}>
        {d.m.count} trades · {d.m.distinctBuyers.length} wallets · 5 seconds
      </div>
    </>
  );
}

// 3 · brand
function Brand({ t }: { t: number }) {
  const split = sm(Q.brand, Q.brand + 0.5, t) * (1 - sm(Q.brandAlign - 0.35, Q.brandAlign, t));
  return (
    <>
      <div style={{ position: 'absolute', left: (W - 1920) / 2, top: 120, width: 1920, height: 1080 }}>
        <BrandMark t={t} split={split} size={900} y={40} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 930, textAlign: 'center', opacity: out(Q.brandAlign - 0.1, Q.brandAlign + 0.25, t) }}>
        <span className="wordmark" style={{ fontSize: 96, letterSpacing: '0.14em' }}>
          TAPEZER<span className="wm-zero">O</span>
        </span>
      </div>
      <div style={{ ...big, position: 'absolute', left: 0, right: 0, top: 1070, textAlign: 'center', fontSize: 58, color: C.text2, opacity: out(Q.brandAlign + 0.1, Q.brandAlign + 0.45, t) }}>
        Every launch, frame by frame.
      </div>
    </>
  );
}

// 4 · rewind on the real chart
function Rewind({ t, d }: { t: number; d: Data }) {
  const n = d.s.size;
  const at = (f: number) => d.s.swaps[Math.max(0, Math.min(n - 1, Math.floor(n * f)))].tl;
  const k = sm(Q.rewindShot, Q.rewind, t);
  const liveAt = t < Q.rewind ? at(0.2 + 0.6 * k) : at(Math.min(1, 0.8 + (t - Q.rewind) * 0.09));
  const series = useMemo(() => {
    const s = new SwapSeries(d.b.launch.mint);
    s.add(d.b.legs.filter((l) => l.chainTime * 1000 + 500 <= liveAt), 0);
    return s;
  }, [Math.round(liveAt / 250)]);
  const rewFrom = at(0.8);
  const rewTo = rewFrom - 15_000;
  const playhead = t < Q.rewind ? series.liveEdge : rewFrom + (rewTo - rewFrom) * sm(Q.rewind, Q.rewind + 0.5, t);
  const ctrl = useMemo(() => new PlayerController(series, true), [series]);
  ctrl.s = { ...ctrl.s, playhead, viewport: [d.s.start + 9000, d.s.liveEdge + 2500], following: t < Q.rewind, playing: false, selection: null, highlight: null, filter: null };
  ctrl.version++;
  const ghosts: { t: number; a: number }[] = [];
  if (t >= Q.rewind && t < Q.rewind + 0.5) {
    const g = (t - Q.rewind) / 0.5;
    const ph = (x: number) => rewFrom + (rewTo - rewFrom) * sm(Q.rewind, Q.rewind + 0.5, t - x);
    ghosts.push({ t: ph(0.07), a: 1 - g }, { t: ph(0.14), a: (1 - g) * 0.7 });
  }
  const shown = series.swaps[series.indexAt(playhead)] ?? series.first;
  return (
    <>
      <Title top={110}>
        Rewind any launch
        <br />
        <span style={{ color: C.text2 }}>while it’s still trading.</span>
      </Title>
      <div style={{ ...mono(28), position: 'absolute', left: 80, top: 360 }}>
        {fmtClock(playhead / 1000)} UTC · market cap {usd((shown?.priceSol ?? 0) * 1e9 * d.solUsd)}
      </div>
      <div style={{ position: 'absolute', left: 60, top: 430, width: 640, height: 420, transform: 'scale(1.5)', transformOrigin: 'top left' }}>
        <Chart ctrl={ctrl} t0={d.s.start} gaps={[]} isLive usdPerSol={d.solUsd} supply={1e9} label="promo" fixed={{ w: 640, h: 420 }} staticGhosts={ghosts} compact />
      </div>
      {t >= Q.rewind && (
        <div style={{ ...big, position: 'absolute', right: 80, bottom: 150, fontSize: 150, color: C.accent, opacity: out(Q.rewind, Q.rewind + 0.2, t), transform: `scale(${0.9 + 0.1 * out(Q.rewind, Q.rewind + 0.3, t)})`, transformOrigin: 'right bottom' }}>−15 s</div>
      )}
      <div style={{ ...mono(30, C.text2), position: 'absolute', left: 80, bottom: 175, opacity: out(Q.rewind + 0.3, Q.rewind + 0.6, t) }}>new trades keep coming in</div>
    </>
  );
}

// 5 · open a candle
function Inspect({ t, d }: { t: number; d: Data }) {
  const m = d.m;
  const lines = [
    { text: `+${(m.changePct ?? 0).toFixed(0)}% in 5 seconds`, color: C.buy, size: 104 },
    { text: `${m.distinctBuyers.length} wallets bought ${usd(m.buySol * d.solUsd)}`, color: C.text, size: 70 },
    { text: `biggest buy ${usd(m.largestBuyShare.numerator * d.solUsd)}`, color: C.text, size: 70 },
    { text: `top 3 buyers: ${Math.round((m.top3Share.value ?? 0) * 100)}% of it`, color: C.peach, size: 70 },
  ];
  return (
    <>
      <Title top={110}>
        Click a candle.
        <br />
        <span style={{ color: C.text2 }}>See who bought it.</span>
      </Title>
      <div style={{ ...mono(30, C.text2), position: 'absolute', left: 80, top: 400 }}>
        {fmtClock(d.ca / 1000)} → {fmtClock(d.cb / 1000)} UTC
      </div>
      <div style={{ position: 'absolute', left: 80, right: 80, top: 470, borderLeft: `8px solid ${C.accent}`, paddingLeft: 44 }}>
        {lines.map((l, i) => {
          const a = out(Q.lines[i], Q.lines[i] + 0.25, t);
          return (
            <div key={i} style={{ ...big, fontSize: l.size, color: l.color, marginTop: i ? 34 : 0, opacity: a, transform: `translateX(${(1 - a) * 40}px)` }}>
              {l.text}
            </div>
          );
        })}
      </div>
      <div style={{ ...mono(28, C.text2), position: 'absolute', left: 80, right: 80, bottom: 130, opacity: out(Q.lines[3] + 0.3, Q.lines[3] + 0.6, t) }}>
        written in plain words, computed from the trades
      </div>
    </>
  );
}

// 6 · every trade is checkable
function Proof({ t, d }: { t: number; d: Data }) {
  const trades = useMemo(() => [...d.m.swaps].sort((a, b) => b.sol - a.sol).slice(0, 6), [d]);
  return (
    <>
      <Title top={110}>
        Every trade
        <br />
        <span style={{ color: C.text2 }}>is checkable.</span>
      </Title>
      <div style={{ position: 'absolute', left: 60, right: 60, top: 420 }}>
        {trades.map((s, i) => {
          const a = out(Q.proof + 0.2 + i * 0.14, Q.proof + 0.5 + i * 0.14, t);
          return (
            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '170px 130px 170px 1fr 190px', alignItems: 'center', gap: 16, padding: '22px 20px', borderBottom: `1px solid ${C.divider}`, opacity: a, transform: `translateY(${(1 - a) * 24}px)`, font: '500 34px IBM Plex Mono', color: C.text }}>
              <span style={{ color: C.text2 }}>{fmtClock(s.chainTime)}</span>
              <span style={{ color: s.side === 'buy' ? C.buy : C.sell }}>{s.side === 'buy' ? '▲ Buy' : '▽ Sell'}</span>
              <span style={{ textAlign: 'right' }}>{usd(s.sol * d.solUsd)}</span>
              <span style={{ color: C.text2 }}>{short(s.wallet)}</span>
              <span style={{ color: C.peach, textAlign: 'right' }}>Solscan ↗</span>
            </div>
          );
        })}
      </div>
      <div style={{ ...mono(28, C.text2), position: 'absolute', left: 80, right: 80, bottom: 130 }}>read straight from Solana · no account needed</div>
    </>
  );
}

// 7 · end card
function End({ t }: { t: number }) {
  const split = sm(Q.final - 0.5, Q.final - 0.2, t) * (1 - sm(Q.final - 0.15, Q.final, t)) * 0.7;
  return (
    <>
      <div style={{ position: 'absolute', left: (W - 1920) / 2, top: 30, width: 1920, height: 1080 }}>
        <BrandMark t={t} split={split} size={760} y={60} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 800, textAlign: 'center' }}>
        <span className="wordmark" style={{ fontSize: 104, letterSpacing: '0.14em' }}>
          TAPEZER<span className="wm-zero">O</span>
        </span>
      </div>
      <div style={{ ...big, position: 'absolute', left: 60, right: 60, top: 950, textAlign: 'center', fontSize: 64 }}>Rewind Solana launches,
        <br />
        trade by trade.
      </div>
      <div style={{ ...mono(28, C.text2), position: 'absolute', left: 0, right: 0, bottom: 110, textAlign: 'center', opacity: out(Q.end + 0.8, Q.end + 1.2, t) }}>pump.fun · PumpSwap · free</div>
    </>
  );
}

export function Promo() {
  const d = useData();
  const t = useCurrentFrame() / FPS;
  return (
    <AbsoluteFill className="film" style={{ background: C.bg, fontFamily: 'Space Grotesk', width: W, height: H }}>
      <Audio src={staticFile('film/promo.wav')} />
      <Backdrop glowY={t < Q.brand || (t >= Q.brand && t < Q.rewindShot) || t >= Q.end ? 62 : 85} />
      {d && (
        <>
          <Shot t={t} from={0} to={Q.hookEnd}>
            <Hook t={t} d={d} />
          </Shot>
          <Shot t={t} from={Q.hookEnd} to={Q.brand}>
            <CandleOpen t={t} d={d} />
          </Shot>
          <Sequence from={Math.floor((Q.brand - 0.2) * FPS)} durationInFrames={Math.ceil((Q.rewindShot - Q.brand + 0.4) * FPS)}>
            <Shot t={t} from={Q.brand} to={Q.rewindShot}>
              <Brand t={t} />
            </Shot>
          </Sequence>
          <Shot t={t} from={Q.rewindShot} to={Q.inspect}>
            <Rewind t={t} d={d} />
          </Shot>
          <Shot t={t} from={Q.inspect} to={Q.proof}>
            <Inspect t={t} d={d} />
          </Shot>
          <Shot t={t} from={Q.proof} to={Q.end}>
            <Proof t={t} d={d} />
          </Shot>
          <Sequence from={Math.floor((Q.end - 0.2) * FPS)}>
            <Shot t={t} from={Q.end} to={Q.total + 1}>
              <End t={t} />
            </Shot>
          </Sequence>
        </>
      )}
    </AbsoluteFill>
  );
}
