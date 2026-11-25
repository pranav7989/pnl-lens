/**
 * @file  apps/web/app/desk/page.tsx
 * @area  Pages
 * @what  Desk (spec v1.0): date and session line, your watch-outs (plan + report), today's scheduled events and overnight headlines (signed in), and the charges / breakeven / position-size calculator; public (visitors see the calculator), signed-in traders get their saved risk and slippage.
 */
import { apiServer, getMe } from '@/lib/api-client';
import DeskCalculator, { type DeskConfig, type DeskSettings } from '@/components/desk/DeskCalculator';
import type { DeskTodayData } from '@/components/desk/DeskToday';
import type { DeskProfileData } from '@/components/desk/DeskWatchouts';
import '../desk.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Desk · PnL Lens' };

export default async function DeskPage() {
  const me = await getMe().catch(() => null);
  const [cfg, settings, today, profile] = await Promise.all([
    apiServer<DeskConfig>('/desk/config'),
    me ? apiServer<DeskSettings>('/desk/settings') : Promise.resolve(null),
    me ? apiServer<DeskTodayData>('/desk/today') : Promise.resolve(null),
    me ? apiServer<DeskProfileData>('/desk/profile') : Promise.resolve(null),
  ]);
  if (!cfg.ok) {
    return (
      <div className="desk">
        <h1 className="page-title">Desk</h1>
        <div className="panel"><p className="muted">The Desk is not available right now. Please try again in a minute.</p></div>
        <p className="desk-foot">Headlines and scheduled events only. Prices are entered by you. Not investment advice.</p>
      </div>
    );
  }
  return <DeskCalculator config={cfg.data} settings={settings?.ok ? settings.data : null} signedIn={!!me} today={today?.ok ? today.data : null} profile={profile?.ok ? profile.data : null} />;
}
