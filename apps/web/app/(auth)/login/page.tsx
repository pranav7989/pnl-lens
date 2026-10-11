/**
 * @file  apps/web/app/(auth)/login/page.tsx
 * @area  Auth
 * @what  Sign-in page: Google button + email one-time code (LoginForm). New users are created on first sign-in.
 */
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { googleEnabled } from '@/lib/auth/google';
import LoginForm from '@/components/auth/LoginForm';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  google: "Google sign-in didn't complete. Try again, or use an email code.",
  google_disabled: 'Google sign-in is not available right now. Use an email code.',
};

export default async function Login({ searchParams }: { searchParams: { error?: string; next?: string } }) {
  if (await getSessionUser()) redirect('/dashboard');
  const next = searchParams.next?.startsWith('/') && !searchParams.next.startsWith('//') ? searchParams.next : '/dashboard';
  return (
    <div className="panel center-card">
      <h3>Sign in or create an account</h3>
      <p className="muted" style={{ marginTop: -4 }}>New here? Signing in creates your account.</p>
      <LoginForm google={googleEnabled()} next={next} error={searchParams.error ? ERRORS[searchParams.error] || ERRORS.google : ''} />
    </div>
  );
}
