# Taking donations with GoCardless instead of Stripe: findings and plan

Status: exploration only. Nothing in the application has been changed. Written 17 October 2026 from GoCardless's public documentation; items marked CONFIRM need checking with GoCardless or in a sandbox account before building.

## 1. What GoCardless can do for us

- **Pay by Bank (Instant Bank Pay) is the right fit.** A one-off payment the donor approves in their own banking app, paid over Faster Payments. No mandate and no card. It is available in GBP for UK donors.
- **It runs on the Billing Requests API.** We create a Billing Request that holds the payment (`payment_request`: amount in pence, currency GBP, description, scheme `faster_payments`, and metadata), then create a Billing Request Flow and send the donor to its hosted `authorisation_url`. GoCardless collects their details and bank, and returns them to us afterwards.
- **The outcome comes by webhook, never by the redirect.** GoCardless says not to trust the return page. Events to handle: the billing request being fulfilled, `payments` confirmed, and `payments` failed. Funds normally arrive the next business day.
- **Webhooks are signed.** Header `Webhook-Signature`, an HMAC SHA256 hex digest of the raw body keyed with the endpoint secret. A bad signature should get status 498 (no retry). A batch can hold several events, delivery is at least once (deduplicate on event id), and an unknown event type should get 204.
- **Testing:** a free sandbox account (`api-sandbox.gocardless.com`) with test banks, and test webhook events from the dashboard.
- **Gift Aid:** GoCardless does not collect or check Gift Aid declarations. Our existing Gift Aid form and records would carry on exactly as they do now.
- **Later options on the same account:** a regular gift by Direct Debit, which Stripe in this app does not offer.

## 2. Things to be aware of

- **Bank payments only.** No debit or credit cards. Donors need a UK bank account and banking app. Anyone who cannot or will not use that cannot donate (sending cards stays free either way).
- **Cost (CONFIRM).** GoCardless advertises a 25% discount for registered charities, which also reduces the fee cap. Whether our Group qualifies depends on how it is registered. The exact fee per payment is not published in a form I could check. Compare it with Stripe's fee for the amounts we suggest (GBP 2, 5 and 10), because a fixed per-payment part weighs most on small gifts.
- **Refunds (CONFIRM).** Whether and how a Pay by Bank payment can be refunded, and who may do it, needs checking. The finance screen currently says refunds are made in the Stripe dashboard and then recorded.
- **Sandbox first.** We need a GoCardless sandbox account and access token to build and test. The live token and webhook secret go in `app/.env`, like the Stripe keys today.

## 3. How it would fit the application

The Stripe code touches a small number of places, so a provider switch is practical.

| Today (Stripe) | With GoCardless |
|---|---|
| `send.php` r_review creates a Checkout session and redirects | Create a Billing Request (metadata: send id), then a Billing Request Flow with return and exit addresses, and redirect to its `authorisation_url`. Keep the Billing Request id in the same place the session id is kept now |
| `r_return` and `pay_check` ask Stripe whether the session is paid | Ask GoCardless for the Billing Request and its payment; paid only when the payment is confirmed or submitted, otherwise pending |
| `pay_cancel` expires the session | Cancel the Billing Request if still pending |
| `/hooks/stripe` and `stripe_handle_event` | New `/hooks/gocardless`: verify the signature, loop over the events, record each event id (idempotent), and call the existing `confirm_payment` for a confirmed payment. A failed or cancelled payment returns the card to draft |
| `donations.stripe_session`, `payment_intent`, `account`, `fee`, `refunded` | Keep the table. Add a `provider` column. Store the Billing Request id and payment id in the existing reference columns, so Gift Aid, the finance export and reconciliation keep working |
| Finance screen: connection status, mismatches, exceptions | Same screen, showing the active provider, test or live mode and the last webhook time |
| System health: payment provider check | Same check, for whichever provider is active |
| `STRIPE_*` settings | `GOCARDLESS_TOKEN`, `GOCARDLESS_WEBHOOK_SECRET`, `GOCARDLESS_ENV` (sandbox or live), and `PAYMENT_PROVIDER` (`gocardless`, `stripe` or none). The local test payment page stays for development |

Rules that do not change: donations stay off until the Trustees switch them on, sending is always free, cards are queued only after a verified confirmation, a pending payment blocks a second attempt, and a late confirmation never queues a card twice.

## 4. Gift Aid stays exactly as it is

Gift Aid does not depend on the payment provider, so moving to GoCardless changes nothing here.

- **What makes a claim valid.** HMRC needs the donor's name and home address (with postcode), their statement that they want Gift Aid applied, their confirmation that they pay enough UK tax to cover it, the charity's name, a link from that declaration to the actual donation, and the declaration kept on record. Collecting details alone is not enough: the declaration is what counts. Details a bank or GoCardless collects during the payment are not a Gift Aid declaration and must not be used as one.
- **What the application already does.** It asks for first name, last name, house name or number and a UK postcode (checked), requires an explicit tick on the declaration (HMRC model wording naming the charity and covering the past four years, stored with each declaration), links the declaration to the donation only after the payment is confirmed, shows declarations to owners only, and produces a claim schedule that can be marked as claimed.
- **With GoCardless.** The same form and records are used. The only change is that the donation row is linked to the declaration through the GoCardless payment reference instead of the Stripe one (section 3).
- **Claiming later.** A claim can be made after the donation, within four years of the end of the tax year of the donation. The Group must be eligible to claim: the Treasurer must confirm it is a registered charity or otherwise recognised by HMRC for Gift Aid. This is the Trustee item already open in the SDD.
- **Only a genuine donation qualifies.** The donation gives the donor nothing in return (the card looks the same and sending is free), so it fits.
- **Record keeping needs a decision.** HMRC expects declarations to be kept for six years after the last claim that relies on them. The privacy notice currently says only that the Treasurer will confirm the period, and the application has no automatic deletion for Gift Aid records. A retention period (suggested: six years after the last claim, then deletion) should be agreed by the Trustees and then written into the privacy notice and the daily clean up.
## 5. Suggested build order

1. Add the provider setting and move the Stripe calls behind a small set of functions (start, status, cancel). No behaviour change; all existing tests must still pass.
2. Add the GoCardless provider against the sandbox, with a fake GoCardless server in the tests, as we already do for mail.
3. Add the webhook, signature check, duplicate handling and the failed or cancelled path, with tests.
4. Update the finance, health and Help wording (for example "You will approve the payment in your banking app").
5. Rehearse end to end in the sandbox, then switch to live credentials. Stripe code stays dormant until the Trustees agree it can be deleted.

## 6. What I need from you

- A GoCardless sandbox access token (a developer account is free), and later the live token and the webhook secret.
- Confirmation of the fee, the charity discount and the refund rules from GoCardless.
- A Trustee decision that donations will be by bank payment only.
- A Trustee decision on how long Gift Aid declarations are kept (suggested: six years after the last claim), and the Treasurer's confirmation that the Group can claim Gift Aid.

## Sources

- GoCardless: [Billing Requests overview](https://docs.gocardless.com/billing-requests/overview), [taking a Pay by Bank payment](https://docs.gocardless.com/billing-requests/taking-an-instant-bank-payment), [webhooks reference](https://docs.gocardless.com/docs/api-reference/webhooks), [pricing fees](https://support.gocardless.com/hc/en-gb/articles/21721571804188)
