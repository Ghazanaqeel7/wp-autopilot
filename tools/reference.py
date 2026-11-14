#!/usr/bin/env python3
"""Capture a reference website for a request (runs in GitHub Actions, costs no Claude tokens).

  reference.py <request-id>

Reads the "## Reference" section of requests/<id>/request.md and writes requests/<id>/reference/:
  desktop.jpg, mobile.jpg   full-page screenshots of the given url
  outline.json              structure only: sections, headings, nav (text + href), CTAs, fonts, colours
  content.txt               page text — ONLY when own_site is "yes" (never for third-party sites)

If the Reference block has `pages: all`, also crawls same-origin links found in the homepage's
nav/header/footer (deduped, capped at 10) and captures each the same way into
requests/<id>/reference/pages/<slug>/{desktop.jpg,mobile.jpg,outline.json}. Each page outline's
`nav` entries include `href` so this crawl (and any future one) can follow real links instead of
guessing URLs.
"""
import json, pathlib, re, sys
from urllib.parse import urljoin, urlparse

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
rid = sys.argv[1] if len(sys.argv) > 1 else ""
if not re.match(r"^R\d{8}-\d{3}$", rid):
    sys.exit("bad request id")
md = (ROOT / "requests" / rid / "request.md").read_text()
sec = (md.split("## Reference")[1].split("\n## ")[0]) if "## Reference" in md else ""
ref = dict(m.groups() for m in re.finditer(r"^- (\w+): (.*)$", sec, re.M))
url = ref.get("url", "").strip()
if not re.match(r"^https?://", url):
    sys.exit("no reference url in request")
own = ref.get("own_site", "no").strip() == "yes"
crawl_all = ref.get("pages", "").strip().lower() == "all"
out = ROOT / "requests" / rid / "reference"
out.mkdir(parents=True, exist_ok=True)

OUTLINE_JS = r"""() => {
  const t = (el, n = 90) => (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const cs = (el) => getComputedStyle(el);
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 20; };
  const main = document.querySelector('main') || document.body;
  let blocks = [...main.children].filter(vis);
  if (blocks.length < 3 && blocks[0]) blocks = [...blocks[0].children].filter(vis);
  const sections = blocks.slice(0, 40).map((el) => {
    const r = el.getBoundingClientRect();
    const cols = Math.max(0, ...[el, ...el.querySelectorAll('*')].slice(0, 400).map((c) => {
      const d = cs(c).display; return (d.includes('grid') || d.includes('flex')) ? [...c.children].filter(vis).length : 0; }));
    return { tag: el.tagName.toLowerCase(), height: Math.round(r.height), bg: cs(el).backgroundColor,
      headings: [...el.querySelectorAll('h1,h2,h3')].slice(0, 6).map((h) => h.tagName.toLowerCase() + ': ' + t(h)),
      images: el.querySelectorAll('img,picture,video,svg').length, buttons: [...el.querySelectorAll('a[class*=btn],a[class*=button],button')].slice(0, 4).map((b) => t(b, 40)).filter(Boolean),
      forms: el.querySelectorAll('form').length, max_columns: Math.min(cols, 8) };
  });
  const h1 = document.querySelector('h1'), btn = document.querySelector('a[class*=btn],a[class*=button],button');
  const count = {};
  [...document.querySelectorAll('body *')].slice(0, 1500).forEach((el) => { const s = cs(el);
    [s.color, s.backgroundColor].forEach((c) => { if (c && c !== 'rgba(0, 0, 0, 0)') count[c] = (count[c] || 0) + 1; }); });
  return { title: document.title.slice(0, 120),
    nav: [...document.querySelectorAll('header a, nav a, footer a')].slice(0, 40)
      .map((a) => ({ text: t(a, 30), href: a.getAttribute('href') || '' }))
      .filter((l) => l.text),
    fonts: { body: cs(document.body).fontFamily, heading: h1 ? cs(h1).fontFamily : null, h1_size: h1 ? cs(h1).fontSize : null },
    button: btn ? { bg: cs(btn).backgroundColor, color: cs(btn).color, radius: cs(btn).borderRadius } : null,
    top_colors: Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]),
    page_height: document.documentElement.scrollHeight, sections };
}"""
SCROLL_JS = """async () => { for (let y = 0; y < document.body.scrollHeight; y += innerHeight) {
  window.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } window.scrollTo(0, 0); }"""


def slugify(u):
    p = urlparse(u).path.strip("/") or "home"
    s = re.sub(r"[^a-z0-9]+", "-", p.lower()).strip("-")
    return s[:60] or "home"


def capture_page(pg_url, dest):
    dest.mkdir(parents=True, exist_ok=True)
    outline = None
    for name, w, h in (("desktop", 1366, 900), ("mobile", 375, 800)):
        pg = browser.new_page(viewport={"width": w, "height": h})
        try:
            pg.goto(pg_url, wait_until="domcontentloaded", timeout=60000)
            pg.wait_for_load_state("networkidle", timeout=15000)
        except Exception as e:
            print("load warning:", str(e)[:120])
        try:
            pg.evaluate(SCROLL_JS)
            pg.wait_for_timeout(500)
        except Exception:
            pass
        pg.screenshot(path=str(dest / f"{name}.jpg"), full_page=True, type="jpeg", quality=55)
        if name == "desktop":
            outline = pg.evaluate(OUTLINE_JS)
            outline.update(url=pg_url, mode=ref.get("mode", "inspired"), own_site=own)
            (dest / "outline.json").write_text(json.dumps(outline, indent=1, ensure_ascii=False))
            if own:
                (dest / "content.txt").write_text(pg.evaluate("document.body.innerText")[:30000])
        pg.close()
    return outline


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    home_outline = capture_page(url, out)
    print(f"captured {url} → {out.relative_to(ROOT)} (own_site={own})")

    if crawl_all and home_outline:
        origin = urlparse(url)
        seen = {urlparse(url).path.rstrip("/") or "/"}
        queue = []
        for link in home_outline.get("nav", []):
            href = (link.get("href") or "").strip()
            if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
                continue
            full = urljoin(url, href)
            pu = urlparse(full)
            if pu.netloc != origin.netloc:
                continue
            path = pu.path.rstrip("/") or "/"
            if path in seen:
                continue
            seen.add(path)
            queue.append(full)
        queue = queue[:10]
        for pg_url in queue:
            slug = slugify(pg_url)
            dest = out / "pages" / slug
            try:
                capture_page(pg_url, dest)
                print(f"captured {pg_url} → {dest.relative_to(ROOT)}")
            except Exception as e:
                print(f"skip {pg_url}: {str(e)[:150]}")
    browser.close()
