/**
 * @file  apps/web/components/nav/NavLinks.tsx
 * @area  Pages
 * @what  Header navigation links (active-state aware).
 */
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [['/dashboard', 'Dashboard'], ['/upload', 'New report'], ['/pricing', 'Plans'], ['/manual', 'User manual']] as const;
/** market: the API says this user may see the live Market sheets (GET /me → marketIq; decided on the server) */
export default function NavLinks({ market = false }: { market?: boolean }) {
  const path = usePathname();
  const links: (readonly [string, string])[] = market ? [LINKS[0], ['/market', 'Market'], ...LINKS.slice(1)] : [...LINKS];
  return (
    <nav className="app-nav">
      {links.map(([href, label]) => (
        <Link key={href} href={href} aria-current={path.startsWith(href) ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
