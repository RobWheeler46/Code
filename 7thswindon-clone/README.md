# 7th Swindon Scouts — static reproduction

A faithful, self-contained static copy of **www.7thswindon.org.uk** (the public
single-page site). The original is a compiled React/Vite + Tailwind app; this
reproduction keeps the exact rendered markup and the original compiled
stylesheet, and rewrites the interactive behaviour as small vanilla JS — no
build step, no dependencies.

## Run it

Any static server works, e.g.:

```bash
npx serve .
```

Or open `index.html` through a local web server (opening the bare file with
`file://` also works, since everything is relative).

## Files

- `index.html` — landing page, **shortened and re-sequenced to the UX Spec v2.4
  "shop window" narrative**: split hero ("Adventure starts here", with the
  autoplaying muted video) → inline finder → **Our sections** (four section
  cards) → activity showcase → **How joining works** five-step strip → Latest
  Adventures teaser → Volunteer band → reassurance row → Parent FAQs → **Support
  7th Swindon** teaser → footer. The full meeting timetable, the detailed
  Explorer partnership block, the AGM teaser and the full contact form have been
  **removed from the homepage** and now live on their own pages (section pages,
  `agm.html`, `contact.html`); homepage "get in touch" actions point to
  `contact.html`.
- `agm.html` — the **AGM Documents** page (minutes, trustees' reports,
  transparency notices). Heading/nav/footer are static; the year blocks are
  **rendered from `agm.json`** (GOV-002) newest-year-first, so publishing a new
  year's papers is a data edit — no markup change.
- `agm.js` — renders the AGM year blocks from `agm.json`. A record with no
  `minutes.file` shows a "will be published after the meeting" state, so next
  year's entry can go in ahead of the meeting. Reuses existing card classes.
- `agm.json` — the **AGM registry**: `meta` (contact email, transparency note)
  and a `years[]` list (`year`, `heldOn`, `minutes{label,file}`,
  `documents[]{label,file}`). Add a year here to add a block.
- `app.js` — FAQ accordion, mobile nav toggle, and the contact-form submit
  handler. Every block is guarded so the shared script is safe on any page
  (e.g. `agm.html` has a nav but no FAQ list or form).
- `contact.html` — dedicated **Contact** page (UX Spec v2.4): reason-for-contact
  selector first, compact form, and a routing / quick-contacts / 7thPortal-
  deflection aside (two columns on desktop, stacked on mobile). Uses the same
  form IDs as the homepage form, so `app.js` and `contact.php` drive it
  unchanged. The nav "Contact" now points here.
- `how-joining-works.html` — **How Joining Works** page (FRD Epic D, JOIN-001):
  a five-step journey (find section → join waiting list → we review availability
  → we get in touch → start), horizontal on desktop and vertical on mobile, plus
  a "why there is sometimes a waiting list" panel, a "could you help?" volunteer
  nudge (JOIN-005) and clear no-promise wording (JOIN-006). Linked under **Join**.
- `contact.php` — server-side handler for the **Contact Us** form. Validates the
  input, blocks spam (honeypot) and mail-header injection, and **routes by
  enquiry type** to role-based mailboxes via a `$ROUTES` map kept server-side
  (Joining/General → info@, Volunteering/Additional support/Governance → GSL@;
  edit the map to add dedicated mailboxes). Unknown/spoofed types fall back to
  the default inbox — a visitor can't set the recipient. See *Contact form* below.
- `find-your-section.html` — the **Find Your Section** journey (FRD Epic B),
  now **responsive per UX Spec v2.4**: on desktop (≥900px) it is a one-screen
  comparison — all filters (age/DOB, day, locality) visible on the left, live
  best-match cards on the right that update as you change any input; on mobile
  it is a guided **3-step wizard** (age/DOB → day → locality → result cards) with
  numbered progress and Back/Next. Reachable from the homepage finder, footers
  and directly.
- `find.js` — the finder logic. One component, two interaction models chosen by
  viewport (`matchMedia`), with a debounced resize fallback; the same inputs live
  in the DOM in both modes, so **selections are preserved across a resize or a
  back/forward navigation**. Age/DOB is ephemeral (never stored or sent to
  analytics). Loaded only on the finder page.
- `beavers.html` / `cubs.html` / `scouts.html` / `explorers.html` — the four
  **section pages** (FRD Epic C, v2.3 wireframe): breadcrumb, split hero, benefit
  icons, "What do they do?", live meeting options, progressive-disclosure
  accordions (uniform/costs/camps/inclusion/FAQs) and a Ready-to-Join hand-off.
  `<title>`/meta/canonical/`<h1>` are static per file (SEO); the body is rendered
  from the registry. Explorers is shown as a partnership (Medusa/Hydra units).
  Reachable from the homepage section cards and the finder's "Find out more".
- `section.js` — shared renderer for the section pages; reads the type from
  `data-section-type` and fills the page from `sections.json`.
- `volunteer.html` — the **Volunteer journey** (FRD Epic E), now **responsive per
  UX Spec v2.4**, mirroring the finder: on desktop (≥900px) the choice controls
  (how to help + availability) sit on the left and matching opportunities update
  **live** on the right; choosing one reveals the expression of interest in place.
  On mobile it stays the guided **4-step wizard** (how to help → availability →
  opportunities → interested). Leads with flexibility and impact; keeps
  DBS/references/training off the public site.
- `volunteer.js` — one component, two viewport-driven modes (live comparison /
  wizard) with a debounced resize fallback; selections persist across a resize.
  Opportunity matching + the lightweight EoI submit to `volunteer.php`.
- `volunteer.php` — server handler for the expression of interest. Same guards as
  `contact.php` (honeypot, header-injection block); routes to `glv@7thswindon.org.uk`.
- `inclusion.html` — **Inclusion & support** hub (FRD Epic F): non-diagnostic
  support areas, a confidential "Talk to us" route, and affordability info.
- `safeguarding.html` — **Safeguarding** hub (FRD Epic G): a prominent
  report-a-concern block (999 + official Scouts route + GSL), how young people are
  kept safe, and links to national guidance.
- `about.html` — **About** page (FRD Epic K, ABOUT-001): who we are, local
  context, charity/governance and onward links.
- `support.html` — **Support Us** page (FRD Epic K, SUP-001): ways to help
  (volunteer, donate, fundraise, give equipment, offer a skill/business, spread
  the word), a Gift Aid note and a "get in touch" call to action. No payment is
  collected on the site: donations route through the contact form (the new
  **"Supporting us"** enquiry type, handled server-side in `contact.php`) or a
  direct email, so any actual giving happens off-site. Reachable from the About
  menu and the footers.
- `adventures.html` — **Latest Adventures** (FRD Epic H, STORY-001–006): a
  filterable listing of stories with a client-rendered, **shareable** detail
  view (`adventures.html?story=<slug>` — deep-linkable, back/forward aware), so
  there are no per-story HTML files to maintain. The homepage carries a
  "Latest Adventures" teaser of the newest featured stories.
- `stories.js` — renders both the adventures page (listing + detail + section
  filter + history routing) and the homepage teaser, from `stories.json`.
  Enforces the publishing rules: a story shows only when `published`, a photo
  only when its `approved` (image-consent gate) — otherwise a section-coloured
  banner is used, so an unapproved image can never leak.
- `activities.html` content lives on the homepage — the **activity showcase**
  band ("What you'll get up to", FRD Epic A / HOME-005) is rendered by
  `activities.js` from `activities.json`: a grid of icon tiles showing what young
  people actually do at Scouts. No photos needed (each tile is an icon on a
  section-flavoured tint), so the band always renders; edit the registry to
  change the line-up.
- `activities.js` / `activities.json` — the showcase renderer and its registry
  (`activities[]`: `icon`, `title`, `blurb`, `accent`). Loaded on the homepage
  only, guarded so it's a no-op elsewhere.
- `stories.json` — the **stories registry**: `meta` plus a `stories[]` list
  (`slug`, `title`, `date`, `section`, `summary`, `body[]`, `hero{image,alt,
  approved,credit}`, `tags[]`, `published`, `featured`). Ships with clearly
  marked **sample** entries — replace them with real write-ups before launch.

### Navigation

All pages share a primary nav (NAV-001–005) aligned to the UX Spec v2.4
information architecture: **Home · Join · What We Do · Volunteer · About ·
Contact · Open 7thPortal**, with desktop dropdowns (CSS hover + `:focus-within`,
keyboard-accessible), an active-page marker (set by `app.js` from the URL), and a
grouped mobile menu. Submenus: **Join** (Find Your Section · How Joining Works ·
Inclusion and Support · Parent FAQs), **What We Do** (Beavers · Cubs · Scouts ·
Explorers · Activities and Adventures · Latest Adventures), **About** (About 7th
Swindon · Safeguarding · Support Us · Governance and AGM). The nav markup
is identical on every page; it's applied/updated with
`scratchpad/apply-nav.js` (and the same block lives in the section-page
generator), so a nav change is one edit re-applied, not hand-copied across files.
- `opportunities.json` — **volunteer opportunity registry** (§8.3): the single
  source for roles shown in the wizard. Edit to add/pause/close opportunities.
- `sections.json` — **public section registry**: the single source of truth for
  meeting patterns AND per-section content (`sectionTypes`), powering the finder,
  the homepage cards and the section pages. Edit here to change days/times/
  localities or section copy, then redeploy — no code change. Public fields only;
  never contains exact venues or member data. (Section pages regenerate from
  `scratchpad/build-sections.js` if the shared shell changes.)
- `sitemap.xml` / `robots.txt` — **SEO baseline** (SEO-001). The sitemap lists
  the public pages (absolute `https://www.7thswindon.org.uk/` URLs); every page
  carries a `<link rel="canonical">`. `robots.txt` allows crawling, hides the PHP
  form handlers, and points to the sitemap.
- **Social + structured data (SEO-004):** every page has **Open Graph + Twitter
  card** meta (per-page title/description/url, the logo as the share image) so
  links shared on social show a proper card, plus an **Organisation JSON-LD**
  block (`@type: NGO` — name, logo, description, charity number 306101, area,
  parent Scout Association, social profiles). Applied by
  `scratchpad/insert-seo.js`.
- `branding.html` — a **Brand and Assets** page (`noindex`, leader/volunteer
  resource) built from the supplied brand kit: the six approved 7th Swindon logos
  (circular + stacked, in navy/purple/black) with PNG downloads, the colour
  palette, a Nunito Sans specimen with the font ZIP download, tone-of-voice
  notes, and links to the official Scouts brand resources. Assets live in
  `assets/branding/` (`logos/*.png`, `Nunito_Sans.zip`). Reachable by URL; not in
  the primary nav (it's not a prospective-parent journey).
- `404.html` — a friendly, branded **not-found page** (`noindex`) with the shared
  nav/footer and links back to Home / Find Your Section / Contact. Served via the
  `ErrorDocument` rule in `.htaccess`.
- `.htaccess` — server config for the Apache/LiteSpeed host: the 404
  `ErrorDocument`, **security headers** (`X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, and a
  **Content-Security-Policy** scoped to same-origin + inline styles/scripts —
  the site loads no external JS), and long-cache rules for the `?v=`-busted
  assets. If anything breaks on the live host, comment out the CSP line first.
- `assets/style.css` — the original site's compiled Tailwind stylesheet.
- `assets/theme.css` — **active theme: 7thPortal branding**, matched live from
  **test.7thswindon.org.uk** (loaded after `style.css`). Purple `#6d28d9`, navy
  `#1b1533`, portal green `#0f9d78`, yellow `#f5b800`, warm `#f6f4f0` background,
  soft `#e3ddf0` borders — solid-purple top bar, yellow primary buttons (navy
  text), a navy→purple 135° hero, a navy footer, and portal-style **left-accent
  cards** (4px coloured left border per section, 14px radius, no top bar).
  Typeface **Nunito Sans**.
- **Contextual mobile sticky CTAs (UX Spec v2.4):** a `.sticky-cta` component
  (defined in both theme files) shows a page-specific bottom action bar on mobile
  only (`max-width: 899px`), hidden on desktop. Section pages → *Join waiting
  list*, `inclusion.html` → *Talk to us*, `safeguarding.html` → *Report a concern*
  (anchors to the on-page report block). `body:has(.sticky-cta)` reserves bottom
  space on mobile so the bar never covers content. Section-page bars are also in
  the generator (`scratchpad/build-sections.js`).
- `assets/theme-teal.css` — **alternate theme: Scout Teal.** Same approach around
  the Scout Association brand teal `#00A794` with yellow `#FFB700` accents.
- `assets/fonts/` — self-hosted **Nunito Sans** woff2 (latin + latin-ext, the
  same files the portal serves); both themes reference these via `@font-face`.
- `assets/7thswindon-logo.png`, `assets/Medusa.jpeg` — logos, downloaded from the site.
- `assets/videos/home-welcome.mp4` — the **hero video** (a ~6 MB square clip).
  It fills the hero's right-hand panel on `index.html`, beside/under the
  "Adventure starts here" headline, playing **muted, autoplaying and looping**
  (`muted autoplay loop playsinline`, no controls — muted is what lets browsers
  autoplay). A small inline script pauses it for viewers with
  `prefers-reduced-motion` (WCAG 2.2.2). Responsive (capped at 22rem, stacks
  under the headline on mobile). To swap the clip, replace this file (keep the
  name) and redeploy `assets/videos/`.

### Switching theme

Both themes are drop-in overlays selected by a single `<link>` in `index.html`:

- **7thPortal purple (current):** `<link rel="stylesheet" href="assets/theme.css" />`
- **Scout Teal:** point that link at `assets/theme-teal.css` instead.
- **Original site look:** remove the theme `<link>` entirely.

## Cache-busting (important on deploy)

`style.css`, `theme.css` and `app.js` are linked with a `?v=<date>` query
(e.g. `assets/theme.css?v=20260830`). CDNs/browsers cache these files
aggressively, so **whenever you change a CSS or JS file, bump the `?v=` value**
(same string in both `index.html` and `agm.html`) so visitors fetch the new
version instead of a stale cached copy. Without this, a code change can appear
"not deployed" until the cache expires.

## Contact form

The homepage `#contact` section is a real form that posts (via `fetch`, with a
no-JS fallback) to **`contact.php`**, which emails the enquiry. It replaces the
old `mailto:` links; the nav "Contact" and the "Get in Touch" / "Contact for
Details" buttons now scroll to this form. The footer still lists the email
addresses as a fallback, and role-specific `GSL@` volunteer links are unchanged.

**Requirements & configuration:**

- Needs **PHP** on the host (the live LiteSpeed server has it). It does *not*
  work over `file://` or a plain static file server — use a PHP server to test
  locally (`php -S localhost:8000 -t .`).
- Set the recipient/sender at the top of `contact.php`:
  - `$TO` — where enquiries are delivered (default `info@7thswindon.org.uk`).
  - `$FROM` — **must be a real mailbox on `7thswindon.org.uk`** for good
    deliverability (default `website@7thswindon.org.uk`).
- Spam protection is a hidden honeypot field; header injection is blocked by
  rejecting CR/LF in the name/email/subject.
- **Deliverability:** `contact.php` uses PHP `mail()`. If enquiries land in spam
  or don't arrive, switch to authenticated SMTP (e.g. PHPMailer with the group's
  mailbox credentials) — the validation and JSON responses stay the same.

## Notes / differences from the live site

- **Leaders area removed:** the original site has a password-gated "Leaders"
  section (nav link + `#leaders` section). It has been removed here, along with
  its nav links and JavaScript. (On the original it was client-side only — the
  password `scouts2026` was hard-coded in the public bundle — and held just
  links, no member data.)
- **Hero background photo:** the original references
  `…/wp-content/uploads/2025/03/two-scouts-by-fire-jpg-scaled.jpg`, which 404s on
  the live site too — so only the blue→purple gradient shows. The dead reference
  is removed here; drop a photo into `assets/` and set it on the hero overlay
  `<div>` (see the comment in `index.html`) to restore it.
- **AGM PDF links** (`agm-minutes-2026.pdf`, etc.) point to files that aren't
  included — add the PDFs alongside `index.html` to make the download buttons work.
- The nav **"About"** link has been removed (the original pointed at `#about`,
  which had no matching section — a leftover anchor from the original bundle).
- External links (waiting list / OSM, Scouts UK, social) point at the real
  destinations, unchanged.
