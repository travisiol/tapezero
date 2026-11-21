export const short = (a: string, n = 4) => (a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`);

export function fmtSol(x: number | null | undefined, d?: number): string {
  if (x == null || !isFinite(x)) return '—';
  const ax = Math.abs(x);
  const digits = d ?? (ax >= 100 ? 1 : ax >= 1 ? 2 : ax >= 0.01 ? 3 : 4);
  return `${x.toFixed(digits)}`;
}

export function fmtUsd(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return 'n/a';
  if (x >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `$${(x / 1e3).toFixed(1)}k`;
  return `$${x.toFixed(0)}`;
}

/** Price in SOL per token, compact scientific-ish form (pump prices are ~1e-8). */
export function fmtPrice(p: number | null | undefined): string {
  if (p == null || !isFinite(p) || p <= 0) return '—';
  const e = Math.floor(Math.log10(p));
  if (e >= -3) return p.toFixed(6);
  const m = p / 10 ** e;
  return `${m.toFixed(3)}e${e}`;
}

export function fmtPct(x: number | null | undefined, d = 1): string {
  if (x == null || !isFinite(x)) return '—';
  return `${x >= 0 ? '+' : ''}${x.toFixed(d)}%`;
}

export const fmtShare = (x: number | null | undefined) => (x == null || !isFinite(x) ? '—' : `${(x * 100).toFixed(1)}%`);

/** Chain time (s) → HH:MM:SS UTC. Never prints sub-second precision. */
export function fmtClock(sec: number): string {
  return new Date(Math.floor(sec) * 1000).toISOString().slice(11, 19);
}

export function fmtDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/** Relative duration, e.g. 15 s, 2 m 05 s. `precise` adds one decimal under 60 s (for lag displays). */
export function fmtDur(ms: number, precise = false): string {
  const neg = ms < 0;
  const a = Math.abs(ms) / 1000;
  let s: string;
  if (a < 60) s = precise && a < 10 ? `${a.toFixed(1)} s` : `${Math.round(a)} s`;
  else if (a < 3600) s = `${Math.floor(a / 60)} m ${String(Math.floor(a % 60)).padStart(2, '0')} s`;
  else if (a < 86400) s = `${Math.floor(a / 3600)} h ${String(Math.floor((a % 3600) / 60)).padStart(2, '0')} m`;
  else s = `${Math.floor(a / 86400)} d ${Math.floor((a % 86400) / 3600)} h`;
  return neg ? `-${s}` : s;
}

/** T+ offset label relative to first swap, whole seconds. */
export const fmtTplus = (tlMs: number, t0Ms: number) => {
  const s = Math.floor((tlMs - t0Ms) / 1000);
  return s < 0 ? `T${s}s` : `T+${s}s`;
};
