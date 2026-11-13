---
name: wp-functionality
description: How to add new functionality to an Autopilot site with code snippets or WordPress.org plugins. Use when a request asks for a feature, tool, calculator, form behaviour, integration, tracking or anything that is not content/design.
---

# Functionality: snippet first, plugin second

The owner describes the function once; Claude decides the mechanism.

1. **Snippet** (`snippet.set`, php/js/css) when the feature is small and specific: a shortcode, calculator, tool, filter, redirect, schema output, tracking tag, small widget, form tweak. One feature = one snippet slug (`a-z0-9-`, e.g. `price-calculator`). Re-use the slug to update it.
2. **Plugin** (`plugin.install` + `activate`) only when a mature plugin clearly does it better (forms, caching, SEO, WooCommerce add-ons, backups, security hardening it does not already have). WordPress.org only, ≥10,000 active installs. Prefer one well-known plugin over three small ones.
3. Never both for the same job. Never replace a plugin that already does it (check `inventory.json`).

## Writing a PHP snippet
- Plain PHP without `<?php`. Runs from `init` on; register everything with `add_action`/`add_filter`/`add_shortcode`.
- Prefix every function, hook name, option and CSS class with the site's `css_prefix` (no globals, no collisions). Wrap in functions or closures.
- Output escaped (`esc_html`, `esc_attr`, `esc_url`, `wp_kses_post`); input sanitised; forms use nonces and capability checks; AJAX endpoints verify nonce.
- Allowed to read/write only its own options (prefixed). No file writes, no `eval`/`exec`/`include`, no `unserialize`/`base64_decode`, no user/role changes, no table changes. The Bridge lint rejects these; do not try to work around it.
- Data from the client only: never hard-code invented prices, phone numbers or stats; take them from `brief.md`/request or put them in a prefixed option with `[NEEDS CLIENT INPUT]`.
- Enqueue nothing from external origins. Front-end JS goes in a `js` snippet or inline from the PHP snippet; CSS in a `css` snippet, scoped by prefix.
- Respect `prefers-reduced-motion`, keyboard focus, AA contrast for anything visible.

## Change package
- `risk: "high"` always for `snippet.*` and `plugin.*`. Rollback strategy `snapshot_restore` (snippets and installed plugins are undone from the snapshot).
- Ops: `{"op":"snippet.set","target":{"slug":"price-calculator"},"payload":{"type":"php","scope":"front","code":"...","description":"..."}}` or `{"op":"plugin.install","target":{},"payload":{"slug":"wp-super-cache","activate":true}}`.
- Large code: `payload_file` in the change folder (JSON payload), not inline.
- Put the feature on a page with a normal content op (shortcode/block) in the same package so the preview shows it working.
- QA list must include: feature works on the preview, works logged-out, no PHP notices, mobile layout, no console errors.

## Where it runs
- Snippets are previewed first (only the preview link sees them), switched off automatically if they crash, and can be rolled back from the snapshot.
- Staging copy (`is_staging`): snippets and plugins. Live site: snippets only, and only if the owner enabled "Allow small code snippets" and the site's Code changes mode. Plugin installs are never applied to a live site.
- Preview does not show plugin installs (they run at promote). Say so in the report.
- If the Bridge answers `ap_forbidden` (code mode off), set `needs_info` and tell the owner exactly which switch to turn on.
