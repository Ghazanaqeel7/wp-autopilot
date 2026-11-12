---
name: wp-premium-design
description: House design method for any new page, section or redesign on an Autopilot site. Use before writing any layout, Elementor data, CSS or HTML for a client site.
---

# Premium WordPress design — house method

Goal: work that looks like a senior agency team crafted it for this client, not a template.

## 1. Inputs before designing (read, don't guess)
`sites/<site>/design.json` (tokens) · `brief.md` (audience, competitors) · `inventory.json`
(existing sections to match). If `design.json` is missing, create it first from the client's logo,
current site and brief, then stop and ask for approval.

## 2. House patterns (proven in our portfolio — reuse, adapt, don't copy blindly)
- Text-led hero with one clear promise + two CTAs (primary action / secondary explore).
- Small eyebrow labels above section titles ("The Process", "01 — Expertise").
- Numbered cards/steps (01–06) for services, process and timelines.
- Dual-audience split panels when a business serves two sides (employers/candidates, buyers/sellers).
- Alternating image/text rows for resources or services; horizontal-scroll phases for process.
- Stat grid only with real, verified numbers. Marquee/ticker only for real items (roles, clients).
- Short FAQ (4–6 real questions) before the closing CTA; closing CTA split by audience when relevant.
- Portfolio/creative brands: large stacked full-bleed project covers, minimal chrome, one CTA.

## 3. Craft rules
- Type: max 2 families; fluid scale with clamp(); body 16–18px, line-height 1.5–1.7; titles tight.
- Spacing on an 8px grid; section padding fluid (clamp(64px, 10vw, 140px)).
- Colour: brand primary + one accent + neutrals; accent ≤ 10% of the page.
- Vary rhythm: never 3+ consecutive sections with the same structure.
- Imagery: one consistent photographic style per site; crop to purpose; real client media first.
- Motion: one entrance style site-wide, 200–400ms, ease-out; honour prefers-reduced-motion.
- Elementor: use containers (flexbox/grid), global colours/fonts from the kit, no inline pixel hacks;
  custom CSS scoped under the site `css_prefix` root class.

## 4. Anti-AI checklist (all must pass)
- No purple/blue default gradients, glassmorphism, emoji icons, "✨" sparkle motifs, blob shapes.
- No generic three-card rows repeated; no lorem/filler; no stock "handshake/laptop" clichés.
- Copy free of banned words (see CLAUDE.md). Headlines specific to this client.
- Icons from one family, same stroke weight. Buttons share one style system.
- Would this pass next to the client's best competitor? If not, revise before QA.
