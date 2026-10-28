/**
 * @file  packages/shared/src/insights/market.ts
 * @area  Reports
 * @what  Market context (India only): the index over the report's period, results by India VIX level on the entry day, and results on days the index fell, held or rose; from the report's own trades and daily closes.
 */
/**
 * Pure. Each trade is placed on its entry day (or exit day when there is no entry date); the matching index is NIFTY
 * BANK for BANKNIFTY trades and NIFTY 50 for everything else. A day's move is close vs the previous trading day's
 * close. Days without data are left out, and a section is null when less than half of the dated trades can be placed.
 */
type Trade = Record<string, any>;
export type Symbol = 'NIFTY' | 'BANKNIFTY' | 'INDIAVIX';
export interface Close { day: string; close: number }
export type Series = Partial<Record<Symbol, Close[]>>;
export interface Bucket { key: string; n: number; pnl: number; winRate: number }
export interface MarketContext {
  from: string; to: string;
  nifty: { start: number; end: number; changePct: number } | null;
  bankNifty: { changePct: number } | null;
  /** your return % (only with capital) */
  yourPct: number | null;
  byVix: Bucket[] | null;
  byMove: Bucket[] | null;
  /** share of dated trades that could be placed on a market day (0–1) */
  coverage: number;
}

export const VIX_BANDS: [string, number, number][] = [['Calm (VIX under 13)', 0, 13], ['Normal (13–18)', 13, 18], ['Nervous (18–25)', 18, 25], ['Panicky (25 and up)', 25, Infinity]];
export const MOVE_BANDS = ['Index fell 1% or more', 'Index moved less than 1%', 'Index rose 1% or more'];

const dayOf = (t: Trade) => (t.entryDate || t.exitDate ? String(t.entryDate || t.exitDate).slice(0, 10) : null);
const bucket = (key: string, xs: Trade[]): Bucket => ({ key, n: xs.length, pnl: xs.reduce((s, t) => s + t.pnl, 0), winRate: xs.length ? xs.filter((t) => t.pnl > 0).length / xs.length : 0 });

/** the close on `day`, or the last one before it */
function closeOn(series: Close[], day: string): number | null {
  let lo = 0, hi = series.length - 1, ans: number | null = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (series[mid].day <= day) { ans = series[mid].close; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
/** that day's move vs the previous trading day, % (null when the day is not a trading day in the series) */
function moveOn(series: Close[], idx: Map<string, number>, day: string): number | null {
  const i = idx.get(day);
  if (i === undefined || i === 0) return null;
  return (series[i].close / series[i - 1].close - 1) * 100;
}

export function marketContext(trades: Trade[], series: Series, capital?: number | null): MarketContext | null {
  const T = (trades || []).filter((t) => Number.isFinite(Number(t?.pnl)) && dayOf(t));
  if (!T.length) return null;
  const sorted = (s?: Close[]) => [...(s || [])].filter((c) => c.close > 0).sort((a, b) => (a.day < b.day ? -1 : 1));
  const nifty = sorted(series.NIFTY), bank = sorted(series.BANKNIFTY), vix = sorted(series.INDIAVIX);
  const idx = (s: Close[]) => new Map(s.map((c, i) => [c.day, i]));
  const ni = idx(nifty), bi = idx(bank), vi = idx(vix);
  const days = T.map(dayOf) as string[];
  const from = days.reduce((a, b) => (a < b ? a : b)), to = days.reduce((a, b) => (a > b ? a : b));

  const change = (s: Close[]) => {
    // from the close before the first trade day to the close of the last one
    const before = s.filter((c) => c.day < from).pop()?.close ?? closeOn(s, from), end = closeOn(s, to);
    return before && end ? { start: before, end, changePct: (end / before - 1) * 100 } : null;
  };
  const niftyCh = nifty.length ? change(nifty) : null, bankCh = bank.length ? change(bank) : null;

  // place each trade
  const vixKey = (d: string) => { const i = vi.get(d); if (i === undefined) return null; const v = vix[i].close; return VIX_BANDS.find(([, lo, hi]) => v >= lo && v < hi)![0]; };
  const moveKey = (t: Trade, d: string) => {
    const isBank = String(t.underlying || '').toUpperCase() === 'BANKNIFTY';
    const m = isBank ? moveOn(bank, bi, d) : moveOn(nifty, ni, d);
    return m === null ? null : m <= -1 ? MOVE_BANDS[0] : m >= 1 ? MOVE_BANDS[2] : MOVE_BANDS[1];
  };
  const vixPairs = T.map((t) => [vixKey(dayOf(t)!), t] as const).filter((p) => p[0]);
  const movePairs = T.map((t) => [moveKey(t, dayOf(t)!), t] as const).filter((p) => p[0]);
  const group = (pairs: (readonly [string | null, Trade])[], order: string[]) =>
    order.map((k) => bucket(k, pairs.filter((p) => p[0] === k).map((p) => p[1]))).filter((b) => b.n > 0);
  const enough = (n: number) => n >= T.length / 2;
  const net = T.reduce((s, t) => s + t.pnl, 0);
  return {
    from, to,
    nifty: niftyCh, bankNifty: bankCh ? { changePct: bankCh.changePct } : null,
    yourPct: capital && capital > 0 ? (net / capital) * 100 : null,
    byVix: enough(vixPairs.length) ? group(vixPairs, VIX_BANDS.map((b) => b[0])) : null,
    byMove: enough(movePairs.length) ? group(movePairs, MOVE_BANDS) : null,
    coverage: Math.max(vixPairs.length, movePairs.length) / T.length,
  };
}
