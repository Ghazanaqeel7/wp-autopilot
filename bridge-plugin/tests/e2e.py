#!/usr/bin/env python3
"""End-to-end test for Autopilot Bridge against a running WordPress.

Usage: AP_SIGNING_KEY=… AP_KEY_ID=… python3 e2e.py http://127.0.0.1:8099 <gutenberg_page_id> <elementor_page_id>
Expects a fresh site where the plugin is connected with the same key.
"""
import base64, hashlib, json, os, sys, time, secrets
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
import ap_client  # noqa: E402

SITE, GP, EP = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
PNG = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63f8ffff3f0005fe02fea7d6a5d40000000049454e44ae426082")).decode()
fails = 0


def check(name, cond, extra=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra and not cond else ""))
    fails += 0 if cond else 1


def api(route, body=None):
    return ap_client.call(SITE, route, body)


def raw_post(route, body, headers):
    return requests.post(f"{SITE}/wp-json/autopilot/v1/{route}", data=json.dumps(body), headers=headers, timeout=30)


# --- auth
s, d = api("health")
check("health signed", s == 200 and d.get("site_id") == "test-site", d)
s = raw_post("health", {}, {"Content-Type": "application/json"}).status_code
check("unsigned rejected", s == 401, s)

body = b"{}"
ts, nonce = str(int(time.time())), secrets.token_urlsafe(24)
msg = "\n".join(["POST", "/autopilot/v1/health", ts, nonce, hashlib.sha256(body).hexdigest()]).encode()
sig = base64.b64encode(ap_client._key().sign(msg).signature).decode()
h = {"Content-Type": "application/json", "X-AP-Key-Id": ap_client.key_id(), "X-AP-Timestamp": ts, "X-AP-Nonce": nonce, "X-AP-Signature": sig}
check("first use ok", requests.post(f"{SITE}/wp-json/autopilot/v1/health", data=body, headers=h).status_code == 200)
check("replay rejected", requests.post(f"{SITE}/wp-json/autopilot/v1/health", data=body, headers=h).status_code == 401)
h2 = dict(h, **{"X-AP-Nonce": secrets.token_urlsafe(24)})
check("tampered (nonce not signed) rejected", requests.post(f"{SITE}/wp-json/autopilot/v1/health", data=body, headers=h2).status_code == 401)

# --- inventory
s, inv = api("inventory")
pages = {p["id"]: p for p in inv.get("pages", [])}
check("inventory builders", pages.get(GP, {}).get("builder") == "gutenberg" and pages.get(EP, {}).get("builder") == "elementor", pages)
s, ep = api("page", {"post_id": EP})
check("elementor outline", ep.get("elements", [{}])[0].get("c", [{}])[0].get("id") == "w111111", ep)
s, gp = api("page", {"post_id": GP})
check("gutenberg outline", gp.get("blocks", [{}])[0].get("type") == "core/heading", gp)

# --- stage
ops = [
    {"op": "media.upload", "target": {}, "payload": {"key": "hero", "filename": "hero.png", "data_base64": PNG, "alt": "Hero"}},
    {"op": "page.update_section", "target": {"post_id": EP, "element_id": "w111111"}, "expect_before_hash": pages[EP]["data_hash"],
     "payload": {"mode": "settings", "settings": {"title": "New Elementor title", "image_id": "{{media:hero:id}}"}}},
    {"op": "page.update_section", "target": {"post_id": EP, "element_id": "w111111"},
     "payload": {"mode": "insert_after", "element": {"elType": "widget", "widgetType": "text-editor", "settings": {"editor": "<p>Added</p>"}}}},
    {"op": "page.update_section", "target": {"post_id": GP, "block_path": [0]}, "expect_before_hash": pages[GP]["data_hash"],
     "payload": {"mode": "replace", "markup": "<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">New heading</h2>\n<!-- /wp:heading -->"}},
    {"op": "css.update", "target": {}, "payload": {"css": ".ap-test{color:#123456}</style><script>x</script>"}},
    {"op": "page.create", "target": {}, "payload": {"post_title": "Fresh Page", "post_name": "fresh-page", "post_content": "<p>Brand new</p>"}},
]
s, st = api("changeset/stage", {"changeset": "R0000001", "ops": ops})
check("stage ok", s == 200 and len(st.get("results", [])) == 6, st)
new_pid = next((r.get("post_id") for r in st.get("results", []) if r.get("op") == "page.create"), None)

s, bad = api("changeset/stage", {"changeset": "R0000002", "ops": [{"op": "page.update_section", "target": {"post_id": GP, "block_path": [0]},
                                                               "expect_before_hash": "0" * 64, "payload": {"mode": "remove"}}]})
check("stale expect_before_hash rejected", s == 422 and bad.get("code") == "ap_drift", bad)

# --- live untouched, preview shows changes
live = requests.get(f"{SITE}/gpage/").text
check("live unchanged before approval", "Old heading" in live and "ap-test" not in live)
check("new page hidden on live", requests.get(f"{SITE}/fresh-page/").status_code == 404)
sess = requests.Session()
r = sess.get(st["preview_url"], allow_redirects=False)
check("preview link sets cookie", r.status_code in (302, 303) and "ap_preview" in sess.cookies, r.status_code)
pv = sess.get(f"{SITE}/gpage/").text
check("preview shows new heading", "New heading" in pv and "Old heading" not in pv)
check("preview css sanitised", ".ap-test{color:#123456}" in pv and "<script>x</script>" not in pv)
check("preview noindex + banner", 'name="robots" content="noindex' in pv and "ap-preview-bar" in pv)
check("preview shows new page", "Brand new" in sess.get(f"{SITE}/fresh-page/").text)
check("bad token rejected", requests.get(f"{SITE}/?ap_preview=" + "a" * 48, allow_redirects=False).status_code == 403)
s, ep2 = api("page", {"post_id": EP})
check("elementor live data unchanged while staged", ep2["data_hash"] == pages[EP]["data_hash"])

# --- promote
s, pr = api("changeset/promote", {"changeset": "R0000001"})
check("promote ok", s == 200 and pr.get("snapshot_id"), pr)
live = requests.get(f"{SITE}/gpage/").text
check("live updated after promote", "New heading" in live and ".ap-test" in live)
check("new page live", requests.get(f"{SITE}/fresh-page/").status_code == 200)
s, ep3 = api("page", {"post_id": EP, "full": True})
w = ep3["elements"][0]["elements"]
check("elementor settings merged", w[0]["settings"]["title"] == "New Elementor title", w)
check("elementor media placeholder resolved", str(w[0]["settings"].get("image_id", "")).isdigit(), w[0]["settings"])
check("elementor insert_after", len(w) == 2 and w[1]["widgetType"] == "text-editor" and len(w[1]["id"]) == 7, w)
s, again = api("changeset/promote", {"changeset": "R0000001"})
check("double promote refused", s == 409)

# --- rollback
s, rb = api("snapshot/restore", {"snapshot_id": pr["snapshot_id"]})
check("restore ok", s == 200, rb)
live = requests.get(f"{SITE}/gpage/").text
check("live restored", "Old heading" in live and "ap-test" not in live)
s, ep4 = api("page", {"post_id": EP})
check("elementor restored byte-exact", ep4["data_hash"] == pages[EP]["data_hash"], ep4.get("data_hash"))
check("created page back to draft", requests.get(f"{SITE}/fresh-page/").status_code == 404)

# --- drift protection on promote
s, st2 = api("changeset/stage", {"changeset": "R0000003", "ops": [{"op": "page.update_content", "target": {"post_id": GP}, "payload": {"post_title": "Renamed"}}]})
check("stage R2", s == 200, st2)
import subprocess  # simulate a human editing the live page after staging
subprocess.run(os.environ["AP_TOUCH_CMD"], shell=True, check=True, capture_output=True)
s, pd = api("changeset/promote", {"changeset": "R0000003"})
check("promote blocked on drift", s == 409 and pd.get("code") == "ap_drift", pd)
s, ds = api("changeset/discard", {"changeset": "R0000003"})
check("discard ok", s == 200)

s, au = api("audit", {"limit": 20})
check("audit has entries", s == 200 and any(a["action"] == "promoted" for a in au))

print(f"\n{'ALL PASSED' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
