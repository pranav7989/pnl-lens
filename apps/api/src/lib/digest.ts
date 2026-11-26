/**
 * @file  apps/api/src/lib/digest.ts
 * @area  Reports
 * @what  Weekly summary email (opt-in): from Monday 09:00 IST, once a week per user with a live report: focus rules from the latest 30-day plan, journal progress, check-up countdown. Claim first, then send. Unsubscribe tokens.
 */
/**
 * Runs in the api (the only service with mail egress), on a timer like the check-up reminders. A week is the IST
 * Monday it starts on; the digest_sends row is inserted before the email goes out, so a restart or a second api never
 * sends twice. Missed Mondays (api down) are caught up later that week.
 */
import crypto from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from '@pnl-lens/db';
import { listNotes } from '@pnl-lens/db';
import { weeklyDigestEmail, type Mail, type DigestData } from '@pnl-lens/shared/mail';
import { buildPlan, istDate, addDays, fmtMoney } from '@pnl-lens/shared/plan';
import { journalStats } from '@pnl-lens/shared/insights/journal';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** the IST Monday of the week `now` falls in (YYYY-MM-DD) */
export function weekStart(now: Date): string {
  const d = istDate(now), dow = new Date(d + 'T00:00:00Z').getUTCDay();
  return addDays(d, -((dow + 6) % 7));
}
const istHour = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).getUTCHours();

/** unsubscribe link token: HMAC of the user id with a server secret (no sign-in needed to stop the emails) */
export const unsubscribeToken = (secret: string, userId: string) =>
  crypto.createHmac('sha256', secret).update('digest-unsubscribe:' + userId).digest('base64url').slice(0, 32);
export function tokenOk(secret: string, userId: string, token: string): boolean {
  const want = Buffer.from(unsubscribeToken(secret, userId)), got = Buffer.from(String(token || ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** what one user's email says (null when there is nothing to send: no live report) */
export async function digestFor(db: Db, userId: string, appUrl: string, secret: string, now: Date): Promise<DigestData | null> {
  const rep = await db.selectFrom('reports').select(['id', 'report'])
    .where('user_id', '=', userId).where('purged_at', 'is', null).where('report', 'is not', null)
    .orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  if (!rep) return null;
  const report: any = typeof rep.report === 'string' ? JSON.parse(rep.report) : rep.report;
  const snap = await db.selectFrom('plan_snapshots').select(['plan', 'checkup_on'])
    .where('user_id', '=', userId).orderBy('generated_on', 'desc').limit(1).executeTakeFirst();
  const plan: any = snap ? (typeof snap.plan === 'string' ? JSON.parse(snap.plan) : snap.plan) : buildPlan(report, { generatedAt: now });
  const focus = [plan.dos?.[0], plan.donts?.[0], plan.donts?.[1]].filter(Boolean).map((r: any) => ({ kind: r.kind, title: String(r.title) }));
  const notes = await listNotes(db, userId);
  const ws = weekStart(now);
  const stats = journalStats(report.trades || [], notes);
  const cur = String(report?.m?.currency || 'INR').toUpperCase();
  const best = stats.best ? `Best so far: ${stats.best.kind} “${stats.best.key}” (${fmtMoney(stats.best.pnl, cur, true)} over ${stats.best.n} trades).` : null;
  const today = istDate(now), checkup = snap ? String(snap.checkup_on).slice(0, 10) : null;
  const base = appUrl.replace(/\/$/, '');
  return {
    reportUrl: `${base}/report/${rep.id}`,
    focus,
    journal: { thisWeek: notes.filter((n) => istDate(new Date(n.updatedAt)) >= ws).length, total: notes.length, best },
    checkup: checkup ? { daysLeft: Math.round((Date.parse(checkup) - Date.parse(today)) / 86400e3), date: longDate(checkup) } : null,
    unsubscribeUrl: `${base}/unsubscribe?u=${userId}&t=${unsubscribeToken(secret, userId)}`,
  };
}

export interface DigestDeps { db: Db; mail: (m: Mail) => Promise<void>; appUrl: string; secret: string; log?: (event: string, extra?: object) => void }

export async function sendDueDigests(deps: DigestDeps, now = new Date(), fromHour = 9, limit = 200): Promise<{ sent: number; skipped: number; failed: number }> {
  const ws = weekStart(now);
  // the week's sending starts on Monday at `fromHour` IST
  if (istDate(now) === ws && istHour(now) < fromHour) return { sent: 0, skipped: 0, failed: 0 };
  const { rows } = await sql<{ id: string; email: string }>`
    select u.id, u.email::text as email from public.users u
     where u.weekly_digest and u.status = 'active'
       and exists (select 1 from public.reports r where r.user_id = u.id and r.purged_at is null and r.report is not null)
       and not exists (select 1 from public.digest_sends d where d.user_id = u.id and d.week_start = ${ws}::date)
     order by u.id limit ${limit}`.execute(deps.db);
  let sent = 0, skipped = 0, failed = 0;
  for (const u of rows) {
    const claimed = await deps.db.insertInto('digest_sends').values({ user_id: u.id, week_start: ws })
      .onConflict((oc) => oc.columns(['user_id', 'week_start']).doNothing()).returning('user_id').executeTakeFirst();
    if (!claimed) continue;                                   // another api process took it
    try {
      const data = await digestFor(deps.db, u.id, deps.appUrl, deps.secret, now);
      if (!data) { skipped++; continue; }
      await deps.mail({ to: u.email, ...weeklyDigestEmail(data) });
      sent++;
    } catch (e) { failed++; deps.log?.('weekly_digest_failed', { error: (e as Error).message.slice(0, 200) }); }
  }
  if (sent || failed) deps.log?.('weekly_digest', { week: ws, sent, skipped, failed });
  return { sent, skipped, failed };
}

/** every DIGEST_INTERVAL_MS (default 15 minutes); DIGEST_FROM_HOUR (default 9) */
export function startDigestLoop(deps: DigestDeps, env: NodeJS.ProcessEnv = process.env): () => void {
  const every = Math.max(1000, Number(env.DIGEST_INTERVAL_MS || 15 * 60_000));
  const fromHour = env.DIGEST_FROM_HOUR === undefined ? 9 : Number(env.DIGEST_FROM_HOUR);
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try { await sendDueDigests(deps, new Date(), fromHour); } catch (e) { deps.log?.('weekly_digest_error', { error: (e as Error).message.slice(0, 200) }); }
    finally { busy = false; }
  };
  const t = setInterval(tick, every); t.unref();
  setTimeout(tick, 7000).unref();
  return () => clearInterval(t);
}
