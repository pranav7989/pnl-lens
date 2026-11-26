/**
 * @file  apps/web/components/workspace/CapitalPanel.tsx
 * @area  Reports
 * @what  Optional "capital used" for a report (Edge tab): add, change or remove it; shows return, a year at this pace, average and largest loss, worst day, drawdown and the 1% / 2% loss counts as % of that capital.
 */
'use client';
import { useMemo, useState } from 'react';
import { capitalStats } from '@pnl-lens/shared/insights/capital';
import { api, type ApiError } from '@/lib/api-browser';

const p = (v: number | null, d = 1) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
const share = (v: number) => `${Math.round(v * 100)}%`;

export default function CapitalPanel({ reportId, initial, trades, money }: { reportId: string; initial: number | null; trades: any[]; money: (v: number) => string }) {
  const [capital, setCapital] = useState<number | null>(initial);
  const [editing, setEditing] = useState(false), [text, setText] = useState(initial ? String(initial) : ''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const c = useMemo(() => capitalStats(trades, capital), [trades, capital]);
  async function save(v: number | null) {
    setBusy(true); setErr('');
    try { await api(`/reports/${reportId}/capital`, { method: 'PUT', body: { capital: v } }); setCapital(v); setEditing(false); }
    catch (e) { setErr((e as ApiError).message || 'Could not save.'); } finally { setBusy(false); }
  }
  const parsed = Number(text.replace(/[,\s₹$€£]/g, ''));
  const form = (
    <form className="cp-form" onSubmit={(e) => { e.preventDefault(); if (parsed > 0) save(parsed); }}>
      <input inputMode="decimal" aria-label="Capital used" placeholder="e.g. 500000" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" disabled={busy || !(parsed > 0)}>{busy ? 'Saving…' : 'Save'}</button>
      {capital !== null && <button type="button" className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>}
    </form>
  );
  return (
    <div className="rv-panel s12 cp" data-capital>
      <div className="rv-ph"><h3>Your results as % of capital</h3><small>optional · only you see it</small></div>
      {capital === null || editing ? (
        <>
          {capital === null && <p className="muted cp-intro">Add the capital you traded with in this report to see your return and your risk as a % of it: how big your losses were for your account, not just in money.</p>}
          {form}
        </>
      ) : c && (
        <>
          <div className="cp-cap">Capital <b data-capital-value>{money(capital)}</b>
            <button type="button" className="btn ghost" onClick={() => { setText(String(capital)); setEditing(true); }}>Change</button>
            <button type="button" className="btn ghost btn-danger-quiet" disabled={busy} onClick={() => save(null)}>Remove</button></div>
          <div className="eg-cgrid">
            <div><span className="eg-k">Return</span><b className={c.returnPct >= 0 ? 'gain' : 'loss'} data-return>{p(c.returnPct)}</b><small>{c.yearPct !== null ? `${p(c.yearPct, 0)} a year at this pace (${c.spanDays} days, not compounded)` : 'on the trades in this report'}</small></div>
            <div><span className="eg-k">Average trade</span><b className={c.avgTradePct >= 0 ? 'gain' : 'loss'}>{p(c.avgTradePct, 2)}</b><small>average loss {p(c.avgLossPct, 2)}</small></div>
            <div><span className="eg-k">Largest single loss</span><b className="loss">{p(c.largestLossPct, 2)}</b><small>a common rule keeps this under 1–2%</small></div>
            <div><span className="eg-k">Worst day</span><b className="loss">{p(c.worstDayPct, 2)}</b><small>of capital in one day</small></div>
            <div><span className="eg-k">Worst drawdown</span><b className="loss">{p(c.maxDDPct)}</b><small>from a high to the low that followed</small></div>
            <div><span className="eg-k">Trades that lost over 1%</span><b className={c.over1 > 0 ? 'loss' : 'gain'}>{share(c.over1)}</b><small>over 2%: {share(c.over2)} of all trades</small></div>
          </div>
        </>
      )}
      {err && <p className="status err">{err}</p>}
    </div>
  );
}
