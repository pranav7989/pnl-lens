# @file  tests/e2e/auth.py
# @area  Tests
# @what  Browser E2E: email code + Google sign-in (with mock provider).
"""Sign-in E2E: email code + Google (via tests/e2e/mock-google.mjs). Needs a server on :3100 with
AUTH_MODE=jwt, MAIL_DRIVER=console, GOOGLE_* pointing at the mock on :4555. MAIL_LOG = path to dev-mail.log."""
import json, os, re, sys, time, pathlib, urllib.request
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:3100'); MOCK = 'http://localhost:4555'
MAIL_LOG = pathlib.Path(os.environ['MAIL_LOG'])
ok = lambda c, m: print(('PASS ' if c else 'FAIL ') + m) or (c or sys.exit(1))
def last_code(email):
    for line in reversed(MAIL_LOG.read_text().splitlines()):
        m = json.loads(line)
        if m['to'] == email: return re.search(r'\b(\d{6})\b', m['subject']).group(1)
def mock(**cfg): urllib.request.urlopen(urllib.request.Request(f'{MOCK}/config', data=json.dumps(cfg).encode(), method='POST'))

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))

    pg.goto(f'{BASE}/dashboard'); ok('/login?next=%2Fdashboard' in pg.url or '/login?next=/dashboard' in pg.url, 'logged-out /dashboard → /login with next')
    ok(pg.is_visible('text=Continue with Google') and pg.is_visible('text=Email me a code'), 'sign-in page shows Google + email options')
    ok(pg.locator('input[type=tel]').count() == 0, 'no phone number field')
    ok(pg.request.get(f'{BASE}/api/me').status == 401, 'API 401 without session')

    # --- email code
    email = f'user{int(time.time())}@example.com'
    pg.fill('input[name=email]', email); pg.click('button:has-text("Email me a code")')
    pg.wait_for_selector('text=We sent a 6-digit code'); ok(True, 'code email sent')
    code = last_code(email); ok(code and len(code) == 6, f'code delivered to mailbox')
    wrong = '000000' if code != '000000' else '111111'
    pg.fill('input[name=code]', wrong); pg.click('button:has-text("Sign in")'); pg.wait_for_selector('p.status.err')
    ok('wrong' in pg.inner_text('p.status.err').lower(), 'wrong code rejected')
    pg.fill('input[name=code]', code); pg.click('button:has-text("Sign in")'); pg.wait_for_url(f'{BASE}/dashboard')
    pg.wait_for_selector('text=Your reports'); ok(True, 'correct code signs in → dashboard')
    me = pg.request.get(f'{BASE}/api/me').json(); ok(me['user']['id'] and me['credits'] == 0, 'new account created with 0 credits')
    ok(pg.request.post(f'{BASE}/api/auth/otp/verify', data={'email': email, 'code': code}).status == 401, 'used code cannot be reused')
    pg.click('button:has-text("Log out")'); pg.wait_for_url(f'{BASE}/login'); ok(pg.request.get(f'{BASE}/api/me').status == 401, 'logout clears session')

    # --- lockout after 5 wrong attempts, even with the right code afterwards
    e2 = f'lock{int(time.time())}@example.com'
    pg.request.post(f'{BASE}/api/auth/otp/request', data={'email': e2}); c2 = last_code(e2)
    for _ in range(5): pg.request.post(f'{BASE}/api/auth/otp/verify', data={'email': e2, 'code': '999999' if c2 != '999999' else '888888'})
    r = pg.request.post(f'{BASE}/api/auth/otp/verify', data={'email': e2, 'code': c2}); ok(r.status == 401, 'locked after 5 wrong attempts')

    # --- rate limit: 5 codes per email per hour
    e3 = f'rate{int(time.time())}@example.com'
    sts = [pg.request.post(f'{BASE}/api/auth/otp/request', data={'email': e3}).status for _ in range(6)]
    ok(sts[:5] == [200]*5 and sts[5] == 429, f'6th code request rate-limited {sts}')
    ok(pg.request.post(f'{BASE}/api/auth/otp/request', data={'email': 'not-an-email'}).status == 400, 'invalid email rejected')

    # --- Google
    gmail = f'g{int(time.time())}@gmail.com'; mock(email=gmail, verified=True, badState=False)
    ctx2 = b.new_context(); g = ctx2.new_page()
    g.goto(f'{BASE}/login?next=/upload'); g.click('text=Continue with Google'); g.wait_for_url(f'{BASE}/upload')
    g.wait_for_selector('h1:has-text("New report")'); ok(True, 'Google sign-in → lands on requested page (/upload)')
    gid = g.request.get(f'{BASE}/api/me').json()['user']['id']
    # same email via email code → same account
    g.request.post(f'{BASE}/api/auth/logout')
    g.request.post(f'{BASE}/api/auth/otp/request', data={'email': gmail})
    g.request.post(f'{BASE}/api/auth/otp/verify', data={'email': gmail, 'code': last_code(gmail)})
    ok(g.request.get(f'{BASE}/api/me').json()['user']['id'] == gid, 'Google and email code for same address → same account')

    ctx3 = b.new_context(); g3 = ctx3.new_page()
    mock(badState=True); g3.goto(f'{BASE}/login'); g3.click('text=Continue with Google'); g3.wait_for_url(re.compile(r'/login\?error=google'))
    ok(g3.request.get(f'{BASE}/api/me').status == 401, 'tampered state rejected')
    mock(badState=False, verified=False, email=f'unverified{int(time.time())}@gmail.com')
    g3.goto(f'{BASE}/login'); g3.click('text=Continue with Google'); g3.wait_for_url(re.compile(r'/login\?error=google'))
    ok(g3.request.get(f'{BASE}/api/me').status == 401 and g3.is_visible('p.status.err'), 'unverified Google email rejected with message')
    r = g3.request.get(f'{BASE}/api/auth/google/callback?code=x&state=y', max_redirects=0); ok(r.status in (302, 307), 'callback without cookie rejected')

    ok(not errs, f'no page errors {errs}')
    b.close()
print('ALL AUTH E2E CHECKS PASSED')
