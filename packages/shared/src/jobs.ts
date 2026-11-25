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

/** "Export my data" requests (Phase 7): one job per data_requests row. */
export const DATA_QUEUE = 'data-requests';
export const EXPORT_JOB = 'export';
export interface ExportJobData { requestId: string }
export const exportJobId = (requestId: string) => `export-${requestId}`;

/** Research dataset (owner's "Build now"): same queue as data exports, one job per research_exports row. */
export const RESEARCH_JOB = 'research';
export interface ResearchJobData { researchId: string }
export const researchJobId = (id: string) => `research-${id}`;
