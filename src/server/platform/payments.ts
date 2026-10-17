// Records an online payment from a verified provider event (BR-P3). Runs outside any staff session
// (webhooks), so it looks the booking up across salons, then works only within that salon.
import { derivePaymentStatus } from "@/domain/payment-status";
import { forSalon, unscopedDb } from "@/server/db";
import type { PaymentEvent, ProviderKind } from "@/server/payments/providers";
import { log } from "@/server/log";

export type RecordResult = "recorded" | "duplicate" | "rejected";

export async function recordOnlinePayment(provider: ProviderKind, event: PaymentEvent): Promise<RecordResult> {
  const booking = await unscopedDb().booking.findUnique({
    where: { id: event.bookingId },
    include: { payments: true, salon: { select: { paymentProviderAccount: true } } },
  });
  if (!booking) {
    log.error("payment.unknown_booking", undefined, { provider, bookingId: event.bookingId, reference: event.reference });
    return "rejected";
  }
  if (booking.currency !== event.currency || !Number.isInteger(event.amountMinor) || event.amountMinor <= 0) {
    log.error("payment.rejected", undefined, { provider, reference: event.reference, amountMinor: event.amountMinor, currency: event.currency, bookingCurrency: booking.currency });
    return "rejected";
  }
  // The signature proves the provider took the money, so it is always recorded. If it didn't land in
  // the salon's current account (e.g. the salon reconnected), the owner is told to check.
  const wrongAccount = provider !== "FAKE" && event.account !== booking.salon.paymentProviderAccount;
  if (wrongAccount) log.error("payment.account_mismatch", undefined, { provider, reference: event.reference, paidTo: event.account, salonAccount: booking.salon.paymentProviderAccount });
  const db = forSalon(booking.salonId);
  try {
    await db.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          salonId: booking.salonId,
          bookingId: booking.id,
          kind: "PAYMENT",
          method: "ONLINE",
          amountMinor: event.amountMinor,
          currency: event.currency,
          provider,
          providerReference: event.reference,
        },
      });
      const after = derivePaymentStatus(booking.priceMinor, [...booking.payments, payment]);
      await tx.auditLog.create({
        data: {
          salonId: booking.salonId,
          actorId: null,
          actorType: "system",
          // Money already received is always recorded; an overpayment is flagged for the owner.
          action: after.paidMinor > booking.priceMinor ? "payment.overpaid" : "payment.online_received",
          entityType: "Payment",
          entityId: payment.id,
          after: { provider, reference: event.reference, amountMinor: event.amountMinor, account: event.account },
        },
      });
      if (wrongAccount) {
        await tx.auditLog.create({
          data: {
            salonId: booking.salonId,
            actorId: null,
            actorType: "system",
            action: "payment.account_mismatch",
            entityType: "Payment",
            entityId: payment.id,
            after: { paidTo: event.account, salonAccount: booking.salon.paymentProviderAccount },
          },
        });
      }
    });
    return "recorded";
  } catch (err) {
    // Providers retry webhooks: the unique (provider, reference) makes the second one a no-op.
    if (String(err).includes("Unique constraint") || JSON.stringify(err).includes("P2002")) return "duplicate";
    throw err;
  }
}

/** Stripe `account.updated`: a salon finished (or lost) its ability to take charges. */
export async function updateConnectedAccount(provider: ProviderKind, account: string, ready: boolean): Promise<boolean> {
  const salon = await unscopedDb().salon.findFirst({ where: { paymentProvider: provider, paymentProviderAccount: account }, select: { id: true, paymentAccountReady: true } });
  if (!salon) return false;
  if (salon.paymentAccountReady !== ready) {
    const db = forSalon(salon.id);
    await db.salon.update({ where: { id: salon.id }, data: { paymentAccountReady: ready } });
    await db.auditLog.create({
      data: { salonId: salon.id, actorId: null, actorType: "system", action: ready ? "payment_account.ready" : "payment_account.restricted", entityType: "Salon", entityId: salon.id, after: { account } },
    });
  }
  return true;
}
