/**
 * @file  apps/web/app/(auth)/signup/page.tsx
 * @area  Auth
 * @what  Redirects /signup to /login (one page for new and returning users).
 */
import { redirect } from 'next/navigation';
/** One page handles both new and returning users. */
export default function Signup() { redirect('/login'); }
