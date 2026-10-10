# Accessibility and plain-language test plan (FR-145, AC-103, AC-104)

Record results here before launch. The app has not yet had an assistive technology audit; this plan is how it gets one. Fix defects, retest, then record the date and tester.

## Set-up

- Browsers: Chrome and Firefox on desktop; Safari on iPhone; Chrome on Android.
- Screen readers: NVDA with Firefox or Chrome; VoiceOver on iPhone; TalkBack on Android.
- Other checks: keyboard only (no mouse), 200 percent browser zoom, 320 pixel wide window, reduced-motion setting on, high contrast mode, images turned off, JavaScript turned off.
- Use the staging site with test payment and test email.

## Tasks (each is run with a screen reader and again keyboard only)

| # | Task | Pass when |
|---|---|---|
| 1 | Find a design, write a message, add three recipients, add one personal message | Every field and error is announced with its label; Add and Remove recipient work by keyboard; the live count is announced or readable |
| 2 | Make an error (bad email, too-long message) and fix it | Focus moves to the first error; the message is linked to its field; typed values survive |
| 3 | Register, verify by email, return to the saved card | The draft is intact; progress and the terms checkbox are understandable |
| 4 | Review and choose Send cards for free | Both buttons are clearly labelled; the queued confirmation is announced |
| 5 | Review and choose Donate and send cards, then cancel checkout | The recovery panel is announced; nothing is sent |
| 6 | Open a card as a recipient with reduced motion on | The greeting is readable without waiting for animation; Open button is reachable first |
| 7 | Report a card and, separately, stop further cards | Each form has labels and a clear confirmation |
| 8 | Use the address book: add a contact, make a group, pick contacts into a card | Checkboxes, search and the selected count work by keyboard and are announced |
| 9 | As an administrator: sign in with the two-step code, change a campaign setting, review the old and new values, confirm | Review table reads sensibly (labels for old and new); no horizontal scroll at 320 pixels |
| 10 | Pause and resume dispatch | The impact counts and reason field are reachable and announced |

## Plain-language check

Read every sender, recipient and admin page aloud or run a readability tool. Aim for short sentences and everyday words. List anything that needs rewording and who changed it. The agreed reading standard is decision D-14 (project lead to confirm).

## Results

| Date | Tester | Tool and browser | Task # | Result | Defect and fix |
|---|---|---|---|---|---|
| | | | | | |
