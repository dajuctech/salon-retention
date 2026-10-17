// Creating payment links for staff (US-17) and for customers on their booking page.
import { can } from "@/domain/permissions";
import { derivePaymentStatus } from "@/domain/payment-status";
import { audit } from "@/server/audit";
import { forSalon, type PublicSalon } from "@/server/db";
import { appUrl, manageLinkFor } from "@/server/messaging/queue";
import { fail, staffAudit, type StaffCtx } from "@/server/staff/context";
import { getPaymentProvider, onlinePaymentsReady, platformFee } from "./providers";
import { log } from "@/server/log";

async function linkFor(salon: PublicSalon, bookingId: string) {
  const db = forSalon(salon.id);
  const booking = await db.booking.findFirst({ where: { id: bookingId }, include: { payments: true, service: true, customer: true } });
  if (!booking) return fail("Booking not found.");
  if (booking.status === "CANCELLED" || booking.status === "NO_SHOW") return fail("This booking was cancelled or missed.");
  const provider = onlinePaymentsReady(salon) ? getPaymentProvider(salon.paymentProvider, appUrl()) : null;
  if (!provider || !salon.paymentProviderAccount) return fail("Online payments aren't set up for this salon.");
  const { balanceMinor } = derivePaymentStatus(booking.priceMinor, booking.payments);
  if (balanceMinor <= 0) return fail("This booking is already paid.");
  try {
    const link = await provider.createLink({
      bookingId: booking.id,
      amountMinor: balanceMinor,
      currency: booking.currency,
      description: `${booking.service.name} at ${salon.name}`,
      customerEmail: booking.customer.email,
      returnUrl: manageLinkFor(salon.slug, booking),
      account: salon.paymentProviderAccount,
      platformFeeMinor: platformFee(balanceMinor),
    });
    return { ok: true as const, value: { url: link.url, amountMinor: balanceMinor, customerPhone: booking.customer.phoneE164, bookingRef: booking.ref } };
  } catch (err) {
    log.error("payment.link_failed", err, { bookingId: booking.id, provider: provider.kind });
    return fail("The payment provider didn't respond. Please try again.");
  }
}

export async function createPaymentLinkForStaff(ctx: StaffCtx, bookingId: string) {
  const booking = await forSalon(ctx.member.salonId).booking.findFirst({ where: { id: bookingId }, select: { barberId: true } });
  if (!booking) return fail("Booking not found.");
  const own = ctx.member.barberId !== null && booking.barberId === ctx.member.barberId;
  if (!can(ctx.member.role, "payments.record", own)) return fail("You don't have permission to do that.");
  const result = await linkFor(ctx.salon, bookingId);
  if (result.ok) {
    await audit(forSalon(ctx.member.salonId), { ...staffAudit(ctx), action: "payment.link_created", entityType: "Booking", entityId: bookingId });
    // Barbers never see customer phone numbers.
    if (!can(ctx.member.role, "customers.viewPhone")) return { ok: true as const, value: { ...result.value, customerPhone: null } };
  }
  return result;
}

/** The customer's "Pay now" on their signed booking page. */
export async function createPaymentLinkForCustomer(salon: PublicSalon, bookingId: string) {
  return linkFor(salon, bookingId);
}
