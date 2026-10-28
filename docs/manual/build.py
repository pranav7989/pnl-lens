# @file  docs/manual/build.py
# @area  Docs
# @what  Builds the user manual (India and Global editions) as HTML fragments for the website's /manual page: docs/manual/manual-india.html and manual-global.html. Run: python3 docs/manual/build.py
#
# One source for both editions; India adds rupee prices, Indian brokers and Market context. The fragments use the
# site's own tokens and are styled by apps/web/app/manual.css (classes prefixed mn-). Re-run after changing features.
import html, pathlib

OUT = pathlib.Path(__file__).parent

R = {
  'IN': dict(
    title='PnL Lens User Manual', site='India', c='₹', site_note='This manual is for the India site (prices in rupees).',
    prices=[('Single', '₹99', '1 report', '2 statements per report', 'use within 7 days'),
            ('Snapshot', '₹499', '5 reports', '3 statements per report', 'use within 3 months'),
            ('Progress', '₹1,499', '25 reports over 6 months', '3 statements per report', '6 months'),
            ('Discipline', '₹3,999', '90 reports over 12 months', '3 statements per report', '12 months')],
    brokers=[('Zerodha', 'P&L statement or tradebook (Console → Reports)'), ('Dhan', 'Tradebook'), ('Groww', 'P&L report'),
             ('Fyers', 'Tradebook or P&L report'), ('Upstox', 'Tradebook or P&L report'), ('Angel One', 'Tradebook or P&L report'),
             ('ICICI Direct', 'Trade book or P&L'), ('Kotak Securities', 'Trade book or P&L'), ('5paisa', 'Trade book or P&L'),
             ('HDFC Securities', 'Trade book or P&L'), ('Interactive Brokers, Schwab and other international brokers', 'Trade history export'),
             ('Crypto: Binance, Coinbase, Bybit, OKX, Delta Exchange, CoinDCX, WazirX and others', 'Trade history')],
    markets='equity (delivery and intraday), F&amp;O (index and stock options and futures), commodity and currency',
    ex_trade='a BANKNIFTY option', ex_name='BANKNIFTY options', ex_money='₹45,862', ex_loss='−₹9,854', ex_cap='₹5,00,000', ex_capshort='₹5.00L',
    ex_ul='NIFTY, BANKNIFTY, RELIANCE', fo=True,
    tz_note='India time (IST)',
  ),
  'GLOBAL': dict(
    title='PnL Lens Global User Manual', site='Global', c='$', site_note='This manual is for the global site (prices in US dollars). Reports use the currency of your statement (for example USD or EUR).',
    prices=[('Single', '$9', '1 report', '2 statements per report', 'use within 7 days'),
            ('Snapshot', '$19', '5 reports', '3 statements per report', 'use within 3 months'),
            ('Progress', '$49', '25 reports over 6 months', '3 statements per report', '6 months'),
            ('Discipline', '$129', '90 reports over 12 months', '3 statements per report', '12 months')],
    brokers=[('Interactive Brokers', 'Trade history export'), ('Charles Schwab', 'Transaction history CSV'), ('Fidelity', 'Activity CSV'),
             ('Robinhood', 'Account activity CSV'), ('Webull, moomoo', 'Order history CSV'), ('tastytrade, E*TRADE, Firstrade', 'Transaction or account history CSV'),
             ('TradeStation', 'Trade history'), ('Trading 212, DEGIRO, Scalable Capital, Freetrade', 'History, transactions or activity CSV'),
             ('eToro, Saxo, IG, XTB, Revolut, Hargreaves Lansdown', 'Account statement, trades export or closed positions'),
             ('Crypto: Binance, Coinbase, Bybit, OKX, Kraken, KuCoin, Bitget and others', 'Trade history')],
    markets='stocks and ETFs, options, futures, CFDs and crypto (spot and perpetual futures)',
    ex_trade='an AAPL option', ex_name='TSLA options', ex_money='$4,586', ex_loss='−$985', ex_cap='$50,000', ex_capshort='$50.0K',
    ex_ul='SPY, QQQ, AAPL', fo=False,
    tz_note='India time (IST), where PnL Lens runs',
  ),
}

def esc(s): return html.escape(s, quote=True)

def build(key):
  r = R[key]; c = r['c']; india = key == 'IN'
  sec = []   # (id, title, html)
  def S(id_, title, body): sec.append((id_, title, body))

  S('welcome', 'Welcome to PnL Lens', f'''
<p class="mn-lead">PnL Lens reads the statement you download from your broker and shows you, in plain words, what is making and losing you money: your habits, your timing, your costs and your discipline.</p>
<p>It works on {r['markets']}. You never connect your broker, share a password or type anything in: you download a file, add it, and PnL Lens recognises the columns by itself.</p>
<div class="mn-note"><b>What PnL Lens does not do.</b> It never tells you what to buy or sell and gives no tips or price targets. Everything it shows is about trades you have already made. Nothing in it is investment advice.</div>
<h3>How it works</h3>
<ol class="mn-steps"><li><b>Download</b> your P&amp;L statement or tradebook from your broker (Excel, CSV, PDF or Word).</li>
<li><b>Upload</b> it on PnL Lens and tick the consent box.</li>
<li><b>Read your report</b>: eight tabs from a quick overview to a deep dive, a 30-day plan you can download, and tools to replay, journal and track your trading.</li></ol>
<p class="mn-small">{r['site_note']}</p>''')

  S('account', 'Your account', f'''
<p>Open <b>pnllens.com</b> and choose <b>Sign in</b>. There are two ways in:</p>
<ul><li><b>Continue with Google</b>: one click with your Google account (shown when Google sign-in is available).</li>
<li><b>Continue with email</b>: the first time, we email you a 6-digit code to prove the address is yours, then you <b>set a password</b> (required). After that you sign in with your email and password; no code needed. Forgot it? Choose “Forgot password”, we email a code, and you set a new one.</li></ul>
<p>One email address is one account. You can change your password later in <b>Dashboard → Your data → Change password</b>, and a Google user can add a password there too.</p>''')

  rows = ''.join(f'<tr><th>{esc(n)}</th><td class="mn-num">{esc(p)}</td><td>{esc(a)}</td><td>{esc(b)}</td><td>{esc(v)}</td></tr>' for n, p, a, b, v in r['prices'])
  S('plans', 'Plans and prices', f'''
<p>You pay once per plan; there is no subscription. A plan gives you a number of <b>reports</b> and a time window to create them in.</p>
<div class="mn-table"><table><thead><tr><th>Plan</th><th>Price</th><th>Reports</th><th>Statements</th><th>Valid for</th></tr></thead><tbody>{rows}</tbody></table></div>
<h3>How reports are counted</h3>
<ul>
<li><b>A report</b> is one analysis. Creating it uses one report from your plan. The pill at the top of the site shows how many you have left (“4 reports left”).</li>
<li><b>A statement</b> is one file from your broker. A report can combine 2 (Single) or 3 (other plans) statements, for example your equity and F&amp;O files, or two brokers. Adding a statement to an existing report with <b>+</b> is free while your plan is valid.</li>
<li><b>Plans add up.</b> If you hold Single and Snapshot together, you have 1 + 5 = 6 reports.</li>
<li><b>Reports are kept until you delete them.</b> When a plan ends you can still open every report you made; you just can't create new ones until you choose a plan again.</li>
<li>Deleting a report does not give the report back to your plan. Removing a statement from a report does not free its place either.</li>
</ul>
<h3>Try it before you pay</h3>
<p>Without a plan you can still upload a statement and see a <b>free preview</b>: your net P&amp;L, total charges, number of trades and two insights, with the rest of the report blurred. Nothing is saved and nothing is charged. Choose a plan to see the full report.</p>
<h3>Your trading journey</h3>
<p>The bar at the top of the dashboard shows five steps: <b>First report → Baseline score → Month-2 check-up → 3-month trend → 12-month discipline</b>. It ticks off what you have done, shows which plan unlocks the next step, and suggests your next action (for example “Upload next month's statement”). You can hide it.</p>''')

  brows = ''.join(f'<tr><th>{esc(n)}</th><td>{esc(f)}</td></tr>' for n, f in r['brokers'])
  S('files', 'Which file to download', f'''
<p>Download your <b>P&amp;L statement</b> or <b>tradebook</b> for the period you want to analyse. Accepted formats: <b>Excel (.xlsx, .xls), CSV, PDF and Word (.docx, .doc)</b>, up to 10 MB each, up to 3 files at a time.</p>
<div class="mn-note mn-good"><b>Tip.</b> A <b>tradebook</b> gives the richest report because it has the date and time of every trade. Timing views (time of entry, weekday, the heatmap, daily risk, market context) need dates; a P&amp;L statement without dates still gives you the core analysis.</div>
<div class="mn-table"><table><thead><tr><th>Broker</th><th>File to download</th></tr></thead><tbody>{brows}</tbody></table></div>
<p class="mn-small">Other brokers usually work too: columns are recognised automatically, whatever they are called. Scanned PDFs (pictures of a page) cannot be read; download the statement as Excel, CSV or a text PDF instead.</p>''')

  S('upload', 'Upload and create a report', f'''
<ol class="mn-steps">
<li>Choose <b>New report</b> and drop your file(s) in, or browse to them.</li>
<li>Tick the required box: <i>“I agree to the Terms of Service and Privacy Policy, and to PnL Lens processing these files to build my report.”</i></li>
<li>Optionally tick <i>“Make my insights sharper: let PnL Lens learn from my trades, with my name and email removed.”</i> This is off unless you tick it, and you can change it anytime in Your data.</li>
<li>Choose <b>Analyse</b>. Your files are read on our secure servers; this usually takes a few seconds.</li>
<li>With a plan, the report is saved and opens. Without a plan you see the free preview.</li>
</ol>
<p>If a file has no closed trades (only open positions, a holdings or ledger file, or a scanned PDF), PnL Lens tells you so and suggests the right file.</p>''')

  S('report', 'Your report at a glance', f'''
<p>Every report has a header and eight tabs.</p>
<h3>The header</h3>
<ul>
<li><b>Name and Rename</b>: reports are named by date until you rename them (“Q3 review”).</li>
<li><b>30-day plan</b>: downloads your personal plan as a PDF (see <a href="#plan">Your 30-day plan</a>).</li>
<li><b>Share progress</b>: makes an image card of your progress to post (see <a href="#share">Share your progress</a>).</li>
<li><b>Delete</b>: removes the report, its trades and its files for good.</li>
</ul>
<h3>Several statements in one report</h3>
<p>The left side lists each statement as a tab with its own dashboard, plus <b>All files</b> for the combined view. Use <b>+ Add statement</b> to add another file (up to your plan's limit, while the plan is valid and while the original files are still stored, 30 days), and <b>×</b> to take one out.</p>
<h3>View-only by design</h3>
<p>Reports are for viewing in PnL Lens. There is no CSV or PDF download of the report, and printing is blocked. The one download is your 30-day plan.</p>
<h3>The eight tabs</h3>
<div class="mn-tabs">
<a href="#overview"><b>Overview</b><span>the headline numbers</span></a><a href="#progress"><b>Progress</b><span>score, level, habits over time</span></a>
<a href="#insights"><b>Insights &amp; fixes</b><span>leaks and what to change</span></a><a href="#edge"><b>Edge</b><span>skill or luck, risk, comparisons</span></a>
<a href="#rewind"><b>Rewind</b><span>replay with different rules</span></a><a href="#journal"><b>Journal</b><span>notes on your trades</span></a>
<a href="#clusters"><b>Clusters</b><span>when and how you trade</span></a><a href="#positions"><b>Positions</b><span>every trade in a table</span></a>
</div>''')

  S('overview', 'Overview tab', f'''
<p>The first thing you see: the result and what drives it.</p>
<ul>
<li><b>Headline numbers</b>: gross realised P&amp;L, total costs (brokerage, taxes and charges), win rate, payoff (average win ÷ average loss), average win, average loss, profit factor (money won ÷ money lost) and your worst trade. Tap the <b>i</b> next to any number for a plain-words explanation.</li>
<li><b>Top leaks</b>: the biggest habits costing you money, with the fix for each. “All insights &amp; fixes →” opens the full list.</li>
<li><b>Cumulative P&amp;L</b>: your running result trade by trade, with the worst drawdown (the deepest fall from a high).</li>
<li><b>By instrument</b>: results per instrument group, for example {'index options, stock options, equity' if india else 'stocks, options, crypto'}. Click a row to see those trades.</li>
<li><b>After a win vs after a loss</b>: how the next trade goes, and whether your size grows after losses. Your worst losing streak and worst day.</li>
</ul>''')

  S('progress', 'Progress tab', f'''
<p>Your trading score, your level and how your six habits change over time.</p>
<h3>Score and level</h3>
<p>A score from 0 to 100 from your six habits, and the level it puts you at:</p>
<div class="mn-table"><table class="mn-levels"><thead><tr><th>Level</th><th>Score</th></tr></thead><tbody>
<tr><th>Building</th><td>0–39</td></tr><tr><th>Developing</th><td>40–54</td></tr><tr><th>Steady</th><td>55–69</td></tr><tr><th>Disciplined</th><td>70–84</td></tr><tr><th>Elite</th><td>85–100</td></tr></tbody></table></div>
<p>It also says how many points you need for the next level, gives a short summary of the month, and shows badges you earned.</p>
<h3>Your six habits</h3>
<div class="mn-table"><table><thead><tr><th>Habit</th><th>What it measures</th></tr></thead><tbody>
<tr><th>Risk : reward</th><td>Whether your wins are big enough compared with your losses.</td></tr>
<tr><th>Loss control</th><td>Whether you cut losing trades before they get deep.</td></tr>
<tr><th>Consistency</th><td>How steady your results are from trade to trade and month to month.</td></tr>
<tr><th>Emotional control</th><td>Revenge trades, sizing up after losses, chasing.</td></tr>
<tr><th>Trade selection</th><td>Overtrading and taking trades that don't fit how you make money.</td></tr>
<tr><th>Cost efficiency</th><td>How much of your profit goes to charges.</td></tr></tbody></table></div>
<h3>Also on this tab</h3>
<ul>
<li><b>Your 30-day plan check-up</b>: when you downloaded a 30-day plan from an earlier report, the next report starts with how many of its rules you met. Each rule shows <b>Met</b>, <b>Missed</b> or <b>Self-check</b> (habits a statement can't show, like “write the day's plan”), with “then → now · target”. It uses only the trades after the plan date when there are at least 5 of them.</li>
<li><b>Goals for next month</b> from your weakest habits, with now and target.</li>
<li><b>Score trend</b>, <b>Then vs now</b>, a <b>habit heatmap</b> month by month, a <b>mistake tracker</b> and <b>what your habits cost</b>: these fill in as you add a report each month.</li>
<li><b>Check-up history</b> and when your next check-up is due.</li>
</ul>''')

  S('insights', 'Insights & fixes tab', f'''
<ul>
<li><b>Where you're leaking</b>: every leak, ranked by severity and cost, with the evidence (“3 positions carry 58% of all losses”) and a concrete fix.</li>
<li><b>What's working</b>: the habits to keep.</li>
<li><b>Rules to adopt</b>: short rules built from your own numbers.</li>
<li><b>Patterns found</b>: notable patterns in your trades, for example {'options left to expire worthless or losses concentrated in a few underlyings' if india else 'losses concentrated in a few tickers or options left to expire worthless'}.</li>
<li><b>Behavioural mistakes</b>: which of the known trading mistakes show up in your trades, how strongly, and what each cost.</li>
<li><b>Stop-loss simulation</b>: what different stop levels would have done to your result, for options and for {'futures and stocks' if india else 'stocks and futures'}, with the recommended level.</li>
</ul>''')

  market = f'''
<h3>Market context <span class="mn-tag">India only</span></h3>
<p>How your trading lined up with the market. Shown for Indian reports with trade dates.</p>
<ul><li><b>NIFTY 50 and NIFTY BANK over the period</b>, from the close before your first trade to your last trade day, next to your own return when you have added your capital (“ahead of NIFTY by 4.2 points”).</li>
<li><b>By how nervous the market was</b>: your results on calm, normal, nervous and panicky days, by India VIX on the day you entered (under 13, 13–18, 18–25, 25 and up).</li>
<li><b>By the index's move on the day you entered</b>: days the index fell 1% or more, moved less than 1%, or rose 1% or more. BANKNIFTY trades are compared with NIFTY BANK, everything else with NIFTY 50.</li></ul>
<p class="mn-small">Market data (daily closes of NIFTY 50, NIFTY BANK and India VIX) is updated automatically every evening after the close.</p>''' if india else ''

  S('edge', 'Edge tab', f'''
<p>The statistics behind your results. Every figure comes from your own trades.</p>
<h3>Skill or luck?</h3>
<p>PnL Lens reshuffles your trades thousands of times to see how sure it can be that your average trade is really positive.</p>
<ul><li><b>Verdict</b>: <i>Your edge looks real</i>, <i>Not proven yet</i>, <i>Negative edge</i>, or <i>Too few trades</i> (under 20).</li>
<li><b>Average trade</b> with a 90% range (“90% sure it is between {c}354 and {c}4,177”) and a bar showing that range against zero.</li>
<li><b>Chance it is luck</b>: the share of reshuffles where the average trade is zero or worse.</li>
<li><b>Trades to be sure</b>: how many more trades it would take to know, or “enough already”.</li></ul>
<h3>Your next 100 trades</h3>
<p>If your next 100 trades look like your past ones, in random order: a fan chart of likely results (middle outcome, half of outcomes, 9 in 10 outcomes), the middle and 1-in-20 outcome, the chance of ending in profit, the typical and 1-in-20 worst dip, and the chance of giving back a quarter or half of your profit. It is a picture of your past results, not a forecast.</p>
<h3>How you compare</h3>
<p>Where you stand among traders like you (same market and main instrument, for example “{'India · Index options' if india else 'US · Stocks'}”): trades won, average win ÷ average loss, profit factor, average trade as % of position, and trades that lost more than 10%. Each shows “Better than 72% of 312 traders”. Comparisons use only traders who chose to share their data, never names, and a group is shown only once it has at least 50 traders; until then the panel says how many there are so far. Updated nightly.</p>
{market}
<h3>Your results as % of capital</h3>
<p>Optional. Add the capital you traded with in this report (for example {r['ex_cap']}) and PnL Lens shows your return (and a year at this pace for statements of 30 days or more, not compounded), your average trade and loss, your largest single loss, your worst day and worst drawdown as % of that capital, and how many trades lost more than 1% or 2% of it. Change or remove it anytime; only you see it.</p>
<h3>Consistency and risk</h3>
<p>By trading day: % of green days and the average day, your best and worst day (and how the worst compares with a normal losing day), the worst drawdown with how many days it lasted and how long it took to make back, a Sharpe-style and a Sortino-style ratio (return per unit of risk; above 1 is steady), how much of your profit came from your 3 best days, % of green months, and days since your last high.</p>
<h3>Wins and losses in R</h3>
<p>Each trade measured in “R”, where 1R is your average loss: how many trades lost 2R or more, how many won 3R or more, and your average trade in R. Good trading usually means many small losses near 1R and some wins of 2R and more.</p>
<h3>Options by days to expiry</h3>
<p>Your option trades grouped by days from entry to expiry: expiry day, 1–2 days, 3–7 days and 8+ days.</p>
<h3>When you trade</h3>
<p>A heatmap of entry weekday by hour: the number is how many trades, the colour is the result. The best and worst time slot are named below it.</p>''')

  S('rewind', 'Rewind tab', f'''
<p>Replay your own trades with different rules and see what would have happened.</p>
<ul>
<li><b>Stop each loss at −X%</b> (5% to 80% of the position).</li>
<li><b>Trades a day, at most</b> 1, 2, 3 or 5.</li>
<li><b>Stop for the day after</b> 1, 2 or 3 losses, and <b>no new trade the same day after a loss</b>.</li>
<li><b>Skip trades opened on</b> certain weekdays or <b>at</b> certain hours.</li>
<li><b>Skip these names</b>: the ones that lost you money (for example {r['ex_name']}).</li>
<li><b>Skip positions bigger than</b> a size.</li>
</ul>
<p>The top shows your real result next to the result with your rules (“+{c}11,677 more than you made”), both curves, and trades, win rate and worst drawdown for each. <b>What each rule did</b> shows each rule on its own, in green or red; a rule can cost money too. <b>Try my 30-day plan rules</b> loads your plan's rules in one click, and <b>Reset</b> goes back to your real result.</p>
<p class="mn-small">A replay is not a forecast: trades a rule removes are simply not taken, a stop closes a loss at exactly that %, and slippage and the trades you might have taken instead are not modelled. Rules that need dates or times are greyed out for statements without them.</p>''')

  S('journal', 'Journal tab', f'''
<p>Write down why you took a trade and how you felt, and PnL Lens shows which setups and moods make or lose you money.</p>
<ol class="mn-steps"><li>Trades are listed biggest first. Choose <b>Add note</b> on a trade.</li>
<li>Give it a <b>setup</b> (for example “Breakout” or “Gap fill”; your earlier setups are suggested), up to 8 <b>tags</b>, <b>how you felt</b> (Calm, Confident, FOMO, Fear, Revenge, Bored, Tired, Greedy) and a <b>note</b>.</li>
<li>Choose <b>Save</b>.</li></ol>
<p><b>What your journal shows</b> then groups your journaled trades by setup, tag and feeling (trades, % won, average a trade) and names what is working and what is costing you (“setup ‘Breakout’ made {r['ex_money']} over 3 trades”). Filter by journaled or not, and search by symbol.</p>
<p>Notes follow the trade: if the same trade appears in another report (or you upload the same statement again), your note is already there. Your journal is private: it is never used for research.</p>''')

  S('clusters', 'Clusters tab', f'''
<p>Your results grouped two ways.</p>
<ul><li><b>When you trade</b>: by month, entry weekday, time of entry, trades per day, {'expiry day of the option contract, ' if True else ''}and year.</li>
<li><b>How you hold, size &amp; pick</b>: holding period, holding style (intraday or delivery), position size, how deep losers went, best and worst {'underlyings' if india else 'tickers'}, instrument, entry premium, calls vs puts, weekly vs monthly options, long vs short.</li></ul>
<div class="mn-note mn-good"><b>Click to see the trades.</b> Click any month, weekday, expiry day, instrument, {'underlying' if india else 'ticker'}, calls/puts, weekly/monthly, long/short or holding-style row and the Positions tab opens with exactly those trades, with a “Showing … · Show all positions” chip to clear it.</div>''')

  S('positions', 'Positions tab', f'''
<p>Every closed position in a table: symbol, group, expiry, quantity, average buy, buy and sell value, return %, realised P&amp;L and P&amp;L after charges. Search by symbol, filter by group or by winners and losers, and sort by any column. The total at the bottom follows your filter.</p>''')

  S('plan', 'Your 30-day plan', f'''
<p><b>30-day plan</b> in the report header downloads a two-page PDF made from your own trades, for the next 30 days from today. You can download it again anytime; it is always fresh.</p>
<h3>Page 1: your do's and don'ts</h3>
<p>Five <b>Do</b> and five <b>Don't</b> rules, picked by how much money each habit cost you, for example “Don't hold a losing option past −30%” or “Cap each expiry at 6 contracts”. Each rule has a <b>Why</b> line with your numbers and a <b>Now → Target</b> strip. Rules are about habits only, never about what to buy or sell.</p>
<h3>Page 2: scorecard and check-up</h3>
<ul><li>A <b>30-day scorecard</b> (habit, now, target, met?) and a <b>weekly check-in</b> to tick every Friday.</li>
<li><b>See you in 30 days</b>: your check-up date, with three buttons:
<ul><li><b>Remind me</b> turns on one email on your check-up date (in the morning, {r['tz_note']}). You can see and cancel it in Dashboard → Your data.</li>
<li><b>Add to calendar</b> adds the date to your calendar.</li>
<li><b>Upload when ready</b> opens the upload page.</li></ul></li></ul>
<h3>The check-up</h3>
<p>When you upload your next statement, the new report's Progress tab scores the plan: how many measurable rules you met, rule by rule. The next plan PDF opens with “Your last plan: X of Y measurable rules met.”</p>''')

  S('share', 'Share your progress', f'''
<p><b>Share progress</b> in the report header makes a 1080 × 1350 image, the right size for an Instagram post or story. It shows your level and score, the period and number of trades, and up to four stats you choose: trades won, skill or luck, 30-day plan rules met, green days, win ÷ loss size and return on capital (only if you added capital).</p>
<p>The card never shows money amounts, your name or trading symbols. Choose <b>Download image</b>, or <b>Share…</b> on a phone to send it straight to an app.</p>''')

  S('lifetime', 'All my trading (lifetime view)', f'''
<p>With two or more reports, the dashboard shows <b>All my trading</b>: one picture of all your reports together.</p>
<ul><li>A trade that appears in more than one report (the same statement uploaded twice, or overlapping periods) is counted <b>once</b>, and the page says how many were repeated.</li>
<li><b>Summary</b>: net P&amp;L, trades, % won, average trade, best and worst month, a lifetime P&amp;L curve, results by month, and <b>what each report added</b>.</li>
<li><b>Edge</b>, <b>Rewind</b> and <b>Journal</b> work on all your trades together.</li>
<li>Reports in different currencies are never mixed; switch between them at the top.</li></ul>''')

  S('dashboard', 'Dashboard and Your data', f'''
<h3>Your reports</h3>
<p>All your reports as cards (name or date, files, trades, net P&amp;L). <b>Search</b> by name, file name, month or market, <b>sort</b> by newest, oldest or name, and <b>Rename</b> any report. The plan card shows your plan, reports left and when it ends.</p>
<h3>Your data</h3>
<ul>
<li><b>Change password</b> (or <b>Set a password</b> if you use Google).</li>
<li><b>Check-up reminder</b>: the date of your reminder, with <b>Cancel</b>.</li>
<li><b>Weekly summary email on Mondays</b>: off unless you turn it on (see <a href="#emails">Emails</a>).</li>
<li><b>Make my insights sharper</b>: share your trades for research with your name and email removed. Off unless you turn it on.</li>
<li><b>Export my data</b>: a ZIP of your account, reports, trades, journal, plans and the statements still stored. The link works for 7 days.</li>
<li><b>Delete my account</b>: type DELETE to confirm. Your reports, trades, statements, journal and plans are deleted; payment records are kept as the law requires.</li>
</ul>''')

  S('emails', 'Emails you may get', f'''
<div class="mn-table"><table><thead><tr><th>Email</th><th>When</th></tr></thead><tbody>
<tr><th>Your sign-in code</th><td>When you sign in with email for the first time or reset your password.</td></tr>
<tr><th>Your 30-day check-up is today</th><td>Once, on your check-up date, only if you chose “Remind me” in your plan.</td></tr>
<tr><th>Your week</th><td>Every Monday morning, only if you turned on the weekly summary: your focus rules for the week, your journal progress and your check-up countdown, with a link to your latest report. Every one has a “Stop these emails” link.</td></tr>
</tbody></table></div>''')

  S('privacy', 'Privacy and your data', f'''
<ul>
<li><b>Your files</b> are encrypted and stored privately. The original statements are <b>deleted automatically after 30 days</b>. Every time a file is read, it is logged.</li>
<li><b>Your reports and trades</b> are kept until you delete them.</li>
<li><b>Research</b> uses your trades only if you turned on “Make my insights sharper”, always without your name or email. You can turn it off anytime.</li>
<li><b>Comparisons</b> (How you compare) show only figures for groups of at least 50 traders who share their data. Nobody sees another trader's results.</li>
<li><b>Your journal and capital</b> are private and never used for research.</li>
<li><b>Export</b> everything or <b>delete</b> your account anytime in Your data.</li>
</ul>''')

  gl = [('Net P&L', 'What you made or lost after closing your trades.'), ('Win rate', 'The share of trades that made money.'),
        ('Payoff (win ÷ loss size)', 'Average win divided by average loss. Above 1 means your wins are bigger than your losses.'),
        ('Profit factor', 'All money won divided by all money lost. Above 1 means you made money overall.'),
        ('Drawdown', 'The fall from a high point to the low that followed.'), ('Expectancy / average trade', 'What one trade makes on average.'),
        ('R', 'A unit of risk. Here 1R is your average losing trade, so a 2R win is twice your average loss.'),
        ('Sharpe-style / Sortino-style ratio', 'Daily return per unit of daily risk, scaled to a year. Sortino counts only the downside.'),
        ('Green day', 'A day your trades ended in profit.'), ('Days to expiry', 'Calendar days from opening an option to its expiry date.')]
  if india: gl += [('India VIX', 'The market\'s expected volatility for the next month. Higher means a more nervous market.')]
  S('glossary', 'Glossary', '<dl class="mn-gloss">' + ''.join(f'<dt>{esc(a)}</dt><dd>{esc(b)}</dd>' for a, b in gl) + '</dl>')

  mk_faq = '<dt>I don&#39;t see Market context.</dt><dd>It is shown for Indian reports with trade dates, once the market data covers your dates.</dd>' if india else ''
  S('faq', 'Questions and fixes', f'''
<dl class="mn-faq">
<dt>My file wasn't read.</dt><dd>Use the P&amp;L statement or tradebook (not a holdings, ledger or contract-note file), for a period with closed trades, as Excel, CSV or a text PDF. Scanned PDFs can't be read.</dd>
<dt>Some views say they need dates.</dt><dd>Your statement has no trade dates. Upload a tradebook for timing, daily risk{', market context' if india else ''} and the heatmap.</dd>
<dt>I can't add a statement with +.</dt><dd>Either the report already holds all the statements your plan allows, your plan has ended, or the report's original files were deleted after 30 days. Start a new report instead.</dd>
<dt>How you compare says “appears once 50 traders…”.</dt><dd>Comparisons start when enough traders in your group share their data. Until then the panel shows how many there are.</dd>
{mk_faq}
<dt>Can I download my report?</dt><dd>Reports are view-only. You can download your 30-day plan and your share card, and export all your data from Your data.</dd>
<dt>Does PnL Lens give tips?</dt><dd>No. It only looks at trades you have already made. Nothing in it is investment advice.</dd>
</dl>''')

  toc = ''.join(f'<li><a href="#{i}">{esc(t)}</a></li>' for i, t, _ in sec)
  body = ''.join(f'<section id="{i}" class="mn-sec"><h2>{esc(t)}</h2>{b}</section>' for i, t, b in sec)
  edition = ('<a class="mn-switch" href="/manual?region=global">Read the Global edition ($)</a>' if india
             else '<a class="mn-switch" href="/manual?region=in">Read the India edition (₹)</a>')
  return f'''<div class="mn">
<header class="mn-top">
  <div><h1>PnL Lens user manual</h1><p>Every feature, what it tells you and how to use it.</p></div>
  <div class="mn-ed"><span class="mn-pill">{r['site']} edition · {c}</span>{edition}</div>
</header>
<div class="mn-wrap">
  <nav class="mn-toc" aria-label="Contents"><h2>Contents</h2><ol>{toc}</ol></nav>
  <div class="mn-main">{body}</div>
</div>
<p class="mn-foot">PnL Lens analyses trades you have already made. Nothing in it is investment advice.</p>
</div>
'''

for key, name in (('IN', 'manual-india.html'), ('GLOBAL', 'manual-global.html')):
  (OUT / name).write_text(build(key), encoding='utf-8')
  print(name, len(build(key)))
