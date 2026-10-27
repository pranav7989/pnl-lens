/**
 * @file  packages/shared/src/insights/deep.ts
 * @area  Reports
 * @what  Deep dive on a report's own trades: consistency and risk by day (green days, Sharpe/Sortino-style ratios, drawdown length and recovery, R-multiples, how concentrated the profit is) and timing (weekday × hour heatmap, options by days to expiry).
 */
/**
 * Pure and deterministic; read-only over the stored report's trades (the engine is not touched). Daily figures need
 * exit or entry dates; timing needs entry dates and hours; days to expiry needs options with an entry date and an
 * expiry. Each section is null when the statement cannot show it.
 */
type Trade = Record<string, any>;
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY = 86400e3;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const sd = (xs: number[]) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1)); };
const closed = (trades: Trade[]) => (trades || []).filter((t) => Number.isFinite(t?.pnl));
const dayOf = (t: Trade): string | null => (t.exitDate || t.entryDate ? String(t.exitDate || t.entryDate).slice(0, 10) : null);

export interface Bucket { key: string; n: number; pnl: number; winRate: number }
const bucket = (key: string, xs: Trade[]): Bucket => ({ key, n: xs.length, pnl: sum(xs.map((t) => t.pnl)), winRate: xs.length ? xs.filter((t) => t.pnl > 0).length / xs.length : 0 });

/* ------------------------------------------------------------------ consistency and risk */
export interface Consistency {
  days: number;
  greenDays: number;               // share 0–1
  avgDay: number;
  bestDay: { date: string; pnl: number };
  worstDay: { date: string; pnl: number };
  /** worst day ÷ average losing day (how far the worst day sits from a normal bad day) */
  worstVsTypicalLoss: number | null;
  /** daily mean ÷ daily spread × √252 (Sharpe-style, no risk-free rate); null with fewer than 10 days */
  sharpe: number | null;
  /** daily mean ÷ downside spread × √252 (Sortino-style) */
  sortino: number | null;
  maxDD: number;
  /** trading days from the peak before the worst drawdown to the day it was made back (null = not yet) */
  ddDays: number;
  recoveryDays: number | null;
  /** trading days since the last high (0 = at a high now) */
  underwaterNow: number;
  /** share of the total profit made on the 3 best days (null when there is no net profit) */
  top3Share: number | null;
  /** share of months that ended green */
  greenMonths: number | null;
}

export function consistency(trades: Trade[]): Consistency | null {
  const by = new Map<string, number>();
  for (const t of closed(trades)) { const d = dayOf(t); if (d) by.set(d, (by.get(d) || 0) + t.pnl); }
  const days = [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (days.length < 5) return null;
  const pnl = days.map((d) => d[1]);
  const losing = pnl.filter((p) => p < 0);
  const best = days.reduce((a, b) => (b[1] > a[1] ? b : a)), worst = days.reduce((a, b) => (b[1] < a[1] ? b : a));
  // drawdown in days
  let cum = 0, peak = 0, peakAt = -1, maxDD = 0, ddStart = -1, ddTrough = -1;
  const cums: number[] = [];
  pnl.forEach((p, i) => {
    cum += p; cums.push(cum);
    if (cum > peak) { peak = cum; peakAt = i; }
    if (cum - peak < maxDD) { maxDD = cum - peak; ddStart = peakAt; ddTrough = i; }
  });
  let recoveryDays: number | null = null;
  if (ddTrough >= 0) {
    const level = ddStart >= 0 ? cums[ddStart] : 0;
    for (let i = ddTrough + 1; i < cums.length; i++) if (cums[i] >= level) { recoveryDays = i - ddTrough; break; }
  }
  const lastHigh = cums.reduce((best, c, i) => (c >= cums[best] ? i : best), 0);
  const total = sum(pnl);
  const top3 = [...pnl].sort((a, b) => b - a).slice(0, 3).filter((p) => p > 0);
  const months = new Map<string, number>();
  for (const [d, p] of days) months.set(d.slice(0, 7), (months.get(d.slice(0, 7)) || 0) + p);
  const s = sd(pnl), down = Math.sqrt(mean(pnl.map((p) => Math.min(0, p) ** 2)));
  return {
    days: days.length,
    greenDays: pnl.filter((p) => p > 0).length / days.length,
    avgDay: mean(pnl),
    bestDay: { date: best[0], pnl: best[1] }, worstDay: { date: worst[0], pnl: worst[1] },
    worstVsTypicalLoss: losing.length >= 2 ? worst[1] / mean(losing) : null,
    sharpe: days.length >= 10 && s > 0 ? (mean(pnl) / s) * Math.sqrt(252) : null,
    sortino: days.length >= 10 && down > 0 ? (mean(pnl) / down) * Math.sqrt(252) : null,
    maxDD,
    ddDays: ddTrough >= 0 ? ddTrough - Math.max(0, ddStart) : 0,
    recoveryDays,
    underwaterNow: cums.length - 1 - lastHigh,
    top3Share: total > 0 ? Math.min(1, sum(top3) / total) : null,
    greenMonths: months.size >= 2 ? [...months.values()].filter((p) => p > 0).length / months.size : null,
  };
}

/* ------------------------------------------------------------------ R-multiples */
export interface RMultiples { r: number; buckets: Bucket[]; avgR: number; bigWins: number; bigLosses: number }
const R_BUCKETS: [string, number, number][] = [['−2R or worse', -Infinity, -2], ['−2R to −1R', -2, -1], ['−1R to 0', -1, 0], ['0 to 1R', 0, 1], ['1R to 2R', 1, 2], ['2R to 3R', 2, 3], ['3R or more', 3, Infinity]];

/** 1R = the average losing trade; each trade's P&L in R */
export function rMultiples(trades: Trade[]): RMultiples | null {
  const T = closed(trades), losses = T.filter((t) => t.pnl < 0);
  if (T.length < 10 || losses.length < 3) return null;
  const r = Math.abs(mean(losses.map((t) => t.pnl)));
  const inR = (t: Trade) => t.pnl / r;
  // [lo, hi) ranges; the first and last are open-ended
  const buckets = R_BUCKETS.map(([key, lo, hi]) => bucket(key, T.filter((t) => { const x = inR(t); return x >= lo && x < hi; })));
  return { r, buckets, avgR: mean(T.map(inR)), bigWins: T.filter((t) => inR(t) >= 2).length, bigLosses: T.filter((t) => inR(t) <= -2).length };
}

/* ------------------------------------------------------------------ timing */
export interface Heatmap { days: string[]; hours: number[]; cells: Record<string, { n: number; pnl: number }>; best: { day: string; hour: number; pnl: number } | null; worst: { day: string; hour: number; pnl: number } | null }

/** entry weekday × entry hour */
export function heatmap(trades: Trade[]): Heatmap | null {
  const T = closed(trades).filter((t) => t.entryDate && Number.isFinite(t.entryHour));
  if (T.length < 10) return null;
  const cells: Heatmap['cells'] = {};
  for (const t of T) {
    const d = DOW[new Date(String(t.entryDate).slice(0, 10) + 'T00:00:00Z').getUTCDay()], k = `${d}|${t.entryHour}`;
    const c = cells[k] || { n: 0, pnl: 0 }; c.n++; c.pnl += t.pnl; cells[k] = c;
  }
  const days = DOW.filter((d) => Object.keys(cells).some((k) => k.startsWith(d + '|')));
  const hours = [...new Set(T.map((t) => t.entryHour as number))].sort((a, b) => a - b);
  if (hours.length < 2 && days.length < 2) return null;
  const list = Object.entries(cells).map(([k, c]) => { const [day, h] = k.split('|'); return { day, hour: Number(h), pnl: c.pnl, n: c.n }; }).filter((c) => c.n >= 2);
  const best = list.length ? list.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null, worst = list.length ? list.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null;
  return { days, hours, cells, best: best && best.pnl > 0 ? { day: best.day, hour: best.hour, pnl: best.pnl } : null, worst: worst && worst.pnl < 0 ? { day: worst.day, hour: worst.hour, pnl: worst.pnl } : null };
}

export const DTE_ORDER = ['Expiry day (0)', '1–2 days', '3–7 days', '8+ days'];
/** options by calendar days from entry to expiry */
export function daysToExpiry(trades: Trade[]): Bucket[] | null {
  const dte = (t: Trade) => Math.round((Date.parse(String(t.expiry).slice(0, 10)) - Date.parse(String(t.entryDate).slice(0, 10))) / DAY);
  // an expiry before the entry date means the contract name was read ambiguously: leave those trades out
  const T = closed(trades).filter((t) => t.isOpt && t.entryDate && t.expiry && dte(t) >= 0);
  if (T.length < 5) return null;
  const key = (t: Trade) => { const d = dte(t); return d === 0 ? DTE_ORDER[0] : d <= 2 ? DTE_ORDER[1] : d <= 7 ? DTE_ORDER[2] : DTE_ORDER[3]; };
  const out = DTE_ORDER.map((k) => bucket(k, T.filter((t) => key(t) === k))).filter((b) => b.n > 0);
  return out.length >= 2 ? out : null;
}
