/**
 * @file  tests/e2e-web/market.spec.ts
 * @area  Tests
 * @what  Market context (India only): an Indian report shows NIFTY over the period and results by VIX level and index move; a non-Indian (crypto) report shows no market section at all.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { signIn, givePlan, sql, FIX } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

const email = `market-${Date.now()}@e2e.local`;
const upload = async (page: any, file: string) => {
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, file));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
};

test('India report: market context; crypto report: masked', async ({ page }) => {
  // daily closes for Dec 2024 – Apr 2025 (the stack's sync is off in tests; the api fetches these itself in production)
  sql(`delete from market_daily`);
  sql(`insert into market_daily (symbol, day, close, source)
       select s.sym, d::date, s.base * (1 + 0.012 * sin(extract(doy from d) / 3.0)), 'upstox'
         from generate_series('2024-12-20'::date, '2025-04-10'::date, interval '1 day') d,
              (values ('NIFTY', 23000.0), ('BANKNIFTY', 49000.0), ('INDIAVIX', 16.0)) s(sym, base)
        where extract(isodow from d) < 6`);
  await signIn(page, email, '/upload');
  givePlan(email);
  await upload(page, 'zerodha_tradebook.csv');
  await page.locator('#reportRoot .tabs').getByRole('tab', { name: 'Edge' }).click();
  const mk = page.locator('[data-market]');
  await expect(mk).toBeVisible();
  await expect(mk.locator('[data-nifty]')).toHaveText(/^[+−]?\d+\.\d%$/);
  await expect(mk.locator('[data-market-vix] li')).not.toHaveCount(0);
  await expect(mk.locator('[data-market-move] li')).not.toHaveCount(0);

  await upload(page, 'binance_trades.csv');
  await page.locator('#reportRoot .tabs').getByRole('tab', { name: 'Edge' }).click();
  await expect(page.locator('[data-edge]')).toBeVisible();
  await expect(page.locator('[data-compare]')).toBeVisible();                 // the tab has loaded its panels
  await expect(page.locator('[data-market]')).toHaveCount(0);
});
