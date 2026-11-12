/**
 * @file  apps/web/app/(app)/market/page.tsx
 * @area  Pages
 * @what  Live Market sheets (Nifty, Bank Nifty, Market; India): access decided by the API (sign-in, plan, region, flag); upgrade card without a plan, not found otherwise.
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiServer } from '@/lib/api-client';
import MarketShell from '@/components/market/MarketShell';
import '../../market.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Market · PnL Lens' };

export default async function MarketPage() {
  const r = await apiServer<{ access: boolean; reason: 'ok' | 'no_plan' | 'hidden' }>('/market-iq/access');
  if (r.status === 401) redirect('/login?next=/market');
  if (!r.ok || r.data.reason === 'hidden') notFound();
  if (r.data.reason === 'no_plan') {
    return (
      <div className="panel center-card" data-market-upgrade>
        <h3>Live market sheets</h3>
        <p className="muted">Nifty and Bank Nifty option positioning, and the wider market, updated through the trading day. They come with an active plan.</p>
        <Link className="btn" href="/pricing">See plans</Link>
        <p className="mk-note">Market data and analytics only. Not investment advice.</p>
      </div>
    );
  }
  return <MarketShell />;
}
