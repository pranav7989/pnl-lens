/**
 * @file  apps/web/app/page.tsx
 * @area  Landing
 * @what  Home page route. Picks India or Global site from the visitor country (?region= overrides) and renders <Landing>.
 */
import type { Metadata } from 'next';
import Script from 'next/script';
import { getSessionUser } from '@/lib/auth/session';
import { requestCountry } from '@/lib/auth/country';
import { plansFor, regionFor } from '@pnl-lens/shared/pricing';
import Landing from '@/components/landing/Landing';
import { siteFor } from '@pnl-lens/shared/site';

const SITE_URL = (process.env.APP_URL || 'https://pnllens.com').replace(/\/$/, '');
import './landing.css';



export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'PnL Lens — understand your trading, trade responsibly',
  description: 'Upload your broker P&L or tradebook. PnL Lens gives you a clear, private review of your trading habits, tracks your progress month by month and suggests practical next steps.',
  openGraph: { title: 'PnL Lens — understand your trading', description: 'A clear, private review of your trading habits. Trade responsibly.', type: 'website', url: 'https://pnllens.com' },
};

export default async function Home(props: { searchParams: Promise<{ region?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await getSessionUser();
  // Site and prices follow the visitor's country (signed-in users: their stored country); ?region= switches manually.
  const forced = searchParams.region === 'in' ? 'IN' : searchParams.region === 'global' ? 'US' : null;
  const country = forced || (await requestCountry()) || user?.country;
  const plans = plansFor(country);
  const region = regionFor(country);
  return (
    <div>
      {/* Organization structured data with the social profiles (REQ-5, SEO) */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'PnL Lens', url: SITE_URL, logo: `${SITE_URL}/icon.svg`, sameAs: [siteFor(region).social.instagram, siteFor(region).social.x] }) }} />
      <Landing signedIn={!!user} plans={plans} region={region} />
      <Script src="/landing.js" strategy="afterInteractive" />
    </div>
  );
}
