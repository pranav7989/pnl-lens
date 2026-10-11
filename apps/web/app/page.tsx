/**
 * @file  apps/web/app/page.tsx
 * @area  Landing
 * @what  Home page route. Picks India or Global site from the visitor country (?region= overrides) and renders <Landing>.
 */
import type { Metadata } from 'next';
import Script from 'next/script';
import fs from 'node:fs';
import path from 'node:path';
import { getSessionUser } from '@/lib/auth/session';
import { requestCountry } from '@/lib/auth/country';
import { plansFor, regionFor } from '@pnl-lens/shared/pricing';
import Landing from '@/components/landing/Landing';
import './landing.css';



export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'PnL Lens — understand your trading, trade responsibly',
  description: 'Upload your broker P&L or tradebook. PnL Lens gives you a clear, private review of your trading habits, tracks your progress month by month and suggests practical next steps.',
  openGraph: { title: 'PnL Lens — understand your trading', description: 'A clear, private review of your trading habits. Trade responsibly.', type: 'website', url: 'https://pnllens.com' },
};

/** Logos dropped into public/brokers/<slug>.svg|png are picked up automatically (see public/brokers/README.md). */
let logoCache: Record<string, string> | null = null;
function brokerLogos(): Record<string, string> {
  if (logoCache && process.env.NODE_ENV === 'production') return logoCache;
  const dir = path.join(process.cwd(), 'public', 'brokers');
  const out: Record<string, string> = {};
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^([a-z0-9-]+)\.(svg|png|webp)$/);
      if (m && !out[m[1]]) out[m[1]] = `/brokers/${f}`;
    }
  } catch { /* folder missing: names only */ }
  return (logoCache = out);
}

export default async function Home({ searchParams }: { searchParams: { region?: string } }) {
  const user = await getSessionUser();
  // Site and prices follow the visitor's country (signed-in users: their stored country); ?region= switches manually.
  const forced = searchParams.region === 'in' ? 'IN' : searchParams.region === 'global' ? 'US' : null;
  const country = forced || requestCountry() || user?.country;
  const plans = plansFor(country);
  const region = regionFor(country);
  return (
    <div>
      <Landing signedIn={!!user} plans={plans} logos={brokerLogos()} region={region} />
      <Script src="/landing.js" strategy="afterInteractive" />
    </div>
  );
}
