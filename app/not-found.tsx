/**
 * @file  app/not-found.tsx
 * @area  Pages
 * @what  404 page.
 */
import Link from 'next/link';
export default function NotFound() {
  return <div className="panel center-card"><h3>Not found</h3><p className="muted">That page or report doesn't exist.</p><Link className="btn" href="/dashboard">Back to dashboard</Link></div>;
}
