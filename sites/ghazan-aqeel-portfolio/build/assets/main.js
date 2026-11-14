// Shared across every page: smooth scroll, GSAP reveal system, and the optional
// 3D/4D hero stage (only runs when a #stage element exists on the page).
document.addEventListener('DOMContentLoaded', function () {
  var yearEl = document.getElementById('ghaz-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  if (typeof gsap === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger);

  if (typeof Lenis !== 'undefined') {
    var lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
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

    gsap.set(['#c1', '#c2', '#c3'], { opacity: 0, z: -200 });
    gsap.timeline({ defaults: { ease: 'power3.out' } })
      .to('#c1', { opacity: 1, z: 0, duration: 1, rotateY: -8, rotateX: 6 }, 0.5)
      .to('#c2', { opacity: 1, z: 0, duration: 1, rotateY: 10, rotateX: -4 }, 0.65)
      .to('#c3', { opacity: 1, z: 0, duration: 1, rotateY: -6, rotateX: 4 }, 0.8);

    stage.addEventListener('mousemove', function (e) {
      var r = stage.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      gsap.to('#c1', { rotateY: -8 + px * 14, rotateX: 6 - py * 14, duration: 0.6, ease: 'power2.out' });
      gsap.to('#c2', { rotateY: 10 + px * 18, rotateX: -4 - py * 18, duration: 0.6, ease: 'power2.out' });
      gsap.to('#c3', { rotateY: -6 + px * 10, rotateX: 4 - py * 10, duration: 0.6, ease: 'power2.out' });
    });

    gsap.to('#c1', { z: 120, rotateY: '+=18', y: -40, ease: 'none', scrollTrigger: { trigger: '.ghaz-hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('#c2', { z: -80, rotateY: '-=14', y: 60, ease: 'none', scrollTrigger: { trigger: '.ghaz-hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('#c3', { z: 60, rotateX: '+=10', y: -20, ease: 'none', scrollTrigger: { trigger: '.ghaz-hero', start: 'top top', end: 'bottom top', scrub: true } });
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
