/**
 * @file  packages/db/test/normalise.test.ts
 * @area  Tests
 * @what  Engine output -> table rows, for every golden report (no database needed); file fingerprint matches the offline tool.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normaliseReport, tradeSetFingerprint, fnv } from '../src/normalise.js';
import type { ReportV1 } from '@pnl-lens/engine/types';

const GOLDEN = path.resolve(__dirname, '../../engine/test/golden');
const OFFLINE = path.resolve(__dirname, '../../../apps/web/offline/app_offline.js');
const cases = fs.readdirSync(GOLDEN).filter((f) => f.endsWith('.json'))
  .map((f) => ({ id: f.replace(/\.json$/, ''), report: JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8')).report as ReportV1 | null }));
const ctx = { analysisId: '00000000-0000-0000-0000-0000000000a1', userId: '00000000-0000-0000-0000-0000000000u1', engineVersion: 'v-test' };

describe('normaliseReport', () => {
  it('covers every golden case that has a report', () => {
    expect(cases.length).toBe(22);
    expect(cases.filter((c) => c.report).length).toBe(21);   // open_only_xlsx has no closed trades -> no report
  });

  for (const { id, report } of cases.filter((c) => c.report)) {
    it(id, () => {
      const r = report!;
      const { trades, metrics, traits } = normaliseReport(r, ctx);
      expect(trades).toHaveLength(r.trades.length);
      expect(metrics.n).toBe(r.m.n);
      expect(trades).toHaveLength(r.m.n);
      trades.forEach((t, i) => {
        expect(t.seq).toBe(i);
        expect(['EQ', 'FUT', 'CE', 'PE']).toContain(t.kind);
        expect(t.currency).toBe(r.m.currency);
        expect(t.pnl).toBe(r.trades[i].pnl);
        expect(t.symbol).toBe(r.trades[i].symbol);
      });
      // every scalar is either its own column or kept in extra: nothing from `m` is lost
      const extra = JSON.parse(metrics.extra as string);
      for (const k of Object.keys(r.m)) {
        const inColumn = ['n', 'wins', 'losses', 'winRate', 'payoff', 'profitFactor', 'realized', 'charges', 'other', 'net', 'from', 'to', 'source', 'market', 'currency'].includes(k);
        expect(inColumn || k in extra, k).toBe(true);
      }
      expect(metrics.progress_score).toBe(r.progress?.overall?.score ?? null);
      const ids = traits.map((x) => x.trait_id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(traits.filter((x) => x.is_primary)).toHaveLength(r.behaviour?.traits.length ?? 0);
    });
  }

  it('non-finite numbers become null, as in the JSON payload', () => {
    const r = cases.find((c) => c.report)!.report!;
    const m = normaliseReport({ ...r, m: { ...r.m, profitFactor: Infinity, payoff: NaN } }, ctx).metrics;
    expect(m.profit_factor).toBeNull();
    expect(m.payoff).toBeNull();
  });
});

describe('file fingerprint (file-set lock)', () => {
  // Load the offline tool's own fnv + fingerprint functions so both sides provably agree.
  const src = fs.readFileSync(OFFLINE, 'utf8');
  const fnvSrc = src.match(/function fnv\(str\) \{[^\n]*\}/)![0];
  const fpSrc = src.match(/function fingerprint\(result, raw\) \{[^\n]*\}/)![0];
  const offline = new Function(`${fnvSrc}\n${fpSrc}\nreturn { fnv, fingerprint };`)() as { fnv: (s: string) => string; fingerprint: (r: unknown, raw: unknown) => string };

  it('fnv is identical to the offline tool', () => {
    for (const s of ['', 'a', 'RELIANCE|2025-01-06|10|-120', 'ünïcödé ₹']) expect(fnv(s)).toBe(offline.fnv(s));
  });
  for (const { id, report } of cases.filter((c) => c.report).slice(0, 8)) {
    it(`tradeSetFingerprint equals the offline fingerprint: ${id}`, () => {
      expect(tradeSetFingerprint(report!.trades)).toBe(offline.fingerprint(report, null));
    });
  }
  it('does not depend on trade order (a re-saved file matches)', () => {
    const t = cases.find((c) => c.report)!.report!.trades;
    expect(tradeSetFingerprint([...t].reverse())).toBe(tradeSetFingerprint(t));
  });
});
