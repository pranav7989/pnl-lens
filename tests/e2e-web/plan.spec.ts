/**
 * @file  tests/e2e-web/plan.spec.ts
 * @area  Tests
 * @what  30-day plan: "30-day plan" button at the top right of a report downloads the PDF; "Remind me" turns on a check-up email, shown in Your data, sent once when due.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { signIn, sql, lastMail, givePlan, FIX } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

const email = `plan-${Date.now()}@e2e.local`;
let reportUrl = '';

test('report header: "30-day plan" downloads a 2-page PDF', async ({ page }) => {
  await signIn(page, email, '/upload');
  givePlan(email);
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
  reportUrl = page.url();
  const btn = page.locator('.report-head .actions [data-plan-download]');
  await expect(btn).toHaveText('30-day plan');
  // top right: the plan button sits before Delete, in the header's right-hand actions
  const [head, box] = await Promise.all([page.locator('.report-head').boundingBox(), btn.boundingBox()]);
  expect(box!.x + box!.width).toBeGreaterThan(head!.x + head!.width * 0.6);
  const [download] = await Promise.all([page.waitForEvent('download'), btn.click()]);
  expect(download.suggestedFilename()).toMatch(/^pnl-lens-30-day-plan-\d{2}-[A-Z][a-z]{2}-\d{2}\.pdf$/);
  const pdf = fs.readFileSync((await download.path())!).toString('latin1');
  expect(pdf.startsWith('%PDF')).toBe(true);
  expect(pdf.match(/\/Type \/Page$/gm)?.length).toBe(2);
  expect(pdf).toMatch(/\/reminders\/new\?report=[0-9a-f-]{36}&date=\d{4}-\d{2}-\d{2}\)/);
  await expect(btn).toHaveText('30-day plan');
});

test('"Remind me" turns on one check-up email; Your data shows and sends it once', async ({ page }) => {
  await signIn(page, email, '/dashboard');
  const reportId = reportUrl.split('/report/')[1];
  const date = new Date(Date.now() + (5.5 * 3600e3) + 30 * 86400e3).toISOString().slice(0, 10);
  await page.goto(`/reminders/new?report=${reportId}&date=${date}`);
  await expect(page.locator('h1')).toContainText('Remind me on');
  await page.getByRole('button', { name: 'Turn on reminder' }).click();
  await expect(page.locator('[data-reminder-done]')).toContainText('Done. We’ll email you on');
  await page.goto('/dashboard');
  await expect(page.locator('[data-reminder]')).toContainText('Check-up reminder:');
  // make it due now: the api's sender (every 2 s in this stack) emails it once
  sql(`update plan_reminders set remind_on = current_date - 1 where user_id = (select id from users where email = '${email}') and sent_at is null and cancelled_at is null`);
  await expect.poll(() => lastMail(email)?.subject, { timeout: 20_000 }).toBe('Your 30-day check-up is today');
  expect(lastMail(email)!.text).toContain('/upload');
  expect(sql(`select count(*) from plan_reminders where user_id = (select id from users where email = '${email}') and sent_at is not null`)).toBe('1');
  await page.reload();
  await expect(page.locator('[data-reminder]')).toHaveCount(0);
});

test('signed out: the reminder link goes through sign-in and comes back', async ({ browser }) => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto('/reminders/new?date=2030-01-01');
  await expect(page).toHaveURL(/\/login\?next=%2Freminders%2Fnew%3Fdate%3D2030-01-01/);
  await ctx.close();
});
