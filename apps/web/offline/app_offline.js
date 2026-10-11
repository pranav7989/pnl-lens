/**
 * @file  apps/web/offline/app_offline.js
 * @area  Offline
 * @what  Offline tool logic: plans, report library (IndexedDB), month-grouped history with rename, workspace.
 */
/* Offline app shell.
 * Plan → reports: the active plan sets how many reports can be created, files per report and the end date.
 * Each report holds up to N files (own dashboards + "All files"), is stored in IndexedDB and listed by month.
 */
(function () {
  var E = window.PnlEngine, X = window.PnlExtract, mountReport = window.mountReport, withAnalysing = window.withAnalysing;
  var $ = function (s) { return document.querySelector(s); };
  var landing = document.querySelector('.lp'), appview = $('#appview');
  var MAX_BYTES = 10 * 1048576, EXT = ['.xlsx', '.xls', '.csv', '.pdf', '.docx', '.doc'];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var store = { get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var monthTag = function (d) { d = new Date(d); return MON[d.getMonth()] + '-' + String(d.getFullYear()).slice(2); };
  var dayLabel = function (d) { d = new Date(d); return d.getDate() + ' ' + MON[d.getMonth()].charAt(0) + MON[d.getMonth()].slice(1).toLowerCase(); };

  /* ---------- plans (same numbers as lib/pricing.ts) ---------- */
  var PLANS = {
    single: { name: 'Single', reports: 1, files: 2, days: 7 },
    snapshot: { name: 'Snapshot', reports: 5, files: 3, days: 183 },
    progress: { name: 'Progress', reports: 25, files: 3, days: 92 },
    discipline: { name: 'Discipline', reports: 90, files: 3, days: 365 },
  };
  function newPlan(id) { var p = PLANS[id], now = Date.now(); return { id: id, startedAt: new Date(now).toISOString(), endsAt: new Date(now + p.days * 864e5).toISOString(), used: 0 }; }
  // A plan chosen on the pricing section arrives as ?plan=<id> (stands in for checkout on the website).
  var asked = (location.search.match(/[?&]plan=(single|snapshot|progress|discipline)\b/) || [])[1];
  var plan = store.get('pnllens.plan', null);
  var expired = function (p) { return !p || new Date(p.endsAt).getTime() < Date.now(); };
  if (asked && (!plan || plan.id !== asked || expired(plan) || plan.used >= PLANS[plan.id].reports)) { plan = newPlan(asked); store.set('pnllens.plan', plan); }
  if (!plan) { plan = newPlan('snapshot'); store.set('pnllens.plan', plan); }
  if (asked) history.replaceState(null, '', location.pathname + location.hash);
  var P = function () { return PLANS[plan.id]; };
  var reportsLeft = function () { return Math.max(0, P().reports - plan.used); };

  /* ---------- report library ---------- */
  var index = store.get('pnllens.reports', []);   // [{ id, createdAt, plan, files:[{name, fp}], score, net, n, currency }]
  var mem = {};                                    // fallback if IndexedDB is unavailable
  var dbp = new Promise(function (res) {
    try { var rq = indexedDB.open('pnllens', 1); rq.onupgradeneeded = function () { rq.result.createObjectStore('reports'); }; rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { res(null); }; } catch (e) { res(null); }
  });
  function dbPut(id, val) { return dbp.then(function (db) { if (!db) { mem[id] = val; return; } return new Promise(function (r) { var t = db.transaction('reports', 'readwrite'); t.objectStore('reports').put(val, id); t.oncomplete = r; t.onerror = r; }); }); }
  function dbGet(id) { return dbp.then(function (db) { if (!db) return mem[id] || null; return new Promise(function (r) { var q = db.transaction('reports').objectStore('reports').get(id); q.onsuccess = function () { r(q.result || null); }; q.onerror = function () { r(null); }; }); }); }
  var current = null;       // { id, createdAt, slots:[{name,size,raw,result,fp}|null x3] }
  var combined = null, view = null, handle = null, currentTab = 'overview', picked = [], pdfjsPromise = null, addTarget = null;

  function route() {
    var inApp = location.hash === '#app';
    appview.hidden = !inApp; if (landing) landing.hidden = inApp;
    if (inApp) window.scrollTo(0, 0);
    if (location.hash === '#top') { history.replaceState(null, '', location.pathname); window.scrollTo(0, 0); }
  }
  window.addEventListener('hashchange', route); route();
  Object.keys(E.CURSYM).forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; $('#currency').appendChild(o); });

  function loadPdfjs() {
    if (!pdfjsPromise) {
      var url = function (id) { var b = atob(document.getElementById(id).textContent.trim()), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return URL.createObjectURL(new Blob([u], { type: 'text/javascript' })); };
      var w = url('pdfjs-worker');
      pdfjsPromise = import(url('pdfjs-lib')).then(function (lib) { lib.GlobalWorkerOptions.workerSrc = w; return lib; });
    }
    return pdfjsPromise;
  }
  async function readFile(f) {
    var bytes = new Uint8Array(await f.arrayBuffer());
    return X.fileToRawSheets(XLSX, f.name, bytes, X.detectKind(f.name, bytes) === 'pdf' ? { pdfjs: await loadPdfjs() } : {});
  }
  var currency = function () { return $('#currency').value || undefined; };
  function analyse(raw) { var r = E.analyze(raw.map(function (s) { return E.parseSheetAuto(s.rows, s.name, s.file); }), currency() ? { currency: currency() } : undefined); return r.m.n ? r : null; }
  function buildCombined() {
    var ok = current ? current.slots.filter(function (s) { return s && s.result; }) : [];
    if (ok.length < 2) { combined = null; return; }
    var sheets = []; ok.forEach(function (s) { s.raw.forEach(function (r) { sheets.push(E.parseSheetAuto(r.rows, r.name, r.file)); }); });
    var r = E.analyze(sheets, currency() ? { currency: currency() } : undefined); combined = r.m.n ? r : null;
  }
  function fnv(str) { var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995; for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 16777619); h2 ^= c; h2 = Math.imul(h2, 2246822519); } return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16); }
  // fingerprint by the trades inside, so a renamed or re-saved copy of the same file still matches
  function fingerprint(result, raw) { return result ? 't' + fnv(result.trades.map(function (t) { return [t.symbol, t.exitDate || '', t.qty, Math.round(t.pnl)].join('|'); }).sort().join('\n')) : 'r' + fnv(JSON.stringify(raw).slice(0, 400000)); }

  /* ---------- messages ---------- */
  function lockMessage(title, text) { $('#lockTitle').textContent = title; $('#lockText').textContent = text; $('#lockMsg').hidden = false; clearTimeout(lockMessage.t); lockMessage.t = setTimeout(function () { $('#lockMsg').hidden = true; }, 12000); }
  $('#lockClose').addEventListener('click', function () { $('#lockMsg').hidden = true; });
  var planEndedText = function () { return expired(plan) ? 'Your ' + P().name + ' plan ended on ' + dayLabel(plan.endsAt) + ' ' + new Date(plan.endsAt).getFullYear() + '. Renew to create new reports; past reports stay listed on the left.' : 'You have used all ' + P().reports + ' report' + (P().reports === 1 ? '' : 's') + ' in your ' + P().name + ' plan. Renew or upgrade to create more; past reports stay listed on the left.'; };
  var filesFullText = function () { return 'This report already holds its ' + P().files + ' broker statement' + (P().files === 1 ? '' : 's') + '. You can re-open a statement already in this report, or start a new report.'; };
  function err(msg) { var e = $('#err'); e.textContent = msg || ''; e.hidden = !msg; }

  /* ---------- plan card + upload header ---------- */
  function renderPlan() {
    var p = P(), pct = Math.min(100, (plan.used / p.reports) * 100);
    var state = expired(plan) ? 'Ended ' : 'Valid till ';
    $('#planCard').innerHTML = '<div class="ws-plan-top"><b>' + p.name + ' plan</b></div>' +
      '<div class="ws-plan-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="ws-plan-sub"><span><b>' + plan.used + '</b> of ' + p.reports + ' report' + (p.reports === 1 ? '' : 's') + ' used</span><span class="' + (expired(plan) ? 'off' : 'till') + '">' + (expired(plan) ? 'Ended ' : 'Till ') + monthTag(plan.endsAt) + '</span></div>';
    var st = function (k) { return k + ' broker statement' + (k === 1 ? '' : 's'); };
    $('#upPlan').innerHTML = '<b>' + p.name + ' plan</b><span>' + reportsLeft() + ' of ' + p.reports + ' report' + (p.reports === 1 ? '' : 's') + ' left</span><span>Up to ' + st(p.files) + ' per report</span><span>' + (expired(plan) ? 'Ended ' : 'Valid till ') + monthTag(plan.endsAt) + '</span>';
    var dz = $('#dropTitle'); if (dz) dz.textContent = 'Add up to ' + st(p.files);
    var pn = $('#planNote');
    if (pn) pn.innerHTML = '<b class="def">1 file = one P&amp;L statement or tradebook downloaded from your broker.</b> Each report in your plan holds up to ' + p.files + ' of them (for example, ' + (p.files === 2 ? 'equity and F&amp;O statements, or statements from two brokers' : 'statements from up to three brokers') + '). Once a statement has been analysed its place is used, even if you remove it. Re-opening the same statement is always fine.';
  }

  /* ---------- upload screen ---------- */
  function renderPicked() {
    $('#fileList').innerHTML = picked.map(function (f, i) { return '<li><span>' + esc(f.name) + ' <span class="muted">· ' + Math.round(f.size / 1024) + ' KB</span></span><button data-rm="' + i + '" aria-label="Remove">×</button></li>'; }).join('');
    $('#analyse').disabled = !picked.length;
  }
  $('#fileList').addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (b) { picked.splice(+b.dataset.rm, 1); renderPicked(); } });
  function pick(list) {
    err('');
    Array.prototype.forEach.call(list || [], function (f) {
      var ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
      if (EXT.indexOf(ext) < 0) return err(f.name + ': use Excel, CSV, PDF or Word files.');
      if (f.size > MAX_BYTES) return err(f.name + ' is over 10MB.');
      if (picked.some(function (x) { return x.name === f.name && x.size === f.size; })) return;
      if (picked.length >= P().files) return err('Your ' + P().name + ' plan allows up to ' + P().files + ' broker statements per report.');
      picked.push(f);
    });
    renderPicked();
  }
  var drop = $('#drop'), input = $('#file');
  drop.addEventListener('click', function () { input.click(); });
  drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { pick(e.dataTransfer.files); });
  input.addEventListener('change', function () { pick(input.files); input.value = ''; });

  /* ---------- adding files (creates the report on first success, which uses one report from the plan) ---------- */
  async function loadInto(files, indices) {
    var blocked = [];
    for (var k = 0; k < files.length; k++) {
      var f = files[k], raw = await readFile(f), result = analyse(raw), fp = fingerprint(result, raw);
      if (!current) {
        if (expired(plan) || reportsLeft() <= 0) { lockMessage('No reports left in this plan', planEndedText()); return files.map(function (x) { return x.name; }); }
        current = { id: 'r' + Date.now().toString(36), createdAt: new Date().toISOString(), slots: [null, null, null] };
        plan.used++; store.set('pnllens.plan', plan);
        index.push({ id: current.id, createdAt: current.createdAt, plan: plan.id, files: [], score: null, net: null, n: 0, currency: null });
      }
      var used = current.usedFps = current.usedFps || [];   // every file ever analysed in this report (removal keeps its place)
      if (used.indexOf(fp) < 0 && used.length >= P().files) { blocked.push(f.name); continue; }
      if (used.indexOf(fp) < 0) used.push(fp);
      current.slots[indices[k]] = { name: f.name, size: f.size, raw: raw, result: result, fp: fp };
    }
    buildCombined(); await saveCurrent();
    if (blocked.length) lockMessage(blocked.length === 1 ? blocked[0] + ' wasn\'t added' : blocked.length + ' files weren\'t added', filesFullText());
    return blocked;
  }
  async function saveCurrent() {
    if (!current) return;
    var head = index.find(function (r) { return r.id === current.id; });
    var main = combined || (current.slots.find(function (s) { return s && s.result; }) || {}).result || null;
    head.files = current.slots.filter(Boolean).map(function (s) { return { name: s.name, fp: s.fp }; });
    head.score = main && main.progress ? main.progress.overall.score : null; head.net = main ? main.m.net : null; head.n = main ? main.m.n : 0; head.currency = main ? main.m.currency : null;
    head.from = main ? main.m.from : null; head.to = main ? main.m.to : null;
    store.set('pnllens.reports', index);
    await dbPut(current.id, { id: current.id, createdAt: current.createdAt, usedFps: current.usedFps || [], slots: current.slots.map(function (s) { return s ? { name: s.name, size: s.size, raw: s.raw, fp: s.fp } : null; }) });
  }
  $('#analyse').addEventListener('click', function () {
    if (!picked.length) return;
    if (!current && (expired(plan) || reportsLeft() <= 0)) { lockMessage('No reports left in this plan', planEndedText()); return; }
    $('#analyse').disabled = true; err('');
    var files = picked.slice(), base = current ? current.slots.findIndex(function (s) { return !s; }) : 0;
    withAnalysing(function () { return loadInto(files, files.map(function (_, i) { return base + i; })); }, { fileCount: files.length })
      .then(function () {
        picked = []; renderPicked(); renderPlan();
        if (!current || !current.slots.some(Boolean)) { $('#analyse').disabled = false; renderHistory(); return; }
        showReportView(); open(combined ? 'all' : firstSlot());
      })
      .catch(function (e) { err('Could not read the file: ' + e.message); $('#analyse').disabled = false; });
  });
  function firstSlot() { for (var i = 0; i < 3; i++) if (current && current.slots[i]) return i; return 0; }
  function showReportView() { $('#uploadView').hidden = true; $('#reportView').hidden = false; ['#newReport', '#csvBtn', '#pdfBtn'].forEach(function (s) { $(s).classList.remove('hide'); }); }

  /* ---------- sidebar: this report ---------- */
  var netHtml = function (v, cur) { E.setCurrency(cur || 'INR'); return '<span class="' + (v > 0 ? 'gain' : v < 0 ? 'loss' : '') + '">' + E.inr(v) + '</span>'; };
  function renderSide() {
    var files = P().files, slots = current ? current.slots : [null, null, null];
    var filled = slots.filter(Boolean).length, usedN = current ? (current.usedFps || []).length : 0;
    var h = '';
    if (files > 1) h += combined
      ? '<button class="ws-item all" role="tab" data-view="all" aria-selected="' + (view === 'all') + '"><b>All files</b><small>' + slots.filter(function (s) { return s && s.result; }).length + ' files · ' + combined.m.n + ' positions · ' + netHtml(combined.m.net, combined.m.currency) + '</small></button>'
      : '<div class="ws-item all disabled" aria-disabled="true"><b>All files</b><small>' + (filled < 2 ? 'Add another file to compare' : 'Needs 2 readable files') + '</small></div>';
    for (var i = 0; i < files; i++) {
      var s = slots[i];
      if (!s) { if (usedN >= files) continue; h += '<button class="ws-add" data-add="' + i + '" aria-label="Add a file"><i>+</i>Add statement</button>'; continue; }
      h += '<button class="ws-item' + (s.result ? '' : ' warn') + '" role="tab" data-view="' + i + '" aria-selected="' + (view === i) + '" title="' + esc(s.name) + '"><b>' + esc(s.name) + '</b><small>' +
        (s.result ? s.result.m.n + ' positions · ' + netHtml(s.result.m.net, s.result.m.currency) : 'No closed trades found') + '</small><span class="ws-x" role="button" tabindex="0" data-remove="' + i + '" aria-label="Remove ' + esc(s.name) + '">×</span></button>';
    }
    $('#sideList').innerHTML = h;
    $('#sideNote').innerHTML = '<span class="ws-used">Statements in this report: <b>' + usedN + ' of ' + files + '</b></span><br>One statement = one P&amp;L or tradebook file from your broker. Removing one doesn\'t free its place.';
    renderPlan(); renderHistory();
  }
  $('#sideList').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-remove]'); if (rm) { e.stopPropagation(); removeSlot(+rm.dataset.remove); return; }
    var add = e.target.closest('[data-add]');
    if (add) { if ((current.usedFps || []).length >= P().files) { lockMessage('No file places left', filesFullText()); return; } addTarget = +add.dataset.add; $('#addFile').click(); return; }
    var v = e.target.closest('[data-view]'); if (v) open(v.dataset.view === 'all' ? 'all' : +v.dataset.view);
  });
  $('#addFile').addEventListener('change', function () {
    var f = $('#addFile').files[0]; $('#addFile').value = '';
    if (!f || addTarget == null) return;
    var i = addTarget; addTarget = null;
    withAnalysing(function () { return loadInto([f], [i]); }, { fileCount: 1 }).then(function (b) { if (b && b.length) { renderSide(); return; } open(i); }).catch(function (e) { lockMessage('Could not read ' + f.name, e.message); });
  });
  function removeSlot(i) {
    current.slots[i] = null; buildCombined(); saveCurrent();
    if (!current.slots.some(Boolean)) { $('#reportView').hidden = true; $('#uploadView').hidden = false; ['#csvBtn', '#pdfBtn'].forEach(function (x) { $(x).classList.add('hide'); }); renderPlan(); return; }
    open(view === i || (view === 'all' && !combined) ? (combined ? 'all' : firstSlot()) : view);
  }

  /* ---------- sidebar: report history grouped by month (e.g. MAR-26) ---------- */
  function renderHistory() {
    var list = index.slice().sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
    var put = function (html) { $('#historyList').innerHTML = html; $('#historyList2').innerHTML = html; };
    if (!list.length) { put('<p class="ws-hist-empty">Your reports will appear here, grouped by month.</p>'); return; }
    var groups = {}, order = [];
    list.forEach(function (r) { var k = monthTag(r.createdAt); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(r); });
    put(order.map(function (k) {
      return '<div class="ws-hist-g"><div class="ws-hist-m">' + k + '<span>' + groups[k].length + '</span></div>' + groups[k].map(function (r) {
        var names = r.files.map(function (f) { return f.name; }).join(', ') || 'No statements yet';
        var label = r.title || names;
        return '<div class="ws-hist-i' + (current && current.id === r.id ? ' cur' : '') + '" data-row="' + r.id + '">' +
          '<button class="ws-hist-open" data-report="' + r.id + '" title="' + esc(r.title ? r.title + ' — ' + names : names) + '"><span class="d">' + dayLabel(r.createdAt) + '</span><span class="n' + (r.title ? ' named' : '') + '">' + esc(label) + '</span>' +
          '<span class="s">' + (r.score != null ? r.score : '–') + '</span></button>' +
          '<button class="ws-hist-ren" data-rename="' + r.id + '" aria-label="Rename report" title="Rename">✎</button></div>';
      }).join('') + '</div>';
    }).join(''));
  }
  ['#historyList', '#historyList2'].forEach(function (id) {
    $(id).addEventListener('click', function (e) {
      var rn = e.target.closest('[data-rename]'); if (rn) { e.stopPropagation(); startRename(rn.dataset.rename, rn.closest('.ws-hist-i')); return; }
      if (e.target.closest('.ws-hist-edit')) return;
      var b = e.target.closest('[data-report]'); if (b) openReport(b.dataset.report);
    });
  });
  /* rename a generated report (history list only); stored on the report's index entry */
  function startRename(id, row) {
    var r = index.find(function (x) { return x.id === id; }); if (!r || !row) return;
    var names = r.files.map(function (f) { return f.name; }).join(', ');
    row.innerHTML = '<div class="ws-hist-edit"><input maxlength="60" value="' + esc(r.title || '') + '" placeholder="' + esc(names || 'Report name') + '" aria-label="Report name"><button data-save title="Save">✓</button></div>';
    var inp = row.querySelector('input'), done = false;
    var finish = function (save) {
      if (done) return; done = true;
      if (save) { var v = inp.value.replace(/\s+/g, ' ').trim().slice(0, 60); r.title = v || undefined; store.set('pnllens.reports', index); if (current && current.id === id && view != null) open(view); }
      renderHistory();
    };
    inp.focus(); inp.select();
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    inp.addEventListener('blur', function () { setTimeout(function () { finish(true); }, 120); });
    row.querySelector('[data-save]').addEventListener('mousedown', function (e) { e.preventDefault(); finish(true); });
  }
  async function openReport(id) {
    if (current && current.id === id) { open(view == null ? (combined ? 'all' : firstSlot()) : view); return; }
    var saved = await dbGet(id);
    if (!saved) { lockMessage('Report not available on this device', 'This report was created on another browser or its data was cleared. Its summary stays in your history.'); return; }
    await withAnalysing(function () {
      current = { id: saved.id, createdAt: saved.createdAt, usedFps: saved.usedFps || [], slots: saved.slots.map(function (s) { return s ? { name: s.name, size: s.size, raw: s.raw, fp: s.fp, result: analyse(s.raw) } : null; }) };
      buildCombined();
    }, { fileCount: saved.slots.filter(Boolean).length || 1, stepMs: 200 });
    showReportView(); open(combined ? 'all' : firstSlot());
  }

  /* ---------- main area ---------- */
  function cur() { return view === 'all' ? combined : (current && current.slots[view] && current.slots[view].result); }
  function checkups() { return index.filter(function (r) { return r.score != null; }).map(function (r) { return { savedAt: r.createdAt, to: r.to, score: r.score, label: r.files.map(function (f) { return f.name; }).join(', ') }; }); }
  function open(v) {
    view = v; renderSide();
    var r = cur(), s = v === 'all' ? null : current.slots[v];
    if (handle) { var sel = document.querySelector('#reportRoot .tabs [aria-selected="true"]'); if (sel) currentTab = sel.dataset.tab; handle.destroy(); handle = null; }
    ['overview', 'progress', 'insights', 'clusters', 'positions'].forEach(function (id) { $('#' + id).innerHTML = ''; });
    $('#slotEmpty').hidden = true; $('#reportRoot').hidden = false;
    var head = index.find(function (x) { return x.id === current.id; });
    var stamp = (head && head.title ? '“' + head.title + '”  ·  ' : '') + 'Report of ' + dayLabel(current.createdAt) + ' ' + new Date(current.createdAt).getFullYear();
    if (v === 'all') { $('#reportTitle').textContent = 'All files'; $('#reportMeta').textContent = stamp + '  ·  ' + current.slots.filter(function (x) { return x && x.result; }).map(function (x) { return x.name; }).join(' + '); }
    else { $('#reportTitle').textContent = s ? s.name : 'Report'; $('#reportMeta').textContent = stamp + (r && r.m.from ? '  ·  trades ' + r.m.from + ' to ' + r.m.to : ''); }
    if (!r) { if (s) { $('#reportRoot').hidden = true; $('#slotEmpty').hidden = false; $('#slotEmptyName').textContent = s.name; $('#csvBtn').disabled = true; } return; }
    E.setCurrency(r.m.currency);
    handle = mountReport($('#reportRoot'), r, { inr: E.inr, pct: E.pct, history: checkups() });
    if (currentTab !== 'overview') handle.show(currentTab);
    $('#csvBtn').disabled = false; window.scrollTo(0, 0);
  }

  /* ---------- header actions ---------- */
  function newReport() {
    if (handle) { handle.destroy(); handle = null; }
    current = null; combined = null; view = null; currentTab = 'overview';
    $('#reportView').hidden = true; $('#uploadView').hidden = false; picked = []; renderPicked(); err('');
    ['#newReport', '#csvBtn', '#pdfBtn'].forEach(function (s) { $(s).classList.add('hide'); }); renderPlan(); renderHistory();
  }
  $('#newReport').addEventListener('click', function () {
    if (expired(plan) || reportsLeft() <= 0) { lockMessage('No reports left in this plan', planEndedText()); return; }
    $('#cnText') && ($('#cnText').textContent = 'This closes the current report. Your next report will use 1 of the ' + reportsLeft() + ' reports left in your ' + P().name + ' plan.');
    $('#confirmNew').hidden = false; $('#cnNo').focus();
  });
  $('#cnNo').addEventListener('click', function () { $('#confirmNew').hidden = true; });
  $('#cnYes').addEventListener('click', function () { $('#confirmNew').hidden = true; newReport(); });
  $('#pdfBtn').addEventListener('click', function () { window.print(); });
  $('#csvBtn').addEventListener('click', function () {
    var r = cur(); if (!r) return;
    var cols = ['symbol', 'group', 'market', 'direction', 'entryDate', 'exitDate', 'entryHour', 'holdDays', 'qty', 'avgBuy', 'buy', 'sell', 'pct', 'pnl', 'netEst'];
    var q = function (v) { return v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : '"' + String(v).replace(/"/g, '""') + '"'; };
    var rows = [cols.join(',')].concat(r.trades.map(function (t) { return cols.map(function (c) { return q(t[c]); }).join(','); }));
    var name = view === 'all' ? 'all-files' : current.slots[view].name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-');
    var url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    var a = document.createElement('a'); a.href = url; a.download = 'pnl-lens-' + name + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // history is also visible from the upload screen
  renderPlan(); renderHistory();
})();
