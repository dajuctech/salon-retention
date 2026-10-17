// Slot calculation against the database (BR-A1–A5). Shared by the public page and staff screens.
import { mergeGrids, slotGrid, type GridSlot, type Interval } from "@/domain/availability";
import { BLOCKING_STATUSES } from "@/domain/booking-status";
import { DAY_MS, atLocal, localParts } from "@/domain/time";
import { forSalon, type TenantDb } from "./db";

export type DayOption = { key: string; weekday: number; day: number; month: number; year: number; closed: boolean };
export type SlotOption = { iso: string; available: boolean };

type SlotSalon = {
  id: string;
  timezone: string;
  slotGridMinutes: number;
  minLeadMinutes: number;
  maxAdvanceDays: number;
};

/** Staff can book right now and further ahead than customers (online rules are BR-A4). */
export type SlotRules = { minLeadMin: number; maxAdvanceDays: number };
export const STAFF_RULES: SlotRules = { minLeadMin: 0, maxAdvanceDays: 90 };

export function parseDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

export function dateKey(p: { year: number; month: number; day: number }) {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The next `count` salon-local days, marked closed from opening hours and closed dates. */
export async function upcomingDays(db: TenantDb, timeZone: string, count: number, from = new Date()): Promise<DayOption[]> {
  const [openingHours, closedDates] = await Promise.all([db.openingHours.findMany(), db.closedDate.findMany()]);
  const today = localParts(from, timeZone);
  const closed = new Set(closedDates.map((c) => c.date.toISOString().slice(0, 10)));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    const p = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    const weekday = d.getUTCDay();
    const open = openingHours.some((o) => o.weekday === weekday);
    return { key: dateKey(p), weekday, ...p, closed: !open || closed.has(dateKey(p)) };
  });
}

export async function barberGrid(
  db: TenantDb,
  salon: SlotSalon,
  barberId: string,
  service: { durationMin: number; bufferMin: number },
  key: string,
  now: Date,
  ignoreBookingId?: string,
  rules?: SlotRules,
): Promise<GridSlot[]> {
  const date = parseDateKey(key);
  const dayStart = atLocal(salon.timezone, date.year, date.month, date.day);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const [salonHours, barberHours, closed, bookings, timeOff] = await Promise.all([
    db.openingHours.findMany({ where: { weekday: date.weekday } }),
    db.barberHours.findMany({ where: { barberId, weekday: date.weekday } }),
    db.closedDate.findFirst({ where: { date: new Date(`${key}T00:00:00Z`) } }),
    db.booking.findMany({
      where: {
        barberId,
        status: { in: [...BLOCKING_STATUSES] },
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
        ...(ignoreBookingId ? { id: { not: ignoreBookingId } } : {}),
      },
      select: { startsAt: true, endsAt: true },
    }),
    db.timeOff.findMany({
      where: { barberId, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  const busy: Interval[] = [...bookings, ...timeOff].map((b) => ({ start: b.startsAt, end: b.endsAt }));
  return slotGrid({
    timeZone: salon.timezone,
    date,
    closed: Boolean(closed),
    salonHours,
    barberHours,
    busy,
    durationMin: service.durationMin,
    bufferMin: service.bufferMin,
    gridMin: salon.slotGridMinutes,
    now,
    minLeadMin: rules?.minLeadMin ?? salon.minLeadMinutes,
    maxAdvanceDays: rules?.maxAdvanceDays ?? salon.maxAdvanceDays,
  });
}

export async function slotsFor(
  salon: SlotSalon,
  serviceId: string,
  barber: string,
  key: string,
  opts: { rules?: SlotRules; ignoreBookingId?: string } = {},
): Promise<SlotOption[]> {
  const db = forSalon(salon.id);
  const service = await db.service.findFirst({ where: { id: serviceId, active: true } });
  if (!service) return [];
  const barberIds =
    barber === "any"
      ? (await db.barber.findMany({ where: { active: true }, select: { id: true } })).map((b) => b.id)
      : (await db.barber.findMany({ where: { id: barber, active: true }, select: { id: true } })).map((b) => b.id);
  const now = new Date();
  const grids = await Promise.all(
    barberIds.map((id) => barberGrid(db, salon, id, service, key, now, opts.ignoreBookingId, opts.rules)),
  );
  return mergeGrids(grids).map((s) => ({ iso: s.start.toISOString(), available: s.available }));
}
