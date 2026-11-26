/**
 * @file  tests/e2e-web/lifetime.spec.ts
 * @area  Tests
 * @what  Lifetime view: the dashboard link appears with 2+ reports; the same statement uploaded twice counts once; Summary, Edge and Rewind work on all trades; one report shows the "needs two" message.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { signIn, givePlan, FIX } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

const email = `lifetime-${Date.now()}@e2e.local`;
const upload = async (page: any, file: string) => {
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, file));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
};

test('lifetime: one report → needs two; then the same statement twice counts once, plus a second statement', async ({ page }) => {
  await signIn(page, email, '/upload');
  givePlan(email);
  await upload(page, 'zerodha_tradebook.csv');
  await page.goto('/dashboard');
  await expect(page.locator('[data-lifetime-link]')).toHaveCount(0);
  await page.goto('/lifetime');
  await expect(page.locator('[data-lifetime-empty]')).toContainText('needs at least two reports');

  await upload(page, 'zerodha_tradebook.csv');          // same trades again
  await upload(page, 'zerodha_equity_statement.xlsx');  // different trades
  await page.goto('/dashboard');
  await page.locator('[data-lifetime-link]').click();
  await page.waitForURL('**/lifetime');
  const lt = page.locator('[data-lifetime]');
  await expect(lt.getByRole('heading', { name: 'All my trading' })).toBeVisible();
  await expect(lt.locator('.page-sub')).toContainText('3 reports · 112 trades (96 repeated in more than one report, counted once)');
  await expect(lt.locator('[data-lifetime-reports] li')).toHaveCount(3);
  await expect(lt.locator('[data-lifetime-reports] li').nth(1)).toContainText('0 of 96 trades new');

  await lt.getByRole('tab', { name: 'Edge' }).click();
  await expect(page.locator('[data-edge] [data-verdict]')).toBeVisible();
  await lt.getByRole('tab', { name: 'Rewind' }).click();
  await expect(page.locator('[data-rewind] [data-actual]')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 860 });
  await lt.getByRole('tab', { name: 'Summary' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
