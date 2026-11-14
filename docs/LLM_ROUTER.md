# Free-LLM router (OpenRouter)

Why: Claude's own usage is the limited resource here (Ghazan has no separate Anthropic
API key/Max plan — Claude does this whole loop itself). `tools/llm_router.py` offloads
cheap, reviewable *drafting* to a free model on OpenRouter so Claude spends tokens on
judgment and QA, not on generating first-draft prose it then has to re-read anyway.

## Setup (one time)
1. Sign up free at https://openrouter.ai — no card required.
2. Dashboard → Keys → Create key.
3. Add it as:
   - A GitHub Actions secret `OPENROUTER_API_KEY` (Settings → Secrets and variables → Actions) —
     for anything the workflows run.
   - A local env var wherever the agent loop itself runs (Claude Code shell / n8n), e.g.
     `export OPENROUTER_API_KEY=sk-or-...` — this is what lets Claude call it mid-run.

## What it's for
Low-stakes, easily-reviewed text only:
- SEO meta description / title options
- Image alt text drafts
- FAQ answer drafts
- Paraphrasing/condensing research notes already gathered

Claude always reads the result and edits it before it goes in a change package — it is a
draft, not a shippable output. Facts that must be real (prices, stats, client names,
awards, testimonials) still come only from the client per `wp-content-sourcing` — never
invented by the free model either.

## What it's NOT for
- `change.json` contents, any code/plugin decisions, anything under CLAUDE.md's **Hard
  rules** or **Quality bar** — those need Claude's own judgment, not a free model's.
- QA / Lighthouse / pass-fail decisions.
- Anything where a wrong fact could ship to a live client site unreviewed.

## How it behaves
- Tries OpenRouter's `openrouter/free` meta-router first (auto-picks whichever free model
  is healthy), then a short list of commonly-free model ids as fallback — free model IDs on
  OpenRouter rotate weekly, so nothing here is hardcoded to one model staying free forever.
- Prints only the completion text to stdout — nothing else to read back.
- If `OPENROUTER_API_KEY` is missing or every fallback fails, it exits with a one-line
  error. Claude's instruction (CLAUDE.md → Token economy) is to just draft the copy itself
  in that case, not to retry in a loop.

## Usage
```
python tools/llm_router.py ask "Write 3 SEO meta description options (≤155 chars) for a
Dubai-based Hajj & Umrah travel agency's package listing page."
```

With a system prompt:
```
python tools/llm_router.py ask --system "You are a concise copywriter for a UAE travel brand." "..."
```

From a file or stdin (for longer prompts):
```
python tools/llm_router.py ask --file /tmp/prompt.txt
cat /tmp/prompt.txt | python tools/llm_router.py ask -
```
