# Progress / resume point

Read this first in any new session (Claude Code, chat, scheduled task) to see where things
stand — Ghazan forgets the details between sessions, this file is the source of truth.

## Done
- **Step 1** — repo skeleton, `CLAUDE.md` rules, schemas, skills.
- **Step 2** — Autopilot Bridge plugin v0.1, e2e-tested.
- **Step 3** — GitHub Actions: onboard, apply→QA→report, approve/rollback, health.
  `AP_SIGNING_KEY` / `AP_KEY_ID` added to repo secrets.
- Test site **nextleveldigitals.com**: WordPress reset, Bridge connected, onboarded, status
  `active` in `state.json`.
- **Step 4** — dashboard (Cloudflare Pages/Worker, password login) built and deployed, live
  on its `*.workers.dev` subdomain. Dashboard v2: reference-website option (replicate /
  inspired), asset + brand-guidelines upload.
- Channel integrations: Inbox tab, webhooks for Slack/Trello/ClickUp/email, per-site channel
  mapping, outbound notices, `wp-seo` / `wp-conversion` / `wp-figma-build` / `wp-inbox-poll`
  skills, high-risk staging gate, 2-hourly scheduled task (08:17–22:17 PKT). Connections page
  built (tokens in encrypted Cloudflare KV, auto Trello/ClickUp webhooks, Slack via manifest).
- **2026-11-14** — `tools/llm_router.py` added: routes low-stakes drafting (SEO meta, alt
  text, FAQ copy, paraphrasing) to a free OpenRouter model so it doesn't cost Claude's own
  tokens. Wired into `CLAUDE.md` → Token economy. Setup/usage in `docs/LLM_ROUTER.md`.

## Pending (in rough order)
1. Connect Slack on the dashboard Connections page.
2. Set repo variable `DASHBOARD_URL`.
3. Confirm the Cloudflare KV namespace auto-created on deploy — if not, follow
   `docs/CHANNELS.md` → Storage section to create it manually.
4. Plugin `menu.update` route — needs a local WordPress test environment to finish.
5. Figma connector / import UI for `wp-figma-build`.
6. **Get an OpenRouter API key** (free, openrouter.ai) and add it as:
   - GitHub Actions secret `OPENROUTER_API_KEY`
   - local env var wherever the agent loop runs (Claude Code shell / n8n), so
     `tools/llm_router.py` actually has something to call.
7. First real site build through the finished product: **Next Level Digitals** —
   brand & assets upload, then Elementor install.

## Not started
- Full clone staging (Step 6).
- Selling the system to other users (deferred until he's built/tested it on his own sites).

## Notes for whoever resumes
- No Anthropic API key / Claude Max plan for this project — the agent loop itself (reading
  `state.json`, writing `change.json`, etc.) is run by Claude directly (Claude Code or a
  scheduled Claude session), triggered the same way as the sneakydeals-pipeline. The free-LLM
  router above only offloads *drafting*, not the agent loop itself.
- Secrets never go in the repo — signing key, channel tokens, and now `OPENROUTER_API_KEY`
  are GitHub secrets / Cloudflare KV only.
