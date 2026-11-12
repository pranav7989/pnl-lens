/**
 * @file  apps/web/app/manual/page.tsx
 * @area  Docs
 * @what  User manual (public): every feature, what it tells you and how to use it; the India or Global edition by the visitor's site (?region=in|global switches).
 */
import type { Metadata } from 'next';
import { requestCountry } from '@/lib/auth/country';
import { getSessionUser } from '@/lib/auth/session';
import { regionFor } from '@pnl-lens/shared/pricing';
import { manualHtml } from '@/lib/manual';
import '../manual.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'User manual · PnL Lens', description: 'How to use PnL Lens: every feature, what it tells you and how to use it.' };

export default async function Manual(props: { searchParams: Promise<{ region?: string }> }) {
  const sp = await props.searchParams;
  const forced = sp.region === 'in' ? 'IN' : sp.region === 'global' ? 'US' : null;
  const user = await getSessionUser().catch(() => null);
  const region = regionFor(forced || (await requestCountry()) || user?.country);
  return <div data-manual={region === 'IN' ? 'india' : 'global'} dangerouslySetInnerHTML={{ __html: manualHtml(region) }} />;
}
