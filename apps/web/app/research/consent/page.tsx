/**
 * @file  apps/web/app/research/consent/page.tsx
 * @area  Privacy
 * @what  The link in the "Request reports" email: the exact research consent wording with Yes / No thanks; works without signing in; never indexed.
 */
import ConsentChoice from '@/components/privacy/ConsentChoice';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your choice · PnL Lens', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };

async function stateOf(token: string): Promise<{ state: string; answer?: 'yes' | 'no' }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { state: 'invalid' };
  const base = (process.env.API_INTERNAL_URL || 'http://api:4000').replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/api/v1/research/invite/${token}`, { cache: 'no-store' });
    return r.ok ? await r.json() : { state: 'invalid' };
  } catch { return { state: 'invalid' }; }
}

export default async function ResearchConsent(props: { searchParams: Promise<{ t?: string; choice?: string }> }) {
  const sp = await props.searchParams;
  const token = typeof sp.t === 'string' ? sp.t : '';
  const s = await stateOf(token);
  return (
    <div className="panel center-card login-card rc-card">
      <ConsentChoice token={token} state={s.state} saved={s.answer} preselect={sp.choice === 'no' ? 'no' : sp.choice === 'yes' ? 'yes' : undefined} />
    </div>
  );
}
