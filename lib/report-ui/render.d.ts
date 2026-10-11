import type { ReportV1 } from '@/lib/engine/types';
export function mountReport(
  root: HTMLElement,
  report: ReportV1,
  fmt: { inr: (v: number) => string; pct: (v: number, d?: number) => string; history?: { savedAt: string; to?: string | null; score: number; label: string }[] }
): { show: (tab: string) => void; destroy: () => void };
