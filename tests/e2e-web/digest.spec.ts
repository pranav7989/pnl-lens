/**
 * @file  tests/e2e-web/digest.spec.ts
 * @area  Tests
 * @what  Weekly summary email: off by default, turned on in Your data, the email arrives once with focus rules and the report link, and its "Stop these emails" link turns it off (button, no sign-in).
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { signIn, givePlan, lastMail, FIX } from './helpers';

test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

test('weekly summary: opt in, receive it, stop it from the email link', async ({ page, browser }) => {
  const email = `digest-${Date.now()}@e2e.local`;
  await signIn(page, email, '/upload');
  givePlan(email);
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });
  const reportId = page.url().split('/report/')[1];

  await page.goto('/dashboard');
  const box = page.locator('input[name=weeklyDigest]');
  await expect(box).not.toBeChecked();
  await box.check();
  await expect.poll(() => lastMail(email)?.subject ?? '', { timeout: 20_000 }).toMatch(/^Your week/);
  const mail = lastMail(email)!;
  expect(mail.text).toContain(`/report/${reportId}`);
  expect(mail.text).toContain('Your focus this week:');
  const link = mail.text.match(/Stop it: (\S+)/)![1];
  const u = new URL(link);

  // the link works without signing in
  const ctx = await browser.newContext(); const anon = await ctx.newPage();
  await anon.goto(u.pathname + u.search);
  await anon.getByRole('button', { name: 'Stop the weekly summary' }).click();
  await expect(anon.locator('[data-unsubscribed]')).toBeVisible();
  await ctx.close();

  await page.reload();
  await expect(page.locator('input[name=weeklyDigest]')).not.toBeChecked();
});
