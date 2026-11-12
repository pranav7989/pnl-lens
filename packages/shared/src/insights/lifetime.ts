/**
 * @file  packages/shared/src/insights/lifetime.ts
 * @area  Reports
 * @what  Lifetime view: merges the closed trades of all a user's live reports (per currency), counting a trade that appears in several reports (the same statement uploaded twice, overlapping periods) once; summary, months and each report's share.
 */
/**
 * Pure and deterministic. A trade's identity is its symbol, dates, entry hour, quantity, buy and sell value and P&L.
 * Within one report two identical trades are two real trades; across reports the same trade is counted as many times
 * as the report with the most copies of it has it (so a re-uploaded statement adds nothing). Each kept trade is
 * credited to the earliest report that has it. Undated statements can make two different but identical-looking
 * trades in different files collapse into one; that is rare and stated in the UI.
 */
type Trade = Record<string, any>;
export interface LifetimeReport { id: string; name: string; createdAt: string; currency: string; trades: Trade[] }
export interface ReportShare { id: string; name: string; createdAt: string; trades: number; unique: number; net: number }
export interface Lifetime {
  currency: string;
  trades: Trade[];
  reports: ReportShare[];
  duplicates: number;
  from: string | null; to: string | null;
  net: number; n: number; winRate: number; avg: number;
  months: { key: string; n: number; pnl: number }[];
  bestMonth: { key: string; pnl: number } | null;
  worstMonth: { key: string; pnl: number } | null;
}

const r2 = (v: any) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : '');
export const tradeKey = (t: Trade) => [t.symbol, t.entryDate || '', t.exitDate || '', t.entryHour ?? '', t.qty ?? '', r2(t.buy), r2(t.sell), r2(t.pnl)].join('|');
const dateOf = (t: Trade) => (t.exitDate || t.entryDate ? String(t.exitDate || t.entryDate).slice(0, 10) : null);

/** the currencies present, most trades first */
export function lifetimeCurrencies(reports: LifetimeReport[]): { currency: string; reports: number; trades: number }[] {
  const by = new Map<string, { reports: number; trades: number }>();
  for (const r of reports) { const c = (r.currency || 'INR').toUpperCase(); const g = by.get(c) || { reports: 0, trades: 0 }; g.reports++; g.trades += (r.trades || []).length; by.set(c, g); }
  return [...by.entries()].map(([currency, g]) => ({ currency, ...g })).sort((a, b) => b.trades - a.trades || a.currency.localeCompare(b.currency));
}

export function mergeReports(all: LifetimeReport[], currency: string): Lifetime {
  const reports = all.filter((r) => (r.currency || 'INR').toUpperCase() === currency.toUpperCase()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const kept = new Map<string, number>();             // key → copies kept so far
  const trades: Trade[] = [];
  const shares: ReportShare[] = [];
  let total = 0;
  for (const r of reports) {
    const T = (r.trades || []).filter((t) => Number.isFinite(t?.pnl));
    const seen = new Map<string, number>();            // copies of each key in this report
    let unique = 0, net = 0;
    for (const t of T) {
      const k = tradeKey(t), c = (seen.get(k) || 0) + 1;
      seen.set(k, c);
      if (c > (kept.get(k) || 0)) { kept.set(k, c); trades.push(t); unique++; net += t.pnl; }
    }
    total += T.length;
    shares.push({ id: r.id, name: r.name, createdAt: r.createdAt, trades: T.length, unique, net });
  }
  const sorted = [...trades].sort((a, b) => { const x = dateOf(a), y = dateOf(b); return x && y ? (x < y ? -1 : x > y ? 1 : (a.entryHour ?? 0) - (b.entryHour ?? 0)) : x ? -1 : y ? 1 : 0; });
  const months = new Map<string, { n: number; pnl: number }>();
  for (const t of sorted) { const d = dateOf(t); if (!d) continue; const k = d.slice(0, 7); const m = months.get(k) || { n: 0, pnl: 0 }; m.n++; m.pnl += t.pnl; months.set(k, m); }
  const monthList = [...months.entries()].map(([key, m]) => ({ key, ...m })).sort((a, b) => (a.key < b.key ? -1 : 1));
  const dated = sorted.map(dateOf).filter(Boolean) as string[];
  const net = sorted.reduce((s, t) => s + t.pnl, 0), n = sorted.length;
  const best = monthList.length ? monthList.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null, worst = monthList.length ? monthList.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null;
  return {
    currency: currency.toUpperCase(), trades: sorted, reports: shares, duplicates: total - n,
    from: dated[0] ?? null, to: dated[dated.length - 1] ?? null,
    net, n, winRate: n ? sorted.filter((t) => t.pnl > 0).length / n : 0, avg: n ? net / n : 0,
    months: monthList,
    bestMonth: best && best.pnl > 0 ? { key: best.key, pnl: best.pnl } : null,
    worstMonth: worst && worst.pnl < 0 ? { key: worst.key, pnl: worst.pnl } : null,
  };
}
