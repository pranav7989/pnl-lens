import type { ReportV1 } from '@pnl-lens/engine/types';
/** [name, lowest score, highest score] per level, mirroring the engine's thresholds. */
export const LEVEL_RANGES: [string, number, number][];
export function ladderHtml(index: number): string;
/** drill-down rules: does trade t belong to the cluster row with this key (mirrors the engine buckets) */
export const DRILL: Record<'group' | 'underlying' | 'weekday' | 'expiryType' | 'callPut' | 'style' | 'entryDow' | 'month' | 'direction', (t: any, key: string) => boolean>;
export function mountReport(
  root: HTMLElement,
  report: ReportV1,
  fmt: { inr: (v: number) => string; pct: (v: number, d?: number) => string; history?: { savedAt: string; to?: string | null; score: number; label: string }[];
    /** where check-ups are kept: 'on this device' (offline tool, default) or 'in your account' (website) */
    historyWhere?: string;
    /** REQ-2 "What's next" card (website): the journey's next action */
    next?: { kind: 'upgrade' | 'checkup'; text: string; cta: string; href: string };
    /** 30-day plan check-up (website): the last plan scored on this report, shown first in Progress */
    planCheck?: import('../../components/workspace/model').PlanCheckView | null }
): { show: (tab: string) => void; destroy: () => void };
