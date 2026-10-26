/**
 * @file  tests/e2e-web/score-card.spec.ts
 * @area  Tests
 * @what  REQ-1: the Progress score card's level labels never overlap, at every level and width, in Chromium (Chrome/Edge) and WebKit (Safari).
 */
// Renders the real ladder markup (render.js ladderHtml) with the real report.css and the Manrope font; needs no stack.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ladderHtml, LEVEL_RANGES } from '../../apps/web/lib/report-ui/render.js';

const ROOT = path.resolve(__dirname, '../..');
const css = fs.readFileSync(path.join(ROOT, 'apps/web/app/report.css'), 'utf8');
const vars = fs.readFileSync(path.join(ROOT, 'apps/web/app/globals.css'), 'utf8').match(/:root\{[\s\S]*?\}/)![0];
const font = fs.readFileSync(path.join(ROOT, 'apps/web/app/fonts/manrope.woff2')).toString('base64');
const WIDTHS = [320, 360, 390, 414, 768, 1024, 1280, 1440];
// [level index, score shown]: every level, plus the extremes 0 and 100
const CASES: [number, number][] = [[0, 0], [0, 25], [1, 51], [2, 60], [3, 77], [4, 90], [4, 100]];

function page_(index: number, score: number) {
  const [name] = LEVEL_RANGES[index];
  const next = LEVEL_RANGES[index + 1];
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    @font-face { font-family: Manrope; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 200 800; }
    ${vars} body { margin: 0; padding: 16px; background: var(--bg); color: var(--ink); font-family: Manrope, sans-serif; } ${css}</style></head><body>
    <div class="rv-grid"><div class="rv-panel s12 pg-hero" id="card">
      <div class="pg-hero-ring"><div style="width:180px;height:180px;border-radius:50%;border:12px solid #333">${score}</div></div>
      <div class="pg-hero-mid"><span class="pg-kicker">Level</span><b class="pg-level">${name}</b>${ladderHtml(index)}
        <p class="pg-next">${next ? `<b>${next[1] - score}</b> points to <b>${next[0]}</b>` : 'Top level reached. Keep it steady.'}</p></div>
      <div class="pg-hero-note"><span class="pg-kicker">Summary</span><p>Your habits this month at a glance.</p></div></div></div></body></html>`;
}

test('level ranges match the engine thresholds', () => {
  const src = fs.readFileSync(path.join(ROOT, 'packages/engine/src/engine.js'), 'utf8');
  const engine = [...src.match(/const LEVELS = \[(.*?)\];/)![1].matchAll(/\[(\d+), '(\w+)'\]/g)].map((m) => [m[2], Number(m[1])]);
  expect(LEVEL_RANGES.map(([n, a]) => [n, a])).toEqual(engine);
  LEVEL_RANGES.forEach(([, , hi], i) => expect(hi).toBe(i < 4 ? LEVEL_RANGES[i + 1][1] - 1 : 100));
});

for (const width of WIDTHS) {
  test(`no overlapping level labels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const [index, score] of CASES) {
      await page.setContent(page_(index, score));
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => {
        const card = document.querySelector('#card')!.getBoundingClientRect();
        const labels = [...document.querySelectorAll('.pg-lad-lab span')].map((el) => {
          const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
          return { text: el.textContent, on: el.classList.contains('on'), visible: cs.visibility === 'visible', left: b.left, right: b.right, top: b.top, bottom: b.bottom,
            size: parseFloat(cs.fontSize), color: cs.color, weight: Number(cs.fontWeight), cut: (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1 && cs.textOverflow === 'ellipsis' };
        });
        return { card: { left: card.left, right: card.right }, ladder: document.querySelector('.pg-ladder')!.getBoundingClientRect().width, labels };
      });
      const shown = r.labels.filter((l) => l.visible);
      const tag = `${width}px, level ${index}, score ${score}`;
      expect(shown.some((l) => l.on), `${tag}: current level label shown`).toBe(true);
      for (let i = 0; i < shown.length; i++) {
        const a = shown[i];
        expect(a.size, `${tag}: ${a.text} font size`).toBeGreaterThanOrEqual(11);
        expect(a.cut, `${tag}: ${a.text} not cut with an ellipsis`).toBe(false);
        expect(a.left, `${tag}: ${a.text} inside the card (left)`).toBeGreaterThanOrEqual(r.card.left);
        expect(a.right, `${tag}: ${a.text} inside the card (right)`).toBeLessThanOrEqual(r.card.right);
        for (const b of shown.slice(i + 1)) {
          const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
          expect(overlap, `${tag}: "${a.text}" overlaps "${b.text}"`).toBe(false);
        }
      }
      const cur = shown.find((l) => l.on)!;
      expect(cur.color, `${tag}: current level is yellow`).toBe('rgb(255, 214, 10)');
      expect(cur.weight, `${tag}: current level is bold`).toBeGreaterThanOrEqual(700);
      // all five names when they fit (ladder ≥ 344px), otherwise only the current level's
      expect(shown.length, `${tag}: labels shown on a ${Math.round(r.ladder)}px ladder`).toBe(r.ladder >= 344 ? 5 : 1);
    }
  });
}

test('a segment shows its name and range on hover or tap', async ({ page }) => {
  await page.setContent(page_(1, 51));
  const seg = page.locator('.pg-lad-bar i').nth(2);
  await expect(seg).toHaveAttribute('aria-label', 'Steady: 55–69');
  await seg.focus();
  const tip = await seg.evaluate((el) => getComputedStyle(el, '::after').content);
  expect(tip).toBe('"Steady: 55–69"');
});
