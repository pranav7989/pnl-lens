/**
 * @file  apps/api/test/plan.test.ts
 * @area  Tests
 * @what  30-day plan: owner-only PDF (2 pages, links, audited, no-store), public .ics, reminders (set/replace/cancel/validate), sender claims before sending and sends once.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, makeUser, givePlan, readyAnalysis } from '@pnl-lens/db/testing';
import { createDb } from '@pnl-lens/db';
import { istDate, addDays } from '@pnl-lens/shared/plan';
import { testApp, as, type TestApp } from './helpers.js';
import { sendDueReminders } from '../src/lib/reminders.js';
import { checkupIcs } from '../src/routes/plan.js';

const ok = await testDbAvailable();
const text = (b: Buffer) => b.toString('latin1');

describe('check-up calendar file', () => {
  it('is an all-day event on the date with the upload link', () => {
    const ics = checkupIcs('2026-11-25', 'https://pnllens.com', new Date('2026-10-26T00:00:00Z'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261125');
    expect(ics).toContain('DTEND;VALUE=DATE:20261126');
    expect(ics).toContain('URL:https://pnllens.com/upload');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});

describe.skipIf(!ok)('30-day plan (api)', () => {
  let x: TestApp, u: string, reportId: string;
  beforeAll(async () => {
    x = await testApp('t_api_plan');
    u = await makeUser(x.t);
    await givePlan(x.t, u, { reports: 2 });
    const { analysisId } = await readyAnalysis(x.t, u);
    reportId = (await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: await as(u), payload: { analysisId } })).json().id;
  });
  afterAll(async () => { await x?.close(); });
  const get = async (url: string, by?: string) => x.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: await as(by) });

  it('the owner downloads a 2-page PDF with working links; recorded in the audit log', async () => {
    const r = await get(`/reports/${reportId}/plan.pdf`, u);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="pnl-lens-30-day-plan-\d{2}-[A-Z][a-z]{2}-\d{2}\.pdf"$/);
    const pdf = text(r.rawPayload);
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect(pdf.match(/\/Type \/Page$/gm)?.length).toBe(2);
    const checkup = addDays(istDate(new Date()), 30);
    expect(pdf).toContain(`/reminders/new?report=${reportId}&date=${checkup})`);
    expect(pdf).toContain(`/api/v1/plan.ics?date=${checkup})`);
    expect(pdf).toContain('/upload)');
    const email = (await x.t.admin.query('select email from users where id = $1', [u])).rows[0].email;
    expect(pdf).not.toContain(email);           // links and metadata carry no email or user id
    expect(pdf).not.toContain(u);
    const audit = await x.t.admin.query(`select meta from audit_log where user_id = $1 and action = 'plan_downloaded'`, [u]);
    expect(audit.rows[0].meta).toEqual({ report_id: reportId });
    expect((await x.t.admin.query(`select count(*)::int n from events where user_id = $1 and name = 'plan_downloaded'`, [u])).rows[0].n).toBe(1);
  });

  it('nobody else gets it; a deleted report is gone', async () => {
    expect((await get(`/reports/${reportId}/plan.pdf`)).statusCode).toBe(401);
    expect((await get(`/reports/${reportId}/plan.pdf`, await makeUser(x.t))).statusCode).toBe(404);
    expect((await get('/reports/not-a-uuid/plan.pdf', u)).statusCode).toBe(404);
    const { analysisId } = await readyAnalysis(x.t, u);
    const other = (await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: await as(u), payload: { analysisId } })).json().id;
    await x.app.inject({ method: 'DELETE', url: `/api/v1/reports/${other}`, headers: await as(u) });
    expect([404, 410]).toContain((await get(`/reports/${other}/plan.pdf`, u)).statusCode);
  });

  it('the calendar link is public and checks the date', async () => {
    const d = addDays(istDate(new Date()), 30);
    const r = await get(`/plan.ics?date=${d}`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/calendar/);
    expect(r.body).toContain(`DTSTART;VALUE=DATE:${d.replace(/-/g, '')}`);
    for (const bad of ['2026-02-30', 'tomorrow', '3000-01-01']) expect((await get(`/plan.ics?date=${bad}`)).statusCode).toBe(400);
  });

  it('reminders: set, replace (one active), cancel; dates within the next 60 days; own reports only', async () => {
    const h = await as(u), today = istDate(new Date());
    const post = (body: object, headers = h) => x.app.inject({ method: 'POST', url: '/api/v1/me/reminders', headers, payload: body });
    for (const date of [today, addDays(today, -3), addDays(today, 61), '2026-13-01']) expect((await post({ reportId, date })).statusCode).toBe(400);
    expect((await post({ reportId: '00000000-0000-0000-0000-000000000000', date: addDays(today, 30) })).statusCode).toBe(404);
    const stranger = await makeUser(x.t);
    expect((await post({ reportId, date: addDays(today, 30) }, await as(stranger))).statusCode).toBe(404);
    const a = await post({ reportId, date: addDays(today, 30) });
    expect(a.statusCode).toBe(201);
    const b = await post({ reportId, date: addDays(today, 31) });
    expect((await get('/me/reminders', u)).json().reminder).toMatchObject({ id: b.json().reminder.id, remindOn: addDays(today, 31), reportId });
    expect((await x.t.admin.query(`select count(*)::int n from plan_reminders where user_id = $1 and cancelled_at is null`, [u])).rows[0].n).toBe(1);
    expect((await x.app.inject({ method: 'DELETE', url: `/api/v1/me/reminders/${b.json().reminder.id}`, headers: await as(stranger) })).statusCode).toBe(404);
    expect((await x.app.inject({ method: 'DELETE', url: `/api/v1/me/reminders/${b.json().reminder.id}`, headers: h })).json()).toEqual({ cancelled: true });
    expect((await get('/me/reminders', u)).json().reminder).toBeNull();
  });

  it('sender: due reminders of active accounts go out once, from 09:00 IST; cancelled and blocked ones never', async () => {
    const { db } = createDb({ connectionString: x.t.appUrl, max: 2, ssl: false });
    try {
      const mk = async (status = 'active') => {
        const id = await makeUser(x.t);
        if (status !== 'active') await x.t.admin.query('update users set status = $2 where id = $1', [id, status]);
        return id;
      };
      const due = await mk(), blocked = await mk('blocked'), cancelled = await mk(), later = await mk(), todayU = await mk();
      const today = istDate(new Date());
      const ins = (id: string, on: string, extra = '') => x.t.admin.query(`insert into plan_reminders (user_id, remind_on${extra ? ', cancelled_at' : ''}) values ($1, $2${extra ? ', now()' : ''})`, [id, on]);
      await ins(due, addDays(today, -1)); await ins(blocked, addDays(today, -1)); await ins(cancelled, addDays(today, -1), 'c');
      await ins(later, addDays(today, 5)); await ins(todayU, today);
      const sent: string[] = [];
      const deps = { db, appUrl: 'https://pnllens.com', mail: async (m: { to: string; subject: string; text: string }) => { sent.push(m.to); expect(m.subject).toBe('Your 30-day check-up is today'); expect(m.text).toContain('https://pnllens.com/upload'); } };
      const email = async (id: string) => (await x.t.admin.query('select email from users where id = $1', [id])).rows[0].email;
      // 08:00 IST: only overdue ones
      const early = new Date(Date.parse(today + 'T02:30:00Z'));
      expect(await sendDueReminders(deps as any, early)).toEqual({ sent: 1, failed: 0 });
      expect(sent).toEqual([await email(due)]);
      // 09:30 IST: today's too; nothing twice
      const morning = new Date(Date.parse(today + 'T04:00:00Z'));
      expect(await sendDueReminders(deps as any, morning)).toEqual({ sent: 1, failed: 0 });
      expect(sent).toEqual([await email(due), await email(todayU)]);
      expect(await sendDueReminders(deps as any, morning)).toEqual({ sent: 0, failed: 0 });
    } finally { await db.destroy(); }
  });
});
