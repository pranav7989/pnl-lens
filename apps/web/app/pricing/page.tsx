/**
 * @file  apps/web/app/pricing/page.tsx
 * @area  Payments
 * @what  Pricing page: 4 plans priced by country, each with a BuyButton; ?plan= highlights the plan a journey step needs (REQ-2).
 */
import { getSessionUser } from '@/lib/auth/session';
import { requestCountry } from '@/lib/auth/country';
import { plansFor, durationLabel, REPORTS_KEPT } from '@pnl-lens/shared/pricing';
import BuyButton from '@/components/payments/BuyButton';

export const dynamic = 'force-dynamic';

/** Pricing page: plans priced by visitor country; BuyButton handles off / link / razorpay modes (lib/payments). */
export default async function Pricing(props: { searchParams: Promise<{ plan?: string; from?: string }> }) {
  const sp = await props.searchParams;
  const user = await getSessionUser();
  const plans = plansFor((await requestCountry()) || user?.country);
  // REQ-2: a locked journey step links here with ?plan=<id>&from=journey#plan-<id>: that card is highlighted and scrolled to
  const pick = plans.some((p) => p.id === sp.plan) ? sp.plan : null;
  const source = sp.from === 'journey' ? 'journey' as const : undefined;
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <h1 className="page-title">Plans</h1>
      <div className="rv-grid" style={{ marginTop: 16 }}>
        {plans.map((p) => (
          <div key={p.id} id={`plan-${p.id}`} className={`rv-panel s6${pick === p.id ? ' plan-pick' : ''}`} aria-current={pick === p.id ? 'true' : undefined}
            style={p.id === 'progress' || pick === p.id ? { borderColor: 'var(--y)' } : undefined}>
            {pick === p.id && <span className="plan-pick-tag">Unlocks your next step</span>}
            <div className="rv-ph"><h3>{p.name}</h3><small>{durationLabel(p)}</small></div>
            <p style={{ fontSize: 34, fontWeight: 900, margin: '4px 0 10px' }}>{p.price.label}</p>
            <p className="muted" style={{ margin: 0 }}>{p.reports} report{p.reports > 1 ? 's' : ''} · up to {p.filesPerReport} file{p.filesPerReport > 1 ? 's' : ''} each{p.progress ? ' · progress tracking' : ''}</p>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{REPORTS_KEPT}</p>
            <div style={{ marginTop: 14 }}><BuyButton planId={p.id} label={`Buy ${p.name}`} primary={pick ? pick === p.id : p.id === 'progress'} source={source} /></div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>Reports can’t be refunded once generated. If something genuinely goes wrong, write to <a href="mailto:support@pnllens.com" style={{ color: 'var(--y)' }}>support@pnllens.com</a> and we’ll respond promptly.</p>
    </div>
  );
}
