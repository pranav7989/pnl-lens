/**
 * @file  apps/web/components/motion/Loading.tsx
 * @area  Styles
 * @what  Loading placeholder: a shimmering skeleton for sighted users; screen readers still hear "Loading…".
 */
export default function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="mo-skel" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: lines }, (_, i) => <i key={i} className="shimmer" aria-hidden="true" />)}
    </div>
  );
}
