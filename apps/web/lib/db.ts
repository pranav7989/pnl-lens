/**
 * @file  apps/web/lib/db.ts
 * @area  Core
 * @what  PostgreSQL connection pool with SSL + CA certificate support (DigitalOcean / RDS).
 */
import fs from 'node:fs';
import { Pool } from 'pg';

/**
 * Shared connection pool (Amazon RDS for PostgreSQL in production).
 * DATABASE_URL uses the least-privilege `lens_app` role, never the master user.
 * DATABASE_SSL=require for managed Postgres. CA certificate: DATABASE_CA_CERT (PEM text, e.g. DigitalOcean's
 * ${db.CA_CERT} binding) or DATABASE_CA_PATH (a file, e.g. the RDS bundle in the Docker image).
 */
declare global { var __lensPool: Pool | undefined; } // eslint-disable-line no-var

export function pool(): Pool {
  if (!global.__lensPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const ssl = process.env.DATABASE_SSL === 'require'
      ? { rejectUnauthorized: true, ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT } : process.env.DATABASE_CA_PATH ? { ca: fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8') } : {}) }
      : undefined;
    global.__lensPool = new Pool({ connectionString: url, ssl, max: Number(process.env.DATABASE_POOL_MAX || 10), idleTimeoutMillis: 30_000 });
  }
  return global.__lensPool;
}
