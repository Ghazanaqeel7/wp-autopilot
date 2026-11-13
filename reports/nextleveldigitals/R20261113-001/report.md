# Next Level Digitals — Fix homepage typo: 'buketio' → 'but' in the portfolio intro line
Request **R20261113-001** · 2026-11-13 · Status **QA failed**

## Requested
Fix the typo on the homepage: "buketio" → "but".

## Changed
- `page.update_section` post 7593 elementor

## Checks
- ❌ HTTP 500 on /
- ❌ HTTP 500 on /
- ❌ HTTP 500 on /
- ❌ HTTP 500 on /
- ❌ HTTP 500 on /
- ❌ HTTP 500 on /


## Scores (Lighthouse, mobile)
not run

## Screens
| Page | Width | Before | After |
|---|---|---|---|
| / | 320 | ![](screens/home-320-before.jpg) | ![](screens/home-320-after.jpg) |
| / | 375 | ![](screens/home-375-before.jpg) | ![](screens/home-375-after.jpg) |
| / | 768 | ![](screens/home-768-before.jpg) | ![](screens/home-768-after.jpg) |
| / | 1024 | ![](screens/home-1024-before.jpg) | ![](screens/home-1024-after.jpg) |
| / | 1366 | ![](screens/home-1366-before.jpg) | ![](screens/home-1366-after.jpg) |
| / | 1920 | ![](screens/home-1920-before.jpg) | ![](screens/home-1920-after.jpg) |

## Rollback
Snapshot is taken automatically at go-live. Revert: run **Rollback** with site `nextleveldigitals`, request `R20261113-001`.
