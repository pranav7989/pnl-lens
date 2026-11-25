/**
 * @file  tests/e2e-web/desk.spec.ts
 * @area  Tests
 * @what  Desk (PR 1): a visitor sees the calculator with the spec B2.6 golden numbers (charges only and with slippage), segments and exchanges switch, the disclaimer is shown; a signed-in trader saves risk and slippage and gets them back.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

test.describe.configure({ mode: 'serial' });

test('visitor: golden example, segments, exchanges, disclaimer', async ({ page }) => {
  await page.goto('/desk');
  const d = page.locator('[data-desk]');
  await expect(d.getByRole('heading', { name: 'Desk' })).toBeVisible();
  await expect(d.locator('[data-desk-session]')).toContainText(/IST$/);
  // defaults are the spec example: options NSE, 120 → 170, qty 65
  const charges = d.locator('[data-desk-charges]');
  await expect(charges).toContainText('₹18,850.00');
  await expect(charges.locator('.desk-total')).toContainText('₹72.36');
  await expect(d.locator('[data-desk-breakeven] > b')).toHaveText('1.11');
  await expect(d.locator('[data-desk-net] > b')).toHaveText('₹3,177.64');
  await expect(d.locator('[data-desk-size] > b')).toHaveText('65');
  await page.fill('#d-slip', '1.6');
  await expect(d.locator('[data-desk-breakeven]')).toContainText('With your slippage: 2.71');
  await expect(d.locator('[data-desk-net]')).toContainText('₹3,073.64');
  await page.fill('#d-risk', '2000');
  await page.fill('#d-sl', '70');
  await expect(d.locator('[data-desk-size]')).toContainText('Your risk rule allows less than 1 lot at this stop-loss');

  await d.getByRole('tab', { name: 'Commodity fut' }).click();
  await expect(d.getByRole('radio', { name: 'MCX' })).toBeVisible();
  await expect(charges).toContainText('CTT');
  await d.getByRole('tab', { name: 'Delivery' }).click();
  await expect(d.getByRole('radio', { name: 'BSE' })).toBeVisible();
  await expect(d.locator('#d-lot')).toHaveCount(0);
  await expect(d.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(d.locator('[data-desk-disclaimer]')).toHaveText('Headlines and scheduled events only. Prices are entered by you. Not investment advice.');
});

test('signed in: Desk is the first link; risk and slippage are saved per trader', async ({ page }) => {
  await signIn(page, `desk-${Date.now()}@e2e.local`, '/desk');
  await expect(page.locator('.app-nav a').first()).toHaveText('Desk');
  await page.fill('#d-risk', '4500');
  await page.fill('#d-slip', '0.8');
  await page.getByRole('button', { name: 'Save risk and slippage as my defaults' }).click();
  await expect(page.locator('.desk-save [role=status]')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('#d-risk')).toHaveValue('4500');
  await expect(page.locator('#d-slip')).toHaveValue('0.8');
});
