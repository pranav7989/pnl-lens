/**
 * @file  apps/web/components/desk/DeskPlan.tsx
 * @area  Pages
 * @what  Desk "Trade plan for the day" (Trade Check phases 2–3): type a line, see it read back and checked as you type (✕ your rules, ! / ✓ your history, from the same check() the API stores), add it; per line Edit / Remove / Keep anyway (with a reason) and Taken / Not taken with the result (or matched from your tradebook); trades not in the plan; your rules and suggestions; the checklist; the "Plan vs actual" card.
 */
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseLine, formatLine, type ParsedLine } from '@pnl-lens/shared/plan/parse';
import { checkDay, type CheckContextData, type CheckResult, type Chip } from '@pnl-lens/shared/plan/check';
import { outcomeOf, type Outcome } from '@pnl-lens/shared/plan/actuals';
import { api, type ApiError } from '@/lib/api-browser';

interface Line { id: number; position: number; raw_text: string; parsed: ParsedLine; check_result: CheckResult; decision: 'edited' | 'removed' | 'kept' | null; keep_reason: string | null; created_at: string; outcome: Outcome | null }
interface Score { date: string; planned: number; taken: number; not_taken: number; unmarked: number; off_plan: number; on_plan_pnl: number; off_plan_pnl: number; rules_kept: number; rules_total: number; source: 'journal' | 'tradebook' }
interface JournalTrade { id: number; raw_text: string; pnl: number | null }
interface Rule { id: number; kind: string; params: any; label: string }
interface Suggestion { key: string; kind: string; params: any; label: string; why: string; needs?: 'amount' }
export interface DeskPlanData {
  context: CheckContextData; lines: Line[]; checklist: { text: string; done: boolean }[]; rules: Rule[]; suggestions: Suggestion[];
  checkedAgainst: string | null; unlockTime: string | null; disclaimer: string;
  journal: JournalTrade[]; score: Score | null; history: Score[];
}

const inr = (x: number) => `${x < 0 ? '−' : x > 0 ? '+' : ''}₹${Math.abs(Math.round(x)).toLocaleString('en-IN')}`;
const tone = (x: number) => (x > 0 ? 'gain' : x < 0 ? 'loss' : '');
/** a line as checkDay() needs it (the same as the API: when it was written, taken at a loss) */
const dayInput = (l: Line) => { const o = outcomeOf(l.outcome); return { parsed: l.parsed, removed: l.decision === 'removed', createdAt: new Date(l.created_at).toISOString(), lost: o.taken === true && (o.pnl ?? 0) < 0 }; };

const MARK: Record<Chip['level'], string> = { block: '✕', caution: '!', strength: '✓', info: 'i' };
function Chips({ chips }: { chips: Chip[] }) {
  if (!chips.length) return null;
  return (
    <ul className="tc-chips">
      {chips.map((c) => <li key={c.key} className={`tc-chip ${c.level}`} data-chip={c.level}><b aria-hidden="true">{MARK[c.level]}</b><span>{c.text}</span></li>)}
    </ul>
  );
}

export default function DeskPlan({ initial }: { initial: DeskPlanData }) {
  const [d, setD] = useState(initial);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [keeping, setKeeping] = useState<{ id: number; reason: string } | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const date = d.context.date;

  // check as you type, 300 ms after the last key (doc §8)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { clearTimeout(timer.current); timer.current = setTimeout(() => setDraft(text), 300); return () => clearTimeout(timer.current); }, [text]);
  const preview = useMemo(() => {
    if (!draft.trim()) return null;
    const parsed = parseLine(draft);
    if (!parsed.ok) return { parsed, result: null };
    const all = [...d.lines.map(dayInput), { parsed, removed: false }];
    return { parsed, result: checkDay(all, d.context)[all.length - 1] };
  }, [draft, d]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg('');
    try { await fn(); } catch (e) { setMsg((e as ApiError).message); } finally { setBusy(false); }
  };
  const reload = async () => setD(await api<DeskPlanData>(`/desk/context?date=${date}`));
  const add = () => run(async () => {
    await api(`/desk/plans/${date}/lines`, { body: { text } });
    await reload(); setText(''); setDraft('');
  });
  const decide = (id: number, decision: 'removed' | 'kept', reason?: string) => run(async () => {
    await api(`/desk/lines/${id}/decision`, { method: 'PATCH', body: { decision, reason } });
    await reload(); setKeeping(null);
  });
  const saveEdit = () => editing && run(async () => {
    await api(`/desk/lines/${editing.id}`, { method: 'PATCH', body: { text: editing.text } });
    await reload(); setEditing(null);
  });
  const accept = (s: Suggestion) => run(async () => {
    const params = s.needs === 'amount' ? { amount: Number(amounts[s.key]) } : s.params;
    await api('/desk/rules', { body: { kind: s.kind, params, source: 'suggested', suggestion: s.key } });
    await reload();
  });
  const ignore = (s: Suggestion) => run(async () => { await api('/desk/rules/dismiss', { body: { kind: s.kind, params: s.needs === 'amount' ? { amount: 1 } : s.params, suggestion: s.key } }); await reload(); });
  const ruleOff = (r: Rule) => run(async () => { await api(`/desk/rules/${r.id}`, { method: 'PATCH', body: { active: false } }); await reload(); });
  const tick = (i: number) => run(async () => {
    const items = d.checklist.map((c, k) => (k === i ? { ...c, done: !c.done } : c));
    setD({ ...d, checklist: items });
    await api(`/desk/checklist/${date}`, { method: 'PUT', body: { items } });
  });
  const [result, setResult] = useState<{ id: number; pnl: string } | null>(null);
  const [jText, setJText] = useState(''), [jPnl, setJPnl] = useState('');
  const mark = (id: number, taken: boolean | null, pnl?: number | null) => run(async () => {
    await api(`/desk/lines/${id}/outcome`, { method: 'PATCH', body: { taken, pnl: pnl ?? null } }); await reload(); setResult(null);
  });
  const num = (v: string) => { const n = Number(v.replace(/[,₹\s]/g, '').replace(/^−/, '-')); return v.trim() !== '' && Number.isFinite(n) ? n : null; };
  const logTrade = () => run(async () => { await api(`/desk/journal/${date}`, { body: { text: jText, pnl: num(jPnl) } }); await reload(); setJText(''); setJPnl(''); });
  const unlog = (id: number) => run(async () => { await api(`/desk/journal/${id}`, { method: 'DELETE' }); await reload(); });
  const live = d.lines.filter((l) => l.decision !== 'removed');

  return (
    <>
    <section className="panel tc" aria-labelledby="tc-h" data-desk-plan>
      <div className="rv-ph"><h3 id="tc-h">Trade plan for the day</h3>{d.checkedAgainst && <small>{d.checkedAgainst}</small>}</div>

      <div className="tc-rules" data-desk-rules>
        <span className="tc-k">Your rules</span>
        {d.rules.length ? d.rules.map((r) => (
          <span key={r.id} className="tc-rule">{r.label}<button type="button" aria-label={`Switch off: ${r.label}`} onClick={() => ruleOff(r)} disabled={busy}>×</button></span>
        )) : <span className="muted small">None yet: accept a suggestion below.</span>}
      </div>
      {d.suggestions.length > 0 && (
        <div className="tc-sugg" data-desk-suggestions>
          <span className="tc-k">Suggested from your trades</span>
          <ul>
            {d.suggestions.map((s) => (
              <li key={s.key} data-suggestion={s.key}>
                <div><b>{s.label}</b><span className="muted small">{s.why}</span></div>
                <div className="tc-sugg-act">
                  {s.needs === 'amount' && <input className="field" inputMode="decimal" aria-label="Daily loss limit (₹)" placeholder="₹ amount" value={amounts[s.key] ?? ''} onChange={(e) => setAmounts({ ...amounts, [s.key]: e.target.value })} />}
                  <button type="button" className="btn ghost" onClick={() => accept(s)} disabled={busy || (s.needs === 'amount' && !(Number(amounts[s.key]) > 0))}>Accept</button>
                  <button type="button" className="btn ghost tc-quiet" onClick={() => ignore(s)} disabled={busy}>Ignore</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="tc-input" onSubmit={(e) => { e.preventDefault(); if (preview?.parsed.ok) add(); }}>
        <label className="field-label" htmlFor="tc-line">Write a line</label>
        <div className="tc-row">
          <input id="tc-line" className="field" autoComplete="off" spellCheck={false} placeholder="e.g. NIFTY 24300 CE buy 120, SL 90, target 170, 1 lot" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn" disabled={busy || !preview?.parsed.ok}>Add</button>
        </div>
        {preview && (
          <div className="tc-preview" data-desk-preview>
            {preview.parsed.ok ? <p className="tc-read">{formatLine(preview.parsed)}</p>
              : <ul className="tc-errors">{preview.parsed.errors.map((e) => <li key={e.field + e.message} data-field={e.field}>{e.message}</li>)}</ul>}
            {preview.result && <Chips chips={preview.result.chips} />}
          </div>
        )}
      </form>
      {msg && <p className="status err" role="status">{msg}</p>}

      {d.lines.length > 0 && (
        <ol className="tc-lines">
          {d.lines.map((l) => (
            <li key={l.id} className={l.decision === 'removed' ? 'removed' : ''} data-line={l.id}>
              {editing?.id === l.id ? (
                <form className="tc-row" onSubmit={(e) => { e.preventDefault(); saveEdit(); }}>
                  <input className="field" aria-label="Edit line" value={editing.text} onChange={(e) => setEditing({ id: l.id, text: e.target.value })} />
                  <button type="submit" className="btn" disabled={busy || !parseLine(editing.text).ok}>Save</button>
                  <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <div className="tc-line-head">
                    <span className="tc-line-text">{formatLine(l.parsed)}</span>
                    {l.decision === 'kept' && <span className="tc-badge">Kept: {l.keep_reason}</span>}
                    {l.decision === 'edited' && <span className="tc-badge">Edited</span>}
                    {l.decision === 'removed' && <span className="tc-badge">Removed</span>}
                  </div>
                  {l.decision !== 'removed' && <Chips chips={l.check_result.chips} />}
                  {l.decision !== 'removed' && (
                    keeping?.id === l.id ? (
                      <form className="tc-row" onSubmit={(e) => { e.preventDefault(); decide(l.id, 'kept', keeping.reason); }}>
                        <input className="field" aria-label="Why keep it" placeholder="One line on why you are keeping it" value={keeping.reason} onChange={(e) => setKeeping({ id: l.id, reason: e.target.value })} />
                        <button type="submit" className="btn" disabled={busy || keeping.reason.trim().length < 3}>Keep</button>
                        <button type="button" className="btn ghost" onClick={() => setKeeping(null)}>Cancel</button>
                      </form>
                    ) : (
                      <div className="tc-act">
                        <button type="button" className="btn ghost" onClick={() => setEditing({ id: l.id, text: l.raw_text })}>Edit line</button>
                        <button type="button" className="btn ghost" onClick={() => decide(l.id, 'removed')} disabled={busy}>Remove</button>
                        {l.decision !== 'kept' && l.check_result.chips.some((c) => c.level === 'block' || c.level === 'caution') &&
                          <button type="button" className="btn ghost" onClick={() => setKeeping({ id: l.id, reason: '' })}>Keep anyway</button>}
                      </div>
                    )
                  )}
                  {l.decision !== 'removed' && <Outcome line={l} busy={busy} editing={result?.id === l.id ? result : null} setEditing={setResult} mark={mark} num={num} />}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="muted small tc-count">{live.length} line{live.length === 1 ? '' : 's'} planned</p>

      <div className="tc-journal" data-desk-journal>
        <span className="tc-k">Trades not in the plan</span>
        {d.journal.length > 0 && (
          <ul>{d.journal.map((j) => (
            <li key={j.id}><span>{j.raw_text}</span>{j.pnl != null && <b className={tone(j.pnl)}>{inr(j.pnl)}</b>}
              <button type="button" aria-label={`Remove: ${j.raw_text}`} onClick={() => unlog(j.id)} disabled={busy}>×</button></li>
          ))}</ul>
        )}
        <form className="tc-row" onSubmit={(e) => { e.preventDefault(); logTrade(); }}>
          <input className="field" aria-label="Trade not in the plan" placeholder="e.g. BANKNIFTY 52000 PE buy 300 1 lot" value={jText} onChange={(e) => setJText(e.target.value)} />
          <input className="field tc-pnl" aria-label="Result (₹)" inputMode="decimal" placeholder="Result ₹" value={jPnl} onChange={(e) => setJPnl(e.target.value)} />
          <button type="submit" className="btn ghost" disabled={busy || !jText.trim()}>Log</button>
        </form>
      </div>

      <div className="tc-check" data-desk-checklist>
        <span className="tc-k">Before the open</span>
        {d.checklist.map((c, i) => (
          <label key={c.text} className="tc-tick"><input type="checkbox" checked={c.done} onChange={() => tick(i)} />{c.text}</label>
        ))}
      </div>
      {d.unlockTime && <p className="muted small">{d.unlockTime}</p>}
      <p className="desk-wo-foot">{d.disclaimer}</p>
    </section>
    <PlanVsActual score={d.score} history={d.history} time={d.context.time} />
    </>
  );
}

function Outcome({ line, busy, editing, setEditing, mark, num }: { line: Line; busy: boolean; editing: { id: number; pnl: string } | null;
  setEditing: (v: { id: number; pnl: string } | null) => void; mark: (id: number, taken: boolean | null, pnl?: number | null) => void; num: (v: string) => number | null }) {
  const o = outcomeOf(line.outcome);
  if (o.from === 'tradebook') return <p className="tc-out" data-outcome="tradebook">Taken · <b className={tone(o.pnl ?? 0)}>{inr(o.pnl ?? 0)}</b> · from your tradebook</p>;
  if (editing) {
    return (
      <form className="tc-row tc-out" onSubmit={(e) => { e.preventDefault(); mark(line.id, true, num(editing.pnl)); }}>
        <input className="field tc-pnl" aria-label="Result (₹)" inputMode="decimal" placeholder="Result ₹, e.g. -1200" value={editing.pnl} onChange={(e) => setEditing({ id: line.id, pnl: e.target.value })} />
        <button type="submit" className="btn" disabled={busy}>Save</button>
        <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
      </form>
    );
  }
  return (
    <div className="tc-out" data-outcome={o.taken == null ? 'none' : o.taken ? 'taken' : 'not_taken'}>
      {o.taken === true && <span>Taken{o.pnl != null && <> · <b className={tone(o.pnl)}>{inr(o.pnl)}</b></>}</span>}
      {o.taken === false && <span>Not taken</span>}
      <button type="button" className="btn ghost" onClick={() => setEditing({ id: line.id, pnl: o.pnl != null ? String(o.pnl) : '' })} disabled={busy}>{o.taken ? 'Change result' : 'Taken'}</button>
      {o.taken !== false && <button type="button" className="btn ghost" onClick={() => mark(line.id, false)} disabled={busy}>Not taken</button>}
    </div>
  );
}

function PlanVsActual({ score, history, time }: { score: Score | null; history: Score[]; time: string }) {
  const all = history;
  const sum = (f: (h: Score) => number) => all.reduce((n, h) => n + f(h), 0);
  const kept = sum((h) => h.rules_kept), total = sum((h) => h.rules_total);
  return (
    <section className="panel pva" aria-labelledby="pva-h" data-desk-pva>
      <div className="rv-ph"><h3 id="pva-h">Plan vs actual</h3><small>{time >= '15:30' ? 'Today' : 'So far today'}{score?.source === 'tradebook' ? ' · from your tradebook' : ''}</small></div>
      {score ? (
        <div className="pva-tiles">
          <div><span>Planned</span><b>{score.planned}</b></div>
          <div><span>Taken</span><b>{score.taken}</b><small>{score.not_taken} not taken{score.unmarked ? ` · ${score.unmarked} not marked` : ''}</small></div>
          <div><span>Not in the plan</span><b>{score.off_plan}</b></div>
          <div><span>On-plan P&amp;L</span><b className={tone(score.on_plan_pnl)}>{inr(score.on_plan_pnl)}</b></div>
          <div><span>Off-plan P&amp;L</span><b className={tone(score.off_plan_pnl)}>{inr(score.off_plan_pnl)}</b></div>
          <div><span>Rules kept</span><b>{score.rules_total ? `${score.rules_kept}/${score.rules_total}` : '—'}</b><small>of the lines taken</small></div>
        </div>
      ) : <p className="muted small">Mark your lines taken or not taken to see today&apos;s plan vs actual.</p>}
      {all.length > 1 && (
        <p className="muted small pva-30" data-desk-pva-30>
          Last 30 days: {all.length} days planned · rules kept {total ? `${Math.round((kept / total) * 100)}%` : '—'} of lines taken · on-plan <b className={tone(sum((h) => h.on_plan_pnl))}>{inr(sum((h) => h.on_plan_pnl))}</b> · off-plan <b className={tone(sum((h) => h.off_plan_pnl))}>{inr(sum((h) => h.off_plan_pnl))}</b>
        </p>
      )}
    </section>
  );
}
