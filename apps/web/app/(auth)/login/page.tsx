/**
 * @file  apps/web/app/(auth)/login/page.tsx
 * @area  Auth
 * @what  Sign-in page: Google button + email one-time code (LoginForm). New users are created on first sign-in.
 */
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { apiServer } from '@/lib/api-client';
import { safeNext } from '@pnl-lens/shared/auth/next';
import LoginForm from '@/components/auth/LoginForm';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  google: "Google sign-in didn't complete. Try again, or use an email code.",
  google_disabled: 'Google sign-in is not available right now. Use an email code.',
};

export default async function Login(props: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const searchParams = await props.searchParams;
  if (await getSessionUser()) redirect('/dashboard');
  const providers = await apiServer<{ google: boolean }>('/auth/providers');
  const next = safeNext(searchParams.next);
  return (
    <div className="panel center-card">
      <h3>Sign in or create an account</h3>
      <p className="muted center-sub">New here? Signing in creates your account.</p>
      <LoginForm google={!!providers.data?.google} next={next} error={searchParams.error ? ERRORS[searchParams.error] || ERRORS.google : ''} />
    </div>
  );
}
