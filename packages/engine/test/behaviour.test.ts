/**
 * @file  packages/engine/test/behaviour.test.ts
 * @area  Tests
 * @what  100-trait library: uniqueness, wording, variety.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
// @ts-ignore - plain JS module
import { TRAITS } from '../src/behaviour.js';
import { runAnalysis } from '../src/index';

// one file per sample account (layout-variant fixtures share the same trades, so they're excluded)
const files = ['zerodha_equity_statement.xlsx', 'zerodha_fo_statement.xlsx', 'zerodha_tradebook.csv', 'dhan_tradebook.csv', 'groww_pnl.csv', 'ibkr_tradebook.csv', 'binance_trades.csv'];
const reports = files.map((f) => runAnalysis(XLSX, [{ name: f, data: new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', f))) }]).report!);

describe('behaviour library', () => {
  it('has 100 distinct traits', () => {
    expect(TRAITS.length).toBe(100);
    for (const k of ['id', 'name', 'why', 'ideal'] as const) expect(new Set(TRAITS.map((t: any) => t[k])).size).toBe(100);
  });
  it('every report gets behaviour cards for its tiles', () => {
    for (const r of reports) expect(Object.keys(r.behaviour!.tiles).length).toBeGreaterThan(30);
  });
  it('no broken text (undefined, NaN, Infinity, double negatives)', () => {
    for (const r of reports) expect(JSON.stringify(r.behaviour)).not.toMatch(/undefined|NaN|Infinity|lost −|lose −|cost −/);
  });
  it('headline traits stay varied (max two per area) and differ between traders', () => {
    const sets = reports.map((r) => r.behaviour!.traits.map((t) => t.id).join(','));
    expect(new Set(sets).size).toBe(reports.length);
    for (const r of reports) {
      const per: Record<string, number> = {};
      r.behaviour!.traits.forEach((t) => (per[t.area] = (per[t.area] || 0) + 1));
      expect(Math.max(0, ...Object.values(per))).toBeLessThanOrEqual(2);
    }
  });
  it('triggers a broad spread of traits across sample accounts', () => {
    const hit = new Set(reports.flatMap((r) => [...r.behaviour!.traits, ...r.behaviour!.more].map((t) => t.id)));
    expect(hit.size).toBeGreaterThanOrEqual(40);
  });
});
