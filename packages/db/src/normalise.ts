/**
 * @file  packages/db/src/normalise.ts
 * @area  Database
 * @what  Maps one engine ReportV1 to rows for trades, report_metrics and report_traits (pure; used by the worker store step), plus the file-set fingerprint.
 */
/**
 * The engine is not changed (rule 1): this only reshapes its serialised output. The payload stored in
 * reports.report and these rows come from the same ReportV1, so they always agree. Non-finite numbers
 * become null here, exactly as JSON.stringify does for the payload.
 * Not covered here: fills (they come from parsed sheets, not ReportV1, so the worker builds them in
 * Phase 5) and per-trade source files (the engine merges all files before matching trades).
 */
import type { ReportV1, ReportTrade, BehaviourTrait } from '@pnl-lens/engine/types';
import type { NewReportMetrics, NewReportTrait, NewTrade } from './types.js';

export interface NormaliseContext {
  analysisId: string;
  userId: string;
  engineVersion: string;
  broker?: string | null;
  /** only when the analysis read exactly one file */
  sourceFileId?: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => { const n = num(v); return n === null ? null : Math.round(n); };
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const date = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** FNV-style hash, identical to apps/web/offline/app_offline.js `fnv`. */
export function fnv(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 16777619);
    h2 ^= c; h2 = Math.imul(h2, 2246822519);
  }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

const tradeKey = (t: Pick<ReportTrade, 'symbol' | 'exitDate' | 'qty' | 'pnl'>) => [t.symbol, t.exitDate || '', t.qty, Math.round(t.pnl)].join('|');

/**
 * Fingerprint of one statement file for the file-set lock (statement_files.fingerprint): the same rule as the
 * offline tool, so a renamed or re-saved copy of the same statement matches. Pass the trades from analysing
 * that file alone.
 */
export function tradeSetFingerprint(trades: Pick<ReportTrade, 'symbol' | 'exitDate' | 'qty' | 'pnl'>[]): string {
  return 't' + fnv(trades.map(tradeKey).sort().join('\n'));
}

export function toTradeRows(report: ReportV1, ctx: NormaliseContext): NewTrade[] {
  const currency = report.m.currency;
  return report.trades.map((t: any, seq) => ({
    analysis_id: ctx.analysisId,
    user_id: ctx.userId,
    source_file_id: ctx.sourceFileId ?? null,
    seq,
    symbol: String(t.symbol),
    underlying: str(t.underlying),
    market: str(t.market),
    segment: str(t.segment),
    kind: t.kind,
    grp: str(t.group),
    family: str(t.family),
    direction: t.direction === 'Long' || t.direction === 'Short' ? t.direction : null,
    entry_date: date(t.entryDate),
    exit_date: date(t.exitDate),
    entry_hour: int(t.entryHour),
    hold_days: num(t.holdDays),
    sell_days: num(t.sellDays),
    expiry: date(t.expiry),
    expiry_type: str(t.expiryType),
    weekday: str(t.weekday),
    strike: null,
    qty: num(t.qty) ?? 0,
    open_qty: num(t.openQty),
    avg_buy: num(t.avgBuy),
    buy: num(t.buy),
    sell: num(t.sell),
    pnl: num(t.pnl) ?? 0,
    net_est: num(t.netEst),
    pct: num(t.pct),
    style: str(t.style),
    n_legs: int(t.nLegs),
    mult: num(t.mult),
    is_opt: typeof t.isOpt === 'boolean' ? t.isOpt : null,
    currency,
    broker: ctx.broker ?? null,
    source_row: null,
    fingerprint: fnv(tradeKey(t)),
    engine_version: ctx.engineVersion,
  }));
}

/** Scalar fields of `m` that get their own column; everything else goes to `extra`. */
const METRIC_COLUMNS = ['n', 'wins', 'losses', 'winRate', 'payoff', 'profitFactor', 'realized', 'charges', 'other', 'net',
  'from', 'to', 'source', 'market', 'currency'] as const;

export function toMetricsRow(report: ReportV1, ctx: NormaliseContext): NewReportMetrics {
  const m = report.m;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) if (!(METRIC_COLUMNS as readonly string[]).includes(k)) extra[k] = v;
  return {
    analysis_id: ctx.analysisId,
    user_id: ctx.userId,
    n: int(m.n) ?? 0,
    wins: int(m.wins),
    losses: int(m.losses),
    win_rate: num(m.winRate),
    payoff: num(m.payoff),
    profit_factor: num(m.profitFactor),
    realized: num(m.realized),
    charges: num(m.charges),
    other: num(m.other),
    net: num(m.net),
    from_date: date(m.from),
    to_date: date(m.to),
    source: m.source === 'tradebook' || m.source === 'statement' ? m.source : null,
    market: str(m.market),
    currency: m.currency,
    progress_score: num(report.progress?.overall?.score),
    extra: JSON.stringify(extra),
    engine_version: ctx.engineVersion,
  };
}

export function toTraitRows(report: ReportV1, ctx: NormaliseContext): NewReportTrait[] {
  const b = report.behaviour;
  if (!b) return [];
  const seen = new Set<number>();
  const rows: NewReportTrait[] = [];
  const add = (list: BehaviourTrait[] | undefined, primary: boolean) => {
    for (const t of list || []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      rows.push({
        analysis_id: ctx.analysisId, user_id: ctx.userId, trait_id: t.id, area: t.area, name: t.name,
        score: num(t.score) ?? 0, level: t.level ?? null, is_primary: primary,
        evidence: JSON.stringify({ now: t.now, why: t.why, ideal: t.ideal }), engine_version: ctx.engineVersion,
      });
    }
  };
  add(b.traits, true);
  add(b.more, false);
  return rows;
}

/** Everything the worker's store step writes for one analysis, from one engine run. */
export function normaliseReport(report: ReportV1, ctx: NormaliseContext) {
  return { trades: toTradeRows(report, ctx), metrics: toMetricsRow(report, ctx), traits: toTraitRows(report, ctx) };
}
