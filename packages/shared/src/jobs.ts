/**
 * @file  packages/shared/src/jobs.ts
 * @area  Core
 * @what  Queue names and job payloads shared by apps/api (producer) and apps/worker (consumer).
 */
export const ANALYSIS_QUEUE = 'analyses';
export const ANALYSE_JOB = 'analyse';
export interface AnalyseJobData { analysisId: string }
/** Job id = analysis id: enqueueing the same analysis twice is a no-op (idempotent). */
export const analyseJobId = (analysisId: string) => `analysis-${analysisId}`;
