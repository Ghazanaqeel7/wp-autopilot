#!/usr/bin/env python3
"""Free-LLM router: offload low-stakes drafting to OpenRouter's free models so it
doesn't cost Claude's own tokens/usage.

Use this for cheap, reviewable drafting only: SEO meta text, alt text, FAQ copy,
paraphrasing research notes, first-pass content drafts. Claude reads and edits the
result; it never ships unreviewed. Never use it for: change.json / code decisions,
anything touching the Hard rules in CLAUDE.md, or anything requiring verified facts
(prices, stats, client names, awards) — those still come from the client per
wp-content-sourcing.

Setup (one time):
  1. Create a free account at https://openrouter.ai and an API key (no card needed).
  2. Set OPENROUTER_API_KEY as a GitHub Actions secret AND as a local env var for
     whatever runs this loop (Claude Code shell, n8n, etc).

CLI:
  python tools/llm_router.py ask "Write 3 SEO meta description options for ..."
  python tools/llm_router.py ask --system "You are a concise copywriter." "..."
  python tools/llm_router.py ask --file prompt.txt
  echo "prompt text" | python tools/llm_router.py ask -

Prints ONLY the model's reply to stdout (nothing else), so the caller spends as few
tokens as possible reading it back. Exits non-zero with a one-line error on failure —
callers should fall back to doing the drafting themselves rather than retrying forever.

Model selection is self-updating — no one needs to hand-maintain a model id list that
rotates weekly. On every run it asks OpenRouter's public /models endpoint (no key
needed, no shell/curl involved) for whichever models are free *right now* and tries
them in order; only if that lookup itself fails does it fall back to a small hardcoded
list, which may be stale by the time you read this.
"""
import json
import os
import sys
import urllib.request
import urllib.error

MODELS_URL = "https://openrouter.ai/api/v1/models"
API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Last-resort fallback only, used when the live /models lookup itself fails (e.g. no
# network). May be stale — the live lookup above is the real source of truth.
STATIC_FALLBACK = [
    "openrouter/free",
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemma-2-9b-it:free",
    "mistralai/mistral-7b-instruct:free",
]

TIMEOUT_SECS = 60
MAX_MODELS_TRIED = 6


def _live_free_models():
    """Ask OpenRouter which models are free right now. Pure stdlib HTTP GET, no
    curl/shell involved (that's what broke on Windows) — returns [] on any failure
    so the caller falls back to STATIC_FALLBACK."""
    try:
        req = urllib.request.Request(MODELS_URL, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        free = [
            m["id"]
            for m in data.get("data", [])
            if m.get("pricing", {}).get("prompt") == "0"
            and m.get("pricing", {}).get("completion") == "0"
        ]
        return free[:MAX_MODELS_TRIED]
    except Exception:
        return []


def model_chain():
    return _live_free_models() or STATIC_FALLBACK


def _call(model, system, prompt, max_tokens, key):
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    body = json.dumps(
        {"model": model, "messages": messages, "max_tokens": max_tokens}
    ).encode()

    req = urllib.request.Request(
        API_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # Required by OpenRouter for free-tier rate limiting; not sent anywhere else.
            "HTTP-Referer": "https://github.com/Ghazanaqeel7/wp-autopilot",
            "X-Title": "wp-autopilot",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECS) as resp:
        data = json.loads(resp.read().decode())
    return data["choices"][0]["message"]["content"].strip()


def ask(prompt, system=None, max_tokens=800):
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        sys.exit("llm_router: OPENROUTER_API_KEY is not set")

    last_err = None
    for model in model_chain():
        try:
            return _call(model, system, prompt, max_tokens, key)
        except (urllib.error.URLError, urllib.error.HTTPError, KeyError, IndexError) as e:
            last_err = e
            continue
    sys.exit(f"llm_router: all free models failed, last error: {last_err}")


def main():
    args = sys.argv[1:]
    if not args or args[0] != "ask":
        sys.exit(__doc__)
    args = args[1:]

    system = None
    if args and args[0] == "--system":
        system = args[1]
        args = args[2:]

    if args and args[0] == "--file":
        with open(args[1], "r", encoding="utf-8") as f:
            prompt = f.read()
    elif args and args[0] == "-":
        prompt = sys.stdin.read()
    elif args:
        prompt = args[0]
    else:
        sys.exit("llm_router: no prompt given")

    print(ask(prompt, system=system))


if __name__ == "__main__":
    main()
