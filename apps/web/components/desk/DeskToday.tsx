/**
 * @file  apps/web/components/desk/DeskToday.tsx
 * @area  Pages
 * @what  Desk cards for signed-in traders: Scheduled events (time, title, HIGH/MED/EXPIRY tag, the day's timeline with a now marker) and Overnight headlines (news only, links open in a new tab, "unavailable · last updated" when the feed is down); refreshed every 60 s.
 */
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-browser';

type Impact = 'high' | 'medium' | 'low' | 'expiry' | 'info';
export interface DeskTodayData {
  date: string; label: string; time: string;
  session: { state: string; label: string; note: string | null };
  events: { id: number; at: string | null; title: string; impact: Impact; category: string; country: string }[];
  headlines: { state: 'ok' | 'unavailable' | 'off'; since: string; lastUpdated: string | null;
    items: { title: string; source: string; url: string; category: string | null; publishedAt: string }[] };
}

const TAG: Record<Impact, string> = { high: 'HIGH', medium: 'MED', low: 'LOW', expiry: 'EXPIRY', info: '' };
const IST = { timeZone: 'Asia/Kolkata' } as const;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { ...IST, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const when = (iso: string, today: string) => {
  const d = new Date(iso).toLocaleDateString('en-CA', IST);
  return d === today ? hhmm(iso) : `${new Date(iso).toLocaleDateString('en-GB', { ...IST, weekday: 'short' })} ${hhmm(iso)}`;
};
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const OPEN = 9 * 60 + 15, CLOSE = 15 * 60 + 30;

function Timeline({ data }: { data: DeskTodayData }) {
  if (data.session.state === 'holiday') return <p className="muted small desk-tl-note">Market holiday{data.session.note ? `: ${data.session.note}` : ''}</p>;
  const pos = (m: number) => `${Math.min(98.5, Math.max(1.5, ((m - OPEN) / (CLOSE - OPEN)) * 100))}%`;
  const now = mins(data.time), inside = data.events.filter((e) => e.at && mins(e.at) >= OPEN && mins(e.at) <= CLOSE && e.impact !== 'info');
  return (
    <div className="desk-tl" aria-hidden="true" data-desk-timeline>
      <div className="desk-tl-bar">
        {inside.map((e) => <i key={e.id} className={`desk-tl-dot ${e.impact}`} style={{ left: pos(mins(e.at!)) }} title={`${e.at} ${e.title}`} />)}
        {now >= OPEN && now <= CLOSE && <b className="desk-tl-now" style={{ left: pos(now) }} />}
      </div>
      <div className="desk-tl-ends"><span>09:15</span><span>12:00</span><span>15:30</span></div>
    </div>
  );
}

export default function DeskToday({ initial }: { initial: DeskTodayData }) {
  const [data, setData] = useState(initial);
  useEffect(() => {
    const t = setInterval(() => { api<DeskTodayData>('/desk/today').then(setData).catch(() => {}); }, 60_000);
    return () => clearInterval(t);
  }, []);
  const h = data.headlines;

  return (
    <div className="desk-today">
      <section className="panel" aria-labelledby="desk-ev-h" data-desk-events>
        <div className="rv-ph"><h3 id="desk-ev-h">Scheduled events</h3><small>Today · IST</small></div>
        <Timeline data={data} />
        {data.events.length ? (
          <ul className="desk-ev">
            {data.events.map((e) => (
              <li key={e.id} data-impact={e.impact}>
                <span className="desk-ev-t">{e.at ?? 'All day'}</span>
                <span className="desk-ev-title">{e.title}{e.country !== 'IN' && <small> · {e.country}</small>}</span>
                {TAG[e.impact] && <span className={`desk-tag ${e.impact}`}>{TAG[e.impact]}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="muted small">No scheduled events today.</p>}
      </section>

      <section className="panel" aria-labelledby="desk-hl-h" data-desk-headlines>
        <div className="rv-ph"><h3 id="desk-hl-h">Overnight headlines</h3><small><span className="desk-badge">News only · no views</span></small></div>
        {h.state === 'off' ? <p className="muted small">Headlines are not connected yet.</p>
          : h.state === 'unavailable' && !h.items.length ? <p className="muted small" data-desk-headlines-down>Headlines unavailable{h.lastUpdated ? ` · last updated ${hhmm(h.lastUpdated)}` : ''}</p>
            : (
              <>
                {h.state === 'unavailable' && <p className="muted small" data-desk-headlines-down>Headlines unavailable{h.lastUpdated ? ` · last updated ${hhmm(h.lastUpdated)}` : ''}</p>}
                {h.items.length ? (
                  <ul className="desk-hl">
                    {h.items.map((i) => (
                      <li key={i.url}>
                        <a href={i.url} target="_blank" rel="noopener noreferrer nofollow">{i.title}</a>
                        <span className="desk-hl-meta">{i.source} · {when(i.publishedAt, data.date)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted small">No headlines since the last close.</p>}
              </>
            )}
      </section>
    </div>
  );
}
