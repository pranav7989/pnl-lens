/**
 * @file  tests/e2e-web/manual.spec.ts
 * @area  Tests
 * @what  User manual: India and Global editions at /manual (Market context only in India), the edition switch, the contents links, and a "User manual" link on the landing page, for visitors and in the signed-in header; pricing cards promise only built features.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test('manual: India and Global editions, contents, edition switch, no sideways scroll', async ({ page }) => {
  await page.goto('/manual?region=in');
  await expect(page.locator('[data-manual="india"]')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'PnL Lens user manual' })).toBeVisible();
  await expect(page.locator('.mn-pill')).toHaveText('India edition · ₹');
  await expect(page.locator('#edge')).toContainText('Market context');
  await expect(page.locator('#plans')).toContainText('₹499');
  await page.locator('.mn-toc').getByRole('link', { name: 'Rewind tab' }).click();
  await expect(page).toHaveURL(/#rewind$/);
  await page.getByRole('link', { name: 'Read the Global edition ($)' }).click();
  await expect(page.locator('[data-manual="global"]')).toBeVisible();
  await expect(page.locator('#plans')).toContainText('$19');
  await expect(page.locator('#edge')).not.toContainText('Market context');
  await page.setViewportSize({ width: 390, height: 860 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('links: landing page (header and footer), visitor header, signed-in header; pricing promises only built features', async ({ page, browserName }) => {
  await page.goto('/?region=in');
  await expect(page.locator('.lp-links').getByRole('link', { name: 'User manual' })).toHaveAttribute('href', '/manual');
  await expect(page.locator('.lp-foot').getByRole('link', { name: 'User manual' })).toHaveAttribute('href', '/manual');
  const cards = await page.locator('#pricing').innerText();
  expect(cards).not.toMatch(/PDF\/CSV export|Share reports with your coach/);
  expect(cards).toContain('30-day plan with a check-up on your next report');
  await page.goto('/login');
  await expect(page.locator('.app-header').getByRole('link', { name: 'User manual' })).toHaveAttribute('href', '/manual');
  test.skip(browserName === 'webkit', 'Secure cookie over plain http');
  await signIn(page, `manual-${Date.now()}@e2e.local`, '/dashboard');
  await page.locator('.app-header').getByRole('link', { name: 'User manual' }).click();
  await expect(page).toHaveURL(/\/manual$/);
  await expect(page.locator('.app-nav a[aria-current="page"]')).toHaveText('User manual');
});
