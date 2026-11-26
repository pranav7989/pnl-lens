/**
 * @file  apps/worker/src/config.ts
 * @area  Worker
 * @what  Worker configuration from env: lens_worker DB URL, Redis, storage (read + delete), file keys, engine limits.
 */
import { loadKeks, type Kek } from '@pnl-lens/shared/file-crypto';

export interface WorkerConfig {
  databaseUrl: string;
  redisUrl: string;
  s3: { endpoint: string; region: string; bucket: string; exportBucket: string; accessKeyId: string; secretAccessKey: string };
  keks: Map<string, Kek>;
  currentKek: Kek;
  concurrency: number;
  engineTimeoutMs: number;
  engineMemoryMb: number;
}

const req = (env: NodeJS.ProcessEnv, k: string) => { const v = env[k]; if (!v) throw new Error(`${k} is not set`); return v; };

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  if (env.TZ !== 'Asia/Kolkata') throw new Error('TZ must be Asia/Kolkata (plan D9): the engine parses some dates in local time');
  return {
    databaseUrl: req(env, 'DATABASE_URL'),
    redisUrl: req(env, 'REDIS_URL'),
    s3: { endpoint: req(env, 'S3_ENDPOINT'), region: env.S3_REGION || 'garage', bucket: req(env, 'S3_BUCKET'), exportBucket: env.S3_EXPORT_BUCKET || 'exports',
      accessKeyId: req(env, 'S3_ACCESS_KEY_ID'), secretAccessKey: req(env, 'S3_SECRET_ACCESS_KEY') },
    keks: loadKeks(env).all,
    currentKek: loadKeks(env).current,
    concurrency: Number(env.WORKER_CONCURRENCY || 2),
    engineTimeoutMs: Number(env.ENGINE_TIMEOUT_MS || 60_000),
    engineMemoryMb: Number(env.ENGINE_MEMORY_MB || 512),
  };
}
