/**
 * @file  apps/web/components/workspace/Journal.tsx
 * @area  Reports
 * @what  "Journal" tab: write a setup, tags, emotion and a note on each trade (biggest first); see what the journal shows: results by setup, tag and emotion, best and worst. Notes follow the trade into every report.
 */
'use client';
import { useEffect, useMemo, useState } from 'react';
import { tradeKey } from '@pnl-lens/shared/insights/lifetime';
import { journalStats, EMOTION_LABEL, type NoteLike, type Group } from '@pnl-lens/shared/insights/journal';
import { api, type ApiError } from '@/lib/api-browser';

type Note = NoteLike & { updatedAt?: string };
const EMOTIONS = Object.keys(EMOTION_LABEL);
const PAGE = 30;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso?: string | null) => (iso ? `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}` : '');

function Groups({ title, rows, money }: { title: string; rows: Group[]; money: (v: number) => string }) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));
  return (
    <div className="jr-groups">
      <h4>{title}</h4>
      <ul className="eg-buckets">{rows.map((r) => (
        <li key={r.key}><span className="k">{r.key}</span><span className="eg-bt"><i className={r.pnl >= 0 ? 'up' : 'down'} style={{ width: `${(Math.abs(r.pnl) / max) * 100}%` }} /></span>
          <b className={r.pnl >= 0 ? 'gain' : 'loss'}>{money(r.pnl)}</b><small>{r.n} trade{r.n === 1 ? '' : 's'} · {Math.round(r.winRate * 100)}% won · {money(r.avg)} a trade</small></li>
      ))}</ul>
    </div>
  );
}

function Editor({ trade, note, setups, tags, money, onSave, onClose }: {
  trade: any; note: Note | null; setups: string[]; tags: string[]; money: (v: number) => string;
  onSave: (n: Note | null) => void; onClose: () => void;
}) {
  const key = tradeKey(trade);
  const [setup, setSetup] = useState(note?.setup || ''), [emotion, setEmotion] = useState<string | null>(note?.emotion || null);
  const [tagList, setTagList] = useState<string[]>(note?.tags || []), [tagText, setTagText] = useState(''), [text, setText] = useState(note?.note || '');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const addTag = (t: string) => { const v = t.trim().toLowerCase().slice(0, 30); if (v && !tagList.includes(v) && tagList.length < 8) setTagList([...tagList, v]); setTagText(''); };
  async function save(clear = false) {
    setBusy(true); setErr('');
    try {
      const body = clear ? { tradeKey: key, setup: null, tags: [], emotion: null, note: null } : { tradeKey: key, setup: setup || null, tags: tagText.trim() ? [...tagList, tagText.trim().toLowerCase()] : tagList, emotion, note: text || null };
      const r = await api<{ note: Note | null }>('/me/journal', { method: 'PUT', body });
      onSave(r.note);
    } catch (e) { setErr((e as ApiError).message || 'Could not save.'); } finally { setBusy(false); }
  }
  const sugg = tags.filter((t) => !tagList.includes(t)).slice(0, 8);
  return (
    <div className="jr-editor" data-journal-editor>
      <div className="jr-ed-h"><b>{trade.symbol}</b><span>{dayLabel(trade.entryDate || trade.exitDate)}</span><b className={trade.pnl >= 0 ? 'gain' : 'loss'}>{money(trade.pnl)}</b></div>
      <label className="jr-field"><span>Setup</span>
        <input value={setup} onChange={(e) => setSetup(e.target.value.slice(0, 60))} list="jr-setups" placeholder="e.g. Breakout, Gap fill, Expiry scalp" aria-label="Setup" />
        <datalist id="jr-setups">{setups.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <div className="jr-field"><span>Tags</span>
        <div className="rw-chips">
          {tagList.map((t) => <button key={t} type="button" className="rw-chip on" onClick={() => setTagList(tagList.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>{t} ×</button>)}
          <input className="jr-tag-in" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder={tagList.length < 8 ? 'Add a tag, press Enter' : '8 tags at most'} aria-label="Add a tag"
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagText); } }} disabled={tagList.length >= 8} />
        </div>
        {sugg.length > 0 && <div className="rw-chips jr-sugg">{sugg.map((t) => <button key={t} type="button" className="rw-chip" onClick={() => addTag(t)}>+ {t}</button>)}</div>}
      </div>
      <div className="jr-field"><span>How you felt</span>
        <div className="rw-chips">{EMOTIONS.map((e) => <button key={e} type="button" className={`rw-chip${emotion === e ? ' on' : ''}`} aria-pressed={emotion === e} onClick={() => setEmotion(emotion === e ? null : e)}>{EMOTION_LABEL[e]}</button>)}</div>
      </div>
      <label className="jr-field"><span>Note</span>
        <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 1000))} rows={3} placeholder="Why you took it, what you would do differently" aria-label="Note" />
      </label>
      {err && <p className="status err">{err}</p>}
      <div className="jr-ed-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => save()}>{busy ? 'Saving…' : 'Save'}</button>
        {note && <button type="button" className="btn ghost btn-danger-quiet" disabled={busy} onClick={() => save(true)}>Remove note</button>}
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export default function Journal({ report, money, active }: { report: any; money: (v: number) => string; active: boolean }) {
  const trades: any[] = useMemo(() => (report?.trades || []).filter((t: any) => Number.isFinite(t?.pnl)).sort((a: any, b: any) => Math.abs(b.pnl) - Math.abs(a.pnl)), [report]);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'all' | 'todo' | 'done'>('all'), [q, setQ] = useState(''), [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!active || notes) return;
    api<{ notes: Note[] }>('/me/journal').then((r) => setNotes(r.notes)).catch((e) => setErr((e as ApiError).message || 'Could not load your journal.'));
  }, [active, notes]);
  const byKey = useMemo(() => new Map((notes || []).map((n) => [n.tradeKey, n])), [notes]);
  const stats = useMemo(() => journalStats(trades, notes || []), [trades, notes]);
  const setups = useMemo(() => [...new Set((notes || []).map((n) => n.setup).filter(Boolean) as string[])].sort(), [notes]);
  const tags = useMemo(() => { const c = new Map<string, number>(); for (const n of notes || []) for (const t of n.tags) c.set(t, (c.get(t) || 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t); }, [notes]);
  if (!active && !notes) return null;
  if (err) return <div className="rv-panel"><p className="status err">{err}</p></div>;
  if (!notes) return <div className="rv-panel"><p className="rv-empty">Loading your journal…</p></div>;

  const list = trades.filter((t) => {
    const has = byKey.has(tradeKey(t));
    return (filter === 'all' || (filter === 'done' ? has : !has)) && (!q || String(t.symbol).toUpperCase().includes(q.trim().toUpperCase()));
  });
  const onSaved = (key: string, n: Note | null) => { setNotes((cur) => [...(cur || []).filter((x) => x.tradeKey !== key), ...(n ? [n] : [])]); setOpen(null); };
  const share = stats.total ? stats.journaled / stats.total : 0;

  return (
    <div className="rv-grid jr" data-journal>
      <div className="rv-panel s12 jr-head">
        <div className="rv-ph"><h3>Your trade journal</h3><small>private to you · notes follow each trade into every report</small></div>
        <div className="jr-progress"><b data-journaled>{stats.journaled} of {stats.total}</b><span>trades journaled</span><div className="pc-bar"><i style={{ width: `${Math.round(share * 100)}%` }} /></div></div>
        {stats.journaled === 0
          ? <p className="rv-note">Start with your biggest trades (listed first): give each a setup, a tag or two and how you felt. After a few, this page shows which setups and moods make or lose you money.</p>
          : (stats.best || stats.worst) && (
            <div className="jr-high" data-journal-highlights>
              {stats.best && <p><span className="gain">Working:</span> {stats.best.kind} <b>“{stats.best.key}”</b> made {money(stats.best.pnl)} over {stats.best.n} trades.</p>}
              {stats.worst && <p><span className="loss">Costing you:</span> {stats.worst.kind} <b>“{stats.worst.key}”</b> lost {money(stats.worst.pnl)} over {stats.worst.n} trades.</p>}
            </div>
          )}
      </div>

      {stats.journaled > 0 && (
        <div className="rv-panel s12 jr-stats" data-journal-stats>
          <div className="rv-ph"><h3>What your journal shows</h3><small>journaled trades in this report</small></div>
          <div className="jr-gcols">
            <Groups title="By setup" rows={stats.bySetup} money={money} />
            <Groups title="By tag" rows={stats.byTag} money={money} />
            <Groups title="By how you felt" rows={stats.byEmotion} money={money} />
          </div>
        </div>
      )}

      <div className="rv-panel s12">
        <div className="rv-ph"><h3>Trades</h3><small>biggest first</small></div>
        <div className="rv-filters jr-filters">
          <input type="search" placeholder="Search symbol" aria-label="Search symbol" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
          <div className="rw-chips">{([['all', 'All'], ['todo', 'Not journaled'], ['done', 'Journaled']] as const).map(([k, l]) => (
            <button key={k} type="button" className={`rw-chip${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => { setFilter(k); setShown(PAGE); }}>{l}</button>
          ))}</div>
        </div>
        <ul className="jr-list">{list.slice(0, shown).map((t, i) => {
          const key = tradeKey(t), n = byKey.get(key) || null, isOpen = open === key;
          return (
            <li key={key + ':' + i} className={isOpen ? 'open' : ''} data-trade={t.symbol}>
              <div className="jr-row">
                <div className="jr-sym"><b>{t.symbol}</b><small>{dayLabel(t.entryDate || t.exitDate)}{t.group ? ` · ${t.group}` : ''}</small></div>
                <div className="jr-meta">
                  {n?.setup && <span className="jr-pill setup">{n.setup}</span>}
                  {n?.tags.map((g) => <span key={g} className="jr-pill">{g}</span>)}
                  {n?.emotion && <span className="jr-pill mood">{EMOTION_LABEL[n.emotion] || n.emotion}</span>}
                  {n?.note && <span className="jr-note" title={n.note}>“{n.note.length > 60 ? n.note.slice(0, 60) + '…' : n.note}”</span>}
                </div>
                <b className={`jr-pnl ${t.pnl >= 0 ? 'gain' : 'loss'}`}>{money(t.pnl)}</b>
                <button type="button" className="btn ghost jr-edit" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>{n ? 'Edit' : 'Add note'}</button>
              </div>
              {isOpen && <Editor trade={t} note={n} setups={setups} tags={tags} money={money} onSave={(x) => onSaved(key, x)} onClose={() => setOpen(null)} />}
            </li>
          );
        })}</ul>
        {list.length === 0 && <p className="rv-empty">No trades match.</p>}
        {list.length > shown && <button type="button" className="btn ghost jr-more" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>}
      </div>
    </div>
  );
}
