/**
 * @file  apps/web/components/workspace/History.tsx
 * @area  Reports
 * @what  Report history (report page sidebar) grouped by month (MON-YY) with Progress score and an always-visible rename (PATCH /api/v1/reports/:id); RenameRow is shared with the dashboard list.
 */
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-browser';
import { dayLabel, monthTag, type HistoryItem } from './model';

export default function History({ reports, currentId }: { reports: HistoryItem[]; currentId?: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string | null>>({});
  if (!reports.length) return <div className="ws-hist"><p className="ws-hist-empty">Your reports will appear here, grouped by month.</p></div>;

  const list = [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groups: Record<string, HistoryItem[]> = {}, order: string[] = [];
  for (const r of list) { const k = r.monthLabel || monthTag(r.createdAt); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(r); }

  async function save(id: string, value: string) {
    const v = value.replace(/\s+/g, ' ').trim().slice(0, 60);
    setTitles((t) => ({ ...t, [id]: v || null })); setEditing(null);
    try { await api(`/reports/${id}`, { method: 'PATCH', body: { title: v || null } }); router.refresh(); } catch { router.refresh(); }
  }

  return (
    <div className="ws-hist">
      {order.map((k) => (
        <div className="ws-hist-g" key={k}>
          <div className="ws-hist-m">{k}<span>{groups[k].length}</span></div>
          {groups[k].map((r) => {
            const names = r.fileNames.join(', ') || 'No statements yet';
            const title = r.id in titles ? titles[r.id] : r.title;
            if (editing === r.id) return <RenameRow key={r.id} initial={title || ''} placeholder={names || 'Report name'} onDone={(v) => (v === null ? setEditing(null) : save(r.id, v))} />;
            return (
              <div className={`ws-hist-i${currentId === r.id ? ' cur' : ''}`} key={r.id}>
                <button className="ws-hist-open" title={title ? title + ' — ' + names : names} onClick={() => router.push(`/report/${r.id}`)}>
                  <span className="d" suppressHydrationWarning>{dayLabel(r.createdAt)}</span>
                  <span className={`n${title ? ' named' : ''}`}>{title || names}</span>
                  <span className="s">{r.progressScore != null ? Math.round(r.progressScore) : '–'}</span>
                </button>
                <button className="ws-hist-ren" aria-label="Rename report" title="Rename" onClick={(e) => { e.stopPropagation(); setEditing(r.id); }}>✎</button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function RenameRow({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  let done = false;
  const finish = (save: boolean) => { if (done) return; done = true; onDone(save ? v : null); };
  return (
    <div className="ws-hist-i">
      <div className="ws-hist-edit">
        <input autoFocus maxLength={60} value={v} placeholder={placeholder} aria-label="Report name" onFocus={(e) => e.target.select()}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } }}
          onBlur={() => setTimeout(() => finish(true), 120)} />
        <button title="Save" onMouseDown={(e) => { e.preventDefault(); finish(true); }}>✓</button>
      </div>
    </div>
  );
}
