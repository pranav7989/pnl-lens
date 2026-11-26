/**
 * @file  apps/web/lib/workspace-data.ts
 * @area  Reports
 * @what  Server-side loaders for the workspace pages: my plans and my report history from the API, in the shapes the workspace uses.
 */
import { apiServer } from '@/lib/api-client';
import type { PlanRow, HistoryItem } from '@/components/workspace/model';

export async function loadPlans(): Promise<PlanRow[] | null> {
  return (await loadPlanData()).plans;
}

/** My plans, plus each plan's price label for this visitor (the journey bar names the plan that unlocks a step). */
export async function loadPlanData(): Promise<{ plans: PlanRow[] | null; prices: Record<string, string> }> {
  const r = await apiServer<{ mine: PlanRow[] | null; plans: { id: string; price: { label: string } }[] }>('/plans');
  if (!r.ok) return { plans: null, prices: {} };
  return { plans: r.data.mine, prices: Object.fromEntries((r.data.plans || []).map((p) => [p.id, p.price.label])) };
}

export async function loadHistory(): Promise<HistoryItem[]> {
  const r = await apiServer<{ reports: any[] }>('/reports');
  if (!r.ok) return [];
  return r.data.reports.map((x) => ({ id: x.id, title: x.title, monthLabel: x.monthLabel, createdAt: x.createdAt, fileNames: x.fileNames, progressScore: x.progressScore, to: x.to,
    tradeCount: x.tradeCount, netPnl: x.netPnl, currency: x.currency, market: x.market }));
}
