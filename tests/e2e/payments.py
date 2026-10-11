# @file  tests/e2e/payments.py
# @area  Tests
# @what  Payments E2E: off / link modes and the signed webhook path.
"""Payments E2E (no real Razorpay calls): server on :3100 with STORE_DRIVER=pg, AUTH_MODE=dev,
RAZORPAY_WEBHOOK_SECRET=whsec_test. Checks mode off/link responses and the signed webhook path."""
import hmac, hashlib, json, os, sys, subprocess, urllib.request
BASE='http://localhost:3100'; A=os.environ['ADMIN_URL']; MODE=os.environ.get('MODE','webhook')
ok=lambda c,m: print(('PASS ' if c else 'FAIL ')+m) or (c or sys.exit(1))
def req(path, data=None, headers=None, raw=None):
    body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    r = urllib.request.Request(BASE+path, data=body, headers={'Content-Type':'application/json', **(headers or {})}, method='POST' if body is not None else 'GET')
    try: res = urllib.request.urlopen(r); return res.status, res.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
sql=lambda q: subprocess.run(['psql','-qtA',A,'-c',q],capture_output=True,text=True,check=True).stdout.strip()
if MODE=='off':
    s,b=req('/api/payments/config'); ok(json.loads(b)['mode']=='off', 'mode off reported to the pricing page')
    s,b=req('/api/payments/order',{'planId':'progress'}); ok(s==503 and 'opening soon' in b, 'off: order returns "opening soon" (503)')
elif MODE=='link':
    s,b=req('/api/payments/order',{'planId':'progress'}); j=json.loads(b); ok(s==200 and j['mode']=='link' and j['url'].startswith('https://rzp.io/'), 'link: order returns the pasted Razorpay link')
    s,b=req('/api/payments/order',{'planId':'single'}); ok(s==503 and 'not available' in b, 'link: plan without a pasted link is not sold')
else:
    uid=sql("select id from users where email='dev@pnl-lens.local'")
    sql("delete from subscriptions where user_id='%s'"%uid); sql("delete from payments where gateway_order_id='order_E2E1'")
    sql(f"insert into payments (user_id, gateway, gateway_order_id, amount_minor, currency, status, plan_id) values ('{uid}','razorpay','order_E2E1',149900,'INR','created','progress')")
    before=int(sql(f"select balance from credits where user_id='{uid}'") or 0)
    body=json.dumps({'event':'payment.captured','payload':{'payment':{'entity':{'id':'pay_E2E1','order_id':'order_E2E1'}}}}).encode()
    sig=hmac.new(b'whsec_test', body, hashlib.sha256).hexdigest()
    s,_=req('/api/payments/webhook', raw=body, headers={'X-Razorpay-Signature':'bad'}); ok(s==401, 'webhook with a bad signature is rejected (401)')
    s,_=req('/api/payments/webhook', raw=body, headers={'X-Razorpay-Signature':sig}); ok(s==200, 'signed payment.captured accepted')
    ok(sql("select status from payments where gateway_order_id='order_E2E1'")=='paid', 'payment marked paid')
    sub=sql(f"select plan_id||','||reports_total||','||files_per_report from subscriptions where user_id='{uid}'"); ok(sub=='progress,25,3', f'Progress plan granted: 25 reports, 3 statements each ({sub})')
    ok(int(sql(f"select balance from credits where user_id='{uid}'"))==before+25, 'credits increased by 25')
    s,_=req('/api/payments/webhook', raw=body, headers={'X-Razorpay-Signature':sig}); ok(s==200 and sql(f"select count(*) from subscriptions where user_id='{uid}'")=='1' and int(sql(f"select balance from credits where user_id='{uid}'"))==before+25, 'replayed webhook grants nothing twice')
    fb=json.dumps({'event':'payment.failed','payload':{'payment':{'entity':{'id':'pay_E2E2','order_id':'order_E2E2'}}}}).encode()
    sql(f"insert into payments (user_id, gateway, gateway_order_id, amount_minor, currency, status, plan_id) values ('{uid}','razorpay','order_E2E2',499,'USD','created','single') on conflict do nothing")
    s,_=req('/api/payments/webhook', raw=fb, headers={'X-Razorpay-Signature':hmac.new(b'whsec_test', fb, hashlib.sha256).hexdigest()}); ok(s==200 and sql("select status from payments where gateway_order_id='order_E2E2'")=='failed', 'payment.failed recorded')
print('ALL PAYMENT CHECKS PASSED ('+MODE+')')
