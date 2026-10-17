# ADR-0004: Postgres outbox and cron dispatcher (supersedes the v0 BullMQ plan)

- Status: Accepted
- Date: 2026-10-16

## Context
v0 proposed BullMQ + Redis, hosted on Vercel. BullMQ needs a worker process that runs all the time, and Vercel only runs short serverless functions, so the two don't work together. Our job volume is small (reminders measured in minutes, not milliseconds), and each job needs to be checkable, idempotent and visible to the salon.

## Decision
- The `Message` table is the queue. Each row has `status`, `scheduledFor`, `attempts`, `nextAttemptAt` and a unique `idempotencyKey` (BR-R8).
- **Schedulers** create rows: when a booking is created or completed (reminders), and through a daily cron job (birthdays, win-back drafts, expiring drafts).
- **The dispatcher** is a route handler (`/api/cron/dispatch`) that Vercel Cron calls every 5 minutes. A shared secret authenticates it. It claims due rows with `SELECT … FOR UPDATE SKIP LOCKED` (so two runs never claim the same row), checks consent, the frequency cap and quiet hours again, sends, and records the result. Each run handles a limited batch, so it always finishes within the function time limit.
- Retries follow BR-R9.

## Alternatives considered
- **BullMQ on a Railway or Fly worker.** Works, but adds Redis plus a second deployment to run and monitor.
- **Inngest or Trigger.dev.** Good developer experience, but the queue state lives with a third party and gets billed per step. We can reconsider if job types multiply.
- **Upstash QStash.** A good fit for HTTP calls with delays, but we still need our own message state for the log and for idempotency.

## Consequences
- No Redis in R1. The message log and the queue are the same table, so they can't drift apart.
- Delivery can be up to 5 minutes late, which is acceptable for reminders.
- If volume grows past what one database-polling dispatcher can handle, move to a dedicated worker. That would be a new ADR.
