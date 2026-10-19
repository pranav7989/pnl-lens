/**
 * @file  apps/web/components/blog/PostCard.tsx
 * @area  Blog
 * @what  REQ-7 article card (tag, read time, title, excerpt, "Read article →") used on /blog and in the landing preview.
 */
import { mediaUrl, ogKey, tagLabel, type BlogCard } from '@/lib/blog';

/** The whole card is one link. `preview` marks landing-page cards for the blog_preview_click event (landing.js). */
/** `heading` keeps the outline in order: h2 on /blog (under the page h1), h3 in the landing section (under its h2). */
export default function PostCard({ post, preview = false, eager = false, heading = 'h3' }: { post: BlogCard; preview?: boolean; eager?: boolean; heading?: 'h2' | 'h3' }) {
  const tag = post.tags[0], H = heading;
  return (
    <a className="bl-card" href={`/blog/${post.slug}`} {...(preview ? { 'data-blog-preview': post.slug } : {})}>
      {post.cover_key && (
        <img className="bl-card-img" src={mediaUrl(ogKey(post.cover_key))} alt={post.cover_alt || ''} width={1200} height={630}
          loading={eager ? 'eager' : 'lazy'} decoding="async" />
      )}
      <span className="bl-meta">{tag && <span className="bl-tag">{tagLabel(tag)}</span>}<span>{post.reading_minutes} min read</span></span>
      <H className="bl-card-t">{post.title}</H>
      {post.excerpt && <p>{post.excerpt}</p>}
      <span className="bl-more">Read article →</span>
    </a>
  );
}
