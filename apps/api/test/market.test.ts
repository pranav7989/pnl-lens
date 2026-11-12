/**
 * @file  apps/api/test/market.test.ts
 * @area  Tests
 * @what  Market data: automatic sync (Upstox, only the missing days, retries, NSE fallback, status and stale flag when both fail) with a fake network; the report route (India only, masked for other markets, owner only).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDbAvailable, makeUser, givePlan, readyAnalysis, golden } from '@pnl-lens/db/testing';
import { createDb } from '@pnl-lens/db';
import { testApp, as, type TestApp } from './helpers.js';
import { syncMarket, BACKFILL_FROM, SYMBOLS } from '../src/lib/market-sync.js';

const ok = await testDbAvailable();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const candles = (days: string[], base: number) => ({ status: 'success', data: { candles: days.map((d, i) => [`${d}T00:00:00+05:30`, base + i, base + i + 1, base + i - 1, base + i, 0, 0]) } });

describe.skipIf(!ok)('market data', () => {
  let x: TestApp, db: ReturnType<typeof createDb>['db'], destroy: () => Promise<void>;
  beforeAll(async () => { x = await testApp('t_api_market'); const c = createDb({ connectionString: x.t.appUrl, max: 2, ssl: false }); db = c.db; destroy = () => c.db.destroy(); });
  afterAll(async () => { await destroy?.(); await x?.close(); });
  const pool = { query: (q: string, p?: unknown[]) => x.t.admin.query(q, p as any[]) };

  it('Upstox: backfill from 2020, then only the missing days; status recorded', async () => {
    const urls: string[] = [];
    const fetch1 = (async (u: string) => { urls.push(String(u)); return json(candles(['2025-01-02', '2025-01-03'], 100)); }) as any;
    const now = new Date('2025-01-03T14:00:00Z');
    const r1 = await syncMarket({ db, pool, fetch: fetch1, retryWaitMs: 1 }, now);
    expect(r1.map((r) => r.source)).toEqual(['upstox', 'upstox', 'upstox']);
    expect(urls[0]).toContain(`/day/`);
    expect(urls[0]).toContain(`/${BACKFILL_FROM}`);                          // first run: from the backfill start
    expect(urls.some((u) => u.includes(encodeURIComponent('NSE_INDEX|India VIX')))).toBe(true);
    expect((await x.t.admin.query(`select count(*)::int n from market_daily`)).rows[0].n).toBe(6);
    urls.length = 0;
    await syncMarket({ db, pool, fetch: fetch1, retryWaitMs: 1 }, new Date('2025-01-07T14:00:00Z'));
    expect(urls.every((u) => u.endsWith('/2025-01-04'))).toBe(true);        // only after the last stored day
    const st = (await x.t.admin.query(`select last_day::text as last_day, last_error, last_source from market_sync order by symbol`)).rows;
    expect(st.map((s) => s.last_day)).toEqual(['2025-01-03', '2025-01-03', '2025-01-03']);
    expect(st.every((s) => s.last_error === null && s.last_source === 'upstox')).toBe(true);
  });

  it('retries, then NSE as fallback; when both fail the status says why and the data is flagged stale', async () => {
    let upstoxCalls = 0;
    const nseRow = (d: string, v: number) => ({ EOD_TIMESTAMP: d, EOD_CLOSE_INDEX_VAL: v, EOD_OPEN_INDEX_VAL: v, EOD_HIGH_INDEX_VAL: v, EOD_LOW_INDEX_VAL: v });
    const fetchNseOk = (async (u: string) => {
      const s = String(u);
      if (s.includes('upstox')) { upstoxCalls++; return json({ status: 'error' }, 503); }
      if (s === 'https://www.nseindia.com/') return new Response('ok', { headers: { 'set-cookie': 'nsit=abc; Path=/' } });
      if (s.includes('vixhistory')) return json({ data: [nseRow('08-JAN-2025', 14.2)] });
      return json({ data: { indexCloseOnlineRecords: [nseRow('08-JAN-2025', 23500)] } });
    }) as any;
    const r = await syncMarket({ db, pool, fetch: fetchNseOk, retryWaitMs: 1 }, new Date('2025-01-08T14:00:00Z'));
    expect(upstoxCalls).toBe(3 * SYMBOLS.length);                           // 3 tries each
    expect(r.every((x) => x.source === 'nse' && x.added === 1 && !x.stale)).toBe(true);

    const down = (async () => json({}, 503)) as any;
    const bad = await syncMarket({ db, pool, fetch: down, retryWaitMs: 1 }, new Date('2025-01-20T14:00:00Z'));
    expect(bad.every((x) => x.error && x.stale && x.lastDay === '2025-01-08')).toBe(true);
    const st = (await x.t.admin.query(`select last_error, last_day::text as last_day from market_sync where symbol = 'NIFTY'`)).rows[0];
    expect(st.last_error).toMatch(/upstox: HTTP 503; nse: /);
    expect(st.last_day).toBe('2025-01-08');                                   // nothing lost
  });

  it('report route: India only (masked for other markets), owner only', async () => {
    const u = await makeUser(x.t);
    await givePlan(x.t, u, { reports: 2 });
    const save = async (g: string) => { const { analysisId } = await readyAnalysis(x.t, u, { report: golden(g) }); return (await x.app.inject({ method: 'POST', url: '/api/v1/reports', headers: await as(u), payload: { analysisId } })).json().id; };
    const india = await save('zerodha_tradebook_csv'), crypto = await save('binance_trades_csv');
    await x.t.admin.query(`delete from market_daily`);
    const tb = golden('zerodha_tradebook_csv');
    const days = [...new Set(tb.trades.map((t: any) => t.entryDate || t.exitDate))].sort() as string[];
    const all = ['2024-12-31', ...days];
    for (const [sym, base] of [['NIFTY', 23000], ['BANKNIFTY', 49000], ['INDIAVIX', 14]] as const) {
      await x.t.admin.query(`insert into market_daily (symbol, day, close, source) select $1, d::date, $2::numeric + (row_number() over ()) * $3::numeric, 'upstox' from unnest($4::text[]) d`, [sym, base, sym === 'INDIAVIX' ? 0.1 : 10, all]);
    }
    const get = async (id: string, by = u) => x.app.inject({ method: 'GET', url: `/api/v1/reports/${id}/market`, headers: await as(by) });
    const m = (await get(india)).json();
    expect(m.available).toBe(true);
    expect(m.nifty.changePct).toBeGreaterThan(0);
    expect(m.byVix.length).toBeGreaterThan(0);
    expect(m.byMove.reduce((s: number, b: any) => s + b.n, 0)).toBeGreaterThan(0);
    expect((await get(crypto)).json()).toEqual({ available: false, reason: 'not_india' });
    expect((await get(india, await makeUser(x.t))).statusCode).toBe(404);
  });

  it('grants: the app reads and writes market data; the worker cannot', async () => {
    await x.t.admin.query('set role lens_worker');
    try { await expect(x.t.admin.query('select 1 from market_daily limit 1')).rejects.toMatchObject({ code: '42501' }); }
    finally { await x.t.admin.query('reset role'); }
  });
});
