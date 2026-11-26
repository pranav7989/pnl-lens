#!/usr/bin/env node
/**
 * @file  tests/visual/compare.mjs
 * @area  Tests
 * @what  Pixel comparison of two screenshot folders (from capture.mjs); writes diff images and prints the share of changed pixels per page.
 */
/** Usage: node tests/visual/compare.mjs <beforeDir> <afterDir> [diffDir]. No extra dependency: decoding and diffing run in Chromium. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const [a, b, out = path.join(b, '..', 'diff')] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const rows = [];
for (const f of fs.readdirSync(a).filter((x) => x.endsWith('.png')).sort()) {
  if (!fs.existsSync(path.join(b, f))) { rows.push({ page: f, result: 'missing in after' }); continue; }
  const r = await page.evaluate(async ([x, y]) => {
    const load = (d) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + d; });
    const [i1, i2] = await Promise.all([load(x), load(y)]);
    const w = Math.max(i1.width, i2.width), h = Math.max(i1.height, i2.height);
    const px = (img) => { const c = new OffscreenCanvas(w, h); const g = c.getContext('2d'); g.fillStyle = '#ff00ff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
    const d1 = px(i1), d2 = px(i2);
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d'), out = g.createImageData(w, h);
    let diff = 0;
    for (let k = 0; k < d1.length; k += 4) {
      const delta = Math.abs(d1[k] - d2[k]) + Math.abs(d1[k + 1] - d2[k + 1]) + Math.abs(d1[k + 2] - d2[k + 2]);
      const on = delta > 48; if (on) diff++;
      out.data[k] = on ? 255 : d1[k] * 0.3; out.data[k + 1] = on ? 0 : d1[k + 1] * 0.3; out.data[k + 2] = on ? 0 : d1[k + 2] * 0.3; out.data[k + 3] = 255;
    }
    g.putImageData(out, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let k = 0; k < buf.length; k++) s += String.fromCharCode(buf[k]);
    return { size: `${i1.width}x${i1.height} -> ${i2.width}x${i2.height}`, changed: diff / (w * h), png: btoa(s) };
  }, [fs.readFileSync(path.join(a, f)).toString('base64'), fs.readFileSync(path.join(b, f)).toString('base64')]);
  fs.writeFileSync(path.join(out, f), Buffer.from(r.png, 'base64'));
  rows.push({ page: f, size: r.size, changedPct: +(r.changed * 100).toFixed(3) });
}
await browser.close();
console.table(rows);
