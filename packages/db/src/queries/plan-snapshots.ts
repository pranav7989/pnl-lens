/**
 * @file  packages/db/src/queries/plan-snapshots.ts
 * @area  Reports
 * @what  30-day plan snapshots (0026): saved when the plan PDF is downloaded; the newest one made before a report is what that report's check-up scores.
 */
import { sql } from 'kysely';
import type { Db } from '../client.js';

/** one per user, report and IST day (the plan is the same all day); a repeat download keeps the first */
export async function savePlanSnapshot(db: Db, userId: string, reportId: string, plan: { generatedAt: string; checkupOn: string }): Promise<void> {
  await db.insertInto('plan_snapshots')
    .values({ user_id: userId, report_id: reportId, generated_on: plan.generatedAt, checkup_on: plan.checkupOn, plan: JSON.stringify(plan) as any })
    .onConflict((oc) => oc.columns(['user_id', 'report_id', 'generated_on']).doNothing()).execute();
}

/**
 * The plan to check on this report: the user's newest snapshot from another report, made on or before the day this
 * report was created (IST). Null when the user has never downloaded a plan before it.
 */
export async function planToCheck(db: Db, userId: string, reportId: string, reportCreatedAt: Date) {
  const r = await db.selectFrom('plan_snapshots as p').leftJoin('reports as r', 'r.id', 'p.report_id')
    .select(['p.id', 'p.report_id', 'p.generated_on', 'p.checkup_on', 'p.plan', 'r.title', 'r.month_label', 'r.created_at as report_created_at'])
    .where('p.user_id', '=', userId)
    .where((eb) => eb.or([eb('p.report_id', 'is', null), eb('p.report_id', '!=', reportId)]))
    .where('p.generated_on', '<=', sql<string>`(${reportCreatedAt}::timestamptz at time zone 'Asia/Kolkata')::date`)
    .where((eb) => eb.or([eb('r.created_at', 'is', null), eb('r.created_at', '<', reportCreatedAt)]))
    .orderBy('p.generated_on', 'desc').orderBy('p.created_at', 'desc').limit(1).executeTakeFirst();
  if (!r) return null;
  return {
    id: r.id, reportId: r.report_id, generatedOn: String(r.generated_on).slice(0, 10), checkupOn: String(r.checkup_on).slice(0, 10),
    plan: (typeof r.plan === 'string' ? JSON.parse(r.plan) : r.plan) as any,
    reportName: r.title || null,                     // only a name the user gave (the month label reads like a code)
  };
}
