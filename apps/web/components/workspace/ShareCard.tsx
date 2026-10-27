/**
 * @file  apps/web/components/workspace/ShareCard.tsx
 * @area  Reports
 * @what  "Share progress": a 1080×1350 image of the level, score and up to 4 stats the user picks (percentages and verdicts only, no money, no name), drawn in the browser; download it or share it from the phone.
 */
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { shareCard, type ShareKey, type ShareCardData } from '@pnl-lens/shared/insights/share';

const W = 1080, H = 1350, Y = '#FFD60A', INK = '#0A0A0A';
const LABEL: Record<ShareKey, string> = { winRate: 'Trades won', edge: 'Skill or luck', plan: '30-day plan', greenDays: 'Green days', payoff: 'Win ÷ loss size', return: 'Return on capital' };

function fontFamily(): string {
  const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--f-sans').trim() : '';
  return `${v ? v + ', ' : ''}"Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
}

/** draws the card; pure canvas, nothing leaves the browser until the user downloads or shares it */
export function drawCard(cv: HTMLCanvasElement, d: ShareCardData) {
  const ctx = cv.getContext('2d'); if (!ctx) return;
  const F = fontFamily();
  cv.width = W; cv.height = H;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 120, 120, 40, W - 120, 120, 700);
  glow.addColorStop(0, 'rgba(255,214,10,0.22)'); glow.addColorStop(1, 'rgba(255,214,10,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  // logo (same artwork as the site's mark)
  const lx = 80, ly = 80, s = 72 / 32;
  ctx.save(); ctx.translate(lx, ly); ctx.scale(s, s);
  ctx.fillStyle = Y; ctx.beginPath(); ctx.roundRect(0, 0, 32, 32, 8); ctx.fill();
  ctx.fillStyle = INK; for (const [x, y, h] of [[7, 17, 8], [14, 13, 12], [21, 9, 16]]) { ctx.beginPath(); ctx.roundRect(x, y, 4, h, 2); ctx.fill(); }
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(6, 14.5); ctx.lineTo(13, 9.5); ctx.lineTo(17, 11.5); ctx.lineTo(24.5, 5.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20.5, 5.2); ctx.lineTo(24.8, 5.2); ctx.lineTo(24.8, 9.4); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = `800 44px ${F}`; ctx.textBaseline = 'middle'; ctx.fillText('PnL Lens', lx + 92, ly + 37);
  // heading
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = Y; ctx.font = `700 30px ${F}`; ctx.fillText('MY TRADING PROGRESS', 80, 270);
  ctx.fillStyle = '#9A9A9A'; ctx.font = `500 32px ${F}`; ctx.fillText([d.period, `${d.trades} trades`].filter(Boolean).join(' · '), 80, 318);
  // level and score ring
  ctx.fillStyle = '#fff'; ctx.font = `800 ${(d.level || '').length > 11 ? 92 : 110}px ${F}`; ctx.fillText(d.level || 'My report', 80, 470);
  if (d.nextLevel) { ctx.fillStyle = '#9A9A9A'; ctx.font = `500 32px ${F}`; ctx.fillText(`Next level: ${d.nextLevel}`, 80, 525); }
  if (d.score !== null) {
    const cx = W - 220, cy = 410, r = 120;
    ctx.lineWidth = 26; ctx.lineCap = 'round';
    ctx.strokeStyle = '#1D1D20'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = Y; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.max(0, Math.min(100, d.score)) / 100) * Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `800 84px ${F}`; ctx.fillText(String(Math.round(d.score)), cx, cy + 22);
    ctx.fillStyle = '#9A9A9A'; ctx.font = `500 28px ${F}`; ctx.fillText('out of 100', cx, cy + 66); ctx.textAlign = 'left';
  }
  // stat tiles, 2 × 2
  const tw = (W - 160 - 32) / 2, th = 230;
  const items = d.items.slice(0, 4);
  items.forEach((it, i) => {
    // an odd last tile spans the full width
    const w = i === items.length - 1 && items.length % 2 === 1 ? W - 160 : tw;
    const x = 80 + (i % 2) * (tw + 32), y = 640 + Math.floor(i / 2) * (th + 32);
    ctx.fillStyle = '#121214'; ctx.beginPath(); ctx.roundRect(x, y, w, th, 28); ctx.fill();
    ctx.strokeStyle = '#26262A'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x + 1, y + 1, w - 2, th - 2, 27); ctx.stroke();
    ctx.fillStyle = '#9A9A9A'; ctx.font = `600 30px ${F}`; ctx.fillText(it.label.toUpperCase(), x + 36, y + 70);
    let size = 64; ctx.font = `800 ${size}px ${F}`;
    while (ctx.measureText(it.value).width > w - 72 && size > 34) { size -= 4; ctx.font = `800 ${size}px ${F}`; }
    ctx.fillStyle = it.key === 'edge' && /negative/i.test(it.value) ? '#FF6961' : '#fff'; ctx.fillText(it.value, x + 36, y + 160);
  });
  // footer
  ctx.fillStyle = '#6E6E73'; ctx.font = `500 28px ${F}`; ctx.fillText('Analysis of my own trades. Not investment advice.', 80, H - 90);
  ctx.fillStyle = Y; ctx.font = `700 34px ${F}`; ctx.textAlign = 'right'; ctx.fillText('pnllens.com', W - 80, H - 88); ctx.textAlign = 'left';
}

export default function ShareCard({ report, planCheck, capital, onUsed }: { report: any; planCheck?: { met: number; measured: number } | null; capital?: number | null; onUsed?: (how: 'download' | 'share') => void }) {
  const [open, setOpen] = useState(false);
  const base = useMemo(() => shareCard(report, { planCheck, capital }), [report, planCheck, capital]);
  const [include, setInclude] = useState<ShareKey[]>(() => base.items.map((i) => i.key));
  const data = useMemo(() => shareCard(report, { planCheck, capital, include }), [report, planCheck, capital, include]);
  const cv = useRef<HTMLCanvasElement>(null);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    if (!open || !cv.current) return;
    let live = true;
    (document.fonts?.ready ?? Promise.resolve()).then(() => { if (live && cv.current) drawCard(cv.current, data); });
    return () => { live = false; };
  }, [open, data]);
  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })); }, []);
  const blob = () => new Promise<Blob | null>((res) => cv.current?.toBlob(res, 'image/png'));
  async function download() {
    const b = await blob(); if (!b) return;
    const url = URL.createObjectURL(b), a = document.createElement('a');
    a.href = url; a.download = 'pnl-lens-progress.png'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000); onUsed?.('download');
  }
  async function share() {
    const b = await blob(); if (!b) return;
    try { await navigator.share({ files: [new File([b], 'pnl-lens-progress.png', { type: 'image/png' })], text: 'My trading progress on PnL Lens' }); onUsed?.('share'); } catch { /* cancelled */ }
  }
  const toggle = (k: ShareKey) => setInclude((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : cur.length >= 4 ? cur : [...cur, k]));

  return (
    <>
      <button type="button" className="btn ghost" onClick={() => setOpen(true)} data-share-open>Share progress</button>
      {open && (
        <div className="sc-backdrop" role="dialog" aria-modal="true" aria-label="Share your progress" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="sc-dialog" data-share>
            <div className="sc-head"><h3>Share your progress</h3><button type="button" className="btn ghost" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
            <p className="muted sc-note">Only percentages, scores and your level: no money amounts, no names, no symbols. Pick up to 4 stats.</p>
            <div className="rw-chips sc-pick">{base.available.map((k) => (
              <button key={k} type="button" className={`rw-chip${include.includes(k) ? ' on' : ''}`} aria-pressed={include.includes(k)} onClick={() => toggle(k)}>{LABEL[k]}</button>
            ))}</div>
            <canvas ref={cv} className="sc-canvas" width={W} height={H} role="img" aria-label={`Progress card: ${data.level ?? ''} ${data.score ?? ''}/100; ${data.items.map((i) => `${i.label} ${i.value}`).join('; ')}`} />
            <ul className="sc-items" data-share-items>{data.items.map((i) => <li key={i.key}>{i.label}: {i.value}</li>)}</ul>
            <div className="sc-actions">
              <button type="button" className="btn" onClick={download} data-share-download>Download image</button>
              {canShare && <button type="button" className="btn ghost" onClick={share}>Share…</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
