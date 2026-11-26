/**
 * @file  apps/api/src/routes/market.ts
 * @area  Reports
 * @what  Market context for one of my reports (India only): the index over the period, results by India VIX level and by the index's move that day; not available for other markets.
 */
import { z } from 'zod';
import { sql } from 'kysely';
import { getReport } from '@pnl-lens/db';
import { marketContext, type Series, type Close } from '@pnl-lens/shared/insights/market';
import { addDays } from '@pnl-lens/shared/plan';
import type { App, Deps } from '../app.js';
import { fail, ok, requireUser, UUID } from '../lib/http.js';

export async function marketRoutes(app: App, deps: Deps) {
  app.get('/reports/:id/market', { schema: { tags: ['reports'], security: [{ session: [] }], summary: 'Market context for a report (India only)', params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    const r = await getReport(deps.db, user.id, req.params.id);
    if (!r || r.purged_at || !r.report) return fail(reply, 404, 'not_found');
    reply.header('Cache-Control', 'no-store');
    const report: any = r.report;
    // India only: other markets have no index data here, so the section is not shown at all
    if (String(report?.m?.market || r.market || '') !== 'India') return ok(reply, { available: false, reason: 'not_india' });
    const days = (report.trades || []).map((t: any) => String(t.entryDate || t.exitDate || '').slice(0, 10)).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (!days.length) return ok(reply, { available: false, reason: 'no_dates' });
    const rows = await deps.db.selectFrom('market_daily').select(['symbol', sql<string>`day::text`.as('day'), 'close'])
      .where('day', '>=', addDays(days[0], -10)).where('day', '<=', days[days.length - 1]).orderBy('day').execute();
    const series: Series = {};
    for (const x of rows) ((series[x.symbol as keyof Series] ||= []) as Close[]).push({ day: x.day, close: Number(x.close) });
    const ctx = marketContext(report.trades, series, r.capital === null || r.capital === undefined ? null : Number(r.capital));
    if (!ctx || (!ctx.nifty && !ctx.byVix && !ctx.byMove)) return ok(reply, { available: false, reason: 'no_market_data' });
    return ok(reply, { available: true, ...ctx });
  });
}
