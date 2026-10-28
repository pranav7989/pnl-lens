/**
 * @file  packages/shared/src/insights/journal.ts
 * @area  Reports
 * @what  What the trade journal shows: results by setup, tag and emotion on the trades the user has journaled, how many are journaled, and plain-words highlights.
 */
/**
 * Pure. Notes are matched to trades by tradeKey (lifetime.ts), so a note written on one report applies to the same
 * trade in any other report. Only journaled trades are grouped; a group needs at least 2 trades to be compared.
 */
import { tradeKey } from './lifetime';

type Trade = Record<string, any>;
export interface NoteLike { tradeKey: string; setup: string | null; tags: string[]; emotion: string | null; note: string | null }
export interface Group { key: string; n: number; pnl: number; winRate: number; avg: number }
export interface JournalStats {
  total: number;
  journaled: number;
  bySetup: Group[];
  byTag: Group[];
  byEmotion: Group[];
  /** e.g. "breakout" made ₹X over 6 trades; "revenge" lost ₹Y */
  best: { kind: 'setup' | 'tag' | 'emotion'; key: string; pnl: number; n: number } | null;
  worst: { kind: 'setup' | 'tag' | 'emotion'; key: string; pnl: number; n: number } | null;
}

export const EMOTION_LABEL: Record<string, string> = {
  calm: 'Calm', confident: 'Confident', fomo: 'FOMO', fear: 'Fear', revenge: 'Revenge', bored: 'Bored', tired: 'Tired', greedy: 'Greedy',
};

function group(pairs: [string, Trade][]): Group[] {
  const by = new Map<string, Trade[]>();
  for (const [k, t] of pairs) by.set(k, [...(by.get(k) || []), t]);
  return [...by.entries()].map(([key, ts]) => {
    const pnl = ts.reduce((s, t) => s + t.pnl, 0);
    return { key, n: ts.length, pnl, winRate: ts.filter((t) => t.pnl > 0).length / ts.length, avg: pnl / ts.length };
  }).sort((a, b) => b.pnl - a.pnl);
}

export function journalStats(trades: Trade[], notes: NoteLike[]): JournalStats {
  const T = (trades || []).filter((t) => Number.isFinite(t?.pnl));
  const byKey = new Map(notes.map((n) => [n.tradeKey, n]));
  const pairs = T.map((t) => [t, byKey.get(tradeKey(t))] as const).filter((p): p is readonly [Trade, NoteLike] => !!p[1]);
  const bySetup = group(pairs.filter(([, n]) => n.setup).map(([t, n]) => [n.setup!, t]));
  const byTag = group(pairs.flatMap(([t, n]) => (n.tags || []).map((g) => [g, t] as [string, Trade])));
  const byEmotion = group(pairs.filter(([, n]) => n.emotion).map(([t, n]) => [EMOTION_LABEL[n.emotion!] || n.emotion!, t]));
  const all = [...bySetup.map((g) => ({ kind: 'setup' as const, ...g })), ...byTag.map((g) => ({ kind: 'tag' as const, ...g })), ...byEmotion.map((g) => ({ kind: 'emotion' as const, ...g }))].filter((g) => g.n >= 2);
  const best = all.filter((g) => g.pnl > 0).sort((a, b) => b.pnl - a.pnl)[0] || null;
  const worst = all.filter((g) => g.pnl < 0).sort((a, b) => a.pnl - b.pnl)[0] || null;
  const pick = (g: typeof best) => (g ? { kind: g.kind, key: g.key, pnl: g.pnl, n: g.n } : null);
  return { total: T.length, journaled: pairs.length, bySetup, byTag, byEmotion, best: pick(best), worst: pick(worst) };
}
