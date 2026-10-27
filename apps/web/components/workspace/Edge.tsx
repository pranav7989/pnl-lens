/**
 * @file  apps/web/components/workspace/Edge.tsx
 * @area  Reports
 * @what  "Edge" tab: skill or luck (verdict, 90% range, trades needed); the next 100 trades (fan chart, drawdowns, give-back chances); consistency and risk by day; R-multiples; when you trade (weekday × hour heatmap, options by days to expiry).
 */
'use client';
import { useEffect, useMemo, useState } from 'react';
import { edgeVerdict, project, MIN_TRADES, type Verdict } from '@pnl-lens/shared/insights/edge';
import { consistency, rMultiples, heatmap, daysToExpiry, type Heatmap, type Bucket } from '@pnl-lens/shared/insights/deep';
import CapitalPanel from './CapitalPanel';
import ComparePanel from './ComparePanel';

const VERDICT: Record<Verdict, { title: string; tone: string; text: string }> = {
  real: { title: 'Your edge looks real', tone: 'gain', text: 'Even in unlucky reshuffles of these trades, the average trade stays above zero.' },
  unproven: { title: 'Not proven yet', tone: 'warn', text: 'The average trade could be above or below zero; these trades alone cannot tell skill from luck.' },
  negative: { title: 'Negative edge', tone: 'loss', text: 'Even in lucky reshuffles of these trades, the average trade stays below zero. The process needs to change, not the luck.' },
  'too-few': { title: 'Too few trades to judge', tone: 'mut', text: `At least ${MIN_TRADES} closed trades are needed to say anything about an edge.` },
};
const pct = (v: number) => `${Math.round(v * 100)}%`;

function Range({ low, high, avg, money }: { low: number; high: number; avg: number; money: (v: number) => string }) {
  const lo = Math.min(low, 0, avg), hi = Math.max(high, 0, avg), span = hi - lo || 1;
  const X = (v: number) => `${((v - lo) / span) * 100}%`;
  return (
    <div className="eg-range" role="img" aria-label={`Average trade ${money(avg)}, 90% range ${money(low)} to ${money(high)}`}>
      <div className="eg-range-h">Where your average trade lies, 90% sure (yellow), against zero (dashed)</div>
      <div className="eg-track">
        <span className="eg-zero" style={{ left: X(0) }}><i>0</i></span>
        <span className="eg-band" style={{ left: X(low), width: `calc(${X(high)} - ${X(low)})` }} />
        <span className="eg-avg" style={{ left: X(avg) }} />
      </div>
      <div className="eg-range-l"><span>{money(low)}</span><span>{money(high)}</span></div>
    </div>
  );
}

function Fan({ p, money }: { p: NonNullable<ReturnType<typeof project>>; money: (v: number) => string }) {
  const W = 720, H = 240, pad = 12;
  const lo = Math.min(0, ...p.p5), hi = Math.max(0, ...p.p95), span = hi - lo || 1;
  const X = (i: number) => pad + (i * (W - 2 * pad)) / p.horizon;
  const Y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const line = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const area = (a: number[], b: number[]) => `${line(a)} ${b.map((v, i) => `L${X(b.length - 1 - i).toFixed(1)},${Y(b[b.length - 1 - i]).toFixed(1)}`).join(' ')} Z`;
  return (
    <svg className="eg-fan" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label={`Next ${p.horizon} trades: middle outcome ${money(p.p50[p.horizon])}, 1 in 20 worse than ${money(p.p5[p.horizon])}, 1 in 20 better than ${money(p.p95[p.horizon])}`}>
      <line x1={pad} x2={W - pad} y1={Y(0)} y2={Y(0)} className="eg-zero-l" />
      <path d={area(p.p95, p.p5)} className="eg-outer" />
      <path d={area(p.p75, p.p25)} className="eg-inner" />
      <path d={line(p.p50)} className="eg-mid" />
    </svg>
  );
}

const HOUR = (h: number) => `${String(h).padStart(2, '0')}:00`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dm = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(d)} ${MON[Number(m) - 1]} ${y.slice(2)}`; };
const ratio = (v: number | null) => (v === null ? '—' : (Math.round(v * 100) / 100).toFixed(2));

function HeatGrid({ h, money }: { h: Heatmap; money: (v: number) => string }) {
  const max = Math.max(1, ...Object.values(h.cells).map((c) => Math.abs(c.pnl)));
  return (
    <div className="eg-heat-wrap">
      <table className="eg-heat">
        <thead><tr><th />{h.hours.map((x) => <th key={x}>{HOUR(x)}</th>)}</tr></thead>
        <tbody>{h.days.map((d) => (
          <tr key={d}><th>{d.slice(0, 3)}</th>{h.hours.map((x) => {
            const c = h.cells[`${d}|${x}`];
            if (!c) return <td key={x} className="none" />;
            const a = Math.max(0.12, Math.abs(c.pnl) / max);
            return <td key={x} className={c.pnl >= 0 ? 'up' : 'down'} style={{ ['--a' as any]: a }} title={`${d} ${HOUR(x)}: ${c.n} trade${c.n === 1 ? '' : 's'}, ${money(c.pnl)}`}><span>{c.n}</span></td>;
          })}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function BucketBars({ rows, money }: { rows: Bucket[]; money: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));
  return (
    <ul className="eg-buckets">{rows.map((r) => (
      <li key={r.key}><span className="k">{r.key}</span><span className="eg-bt"><i className={r.pnl >= 0 ? 'up' : 'down'} style={{ width: `${(Math.abs(r.pnl) / max) * 100}%` }} /></span>
        <b className={r.pnl >= 0 ? 'gain' : 'loss'}>{money(r.pnl)}</b><small>{r.n} trade{r.n === 1 ? '' : 's'} · {Math.round(r.winRate * 100)}% won</small></li>
    ))}</ul>
  );
}

export default function Edge({ report, money, active, capital }: { report: any; money: (v: number) => string; active: boolean; capital?: { reportId: string; value: number | null } | null }) {
  const trades: any[] = report?.trades || [];
  // the simulations run only once the tab is first opened, then stay for this report
  const [opened, setOpened] = useState(active);
  useEffect(() => { if (active) setOpened(true); }, [active]);
  const e = useMemo(() => (opened ? edgeVerdict(trades) : null), [trades, opened]);
  const p = useMemo(() => (opened ? project(trades) : null), [trades, opened]);
  const deep = useMemo(() => (opened ? { c: consistency(trades), r: rMultiples(trades), h: heatmap(trades), dte: daysToExpiry(trades) } : null), [trades, opened]);
  if (!e) return null;
  const v = VERDICT[e.verdict];
  const more = e.needed && e.needed > e.n ? e.needed - e.n : 0;
  return (
    <div className="rv-grid eg" data-edge>
      <div className="rv-panel s12 eg-hero" data-tone={v.tone}>
        <div className="rv-ph"><h3>Skill or luck?</h3><small>from your {e.n} closed trades, reshuffled thousands of times</small></div>
        <div className="eg-verdict">
          <div className="eg-badge" data-verdict={e.verdict}><b>{v.title}</b><p>{v.text}</p></div>
          {e.verdict !== 'too-few' && (
            <div className="eg-facts">
              <div><span className="eg-k">Average trade</span><b>{money(e.avg)}</b><small>90% sure it is between {money(e.low)} and {money(e.high)}</small></div>
              <div><span className="eg-k">Chance it is luck</span><b>{pct(e.luck)}</b><small>share of reshuffles where the average trade is zero or worse</small></div>
              <div><span className="eg-k">Trades to be sure</span><b>{e.avg <= 0 ? '—' : more ? `about ${more} more` : 'enough already'}</b><small>{e.avg <= 0 ? 'only a positive average can be confirmed' : 'at your current average and spread'}</small></div>
            </div>
          )}
        </div>
        {e.verdict !== 'too-few' && <Range low={e.low} high={e.high} avg={e.avg} money={money} />}
      </div>

      {p && (
        <div className="rv-panel s12 eg-proj">
          <div className="rv-ph"><h3>Your next {p.horizon} trades</h3><small>if they look like your past ones, in random order</small></div>
          <div className="eg-proj-grid">
            <div>
              <Fan p={p} money={money} />
              <div className="eg-legend"><span className="l-mid">Middle outcome</span><span className="l-inner">Half of outcomes</span><span className="l-outer">9 in 10 outcomes</span></div>
            </div>
            <ul className="eg-stats">
              <li><span>Middle outcome</span><b className={p.p50[p.horizon] >= 0 ? 'gain' : 'loss'}>{money(p.p50[p.horizon])}</b></li>
              <li><span>1 in 20 ends worse than</span><b className={p.p5[p.horizon] >= 0 ? 'gain' : 'loss'}>{money(p.p5[p.horizon])}</b></li>
              <li><span>Chance of ending in profit</span><b>{pct(p.profitChance)}</b></li>
              <li><span>Typical worst dip on the way</span><b className="loss">{money(p.ddTypical)}</b></li>
              <li><span>1 in 20 has a dip worse than</span><b className="loss">{money(p.ddBad)}</b></li>
              {p.giveBack25 !== null && <li><span>Chance of giving back a quarter of your profit</span><b>{pct(p.giveBack25)}</b></li>}
              {p.giveBack50 !== null && <li><span>…or half of it</span><b>{pct(p.giveBack50)}</b></li>}
            </ul>
          </div>
          <p className="rv-note">Built only from the trades in this report: each simulated path draws your own past trades at random, again and again. Markets change and your trading will too, so treat this as a picture of your past results, not a forecast. Not investment advice.</p>
        </div>
      )}

      {capital && <ComparePanel reportId={capital.reportId} />}
      {capital && <CapitalPanel reportId={capital.reportId} initial={capital.value} trades={trades} money={money} />}

      {deep?.c && (
        <div className="rv-panel s12" data-consistency>
          <div className="rv-ph"><h3>Consistency and risk</h3><small>by trading day · {deep.c.days} days</small></div>
          <div className="eg-cgrid">
            <div><span className="eg-k">Green days</span><b>{pct(deep.c.greenDays)}</b><small>average day {money(deep.c.avgDay)}</small></div>
            <div><span className="eg-k">Best day</span><b className="gain">{money(deep.c.bestDay.pnl)}</b><small>{dm(deep.c.bestDay.date)}</small></div>
            <div><span className="eg-k">Worst day</span><b className="loss">{money(deep.c.worstDay.pnl)}</b><small>{dm(deep.c.worstDay.date)}{deep.c.worstVsTypicalLoss ? ` · ${ratio(deep.c.worstVsTypicalLoss)}× a normal losing day` : ''}</small></div>
            <div><span className="eg-k">Worst drawdown</span><b className="loss">{money(deep.c.maxDD)}</b><small>{deep.c.maxDD < 0 ? `${deep.c.ddDays} trading day${deep.c.ddDays === 1 ? '' : 's'} down · ${deep.c.recoveryDays === null ? 'not made back yet' : `made back in ${deep.c.recoveryDays}`}` : 'no drawdown'}</small></div>
            <div><span className="eg-k">Return per unit of risk</span><b>{ratio(deep.c.sharpe)}</b><small>Sharpe-style, daily; above 1 is steady{deep.c.sortino !== null ? ` · downside only ${ratio(deep.c.sortino)}` : ''}</small></div>
            <div><span className="eg-k">Profit from your 3 best days</span><b>{deep.c.top3Share === null ? '—' : pct(deep.c.top3Share)}</b><small>{deep.c.top3Share !== null && deep.c.top3Share > 0.6 ? 'a few days carry the result' : 'profit is spread out'}{deep.c.greenMonths !== null ? ` · ${pct(deep.c.greenMonths)} of months green` : ''}</small></div>
          </div>
          {deep.c.underwaterNow > 0 && <p className="rv-note">You are {deep.c.underwaterNow} trading day{deep.c.underwaterNow === 1 ? '' : 's'} past your last high in this report.</p>}
        </div>
      )}

      {deep?.r && (
        <div className="rv-panel s6" data-r-multiples>
          <div className="rv-ph"><h3>Wins and losses in R</h3><small>1R = your average loss, {money(deep.r.r)}</small></div>
          <BucketBars rows={deep.r.buckets.filter((b) => b.n > 0)} money={money} />
          <p className="rv-note">Average trade {ratio(deep.r.avgR)}R · {deep.r.bigWins} win{deep.r.bigWins === 1 ? '' : 's'} of 2R or more · {deep.r.bigLosses} loss{deep.r.bigLosses === 1 ? '' : 'es'} of 2R or worse.</p>
        </div>
      )}

      {deep?.dte && (
        <div className="rv-panel s6" data-dte>
          <div className="rv-ph"><h3>Options by days to expiry</h3><small>days from entry to expiry</small></div>
          <BucketBars rows={deep.dte} money={money} />
        </div>
      )}

      {deep?.h && (
        <div className="rv-panel s12" data-heatmap>
          <div className="rv-ph"><h3>When you trade</h3><small>entry day × entry hour · number = trades, colour = P&amp;L</small></div>
          <HeatGrid h={deep.h} money={money} />
          {(deep.h.best || deep.h.worst) && <p className="rv-note">{deep.h.best ? `Best slot: ${deep.h.best.day} ${HOUR(deep.h.best.hour)} (${money(deep.h.best.pnl)}). ` : ''}{deep.h.worst ? `Worst slot: ${deep.h.worst.day} ${HOUR(deep.h.worst.hour)} (${money(deep.h.worst.pnl)}).` : ''}</p>}
        </div>
      )}
    </div>
  );
}
