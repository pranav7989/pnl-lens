/**
 * @file  apps/web/components/market/MarketShell.tsx
 * @area  Pages
 * @what  The Market page frame: Nifty / Bank Nifty / Market tabs, the data service status (login, instrument list, session, daily jobs) refreshed every 30 s, and the disclaimer; the live sheets fill these tabs in later phases.
 */
'use client';
import { Fragment, useEffect, useState } from 'react';

type Job = { status: string; at: string; message: string };
interface Status {
  token: { configured: boolean; missing: string[]; state: 'ok' | 'expired' | 'none'; expires_at: string | null };
  instruments: { count: number; as_of: string | null };
  market: { trading_day: boolean; session: 'pre_open' | 'open' | 'closed' };
  jobs: Record<string, Job>;
  feed?: { running: boolean; connected: boolean; subscribed: number; receiving: number; updated_last_minute: number; reconnects: number; last_error: string | null; last_message: string | null };
  bars_today?: number;
}
const TABS = [['nifty', 'Nifty'], ['banknifty', 'Bank Nifty'], ['market', 'Market']] as const;
const SESSION = { pre_open: 'Before the open', open: 'Market open', closed: 'Market closed' } as const;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');

export default function MarketShell() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('nifty');
  const [s, setS] = useState<Status | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => fetch('/api/v1/market-iq/status', { cache: 'no-store' }).then(async (r) => {
      if (!live) return;
      if (r.ok) { setS(await r.json()); setDown(false); } else setDown(true);
    }).catch(() => { if (live) setDown(true); });
    load();
    const t = setInterval(load, 30_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const login = !s ? '…' : !s.token.configured ? `Waiting for ${s.token.missing.join(', ')} in .env` : s.token.state === 'ok' ? `Connected · renews ${fmt(s.token.expires_at)}` : 'Not logged in yet (renews 08:30 on trading days)';
  return (
    <div className="mk" data-market>
      <div className="mk-head">
        <div>
          <h1 className="page-title">Market</h1>
          <p className="muted">Live Nifty and Bank Nifty option positioning and the wider market (India).</p>
        </div>
        <span className={`mk-dot ${down ? 'off' : s ? 'on' : ''}`} data-market-fresh>{down ? 'Data service not answering' : s ? SESSION[s.market.session] : 'Connecting…'}</span>
      </div>
      <div className="tabs mk-tabs" role="tablist" aria-label="Market sheets">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <section className="panel mk-soon" role="tabpanel" data-market-tab={tab}>
        <h3>{TABS.find((t) => t[0] === tab)![1]} sheet</h3>
        <p className="muted">The live sheet is being connected to the market data feed. This page shows the data service status meanwhile.</p>
      </section>
      <section className="panel" data-market-status>
        <h3>Data service</h3>
        {down && <p className="muted">The market data service is not answering right now. The rest of PnL Lens is not affected.</p>}
        {s && (
          <dl className="mk-status">
            <dt>Dhan login</dt><dd>{login}</dd>
            <dt>Instrument list</dt><dd>{s.instruments.count ? `${s.instruments.count.toLocaleString('en-IN')} instruments · ${s.instruments.as_of}` : 'Not downloaded yet (08:45 on trading days)'}</dd>
            <dt>Today</dt><dd>{s.market.trading_day ? 'Trading day' : 'Market holiday or weekend'}</dd>
            <dt>Live feed</dt><dd data-market-feed>{!s.feed?.running ? 'Off (runs 09:00–15:35 on trading days)'
              : s.feed.connected ? `Live · ${s.feed.updated_last_minute} of ${s.feed.subscribed} instruments updated in the last minute`
              : `Reconnecting${s.feed.last_error ? ` (${s.feed.last_error})` : ''}…`}</dd>
            <dt>Minute bars today</dt><dd>{(s.bars_today ?? 0).toLocaleString('en-IN')}</dd>
            {Object.entries(s.jobs).map(([name, j]) => (<Fragment key={name}><dt>Job · {name}</dt><dd>{j.status} · {fmt(j.at)}{j.message ? ` · ${j.message}` : ''}</dd></Fragment>))}
          </dl>
        )}
      </section>
      <p className="mk-note">Market data and analytics only. Not investment advice.</p>
    </div>
  );
}
