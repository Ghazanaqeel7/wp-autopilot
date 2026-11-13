# Dashboard

Static UI (`public/`) + one Cloudflare Pages Function (`functions/api/[[path]].js`) that talks to GitHub.
The GitHub token stays on Cloudflare; the browser only gets an HttpOnly session cookie after the password.

## Deploy (Cloudflare Pages, free)
1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → choose `wp-autopilot`.
2. Build settings: Framework **None**, Build command *(empty)*, Build output directory **`public`**,
   Root directory **`dashboard`**.
3. **Environment variables** (Production) — type *Secret* for the first three:
   - `GITHUB_TOKEN` — fine-grained token (Contents RW + Actions RW, this repo only)
   - `DASHBOARD_PASSWORD` — long password you choose
   - `SESSION_SECRET` — any random 40+ characters
   - `GITHUB_REPO` — `Ghazanaqeel7/wp-autopilot` (plain text)
4. Save and Deploy. Settings → Builds → **Build watch paths**: include `dashboard/*` only (stops a
   redeploy on every bot commit).

## Local test
`wrangler pages dev public` with a `.dev.vars` file (never commit it). `GITHUB_API` may point to a mock.
