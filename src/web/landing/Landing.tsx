import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link } from '../router.tsx';
import { Wordmark, ZeroMark } from './Brand.tsx';
import { FilmModal, FILM_POSTER } from './FilmModal.tsx';
import { LandingPlayer, peakWindow } from './LandingPlayer.tsx';
import { preferLightHero, prefersReducedMotion, webglAvailable } from '../util.ts';
import { demoReplayHandle } from '../data/sources.ts';
import { PlayerController } from '../../core/player.ts';
import { Chart } from '../player/Chart.tsx';
import { CompareView } from '../terminal/Compare.tsx';
import { compareSide, computeWindow } from '../../core/metrics.ts';
import { makeCtx } from '../../core/context.ts';
import { fmtShare, fmtSol } from '../../core/format.ts';
import { SERIES_STYLE } from '../player/drawCompare.ts';

const HeroCanvas = lazy(() => import('../three/HeroCanvas.tsx'));

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 2.5v11L13 8z" fill="currentColor" />
    </svg>
  );
}

export function Landing() {
  const [film, setFilm] = useState(false);
  const reduced = prefersReducedMotion();
  const [use3d, setUse3d] = useState(false);
  const [ready, setReady] = useState(false);
  const [posterOk, setPosterOk] = useState(true);
  useEffect(() => {
    document.title = 'TAPEZERO — Every launch, frame by frame.';
    if (!webglAvailable() || preferLightHero()) return;
    // load the 3D scene after the main content is interactive
    const idle = (window as Window & { requestIdleCallback?: (f: () => void, o?: object) => number }).requestIdleCallback;
    if (idle) idle(() => setUse3d(true), { timeout: 1200 });
    else setTimeout(() => setUse3d(true), 400);
  }, []);
  return (
    <div className="landing">
      <header className="nav">
        <Link to="/" className="brand" aria-label="TAPEZERO home">
          <Wordmark />
        </Link>
        <nav aria-label="Sections" className="nav-links">
          <a href="#player">Player</a>
          <a href="#how">How it works</a>
          <a href="#data">Data</a>
        </nav>
        <Link to="/app" className="btn btn-primary btn-s">
          Open Terminal
        </Link>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className={`hero-visual${ready ? ' is-ready' : ''}`} aria-hidden="true">
          <div className="hero-poster">
            {posterOk ? <img className="hero-poster-img" src="/hero-poster.jpg" alt="" onError={() => setPosterOk(false)} /> : <ZeroMark size={420} className="hero-mark" />}
          </div>
          {use3d && (
            <Suspense fallback={null}>
              <HeroCanvas reduced={reduced} onReady={() => setReady(true)} />
            </Suspense>
          )}
        </div>
        <div className="hero-copy">
          <p className="eyebrow">Solana launch player</p>
          <h1 id="hero-title">Every launch, frame by frame.</h1>
          <p className="lede">Rewind live Solana launches. Inspect the swaps behind every move.</p>
          <div className="row gap-m wrap">
            <Link to="/app" className="btn btn-primary btn-l">
              Open Terminal
            </Link>
            <button type="button" className="btn btn-l btn-glass" onClick={() => setFilm(true)}>
              <PlayIcon /> Watch the Film
            </button>
          </div>
          <p className="small muted hero-note">pump.fun launches and PumpSwap pools · public, no account needed</p>
        </div>
      </section>

      <section id="player" className="section section-player" aria-label="Interactive player">
        <LandingPlayer />
      </section>

      <section id="how" className="section" aria-labelledby="how-title">
        <h2 id="how-title" className="section-title">Three moves.</h2>
        <div className="three">
          <RewindCard />
          <InspectCard />
          <CompareCard />
        </div>
      </section>

      <section id="data" className="section data" aria-labelledby="data-title">
        <div>
          <h2 id="data-title" className="section-title">What the tape covers.</h2>
        </div>
        <ul className="facts">
          <li>
            <strong>Venues.</strong> pump.fun bonding-curve trades and PumpSwap pools of migrated tokens, decoded from on-chain program events at <em>confirmed</em> commitment.
          </li>
          <li>
            <strong>Time.</strong> Swaps are ordered by slot and position in the transaction. On-chain time has one-second resolution; we never invent milliseconds.
          </li>
          <li>
            <strong>Archive.</strong> 48 hours from the moment the collector started. Faded launches stay listed. If tracking began late, the token says so.
          </li>
          <li>
            <strong>Values.</strong> Prices come from curve and pool reserves. FDV only appears with a dated SOL/USD reference and its method.
          </li>
          <li>
            <strong>Wallets.</strong> Addresses are counted as addresses. A shared funder is a hint shown with its transaction — never proof of who controls a wallet.
          </li>
          <li>
            <strong>No calls.</strong> No buy or sell signals, no verdicts, no price predictions. Only what happened, with a link to verify it.
          </li>
        </ul>
      </section>

      <section className="section cta dots-bg" aria-label="Open the terminal">
        <ZeroMark size={88} />
        <h2 className="section-title">Rewind the next launch.</h2>
        <div className="row gap-m wrap center-x">
          <Link to="/app" className="btn btn-primary btn-l">
            Open Terminal
          </Link>
          <button type="button" className="btn btn-l btn-glass" onClick={() => setFilm(true)}>
            <PlayIcon /> Watch the Film
          </button>
        </div>
      </section>

      <footer className="foot">
        <Wordmark />
        <span className="muted small">Observable on-chain activity. Not financial advice. Demo sections use synthetic data and are labelled.</span>
        <a className="small" href={FILM_POSTER}>Film poster</a>
      </footer>
      {film && <FilmModal onClose={() => setFilm(false)} />}
    </div>
  );
}

function RewindCard() {
  const h = useMemo(() => demoReplayHandle('orbit', 75), []);
  const ctrl = useMemo(() => {
    const edge = h.series.liveEdge;
    const c = new PlayerController(h.series, true);
    c.set({ following: false, playhead: edge - 15_000, viewport: [edge - 40_000, edge + 4000] });
    return c;
  }, [h]);
  return (
    <article className="card">
      <p className="eyebrow">01 · Rewind</p>
      <h3>Go back 15 seconds while the launch keeps trading.</h3>
      <div className="card-viz">
        <Chart ctrl={ctrl} t0={h.series.start} gaps={[]} isLive usdPerSol={150} supply={h.bundle.launch.supply} compact label="Playhead 15 seconds behind the live edge" />
      </div>
      <p className="muted small">New swaps keep landing at the live edge. The playhead stays where you left it until you press Go Live.</p>
    </article>
  );
}

function InspectCard() {
  const m = useMemo(() => {
    const h = demoReplayHandle('orbit', 100);
    const [a, b] = peakWindow(h.series);
    return computeWindow(makeCtx(h.bundle, h.series), a, b, h.series.range(a, b));
  }, []);
  return (
    <article className="card">
      <p className="eyebrow">02 · Inspect</p>
      <h3>Open the candle. See which swaps built it.</h3>
      <dl className="mini-metrics">
        <div>
          <dt>Swaps</dt>
          <dd className="mono">{m.count}</dd>
        </div>
        <div>
          <dt>Distinct buyers</dt>
          <dd className="mono">{m.distinctBuyers.length}</dd>
        </div>
        <div>
          <dt>Largest buy</dt>
          <dd className="mono">{fmtShare(m.largestBuyShare.value)}</dd>
        </div>
        <div>
          <dt>Top 3 wallets</dt>
          <dd className="mono">{fmtShare(m.top3Share.value)}</dd>
        </div>
      </dl>
      <p className="muted small mono">
        denominator: {fmtSol(m.buySol)} SOL bought in the window · {m.earlySellers.length} early buyers sold into it · {m.clusters.length} shared-funder hint
      </p>
    </article>
  );
}

function CompareCard() {
  const sides = useMemo(() => ['holo', 'stak'].map((k) => {
    const h = demoReplayHandle(k, 300);
    return compareSide(makeCtx(h.bundle, h.series), 30_000);
  }), []);
  return (
    <article className="card">
      <p className="eyebrow">03 · Compare</p>
      <h3>Same peak. Two different buyer structures.</h3>
      <div className="card-viz">
        <CompareView sides={sides} names={['HOLO', 'STAK']} windowMs={30_000} dt={30_000} height={210} />
      </div>
      <p className="small mono">
        <span style={{ color: SERIES_STYLE[0].color }}>A</span> {sides[0].buyersBeforePeak} buyers, top wallet {fmtShare(sides[0].topBuyerShare.value)} · <span style={{ color: SERIES_STYLE[1].color }}>B</span> {sides[1].buyersBeforePeak} buyers, top wallet {fmtShare(sides[1].topBuyerShare.value)}
      </p>
    </article>
  );
}
