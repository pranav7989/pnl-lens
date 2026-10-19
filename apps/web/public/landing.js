/* PnL Lens landing motion. Progressive: without this file the page is complete and static. */
(function () {
  var root = document.querySelector('.lp');
  if (!root) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) document.documentElement.classList.add('js-motion');

  /* nav: border on scroll + mobile menu */
  var nav = root.querySelector('[data-nav]'), burger = root.querySelector('[data-burger]');
  var onScroll = function () { nav && nav.classList.toggle('scrolled', window.scrollY > 8); };
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  if (burger) {
    burger.addEventListener('click', function () {
      var open = burger.getAttribute('aria-expanded') !== 'true';
      burger.setAttribute('aria-expanded', String(open)); burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      nav.classList.toggle('open', open);
    });
    nav.querySelectorAll('.lp-links a').forEach(function (a) { a.addEventListener('click', function () { burger.setAttribute('aria-expanded', 'false'); nav.classList.remove('open'); }); });
  }

  /* number counters */
  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count')), dec = +(el.getAttribute('data-decimals') || 0);
    var prefix = el.getAttribute('data-prefix') || '', neg = target < 0, abs = Math.abs(target), t0 = null, dur = 1400;
    var fmt = function (v) {
      var s = dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-IN');
      return (neg ? '−' : '') + prefix + s;
    };
    if (reduce) { el.textContent = fmt(abs); return; }
    (function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(abs * e);
      if (p < 1) requestAnimationFrame(step);
    })(performance.now());
  }

  /* one observer drives every scroll-triggered effect */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target;
      el.classList.add('in');
      el.querySelectorAll ? el.querySelectorAll('[data-count]').forEach(countUp) : null;
      if (el.hasAttribute('data-count')) countUp(el);
      if (el.hasAttribute('data-rules')) {
        el.querySelectorAll('li').forEach(function (li, i) { setTimeout(function () { li.classList.add('done'); }, reduce ? 0 : 350 + i * 380); });
      }
      io.unobserve(el);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  root.querySelectorAll('[data-reveal],[data-flag],[data-rules],[data-whatif]').forEach(function (el) { io.observe(el); });

  /* signature: lens scans the ledger, flagging the bad trades it passes */
  var scan = root.querySelector('.lp-scan'), lens = root.querySelector('[data-lens]'), foot = root.querySelector('[data-scan-foot]');
  var rows = [].slice.call(root.querySelectorAll('[data-row]'));
  if (scan && lens && rows.length) {
    if (reduce) { rows.forEach(function (r) { if (r.classList.contains('is-bad')) r.classList.add('flagged'); }); foot && foot.classList.add('show'); }
    else {
      var CYCLE = 8000, HOLD = 3000, t0 = null, visible = true, lastPhase = -1;
      new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(scan);
      var tick = function (ts) {
        if (!t0) t0 = ts;
        if (visible) {
          var list = scan.querySelector('.lp-ledger'), top = list.offsetTop, h = list.offsetHeight, lh = lens.offsetHeight;
          var t = (ts - t0) % (CYCLE + HOLD), p = Math.min(1, t / CYCLE);
          var ease = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          var y = top - lh / 2 + ease * h;
          lens.style.transform = 'translate3d(0,' + (y - 40).toFixed(1) + 'px,0)';   // straight down the ledger, no sideways wobble
          var centre = y;
          if (t < 40 && lastPhase !== 0) { rows.forEach(function (r) { r.classList.remove('flagged'); }); foot && foot.classList.remove('show'); lastPhase = 0; }
          rows.forEach(function (r) { if (r.classList.contains('is-bad') && !r.classList.contains('flagged') && centre > r.offsetTop + r.offsetHeight * 0.55) r.classList.add('flagged'); });
          if (p >= 1 && lastPhase !== 1) { foot && foot.classList.add('show'); lens.style.opacity = '0'; lastPhase = 1; }
          if (p < 1 && lens.style.opacity === '0') lens.style.opacity = '1';
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  /* report tabs (roving tabindex, arrow keys) */
  var tabs = root.querySelector('[data-tabs]');
  if (tabs) {
    var btns = [].slice.call(tabs.querySelectorAll('[role=tab]'));
    var select = function (b, focus) {
      btns.forEach(function (x) {
        var on = x === b; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(x.getAttribute('aria-controls'));
        if (panel) { panel.hidden = !on; if (on) { panel.style.animation = 'none'; panel.offsetHeight; panel.style.animation = ''; } }
      });
      if (focus) b.focus();
    };
    btns.forEach(function (b, i) {
      b.addEventListener('click', function () { select(b); });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); select(btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length], true); }
      });
    });
  }

  /* sample dashboard: five tabs; auto-advance while visible until the visitor clicks */
  var dx = root.querySelector('[data-dx]');
  if (dx) {
    var dbtn = [].slice.call(dx.querySelectorAll('[data-dx-tab]')), dpan = [].slice.call(dx.querySelectorAll('[data-dx-panel]'));
    var cur = 0, userTook = false, seen = false, timer = null;
    var showDx = function (i) {
      cur = i;
      dbtn.forEach(function (b, j) { b.setAttribute('aria-selected', String(j === i)); });
      dpan.forEach(function (p, j) { p.hidden = j !== i; p.classList.remove('in'); });
      var pnl = dpan[i]; void pnl.offsetWidth; requestAnimationFrame(function () { pnl.classList.add('in'); });
    };
    dbtn.forEach(function (b, i) { b.addEventListener('click', function () { userTook = true; clearInterval(timer); showDx(i); }); });
    dpan.forEach(function (p, j) { if (j) p.classList.remove('in'); });
    dpan[0].classList.remove('in');
    new IntersectionObserver(function (e) {
      if (!e[0].isIntersecting) { clearInterval(timer); return; }
      if (!seen) { seen = true; showDx(0); }
      if (!userTook && !reduce) { clearInterval(timer); timer = setInterval(function () { showDx((cur + 1) % dpan.length); }, 5200); }
    }, { threshold: 0.3 }).observe(dx);
    if (reduce) dpan.forEach(function (p) { p.classList.add('in'); });
  }

  /* REQ-4: pricing view and scroll depth (anonymous, allow-listed by the API), and the "See plans" pill */
  var region = root.getAttribute('data-region') || '';
  var send = function (name, props) {
    try { fetch('/api/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, props: props }), keepalive: true }).catch(function () {}); } catch (e) { /* ignore */ }
  };
  var pricing = document.getElementById('pricing'), hero = root.querySelector('.lp-hero'), pill = root.querySelector('[data-pill]');
  var pastHero = false, pricingOn = false, pricingSeen = false, footOn = false;
  var showPill = function () { if (pill) pill.hidden = !(pastHero && !pricingOn && !footOn); };
  if ('IntersectionObserver' in window) {
    if (pricing) new IntersectionObserver(function (es) {
      pricingOn = es[0].isIntersecting; showPill();
      if (pricingOn && !pricingSeen) { pricingSeen = true; send('pricing_viewed', { region: region, from: 'landing' }); }
    }, { threshold: 0.15 }).observe(pricing);
    if (hero) new IntersectionObserver(function (es) { pastHero = !es[0].isIntersecting && es[0].boundingClientRect.top < 0; showPill(); }).observe(hero);
    // the pill would cover the footer links and icons: hide it while the footer is on screen
    var footer = root.querySelector('.lp-foot');
    if (footer) new IntersectionObserver(function (es) { footOn = es[0].isIntersecting; showPill(); }).observe(footer);
  }
  if (pill) pill.addEventListener('click', function () { pill.hidden = true; });
  var depths = [25, 50, 75, 100], sent = {};
  var onDepth = function () {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var pct = max > 0 ? Math.round((window.scrollY / max) * 100) : 100;
    depths.forEach(function (d) { if (pct >= d && !sent[d]) { sent[d] = true; send('landing_scroll_depth', { depth: d, region: region }); } });
  };
  window.addEventListener('scroll', onDepth, { passive: true });

  /* REQ-6: Instagram row — follows the page scroll from card 1 to card 4 until the visitor moves it by hand */
  var ig = root.querySelector('[data-ig]'), rail = root.querySelector('[data-ig-rail]'), bar = root.querySelector('[data-ig-progress]');
  if (ig && rail) {
    var auto = !reduce, ticking = false;
    var maxScroll = function () { return Math.max(0, rail.scrollWidth - rail.clientWidth); };
    var setBar = function () { var m = maxScroll(); if (bar) bar.style.transform = 'scaleX(' + (m > 0 ? rail.scrollLeft / m : 1).toFixed(3) + ')'; };
    var follow = function () {
      ticking = false; if (!auto) return;
      var vh = window.innerHeight, r = rail.getBoundingClientRect();
      var p = Math.min(1, Math.max(0, (vh - r.top) / (0.75 * vh + 0.35 * r.height)));
      rail.scrollLeft = p * maxScroll(); setBar();
    };
    window.addEventListener('scroll', function () { if (auto && !ticking) { ticking = true; requestAnimationFrame(follow); } }, { passive: true });
    window.addEventListener('resize', function () { if (auto) requestAnimationFrame(follow); else setBar(); });
    rail.addEventListener('scroll', setBar, { passive: true });
    // manual takes over for the rest of this page view; the row then snaps card by card
    var takeOver = function () { if (!auto) return; auto = false; rail.classList.add('manual'); };
    ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) { rail.addEventListener(t, takeOver, { passive: true }); });
    rail.addEventListener('wheel', function (e) { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) takeOver(); }, { passive: true });
    rail.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var item = rail.querySelector('.ig-item'), step = item ? item.getBoundingClientRect().width + 20 : 300;
      rail.scrollBy({ left: e.key === 'ArrowRight' ? step : -step, behavior: reduce ? 'auto' : 'smooth' }); e.preventDefault();
    });
    if (reduce) rail.classList.add('manual');
    requestAnimationFrame(function () { follow(); setBar(); });
    if ('IntersectionObserver' in window) {
      var seen = false;
      new IntersectionObserver(function (es) { if (es[0].isIntersecting && !seen) { seen = true; send('ig_section_view', { site: region }); } }, { threshold: 0.25 }).observe(ig);
      // self-hosted reels: muted, play while at least 60% of the card is visible; never with reduced motion
      var played = {};
      if (!reduce) [].slice.call(rail.querySelectorAll('[data-ig-video]')).forEach(function (v) {
        new IntersectionObserver(function (es) {
          var n = v.getAttribute('data-ig-video');
          if (es[0].intersectionRatio >= 0.6) { var pr = v.play(); if (pr && pr.then) pr.then(function () { if (!played[n]) { played[n] = 1; send('ig_card_play', { card: +n, site: region }); } }).catch(function () {}); }
          else v.pause();
        }, { threshold: [0, 0.6, 1] }).observe(v);
      });
    }
    rail.addEventListener('click', function (e) {
      var c = e.target.closest && e.target.closest('[data-ig-card]'); if (c) send('ig_card_click', { card: +c.getAttribute('data-ig-card'), site: region });
      var f = e.target.closest && e.target.closest('[data-ig-follow]'); if (f) send('ig_follow_click', { site: region });
    });
  }

  /* motion (19 Oct 2026): pointer tilt on the hero ledger, spotlight on the final call to action, active nav link */
  if (!reduce && window.matchMedia('(hover: hover) and (min-width: 1081px)').matches) {
    var scanCard = root.querySelector('.lp-scan');
    if (scanCard) {
      scanCard.addEventListener('pointermove', function (e) {
        var r = scanCard.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        scanCard.classList.add('tilt');
        scanCard.style.setProperty('--ry', (x * 5).toFixed(2) + 'deg'); scanCard.style.setProperty('--rx', (-y * 4).toFixed(2) + 'deg');
      });
      scanCard.addEventListener('pointerleave', function () { scanCard.style.setProperty('--ry', '0deg'); scanCard.style.setProperty('--rx', '0deg'); });
    }
    var fin = root.querySelector('.lp-final');
    if (fin) {
      fin.addEventListener('pointermove', function (e) {
        var r = fin.getBoundingClientRect();
        fin.classList.add('lit'); fin.style.setProperty('--mx', (e.clientX - r.left) + 'px'); fin.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
      fin.addEventListener('pointerleave', function () { fin.classList.remove('lit'); });
    }
  }
  if ('IntersectionObserver' in window) {
    var navLinks = [].slice.call(root.querySelectorAll('.lp-links > a[href^="#"]'));
    var bySection = {};
    navLinks.forEach(function (a) { var s = document.getElementById(a.getAttribute('href').slice(1)); if (s) bySection[s.id] = a; });
    var current = null;
    var navIo = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        var a = bySection[en.target.id]; if (!a) return;
        if (en.isIntersecting) { if (current && current !== a) current.removeAttribute('aria-current'); a.setAttribute('aria-current', 'true'); current = a; }
        else if (current === a) { a.removeAttribute('aria-current'); current = null; }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(bySection).forEach(function (id) { navIo.observe(document.getElementById(id)); });
  }

  /* REQ-5: social icon clicks (header, footer, Instagram section) */
  root.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-social]');
    if (a) send('social_click', { network: a.getAttribute('data-social'), placement: a.getAttribute('data-placement') || 'header', region: region });
    /* REQ-7: a blog card in the landing preview */
    var b = e.target.closest && e.target.closest('[data-blog-preview]');
    if (b) send('blog_preview_click', { slug: b.getAttribute('data-blog-preview'), site: region });
  });
})();