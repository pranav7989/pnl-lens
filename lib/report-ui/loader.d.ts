export function withAnalysing<T>(work: () => Promise<T> | T, opts?: { fileCount?: number; steps?: string[]; stepMs?: number }): Promise<T>;
