# ADR-0008: Data conventions — money, time, phone numbers, IDs

- Status: Accepted
- Date: 2026-10-16

## Decision
- **Money.** Integer amounts in the currency's smallest unit (kobo, pence, cents), stored together with an ISO-4217 `currency` code. Values from different currencies are never added together.
- **Time.** All database timestamps are `timestamptz` in UTC. Each salon has an IANA `timezone`, and all date logic tied to the local calendar (birthdays, "today", quiet hours) runs in that timezone. Durations are stored in minutes.
- **Phone numbers.** E.164 format, normalised with `libphonenumber-js`, using the salon's country as the default region. They are both the deduplication key and the messaging address.
- **Birthdays.** `birthMonth` and `birthDay` (both small integers); `birthYear` is optional.
- **IDs.** `cuid2` strings as primary keys. Sequential IDs are never shown publicly, so they can't be guessed.
- **Soft delete.** Customers are anonymised rather than deleted (to keep financial records). Other records use status fields. There is no generic `deletedAt`.
- **Locale.** UI text goes through `next-intl`. English is the only language in R1; others are added based on R0 research.

## Consequences
Prevents the common bugs: currency rounding errors, birthdays landing on the wrong day near midnight, and duplicate customers.
