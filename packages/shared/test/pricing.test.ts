/**
 * @file  packages/shared/test/pricing.test.ts
 * @area  Tests
 * @what  REQ-3: plan durations and prices from the single source of truth, the wording built from them, and no stale copy left in the repo.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PLANS, planPrice, plansFor, durationLabel, lengthLabel, reportsBullet, validityBullet, planSummary, REPORTS_KEPT } from '../src/pricing';

const plan = (id: string) => PLANS.find((p) => p.id === id)!;

describe('plans (REQ-3, 15 Oct 2026)', () => {
  it('durations: Single 7 days, Snapshot 3 months, Progress 6 months, Discipline 12 months', () => {
    expect(PLANS.map((p) => [p.id, p.days, p.months])).toEqual([['single', 7, null], ['snapshot', 92, 3], ['progress', 183, 6], ['discipline', 365, 12]]);
    expect(PLANS.map((p) => [p.id, p.reports, p.filesPerReport])).toEqual([['single', 1, 2], ['snapshot', 5, 3], ['progress', 25, 3], ['discipline', 90, 3]]);
  });
  it('prices: India unchanged; Global Single is $9', () => {
    expect(PLANS.map((p) => planPrice(p, 'IN').label)).toEqual(['₹99', '₹499', '₹1,499', '₹3,999']);
    expect(PLANS.map((p) => planPrice(p, 'US').label)).toEqual(['$9', '$19', '$49', '$129']);
    expect(planPrice(plan('single'), 'GB')).toMatchObject({ currency: 'USD', amountMinor: 900 });
    expect(plansFor('IN').map((p) => p.price.currency)).toEqual(['INR', 'INR', 'INR', 'INR']);
  });
  it('card wording comes from PLANS', () => {
    expect(PLANS.map(durationLabel)).toEqual(['one-time', 'for 3 months', 'for 6 months', 'for 12 months']);
    expect(PLANS.map(reportsBullet)).toEqual(['1 report', '5 reports', '25 reports over 6 months', '90 reports over 12 months']);
    expect(PLANS.map(validityBullet)).toEqual(['Access for 7 days', 'Use within 3 months', null, null]);
    expect(PLANS.map(lengthLabel)).toEqual(['7 days', '3 months', '6 months', '12 months']);
    expect(planSummary(plan('snapshot'))).toBe('Snapshot plan · 5 reports · 3 months');
    expect(planSummary(plan('single'))).toBe('Single plan · 1 report · 7 days');
    expect(REPORTS_KEPT).toBe('Reports kept until you delete them');
  });
  it('no old price or duration wording is left anywhere in the repo', () => {
    const root = path.resolve(__dirname, '../../..');
    let hits = '';
    try {
      // a price, not a number inside an SVG path such as "L4.99" (the X logo)
      hits = execFileSync('git', ['grep', '-n', '-E', '-e', '(^|[^0-9.A-Za-z])4\\.99', '-e', 'Use within 6 months', '-e', 'History kept', '-e', '25 reports over 3 months', '-e', 'usdMinor: 499([^0-9]|$)',
        '--', '.', ':!package-lock.json', ':!packages/engine/test/golden', ':!packages/shared/test/pricing.test.ts'], { cwd: root, encoding: 'utf8' });
    } catch (e: any) { if (e.status !== 1) throw e; }   // git grep exits 1 when nothing matches
    expect(hits).toBe('');
  });
});
