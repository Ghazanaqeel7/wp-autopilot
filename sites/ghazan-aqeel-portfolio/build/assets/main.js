// Shared across every page: smooth scroll, GSAP reveal system, and the optional
// 3D/4D hero stage (only runs when a #stage element exists on the page).
document.addEventListener('DOMContentLoaded', function () {
  var yearEl = document.getElementById('ghaz-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  if (typeof gsap === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger);

  if (typeof Lenis !== 'undefined') {
    var lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);
  }

  // Page hero entrance (simple fade/slide — used on every non-home page)
  if (document.querySelector('.ghaz-pagehero')) {
    gsap.set('.ghaz-pagehero .ghaz-reveal', { y: 26, opacity: 0 });
    gsap.timeline({ defaults: { ease: 'power3.out' } })
      .to('.ghaz-pagehero .ghaz-reveal', { y: 0, opacity: 1, duration: 0.7, stagger: 0.12 }, 0.1);
  }

  // Home hero: 3D/4D card stage
  var stage = document.getElementById('stage');
  if (stage) {
    gsap.set('.ghaz-hero-eyebrow, .ghaz-hero h1, .ghaz-hero-sub', { y: 30, opacity: 0 });
    gsap.set('.ghaz-hero-cta', { opacity: 0 });
    gsap.timeline({ defaults: { ease: 'power3.out' } })
      .to('.ghaz-hero-eyebrow', { y: 0, opacity: 1, duration: 0.6 }, 0.1)
      .to('.ghaz-hero h1', { y: 0, opacity: 1, duration: 0.8 }, 0.25)
      .to('.ghaz-hero-sub', { y: 0, opacity: 1, duration: 0.7 }, 0.45)
      .to('.ghaz-hero-cta', { opacity: 1, duration: 0.6 }, 0.65);

    var card = document.getElementById('flowcard');
    if (card) {
      gsap.set(card, { opacity: 0, z: -160, rotateY: -10, rotateX: 6 });
      gsap.to(card, { opacity: 1, z: 0, rotateY: -6, rotateX: 3, duration: 1, ease: 'power3.out', delay: 0.4 });
      gsap.set('#fs1, #fs2, #fs3', { opacity: 0, x: 24 });
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .to('#fs1', { opacity: 1, x: 0, duration: 0.6 }, 1.0)
        .to('#fs2', { opacity: 1, x: 0, duration: 0.6 }, 1.25)
        .to('#fs3', { opacity: 1, x: 0, duration: 0.6 }, 1.5);

      stage.addEventListener('mousemove', function (e) {
        var r = stage.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        gsap.to(card, { rotateY: -6 + px * 12, rotateX: 3 - py * 10, duration: 0.6, ease: 'power2.out' });
      });
      stage.addEventListener('mouseleave', function () {
        gsap.to(card, { rotateY: -6, rotateX: 3, duration: 0.8, ease: 'power3.out' });
      });

      gsap.to(card, { z: 60, y: -20, ease: 'none', scrollTrigger: { trigger: '.ghaz-hero', start: 'top top', end: 'bottom top', scrub: true } });
    }
    gsap.to('.ghaz-hero-grid > div:first-child', { yPercent: -10, ease: 'none', scrollTrigger: { trigger: '.ghaz-hero', start: 'top top', end: 'bottom top', scrub: true } });
  }

  // Generic reveals — every page uses these same classes
  document.querySelectorAll('.ghaz-reveal').forEach(function (el) {
    if (el.closest('.ghaz-pagehero')) return; // already handled by the page-hero timeline above
    gsap.fromTo(el, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 85%' } });
  });
  document.querySelectorAll(
    '.ghaz-pain-grid, .ghaz-svc-grid, .ghaz-process, .ghaz-tools-strip, .ghaz-geo-grid, .ghaz-ps-grid, ' +
    '.ghaz-benefit-grid, .ghaz-work-grid, .ghaz-faq-list, .ghaz-contact, .ghaz-steps-row, .ghaz-logo-grid, ' +
    '.ghaz-app-grid, .ghaz-seg-grid, .ghaz-contact-grid'
  ).forEach(function (group) {
    var rows = group.querySelectorAll('.ghaz-reveal-row');
    if (!rows.length) return;
    gsap.fromTo(rows, { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.08, scrollTrigger: { trigger: group, start: 'top 82%' } });
  });
});
