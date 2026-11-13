#!/usr/bin/env python3
"""E2E for snippets + plugin ops. Usage: AP_SIGNING_KEY=… python3 e2e_functions.py http://127.0.0.1:8099 "php /tmp/wp/setmode.php"
The second arg is a command that takes the mode (off|snippets|all) as its last argument."""
import os, subprocess, sys
import requests
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
import ap_client  # noqa: E402

SITE, SETMODE = sys.argv[1], sys.argv[2]
fails = 0


def check(name, cond, extra=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra and not cond else ""))
    fails += 0 if cond else 1


def api(route, body=None):
    return ap_client.call(SITE, route, body)


def mode(m):
    subprocess.run(f"{SETMODE} {m}", shell=True, check=True, capture_output=True)


def snip(slug, code, typ="php", scope="all", op="snippet.set"):
    return {"op": op, "target": {"slug": slug}, "payload": {"type": typ, "code": code, "scope": scope}}


FOOT = "add_action('wp_footer', function(){ echo '<!--ap-snip-ok-->'; });"

mode("off")
s, r = api("changeset/stage", {"changeset": "F0000001", "ops": [snip("foot-marker", FOOT)]})
check("mode off refuses snippets", s == 422 and r.get("code") == "ap_forbidden", r)

mode("snippets")
for name, code, typ in [
    ("php syntax error", "add_action('init', function( {", "php"),
    ("php exec denied", "exec('ls');", "php"),
    ("php eval denied", "eval('1;');", "php"),
    ("php backtick denied", "$x = `ls`;", "php"),
    ("php drop table denied", "global $wpdb; $wpdb->query('DROP TABLE x');", "php"),
    ("php include denied", "include '/etc/passwd';", "php"),
    ("js script injection denied", "document.createElement('script').src='https://x.io/a.js'", "js"),
    ("css import denied", "@import url(https://x.io/a.css);", "css"),
]:
    s, r = api("changeset/stage", {"changeset": "F0000002", "ops": [snip("bad-snippet", code, typ)]})
    check(name, s == 422 and r.get("code") == "ap_lint", r)
s, r = api("changeset/stage", {"changeset": "F0000002", "ops": [snip("Bad Slug!", FOOT)]})
check("bad slug refused", s == 422, r)

# plugins need mode=all
s, r = api("changeset/stage", {"changeset": "F0000003", "ops": [{"op": "plugin.install", "target": {}, "payload": {"slug": "classic-editor"}}]})
check("plugin op refused in snippets mode", s == 422 and r.get("code") == "ap_forbidden", r)

# good flow: php + js + css
ops = [snip("foot-marker", FOOT),
       snip("js-marker", "console.log('ap-js-ok');", "js"),
       snip("css-marker", ".ap-css-ok{color:#123456}", "css")]
s, st = api("changeset/stage", {"changeset": "F0000004", "ops": ops})
check("stage snippets ok", s == 200 and len(st.get("results", [])) == 3, st)
live = requests.get(f"{SITE}/").text
check("live untouched while staged", "ap-snip-ok" not in live and "ap-js-ok" not in live)
sess = requests.Session()
sess.get(st["preview_url"], allow_redirects=False)
pv = sess.get(f"{SITE}/").text
check("preview runs php snippet", "<!--ap-snip-ok-->" in pv)
check("preview prints js + css", "ap-js-ok" in pv and ".ap-css-ok{color:#123456}" in pv)
s, pr = api("changeset/promote", {"changeset": "F0000004"})
check("promote ok", s == 200 and pr.get("snapshot_id"), pr)
live = requests.get(f"{SITE}/").text
check("live runs snippets after promote", "<!--ap-snip-ok-->" in live and "ap-js-ok" in live and ".ap-css-ok" in live)
s, rb = api("snapshot/restore", {"snapshot_id": pr["snapshot_id"]})
live = requests.get(f"{SITE}/").text
check("rollback removes snippets", s == 200 and "ap-snip-ok" not in live and "ap-js-ok" not in live, rb)

# crash safety: lint passes, runtime failure. Case 1 = catchable Error, case 2 = true fatal (class redeclare)
for n, (slug, code, preview_expect) in enumerate([("crashy", "ap_this_function_does_not_exist();", 200), ("fatal-one", "class WP_Query {}", 500)]):
    cid = f"F000001{n}"
    s, st = api("changeset/stage", {"changeset": cid, "ops": [snip(slug, code)]})
    check(f"stage {slug} ok (lint cannot see it)", s == 200, st)
    sess2 = requests.Session()
    sess2.get(st["preview_url"], allow_redirects=False)
    check(f"{slug}: preview status {preview_expect}", sess2.get(f"{SITE}/").status_code == preview_expect)
    check(f"{slug}: live fine during crash preview", requests.get(f"{SITE}/").status_code == 200)
    s, pr = api("changeset/promote", {"changeset": cid})
    check(f"{slug}: promote ok", s == 200, pr)
    requests.get(f"{SITE}/")  # a true fatal happens here once
    check(f"{slug}: site recovers (snippet auto-disabled)", requests.get(f"{SITE}/").status_code == 200)
    s, au = api("audit", {"limit": 30})
    check(f"{slug}: audit has snippet_disabled", any(a["action"] == "snippet_disabled" and slug in a["object"] for a in au), au)
    api("snapshot/restore", {"snapshot_id": pr["snapshot_id"]})

# plugins
mode("all")
s, r = api("changeset/stage", {"changeset": "F0000006", "ops": [{"op": "plugin.deactivate", "target": {}, "payload": {"slug": "wordfence"}}]})
check("protected plugin deactivate refused", s == 422 and r.get("code") == "ap_forbidden", r)
s, r = api("changeset/stage", {"changeset": "F0000006", "ops": [{"op": "plugin.install", "target": {}, "payload": {"slug": "../evil"}}]})
check("bad plugin slug refused", s == 422, r)
s, r = api("changeset/stage", {"changeset": "F0000007", "ops": [{"op": "plugin.install", "target": {}, "payload": {"slug": "classic-editor", "activate": True}}]})
print("INFO plugin.install stage ->", s, str(r)[:200])
mode("off")
print(f"\n{'ALL PASSED' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
