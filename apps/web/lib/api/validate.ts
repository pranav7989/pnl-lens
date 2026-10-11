/**
 * @file  apps/web/lib/api/validate.ts
 * @area  Reports
 * @what  Validates report JSON posted by the browser before it is stored.
 */
import { MAX_FILES, MAX_REPORT_BYTES } from '@pnl-lens/shared/limits';
import type { ReportV1 } from '@pnl-lens/engine/types';

export interface CreateReportBody { report: ReportV1; fileNames: string[]; fileHashes: string[] }

/** Structural validation of the client-produced report. The engine runs client-side, so treat input as untrusted. */
export function validateCreateReport(raw: string): { ok: true; body: CreateReportBody } | { ok: false; error: string } {
  if (raw.length > MAX_REPORT_BYTES) return { ok: false, error: 'report_too_large' };
  let b: any;
  try { b = JSON.parse(raw); } catch { return { ok: false, error: 'invalid_json' }; }
  const r = b?.report;
  if (!r || r.version !== 1) return { ok: false, error: 'unsupported_report_version' };
  if (!r.m || typeof r.m.n !== 'number' || r.m.n < 1) return { ok: false, error: 'no_trades' };
  if (typeof r.m.net !== 'number' || !isFinite(r.m.net)) return { ok: false, error: 'invalid_metrics' };
  if (!Array.isArray(r.trades) || r.trades.length !== r.m.n) return { ok: false, error: 'trade_count_mismatch' };
  for (const k of ['b', 'leaks', 'rules', 'patterns', 'strengths']) if (r[k] == null) return { ok: false, error: `missing_${k}` };
  if (!Array.isArray(b.fileNames) || b.fileNames.length < 1 || b.fileNames.length > MAX_FILES) return { ok: false, error: 'file_count' };
  if (!Array.isArray(b.fileHashes) || b.fileHashes.length !== b.fileNames.length) return { ok: false, error: 'file_hashes' };
  if (!b.fileNames.every((n: unknown) => typeof n === 'string' && n.length > 0 && n.length <= 200)) return { ok: false, error: 'file_names' };
  if (!b.fileHashes.every((h: unknown) => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h))) return { ok: false, error: 'file_hashes' };
  if (typeof r.m.currency !== 'string' || !/^[A-Z]{3,4}$/.test(r.m.currency)) return { ok: false, error: 'currency' };
  return { ok: true, body: { report: r, fileNames: b.fileNames, fileHashes: b.fileHashes } };
}
