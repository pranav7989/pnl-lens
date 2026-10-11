/**
 * @file  lib/engine/behaviour.js
 * @area  Engine
 * @what  100 behavioural traits (data-triggered) and per-tile "now vs ideal" hover text.
 */
// @ts-nocheck
/**
 * Behavioural layer.
 *   computeSignals()  → ~70 numbers describing how this person trades
 *   TRAITS (100)      → each: area, name, score(s) 0–100 (0 = not present), now(s,f), why, ideal
 *   buildBehaviour()  → { traits: top matches (diverse areas), tiles: { key: { now, ideal } } }
 * Everything is derived from the trader's own records; nothing is diagnostic.
 */
const sum = (a, f) => a.reduce((x, y) => x + (f ? f(y) : y), 0);
const avg = (a, f) => (a.length ? sum(a, f) / a.length : 0);
const share = (a, f) => (a.length ? a.filter(f).length / a.length : 0);
const P = (x) => Math.round(x * 100) + '%';
const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
const stat = (a) => ({ n: a.length, pnl: sum(a, (t) => t.pnl), wr: share(a, (t) => t.pnl > 0), avg: avg(a, (t) => t.pnl) });

export function computeSignals({ m, trades, b, seq, debitSummary }) {
  const W = trades.filter((t) => t.pnl > 0), L = trades.filter((t) => t.pnl < 0);
  const opts = trades.filter((t) => t.isOpt), futs = trades.filter((t) => t.kind === 'FUT'), eq = trades.filter((t) => t.kind === 'EQ');
  const dated = trades.filter((t) => t.holdDays != null);
  const timed = trades.filter((t) => t.entryHour != null);
  const s = {
    n: m.n, wr: m.winRate, payoff: isFinite(m.payoff) ? m.payoff : 9, pf: isFinite(m.profitFactor) ? m.profitFactor : 9,
    avgWin: m.avgWin, avgLoss: m.avgLoss, avgWinPct: m.avgWinPct, avgLossPct: m.avgLossPct, net: m.net, realized: m.realized,
    expectancy: m.expectancy, maxDD: Math.abs(m.maxDD || 0), costPct: m.costPct, charges: m.charges,
    chargesRatio: m.grossProfit ? m.charges / m.grossProfit : 0, hasDates: m.hasDates, tradebook: m.source === 'tradebook',
    largestLoss: Math.abs(m.largestLoss), largestWin: m.largestWin,
  };
  s.noWins = W.length === 0;
  s.bigLossX = s.avgWin ? s.largestLoss / s.avgWin : 0;
  const sortedL = [...L].sort((a, c) => a.pnl - c.pnl);
  s.top3Share = m.grossLoss ? -sum(sortedL.slice(0, 3), (t) => t.pnl) / m.grossLoss : 0;
  s.deep10 = share(L, (t) => t.pct <= -10); s.deep50n = L.filter((t) => t.pct <= -50).length;
  s.zeroN = opts.filter((t) => t.wentToZero).length; s.zeroLoss = -sum(opts.filter((t) => t.wentToZero), (t) => t.pnl);
  s.decayN = opts.filter((t) => t.decayedWin).length;
  s.optShare = share(trades, (t) => t.isOpt);
  const cheap = opts.filter((t) => t.avgBuy / (t.mult || 1) < (m.currency === 'INR' ? 5 : 0.5));
  s.cheap = stat(cheap); s.cheapShare = opts.length ? cheap.length / opts.length : 0;
  const ce = opts.filter((t) => t.kind === 'CE'), pe = opts.filter((t) => t.kind === 'PE');
  s.ce = stat(ce); s.pe = stat(pe); s.ceShare = opts.length ? ce.length / opts.length : 0;
  const wk = opts.filter((t) => t.expiryType === 'Weekly'); s.weekly = stat(wk); s.weeklyShare = opts.length ? wk.length / opts.length : 0;
  const expDay = opts.filter((t) => t.entryDate && t.expiry && t.entryDate === t.expiry); s.expDay = stat(expDay);
  s.fut = stat(futs); s.futBig = futs.filter((t) => t.pct <= -5).length;
  s.eq = stat(eq);
  const del = eq.filter((t) => /Delivery/.test(t.style || '')), intra = eq.filter((t) => /Intraday/.test(t.style || ''));
  s.del = stat(del); s.intra = stat(intra);
  // size
  const bySize = [...trades].sort((a, c) => a.buy - c.buy), q = Math.max(1, Math.floor(bySize.length / 4));
  s.smallQ = stat(bySize.slice(0, q)); s.bigQ = stat(bySize.slice(-q));
  s.sizeCV = (() => { const v = trades.map((t) => t.buy), mu = avg(v); return mu ? Math.sqrt(avg(v, (x) => (x - mu) ** 2)) / mu : 0; })();
  // holding
  const dW = dated.filter((t) => t.pnl > 0), dL = dated.filter((t) => t.pnl < 0);
  s.holdW = avg(dW, (t) => t.holdDays); s.holdL = avg(dL, (t) => t.holdDays); s.holdN = dated.length;
  s.losersOvernight = share(dL, (t) => t.holdDays > 0); s.winnersOvernight = share(dW, (t) => t.holdDays > 0);
  s.sameDay = stat(dated.filter((t) => t.holdDays === 0)); s.multiDay = stat(dated.filter((t) => t.holdDays > 0));
  s.legsLosers = avg(L.filter((t) => t.nLegs), (t) => t.nLegs); s.legsWinners = avg(W.filter((t) => t.nLegs), (t) => t.nLegs);
  s.piecemeal = L.filter((t) => (t.sellDays || 0) >= 2 || (t.nLegs >= 4 && t.holdDays > 0)).length;
  // sequence
  s.seq = !!seq;
  if (seq) {
    const norm = (x) => ({ ...x, wr: x.winRate });
    s.afterLoss = norm(seq.afterLoss); s.afterWin = norm(seq.afterWin); s.worstStreak = seq.worstStreak; s.streakLoss = Math.abs(seq.streakLoss || 0);
    s.sizeUpAfterLoss = seq.afterWin.avgSize ? seq.afterLoss.avgSize / seq.afterWin.avgSize : 1;
    s.tradingDays = seq.tradingDays; s.worstDay = seq.worstDay; s.busiestDay = seq.busiestDay;
    let ws = 0, best = 0; for (const t of trades) { ws = t.pnl > 0 ? ws + 1 : 0; best = Math.max(best, ws); } s.winStreak = best;
    // after a big win: next trade
    const bigWinCut = s.avgWin * 1.5; const afterBig = [];
    for (let i = 1; i < trades.length; i++) if (trades[i - 1].pnl > bigWinCut) afterBig.push(trades[i]);
    s.afterBigWin = stat(afterBig);
    // revisiting the same symbol right after losing on it
    let reN = 0, reP = 0; for (let i = 1; i < trades.length; i++) if (trades[i - 1].pnl < 0 && trades[i].underlying === trades[i - 1].underlying && trades[i].entryDate === trades[i - 1].exitDate) { reN++; reP += trades[i].pnl; }
    s.sameNameRevenge = { n: reN, pnl: reP };
    // second half vs first half
    const h = Math.floor(trades.length / 2); s.early = stat(trades.slice(0, h)); s.late = stat(trades.slice(h));
  }
  // days
  const busy = (b.busyDay || []).filter((r) => /4–6|7\+/.test(r.key)); s.busy = { n: sum(busy, (r) => r.n), pnl: sum(busy, (r) => r.pnl) };
  const calm = (b.busyDay || []).find((r) => /^1 /.test(r.key)); s.calm = calm ? { n: calm.n, pnl: calm.pnl, wr: calm.winRate } : null;
  s.tradesPerDay = s.tradingDays ? m.n / s.tradingDays : 0;
  // time of day (session-relative buckets from the engine)
  const hb = b.entryHour || []; s.openB = hb[0] || null; s.closeB = hb[hb.length - 1] || null;
  s.timedN = timed.length;
  // weekdays / months
  const dows = (b.entryDow || []).filter((r) => r.n >= 3);
  s.dowWorst = [...dows].sort((a, c) => a.pnl - c.pnl)[0] || null; s.dowBest = [...dows].sort((a, c) => c.pnl - a.pnl)[0] || null;
  s.friday = (b.entryDow || []).find((r) => r.key === 'Friday') || null; s.monday = (b.entryDow || []).find((r) => r.key === 'Monday') || null;
  const months = b.month || []; s.months = months.length; s.posMonths = share(months, (r) => r.pnl > 0);
  s.worstMonth = [...months].sort((a, c) => a.pnl - c.pnl)[0] || null; s.bestMonth = [...months].sort((a, c) => c.pnl - a.pnl)[0] || null;
  s.monthSwing = s.worstMonth && s.bestMonth ? s.bestMonth.pnl - s.worstMonth.pnl : 0;
  s.bestMonthShare = s.bestMonth && m.realized > 0 ? s.bestMonth.pnl / m.realized : 0;
  // names
  const und = b.underlying || []; s.names = und.length;
  s.topNameShare = und.length ? Math.max(...und.map((u) => u.n)) / Math.max(1, m.n) : 0;
  s.stubborn = und.filter((u) => u.n >= 4 && u.pnl < 0 && u.winRate < 0.4).sort((a, c) => a.pnl - c.pnl)[0] || null;
  s.oneHit = und.filter((u) => u.n === 1).length;
  // direction
  const dir = b.direction || []; const lg = dir.find((r) => r.key === 'Long'), sh = dir.find((r) => r.key === 'Short');
  s.long = lg || null; s.short = sh || null; s.longShare = lg && sh ? lg.n / (lg.n + sh.n) : lg ? 1 : 0;
  // small edges
  s.tinyWins = share(W, (t) => t.pct < Math.max(s.costPct * 2, 0.3)); s.scratch = share(trades, (t) => Math.abs(t.pct) < 0.3);
  s.autosq = debitSummary.autosq ? debitSummary.autosq.n : 0; s.margin = debitSummary.margin ? debitSummary.margin.n : 0;
  s.lossClusterQ = (() => { const deep = (b.lossDepth || []).filter((r) => /25|50|90/.test(r.key)); return sum(deep, (r) => r.n); })();
  s.endsInDD = (() => { let eq0 = 0, pk = 0; for (const t of trades) { eq0 += t.pnl; pk = Math.max(pk, eq0); } return pk > 0 && eq0 < pk * 0.6; })();
  return s;
}

/* ---------- 100 traits ---------- */
const T = [];
const add = (id, area, name, score, now, why, ideal) => T.push({ id, area, name, score, now, why, ideal });

// ── Exits & loss handling (1–16)
add(1, 'exits', 'Loss aversion', (s) => !s.noWins && s.payoff < 1 ? clamp((1 - s.payoff) * 120) : 0,
  (s, f) => `Your average loss (${f(s.avgLoss)}) is ${(1 / s.payoff).toFixed(1)}× your average win (${f(s.avgWin)}).`,
  'Closing a loser makes the loss real, so the mind keeps it open for one more candle. A winner feels like something to protect, so it gets banked early. The pain of losing weighs roughly twice the pleasure of an equal gain, and your exits reflect that imbalance.',
  'Losses are closed at a level decided before entry, and winners are given at least as much room as losers.');
add(2, 'exits', 'The disposition effect', (s) => s.holdN >= 8 && s.holdL > s.holdW * 1.4 && s.holdL >= 1 ? clamp(40 + (s.holdL / Math.max(0.5, s.holdW) - 1) * 20) : 0,
  (s) => `Losing trades are held ${s.holdL.toFixed(1)} days on average; winners only ${s.holdW.toFixed(1)}.`,
  'Selling a winner confirms you were right; selling a loser admits you were wrong. So winners get sold quickly to lock in the good feeling, and losers are kept in the hope of being proven right later.',
  'Holding time is driven by the plan and the price, never by whether the position is currently green or red.');
add(3, 'exits', 'Hope as a strategy', (s) => s.zeroN >= 2 ? clamp(35 + s.zeroN * 6) : 0,
  (s, f) => `${s.zeroN} bought options were held until they were worth less than a tenth of their price, costing ${f(s.zeroLoss)}.`,
  'Once a position is deep in the red, closing it feels pointless because "the damage is done". Holding on costs nothing emotionally and keeps a small chance of rescue alive, so hope quietly replaces the exit plan.',
  'Every bought option has a premium stop. A trade that hits it is closed, whatever it might do tomorrow.');
add(4, 'exits', 'Anchoring to the entry price', (s) => s.deep10 > 0.3 && s.payoff < 1.2 ? clamp(s.deep10 * 110) : 0,
  (s) => `${P(s.deep10)} of your losing trades went more than 10% against you before you closed them.`,
  'The price you paid becomes the reference point for the whole trade. Every exit below it feels like "selling at a loss", so you wait for the market to return to your number, even though the market doesn\'t know it exists.',
  'Exit decisions are made relative to the trade idea being right or wrong, not relative to your entry price.');
add(5, 'exits', 'Winners cut too soon', (s) => s.wr >= 0.5 && s.avgWinPct < s.avgLossPct * 0.6 ? clamp(50 + (s.avgLossPct / Math.max(0.1, s.avgWinPct)) * 6) : 0,
  (s, f) => `You win ${P(s.wr)} of the time, but the average win is only ${s.avgWinPct.toFixed(1)}% against an average loss of ${s.avgLossPct.toFixed(1)}%.`,
  'A trade in profit creates anxiety that the profit will disappear, and taking it ends the anxiety. A high win rate feels like skill, but it is often the side effect of taking profits too early.',
  'Profit targets come from the setup. Part of the position can be banked, but the rest is allowed to reach the target.');
add(6, 'exits', 'The breakeven trap', (s) => s.piecemeal >= 2 ? clamp(35 + s.piecemeal * 8) : 0,
  (s) => `${s.piecemeal} losing positions were closed in several pieces over time instead of all at once.`,
  'Selling part of a loser feels like action without fully admitting defeat. The remaining piece becomes a lottery ticket on getting back to breakeven, and it is usually the piece that falls furthest.',
  'When the stop is hit, the whole position goes in one order.');
add(7, 'exits', 'Tail risk blindness', (s) => s.top3Share >= 0.4 ? clamp(s.top3Share * 120) : 0,
  (s) => `Just three trades account for ${P(s.top3Share)} of everything you lost.`,
  'Most trades feel controlled, so risk feels controlled. But the damage is concentrated in a few moments when discipline slipped. Those few trades decide the year, and they are the ones that never get reviewed.',
  'No single trade can lose more than a fixed cash amount, set before entry. The worst trades get reviewed first.');
add(8, 'exits', 'The one-big-loss problem', (s) => s.bigLossX >= 4 ? clamp(30 + s.bigLossX * 5) : 0,
  (s, f) => `Your worst trade lost ${f(s.largestLoss)}, about ${s.bigLossX.toFixed(0)} average wins.`,
  'A single large loss usually starts as a normal trade that was never stopped out. Each small move against you felt too small to act on, until the total was too big to accept.',
  'The maximum loss on any trade is about one average win. Anything bigger is treated as a process failure, not bad luck.');
add(9, 'exits', 'Moving the goalposts', (s) => s.deep50n >= 2 && s.zeroN < 2 ? clamp(30 + s.deep50n * 8) : 0,
  (s) => `${s.deep50n} positions lost more than half their value before being closed.`,
  'A stop that exists only in your head is easy to move. Each time price reaches it, a new reason appears for giving the trade more room, and the planned small loss becomes a large one.',
  'Stops are placed with the broker at entry, so moving them requires a deliberate, visible action.');
add(10, 'exits', 'Overstaying good trades', (s) => s.decayN >= 2 && s.wr < 0.45 ? 30 : 0,
  (s) => `Your short-premium trades work (${s.decayN} decayed to almost nothing), yet your overall hit rate is ${P(s.wr)}.`,
  'Success in one style can make you overconfident in all styles. The skill that works in one context gets applied everywhere, including where it doesn\'t.',
  'Each setup is tracked on its own numbers. Size goes to what works; the rest is paused.');
add(11, 'exits', 'Small-loss reluctance', (s) => !s.noWins && s.payoff < 0.8 && s.scratch < 0.05 ? clamp((0.8 - s.payoff) * 100 + 20) : 0,
  (s) => `Hardly any trades close near breakeven (${P(s.scratch)}); losers are allowed to grow instead.`,
  'Taking a small loss feels like admitting a mistake immediately. Waiting feels free. But a trader who never takes small losses is a trader who takes large ones.',
  'Many trades end as small losses or scratches. That is what cutting early looks like in the data.');
add(12, 'exits', 'Rescue holding', (s) => s.holdN >= 8 && s.losersOvernight > s.winnersOvernight + 0.25 ? clamp(30 + (s.losersOvernight - s.winnersOvernight) * 100) : 0,
  (s) => `${P(s.losersOvernight)} of your losing trades were carried overnight, versus ${P(s.winnersOvernight)} of winners.`,
  'Carrying a loser overnight postpones the decision to the next session, where it is hoped the problem fixes itself. It turns an intraday mistake into a multi-day exposure.',
  'Intraday trades that go wrong are closed intraday. Overnight holds are planned before entry, not decided by the P&L.');
add(13, 'exits', 'Profit-taking anxiety', (s) => s.tinyWins > 0.35 ? clamp(s.tinyWins * 100) : 0,
  (s) => `${P(s.tinyWins)} of your winning trades made so little they barely covered costs.`,
  'The urge to see a green number can be stronger than the plan. Grabbing tiny gains feels productive, but it turns a good entry into a trade that pays the broker more than it pays you.',
  'A minimum target is set before entry, at several times the round-trip cost.');
add(14, 'exits', 'Hindsight-driven exits', (s) => s.wr < 0.4 && s.payoff < 1.2 ? clamp(40 + (0.4 - s.wr) * 100) : 0,
  (s) => `You lose on ${P(1 - s.wr)} of trades and your winners don't make up for it (payoff ${s.payoff.toFixed(2)}).`,
  'When both the win rate and the payoff are weak, exits are usually reactive: closing after a sharp move against you, re-entering after it recovers. Each decision makes sense in the moment and costs money in sequence.',
  'Either the win rate or the payoff must be strong by design. Pick which one your setups depend on and manage exits to protect it.');
add(15, 'exits', 'Fear of a second loss', (s) => s.seq && s.afterLoss.n >= 8 && s.afterLoss.wr > s.afterWin.wr + 0.1 && s.afterLoss.avg < s.afterWin.avg ? 30 : 0,
  (s) => `After a loss you win more often (${P(s.afterLoss.wr)}) but make less per trade (${Math.round(s.afterLoss.avg)}).`,
  'After a loss, the fear of another one leads to snatching any profit available. The win rate improves, but each win is too small to repair the damage.',
  'The trade after a loss is managed exactly like any other trade: same targets, same stops.');
add(16, 'exits', 'Volatility denial', (s) => s.futBig >= 1 ? clamp(40 + s.futBig * 12) : 0,
  (s) => `${s.futBig} futures position${s.futBig > 1 ? 's' : ''} lost 5% or more of notional value.`,
  'Leverage hides risk. A 5% move feels small in percentage terms, but on a futures position it can equal weeks of gains. The brain judges the move, not the exposure.',
  'Futures risk is measured in cash per lot. The stop is set so a full stop-out is a normal, survivable loss.');

// ── Sizing (17–28)
add(17, 'sizing', 'Martingale instinct', (s) => s.seq && s.sizeUpAfterLoss > 1.2 ? clamp(30 + (s.sizeUpAfterLoss - 1) * 100) : 0,
  (s) => `After a loss, your next position is ${Math.round((s.sizeUpAfterLoss - 1) * 100)}% bigger than after a win.`,
  'Doubling up feels like a way to recover faster. It is the oldest gambling instinct: increase the bet to win back what was lost. It concentrates risk exactly when your judgement is weakest.',
  'Size is fixed by a rule (for example, a percentage of capital) and never increases after a loss.');
add(18, 'sizing', 'Inconsistent sizing', (s) => s.sizeCV > 1.1 && s.n >= 10 ? clamp(s.sizeCV * 40) : 0,
  (s) => `Your position sizes vary wildly: the spread is ${s.sizeCV.toFixed(1)}× the average size.`,
  'When size is decided by feel, conviction and mood set the bet. Your biggest positions end up where you felt most certain, which is not the same as where your edge is greatest.',
  'Position size comes from a formula: risk per trade divided by distance to stop.');
add(19, 'sizing', 'Big bets, bad outcomes', (s) => s.bigQ.n >= 3 && s.bigQ.pnl < 0 && s.smallQ.pnl >= s.bigQ.pnl ? clamp(40 + (s.smallQ.wr - s.bigQ.wr) * 100) : 0,
  (s, f) => `Your largest positions lost ${f(Math.abs(s.bigQ.pnl))} with a ${P(s.bigQ.wr)} win rate.`,
  'Big positions are usually taken when confidence is high, and high confidence often follows recent success or a strong story. Certainty feels like information, but it is just a feeling.',
  'Larger size is earned by a setup\'s track record, not by how convinced you feel today.');
add(20, 'sizing', 'Playing small to feel safe', (s) => s.smallQ.n >= 3 && s.smallQ.pnl < 0 && s.smallQ.wr < 0.4 ? clamp(30 + (0.4 - s.smallQ.wr) * 100) : 0,
  (s, f) => `Your smallest positions lose ${P(1 - s.smallQ.wr)} of the time and cost ${f(Math.abs(s.smallQ.pnl))} in total.`,
  'Small positions feel like they don\'t matter, so they get no plan and no stop. Together they become a steady leak of money and attention.',
  'Every position gets the same process, regardless of size. If a trade is not worth planning, it is not worth taking.');
add(21, 'sizing', 'Confidence after success', (s) => s.seq && s.afterBigWin.n >= 4 && s.afterBigWin.avg < 0 ? clamp(40 + s.afterBigWin.n * 3) : 0,
  (s, f) => `The trade right after a big win averages ${f(s.afterBigWin.avg)}.`,
  'A big win makes the next trade feel easy. Standards drop, entries get looser, and the market feels readable. The danger is greatest right after things go well.',
  'After an outsized win, the next trade needs the same checklist as any other, or a short break first.');
add(22, 'sizing', 'Gambling with house money', (s) => s.seq && s.afterWin.n >= 8 && s.afterWin.avg < s.afterLoss.avg && s.afterWin.avg < 0 ? 35 : 0,
  (s, f) => `Trades taken after a win average ${f(s.afterWin.avg)}, worse than after a loss.`,
  'Profit already made feels like "the market\'s money", so it is risked more freely. But a rupee of profit is exactly as real as a rupee of capital.',
  'Today\'s profits are capital. Risk rules don\'t loosen because the day is going well.');
add(23, 'sizing', 'Leverage as a shortcut', (s) => s.fut.n >= 3 && s.fut.pnl < 0 && s.fut.wr < 0.45 ? clamp(30 + s.fut.n * 3) : 0,
  (s, f) => `Futures: ${s.fut.n} trades, ${P(s.fut.wr)} win rate, ${f(s.fut.pnl)}.`,
  'Leverage promises faster results from the same idea. But it also multiplies every mistake in timing and sizing, so a weak edge gets wiped out faster.',
  'Leverage is used only on setups with a proven record, at a size where a full stop-out is routine.');
add(24, 'sizing', 'All-in on one name', (s) => s.topNameShare > 0.4 && s.n >= 10 ? clamp(s.topNameShare * 100) : 0,
  (s) => `${P(s.topNameShare)} of your trades are in a single underlying.`,
  'Familiarity breeds comfort. Trading the same name repeatedly feels like expertise, but it also concentrates every bad stretch in that name into your P&L.',
  'Concentration is a deliberate choice backed by data that the name trades well for you, not a habit.');
add(25, 'sizing', 'Risk drift', (s) => s.seq && s.late && s.early && s.late.avg < s.early.avg && s.late.pnl < 0 && s.early.pnl > 0 ? 40 : 0,
  (s, f) => `Your first half of trades made ${f(s.early.pnl)}; the second half lost ${f(Math.abs(s.late.pnl))}.`,
  'Early success often leads to quietly larger risk, looser selection and more trades. The rules that produced the gains erode one small exception at a time.',
  'The rules that produced good results are written down and reviewed weekly, so they don\'t drift.');
add(26, 'sizing', 'No loss ceiling', (s) => s.bigLossX >= 3 && s.top3Share < 0.4 ? clamp(30 + s.bigLossX * 4) : 0,
  (s, f) => `Several losses were far larger than a typical win; the worst was ${f(s.largestLoss)}.`,
  'Without a hard cap on loss per trade, the size of each loss is decided by how long you can tolerate watching it. That tolerance is highest when you are most stubborn.',
  'A cash loss limit per trade, decided before the session, used to size every position.');
add(27, 'sizing', 'Penny-option lottery', (s) => s.cheapShare > 0.3 && s.cheap.n >= 4 && s.cheap.pnl < 0 ? clamp(30 + s.cheapShare * 80) : 0,
  (s) => `${P(s.cheapShare)} of your option trades were bought at very low premiums; they won ${P(s.cheap.wr)} of the time.`,
  'Cheap options feel low risk because the price is small, and the possible payoff looks huge. This is lottery thinking: the low price reflects how unlikely the payoff is.',
  'Options are chosen for probability and liquidity, not for how cheap they look.');
add(28, 'sizing', 'Margin brinkmanship', (s) => s.margin >= 1 ? clamp(30 + s.margin * 10) : 0,
  (s) => `You were charged ${s.margin} margin or collateral penalt${s.margin > 1 ? 'ies' : 'y'}.`,
  'Running close to the margin limit means using every rupee available. It feels efficient but leaves no room for error, and the penalties are losses taken without any trade.',
  'At least 20% of required margin is kept free at all times.');

// ── Frequency & impulse (29–42)
add(29, 'frequency', 'Revenge trading', (s) => s.seq && s.afterLoss.n >= 5 && s.afterLoss.pnl < 0 && s.afterLoss.avg < s.afterWin.avg ? clamp(40 + (s.afterWin.avg - s.afterLoss.avg) / Math.max(1, s.avgWin) * 30) : 0,
  (s, f) => `Trades taken straight after a loss lost ${f(Math.abs(s.afterLoss.pnl))} in total, at a ${P(s.afterLoss.wr)} win rate.`,
  'A loss creates an urge to get even immediately. The next trade is chosen to repair the feeling, not because the setup is there. It is the most expensive trade most people take.',
  'After a loss there is a pause (for example 15 minutes) and the next trade must pass the full checklist.');
add(30, 'frequency', 'Overtrading', (s) => s.busy.n >= 6 && s.busy.pnl < 0 ? clamp(35 + s.busy.n * 1.5) : 0,
  (s, f) => `On days with 4 or more trades you lost ${f(Math.abs(s.busy.pnl))} across ${s.busy.n} trades.`,
  'Busy days feel productive. But the more trades in a day, the lower the quality of each one, because the best setups don\'t appear on demand.',
  'A daily trade limit. Fewer, better trades beat many average ones.');
add(31, 'frequency', 'Action bias', (s) => s.tradesPerDay >= 3 && s.expectancy < 0 ? clamp(30 + s.tradesPerDay * 6) : 0,
  (s) => `You average ${s.tradesPerDay.toFixed(1)} trades per trading day, and the average trade loses money.`,
  'Sitting still feels like missing out, and watching the screen without trading feels like wasted time. So trades are taken to have done something, not because the edge is there.',
  'Not trading is a valid decision. Many good trading days have zero trades.');
add(32, 'frequency', 'Boredom trades', (s) => s.calm && s.calm.n >= 4 && s.calm.pnl > 0 && s.busy.pnl < 0 ? 45 : 0,
  (s, f) => `Days with a single trade made ${f(s.calm.pnl)}; busy days lost ${f(Math.abs(s.busy.pnl))}.`,
  'Your first trade of the day is usually your best one, chosen with patience. Extra trades come from restlessness, not opportunity.',
  'After the planned trade, the platform closes unless a pre-defined second setup appears.');
add(33, 'frequency', 'Tilt', (s) => s.seq && s.worstStreak >= 5 ? clamp(30 + s.worstStreak * 6) : 0,
  (s, f) => `Your longest losing run was ${s.worstStreak} trades in a row, costing ${f(s.streakLoss)}.`,
  'After several losses, frustration takes over decision-making. Each new loss lowers the bar for the next entry, until trading becomes a way to vent rather than a process.',
  'A daily loss limit and a maximum number of consecutive losses, after which trading stops for the day.');
add(34, 'frequency', 'Chasing the same name', (s) => s.seq && s.sameNameRevenge.n >= 3 && s.sameNameRevenge.pnl < 0 ? clamp(35 + s.sameNameRevenge.n * 5) : 0,
  (s, f) => `${s.sameNameRevenge.n} times you re-entered the same name on the same day you lost on it, losing ${f(Math.abs(s.sameNameRevenge.pnl))} more.`,
  'Losing on a specific stock or contract makes it personal. Re-entering is an attempt to win back from that particular instrument, as if it owed you something.',
  'After a loss on a name, that name is off-limits for the rest of the day.');
add(35, 'frequency', 'Scattershot selection', (s) => s.oneHit >= 10 && s.oneHit / Math.max(1, s.names) > 0.6 ? clamp(30 + s.oneHit) : 0,
  (s) => `You traded ${s.names} different underlyings, ${s.oneHit} of them only once.`,
  'Jumping between many names means never building a feel for any of them. Each new name is a fresh start, which is exciting, but excitement is not an edge.',
  'A short, stable watchlist of instruments you know well.');
add(36, 'frequency', 'Day-level spirals', (s) => s.worstDay && s.worstDay.pnl < -Math.abs(s.avgWin * 4) ? clamp(35 + Math.abs(s.worstDay.pnl) / Math.max(1, s.avgWin) * 2) : 0,
  (s, f) => `Your worst day (${s.worstDay.date}) lost ${f(Math.abs(s.worstDay.pnl))} across ${s.worstDay.n} trades.`,
  'Bad days rarely start bad. A normal loss is followed by a push to recover, then a bigger push. By the end of the day, one mistake has become several.',
  'A daily loss limit that ends the session. Tomorrow is a fresh start.');
add(37, 'frequency', 'Chasing after missing out', (s) => s.openB && s.openB.n >= 5 && s.openB.pnl < 0 && s.openB.winRate < 0.45 ? clamp(30 + s.openB.n * 2) : 0,
  (s, f) => `Trades opened in the first part of the session lost ${f(Math.abs(s.openB.pnl))} (${P(s.openB.winRate)} win rate).`,
  'The opening move looks like an opportunity that will be gone if you wait. Fear of missing out pushes entries before the market has shown its hand.',
  'No entries in the first stretch of the session unless the setup was planned the night before.');
add(38, 'frequency', 'End-of-day desperation', (s) => s.closeB && s.closeB.n >= 5 && s.closeB.pnl < 0 && s.closeB.winRate < 0.45 ? clamp(30 + s.closeB.n * 2) : 0,
  (s, f) => `Trades opened late in the session lost ${f(Math.abs(s.closeB.pnl))} (${P(s.closeB.winRate)} win rate).`,
  'Late-session trades are often attempts to fix the day before it ends. The window is short, liquidity changes, and decisions are rushed.',
  'A cut-off time for new trades, well before the close.');
add(39, 'frequency', 'Expiry-day gambling', (s) => s.expDay.n >= 4 && s.expDay.pnl < 0 ? clamp(35 + s.expDay.n * 2) : 0,
  (s, f) => `Options bought on their own expiry day: ${s.expDay.n} trades, ${f(s.expDay.pnl)}.`,
  'Expiry day offers huge percentage moves for tiny premiums. It feels like the best odds of the week, but time decay and fast moves make it the hardest day to be right.',
  'Expiry-day trades are either a tested setup with strict size limits, or not taken at all.');
add(40, 'frequency', 'Auto-pilot exits', (s) => s.autosq >= 2 ? clamp(30 + s.autosq * 8) : 0,
  (s) => `Your broker closed your intraday positions ${s.autosq} times because you hadn't.`,
  'Letting the broker square off means no exit decision was made. Either the trade was forgotten or closing it felt too painful.',
  'Every intraday position is closed by you before the cut-off, at a time you choose.');
add(41, 'frequency', 'Novelty seeking', (s) => s.names >= 25 && s.expectancy < 0 ? clamp(30 + s.names / 2) : 0,
  (s) => `You traded ${s.names} different underlyings in this period.`,
  'New instruments bring fresh excitement and the sense that this one will be different. Variety feels like opportunity but usually spreads attention too thin.',
  'New instruments are added only after they are tested on paper.');
add(42, 'frequency', 'Cost blindness', (s) => s.chargesRatio > 0.3 ? clamp(s.chargesRatio * 100) : 0,
  (s, f) => `Charges took ${P(s.chargesRatio)} of everything your winning trades made (${f(s.charges)}).`,
  'Each trade\'s cost looks tiny on its own, so it is never part of the decision. Across hundreds of trades, those small amounts become one of your biggest expenses.',
  'Every trade must have an expected gain several times its total cost.');

// ── Options-specific (43–54)
add(43, 'options', 'Lottery-ticket preference', (s) => s.cheap.n >= 5 && s.cheap.wr < 0.3 ? clamp(40 + (0.3 - s.cheap.wr) * 150) : 0,
  (s) => `Low-premium options won only ${P(s.cheap.wr)} of the time across ${s.cheap.n} trades.`,
  'People overvalue small chances of big wins. A cheap out-of-the-money option is priced cheaply because the market expects it to expire worthless, and it usually does.',
  'Options are bought with a realistic probability of reaching the target before decay takes over.');
add(44, 'options', 'Directional stubbornness', (s) => s.ce.n >= 5 && s.pe.n >= 5 && Math.abs(s.ce.pnl - s.pe.pnl) > s.avgWin * 4 && (s.ce.pnl < 0 ? s.ceShare > 0.55 : s.ceShare < 0.45) ? 40 : 0,
  (s, f) => s.ce.pnl < s.pe.pnl ? `You trade calls more (${P(s.ceShare)} of options) but they lose ${f(Math.abs(s.ce.pnl))}; puts made ${f(s.pe.pnl)}.` : `You lean on puts (${P(1 - s.ceShare)} of options) but they lose ${f(Math.abs(s.pe.pnl))}; calls made ${f(s.ce.pnl)}.`,
  'A bias about market direction quietly shapes which side you choose. The side you prefer is not the side that pays you, but preference wins because it matches your view of the world.',
  'Direction is chosen by the setup on the chart, and each side\'s results are reviewed separately.');
add(45, 'options', 'Weekly-expiry addiction', (s) => s.weekly.n >= 6 && s.weekly.pnl < 0 && s.weeklyShare > 0.5 ? clamp(30 + s.weeklyShare * 50) : 0,
  (s, f) => `${P(s.weeklyShare)} of your options are weekly contracts, and they lost ${f(Math.abs(s.weekly.pnl))}.`,
  'Weekly options deliver fast results and quick feedback, which makes them exciting. But fast decay punishes any timing error, and the excitement keeps you coming back.',
  'Contract expiry is matched to how long the idea needs to play out.');
add(46, 'options', 'Theta denial', (s) => s.zeroN >= 3 && s.optShare > 0.4 ? clamp(30 + s.zeroN * 5) : 0,
  (s) => `${s.zeroN} bought options lost almost all their value through decay.`,
  'An option that isn\'t moving feels like it is waiting. In reality it is losing value every hour, and the loss is invisible until it is large.',
  'Bought options have a time stop as well as a price stop.');
add(47, 'options', 'Premium-seller complacency', (s) => s.decayN >= 3 && s.largestLoss > s.avgWin * 6 ? clamp(40 + s.bigLossX * 3) : 0,
  (s, f) => `Selling premium paid off ${s.decayN} times, but one loss cost ${f(s.largestLoss)}.`,
  'Steady small wins from selling options build confidence that the strategy is safe. The rare large loss feels like bad luck, but it is part of the strategy.',
  'Every short option position has a defined maximum loss through a stop or a hedge.');
add(48, 'options', 'Strike-picking by price', (s) => s.cheapShare > 0.5 && s.optShare > 0.5 ? clamp(30 + s.cheapShare * 50) : 0,
  (s) => `Over half of your options were bought at very low premiums.`,
  'Choosing strikes by how affordable the premium is lets the budget decide the trade. The strike then reflects your wallet, not your view.',
  'Strike is chosen by the expected move and the time available; size is adjusted to the budget.');
add(49, 'options', 'Options as leverage on hope', (s) => s.optShare > 0.6 && s.wr < 0.4 && s.payoff < 1.5 ? clamp(30 + (0.4 - s.wr) * 120) : 0,
  (s) => `Most of your trading is in options, where you win ${P(s.wr)} of the time without big enough winners to compensate.`,
  'Options promise a big result from a small outlay, which makes them attractive when you need a win. But buying options requires being right about direction, size and timing all at once.',
  'Options are used where the edge needs leverage, and the hit rate needed to profit is known in advance.');
add(50, 'options', 'Selling winners, keeping losers (options)', (s) => s.optShare > 0.4 && s.zeroN >= 2 && s.tinyWins > 0.3 ? 45 : 0,
  (s) => `Option winners were often closed for small gains while ${s.zeroN} option losers were held to near zero.`,
  'With options, both sides of the disposition effect are amplified. Profits feel fragile, so they\'re taken fast; losses feel recoverable because the premium "could come back".',
  'Option exits are pre-set on both sides: a premium target and a premium stop.');
add(51, 'options', 'Index-option tunnel vision', (s) => s.optShare > 0.7 && s.names <= 3 && s.expectancy < 0 ? 35 : 0,
  (s) => `Almost all your trading is in a handful of index options, and the average trade loses money.`,
  'Index options are liquid and always moving, so they feel like the place to be. The constant activity makes it easy to trade without a clear setup.',
  'Index options are traded only on specific, written setups with a defined time window.');
add(52, 'options', 'Gamma thrill', (s) => s.expDay.n >= 3 && s.expDay.wr < 0.35 ? clamp(30 + s.expDay.n * 3) : 0,
  (s) => `Expiry-day option trades won only ${P(s.expDay.wr)} of the time.`,
  'The fast swings near expiry are thrilling and feel like opportunity. The thrill itself becomes the reward, separate from the money.',
  'If expiry-day trading feels exciting, the position is too big or the setup too vague.');
add(53, 'options', 'Averaging into options', (s) => s.optShare > 0.4 && s.legsLosers > s.legsWinners + 1 ? 35 : 0,
  (s) => `Losing option trades had more buy/sell legs (${s.legsLosers.toFixed(1)}) than winners (${s.legsWinners.toFixed(1)}).`,
  'Adding to a losing option lowers the average price and makes the loss feel smaller. It also increases exposure to a position that is already proving you wrong.',
  'No adding to losing option positions. Adds happen only to winners, if at all.');
add(54, 'options', 'Decay misread', (s) => s.weekly.n >= 5 && s.weekly.wr < 0.35 && s.weekly.pnl < 0 ? 30 : 0,
  (s) => `Weekly options won ${P(s.weekly.wr)} of the time.`,
  'Short-dated options need the move to happen quickly. Ideas that are right in direction but slow in timing still lose, which can feel like the market is unfair.',
  'If your setups take days to work, use contracts with enough time left.');

// ── Timing & calendar (55–66)
add(55, 'timing', 'Weekday blind spot', (s) => s.dowWorst && s.dowWorst.pnl < -Math.abs(s.avgWin * 2) && s.dowWorst.winRate < 0.45 ? clamp(30 + s.dowWorst.n) : 0,
  (s, f) => `${s.dowWorst.key} is your worst day: ${s.dowWorst.n} trades, ${P(s.dowWorst.winRate)} win rate, ${f(s.dowWorst.pnl)}.`,
  'Patterns tied to a day of the week are often about you, not the market: energy levels, routines, expiries, or what happened the day before.',
  'Days that consistently lose get smaller size or no trading until the reason is understood.');
add(56, 'timing', 'Friday restlessness', (s) => s.friday && s.friday.n >= 4 && s.friday.pnl < 0 && s.friday.winRate < 0.45 ? 30 : 0,
  (s, f) => `Friday entries lost ${f(Math.abs(s.friday.pnl))} over ${s.friday.n} trades.`,
  'The end of the week brings a push to finish the week green or make one more trade before the weekend. Rushed trades follow.',
  'Weekly goals are not chased on Friday. A red week is accepted rather than forced green.');
add(57, 'timing', 'Monday overconfidence', (s) => s.monday && s.monday.n >= 4 && s.monday.pnl < 0 && s.monday.winRate < 0.45 ? 30 : 0,
  (s, f) => `Monday entries lost ${f(Math.abs(s.monday.pnl))} over ${s.monday.n} trades.`,
  'After a weekend of reading and planning, Monday arrives with strong opinions and pent-up energy. Trades are taken to act on those opinions, ready or not.',
  'Monday starts with observation. Weekend views must be confirmed by price before acting.');
add(58, 'timing', 'One good month carries the year', (s) => s.months >= 4 && s.bestMonthShare > 0.8 ? clamp(30 + s.bestMonthShare * 40) : 0,
  (s, f) => `${s.bestMonth.key} alone made ${f(s.bestMonth.pnl)}, most of your total.`,
  'A single great month feels like proof of skill. But if the rest of the year is flat or negative, the edge may be one lucky stretch.',
  'Results are judged on consistency across months, not on the best one.');
add(59, 'timing', 'Losing streak months', (s) => s.months >= 4 && s.posMonths < 0.35 ? clamp(40 + (0.35 - s.posMonths) * 120) : 0,
  (s) => `Only ${P(s.posMonths)} of your months were profitable.`,
  'Repeated losing months make each new month a fresh attempt to break the pattern. The pressure to "finally have a good month" leads to forcing trades.',
  'After two losing months, size is reduced and the process is reviewed before scaling back up.');
add(60, 'timing', 'Boom and bust', (s) => s.months >= 4 && s.monthSwing > Math.abs(s.realized) * 1.5 && s.monthSwing > s.avgWin * 10 ? 40 : 0,
  (s, f) => `Your best month (${f(s.bestMonth.pnl)}) and worst month (${f(s.worstMonth.pnl)}) are far apart.`,
  'Large swings between months suggest risk is changing with mood: aggressive after good stretches, defensive or reckless after bad ones.',
  'Risk per trade stays the same across months, so results vary with the market, not with your confidence.');
add(61, 'timing', 'Late-session fatigue', (s) => s.closeB && s.openB && s.closeB.n >= 4 && s.closeB.avgPct < s.openB.avgPct - 5 ? 30 : 0,
  (s) => `Your late-session trades return much less on average than your early ones.`,
  'Decision quality drops as the session goes on. Attention fades and the bar for a good setup quietly lowers.',
  'The most important decisions are made when you are freshest; late trading is limited or stopped.');
add(62, 'timing', 'Impatience at the open', (s) => s.openB && s.openB.n >= 5 && s.timedN && s.openB.n / s.timedN > 0.5 && s.openB.pnl < 0 ? 40 : 0,
  (s) => `More than half of your trades are opened in the first part of the session, and they lose money.`,
  'The open is when the most information arrives at once. Acting immediately feels decisive, but it means acting before the information has settled.',
  'Let the first stretch of the session play out before acting, unless the plan says otherwise.');
add(63, 'timing', 'Holding through events', (s) => s.multiDay.n >= 5 && s.multiDay.pnl < 0 && s.sameDay.pnl > 0 ? 40 : 0,
  (s, f) => `Trades held overnight lost ${f(Math.abs(s.multiDay.pnl))}, while same-day trades made ${f(s.sameDay.pnl)}.`,
  'Overnight positions face news and gaps you cannot react to. If your edge is intraday, holding overnight swaps a skill-based game for a coin flip.',
  'Overnight risk is taken only by design, sized for a gap against you.');
add(64, 'timing', 'Short-term thinking in long trades', (s) => s.del.n >= 4 && s.del.pnl < 0 && s.intra.pnl >= 0 ? 40 : 0,
  (s, f) => `Positions you carried for days lost ${f(Math.abs(s.del.pnl))}, while your quick trades did better.`,
  'A trade that was meant to be quick becomes a "long-term investment" once it goes red. The story changes to justify not closing it.',
  'The holding period is set at entry. A short-term trade that fails is closed, not reclassified.');
add(65, 'timing', 'Recency bias', (s) => s.seq && s.late && s.early && s.late.wr < s.early.wr - 0.15 ? 35 : 0,
  (s) => `Your win rate fell from ${P(s.early.wr)} in your earlier trades to ${P(s.late.wr)} in the later ones.`,
  'Recent wins make the current approach feel right, so it is pushed harder even as conditions change. What worked last month gets applied to a market that has moved on.',
  'Setups are reviewed against recent market conditions, not just recent results.');
add(66, 'timing', 'Calendar fixation', (s) => s.dowWorst && s.dowBest && s.dowBest.pnl > 0 && s.dowWorst.pnl < 0 && s.dowBest.pnl - s.dowWorst.pnl > s.avgWin * 8 ? 30 : 0,
  (s, f) => `Your best weekday (${s.dowBest.key}) and worst (${s.dowWorst.key}) differ by ${f(s.dowBest.pnl - s.dowWorst.pnl)}.`,
  'Large differences between days point to routine and mindset rather than market structure. Your best day shows how you trade when conditions suit you.',
  'Recreate the conditions of your best day (preparation, timing, mood) on the others.');

// ── Selection & conviction (67–80)
add(67, 'selection', 'Sunk-cost loyalty', (s) => s.stubborn ? clamp(40 + s.stubborn.n * 2) : 0,
  (s, f) => `You kept trading ${s.stubborn.key}: ${s.stubborn.n} trades, ${P(s.stubborn.winRate)} win rate, ${f(s.stubborn.pnl)}.`,
  'Money lost in a name feels like an investment that must pay back. Each new trade is partly an attempt to recover the past, which makes it hard to walk away.',
  'Names that repeatedly lose are dropped for a fixed period. Past losses don\'t create future obligations.');
add(68, 'selection', 'Narrative attachment', (s) => s.stubborn && s.stubborn.n >= 6 ? 35 : 0,
  (s) => `${s.stubborn.key} keeps attracting your trades despite the results.`,
  'A strong story about a stock or index can override what the price is saying. The story is satisfying; the data is not.',
  'The question is always "what is price doing", not "what should it do".');
add(69, 'selection', 'Overconfidence', (s) => s.wr < 0.45 && s.n >= 20 && s.tradesPerDay >= 2 ? clamp(30 + (0.45 - s.wr) * 120) : 0,
  (s) => `You trade often (${s.tradesPerDay.toFixed(1)} per day) with a ${P(s.wr)} win rate.`,
  'Frequent trading usually comes with a belief that you can read the market well. The numbers suggest the reads are right less often than they feel.',
  'Confidence follows evidence: trade frequency rises only after a setup proves itself over many trades.');
add(70, 'selection', 'Confirmation bias', (s) => s.ce.n + s.pe.n >= 10 && Math.min(s.ce.n, s.pe.n) / Math.max(1, s.ce.n + s.pe.n) < 0.2 && s.expectancy < 0 ? 35 : 0,
  (s) => `Over 80% of your option trades are on one side of the market.`,
  'Once you hold a view, information that supports it feels convincing and the rest feels like noise. Trading one side only is often a view that has stopped being questioned.',
  'For every trade, write down what would prove it wrong.');
add(71, 'selection', 'Familiarity comfort', (s) => s.names <= 3 && s.n >= 15 && s.expectancy < 0 ? 35 : 0,
  (s) => `You trade only ${s.names} underlyings and the average trade loses money.`,
  'Sticking to what you know feels safe. But familiarity can turn into autopilot: trading the instrument because it is there, not because it is set up.',
  'Even familiar instruments need a fresh setup each time.');
add(72, 'selection', 'Short-side reluctance', (s) => s.long && s.short && s.longShare > 0.85 && s.short.pnl > 0 && s.short.n >= 3 ? 30 : 0,
  (s, f) => `Short trades made ${f(s.short.pnl)}, yet ${P(s.longShare)} of your trades are long.`,
  'Going short feels riskier and more uncomfortable than going long, even when the setup is equally clear. The discomfort limits a side that works for you.',
  'Both directions are traded when the setup appears.');
add(73, 'selection', 'Contrarian streak', (s) => s.short && s.long && s.short.n >= 5 && s.short.pnl < 0 && s.long.pnl > 0 ? 30 : 0,
  (s, f) => `Short trades lost ${f(Math.abs(s.short.pnl))} while long trades made ${f(s.long.pnl)}.`,
  'Betting against the move can feel clever, like seeing what others miss. But fighting the prevailing direction is one of the hardest ways to make money.',
  'Counter-trend trades get smaller size and tighter stops.');
add(74, 'selection', 'Diversification illusion', (s) => s.names >= 15 && s.top3Share > 0.5 ? 35 : 0,
  (s) => `You traded many names, but three trades still caused ${P(s.top3Share)} of your losses.`,
  'Spreading across many names feels safe, but a handful of oversized positions can still dominate. Variety does not replace a loss limit.',
  'Risk is controlled per trade, not by the number of names.');
add(75, 'selection', 'Outcome bias', (s) => s.wr >= 0.55 && s.expectancy < 0 ? clamp(40 + (s.wr - 0.55) * 100) : 0,
  (s) => `You're right ${P(s.wr)} of the time, yet the average trade loses money.`,
  'Being right often feels like proof of a good process. But money is made from the size of wins against losses. Judging a trade only by whether it worked hides the problem.',
  'Each trade is reviewed on its risk/reward and execution, not only on whether it won.');
add(76, 'selection', 'Skill attribution bias', (s) => s.bestMonth && s.worstMonth && s.bestMonth.pnl > 0 && s.worstMonth.pnl < 0 && s.months >= 4 && s.posMonths < 0.5 ? 25 : 0,
  (s) => `Profitable months (${P(s.posMonths)} of them) were outnumbered by losing ones.`,
  'Good months are credited to skill and bad months to the market. This keeps confidence intact but stops you from learning from the losing periods.',
  'Losing periods are reviewed with the same attention as winning ones.');
add(77, 'selection', 'Complexity creep', (s) => s.optShare > 0.2 && s.fut.n > 2 && s.eq.n > 2 && s.expectancy < 0 ? 30 : 0,
  (s) => `You split your trading across stocks, futures and options, and the average trade loses money.`,
  'Moving between instruments feels like adapting. It often means no single approach is practised long enough to become reliable.',
  'Master one instrument and one setup before adding another.');
add(78, 'selection', 'Copying conviction', (s) => s.oneHit >= 6 && s.n >= 15 && s.oneHit / s.n > 0.3 ? 25 : 0,
  (s) => `${s.oneHit} names were traded once and never again.`,
  'One-off trades in unfamiliar names often come from tips, social media or news. Borrowed conviction disappears the moment the trade goes against you.',
  'Trades come from your own setups. Outside ideas go on a watchlist first.');
add(79, 'selection', 'Need to be right', (s) => !s.noWins && s.payoff < 0.7 && s.wr > 0.5 ? clamp(40 + (0.7 - s.payoff) * 100) : 0,
  (s) => `A high win rate (${P(s.wr)}) paired with small winners and large losers.`,
  'For some traders a winning trade matters more as a sign of being right than as money. Losses get held so they don\'t have to be admitted, and wins are taken quickly to feel right.',
  'Measure success by money made per unit of risk, not by how often you\'re right.');
add(80, 'selection', 'Edge without evidence', (s) => s.n < 25 && s.n >= 8 && s.tradesPerDay >= 2 ? 20 : 0,
  (s) => `This report covers only ${s.n} trades.`,
  'With a small sample, a few lucky or unlucky trades can look like a pattern. Strong conclusions from little data lead to over-adjusting.',
  'Keep the process steady for 50–100 trades before judging a setup.');

// ── Consistency & self-management (81–100)
add(81, 'discipline', 'Rule erosion', (s) => s.seq && s.early && s.late && s.early.wr - s.late.wr > 0.1 && s.late.n >= 10 ? 30 : 0,
  (s) => `Your later trades won less often (${P(s.late.wr)}) than your earlier ones (${P(s.early.wr)}).`,
  'Rules are easiest to follow at the start. Each small exception that works out makes the next one easier, until the rules are mostly gone.',
  'Rules are written, checked before each trade, and reviewed weekly.');
add(82, 'discipline', 'Emotional bankroll', (s) => s.endsInDD ? 40 : 0,
  (s) => `You gave back a large share of your peak profit by the end of the period.`,
  'Giving back gains is hard to accept, so trading continues more aggressively to recover the peak. The peak becomes an anchor, and chasing it deepens the drawdown.',
  'A drawdown limit from the peak. Hitting it triggers a reduction in size and a review.');
add(83, 'discipline', 'Drawdown denial', (s) => s.maxDD > Math.abs(s.realized) * 1.5 && s.maxDD > s.avgWin * 8 ? 35 : 0,
  (s, f) => `At the worst point you were ${f(s.maxDD)} below your peak.`,
  'A deep drawdown is easy to dismiss as temporary. But the depth of a drawdown shows how much risk was really being taken, regardless of where the account ends up.',
  'A maximum drawdown is set in advance. Reaching it means stopping and reassessing.');
add(84, 'discipline', 'No circuit breaker', (s) => s.seq && s.worstStreak >= 4 && s.worstDay && s.worstDay.n >= 4 ? 35 : 0,
  (s, f) => `Your worst day had ${s.worstDay.n} trades and lost ${f(Math.abs(s.worstDay.pnl))}.`,
  'Without a stopping rule, the decision to stop is left to the person least able to make it: the one who is losing.',
  'Pre-set stopping points: daily loss limit, max consecutive losses, max trades per day.');
add(85, 'discipline', 'Process over outcome gap', (s) => s.expectancy < 0 && s.n >= 30 ? clamp(30 + Math.min(40, s.n / 5)) : 0,
  (s, f) => `Across ${s.n} trades, the average trade loses ${f(Math.abs(s.expectancy))}.`,
  'Over a large number of trades, luck mostly cancels out. A negative average across many trades is a process problem, not a bad patch.',
  'The process is changed in one specific way, then measured over the next 30–50 trades.');
add(86, 'discipline', 'Plan-free trading', (s) => !s.noWins && s.payoff < 1 && s.deep10 > 0.25 && s.tinyWins > 0.25 ? 45 : 0,
  (s) => `Exits look unplanned on both sides: tiny wins and large losses.`,
  'Without a written plan, each exit is decided in the moment by feelings: fear when in profit, hope when in loss. The plan is what protects you from your own reactions.',
  'Entry, stop and target are written before the order is placed.');
add(87, 'discipline', 'Inconsistent effort', (s) => s.tradingDays && s.tradingDays >= 10 && s.busiestDay && s.busiestDay.n >= Math.max(6, s.tradesPerDay * 3) ? 30 : 0,
  (s) => `Your busiest day had ${s.busiestDay.n} trades, far above your usual ${s.tradesPerDay.toFixed(1)}.`,
  'Sudden bursts of activity are usually emotional: excitement, frustration or boredom. The routine breaks and with it the quality of decisions.',
  'A steady routine: similar number of trades, similar times, similar preparation every day.');
add(88, 'discipline', 'Ignoring costs as feedback', (s) => s.realized > 0 && s.net < 0 ? 60 : 0,
  (s, f) => `You made ${f(s.realized)} before costs but ended at ${f(s.net)} after them.`,
  'Gross profit feels like success, so the strategy seems to work. Costs are the feedback that it doesn\'t, at this frequency.',
  'Judge performance after all costs. Reduce trade count until net results improve.');
add(89, 'discipline', 'Learning blind spot', (s) => s.top3Share > 0.5 && s.n >= 15 ? 25 : 0,
  (s) => `Your biggest losses are concentrated in a few trades that are easy to forget.`,
  'Painful trades are the ones we least want to look at, so they get the least review. They are also the ones with the most to teach.',
  'Review the three worst trades of every month before anything else.');
add(90, 'discipline', 'Frustration spiral', (s) => s.seq && s.worstStreak >= 6 && s.afterLoss.avg < 0 ? 40 : 0,
  (s) => `Losing streaks run long (${s.worstStreak} in a row), and trades after losses are negative on average.`,
  'Each loss adds frustration, and frustration lowers the standard for the next trade. The streak continues not because of the market but because of the state of mind.',
  'After a set number of consecutive losses, stop for the day. The market will be there tomorrow.');
add(91, 'discipline', 'Mental accounting', (s) => s.decayN >= 2 && s.zeroN >= 2 ? 30 : 0,
  (s) => `Some option trades are treated like income (sold and left to decay) and others like lottery tickets (bought and left to expire).`,
  'Different "mental accounts" get different rules: one pot is played carefully, another recklessly. But all of it is the same money.',
  'One set of risk rules applies to all positions.');
add(92, 'discipline', 'Impatience', (s) => s.sameDay.n >= 10 && s.sameDay.pnl < 0 && s.multiDay.pnl > 0 ? 40 : 0,
  (s, f) => `Same-day trades lost ${f(Math.abs(s.sameDay.pnl))}; positions held longer made ${f(s.multiDay.pnl)}.`,
  'Quick trades feel more controllable and give instant feedback. But your better results come from letting ideas develop.',
  'Favour the holding period that your own data says works.');
add(93, 'discipline', 'Too many decisions', (s) => s.tradesPerDay >= 5 ? clamp(30 + s.tradesPerDay * 4) : 0,
  (s) => `You average ${s.tradesPerDay.toFixed(1)} trades per trading day.`,
  'Every trade is a decision, and decision quality drops with each one made. By late in the day, the brain is choosing the easiest option, not the best one.',
  'Limit decisions: fewer trades, made with a fresh mind.');
add(94, 'discipline', 'Unexamined winners', (s) => s.pf >= 1.2 && s.top3Share > 0.5 ? 25 : 0,
  (s) => `You're profitable overall, but a few losses still do most of the damage.`,
  'When the total is positive, there\'s little urge to look closer. But the few large losses show where the next big setback will come from.',
  'Even in good periods, review the largest losses and what allowed them.');
add(95, 'discipline', 'Scarcity mindset', (s) => s.tinyWins > 0.4 && s.chargesRatio > 0.3 ? 40 : 0,
  (s) => `Many small wins are taken quickly, and charges consume a large share of the profit.`,
  'Grabbing every small gain comes from fear that opportunities are scarce. In reality setups repeat; there is no need to grab each one immediately.',
  'Wait for setups with room to pay. There will be another one.');
add(96, 'discipline', 'Perfectionism after loss', (s) => s.seq && s.afterLoss.n >= 5 && s.afterLoss.wr < s.afterWin.wr - 0.15 ? 30 : 0,
  (s) => `Your win rate after a loss (${P(s.afterLoss.wr)}) is well below your rate after a win (${P(s.afterWin.wr)}).`,
  'A loss can trigger an urge to make the next trade perfect, leading to over-analysis, hesitation, then a forced entry when the move has already happened.',
  'The trade after a loss uses the exact same checklist. No extra conditions, no shortcuts.');
add(97, 'discipline', 'Avoiding the hard data', (s) => s.n >= 10 && s.expectancy < 0 && s.wr >= 0.45 ? 25 : 0,
  (s) => `Your win rate (${P(s.wr)}) looks healthy, but the average trade still loses.`,
  'A decent win rate is a comfortable number to focus on. The harder numbers (average loss, worst trades, costs) are where the truth is.',
  'Track expectancy per trade every week, not just the win rate.');
add(98, 'discipline', 'Stop-loss aversion', (s) => s.deep10 > 0.4 && (s.noWins || s.payoff < 1) ? clamp(40 + s.deep10 * 50) : 0,
  (s) => `${P(s.deep10)} of losing trades went beyond a 10% loss.`,
  'Placing a stop means accepting in advance that you might be wrong. Many traders avoid it to keep the possibility of being right alive.',
  'A stop is part of every order. A trade without a stop is not taken.');
add(99, 'discipline', 'Self-attribution after streaks', (s) => s.seq && s.winStreak >= 5 && s.worstStreak >= 5 ? 30 : 0,
  (s) => `You had a ${s.winStreak}-trade winning streak and a ${s.worstStreak}-trade losing streak.`,
  'Winning streaks feel like skill and losing streaks feel like bad luck. Both are often the same process meeting different market conditions.',
  'Size and rules stay the same through streaks of either kind.');
add(100, 'discipline', 'Comfort in the familiar loss', (s) => s.stubborn && s.zeroN >= 2 ? 30 : 0,
  (s) => `Losses repeat in the same places: ${s.stubborn.key} and options held to zero.`,
  'Repeating the same mistake can feel safer than trying something new, because the outcome is familiar. Familiar pain is easier to accept than uncertain change.',
  'Pick one repeated mistake and build a rule against it this week.');

export const TRAITS = T;

/* ---------- per-tile behaviour (hover cards) ---------- */
export function tileBehaviours(s, f) {
  const pc = (x) => P(x);
  const T = {};
  const set = (k, now, ideal) => { if (now) T[k] = { now, ideal }; };
  set('net', s.net >= 0 ? `You finished ${f(s.net)} after every cost.` : `You finished ${f(s.net)} after every cost.`, 'Net P&L after costs is the only number that pays. Judge every change to your trading by its effect here.');
  set('gross', `Before costs you made ${f(s.realized)}.`, 'Gross P&L should comfortably exceed costs; if it barely does, trade less, not more.');
  set('costs', `Costs were ${pc(s.chargesRatio)} of what your winners made.`, 'Costs under 15–20% of gross profit. Fewer trades with larger targets get you there.');
  set('winrate', `You win ${pc(s.wr)} of trades.`, 'Win rate only matters alongside payoff. 40% with 2:1 winners beats 60% with 1:2.');
  set('payoff', s.noWins ? 'No winning trades in this file yet.' : `Average win is ${s.payoff.toFixed(2)}× the average loss.`, 'A payoff above 1.5 gives room for a normal win rate to be profitable.');
  set('avgwin', `Your average winner is ${f(s.avgWin)} (${s.avgWinPct.toFixed(1)}%).`, 'Winners run to a planned target instead of being taken at the first sign of profit.');
  set('avgloss', `Your average loser is ${f(s.avgLoss)} (${s.avgLossPct.toFixed(1)}%).`, 'Losers closed at a pre-set stop, so the average loss is smaller than the average win.');
  set('pf', `For every 1 lost you made ${Math.min(s.pf, 99).toFixed(2)}.`, 'A profit factor above 1.3 after costs is a sustainable edge.');
  set('worst', s.noWins ? `Your worst trade was ${f(s.largestLoss)}.` : `Your worst trade was ${f(s.largestLoss)}, about ${s.bigLossX.toFixed(1)} average wins.`, 'The worst trade is no bigger than one or two average wins.');
  set('costsPanel', s.chargesRatio > 0.3 ? `Costs are a major drag: ${pc(s.chargesRatio)} of gross profit.` : `Costs are ${pc(s.chargesRatio)} of gross profit.`, 'Every trade expected to make several times its cost.');
  set('leaks', `${s.top3Share > 0.4 ? `Three trades cause ${pc(s.top3Share)} of losses.` : 'Losses are spread across many trades.'}`, 'Leaks are fixed one at a time, starting with the most expensive.');
  set('curve', s.maxDD ? `At the worst point you were ${f(s.maxDD)} below your peak.` : 'Your equity curve over the period.', 'A steady upward slope with shallow dips; deep drops mean risk per trade is too high.');
  set('instrument', s.optShare > 0.5 ? `${pc(s.optShare)} of your trades are options.` : 'Your mix across instruments.', 'Capital goes to the instrument where your results are best, not where the action is.');
  set('year', 'How each expiry year contributed.', 'Improvement shows as each year being better than the last.');
  if (s.seq) set('afterwinloss', `After a loss your next trade averages ${f(s.afterLoss.avg)}; after a win, ${f(s.afterWin.avg)}.`, 'The trade after a loss looks like any other trade: same size, same checklist.');
  set('diagnosis', s.expectancy < 0 ? `The average trade loses ${f(Math.abs(s.expectancy))}.` : `The average trade makes ${f(s.expectancy)}.`, 'A positive average trade after costs, held steady over hundreds of trades.');
  set('rules', 'Rules built from your own mistakes.', 'Rules are followed before every trade, not just read once.');
  set('patterns', 'Where your results cluster.', 'Do more of what works, pause what consistently doesn\'t.');
  set('psych', 'The habits behind the numbers.', 'Awareness first; then one rule per habit, tested for a month.');
  set('stopsOpt', s.zeroN ? `${s.zeroN} bought options were held to near zero.` : 'How a premium stop would have changed results.', 'Bought options exit at a fixed share of premium, usually 30–40% down.');
  set('stopsLin', s.futBig ? `${s.futBig} futures lost 5%+ of notional.` : 'How a price stop would have changed results.', 'Stops sized so a full stop-out is a normal loss.');
  set('working', 'What already works for you.', 'Protect your strengths: give them the most capital and the least interference.');
  set('group', 'Results by type of instrument.', 'Concentrate on the instrument with the best results per trade.');
  set('weekday', 'Results by the weekday your contracts expired.', 'If one expiry day stands out as losing, avoid holding into it.');
  set('premium', s.cheapShare > 0.3 ? `${pc(s.cheapShare)} of options were bought at very low premiums.` : 'Results by the premium you paid.', 'Pick strikes for probability and liquidity, not price.');
  set('expiryType', s.weeklyShare ? `${pc(s.weeklyShare)} of your options were weekly contracts.` : 'Weekly vs monthly contracts.', 'Match the expiry to how long your idea needs.');
  set('callPut', s.ce.n + s.pe.n ? `${pc(s.ceShare)} of your options were calls.` : 'Calls vs puts.', 'Trade the side the setup shows; review each side separately.');
  set('entryDow', s.dowWorst ? `${s.dowWorst.key} is your weakest entry day.` : 'Results by the day you opened trades.', 'Size down on days that consistently lose until you know why.');
  set('entryHour', s.openB ? `Early-session entries: ${pc(s.openB.winRate)} win rate.` : 'Results by time of entry.', 'Trade the hours where your record is best; sit out the rest.');
  set('hold', s.holdN ? `Losers held ${s.holdL.toFixed(1)} days, winners ${s.holdW.toFixed(1)} days.` : 'Results by how long you held.', 'Winners held at least as long as losers.');
  set('busyDay', s.busy.n ? `Busy days (4+ trades): ${f(s.busy.pnl)}.` : 'Results by how many trades you made that day.', 'A daily trade limit. Quality drops as the count rises.');
  set('direction', s.long && s.short ? `${pc(s.longShare)} of your trades were long.` : 'Long vs short.', 'Both sides traded when the setup is there.');
  set('month', s.months ? `${pc(s.posMonths)} of months were profitable.` : 'Month by month.', 'Most months profitable, with small losing months.');
  set('size', s.bigQ.n ? `Your largest positions: ${pc(s.bigQ.wr)} win rate, ${f(s.bigQ.pnl)}.` : 'Results by position size.', 'Size follows a formula, not conviction.');
  set('style', s.del.n ? `Positions carried for days: ${f(s.del.pnl)}.` : 'Intraday vs carried positions.', 'Holding period decided at entry, never changed because a trade is losing.');
  set('lossDepth', `${pc(s.deep10)} of losers went past −10%.`, 'Most losses small, almost none deep. Deep losses mean stops weren\'t used.');
  set('worstU', s.stubborn ? `${s.stubborn.key} keeps losing for you.` : 'The names that cost you most.', 'Repeat losers go on a pause list.');
  set('bestU', 'The names that pay you most.', 'Give your best names priority and patience.');
  set('positions', `Every position, ${s.n} in total.`, 'Review the worst five positions every week.');
  return T;
}

/* ---------- selection ---------- */
export function buildBehaviour(ctx, f) {
  const s = computeSignals(ctx);
  const scored = [];
  for (const t of TRAITS) {
    let sc = 0;
    try { sc = t.score(s) || 0; } catch { sc = 0; }
    if (sc > 0) {
      let now = '';
      try { now = t.now(s, f); } catch { now = ''; }
      if (now && !/undefined|NaN|Infinity/.test(now)) scored.push({ id: t.id, area: t.area, name: t.name, score: sc, now, why: t.why, ideal: t.ideal });
    }
  }
  scored.sort((a, c) => c.score - a.score);
  // keep variety: at most 2 per area in the headline set
  const headline = [], perArea = {};
  for (const t of scored) { if ((perArea[t.area] || 0) >= 2) continue; perArea[t.area] = (perArea[t.area] || 0) + 1; headline.push(t); if (headline.length >= 8) break; }
  const rest = scored.filter((t) => !headline.includes(t));
  const level = (sc) => (sc >= 60 ? 'Strong' : sc >= 40 ? 'Clear' : 'Emerging');
  return {
    traits: headline.map((t) => ({ ...t, level: level(t.score) })),
    more: rest.slice(0, 12).map((t) => ({ ...t, level: level(t.score) })),
    tiles: tileBehaviours(s, f),
    checked: TRAITS.length,
  };
}
