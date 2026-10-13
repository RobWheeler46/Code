# Making the site work for any time of year

Review date: 13 October 2026. Nothing has been changed. This is what I found and what I would do, in order.

## Where the site is today

It is a Christmas service with some groundwork for more.

**Already in place (built in the library and campaign work):**
- Four occasions exist in the database: Christmas, Birthday, Thank you, Celebration.
- Card designs live in a library with versions, so a design can belong to any occasion and a sent card never changes.
- Campaigns can be prepared as drafts, each with its own donation mode (optional donations or greeting only) and Gift Aid setting.
- Sends already record which campaign they belong to.
- Scheduled sending now exists, so a birthday card can be sent on the day.
- The address `card.7thswindon.org.uk` is neutral, so it needs no change.

**What still assumes Christmas:**
1. **One live campaign, on purpose.** There is no "make live" button for other campaigns. The public occasion page (`/occasion/birthday`) answers "Not open yet" for everything except Christmas.
2. **One global sending window.** Opening and closing dates, the campaign name, the donation purpose, the fundraising target and the "show progress" switch are single site-wide settings. A Christmas window that closes in January would close birthday cards too.
3. **One gallery.** The home page shows the cards of the first campaign only.
4. **Words.** About 110 mentions of "Christmas" across the code. About 40 are card picture descriptions, which are correct as they are. The rest are brand and copy: the page title and header ("Christmas Cards"), the home page opening, the share preview image and its description, every email (subject, body, footer), account and invitation emails, alert subjects, the "Christmas Day / Christmas Eve" scheduling choices, the "email me next year when the Christmas service opens" tick box, Help questions, privacy and terms, and some admin text.
5. **Seasonal behaviour.** The card opening animation is a Christmas envelope. The "Skip" link and the status page are neutral.

## The choice that shapes everything

**Option A (recommended): always open, seasonal shop window.** The site is open all year. Each occasion has its own set of designs, and the home page leads with whatever is in season (Christmas from November, otherwise a mix) with a simple row of occasions to choose from. Windows and fundraising are per occasion.

**Option B: separate campaigns that each open and close.** Closer to what exists, but sending would be closed much of the year and people would find a "not open" page.

I would build A. It uses the groundwork that exists and matches the aim of sending cards at any time.

## What I would build, in three steps

**Step 1: neutral brand and wording (about one session).**
- One site name setting, for example "7th Swindon Scouts eCards", used in the header, page titles, footer, emails and share image. A card's own occasion word ("Christmas", "birthday") is used where the card is named.
- Reword all the emails, account messages, Help, the home page and admin screens so they read well for any occasion.
- Make the share preview image and the opening animation work for any occasion.
- Replace the "next year" reminder with an optional "tell me when new occasions open", or remove it.
- Update the privacy and terms wording to cover year-round use. A Trustee needs to approve it.

**Step 2: occasions on the public site (about one to two sessions).**
- Home page: a row of occasions above the gallery, so people can choose Christmas, Birthday, Thank you or Celebration. An occasion with no published designs is hidden.
- Seasonal lead: Christmas leads in a window you set (for example 1 November to 31 December). The rest of the year, the hero shows a general line.
- `/occasion/birthday` and the others work as real pages and can be shared.
- Scheduling choices follow the occasion (Christmas Eve and Day for Christmas; "pick a date" for the others).
- Reuse the existing design library: you add and publish designs for an occasion exactly as you do now.

**Step 3: per occasion windows and fundraising (about two sessions).**
- A "make live" step for a campaign, recording the Trustee approval reference, in the same style as the private feature switches that were removed.
- Opening and closing dates, donation purpose, target and progress become per campaign, so Christmas can close without affecting birthdays.
- The Overview and measures show each live campaign.
- Donations stay off until you switch them on, and can be on for one occasion and off for another.

## What I need from you or the Trustees

1. **Name.** Is "7th Swindon Scouts eCards" right, or do you want something else?
2. **Occasions.** Which ones, and in what order? The database already has Birthday, Thank you and Celebration. Others (Get well, Congratulations, Easter, Remembrance) can be added.
3. **Artwork.** This is the biggest dependency. Each occasion needs finished cards, with the greeting painted in as the Christmas ones have. Cards are portrait pictures about 1060 by 1484 pixels, with alternative text and a rights note, uploaded in the eCard Library. Without designs, an occasion stays hidden.
4. **Fundraising.** Are donations for every occasion, only at Christmas, or case by case? Gift Aid needs the charity details either way.
5. **Approval.** Who signs off a new occasion going live? I would record a Trustee reference each time.
6. **Volume and email.** Year-round sending with an ordinary mail account is slow and limited by the host. Postmark (or another sending service) would be more reliable, especially for scheduled bursts.

## Risks to keep in mind

- **Deliverability.** More senders across the year means the Group's mail domain matters more (SPF, DKIM and DMARC), and a spam complaint affects all occasions.
- **Admin load.** Reports, complaints and failed cards will arrive all year, not only in December. Alerts go to the people named in Application settings.
- **Privacy.** Scheduled cards keep recipients' addresses until sending. Cards stay viewable for 60 days after sending. Both should be stated in the privacy wording.
- **Tests.** Many tests use Christmas wording and the single-campaign assumption. They will need updating in steps 1 and 3. The role-by-route tests will catch most mistakes.
- **Live data.** Existing Christmas cards, links and the QR code keep working throughout. Nothing here changes a sent card.

## Suggested order

Start with step 1, because it makes the site read correctly now and does not need artwork. Do step 2 when you have designs for a second occasion. Do step 3 when the Trustees confirm how fundraising works outside Christmas.
