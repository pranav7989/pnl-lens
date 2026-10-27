/**
 * @file  tests/e2e-web/edge.spec.ts
 * @area  Tests
 * @what  Edge tab: verdict with average trade, 90% range, chance of luck and trades needed; the next-100-trades projection with its chart and figures; the same numbers on a reload; no sideways scroll on a phone.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { signIn, givePlan, FIX } from './helpers';

test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

test('Edge: skill-or-luck verdict and the next 100 trades, stable across reloads', async ({ page }) => {
  const email = `edge-${Date.now()}@e2e.local`;
  await signIn(page, email, '/upload');
  givePlan(email);
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });

  const open = async () => { await page.locator('#reportRoot .tabs').getByRole('tab', { name: 'Edge' }).click(); await expect(page.locator('[data-edge]')).toBeVisible(); };
  await open();
  const eg = page.locator('[data-edge]');
  await expect(eg.locator('[data-verdict]')).toHaveAttribute('data-verdict', /^(real|unproven|negative)$/);
  await expect(eg.getByText('Chance it is luck')).toBeVisible();
  await expect(eg.getByText(/90% sure it is between/)).toBeVisible();
  await expect(eg.getByRole('heading', { name: 'Your next 100 trades' })).toBeVisible();
  await expect(eg.locator('.eg-fan')).toBeVisible();
  await expect(eg.locator('.eg-stats li')).toHaveCount(7);
  const before = await eg.innerText();
  await page.reload();
  await open();
  expect(await page.locator('[data-edge]').innerText()).toBe(before);           // seeded: the same report, the same numbers

  await page.setViewportSize({ width: 390, height: 860 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
