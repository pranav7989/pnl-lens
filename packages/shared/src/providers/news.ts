/**
 * @file  packages/shared/src/providers/news.ts
 * @area  Desk
 * @what  Headlines provider interface for the Desk, the cleaner that keeps only title, source, link, time and category (never a body), the title key for the 6-hour dedupe, and a fake provider with clearly marked sample items.
 */
/**
 * News only (spec R2): a headline is a title, its source, a link and a time. Nothing else is stored or shown, so a
 * provider's summary, body or sentiment is dropped here. The real provider is chosen by the owner later
 * (NEWS_PROVIDER); until then `fake` serves sample items in development and `off` shows "not connected".
 */
export interface NewsItem { title: string; source: string; url: string; publishedAt: string | Date; category?: string | null }
export interface CleanHeadline { title: string; titleKey: string; source: string; url: string; publishedAt: Date; category: string | null }
export interface NewsProvider { name: string; fetch(since: Date, now: Date): Promise<NewsItem[]> }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const plain = (s: unknown, max: number) => String(s ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
  .replace(/\s+/g, ' ').trim().slice(0, max);

/** lower case, letters and digits only (any script): the same story from two feeds has the same key */
export const titleKey = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A provider item -> a storable headline, or null when it has no usable title, link or time. */
export function cleanHeadline(i: NewsItem, now = new Date()): CleanHeadline | null {
  const title = plain(i.title, 300), source = plain(i.source, 80) || 'Unknown source';
  let url: URL;
  try { url = new URL(String(i.url ?? '')); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const at = new Date(i.publishedAt);
  if (!title || Number.isNaN(at.getTime()) || at.getTime() > now.getTime() + 10 * 60_000) return null;   // no future-dated items
  const category = plain(i.category, 40) || null;
  return { title, titleKey: titleKey(title), source, url: url.toString().slice(0, 1000), publishedAt: at, category };
}

/** Development only: sample items, plainly labelled, on example.com links. */
export const fakeNews: NewsProvider = {
  name: 'fake',
  async fetch(_since, now) {
    const ago = (m: number) => new Date(now.getTime() - m * 60_000);
    return [
      { title: 'Sample headline: RBI keeps the repo rate unchanged', source: 'Sample feed', url: 'https://example.com/sample/rbi-policy', publishedAt: ago(35), category: 'policy' },
      { title: 'Sample headline: US markets close mixed overnight', source: 'Sample feed', url: 'https://example.com/sample/us-close', publishedAt: ago(320), category: 'global' },
      { title: 'Sample headline: Crude oil steady in Asian trade', source: 'Sample wire', url: 'https://example.com/sample/crude', publishedAt: ago(140), category: 'commodity' },
      { title: 'Sample headline: GST collections data due this week', source: 'Sample wire', url: 'https://example.com/sample/gst', publishedAt: ago(600), category: 'macro' },
    ];
  },
};

export function newsProvider(name: string | undefined): NewsProvider | null {
  return (name || 'off').trim().toLowerCase() === 'fake' ? fakeNews : null;
}
