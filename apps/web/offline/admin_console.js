/**
 * @file  apps/web/offline/admin_console.js
 * @area  Offline
 * @what  Standalone admin dashboard renderer with a "view as role" switcher.
 */
/* Standalone admin console (demo build). Same layout as /admin on the website; data is a snapshot.
 * "View as" applies the same permission table the server enforces (lib/admin/rbac.ts). */
(function () {
  var D = window.ADMIN_DATA, $ = function (s) { return document.querySelector(s); };
  var PERMS = { owner: ['users', 'finance', 'errors', 'support', 'product', 'pii', 'roles', 'lookup'], admin: ['users', 'errors', 'support', 'product', 'pii', 'roles', 'lookup'], support: ['errors', 'support', 'pii', 'lookup'], finance: ['finance'], analyst: ['users', 'product'] };
  var TABS = [['users', 'Users'], ['finance', 'Finance'], ['errors', 'Errors'], ['support', 'Support'], ['product', 'Product']];
  var role = 'owner', tab = 'users';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var n = function (v) { return Number(v || 0); };
  var money = function (m, c) { return (c === 'USD' ? '$' : '₹') + (n(m) / 100).toLocaleString(c === 'USD' ? 'en-US' : 'en-IN', { maximumFractionDigits: 0 }); };
  var ago = function (d) { var s = (new Date(D.capturedAt).getTime() - new Date(d).getTime()) / 1000; return s < 3600 ? Math.max(1, Math.round(s / 60)) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
  var kpi = function (l, v, sub, tone) { return '<div class="rv-kpi"><div class="rv-kl">' + l + '</div><div class="rv-kv ' + (tone || '') + '">' + v + '</div><div class="rv-ks">' + (sub || '') + '</div></div>'; };
  var panel = function (t, sub, span, body) { return '<div class="rv-panel ' + (span || 's12') + '"><div class="rv-ph"><h3>' + t + '</h3>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>' + body + '</div>'; };
  var bars = function (rows, k, lab, col) { var mx = Math.max.apply(null, [1].concat(rows.map(function (r) { return n(r[k]); }))), step = Math.ceil(rows.length / 8); return '<div class="ad-bars">' + rows.map(function (r, i) { return '<div title="' + esc(lab(r)) + ': ' + r[k] + '"><i style="height:' + (n(r[k]) / mx) * 100 + '%;background:' + (col || 'var(--y)') + '"></i><span>' + (i % step === 0 ? esc(lab(r)) : '') + '</span></div>'; }).join('') + '</div>'; };
  var table = function (cols, rows) { return '<div class="rv-tw"><table class="rv-t"><thead><tr>' + cols.map(function (c) { return '<th class="' + (c[2] || '') + '">' + c[0] + '</th>'; }).join('') + '</tr></thead><tbody>' + (rows.length ? rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td class="' + (c[2] || '') + '">' + c[1](r) + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="' + cols.length + '" class="mut">Nothing yet.</td></tr>') + '</tbody></table></div>'; };
  var can = function (p) { return PERMS[role].indexOf(p) >= 0; };

  function users() {
    var d = D.users, k = d.k, stick = k.mau ? Math.round(k.dau / k.mau * 100) : 0, ret = d.retention.cohort ? Math.round(d.retention.retained / d.retention.cohort * 100) : 0;
    var h = '<div class="rv-kpis s12 ad-k6">' + kpi('DAU', k.dau, 'active today') + kpi('WAU', k.wau, 'last 7 days') + kpi('MAU', k.mau, 'last 30 days') + kpi('Stickiness', stick + '%', 'DAU ÷ MAU') + kpi('New users', k.new_7d, k.new_1d + ' today · ' + k.new_30d + ' in 30 days') + kpi('Repeat users', k.repeat_30d, k.repeat_reporters + ' with 2+ reports') + '</div>';
    h += panel('Daily active users', 'last 30 days', 's7', bars(d.daily, 'active', function (r) { return r.day.slice(5); }));
    h += panel('New sign-ups', 'last 30 days', 's5', bars(d.daily, 'new', function (r) { return r.day.slice(5); }, 'var(--gain)'));
    h += panel('30-day retention', 'users who joined 30–60 days ago', 's4', '<div class="ad-big">' + ret + '%</div><p class="muted">' + d.retention.retained + ' of ' + d.retention.cohort + ' came back in the last 30 days.</p>');
    h += panel('Users by country', '', 's4', table([['Country', function (r) { return esc(r.country); }], ['Users', function (r) { return r.n; }, 'n']], d.countries));
    h += panel('Total users', '', 's4', '<div class="ad-big">' + k.total + '</div><p class="muted">All accounts ever created.</p>');
    if (can('pii')) h += panel('Latest sign-ups', '', 's12', table([['Email', function (r) { return esc(r.email); }], ['Country', function (r) { return esc(r.country); }], ['Joined', function (r) { return ago(r.created_at); }], ['Last sign-in', function (r) { return r.last_login_at ? ago(r.last_login_at) : '—'; }]], d.recent));
    if (can('roles')) h += panel('Team & roles', 'who can see what', 's12', '<div class="filters"><input placeholder="teammate@email.com" aria-label="Email" id="roleEmail"><select id="roleSel">' + ['admin', 'support', 'finance', 'analyst', 'user'].concat(role === 'owner' ? ['owner'] : []).map(function (r) { return '<option>' + r + '</option>'; }).join('') + '</select><button class="btn" id="roleSet">Set role</button></div><p class="muted" id="roleMsg"></p><p class="rv-note">Owner: everything · Admin: all but finance · Support: errors, support, user lookup · Finance: finance only · Analyst: user and product metrics without emails.</p>');
    return h;
  }
  function finance() {
    var d = D.finance, k = d.k, months = Array.from(new Set(d.byMonth.map(function (r) { return r.month; }).concat(d.costs.map(function (r) { return r.month; })))).sort();
    var sumBy = function (rows, m, c, f) { return rows.filter(function (r) { return r.month === m && r.currency === c; }).reduce(function (s, r) { return s + n(r[f]); }, 0); };
    var pl = months.map(function (m) { var rev = sumBy(d.byMonth, m, 'INR', 'revenue'), ref = sumBy(d.byMonth, m, 'INR', 'refunds'), fee = sumBy(d.fees, m, 'INR', 'fees'), cost = sumBy(d.costs, m, 'INR', 'amount'); return { month: m, rev: rev, ref: ref, fee: fee, cost: cost, margin: rev - ref - fee - cost, usd: sumBy(d.byMonth, m, 'USD', 'revenue') }; });
    var h = '<div class="rv-kpis s12 ad-k6">' + kpi('Revenue (₹)', money(k.inr_30d, 'INR'), 'last 30 days', 'gain') + kpi('Revenue ($)', money(k.usd_30d, 'USD'), 'last 30 days', 'gain') + kpi('Paying customers', k.payers_30d, k.orders_30d + ' orders') + kpi('ARPPU (₹)', k.payers_30d ? money(n(k.inr_30d) / k.payers_30d) : '—', 'per paying customer') + kpi('Failed payments', k.failed_30d, 'last 30 days', k.failed_30d ? 'loss' : '') + kpi('Refunds', money(k.refunds_30d), 'last 30 days') + '</div>';
    h += panel('Revenue by month (₹)', '', 's7', bars(pl, 'rev', function (r) { return r.month.slice(2); }, 'var(--gain)'));
    h += panel('Plan mix', 'paid orders', 's5', table([['Plan', function (r) { return esc(r.plan); }], ['Currency', function (r) { return r.currency; }], ['Orders', function (r) { return r.n; }, 'n'], ['Revenue', function (r) { return money(r.revenue, r.currency); }, 'n']], d.plans));
    h += panel('Monthly P&L (₹)', 'revenue − refunds − gateway fees − running costs', 's12', table([['Month', function (r) { return r.month; }], ['Revenue', function (r) { return money(r.rev); }, 'n'], ['Refunds', function (r) { return money(r.ref); }, 'n'], ['Gateway fees', function (r) { return money(r.fee); }, 'n'], ['Running costs', function (r) { return money(r.cost); }, 'n'], ['Margin', function (r) { return '<b class="' + (r.margin >= 0 ? 'gain' : 'loss') + '">' + money(r.margin) + '</b>'; }, 'n'], ['Revenue ($)', function (r) { return money(r.usd, 'USD'); }, 'n']], pl) + '<p class="rv-note">Running costs come from monthly cost entries (hosting, database, email, marketing…). Gateway fees are estimated at 2% (INR) and 3% (international).</p>');
    return h;
  }
  function errors() {
    var d = D.errors;
    var h = '<div class="rv-kpis s12">' + kpi('Errors (24h)', d.k.e24, '', d.k.e24 ? 'loss' : '') + kpi('Distinct issues (24h)', d.k.kinds24) + kpi('Users affected (24h)', d.k.users24) + kpi('Errors (7 days)', d.k.e7d) + '</div>';
    h += panel('Errors per hour', 'last 24 hours', 's12', bars(d.hourly, 'n', function (r) { return r.hour; }, 'var(--loss)'));
    h += panel('Error center', 'grouped by cause, most active first', 's12', table([['Issue', function (r) { return '<b>' + esc(r.message) + '</b><div class="mut" style="font-size:12px">' + esc(r.source) + ' · ' + esc(r.route || '—') + ' · #' + esc(r.fingerprint) + '</div>'; }], ['24h', function (r) { return '<b class="' + (r.last_24h ? 'loss' : '') + '">' + r.last_24h + '</b>'; }, 'n'], ['14 days', function (r) { return r.total; }, 'n'], ['Users', function (r) { return r.users; }, 'n'], ['Last seen', function (r) { return ago(r.last_seen); }, 'n'], ['First seen', function (r) { return ago(r.first_seen); }, 'n']], d.groups));
    return h;
  }
  function support() {
    var d = D.support;
    var h = '<div class="rv-kpis s12">' + kpi('Open tickets', d.k.open, '', d.k.open ? 'loss' : '') + kpi('In progress', d.k.in_progress) + kpi('Resolved (7 days)', d.k.resolved_7d, '', 'gain') + kpi('Avg time to resolve', d.k.avg_hours + 'h', 'last 30 days') + '</div>';
    h += panel("Find a user's issue", 'profile, likely cause and full timeline', 's12', '<div class="filters"><input id="lookEmail" placeholder="customer@email.com" aria-label="Customer email" list="lookList"><datalist id="lookList">' + Object.keys(D.lookups).map(function (e) { return '<option value="' + esc(e) + '">'; }).join('') + '</datalist><button class="btn" id="lookBtn">Look up</button></div><div id="lookOut"></div><p class="rv-note">Demo: try ' + Object.keys(D.lookups).slice(0, 3).map(esc).join(', ') + '.</p>');
    h += panel('Tickets', 'open first, then by priority', 's7', table([['Customer', function (r) { return '<b>' + esc(r.subject) + '</b><div class="mut" style="font-size:12px">' + esc(r.email) + ' · ' + ago(r.created_at) + (r.related_errors ? ' · ' + r.related_errors + ' related error(s)' : '') + '</div>'; }], ['Priority', function (r) { return esc(r.priority); }], ['Status', function (r, i) { return '<select data-ticket="' + r.id + '" aria-label="Status">' + ['open', 'in_progress', 'resolved'].map(function (s) { return '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>'; }]], d.tickets));
    h += panel('Users having trouble', 'errors or unreadable uploads, last 7 days', 's5', table([['User', function (r) { return esc(r.email); }], ['Errors', function (r) { return r.errors; }, 'n'], ['Failed uploads', function (r) { return r.failed_uploads; }, 'n'], ['Last', function (r) { return ago(r.last_at); }, 'n']], d.struggling));
    return h;
  }
  function lookup(email) {
    var u = D.lookups[(email || '').trim().toLowerCase()];
    if (!u) return '<p class="status err">No user with that email.</p>';
    var prof = [['Email', u.user.email], ['Role', u.user.role], ['Country', u.user.country || '—'], ['Joined', ago(u.user.created_at)], ['Last sign-in', u.user.last_login_at ? ago(u.user.last_login_at) : '—'], ['Credits', u.user.credits || 0]];
    return '<div class="ad-user"><div class="ad-diag"><span>Likely cause</span><b>' + esc(u.diagnosis) + '</b></div><div class="ad-prof">' + prof.map(function (p) { return '<div><span>' + p[0] + '</span><b>' + esc(p[1]) + '</b></div>'; }).join('') + '</div>' +
      table([['When', function (r) { return ago(r.at); }], ['Type', function (r) { return '<span class="ad-kind ' + esc(r.kind) + '">' + esc(r.kind) + '</span>'; }], ['What', function (r) { return esc(r.title); }], ['Detail', function (r) { return '<span class="mut" style="font-size:12px">' + esc(String(r.detail || '').slice(0, 140)) + '</span>'; }]], u.timeline) + '</div>';
  }
  function product() {
    var d = D.product, k = d.k, fr = k.started_30d ? Math.round(k.failed_30d / k.started_30d * 100) : 0;
    var h = '<div class="rv-kpis s12">' + kpi('Reports (30 days)', k.reports_30d, k.reports_1d + ' today') + kpi('Files per report', k.files_per_report || 0) + kpi('Upload failure rate', fr + '%', k.failed_30d + ' of ' + k.started_30d + ' uploads', fr > 5 ? 'loss' : '') + kpi('Uploads started', k.started_30d, 'last 30 days') + '</div>';
    h += panel('Reports created', 'last 30 days', 's7', bars(d.daily, 'reports', function (r) { return r.day.slice(5); }));
    h += panel('Most-used tabs', '', 's5', table([['Tab', function (r) { return esc(r.tab); }], ['Views', function (r) { return r.n; }, 'n']], d.tabs));
    h += panel('Why uploads fail', 'reason and file type', 's7', table([['Reason', function (r) { return esc(r.reason); }], ['File type', function (r) { return esc(r.ext); }], ['Count', function (r) { return r.n; }, 'n']], d.failures));
    h += panel('Brokers seen', '', 's5', table([['Broker / source', function (r) { return esc(r.broker); }], ['Reports', function (r) { return r.n; }, 'n']], d.brokers));
    return h;
  }
  var R = { users: users, finance: finance, errors: errors, support: support, product: product };
  function render() {
    var allowed = TABS.filter(function (t) { return can(t[0]); });
    if (!allowed.some(function (t) { return t[0] === tab; })) tab = allowed[0][0];
    $('#adRole').textContent = role;
    $('#adTabs').innerHTML = allowed.map(function (t) { return '<button role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + t[1] + '</button>'; }).join('');
    $('#adBody').innerHTML = R[tab]();
    var g = $('#adBody'); g.classList.remove('rv-enter'); void g.offsetWidth; g.classList.add('rv-enter');
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab]'); if (t && t.closest('#adTabs')) { tab = t.dataset.tab; render(); return; }
    var v = e.target.closest('[data-role]'); if (v) { role = v.dataset.role; document.querySelectorAll('[data-role]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === v)); }); render(); return; }
    if (e.target.id === 'lookBtn') { $('#lookOut').innerHTML = lookup($('#lookEmail').value); return; }
    if (e.target.id === 'roleSet') { var em = $('#roleEmail').value.trim(); $('#roleMsg').textContent = !em ? 'Enter an email.' : em === 'owner@pnllens.com' ? 'You can’t change your own role.' : em + ' would become ' + $('#roleSel').value + ' (demo: not saved).'; }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'lookEmail') $('#lookOut').innerHTML = lookup(e.target.value); });
  document.addEventListener('change', function (e) {
    var s = e.target.closest('[data-ticket]'); if (!s) return;
    var t = D.support.tickets.find(function (x) { return String(x.id) === s.dataset.ticket; }); if (t) t.status = s.value;
  });
  $('#adStamp').textContent = 'Snapshot ' + new Date(D.capturedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  render();
})();
