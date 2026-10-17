// Reports — design p11, docs/metrics.md. Owners only; receptionists get today's numbers on Home.
import { RETURN_WINDOW_DAYS, bookedAfterMessage, pctChange, returnRate, weekBuckets } from "@/domain/reports";
import { minorUnitDigits } from "@/domain/money";
import { DAY_MS } from "@/domain/time";
import { assertCan } from "@/server/authz";
import { forSalon } from "@/server/db";
import type { StaffCtx } from "../context";
import { revenueOf } from "./common";

export const PERIODS = [7, 30, 90] as const;

export async function reportsData(ctx: StaffCtx, days: number, now = new Date()) {
  assertCan(ctx.member, "reports.view");
  const db = forSalon(ctx.member.salonId);
  const end = now;
  const start = new Date(end.getTime() - days * DAY_MS);
  const prevStart = new Date(start.getTime() - days * DAY_MS);
  const cohortStart = new Date(end.getTime() - (days + RETURN_WINDOW_DAYS) * DAY_MS);

  const [payments, prevPayments, bookings, prevBookingCount, completedForReturn, marketing, barbers, services] = await Promise.all([
    db.payment.findMany({ where: { createdAt: { gte: start, lt: end } }, include: { booking: { select: { barberId: true } } } }),
    db.payment.findMany({ where: { createdAt: { gte: prevStart, lt: start } } }),
    db.booking.findMany({
      where: { startsAt: { gte: start, lt: end } },
      select: { id: true, status: true, serviceId: true, barberId: true, customerId: true, createdAt: true, priceMinor: true, source: true },
    }),
    db.booking.count({ where: { startsAt: { gte: prevStart, lt: start }, status: { not: "CANCELLED" } } }),
    db.booking.findMany({ where: { status: "COMPLETED", startsAt: { gte: cohortStart, lt: end } }, select: { customerId: true, startsAt: true } }),
    db.message.findMany({
      where: { type: { in: ["WINBACK", "BIRTHDAY", "PROMOTION"] }, status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gte: start, lt: end } },
      select: { customerId: true, sentAt: true },
    }),
    db.barber.findMany({ orderBy: { sortOrder: "asc" } }),
    db.service.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  const active = bookings.filter((b) => b.status !== "CANCELLED");
  const completed = bookings.filter((b) => b.status === "COMPLETED");
  const noShows = bookings.filter((b) => b.status === "NO_SHOW");
  const revenue = revenueOf(payments);
  const rr = returnRate(completedForReturn.map((v) => ({ customerId: v.customerId, at: v.startsAt })), end, days);

  const createdInPeriod = await db.booking.findMany({
    where: { createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" }, source: { in: ["ONLINE", "STAFF"] } },
    select: { customerId: true, createdAt: true, priceMinor: true },
  });
  const brought = bookedAfterMessage(
    marketing.map((m) => ({ customerId: m.customerId, sentAt: m.sentAt! })),
    createdInPeriod.map((b) => ({ customerId: b.customerId, createdAt: b.createdAt, revenueMinor: b.priceMinor })),
  );

  const weeks = weekBuckets(start, end).map((w) => ({
    label: w.partial ? "So far" : "",
    partial: w.partial,
    revenueMinor: revenueOf(payments.filter((p) => p.createdAt >= w.start && p.createdAt < w.end)),
  }));
  weeks.forEach((w, i) => {
    if (!w.partial) w.label = `Wk ${i + 1}`;
  });

  return {
    days,
    revenueMinor: revenue,
    revenueChange: pctChange(revenue, revenueOf(prevPayments)),
    bookings: active.length,
    bookingsChange: pctChange(active.length, prevBookingCount),
    returnRate: rr,
    noShowRate: completed.length + noShows.length ? noShows.length / (completed.length + noShows.length) : null,
    noShows: noShows.length,
    noShowBase: completed.length + noShows.length,
    weeks,
    messagesSent: marketing.length,
    brought,
    services: services
      .map((s) => ({ name: s.name, count: active.filter((b) => b.serviceId === s.id).length }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count),
    barbers: barbers.map((br) => {
      const mine = bookings.filter((b) => b.barberId === br.id);
      const done = mine.filter((b) => b.status === "COMPLETED").length;
      const missed = mine.filter((b) => b.status === "NO_SHOW").length;
      return {
        name: br.displayName,
        bookings: mine.filter((b) => b.status !== "CANCELLED").length,
        noShowRate: done + missed ? missed / (done + missed) : null,
        revenueMinor: revenueOf(payments.filter((p) => p.booking.barberId === br.id)),
      };
    }),
  };
}

/** CSV export of the report period's bookings (design p11 "Export report as CSV"). */
export async function reportCsv(ctx: StaffCtx, days: number, now = new Date()): Promise<string> {
  assertCan(ctx.member, "reports.view");
  const db = forSalon(ctx.member.salonId);
  const start = new Date(now.getTime() - days * DAY_MS);
  const rows = await db.booking.findMany({
    where: { startsAt: { gte: start, lt: now } },
    include: { service: true, barber: true, payments: true },
    orderBy: { startsAt: "asc" },
  });
  const esc = (v: string | number) => {
    const s = String(v);
    // Quote, and neutralise spreadsheet formulas (CSV injection).
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = ["ref", "start (UTC)", "status", "source", "service", "barber", "price", "paid", "currency"];
  const lines = rows.map((b) =>
    [b.ref, b.startsAt.toISOString(), b.status, b.source, b.service.name, b.barber.displayName, b.priceMinor / 10 ** minorUnitDigits(b.currency), revenueOf(b.payments) / 10 ** minorUnitDigits(b.currency), b.currency]
      .map(esc)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
