/**
 * @file  apps/web/components/nav/NavLinks.tsx
 * @area  Pages
 * @what  Header navigation links (active-state aware).
 */
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [['/dashboard', 'Dashboard'], ['/upload', 'New report'], ['/pricing', 'Plans'], ['/manual', 'User manual']] as const;
export default function NavLinks() {
  const path = usePathname();
  return (
    <nav className="app-nav">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={path.startsWith(href) ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
