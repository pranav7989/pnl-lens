/**
 * @file  packages/engine/src/types.ts
 * @area  Engine
 * @what  TypeScript types for raw sheets and the report JSON (version 1).
 */
export type ColumnKey =
  | 'symbol' | 'qty' | 'buy' | 'sell' | 'buyPrice' | 'sellPrice' | 'pnl' | 'pct'
  | 'side' | 'price' | 'tradeDate' | 'time' | 'entryDate' | 'exitDate' | 'fees';

/** Column index overrides from the manual mapper (0-based). */
export type ColumnOverride = Partial<Record<ColumnKey, number>>;

export interface AnalyzeOptions {
  currency?: string;
  override?: ColumnOverride;
}

export interface RawSheet {
  file: string;
  name: string;
  rows: unknown[][];
}

export interface Bucket {
  key: string;
  n: number;
  wins: number;
  winRate: number;
  pnl: number;
  turnover: number;
  avgPct: number;
}

export interface ReportTrade {
  symbol: string;
  group: string;
  market?: string | null;
  kind: 'EQ' | 'FUT' | 'CE' | 'PE';
  underlying: string;
  expiry?: string | null;
  weekday?: string | null;
  expiryType?: string | null;
  direction?: 'Long' | 'Short';
  entryDate?: string | null;
  exitDate?: string | null;
  entryHour?: number | null;
  holdDays?: number | null;
  qty: number;
  avgBuy: number;
  buy: number;
  sell: number;
  pct: number;
  pnl: number;
  netEst: number;
  style?: string;
  openQty?: number;
}

export interface ReportMetrics {
  from: string | null;
  to: string | null;
  source: 'tradebook' | 'statement';
  market: string | null;
  markets: { market: string; n: number }[];
  currency: string;
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  payoff: number;
  profitFactor: number;
  realized: number;
  charges: number;
  other: number;
  net: number;
  [k: string]: unknown;
}

export interface ReportV1 {
  version: 1;
  generatedAt: string;
  m: ReportMetrics;
  trades: ReportTrade[];
  b: Record<string, Bucket[]>;
  stops: unknown;
  dropWorst: { k: number; net: number }[];
  heads: Record<string, number>;
  debitSummary: Record<string, { n: number; amount: number; dates: string[] }>;
  patterns: { dim: string; impact: number; text: string }[];
  leaks: { level: 'High' | 'Medium' | 'Low'; title: string; impact: number; evidence: string; fix: string; cluster?: string }[];
  strengths: string[];
  rules: { rule: string; why: string }[];
  seq: unknown;
  curve: { date: string | null; eq: number }[];
  diagnosis: string;
  mapping: unknown[];
  progress?: any;
  behaviour?: {
    traits: BehaviourTrait[];
    more: BehaviourTrait[];
    tiles: Record<string, { now: string; ideal: string }>;
    checked: number;
  };
}

export interface BehaviourTrait {
  id: number; area: string; name: string; score: number; level: 'Strong' | 'Clear' | 'Emerging';
  now: string; why: string; ideal: string;
}
