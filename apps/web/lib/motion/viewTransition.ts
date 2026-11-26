/**
 * @file  apps/web/lib/motion/viewTransition.ts
 * @area  Styles
 * @what  withViewTransition(): runs a DOM/React update inside document.startViewTransition when available (cross-fade + slide, motion.css), otherwise directly. Never with reduced motion.
 */
import { flushSync } from 'react-dom';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `react`: wrap in flushSync so React commits inside the transition callback. */
export function withViewTransition(update: () => void, opts: { react?: boolean } = {}): void {
  const doc = typeof document !== 'undefined' ? (document as Document & { startViewTransition?: (cb: () => void) => unknown }) : null;
  const run = opts.react ? () => flushSync(update) : update;
  if (!doc?.startViewTransition || reduced()) { run(); return; }
  try { doc.startViewTransition(run); } catch { run(); }
}
