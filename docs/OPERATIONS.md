# Operating WP Autopilot (until the dashboard exists)

All buttons live in GitHub → **Actions** (left list → workflow → **Run workflow**).

## One-time
Repo secret `AP_SIGNING_KEY` (the key id is derived automatically) (Settings → Secrets and variables → Actions).

## Add a website
1. Create `sites/<site-id>/site.json` from `sites/_template/site.json` (id = lowercase-dashes).
   Committing it runs **Onboard site** automatically.
2. First run prints a **connection code** in the run summary. Install `autopilot-bridge-x.y.z.zip`
   on the site (Plugins → Upload), Tools → Autopilot Bridge → paste code → Connect.
3. Run **Onboard site** again → inventory saved, builder detected, site `active`.

## A change
1. Request comes in (`requests/<id>/request.md`); Claude writes `sites/<site>/changes/<id>/change.json`.
2. Push runs **Apply change**: stage → full-site preview → QA at 6 widths + Lighthouse → report.
   Preview link: run summary (private). Report: `reports/<site>/<id>/report.md`.
3. Decide with **Approve / Rollback / Discard**: `promote` (go live), `discard` (drop),
   `rollback` (undo after go-live).

## Safety
- Kill switch: `state.json → config.paused: true` (all sites) or `site.json → paused: true`;
  on a site itself: Tools → Autopilot Bridge → Pause.
- QA fails only on problems the change introduced; pre-existing issues are listed as warnings.
- A revised package for the same request replaces the staged one. A live or rolled-back request
  is closed — use a new request id.
