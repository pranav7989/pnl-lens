/**
 * @file  tests/e2e-web/desk.spec.ts
 * @area  Tests
 * @what  Desk: a visitor sees the calculator with the spec B2.6 golden numbers (charges only and with slippage), segments and exchanges switch, the disclaimer is shown; a signed-in trader saves risk and slippage, sees today's events (timeline, tags) and overnight headlines (new tab, unavailable state); an admin adds and hides an event in the console.
 */
import { test, expect } from '@playwright/test';
import { signIn, sql } from './helpers';

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
  await expect(d.locator('[data-desk-guest]')).toContainText('Sign in to see today');
  await expect(d.locator('[data-desk-events]')).toHaveCount(0);
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

const IST_DAY = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

test('signed in: today\'s events and overnight headlines', async ({ page }) => {
  const day = IST_DAY();
  sql(`delete from desk_events where source in ('e2e', 'manual'); delete from desk_headlines;
       insert into desk_events (day, at, title, impact, category, source, source_id) values
         ('${day}', '10:00', 'E2E policy decision', 'high', 'policy', 'e2e', 'p1'),
         ('${day}', '15:30', 'E2E Nifty weekly expiry', 'expiry', 'expiry', 'e2e', 'p2'),
         ('${day}', '12:00', 'E2E hidden event', 'medium', 'macro', 'e2e', 'p3');
       update desk_events set hidden = true where source_id = 'p3';
       insert into desk_headlines (provider, title, title_key, source, url, published_at) values
         ('fake', 'E2E headline one', 'e2e headline one', 'Sample wire', 'https://example.com/e2e/1', now() - interval '2 minutes');
       insert into desk_feed_status (feed, provider, last_ok_at) values ('headlines', 'fake', now())
         on conflict (feed) do update set last_ok_at = now(), last_error = null;`);
  await signIn(page, `desk-today-${Date.now()}@e2e.local`, '/desk');
  const ev = page.locator('[data-desk-events]');
  await expect(ev.locator('li')).toContainText(['E2E policy decision', 'E2E Nifty weekly expiry']);
  await expect(ev).not.toContainText('E2E hidden event');
  await expect(ev.locator('li', { hasText: 'E2E policy decision' }).locator('.desk-tag')).toHaveText('HIGH');
  await expect(ev.locator('li', { hasText: 'Nifty weekly' }).locator('.desk-tag')).toHaveText('EXPIRY');
  await expect(ev.locator('[data-desk-timeline]')).toBeVisible();
  const hl = page.locator('[data-desk-headlines]');
  await expect(hl).toContainText('News only · no views');
  const link = hl.getByRole('link', { name: 'E2E headline one' });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  sql(`update desk_feed_status set last_ok_at = now() - interval '1 hour' where feed = 'headlines'; delete from desk_headlines;`);
  await page.reload();
  await expect(page.locator('[data-desk-headlines-down]')).toContainText(/Headlines unavailable · last updated \d{2}:\d{2}/);
});

test('admin: add an event in the console, it shows on the Desk; hide it again', async ({ page }) => {
  const email = `desk-admin-${Date.now()}@e2e.local`;
  await signIn(page, email, '/desk');
  sql(`update users set role = 'admin' where email = '${email}'`);
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Desk' }).click();
  await expect(page.locator('[data-desk-admin]')).toBeVisible();
  await page.getByLabel('Time (IST)').fill('11:00');
  await page.getByLabel('Title').fill('E2E budget speech');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Event added');
  await page.goto('/desk');
  await expect(page.locator('[data-desk-events]')).toContainText('E2E budget speech');
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Desk' }).click();
  await page.locator('tr', { hasText: 'E2E budget speech' }).getByRole('button', { name: 'Hide' }).click();
  await expect(page.locator('tr', { hasText: 'E2E budget speech (hidden)' })).toBeVisible();
  await page.goto('/desk');
  await expect(page.locator('[data-desk-events]')).not.toContainText('E2E budget speech');
});
