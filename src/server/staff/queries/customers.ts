// Customers list (design p6) and profile (design p7). Barbers see only customers they've served,
// without phone numbers (docs/permissions.md).
import { formatShortDate, formatTime } from "@/domain/format";
import { primaryBadge, segmentsFor, type Segment } from "@/domain/segments";
import { formatPhone } from "@/domain/phone";
import { DAY_MS } from "@/domain/time";
import { can } from "@/domain/permissions";
import { ForbiddenError } from "@/server/authz";
import { forSalon } from "@/server/db";
import type { StaffCtx } from "../context";
import { customerLoyalty } from "../payments";
import { activeOffer } from "../messaging";
import { maskPhone, paymentState, relativeAgo, revenueOf, todayRange } from "./common";

export const SEGMENT_FILTERS = [
  { key: "all", label: "All" },
  { key: "due", label: "Due to return" },
  { key: "birthday", label: "Birthdays" },
  { key: "new", label: "New" },
  { key: "frequent_canceller", label: "Often miss" },
] as const;
export type SegmentFilter = (typeof SEGMENT_FILTERS)[number]["key"];

export async function customersList(ctx: StaffCtx, q: string | undefined, filter: SegmentFilter, limit = 50, now = new Date()) {
  const { member, salon } = ctx;
  const db = forSalon(member.salonId);
  const tz = salon.timezone;
  const search = q?.trim();
  const digits = search?.replace(/\D/g, "");
  const ownOnly = member.role === "barber" ? { bookings: { some: { barberId: member.barberId ?? "none" } } } : {};

  const customers = await db.customer.findMany({
    where: {
      anonymisedAt: null,
      ...ownOnly,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              ...(digits && digits.length >= 3 && can(member.role, "customers.viewPhone") ? [{ phoneE164: { contains: digits } }] : []),
            ],
          }
        : {}),
    },
    orderBy: [{ lastVisitAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  const ids = customers.map((c) => c.id);
  const today = todayRange(tz, now);
  const [upcoming, todays, recentProblems, recentCompleted] = await Promise.all([
    db.booking.findMany({
      where: { customerId: { in: ids }, startsAt: { gt: now }, status: { in: ["PENDING", "CONFIRMED"] } },
      orderBy: { startsAt: "asc" },
      select: { customerId: true, startsAt: true },
    }),
    db.booking.findMany({
      where: { customerId: { in: ids }, startsAt: { gte: today.start, lt: today.end } },
      select: { customerId: true, status: true, startsAt: true },
    }),
    db.booking.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids }, status: { in: ["NO_SHOW", "CANCELLED"] }, startsAt: { gte: new Date(now.getTime() - 90 * DAY_MS) } },
      _count: true,
    }),
    db.booking.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids }, status: "COMPLETED", startsAt: { gte: new Date(now.getTime() - 180 * DAY_MS) } },
      _count: true,
      _min: { startsAt: true },
    }),
  ]);
  const firstUpcoming = new Map<string, Date>();
  for (const u of upcoming) if (!firstUpcoming.has(u.customerId)) firstUpcoming.set(u.customerId, u.startsAt);
  const problems = new Map(recentProblems.map((p) => [p.customerId, p._count]));
  const completed180 = new Map(recentCompleted.map((p) => [p.customerId, p._count]));

  const rows = customers.map((c) => {
    const todayBooking = todays.find((t) => t.customerId === c.id);
    const segments: Segment[] = segmentsFor(
      {
        visitCount: c.visitCount,
        lastVisitAt: c.lastVisitAt,
        firstVisitAt: c.visitCount <= 1 ? c.lastVisitAt ?? c.createdAt : c.createdAt,
        usualGapDays: c.usualGapDays,
        fallbackGapDays: 21,
        birthMonth: c.birthMonth,
        birthDay: c.birthDay,
        hasUpcomingBooking: firstUpcoming.has(c.id),
        noShowsLast90Days: problems.get(c.id) ?? 0,
        cancellationsLast90Days: 0,
        completedLast180Days: completed180.get(c.id) ?? 0,
      },
      now,
      tz,
    );
    const badge = primaryBadge(segments, { noShow: todayBooking?.status === "NO_SHOW" });
    const next = firstUpcoming.get(c.id);
    const visits = `${c.visitCount} visit${c.visitCount === 1 ? "" : "s"}`;
    const line = todayBooking?.status === "IN_PROGRESS"
      ? "In chair now"
      : todayBooking?.status === "NO_SHOW"
        ? "No-show today"
        : todayBooking && todayBooking.status !== "CANCELLED" && todayBooking.status !== "COMPLETED"
          ? `Booked today ${formatTime(todayBooking.startsAt.toISOString(), tz)}`
          : next && next.getTime() - now.getTime() < 2 * DAY_MS
            ? `${formatShortDate(next.toISOString(), tz)} ${formatTime(next.toISOString(), tz)}`
            : c.lastVisitAt
              ? `Last visit ${relativeAgo(c.lastVisitAt, now)}`
              : "No visits yet";
    return { id: c.id, name: c.name, line: `${line} · ${visits}`, badge, segments };
  });

  const counts = Object.fromEntries(
    SEGMENT_FILTERS.map((f) => [f.key, f.key === "all" ? rows.length : rows.filter((r) => r.segments.includes(f.key as Segment)).length]),
  ) as Record<SegmentFilter, number>;
  const filtered = filter === "all" ? rows : rows.filter((r) => r.segments.includes(filter as Segment));
  return { total: rows.length, counts, rows: filtered.slice(0, limit), more: filtered.length > limit, shown: Math.min(limit, filtered.length), filteredTotal: filtered.length };
}

export async function customerProfile(ctx: StaffCtx, id: string, now = new Date()) {
  const { member, salon } = ctx;
  const db = forSalon(member.salonId);
  const tz = salon.timezone;
  const customer = await db.customer.findFirst({ where: { id, anonymisedAt: null }, include: { preferredBarber: true } });
  if (!customer) return null;
  if (member.role === "barber") {
    const served = await db.booking.findFirst({ where: { customerId: id, barberId: member.barberId ?? "none" } });
    if (!served) throw new ForbiddenError("customers.view");
  }
  const bookings = await db.booking.findMany({
    where: { customerId: id, ...(member.role === "barber" ? { barberId: member.barberId ?? "none" } : {}) },
    include: { service: true, barber: true, payments: true },
    orderBy: { startsAt: "desc" },
  });
  const [loyalty, messages, draft, offer, upcoming] = await Promise.all([
    customerLoyalty(db, id, salon.loyaltyThreshold),
    member.role === "barber"
      ? Promise.resolve([])
      : db.message.findMany({
          where: { customerId: id, status: { notIn: ["DRAFT"] } },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
    db.message.findFirst({ where: { customerId: id, type: "WINBACK", status: "DRAFT" } }),
    member.role === "owner" ? activeOffer(db, salon, now) : Promise.resolve(null),
    db.booking.findFirst({ where: { customerId: id, startsAt: { gt: now }, status: { in: ["PENDING", "CONFIRMED"] } } }),
  ]);
  const completed = bookings.filter((b) => b.status === "COMPLETED");
  const serviceCounts = new Map<string, number>();
  const barberCounts = new Map<string, number>();
  for (const b of completed) {
    serviceCounts.set(b.service.name, (serviceCounts.get(b.service.name) ?? 0) + 1);
    barberCounts.set(b.barber.displayName, (barberCounts.get(b.barber.displayName) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const gap = customer.usualGapDays;
  const due = customer.lastVisitAt && !upcoming && now.getTime() >= customer.lastVisitAt.getTime() + (gap ?? 21) * DAY_MS;

  return {
    id: customer.id,
    name: customer.name,
    phone: can(member.role, "customers.viewPhone") ? formatPhone(customer.phoneE164) : maskPhone(customer.phoneE164),
    phoneE164: can(member.role, "customers.viewPhone") ? customer.phoneE164 : null,
    canContact: can(member.role, "customers.viewPhone"),
    phoneInvalid: customer.phoneInvalid,
    email: customer.email,
    birthMonth: customer.birthMonth,
    birthDay: customer.birthDay,
    preferredStyle: customer.preferredStyle,
    preferredBarberId: customer.preferredBarberId,
    notes: customer.notes,
    visits: customer.visitCount,
    totalSpentMinor: revenueOf(bookings.flatMap((b) => b.payments)),
    usualGapDays: gap,
    lastVisit: customer.lastVisitAt ? `${formatShortDate(customer.lastVisitAt.toISOString(), tz)} · ${relativeAgo(customer.lastVisitAt, now)}` : null,
    usualService: top(serviceCounts),
    barber: customer.preferredBarber?.displayName ?? top(barberCounts),
    utilityConsent: customer.utilityConsent,
    marketingConsent: customer.marketingConsent,
    loyalty: salon.loyaltyOn ? loyalty : null,
    due: Boolean(due),
    draftId: draft?.id ?? null,
    hasOffer: Boolean(offer),
    weeksSince: customer.lastVisitAt ? Math.round((now.getTime() - customer.lastVisitAt.getTime()) / (7 * DAY_MS)) : null,
    history: bookings.map((b) => {
      const pay = paymentState(b.priceMinor, b.payments);
      return {
        id: b.id,
        date: formatShortDate(b.startsAt.toISOString(), tz),
        time: formatTime(b.startsAt.toISOString(), tz),
        service: b.service.name,
        barber: b.barber.displayName,
        priceMinor: b.priceMinor,
        status: b.status,
        payment: b.status === "CANCELLED" || b.status === "NO_SHOW" ? null : pay.status,
        free: b.payments.some((p) => p.method === "LOYALTY"),
      };
    }),
    messages: messages.map((m) => ({
      id: m.id,
      type: m.type,
      status: m.status,
      text: m.renderedText,
      date: formatShortDate((m.sentAt ?? m.createdAt).toISOString(), tz),
      reason: m.skipReason ?? m.failureReason,
    })),
  };
}
