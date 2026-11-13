#!/usr/bin/env bash
# Commit runner output (state, site data, reports) with rebase-retry. Never commits secrets.
set -euo pipefail
msg="${1:-autopilot: update}"
git config user.name "wp-autopilot[bot]"
git config user.email "wp-autopilot@users.noreply.github.com"
git add state.json sites reports requests inbox 2>/dev/null || true
if git diff --cached --quiet; then echo "nothing to commit"; exit 0; fi
git commit -qm "$msg"
for i in 1 2 3 4; do
  git pull -q --rebase origin "${GITHUB_REF_NAME:-main}" && git push -q origin HEAD:"${GITHUB_REF_NAME:-main}" && exit 0
  sleep $((i * 5))
done
echo "push failed after retries"; exit 1
