/**
 * @file  tests/e2e-web/share.spec.ts
 * @area  Tests
 * @what  Share progress: the dialog shows up to 4 chosen stats (no money), the card is a 1080×1350 PNG download, the choice changes the card, and the use is recorded.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { signIn, givePlan, sql, FIX } from './helpers';

test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

test('share card: pick stats, download a 1080×1350 PNG, no money on it', async ({ page }) => {
  const email = `share-${Date.now()}@e2e.local`;
  await signIn(page, email, '/upload');
  givePlan(email);
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });

  await page.locator('[data-share-open]').click();
  const dlg = page.locator('[data-share]');
  await expect(dlg).toBeVisible();
  const items = dlg.locator('[data-share-items] li');
  await expect(items).not.toHaveCount(0);
  expect(await items.count()).toBeLessThanOrEqual(4);
  expect(await dlg.locator('[data-share-items]').innerText()).not.toMatch(/[₹$€£]/);
  await expect(dlg.locator('[data-share-items]')).toContainText('Trades won');

  // turn "Trades won" off: it leaves the card
  await dlg.getByRole('button', { name: 'Trades won', exact: true }).click();
  await expect(dlg.locator('[data-share-items]')).not.toContainText('Trades won');

  const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-share-download]').click()]);
  expect(download.suggestedFilename()).toBe('pnl-lens-progress.png');
  const png = fs.readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350]);   // IHDR width × height
  await expect.poll(() => sql(`select count(*) from events e join users u on u.id = e.user_id where u.email = '${email}' and e.name = 'share_card_used'`)).toBe('1');

  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(dlg).toHaveCount(0);
});
