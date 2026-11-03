/**
 * @file  packages/shared/src/insights/share.ts
 * @area  Reports
 * @what  The "My Trading Discipline" share card (docs/SHARE_CARD.md): habit and discipline tiles only (no results, returns, money, names or securities), the deterministic slot filling, the founding badge text, the disclaimer and every layout, colour and text style the browser draws with.
 */
/**
 * Pure. Legal safety rule (owner, 3 Nov 2026): the card shows how a trader keeps to their process, never what they
 * earned. No profit or loss, no return or win rate, no best trade/day/month, no security or underlying name, no money,
 * no person's name: so a card can never read as a claim of returns or performance in a security (SEBI circular of
 * Oct 2024 on unregistered persons) or as investment advice. Every value is a count of plan rules, habits, months or
 * trades reviewed, a habit's name or a level. The disclaimer is drawn on every card and cannot be switched off. The
 * browser draws the card (apps/web/components/workspace/share-draw.ts); all text and geometry live here, once.
 */

export type TileKey = 'planKept' | 'habitsFixed' | 'improving' | 'level' | 'topHabit' | 'months' | 'habits' | 'tradesReviewed';
export interface Tile { key: TileKey; label: string; value: string; sub?: string }
export type SlotId = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'C3';
export interface PlacedTile extends Tile { slot: SlotId; x: number; y: number; w: number; h: number }
export interface ShareOpts {
  planCheck?: { met: number; measured: number } | null;
  foundingNo?: number | null;
  /** the hero the user picked (must be eligible); default: the first in the hero order */
  hero?: TileKey | null;
  /** tiles the user switched off; the pool refills their slots (never below min(7, eligible)) */
  exclude?: TileKey[];
  /** show the founding badge (default true when there is a number) */
  badge?: boolean;
}
export interface ShareCardData {
  period: string;
  hero: PlacedTile;
  tiles: PlacedTile[];
  /** every eligible hero achievement, for the hero picker */
  heroOptions: TileKey[];
  /** every eligible non-hero tile, for the tile chips */
  options: TileKey[];
  /** keys that may be switched off now (a spare tile can take the slot) */
  removable: TileKey[];
  founding: string | null;
  /** the two disclaimer lines drawn on every card */
  disclaimer: [string, string];
  /** tiles shown (hero included); fewer than 7 when the report has fewer */
  count: number;
  summary: string;
}

/* ------------------------------------------------------------------ design constants (spec §2, §5) */
export const CARD = { w: 1080, h: 1728 } as const;
export const STORY = { w: 1080, h: 1920 } as const;
export const COLORS = {
  bg: '#000000', ink: '#0A0A0A', white: '#FFFFFF', grey: '#9A9A9A', card: '#1A1A1A',
  yellow: '#FFD400', green: '#2BB673', blue: '#3D8BFF', purple: '#A66BFF', orange: '#FF9F1C',
  gold1: '#FFE27A', gold2: '#E0A800',
} as const;
/** the only 5 text styles (Manrope); sizes in px. Body may be drawn at 44px for "pnllens.com". */
export const TEXT = {
  display: { weight: 800, size: 104 },
  value: { weight: 800, size: 88, min: 40, step: 4 },
  label: { weight: 800, size: 28, spacing: 0.04 },
  body: { weight: 700, size: 32, url: 44 },
  small: { weight: 600, size: 24 },
} as const;
export const LAYOUT = {
  margin: 72, width: 936, gap: 20, radius: 28, border: 3, glowBlur: 24, glowAlpha: 0.35, pad: 32,
  logo: { x: 72, y: 72, size: 64 },
  periodY: 104,
  title: { x: 72, line1: 290, line2: 400 },
  badge: { x: 72, y: 450, w: 520, h: 120 },
  rows: {
    A: { y: 620, h: 340, slots: [['A1', 560], ['A2', 356]] },
    B: { y: 980, h: 250, slots: [['B1', 448], ['B2', 468]] },
    C: { y: 1250, h: 220, slots: [['C1', 380], ['C2', 272], ['C3', 244]] },
  } as Record<'A' | 'B' | 'C', { y: number; h: number; slots: [SlotId, number][] }>,
  /** tiles sit between the badge and the footer; fewer rows are centred in this band */
  band: { top: 620, bottom: 1470 },
  footer: { y: 1500, qr: 164, qrModule: 4, line1Y: 1540, urlY: 1596, noteY: 1644, note2Y: 1676 },
} as const;
export interface SlotStyle { fill: string; border: string | null; value: string; labelInk: string; icon?: 'trophy' }
export const SLOT_STYLE: Record<SlotId, SlotStyle> = {
  A1: { fill: COLORS.yellow, border: null, value: COLORS.ink, labelInk: COLORS.ink, icon: 'trophy' },
  A2: { fill: COLORS.card, border: COLORS.green, value: COLORS.white, labelInk: COLORS.grey },
  B1: { fill: COLORS.card, border: COLORS.blue, value: COLORS.blue, labelInk: COLORS.grey },
  B2: { fill: COLORS.card, border: COLORS.purple, value: COLORS.purple, labelInk: COLORS.grey },
  C1: { fill: COLORS.orange, border: null, value: COLORS.ink, labelInk: COLORS.ink },
  C2: { fill: COLORS.card, border: COLORS.green, value: COLORS.green, labelInk: COLORS.grey },
  C3: { fill: COLORS.card, border: COLORS.yellow, value: COLORS.yellow, labelInk: COLORS.grey },
};
export const COPY = {
  title1: 'MY TRADING', title2: 'DISCIPLINE', brand: 'PnL Lens', founding: 'FOUNDING TRADER',
  footer: 'My own trades, reviewed with PnL Lens.', url: 'pnllens.com',
  /** always on the card, never switched off */
  note: 'Not investment advice or a recommendation.',
  /** India: SEBI by name; elsewhere the general wording */
  note2: { india: 'PnL Lens is not registered with SEBI.', global: 'PnL Lens is not a registered investment adviser.' },
  file: { card: 'pnl-lens-discipline.png', story: 'pnl-lens-discipline-story.png' },
  shareText: 'My trading discipline, reviewed with PnL Lens',
} as const;

/* ------------------------------------------------------------------ tile catalogue: discipline only */
export const LABELS: Record<TileKey, string> = {
  planKept: '30-day plan', habitsFixed: 'Habits fixed', improving: 'Months improving', level: 'Level reached',
  topHabit: 'Strongest habit', months: 'Months reviewed', habits: 'Habits tracked', tradesReviewed: 'Trades reviewed',
};
/** short names for the dialog's chips */
export const CHIP: Record<TileKey, string> = {
  planKept: '30-day plan kept', habitsFixed: 'Habits fixed', improving: 'Months improving', level: 'Level reached',
  topHabit: 'Strongest habit', months: 'Months reviewed', habits: 'Habits tracked', tradesReviewed: 'Trades reviewed',
};
const HERO_ORDER: TileKey[] = ['planKept', 'habitsFixed', 'improving', 'level', 'tradesReviewed'];
const DEFAULTS: [SlotId, TileKey][] = [['A2', 'topHabit'], ['B1', 'level'], ['B2', 'habitsFixed'], ['C1', 'months'], ['C2', 'habits'], ['C3', 'tradesReviewed']];
const POOL: TileKey[] = ['planKept', 'improving', 'level', 'habitsFixed', 'topHabit', 'months', 'habits', 'tradesReviewed'];
export const MIN_TILES = 7;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HIGH_LEVELS = ['Steady', 'Disciplined', 'Elite'];
/** a habit dimension counts as "strongest" from this Progress score up */
const TOP_HABIT_MIN = 70;

export function periodLabel(from?: string | null, to?: string | null): string {
  if (!from || !to) return '';
  const f = String(from).slice(0, 10), t = String(to).slice(0, 10);
  const fm = MON[Number(f.slice(5, 7)) - 1], tm = MON[Number(t.slice(5, 7)) - 1];
  if (!fm || !tm) return '';
  if (f.slice(0, 7) === t.slice(0, 7)) return `${tm} ${t.slice(0, 4)}`;
  return f.slice(0, 4) === t.slice(0, 4) ? `${fm}–${tm} ${t.slice(0, 4)}` : `${fm} ${f.slice(0, 4)} – ${tm} ${t.slice(0, 4)}`;
}

/** "#0427 / 1000" */
export const foundingLabel = (n: number) => `#${String(Math.trunc(n)).padStart(4, '0')} / 1000`;

/** India reports name SEBI in the disclaimer; others use the general wording. */
export const isIndia = (report: any) => report?.m?.market === 'India' || report?.m?.currency === 'INR';
export const disclaimerFor = (report: any): [string, string] => [COPY.note, isIndia(report) ? COPY.note2.india : COPY.note2.global];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const HERO_TEXT: Partial<Record<TileKey, (t: Tile) => Pick<Tile, 'value' | 'sub'>>> = {
  planKept: (t) => ({ value: t.value, sub: 'from my 30-day plan' }),
  habitsFixed: (t) => ({ value: `${plural(Number(t.value), 'habit')} fixed` }),
  improving: (t) => ({ value: `${t.value} months improving` }),
  level: (t) => ({ value: `Reached ${t.value}` }),
};

/** Every tile this report can show: each only when it is a real discipline strength. */
export function eligibleTiles(report: any, opts: Pick<ShareOpts, 'planCheck'> = {}): Map<TileKey, Tile> {
  const n = (report?.trades || []).filter((t: any) => Number.isFinite(t?.pnl)).length;
  const P = report?.progress || null;
  const out = new Map<TileKey, Tile>();
  const put = (key: TileKey, value: string, sub?: string) => out.set(key, { key, label: LABELS[key], value, ...(sub ? { sub } : {}) });

  const pc = opts.planCheck;
  if (pc && pc.measured > 0 && pc.met >= 3) put('planKept', `${pc.met} of ${pc.measured} rules kept`);

  const fixed = Array.isArray(P?.tracker) ? P.tracker.filter((t: any) => t?.status === 'fixed').length : 0;
  if (fixed >= 1) put('habitsFixed', String(fixed));

  const streak = Number(P?.improvingStreak) || 0;
  if (streak >= 2) put('improving', String(streak));

  const lvl = P?.level?.name;
  if (typeof lvl === 'string' && HIGH_LEVELS.includes(lvl)) put('level', lvl);

  // the habit dimension with the highest Progress score (70+), named; ties keep the Progress order
  const labels = P?.labels && typeof P.labels === 'object' ? P.labels as Record<string, string> : {};
  const d = P?.overall?.d && typeof P.overall.d === 'object' ? P.overall.d as Record<string, number> : {};
  const top = Object.keys(labels).filter((k) => Number.isFinite(d[k]) && d[k] >= TOP_HABIT_MIN)
    .reduce<string | null>((best, k) => (best === null || d[k] > d[best] ? k : best), null);
  if (top) put('topHabit', labels[top]);

  const months = Array.isArray(P?.months) ? P.months.length : 0;
  if (months >= 1) put('months', String(months));
  const habits = Object.keys(labels).length;
  if (habits) put('habits', String(habits));
  if (n) put('tradesReviewed', String(n));
  return out;
}

/** Fill the 6 other slots: defaults first, then the pool, skipping used and excluded tiles; empty when nothing is left. */
function fill(tiles: Map<TileKey, Tile>, hero: TileKey, exclude: Set<TileKey>): [SlotId, TileKey | null][] {
  const used = new Set<TileKey>([hero]);
  const ok = (k: TileKey) => tiles.has(k) && !used.has(k) && !exclude.has(k);
  return DEFAULTS.map(([slot, def]) => {
    const k = ok(def) ? def : POOL.find(ok) ?? null;
    if (k) used.add(k);
    return [slot, k];
  });
}

/** Rectangles for the tiles shown: rows keep their order; a row with fewer tiles shares its width; fewer rows are centred. */
function place(filled: [SlotId, Tile][]): PlacedTile[] {
  const rowOf = (s: SlotId) => s[0] as 'A' | 'B' | 'C';
  const rows = (['A', 'B', 'C'] as const).map((r) => ({ r, items: filled.filter(([s]) => rowOf(s) === r) })).filter((x) => x.items.length);
  const L = LAYOUT, total = rows.reduce((s, x) => s + L.rows[x.r].h, 0) + L.gap * (rows.length - 1);
  let y = rows.length === 3 ? L.band.top : Math.round(L.band.top + (L.band.bottom - L.band.top - total) / 2);
  const out: PlacedTile[] = [];
  for (const { r, items } of rows) {
    const spec = L.rows[r], full = items.length === spec.slots.length;
    const even = (L.width - L.gap * (items.length - 1)) / items.length;
    let x = L.margin;
    for (const [slot, t] of items) {
      const w = full ? spec.slots.find(([s]) => s === slot)![1] : even;
      out.push({ ...t, slot, x, y, w, h: spec.h });
      x += w + L.gap;
    }
    y += spec.h + L.gap;
  }
  return out;
}

export function shareCard(report: any, opts: ShareOpts = {}): ShareCardData {
  const tiles = eligibleTiles(report, opts);
  const heroOptions = HERO_ORDER.filter((k) => tiles.has(k));
  const hero = opts.hero && heroOptions.includes(opts.hero) ? opts.hero : heroOptions[0] ?? 'tradesReviewed';
  const exclude = new Set((opts.exclude || []).filter((k) => k !== hero));
  const want = Math.min(MIN_TILES, tiles.size);
  // a switched-off tile stays off only while the card still shows min(7, eligible) tiles
  const keep = new Set<TileKey>();
  for (const k of exclude) { keep.add(k); if (fill(tiles, hero, keep).filter(([, x]) => x).length + 1 < want) keep.delete(k); }
  const slots = fill(tiles, hero, keep);
  const shown = new Set<TileKey>([hero, ...slots.map(([, k]) => k).filter((k): k is TileKey => !!k)]);
  const options = [...tiles.keys()].filter((k) => k !== hero);
  const removable = [...shown].filter((k) => k !== hero && fill(tiles, hero, new Set([...keep, k])).filter(([, x]) => x).length + 1 >= want);
  // as the hero, an achievement reads as one sentence under "Biggest achievement"
  const base = tiles.get(hero) ?? { key: 'tradesReviewed' as TileKey, label: LABELS.tradesReviewed, value: '0' };
  const heroTile: Tile = HERO_TEXT[hero] ? { key: hero, label: 'Biggest achievement', ...HERO_TEXT[hero]!(base) } : base;
  const placed = place([['A1', heroTile], ...slots.filter((s): s is [SlotId, TileKey] => !!s[1]).map(([s, k]) => [s, tiles.get(k)!] as [SlotId, Tile])]);
  const fno = Number.isInteger(opts.foundingNo) && opts.foundingNo! >= 1 && opts.foundingNo! <= 1000 ? opts.foundingNo! : null;
  const founding = fno && opts.badge !== false ? foundingLabel(fno) : null;
  const m = report?.m || {};
  const summary = placed.map((t) => `${t.label}: ${t.value}${t.sub ? ` (${t.sub})` : ''}`).join('; ');
  return {
    period: periodLabel(m.from, m.to), hero: placed[0], tiles: placed.slice(1), heroOptions, options, removable, founding,
    disclaimer: disclaimerFor(report), count: placed.length, summary,
  };
}
