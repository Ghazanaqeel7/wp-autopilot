---
name: wp-inbox-poll
description: Pull new change requests from the owner's connected Slack, Outlook, Trello and ClickUp into inbox/ and process them. Use in the scheduled check or when the owner says "check karo".
---

# Inbox poll (no API key needed — uses the owner's connected apps)

Skip this skill when webhooks already deliver everything (check `inbox/` newest file < 1 h old and no connector available).

1. `git pull`. Read `state.json` (stop if `config.paused`), list `sites/*/site.json` → `channels` (slack IDs, trello boards, clickup lists, email senders, `auto`). Read `inbox/_cursor.json` (`{"slack": iso, "trello": iso, "clickup": iso, "email": iso}`; missing = last 24 h).
2. For each source that has a connected tool (Composio / Slack / ClickUp / Trello / Microsoft 365) read only what is new since its cursor, only from the mapped channels/boards/lists/senders. Search by time, never dump whole histories. Skip messages written by bots or by Autopilot itself.
3. For each new message write `inbox/<id>.json` exactly like the Worker does (id `I<YYYYMMDD>-<2 letters of source>-<8 hex of sha256(external id)>`, same fields as existing items; `origin` carries `channel`/`thread_ts`, `card`, `task`, `message_id`, `from`). If the file exists, skip (dedupe). Save attachments under `inbox/<id>/files/`. Never copy passwords, tokens or keys from a message; write `[redacted]`.
4. If the site's `channels.auto` is true: create the request (`requests/<id>/request.md` with `source:` and `## Origin`, entry in `state.json`, `origin` object, status `new`) and set the item `status: converted`, `request: <id>`. Otherwise leave it `new` for the owner.
5. Update `inbox/_cursor.json`. Then continue the normal loop in CLAUDE.md for `new` requests. After setting `needs_info`/`planned` by hand run `python tools/runner.py notice <site> <req> <event>` so the person who asked gets the answer where they asked.
6. One commit: `inbox: poll`. If nothing was new, make no commit and stop.
