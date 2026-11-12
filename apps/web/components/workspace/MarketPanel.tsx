/**
 * @file  apps/web/components/workspace/MarketPanel.tsx
 * @area  Reports
 * @what  "Market context" (Edge tab, India reports only): NIFTY over the report's period vs your return, and your results by India VIX level and by the index's move on the day you entered. Hidden when not available.
 */
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-browser';

interface Bucket { key: string; n: number; pnl: number; winRate: number }
interface Resp { available: boolean; from?: string; to?: string; nifty?: { changePct: number } | null; bankNifty?: { changePct: number } | null; yourPct?: number | null; byVix?: Bucket[] | null; byMove?: Bucket[] | null }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dl = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}`;
const pc = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;

function Rows({ rows, money }: { rows: Bucket[]; money: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));
  return (
    <ul className="eg-buckets">{rows.map((r) => (
      <li key={r.key}><span className="k">{r.key}</span><span className="eg-bt"><i className={r.pnl >= 0 ? 'up' : 'down'} style={{ width: `${(Math.abs(r.pnl) / max) * 100}%` }} /></span>
        <b className={r.pnl >= 0 ? 'gain' : 'loss'}>{money(r.pnl)}</b><small>{r.n} trade{r.n === 1 ? '' : 's'} · {Math.round(r.winRate * 100)}% won</small></li>
    ))}</ul>
  );
}

export default function MarketPanel({ reportId, money }: { reportId: string; money: (v: number) => string }) {
  const [d, setD] = useState<Resp | null>(null);
  useEffect(() => { api<Resp>(`/reports/${reportId}/market`).then(setD).catch(() => setD({ available: false })); }, [reportId]);
  if (!d || !d.available) return null;
  return (
    <div className="rv-panel s12 mk" data-market>
      <div className="rv-ph"><h3>Market context</h3><small>{d.from && d.to ? `${dl(d.from)} – ${dl(d.to)} · ` : ''}NIFTY 50, NIFTY BANK and India VIX daily closes</small></div>
      {d.nifty && (
        <div className="eg-cgrid mk-top">
          <div><span className="eg-k">NIFTY 50 over the period</span><b className={d.nifty.changePct >= 0 ? 'gain' : 'loss'} data-nifty>{pc(d.nifty.changePct)}</b><small>from the close before your first trade to your last trade day</small></div>
          {d.bankNifty && <div><span className="eg-k">NIFTY BANK</span><b className={d.bankNifty.changePct >= 0 ? 'gain' : 'loss'}>{pc(d.bankNifty.changePct)}</b><small>same period</small></div>}
          <div><span className="eg-k">Your return</span><b className={(d.yourPct ?? 0) >= 0 ? 'gain' : 'loss'}>{d.yourPct === null || d.yourPct === undefined ? '—' : pc(d.yourPct)}</b><small>{d.yourPct === null || d.yourPct === undefined ? 'add your capital below to compare' : `${(d.yourPct - d.nifty.changePct) >= 0 ? 'ahead of' : 'behind'} NIFTY by ${Math.abs(d.yourPct - d.nifty.changePct).toFixed(1)} points`}</small></div>
        </div>
      )}
      <div className="mk-cols">
        {d.byVix && d.byVix.length > 0 && <div data-market-vix><h4>By how nervous the market was</h4><Rows rows={d.byVix} money={money} /></div>}
        {d.byMove && d.byMove.length > 0 && <div data-market-move><h4>By the index's move on the day you entered</h4><Rows rows={d.byMove} money={money} /></div>}
      </div>
      <p className="rv-note">India VIX is the market's expected volatility; BANKNIFTY trades are matched to NIFTY BANK, everything else to NIFTY 50. Updated every evening after the close.</p>
    </div>
  );
}
