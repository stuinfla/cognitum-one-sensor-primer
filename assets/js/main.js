// COGNITUM ONE · SENSOR PRIMER — interactions

// 1. Staggered reveal-on-scroll
const reveals = document.querySelectorAll('.reveal');
const revealIO = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const sibs = [...e.target.parentElement.children].filter(c => c.classList.contains('reveal'));
    const idx = Math.max(0, sibs.indexOf(e.target));
    e.target.style.transitionDelay = Math.min(idx * 70, 350) + 'ms';
    e.target.classList.add('in');
    revealIO.unobserve(e.target);
  });
}, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
reveals.forEach(el => revealIO.observe(el));

// 2. Active-section highlighting in the nav
const sections = [...document.querySelectorAll('section[id]')];
const navMap = new Map();
document.querySelectorAll('.nav-links a[href^="#"]').forEach(a => navMap.set(a.getAttribute('href').slice(1), a));
const navIO = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    const link = navMap.get(e.target.id);
    if (!link) return;
    if (e.isIntersecting) {
      navMap.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    }
  });
}, { threshold: 0.4, rootMargin: '-20% 0px -55% 0px' });
sections.forEach(s => navIO.observe(s));
