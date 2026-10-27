/**
 * @file  packages/shared/src/insights/benchmarks.ts
 * @area  Reports
 * @what  Peer benchmarks (Release C): a report's segment ("India · Index options"), its comparable metrics from its trades, the quantiles of a group of traders, and where one value sits among them ("better than 72%").
 */
/**
 * Pure, and used on both sides so the comparison is exact: the worker computes every consenting trader's metrics
 * with benchmarkValues() and stores only quantiles (and only for groups of MIN_TRADERS or more); the API computes
 * the viewer's own values with the same function and places them with percentileOf(). Field names accept both the
 * report JSON (group) and the research view (grp).
 */
type Trade = Record<string, any>;
export const MIN_TRADERS = 50;
/** p5, p10 … p95 */
export const QUANTILES = Array.from({ length: 19 }, (_, i) => (i + 1) * 0.05);
export const ALL = 'All traders';

export type MetricKey = 'win_rate' | 'payoff' | 'profit_factor' | 'avg_trade_pct' | 'deep_loss_share';
export const METRICS: { key: MetricKey; label: string; higherIsBetter: boolean }[] = [
  { key: 'win_rate', label: 'Trades won', higherIsBetter: true },
  { key: 'payoff', label: 'Average win ÷ average loss', higherIsBetter: true },
  { key: 'profit_factor', label: 'Profit factor', higherIsBetter: true },
  { key: 'avg_trade_pct', label: 'Average trade, % of position', higherIsBetter: true },
  { key: 'deep_loss_share', label: 'Trades that lost more than 10%', higherIsBetter: false },
];

const closed = (trades: Trade[]) => (trades || []).filter((t) => Number.isFinite(Number(t?.pnl)));
const groupOf = (t: Trade) => String(t.group ?? t.grp ?? 'Other');

/** the report's segment: its market and the instrument group with the most trades */
export function segmentOf(trades: Trade[], market?: string | null): string | null {
  const T = closed(trades);
  if (!T.length) return null;
  const by = new Map<string, number>();
  for (const t of T) by.set(groupOf(t), (by.get(groupOf(t)) || 0) + 1);
  const top = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const mk = market || T.find((t) => t.market)?.market || 'Other';
  return `${mk} · ${top}`;
}

/** comparable metrics (null when the trades cannot show one); needs 10+ closed trades */
export function benchmarkValues(trades: Trade[]): Record<MetricKey, number | null> | null {
  const T = closed(trades).map((t) => ({ pnl: Number(t.pnl), pct: Number(t.pct) }));
  if (T.length < 10) return null;
  const wins = T.filter((t) => t.pnl > 0), losses = T.filter((t) => t.pnl < 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = -losses.reduce((s, t) => s + t.pnl, 0);
  const pcts = T.map((t) => t.pct).filter(Number.isFinite);
  return {
    win_rate: wins.length / T.length,
    payoff: wins.length && losses.length ? (gw / wins.length) / (gl / losses.length) : null,
    profit_factor: gl > 0 ? gw / gl : null,
    avg_trade_pct: pcts.length ? pcts.reduce((s, x) => s + x, 0) / pcts.length : null,
    deep_loss_share: pcts.length ? pcts.filter((x) => x <= -10).length / pcts.length : null,
  };
}

/** linear-interpolated quantiles of `values` at QUANTILES */
export function quantiles(values: number[]): number[] {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return [];
  return QUANTILES.map((q) => {
    const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  });
}

/**
 * Share of the group (0–1) this value does better than, from the stored quantiles. For metrics where lower is
 * better, "better than" means a lower value. Clamped to 2%–98%: the quantiles cannot say more than that.
 */
export function percentileOf(value: number, qs: number[], higherIsBetter: boolean): number {
  if (!qs.length || !Number.isFinite(value)) return 0.5;
  const ps = QUANTILES;
  let below: number;                                         // share of the group with a lower value
  if (value <= qs[0]) below = value < qs[0] ? 0.02 : ps[0];
  else if (value >= qs[qs.length - 1]) below = value > qs[qs.length - 1] ? 0.98 : ps[ps.length - 1];
  else {
    let i = 0;
    while (i < qs.length - 1 && !(value >= qs[i] && value <= qs[i + 1])) i++;
    const span = qs[i + 1] - qs[i];
    below = span > 0 ? ps[i] + ((value - qs[i]) / span) * (ps[i + 1] - ps[i]) : (ps[i] + ps[i + 1]) / 2;
  }
  const better = higherIsBetter ? below : 1 - below;
  return Math.min(0.98, Math.max(0.02, better));
}
