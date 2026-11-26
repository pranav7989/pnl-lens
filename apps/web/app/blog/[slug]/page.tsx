/**
 * @file  apps/web/app/blog/[slug]/page.tsx
 * @area  Blog
 * @what  REQ-7 article page: server-rendered text, SEO metadata (canonical, Open Graph/Twitter, robots, hreflang), JSON-LD BlogPosting + BreadcrumbList, 301 for old slugs.
 */
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import Article from '@/components/blog/Article';
import BlogTrack from '@/components/blog/BlogTrack';
import { blogRegion, getPost, mediaUrl, ogKey, SITE_URL, type BlogPost } from '@/lib/blog';
import '../../blog.css';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ region?: string }> };

async function load(props: Props): Promise<{ post: BlogPost; site: 'india' | 'global' }> {
  const { slug } = await props.params;
  const { site } = await blogRegion((await props.searchParams).region);
  const r = await getPost(slug, site);
  if (r?.redirect) permanentRedirect(`/blog/${r.redirect}`);
  if (!r?.post) notFound();
  return { post: r.post, site };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { post } = await load(props);
  const self = `${SITE_URL}/blog/${post.slug}`;
  const title = post.seo_title || post.title, description = post.meta_description || post.excerpt || undefined;
  const image = post.cover_key ? { url: `${SITE_URL}${mediaUrl(ogKey(post.cover_key))}`, width: 1200, height: 630, alt: post.cover_alt || '' } : undefined;
  return {
    title: { absolute: `${title} · PnL Lens` }, description,
    alternates: {
      canonical: post.canonical_url || self,
      // hreflang pairs only when the same post is on both sites (REQ-7 §7.4)
      ...(post.site === 'both' ? { languages: { 'en-IN': `${self}?region=in`, en: `${self}?region=global`, 'x-default': self } } : {}),
    },
    robots: post.noindex ? { index: false, follow: true } : undefined,
    openGraph: { type: 'article', title, description, url: self, siteName: 'PnL Lens', publishedTime: post.published_at, modifiedTime: post.updated_at,
      tags: post.tags, ...(image ? { images: [image] } : {}) },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description, ...(image ? { images: [image.url] } : {}) },
  };
}

export default async function BlogArticle(props: Props) {
  const { post, site } = await load(props);
  const self = `${SITE_URL}/blog/${post.slug}`;
  const ld = [
    {
      '@context': 'https://schema.org', '@type': 'BlogPosting', mainEntityOfPage: { '@type': 'WebPage', '@id': self },
      headline: post.title.slice(0, 110), description: post.meta_description || post.excerpt || undefined,
      datePublished: post.published_at, dateModified: post.updated_at, inLanguage: site === 'india' ? 'en-IN' : 'en',
      author: { '@type': 'Organization', name: 'PnL Lens', url: SITE_URL },
      publisher: { '@type': 'Organization', name: 'PnL Lens', logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon.svg` } },
      ...(post.cover_key ? { image: [`${SITE_URL}${mediaUrl(ogKey(post.cover_key))}`] } : {}),
      ...(post.tags.length ? { keywords: post.tags.join(', ') } : {}),
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
        { '@type': 'ListItem', position: 3, name: post.title, item: self },
      ],
    },
  ];
  // "<" is escaped so text in a title can never close the script element
  const json = JSON.stringify(ld).replace(/</g, '\\u003c');
  return (
    <div className="bl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
      <Article post={post} />
      <BlogTrack slug={post.slug} site={site} />
    </div>
  );
}
