/**
 * @file  apps/web/components/workspace/Rewind.tsx
 * @area  Reports
 * @what  "Rewind" tab: replay this report's own trades with rules the user picks (stop, days, hours, trades a day, stop after losses, no re-entry, skip names, cap size); live new P&L, curve and what each rule did.
 */
'use client';
import { useMemo, useRef, useState } from 'react';
import { rewind, losingNames, entryHours, planRules, entryWeekday, type RewindRules, type RuleKey } from '@pnl-lens/shared/insights/simulate';
import { buildPlan } from '@pnl-lens/shared/plan';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const RULE_NAMES: Record<RuleKey, string> = {
  stopPct: 'Stop at the loss limit', skipWeekdays: 'Skip those weekdays', skipHours: 'Skip those hours', maxPerDay: 'Trades a day capped',
  stopAfterLosses: 'Stop for the day after losses', noReentryAfterLoss: 'No re-entry after a loss', skipNames: 'Skip those names', maxSize: 'Position size capped',
};
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

function Curve({ actual, rewound }: { actual: number[]; rewound: number[] }) {
  const W = 720, H = 220, pad = 10;
  const all = [0, ...actual, ...rewound], lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const Y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  // both lines start at 0 before the first trade
  const pts = (xs: number[]) => { const ys = [0, ...xs]; return ys.map((v, i) => `${i ? 'L' : 'M'}${(pad + (i * (W - 2 * pad)) / Math.max(1, ys.length - 1)).toFixed(1)},${Y(v).toFixed(1)}`).join(' '); };
  return (
    <svg className="rw-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Your real P&L and the rewound P&L, trade by trade">
      <line x1={pad} x2={W - pad} y1={Y(0)} y2={Y(0)} className="rw-zero" />
      <path d={pts(actual)} className="rw-actual" />
      <path d={pts(rewound)} className="rw-rewound" />
    </svg>
  );
}

function Chip({ on, children, onClick, title }: { on: boolean; children: React.ReactNode; onClick: () => void; title?: string }) {
  return <button type="button" className={`rw-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick} title={title}>{children}</button>;
}

export default function Rewind({ report, money, onFirstUse }: { report: any; money: (v: number) => string; onFirstUse?: () => void }) {
  const trades: any[] = report?.trades || [];
  const [rules, setRules] = useState<RewindRules>({});
  const used = useRef(false);
  const res = useMemo(() => rewind(trades, rules), [trades, rules]);
  const names = useMemo(() => losingNames(trades), [trades]);
  const hours = useMemo(() => entryHours(trades), [trades]);
  const days = useMemo(() => DAYS.filter((d) => trades.some((t) => entryWeekday(t) === d)), [trades]);
  const sizes = useMemo(() => {
    const b = trades.map((t) => Number(t.buy)).filter((v) => v > 0).sort((a, z) => a - z);
    const q = (p: number) => b[Math.min(b.length - 1, Math.floor(p * b.length))];
    return b.length >= 4 ? [...new Set([q(0.5), q(0.75), q(0.9)].map((v) => Math.round(v)))] : [];
  }, [trades]);
  const plan = useMemo(() => { try { return planRules(buildPlan(report)); } catch { return {}; } }, [report]);
  const hasPlan = Object.keys(plan).length > 0;

  const set = (patch: Partial<RewindRules>) => {
    if (!used.current) { used.current = true; onFirstUse?.(); }
    setRules((r) => ({ ...r, ...patch }));
  };
  const toggleIn = <K extends 'skipWeekdays' | 'skipHours' | 'skipNames'>(k: K, v: NonNullable<RewindRules[K]>[number]) => {
    const cur = (rules[k] || []) as any[];
    set({ [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } as Partial<RewindRules>);
  };
  const a = res.available;
  const active = res.byRule.length > 0;
  const tone = res.delta > 0 ? 'gain' : res.delta < 0 ? 'loss' : '';
  const sign = (v: number) => (v > 0 ? '+' : '') + money(v);

  if (!trades.length) return <div className="rv-panel"><p className="rv-empty">Rewind needs closed trades.</p></div>;
  return (
    <div className="rv-grid rw" data-rewind>
      <div className="rv-panel s12 rw-head">
        <div className="rv-ph"><h3>Rewind</h3><small>replay your own trades with different rules · not a forecast</small></div>
        <div className="rw-result">
          <div><span className="rw-k">Real result</span><b className="rw-v" data-actual>{money(res.actual.net)}</b><small>{res.actual.n} trades · {Math.round(res.actual.winRate * 100)}% won · worst drawdown {money(res.actual.maxDD)}</small></div>
          <div className="rw-arrow" aria-hidden="true">→</div>
          <div><span className="rw-k">With these rules</span><b className={`rw-v ${tone}`} data-rewound>{money(res.rewound.net)}</b><small>{res.rewound.n} trades · {Math.round(res.rewound.winRate * 100)}% won · worst drawdown {money(res.rewound.maxDD)}</small></div>
          <div className={`rw-delta ${tone}`} data-delta>{active ? <><b>{sign(res.delta)}</b><span>{res.delta >= 0 ? 'more' : 'less'} than you made</span></> : <span>Pick a rule below to replay your trades</span>}</div>
        </div>
        <Curve actual={res.curve.actual} rewound={res.curve.rewound} />
        <div className="rw-legend"><span className="l-actual">Real</span><span className="l-rewound">Rewound</span>{res.skipped ? <span className="mut">{res.skipped} trade{res.skipped === 1 ? '' : 's'} not taken</span> : null}{res.stopped ? <span className="mut">{res.stopped} loss{res.stopped === 1 ? '' : 'es'} cut at the stop</span> : null}</div>
      </div>

      <div className="rv-panel s7 rw-controls">
        <div className="rv-ph"><h3>Your rules</h3><small>mix and match</small></div>
        <div className="rw-bar">
          {hasPlan && <button type="button" className="btn" onClick={() => set(plan)} data-rewind-plan>Try my 30-day plan rules</button>}
          <button type="button" className="btn ghost" onClick={() => setRules({})} disabled={!active}>Reset</button>
        </div>

        <fieldset className="rw-row" disabled={!a.stopPct}>
          <legend>Stop each loss at</legend>
          <label className="rw-switch"><input type="checkbox" checked={!!rules.stopPct} onChange={(e) => set({ stopPct: e.target.checked ? 30 : null })} /> <span>{rules.stopPct ? `−${rules.stopPct}% of the position` : 'Off'}</span></label>
          {!!rules.stopPct && <input type="range" min={5} max={80} step={5} value={rules.stopPct} aria-label="Stop loss percent" onChange={(e) => set({ stopPct: Number(e.target.value) })} />}
        </fieldset>

        <fieldset className="rw-row" disabled={!a.maxPerDay}>
          <legend>Trades a day, at most{!a.maxPerDay && <em> · needs trade dates</em>}</legend>
          <div className="rw-chips">{[null, 1, 2, 3, 5].map((n) => <Chip key={String(n)} on={(rules.maxPerDay ?? null) === n} onClick={() => set({ maxPerDay: n })}>{n ?? 'No limit'}</Chip>)}</div>
        </fieldset>

        <fieldset className="rw-row" disabled={!a.stopAfterLosses}>
          <legend>Stop for the day after{!a.stopAfterLosses && <em> · needs trade dates</em>}</legend>
          <div className="rw-chips">{[null, 1, 2, 3].map((n) => <Chip key={String(n)} on={(rules.stopAfterLosses ?? null) === n} onClick={() => set({ stopAfterLosses: n })}>{n ? `${n} loss${n === 1 ? '' : 'es'}` : 'Never'}</Chip>)}</div>
          <label className="rw-switch"><input type="checkbox" checked={!!rules.noReentryAfterLoss} onChange={(e) => set({ noReentryAfterLoss: e.target.checked })} /> <span>No new trade the same day after a loss</span></label>
        </fieldset>

        {days.length > 0 && (
          <fieldset className="rw-row">
            <legend>Skip trades opened on</legend>
            <div className="rw-chips">{days.map((d) => <Chip key={d} on={!!rules.skipWeekdays?.includes(d)} onClick={() => toggleIn('skipWeekdays', d)}>{d.slice(0, 3)}</Chip>)}</div>
          </fieldset>
        )}
        {hours.length > 1 && (
          <fieldset className="rw-row">
            <legend>Skip trades opened at</legend>
            <div className="rw-chips">{hours.map((h) => <Chip key={h.hour} on={!!rules.skipHours?.includes(h.hour)} onClick={() => toggleIn('skipHours', h.hour)} title={`${h.n} trades · ${money(h.pnl)}`}>{hourLabel(h.hour)}</Chip>)}</div>
          </fieldset>
        )}
        {names.length > 0 && (
          <fieldset className="rw-row">
            <legend>Skip these names <em>· the ones that lost money</em></legend>
            <div className="rw-chips">{names.map((n) => <Chip key={n.name} on={!!rules.skipNames?.includes(n.name)} onClick={() => toggleIn('skipNames', n.name)} title={`${n.n} trades · ${money(n.pnl)}`}>{n.name}</Chip>)}</div>
          </fieldset>
        )}
        {sizes.length > 0 && (
          <fieldset className="rw-row">
            <legend>Skip positions bigger than</legend>
            <div className="rw-chips"><Chip on={!rules.maxSize} onClick={() => set({ maxSize: null })}>No cap</Chip>{sizes.map((v) => <Chip key={v} on={rules.maxSize === v} onClick={() => set({ maxSize: v })}>{money(v)}</Chip>)}</div>
          </fieldset>
        )}
      </div>

      <div className="rv-panel s5 rw-effects">
        <div className="rv-ph"><h3>What each rule did</h3><small>on its own; rules overlap</small></div>
        {active ? (
          <ul className="rw-list">{res.byRule.map((b) => (
            <li key={b.rule}><span>{RULE_NAMES[b.rule]}</span><b className={b.delta > 0 ? 'gain' : b.delta < 0 ? 'loss' : ''}>{sign(b.delta)}</b>
              <small>{[b.skipped ? `${b.skipped} not taken` : '', b.stopped ? `${b.stopped} cut at the stop` : ''].filter(Boolean).join(' · ') || 'no trade changed'}</small></li>
          ))}</ul>
        ) : <p className="rv-empty">Turn on a rule to see how much it would have changed.</p>}
        <p className="rv-note">A replay of the trades in this report. Trades a rule removes are simply not taken; a stop closes a loss at exactly that % of what you paid. Real fills, slippage and the trades you might have taken instead are not modelled. Not investment advice.</p>
      </div>
    </div>
  );
}
