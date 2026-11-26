/**
 * @file  apps/web/components/desk/DeskWatchouts.tsx
 * @area  Pages
 * @what  Desk "Your watch-outs" card (Trade Check phase 1): up to 3 notes from the trader's own trades (! weak habits first, ✓ a strength), each with sample size and period, the "checked against your trades up to …" line, and the plan / upload / building states.
 */
import Link from 'next/link';

export interface DeskProfileData {
  access: 'ok' | 'no_plan' | 'no_report';
  building?: boolean;
  profile: null | {
    version: number; periodTo: string | null; checkedAgainst: string | null; unlockTime: string | null; nothingClear: string | null;
    watchouts: { kind: 'weak' | 'strong'; segment: string; text: string; trades: number; period: string }[];
  };
}

export default function DeskWatchouts({ data }: { data: DeskProfileData }) {
  const p = data.profile;
  return (
    <section className="panel desk-wo" aria-labelledby="desk-wo-h" data-desk-watchouts>
      <div className="rv-ph"><h3 id="desk-wo-h">Your watch-outs</h3>
        {p?.checkedAgainst && <small>{p.checkedAgainst} · <Link href="/upload">update</Link></small>}</div>
      {data.access === 'no_plan' ? (
        <p className="muted small" data-desk-wo-state="no_plan">Watch-outs from your own trades come with an active plan. <Link className="link" href="/pricing">See plans</Link></p>
      ) : data.access === 'no_report' ? (
        <p className="muted small" data-desk-wo-state="no_report"><Link className="link" href="/upload">Upload a statement</Link> to see your watch-outs.</p>
      ) : !p ? (
        <p className="muted small" data-desk-wo-state="building">Your watch-outs are being prepared from your reports. They appear here in a minute.</p>
      ) : (
        <>
          {p.watchouts.length ? (
            <ul className="desk-wo-list">
              {p.watchouts.map((w) => (
                <li key={w.segment} data-kind={w.kind}>
                  <span className={`desk-wo-mark ${w.kind}`} aria-label={w.kind === 'weak' ? 'Caution' : 'Strength'}>{w.kind === 'weak' ? '!' : '✓'}</span>
                  <span>{w.text}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">{p.nothingClear}</p>}
          {p.unlockTime && <p className="muted small desk-wo-hint">{p.unlockTime}</p>}
        </>
      )}
      <p className="desk-wo-foot">From your own past trades. Not a recommendation.</p>
    </section>
  );
}
