'use client';
/**
 * @file  apps/web/components/workspace/ReportList.tsx
 * @area  Reports
 * @what  Dashboard report list: search (name, files, month, market, dates), sort (newest, oldest, name), clear cards with trades and net P&L, always-visible Rename.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { engine } from '@pnl-lens/engine';
import { api } from '@/lib/api-browser';
import { RenameRow } from './History';
import { monthTag, reportName, type HistoryItem } from './model';

type Sort = 'new' | 'old' | 'name';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const money = (v: number, cur?: string | null) => { engine.setCurrency(cur || 'INR'); return engine.inr(v) as string; };

/** Everything a person might type to find a report. */
function haystack(r: HistoryItem, title: string | null) {
  const d = new Date(r.createdAt);
  return [reportName({ title, createdAt: r.createdAt }), ...r.fileNames, r.monthLabel || monthTag(r.createdAt), MONTHS[d.getMonth()], String(d.getFullYear()),
    r.market || '', r.to || ''].join(' ').toLowerCase();
}

export default function ReportList({ reports }: { reports: HistoryItem[] }) {
  const router = useRouter();
  const [q, setQ] = useState(''), [sort, setSort] = useState<Sort>('new');
  const [editing, setEditing] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string | null>>({});
  const titleOf = (r: HistoryItem) => (r.id in titles ? titles[r.id] : r.title);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = reports.filter((r) => { const h = haystack(r, titleOf(r)); return words.every((w) => h.includes(w)); });
    return list.sort((a, b) => sort === 'old' ? a.createdAt.localeCompare(b.createdAt)
      : sort === 'name' ? reportName({ title: titleOf(a), createdAt: a.createdAt }).localeCompare(reportName({ title: titleOf(b), createdAt: b.createdAt }))
      : b.createdAt.localeCompare(a.createdAt));
  }, [reports, q, sort, titles]);

  async function save(id: string, value: string) {
    const v = value.replace(/\s+/g, ' ').trim().slice(0, 60);
    setTitles((t) => ({ ...t, [id]: v || null })); setEditing(null);
    try { await api(`/reports/${id}`, { method: 'PATCH', body: { title: v || null } }); } finally { router.refresh(); }
  }

  const groups: { key: string; items: HistoryItem[] }[] = [];
  for (const r of shown) {
    const key = sort === 'name' ? '' : r.monthLabel || monthTag(r.createdAt);
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.items.push(r); else groups.push({ key, items: [r] });
  }

  return (
    <div className="rl" data-report-list>
      <div className="rl-bar">
        <input className="field rl-search" type="search" placeholder="Search reports" aria-label="Search reports" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="rl-sort" aria-label="Sort reports" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="new">Newest</option><option value="old">Oldest</option><option value="name">Name A–Z</option>
        </select>
      </div>
      <p className="rl-count muted small" aria-live="polite">{q ? `${shown.length} of ${reports.length} reports` : `${reports.length} report${reports.length === 1 ? '' : 's'}`}</p>
      {!shown.length && <p className="rl-empty">No reports match “{q}”.</p>}
      {groups.map((g, gi) => (
        <div className="rl-group" key={g.key + gi}>
          {g.key && <div className="ws-hist-m">{g.key}<span>{g.items.length}</span></div>}
          {g.items.map((r) => {
            const title = titleOf(r), name = reportName({ title, createdAt: r.createdAt });
            if (editing === r.id) return <RenameRow key={r.id} initial={title || ''} placeholder={name} onDone={(v) => (v === null ? setEditing(null) : save(r.id, v))} />;
            return (
              <div className="rl-card" key={r.id} data-report={r.id}>
                <button className="rl-open" onClick={() => router.push(`/report/${r.id}`)} aria-label={`Open ${name}`}>
                  <span className={`rl-name${title ? '' : ' auto'}`}>{name}</span>
                  <span className="rl-files">{r.fileNames.join(', ') || 'No statements yet'}</span>
                  <span className="rl-meta">
                    {r.tradeCount != null && <>{r.tradeCount} trade{r.tradeCount === 1 ? '' : 's'}</>}
                    {r.netPnl != null && <> · Net <b className={r.netPnl < 0 ? 'loss' : 'gain'}>{money(r.netPnl, r.currency)}</b></>}
                    {r.progressScore != null && <> · Progress {Math.round(r.progressScore)}</>}
                  </span>
                </button>
                <button className="btn ghost rl-ren" onClick={() => setEditing(r.id)} aria-label={`Rename ${name}`}>✎ Rename</button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
