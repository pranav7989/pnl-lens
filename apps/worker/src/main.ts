/**
 * @file  apps/worker/src/main.ts
 * @area  Worker
 * @what  Worker process: BullMQ consumer for analysis jobs (retries, dead-letter on final failure), data exports and research datasets, schedules (nightly purge, storage sweep, research dataset on the 1st and 16th), local health endpoint.
 */
/**
 * Runs on the internal network only (no internet) as lens_worker. Health is served on 127.0.0.1 inside the container
 * (Docker healthcheck). Logs are JSON lines and never contain file names or contents (plan §10).
 */
import http from 'node:http';
import { Redis } from 'ioredis';
import { Worker, Queue } from 'bullmq';
import { createDb, assertRole } from '@pnl-lens/db';
import { loadWorkerConfig } from './config.js';
import { s3WorkerStorage } from './storage.js';
import { runEngineIsolated } from './engine-runner.js';
import { engineVersion } from './engine-version.js';
import { createAnalysisWorker } from './queue-worker.js';
import { DATA_QUEUE, RESEARCH_JOB, type ExportJobData, type ResearchJobData } from '@pnl-lens/shared/jobs';
import { buildResearchExport, sweepResearch } from './research.js';
import { processExport, failExport, sweepExports } from './export.js';
import { nightly, sweepStorage } from './maintenance.js';

const MAINTENANCE_QUEUE = 'maintenance';
const log = (event: string, extra: object = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), service: 'worker', event, ...extra }));

const cfg = loadWorkerConfig();
const { db, pool } = createDb({ connectionString: cfg.databaseUrl, max: cfg.concurrency + 2 });
await assertRole(db, 'lens_worker');                                   // rule 4
const connection = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null });
const storage = s3WorkerStorage(cfg.s3);
const version = engineVersion();
const deps = {
  db, storage, keks: cfg.keks, engineVersion: version,
  runEngine: (input: Parameters<typeof runEngineIsolated>[0]) => runEngineIsolated(input, { timeoutMs: cfg.engineTimeoutMs, memoryMb: cfg.engineMemoryMb }),
};

const analyses = createAnalysisWorker(deps, pool, connection, { concurrency: cfg.concurrency, lockDurationMs: Math.max(60_000, cfg.engineTimeoutMs * 2), log });

// "Export my data" requests (Phase 7): one at a time; final failure marks the request failed.
const exportsWorker = new Worker<ExportJobData | ResearchJobData>(DATA_QUEUE, async (job) => {
  if (job.name === RESEARCH_JOB) {                                     // owner's "Build now" (research dataset)
    const r = await buildResearchExport({ db, storage, currentKek: cfg.currentKek }, (job.data as ResearchJobData).researchId);
    log('research_export', r);
    return r;
  }
  const outcome = await processExport({ db, storage, keks: cfg.keks, currentKek: cfg.currentKek }, (job.data as ExportJobData).requestId, job.id);
  log('export_done', { requestId: (job.data as ExportJobData).requestId, outcome });
  return { outcome };
}, { connection, concurrency: 1, lockDuration: 300_000 });
exportsWorker.on('failed', async (job, err) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1) || job.name === RESEARCH_JOB) return;   // a research build marks its own row failed
  log('export_dead_letter', { requestId: (job.data as ExportJobData).requestId, error: err.message });
  await failExport(db, (job.data as ExportJobData).requestId).catch(() => {});
});

// Schedules (02:00 IST nightly purge; storage sweep every 15 minutes). Upserting is idempotent across restarts.
const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection });
await maintenanceQueue.upsertJobScheduler('nightly-purge', { pattern: '0 2 * * *', tz: 'Asia/Kolkata' }, { name: 'nightly' });
await maintenanceQueue.upsertJobScheduler('storage-sweep', { every: 15 * 60_000 }, { name: 'sweep' });
// research dataset for future model training (opted-in users only): 03:00 IST on the 1st and 16th, about every 15 days
await maintenanceQueue.upsertJobScheduler('research-export', { pattern: '0 3 1,16 * *', tz: 'Asia/Kolkata' }, { name: 'research' });
const maintenance = new Worker(MAINTENANCE_QUEUE, async (job) => {
  const result = job.name === 'nightly' ? await nightly(db, storage)
    : job.name === 'research' ? await buildResearchExport({ db, storage, currentKek: cfg.currentKek })
    : { files: await sweepStorage(db, storage), exports: await sweepExports(db, storage), research: await sweepResearch(db, storage) };
  log(`maintenance_${job.name}`, { result });
  return result;
}, { connection, concurrency: 1 });

// ---- engine self-test: a broken image (missing parser library) must not report healthy -------------
const SELFTEST = new TextEncoder().encode('symbol,trade_date,trade_type,quantity,price\nTEST,2025-01-06,buy,1,100\nTEST,2025-01-07,sell,1,110\n');
let engineCheck = 'pending';
const selfTest = async () => {
  const r = await deps.runEngine({ files: [{ name: 'selftest.csv', data: SELFTEST }] });
  engineCheck = r.ok && r.report?.m.n === 1 ? 'ok' : `failed:${r.ok ? 'unexpected_result' : r.message}`.slice(0, 200);
  if (engineCheck !== 'ok') log('engine_selftest_failed', { result: engineCheck });
};
await selfTest().catch((e) => { engineCheck = `failed:${(e as Error).message}`.slice(0, 200); });

// ---- health ---------------------------------------------------------------------
let last: { ok: boolean; checks: Record<string, string>; at: string; engineVersion: string } = { ok: false, checks: {}, at: '', engineVersion: version };
async function check() {
  const checks: Record<string, string> = {};
  try { const { rows } = await pool.query('select current_user as u'); checks.db = rows[0].u === 'lens_worker' ? 'ok' : `wrong_role:${rows[0].u}`; } catch { checks.db = 'down'; }
  try { checks.redis = (await connection.ping()) === 'PONG' ? 'ok' : 'bad_reply'; } catch { checks.redis = 'down'; }
  checks.storage = await storage.check();
  checks.queue = analyses.isRunning() ? 'ok' : 'stopped';
  checks.engine = engineCheck;
  const ok = Object.values(checks).every((v) => v === 'ok');
  if (ok !== last.ok) log(ok ? 'ready' : 'not_ready', { checks });
  last = { ok, checks, at: new Date().toISOString(), engineVersion: version };
}
const server = http.createServer((req, res) => {
  res.writeHead(req.url === '/health' && last.ok ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(last));
});
server.listen(4100, '127.0.0.1');
await check();
const timer = setInterval(() => { check().catch(() => {}); }, 30_000);
log('started', { engineVersion: version, concurrency: cfg.concurrency });

const shutdown = async () => {
  clearInterval(timer);
  server.close();
  await analyses.close().catch(() => {});                              // lets running jobs finish
  await maintenance.close().catch(() => {});
  await exportsWorker.close().catch(() => {});
  await maintenanceQueue.close().catch(() => {});
  await db.destroy().catch(() => {});
  connection.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
