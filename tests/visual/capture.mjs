#!/usr/bin/env node
/**
 * @file  tests/visual/capture.mjs
 * @area  Tests
 * @what  Screenshots of every page at 1440 and 390 px (before/after comparisons for "keep the UI exactly", rule 8).
 */
/**
 * Usage: node tests/visual/capture.mjs <outDir> [baseUrl=http://localhost:8080] [--report=<id>] [--upload]
 *   --upload  creates a report through the site's upload screen first (uses one credit of the dev user)
 * Dynamic text (dates, ids, countdowns) is masked so two runs can be compared pixel by pixel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const [outDir, base = 'http://localhost:8080'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (k) => process.argv.find((a) => a.startsWith(`--${k}`));
if (!outDir) { console.error('usage: capture.mjs <outDir> [baseUrl]'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const FIX = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../packages/engine/test/fixtures');

const browser = await chromium.launch();
let reportId = flag('report')?.split('=')[1];
if (flag('upload')) {
  const page = await browser.newPage();
  await page.goto(`${base}/upload`);
  await page.setInputFiles('input[type=file]', path.join(FIX, 'zerodha_tradebook.csv'));
  const consent = page.locator('input[name=consent]');
  if (await consent.count()) await consent.check();
  await page.getByRole('button', { name: /^analyse$/i }).click();
  // current site: preview, then "Open full report"; the workspace (Phase 6) saves and opens the report itself
  const open = page.getByRole('button', { name: /open full report/i });
  await Promise.race([open.waitFor({ timeout: 60_000 }).then(() => open.click()), page.waitForURL(/\/report\//, { timeout: 60_000 })]);
  await page.waitForURL(/\/report\/[0-9a-f-]{36}/, { timeout: 60_000 });
  reportId = page.url().match(/report\/([0-9a-f-]{36})/)[1];
  await page.close();
}

const pages = [['home-in', '/?region=in'], ['home-global', '/?region=global'], ['pricing', '/pricing'], ['login', '/login'],
  ['dashboard', '/dashboard'], ['upload', '/upload'], ['admin', '/admin'], ...(reportId ? [['report', `/report/${reportId}`]] : [])];
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  for (const [name, url] of pages) {
    await page.goto(base + url, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, `${name}-${w}.png`), fullPage: true,
      mask: [page.locator('time, .expiry, .muted:has-text("created"), [data-dynamic]')] });
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({ outDir, reportId, shots: pages.length * 2 }));
