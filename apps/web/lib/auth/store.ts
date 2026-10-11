/**
 * @file  apps/web/lib/auth/store.ts
 * @area  Auth
 * @what  Picks the auth store (file for local dev, Postgres in production).
 */
import type { AuthStore } from './types';
import { FileAuthStore } from './file-auth-store';
import { PgAuthStore } from './pg-auth-store';

let s: AuthStore | null = null;
export function getAuthStore(): AuthStore {
  if (!s) s = process.env.STORE_DRIVER === 'pg' ? new PgAuthStore() : new FileAuthStore();
  return s;
}
