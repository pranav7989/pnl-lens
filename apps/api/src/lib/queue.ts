/**
 * @file  apps/api/src/lib/queue.ts
 * @area  API
 * @what  Enqueues analysis jobs on BullMQ (Redis) for apps/worker; job id = analysis id, so a repeat is a no-op.
 */
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { ANALYSIS_QUEUE, ANALYSE_JOB, analyseJobId, DATA_QUEUE, EXPORT_JOB, exportJobId, RESEARCH_JOB, researchJobId, type AnalyseJobData, type ExportJobData, type ResearchJobData } from '@pnl-lens/shared/jobs';

export interface AnalysisQueue {
  enqueue(analysisId: string): Promise<void>;
  /** "Export my data" (job id = request id, so a repeat is a no-op) */
  enqueueExport(requestId: string): Promise<void>;
  /** Research dataset "Build now" (job id = research_exports row id) */
  enqueueResearch(researchId: string): Promise<void>;
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
  const dq = new Queue<ExportJobData | ResearchJobData>(DATA_QUEUE, {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: { age: 86400 }, removeOnFail: { age: 7 * 86400 } },
  });
  return {
    async enqueue(analysisId) { await q.add(ANALYSE_JOB, { analysisId }, { jobId: analyseJobId(analysisId) }); },
    async enqueueExport(requestId) { await dq.add(EXPORT_JOB, { requestId }, { jobId: exportJobId(requestId) }); },
    async enqueueResearch(researchId) { await dq.add(RESEARCH_JOB, { researchId }, { jobId: researchJobId(researchId), attempts: 1 }); },
    async close() { await q.close(); await dq.close(); },
  };
}

export function memoryQueue(): AnalysisQueue & { jobs: string[]; exports: string[]; research: string[] } {
  const jobs: string[] = [], exports: string[] = [], research: string[] = [];
  return { jobs, exports, research, async enqueue(id) { if (!jobs.includes(id)) jobs.push(id); }, async enqueueExport(id) { if (!exports.includes(id)) exports.push(id); },
    async enqueueResearch(id) { if (!research.includes(id)) research.push(id); }, async close() {} };
}
