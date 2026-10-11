# @file  tests/e2e/flow.py
# @area  Tests
# @what  Browser E2E: upload → report → dashboard → credits → delete → expiry.
"""End-to-end smoke test against a running server on :3100 with AUTH_MODE=dev (STORE_DRIVER=file, or pg with ADMIN_URL set).
Covers: upload → worker analysis → preview → save (credit) → report tabs → CSV → dashboard → delete →
out-of-credits → column mapper → expiry. Run: python3 tests/e2e/flow.py"""
import json, os, re, sys, pathlib
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:3100')
FX = pathlib.Path(__file__).resolve().parents[2] / 'packages/engine/test/fixtures'
STORE = pathlib.Path(os.environ.get('STORE_FILE') or (pathlib.Path(__file__).resolve().parents[2] / '.data' / 'dev-store.json'))
ok = lambda c, m: print(('PASS ' if c else 'FAIL ') + m) or (c or sys.exit(1))
shots = pathlib.Path('/tmp/e2e'); shots.mkdir(exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1360, 'height': 900}, accept_downloads=True)
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))

    pg.goto(f'{BASE}/dashboard'); ok('No reports yet' in pg.content(), 'dashboard empty state')
    ok('2' in pg.inner_text('.credits-pill'), 'credits pill shows 2')

    # 1) tradebook → report
    pg.goto(f'{BASE}/upload')
    pg.set_input_files('#file', [str(FX / 'zerodha_tradebook.csv'), str(FX / 'zerodha_equity_statement.xlsx')])
    ok(pg.locator('.filelist li').count() == 2, 'two files listed')
    pg.click('button:has-text("Analyse")'); pg.wait_for_selector('text=Ready', timeout=15000)
    ok('Open full report' in pg.content(), 'preview shown with save button')
    pg.screenshot(path=str(shots / '1_preview.png'), full_page=True)
    pg.click('button:has-text("Open full report")'); pg.wait_for_url(re.compile(r'/report/'), timeout=10000)
    pg.wait_for_selector('#overview .rv-hero', timeout=10000)
    ok(pg.is_visible('#overview .rv-hero'), 'report overview rendered')
    pg.screenshot(path=str(shots / '2_report.png'), full_page=True)
    for tab in ['insights', 'clusters', 'positions']:
        pg.click(f'.tabs [data-tab="{tab}"]'); ok(pg.is_visible(f'#{tab}') and len(pg.inner_text(f'#{tab}')) > 50, f'tab {tab} renders')
    pg.fill('#q', 'NIFTY'); ok(all('NIFTY' in r for r in pg.locator('#ptable td.sym').all_inner_texts()), 'positions search filters')
    with pg.expect_download() as d: pg.click('button:has-text("CSV")')
    csv = pathlib.Path(d.value.path()).read_text(); ok(csv.startswith('symbol,group') and csv.count('\n') > 10, 'CSV export')
    report_url = pg.url

    # 2) dashboard lists it with expiry
    pg.goto(f'{BASE}/dashboard'); ok(pg.locator('tbody tr').count() == 1 and 'days left' in pg.content(), 'dashboard lists report with countdown')
    ok('1' in pg.inner_text('.credits-pill'), 'credit consumed')

    # 3) second report uses last credit, then out of credits
    pg.goto(f'{BASE}/upload'); pg.set_input_files('#file', str(FX / 'ibkr_tradebook.csv'))
    pg.click('button:has-text("Analyse")'); pg.wait_for_selector('text=Ready'); ok('USD' in pg.inner_text('.tiles'), 'IBKR detected as USD')
    pg.click('button:has-text("Open full report")'); pg.wait_for_url(re.compile(r'/report/'))
    pg.goto(f'{BASE}/upload'); pg.set_input_files('#file', str(FX / 'groww_pnl.csv'))
    pg.click('button:has-text("Analyse")'); pg.wait_for_selector('text=Ready')
    ok(pg.is_visible('text=Buy a report credit'), 'out of credits → buy prompt instead of save')
    r = pg.request.post(f'{BASE}/api/reports', data=json.dumps({'report': {'version': 1}}), headers={'Content-Type': 'application/json'})
    ok(r.status == 400, 'malformed report rejected (400)')

    # 4) unknown headers → read automatically, never a column form
    pg.goto(f'{BASE}/upload'); pg.set_input_files('#file', str(FX / 'unknown_headers.csv'))
    pg.click('button:has-text("Analyse")'); pg.wait_for_selector('text=Ready')
    ok('4' in pg.inner_text('.tiles .tile >> nth=0') and pg.locator('select').count() <= 1, 'unknown headers read automatically (no column form)')
    # 5) limits
    pg.goto(f'{BASE}/upload')
    pg.set_input_files('#file', [str(FX / f) for f in ['groww_pnl.csv', 'dhan_tradebook.csv', 'binance_trades.csv', 'ibkr_tradebook.csv']])
    ok(pg.locator('.filelist li').count() == 3 and 'Up to 3 files' in pg.content(), 'max 3 files enforced')

    # 6) delete + expiry
    pg.goto(f'{BASE}/dashboard'); pg.once('dialog', lambda dlg: dlg.accept())
    pg.locator('button.linkbtn').first.click(); pg.wait_for_timeout(800); pg.reload()
    ok(pg.locator('text=Expired').count() == 1, 'deleted report shows as expired')
    if os.environ.get('ADMIN_URL'):   # STORE_DRIVER=pg
        import subprocess
        subprocess.run(['psql', '-q', os.environ['ADMIN_URL'], '-c', "update reports set expires_at = now() - interval '1 day' where purged_at is null"], check=True)
    else:                              # STORE_DRIVER=file
        db = json.loads(STORE.read_text())
        for row in db['reports']:
            if not row['purged']: row['expiresAt'] = '2020-01-01T00:00:00.000Z'
        STORE.write_text(json.dumps(db))
    pg.goto(report_url); ok('has expired' in pg.content() or 'Not found' in pg.content(), 'expired report shows expiry page')
    r = pg.request.get(f"{BASE}/api/reports/{report_url.rsplit('/',1)[1]}"); ok(r.status in (404, 410), f'API returns {r.status} for expired/deleted')
    pg.goto(f'{BASE}/dashboard'); pg.screenshot(path=str(shots / '4_dashboard.png'), full_page=True)

    ok(not errs, f'no page errors {errs}')
    b.close()
print('ALL E2E CHECKS PASSED')
