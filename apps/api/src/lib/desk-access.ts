/**
 * @file  apps/api/src/lib/desk-access.ts
 * @area  Desk
 * @what  Who may use the Desk's personal parts (watch-outs, trade plan, rules, Trade Check): an open plan window and at least one live report (owner decision, 25 Nov 2026); the calculator, events and headlines don't need either.
 */
type Q = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

export async function deskAccess(pool: Q, userId: string): Promise<'ok' | 'no_plan' | 'no_report'> {
  const { rows: [r] } = await pool.query(`select exists (select 1 from public.subscriptions where user_id = $1 and starts_at <= now() and ends_at > now()) as plan,
                                                 exists (select 1 from public.reports where user_id = $1 and purged_at is null and report is not null) as report`, [userId]);
  return !r.plan ? 'no_plan' : !r.report ? 'no_report' : 'ok';
}
