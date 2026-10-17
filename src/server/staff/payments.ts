// Payments (US-16, BR-P1, BR-P2) and loyalty redemption (US-29, BR-L1–L4).
import { loyaltyStatus } from "@/domain/loyalty";
import { derivePaymentStatus } from "@/domain/payment-status";
import { audit, type DbLike } from "@/server/audit";
import { assertCan } from "@/server/authz";
import { forSalon } from "@/server/db";
import { fail, ok, staffAudit, type StaffCtx } from "./context";

export type ManualMethod = "CASH" | "TRANSFER" | "POS" | "CARD";

async function paymentSummary(db: DbLike, booking: { id: string; priceMinor: number }) {
  const rows = await db.payment.findMany({ where: { bookingId: booking.id }, select: { kind: true, amountMinor: true } });
  return derivePaymentStatus(booking.priceMinor, rows);
}

/** Inside an existing transaction (walk-in "paid now"). */
export async function recordPaymentTx(
  ctx: StaffCtx,
  tx: DbLike,
  booking: { id: string; priceMinor: number; currency: string },
  input: { method: ManualMethod; amountMinor: number; reference?: string },
) {
  const payment = await tx.payment.create({
    data: {
      salonId: ctx.member.salonId,
      bookingId: booking.id,
      kind: "PAYMENT",
      method: input.method,
      amountMinor: input.amountMinor,
      currency: booking.currency,
      reference: input.reference?.trim() || null,
      recordedById: ctx.member.userId,
    },
  });
  await audit(tx, {
    ...staffAudit(ctx),
    action: "payment.recorded",
    entityType: "Payment",
    entityId: payment.id,
    after: { bookingId: booking.id, method: input.method, amountMinor: input.amountMinor },
  });
  return payment;
}

export async function recordPayment(
  ctx: StaffCtx,
  bookingId: string,
  input: { method: ManualMethod; amountMinor: number; reference?: string },
) {
  const db = forSalon(ctx.member.salonId);
  const booking = await db.booking.findFirst({ where: { id: bookingId } });
  if (!booking) return fail("Booking not found.");
  assertCan(ctx.member, "payments.record", booking.barberId);
  if (booking.status === "CANCELLED" || booking.status === "NO_SHOW") return fail("This booking was cancelled or missed.");
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) return fail("Enter an amount above zero.");
  const { balanceMinor } = await paymentSummary(db, booking);
  if (balanceMinor === 0) return fail("This booking is already paid.");
  if (input.amountMinor > balanceMinor) return fail("That's more than the balance. Record the balance, or ask the owner to adjust the price.");
  await db.$transaction((tx) => recordPaymentTx(ctx, tx, booking, input));
  return ok;
}

/** BR-P2: corrections are new rows. Owner only. */
export async function refundPayment(ctx: StaffCtx, bookingId: string, amountMinor: number, reason: string) {
  assertCan(ctx.member, "payments.refund");
  const db = forSalon(ctx.member.salonId);
  const booking = await db.booking.findFirst({ where: { id: bookingId } });
  if (!booking) return fail("Booking not found.");
  const { paidMinor } = await paymentSummary(db, booking);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > paidMinor) return fail("Refund must be above zero and no more than was paid.");
  await db.$transaction(async (tx) => {
    const refund = await tx.payment.create({
      data: {
        salonId: ctx.member.salonId,
        bookingId,
        kind: "REFUND",
        method: "CASH",
        amountMinor,
        currency: booking.currency,
        reference: reason.trim().slice(0, 200) || null,
        recordedById: ctx.member.userId,
      },
    });
    await audit(tx, { ...staffAudit(ctx), action: "payment.refunded", entityType: "Payment", entityId: refund.id, after: { amountMinor, reason } });
  });
  return ok;
}

/** Loyalty stamps for a customer, always derived (BR-L4). */
export async function customerLoyalty(db: DbLike, customerId: string, threshold: number) {
  const [paidCompleted, redemptions] = await Promise.all([
    db.booking.count({ where: { customerId, status: "COMPLETED", redemption: null } }),
    db.loyaltyRedemption.count({ where: { customerId } }),
  ]);
  return loyaltyStatus(paidCompleted, redemptions, threshold);
}

/** US-29 AC3 / BR-L3: use a free cut on this booking. */
export async function redeemLoyalty(ctx: StaffCtx, bookingId: string) {
  if (!ctx.salon.loyaltyOn) return fail("Loyalty rewards are turned off.");
  const db = forSalon(ctx.member.salonId);
  const booking = await db.booking.findFirst({ where: { id: bookingId }, include: { service: true, redemption: true } });
  if (!booking) return fail("Booking not found.");
  assertCan(ctx.member, "loyalty.redeem", booking.barberId);
  if (booking.redemption) return fail("A free cut was already used on this booking.");
  if (!booking.service.loyaltyReward) return fail(`${booking.service.name} isn't a loyalty reward service.`);
  const status = await customerLoyalty(db, booking.customerId, ctx.salon.loyaltyThreshold);
  if (!status.rewardAvailable) return fail(`Not yet: ${status.stamps} of ${status.threshold} visits.`);
  const { balanceMinor } = await paymentSummary(db, booking);
  if (balanceMinor === 0) return fail("This booking is already paid.");

  await db.$transaction(async (tx) => {
    const redemption = await tx.loyaltyRedemption.create({
      data: { salonId: ctx.member.salonId, customerId: booking.customerId, bookingId, createdById: ctx.member.userId },
    });
    await tx.payment.create({
      data: {
        salonId: ctx.member.salonId,
        bookingId,
        kind: "PAYMENT",
        method: "LOYALTY",
        amountMinor: balanceMinor,
        currency: booking.currency,
        recordedById: ctx.member.userId,
      },
    });
    await audit(tx, { ...staffAudit(ctx), action: "loyalty.redeemed", entityType: "LoyaltyRedemption", entityId: redemption.id });
  });
  return ok;
}
