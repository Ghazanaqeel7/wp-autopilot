# Questions — R20261114-001 (nextleveldigitals — Home page)

Before I build this, two things are material and I'm not going to guess on them:

## 1. Builder mismatch
The request says "Create home page on elementor", and `brief.md` also says the plan is
Elementor (free) + Hello Elementor theme. But the live site's `site.json` and the last
inventory both show:
- `builder: "gutenberg"`, theme **Twenty Twenty-Five** (not Hello Elementor)
- Elementor and Elementor Pro are installed but **inactive**

I won't switch the live builder/theme or hand-write Elementor data without confirming this,
since that's exactly the kind of guess Hard rules forbid. Please confirm one of:
- **(a)** Switch this site to Elementor: activate Elementor + Elementor Pro, switch the theme
  to Hello Elementor, update `site.json → builder` to `elementor` — then build the home page
  in Elementor, or
- **(b)** Keep Gutenberg (the site's current state) and build the home page as Gutenberg
  blocks instead.

## 2. Missing brand & real content
There's no `brand.json` for this site yet, and `brief.md` already flags these as
`[NEEDS CLIENT INPUT]`:
- Logo file(s), brand colours, fonts
- Phone, email, address/city, social links
- Real counters (projects done, clients served), years in business
- Testimonials (real names/quotes)
- Confirm pricing ($799 / $999 / Customised) and the portfolio names (Savvy, Lady Lake
  Windows, Free-2-Grow, SAS Landscaping, Paw Tenant, Floating Friends Boat Club) — ok to
  show these, or do they need permission / replacement?

Without at least logo + colours + one real contact detail, the home page would ship with
placeholder brand identity, which the Quality bar and Content rules don't allow going live.
If you want me to go ahead with researched/placeholder copy for everything else (service
descriptions, process steps, FAQs) and just mark it `[NEEDS CLIENT INPUT]` where a hard fact
is missing, I can do that for text — but logo/colours/builder choice I need from you directly,
upload them on the dashboard's brand/assets page (or send colours + logo here) and confirm (a)
or (b) above.
