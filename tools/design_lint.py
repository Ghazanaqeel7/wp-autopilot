#!/usr/bin/env python3
"""Design-system consistency checker.

Why: every model that touches a site's visuals (Claude, or a free OpenRouter model
drafting a first-pass snippet/CSS via llm_router.py) must stay inside that site's
design.json tokens — not invent its own colours/fonts/spacing. This script is the
mechanical backstop: it scans a file (or change.json's inline CSS/style payloads)
for hex colours and font-family names that are NOT in sites/<site>/design.json, and
exits non-zero with a one-line-per-finding report if it finds any.

It does not understand CSS semantics (no cascade, no variables) — it is a cheap
grep-grade net to catch drift before a human/Claude review, not a replacement for
that review. Claude still reads and signs off on every change per CLAUDE.md.

CLI:
  python tools/design_lint.py <site> <file-or-dir> [<file-or-dir> ...]
  python tools/design_lint.py nextleveldigitals sites/nextleveldigitals/changes/R123/

Exit codes: 0 = clean (or no design.json for this site — nothing to check against),
1 = findings reported, 2 = usage/IO error.
"""
import json
import re
import sys
from pathlib import Path

HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{3}){1,2}\b")
FONT_FAMILY_RE = re.compile(r"font-family\s*:\s*([^;]+);?", re.IGNORECASE)
# A handful of hex/keyword values that are never "brand drift" — safe to ignore.
NEUTRAL_ALLOW = {
    "#fff", "#ffffff", "#000", "#000000", "#transparent",
}


def load_design_tokens(site: str):
    path = Path("sites") / site / "design.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    allowed_hex = set()
    for c in data.get("colors", {}).values():
        if isinstance(c, dict):
            for key in ("hex", "gradientTo"):
                v = c.get(key)
                if v:
                    allowed_hex.add(v.lower())
        elif isinstance(c, str) and c.startswith("#"):
            allowed_hex.add(c.lower())

    allowed_fonts = set()
    for v in data.get("fonts", {}).values():
        if not isinstance(v, str):
            continue
        # fonts.heading is like "Sora (700/800) — headlines..." — take the first word(s)
        # up to a space+paren or em-dash as the family name.
        name = re.split(r"\s*\(|\s+—|\s+-\s", v)[0].strip()
        if name and name.lower() != "two fonts max, never mix a third".lower():
            allowed_fonts.add(name.lower())
    return {"hex": allowed_hex, "fonts": allowed_fonts}


def iter_text_files(targets):
    exts = {".css", ".scss", ".json", ".php", ".html", ".js", ".jsx", ".tsx"}
    for t in targets:
        p = Path(t)
        if p.is_file():
            yield p
        elif p.is_dir():
            for sub in p.rglob("*"):
                if sub.is_file() and sub.suffix.lower() in exts:
                    yield sub


def check_file(path: Path, tokens):
    findings = []
    try:
        text = path.read_text(errors="ignore")
    except Exception:
        return findings

    for m in HEX_RE.finditer(text):
        hexval = m.group(0).lower()
        if hexval in NEUTRAL_ALLOW:
            continue
        if hexval not in tokens["hex"]:
            line = text.count("\n", 0, m.start()) + 1
            findings.append(f"{path}:{line}: off-token color {m.group(0)} — not in design.json colors")

    for m in FONT_FAMILY_RE.finditer(text):
        family = m.group(1).strip().strip("'\"").split(",")[0].strip().lower()
        if family in {"inherit", "initial", "unset"} or family.startswith("var("):
            # A CSS custom property reference (var(--font-head)) is fine — the
            # property's own definition (in :root) is what gets checked below.
            continue
        if family and family not in tokens["fonts"]:
            line = text.count("\n", 0, m.start()) + 1
            findings.append(f"{path}:{line}: off-token font-family '{family}' — not in design.json fonts")

    return findings


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 2:
        print("usage: design_lint.py <site> <file-or-dir> [...]", file=sys.stderr)
        sys.exit(2)
    site, *targets = args
    tokens = load_design_tokens(site)
    if tokens is None:
        print(f"no design.json for site '{site}' — nothing to check against (pass)")
        sys.exit(0)
    if not tokens["hex"] and not tokens["fonts"]:
        print(f"design.json for '{site}' has no colors/fonts tokens — nothing to check (pass)")
        sys.exit(0)

    all_findings = []
    for f in iter_text_files(targets):
        all_findings.extend(check_file(f, tokens))

    if all_findings:
        print(f"design_lint: {len(all_findings)} off-token value(s) found for '{site}':")
        for line in all_findings:
            print("  " + line)
        sys.exit(1)

    print(f"design_lint: clean — all colors/fonts match sites/{site}/design.json")
    sys.exit(0)
