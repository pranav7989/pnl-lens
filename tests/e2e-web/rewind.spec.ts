/**
 * @file  tests/e2e-web/rewind.spec.ts
 * @area  Tests
 * @what  Rewind tab: replay the report's trades with rules (30-day plan preset, stop, chips, reset); the result, curve and per-rule list update; no sideways scroll on a phone.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { signIn, givePlan, sql, FIX } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

const email = `rewind-${Date.now()}@e2e.local`;

test('Rewind: the plan preset, a stop and a trades-a-day cap change the result; Reset brings back the real one', async ({ page }) => {
  await signIn(page, email, '/upload');
  givePlan(email);
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });

  await page.locator('#reportRoot .tabs').getByRole('tab', { name: 'Rewind' }).click();
  const rw = page.locator('[data-rewind]');
  await expect(rw).toBeVisible();
  const real = await rw.locator('[data-actual]').innerText();
  await expect(rw.locator('[data-rewound]')).toHaveText(real);
  await expect(rw.locator('[data-delta]')).toContainText('Pick a rule');

  await rw.locator('[data-rewind-plan]').click();
  await expect(rw.locator('[data-delta]')).toContainText(/^\+/);
  await expect(rw.locator('[data-delta]')).toContainText('more than you made');
  await expect(rw.locator('.rw-list li')).not.toHaveCount(0);
  await expect(rw.locator('[data-rewound]')).not.toHaveText(real);

  await rw.getByRole('button', { name: 'Reset' }).click();
  await expect(rw.locator('[data-rewound]')).toHaveText(real);

  await rw.getByRole('checkbox', { name: /Off/ }).first().check();             // stop on (−30%)
  await expect(rw.locator('.rw-list li')).toHaveCount(1);
  await expect(rw.locator('.rw-list li').first()).toContainText('Stop at the loss limit');
  await rw.locator('.rw-chips').filter({ hasText: 'No limit' }).getByRole('button', { name: '1' }).click();
  await expect(rw.locator('.rw-list li')).toHaveCount(2);
  await expect.poll(() => sql(`select count(*) from events e join users u on u.id = e.user_id where u.email = '${email}' and e.name = 'rewind_used'`)).toBe('1');

  await page.setViewportSize({ width: 390, height: 860 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
