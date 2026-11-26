/**
 * @file  packages/db/src/queries/plans.ts
 * @area  Database
 * @what  Plans: the user's plan card (allowance, validity, statements per report) and the owner-only manual grant (D5).
 */
import { sql } from 'kysely';
import type { Db } from '../client.js';
import type { PlanId } from '../types.js';
import { rethrow } from '../errors.js';

/** All of a user's plans, newest validity first; `active` = can still create a report. */
export async function userPlans(db: Db, userId: string) {
  return db.selectFrom('subscriptions')
    .select(['id', 'plan_id', 'reports_total', 'reports_used', 'files_per_report', 'starts_at', 'ends_at', 'payment_id', 'granted_by',
      sql<boolean>`ends_at > now() and starts_at <= now() and reports_used < reports_total`.as('active')])
    .where('user_id', '=', userId)
    .orderBy('ends_at', 'desc')
    .execute();
}

export interface ManualGrant {
  actorId: string; userId: string; plan: PlanId; reports: number; filesPerReport: number; days: number; reason: string;
  /** 0032: also give a founding trader number (owner's choice; staff and test accounts never get one) */
  founding?: boolean;
}

/**
 * Owner-only manual plan grant (approved exception to rule 6, plan D5). The DB re-checks that the actor is an
 * active owner, requires a reason and writes audit_log. Plan values must come from packages/shared PLANS.
 * Throws DbError: forbidden | reason_required | unknown_user | invalid_plan.
 */
export async function adminGrantPlan(db: Db, g: ManualGrant): Promise<string> {
  try {
    const { rows } = await sql<{ id: string }>`select public.admin_grant_plan(${g.actorId}::uuid, ${g.userId}::uuid, ${g.plan}::text,
      ${g.reports}::int, ${g.filesPerReport}::int, ${g.days}::int, ${g.reason}::text, ${g.founding === true}::boolean) as id`.execute(db);
    return rows[0].id;
  } catch (e) { rethrow(e); }
}

/** Owner marks or unmarks a test account (0032): a test account never gets a founding number. Throws DbError: forbidden | unknown_user. */
export async function adminSetTestAccount(db: Db, actorId: string, userId: string, isTest: boolean): Promise<void> {
  try { await sql`select public.admin_set_test_account(${actorId}::uuid, ${userId}::uuid, ${isTest}::boolean)`.execute(db); } catch (e) { rethrow(e); }
}
