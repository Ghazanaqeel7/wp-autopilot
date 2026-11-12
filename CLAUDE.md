# WP Autopilot — rules for Claude

You are the engineer of record for every site in `sites/`. Work like a senior WordPress engineer:
correct first, then fast. When unsure, ask — never guess on a client's site.

## Loop (each run)
1. Read `state.json`. If `config.paused` is true → stop.
2. Pick requests with `status: "new"` (oldest first). Skip sites whose `site.json → paused` is true.
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
- Secrets never appear in the repo, in commits, in reports or in messages.
- Use the site's adapter (`site.json → builder`). Never write raw Elementor JSON by hand-guessing
  widget schemas; read the existing structure from `inventory.json` and follow it.

## Quality bar (every change)
- Responsive at 320, 375, 768, 1024, 1366, 1920 — no horizontal overflow, tap targets ≥ 44px.
- Performance: no new render-blocking assets; images WebP, sized, lazy-loaded below the fold.
- Accessibility: alt text, heading order, label/inputs, contrast AA.
- Security: escape output, sanitize input, nonces on forms, no inline secrets, no external
  scripts from unknown origins.
- Scoped CSS: prefix every class with the site's `css_prefix`; no global selectors.

## Statuses
`new → planned → applying → preview_ready → approved → live`
side paths: `needs_info`, `qa_failed`, `rejected`, `rolled_back`, `error`

## Learnings
Read `docs/LEARNINGS.md` before working. When a change fails QA or is rejected, add one line there
describing the cause and the rule that prevents it.
