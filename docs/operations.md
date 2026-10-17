# Operations

## Environments and release

- `main` deploys automatically to **staging**. Production deploys happen from tagged releases (`vX.Y.Z`), with manual approval in GitHub Environments.
- Database migrations: `prisma migrate deploy` runs in the release pipeline **before** traffic switches to the new version. Migrations must work with the previous version still running (expand, then contract), so the previous release can be rolled back.
- Feature flags (env-based in R1) control AI features, online payments and new message types for each salon.
- Rollback: in Vercel, "promote previous deployment". Migrations are never rolled back automatically.

## Backups and recovery

| Target | Value |
|---|---|
| RPO (maximum acceptable data loss) | ≤ 5 minutes (Neon point-in-time restore) |
| RTO (maximum time to recover) | ≤ 4 hours |
| Retention | 7 days point-in-time restore + a weekly logical dump kept for 90 days in separate storage |
| Restore drill | Quarterly: restore to a branch, run smoke tests, record the time taken |

## Monitoring and alerts

| Signal | Alert when |
|---|---|
| `/api/health` | 2 failures in a row |
| Dispatcher last run | No successful run for 15 minutes |
| Dispatcher lag | p95 `sentAt − scheduledFor` > 10 minutes (NFR-A2) |
| Message failure rate | > 5% over 1 hour, per salon or overall |
| Opt-out rate | > 2% of the marketing messages in one send |
| Payment webhook errors | Any signature failure; more than 3 processing errors per hour |
| Server errors | Any new Sentry issue; error rate > 1% of requests over 10 minutes |
| AI quality drift | `pnpm ai:report` exits with an error (weekly) |
| Payments landing in the wrong account | Any `payment.account_mismatch` audit entry |
| Salon payout account restricted | Any `payment_account.restricted` (Stripe paused the salon's account) |
| Error rate (Sentry) | New issue in production; error spike |
| AI spend | 80% of the platform's monthly budget |
| Meta number quality rating | Drops to "Medium" |

## Runbooks

### WhatsApp messages failing
1. Check the Sentry error and the `Message.failureReason`. Search the logs by `event` (e.g. `request.failed`) or by the `x-request-id` a user reports.
2. If the error comes from the provider (rate limit, template paused, quality rating), pause sending: for one salon, the owner (or support, with them) taps **WhatsApp → Pause all sending**, which shows a banner on every staff screen; for every salon, set `MESSAGING_PAUSED=true`. Messages stay queued.
3. If a template was paused or rejected, switch to the previous approved version, or edit and resubmit.
4. When resolved, unpause. The dispatcher sends anything that is still within its validity window. Expired reminders are marked `SKIPPED` with reason `expired`.

### Payment marked paid incorrectly, or missing
1. Find the payment by provider reference in the audit log.
2. Check it against the provider dashboard.
3. Correct it with an adjustment record (BR-P2); never edit the original.

### Suspected data leak between tenants
Treat this as a Severity 1 incident ([security-privacy.md §5](security-privacy.md#5-incident-response)). Disable the affected route with a flag, then preserve the logs.

### Monitoring the AI copy assistant (weekly)
Run `pnpm ai:report 7` against production. It exits with an error and prints ⚠ lines if the guardrail pass rate, error rate, usable-draft rate or latency drift past the eval thresholds. Any alert: re-run `pnpm evals --gate`, read the failing outputs in `AIGeneration`, and add regression cases ([ai-design.md §9](ai-design.md#9-monitoring-drift-and-re-evaluation)).

### Data retention
The retention job runs with the hourly cron (`/api/cron/daily`, idempotent) and logs `retention.done` with counts. A sudden large count (e.g. thousands of customers anonymised) means check the clock and the rules in [security-privacy.md](security-privacy.md#retention) before the next run.

### Restore drill (quarterly)
Production: restore a Neon branch to a point in time, run the smoke tests, record the time. Locally or on any Postgres: `pnpm drill:restore` dumps, restores into a fresh database, checks every table's row count, the double-booking constraint and the same-salon triggers, and reports the time. Last run: 2026-10-17, local, all checks passed in 1 s.

### Dispatcher stuck
Check Vercel Cron logs. Look for rows stuck in `SENDING` for more than 10 minutes; reset them to `QUEUED` (the idempotency key prevents duplicates).

## User training and support (before each salon goes live)

- A 30-minute onboarding call: walk-in capture, bookings, payments, reading the message log, approving promotions.
- One-page quick guides for receptionists and barbers (printable), plus 2-minute screen recordings.
- A support WhatsApp line, with a 1 working-day response target during the pilot.
