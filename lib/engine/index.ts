/**
 * @file  lib/engine/index.ts
 * @area  Engine
 * @what  Typed entry points: run analysis, serialise the versioned report JSON.
 */
/**
 * Public entry point for the analysis engine.
 * runAnalysis() is what the upload Web Worker and the tests call.
 * serializeReport() produces the JSON that is POSTed to /api/reports and stored.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain JS module
import * as E from './engine.js';
import type { ReportV1, RawSheet, AnalyzeOptions, ColumnOverride } from './types';

export const REPORT_VERSION = 1 as const;
export const engine = E as any;

const TRADE_FIELDS = [
  'symbol', 'group', 'market', 'kind', 'underlying', 'family', 'expiry', 'weekday', 'expiryType',
  'direction', 'entryDate', 'exitDate', 'entryHour', 'holdDays', 'qty', 'avgBuy', 'buy', 'sell',
  'pct', 'pnl', 'netEst', 'style', 'openQty', 'sellDays', 'isOpt', 'segment', 'nLegs', 'mult',
] as const;

const round = (v: unknown) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);

function stripBucket(rows: any[]) {
  return (rows || []).map(({ trades, ...rest }: any) => ({ ...rest, pnl: round(rest.pnl), avgPct: round(rest.avgPct), turnover: round(rest.turnover) }));
}

/** Drop engine-internal fields (duplicated trade arrays, dedupe keys, raw sheets) and round numbers. */
export function serializeReport(r: any): ReportV1 {
  const b: Record<string, any[]> = {};
  for (const k of Object.keys(r.b)) b[k] = stripBucket(r.b[k]);
  const trades = r.trades.map((t: any) => {
    const o: Record<string, unknown> = {};
    for (const f of TRADE_FIELDS) if (t[f] !== undefined) o[f] = round(t[f]);
    return o;
  });
  const clean = (arr: any[]) => arr.map(({ keys, trades, worst, best, ...rest }: any) => rest);
  return {
    version: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    m: r.m,
    trades,
    b,
    stops: r.stops,
    dropWorst: r.dropWorst,
    heads: r.heads,
    debitSummary: r.debitSummary,
    patterns: clean(r.patterns),
    leaks: clean(r.leaks),
    strengths: r.strengths,
    rules: r.rules,
    seq: r.seq ? { ...r.seq } : null,
    curve: r.curve.map((c: any) => ({ date: c.date, eq: round(c.eq) })),
    diagnosis: r.diagnosis,
    mapping: r.mapping,
    behaviour: r.behaviour,
    progress: r.progress,
  } as ReportV1;
}

/** Read workbooks into raw row arrays (kept so the manual column mapper can re-parse without re-reading files). */
export function readRawSheets(XLSX: any, files: { name: string; data: ArrayBuffer | Uint8Array }[]): RawSheet[] {
  const out: RawSheet[] = [];
  for (const f of files) {
    const wb = XLSX.read(f.data, { type: 'array' });
    for (const name of wb.SheetNames) {
      out.push({ file: f.name, name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true, blankrows: true }) });
    }
  }
  return out;
}

/** Guess a header row for the manual mapper (first row with 3+ text cells). */
export function guessHeaders(raw: RawSheet[]): { sheet: string; headers: string[] } | null {
  for (const s of raw) {
    const row = s.rows.find((r) => (r || []).filter((c) => typeof c === 'string' && c.trim()).length >= 3);
    if (row) return { sheet: s.name, headers: row.map((c) => (c == null ? '' : String(c))) };
  }
  return null;
}

export function analyzeRaw(raw: RawSheet[], opts: AnalyzeOptions = {}) {
  const sheets = raw.map((s) => (opts.override ? E.parseSheet(s.rows, s.name, s.file, opts.override as ColumnOverride) : E.parseSheetAuto(s.rows, s.name, s.file)));
  const r = E.analyze(sheets, opts.currency ? { currency: opts.currency } : undefined);
  return { result: r, report: r.m.n ? serializeReport(r) : null };
}

/** Convenience used by tests and the worker. */
export function runAnalysis(XLSX: any, files: { name: string; data: ArrayBuffer | Uint8Array }[], opts: AnalyzeOptions = {}) {
  const raw = readRawSheets(XLSX, files);
  const { result, report } = analyzeRaw(raw, opts);
  return { raw, result, report, headers: report ? null : guessHeaders(raw) };
}

/** Format helpers bound to a report's currency (engine formatting is currency-stateful). */
export function formatterFor(report: Pick<ReportV1, 'm'>) {
  E.setCurrency(report.m.currency || 'INR');
  return { inr: E.inr as (v: number) => string, pct: E.pct as (v: number, d?: number) => string };
}
