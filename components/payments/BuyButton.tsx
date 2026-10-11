/**
 * @file  components/payments/BuyButton.tsx
 * @area  Payments
 * @what  Buy button for every payment mode: opening soon / Razorpay link / Razorpay Checkout.
 */
/**
 * BuyButton — one button for every payment mode.
 *   off      → "Payments opening soon" + support email (no request)
 *   link     → opens the pasted Razorpay Payment Page/Link
 *   razorpay → loads checkout.js, opens Razorpay Checkout, verifies on success
 * Mode comes from GET /api/payments/config (set PAYMENTS_MODE on the server).
 */
'use client';
import { useEffect, useState } from 'react';

declare global { interface Window { Razorpay?: any } }
const loadCheckout = () => new Promise<void>((res, rej) => {
  if (window.Razorpay) return res();
  const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = () => res(); s.onerror = () => rej(new Error('checkout_load_failed'));
  document.body.appendChild(s);
});

export default function BuyButton({ planId, label, primary }: { planId: string; label: string; primary?: boolean }) {
  const [mode, setMode] = useState<'off' | 'link' | 'razorpay' | null>(null);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch('/api/payments/config').then((r) => r.json()).then((j) => setMode(j.mode)).catch(() => setMode('off')); }, []);

  async function buy() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/payments/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId }) });
      if (r.status === 401) { location.href = `/login?next=/pricing`; return; }
      const j = await r.json();
      if (!r.ok) { setMsg(j.message || 'Payments are opening soon.'); return; }
      if (j.mode === 'link') { location.href = j.url; return; }
      await loadCheckout();
      new window.Razorpay({
        key: j.keyId, order_id: j.orderId, amount: j.amount, currency: j.currency, name: j.name, description: j.description, prefill: j.prefill, theme: { color: '#FFD60A' },
        handler: async (resp: any) => {
          const v = await fetch('/api/payments/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resp) });
          const vj = await v.json(); setMsg(vj.message || vj.error || ''); if (v.ok) setTimeout(() => { location.href = '/dashboard?paid=1'; }, 1500);
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open();
    } catch { setMsg('Could not start the payment. Please try again.'); }
    finally { setBusy(false); }
  }

  if (mode === 'off') return <div><button className={`btn ${primary ? '' : 'ghost'}`} disabled style={{ width: '100%', opacity: 0.65 }}>Payments opening soon</button>
    <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>Write to <a href="mailto:support@pnllens.com" style={{ color: 'var(--y)' }}>support@pnllens.com</a> to be notified.</p></div>;
  return <div><button className={`btn ${primary ? '' : 'ghost'}`} style={{ width: '100%' }} onClick={buy} disabled={busy || !mode}>{busy ? 'Opening…' : label}</button>
    {msg && <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>{msg}</p>}</div>;
}
