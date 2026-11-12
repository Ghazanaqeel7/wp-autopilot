# WP Autopilot

AI-operated WordPress delivery & maintenance system. Add a website once; send requirements or change
requests (doc, voice note, message); Claude plans and builds the change, the system snapshots the site,
applies the change to a **preview changeset**, runs QA, produces a Change Report, and goes live only after
human approval. Every change is reversible.

## Architecture

```
 Discord / Slack / Dashboard ──▶ n8n (messenger) ──▶ requests/<id>/  (this repo = job board)
                                                         │
                         Claude scheduled task (brain) ◀─┘  reads request, writes change package
                                                         │  sites/<site>/changes/<id>/change.json
                                                         ▼
                         GitHub Actions (hands) ── signed API ──▶ Autopilot Bridge plugin (on each WP site)
                           apply → QA → report → wait ✅ → promote | rollback
                                                         │
                                       dashboard/ (Cloudflare Pages) reads state.json + reports/
```

| Layer | Folder | Role |
|---|---|---|
| Brain | `CLAUDE.md` | Rules Claude follows for every request |
| Job board | `state.json`, `requests/`, `sites/` | Single source of truth |
| Hands | `.github/workflows/` | Apply, QA, report, promote, rollback, health |
| Site agent | `bridge-plugin/` | WordPress plugin: signed API, changesets, preview, snapshots |
| Builders | `adapters/` | Elementor, Gutenberg, classic theme (more later) |
| Messenger | `n8n/` | Intake + approvals |
| UI | `dashboard/` | Sites, requests, approvals, reports, health |
| Contracts | `schemas/` | JSON schemas for site, request, change |

## Non-negotiable safety rules
1. Nothing touches the live site until a human approves (✅).
2. A snapshot is taken before every apply; every change package carries its rollback.
3. Credentials live only in GitHub Secrets — never in the repo, never visible to Claude.
4. Every request to a site is signed (Ed25519), timestamped and single-use (nonce).
5. Every action is written to the audit log (`sites/<site>/audit.log` + plugin log).
6. Kill switch: `state.json → config.paused = true` (global) or `sites/<site>/site.json → paused`.

## Status
- [x] Step 1 — repo skeleton, rules, schemas
- [x] Step 2 — Autopilot Bridge plugin v1 (tested end-to-end)
- [ ] Step 3 — Actions: apply / QA / report / promote / rollback / health
- [ ] Step 4 — Dashboard v1 + Add Website module
- [ ] Step 5 — n8n + Discord intake/approvals
- [ ] Step 6 — Full clone staging
