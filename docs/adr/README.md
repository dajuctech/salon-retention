# Architecture Decision Records

Each ADR records one decision: the context, the decision, the alternatives considered, and the consequences. Never rewrite an accepted ADR. To change a decision, write a new ADR that supersedes it.

| # | Decision | Status |
|---|---|---|
| [0001](0001-nextjs-monolith.md) | Single Next.js app (no separate backend) | Accepted |
| [0002](0002-multi-tenancy.md) | Shared-database multi-tenancy with `salonId` | Accepted |
| [0003](0003-auth.md) | Better Auth with the organization plugin | Accepted |
| [0004](0004-background-jobs.md) | Postgres outbox + cron dispatcher instead of BullMQ | Accepted |
| [0005](0005-whatsapp-provider.md) | WhatsApp provider interface; Meta Cloud API first | Accepted |
| [0006](0006-payments.md) | Manual payments in R1; Paystack and Stripe adapters | Accepted |
| [0007](0007-ai-provider.md) | Provider-agnostic AI interface, direct SDK calls, no framework | Accepted |
| [0008](0008-data-conventions.md) | Money, time and phone conventions | Accepted |
| [0009](0009-hosting-observability.md) | Vercel + Neon + Sentry | Accepted |

Template: copy [0000-template.md](0000-template.md).
