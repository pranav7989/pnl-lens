/**
 * @file  lib/config.ts
 * @area  Core
 * @what  App-wide limits (max files, file types, report lifetime).
 */
export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_REPORT_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_EXT = ['.xlsx', '.xls', '.csv', '.pdf', '.docx', '.doc'];
export const reportTtlDays = () => Number(process.env.REPORT_TTL_DAYS || 30);
