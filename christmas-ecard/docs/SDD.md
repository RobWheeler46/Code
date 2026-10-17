# 7th Swindon Scouts eCards: Software Design Document

| | |
|---|---|
| Service | 7th Swindon Scouts eCards, live at https://cards.7thswindon.org.uk |
| Document | Software Design Document (SDD) with wireframes |
| Version | 1.3, 16 October 2026 |
| Describes | Application version 2026.10.15 (the footer of every page shows the exact build) |
| Audience | Trustees, volunteers who run the service, and whoever maintains the code |
| Status | Describes the service as built. Items not yet decided or built are listed in section 15 |

---

## 1. Purpose and scope

7th Swindon Scouts eCards lets a parent or supporter send a private, illustrated card by email to up to 20 people, for free. Donations to the Group are optional and are switched off until the Trustees are ready. The cards are Scout themed. Christmas is the first occasion, and the design is ready for others (birthday, thank you, celebration).

**In scope:** public pages, sender accounts, the card write and send journey, scheduled sending, the recipient's card page, opt out and reporting, the volunteer admin workspace, email delivery, optional donations and Gift Aid, operations and deployment.

**Out of scope:** a mobile app, member data from the Group's membership system, card printing, recurring or automatic cards, and any integration with the Group website beyond a link.

## 2. Users and roles

| Who | What they do | How they sign in |
|---|---|---|
| Visitor | Browses the cards, reads Help, Privacy and Terms | No sign in |
| Sender (registered user) | Writes cards, manages an address book, sees their cards | Email and password. Email must be confirmed before sending |
| Recipient | Opens a card from a private link, can stop emails or report a card | None. The link is the key |
| Administrator | Runs the service day to day: cards, delivery, reports, finance, settings | Email, password and a two step code (authenticator app) |
| Owner | An administrator who can also invite people, change who is an owner, set up email sending, see Gift Aid donor details, publish designs, restore earlier settings and export the change history | As administrator |

Two levels only. Older role names in the code (campaign, appadmin, finance, delivery, complaints, rolesadmin) are aliases: `rolesadmin` means owner, the others mean administrator. Existing users were converted once.

## 3. Design goals

1. **Safe for families.** Private unguessable links, no public gallery of sent cards, no indexing, short retention, simple removal.
2. **Easy for a volunteer to run.** One admin workspace, tasks first, plain wording, no command line or cron needed.
3. **Cheap and simple to host.** Plain PHP and SQLite on ordinary shared hosting (cPanel), no build step on the server.
4. **Honest about delivery.** Statuses say what is known ("Sent" is not "Delivered" is not "Viewed").
5. **Ready for more occasions** without a rewrite.

## 4. Architecture

### 4.1 Shape

A single PHP application behind one front controller. No framework, no external PHP packages. SQLite file database. Static assets served directly by the web server.

```
Browser ──HTTPS──> public_html/index.php ──> app/src/*.php ──> app/data/ecard.sqlite
                         │                         │            app/data/art, library, backups
                         │                         ├──> Email: Postmark API  or  the Group's SMTP account
                         │                         └──> Payments: Stripe Checkout (only while donations are on)
Outside timer (cron-job.org) ──> /hooks/tick?k=KEY  (runs the scheduled jobs)
Stripe / Postmark ──webhooks──> /hooks/stripe, /hooks/postmark
```

### 4.2 Folders on the server (cPanel layout)

| Folder | Contents | Public? |
|---|---|---|
| `public_html/` (the site's document root) | `index.php`, `assets/` (CSS, JS, fonts, card pictures, logo, favicon, share image), `.htaccess` | Yes |
| `app/src/` | All PHP code | No |
| `app/data/` | The SQLite database, the card library artwork, a mail log, backups, hash named public copies of artwork | No (denied by `.htaccess`) |
| `app/.env` | Settings that must not be in code: site address, email and payment keys | No |
| `app/VERSION` | The build stamp shown in the footer | No |

### 4.3 Code modules (`app/src`)

| File | Responsibility |
|---|---|
| `lib.php` | Settings, database connection and one time migrations, sessions, security headers, rate limits, sign in checks, roles, page layout, email sending switch |
| `app.php` | The front controller and route table, shared page helpers, the home page, Help, and the finance export |
| `send.php` | The card journey: write, preview, review, send, pay, and the sender's own list of cards |
| `recipient.php` | What a recipient sees: the envelope, the card, reporting it, stopping cards |
| `auth.php` | Registering, signing in, passwords, two step sign in, email preferences, deleting an account |
| `hooks.php` | Webhooks from Stripe and Postmark |
| `core.php` | Domain logic: recipients, the send queue, email text, payment confirmation, opt outs, sending state, scheduled delivery |
| `cards.php`, `library.php` | The card catalogue and the eCard Library tables (designs, versions) |
| `library_admin.php`, `uploads.php` | The eCard Library screens and the safe picture upload service |
| `styles.php` | Style tags and their admin list, the style filter data, and favourite designs |
| `occasions.php` | Donations switch, which occasion a card is for, the Christmas season, and the Occasions admin screen |
| `admin.php`, `admin2.php`, `admin3.php` | Overview, delivery, finance, reports, settings forms, health, change history, senders, measures, rehearsal |
| `workspace.php` | The admin shell and the single navigation list (menu, shortcuts, breadcrumbs) |
| `mailconfig.php`, `smtp.php` | Email delivery settings screen and the SMTP client |
| `invites.php`, `account.php` | Administrator invitations, first owner set up, account changes |
| `giftaid.php`, `legal.php`, `contacts.php`, `qr.php`, `ops.php`, `resilience.php`, `scheduler.php`, `cli.php` | Gift Aid, Privacy and Terms, address book, QR code, alerts, backup tooling, scheduled work, command line tools |

### 4.4 Request lifecycle

1. `index.php` first installs a crash handler (a plain apology for visitors, the reason written to `app/data/error.log`), then loads the code, starts the session (strict ids, secure and HttpOnly cookie) and sends security headers.
2. `dispatch()` matches the path to a handler. Every POST must carry a valid CSRF token, except the two webhooks.
3. The handler checks the person's role on the server, does its work with prepared SQL statements, and returns a page built by `page()` (public) or `admin_page()` (the workspace shell).
4. After the response is finished, `scheduler_after_request()` may run due background jobs (at most once a minute).

### 4.5 Scheduled work without cron

The same jobs that `cli.php` runs from cron also run in two other ways: after page visits, and when an outside timer opens a secret address every few minutes. An atomic claim on each job stops two callers doing the same work. Jobs: send queued cards (a fifth of the usual batch each minute on ordinary mail accounts, to stay inside hourly limits), alert emails, the daily summary, and the daily clean up.

### 4.6 Database changes

Additive and idempotent. They run once for each deployed build (the build stamp is remembered in the database); a development copy always runs them. Older role names are converted to the two levels in the same step.

## 5. Data design

### 5.1 Main tables

| Table | Holds | Key points |
|---|---|---|
| `users` | Senders and administrators | Unique email, password hash, `verified`, `is_admin`, `roles` (admin or owner), authenticator secret, `suspended`. Reset and verification tokens are stored as SHA-256 hashes |
| `sends` | One card sent to up to 20 people | Status: draft, awaiting_payment, queued. Chosen design, message, sender name, donation amount, `send_at` (scheduled time), promotion label |
| `recipients` | One row per person on a send | Name, email, private token (hashed once mailed), status (draft, queued, sending, sent, failed, bounced, cancelled), tries, times (sent, delivered, opened, viewed), personal message |
| `donations` | Confirmed payments | Unique Stripe session, fee, refunded amount |
| `giftaid` | Gift Aid declarations | Linked to a donation. Visible to owners only |
| `reports`, `optouts`, `bounces` | Recipient reports, people who asked to stop, hard bounces and complaints | Checked every time before sending |
| `contacts`, `groups`, `contact_groups` | A sender's private address book | Never shared between senders |
| `style_tags`, `design_style_tags`, `user_favourite_designs` | Style vocabulary, which cards carry which style, and each sender's favourite cards | Tags are shared; favourites are private and deleted with the account |
| `designs`, `design_versions`, `campaign_designs`, `occasions` | The eCard Library | A design has immutable versions. A sent card is pinned to the version it used. `designs.category` is the occasion. `campaign_designs` is an internal join that records order, state and which version is published (campaign screens no longer exist) |
| `settings` | Key and value | All admin configurable values, build stamp, last job times, timer key |
| `audit` | Append only change history | Who, what, when. Never holds message text, addresses or secrets |
| `admin_invites` | Pending administrator invitations | Link stored as a hash, one use, limited life |
| `alerts`, `stripe_events`, `attempts` | Alert state, payment events for reconciliation, rate limit counters | |

### 5.2 Relationships (simplified)

```
users 1───* sends 1───* recipients
users 1───* contacts *───* groups
sends 1───0..1 donations 1───0..1 giftaid
designs 1───* design_versions        sends *───1 design_versions (pinned when queued)
designs *───1 occasions (by category)
recipients *───0..1 reports
```

### 5.3 Retention

Cards stay viewable for 60 days after sending (setting). Greetings and recipient details are kept for 90 days (setting). A daily job removes expired material and keeps only finance records, the change history and opt out records. A sender can delete their account, which cancels unsent cards, deletes their contacts and switches off their card links.

## 6. Security design

| Area | Design |
|---|---|
| Passwords | Hashed with PHP `password_hash`. Minimum 10 characters. Sign in, reset and verification are rate limited by account and address |
| Administrator sign in | Password plus a time based code. Every admin page and action checks the second step |
| Authorisation | Checked on the server for every request by role, never only by hiding a link. A role by route test proves it |
| CSRF | A token on every form. Webhooks are authenticated by a Stripe signature (5 minute tolerance) or a shared key (Basic Auth, or the older `?k=`) |
| Private links | 48 hex characters, one per recipient, stored only as a SHA-256 hash after mailing. A card is "viewed" only when the recipient presses Open, never on page load, so mail scanners do not count |
| Tokens in the database | Password reset, email verification and invitation links are stored as hashes |
| Headers | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, a Content Security Policy with no inline styles or scripts from elsewhere, HSTS. Private pages are not cached and are marked noindex |
| Sessions | Strict ids, HttpOnly, SameSite Lax, secure on HTTPS, one day idle life |
| Uploads | Size and type checks, re-encoded with GD, stored outside the web root, served with `nosniff`, hash named public copies |
| Email | Header injection is stripped. Replies and bounces are handled. Hard bounced and opted out addresses are never mailed |
| Secrets | In `.env` or write only settings (the mail password and keys are never shown back) |
| Production default | A missing `APP_ENV` counts as production, so the site fails safe |
| Crashes | A crash, or an upload that left a file missing, shows a friendly "Back in a minute" page (503 with a retry time, tries again by itself every 30 seconds, no technical detail; PHP's own error display is switched off) and writes only the reason (no visitor data) to `app/data/error.log` |
| Style sheet and script addresses | They carry the build stamp, so a new deployment is never shown with old cached styles |
| Privacy | The change history stores ids and outcomes, never message text or addresses |

## 7. Key flows

### 7.1 Sending a card

```
Choose a card ─> Write message + recipients ─> Review ─> Send now / Schedule
                      (draft saved, may be done signed out)        │
Register / sign in / confirm email (once)  <───────────────────────┘
                                                         queued ─> sent ─> delivered ─> viewed
                                                                └─> failed / bounced (fix address and resend)
                                                         scheduled: held until the chosen time (1 hour to 90 days ahead)
```

After sending, the status page offers a "Tell a friend" block (WhatsApp, email and the plain link, labelled `?ref=sendshare` so Measures can count visits). While cards are still scheduled the sender can change the delivery time (same limits as when scheduling, or send at once); only cards that have not started sending move, and the change is recorded in the change history. When donations are on, the amount suggested on the review page grows with the number of cards (first, second or third amount for 1 to 3, 4 to 10 and 11 or more).

**Group website link in the email.** Every card email, in both its styled and plain text forms, mentions the Group website: "Find out more about 7th Swindon Scouts:" followed by the address, after the private link note and before the stop cards line. It is not a choice for the sender and does not appear on the card page. The address is a setting under Donations and sharing (starts as https://www.7thswindon.org.uk/); only an https address is accepted, and a blank setting leaves the line out.

**Guests.** A visitor can write a card without an account. Pressing Review saves the draft and goes to a Create your free account page that says the card is waiting (with Sign in for people who already have an account, and the way back kept in the address as `next`, accepted only if it is a review of a card). Registering returns straight to Review with the card now owned by the new account; sending still needs the email to be verified, and the link in the confirmation email returns to the saved card.

Recipient states shown to the sender: Draft, Waiting to send, Scheduled, Sent, Delivered, Viewed, Not delivered, No confirmation yet, Cancelled. (Inside the code and the change history the older names Queued, Failed and Delivery unconfirmed are still used.)

### 7.2 The queue

Each run picks recipients that are `queued` and due, claims each with one guarded update, then sends. Permanent failures are not retried. Temporary failures retry after 1, 5 and 30 minutes, then stop. "Sent, no answer" is never repeated automatically, to avoid duplicates. Pause stops all sending at once.

### 7.3 Donations (when switched on)

The review page offers "Send for free" or "Make an optional donation". A donation goes through Stripe Checkout. Cards are queued only after a verified payment. A payment that is unclear shows as pending and blocks a second charge. Gift Aid, if offered, adds a declaration form. Donations are off by default and every donation control disappears when off.

### 7.4 Occasions and the gallery

Each design has an occasion (chosen in the eCard Library). Occasions are managed on the Occasions screen: an administrator can add, rename and remove them, except Christmas, which is built in. The home page shows a drop down of occasions that have published cards (hidden when there is only one). Wording in emails and card pages follows the card's occasion ("Christmas card", "birthday card").

**Seasons.** Each occasion can have a season: two month and day values, set on the Occasions screen (Christmas starts as 1 November to 6 January; a season may cross the new year). When an occasion's season is on, the home page heading names it ("Send a Christmas card, Scout style", "Send an Easter card, Scout style"), its cards come first and the featured picture is one of them. If two seasons are on, the one higher in the Occasions list leads. Occasions with no season come next, and occasions whose season is not on come last. No card is ever hidden by a season. The occasion's name is used as typed in sentences ("a Birthday card", "an Easter card").

**Home page strips.** With two or more occasions on show the home page leads with picture tiles for each occasion (and All cards). Under them, when no filter is chosen, a Featured cards strip shows the cards the Group has featured, and a New this month strip (which an administrator can switch off in Application settings) shows cards added through the eCard Library in the last 30 days (newest first, up to four, none repeated from Featured; the original Christmas set never counts as new). Every card tile carries a Preview link to a full size look (`/card-preview`) before the sender chooses it, and a small line above the title with its occasion and styles.

**Styles and favourites.** Beside occasions, cards can carry style tags (Funny, Heartfelt, Adventure and Traditional to start; up to 12, managed at the foot of the Occasions screen, where a tag can be renamed, hidden or removed). Tags are ticked on a draft in the eCard Library editor, or on any card from Order, descriptions and styles (in the eCard Library). The home page then offers a Style drop down (only tags in use on cards on show), combined with the occasion drop down; the address holds the choices, a hidden or unknown tag is ignored, and an empty result says so with a way back. Signed in senders also see a heart on each card and an Only my favourites choice; favourites belong to the sender, are removed when the account is deleted, and a card that is turned off is never offered. Guests see no favourite controls. Greeting examples on the compose page carry a tone (Short and sweet, A bit cheeky, Warm and thoughtful) with tone buttons when scripts run. The card a recipient opens links to the gallery with the promotion label `recipient-card`.

### 7.5 The eCard Library

Draft, preview, publish (owner), hold back, restore, new version, roll back. Published versions never change. Sent cards keep the version they used. Publishing needs the "I have the right to use this" and "wording and year are right" checks and a screen reader description.

### 7.5a Bulk card send (administrators)

An administrator can send one card to many people, each with their own message, from a CSV file (Name, Email, Message; a heading line is optional). Steps: choose the card, the From name and an optional shared message (used for any line with none of its own), and upload the file (300 KB, up to 200 people). The file is read into a draft that belongs to the administrator and is marked `bulk`; lines with a bad address, a repeat, an over long or unsuitable message, or no message and no shared message are left out and listed by line number. A check page shows the card, the counts, the first ten people and what was left out, with the usual delivery choice (now, or a time from 1 hour to 90 days ahead). Only then does [Send] queue the cards, through the ordinary queue: opt outs are skipped at send time, retries and the scheduler apply, and the normal status page shows each person and allows cancelling cards that have not gone. Sending is free and uses the administrator's own account (it must be verified and have accepted the terms). A bulk draft has no ordinary write or review screen: those redirect to the bulk screen. The change history records counts only, never addresses or messages.

### 7.6 Administrator invitations

An owner invites by email with a level (administrator or owner). The person signs in or registers with that address, accepts, and then sets up two step sign in. The first owner is set up by putting `ADMIN_EMAIL` in `.env` and confirming that address.

## 8. Integrations

| Service | Use | Notes |
|---|---|---|
| Postmark | Card and system email with delivery, bounce and complaint events | Preferred. Webhook at `/hooks/postmark` |
| The Group's SMTP account | Email when Postmark is not set up | No delivery feedback. Batches limited per run. Settings are in Admin, secrets write only |
| Stripe Checkout | Optional donations | Webhook at `/hooks/stripe`. Only used while donations are on |
| cron-job.org (or similar) | Calls `/hooks/tick?k=KEY` every 5 minutes | Optional but recommended |

## 9. Configuration

**Environment (`app/.env`):** `APP_URL`, `APP_ENV`, `MAIL_FROM`, `SUPPORT_EMAIL`, `POSTMARK_TOKEN`, `POSTMARK_HOOK_KEY`, `STRIPE_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ACCOUNT`, `ADMIN_EMAIL`, `SMTP_*`, `BACKUP_*`, `SCHEDULER` (on or off).

**Settings screens (admin):**

| Screen | Settings |
|---|---|
| Donations and sharing | Take donations, suggested amounts, Gift Aid charity and switch, the Group website address mentioned in every card email (https only; blank leaves it out); shows the site link, QR code and promotion counts |
| Application settings (in sections: Limits for senders, Message rules, Reports and testing, Alerts, Home page) | Recipients per card, greeting and name limits, address book limits, test cards per hour, blocked words, small number threshold, rehearsal allow list, whether the New this month row shows on the home page, alert recipients and escalation, allow web addresses |
| Email and help wording | Subject, opening line and button of the card email (with `{sender}` and `{card}`), support email, extra Help questions |
| Privacy and retention | How long card links and details are kept |
| Email delivery | Provider, sender, Postmark token, SMTP details, test email |

Every settings change goes through a review screen, records old and new values, and an owner can restore an earlier set.

## 10. Accessibility and responsive design

Semantic headings and landmarks, a skip link, visible focus, labels on every field, an error summary, status messages announced politely, minimum 44 pixel targets, no content that depends on colour alone, and a reduced motion friendly card opening with a Skip animation control. Every card picture has a full description. Pages are designed from 320 pixels wide upward with no sideways scrolling. The admin menu is a disclosure on narrow screens. Not yet done: formal keyboard and screen reader testing and a usability trial with volunteers (section 15).

## 11. Deployment and operations

1. `bash scripts/build-dist.sh` produces `dist/christmas-ecard-deploy.zip` and stamps the build (date and commit, with `-modified` if there were uncommitted changes).
2. Upload and extract: `app/` above the web root, `public_html/` into the document root. Keep `app/.env` and `app/data/`.
3. The first request runs the database changes once.
4. Check the footer version, send a test card, and look at System health.
5. Optional: set an outside timer on the address shown on System health.
6. To keep visitors off a half finished upload, create an empty file `app/data/MAINTENANCE` before uploading (the whole site then shows the friendly page, and the payment and email webhooks are told to try again later) and delete it once the new version shows in the footer. This works from the version that added it onwards. Without it, a visit during the upload still gets the friendly page and not a blank error. After uploading, wait a minute or two before testing, because the host can briefly serve old files. If every page is blank, look in `app/data/error.log` (and for an `error_log` file in `public_html` or `app`) for the reason.

Backups are the host's responsibility (copy the `app/data/` folder). The application also has an encrypted backup tool, which is optional.

## 12. Operations screens used day to day

Overview (what needs attention), Delivery issues (failed cards, pause), Reports and complaints, Senders, Donations and payments, System health (email, payments, scheduled jobs), Change history. Alerts are emailed to the people named in Application settings, and escalate if nobody acknowledges them.

## 13. Testing

About 30 automated test scripts (PHP, run with `bash scripts/test-all.sh`). They cover the rules (limits, queue, payments, retention), security (tokens, headers, role by route for every admin page, uploads, webhooks), the library lifecycle, scheduling, branding and the admin workspace over real HTTP with sign in and two step codes. A test fails if it exits with an error or prints a FAIL line. Run the suite on its own, because tests share a data folder.

## 14. Key decisions

| Decision | Why |
|---|---|
| Plain PHP and SQLite | Runs on the Group's existing cPanel hosting. No server tools needed |
| Two admin levels | A small volunteer team. Owner holds the sensitive powers |
| Always open sending (no campaign windows) | Cards can be sent at any time of year. The only lock is the production payment check while donations are on |
| Donations off by default | The Trustees decide when fundraising starts |
| Email through the Group's account or Postmark | SMTP works immediately; Postmark gives delivery feedback |
| No cron needed | The host does not give the team scheduler access |

## 15. Open items and limitations

1. A Trustee must approve the Privacy and Terms wording (the draft notice was removed on request).
2. Gift Aid charity details and a Trustee decision are needed before donations are switched on.
3. Postmark webhook key should move to Basic Auth and the old `?k=` form then be removed.
4. SPF, DKIM and DMARC should be checked on the mail domain.
5. Artwork is needed for other occasions. Only Christmas designs exist.
6. Keyboard and screen reader testing and a volunteer usability trial are not done.
7. With an ordinary mail account, large scheduled bursts send slowly. Postmark is better for busy days.
8. The code review (`docs/CODE_REVIEW.md`) lists optional improvements, such as splitting the largest file.
10. Two deployments went blank for a few minutes after upload. The cause is not known; the error log added since will explain any repeat.

---

## 16. Screen inventory

| # | Screen | Address | Who |
|---|---|---|---|
| P1 | Home and card gallery | `/` | Everyone |
| P2 | Write your card | `/compose` | Everyone (sign in later) |
| P3 | Preview | `/preview` | Sender |
| P4 | Review and send | `/review` | Signed in sender |
| P5 | Card status | `/send?id=` | Sender |
| P6 | My cards | `/dashboard` | Sender |
| P7 | Register | `/register` | Visitor |
| P8 | Sign in | `/login` | Visitor |
| P9 | Forgotten and reset password | `/forgot`, `/reset` | Visitor |
| P10 | Account | `/account` | Sender |
| P11 | Address book and groups | `/contacts`, `/groups` | Sender |
| P11a | Import contacts | `/contacts/import` | Sender |
| P12 | Help and FAQ | `/help` | Everyone |
| P13 | Privacy and Terms | `/privacy`, `/terms` | Everyone |
| P14 | Delete my account | `/account/delete` | Sender |
| R1 | Envelope (card arriving) | `/c/<token>` | Recipient |
| R2 | The card | `/c/<token>?o=1` (after pressing Open) | Recipient |
| R3 | Stop cards | `/optout/<token>` | Recipient |
| R4 | Report a card | `/c/<token>/report` (form on the card) | Recipient |
| A0 | Workspace shell | all `/admin` pages | Administrators |
| A1 | Overview | `/admin` | Administrators |
| A2 | eCard Library list, editor, preview | `/admin/library` | Administrators (publish: owner) |
| A3 | Order, descriptions and styles (a section of the eCard Library) | `/admin/designs` | Administrators |
| A3b | Occasions and styles | `/admin/occasions` | Administrators |
| A3c | Bulk card send | `/admin/bulk` | Administrators |
| A4 | Donations and sharing | `/admin/site` | Administrators |
| A5 | Delivery issues | `/admin/delivery` | Administrators |
| A6 | Reports and complaints | `/admin/reports` | Administrators |
| A7 | Senders | `/admin/senders` | Administrators |
| A8 | Donations and payments | `/admin/finance` | Administrators |
| A9 | Gift Aid | `/admin/giftaid` | Owners |
| A10 | Measures | `/admin/measures` | Administrators |
| A11 | Platform controls | `/admin/platform` | Administrators |
| A12 | Settings forms (application, wording, privacy) and review | `/admin/app` and others | Administrators |
| A13 | Email delivery | `/admin/mail` | Owners |
| A14 | Email preview and test, Rehearsal | `/admin/email`, `/admin/rehearsal` | Administrators |
| A15 | System health | `/admin/health` | Administrators |
| A16 | Change history and export | `/admin/audit` | Administrators (export: owner) |
| A17 | Administrator access and invitations | `/admin/access`, `/invite` | Owners |
| A18 | Two step sign in | `/mfa` | Administrators |

## 17. Wireframes

These are layout schematics, not finished designs. They show what is on each screen and where. Square brackets are buttons, `( )` are choices, `[ v ]` is a drop down, `___` is a text field. Colour and exact spacing come from the style sheet. Every public page has the same frame (section 17.1).

### 17.1 Page frame (every public and sender page)

```
+------------------------------------------------------------------------+
| TEST BANNER (only when not production): "DEVELOPMENT environment..."   |
+------------------------------------------------------------------------+
| (logo) 7th Swindon Scouts eCards     Cards  My cards  Address book      |
|                                      Account  Admin*  Sign out         |
|                                      (* only for administrators)       |
+------------------------------------------------------------------------+
|  [Skip to content]  (first link on the page)                           |
|                                                                        |
|                         PAGE CONTENT                                   |
|                                                                        |
+------------------------------------------------------------------------+
| (logo) Privacy and cookies · Terms and safeguarding · Help and FAQ     |
| Sending is free. Cards stay viewable for 60 days after sending.        |
| Version 2026.10.13-abcdef0                                             |
+------------------------------------------------------------------------+
Signed out visitors see "Sign in" and "Register" instead of the account links.
Recipients see only the logo and name (no account links).
On a phone the links wrap under the logo; nothing scrolls sideways.
```

### 17.2 Sender journey

**P1 Home and card gallery** (`/`)

```
+------------------------------------------------------------------------+
| (frame header)                                                         |
+------------------------------------------------------------------------+
| 7TH SWINDON SCOUTS ECARDS                       +--------------------+ |
| Send a card, Scout style                        |  (featured card,   | |
| (in the Christmas season: "Send a Christmas     |   one that suits   | |
| card, Scout style")                             |   the season)      | |
| Pick a design, write your message and we will   +--------------------+ |
| email a private card to friends and family. Sending is free.           |
| [Choose a card]   [How it works]                                       |
|                                                                        |
| (flash notice if sending is locked: "Sending is not open yet...")      |
|                                                                        |
| How it works                                                           |
| (1) Choose a design  (2) Write your message  (3) We send each card     |
|                                                                        |
| [Every card helps local Scouting ... only while donations are on]      |
|                                                                        |
| Pick a design                                                          |
| Show cards for [ All occasions v ]   ([Show] only if scripts are off)  |
| 3 cards shown. Show all cards        (only when a filter is chosen)    |
| +----------+ +----------+ +----------+                                 |
| | picture  | | picture  | | picture  |   each tile links to            |
| | Title    | | Title    | | Title    |   /compose?card=<name>          |
| | line     | | line     | | line     |                                 |
| +----------+ +----------+ +----------+                                 |
+------------------------------------------------------------------------+
The occasion drop down appears only when two or more occasions have cards.
```

**P2 Write your card** (`/compose`)

```
+------------------------------------------------------------------------+
| Step 2 of 3: Write                                                     |
| Write something wonderful                                              |
| Your message and everyone you are sending it to, together in one place.|
|                                                                        |
| +--- Live preview ------------+  From (your name or family name)       |
| | (card picture)              |  [______________________]              |
| | [Change design]             |  Up to 60 characters                   |
| | "message appears here"      |                                        |
| | With love from  NAME        |  Your message                          |
| +-----------------------------+  [____________________________ ]       |
|                                  [____________________________ ]       |
|                                  Up to 500 characters                  |
|                                  > Need ideas? Greeting examples       |
|                                     "..."  [Use this]                  |
|                                                                        |
| Who is it for? (up to 20)                                              |
|  Recipient 1:  Name [________]  Email [______________]                 |
|     > Personal message for this person (optional)         [Remove]     |
|  Recipient 2:  ...                                                     |
|  [Add another recipient]                       2 of 20                 |
|  > Paste several at once  (Name, email per line, or just addresses;     |
|    [Add these people to the list] turns them into rows to check)       |
|  [Choose from address book]                                            |
|                                                                        |
|  [Save draft]   [Preview]   [Continue to review]                       |
|  "Draft saved at 14:05"  or  "Not saved yet. ... (you will register    |
|   before sending)"                                                     |
+------------------------------------------------------------------------+
Adding many people: [Add another recipient] and [Remove] change the rows on the page without reloading (one page load each when scripts are off). The paste box reads Name, email lines, Name <email> lists copied from an email, tab separated spreadsheet rows, and bare addresses (a name is made from the address, for example uncle.bob@example.com becomes Uncle Bob). [Add these people to the list] shows each person as a row to check, skips addresses already on the card, stops at the limit, and leaves any line it could not read in the box with a reason. The box is open when the list is empty.
Errors appear in a summary at the top and beside each field; focus moves to the summary.
There is no design drop down. "Change design" returns to the gallery. On a phone the card becomes a small strip (picture, name, "Change design") above the fields, so the fields start straight after it. On desktop the card is a narrower picture that stays in view while you type.
```

**P3 Preview** (`/preview`)

```
+------------------------------------------------------------------------+
| Preview                                                                |
| This is how your card will look for Gran.                              |
| +--------------------------------------------------------------+      |
| | (card picture, message, "With love from NAME")                |      |
| +--------------------------------------------------------------+      |
| [Back to editing]   [Review and send]                                  |
+------------------------------------------------------------------------+
On a phone the two buttons stay fixed at the bottom of the screen, so they
are always in reach however long the card is. The card is shown full size
here on purpose: seeing it is the point of the page.
```

**P4 Review and send** (`/review`)

```
Desktop                                              Phone
+------------------------------------------------+   +----------------------------+
| Step 3 of 3: Send                              |   | 1. 2. 3. Review and send   |
| Review and send                                |   | Review and send            |
| (warnings: email not verified; already sent    |   | +------------------------+ |
|  to some of these people: tick to send again)  |   | |[thumb] Card name       | |
|                                                |   | |        From The Smiths | |
| +-- card ------+  > Sending to 3 people        |   | |        Edit message    | |
| | (small       |    * Gran (g@example.org)      |   | | "Your message..."      | |
| |  picture)    |    * Bob [Personal message]    |   | | > See the full card    | |
| | Card name    |  Delivery                      |   | +------------------------+ |
| | From NAME    |   [ As soon as possible v ]    |   | > Sending to 3 people      |
| | Edit message |   (Choose a date and time:     |   |   (folded when over 3)     |
| | "Message..." |    shows a date box)           |   | Delivery [ As soon... v ]  |
| | > Full card  |  [Send my cards]               |   | ...                        |
| +--------------+  "Sending is free."            |   | [   Send my cards   ] fixed|
+------------------------------------------------+   |  at the bottom of screen   |
                                                     +----------------------------+
ONLY WHEN DONATIONS ARE ON the delivery block is followed by:
  How would you like to send?  (o) Send for free  ( ) Make an optional donation
   (£2) (£5 suggested) (£10) (Other £[__])   suggestion grows with card count  [ ] add a line to the cards
   [ ] Gift Aid form (name, address, declaration) if offered
   Total £0.00     [Send my cards for free] / [Donate and send]
WHEN A PAYMENT IS PENDING: [Check payment status] [Cancel this attempt]
The message is shown once. Only personal messages are shown beside a person.
```

**P5 Card status** (`/send?id=`)

```
Desktop                                                    Phone
+------------------------------------------------------+   +------------------------+
| (after sending) "Your cards are queued for sending"  |   | Merry Christmess       |
|   or "Your cards are scheduled. Scheduled for ..."   |   | Cards: Queued.         |
| Merry Christmess                                     |   | [Cancel unsent cards]  |
| Cards: Queued.  Donation: No donation                |   | +--------------------+ |
| [Cancel unsent cards]                                |   | | Gran               | |
| Name   Email             Status      Action          |   | | gran@example.org   | |
| Gran   gran@example.org  Viewed                      |   | | [Viewed]           | |
| Bob    bob@example.org   Scheduled   [Cancel]        |   | +--------------------+ |
| Sue    sue@example.org   Failed  [fix ____][Resend]  |   | | Sue  [Failed]      | |
| > Change the delivery time (only while Scheduled)    |   | | [address] [Resend] | |
| Legend: Queued, Scheduled, Sent, Delivered, ...      |   +--------------------+ |
| (after sending) Tell a friend: [WhatsApp] [Email]    |   +------------------------+
+------------------------------------------------------+
On a phone each recipient is its own block, so no action is cut off.
```

**P6 My cards** (`/dashboard`)

```
+------------------------------------------------------------------------+
| My cards                                                               |
| (verify email warning if needed)       [Write a new card]              |
| Drafts · Scheduled · Sent  (a heading above each group that has cards)  |
| +------+  Merry Christmess  [Draft]                                    |
| |thumb |  13 Oct 2026 · 2 Scheduled, 1 Viewed                          |
| +------+  [See how it is going]   or  [Keep writing] [Discard draft]   |
| ...one row per card...                                                 |
| Donation history (only if there are donations)                         |
|  Date | Amount | Reference                                             |
| Address book · Delete my account                                       |
| Email preferences (notifications when a card is viewed)                |
+------------------------------------------------------------------------+
```

**P7 Register / P8 Sign in / P9 Password**

```
Register (/register)              Sign in (/login)           Forgotten password (/forgot)
+-----------------------------+   +-----------------------+  +------------------------+
| Register                    |   | Sign in               |  | Forgotten your password|
| You need an account to send |   | Email    [__________] |  | Email [____________]   |
| Your name   [__________]    |   | Password [__________] |  | [Send reset link]      |
| Email       [__________]    |   | [Sign in]             |  +------------------------+
| Password    [__________]    |   | Forgotten your        |  Reset (/reset?t=...)
| (10+ characters)            |   | password?  Register   |  New password [_______]
| [x] I am 18 or over and     |   +-----------------------+  Again        [_______]
|     accept the Terms        |                              [Save new password]
| [ ] Email me once a year to |   (a hidden field catches automatic sign ups;
|     remind me to send       |    sign in is rate limited)
|     Christmas cards         |
| [Create account]            |
+-----------------------------+
```

**P10 Account** (`/account`)

```
+------------------------------------------------------------------------+
| Your account                                                           |
| Name: Sam   Email: sam@example.org (confirmed)                         |
| Change email    New address [____] Current password [____] [Send link]  |
| (a confirmation goes to the new address; the old one is told)          |
| Change password Current [___] New [___] Again [___]  [Change password] |
| (administrators:) Two step sign in: set up / reset                     |
+------------------------------------------------------------------------+
```

**P11 Address book and groups** (`/contacts`, `/groups`, picker)

```
+------------------------------------------------------------------------+
| Address book            Search [_______] [Search]   [Add contact]      |
| Name        Email               Groups          Action                 |
| Gran        gran@example.org    Family          [Edit]                 |
| ...                                                                    |
| [Import from a spreadsheet]  [Delete all contacts]                      |
| Contact groups: Family (3) Friends (5) [New]                           |
| Picker while writing: "Choose from address book": tick contacts or a   |
| group, [Add to my card]                                                |
+------------------------------------------------------------------------+
```

**P11a Import contacts** (`/contacts/import`): choose a CSV file (name, then email, one person per line; a heading line is fine; 200 KB and 1,000 lines at most) and [Import contacts]. The result lists how many were added, how many were already saved, and each line that was not valid. Duplicates and the address book limit are respected, nothing is emailed, and the import is recorded in the change history.

**P12 Help and FAQ** (`/help`)

```
+------------------------------------------------------------------------+
| Help and FAQ                                                           |
| > Is it really free?            > Can I choose when a card arrives?    |
| > I did not get the verification email  > My recipient did not get it  |
| > What do the statuses mean?    > How long does a card last?           |
| > How do you decide a card was viewed?  > Can I delete my account?     |
| > (extra questions an administrator adds)                              |
| Contact: cards@7thswindon.org.uk                                       |
+------------------------------------------------------------------------+
Each question is an open and close section (native details element).
```

**P13 Privacy and Terms** (`/privacy`, `/terms`): a long text page with headings, the Group named as the owner of the service, what is kept and for how long, the yearly reminder, rights and contact; Terms add acceptable use and safeguarding. **P14 Delete my account** (`/account/delete`): a warning list of what happens, a password field, a tick box, [Delete my account].

### 17.3 Recipient pages

**R1 Envelope** (`/c/<token>`), **R2 the card** (after pressing Open), **R3 Stop cards**, **R4 Report**

```
R1 Envelope                         R2 The card
+--------------------------+        +-------------------------------------+
| (logo only header)       |        | [Skip animation]                    |
|   +------------------+   |        | +---------------------------------+ |
|   |  envelope        |   |        | |  (card picture)                 | |
|   |  To Gran         |   |        | |  Dear Gran,                     | |
|   +------------------+   |        | |  (message, personal note first) | |
| A Christmas card for Gran|        | |  With love from NAME            | |
| From The Smiths          |        | |  [donation line if chosen]      | |
| [Open your card]         |        | +---------------------------------+ |
| Stop cards from The      |        | > Report this card                  |
| Smiths or this service   |        |   What is wrong? [____] [Send]      |
+--------------------------+        | Stop cards from The Smiths or ...   |
 (pressing Open is what marks       +-------------------------------------+
  the card Viewed, never page load)
R3 Stop (/optout/<token>)          Expired or withdrawn
+--------------------------+       +------------------------------------+
| Stop receiving cards     |       | This card has expired              |
| (o) From The Smiths      |       | Cards stay viewable for 60 days.   |
| ( ) From this service    |       +------------------------------------+
| [Stop cards]             |
+--------------------------+
```

---

### 17.4 Admin workspace

**A0 Shell** (every admin page)

```
+------------------------------------------------------------------------+
| (public frame header)                                                  |
+------------------+-----------------------------------------------------+
| (7) Volunteer    |  Overview / Cards / eCard Library                   |
| workspace        |  (breadcrumb)                  [Alex Owner · Owner] |
| ---------------- |                                                     |
| OVERVIEW         |                                                     |
|  Overview        |            PAGE CONTENT                             |
|  Measures        |                                                     |
| CARDS AND        |                                                     |
|  eCard Library   |                                                     |
|  Occasions and   |                                                     |
|   styles         |                                                     |
|  Donations and   |                                                     |
|   sharing        |                                                     |
| PEOPLE AND       |                                                     |
| SUPPORT          |                                                     |
|  Delivery issues |                                                     |
|  Reports and     |                                                     |
|   complaints     |                                                     |
|  Senders         |                                                     |
| FUNDRAISING      |                                                     |
|  Donations and   |                                                     |
|   payments       |                                                     |
|  Gift Aid (owner)|                                                     |
| SETTINGS AND     |                                                     |
| HEALTH           |                                                     |
|  Platform controls|                                                    |
+------------------+-----------------------------------------------------+
Navy panel, white links, current page in yellow. The list is built from one
manifest, so the menu, the Overview shortcuts and the breadcrumbs always agree.
On a phone the panel becomes a closed "Workspace menu" that opens on tap.
```

**A1 Overview** (`/admin`)

```
+------------------------------------------------------------------------+
| Overview                                                               |
| Needs attention                                                        |
|  Scheduled job: Unknown (it has never reported).              [Open]   |
|  1 delivery has failed and needs correction.                  [Open]   |
|  Administrator access has not been reviewed in 90 days.   [Open]/Ask an owner |
|  (or: "Nothing needs attention right now.")                            |
| Where things stand                                                     |
|  [Cards requested 4] [Sending: Open for new cards] [Dispatch: Running] |
|  [Donations recorded £0.00 (only while donations are on)]              |
| Card activity    2 Sent, 1 Failed...   · Merry Christmess: 3 ...       |
| Fundraising ... (only while donations are on)                          |
| What would you like to do?  (tool shortcuts, same as the menu)         |
|  [eCard Library →] [Donations and sharing →] ...      |
+------------------------------------------------------------------------+
```

**A2 eCard Library** (`/admin/library`, `/edit`, `/preview`)

```
List                                                                    
+------------------------------------------------------------------------+
| eCard Library          [Add a card]                                    |
| Filter by status: All (12) · Published · Held back · Draft · Archived  |
| +-----+ Name · Occasion · version 2 · State · Updated  [Edit] [Preview] |
| |thumb| ...                                                            |
| +-----+                                                                |
+------------------------------------------------------------------------+
Edit draft
+------------------------------------------------------------------------+
| Edit draft (version 2)                                                 |
| 1. Artwork    (current picture)  [Choose a picture]  PNG, JPEG, WebP   |
| 2. Details and accessibility                                           |
|    Card name [____]  Occasion [ Christmas v ]                          |
|    Words printed on the card [____]                                    |
|    Description for screen readers [____________ ]                      |
|    [ ] I confirm the Group has the right to use this artwork           |
|    [ ] I have checked the wording and year are right for this card     |
| 3. Thumbnail  How far down the picture the thumbnail starts [0-100]    |
| [Save draft]  [Preview]  then, from the list: Publish version (owner),  |
| Hold back, Put back in the gallery, Archive, Restore, Create new       |
| version, Feature on the home page / Stop featuring                     |
| (errors: summary at the top and beside fields)                         |
+------------------------------------------------------------------------+
Preview shows the card "as the sender sees it" and "as the recipient sees it".
Publish and other actions ask for confirmation first and say what will change.
```

**A3b Occasions and styles** (`/admin/occasions`)

```
+------------------------------------------------------------------------+
| Occasions                                                              |
| Cards are sorted into occasions, such as Christmas or Birthday. ...    |
| Occasion and season (month and day, like 11-01)    Cards  On show      |
| [Christmas   ] [11-01] to [01-06] [Save]  12  12  Move up/down Built in|
| [Birthday    ] [     ] to [     ] [Save]   0   0  Move up/down Remove  |
| [Easter      ] [03-20] to [04-25] [Save]   3   3  Move up/down Has cards|
|                                                                        |
| Add an occasion                                                        |
| Name (for example Get well, Easter, Congratulations) [____________]    |
| [Add occasion]                                                         |
| Up to 12 occasions. Names are 1 to 30 plain characters, not repeated.  |
+------------------------------------------------------------------------+
Christmas cannot be removed. An occasion with cards cannot be removed.
To put a card in an occasion, choose it in the eCard Library editor.
```

**A3 Order, descriptions and styles** (`/admin/designs`), a section of the eCard Library reached from the tabs at the top of the Library (Cards | Order, descriptions and styles); it is not a menu item of its own, and the old address still works

```
+------------------------------------------------------------------------+
| Library: Order, descriptions and styles                              |
| Choose the order cards appear in, hide or show a card, and write the   |
| description read aloud ... To add or publish a design, use the eCard   |
| Library.                                                               |
| (picture) May all your pegs go in first time                           |
|   Accessible description [__________________]                          |
|   [Save description] [Disable] [Move down]                             |
| (picture) Eat, drink and be Scouty    ... [Move up] [Move down]        |
+------------------------------------------------------------------------+
```

**A4 Donations and sharing** (`/admin/site`) and **A12 settings forms** (same pattern for Application settings, Email and help wording, Privacy and retention)

```
Form                                      Review screen (after [Review changes])
+---------------------------------------+ +----------------------------------+
| Donations and sharing Version 4      | | Review changes: Donations and sharing|
| (when changes apply)                  | | Take donations   Off  ->  On     |
| [ ] Take donations (leave off until...| | Suggested amounts 2,5,10 -> ...  |
| Suggested amounts  [200,500,1000]     | | Reason [__________]  (some pages |
| Gift Aid charity   [__________]       | |  also need an approval reference)|
| [ ] Offer Gift Aid on donations       | | [Confirm and save] [Back]        |
| [Review changes]                      | +----------------------------------+
| ---                                   |
| Share the site                        |  Restoring (owner): the form opens
| Link  https://card.../   (?ref=label) |  with "Restoring earlier values"
| (QR code)  [Download QR (SVG)]        |  and the same review step.
| Cards by promotion label: ...         |
+---------------------------------------+
```


**A5 Delivery issues** (`/admin/delivery`)

```
+------------------------------------------------------------------------+
| Delivery                                                               |
| Queued: 2. Being sent: 0. Last scheduled run: 13 Oct 20:01. Dispatch   |
| is running.   [Pause dispatch]                                         |
| Needs attention                                                        |
| Recipient             Status      Detail              Action           |
| bad@example.org       Failed      Mailbox missing     [Resend with a   |
|                                                        fresh link]     |
| Resending creates a new private link and switches the old one off.     |
+------------------------------------------------------------------------+
```

**A6 Reports and complaints** (`/admin/reports`), **A7 Senders** (`/admin/senders`)

```
Reports                                          Senders
+------------------------------------------+     +-------------------------------+
| Reports                                  |     | Senders                       |
| Recipient     Reason     Status          |     | Find [email or name] [Search] |
| g@example.org "unkind"   Open            |     | The Smiths   Active  [Suspend]|
|   [View card] [decision buttons]         |     | Another      Suspended       |
| (decided reports show the decision)      |     |              [Reinstate]      |
| "No reports. Nothing needs a decision."  |     | (a reason is asked for)       |
+------------------------------------------+     +-------------------------------+
Viewing a reported card is recorded in the change history.
```

**A8 Donations and payments** (`/admin/finance`), **A9 Gift Aid** (`/admin/giftaid`), **A10 Measures** (`/admin/measures`)

```
Finance                                  Gift Aid (owners)         Measures
+----------------------------------+     +----------------------+  +------------------+
| Finance                          |     | Gift Aid             |  | Measures         |
| Beneficiary and payment          |     | Status: Off          |  | Cards requested  |
|   connection (Stripe test/live)  |     | Charity name: ...    |  | Delivered / viewed|
| Donations  date amount fee ...   |     | Declarations to claim|  | "fewer than 5"   |
| Pending or mismatched payments   |     |  [Download schedule] |  | hides small      |
| Payment exceptions               |     |  [Mark as claimed]   |  | numbers          |
| [Export finance CSV] (date range)|     |                      |  |                  |
+----------------------------------+     +----------------------+  +------------------+
```

**A11 Platform controls** (`/admin/platform`)

```
+------------------------------------------------------------------------+
| Platform controls                                                      |
| Settings and tools for running the service. You see only what your     |
| level allows.                                                          |
| Check on the service                                                   |
|   [System health ->]  [Change history ->]                              |
| Email                                                                  |
|   [Email delivery ->] (owner)  [Email and help wording ->]             |
|   [Email preview and test ->]  [Rehearsal ->]                          |
| Rules and settings                                                     |
|   [Application settings ->]  [Privacy and retention ->]                |
| People                                                                 |
|   [Administrator access ->] (owner)                                    |
+------------------------------------------------------------------------+
```

**A13 Email delivery** (`/admin/mail`, owners)

```
+------------------------------------------------------------------------+
| Email delivery                                                         |
| How should email be sent?  (o) Postmark ( ) Group mail account (SMTP)  |
|   ( ) Only write to a log (development)                                |
| Sender address [cards@7thswindon.org.uk]                               |
| Postmark token [ saved, write only ]    Hook key [ saved ]             |
| SMTP host [___] port [587] security [ tls v ] user [___] password [saved]|
| [Review changes]                                                       |
| Send a test email to me  [Send test]   Result: "Accepted at 14:02"     |
+------------------------------------------------------------------------+
```

**A14 Email preview and test / Rehearsal** (`/admin/email`, `/admin/rehearsal`)

```
Email preview                          Rehearsal
+------------------------------------+ +-----------------------------------+
| Email preview                      | | Rehearsal                         |
| (rendered card email, as received) | | Send test cards only to the       |
| [Send me this email]               | | allow list: a@x, b@y              |
+------------------------------------+ | [Send rehearsal card]  Results log|
                                       +-----------------------------------+
```

**A15 System health** (`/admin/health`)

```
+------------------------------------------------------------------------+
| System health        Checked at 13 Oct 2026 20:05:11                   |
| [Scheduled queue job: OK (20:04)] [Email provider: SMTP, last send ok] |
| [Payment provider: not configured] [Backup: Unknown] [Sending: Open]   |
| [Dispatch: Running]                                                    |
| Unresolved alerts   (text) Acknowledged by Alex / [Acknowledge]        |
| Scheduled cards     2 recipients waiting for a chosen time. Job running.|
| Scheduled work without cPanel (owners): the timer address to give to   |
|   cron-job.org:  https://card.../hooks/tick?k=...                      |
+------------------------------------------------------------------------+
```

**A16 Change history** (`/admin/audit`, `/admin/audit/export`)

```
+------------------------------------------------------------------------+
| Change history   Append-only.   [Export entries as a spreadsheet] (owner)|
| config_site by Alex at 13 Oct 14:02: giftaid_charity: "" to "7th..."   |
|     (reason: ...)                          [Restore the earlier values] |
| role_change by Alex at ...                                             |
| Export: From [date] To [date] Action starts with [___] Reason [____]   |
|         [Download CSV]  (max a year, 10,000 rows, addresses masked)    |
+------------------------------------------------------------------------+
```

**A17 Administrator access** (`/admin/access`) and the invitation page (`/invite`)

```
Access (owners)                                      Invitation (emailed link)
+------------------------------------------------+   +------------------------------+
| Administrator access                           |   | Accept the invitation        |
| Access review: last reviewed 13 Oct  [Record]  |   | You are signed in as ...     |
| Name / email | Level | Last sign in | Two step |   | This gives: Administrator    |
| Invite someone                                 |   | [Accept and continue]        |
|   Email [____]  ( ) Administrator ( ) Owner    |   | then set up two step sign in |
|   [Send invitation]                            |   +------------------------------+
| Waiting for an answer: email · level · [Resend] [Revoke]
| Access for people who already have an account:
|   Name: [x] Administrator [ ] Owner  [Save]
| (there must always be at least one owner)      |
+------------------------------------------------+
```

**A18 Two step sign in** (`/mfa`)

```
+--------------------------------------+
| Administrator two-step sign in       |
| (first time: scan or type the setup  |
|  key into an authenticator app)      |
| Code [______]   [Continue]           |
+--------------------------------------+
```

---

## 18. Navigation map

```
Public:   Home ─┬─> Compose ─> Preview ─> Review ─> Status ─> My cards
                ├─> Help ─> (Privacy, Terms)
                └─> Register / Sign in ─> Account, Address book, My cards
Recipient: email link ─> Envelope ─> Card ─> Report / Stop cards
Admin:    Sign in ─> Two step ─> Overview ─┬─> Measures
                                          ├─> Cards: Library (Cards, Order, descriptions and styles), Occasions and styles, Donations and sharing
                                          ├─> Support: Delivery, Reports, Senders
                                          ├─> Fundraising: Donations, Gift Aid
                                          └─> Platform controls: Health, History, Settings,
                                              Email, Wording, Privacy, Access, Rehearsal
```

## 19. Glossary

| Term | Meaning |
|---|---|
| Card | One design plus a message, sent to one or more recipients |
| Design | A card picture in the eCard Library. Has versions and an occasion |
| Occasion | Christmas, Birthday, Thank you or Celebration |
| Queue | Recipients waiting to be emailed |
| Scheduled | A recipient held until a chosen time |
| Owner / Administrator | The two admin levels (section 2) |
| Timer address | The secret web address an outside timer opens to run background jobs |
| Build stamp | The date and commit shown in the footer |
