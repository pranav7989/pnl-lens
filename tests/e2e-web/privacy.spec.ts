/**
 * @file  tests/e2e-web/privacy.spec.ts
 * @area  Tests
 * @what  Data rights in the browser: research opt-in toggle, export my data (worker builds the ZIP, download works), delete my account.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { signIn, givePlan, sql, FIX, cspViolations } from './helpers';

const email = `e2e-privacy-${Date.now()}@pnllens.test`;

test('research opt-in, export my data, then delete my account', async ({ page }, info) => {
  const csp = cspViolations(page);
  await signIn(page, email, '/dashboard');            // signing in creates the account
  givePlan(email);
  await page.goto('/upload');
  await page.setInputFiles('#file', path.join(FIX, 'zerodha_tradebook.csv'));
  await page.check('input[name=consent]');
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForURL(/\/report\//, { timeout: 90_000 });

  await page.goto('/dashboard');
  const research = page.locator('input[name=research]');
  await expect(research).not.toBeChecked();                                         // off by default
  await research.check();
  await expect.poll(() => sql(`select granted from user_consent_current c join users u on u.id = c.user_id where u.email = '${email}' and purpose = 'research'`)).toBe('t');

  await page.getByRole('button', { name: 'Export my data' }).click();
  const link = page.getByRole('link', { name: 'Download export (ZIP)' });
  await expect(link).toBeVisible({ timeout: 60_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const file = info.outputPath('export.zip');
  await dl.saveAs(file);
  const py = 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); print("\\n".join(z.namelist())); print(len(__import__("json").loads(z.read("pnl-lens-data.json"))["reports"][0]["trades"]))';
  const r = spawnSync('python3', ['-I', '-c', py, file], { encoding: 'utf8' });
  expect(r.stdout.trim().split('\n')).toEqual(['README.txt', 'pnl-lens-data.json', 'statements/zerodha_tradebook.csv', '96']);
  expect(fs.statSync(file).size).toBeGreaterThan(1000);

  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete my account' }).last().click();
  await page.waitForURL((u) => u.pathname === '/');
  expect(sql(`select count(*) from users where email = '${email}'`)).toBe('0');            // the row is anonymised
  expect(sql(`select count(*) from reports r join users u on u.id = r.user_id where u.email like 'deleted+%' and r.purged_at is null and r.user_id in (select user_id from audit_log where action = 'account_deleted')`)).toBe('0');

  // the same email can sign up again and starts empty
  await signIn(page, email, '/dashboard');
  await expect(page.getByText('No reports yet.')).toBeVisible();
  expect(csp, 'CSP violations').toEqual([]);
});
