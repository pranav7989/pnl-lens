/**
 * @file  apps/worker/src/benchmarks.ts
 * @area  Worker
 * @what  Peer benchmarks, built nightly (02:45 IST) from the research views (consenting traders only): each trader's latest report per segment, the metrics from packages/shared/src/insights/benchmarks.ts, and only quantiles of groups with 50+ traders.
 */
/**
 * Reads research.trades and research.report_metrics (pseudonymised; the worker never sees user ids). A trader counts
 * once per segment (their newest report there by period end) and once in "All traders" (their newest report). The
 * table is replaced in one transaction, so the app always reads a complete set.
 */
import { sql } from 'kysely';
import type { Db } from '@pnl-lens/db';
import { segmentOf, benchmarkValues, quantiles, METRICS, MIN_TRADERS, ALL } from '@pnl-lens/shared/insights/benchmarks';

type Row = Record<string, any>;

export async function buildBenchmarks(db: Db): Promise<{ segments: number; traders: number }> {
  const data = await db.transaction().setIsolationLevel('repeatable read').execute(async (trx) => {
    await sql`set transaction read only`.execute(trx);
    const trades = (await sql<Row>`select subject, report_id, grp, market, pnl, pct from research.trades`.execute(trx)).rows;
    const reports = (await sql<Row>`select subject, report_id, market, to_date from research.report_metrics`.execute(trx)).rows;
    return { trades, reports };
  });
  const byReport = new Map<string, Row[]>();
  for (const t of data.trades) { const k = String(t.report_id); const a = byReport.get(k); if (a) a.push(t); else byReport.set(k, [t]); }
  // newest report per (subject, segment) and per subject
  type Pick = { subject: string; to: string; values: NonNullable<ReturnType<typeof benchmarkValues>> };
  const perSeg = new Map<string, Map<string, Pick>>(), perAll = new Map<string, Pick>();
  for (const r of data.reports) {
    const T = byReport.get(String(r.report_id)) || [];
    const values = benchmarkValues(T); if (!values) continue;
    const seg = segmentOf(T, r.market); if (!seg) continue;
    const to = String(r.to_date ?? ''), p: Pick = { subject: String(r.subject), to, values };
    const m = perSeg.get(seg) || new Map<string, Pick>();
    const cur = m.get(p.subject); if (!cur || cur.to < to) m.set(p.subject, p);
    perSeg.set(seg, m);
    const a = perAll.get(p.subject); if (!a || a.to < to) perAll.set(p.subject, p);
  }
  const groups: [string, Pick[]][] = [[ALL, [...perAll.values()]], ...[...perSeg.entries()].map(([s, m]) => [s, [...m.values()]] as [string, Pick[]])];
  const rows = groups.flatMap(([segment, picks]) => METRICS.map((metric) => {
    const vals = picks.map((p) => p.values[metric.key]).filter((v): v is number => v !== null && Number.isFinite(v));
    return { segment, metric: metric.key, traders: picks.length, quantiles: picks.length >= MIN_TRADERS && vals.length >= MIN_TRADERS ? quantiles(vals).map((q) => String(q)) : null };
  }));
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('benchmarks').execute();
    for (let i = 0; i < rows.length; i += 500) await trx.insertInto('benchmarks').values(rows.slice(i, i + 500) as any).execute();
  });
  return { segments: groups.length, traders: perAll.size };
}
