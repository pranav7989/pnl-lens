/**
 * @file  packages/shared/src/plan/check.ts
 * @area  Desk
 * @what  Trade Check matcher + rules engine (architecture doc §8): check(line, context) describes a parsed plan line with the same features as the trader's history, matches it to their shown weak/strong habits (at most 2) and to every one of their own rules it breaks, and returns the doc's JSON contract; the same pure function runs in the browser (instant preview) and in the API (stored with check_version).
 */
/**
 * Chips state facts about the trader's own past and own rules, never what to do (templates.ts). Rule breaks always
 * show; history chips only for segments with enough evidence. A rule the data can't check yet (e.g. losses so far
 * today, which needs the Journal "taken" step of phase 3) is listed in `unavailable`, never guessed.
 */
import { features, type Facts, type Features, type FeatureName } from '../features/build';
import { topPatterns, type Pattern } from '../profile/build';
import { usualKey } from '../profile/source';
import { calcCharges, type ChargeRates, type BrokeragePlan, type DeskSegment } from '../desk/charges';
import { fmtMoney } from './build';
import type { ParsedLine, LineKind } from './parse';
import { CHECK_VERSION, TEXT, historyLine, ruleChip, ruleLabel, type RuleKind } from './templates';

export interface TraderRule { id: string | number; kind: RuleKind; params: any; active?: boolean }
export interface CheckProfile {
  version: number;
  currency: string;
  patterns: Pattern[];                 // shown, weak or strong
  usualQty: Record<string, number>;
  tradedUnderlyings: string[];
}
export interface ExpiryFact { underlying: string; exchange: string; expiry: string; kind: 'weekly' | 'monthly' }
export interface Costs { segment: DeskSegment; rates: ChargeRates; brokerage: BrokeragePlan }
/** another line of the same day (not removed), planned before this one */
export interface DayLine { lossAtSl: number | null }
export interface CheckContext {
  date: string;                        // the plan's day (IST)
  time: string;                        // now, HH:MM IST (used when the line has no time)
  expiries: ExpiryFact[];
  lotSize: (underlying: string) => number | null;
  costs?: (kind: LineKind, underlying: string) => Costs | null;
  profile: CheckProfile | null;
  rules: TraderRule[];
  others: DayLine[];
  now?: Date;
}
export type ChipLevel = 'block' | 'caution' | 'strength' | 'info';
export interface Chip {
  kind: 'rule' | 'history' | 'info';
  level: ChipLevel;
  text: string;
  key: string;                         // rule:<id> | history:<segment> | info:<name>
  rule_id?: string | number;
  segment_key?: string;
  n_trades?: number;
  n_days?: number;
  period?: string;
}
export interface CheckResult {
  check_version: string;
  profile_version: number | null;
  chips: Chip[];
  unavailable: string[];
  features: Features;
  qty: number | null;
  loss_at_sl: number | null;
}

const BSE = new Set(['SENSEX', 'BANKEX', 'SENSEX50']);
const isOption = (k: LineKind) => k === 'CE' || k === 'PE';
const hourOf = (hhmm: string) => Number(hhmm.slice(0, 2));

/** The contract a plan line would trade today: options the nearest expiry, futures the nearest monthly, from the expiry calendar. */
export function lineExpiry(p: ParsedLine, ctx: Pick<CheckContext, 'date' | 'expiries'>): ExpiryFact | null {
  if (p.kind === 'EQ' || !p.underlying) return null;
  const exchange = BSE.has(p.underlying) ? 'BSE' : 'NSE';
  return ctx.expiries
    .filter((e) => e.underlying === p.underlying && e.exchange === exchange && e.expiry >= ctx.date && (p.kind !== 'FUT' || e.kind === 'monthly'))
    .sort((a, b) => (a.expiry < b.expiry ? -1 : 1))[0] ?? null;
}

export function lineQty(p: ParsedLine, ctx: Pick<CheckContext, 'lotSize'>): number | null {
  if (p.qty != null) return p.qty;
  if (p.lots == null || !p.underlying) return null;
  const lot = p.kind === 'EQ' ? 1 : ctx.lotSize(p.underlying);
  return lot ? p.lots * lot : null;
}

/** The same facts a stored trade has, so the same feature function describes both (doc §4). */
export function lineFacts(p: ParsedLine, ctx: CheckContext): Facts {
  const exp = lineExpiry(p, ctx);
  return {
    underlying: p.underlying, kind: p.kind, side: p.side, date: ctx.date, hour: hourOf(p.time ?? ctx.time),
    expiry: exp?.expiry ?? null, expiryType: exp ? (exp.kind === 'weekly' ? 'Weekly' : 'Monthly') : null,
    qty: lineQty(p, ctx) ?? 0, entryPrice: p.entry,
  };
}

/** |entry − SL| × qty plus the round trip's charges (as the calculator), or null without an SL, quantity or rates. */
export function lossAtStop(p: ParsedLine, qty: number | null, costs: Costs | null): number | null {
  if (p.entry == null || p.sl == null || !qty || !p.side) return null;
  const gap = Math.abs(p.entry - p.sl) * qty;
  if (!costs) return gap;
  const buy = p.side === 'buy' ? p.entry : p.sl, sell = p.side === 'buy' ? p.sl : p.entry;
  return gap + calcCharges({ segment: costs.segment, buy, sell, qty, rates: costs.rates, brokerage: costs.brokerage }).total;
}

export function check(p: ParsedLine, ctx: CheckContext): CheckResult {
  const now = ctx.now ?? new Date();
  const qty = lineQty(p, ctx);
  const prof = ctx.profile;
  const f = features(lineFacts(p, ctx), {
    medianQty: (u, inst) => prof?.usualQty[usualKey(u, inst)] ?? null,
    expiryKind: (u, e) => ctx.expiries.find((x) => x.underlying === u && x.expiry === e)?.kind ?? null,
    sessionSeq: ctx.others.length + 1,
  });
  const costs = p.underlying ? ctx.costs?.(p.kind, p.underlying) ?? null : null;
  const loss = lossAtStop(p, qty, costs);
  const currency = prof?.currency ?? 'INR';
  const unavailable = new Set<string>();
  if (!isOption(p.kind) && p.kind !== 'FUT') { /* equity: no expiry features */ } else if (!f.dte) unavailable.add('dte');
  if (qty == null) unavailable.add('size_ratio');
  const chips: Chip[] = [];

  // every rule the line breaks (doc §8, kinds v1)
  for (const r of ctx.rules.filter((x) => x.active !== false)) {
    const label = ruleLabel(r.kind, r.params, currency), key = `rule:${r.id}`;
    const block = (detail?: string) => chips.push({ kind: 'rule', level: 'block', key, rule_id: r.id, text: ruleChip(label, detail) });
    switch (r.kind) {
      case 'max_trades_day': {
        const n = ctx.others.length + 1;
        if (n > Number(r.params?.n)) block(TEXT.tradeOfDay(n));
        break;
      }
      case 'max_daily_loss': {
        if (loss == null) { chips.push({ kind: 'info', level: 'info', key: 'info:add_stop_loss', text: TEXT.addStopLoss }); break; }
        const total = loss + ctx.others.reduce((s, o) => s + (o.lossAtSl ?? 0), 0);
        if (total > Number(r.params?.amount)) block(TEXT.plannedLoss(fmtMoney(total, currency)));
        break;
      }
      case 'stop_after_losses':
        unavailable.add('losses_today');                // needs the Journal "taken / result" step (doc phase 3)
        break;
      case 'max_lots': {
        if (r.params?.lots != null && p.lots != null && p.lots > Number(r.params.lots)) block(TEXT.sizeNow(`${p.lots} lots`));
        else if (r.params?.lots != null && p.lots == null && qty != null && p.underlying) {
          const lot = ctx.lotSize(p.underlying);
          if (lot && qty / lot > Number(r.params.lots)) block(TEXT.sizeNow(`${Math.round((qty / lot) * 10) / 10} lots`));
        }
        if (r.params?.ratio != null && qty != null) {
          const usual = prof?.usualQty[usualKey(p.underlying, f.instrument!)];
          if (usual && qty / usual > Number(r.params.ratio)) block(TEXT.sizeNow(`${Math.round((qty / usual) * 10) / 10}× your usual size`));
        }
        break;
      }
      case 'no_segment': {
        const dims = (r.params?.dims ?? {}) as Partial<Record<FeatureName, string>>;
        if (Object.keys(dims).length && Object.entries(dims).every(([k, v]) => f[k as FeatureName] === v)) block();
        break;
      }
      case 'time_window': {
        const at = p.time ?? ctx.time;
        if (at < String(r.params?.from) || at > String(r.params?.to)) block(`planned at ${at}`);
        break;
      }
    }
  }

  // the trader's own history on similar trades (at most 2; weak first)
  if (!prof) {
    chips.push({ kind: 'info', level: 'info', key: 'info:no_profile', text: TEXT.noProfile });
  } else {
    const matches = prof.patterns.filter((x) => x.shown && x.verdict !== 'neutral' && Object.entries(x.dims).every(([k, v]) => f[k as FeatureName] === v));
    const newUnderlying = !!p.underlying && !prof.tradedUnderlyings.includes(p.underlying);
    for (const m of topPatterns(matches, 2, 0)) {
      chips.push({
        kind: 'history', level: m.verdict === 'weak' ? 'caution' : 'strength', key: `history:${m.segment_key}`, segment_key: m.segment_key,
        n_trades: m.n_trades, n_days: m.n_days, period: [m.period_from, m.period_to].join('/'),
        text: historyLine(m, currency, now) + (newUnderlying && !m.dims.underlying ? TEXT.acrossUnderlyings : ''),
      });
    }
  }
  const order: Record<ChipLevel, number> = { block: 0, info: 1, caution: 2, strength: 3 };
  chips.sort((a, b) => order[a.level] - order[b.level]);
  return { check_version: CHECK_VERSION, profile_version: prof?.version ?? null, chips, unavailable: [...unavailable].sort(), features: f, qty, loss_at_sl: loss };
}

/** What the API sends to the browser (GET /desk/context) and uses itself: plain JSON, turned into a context the same way on both sides. */
export interface CheckContextData {
  date: string;
  time: string;
  expiries: ExpiryFact[];
  lots: Record<string, number>;
  costs: Partial<Record<DeskSegment, Partial<Record<'NSE' | 'BSE', { rates: ChargeRates; brokerage: BrokeragePlan }>>>>;
  profile: CheckProfile | null;
  rules: TraderRule[];
}
const SEGMENT_OF: Record<LineKind, DeskSegment> = { CE: 'options', PE: 'options', FUT: 'futures', EQ: 'eq_intraday' };

export function contextFrom(d: CheckContextData, others: DayLine[] = [], now?: Date): CheckContext {
  return {
    date: d.date, time: d.time, expiries: d.expiries, profile: d.profile, rules: d.rules, others, now,
    lotSize: (u) => d.lots[u] ?? null,
    costs: (kind, u) => {
      const segment = SEGMENT_OF[kind], c = d.costs[segment]?.[BSE.has(u) ? 'BSE' : 'NSE'];
      return c ? { segment, rates: c.rates, brokerage: c.brokerage } : null;
    },
  };
}

/** Check every line of a day in order: each line sees the lines before it that weren't removed (trades of the day, planned losses). */
export function checkDay<L extends { parsed: ParsedLine; removed: boolean }>(lines: L[], d: CheckContextData, now?: Date): (CheckResult | null)[] {
  const before: DayLine[] = [];
  return lines.map((l) => {
    if (l.removed) return null;
    const r = check(l.parsed, contextFrom(d, [...before], now));
    before.push({ lossAtSl: r.loss_at_sl });
    return r;
  });
}
