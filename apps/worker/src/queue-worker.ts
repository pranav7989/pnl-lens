/**
 * @file  apps/worker/src/queue-worker.ts
 * @area  Worker
 * @what  BullMQ consumer for analysis jobs: runs the pipeline, retries infrastructure errors, and on the final failure marks the analysis failed (dead letter).
 */
import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import type pg from 'pg';
import { setAnalysisStatus } from '@pnl-lens/db';
import { captureErrorWith } from '@pnl-lens/shared/admin/telemetry';
import { ANALYSIS_QUEUE, type AnalyseJobData } from '@pnl-lens/shared/jobs';
import { processAnalysis, FAILURE_MESSAGES, type PipelineDeps } from './pipeline.js';

export type Log = (event: string, extra?: object) => void;

export function createAnalysisWorker(deps: PipelineDeps, pool: pg.Pool, connection: ConnectionOptions,
  opts: { concurrency: number; lockDurationMs: number; log: Log }) {
  const w = new Worker<AnalyseJobData>(ANALYSIS_QUEUE, async (job: Job<AnalyseJobData>) => {
    const t = Date.now();
    const outcome = await processAnalysis(deps, job.data.analysisId, job.id);
    opts.log('analysis_done', { analysisId: job.data.analysisId, outcome, ms: Date.now() - t, attempt: job.attemptsMade + 1 });
    return { outcome };
  }, { connection, concurrency: opts.concurrency, lockDuration: opts.lockDurationMs });

  // Dead letter: after the last retry the job stays in BullMQ's failed set (kept 7 days by the producer's options),
  // the analysis is marked failed so the user sees a message, and the error goes to the admin Errors tab.
  w.on('failed', async (job, err) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    opts.log(final ? 'analysis_dead_letter' : 'analysis_retry', { analysisId: job.data.analysisId, attempt: job.attemptsMade, error: err.message });
    if (!final) return;
    await setAnalysisStatus(deps.db, job.data.analysisId, 'failed', 'internal_error', FAILURE_MESSAGES.internal_error).catch(() => {});
    await captureErrorWith(pool, err, { source: 'server', route: 'worker:analyse', context: { analysisId: job.data.analysisId, attempts: job.attemptsMade } });
  });
  return w;
}
