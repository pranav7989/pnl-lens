/**
 * @file  packages/shared/src/providers/events.ts
 * @area  Desk
 * @what  Scheduled-events provider interface for the Desk, impact mapping (provider importance -> HIGH/MED/LOW), the generator of market-open/close, holiday and expiry rows from the market and expiry calendars, and a fake provider with clearly marked sample events.
 */
/**
 * Events are scheduled facts (a policy decision at 10:00, results after the close), never a view. Expiry rows come
 * from the expiry calendar (the contracts themselves), never from weekday names (spec R5): when an exchange moves the
 * expiry day, as NSE did in September 2025, the rows follow the data.
 */
export type Impact = 'high' | 'medium' | 'low' | 'expiry' | 'info';
export type EventCategory = 'macro' | 'policy' | 'results' | 'market' | 'expiry' | 'holiday' | 'global' | 'other';
export const CATEGORIES: EventCategory[] = ['macro', 'policy', 'results', 'market', 'expiry', 'holiday', 'global', 'other'];
export const IMPACT_LABEL: Record<Impact, string> = { high: 'HIGH', medium: 'MED', low: 'LOW', expiry: 'EXPIRY', info: 'INFO' };

export interface EventItem {
  sourceId: string;
  day: string;             // YYYY-MM-DD (IST)
  at: string | null;       // HH:MM IST, null = all day
  title: string;
  impact: Impact;
  category: EventCategory;
  country?: string;
}
export interface EventsProvider { name: string; fetch(from: string, to: string): Promise<EventItem[]> }

/** Provider importance (1-3, words, or stars) -> our impact. Unknown -> low. */
export function impactFrom(x: unknown): Impact {
  const s = String(x ?? '').trim().toLowerCase();
  if (['3', 'high', 'h', '***', 'major'].includes(s)) return 'high';
  if (['2', 'medium', 'med', 'm', 'moderate', '**'].includes(s)) return 'medium';
  return 'low';
}
export const categoryFrom = (x: unknown): EventCategory => (CATEGORIES as string[]).includes(String(x)) ? (x as EventCategory) : 'other';

export interface CalendarRow { day: string; segment: string; exchange: string; is_holiday: boolean; open: string | null; close: string | null; note: string | null }
export interface ExpiryRow { underlying: string; exchange: string; expiry: string; kind: 'weekly' | 'monthly' }

const NAMES: Record<string, string> = { NIFTY: 'Nifty', BANKNIFTY: 'Bank Nifty', FINNIFTY: 'Fin Nifty', MIDCPNIFTY: 'Midcap Nifty', SENSEX: 'Sensex', BANKEX: 'Bankex', STOCKS: 'Stock F&O' };

/** Market open/close (or the holiday) for NSE equity and the expiries of each day, as events. */
export function generatedEvents(calendar: CalendarRow[], expiries: ExpiryRow[]): EventItem[] {
  const out: EventItem[] = [];
  const eq = new Map(calendar.filter((c) => c.segment === 'equity' && c.exchange === 'NSE').map((c) => [c.day, c]));
  for (const c of [...eq.values()].sort((a, b) => (a.day < b.day ? -1 : 1))) {
    if (c.is_holiday) {
      out.push({ sourceId: `holiday:${c.day}`, day: c.day, at: null, title: `Market holiday${c.note ? `: ${c.note}` : ''}`, impact: 'info', category: 'holiday' });
      continue;
    }
    if (c.open) out.push({ sourceId: `open:${c.day}`, day: c.day, at: c.open.slice(0, 5), title: 'Market open', impact: 'info', category: 'market' });
    if (c.close) out.push({ sourceId: `close:${c.day}`, day: c.day, at: c.close.slice(0, 5), title: 'Market close', impact: 'info', category: 'market' });
  }
  for (const e of expiries) {
    const close = eq.get(e.expiry)?.close?.slice(0, 5) ?? '15:30';
    const name = NAMES[e.underlying] ?? e.underlying;
    const title = e.underlying === 'STOCKS' ? 'Stock F&O monthly expiry' : `${name} ${e.kind} expiry${e.exchange === 'BSE' ? ' (BSE)' : ''}`;
    out.push({ sourceId: `expiry:${e.exchange}:${e.underlying}:${e.expiry}`, day: e.expiry, at: close, title, impact: 'expiry', category: 'expiry' });
  }
  return out;
}

/** Development only: sample events, plainly labelled. */
export const fakeEvents: EventsProvider = {
  name: 'fake',
  async fetch(from) {
    return [
      { sourceId: `sample-cpi-${from}`, day: from, at: '10:30', title: 'Sample event: India CPI inflation data', impact: impactFrom(3), category: 'macro', country: 'IN' },
      { sourceId: `sample-pmi-${from}`, day: from, at: '12:30', title: 'Sample event: Services PMI', impact: impactFrom(2), category: 'macro', country: 'IN' },
      { sourceId: `sample-fed-${from}`, day: from, at: '23:30', title: 'Sample event: US Fed minutes', impact: impactFrom('high'), category: 'global', country: 'US' },
    ];
  },
};

export function eventsProvider(name: string | undefined): EventsProvider | null {
  return (name || 'off').trim().toLowerCase() === 'fake' ? fakeEvents : null;
}
