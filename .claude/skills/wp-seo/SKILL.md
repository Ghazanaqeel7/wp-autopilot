---
name: wp-seo
description: SEO method for any page or site build on an Autopilot site. Use when a change creates or rewrites pages, titles, meta, headings, images or schema.
---

# SEO standard (every page)

- One intent per page. Primary keyword from the client's real services and market (research it: competitors' titles, People-also-ask, region). Never keyword-stuff.
- Title ≤ 60 chars (keyword early, brand last), meta description 140–160 chars written as a reason to click, one `h1` that matches the title's intent, `h2/h3` in order.
- Clean slug (no dates, no stop-word noise); never change an existing live URL — if unavoidable add a 301 and say so in the report.
- Internal links: each new page linked from at least two relevant pages, descriptive anchor text. Breadcrumbs on deep pages.
- Images: descriptive filename + alt that describes the image in context, width/height set, WebP, lazy-load below the fold, LCP image not lazy.
- Schema (JSON-LD, only facts the client confirmed): `Organization`/`LocalBusiness` with real NAP, `Service`, `FAQPage` only for visible FAQs, `BreadcrumbList`, `Article` for posts. Validate it parses.
- Set `noindex` only on thank-you/utility pages. Canonical on every page. Do not touch robots/sitemap settings unless asked.
- Content: answer the question first, specific over generic, local terms for GCC/UAE/KSA clients where relevant (and Arabic version only when asked). Follow `wp-content-sourcing` for facts.
- Apply with `seo.update` (Yoast/RankMath/AIOSEO fields) rather than custom code. Record before/after titles and descriptions in the change report.
