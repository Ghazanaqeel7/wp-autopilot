#!/usr/bin/env python3
"""WP Autopilot runner — the "hands". Called by GitHub Actions.

  runner.py onboard  <site>                  health + inventory, or print connection code
  runner.py stage    <site> <request>         send change package → preview link (QA runs after)
  runner.py finalize <site> <request>         read QA results → gate → report → status
  runner.py promote  <site> <request>         go live (after human approval)
  runner.py rollback <site> <request>         restore the snapshot taken at promote
  runner.py discard  <site> <request>         drop a staged change
  runner.py health                            check every active site
  runner.py notice   <site> <request> <event> send the Slack/Trello/ClickUp/email notice for an event (needs_info …)

Secret via env: AP_SIGNING_KEY (key id is derived). Preview links are time-limited (default 72h) and
are stored only in reports/<site>/<request>/preview.json of this private repo for the dashboard.
"""
import base64, datetime as dt, json, os, pathlib, re, sys

sys.path.insert(0, os.path.dirname(__file__))
import ap_client  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
STATE = ROOT / "state.json"
TMP = pathlib.Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "autopilot"
TMP.mkdir(parents=True, exist_ok=True)
ID_RE = re.compile(r"^[a-z0-9-]{2,40}$")
REQ_RE = re.compile(r"^R[0-9]{8}-[0-9]{3}$")


# ---------------------------------------------------------------- helpers
def now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def load(p, default=None):
    p = pathlib.Path(p)
    return json.loads(p.read_text()) if p.exists() else default


def save(p, data):
    p = pathlib.Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def summary(md):
    print(md)
    f = os.environ.get("GITHUB_STEP_SUMMARY")
    if f:
        with open(f, "a") as fh:
            fh.write(md + "\n")


def mask(value):
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::add-mask::{value}")


def fail(msg):
    summary(f"❌ {msg}")
    sys.exit(1)


def site_cfg(site):
    if not ID_RE.match(site):
        fail(f"invalid site id {site!r}")
    cfg = load(ROOT / "sites" / site / "site.json")
    if not cfg:
        fail(f"sites/{site}/site.json not found")
    return cfg


def call(cfg, route, body=None, timeout=120):
    if load(STATE, {}).get("config", {}).get("paused") or cfg.get("paused"):
        fail("Autopilot is paused (state.json or site.json) — nothing sent")
    status, data = ap_client.call(cfg["url"], route, body or {}, timeout=timeout,
                                  pretty_permalinks=cfg.get("pretty_permalinks", True))
    return status, data


def set_request(site, req, **fields):
    st = load(STATE)
    entry = next((r for r in st["requests"] if r["id"] == req), None)
    if not entry:
        entry = {"id": req, "site": site, "kind": "change", "source": "chat", "created_at": now()}
        st["requests"].append(entry)
    before = entry.get("status")
    entry.update(fields, updated_at=now())
    save(STATE, st)
    if fields.get("status") and fields["status"] != before:
        send_notice(site, entry, fields["status"])


def send_notice(site, entry, event):
    try:
        import notify
        name = (load(ROOT / "sites" / site / "site.json", {}) or {}).get("name", site)
        notify.notify(name, entry, event)
    except Exception as e:  # noqa: BLE001
        print(f"notify skipped: {type(e).__name__}")


def notice(site, req, event):
    """CLI for Claude after it sets needs_info/planned by hand: runner.py notice <site> <req> <event>"""
    entry = next((r for r in load(STATE)["requests"] if r["id"] == req), None)
    if entry:
        send_notice(site, entry, event)


def set_site(site, **fields):
    st = load(STATE)
    entry = next((s for s in st["sites"] if s["id"] == site), None)
    if not entry:
        entry = {"id": site}
        st["sites"].append(entry)
    entry.update(fields)
    save(STATE, st)


def audit(site, line):
    p = ROOT / "sites" / site / "audit.log"
    with open(p, "a") as fh:
        fh.write(f"{now()} {line}\n")


def report_dir(site, req):
    return ROOT / "reports" / site / req


# ---------------------------------------------------------------- commands
def onboard(site):
    cfg = site_cfg(site)
    try:
        status, h = call(cfg, "health", timeout=25)
    except Exception as e:
        fail(f"Site did not answer in 25s ({type(e).__name__}). A firewall (Cloudflare / Wordfence / host WAF) may be "
             f"blocking GitHub's servers — allow the path /wp-json/autopilot/* and try again.")
    if status in (401, 403) and h.get("code") in ("ap_not_connected", "ap_bad_key"):
        code = ap_client.connection_code(site)
        # Not secret (public key + ids): saved so the dashboard / Claude can show it without Actions logs.
        (ROOT / "sites" / site / "connection-code.txt").write_text(code + "\n")
        cfg["status"] = "pending_connect"
        save(ROOT / "sites" / site / "site.json", cfg)
        set_site(site, name=cfg["name"], url=cfg["url"], status="pending_connect")
        summary(f"### {cfg['name']} is not connected yet\n1. Install **Autopilot Bridge** on {cfg['url']}\n"
                f"2. wp-admin → Tools → Autopilot Bridge → paste this code → Connect\n\n```\n{code}\n```\n"
                f"3. Run **Onboard site** again.")
        return
    if status == 404:
        fail("Bridge plugin not reachable (404). Is it installed and active? If the site has no pretty "
             "permalinks set \"pretty_permalinks\": false in site.json.")
    if status != 200:
        fail(f"health failed: HTTP {status} {h}")
    if h.get("site_id") != site:
        fail(f"site answered as {h.get('site_id')!r}, expected {site!r} — wrong connection code?")

    status, inv = call(cfg, "inventory")
    if status != 200:
        fail(f"inventory failed: HTTP {status} {inv}")
    save(ROOT / "sites" / site / "inventory.json", inv)
    # Compact per-page outlines (ids, widget types, short texts) so Claude can target edits without
    # fetching whole pages. Refreshed on every onboard; data_hash in inventory guards against staleness.
    pdir = ROOT / "sites" / site / "pages"
    pdir.mkdir(parents=True, exist_ok=True)
    for pg in inv["pages"]:
        if pg["status"] != "publish":
            continue
        s, out = call(cfg, "page", {"post_id": pg["id"]}, timeout=60)
        if s == 200:
            out["elements"] = _slim(out.get("elements"))
            save(pdir / f"{pg['id']}.json", out)

    b = inv.get("builders", {})
    builder = next((k for k in ("elementor", "divi", "wpbakery", "bricks") if k in b), None)
    if not builder:
        builder = "gutenberg" if inv["theme"].get("block") or any(p["builder"] == "gutenberg" for p in inv["pages"]) else "classic"
    cfg.update(status="active", builder=builder, theme=inv["theme"]["name"],
               bridge={"version": h["plugin"], "site_key_id": ap_client.key_id(),
                       "connected_at": cfg.get("bridge", {}).get("connected_at") or now(),
                       "checks": {k: h[k] for k in ("https", "sodium", "file_mods", "wp", "php")}})
    save(ROOT / "sites" / site / "site.json", cfg)
    set_site(site, name=cfg["name"], url=cfg["url"], status="active", builder=builder,
             last_inventory=now(), pages=len(inv["pages"]))
    audit(site, f"onboard ok builder={builder} pages={len(inv['pages'])}")

    warn = []
    if not h["https"]:
        warn.append("Site is not on HTTPS.")
    if inv.get("cache"):
        warn.append(f"Cache plugins active ({', '.join(inv['cache'])}): exclude cookie `ap_preview` from page cache.")
    if not inv.get("security"):
        warn.append("No security plugin detected.")
    summary(f"### ✅ {cfg['name']} onboarded\nBuilder **{builder}**, theme **{inv['theme']['name']}**, "
            f"{len(inv['pages'])} pages/templates.\n" + "".join(f"- ⚠️ {w}\n" for w in warn))


CONTENT_KEYS = ("title", "editor", "text", "description", "heading", "label", "content", "caption",
                "subtitle", "name", "html", "button", "price", "link")


def _slim(nodes):
    """Keep only content-like settings in Elementor outlines (drops styling noise, saves tokens)."""
    if not isinstance(nodes, list):
        return nodes
    out = []
    for n in nodes:
        n = dict(n)
        if "s" in n:
            s = {k: v for k, v in n["s"].items()
                 if any(c in k for c in CONTENT_KEYS) and not any(x in k for x in ("color", "typography", "size", "align", "css", "clip"))}
            if s:
                n["s"] = s
            else:
                n.pop("s")
        if "c" in n:
            n["c"] = _slim(n["c"])
        out.append(n)
    return out


def _resolve_ops(site, req):
    cdir = ROOT / "sites" / site / "changes" / req
    change = load(cdir / "change.json")
    if not change:
        fail(f"{cdir}/change.json not found")
    for k in ("summary", "risk", "operations", "rollback", "qa"):
        if k not in change:
            fail(f"change.json missing {k}")
    if change["risk"] == "high":
        sj = load(ROOT / "sites" / site / "site.json", {}) or {}
        snippets_only = all(o.get("op", "").startswith("snippet.") for o in change["operations"])
        if not (sj.get("is_staging") or (sj.get("allow_live_snippets") and snippets_only)):
            set_request(site, req, status="needs_info")
            (ROOT / "requests" / req).mkdir(parents=True, exist_ok=True)
            (ROOT / "requests" / req / "questions.md").write_text(
                "# Staging copy needed\n\nThis change installs a plugin or adds code (risk: high), so it is never tried on the live site first.\n"
                "(Small snippets can run on a live site if you switch on \"Allow small code snippets on the live site\" in the site settings.)\n"
                "Make a full copy of the website with your WordPress migration plugin, add it on the dashboard as its own site, tick "
                "\"This is a staging copy\" in its settings, and send this request on that site instead. Go-live of code changes stays manual.\n")
            fail("risk=high is only applied to a site marked is_staging — not applied")
    ops = []
    for op in change["operations"]:
        op = dict(op)
        if op.get("payload_file"):
            f = (cdir / op.pop("payload_file")).resolve()
            if cdir.resolve() not in f.parents:
                fail("payload_file must stay inside the change folder")
            if op["op"] == "media.upload":
                op.setdefault("payload", {})["data_base64"] = base64.b64encode(f.read_bytes()).decode()
                op["payload"].setdefault("filename", f.name)
            else:
                op["payload"] = json.loads(f.read_text())
        ops.append(op)
    return change, ops


def stage(site, req):
    if not REQ_RE.match(req):
        fail(f"invalid request id {req!r}")
    cfg = site_cfg(site)
    change, ops = _resolve_ops(site, req)
    set_request(site, req, status="applying", title=change["summary"][:120])
    ttl = load(STATE)["config"].get("preview_link_ttl_hours", 72)
    # A revised package for the same request replaces the earlier staged version (never stacks on it).
    s0, cur = call(cfg, "changeset", {"changeset": req})
    if s0 == 200 and cur.get("status") == "staged":
        call(cfg, "changeset/discard", {"changeset": req})
    elif s0 == 200 and cur.get("status") == "promoted":
        fail(f"{req} is already live — create a new request for further changes")
    status, res = call(cfg, "changeset/stage", {"changeset": req, "ops": ops, "ttl_hours": ttl})
    if status != 200:
        set_request(site, req, status="error", error=f"{res.get('code')}: {res.get('message')}")
        audit(site, f"{req} stage failed {res.get('code')}")
        fail(f"stage failed: HTTP {status} {res.get('code')} — {res.get('message')} (op {res.get('data', {}).get('op_index')})")
    mask(res["preview_url"])
    base = cfg["url"].rstrip("/")
    urls = [u if u.startswith("http") else base + "/" + u.lstrip("/") for u in change["qa"].get("urls") or ["/"]]
    save(TMP / "qa_input.json", {"site": site, "request": req, "preview_url": res["preview_url"], "urls": urls[:8],
                                 "viewports": load(STATE)["config"]["qa"]["viewports"]})
    # Time-limited capability link for QA/PM in the password-protected dashboard (private repo, expires).
    save(report_dir(site, req) / "preview.json", {"url": res["preview_url"], "expires": res["preview_expires"]})
    save(report_dir(site, req) / "meta.json", {"site": site, "request": req, "staged_at": now(),
                                               "results": res["results"], "preview_expires": res["preview_expires"]})
    audit(site, f"{req} staged ops={len(ops)}")
    summary(f"### Staged {req} on {cfg['name']}\nPreview (private, expires {res['preview_expires']}): {res['preview_url']}")


def finalize(site, req):
    cfg = site_cfg(site)
    qa_cfg = load(STATE)["config"]["qa"]
    rdir = report_dir(site, req)
    meta = load(rdir / "meta.json", {})
    qa = load(rdir / "qa.json", {})
    change = load(ROOT / "sites" / site / "changes" / req / "change.json")
    problems, warnings = [], []
    for pg in qa.get("pages", []):
        for v in pg["viewports"]:
            if v["after"].get("overflow"):
                (warnings if v["before"].get("overflow") else problems).append(
                    f"Horizontal overflow at {v['width']}px on {pg['path']}" +
                    (" (already on live site)" if v["before"].get("overflow") else ""))
            new_err = set(v["after"].get("console_errors", [])) - set(v["before"].get("console_errors", []))
            if new_err:
                problems.append(f"New console errors at {v['width']}px on {pg['path']}: {list(new_err)[:2]}")
            if v["after"].get("status", 200) >= 400:
                problems.append(f"HTTP {v['after']['status']} on {pg['path']}")
        if pg.get("broken_links"):
            problems.append(f"Broken links on {pg['path']}: {pg['broken_links'][:3]}")
    lh = qa.get("lighthouse") or {}
    for k, minimum in qa_cfg["lighthouse_min"].items():
        after = lh.get("after", {}).get(k)
        before = lh.get("before", {}).get(k)
        if after is None:
            continue
        if after < minimum and (before is None or after < before - qa_cfg["max_score_drop"] or before >= minimum):
            problems.append(f"Lighthouse {k} {after} (min {minimum}, before {before})")
    if not qa:
        problems.append("QA did not run")

    problems, warnings = list(dict.fromkeys(problems)), list(dict.fromkeys(warnings))
    passed = not problems
    meta.update(qa_passed=passed, problems=problems, warnings=warnings, finalized_at=now())
    save(rdir / "meta.json", meta)
    write_report(cfg, change, meta, qa)
    set_request(site, req, status="preview_ready" if passed else "qa_failed", report=f"reports/{site}/{req}/report.md",
                problems=len(problems))
    audit(site, f"{req} qa {'pass' if passed else 'FAIL'} problems={len(problems)}")
    summary(f"### QA {'✅ passed — waiting for approval' if passed else '❌ failed'} ({req})\n" +
            "".join(f"- {p}\n" for p in problems) + "".join(f"- ⚠️ {w}\n" for w in warnings))
    if not passed:
        sys.exit(2)


def write_report(cfg, change, meta, qa):
    req, site = meta["request"], meta["site"]
    lh = qa.get("lighthouse") or {}
    rows = []
    for pg in qa.get("pages", []):
        for v in pg["viewports"]:
            rows.append(f"| {pg['path']} | {v['width']} | ![]({v['before']['shot']}) | ![]({v['after']['shot']}) |")
    scores = " · ".join(f"{k} {lh.get('before', {}).get(k, '–')} → {lh.get('after', {}).get(k, '–')}"
                        for k in ("performance", "accessibility", "best_practices", "seo")) if lh else "not run"
    md = f"""# {cfg['name']} — {change['summary']}
Request **{req}** · {meta.get('finalized_at', '')[:10]} · Status **{'ready for approval' if meta['qa_passed'] else 'QA failed'}**

## Requested
{change.get('request_text', '(see requests/' + req + '/request.md)')}

## Changed
""" + "".join(f"- `{r.get('op')}` {('post ' + str(r['post_id'])) if r.get('post_id') else ''} {r.get('adapter', '')}\n" for r in meta.get("results", [])) + f"""
## Checks
{'All passed.' if meta['qa_passed'] else chr(10).join('- ❌ ' + p for p in meta['problems'])}
{chr(10).join('- ⚠️ Pre-existing: ' + w for w in meta.get('warnings', []))}

## Scores (Lighthouse, mobile)
{scores}

## Screens
| Page | Width | Before | After |
|---|---|---|---|
""" + "\n".join(rows) + f"""

## Rollback
Snapshot is taken automatically at go-live. Revert: run **Rollback** with site `{site}`, request `{req}`.
"""
    (report_dir(site, req) / "report.md").write_text(md)


def promote(site, req):
    cfg = site_cfg(site)
    meta = load(report_dir(site, req) / "meta.json", {})
    if not meta.get("qa_passed") and os.environ.get("AP_FORCE") != "1":
        fail("QA has not passed for this request — refusing to go live")
    status, res = call(cfg, "changeset/promote", {"changeset": req})
    if status != 200:
        fail(f"promote failed: HTTP {status} {res.get('code')} — {res.get('message')}")
    meta.update(snapshot_id=res["snapshot_id"], promoted_at=now(), approved_by=os.environ.get("GITHUB_ACTOR", ""))
    save(report_dir(site, req) / "meta.json", meta)
    set_request(site, req, status="live", approved_by=meta["approved_by"])
    audit(site, f"{req} LIVE snapshot={res['snapshot_id']} by {meta['approved_by']}")
    summary(f"### 🚀 {req} is live on {cfg['name']} (snapshot {res['snapshot_id']})")


def rollback(site, req):
    cfg = site_cfg(site)
    meta = load(report_dir(site, req) / "meta.json", {})
    if not meta.get("snapshot_id"):
        fail("No snapshot recorded for this request (was it promoted?)")
    status, res = call(cfg, "snapshot/restore", {"snapshot_id": meta["snapshot_id"]})
    if status != 200:
        fail(f"rollback failed: HTTP {status} {res.get('code')} — {res.get('message')}")
    meta.update(rolled_back_at=now(), rolled_back_by=os.environ.get("GITHUB_ACTOR", ""))
    save(report_dir(site, req) / "meta.json", meta)
    set_request(site, req, status="rolled_back")
    audit(site, f"{req} ROLLED BACK by {meta['rolled_back_by']}")
    summary(f"### ↩️ {req} rolled back on {cfg['name']}")


def discard(site, req):
    cfg = site_cfg(site)
    status, res = call(cfg, "changeset/discard", {"changeset": req})
    if status != 200:
        fail(f"discard failed: HTTP {status} {res.get('message')}")
    set_request(site, req, status="rejected")
    audit(site, f"{req} discarded")
    summary(f"### {req} discarded")


def health():
    st = load(STATE)
    bad = []
    for s in st["sites"]:
        if s.get("status") != "active":
            continue
        cfg = load(ROOT / "sites" / s["id"] / "site.json")
        try:
            status, h = ap_client.call(cfg["url"], "health", {}, timeout=30,
                                       pretty_permalinks=cfg.get("pretty_permalinks", True))
        except Exception as e:  # network errors
            status, h = 0, {"message": str(e)[:120]}
        ok = status == 200
        s.update(last_health=now(), health="ok" if ok else f"down ({status})",
                 paused_on_site=h.get("paused") if ok else None, bridge_version=h.get("plugin") if ok else None)
        if not ok:
            bad.append(f"{s['id']}: HTTP {status} {h.get('message', '')}")
    save(STATE, st)
    summary("### Health\n" + ("All sites OK." if not bad else "\n".join("- ❌ " + b for b in bad)))
    if bad:
        sys.exit(3)


if __name__ == "__main__":
    cmds = {"onboard": onboard, "stage": stage, "finalize": finalize, "promote": promote,
            "rollback": rollback, "discard": discard, "health": health, "notice": notice}
    if len(sys.argv) < 2 or sys.argv[1] not in cmds:
        print(__doc__)
        sys.exit(64)
    cmds[sys.argv[1]](*sys.argv[2:])
