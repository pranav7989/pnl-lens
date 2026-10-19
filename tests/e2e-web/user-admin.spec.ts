/**
 * @file  tests/e2e-web/user-admin.spec.ts
 * @area  Tests
 * @what  User management end to end: owner requests reports → email → one-click Yes → Included; restrict signs the user out; delete with typed email; admin and support limits.
 */
import { test, expect, type Browser } from '@playwright/test';
import { signIn, sql, lastMail } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

const stamp = Date.now();
const OWNER = `um-owner-${stamp}@e2e.local`, TRADER = `um-trader-${stamp}@e2e.local`;

async function trader(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, TRADER);
  if (sql(`select count(*) from reports r join users u on u.id = r.user_id where u.email = '${TRADER}'`) === '0') {
    sql(`insert into reports (user_id, file_names, file_hashes, expires_at) select id, '{a.csv}', '{h}', 'infinity' from users where email = '${TRADER}'`);
  }
  return { ctx, page };
}

test('owner: Request reports → email → Yes on the page → Included', async ({ page, browser }) => {
  const t = await trader(browser);
  await signIn(page, OWNER);
  sql(`update users set role = 'owner' where email = '${OWNER}'`);
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'User management' }).click();
  await page.getByRole('searchbox', { name: 'Search by email' }).fill(TRADER);
  const row = page.locator(`tr[data-user="${TRADER}"]`);
  await expect(row).toContainText('Not included');
  await row.getByRole('button', { name: 'Request reports' }).click();
  await expect(page.getByRole('status')).toHaveText(`Request sent to ${TRADER}.`);
  await expect(row).toContainText('Asked');

  const mail = lastMail(TRADER)!;
  expect(mail.subject).toBe('Help us make PnL Lens better for traders like you');
  const link = /https?:\/\/[^\s]+choice=yes/.exec(mail.text)![0].replace(/^https?:\/\/[^/]+/, '');
  const visitor = await (await browser.newContext()).newPage();                       // no sign-in needed
  await visitor.goto(link);
  await expect(visitor.getByRole('heading', { name: 'Help improve PnL Lens' })).toBeVisible();
  await expect(visitor.locator('.rc-quote')).toHaveText('Also let PnL Lens use my data, anonymised, to improve its analysis. Optional — you can change this anytime.');
  await visitor.getByRole('button', { name: 'Yes, include my reports' }).click();
  await expect(visitor.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole('heading', { name: 'Thank you' })).toBeVisible();      // already answered

  await page.reload();
  await page.getByRole('tab', { name: 'User management' }).click();
  await page.getByRole('searchbox', { name: 'Search by email' }).fill(TRADER);
  await expect(page.locator(`tr[data-user="${TRADER}"]`)).toContainText('Included');
  await t.ctx.close();
});

test('owner: restrict signs the trader out; unrestrict; delete with the typed email', async ({ page, browser }) => {
  const t = await trader(browser);
  await signIn(page, OWNER);
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'User management' }).click();
  await page.getByRole('searchbox', { name: 'Search by email' }).fill(TRADER);
  const row = page.locator(`tr[data-user="${TRADER}"]`);
  await expect(row).toBeVisible();
  await new Promise((r) => setTimeout(r, 1100));                                         // the trader's session predates it
  page.once('dialog', (d) => d.accept('Shared account'));
  await row.getByRole('button', { name: 'Restrict' }).click();
  await expect(row).toContainText('Restricted');
  await expect(row).toContainText('Shared account');
  expect(await t.page.evaluate(async () => (await fetch('/api/v1/me')).status)).toBe(401);
  await row.getByRole('button', { name: 'Unrestrict' }).click();
  await expect(row).not.toContainText('Restricted');

  await row.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Delete user' })).toBeDisabled();
  await dialog.getByLabel(/Reason/).fill('Asked to be removed');
  await dialog.getByLabel('Type the email to confirm').fill(TRADER);
  await dialog.getByRole('button', { name: 'Delete user' }).click();
  await expect(page.getByRole('status')).toHaveText(`${TRADER} was deleted.`);
  await expect(row).toHaveCount(0);
  expect(sql(`select count(*) from users where email = '${TRADER}'`)).toBe('0');
  await t.ctx.close();
});

test('admin sees the tab without Delete or Request; support has no tab', async ({ page }) => {
  const admin = `um-admin-${stamp}@e2e.local`, support = `um-support-${stamp}@e2e.local`;
  await signIn(page, admin);
  sql(`update users set role = 'admin' where email = '${admin}'`);
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'User management' }).click();
  await expect(page.locator('[data-user-admin] tbody tr').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Request reports' })).toHaveCount(0);
  await page.context().clearCookies();
  await signIn(page, support);
  sql(`update users set role = 'support' where email = '${support}'`);
  await page.goto('/admin');
  await expect(page.getByRole('tab').first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'User management' })).toHaveCount(0);
});
