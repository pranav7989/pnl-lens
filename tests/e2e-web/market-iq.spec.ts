/**
 * @file  tests/e2e-web/market-iq.spec.ts
 * @area  Tests
 * @what  Market page (flag "owner", the stack default): the owner sees the Market link and the page with sheet tabs, data service status and the disclaimer, without sideways scroll on a phone; a paying user sees neither.
 */
import { test, expect } from '@playwright/test';
import { signIn, givePlan, sql } from './helpers';

test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

test('owner: Market link, tabs, service status and disclaimer; phone width fits', async ({ page }) => {
  const email = `mkt-owner-${Date.now()}@e2e.local`;
  await signIn(page, email, '/dashboard');
  sql(`update users set role = 'owner' where email = '${email}'`);
  await page.goto('/dashboard');
  const link = page.locator('.app-nav').getByRole('link', { name: 'Market' });
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(/\/market$/);
  const mk = page.locator('[data-market]');
  await expect(mk.getByRole('heading', { name: 'Market', level: 1 })).toBeVisible();
  await expect(mk.getByRole('tab')).toHaveText(['Nifty', 'Bank Nifty', 'Market']);
  await mk.getByRole('tab', { name: 'Bank Nifty' }).click();
  await expect(mk.locator('[data-market-tab]')).toHaveAttribute('data-market-tab', 'banknifty');
  await expect(mk.locator('[data-market-status]')).toContainText('Dhan login');            // the data service answered through the API
  await expect(mk.locator('[data-market-fresh]')).not.toContainText('not answering');
  await expect(mk).toContainText('Not investment advice');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a paying user does not see it while access is owner-only', async ({ page }) => {
  const email = `mkt-user-${Date.now()}@e2e.local`;
  await signIn(page, email, '/dashboard');
  givePlan(email);
  await page.goto('/dashboard');
  await expect(page.locator('.app-nav').getByRole('link', { name: 'Market' })).toHaveCount(0);
  const r = await page.goto('/market');
  expect(r?.status()).toBe(404);
});
