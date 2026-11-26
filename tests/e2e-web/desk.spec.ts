/**
 * @file  tests/e2e-web/desk.spec.ts
 * @area  Tests
 * @what  Desk: a visitor sees the calculator with the spec B2.6 golden numbers (charges only and with slippage), segments and exchanges switch, the disclaimer is shown; a signed-in trader saves risk and slippage, sees today's events (timeline, tags) and overnight headlines (new tab, unavailable state); an admin adds and hides an event in the console; watch-outs go from "needs a plan" to "upload a statement" to the worker-built profile of a real tradebook; the trade plan: unclear line highlighted, a line checked as you type and saved with its chips, Keep anyway needs a reason, Remove, checklist kept; actuals: taken with a result, not taken, a trade not in the plan, the Plan vs actual tiles; the report's Progress tab shows the Desk's plan vs actual for its period.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { signIn, sql, givePlan, FIX } from './helpers';

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

test('watch-outs: plan, then a statement, then the profile the worker builds', async ({ page }) => {
  test.setTimeout(240_000);
  const email = `desk-wo-${Date.now()}@e2e.local`;
  await signIn(page, email, '/desk');
  const wo = page.locator('[data-desk-watchouts]');
  await expect(wo.locator('[data-desk-wo-state="no_plan"]')).toContainText('come with an active plan');
  givePlan(email);
  await page.reload();
  await expect(wo.locator('[data-desk-wo-state="no_report"]')).toContainText('Upload a statement to see your watch-outs.');
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
  // the API asked the worker for a rebuild when the report was saved
  await expect.poll(async () => { await page.goto('/desk'); return wo.textContent({ timeout: 5_000 }).catch(() => null); }, { timeout: 120_000, intervals: [1000, 2000, 3000] })
    .toContain('Checked against your trades up to 26 Mar 2025');
  await expect(wo.getByRole('link', { name: 'update' })).toHaveAttribute('href', '/upload');
  await expect(wo.locator('.desk-wo-list li, p.muted').first()).toBeVisible();
  for (const t of await wo.locator('.desk-wo-list li').allTextContents()) expect(t).toMatch(/Your history: .+ \(.+\d{4}\)/);
  await expect(wo).toContainText('From your own past trades. Not a recommendation.');
});

test('trade plan: type, check, add, keep anyway with a reason, remove; checklist', async ({ page }) => {
  test.setTimeout(240_000);
  const email = `desk-plan-${Date.now()}@e2e.local`;
  await signIn(page, email, '/upload');
  givePlan(email);
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
  sql(`insert into trader_rules (user_id, kind, params, source) select id, 'no_segment', '{"dims":{"instrument":"option","side":"buy"}}', 'manual' from users where email = '${email}'`);
  const card = page.locator('[data-desk-plan]');
  await expect.poll(async () => { await page.goto('/desk'); return card.count(); }, { timeout: 60_000 }).toBe(1);
  await expect(card.locator('[data-desk-rules]')).toContainText('No option buys');

  await page.fill('#tc-line', 'NIFTY CE buy 120');
  await expect(card.locator('[data-desk-preview] [data-field="strike"]')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await page.fill('#tc-line', 'NIFTY 24300 CE buy 120, SL 90, target 170, 1 lot');
  await expect(card.locator('[data-desk-preview]')).toContainText('NIFTY 24300 CE · buy · 120 · SL 90 · target 170 · 1 lot');
  await expect(card.locator('[data-desk-preview] [data-chip="block"]')).toHaveText(/Breaks your rule: "No option buys"/);
  await card.getByRole('button', { name: 'Add', exact: true }).click();
  const line = card.locator('.tc-lines > li').first();
  await expect(line.locator('[data-chip="block"]')).toHaveText(/Breaks your rule: "No option buys"/);
  await line.getByRole('button', { name: 'Keep anyway' }).click();
  await expect(line.getByRole('button', { name: 'Keep', exact: true })).toBeDisabled();
  await line.getByLabel('Why keep it').fill('Hedge for my futures position');
  await line.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(line.locator('.tc-badge')).toHaveText('Kept: Hedge for my futures position');

  await page.fill('#tc-line', 'RELIANCE buy 2500 SL 2450 qty 10');
  await card.getByRole('button', { name: 'Add', exact: true }).click();
  const second = card.locator('.tc-lines > li').nth(1);
  await expect(second).toContainText('RELIANCE · buy · 2500 · SL 2450 · qty 10');
  await second.getByRole('button', { name: 'Remove' }).click();
  await expect(second.locator('.tc-badge')).toHaveText('Removed');
  await expect(card.locator('.tc-count')).toHaveText('1 line planned');

  await card.locator('.tc-tick input').first().check();
  await page.reload();
  await expect(page.locator('[data-desk-plan] .tc-tick input').first()).toBeChecked();
  await expect(page.locator('[data-desk-plan] .tc-lines > li').first().locator('.tc-badge')).toHaveText('Kept: Hedge for my futures position');
});

test('actuals: taken with a result, not taken, a trade not in the plan, plan vs actual', async ({ page }) => {
  test.setTimeout(240_000);
  const email = `desk-pva-${Date.now()}@e2e.local`;
  await signIn(page, email, '/upload');
  givePlan(email);
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
  const card = page.locator('[data-desk-plan]');
  await expect.poll(async () => { await page.goto('/desk'); return card.count(); }, { timeout: 60_000 }).toBe(1);
  for (const t of ['NIFTY FUT buy 25000 SL 24950 1 lot', 'RELIANCE buy 2500 SL 2450 qty 10']) {
    await page.fill('#tc-line', t);
    await card.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(card.locator('.tc-lines > li')).toHaveCount(t.startsWith('NIFTY') ? 1 : 2);
  }
  const first = card.locator('.tc-lines > li').nth(0), second = card.locator('.tc-lines > li').nth(1);
  await first.getByRole('button', { name: 'Taken', exact: true }).click();
  await first.getByLabel('Result (₹)').fill('-3250');
  await first.getByRole('button', { name: 'Save' }).click();
  await expect(first.locator('[data-outcome="taken"]')).toContainText('Taken · −₹3,250');
  await second.getByRole('button', { name: 'Not taken' }).click();
  await expect(second.locator('[data-outcome="not_taken"]')).toContainText('Not taken');
  const j = page.locator('[data-desk-journal]');
  await j.getByLabel('Trade not in the plan').fill('BANKNIFTY 52000 PE buy 300 1 lot');
  await j.getByLabel('Result (₹)').fill('900');
  await j.getByRole('button', { name: 'Log' }).click();
  await expect(j.locator('li')).toContainText('BANKNIFTY 52000 PE buy 300 1 lot');
  const pva = page.locator('[data-desk-pva]');
  await expect(pva.locator('.pva-tiles')).toContainText('Planned2');
  await expect(pva.locator('.pva-tiles > div').nth(1)).toContainText('1 not taken');
  await expect(pva.locator('.pva-tiles > div').nth(2)).toContainText('1');
  await expect(pva.locator('.pva-tiles > div').nth(3).locator('b')).toHaveText('−₹3,250');
  await expect(pva.locator('.pva-tiles > div').nth(4).locator('b')).toHaveText('+₹900');
  await expect(pva.locator('.pva-tiles > div').nth(5).locator('b')).toHaveText('1/1');
});

test('report Progress tab: the Desk\'s plan vs actual for the statement\'s period', async ({ page }) => {
  test.setTimeout(240_000);
  const email = `desk-prog-${Date.now()}@e2e.local`;
  await signIn(page, email, '/upload');
  givePlan(email);
  sql(`insert into plan_day_scores (user_id, plan_date, planned, taken, not_taken, unmarked, off_plan, on_plan_pnl, off_plan_pnl, rules_kept, rules_total, source)
       select id, d::date, 2, 2, 0, 0, case when d = '2025-02-04' then 1 else 0 end, 1500, case when d = '2025-02-04' then -700 else 0 end, 1, 2, 'journal'
         from users, unnest(array['2025-02-03', '2025-02-04']) d where email = '${email}'`);
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
  await page.locator('#reportRoot .tabs').getByRole('tab', { name: 'Progress' }).click();
  const p = page.locator('[data-plan-actual]');
  await expect(p).toContainText('2 days planned on the Desk, 6 Jan – 26 Mar');
  await expect(p.locator('.pva-r-tiles')).toContainText('Lines planned4');
  await expect(p.locator('.pva-r-tiles')).toContainText('Rules kept2/4');
  await expect(p.locator('tbody tr')).toHaveCount(2);
});
