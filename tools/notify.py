#!/usr/bin/env python3
"""Tell people what happened to a request — best effort, never fails a job, never includes secrets or preview links.

Preferred: DASHBOARD_URL (repo variable) → the dashboard sends it with the tokens saved on its Connections page.
Fallback, direct from the workflow (each only if its secret/variable is set):
  NOTIFY_WEBHOOK_URL   Slack incoming webhook, n8n, Discord, Teams … gets {"text", "event", "site", "request", "link"}
  EMAIL_WEBHOOK_URL    Power Automate / n8n flow that sends mail: {"to", "subject", "body"}
  SLACK_BOT_TOKEN      replies in the Slack thread the request came from
  TRELLO_KEY+TOKEN     comments on the Trello card the request came from
  CLICKUP_TOKEN        comments on the ClickUp task the request came from
  DASHBOARD_URL        public address of the dashboard, used for the link in the message
"""
import json, os, pathlib, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent

EVENTS = {
    "needs_info": ("❓", "needs your answers before it can be built"),
    "preview_ready": ("👀", "is ready to review — open it in the dashboard to approve or ask for changes"),
    "qa_failed": ("⚠️", "failed the automatic checks and was not published"),
    "live": ("🚀", "is live"),
    "rolled_back": ("↩️", "was rolled back"),
    "error": ("❌", "hit an error"),
}


def _post(url, data, headers=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "wp-autopilot", **(headers or {})})
    try:
        urllib.request.urlopen(req, timeout=10).read()
        return True
    except Exception as e:  # noqa: BLE001 — notifications must never break a run
        print(f"notify: {url.split('?')[0].split('/')[2]} failed: {type(e).__name__}")
        return False


def via_dashboard(entry, event):
    """The dashboard holds the connection tokens; a workflow proves itself with its own run token (no shared secret)."""
    base, tok, run = os.environ.get("DASHBOARD_URL", "").rstrip("/"), os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_RUN_ID")
    if not (base and tok and run):
        return False
    return _post(f"{base}/api/hooks/notify", {"request": entry["id"], "event": event, "run_id": run}, {"Authorization": f"Bearer {tok}"})


def notify(site_name, entry, event):
    if event not in EVENTS:
        return
    if via_dashboard(entry, event):
        return
    icon, phrase = EVENTS[event]
    rid = entry["id"]
    title = entry.get("title", "")
    base = os.environ.get("DASHBOARD_URL", "").rstrip("/")
    link = f"{base}/#/req/{rid}" if base else ""
    text = f"{icon} {site_name}: “{title}” ({rid}) {phrase}." + (f"\n{link}" if link else "")
    if event == "needs_info":
        q = ROOT / "requests" / rid / "questions.md"
        if q.exists():
            text += "\n\n" + q.read_text()[:900]

    if os.environ.get("NOTIFY_WEBHOOK_URL"):
        _post(os.environ["NOTIFY_WEBHOOK_URL"], {"text": text, "event": event, "site": entry.get("site"), "request": rid, "link": link})

    o = entry.get("origin") or {}
    src = o.get("source") or entry.get("source")
    if src == "slack" and os.environ.get("SLACK_BOT_TOKEN") and o.get("channel"):
        _post("https://slack.com/api/chat.postMessage", {"channel": o["channel"], "thread_ts": o.get("thread_ts"), "text": text},
              {"Authorization": "Bearer " + os.environ["SLACK_BOT_TOKEN"]})
    elif src == "trello" and os.environ.get("TRELLO_KEY") and os.environ.get("TRELLO_TOKEN") and o.get("card"):
        q = urllib.parse.urlencode({"text": text, "key": os.environ["TRELLO_KEY"], "token": os.environ["TRELLO_TOKEN"]})
        _post(f"https://api.trello.com/1/cards/{o['card']}/actions/comments?{q}", {})
    elif src == "clickup" and os.environ.get("CLICKUP_TOKEN") and o.get("task"):
        _post(f"https://api.clickup.com/api/v2/task/{o['task']}/comment", {"comment_text": text}, {"Authorization": os.environ["CLICKUP_TOKEN"]})
    elif src == "email" and os.environ.get("EMAIL_WEBHOOK_URL") and o.get("from"):
        _post(os.environ["EMAIL_WEBHOOK_URL"], {"to": o["from"], "subject": f"Re: {title} ({rid})", "body": text})
