#!/usr/bin/env python3
"""Proactive suggestions — the system's own ideas, not a client request.

Runs weekly (suggest.yml) for every active, non-paused site. Looks at the site's
brand/business info and what's already been suggested, asks the free-model router
(tools/llm_router.py — see Token economy in CLAUDE.md) for a short list of SEO,
content and CTA ideas grounded in that client's real business, and writes any new
ones to suggestions/<id>.json — the same shape as an inbox item, shown in the
dashboard's Suggestions tab, one click away from becoming a real request.

This never writes to a site or opens a request by itself. It only proposes;
the owner reviews in the dashboard and clicks "Create request" (or dismisses it).

Usage: python tools/suggest.py <site_id>
"""
import hashlib
import json
import pathlib
import subprocess
import sys
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAX_PER_SITE_PER_RUN = 3
MAX_OPEN_PER_SITE = 8  # don't keep piling suggestions up if the owner isn't acting on them


def load(p, default=None):
    p = ROOT / p
    if not p.exists():
        return default
    return json.loads(p.read_text())


def now():
    return datetime.now(timezone.utc).isoformat()


def ask_router(prompt):
    try:
        out = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "llm_router.py"), "ask", "--system",
             "You suggest concrete, specific SEO/content/CTA improvements for one real small "
             "business's website. Reply with ONLY a JSON array, no prose, no markdown fences. "
             "Each item: {\"type\": \"seo\"|\"content\"|\"cta\", \"title\": short (<=70 chars), "
             "\"detail\": one or two sentences, specific to this business, not generic filler}.",
             prompt],
            capture_output=True, text=True, timeout=90, check=True,
        )
        return out.stdout.strip()
    except Exception:
        return None


def parse_items(raw):
    if not raw:
        return []
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        raw = raw[raw.find("\n") + 1:] if raw.lower().startswith("json") else raw
    try:
        data = json.loads(raw)
    except Exception:
        start, end = raw.find("["), raw.rfind("]")
        if start == -1 or end == -1:
            return []
        try:
            data = json.loads(raw[start:end + 1])
        except Exception:
            return []
    out = []
    for it in data if isinstance(data, list) else []:
        t = str(it.get("type", "")).lower().strip()
        title = str(it.get("title", "")).strip()[:70]
        detail = str(it.get("detail", "")).strip()[:600]
        if t in ("seo", "content", "cta") and title and detail:
            out.append({"type": t, "title": title, "detail": detail})
    return out


def main():
    if len(sys.argv) != 2:
        print("usage: suggest.py <site_id>", file=sys.stderr)
        sys.exit(1)
    site = sys.argv[1]
    cfg = load(f"sites/{site}/site.json")
    if not cfg or cfg.get("paused") or cfg.get("status") not in (None, "active"):
        return  # skip quietly — paused/inactive/missing site

    brand = load(f"sites/{site}/brand.json", {}) or {}
    business = brand.get("business") or cfg.get("name") or site
    audience = brand.get("audience") or ""
    tone = brand.get("tone") or ""
    remember = brand.get("always_remember") or ""

    sdir = ROOT / "suggestions"
    sdir.mkdir(exist_ok=True)
    existing = []
    for f in sdir.glob("*.json"):
        try:
            d = json.loads(f.read_text())
        except Exception:
            continue
        if d.get("site") == site:
            existing.append(d)
    open_count = sum(1 for d in existing if d.get("status") == "new")
    if open_count >= MAX_OPEN_PER_SITE:
        return  # owner has a backlog already — don't add noise
    seen_titles = {d.get("title", "").lower() for d in existing}

    prompt = (
        f"Business: {business}\n"
        f"Audience: {audience}\n"
        f"Tone: {tone}\n"
        + (f"Always remember: {remember}\n" if remember else "")
        + "Suggest 3 specific, researched SEO/content/CTA improvements for this business's "
        "website this month — e.g. a keyword/topic their market is actually searching for "
        "that they're likely missing, a content gap vs competitors, or a stronger call-to-action "
        "for their actual services. Be concrete and specific to this business, never generic."
    )
    items = parse_items(ask_router(prompt))[:MAX_PER_SITE_PER_RUN]
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    written = 0
    for it in items:
        if it["title"].lower() in seen_titles:
            continue
        h = hashlib.sha1(f"{site}-{it['title']}".encode()).hexdigest()[:8]
        sid = f"SG{day}-{site[:12]}-{h}"
        p = sdir / f"{sid}.json"
        if p.exists():
            continue
        p.write_text(json.dumps({
            "id": sid, "site": site, "type": it["type"], "title": it["title"], "detail": it["detail"],
            "status": "new", "source": "suggest", "created_at": now(),
        }, indent=2) + "\n")
        written += 1
    if written:
        print(f"{site}: {written} new suggestion(s)")


if __name__ == "__main__":
    main()
