/**
 * @file  apps/web/components/brand/Logo.tsx
 * @area  Brand
 * @what  Logo mark (three rising bars + growth arrow) and wordmark. Same artwork as app/icon.svg.
 */
/** PnL Lens mark: three rising bars with a growth arrow. Same artwork as app/icon.svg (browser tab). */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="8" fill="#FFD60A" />
      <rect x="7" y="17" width="4" height="8" rx="2" fill="#000" />
      <rect x="14" y="13" width="4" height="12" rx="2" fill="#000" />
      <rect x="21" y="9" width="4" height="16" rx="2" fill="#000" />
      <path d="M6 14.5 L13 9.5 L17 11.5 L24.5 5.5" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20.5 5.2 L24.8 5.2 L24.8 9.4" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function Wordmark({ size = 28 }: { size?: number }) {
  return <span className="wordmark"><LogoMark size={size} /><span>PnL Lens</span></span>;
}
