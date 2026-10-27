/**
 * @file  tests/e2e-web/edge.spec.ts
 * @area  Tests
 * @what  Edge tab: verdict, next-100-trades projection, capital % (add, kept after reload, remove), consistency and risk by day, R-multiples, weekday × hour heatmap; the same numbers on a reload; no sideways scroll on a phone. Drill-down: a cluster row opens Positions filtered to its trades.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { signIn, givePlan, FIX } from './helpers';

test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

test('Edge: skill-or-luck verdict, the next 100 trades and capital %, stable across reloads', async ({ page }) => {
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
  await expect(eg.locator('[data-consistency]')).toContainText('Green days');
  await expect(eg.locator('[data-r-multiples]')).toContainText('1R = your average loss');
  await expect(eg.locator('[data-heatmap] .eg-heat td:not(.none)')).not.toHaveCount(0);
  // capital %: optional; add it, it is kept, then remove it
  const cp = eg.locator('[data-capital]');
  await expect(cp).toContainText('Add the capital you traded with');
  await cp.getByRole('textbox', { name: 'Capital used' }).fill('5,00,000');
  await cp.getByRole('button', { name: 'Save' }).click();
  await expect(cp.locator('[data-capital-value]')).toHaveText('₹5.00L');
  await expect(cp.locator('[data-return]')).toHaveText(/^\+\d+\.\d%$/);
  await page.reload();
  await open();
  await expect(page.locator('[data-capital] [data-capital-value]')).toHaveText('₹5.00L');
  const before = await eg.innerText();
  await page.reload();
  await open();
  expect(await page.locator('[data-edge]').innerText()).toBe(before);           // seeded: the same report, the same numbers

  await page.setViewportSize({ width: 390, height: 860 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.locator('[data-capital]').getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('[data-capital]')).toContainText('Add the capital you traded with');
});

test('drill-down: a cluster row opens Positions filtered to exactly its trades, and the chip clears it', async ({ page }) => {
  const email = `drill-${Date.now()}@e2e.local`;
  await signIn(page, email, '/upload');
  givePlan(email);
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
  await page.locator('#reportRoot .tabs').getByRole('tab', { name: 'Clusters' }).click();
  await page.getByRole('tab', { name: /How you hold/ }).click();
  const row = page.locator('#clusters [data-drill="callPut"]').first();
  const n = Number((await row.locator('.rv-bl span').innerText()).match(/^(\d+) trade/)![1]);
  const key = await row.getAttribute('data-key');
  await row.click();
  await expect(page.locator('#positions')).toBeVisible();
  await expect(page.locator('#pdrill')).toContainText(key!);
  await expect(page.locator('#ptable tr.tot')).toContainText(`${n} positions`);
  await page.locator('#pdrill').getByRole('button', { name: /Show all positions/ }).click();
  await expect(page.locator('#pdrill')).toBeHidden();
  await expect(page.locator('#ptable tr.tot')).not.toContainText(`${n} positions`);
});
