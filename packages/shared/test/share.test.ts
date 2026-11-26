/**
 * @file  packages/shared/test/share.test.ts
 * @area  Tests
 * @what  Share card ("My Trading Discipline") on every golden report: no results, returns, percentages, money, names, securities or underlyings (legal safety rule); the disclaimer always present (SEBI named for India); deterministic slot filling; formats; layout fits; the committed QR reads back as SHARE_URL.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import jsQR from 'jsqr';
import { shareCard, eligibleTiles, periodLabel, foundingLabel, disclaimerFor, LAYOUT, CARD, TEXT, MIN_TILES, COPY, type TileKey } from '../src/insights/share';
import { SHARE_QR, SHARE_URL } from '../src/insights/share-qr';

const dir = join(__dirname, '../../engine/test/golden');
const goldens = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ name: f, report: JSON.parse(readFileSync(join(dir, f), 'utf8')).report })).filter((g) => g.report);
const get = (n: string) => goldens.find((g) => g.name === n)!.report;
const tb = get('zerodha_tradebook_csv.json');           // 3 months, Disciplined, 2 habits fixed
const fo = get('zerodha_fo_statement_xlsx.json');       // no dates, no months
const groww = get('groww_pnl_csv.json');                // 5 trades, 1 month
const ibkr = get('ibkr_tradebook_csv.json');            // USD
const keys = (c: ReturnType<typeof shareCard>) => [c.hero.key, ...c.tiles.map((t) => t.key)];
const PLAN = { planCheck: { met: 4, measured: 5 } };

/** anything that would make the card a claim of results or returns, or name a security or a person */
const RESULT_WORDS = /%|[₹$€£¥]|\b(INR|USD|EUR|GBP|Rs\.?|rupees?|dollars?|lakh|crore|profit|loss|losses|gain|return|returns|won|win|wins|winning|best|worst|green|red|P&L|pnl|points?|target|edge|pro)\b/i;

describe('legal safety: no results, returns, money, names or securities on any golden report', () => {
  for (const g of goldens) {
    it(g.name, () => {
      for (const opts of [{}, { ...PLAN, foundingNo: 427 }]) {
        const c = shareCard(g.report, opts);
        const shown = [c.hero, ...c.tiles].flatMap((t) => [t.label, t.value, t.sub ?? '']).join(' | ');
        expect(shown).not.toMatch(RESULT_WORDS);
        // no security, contract or underlying name anywhere on the card
        for (const t of g.report.trades) {
          for (const name of [t.symbol, t.underlying].filter((x) => typeof x === 'string' && x.length >= 2)) {
            const esc = String(name).toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            expect(shown.toUpperCase()).not.toMatch(new RegExp(`(^|[^A-Z0-9])${esc}([^A-Z0-9]|$)`));
          }
        }
        if (g.report.m.clientId) expect(JSON.stringify(c)).not.toContain(String(g.report.m.clientId));
        // the disclaimer is always there
        expect(c.disclaimer[0]).toBe('Not investment advice or a recommendation.');
        expect(c.disclaimer[1]).toMatch(/^PnL Lens is not (registered with SEBI|a registered investment adviser)\.$/);
        // no duplicates; same report, same card
        expect(new Set(keys(c)).size).toBe(keys(c).length);
        expect(shareCard(g.report, opts)).toEqual(c);
        expect(c.count).toBe(Math.min(MIN_TILES, eligibleTiles(g.report, opts).size));
        expect(c.count).toBeGreaterThanOrEqual(1);
      }
    });
  }
  it('the card copy itself makes no claim', () => {
    const copy = [COPY.title1, COPY.title2, COPY.footer, COPY.note, COPY.note2.india, COPY.note2.global, COPY.shareText].join(' ');
    expect(copy.replaceAll('PnL Lens', '')).not.toMatch(RESULT_WORDS);
  });
});

describe('disclaimer', () => {
  it('names SEBI for India, general wording elsewhere', () => {
    expect(disclaimerFor(tb)[1]).toBe('PnL Lens is not registered with SEBI.');
    expect(disclaimerFor(ibkr)[1]).toBe('PnL Lens is not a registered investment adviser.');
    expect(shareCard(tb).disclaimer).toEqual(disclaimerFor(tb));
  });
});

describe('tiles', () => {
  it('each tile only when it is a real discipline strength', () => {
    for (const g of goldens) {
      const P = g.report.progress;
      const t = eligibleTiles(g.report, { planCheck: { met: 2, measured: 5 } });
      expect(t.has('planKept')).toBe(false);                                         // 2 kept is not shown
      expect(t.has('level')).toBe(['Steady', 'Disciplined', 'Elite'].includes(P?.level?.name));
      expect(t.has('habitsFixed')).toBe((P?.tracker || []).some((x: any) => x.status === 'fixed'));
      expect(t.has('improving')).toBe((P?.improvingStreak || 0) >= 2);
      expect(t.has('months')).toBe((P?.months || []).length >= 1);
      const top = t.get('topHabit');
      if (top) expect(Object.values(P.labels)).toContain(top.value);
    }
  });
  it('values', () => {
    const t = eligibleTiles(tb, PLAN);
    expect(t.get('planKept')).toMatchObject({ label: '30-day plan', value: '4 of 5 rules kept' });
    expect(t.get('habitsFixed')).toMatchObject({ label: 'Habits fixed', value: '2' });
    expect(t.get('level')!.value).toBe('Disciplined');
    expect(t.get('topHabit')!.value).toBe('Trade selection');                     // activity 100 comes before costs 100
    expect(t.get('months')!.value).toBe('3');
    expect(t.get('habits')!.value).toBe('6');
    expect(t.get('tradesReviewed')!.value).toBe('96');
  });
  it('a statement without dates still gets a card, with fewer tiles', () => {
    const c = shareCard(fo);
    expect(keys(c)).not.toContain('months');
    expect(c.count).toBeLessThan(MIN_TILES);
    expect(c.hero.key).toBe('tradesReviewed');
    expect(c.hero.label).toBe('Trades reviewed');
  });
});

describe('slot filling', () => {
  it('hero order: plan kept → habits fixed → months improving → level → trades reviewed', () => {
    expect(shareCard(tb, PLAN).hero).toMatchObject({ key: 'planKept', label: 'Biggest achievement', value: '4 of 5 rules kept', sub: 'from my 30-day plan' });
    expect(shareCard(tb).hero).toMatchObject({ key: 'habitsFixed', label: 'Biggest achievement', value: '2 habits fixed' });
    expect(shareCard(tb, PLAN).tiles.find((t) => t.key === 'habitsFixed')).toMatchObject({ label: 'Habits fixed', value: '2' });
    for (const t of shareCard(tb, PLAN).tiles) expect(t.label).not.toBe('Biggest achievement');
    const lvl = shareCard(tb, { hero: 'level' });
    expect(lvl.hero).toMatchObject({ key: 'level', label: 'Biggest achievement', value: 'Reached Disciplined' });
    expect(lvl.tiles.map((t) => t.key)).not.toContain('level' as TileKey);
    expect(lvl.tiles.map((t) => t.key)).toContain('habitsFixed');
    expect(shareCard(tb, { hero: 'topHabit' }).hero.key).toBe('habitsFixed');      // not a hero achievement
  });
  it('defaults, then the pool; 7 tiles with a plan', () => {
    const c = shareCard(tb, PLAN);
    expect(c.tiles.map((t) => [t.slot, t.key])).toEqual([['A2', 'topHabit'], ['B1', 'level'], ['B2', 'habitsFixed'], ['C1', 'months'], ['C2', 'habits'], ['C3', 'tradesReviewed']]);
    expect(c.count).toBe(7);
  });
  it('switching a tile off: refilled from the pool when a spare exists; otherwise it stays', () => {
    const c = shareCard(tb, { ...PLAN, exclude: ['months'] });
    expect(c.count).toBe(7);                                                       // nothing spare: months stays
    expect(c.removable).toEqual([]);
    expect(shareCard(groww, { exclude: ['habits'] }).count).toBe(shareCard(groww).count);
  });
  it('founding badge: shown with a number unless hidden; never changes the tiles', () => {
    expect(shareCard(tb, { foundingNo: 427 }).founding).toBe('#0427 / 1000');
    expect(shareCard(tb, { foundingNo: 427, badge: false }).founding).toBeNull();
    expect(shareCard(tb).founding).toBeNull();
    expect(shareCard(tb, { foundingNo: 1001 }).founding).toBeNull();
    expect(keys(shareCard(tb, { foundingNo: 427 }))).toEqual(keys(shareCard(tb)));
  });
});

describe('formats and layout', () => {
  it('period and founding labels', () => {
    expect(foundingLabel(427)).toBe('#0427 / 1000');
    expect(foundingLabel(1000)).toBe('#1000 / 1000');
    expect(periodLabel('2026-04-02', '2026-09-30')).toBe('Apr–Sep 2026');
    expect(periodLabel('2024-11-02', '2025-02-01')).toBe('Nov 2024 – Feb 2025');
    expect(periodLabel(null, null)).toBe('');
  });
  it('rows span the content width; tiles and footer fit the card', () => {
    for (const r of Object.values(LAYOUT.rows)) expect(r.slots.reduce((s, [, w]) => s + w, 0) + LAYOUT.gap * (r.slots.length - 1)).toBe(LAYOUT.width);
    expect(LAYOUT.margin * 2 + LAYOUT.width).toBe(CARD.w);
    expect(LAYOUT.rows.C.y + LAYOUT.rows.C.h).toBeLessThanOrEqual(LAYOUT.footer.y);
    expect(LAYOUT.footer.note2Y).toBeLessThanOrEqual(CARD.h - 40);
    expect(Object.keys(TEXT)).toHaveLength(5);
    for (const g of goldens) {
      const c = shareCard(g.report, PLAN);
      for (const t of [c.hero, ...c.tiles]) { expect(t.x + t.w).toBeLessThanOrEqual(LAYOUT.margin + LAYOUT.width + 0.01); expect(t.y).toBeGreaterThanOrEqual(LAYOUT.band.top); expect(t.y + t.h).toBeLessThanOrEqual(LAYOUT.band.bottom); }
    }
  });
});

describe('QR code', () => {
  it('the committed modules read back as SHARE_URL, which carries no user data', () => {
    const n = SHARE_QR.length, q = 4, s = 4, size = (n + q * 2) * s;
    expect(SHARE_QR.every((r) => r.length === n && /^[01]+$/.test(r))).toBe(true);
    const px = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (SHARE_QR[y][x] === '1')
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) { const i = (((y + q) * s + dy) * size + (x + q) * s + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
    expect(jsQR(px, size, size)?.data).toBe(SHARE_URL);
    expect(SHARE_URL).toBe('https://pnllens.com/?utm_source=share_card&utm_medium=qr');
    expect(LAYOUT.footer.qr).toBe((n + q * 2) * LAYOUT.footer.qrModule);
  });
});
