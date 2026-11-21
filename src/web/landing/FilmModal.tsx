import { useEffect, useRef, useState } from 'react';

export const FILM_SRC = '/film/tapezero-film.mp4';
export const FILM_POSTER = '/film/poster.jpg';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Full-screen film player. The video is only requested when the dialog opens. */
export function FilmModal({ onClose }: { onClose: () => void }) {
  const v = useRef<HTMLVideoElement>(null);
  const dlg = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(35);
  const [vol, setVol] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    document.body.style.overflow = 'hidden';
    const el = v.current!;
    el.volume = vol;
    // opened by a click: sound is allowed; if the browser still refuses, fall back to muted playback
    el.play().catch(() => {
      el.muted = true;
      setMuted(true);
      el.play().catch(() => {});
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Tab') {
        // focus trap
        const f = dlg.current!.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])');
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      el.pause();
      prev?.focus();
    };
  }, []);

  const toggle = () => {
    const el = v.current!;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };
  return (
    <div className="film-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="film-dialog" role="dialog" aria-modal="true" aria-label="TAPEZERO launch film" ref={dlg}>
        <video
          ref={v}
          src={FILM_SRC}
          poster={FILM_POSTER}
          preload="auto"
          playsInline
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 35)}
          onError={() => setErr('The film could not be loaded. Run `npm run film:render` to produce public/film/tapezero-film.mp4.')}
        />
        {err && <p className="notice film-err">{err}</p>}
        <div className="film-controls">
          <button type="button" className="btn btn-icon btn-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? (
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11L13 8z" fill="currentColor" /></svg>
            )}
          </button>
          <input
            type="range"
            className="grow"
            min={0}
            max={dur}
            step={0.1}
            value={t}
            aria-label="Seek"
            onChange={(e) => {
              v.current!.currentTime = Number(e.target.value);
            }}
          />
          <span className="mono small">
            {fmt(t)} / {fmt(dur)}
          </span>
          <button
            type="button"
            className="btn btn-icon"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={() => {
              const el = v.current!;
              el.muted = !el.muted;
              setMuted(el.muted);
            }}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : vol}
            aria-label="Volume"
            className="vol"
            onChange={(e) => {
              const el = v.current!;
              el.volume = Number(e.target.value);
              el.muted = el.volume === 0;
              setVol(el.volume);
              setMuted(el.muted);
            }}
          />
          <button ref={closeBtn} type="button" className="btn btn-s" onClick={onClose} aria-label="Close film (Esc)">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
