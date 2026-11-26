/**
 * @file  packages/shared/src/plan/suggest.ts
 * @area  Desk
 * @what  "Suggested from your trades" (owner decision, 25 Nov): rules the trader may accept or ignore, from their weak habits (no_segment), from the 30-day plan rules a machine can check (stop after a loss, daily loss limit, an instrument to leave out, trades a day) and from their Desk settings; never one already accepted or dismissed.
 */
import { topPatterns, type Pattern } from '../profile/build';
import { historyLine, ruleLabel, type RuleKind } from './templates';

export interface Suggestion { key: string; kind: RuleKind; params: any; label: string; why: string; needs?: 'amount' }
export interface SuggestInput {
  patterns: Pattern[];                                   // shown habits of the active profile
  currency: string;
  plan: { dos?: any[]; donts?: any[] } | null;           // the newest 30-day plan snapshot
  settings: { max_daily_loss?: number | null; max_trades_day?: number | null } | null;
  taken: string[];                                       // suggestion keys already accepted or dismissed
  activeKinds: RuleKind[];
  now?: Date;
}

export function suggestRules(i: SuggestInput): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => { if (!i.taken.includes(s.key) && !out.some((o) => o.key === s.key)) out.push(s); };
  const has = (k: RuleKind) => i.activeKinds.includes(k);

  // weak habits, strongest first
  for (const p of topPatterns(i.patterns.filter((x) => x.verdict === 'weak'), 3, 0)) {
    add({ key: `segment:${p.segment_key}`, kind: 'no_segment', params: { dims: p.dims }, label: ruleLabel('no_segment', { dims: p.dims }), why: historyLine(p, i.currency, i.now ?? new Date()) });
  }
  // 30-day plan rules that a machine can check
  const rules = [...(i.plan?.dos ?? []), ...(i.plan?.donts ?? [])];
  const from = 'From your 30-day plan';
  for (const r of rules) {
    if (r?.id === 're-entry' && !has('stop_after_losses')) add({ key: 'plan:re-entry', kind: 'stop_after_losses', params: { n: 1 }, label: ruleLabel('stop_after_losses', { n: 1 }), why: `${from}: ${r.title}` });
    if (r?.id === 'daily-limit' && !has('max_daily_loss')) {
      const amount = i.settings?.max_daily_loss ?? null;
      add({ key: 'plan:daily-limit', kind: 'max_daily_loss', params: { amount }, label: amount ? ruleLabel('max_daily_loss', { amount }, i.currency) : 'Daily loss limit', why: `${from}: ${r.title}`, ...(amount ? {} : { needs: 'amount' as const }) });
    }
    if (r?.id === 'avoid-worst' && r.metric?.param) {
      const dims = { underlying: String(r.metric.param).toUpperCase() };
      add({ key: `plan:avoid-worst:${dims.underlying}`, kind: 'no_segment', params: { dims }, label: ruleLabel('no_segment', { dims }), why: `${from}: ${r.title}` });
    }
    if (r?.id === 'overtrade' && Number(r.metric?.target) > 0 && !has('max_trades_day')) {
      const n = Math.max(1, Math.round(Number(r.metric.target) / 5));
      add({ key: 'plan:overtrade', kind: 'max_trades_day', params: { n }, label: ruleLabel('max_trades_day', { n }), why: `${from}: ${r.title}` });
    }
  }
  // the limits the trader already typed in Desk settings
  if (i.settings?.max_trades_day && !has('max_trades_day')) {
    const n = i.settings.max_trades_day;
    add({ key: 'settings:max_trades_day', kind: 'max_trades_day', params: { n }, label: ruleLabel('max_trades_day', { n }), why: 'From your Desk settings' });
  }
  if (i.settings?.max_daily_loss && !has('max_daily_loss') && !out.some((o) => o.kind === 'max_daily_loss')) {
    const amount = i.settings.max_daily_loss;
    add({ key: 'settings:max_daily_loss', kind: 'max_daily_loss', params: { amount }, label: ruleLabel('max_daily_loss', { amount }, i.currency), why: 'From your Desk settings' });
  }
  return out;
}
