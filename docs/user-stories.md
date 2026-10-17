# User Stories — R1 MVP

Format: *As a [role], I want [goal] so that [benefit].* Acceptance criteria (AC) are written so they can be tested. `BR-*` points to [business-rules.md](business-rules.md). Priorities: **M** = Must, **S** = Should, **C** = Could.

## Definition of Done (applies to every story)

- Every AC is covered by an automated test (unit, integration or end-to-end, as appropriate), and CI passes.
- Tenant isolation is tested: a user from salon A cannot read or change salon B's data through this feature.
- Permissions follow [permissions.md](permissions.md), and there is a test for a forbidden role.
- Loading, empty and error states are built. The screen works at 360px width and is keyboard-accessible.
- Sensitive actions write to the audit log.
- Any new environment variables are documented in `.env.example`, and docs are updated.
- The change has been reviewed in a PR by someone else (or a self-review checklist was completed if working solo), and deployed to staging.

---

## Onboarding and staff

**US-01 (M) Salon sign-up.** As an owner, I want to create my salon so that I can start using the system.
- AC1: Sign-up collects: owner name, email, password, salon name, country, timezone (pre-filled from the country), currency (pre-filled from the country).
- AC2: A URL-safe, unique `slug` is generated for the public booking page and can be edited.
- AC3: The owner becomes the `OWNER` member of the new salon.

**US-02 (M) Opening hours.** As an owner, I want to set opening hours per weekday, plus closed dates, so that customers can only book when we're open.
- AC1: Hours are entered per weekday, with more than one time range allowed (e.g. a lunch break).
- AC2: A closed date removes all slots on that date (BR-A1).

**US-03 (M) Invite staff.** As an owner, I want to invite staff by email with a role so that they can log in.
- AC1: Roles are `OWNER`, `RECEPTIONIST` and `BARBER`. Invitations expire after 7 days.
- AC2: An accepted invitation links the user to the salon. A user can belong to more than one salon.

**US-04 (M) Deactivate staff.** As an owner, I want to deactivate a staff member so that a former employee loses access straight away.
- AC1: A deactivated user's sessions for that salon are revoked.
- AC2: Their past bookings stay, and their future bookings are flagged for reassignment.

**US-05 (M) Services.** As an owner, I want to manage services (name, duration, buffer, price, active) so that bookings use the right times and prices.
- AC1: Price is stored in minor units in the salon's currency (BR-M1).
- AC2: An optional default return interval per service is used for customers with fewer than 3 visits (BR-R3a).

**US-06 (M) Barber availability.** As an owner or barber, I want to set working hours and time off so that customers can't book me when I'm unavailable.
- AC1: Weekly hours plus time-off ranges.
- AC2: If new time off overlaps existing bookings, those bookings are listed for staff to act on.

## Customers

**US-07 (M) Customer profile.** As a receptionist, I want to create and edit customers so that we have a record of them.
- AC1: Name and phone are required. Phone is normalised to E.164 and must be valid (BR-I1).
- AC2: Optional fields: email, birthday (day and month only), preferred barber, preferred style, notes.
- AC3: The profile shows visits, payments, messages and current consent status.

**US-08 (M) Duplicate prevention.** As a receptionist, I want the system to find existing customers by phone so that we don't create duplicates.
- AC1: Entering a phone number that already exists opens that customer (BR-I2).
- AC2: Two customers can be merged. Bookings, payments, messages and consent move to the customer being kept, and the merge is audit-logged.

**US-09 (M) Walk-in quick capture.** As a receptionist, I want to record a walk-in in 10 seconds or less so that every visit is captured.
- AC1: One screen with: phone number (look-up as you type), name (only if the customer is new), service, barber, and a "paid now" toggle with payment method.
- AC2: Creates the customer if needed, a booking (`source = WALK_IN`, BR-A6) and optionally a payment.
- AC3: Has consent tick-boxes (not pre-ticked), each with a short script the receptionist can read out.
- AC4: In usability tests, the median time to complete is 10 seconds or less (see the usability test script, a private research document).

## Booking

**US-10 (M) Public booking page.** As a customer, I want to book from my phone without creating an account so that it's quick.
- AC1: `/{slug}` shows the steps in order: service, then barber (or "any"), then date and slot, then name and phone, then consent, then confirm.
- AC2: Only valid slots are shown (BR-A1, BR-A4).
- AC3: If someone else takes the slot while the customer is booking, they see a clear message and other available slots (BR-A3).
- AC4: The page is protected from abuse with rate limiting per IP and phone number, plus a bot check.
- AC5: An unknown phone number creates a new customer; a known one reuses the existing customer (BR-I2).

**US-11 (M) Manage my booking.** As a customer, I want to cancel or reschedule using the link in my confirmation.
- AC1: The link is signed, specific to this booking, and expires after the appointment.
- AC2: It works up to `cancelCutoff` before the appointment (BR-B4).

**US-12 (M) Staff booking management.** As a receptionist, I want to create, confirm, reschedule and cancel bookings.
- AC1: Every action follows BR-B1 and BR-B6.
- AC2: An invalid status change is rejected with an explanation.

**US-13 (M) Complete or no-show.** As a receptionist or barber, I want to mark a booking completed or no-show so that the records and reminders are correct.
- AC1: Completing a booking updates visit stats, usual gap and loyalty stamps (BR-B5).
- AC2: No-show is only possible after the grace period (BR-B3).

**US-14 (M) Calendar.** As staff, I want day and week calendars per barber so that I can see the schedule.
- AC1: Filter by barber. A barber sees their own column by default.
- AC2: Bookings can be dragged to reschedule, with the same validation as US-12.
- AC3: Each booking shows its status and payment status.

**US-15 (C) Month view.** Calendar month view with booking counts per day.

## Payments

**US-16 (M) Record payment.** As a receptionist, I want to record a payment with method and reference so that revenue is tracked.
- AC1: Methods: cash, bank transfer, POS, card, online.
- AC2: Payment status is calculated (BR-P1). Records can't be edited; refunds are separate records (BR-P2).

**US-17 (S) Payment link.** As a receptionist, I want to send a payment link so that a customer can pay online.
- AC1: Uses the salon's configured provider (Paystack or Stripe).
- AC2: The booking is marked paid only after a webhook with a verified signature, processed idempotently (BR-P3).

## Consent and messaging

**US-18 (M) Capture consent.** As staff (or a customer on the booking page), I want to record utility and marketing consent separately, with timestamp and source.
- AC1: Neither box is pre-ticked. The wording shown is stored with each consent record.
- AC2: On the booking page, utility consent is given by a clear notice next to the WhatsApp field ("Booking details and reminders arrive on WhatsApp"). Marketing consent is a separate, optional checkbox ("Send me occasional offers and a nudge when I'm due"). Booking works without it.

**US-19 (M) Opt-out.** As a customer, I want to reply STOP to stop marketing messages.
- AC1: The inbound webhook processes STOP within 1 minute and sends one confirmation reply (BR-R2).
- AC2: Messages already queued are blocked when they come up for sending.

**US-20 (M) Booking confirmation** is sent automatically when a booking is created or confirmed (utility template, includes the manage link).

**US-21 (M) Appointment reminders.** The day-before reminder and the 2-hour reminder are sent according to BR-R4. Each can be turned on or off in WhatsApp settings.

**US-22 (M) Win-back approval queue.** As an owner, I want to review the customers who are due back and approve messages quickly so that customers return without me writing each message.
- AC1: The queue lists `DRAFT` win-back messages created by BR-R3b. Each shows the customer, a "Why now" reason generated by code, the template variant, and an exact WhatsApp preview with the customer's details filled in.
- AC2: The variant chips (Friendly / Short / With offer) switch between approved template variants. "With offer" is disabled, with an explanation, when no promotion is active.
- AC3: Approve, Schedule (choose a time within quiet hours), and Skip for each draft; **Approve all** for the whole queue, with a confirmation showing the count and estimated cost (BR-PR3).
- AC4: Approving re-checks eligibility (BR-R3c). Drafts that are no longer valid are skipped, and the reason is shown.
- AC5: Text can't be typed freely for each customer. "Edit wording" opens the template editor (with the AI copy assistant, US-30), and a new wording becomes a new template version that needs Meta approval.

**US-23 (M) Birthday message** is sent automatically according to BR-R5. An offer is included only if a birthday promotion is active. The dashboard shows "Sends 09:00 ✓" (or "No consent") instead of manual send buttons.

**US-24 (M) Message log.** As an owner, I want to see every message with its status (`DRAFT`, `QUEUED`, `SENT`, `DELIVERED`, `READ`, `FAILED`, `SKIPPED`, plus the reason) so that I can trust the automation.
- AC1: Statuses are updated from provider webhooks.
- AC2: Failed messages appear under "Needs attention" and can be retried. `not_on_whatsapp` failures offer "Fix number" instead of "Retry" (BR-R9).

**US-28 (M) WhatsApp inbox.** As a receptionist, I want to see and answer customer replies so that no customer message is missed.
- AC1: Inbound messages appear in the WhatsApp tab, grouped by customer, with the number of unread conversations shown as a badge on the tab.
- AC2: Free-form reply is possible only within the 24-hour window. After that, only template replies are offered (BR-R10).
- AC3: A conversation can be marked handled. Messages from unknown numbers offer "Create customer".
- AC4: STOP or START messages show a system note ("Opted out of offers") (BR-R2).

**US-29 (S) Loyalty punch card.** As an owner, I want to reward regulars with a free cut after N visits so that customers keep coming back.
- AC1: Settings: on/off, threshold (default 10), reward services (BR-L2).
- AC2: The customer profile shows stamps (e.g. "8 of 10 cuts") and whether a reward is available.
- AC3: When recording payment, if a reward is available, staff can choose "Use free cut" (BR-L3). The redemption is audit-logged.
- AC4: The stamp count is calculated, never edited by hand (BR-L4).

## Reporting, audit and data rights

**US-25 (M) Dashboard.** As an owner, I want today's numbers at a glance.
- AC1: Shows today's bookings, upcoming bookings, customers due for a reminder, birthdays this week, revenue (today and this month), repeat-customer rate, and no-shows this month.
- AC2: Every number links to the list behind it.
- AC3: Barbers see only their own schedule widgets ([permissions.md](permissions.md)).

**US-26 (M) Audit log.** Sensitive actions are recorded: logins, role changes, consent changes, exports, deletions, payment records, status changes, promotion approvals.

**US-27 (M) Data rights.** As an owner, I want to export or delete a customer's data when they ask.
- AC1: Export produces a JSON file of the customer's profile, visits, payments, messages and consent history.
- AC2: Deletion removes or anonymises the customer's personal data (name, phone, notes, birthday). Financial records stay, anonymised, for the retention period (see [security-privacy.md](security-privacy.md)).

## AI

**US-30 (S) AI copy assistant.** As an owner, I want AI to suggest wording for a promotion or template so that I can write good messages quickly.
- AC1: The owner chooses a goal, tone, length and (optionally) a promotion. The AI returns up to 3 drafts.
- AC2: Drafts may contain only the allowed placeholders, such as `{{first_name}}`, `{{salon_name}}` and `{{offer}}`. Any discount comes from the selected promotion (see [ai-design.md](ai-design.md#guardrails)).
- AC3: Nothing is sent without the owner explicitly approving it. Every draft, the edits made and the final approved version are logged.
- AC4: If AI is unavailable or over budget, the owner can still write messages manually. The feature never blocks sending.

**US-31 (C) Weekly insight narration.** As an owner, I want a short weekly summary in plain language.
- AC1: The AI receives only aggregate numbers that have already been computed, never customer personal data.
- AC2: Every number in the summary must exist in the input; summaries that fail this check are discarded.
