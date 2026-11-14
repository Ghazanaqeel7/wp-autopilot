# Learnings

One line per lesson: date — site — what went wrong — rule that prevents it.
- Snippet loader must run after the preview overlay is installed (init:0), or previews never show snippets. Rule: AP_Functions::boot is hooked on init:1.

## menu.update implemented (2026-11-14) — untested
Code written for `menu.update` (class-ap-changesets.php: op_menu + promote hook) following the
existing overlay/snapshot pattern — not run against a live WordPress instance (no WP test env in
this session). Payload: `target: {menu: "<slug-or-id>"}`, `payload.items[]`: existing items
`{id, title?, order?, url?, parent?}` (only listed fields change); new items `{title, url|post_id,
order?, parent?}` (no id) — inserted as draft `nav_menu_item` posts now, attached to the menu term
only at promote(). Before trusting this on a real site: stage a menu.update change on a staging
site, confirm the preview/promote/rollback cycle, and check items render correctly in the theme's
menu location.
