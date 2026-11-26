/**
 * @file  packages/db/src/client.ts
 * @area  Database
 * @what  Kysely connection factory per role (lens_app for the api, lens_worker for the worker) with the existing SSL/CA env handling.
 */
import fs from 'node:fs';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import type { Database } from './types.js';

export type DbRole = 'lens_app' | 'lens_worker';
export type Db = Kysely<Database>;

const DATE_OID = 1082;
/** `date` stays 'YYYY-MM-DD' text: node-postgres would otherwise build a Date at local midnight (plan F3, D9). */
const types = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === DATE_OID ? (v: string) => v : (pg.types.getTypeParser as any)(oid, format)) as typeof pg.types.getTypeParser,
};

/** Same rules as apps/web/lib/db.ts: DATABASE_SSL=require, CA from DATABASE_CA_CERT (PEM) or DATABASE_CA_PATH. */
export function sslFromEnv(env: NodeJS.ProcessEnv = process.env): pg.PoolConfig['ssl'] {
  if (env.DATABASE_SSL !== 'require') return undefined;
  const ca = env.DATABASE_CA_CERT || (env.DATABASE_CA_PATH ? fs.readFileSync(env.DATABASE_CA_PATH, 'utf8') : undefined);
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

export interface CreateDbOptions {
  connectionString: string;
  max?: number;
  ssl?: pg.PoolConfig['ssl'];
}

export function createDb(opts: CreateDbOptions): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    ssl: opts.ssl === undefined ? sslFromEnv() : opts.ssl,
    max: opts.max ?? Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    types,
  });
  return { db: new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }), pool };
}

/** Refuse to run as the wrong role (rule 4: never the superuser). Call once at startup. */
export async function assertRole(db: Db, expected: DbRole): Promise<void> {
  const { rows } = await sql<{ u: string; s: boolean }>`select current_user as u, rolsuper as s from pg_roles where rolname = current_user`.execute(db);
  const r = rows[0];
  if (!r || r.u !== expected || r.s) throw new Error(`database role must be ${expected} (non-superuser), got ${r?.u}${r?.s ? ' (superuser)' : ''}`);
}
