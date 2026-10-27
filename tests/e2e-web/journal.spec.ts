/**
 * @file  tests/e2e-web/journal.spec.ts
 * @area  Tests
 * @what  Trade journal: add a setup, tags, emotion and note to trades, see "what your journal shows" by setup/tag/emotion, the note follows the trade into another report of the same statement, remove a note.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { signIn, givePlan, FIX } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

const email = `journal-${Date.now()}@e2e.local`;
const upload = async (page: any) => {
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
};

test('journal: write notes on the three biggest trades; groups show; the notes follow the trades into another report', async ({ page }) => {
  await signIn(page, email, '/upload');
  givePlan(email);
  await upload(page);
  await page.locator('#reportRoot .tabs').getByRole('tab', { name: 'Journal' }).click();
  const jr = page.locator('[data-journal]');
  await expect(jr.locator('[data-journaled]')).toHaveText('0 of 96');

  const write = async (i: number, setup: string, tag: string, mood: string) => {
    const row = jr.locator('.jr-list > li').nth(i);
    await row.getByRole('button', { name: 'Add note' }).click();
    const ed = row.locator('[data-journal-editor]');
    await ed.getByRole('combobox', { name: 'Setup' }).fill(setup);   // a text field with suggestions
    await ed.getByRole('textbox', { name: 'Add a tag' }).fill(tag);
    await ed.getByRole('textbox', { name: 'Add a tag' }).press('Enter');
    await ed.getByRole('button', { name: mood, exact: true }).click();
    await ed.getByRole('textbox', { name: 'Note' }).fill(`note ${i}`);
    await ed.getByRole('button', { name: 'Save' }).click();
    await expect(row.locator('[data-journal-editor]')).toHaveCount(0);
    await expect(row.locator('.jr-pill.setup')).toHaveText(setup);
  };
  await write(0, 'Breakout', 'plan', 'Calm');
  await write(1, 'Breakout', 'plan', 'Calm');
  await write(2, 'Chase', 'late', 'FOMO');
  await expect(jr.locator('[data-journaled]')).toHaveText('3 of 96');
  await expect(jr.locator('[data-journal-stats]')).toContainText('By setup');
  await expect(jr.locator('[data-journal-stats]')).toContainText('Breakout');
  await expect(jr.locator('[data-journal-highlights]')).toBeVisible();

  // the same statement in a new report: the notes are already there
  await upload(page);
  await page.locator('#reportRoot .tabs').getByRole('tab', { name: 'Journal' }).click();
  await expect(page.locator('[data-journal] [data-journaled]')).toHaveText('3 of 96');

  // remove one
  const first = page.locator('[data-journal] .jr-list > li').first();
  await first.getByRole('button', { name: 'Edit' }).click();
  await first.getByRole('button', { name: 'Remove note' }).click();
  await expect(page.locator('[data-journal] [data-journaled]')).toHaveText('2 of 96');

  await page.setViewportSize({ width: 390, height: 860 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
