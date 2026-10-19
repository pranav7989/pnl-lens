/**
 * @file  tests/e2e-web/research.spec.ts
 * @area  Tests
 * @what  Research datasets end to end: the owner builds one now (the real worker, storage and encryption), downloads the ZIP; an admin has no Research tab.
 */
import { test, expect } from '@playwright/test';
import { signIn, sql } from './helpers';

test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

test('owner: Build now → Ready → Download gives the ZIP with the CSVs and README', async ({ page }) => {
  const email = `research-owner-${Date.now()}@e2e.local`;
  await signIn(page, email);
  sql(`update users set role = 'owner' where email = '${email}'`);
  sql(`update research_exports set status = 'failed', error = 'e2e reset' where status in ('pending', 'building')`);
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Research' }).click();
  await expect(page.getByText(/Built automatically on the 1st and 16th/)).toBeVisible();
  await page.getByRole('button', { name: 'Build now' }).click();
  const row = page.locator('[data-research-admin] tbody tr').first();
  await expect(row).toContainText('Ready', { timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('link', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^pnl-lens-research-\d{4}-\d{2}-\d{2}\.zip$/);
  const buf = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c as Buffer[]));
  expect(buf.subarray(0, 2).toString()).toBe('PK');
  for (const name of ['README.md', 'subjects.csv', 'reports.csv', 'trades.csv', 'habits.csv']) expect(buf.includes(Buffer.from(name))).toBe(true);
  expect(sql(`select count(*) from audit_log a join users u on u.id = a.user_id where u.email = '${email}' and a.action = 'research_export_downloaded'`)).toBe('1');
});

test('admin: no Research tab, and the API refuses', async ({ page }) => {
  const email = `research-admin-${Date.now()}@e2e.local`;
  await signIn(page, email);
  sql(`update users set role = 'admin' where email = '${email}'`);
  await page.goto('/admin');
  await expect(page.getByRole('tab', { name: 'Blog' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Research' })).toHaveCount(0);
  expect(await page.evaluate(async () => (await fetch('/api/v1/admin/research/exports')).status)).toBe(403);
});
