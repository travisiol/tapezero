import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '../router.tsx';
import { emph } from '../player/emph.tsx';
import { Wordmark, ZeroMark } from './Brand.tsx';
import { LandingPlayer, busiestCandle } from './LandingPlayer.tsx';
import { prefersReducedMotion } from '../util.ts';
import { REFERENCE, referenceHandle, type LaunchHandle } from '../data/sources.ts';
import { PlayerController } from '../../core/player.ts';
import { Chart } from '../player/Chart.tsx';
import { computeWindow, usdAt } from '../../core/metrics.ts';
import { makeCtx } from '../../core/context.ts';
import { fmtClock, fmtShare, short } from '../../core/format.ts';
import { SOL_EXPLORER_TX } from '../../core/types.ts';
import { money, summarize } from '../../core/summary.ts';
import { sortTraders, traderBook } from '../../core/traders.ts';
import { WalletDot, traderTags } from '../terminal/TraderViews.tsx';
import { fmtUsd } from '../../core/format.ts';

/** Sections fade and slide in as they enter the screen (instantly under reduced motion). */
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.landing .reveal')];
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting || e.boundingClientRect.top < 0) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  });
}

/** Endless strip of real DacityCoin trades, biggest ones, in chain order. */
function TapeTicker({ h }: { h: LaunchHandle }) {
  const items = useMemo(() => {
    const solUsd = usdAt(h.bundle.usd, h.series.liveEdge)?.solUsd ?? null;
    const sup = h.bundle.launch.supply;
    const big = [...h.series.swaps].sort((a, b) => b.sol - a.sol).slice(0, 36).sort((a, b) => a.tl - b.tl);
    return big.map((t) => ({ id: t.id, t, amt: money(t.sol, solUsd), mc: solUsd ? fmtUsd(t.priceSol * sup * solUsd) : null }));
  }, [h]);
  const row = (k: string) =>
    items.map(({ id, t, amt, mc }) => (
      <li key={k + id} className={`tk tk-${t.side}`}>
        <WalletDot w={t.wallet} />
        <span className="mono tk-w">{short(t.wallet)}</span>
        <b>{t.side === 'buy' ? '▲ bought' : '▽ sold'} {amt}</b>
        {mc && <span className="tk-mc">at {mc} MC</span>}
        <span className="tk-t mono">{fmtClock(t.chainTime)}</span>
      </li>
    ));
  return (
    <div className="ticker" aria-label={`Biggest real ${REFERENCE.name} trades`}>
      <ul className="ticker-track">
        {row('a')}
        {row('b')}
      </ul>
    </div>
  );
}

/** Market cap counting up from the start of the run to its high, once it scrolls into view. */
function CountUp({ h }: { h: LaunchHandle }) {
  const { from, to, secs } = useMemo(() => {
    const solUsd = usdAt(h.bundle.usd, h.series.liveEdge)?.solUsd ?? 0;
    const sup = h.bundle.launch.supply;
    const sw = h.series.swaps;
    let peak = sw[0];
    for (const x of sw) if (x.priceSol > peak.priceSol) peak = x;
    return { from: sw[0].priceSol * sup * solUsd, to: peak.priceSol * sup * solUsd, secs: Math.round((peak.tl - sw[0].tl) / 1000) };
  }, [h]);
  const el = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(from);
  useEffect(() => {
    if (prefersReducedMotion()) return setV(to);
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 2200);
        const ease = 1 - Math.pow(1 - k, 3);
        setV(from + (to - from) * ease);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    if (el.current) io.observe(el.current);
    return () => (io.disconnect(), cancelAnimationFrame(raf));
  }, [from, to]);
  return (
    <span className="countup" ref={el}>
      <span className="cu-from">{fmtUsd(from)}</span>
      <span className="cu-arrow" aria-hidden="true">→</span>
      <span className="cu-to">{fmtUsd(v)}</span>
      <span className="cu-sub">
        {REFERENCE.name} in {Math.floor(secs / 60)} min {String(secs % 60).padStart(2, '0')} s
      </span>
    </span>
  );
}

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
      <video ref={v} src={TRAILER_SRC} poster={TRAILER_POSTER} muted loop playsInline autoPlay={!reduced} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setFailed(true)} aria-label="TAPEZERO in 10 seconds: rewinding real DacityCoin trades" />
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
        {REFERENCE.name} · {fmtClock(m.a / 1000)} → {fmtClock(m.b / 1000)} UTC
      </p>
      <ul className="story">
        {summarize(m, solUsd)
          .slice(0, 4)
          .map((x, i) => (
            <li key={i}>
              <span className="story-line">{emph(x.text)}</span>
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

/** Real trades of the busiest five seconds, each one a Solana transaction. */
function TradesDemo({ h }: { h: LaunchHandle }) {
  const { trades, solUsd } = useMemo(() => {
    const [a, b] = busiestCandle(h.series);
    return { trades: h.series.range(a, b).sort((x, y) => y.sol - x.sol).slice(0, 8), solUsd: usdAt(h.bundle.usd, a)?.solUsd ?? null };
  }, [h]);
  return (
    <ol className="trades-demo" aria-label={`Real ${REFERENCE.name} trades`}>
      {trades.map((t) => (
        <li key={t.id}>
          <span className="mono muted">{fmtClock(t.chainTime)}</span>
          <span className={`side side-${t.side}`}>{t.side === 'buy' ? '▲ Buy' : '▽ Sell'}</span>
          <span className="mono num">{money(t.sol, solUsd)}</span>
          <span className="mono muted">{short(t.wallet)}</span>
          <a className="txlink" href={SOL_EXPLORER_TX(t.signature)} target="_blank" rel="noreferrer noopener">
            Solscan ↗
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Real leaderboard at the end of the replay: who made money on DacityCoin, and how. */
function TradersDemo({ h }: { h: LaunchHandle }) {
  const { rows, book, solUsd } = useMemo(() => {
    const book = traderBook(h.series.swaps, h.series.size, h.bundle.launch.supply);
    return { book, rows: sortTraders(book.traders.filter((t) => t.buys > 0), 'pnl').slice(0, 5), solUsd: usdAt(h.bundle.usd, h.series.liveEdge)?.solUsd ?? null };
  }, [h]);
  const judged = book.inProfit + book.inLoss;
  return (
    <div className="lb-demo">
      <div className="score-row">
        <div className="score">
          <b className="side-buy">{book.inProfit.toLocaleString('en-US')}</b>
          <span>buyers in profit</span>
        </div>
        <div className="score">
          <b className="side-sell">{book.inLoss.toLocaleString('en-US')}</b>
          <span>in loss</span>
        </div>
        <div className="score">
          <b>{judged ? Math.round((book.inProfit / judged) * 100) + '%' : '—'}</b>
          <span>win rate</span>
        </div>
      </div>
      <ol className="lb" aria-label={`Top ${REFERENCE.name} traders`}>
        {rows.map((t, i) => (
          <li key={t.wallet} className="lb-row lb-static">
            <span className="lb-rank top">{['🥇', '🥈', '🥉', '4', '5'][i]}</span>
            <span className="lb-who">
              <span className="lb-w">
                <WalletDot w={t.wallet} />
                <span className="mono">{short(t.wallet)}</span>
              </span>
              <span className="lb-tags">
                {traderTags(t, h.bundle.launch.supply)
                  .slice(0, 2)
                  .map((g) => (
                    <span key={g.k} className={`ttag ttag-${g.k}`} title={g.title}>
                      {g.label}
                    </span>
                  ))}
              </span>
            </span>
            <span className="lb-num">
              <b className="side-buy">+{money(t.pnlSol, solUsd)}</b>
              <span className="lb-sub">
                +{Math.round((t.pnlSol / t.boughtSol) * 100)}% · {money(t.boughtSol, solUsd)} in
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const FAQ: [string, string][] = [
  ['What is TAPEZERO?', 'A player for Solana token launches. You can pause a launch while it is still trading, go back in time, and click any candle to see the trades and wallets that made it.'],
  ['Which coins are covered?', 'Tokens launched on pump.fun, on their bonding curve and after they move to PumpSwap. Other venues are not covered yet.'],
  ['Is it live?', 'The terminal follows new launches live when the collector is running. The example on this page is a replay of real DacityCoin trades from 18 November 2026.'],
  ['What can I see about traders?', 'For any moment of a launch: who is in profit and who is not, the top traders by PnL, how much the 10 biggest buyers hold, and each wallet’s full story (entries, exits, average entry market cap), all marked on the chart. Rewind and every number goes back in time with you.'],
  ['Where does the data come from?', 'Straight from Solana: every trade is read from the transaction itself and links to Solscan so you can check it.'],
  ['Does it tell me what to buy?', 'No. TAPEZERO shows what happened — who bought, how much, when. It never gives buy or sell signals or predictions.'],
  ['Do I need an account?', 'No. The terminal is free and public.'],
];

export function Landing() {
  const ref = useReference();
  useEffect(() => {
    document.title = 'TAPEZERO — Every launch, frame by frame.';
  }, []);
  useReveal();
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
            <span className="rise" style={{ animationDelay: '0.05s' }}>
              Every launch,
            </span>
            <br />
            <span className="rise shine" style={{ animationDelay: '0.2s' }}>
              frame by frame.
            </span>
          </h1>
          <p className="lede rise" style={{ animationDelay: '0.35s' }}>TAPEZERO replays Solana launches trade by trade. Pause, rewind, click a candle and see who bought it.</p>
          <div className="row gap-m wrap rise" style={{ animationDelay: '0.5s' }}>
            <Link to="/app" className="btn btn-primary btn-l btn-pulse">
              Open Terminal
            </Link>
            <a href="#example" className="btn btn-l btn-glass">
              Try a real launch
            </a>
          </div>
        </div>
        <div className="rise rise-r" style={{ animationDelay: '0.25s' }}>
          <Trailer />
        </div>
      </section>

      {ref && <TapeTicker h={ref} />}

      <section className="venues" aria-label="Data sources">
        <span className="muted small">Reads every trade straight from Solana</span>
        <ul>
          <li>pump.fun</li>
          <li>PumpSwap</li>
          <li>Solscan links</li>
          <li>Second-by-second</li>
        </ul>
      </section>

      <section className="statement reveal" aria-label="Why">
        {ref && <CountUp h={ref} />}
        <p>
          A launch moves in seconds.
          <br />
          <span className="muted">Charts show candles. TAPEZERO shows the trades inside them.</span>
        </p>
      </section>

      <div id="how">
        <section className="feature reveal" aria-labelledby="f1">
          <div className="feature-copy">
            <p className="feature-kicker">Rewind</p>
            <h2 id="f1">Go back while it’s still trading.</h2>
            <p>Pause a launch, scrub back 15 seconds, play it at 0.5× or 5×. New trades keep arriving in the background. One click on Go Live brings you back to now.</p>
          </div>
          <div className="feature-ui">{ref ? <RewindDemo h={ref} /> : <div className="feature-loading" />}</div>
        </section>

        <section className="feature feature-flip reveal" aria-labelledby="f2">
          <div className="feature-copy">
            <p className="feature-kicker">Open a candle</p>
            <h2 id="f2">See who made the move.</h2>
            <p>Click any candle and TAPEZERO explains it in plain words: how many wallets bought, how much money went in, and how big the largest buy was. Every trade links to Solscan.</p>
          </div>
          <div className="feature-ui">{ref ? <CandleReading h={ref} /> : <div className="feature-loading" />}</div>
        </section>

        <section className="feature reveal" aria-labelledby="f3">
          <div className="feature-copy">
            <p className="feature-kicker">Check</p>
            <h2 id="f3">Every trade, one click from proof.</h2>
            <p>Each line is a real Solana transaction: time, buy or sell, amount, wallet. Open it on Solscan and check it yourself. These are the biggest trades of DacityCoin’s busiest five seconds.</p>
          </div>
          <div className="feature-ui">
            {ref ? <TradesDemo h={ref} /> : <div className="feature-loading" />}
          </div>
        </section>

        <section className="feature feature-flip reveal" aria-labelledby="f4">
          <div className="feature-copy">
            <p className="feature-kicker">Top traders</p>
            <h2 id="f4">Who’s up. Who’s down. Who’s still holding.</h2>
            <p>At any moment of the replay: the leaderboard by PnL, early buyers, whales, wallets that never sold and those that dumped it all. Click a wallet and all its trades light up on the chart. These are DacityCoin’s best traders over its four-minute run.</p>
          </div>
          <div className="feature-ui">{ref ? <TradersDemo h={ref} /> : <div className="feature-loading" />}</div>
        </section>
      </div>

      <section id="example" className="section section-player" aria-labelledby="ex-title">
        <div className="example-head reveal">
          <p className="feature-kicker">Real example</p>
          <h2 id="ex-title" className="section-title">DacityCoin: $685k to $3.2M in four minutes.</h2>
        </div>
        <LandingPlayer />
      </section>

      <section id="faq" className="section faq reveal" aria-labelledby="faq-title">
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

      <section className="section cta dots-bg reveal" aria-label="Open the terminal">
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
