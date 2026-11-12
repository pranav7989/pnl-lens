/**
 * @file  apps/api/test/digest.test.ts
 * @area  Tests
 * @what  Weekly summary: prefs on/off, unsubscribe link (good and bad token), sender: only opted-in active users with a report, from Monday 09:00 IST, once a week, with focus rules, report link and a working unsubscribe link.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, makeUser, givePlan, readyAnalysis } from '@pnl-lens/db/testing';
import { createDb } from '@pnl-lens/db';
import { testApp, testConfig, as, type TestApp } from './helpers.js';
import { sendDueDigests, weekStart, unsubscribeToken } from '../src/lib/digest.js';

const ok = await testDbAvailable();

describe('week start', () => {
  it('is the IST Monday', () => {
    expect(weekStart(new Date('2026-10-26T04:00:00Z'))).toBe('2026-10-26');      // Monday 09:30 IST
    expect(weekStart(new Date('2026-11-01T17:00:00Z'))).toBe('2026-10-26');      // Sunday 22:30 IST
    expect(weekStart(new Date('2026-11-01T19:00:00Z'))).toBe('2026-11-02');      // Monday 00:30 IST
  });
});

describe.skipIf(!ok)('weekly summary (api)', () => {
  let x: TestApp;
  const secret = testConfig().ipHashSecret;
  beforeAll(async () => { x = await testApp('t_api_digest'); });
  afterAll(async () => { await x?.close(); });

  const withReport = async () => {
    const u = await makeUser(x.t);
    await givePlan(x.t, u, { reports: 1 });
    const { analysisId } = await readyAnalysis(x.t, u);
    const id = (await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: await as(u), payload: { analysisId } })).json().id;
    return { u, report: id };
  };

  it('prefs: off by default, on, off; unsubscribe link needs the right token', async () => {
    const u = await makeUser(x.t), h = await as(u);
    const get = async () => (await x.app.inject({ method: 'GET', url: '/api/v1/me/prefs', headers: h })).json().weeklyDigest;
    expect(await get()).toBe(false);
    expect((await x.app.inject({ method: 'PUT', url: '/api/v1/me/prefs', headers: h, payload: { weeklyDigest: true } })).json()).toEqual({ weeklyDigest: true });
    expect(await get()).toBe(true);
    const unsub = async (t: string) => x.app.inject({ method: 'POST', url: '/api/v1/digest/unsubscribe', headers: await as(), payload: { u, t } });
    expect((await unsub('wrong-token')).statusCode).toBe(400);
    expect((await unsub(unsubscribeToken(secret, (await makeUser(x.t))))).statusCode).toBe(400);   // another user's token
    expect(await get()).toBe(true);
    expect((await unsub(unsubscribeToken(secret, u))).json()).toEqual({ weeklyDigest: false });
    expect(await get()).toBe(false);
  });

  it('sender: opted-in active users with a report, from Monday 09:00 IST, once a week', async () => {
    const { db } = createDb({ connectionString: x.t.appUrl, max: 2, ssl: false });
    try {
      const yes = await withReport(), off = await withReport(), noReport = await makeUser(x.t), blocked = await withReport();
      await x.t.admin.query('update users set weekly_digest = true where id = any($1)', [[yes.u, noReport, blocked.u]]);
      await x.t.admin.query(`update users set status = 'blocked' where id = $1`, [blocked.u]);
      void off;
      const sent: { to: string; subject: string; text: string }[] = [];
      const deps = { db, appUrl: 'https://pnllens.com', secret, mail: async (m: any) => { sent.push(m); } };
      const monday = (h: number) => new Date(Date.parse('2026-10-26T00:00:00Z') + (h - 5.5) * 3600e3);    // IST hour h on Monday 26 Oct
      expect(await sendDueDigests(deps, monday(8))).toEqual({ sent: 0, skipped: 0, failed: 0 });        // before 09:00
      expect((await sendDueDigests(deps, monday(10))).sent).toBe(1);
      const email = (await x.t.admin.query('select email from users where id = $1', [yes.u])).rows[0].email;
      expect(sent.map((m) => m.to)).toEqual([email]);
      expect(sent[0].subject).toMatch(/^Your week/);
      expect(sent[0].text).toContain(`https://pnllens.com/report/${yes.report}`);
      expect(sent[0].text).toContain(`https://pnllens.com/unsubscribe?u=${yes.u}&t=${unsubscribeToken(secret, yes.u)}`);
      expect(sent[0].text).toContain('Your focus this week:');
      expect((await sendDueDigests(deps, monday(14))).sent).toBe(0);                                     // once a week
      expect((await sendDueDigests(deps, new Date('2026-11-02T04:00:00Z'))).sent).toBe(1);              // next Monday 09:30 IST
    } finally { await db.destroy(); }
  });
});
