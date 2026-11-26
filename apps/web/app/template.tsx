/**
 * @file  apps/web/app/template.tsx
 * @area  Styles
 * @what  Route transition: every navigation fades in and rises 10px (motion.css .mo-page); static with reduced motion.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="mo-page">{children}</div>;
}
