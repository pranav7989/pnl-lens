/**
 * @file  apps/api/src/lib/market-iq.ts
 * @area  API
 * @what  Market IQ access rule (flag off/owner/paid, staff, India, active plan) and the client for the private data service (x-internal-key, short timeout).
 */
/**
 * Who may see the live Market sheets, decided on the server only (rule 5):
 *   MARKET_IQ_ACCESS=off   -> nobody
 *   MARKET_IQ_ACCESS=owner -> owner and admin accounts only (until a data redistribution licence is in place)
 *   MARKET_IQ_ACCESS=paid  -> owner/admin, plus India users with a plan whose window is open
 * A user who could see it with a plan but has none gets 'no_plan' (the page shows an upgrade card); every other
 * refusal is 'hidden' (no link, no page).
 */
export type MarketIqFlag = 'off' | 'owner' | 'paid';
export interface MarketIqConfig { url: string | null; key: string | null; access: MarketIqFlag }
export type AccessReason = 'ok' | 'no_plan' | 'hidden';

const STAFF = new Set(['owner', 'admin']);

export function marketIqConfig(env: NodeJS.ProcessEnv = process.env): MarketIqConfig {
  const a = (env.MARKET_IQ_ACCESS || 'owner').trim().toLowerCase();
  return {
    url: (env.MARKETIQ_URL || '').trim().replace(/\/$/, '') || null,
    key: (env.MARKETIQ_INTERNAL_KEY || '').trim() || null,
    access: a === 'off' || a === 'paid' ? a : 'owner',
  };
}

export function marketIqAccess(o: { flag: MarketIqFlag; role: string | null | undefined; country: string | null | undefined; hasActivePlan: boolean }): AccessReason {
  if (o.flag === 'off') return 'hidden';
  if (STAFF.has(String(o.role || ''))) return 'ok';
  if (o.flag !== 'paid') return 'hidden';
  if (String(o.country || '').toUpperCase() !== 'IN') return 'hidden';      // India only (same as Market context)
  return o.hasActivePlan ? 'ok' : 'no_plan';
}

export class MarketIqUnavailable extends Error {}

/** GET a path on the data service with the shared key; throws MarketIqUnavailable when it can't answer. */
export async function marketIqGet<T = unknown>(cfg: MarketIqConfig, path: string, timeoutMs = 5000): Promise<T> {
  if (!cfg.url || !cfg.key) throw new MarketIqUnavailable('not configured');
  let r: Response;
  try {
    r = await fetch(cfg.url + path, { headers: { 'x-internal-key': cfg.key, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new MarketIqUnavailable('unreachable');
  }
  if (!r.ok) throw new MarketIqUnavailable(`status ${r.status}`);
  return (await r.json()) as T;
}
