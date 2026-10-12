/**
 * @file  apps/web/lib/workspace-data.ts
 * @area  Reports
 * @what  Server-side loaders for the workspace pages: my plans and my report history from the API, in the shapes the workspace uses.
 */
import { apiServer } from '@/lib/api-client';
import type { PlanRow, HistoryItem } from '@/components/workspace/model';

export async function loadPlans(): Promise<PlanRow[] | null> {
  const r = await apiServer<{ mine: PlanRow[] | null }>('/plans');
  return r.ok ? r.data.mine : null;
}

export async function loadHistory(): Promise<HistoryItem[]> {
  const r = await apiServer<{ reports: any[] }>('/reports');
  if (!r.ok) return [];
  return r.data.reports.map((x) => ({ id: x.id, title: x.title, monthLabel: x.monthLabel, createdAt: x.createdAt, fileNames: x.fileNames, progressScore: x.progressScore, to: x.to }));
}
