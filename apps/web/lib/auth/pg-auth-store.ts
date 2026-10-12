/**
 * @file  apps/web/lib/auth/pg-auth-store.ts
 * @area  Auth
 * @what  Auth store on PostgreSQL: the shared PgAuthStore bound to the web app's pool.
 */
import { pool } from '@/lib/db';
import { PgAuthStore as SharedPgAuthStore } from '@pnl-lens/shared/auth/pg-auth-store';

export class PgAuthStore extends SharedPgAuthStore {
  constructor() { super({ query: (text, params) => pool().query(text, params as unknown[]) }); }
}
