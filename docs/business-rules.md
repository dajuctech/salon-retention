# Business Rules

These rules are the specification for the domain logic. Each rule has an ID (e.g. `BR-B3`) so code and tests can reference it. Where a value is configurable, the default is shown and it can be changed per salon.

## 1. Time, money, identity

- **BR-T1** All timestamps are stored in UTC. Display and scheduling use the salon's IANA timezone (e.g. `Africa/Lagos`, `Europe/London`).
- **BR-T2** "Day" boundaries (birthdays, "today's bookings", daily reports) are calculated in the salon's timezone.
- **BR-M1** Money is stored as integers in the currency's smallest unit (kobo, pence, cents), together with an ISO-4217 currency code. Never use floats.
- **BR-I1** Phone numbers are normalised to E.164 before saving, using the salon's country as the default region. Invalid numbers are rejected.
- **BR-I2** The pair (`salonId`, `phoneE164`) is unique. If someone enters a phone number that already exists, the existing customer is used and the new details are offered as updates (never silently overwritten).
- **BR-I3** Birthday is stored as month and day. The year is optional. Customers are never asked for their birth year.

## 2. Availability and slots

- **BR-A1** A slot is bookable only if all of these hold:
  - it is within the salon's opening hours
  - it is within the barber's working hours
  - the barber has no time off then
  - it doesn't overlap another booking for that barber.

  A booking blocks this period: `[start, start + service.duration + service.buffer)`.
- **BR-A2** Bookings with status `PENDING`, `CONFIRMED` or `IN_PROGRESS` block time. `CANCELLED` and `NO_SHOW` free the time. `COMPLETED` still blocks the time, since it is in the past.
- **BR-A3** Double booking is prevented in the database as well as in the UI. A Postgres exclusion constraint on (`barberId`, time range) for blocking statuses stops two simultaneous requests from both succeeding.
- **BR-A4** Online slots are offered on a grid (default 15 minutes), from `minLeadTime` (default 60 minutes) up to `maxAdvance` (default 30 days) ahead.
- **BR-A5** "Any barber" assigns the barber who is free and has the fewest bookings that day. Ties are broken by staff order.
- **BR-A6** Walk-ins are recorded as a booking created with status `IN_PROGRESS` (or `COMPLETED` if entered afterwards), `source = WALK_IN`. If the barber is busy, the walk-in still goes in, and the overlap is shown to staff as a warning instead of being blocked.

## 3. Booking lifecycle

```
PENDING ──confirm──▶ CONFIRMED ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
   │                     │                      │
   ├──cancel──▶ CANCELLED ◀──cancel──┤          └──cancel──▶ CANCELLED
   │                     │
   └──no-show──▶ NO_SHOW ◀──no-show──┘   (only after start time + grace period)
```

- **BR-B1** Only the transitions shown above are allowed (implemented in `src/domain/booking-status.ts`). Two **owner-only corrections** are also allowed for staff mistakes: `NO_SHOW → CONFIRMED` and `COMPLETED → IN_PROGRESS`. Every transition is written to the audit log with who made it and when; corrections are flagged.
- **BR-B2** Online bookings start as `PENDING` if the salon has `autoConfirm = false`, otherwise as `CONFIRMED` (default: `autoConfirm = true`).
- **BR-B3** `NO_SHOW` can only be set once start time + `noShowGrace` (default 15 minutes) has passed.
- **BR-B4** Customers can cancel or reschedule using a signed link in their confirmation, up to `cancelCutoff` (default 2 hours) before the appointment. After that, only staff can.
- **BR-B5** `COMPLETED` updates the customer's `lastVisitAt` and visit count, recalculates `usualGapDays` (BR-R3a), and adds a loyalty stamp (BR-L1). Pending win-back drafts for the customer are skipped.
- **BR-B6** Rescheduling keeps the same booking, re-checks availability (BR-A1), cancels pending reminders and schedules new ones.

## 4. Payments

- **BR-P1** Payment statuses are `UNPAID`, `PART_PAID`, `PAID` and `REFUNDED`. They are calculated from the booking price and the sum of payment records. They are not set by hand.
- **BR-P2** Payment records cannot be edited once saved. Corrections are new records (refund or adjustment) that point to the original.
- **BR-P3** Online payments are confirmed **only** by a payment-provider webhook whose signature has been verified. The redirect back to our site is never trusted. Webhooks are processed idempotently using the provider's reference.
- **BR-P4** Deposits (R1.1+): optional per service. If a booking was paid with a deposit and is cancelled after `cancelCutoff`, the salon keeps the deposit unless staff refund it.
- **BR-P5** We never store card details.

## 5. Messaging rules

- **BR-R1 Consent.** Every customer has two consent flags with timestamp and source: `utility` (needed for confirmations and appointment reminders) and `marketing` (needed for win-back, birthday messages and promotions). Consent is never pre-ticked.
- **BR-R2 Opt-out.** An inbound message matching `STOP`, `UNSUBSCRIBE` or a configured local-language equivalent revokes marketing consent immediately. `STOP ALL` also revokes utility consent. A staff member can also revoke consent. Before any message is sent, consent is checked again, so a message queued before the opt-out is still blocked.
- **BR-R3a Usual gap.** A customer's `usualGapDays` is the median number of days between their completed visits, using the last 6 gaps. With fewer than 2 gaps (fewer than 3 visits), the service's `returnReminderDays` is used (default 21; can be set per service). The value is limited to 7–90 days. Recalculated each time a booking is completed.
- **BR-R3b Due for win-back.** A customer is *due* when `today ≥ lastVisitAt + usualGapDays + graceDays` (`graceDays` default 7) **and** all of these hold:
  - they have no upcoming blocking booking,
  - they have marketing consent,
  - they had no win-back message in the last `winbackCooldownDays` (default 21).

  The daily job creates one `DRAFT` win-back message per due customer, using the salon's default win-back template variant and including a "Why now" reason generated by code (e.g. "Last visit 5 weeks ago. Usually every 3 weeks with Tunde.").
- **BR-R3c Win-back approval.** Drafts are sent only after an owner approves them, either one at a time or with "Approve all". Approving re-checks BR-R3b. A draft that is no longer valid is marked `SKIPPED` (e.g. the customer booked in the meantime). Drafts not approved within 7 days expire. An owner can switch the template variant (`friendly`, `short`, `with_offer`) for each draft. `with_offer` needs an active promotion (BR-PR2).
- **BR-R4 Appointment reminders.** Two utility reminders:
  - **Day-before**, at `dayBeforeHour` (default 18:00 salon time) on the day before the appointment.
  - **2-hour**, `shortReminderHours` (default 2) before the start.

  Either reminder is skipped if its send time is already past when the booking is made, or within 30 minutes of the booking being made. Each can be turned off per salon.
- **BR-R5 Birthday.** Sent on the birthday at 09:00 salon time. On 28 February in non-leap years, birthdays on 29 February are included. Any discount comes from a configured `Promotion` record, never from free text.
- **BR-R6 Frequency cap.** At most `marketingCapPerWeek` (default 2) marketing messages per customer in any 7 days, and at most 1 per day. If a message would exceed the cap, it is skipped and logged with the reason.
- **BR-R7 Quiet hours.** Marketing messages are only sent between 08:00 and 20:00 salon time. Anything due outside that window is moved to the next allowed time.
- **BR-R8 Idempotency.** Every outgoing message has a unique key: `{salonId}:{type}:{subjectId}:{dueDate}`. Retries and duplicate dispatcher runs can never send the same message twice.
- **BR-R9 Retries.** Temporary provider errors are retried with exponential backoff (1m, 5m, 30m, 2h), up to 4 attempts. After that the message is marked `FAILED` and shown on the dashboard. If the error says the number isn't on WhatsApp, there is no retry; the message is marked `FAILED` with reason `not_on_whatsapp`, and the customer is flagged with "Fix number".
- **BR-R10 Inbox.** Inbound customer messages are stored as `InboundMessage` records linked to the customer, matched by phone number. If no customer matches, the message is shown as "Unknown number" with a "Create customer" option. Staff can reply with free-form text only within 24 hours of the customer's latest inbound message; after that, the reply box offers approved templates only. Every conversation has a status, `OPEN` or `HANDLED`. Opt-out keywords (BR-R2) are processed automatically and also shown in the inbox.
- **BR-R11 Message text never promises a reply.** Templates point to the manage link for changes. Replies are still received in the inbox (BR-R10).

## 6. Segments (deterministic, not AI)

| Segment | Rule |
|---|---|
| New | First completed visit in the last 30 days |
| Due to return | `lastVisitAt + usualGapDays ≤ today` and no upcoming booking (BR-R3a) |
| Inactive | No completed visit in the last 45 days (configurable), with at least 1 visit ever |
| Loyal | ≥ 5 completed visits in the last 180 days |
| High value | Top 20% by total spend in the last 180 days |
| Frequent canceller | ≥ 2 cancellations or no-shows in the last 90 days |
| Birthday this week/month | Birthday falls in that period (salon timezone) |

## 7. Loyalty punch card

- **BR-L1** When a salon turns loyalty on, every `COMPLETED` booking with a price above 0 counts as one stamp. Free (reward) visits don't count.
- **BR-L2** After `loyaltyThreshold` stamps (default 10), the customer has one reward available: a free service, chosen from services the owner selects (default: the cheapest haircut). Rewards don't expire in R1.
- **BR-L3** A reward is used by staff when recording payment. A `LoyaltyRedemption` record is created, the booking is marked `PAID` with method `LOYALTY`, and the stamp count goes back to 0 (any stamps beyond the threshold carry over).
- **BR-L4** Stamp count is calculated from completed bookings and redemptions; there's no separate counter that could drift. If a booking stops being `COMPLETED`, the stamp is removed automatically.
- **BR-L5** Customers see their stamp count in booking confirmations only if the salon turns on the optional "loyalty line" in templates.

## 8. Promotions

- **BR-PR1** A promotion has: a type (percentage or fixed amount), a value, eligible services, a start and end date, and an optional usage limit per customer.
- **BR-PR2** Every offer mentioned in any message must refer to an active promotion. The message renderer adds the offer text from the promotion record (see [ai-design.md](ai-design.md#guardrails)).
- **BR-PR3** Before an owner approves a promotion send, the preview shows how many customers will receive it, how many are excluded for missing consent or the frequency cap, and an estimated messaging cost.
