/**
 * @file  apps/web/app/layout.tsx
 * @area  Pages
 * @what  Root layout: fonts (Manrope + ₹ glyph), html lang (en-IN / en by site), header with logo and reports left (from the API), browser error reporter.
 */
import './globals.css';
import './report.css';
import './workspace.css';
import localFont from 'next/font/local';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getMe } from '@/lib/api-client';
import { requestCountry } from '@/lib/auth/country';
import { regionFor } from '@pnl-lens/shared/pricing';
import NavLinks from '@/components/nav/NavLinks';
import { LogoMark } from '@/components/brand/Logo';
import ErrorReporter from '@/components/ErrorReporter';
import LogoutButton from '@/components/auth/LogoutButton';

export const dynamic = 'force-dynamic';
const manrope = localFont({ src: './fonts/manrope.woff2', variable: '--f-sans', weight: '200 800', display: 'swap', adjustFontFallback: false });
// ₹ isn't in Manrope's latin set; a 1-glyph font keeps the rupee sign identical on every device
const rupee = localFont({ src: [{ path: './fonts/rupee-400.woff2', weight: '400' }, { path: './fonts/rupee-700.woff2', weight: '700' }], variable: '--f-rupee', display: 'swap' });

export const metadata: Metadata = {
  title: 'PnL Lens — see where your trading P&L leaks',
  description: 'Upload your broker P&L or tradebook and get a ranked list of leaks, patterns and the rules that would fix them.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe().catch(() => null);
  const user = me?.user ?? null, left = me ? me.reportsLeft ?? 0 : null;
  // REQ-7 SEO: en-IN on the India site, en on Global (same country rule as the landing page)
  const lang = regionFor((await requestCountry()) || user?.country) === 'IN' ? 'en-IN' : 'en';
  return (
    <html lang={lang} className={`${manrope.variable} ${rupee.variable}`}>
      <head><meta name="color-scheme" content="dark" /></head>
      <body>
        <ErrorReporter />
        <header className="app-header">
          <div className="bar">
            <Link href="/" className="brand" style={{ textDecoration: 'none' }} aria-label="PnL Lens home"><LogoMark size={28} /><span>PnL Lens</span></Link>
            {user ? <NavLinks /> : <div style={{ flex: 1 }} />}
            {user ? (
              <>{/* credits spec: customers see "reports"; usable reports of plans still open */}
                {left ? <span className="credits-pill"><b>{left}</b> report{left === 1 ? '' : 's'} left</span>
                  : <Link className="credits-pill" href="/pricing" aria-label="No reports left · See plans"><span className="pill-long">No reports left · </span><b>See plans</b></Link>}
                {process.env.AUTH_MODE === 'jwt' && <LogoutButton />}</>
            ) : (
              <Link href="/login" className="btn">Sign in</Link>
            )}
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
