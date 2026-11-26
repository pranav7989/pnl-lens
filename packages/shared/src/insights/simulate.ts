/**
 * @file  packages/shared/src/insights/simulate.ts
 * @area  Reports
 * @what  Rewind: replays a report's own closed trades under rules the user picks (stop at −X%, skip weekdays or hours, max trades a day, stop after N losses, no re-entry after a loss, skip names, cap size) and returns the new P&L, curve and what each rule changed.
 */
/**
 * Pure and deterministic; runs in the browser on the trades the report already carries (the engine is not touched).
 * It is a replay of the user's own trades, not a forecast: removed trades are simply not taken, and a stop turns a
 * deeper loss into a loss of exactly X% of the position's buy value (no slippage). Rules that need dates or entry
 * times are ignored for trades that have none, and `available` tells the UI which rules the statement supports.
 */
export interface RewindRules {
  /** cap every loss at −X% of the position's buy value (trades that lost more) */
  stopPct?: number | null;
  /** skip trades opened on these weekdays ('Monday' … 'Friday') */
  skipWeekdays?: string[];
  /** skip trades opened in these clock hours (9 = 09:00–09:59) */
  skipHours?: number[];
  /** take at most N trades a day (the first N by entry time) */
  maxPerDay?: number | null;
  /** stop for the day after N losing trades */
  stopAfterLosses?: number | null;
  /** no new trade on the same day after a losing one */
  noReentryAfterLoss?: boolean;
  /** skip these underlyings (or symbols) */
  skipNames?: string[];
  /** skip positions whose buy value is above this */
  maxSize?: number | null;
}
export type RuleKey = keyof RewindRules;

export interface Stats { n: number; net: number; wins: number; losses: number; winRate: number; maxDD: number; avg: number }
export interface RewindResult {
  actual: Stats;
  rewound: Stats;
  /** rewound.net − actual.net */
  delta: number;
  skipped: number;
  stopped: number;
  /** cumulative P&L after each trade, in date order (the skipped trades add 0 on the rewound line) */
  curve: { actual: number[]; rewound: number[] };
  /** what each active rule changes on its own (they overlap, so these do not add up to delta) */
  byRule: { rule: RuleKey; delta: number; skipped: number; stopped: number }[];
  /** which rules this statement can show */
  available: Record<RuleKey, boolean>;
}

import type { Plan } from '../plan/build';

type Trade = Record<string, any>;
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayOf = (t: Trade): string | null => (t.entryDate || t.exitDate ? String(t.entryDate || t.exitDate).slice(0, 10) : null);
export const entryWeekday = (t: Trade): string | null => (t.entryDate ? DOW[new Date(String(t.entryDate).slice(0, 10) + 'T00:00:00Z').getUTCDay()] : null);
const nameOf = (t: Trade) => String(t.underlying || t.symbol || '');

/** the closed trades in the order they were taken (undated ones keep their file order, after the dated ones) */
export function orderTrades(trades: Trade[]): Trade[] {
  const T = (trades || []).filter((t) => Number.isFinite(t?.pnl));
  const idx = new Map(T.map((t, i) => [t, i]));
  return [...T].sort((a, b) => {
    const da = dayOf(a), db = dayOf(b);
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (!!da !== !!db) return da ? -1 : 1;
    const ha = Number.isFinite(a.entryHour) ? a.entryHour : 99, hb = Number.isFinite(b.entryHour) ? b.entryHour : 99;
    return ha - hb || idx.get(a)! - idx.get(b)!;
  });
}

function stats(pnls: number[]): Stats {
  let cum = 0, peak = 0, maxDD = 0, wins = 0, losses = 0;
  for (const p of pnls) { cum += p; peak = Math.max(peak, cum); maxDD = Math.min(maxDD, cum - peak); if (p > 0) wins++; else if (p < 0) losses++; }
  const n = pnls.length;
  return { n, net: cum, wins, losses, winRate: n ? wins / n : 0, maxDD, avg: n ? cum / n : 0 };
}

function hasAny(rules: RewindRules): boolean {
  return !!(rules.stopPct || rules.skipWeekdays?.length || rules.skipHours?.length || rules.maxPerDay || rules.stopAfterLosses
    || rules.noReentryAfterLoss || rules.skipNames?.length || rules.maxSize);
}

/** one pass: for each trade (in order) the P&L it would have had (null = not taken) */
function replay(T: Trade[], rules: RewindRules): { pnl: (number | null)[]; skipped: number; stopped: number } {
  const out: (number | null)[] = [];
  let skipped = 0, stopped = 0;
  const day = { key: '', taken: 0, losses: 0, lastLoss: false };
  const skipNames = new Set((rules.skipNames || []).map(String));
  const skipDays = new Set(rules.skipWeekdays || []), skipHours = new Set(rules.skipHours || []);
  for (const t of T) {
    const d = dayOf(t);
    if (d && d !== day.key) Object.assign(day, { key: d, taken: 0, losses: 0, lastLoss: false });
    let skip = false;
    if (skipNames.size && skipNames.has(nameOf(t))) skip = true;
    if (!skip && rules.maxSize && Number(t.buy) > rules.maxSize) skip = true;
    if (!skip && skipDays.size) { const w = entryWeekday(t); if (w && skipDays.has(w)) skip = true; }
    if (!skip && skipHours.size && Number.isFinite(t.entryHour) && skipHours.has(t.entryHour)) skip = true;
    if (!skip && d) {
      if (rules.maxPerDay && day.taken >= rules.maxPerDay) skip = true;
      else if (rules.stopAfterLosses && day.losses >= rules.stopAfterLosses) skip = true;
      else if (rules.noReentryAfterLoss && day.lastLoss) skip = true;
    }
    if (skip) { out.push(null); skipped++; continue; }
    let p = Number(t.pnl);
    if (rules.stopPct && rules.stopPct > 0 && Number(t.pct) < -rules.stopPct && Number(t.buy) > 0) {
      const capped = -(rules.stopPct / 100) * Number(t.buy);
      if (capped > p) { p = capped; stopped++; }
    }
    out.push(p);
    if (d) { day.taken++; if (p < 0) { day.losses++; day.lastLoss = true; } else day.lastLoss = false; }
  }
  return { pnl: out, skipped, stopped };
}

export function rewind(trades: Trade[], rules: RewindRules = {}): RewindResult {
  const T = orderTrades(trades);
  const actualP = T.map((t) => Number(t.pnl));
  const run = replay(T, rules);
  const taken = run.pnl.filter((p): p is number => p !== null);
  const cum = (xs: number[]) => { let c = 0; return xs.map((x) => (c += x)); };
  const actual = stats(actualP), rewound = stats(taken);
  const dated = T.some((t) => dayOf(t)), timed = T.some((t) => Number.isFinite(t.entryHour)), weekdays = T.some((t) => t.entryDate);
  const byRule: RewindResult['byRule'] = [];
  if (hasAny(rules)) {
    for (const k of Object.keys(rules) as RuleKey[]) {
      const v = rules[k];
      if (!v || (Array.isArray(v) && !v.length)) continue;
      const one = replay(T, { [k]: v } as RewindRules);
      byRule.push({ rule: k, delta: one.pnl.reduce<number>((s, p) => s + (p ?? 0), 0) - actual.net, skipped: one.skipped, stopped: one.stopped });
    }
    byRule.sort((a, b) => b.delta - a.delta);
  }
  return {
    actual, rewound, delta: rewound.net - actual.net, skipped: run.skipped, stopped: run.stopped,
    curve: { actual: cum(actualP), rewound: cum(run.pnl.map((p) => p ?? 0)) },
    byRule,
    available: {
      stopPct: T.some((t) => Number(t.buy) > 0 && Number.isFinite(t.pct)),
      skipWeekdays: weekdays, skipHours: timed, maxPerDay: dated, stopAfterLosses: dated, noReentryAfterLoss: dated,
      skipNames: new Set(T.map(nameOf)).size > 1, maxSize: T.some((t) => Number(t.buy) > 0),
    },
  };
}

/** names worth offering as "skip": the ones that lost money, worst first */
export function losingNames(trades: Trade[], limit = 6): { name: string; pnl: number; n: number }[] {
  const by = new Map<string, { pnl: number; n: number }>();
  for (const t of orderTrades(trades)) { const k = nameOf(t); const g = by.get(k) || { pnl: 0, n: 0 }; g.pnl += Number(t.pnl); g.n++; by.set(k, g); }
  return [...by.entries()].map(([name, g]) => ({ name, ...g })).filter((g) => g.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, limit);
}

/** the entry hours present in the trades, with their P&L (for the hour chips) */
export function entryHours(trades: Trade[]): { hour: number; pnl: number; n: number }[] {
  const by = new Map<number, { pnl: number; n: number }>();
  for (const t of trades || []) if (Number.isFinite(t?.entryHour) && Number.isFinite(t?.pnl)) { const g = by.get(t.entryHour) || { pnl: 0, n: 0 }; g.pnl += t.pnl; g.n++; by.set(t.entryHour, g); }
  return [...by.entries()].map(([hour, g]) => ({ hour, ...g })).sort((a, b) => a.hour - b.hour);
}

/** the 30-day plan's measurable rules as Rewind settings ("what if I had followed my plan?") */
export function planRules(plan: Pick<Plan, 'dos' | 'donts'>): RewindRules {
  const r: RewindRules = {};
  for (const x of [...plan.dos, ...plan.donts]) {
    const m = x.metric;
    if (x.id === 'hold-past-stop' && m?.param) r.stopPct = Number(String(m.param).split(':')[1]) || null;
    else if (x.id === 'avoid-worst' && m?.param) r.skipNames = [...(r.skipNames || []), m.param];
    else if (x.id === 're-entry') r.noReentryAfterLoss = true;
    else if (x.id === 'streak') r.stopAfterLosses = 3;
    else if (x.id === 'size-band' && m) r.maxSize = m.target;
  }
  return r;
}
