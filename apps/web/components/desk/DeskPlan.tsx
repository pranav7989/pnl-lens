/**
 * @file  apps/web/components/desk/DeskPlan.tsx
 * @area  Pages
 * @what  Desk "Trade plan for the day" (Trade Check phase 2): type a line, see it read back and checked as you type (✕ your rules, ! / ✓ your history, from the same check() the API stores), add it; per line Edit / Remove / Keep anyway (with a reason); your rules with "Suggested from your trades" to accept or ignore; the pre-trade checklist.
 */
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseLine, formatLine, type ParsedLine } from '@pnl-lens/shared/plan/parse';
import { checkDay, type CheckContextData, type CheckResult, type Chip } from '@pnl-lens/shared/plan/check';
import { api, type ApiError } from '@/lib/api-browser';

interface Line { id: number; position: number; raw_text: string; parsed: ParsedLine; check_result: CheckResult; decision: 'edited' | 'removed' | 'kept' | null; keep_reason: string | null }
interface Rule { id: number; kind: string; params: any; label: string }
interface Suggestion { key: string; kind: string; params: any; label: string; why: string; needs?: 'amount' }
export interface DeskPlanData {
  context: CheckContextData; lines: Line[]; checklist: { text: string; done: boolean }[]; rules: Rule[]; suggestions: Suggestion[];
  checkedAgainst: string | null; unlockTime: string | null; disclaimer: string;
}

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
    const all = [...d.lines.map((l) => ({ parsed: l.parsed, removed: l.decision === 'removed' })), { parsed, removed: false }];
    return { parsed, result: checkDay(all, d.context)[all.length - 1] };
  }, [draft, d]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg('');
    try { await fn(); } catch (e) { setMsg((e as ApiError).message); } finally { setBusy(false); }
  };
  const reload = async () => setD(await api<DeskPlanData>(`/desk/context?date=${date}`));
  const add = () => run(async () => {
    const r = await api<{ lines: Line[] }>(`/desk/plans/${date}/lines`, { body: { text } });
    setD({ ...d, lines: r.lines }); setText(''); setDraft('');
  });
  const decide = (id: number, decision: 'removed' | 'kept', reason?: string) => run(async () => {
    const r = await api<{ lines: Line[] }>(`/desk/lines/${id}/decision`, { method: 'PATCH', body: { decision, reason } });
    setD({ ...d, lines: r.lines }); setKeeping(null);
  });
  const saveEdit = () => editing && run(async () => {
    const r = await api<{ lines: Line[] }>(`/desk/lines/${editing.id}`, { method: 'PATCH', body: { text: editing.text } });
    setD({ ...d, lines: r.lines }); setEditing(null);
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
  const live = d.lines.filter((l) => l.decision !== 'removed');

  return (
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
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="muted small tc-count">{live.length} line{live.length === 1 ? '' : 's'} planned</p>

      <div className="tc-check" data-desk-checklist>
        <span className="tc-k">Before the open</span>
        {d.checklist.map((c, i) => (
          <label key={c.text} className="tc-tick"><input type="checkbox" checked={c.done} onChange={() => tick(i)} />{c.text}</label>
        ))}
      </div>
      {d.unlockTime && <p className="muted small">{d.unlockTime}</p>}
      <p className="desk-wo-foot">{d.disclaimer}</p>
    </section>
  );
}
