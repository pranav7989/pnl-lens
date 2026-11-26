/**
 * @file  tests/e2e-web/motion.spec.ts
 * @area  Tests
 * @what  Motion system (19 Oct 2026): reduced motion = no animation and everything visible; reveal-on-scroll ends visible; sliding tab ink follows the selected tab; sign-in steps work with View Transitions.
 */
import { test, expect } from '@playwright/test';
import { signIn, sql } from './helpers';

test('reduced motion: no transitions or animations on the landing page, and every revealed block is visible', async ({ browser }) => {
  const page = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
  await page.goto('/?region=in');
  const moving = await page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.lp-h1 span, .lp-scan, .lp-card, .lp-plan, .dx, .mo-page, [data-reveal]')];
    return els.filter((el) => { const cs = getComputedStyle(el); return cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0.01; }).length;
  });
  expect(moving).toBe(0);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const hidden = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => getComputedStyle(el).opacity !== '1').length);
  expect(hidden).toBe(0);
});

test('motion on: blocks revealed on scroll end fully visible; the ledger card is not left tilted', async ({ page }) => {
  await page.goto('/?region=in');
  for (const id of ['how', 'patterns', 'pricing', 'privacy', 'faq']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    const block = page.locator(`#${id} [data-reveal]`).first();
    if (await block.count()) await expect.poll(() => block.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5000 }).toBe('1');
  }
  const t = await page.locator('.lp-scan').evaluate((el) => getComputedStyle(el).transform);
  expect(t === 'none' || /matrix(3d)?\(1, 0, 0, 1|matrix3d\(1, 0, 0, 0, 0, 1/.test(t)).toBe(true);
});

test('sliding tab ink sits under the selected admin tab and moves with it', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Secure cookie over plain http');
  const email = `motion-owner-${Date.now()}@e2e.local`;
  await signIn(page, email);
  sql(`update users set role = 'owner' where email = '${email}'`);
  await page.goto('/admin');
  const ink = page.locator('.tabs .mo-ink');
  await expect(ink).toHaveCount(1);
  const under = async (name: string) => {
    const tab = page.getByRole('tab', { name, exact: true });
    await tab.click();
    await expect.poll(async () => {
      const [tb, ib] = await Promise.all([tab.boundingBox(), ink.boundingBox()]);
      return !!tb && !!ib && ib.x >= tb.x - 1 && ib.x + ib.width <= tb.x + tb.width + 1 && Math.abs(ib.y - (tb.y + tb.height)) < 6;
    }, { timeout: 3000 }).toBe(true);
  };
  await under('Product');
  await under('Blog');
  await under('Users');
});

test('sign-in steps still work with View Transitions (email → code step and back)', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(`motion-${Date.now()}@e2e.local`);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.locator('[data-step]')).toHaveAttribute('data-step', 'code');
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByRole('button', { name: 'Use a different email' }).click();
  await expect(page.locator('[data-step]')).toHaveAttribute('data-step', 'email');
  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
});
