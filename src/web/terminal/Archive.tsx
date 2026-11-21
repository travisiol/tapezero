import { useEffect, useMemo, useState } from 'react';
import type { DataMode } from '../../core/types.ts';
import { FDV_WINDOWS } from '../../core/metrics.ts';
import { listLaunches, type LaunchList } from '../data/sources.ts';
import { Link } from '../router.tsx';
import { fmtDate, fmtDur, fmtShare, fmtUsd, short } from '../../core/format.ts';

interface F {
  maxAgeH: number;
  maxTtp: number | null;
  minPeakUsd: number;
  fdvX: number;
  fdvN: number;
  useFdvWithin: boolean;
  minBuyers: number;
  maxConc: number; // %
  includeNoUsd: boolean;
}

const DEFAULT: F = { maxAgeH: 48, maxTtp: null, minPeakUsd: 0, fdvX: 20000, fdvN: 30, useFdvWithin: false, minBuyers: 0, maxConc: 100, includeNoUsd: true };

type SortKey = 'first' | 'ttp' | 'peak' | 'buyers' | 'conc' | 'swaps';

export function Archive({ mode }: { mode: DataMode }) {
  const [list, setList] = useState<LaunchList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<F>(DEFAULT);
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'first', desc: true });
  useEffect(() => {
    let alive = true;
    const load = () => listLaunches(mode).then((l) => alive && setList(l)).catch((e) => alive && setErr(String(e.message ?? e)));
    load();
    const i = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [mode]);
  const refNow = useMemo(() => (mode === 'demo' && list ? Math.max(...list.rows.map((r) => r.stats.lastSwapAt ?? 0)) : Date.now() / 1000), [list, mode]);
  const rows = useMemo(() => {
    if (!list) return [];
    const r = list.rows.filter(({ stats: s }) => {
      if (s.firstSwapAt != null && refNow - s.firstSwapAt > f.maxAgeH * 3600) return false;
      if (f.maxTtp != null && (s.timeToPeak == null || s.timeToPeak > f.maxTtp)) return false;
      if (s.usdMissing) return f.includeNoUsd;
      if (f.minPeakUsd > 0 && (s.fdvPeakUsd ?? 0) < f.minPeakUsd) return false;
      if (f.useFdvWithin && (s.maxFdvWithin[String(f.fdvN)] ?? 0) < f.fdvX) return false;
      if (s.buyersBeforePeak < f.minBuyers) return false;
      if (s.topBuyerShareBeforePeak != null && s.topBuyerShareBeforePeak * 100 > f.maxConc) return false;
      return true;
    });
    const key = (x: (typeof r)[number]) => {
      const s = x.stats;
      return sort.k === 'first' ? s.firstSwapAt ?? 0 : sort.k === 'ttp' ? s.timeToPeak ?? 1e12 : sort.k === 'peak' ? s.fdvPeakUsd ?? -1 : sort.k === 'buyers' ? s.buyersBeforePeak : sort.k === 'conc' ? s.topBuyerShareBeforePeak ?? -1 : s.swaps;
    };
    return r.sort((a, b) => (key(a) - key(b)) * (sort.desc ? -1 : 1));
  }, [list, f, sort, refNow]);
  const cov = list?.coverage;
  const coveredH = cov?.collectorStartedAt ? (Date.now() - cov.collectorStartedAt) / 3600_000 : null;
  const th = (k: SortKey, label: string, title?: string) => (
    <th scope="col" aria-sort={sort.k === k ? (sort.desc ? 'descending' : 'ascending') : 'none'} title={title}>
      <button type="button" className="thbtn" onClick={() => setSort((s) => ({ k, desc: s.k === k ? !s.desc : true }))}>
        {label} {sort.k === k ? (sort.desc ? '↓' : '↑') : ''}
      </button>
    </th>
  );
  const num = (v: number, set: (n: number) => void, step = 1, min = 0) => <input type="number" step={step} min={min} value={v} onChange={(e) => set(Number(e.target.value) || 0)} />;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Archive</p>
          <h1>Every observed launch, kept 48 hours</h1>
          <p className="muted">Launches stay listed after they fade. Current price or an active pool is never a condition.</p>
        </div>
        <div className="coverage">
          {mode === 'demo' ? (
            <>
              <span className="badge badge-demo">Demo data</span>
              <p className="small muted">{cov?.note}</p>
            </>
          ) : cov ? (
            <>
              <p className="small">
                <strong>Coverage:</strong> {cov.collectorStartedAt ? `since ${fmtDate(cov.collectorStartedAt)}` : 'collector not started'}
                {coveredH != null && coveredH < 48 ? ` — ${fmtDur(Date.now() - cov.collectorStartedAt!)} so far, not yet 48 h` : ' — rolling 48 h'}
              </p>
              <p className="small muted">{cov.venues.map((v) => `${v.venue}: ${v.status}`).join(' · ')} · commitment {cov.commitment}</p>
              <p className="small muted">{cov.note}</p>
            </>
          ) : (
            <p className="small muted">{err ? `API unreachable: ${err}` : 'Loading…'}</p>
          )}
        </div>
      </div>
      <form className="archive-filters" onSubmit={(e) => e.preventDefault()} aria-label="Archive filters">
        <label>Age at first swap ≤ (h){num(f.maxAgeH, (n) => setF({ ...f, maxAgeH: n }), 1, 0)}</label>
        <label>
          Time to peak ≤ (s)
          <input type="number" min={0} placeholder="any" value={f.maxTtp ?? ''} onChange={(e) => setF({ ...f, maxTtp: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <label>Peak FDV ≥ ($){num(f.minPeakUsd, (n) => setF({ ...f, minPeakUsd: n }), 1000)}</label>
        <label className="combo">
          <span>
            <input type="checkbox" checked={f.useFdvWithin} onChange={(e) => setF({ ...f, useFdvWithin: e.target.checked })} /> FDV ≥ ($)
          </span>
          {num(f.fdvX, (n) => setF({ ...f, fdvX: n }), 1000)}
          <span>within</span>
          <select value={f.fdvN} onChange={(e) => setF({ ...f, fdvN: Number(e.target.value) })}>
            {FDV_WINDOWS.map((n) => (
              <option key={n} value={n}>
                {n} s
              </option>
            ))}
          </select>
        </label>
        <label>Buyers before peak ≥{num(f.minBuyers, (n) => setF({ ...f, minBuyers: n }))}</label>
        <label>Top buyer share ≤ (%){num(f.maxConc, (n) => setF({ ...f, maxConc: n }))}</label>
        <label className="check">
          <input type="checkbox" checked={f.includeNoUsd} onChange={(e) => setF({ ...f, includeNoUsd: e.target.checked })} /> Keep launches without valuation
        </label>
        <div className="row gap-s">
          <button type="button" className="btn btn-s" onClick={() => setF({ ...DEFAULT, useFdvWithin: true, fdvX: 20000, fdvN: 30 })}>
            $20k within 30 s
          </button>
          <button type="button" className="btn btn-ghost btn-s" onClick={() => setF(DEFAULT)}>
            Reset
          </button>
        </div>
      </form>
      <p className="small muted">
        {rows.length} of {list?.rows.length ?? 0} launches · concentration = top wallet buy volume ÷ all buy volume up to the peak · FDV uses a dated SOL/USD reference, otherwise “n/a”.
      </p>
      <div className="table-wrap">
        <table className="archive">
          <thead>
            <tr>
              <th scope="col">Launch</th>
              {th('first', 'First swap')}
              {th('ttp', 'Time to peak')}
              {th('peak', 'Peak FDV')}
              <th scope="col">Max FDV ≤ {f.fdvN}s</th>
              {th('buyers', 'Buyers pre-peak')}
              {th('conc', 'Top buyer', 'Top wallet buy volume ÷ all buy volume up to the peak')}
              {th('swaps', 'Swaps')}
              <th scope="col">From peak</th>
              <th scope="col">Data</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ launch: l, stats: s }) => (
              <tr key={l.mint}>
                <td>
                  <Link to={`/app/${mode}/token/${l.mint}`} className="strong">
                    {l.symbol}
                  </Link>{' '}
                  <span className="muted small">{l.name}</span>
                  <div className="mono small muted">{short(l.mint, 5)}</div>
                </td>
                <td className="mono">{s.firstSwapAt ? `${fmtDur((refNow - s.firstSwapAt) * 1000)} ago` : '—'}</td>
                <td className="mono">{s.timeToPeak != null ? fmtDur(s.timeToPeak * 1000) : '—'}</td>
                <td className="mono" title={s.fdvPeakMethod}>
                  {fmtUsd(s.fdvPeakUsd)}
                </td>
                <td className="mono">{fmtUsd(s.maxFdvWithin[String(f.fdvN)])}</td>
                <td className="mono">{s.buyersBeforePeak}</td>
                <td className="mono">{fmtShare(s.topBuyerShareBeforePeak)}</td>
                <td className="mono">{s.swaps}</td>
                <td className="mono">{s.drawdownFromPeak != null ? `−${(s.drawdownFromPeak * 100).toFixed(0)}%` : '—'}</td>
                <td className="small">
                  {s.historyTruncated ? <span className="tag">first swap not captured</span> : <span className="muted">from creation</span>}
                  {s.gaps > 0 && <span className="tag">{s.gaps} gap</span>}
                </td>
                <td className="row gap-s nowrap">
                  <Link className="btn btn-ghost btn-s" to={`/app/${mode}/token/${l.mint}`}>
                    Replay
                  </Link>
                  <Link className="btn btn-ghost btn-s" to={`/app/${mode}/compare?a=${l.mint}`}>
                    Compare
                  </Link>
                  <Link className="btn btn-ghost btn-s" to={`/app/${mode}/blind/${l.mint}`}>
                    Blind
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list && rows.length === 0 && <p className="muted pad">No launch matches these thresholds.</p>}
      </div>
    </div>
  );
}
