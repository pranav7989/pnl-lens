/**
 * @file  apps/web/components/admin/ResearchAdmin.tsx
 * @area  Admin
 * @what  Admin "Research" tab (owner only): research datasets built on the 1st and 16th from opted-in users, Build now, download; find who a subject or report code belongs to (reason required, audited).
 */
'use client';
import { useEffect, useState } from 'react';
import { api, type ApiError } from '@/lib/api-browser';
import Loading from '@/components/motion/Loading';

interface Row {
  id: string; status: 'pending' | 'building' | 'ready' | 'failed'; subjects: number | null; reports: number | null; trades: number | null;
  size_bytes: number | null; error: string | null; created_at: string; expires_at: string | null; deleted_at: string | null; scheduled: boolean; downloadable: boolean;
}
const IST = { timeZone: 'Asia/Kolkata' } as const;
const when = (d: string) => new Date(d).toLocaleString('en-GB', { ...IST, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' IST';
const day = (d: string) => new Date(d).toLocaleDateString('en-GB', { ...IST, day: 'numeric', month: 'short', year: 'numeric' });
const size = (b: number | null) => (b === null ? '—' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const STATUS: Record<Row['status'], string> = { pending: 'Queued', building: 'Building…', ready: 'Ready', failed: 'Failed' };

/** Next 03:00 IST on the 1st or 16th. */
function nextBuild(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600e3);
  for (let m = 0; m < 3; m++) for (const d of [1, 16]) {
    const t = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + m, d, 3) - 5.5 * 3600e3;
    if (t > now.getTime()) return new Date(t);
  }
  return null;
}

export default function ResearchAdmin() {
  const [rows, setRows] = useState<Row[] | null>(null), [optedIn, setOptedIn] = useState(0), [msg, setMsg] = useState('');
  const load = () => api<{ exports: Row[]; optedIn: number }>('/admin/research/exports').then((j) => { setRows(j.exports); setOptedIn(j.optedIn); }).catch((e) => setMsg((e as ApiError).message));
  useEffect(() => { load(); }, []);
  const running = !!rows?.some((r) => r.status === 'pending' || r.status === 'building');
  useEffect(() => { if (!running) return; const t = setInterval(load, 3000); return () => clearInterval(t); }, [running]);
  const build = async () => { setMsg(''); try { await api('/admin/research/exports', { body: {} }); await load(); } catch (e) { setMsg((e as ApiError).message); } };
  const next = nextBuild();

  return (
    <>
    <div className="rv-panel s12" data-research-admin>
      <div className="rv-ph"><h3>Research datasets</h3><small>owner only · every download is in the audit log</small></div>
      <p className="muted rs-intro">Trades, report statistics and habits of the <b>{optedIn}</b> user{optedIn === 1 ? '' : 's'} who opted in to research, pseudonymised.
        Built automatically on the 1st and 16th of each month at 03:00 IST{next ? ` (next: ${when(next.toISOString())})` : ''}. Each file is kept 90 days.</p>
      <div className="ab-bar"><button className="btn" onClick={build} disabled={running}>{running ? 'Building…' : 'Build now'}</button></div>
      {msg && <p className="status err">{msg}</p>}
      {!rows ? <Loading /> : (
        <div className="rv-tw"><table className="rv-t">
          <thead><tr><th>Built</th><th>Status</th><th className="n">Traders</th><th className="n">Reports</th><th className="n">Trades</th><th className="n">Size</th><th>Available until</th><th /></tr></thead>
          <tbody>{rows.length ? rows.map((r) => (
            <tr key={r.id}>
              <td>{when(r.created_at)}<br /><small className="mut">{r.scheduled ? 'scheduled' : 'built on request'}</small></td>
              <td><span className={`ab-st ${r.status === 'ready' ? 'published' : r.status === 'failed' ? 'archived' : 'scheduled'}`}>{STATUS[r.status]}</span>{r.error && <><br /><small className="mut">{r.error}</small></>}</td>
              <td className="n">{r.subjects ?? '—'}</td><td className="n">{r.reports ?? '—'}</td><td className="n">{r.trades ?? '—'}</td><td className="n">{size(r.size_bytes)}</td>
              <td>{r.deleted_at ? <span className="mut">deleted</span> : r.expires_at ? day(r.expires_at) : '—'}</td>
              <td>{r.downloadable && <a className="btn ghost" href={`/api/v1/admin/research/exports/${r.id}/download`} download>Download</a>}</td>
            </tr>
          )) : <tr><td colSpan={8} className="mut">No datasets yet. The first one is built on the next scheduled date, or click “Build now”.</td></tr>}</tbody>
        </table></div>
      )}
      <p className="rv-note">Inside each ZIP: subjects.csv, reports.csv, trades.csv, habits.csv and a README describing the columns. No emails, names, file names
        or internal ids; a trader is a stable pseudonym, a report a pseudonym valid in that file only. Only users whose research consent is on at build time are
        included. Use it only to improve PnL Lens’s analysis: do not try to re-identify anyone and do not share it outside PnL Lens.</p>
    </div>
    <Lookup datasets={(rows || []).filter((r) => r.status === 'ready' && (r.reports ?? 0) > 0)} />
    </>
  );
}

interface Found { kind: 'subject' | 'report'; user: { id: string; email: string; status: string }; report: { id: string; name: string | null; createdAt: string; deleted: boolean } | null }

/** Subject (64 hex) or report (24 hex, from one dataset) code → the account; the database checks the owner role and audits it. */
function Lookup({ datasets }: { datasets: Row[] }) {
  const [code, setCode] = useState(''), [exportId, setExportId] = useState(''), [reason, setReason] = useState('');
  const [found, setFound] = useState<Found | null>(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const clean = code.trim().toLowerCase();
  const isReport = /^[0-9a-f]{24}$/.test(clean);
  async function look(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(''); setFound(null);
    try { setFound(await api<Found>('/admin/research/lookup', { body: { code: clean, exportId: isReport ? exportId || null : null, reason } })); }
    catch (x) { setErr((x as ApiError).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="rv-panel s12" data-research-lookup>
      <div className="rv-ph"><h3>Find who a row belongs to</h3><small>owner only · every lookup is recorded with your reason</small></div>
      <p className="muted rs-intro">The downloaded files are pseudonymised, but PnL Lens keeps the link. Paste a <b>subject</b> (64 characters, any dataset) or
        a <b>report</b> code (24 characters) and choose the dataset it came from.</p>
      <form className="rs-lookup" onSubmit={look}>
        <input aria-label="Subject or report code" placeholder="Subject or report code" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
        {isReport && (
          <select aria-label="Dataset" value={exportId} onChange={(e) => setExportId(e.target.value)} required>
            <option value="">Dataset…</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{when(d.created_at)} · {d.reports} reports</option>)}
          </select>
        )}
        <input aria-label="Reason" placeholder="Reason (e.g. consent withdrawal, data request)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn" disabled={busy || !clean || reason.trim().length < 3}>{busy ? 'Looking up…' : 'Look up'}</button>
      </form>
      {err && <p className="status err">{err}</p>}
      {found && (
        <div className="rs-found" data-lookup-result>
          <div><span className="mut">Account</span> <b>{found.user.email}</b>{found.user.status !== 'active' && <span className="mut"> · {found.user.status}</span>}</div>
          {found.report && <div><span className="mut">Report</span> <b>{found.report.name || 'Untitled'}</b> · {day(found.report.createdAt)}{found.report.deleted && <span className="mut"> · deleted</span>}</div>}
        </div>
      )}
    </div>
  );
}
