<div align="center">

# ✂️ Salon Retention & Booking

**Bookings, payments and WhatsApp reminders that bring barbershop customers back.**

A multi-salon SaaS for barbing salons: customers book from their phone in under a minute, staff run the day from one app, and the owner sees who is due back, with an AI writing assistant that never sends anything without approval.

[![CI](https://github.com/dajuctech/salon-retention/actions/workflows/ci.yml/badge.svg)](https://github.com/dajuctech/salon-retention/actions/workflows/ci.yml)
[![CodeQL](https://github.com/dajuctech/salon-retention/actions/workflows/codeql.yml/badge.svg)](https://github.com/dajuctech/salon-retention/actions/workflows/codeql.yml)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Tests](https://img.shields.io/badge/tests-302_passing-2ea44f)
![Lighthouse](https://img.shields.io/badge/Lighthouse-performance_100_·_accessibility_100-2ea44f?logo=lighthouse&logoColor=white)

</div>

## Screenshots

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/01-booking.png" width="220" alt="Customer booking page"><br><sub><b>Customer books</b> in four steps, no account</sub></td>
    <td align="center"><img src="docs/screenshots/02-confirmed.png" width="220" alt="Booking confirmed"><br><sub><b>Confirmed</b>, with WhatsApp reminders and pay-online</sub></td>
    <td align="center"><img src="docs/screenshots/03-dashboard.png" width="220" alt="Owner dashboard"><br><sub><b>Owner's day</b> at a glance</sub></td>
    <td align="center"><img src="docs/screenshots/04-approvals.png" width="220" alt="Win-back approvals"><br><sub><b>Win-backs</b>: owner approves, with "why now"</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/06-calendar.png" alt="Staff calendar with drag-to-reschedule"><br><sub><b>Calendar</b>: day, week and month views, drag to reschedule, status and payment on every booking</sub></td>
    <td align="center"><img src="docs/screenshots/08-reports.png" alt="Reports"><br><sub><b>Reports</b>: revenue, return rate, no-shows, what messages brought back</sub></td>
  </tr>
</table>

## What it does

| For | Features |
|---|---|
| **Customers** | Book a service, barber and time from the salon's link in under a minute; WhatsApp confirmation and reminders; reschedule, cancel or pay online from their own link; opt out with "STOP" |
| **Receptionists and barbers** | Walk-ins recorded in seconds, calendar (day / week / month, drag to reschedule), payments by cash, transfer, POS or online link, WhatsApp inbox, loyalty punch card |
| **Owners** | Dashboard, reports, win-back and offer campaigns they approve before sending, staff roles and invitations, opening hours with breaks, payouts straight to their own Paystack or Stripe account |

## What this project demonstrates

- **Multi-tenant data isolation in two layers.** Every query goes through a tenant-scoped client ([`forSalon()`](src/server/db.ts)), and database triggers refuse any row that links one salon's data to another's ([migration](prisma/migrations/20261016223116_same_salon_triggers/migration.sql)). Proven by [cross-tenant tests](src/server/db.int.test.ts).
- **No double bookings, even under a race.** A PostgreSQL exclusion constraint guarantees it; a browser test has two customers grab the same slot at once ([test](e2e/full-flow.spec.ts)).
- **Messaging you can trust.** The `Message` table is the job queue; the [dispatcher](src/server/platform/dispatcher.ts) claims work with `FOR UPDATE SKIP LOCKED`, idempotency keys prevent duplicates, and consent, quiet hours, weekly limits and booking state are re-checked at send time.
- **Payments done properly.** Only signed provider webhooks mark a booking paid, processed idempotently; money settles to each salon's own account (Paystack subaccounts, Stripe Connect), never the platform's ([providers](src/server/payments/providers.ts)).
- **Responsible AI.** The model only drafts wording. Code [guardrails](src/domain/ai-guardrails.ts) check every draft, the owner approves, no customer data is sent, there's a monthly budget, an [eval suite](evals/) with adversarial cases, a production quality report with drift alerts, and a [model card](docs/ai-model-card.md).
- **Security and privacy by default.** Server-side permission checks per role, real 404s for forbidden pages, two-step sign-in, bot protection and rate limits, personal data redacted from logs, error reporting configured to collect none, and an automatic [data retention job](src/server/platform/retention.ts).
- **Tested at every level, on every push.** Unit, integration (real PostgreSQL), browser tests on three engines, accessibility, performance budget, CodeQL and secret scanning in [CI](.github/workflows/ci.yml).

### Quality at a glance

| | |
|---|---|
| Unit tests | **160**, 95% coverage of business rules |
| Integration tests (real PostgreSQL) | **62**: tenant isolation, double booking, payments, retention, AI feedback loop |
| Browser tests | **80** across Chromium (Android-sized), WebKit (iPhone) and desktop, with automated accessibility checks |
| Booking page on a throttled slow-4G phone | Main content in **1.5 s**, 142 KB of JavaScript, Lighthouse performance **100**, accessibility **100** |
| Load (one server process) | p95 of **140–200 ms** on the dashboard and calendar with 10 users hitting it non-stop |
| Security | CodeQL, gitleaks secret scanning, dependency audit: **0 known vulnerabilities** |

## Architecture

```mermaid
flowchart TB
    C["📱 Customer<br/>booking page"] --> PX
    S["💈 Staff app<br/>phone · tablet · laptop"] --> PX

    subgraph APP["Next.js 16 app"]
        direction TB
        PX["proxy.ts<br/>real 404s · request ids"] --> UI["Pages · server actions · webhooks"]
        UI --> SV["src/server<br/>forSalon() · assertCan()"]
        JOBS["Cron jobs<br/>dispatcher · daily · retention"] --> SV
        SV --> DM["src/domain<br/>pure business rules"]
    end

    SV --> DB[("PostgreSQL<br/>exclusion constraint · same-salon triggers")]
    SV <-->|"API calls · signed webhooks"| EXT

    subgraph EXT["Outside services"]
        direction LR
        WA["WhatsApp<br/>Cloud API"]
        PAY["Paystack<br/>Stripe"]
        AI["LLM +<br/>guardrails"]
        EM["Email"]
        SEN["Sentry<br/>errors, no personal data"]
    end
```

Business rules live in `src/domain` as pure TypeScript (no framework or database imports, enforced by lint), so they're fast to test. Architecture decisions are recorded in [docs/adr/](docs/adr/).

## Tech stack

| Area | Tools |
|---|---|
| App | Next.js 16 (App Router, server actions, partial prerendering), React 19, TypeScript (strict), Node.js 24 |
| UI | Tailwind CSS 4, Lucide icons, own component set, mobile-first and accessible |
| Data | PostgreSQL 17, Prisma 7, Zod validation, libphonenumber-js, date-fns with time zones |
| Auth | Better Auth: email + password, one-time email codes, two-step sign-in (authenticator app) |
| Integrations | WhatsApp Cloud API, Paystack, Stripe Connect, Resend email, an LLM via its official SDK |
| Observability | Structured JSON logs with redaction, request ids, Sentry |
| Testing | Vitest, Playwright, axe-core, Lighthouse CI, custom load test and restore drill |
| CI/CD | GitHub Actions, CodeQL, gitleaks, pnpm audit, Renovate; Vercel + Neon for hosting |

## Status

R1 MVP is feature-complete and tested. It runs locally with stand-ins for the outside services (WhatsApp in test mode, simulated payments and email). Next: connect a WhatsApp Business number and live payment accounts, deploy a public demo, then a pilot with real salons.

## Run it locally

Requirements: Node 24 (see `.nvmrc`; `nvm use` picks it up), pnpm 10, Docker Desktop.

```bash
pnpm install                  # dependencies + Prisma client
cp .env.example .env          # first time only; then set the three *_SECRET values
cp .env.example .env.local    #   (openssl rand -base64 32)
docker compose up -d db       # Postgres on port 5433
pnpm db:deploy                # apply migrations
pnpm db:seed                  # demo salon "Sharp & Co." with months of history
pnpm dev
```

| Open | What |
|---|---|
| http://localhost:3000/sharpandco | Customer booking page |
| http://localhost:3000/login | Staff app |

**Demo logins** (password `demo-password-123`, development only):

| Email | Role |
|---|---|
| owner@sharpandco.test | Owner: everything, including approvals, reports and settings |
| reception@sharpandco.test | Receptionist: bookings, walk-ins, payments, inbox |
| tunde@sharpandco.test | Barber: own schedule and customers, no phone numbers |

**Local stand-ins for production services:**
- **Scheduled jobs:** production runs them via Vercel Cron (`vercel.json`). Locally, run `pnpm jobs`, or use **WhatsApp → Developer tools → Run message jobs now**.
- **WhatsApp:** `MESSAGING_PROVIDER=console` logs messages to the terminal. Numbers ending in `0000` simulate "not on WhatsApp", so you can try the Failed → Fix number path. **Developer tools → Simulate a customer reply** tests the inbox and STOP handling.
- **Email** (invitations, sign-in codes, password reset): printed to the terminal (`EMAIL_TRANSPORT=console`).
- **Online payments:** `PAYMENTS_MODE=fake` (the default outside production) simulates everything. **Settings → Payments** connects a payout account (Paystack: choose "Test Bank A" and any account number; Stripe: "Set up Stripe" comes straight back as connected), and payment links open a simulated checkout at `/pay/fake/…`. The demo salon is already connected. Real Paystack/Stripe keys are not yet tested (see [ADR-0006](docs/adr/0006-payments.md)).
- **Two-step sign-in:** turn it on under **More → Two-step sign-in** with any authenticator app. Save the backup codes it shows.
- **Bot protection** on the booking page: a hidden form field, a minimum fill time (2 s) and limits per IP and per phone. `BOOKING_LIMIT_PER_IP` (default 20 an hour) is raised in `.env` for local testing.
- **AI suggestions:** `AI_PROVIDER=fake` returns fixed drafts. Set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` to use the real model.

Stop with `Ctrl+C`, then `docker compose stop db`.

## Test

| Command | What it covers |
|---|---|
| `pnpm lint` · `pnpm typecheck` | Code quality and architecture import rules |
| `pnpm test` / `pnpm test:coverage` | Unit tests for business rules (≥ 90% `src/domain` coverage gate) |
| `pnpm test:int` | Integration tests against real Postgres. **They wipe tables, so use the test database:** `docker compose exec db createdb -U salon salon_test` once, then prefix both `pnpm db:deploy` and `pnpm test:int` with `DATABASE_URL=postgresql://salon:salon@localhost:5433/salon_test` |
| `pnpm test:e2e` | Browser tests (Chromium phone, WebKit iPhone, desktop) against `BASE_URL` (default `pnpm dev`). Run `pnpm db:seed` first. The first time, also run `pnpm exec playwright install chromium webkit`. For a production-like run, see the CI "Browser tests" step: `pnpm build && pnpm start` with `PAYMENTS_MODE=fake ALLOW_DEV_TOOLS=true` |
| `pnpm evals` | AI eval harness. `AI_PROVIDER=anthropic pnpm evals --gate` calls the paid API |
| `pnpm ai:report [days]` | AI quality in production per prompt and model (adoption, edits, guardrail failures, cost), with drift alerts |
| `pnpm load:test` | HTTP load test against `BASE_URL` (a production build with the demo seed), p95 against the budgets |
| `pnpm drill:restore` | Backup restore drill: dump, restore, check row counts and safety constraints |
| `npx @lhci/cli@0.15.1 autorun` | Lighthouse performance budget for the booking page (needs the app on port 3000) |

## Layout

```
src/domain/          Pure business rules (no Next.js/Prisma; lint-enforced)
src/server/          Data access (forSalon tenant scoping), authz, booking, consent, logging
src/server/auth/     Sign-in, sessions, page access rules
src/server/staff/    Staff operations + screen queries
src/server/platform/ Cross-salon jobs: dispatcher, daily jobs, data retention, webhooks, rate limits
src/server/payments/ Paystack / Stripe / simulated providers, salon payout accounts
src/server/ai/       AI provider interface, prompt, adapters
src/app/             Routes: /[slug] (customers), /login /signup /invite (auth), /app/* (staff), /api/*
src/proxy.ts         Runs before each request: real 404s, request ids
prisma/              Schema, migrations, seed
scripts/             Jobs, AI quality report, load test, restore drill
e2e/ · evals/        Browser tests · AI evals
```

## Rules of the road

How changes are made, reviewed and released: [CONTRIBUTING.md](CONTRIBUTING.md). What changed: [CHANGELOG.md](CHANGELOG.md). Reporting a security issue: [SECURITY.md](SECURITY.md).

- Every tenant query goes through `forSalon(salonId)` (ADR-0002). `salonId` comes from the session, never from a form.
- Every operation checks `assertCan()` on the server ([docs/permissions.md](docs/permissions.md)). Hiding a button is never enough.
- Messages are re-checked at send time: consent, quiet hours, frequency cap, booking still valid.
- Times are stored in UTC; calendar logic runs in the salon's timezone. Money is integer minor units.
- AI output never reaches a customer without code guardrails and the owner's approval.

---

<div align="center">

Built by **Jude Daniel** · [@dajuctech](https://github.com/dajuctech)

</div>
