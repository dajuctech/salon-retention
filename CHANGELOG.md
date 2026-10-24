# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/) (see [CONTRIBUTING.md](CONTRIBUTING.md#4-versioning-and-releases)).

## [Unreleased]

### Added
- README for visitors: screenshots, what the project demonstrates, quality numbers, architecture diagram, tech stack, CI and quality badges.
- Demo data: five regulars who visited in the past week, so every week of the reports shows takings, as in a real salon.

### Changed
- Booking page: the header and heading are sent at once (pre-rendered); only the salon's details and the form wait for the database. Main content now appears in 1.5 s on a throttled phone.
- CI: Node 24 (`.nvmrc`), current GitHub Actions versions (Node 24 runtime), Lighthouse with real throttling and its report kept as an artifact, a check that the app is up before Lighthouse runs.

### Fixed
- Security: `lodash` forced to 4.18.1 (code injection and prototype pollution in older versions, pulled in by Prisma's tooling). `pnpm audit` is clean.
- Accessibility: screen readers now read a barber's name only ("Tunde"), not the initials badge as well ("TU Tunde").
- A browser test depended on the time of day it ran; it now uses a barber's next working day.
- `CODEOWNERS` now names a real GitHub account.
- Phones: on the staff New booking and Booking detail pages, the scrolling row of dates stretched its form section to almost twice the screen width, hiding half the time slots. Form sections can no longer grow wider than the screen, and a browser test checks it.
- WhatsApp templates: five of the eight would have been rejected by Meta automatically (a blank at the start or end, or two blanks side by side). Their wording now has fixed words around every blank, `promotion_generic_v1` starts with the salon's name, a unit test checks every template against Meta's rules, and owners get a plain explanation if their own wording breaks them.
- Staff "New booking" and "Add customer" pages answered 404: the access rule for `/app/bookings/<id>` and `/app/customers/<id>` treated `new` as a record id. A unit test now checks every fixed staff page, and a browser test adds a customer and books them.
- Booking page: a foreign number typed without its country code (e.g. a UK `07…` number at a Nigerian salon) was refused with no explanation. The message now says to start with + and the country code.

### Added
- Calendar week view (US-14) and month view with bookings per day (US-15); payment status on every booking (US-14 AC3).
- "Pause all sending" for owners on the WhatsApp tab, and a banner on every staff screen while sending is paused.
- Offline banner on staff screens.
- Data retention job: anonymises inactive customers after 24 months, removes old message text, AI and audit logs, and 6-year-old financial records (NFR-DATA).
- Structured JSON logging with personal-data redaction, request ids, and Sentry error reporting when `SENTRY_DSN` is set (NFR-OBS).
- AI feedback loop: which suggestion the owner picked and what they finally sent; `pnpm ai:report` shows quality per prompt and model, with drift alerts.
- "How AI suggestions work" notice for owners; AI model card ([docs/ai-model-card.md](docs/ai-model-card.md)).
- Load-test script (`pnpm load:test`) and database restore drill (`pnpm drill:restore`).
- Browser tests on WebKit (iPhone) as well as Chromium; Lighthouse performance budget; CodeQL; the real-model AI eval job.
- Contribution guide, PR template, CODEOWNERS, security policy and this changelog.

### Fixed
- Rate-limit counters now record each window's start time, so stale ones can be cleaned up.

## [0.1.0] - 2026-10-17

First complete build of the R1 MVP: online booking, staff app (calendar, walk-ins, customers, payments, WhatsApp hub, inbox, win-back approvals, offers, loyalty, reports, settings), two-step sign-in, salon payout accounts (Paystack subaccounts, Stripe Connect), bot protection, real 404s, database-level tenant isolation, AI copy assistant with guardrails and evals.
