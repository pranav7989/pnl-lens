/**
 * @file  apps/web/components/workspace/Workspace.tsx
 * @area  Reports
 * @what  The report workspace (ported from the offline tool, now on the API): upload with consent, loader, file tabs + All files, "+" and ×, plan card, MON-YY history.
 */
/**
 * Behaviour follows apps/web/offline/app_offline.js; the data now lives on the server:
 *  - Analyse: POST /api/v1/analyses (consent required) → the "Analysing…" loader follows GET /api/v1/analyses/:id →
 *    with a plan that has reports left, the report is created at once (one report used, as in the offline tool) and
 *    opened; without one, the website's free preview is shown (plan D11).
 *  - "+" on a report: upload with reportId → POST /reports/:id/files (file-set lock enforced in the database).
 *  - ×: POST /reports/:id/files/remove → re-analysis of the other statements; the removed one keeps its place.
 *  - Each statement has its own dashboard; "All files" is the combined report when 2+ statements have trades.
 */
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { engine, formatterFor } from '@pnl-lens/engine';
import { MAX_FILE_BYTES, ACCEPTED_EXT } from '@pnl-lens/shared/limits';
import { mountReport } from '@/lib/report-ui/render.js';
import { withAnalysing } from '@/lib/report-ui/loader.js';
import { api, uploadStatements, waitForAnalysis, type AnalysisStatus, type ApiError } from '@/lib/api-browser';
import { PlanCard, PlanStrip } from './PlanCard';
import History from './History';
import JourneyBar from './JourneyBar';
import { journey } from '@pnl-lens/shared/journey';
import type { PlanId } from '@pnl-lens/shared/pricing';
import {
  currentPlan, reportsLeft, expired, planEndedText, planName, filesFullText, dayLabel, st, UPLOAD_SUB, CONSENT_PROCESSING, CONSENT_RESEARCH,
  type PlanRow, type HistoryItem, type CurrentReport,
} from './model';

const CURRENCIES = Object.keys(engine.CURSYM as Record<string, string>);
const TABS = [['overview', 'Overview'], ['progress', 'Progress'], ['insights', 'Insights & fixes'], ['clusters', 'Clusters'], ['positions', 'Positions']] as const;
type Lock = { title: string; text: string } | null;

const money = (v: number, cur?: string | null) => { engine.setCurrency(cur || 'INR'); return engine.inr(v) as string; };
const Net = ({ v, cur }: { v: number; cur?: string | null }) => <span className={v > 0 ? 'gain' : v < 0 ? 'loss' : ''}>{money(v, cur)}</span>;
const ev = (name: string, props?: object) => { fetch('/api/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, props }) }).catch(() => {}); };

function LockMessage({ lock, onClose }: { lock: Lock; onClose: () => void }) {
  useEffect(() => { if (!lock) return; const t = setTimeout(onClose, 12000); return () => clearTimeout(t); }, [lock, onClose]);
  return (
    <div className="lock-msg" role="alert" hidden={!lock}>
      <div><b>{lock?.title}</b><p>{lock?.text}</p></div>
      <button type="button" aria-label="Close" onClick={onClose}>×</button>
    </div>
  );
}

/** Analyse files (upload → worker → status) behind the existing loader. Throws ApiError, or returns the finished analysis. */
async function analyseFiles(files: File[], fields: Record<string, string>, fileCount: number): Promise<AnalysisStatus> {
  return withAnalysing(async () => waitForAnalysis(await uploadStatements(files, fields)), { fileCount });
}

export default function Workspace(props: { mode: 'upload' | 'report'; plans: PlanRow[] | null; reports: HistoryItem[]; current?: CurrentReport; prices?: Record<string, string>; source?: 'blog' }) {
  const plan = currentPlan(props.plans);
  const [lock, setLock] = useState<Lock>(null);
  const close = () => setLock(null);
  return (
    <>
      <LockMessage lock={lock} onClose={close} />
      <JourneyBar plans={props.plans} reports={props.reports} prices={props.prices || {}} />
      {props.mode === 'upload' || !props.current
        ? <UploadView plan={plan} reports={props.reports} setLock={setLock} source={props.source} prices={props.prices || {}} />
        : <ReportView plan={plan} plans={props.plans} prices={props.prices || {}} reports={props.reports} current={props.current} setLock={setLock} />}
    </>
  );
}

/* ---------------------------------------------------------------- upload view */
function UploadView({ plan, reports, setLock, source, prices }: { plan: PlanRow | null; reports: HistoryItem[]; setLock: (l: Lock) => void; source?: 'blog'; prices: Record<string, string> }) {
  const router = useRouter();
  const maxFiles = plan && !expired(plan) ? plan.filesPerReport : 3;
  const [picked, setPicked] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [currency, setCurrency] = useState('');
  const [consent, setConsent] = useState(false);
  const [research, setResearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<AnalysisStatus | null>(null);
  const canSave = !!plan && !expired(plan) && reportsLeft(plan) > 0;

  function pick(list: FileList | null) {
    setError('');
    const next = [...picked];
    for (const f of Array.from(list || [])) {
      const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
      if (!ACCEPTED_EXT.includes(ext)) { setError(f.name + ': use Excel, CSV, PDF or Word files.'); continue; }
      if (f.size > MAX_FILE_BYTES) { setError(f.name + ' is over 10MB.'); continue; }
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
      if (next.length >= maxFiles) { setError(plan ? 'Your ' + planName(plan.planId) + ' plan allows up to ' + st(maxFiles) + ' per report.' : `Up to ${maxFiles} files per report.`); break; }
      next.push(f);
    }
    setPicked(next);
  }

  async function save(analysisId: string) {
    try {
      const { id } = await api<{ id: string }>('/reports', { body: { analysisId } });
      router.push(`/report/${id}`); router.refresh();
    } catch (e) {
      const err = e as ApiError;
      if ((err.error === 'plan_used_up' || err.error === 'plan_expired') && plan) setLock({ title: 'No reports left in this plan', text: planEndedText(plan) });
      else setError(err.status === 402 ? 'No reports left. Choose a plan to continue.' : err.message);
      setBusy(false);
    }
  }

  async function analyse() {
    if (!picked.length) return;
    if (!consent) { setError('Tick the box to agree to processing before uploading.'); return; }
    setBusy(true); setError(''); setPreview(null);
    const ext = picked.map((f) => f.name.split('.').pop()).join(',');
    try {
      const s = await analyseFiles(picked, { consent: 'true', ...(research ? { research: 'true' } : {}), ...(currency ? { currency } : {}), ...(source ? { source } : {}) }, picked.length);
      if (s.status === 'failed') {
        ev(s.error === 'no_closed_trades' ? 'no_trades' : 'upload_failed', { reason: s.error, ext });
        setError(s.message || 'Could not read the file.'); setBusy(false); return;
      }
      if (canSave) { await save(s.id); return; }
      setPreview(s); setBusy(false);
    } catch (e) {
      ev('upload_failed', { reason: (e as ApiError).error, ext });
      setError((e as ApiError).message || 'Could not read the file.'); setBusy(false);
    }
  }

  const p = preview?.preview;
  return (
    <section id="uploadView" style={{ maxWidth: 760, margin: '0 auto' }}>
      <PlanStrip plan={plan} />
      <h1 className="page-title">New report</h1>
      <p className="page-sub">{UPLOAD_SUB}</p>
      <div id="drop" className={over ? 'over' : ''} tabIndex={0} role="button" aria-label="Choose files"
        onClick={() => document.getElementById('file')?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('file')?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}>
        <b id="dropTitle">Add up to {st(maxFiles)}</b>
        <span className="muted">1 file = one P&amp;L statement or tradebook downloaded from your broker · Excel, CSV, PDF or Word · 10MB each</span>
        <div style={{ marginTop: 14 }}><span className="btn">Choose files</span></div>
        <input id="file" type="file" accept={ACCEPTED_EXT.join(',')} multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
      </div>
      <div className="up-note" role="note">
        <b>Check your files before you upload.</b>
        <span className="plan-note"><b className="def">1 file = one P&amp;L statement or tradebook downloaded from your broker.</b> Each report in your plan holds up to {maxFiles} of them (for example, {maxFiles === 2 ? 'equity and F&O statements, or statements from two brokers' : 'statements from up to three brokers'}). Once a statement has been analysed its place is used, even if you remove it. Re-opening the same statement is always fine.</span>
        <span>Reports can&apos;t be refunded once generated. If something genuinely goes wrong, write to <a href="mailto:support@pnllens.com">support@pnllens.com</a> and we&apos;ll respond promptly.</span>
      </div>
      {picked.length > 0 && (
        <ul className="filelist">
          {picked.map((f, i) => (
            <li key={f.name + f.size}><span>{f.name} <span className="muted">· {Math.round(f.size / 1024)} KB</span></span>
              <button aria-label="Remove" onClick={() => setPicked(picked.filter((_, j) => j !== i))}>×</button></li>
          ))}
        </ul>
      )}
      <div className="consent">
        <label><input type="checkbox" name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> <span>{CONSENT_PROCESSING}</span></label>
        <label><input type="checkbox" name="research" checked={research} onChange={(e) => setResearch(e.target.checked)} /> <span>{CONSENT_RESEARCH}</span></label>
      </div>
      <div className="filters" style={{ marginTop: 16, alignItems: 'center' }}>
        <label className="muted" style={{ fontSize: 13 }}>Currency&nbsp;
          <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="">Detect automatically</option>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button className="btn" disabled={!picked.length || !consent || busy} onClick={analyse}>Analyse</button>
      </div>
      {error && <p className="status err" role="status">{error}</p>}
      {p && preview && (
        // free preview (credits spec rule 9): headline numbers and 2 insight titles; the rest is blurred; nothing is saved
        <div className="panel pv" style={{ marginTop: 16 }} data-preview>
          <h3>Your free preview</h3>
          <div className="tiles">
            <div className="panel tile"><div className="lab">Net P&amp;L</div><div className={`val ${p.net < 0 ? 'loss' : 'gain'}`}>{money(p.net, p.currency)}</div></div>
            <div className="panel tile"><div className="lab">Total charges</div><div className="val">{money(p.charges, p.currency)}</div></div>
            <div className="panel tile"><div className="lab">Trades</div><div className="val">{p.positions}</div></div>
          </div>
          {p.insights.length > 0 && (
            <div className="pv-insights">
              <div className="lab">{p.insights.length} of {Math.max(p.insightCount, p.insights.length)} insights</div>
              <ol>{p.insights.map((t) => <li key={t}>{t}</li>)}</ol>
            </div>
          )}
          <div className="pv-locked">
            <div className="pv-blur" aria-hidden="true">
              <div className="pv-row"><i /><i /><i /><i /></div>
              <div className="pv-chart" />
              <div className="pv-row"><i /><i /></div>
              <div className="pv-lines"><i /><i /><i /><i /></div>
            </div>
            <div className="pv-cta">
              <p>Every insight, fix, cluster and position is in the full report.</p>
              <a className="btn" href="/pricing">Get the full report from {prices.single || '₹99'}</a>
            </div>
          </div>
        </div>
      )}
      <div className="up-hist"><div className="ws-side-h">Your reports</div><History reports={reports} /></div>
    </section>
  );
}

/* ---------------------------------------------------------------- report view */
function ReportView({ plan, plans, prices, reports, current, setLock }: { plan: PlanRow | null; plans: PlanRow[] | null; prices: Record<string, string>; reports: HistoryItem[]; current: CurrentReport; setLock: (l: Lock) => void }) {
  const router = useRouter();
  const files = current.files;
  const fileReport = (i: number) => (files.length === 1 ? current.report : files[i]?.report ?? null);
  const readable = files.filter((_, i) => fileReport(i)).length;
  const combined = files.length > 1 && readable >= 2 ? current.report : null;
  const [view, setView] = useState<'all' | number>(combined ? 'all' : 0);
  const [tab, setTab] = useState('overview');
  const root = useRef<HTMLDivElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const pendingView = useRef<number | null>(null);      // after "+": open the new statement once the refreshed list arrives
  const placesTotal = current.places.total, placesUsed = current.places.used;

  // keep the view valid when the file list changes (after "+" or ×)
  useEffect(() => {
    if (pendingView.current != null && pendingView.current < files.length) { setView(pendingView.current); pendingView.current = null; return; }
    if (view === 'all' && !combined) setView(0);
    else if (typeof view === 'number' && view >= files.length) setView(combined ? 'all' : 0);
  }, [files.length, combined, view]);

  const r = view === 'all' ? combined : fileReport(view as number);
  const slot = view === 'all' ? null : files[view as number];
  useEffect(() => {
    if (!root.current || !r) return;
    const checkups = reports.filter((x) => x.progressScore != null).map((x) => ({ savedAt: x.createdAt, to: x.to, score: x.progressScore as number, label: x.fileNames.join(', ') }));
    const j = journey({ plans, reports, prices: prices as Partial<Record<PlanId, string>> });
    const h = mountReport(root.current, r, { ...formatterFor(r), history: checkups, historyWhere: 'in your account', next: j.next });
    if (tab !== 'overview') h.show(tab);
    const el = root.current, nav = el.querySelector('.tabs');
    const onTab = (e: Event) => { const b = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement | null; if (b) setTab(b.dataset.tab!); };
    // "What's next" card (REQ-2): same event as the journey bar's action, marked as coming from the card
    const onCard = (e: Event) => { const a = (e.target as HTMLElement).closest('[data-wn-cta]') as HTMLElement | null; if (a) ev('journey_next_action_click', { kind: a.dataset.wnCta, plan: j.tier ?? 'none', from: 'card' }); };
    nav?.addEventListener('click', onTab);
    el.addEventListener('click', onCard);
    return () => { nav?.removeEventListener('click', onTab); el.removeEventListener('click', onCard); h.destroy(); };
  }, [r]);

  const stamp = (current.title ? '“' + current.title + '”  ·  ' : '') + 'Report of ' + dayLabel(current.createdAt) + ' ' + new Date(current.createdAt).getFullYear();
  const title = view === 'all' ? 'All files' : slot ? slot.name : 'Report';
  const meta = view === 'all' ? stamp + '  ·  ' + files.filter((_, i) => fileReport(i)).map((f) => f.name).join(' + ') : stamp + (r?.m?.from ? '  ·  trades ' + r.m.from + ' to ' + r.m.to : '');

  /** Runs a re-analysis of this report (after "+" or ×) and applies it; returns false when it was refused. */
  async function change(start: () => Promise<string>, fileCount: number, failTitle: string) {
    try {
      const s = await withAnalysing(async () => waitForAnalysis(await start()), { fileCount });
      if (s.status === 'failed') { setLock({ title: failTitle, text: s.message || 'Could not read the file.' }); return false; }
      await api(`/reports/${current.id}/files`, { body: { analysisId: s.id } });
      router.refresh();
      return true;
    } catch (e) {
      const err = e as ApiError;
      if (err.error === 'report_files_full') setLock({ title: failTitle, text: filesFullText(placesTotal) });
      else setLock({ title: failTitle, text: err.message });
      return false;
    }
  }
  async function addFile(f: File) {
    pendingView.current = files.length;
    const ok = await change(() => uploadStatements([f], { consent: 'true', reportId: current.id }), files.length + 1, f.name + ' wasn\'t added');
    if (!ok) pendingView.current = null;
  }
  async function removeFile(i: number) {
    await change(async () => (await api<{ analysisId: string }>(`/reports/${current.id}/files/remove`, { body: { fileId: files[i].id } })).analysisId, files.length - 1, 'Could not remove ' + files[i].name);
  }
  function exportCsv() {
    if (!r) return;
    const cols = ['symbol', 'group', 'market', 'direction', 'entryDate', 'exitDate', 'entryHour', 'holdDays', 'qty', 'avgBuy', 'buy', 'sell', 'pct', 'pnl', 'netEst'];
    const q = (v: unknown) => (v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : '"' + String(v).replace(/"/g, '""') + '"');
    const rows = [cols.join(','), ...r.trades.map((t: any) => cols.map((c) => q(t[c])).join(','))];
    const name = view === 'all' ? 'all-files' : (slot?.name || 'report').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-');
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'pnl-lens-' + name + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function remove() {
    if (!confirm('Delete this report permanently? This can’t be undone, and the report isn’t returned to your plan.')) return;
    try { await api(`/reports/${current.id}`, { method: 'DELETE' }); router.push('/dashboard'); router.refresh(); }
    catch (e) { setLock({ title: 'Could not delete the report', text: (e as ApiError).message }); }
  }

  const addSlots = placesUsed >= placesTotal ? 0 : Math.max(0, placesTotal - files.length);
  return (
    <section id="reportView">
      <div className="ws">
        <aside className="ws-side" aria-label="Reports">
          <PlanCard plan={plan} />
          <div className="ws-side-h">This report</div>
          <div id="sideList" role="tablist" aria-orientation="vertical">
            {placesTotal > 1 && (combined
              ? <button className="ws-item all" role="tab" aria-selected={view === 'all'} onClick={() => setView('all')}><b>All files</b><small>{readable} files · {combined.m.n} positions · <Net v={combined.m.net} cur={combined.m.currency} /></small></button>
              : <div className="ws-item all disabled" aria-disabled="true"><b>All files</b><small>{files.length < 2 ? 'Add another file to compare' : 'Needs 2 readable files'}</small></div>)}
            {files.map((f, i) => {
              const fr = fileReport(i);
              return (
                <button key={f.id} className={`ws-item${fr ? '' : ' warn'}`} role="tab" aria-selected={view === i} title={f.name} onClick={() => setView(i)}>
                  <b>{f.name}</b>
                  <small>{fr ? <>{fr.m.n} positions · <Net v={fr.m.net} cur={fr.m.currency} /></> : 'No closed trades found'}</small>
                  {files.length > 1 && (
                    <span className="ws-x" role="button" tabIndex={0} aria-label={'Remove ' + f.name}
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeFile(i); } }}>×</span>
                  )}
                </button>
              );
            })}
            {Array.from({ length: addSlots }, (_, k) => (
              <button key={'add' + k} className="ws-add" aria-label="Add a file" onClick={() => {
                if (placesUsed >= placesTotal) { setLock({ title: 'No file places left', text: filesFullText(placesTotal) }); return; }
                if (files.some((f) => !f.stored)) { setLock({ title: 'Files can’t be added', text: 'The statements in this report were deleted after 30 days, so new files can’t be added to it. Start a new report instead.' }); return; }
                addInput.current?.click();
              }}><i>+</i>Add statement</button>
            ))}
          </div>
          <input ref={addInput} type="file" accept={ACCEPTED_EXT.join(',')} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) addFile(f); }} />
          <p className="ws-side-note"><span className="ws-used">Statements in this report: <b>{placesUsed} of {placesTotal}</b></span><br />One statement = one P&amp;L or tradebook file from your broker. Removing one doesn&apos;t free its place.</p>
          <div className="ws-side-h ws-hist-h">Your reports</div>
          <div id="historyList"><History reports={reports} currentId={current.id} /></div>
        </aside>
        <div className="ws-main">
          <div className="report-head">
            <div>
              <h1 className="page-title">{title}</h1>
              <div className="muted" style={{ fontSize: 13 }} suppressHydrationWarning>{meta}</div>
            </div>
            <div className="actions">
              <button className="btn ghost" onClick={exportCsv} disabled={!r}>CSV</button>
              <button className="btn ghost" onClick={() => window.print()}>PDF</button>
              <button className="btn ghost" onClick={remove}>Delete</button>
            </div>
          </div>
          {!r && slot && (
            <div className="panel" id="slotEmpty">
              <h3>No closed trades found in <span>{slot.name}</span></h3>
              <p className="muted" style={{ margin: '6px 0 10px' }}>This file doesn&apos;t contain any completed trades for PnL Lens to analyse. Usually that means:</p>
              <ul className="ws-reasons">
                <li>The date range had only open positions, or no trading at all</li>
                <li>It&apos;s a holdings, ledger or contract-note export rather than a P&amp;L statement or tradebook</li>
                <li>It&apos;s a scanned PDF (an image with no readable text)</li>
              </ul>
              <p className="muted" style={{ marginTop: 10 }}>Download the <b>P&amp;L statement</b> or <b>tradebook</b> for a period with closed trades, then add it with <b>+</b>. You can remove this file with <b>×</b>.</p>
            </div>
          )}
          <div ref={root} id="reportRoot" hidden={!r}>
            <nav className="tabs" role="tablist">
              {TABS.map(([id, label]) => <button key={id} role="tab" data-tab={id} aria-selected={id === 'overview'}>{label}</button>)}
            </nav>
            {TABS.map(([id]) => <section key={id} id={id} className={`tab${id === 'overview' ? '' : ' hide'}`} />)}
          </div>
        </div>
      </div>
    </section>
  );
}
