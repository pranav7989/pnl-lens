/**
 * @file  packages/shared/test/drill.test.ts
 * @area  Tests
 * @what  Drill-down parity: for every golden report and every drillable cluster view, the trades the renderer's DRILL rules pick are exactly the engine's bucket (same count, same P&L).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// the website's report renderer (plain JS, no DOM work at import time)
import { DRILL } from '../../../apps/web/lib/report-ui/render.js';

const dir = join(__dirname, '../../engine/test/golden');
const goldens = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f.replace(/\.json$/, ''), report: JSON.parse(readFileSync(join(dir, f), 'utf8')).report }))
  .filter((g) => g.report);

describe('drill-down rules match the engine buckets', () => {
  for (const g of goldens) {
    it(g.name, () => {
      let checked = 0;
      for (const dim of Object.keys(DRILL) as (keyof typeof DRILL)[]) {
        for (const row of g.report.b?.[dim] || []) {
          const picked = g.report.trades.filter((t: any) => (DRILL as any)[dim](t, row.key));
          expect(picked.length, `${dim}=${row.key}`).toBe(row.n);
          expect(picked.reduce((s: number, t: any) => s + t.pnl, 0), `${dim}=${row.key}`).toBeCloseTo(row.pnl, 1);   // the engine rounds bucket P&L
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});
