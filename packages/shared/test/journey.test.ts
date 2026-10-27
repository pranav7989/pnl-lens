/**
 * @file  packages/shared/test/journey.test.ts
 * @area  Tests
 * @what  REQ-2 journey rules: steps done only when really met and included in the plan, locks name the unlocking plan, score line, next action.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { journey, LEVELS, levelFor, dateTag, unlockHref, type JourneyReport } from '../src/journey';

const NOW = new Date('2026-10-15T10:00:00+05:30');
const plan = (planId: string, active = true) => ({ planId, active, endsAt: active ? '2027-04-15T00:00:00Z' : '2026-09-01T00:00:00Z' });
const rep = (createdAt: string, to: string | null, score: number | null = 51): JourneyReport => ({ createdAt, to, progressScore: score });
const PRICES = { snapshot: '₹499', progress: '₹1,499', discipline: '₹3,999' };
const view = (j: ReturnType<typeof journey>) => j.steps.map((s) => `${s.id}:${s.done ? 'done' : s.locked ? 'locked:' + s.unlock!.name : 'open'}`);

describe('journey', () => {
  it('Single user with one report: 2 of 5, steps 3-5 locked with the plan that unlocks each', () => {
    const j = journey({ plans: [plan('single')], reports: [rep('2026-10-14T10:00:00Z', '2026-10-10')], prices: PRICES, now: NOW });
    expect(j.done).toBe(2); expect(j.total).toBe(5); expect(j.tier).toBe('single');
    expect(view(j)).toEqual(['first:done', 'baseline:done', 'month2:locked:Snapshot', 'trend3:locked:Progress', 'discipline12:locked:Discipline']);
    expect(j.steps[2].unlock).toEqual({ planId: 'snapshot', name: 'Snapshot', price: '₹499' });
    expect(j.score).toEqual({ value: 51, level: 'Developing', next: { name: 'Steady', gap: 4 } });
    expect(j.next).toMatchObject({ kind: 'upgrade', text: 'See if your score improves next month', cta: 'Upgrade to Snapshot', planId: 'snapshot' });
    expect(j.nextStep?.id).toBe('month2');
  });

  it('a report for a later month on Snapshot completes step 3; the same month twice does not', () => {
    const same = journey({ plans: [plan('snapshot')], reports: [rep('2026-09-05T10:00:00Z', '2026-08-30'), rep('2026-09-20T10:00:00Z', '2026-08-31')], now: NOW });
    expect(view(same).slice(2)).toEqual(['month2:open', 'trend3:locked:Progress', 'discipline12:locked:Discipline']);
    const later = journey({ plans: [plan('snapshot')], reports: [rep('2026-09-05T10:00:00Z', '2026-08-30'), rep('2026-10-05T10:00:00Z', '2026-09-30')], now: NOW });
    expect(later.done).toBe(3); expect(later.steps[2].done).toBe(true);
  });

  it('the same later-month report on Single does not count: the step is locked, never done', () => {
    const j = journey({ plans: [plan('single')], reports: [rep('2026-09-05T10:00:00Z', '2026-08-30'), rep('2026-10-05T10:00:00Z', '2026-09-30')], now: NOW });
    expect(j.done).toBe(2); expect(j.steps[2].locked).toBe(true);
  });

  it('Progress: 3 months complete step 4; Discipline: the 12-month plan completes step 5', () => {
    const three = [rep('2026-08-02T10:00:00Z', '2026-07-31'), rep('2026-09-02T10:00:00Z', '2026-08-31'), rep('2026-10-02T10:00:00Z', '2026-09-30')];
    expect(view(journey({ plans: [plan('progress')], reports: three, now: NOW }))).toEqual(['first:done', 'baseline:done', 'month2:done', 'trend3:done', 'discipline12:locked:Discipline']);
    expect(journey({ plans: [plan('discipline')], reports: three.slice(0, 1), now: NOW }).steps.map((s) => s.done)).toEqual([true, true, false, false, true]);
  });

  it('the best valid plan counts (even with all its reports used); an ended plan does not', () => {
    expect(journey({ plans: [plan('single'), plan('progress')], reports: [], now: NOW }).tier).toBe('progress');
    const usedUp = { planId: 'snapshot', active: false, endsAt: '2027-04-13T00:00:00Z' };   // 5 of 5 used: API says not active
    expect(journey({ plans: [usedUp], reports: [rep('2026-10-14T10:00:00Z', '2026-10-10')], now: NOW }).steps[2]).toMatchObject({ locked: false, done: false });
    const ended = journey({ plans: [plan('snapshot', false)], reports: [rep('2026-08-02T10:00:00Z', null)], now: NOW });
    expect(ended.tier).toBeNull(); expect(ended.steps[2].locked).toBe(true);
  });

  it('paid plans: the next check-up is 30 days after the last report', () => {
    const j = journey({ plans: [plan('snapshot')], reports: [rep('2026-10-14T06:00:00Z', '2026-10-10')], now: NOW });
    expect(j.next).toMatchObject({ kind: 'checkup', cta: 'Upload next month’s statement', href: '/upload' });
    expect(j.next.text).toBe(`Your next check-up: ${dateTag(new Date('2026-11-13T06:00:00Z'))}`);
  });

  it('a report without a habit score leaves the baseline open; no reports → nothing done', () => {
    expect(journey({ plans: [plan('single')], reports: [rep('2026-10-14T10:00:00Z', null, null)], now: NOW }).steps.slice(0, 2).map((s) => s.done)).toEqual([true, false]);
    const none = journey({ plans: null, reports: [], now: NOW });
    expect(none.done).toBe(0); expect(none.score).toBeNull();
  });

  it('levels match the engine thresholds; scores 0 and 100', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../engine/src/engine.js'), 'utf8');
    const engine = [...src.match(/const LEVELS = \[(.*?)\];/)![1].matchAll(/\[(\d+), '(\w+)'\]/g)].map((m) => [Number(m[1]), m[2]]);
    expect(LEVELS).toEqual(engine);
    expect(levelFor(0)).toEqual({ level: 'Building', next: { name: 'Developing', gap: 40 } });
    expect(levelFor(100)).toEqual({ level: 'Elite', next: null });
    expect(unlockHref('progress')).toBe('/pricing?plan=progress&from=journey#plan-progress');
  });
});
