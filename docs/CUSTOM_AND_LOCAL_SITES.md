# Custom (non-WordPress) sites + local dev + live-preview links

Design for the three things requested 2026-11-14: (1) build non-WordPress sites too,
(2) a "work locally, push to live later" option, (3) a live-preview link for all of it,
separate from the existing WordPress preview mechanism. This is architecture-level — the
pieces below are what's safe to build without guessing; a few need your decisions/accounts
(marked) before they can be built for real.

## 1. Site `kind` (schema change — done)
`site.json` gets a new field, `kind`, one of:
- `wordpress-bridge` (default, existing behaviour) — live WP site with the Bridge plugin,
  staged changes applied via GitHub Actions, as today.
- `wordpress-local` — a WordPress site that starts on the owner's own machine (or a disposable
  cloud sandbox), built/edited there, then pushed to a real host when ready.
- `custom` — not WordPress at all (static HTML/CSS/JS, or a small framework build); built as
  files, not as WP change-ops.

Everything in `apply_op()` / the change schema stays as-is for `wordpress-bridge`. `custom` and
`wordpress-local` don't go through `change.json` at all — they go through a **build**, not a
changeset (see §3).

## 2. "Work locally, push to live" — `wordpress-local`
Two different meanings of "local," and they need different mechanisms:

**(a) Local on *your* machine (or any future customer's machine).** This needs a small
companion program running there — an **Autopilot Local Agent**. Realistic shape:
- A CLI (Node or Go binary) the owner installs once. On `autopilot-agent start <site>` it spins
  up WordPress via Docker (wp-cli + the official WordPress image) on a free local port.
- It registers itself with the dashboard over a websocket/poll, carrying a short-lived pairing
  code (same spirit as the existing site-connection code for the Bridge plugin).
- The dashboard sends the same kind of change-ops to the local agent that it sends to a live
  Bridge site; the agent's embedded Bridge-plugin-equivalent applies them to the local WP.
- "Push to live" = once happy, the agent (or a GitHub Action) exports the DB+files
  (WP-CLI `db export` + files) and imports them into a newly connected live host — effectively
  an onboarding of a *new* `wordpress-bridge` site seeded from the local one.
- **Needs from you:** this agent is new software with its own install/download/trust story
  (code-signing if you want it trusted on Windows/Mac without warnings), and it only works
  while your machine is on and the agent is running — not something I can finish without you
  picking: language/runtime for the agent, and whether Docker is a hard requirement for whoever
  runs it.

**(b) Local as in "a disposable sandbox Autopilot manages for you" (no install).** Simpler to
build, no agent needed: spin up a short-lived WordPress container in a cloud sandbox (this
system's own CI runners, or a small VPS), same change-op pipeline as a real site, give it a
preview link (§3), and when approved either keep it running as the real site's staging copy or
export+import into the customer's own host. **Needs from you:** somewhere to run these
containers persistently-enough for a work session (your GitHub Actions runners can do it for a
single job's duration, but not a multi-hour editing session — that needs a small always-on host
or a provider like Fly.io/Railway with an API key).

Recommendation: build **(b) first** — it needs no new client software and reuses the existing
change-op pipeline; design **(a)** once (b) is proven, since it's a bigger support/trust surface.

## 3. Custom (non-WordPress) builds
No Bridge plugin, no WP change-ops — a `custom` site is built as a set of files (static
HTML/CSS/JS/GSAP, or a framework build output) in `sites/<site>/build/`. Flow:
1. Request comes in same as today (`requests/<id>/request.md`), `site.json → kind: "custom"`.
2. Claude (or the free-model first pass, same Token-economy rule as everything else) writes the
   site's files under `sites/<site>/build/`.
3. A GitHub Action publishes `build/` to a **Cloudflare Pages preview deployment** (same
   Cloudflare account as the dashboard) — Pages gives every deployment its own URL for free,
   which *is* the live-preview link, no extra mechanism to invent.
4. Approve → promote that deployment to the project's production branch/custom domain, same
   approve/rollback shape as the WordPress flow (Pages keeps deployment history, so "rollback"
   is just promoting a previous deployment).
**Needs from you:** a Cloudflare Pages project connected to this repo (or API-token-driven
deploys) — a few minutes in the Cloudflare dashboard, same account you already use for the
Workers dashboard.

## 4. Live preview + shareable link — one mechanism for all three kinds
Today's WP preview (`AP_Changesets::new_token`) only works for `wordpress-bridge`. New unified
shape so the dashboard shows one "Preview" button regardless of kind:
- `wordpress-bridge`: unchanged — Bridge-plugin capability link, as today.
- `custom`: the Cloudflare Pages deployment URL (§3) — already public-by-obscurity, time-limited
  by simply not promoting it; record it in `reports/<site>/<id>/preview.json` exactly like the
  WP one so the dashboard code doesn't need a special case.
- `wordpress-local` (sandbox): the sandbox container's port, exposed via a **Cloudflare Tunnel**
  (`cloudflared`) so it gets a real https URL without opening firewall ports — same account,
  no extra login.
All three write the same `preview.json` shape (`{url, expires}`), so the dashboard's existing
preview-link UI works unmodified for every kind.

## What I built today (2026-11-14)
- This design doc.
- `site.kind` field added to `schemas/site.schema.json` (enum above, default
  `wordpress-bridge` — fully backward compatible, nothing existing breaks).

## What's genuinely next (in order, each gated on the one before)
1. You decide: build §2(b) sandbox-WP first (recommended) — needs a small always-on host or a
   Fly.io/Railway account + API key.
2. Cloudflare Pages project created for `custom` builds (§3) — a few clicks on your side.
3. Once both exist, the GitHub Actions + worker code to drive them is a normal build — I can
   write that once the accounts/hosts exist, same as every other piece of this system.
4. Local Agent (§2a) is the last piece — bigger scope, worth doing once (b) and (3) are live and
   proven.

Nothing here is fake-completed: the agent, the sandbox host and the Pages project don't exist
yet, so no site can actually use `wordpress-local` or `custom` yet. `kind` defaults to
`wordpress-bridge` so every existing site keeps working exactly as before.

## Wiring (2026-11-14)
- Cloudflare Pages project: `wp-autopilot-sites` (connected to this repo).
- GitHub secrets added: `CLOUDFLARE_API_TOKEN` (Account: Cloudflare Pages Edit), `CLOUDFLARE_ACCOUNT_ID`.
- `.github/workflows/deploy-custom.yml` added: deploys `sites/<site>/build/` to Pages
  (one Pages branch per site, so each gets its own stable `*.pages.dev` preview URL), refuses
  to run on any site whose `site.json -> kind` isn't `custom`, writes
  `reports/<site>/<request>/preview.json` in the same shape the WordPress flow uses.
- Not yet verified end to end (no `custom`-kind site with a `build/` folder exists yet to
  trigger it) — first real use will confirm the wrangler/Pages wiring works as designed.
