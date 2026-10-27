/**
 * @file  tests/e2e-web/research.spec.ts
 * @area  Tests
 * @what  Research datasets end to end: the owner builds one now (the real worker, storage and encryption), downloads the ZIP; finds who a subject or report code belongs to (audited); an admin has no Research tab.
 */
import { test, expect } from '@playwright/test';
import { signIn, sql } from './helpers';

test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

test('owner: Build now → Ready → Download gives the ZIP with the CSVs and README', async ({ page }) => {
  const email = `research-owner-${Date.now()}@e2e.local`;
  await signIn(page, email);
  sql(`update users set role = 'owner' where email = '${email}'`);
  sql(`update research_exports set status = 'failed', error = 'e2e reset' where status in ('pending', 'building')`);
  // older datasets (earlier runs) are made not downloadable, so the only Download link is the one built here
  sql(`update research_exports set deleted_at = now() where deleted_at is null`);
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Research' }).click();
  await expect(page.getByText(/Built automatically on the 1st and 16th/)).toBeVisible();
  await page.getByRole('button', { name: 'Build now' }).click();
  const row = page.locator('[data-research-admin] tbody tr').filter({ has: page.getByRole('link', { name: 'Download' }) });
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(row).toContainText('Ready');
  const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('link', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^pnl-lens-research-\d{4}-\d{2}-\d{2}\.zip$/);
  const buf = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c as Buffer[]));
  expect(buf.subarray(0, 2).toString()).toBe('PK');
  for (const name of ['README.md', 'subjects.csv', 'reports.csv', 'trades.csv', 'habits.csv']) expect(buf.includes(Buffer.from(name))).toBe(true);
  expect(sql(`select count(*) from audit_log a join users u on u.id = a.user_id where u.email = '${email}' and a.action = 'research_export_downloaded'`)).toBe('1');
});

test('owner: a subject or report code from a dataset leads back to the account (reason required, audited)', async ({ page }) => {
  const email = `research-lookup-${Date.now()}@e2e.local`, trader = `research-trader-${Date.now()}@e2e.local`;
  sql(`insert into users (email, country, role) values ('${trader}', 'IN', 'user')`);
  await signIn(page, email);
  sql(`update users set role = 'owner' where email = '${email}'`);
  const report = sql(`insert into reports (user_id, title, file_names, file_hashes, expires_at) select id, 'Lookup month', '{a.csv}', '{h}', 'infinity' from users where email = '${trader}' returning id`).split('\n')[0];
  const exp = sql(`insert into research_exports (status, subjects, reports, trades, expires_at, completed_at, deleted_at) values ('ready', 1, 1, 3, now() - interval '1 day', now() - interval '91 days', now()) returning id`).split('\n')[0];
  const code = 'cd'.repeat(12);
  sql(`insert into research_export_reports values ('${exp}', '${code}', '${report}')`);
  const subject = sql(`select encode(hmac(convert_to(u.id::text, 'UTF8'), k.key, 'sha256'), 'hex') from users u, research.pseudonym_key k where u.email = '${trader}'`);

  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Research' }).click();
  const card = page.locator('[data-research-lookup]');
  await card.getByRole('textbox', { name: 'Subject or report code' }).fill(subject);
  await expect(card.getByRole('button', { name: 'Look up' })).toBeDisabled();            // a reason is required
  await card.getByRole('textbox', { name: 'Reason' }).fill('e2e check');
  await card.getByRole('button', { name: 'Look up' }).click();
  await expect(card.locator('[data-lookup-result]')).toContainText(trader);

  await card.getByRole('textbox', { name: 'Subject or report code' }).fill(code);
  await card.getByRole('combobox', { name: 'Dataset' }).selectOption(exp);
  await card.getByRole('button', { name: 'Look up' }).click();
  await expect(card.locator('[data-lookup-result]')).toContainText('Lookup month');
  await expect(card.locator('[data-lookup-result]')).toContainText(trader);
  expect(sql(`select count(*) from audit_log a join users u on u.id = a.user_id where u.email = '${email}' and a.action = 'research_lookup'`)).toBe('2');
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
