---
name: wp-qa-report
description: Format and checks for the Change Report produced after every applied change. Use when writing or reviewing reports/<site>/<request>/report.md.
---

# Change Report

File: `reports/<site>/<request-id>/report.md` (+ `screens/`, `lighthouse.json`). Data comes from
the QA workflow output; Claude writes only the summary lines.

## Template
```
# <Site> — <request title>          Request <id> · <date> · Status <status>
## Requested            (client's words, 1–3 lines)
## Changed              bullet per operation: page/section → what changed
## Not changed          anything asked but deferred, with reason
## Preview              id only (link is sent privately)
## Screens              table: viewport | before | after   (320, 375, 768, 1024, 1366, 1920)
## Scores               Performance / Accessibility / Best practices / SEO — before → after
## Checks               overflow · console errors · broken links · forms · security scan: pass/fail
## Rollback             snapshot id · how to revert
## Approval             approved by · time
```

## Pass gate (any fail → status qa_failed, do not request approval)
- Horizontal overflow at any viewport, console errors introduced, broken links introduced.
- Lighthouse below `state.json → config.qa.lighthouse_min` or drop > `max_score_drop`.
- Visual diff touches areas outside the change's targets.
