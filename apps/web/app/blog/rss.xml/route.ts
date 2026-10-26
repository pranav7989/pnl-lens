/**
 * @file  apps/web/app/blog/rss.xml/route.ts
 * @area  Blog
 * @what  REQ-7 RSS 2.0 feed of published, indexable posts for the visitor's site (?region= switches).
 */
import { blogRegion, feed, SITE_URL } from '@/lib/blog';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function GET(req: Request) {
  const { site } = await blogRegion(new URL(req.url).searchParams.get('region') || undefined);
  const posts = (await feed(site)).filter((p) => !p.noindex).slice(0, 50);
  const items = posts.map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${SITE_URL}/blog/${p.slug}</link>
      <guid isPermaLink="true">${SITE_URL}/blog/${p.slug}</guid>
      <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>
      <description>${esc(p.excerpt)}</description>
    </item>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>PnL Lens blog</title>
    <link>${SITE_URL}/blog</link>
    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml" />
    <description>Short, practical articles on trading habits, costs and statements. Written by traders, for traders.</description>
    <language>${site === 'india' ? 'en-IN' : 'en'}</language>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
}
