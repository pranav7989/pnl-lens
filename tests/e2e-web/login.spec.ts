/**
 * @file  tests/e2e-web/login.spec.ts
 * @area  Tests
 * @what  Sign-in card: new email → code → required password → dashboard; password sign-in sends no code; wrong password; forgot → code → new password; the set step can't be skipped; layout at 320/390/1440.
 */
import { test, expect, type Page } from '@playwright/test';
import { signIn, waitForCode, codeBefore, sql, E2E_PASSWORD } from './helpers';

const NEW_PW = 'new-Password-22';
const logOut = async (page: Page) => { await page.context().clearCookies(); };
const toPasswordStep = async (page: Page, email: string) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.locator('[data-step]')).toHaveAttribute('data-step', 'password');
};

test.describe('journeys', () => {
  // Linux WebKit drops the Secure session cookie on http://localhost (production is https); journeys run in Chromium
  test.skip(({ browserName }) => browserName === 'webkit', 'Secure cookie over plain http');

  test('new email: code, then a required password; next time email + password and no code is sent', async ({ page }) => {
    const email = `login-${Date.now()}@e2e.local`;
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    const before = codeBefore(email);
    await page.getByRole('button', { name: 'Continue with email' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await page.fill('input[name=code]', await waitForCode(email, before));
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Set a password' })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Repeat the password').fill('short');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.locator('.login-card .status.err')).toHaveText('Use at least 8 characters.');
    await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
    await page.getByLabel('Repeat the password').fill(E2E_PASSWORD + 'x');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.locator('.login-card .status.err')).toHaveText('The two passwords don’t match.');
    await page.getByRole('button', { name: 'Show password' }).first().click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByLabel('Repeat the password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.waitForURL(/\/dashboard/);
    const me1 = await page.evaluate(async () => (await (await fetch('/api/v1/me')).json()).user.id);

    await logOut(page);
    const mailBefore = codeBefore(email);
    await toPasswordStep(page, email);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('wrong-password-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.login-card .status.err')).toHaveText('That email and password don’t match.');
    await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(/\/dashboard/);
    expect(await page.evaluate(async () => (await (await fetch('/api/v1/me')).json()).user.id)).toBe(me1);
    expect(codeBefore(email)).toBe(mailBefore);                                   // no email was sent
  });

  test('forgot password: code, new password; the old one stops working', async ({ page }) => {
    const email = `forgot-${Date.now()}@e2e.local`;
    await signIn(page, email);
    await logOut(page);
    await toPasswordStep(page, email);
    const before = codeBefore(email);
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.fill('input[name=code]', await waitForCode(email, before));
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await page.getByLabel('New password').fill(NEW_PW);
    await page.getByLabel('Repeat the password').fill(NEW_PW);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.waitForURL(/\/dashboard/);

    await logOut(page);
    await toPasswordStep(page, email);
    await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.login-card .status.err')).toHaveText('That email and password don’t match.');
    await page.getByLabel('Password', { exact: true }).fill(NEW_PW);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(/\/dashboard/);
  });

  test('closing the page after the code does not skip the password: the dashboard sends you to set one', async ({ page }) => {
    const email = `skip-${Date.now()}@e2e.local`;
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    const before = codeBefore(email);
    await page.getByRole('button', { name: 'Continue with email' }).click();
    await page.fill('input[name=code]', await waitForCode(email, before));
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Set a password' })).toBeVisible();
    await page.goto('/dashboard');                                                 // try to skip it
    await page.waitForURL(/\/login\?step=set/);
    await expect(page.getByRole('heading', { name: 'Set a password' })).toBeVisible();
    expect(sql(`select password_hash is null from users where email = '${email}'`)).toBe('t');
  });
});

test('card layout: first step, no Google button while Google is not configured', async ({ page }) => {
  await page.goto('/login');
  const card = page.locator('.login-card');
  await expect(card.getByRole('heading', { name: 'Sign in or create an account' })).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'Email' })).toHaveAttribute('placeholder', 'Enter your email');
  await expect(card.getByRole('button', { name: 'Continue with email' })).toBeVisible();
  const google = (await (await page.request.get('/api/v1/auth/providers')).json()).google;
  await expect(card.getByRole('link', { name: 'Continue with Google' })).toHaveCount(google ? 1 : 0);
  await expect(card.locator('.login-or')).toHaveCount(google ? 1 : 0);
});

for (const width of [320, 390, 1440]) {
  test(`no overlap or sideways scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/login');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const input = await box('.login-card input[type=email]'), btn = await box('.login-card .login-email .btn'), card = await box('.login-card');
    expect(btn.y).toBeGreaterThanOrEqual(input.y + input.height);
    expect(input.x).toBeGreaterThanOrEqual(card.x); expect(btn.x + btn.width).toBeLessThanOrEqual(card.x + card.width);
    expect(btn.height).toBeGreaterThanOrEqual(44);
  });
}

test('keyboard focus is visible; a wrong code shows its message', async ({ page }) => {
  await page.goto('/login');
  const input = page.getByRole('textbox', { name: 'Email' });
  await input.focus();
  await expect.poll(() => input.evaluate((el) => getComputedStyle(el).borderColor)).toBe('rgb(255, 214, 10)');
  await input.fill(`wrong-code-${Date.now()}@e2e.local`);
  await input.press('Enter');
  await expect(page.getByText(/We sent a 6-digit code to/)).toBeVisible();
  await page.getByRole('textbox', { name: '6-digit code' }).fill('000000');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.login-card .status.err')).toHaveText(/wrong or has expired/);
  await page.getByRole('button', { name: 'Use a different email' }).click();
  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
});
