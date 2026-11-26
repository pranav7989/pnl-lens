/**
 * @file  apps/web/lib/blog.ts
 * @area  Blog
 * @what  REQ-7 blog data for server components: which site (India/Global) the visitor sees, public posts from the API, image URLs, dates in IST.
 */
/**
 * Public blog reads go to the API without the visitor's cookie (the data is the same for everyone). They are not
 * cached here, so a post that is published, scheduled-and-due or unpublished shows (or disappears) on the next
 * request — well inside REQ-7's "within 1 minute". Bodies arrive as HTML already made safe by the API.
 */
import { cache } from 'react';
import { requestCountry } from '@/lib/auth/country';
import { regionFor, type Region } from '@pnl-lens/shared/pricing';

export type BlogSite = 'india' | 'global';
export const SITE_URL = (process.env.APP_URL || 'https://pnllens.com').replace(/\/$/, '');

export interface BlogCard {
  slug: string; title: string; excerpt: string; cover_key: string | null; cover_alt: string | null; tags: string[];
  reading_minutes: number; published_at: string; updated_at: string;
}
export interface BlogPost extends BlogCard {
  id: string; body_html: string; site: 'india' | 'global' | 'both'; seo_title: string | null; meta_description: string | null;
  canonical_url: string | null; noindex: boolean;
}
export interface BlogList { posts: BlogCard[]; total: number; page: number; pages: number }
export interface FeedItem { slug: string; title: string; excerpt: string; site: string; noindex: boolean; published_at: string; updated_at: string }

/** The site follows the visitor's country (as on the landing page); ?region=in|global switches it. */
export async function blogRegion(regionParam?: string): Promise<{ region: Region; site: BlogSite }> {
  const forced = regionParam === 'in' ? 'IN' : regionParam === 'global' ? 'US' : null;
  const region = regionFor(forced || (await requestCountry()));
  return { region, site: region === 'IN' ? 'india' : 'global' };
}

async function get<T>(path: string): Promise<{ status: number; data: T | null }> {
  const base = (process.env.API_INTERNAL_URL || 'http://api:4000').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/v1${path}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
    return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
  } catch {
    return { status: 503, data: null };
  }
}

export const listPosts = async (site: BlogSite, o: { tag?: string; page?: number } = {}) => {
  const q = new URLSearchParams({ site, page: String(o.page || 1) }); if (o.tag) q.set('tag', o.tag);
  return (await get<BlogList>(`/blog/posts?${q}`)).data ?? { posts: [], total: 0, page: 1, pages: 1 };
};
export const listTags = async (site: BlogSite) => (await get<{ tags: { tag: string; n: number }[] }>(`/blog/tags?site=${site}`)).data?.tags ?? [];
/** One API call per request: the page and its metadata share it (React cache). */
export const getPost = cache(async (slug: string, site: BlogSite) =>
  (await get<{ post?: BlogPost; redirect?: string }>(`/blog/posts/${encodeURIComponent(slug)}?site=${site}`)).data);
export const feed = async (site: BlogSite) => (await get<{ posts: FeedItem[] }>(`/blog/feed?site=${site}`)).data?.posts ?? [];

/** Uploaded covers are WebP; `<key>-og.webp` is the 1200×630 crop used for cards, the article header and social cards. */
export const mediaUrl = (key: string) => `/api/v1/blog/media/${key}`;
export const ogKey = (key: string) => key.replace(/\.webp$/, '-og.webp');

const IST = 'Asia/Kolkata';
export const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });
export const tagLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, ' ');
