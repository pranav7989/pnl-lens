/**
 * @file  packages/shared/test/desk-providers.test.ts
 * @area  Tests
 * @what  Desk providers: headlines keep only title/source/link/time/category (HTML stripped, bad links and future times refused), title keys for dedupe in any script; impact mapping; generated market-open/close, holiday and expiry rows follow the calendars (including the Sept 2025 Thursday -> Tuesday change), fakes are labelled.
 */
import { describe, it, expect } from 'vitest';
import { cleanHeadline, titleKey, fakeNews, newsProvider } from '../src/providers/news';
import { impactFrom, categoryFrom, generatedEvents, fakeEvents, eventsProvider, type CalendarRow } from '../src/providers/events';

const NOW = new Date('2026-11-25T03:00:00Z');

describe('headlines: news only', () => {
  it('keeps title, source, link, time and category; drops everything else', () => {
    const h = cleanHeadline({ title: ' <b>Markets</b> &amp; rupee  open flat ', source: 'Wire', url: 'https://news.example/a?b=1', publishedAt: '2026-11-25T02:00:00Z',
      category: 'markets', body: 'never stored', sentiment: 'bullish' } as any, NOW)!;
    expect(h).toEqual({ title: 'Markets & rupee open flat', titleKey: 'markets rupee open flat', source: 'Wire', url: 'https://news.example/a?b=1',
      publishedAt: new Date('2026-11-25T02:00:00Z'), category: 'markets' });
    expect(Object.keys(h)).not.toContain('body');
  });
  it('refuses unusable items', () => {
    const ok = { title: 'T', source: 'S', url: 'https://x.example/', publishedAt: '2026-11-25T02:00:00Z' };
    expect(cleanHeadline({ ...ok, url: 'javascript:alert(1)' }, NOW)).toBeNull();
    expect(cleanHeadline({ ...ok, url: 'not a url' }, NOW)).toBeNull();
    expect(cleanHeadline({ ...ok, title: '<p> </p>' }, NOW)).toBeNull();
    expect(cleanHeadline({ ...ok, publishedAt: 'yesterday' }, NOW)).toBeNull();
    expect(cleanHeadline({ ...ok, publishedAt: '2026-11-25T05:00:00Z' }, NOW)).toBeNull();       // two hours in the future
    expect(cleanHeadline({ ...ok, title: 'x'.repeat(400) }, NOW)!.title).toHaveLength(300);
  });
  it('the same story from two feeds has the same key, in any script', () => {
    expect(titleKey('RBI keeps repo rate at 6.5%')).toBe(titleKey('RBI Keeps Repo Rate At 6.5 %!'));
    expect(titleKey('सेंसेक्स 300 अंक चढ़ा')).not.toBe(titleKey('निफ्टी 100 अंक गिरा'));
    expect(titleKey('सेंसेक्स 300 अंक चढ़ा')).not.toBe('');
  });
  it('the fake is labelled and only used when asked for', async () => {
    const items = await fakeNews.fetch(new Date(NOW.getTime() - 864e5), NOW);
    expect(items.every((i) => i.title.startsWith('Sample headline:') && i.url.startsWith('https://example.com/'))).toBe(true);
    expect(newsProvider('fake')).toBe(fakeNews);
    expect(newsProvider(undefined)).toBeNull();
    expect(newsProvider('off')).toBeNull();
  });
});

describe('events', () => {
  it('impact mapping', () => {
    expect([3, '3', 'High', '***'].map(impactFrom)).toEqual(['high', 'high', 'high', 'high']);
    expect([2, 'medium', 'Moderate'].map(impactFrom)).toEqual(['medium', 'medium', 'medium']);
    expect([1, 'low', null, 'whatever'].map(impactFrom)).toEqual(['low', 'low', 'low', 'low']);
    expect([categoryFrom('macro'), categoryFrom('sports')]).toEqual(['macro', 'other']);
  });

  const day = (d: string, extra: Partial<CalendarRow> = {}): CalendarRow =>
    ({ day: d, segment: 'equity', exchange: 'NSE', is_holiday: false, open: '09:15:00', close: '15:30:00', note: null, ...extra });

  it('market open and close, or the holiday', () => {
    const ev = generatedEvents([day('2026-11-23'), day('2026-11-24', { is_holiday: true, open: null, close: null, note: 'Guru Nanak Jayanti' }),
      { ...day('2026-11-23'), segment: 'commodity', exchange: 'MCX', close: '23:55:00' }], []);
    expect(ev.map((e) => [e.sourceId, e.at, e.title, e.impact])).toEqual([
      ['open:2026-11-23', '09:15', 'Market open', 'info'], ['close:2026-11-23', '15:30', 'Market close', 'info'],
      ['holiday:2026-11-24', null, 'Market holiday: Guru Nanak Jayanti', 'info'],
    ]);
  });

  it('expiries come from the calendar, never from weekday names (Thursday before Sept 2025, Tuesday after)', () => {
    const ev = generatedEvents([day('2025-08-28'), day('2025-09-30')], [
      { underlying: 'NIFTY', exchange: 'NSE', expiry: '2025-08-28', kind: 'monthly' },       // a Thursday
      { underlying: 'NIFTY', exchange: 'NSE', expiry: '2025-09-30', kind: 'monthly' },       // a Tuesday
      { underlying: 'SENSEX', exchange: 'BSE', expiry: '2025-09-25', kind: 'weekly' },
      { underlying: 'STOCKS', exchange: 'NSE', expiry: '2025-09-30', kind: 'monthly' },
    ]).filter((e) => e.impact === 'expiry');
    expect(ev.map((e) => [e.day, new Date(`${e.day}T12:00:00Z`).getUTCDay(), e.title, e.at])).toEqual([
      ['2025-08-28', 4, 'Nifty monthly expiry', '15:30'],
      ['2025-09-30', 2, 'Nifty monthly expiry', '15:30'],
      ['2025-09-25', 4, 'Sensex weekly expiry (BSE)', '15:30'],
      ['2025-09-30', 2, 'Stock F&O monthly expiry', '15:30'],
    ]);
    expect(new Set(ev.map((e) => e.sourceId)).size).toBe(4);
  });

  it('the fake is labelled and only used when asked for', async () => {
    const ev = await fakeEvents.fetch('2026-11-25', '2026-12-09');
    expect(ev.every((e) => e.title.startsWith('Sample event:'))).toBe(true);
    expect(ev.map((e) => e.impact)).toEqual(['high', 'medium', 'high']);
    expect(eventsProvider('FAKE')).toBe(fakeEvents);
    expect(eventsProvider('')).toBeNull();
  });
});
