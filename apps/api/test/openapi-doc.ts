/**
 * @file  apps/api/test/openapi-doc.ts
 * @area  Tests
 * @what  Builds the app with placeholder dependencies (no database connection is opened) to read its OpenAPI document.
 */
import { createDb } from '@pnl-lens/db';
import { buildApp, type App } from '../src/app.js';
import { memoryStorage } from '../src/lib/storage.js';
import { memoryQueue } from '../src/lib/queue.js';
import { testConfig } from './helpers.js';

export async function offlineApp(): Promise<App> {
  const { db, pool } = createDb({ connectionString: 'postgres://nobody@127.0.0.1:1/none', max: 1, ssl: false });
  const app = await buildApp({ config: testConfig(), db, pool, storage: memoryStorage(), queue: memoryQueue(), mail: async () => {} });
  await app.ready();
  return app;
}

export async function openApiDocument() {
  const app = await offlineApp();
  const doc = app.swagger();
  await app.close();
  return doc;
}
