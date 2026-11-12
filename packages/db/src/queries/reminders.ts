/**
 * @file  packages/db/src/queries/reminders.ts
 * @area  Reports
 * @what  30-day plan check-up reminders: set (replaces the active one), read, cancel (app); due list and claim-before-send (api sender, via 0024 functions).
 */
import { sql } from 'kysely';
import type { Db } from '../client.js';

export interface PlanReminder { id: string; reportId: string | null; remindOn: string; createdAt: string }
const shape = (r: { id: string; report_id: string | null; remind_on: string; created_at: Date }): PlanReminder =>
  ({ id: r.id, reportId: r.report_id, remindOn: String(r.remind_on).slice(0, 10), createdAt: new Date(r.created_at).toISOString() });

export async function activeReminder(db: Db, userId: string): Promise<PlanReminder | null> {
  const r = await db.selectFrom('plan_reminders').select(['id', 'report_id', 'remind_on', 'created_at'])
    .where('user_id', '=', userId).where('sent_at', 'is', null).where('cancelled_at', 'is', null).executeTakeFirst();
  return r ? shape(r) : null;
}

/** one active reminder per user: an existing one is cancelled first (same transaction) */
export async function setReminder(db: Db, userId: string, reportId: string | null, remindOn: string): Promise<PlanReminder> {
  return db.transaction().execute(async (tx) => {
    await tx.updateTable('plan_reminders').set({ cancelled_at: sql`now()` as any })
      .where('user_id', '=', userId).where('sent_at', 'is', null).where('cancelled_at', 'is', null).execute();
    const r = await tx.insertInto('plan_reminders').values({ user_id: userId, report_id: reportId, remind_on: remindOn })
      .returning(['id', 'report_id', 'remind_on', 'created_at']).executeTakeFirstOrThrow();
    return shape(r);
  });
}

export async function cancelReminder(db: Db, userId: string, id: string): Promise<boolean> {
  const r = await db.updateTable('plan_reminders').set({ cancelled_at: sql`now()` as any })
    .where('id', '=', id).where('user_id', '=', userId).where('sent_at', 'is', null).where('cancelled_at', 'is', null).executeTakeFirst();
  return Number(r.numUpdatedRows) > 0;
}

/** sender: reminders due today or earlier (IST) for active accounts */
export async function dueReminders(db: Db, limit = 200): Promise<{ id: string; email: string; remindOn: string }[]> {
  const { rows } = await sql<{ id: string; email: string; remind_on: string }>`select * from public.due_plan_reminders(${limit})`.execute(db);
  return rows.map((r) => ({ id: r.id, email: r.email, remindOn: String(r.remind_on).slice(0, 10) }));
}

/** claims a reminder (sets sent_at); only the caller that gets true sends it */
export async function markReminderSent(db: Db, id: string): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`select public.mark_plan_reminder_sent(${id}::uuid) as ok`.execute(db);
  return rows[0]?.ok === true;
}
