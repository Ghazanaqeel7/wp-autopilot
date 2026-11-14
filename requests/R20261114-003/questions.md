# Questions — R20261114-003 (ghazan-aqeel-portfolio revamp)

Two things in this request conflict with each other and with what we'd already agreed, so I'm
not building on a guess. Please confirm:

1. **"Clone it 100%" vs mode: inspired** — the request text says "clone it 100% all of its pages,"
   but the reference is set to `inspired` mode with `own_site: no`. Under our rules, `inspired`
   mode must NOT be a recognisable copy (different design, your own content only), while
   `replicate` mode matches Metech Studio's layout/sections 1:1 (still with your own text/images —
   their copy, logos and photos can never be reused either way). Which did you mean?
   - **Replicate** — same section-by-section layout and structure as metechstudio.com, restyled in
     your brand colours/fonts, filled with your own content.
   - **Inspired** — same quality/polish level, but a layout designed specifically around your
     personal portfolio (not Metech's agency sitemap).

2. **Scope: homepage-only vs "all of its pages"** — we'd agreed v1 is homepage-only. Metech Studio
   is a multi-page agency site (Home, Services, Industries, Our Work, About, Contact, Book a Call).
   You're a solo developer/portfolio, not an agency with industries/departments — a full page-for-
   page clone of their sitemap won't make sense content-wise for you. Do you want:
   - Still homepage-only, just redesigned to match Metech's layout/style, or
   - Expand to multiple pages now — if so, which ones (e.g. Services, Work, About, Contact) and
     what should each contain for *your* business specifically?

3. **Hero "3D/4D scrolling effect"** — happy to build an advanced GSAP ScrollTrigger hero (layered
   parallax, pinned scroll, 3D perspective tilt on scroll). Just confirming this is on top of the
   existing smooth-scroll setup, not a WebGL/Three.js 3D scene — that's a much bigger build. Is
   GSAP-based "feels 3D" scroll (depth, parallax, perspective) what you want, or literal 3D models?

Once you confirm these, I'll read your brand guideline PDF and rebuild accordingly.
