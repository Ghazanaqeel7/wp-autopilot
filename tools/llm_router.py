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

Model selection: uses OpenRouter's "openrouter/free" meta-router (auto-picks whichever
free model is healthy right now) as the primary, then falls back through a short list
of commonly-free model ids if that errors. The free model roster on OpenRouter rotates
weekly — do not hardcode a single model id as the only option.
"""
import json
import os
import sys
import urllib.request
import urllib.error

API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Tried in order. "openrouter/free" is OpenRouter's own router across whatever free
# models are healthy; the rest are plain fallbacks in case that meta-router itself is
# unavailable. Free IDs rotate — if all of these start failing, check
# https://openrouter.ai/collections/free-models and update this list.
MODEL_CHAIN = [
    "openrouter/free",
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemma-2-9b-it:free",
    "mistralai/mistral-7b-instruct:free",
]

TIMEOUT_SECS = 60


def _call(model, system, prompt, max_tokens):
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        sys.exit("llm_router: OPENROUTER_API_KEY is not set")

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    body = json.dumps(
        {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            # Let OpenRouter itself fail over across free providers behind this one
            # model slug when it's the meta-router; harmless for a plain model id.
            "models": MODEL_CHAIN,
        }
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
    last_err = None
    for model in MODEL_CHAIN:
        try:
            return _call(model, system, prompt, max_tokens)
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
