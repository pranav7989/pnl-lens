/**
 * @file  apps/web/app/(auth)/login/page.tsx
 * @area  Auth
 * @what  Sign-in page: one card (Continue with Google · OR · Continue with email → password, or a code for a new email → set a password). One account per email.
 */
import { redirect } from 'next/navigation';
import { getMe, apiServer } from '@/lib/api-client';
import { safeNext } from '@pnl-lens/shared/auth/next';
import LoginForm from '@/components/auth/LoginForm';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  google: "Google sign-in didn't complete. Try again, or continue with email.",
  google_disabled: 'Google sign-in is not available right now. Continue with email.',
};

export default async function Login(props: { searchParams: Promise<{ error?: string; next?: string; step?: string; email?: string }> }) {
  const sp = await props.searchParams;
  const next = safeNext(sp.next);
  const me = await getMe();
  // signed in: only the required "set a password" step, or a reset started from the dashboard ("Change password")
  let step: 'email' | 'set' | 'forgot' = sp.step === 'forgot' ? 'forgot' : 'email';
  if (me) {
    if (me.needsPassword || (sp.step === 'set' && !me.hasPassword)) step = 'set';   // required, or a Google user adding one
    else if (sp.step !== 'forgot') redirect(next);
  }
  const providers = await apiServer<{ google: boolean }>('/auth/providers');
  const email = typeof sp.email === 'string' && sp.email.length <= 254 ? sp.email : '';
  return (
    <div className="panel center-card login-card">
      <LoginForm google={!!providers.data?.google} next={next} initialStep={step} initialEmail={email}
                 error={sp.error ? ERRORS[sp.error] || ERRORS.google : ''} />
    </div>
  );
}
