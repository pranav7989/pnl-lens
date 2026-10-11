# @file  tests/e2e/v2.py
# @area  Tests
# @what  Browser E2E: report tabs, hover cards, behaviour, clusters, PDF/Word uploads.
"""Report v2 + document formats E2E. Server on :3100, AUTH_MODE=dev, fresh credits (>=4)."""
import re, sys, pathlib
from playwright.sync_api import sync_playwright
BASE='http://localhost:3100'; FX=pathlib.Path(__file__).resolve().parents[2]/'packages/engine/test/fixtures'
ok=lambda c,m: print(('PASS ' if c else 'FAIL ')+m) or (c or sys.exit(1))
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    def open_report(files):
        pg.goto(f'{BASE}/upload'); pg.set_input_files('#file',[str(FX/f) for f in files])
        pg.click('button:has-text("Analyse")')
        seen = pg.wait_for_selector('.an-wrap', timeout=5000) is not None
        pg.wait_for_selector('text=Ready', timeout=30000)
        return seen
    # loader + PDF
    ok(open_report(['zerodha_tradebook.pdf']), 'analysing loader shown while a PDF is read')
    ok('60' in pg.inner_text('.tiles .tile >> nth=0'), 'PDF tradebook → 60 positions')
    pg.click('button:has-text("Open full report")'); pg.wait_for_url(re.compile('/report/')); pg.wait_for_selector('#overview .rv-hero')
    ok(pg.locator('text=What this file gave us').count()==0, '"What this file gave us" removed from Overview')
    # hover behaviour card
    pg.hover('#overview .rv-kpi[data-behav="winrate"]'); pg.wait_for_selector('.rv-tip.in', timeout=3000)
    tip=pg.inner_text('.rv-tip'); ok('How you trade now' in tip and 'What disciplined traders do' in tip, 'hover card shows current vs ideal behaviour')
    pg.hover('#overview .rv-panel[data-behav="costsPanel"] h3'); pg.wait_for_timeout(250)
    ok('Costs' in pg.inner_text('.rv-tip') or 'cost' in pg.inner_text('.rv-tip').lower(), 'hover card follows the tile under the cursor')
    pg.screenshot(path='/tmp/v2_overview.png')
    # insights: behavioural mistakes
    pg.click('.tabs [data-tab="insights"]'); pg.wait_for_selector('.rv-trait')
    n=pg.locator('#insights .rv-traits .rv-trait').count(); ok(n>=3, f'behavioural mistakes shown ({n} headline traits)')
    ok(pg.locator('#insights .rv-traits .rv-trait .rv-tideal').count()==n, 'every trait has an ideal behaviour')
    if pg.locator('[data-more]').count():
        pg.click('[data-more]'); ok(pg.is_visible('.rv-more .rv-trait'), '"Show more patterns" expands')
    pg.screenshot(path='/tmp/v2_insights.png', full_page=True)
    # clusters: two groups
    pg.click('.tabs [data-tab="clusters"]'); pg.wait_for_selector('[data-group="when"]')
    ok(pg.is_visible('[data-group="when"] [data-behav="month"] .rv-tile') and pg.is_visible('[data-group="when"] [data-behav="entryDow"] .rv-tile'), 'month + weekday tiles in "When you trade"')
    pg.click('[data-seg="how"]'); pg.wait_for_timeout(300)
    for k in ['hold','size','lossDepth','worstU','bestU']:
        ok(pg.is_visible(f'[data-group="how"] [data-behav="{k}"] .rv-bars'), f'"How you hold" has {k} chart')
    ok(not pg.is_visible('[data-group="when"]'), 'groups toggle')
    pg.screenshot(path='/tmp/v2_clusters.png', full_page=True)
    # mobile: tap the info button
    m=b.new_page(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True); m.on('pageerror',lambda e:errs.append(str(e)))
    m.goto(pg.url); m.wait_for_selector('#overview .rv-hero'); m.tap('.rv-kpi[data-behav="payoff"] .rv-info'); m.wait_for_selector('.rv-tip.in')
    ok(m.is_visible('.rv-tip.in'), 'mobile: tapping ⓘ opens the behaviour card'); m.screenshot(path='/tmp/v2_mobile.png')
    ok(m.evaluate('document.documentElement.scrollWidth')<=392, 'mobile: no sideways scroll')
    # Word formats
    open_report(['dhan_tradebook.docx']); ok('30' in pg.inner_text('.tiles .tile >> nth=0'), 'DOCX tradebook → 30 positions')
    open_report(['groww_pnl.doc']); ok('5' in pg.inner_text('.tiles .tile >> nth=0'), 'legacy .doc P&L → 5 positions')
    open_report(['groww_pnl.pdf']); ok('5' in pg.inner_text('.tiles .tile >> nth=0'), 'PDF P&L statement → 5 positions')
    ok(not errs, f'no page errors {errs}')
print('ALL V2 CHECKS PASSED')
