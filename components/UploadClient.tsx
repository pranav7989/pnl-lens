/**
 * @file  components/UploadClient.tsx
 * @area  Reports
 * @what  Upload flow: pick files, parse in a Web Worker (PDFs via pdf.js), preview, save (spends a credit).
 */
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_FILES, MAX_FILE_BYTES, ACCEPTED_EXT } from '@/lib/config';
import { engine } from '@/lib/engine';
import type { ReportV1, RawSheet } from '@/lib/engine/types';
import { withAnalysing } from '@/lib/report-ui/loader.js';

type Phase = 'idle' | 'analyzing' | 'preview' | 'saving';
const CURRENCIES = Object.keys(engine.CURSYM as Record<string, string>);

async function sha256(buf: ArrayBuffer) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function UploadClient({ credits }: { credits: number }) {
  const router = useRouter();
  const worker = useRef<Worker | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [hashes, setHashes] = useState<string[]>([]);
  const [currency, setCurrency] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [report, setReport] = useState<ReportV1 | null>(null);
  const [over, setOver] = useState(false);

  const pending = useRef<((m: any) => void) | null>(null);
  useEffect(() => {
    const w = new Worker(new URL('../workers/analyze.worker.ts', import.meta.url));
    w.onmessage = (e) => { const r = pending.current; pending.current = null; r?.(e.data); };
    worker.current = w;
    return () => w.terminate();
  }, []);
  const ask = (msg: any, transfer: Transferable[] = []) => new Promise<any>((resolve, reject) => {
    pending.current = (m) => (m.type === 'error' ? reject(new Error(m.message)) : resolve(m));
    worker.current!.postMessage(msg, transfer);
  });
  function apply(m: any) {
    if (m.report) { setReport(m.report); setPhase('preview'); setError(''); }
    else { ev('no_trades', { reason: 'no_closed_trades', ext: files.map((f) => f.name.split('.').pop()).join(',') }); setPhase('idle'); setError("No closed trades found in this file. Download the P&L statement or tradebook for a period with closed trades, or check it isn't a scanned PDF."); }
  }

  /** PDFs are read on the page with pdf.js, loaded only when a PDF is dropped. */
  async function extractPdfs(list: { name: string; data: ArrayBuffer }[]): Promise<RawSheet[]> {
    if (!list.length) return [];
    const [pdfjs, XLSX, { fileToRawSheets }] = await Promise.all([
      // legacy build: compiled for broad browser support and for Next 14's minifier
      // @ts-ignore - no bundled types for this entry
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('xlsx'),
      // @ts-ignore - plain JS module
      import('@/lib/engine/extract.js'),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'; // static copy, see scripts/copy-pdf-worker.mjs
    const out: RawSheet[] = [];
    for (const f of list) out.push(...(await fileToRawSheets(XLSX, f.name, new Uint8Array(f.data), { pdfjs })));
    return out;
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(''); setReport(null); setPhase('idle');
    const next = [...files];
    for (const f of Array.from(list)) {
      const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
      if (!ACCEPTED_EXT.includes(ext)) { setError(`${f.name}: only ${ACCEPTED_EXT.join(', ')} files are accepted.`); continue; }
      if (f.size > MAX_FILE_BYTES) { setError(`${f.name} is over ${MAX_FILE_BYTES / 1048576}MB.`); continue; }
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
      if (next.length >= MAX_FILES) { setError(`Up to ${MAX_FILES} files per report.`); break; }
      next.push(f);
    }
    setFiles(next);
  }

  const ev = (name: string, props?: object) => { fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, props }) }).catch(() => {}); };
  async function analyze() {
    if (!files.length) return;
    ev('upload_started', { files: files.length });
    setPhase('analyzing'); setError('');
    try {
      const m = await withAnalysing(async () => {
        const bufs = await Promise.all(files.map((f) => f.arrayBuffer()));
        setHashes(await Promise.all(bufs.map(sha256)));
        const all = files.map((f, i) => ({ name: f.name, data: bufs[i] }));
        const isPdf = (f: { data: ArrayBuffer }) => new TextDecoder().decode(new Uint8Array(f.data).slice(0, 5)) === '%PDF-';
        const extracted = await extractPdfs(all.filter(isPdf));
        return ask({ type: 'analyze', files: all.filter((f) => !isPdf(f)), extracted, currency: currency || undefined });
      }, { fileCount: files.length });
      apply(m);
    } catch (e) {
      ev('upload_failed', { reason: String((e as Error).message || 'unreadable').slice(0, 80), ext: files.map((f) => f.name.split('.').pop()).join(',') });
      setError((e as Error).message || 'Could not read the file.'); setPhase('idle');
    }
  }

  async function save() {
    if (!report) return;
    setPhase('saving');
    const res = await fetch('/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report, fileNames: files.map((f) => f.name), fileHashes: hashes }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 201) { router.push(`/report/${data.id}`); router.refresh(); return; }
    setPhase('preview');
    setError(res.status === 402 ? 'You have no report credits left.' : data.message || 'Could not save the report.');
  }

  const fmt = (v: number) => { engine.setCurrency(report?.m.currency || 'INR'); return engine.inr(v); };

  return (
    <div>
      <div
        id="drop" className={over ? 'over' : ''} tabIndex={0} role="button" aria-label="Choose files"
        onClick={() => document.getElementById('file')?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('file')?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
      >
        <b>Drop up to {MAX_FILES} files</b>
        <span className="muted">1 file = one P&amp;L statement or tradebook from your broker · Excel, CSV, PDF or Word · 10MB each</span>
        <input id="file" type="file" accept={ACCEPTED_EXT.join(',')} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {files.length > 0 && (
        <ul className="filelist">
          {files.map((f, i) => (
            <li key={f.name + f.size}>
              <span>{f.name} <span className="muted">· {(f.size / 1024).toFixed(0)} KB</span></span>
              <button aria-label={`Remove ${f.name}`} onClick={() => { setFiles(files.filter((_, j) => j !== i)); setReport(null); setPhase('idle'); }}>×</button>
            </li>
          ))}
        </ul>
      )}

      <div className="filters" style={{ marginTop: 16, alignItems: 'center' }}>
        <label className="muted" style={{ fontSize: 13 }}>Currency&nbsp;
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
            <option value="">Detect automatically</option>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button className="btn" disabled={!files.length || phase === 'analyzing' || phase === 'saving'} onClick={analyze}>
          {phase === 'analyzing' ? 'Reading files…' : 'Analyse'}
        </button>
      </div>

      {error && <p className="status err" role="alert">{error}</p>}

      {(phase === 'preview' || phase === 'saving') && report && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Ready <small>{report.m.source === 'tradebook' ? 'trade-by-trade tradebook' : 'position-level statement'}</small></h3>
          <div className="tiles">
            <div className="panel tile"><div className="lab">Positions</div><div className="val">{report.m.n}</div></div>
            <div className="panel tile"><div className="lab">Period</div><div className="val" style={{ fontSize: 16 }}>{report.m.from || '—'}<br />{report.m.to || ''}</div></div>
            <div className="panel tile"><div className="lab">Market</div><div className="val" style={{ fontSize: 18 }}>{report.m.markets?.map((x) => x.market).join(' + ') || '—'}</div></div>
            <div className="panel tile"><div className="lab">Currency</div><div className="val" style={{ fontSize: 18 }}>{report.m.currency}</div></div>
          </div>
          <p className="note">{report.leaks.length} leaks and {report.rules.length} rules found. The full report, with every insight, cluster and export, opens once you save it. Totals: {fmt(report.m.net)} net.</p>
          {credits > 0 ? (
            <button className="btn" onClick={save} disabled={phase === 'saving'}>{phase === 'saving' ? 'Saving…' : `Open full report (uses 1 of ${credits} credits)`}</button>
          ) : (
            <a className="btn" href="/pricing">Buy a report credit</a>
          )}
        </div>
      )}
    </div>
  );
}
