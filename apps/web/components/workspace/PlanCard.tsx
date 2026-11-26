/**
 * @file  apps/web/components/workspace/PlanCard.tsx
 * @area  Reports
 * @what  Plan card (sidebar) and plan strip (upload view): "Snapshot · 2 of 5 reports used · use by 19-Jan-27", statements per report (credits spec wording).
 */
import { planName, expired, dateTag, st, type PlanRow } from './model';

export function PlanCard({ plan }: { plan: PlanRow | null }) {
  if (!plan) return null;
  const pct = Math.min(100, (plan.reportsUsed / plan.reportsTotal) * 100), off = expired(plan);
  return (
    <div className="ws-plan">
      <p className="ws-plan-line" suppressHydrationWarning>
        <b>{planName(plan.planId)}</b> · {plan.reportsUsed} of {plan.reportsTotal} report{plan.reportsTotal === 1 ? '' : 's'} used · <span className={off ? 'off' : ''}>{off ? 'ended ' : 'use by '}{dateTag(plan.endsAt)}</span>
      </p>
      <div className="ws-plan-bar"><i style={{ width: pct + '%' }} /></div>
    </div>
  );
}

export function PlanStrip({ plan }: { plan: PlanRow | null }) {
  if (!plan) return null;
  const off = expired(plan);
  return (
    <div className="up-plan">
      <b>{planName(plan.planId)}</b>
      <span>{plan.reportsUsed} of {plan.reportsTotal} report{plan.reportsTotal === 1 ? '' : 's'} used</span>
      <span>Up to {st(plan.filesPerReport)} per report</span>
      <span suppressHydrationWarning>{off ? 'ended ' : 'use by '}{dateTag(plan.endsAt)}</span>
    </div>
  );
}
