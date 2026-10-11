/**
 * @file  tests/engine.test.ts
 * @area  Tests
 * @what  Engine: formats, accounting, symbols, auto-detection, combining files, progress.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { runAnalysis, analyzeRaw, engine, serializeReport } from '@/lib/engine';

const fx = (f: string) => ({ name: f, data: new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', f))) });
const run = (f: string, opts = {}) => runAnalysis(XLSX, [fx(f)], opts);

describe('format detection', () => {
  const cases: [string, 'statement' | 'tradebook', string, string | null][] = [
    ['zerodha_equity_statement.xlsx', 'statement', 'INR', null],
    ['zerodha_fo_statement.xlsx', 'statement', 'INR', 'India'],
    ['zerodha_tradebook.csv', 'tradebook', 'INR', 'India'],
    ['dhan_tradebook.csv', 'tradebook', 'INR', 'India'],
    ['groww_pnl.csv', 'statement', 'INR', null],
    ['ibkr_tradebook.csv', 'tradebook', 'USD', 'US'],
    ['binance_trades.csv', 'tradebook', 'USD', 'Crypto'],
  ];
  for (const [file, source, currency, market] of cases) {
    it(`${file} → ${source}, ${currency}`, () => {
      const { report } = run(file);
      expect(report).not.toBeNull();
      expect(report!.m.source).toBe(source);
      expect(report!.m.currency).toBe(currency);
      expect(report!.m.market).toBe(market);
      expect(report!.m.n).toBeGreaterThan(0);
    });
  }
});

describe('Zerodha statement accounting', () => {
  const { report } = run('zerodha_equity_statement.xlsx');
  it('reads every symbol row', () => expect(report!.m.n).toBe(16));
  it('realized matches the statement total', () => expect(report!.m.realized).toBeCloseTo(-117696.61, 1));
  it('net = realized − charges + other', () => {
    const m = report!.m;
    expect(m.net).toBeCloseTo(m.realized - m.charges + m.other, 2);
    expect(m.charges).toBeCloseTo(2891.4, 1);
    expect(m.other).toBeCloseTo(-612.3, 1);
  });
  it('picks up charge heads and other debits', () => {
    expect(report!.heads['Securities Transaction Tax']).toBe(2300);
    expect(report!.debitSummary.dp.n).toBe(3);
    expect(report!.debitSummary.autosq.n).toBe(2);
    expect(report!.debitSummary.amc.n).toBe(1);
    expect(report!.debitSummary.margin.n).toBe(1);
  });
  it('tags WIPRO as delivery with 2 exits', () => {
    const w = report!.trades.find((t) => t.symbol === 'WIPRO')!;
    expect(w.style).toBe('Delivery');
  });
});

describe('symbol classification', () => {
  const c = (s: string) => engine.classify(s);
  it('India weekly option', () => expect(c('NIFTY2530622500PE')).toMatchObject({ market: 'India', group: 'Index options', kind: 'PE', expiry: '2025-03-06', expiryType: 'Weekly' }));
  it('India monthly stock option', () => expect(c('TATASTEEL24MAR160CE')).toMatchObject({ group: 'Stock options', kind: 'CE', expiryType: 'Monthly' }));
  it('India future', () => expect(c('HDFCBANK26APRFUT')).toMatchObject({ group: 'Stock futures', kind: 'FUT' }));
  it('NIFTYNXT50 index with digits', () => expect(c('NIFTYNXT5024DEC70000CE')).toMatchObject({ underlying: 'NIFTYNXT50', group: 'Index options' }));
  it('US OCC option ×100', () => expect(c('AAPL240119C00150000')).toMatchObject({ market: 'US', underlying: 'AAPL', strike: 150, mult: 100, expiryType: 'Monthly' }));
  it('US index option', () => expect(c('SPXW240315P05000000')).toMatchObject({ group: 'Index options', kind: 'PE' }));
  it('CME future', () => expect(c('/CLF25')).toMatchObject({ market: 'US', kind: 'FUT', underlying: 'CL' }));
  it('crypto perp', () => expect(c('BTCUSDT PERP')).toMatchObject({ market: 'Crypto', group: 'Crypto perpetuals' }));
  it('FX pair is not crypto', () => expect(c('EURUSD')).toMatchObject({ market: 'FX' }));
  it('plain ticker', () => expect(c('RELIANCE')).toMatchObject({ market: null, group: 'Equity / cash' }));
});

describe('tradebook reconstruction', () => {
  it('round trips are flat-to-flat and P&L sums match fills', () => {
    const { result } = run('zerodha_tradebook.csv');
    const trades = result.trades;
    expect(trades.every((t: any) => t.nLegs >= 2)).toBe(true);
    expect(result.m.realized).toBeCloseTo(trades.reduce((s: number, t: any) => s + t.pnl, 0), 2);
  });
  it('US options apply the ×100 multiplier', () => {
    const { result } = run('ibkr_tradebook.csv');
    const opt = result.trades.find((t: any) => t.symbol === 'AAPL240119C00150000');
    expect(opt).toBeDefined();
    expect(opt.buy / opt.qty).toBeGreaterThan(opt.avgBuy / opt.qty * 0.99);
  });
  it('produces behaviour stats when dated', () => {
    const { report } = run('zerodha_tradebook.csv');
    expect(report!.seq).not.toBeNull();
    expect(report!.b.entryDow.length).toBeGreaterThan(1);
    expect(report!.b.entryHour.length).toBeGreaterThan(1);
  });
});

describe('automatic column detection (never asks the user)', () => {
  const T = 10579.62;
  const cases: [string, number, number | null][] = [
    ['unknown_headers.csv', 4, -8000],
    ['merged_headers.xlsx', 8, T],
    ['odd_headers.csv', 8, T],
    ['no_headers.csv', 8, T],
    ['scrip_codes.xlsx', 8, T],
  ];
  for (const [f, n, pnl] of cases) {
    it(`${f} → ${n} positions`, () => {
      const { report } = run(f);
      expect(report).not.toBeNull();
      expect(report!.m.n).toBe(n);
      if (pnl != null) expect(report!.m.realized).toBeCloseTo(pnl, 1);
    });
  }
  it('two-row header keeps buy/sell values (returns are computed)', () => {
    expect(run('merged_headers.xlsx').report!.m.avgWinPct).toBeGreaterThan(0);
  });
  it('total rows are not counted as trades', () => {
    expect(run('merged_headers.xlsx').report!.trades.some((t) => /total/i.test(t.symbol))).toBe(false);
  });
  it('a file with only open positions yields no report rather than a wrong one', () => {
    expect(run('open_only.xlsx').report).toBeNull();
  });
});

describe('insight text', () => {
  it('no duplicate rules', () => {
    for (const f of ['zerodha_equity_statement.xlsx', 'zerodha_fo_statement.xlsx', 'zerodha_tradebook.csv', 'ibkr_tradebook.csv']) {
      const { report } = run(f);
      const rules = report!.rules.map((r) => r.rule.toLowerCase());
      expect(new Set(rules).size).toBe(rules.length);
    }
  });
  it('no India-only wording on non-India data', () => {
    const { report } = run('ibkr_tradebook.csv');
    const text = JSON.stringify([report!.leaks, report!.rules, report!.patterns]);
    expect(text).not.toMatch(/STT|3:10 PM|rupee|₹/);
  });
  it('currency override changes formatting only', () => {
    const { report } = run('ibkr_tradebook.csv', { currency: 'EUR' });
    expect(report!.m.currency).toBe('EUR');
  });
});

describe('serialization', () => {
  it('strips engine internals and stays compact', () => {
    const { result } = run('zerodha_tradebook.csv');
    const s = serializeReport(result);
    const json = JSON.stringify(s);
    expect(json).not.toContain('"keys"');
    expect((s as any).sheets).toBeUndefined();
    expect(Object.values(s.b).flat().every((x: any) => x.trades === undefined)).toBe(true);
    expect(json.length).toBeLessThan(2 * 1024 * 1024);
    expect(s.version).toBe(1);
  });
});

describe('combining files', () => {
  const read = (f: string) => fx(f);
  it('statement from a different account is added to a tradebook', () => {
    const { report } = runAnalysis(XLSX, [read('zerodha_tradebook.csv'), read('groww_pnl.csv')]);
    expect(report!.m.n).toBe(96 + 5);
  });
  it('statement that repeats the tradebook symbols is not double-counted', () => {
    // build a statement with the same symbols as the tradebook
    const tb = runAnalysis(XLSX, [read('zerodha_tradebook.csv')]).result;
    const rows = [['Symbol', 'Quantity', 'Buy Value', 'Sell Value', 'Realized P&L']].concat(
      [...new Set(tb.trades.map((t: any) => t.symbol))].map((s: any) => [s, '1', '100', '110', '10']));
    const csv = new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n'));
    const { report } = runAnalysis(XLSX, [read('zerodha_tradebook.csv'), { name: 'same_account_pnl.csv', data: csv }]);
    expect(report!.m.n).toBe(96);
  });
});

describe('progress over time', () => {
  it('scores months and tracks mistakes for a multi-month tradebook', () => {
    const p = run('zerodha_tradebook.csv').report!.progress;
    expect(p.months.length).toBeGreaterThanOrEqual(2);
    expect(p.overall.score).toBeGreaterThan(0); expect(p.overall.score).toBeLessThanOrEqual(100);
    for (const mo of p.months) for (const v of Object.values(mo.d) as number[]) expect(v).toBeGreaterThanOrEqual(0);
    expect(p.delta).toBe(p.months.at(-1).score - p.months.at(-2).score);
    expect(p.tracker.every((t: any) => ['fixed', 'improving', 'same', 'worse', 'new', 'clean', 'present'].includes(t.status))).toBe(true);
  });
  it('does not invent intraday habits for per-symbol statements', () => {
    const p = run('groww_pnl.csv').report!.progress;
    expect(p.tracker.some((t: any) => t.id === 'over' || t.id === 'revenge' || t.id === 'streak')).toBe(false);
  });
});
