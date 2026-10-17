# ADR-0002: Shared-database multi-tenancy

- Status: Accepted
- Date: 2026-10-16

## Context
The product is a multi-salon SaaS. Each salon's data must be completely isolated, at a cost that makes sense for many small tenants.

## Decision
- One Postgres database and one schema. Every table owned by a tenant has a non-null `salonId` foreign key, and every index or uniqueness rule starts with `salonId` (e.g. `@@unique([salonId, phoneE164])`).
- All tenant queries go through `forSalon(salonId)` in `src/server/db.ts`. It is a Prisma client extension that adds `salonId` to every query (`where`) and every insert (`data`). Running a raw `prisma` query against tenant tables outside this helper is blocked by a lint rule.
- `salonId` always comes from the authenticated session or the signed public slug, **never** from the request body.
- Postgres row-level security (RLS) is planned for R2, as a second layer of protection.
- Every feature includes a test that a user from another tenant is rejected (see the Definition of Done in [user-stories.md](../user-stories.md)).

## Alternatives considered
- **A schema or database per tenant.** Stronger isolation, but migrations and connection limits become expensive with hundreds of small salons.
- **Single-salon first.** Rejected by the product owner. Adding tenancy later would mean rewriting every query.

## Consequences
- Cheap to run, and analytics across salons are easy.
- One missed filter could leak data, so we rely on the helper, the lint rule, the cross-tenant tests and, later, RLS.
- **Known limits of `forSalon()`** (documented in `src/server/db.ts`):
  - Nested writes aren't scoped.
  - Foreign-key IDs supplied by a client (e.g. a `customerId` sent with a new booking) aren't checked against the tenant.

  Rule: always load referenced rows through `forSalon()` before using their IDs. Planned hardening for R2: composite foreign keys `(salonId, id)`, so the database rejects links between tenants, plus row-level security.
- Implemented and tested: `src/server/db.ts`, `src/server/db.int.test.ts`.

## Amendment (2026-10-16): database-level checks built
- The planned R2 hardening is in place, using triggers instead of composite foreign keys: migration `same_salon_triggers` adds `enforce_same_salon()`. On insert or update it rejects any row whose reference (customer, barber, service, booking, template, conversation, member) belongs to another salon, raising `cross_salon_reference`. Platform-wide templates (`salonId` null) are still allowed. Tests: `src/server/db.int.test.ts`.
- Triggers were chosen over composite keys because they needed no change to Prisma relations or application code. The cost is one indexed lookup per reference on write.
- Row-level security is still planned for R2.
