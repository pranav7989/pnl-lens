/**
 * @file  packages/shared/src/plan/templates.ts
 * @area  Desk
 * @what  The only wording Trade Check uses (architecture doc §8): how a segment is described ("NIFTY option buys on expiry day"), the history chip / watch-out lines with sample size and period, "(older data)", empty and upload states, and the advice-wording check the tests run on every output.
 */
/**
 * Compliance (doc §1): text describes the trader's own past trades and own rules. It never tells them to buy, sell,
 * avoid or skip a trade, and never suggests another instrument, strike, level or size. Every history line states its
 * sample size and period. No free-form text: everything shown comes from these functions.
 */
import type { FeatureName } from '../features/build';
import type { Pattern } from '../profile/build';
import { fmtMoney } from './build';

export const CHECK_VERSION = '1.0';
export const OLDER_DATA_DAYS = 60;

const NOUN: Record<string, string> = {
  'option|buy': 'option buys', 'option|sell': 'option sells', 'future|buy': 'futures bought', 'future|sell': 'futures sold',
  'equity|buy': 'equity buys', 'equity|sell': 'equity short sells', option: 'option trades', future: 'futures trades', equity: 'equity trades',
};
const CALL_PUT: Record<string, string> = { CE: 'call', PE: 'put' };
const MOD: Partial<Record<FeatureName, Record<string, string>>> = {
  dte: { '0': 'on expiry day', '1': 'the day before expiry', '2-4': '2–4 days before expiry', '5+': '5 or more days before expiry' },
  expiry_kind: { weekly: 'on weekly contracts', monthly: 'on monthly contracts' },
  weekday: { Mon: 'on Mondays', Tue: 'on Tuesdays', Wed: 'on Wednesdays', Thu: 'on Thursdays', Fri: 'on Fridays', Sat: 'on Saturdays', Sun: 'on Sundays' },
  time_bucket: { open: 'before 11:00', mid: 'between 11:00 and 13:00', late: 'after 13:00' },
  size_ratio: { '<=1x': 'at your usual size or less', '1-2x': 'at 1–2× your usual size', '>2x': 'at more than 2× your usual size' },
  session_seq: { '1st': 'as the first trade of the day', '2nd': 'as the second trade of the day', '3rd+': 'from the third trade of the day' },
  after_losses: { '0': 'before any loss that day', '1': 'after a loss that day', '2+': 'after 2 or more losses that day' },
  premium_bucket: { '<50': 'at a premium under ₹50', '50-150': 'at a premium of ₹50–150', '>150': 'at a premium above ₹150' },
};
const ORDER: FeatureName[] = ['dte', 'expiry_kind', 'time_bucket', 'weekday', 'session_seq', 'after_losses', 'size_ratio', 'premium_bucket'];

/** "NIFTY call option buys on expiry day before 11:00" */
export function describe(dims: Partial<Record<FeatureName, string>>): string {
  const inst = dims.instrument ?? (dims.premium_bucket && !dims.option_type ? 'option' : undefined), side = dims.side;   // only options have a premium
  let noun = inst && side ? NOUN[`${inst}|${side}`] : inst ? NOUN[inst] : side === 'buy' ? 'buys' : side === 'sell' ? 'sells' : 'trades';
  if (dims.option_type) noun = noun.replace(/^option/, `${CALL_PUT[dims.option_type]} option`).replace(/^(buys|sells|trades)$/, `${CALL_PUT[dims.option_type]} option $1`);
  const head = dims.underlying ? `${dims.underlying} ${noun}` : noun;
  const mods = ORDER.filter((k) => dims[k] != null).map((k) => MOD[k]![dims[k]!]).filter(Boolean);
  return [head, ...mods].join(' ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Apr–Sep 2026", "Nov 2025–Feb 2026", "Sep 2026" */
export function period(from: string | null, to: string | null): string {
  if (!from || !to) return 'all your statements';
  const [fy, fm] = [from.slice(0, 4), MONTHS[Number(from.slice(5, 7)) - 1]], [ty, tm] = [to.slice(0, 4), MONTHS[Number(to.slice(5, 7)) - 1]];
  if (fy === ty) return fm === tm ? `${tm} ${ty}` : `${fm}–${tm} ${ty}`;
  return `${fm} ${fy}–${tm} ${ty}`;
}
/** "30 Sep 2026" (fixed month names: the same on every server and browser) */
export const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, w: string, p = `${w}s`) => `${n} ${n === 1 ? w : p}`;
const days = (from: string, to: Date) => (to.getTime() - Date.parse(`${from}T00:00:00Z`)) / 864e5;

/** The history line for a segment (chip text and watch-out): own trades, sample size, period. */
export function historyLine(p: Pattern, currency: string, now: Date): string {
  const what = describe(p.dims);
  const sample = p.dims.dte === '0' && p.n_expiries
    ? `${plural(p.n_expiries, 'expiry', 'expiries')} · ${p.win_days} profitable`
    : `${plural(p.n_trades, 'trade')} · ${pct(p.win_rate)} win rate`;
  const money = p.verdict === 'strong' ? `avg ${fmtMoney(p.expectancy, currency, true)}` : fmtMoney(p.total_pnl, currency, true);
  const older = p.last_trade_at && days(p.last_trade_at, now) > OLDER_DATA_DAYS ? ' (older data)' : '';
  return `Your history: ${what} · ${sample} · ${money} (${period(p.period_from, p.period_to)})${older}`;
}

export type RuleKind = 'max_trades_day' | 'max_daily_loss' | 'stop_after_losses' | 'max_lots' | 'no_segment' | 'time_window';
/** The trader's own rule in their words, e.g. "No option buys on expiry day", "Daily loss limit ₹6,000". */
export function ruleLabel(kind: RuleKind, params: any, currency = 'INR'): string {
  switch (kind) {
    case 'max_trades_day': return `No more than ${plural(Number(params?.n), 'trade')} a day`;
    case 'max_daily_loss': return `Daily loss limit ${fmtMoney(Number(params?.amount), currency)}`;
    case 'stop_after_losses': return `Stop for the day after ${plural(Number(params?.n), 'loss', 'losses')}`;
    case 'max_lots': return params?.ratio != null ? `No more than ${params.ratio}× my usual size` : `No more than ${plural(Number(params?.lots), 'lot')}`;
    case 'no_segment': return `No ${describe(params?.dims ?? {})}`;
    case 'time_window': return `Trade only between ${params?.from} and ${params?.to}`;
  }
}
export const ruleChip = (label: string, detail?: string) => `Breaks your rule: "${label}"${detail ? ` · ${detail}` : ''}`;

export const TEXT = {
  noProfile: 'Upload a tradebook to see how lines like this went for you.',
  noWatchouts: 'Upload a statement to see your watch-outs.',
  nothingClear: 'Nothing stands out in your trades yet: no habit has enough trades to call strong or weak.',
  unlockTime: 'Upload a tradebook to unlock time-of-day checks.',
  acrossUnderlyings: ' · across all the instruments you traded',
  addStopLoss: 'Add a stop-loss to check your daily loss limit.',
  noLotSize: 'Lot size unknown for this instrument: write the quantity to check size rules.',
  tradeOfDay: (n: number) => `this is trade ${n} of the day`,
  plannedLoss: (amount: string) => `planned loss at stop-loss ${amount}`,
  sizeNow: (s: string) => `this line is ${s}`,
  checkedAgainst: (to: string) => `Checked against your trades up to ${to}`,
  disclaimer: 'Trade Check shows your own history and your own rules. It is not investment advice and never recommends a trade.',
} as const;

/**
 * Advice wording that must never appear in anything Trade Check shows (tests scan every template and rendered line).
 * Describing the trader's past ("option buys on expiry day") is allowed; telling them what to do is not.
 */
export const ADVICE = [/\byou should\b/i, /\bshould you\b/i, /\bdon'?t take\b/i, /\bdo not take\b/i, /\bavoid\b/i, /\bconsider\b/i, /\b(we|i) recommend/i, /\brecommended (for|to)\b/i,
  /\bwe suggest\b/i, /\bbetter to\b/i, /\btry (to )?(buy|sell)/i, /^(buy|sell|exit|enter|take|skip|book)\b/i, /\b(target|stop[- ]?loss) (at|of) [\d₹]/i];
export const isAdvice = (s: string) => ADVICE.some((r) => r.test(s));
