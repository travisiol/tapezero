import { useEffect, useRef, useState } from 'react';
import { Link } from '../router.tsx';
import { Wordmark, ZeroMark } from './Brand.tsx';
import { LandingPlayer } from './LandingPlayer.tsx';
import { prefersReducedMotion } from '../util.ts';

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
  const toggleSound = () => {
    const el = v.current!;
    el.muted = !el.muted;
    setMuted(el.muted);
    if (el.paused) el.play().catch(() => {});
  };
  const togglePlay = () => {
    const el = v.current!;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };
  if (failed)
    return (
      <div className="trailer trailer-fallback dots-bg">
        <img src="/brand/logo.png" alt="TAPEZERO" className="trailer-logo" onError={(e) => ((e.currentTarget.style.display = 'none'), e.currentTarget.nextElementSibling?.removeAttribute('hidden'))} />
        <span hidden>
          <ZeroMark size={260} />
        </span>
      </div>
    );
  return (
    <figure className="trailer">
      <video
        ref={v}
        src={TRAILER_SRC}
        poster={TRAILER_POSTER}
        muted
        loop
        playsInline
        autoPlay={!reduced}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(true)}
        aria-label="TAPEZERO trailer, 10 seconds: rewinding the real Dacity Coin swaps"
      />
      <div className="trailer-ctrl">
        <button type="button" className="btn btn-icon btn-glass" onClick={togglePlay} aria-label={playing ? 'Pause trailer' : 'Play trailer'}>
          {playing ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11L13 8z" fill="currentColor" /></svg>
          )}
        </button>
        <button type="button" className="btn btn-s btn-glass" onClick={toggleSound} aria-pressed={!muted}>
          {muted ? 'Sound on' : 'Sound off'}
        </button>
      </div>
    </figure>
  );
}

export function Landing() {
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
          <a href="#player">Replay</a>
          <a href="#data">Data</a>
        </nav>
        <Link to="/app" className="btn btn-primary btn-s">
          Open Terminal
        </Link>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-bg" aria-hidden="true" />
        <div className="hero-copy">
          <h1 id="hero-title">Every launch, frame by frame.</h1>
          <p className="lede">Rewind live Solana launches. Inspect the swaps behind every move.</p>
          <div className="row gap-m wrap">
            <Link to="/app" className="btn btn-primary btn-l">
              Open Terminal
            </Link>
            <a href="#player" className="btn btn-l btn-glass">
              See a real launch
            </a>
          </div>
          <p className="small muted hero-note">pump.fun and PumpSwap · free, no account</p>
        </div>
        <Trailer />
      </section>

      <section id="player" className="section section-player" aria-label="Replay of a real launch">
        <LandingPlayer />
      </section>

      <section id="data" className="section data" aria-labelledby="data-title">
        <h2 id="data-title" className="section-title">What you are looking at.</h2>
        <ul className="facts">
          <li>
            <strong>Every swap is a real transaction.</strong> TAPEZERO reads pump.fun and PumpSwap program events straight from Solana and links each one to Solscan.
          </li>
          <li>
            <strong>Time is chain time.</strong> Swaps are ordered by slot. Solana timestamps have one-second precision, so that is what you see.
          </li>
          <li>
            <strong>Market cap</strong> is price × 1 billion tokens × the SOL/USD price of that minute. Without a dated SOL price, it says “n/a”.
          </li>
          <li>
            <strong>Wallets are addresses.</strong> Nine buyers can be nine people or one person. When two wallets were funded by the same address, it is shown as a hint with its transaction.
          </li>
        </ul>
      </section>

      <section className="section cta dots-bg" aria-label="Open the terminal">
        <h2 className="section-title">Rewind the next launch.</h2>
        <Link to="/app" className="btn btn-primary btn-l">
          Open Terminal
        </Link>
      </section>

      <footer className="foot">
        <Wordmark />
        <span className="muted small">Observable on-chain activity only. Not financial advice.</span>
      </footer>
    </div>
  );
}
