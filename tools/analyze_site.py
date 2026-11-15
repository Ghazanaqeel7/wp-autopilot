#!/usr/bin/env python3
"""Auto-draft a site's design system from its own live homepage (runs in GitHub Actions,
costs no Claude tokens — same Playwright approach as tools/reference.py).

Why: when an existing/already-built website is connected to Autopilot (a client's live
WordPress site, or any site with a reachable URL), new pages/sections it gets through this
system must match that site's OWN theme — not a design Claude invents from scratch. This
script crawls the live homepage, pulls out the dominant colours, the heading/body fonts,
the primary button style and spacing hints, and writes a draft `sites/<site>/design.json`
so Claude only has to review/confirm it (one cheap read) instead of extracting it by hand.

  python tools/analyze_site.py <site>

Behaviour:
- Reads sites/<site>/site.json for `url`. No url → prints a note and exits 0 (nothing to do;
  a from-scratch build has no existing site to analyse).
- If sites/<site>/design.json already exists AND is not itself a draft from this script
  (no `"source": "auto-analyzed"` field) → exits 0 without touching it. A human/Claude-
  confirmed design.json is never silently overwritten.
- Otherwise crawls the homepage (desktop viewport), extracts tokens, writes design.json with
  `"status": "draft — review before first build"` and `"source": "auto-analyzed"` so CLAUDE.md
  / wp-premium-design knows to treat it as a draft, not a confirmed system.
- Never touches live content, never clicks/submits anything — read-only navigation + a full
  scroll to trigger lazy-loaded styles, same as reference.py's reference-site capture.
"""
import json
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Same extraction approach as tools/reference.py's OUTLINE_JS, but focused on design tokens
# rather than section structure (reference.py is for a *competitor's* site; this is for the
# client's OWN existing site, so we only need colours/fonts/buttons/spacing here).
TOKENS_JS = r"""() => {
  const cs = (el) => getComputedStyle(el);
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 10; };
  const h1 = document.querySelector('h1');
  const h2 = document.querySelector('h2');
  const btn = document.querySelector('a[class*=btn],a[class*=button],button,.wp-block-button__link');
  const count = {};
  [...document.querySelectorAll('body *')].slice(0, 2000).forEach((el) => {
    if (!vis(el)) return;
    const s = cs(el);
    [s.color, s.backgroundColor].forEach((c) => {
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') count[c] = (count[c] || 0) + 1;
    });
  });
  const radii = {};
  [...document.querySelectorAll('button, a[class*=btn], .card, [class*=card]')].slice(0, 100).forEach((el) => {
    const r = cs(el).borderRadius; if (r && r !== '0px') radii[r] = (radii[r] || 0) + 1;
  });
  const sections = [...(document.querySelector('main') || document.body).children].filter(vis).slice(0, 20);
  const paddings = sections.map((el) => parseInt(cs(el).paddingTop) || 0).filter((n) => n > 8);
  return {
    title: document.title.slice(0, 120),
    fonts: {
      heading: h1 ? cs(h1).fontFamily : (h2 ? cs(h2).fontFamily : null),
      heading_weight: h1 ? cs(h1).fontWeight : null,
      body: cs(document.body).fontFamily,
      body_size: cs(document.body).fontSize,
    },
    button: btn ? { bg: cs(btn).backgroundColor, color: cs(btn).color, radius: cs(btn).borderRadius,
                    font: cs(btn).fontFamily, weight: cs(btn).fontWeight } : null,
    top_colors: Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, n]) => ({ value: c, count: n })),
    common_radius: Object.entries(radii).sort((a, b) => b[1] - a[1]).map(([r]) => r)[0] || null,
    section_padding_samples: paddings.slice(0, 8),
  };
}"""
SCROLL_JS = """async () => { for (let y = 0; y < document.body.scrollHeight; y += innerHeight) {
  window.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } window.scrollTo(0, 0); }"""


def load(p, default=None):
    return json.loads(p.read_text()) if p.exists() else default


def main(site: str) -> int:
    site_dir = ROOT / "sites" / site
    cfg_path = site_dir / "site.json"
    cfg = load(cfg_path)
    if not cfg:
        print(f"no sites/{site}/site.json — nothing to analyse", file=sys.stderr)
        return 1

    url = (cfg.get("url") or "").strip()
    if not re.match(r"^https?://", url):
        print(f"{site}: no reachable url in site.json — skipping auto-analysis (from-scratch build)")
        return 0

    design_path = site_dir / "design.json"
    existing = load(design_path)
    if existing and existing.get("source") != "auto-analyzed":
        print(f"{site}: design.json already exists and is not an auto-draft — leaving it alone")
        return 0

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1366, "height": 900})
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception as e:
            print(f"{site}: load warning on {url}: {str(e)[:160]}", file=sys.stderr)
        try:
            page.evaluate(SCROLL_JS)
            page.wait_for_timeout(500)
        except Exception:
            pass
        tokens = page.evaluate(TOKENS_JS)
        browser.close()

    # Keep only colours that look like real brand colours (drop near-white/near-black noise
    # that every site has from borders/dividers) — a human/Claude pass still confirms the
    # final palette, this is just a reasonable starting draft.
    def _is_near_grey_or_white_or_black(rgb_str):
        m = re.findall(r"\d+", rgb_str)
        if len(m) < 3:
            return False
        r, g, b = (int(x) for x in m[:3])
        return (max(r, g, b) - min(r, g, b) < 12) or (r > 245 and g > 245 and b > 245) or (r < 12 and g < 12 and b < 12)

    brand_colors = [c for c in tokens.get("top_colors", []) if not _is_near_grey_or_white_or_black(c["value"])][:6]

    draft = {
        "source": "auto-analyzed",
        "analyzed_url": url,
        "status": "draft — review before first build",
        "colors": {
            f"color_{i+1}": {"value": c["value"], "sample_count": c["count"], "use": "[CONFIRM: role — primary/accent/neutral]"}
            for i, c in enumerate(brand_colors)
        },
        "fonts": {
            "heading": tokens["fonts"].get("heading"),
            "heading_weight": tokens["fonts"].get("heading_weight"),
            "body": tokens["fonts"].get("body"),
            "body_size": tokens["fonts"].get("body_size"),
            "rule": "two fonts max, never mix a third",
        },
        "button": tokens.get("button"),
        "radius": tokens.get("common_radius"),
        "spacing_samples_px": tokens.get("section_padding_samples"),
        "notes": (
            f"Auto-extracted from the live homepage ({url}) so new pages/sections built through "
            "Autopilot match this site's existing look. Claude: review this once before the first "
            "build — confirm which colors are primary/accent/neutral, drop any that were just "
            "incidental (borders/shadows), and fill in type_scale/spacing from inventory.json if "
            "this draft under-specifies it. Replace this whole file with a confirmed design.json "
            "(drop the 'source'/'status' draft fields) once you have — see CLAUDE.md → Design."
        ),
    }
    design_path.write_text(json.dumps(draft, indent=2, ensure_ascii=False) + "\n")
    print(f"{site}: wrote draft design.json from {url} ({len(brand_colors)} candidate brand colors)")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: analyze_site.py <site>", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
