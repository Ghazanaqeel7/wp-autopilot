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
Anything Claude would otherwise draft from a blank page, as a **first pass only**:
- SEO meta description / title options
- Image alt text drafts
- FAQ answer drafts
- Paraphrasing/condensing research notes already gathered
- A first-pass PHP/JS/CSS snippet or plugin-config for `wp-functionality` (describe the
  feature, the site's `css_prefix`, and the constraints from that skill's "Writing a PHP
  snippet" section in the prompt)

Claude always reads the result line by line and fixes/rewrites it before it goes in a
change package — it is a draft, never a shippable output, code included. Claude is still
the engineer of record: a bug or a rule violation (missing escaping/sanitizing, wrong
prefix, an invented fact, a forbidden op) that ships is Claude's mistake, not the free
model's, because Claude signed off on it. Facts that must be real (prices, stats, client
names, awards, testimonials) still come only from the client per `wp-content-sourcing` —
never invented by the free model either.

## What it's NOT for
- Deciding the mechanism (snippet vs. plugin, which plugin, risk level) — that's Claude's
  call per `wp-functionality`, informed by a draft at most.
- Anything going into `change.json` without Claude's own line-by-line review first.
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
