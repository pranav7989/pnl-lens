/**
 * @file  apps/web/lib/api-browser.ts
 * @area  Core
 * @what  Browser-side calls to the API (/api/v1 on the same site): JSON helper and multipart upload; errors keep the API's { error, message }.
 */
export interface ApiError { status: number; error: string; message: string }

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method || (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, error: data?.error || 'error', message: data?.message || 'Something went wrong. Please try again.' } as ApiError;
  return data as T;
}

/** POST /api/v1/analyses (multipart). Returns the analysis id; throws ApiError with the API's message. */
export async function uploadStatements(files: File[], fields: Record<string, string>): Promise<string> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const f of files) fd.append('files', f, f.name);
  const res = await fetch('/api/v1/analyses', { method: 'POST', body: fd, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, error: data?.error || 'error', message: data?.message || 'Could not upload the files.' } as ApiError;
  return data.analysisId as string;
}

export interface AnalysisStatus {
  id: string; status: 'queued' | 'parsing' | 'analysing' | 'storing' | 'ready' | 'failed';
  error: string | null; message: string | null; reportId: string | null;
  preview: { source: string; positions: number; from: string | null; to: string | null; markets: string[]; currency: string; net: number; leaks: number; rules: number;
    charges: number; insights: string[]; insightCount: number } | null;
}

/** Polls GET /api/v1/analyses/:id until the worker has finished (ready or failed). */
export async function waitForAnalysis(id: string, { intervalMs = 700, timeoutMs = 180_000 } = {}): Promise<AnalysisStatus> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const s = await api<AnalysisStatus>(`/analyses/${id}`);
    if (s.status === 'ready' || s.status === 'failed') return s;
    if (Date.now() > until) throw { status: 504, error: 'timeout', message: 'This is taking longer than usual. Your files are still being read; open your reports in a minute.' } as ApiError;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
