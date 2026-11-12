/**
 * @file  tests/e2e-web/share-visual.spec.ts
 * @area  Tests
 * @what  Share card v2 pixels: the real drawing code (share-draw.ts) bundled onto a blank page with the site's Manrope, two golden reports as Card and Story compared with stored snapshots, and the QR on the drawn card decodes to the share URL. Needs no stack.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { buildSync } from 'esbuild';
import jsQR from 'jsqr';
import { SHARE_URL } from '../../packages/shared/src/insights/share-qr';

const ROOT = path.resolve(__dirname, '../..');
const golden = (id: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/engine/test/golden', `${id}.json`), 'utf8')).report;
const FONT = fs.readFileSync(path.join(ROOT, 'apps/web/app/fonts/manrope.woff2'));

let bundle = '';
test.beforeAll(() => {
  const out = buildSync({
    stdin: {
      contents: `import { shareCard } from '@pnl-lens/shared/insights/share';
        import { drawCard } from './apps/web/components/workspace/share-draw';
        (window as any).draw = (report: any, opts: any, format: 'card' | 'story') => {
          const c = document.createElement('canvas'); document.body.appendChild(c);
          drawCard(c, shareCard(report, opts), format);
          const qr = c.getContext('2d')!.getImageData(72, (format === 'story' ? 96 : 0) + 1500, 164, 164);
          return { png: c.toDataURL('image/png'), qr: Array.from(qr.data), w: c.width, h: c.height };
        };`,
      resolveDir: ROOT, loader: 'ts', sourcefile: 'share-visual-entry.ts',
    },
    bundle: true, format: 'iife', write: false, platform: 'browser', target: 'es2022',
  });
  bundle = out.outputFiles[0].text;
});

async function setup(page: Page) {
  await page.route('https://card.test/**', (route) => route.request().url().endsWith('.woff2')
    ? route.fulfill({ body: FONT, contentType: 'font/woff2' })
    : route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>
        @font-face { font-family: "Manrope"; src: url(/manrope.woff2) format("woff2"); font-weight: 200 800; }
        :root { --f-sans: "Manrope"; } body { margin: 0; background: #000; }</style></head><body></body></html>` }));
  await page.goto('https://card.test/');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(async () => { for (const w of [600, 700, 800]) await document.fonts.load(`${w} 32px Manrope`); });
}

const CASES = [
  { name: 'tradebook', id: 'zerodha_tradebook_csv', opts: { planCheck: { met: 4, measured: 5 }, foundingNo: 427 } },
  { name: 'fo-statement', id: 'zerodha_fo_statement_xlsx', opts: {} },
];

for (const c of CASES) {
  for (const format of ['card', 'story'] as const) {
    test(`share card v2 pixels: ${c.name} ${format}`, async ({ page }) => {
      await setup(page);
      const r = await page.evaluate(([rep, opts, f]) => (window as any).draw(rep, opts, f), [golden(c.id), c.opts, format] as const);
      expect([r.w, r.h]).toEqual(format === 'story' ? [1080, 1920] : [1080, 1728]);
      expect(jsQR(Uint8ClampedArray.from(r.qr), 164, 164)?.data).toBe(SHARE_URL);
      const png = Buffer.from(r.png.split(',')[1], 'base64');
      if (process.env.SHARE_CARD_OUT) fs.writeFileSync(path.join(process.env.SHARE_CARD_OUT, `${c.name}-${format}.png`), png);
      expect(png).toMatchSnapshot(`${c.name}-${format}.png`, { maxDiffPixelRatio: 0.01 });
    });
  }
}
