// Calendar — design p5. US-14 day and week views per barber (AC3: status and payment status on
// every booking), US-15 month view with booking counts per day.
import { formatTime } from "@/domain/format";
import { derivePaymentStatus } from "@/domain/payment-status";
import { atLocal, localDateKey } from "@/domain/time";
import { forSalon } from "@/server/db";
import { STAFF_RULES, upcomingDays } from "@/server/slots";
import type { StaffCtx } from "../context";
import { dayRange } from "./common";

export async function calendarDay(ctx: StaffCtx, key: string | undefined, barberFilter: string | undefined, now = new Date()) {
  const { salon, member } = ctx;
  const db = forSalon(member.salonId);
  const tz = salon.timezone;
  const dateKey = key && /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : localDateKey(now, tz);
  const { start, end } = dayRange(tz, dateKey);
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  // Design p5: the Monday–Sunday week containing the selected day.
  const monday = new Date(Date.UTC(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)) - 1, Number(dateKey.slice(8, 10)) - ((weekday + 6) % 7), 12));

  // Independent reads run together: this is the busiest staff screen (NFR-P2, load test).
  const [barbers, days] = await Promise.all([
    db.barber.findMany({
      where: { active: true, ...(member.role === "barber" ? { id: member.barberId ?? "none" } : {}) },
      orderBy: { sortOrder: "asc" },
    }),
    upcomingDays(db, tz, 7, monday),
  ]);
  const shown = barberFilter && barberFilter !== "all" ? barbers.filter((b) => b.id === barberFilter) : barbers;

  const [bookings, hours, barberHours] = await Promise.all([
    db.booking.findMany({
      where: { barberId: { in: shown.map((b) => b.id) }, startsAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
      include: { customer: { select: { name: true } }, service: { select: { name: true } }, payments: { select: { kind: true, amountMinor: true } } },
      orderBy: { startsAt: "asc" },
    }),
    db.openingHours.findMany({ where: { weekday } }),
    db.barberHours.findMany({ where: { weekday, barberId: { in: shown.map((b) => b.id) } } }),
  ]);

  // Visible window: opening hours (or barber hours, or 09–18), widened to fit any booking.
  const minutes = (d: Date) => {
    const t = formatTime(d.toISOString(), tz).split(":").map(Number);
    return t[0] * 60 + t[1];
  };
  const ranges = [...hours, ...barberHours];
  let from = ranges.length ? Math.min(...ranges.map((r) => r.startMin)) : 9 * 60;
  let to = ranges.length ? Math.max(...ranges.map((r) => r.endMin)) : 18 * 60;
  for (const b of bookings) {
    from = Math.min(from, minutes(b.startsAt));
    to = Math.max(to, Math.min(24 * 60, minutes(b.startsAt) + Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000)));
  }
  from = Math.floor(from / 60) * 60;
  to = Math.ceil(to / 60) * 60;

  const isToday = dateKey === localDateKey(now, tz);

  return {
    dateKey,
    days,
    isToday,
    nowMin: isToday ? minutes(now) : null,
    from,
    to,
    barbers: barbers.map((b) => ({ id: b.id, name: b.displayName })),
    columns: shown.map((b) => ({
      id: b.id,
      name: b.displayName,
      bookings: bookings
        .filter((x) => x.barberId === b.id)
        .map((x) => ({
          id: x.id,
          startMin: minutes(x.startsAt),
          durationMin: Math.round((x.endsAt.getTime() - x.startsAt.getTime()) / 60_000),
          customer: x.customer.name,
          service: x.service.name,
          status: x.status,
          paymentStatus: derivePaymentStatus(x.priceMinor, x.payments).status,
          walkIn: x.source === "WALK_IN",
          // Drag-to-move: upcoming bookings only, and barbers only their own.
          movable: (x.status === "CONFIRMED" || x.status === "PENDING") && x.startsAt > now && (member.role !== "barber" || x.barberId === member.barberId),
        })),
    })),
    count: bookings.length,
    gridMin: salon.slotGridMinutes,
    timeZone: tz,
    staffRules: STAFF_RULES,
  };
}

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const keyOf = (d: Date) => d.toISOString().slice(0, 10);
/** Calendar arithmetic on date keys (noon UTC, so no daylight-saving edge cases). */
const shiftKey = (key: string, days: number) => keyOf(new Date(Date.parse(`${key}T12:00:00Z`) + days * 86_400_000));
const mondayOf = (key: string) => shiftKey(key, -((new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7));

async function visibleBarbers(ctx: StaffCtx, barberFilter: string | undefined) {
  const { member } = ctx;
  const barbers = await forSalon(member.salonId).barber.findMany({
    where: { active: true, ...(member.role === "barber" ? { id: member.barberId ?? "none" } : {}) },
    orderBy: { sortOrder: "asc" },
  });
  const shown = barberFilter && barberFilter !== "all" ? barbers.filter((b) => b.id === barberFilter) : barbers;
  return { barbers, shown };
}

async function closedKeys(ctx: StaffCtx, from: string, to: string) {
  const db = forSalon(ctx.member.salonId);
  const [opening, closed] = await Promise.all([
    db.openingHours.findMany({ select: { weekday: true } }),
    db.closedDate.findMany({ where: { date: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T00:00:00Z`) } }, select: { date: true } }),
  ]);
  const openDays = new Set(opening.map((o) => o.weekday));
  const closedDates = new Set(closed.map((c) => keyOf(c.date)));
  return (key: string) => !openDays.has(new Date(`${key}T12:00:00Z`).getUTCDay()) || closedDates.has(key);
}

/** US-14 week view: Monday to Sunday, each day's bookings in time order. */
export async function calendarWeek(ctx: StaffCtx, key: string | undefined, barberFilter: string | undefined, now = new Date()) {
  const tz = ctx.salon.timezone;
  const dateKey = key && KEY.test(key) ? key : localDateKey(now, tz);
  const monday = mondayOf(dateKey);
  const sunday = shiftKey(monday, 6);
  const [y, m, d] = monday.split("-").map(Number);
  const start = atLocal(tz, y, m, d);
  const end = atLocal(tz, y, m, d + 7);
  const { barbers, shown } = await visibleBarbers(ctx, barberFilter);
  const [bookings, isClosed] = await Promise.all([
    forSalon(ctx.member.salonId).booking.findMany({
      where: { barberId: { in: shown.map((b) => b.id) }, startsAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
      include: { customer: { select: { name: true } }, service: { select: { name: true } }, barber: { select: { displayName: true } }, payments: { select: { kind: true, amountMinor: true } } },
      orderBy: { startsAt: "asc" },
    }),
    closedKeys(ctx, monday, shiftKey(monday, 7)),
  ]);
  const today = localDateKey(now, tz);
  const days = Array.from({ length: 7 }, (_, i) => {
    const k = shiftKey(monday, i);
    return {
      key: k,
      weekday: new Date(`${k}T12:00:00Z`).getUTCDay(),
      day: Number(k.slice(8, 10)),
      today: k === today,
      closed: isClosed(k),
      bookings: bookings
        .filter((b) => localDateKey(b.startsAt, tz) === k)
        .map((b) => ({
          id: b.id,
          time: formatTime(b.startsAt.toISOString(), tz),
          customer: b.customer.name,
          service: b.service.name,
          barber: b.barber.displayName,
          status: b.status,
          paymentStatus: derivePaymentStatus(b.priceMinor, b.payments).status,
          walkIn: b.source === "WALK_IN",
        })),
    };
  });
  return { dateKey, monday, sunday, prev: shiftKey(monday, -7), next: shiftKey(monday, 7), days, count: bookings.length, barbers: barbers.map((b) => ({ id: b.id, name: b.displayName })) };
}

/** US-15 month view: booking counts per day, weeks starting on Monday. */
export async function calendarMonth(ctx: StaffCtx, key: string | undefined, barberFilter: string | undefined, now = new Date()) {
  const tz = ctx.salon.timezone;
  const dateKey = key && KEY.test(key) ? key : localDateKey(now, tz);
  const [y, m] = dateKey.split("-").map(Number);
  const first = `${dateKey.slice(0, 7)}-01`;
  const nextFirst = keyOf(new Date(Date.UTC(y, m, 1, 12)));
  const gridStart = mondayOf(first);
  const weeks = Math.ceil((Date.parse(`${nextFirst}T12:00:00Z`) - Date.parse(`${gridStart}T12:00:00Z`)) / (7 * 86_400_000));
  const { barbers, shown } = await visibleBarbers(ctx, barberFilter);
  const [bookings, isClosed] = await Promise.all([
    forSalon(ctx.member.salonId).booking.findMany({
      where: { barberId: { in: shown.map((b) => b.id) }, startsAt: { gte: atLocal(tz, y, m, 1), lt: atLocal(tz, y, m + 1, 1) }, status: { not: "CANCELLED" } },
      select: { startsAt: true },
    }),
    closedKeys(ctx, gridStart, shiftKey(gridStart, weeks * 7)),
  ]);
  const counts = new Map<string, number>();
  for (const b of bookings) {
    const k = localDateKey(b.startsAt, tz);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const today = localDateKey(now, tz);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => {
    const k = shiftKey(gridStart, i);
    return { key: k, day: Number(k.slice(8, 10)), inMonth: k.slice(0, 7) === first.slice(0, 7), today: k === today, closed: isClosed(k), count: counts.get(k) ?? 0 };
  });
  return {
    dateKey,
    title: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T12:00:00Z`)),
    prev: keyOf(new Date(Date.UTC(y, m - 2, 1, 12))),
    next: nextFirst,
    cells,
    count: bookings.length,
    barbers: barbers.map((b) => ({ id: b.id, name: b.displayName })),
  };
}
