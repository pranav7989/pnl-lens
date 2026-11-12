/**
 * @file  apps/web/components/admin/UserAdmin.tsx
 * @area  Admin
 * @what  Admin "User management" tab: search and filter users, see whose reports are in the research dataset, Request reports (owner), Restrict / Unrestrict (owner, admin), Delete (owner).
 */
'use client';
import { useEffect, useState } from 'react';
import { api, type ApiError } from '@/lib/api-browser';
import Loading from '@/components/motion/Loading';

type Filter = 'all' | 'included' | 'not_included' | 'restricted';
interface U {
  id: string; email: string; role: string; status: 'active' | 'blocked'; country: string | null; created_at: string; last_login_at: string | null;
  restricted_reason: string | null; signIn: string; plan: string | null; reports: number;
  research: 'included' | 'opted_in' | 'declined' | 'asked' | 'not_asked'; invited_at: string | null; canRequest: boolean; requestBlocked: string | null;
}
interface List { users: U[]; total: number; included: number; restricted: number; page: number; pages: number; can: { restrict: boolean; delete: boolean; invite: boolean } }

const RESEARCH: Record<U['research'], [string, string]> = {
  included: ['Included', 'published'], opted_in: ['Opted in · no reports yet', 'scheduled'], declined: ['Declined', 'archived'],
  asked: ['Asked', 'scheduled'], not_asked: ['Not included', ''],
};
const SIGN_IN: Record<string, string> = { password: 'Password', google: 'Google', 'google+password': 'Google + password', code: 'Code only' };
const day = (d: string) => new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
const msgOf = (e: unknown) => (e as ApiError)?.message || 'Something went wrong. Please try again.';

export default function UserAdmin() {
  const [q, setQ] = useState(''), [filter, setFilter] = useState<Filter>('all'), [page, setPage] = useState(1);
  const [d, setD] = useState<List | null>(null), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [del, setDel] = useState<U | null>(null);

  const load = (p = page) => api<List>(`/admin/users?${new URLSearchParams({ q, filter, page: String(p) })}`).then(setD).catch((e) => setMsg({ ok: false, text: msgOf(e) }));
  useEffect(() => { const t = setTimeout(() => { setPage(1); load(1); }, 250); return () => clearTimeout(t); }, [q, filter]); // eslint-disable-line
  const act = async (fn: () => Promise<unknown>, text: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text }); await load(); } catch (e) { setMsg({ ok: false, text: msgOf(e) }); }
  };
  const request = (u: U) => act(() => api(`/admin/users/${u.id}/research-invite`, { body: {} }), `Request sent to ${u.email}.`);
  const restrict = (u: U) => {
    const reason = prompt(`Restrict ${u.email}? They are signed out and can't sign in until you lift it.\n\nReason (kept in the audit log):`);
    if (reason === null) return;
    act(() => api(`/admin/users/${u.id}/restrict`, { body: { reason } }), `${u.email} is restricted.`);
  };
  const unrestrict = (u: U) => act(() => api(`/admin/users/${u.id}/unrestrict`, { body: {} }), `${u.email} can sign in again.`);

  return (
    <div className="rv-panel s12" data-user-admin>
      <div className="rv-ph"><h3>User management</h3><small>{d ? `${d.total} user${d.total === 1 ? '' : 's'} · ${d.included} included in research · ${d.restricted} restricted` : ''}</small></div>
      <div className="ab-bar">
        <input className="field um-search" type="search" placeholder="Search by email" aria-label="Search by email" value={q} onChange={(e) => setQ(e.target.value)} />
        <nav className="um-chips" aria-label="Filter">
          {([['all', 'All'], ['included', 'Included'], ['not_included', 'Not included'], ['restricted', 'Restricted']] as [Filter, string][]).map(([k, label]) => (
            <button key={k} className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </nav>
      </div>
      {msg && <p className={`status ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.text}</p>}
      {!d ? <Loading /> : (
        <div className="rv-tw"><table className="rv-t um-table">
          <thead><tr><th>User</th><th>Sign-in</th><th>Plan</th><th className="n">Reports</th><th>Research</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{d.users.length ? d.users.map((u) => (
            <tr key={u.id} data-user={u.email}>
              <td><b>{u.email}</b>{u.role !== 'user' && <span className="ab-st um-role">{u.role}</span>}<br />
                <small className="mut">joined {day(u.created_at)} · {u.last_login_at ? `last sign-in ${day(u.last_login_at)}` : 'never signed in'}{u.country ? ` · ${u.country}` : ''}</small></td>
              <td>{SIGN_IN[u.signIn] ?? u.signIn}</td>
              <td>{u.plan ?? <span className="mut">—</span>}</td>
              <td className="n">{u.reports}</td>
              <td><span className={`ab-st ${RESEARCH[u.research][1]}`}>{RESEARCH[u.research][0]}</span>
                {u.research === 'asked' && u.invited_at && <><br /><small className="mut">asked {day(u.invited_at)}</small></>}</td>
              <td>{u.status === 'blocked' ? <><span className="ab-st archived">Restricted</span>{u.restricted_reason && <><br /><small className="mut">{u.restricted_reason}</small></>}</> : <span className="mut">Active</span>}</td>
              <td className="um-actions">
                {d.can.invite && (u.canRequest
                  ? <button className="btn ghost" onClick={() => request(u)}>Request reports</button>
                  : <button className="btn ghost" disabled title={u.requestBlocked ?? ''}>Request reports</button>)}
                {d.can.restrict && u.role !== 'owner' && (u.status === 'blocked'
                  ? <button className="btn ghost" onClick={() => unrestrict(u)}>Unrestrict</button>
                  : <button className="btn ghost" onClick={() => restrict(u)}>Restrict</button>)}
                {d.can.delete && u.role !== 'owner' && <button className="btn ghost btn-danger-quiet" onClick={() => setDel(u)}>Delete</button>}
              </td>
            </tr>
          )) : <tr><td colSpan={7} className="mut">No users match.</td></tr>}</tbody>
        </table></div>
      )}
      {d && d.pages > 1 && (
        <div className="bl-pages">
          {page > 1 ? <button className="btn ghost" onClick={() => { setPage(page - 1); load(page - 1); }}>← Previous</button> : <span />}
          <span>Page {d.page} of {d.pages}</span>
          {page < d.pages ? <button className="btn ghost" onClick={() => { setPage(page + 1); load(page + 1); }}>Next →</button> : <span />}
        </div>
      )}
      <p className="rv-note">“Request reports” emails the user once, asking whether their past reports may be included (name and email removed) to improve PnL Lens.
        They answer with one click from the email; nothing changes if they ignore it. A user can be asked again after 90 days, or 6 months after saying no.</p>
      {del && <DeleteDialog u={del} onClose={() => setDel(null)} onDone={(text) => { setDel(null); setMsg({ ok: true, text }); load(); }} />}
    </div>
  );
}

function DeleteDialog({ u, onClose, onDone }: { u: U; onClose: () => void; onDone: (text: string) => void }) {
  const [typed, setTyped] = useState(''), [reason, setReason] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr('');
    try { await api(`/admin/users/${u.id}/delete`, { body: { reason, confirmEmail: typed } }); onDone(`${u.email} was deleted.`); }
    catch (e) { setErr(msgOf(e)); setBusy(false); }
  };
  return (
    <div className="um-modal sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="um-del-title">
      <div className="um-modal-card sheet">
        <h3 id="um-del-title">Delete {u.email}?</h3>
        <p className="dr-warn">This permanently deletes their reports, trades and statements and anonymises the account. Payment records are kept as the law requires. It can’t be undone.</p>
        <label className="field-label">Reason (kept in the audit log)<input className="field" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
        <label className="field-label">Type the email to confirm<input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={u.email} aria-label="Type the email to confirm" /></label>
        {err && <p className="status err">{err}</p>}
        <div className="filters">
          <button className="btn btn-danger" disabled={busy || typed.trim().toLowerCase() !== u.email.toLowerCase() || reason.trim().length < 3} onClick={go}>Delete user</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
