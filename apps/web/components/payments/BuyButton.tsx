/**
 * @file  apps/web/components/payments/BuyButton.tsx
 * @area  Payments
 * @what  Buy button for both payment modes: opening soon / Razorpay Checkout (link mode removed, plan D5).
 */
/**
 * BuyButton — one button for both payment modes.
 *   off      → "Payments opening soon" + support email (no request)
 *   razorpay → loads checkout.js, opens Razorpay Checkout, verifies on success; the plan is granted by the webhook
 * Mode comes from GET /api/v1/payments/config (PAYMENTS_MODE on the API).
 */
'use client';
import { useEffect, useState } from 'react';

declare global { interface Window { Razorpay?: any } }
const loadCheckout = () => new Promise<void>((res, rej) => {
  if (window.Razorpay) return res();
  const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = () => res(); s.onerror = () => rej(new Error('checkout_load_failed'));
  document.body.appendChild(s);
});

/** `source: 'journey'` marks a purchase that started from the journey bar or card (REQ-2): the webhook records upgrade_from_journey. */
export default function BuyButton({ planId, label, primary, source }: { planId: string; label: string; primary?: boolean; source?: 'journey' }) {
  const [mode, setMode] = useState<'off' | 'razorpay' | null>(null);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch('/api/v1/payments/config').then((r) => r.json()).then((j) => setMode(j.mode)).catch(() => setMode('off')); }, []);

  async function buy() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/v1/payments/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(source ? { planId, source } : { planId }) });
      if (r.status === 401) { location.href = `/login?next=/pricing`; return; }
      const j = await r.json();
      if (!r.ok) { setMsg(j.message || 'Payments are opening soon.'); return; }
      await loadCheckout();
      new window.Razorpay({
        key: j.keyId, order_id: j.orderId, amount: j.amount, currency: j.currency, name: j.name, description: j.description, prefill: j.prefill, theme: { color: '#FFD60A' },
        handler: async (resp: any) => {
          const v = await fetch('/api/v1/payments/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resp) });
          const vj = await v.json(); setMsg(vj.message || vj.error || ''); if (v.ok) setTimeout(() => { location.href = '/dashboard?paid=1'; }, 1500);
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open();
    } catch { setMsg('Could not start the payment. Please try again.'); }
    finally { setBusy(false); }
  }

  if (mode === 'off') return <div><button className={`btn btn-block ${primary ? '' : 'ghost'}`} disabled>Payments opening soon</button>
    <p className="muted tiny buy-note">Write to <a className="link" href="mailto:support@pnllens.com">support@pnllens.com</a> to be notified.</p></div>;
  return <div><button className={`btn btn-block ${primary ? '' : 'ghost'}`} onClick={buy} disabled={busy || !mode}>{busy ? 'Opening…' : label}</button>
    {msg && <p className="muted small buy-note">{msg}</p>}</div>;
}
