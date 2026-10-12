/**
 * @file  apps/api/src/lib/queue.ts
 * @area  API
 * @what  Enqueues analysis jobs on BullMQ (Redis) for apps/worker; job id = analysis id, so a repeat is a no-op.
 */
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { ANALYSIS_QUEUE, ANALYSE_JOB, analyseJobId, type AnalyseJobData } from '@pnl-lens/shared/jobs';

export interface AnalysisQueue {
  enqueue(analysisId: string): Promise<void>;
  close(): Promise<void>;
}

export function bullQueue(connection: Redis): AnalysisQueue {
  const q = new Queue<AnalyseJobData>(ANALYSIS_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,                                   // infrastructure errors only; the worker fails parse errors for good
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 7 * 86400 },              // failed jobs stay visible for a week (dead-letter view)
    },
  });
  return {
    async enqueue(analysisId) { await q.add(ANALYSE_JOB, { analysisId }, { jobId: analyseJobId(analysisId) }); },
    async close() { await q.close(); },
  };
}

export function memoryQueue(): AnalysisQueue & { jobs: string[] } {
  const jobs: string[] = [];
  return { jobs, async enqueue(id) { if (!jobs.includes(id)) jobs.push(id); }, async close() {} };
}
