/**
 * @file  packages/shared/src/profile/build.ts
 * @area  Desk
 * @what  Trade Check pattern profile (architecture doc §6): segments of the trader's own trades (single features, pairs, named triples), minimum evidence, 90% Wilson win-rate range, seeded bootstrap of the average, shrinkage, recency weighting, weak/strong verdicts and the ranking score; explainable, no model.
 */
/**
 * Pure and deterministic: the same trades and the same "now" always give the same profile (the bootstrap is seeded
 * from the P&L values, as the Edge tab does). Recency (90-day half-life, counted back from the trader's newest trade)
 * weights the verdict, so a habit that has improved fades; the numbers shown (trades, win rate, total) are plain counts.
 */
import { FEATURES, type FeatureName, type Features } from '../features/build';
import { rng, seedOf } from '../insights/edge';

export const MIN_TRADES = 8, MIN_DAYS = 4, STORE_MIN_TRADES = 3;
export const SHRINK_K = 10, HALF_LIFE_DAYS = 90, Z90 = 1.6448536, RESAMPLES = 400;
/** named triples (doc §6): habits the doc calls out by name */
export const TRIPLES: FeatureName[][] = [
  ['instrument', 'side', 'dte'], ['instrument', 'side', 'expiry_kind'], ['instrument', 'side', 'time_bucket'],
  ['underlying', 'instrument', 'side'], ['instrument', 'side', 'after_losses'], ['instrument', 'side', 'size_ratio'],
];
const SPECIFICITY = [0, 1, 1.5, 2];

export interface ProfileTrade { features: Features; pnl: number; day: string | null; expiry: string | null }
export interface Baseline {
  n_trades: number; n_days: number; median_qty: number | null; trades_per_day: number | null; win_rate: number; avg_pnl: number; avg_abs_pnl: number;
  period_from: string | null; period_to: string | null;
}
export type Verdict = 'weak' | 'neutral' | 'strong';
export interface Pattern {
  segment_key: string; dims: Partial<Record<FeatureName, string>>;
  n_trades: number; n_days: number; n_expiries: number | null; wins: number; win_days: number;
  win_rate: number; wr_low: number; wr_high: number; total_pnl: number;
  expectancy: number; expectancy_low: number | null; expectancy_high: number | null; expectancy_shrunk: number;
  recency: number; score: number; shown: boolean; verdict: Verdict;
  period_from: string | null; period_to: string | null; last_trade_at: string | null;
}
export interface Profile { baseline: Baseline; patterns: Pattern[] }

/** segment key in the fixed feature order, e.g. "instrument=option|side=buy|dte=0" */
export const segmentKey = (dims: Partial<Record<FeatureName, string>>) => FEATURES.filter((k) => dims[k] != null).map((k) => `${k}=${dims[k]}`).join('|');

/** 90% Wilson interval for a win rate (wins of n, or weighted with an effective n) */
export function wilson(p: number, n: number, z = Z90): [number, number] {
  if (!(n > 0)) return [0, 1];
  const z2 = z * z, d = 1 + z2 / n, c = (p + z2 / (2 * n)) / d, m = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return [Math.max(0, c - m), Math.min(1, c + m)];
}
export const shrink = (n: number, mean: number, prior: number, k = SHRINK_K) => (n * mean + k * prior) / (n + k);
export const recencyWeight = (day: string | null, now: Date) =>
  day ? 0.5 ** (Math.max(0, (now.getTime() - Date.parse(`${day}T00:00:00Z`)) / 864e5) / HALF_LIFE_DAYS) : 1;

function bootstrap(xs: number[]): [number, number] {
  const r = rng(seedOf(xs)), means: number[] = [];
  for (let i = 0; i < RESAMPLES; i++) { let s = 0; for (let j = 0; j < xs.length; j++) s += xs[Math.floor(r() * xs.length)]; means.push(s / xs.length); }
  means.sort((a, b) => a - b);
  return [means[Math.floor(RESAMPLES * 0.05)], means[Math.ceil(RESAMPLES * 0.95) - 1]];
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** every segment a trade belongs to: single features, pairs, named triples (only features it has) */
function segmentsOf(f: Features): Partial<Record<FeatureName, string>>[] {
  const have = FEATURES.filter((k) => f[k] != null);
  const out: Partial<Record<FeatureName, string>>[] = [];
  for (let i = 0; i < have.length; i++) {
    out.push({ [have[i]]: f[have[i]]! });
    for (let j = i + 1; j < have.length; j++) out.push({ [have[i]]: f[have[i]]!, [have[j]]: f[have[j]]! });
  }
  for (const t of TRIPLES) if (t.every((k) => f[k] != null)) out.push(Object.fromEntries(t.map((k) => [k, f[k]!])));
  return out;
}

export function buildProfile(trades: ProfileTrade[], now: Date, qtys: number[] = []): Profile {
  const T = trades.filter((t) => Number.isFinite(t.pnl));
  const days = T.map((t) => t.day).filter((d): d is string => !!d).sort();
  const distinctDays = new Set(days).size;
  const wins = T.filter((t) => t.pnl > 0).length;
  const sum = T.reduce((s, t) => s + t.pnl, 0);
  const baseline: Baseline = {
    n_trades: T.length, n_days: distinctDays, median_qty: median(qtys.filter((q) => q > 0)),
    trades_per_day: distinctDays ? T.filter((t) => t.day).length / distinctDays : null,
    win_rate: T.length ? wins / T.length : 0, avg_pnl: T.length ? sum / T.length : 0,
    avg_abs_pnl: T.length ? T.reduce((s, t) => s + Math.abs(t.pnl), 0) / T.length : 0,
    period_from: days[0] ?? null, period_to: days[days.length - 1] ?? null,
  };

  const groups = new Map<string, { dims: Partial<Record<FeatureName, string>>; idx: number[] }>();
  T.forEach((t, i) => {
    for (const dims of segmentsOf(t.features)) {
      const key = segmentKey(dims);
      const g = groups.get(key) ?? { dims, idx: [] };
      g.idx.push(i); groups.set(key, g);
    }
  });

  // recency runs back from the trader's newest trade (not from today): an old statement still has its habits; newer
  // trades of the same habit, when better, fade the old warning. With no dates, "now".
  const anchor = baseline.period_to ? new Date(`${baseline.period_to}T00:00:00Z`) : now;
  const weights = T.map((t) => recencyWeight(t.day, anchor));
  const patterns: Pattern[] = [];
  for (const [key, g] of groups) {
    if (g.idx.length < STORE_MIN_TRADES) continue;
    const ts = g.idx.map((i) => T[i]), ws = g.idx.map((i) => weights[i]), pnls = ts.map((t) => t.pnl);
    const n = ts.length, segWins = pnls.filter((p) => p > 0).length, total = pnls.reduce((a, b) => a + b, 0);
    const byDay = new Map<string, number>();
    ts.forEach((t) => { if (t.day) byDay.set(t.day, (byDay.get(t.day) ?? 0) + t.pnl); });
    const wSum = ws.reduce((a, b) => a + b, 0);
    const wWin = ts.reduce((s, t, i) => s + (t.pnl > 0 ? ws[i] : 0), 0) / wSum;
    const wMean = ts.reduce((s, t, i) => s + t.pnl * ws[i], 0) / wSum;
    const [lo, hi] = wilson(wWin, wSum);
    const shown = n >= MIN_TRADES && byDay.size >= MIN_DAYS;
    const exp = shown ? bootstrap(pnls) : [null, null];
    const dayList = [...byDay.keys()].sort();
    const shrunk = shrink(wSum, wMean, baseline.avg_pnl);
    const recency = wSum / n;
    patterns.push({
      segment_key: key, dims: g.dims, n_trades: n, n_days: byDay.size,
      n_expiries: g.dims.dte === '0' ? new Set(ts.map((t) => t.expiry ?? t.day).filter(Boolean)).size : null,
      wins: segWins, win_days: [...byDay.values()].filter((v) => v > 0).length,
      win_rate: segWins / n, wr_low: lo, wr_high: hi, total_pnl: total, expectancy: total / n,
      expectancy_low: exp[0], expectancy_high: exp[1], expectancy_shrunk: shrunk, recency,
      score: Math.abs(shrunk) * Math.sqrt(n) * recency * SPECIFICITY[Object.keys(g.dims).length],
      shown, verdict: 'neutral', period_from: dayList[0] ?? null, period_to: dayList[dayList.length - 1] ?? null, last_trade_at: dayList[dayList.length - 1] ?? null,
    });
  }

  // verdicts (doc §6.5), among the segments with enough evidence
  const shown = patterns.filter((p) => p.shown);
  const byTotal = [...shown].sort((a, b) => a.total_pnl - b.total_pnl);
  const bottom = new Set(byTotal.slice(0, Math.ceil(byTotal.length * 0.2)).map((p) => p.segment_key));
  const overall = baseline.win_rate;
  for (const p of shown) {
    if (p.wr_high < overall - 0.1 || (p.expectancy_shrunk < 0 && bottom.has(p.segment_key))) p.verdict = 'weak';
    else if (p.wr_low > overall + 0.05 && p.expectancy_shrunk > 0) p.verdict = 'strong';
  }
  patterns.sort((a, b) => (a.segment_key < b.segment_key ? -1 : 1));
  return { baseline, patterns };
}

/**
 * Watch-outs (and, in PR 4, chips): weak habits first by score, at least one strength when there is one; a segment
 * that is a narrower or broader version of one already picked with the same verdict is skipped, so one habit shows once.
 */
export function topPatterns(patterns: Pattern[], max = 3, minStrong = 1): Pattern[] {
  const cand = patterns.filter((p) => p.shown && p.verdict !== 'neutral').sort((a, b) => b.score - a.score || (a.segment_key < b.segment_key ? -1 : 1));
  // a premium band or call/put implies an option, so "option trades X" and "X at a premium above ₹150" are one habit
  const full = (d: Pattern['dims']): Record<string, string> => ({ ...(d.premium_bucket || d.option_type ? { instrument: 'option' } : {}), ...d } as Record<string, string>);
  const related = (a: Pattern, b: Pattern) => {
    const da = full(a.dims), db = full(b.dims), ka = Object.entries(da), kb = Object.entries(db);
    const sub = (x: [string, string][], y: Partial<Record<string, string>>) => x.every(([k, v]) => y[k] === v);
    // nested (narrower/broader), or two descriptions of the very same trades (same count and same total)
    const same = a.n_trades === b.n_trades && Math.abs(a.total_pnl - b.total_pnl) < 0.005;
    return sub(ka, db) || sub(kb, da) || same;
  };
  const pick = (list: Pattern[], into: Pattern[], n: number) => {
    for (const p of list) { if (into.length >= n) break; if (!into.some((q) => q.verdict === p.verdict && related(p, q))) into.push(p); }
  };
  // weak habits lead; one place is kept for a strength when there is one; strengths fill what is left
  const strong = cand.filter((p) => p.verdict === 'strong'), weak = cand.filter((p) => p.verdict === 'weak'), out: Pattern[] = [];
  pick(weak, out, max - Math.min(minStrong, strong.length));
  pick(strong, out, max);
  return out.sort((a, b) => (a.verdict === b.verdict ? b.score - a.score : a.verdict === 'weak' ? -1 : 1));
}
