/**
 * @file  apps/api/src/lib/reminders.ts
 * @area  Reports
 * @what  Sends due 30-day plan check-up reminders (from 09:00 IST, once each): claim first, then email. Runs on a timer in the api process.
 */
/**
 * The api sends these because it is the only service with mail egress (the worker is internal-only). Each reminder is
 * claimed in the database before the email goes out, so several api processes or a restart never send one twice; a
 * failed send is logged and not retried (at most once, by design: it is a courtesy reminder).
 */
import { dueReminders, markReminderSent, type Db } from '@pnl-lens/db';
import { planReminderEmail, type Mail } from '@pnl-lens/shared/mail';
import { istDate } from '@pnl-lens/shared/plan';

export interface ReminderDeps { db: Db; mail: (m: Mail) => Promise<void>; appUrl: string; log?: (event: string, extra?: object) => void }

/** IST hour 0–23 */
const istHour = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).getUTCHours();

export async function sendDueReminders(deps: ReminderDeps, now = new Date(), fromHour = 9): Promise<{ sent: number; failed: number }> {
  const today = istDate(now), early = istHour(now) < fromHour;
  let sent = 0, failed = 0;
  for (const r of await dueReminders(deps.db)) {
    if (early && r.remindOn >= today) continue;           // today's reminders wait for 09:00 IST
    if (!(await markReminderSent(deps.db, r.id))) continue; // claimed elsewhere or cancelled meanwhile
    try { await deps.mail({ to: r.email, ...planReminderEmail(deps.appUrl) }); sent++; }
    catch (e) { failed++; deps.log?.('plan_reminder_failed', { id: r.id, error: (e as Error).message.slice(0, 200) }); }
  }
  if (sent || failed) deps.log?.('plan_reminders', { sent, failed });
  return { sent, failed };
}

/** every PLAN_REMINDER_INTERVAL_MS (default 10 minutes); returns a stop function */
export function startReminderLoop(deps: ReminderDeps, env: NodeJS.ProcessEnv = process.env): () => void {
  const every = Math.max(1000, Number(env.PLAN_REMINDER_INTERVAL_MS || 10 * 60_000));
  const fromHour = env.PLAN_REMINDER_FROM_HOUR === undefined ? 9 : Number(env.PLAN_REMINDER_FROM_HOUR);
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try { await sendDueReminders(deps, new Date(), fromHour); } catch (e) { deps.log?.('plan_reminders_error', { error: (e as Error).message.slice(0, 200) }); }
    finally { busy = false; }
  };
  const t = setInterval(tick, every); t.unref();
  setTimeout(tick, 5000).unref();
  return () => clearInterval(t);
}
