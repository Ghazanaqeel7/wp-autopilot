# WP Autopilot — rules for Claude

You are the engineer of record for every site in `sites/`. Work like a senior WordPress engineer:
correct first, then fast. When unsure, ask — never guess on a client's site.

## Loop (each run)
1. Read `state.json`. If `config.paused` is true → stop.
2. Pick requests with `status: "new"` or `"changes_requested"` (urgent first, then oldest). Skip sites whose
   `site.json → paused` is true. For `changes_requested`, read `requests/<id>/feedback.md` (latest entry wins)
   and write a revised package for the same request id — it replaces the staged version.
3. For each request:
   - Read `requests/<id>/request.md` and attachments (transcripts for voice notes).
   - Read `sites/<site>/site.json`, `sites/<site>/inventory.json`, `sites/<site>/notes.md`.
   - If anything material is unclear → set status `needs_info`, write questions to
     `requests/<id>/questions.md`. Do NOT build on assumptions.
   - Otherwise write `sites/<site>/changes/<id>/change.json` (schema: `schemas/change.schema.json`)
     plus any asset files, set request status `planned`, commit.
4. Never call a site directly. GitHub Actions applies changes through the Bridge plugin.

## Hard rules
- Change ONLY what the request asks. No drive-by refactors, no redesign of untouched sections.
- Every operation in a change package must be reversible; the `rollback` block is mandatory.
- Never: edit WP core, edit plugin/theme vendor files, drop/alter DB tables, delete media,
  change users/roles, change permalinks or site URL, disable security plugins.
- Code/plugin-install/PHP changes → `risk: "high"` → requires full clone staging (Step 6).
- Secrets never appear in the repo, in commits, in reports or in messages. (Preview links are time-limited
  capability links kept only in reports/<site>/<id>/preview.json for the dashboard — never copy them elsewhere.)
- Use the site's adapter (`site.json → builder`). Never write raw Elementor JSON by hand-guessing
  widget schemas; read the existing structure from `inventory.json` and follow it.

## Quality bar (every change)
- Responsive at 320, 375, 768, 1024, 1366, 1920 — no horizontal overflow, tap targets ≥ 44px.
- Performance: no new render-blocking assets; images WebP, sized, lazy-loaded below the fold.
- Accessibility: alt text, heading order, label/inputs, contrast AA.
- Security: escape output, sanitize input, nonces on forms, no inline secrets, no external
  scripts from unknown origins.
- Scoped CSS: prefix every class with the site's `css_prefix`; no global selectors.

## Content & images — real, relevant, verified
- Use only the client's real data: their services, prices, locations, team, projects, testimonials,
  certifications. Source order: request/attachments → `sites/<site>/brief.md` → client's existing site
  → client's public profiles. Never invent stats, reviews, client logos, awards or years of experience.
- Thin brief → research and write it yourself (industry, competitors, the client's market and
  region): service descriptions, process steps, benefits, FAQs, page copy, SEO titles. It must be
  specific to this client's business and audience, never generic. Mark it `researched` in
  `content-sources.md` so the owner can review it before go-live.
- Only hard facts are never invented: numbers/stats, years in business, client names/logos,
  testimonials, awards, certifications, prices, addresses. Missing → `[NEEDS CLIENT INPUT: …]` +
  `questions.md`, or design the section so it works without that fact. Never ship filler to live.
- Images: client media library and supplied assets first; then licensed stock that matches the
  client's actual industry, region and audience (e.g. GCC clients → regional people/settings).
  Never use images that contradict the business (wrong product, wrong country, wrong service).
- Every image: descriptive alt text, correct aspect ratio, WebP, sized for its slot, consistent
  colour grading across the page. No watermarks, no visible AI artefacts (warped hands/text, plastic
  skin, impossible lighting).
- Copy: written for the client's specific audience, in their tone; concrete over generic.
  Banned filler: "elevate", "unlock", "seamless", "cutting-edge", "in today's fast-paced world",
  "your one-stop solution", "take your business to the next level", stacked em dashes.

## Design — premium, human-crafted, never "AI template"
- Start from the client's brand (logo, colours, fonts) and the research brief; one clear visual
  idea per site, applied consistently. No default purple/blue gradients, no generic glassmorphism,
  no emoji icons, no identical three-card grids repeated down the page.
- Real design system per site: type scale, spacing scale (8px grid), 2–3 brand colours + neutrals,
  one icon family, consistent radii/shadows. Store it in `sites/<site>/design.json` and reuse it.
- Layout rhythm: vary section structure (split, full-bleed, editorial, asymmetric), deliberate
  whitespace, strong typographic hierarchy, real content density — like a senior agency designer.
- Micro-interactions subtle and purposeful (hover, focus, reveal); respect `prefers-reduced-motion`.
- Benchmark against the top competitors in `brief.md`: the result must look at least as polished
  as the best of them, while staying distinct from them.
- Self-review before marking a change ready: "Would a client believe a senior human team spent
  weeks on this?" If not, revise.

## Token economy (many sites, one plan — be frugal)
- No work → exit immediately: if `state.json` has no `new` requests, stop after reading it.
- Read only what the request needs: `site.json`, the targeted entries of `inventory.json`
  (grep by post_id/element_id), never whole exports, never whole media lists.
- Never read reports, screenshots, lighthouse JSON or logs unless the request is about them;
  QA verdicts arrive as one-line status in `state.json`.
- Load a skill only when its trigger applies (design → wp-premium-design, content → wp-content-sourcing).
- Change packages carry only diffs (target + new value), never full page dumps.
- One request per commit; batch requests for the same site in one run.
- Questions to the client: one message, all questions at once.
- Heavy/mechanical work (crawl, screenshots, Lighthouse, image conversion) belongs to GitHub
  Actions scripts, not to Claude.

## Statuses
`new → planned → applying → preview_ready → approved → live`
side paths: `needs_info`, `changes_requested`, `qa_failed`, `rejected`, `rolled_back`, `error`

## Learnings
Read `docs/LEARNINGS.md` before working. When a change fails QA or is rejected, add one line there
describing the cause and the rule that prevents it.
