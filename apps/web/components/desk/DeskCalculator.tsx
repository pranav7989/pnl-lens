/**
 * @file  apps/web/components/desk/DeskCalculator.tsx
 * @area  Pages
 * @what  Desk header (date · session · IST time) and the calculator card: segment tabs, exchange, typed prices, the charges table, breakeven and net (charges only and with slippage), position size from the risk per trade.
 */
'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { calcCharges, positionSize, F_AND_O, type DeskSegment, type ChargeRates } from '@pnl-lens/shared/desk/charges';
import { istParts, sessionState, SESSION_LABEL, type CalendarDay } from '@pnl-lens/shared/desk/session';
import { api } from '@/lib/api-browser';

type Rate = ChargeRates & { segment: DeskSegment; exchange: string; effective_from: string; source_note: string | null };
type Plan = { name: string; segment: DeskSegment; flat_per_order: number | null; pct: number | null; cap_per_order: number | null; is_default: boolean };
export interface DeskConfig {
  date: string; label: string; time: string;
  session: { state: string; label: string; note: string | null } | null;
  calendar: (CalendarDay & { segment: string; exchange: string })[];
  rates: Rate[]; brokerage: Plan[];
}
export interface DeskSettings {
  risk_per_trade: number | null; max_daily_loss: number | null; max_trades_day: number | null; brokerage_plan: string | null;
  default_exchange: string | null; avg_slippage_override: number | null; adherence_target: number | null;
}

const TABS: [DeskSegment, string][] = [
  ['eq_intraday', 'Intraday'], ['eq_delivery', 'Delivery'], ['futures', 'Futures'], ['options', 'Options'],
  ['currency_fut', 'Currency fut'], ['currency_opt', 'Currency opt'], ['commodity_fut', 'Commodity fut'], ['commodity_opt', 'Commodity opt'],
];
const EX_ORDER = ['NSE', 'BSE', 'MCX'];
const CAL_SEGMENT = (s: DeskSegment) => (s.startsWith('currency') ? 'currency' : s.startsWith('commodity') ? 'commodity' : 'equity');
const inr = (x: number) => `${x < 0 ? '−' : ''}₹${Math.abs(x).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pts = (x: number) => x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => { const v = Number(s.replace(/,/g, '')); return s.trim() !== '' && Number.isFinite(v) ? v : null; };
const str = (v: number | null | undefined) => (v == null ? '' : String(v));

function Field({ label, value, onChange, hint, id }: { label: string; value: string; onChange: (v: string) => void; hint?: string; id: string }) {
  return (
    <label className="desk-field" htmlFor={id}>
      <span className="field-label">{label}{hint && <small> {hint}</small>}</span>
      <input id={id} className="field" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function DeskCalculator({ config, settings, signedIn }: { config: DeskConfig; settings: DeskSettings | null; signedIn: boolean }) {
  const [segment, setSegment] = useState<DeskSegment>('options');
  const exchanges = useMemo(() => config.rates.filter((r) => r.segment === segment).map((r) => r.exchange).sort((a, b) => EX_ORDER.indexOf(a) - EX_ORDER.indexOf(b)), [config.rates, segment]);
  const [exchange, setExchange] = useState(settings?.default_exchange || 'NSE');
  const ex = exchanges.includes(exchange) ? exchange : exchanges[0];
  const [buy, setBuy] = useState('120');
  const [sell, setSell] = useState('170');
  const [qty, setQty] = useState('65');
  const [lot, setLot] = useState('65');
  const [slip, setSlip] = useState(str(settings?.avg_slippage_override));
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [sl, setSl] = useState('90');
  const [risk, setRisk] = useState(str(settings?.risk_per_trade ?? 3000));
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // the header clock: IST, the session of the segment shown, from the calendar row of the day
  const [now, setNow] = useState<{ minutes: number; day: string } | null>(null);
  useEffect(() => {
    const tick = () => { const p = istParts(new Date()); setNow({ minutes: p.minutes, day: p.day }); };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  const calRow = config.calendar.find((c) => c.segment === CAL_SEGMENT(segment) && (c.segment !== 'commodity' ? c.exchange === 'NSE' : c.exchange === 'MCX')) ?? null;
  const minutes = now && now.day === config.date ? now.minutes : Number(config.time.slice(0, 2)) * 60 + Number(config.time.slice(3, 5));
  const state = sessionState(calRow, minutes);
  const clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

  const rate = config.rates.find((r) => r.segment === segment && r.exchange === ex) ?? null;
  const plan = config.brokerage.find((p) => p.segment === segment && (settings?.brokerage_plan ? p.name === settings.brokerage_plan : p.is_default))
    ?? config.brokerage.find((p) => p.segment === segment && p.is_default) ?? null;
  const fo = F_AND_O.includes(segment);
  const b = num(buy), s = num(sell), q = num(qty), slipV = num(slip), slV = num(sl), riskV = num(risk), lotV = num(lot);
  const ready = rate && plan && b != null && s != null && q != null && q > 0;
  const c = ready ? calcCharges({ segment, buy: b, sell: s, qty: q, rates: rate, brokerage: plan, slippagePerUnit: slipV }) : null;
  const entry = side === 'buy' ? b : s;
  const size = rate && plan && entry && slV && riskV
    ? positionSize({ segment, side, entry, stopLoss: slV, riskBudget: riskV, lotSize: fo ? lotV : null, rates: rate, brokerage: plan, slippagePerUnit: slipV })
    : null;

  async function saveDefaults() {
    setSaved('saving');
    try {
      await api('/desk/settings', { method: 'PUT', body: {
        risk_per_trade: riskV && riskV > 0 ? riskV : null, max_daily_loss: settings?.max_daily_loss ?? null, max_trades_day: settings?.max_trades_day ?? null,
        brokerage_plan: settings?.brokerage_plan ?? null, default_exchange: ex === 'MCX' ? settings?.default_exchange ?? 'NSE' : ex,
        avg_slippage_override: slipV != null && slipV >= 0 ? slipV : null, adherence_target: settings?.adherence_target ?? 80,
      } });
      setSaved('saved');
    } catch { setSaved('error'); }
  }

  const rows: [string, number][] = c ? [
    ['Turnover', c.turnover], ['Brokerage', c.brokerage], [segment.startsWith('commodity') ? 'CTT' : 'STT', c.stt], ['Exchange txn', c.exchTxn],
    ['GST', c.gst], ['SEBI fee', c.sebi], ['Stamp duty', c.stamp], ...(c.ipft ? [['IPFT', c.ipft] as [string, number]] : []),
  ] : [];
  const tone = (x: number) => (x > 0 ? 'gain' : x < 0 ? 'loss' : '');

  return (
    <div className="desk" data-desk>
      <div className="desk-head">
        <div>
          <h1 className="page-title">Desk</h1>
          <p className="muted desk-line" data-desk-session>
            {config.label} · <span className={`desk-state ${state}`}>{SESSION_LABEL[state]}</span>{calRow?.is_holiday && calRow.note ? ` (${calRow.note})` : ''} · {clock} IST
          </p>
        </div>
      </div>

      <section className="panel desk-calc" aria-labelledby="desk-calc-h" data-desk-calc>
        <div className="rv-ph"><h3 id="desk-calc-h">Charges, breakeven and position size</h3>
          {rate && <small>Rates from {new Date(`${rate.effective_from}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {plan?.name}</small>}</div>

        <div className="tabs desk-tabs" role="tablist" aria-label="Segment">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={segment === id} onClick={() => setSegment(id)} data-segment={id}>{label}</button>
          ))}
        </div>

        <div className="desk-ex" role="radiogroup" aria-label="Exchange">
          {exchanges.map((e) => (
            <button key={e} type="button" role="radio" aria-checked={ex === e} className={`desk-pill${ex === e ? ' on' : ''}`} onClick={() => setExchange(e)}>{e}</button>
          ))}
        </div>

        <div className="desk-body">
          <div className="desk-inputs">
            <div className="desk-row">
              <Field id="d-buy" label="Buy price" value={buy} onChange={setBuy} />
              <Field id="d-sell" label="Sell price" value={sell} onChange={setSell} />
              <Field id="d-qty" label="Quantity" value={qty} onChange={setQty} />
            </div>
            <div className="desk-row">
              {fo && <Field id="d-lot" label="Lot size" value={lot} onChange={setLot} />}
              <Field id="d-slip" label="Your slippage" hint="per unit, optional" value={slip} onChange={setSlip} />
            </div>
            <div className="desk-sub">Position size</div>
            <div className="desk-ex" role="radiogroup" aria-label="Trade side">
              <button type="button" role="radio" aria-checked={side === 'buy'} className={`desk-pill${side === 'buy' ? ' on' : ''}`} onClick={() => setSide('buy')}>Buy first (entry = buy price)</button>
              <button type="button" role="radio" aria-checked={side === 'sell'} className={`desk-pill${side === 'sell' ? ' on' : ''}`} onClick={() => setSide('sell')}>Sell first (entry = sell price)</button>
            </div>
            <div className="desk-row">
              <Field id="d-sl" label="Stop-loss" value={sl} onChange={setSl} />
              <Field id="d-risk" label="Risk per trade" hint="₹" value={risk} onChange={setRisk} />
            </div>
            {signedIn ? (
              <p className="desk-save">
                <button type="button" className="btn ghost" onClick={saveDefaults} disabled={saved === 'saving'}>Save risk and slippage as my defaults</button>
                <span className="muted small" role="status">{saved === 'saved' ? 'Saved' : saved === 'error' ? 'Could not save. Please try again.' : ''}</span>
              </p>
            ) : (
              <p className="muted small desk-save"><Link className="link" href="/login?next=/desk">Sign in</Link> to keep your risk per trade and slippage.</p>
            )}
          </div>

          <div className="desk-out">
            <table className="desk-table" data-desk-charges>
              <tbody>
                {rows.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{inr(v)}</td></tr>)}
                {c && <tr className="desk-total"><th scope="row">Total charges</th><td>{inr(c.total)}</td></tr>}
                {!c && <tr><td colSpan={2} className="muted">Type a buy price, a sell price and a quantity.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="desk-tiles">
          <div className="desk-tile" data-desk-breakeven>
            <span className="desk-k">Points to breakeven</span>
            <b>{c ? pts(c.pointsToBreakeven) : '—'}</b>
            <span className="desk-s">charges only</span>
            {c?.withSlippage && <span className="desk-s">With your slippage: <b>{pts(c.withSlippage.pointsToBreakeven)}</b></span>}
          </div>
          <div className="desk-tile" data-desk-net>
            <span className="desk-k">Net P&amp;L</span>
            <b className={c ? tone(c.netPnl) : ''}>{c ? inr(c.netPnl) : '—'}</b>
            <span className="desk-s">after {c ? inr(c.total) : '—'} charges</span>
            {c?.withSlippage && <span className="desk-s">With your slippage ({inr(c.withSlippage.slippage)}): <b className={tone(c.withSlippage.netPnl)}>{inr(c.withSlippage.netPnl)}</b></span>}
          </div>
          <div className="desk-tile" data-desk-size>
            <span className="desk-k">Position size</span>
            <b>{size ? size.maxQty.toLocaleString('en-IN') : '—'}</b>
            {size && size.lots != null && size.maxQty > 0 && <span className="desk-s">{size.lots} lot{size.lots === 1 ? '' : 's'}</span>}
            {size && size.maxQty > 0 && <span className="desk-s">Loss at stop-loss ≈ {inr(size.lossAtStop)} with charges</span>}
            {size?.message && <span className="desk-s">{size.message}</span>}
            {!size && <span className="desk-s">Type a stop-loss and a risk per trade</span>}
          </div>
        </div>
      </section>

      <p className="desk-foot" data-desk-disclaimer>Headlines and scheduled events only. Prices are entered by you. Not investment advice.</p>
    </div>
  );
}
