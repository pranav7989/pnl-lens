/**
 * @file  apps/web/app/robots.ts
 * @area  Blog
 * @what  /robots.txt: public pages open to crawlers; admin, API and signed-in areas closed; points to the sitemap.
 */
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/blog';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/dashboard', '/upload', '/report/', '/reminders/'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
