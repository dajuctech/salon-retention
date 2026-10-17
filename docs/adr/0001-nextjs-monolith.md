# ADR-0001: Single Next.js app

- Status: Accepted
- Date: 2026-10-16

## Context
v0 left the backend open: "Next.js API routes, or Express/NestJS". The team is small, and the MVP is mostly CRUD (create/read/update/delete screens), scheduling and webhooks.

## Decision
One Next.js (App Router) TypeScript app. UI, server actions, route handlers (webhooks, cron) and domain logic all live in one repo and are deployed together. Domain logic lives in `src/domain/`, which is plain TypeScript with no framework imports. Data access lives in `src/server/`. That way the logic could later move to a separate service without a rewrite.

## Alternatives considered
- **NestJS + separate frontend.** Gives clearer boundaries, but means two deployments, a shared-types problem and more setup. That isn't justified at MVP scale.
- **Express.** Same costs as NestJS, with less structure.

## Consequences
- Fast to build, with one deployment and one set of types.
- Long-running work can't run inside requests. Covered by [ADR-0004](0004-background-jobs.md).
- `src/domain` must not import Next.js or Prisma (enforced by an ESLint rule).
