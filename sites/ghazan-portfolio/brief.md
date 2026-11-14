# Ghazan — personal portfolio site (brief / Q&A)

Status: **not yet connected** (no domain/hosting given to Autopilot yet — see "Still needed" at
the bottom). Scope for v1: **homepage only.**

## Q&A

**Q: Who is this site for / what's the one-line positioning?**
A: Ghazan — WordPress developer, plugin developer and production/web lead, working across
Hajj & Umrah travel tech and the GCC/UAE market. [NEEDS CLIENT INPUT: exact one-line tagline —
draft: "WordPress developer building fast, production-grade websites and plugins for the GCC market."]

**Q: What services does he offer on this site?**
A (from known work): WordPress plugin development (e.g. a commercial inline visual editor
plugin), Elementor site builds, UX/web consulting, WordPress production/team leadership,
automation tooling for web delivery. [NEEDS CLIENT INPUT: confirm this exact list + add/remove
anything, e.g. does he want to list "AI-assisted delivery systems" as a service?]

**Q: What should the "work/experience" section show?**
A: Career since 2018 across multiple agencies and freelance roles, focused on WordPress
development and web production; senior developer and production management roles; background
in Computer Science; certifications in data science and AI tooling.
[NEEDS CLIENT INPUT: specific project names/case studies he wants shown publicly — e.g. a
Hajj/Umrah site, a plugin, this automation system itself — and whether client names can be
named or must stay anonymous.]

**Q: Target audience?**
A: [NEEDS CLIENT INPUT] — likely agencies/businesses in GCC/UAE looking for a WordPress
developer, or direct clients needing a site/plugin built. Confirm which is primary.

**Q: Visual direction — what should it feel/look like?**
A: High-end, GSAP-driven scroll experience — not a generic template feel. Competitor/benchmark
research (2026-11-14) shows the current standard for this kind of site: scroll-triggered reveal
animations, a sequenced hero entrance timeline, directional reveals (left/right/up/down per
section), smooth-scroll libraries (e.g. Lenis) paired with GSAP ScrollTrigger, subtle
hover/magnetic interactions, and a confident one-page narrative flow (hero → services →
work/proof → about → contact). Reference examples to study: Awwwards "Developer Award" /
"Made with GSAP" winners, and freelance-market examples (Pedro Chalegre's and Nuzair Ibrahim's
personal portfolios) for pacing and structure.
[NEEDS CLIENT INPUT: pick 1–2 reference sites from Awwwards (awwwards.com/inspiration_search/developer/)
whose *feel* he wants to get closest to — dark/light theme, color direction.]

**Q: Tech approach — Elementor or custom code?**
A: **This is a real decision, not a style choice.** Elementor's native animation set cannot do
true GSAP ScrollTrigger timelines (pinning, scrubbing, sequenced reveals tied to scroll
position). Two real options:
  - **(a) Elementor + custom code widget**: build the page in Elementor for layout/content
    editing, inject a scoped custom HTML/JS widget per section that runs the GSAP timelines.
    Keeps it editable in Elementor for text/image changes later; animation code lives in one
    snippet.
  - **(b) Custom-coded homepage template**: a single hand-built page template (PHP/HTML/CSS/JS)
    registered as a page template, GSAP fully in control end to end. Best for "high-end,
    nothing templated" feel; harder to hand-edit later without code.
  Recommendation for v1: **(a)**, since it matches how every other site in this system
  (Elementor/Gutenberg adapters) is built and stays maintainable — but this is his call.
  [NEEDS CLIENT INPUT: confirm (a) or (b).]

**Q: Brand — logo, colours, fonts?**
A: [NEEDS CLIENT INPUT] — none supplied yet. Upload on the dashboard's brand/assets page, or
send here.

**Q: Domain / hosting?**
A: [NEEDS CLIENT INPUT — blocking] — no domain or WordPress install given yet. The Autopilot
Bridge plugin needs an actual WordPress site to connect to before anything can be built or
previewed (same onboarding nextleveldigitals went through). Nothing can go live until this
exists.

## Scope (v1)
Homepage only. Sections (draft, confirm/edit): Hero (name + one-line positioning + CTA) →
Services → Selected work / proof → About → Contact. GSAP ScrollTrigger-driven throughout.

## Still needed before this can be built
1. Domain + WordPress hosting (or confirm reusing an existing one) → connect via dashboard
   "Add Website" → gives Autopilot the live site to work on.
2. Answers to the `[NEEDS CLIENT INPUT]` items above (tagline, services list, case studies to
   show, target audience, reference site(s), Elementor-widget vs custom-template decision,
   logo/colours).
3. Once both are in, submit the actual build request on the dashboard (or via Slack) referencing
   this brief.
