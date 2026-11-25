/**
 * @file  tests/e2e-web/credits.spec.ts
 * @area  Tests
 * @what  Credits spec (19 Oct 2026) in the browser: "N reports left" pill and "Plans" menu, plan card wording, free preview (3 numbers, 2 insights, blurred, from ₹99/$9), plan window end, no "credit" on customer screens.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { signIn, sql, FIX } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

const stamp = Date.now();
const noCredit = async (page: Page) => {
  const text = (await page.locator('body').innerText()).replace(/Other credits & debits/g, '');
  expect(text, page.url()).not.toMatch(/\bcredits?\b/i);
};
const grant = (email: string, plan: string, reports: number, files: number, days: number) => sql(
  `insert into subscriptions (user_id, plan_id, reports_total, files_per_report, ends_at, grant_reason)
   select id, '${plan}', ${reports}, ${files}, now() + interval '${days} days', 'e2e' from users where email = '${email}'`);

test('no plan: "No reports left · See plans", menu "Plans", and the free preview only; nothing is saved', async ({ page }) => {
  const email = `credits-free-${stamp}@e2e.local`;
  await signIn(page, email, '/upload');
  await expect(page.locator('.credits-pill')).toHaveText('No reports left · See plans');
  await expect(page.locator('.credits-pill')).toHaveAttribute('href', '/pricing');
  await expect(page.getByRole('link', { name: 'Plans', exact: true })).toHaveAttribute('href', '/pricing');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  const pv = page.locator('[data-preview]');
  await expect(pv.locator('.tile .lab')).toHaveText(['Net P&L', 'Total charges', 'Trades']);
  await expect(pv.locator('.pv-insights li')).toHaveCount(2);
  await expect(pv.locator('.pv-blur')).toHaveAttribute('aria-hidden', 'true');
  await expect(pv.getByRole('link', { name: /^Get the full report from (₹99|\$9)$/ })).toHaveAttribute('href', '/pricing');
  expect(sql(`select count(*) from reports r join users u on u.id = r.user_id where u.email = '${email}'`)).toBe('0');
  await noCredit(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'See plans', exact: true })).toBeVisible();
  await noCredit(page);
  await page.goto('/pricing');
  await noCredit(page);
});

test('Snapshot granted: 5 left → create → 4; plan card wording; after the window: 0, old report opens, "+" refused', async ({ page }) => {
  const email = `credits-snap-${stamp}@e2e.local`;
  await signIn(page, email, '/dashboard');
  grant(email, 'snapshot', 5, 3, 92);
  await page.goto('/upload');
  await expect(page.locator('.credits-pill')).toHaveText('5 reports left');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
  await expect(page.locator('.credits-pill')).toHaveText('4 reports left');
  const useBy = sql(`select to_char(ends_at at time zone 'Asia/Kolkata', 'DD-MON-YY') from subscriptions s join users u on u.id = s.user_id where u.email = '${email}'`);
  const card = useBy.replace(/^(\d\d)-([A-Z])([A-Z]{2})-/, (_m, d, a, b) => `${d}-${a}${b.toLowerCase()}-`);
  await expect(page.locator('.ws-plan-line')).toHaveText(new RegExp(`^Snapshot · 1 of 5 reports used · use by (${useBy}|${card})$`, 'i'));
  await noCredit(page);

  // the plan window ends: 0 usable, the old report still opens, "+" is refused with the ended message
  sql(`update subscriptions set ends_at = now() - interval '1 minute' where user_id = (select id from users where email = '${email}')`);
  const reportUrl = page.url();
  await page.goto('/dashboard');
  await expect(page.locator('.credits-pill')).toHaveText('No reports left · See plans');
  await expect(page.locator('.ws-plan-line')).toContainText('ended');
  await page.goto(reportUrl);
  await expect(page.locator('.ws-plan-line')).toBeVisible();
  const plus = await page.evaluate(async (reportId) => {
    const fd = new FormData(); fd.set('consent', 'true'); fd.set('reportId', reportId);
    fd.append('files', new Blob(['symbol,trade_date,trade_type,quantity,price\nX,2025-01-06,buy,1,100\nX,2025-01-07,sell,1,110\n'], { type: 'text/csv' }), 'b.csv');
    const r = await fetch('/api/v1/analyses', { method: 'POST', body: fd });
    return { status: r.status, body: await r.json() };
  }, reportUrl.split('/report/')[1].split(/[?#]/)[0]);
  expect(plus.status).toBe(402);
  expect(plus.body.message).toBe('Your plan has ended. Your reports are still here. Choose a plan to add statements or create new reports.');
});

test('Single + Snapshot: 6 left; the Single report allows 2 statements', async ({ page }) => {
  const email = `credits-both-${stamp}@e2e.local`;
  await signIn(page, email, '/dashboard');
  grant(email, 'single', 1, 2, 7);
  grant(email, 'snapshot', 5, 3, 92);
  await page.goto('/upload');
  await expect(page.locator('.credits-pill')).toHaveText('6 reports left');
  await expect(page.locator('.up-plan')).toContainText('Single');                                 // the plan the next report uses
  await expect(page.locator('.up-plan')).toContainText('Up to 2 broker statements per report');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
  await expect(page.locator('.credits-pill')).toHaveText('5 reports left');
  expect(sql(`select s.plan_id from reports r join subscriptions s on s.id = r.subscription_id join users u on u.id = r.user_id where u.email = '${email}'`)).toBe('single');
});
