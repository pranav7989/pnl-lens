/**
 * @file  apps/web/components/landing/BlogPreview.tsx
 * @area  Landing
 * @what  REQ-7 landing section 9 "Read your trades better": the latest 3 published posts for the site; renders nothing when there are none.
 */
import PostCard from '@/components/blog/PostCard';
import type { BlogCard } from '@/lib/blog';

export default function BlogPreview({ posts }: { posts: BlogCard[] }) {
  if (!posts.length) return null;
  return (
    <section className="lp-section lp-blog" id="blog">
      <header className="lp-head">
        <h2 className="lp-h2">Read your trades better</h2>
        <p className="lp-sub">Short, practical articles on trading habits, costs and statements. Written by traders, for traders.</p>
      </header>
      <div className="bl-grid">{posts.slice(0, 3).map((p) => <PostCard key={p.slug} post={p} preview />)}</div>
      <div className="lp-blog-all"><a className="lp-btn ghost" href="/blog">All articles</a></div>
    </section>
  );
}
