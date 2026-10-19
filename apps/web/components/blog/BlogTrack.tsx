'use client';
/**
 * @file  apps/web/components/blog/BlogTrack.tsx
 * @area  Blog
 * @what  REQ-7 article events: blog_view once per page view and blog_cta_click on "Analyse my trades" (anonymous, allow-listed by the API).
 */
import { useEffect } from 'react';

const send = (name: string, props: Record<string, unknown>) => {
  try {
    fetch('/api/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, props }), keepalive: true }).catch(() => {});
  } catch { /* ignore */ }
};

export default function BlogTrack({ slug, site }: { slug: string; site: string }) {
  useEffect(() => {
    send('blog_view', { slug, site });
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-blog-cta]')) send('blog_cta_click', { slug, site });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [slug, site]);
  return null;
}
