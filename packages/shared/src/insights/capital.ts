/**
 * @file  packages/shared/src/insights/capital.ts
 * @area  Reports
 * @what  Results as % of the capital the user says they used (analysis roadmap B1): return, a year at this pace, average trade, average loss and largest loss, worst day and worst drawdown, and how often a single trade lost more than 1% or 2% of capital.
 */
/**
 * Pure. Capital is the user's own figure (optional, never asked for during upload). Percentages are simple, not
 * compounded; "a year at this pace" scales the return by the statement's calendar span and is shown only when the
 * span is at least 30 days.
 */
type Trade = Record<string, any>;
export interface CapitalStats {
  capital: number;
  returnPct: number;
  /** simple return scaled to 365 days; null when the span is under 30 days or unknown */
  yearPct: number | null;
  spanDays: number | null;
  avgTradePct: number;
  avgLossPct: number | null;
  largestLossPct: number | null;
  worstDayPct: number | null;
  maxDDPct: number;
  /** share of all trades (0–1) that lost more than 1% / 2% of capital */
  over1: number;
  over2: number;
}

const dayOf = (t: Trade) => (t.exitDate || t.entryDate ? String(t.exitDate || t.entryDate).slice(0, 10) : null);

export function capitalStats(trades: Trade[], capital: number | null | undefined): CapitalStats | null {
  if (!capital || !(capital > 0)) return null;
  const T = (trades || []).filter((t) => Number.isFinite(t?.pnl));
  if (!T.length) return null;
  const pct = (v: number) => (v / capital) * 100;
  const net = T.reduce((s, t) => s + t.pnl, 0);
  const losses = T.filter((t) => t.pnl < 0);
  const days = new Map<string, number>();
  for (const t of T) { const d = dayOf(t); if (d) days.set(d, (days.get(d) || 0) + t.pnl); }
  const ds = [...days.keys()].sort();
  const spanDays = ds.length >= 2 ? Math.round((Date.parse(ds[ds.length - 1]) - Date.parse(ds[0])) / 86400e3) + 1 : null;
  // drawdown on the dated sequence when there is one, else on the file order
  const seq = ds.length >= 2 ? ds.map((d) => days.get(d)!) : T.map((t) => t.pnl);
  let cum = 0, peak = 0, dd = 0;
  for (const p of seq) { cum += p; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  return {
    capital,
    returnPct: pct(net),
    yearPct: spanDays && spanDays >= 30 ? pct(net) * (365 / spanDays) : null,
    spanDays,
    avgTradePct: pct(net / T.length),
    avgLossPct: losses.length ? pct(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : null,
    largestLossPct: losses.length ? pct(Math.min(...losses.map((t) => t.pnl))) : null,
    worstDayPct: days.size ? pct(Math.min(...days.values())) : null,
    maxDDPct: pct(dd),
    over1: T.filter((t) => t.pnl < -0.01 * capital).length / T.length,
    over2: T.filter((t) => t.pnl < -0.02 * capital).length / T.length,
  };
}
