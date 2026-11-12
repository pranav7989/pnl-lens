/**
 * @file  apps/web/app/unsubscribe/page.tsx
 * @area  Reports
 * @what  "Stop these emails" from the weekly summary: one button (no sign-in); a POST so email link scanners cannot unsubscribe anyone.
 */
import UnsubscribeButton from '@/components/workspace/UnsubscribeButton';

export const dynamic = 'force-dynamic';

export default async function Unsubscribe(props: { searchParams: Promise<{ u?: string; t?: string }> }) {
  const sp = await props.searchParams;
  const u = typeof sp.u === 'string' ? sp.u : '', t = typeof sp.t === 'string' ? sp.t : '';
  return (
    <div className="panel center-card" data-unsubscribe>
      <h3>Weekly summary email</h3>
      {u && t ? <UnsubscribeButton u={u} t={t} /> : <p className="muted">This link is incomplete. You can turn the summary off in Dashboard → Your data.</p>}
    </div>
  );
}
