/**
 * @file  apps/worker/test/queue.test.ts
 * @area  Tests
 * @what  Real sample files through the real queue (API producer → Redis → worker consumer); retries then dead letter; nightly purge and storage sweep.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Redis } from 'ioredis';
import { Queue, QueueEvents } from 'bullmq';
import { testDbAvailable, freshDb, makeUser, givePlan, type TestDb } from '@pnl-lens/db/testing';
import { createDb, createReportFromAnalysis } from '@pnl-lens/db';
import { ANALYSIS_QUEUE } from '@pnl-lens/shared/jobs';
import { bullQueue } from '../../api/src/lib/queue.js';
import { createAnalysisWorker } from '../src/queue-worker.js';
import { nightly, sweepStorage } from '../src/maintenance.js';
import { processAnalysis, FAILURE_MESSAGES } from '../src/pipeline.js';
import { harness, uploadFiles, fixture, type Harness } from './helpers.js';

const env: Record<string, string> = {};
for (const line of fs.readFileSync(path.resolve(__dirname, '../../../.env'), 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
const REDIS_URL = `redis://:${env.TEST_REDIS_PASSWORD}@127.0.0.1:${env.TEST_REDIS_PORT || 56379}`;
const redisUp = await (async () => { const r = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500 }); try { await r.connect(); await r.ping(); return true; } catch { return false; } finally { r.disconnect(); } })();
const ok = (await testDbAvailable()) && redisUp && !!env.TEST_REDIS_PASSWORD;

describe.skipIf(!ok)('queue end to end (real Redis)', () => {
  let t: TestDb, h: Harness, conn: Redis, events: QueueEvents, pool: ReturnType<typeof createDb>['pool'], user = '';
  const logs: string[] = [];
  beforeAll(async () => {
    t = await freshDb('t_worker_queue');
    h = harness(t);
    conn = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    await conn.flushall();
    pool = createDb({ connectionString: t.workerUrl, max: 2, ssl: false }).pool;
    events = new QueueEvents(ANALYSIS_QUEUE, { connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }) });
    await events.waitUntilReady();
    user = await makeUser(t);
    await givePlan(t, user, { reports: 10 });
  });
  afterAll(async () => { await events?.close(); await pool?.end(); conn?.disconnect(); await t?.close(); });

  it('three real statements: enqueued by the API producer, processed by the worker, saved as reports', async () => {
    const worker = createAnalysisWorker(h.deps, pool, conn, { concurrency: 2, lockDurationMs: 120_000, log: (e) => logs.push(e) });
    const producer = bullQueue(conn);
    try {
      const ids = [];
      for (const f of ['zerodha_tradebook.csv', 'groww_pnl.pdf', 'dhan_tradebook.docx']) {
        const { analysisId } = await uploadFiles(t, h, user, [fixture(f)]);
        await producer.enqueue(analysisId);
        await producer.enqueue(analysisId);                               // duplicate enqueue: same job id, no second job
        ids.push(analysisId);
      }
      const queue = new Queue(ANALYSIS_QUEUE, { connection: conn });
      const jobs = await Promise.all(ids.map((id) => queue.getJob(`analysis-${id}`)));
      await Promise.all(jobs.map((j) => j!.waitUntilFinished(events, 60_000)));
      expect((await queue.getJobCounts('completed')).completed).toBe(3);
      await queue.close();
      for (const id of ids) {
        expect((await t.admin.query('select status from analyses where id = $1', [id])).rows[0].status).toBe('ready');
        expect(await createReportFromAnalysis(t.app, user, id)).toMatch(/^[0-9a-f-]{36}$/);
      }
    } finally { await worker.close(); await producer.close(); }
  });

  it('an infrastructure error is retried with backoff, then dead-lettered: analysis failed, error recorded, no credit spent', async () => {
    const worker = createAnalysisWorker(h.deps, pool, conn, { concurrency: 1, lockDurationMs: 60_000, log: (e) => logs.push(e) });
    const queue = new Queue(ANALYSIS_QUEUE, { connection: conn });
    try {
      const { analysisId } = await uploadFiles(t, h, user, [fixture('ibkr_tradebook.csv')]);
      const key = (await t.admin.query('select f.storage_key from analysis_files af join statement_files f on f.id = af.file_id where af.analysis_id = $1', [analysisId])).rows[0].storage_key;
      h.objects.delete(key);                                              // storage keeps failing
      const used = (await t.admin.query('select sum(reports_used)::int as u from subscriptions where user_id = $1', [user])).rows[0].u;
      const job = await queue.add('analyse', { analysisId }, { jobId: `analysis-${analysisId}`, attempts: 3, backoff: { type: 'fixed', delay: 50 } });
      await expect(job.waitUntilFinished(events, 60_000)).rejects.toThrow(/NoSuchKey/);
      await new Promise((r) => setTimeout(r, 300));                       // the 'failed' handler finishes its writes
      expect((await queue.getJob(job.id!))!.attemptsMade).toBe(3);
      expect(await queue.getJobState(job.id!)).toBe('failed');            // kept in the failed set (dead letter)
      expect((await t.admin.query('select status, error_code, error_message, attempts from analyses where id = $1', [analysisId])).rows[0])
        .toEqual({ status: 'failed', error_code: 'internal_error', error_message: FAILURE_MESSAGES.internal_error, attempts: 3 });
      expect((await t.admin.query(`select count(*)::int as n from error_events where route = 'worker:analyse'`)).rows[0].n).toBeGreaterThan(0);
      expect((await t.admin.query('select sum(reports_used)::int as u from subscriptions where user_id = $1', [user])).rows[0].u).toBe(used);
      expect(logs).toContain('analysis_retry');
      expect(logs).toContain('analysis_dead_letter');
    } finally { await worker.close(); await queue.close(); }
  });
});

describe.skipIf(!(await testDbAvailable()))('maintenance', () => {
  let t: TestDb, h: Harness;
  beforeAll(async () => { t = await freshDb('t_worker_maint'); h = harness(t); });
  afterAll(async () => { await t?.close(); });

  it('nightly: shreds files after 30 days and unsaved drafts after 24 h, then deletes their objects; saved reports stay', async () => {
    const user = await makeUser(t);
    await givePlan(t, user);
    const saved = await uploadFiles(t, h, user, [fixture('zerodha_tradebook.csv')]);
    await processAnalysis(h.deps, saved.analysisId);
    const report = await createReportFromAnalysis(t.app, user, saved.analysisId);
    const draft = await uploadFiles(t, h, user, [fixture('dhan_tradebook.csv')]);
    await processAnalysis(h.deps, draft.analysisId);
    const objectsBefore = h.objects.size;

    expect(await nightly(t.worker, h.deps.storage)).toMatchObject({ rawFiles: 0, drafts: 0, sweep: { deleted: 0 } });
    // time passes: the draft is older than 24 h, the saved report's file older than 30 days
    await t.admin.query(`update analyses set expires_at = now() - interval '1 minute' where id = $1`, [draft.analysisId]);
    await t.admin.query(`update statement_files set created_at = now() - interval '31 days', delete_after = now() - interval '1 day' where user_id = $1`, [user]);
    const r = await nightly(t.worker, h.deps.storage);
    expect(r).toMatchObject({ rawFiles: 2, drafts: 1, sweep: { deleted: 2, failed: 0 } });
    expect(h.objects.size).toBe(objectsBefore - 2);
    expect((await t.admin.query('select count(*)::int as n from statement_files where user_id = $1 and object_deleted_at is null', [user])).rows[0].n).toBe(0);
    // D4: the saved report and its trades are untouched
    expect((await t.admin.query('select report is not null as has, purged_at from reports where id = $1', [report])).rows[0]).toEqual({ has: true, purged_at: null });
    expect((await t.admin.query('select count(*)::int as n from trades where analysis_id = $1', [saved.analysisId])).rows[0].n).toBe(96);
  });

  it('sweep treats an already-missing object as deleted', async () => {
    const user = await makeUser(t);
    const a = await uploadFiles(t, h, user, [fixture('groww_pnl.csv')]);
    const key = (await t.admin.query('select f.storage_key from analysis_files af join statement_files f on f.id = af.file_id where af.analysis_id = $1', [a.analysisId])).rows[0].storage_key;
    h.objects.delete(key);
    await t.admin.query(`update statement_files set delete_after = now() - interval '1 second' where id = any($1)`, [a.fileIds]);
    await t.admin.query('select purge_raw_files()');
    expect(await sweepStorage(t.worker, h.deps.storage)).toEqual({ deleted: 1, failed: 0 });
  });
});
