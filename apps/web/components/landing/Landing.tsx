/**
 * @file  apps/web/components/landing/Landing.tsx
 * @area  Landing
 * @what  Landing page markup for India and Global sites: hero, steps, sample dashboard, benefits, plans, Instagram, privacy, brokers, blog preview, FAQ (pricing early for mobile, REQ-4).
 */
/**
 * Public landing page. Server-rendered markup; motion comes from /public/landing.js (progressive:
 * the page is complete without it and respects reduced motion). Example figures are illustrative.
 */
import Showcase from './Showcase';
import { LogoMark } from '@/components/brand/Logo';
import Social from './Social';
import Instagram from './Instagram';
import BlogPreview from './BlogPreview';
import type { BlogCard } from '@/lib/blog';
import { siteFor } from '@pnl-lens/shared/site';
import { durationLabel, reportsBullet, validityBullet, REPORTS_KEPT, type Plan } from '@pnl-lens/shared/pricing';

type Region = 'IN' | 'GLOBAL';
type Row = { sym: string; when: string; pnl: number; flag?: string };
const LEDGERS: Record<Region, Row[]> = {
  IN: [
    { sym: 'NIFTY 22500 PE', when: 'Mon 09:41', pnl: 3240 },
    { sym: 'BANKNIFTY 52000 CE', when: 'Mon 11:02', pnl: -11800, flag: 'Held to expiry' },
    { sym: 'RELIANCE', when: 'Tue 10:15', pnl: 1120 },
    { sym: 'NIFTY 22400 CE', when: 'Tue 10:19', pnl: -4300, flag: 'Re-entered 4 minutes after a loss' },
    { sym: 'HDFCBANK FUT', when: 'Wed 13:30', pnl: -18900, flag: 'Leveraged, no stop set' },
    { sym: 'TCS', when: 'Thu 09:58', pnl: 860 },
    { sym: 'NIFTY 22600 PE', when: 'Thu 14:47', pnl: -2100, flag: 'Seventh trade of the day' },
    { sym: 'INFY', when: 'Fri 11:20', pnl: 1480 },
  ],
  GLOBAL: [
    { sym: 'SPY 520 P', when: 'Mon 09:41', pnl: 324 },
    { sym: 'TSLA 250 C', when: 'Mon 11:02', pnl: -1180, flag: 'Held to expiry' },
    { sym: 'AAPL', when: 'Tue 10:15', pnl: 112 },
    { sym: 'QQQ 440 C', when: 'Tue 10:19', pnl: -430, flag: 'Re-entered 4 minutes after a loss' },
    { sym: 'ES futures', when: 'Wed 13:30', pnl: -1890, flag: 'Leveraged, no stop set' },
    { sym: 'MSFT', when: 'Thu 09:58', pnl: 86 },
    { sym: 'NVDA 120 P', when: 'Thu 14:47', pnl: -210, flag: 'Seventh trade of the day' },
    { sym: 'BTC-USD', when: 'Fri 11:20', pnl: 148 },
  ],
};
const money = (r: Region) => (v: number) => (v < 0 ? '−' : '+') + (r === 'IN' ? '₹' + Math.abs(v).toLocaleString('en-IN') : '$' + Math.abs(v).toLocaleString('en-US'));
const REALITY: Record<Region, { line: [string, string, string]; src: string }> = {
  IN: { line: ['In FY26, ', '87.7', ' of individual F&O traders in India ended the year with a loss. Most never get a clear view of why.'], src: 'SEBI, Profitability of Individual Traders in the Equity Derivatives Segment (FY25–FY26), August 2026.' },
  GLOBAL: { line: ['Across the EU, ', '74–89', ' of retail CFD accounts lose money. Most traders never get a clear view of why.'], src: 'ESMA, product intervention measures on CFDs and binary options (national regulators’ analyses).' },
};

const PATTERNS: Record<Region, { t: string; ex: string; next: string }[]> = {
  IN: [
    { t: 'Losses held longer than gains', ex: 'Average gain ₹2,140, average loss ₹4,870', next: 'Set the exit before the entry' },
    { t: 'A few trades drive most losses', ex: '3 positions account for 64% of losses', next: 'Cap the loss on any single trade' },
    { t: 'Options held to expiry', ex: '9 option buys closed below 10% of cost', next: 'Exit at a fixed share of premium' },
    { t: 'Trading straight after a loss', ex: 'Next-trade win rate drops to 31%', next: 'Pause before the next entry' },
    { t: 'Very active trading days', ex: 'Days with 7+ trades: −₹22,400', next: 'Set a daily trade limit' },
    { t: 'Leverage without a stop', ex: 'One position moved 10.4% against you', next: 'Size from a cash stop first' },
  ],
  GLOBAL: [
    { t: 'Losses held longer than gains', ex: 'Average gain $214, average loss $487', next: 'Set the exit before the entry' },
    { t: 'A few trades drive most losses', ex: '3 positions account for 64% of losses', next: 'Cap the loss on any single trade' },
    { t: 'Options held to expiry', ex: '9 option buys closed below 10% of cost', next: 'Exit at a fixed share of premium' },
    { t: 'Trading straight after a loss', ex: 'Next-trade win rate drops to 31%', next: 'Pause before the next entry' },
    { t: 'Very active trading days', ex: 'Days with 7+ trades: −$2,240', next: 'Set a daily trade limit' },
    { t: 'Leverage without a stop', ex: 'One futures position moved 4.2% against you', next: 'Size from a cash stop first' },
  ],
};
const MORE = ['position sizing after losses', 'losing runs', 'recurring setups', 'charges versus gains', 'holding periods', 'broker penalties'];

const USES = [
  ['Option buyers', 'Premiums, expiries and timing that work for you.'],
  ['Option sellers', 'The rare large losses that offset steady gains.'],
  ['Intraday traders', 'Activity, timing and the hours that suit you best.'],
  ['Swing traders', 'Holding periods and how exits are managed.'],
  ['Futures traders', 'How leverage shapes your results.'],
  ['Global markets', 'US stocks and options, futures, crypto and FX.'],
  ['Mentors and coaches', 'A clear, shared view of a student’s record.'],
  ['Annual review', 'A calm look back before the new financial year.'],
];

type Src = { n: string; slug: string; files: string };
type Group = { group: string; note: string; items: Src[] };
const IN_BROKERS: Group = { group: 'Indian brokers', note: 'Equity, F&O, commodity and currency', items: [
  { n: 'Zerodha', slug: 'zerodha', files: 'P&L statement, tradebook' }, { n: 'Dhan', slug: 'dhan', files: 'Tradebook' },
  { n: 'Groww', slug: 'groww', files: 'P&L report' }, { n: 'Fyers', slug: 'fyers', files: 'Tradebook, P&L report' },
  { n: 'Upstox', slug: 'upstox', files: 'Tradebook, P&L report' }, { n: 'Angel One', slug: 'angel-one', files: 'Tradebook, P&L report' },
  { n: 'ICICI Direct', slug: 'icici-direct', files: 'Trade book, P&L' }, { n: 'Kotak Securities', slug: 'kotak-securities', files: 'Trade book, P&L' },
  { n: '5paisa', slug: '5paisa', files: 'Trade book, P&L' }, { n: 'HDFC Securities', slug: 'hdfc-securities', files: 'Trade book, P&L' } ] };
const US_BROKERS: Group = { group: 'US brokers', note: 'Stocks, options and futures', items: [
  { n: 'Interactive Brokers', slug: 'interactive-brokers', files: 'Trade history export' }, { n: 'Charles Schwab', slug: 'charles-schwab', files: 'Transaction history CSV' },
  { n: 'Fidelity', slug: 'fidelity', files: 'Activity CSV' }, { n: 'Robinhood', slug: 'robinhood', files: 'Account activity CSV' },
  { n: 'Webull', slug: 'webull', files: 'Order history CSV' }, { n: 'tastytrade', slug: 'tastytrade', files: 'Transaction history CSV' },
  { n: 'E*TRADE', slug: 'etrade', files: 'Transaction history CSV' }, { n: 'moomoo', slug: 'moomoo', files: 'Order history CSV' },
  { n: 'TradeStation', slug: 'tradestation', files: 'Trade history' }, { n: 'Firstrade', slug: 'firstrade', files: 'Account history CSV' } ] };
const EU_BROKERS: Group = { group: 'European brokers', note: 'Shares, ETFs, options and CFDs', items: [
  { n: 'Trading 212', slug: 'trading-212', files: 'History export' }, { n: 'DEGIRO', slug: 'degiro', files: 'Transactions CSV' },
  { n: 'eToro', slug: 'etoro', files: 'Account statement' }, { n: 'Saxo', slug: 'saxo', files: 'Trades export' },
  { n: 'IG', slug: 'ig', files: 'Trade history' }, { n: 'XTB', slug: 'xtb', files: 'Closed positions' },
  { n: 'Revolut', slug: 'revolut', files: 'Trading statement' }, { n: 'Scalable Capital', slug: 'scalable-capital', files: 'Transactions CSV' },
  { n: 'Freetrade', slug: 'freetrade', files: 'Activity CSV' }, { n: 'Hargreaves Lansdown', slug: 'hargreaves-lansdown', files: 'Transaction history' } ] };
const CRYPTO: Group = { group: 'Crypto exchanges', note: 'Spot and perpetual futures', items: [
  { n: 'Binance', slug: 'binance', files: 'Spot and futures history' }, { n: 'Coinbase', slug: 'coinbase', files: 'Transaction history' },
  { n: 'Bybit', slug: 'bybit', files: 'Trade history' }, { n: 'OKX', slug: 'okx', files: 'Trade history' },
  { n: 'Kraken', slug: 'kraken', files: 'Trades export' }, { n: 'KuCoin', slug: 'kucoin', files: 'Trade history' },
  { n: 'Bitget', slug: 'bitget', files: 'Trade history' }, { n: 'Delta Exchange', slug: 'delta-exchange', files: 'Trade history' },
  { n: 'CoinDCX', slug: 'coindcx', files: 'Trade history' }, { n: 'WazirX', slug: 'wazirx', files: 'Trade report' } ] };
const SOURCES_BY: Record<Region, Group[]> = { IN: [IN_BROKERS, { ...US_BROKERS, group: 'International brokers' }, CRYPTO], GLOBAL: [US_BROKERS, EU_BROKERS, CRYPTO] };

type PlanCard = Plan & { price: { label: string } };
/** Footer legal details. FILL BEFORE LAUNCH (docs/GO_LIVE_CHECKLIST.md): company legal name, registered address, and the
 *  policy pages once the lawyer-approved texts are published (e.g. ['/privacy', 'Privacy policy'], ['/terms', 'Terms of service']). */
const LEGAL: { name: string; address: string; policies: [string, string][] } = { name: '[Company legal name]', address: '[Registered address]', policies: [['/terms', 'Terms'], ['/privacy', 'Privacy']] };
// Plan-specific copy only; durations, report counts and statements come from PLANS (packages/shared/src/pricing.ts).
const PLAN_COPY: Record<string, { tag: string; feat: string[]; cta: string }> = {
  single: { tag: 'A first look', feat: ['Full dashboard and insights'], cta: 'Choose Single' },
  snapshot: { tag: 'A thorough review', feat: ['30-day plan with a check-up on your next report'], cta: 'Choose Snapshot' },
  progress: { tag: 'Build better habits', feat: ['Progress tab and habit tracking', 'Monthly check-up reminders'], cta: 'Choose Progress' },
  discipline: { tag: 'For dedicated traders', feat: ['Full-year progress and trends', 'Lifetime view of all your trading', 'Early access to new features'], cta: 'Choose Discipline' },
};
/** Card bullets: reports (with "over N months" for progress plans), statements per report for one-off plans, the plan's own copy, validity, reports kept. */
const planBullets = (p: Plan) => [reportsBullet(p), ...(p.progress ? [] : [`${p.filesPerReport} broker statements per report`]), ...PLAN_COPY[p.id].feat, validityBullet(p), REPORTS_KEPT].filter((x): x is string => !!x);

const faq = (single: string, snapshot: string, region: Region) => [
  ['Which file should I upload?', 'Your broker’s P&L statement or tradebook, as Excel, CSV, PDF or Word. The tradebook gives the richest view because it includes the time of each trade.'],
  ['Are my files stored?', 'Yes, safely. Your files are encrypted and processed on our secure servers to build your report. The original files are deleted automatically after 30 days, and you can delete your files, reports or whole account anytime.'],
  ['Do I need to connect my broker?', 'No. There is no broker login, password or API key. Download the file from your broker and add it here.'],
  ['Which brokers are supported?', region === 'IN' ? 'Indian brokers such as Zerodha, Dhan, Groww, Fyers, Upstox and Angel One; international brokers such as Interactive Brokers and Schwab; and crypto exchanges such as Binance and Coinbase. Columns are recognised automatically.' : 'US brokers such as Interactive Brokers, Schwab, Fidelity and Robinhood; European brokers such as Trading 212, DEGIRO, eToro and Saxo; and crypto exchanges such as Binance, Coinbase and Kraken. Columns are recognised automatically.'],
  ['Does PnL Lens give tips?', 'No. It never suggests trades. It only looks at trades you have already made and shows the patterns in them.'],
  ['What does it cost?', `A single report is ${single}. Five reports are ${snapshot}. The Progress and Discipline plans include more reports and track how your habits change over time.`],
  ['What does “file” mean in a plan?', 'One file is one P&L statement or tradebook downloaded from your broker (Excel, CSV, PDF or Word). A Single report holds 2, other plans hold 3, so you can combine equity and F&O statements or statements from different brokers.'],
  ['Can I change a file after uploading?', 'Each report is linked to the statements you analyse, so please check your selection first. Removing one does not free its place, and re-opening the same statement is always fine.'],
  ['What is the refund policy?', 'Reports cannot be refunded once they have been generated. If something genuinely goes wrong, write to support@pnllens.com. We take responsibility and respond promptly.'],
];

export default function Landing({ signedIn, plans, region = 'IN', posts = [] }: { signedIn: boolean; plans: PlanCard[]; region?: Region; posts?: BlogCard[] }) {
  const LEDGER = LEDGERS[region], inr = money(region), SOURCES = SOURCES_BY[region], MARQUEE = SOURCES.flatMap((g) => g.items);
  const other = region === 'IN' ? { href: '/?region=global', label: 'Global site' } : { href: '/?region=in', label: 'India site' };
  const start = signedIn ? '/upload' : '/login?next=/upload';
  const site = siteFor(region);
  const priceOf = (id: string) => plans.find((p) => p.id === id)!.price.label;
  const flagged = LEDGER.filter((r) => r.flag);
  const atStake = flagged.reduce((s, r) => s + r.pnl, 0);

  return (
    <div className="lp" data-region={region}>
      <a className="lp-skip" href="#main">Skip to content</a>
      <header className="lp-nav" data-nav>
        <a className="lp-brand" href="/" aria-label="PnL Lens home"><LogoMark size={30} /><span>PnL Lens</span></a>
        <nav className="lp-links" id="lp-menu" aria-label="Page sections">
          <a href="#report">Product</a>
          <a href="#brokers">Brokers</a>
          <a href="#pricing">Pricing</a>
          <a href="/blog">Blog</a>
          <a href="/manual">User manual</a>
          <a href="#faq">FAQ</a>
          <div className="lp-menu-cta">
            {signedIn ? <a className="lp-btn ghost" href="/dashboard">Dashboard</a> : <a className="lp-btn ghost" href="/login">Sign in</a>}
            <a className="lp-btn" href={start}>Get started</a>
          </div>
        </nav>
        <div className="lp-nav-cta">
          <Social site={site} placement="header" />
          {signedIn ? <a className="lp-btn ghost" href="/dashboard">Dashboard</a> : <a className="lp-btn ghost" href="/login">Sign in</a>}
          <a className="lp-btn" href={start}>Get started</a>
        </div>
        <Social site={site} placement="header" className="lp-social-m" />
        <button className="lp-burger" aria-controls="lp-menu" aria-expanded="false" aria-label="Open menu" data-burger><span /><span /></button>
      </header>

      <main id="main">
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <h1 className="lp-h1"><span>Understand what drives your results.</span><span className="lp-h1-2">Trade responsibly.</span></h1>
            <p className="lp-lede">Upload your broker P&amp;L or tradebook. PnL Lens turns it into a clear, private review of your trading habits, with practical steps to improve.</p>
            <div className="lp-hero-cta">
              <a className="lp-btn lg" href={start}>Analyse my trades</a>
              <a className="lp-btn lg ghost" href="#pricing" data-see-plans>See plans · from {priceOf('single')}</a>
            </div>
            <p className="lp-trustline">Private and encrypted <span>/</span> Any broker, any market <span>/</span> No tips or signals <span>/</span> <a href="#report">See a sample report</a></p>
          </div>
          <figure className="lp-scan" aria-label="Example: PnL Lens reviewing a week of trades">
            <div className="lp-scan-head"><span>A week of trades</span><span className="muted">Example</span></div>
            <ol className="lp-ledger" data-ledger>
              {LEDGER.map((r) => (
                <li key={r.sym + r.when} className={r.flag ? 'is-bad' : ''} data-row>
                  <span className="sym">{r.sym}</span><span className="when">{r.when}</span>
                  <span className={`pnl ${r.pnl < 0 ? 'neg' : 'pos'}`}>{inr(r.pnl)}</span>
                  {r.flag && <span className="tag">{r.flag}</span>}
                </li>
              ))}
            </ol>
            <div className="lp-lens" data-lens aria-hidden="true" />
            <figcaption className="lp-scan-foot" data-scan-foot><b>{flagged.length}</b> patterns flagged, <b className="neg">{inr(atStake)}</b> at stake</figcaption>
          </figure>
        </section>

        <section className="lp-section lp-compact" id="how">
          <header className="lp-head"><h2 className="lp-h2">Three steps. Two minutes.</h2><p className="lp-sub">No account linking, no setup, no waiting.</p></header>
          <ol className="lp-grid g3 lp-steps compact">
            <li className="lp-card" data-reveal><h3>Download</h3><p>Export your P&amp;L statement or tradebook from your broker.</p></li>
            <li className="lp-card" data-reveal><h3>Add statements</h3><p>One file per broker statement. Encrypted on upload.</p></li>
            <li className="lp-card" data-reveal><h3>Review</h3><p>Your dashboard, insights and next steps, ready instantly.</p></li>
          </ol>
        </section>

        <section className="lp-section" id="report">
          <header className="lp-head"><h2 className="lp-h2">Five views of your trading</h2><p className="lp-sub">Click through the sample: overview, progress, insights, clusters and positions.</p></header>
          <Showcase region={region} />
        </section>

        <section className="lp-section" id="patterns">
          <header className="lp-head"><h2 className="lp-h2">Patterns worth a closer look</h2><p className="lp-sub">Measured on your own trades, each with its impact and a practical next step.</p></header>
          <div className="lp-grid g4 lp-benefits">
            {PATTERNS[region].slice(0, 4).map((p) => (
              <article className="lp-card" key={p.t} data-reveal>
                <h3>{p.t}</h3>
                <p className="lp-card-ex">{p.ex}</p>
                <p className="lp-card-next"><span>Next step</span>{p.next}</p>
              </article>
            ))}
          </div>
          <p className="lp-foot-note">Also reviewed: {[...PATTERNS[region].slice(4).map((p) => p.t.toLowerCase()), ...MORE].join(', ')}.</p>
        </section>

        <section className="lp-section" id="pricing">
          <header className="lp-head"><h2 className="lp-h2">Simple, transparent plans</h2><p className="lp-sub">Start with a single report, or follow your progress over months.</p></header>
          <div className="lp-plans">
            {plans.map((p) => {
              const c = PLAN_COPY[p.id];
              return (
                <div key={p.id} className={`lp-plan ${p.id === 'progress' ? 'hot' : ''}`} data-plan={p.id} data-reveal>
                  {p.id === 'progress' && <span className="lp-plan-flag">Most popular</span>}
                  <h3>{p.name}</h3>
                  <p className="lp-plan-tag">{c.tag}</p>
                  <p className="lp-plan-price"><b>{p.price.label}</b><span>{durationLabel(p)}</span></p>
                  <ul>{planBullets(p).map((f) => <li key={f}>{f}</li>)}</ul>
                  <a className={`lp-btn block ${p.id === 'progress' ? '' : 'ghost'}`} href={`${start}${start.includes('?') ? '&' : '?'}plan=${p.id}`}>{c.cta}</a>
                </div>
              );
            })}
          </div>
          <div className="lp-notes" role="note">
            <div><b>What counts as a file?</b> One P&amp;L statement or tradebook downloaded from your broker. Each report holds the number shown on your plan, for example equity and F&amp;O statements, or statements from two brokers. Once analysed, a statement keeps its place even if removed; re-opening the same one is always fine.</div>
            <div><b>Refunds.</b> Reports cannot be refunded once generated. If something genuinely goes wrong, write to <a href="mailto:support@pnllens.com">support@pnllens.com</a>. We take responsibility and respond promptly.</div>
          </div>
        </section>

        <Instagram site={site} />

        <section className="lp-section" id="privacy">
          <header className="lp-head"><h2 className="lp-h2">Private and principled</h2><p className="lp-sub">Your data stays yours, and the review stays objective.</p></header>
          <div className="lp-grid g3">
            <article className="lp-card" data-reveal><h3>Private by design</h3><p>Your files are encrypted, processed on our secure servers, and you can delete them anytime.</p></article>
            <article className="lp-card" data-reveal><h3>No broker access</h3><p>No passwords, no API keys, no connection to your account.</p></article>
            <article className="lp-card" data-reveal><h3>No tips, ever</h3><p>We describe what your trades show. Decisions remain yours.</p></article>
          </div>
        </section>

        <section className="lp-section" id="brokers">
          <header className="lp-head"><h2 className="lp-h2">Works with the files you already have</h2><p className="lp-sub">{region === 'IN' ? 'Statements and tradebooks from 30 brokers and exchanges.' : 'Statements and trade histories from 30 brokers and exchanges.'}</p></header>
          <div className="lp-marquee" aria-hidden="true"><div className="lp-marquee-track">
            {[...MARQUEE, ...MARQUEE].map((b, i) => <span key={i}>{b.n}</span>)}
          </div></div>
          <div className="lp-grid g3">
            {SOURCES.map((g) => (
              <div className="lp-src-col" key={g.group} data-reveal>
                <h3>{g.group}</h3><p className="lp-src-note">{g.note}</p>
                <ul>{g.items.map((it) => <li key={it.n}><b>{it.n}</b><span>{it.files}</span></li>)}</ul>
              </div>
            ))}
          </div>
          <p className="lp-foot-note">Broker and exchange names belong to their owners. PnL Lens is not affiliated with any of them.</p>
        </section>

        <section className="lp-reality" data-reveal>
          <p className="lp-reality-line">{REALITY[region].line[0]}<strong>{REALITY[region].line[1]}</strong><strong>%</strong>{REALITY[region].line[2]}</p>
          <p className="lp-src">{REALITY[region].src}</p>
        </section>

        <section className="lp-section" id="who">
          <header className="lp-head"><h2 className="lp-h2">Built for every kind of trader</h2><p className="lp-sub">Whatever you trade and however often, the review adapts to your data.</p></header>
          <div className="lp-grid g4">
            {USES.map(([k, v]) => <article className="lp-card sm" key={k} data-reveal><h3>{k}</h3><p>{v}</p></article>)}
          </div>
        </section>

        <BlogPreview posts={posts} />

        <section className="lp-section" id="faq">
          <header className="lp-head"><h2 className="lp-h2">Questions, answered</h2><p className="lp-sub">Anything else? Write to support@pnllens.com.</p></header>
          <div className="lp-faq">{faq(priceOf('single'), priceOf('snapshot'), region).map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
        </section>

        <section className="lp-final">
          <h2 className="lp-h2">Clarity starts with your own trades.</h2>
          <a className="lp-btn lg" href={start}>Analyse my trades</a>
        </section>
      </main>
      <a className="lp-pill" href="#pricing" data-pill hidden>See plans</a>

      <footer className="lp-foot">
        <div className="lp-brand"><LogoMark size={26} /><span>PnL Lens</span></div>
        <p>PnL Lens is a trade-analysis tool, not investment advice, and is not registered as an investment adviser or research analyst. Trading involves risk of loss. Figures on this page are illustrative. Reports cannot be refunded once generated; for genuine issues write to support@pnllens.com.</p>
        <p className="lp-legal">{LEGAL.name} · {LEGAL.address}</p>
        <nav aria-label="Footer"><a href={other.href}>{other.label}</a>{LEGAL.policies.map(([href, label]) => <a key={href} href={href}>{label}</a>)}<a href="mailto:support@pnllens.com">support@pnllens.com</a><a href="#pricing">Pricing</a><a href="/blog">Blog</a><a href="/manual">User manual</a><a href="#faq">FAQ</a></nav>
        <Social site={site} placement="footer" className="lp-foot-social" />
      </footer>
    </div>
  );
}
