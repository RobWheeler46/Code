# Search and AI answer visibility (SEO and GEO): findings and plan

Status: items 1 to 5 and 11 of section 2 are built (robots.txt and sitemap, canonical addresses, per page titles and descriptions, structured data, the footer link to the Group site, and llms.txt). Items 6 to 10 are not started. Written 17 October 2026 from a check of the live site (https://cards.7thswindon.org.uk) and the code. Section 1 describes the site before items 1 to 5.

SEO here means being found in search engines. GEO means generative engine optimisation: being understood, trusted and quoted by AI answer tools (for example when someone asks an assistant for a free Scout themed eCard). Both depend on the same things: clear pages, honest facts, and clean technical signals. Local (Swindon) signals help both.

## 1. What the live site does today

**Good**
- The home page, Help, Privacy and Terms are indexable. Everything private (card links, accounts, drafts, admin, previews, sign in) is sent with `noindex, nofollow, noarchive` and never cached.
- Every card picture is a real image with a long, specific description (`alt` text), served as WebP with lazy loading.
- Pages are fast (first byte about 0.17 s, home page 16 KB of HTML), have one heading 1, a language of en-GB, a skip link and sensible headings.
- Social sharing tags exist (Open Graph and Twitter card) with a proper 1200 by 630 share image.

**Missing or weak**
- **No `robots.txt` and no `sitemap.xml`.** Both return the "page not found" page.
- **No canonical addresses.** The home page can be reached as `/`, `/?occasion=christmas` and with `?ref=...` labels, so search engines see near-copies.
- **The same description and the same Open Graph title on every page.** Help, Privacy and Terms all describe themselves as "Send a card, Scout style".
- **Titles are generic.** The home page title is "Choose a card | 7th Swindon Scouts eCards". It does not say what the service is.
- **No structured data at all.** Nothing tells a search or AI tool who runs the site, what the cards are, or that the Help page is a set of questions and answers.
- **The card previews are hidden from search.** `/card-preview?card=...` is `noindex`, though each is a good page for image search and for sharing.
- **The occasions (Christmas, Birthday, Thank you) are not pages.** They are a filter on the home page, so there is nothing to find for "Scout birthday card".
- **Nothing links the eCards site to the Group's own site**, apart from the line added to emails. A link from the main site, and a link back, is the strongest local signal available.
- **Public pages are sent with `Cache-Control: no-store`** (because of the session cookie), and HTML, CSS and JavaScript are not compressed.
- **No `favicon.ico`** (an SVG icon is offered, which most browsers use).
- **Nothing says where the Group is** beyond the name. There is no About text, charity number or location.

## 2. Recommended changes, in order

| # | Change | Size | Notes |
|---|---|---|---|
| 1 | `robots.txt` (allow public pages, pictures and the share image; disallow card links, accounts, drafts, admin, hooks) and a `sitemap.xml` listing the public pages | Small | A static file and a small generated page. Add the sitemap address to robots.txt |
| 2 | One canonical address on every public page, ignoring `?ref=` and filter parameters | Small | Stops duplicate copies of the home page |
| 3 | A real title, description and Open Graph title and image for each page | Small | For example "Free Scout eCards from 7th Swindon Scouts" for the home page, and one per card and occasion |
| 4 | Structured data (JSON-LD): the organisation, the website, and the Help page as questions and answers | Small | JSON-LD is data, not a script, so the strict content security policy is unaffected |
| 5 | A footer line "A service of 7th Swindon Scouts" linking to the Group's own site, and a request that the Group site link to the eCards | Small | Needs the Group site address and someone with access to it |
| 6 | Public card pages (for example `/cards/<name>`) replacing the hidden preview: the large picture, title, wording, description, occasion and styles, with a "Personalise this card" button | Medium | Each becomes a findable page, a sharable link with its own preview image, and an entry for image search |
| 7 | Public occasion pages (for example `/cards/birthday`) with their own title, heading and short introduction, replacing the filter as the main way in | Medium | Targets searches like "Scout birthday eCard". The filter can stay on the home page |
| 8 | Caching for public pages, and compression for HTML, CSS and JavaScript | Small | One `.htaccess` change at the host plus a header change; needs testing on the real host |
| 9 | An About text and a few plain facts: who runs the service, that it is free, how private the cards are, who to contact, and the charity registration number if there is one | Small | Needs Trustee approval of the wording |
| 10 | Search Console and Bing Webmaster set up and the sitemap submitted | Small | Yours: needs a Group account. Verification is one extra tag or a DNS record. This gives real data without adding tracking to the site |
| 11 | An `llms.txt` summary file | Small | Optional. A cheap, plain summary for AI tools; its effect is unproven |

## 3. GEO: making the site easy for AI tools to use correctly

No one can promise to be quoted. What helps, in the order of importance:

1. **Say the facts plainly on public pages.** Who runs it (7th Swindon Scouts, in Swindon), what it is (free private eCards you email to friends and family), what it costs (nothing; donations optional), how private it is, and who to ask. The Help page already has good short answers. Add the same facts to an About text and mark the Help page up as questions and answers.
2. **Be the same everywhere.** Use the same name, logo, address and links on the eCards site, the Group's own site, its Facebook page, any Google Business Profile and any Scouts directory entry. AI tools lean on these matching entries to decide a source is real.
3. **Give each card and occasion a page with a good description.** Our picture descriptions are already detailed, which suits image and answer tools.
4. **Allow the public pages, not the private ones.** robots.txt should leave public pages open to search and reputable AI crawlers, and keep card links, accounts and admin closed. Recipient card links are never listed anywhere public, and carry `noindex` as well.
5. **Keep it fresh and honest.** Seasonal wording (Christmas from November) is already built. Show an "updated" date on the About and Help pages if wanted.
6. **Check by asking.** After changes, ask a few assistants for "free Scout eCards" and "7th Swindon Scouts" and see what they say. Repeat after a month.

## 4. Local signals (Swindon)

- Use "7th Swindon Scouts" and "Swindon" naturally in the home page title and description.
- Add the organisation's name, logo and links (but see below about an address) to the structured data.
- A Google Business Profile for the Group, if it does not already have one, is the main local listing. It is outside this application.
- **Decision for the Trustees:** whether to publish the Scout hut address. A youth group's meeting place may be public already, but it is their call. Nothing in this plan needs an address.

## 5. Guardrails (these do not change)

- Recipient card links, accounts, drafts, the address book and all admin screens stay `noindex`, uncached and out of the sitemap and robots allow list.
- No personal data, messages or addresses on any public page.
- The `?ref=` promotion labels are never part of a canonical address or the sitemap.
- Public card pages show only the design (the picture, title, wording and description), never anything a sender wrote.

## 6. Realistic expectations

This is a small, seasonal, niche service. Search will bring modest numbers: most cards will be sent from the Group's own links, emails and shares. The work above is mostly cheap and worth doing once, and the card and occasion pages (items 6 and 7) are where search and image results could realistically add visitors. Do not expect ranking for general phrases such as "Christmas ecards". Measure with Search Console only; there is no tracking on the site and none is planned.

## 7. What I need from you

- The address of the Group's own website and its social pages (for the structured data and the footer link).
- Whether the Group is a registered charity, and the number if so.
- A Trustee view on publishing a location, and approval of the About wording.
- Whether you want card and occasion pages to be public and indexable (items 6 and 7).
- Someone to add a link to the eCards site on the Group website, and to set up Search Console.
