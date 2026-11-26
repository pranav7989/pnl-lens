/**
 * @file  apps/worker/src/profile.ts
 * @area  Worker
 * @what  Trade Check profile rebuild for one trader (job profile.rebuild): reads the live reports' trades through profile_source_trades(), builds features and the pattern profile (packages/shared), writes a new profile version and switches to it in one transaction; drops older versions; a trader with no live reports has no profile.
 */
import type pg from 'pg';
import { profileFromRows, type SourceRow } from '@pnl-lens/shared/profile/source';
import { FEATURE_VERSION, FEATURES } from '@pnl-lens/shared/features';

export const KEEP_VERSIONS = 2;
export interface RebuildResult { userId: string; version: number | null; trades: number; patterns: number; shown: number }

export async function rebuildProfile(pool: pg.Pool, userId: string, now = new Date()): Promise<RebuildResult> {
  const { rows: src } = await pool.query('select report_id, created_at, currency, trade_id, trade from public.profile_source_trades($1)', [userId]);
  const c = await pool.connect();
  try {
    await c.query('begin');
    // one rebuild per trader at a time (a second job waits, then builds from the newest data)
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`profile:${userId}`]);
    if (!src.length) {
      await c.query('delete from public.trade_features where user_id = $1', [userId]);
      await c.query('delete from public.trader_patterns where user_id = $1', [userId]);
      await c.query('delete from public.trader_baselines where user_id = $1', [userId]);
      await c.query('delete from public.trader_profiles where user_id = $1', [userId]);
      await c.query('commit');
      return { userId, version: null, trades: 0, patterns: 0, shown: 0 };
    }
    const rows: SourceRow[] = src.map((r) => ({ reportId: r.report_id, createdAt: new Date(r.created_at).toISOString(), currency: r.currency, tradeId: r.trade_id == null ? null : Number(r.trade_id), trade: r.trade }));
    const { prepared, profile } = profileFromRows(rows, now);
    const { rows: [v] } = await c.query('select coalesce(max(profile_version), 0) + 1 as next from public.trader_baselines where user_id = $1', [userId]);
    const version: number = v.next;

    // features of every stored trade (replaced as a whole: they follow the reports)
    await c.query('delete from public.trade_features where user_id = $1', [userId]);
    const withId = prepared.trades.filter((t) => t.tradeId != null);
    for (let i = 0; i < withId.length; i += 500) {
      const chunk = withId.slice(i, i + 500), cols = ['trade_id', 'user_id', ...FEATURES, 'feature_version'], params: unknown[] = [];
      const values = chunk.map((t, j) => {
        params.push(t.tradeId, userId, ...FEATURES.map((k) => t.features[k]), FEATURE_VERSION);
        return `(${cols.map((_, k) => `$${j * cols.length + k + 1}`).join(', ')})`;
      });
      await c.query(`insert into public.trade_features (${cols.join(', ')}) values ${values.join(', ')} on conflict (trade_id) do nothing`, params);
    }

    const b = profile.baseline;
    await c.query(`insert into public.trader_baselines (user_id, profile_version, n_trades, n_days, median_qty, trades_per_day, win_rate, avg_pnl, avg_abs_pnl, period_from, period_to, source_report_ids)
                   values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [userId, version, b.n_trades, b.n_days, b.median_qty, b.trades_per_day, b.win_rate, b.avg_pnl, b.avg_abs_pnl, b.period_from, b.period_to, prepared.reportIds]);
    const P = profile.patterns, pcols = ['user_id', 'profile_version', 'segment_key', 'dims', 'n_trades', 'n_days', 'n_expiries', 'wins', 'win_days', 'win_rate', 'wr_low', 'wr_high',
      'total_pnl', 'expectancy', 'expectancy_low', 'expectancy_high', 'expectancy_shrunk', 'recency', 'score', 'shown', 'verdict', 'period_from', 'period_to', 'last_trade_at'];
    for (let i = 0; i < P.length; i += 300) {
      const chunk = P.slice(i, i + 300), params: unknown[] = [];
      const values = chunk.map((p, j) => {
        params.push(userId, version, p.segment_key, JSON.stringify(p.dims), p.n_trades, p.n_days, p.n_expiries, p.wins, p.win_days, p.win_rate, p.wr_low, p.wr_high,
          p.total_pnl, p.expectancy, p.expectancy_low, p.expectancy_high, p.expectancy_shrunk, p.recency, p.score, p.shown, p.verdict, p.period_from, p.period_to, p.last_trade_at);
        return `(${pcols.map((_, k) => `$${j * pcols.length + k + 1}`).join(', ')})`;
      });
      await c.query(`insert into public.trader_patterns (${pcols.join(', ')}) values ${values.join(', ')}`, params);
    }
    // the switch: a check reads active_version, so it sees the old profile or the new one, never half of one
    await c.query(`insert into public.trader_profiles (user_id, active_version, built_at, period_from, period_to, newest_trade, n_trades, currency, source_report_ids, unavailable)
                   values ($1, $2, now(), $3, $4, $4, $5, $6, $7, $8)
                   on conflict (user_id) do update set active_version = excluded.active_version, built_at = excluded.built_at, period_from = excluded.period_from,
                     period_to = excluded.period_to, newest_trade = excluded.newest_trade, n_trades = excluded.n_trades, currency = excluded.currency, source_report_ids = excluded.source_report_ids, unavailable = excluded.unavailable`,
    [userId, version, b.period_from, b.period_to, b.n_trades, prepared.currency, prepared.reportIds, prepared.unavailable]);
    await c.query('delete from public.trader_patterns where user_id = $1 and profile_version <= $2', [userId, version - KEEP_VERSIONS]);
    await c.query('delete from public.trader_baselines where user_id = $1 and profile_version <= $2', [userId, version - KEEP_VERSIONS]);
    await c.query('commit');
    return { userId, version, trades: b.n_trades, patterns: P.length, shown: P.filter((p) => p.shown).length };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Nightly catch-up: traders whose profile is missing or older than their newest report (and profiles of traders with none). */
export async function rebuildDueProfiles(pool: pg.Pool, now = new Date(), limit = 500): Promise<{ rebuilt: number; failed: number }> {
  const { rows } = await pool.query('select user_id from public.profiles_due($1)', [limit]);
  let rebuilt = 0, failed = 0;
  for (const r of rows) {
    try { await rebuildProfile(pool, r.user_id, now); rebuilt++; } catch { failed++; }
  }
  return { rebuilt, failed };
}
