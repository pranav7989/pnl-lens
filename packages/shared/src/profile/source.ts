/**
 * @file  packages/shared/src/profile/source.ts
 * @area  Desk
 * @what  From a trader's live reports to a Trade Check profile: main currency, a trade in several reports counted once (same rule as Lifetime), the day's entry order and losses before each entry, the usual size per underlying, features for every trade, then buildProfile.
 */
import { tradeKey } from '../insights/lifetime';
import { features, factsFromTrade, unavailable, type Features, type FeatureName } from '../features/build';
import { buildProfile, type Profile } from './build';

export interface SourceRow { reportId: string; createdAt: string; currency: string; tradeId: number | null; trade: any }
export interface PreparedTrade { tradeId: number | null; features: Features; pnl: number; day: string | null; expiry: string | null; qty: number }
export interface Prepared { currency: string; trades: PreparedTrade[]; reportIds: string[]; unavailable: FeatureName[]; usualQty: Record<string, number> }

/** key of the trader's usual quantity: "NIFTY|option" (also used for plan lines) */
export const usualKey = (underlying: string | null | undefined, instrument: string) => `${String(underlying ?? '').trim().toUpperCase()}|${instrument}`;
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function prepare(rows: SourceRow[]): Prepared {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? 'INR';

  // a trade that appears in several reports (same statement twice, overlapping periods) counts once
  const kept = new Map<string, number>(), picked: SourceRow[] = [], seenIn = new Map<string, Map<string, number>>();
  for (const r of rows.filter((x) => x.currency === currency && Number.isFinite(Number(x.trade?.pnl)))) {
    const seen = seenIn.get(r.reportId) ?? new Map<string, number>(); seenIn.set(r.reportId, seen);
    const k = tradeKey(r.trade), c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    if (c > (kept.get(k) ?? 0)) { kept.set(k, c); picked.push(r); }
  }

  const facts = picked.map((r) => factsFromTrade(r.trade));
  // usual size per underlying + instrument
  const qtys = new Map<string, number[]>();
  facts.forEach((f) => { const k = usualKey(f.underlying, f.kind === 'EQ' ? 'equity' : f.kind === 'FUT' ? 'future' : 'option'); qtys.set(k, [...(qtys.get(k) ?? []), f.qty]); });
  const medians = new Map([...qtys].map(([k, v]) => { const s = v.filter((q) => q > 0).sort((a, b) => a - b), m = s.length >> 1; return [k, s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null]; }));

  // place in the day and losses among the day's earlier entries (entry order: hour, then position in the report)
  const seq = new Map<number, { n: number; losses: number }>();
  const byDay = new Map<string, number[]>();
  facts.forEach((f, i) => { if (f.date) byDay.set(f.date, [...(byDay.get(f.date) ?? []), i]); });
  for (const idx of byDay.values()) {
    idx.sort((a, b) => (facts[a].hour ?? 99) - (facts[b].hour ?? 99) || a - b);
    let losses = 0;
    idx.forEach((i, n) => { seq.set(i, { n: n + 1, losses }); if (Number(picked[i].trade.pnl) < 0) losses++; });
  }
  const hasTimes = facts.some((f) => f.hour != null);

  const trades: PreparedTrade[] = picked.map((r, i) => {
    const f = facts[i], s = seq.get(i);
    const feats = features(f, {
      medianQty: (u, inst) => medians.get(usualKey(u, inst)) ?? null,
      sessionSeq: hasTimes ? s?.n ?? null : null, afterLosses: hasTimes ? s?.losses ?? null : null,
    });
    // statements without dates: the contract expiry stands in for the day, so "4 different days" still means something
    const day = f.date ?? (isDay(r.trade?.exitDate) ? r.trade.exitDate : null) ?? f.expiry;
    return { tradeId: r.tradeId, features: feats, pnl: Number(r.trade.pnl), day, expiry: f.expiry, qty: f.qty };
  });
  const usualQty = Object.fromEntries([...medians].filter((e): e is [string, number] => e[1] != null));
  return { currency, trades, reportIds: [...new Set(picked.map((r) => r.reportId))], unavailable: unavailable(trades.map((t) => t.features)), usualQty };
}

export function profileFromRows(rows: SourceRow[], now: Date): { prepared: Prepared; profile: Profile } {
  const prepared = prepare(rows);
  return { prepared, profile: buildProfile(prepared.trades, now, prepared.trades.map((t) => t.qty)) };
}
