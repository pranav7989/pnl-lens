/**
 * @file  apps/web/components/workspace/DataRights.tsx
 * @area  Reports
 * @what  "Your data" panel: password (set or change), research opt-in (off by default, change anytime), export my data (ZIP, kept 7 days), delete my account.
 */
'use client';
import { useEffect, useState } from 'react';
import { api, type ApiError } from '@/lib/api-browser';
import { CONSENT_RESEARCH } from './model';

interface ExportRow { id: string; status: string; requestedAt: string; expiresAt: string | null; downloadable: boolean; sizeBytes: number | null }

export default function DataRights() {
  const [research, setResearch] = useState<boolean | null>(null);
  const [exports, setExports] = useState<ExportRow[]>([]);
  const [msg, setMsg] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);

  const loadExports = () => api<{ exports: ExportRow[] }>('/me/exports').then((r) => setExports(r.exports)).catch(() => {});
  useEffect(() => {
    api<{ research: boolean }>('/me/consents').then((c) => setResearch(c.research)).catch(() => setResearch(false));
    api<{ hasPassword?: boolean }>('/me').then((m) => setHasPassword(!!m.hasPassword)).catch(() => {});
    loadExports();
  }, []);
  // refresh while an export is being prepared
  useEffect(() => {
    if (!exports.some((e) => e.status === 'pending' || e.status === 'processing')) return;
    const t = setInterval(loadExports, 3000);
    return () => clearInterval(t);
  }, [exports]);

  async function toggleResearch(v: boolean) {
    setResearch(v);
    try { const r = await api<{ research: boolean }>('/me/consents', { body: { purpose: 'research', granted: v } }); setResearch(r.research); }
    catch (e) { setMsg((e as ApiError).message); setResearch(!v); }
  }
  async function requestExport() {
    setMsg('');
    try { await api('/me/export', { method: 'POST' }); await loadExports(); }
    catch (e) { setMsg((e as ApiError).message); }
  }
  async function deleteAccount() {
    try { await api('/me/delete', { body: { confirm: true } }); location.href = '/'; }
    catch (e) { setMsg((e as ApiError).message); }
  }
  const latest = exports[0];

  return (
    <div className="panel data-rights">
      <h3>Your data</h3>
      {hasPassword !== null && (
        <div className="filters dr-actions dr-password">
          {hasPassword
            ? <><a className="btn ghost" href="/login?step=forgot&next=/dashboard">Change password</a><span className="muted small">We’ll email you a code to confirm it’s you.</span></>
            : <><a className="btn ghost" href="/login?step=set&next=/dashboard">Set a password</a><span className="muted small">Sign in with your email and a password, as well as Google.</span></>}
        </div>
      )}
      <div className="consent dr-consent">
        <label><input type="checkbox" name="research" checked={!!research} disabled={research === null} onChange={(e) => toggleResearch(e.target.checked)} /> <span>{CONSENT_RESEARCH}</span></label>
      </div>
      <div className="filters dr-actions">
        <button className="btn ghost" onClick={requestExport} disabled={!!latest && (latest.status === 'pending' || latest.status === 'processing')}>Export my data</button>
        {latest && (latest.status === 'pending' || latest.status === 'processing') && <span className="muted small">Preparing your export…</span>}
        {latest?.downloadable && <a className="btn" href={`/api/v1/me/export/${latest.id}`}>Download export (ZIP)</a>}
        {latest?.status === 'failed' && <span className="muted small">The export could not be prepared. Try again.</span>}
      </div>
      <p className="muted small dr-note">The export holds your account, reports, trades and the statements still stored. The download link works for 7 days.</p>
      <div className="dr-danger">
        {!confirmDelete
          ? <button className="btn ghost btn-danger-quiet" onClick={() => setConfirmDelete(true)}>Delete my account</button>
          : <div>
              <p className="dr-warn">This permanently deletes your reports, trades and statements. Payment records are kept as the law requires. Type <b>DELETE</b> to confirm.</p>
              <div className="filters">
                <input aria-label="Type DELETE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
                <button className="btn btn-danger" disabled={typed !== 'DELETE'} onClick={deleteAccount}>Delete my account</button>
                <button className="btn ghost" onClick={() => { setConfirmDelete(false); setTyped(''); }}>Cancel</button>
              </div>
            </div>}
      </div>
      {msg && <p className="status err">{msg}</p>}
    </div>
  );
}
