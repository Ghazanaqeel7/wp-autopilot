# Autopilot Bridge (WordPress plugin)

Installed on every connected site (wp-admin → Plugins → Upload). No hosting access needed.

## What it does
- **Signed API** `/wp-json/autopilot/v1/*` — Ed25519 signature, ±5 min timestamp, single-use nonce. The site
  stores only the hub's public key; the private key lives only in GitHub Secrets (`AP_SIGNING_KEY`).
- **Changesets** — edits are staged in an overlay; the live site is untouched until `promote`.
- **Full-site preview** — `?ap_preview=<token>` sets a cookie; that visitor sees the whole site with the
  changes (noindex, no-cache, banner with Exit). Everyone else sees live.
- **Drift guard** — `expect_before_hash` on stage, and a re-check of every touched value on promote.
- **Snapshots + rollback** — byte-exact snapshot before every promote; `snapshot/restore` reverts.
- **Kill switch** — Tools → Autopilot Bridge → Pause (API answers 423 to all writes).
- **Audit log** — every call, failure and change, visible in wp-admin.

## Routes (all POST, JSON body)
| Route | Body |
|---|---|
| `health` | – |
| `inventory` | – (site, theme, builders, cache/security/SEO plugins, pages with `data_hash`) |
| `page` | `{post_id, full?}` (outline by default) |
| `changeset/stage` | `{changeset, ops[], ttl_hours?}` → `preview_url` |
| `changeset/preview` | `{changeset, ttl_hours?}` → new preview link |
| `changeset/promote` | `{changeset}` → `snapshot_id` |
| `changeset/discard` | `{changeset}` |
| `changeset` | `{changeset}` → summary |
| `snapshot/restore` | `{snapshot_id}` |
| `audit` | `{limit?}` |

Ops: `page.update_section` (Elementor `element_id` / Gutenberg `block_path`), `template.update`,
`page.update_content`, `page.create`, `css.update`, `option.update`, `seo.update` (Yoast/Rank Math),
`media.upload` (images only; reference later with `{{media:<key>:id}}` / `{{media:<key>:url}}`).

## Known limits (v0.1)
- `menu.update` not yet implemented. Divi/WPBakery/Bricks adapters come in v2.
- Preview overlays posts fetched through queries; values read with a bare `get_post($id)` elsewhere
  (rare) show live data. Page caches/CDNs must not cache responses for the `ap_preview` cookie.
- Post content edits are sanitised with `wp_kses_post` (no scripts/iframes) — by design.

## Test
`bridge-plugin/tests/e2e.py` — 34 checks against a real WordPress (auth, replay, preview isolation,
promote, byte-exact rollback, drift guard). Build the upload zip with `tools/build_plugin.sh`.
