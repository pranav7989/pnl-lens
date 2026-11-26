/**
 * @file  apps/web/components/workspace/ComparePanel.tsx
 * @area  Reports
 * @what  "How you compare" (Edge tab): where this report sits among traders like the user (same market and main instrument), per metric; shown only from groups of 50+ consenting traders, otherwise how many there are so far.
 */
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-browser';

interface Metric { key: string; label: string; value: number; higherIsBetter: boolean; better: number | null; group: string | null; traders: number | null }
interface Resp { segment: string | null; segmentTraders?: number; allTraders?: number; minTraders: number; enough: boolean; reason?: string; metrics: Metric[] }

const fmt = (k: string, v: number) => (k === 'win_rate' || k === 'deep_loss_share' ? `${Math.round(v * 100)}%`
  : k === 'avg_trade_pct' ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%` : k === 'payoff' ? `${v.toFixed(2)}×` : v.toFixed(2));

export default function ComparePanel({ reportId }: { reportId: string }) {
  const [d, setD] = useState<Resp | null>(null), [err, setErr] = useState(false);
  useEffect(() => { api<Resp>(`/reports/${reportId}/benchmarks`).then(setD).catch(() => setErr(true)); }, [reportId]);
  if (err || !d) return null;
  return (
    <div className="rv-panel s12 cmp" data-compare>
      <div className="rv-ph"><h3>How you compare</h3><small>{d.segment ? `traders in ${d.segment}` : 'traders like you'} · only traders who share their data, never names</small></div>
      {d.reason === 'few_trades' ? <p className="rv-empty">Comparisons need at least 10 closed trades in this report.</p>
        : !d.enough ? (
          <p className="muted cmp-wait" data-compare-wait>Comparisons appear once {d.minTraders} traders in <b>{d.segment}</b> have chosen to share their data
            ({d.segmentTraders ?? 0} so far; {d.allTraders ?? 0} across all markets). You can help by turning on “Make my insights sharper” in Dashboard → Your data.</p>
        ) : (
          <>
            <ul className="cmp-list">{d.metrics.map((m) => (
              <li key={m.key} data-metric={m.key}>
                <div className="cmp-h"><span>{m.label}</span><b>{fmt(m.key, m.value)}</b></div>
                {m.better === null ? <small className="mut">Not enough traders to compare yet.</small> : (
                  <>
                    <div className="cmp-bar" role="img" aria-label={`Better than ${Math.round(m.better * 100)}% of traders`}><i style={{ left: `${m.better * 100}%` }} /></div>
                    <small><b className={m.better >= 0.5 ? 'gain' : 'loss'}>Better than {Math.round(m.better * 100)}%</b> of {m.traders} traders{m.group !== d.segment ? ' across all markets' : ''}{!m.higherIsBetter ? ' (lower is better)' : ''}</small>
                  </>
                )}
              </li>
            ))}</ul>
            <p className="rv-note">Each trader counts once, with their latest report. Groups under {d.minTraders} traders are never shown, so no one can be singled out. Updated nightly.</p>
          </>
        )}
    </div>
  );
}
