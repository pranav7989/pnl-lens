/**
 * @file  apps/web/components/landing/Showcase.tsx
 * @area  Landing
 * @what  Animated 5-tab sample dashboard on the landing page (illustrative numbers, ₹ or $ by region).
 */
/** Sample dashboard with five working tabs (illustrative numbers). public/landing.js switches tabs,
 * auto-advances until the visitor clicks, and re-plays each panel's animation via the `.in` class. */
const TABS = ['Overview', 'Progress', 'Insights', 'Clusters', 'Positions'];
const DIMS = [['Risk : reward', 78, 61], ['Loss control', 64, 42], ['Consistency', 71, 66], ['Emotions', 82, 55], ['Selection', 69, 58], ['Costs', 74, 70]] as const;
const CX = 150, CY = 128, R0 = 92;
const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / DIMS.length, r = (R0 * v) / 100; return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; };
const poly = (idx: 1 | 2) => DIMS.map((d, i) => pt(i, d[idx]).map((x) => x.toFixed(1)).join(',')).join(' ');
const CURVE = [0, 6, 4, 11, 9, 16, 13, 12, 19, 24, 21, 28, 33, 30, 38, 44, 41, 49, 55, 60];
const curvePath = (W: number, H: number) => { const mx = Math.max(...CURVE); return CURVE.map((v, i) => `${i ? 'L' : 'M'}${((i * W) / (CURVE.length - 1)).toFixed(1)},${(H - 8 - (v / mx) * (H - 20)).toFixed(1)}`).join(' '); };
const MONTHS = [['Apr', -8.2], ['May', -3.1], ['Jun', 4.6], ['Jul', -2.4], ['Aug', 9.8], ['Sep', 6.1], ['Oct', 12.4], ['Nov', -1.9], ['Dec', 14.2], ['Jan', 18.7], ['Feb', 11.3], ['Mar', 21.6]] as const;
type Region = 'IN' | 'GLOBAL';
const POS: Record<Region, (readonly [string, string, number, number])[]> = {
  IN: [['NIFTY 22500 PE', 'Index options', 54.0, 3240], ['RELIANCE', 'Equity', 4.1, 1120], ['INFY', 'Equity', 3.2, 1480], ['NIFTY 22400 CE', 'Index options', -38.1, -4300], ['BANKNIFTY 52000 CE', 'Index options', -96.8, -11800], ['HDFCBANK FUT', 'Stock futures', -10.4, -18900]],
  GLOBAL: [['SPY 520 P', 'Index options', 54.0, 324], ['AAPL', 'Stocks', 4.1, 112], ['BTC-USD', 'Crypto', 3.2, 148], ['QQQ 440 C', 'Index options', -38.1, -430], ['TSLA 250 C', 'Stock options', -96.8, -1180], ['ES futures', 'Index futures', -4.2, -1890]],
};
const TXT: Record<Region, { net: string; costs: [string, number][]; leaks: [string, number, string][]; rule: string; months: string; inst: [string, number, number][] }> = {
  IN: { net: '+₹1,84,200', costs: [['STT', 46], ['Brokerage', 24], ['Exchange', 18], ['GST and stamp', 12]], leaks: [['Options held to expiry', 100, '₹42,100'], ['Trading after losses', 44, '₹18,300'], ['Very active days', 22, '₹9,400']], rule: 'Daily loss limit ₹4,200', months: 'k', inst: [['Index options', 62, 1], ['Stock options', 28, -1], ['Equity', 44, 1], ['Futures', 36, -1]] },
  GLOBAL: { net: '+$18,420', costs: [['Commissions', 41], ['Exchange fees', 27], ['Funding', 20], ['Regulatory', 12]], leaks: [['Options held to expiry', 100, '$4,210'], ['Trading after losses', 44, '$1,830'], ['Very active days', 22, '$940']], rule: 'Daily loss limit $420', months: 'k', inst: [['Index options', 62, 1], ['Stock options', 28, -1], ['Stocks', 44, 1], ['Futures', 36, -1]] },
};

function Ring({ v }: { v: number }) {
  return (
    <div className="dx-ring">
      <svg viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="56" className="trk" /><circle cx="70" cy="70" r="56" className="val" style={{ ['--off' as string]: `${352 * (1 - v / 100)}` }} /></svg>
      <div><b>{v}</b><span>discipline score</span></div>
    </div>
  );
}

export default function Showcase({ region = 'IN' }: { region?: Region }) {
  const T = TXT[region], cur = region === 'IN' ? '₹' : '$';
  const ri = (v: number) => (v < 0 ? '−' : '+') + cur + Math.abs(v).toLocaleString(region === 'IN' ? 'en-IN' : 'en-US');
  return (
    <div className="dx" data-dx aria-label="Sample PnL Lens dashboard (illustrative)">
      <div className="dx-bar">
        <span className="dx-dots" aria-hidden="true"><i /><i /><i /></span>
        <div className="dx-tabs" role="tablist" aria-label="Sample report tabs">
          {TABS.map((t, i) => <button key={t} type="button" role="tab" aria-selected={i === 0} data-dx-tab={i}>{t}</button>)}
        </div>
        <span className="dx-tag">Sample report</span>
      </div>

      {/* Overview */}
      <div className="dx-panel dx-ov in" data-dx-panel={0} role="tabpanel">
        <div className="dx-k"><span>Net P&amp;L</span><b className="pos">{T.net}</b><svg viewBox="0 0 120 30" className="dx-mini"><path d="M0,26 L15,24 L30,25 L45,18 L60,20 L75,12 L90,14 L105,7 L120,4" /></svg></div>
        <div className="dx-k"><span>Win rate</span><b>58%</b><small className="pos">▲ 6 pts</small></div>
        <div className="dx-k"><span>Risk : reward</span><b>1.9</b><small className="pos">▲ from 1.1</small></div>
        <div className="dx-k"><span>Profit factor</span><b>1.6</b><small className="pos">▲ from 0.9</small></div>
        <div className="dx-c dx-curve"><svg viewBox="0 0 600 150" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="dxg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#3DD68C" stopOpacity=".35" /><stop offset="1" stopColor="#3DD68C" stopOpacity="0" /></linearGradient></defs><path className="area" d={`${curvePath(600, 150)} L600,150 L0,150 Z`} /><path className="line" d={curvePath(600, 150)} /></svg><em>Equity curve</em></div>
        <div className="dx-c dx-costs">
          <em>Where costs went</em>
          {T.costs.map(([n, w]) => <p key={n as string}><span>{n}</span><i style={{ ['--w' as string]: `${w}%` }} /><b>{w}%</b></p>)}
        </div>
      </div>

      {/* Progress */}
      <div className="dx-panel dx-pr" data-dx-panel={1} role="tabpanel" hidden>
        <div className="dx-c dx-score"><Ring v={74} /><span className="dx-up">▲ 9 this month</span></div>
        <div className="dx-c dx-radar"><svg viewBox="-36 0 372 256" aria-hidden="true">
          {[25, 50, 75, 100].map((lv) => <polygon key={lv} className="g" points={DIMS.map((_, i) => pt(i, lv).map((x) => x.toFixed(1)).join(',')).join(' ')} />)}
          {DIMS.map((d, i) => { const [x, y] = pt(i, 100); const [lx, ly] = pt(i, 118); return <g key={d[0]}><line className="a" x1={CX} y1={CY} x2={x.toFixed(1)} y2={y.toFixed(1)} /><text x={lx.toFixed(1)} y={ly.toFixed(1)} textAnchor={lx < CX - 5 ? 'end' : lx > CX + 5 ? 'start' : 'middle'} dominantBaseline="middle">{d[0]}</text></g>; })}
          <polygon className="before" points={poly(2)} /><polygon className="now" points={poly(1)} />
        </svg></div>
        <div className="dx-c dx-track">
          <em>Habit tracker</em>
          {[['Trading after losses', 'fixed', 'Resolved'], ['Deep losses', 'improving', 'Improving'], ['Very active days', 'fixed', 'Resolved'], ['Charges versus gains', 'same', 'Steady']].map(([n, k, l]) => <p key={n}><span>{n}</span><b className={k}>{l}</b></p>)}
        </div>
      </div>

      {/* Insights */}
      <div className="dx-panel dx-in" data-dx-panel={2} role="tabpanel" hidden>
        <div className="dx-c dx-leaks">
          <em>Biggest opportunities</em>
          {T.leaks.map(([n, w, v]) => <p key={n as string}><span>{n}</span><i style={{ ['--w' as string]: `${w}%` }} /><b>{v}</b></p>)}
        </div>
        <div className="dx-c dx-trait"><span className="lv clear">Clear</span><h4>Holding losing trades longer</h4><p>Losses stay open 3.1 days; gains 1.2 days.</p></div>
        <div className="dx-c dx-trait"><span className="lv emerging">Emerging</span><h4>Larger size after a loss</h4><p>Next position is 42% bigger after a loss.</p></div>
        <div className="dx-c dx-rules"><em>Suggested rules</em>{['Exit options at −30% of premium', 'Pause after two losses in a row', T.rule].map((r) => <span key={r}>{r}</span>)}</div>
      </div>

      {/* Clusters */}
      <div className="dx-panel dx-cl" data-dx-panel={3} role="tabpanel" hidden>
        <div className="dx-c dx-months"><em>By month</em><div>{MONTHS.map(([m, v], i) => <span key={m} className={v >= 0 ? 'up' : 'down'} style={{ ['--d' as string]: `${i * 40}ms` }}><small>{m}</small><b>{v > 0 ? '+' : '−'}{cur}{Math.abs(region === 'IN' ? v : v / 10).toFixed(1)}k</b></span>)}</div></div>
        <div className="dx-c dx-bars"><em>By instrument</em>{T.inst.map(([n, w, sgn]) => <p key={n as string}><span>{n}</span><i className={(sgn as number) > 0 ? 'pos' : 'neg'} style={{ ['--w' as string]: `${(w as number) / 2}%` }} /></p>)}</div>
      </div>

      {/* Positions */}
      <div className="dx-panel dx-po" data-dx-panel={4} role="tabpanel" hidden>
        <div className="dx-c dx-table">
          <p className="h"><span>Symbol</span><span>Group</span><span>Return</span><span>P&amp;L</span></p>
          {POS[region].map(([s, g, r, v]) => <p key={s}><span><b>{s}</b></span><span>{g}</span><span className={r >= 0 ? 'pos' : 'neg'}>{r > 0 ? '+' : ''}{r}%</span><span className={v >= 0 ? 'pos' : 'neg'}><b>{ri(v)}</b><i style={{ ['--w' as string]: `${Math.min(100, Math.abs(v) / (region === 'IN' ? 189 : 18.9))}%` }} /></span></p>)}
        </div>
      </div>
    </div>
  );
}
