// Booking detail (UI_UX_DESIGN_PLAN §3.3) and the new-booking form data (§3.2).
import { onlinePaymentsReady } from "@/server/payments/providers";
import { allowedNextStatuses } from "@/domain/booking-status";
import { formatShortDate, formatTime } from "@/domain/format";
import { can } from "@/domain/permissions";
import { forSalon } from "@/server/db";
import { STAFF_RULES, upcomingDays } from "@/server/slots";
import type { StaffCtx } from "../context";
import { customerLoyalty } from "../payments";
import { typeLabel } from "./dashboard";
import { paymentState } from "./common";

export async function bookingDetail(ctx: StaffCtx, id: string) {
  const { member, salon } = ctx;
  const db = forSalon(member.salonId);
  const b = await db.booking.findFirst({
    where: { id },
    include: { customer: true, service: true, barber: true, payments: { orderBy: { createdAt: "asc" } }, messages: { orderBy: { scheduledFor: "asc" } }, redemption: true },
  });
  if (!b) return null;
  const own = member.barberId !== null && b.barberId === member.barberId;
  if (member.role === "barber" && !own) return null;
  const tz = salon.timezone;
  const pay = paymentState(b.priceMinor, b.payments);
  const loyalty = salon.loyaltyOn && b.service.loyaltyReward && !b.redemption ? await customerLoyalty(db, b.customerId, salon.loyaltyThreshold) : null;
  const next = allowedNextStatuses(b.status, member.role === "owner");
  const days = b.status === "CONFIRMED" || b.status === "PENDING" ? await upcomingDays(db, tz, STAFF_RULES.maxAdvanceDays > 21 ? 21 : 14) : [];
  const barbers = await db.barber.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, displayName: true } });

  return {
    id: b.id,
    ref: b.ref,
    status: b.status,
    source: b.source,
    customerId: b.customerId,
    customerName: b.customer.name,
    serviceId: b.serviceId,
    serviceName: b.service.name,
    durationMin: b.service.durationMin,
    barberId: b.barberId,
    barberName: b.barber.displayName,
    date: formatShortDate(b.startsAt.toISOString(), tz),
    time: formatTime(b.startsAt.toISOString(), tz),
    startsAt: b.startsAt.toISOString(),
    notes: b.notes,
    priceMinor: b.priceMinor,
    currency: b.currency,
    payment: pay,
    payments: b.payments.map((p) => ({ id: p.id, kind: p.kind, method: p.method, amountMinor: p.amountMinor, reference: p.reference, when: `${formatShortDate(p.createdAt.toISOString(), tz)} ${formatTime(p.createdAt.toISOString(), tz)}` })),
    freeCutAvailable: Boolean(loyalty?.rewardAvailable && pay.balanceMinor > 0),
    loyalty,
    nextStatuses: next.filter((to) => {
      const cap = to === "CONFIRMED" || to === "CANCELLED" ? "bookings.manage" : "bookings.complete";
      return can(member.role, cap, own);
    }),
    canPay: can(member.role, "payments.record", own) && b.status !== "CANCELLED" && b.status !== "NO_SHOW",
    canRefund: can(member.role, "payments.refund") && pay.paidMinor > 0,
    onlinePayments: onlinePaymentsReady(salon),
    canReschedule: (b.status === "CONFIRMED" || b.status === "PENDING") && can(member.role, "bookings.manage", own),
    days,
    barbers: member.role === "barber" ? barbers.filter((x) => x.id === member.barberId) : barbers,
    messages: member.role === "barber"
      ? []
      : b.messages.map((m) => ({
          id: m.id,
          type: typeLabel(m.type),
          status: m.status,
          when: `${formatShortDate(m.scheduledFor.toISOString(), tz)} ${formatTime(m.scheduledFor.toISOString(), tz)}`,
          reason: m.skipReason ?? m.failureReason,
        })),
  };
}

export async function newBookingData(ctx: StaffCtx) {
  const db = forSalon(ctx.member.salonId);
  const [services, barbers, days] = await Promise.all([
    db.service.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.barber.findMany({ where: { active: true, ...(ctx.member.role === "barber" ? { id: ctx.member.barberId ?? "none" } : {}) }, orderBy: { sortOrder: "asc" } }),
    upcomingDays(db, ctx.salon.timezone, 21),
  ]);
  return {
    services: services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, priceMinor: s.priceMinor })),
    barbers: barbers.map((b) => ({ id: b.id, name: b.displayName })),
    days,
  };
}
