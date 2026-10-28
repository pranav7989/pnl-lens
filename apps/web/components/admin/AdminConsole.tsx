/**
 * @file  apps/web/components/admin/AdminConsole.tsx
 * @area  Admin
 * @what  Admin console UI: Users, User management, Finance, Errors, Support, Product, Blog and Research tabs (shown per role).
 */
'use client';
import { useEffect, useState } from 'react';
import Loading from '@/components/motion/Loading';
import { withViewTransition } from '@/lib/motion/viewTransition';
import BlogAdmin from './BlogAdmin';
import ResearchAdmin from './ResearchAdmin';
import UserAdmin from './UserAdmin';

type Tab = 'users' | 'finance' | 'errors' | 'support' | 'product' | 'blog' | 'research' | 'usermgmt';
const TABS: { id: Tab; name: string; perm: string }[] = [
  { id: 'users', name: 'Users', perm: 'tab:users' }, { id: 'usermgmt', name: 'User management', perm: 'tab:usermgmt' }, { id: 'finance', name: 'Finance', perm: 'tab:finance' },
  { id: 'errors', name: 'Errors', perm: 'tab:errors' }, { id: 'support', name: 'Support', perm: 'tab:support' }, { id: 'product', name: 'Product', perm: 'tab:product' },
  { id: 'blog', name: 'Blog', perm: 'tab:blog' },
  { id: 'research', name: 'Research', perm: 'tab:research' },
];
const n = (v: any) => Number(v || 0);
const money = (minor: any, cur = 'INR') => (cur === 'USD' ? '$' : '₹') + (n(minor) / 100).toLocaleString(cur === 'USD' ? 'en-US' : 'en-IN', { maximumFractionDigits: 0 });
const ago = (d: string) => { const s = (Date.now() - new Date(d).getTime()) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: 'gain' | 'loss' }) {
  return <div className="rv-kpi"><div className="rv-kl">{label}</div><div className={`rv-kv ${tone || ''}`} data-count-up>{value}</div><div className="rv-ks">{sub || ''}</div></div>;
}
function Bars({ rows, k, label, color = 'var(--y)' }: { rows: any[]; k: string; label: (r: any) => string; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => n(r[k])));
  return <div className="ad-bars">{rows.map((r, i) => <div key={i} title={`${label(r)}: ${r[k]}`}><i style={{ height: `${(n(r[k]) / max) * 100}%`, background: color }} /><span>{i % Math.ceil(rows.length / 8) === 0 ? label(r) : ''}</span></div>)}</div>;
}
function Table({ cols, rows }: { cols: [string, (r: any) => any, string?][]; rows: any[] }) {
  return <div className="rv-tw"><table className="rv-t"><thead><tr>{cols.map(([h, , c]) => <th key={h} className={c}>{h}</th>)}</tr></thead><tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{cols.map(([h, f, c]) => <td key={h} className={c}>{f(r)}</td>)}</tr>) : <tr><td colSpan={cols.length} className="mut">Nothing yet.</td></tr>}</tbody></table></div>;
}
const Panel = ({ title, sub, span = 's12', children }: any) => <div className={`rv-panel ${span}`}><div className="rv-ph"><h3>{title}</h3>{sub && <small>{sub}</small>}</div>{children}</div>;

export default function AdminConsole({ role, perms, pg }: { role: string; perms: string[]; pg: boolean }) {
  const tabs = TABS.filter((t) => perms.includes(t.perm));
  const [tab, setTab] = useState<Tab | null>(tabs[0]?.id || null);
  const [data, setData] = useState<Record<string, any>>({});
  const [err, setErr] = useState('');
  const load = (t: Tab) => fetch(`/api/v1/admin/metrics?tab=${t}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.message || j.error); setData((d) => ({ ...d, [t]: j })); }).catch((e) => setErr(e.message));
  useEffect(() => { if (tab && tab !== 'blog' && tab !== 'research' && tab !== 'usermgmt' && !data[tab]) load(tab); }, [tab]); // eslint-disable-line
  if (!pg) return <div className="panel center-card"><h3>Admin console</h3><p className="muted">Connect PostgreSQL (STORE_DRIVER=pg) to see live metrics.</p></div>;
  const d = tab ? data[tab] : null;
  return (
    <div className="ad">
      <div className="ad-head"><div><h1 className="page-title">Admin</h1><p className="muted" style={{ margin: 0 }}>Signed in as <b className="ad-role">{role}</b></p></div>
        {tab !== 'blog' && tab !== 'research' && tab !== 'usermgmt' && <button className="btn ghost" onClick={() => tab && load(tab)}>Refresh</button>}</div>
      <nav className="tabs" role="tablist">{tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} data-tab={t.id} onClick={() => withViewTransition(() => setTab(t.id), { react: true })}>{t.name}</button>)}</nav>
      {err && <p className="status err">{err}</p>}
      {tab === 'blog' ? <div className="rv-grid" style={{ marginTop: 16, viewTransitionName: 'mo-swap' }}><BlogAdmin /></div> : tab === 'research' ? <div className="rv-grid" style={{ marginTop: 16, viewTransitionName: 'mo-swap' }}><ResearchAdmin /></div> : tab === 'usermgmt' ? <div className="rv-grid" style={{ marginTop: 16, viewTransitionName: 'mo-swap' }}><UserAdmin /></div> : !d ? <div style={{ padding: 20 }}><Loading /></div> : (
        <div className="rv-grid" style={{ marginTop: 16, viewTransitionName: 'mo-swap' }}>
          {tab === 'users' && <UsersTab d={d} canRoles={perms.includes('roles:manage')} />}
          {tab === 'finance' && <FinanceTab d={d} />}
          {tab === 'errors' && <ErrorsTab d={d} />}
          {tab === 'support' && <SupportTab d={d} reload={() => load('support')} canGrant={perms.includes('plans:grant')} />}
          {tab === 'product' && <ProductTab d={d} />}
        </div>
      )}
    </div>
  );
}

function UsersTab({ d, canRoles }: { d: any; canRoles: boolean }) {
  const k = d.k, stick = k.mau ? Math.round((k.dau / k.mau) * 100) : 0, ret = d.retention.cohort ? Math.round((d.retention.retained / d.retention.cohort) * 100) : 0;
  return <>
    <div className="rv-kpis s12 ad-k6">
      <Kpi label="DAU" value={k.dau} sub="active today" /><Kpi label="WAU" value={k.wau} sub="last 7 days" /><Kpi label="MAU" value={k.mau} sub="last 30 days" />
      <Kpi label="Stickiness" value={stick + '%'} sub="DAU ÷ MAU" /><Kpi label="New users" value={k.new_7d} sub={`${k.new_1d} today · ${k.new_30d} in 30 days`} /><Kpi label="Repeat users" value={k.repeat_30d} sub={`${k.repeat_reporters} with 2+ reports`} />
    </div>
    <Panel title="Daily active users" sub="last 30 days" span="s7"><Bars rows={d.daily} k="active" label={(r) => r.day.slice(5)} /></Panel>
    <Panel title="New sign-ups" sub="last 30 days" span="s5"><Bars rows={d.daily} k="new" label={(r) => r.day.slice(5)} color="var(--gain)" /></Panel>
    <Panel title="30-day retention" sub="users who joined 30–60 days ago" span="s4"><div className="ad-big">{ret}%</div><p className="muted">{d.retention.retained} of {d.retention.cohort} came back in the last 30 days.</p></Panel>
    <Panel title="Users by country" span="s4"><Table cols={[['Country', (r) => r.country], ['Users', (r) => r.n, 'n']]} rows={d.countries} /></Panel>
    <Panel title="Total users" span="s4"><div className="ad-big">{k.total}</div><p className="muted">All accounts ever created.</p></Panel>
    {d.recent.length > 0 && <Panel title="Latest sign-ups"><Table cols={[['Email', (r) => r.email], ['Country', (r) => r.country], ['Joined', (r) => ago(r.created_at)], ['Last sign-in', (r) => (r.last_login_at ? ago(r.last_login_at) : '—')]]} rows={d.recent} /></Panel>}
    {canRoles && <RolesPanel />}
  </>;
}

function RolesPanel() {
  const [email, setEmail] = useState(''), [role, setRole] = useState('support'), [msg, setMsg] = useState('');
  const save = async () => { const r = await fetch('/api/v1/admin/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role }) }); const j = await r.json(); setMsg(r.ok ? `${email} is now ${role}.` : j.message || 'Not allowed'); };
  return <Panel title="Team & roles" sub="who can see what">
    <div className="filters"><input placeholder="teammate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
      <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">{['admin', 'support', 'finance', 'analyst', 'user', 'owner'].map((r) => <option key={r}>{r}</option>)}</select>
      <button className="btn" onClick={save}>Set role</button></div>
    {msg && <p className="muted">{msg}</p>}
    <p className="rv-note">Owner: everything · Admin: all but finance · Support: errors, support, user lookup · Finance: finance only · Analyst: user and product metrics without emails.</p>
  </Panel>;
}

function FinanceTab({ d }: { d: any }) {
  const k = d.k, months = Array.from(new Set([...d.byMonth.map((r: any) => r.month), ...d.costs.map((r: any) => r.month)])).sort() as string[];
  const sumBy = (rows: any[], m: string, cur: string, f: string) => rows.filter((r) => r.month === m && r.currency === cur).reduce((s, r) => s + n(r[f]), 0);
  const pl = months.map((m) => { const rev = sumBy(d.byMonth, m, 'INR', 'revenue'), refunds = sumBy(d.byMonth, m, 'INR', 'refunds'), fees = sumBy(d.fees, m, 'INR', 'fees'), costs = sumBy(d.costs, m, 'INR', 'amount'); return { month: m, rev, refunds, fees, costs, margin: rev - refunds - fees - costs, usd: sumBy(d.byMonth, m, 'USD', 'revenue') }; });
  return <>
    <div className="rv-kpis s12 ad-k6">
      <Kpi label="Revenue (₹)" value={money(k.inr_30d, 'INR')} sub="last 30 days" tone="gain" /><Kpi label="Revenue ($)" value={money(k.usd_30d, 'USD')} sub="last 30 days" tone="gain" />
      <Kpi label="Paying customers" value={k.payers_30d} sub={`${k.orders_30d} orders`} /><Kpi label="ARPPU (₹)" value={k.payers_30d ? money(n(k.inr_30d) / k.payers_30d) : '—'} sub="per paying customer" />
      <Kpi label="Failed payments" value={k.failed_30d} sub="last 30 days" tone={k.failed_30d ? 'loss' : undefined} /><Kpi label="Refunds" value={money(k.refunds_30d)} sub="last 30 days" tone={n(k.refunds_30d) ? 'loss' : undefined} />
    </div>
    <Panel title="Revenue by month (₹)" span="s7"><Bars rows={pl} k="rev" label={(r) => r.month.slice(2)} color="var(--gain)" /></Panel>
    <Panel title="Plan mix" sub="paid orders" span="s5"><Table cols={[['Plan', (r) => r.plan], ['Currency', (r) => r.currency], ['Orders', (r) => r.n, 'n'], ['Revenue', (r) => money(r.revenue, r.currency), 'n']]} rows={d.plans} /></Panel>
    <Panel title="Monthly P&L (₹)" sub="revenue − refunds − gateway fees − running costs">
      <Table cols={[['Month', (r) => r.month], ['Revenue', (r) => money(r.rev), 'n'], ['Refunds', (r) => money(r.refunds), 'n'], ['Gateway fees', (r) => money(r.fees), 'n'], ['Running costs', (r) => money(r.costs), 'n'], ['Margin', (r) => <b className={r.margin >= 0 ? 'gain' : 'loss'}>{money(r.margin)}</b>, 'n'], ['Revenue ($)', (r) => money(r.usd, 'USD'), 'n']]} rows={pl} />
      <p className="rv-note">Running costs come from the costs table (hosting, database, email, marketing…). Gateway fees are estimated at 2% (INR) and 3% (international).</p></Panel>
  </>;
}

function ErrorsTab({ d }: { d: any }) {
  return <>
    <div className="rv-kpis s12"><Kpi label="Errors (24h)" value={d.k.e24} tone={d.k.e24 ? 'loss' : undefined} /><Kpi label="Distinct issues (24h)" value={d.k.kinds24} /><Kpi label="Users affected (24h)" value={d.k.users24} /><Kpi label="Errors (7 days)" value={d.k.e7d} /></div>
    <Panel title="Errors per hour" sub="last 24 hours"><Bars rows={d.hourly} k="n" label={(r) => r.hour} color="var(--loss)" /></Panel>
    <Panel title="Error center" sub="grouped by cause, most active first">
      <Table cols={[['Issue', (r) => <div><b>{r.message}</b><div className="mut" style={{ fontSize: 12 }}>{r.source} · {r.route || '—'} · #{r.fingerprint}</div></div>], ['24h', (r) => <b className={r.last_24h ? 'loss' : ''}>{r.last_24h}</b>, 'n'], ['14 days', (r) => r.total, 'n'], ['Users', (r) => r.users, 'n'], ['Last seen', (r) => ago(r.last_seen), 'n'], ['First seen', (r) => ago(r.first_seen), 'n']]} rows={d.groups} /></Panel>
  </>;
}

function SupportTab({ d, reload, canGrant }: { d: any; reload: () => void; canGrant: boolean }) {
  const [email, setEmail] = useState(''), [u, setU] = useState<any>(null), [msg, setMsg] = useState('');
  const look = async () => { setMsg(''); setU(null); const r = await fetch('/api/v1/admin/user?email=' + encodeURIComponent(email)); const j = await r.json(); if (r.ok) setU(j); else setMsg(j.message || 'Not found'); };
  const setStatus = async (id: number, status: string) => { await fetch('/api/v1/admin/tickets', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }); reload(); };
  return <>
    <div className="rv-kpis s12"><Kpi label="Open tickets" value={d.k.open} tone={d.k.open ? 'loss' : undefined} /><Kpi label="In progress" value={d.k.in_progress} /><Kpi label="Resolved (7 days)" value={d.k.resolved_7d} tone="gain" /><Kpi label="Avg time to resolve" value={`${d.k.avg_hours}h`} sub="last 30 days" /></div>
    <Panel title="Find a user's issue" sub="profile, likely cause and full timeline">
      <div className="filters"><input placeholder="customer@email.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && look()} aria-label="Customer email" /><button className="btn" onClick={look}>Look up</button></div>
      {msg && <p className="status err">{msg}</p>}
      {u && <div className="ad-user">
        <div className="ad-diag"><span>Likely cause</span><b>{u.diagnosis}</b></div>
        <div className="ad-prof">{[['Email', u.user.email], ['Role', u.user.role], ['Country', u.user.country || '—'], ['Joined', ago(u.user.created_at)], ['Last sign-in', u.user.last_login_at ? ago(u.user.last_login_at) : '—'], ['Credits', u.user.credits ?? 0]].map(([a, b]) => <div key={a as string}><span>{a}</span><b>{b as any}</b></div>)}</div>
        <Table cols={[['When', (r) => ago(r.at)], ['Type', (r) => <span className={`ad-kind ${r.kind}`}>{r.kind}</span>], ['What', (r) => r.title], ['Detail', (r) => <span className="mut" style={{ fontSize: 12 }}>{String(r.detail || '').slice(0, 140)}</span>]]} rows={u.timeline} />
        {canGrant && <GrantPlan email={u.user.email} />}
      </div>}
    </Panel>
    <Panel title="Tickets" sub="open first, then by priority" span="s7">
      <Table cols={[['Customer', (r) => <div><b>{r.subject}</b><div className="mut" style={{ fontSize: 12 }}>{r.email} · {ago(r.created_at)}{r.related_errors ? ` · ${r.related_errors} related error(s)` : ''}</div></div>], ['Priority', (r) => r.priority], ['Status', (r) => <select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)} aria-label="Status">{['open', 'in_progress', 'resolved'].map((s) => <option key={s}>{s}</option>)}</select>]]} rows={d.tickets} /></Panel>
    <Panel title="Users having trouble" sub="errors or unreadable uploads, last 7 days" span="s5">
      <Table cols={[['User', (r) => r.email], ['Errors', (r) => r.errors, 'n'], ['Failed uploads', (r) => r.failed_uploads, 'n'], ['Last', (r) => ago(r.last_at), 'n']]} rows={d.struggling} /></Panel>
  </>;
}

function ProductTab({ d }: { d: any }) {
  const k = d.k, fr = k.started_30d ? Math.round((k.failed_30d / k.started_30d) * 100) : 0;
  return <>
    <div className="rv-kpis s12"><Kpi label="Reports (30 days)" value={k.reports_30d} sub={`${k.reports_1d} today`} /><Kpi label="Files per report" value={k.files_per_report || 0} /><Kpi label="Upload failure rate" value={fr + '%'} sub={`${k.failed_30d} of ${k.started_30d} uploads`} tone={fr > 5 ? 'loss' : undefined} /><Kpi label="Uploads started" value={k.started_30d} sub="last 30 days" /></div>
    <Panel title="Reports created" sub="last 30 days" span="s7"><Bars rows={d.daily} k="reports" label={(r) => r.day.slice(5)} /></Panel>
    <Panel title="Most-used tabs" span="s5"><Table cols={[['Tab', (r) => r.tab], ['Views', (r) => r.n, 'n']]} rows={d.tabs} /></Panel>
    <Panel title="Why uploads fail" sub="reason and file type" span="s7"><Table cols={[['Reason', (r) => r.reason], ['File type', (r) => r.ext], ['Count', (r) => r.n, 'n']]} rows={d.failures} /></Panel>
    <Panel title="Brokers seen" span="s5"><Table cols={[['Broker / source', (r) => r.broker], ['Reports', (r) => r.n, 'n']]} rows={d.brokers} /></Panel>
    {d.journey && (() => { const jn = d.journey, pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '–'); return <>
      <div className="rv-kpis s12"><Kpi label="Single → higher plan" value={pct(jn.single_upgraded, jn.single_first)} sub={`${jn.single_upgraded} of ${jn.single_first} who started on Single`} />
        <Kpi label="Came back within 45 days" value={pct(jn.returned_45d, jn.with_report)} sub={`${jn.returned_45d} of ${jn.with_report} with a report`} />
        <Kpi label="Upgrades from the journey" value={jn.upgrades} sub="last 30 days" /><Kpi label="Journey bar views" value={jn.views} sub="last 30 days" /></div>
      <Panel title="Journey" sub="last 30 days" span="s12"><Table cols={[['Event', (r) => r.m], ['Count', (r) => r.n, 'n']]}
        rows={[{ m: 'Bar shown (journey_bar_view)', n: jn.views }, { m: 'Locked step tapped (journey_step_click)', n: jn.step_clicks }, { m: 'Next action tapped (journey_next_action_click)', n: jn.action_clicks }, { m: 'Purchase from the journey (upgrade_from_journey)', n: jn.upgrades }]} /></Panel></>; })()}
    {d.instagram && <Panel title="Instagram section" sub="visitors, last 30 days" span="s6">
      <Table cols={[['Measure', (r) => r.m], ['Count', (r) => r.n, 'n']]} rows={[{ m: 'Section seen', n: d.instagram.views }, { m: 'Reels played', n: d.instagram.plays }, { m: 'Cards opened on Instagram', n: d.instagram.card_clicks }, { m: 'Follow on Instagram', n: d.instagram.follows }]} /></Panel>}
    {d.social && <Panel title="Social icons" sub="clicks, last 30 days" span="s6">
      <Table cols={[['Network', (r) => r.network], ['Where', (r) => r.placement], ['Clicks', (r) => r.n, 'n']]} rows={d.social} /></Panel>}
    {d.blog && <Panel title="Blog" sub={`last 30 days · ${d.blog.uploads} uploads and ${d.blog.signups} sign-ups came from the blog`} span="s12">
      <Table cols={[['Article', (r) => r.slug], ['Views', (r) => r.views, 'n'], ['“Analyse my trades” clicks', (r) => r.cta, 'n'], ['Landing preview clicks', (r) => r.preview, 'n']]} rows={d.blog.posts} /></Panel>}
    {d.landing && <Panel title="Landing page" sub="visitors, last 30 days: pricing seen and how far they scrolled" span="s12">
      <Table cols={[['Measure', (r) => r.m], ['Count', (r) => r.n, 'n']]} rows={[{ m: 'Pricing section seen', n: d.landing.pricing_views }, { m: 'Scrolled 25% of the page', n: d.landing.d25 }, { m: 'Scrolled 50%', n: d.landing.d50 }, { m: 'Scrolled 75%', n: d.landing.d75 }, { m: 'Reached the end', n: d.landing.d100 }]} /></Panel>}
  </>;
}

/** Owner-only manual plan grant (plan D5, W11): plan, reason (required), confirm. The API and the database re-check the owner role and write the audit log. */
function GrantPlan({ email }: { email: string }) {
  const [planId, setPlanId] = useState('snapshot'), [reason, setReason] = useState(''), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);
  const grant = async () => {
    if (reason.trim().length < 3) { setMsg('Write the reason for this grant.'); return; }
    if (!confirm(`Grant the ${planId} plan to ${email}? This is recorded in the audit log.`)) return;
    setBusy(true); setMsg('');
    const r = await fetch('/api/v1/admin/grants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, planId, reason }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false); setMsg(r.ok ? `Plan granted to ${email}.` : j.message || j.error || 'Not allowed');
    if (r.ok) setReason('');
  };
  return <div className="ad-grant" style={{ marginTop: 14 }}>
    <h4 style={{ margin: '0 0 8px' }}>Grant plan <small className="mut">owner only</small></h4>
    <div className="filters">
      <select value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="Plan">{['single', 'snapshot', 'progress', 'discipline'].map((p) => <option key={p} value={p}>{p}</option>)}</select>
      <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" maxLength={500} />
      <button className="btn" onClick={grant} disabled={busy}>Grant plan</button>
    </div>
    {msg && <p className="mut" style={{ fontSize: 13 }}>{msg}</p>}
  </div>;
}
