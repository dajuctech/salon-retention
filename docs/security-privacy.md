# Security, Privacy and Compliance

## 1. Threat model (STRIDE summary)

| Asset / entry point | Threat | Mitigation |
|---|---|---|
| Tenant data | One salon reads another salon's data | `forSalon()` scoped client, `salonId` taken from the session only, cross-tenant tests, database triggers that reject links between salons; row-level security in R2 ([ADR-0002](adr/0002-multi-tenancy.md)) |
| Staff accounts | Credential stuffing; a former employee keeps access | Rate-limited login, breached-password check, session revocation when staff are deactivated, owner MFA (R1.1) |
| Barber role | A departing barber takes the client list | Barbers can't see phone numbers ([permissions.md](permissions.md)); exports restricted to owners and audit-logged |
| Public booking page | Spam bookings, harvesting phone numbers, enumeration | Rate limits per IP and per phone; bot challenge; the same response whether or not a phone number is already registered; unguessable IDs |
| Manage-booking links | Forged or reused links | HMAC-signed token tied to one booking and expiring after the appointment |
| Payment webhooks | Forged "paid" events | Signature check (Paystack `x-paystack-signature`, Stripe `Stripe-Signature`), idempotency on the provider reference, amount and currency re-checked against the booking |
| WhatsApp webhooks | Forged STOP or status events | Signature check (`X-Hub-Signature-256` / `X-Twilio-Signature`) |
| Cron endpoints | Anyone triggering a dispatch | `Authorization: Bearer ${CRON_SECRET}` check |
| AI | Prompt injection through owner-entered text; data leakage | No personal data sent to the model ([ai-design.md §4](ai-design.md#4-data-the-model-is-allowed-to-see)); output guardrails; the model has no tools or actions |
| Secrets | Leaked in the repo or in logs | Environment variables only, `.env*` in `.gitignore`, gitleaks secret scan in CI, log redaction |
| Dependencies | Supply-chain compromise | Lockfile, Renovate, `pnpm audit` in CI, pinned GitHub Actions |
| Web app | XSS, CSRF, injection | React escaping, a CSP header, SameSite cookies plus the framework's built-in CSRF protection for server actions, Prisma parameterised queries, zod validation at every boundary |

## 2. Controls checklist (must pass before GA)

- [ ] OWASP ASVS Level 1 self-assessment completed
- [ ] HTTPS only, HSTS, secure cookies (httpOnly, SameSite=Lax)
- [ ] Security headers: CSP, X-Content-Type-Options, Referrer-Policy, frame-ancestors 'none'
- [ ] Every server action and route handler validates input with zod and checks authorization
- [ ] Audit log covers every action in US-26
- [ ] Backups restored successfully in a drill ([operations.md](operations.md))
- [ ] Penetration test of the booking page and authentication (lightweight, external)

## 3. Privacy and compliance

The product is multi-market. **Each salon is the data controller and we are the data processor.** The Terms and the Data Processing Agreement must say this.

| Jurisdiction | Law | What we must do |
|---|---|---|
| Nigeria | Nigeria Data Protection Act 2023 (NDPA) and NDPC guidance | Lawful basis and consent records; data subject rights; breach notification to NDPC within 72 hours; check whether the platform must register as a "data controller/processor of major importance" |
| UK | UK GDPR, PECR | Lawful basis; PECR requires opt-in for marketing messages (BR-R1); records of processing; DPA with each salon |
| EU (if any) | GDPR | Same as UK, plus safeguards for transfers outside the EU |
| Ghana / Kenya / South Africa (Paystack markets) | Data Protection Act 2012 / Data Protection Act 2019 / POPIA | Review before launching in each country |

Product features that support compliance: separate consent for utility and marketing messages, with timestamp, source and the wording shown (BR-R1); one-step opt-out (BR-R2); export and deletion (US-27); minimal data collection (no birth year); retention rules (below).

**WhatsApp Business policy:** opt-in is required before business-initiated messages, along with honouring opt-outs and keeping messages relevant. Breaking these rules risks the number being restricted, which would stop messaging for every salon on the shared number. This is a business-critical risk.

## Retention

Enforced automatically by the retention job ([src/server/platform/retention.ts](../src/server/platform/retention.ts)), which runs with the hourly cron and is covered by integration tests.

| Data | Retention |
|---|---|
| Customer profile | While active; anonymised 24 months after the last visit, or when deletion is requested |
| Bookings and payments | 6 years (financial records), anonymised if the customer is deleted |
| Message log | Content 12 months; metadata 24 months |
| AIGeneration log | 12 months |
| Audit log | 24 months |
| Application logs | 30 days |

## 4. Sub-processors (to list publicly)

Vercel (hosting), Neon (database), Sentry (errors), Meta / Twilio (messaging), Paystack / Stripe (payments, accounts owned by each salon), and the AI provider. Record each one's data region and data-processing terms here once contracts are signed.

## 5. Incident response

1. Detect: Sentry, uptime alerts or a report.
2. Triage severity within 1 hour.
3. Contain: revoke keys, disable the feature flag, pause the dispatcher.
4. Assess personal-data impact.
5. Notify affected salons. If personal data is involved, help them notify the regulator within 72 hours.
6. Write a post-mortem within 5 working days.
