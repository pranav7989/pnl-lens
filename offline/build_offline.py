# @file  offline/build_offline.py
# @area  Offline
# @what  Builds the single-file offline sites/tool from a running server (--country, --other, --tool).
"""Builds the single-file offline app from a running production server (:3100) and the repo sources.
Usage: python3 offline/build_offline.py <output.html>"""
import re, sys, base64, urllib.request, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]; B = 'http://localhost:3100'
def get(u, hdr=None): return urllib.request.urlopen(urllib.request.Request(B + u, headers=hdr or {}), timeout=20).read()
def strip_exports(src):
    src = re.sub(r'^import .*?;\s*$', '', src, flags=re.M)
    src = re.sub(r'^export \{[^}]*\};?\s*$', '', src, flags=re.M)
    return re.sub(r'^export (const|function|async function|class|let) ', r'\1 ', src, flags=re.M).replace('// @ts-nocheck', '')
COUNTRY = next((a.split('=')[1] for a in sys.argv if a.startswith('--country=')), 'IN')
OTHER = next((a.split('=')[1] for a in sys.argv if a.startswith('--other=')), '')
html = get('/', {'X-Country': COUNTRY}).decode()
css = ''.join(get(h).decode() + '\n' for h in re.findall(r'<link rel="stylesheet" href="([^"]+)"', html))
css = re.sub(r'url\((/_next/static/media/[^)]+\.woff2)\)', lambda m: 'url(data:font/woff2;base64,' + base64.b64encode(get(m.group(1))).decode() + ')', css)
css += '\n' + (ROOT / 'offline/app_offline.css').read_text()
# engine (+ behaviour) → window.PnlEngine
beh = strip_exports((ROOT / 'lib/engine/behaviour.js').read_text())
eng_src = (ROOT / 'lib/engine/engine.js').read_text()
names = re.search(r'\nexport \{([^}]+)\};', eng_src).group(1)
eng = ('(function(){\nconst __beh = (function(){\n' + beh + '\nreturn { buildBehaviour, TRAITS };\n})();\nconst buildBehaviour = __beh.buildBehaviour;\n'
       + strip_exports(eng_src) + f'\nwindow.PnlEngine = {{ {names} }};\n}})();')
ext_src = (ROOT / 'lib/engine/extract.js').read_text()
ext = '(function(){\n' + strip_exports(ext_src) + '\nwindow.PnlExtract = { detectKind, fileToRawSheets };\n})();'
rend = strip_exports((ROOT / 'lib/report-ui/render.js').read_text()) + '\nwindow.mountReport = mountReport;'
loader = strip_exports((ROOT / 'lib/report-ui/loader.js').read_text()) + '\nwindow.withAnalysing = withAnalysing;'
xlsx = (ROOT / 'node_modules/xlsx/dist/xlsx.full.min.js').read_text()
b64 = lambda p: base64.b64encode((ROOT / p).read_bytes()).decode()
pdf_lib, pdf_worker = b64('node_modules/pdfjs-dist/legacy/build/pdf.min.mjs'), b64('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')
safe = lambda s: s.replace('</script', '<\\/script')
html = re.sub(r'<link rel="(stylesheet|preload)"[^>]*>', '', html)
# browser-tab icon: embed instead of linking to the server
icon = 'data:image/svg+xml;base64,' + base64.b64encode((ROOT / 'app/icon.svg').read_bytes()).decode()
html = re.sub(r'<link rel="icon"[^>]*>', '', html)
html = html.replace('</head>', f'<link rel="icon" type="image/svg+xml" href="{icon}"></head>', 1)
html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.S); html = re.sub(r'<script\b[^>]*/>', '', html)
html = re.sub(r'href="/login\?next=/upload&amp;plan=(\w+)"', r'href="?plan=\1#app"', html)
html = re.sub(r'href="/upload&amp;plan=(\w+)"', r'href="?plan=\1#app"', html)
for a in ['/login?next=/upload', '/upload', '/dashboard', '/login']: html = html.replace(f'href="{a}"', 'href="#app"')
if OTHER: html = re.sub(r'href="/\?region=(in|global)"', f'href="{OTHER}"', html)
html = html.replace('>Sign in<', '>Open the app<').replace('href="/"', 'href="#top"').replace('</title>', ' (offline)</title>', 1)
html = html.replace('</head>', f'<meta name="color-scheme" content="dark"><style>{css}\nbody{{margin:0;background:#000}}</style></head>')
markup = (ROOT / 'offline/app_markup.html').read_text()
landing_js = get('/landing.js').decode()
scripts = (f'<script type="text/plain" id="pdfjs-lib">{pdf_lib}</script><script type="text/plain" id="pdfjs-worker">{pdf_worker}</script>'
           + ''.join(f'<script>{safe(x)}</script>' for x in [landing_js, xlsx, eng, ext, loader, rend, (ROOT / 'offline/app_offline.js').read_text()]))
html = html.replace('</body>', markup + scripts + '</body>')
TOOL = '--tool' in sys.argv
if TOOL:  # upload tool only: no landing page, opens straight on the upload screen
    html = html.replace('</head>', '<style>.lp{display:none!important}.app-actions a[href="#top"],.app-local .brand{pointer-events:none}</style></head>')
    html = html.replace('</head>', '<script>if(location.hash!=="#app")history.replaceState(null,"","#app");addEventListener("hashchange",function(){if(location.hash!=="#app"){history.replaceState(null,"","#app");dispatchEvent(new HashChangeEvent("hashchange"))}});</script></head>', 1)
    html = html.replace('<a class="btn ghost" href="#top">Home</a>', '').replace(' (offline)</title>', ' — upload tool</title>')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
out = pathlib.Path(args[0] if args else 'pnl_lens_app_offline.html'); out.write_text(html)
print(f'wrote {out} ({len(html) // 1024} KB)')
