/**
 * @file  tests/e2e-web/landing.spec.ts
 * @area  Tests
 * @what  REQ-4: on a 390x844 phone pricing starts within 4 screen-heights; See plans / nav / pill reach it; mobile card order; no section lost; landing events stored.
 */
import { test, expect, type Page } from '@playwright/test';
import { sql } from './helpers';

const PHONE = { width: 390, height: 844 };
const HEADINGS = ['Three steps. Two minutes.', 'Five views of your trading', 'Patterns worth a closer look', 'Simple, transparent plans', 'Private and principled',
  'Works with the files you already have', 'Built for every kind of trader', 'Questions, answered', 'Clarity starts with your own trades.'];
const inView = (page: Page, sel: string) => page.evaluate((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }, sel);

for (const [region, from] of [['in', '₹99'], ['global', '$9']] as const) {
  test.describe(`${region} site`, () => {
    test.use({ viewport: PHONE });

    test('pricing starts within 4 screen-heights, with every section still there', async ({ page }) => {
      await page.goto(`/?region=${region}`);
      const top = await page.evaluate(() => Math.round(document.querySelector('#pricing')!.getBoundingClientRect().top + scrollY));
      test.info().annotations.push({ type: 'pricing top', description: `${top}px = ${(top / PHONE.height).toFixed(2)} screen-heights (before REQ-4: 8772px = 10.39)` });
      expect(top).toBeLessThanOrEqual(4 * PHONE.height);
      const h2 = await page.locator('main h2').allTextContents();
      for (const h of HEADINGS) expect(h2, h).toContain(h);
      // order: steps, sample, benefits (max 4), pricing, then privacy and brokers
      const order = await page.evaluate(() => ['#how', '#report', '#patterns', '#pricing', '#privacy', '#brokers', '#faq'].map((s) => document.querySelector(s)!.getBoundingClientRect().top));
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      await expect(page.locator('#patterns .lp-card')).toHaveCount(4);
      await expect(page.locator('#brokers img')).toHaveCount(0);
      await expect(page.locator('.lp-reality')).toBeVisible();
      await expect(page.locator('.lp-legal')).toContainText('[Company legal name]');
    });

    test('phone pricing shows Progress first, then Snapshot, Single, Discipline, each with its button', async ({ page }) => {
      await page.goto(`/?region=${region}`);
      const cards = await page.locator('.lp-plan').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-plan'), top: e.getBoundingClientRect().top, btn: !!e.querySelector('a.lp-btn') })));
      expect([...cards].sort((a, b) => a.top - b.top).map((c) => c.id)).toEqual(['progress', 'snapshot', 'single', 'discipline']);
      expect(cards.every((c) => c.btn)).toBe(true);
    });

    test(`hero "See plans · from ${from}", the menu's Pricing link and the pill all reach pricing`, async ({ page }) => {
      await page.goto(`/?region=${region}`);
      const see = page.locator('[data-see-plans]');
      await expect(see).toHaveText(`See plans · from ${from}`);
      await see.click();
      await expect.poll(() => inView(page, '#pricing')).toBe(true);

      await page.evaluate(() => scrollTo(0, 0));
      await page.locator('[data-burger]').click();
      await page.locator('#lp-menu').getByRole('link', { name: 'Pricing' }).click();
      await expect.poll(() => inView(page, '#pricing')).toBe(true);

      await page.evaluate(() => scrollTo(0, 0));
      await expect(page.locator('[data-pill]')).toBeHidden();
      await page.evaluate(() => scrollTo(0, (document.querySelector('#how') as HTMLElement).offsetTop));
      await expect(page.locator('[data-pill]')).toBeVisible();
      await page.locator('[data-pill]').click();
      await expect.poll(() => inView(page, '#pricing')).toBe(true);
      await expect(page.locator('[data-pill]')).toBeHidden();
    });
  });
}

test('landing events reach the admin numbers (pricing seen, scroll depth)', async ({ page }) => {
  // visitors are stored without a user (API test); in the dev stack everyone is the dev user, so count all rows
  const count = (name: string) => Number(sql(`select count(*) from events where name = '${name}'`));
  const before = { p: count('pricing_viewed'), d: count('landing_scroll_depth') };
  await page.setViewportSize(PHONE);
  await page.goto('/?region=in');
  const seen = page.waitForRequest((r) => r.url().endsWith('/api/v1/events') && (r.postData() || '').includes('pricing_viewed'));
  await page.locator('[data-see-plans]').click();
  await seen;                                                   // pricing was on screen long enough to count
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => count('pricing_viewed')).toBeGreaterThan(before.p);
  await expect.poll(() => count('landing_scroll_depth')).toBeGreaterThanOrEqual(before.d + 4);
});
