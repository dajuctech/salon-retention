// Home dashboard — design p4, US-25.
import { formatTime } from "@/domain/format";
import { daysUntilBirthday } from "@/domain/segments";
import { DAY_MS } from "@/domain/time";
import { can } from "@/domain/permissions";
import { forSalon } from "@/server/db";
import type { StaffCtx } from "../context";
import { paymentState, relativeAgo, revenueOf, todayRange, weekStart } from "./common";

export type DueCustomer = { id: string; name: string; lastVisit: string; overdueDays: number };

/** Customers past their usual gap with no upcoming booking (BR-R3a, segment "Due to return"). */
export async function dueCustomers(salonId: string, now = new Date(), limit?: number): Promise<{ total: number; list: DueCustomer[] }> {
  const db = forSalon(salonId);
  const rows = await db.$queryRaw<{ id: string; name: string; lastVisitAt: Date; overdue: number }[]>`
    SELECT c.id, c.name, c."lastVisitAt",
           EXTRACT(EPOCH FROM (${now}::timestamptz - (c."lastVisitAt" + make_interval(days => COALESCE(c."usualGapDays", 21))))) / 86400 AS overdue
    FROM "Customer" c
    WHERE c."salonId" = ${salonId} AND c."anonymisedAt" IS NULL AND c."lastVisitAt" IS NOT NULL
      AND c."lastVisitAt" + make_interval(days => COALESCE(c."usualGapDays", 21)) <= ${now}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM "Booking" b WHERE b."customerId" = c.id AND b."startsAt" > ${now}::timestamptz
          AND b.status IN ('PENDING', 'CONFIRMED'))
    ORDER BY overdue DESC`;
  const list = rows.slice(0, limit ?? rows.length).map((r) => ({
    id: r.id,
    name: r.name,
    lastVisit: relativeAgo(r.lastVisitAt, now),
    overdueDays: Math.floor(Number(r.overdue)),
  }));
  return { total: rows.length, list };
}

export async function dashboardData(ctx: StaffCtx, now = new Date()) {
  const { salon, member } = ctx;
  const db = forSalon(member.salonId);
  const tz = salon.timezone;
  const today = todayRange(tz, now);
  const tomorrow = { start: today.end, end: new Date(today.end.getTime() + DAY_MS) };
  const own = member.role === "barber" ? { barberId: member.barberId ?? "none" } : {};
  const seeMoney = can(member.role, "reports.viewToday");

  const [todays, tomorrows, payments, noShows] = await Promise.all([
    db.booking.findMany({
      where: { ...own, startsAt: { gte: today.start, lt: today.end }, status: { not: "CANCELLED" } },
      include: { customer: true, service: true, barber: true, payments: true },
      orderBy: { startsAt: "asc" },
    }),
    db.booking.findMany({
      where: { ...own, startsAt: { gte: tomorrow.start, lt: tomorrow.end }, status: { in: ["CONFIRMED", "PENDING"] } },
      include: { customer: true, service: true, barber: true },
      orderBy: { startsAt: "asc" },
    }),
    seeMoney ? db.payment.findMany({ where: { createdAt: { gte: today.start, lt: today.end } } }) : Promise.resolve([]),
    db.booking.findMany({
      where: { ...own, status: "NO_SHOW", startsAt: { gte: weekStart(tz, now), lt: today.end } },
      select: { customerId: true },
    }),
  ]);

  const toCollect = todays
    .filter((b) => b.status !== "NO_SHOW")
    .reduce((sum, b) => sum + paymentState(b.priceMinor, b.payments).balanceMinor, 0);
  const rebooked = noShows.length
    ? await db.booking.count({
        where: { customerId: { in: noShows.map((n) => n.customerId) }, startsAt: { gt: now }, status: { in: ["CONFIRMED", "PENDING"] } },
      })
    : 0;

  const showRetention = member.role !== "barber";
  const due = showRetention ? await dueCustomers(member.salonId, now, 3) : { total: 0, list: [] };

  // Birthdays this week (design p4): status reflects the automatic message (US-23).
  const birthdayCandidates = showRetention
    ? await db.customer.findMany({ where: { anonymisedAt: null, birthMonth: { not: null }, birthDay: { not: null } } })
    : [];
  const birthdays = birthdayCandidates
    .map((c) => ({ c, inDays: daysUntilBirthday(c.birthMonth!, c.birthDay!, now, tz) }))
    .filter((x) => x.inDays <= 6)
    .sort((a, b) => a.inDays - b.inDays);
  const birthdayMessages = birthdays.length
    ? await db.message.findMany({
        where: { type: "BIRTHDAY", customerId: { in: birthdays.map((b) => b.c.id) }, createdAt: { gte: today.start } },
        select: { customerId: true, status: true },
      })
    : [];

  const [recentMessages, drafts, unread] = showRetention
    ? await Promise.all([
        db.message.findMany({
          where: { status: { in: ["SENT", "DELIVERED", "READ", "FAILED"] } },
          orderBy: { createdAt: "desc" },
          take: 3,
          include: { customer: { select: { name: true } } },
        }),
        db.message.count({ where: { type: "WINBACK", status: "DRAFT" } }),
        db.conversation.aggregate({ _sum: { unreadCount: true } }),
      ])
    : [[], 0, { _sum: { unreadCount: 0 } }];

  return {
    seeMoney,
    revenueTodayMinor: revenueOf(payments),
    toCollectMinor: toCollect,
    bookingsToday: todays.filter((b) => b.status !== "NO_SHOW").length,
    doneToday: todays.filter((b) => b.status === "COMPLETED").length,
    noShowsThisWeek: noShows.length,
    noShowsRebooked: rebooked,
    due,
    drafts,
    unread: unread._sum.unreadCount ?? 0,
    today: todays.map((b) => ({
      id: b.id,
      time: formatTime(b.startsAt.toISOString(), tz),
      customer: b.customer.name,
      service: b.service.name,
      barber: b.barber.displayName,
      status: b.status,
    })),
    tomorrow: tomorrows.map((b) => ({
      id: b.id,
      time: formatTime(b.startsAt.toISOString(), tz),
      customer: b.customer.name,
      service: b.service.name,
      barber: b.barber.displayName,
    })),
    birthdays: birthdays.map(({ c, inDays }) => {
      const msg = birthdayMessages.find((m) => m.customerId === c.id);
      const date = new Date(now.getTime() + inDays * DAY_MS);
      const status = !c.marketingConsent
        ? "No consent"
        : !salon.birthdayMessageOn
          ? "Auto-message off"
          : msg && ["SENT", "DELIVERED", "READ"].includes(msg.status)
            ? "Sent ✓"
            : msg?.status === "FAILED"
              ? "Failed"
              : `Sends ${inDays === 0 ? "today" : new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: tz }).format(date)} 09:00 ✓`;
      return {
        id: c.id,
        name: c.name,
        when:
          inDays === 0
            ? `Today · ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz }).format(now)}`
            : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: tz }).format(date),
        status,
      };
    }),
    recentMessages: recentMessages.map((m) => ({
      id: m.id,
      title: `${typeLabel(m.type)} to ${m.customer.name}`,
      text: m.renderedText,
      status: m.status,
      time: formatTime((m.sentAt ?? m.createdAt).toISOString(), tz),
    })),
  };
}

export function typeLabel(type: string): string {
  return (
    {
      BOOKING_CONFIRMATION: "Confirmation",
      REMINDER_DAY_BEFORE: "Day-before reminder",
      REMINDER_2H: "Reminder",
      WINBACK: "Win-back",
      BIRTHDAY: "Birthday",
      PROMOTION: "Offer",
      OPTOUT_CONFIRMATION: "Opt-out reply",
      STAFF_REPLY: "Reply",
    } as Record<string, string>
  )[type] ?? type;
}
