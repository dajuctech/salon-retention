<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules

- Behaviour comes from `docs/user-stories.md` and `docs/business-rules.md` (`PRD.md`, if present, is the owner's private product document). Reference `BR-*` / `US-*` IDs in code comments and test names.
- `src/domain` is pure TypeScript: no Next.js, React, Prisma or `@/server` imports (ESLint enforces this).
- Tenant data is only accessed through `forSalon(salonId)` from `src/server/db.ts`. Never take `salonId` from a request body.
- Authorization goes through `assertCan()` in `src/server/authz.ts` (matrix: `docs/permissions.md`).
- Money is integer minor units plus a currency code; times are UTC with salon-local calendar logic (ADR-0008).
- Customer-facing messages use approved WhatsApp templates (`docs/whatsapp-templates.md`). AI output must pass `src/domain/ai-guardrails.ts` and owner approval.
- To change an architectural decision, add a new ADR in `docs/adr/`.
- Before finishing: `pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm test:int && pnpm build`.
