/**
 * @file  tests/e2e-web/helpers.ts
 * @area  Tests
 * @what  E2E helpers: sign in with an emailed code (read from the API's console mail log), give a user a plan, run SQL as the admin.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

const ROOT = path.resolve(__dirname, '../..');
const env: Record<string, string> = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
const dc = (...args: string[]) => spawnSync('docker', ['compose', '--env-file', path.join(ROOT, '.env'), '-f', path.join(ROOT, 'infra/compose.dev.yml'), ...args], { encoding: 'utf8' });

export const FIX = path.join(ROOT, 'packages/engine/test/fixtures');

/** psql as the database owner inside the postgres container (test setup only). */
export function sql(q: string): string {
  const r = dc('exec', '-T', '-e', `PGPASSWORD=${env.POSTGRES_PASSWORD}`, 'postgres', 'psql', '-h', '127.0.0.1', '-U', env.POSTGRES_USER || 'lens_admin', '-d', 'lens', '-tAc', q);
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

function latestCode(email: string): string | null {
  const r = dc('exec', '-T', 'api', 'sh', '-c', 'cat /app/.data/dev-mail.log 2>/dev/null || true');
  const lines = r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to === email);
  return lines.length ? lines[lines.length - 1].subject.slice(0, 6) : null;
}

/** Signs in through the real login page with an emailed 6-digit code. */
export async function signIn(page: Page, email: string, next = '/dashboard') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.fill('input[type=email]', email);
  const before = latestCode(email);
  await page.getByRole('button', { name: /email me a code/i }).click();
  let code: string | null = null;
  await expect.poll(() => { code = latestCode(email); return code && code !== before ? code : null; }, { timeout: 20_000 }).not.toBeNull();
  await page.fill('input[inputmode=numeric], input[name=code]', code!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** Gives the user a plan the way the owner's manual grant would (setup shortcut; payments are off in tests). */
export function givePlan(email: string, plan = 'snapshot', reports = 5, files = 3) {
  sql(`insert into subscriptions (user_id, plan_id, reports_total, files_per_report, ends_at, grant_reason)
       select id, '${plan}', ${reports}, ${files}, now() + interval '183 days', 'e2e' from users where email = '${email}'`);
  sql(`update credits set balance = balance + ${reports} where user_id = (select id from users where email = '${email}')`);
}
