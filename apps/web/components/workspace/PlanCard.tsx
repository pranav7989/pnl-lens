/**
 * @file  apps/web/components/workspace/PlanCard.tsx
 * @area  Reports
 * @what  Plan card (sidebar) and plan strip (upload view): reports used, statements per report, valid till DD-MMM-YY — as in the offline tool.
 */
import { planName, expired, dateTag, reportsLeft, st, type PlanRow } from './model';

export function PlanCard({ plan }: { plan: PlanRow | null }) {
  if (!plan) return null;
  const pct = Math.min(100, (plan.reportsUsed / plan.reportsTotal) * 100), off = expired(plan);
  return (
    <div className="ws-plan">
      <div className="ws-plan-top"><b>{planName(plan.planId)} plan</b></div>
      <div className="ws-plan-bar"><i style={{ width: pct + '%' }} /></div>
      <div className="ws-plan-sub">
        <span><b>{plan.reportsUsed}</b> of {plan.reportsTotal} report{plan.reportsTotal === 1 ? '' : 's'} used</span>
        <span className={off ? 'off' : 'till'} suppressHydrationWarning>{off ? 'Ended ' : 'Valid till '}{dateTag(plan.endsAt)}</span>
      </div>
    </div>
  );
}

export function PlanStrip({ plan }: { plan: PlanRow | null }) {
  if (!plan) return null;
  const off = expired(plan);
  return (
    <div className="up-plan">
      <b>{planName(plan.planId)} plan</b>
      <span>{reportsLeft(plan)} of {plan.reportsTotal} report{plan.reportsTotal === 1 ? '' : 's'} left</span>
      <span>Up to {st(plan.filesPerReport)} per report</span>
      <span suppressHydrationWarning>{off ? 'Ended ' : 'Valid till '}{dateTag(plan.endsAt)}</span>
    </div>
  );
}
