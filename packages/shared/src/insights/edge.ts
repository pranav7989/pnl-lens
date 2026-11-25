/**
 * @file  packages/shared/src/insights/edge.ts
 * @area  Reports
 * @what  Edge verdict (is the average trade really positive, or could it be luck?) and outcome projection (the next 100 trades if the past ones repeat in random order: range, drawdowns, chance of giving profits back).
 */
/**
 * Pure and deterministic: a seeded generator (mulberry32, seeded from the trades) drives a bootstrap of the average
 * trade and a Monte Carlo of future trade sequences, so the same report always shows the same numbers. Only the
 * report's own closed-trade P&L is used. This describes the past trades statistically; it is not a forecast.
 */
export type Verdict = 'real' | 'unproven' | 'negative' | 'too-few';
export interface EdgeResult {
  n: number;
  avg: number;
  /** 90% range of the average trade (bootstrap 5th–95th percentile) */
  low: number;
  high: number;
  /** share of resamples where the average trade is 0 or less: "the chance this edge is luck" (0–1) */
  luck: number;
  verdict: Verdict;
  /** trades in total needed for a 95% one-sided confidence at the current average and spread; null if the average is not positive */
  needed: number | null;
}
export interface ProjectionResult {
  horizon: number;
  /** cumulative P&L percentiles after each step (index 0 = now = 0); length horizon + 1 */
  p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[];
  /** chance the next `horizon` trades end above 0 (0–1) */
  profitChance: number;
  /** worst drawdown within those trades: typical (median) and bad (1 in 20) */
  ddTypical: number;
  ddBad: number;
  /** chance of falling at some point by 25% / 50% of the profit made so far (null when there is no profit) */
  giveBack25: number | null;
  giveBack50: number | null;
}

export const MIN_TRADES = 20;
const RESAMPLES = 4000, PATHS = 2000;

/** small, fast, seeded PRNG (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** seed from the P&L values themselves, so the same trades always give the same draws */
function seedOf(xs: number[]): number {
  let h = 2166136261 ^ xs.length;
  for (const x of xs) { h ^= Math.round(x * 100) | 0; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pnlsOf = (trades: any[]): number[] => (trades || []).map((t) => Number(t?.pnl)).filter(Number.isFinite);
const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * q)), lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

export function edgeVerdict(trades: any[]): EdgeResult {
  const xs = pnlsOf(trades), n = xs.length;
  const avg = n ? xs.reduce((s, x) => s + x, 0) / n : 0;
  if (n < MIN_TRADES) return { n, avg, low: avg, high: avg, luck: 0.5, verdict: 'too-few', needed: null };
  const r = rng(seedOf(xs)), means: number[] = new Array(RESAMPLES);
  let notPositive = 0;
  for (let k = 0; k < RESAMPLES; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[(r() * n) | 0];
    const m = s / n; means[k] = m; if (m <= 0) notPositive++;
  }
  means.sort((a, b) => a - b);
  const low = quantile(means, 0.05), high = quantile(means, 0.95), luck = notPositive / RESAMPLES;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - avg) ** 2, 0) / Math.max(1, n - 1));
  const needed = avg > 0 && sd > 0 ? Math.max(n, Math.ceil(((1.645 * sd) / avg) ** 2)) : null;
  const verdict: Verdict = low > 0 ? 'real' : high < 0 ? 'negative' : 'unproven';
  return { n, avg, low, high, luck, verdict, needed };
}

/** the next `horizon` trades, drawn at random from the past ones (with replacement) */
export function project(trades: any[], horizon = 100): ProjectionResult | null {
  const xs = pnlsOf(trades), n = xs.length;
  if (n < MIN_TRADES) return null;
  const net = xs.reduce((s, x) => s + x, 0);
  const r = rng(seedOf(xs) ^ 0x9e3779b9);
  const at: number[][] = Array.from({ length: horizon + 1 }, () => new Array(PATHS));
  const dds: number[] = new Array(PATHS);
  let profit = 0, gb25 = 0, gb50 = 0;
  for (let p = 0; p < PATHS; p++) {
    let cum = 0, peak = 0, dd = 0, low = 0;
    at[0][p] = 0;
    for (let i = 1; i <= horizon; i++) {
      cum += xs[(r() * n) | 0];
      at[i][p] = cum;
      if (cum > peak) peak = cum;
      if (cum - peak < dd) dd = cum - peak;
      if (cum < low) low = cum;
    }
    dds[p] = dd;
    if (cum > 0) profit++;
    if (net > 0) { if (-low >= 0.25 * net) gb25++; if (-low >= 0.5 * net) gb50++; }
  }
  const sortedCols = at.map((col) => [...col].sort((a, b) => a - b));
  const band = (q: number) => sortedCols.map((c) => quantile(c, q));
  dds.sort((a, b) => a - b);
  return {
    horizon,
    p5: band(0.05), p25: band(0.25), p50: band(0.5), p75: band(0.75), p95: band(0.95),
    profitChance: profit / PATHS,
    ddTypical: quantile(dds, 0.5), ddBad: quantile(dds, 0.05),
    giveBack25: net > 0 ? gb25 / PATHS : null, giveBack50: net > 0 ? gb50 / PATHS : null,
  };
}
