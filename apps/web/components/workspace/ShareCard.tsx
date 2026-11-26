/**
 * @file  apps/web/components/workspace/ShareCard.tsx
 * @area  Reports
 * @what  "Share progress": the "My Trading Discipline" card (habits and plan discipline only: no results, returns, money, names or securities; disclaimer always on) drawn on a canvas in the browser, as a 1080×1728 card or a 1080×1920 story; pick the hero and tiles, show or hide the founding badge, download or share.
 */
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { shareCard, CARD, STORY, COPY, CHIP, type TileKey } from '@pnl-lens/shared/insights/share';
import { drawCard, type ShareFormat, type ShareUse } from './share-draw';

export default function ShareCard({ report, planCheck, onUsed }: { report: any; planCheck?: { met: number; measured: number } | null; onUsed?: (u: ShareUse) => void }) {
  const [open, setOpen] = useState(false);
  const [foundingNo, setFoundingNo] = useState<number | null>(null);
  const [hero, setHero] = useState<TileKey | null>(null);
  const [exclude, setExclude] = useState<TileKey[]>([]);
  const [badge, setBadge] = useState(true);
  const [format, setFormat] = useState<ShareFormat>('card');
  const data = useMemo(() => shareCard(report, { planCheck, foundingNo, hero, exclude, badge }), [report, planCheck, foundingNo, hero, exclude, badge]);
  const cv = useRef<HTMLCanvasElement>(null);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch('/api/v1/me').then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && Number.isInteger(j?.foundingNo)) setFoundingNo(j.foundingNo); }).catch(() => {});
    return () => { live = false; };
  }, [open]);
  useEffect(() => {
    if (!open || !cv.current) return;
    let live = true;
    (document.fonts?.ready ?? Promise.resolve()).then(() => { if (live && cv.current) drawCard(cv.current, data, format); });
    return () => { live = false; };
  }, [open, data, format]);
  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })); }, []);
  const used = (how: ShareUse['how']) => onUsed?.({ how, format, hero: data.hero.key, tiles: data.tiles.map((t) => t.key), badge: !!data.founding });
  const blob = () => new Promise<Blob | null>((res) => cv.current?.toBlob(res, 'image/png'));
  const name = COPY.file[format];
  async function download() {
    const b = await blob(); if (!b) return;
    const url = URL.createObjectURL(b), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000); used('download');
  }
  async function share() {
    const b = await blob(); if (!b) return;
    try { await navigator.share({ files: [new File([b], name, { type: 'image/png' })], text: COPY.shareText }); used('share'); } catch { /* cancelled */ }
  }
  const shown = new Set<TileKey>(data.tiles.map((t) => t.key));
  const toggle = (k: TileKey) => setExclude((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const S = format === 'story' ? STORY : CARD;

  return (
    <>
      <button type="button" className="btn ghost" onClick={() => setOpen(true)} data-share-open>Share progress</button>
      {open && (
        <div className="sc-backdrop" role="dialog" aria-modal="true" aria-label="Share your progress" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="sc-dialog" data-share>
            <div className="sc-head"><h3>Share your progress</h3><button type="button" className="btn ghost" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
            <p className="muted sc-note">Shows how you keep to your process: plan rules kept, habits fixed, your level and habits. Never your profit or loss, returns, win rate, money, names or what you traded. The disclaimer is always on the card.</p>
            {data.heroOptions.length > 1 && <>
              <p className="sc-lbl">Biggest achievement</p>
              <div className="rw-chips sc-pick" data-share-hero>{data.heroOptions.map((k) => (
                <button key={k} type="button" className={`rw-chip${data.hero.key === k ? ' on' : ''}`} aria-pressed={data.hero.key === k} onClick={() => { setHero(k); setExclude((c) => c.filter((x) => x !== k)); }}>{CHIP[k]}</button>
              ))}</div>
            </>}
            <p className="sc-lbl">Tiles</p>
            <div className="rw-chips sc-pick" data-share-tiles>{data.options.filter((k) => k !== data.hero.key && (shown.has(k) || exclude.includes(k))).map((k) => {
              const on = shown.has(k), locked = on && !data.removable.includes(k);
              return <button key={k} type="button" className={`rw-chip${on ? ' on' : ''}`} aria-pressed={on} disabled={locked} title={locked ? 'Needed to fill the card' : undefined} onClick={() => toggle(k)}>{CHIP[k]}</button>;
            })}</div>
            {data.count < 7 && <p className="muted sc-note">Upload more months and follow a 30-day plan to unlock more tiles.</p>}
            <div className="rw-chips sc-pick">
              <button type="button" className={`rw-chip${format === 'card' ? ' on' : ''}`} aria-pressed={format === 'card'} onClick={() => setFormat('card')} data-share-format="card">Card</button>
              <button type="button" className={`rw-chip${format === 'story' ? ' on' : ''}`} aria-pressed={format === 'story'} onClick={() => setFormat('story')} data-share-format="story">Story</button>
              {foundingNo !== null && <button type="button" className={`rw-chip${badge ? ' on' : ''}`} aria-pressed={badge} onClick={() => setBadge((b) => !b)} data-share-badge>Founding badge</button>}
            </div>
            <canvas ref={cv} className="sc-canvas" width={S.w} height={S.h} role="img" aria-label={`My trading discipline card${data.period ? `, ${data.period}` : ''}${data.founding ? `, founding trader ${data.founding}` : ''}: ${data.summary}. ${data.disclaimer.join(' ')}`} data-share-canvas />
            <ul className="sc-items" data-share-items>{[data.hero, ...data.tiles].map((t) => <li key={t.key}>{t.label}: {t.value}{t.sub ? ` (${t.sub})` : ''}</li>)}</ul>
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
