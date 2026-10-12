/**
 * @file  apps/web/components/workspace/DataRights.tsx
 * @area  Reports
 * @what  "Your data" panel: research opt-in (off by default, change anytime), export my data (ZIP, kept 7 days), delete my account.
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

  const loadExports = () => api<{ exports: ExportRow[] }>('/me/exports').then((r) => setExports(r.exports)).catch(() => {});
  useEffect(() => {
    api<{ research: boolean }>('/me/consents').then((c) => setResearch(c.research)).catch(() => setResearch(false));
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
    <div className="panel" style={{ maxWidth: 620, marginTop: 16 }}>
      <h3>Your data</h3>
      <div className="consent" style={{ marginTop: 6 }}>
        <label><input type="checkbox" name="research" checked={!!research} disabled={research === null} onChange={(e) => toggleResearch(e.target.checked)} /> <span>{CONSENT_RESEARCH}</span></label>
      </div>
      <div className="filters" style={{ marginTop: 16, alignItems: 'center' }}>
        <button className="btn ghost" onClick={requestExport} disabled={!!latest && (latest.status === 'pending' || latest.status === 'processing')}>Export my data</button>
        {latest && (latest.status === 'pending' || latest.status === 'processing') && <span className="muted" style={{ fontSize: 13 }}>Preparing your export…</span>}
        {latest?.downloadable && <a className="btn" href={`/api/v1/me/export/${latest.id}`}>Download export (ZIP)</a>}
        {latest?.status === 'failed' && <span className="muted" style={{ fontSize: 13 }}>The export could not be prepared. Try again.</span>}
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>The export holds your account, reports, trades and the statements still stored. The download link works for 7 days.</p>
      <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        {!confirmDelete
          ? <button className="btn ghost" style={{ color: 'var(--loss)' }} onClick={() => setConfirmDelete(true)}>Delete my account</button>
          : <div>
              <p style={{ margin: '0 0 8px', fontSize: 14 }}>This permanently deletes your reports, trades and statements. Payment records are kept as the law requires. Type <b>DELETE</b> to confirm.</p>
              <div className="filters">
                <input aria-label="Type DELETE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
                <button className="btn" style={{ background: 'var(--loss)', color: '#fff' }} disabled={typed !== 'DELETE'} onClick={deleteAccount}>Delete my account</button>
                <button className="btn ghost" onClick={() => { setConfirmDelete(false); setTyped(''); }}>Cancel</button>
              </div>
            </div>}
      </div>
      {msg && <p className="status err">{msg}</p>}
    </div>
  );
}
