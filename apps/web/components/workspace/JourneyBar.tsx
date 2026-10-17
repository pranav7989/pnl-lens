/**
 * @file  apps/web/components/workspace/JourneyBar.tsx
 * @area  Reports
 * @what  REQ-2 journey bar above the workspace and dashboard: 5 steps (done / locked with the unlocking plan), score line, next action; one line on phones.
 */
'use client';
import { useEffect, useState } from 'react';
import { journey, unlockHref, type JourneyPlan, type JourneyReport } from '@pnl-lens/shared/journey';
import type { PlanId } from '@pnl-lens/shared/pricing';

const KEY = 'pnllens.journey.collapsed';
const track = (name: string, props?: object) => {
  try { fetch('/api/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, props }), keepalive: true }).catch(() => {}); } catch { /* ignore */ }
};
const Lock = () => <svg className="jb-ic" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" /></svg>;
const Tick = () => <svg className="jb-ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" /></svg>;

export default function JourneyBar({ plans, reports, prices }: { plans: JourneyPlan[] | null; reports: JourneyReport[]; prices: Record<string, string> }) {
  const j = journey({ plans, reports, prices: prices as Partial<Record<PlanId, string>> });
  const [collapsed, setCollapsed] = useState(false);   // desktop: remembered on this device
  const [open, setOpen] = useState(false);             // phones: one line until tapped
  const show = reports.length > 0;

  useEffect(() => { try { setCollapsed(localStorage.getItem(KEY) === '1'); } catch { /* storage blocked */ } }, []);
  useEffect(() => { if (show) track('journey_bar_view', { plan: j.tier ?? 'none', done: j.done }); }, [show, j.tier, j.done]);
  if (!show) return null;

  const remember = (v: boolean) => { setCollapsed(v); try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } };
  const score = j.score;
  const line = `Journey ${j.done}/${j.total}${score ? ` · ${score.level} ${score.value}` : ''}${j.nextStep ? ` · Next: ${j.nextStep.label}` : ''}`;

  return (
    <section className={`jb${collapsed ? ' collapsed' : ''}${open ? ' open' : ''}`} aria-label="Your trading journey" data-journey>
      <button type="button" className="jb-line" aria-expanded={open || !collapsed} onClick={() => { if (collapsed) remember(false); setOpen(!open); }}>
        <span>{line}</span><i aria-hidden="true">›</i>
      </button>
      <div className="jb-full">
        <div className="jb-head">
          <b>Your trading journey</b>
          <span className="jb-count">{j.done} of {j.total} steps</span>
          <button type="button" className="jb-hide" onClick={() => { remember(true); setOpen(false); }}>Hide</button>
        </div>
        <div className="jb-track" aria-hidden="true"><i style={{ width: `${(j.done / j.total) * 100}%` }} /></div>
        <ol className="jb-steps">
          {j.steps.map((s) => (
            <li key={s.id} className={s.done ? 'done' : s.locked ? 'locked' : 'open'}>
              {s.locked && s.unlock
                ? <a href={unlockHref(s.unlock.planId)} onClick={() => track('journey_step_click', { step: s.id, plan: s.unlock!.planId, from: j.tier ?? 'none' })}>
                    <Lock /><span>{s.label}</span><small>{s.unlock.name}{s.unlock.price ? ` ${s.unlock.price}` : ''}</small></a>
                : <span className="jb-st">{s.done ? <Tick /> : <i className="jb-dot" aria-hidden="true" />}<span>{s.label}</span>{s.done && <span className="sr-only"> (done)</span>}</span>}
            </li>
          ))}
        </ol>
        <div className="jb-foot">
          {score && <p className="jb-score"><b>{score.level}</b> · {score.value}/100{score.next ? <> · {score.next.gap} point{score.next.gap === 1 ? '' : 's'} to {score.next.name}</> : ' · top level'}</p>}
          <p className="jb-next">{j.next.text}</p>
          <a className="btn jb-cta" href={j.next.href} onClick={() => track('journey_next_action_click', { kind: j.next.kind, plan: j.tier ?? 'none' })}>{j.next.cta} →</a>
        </div>
      </div>
    </section>
  );
}
