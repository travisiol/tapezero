// TAPEZERO — X launch post. 1080×1350 (4:5), 31 s, captions burned in (X autoplays muted).
// Story: problem first, then the product, one plain sentence per screen.
// Numbers come from the real DacityCoin (DCTY) trades of 18 Nov 2026; launch names are real pump.fun launches seen by the collector.
import { AbsoluteFill, Audio, Img, staticFile, useCurrentFrame, delayRender, continueRender, interpolate, Easing } from 'remotion';
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
import type { LaunchBundle } from '../src/core/types.ts';
import { REFERENCE, expandBundle } from '../src/core/reference.ts';

export const PROMO_W = 1080;
export const PROMO_H = 1350;
const W = PROMO_W;

// Real pump.fun launches captured by the TAPEZERO collector on 21 Nov 2026 (neutral names only).
const LAUNCHES = ['Moon Frog', 'Banana Wizard', 'Panic Dog', 'Chaotic Rocket', 'Fiona the Hippo', 'Singularity Cat', 'Harborlight', 'Muscle Frog', 'Cheat Code', 'Kiska The Polarbear', 'Bull Wif Hat', 'Insert coin here'];

const sm = (a: number, b: number, x: number) => interpolate(x, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
const out = (a: number, b: number, x: number) => interpolate(x, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
const big = { fontFamily: 'Space Grotesk', fontWeight: 500, letterSpacing: '-0.035em', color: C.text, lineHeight: 1.04 } as const;
const mono = (size: number, color: string = C.peach) => ({ font: `500 ${size}px IBM Plex Mono`, color, letterSpacing: '0.03em' }) as const;

function useData() {
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
  return useMemo(() => {
    if (!b) return null;
    const s = new SwapSeries(b.launch.mint);
    s.add(b.legs, 0);
    const [ca, cb] = busiestCandle(s);
    const solUsd = usdAt(b.usd, ca)?.solUsd ?? 100;
    const m = computeWindow(makeCtx(b, s), ca, cb, s.range(ca, cb));
    let peak = s.swaps[0];
    for (const x of s.swaps) if (x.priceSol > peak.priceSol) peak = x;
    const mc = (p: number) => p * 1e9 * solUsd;
    return { b, s, ca, cb, solUsd, m, mcStart: mc(s.swaps[0].priceSol), mcPeak: mc(peak.priceSol), seconds: peak.chainTime - s.swaps[0].chainTime };
  }, [b]);
}
type Data = NonNullable<ReturnType<typeof useData>>;

function Backdrop() {
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 40% at 50% 72%, rgba(255,104,73,0.26), transparent 70%), radial-gradient(ellipse 90% 75% at 50% 50%, #3a1424 0%, ${C.bg} 80%)` }}>
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(circle, rgba(255,120,80,0.28) 1.6px, transparent 2.2px)', backgroundSize: '30px 30px', WebkitMaskImage: 'radial-gradient(ellipse 55% 26% at 50% 8%, #000 10%, transparent 80%)' }} />
    </AbsoluteFill>
  );
}

function Shot({ t, from, to, children }: { t: number; from: number; to: number; children: React.ReactNode }) {
  const a = out(from - 0.1, from + 0.25, t) * (1 - sm(to - 0.25, to, t));
  if (a <= 0) return null;
  return <AbsoluteFill style={{ opacity: a }}>{children}</AbsoluteFill>;
}

/** The one sentence of the screen: always at the same place, always readable first. */
function Headline({ t, from, children }: { t: number; from: number; children: React.ReactNode }) {
  const a = out(from, from + 0.45, t);
  return (
    <div style={{ ...big, position: 'absolute', left: 80, right: 80, top: 130, fontSize: 84, opacity: a, transform: `translateY(${(1 - a) * 26}px)` }}>
      {children}
    </div>
  );
}
const Dim = ({ children }: { children: React.ReactNode }) => <span style={{ color: C.text2 }}>{children}</span>;

// 1 · new tokens every minute
function Feed({ t }: { t: number }) {
  return (
    <>
      <Headline t={t} from={0.1}>
        New tokens launch
        <br />
        <Dim>every minute on Solana.</Dim>
      </Headline>
      <div style={{ position: 'absolute', left: 80, right: 80, top: 440 }}>
        {LAUNCHES.slice(0, 8).map((name, i) => {
          const a = out(0.5 + i * 0.3, 0.8 + i * 0.3, t);
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '17px 0', borderBottom: `1px solid ${C.divider}`, opacity: a, transform: `translateX(${(1 - a) * 40}px)` }}>
              <span style={{ width: 14, height: 14, borderRadius: 7, background: C.accent }} />
              <span style={{ ...big, fontSize: 46, flex: 1 }}>{name}</span>
              <span style={mono(28, C.text2)}>just launched</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// 2 · some explode in seconds (real)
function Explode({ t, d }: { t: number; d: Data }) {
  const k = out(Q.explode + 0.4, Q.explode + 2.6, t);
  const v = d.mcStart + (d.mcPeak - d.mcStart) * k;
  return (
    <>
      <Headline t={t} from={Q.explode}>
        Some explode
        <br />
        <Dim>{d.seconds < 120 ? "in seconds." : "in minutes."}</Dim>
      </Headline>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 520, textAlign: 'center' }}>
        <div style={{ ...mono(32), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18 }}><Img src={staticFile('tokens/dcty.webp')} style={{ width: 72, height: 72, borderRadius: 19, boxShadow: '0 0 0 2px rgba(255,179,148,0.3)' }} />{REFERENCE.name} · market cap</div>
        <div style={{ ...big, fontSize: 210, color: k > 0.98 ? C.buy : C.text, fontVariantNumeric: 'tabular-nums', marginTop: 10 }}>{usd(v)}</div>
        <div style={{ ...big, fontSize: 52, color: C.text2, marginTop: 18, opacity: out(Q.explode + 2.2, Q.explode + 2.7, t) }}>
          from {usd(d.mcStart)} in {d.seconds < 120 ? `${d.seconds} seconds` : `${Math.round(d.seconds / 60)} minutes`}
        </div>
        <div style={{ ...mono(28, C.text2), marginTop: 50, opacity: out(Q.explode + 2.4, Q.explode + 2.9, t) }}>{REFERENCE.date} · real trades on {REFERENCE.venue}</div>
      </div>
    </>
  );
}

// 3 · a chart doesn't say who
function ChartOnly({ t, d }: { t: number; d: Data }) {
  const ctrl = useMemo(() => {
    const c = new PlayerController(d.s, false);
    c.s = { ...c.s, playhead: d.s.liveEdge, viewport: [d.s.start + 9000, d.s.liveEdge + 2500], following: false, selection: null, highlight: null, filter: null };
    return c;
  }, [d]);
  const q = out(Q.chart + 1.3, Q.chart + 1.8, t);
  return (
    <>
      <Headline t={t} from={Q.chart}>
        A chart shows price.
        <br />
        <Dim>Not who’s buying.</Dim>
      </Headline>
      <div style={{ position: 'absolute', left: 60, top: 450, width: 640, height: 420, transform: 'scale(1.5)', transformOrigin: 'top left' }}>
        <Chart ctrl={ctrl} t0={d.s.start} gaps={[]} isLive={false} usdPerSol={d.solUsd} supply={1e9} label="promo" fixed={{ w: 640, h: 420 }} staticGhosts={[]} compact />
      </div>
      <div style={{ ...big, position: 'absolute', right: 150, top: 560, fontSize: 200, color: C.accent, opacity: q, transform: `scale(${0.8 + 0.2 * q})` }}>?</div>
    </>
  );
}

// 4 · brand
function Brand({ t }: { t: number }) {
  const split = sm(Q.brand + 0.1, Q.brand + 0.6, t) * (1 - sm(Q.brandAlign - 0.35, Q.brandAlign, t));
  return (
    <>
      <div style={{ position: 'absolute', left: (W - 1920) / 2, top: 60, width: 1920, height: 1080 }}>
        <BrandMark t={t} split={split} size={900} y={40} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 880, textAlign: 'center', opacity: out(Q.brandAlign - 0.1, Q.brandAlign + 0.25, t) }}>
        <span className="wordmark" style={{ fontSize: 104, letterSpacing: '0.14em' }}>
          TAPEZER<span className="wm-zero">O</span>
        </span>
      </div>
      <div style={{ ...big, position: 'absolute', left: 0, right: 0, top: 1030, textAlign: 'center', fontSize: 80, opacity: out(Q.brandAlign + 0.2, Q.brandAlign + 0.6, t) }}>shows you.</div>
    </>
  );
}

// 5 · rewind
function Rewind({ t, d }: { t: number; d: Data }) {
  const n = d.s.size;
  const at = (f: number) => d.s.swaps[Math.max(0, Math.min(n - 1, Math.floor(n * f)))].tl;
  const k = sm(Q.rewindShot, Q.rewind, t);
  const liveAt = t < Q.rewind ? at(0.25 + 0.55 * k) : at(Math.min(1, 0.8 + (t - Q.rewind) * 0.07));
  const series = useMemo(() => {
    const s = new SwapSeries(d.b.launch.mint);
    s.add(d.b.legs.filter((l) => l.chainTime * 1000 + 500 <= liveAt), 0);
    return s;
  }, [Math.round(liveAt / 250)]);
  const rewFrom = at(0.8);
  const rewTo = rewFrom - 15_000;
  const playhead = t < Q.rewind ? series.liveEdge : rewFrom + (rewTo - rewFrom) * sm(Q.rewind, Q.rewind + 0.6, t);
  const ctrl = useMemo(() => new PlayerController(series, true), [series]);
  ctrl.s = { ...ctrl.s, playhead, viewport: [d.s.start + 9000, d.s.liveEdge + 2500], following: t < Q.rewind, playing: false, selection: null, highlight: null, filter: null };
  ctrl.version++;
  const ghosts: { t: number; a: number }[] = [];
  if (t >= Q.rewind && t < Q.rewind + 0.6) {
    const g = (t - Q.rewind) / 0.6;
    const ph = (x: number) => rewFrom + (rewTo - rewFrom) * sm(Q.rewind, Q.rewind + 0.6, t - x);
    ghosts.push({ t: ph(0.08), a: 1 - g }, { t: ph(0.16), a: (1 - g) * 0.7 });
  }
  return (
    <>
      <Headline t={t} from={Q.rewindShot}>
        Pause any launch.
        <br />
        <Dim>Go back in time.</Dim>
      </Headline>
      <div style={{ position: 'absolute', left: 60, top: 450, width: 640, height: 420, transform: 'scale(1.5)', transformOrigin: 'top left' }}>
        <Chart ctrl={ctrl} t0={d.s.start} gaps={[]} isLive usdPerSol={d.solUsd} supply={1e9} label="promo" fixed={{ w: 640, h: 420 }} staticGhosts={ghosts} compact />
      </div>
      <div style={{ position: 'absolute', left: 80, right: 80, bottom: 120, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ ...mono(30, C.text2), opacity: out(Q.rewind + 0.4, Q.rewind + 0.8, t) }}>while trades keep coming in</span>
        {t >= Q.rewind && <span style={{ ...big, fontSize: 130, color: C.accent, opacity: out(Q.rewind, Q.rewind + 0.25, t) }}>−15 s</span>}
      </div>
    </>
  );
}

// 6 · open a candle
function Inspect({ t, d }: { t: number; d: Data }) {
  const m = d.m;
  const lines = [
    { text: `${m.distinctBuyers.length} wallets bought`, size: 84, color: C.text },
    { text: `${usd(m.buySol * d.solUsd)} in 5 seconds`, size: 84, color: C.buy },
    { text: `biggest buy: ${usd(m.largestBuyShare.numerator * d.solUsd)}`, size: 84, color: C.peach },
  ];
  return (
    <>
      <Headline t={t} from={Q.inspect}>
        Click a candle.
        <br />
        <Dim>See who bought it.</Dim>
      </Headline>
      <div style={{ ...mono(30, C.text2), position: 'absolute', left: 80, top: 470, opacity: out(Q.inspect + 0.3, Q.inspect + 0.6, t), display: 'flex', alignItems: 'center', gap: 14 }}>
        <Img src={staticFile('tokens/dcty.webp')} style={{ width: 48, height: 48, borderRadius: 12, boxShadow: '0 0 0 2px rgba(255,179,148,0.3)' }} />{REFERENCE.name} · {fmtClock(d.ca / 1000)} → {fmtClock(d.cb / 1000)} UTC
      </div>
      <div style={{ position: 'absolute', left: 80, right: 80, top: 560, borderLeft: `8px solid ${C.accent}`, paddingLeft: 44 }}>
        {lines.map((l, i) => {
          const a = out(Q.lines[i], Q.lines[i] + 0.3, t);
          return (
            <div key={i} style={{ ...big, fontSize: l.size, color: l.color, marginTop: i ? 40 : 0, opacity: a, transform: `translateX(${(1 - a) * 40}px)` }}>
              {l.text}
            </div>
          );
        })}
      </div>
    </>
  );
}

// 7 · proof
function Proof({ t, d }: { t: number; d: Data }) {
  const trades = useMemo(() => [...d.m.swaps].sort((a, b) => b.sol - a.sol).slice(0, 5), [d]);
  return (
    <>
      <Headline t={t} from={Q.proof}>
        Every trade links
        <br />
        <Dim>to its proof.</Dim>
      </Headline>
      <div style={{ position: 'absolute', left: 60, right: 60, top: 470 }}>
        {trades.map((s, i) => {
          const a = out(Q.proof + 0.4 + i * 0.2, Q.proof + 0.7 + i * 0.2, t);
          return (
            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 150px 190px', alignItems: 'center', gap: 12, padding: '26px 16px', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.divider}`, opacity: a, transform: `translateY(${(1 - a) * 24}px)`, font: '500 35px IBM Plex Mono', color: C.text }}>
              <span style={{ color: s.side === 'buy' ? C.buy : C.sell }}>{s.side === 'buy' ? '▲ Buy' : '▽ Sell'}</span>
              <span style={{ color: C.text2 }}>{short(s.wallet)}</span>
              <span style={{ textAlign: 'right' }}>{usd(s.sol * d.solUsd)}</span>
              <span style={{ color: C.peach, textAlign: 'right' }}>Solscan ↗</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// 8 · end
function End({ t }: { t: number }) {
  const split = sm(Q.final - 0.5, Q.final - 0.2, t) * (1 - sm(Q.final - 0.15, Q.final, t)) * 0.7;
  return (
    <>
      <div style={{ position: 'absolute', left: (W - 1920) / 2, top: 10, width: 1920, height: 1080 }}>
        <BrandMark t={t} split={split} size={760} y={70} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 780, textAlign: 'center' }}>
        <span className="wordmark" style={{ fontSize: 108, letterSpacing: '0.14em' }}>
          TAPEZER<span className="wm-zero">O</span>
        </span>
      </div>
      <div style={{ ...big, position: 'absolute', left: 60, right: 60, top: 930, textAlign: 'center', fontSize: 66 }}>
        Rewind Solana launches,
        <br />
        trade by trade.
      </div>
      <div style={{ ...mono(30, C.text2), position: 'absolute', left: 0, right: 0, bottom: 110, textAlign: 'center', opacity: out(Q.end + 0.8, Q.end + 1.2, t) }}>free · no account · pump.fun & PumpSwap</div>
    </>
  );
}

export function Promo() {
  const d = useData();
  const t = useCurrentFrame() / FPS;
  return (
    <AbsoluteFill className="film" style={{ background: C.bg, fontFamily: 'Space Grotesk' }}>
      <Audio src={staticFile('film/promo.wav')} />
      <Backdrop />
      <Shot t={t} from={0} to={Q.explode}>
        <Feed t={t} />
      </Shot>
      {d && (
        <>
          <Shot t={t} from={Q.explode} to={Q.chart}>
            <Explode t={t} d={d} />
          </Shot>
          <Shot t={t} from={Q.chart} to={Q.brand}>
            <ChartOnly t={t} d={d} />
          </Shot>
          {t >= Q.brand - 0.2 && t < Q.rewindShot + 0.1 && (
            <Shot t={t} from={Q.brand} to={Q.rewindShot}>
              <Brand t={t} />
            </Shot>
          )}
          <Shot t={t} from={Q.rewindShot} to={Q.inspect}>
            <Rewind t={t} d={d} />
          </Shot>
          <Shot t={t} from={Q.inspect} to={Q.proof}>
            <Inspect t={t} d={d} />
          </Shot>
          <Shot t={t} from={Q.proof} to={Q.end}>
            <Proof t={t} d={d} />
          </Shot>
          {t >= Q.end - 0.2 && (
            <Shot t={t} from={Q.end} to={Q.total + 1}>
              <End t={t} />
            </Shot>
          )}
        </>
      )}
    </AbsoluteFill>
  );
}
