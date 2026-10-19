/**
 * @file  apps/web/lib/report-ui/render.js
 * @area  Report UI
 * @what  Report renderer shared by website and offline tool: Overview, Progress, Insights, Clusters, Positions + hover cards.
 */
// @ts-nocheck
/**
 * Report renderer v2 (website + offline app). DOM-string rendering scoped to `root`, no dependencies.
 * Every user-derived string goes through esc(). Tiles carry data-behav="<key>" for the behaviour card.
 */
/** Level names and score ranges. Mirrors the thresholds in packages/engine/src/engine.js buildProgress (engine unchanged). */
export const LEVEL_RANGES = [['Building', 0, 39], ['Developing', 40, 54], ['Steady', 55, 69], ['Disciplined', 70, 84], ['Elite', 85, 100]];

/**
 * The level ladder under the score: 5 segments in one row, each label centred in its own column below
 * (never overlapping). Narrow cards (ladder under 344 px) show only the current level's label (report.css).
 * Hover or tap a segment for its name and score range.
 */
export function ladderHtml(index) {
  const cl = (i) => (i < index ? 'done' : i === index ? 'on' : '');
  return `<div class="pg-ladder" role="list" aria-label="Levels">
    <div class="pg-lad-bar">${LEVEL_RANGES.map(([n, a, b], i) => `<i class="${cl(i)}" role="listitem" tabindex="0" aria-label="${n}: ${a}–${b}${i === index ? ' (your level)' : ''}" data-tip="${n}: ${a}–${b}"></i>`).join('')}</div>
    <div class="pg-lad-lab" aria-hidden="true">${LEVEL_RANGES.map(([n], i) => `<span class="${cl(i)}">${n}</span>`).join('')}</div></div>`;
}

export function mountReport(root, R, fmt) {
  const inr = fmt.inr, pct = fmt.pct;
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cls = (v) => (v > 0 ? 'gain' : v < 0 ? 'loss' : '');
  const B = R.behaviour || null;
  const m = R.m;
  const off = [];
  const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); off.push(() => el.removeEventListener(ev, fn, o)); };

  /* ---------- building blocks ---------- */
  const info = (key) => (B && B.tiles && B.tiles[key] ? `<button class="rv-info" type="button" data-tip="${key}" aria-label="How this compares to disciplined trading">i</button>` : '');
  const panel = (key, title, sub, body, span = 's6', extra = '') =>
    `<div class="rv-panel ${span} ${extra}" data-behav="${key}"><div class="rv-ph"><h3>${title}</h3>${sub ? `<small>${sub}</small>` : ''}${info(key)}</div>${body}</div>`;
  const kpi = (key, lab, val, c, sub) =>
    `<div class="rv-kpi" data-behav="${key}"><div class="rv-kl">${lab}${info(key)}</div><div class="rv-kv ${c}" data-count-up>${val}</div><div class="rv-ks">${sub || ''}</div></div>`;

  function bars(rows, opts = {}) {
    if (!rows || !rows.length) return `<p class="rv-empty">${opts.empty || 'Not enough data for this view.'}</p>`;
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));
    return `<div class="rv-bars">${rows.map((r) => {
      const w = (Math.abs(r.pnl) / max) * 50;
      return `<div class="rv-bar-row"><div class="rv-bl"><b>${esc(r.key)}</b><span>${r.n} trade${r.n === 1 ? '' : 's'}${opts.noWin ? '' : ` · ${Math.round(r.winRate * 100)}% win`}</span></div>
        <div class="rv-track"><i class="${r.pnl >= 0 ? 'pos' : 'neg'}" style="${r.pnl >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></i><em></em></div>
        <div class="rv-bv ${cls(r.pnl)}">${inr(r.pnl)}</div></div>`;
    }).join('')}</div>`;
  }
  function tiles(rows, opts = {}) {
    if (!rows || !rows.length) return `<p class="rv-empty">${opts.empty || 'Needs trade dates — upload a tradebook to see this.'}</p>`;
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));
    return `<div class="rv-tiles ${opts.cls || ''}">${rows.map((r) => {
      const h = Math.max(4, (Math.abs(r.pnl) / max) * 100);
      return `<div class="rv-tile ${r.pnl >= 0 ? 'up' : 'down'}"><div class="rv-tk">${esc(opts.label ? opts.label(r.key) : r.key)}</div>
        <div class="rv-tv ${cls(r.pnl)}">${inr(r.pnl)}</div>
        <div class="rv-tm">${r.n} trade${r.n === 1 ? '' : 's'} · ${Math.round(r.winRate * 100)}% win</div>
        <div class="rv-tbar"><i style="height:${h}%"></i></div></div>`;
    }).join('')}</div>`;
  }
  const monthLabel = (k) => { const [y, mo] = k.split('-'); return new Date(Date.UTC(+y, +mo - 1, 1)).toLocaleString('en', { month: 'short', timeZone: 'UTC' }) + ' ' + y.slice(2); };
  function curve() {
    const c = R.curve || [];
    if (c.length < 3) return '<p class="rv-empty">The P&amp;L curve needs at least three dated trades.</p>';
    const W = 600, H = 200, p = 6, v = c.map((x) => x.eq), max = Math.max(0, ...v), min = Math.min(0, ...v), span = max - min || 1;
    const X = (i) => p + (i * (W - 2 * p)) / (c.length - 1), Y = (val) => 14 + ((max - val) / span) * (H - 36);
    const d = c.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x.eq).toFixed(1)}`).join(' ');
    const end = v[v.length - 1], col = end >= 0 ? 'var(--gain)' : 'var(--loss)';
    return `<svg class="rv-curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative P&L">
      <defs><linearGradient id="rvg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <line x1="${p}" x2="${W - p}" y1="${Y(0)}" y2="${Y(0)}" class="zero"/>
      <path d="${d} L${X(c.length - 1)},${Y(0)} L${X(0)},${Y(0)} Z" fill="url(#rvg)"/>
      <path d="${d}" class="line" style="stroke:${col}"/></svg>`;
  }

  /* ---------- overview ---------- */
  /**
   * REQ-2 "What's next" card at the end of Overview and Progress (website only: fmt.next comes from the journey in
   * packages/shared/src/journey.ts). Single users also see a blurred, illustrative trend preview (no numbers).
   */
  function whatsNext() {
    const n = fmt.next; if (!n) return '';
    const preview = n.kind === 'upgrade'
      ? `<div class="wn-preview" aria-hidden="true"><svg viewBox="0 0 400 120" preserveAspectRatio="none"><polyline points="0,95 60,80 120,86 180,62 240,58 300,40 360,34 400,22" fill="none" stroke="#FFD60A" stroke-width="4"/><polyline points="0,110 400,110" stroke="#333" stroke-width="2"/></svg><span>Unlock month-by-month progress with Snapshot</span></div>`
      : '';
    return `<div class="rv-panel s12 wn" data-whats-next><div><h3>What's next</h3><p>${esc(n.text)}</p></div>
      <a class="btn" href="${esc(n.href)}" data-wn-cta="${esc(n.kind)}">${esc(n.cta)} →</a>${preview}</div>`;
  }

  function overview() {
    const dn = { dp: 'DP charges', amc: 'Demat AMC', autosq: 'Auto square-off fees', margin: 'Margin penalties', other: 'Other debits' };
    const heads = Object.entries(R.heads || {}).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
    const ds = Object.entries(R.debitSummary || {}).sort((a, b) => b[1].amount - a[1].amount);
    const costTotal = m.charges - m.other;
    const markets = (m.markets || []).map((x) => x.market).join(' + ');
    let h = `<div class="rv-grid">
      <div class="rv-hero s5" data-behav="net"><div class="rv-hl">Net P&amp;L after all costs${info('net')}</div>
        <div class="rv-hv">${inr(m.net)}</div><p>${esc(R.diagnosis)}</p>
        <div class="rv-hm">${esc(markets)}${markets ? ' · ' : ''}${esc(m.currency)}${m.from ? ` · ${esc(m.from)} to ${esc(m.to)}` : ''}</div></div>
      <div class="rv-kpis s7">
        ${kpi('gross', 'Gross realized', inr(m.realized), cls(m.realized), `${m.n} closed positions`)}
        ${kpi('costs', 'Total costs', inr(-costTotal), 'loss', m.realized ? `${pct((costTotal / Math.max(1, Math.abs(m.realized))) * 100, 1)} of gross` : '')}
        ${kpi('winrate', 'Win rate', Math.round(m.winRate * 100) + '%', '', `${m.wins} wins · ${m.losses} losses`)}
        ${kpi('payoff', 'Payoff', isFinite(m.payoff) ? m.payoff.toFixed(2) : '∞', m.payoff >= 1 ? 'gain' : 'loss', 'avg win ÷ avg loss')}
        ${kpi('avgwin', 'Avg win', inr(m.avgWin), 'gain', pct(m.avgWinPct, 1) + ' per trade')}
        ${kpi('avgloss', 'Avg loss', inr(-m.avgLoss), 'loss', pct(-m.avgLossPct, 1) + ' per trade')}
        ${kpi('pf', 'Profit factor', isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞', m.profitFactor >= 1 ? 'gain' : 'loss', 'gross win ÷ gross loss')}
        ${kpi('worst', 'Worst trade', inr(m.largestLoss), 'loss', 'best ' + inr(m.largestWin))}
      </div>`;
    h += panel('costsPanel', 'Where the costs went', 'paid before any trade is judged', `<table class="rv-t"><tbody>
        <tr><td>Gross realized P&amp;L</td><td class="n ${cls(m.realized)}">${inr(m.realized)}</td></tr>
        ${heads.map(([k, v]) => `<tr><td class="mut">${esc(k)}</td><td class="n loss">${inr(-v)}</td></tr>`).join('')}
        ${!heads.length && m.charges ? `<tr><td class="mut">Charges</td><td class="n loss">${inr(-m.charges)}</td></tr>` : ''}
        ${ds.map(([k, v]) => `<tr><td class="mut">${dn[k] || esc(k)} (${v.n})</td><td class="n loss">${inr(-v.amount)}</td></tr>`).join('')}
        ${!ds.length && m.other ? `<tr><td class="mut">Other credits &amp; debits</td><td class="n ${cls(m.other)}">${inr(m.other)}</td></tr>` : ''}
        <tr class="tot"><td>Net</td><td class="n ${cls(m.net)}">${inr(m.net)}</td></tr></tbody></table>`, 's5');
    h += panel('leaks', 'Top leaks', '<a href="#" data-go="insights">All insights &amp; fixes →</a>', `<div class="rv-leaks">${(R.leaks || []).slice(0, 4).map((l) =>
      `<div class="rv-leak"><span class="rv-lv ${l.level}">${l.level}</span><div><b>${esc(l.title)}</b><p>${esc(l.fix)}</p></div><em class="loss">${inr(-l.impact)}</em></div>`).join('') || '<p class="rv-empty">No major leaks found.</p>'}</div>`, 's7');
    if ((R.curve || []).length > 2) h += panel('curve', 'Cumulative P&amp;L', `worst drawdown ${inr(m.maxDD || 0)}`, curve(), 's7');
    h += panel('instrument', 'By instrument', '', bars(R.b.group), (R.curve || []).length > 2 ? 's5' : 's6');
    if (R.seq) {
      const a = R.seq.afterWin, l = R.seq.afterLoss;
      h += panel('afterwinloss', 'After a win vs after a loss', 'the next trade you take', `<div class="rv-vs">
        <div><span>After a win</span><b class="${cls(a.avg)}">${inr(a.avg)}</b><small>${a.n} trades · ${Math.round(a.winRate * 100)}% win · avg size ${inr(a.avgSize)}</small></div>
        <div><span>After a loss</span><b class="${cls(l.avg)}">${inr(l.avg)}</b><small>${l.n} trades · ${Math.round(l.winRate * 100)}% win · avg size ${inr(l.avgSize)}</small></div></div>
        <p class="rv-note">Worst streak ${R.seq.worstStreak} losses in a row${R.seq.worstDay ? ` · worst day ${esc(R.seq.worstDay.date)} (${inr(R.seq.worstDay.pnl)})` : ''}.</p>`, 's6');
    }
    if ((R.b.year || []).length > 1) h += panel('year', 'By expiry year', 'F&amp;O only', bars(R.b.year), 's6');
    $('#overview').innerHTML = h + whatsNext() + '</div>';
  }

  /* ---------- insights ---------- */
  function stopTable(s, key) {
    if (!s) return '';
    return panel(key, esc(s.label), `suggested −${s.rec}%`, `<table class="rv-t"><thead><tr><th>Stop</th><th class="n">Losers cut</th><th class="n">Loss avoided</th><th class="n">Net would be</th></tr></thead><tbody>
      ${s.rows.map((x) => `<tr class="${x.stop === s.rec ? 'hl' : ''}"><td>−${x.stop}%</td><td class="n">${x.hit}</td><td class="n gain">${inr(x.saved)}</td><td class="n ${cls(x.net)}"><b>${inr(x.net)}</b></td></tr>`).join('')}
      <tr><td class="mut">No stop (actual)</td><td class="n">—</td><td class="n">—</td><td class="n ${cls(m.net)}"><b>${inr(m.net)}</b></td></tr></tbody></table>`, 's6');
  }
  const traitCard = (t) => `<article class="rv-trait ${t.level}">
      <header><span class="rv-tl">${t.level}</span><h4>${esc(t.name)}</h4></header>
      <p class="rv-tnow">${esc(t.now)}</p>
      <p class="rv-twhy">${esc(t.why)}</p>
      <p class="rv-tideal"><b>What disciplined traders do</b>${esc(t.ideal)}</p></article>`;
  function insights() {
    let h = `<div class="rv-grid">
      <div class="rv-hero s12" data-behav="diagnosis"><div class="rv-hl">Diagnosis · ${esc(m.from || '')}${m.to ? ' to ' + esc(m.to) : ''} · ${m.n} positions${info('diagnosis')}</div><p class="rv-hd">${esc(R.diagnosis)}</p></div>`;
    h += panel('leaks', "Where you're leaking", 'ranked by severity, then cost', `<div class="rv-leaks full">${(R.leaks || []).map((l) =>
      `<div class="rv-leak"><span class="rv-lv ${l.level}">${l.level}</span><div><b>${esc(l.title)}</b><p class="mut">${esc(l.evidence)}</p><p>${esc(l.fix)}</p></div><em class="loss">${inr(-l.impact)}</em></div>`).join('') || '<p class="rv-empty">No major leaks found.</p>'}</div>`, 's12');
    h += panel('rules', 'Rules to adopt', 'print these', `<ul class="rv-rules">${(R.rules || []).map((x) => `<li><i></i><div><b>${esc(x.rule)}</b><span>${esc(x.why)}</span></div></li>`).join('')}</ul>`, 's6');
    h += panel('patterns', 'Patterns found', 'from your clusters', `<ul class="rv-list">${(R.patterns || []).map((p) => `<li class="${p.impact > 0 ? 'neg' : 'pos'}">${esc(p.text)}</li>`).join('') || '<li class="mut">Not enough trades per group to call a pattern yet.</li>'}</ul>`, 's6');
    if (B && B.traits && B.traits.length) {
      h += `<div class="rv-panel s12 rv-psych" data-behav="psych"><div class="rv-ph"><h3>Behavioural mistakes</h3><small>${B.traits.length + (B.more || []).length} of ${B.checked} patterns matched your trades</small>${info('psych')}</div>
        <div class="rv-traits">${B.traits.map(traitCard).join('')}</div>
        ${(B.more || []).length ? `<div class="rv-more" hidden>${B.more.map(traitCard).join('')}</div><button class="rv-morebtn" type="button" data-more>Show ${B.more.length} more patterns</button>` : ''}</div>`;
    }
    h += stopTable(R.stops && R.stops.opt, 'stopsOpt') + stopTable(R.stops && R.stops.lin, 'stopsLin');
    h += panel('working', "What's working", 'keep doing these', `<ul class="rv-list">${(R.strengths || []).map((s) => `<li class="pos">${esc(s)}</li>`).join('') || '<li class="mut">Nothing stands out yet.</li>'}</ul>
      ${(R.dropWorst || []).length ? `<p class="rv-note">Net without your worst ${R.dropWorst.map((d) => `${d.k} trade${d.k > 1 ? 's' : ''}: ${inr(d.net)}`).join(' · ')}.</p>` : ''}`, 's12');
    $('#insights').innerHTML = h + '</div>';
  }

  /* ---------- clusters ---------- */
  function clusters() {
    const b = R.b;
    const when = [
      panel('month', 'By month', 'when you closed each trade', tiles(b.month, { label: monthLabel, cls: 'months' }), 's12'),
      panel('entryDow', 'Entry weekday', 'the day you opened the trade', tiles(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => (b.entryDow || []).find((r) => r.key === d)).filter(Boolean), { cls: 'days' }), 's12'),
      (b.entryHour || []).length > 1 ? panel('entryHour', 'Time of entry', '', tiles(b.entryHour, { cls: 'four' }), 's6') : '',
      (b.busyDay || []).length > 1 ? panel('busyDay', 'Trades per day', 'how results change with activity', tiles(b.busyDay, { cls: 'four' }), 's6') : '',
      (b.weekday || []).length ? panel('weekday', 'Expiry day', 'when the option contract expired', tiles(b.weekday, { cls: 'days' }), 's12') : '',
      (b.year || []).length > 1 ? panel('year', 'By year', '', tiles(b.year, { cls: 'four' }), 's12') : '',
    ].join('');
    const how = [
      panel('hold', 'Holding period', '', bars(b.hold, { empty: 'Needs entry and exit dates.' })),
      b.style && b.style.length ? panel('style', 'Holding style', 'stocks', bars(b.style)) : '',
      panel('size', 'Position size', 'buy value', bars(b.size)),
      panel('lossDepth', 'How deep losers went', '% of buy value', bars(b.lossDepth, { noWin: true })),
      panel('worstU', 'Worst underlyings', '', bars((b.underlying || []).filter((u) => u.pnl < 0).slice(0, 8))),
      panel('bestU', 'Best underlyings', '', bars([...(b.underlying || [])].filter((u) => u.pnl > 0).sort((x, y) => y.pnl - x.pnl).slice(0, 8))),
      panel('group', 'Instrument', '', bars(b.group)),
      (b.premium || []).length ? panel('premium', 'Entry premium', 'per unit', bars(b.premium)) : '',
      (b.callPut || []).length ? panel('callPut', 'Calls vs puts', '', bars(b.callPut)) : '',
      (b.expiryType || []).length ? panel('expiryType', 'Weekly vs monthly', 'options', bars(b.expiryType)) : '',
      (b.direction || []).length > 1 ? panel('direction', 'Long vs short', '', bars(b.direction)) : '',
    ].join('');
    $('#clusters').innerHTML = `<div class="rv-seg" role="tablist" aria-label="Cluster groups">
        <button role="tab" aria-selected="true" data-seg="when">When you trade</button>
        <button role="tab" aria-selected="false" data-seg="how">How you hold, size &amp; pick</button></div>
      <div class="rv-grid" data-group="when">${when}</div>
      <div class="rv-grid" data-group="how" hidden>${how}</div>
      <p class="rv-note">Expiry days come from the contract symbol (holidays ignored). Month, weekday and time views need trade dates — a tradebook gives the most detail.</p>`;
  }


  /* ---------- progress ---------- */
  const P = R.progress || null;
  const H = (fmt.history || []).slice().sort((a, b) => String(a.to || a.savedAt).localeCompare(String(b.to || b.savedAt)));
  if (P && B && B.tiles) {
    const cur = P.months.length ? P.months[P.months.length - 1] : null;
    Object.assign(B.tiles, {
      score: { now: `Your discipline score is ${(cur || P.overall).score}/100${P.delta != null ? `, ${P.delta >= 0 ? 'up' : 'down'} ${Math.abs(P.delta)} on last month` : ''}.`, ideal: 'Disciplined traders hold 70+ and move it up a few points each month by fixing one habit at a time.' },
      radar: { now: 'Your six habits this month (yellow) against last month (dashed).', ideal: 'A balanced, wide shape: no habit far below the others. Work on the shortest spoke first.' },
      tracker: { now: `${P.tracker.filter((t) => ['fixed', 'improving'].includes(t.status)).length} mistakes improving, ${P.tracker.filter((t) => ['worse', 'new'].includes(t.status)).length} getting worse.`, ideal: 'Mistakes move to Fixed and stay there. One new rule per month is enough.' },
      trends: { now: 'How your key numbers moved month by month.', ideal: 'R:R and win rate steady or rising; average loss and revenge trades falling.' },
      goals: { now: 'Targets set from your weakest habits this month.', ideal: 'Work on one or two goals at a time. Small, steady improvements compound.' },
      heatmap: { now: 'Each habit scored month by month. Brighter cells are stronger habits.', ideal: 'Rows turning brighter from left to right, with no column suddenly dark.' },
      saved: { now: P.saved ? `Habit-related losses ${P.saved.total >= 0 ? 'fell' : 'rose'} by ${inr(Math.abs(P.saved.total))} since your first month.` : 'Needs two or more months of trades.', ideal: 'Habit-related losses shrinking every month, so more of each gain is kept.' },
      checkups: { now: H.length ? `${H.length} check-up${H.length === 1 ? '' : 's'} saved ${fmt.historyWhere || 'on this device'}.` : 'No earlier check-ups saved yet.', ideal: 'A check-up every month, on the same day, with the full month\'s tradebook.' },
    });
  }
  function ring(score, delta) {
    const r = 54, c = 2 * Math.PI * r, f = Math.max(0, Math.min(100, score)) / 100;
    const col = score >= 70 ? 'var(--gain)' : score >= 50 ? 'var(--y)' : 'var(--loss)';
    return `<div class="pg-ring"><svg viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="${r}" class="trk"/><circle cx="70" cy="70" r="${r}" class="val" style="stroke:${col};stroke-dasharray:${c};--off:${c * (1 - f)}"/></svg>
      <div class="pg-ring-n"><b>${score}</b><span>/100</span></div></div>
      ${delta != null ? `<span class="pg-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} ${Math.abs(delta)} vs last month</span>` : ''}`;
  }
  function radar(now, before) {
    const keys = Object.keys(P.labels), n = keys.length, cx = 170, cy = 150, R0 = 108;
    const pt = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n, rr = (R0 * v) / 100; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; };
    const poly = (d) => keys.map((k, i) => pt(i, d[k]).map((x) => x.toFixed(1)).join(',')).join(' ');
    let g = '';
    for (const lv of [25, 50, 75, 100]) g += `<polygon class="grid" points="${keys.map((k, i) => pt(i, lv).map((x) => x.toFixed(1)).join(',')).join(' ')}"/>`;
    keys.forEach((k, i) => { const [x, y] = pt(i, 100), [lx, ly] = pt(i, 122); g += `<line class="axis" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${lx < cx - 5 ? 'end' : lx > cx + 5 ? 'start' : 'middle'}" dominant-baseline="middle">${esc(P.labels[k])} <tspan class="v">${now[k]}</tspan></text>`; });
    if (before) g += `<polygon class="before" points="${poly(before)}"/>`;
    g += `<polygon class="now" points="${poly(now)}"/>`;
    keys.forEach((k, i) => { const [x, y] = pt(i, now[k]); g += `<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"/>`; });
    return `<svg class="pg-radar" viewBox="-70 0 480 300" role="img" aria-label="Habit radar">${g}</svg>
      <div class="pg-legend"><span><i class="now"></i>This month</span>${before ? '<span><i class="before"></i>Last month</span>' : ''}</div>`;
  }
  function spark(vals, invert) {
    if (vals.length < 2) return '';
    const W = 120, Hh = 34, mx = Math.max(...vals), mn = Math.min(...vals), sp = mx - mn || 1;
    const d = vals.map((v, i) => `${i ? 'L' : 'M'}${((i * W) / (vals.length - 1)).toFixed(1)},${(Hh - 4 - ((v - mn) / sp) * (Hh - 8)).toFixed(1)}`).join(' ');
    const good = invert ? vals[vals.length - 1] <= vals[0] : vals[vals.length - 1] >= vals[0];
    return `<svg viewBox="0 0 ${W} ${Hh}" class="pg-spark ${good ? 'good' : 'bad'}"><path d="${d}"/></svg>`;
  }
  const STATUS = { fixed: ['Fixed', '✓'], improving: ['Improving', '↗'], same: ['Same', '→'], worse: ['Worse', '↘'], new: ['New', '!'], present: ['Present', '•'], clean: ['Clean', '✓'] };
  function progressTab() {
    const el = $('#progress'); if (!el) return;
    if (!P) { el.innerHTML = '<div class="rv-panel"><p class="rv-empty">Progress tracking is available for reports created with the latest version.</p></div>'; return; }
    const ms = P.months, cur = ms[ms.length - 1] || null, prev = ms[ms.length - 2] || null, first = ms[0] || null;
    const headScore = cur ? cur.score : P.overall.score;
    const lab = (k) => { const [y, mo] = k.split('-'); return new Date(Date.UTC(+y, +mo - 1, 1)).toLocaleString('en', { month: 'short', timeZone: 'UTC' }) + ' ' + y.slice(2); };
    const lv = P.level || { name: '', index: 0, next: null };
    let h = '<div class="rv-grid">';
    // 1 — hero
    h += `<div class="rv-panel s12 pg-hero" data-behav="score">${info('score')}
      <div class="pg-hero-ring">${ring(headScore, P.delta)}</div>
      <div class="pg-hero-mid"><span class="pg-kicker">Level</span><b class="pg-level">${esc(lv.name)}</b>
        ${ladderHtml(lv.index)}
        <p class="pg-next">${lv.next ? `<b>${lv.next.gap}</b> point${lv.next.gap === 1 ? '' : 's'} to <b>${esc(lv.next.name)}</b>` : 'Top level reached. Keep it steady.'}</p></div>
      <div class="pg-hero-note"><span class="pg-kicker">${cur ? esc(lab(cur.key)) + ' summary' : 'Summary'}</span><p>${esc(P.summary || '')}</p>
        ${(P.badges || []).length ? `<div class="pg-badges">${P.badges.map((b) => `<span class="pg-badge" title="${esc(b.desc)}"><i></i>${esc(b.name)}</span>`).join('')}</div>` : ''}</div></div>`;
    // 2 — radar + goals
    h += `<div class="rv-panel s7" data-behav="radar"><div class="rv-ph"><h3>Your six habits</h3><small>0–100, higher is better</small>${info('radar')}</div>${radar(cur ? cur.d : P.overall.d, prev ? prev.d : null)}</div>`;
    const gfmt = (g, v) => (g.fmt === 'x' ? Number(v).toFixed(2) : g.fmt === '%' ? Math.round(v) + '%' : Number(v).toFixed(1));
    h += `<div class="rv-panel s5" data-behav="goals"><div class="rv-ph"><h3>Goals for next month</h3><small>from your weakest habits</small>${info('goals')}</div>
      ${(P.goals || []).length ? `<div class="pg-goals">${P.goals.map((g, i) => {
        const span = Math.abs(g.target - g.now) || 1, pos = g.better === 'up' ? Math.min(100, Math.max(6, (g.now / Math.max(g.target, 0.01)) * 100)) : Math.min(100, Math.max(6, (g.target / Math.max(g.now, 0.01)) * 100));
        return `<div class="pg-goal"><div class="pg-goal-h"><span class="pg-goal-n">${i + 1}</span><b>${esc(g.text)}</b></div>
          <div class="pg-goal-bar"><i style="width:${pos}%"></i><em style="left:100%"></em></div>
          <div class="pg-goal-f"><span>Now <b>${gfmt(g, g.now)}</b></span><span>Target <b>${gfmt(g, g.target)}</b></span><span class="mut">${esc(g.label)} ${g.score}/100</span></div></div>`; }).join('')}</div>` : '<p class="rv-empty">Every habit is in good shape. Keep the same process.</p>'}</div>`;
    // 3 — score trend
    if (ms.length >= 2) {
      const W = 720, Hh = 210, pad = 28, n = ms.length, X = (i) => pad + (i * (W - 2 * pad)) / Math.max(1, n - 1), Y = (v) => Hh - 26 - (v / 100) * (Hh - 50);
      const d = ms.map((m, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(m.score).toFixed(1)}`).join(' ');
      const tgt = lv.next ? lv.next.at : null;
      h += `<div class="rv-panel s12" data-behav="score"><div class="rv-ph"><h3>Score trend</h3><small>${ms.length} months${tgt ? ` · dashed line: ${esc(lv.next.name)} at ${tgt}` : ''}</small>${info('score')}</div>
        <svg class="pg-trend" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="Score by month">
          <defs><linearGradient id="pgt" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#FFD60A" stop-opacity=".28"/><stop offset="1" stop-color="#FFD60A" stop-opacity="0"/></linearGradient></defs>
          ${[25, 50, 75].map((g) => `<line class="gl" x1="${pad}" x2="${W - pad}" y1="${Y(g)}" y2="${Y(g)}"/><text class="gt" x="${pad - 6}" y="${Y(g) + 4}" text-anchor="end">${g}</text>`).join('')}
          ${tgt ? `<line class="tg" x1="${pad}" x2="${W - pad}" y1="${Y(tgt)}" y2="${Y(tgt)}"/>` : ''}
          <path class="ar" d="${d} L${X(n - 1)},${Hh - 26} L${X(0)},${Hh - 26} Z"/><path class="ln" d="${d}"/>
          ${ms.map((m, i) => `<circle class="pt${i === n - 1 ? ' cur' : ''}" cx="${X(i)}" cy="${Y(m.score)}" r="${i === n - 1 ? 6 : 4}"/><text class="pv" x="${X(i)}" y="${Y(m.score) - 12}" text-anchor="middle">${m.score}</text><text class="px" x="${X(i)}" y="${Hh - 6}" text-anchor="middle">${esc(lab(m.key))}</text>`).join('')}
        </svg></div>`;
    }
    // 4 — habit heatmap + what habits cost
    const keys = Object.keys(P.labels);
    const cell = (v) => `<i class="hm-c" style="--v:${v}" title="${v}/100"><b>${v}</b></i>`;
    h += `<div class="rv-panel s7" data-behav="heatmap"><div class="rv-ph"><h3>Habit heatmap</h3><small>${ms.length >= 2 ? 'each habit, month by month' : 'this file'}</small>${info('heatmap')}</div>
      <div class="pg-heat" style="--cols:${Math.max(1, ms.length)}"><span></span>${(ms.length ? ms : [{ key: 'all' }]).map((m) => `<span class="hm-h">${m.key === 'all' ? 'All' : esc(lab(m.key))}</span>`).join('')}
      ${keys.map((k) => `<span class="hm-l">${esc(P.labels[k])}</span>${(ms.length ? ms : [P.overall]).map((m) => cell(m.d[k])).join('')}`).join('')}</div></div>`;
    const sv = P.saved, HC = { revenge: 'Trading after losses', busy: 'Very active days', deep: 'Losses past −10%', zero: 'Options held to expiry' };
    h += `<div class="rv-panel s5" data-behav="saved"><div class="rv-ph"><h3>What your habits cost</h3><small>${sv ? `${esc(lab(sv.from))} vs ${esc(lab(sv.to))}` : 'needs 2+ months'}</small>${info('saved')}</div>
      ${sv && sv.items.length ? `<div class="pg-saved-top ${sv.total >= 0 ? 'gain' : 'loss'}"><b>${inr(Math.abs(sv.total))}</b><span>${sv.total >= 0 ? 'less lost to these habits than in your first month' : 'more lost to these habits than in your first month'}</span></div>
        <div class="pg-saved">${sv.items.map((x) => { const mx = Math.max(x.first, x.now, 1); return `<div class="pg-sv"><span>${HC[x.k]}</span>
          <div class="pg-sv-bars"><i class="a" style="width:${(x.first / mx) * 100}%"></i><i class="b" style="width:${(x.now / mx) * 100}%"></i></div>
          <em class="${x.diff >= 0 ? 'gain' : 'loss'}">${x.diff >= 0 ? '−' : '+'}${inr(Math.abs(x.diff)).replace('−', '')}</em></div>`; }).join('')}</div>
        <p class="pg-legend2"><span><i class="a"></i>${esc(lab(sv.from))}</span><span><i class="b"></i>${esc(lab(sv.to))}</span></p>` : '<p class="rv-empty">Once your file covers two or more months, this shows how much each habit cost you then and now.</p>'}</div>`;
    // 5 — tracker + then vs now
    h += `<div class="rv-panel s7" data-behav="tracker"><div class="rv-ph"><h3>Mistake tracker</h3><small>${prev ? `${esc(lab(cur.key))} vs ${esc(lab(prev.key))}` : 'this file'}</small>${info('tracker')}</div>
      ${P.tracker.length ? `<div class="pg-track">${P.tracker.map((t) => `<div class="pg-tr"><div><b>${esc(t.label)}</b><small>${esc(t.now)}</small></div>
        <div class="pg-dots">${t.series.map((p) => `<i class="${p.on ? 'on' : 'off'}" title="${esc(lab(p.key))}: ${esc(p.val)}"></i>`).join('')}</div>
        <span class="pg-st ${t.status}">${STATUS[t.status][1]} ${STATUS[t.status][0]}</span></div>`).join('')}</div>` : '<p class="rv-empty">No repeated patterns detected. Keep the same process.</p>'}</div>`;
    const T = [
      ['Win rate', ms.map((x) => x.m.winRate * 100), (v) => Math.round(v) + '%', false],
      ['Risk : reward', ms.map((x) => x.m.payoff), (v) => v.toFixed(2), false],
      ['Avg loss', ms.map((x) => x.m.avgLossPct), (v) => v.toFixed(1) + '%', true],
      ['After-loss trades', ms.map((x) => x.m.revengeRate * 100), (v) => Math.round(v) + '%', true],
      ['Trades / day', ms.map((x) => x.m.tradesPerDay), (v) => v.toFixed(1), true],
      ['Net P&L', ms.map((x) => x.m.pnl), (v) => inr(v), false],
    ].filter((r) => r[1].some((v) => v));
    h += `<div class="rv-panel s5" data-behav="trends"><div class="rv-ph"><h3>Then vs now</h3><small>${first && cur && ms.length >= 2 ? `${esc(lab(first.key))} → ${esc(lab(cur.key))}` : 'needs 2+ months'}</small>${info('trends')}</div>
      ${ms.length >= 2 ? `<div class="pg-tvn">${T.map(([n, v, f, inv]) => { const a = v[0], b2 = v[v.length - 1], good = inv ? b2 <= a : b2 >= a;
        return `<div class="pg-tv"><span>${n}</span><b class="mut">${f(a)}</b><i class="${good ? 'gain' : 'loss'}">${b2 === a ? '→' : good ? '▲' : '▼'}</i><b>${f(b2)}</b>${spark(v, inv)}</div>`; }).join('')}</div>` : '<p class="rv-empty">Upload a tradebook covering two or more months, or come back next month, to compare.</p>'}</div>`;
    // 6 — check-ups
    const due = H.length ? new Date(new Date(H[H.length - 1].savedAt).getTime() + 30 * 864e5) : null;
    h += `<div class="rv-panel s12" data-behav="checkups"><div class="rv-ph"><h3>Check-up history</h3><small>${H.length ? `next check-up due ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'your first check-up'}</small>${info('checkups')}</div>
      ${H.length ? `<div class="pg-hist">${H.map((c, i) => `<div class="pg-hc${i === H.length - 1 ? ' cur' : ''}"><span>${esc(new Date(c.savedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }))}</span><b class="${c.score >= 70 ? 'gain' : c.score >= 50 ? '' : 'loss'}">${c.score}</b><small>${esc(c.label)}</small>${i ? `<em class="${c.score - H[i - 1].score >= 0 ? 'gain' : 'loss'}">${c.score - H[i - 1].score >= 0 ? '+' : ''}${c.score - H[i - 1].score}</em>` : '<em>baseline</em>'}</div>`).join('')}</div>` : ''}
      <p class="rv-note">Come back every month with that month's tradebook. Each check-up is compared with the last, so you can see which habits changed.</p></div>`;
    el.innerHTML = h + whatsNext() + '</div>';
  }
  /* ---------- positions ---------- */
  let sortKey = 'pnl', sortDir = 1;
  const COLS = [['symbol', 'Symbol'], ['group', 'Group'], ['expiry', 'Expiry'], ['qty', 'Qty', 1], ['avgBuy', 'Avg buy', 1], ['buy', 'Buy value', 1], ['sell', 'Sell value', 1], ['pct', 'Return', 1], ['pnl', 'Realized', 1], ['netEst', 'After charges', 1]];
  function positions() {
    const groups = [...new Set(R.trades.map((t) => t.group))];
    $('#positions').innerHTML = `<div class="rv-panel" data-behav="positions"><div class="rv-ph"><h3>All positions</h3><small>${R.trades.length} in total</small>${info('positions')}</div>
      <div class="rv-filters"><input id="q" type="search" placeholder="Search symbol" aria-label="Search symbol">
        <select id="fg" aria-label="Filter by group"><option value="">All groups</option>${groups.map((g) => `<option>${esc(g)}</option>`).join('')}</select>
        <select id="fo" aria-label="Filter by outcome"><option value="">Winners and losers</option><option value="w">Winners</option><option value="l">Losers</option></select></div>
      <div class="rv-tw" id="ptable"></div></div>`;
    ['#q', '#fg', '#fo'].forEach((s) => on($(s), 'input', drawPositions));
    drawPositions();
  }
  function drawPositions() {
    const q = $('#q').value.trim().toUpperCase(), g = $('#fg').value, o = $('#fo').value;
    const rows = R.trades.filter((t) => (!q || t.symbol.toUpperCase().includes(q)) && (!g || t.group === g) && (!o || (o === 'w' ? t.pnl > 0 : t.pnl < 0)));
    rows.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; return (typeof x === 'number' ? x - y : String(x || '').localeCompare(String(y || ''))) * sortDir; });
    const max = Math.max(1, ...R.trades.map((t) => Math.abs(t.pnl)));
    const tot = rows.reduce((s, t) => s + t.pnl, 0);
    $('#ptable').innerHTML = `<table class="rv-t pos"><thead><tr>${COLS.map(([k, l, n]) => `<th class="sort${n ? ' n' : ''}${k === sortKey ? ' on' : ''}" data-k="${k}">${l}${k === sortKey ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>` +
      rows.slice(0, 1500).map((t) => `<tr><td class="sym">${esc(t.symbol)}</td><td class="mut">${esc(t.group)}</td><td class="mut">${t.expiry ? esc(t.expiry) + (t.weekday ? ' ' + t.weekday.slice(0, 3) : '') : '—'}</td>
        <td class="n">${t.qty}</td><td class="n">${t.avgBuy ? Number(t.avgBuy).toFixed(2) : '—'}</td><td class="n">${inr(t.buy)}</td><td class="n">${inr(t.sell)}</td>
        <td class="n ${cls(t.pct)}">${pct(t.pct, 1)}</td><td class="n ${cls(t.pnl)}"><b>${inr(t.pnl)}</b><span class="mb"><i class="${t.pnl >= 0 ? 'pos' : 'neg'}" style="width:${(Math.abs(t.pnl) / max) * 100}%"></i></span></td>
        <td class="n ${cls(t.netEst)}">${inr(t.netEst)}</td></tr>`).join('') +
      `<tr class="tot"><td colspan="8">${rows.length} positions${rows.length > 1500 ? ' (first 1,500 shown)' : ''}</td><td class="n ${cls(tot)}">${inr(tot)}</td><td></td></tr></tbody></table>`;
    $$('#ptable th.sort').forEach((th) => th.addEventListener('click', () => { const k = th.dataset.k; if (k === sortKey) sortDir *= -1; else { sortKey = k; sortDir = 1; } drawPositions(); }));
  }

  /* ---------- behaviour card ---------- */
  const tip = document.createElement('div');
  tip.className = 'rv-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  document.body.appendChild(tip);
  let tipFor = null, tipKey = null, pinned = false;
  function place(el) {
    const r = el.getBoundingClientRect(), tw = Math.min(340, window.innerWidth - 24);
    tip.style.width = tw + 'px';
    const th = tip.offsetHeight;
    let top = r.top - th - 10, below = false;
    if (top < 8) { top = r.bottom + 10; below = true; }
    const left = Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 12);
    tip.style.top = top + window.scrollY + 'px'; tip.style.left = left + window.scrollX + 'px';
    tip.classList.toggle('below', below);
  }
  function showTip(el, key) {
    const t = B && B.tiles && B.tiles[key]; if (!t) return;
    tipKey = key;
    tip.innerHTML = `<div class="rv-tip-row now"><span>How you trade now</span><p>${esc(t.now)}</p></div><div class="rv-tip-row ideal"><span>What disciplined traders do</span><p>${esc(t.ideal)}</p></div>`;
    tip.hidden = false; tipFor = el;
    place(el);
    requestAnimationFrame(() => { if (tipFor === el) tip.classList.add('in'); });
  }
  function hideTip() { tip.classList.remove('in'); tip.hidden = true; tipFor = null; tipKey = null; pinned = false; }
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (fine) {
    on(root, 'mouseover', (e) => {
      if (pinned) return;
      const el = e.target.closest('[data-behav]'); if (!el || el === tipFor) return;
      const key = el.getAttribute('data-behav'); if (!(B && B.tiles && B.tiles[key])) { if (tipFor) hideTip(); return; }
      showTip(el, key);
    });
    on(root, 'mouseleave', () => { if (!pinned) hideTip(); });
    on(root, 'mouseout', (e) => { if (pinned || !tipFor) return; if (!e.relatedTarget || !tipFor.contains(e.relatedTarget)) { const next = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-behav]'); if (!next) hideTip(); } });
  }
  // keep the card attached to its tile while the page scrolls; close it once the tile leaves the screen
  on(window, 'scroll', () => {
    if (!tipFor) return;
    const r = tipFor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || !tipFor.isConnected) hideTip(); else place(tipFor);
  }, { passive: true });
  on(window, 'resize', () => { if (tipFor) place(tipFor); });
  on(document, 'keydown', (e) => { if (e.key === 'Escape') hideTip(); });

  /* ---------- navigation ---------- */
  function swap(id, enter) {
    $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    $$('.tab').forEach((t) => { const onTab = t.id === id; t.classList.toggle('hide', !onTab); if (onTab && enter) { t.classList.remove('rv-enter'); void t.offsetWidth; t.classList.add('rv-enter'); } });
    hideTip();
  }
  /* motion (19 Oct 2026): the tab content cross-fades with a View Transition where supported (the old rv-enter
     animation otherwise); only the panel is named, so the header and the tab bar stay still */
  function show(id) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cur = $$('.tab').find((t) => !t.classList.contains('hide'));
    if (!document.startViewTransition || reduce || !cur || cur.id === id) { swap(id, true); return; }
    cur.style.viewTransitionName = 'rv-tab';
    const vt = document.startViewTransition(() => {
      cur.style.viewTransitionName = '';
      swap(id, false);
      const next = document.getElementById(id); if (next) next.style.viewTransitionName = 'rv-tab';
    });
    vt.finished.finally(() => { const next = document.getElementById(id); if (next) next.style.viewTransitionName = ''; });
  }
  on(root, 'click', (e) => {
    const tb = e.target.closest('[data-tip]');
    if (tb) { e.preventDefault(); e.stopPropagation(); const el = tb.closest('[data-behav]'); if (tipFor === el && pinned) hideTip(); else { showTip(el, tb.dataset.tip); pinned = true; } return; }
    const b = e.target.closest('[data-tab]'); if (b) { show(b.dataset.tab); return; }
    const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); show(g.dataset.go); return; }
    const sg = e.target.closest('[data-seg]');
    if (sg) {
      const id = sg.dataset.seg;
      $$('[data-seg]').forEach((x) => x.setAttribute('aria-selected', String(x === sg)));
      $$('[data-group]').forEach((x) => { x.hidden = x.dataset.group !== id; if (!x.hidden) { x.classList.remove('rv-enter'); void x.offsetWidth; x.classList.add('rv-enter'); } });
      hideTip(); return;
    }
    const mb = e.target.closest('[data-more]');
    if (mb) { const more = root.querySelector('.rv-more'); more.hidden = !more.hidden; mb.textContent = more.hidden ? `Show ${B.more.length} more patterns` : 'Show fewer'; return; }
    if (pinned && !e.target.closest('.rv-tip')) hideTip();
  });
  on(document, 'click', (e) => { if (pinned && !root.contains(e.target) && !tip.contains(e.target)) hideTip(); });

  overview(); insights(); clusters(); progressTab(); positions();
  show('overview');
  return { show, destroy: () => { off.forEach((f) => f()); tip.remove(); } };
}
