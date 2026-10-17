## What and why

<!-- What does this change, and which story or rule does it serve? e.g. US-14, BR-A3 -->

## How it was tested

- [ ] `pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm test:int && pnpm build` pass
- [ ] Browser tests pass (`pnpm test:e2e` against a production build) or aren't affected
- [ ] New behaviour has a test named with its `US-*` / `BR-*` ID

## Checklist (Definition of Done, docs/user-stories.md)

- [ ] Tenant data only through `forSalon()`; a cross-salon test exists for new data access
- [ ] Permissions checked on the server with `assertCan()` (docs/permissions.md)
- [ ] No personal data in logs (use `log` from `src/server/log.ts`)
- [ ] Database change: a **new** migration (never edit an applied one), expand-then-contract safe
- [ ] Architecture decision changed? New ADR in `docs/adr/`
- [ ] AI prompt, model or guardrail changed? `pnpm evals --gate` ran (the `ai-evals` job) and the prompt version was bumped
- [ ] User-facing change? `CHANGELOG.md` updated
