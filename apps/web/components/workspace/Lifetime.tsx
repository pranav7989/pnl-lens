/**
 * @file  apps/web/components/workspace/Lifetime.tsx
 * @area  Reports
 * @what  Lifetime view UI: all reports merged (per currency, duplicates once): totals, P&L curve, months, what each report added; then Edge, Rewind and the Journal on every trade.
 */
'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { engine } from '@pnl-lens/engine';
import { mergeReports, lifetimeCurrencies, type LifetimeReport } from '@pnl-lens/shared/insights/lifetime';
import Edge from './Edge';
import Rewind from './Rewind';
import Journal from './Journal';
import { reportName } from './model';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (k: string) => `${MON[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

function Curve({ trades }: { trades: any[] }) {
  const W = 720, H = 200, pad = 10;
  let c = 0; const ys = [0, ...trades.map((t) => (c += t.pnl))];
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const d = ys.map((v, i) => `${i ? 'L' : 'M'}${(pad + (i * (W - 2 * pad)) / Math.max(1, ys.length - 1)).toFixed(1)},${(H - pad - ((v - lo) / span) * (H - 2 * pad)).toFixed(1)}`).join(' ');
  const zero = H - pad - ((0 - lo) / span) * (H - 2 * pad);
  return (
    <svg className="lt-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Lifetime cumulative P&L">
      <line x1={pad} x2={W - pad} y1={zero} y2={zero} className="lt-zero" /><path d={d} className="lt-line" />
    </svg>
  );
}

type RawReport = { id: string; title: string | null; createdAt: string; currency: string; trades: any[]; files?: string[] };

export default function LifetimeView({ reports }: { reports: RawReport[] }) {
  const all: LifetimeReport[] = useMemo(() => reports.map((r) => ({ id: r.id, name: reportName(r), createdAt: r.createdAt, currency: r.currency, trades: r.trades || [] })), [reports]);
  const currencies = useMemo(() => lifetimeCurrencies(all), [all]);
  const [cur, setCur] = useState(currencies[0]?.currency || 'INR');
  const [tab, setTab] = useState<'summary' | 'edge' | 'rewind' | 'journal'>('summary');
  const l = useMemo(() => mergeReports(all, cur), [all, cur]);
  const report = useMemo(() => ({ trades: l.trades, m: { currency: l.currency } }), [l]);
  const money = (v: number) => { engine.setCurrency(l.currency); return engine.inr(v) as string; };
  const max = Math.max(1, ...l.months.map((m) => Math.abs(m.pnl)));
  const undated = l.trades.filter((t) => !(t.exitDate || t.entryDate)).length;
  const filesOf = (id: string) => (reports.find((r) => r.id === id)?.files || []).join(', ');

  return (
    <section className="lt" data-lifetime>
      <div className="report-head">
        <div>
          <h1 className="page-title">All my trading</h1>
          <p className="page-sub">{l.reports.length} reports · {l.n} trades{l.duplicates ? ` (${l.duplicates} repeated in more than one report, counted once)` : ''}{l.from && l.to ? ` · ${dayLabel(l.from)} – ${dayLabel(l.to)}` : ''}</p>
        </div>
        <div className="actions">
          {currencies.length > 1 && (
            <div className="lt-cur" role="group" aria-label="Currency">{currencies.map((c) => (
              <button key={c.currency} type="button" className={`btn ${c.currency === cur ? '' : 'ghost'}`} aria-pressed={c.currency === cur} onClick={() => setCur(c.currency)}>{c.currency}</button>
            ))}</div>
          )}
          <Link className="btn ghost" href="/dashboard">Your reports</Link>
        </div>
      </div>

      <nav className="tabs lt-tabs" role="tablist">
        {([['summary', 'Summary'], ['edge', 'Edge'], ['rewind', 'Rewind'], ['journal', 'Journal']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {tab === 'summary' && (
        <div className="rv-grid" data-lifetime-summary>
          <div className="rv-panel s12 lt-kpis">
            <div><span className="eg-k">Net P&amp;L</span><b className={l.net >= 0 ? 'gain' : 'loss'} data-lifetime-net>{money(l.net)}</b></div>
            <div><span className="eg-k">Trades</span><b>{l.n}</b></div>
            <div><span className="eg-k">Won</span><b>{Math.round(l.winRate * 100)}%</b></div>
            <div><span className="eg-k">Average trade</span><b className={l.avg >= 0 ? 'gain' : 'loss'}>{money(l.avg)}</b></div>
            <div><span className="eg-k">Best month</span><b className="gain">{l.bestMonth ? `${monthLabel(l.bestMonth.key)} · ${money(l.bestMonth.pnl)}` : '—'}</b></div>
            <div><span className="eg-k">Worst month</span><b className="loss">{l.worstMonth ? `${monthLabel(l.worstMonth.key)} · ${money(l.worstMonth.pnl)}` : '—'}</b></div>
          </div>
          {l.trades.length > 2 && (
            <div className="rv-panel s12"><div className="rv-ph"><h3>Lifetime P&amp;L</h3><small>every trade, in date order{undated ? ` · ${undated} without dates at the end` : ''}</small></div><Curve trades={l.trades} /></div>
          )}
          {l.months.length > 0 && (
            <div className="rv-panel s7"><div className="rv-ph"><h3>By month</h3><small>when each trade closed</small></div>
              <ul className="eg-buckets">{l.months.map((m) => (
                <li key={m.key}><span className="k">{monthLabel(m.key)}</span><span className="eg-bt"><i className={m.pnl >= 0 ? 'up' : 'down'} style={{ width: `${(Math.abs(m.pnl) / max) * 100}%` }} /></span>
                  <b className={m.pnl >= 0 ? 'gain' : 'loss'}>{money(m.pnl)}</b><small>{m.n} trade{m.n === 1 ? '' : 's'}</small></li>
              ))}</ul>
              {undated > 0 && <p className="rv-note">{undated} trade{undated === 1 ? '' : 's'} from statements without dates {undated === 1 ? 'is' : 'are'} in the totals but not in a month.</p>}
            </div>
          )}
          <div className="rv-panel s5" data-lifetime-reports><div className="rv-ph"><h3>What each report added</h3><small>new trades only</small></div>
            <ul className="rw-list">{l.reports.map((r) => (
              <li key={r.id}><span><Link href={`/report/${r.id}`}>{r.name}</Link></span><b className={r.net >= 0 ? 'gain' : 'loss'}>{money(r.net)}</b>
                <small>{filesOf(r.id) ? `${filesOf(r.id)} · ` : ''}{r.unique} of {r.trades} trades new{r.unique < r.trades ? ' · the rest were already in an earlier report' : ''}</small></li>
            ))}</ul>
            <p className="rv-note">A trade found in more than one report (the same statement uploaded twice, overlapping periods) is counted once. Statements without dates can make two identical-looking trades look like one.</p>
          </div>
        </div>
      )}
      {tab === 'edge' && <Edge report={report} money={money} active />}
      {tab === 'rewind' && <Rewind key={l.currency} report={report} money={money} />}
      {tab === 'journal' && <Journal key={l.currency} report={report} money={money} active />}
    </section>
  );
}
