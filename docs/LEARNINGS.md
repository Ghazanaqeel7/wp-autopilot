# Learnings

One line per lesson: date — site — what went wrong — rule that prevents it.
- Snippet loader must run after the preview overlay is installed (init:0), or previews never show snippets. Rule: AP_Functions::boot is hooked on init:1.
