---
name: wp-reference-build
description: How to build from a reference website. Use when a request has a "## Reference" section (mode replicate or inspired).
---

# Building from a reference website

Inputs (already captured by Actions — do not fetch the site yourself):
`requests/<id>/reference/outline.json` (structure, fonts, colours), `desktop.jpg` / `mobile.jpg`
(open only if the outline is not enough), `content.txt` (exists only for the client's own site).
Always combine with `sites/<site>/brand.json` and `sites/<site>/brand/assets/`.
If `reference/` is missing, set the request to `needs_info` ("reference capture has not finished").

## mode: replicate
- Match the reference section by section: same order, same layout pattern per section (columns,
  split, full-bleed), same component types (hero, logo strip, cards, pricing, FAQ, CTA), comparable
  spacing rhythm, type scale and interactions. Same page count/sitemap where the request asks.
- Colours and fonts: use `brand.json` when it has values; otherwise mirror the reference's scale
  and contrast with the nearest freely licensed fonts.
- QA target: side by side at 1366 and 375 the two pages read as the same layout.

## mode: inspired
- Take the qualities named in `notes` (and the overall level of polish), not the layout 1:1.
- Re-plan the sections for this business (brief, audience, conversion goal) and design with
  wp-premium-design. Brand colours and fonts lead. It must not be recognisable as a copy.

## Content rules — both modes (non-negotiable)
- `own_site: no` → never reuse the reference's text, photos, illustrations, icons sets, logo, brand
  name, testimonials, client logos or trademarks. Write content with wp-content-sourcing; use the
  client's assets or licensed stock. Headings in outline.json describe structure only.
- `own_site: yes` → `content.txt` and the site's own media may be carried over and improved.
- Do not copy the reference's source code, CSS or JS; rebuild with the site's builder.
- Note in the change summary: "Reference: <url> (<mode>)".
