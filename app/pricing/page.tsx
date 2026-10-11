/**
 * @file  app/pricing/page.tsx
 * @area  Payments
 * @what  Pricing page: 4 plans priced by country, each with a BuyButton (off / link / razorpay modes).
 */
import { getSessionUser } from '@/lib/auth/session';
import { requestCountry } from '@/lib/auth/country';
import { plansFor } from '@/lib/pricing';
import BuyButton from '@/components/payments/BuyButton';

export const dynamic = 'force-dynamic';

/** Pricing page: plans priced by visitor country; BuyButton handles off / link / razorpay modes (lib/payments). */
export default async function Pricing() {
  const user = await getSessionUser();
  const plans = plansFor(requestCountry() || user?.country);
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <h1 className="page-title">Plans</h1>
      <div className="rv-grid" style={{ marginTop: 16 }}>
        {plans.map((p) => (
          <div key={p.id} className="rv-panel s6" style={p.id === 'progress' ? { borderColor: 'var(--y)' } : undefined}>
            <div className="rv-ph"><h3>{p.name}</h3><small>{p.months ? `${p.months} months` : 'one-time'}</small></div>
            <p style={{ fontSize: 34, fontWeight: 900, margin: '4px 0 10px' }}>{p.price.label}</p>
            <p className="muted" style={{ margin: 0 }}>{p.reports} report{p.reports > 1 ? 's' : ''} · up to {p.filesPerReport} file{p.filesPerReport > 1 ? 's' : ''} each{p.progress ? ' · progress tracking' : ''}</p>
            <div style={{ marginTop: 14 }}><BuyButton planId={p.id} label={`Buy ${p.name}`} primary={p.id === 'progress'} /></div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>Reports can’t be refunded once generated. If something genuinely goes wrong, write to <a href="mailto:support@pnllens.com" style={{ color: 'var(--y)' }}>support@pnllens.com</a> and we’ll respond promptly.</p>
    </div>
  );
}
