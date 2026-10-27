/**
 * @file  packages/db/src/errors.ts
 * @area  Database
 * @what  Typed errors for the business-rule codes raised by the SQL functions (P0001 'no_plan', 'report_files_full', …).
 */

/** Every code the v2 SQL functions raise. The API maps each to the existing user-facing message. */
export const DB_ERROR_CODES = [
  // create_report_from_analysis / add_analysis_to_report
  'user_blocked', 'analysis_not_found', 'already_claimed', 'analysis_targets_report', 'analysis_targets_other_report',
  'analysis_not_ready', 'analysis_expired', 'report_not_found', 'report_locked', 'report_files_full',
  'no_plan', 'plan_expired', 'plan_used_up', 'too_many_files',
  // admin_grant_plan
  'forbidden', 'reason_required', 'unknown_user', 'invalid_plan',
  // 0019 blog (owner/admin publishing)
  'not_found', 'slug_taken', 'schedule_in_past', 'invalid_action',
  // 0025 research_lookup
  'export_required', 'invalid_code',
  // 0003 (old flow, still used by apps/web until the Phase 6 cutover)
  'no_credits',
] as const;
export type DbErrorCode = (typeof DB_ERROR_CODES)[number];

export class DbError extends Error {
  constructor(public readonly code: DbErrorCode) { super(code); this.name = 'DbError'; }
}

const KNOWN = new Set<string>(DB_ERROR_CODES);

/** Turn a pg error from one of our functions into a DbError; anything else is rethrown unchanged. */
export function rethrow(e: unknown): never {
  const err = e as { code?: string; message?: string };
  if ((err?.code === 'P0001' || err?.code === '42501') && err.message && KNOWN.has(err.message)) {
    throw new DbError(err.message as DbErrorCode);
  }
  throw e;
}

export const isDbError = (e: unknown, code?: DbErrorCode): e is DbError =>
  e instanceof DbError && (code === undefined || e.code === code);
