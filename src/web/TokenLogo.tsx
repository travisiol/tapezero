// The coin's own logo — the image its creator put in the on-chain metadata.
// Reference launch: a local copy. Live launches: resolved by the API from the metadata URI.
// Falls back to the coin's initials when there is no image or it fails to load.
import { useEffect, useState } from 'react';
import { REFERENCE } from '../core/reference.ts';

const cache = new Map<string, Promise<string | null>>();

export function logoFor(mint: string, uri?: string | null): Promise<string | null> {
  if (mint === REFERENCE.mint) return Promise.resolve(REFERENCE.logo);
  if (!uri) return Promise.resolve(null);
  let p = cache.get(mint);
  if (!p) {
    p = fetch(`/api/logo/${mint}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { image?: string | null } | null) => j?.image ?? null)
      .catch(() => null);
    cache.set(mint, p);
  }
  return p;
}

export function TokenLogo({ mint, uri, label, size = 46, className = '' }: { mint: string; uri?: string | null; label: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(mint === REFERENCE.mint ? REFERENCE.logo : null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    logoFor(mint, uri).then((s) => alive && setSrc(s));
    return () => {
      alive = false;
    };
  }, [mint, uri]);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.35) };
  if (src && !failed)
    return <img className={`avatar avatar-img ${className}`} style={style} src={src} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />;
  return (
    <span className={`avatar ${className}`} style={style} aria-hidden="true">
      {(label || '?').slice(0, 2).toUpperCase()}
    </span>
  );
}
