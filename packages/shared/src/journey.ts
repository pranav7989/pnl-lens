/**
 * @file  packages/shared/src/journey.ts
 * @area  Reports
 * @what  REQ-2 "trading journey": which of the 5 steps are done or locked, the score line and the next action, from real plans and saved reports only.
 */
/**
 * Pure and shared by the journey bar and the "What's next" card. Rules (owner spec, 15 Oct 2026):
 *  1 First report      — a report is saved                                  — all plans
 *  2 Baseline score    — that report has a habit score                      — all plans
 *  3 Month-2 check-up  — saved reports cover 2 different months             — Snapshot and above
 *  4 3-month trend     — saved reports cover 3 different months             — Progress and above
 *  5 12-month discipline — 6 or more months, or a 12-month (Discipline) plan — Discipline
 * A step counts as done only when its condition is really met AND the user's plan includes it; otherwise it shows the
 * plan that unlocks it. A report's month is the month of its last trade (`to`), else the month it was saved.
 */
import { PLANS, type PlanId } from './pricing';

export interface JourneyPlan { planId: string; active?: boolean; endsAt: string }
export interface JourneyReport { createdAt: string; to: string | null; progressScore: number | null }
export type StepId = 'first' | 'baseline' | 'month2' | 'trend3' | 'discipline12';
export interface JourneyStep { id: StepId; label: string; done: boolean; locked: boolean; unlock: { planId: PlanId; name: string; price: string } | null }
export interface Journey {
  steps: JourneyStep[]; done: number; total: number;
  /** best plan still within its validity, or null */
  tier: PlanId | null;
  months: number;
  score: { value: number; level: string; next: { name: string; gap: number } | null } | null;
  /** first step not done yet (for the one-line mobile view) */
  nextStep: JourneyStep | null;
  next: { kind: 'upgrade' | 'checkup'; text: string; cta: string; href: string; planId?: PlanId; date?: string };
}

const RANK: Record<PlanId, number> = { single: 1, snapshot: 2, progress: 3, discipline: 4 };
/** Same thresholds as the engine's buildProgress (engine unchanged; a test checks they match). */
export const LEVELS: [number, string][] = [[0, 'Building'], [40, 'Developing'], [55, 'Steady'], [70, 'Disciplined'], [85, 'Elite']];
const STEPS: { id: StepId; label: string; needs: PlanId | null }[] = [
  { id: 'first', label: 'First report', needs: null },
  { id: 'baseline', label: 'Baseline score', needs: null },
  { id: 'month2', label: 'Month-2 check-up', needs: 'snapshot' },
  { id: 'trend3', label: '3-month trend', needs: 'progress' },
  { id: 'discipline12', label: '12-month discipline', needs: 'discipline' },
];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** DD-MMM-YY, e.g. 14-NOV-26 (same style as the plan card). */
export const dateTag = (d: Date) => String(d.getDate()).padStart(2, '0') + '-' + MON[d.getMonth()] + '-' + String(d.getFullYear()).slice(2);

export function levelFor(score: number) {
  let i = 0; LEVELS.forEach(([at], k) => { if (score >= at) i = k; });
  const nx = LEVELS[i + 1];
  return { level: LEVELS[i][1], next: nx ? { name: nx[1], gap: nx[0] - score } : null };
}

export function journey(input: { plans: JourneyPlan[] | null; reports: JourneyReport[]; prices?: Partial<Record<PlanId, string>>; now?: Date }): Journey {
  const now = input.now ?? new Date();
  // a plan counts while it is valid, even with all its reports used (the API's `active` means "can create a report")
  const active = (input.plans || []).filter((p) => new Date(p.endsAt) > now && p.planId in RANK);
  const tier = active.reduce<PlanId | null>((best, p) => (!best || RANK[p.planId as PlanId] > RANK[best] ? (p.planId as PlanId) : best), null);
  const reports = [...input.reports].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const months = new Set(reports.map((r) => (r.to || r.createdAt).slice(0, 7))).size;
  const met: Record<StepId, boolean> = {
    first: reports.length >= 1,
    baseline: reports.some((r) => r.progressScore != null),
    month2: months >= 2,
    trend3: months >= 3,
    discipline12: months >= 6 || tier === 'discipline',
  };
  const steps = STEPS.map<JourneyStep>((s) => {
    const included = !s.needs || (!!tier && RANK[tier] >= RANK[s.needs]);
    const plan = s.needs ? PLANS.find((p) => p.id === s.needs)! : null;
    return { id: s.id, label: s.label, done: included && met[s.id], locked: !included,
      unlock: included || !plan ? null : { planId: plan.id, name: plan.name, price: input.prices?.[plan.id] ?? '' } };
  });
  const scored = [...reports].reverse().find((r) => r.progressScore != null);
  const score = scored ? (() => { const v = Math.round(scored.progressScore as number); return { value: v, ...levelFor(v) }; })() : null;
  const last = reports.at(-1);
  const paid = !!tier && RANK[tier] >= RANK.snapshot;
  const next: Journey['next'] = paid && last
    ? { kind: 'checkup', text: `Your next check-up: ${dateTag(new Date(new Date(last.createdAt).getTime() + 30 * 864e5))}`, cta: 'Upload next month’s statement', href: '/upload',
        date: new Date(new Date(last.createdAt).getTime() + 30 * 864e5).toISOString() }
    : { kind: 'upgrade', text: 'See if your score improves next month', cta: 'Upgrade to Snapshot', href: '/pricing?plan=snapshot&from=journey#plan-snapshot', planId: 'snapshot' };
  return { steps, done: steps.filter((s) => s.done).length, total: steps.length, tier, months, score, nextStep: steps.find((s) => !s.done) ?? null, next };
}

/** Where a locked step leads: the pricing page with that plan highlighted. */
export const unlockHref = (planId: PlanId) => `/pricing?plan=${planId}&from=journey#plan-${planId}`;
