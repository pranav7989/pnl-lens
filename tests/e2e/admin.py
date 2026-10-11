# @file  tests/e2e/admin.py
# @area  Tests
# @what  Browser E2E: admin console across all five roles.
"""Admin console + RBAC E2E. Server on :3100 with STORE_DRIVER=pg, AUTH_MODE=dev; ADMIN_URL = owner DB url; demo data seeded."""
import os, sys, subprocess
from playwright.sync_api import sync_playwright
BASE='http://localhost:3100'; A=os.environ['ADMIN_URL']
ok=lambda c,m: print(('PASS ' if c else 'FAIL ')+m) or (c or sys.exit(1))
role=lambda r: subprocess.run(['psql','-q',A,'-c',f"update users set role='{r}' where email='dev@pnl-lens.local'"],check=True)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    role('owner'); pg.goto(f'{BASE}/admin'); pg.wait_for_selector('.ad .rv-kpi', timeout=15000)
    ok([t.inner_text() for t in pg.locator('.ad .tabs button').all()]==['Users','Finance','Errors','Support','Product'], 'owner sees all 5 tabs')
    t=pg.inner_text('.ad'); ok(all(x in t for x in ['DAU','WAU','MAU','Stickiness','New users','Repeat users','30-day retention']), 'Users tab: DAU, WAU, MAU, stickiness, new, repeat, retention')
    ok(pg.is_visible('text=Team & roles'), 'owner can manage roles')
    pg.screenshot(path='/tmp/admin_users.png', full_page=True)
    for tab, must in [('Finance',['Revenue (₹)','Revenue ($)','Plan mix','Monthly P&L','Gateway fees','Running costs','Margin']), ('Errors',['Errors (24h)','Error center','Users affected']), ('Product',['Reports (30 days)','Upload failure rate','Why uploads fail','Most-used tabs'])]:
        pg.click(f'.ad .tabs button:has-text("{tab}")'); pg.wait_for_timeout(1200)
        ok(all(x in pg.inner_text('.ad') for x in must), f'{tab} tab: ' + ', '.join(must))
        pg.screenshot(path=f'/tmp/admin_{tab.lower()}.png', full_page=True)
    # support: pinpoint a user's issue + ticket update
    pg.click('.ad .tabs button:has-text("Support")'); pg.wait_for_selector('text=Find a user')
    pg.fill('input[aria-label="Customer email"]','demo3@example.com'); pg.click('button:has-text("Look up")'); pg.wait_for_selector('.ad-diag', timeout=8000)
    ok('likely cause' in pg.inner_text('.ad-diag').lower() and pg.locator('.ad-user tbody tr').count()>=1, 'user lookup shows likely cause and timeline')
    first=pg.locator('select[aria-label="Status"]').first; first.select_option('resolved'); pg.wait_for_timeout(800)
    ok(pg.locator('text=Avg time to resolve').count()==1, 'ticket status can be changed')
    pg.screenshot(path='/tmp/admin_support.png', full_page=True)
    # role rules via API
    r=pg.request.post(f'{BASE}/api/admin/roles', data={'email':'dev@pnl-lens.local','role':'user'}); ok(r.status==403, 'nobody can change their own role')
    r=pg.request.post(f'{BASE}/api/admin/roles', data={'email':'demo7@example.com','role':'support'}); ok(r.status==200, 'owner assigns a support role')
    # support role: no finance
    role('support'); pg.goto(f'{BASE}/admin'); pg.wait_for_selector('.ad .tabs button', timeout=10000)
    ok([t.inner_text() for t in pg.locator('.ad .tabs button').all()]==['Errors','Support'], 'support sees only Errors and Support')
    ok(pg.request.get(f'{BASE}/api/admin/metrics?tab=finance').status==403, 'support gets 403 on finance data (server-enforced)')
    ok(pg.request.post(f'{BASE}/api/admin/roles', data={'email':'demo8@example.com','role':'admin'}).status==403, 'support cannot assign roles')
    role('finance'); pg.goto(f'{BASE}/admin'); pg.wait_for_selector('.ad .tabs button', timeout=10000)
    ok([t.inner_text() for t in pg.locator('.ad .tabs button').all()]==['Finance'], 'finance sees only Finance')
    role('analyst'); pg.goto(f'{BASE}/admin'); pg.wait_for_selector('.ad .rv-kpi', timeout=10000)
    ok('Latest sign-ups' not in pg.inner_text('.ad') and pg.request.get(f'{BASE}/api/admin/user?email=demo1@example.com').status==403, 'analyst sees metrics but no emails or user lookup')
    role('admin'); ok(pg.request.post(f'{BASE}/api/admin/roles', data={'email':'demo9@example.com','role':'owner'}).status==403, 'admin cannot create an owner')
    role('user'); pg.goto(f'{BASE}/admin'); ok(pg.is_visible('text=Not available') and pg.request.get(f'{BASE}/api/admin/metrics?tab=users').status==403, 'customers are kept out of /admin')
    # telemetry endpoints
    ok(pg.request.post(f'{BASE}/api/errors', data={'message':'E2E test error','route':'/x'}).status==204, 'browser errors are accepted for the error center')
    role('owner')
    ok(not errs, f'no page errors {errs}')
print('ALL ADMIN CHECKS PASSED')
