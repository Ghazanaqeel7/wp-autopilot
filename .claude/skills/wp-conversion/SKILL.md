---
name: wp-conversion
description: Conversion method for pages and sections on an Autopilot site. Use when building landing/service/home pages, forms, CTAs, pricing or contact flows.
---

# Conversion standard

- Decide the single action per page (call, WhatsApp, quote form, booking) from the client's brief; everything on the page supports it. Secondary actions are visually quieter.
- Above the fold: who it is for, the outcome, proof, and the primary CTA — readable on a 375px phone without scrolling past it. Sticky mobile CTA/WhatsApp when calls and chats matter (GCC clients: WhatsApp first).
- Proof only from real material (`wp-content-sourcing`): real testimonials, logos, numbers, certifications. No real proof → design the section without it, never fake it.
- Sections in order: problem/need → offer → how it works (3–5 steps) → proof → pricing or "what it costs" framing → objections/FAQ → final CTA. Vary layouts (see `wp-premium-design`).
- Forms: only the fields needed (name, phone/email, one qualifier), visible labels, inline errors, nonce + spam protection, clear success state, notification to the client's email; never block on a CAPTCHA that hurts mobile. Test submit on the preview.
- CTA copy states the result ("Get my free audit"), not "Submit". Button ≥ 44px, strong contrast, same colour across the page.
- Speed is conversion: follow the performance rules in CLAUDE.md; no popups on first paint, no autoplay audio.
- Add tracking only if the client has it (GA4/Pixel IDs provided): events for form submit, call/WhatsApp click. Report what to watch after go-live.
