/**
 * @file  apps/web/app/admin/blog/preview/[id]/page.tsx
 * @area  Admin
 * @what  REQ-7 private article preview (any status) for owner/admin: the public article layout with a "Preview" banner; never indexed.
 */
import { notFound, redirect } from 'next/navigation';
import { apiServer, getMe } from '@/lib/api-client';
import Article from '@/components/blog/Article';
import '../../../../blog.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Preview · PnL Lens blog', robots: { index: false, follow: false } };

export default async function BlogPreview(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const me = await getMe();
  if (!me) redirect(`/login?next=${encodeURIComponent(`/admin/blog/preview/${id}`)}`);
  // the API checks blog:publish and the database re-checks the role; anyone else gets 403/404 here
  const r = await apiServer<{ post: any }>(`/admin/blog/posts/${encodeURIComponent(id)}`);
  if (!r.ok || !r.data?.post) notFound();
  const p = r.data.post;
  return (
    <div className="bl">
      <p className="bl-preview-bar" role="status">Preview · {p.status} · only the PnL Lens team can see this page</p>
      <Article post={{ ...p, published_at: p.published_at || null }} />
    </div>
  );
}
