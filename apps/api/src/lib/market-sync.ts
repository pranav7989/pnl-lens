/**
 * @file  apps/api/src/lib/market-sync.ts
 * @area  Reports
 * @what  Automatic market data (India): daily closes of NIFTY 50, NIFTY BANK and India VIX from Upstox's public history API, NSE as fallback; retries, gap filling from the last stored day, a status row per symbol and a stale-data alarm in the admin Errors tab.
 */
/**
 * Runs in the api (the worker has no internet), hourly and at start-up. Each run asks only for the days after the
 * last stored one, so a missed run or a source outage is caught up on the next success, back to BACKFILL_FROM.
 * Nothing here can break a report: failures are recorded in market_sync and, when data is more than STALE_DAYS old,
 * once a day in error_events (admin console → Errors). Market data is public; no personal data is involved.
 */
import { sql } from 'kysely';
import type { Db } from '@pnl-lens/db';
import { captureErrorWith } from '@pnl-lens/shared/admin/telemetry';
import { istDate, addDays } from '@pnl-lens/shared/plan';
import type { Symbol } from '@pnl-lens/shared/insights/market';

export const BACKFILL_FROM = '2020-01-01';
export const STALE_DAYS = 4;                        // a weekend plus a holiday
export const SYMBOLS: { key: Symbol; upstox: string; nse: { kind: 'index'; name: string } | { kind: 'vix' } }[] = [
  { key: 'NIFTY', upstox: 'NSE_INDEX|Nifty 50', nse: { kind: 'index', name: 'NIFTY 50' } },
  { key: 'BANKNIFTY', upstox: 'NSE_INDEX|Nifty Bank', nse: { kind: 'index', name: 'NIFTY BANK' } },
  { key: 'INDIAVIX', upstox: 'NSE_INDEX|India VIX', nse: { kind: 'vix' } },
];
export interface Candle { day: string; open: number | null; high: number | null; low: number | null; close: number }
type Fetch = typeof fetch;
const UA = 'Mozilla/5.0 (compatible; PnLLens/1.0; +https://pnllens.com)';

async function getJson(f: Fetch, url: string, init: RequestInit = {}, ms = 20_000): Promise<any> {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await f(url, { ...init, signal: ac.signal, headers: { Accept: 'application/json', 'User-Agent': UA, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
const num = (v: any) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

/** Upstox public historical candles (no key): [timestamp, open, high, low, close, volume, oi], newest first */
export async function fetchUpstox(f: Fetch, instrument: string, from: string, to: string): Promise<Candle[]> {
  const url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(instrument)}/day/${to}/${from}`;
  const j = await getJson(f, url);
  if (j?.status !== 'success' || !Array.isArray(j?.data?.candles)) throw new Error('unexpected Upstox response');
  return j.data.candles.map((c: any[]) => ({ day: String(c[0]).slice(0, 10), open: num(c[1]), high: num(c[2]), low: num(c[3]), close: num(c[4])! }))
    .filter((c: Candle) => /^\d{4}-\d{2}-\d{2}$/.test(c.day) && c.close > 0 && c.day >= from && c.day <= to);
}

const MON: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const nseDay = (s: string) => { const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s).trim()); return m ? `${m[3]}-${MON[m[2].toUpperCase()]}-${m[1]}` : null; };
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/** NSE website history (fallback): needs the home page's cookies first; at most about a year per request */
export async function fetchNse(f: Fetch, sym: (typeof SYMBOLS)[number]['nse'], from: string, to: string): Promise<Candle[]> {
  const home = await f('https://www.nseindia.com/', { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  const cookie = (home.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const out: Candle[] = [];
  for (let a = from; a <= to; a = addDays(a, 365)) {
    const b = addDays(a, 364) < to ? addDays(a, 364) : to;
    const url = sym.kind === 'vix'
      ? `https://www.nseindia.com/api/historical/vixhistory?from=${ddmmyyyy(a)}&to=${ddmmyyyy(b)}`
      : `https://www.nseindia.com/api/historical/indicesHistory?indexType=${encodeURIComponent(sym.name)}&from=${ddmmyyyy(a)}&to=${ddmmyyyy(b)}`;
    const j = await getJson(f, url, { headers: { Cookie: cookie, Referer: 'https://www.nseindia.com/' } });
    const rows: any[] = sym.kind === 'vix' ? j?.data : j?.data?.indexCloseOnlineRecords;
    if (!Array.isArray(rows)) throw new Error('unexpected NSE response');
    for (const r of rows) {
      const day = nseDay(r.EOD_TIMESTAMP), close = num(r.EOD_CLOSE_INDEX_VAL);
      if (day && close && close > 0) out.push({ day, open: num(r.EOD_OPEN_INDEX_VAL), high: num(r.EOD_HIGH_INDEX_VAL), low: num(r.EOD_LOW_INDEX_VAL), close });
    }
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function retry<T>(fn: () => Promise<T>, tries: number, wait: number): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; if (i < tries - 1) await sleep(wait * 4 ** i); } }
  throw last;
}

export interface SyncDeps { db: Db; pool: { query: (q: string, p?: unknown[]) => Promise<unknown> }; fetch?: Fetch; retryWaitMs?: number; log?: (event: string, extra?: object) => void }
export interface SyncResult { symbol: Symbol; added: number; source: 'upstox' | 'nse' | null; error: string | null; lastDay: string | null; stale: boolean }

/** one run: for each symbol, fetch the missing days, store them, record the status */
export async function syncMarket(deps: SyncDeps, now = new Date()): Promise<SyncResult[]> {
  const f = deps.fetch ?? fetch, today = istDate(now), wait = deps.retryWaitMs ?? 1000;
  const out: SyncResult[] = [];
  for (const s of SYMBOLS) {
    const last = (await deps.db.selectFrom('market_daily').select(sql<string>`max(day)::text`.as('d')).where('symbol', '=', s.key).executeTakeFirst())?.d ?? null;
    const from = last ? addDays(last, 1) : BACKFILL_FROM;
    let candles: Candle[] = [], source: 'upstox' | 'nse' | null = null, error: string | null = null;
    if (from <= today) {
      try {
        // Upstox in chunks of 3 years (one request covers years; chunking keeps each answer small)
        for (let a = from; a <= today; a = addDays(a, 1096)) {
          const b = addDays(a, 1095) < today ? addDays(a, 1095) : today;
          candles.push(...(await retry(() => fetchUpstox(f, s.upstox, a, b), 3, wait)));
        }
        source = 'upstox';
      } catch (e1) {
        try { candles = await retry(() => fetchNse(f, s.nse, from, today), 2, wait); source = 'nse'; }
        catch (e2) { error = `upstox: ${(e1 as Error).message}; nse: ${(e2 as Error).message}`.slice(0, 500); }
      }
    }
    if (candles.length) {
      const rows = [...new Map(candles.map((c) => [c.day, c])).values()].map((c) => ({ symbol: s.key, day: c.day, open: c.open === null ? null : String(c.open), high: c.high === null ? null : String(c.high), low: c.low === null ? null : String(c.low), close: String(c.close), source: source! }));
      for (let i = 0; i < rows.length; i += 500) {
        await deps.db.insertInto('market_daily').values(rows.slice(i, i + 500))
          .onConflict((oc) => oc.columns(['symbol', 'day']).doUpdateSet((eb) => ({ close: eb.ref('excluded.close'), open: eb.ref('excluded.open'), high: eb.ref('excluded.high'), low: eb.ref('excluded.low'), source: eb.ref('excluded.source'), fetched_at: sql`now()` as any }))).execute();
      }
    }
    const lastDay = candles.length ? candles.map((c) => c.day).reduce((a, b) => (a > b ? a : b), last ?? '') : last;
    await deps.db.insertInto('market_sync').values({ symbol: s.key, last_day: lastDay, last_attempt_at: now, last_ok_at: error ? null : now, last_source: source, last_error: error })
      .onConflict((oc) => oc.column('symbol').doUpdateSet({
        last_day: lastDay, last_attempt_at: now, last_error: error, ...(error ? {} : { last_ok_at: now }), ...(source ? { last_source: source } : {}),
      })).execute();
    const stale = !lastDay || lastDay < addDays(today, -STALE_DAYS);
    out.push({ symbol: s.key, added: candles.length, source, error, lastDay, stale });
  }
  const added = out.reduce((n, r) => n + r.added, 0), failed = out.filter((r) => r.error);
  if (added || failed.length) deps.log?.('market_sync', { added, failed: failed.map((r) => r.symbol) });
  return out;
}

/** hourly (MARKET_SYNC_INTERVAL_MS) and 15 s after start; MARKET_SYNC=off disables. A stale symbol raises one error event a day. */
export function startMarketSync(deps: SyncDeps, env: NodeJS.ProcessEnv = process.env): () => void {
  const every = Math.max(60_000, Number(env.MARKET_SYNC_INTERVAL_MS || 60 * 60_000));
  const alerted = new Map<string, string>();
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const res = await syncMarket(deps);
      const today = istDate(new Date());
      for (const r of res.filter((x) => x.stale)) {
        if (alerted.get(r.symbol) === today) continue;
        alerted.set(r.symbol, today);
        await captureErrorWith(deps.pool as any, new Error(`Market data for ${r.symbol} is stale (last day ${r.lastDay ?? 'none'})`),
          { source: 'server', route: 'market-sync', context: { symbol: r.symbol, lastDay: r.lastDay, error: r.error } });
      }
    } catch (e) { deps.log?.('market_sync_error', { error: (e as Error).message.slice(0, 200) }); }
    finally { busy = false; }
  };
  const t = setInterval(tick, every); t.unref();
  setTimeout(tick, 15_000).unref();
  return () => clearInterval(t);
}
