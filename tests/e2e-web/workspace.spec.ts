/**
 * @file  tests/e2e-web/workspace.spec.ts
 * @area  Tests
 * @what  Browser end to end on the stack: sign in → upload with consent → loader → report (5 tabs) → "+" → file tabs/All files → rename in history → second device → remove → delete.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { signIn, givePlan, sql, FIX, cspViolations } from './helpers';

const email = `e2e-${Date.now()}@pnllens.test`;

test('a trader without a plan gets the free preview, nothing is spent', async ({ page }) => {
  await signIn(page, email, '/upload');
  await expect(page.getByText('Your files are encrypted, processed on our secure servers, and deleted automatically after 30 days.')).toBeVisible();
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await expect(page.getByRole('button', { name: 'Analyse' })).toBeDisabled();                 // consent is required
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await expect(page.locator('[data-preview] .tile').filter({ hasText: 'Trades' })).toContainText('96');   // preview: trades
  await expect(page.getByRole('link', { name: /^Get the full report from (₹99|\$9)$/ })).toBeVisible();
  expect(sql(`select count(*) from reports r join users u on u.id = r.user_id where u.email = '${email}'`)).toBe('0');
  expect(sql(`select string_agg(purpose || ':' || granted, ',') from consents c join users u on u.id = c.user_id where u.email = '${email}'`)).toBe('processing:true');
});

test('the full workspace flow, and a second device sees the same report', async ({ page, browser }) => {
  const csp = cspViolations(page);
  givePlan(email, 'snapshot', 5, 2);
  await signIn(page, email, '/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.check('input[name=research]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  const reportUrl = page.url();
  await expect(page.locator('.ws-main .page-title')).toHaveText('zerodha_tradebook.csv');
  await expect(page.locator('#overview')).toContainText('₹2.12L');
  for (const t of ['Progress', 'Insights & fixes', 'Clusters', 'Positions', 'Overview']) {
    await page.locator('#reportRoot .tabs').getByRole('tab', { name: t }).click();
    await expect(page.locator('#reportRoot .tabs').getByRole('tab', { name: t })).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.locator('.ws-plan')).toContainText('1 of 5 reports used');

  // "+": a second statement opens as its own tab; All files combines both
  await page.locator('input[type=file]:not(#file)').setInputFiles(path.join(FIX, 'groww_pnl.csv'));
  await expect(page.locator('.ws-item.all')).toContainText('2 files · 101 positions', { timeout: 90_000 });
  await expect(page.locator('.ws-main .page-title')).toHaveText('groww_pnl.csv');
  await page.locator('.ws-item.all').click();
  await expect(page.locator('.ws-main .page-title')).toHaveText('All files');
  await expect(page.locator('.ws-used')).toContainText('2 of 2');
  await expect(page.locator('.ws-add')).toHaveCount(0);                                          // no places left
  await expect(page.locator('.ws-plan')).toContainText('1 of 5 reports used');                   // "+" spends nothing

  // rename in the history list (MON-YY group)
  await expect(page.locator('#historyList .ws-hist-m').first()).toHaveText(/^[A-Z]{3}-\d{2}\d+$/);
  await page.locator('#historyList .ws-hist-i').first().hover();
  await page.locator('#historyList .ws-hist-ren').first().click();
  await page.locator('#historyList .ws-hist-edit input').fill('Q1 review');
  await page.locator('#historyList .ws-hist-edit input').press('Enter');
  await expect(page.locator('#historyList .n.named')).toHaveText('Q1 review');

  // a second device: new browser, same account, same report and numbers
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await signIn(p2, email, '/dashboard');
  await expect(p2.locator('.ws-hist .n.named')).toHaveText('Q1 review');
  await p2.goto(reportUrl);
  await expect(p2.locator('.ws-item.all')).toContainText('2 files · 101 positions');
  await other.close();

  // remove a statement: it keeps its place (2 of 2), the report shows one file
  await page.locator('.ws-item', { hasText: 'groww_pnl.csv' }).locator('.ws-x').click();
  await expect(page.locator('.ws-item:not(.all)')).toHaveCount(1, { timeout: 90_000 });
  await expect(page.locator('.ws-used')).toContainText('2 of 2');

  // delete the report
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.goto(reportUrl);
  await expect(page.getByText('This report was deleted')).toBeVisible();
  expect(sql(`select string_agg(purpose || ':' || granted, ',' order by c.id) from consents c join users u on u.id = c.user_id where u.email = '${email}'`)).toContain('research:true');
  expect(csp, 'CSP violations').toEqual([]);
});

test('the site no longer claims files stay in the browser (approved wording)', async ({ page }) => {
  await page.goto('/?region=in');
  const text = await page.locator('body').innerText();
  for (const old of ['never uploaded', 'read in your browser', 'Read on your device', 'Files are read in your browser']) expect(text).not.toContain(old);
  expect(text).toContain('Private and encrypted');
  expect(text).toContain('Encrypted on upload.');
});
