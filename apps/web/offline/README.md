# Offline single-file build

`pnl_lens_app_offline.html` is the landing page plus a fully local upload → report tool in one file
(no server, login, payments or internet). Built from the same engine (`lib/engine/engine.js`) and
report renderer (`lib/report-ui/render.js`) as the website, plus the files in this folder:

- `app_markup.html` — upload and report screens
- `app_offline.js` — routing (#app), file reading, column mapper, CSV/PDF
- `app_offline.css` — shell styles

To rebuild: run the production server, fetch `/` (with `X-Country: IN` for rupee pricing), inline its CSS
and font, strip Next's scripts, point start links at `#app`, and append SheetJS, the engine (exposed as
`window.PnlEngine`), the renderer (`window.mountReport`) and `app_offline.js`.
