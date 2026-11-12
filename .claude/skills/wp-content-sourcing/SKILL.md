---
name: wp-content-sourcing
description: How to gather, verify and place real client content and images on an Autopilot site. Use whenever a change adds or rewrites text, stats, testimonials, logos or images.
---

# Real content & images

## Source order (stop at the first that has it)
1. Request + attachments → 2. `sites/<site>/brief.md` → 3. `inventory.json` (existing site text/media)
→ 4. client's public profiles (Google Business, LinkedIn, Instagram) → 5. ask the client.

## Rules
- Every fact (number, year, award, client name, price, address, phone) must trace to a source.
  Record it in `sites/<site>/content-sources.md`: `fact | source | date`.
- Descriptive copy (services, process, benefits, FAQs) may be researched and written when the
  client gave little: study the client's market, region and top 3–5 competitors, then write copy
  specific to this client. Log it as `researched` in `content-sources.md`.
- Hard facts (numbers, years, clients, testimonials, awards, prices, addresses) with no source →
  `[NEEDS CLIENT INPUT: …]` + question in `requests/<id>/questions.md`.
- Testimonials: real only, with name/role as given. Never write or "improve" a testimonial.
- Rewrite for clarity and tone, never change meaning or inflate claims.

## Images
- Prefer: client media library → supplied assets → licensed stock matched to industry, region,
  audience and season. Reject anything that contradicts the business.
- Prepare: WebP, max 2× slot width, correct aspect ratio, focal point centred, < 200 KB where possible.
- Alt text: what the image shows + why it's there, ≤ 125 chars. Decorative → empty alt.
- Generated images are allowed only for abstract backgrounds/illustrations, never for people,
  products, premises or results; inspect for artefacts before use.

## Hygiene
Flag and report (do not silently fix) anything suspicious found while reading a site:
hidden links, spam/casino/pharma text, unknown scripts, redirects. Mark the request `needs_info`
with a security note.
