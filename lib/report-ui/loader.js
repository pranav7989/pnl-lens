/**
 * @file  lib/report-ui/loader.js
 * @area  Report UI
 * @what  "Analysing…" overlay shown while a report is built.
 */
// @ts-nocheck
/**
 * "Analysing…" overlay shown while a report is built. Runs `work()` concurrently with a short,
 * natural-feeling step sequence; resolves with work's result once both are done. Errors propagate.
 */
export async function withAnalysing(work, opts = {}) {
  const files = opts.fileCount || 1;
  const steps = opts.steps || [
    `Reading ${files} file${files === 1 ? '' : 's'}`,
    'Detecting columns, instruments and currency',
    'Rebuilding your trades',
    'Checking 100 behavioural patterns',
    'Ranking leaks by what they cost',
    'Writing your report',
  ];
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stepMs = reduce ? 90 : opts.stepMs || 430;
  const wrap = document.createElement('div');
  wrap.className = 'an-wrap';
  wrap.setAttribute('role', 'status'); wrap.setAttribute('aria-live', 'polite');
  wrap.innerHTML = `<div class="an-card"><div class="an-top"><span class="an-glyph" aria-hidden="true"><i></i></span><span class="an-status">${steps[0]}…</span></div>
    <ol class="an-steps">${steps.map((s) => `<li><i aria-hidden="true"></i><span>${s}</span></li>`).join('')}</ol><div class="an-bar"><i></i></div></div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  const lis = [...wrap.querySelectorAll('li')], status = wrap.querySelector('.an-status'), bar = wrap.querySelector('.an-bar i');
  const set = (i) => {
    lis.forEach((li, j) => { li.classList.toggle('done', j < i); li.classList.toggle('on', j === i); });
    if (i < steps.length) status.textContent = steps[i] + '…';
    bar.style.width = Math.round((Math.min(i, steps.length) / steps.length) * 100) + '%';
  };
  set(0);
  let i = 0, done = false, result, error;
  const job = Promise.resolve().then(() => new Promise((r) => setTimeout(r, 30))).then(work).then((r) => { result = r; }, (e) => { error = e; }).finally(() => { done = true; });
  await new Promise((resolve) => {
    const tick = () => {
      if (error) return resolve();
      // hold on the last step until the real work finishes
      if (i < steps.length - 1 || done) { i++; set(i); }
      if (i >= steps.length && done) return resolve();
      setTimeout(tick, i >= steps.length - 1 && !done ? 120 : stepMs);
    };
    setTimeout(tick, stepMs);
  });
  await job;
  wrap.classList.remove('in');
  setTimeout(() => wrap.remove(), 260);
  if (error) throw error;
  return result;
}
