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

/* ---------------- REQ-5: X and Instagram icons ---------------- */
const SOCIAL = [['instagram', 'https://www.instagram.com/pnllens/', 'PnL Lens on Instagram'], ['x', 'https://x.com/pnllens', 'PnL Lens on X']] as const;

for (const region of ['in', 'global'] as const) {
  test(`${region} site: social icons in the header and footer, safe links, no overlap 320–1440`, async ({ page }) => {
    for (const width of [320, 360, 390, 414, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/?region=${region}`);
      const head = width <= 1080 ? '.lp-nav .lp-social-m' : '.lp-nav-cta .lp-social';
      for (const where of [head, '.lp-foot-social']) {
        for (const [net, href, label] of SOCIAL) {
          const a = page.locator(`${where} a[data-social="${net}"]`);
          await expect(a, `${width}px ${where} ${net}`).toBeVisible();
          await expect(a).toHaveAttribute('href', href);
          await expect(a).toHaveAttribute('target', '_blank');
          await expect(a).toHaveAttribute('rel', 'noopener noreferrer');
          await expect(a).toHaveAttribute('aria-label', label);
        }
      }
      // header items never overlap: brand, links/buttons, icons and the burger
      const boxes = await page.evaluate(() => [...document.querySelectorAll('.lp-nav > *')].filter((e) => getComputedStyle(e).display !== 'none')
        .flatMap((e) => (e.classList.contains('lp-nav-cta') ? [...e.children] : [e]))
        .map((e) => { const b = e.getBoundingClientRect(); return { n: e.className || e.tagName, l: b.left, r: b.right, t: b.top, b: b.bottom }; })
        .filter((b) => b.r > b.l));
      for (let i = 0; i < boxes.length; i++) for (const o of boxes.slice(i + 1)) {
        const hit = Math.min(boxes[i].r, o.r) - Math.max(boxes[i].l, o.l) > 0.5 && Math.min(boxes[i].b, o.b) - Math.max(boxes[i].t, o.t) > 0.5;
        expect(hit, `${width}px: ${boxes[i].n} overlaps ${o.n}`).toBe(false);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px no sideways scroll`).toBe(true);
    }
  });
}

test('social icons: keyboard focus is visible, structured data lists the profiles, clicks are recorded', async ({ page, context }) => {
  await page.goto('/?region=in');
  const ig = page.locator('.lp-nav-cta a[data-social="instagram"]');
  await ig.focus();
  expect(await ig.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe('none');
  await expect.poll(() => ig.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 214, 10)');   // after the 150ms transition
  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').first().textContent() || '{}');
  expect(ld).toMatchObject({ '@type': 'Organization', name: 'PnL Lens', sameAs: ['https://www.instagram.com/pnllens/', 'https://x.com/pnllens'] });
  const before = Number(sql(`select count(*) from events where name = 'social_click' and props->>'placement' = 'footer'`));
  await context.route(/instagram\.com|x\.com/, (r) => r.abort());   // don't leave the test site
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/v1/events') && (r.postData() || '').includes('social_click'));
  await page.locator('.lp-foot').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-pill]')).toBeHidden();   // the See plans pill never covers the footer
  await page.locator('.lp-foot-social a[data-social="x"]').click();
  await sent;
  await expect.poll(() => Number(sql(`select count(*) from events where name = 'social_click' and props->>'placement' = 'footer'`))).toBe(before + 1);
});
