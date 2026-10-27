/**
 * @file  apps/web/components/workspace/model.ts
 * @area  Reports
 * @what  Workspace data types (from the API) and the offline tool's wording, labels and plan rules, kept word for word.
 */
import { CONSENT_TEXT } from '@pnl-lens/shared/consent-text';
import { PLANS } from '@pnl-lens/shared/pricing';

export interface PlanRow { id: string; planId: string; reportsTotal: number; reportsUsed: number; filesPerReport: number; startsAt: string; endsAt: string; active: boolean }
export interface HistoryItem { id: string; title: string | null; monthLabel: string | null; createdAt: string; fileNames: string[]; progressScore: number | null; to: string | null;
  tradeCount?: number; netPnl?: number; currency?: string | null; market?: string | null }
/** A report's display name: its title, or "Report · 12 Oct 2026" when it has none. */
export const reportName = (r: { title: string | null; createdAt: string }) =>
  r.title || 'Report · ' + new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
export interface FileTab { id: string; name: string; position: number; stored: boolean; report: any | null }
/** 30-day plan check-up from the API (packages/shared/src/plan/score.ts PlanCheck + where the plan came from) */
export interface PlanCheckView {
  generatedOn: string; checkupOn: string; scope: 'since' | 'all'; trades: number; met: number; measured: number;
  fromReportId: string | null; fromReportName: string | null;
  items: { id: string; kind: 'do' | 'dont'; title: string; habit: string; before: string; target: string; now: string | null; met: boolean | null }[];
}
export interface CurrentReport { id: string; createdAt: string; title: string | null; report: any; files: FileTab[]; places: { total: number; used: number }; planCheck?: PlanCheckView | null }

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const monthTag = (d: string) => { const x = new Date(d); return MON[x.getMonth()] + '-' + String(x.getFullYear()).slice(2); };
/** Plan end date as DD-MMM-YY, e.g. 14-JAN-27 (REQ-3). */
/** "19-Jan-27" (credits spec wording for plan dates). */
export const dateTag = (d: string) => { const x = new Date(d), m = MON[x.getMonth()]; return String(x.getDate()).padStart(2, '0') + '-' + m.charAt(0) + m.slice(1).toLowerCase() + '-' + String(x.getFullYear()).slice(2); };
export const dayLabel = (d: string) => { const x = new Date(d); return x.getDate() + ' ' + MON[x.getMonth()].charAt(0) + MON[x.getMonth()].slice(1).toLowerCase(); };
export const planName = (id: string) => PLANS.find((p) => p.id === id)?.name ?? id;
export const expired = (p: PlanRow | null) => !p || new Date(p.endsAt).getTime() < Date.now();
export const st = (k: number) => k + ' broker statement' + (k === 1 ? '' : 's');

/** The plan the next report will use (as create_report_from_analysis picks it): active with reports left, ending first;
 *  else the soonest-ending active one; else the latest one (credits spec rule 6). */
export function currentPlan(plans: PlanRow[] | null): PlanRow | null {
  if (!plans?.length) return null;
  const active = plans.filter((p) => p.active).sort((a, b) => a.endsAt.localeCompare(b.endsAt));
  return active.find((p) => p.reportsUsed < p.reportsTotal) ?? active[0] ?? [...plans].sort((a, b) => b.endsAt.localeCompare(a.endsAt))[0];
}
export const reportsLeft = (p: PlanRow | null) => (p ? Math.max(0, p.reportsTotal - p.reportsUsed) : 0);

/* Offline tool texts (apps/web/offline/app_offline.js), except the plan texts (credits spec). */
/** Credits spec wording (19 Oct 2026). */
export const planEndedText = (p: PlanRow) => expired(p)
  ? 'Your ' + planName(p.planId) + ' plan ended on ' + dateTag(p.endsAt) + '. Your reports are still here. Choose a plan to create new ones.'
  : 'You’ve used all ' + p.reportsTotal + ' report' + (p.reportsTotal === 1 ? '' : 's') + ' in your ' + planName(p.planId) + ' plan. Your reports are still here. Choose a plan to create new ones.';
export const filesFullText = (files: number) => 'This report already holds its ' + files + ' broker statement' + (files === 1 ? '' : 's') + '. You can re-open a statement already in this report, or start a new report.';

/* Approved wording (plan §2.1): W5 upload line; consent wording updated by the owner on 22 Oct 2026. */
export const UPLOAD_SUB = 'Your files are encrypted, processed on our secure servers, and deleted automatically after 30 days. You can delete them anytime.';
/* Consent sentences come from the one shared source (the server stores the hash of these exact words). */
export const CONSENT_PROCESSING = CONSENT_TEXT.processing;
export const CONSENT_RESEARCH = CONSENT_TEXT.research;
