/**
 * @file  tests/e2e-web/reports.spec.ts
 * @area  Tests
 * @what  Consent boxes (Terms/Privacy links, research unticked) and finding/renaming reports: dashboard search, sort, rename; rename on the report page; the dashboard is one centred column.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { signIn, sql, FIX } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

const email = `reports-${Date.now()}@e2e.local`;

test('upload screen: required box accepts Terms and Privacy (links work); research box is optional and unticked', async ({ page, request }) => {
  await signIn(page, email, '/upload');
  const consent = page.locator('.consent label').filter({ has: page.locator('input[name=consent]') });
  await expect(consent).toHaveText('I agree to the Terms of Service and Privacy Policy, and to PnL Lens processing these files to build my report.');
  await expect(consent.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
  await expect(consent.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  await expect(page.locator('input[name=research]')).not.toBeChecked();
  await expect(page.locator('.consent label').filter({ has: page.locator('input[name=research]') }))
    .toHaveText('Make my insights sharper: let PnL Lens learn from my trades, with my name and email removed. Optional — you can change this anytime.');
  for (const [url, h] of [['/terms', 'Terms of Service'], ['/privacy', 'Privacy Policy']]) {
    const r = await request.get(url);
    expect(r.status()).toBe(200);
    expect(await r.text()).toContain(h);
  }
});

test('dashboard: search, sort and rename; report page: rename', async ({ page }) => {
  await signIn(page, email, '/dashboard');
  sql(`insert into subscriptions (user_id, plan_id, reports_total, files_per_report, ends_at, grant_reason) select id, 'snapshot', 5, 3, now() + interval '92 days', 'e2e' from users where email = '${email}'`);
  // one real report, plus two quick rows for the list
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
  const reportUrl = page.url();
  sql(`insert into reports (user_id, title, file_names, file_hashes, trade_count, net_pnl_minor, currency, expires_at, created_at)
       select id, 'Alpha month', '{groww_pnl.csv}', '{h1}', 12, -50000, 'INR', 'infinity', now() - interval '40 days' from users where email = '${email}'`);
  sql(`insert into reports (user_id, title, file_names, file_hashes, trade_count, net_pnl_minor, currency, expires_at, created_at)
       select id, null, '{dhan_tradebook.csv}', '{h2}', 7, 120000, 'INR', 'infinity', now() - interval '70 days' from users where email = '${email}'`);

  // rename on the report page
  await page.goto(reportUrl);
  await page.getByRole('button', { name: 'Rename this report' }).click();
  await page.getByRole('textbox', { name: 'Report name' }).fill('October review');
  await page.keyboard.press('Enter');
  await expect(page.locator('.rp-name')).toContainText('October review');
  await page.reload();
  await expect(page.locator('.rp-name')).toContainText('October review');

  // dashboard: 3 cards, search narrows, sort by name, rename persists
  await page.goto('/dashboard');
  const list = page.locator('[data-report-list]');
  await expect(list.locator('.rl-card')).toHaveCount(3);
  await page.getByRole('searchbox', { name: 'Search reports' }).fill('dhan');
  await expect(list.locator('.rl-card')).toHaveCount(1);
  await expect(list.locator('.rl-count')).toHaveText('1 of 3 reports');
  await expect(list.locator('.rl-card .rl-name')).toHaveText(/^Report · /);                 // untitled default name
  await page.getByRole('searchbox', { name: 'Search reports' }).fill('october');
  await expect(list.locator('.rl-card')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search reports' }).fill('');
  await page.getByRole('combobox', { name: 'Sort reports' }).selectOption('name');
  await expect(list.locator('.rl-name')).toHaveText(['Alpha month', 'October review', /^Report · /]);
  const alpha = list.locator('.rl-card').filter({ hasText: 'Alpha month' });
  await alpha.getByRole('button', { name: /^Rename/ }).click();
  await page.getByRole('textbox', { name: 'Report name' }).fill('Alpha (renamed)');
  await page.keyboard.press('Enter');
  await expect(list.locator('.rl-name').first()).toHaveText('Alpha (renamed)');
  await page.reload();
  await expect(page.locator('[data-report-list] .rl-name').filter({ hasText: 'Alpha (renamed)' })).toHaveCount(1);
});

test('dashboard: one centred column on a wide screen; no sideways scroll on a phone', async ({ page }) => {
  await signIn(page, email, '/dashboard');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');
  const reports = await page.locator('.dash-reports').boundingBox(), data = await page.locator('.data-rights').boundingBox();
  const mid = await page.evaluate(() => document.documentElement.clientWidth / 2);
  expect(Math.abs(reports!.x + reports!.width / 2 - mid)).toBeLessThanOrEqual(2);
  expect(Math.abs(data!.x - reports!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(data!.width - reports!.width)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/dashboard');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
