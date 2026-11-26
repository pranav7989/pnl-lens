/**
 * @file  packages/shared/src/desk/session.ts
 * @area  Desk
 * @what  Desk session state (spec B2.7): pre-open / open / closed / holiday for a segment from the market calendar row of the day, in IST; plus the header date line.
 */
export type SessionState = 'pre_open' | 'open' | 'closed' | 'holiday';
export interface CalendarDay { is_holiday: boolean; pre_open: string | null; open: string | null; close: string | null; note?: string | null }

const hm = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);

/** IST wall clock pieces of an instant. */
export function istParts(at: Date): { day: string; minutes: number; weekday: string; label: string } {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const label = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(at).replace(/,/g, '');
  return { day, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday, label };
}

/** No calendar row (weekend or a day not loaded) counts as closed. */
export function sessionState(row: CalendarDay | null | undefined, minutes: number): SessionState {
  if (!row) return 'closed';
  if (row.is_holiday) return 'holiday';
  const pre = hm(row.pre_open), open = hm(row.open), close = hm(row.close);
  if (open == null || close == null) return 'closed';
  if (pre != null && minutes >= pre && minutes < open) return 'pre_open';
  if (minutes >= open && minutes < close) return 'open';
  return 'closed';
}

export const SESSION_LABEL: Record<SessionState, string> = { pre_open: 'Pre-open', open: 'Open', closed: 'Closed', holiday: 'Market holiday' };
