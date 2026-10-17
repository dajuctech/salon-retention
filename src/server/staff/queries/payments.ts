// Payments — design p8, US-16. Barbers see their own bookings only.
import { formatShortDate, formatTime } from "@/domain/format";
import { forSalon } from "@/server/db";
import type { StaffCtx } from "../context";
import { customerLoyalty } from "../payments";
import { daysAgo, paymentState, revenueOf, todayRange } from "./common";

export type PaymentFilter = "all" | "paid" | "unpaid" | "part";

export async function paymentsData(ctx: StaffCtx, filter: PaymentFilter, now = new Date()) {
  const { member, salon } = ctx;
  const db = forSalon(member.salonId);
  const tz = salon.timezone;
  const today = todayRange(tz, now);
  const own = member.role === "barber" ? { barberId: member.barberId ?? "none" } : {};

  const [todayBookings, recent, paymentsToday] = await Promise.all([
    db.booking.findMany({ where: { ...own, startsAt: { gte: today.start, lt: today.end }, status: { notIn: ["CANCELLED", "NO_SHOW"] } }, include: { payments: true } }),
    // Anything served in the last 30 days that may still owe money.
    db.booking.findMany({
      where: { ...own, startsAt: { gte: daysAgo(30, now), lt: today.end }, status: { in: ["IN_PROGRESS", "COMPLETED", "CONFIRMED"] } },
      include: { payments: true, customer: true, service: true },
      orderBy: { startsAt: "desc" },
    }),
    db.payment.findMany({
      where: { createdAt: { gte: today.start, lt: today.end }, ...(member.role === "barber" ? { booking: own } : {}) },
      include: { booking: { include: { customer: true, service: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const collectedToday = revenueOf(paymentsToday);
  const bookedToday = todayBookings.reduce((s, b) => s + b.priceMinor, 0);
  const byMethod = { CASH: 0, TRANSFER: 0, POS: 0, CARD: 0, ONLINE: 0 } as Record<string, number>;
  for (const p of paymentsToday) if (p.kind === "PAYMENT" && p.method in byMethod) byMethod[p.method] += p.amountMinor;

  const withState = recent
    .filter((b) => b.status !== "CONFIRMED" || b.startsAt < today.end) // future confirmed bookings aren't owed yet
    .map((b) => ({ b, state: paymentState(b.priceMinor, b.payments) }));
  const owing = withState.filter((x) => x.state.balanceMinor > 0 && x.b.status !== "CONFIRMED");
  const outstanding = owing.reduce((s, x) => s + x.state.balanceMinor, 0);
  const loyaltyByCustomer = new Map<string, boolean>();
  if (salon.loyaltyOn) {
    for (const x of owing) {
      if (!loyaltyByCustomer.has(x.b.customerId) && x.b.service.loyaltyReward) {
        loyaltyByCustomer.set(x.b.customerId, (await customerLoyalty(db, x.b.customerId, salon.loyaltyThreshold)).rewardAvailable);
      }
    }
  }

  const relDay = (d: Date) => {
    if (d >= today.start) return null;
    if (d >= new Date(today.start.getTime() - 86_400_000)) return "Yesterday";
    return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: tz }).format(d);
  };

  const counts = {
    paid: withState.filter((x) => x.state.status === "PAID").length,
    unpaid: owing.filter((x) => x.state.status === "UNPAID").length,
    part: owing.filter((x) => x.state.status === "PART_PAID").length,
  };

  const owingRows = owing
    .filter((x) => filter === "all" || (filter === "unpaid" && x.state.status === "UNPAID") || (filter === "part" && x.state.status === "PART_PAID"))
    .map((x) => ({
      bookingId: x.b.id,
      customer: x.b.customer.name,
      detail: `${x.b.service.name} · ${x.b.status === "IN_PROGRESS" ? "In chair now" : (relDay(x.b.startsAt) ?? formatTime(x.b.startsAt.toISOString(), tz))}`,
      paidMinor: x.state.paidMinor,
      balanceMinor: x.state.balanceMinor,
      status: x.state.status,
      freeCutAvailable: loyaltyByCustomer.get(x.b.customerId) ?? false,
    }));

  return {
    collectedToday,
    bookedToday,
    outstanding,
    owingCustomers: new Set(owing.map((x) => x.b.customerId)).size,
    byMethod,
    counts,
    owing: filter === "paid" ? [] : owingRows,
    paidToday:
      filter === "unpaid" || filter === "part"
        ? []
        : paymentsToday.map((p) => ({
            id: p.id,
            customer: p.booking.customer.name,
            detail: `${p.booking.service.name} · ${p.method === "LOYALTY" ? "Free cut" : methodLabel(p.method)} · ${formatTime(p.createdAt.toISOString(), tz)}`,
            amountMinor: p.kind === "REFUND" ? -p.amountMinor : p.amountMinor,
            refund: p.kind === "REFUND",
            date: formatShortDate(p.createdAt.toISOString(), tz),
          })),
  };
}

export function methodLabel(m: string): string {
  return ({ CASH: "Cash", TRANSFER: "Transfer", POS: "POS", CARD: "Card", ONLINE: "Online", LOYALTY: "Free cut" } as Record<string, string>)[m] ?? m;
}
