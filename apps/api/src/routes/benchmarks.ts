/**
 * @file  apps/api/src/routes/benchmarks.ts
 * @area  Reports
 * @what  How a report compares with traders like the user: its segment and, per metric, the share of that group (or of all traders) it does better than; only groups of 50+ consenting traders are used.
 */
import { z } from 'zod';
import { getReport } from '@pnl-lens/db';
import { segmentOf, benchmarkValues, percentileOf, METRICS, MIN_TRADERS, ALL } from '@pnl-lens/shared/insights/benchmarks';
import type { App, Deps } from '../app.js';
import { fail, ok, requireUser, UUID } from '../lib/http.js';

export async function benchmarkRoutes(app: App, deps: Deps) {
  app.get('/reports/:id/benchmarks', { schema: { tags: ['reports'], security: [{ session: [] }], summary: 'How this report compares with traders like you', params: z.object({ id: z.string() }) } }, async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!UUID.test(req.params.id)) return fail(reply, 404, 'not_found');
    const r = await getReport(deps.db, user.id, req.params.id);
    if (!r || r.purged_at || !r.report) return fail(reply, 404, 'not_found');
    const report: any = r.report, trades = report.trades || [];
    const segment = segmentOf(trades, report.m?.market), values = benchmarkValues(trades);
    reply.header('Cache-Control', 'no-store');
    if (!segment || !values) return ok(reply, { segment, enough: false, reason: 'few_trades', minTraders: MIN_TRADERS, metrics: [] });
    const rows = await deps.db.selectFrom('benchmarks').select(['segment', 'metric', 'traders', 'quantiles', 'computed_at'])
      .where('segment', 'in', [segment, ALL]).execute();
    const find = (seg: string, metric: string) => rows.find((x) => x.segment === seg && x.metric === metric);
    const traders = (seg: string) => rows.find((x) => x.segment === seg)?.traders ?? 0;
    const metrics = METRICS.map((m) => {
      const v = values[m.key];
      if (v === null) return null;
      const own = find(segment, m.key), all = find(ALL, m.key);
      const use = own?.quantiles ? { row: own, group: segment } : all?.quantiles ? { row: all, group: ALL } : null;
      return { key: m.key, label: m.label, value: v, higherIsBetter: m.higherIsBetter,
        better: use ? percentileOf(v, use.row.quantiles!.map(Number), m.higherIsBetter) : null, group: use?.group ?? null, traders: use?.row.traders ?? null };
    }).filter(Boolean);
    const computed = rows.map((x) => new Date(x.computed_at).getTime()).sort().pop();
    return ok(reply, {
      segment, segmentTraders: traders(segment), allTraders: traders(ALL), minTraders: MIN_TRADERS,
      enough: metrics.some((m: any) => m.better !== null), computedAt: computed ? new Date(computed).toISOString() : null, metrics,
    });
  });
}
