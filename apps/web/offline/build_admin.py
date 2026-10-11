# @file  apps/web/offline/build_admin.py
# @area  Offline
# @what  Builds the standalone admin dashboard HTML from the demo database.
"""Builds a standalone admin dashboard HTML from a running server (:3100, STORE_DRIVER=pg, AUTH_MODE=dev, owner)
with the demo data. Usage: python3 offline/build_admin.py <out.html>"""
import json, re, sys, base64, urllib.request, pathlib, datetime
ROOT = pathlib.Path(__file__).resolve().parents[1]; B = 'http://localhost:3100'
def get(u): return urllib.request.urlopen(B + u, timeout=30).read()
data = {t: json.loads(get(f'/api/admin/metrics?tab={t}')) for t in ['users', 'finance', 'errors', 'support', 'product']}
emails = [t['email'] for t in data['support']['tickets']][:6] + [s['email'] for s in data['support']['struggling']][:4]
data['lookups'] = {}
for e in dict.fromkeys(emails):
    try: data['lookups'][e] = json.loads(get('/api/admin/user?email=' + urllib.request.quote(e)))
    except Exception: pass
data['capturedAt'] = datetime.datetime.utcnow().isoformat() + 'Z'
page = get('/admin').decode()
css = ''.join(get(h).decode() + '\n' for h in re.findall(r'<link rel="stylesheet" href="([^"]+)"', page))
css = re.sub(r'url\((/_next/static/media/[^)]+\.woff2)\)', lambda m: 'url(data:font/woff2;base64,' + base64.b64encode(get(m.group(1))).decode() + ')', css)
icon = 'data:image/svg+xml;base64,' + base64.b64encode((ROOT / 'app/icon.svg').read_bytes()).decode()
logo = (ROOT / 'app/icon.svg').read_text().replace('<svg ', '<svg width="28" height="28" class="logo-mark" ')
body_font = re.search(r'<html[^>]*class="([^"]+)"', page).group(1)
html = f'''<!doctype html><html lang="en" class="{body_font}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PnL Lens — Admin (demo)</title><link rel="icon" type="image/svg+xml" href="{icon}"><meta name="robots" content="noindex">
<style>{css}
.ad-demo{{display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:#0e0d06;border:1px solid #3a3210;border-radius:12px;padding:10px 14px;margin:0 0 18px;font-size:13px;color:var(--muted)}}
.ad-demo b{{color:var(--y)}} .ad-demo button{{font:inherit;font-size:13px;font-weight:700;background:none;border:1px solid #333;color:var(--ink);border-radius:999px;padding:6px 12px;cursor:pointer}}
.ad-demo button[aria-pressed="true"]{{background:var(--y);color:#000;border-color:var(--y)}} .ad-demo span.r{{margin-left:auto}}
#adBody.rv-enter > * {{ animation: rv-in .4s cubic-bezier(.2,.7,.2,1) both; }}
</style></head><body>
<header class="app-header"><div class="bar"><span class="brand">{logo}<span>PnL Lens</span></span><span class="muted" id="adStamp" style="margin-left:auto;font-size:12px"></span></div></header>
<main><div class="ad">
<div class="ad-demo"><b>View as</b>{''.join(f'<button data-role="{r}" aria-pressed="{str(r=="owner").lower()}">{r.capitalize()}</button>' for r in ['owner','admin','support','finance','analyst'])}<span class="r">Demo with sample data. On pnllens.com the server enforces these roles.</span></div>
<div class="ad-head"><div><h1 class="page-title">Admin</h1><p class="muted" style="margin:0">Signed in as <b class="ad-role" id="adRole">owner</b></p></div></div>
<nav class="tabs" role="tablist" id="adTabs"></nav>
<div class="rv-grid" id="adBody" style="margin-top:16px"></div>
</div></main>
<script>window.ADMIN_DATA = {json.dumps(data, default=str).replace('</', '<\\/')};</script>
<script>{(ROOT / 'offline/admin_console.js').read_text()}</script></body></html>'''
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'pnl_lens_admin.html'); out.write_text(html)
print(f'wrote {out} ({len(html)//1024} KB) · lookups: {len(data["lookups"])}')
