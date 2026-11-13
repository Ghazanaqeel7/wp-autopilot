# Channels — changes in, answers out

## Easiest: the dashboard's **Connections** page
Open **Connections**, follow the short steps on each card and paste the token. The dashboard keeps tokens encrypted (Cloudflare KV, never in the repo),
creates the Trello and ClickUp webhooks for you, lists your Slack channels / Trello boards / ClickUp lists so you just pick which website each belongs to,
and sends the answers back to where the request came from. Only one thing is left outside the dashboard: a **repo variable** `DASHBOARD_URL`
(GitHub → Settings → Secrets and variables → Actions → Variables) holding the dashboard address, so the workflows know where to report.

**Storage:** the first deploy after this update creates the KV store (binding `CONNECTIONS`) automatically. If the Connections page still says
"Storage is not connected", create it by hand: Cloudflare → Storage & databases → KV → Create (any name), then in `wrangler.toml` set `id = "<its id>"`
under `[[kv_namespaces]]`, commit, and let it deploy. Tokens are encrypted with a key derived from `SESSION_SECRET`; changing that secret means reconnecting.

**Slack extras (in the manifest):** public channels are joined by the bot when you route them (private ones need `/invite @WP Autopilot`);
anyone can message the bot directly (DM); and a **Send to Autopilot** item in every message's ⋯ menu (add it once: Slack app → Interactivity & Shortcuts → Create New Shortcut → On messages, name `Send to Autopilot`, Callback ID `send_to_autopilot`), which works for messages in private chats too
(the person who clicks it chooses to share that one message; the bot never reads private chats by itself). Updating an existing Slack app: App Manifest → paste the new manifest → Save (reinstall if asked).

Everything below is the manual alternative (secrets in Cloudflare/GitHub instead of the Connections page) and still works.

Everything lands in the dashboard **Inbox** first. Per website (Site → Settings → *Where changes come from*) you list the Slack
channels, Trello boards, ClickUp lists and email senders that belong to it, and choose whether messages become requests
automatically or wait for you. A `[site-id]` tag in a message or email subject routes it to that site anywhere.

Two ways in, use either or both:

| Way | Needs | Speed | Cost |
|---|---|---|---|
| **A. Webhooks** into the dashboard | a secret per channel (below) | instant | none |
| **B. Claude polls** your connected apps (skill `wp-inbox-poll`) | the app connected in Claude (Composio/connectors) | every few hours | Claude plan tokens |

## A. Webhooks (Cloudflare → Worker → Variables and Secrets)

Address: `https://<your-dashboard>/api/hooks/<channel>`. Each is verified (signature or token) and rejected otherwise.

### Slack
1. api.slack.com/apps → Create app → From scratch. *Basic Information → Signing Secret* → Cloudflare secret `SLACK_SIGNING_SECRET`.
2. *Event Subscriptions* → On → Request URL `…/api/hooks/slack` (must say Verified) → bot events `message.channels`, `message.groups`, `app_mention`.
3. *OAuth & Permissions* → bot scopes `channels:history`, `groups:history`, `chat:write` → Install → copy the Bot token → **GitHub** secret `SLACK_BOT_TOKEN` (lets answers go back into the thread).
4. Invite the app to the channel. Put the channel ID (channel details → bottom) into the site's Settings.

### Trello
1. trello.com/power-ups/admin → New → get the **API key** and **Secret**; generate a **Token**.
2. Cloudflare secret `TRELLO_SECRET` (the Secret), optional `TRELLO_KEY` + `TRELLO_TOKEN` (reads card descriptions).
   GitHub secrets `TRELLO_KEY`, `TRELLO_TOKEN` (comments the result on the card).
3. Create the webhook once (replace values):
   `curl -X POST "https://api.trello.com/1/webhooks/?key=KEY&token=TOKEN" -d callbackURL=https://<dashboard>/api/hooks/trello -d idModel=<boardId>`
   The board ID is in the board URL JSON (`…/b/<shortId>.json` → `id`).

### ClickUp
1. ClickUp → Settings → Apps → API token → Cloudflare secret `CLICKUP_TOKEN`, GitHub secret `CLICKUP_TOKEN`.
2. Create the webhook (team id from `GET /api/v2/team`):
   `curl -X POST https://api.clickup.com/api/v2/team/<teamId>/webhook -H "Authorization: <token>" -H "Content-Type: application/json" -d '{"endpoint":"https://<dashboard>/api/hooks/clickup","events":["taskCreated","taskCommentPosted"],"list_id":<listId>}'`
3. The response contains a `secret` → Cloudflare secret `CLICKUP_WEBHOOK_SECRET`. The list ID goes into the site's Settings.

### Outlook / any email
Outlook has no direct webhook, so use a tiny **Power Automate** flow (free with Microsoft 365) or n8n/Zapier:
*When a new email arrives (V3)* (filter by folder or sender) → *HTTP* POST to `https://<dashboard>/api/hooks/email`
with header `Authorization: Bearer <INBOX_TOKEN>` and JSON body
`{"from": <From>, "subject": <Subject>, "html": <Body>, "message_id": <Message Id>, "attachments": [{"name": <Name>, "content_base64": <Content>}]}`.
Choose any long random string as Cloudflare secret `INBOX_TOKEN`. The same address `…/api/hooks/generic` accepts `{"source": "other", …}` from anything else.

## Answers going back out (GitHub → Settings → Secrets and variables → Actions)

| Name | Kind | What it does |
|---|---|---|
| `DASHBOARD_URL` | variable | public dashboard address, used for links in messages |
| `NOTIFY_WEBHOOK_URL` | secret | a Slack *incoming webhook* (or n8n / Teams / Discord) that receives every status update |
| `SLACK_BOT_TOKEN` | secret | replies in the original Slack thread |
| `TRELLO_KEY`, `TRELLO_TOKEN` | secrets | comments on the original Trello card |
| `CLICKUP_TOKEN` | secret | comments on the original ClickUp task |
| `EMAIL_WEBHOOK_URL` | secret | a Power Automate / n8n flow that sends an email `{to, subject, body}` |

Messages say what happened (needs answers, ready to review, failed QA, live, rolled back). They never contain preview links, only the dashboard link.
Anything not configured is skipped silently.
