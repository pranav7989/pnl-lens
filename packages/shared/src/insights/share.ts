/**
 * @file  packages/shared/src/insights/share.ts
 * @area  Reports
 * @what  The shareable progress card's content (analysis roadmap B4): level and score, and the stats the user picks (win rate, edge verdict, plan rules met, green days, % return), never a money amount, a name or a symbol.
 */
/**
 * Pure. Everything here is a level, a score, a percentage, a count or a verdict, so a card can be posted publicly
 * without showing how much money the person has or trades. The browser draws it (components/workspace/ShareCard.tsx).
 */
import { edgeVerdict } from './edge';
import { consistency } from './deep';
import { capitalStats } from './capital';

export type ShareKey = 'winRate' | 'edge' | 'plan' | 'greenDays' | 'return' | 'payoff';
export interface ShareItem { key: ShareKey; label: string; value: string }
export interface ShareCardData { level: string | null; score: number | null; nextLevel: string | null; period: string; trades: number; items: ShareItem[]; available: ShareKey[] }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const VERDICT: Record<string, string> = { real: 'Edge looks real', unproven: 'Edge not proven yet', negative: 'Edge negative', 'too-few': 'Too few trades' };

export function periodLabel(from?: string | null, to?: string | null): string {
  if (!from || !to) return '';
  const f = String(from).slice(0, 10), t = String(to).slice(0, 10);
  const fm = MON[Number(f.slice(5, 7)) - 1], tm = MON[Number(t.slice(5, 7)) - 1];
  if (f.slice(0, 7) === t.slice(0, 7)) return `${tm} ${t.slice(0, 4)}`;
  return f.slice(0, 4) === t.slice(0, 4) ? `${fm}–${tm} ${t.slice(0, 4)}` : `${fm} ${f.slice(0, 4)} – ${tm} ${t.slice(0, 4)}`;
}

export function shareCard(report: any, opts: { include?: ShareKey[]; planCheck?: { met: number; measured: number } | null; capital?: number | null } = {}): ShareCardData {
  const T = (report?.trades || []).filter((t: any) => Number.isFinite(t?.pnl));
  const m = report?.m || {}, P = report?.progress || null;
  const months = P?.months || [];
  const score: number | null = months.length ? months[months.length - 1].score : P?.overall?.score ?? null;
  const all: ShareItem[] = [];
  if (T.length) all.push({ key: 'winRate', label: 'Trades won', value: `${Math.round((T.filter((t: any) => t.pnl > 0).length / T.length) * 100)}%` });
  const e = edgeVerdict(T);
  if (e.verdict !== 'too-few') all.push({ key: 'edge', label: 'Skill or luck', value: VERDICT[e.verdict] });
  if (opts.planCheck && opts.planCheck.measured) all.push({ key: 'plan', label: '30-day plan', value: `${opts.planCheck.met} of ${opts.planCheck.measured} rules met` });
  const c = consistency(T);
  if (c) all.push({ key: 'greenDays', label: 'Green days', value: `${Math.round(c.greenDays * 100)}%` });
  if (Number.isFinite(m.payoff) && m.payoff > 0) all.push({ key: 'payoff', label: 'Win ÷ loss size', value: `${(Math.round(m.payoff * 100) / 100).toFixed(2)}×` });
  const cap = capitalStats(T, opts.capital ?? null);
  if (cap) all.push({ key: 'return', label: 'Return on capital', value: `${cap.returnPct > 0 ? '+' : cap.returnPct < 0 ? '−' : ''}${Math.abs(cap.returnPct).toFixed(1)}%` });
  const available = all.map((i) => i.key);
  const want = opts.include ?? (['winRate', 'edge', 'plan', 'greenDays'] as ShareKey[]);
  return {
    level: P?.level?.name ?? null, score, nextLevel: P?.level?.next?.name ?? null,
    period: periodLabel(m.from, m.to), trades: T.length,
    items: all.filter((i) => want.includes(i.key)).slice(0, 4), available,
  };
}
