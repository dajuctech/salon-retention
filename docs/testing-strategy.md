# Testing Strategy

## Test pyramid

| Layer | Tool | Scope | Runs |
|---|---|---|---|
| Unit | Vitest | `src/domain/*`: slot calculation, booking state machine, reminder eligibility and suppression, frequency caps, quiet hours, payment status calculation, phone normalisation, AI guardrails | Every PR (< 30 s) |
| Integration | Vitest + real Postgres (Docker locally, service container in CI) | Prisma queries, tenant isolation, exclusion constraint against double booking, dispatcher claiming rows (`SKIP LOCKED`), webhook handlers with signed sample payloads | Every PR |
| Contract | Vitest with mocked `fetch` and signed sample payloads | WhatsApp, Paystack and Stripe adapters: request shape, signature checks, webhook parsing | Every PR |
| End-to-end | Playwright: Chromium phone, WebKit iPhone, desktop Chrome | Online booking, walk-ins, staff flows, opt-out, payments and payout accounts, two-step sign-in, calendar views, 404s, bot protection | Every PR, against a production build in CI |
| Accessibility | @axe-core/playwright, plus Lighthouse's accessibility score ≥ 95 | Booking, confirmation and main staff screens | Every PR |
| Performance | Lighthouse CI ([lighthouserc.json](../lighthouserc.json)), real slow-4G throttling; the report is kept as a CI artifact | Public booking page: LCP < 2.5 s, JS < 150 KB, accessibility ≥ 95 (NFR-P1) | Every PR |
| AI evals | `evals/` runner | Guardrail pass rate, invented-offer check, rubric sample | Offline on every PR; real model (`ai-evals` job) on PRs that touch AI code; weekly `pnpm ai:report` in production |
| Load | `pnpm load:test` ([scripts/load-test.ts](../scripts/load-test.ts)) | Booking page (slot queries) and staff pages, p95 against budgets (NFR-P2, NFR-S1). Dispatcher throughput: still to add | Before each release, against staging |
| Recovery | `pnpm drill:restore` ([scripts/restore-drill.sh](../scripts/restore-drill.sh)) | Dump, restore, check row counts and safety constraints | Quarterly |
| Manual / exploratory | Checklist | Real WhatsApp delivery on a test number, low-end Android device, 3G throttling, Samsung Internet, screen reader on the booking flow | Before each release |

## Rules

- Time-dependent logic receives a `now` value (or clock) as input, so tests are deterministic. There are tests for DST changes in `Europe/London` (reminders and slots), for 29 February birthdays, and for times around midnight in the salon's timezone.
- Every business rule (`BR-*`) has at least one test whose name includes the rule ID.
- Every feature includes a cross-tenant test (see the Definition of Done).
- Tests never call external providers. Adapters are tested with fixtures. A small set of opt-in "live" tests runs manually against sandbox accounts.
- Coverage gate: `src/domain` ≥ 90% lines. There's no global coverage target, to avoid tests written just to raise the number.

## Environments

| Environment | Database | Messaging | Payments | AI |
|---|---|---|---|---|
| Local | Docker Postgres | Console adapter (logs only) | Fake adapter | Fake adapter (fixtures) or a real key if set |
| Preview (each PR) | Neon branch | Console adapter | Provider sandbox | Fake adapter |
| Staging | Neon staging branch | Meta test number | Provider sandbox | Real (low cap) |
| Production | Neon main | Meta production | Live | Real |
