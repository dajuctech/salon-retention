# ADR-0006: Payments

- Status: Accepted
- Date: 2026-10-16

## Context
Most salon payments are cash, bank transfer or POS. Online payment matters less than recording payments accurately. The product is multi-market: Paystack covers Nigeria, Ghana, Kenya and South Africa; Stripe covers the UK and most of the world.

## Decision
- **R1 Must:** record payments manually. Payment records can't be edited once saved, and status is calculated from them (BR-P1, BR-P2).
- **R1 Should:** online payment links through a `PaymentProvider` interface, with **Paystack** and **Stripe** adapters. Each salon connects its own account (Paystack subaccount / Stripe Connect Standard), so the money goes directly to the salon and we never hold customer funds.
- Payments are confirmed only by a webhook with a verified signature, processed idempotently (BR-P3).
- Flutterwave is deferred. Add it if research shows demand.

## Alternatives considered
- **Platform-held funds with payouts.** Brings licensing and settlement responsibilities. Rejected.

## Consequences
- No card data ever touches our systems, which keeps our PCI scope minimal (SAQ A).
- Online payment can be left out of R1 without blocking launch.

## Amendment (2026-10-17): as built
- **Providers:** `PaymentProvider` with Paystack, Stripe and a Fake checkout (`src/server/payments/providers.ts`). Signature-checked webhooks at `/api/webhooks/payments/[provider]` are recorded idempotently by `(provider, providerReference)` (BR-P3). The currency must match, and overpayments are recorded and audited (`payment.overpaid`).
- **Each salon's own account** (`src/server/payments/accounts.ts`, Settings → Payments, owners only):
  - **Paystack:** the owner picks their bank and enters the account number. We create a subaccount, and every charge is initialised with `subaccount` and `bearer: "subaccount"`, so the money settles to the salon and the salon bears Paystack's fee. Paystack is offered only for NGN, GHS, KES and ZAR.
  - **Stripe:** Connect Standard. We create the account; the owner completes it on Stripe's pages and comes back to `/app/settings/stripe`. Checkouts are direct charges with the `Stripe-Account` header. `account.updated` on the Connect webhook endpoint (`STRIPE_CONNECT_WEBHOOK_SECRET`) turns payments on or off as Stripe enables or restricts the account.
  - Payment links are refused until the account is connected and ready (`onlinePaymentsReady`). Switching provider disconnects the old account. One account can belong to only one salon (unique index).
  - Our fee: `PLATFORM_FEE_PERCENT` (default 0, capped at 50%). It is Paystack `transaction_charge` or Stripe `application_fee_amount`, taken by the provider from the salon's payout.
  - A verified payment that landed in a different account than the salon's current one (e.g. an old link after reconnecting) is still recorded, because the money was taken, and flagged `payment.account_mismatch`.
  - The audit log stores the account label (bank, last 4 digits) only, never the full account number.
- **Test mode** (`PAYMENTS_MODE=fake`, the default outside production) simulates both onboarding flows and the checkout.
- **Not yet verified against the real APIs:** this needs Paystack and Stripe test keys. Before launch, run one real test-mode payment per provider, and configure both Stripe webhook endpoints (platform and Connect) with the `checkout.session.completed` and `account.updated` events.
