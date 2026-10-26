/**
 * @file  apps/web/app/blog/page.tsx
 * @area  Blog
 * @what  REQ-7 /blog: published posts for the visitor's site, newest first, 12 per page, tag filter; server-rendered.
 */
import type { Metadata } from 'next';
import PostCard from '@/components/blog/PostCard';
import { blogRegion, listPosts, listTags, tagLabel, SITE_URL } from '@/lib/blog';
import '../blog.css';

export const dynamic = 'force-dynamic';
type Search = Promise<{ tag?: string; page?: string; region?: string }>;

const clean = (tag?: string) => (tag && /^[a-z0-9][a-z0-9 -]{0,39}$/i.test(tag) ? tag.toLowerCase() : undefined);

export async function generateMetadata(props: { searchParams: Search }): Promise<Metadata> {
  const sp = await props.searchParams, tag = clean(sp.tag), page = Math.max(1, Number(sp.page) || 1);
  const title = tag ? `${tagLabel(tag)} articles · PnL Lens blog` : page > 1 ? `PnL Lens blog · page ${page}` : 'PnL Lens blog: trading habits, costs and statements';
  const description = 'Short, practical articles on trading habits, costs and statements. Written by traders, for traders.';
  const self = `${SITE_URL}/blog${tag ? `?tag=${encodeURIComponent(tag)}` : page > 1 ? `?page=${page}` : ''}`;
  return {
    title, description, alternates: { canonical: self, types: { 'application/rss+xml': `${SITE_URL}/blog/rss.xml` } },
    openGraph: { title, description, type: 'website', url: self, siteName: 'PnL Lens' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function BlogIndex(props: { searchParams: Search }) {
  const sp = await props.searchParams, tag = clean(sp.tag), page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
  const { site } = await blogRegion(sp.region);
  const [list, tags] = await Promise.all([listPosts(site, { tag, page }), listTags(site)]);
  const href = (o: { tag?: string; page?: number }) => {
    const q = new URLSearchParams(); if (o.tag) q.set('tag', o.tag); if (o.page && o.page > 1) q.set('page', String(o.page));
    const s = q.toString(); return s ? `/blog?${s}` : '/blog';
  };
  return (
    <div className="bl">
      <div className="bl-hero">
        <h1>Read your trades better</h1>
        <p>Short, practical articles on trading habits, costs and statements. Written by traders, for traders.</p>
      </div>
      {tags.length > 0 && (
        <nav className="bl-tags" aria-label="Filter by tag">
          <a href="/blog" aria-current={!tag ? 'page' : undefined}>All</a>
          {tags.map((t) => <a key={t.tag} href={href({ tag: t.tag })} aria-current={tag === t.tag ? 'page' : undefined}>{tagLabel(t.tag)}</a>)}
        </nav>
      )}
      {list.posts.length ? (
        <div className="bl-grid">{list.posts.map((p, i) => <PostCard key={p.slug} post={p} eager={i < 3} heading="h2" />)}</div>
      ) : (
        <div className="bl-empty">
          <h2>{tag ? 'No articles with this tag yet' : 'Articles are on their way'}</h2>
          <p>{tag ? <a href="/blog">See all articles</a> : <>Meanwhile, <a href="/">see what PnL Lens finds in your trades</a>.</>}</p>
        </div>
      )}
      {list.pages > 1 && (
        <nav className="bl-pages" aria-label="Pages">
          {page > 1 ? <a href={href({ tag, page: page - 1 })} rel="prev">← Newer</a> : <span />}
          <span>Page {list.page} of {list.pages}</span>
          {page < list.pages ? <a href={href({ tag, page: page + 1 })} rel="next">Older →</a> : <span />}
        </nav>
      )}
    </div>
  );
}
