import type { ReportV1 } from '@pnl-lens/engine/types';
/** [name, lowest score, highest score] per level, mirroring the engine's thresholds. */
export const LEVEL_RANGES: [string, number, number][];
export function ladderHtml(index: number): string;
export function mountReport(
  root: HTMLElement,
  report: ReportV1,
  fmt: { inr: (v: number) => string; pct: (v: number, d?: number) => string; history?: { savedAt: string; to?: string | null; score: number; label: string }[];
    /** where check-ups are kept: 'on this device' (offline tool, default) or 'in your account' (website) */
    historyWhere?: string }
): { show: (tab: string) => void; destroy: () => void };
