/**
 * @file  tests/e2e-web/share.spec.ts
 * @area  Tests
 * @what  Share progress ("My Trading Discipline"): discipline tiles only (no results, returns, money or securities) and the SEBI disclaimer, the hero picker, locked chips when every tile is needed, Card (1080×1728) and Story (1080×1920) downloads with a readable QR, the founding badge from /me and its toggle, the use recorded with its choices; a QR visit is counted.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { signIn, givePlan, sql, FIX } from './helpers';

test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];   // IHDR width × height

test('share card: discipline only, SEBI disclaimer, hero, card and story, founding badge, recorded', async ({ page }) => {
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
  await expect(items).toHaveCount(6);
  const list = dlg.locator('[data-share-items]');
  // legal safety: no results, returns, money or securities
  expect(await list.innerText()).not.toMatch(/%|[₹$€£]|RELIANCE|BANKNIFTY|NIFTY|\b(win|wins|won|profit|loss|return|best|green)\b/i);
  await expect(list).toContainText('Biggest achievement: 2 habits fixed');
  await expect(list).toContainText('Level reached: Disciplined');
  await expect(list).toContainText('Trades reviewed: 96');
  await expect(list).toContainText('Strongest habit: ');
  await expect(dlg.locator('[data-share-badge]')).toHaveCount(0);           // no founding number yet
  await expect(dlg.locator('[data-share-canvas]')).toHaveAttribute('aria-label', /Not investment advice or a recommendation\. PnL Lens is not registered with SEBI\.$/);

  // hero picker; every tile is needed to fill this card, so its chips are locked
  await dlg.locator('[data-share-hero]').getByRole('button', { name: 'Level reached' }).click();
  await expect(items.first()).toHaveText('Biggest achievement: Reached Disciplined');
  await expect(list).not.toContainText('Level reached:');
  await expect(dlg.locator('[data-share-tiles]').getByRole('button', { name: 'Trades reviewed' })).toBeDisabled();
  await expect(dlg.locator('[data-share-canvas]')).toHaveAttribute('aria-label', /^My trading discipline card, Jan–Mar 2025: Biggest achievement: Reached Disciplined;/);

  // card download
  let [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-share-download]').click()]);
  expect(download.suggestedFilename()).toBe('pnl-lens-discipline.png');
  let png = fs.readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(size(png)).toEqual([1080, 1728]);

  // story download
  await dlg.locator('[data-share-format="story"]').click();
  [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-share-download]').click()]);
  expect(download.suggestedFilename()).toBe('pnl-lens-discipline-story.png');
  png = fs.readFileSync((await download.path())!);
  expect(size(png)).toEqual([1080, 1920]);

  await expect.poll(() => sql(`select count(*) from events e join users u on u.id = e.user_id where u.email = '${email}' and e.name = 'share_card_used'`)).toBe('2');
  const props = JSON.parse(sql(`select e.props from events e join users u on u.id = e.user_id where u.email = '${email}' and e.name = 'share_card_used' order by e.id desc limit 1`));
  expect(props).toMatchObject({ how: 'download', format: 'story', hero: 'level', badge: false });
  expect(props.tiles).toHaveLength(5);
  expect(props.tiles).not.toContain('level');

  // founding badge: shown once the account has a number, and can be hidden
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(dlg).toHaveCount(0);
  sql(`update users set founding_no = null where founding_no = 427`);       // a number is unique: free it from an earlier run
  sql(`update users set founding_no = 427 where email = '${email}'`);
  await page.locator('[data-share-open]').click();
  await expect(dlg.locator('[data-share-badge]')).toBeVisible();
  await expect(dlg.locator('[data-share-canvas]')).toHaveAttribute('aria-label', /founding trader #0427 \/ 1000/);
  await dlg.locator('[data-share-badge]').click();
  await expect(dlg.locator('[data-share-canvas]')).not.toHaveAttribute('aria-label', /founding trader/);
});

test('a visit from the share card QR is counted, with nothing about the visitor', async ({ page }) => {
  const before = Number(sql(`select count(*) from events where name = 'landing_visit' and props->>'source' = 'share_card'`));
  await page.goto('/?utm_source=share_card&utm_medium=qr');
  await expect.poll(() => Number(sql(`select count(*) from events where name = 'landing_visit' and props->>'source' = 'share_card'`))).toBe(before + 1);
  const row = JSON.parse(sql(`select json_build_object('user', user_id, 'props', props) from events where name = 'landing_visit' order by id desc limit 1`));
  expect(row.user).toBeNull();
  expect(Object.keys(row.props).sort()).toEqual(['medium', 'region', 'source']);
});
