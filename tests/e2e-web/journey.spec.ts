/**
 * @file  tests/e2e-web/journey.spec.ts
 * @area  Tests
 * @what  REQ-2 journey bar and "What's next" card end to end: Single 2/5 with locks, later month completes step 3, locked step opens pricing, phone view, events in admin.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { signIn, givePlan, sql, FIX } from './helpers';

async function analyse(page: Page, file: string) {
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, file));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\/[0-9a-f-]{36}$/, { timeout: 90_000 });
}
const events = (email: string, name: string) => Number(sql(`select count(*) from events e join users u on u.id = e.user_id where u.email = '${email}' and e.name = '${name}'`));

test('Single plan with one report: 2 of 5, locked steps name their plan and open pricing; card, phone view, admin numbers', async ({ page }) => {
  const email = `journey-single-${Date.now()}@test.local`;
  await signIn(page, email, '/dashboard');
  givePlan(email, 'single', 1, 2);
  await analyse(page, 'zerodha_tradebook.csv');

  const bar = page.locator('[data-journey]');
  await expect(bar.locator('.jb-count')).toHaveText('2 of 5 steps');
  await expect(bar.locator('li.done')).toHaveCount(2);
  await expect(bar.locator('li.locked')).toHaveCount(3);
  await expect(bar.locator('li.locked')).toHaveText([/Month-2 check-up\s*Snapshot/, /3-month trend\s*Progress/, /12-month discipline\s*Discipline/]);
  await expect(bar.locator('.jb-score')).toContainText(/(Building|Developing|Steady|Disciplined|Elite) · \d+\/100/);
  await expect(bar.locator('.jb-cta')).toHaveText('Upgrade to Snapshot →');

  // "What's next" at the end of Overview and Progress, with the blurred preview for Single
  const card = page.locator('#overview [data-whats-next]');
  await expect(card).toContainText('See if your score improves next month');
  await expect(card).toContainText('Unlock month-by-month progress with Snapshot');
  await page.locator('#reportRoot .tabs').getByRole('tab', { name: 'Progress' }).click();
  await expect(page.locator('#progress [data-whats-next]')).toContainText('Upgrade to Snapshot');

  // a locked step opens pricing with that plan highlighted
  await bar.locator('li.locked a').first().click();
  await page.waitForURL(/\/pricing\?plan=snapshot&from=journey/);
  await expect(page.locator('#plan-snapshot')).toHaveClass(/plan-pick/);
  await expect(page.locator('#plan-snapshot')).toBeInViewport();
  await expect.poll(() => events(email, 'journey_step_click')).toBe(1);
  await expect.poll(() => events(email, 'journey_bar_view')).toBeGreaterThanOrEqual(1);

  // "Hide" is remembered on this device
  await page.goto('/dashboard');
  await bar.locator('.jb-hide').click();
  await page.reload();
  await expect(bar.locator('.jb-line')).toBeVisible();
  await expect(bar.locator('.jb-full')).toBeHidden();
  await bar.locator('.jb-line').click();
  await expect(bar.locator('.jb-full')).toBeVisible();

  // phones: one line, no overlap or sideways scroll, tap to expand
  for (const width of [320, 360, 390, 414]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/dashboard');
    const line = bar.locator('.jb-line');
    await expect(line).toBeVisible();
    await expect(bar.locator('.jb-full')).toBeHidden();
    await expect(line).toContainText(/^Journey 2\/5 · \w+ \d+ · Next: Month-2 check-up/);
    const fit = await page.evaluate(() => {
      const l = document.querySelector('.jb-line')!.getBoundingClientRect(), t = document.querySelector('.jb-line span')!.getBoundingClientRect(), i = document.querySelector('.jb-line i')!.getBoundingClientRect();
      return { page: document.documentElement.scrollWidth <= innerWidth, inside: l.left >= 0 && l.right <= innerWidth, apart: t.right <= i.left + 0.5 };
    });
    expect(fit, `${width}px`).toEqual({ page: true, inside: true, apart: true });
    await line.click();
    await expect(bar.locator('.jb-full')).toBeVisible();
  }

  // the admin console's Product tab shows the journey numbers
  sql(`update users set role = 'owner' where email = '${email}'`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Product' }).click();
  await expect(page.getByText('Single → higher plan')).toBeVisible();
  await expect(page.getByText('Locked step tapped (journey_step_click)')).toBeVisible();
});

test('Snapshot: a report for a later month completes the Month-2 check-up; next action is the check-up date', async ({ page }) => {
  const email = `journey-snap-${Date.now()}@test.local`;
  await signIn(page, email, '/dashboard');
  givePlan(email, 'snapshot', 5, 3);
  await analyse(page, 'dhan_tradebook.csv');            // trades up to Jan 2025
  const bar = page.locator('[data-journey]');
  await expect(bar.locator('.jb-count')).toHaveText('2 of 5 steps');
  await expect(bar.locator('li').nth(2)).toHaveClass('open');
  await expect(bar.locator('.jb-next')).toContainText(/^Your next check-up: \d{2}-[A-Z]{3}-\d{2}$/);
  await expect(bar.locator('.jb-cta')).toHaveText('Upload next month’s statement →');
  await analyse(page, 'zerodha_tradebook.csv');         // trades up to Mar 2025: a later month
  await expect(bar.locator('.jb-count')).toHaveText('3 of 5 steps');
  await expect(bar.locator('li').nth(2)).toHaveClass('done');
  await expect(bar.locator('li.locked')).toHaveCount(2);
});
