/**
 * @file  components/ErrorReporter.tsx
 * @area  Admin
 * @what  Sends browser errors to /api/errors (max 5 per page load).
 */
'use client';
import { useEffect } from 'react';
/** Sends browser errors to /api/errors for the admin error center (max 5 per page load). */
export default function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const send = (message: string, stack?: string) => { if (sent++ >= 5 || !message) return; navigator.sendBeacon?.('/api/errors', new Blob([JSON.stringify({ message, stack, route: location.pathname })], { type: 'application/json' })); };
    const onErr = (e: ErrorEvent) => send(e.message, e.error?.stack);
    const onRej = (e: PromiseRejectionEvent) => send(String(e.reason?.message || e.reason), e.reason?.stack);
    window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onRej);
    return () => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); };
  }, []);
  return null;
}
