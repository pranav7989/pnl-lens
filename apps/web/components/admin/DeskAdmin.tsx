/**
 * @file  apps/web/components/admin/DeskAdmin.tsx
 * @area  Admin
 * @what  Admin "Desk" tab (owner/admin): feed status (headlines, events, generated rows, expiry copy, calendar check) with Run now, add an event by hand, hide or show events for the next 14 days; every change is audited.
 */
'use client';
import { useEffect, useState } from 'react';
import { api, type ApiError } from '@/lib/api-browser';
import Loading from '@/components/motion/Loading';

interface Ev { id: number; day: string; at: string | null; title: string; impact: string; category: string; country: string; source: string; manual: boolean; hidden: boolean }
interface Feed { feed: string; provider: string | null; last_attempt_at: string | null; last_ok_at: string | null; last_error: string | null; last_count: number | null }
interface Data { events: Ev[]; feeds: Feed[]; providers: { news: string; events: string; marketIq: boolean } }

const JOBS: [string, string][] = [['headlines', 'Headlines'], ['events', 'Events'], ['generated', 'Open, close and expiry rows'], ['expiries', 'Expiries and lot sizes (Market IQ)'], ['calendar_check', 'Calendar check']];
const IMPACTS = ['high', 'medium', 'low', 'expiry', 'info'];
const CATEGORIES = ['macro', 'policy', 'results', 'market', 'expiry', 'holiday', 'global', 'other'];
const IST = { timeZone: 'Asia/Kolkata' } as const;
const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB', { ...IST, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export default function DeskAdmin() {
  const [d, setD] = useState<Data | null>(null), [msg, setMsg] = useState(''), [busy, setBusy] = useState('');
  const [form, setForm] = useState({ day: today(), at: '10:00', title: '', impact: 'high', category: 'macro' });
  const load = () => api<Data>('/admin/desk/events').then(setD).catch((e) => setMsg((e as ApiError).message));
  useEffect(() => { load(); }, []);

  const run = async (job: string) => {
    setBusy(job); setMsg('');
    try {
      const r = await api<{ count: number; error: string | null; problems?: string[] }>('/admin/desk/sync', { body: { job } });
      setMsg(r.error ? `Failed: ${r.error}` : r.problems?.length ? r.problems.join(' · ') : `Done (${r.count})`);
      await load();
    } catch (e) { setMsg((e as ApiError).message); } finally { setBusy(''); }
  };
  const add = async () => {
    setMsg('');
    try { await api('/admin/desk/events', { body: { ...form, at: form.at || null } }); setForm({ ...form, title: '' }); await load(); setMsg('Event added'); }
    catch (e) { setMsg((e as ApiError).message); }
  };
  const toggle = async (e: Ev) => {
    try { await api(`/admin/desk/events/${e.id}`, { method: 'PATCH', body: { hidden: !e.hidden } }); await load(); }
    catch (err) { setMsg((err as ApiError).message); }
  };

  if (!d) return <div className="rv-panel s12"><Loading /></div>;
  const feed = (f: string) => d.feeds.find((x) => x.feed === f);
  return (
    <>
      <div className="rv-panel s12" data-desk-admin>
        <div className="rv-ph"><h3>Desk feeds</h3><small>headlines: {d.providers.news} · events: {d.providers.events} · Market IQ: {d.providers.marketIq ? 'connected' : 'not configured'}</small></div>
        <div className="rv-tw"><table className="rv-t">
          <thead><tr><th>Feed</th><th>Last success</th><th className="n">Items</th><th>Last error</th><th /></tr></thead>
          <tbody>{JOBS.map(([id, name]) => {
            const f = feed(id);
            return (
              <tr key={id} data-feed={id}>
                <td>{name}</td><td>{when(f?.last_ok_at ?? null)}</td><td className="n">{f?.last_count ?? '—'}</td>
                <td className="mut">{f?.last_error && (!f.last_ok_at || f.last_attempt_at! > f.last_ok_at) ? f.last_error : ''}</td>
                <td className="n"><button className="btn ghost" onClick={() => run(id)} disabled={!!busy}>{busy === id ? 'Running…' : 'Run now'}</button></td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {msg && <p className="status" role="status">{msg}</p>}
      </div>

      <div className="rv-panel s12">
        <div className="rv-ph"><h3>Add an event</h3><small>scheduled facts only (no views); providers never overwrite it</small></div>
        <div className="desk-ad-form">
          <input className="field" type="date" aria-label="Day" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} />
          <input className="field" type="time" aria-label="Time (IST)" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} />
          <input className="field" aria-label="Title" placeholder="e.g. RBI policy decision" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="field" aria-label="Impact" value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })}>{IMPACTS.map((i) => <option key={i}>{i}</option>)}</select>
          <select className="field" aria-label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <button className="btn" onClick={add} disabled={form.title.trim().length < 3}>Add</button>
        </div>
      </div>

      <div className="rv-panel s12">
        <div className="rv-ph"><h3>Events, next 14 days</h3><small>an edited or hidden event becomes manual</small></div>
        <div className="rv-tw"><table className="rv-t">
          <thead><tr><th>Day</th><th>Time</th><th>Title</th><th>Impact</th><th>Source</th><th /></tr></thead>
          <tbody>{d.events.length ? d.events.map((e) => (
            <tr key={e.id} className={e.hidden ? 'mut' : ''} data-event={e.id}>
              <td>{e.day}</td><td>{e.at ?? 'All day'}</td><td>{e.title}{e.hidden ? ' (hidden)' : ''}</td><td>{e.impact}</td><td>{e.source}{e.manual && e.source !== 'manual' ? ' · edited' : ''}</td>
              <td className="n"><button className="btn ghost" onClick={() => toggle(e)}>{e.hidden ? 'Show' : 'Hide'}</button></td>
            </tr>
          )) : <tr><td colSpan={6} className="mut">Nothing yet.</td></tr>}</tbody>
        </table></div>
      </div>
    </>
  );
}
