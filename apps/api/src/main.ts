/**
 * @file  apps/api/src/main.ts
 * @area  API
 * @what  API process entry: config, Postgres (lens_app only), Redis, storage, queue; listens on PORT; graceful shutdown.
 */
import { Redis } from 'ioredis';
import { createDb, assertRole } from '@pnl-lens/db';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { s3Storage, memoryStorage } from './lib/storage.js';
import { bullQueue, memoryQueue } from './lib/queue.js';

const config = loadConfig();
const { db, pool } = createDb({ connectionString: config.databaseUrl, max: Number(process.env.DATABASE_POOL_MAX || 10) });
await assertRole(db, 'lens_app');                                    // rule 4: never the superuser
const redis = config.redisUrl ? new Redis(config.redisUrl, { maxRetriesPerRequest: null }) : null;
if (!config.s3 && config.production) throw new Error('S3_ENDPOINT is required in production');
if (!redis && config.production) throw new Error('REDIS_URL is required in production');
const storage = config.s3 ? s3Storage(config.s3) : memoryStorage();
const queue = redis ? bullQueue(redis) : memoryQueue();

const app = await buildApp({ config, db, pool, storage, queue, redis });

const shutdown = async () => {
  await app.close().catch(() => {});
  await queue.close().catch(() => {});
  await db.destroy().catch(() => {});
  redis?.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 4000) });
