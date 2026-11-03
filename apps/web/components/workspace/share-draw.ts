/**
 * @file  apps/web/components/workspace/share-draw.ts
 * @area  Reports
 * @what  Draws the "My Trading Discipline" share card on a canvas (card 1080×1728 or story 1080×1920) from shareCard()'s data; all text, colours and geometry come from packages/shared/src/insights/share.ts. No React, so tests can draw it on a plain page.
 */
import { CARD, STORY, COLORS, TEXT, LAYOUT, SLOT_STYLE, COPY, type ShareCardData, type PlacedTile, type TileKey } from '@pnl-lens/shared/insights/share';
import { SHARE_QR } from '@pnl-lens/shared/insights/share-qr';

export type ShareFormat = 'card' | 'story';
export interface ShareUse { how: 'download' | 'share'; format: ShareFormat; hero: TileKey; tiles: TileKey[]; badge: boolean }
type Ctx = CanvasRenderingContext2D;

function fontFamily(): string {
  const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--f-sans').trim() : '';
  return `${v ? v + ', ' : ''}"Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
}
const font = (F: string, s: { weight: number }, size: number) => `${s.weight} ${size}px ${F}`;
const rgba = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
function spacing(ctx: Ctx, em: number, size: number) { if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${(em * size).toFixed(1)}px`; }

/**
 * Biggest size (step 4, down to the minimum) at which the value fits in maxW × room: on one line, or on two lines
 * when that allows a bigger size (a long hero like "4 OF 5 RULES KEPT").
 */
function fitValue(ctx: Ctx, F: string, text: string, maxW: number, room: number): { size: number; lines: string[] } {
  const V = TEXT.value;
  const largest = (lines: string[], cap: number) => {
    for (let s = Math.min(cap, V.size); s >= V.min; s -= V.step) {
      ctx.font = font(F, V, s);
      if (lines.every((l) => ctx.measureText(l).width <= maxW)) return s;
    }
    return 0;
  };
  let best = { size: largest([text], room), lines: [text] };
  const words = text.split(' ');
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const size = largest(lines, Math.floor(room / 2.04));
    if (size > best.size) best = { size, lines };
  }
  return best.size ? best : { size: V.min, lines: [text] };
}

function logo(ctx: Ctx, x: number, y: number, size: number) {
  const s = size / 32;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = COLORS.yellow; ctx.beginPath(); ctx.roundRect(0, 0, 32, 32, 8); ctx.fill();
  ctx.fillStyle = COLORS.ink; for (const [bx, by, h] of [[7, 17, 8], [14, 13, 12], [21, 9, 16]]) { ctx.beginPath(); ctx.roundRect(bx, by, 4, h, 2); ctx.fill(); }
  ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(6, 14.5); ctx.lineTo(13, 9.5); ctx.lineTo(17, 11.5); ctx.lineTo(24.5, 5.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20.5, 5.2); ctx.lineTo(24.8, 5.2); ctx.lineTo(24.8, 9.4); ctx.stroke();
  ctx.restore();
}
function star(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); }
  ctx.closePath(); ctx.fill();
}
function trophy(ctx: Ctx, x: number, y: number, s: number) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 48, s / 48);
  ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(12, 4); ctx.lineTo(36, 4); ctx.lineTo(36, 18); ctx.bezierCurveTo(36, 26, 30, 31, 24, 31); ctx.bezierCurveTo(18, 31, 12, 26, 12, 18); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(12, 8); ctx.lineTo(4, 8); ctx.bezierCurveTo(4, 17, 8, 21, 13, 21); ctx.moveTo(36, 8); ctx.lineTo(44, 8); ctx.bezierCurveTo(44, 17, 40, 21, 35, 21); ctx.stroke();
  ctx.fillRect(21, 31, 6, 7); ctx.beginPath(); ctx.roundRect(13, 38, 22, 6, 2); ctx.fill();
  ctx.restore();
}
function globe(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.save(); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.45, r, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
  ctx.restore();
}

function tile(ctx: Ctx, F: string, t: PlacedTile) {
  const st = SLOT_STYLE[t.slot], P = LAYOUT.pad, r = LAYOUT.radius;
  ctx.save();
  if (st.border) { ctx.shadowColor = rgba(st.border, LAYOUT.glowAlpha); ctx.shadowBlur = LAYOUT.glowBlur; }
  ctx.fillStyle = st.fill; ctx.beginPath(); ctx.roundRect(t.x, t.y, t.w, t.h, r); ctx.fill();
  ctx.restore();
  if (st.border) {
    const b = LAYOUT.border;
    ctx.strokeStyle = st.border; ctx.lineWidth = b; ctx.beginPath(); ctx.roundRect(t.x + b / 2, t.y + b / 2, t.w - b, t.h - b, r - b / 2); ctx.stroke();
  }
  const iconW = st.icon ? 64 : 0;
  if (st.icon) { ctx.fillStyle = st.value; ctx.strokeStyle = st.value; trophy(ctx, t.x + t.w - P - iconW, t.y + P - 4, iconW); }
  // label
  const L = TEXT.label;
  ctx.fillStyle = st.labelInk; ctx.textBaseline = 'alphabetic';
  // the label shrinks (to 22px) rather than being squeezed in a narrow tile
  const lw = t.w - P * 2 - iconW, ltext = t.label.toUpperCase();
  let ls = L.size; ctx.font = font(F, L, ls); spacing(ctx, L.spacing, ls);
  while (ctx.measureText(ltext).width > lw && ls > 22) { ls -= 1; ctx.font = font(F, L, ls); spacing(ctx, L.spacing, ls); }
  ctx.fillText(ltext, t.x + P, t.y + P + L.size, lw);
  spacing(ctx, 0, 0);
  // sub line
  const B = TEXT.body;
  const bottom = t.y + t.h - P;
  if (t.sub) { ctx.fillStyle = st.border ? COLORS.grey : st.labelInk; ctx.font = font(F, B, B.size); ctx.fillText(t.sub, t.x + P, bottom, t.w - P * 2); }
  // value: as big as fits between the label and the sub line
  const room = (t.sub ? bottom - B.size - 18 : bottom) - (t.y + P + L.size + 20);
  const f2 = fitValue(ctx, F, t.value.toUpperCase(), t.w - P * 2, room);
  const lh = Math.round(f2.size * 1.02);
  ctx.fillStyle = st.value; ctx.font = font(F, TEXT.value, f2.size);
  const base = t.sub ? bottom - B.size - 18 : bottom;
  f2.lines.forEach((l, i) => ctx.fillText(l, t.x + P, base - (f2.lines.length - 1 - i) * lh));
}

/** draws the card; pure canvas, nothing leaves the browser until the user downloads or shares it */
export function drawCard(cv: HTMLCanvasElement, d: ShareCardData, format: ShareFormat = 'card') {
  const ctx = cv.getContext('2d'); if (!ctx) return;
  const F = fontFamily(), S = format === 'story' ? STORY : CARD, L = LAYOUT;
  cv.width = S.w; cv.height = S.h;
  ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, S.w, S.h);
  const dy = Math.round((S.h - CARD.h) / 2);
  const glow = ctx.createRadialGradient(CARD.w - 120, dy + 120, 40, CARD.w - 120, dy + 120, 760);
  glow.addColorStop(0, rgba(COLORS.yellow, 0.22)); glow.addColorStop(1, rgba(COLORS.yellow, 0));
  ctx.fillStyle = glow; ctx.fillRect(0, 0, S.w, S.h);
  ctx.save(); ctx.translate(0, dy);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  // brand and period
  logo(ctx, L.logo.x, L.logo.y, L.logo.size);
  ctx.fillStyle = COLORS.white; ctx.font = font(F, TEXT.body, TEXT.body.size); ctx.fillText(COPY.brand, L.logo.x + L.logo.size + 20, L.periodY);
  if (d.period) { ctx.fillStyle = COLORS.grey; ctx.font = font(F, TEXT.small, TEXT.small.size); ctx.textAlign = 'right'; ctx.fillText(d.period, L.margin + L.width, L.periodY); ctx.textAlign = 'left'; }
  // title
  ctx.textBaseline = 'alphabetic';
  let ts = TEXT.display.size; ctx.font = font(F, TEXT.display, ts);
  while (ctx.measureText(COPY.title1).width > L.width && ts > 60) { ts -= 4; ctx.font = font(F, TEXT.display, ts); }
  ctx.fillStyle = COLORS.white; ctx.fillText(COPY.title1, L.title.x, L.title.line1);
  ctx.fillStyle = COLORS.yellow; ctx.fillText(COPY.title2, L.title.x, L.title.line2);
  // founding badge
  if (d.founding) {
    const b = L.badge;
    ctx.save(); ctx.shadowColor = rgba(COLORS.gold2, 0.45); ctx.shadowBlur = 28;
    const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h); g.addColorStop(0, COLORS.gold1); g.addColorStop(1, COLORS.gold2);
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, b.h / 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = COLORS.ink; star(ctx, b.x + 64, b.y + b.h / 2, 30);
    const tx = b.x + 116;
    ctx.font = font(F, TEXT.label, TEXT.label.size); spacing(ctx, TEXT.label.spacing, TEXT.label.size); ctx.fillText(COPY.founding, tx, b.y + 48); spacing(ctx, 0, 0);
    const f = fitValue(ctx, F, d.founding, b.w - (tx - b.x) - 40, 48);
    ctx.font = font(F, TEXT.value, f.size); ctx.fillText(d.founding, tx, b.y + 98);
  }
  // tiles
  for (const t of [d.hero, ...d.tiles]) tile(ctx, F, t);
  // footer: QR (dark modules on white, 4-module quiet zone), line, site, disclaimer
  const fy = L.footer.y, m = L.footer.qrModule, q = 4;
  ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.roundRect(L.margin, fy, L.footer.qr, L.footer.qr, 12); ctx.fill();
  ctx.fillStyle = '#000000';
  SHARE_QR.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '1') ctx.fillRect(L.margin + (x + q) * m, fy + (y + q) * m, m, m); });
  const fx = L.margin + L.footer.qr + 36;
  ctx.fillStyle = COLORS.white; ctx.font = font(F, TEXT.body, TEXT.body.size); ctx.fillText(COPY.footer, fx, L.footer.line1Y, L.margin + L.width - fx);
  ctx.strokeStyle = COLORS.yellow; globe(ctx, fx + 18, L.footer.urlY - 15, 17);
  ctx.fillStyle = COLORS.yellow; ctx.font = font(F, TEXT.body, TEXT.body.url); ctx.fillText(COPY.url, fx + 50, L.footer.urlY);
  // the disclaimer: on every card, never switched off
  ctx.fillStyle = COLORS.grey; ctx.font = font(F, TEXT.small, TEXT.small.size);
  ctx.fillText(d.disclaimer[0], fx, L.footer.noteY, L.margin + L.width - fx);
  ctx.fillText(d.disclaimer[1], fx, L.footer.note2Y, L.margin + L.width - fx);
  ctx.restore();
}
