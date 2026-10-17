# ADR-0009: Hosting and observability

- Status: Accepted
- Date: 2026-10-16

## Decision
- **Vercel** hosts the app and runs the cron jobs (Pro plan, for cron frequency and function duration). Separate production and preview environments; each preview uses its own database branch.
- **Neon Postgres**: database branches for previews and staging, point-in-time restore (see [operations.md](../operations.md)). Choose the region closest to users that both Vercel and Neon support.
- **Sentry** for errors and performance tracing on the server and in the browser. Personal data is scrubbed before events are sent.
- **Structured JSON logs** with `requestId`, `salonId` and `userId`, and **never** phone numbers, message text or customer names.
- **Uptime checks** on `/api/health` (database connectivity) and on how long ago the last dispatcher run happened.
- **Cloudinary** is deferred, because R1 stores no images.

## Alternatives considered
- **A self-managed VPS.** Cheaper at scale, but adds work for patching, TLS and backups. We can revisit after product–market fit.

## Consequences
The cost of each service grows with usage and is tracked in the project plan (a private planning document).
