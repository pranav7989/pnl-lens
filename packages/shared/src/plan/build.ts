/**
 * @file  packages/shared/src/plan/build.ts
 * @area  Reports
 * @what  30-day plan from a stored report: 5 Do and 5 Don't rules (each with Why and Now → Target), a scorecard, a weekly check-in and the check-up date. Habits only, no buy/sell advice.
 */
/**
 * Pure and deterministic: input is the engine's stored report JSON (m, trades, rules, stops, behaviour, patterns) and a
 * date. The engine is not touched (rule 1). Each candidate rule checks whether the user's data supports it and carries
 * an impact in money for ranking; the 5 strongest Do and Don't rules are used, and always-available fallbacks make
 * sure there are 5 of each even for a short statement.
 */
export interface PlanRule {
  id: string;
  kind: 'do' | 'dont';
  title: string;
  why: string;
  now: string;
  target: string;
  /** short label for the scorecard ("Contracts per expiry") and the weekly check-in ("6 or fewer contracts per expiry") */
  habit: string;
  check: string;
  impact: number;
}
export interface Plan {
  generatedAt: string;          // YYYY-MM-DD (IST)
  checkupOn: string;            // generatedAt + 30 days
  intro: string;
  dos: PlanRule[];
  donts: PlanRule[];
  scorecard: { habit: string; now: string; target: string }[];
  weekly: string[];
  currency: string;
  /** the statement period for the scorecard header ("Jan–Mar 25"), empty without dates */
  period: string;
}

type Trade = Record<string, any>;
const DAY = 86400e3;

/* ------------------------------------------------------------------ formatting */
const SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };
function fmtMoney(v: number, cur: string, sign = false): string {
  const s = SYMBOL[cur] ?? cur + ' ';
  const a = Math.round(Math.abs(v));
  const body = a.toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US');
  return (v < 0 ? '−' : sign && v > 0 ? '+' : '') + s + body;
}
const pct = (v: number) => `${Math.round(v)}%`;
const one = (v: number) => (Math.round(v * 10) / 10).toString();
const plural = (n: number, w: string, p = w + 's') => `${n} ${n === 1 ? w : p}`;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMon = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(d)} ${MON[Number(m) - 1]}`; };
/** a round, readable money limit: 2 significant figures */
const nice = (v: number) => { if (v <= 0) return 0; const p = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / p) * p; };

/** IST calendar date (YYYY-MM-DD) of an instant */
export function istDate(d: Date): string { return new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10); }
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ the data a rule can look at */
interface Ctx {
  cur: string; T: Trade[]; m: any; report: any;
  unit: string;                         // "contracts" (mostly options) or "trades"
  wins: Trade[]; losses: Trade[];
  fo: Trade[]; opts: Trade[];
  avgWin: number; avgLoss: number; totalLoss: number;
  dated: Trade[];                       // with an entry or exit date, sorted
}

function ctxOf(report: any): Ctx {
  const T: Trade[] = (report?.trades || []).filter((t: Trade) => Number.isFinite(t?.pnl));
  const m = report?.m || {};
  const cur = String(m.currency || 'INR').trim().toUpperCase();
  const wins = T.filter((t) => t.pnl > 0), losses = T.filter((t) => t.pnl < 0);
  const opts = T.filter((t) => t.isOpt);
  const fo = T.filter((t) => t.expiry && (t.isOpt || t.family !== 'Equity'));
  const dateOf = (t: Trade) => t.entryDate || t.exitDate || null;
  const dated = T.filter(dateOf).sort((a, b) => String(dateOf(a)).localeCompare(String(dateOf(b))) || (a.entryHour ?? 0) - (b.entryHour ?? 0));
  return {
    cur, T, m, report, unit: opts.length >= T.length / 2 && opts.length ? 'contracts' : 'trades', wins, losses, fo, opts,
    avgWin: mean(wins.map((t) => t.pnl)), avgLoss: mean(losses.map((t) => t.pnl)), totalLoss: sum(losses.map((t) => t.pnl)), dated,
  };
}

type Cand = (c: Ctx) => PlanRule | null;

/* ------------------------------------------------------------------ Do */
const capPerExpiry: Cand = (c) => {
  const g = new Map<string, Trade[]>();
  for (const t of c.fo) { const k = `${t.underlying}|${t.expiry}`; g.set(k, [...(g.get(k) || []), t]); }
  const groups = [...g.values()];
  if (groups.length < 3) return null;
  const counts = groups.map((x) => x.length), avg = mean(counts), med = median(counts);
  const calm = groups.filter((x) => x.length <= med);
  const target = Math.max(2, Math.round(mean(calm.map((x) => x.length))) + 1);
  if (avg <= target) return null;
  const calmPnl = sum(calm.flatMap((x) => x.map((t) => t.pnl)));
  const busy = groups.filter((x) => x.length > target), busyPnl = sum(busy.flatMap((x) => x.map((t) => t.pnl)));
  const perTrade = (p: number, xs: Trade[][]) => p / Math.max(1, sum(xs.map((x) => x.length)));
  if (calmPnl <= 0 || perTrade(calmPnl, calm) <= perTrade(busyPnl, busy)) return null;
  return {
    id: 'cap-expiry', kind: 'do', title: `Cap each expiry at ${target} ${c.unit}.`,
    why: `Your calmer expiries averaged ${one(mean(calm.map((x) => x.length)))} ${c.unit} and made ${fmtMoney(calmPnl, c.cur, true)} together.`,
    now: `${one(avg)} per expiry`, target: `${target} or fewer`, habit: `${c.unit[0].toUpperCase() + c.unit.slice(1)} per expiry`,
    check: `${target} or fewer ${c.unit} per expiry`, impact: Math.abs(sum(groups.filter((x) => x.length > target).flatMap((x) => x.map((t) => t.pnl)))),
  };
};

const sizeBand: Cand = (c) => {
  const sized = c.T.filter((t) => Number(t.buy) > 0);
  if (sized.length < 6) return null;
  const limit = nice(median(sized.map((t) => t.buy)));
  const small = sized.filter((t) => t.buy <= limit), big = sized.filter((t) => t.buy > limit);
  const ps = sum(small.map((t) => t.pnl)), pb = sum(big.map((t) => t.pnl));
  if (!big.length || pb >= ps) return null;
  return {
    id: 'size-band', kind: 'do', title: `Keep each position at ${fmtMoney(limit, c.cur)} or less.`,
    why: `Positions up to ${fmtMoney(limit, c.cur)}: ${fmtMoney(ps, c.cur, true)}. Larger ones: ${fmtMoney(pb, c.cur, true)}.`,
    now: `${fmtMoney(mean(sized.map((t) => t.buy)), c.cur)} average`, target: `${fmtMoney(limit, c.cur)} or less`,
    habit: 'Average position size', check: `Positions ${fmtMoney(limit, c.cur)} or less`, impact: Math.abs(ps - pb),
  };
};

const exitFirst: Cand = (c) => {
  const past = c.T.filter((t) => Number(t.pct) <= -10);
  if (past.length < 2) return null;
  const share = (past.length / c.T.length) * 100, target = Math.max(5, Math.round(share / 2));
  return {
    id: 'exit-first', kind: 'do', title: 'Write your exit before you enter, then keep it.',
    why: `${plural(past.length, c.unit.slice(0, -1), c.unit)} went past −10% and cost ${fmtMoney(sum(past.map((t) => t.pnl)), c.cur)}.`,
    now: `${pct(share)} of ${c.unit} past −10%`, target: `under ${target}%`, habit: `${c.unit[0].toUpperCase() + c.unit.slice(1)} lost more than 10%`,
    check: 'Exit written before entry', impact: Math.abs(sum(past.map((t) => t.pnl))),
  };
};

const letWinnersRun: Cand = (c) => {
  if (c.wins.length < 4) return null;
  const early = c.wins.filter((t) => Number(t.pct) < 10), share = (early.length / c.wins.length) * 100;
  if (share < 30) return null;
  const target = Math.max(10, Math.round(share - 15));
  return {
    id: 'let-winners', kind: 'do', title: 'Let planned winners reach your exit.',
    why: `${early.length} of ${c.wins.length} winners were closed under +10%.`,
    now: `${pct(share)} of wins under +10%`, target: `under ${target}%`, habit: 'Wins closed under +10%',
    check: 'Winners held to the planned exit', impact: Math.abs(c.avgWin) * early.length * 0.3,
  };
};

const focusBest: Cand = (c) => {
  const names = new Set(c.T.map((t) => t.underlying || t.symbol));
  if (names.size < 3) return null;
  const by = new Map<string, Trade[]>();
  const keyOf = (t: Trade) => (c.fo.length ? (t.expiryType ? `${t.expiryType}-expiry ${t.isOpt ? 'options' : 'futures'}` : t.family) : t.underlying || t.symbol);
  for (const t of c.T) { const k = keyOf(t) || 'Other'; by.set(k, [...(by.get(k) || []), t]); }
  const best = [...by.entries()].map(([k, x]) => ({ k, n: x.length, p: sum(x.map((t) => t.pnl)) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p)[0];
  if (!best) return null;
  return {
    id: 'focus', kind: 'do', title: 'Stay with what you know best.',
    why: `${best.k} made ${fmtMoney(best.p, c.cur, true)} over ${plural(best.n, 'trade')}; your results are strongest where you trade most carefully.`,
    now: `${plural(names.size, 'name')} traded`, target: 'fewer, familiar names', habit: 'Names traded', check: 'Only familiar names traded',
    impact: Math.abs(best.p) * 0.5,
  };
};

/** the engine's own first rule, unless it is about stops or loss caps (hold-past-stop and max-loss already measure those) */
const engineRule: Cand = (c) => {
  const r = (c.report?.rules || []).find((x: any) => x?.rule && !/\b(stop|cut|loss|losses)\b/i.test(String(x.rule)));
  if (!r) return null;
  return {
    id: 'engine-rule', kind: 'do', title: String(r.rule).replace(/\.?$/, '.'), why: String(r.why || ''),
    now: 'Not yet a habit', target: 'every trade', habit: 'Rule followed', check: String(r.rule).replace(/\.$/, '').slice(0, 60), impact: 1,
  };
};

/* fallbacks: always available */
const maxLossDo: Cand = (c) => {
  if (!c.losses.length) return null;
  const worst = Math.min(...c.losses.map((t) => t.pnl)), cap = Math.max(Math.abs(c.avgWin) || Math.abs(c.avgLoss), 1);
  return {
    id: 'max-loss', kind: 'do', title: 'Decide your maximum loss per trade before you enter.',
    why: `Your largest loss was ${fmtMoney(worst, c.cur)}${c.avgWin ? `, about ${one(Math.abs(worst) / c.avgWin)}× an average win` : ''}.`,
    now: `${fmtMoney(worst, c.cur)} largest loss`, target: `${fmtMoney(nice(cap), c.cur)} or less`, habit: 'Largest single loss',
    check: 'Maximum loss set before entry', impact: Math.abs(worst) * 0.4,
  };
};
const reviewWorst: Cand = (c) => {
  if (c.losses.length < 2) return null;
  const top = [...c.losses].sort((a, b) => a.pnl - b.pnl).slice(0, 3), cost = sum(top.map((t) => t.pnl));
  return {
    id: 'review-worst', kind: 'do', title: `Review your ${top.length} biggest losses this week.`,
    why: `They cost ${fmtMoney(cost, c.cur)}, ${pct((cost / c.totalLoss) * 100)} of everything you lost.`,
    now: `${pct((cost / c.totalLoss) * 100)} of losses`, target: 'reviewed by Friday', habit: 'Biggest losses reviewed',
    check: 'Biggest losses reviewed', impact: Math.abs(cost) * 0.2,
  };
};
const weeklyReview: Cand = () => ({
  id: 'weekly-review', kind: 'do', title: 'Check this plan every Friday.',
  why: 'Ten minutes a week with the check-in below shows which habits are sticking before the month is over.',
  now: 'Not tracked', target: '4 Fridays', habit: 'Weekly check-ins done', check: 'Friday check-in done', impact: 0.2,
});
const dailyLimit: Cand = () => ({
  id: 'daily-limit', kind: 'do', title: 'Set a daily loss limit and stop when you reach it.',
  why: 'A fixed daily limit keeps one bad day from becoming a bad month.',
  now: 'Not tracked', target: 'every day', habit: 'Days the loss limit was kept', check: 'Daily loss limit kept', impact: 0.1,
});
const sameSize: Cand = () => ({
  id: 'same-size', kind: 'do', title: 'Use the same position size for every trade this month.',
  why: 'One size makes your results comparable and stops a single trade from taking over.',
  now: 'Not tracked', target: 'one size', habit: 'Trades at your planned size', check: 'Planned size on every trade', impact: 0.05,
});
const writtenPlan: Cand = () => ({
  id: 'written-plan', kind: 'do', title: 'Write the day’s plan before the market opens.',
  why: 'Deciding what you will and won’t do before the open keeps decisions out of the noise.',
  now: 'Not tracked', target: 'every trading day', habit: 'Days with a written plan', check: 'Plan written before the open', impact: 0.04,
});
const tradeNote: Cand = (c) => ({
  id: 'note', kind: 'do', title: 'Write one line on why you took each trade.',
  why: `A short note turns your ${plural(c.T.length, c.unit.slice(0, -1), c.unit)} into lessons you can check at the next review.`,
  now: `${c.T.length} ${c.unit} in this report`, target: 'a note for every trade', habit: 'Trades with a note', check: 'A note for every trade', impact: 0.5,
});
const payoffDo: Cand = (c) => {
  if (!c.wins.length || !c.losses.length) return null;
  const pay = c.avgWin / Math.abs(c.avgLoss);
  if (pay >= 1.5) return null;
  return {
    id: 'payoff', kind: 'do', title: 'Make your average win bigger than your average loss.',
    why: `An average win is ${fmtMoney(c.avgWin, c.cur)}; an average loss is ${fmtMoney(c.avgLoss, c.cur)}.`,
    now: `${one(pay)} win-to-loss ratio`, target: '1.5 or more', habit: 'Average win ÷ average loss', check: 'Win kept larger than loss', impact: 0.4,
  };
};

/* ------------------------------------------------------------------ Don't */
const strikesPerExpiry: Cand = (c) => {
  const g = new Map<string, Set<string>>(), n = new Map<string, number>();
  for (const t of c.opts) { if (!t.expiry) continue; const k = `${t.underlying}|${t.expiry}`; g.set(k, (g.get(k) || new Set()).add(t.symbol)); n.set(k, (n.get(k) || 0) + 1); }
  const busy = [...g.entries()].map(([k, s]) => ({ k, strikes: s.size, n: n.get(k)! })).sort((a, b) => b.strikes - a.strikes);
  if (!busy.length || busy[0].strikes < 5) return null;
  const top = busy.filter((b) => b.strikes === busy[0].strikes).slice(0, 2);
  const when = top.map((b) => dayMon(b.k.split('|')[1])).join(' and ');
  return {
    id: 'strikes', kind: 'dont', title: 'Don’t add strikes once an expiry is busy.',
    why: `On the ${when} expir${top.length > 1 ? 'ies' : 'y'} you spread ${top[0].n} contracts over ${top[0].strikes} strikes${top.length > 1 ? ' each' : ''}.`,
    now: `${busy[0].strikes} strikes`, target: '3 or fewer', habit: 'Strikes in one expiry', check: '3 or fewer strikes per expiry', impact: Math.abs(c.avgLoss) * busy[0].strikes,
  };
};

const sizeUpAfterWin: Cand = (c) => {
  const months = new Map<string, Trade[]>();
  for (const t of c.dated) { const k = String(t.entryDate || t.exitDate).slice(0, 7); months.set(k, [...(months.get(k) || []), t]); }
  const ks = [...months.keys()].sort();
  for (let i = 1; i < ks.length; i++) {
    const a = months.get(ks[i - 1])!, b = months.get(ks[i])!;
    const pa = sum(a.map((t) => t.pnl)), pb = sum(b.map((t) => t.pnl));
    const sa = mean(a.map((t) => Number(t.buy) || 0)), sb = mean(b.map((t) => Number(t.buy) || 0));
    if (pa > 0 && sa > 0 && sb > sa * 1.3 && pb < pa) {
      const [ya, ma] = ks[i - 1].split('-'), [, mb] = ks[i].split('-');
      return {
        id: 'size-up', kind: 'dont', title: 'Don’t size up after a good month.',
        why: `After ${MON[Number(ma) - 1]}’s profit, ${MON[Number(mb) - 1]} size went from ${fmtMoney(sa, c.cur)} to ${fmtMoney(sb, c.cur)} and the month closed at ${fmtMoney(pb, c.cur, true)}.`,
        now: `${fmtMoney(sb, c.cur)} in ${MON[Number(mb) - 1]} ${ya}`, target: 'same size all month',
        habit: 'Size after a good month', check: 'Same size as last week', impact: Math.abs(pa - pb),
      };
    }
  }
  return null;
};

const holdPastStop: Cand = (c) => {
  const optStop = 30, linStop = Number(c.report?.stops?.lin?.rec) || 5;
  const o = c.opts.filter((t) => Number(t.pct) <= -optStop), l = c.T.filter((t) => !t.isOpt && Number(t.pct) <= -linStop);
  const useOpt = o.length >= l.length && o.length > 0;
  const hit = useOpt ? o : l;
  if (!hit.length) return null;
  const lim = useOpt ? optStop : linStop;
  return {
    id: 'hold-past-stop', kind: 'dont', title: useOpt ? `Don’t hold a losing option past −${lim}%.` : `Don’t hold a losing position past −${lim}%.`,
    why: `${plural(hit.length, useOpt ? 'contract' : 'position')} went past −${lim}% and cost ${fmtMoney(sum(hit.map((t) => t.pnl)), c.cur)}.`,
    now: `${plural(hit.length, useOpt ? 'contract' : 'position')}`, target: '0', habit: useOpt ? `Contracts past −${lim}%` : `Positions past −${lim}%`,
    check: `No loss held past −${lim}%`, impact: Math.abs(sum(hit.map((t) => t.pnl))),
  };
};

const avoidWorst: Cand = (c) => {
  const by = new Map<string, Trade[]>();
  for (const t of c.T) { const k = t.underlying || t.symbol; if (k) by.set(k, [...(by.get(k) || []), t]); }
  if (by.size < 2) return null;
  const worst = [...by.entries()].map(([k, x]) => ({ k, x, p: sum(x.map((t) => t.pnl)) }))
    .filter((g) => g.p < 0 && g.x.length <= Math.max(3, c.T.length * 0.25)).sort((a, b) => a.p - b.p)[0];
  if (!worst) return null;
  const allOpt = worst.x.every((t) => t.isOpt), allFut = worst.x.every((t) => t.expiry && !t.isOpt);
  const what = `${worst.k}${allOpt ? ' options' : allFut ? ' futures' : ''}`;
  return {
    id: 'avoid-worst', kind: 'dont', title: `Don’t trade ${what} this month.`,
    why: `${what} lost ${fmtMoney(worst.p, c.cur)} on just ${plural(worst.x.length, c.unit.slice(0, -1), c.unit)}.`,
    now: `${plural(worst.x.length, c.unit.slice(0, -1), c.unit)}`, target: '0', habit: `${what} ${c.unit}`, check: `No ${what}`, impact: Math.abs(worst.p),
  };
};

const charges: Cand = (c) => {
  const ch = Number(c.m.charges) || 0, gp = Number(c.m.grossProfit) || 0;
  if (ch <= 0 || gp <= 0) return null;
  const ratio = (ch / gp) * 100;
  if (ratio < 15) return null;
  const target = ratio > 100 ? 50 : Math.max(5, Math.round(ratio / 2));
  return {
    id: 'charges', kind: 'dont', title: 'Don’t treat charges as small.',
    why: `At ${fmtMoney(ch / Math.max(1, c.T.length), c.cur)} per ${c.unit.slice(0, -1)}, charges were ${pct(ratio)} of your gross profit.`,
    now: `${pct(ratio)} of gross profit`, target: `under ${target}%`, habit: 'Charges vs gross profit', check: 'Charges noted on Friday', impact: ch,
  };
};

const reEntryAfterLoss: Cand = (c) => {
  let n = 0, cost = 0;
  for (let i = 1; i < c.dated.length; i++) {
    const a = c.dated[i - 1], b = c.dated[i];
    if (a.pnl < 0 && (a.entryDate || a.exitDate) === (b.entryDate || b.exitDate)) { n++; cost += Math.min(0, b.pnl); }
  }
  if (n < 3) return null;
  return {
    id: 're-entry', kind: 'dont', title: 'Don’t trade again the same day after a loss.',
    why: `${n} times you entered again the same day after a loss; those trades lost ${fmtMoney(cost, c.cur)}.`,
    now: `${n} same-day re-entries`, target: '0', habit: 'Same-day trades after a loss', check: 'No same-day trade after a loss', impact: Math.abs(cost),
  };
};

/* fallbacks */
const oneTradeDont: Cand = (c) => {
  if (!c.losses.length) return null;
  const worst = Math.min(...c.losses.map((t) => t.pnl)), share = (worst / c.totalLoss) * 100;
  if (share < 25 || c.losses.length < 2) return null;
  return {
    id: 'one-trade', kind: 'dont', title: 'Don’t let one trade decide the month.',
    why: `Your worst trade, ${fmtMoney(worst, c.cur)}, was ${pct(share)} of everything you lost.`,
    now: `${pct(share)} of losses`, target: 'under 25%', habit: 'Worst trade share of losses', check: 'No single trade over the loss limit', impact: Math.abs(worst) * 0.3,
  };
};
const streakDont: Cand = (c) => {
  const seq = c.dated.length >= c.T.length / 2 ? c.dated : c.T;
  let best = 0, run = 0, cost = 0, runCost = 0;
  for (const t of seq) { if (t.pnl < 0) { run++; runCost += t.pnl; if (run > best) { best = run; cost = runCost; } } else { run = 0; runCost = 0; } }
  if (best < 4) return null;
  return {
    id: 'streak', kind: 'dont', title: 'Don’t keep trading through a losing streak.',
    why: `Your longest run was ${plural(best, 'loss', 'losses')} in a row, costing ${fmtMoney(cost, c.cur)}.`,
    now: `${best} losses in a row`, target: 'stop after 3', habit: 'Longest losing streak', check: 'Stopped after 3 losses in a row', impact: Math.abs(cost) * 0.5,
  };
};
const holdLosersDont: Cand = (c) => {
  const w = c.wins.filter((t) => Number.isFinite(t.holdDays)), l = c.losses.filter((t) => Number.isFinite(t.holdDays));
  if (w.length < 2 || l.length < 2) return null;
  const hw = mean(w.map((t) => t.holdDays)), hl = mean(l.map((t) => t.holdDays));
  if (hl <= hw * 1.2 || hl < 1) return null;
  return {
    id: 'hold-losers', kind: 'dont', title: 'Don’t hold losers longer than winners.',
    why: `Losing trades were held ${one(hl)} days on average; winners ${one(hw)} days.`,
    now: `${one(hl)} days on losers`, target: `${one(Math.max(hw, 0.5))} days or less`, habit: 'Days held on losing trades', check: 'Losers closed at the planned exit', impact: Math.abs(c.avgLoss),
  };
};
const overtradeDont: Cand = (c) => {
  const from = c.m.from, to = c.m.to;
  if (!c.m.hasDates || !from || !to) return null;
  const weeks = Math.max(1, (Date.parse(to) - Date.parse(from)) / (7 * DAY));
  const perWeek = c.T.length / weeks;
  if (perWeek < 3) return null;
  return {
    id: 'overtrade', kind: 'dont', title: 'Don’t trade more often than your plan allows.',
    why: `You averaged ${one(perWeek)} ${c.unit} a week between ${dayMon(String(from).slice(0, 10))} and ${dayMon(String(to).slice(0, 10))}.`,
    now: `${one(perWeek)} a week`, target: `${Math.max(1, Math.floor(perWeek))} or fewer`, habit: `${c.unit[0].toUpperCase() + c.unit.slice(1)} per week`, check: 'Weekly trade count kept', impact: 0.3,
  };
};
const revengeDont: Cand = () => ({
  id: 'win-back', kind: 'dont', title: 'Don’t trade to win back a loss.',
  why: 'A trade taken to recover money is sized by the loss, not by your plan.',
  now: 'Not tracked', target: 'never', habit: 'Trades taken to win back a loss', check: 'No trade to win back a loss', impact: 0.2,
});
const moveStopDont: Cand = () => ({
  id: 'move-stop', kind: 'dont', title: 'Don’t move your exit once it is set.',
  why: 'An exit moved during the trade is no longer a plan; it is a hope.',
  now: 'Not tracked', target: 'never', habit: 'Exits moved during a trade', check: 'Exit not moved', impact: 0.15,
});
const averageDownDont: Cand = () => ({
  id: 'average-down', kind: 'dont', title: 'Don’t add to a losing position.',
  why: 'Adding to a loser makes the trade bigger exactly when it is going wrong.',
  now: 'Not tracked', target: 'never', habit: 'Times you added to a loser', check: 'Nothing added to a loser', impact: 0.12,
});
const chaseDont: Cand = () => ({
  id: 'chase', kind: 'dont', title: 'Don’t chase a move you missed.',
  why: 'An entry made because the price already ran is not part of your plan.',
  now: 'Not tracked', target: 'never', habit: 'Late entries after a move', check: 'No chasing a missed move', impact: 0.11,
});
const noTipsDont: Cand = (c) => ({
  id: 'no-tips', kind: 'dont', title: 'Don’t take a trade you didn’t plan yourself.',
  why: `Your next ${c.unit} should follow these rules, not a tip, a chat group or a hunch.`,
  now: 'Not tracked', target: 'every trade planned', habit: 'Trades planned in advance', check: 'Every trade planned in advance', impact: 0.1,
});

const DO_RULES: Cand[] = [capPerExpiry, sizeBand, exitFirst, letWinnersRun, focusBest, engineRule];
const DO_FALLBACK: Cand[] = [maxLossDo, payoffDo, reviewWorst, tradeNote, weeklyReview, dailyLimit, sameSize, writtenPlan];
const DONT_RULES: Cand[] = [strikesPerExpiry, sizeUpAfterWin, holdPastStop, avoidWorst, charges, reEntryAfterLoss];
const DONT_FALLBACK: Cand[] = [oneTradeDont, streakDont, holdLosersDont, overtradeDont, noTipsDont, revengeDont, moveStopDont, averageDownDont, chaseDont];

function pick(c: Ctx, main: Cand[], fallback: Cand[]): PlanRule[] {
  const safe = (f: Cand) => { try { const r = f(c); return r && r.title && r.now && r.target ? r : null; } catch { return null; } };
  const ranked = main.map(safe).filter((r): r is PlanRule => !!r).sort((a, b) => b.impact - a.impact).slice(0, 5);
  for (const f of fallback) { if (ranked.length >= 5) break; const r = safe(f); if (r && !ranked.some((x) => x.id === r.id)) ranked.push(r); }
  return ranked.slice(0, 5);
}

export function buildPlan(report: any, opts: { generatedAt?: Date } = {}): Plan {
  const c = ctxOf(report);
  const generatedAt = istDate(opts.generatedAt ?? new Date());
  const dos = pick(c, DO_RULES, DO_FALLBACK), donts = pick(c, DONT_RULES, DONT_FALLBACK);
  const scorecard = [...dos, ...donts].filter((r) => /\d/.test(r.now) && !['note', 'review-worst'].includes(r.id)).slice(0, 7).map((r) => ({ habit: r.habit, now: r.now, target: r.target }));
  const weekly = [...dos, ...donts].sort((a, b) => b.impact - a.impact).map((r) => r.check).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
  const from = c.m.from ? String(c.m.from).slice(0, 10) : null, to = c.m.to ? String(c.m.to).slice(0, 10) : null;
  const sameMonth = !!from && !!to && from.slice(0, 7) === to.slice(0, 7);
  const span = from && to ? ` (${sameMonth ? '' : `${MON[Number(from.slice(5, 7)) - 1]}${from.slice(0, 4) !== to.slice(0, 4) ? ' ' + from.slice(0, 4) : ''}–`}${MON[Number(to.slice(5, 7)) - 1]} ${to.slice(0, 4)})` : '';
  const files = (report?.files?.length as number) || 0;
  const intro = `Ten rules built from your own trades: ${plural(c.T.length, c.unit.slice(0, -1), c.unit)}${files > 1 ? ` across ${files} statements` : ''}${span}. `
    + 'Each rule shows your number today and a target for the month. Your full analysis is on your dashboard. Keep this page where you trade.';
  const period = from && to ? `${sameMonth ? '' : `${MON[Number(from.slice(5, 7)) - 1]}${from.slice(0, 4) !== to.slice(0, 4) ? ' ' + from.slice(2, 4) : ''}–`}${MON[Number(to.slice(5, 7)) - 1]} ${to.slice(2, 4)}` : '';
  return { generatedAt, checkupOn: addDays(generatedAt, 30), intro, dos, donts, scorecard, weekly, currency: c.cur, period };
}
