<!--
@file  apps/api/assets/fonts/README.md
@area  Reports
@what  Fonts embedded in the 30-day plan PDF: static Manrope instances with the ₹ glyph added.
-->
# Plan PDF fonts

`manrope-400.ttf`, `manrope-600.ttf`, `manrope-800.ttf` are static instances of the site's variable Manrope
(`apps/web/app/fonts/manrope.woff2`, SIL OFL 1.1, no reserved font name; `OFL-Manrope.txt`), cut with
`fonttools varLib.instancer` at wght 400/600/800. Manrope has no ₹ sign, so the DejaVu Sans ₹ glyph
(`apps/web/app/fonts/rupee-*.woff2`; `LICENSE-DejaVu.txt`) was scaled to Manrope's 2000 units per em and added
as `U+20B9` (regular from DejaVu Sans, 600/800 from DejaVu Sans Bold), plus an empty zero-width `U+2060` (word joiner) so "−₹1,234" never breaks after the minus. One font per weight keeps "₹1,234" from
ever breaking across a line in pdfkit.
