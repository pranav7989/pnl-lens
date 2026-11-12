/**
 * @file  apps/api/src/lib/plan-pdf.ts
 * @area  Reports
 * @what  Renders a 30-day plan (packages/shared/src/plan) as the 2-page A4 PDF of the owner's sample: Do/Don't cards, scorecard, weekly check-in, check-up box with links.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { Plan, PlanRule } from '@pnl-lens/shared/plan';

// A4 in points; layout measured from docs/screenshots/plan/sample.pdf
const PW = 595.28, PH = 841.89, X = 37, W = PW - 2 * X;
const C = {
  bg: '#000000', card: '#171717', strip: '#0B0B0B', line: '#2A2A2A', y: '#FFD60A', yDeep: '#F2C800',
  red: '#FF6961', white: '#FFFFFF', text: '#E6E6E6', muted: '#9A9A9A', faint: '#6E6E6E', ink: '#0A0A0A',
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtLong = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(d)} ${MON[Number(m) - 1]} ${y}`; };
const fmtShort = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(d)} ${MON[Number(m) - 1]}`; };
/** 27-Oct-26, as in the sample header and the file name */
export const planDateLabel = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}-${MON[Number(m) - 1]}-${y.slice(2)}`; };

function fontsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tries = [process.env.PLAN_FONTS_DIR, path.resolve(here, '../assets/fonts'), path.resolve(here, '../../assets/fonts')].filter(Boolean) as string[];
  const hit = tries.find((d) => fs.existsSync(path.join(d, 'manrope-400.ttf')));
  if (!hit) throw new Error('plan fonts not found');
  return hit;
}

type Doc = PDFKit.PDFDocument;
type Font = 'R' | 'S' | 'B';

/** text in one of the three Manrope weights (each carries the ₹ glyph, see assets/fonts/README.md) */
function rich(doc: Doc, s: string, font: Font, opts: PDFKit.Mixins.TextOptions & { x?: number; y?: number } = {}) {
  const { x, y, ...o } = opts;
  doc.font(font);
  const t = nb(s);
  if (x !== undefined) doc.text(t, x, y, o); else doc.text(t, o);
}
/** a minus sign stays with its amount: U+2060 (zero-width word joiner, added to the fonts) after "−" */
const nb = (s: string) => s.replace(/−(?=[₹$€£\d])/g, '−\u2060');
const hRich = (doc: Doc, s: string, font: Font, size: number, width: number, lineGap = 0) => doc.font(font).fontSize(size).heightOfString(nb(s), { width, lineGap });
const wRich = (doc: Doc, s: string, font: Font, size: number) => doc.font(font).fontSize(size).widthOfString(nb(s));

function logo(doc: Doc, x: number, y: number, s: number) {
  const k = s / 32;
  doc.save().translate(x, y).scale(k);
  doc.roundedRect(0, 0, 32, 32, 8).fill(C.y);
  doc.roundedRect(7, 17, 4, 8, 2).fill(C.ink).roundedRect(14, 13, 4, 12, 2).fill(C.ink).roundedRect(21, 9, 4, 16, 2).fill(C.ink);
  doc.lineWidth(2).lineCap('round').lineJoin('round').strokeColor(C.ink);
  doc.moveTo(6, 14.5).lineTo(13, 9.5).lineTo(17, 11.5).lineTo(24.5, 5.5).stroke();
  doc.moveTo(20.5, 5.2).lineTo(24.8, 5.2).lineTo(24.8, 9.4).stroke();
  doc.restore();
}
function tick(doc: Doc, cx: number, cy: number, s: number, color: string, w = 1.4) {
  doc.save().lineWidth(w).lineCap('round').lineJoin('round').strokeColor(color)
    .moveTo(cx - s * 0.5, cy).lineTo(cx - s * 0.12, cy + s * 0.38).lineTo(cx + s * 0.55, cy - s * 0.4).stroke().restore();
}
function cross(doc: Doc, cx: number, cy: number, s: number, color: string, w = 1.3) {
  doc.save().lineWidth(w).lineCap('round').strokeColor(color)
    .moveTo(cx - s / 2, cy - s / 2).lineTo(cx + s / 2, cy + s / 2).moveTo(cx + s / 2, cy - s / 2).lineTo(cx - s / 2, cy + s / 2).stroke().restore();
}
function arrow(doc: Doc, x: number, cy: number, color: string) {
  doc.save().lineWidth(0.8).lineCap('round').lineJoin('round').strokeColor(color)
    .moveTo(x, cy).lineTo(x + 6, cy).moveTo(x + 3.6, cy - 2.4).lineTo(x + 6, cy).lineTo(x + 3.6, cy + 2.4).stroke().restore();
}
function checkbox(doc: Doc, x: number, y: number, s = 8.5) {
  doc.save().lineWidth(0.8).strokeColor('#5A5A5A').roundedRect(x, y, s, s, 2).stroke().restore();
}

function page(doc: Doc, n: number, right: [string, string], links: { site: string }) {
  doc.addPage({ size: 'A4', margin: 0 });
  doc.rect(0, 0, PW, PH).fill(C.bg);
  logo(doc, X, 38, 22);
  doc.fillColor(C.white).font('B').fontSize(12.5).text('PnL Lens', X + 29, 43, { lineBreak: false });
  doc.font('R').fontSize(7.6).fillColor(C.muted);
  const w1 = doc.widthOfString(right[0]);
  doc.font('S').fillColor(C.y).text(right[0], X + W - w1, 39, { lineBreak: false });
  doc.font('R').fillColor(C.muted).text(right[1], X, 50.5, { width: W, align: 'right', lineBreak: false });
  doc.moveTo(X, 68).lineTo(X + W, 68).lineWidth(0.5).strokeColor(C.line).stroke();
  // footer
  doc.moveTo(X, 805).lineTo(X + W, 805).lineWidth(0.5).strokeColor(C.line).stroke();
  doc.font('R').fontSize(6.4).fillColor(C.faint).text('Analysis of your own past trades. Not investment advice.', X, 811, { lineBreak: false });
  const site = 'pnllens.com', sw = doc.widthOfString(site), sx = X + W * 0.68;
  doc.fillColor(C.muted).text(site, sx, 811, { lineBreak: false, link: links.site });
  doc.text(`${n} / 2`, X, 811, { width: W, align: 'right', lineBreak: false });
  void sw;
}

function title(doc: Doc, a: string, b: string, y: number) {
  doc.font('B').fontSize(23).fillColor(C.white).text(a, X, y, { continued: true, lineBreak: false }).fillColor(C.y).text(b, { lineBreak: false });
}

/* ---------------------------------------------------------------- page 1: rule cards */
const CW = (W - 10) / 2, PAD = 10, TX = 33; // card text starts after the icon
function cardHeight(doc: Doc, r: PlanRule, n: number): { h: number; strip2: boolean } {
  const tw = CW - TX - PAD;
  const th = hRich(doc, `${n}. ${r.title}`, 'B', 9.6, tw, 1);
  const wh = hRich(doc, `Why: ${r.why}`, 'R', 8, tw, 1.6);
  const one = wRich(doc, `Now ${r.now}`, 'B', 7.8) + 18 + wRich(doc, `Target ${r.target}`, 'B', 7.8) + 12 <= tw;
  return { h: PAD + 3 + th + 4 + wh + 6 + (one ? 16 : 29) + PAD, strip2: !one };
}
function card(doc: Doc, r: PlanRule, n: number, x: number, y: number, h: number, strip2: boolean) {
  doc.roundedRect(x, y, CW, h, 8).fill(C.card);
  doc.roundedRect(x + 0.25, y + 0.25, CW - 0.5, h - 0.5, 8).lineWidth(0.5).strokeColor('#232323').stroke();
  const ix = x + PAD + 7.5, iy = y + PAD + 9;
  if (r.kind === 'do') { doc.circle(ix, iy, 7.5).fill(C.y); tick(doc, ix, iy, 6, C.ink, 1.3); }
  else { doc.circle(ix, iy, 7.2).lineWidth(0.9).strokeColor(C.red).stroke(); cross(doc, ix, iy, 4.2, C.red, 1); }
  const tx = x + TX, tw = CW - TX - PAD;
  doc.fillColor(C.white).fontSize(9.6);
  rich(doc, `${n}. ${r.title}`, 'B', { x: tx, y: y + PAD + 3, width: tw, lineGap: 1 });
  let cy = doc.y + 4;
  doc.fontSize(8).fillColor('#BDBDBD').font('S').text('Why: ', tx, cy, { width: tw, lineGap: 1.6, continued: true });
  doc.fillColor(C.muted);
  rich(doc, r.why, 'R', { width: tw, lineGap: 1.6 });
  cy = doc.y + 6;
  const sh = strip2 ? 29 : 16;
  const nowW = wRich(doc, `Now ${r.now}`, 'B', 7.8);
  const tgtW = wRich(doc, `Target ${r.target}`, 'B', 7.8);
  const sw = strip2 ? tw : Math.min(tw, nowW + tgtW + 30);
  doc.roundedRect(tx, cy, sw, sh, 4).fill(C.strip);
  const row = (label: string, val: string, x0: number, y0: number) => {
    doc.fontSize(7.8).fillColor(C.muted).font('R').text(label + ' ', x0, y0, { continued: true, lineBreak: false });
    doc.fillColor(C.white); rich(doc, val, 'B', { lineBreak: false });
  };
  row('Now', r.now, tx + 5, cy + 4.3);
  if (strip2) { arrow(doc, tx + 9 + nowW, cy + 8.3, C.muted); row('Target', r.target, tx + 5, cy + 17.3); }
  else { arrow(doc, tx + 9 + nowW, cy + 8.3, C.muted); row('Target', r.target, tx + 21 + nowW, cy + 4.3); }
}

function page1(doc: Doc, plan: Plan, site: string) {
  page(doc, 1, ['30-Day Plan', `Generated ${planDateLabel(plan.generatedAt)}`], { site });
  title(doc, 'Your do’s and don’ts ', 'for the next 30 days.', 82);
  doc.fillColor(C.muted).fontSize(8.6);
  rich(doc, plan.intro, 'R', { x: X, y: 117, width: W, lineGap: 2.2 });
  const hy = Math.max(doc.y + 10, 146);
  // column headers
  doc.roundedRect(X, hy, CW, 27, 7).fill(C.y);
  tick(doc, X + 14, hy + 13.5, 6, C.ink, 1.6);
  doc.font('B').fontSize(10.5).fillColor(C.ink).text('Do', X + 22, hy + 7.5, { lineBreak: false });
  const rx = X + CW + 10;
  doc.roundedRect(rx, hy, CW, 27, 7).fill('#121212');
  doc.roundedRect(rx + 0.4, hy + 0.4, CW - 0.8, 26.2, 7).lineWidth(0.8).strokeColor(C.red).stroke();
  cross(doc, rx + 14, hy + 13.5, 5, C.red, 1.3);
  doc.font('B').fontSize(10.5).fillColor(C.white).text('Don’t', rx + 25, hy + 7.5, { lineBreak: false });
  // cards; shrink the gap if a long plan would run into the footer
  const sizes = (rs: PlanRule[]) => rs.map((r, i) => cardHeight(doc, r, i + 1));
  const ds = sizes(plan.dos), ns = sizes(plan.donts);
  const tall = Math.max(ds.reduce((s, c) => s + c.h, 0), ns.reduce((s, c) => s + c.h, 0));
  const top = hy + 34, room = 770 - top;
  const gap = Math.max(4, Math.min(8, (room - tall) / 4));
  let ly = top, ry = top;
  plan.dos.forEach((r, i) => { card(doc, r, i + 1, X, ly, ds[i].h, ds[i].strip2); ly += ds[i].h + gap; });
  plan.donts.forEach((r, i) => { card(doc, r, i + 1, rx, ry, ns[i].h, ns[i].strip2); ry += ns[i].h + gap; });
  doc.font('R').fontSize(7.4).fillColor(C.faint)
    .text('These rules are about your habits, drawn only from your past trades. They are not tips on what to buy or sell.', X, Math.max(ly, ry) + 6, { width: W });
}

/* ---------------------------------------------------------------- page 2: scorecard, weekly check-in, check-up */
function page2(doc: Doc, plan: Plan, links: { remind: string; calendar: string; upload: string; site: string }, period: string) {
  page(doc, 2, ['30-Day Plan', 'Scorecard and check-up'], { site: links.site });
  title(doc, 'Your 30-day ', 'scorecard.', 82);
  doc.font('R').fontSize(8.6).fillColor(C.muted)
    .text('Your number today and the target for each habit. At your check-up, upload your new statement to see how each one moved.', X, 117, { width: W, lineGap: 2 });
  // table
  const ty = 138, rh = 19.5, head = 18, rows = plan.scorecard;
  const th = head + rows.length * rh;
  const cx = [X + 7, X + W * 0.36, X + W * 0.6, X + W * 0.9];
  doc.roundedRect(X, ty, W, th, 8).fill('#121212');
  doc.font('S').fontSize(6.6).fillColor(C.muted);
  ['HABIT', `NOW${period ? ` (${period.toUpperCase()})` : ''}`, 'TARGET (NEXT 30 DAYS)', 'MET?']
    .forEach((h, i) => doc.text(h, cx[i], ty + 6.5, { lineBreak: false, characterSpacing: 0.6 }));
  rows.forEach((r, i) => {
    const y = ty + head + i * rh;
    doc.moveTo(X, y).lineTo(X + W, y).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.fontSize(8.4).fillColor(C.text); rich(doc, r.habit, 'R', { x: cx[0], y: y + 5.6, width: cx[1] - cx[0] - 8, lineBreak: false, ellipsis: true, height: 11 });
    doc.fillColor(C.text); rich(doc, r.now, 'R', { x: cx[1], y: y + 5.6, width: cx[2] - cx[1] - 8, lineBreak: false, ellipsis: true, height: 11 });
    doc.fillColor(C.y); rich(doc, r.target, 'R', { x: cx[2], y: y + 5.6, width: cx[3] - cx[2] - 8, lineBreak: false, ellipsis: true, height: 11 });
    checkbox(doc, cx[3], y + 5.3);
  });
  doc.roundedRect(X + 0.25, ty + 0.25, W - 0.5, th - 0.5, 8).lineWidth(0.5).strokeColor(C.line).stroke();
  // weekly check-in
  let y = ty + th + 12;
  doc.roundedRect(X, y + 1, 2.6, 11, 1.3).fill(C.y);
  doc.font('B').fontSize(11).fillColor(C.white).text('Weekly check-in', X + 9, y, { lineBreak: false });
  y += 20;
  const ww = (W - 3 * 6.5) / 4, iw = ww - 16 - 13;
  const itemH = plan.weekly.map((t) => doc.font('R').fontSize(7.2).heightOfString(t, { width: iw, lineGap: 0.6 }) + 4.6);
  const wh = 12 + 16 + itemH.reduce((s, h) => s + h, 0) + 6;
  for (let k = 0; k < 4; k++) {
    const wx = X + k * (ww + 6.5);
    doc.roundedRect(wx, y, ww, wh, 8).fill(C.card);
    doc.font('B').fontSize(8.6).fillColor(C.y).text(`Week ${k + 1}`, wx + 8, y + 9, { lineBreak: false });
    let iy = y + 25;
    plan.weekly.forEach((t, i) => {
      checkbox(doc, wx + 8, iy + 0.4, 8);
      doc.font('R').fontSize(7.2).fillColor(C.text).text(t, wx + 21, iy, { width: iw, lineGap: 0.6 });
      iy += itemH[i];
    });
  }
  doc.font('R').fontSize(7.4).fillColor(C.faint)
    .text('Tick each box at the end of the week. Two honest minutes every Friday are enough.', X, y + wh + 8, { width: W });
  // check-up box
  const by = 610, bh = 167;
  doc.roundedRect(X, by, W, bh, 14).fill(C.y);
  doc.font('B').fontSize(7.2).fillColor(C.ink).text('YOUR NEXT CHECK-UP', X + 15, by + 19, { characterSpacing: 1, lineBreak: false });
  doc.font('B').fontSize(20.5).text(`See you in 30 days: ${fmtLong(plan.checkupOn)}.`, X + 15, by + 34, { lineBreak: false });
  doc.font('S').fontSize(8.6).text('Come back with next month’s P&L statement or tradebook. Your new report shows how each of these numbers moved, and you get a fresh plan for the month after.', X + 15, by + 66, { width: W - 120, lineGap: 2 });
  let bx = X + 15; const bty = by + 101, bht = 24;
  const button = (label: string, url: string, filled: boolean) => {
    doc.font('B').fontSize(8.4);
    const w = doc.widthOfString(label) + 22;
    if (filled) doc.roundedRect(bx, bty, w, bht, 6).fill(C.ink);
    else doc.roundedRect(bx + 0.4, bty + 0.4, w - 0.8, bht - 0.8, 6).lineWidth(0.9).strokeColor(C.ink).stroke();
    doc.fillColor(filled ? C.y : C.ink).text(label, bx + 11, bty + 7.3, { lineBreak: false });
    doc.link(bx, bty, w, bht, url);
    bx += w + 6.5;
  };
  button(`Remind me on ${fmtShort(plan.checkupOn)}`, links.remind, true);
  button('Add to calendar', links.calendar, false);
  button('Upload when ready', links.upload, false);
  bx = X + 15;
  for (const s of ['1 · Upload next month’s statement', '2 · Compare your numbers', '3 · Get your next plan']) {
    doc.font('S').fontSize(7.4);
    const w = doc.widthOfString(s) + 14;
    doc.roundedRect(bx, by + 133, w, 17, 5).fill(C.yDeep);
    doc.fillColor(C.ink).text(s, bx + 7, by + 137.6, { lineBreak: false });
    bx += w + 6;
  }
}

export interface PlanPdfInput { plan: Plan; reportId: string; appUrl: string }

export function planLinks(appUrl: string, reportId: string, checkupOn: string) {
  const base = appUrl.replace(/\/+$/, '');
  return {
    remind: `${base}/reminders/new?report=${encodeURIComponent(reportId)}&date=${checkupOn}`,
    calendar: `${base}/api/v1/plan.ics?date=${checkupOn}`,
    upload: `${base}/upload`,
    site: base,
  };
}

/** builds the PDF in memory (a plan is ~60 KB) */
export function renderPlanPdf({ plan, reportId, appUrl }: PlanPdfInput): Promise<Buffer> {
  const dir = fontsDir();
  const doc = new PDFDocument({
    autoFirstPage: false, size: 'A4', margin: 0, compress: true,
    info: { Title: 'PnL Lens 30-Day Plan', Author: 'PnL Lens', Subject: 'Your do’s and don’ts for the next 30 days', Creator: 'PnL Lens' },
  });
  doc.registerFont('R', path.join(dir, 'manrope-400.ttf'));
  doc.registerFont('S', path.join(dir, 'manrope-600.ttf'));
  doc.registerFont('B', path.join(dir, 'manrope-800.ttf'));
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const links = planLinks(appUrl, reportId, plan.checkupOn);
  page1(doc, plan, links.site);
  page2(doc, plan, links, plan.period);
  doc.end();
  return done;
}
