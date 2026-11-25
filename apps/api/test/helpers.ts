/**
 * @file  apps/api/test/helpers.ts
 * @area  Tests
 * @what  API test helpers: app on a fresh migrated database (lens_app connection), session cookies, multipart bodies, captured mail.
 */
import crypto from 'node:crypto';
import { createDb } from '@pnl-lens/db';
import { freshDb, type TestDb } from '@pnl-lens/db/testing';
import { createSessionToken, SESSION_COOKIE } from '@pnl-lens/shared/auth/session';
import type { Mail } from '@pnl-lens/shared/mail';
import { buildApp, type App } from '../src/app.js';
import type { Config } from '../src/config.js';
import { memoryStorage } from '../src/lib/storage.js';
import { memoryQueue } from '../src/lib/queue.js';

export const ORIGIN = 'https://pnllens.test';
export const KEK = { id: 'k1', key: crypto.createHash('sha256').update('test-kek').digest() };

Object.assign(process.env, {
  AUTH_MODE: 'jwt',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789',
  OTP_PEPPER: 'test-otp-pepper-0123456789',
  APP_URL: ORIGIN,
  PAYMENTS_MODE: 'off',
});

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    databaseUrl: 'postgres://unused', redisUrl: null, s3: null,
    keks: { current: KEK, all: new Map([[KEK.id, KEK]]) },
    ipHashSecret: 'test-ip-hash-secret-0123456789abcdef',
    allowedOrigins: [ORIGIN], authMode: 'jwt', production: false, exposeOpenApi: true,
    ...over,
  };
}

export interface TestApp {
  app: App; t: TestDb; storage: ReturnType<typeof memoryStorage>; queue: ReturnType<typeof memoryQueue>; mail: Mail[];
  close(): Promise<void>;
}

export async function testApp(dbName: string): Promise<TestApp> {
  const t = await freshDb(dbName);
  const { db, pool } = createDb({ connectionString: t.appUrl, max: 5, ssl: false });
  const storage = memoryStorage(), queue = memoryQueue(), mail: Mail[] = [];
  const app = await buildApp({ config: testConfig(), db, pool, storage, queue, mail: async (m) => { mail.push(m); } });
  await app.ready();
  return { app, t, storage, queue, mail, async close() { await app.close(); await db.destroy(); await t.close(); } };
}

export const cookieFor = async (userId: string, country: string | null = 'IN') =>
  `${SESSION_COOKIE}=${await createSessionToken({ id: userId, country })}`;

/** Same-site browser request headers (Origin passes the CSRF check). */
export const as = async (userId?: string) => ({ origin: ORIGIN, ...(userId ? { cookie: await cookieFor(userId) } : {}) });

export interface Part { name: string; value?: string; filename?: string; content?: Buffer; type?: string }
export function multipart(parts: Part[]) {
  const boundary = '----pnllens' + crypto.randomBytes(8).toString('hex');
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ''}\r\n`));
    if (p.filename) chunks.push(Buffer.from(`Content-Type: ${p.type || 'application/octet-stream'}\r\n`));
    chunks.push(Buffer.from('\r\n'), p.content ?? Buffer.from(p.value ?? ''), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
