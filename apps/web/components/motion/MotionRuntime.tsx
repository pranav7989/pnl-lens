'use client';
/**
 * @file  apps/web/components/motion/MotionRuntime.tsx
 * @area  Styles
 * @what  One small runtime for the motion system: reveal-on-scroll ([data-reveal] → .in), stagger indexes, sliding tab ink under every .tabs bar, count-ups ([data-count-up]), header glass on scroll, smooth in-page anchors.
 */
/**
 * Progressive and safe: elements already on screen are marked revealed before html.mo is set, so nothing flickers
 * and nothing is hidden if this never runs. One IntersectionObserver and one MutationObserver for the whole app
 * (content rendered later — report tabs, admin tables — is picked up). Reduced motion: nothing here runs.
 */
import { useEffect, useLayoutEffect } from 'react';

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function countUp(el: HTMLElement) {
  if (el.children.length) return;                                 // only plain-text values (never touch nested markup)
  const final = el.textContent || '';
  const m = final.match(/-?[\d,]*\.?\d+/);
  if (!m) return;
  const target = Number(m[0].replace(/,/g, ''));
  if (!Number.isFinite(target) || target === 0) return;
  const decimals = (m[0].split('.')[1] || '').length, grouped = m[0].includes(','), t0 = performance.now(), dur = 900;
  const fmt = (v: number) => {
    const s = v.toFixed(decimals);
    return grouped ? Number(s).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : s;
  };
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
    el.textContent = p < 1 ? final.replace(m[0], fmt(target * e)) : final;   // always ends on the exact original text
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export default function MotionRuntime() {
  useIso(() => {
    const root = document.documentElement;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    /* reveal on scroll */
    const inView = (el: Element) => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; };
    const pending = new Set<Element>();
    const reveal = (el: Element) => { el.classList.add('in'); pending.delete(el); io.unobserve(el); };
    // threshold 0: the first visible pixel counts, so even blocks taller than the screen always reveal
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) reveal(en.target);
    }, { threshold: 0, rootMargin: '0px 0px -6% 0px' });
    const counted = new WeakSet<Element>();
    const cio = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting && !counted.has(en.target)) { counted.add(en.target); countUp(en.target as HTMLElement); cio.unobserve(en.target); }
    }, { threshold: 0.4 });
    const scan = (scope: ParentNode) => {
      scope.querySelectorAll?.('[data-reveal]:not(.in)').forEach((el) => { if (inView(el)) el.classList.add('in'); else { pending.add(el); io.observe(el); } });
      scope.querySelectorAll?.('[data-stagger]').forEach((list) => { [...list.children].forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(Math.min(i, 12)))); });
      scope.querySelectorAll?.('[data-count-up]').forEach((el) => { if (!counted.has(el)) cio.observe(el); });
      scope.querySelectorAll?.('.tabs').forEach(attachInk);
    };

    /* sliding ink under the selected tab */
    const inks = new Map<HTMLElement, HTMLElement>();
    function place(bar: HTMLElement) {
      const ink = inks.get(bar), sel = bar.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!ink) return;
      if (!sel) { ink.style.opacity = '0'; return; }
      const x = sel.offsetLeft + 12, w = Math.max(8, sel.offsetWidth - 24);
      ink.style.opacity = '1';
      ink.style.transform = `translate3d(${x}px,0,0) scaleX(${w})`;
    }
    function attachInk(bar: Element) {
      const el = bar as HTMLElement;
      if (inks.has(el) || !el.querySelector('[aria-selected]')) return;
      const ink = document.createElement('span');
      ink.className = 'mo-ink'; ink.setAttribute('aria-hidden', 'true');
      el.appendChild(ink); el.classList.add('mo-has-ink'); inks.set(el, ink);
      place(el);
    }

    scan(document);
    root.classList.add('mo');

    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') { const bar = (m.target as Element).closest('.tabs') as HTMLElement | null; if (bar) place(bar); continue; }
        m.addedNodes.forEach((n) => { if (n.nodeType === 1) { const e = n as Element; if (e.matches?.('[data-reveal]') && !e.classList.contains('in')) { if (inView(e)) e.classList.add('in'); else { pending.add(e); io.observe(e); } } scan(e); } });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
    const onResize = () => inks.forEach((_, bar) => place(bar));
    addEventListener('resize', onResize);

    /* header glass */
    const header = document.querySelector('.app-header');
    let ticking = false;
    // also a safety net: anything that has reached the screen is revealed even if an observer callback was missed
    const onScroll = () => { if (ticking) return; ticking = true; requestAnimationFrame(() => {
      header?.classList.toggle('scrolled', scrollY > 8);
      pending.forEach((el) => { if (el.getBoundingClientRect().top < innerHeight) reveal(el); });
      ticking = false;
    }); };
    addEventListener('scroll', onScroll, { passive: true }); onScroll();

    /* smooth scroll for in-page anchors only (instant scrollTo elsewhere stays instant) */
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      if (!a || a.getAttribute('href') === '#') return;
      const target = document.getElementById(a.getAttribute('href')!.slice(1));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', a.getAttribute('href'));
    };
    document.addEventListener('click', onClick);

    return () => { io.disconnect(); cio.disconnect(); mo.disconnect(); removeEventListener('resize', onResize); removeEventListener('scroll', onScroll); document.removeEventListener('click', onClick); };
  }, []);
  return null;
}
