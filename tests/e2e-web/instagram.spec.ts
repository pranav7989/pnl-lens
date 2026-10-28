/**
 * @file  tests/e2e-web/instagram.spec.ts
 * @area  Tests
 * @what  REQ-6 Instagram section: scroll-linked row (card 1 → 4), manual takeover, reduced motion, video play rules, exact copy, no Meta requests, no layout shift.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const META = /instagram\.com|cdninstagram|fbcdn|facebook\.(com|net)/;
const rail = (page: Page) => page.evaluate(() => { const r = document.querySelector('[data-ig-rail]') as HTMLElement; return { left: Math.round(r.scrollLeft), max: r.scrollWidth - r.clientWidth }; });

/** Scrolls the page through the Instagram section in small steps and records the row position at each step. */
async function sweep(page: Page) {
  const top = await page.evaluate(() => (document.querySelector('#instagram') as HTMLElement).getBoundingClientRect().top + scrollY);
  const vh = page.viewportSize()!.height, out: number[] = [];
  for (let y = top - vh; y <= top + 1.2 * vh; y += vh / 10) {
    await page.evaluate((y) => scrollTo(0, y), y);
    await page.waitForTimeout(80);
    out.push((await rail(page)).left);
  }
  return out;
}

for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`${vp.width}px: scrolling through the section moves the row from card 1 to card 4, and back`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/?region=in');
    const { max } = await rail(page);
    expect(max).toBeGreaterThan(40);
    const pos = await sweep(page);
    expect(pos[0]).toBe(0);
    expect(Math.max(...pos)).toBeGreaterThanOrEqual(max - 2);
    for (let i = 1; i < pos.length; i++) expect(pos[i], `step ${i}`).toBeGreaterThanOrEqual(pos[i - 1]);
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(async () => (await rail(page)).left).toBe(0);   // the next animation frame moves it back (slow on CI WebKit)
  });

  test(`${vp.width}px: after a manual swipe the row stops following the page`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/?region=in');
    const top = await page.evaluate(() => (document.querySelector('#instagram') as HTMLElement).getBoundingClientRect().top + scrollY);
    await page.evaluate((y) => scrollTo(0, y - innerHeight * 0.6), top); await page.waitForTimeout(150);
    await page.locator('[data-ig-rail]').hover();
    await page.mouse.wheel(260, 0);                                   // a sideways swipe on the row
    await page.waitForTimeout(700);
    const held = (await rail(page)).left;
    await page.evaluate((y) => scrollTo(0, y + innerHeight * 0.3), top); await page.waitForTimeout(400);
    expect((await rail(page)).left).toBe(held);
    await expect(page.locator('[data-ig-rail]')).toHaveClass(/manual/);  // card-by-card snapping from now on
  });
}

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('no automatic movement; the row stays manual', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?region=in');
    expect(Math.max(...(await sweep(page)))).toBe(0);
    await page.locator('[data-ig-rail]').focus();
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
    expect((await rail(page)).left).toBeGreaterThan(100);               // arrow keys move it by a card
  });
});

for (const region of ['in', 'global'] as const) {
  test(`${region} site: exact copy, safe links, no Meta requests, no layout shift`, async ({ page }) => {
    const meta: string[] = [];
    page.on('request', (r) => { if (META.test(new URL(r.url()).host)) meta.push(r.url()); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?region=${region}`);
    await page.evaluate(() => (window as any).__cls = 0);
    await page.evaluate(() => new PerformanceObserver((l) => { for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) (window as any).__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }));
    await sweep(page);
    const s = page.locator('#instagram');
    await expect(s.locator('h2')).toHaveText('Your habits, one reel at a time');
    await expect(s.locator('.lp-sub')).toHaveText('Short lessons on the traps that quietly shape a P&L. Watch here, then follow us for more.');
    await expect(s.locator('.ig-view')).toHaveText(['View on Instagram ↗', 'View on Instagram ↗', 'View on Instagram ↗']);
    await expect(s.locator('.ig-chip')).toHaveText(['Post', 'Reel', 'Reel']);
    await expect(s.locator('.ig-handle')).toHaveText('@pnllens');
    await expect(s.locator('.ig-follow p')).toHaveText('Short reels on the habits behind your P&L. Revenge trading, overtrading, loss aversion and more.');
    await expect(s.locator('.ig-follow-btn')).toHaveText('Follow on Instagram');
    await expect(s.locator('.ig-also')).toHaveText('Also on X: @pnllens');
    await expect(s.locator('.lp-foot-note')).toHaveText('Educational content. Not investment advice.');
    const hrefs = await s.locator('a.ig-card').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual(['https://www.instagram.com/p/DeTKGapE_lI/', 'https://www.instagram.com/reel/DegsPt0y0IL/', 'https://www.instagram.com/reel/Dej-LaXS87T/']);
    for (const a of await s.locator('a').all()) { await expect(a).toHaveAttribute('target', '_blank'); await expect(a).toHaveAttribute('rel', 'noopener noreferrer'); }
    await expect(s.locator('iframe')).toHaveCount(0);
    expect(meta, 'Instagram/Meta requests').toEqual([]);
    expect(await page.evaluate(() => (window as any).__cls)).toBeLessThan(0.1);
  });
}

/* Video rules, on the real landing.js with a minimal page (Playwright's Chromium has no H.264, so play/pause are recorded). */
const js = fs.readFileSync(path.resolve(__dirname, '../../apps/web/public/landing.js'), 'utf8');
const harness = `<!doctype html><html><body style="margin:0"><div class="lp" data-region="IN">
  <section class="lp-hero" style="height:900px"></section>
  <section data-ig style="margin-top:600px"><div data-ig-rail style="display:flex;overflow-x:auto;width:360px;gap:20px">
    <div class="ig-item" style="flex:0 0 300px"><a data-ig-card="2" href="#"><video data-ig-video="2" muted style="display:block;width:300px;height:533px"></video></a></div>
    <div class="ig-item" style="flex:0 0 300px"><a data-ig-card="3" href="#"><video data-ig-video="3" muted style="display:block;width:300px;height:533px"></video></a></div>
  </div></section><div style="height:3000px"></div></div>
  <script>window.__media=[];HTMLMediaElement.prototype.play=function(){__media.push('play'+this.dataset.igVideo);return Promise.resolve()};HTMLMediaElement.prototype.pause=function(){__media.push('pause'+this.dataset.igVideo)};
  window.__events=[];window.fetch=function(u,o){__events.push(JSON.parse(o.body).name);return Promise.resolve(new Response(null,{status:204}))};</script>
  <script>${js}</script></body></html>`;

test('videos play only when 60% visible, pause when not, and report one play', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(harness);
  expect((await page.evaluate(() => (window as any).__media as string[])).filter((m) => m.startsWith('play'))).toEqual([]);   // off-screen: nothing plays
  await page.evaluate(() => scrollTo(0, 1300)); await page.waitForTimeout(300);   // section in view (top 1500); the row has followed the scroll
  const visible = await page.evaluate(() => [...document.querySelectorAll('[data-ig-video]')].filter((v) => { const r = v.getBoundingClientRect(), rr = v.closest('[data-ig-rail]')!.getBoundingClientRect(); return Math.min(r.right, rr.right) - Math.max(r.left, rr.left) >= 0.6 * r.width; }).map((v) => (v as HTMLElement).dataset.igVideo));
  expect(visible.length).toBeGreaterThan(0);
  const log = await page.evaluate(() => (window as any).__media as string[]);
  for (const n of visible) expect(log, `card ${n} visible → plays`).toContain('play' + n);
  for (const n of ['2', '3'].filter((n) => !visible.includes(n))) expect(log.filter((m) => m === 'play' + n), `card ${n} hidden → never plays`).toEqual([]);
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__media.at(-1))).toMatch(/^pause/);
  expect((await page.evaluate(() => (window as any).__events)).filter((e: string) => e === 'ig_card_play')).toHaveLength(1);
});

test.describe('videos with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('never autoplay', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(harness);
    await page.evaluate(() => scrollTo(0, 1300)); await page.waitForTimeout(300);
    expect((await page.evaluate(() => (window as any).__media)).filter((m: string) => m.startsWith('play'))).toEqual([]);
  });
});
