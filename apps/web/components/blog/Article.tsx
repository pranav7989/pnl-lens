/**
 * @file  apps/web/components/blog/Article.tsx
 * @area  Blog
 * @what  REQ-7 article body (H1, date, read time, tag, cover, sanitised HTML) with the automatic footer: CTA card and "Not investment advice."
 */
import { dateLabel, mediaUrl, ogKey, tagLabel } from '@/lib/blog';

export interface ArticleData {
  slug: string; title: string; tags: string[]; reading_minutes: number; published_at: string | null;
  cover_key: string | null; cover_alt: string | null; body_html: string;
}

/** body_html was rendered from Markdown and made safe by the API (no raw HTML, safe links) before it was stored. */
export default function Article({ post }: { post: ArticleData }) {
  const tag = post.tags[0];
  return (
    <article className="bl-article">
      <div className="bl-progress" aria-hidden="true" />
      <nav className="bl-crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/blog">Blog</a></nav>
      <div className="bl-article-head">
        <h1>{post.title}</h1>
        <p className="bl-meta">
          {post.published_at && <time dateTime={post.published_at}>{dateLabel(post.published_at)}</time>}
          <span>{post.reading_minutes} min read</span>
          {tag && <a className="bl-tag" href={`/blog?tag=${encodeURIComponent(tag)}`}>{tagLabel(tag)}</a>}
        </p>
      </div>
      {post.cover_key && (
        <img className="bl-cover" src={mediaUrl(ogKey(post.cover_key))} alt={post.cover_alt || ''} width={1200} height={630} fetchPriority="high" decoding="async" />
      )}
      <div className="bl-body" dangerouslySetInnerHTML={{ __html: post.body_html }} />
      <aside className="bl-cta">
        <p>See these patterns in your own trades</p>
        <a className="btn" href="/upload?from=blog" data-blog-cta>Analyse my trades</a>
      </aside>
      <p className="bl-note">Not investment advice.</p>
    </article>
  );
}
