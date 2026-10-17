# Security policy

## Reporting a vulnerability

Please email the maintainers privately (address to be added before launch) with steps to reproduce. Don't open a public issue. We aim to reply within 2 working days and to fix critical issues within 7 days.

## What we protect

Salon and customer data (names, WhatsApp numbers, visit and payment history), staff accounts, and salons' payout accounts. The threat model, data-protection rules and retention periods are in [docs/security-privacy.md](docs/security-privacy.md).

## Built-in protections

- Tenant isolation in code (`forSalon()`) and in the database (same-salon triggers).
- Server-side permission checks on every operation; real 404s for pages a role can't open.
- Two-step sign-in for staff; passwords checked against known breaches in production.
- Signed webhooks only (payments, WhatsApp); idempotent processing.
- Bot protection and rate limits on the public booking page.
- No personal data in logs or error reports; Sentry configured to collect none.
- Automated checks in CI: dependency audit, secret scanning (gitleaks), CodeQL.

## Not yet done (before launch)

An independent penetration test, and a review of the data-protection position in each launch country.
