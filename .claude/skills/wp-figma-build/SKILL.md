---
name: wp-figma-build
description: Build a page from a Figma design as an exact copy. Use when a request has a Figma link or exported frames and says to match the design.
---

# Figma → site (exact copy)

Only with a Figma link/export supplied by the owner or client for this site (their design = permission to copy). If a Figma connector is available read the file with it; otherwise use the exported PNG/PDF frames in `requests/<id>/attachments/`.

1. Inventory frames: desktop/tablet/mobile per page. Extract the design system first (colours, type scale, spacing, radii, shadows, icon set) into `sites/<site>/design.json`; `brand.json` colours/fonts still win if they differ — flag the difference.
2. Layout is copied exactly at the frame widths; between frames, interpolate fluidly (no horizontal scroll at 320–1920). Where Figma has no mobile frame, derive it from the desktop with the same hierarchy and say so.
3. Export assets from Figma (images, icons as SVG); convert to WebP and size them. Fonts: use the site's licensed/Google fonts; if the Figma font is unavailable, pick the closest and report it.
4. Build with the site's adapter (Elementor/Gutenberg) using real widgets/blocks, scoped CSS with the site `css_prefix`, no pixel-absolute positioning.
5. Copy text from the design only when it is the client's real copy; placeholder lorem or sample data in Figma becomes real researched content (`wp-content-sourcing`), flagged `researched`.
6. Apply `wp-seo` (headings, titles, alt text, schema) and `wp-conversion` (CTA, forms) on top — an exact visual copy must still meet SEO and conversion standards; list any place where the design conflicts with them in the report.
7. QA compares the preview with the Figma frames at the frame widths; record visible differences as warnings.
