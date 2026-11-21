import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '../router.tsx';
import { Wordmark, ZeroMark } from './Brand.tsx';
import { LandingPlayer, busiestCandle } from './LandingPlayer.tsx';
import { prefersReducedMotion } from '../util.ts';
import { demoReplayHandle, referenceHandle, type LaunchHandle } from '../data/sources.ts';
import { PlayerController } from '../../core/player.ts';
import { Chart } from '../player/Chart.tsx';
import { CompareView } from '../terminal/Compare.tsx';
import { compareSide, computeWindow, usdAt } from '../../core/metrics.ts';
import { makeCtx } from '../../core/context.ts';
import { fmtClock, fmtShare } from '../../core/format.ts';
import { money, summarize } from '../../core/summary.ts';
import { SERIES_STYLE } from '../player/drawCompare.ts';

export const TRAILER_SRC = '/film/trailer.mp4';
export const TRAILER_POSTER = '/film/trailer-poster.jpg';

/** 10-second trailer, inline: autoplays muted and loops; sound on request; still frame under reduced motion. */
function Trailer() {
  const v = useRef<HTMLVideoElement>(null);
  const reduced = prefersReducedMotion();
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(!reduced);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = v.current;
    if (!el || reduced) return;
    el.muted = true;
    el.play().catch(() => setPlaying(false));
  }, [reduced]);
  if (failed)
    return (
      <div className="trailer trailer-fallback dots-bg">
        <ZeroMark size={260} />
      </div>
    );
  return (
    <figure className="trailer">
      <video ref={v} src={TRAILER_SRC} poster={TRAILER_POSTER} muted loop playsInline autoPlay={!reduced} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setFailed(true)} aria-label="TAPEZERO in 10 seconds: rewinding the real Dacity Coin trades" />
      <div className="trailer-ctrl">
        <button type="button" className="btn btn-icon btn-glass" onClick={() => (v.current!.paused ? v.current!.play().catch(() => {}) : v.current!.pause())} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" /></svg> : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11L13 8z" fill="currentColor" /></svg>}
        </button>
        <button
          type="button"
          className="btn btn-s btn-glass"
          aria-pressed={!muted}
          onClick={() => {
            const el = v.current!;
            el.muted = !el.muted;
            setMuted(el.muted);
            if (el.paused) el.play().catch(() => {});
          }}
        >
          {muted ? 'Sound on' : 'Sound off'}
        </button>
      </div>
    </figure>
  );
}

function useReference() {
  const [h, setH] = useState<LaunchHandle | null>(null);
  useEffect(() => {
    referenceHandle().then(setH, () => {});
  }, []);
  return h;
}

/** Real chart: the playhead sits 15 s behind the live edge while trades keep landing. */
function RewindDemo({ h }: { h: LaunchHandle }) {
  const ctrl = useMemo(() => {
    const c = new PlayerController(h.series, true);
    const edge = h.series.liveEdge;
    c.set({ following: false, playhead: edge - 15_000, viewport: [edge - 32_000, edge + 2500] });
    return c;
  }, [h]);
  return <Chart ctrl={ctrl} t0={h.series.start} gaps={[]} isLive usdPerSol={usdAt(h.bundle.usd, h.series.liveEdge)?.solUsd ?? null} supply={h.bundle.launch.supply} compact label="Playhead 15 seconds behind the live edge on Dacity Coin" />;
}

/** Real reading of the busiest five seconds. */
function CandleReading({ h }: { h: LaunchHandle }) {
  const { m, solUsd } = useMemo(() => {
    const [a, b] = busiestCandle(h.series);
    const solUsd = usdAt(h.bundle.usd, a)?.solUsd ?? null;
    return { m: computeWindow(makeCtx(h.bundle, h.series), a, b, h.series.range(a, b)), solUsd };
  }, [h]);
  return (
    <div className="reading">
      <p className="panel-kicker">
        Dacity Coin · {fmtClock(m.a / 1000)} → {fmtClock(m.b / 1000)} UTC
      </p>
      <ul className="story">
        {summarize(m, solUsd)
          .slice(0, 4)
          .map((x, i) => (
            <li key={i}>
              <span className="story-line">{x.text}</span>
            </li>
          ))}
      </ul>
      <div className="keys">
        <div className="key">
          <span className="key-label">Bought</span>
          <span className="key-value mono">{money(m.buySol, solUsd)}</span>
          <span className="key-sub">{m.buys.length} buys</span>
        </div>
        <div className="key">
          <span className="key-label">Biggest buy</span>
          <span className="key-value mono">{money(m.largestBuyShare.numerator, solUsd)}</span>
          <span className="key-sub">{fmtShare(m.largestBuyShare.value)} of the buying</span>
        </div>
      </div>
    </div>
  );
}

function CompareDemo() {
  const sides = useMemo(
    () =>
      ['holo', 'stak'].map((k) => {
        const d = demoReplayHandle(k, 300);
        return compareSide(makeCtx(d.bundle, d.series), 30_000);
      }),
    [],
  );
  return (
    <div className="compare-demo">
      <CompareView sides={sides} names={['Launch A', 'Launch B']} windowMs={30_000} dt={30_000} height={230} />
      <div className="compare-facts">
        <p>
          <span style={{ color: SERIES_STYLE[0].color }}>A</span> {sides[0].buyersBeforePeak} buyers · biggest wallet {fmtShare(sides[0].topBuyerShare.value)} of the buying
        </p>
        <p>
          <span style={{ color: SERIES_STYLE[1].color }}>B</span> {sides[1].buyersBeforePeak} buyers · biggest wallet {fmtShare(sides[1].topBuyerShare.value)} of the buying
        </p>
        <span className="badge badge-demo">Demo data</span>
      </div>
    </div>
  );
}

const FAQ: [string, string][] = [
  ['What is TAPEZERO?', 'A player for Solana token launches. You can pause a launch while it is still trading, go back in time, and click any candle to see the trades and wallets that made it.'],
  ['Which coins are covered?', 'Tokens launched on pump.fun, on their bonding curve and after they move to PumpSwap. Other venues are not covered yet.'],
  ['Is it live?', 'The terminal follows new launches live when the collector is running. The example on this page is a replay of real trades from 15 October 2026.'],
  ['Where does the data come from?', 'Straight from Solana: every trade is read from the transaction itself and links to Solscan so you can check it.'],
  ['Does it tell me what to buy?', 'No. TAPEZERO shows what happened — who bought, how much, when. It never gives buy or sell signals or predictions.'],
  ['Do I need an account?', 'No. The terminal is free and public.'],
];

export function Landing() {
  const ref = useReference();
  useEffect(() => {
    document.title = 'TAPEZERO — Every launch, frame by frame.';
  }, []);
  return (
    <div className="landing">
      <header className="nav">
        <Link to="/" className="brand" aria-label="TAPEZERO home">
          <Wordmark />
        </Link>
        <nav aria-label="Sections" className="nav-links">
          <a href="#how">How it works</a>
          <a href="#example">Example</a>
          <a href="#faq">FAQ</a>
        </nav>
        <Link to="/app" className="btn btn-primary btn-s">
          Open Terminal
        </Link>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-bg" aria-hidden="true" />
        <div className="hero-copy">
          <h1 id="hero-title">
            Every launch,
            <br />
            frame by frame.
          </h1>
          <p className="lede">TAPEZERO replays Solana launches trade by trade. Pause, rewind, click a candle and see who bought it.</p>
          <div className="row gap-m wrap">
            <Link to="/app" className="btn btn-primary btn-l">
              Open Terminal
            </Link>
            <a href="#example" className="btn btn-l btn-glass">
              Try a real launch
            </a>
          </div>
        </div>
        <Trailer />
      </section>

      <section className="venues" aria-label="Data sources">
        <span className="muted small">Reads every trade straight from Solana</span>
        <ul>
          <li>pump.fun</li>
          <li>PumpSwap</li>
          <li>Solscan links</li>
          <li>Second-by-second</li>
        </ul>
      </section>

      <section className="statement" aria-label="Why">
        <p>
          A launch moves in seconds.
          <br />
          <span className="muted">Charts show candles. TAPEZERO shows the trades inside them.</span>
        </p>
      </section>

      <div id="how">
        <section className="feature" aria-labelledby="f1">
          <div className="feature-copy">
            <p className="feature-kicker">Rewind</p>
            <h2 id="f1">Go back while it’s still trading.</h2>
            <p>Pause a launch, scrub back 15 seconds, play it at 0.5× or 5×. New trades keep arriving in the background. One click on Go Live brings you back to now.</p>
          </div>
          <div className="feature-ui">{ref ? <RewindDemo h={ref} /> : <div className="feature-loading" />}</div>
        </section>

        <section className="feature feature-flip" aria-labelledby="f2">
          <div className="feature-copy">
            <p className="feature-kicker">Open a candle</p>
            <h2 id="f2">See who made the move.</h2>
            <p>Click any candle and TAPEZERO explains it in plain words: how many wallets bought, how much money went in, and how big the largest buy was. Every trade links to Solscan.</p>
          </div>
          <div className="feature-ui">{ref ? <CandleReading h={ref} /> : <div className="feature-loading" />}</div>
        </section>

        <section className="feature" aria-labelledby="f3">
          <div className="feature-copy">
            <p className="feature-kicker">Compare</p>
            <h2 id="f3">Same chart, different story.</h2>
            <p>Line two launches up on their first trade. Here both reach the same peak — one with forty buyers, the other with one big wallet doing most of the buying.</p>
          </div>
          <div className="feature-ui">
            <CompareDemo />
          </div>
        </section>
      </div>

      <section id="example" className="section section-player" aria-labelledby="ex-title">
        <div className="example-head">
          <p className="feature-kicker">Real example</p>
          <h2 id="ex-title" className="section-title">The GTA VI “Dacity Coin” moment.</h2>
        </div>
        <LandingPlayer />
      </section>

      <section id="faq" className="section faq" aria-labelledby="faq-title">
        <h2 id="faq-title" className="section-title">Questions</h2>
        <div className="faq-list">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="section cta dots-bg" aria-label="Open the terminal">
        <h2 className="section-title">Rewind the next launch.</h2>
        <Link to="/app" className="btn btn-primary btn-l">
          Open Terminal
        </Link>
      </section>

      <footer className="foot">
        <Wordmark />
        <span className="muted small">Shows on-chain activity only. Not financial advice.</span>
      </footer>
    </div>
  );
}
