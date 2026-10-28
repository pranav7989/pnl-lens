/**
 * @file  apps/web/app/sitemap.ts
 * @area  Blog
 * @what  /sitemap.xml: home, pricing, blog and every published, indexable post (both sites); follows publish/unpublish on the next request.
 */
import type { MetadataRoute } from 'next';
import { feed, SITE_URL } from '@/lib/blog';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [india, global] = await Promise.all([feed('india'), feed('global')]);
  const posts = new Map<string, { updated: string }>();
  for (const p of [...india, ...global]) if (!p.noindex) posts.set(p.slug, { updated: p.updated_at });
  const latest = [...posts.values()].map((p) => p.updated).sort().pop();
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/manual`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/blog`, changeFrequency: 'daily', priority: 0.7, ...(latest ? { lastModified: latest } : {}) },
    ...[...posts].map(([slug, p]) => ({ url: `${SITE_URL}/blog/${slug}`, lastModified: p.updated, changeFrequency: 'monthly' as const, priority: 0.6 })),
  ];
}
