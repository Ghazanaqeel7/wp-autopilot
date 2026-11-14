#!/usr/bin/env python3
"""QA for a deployed custom (static) site's preview build.

No WordPress Bridge and no prior "live" install to diff against — this just checks the
deployed preview URL directly: screenshots + console errors + overflow + broken links at
every viewport, plus a Lighthouse run, same thresholds as the WordPress pipeline
(state.json → config.qa).

Reads $RUNNER_TEMP/autopilot/qa_input.json (site, request, preview_url, pages[], viewports[]).
Writes reports/<site>/<request>/qa.json + screens/*.jpg.
"""
import json, os, pathlib, shutil, subprocess, sys
from urllib.parse import urljoin, urlparse

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
TMP = pathlib.Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "autopilot"
inp = json.loads((TMP / "qa_input.json").read_text())
rdir = ROOT / "reports" / inp["site"] / inp["request"]
shots = rdir / "screens"
shots.mkdir(parents=True, exist_ok=True)
MAX_LINKS = 40

SCROLL_JS = """async () => { for (let y = 0; y < document.body.scrollHeight; y += innerHeight) {
  window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); }"""


def slug(path):
    s = path.strip("/").replace("/", "_") or "home"
    return "".join(c for c in s if c.isalnum() or c in "_-")[:40]


def capture(ctx, url, width, name):
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text[:160]) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)[:160]))
    page.set_viewport_size({"width": width, "height": 900})
    try:
        resp = page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception as e:
        resp = None
        errors.append(f"load: {str(e)[:120]}")
    try:
        page.evaluate(SCROLL_JS)
        page.wait_for_timeout(400)
    except Exception:
        pass
    overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
    file = shots / f"{name}.jpg"
    page.screenshot(path=str(file), full_page=True, type="jpeg", quality=60)
    links = page.eval_on_selector_all("a[href]", "els => els.map(e => e.href)")
    page.close()
    return {"status": resp.status if resp else 0, "overflow": bool(overflow), "console_errors": sorted(set(errors)),
            "shot": f"screens/{file.name}"}, links


def broken_links(ctx, links, host):
    seen, bad = set(), []
    for href in links:
        u = urlparse(href)
        if u.scheme not in ("http", "https") or u.netloc != host:
            continue
        clean = href.split("#")[0]
        if clean in seen:
            continue
        seen.add(clean)
        if len(seen) > MAX_LINKS:
            break
        try:
            r = ctx.request.get(clean, timeout=20000, max_redirects=5)
            if r.status >= 400:
                bad.append(f"{u.path} ({r.status})")
        except Exception:
            bad.append(f"{u.path} (timeout)")
    return bad


def lighthouse(url):
    exe = shutil.which("lighthouse")
    if not exe:
        return None
    args = [exe, url, "--quiet", "--output=json", "--output-path=stdout",
            "--only-categories=performance,accessibility,best-practices,seo",
            "--chrome-flags=--headless=new --no-sandbox"]
    try:
        out = subprocess.run(args, capture_output=True, text=True, timeout=240).stdout
        cats = json.loads(out)["categories"]
        return {k.replace("-", "_"): round(v["score"] * 100) for k, v in cats.items() if v.get("score") is not None}
    except Exception as e:
        print("lighthouse failed:", str(e)[:200], file=sys.stderr)
        return None


def main():
    base = inp["preview_url"].rstrip("/") + "/"
    pages = inp.get("pages") or ["/"]
    host = urlparse(base).netloc
    result = {"pages": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        ctx = browser.new_context(ignore_https_errors=True, user_agent="wp-autopilot-qa-custom/0.1")
        for path in pages:
            url = urljoin(base, path.lstrip("/"))
            entry = {"path": "/" + path.lstrip("/"), "viewports": []}
            all_links = []
            for w in inp["viewports"]:
                after, links = capture(ctx, url, w, f"{slug(path)}-{w}")
                all_links = all_links or links
                entry["viewports"].append({"width": w, "after": after})
            entry["broken_links"] = broken_links(ctx, all_links, host)
            result["pages"].append(entry)
        browser.close()

    first = urljoin(base, pages[0].lstrip("/"))
    result["lighthouse"] = {"after": lighthouse(first) or {}}
    (rdir / "qa.json").write_text(json.dumps(result, indent=2))
    print(f"QA done: {len(result['pages'])} page(s), lighthouse={'yes' if result['lighthouse']['after'] else 'no'}")


if __name__ == "__main__":
    main()
