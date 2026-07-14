# Market Research Desk

A personal market research, news monitoring and signal tracking application, built from the
*Functional Requirements Document* (Personal Market Research, News Monitoring and Signal Tracking
Application, draft v0.2). This build covers Phases 1-3 of the FRD's MVP build plan (core foundation,
market data, alerts and basic rules) plus the Phase 5 signal engine and Phase 6 signal outcome
tracking, adapted to run on free, no-API-key data sources.

Stack: Node.js + Express + the built-in `node:sqlite` module (no native build step) + vanilla JS/HTML
on the frontend. No frameworks, no build tooling &mdash; matches the style of the other tools in this repo.

The system never places trades and never presents a signal as certain - see FRD sections 2 and 3.
Everything it produces is a research prompt for you to look into further, not investment advice.

## Requirements

- Node.js 22.5 or later (uses the built-in `node:sqlite` module; tested on Node 24)

## Setup

```bash
cd market-research-tool
npm install
cp .env.example .env      # edit SESSION_SECRET at minimum
npm run seed rob <a-password-of-your-choice>
npm start
```

The app listens on `http://localhost:3000` by default (or `PORT` from `.env`). It's single-user: the
seed script creates one local account (username + scrypt-hashed password) plus a default "Main
Watchlist". Sessions are in-memory, so restarting the server logs you out - that's fine for a
personal tool run on your own machine.

The SQLite database lives at `data/market-research.db` (gitignored).

## Data sources (FRD open question #1)

No API keys required:

- **US and UK shares** - Yahoo Finance's unofficial `chart` and `search` endpoints. Data is delayed and
  these endpoints aren't officially supported, so they can change or rate-limit without notice.
- **Cryptoassets** - CoinGecko's free public API (search, simple price, market chart).

If either provider changes shape or starts blocking requests, `src/lib/marketData.js` is the only file
that needs to change - everything downstream (indicators, signal engine, scheduler) works from the
normalised shape it returns.

## What's implemented

- Secure login (scrypt password hashing, session cookies) for a single personal user
- Watchlists: create/edit/delete, add/remove assets, per-watchlist summary (asset count, active
  signals, biggest riser/faller, highest volume mover, last updated)
- Asset search across US shares, UK shares (LSE/AIM) and crypto, and an asset detail page with price,
  movement, volume, a 90-day sparkline chart, technical indicators, risk flags, signals and notes
- A background scheduler (`src/lib/scheduler.js`) that refreshes shares and crypto on independent
  intervals (`REFRESH_MINUTES_SHARES` / `REFRESH_MINUTES_CRYPTO`), stores daily bars for indicator
  history, and re-runs the signal engine after every refresh
- Technical indicators: 20/50/200-day moving averages, RSI(14), a simple volatility measure, and
  breakout/breakdown detection against recent support/resistance - each with a plain-English explanation
- The FRD section 13 scoring model - Positive Setup Score, Sell-Risk Score, Watch Priority Score and a
  High-Risk Asset Flag - **reweighted because this build has no news feed yet**: the news-sentiment and
  news-impact sub-scores are dropped and the remaining weights rescaled to still sum to 100 (see the
  comments in `src/lib/signals.js` for the exact rebalancing)
- Rule-based signal generation matching the FRD's example signal rules (positive setup, momentum alert,
  sell-risk, unusual volume, penny share pump-risk, crypto volatility, breakout/breakdown watch, plus a
  general high-risk warning and a fallback "watch" signal), with duplicate suppression, signal expiry,
  and conflicting-signal flagging when positive-setup and sell-risk are both active for the same asset
- In-app alerts generated from new signals, with duplicate suppression and optional email delivery
  (via `nodemailer`, only if `SMTP_*` and `ALERT_EMAIL_TO` are set in `.env` - otherwise alerts stay
  in-app only, no error)
- Research notes and a research status per asset, signal feedback (useful / not useful / false positive
  / missed context / needs rule adjustment), and a Settings screen for editing signal/alert thresholds
  and viewing system health (last refresh, recent ingestion log, failure count)
- Signal outcome tracking (FRD Phase 6): the scheduler captures the asset's price at 1/3/7/30/90 days
  after each signal fires (`src/lib/outcomes.js`) and classifies the outcome as positive/neutral/negative
  once a checkpoint is due - direction-aware, so a sell-risk signal is "positive" when the price actually
  fell, not when it rose. The Signals screen has a Rule Performance table (FR-062: which signal types
  actually pay off) plus outcome/feedback/date-range filters (FR-063), and each signal's detail page shows
  its checkpoint price table with % change since the signal fired

## Known gaps / follow-ups (deliberately out of scope for this first pass)

- **No news monitoring.** FRD sections 10 and 11 (news ingestion, sentiment/impact/relevance scoring,
  regulatory announcements) aren't built. This is the single biggest simplification in this build - the
  signal engine's scoring model is reweighted to compensate (see above), but signals will be noticeably
  less informed than the full FRD design until news is added. That would mean picking a news source
  (likely needs an API key) and wiring it into `src/lib/signals.js`'s scoring functions.
- **No CSV/Excel export** (FR-066) or daily/weekly research summary reports (FR-064, FR-065).
- **Sessions are in-memory** - restarting the server logs you out. Fine for a single-user local tool;
  swap in a persistent session store if that becomes annoying.
- **Unofficial data sources.** Yahoo Finance's endpoints aren't an official public API and CoinGecko's
  free tier is rate-limited - if you hit rate limits or broken responses, that's the likely cause. See
  "Data sources" above.
- **Penny share / high-risk classification is price-and-volume only.** The FRD's default rules also
  reference AIM-listing status and "no supporting news found," neither of which this build can check
  without a listing-status feed or news monitoring - the high-risk flag explanation says so explicitly
  when it fires.
- **No admin/API-key management UI** (FR-068, FR-069) since there are no API keys to manage yet.
